/**
 * Findings (detections) and the investigation endpoints that answer analyst questions directly:
 *   - "What did this user do? Were they compromised?"  → verdict + narrated story + grouped timeline
 *   - "Was this email a phishing campaign and who fell for it?" → email investigation
 *   - "Who clicked this link / domain?" → URL investigation
 *   - "What is this IP?" → IP investigation
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  Finding, SignalRun, Verdict, VerdictIndicator, VerdictLevel, StoryMoment, UserInvestigation, TimelineLine, EmailCandidate, EmailRecipient,
  EmailInvestigation, UrlInvestigation, IpInvestigation, ResolveResult, Severity, EventQuery, SourceId, EventKind, FacetBucket,
} from '@audit/core';
import { friendlyOperation, userAgentFamily, ROUTINE_OPERATIONS, SOURCES, SOURCE_IDS } from '@audit/core';
import { countryName, OWNER_LABEL, type IpOwnerCategory } from '@audit/ipdata';
import { query, one, camel } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { loadWorkspace, exclusionsOf } from '../lib/workspace.js';
import { compileQuery, SqlBuilder, exclusionSql } from '../lib/search.js';
import { runSignals } from '../lib/signals.js';
import { personDetail } from './people.js';

type Row = Record<string, unknown>;
const SEV_W: Record<Severity, number> = { high: 3, medium: 1.5, low: 0.5 };
const SEV_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const STRONG = new Set(['brute', 'session', 'travel', 'fwd', 'consentrisk', 'rule', 'click', 'audit', 'purge', 'ident']);
const uniq = <T>(a: T[]) => [...new Set(a)];
const toFinding = (r: Row): Finding => { const f = camel<Finding>(r); f.eventIds = (f.eventIds ?? []).map(Number); return f; };

async function findingsFor(workspaceId: string, opts: { user?: string; ip?: string; status?: string[] } = {}): Promise<Finding[]> {
  const b = new SqlBuilder();
  const w = [`workspace_id = ${b.add(workspaceId)}`];
  if (opts.user) w.push(`users @> array[${b.add(opts.user.toLowerCase())}]::text[]`);
  if (opts.ip) w.push(`(entity_value = ${b.add(opts.ip)} or facts::text like ${b.add('%' + opts.ip + '%')})`);
  if (opts.status) w.push(`status = any(${b.add(opts.status)}::text[])`);
  const rows = await query<Row>(`select * from findings where ${w.join(' and ')} order by case severity when 'high' then 0 when 'medium' then 1 else 2 end, last_ts desc nulls last limit 500`, b.params);
  return rows.map(toFinding);
}

/** Is this finding about the account itself, or an attacker-level finding (spray, scripted client, shared country) that merely lists the account among its targets? */
export function isOwnFinding(f: Finding, upn: string): boolean {
  const u = upn.toLowerCase();
  if (f.entityType === 'user') return (f.entityValue ?? '').toLowerCase() === u;
  if (f.users.length === 1) return f.users[0].toLowerCase() === u;
  // Session / message / app findings touch few accounts and each of them is affected.
  return f.entityType !== 'ip' && f.users.length <= 3;
}

export function levelFrom(own: Finding[], hasSignIns: boolean): VerdictLevel {
  const highs = own.filter((f) => f.severity === 'high');
  const meds = own.filter((f) => f.severity === 'medium');
  const strong = highs.filter((f) => STRONG.has(f.signal));
  if (highs.length >= 2 || (strong.length >= 1 && meds.length >= 1) || own.some((f) => f.status === 'confirmed' && f.severity === 'high')) return 'compromised';
  if (highs.length >= 1 || meds.length >= 2) return 'suspicious';
  if (!hasSignIns && own.length === 0) return 'insufficient';
  return 'clean';
}

export function verdictFrom(findings: Finding[], upn: string, hasSignIns: boolean, blindSpots: string[]): Verdict {
  const live = findings.filter((f) => f.status !== 'dismissed');
  const own = live.filter((f) => isOwnFinding(f, upn));
  const targeted = live.filter((f) => !isOwnFinding(f, upn));
  const highs = own.filter((f) => f.severity === 'high');
  const meds = own.filter((f) => f.severity === 'medium');
  const score = own.reduce((a, f) => a + SEV_W[f.severity], 0) + targeted.reduce((a, f) => a + SEV_W[f.severity] / 4, 0);
  const level = levelFrom(own, hasSignIns);
  const sortSev = (a: Finding, b: Finding) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || (a.firstTs ?? '').localeCompare(b.firstTs ?? '');
  const indicators: VerdictIndicator[] = [
    ...own.slice().sort(sortSev).map((f) => ({ severity: f.severity, title: f.title, text: f.text, findingId: f.id, evidenceQuery: f.evidenceQuery, ts: f.firstTs, targetedOnly: false })),
    ...targeted.slice().sort(sortSev).map((f) => ({ severity: f.severity, title: f.title, text: f.text, findingId: f.id, evidenceQuery: f.evidenceQuery, ts: f.firstTs, targetedOnly: true })),
  ];
  const headline = level === 'compromised' ? `Likely compromised — ${highs.length} strong indicator${highs.length === 1 ? '' : 's'}`
    : level === 'suspicious' ? `Suspicious — ${highs.length ? `${highs.length} high` : `${meds.length} medium`} finding${(highs.length || meds.length) === 1 ? '' : 's'}, not conclusive`
    : level === 'insufficient' ? 'Not enough data to judge'
    : targeted.length ? 'No signs of compromise — but the account was targeted'
    : own.length ? `No signs of compromise — ${own.length} low-severity note${own.length === 1 ? '' : 's'}` : 'No signs of compromise';
  const top = own.slice().sort(sortSev).slice(0, 3).map((f) => f.title.replace(/^([A-Z])(?![A-Z])/, (c) => c.toLowerCase()));
  const targetedNote = targeted.length ? ` The account also appears in ${targeted.length} wider finding${targeted.length === 1 ? '' : 's'} (${uniq(targeted.map((f) => f.title.toLowerCase())).slice(0, 2).join(', ')}) that target many accounts at once; those describe the attacker, not this account's behaviour.` : '';
  const summary = level === 'compromised'
    ? `The account shows ${top.join(', ')}. Together these are the pattern of an account takeover or deliberate misuse: reset the password, revoke sessions and app consents, remove rules and forwarding, then review what was accessed.${targetedNote}`
    : level === 'suspicious' ? `There ${own.length === 1 ? 'is one thing' : 'are things'} worth checking: ${top.join(', ')}. None of them proves a compromise on its own — read the evidence and the timeline below.${targetedNote}`
    : level === 'insufficient' ? 'This workspace holds no sign-in records for the account, so authentication-based checks could not run. Import Entra sign-in logs or make sure the Purview export includes UserLoggedIn events.'
    : `Sign-ins, mailbox changes, sharing and admin activity for this account look normal in the imported data.${targetedNote}${targeted.length ? ' Nothing indicates the attempts succeeded.' : ''} Check the blind spots below before closing the case.`;
  return { level, headline, summary, score, indicators, blindSpots, ownFindings: own.length, targetedFindings: targeted.length };
}

function blindSpotsFor(sources: SourceId[], userHasSignIns: boolean): string[] {
  const out: string[] = [];
  const has = (s: SourceId) => sources.includes(s);
  if (!has('entra_signin')) out.push('No Entra ID sign-in logs imported: MFA details, device, Conditional Access and non-interactive sign-ins are invisible; only Purview UserLoggedIn events were used.');
  if (!has('message_trace')) out.push('No message trace imported: mail delivery, external forwarding traffic and reply/forward chains cannot be verified.');
  if (!SOURCE_IDS.some((s) => s.startsWith('defender') && has(s))) out.push('No Defender for Office 365 data: phishing verdicts and Safe Links clicks are limited to what the audit log contains.');
  if (!has('entra_audit')) out.push('No Entra audit log: directory changes rely on the Purview AzureActiveDirectory records.');
  if (!userHasSignIns) out.push('No sign-in events at all for this account in the imported window.');
  return out;
}

// ---------------------------------------------------------------- timeline sentences

const FILE_VERB: Record<string, string> = { fileaccessed: 'Opened', fileaccessedextended: 'Kept working on', filepreviewed: 'Previewed', filedownloaded: 'Downloaded', fileuploaded: 'Uploaded', filemodified: 'Edited', filemodifiedextended: 'Kept editing', filedeleted: 'Deleted', filerecycled: 'Deleted', filedeletedfirststagerecyclebin: 'Purged from recycle bin', filedeletedsecondstagerecyclebin: 'Permanently deleted', filemoved: 'Moved', filecopied: 'Copied', filerenamed: 'Renamed', filerestored: 'Restored', filesyncdownloadedfull: 'Synced down', filesyncuploadedfull: 'Synced up', filesyncdownloadedpartial: 'Synced down', foldercreated: 'Created folder', folderdeleted: 'Deleted folder', folderrecycled: 'Deleted folder', pageviewed: 'Viewed page', pageviewedextended: 'Kept viewing page', anonymouslinkcreated: 'Created an "Anyone" link to', sharinginvitationcreated: 'Shared', sharingset: 'Set sharing on', addedtosecurelink: 'Added a person to the link for', securelinkcreated: 'Created a specific-people link to', anonymouslinkused: 'Used an "Anyone" link to open', sharinglinkused: 'Used a sharing link to open' };
const MAIL_VERB: Record<string, string> = { mailitemsaccessed: 'Read', send: 'Sent', sendas: 'Sent as another user', sendonbehalf: 'Sent on behalf', create: 'Created', update: 'Updated', move: 'Moved', movetodeleteditems: 'Deleted', softdelete: 'Deleted', harddelete: 'Permanently deleted', copy: 'Copied', folderbind: 'Opened folder', mailboxlogin: 'Logged in to mailbox', searchqueryinitiatedexchange: 'Searched mail for' };
const plural = (n: number, s: string, p = s + 's') => `${n.toLocaleString('en-GB')} ${n === 1 ? s : p}`;

function sentenceFor(kind: EventKind, opKey: string, op: string, n: number, items: string[], detail: string | null, failed: boolean, result: string | null, counterpart: string | null): string {
  items = items.filter((i) => i && i.replace(/[\s.\-_]/g, ''));
  const list = items.slice(0, 3).map((i) => `"${i}"`).join(', ') + (items.length > 3 ? ` and ${items.length - 3} more` : '');
  switch (kind) {
    case 'signin': return failed ? `Failed to sign in ${n === 1 ? '' : n + ' times '}${items[0] ? `to ${items[0]} ` : ''}${detail ? `(${detail})` : ''}`.trim() : `Signed in ${n === 1 ? '' : n + ' times '}${items[0] ? `to ${items[0]}` : ''}`.trim();
    case 'mail': {
      const v = MAIL_VERB[opKey] ?? friendlyOperation(op);
      if (opKey === 'mailitemsaccessed') return `Read ${plural(n, 'mail event')}${detail ? ` in ${detail}` : ''}${list ? ': ' + list : ''}`;
      if (opKey === 'searchqueryinitiatedexchange') return `Searched mail${list ? ' for ' + list : ''}`;
      return `${v} ${n === 1 ? 'an email' : plural(n, 'email')}${list ? ': ' + list : ''}${counterpart ? ` (mailbox ${counterpart})` : ''}`;
    }
    case 'file': { const v = FILE_VERB[opKey] ?? friendlyOperation(op); return `${v} ${n === 1 ? '' : plural(n, 'file') + ' '}${list}${detail ? ` in ${detail.split(' → ')[0]}` : ''}${counterpart ? ` → ${counterpart}` : ''}`.replace(/\s+/g, ' ').trim(); }
    case 'teams': return `${friendlyOperation(op)}${n > 1 ? ` ×${n}` : ''}${items[0] ? ` in ${items[0]}` : ''}`;
    case 'dir': return `${friendlyOperation(op)}${items[0] ? `: ${items[0]}` : ''}${detail ? ` (${detail})` : ''}${n > 1 ? ` ×${n}` : ''}`;
    case 'admin': return `${friendlyOperation(op)}${items[0] ? ` on ${items[0]}` : ''}${detail ? ` — ${detail}` : ''}${n > 1 ? ` ×${n}` : ''}`;
    case 'msg': return `Received ${list || 'an email'}${counterpart ? ` from ${counterpart}` : ''}${result ? ` (${result})` : ''}${n > 1 ? ` ×${n}` : ''}`;
    case 'msgpost': return `${op}: ${list || 'message'} ${result ? `(${result})` : ''}`;
    case 'click': return `Clicked ${list || 'a link'}${result ? ` — ${result}` : ''}`;
    case 'copilot': return `${items[0] ?? 'Copilot'} interaction${n > 1 ? ` ×${n}` : ''}${detail ? ` (${detail})` : ''}`;
    case 'risk': return `Risk detection: ${items[0] ?? op}${detail ? ` — ${detail}` : ''}`;
    default: return `${friendlyOperation(op)}${items[0] ? `: ${items[0]}` : ''}${n > 1 ? ` ×${n}` : ''}`;
  }
}

export async function buildTimeline(workspaceId: string, q: EventQuery, sevByEvent: Map<number, Severity>, showRoutine: boolean, cap = 1500): Promise<TimelineLine[]> {
  const ws = await loadWorkspace(workspaceId);
  if (!ws) return [];
  const { where, params } = compileQuery(workspaceId, q, exclusionsOf(ws));
  const rows = await query<Row>(`select e.id, e.ts, e.kind, e.operation, e.operation_key, e.user_upn, e.client_ip, e.ip_country, e.ip_owner, e.user_agent, e.item, e.detail, e.failed, e.result, e.counterpart from events e where ${where} and e.ts is not null order by e.ts asc, e.id asc limit 20000`, params);
  for (const r of rows) r.id = Number(r.id);
  const byId = new Map<number, Row>(rows.map((r) => [r.id as number, r]));
  const expectedCountries = new Set(ws.expectedCountries.map((c) => c.toUpperCase()));
  const lines: TimelineLine[] = [];
  let cur: (TimelineLine & { key: string; itemSet: Set<string> }) | null = null;
  const flush = () => { if (cur) { const { key: _k, itemSet: _s, ...rest } = cur; void _k; void _s; lines.push(rest); } cur = null; };
  for (const r of rows) {
    const opKey = r.operation_key as string, kind = r.kind as EventKind;
    const key = [opKey, r.client_ip, r.user_upn, kind === 'admin' || kind === 'dir' ? r.item : '', r.failed].join('|');
    const ts = r.ts as string;
    const sev = sevByEvent.get(r.id as number) ?? null;
    // Routine = everyday activity nothing flags: not failed, not touched by a finding, from an expected (or unknown / Microsoft) place,
    // and either a known everyday operation or a normally delivered message-trace row.
    const unexpectedPlace = !!r.ip_country && expectedCountries.size > 0 && !expectedCountries.has(String(r.ip_country).toUpperCase()) && !r.ip_owner && kind !== 'msg' && kind !== 'msgpost';
    const routine = !sev && !r.failed && !unexpectedPlace && (ROUTINE_OPERATIONS.has(opKey) || (kind === 'msg' && /deliver/i.test(String(r.result ?? ''))));
    if (!showRoutine && routine) continue;
    if (cur && cur.key === key && new Date(ts).getTime() - new Date(cur.to).getTime() <= 15 * 60000) {
      cur.to = ts; cur.count++; if (r.item) cur.itemSet.add(r.item as string); cur.eventIds.push(r.id as number);
      if (sev && (!cur.severity || SEV_RANK[sev] > SEV_RANK[cur.severity])) cur.severity = sev;
      continue;
    }
    flush();
    cur = { key, itemSet: new Set(r.item ? [r.item as string] : []), from: ts, to: ts, count: 1, sentence: '', kind, operation: r.operation as string, severity: sev, user: r.user_upn as string | null, ip: r.client_ip as string | null, ipCountry: r.ip_country as string | null, ipOwner: r.ip_owner as string | null, client: userAgentFamily(r.user_agent as string | null) || null, items: [], eventIds: [Number(r.id)], routine };
    if (lines.length >= cap) break;
  }
  flush();
  for (const l of lines) {
    const r = byId.get(l.eventIds[0])!;
    l.items = [...new Set(l.eventIds.slice(0, 50).map((id) => byId.get(id)?.item as string).filter(Boolean))].slice(0, 6);
    l.sentence = sentenceFor(l.kind, r.operation_key as string, l.operation, l.count, l.items, r.detail as string | null, !!r.failed, r.result as string | null, r.counterpart as string | null);
  }
  return lines;
}

// ---------------------------------------------------------------- email helpers

async function emailCandidates(workspaceId: string, b: SqlBuilder, extraWhere: string, limit = 25): Promise<EmailCandidate[]> {
  const rows = await query<Row>(`
    select coalesce(e.network_message_id, e.message_id) as key, min(e.item) filter (where e.kind = 'msg') as subject, min(e.counterpart) filter (where e.kind in ('msg','msgpost')) as sender,
           min(e.ts) as first_seen, count(distinct e.user_upn) filter (where e.kind = 'msg' and e.user_upn like '%@%') as recipients, array_agg(distinct e.source) as sources,
           bool_or((coalesce(e.detail,'') || ' ' || coalesce(e.result,'')) ~* 'phish|malware') as bad, bool_or((coalesce(e.detail,'') || ' ' || coalesce(e.result,'')) ~* 'zap|quarant|junk|block') as blocked
      from events e where e.workspace_id = ${b.add(workspaceId)} and e.kind in ('msg','msgpost','click','urlinfo','attachment') and coalesce(e.network_message_id, e.message_id) is not null and (${extraWhere})
     group by coalesce(e.network_message_id, e.message_id) order by bad desc, first_seen desc limit ${limit}`, b.params);
  return rows.map((r) => ({ key: r.key as string, subject: r.subject as string | null, sender: r.sender as string | null, firstSeen: r.first_seen as string | null, recipients: Number(r.recipients ?? 0), sources: (r.sources as SourceId[]) ?? [], verdict: r.bad ? 'Phishing / malware' : r.blocked ? 'Blocked or removed' : null }));
}

async function afterClickIndicators(workspaceId: string, upn: string, clickTs: string, seenCountriesBefore: Set<string>): Promise<VerdictIndicator[]> {
  const from = clickTs, to = new Date(new Date(clickTs).getTime() + 90 * 60000).toISOString();
  const rows = await query<Row>(`select e.id, e.ts, e.kind, e.operation, e.operation_key, e.failed, e.ip_country, e.ip_owner, e.client_ip, e.sensitive_family, e.item, e.detail from events e where e.workspace_id = $1 and e.user_upn = $2 and e.ts > $3 and e.ts <= $4 order by e.ts limit 2000`, [workspaceId, upn, from, to]);
  const out: VerdictIndicator[] = [];
  const fails = rows.filter((r) => r.kind === 'signin' && r.failed).length;
  const newCountry = rows.find((r) => r.kind === 'signin' && !r.failed && r.ip_country && !(r.ip_owner && r.ip_owner !== 'azure') && !seenCountriesBefore.has(r.ip_country as string));
  if (newCountry) out.push({ severity: 'high', title: `Signed in from ${countryName(newCountry.ip_country as string)} ${Math.round((new Date(newCountry.ts as string).getTime() - new Date(clickTs).getTime()) / 60000)} min after the click`, text: `First ever sign-in from ${countryName(newCountry.ip_country as string)} (${newCountry.client_ip}) right after the click — the credentials or session were likely captured.`, findingId: null, evidenceQuery: { user: upn, kind: 'signin', from, to }, ts: newCountry.ts as string });
  const sens = rows.filter((r) => r.sensitive_family);
  for (const s of sens.slice(0, 5)) out.push({ severity: 'high', title: `${friendlyOperation(s.operation as string)} ${Math.round((new Date(s.ts as string).getTime() - new Date(clickTs).getTime()) / 60000)} min after the click`, text: `${s.sensitive_family}: ${s.item ?? ''} ${s.detail ?? ''}`.trim(), findingId: null, evidenceQuery: { user: upn, sensitive: s.sensitive_family as string, from, to }, ts: s.ts as string });
  if (fails >= 3) out.push({ severity: 'medium', title: `${fails} failed sign-ins within 90 minutes of the click`, text: 'Someone tried the harvested credentials and got them wrong, or MFA stopped them.', findingId: null, evidenceQuery: { user: upn, kind: 'signin', result: 'failed', from, to }, ts: from });
  const mfa = rows.find((r) => /security info|strong authentication/i.test(r.operation as string));
  if (mfa) out.push({ severity: 'high', title: 'Sign-in method changed after the click', text: `${mfa.operation}`, findingId: null, evidenceQuery: { user: upn, from, to, q: 'op:*security info*' }, ts: mfa.ts as string });
  return out;
}

export async function investigateEmail(workspaceId: string, key: string): Promise<EmailInvestigation | null> {
  const k = key.replace(/^<|>$/g, '').toLowerCase();
  const evs = await query<Row>(`select e.id, e.ts, e.kind, e.source, e.operation, e.user_upn, e.counterpart, e.item, e.detail, e.result, e.client_ip, e.ip_country, e.user_agent, e.message_id, e.network_message_id, e.failed from events e where e.workspace_id = $1 and (e.network_message_id = $2 or e.message_id = $2) order by e.ts limit 5000`, [workspaceId, k]);
  if (!evs.length) return null;
  const msgs = evs.filter((e) => e.kind === 'msg');
  const subject = (msgs.find((m) => m.item)?.item as string) ?? null;
  const sender = (msgs.find((m) => m.counterpart)?.counterpart as string) ?? (evs.find((m) => m.counterpart)?.counterpart as string) ?? null;
  const mid = (evs.find((e) => e.message_id)?.message_id as string) ?? null;
  const nmid = (evs.find((e) => e.network_message_id)?.network_message_id as string) ?? null;
  const firstSeen = (evs[0].ts as string) ?? null;
  const verdictTxt = msgs.map((m) => `${m.detail ?? ''} ${m.result ?? ''}`).join(' ');
  const verdict = /phish/i.test(verdictTxt) ? 'Phishing' : /malware/i.test(verdictTxt) ? 'Malware' : /spam|junk/i.test(verdictTxt) ? 'Spam / junk' : null;
  const urls = uniq(evs.filter((e) => e.kind === 'urlinfo' || e.kind === 'click').map((e) => e.item as string).filter(Boolean));
  const recipientsSet = uniq(msgs.map((m) => m.user_upn as string).filter((u) => u && u.includes('@'))); // drops Purview's 'ThreatIntel' pseudo-user
  const clicksAll = evs.filter((e) => e.kind === 'click');
  // also clicks by URL (Safe Links records without a message id)
  const extraClicks = urls.length ? await query<Row>(`select e.id, e.ts, e.user_upn, e.item, e.result, e.client_ip, e.ip_country from events e where e.workspace_id = $1 and e.kind = 'click' and e.item = any($2::text[]) and e.ts >= $3::timestamptz - interval '1 hour' and (e.network_message_id is null or e.network_message_id <> $4) limit 2000`, [workspaceId, urls, firstSeen, nmid ?? '']) : [];
  const clicks = [...clicksAll, ...extraClicks];
  const recipients: EmailRecipient[] = [];
  const baseSubject = (subject ?? '').replace(/^((re|sv|fw|fwd|vs|aw|wg|tr|antw|ref)\s*:\s*)+/i, '').trim();
  const openedRows = mid && recipientsSet.length ? await query<Row>(`select e.user_upn, min(e.ts) as first, count(*)::int as cnt, array_agg(distinct e.user_agent) as uas from events e where e.workspace_id = $1 and e.kind = 'mail' and e.user_upn = any($2::text[]) and e.raw::text ilike $3 group by e.user_upn`, [workspaceId, recipientsSet, `%${mid}%`]) : [];
  const replyRows = baseSubject && recipientsSet.length ? await query<Row>(`select e.user_upn, e.ts, e.item from events e where e.workspace_id = $1 and e.kind = 'mail' and e.operation_key in ('send','sendas','sendonbehalf') and e.user_upn = any($2::text[]) and e.ts > $3 and e.item ~* $4 and e.item ilike $5 order by e.ts limit 200`, [workspaceId, recipientsSet, firstSeen, '^(re|sv|fw|fwd|vs|aw|wg|tr|antw|ref)\\s*:', `%${baseSubject.slice(0, 60)}%`]) : [];
  let atRisk = 0, clickedThrough = 0;
  const levels = await verdictLevels(workspaceId, recipientsSet);
  for (const upn of recipientsSet) {
    const mine = msgs.filter((m) => m.user_upn === upn);
    const last = mine[mine.length - 1];
    const post = evs.filter((e) => e.kind === 'msgpost' && e.user_upn === upn);
    const myClicks = clicks.filter((c) => c.user_upn === upn).map((c) => ({ ts: c.ts as string, result: c.result as string | null, url: c.item as string | null, ip: c.client_ip as string | null, country: c.ip_country as string | null }));
    const opened = openedRows.find((o) => o.user_upn === upn);
    const after: VerdictIndicator[] = [];
    if (myClicks.length) {
      const before = new Set((await query<{ c: string }>(`select distinct e.ip_country as c from events e where e.workspace_id = $1 and e.user_upn = $2 and e.kind = 'signin' and not e.failed and e.ip_country is not null and e.ts < $3`, [workspaceId, upn, myClicks[0].ts])).map((r) => r.c));
      after.push(...(await afterClickIndicators(workspaceId, upn, myClicks[0].ts, before)));
    }
    const thru = myClicks.some((c) => /through|allowed/i.test(c.result ?? '') && !/^blocked$/i.test(c.result ?? ''));
    if (thru) clickedThrough++;
    const verdictLevel = levels.get(upn.toLowerCase())?.level ?? null;
    const compromised = after.some((a) => a.severity === 'high') || verdictLevel === 'compromised';
    if (compromised) atRisk++;
    const risk: EmailRecipient['risk'] = compromised ? 'high' : thru && verdict ? 'high' : myClicks.length ? 'medium' : opened ? 'low' : 'none';
    recipients.push({
      upn, delivery: (last?.result as string) ?? null, deliveryLocation: (last?.detail as string) ?? null,
      opened: opened ? { first: opened.first as string, count: opened.cnt as number, clients: uniq(((opened.uas as string[]) ?? []).map((u) => userAgentFamily(u)).filter(Boolean)) } : null,
      clicks: myClicks, postDelivery: post.length ? `${post[post.length - 1].operation}: ${post[post.length - 1].result ?? ''}`.trim() : null,
      repliedOrForwarded: replyRows.filter((r) => r.user_upn === upn).map((r) => ({ ts: r.ts as string, subject: r.item as string })),
      afterClick: after, risk, verdictLevel,
    });
  }
  recipients.sort((a, b) => ({ high: 0, medium: 1, low: 2, none: 3 })[a.risk] - ({ high: 0, medium: 1, low: 2, none: 3 })[b.risk]);
  const nonRecipientClicks = clicks.filter((c) => c.user_upn && !recipientsSet.includes(c.user_upn as string)).map((c) => ({ upn: c.user_upn as string, ts: c.ts as string, result: c.result as string | null }));
  const delivered = recipients.filter((r) => /deliver/i.test(r.delivery ?? '')).length;
  const undelivered = recipients.filter((r) => r.delivery && !/deliver/i.test(r.delivery)).length;
  const zapped = recipients.filter((r) => r.postDelivery).length;
  const opened = recipients.filter((r) => r.opened).length;
  const clicked = recipients.filter((r) => r.clicks.length).length;
  const replied = recipients.filter((r) => r.repliedOrForwarded.length).length;
  const headline = `${verdict ? `${verdict} per Defender` : 'No Defender verdict'} · ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}, ${clicked} clicked${clickedThrough ? ` (${clickedThrough} through a warning)` : ''}${zapped ? `, ${zapped} removed by ZAP` : ''}${atRisk ? ` · ${atRisk} show${atRisk === 1 ? 's' : ''} signs of compromise afterwards` : clicked ? ' · no sign of compromise after the clicks' : ''}`;
  return {
    key: k, subject, sender, senderIp: (msgs.find((m) => m.client_ip)?.client_ip as string) ?? null, firstSeen, messageId: mid, networkMessageId: nmid, verdict,
    sources: uniq(evs.map((e) => e.source as SourceId)), urls, recipients,
    summary: { recipients: recipients.length, delivered, undelivered, zapped, opened, clicked, clickedThrough, replied, atRisk }, nonRecipientClicks, headline,
  };
}

async function verdictLevels(workspaceId: string, upns: string[]): Promise<Map<string, { level: VerdictLevel; findings: number }>> {
  const out = new Map<string, { level: VerdictLevel; findings: number }>();
  if (!upns.length) return out;
  const lower = upns.map((u) => u.toLowerCase());
  const rows = await query<Row>(`select * from findings f where f.workspace_id = $1 and f.status <> 'dismissed' and f.users && $2::text[]`, [workspaceId, lower]);
  const all = rows.map(toFinding);
  for (const u of lower) {
    const mine = all.filter((f) => f.users.some((x) => x.toLowerCase() === u));
    if (!mine.length) continue;
    const own = mine.filter((f) => isOwnFinding(f, u));
    out.set(u, { level: levelFrom(own, true), findings: own.length });
  }
  return out;
}

// ---------------------------------------------------------------- routes

export async function investigateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth());

  app.get('/workspaces/:id/findings', async (req) => {
    const { id } = req.params as { id: string };
    const q = z.object({ status: z.string().optional(), severity: z.string().optional(), user: z.string().optional(), signal: z.string().optional() }).parse(req.query);
    const b = new SqlBuilder();
    const w = [`workspace_id = ${b.add(id)}`];
    w.push(q.status ? `status = any(${b.add(q.status.split(','))}::text[])` : `status <> 'dismissed'`);
    if (q.severity) w.push(`severity = any(${b.add(q.severity.split(','))}::text[])`);
    if (q.user) w.push(`users @> array[${b.add(q.user.toLowerCase())}]::text[]`);
    if (q.signal) w.push(`signal = any(${b.add(q.signal.split(','))}::text[])`);
    const items = (await query<Row>(`select * from findings where ${w.join(' and ')} order by case severity when 'high' then 0 when 'medium' then 1 else 2 end, event_count desc limit 1000`, b.params)).map(toFinding);
    const run = await one<Row>('select * from signal_runs where workspace_id = $1', [id]);
    const counts = await one<{ high: number; medium: number; low: number; dismissed: number }>(`select count(*) filter (where severity='high' and status<>'dismissed')::int as high, count(*) filter (where severity='medium' and status<>'dismissed')::int as medium, count(*) filter (where severity='low' and status<>'dismissed')::int as low, count(*) filter (where status='dismissed')::int as dismissed from findings where workspace_id = $1`, [id]);
    return { items, lastRun: run ? camel<SignalRun>(run) : null, counts };
  });

  app.post('/workspaces/:id/findings/recompute', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await loadWorkspace(id))) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const r = await runSignals(id);
    return r.findings < 0 ? { ok: true, message: 'Already running.' } : { ok: true, ...r };
  });

  app.patch('/findings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ status: z.enum(['open', 'dismissed', 'confirmed']).optional(), note: z.string().max(5000).nullable().optional() }).parse(req.body);
    const r = await one<Row>(`update findings set status = coalesce($2, status), note = case when $3::text is null and $4::boolean then note else $3 end where id = $1 returning *`, [id, b.status ?? null, b.note ?? null, b.note === undefined]);
    if (!r) return reply.code(404).send({ error: 'not_found', message: 'Finding not found.' });
    return toFinding(r);
  });

  /** Type-ahead for the Investigate search box: users, IPs, emails, URLs. */
  app.get('/workspaces/:id/investigate/resolve', async (req) => {
    const { id } = req.params as { id: string };
    const { q } = z.object({ q: z.string().min(1).max(200) }).parse(req.query);
    const t = q.trim();
    const isIp = /^[\d.]+$|^[0-9a-f:]+$/i.test(t) && /[.:]/.test(t);
    const b = new SqlBuilder();
    const words = t.split(/[\s@./:_\-\\,;()\[\]{}"'<>=]+/).filter((w) => w.length >= 2).map((w) => `'${w.replace(/[':&|!*]/g, '')}':*`).join(' & ');
    const [users, ips, emails, urls] = await Promise.all([
      query<Row>(`select upn, events from identities where workspace_id = $1 and upn ilike $2 order by events desc limit 8`, [id, `%${t}%`]),
      isIp ? query<Row>(`select e.client_ip as ip, count(*)::int as events, min(e.ip_country) as country, min(e.ip_owner) as owner from events e where e.workspace_id = $1 and e.client_ip like $2 group by e.client_ip order by events desc limit 8`, [id, `${t}%`]) : Promise.resolve([] as Row[]),
      words ? emailCandidates(id, b, `(e.search @@ to_tsquery('simple', ${b.add(words)}) or coalesce(e.network_message_id, e.message_id) = ${b.add(t.replace(/^<|>$/g, '').toLowerCase())})`, 8) : Promise.resolve([] as EmailCandidate[]),
      t.length >= 4 ? query<Row>(`select e.item as url, count(*)::int as clicks from events e where e.workspace_id = $1 and e.kind in ('click','urlinfo') and e.item ilike $2 group by e.item order by clicks desc limit 8`, [id, `%${t}%`]) : Promise.resolve([] as Row[]),
    ]);
    const levels = await verdictLevels(id, users.map((u) => u.upn as string));
    const res: ResolveResult = {
      users: users.map((u) => ({ upn: u.upn as string, events: u.events as number, verdictLevel: levels.get(u.upn as string)?.level ?? null, findings: levels.get(u.upn as string)?.findings ?? 0 })),
      ips: ips.map((r) => ({ ip: r.ip as string, events: r.events as number, country: r.country as string | null, owner: r.owner as string | null })),
      emails, urls: urls.map((r) => ({ url: r.url as string, clicks: r.clicks as number })),
    };
    return res;
  });

  /** Verdict + story for one user. */
  app.get('/workspaces/:id/investigate/user/:upn', async (req, reply) => {
    const { id, upn: raw } = req.params as { id: string; upn: string };
    const upn = decodeURIComponent(raw).toLowerCase();
    const ws = await loadWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const [person, findings, sourcesRow] = await Promise.all([
      personDetail(id, upn, {}).catch(() => null),
      findingsFor(id, { user: upn }),
      one<{ sources: SourceId[]; from: string | null; to: string | null }>(`select coalesce(array_agg(distinct source), '{}') as sources, min(ts) as from, max(ts) as to from events where workspace_id = $1`, [id]),
    ]);
    if (!person) return reply.code(404).send({ error: 'not_found', message: 'No activity for this person.' });
    const hasSignIns = person.signIns > 0;
    const verdict = verdictFrom(findings, upn, hasSignIns, blindSpotsFor(sourcesRow?.sources ?? [], hasSignIns));

    // story: first/last seen, findings, first sign-in per country, sensitive operations, phishing clicks
    const moments: StoryMoment[] = [];
    if (person.firstSeen) moments.push({ ts: person.firstSeen, severity: 'info', kind: 'first', sentence: 'First activity in the imported data', detail: null, eventId: null, findingId: null, evidenceQuery: null });
    for (const f of findings.filter((f) => f.status !== 'dismissed')) {
      if (!f.firstTs) continue;
      if (isOwnFinding(f, upn)) { moments.push({ ts: f.firstTs, severity: f.severity, kind: 'finding', sentence: f.title, detail: f.text, eventId: f.eventIds[0] != null ? Number(f.eventIds[0]) : null, findingId: f.id, evidenceQuery: f.evidenceQuery }); continue; }
      // Attacker-level finding: this account is one of many targets, so narrate it as exposure, not behaviour.
      const src = f.entityType === 'ip' && f.entityValue ? ` from ${f.entityValue}` : '';
      moments.push({ ts: f.firstTs, severity: 'low', kind: 'targeted', sentence: `Targeted, not necessarily affected: ${f.title}${/from|active from/i.test(f.title) ? '' : src} — one of ${f.users.length} accounts`, detail: f.text, eventId: null, findingId: f.id, evidenceQuery: f.evidenceQuery ? { ...f.evidenceQuery, user: upn } : null });
    }
    const { where, params } = compileQuery(id, { user: upn }, exclusionsOf(ws));
    const firstPerCountry = await query<Row>(`select distinct on (e.ip_country) e.ip_country, e.ts, e.id, e.client_ip, e.item, (select count(*)::int from events x where x.workspace_id = e.workspace_id and x.user_upn = e.user_upn and x.kind = 'signin' and x.ip_country = e.ip_country) as total from events e where ${where} and e.kind = 'signin' and not e.failed and e.ip_country is not null and (e.ip_owner is null or e.ip_owner = 'azure') order by e.ip_country, e.ts asc`, params);
    const expected = new Set(ws.expectedCountries.map((c) => c.toUpperCase()));
    for (const r of firstPerCountry) {
      const cc = r.ip_country as string;
      moments.push({ ts: r.ts as string, severity: expected.size && !expected.has(cc) ? 'medium' : 'info', kind: 'country', sentence: `First sign-in from ${countryName(cc)} (${r.client_ip})${r.item ? ` to ${r.item}` : ''}`, detail: `${r.total} sign-in${(r.total as number) === 1 ? '' : 's'} from ${countryName(cc)} in total${expected.size && !expected.has(cc) ? ' — not an expected country for this customer' : ''}`, eventId: Number(r.id), findingId: null, evidenceQuery: { user: upn, country: cc, kind: 'signin' } });
    }
    const sens = await query<Row>(`select e.id, e.ts, e.operation, e.item, e.detail, e.client_ip, e.ip_country, e.sensitive_family from events e where ${where} and e.sensitive_family is not null order by e.ts limit 60`, params);
    for (const r of sens) moments.push({ ts: r.ts as string, severity: 'medium', kind: 'sensitive', sentence: `${friendlyOperation(r.operation as string)}${r.item && String(r.item).replace(/[\s.]/g, '') ? `: ${r.item}` : ''}`, detail: [r.sensitive_family, r.detail, r.client_ip ? `from ${r.client_ip}${r.ip_country ? ` (${r.ip_country})` : ''}` : null].filter(Boolean).join(' · '), eventId: Number(r.id), findingId: null, evidenceQuery: { user: upn, sensitive: r.sensitive_family as string } });
    const clicks = await query<Row>(`select e.id, e.ts, e.item, e.result, e.client_ip from events e where ${where} and e.kind = 'click' order by e.ts limit 40`, params);
    for (const r of clicks) moments.push({ ts: r.ts as string, severity: /through|allowed/i.test(String(r.result ?? '')) ? 'medium' : 'info', kind: 'click', sentence: `Clicked a link: ${String(r.item ?? '').slice(0, 80)}`, detail: `${r.result ?? ''}${r.client_ip ? ` · from ${r.client_ip}` : ''}`.trim() || null, eventId: Number(r.id), findingId: null, evidenceQuery: { user: upn, kind: 'click' } });
    if (person.lastSeen && person.lastSeen !== person.firstSeen) moments.push({ ts: person.lastSeen, severity: 'info', kind: 'last', sentence: 'Last activity in the imported data', detail: null, eventId: null, findingId: null, evidenceQuery: null });
    moments.sort((a, b) => a.ts.localeCompare(b.ts));

    const phish = await one<{ clicks: number; flagged: number; phish: number; zapped: number }>(`
      select count(*) filter (where e.kind = 'click')::int as clicks,
             count(*) filter (where e.kind = 'click' and e.result ~* 'through|allowed' and e.result !~* '^blocked$')::int as flagged,
             count(*) filter (where e.kind = 'msg' and (coalesce(e.detail,'') || ' ' || coalesce(e.result,'')) ~* 'phish|malware')::int as phish,
             count(*) filter (where e.kind = 'msgpost')::int as zapped
        from events e where ${where}`, params);
    const out: UserInvestigation = {
      upn, person, verdict, story: moments.slice(0, 300), findings,
      phishing: phish ? { clicks: phish.clicks, flaggedClicks: phish.flagged, phishMailReceived: phish.phish, zapped: phish.zapped } : null,
      dataWindow: { from: sourcesRow?.from ?? null, to: sourcesRow?.to ?? null, sources: sourcesRow?.sources ?? [] },
    };
    return out;
  });

  /** Grouped, human-readable timeline for a user (or any EventQuery). */
  app.get('/workspaces/:id/investigate/timeline', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = z.object({ user: z.string().optional(), ip: z.string().optional(), session: z.string().optional(), from: z.string().optional(), to: z.string().optional(), routine: z.enum(['0', '1']).default('0'), q: z.string().optional() }).parse(req.query);
    if (!q.user && !q.ip && !q.session && !q.q) return reply.code(400).send({ error: 'scope', message: 'Give a user, ip, session or q.' });
    const findings = q.user ? await findingsFor(id, { user: q.user }) : q.ip ? await findingsFor(id, { ip: q.ip }) : [];
    const sev = new Map<number, Severity>();
    for (const f of findings) if (f.status !== 'dismissed') for (const e of f.eventIds) { const cur = sev.get(e); if (!cur || SEV_RANK[f.severity] > SEV_RANK[cur]) sev.set(e, f.severity); }
    const lines = await buildTimeline(id, { user: q.user, ip: q.ip, session: q.session, from: q.from, to: q.to, q: q.q }, sev, q.routine === '1');
    return { lines, truncated: lines.length >= 1500 };
  });

  app.get('/workspaces/:id/investigate/email', async (req) => {
    const { id } = req.params as { id: string };
    const { q } = z.object({ q: z.string().min(2).max(300) }).parse(req.query);
    const b = new SqlBuilder();
    const t = q.trim();
    const words = t.split(/[\s@./:_\-\\,;()\[\]{}"'<>=]+/).filter((w) => w.length >= 2).map((w) => `'${w.replace(/[':&|!*]/g, '')}':*`).join(' & ');
    const where = `(coalesce(e.network_message_id, e.message_id) = ${b.add(t.replace(/^<|>$/g, '').toLowerCase())} or e.item ilike ${b.add('%' + t + '%')} or e.counterpart ilike ${b.add('%' + t + '%')}${words ? ` or e.search @@ to_tsquery('simple', ${b.add(words)})` : ''})`;
    return { items: await emailCandidates(id, b, where, 30) };
  });

  app.get('/workspaces/:id/investigate/email/:key', async (req, reply) => {
    const { id, key } = req.params as { id: string; key: string };
    const r = await investigateEmail(id, decodeURIComponent(key));
    if (!r) return reply.code(404).send({ error: 'not_found', message: 'No events carry that message id.' });
    return r;
  });

  app.get('/workspaces/:id/investigate/url', async (req) => {
    const { id } = req.params as { id: string };
    const { q } = z.object({ q: z.string().min(3).max(500) }).parse(req.query);
    const t = q.trim().replace(/^https?:\/\//i, '');
    const rows = await query<Row>(`select e.id, e.ts, e.kind, e.user_upn, e.item, e.result, e.client_ip, e.ip_country, e.network_message_id from events e where e.workspace_id = $1 and e.kind in ('click','urlinfo') and e.item ilike $2 order by e.ts limit 5000`, [id, `%${t}%`]);
    const nmids = uniq(rows.map((r) => r.network_message_id as string).filter(Boolean));
    const b = new SqlBuilder();
    const emails = nmids.length ? await emailCandidates(id, b, `coalesce(e.network_message_id, e.message_id) = any(${b.add(nmids)}::text[])`, 50) : [];
    const clicks = rows.filter((r) => r.kind === 'click');
    const byUser = new Map<string, { clicks: number; thru: boolean }>();
    for (const c of clicks) { const u = c.user_upn as string; if (!u) continue; const cur = byUser.get(u) ?? { clicks: 0, thru: false }; cur.clicks++; if (/through|allowed/i.test(String(c.result ?? ''))) cur.thru = true; byUser.set(u, cur); }
    const levels = await verdictLevels(id, [...byUser.keys()]);
    const res: UrlInvestigation = {
      query: q, emails,
      clicks: clicks.map((c) => ({ ts: c.ts as string, upn: c.user_upn as string, url: c.item as string, result: c.result as string | null, ip: c.client_ip as string | null, country: c.ip_country as string | null, networkMessageId: c.network_message_id as string | null })),
      users: [...byUser].map(([upn, v]) => ({ upn, clicks: v.clicks, clickedThrough: v.thru, verdictLevel: levels.get(upn)?.level ?? null })).sort((a, b) => Number(b.clickedThrough) - Number(a.clickedThrough) || b.clicks - a.clicks),
    };
    return res;
  });

  app.get('/workspaces/:id/investigate/ip/:ip', async (req, reply) => {
    const { id, ip: raw } = req.params as { id: string; ip: string };
    const ip = decodeURIComponent(raw);
    const ws = await loadWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const b = new SqlBuilder();
    let where = `e.workspace_id = ${b.add(id)} and e.client_ip = ${b.add(ip)}`;
    void exclusionSql; // exclusions intentionally NOT applied: the analyst asked about this IP explicitly
    const [agg, users, ops, clients, findings] = await Promise.all([
      one<Row>(`select count(*)::int as events, count(*) filter (where e.failed)::int as failed, min(e.ts) as first_seen, max(e.ts) as last_seen, min(e.ip_country) as country, min(e.ip_owner) as owner, min(e.ip_owner_name) as owner_name from events e where ${where}`, b.params),
      query<Row>(`select e.user_upn as upn, count(*)::int as events, count(*) filter (where e.failed)::int as failed, count(*) filter (where e.kind = 'signin' and not e.failed)::int as ok, min(e.ts) as first_seen, max(e.ts) as last_seen from events e where ${where} and e.user_upn is not null group by e.user_upn order by events desc limit 100`, b.params),
      query<FacetBucket>(`select e.operation as value, count(*)::int as count from events e where ${where} group by 1 order by 2 desc limit 15`, b.params),
      query<Row>(`select e.user_agent as ua, count(*)::int as count from events e where ${where} and e.user_agent is not null group by 1 order by 2 desc limit 50`, b.params),
      findingsFor(id, { ip }),
    ]);
    if (!agg || !(agg.events as number)) return reply.code(404).send({ error: 'not_found', message: 'No events from that address.' });
    const fam = new Map<string, number>();
    for (const c of clients) { const f = userAgentFamily(c.ua as string) || (c.ua as string); fam.set(f, (fam.get(f) ?? 0) + (c.count as number)); }
    const owner = agg.owner as IpOwnerCategory | null;
    const headline = `${ip} · ${owner ? `${OWNER_LABEL[owner]}${agg.owner_name ? ` (${agg.owner_name})` : ''}` : agg.country ? countryName(agg.country as string) : 'unknown location'} · ${users.length} account${users.length === 1 ? '' : 's'}, ${agg.failed} failed event${(agg.failed as number) === 1 ? '' : 's'}${findings.length ? ` · ${findings.length} finding${findings.length === 1 ? '' : 's'}` : ''}`;
    const res: IpInvestigation = {
      ip, country: agg.country as string | null, countryName: agg.country ? countryName(agg.country as string) : null, owner, ownerName: agg.owner_name as string | null,
      events: agg.events as number, failed: agg.failed as number, firstSeen: agg.first_seen as string | null, lastSeen: agg.last_seen as string | null,
      users: users.map((u) => ({ upn: u.upn as string, events: u.events as number, failed: u.failed as number, succeededSignIns: u.ok as number, firstSeen: u.first_seen as string, lastSeen: u.last_seen as string })),
      operations: ops.map((o) => ({ ...o, label: friendlyOperation(o.value) })), clients: [...fam].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
      findings, headline,
    };
    return res;
  });

  void SOURCES;
}
