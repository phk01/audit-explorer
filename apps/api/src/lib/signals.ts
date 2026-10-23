/**
 * Detections ("signals"): the investigative heuristics of the original Audit Log Analyser, rebuilt server-side.
 * Each signal inspects a workspace's events (IP exclusions applied) and emits findings with severity, a plain
 * explanation, facts and the evidence (event ids + a reproducible EventQuery). Findings are recomputed after
 * every import; analyst status (dismissed / confirmed) and notes survive recomputes via the fingerprint.
 */
import type { Workspace, EventQuery } from '@audit/core';
import { SCRIPTED_UA_RX, userAgentFamily, friendlyOperation } from '@audit/core';
import { countryDistanceKm, countryName, networkKey } from '@audit/ipdata';
import { query, withTx } from './db.js';
import { SqlBuilder, exclusionSql } from './search.js';
import { loadWorkspace, exclusionsOf } from './workspace.js';

export type Severity = 'high' | 'medium' | 'low';

export interface Thresholds { fail: number; spray: number; dl: number; del: number; mia: number; nets: number }
export const DEFAULT_THRESHOLDS: Thresholds = { fail: 10, spray: 5, dl: 100, del: 50, mia: 300, nets: 3 };

export interface FindingDraft {
  signal: string;
  fingerprint: string;
  severity: Severity;
  category: string;
  title: string;
  text: string;
  facts: [string, string][];
  entityType: 'user' | 'ip' | 'session' | 'message' | 'app' | null;
  entityValue: string | null;
  users: string[];
  eventIds: number[];
  eventCount: number;
  evidenceQuery: EventQuery | null;
  firstTs: string | null;
  lastTs: string | null;
}

interface Ctx {
  ws: Workspace;
  thr: Thresholds;
  tenantDomains: Set<string>;
  /** fresh builder + base WHERE (workspace + exclusions) for each query */
  base: () => { b: SqlBuilder; where: string };
}

const fmtPeriod = (a: string | null, b: string | null) => a && b ? `${a.slice(0, 16).replace('T', ' ')} → ${b.slice(0, 16).replace('T', ' ')} UTC` : '';
const n = (x: number) => x.toLocaleString('en-GB');
const uniq = <T>(a: T[]) => [...new Set(a)];
const isExternal = (addr: string | null | undefined, ctx: Ctx) => {
  if (!addr) return false;
  const a = addr.toLowerCase().replace(/^smtp:/, '');
  if (a.includes('#ext#')) return true;
  const dom = a.split('@')[1];
  return !!dom && ctx.tenantDomains.size > 0 && !ctx.tenantDomains.has(dom);
};

type Row = Record<string, unknown>;
const ids = (rows: Row[], key = 'ids') => uniq(rows.flatMap((r) => (r[key] as number[]) ?? [])).slice(0, 500);

// ---------------------------------------------------------------- signals

async function brute(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`
    with f as (
      select e.user_upn, count(*)::int as fails, min(e.ts) as first_ts, max(e.ts) as last_ts,
             array_agg(distinct e.client_ip) filter (where e.client_ip is not null) as ips,
             array_agg(distinct coalesce(e.detail, '')) as errs,
             (array_agg(e.id order by e.ts))[1:500] as ids
        from events e where ${where} and e.kind = 'signin' and e.failed and e.user_upn is not null
       group by e.user_upn having count(*) >= ${b.add(ctx.thr.fail)})
    select f.*, (select count(*)::int from events s where s.workspace_id = ${b.add(ctx.ws.id)} and s.kind = 'signin' and not s.failed and s.user_upn = f.user_upn
                   and s.client_ip = any(f.ips) and s.ts between f.first_ts and f.last_ts + interval '1 hour') as successes
      from f order by fails desc limit 200`, b.params);
  for (const r of rows) {
    const user = r.user_upn as string, successes = r.successes as number;
    out.push({
      signal: 'brute', fingerprint: `brute|${user}`, severity: successes ? 'high' : 'medium', category: 'Identity',
      title: successes ? 'Failed sign-ins followed by success' : 'Repeated failed sign-ins',
      text: successes ? `${n(r.fails as number)} failed sign-ins for ${user}, then ${successes} successful sign-in${successes === 1 ? '' : 's'} from the same address within an hour. Treat the account as compromised until proven otherwise.` : `${n(r.fails as number)} failed sign-ins for ${user} from ${(r.ips as string[] | null)?.length ?? 0} address(es). No success from those addresses was seen.`,
      facts: [['User', user], ['Failures', n(r.fails as number)], ['Successes after', String(successes)], ['Source IPs', ((r.ips as string[]) ?? []).slice(0, 8).join(', ')], ['Errors', ((r.errs as string[]) ?? []).filter(Boolean).slice(0, 3).join(' | ')], ['Period', fmtPeriod(r.first_ts as string, r.last_ts as string)]],
      entityType: 'user', entityValue: user, users: [user], eventIds: r.ids as number[], eventCount: r.fails as number,
      evidenceQuery: { user, kind: 'signin', from: r.first_ts as string, to: new Date(new Date(r.last_ts as string).getTime() + 3600_000).toISOString() },
      firstTs: r.first_ts as string, lastTs: r.last_ts as string,
    });
  }
}

async function spray(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`
    select e.client_ip, count(distinct e.user_upn)::int as users, count(*)::int as attempts, min(e.ts) as first_ts, max(e.ts) as last_ts,
           array_agg(distinct e.user_upn) as upns, array_agg(distinct coalesce(e.user_agent, '')) as uas, (array_agg(e.id order by e.ts))[1:500] as ids
      from events e where ${where} and e.kind = 'signin' and e.failed and e.client_ip is not null and e.user_upn is not null
     group by e.client_ip having count(distinct e.user_upn) >= ${b.add(ctx.thr.spray)} order by users desc limit 100`, b.params);
  for (const r of rows) {
    const ip = r.client_ip as string;
    out.push({
      signal: 'spray', fingerprint: `spray|${ip}`, severity: 'high', category: 'Identity', title: 'Password spray',
      text: `${ip} tried to sign in to ${r.users} different accounts (${n(r.attempts as number)} attempts). Check whether any of those accounts later signed in successfully from this address.`,
      facts: [['Source IP', ip], ['Accounts targeted', String(r.users)], ['Attempts', n(r.attempts as number)], ['User agents', uniq(((r.uas as string[]) ?? []).map((u) => userAgentFamily(u)).filter(Boolean)).slice(0, 4).join(', ')], ['Period', fmtPeriod(r.first_ts as string, r.last_ts as string)]],
      entityType: 'ip', entityValue: ip, users: (r.upns as string[]) ?? [], eventIds: r.ids as number[], eventCount: r.attempts as number,
      evidenceQuery: { ip, kind: 'signin', result: 'failed' }, firstTs: r.first_ts as string, lastTs: r.last_ts as string,
    });
  }
}

const prop = (raw: Row, ...path: string[]): string | null => {
  let cur: unknown = raw;
  for (const seg of path) {
    if (cur == null) return null;
    if (Array.isArray(cur)) {
      const hit = cur.find((x) => x && typeof x === 'object' && String((x as Row).Name ?? '').toLowerCase() === seg.toLowerCase());
      cur = hit ? (hit as Row).Value : undefined;
    } else if (typeof cur === 'object') {
      const o = cur as Row;
      const k = Object.keys(o).find((x) => x.toLowerCase() === seg.toLowerCase());
      cur = k ? o[k] : undefined;
    } else return null;
  }
  return cur == null ? null : typeof cur === 'string' ? cur : JSON.stringify(cur);
};

async function inboxRules(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`select e.id, e.ts, e.user_upn, e.client_ip, e.operation_key, e.raw from events e where ${where} and e.operation_key in ('new-inboxrule','set-inboxrule','enable-inboxrule','updateinboxrules') and e.user_upn is not null order by e.ts limit 5000`, b.params);
  const byUser = new Map<string, Row[]>();
  for (const r of rows) byUser.set(r.user_upn as string, [...(byUser.get(r.user_upn as string) ?? []), r]);
  for (const [user, evs] of byUser) {
    const flags = new Set<string>(), names: string[] = [], fwd: string[] = [], ipsSeen: string[] = [];
    for (const e of evs) {
      const raw = e.raw as Row;
      const P = (k: string) => prop(raw, 'Parameters', k);
      const f = P('ForwardTo') ?? P('RedirectTo') ?? P('ForwardAsAttachmentTo');
      if (f) { flags.add('forwards mail'); fwd.push(f.replace(/^smtp:/i, '')); }
      if (/true/i.test(P('DeleteMessage') ?? '')) flags.add('deletes mail');
      if (/true/i.test(P('MarkAsRead') ?? '')) flags.add('marks as read');
      const mv = P('MoveToFolder');
      if (mv && /rss|archive|conversation history|deleted|junk|notes/i.test(mv)) flags.add(`hides mail in "${mv}"`);
      const name = P('Name') ?? P('Identity');
      if (name) { names.push(name); if (/^[\W_]{0,3}$/.test(name.trim())) flags.add('blank or symbol-only rule name'); }
      if (e.operation_key === 'updateinboxrules') { const t = JSON.stringify(raw); if (/forward|redirect/i.test(t)) flags.add('forwards mail (client rule)'); if (/deletemessage|"delete"/i.test(t)) flags.add('deletes mail (client rule)'); }
      if (e.client_ip) ipsSeen.push(e.client_ip as string);
    }
    const external = fwd.some((a) => isExternal(a, ctx));
    const sev: Severity = flags.size ? 'high' : 'low';
    out.push({
      signal: 'rule', fingerprint: `rule|${user}`, severity: sev, category: 'Mailbox',
      title: flags.size ? `Suspicious inbox rule${external ? ' forwarding to an external address' : ''}` : 'Inbox rule created or changed',
      text: flags.size ? `${user} created or changed ${evs.length} inbox rule${evs.length === 1 ? '' : 's'} that ${[...flags].join(', ')}. Attackers use rules like this to hide replies and keep access after a password reset.` : `${user} created or changed ${evs.length} inbox rule${evs.length === 1 ? '' : 's'}; nothing suspicious in the parameters.`,
      facts: [['Mailbox', user], ['Rule names', uniq(names).slice(0, 5).join(', ') || '—'], ['Forwards to', uniq(fwd).join(', ') || '—'], ['Client IPs', uniq(ipsSeen).slice(0, 5).join(', ') || '—'], ['Period', fmtPeriod(evs[0].ts as string, evs[evs.length - 1].ts as string)]],
      entityType: 'user', entityValue: user, users: [user], eventIds: evs.map((e) => e.id as number).slice(0, 500), eventCount: evs.length,
      evidenceQuery: { user, q: 'op:new-inboxrule OR op:set-inboxrule OR op:enable-inboxrule OR op:updateinboxrules' }, firstTs: evs[0].ts as string, lastTs: evs[evs.length - 1].ts as string,
    });
  }
}

async function forwarding(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`select e.id, e.ts, e.user_upn, e.client_ip, e.operation, e.raw from events e where ${where} and e.operation_key in ('set-mailbox','new-transportrule','set-transportrule') order by e.ts limit 5000`, b.params);
  const byUser = new Map<string, { evs: Row[]; dests: string[] }>();
  for (const r of rows) {
    const raw = r.raw as Row;
    const dests = ['ForwardingSmtpAddress', 'ForwardingAddress', 'RedirectMessageTo', 'BlindCopyTo', 'AddToRecipients', 'CopyTo'].map((k) => prop(raw, 'Parameters', k)).filter((v): v is string => !!v && !/^\$null$/i.test(v) && v !== '[]' && v.trim() !== '');
    if (!dests.length) continue;
    const u = (r.user_upn as string) ?? 'unknown';
    const cur = byUser.get(u) ?? { evs: [], dests: [] };
    cur.evs.push(r); cur.dests.push(...dests.map((d) => d.replace(/^smtp:/i, '')));
    byUser.set(u, cur);
  }
  for (const [user, { evs, dests }] of byUser) {
    const external = dests.some((d) => isExternal(d, ctx));
    const targets = uniq(evs.map((e) => prop(e.raw as Row, 'Parameters', 'Identity') ?? '').filter(Boolean));
    out.push({
      signal: 'fwd', fingerprint: `fwd|${user}`, severity: 'high', category: 'Mailbox', title: external ? 'Mail forwarding to an external address' : 'Mail forwarding configured',
      text: `${user} configured forwarding (${uniq(evs.map((e) => e.operation as string)).join(', ')}) to ${uniq(dests).join(', ')}${targets.length ? ` on ${targets.slice(0, 3).join(', ')}` : ''}. Silent forwarding is the most common way stolen mailboxes keep leaking after cleanup.`,
      facts: [['Changed by', user], ['Destination', uniq(dests).join(', ')], ['Mailboxes / rules', targets.slice(0, 5).join(', ') || '—'], ['Client IPs', uniq(evs.map((e) => e.client_ip as string).filter(Boolean)).slice(0, 5).join(', ') || '—'], ['Period', fmtPeriod(evs[0].ts as string, evs[evs.length - 1].ts as string)]],
      entityType: 'user', entityValue: user, users: uniq([user, ...targets.filter((t) => t.includes('@')).map((t) => t.toLowerCase())]), eventIds: evs.map((e) => e.id as number), eventCount: evs.length,
      evidenceQuery: { user, q: 'Parameters.ForwardingSmtpAddress:* OR Parameters.ForwardingAddress:* OR Parameters.RedirectMessageTo:* OR Parameters.BlindCopyTo:*' }, firstTs: evs[0].ts as string, lastTs: evs[evs.length - 1].ts as string,
    });
  }
}

const FAMILY_SIGNALS: Record<string, { signal: string; severity: Severity; category: string; title: string; text: string }> = {
  'Role assignment': { signal: 'role', severity: 'high', category: 'Identity', title: 'Admin role assignment', text: 'granted directory or Exchange admin roles. Verify each assignment was planned.' },
  'Application consent & credentials': { signal: 'app', severity: 'high', category: 'Applications', title: 'App consent or credentials added', text: 'consented to applications or added credentials to apps or service principals. Malicious OAuth apps keep access independent of passwords and MFA.' },
  'Tenant security settings': { signal: 'ident', severity: 'high', category: 'Identity', title: 'Tenant security setting changed', text: 'changed federation, domain, Conditional Access or authentication settings.' },
  'Account lifecycle': { signal: 'acct', severity: 'medium', category: 'Identity', title: 'Accounts created, deleted or reset', text: 'created, deleted or reset accounts.' },
  'Audit configuration': { signal: 'audit', severity: 'high', category: 'Compliance', title: 'Audit configuration changed', text: 'changed audit logging or mailbox audit bypass settings. Attackers do this to blind the investigation.' },
  'Content search & export': { signal: 'search', severity: 'medium', category: 'Compliance', title: 'Content search or export', text: 'ran or exported compliance / eDiscovery searches across the tenant.' },
  'Mailbox permissions': { signal: 'perm', severity: 'medium', category: 'Mailbox', title: 'Mailbox permissions granted', text: 'granted mailbox, folder or Send As permissions.' },
};

async function sensitiveFamilies(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`
    select e.sensitive_family, e.user_upn, count(*)::int as cnt, min(e.ts) as first_ts, max(e.ts) as last_ts,
           array_agg(distinct e.operation) as ops, array_agg(distinct e.item) filter (where e.item is not null) as items,
           array_agg(distinct e.counterpart) filter (where e.counterpart is not null) as targets, array_agg(distinct e.client_ip) filter (where e.client_ip is not null) as ips,
           (array_agg(e.id order by e.ts))[1:500] as ids
      from events e where ${where} and e.sensitive_family = any(${b.add(Object.keys(FAMILY_SIGNALS))}::text[]) and e.user_upn is not null
     group by e.sensitive_family, e.user_upn order by cnt desc limit 500`, b.params);
  for (const r of rows) {
    const def = FAMILY_SIGNALS[r.sensitive_family as string];
    if (!def) continue;
    const user = r.user_upn as string;
    out.push({
      signal: def.signal, fingerprint: `${def.signal}|${user}`, severity: def.severity, category: def.category, title: def.title,
      text: `${user} ${def.text} (${n(r.cnt as number)} event${(r.cnt as number) === 1 ? '' : 's'}: ${((r.ops as string[]) ?? []).slice(0, 4).map(friendlyOperation).join(', ')}).`,
      facts: [['Actor', user], ['Operations', ((r.ops as string[]) ?? []).slice(0, 6).join(', ')], ['Targets', ((r.items as string[]) ?? []).slice(0, 6).join(', ') || '—'], ['Client IPs', ((r.ips as string[]) ?? []).slice(0, 5).join(', ') || '—'], ['Period', fmtPeriod(r.first_ts as string, r.last_ts as string)]],
      entityType: 'user', entityValue: user, users: uniq([user, ...(((r.targets as string[]) ?? []).filter((t) => t.includes('@')))]), eventIds: r.ids as number[], eventCount: r.cnt as number,
      evidenceQuery: { user, sensitive: r.sensitive_family as string }, firstTs: r.first_ts as string, lastTs: r.last_ts as string,
    });
  }
}

async function bursts(ctx: Ctx, out: FindingDraft[]) {
  const defs = [
    { signal: 'dl', ops: ['filedownloaded', 'filesyncdownloadedfull', 'filesyncdownloadedpartial', 'filecopied'], thr: ctx.thr.dl, title: 'Mass file download', what: 'downloaded or synced', category: 'Files' },
    { signal: 'del', ops: ['filedeleted', 'filerecycled', 'filedeletedfirststagerecyclebin', 'filedeletedsecondstagerecyclebin', 'folderdeleted', 'folderrecycled', 'harddelete', 'softdelete', 'movetodeleteditems'], thr: ctx.thr.del, title: 'Mass deletion', what: 'deleted', category: 'Files' },
    { signal: 'mia', ops: ['mailitemsaccessed'], thr: ctx.thr.mia, title: 'High-volume mailbox access', what: 'read or synced mail items in', category: 'Mailbox' },
  ];
  for (const d of defs) {
    const { b, where } = ctx.base();
    const rows = await query<Row>(`
      with h as (
        select e.user_upn, date_trunc('hour', e.ts) as hr, count(*)::int as cnt, count(distinct e.object_id)::int as objs,
               array_agg(distinct e.client_ip) filter (where e.client_ip is not null) as ips,
               bool_or(${d.signal === 'mia' ? `lower(ae_prop(e.raw, '{OperationProperties,IsThrottled}')) = 'true'` : 'false'}) as throttled,
               (array_agg(e.id order by e.ts))[1:300] as ids
          from events e where ${where} and e.operation_key = any(${b.add(d.ops)}::text[]) and e.user_upn is not null and e.ts is not null
         group by e.user_upn, date_trunc('hour', e.ts) having count(*) >= ${b.add(d.thr)})
      select user_upn, max(cnt)::int as peak, (array_agg(hr order by cnt desc))[1] as peak_hr, sum(cnt)::int as total, sum(objs)::int as objs, min(hr) as first_ts, max(hr) + interval '1 hour' as last_ts,
             bool_or(throttled) as throttled, count(*)::int as hours, (select array_agg(distinct x) from unnest(array_cat_agg(ips)) x) as ips, (array_cat_agg(ids))[1:500] as ids
        from h group by user_upn order by peak desc limit 100`, b.params);
    for (const r of rows) {
      const user = r.user_upn as string, peak = r.peak as number, throttled = !!r.throttled;
      const sev: Severity = peak >= d.thr * 3 || throttled ? 'high' : 'medium';
      out.push({
        signal: d.signal, fingerprint: `${d.signal}|${user}`, severity: sev, category: d.category, title: d.title + (throttled ? ' (throttled)' : ''),
        text: `${user} ${d.what} ${n(peak)} items in a single hour (${String(r.peak_hr).slice(0, 16).replace('T', ' ')} UTC); ${n(r.total as number)} across ${r.hours} busy hour${(r.hours as number) === 1 ? '' : 's'}.${throttled ? ' Microsoft throttled the audit records, so the real volume is higher than logged.' : ''}`,
        facts: [['User', user], ['Peak in one hour', n(peak)], ['Events in bursts', n(r.total as number)], ['Distinct objects', n(r.objs as number)], ['Client IPs', ((r.ips as string[] | null) ?? []).slice(0, 5).join(', ') || '—'], ['Period', fmtPeriod(r.first_ts as string, r.last_ts as string)]],
        entityType: 'user', entityValue: user, users: [user], eventIds: (r.ids as number[]) ?? [], eventCount: r.total as number,
        evidenceQuery: { user, q: d.ops.map((o) => `op:${o}`).join(' OR '), from: r.first_ts as string, to: r.last_ts as string }, firstTs: r.first_ts as string, lastTs: r.last_ts as string,
      });
    }
  }
}

async function sharing(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`select e.id, e.ts, e.user_upn, e.operation_key, e.item, e.counterpart, e.client_ip, e.raw->>'TargetUserOrGroupType' as ttype from events e where ${where} and e.operation_key in ('anonymouslinkcreated','anonymouslinkupdated','sharinginvitationcreated','addedtosecurelink','sharingset','securelinkcreated','companylinkcreated') and e.user_upn is not null order by e.ts limit 10000`, b.params);
  const anon = new Map<string, Row[]>(), ext = new Map<string, Row[]>();
  for (const r of rows) {
    const u = r.user_upn as string;
    if ((r.operation_key as string).startsWith('anonymouslink')) anon.set(u, [...(anon.get(u) ?? []), r]);
    else if (String(r.ttype ?? '').toLowerCase() === 'guest' || isExternal(r.counterpart as string, ctx)) ext.set(u, [...(ext.get(u) ?? []), r]);
  }
  for (const [user, evs] of anon) out.push({
    signal: 'share', fingerprint: `share-anon|${user}`, severity: 'medium', category: 'Sharing', title: '"Anyone" links created',
    text: `${user} created ${evs.length} anonymous sharing link${evs.length === 1 ? '' : 's'} — anyone with the link can open ${uniq(evs.map((e) => e.item as string)).slice(0, 3).join(', ')}.`,
    facts: [['User', user], ['Files', uniq(evs.map((e) => e.item as string).filter(Boolean)).slice(0, 6).join(', ')], ['Client IPs', uniq(evs.map((e) => e.client_ip as string).filter(Boolean)).slice(0, 5).join(', ') || '—'], ['Period', fmtPeriod(evs[0].ts as string, evs[evs.length - 1].ts as string)]],
    entityType: 'user', entityValue: user, users: [user], eventIds: evs.map((e) => e.id as number).slice(0, 500), eventCount: evs.length,
    evidenceQuery: { user, q: 'op:anonymouslinkcreated OR op:anonymouslinkupdated' }, firstTs: evs[0].ts as string, lastTs: evs[evs.length - 1].ts as string,
  });
  for (const [user, evs] of ext) out.push({
    signal: 'share', fingerprint: `share-ext|${user}`, severity: 'medium', category: 'Sharing', title: 'Files shared externally',
    text: `${user} shared ${uniq(evs.map((e) => e.item as string)).length} item(s) with people outside the organisation: ${uniq(evs.map((e) => e.counterpart as string).filter(Boolean)).slice(0, 4).join(', ')}.`,
    facts: [['User', user], ['Shared with', uniq(evs.map((e) => e.counterpart as string).filter(Boolean)).slice(0, 6).join(', ')], ['Files', uniq(evs.map((e) => e.item as string).filter(Boolean)).slice(0, 6).join(', ')], ['Period', fmtPeriod(evs[0].ts as string, evs[evs.length - 1].ts as string)]],
    entityType: 'user', entityValue: user, users: [user], eventIds: evs.map((e) => e.id as number).slice(0, 500), eventCount: evs.length,
    evidenceQuery: { user, q: 'op:sharinginvitationcreated OR op:addedtosecurelink OR op:sharingset OR op:securelinkcreated' }, firstTs: evs[0].ts as string, lastTs: evs[evs.length - 1].ts as string,
  });
}

async function scriptedClients(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`
    select coalesce(e.client_ip, e.user_upn) as key, count(*)::int as cnt, bool_or(e.failed) as any_failed, min(e.ts) as first_ts, max(e.ts) as last_ts,
           array_agg(distinct e.user_upn) filter (where e.user_upn is not null) as upns, array_agg(distinct e.user_agent) as uas, (array_agg(e.id order by e.ts))[1:500] as ids
      from events e where ${where} and e.user_agent ~* ${b.add(SCRIPTED_UA_RX.source)}
     group by coalesce(e.client_ip, e.user_upn) order by cnt desc limit 200`, b.params);
  for (const r of rows) {
    const key = r.key as string, sev: Severity = r.any_failed || (r.cnt as number) > 50 ? 'high' : 'medium';
    const fams = uniq(((r.uas as string[]) ?? []).map((u) => userAgentFamily(u)));
    out.push({
      signal: 'ua', fingerprint: `ua|${key}`, severity: sev, category: 'Identity', title: 'Scripted or legacy client',
      text: `${fams.join(', ')} used from ${key} (${n(r.cnt as number)} events${r.any_failed ? ', including failures' : ''}). Legacy protocols and scripts bypass MFA prompts and are the usual tooling of password sprays and mailbox dumps.`,
      facts: [[key.includes('@') ? 'User' : 'Source IP', key], ['Clients', fams.slice(0, 5).join(', ')], ['Accounts', ((r.upns as string[]) ?? []).slice(0, 6).join(', ')], ['Events', n(r.cnt as number)], ['Period', fmtPeriod(r.first_ts as string, r.last_ts as string)]],
      entityType: key.includes('@') ? 'user' : 'ip', entityValue: key, users: (r.upns as string[]) ?? [], eventIds: r.ids as number[], eventCount: r.cnt as number,
      evidenceQuery: key.includes('@') ? { user: key, q: 'ua:*python* OR ua:*curl* OR ua:*powershell* OR ua:*BAV2ROPC* OR ua:*okhttp* OR ua:*axios*' } : { ip: key }, firstTs: r.first_ts as string, lastTs: r.last_ts as string,
    });
  }
}

async function azureSignins(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`select e.client_ip, count(*)::int as cnt, bool_or(not e.failed) as any_ok, array_agg(distinct e.user_upn) as upns, min(e.ts) as first_ts, max(e.ts) as last_ts, (array_agg(e.id order by e.ts))[1:500] as ids from events e where ${where} and e.kind = 'signin' and e.ip_owner = 'azure' and e.client_ip is not null group by e.client_ip order by cnt desc limit 100`, b.params);
  for (const r of rows) out.push({
    signal: 'azure', fingerprint: `azure|${r.client_ip}`, severity: r.any_ok ? 'medium' : 'low', category: 'Identity', title: r.any_ok ? 'Sign-in from an Azure-hosted address' : 'Sign-in attempts from an Azure-hosted address',
    text: `${r.client_ip} is in Microsoft Azure's public cloud — rentable by anyone — and was used for ${n(r.cnt as number)} sign-in${(r.cnt as number) === 1 ? '' : 's'} by ${((r.upns as string[]) ?? []).slice(0, 3).join(', ')}. Attackers often proxy through Azure VMs so traffic looks like Microsoft.`,
    facts: [['Source IP', r.client_ip as string], ['Accounts', ((r.upns as string[]) ?? []).slice(0, 6).join(', ')], ['Sign-ins', n(r.cnt as number)], ['Period', fmtPeriod(r.first_ts as string, r.last_ts as string)]],
    entityType: 'ip', entityValue: r.client_ip as string, users: (r.upns as string[]) ?? [], eventIds: r.ids as number[], eventCount: r.cnt as number,
    evidenceQuery: { ip: r.client_ip as string, kind: 'signin' }, firstTs: r.first_ts as string, lastTs: r.last_ts as string,
  });
}

async function manyNetworks(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`
    select e.user_upn, date_trunc('day', e.ts) as day, count(distinct split_part(e.client_ip, '.', 1) || '.' || split_part(e.client_ip, '.', 2))::int as nets, count(*)::int as cnt, (array_agg(e.id order by e.ts))[1:300] as ids
      from events e where ${where} and e.kind = 'signin' and not e.failed and e.client_ip like '%.%' and e.user_upn is not null and (e.ip_owner is null or e.ip_owner = 'azure')
     group by e.user_upn, date_trunc('day', e.ts) having count(distinct split_part(e.client_ip, '.', 1) || '.' || split_part(e.client_ip, '.', 2)) >= ${b.add(ctx.thr.nets)} order by nets desc limit 200`, b.params);
  const byUser = new Map<string, Row[]>();
  for (const r of rows) byUser.set(r.user_upn as string, [...(byUser.get(r.user_upn as string) ?? []), r]);
  for (const [user, days] of byUser) {
    const top = days.sort((a, c) => (c.nets as number) - (a.nets as number))[0];
    out.push({
      signal: 'nets', fingerprint: `nets|${user}`, severity: 'low', category: 'Identity', title: 'Sign-ins from many networks in one day',
      text: `${user} signed in from ${top.nets} different networks on ${String(top.day).slice(0, 10)}${days.length > 1 ? ` (and ${days.length - 1} other day${days.length === 2 ? '' : 's'})` : ''}. Normal for travellers and VPN users; suspicious together with other findings.`,
      facts: [['User', user], ['Networks (peak day)', String(top.nets)], ['Days', String(days.length)]],
      entityType: 'user', entityValue: user, users: [user], eventIds: ids(days), eventCount: days.reduce((a, d) => a + (d.cnt as number), 0),
      evidenceQuery: { user, kind: 'signin', result: 'succeeded' }, firstTs: String(days[0].day), lastTs: String(days[days.length - 1].day),
    });
  }
}

async function phishingClicks(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`
    select e.id, e.ts, e.user_upn, e.item as url, e.result, e.network_message_id, e.client_ip,
           exists (select 1 from events m where m.workspace_id = e.workspace_id and m.network_message_id = e.network_message_id and m.kind in ('msg','msgpost')
                     and (coalesce(m.detail,'') || ' ' || coalesce(m.result,'')) ~* 'phish|malware|zap|quarant|junk|block|replac') as flagged
      from events e where ${where} and e.kind = 'click' and e.user_upn is not null order by e.ts limit 5000`, b.params);
  const byUser = new Map<string, Row[]>();
  for (const r of rows) {
    const thru = /through|allowed/i.test(String(r.result ?? '')) && !/blocked$/i.test(String(r.result ?? ''));
    if (!(thru || r.flagged)) continue;
    if (/^blocked$/i.test(String(r.result ?? ''))) continue;
    byUser.set(r.user_upn as string, [...(byUser.get(r.user_upn as string) ?? []), r]);
  }
  for (const [user, evs] of byUser) {
    const flagged = evs.some((e) => e.flagged);
    out.push({
      signal: 'click', fingerprint: `click|${user}`, severity: flagged ? 'high' : 'medium', category: 'Email', title: flagged ? 'Clicked a link in a phishing email' : 'Clicked through a link warning',
      text: flagged ? `${user} clicked ${evs.length} link${evs.length === 1 ? '' : 's'} in mail that Defender classified as phishing or malware. Check what happened in the hour after each click: new sign-ins, MFA prompts, rules.` : `${user} clicked through Safe Links warnings ${evs.length} time${evs.length === 1 ? '' : 's'}.`,
      facts: [['User', user], ['Links', uniq(evs.map((e) => e.url as string)).slice(0, 3).join(' · ')], ['Results', uniq(evs.map((e) => e.result as string)).join(', ')], ['Client IPs', uniq(evs.map((e) => e.client_ip as string).filter(Boolean)).slice(0, 4).join(', ') || '—'], ['Period', fmtPeriod(evs[0].ts as string, evs[evs.length - 1].ts as string)]],
      entityType: 'user', entityValue: user, users: [user], eventIds: evs.map((e) => e.id as number), eventCount: evs.length,
      evidenceQuery: { user, kind: 'click' }, firstTs: evs[0].ts as string, lastTs: evs[evs.length - 1].ts as string,
    });
  }
}

const RISKY_SCOPES = /Mail\.(Read|ReadWrite|Send)(?:\.Shared)?\b|MailboxSettings\.ReadWrite|Files\.ReadWrite\.All|Files\.Read\.All|Sites\.(Read|ReadWrite|FullControl)\.All|full_access_as_user|EWS\.AccessAsUser\.All|Contacts\.ReadWrite|User\.ReadWrite\.All|Directory\.ReadWrite\.All|offline_access/g;

async function consentRisk(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`select e.id, e.ts, e.user_upn, e.client_ip, e.item, e.raw from events e where ${where} and e.operation_key in ('consent to application','add delegated permission grant','add oauth2permissiongrant','add app role assignment to service principal') order by e.ts limit 2000`, b.params);
  for (const r of rows) {
    const txt = JSON.stringify(r.raw);
    const scopes = uniq(txt.match(RISKY_SCOPES) ?? []);
    if (!scopes.filter((s) => s !== 'offline_access').length) continue;
    const admin = /IsAdminConsent[^A-Za-z]{0,40}True/i.test(txt);
    const app = (r.item as string) ?? 'unknown app';
    out.push({
      signal: 'consentrisk', fingerprint: `consentrisk|${r.user_upn}|${app}|${String(r.ts).slice(0, 10)}`, severity: 'high', category: 'Applications', title: 'App granted access to mail or files',
      text: `${r.user_upn} granted "${app}" ${scopes.join(', ')}${admin ? ' with admin consent' : ''}. The app can now read${/Send/.test(scopes.join()) ? ' and send' : ''} on behalf of the user even after a password reset — revoke it in Entra unless it is known.`,
      facts: [['User', r.user_upn as string], ['Application', app], ['Permissions', scopes.join(', ')], ['Admin consent', admin ? 'yes' : 'no'], ['Client IP', (r.client_ip as string) ?? '—'], ['Time', String(r.ts).slice(0, 19).replace('T', ' ') + ' UTC']],
      entityType: 'app', entityValue: app, users: r.user_upn ? [r.user_upn as string] : [], eventIds: [r.id as number], eventCount: 1,
      evidenceQuery: { user: (r.user_upn as string) ?? undefined, q: 'op:"consent to application" OR op:"add delegated permission grant" OR op:"add oauth2permissiongrant" OR op:"add app role assignment to service principal"' }, firstTs: r.ts as string, lastTs: r.ts as string,
    });
  }
}

async function mfaChanges(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`
    select coalesce(e.counterpart, e.user_upn) as target, count(*)::int as cnt, array_agg(distinct e.operation) as ops, array_agg(distinct e.user_upn) as actors, array_agg(distinct e.client_ip) filter (where e.client_ip is not null) as ips, min(e.ts) as first_ts, max(e.ts) as last_ts, (array_agg(e.id order by e.ts))[1:200] as ids
      from events e where ${where} and (e.operation_key in ('user registered security info','user deleted security info','user changed default security info','user registered all required security info','user started security info registration','admin registered security info','admin deleted security info','admin updated security info','disable strong authentication','reset password (self-service)')
            or (e.operation_key = 'update user' and e.raw::text ~ 'StrongAuthentication|SecurityInfo|PhoneNumber|AlternativeSecurityId'))
     group by coalesce(e.counterpart, e.user_upn) order by cnt desc limit 300`, b.params);
  for (const r of rows) {
    const target = r.target as string;
    if (!target) continue;
    out.push({
      signal: 'mfa', fingerprint: `mfa|${target}`, severity: 'medium', category: 'Identity', title: 'Sign-in methods changed',
      text: `MFA / security info for ${target} was changed ${r.cnt} time${(r.cnt as number) === 1 ? '' : 's'} (${((r.ops as string[]) ?? []).slice(0, 3).join(', ')}). After a takeover, attackers register their own authenticator to keep access.`,
      facts: [['Account', target], ['Changed by', ((r.actors as string[]) ?? []).join(', ')], ['Operations', ((r.ops as string[]) ?? []).slice(0, 5).join(', ')], ['Client IPs', ((r.ips as string[]) ?? []).slice(0, 4).join(', ') || '—'], ['Period', fmtPeriod(r.first_ts as string, r.last_ts as string)]],
      entityType: 'user', entityValue: target, users: uniq([target, ...(((r.actors as string[]) ?? []).filter(Boolean))]), eventIds: r.ids as number[], eventCount: r.cnt as number,
      evidenceQuery: { user: target, q: 'op:*security info* OR op:"disable strong authentication" OR op:"reset password (self-service)"' }, firstTs: r.first_ts as string, lastTs: r.last_ts as string,
    });
  }
}

async function purge(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`select e.user_upn, count(*)::int as cnt, array_agg(distinct e.operation) as ops, min(e.ts) as first_ts, max(e.ts) as last_ts, (array_agg(e.id order by e.ts))[1:200] as ids from events e where ${where} and (e.operation_key in ('search-mailbox','purgeditems') or (e.operation_key = 'new-compliancesearchaction' and e.raw::text ~* 'purge')) and e.user_upn is not null group by e.user_upn limit 100`, b.params);
  for (const r of rows) out.push({
    signal: 'purge', fingerprint: `purge|${r.user_upn}`, severity: 'high', category: 'Compliance', title: 'Mail searched and purged',
    text: `${r.user_upn} ran ${r.cnt} search-and-purge operation${(r.cnt as number) === 1 ? '' : 's'} (${((r.ops as string[]) ?? []).join(', ')}). Used legitimately to remove phishing — and by attackers to destroy evidence.`,
    facts: [['Actor', r.user_upn as string], ['Operations', ((r.ops as string[]) ?? []).join(', ')], ['Events', String(r.cnt)], ['Period', fmtPeriod(r.first_ts as string, r.last_ts as string)]],
    entityType: 'user', entityValue: r.user_upn as string, users: [r.user_upn as string], eventIds: r.ids as number[], eventCount: r.cnt as number,
    evidenceQuery: { user: r.user_upn as string, q: 'op:search-mailbox OR op:purgeditems OR op:new-compliancesearchaction' }, firstTs: r.first_ts as string, lastTs: r.last_ts as string,
  });
}

const RISKY_TERMS = /invoice|payment|wire|bank|iban|swift|transfer|password|faktura|betaling|kodeord|kontonummer|overf|remittance|routing/i;

async function mailboxSearches(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`select e.id, e.ts, e.user_upn, coalesce(ae_prop(e.raw, '{QueryText}'), ae_prop(e.raw, '{SearchQuery}'), ae_prop(e.raw, '{OperationProperties,QueryText}')) as term from events e where ${where} and e.operation_key in ('searchqueryinitiatedexchange','searchqueryinitiatedsharepoint') and e.user_upn is not null order by e.ts limit 20000`, b.params);
  const byUser = new Map<string, Row[]>();
  for (const r of rows) byUser.set(r.user_upn as string, [...(byUser.get(r.user_upn as string) ?? []), r]);
  for (const [user, evs] of byUser) {
    const risky = evs.filter((e) => RISKY_TERMS.test(String(e.term ?? '')));
    if (!risky.length && evs.length < 20) continue;
    const terms = uniq((risky.length ? risky : evs).map((e) => String(e.term ?? '')).filter(Boolean)).slice(0, 6);
    out.push({
      signal: 'search', fingerprint: `mbsearch|${user}`, severity: risky.length ? 'medium' : 'low', category: 'Mailbox', title: risky.length ? 'Searches for payment or password terms' : 'Many mailbox searches',
      text: risky.length ? `${user} searched mail or SharePoint for ${terms.map((t) => `"${t}"`).join(', ')}. Intruders search for invoices and banking details to run payment fraud.` : `${user} ran ${evs.length} searches.`,
      facts: [['User', user], ['Search terms', terms.join(' · ')], ['Searches', String(evs.length)], ['Period', fmtPeriod(evs[0].ts as string, evs[evs.length - 1].ts as string)]],
      entityType: 'user', entityValue: user, users: [user], eventIds: (risky.length ? risky : evs).map((e) => e.id as number).slice(0, 500), eventCount: evs.length,
      evidenceQuery: { user, q: 'op:searchqueryinitiatedexchange OR op:searchqueryinitiatedsharepoint' }, firstTs: evs[0].ts as string, lastTs: evs[evs.length - 1].ts as string,
    });
  }
}

async function unexpectedCountries(ctx: Ctx, out: FindingDraft[]) {
  const expected = ctx.ws.expectedCountries.map((c) => c.toUpperCase());
  if (!expected.length) return;
  const { b, where } = ctx.base();
  const rows = await query<Row>(`
    select e.user_upn, e.ip_country, count(*)::int as cnt, bool_or(e.kind = 'signin' and not e.failed) as ok_signin, bool_or(not e.failed) as any_ok,
           array_agg(distinct e.client_ip) as ips, min(e.ts) as first_ts, max(e.ts) as last_ts, (array_agg(e.id order by e.ts))[1:300] as ids
      from events e where ${where} and e.ip_country is not null and e.ip_country <> all(${b.add(expected)}::text[]) and (e.ip_owner is null or e.ip_owner = 'azure') and e.user_upn is not null
       and e.kind not in ('msg','msgpost','urlinfo','attachment')  -- those carry the sender's IP, not the user's
     group by e.user_upn, e.ip_country order by cnt desc limit 2000`, b.params);
  // A country used by many accounts is almost always a shared office / VPN / proxy address, not 14 separate
  // intrusions: report it once, with the shared IPs, and keep per-user findings for the rare countries.
  const byCountry = new Map<string, Row[]>();
  for (const r of rows) byCountry.set(r.ip_country as string, [...(byCountry.get(r.ip_country as string) ?? []), r]);
  for (const [cc, list] of byCountry) {
    const ipCount = new Map<string, number>();
    for (const r of list) for (const ip of (r.ips as string[]) ?? []) ipCount.set(ip, (ipCount.get(ip) ?? 0) + 1);
    const sharedIps = [...ipCount].filter(([, c]) => c >= 3).map(([ip]) => ip);
    // Accounts that actually signed in from there keep an individual finding unless that too is widespread.
    const okRows = list.filter((r) => r.ok_signin);
    const individual = okRows.length < 5 ? okRows : [];
    const grouped = list.filter((r) => !individual.includes(r));
    const groupedUsers = uniq(grouped.map((r) => r.user_upn as string));
    if (groupedUsers.length >= 5) {
      const total = grouped.reduce((a, r) => a + (r.cnt as number), 0);
      const okSignin = grouped.some((r) => r.ok_signin);
      const users = groupedUsers;
      out.push({
        signal: 'country', fingerprint: `country-shared|${cc}`, severity: okSignin ? 'medium' : 'low', category: 'Location', title: `${users.length} accounts active from ${countryName(cc)}`,
        text: `${users.length} different accounts have ${okSignin ? 'signed in or been active' : 'activity (no successful sign-ins)'} from ${countryName(cc)}, which is not an expected country for this customer${sharedIps.length ? `, mostly via ${sharedIps.slice(0, 3).join(', ')}` : ''}. ${okSignin ? 'This pattern is usually a shared office, VPN or proxy address rather than an intrusion — if so, add the IP to the workspace exclusions or ' + cc + ' to the expected countries.' : 'Failed attempts against many accounts from one place look like a spray; see the Password spray finding if present.'}`,
        facts: [['Country', `${countryName(cc)} (${cc})`], ['Accounts', `${users.length}: ${users.slice(0, 6).join(', ')}${users.length > 6 ? '…' : ''}`], ['Shared IPs', sharedIps.slice(0, 6).join(', ') || '—'], ['Events', n(total)], ['Period', fmtPeriod(grouped.map((r) => r.first_ts as string).sort()[0], grouped.map((r) => r.last_ts as string).sort().reverse()[0])]],
        entityType: 'ip', entityValue: sharedIps[0] ?? null, users, eventIds: ids(grouped), eventCount: total, evidenceQuery: { country: cc }, firstTs: grouped.map((r) => r.first_ts as string).sort()[0], lastTs: grouped.map((r) => r.last_ts as string).sort().reverse()[0],
      });
    }
    for (const r of groupedUsers.length >= 5 ? individual : list) {
      const sev: Severity = r.ok_signin ? 'high' : r.any_ok ? 'medium' : 'low';
      out.push({
        signal: 'country', fingerprint: `country|${r.user_upn}|${cc}`, severity: sev, category: 'Location', title: r.ok_signin ? `Signed in from ${countryName(cc)}` : `Activity from ${countryName(cc)}`,
        text: `${r.user_upn} had ${n(r.cnt as number)} event${(r.cnt as number) === 1 ? '' : 's'} from ${countryName(cc)} (${((r.ips as string[]) ?? []).slice(0, 3).join(', ')}), which is not one of the expected countries (${expected.join(', ')}).${r.ok_signin ? ' At least one sign-in succeeded.' : ''}`,
        facts: [['User', r.user_upn as string], ['Country', `${countryName(cc)} (${cc})`], ['IPs', ((r.ips as string[]) ?? []).slice(0, 6).join(', ')], ['Events', n(r.cnt as number)], ['Period', fmtPeriod(r.first_ts as string, r.last_ts as string)]],
        entityType: 'user', entityValue: r.user_upn as string, users: [r.user_upn as string], eventIds: r.ids as number[], eventCount: r.cnt as number,
        evidenceQuery: { user: r.user_upn as string, country: cc }, firstTs: r.first_ts as string, lastTs: r.last_ts as string,
      });
    }
  }
}

async function impossibleTravel(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`select e.id, e.ts, e.user_upn, e.ip_country, e.client_ip from events e where ${where} and e.kind = 'signin' and not e.failed and e.ip_country is not null and (e.ip_owner is null or e.ip_owner = 'azure') and e.user_upn is not null order by e.user_upn, e.ts`, b.params);
  let i = 0;
  while (i < rows.length) {
    const user = rows[i].user_upn as string;
    let j = i; const jumps: { from: Row; to: Row; km: number; kmh: number }[] = [];
    while (j < rows.length && rows[j].user_upn === user) {
      if (j > i) {
        const a = rows[j - 1], c = rows[j];
        if (a.ip_country !== c.ip_country) {
          const km = countryDistanceKm(a.ip_country as string, c.ip_country as string);
          const mins = Math.max(1, (new Date(c.ts as string).getTime() - new Date(a.ts as string).getTime()) / 60000);
          if (km != null && km >= 500) { const kmh = km / (mins / 60); if (kmh > 900) jumps.push({ from: a, to: c, km, kmh }); }
        }
      }
      j++;
    }
    if (jumps.length) {
      const w = jumps.sort((x, y) => y.kmh - x.kmh)[0];
      out.push({
        signal: 'travel', fingerprint: `travel|${user}`, severity: 'high', category: 'Location', title: 'Impossible travel',
        text: `${user} signed in from ${countryName(w.from.ip_country as string)} and then from ${countryName(w.to.ip_country as string)} ${Math.round(w.km).toLocaleString()} km away within ${Math.round((new Date(w.to.ts as string).getTime() - new Date(w.from.ts as string).getTime()) / 60000)} minutes${jumps.length > 1 ? ` (${jumps.length} such jumps)` : ''}. One of the two sessions is not the user.`,
        facts: [['User', user], ['From', `${countryName(w.from.ip_country as string)} · ${w.from.client_ip} · ${String(w.from.ts).slice(11, 16)} UTC`], ['To', `${countryName(w.to.ip_country as string)} · ${w.to.client_ip} · ${String(w.to.ts).slice(11, 16)} UTC`], ['Implied speed', `${Math.round(w.kmh).toLocaleString()} km/h`], ['Jumps', String(jumps.length)]],
        entityType: 'user', entityValue: user, users: [user], eventIds: uniq(jumps.flatMap((x) => [x.from.id as number, x.to.id as number])).slice(0, 500), eventCount: jumps.length * 2,
        evidenceQuery: { user, kind: 'signin', result: 'succeeded' }, firstTs: jumps[0].from.ts as string, lastTs: jumps[jumps.length - 1].to.ts as string,
      });
    }
    i = j;
  }
}

async function sessions(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`
    select e.session_id, array_agg(distinct e.user_upn) filter (where e.user_upn is not null) as upns, count(*)::int as cnt,
           array_agg(distinct e.ip_country) filter (where e.ip_country is not null and (e.ip_owner is null or e.ip_owner = 'azure')) as ccs,
           array_agg(distinct e.client_ip) filter (where e.client_ip is not null and (e.ip_owner is null or e.ip_owner = 'azure')) as ips,
           min(e.ts) as first_ts, max(e.ts) as last_ts, (array_agg(e.id order by e.ts))[1:500] as ids
      from events e where ${where} and e.session_id is not null group by e.session_id having count(distinct e.client_ip) > 1 limit 2000`, b.params);
  for (const r of rows) {
    const ccs = (r.ccs as string[]) ?? [], nets = uniq(((r.ips as string[]) ?? []).map((ip) => networkKey(ip)).filter(Boolean));
    if (ccs.length < 2 && nets.length < 3) continue;
    const user = ((r.upns as string[]) ?? [])[0] ?? 'unknown';
    out.push({
      signal: 'session', fingerprint: `session|${r.session_id}`, severity: ccs.length >= 2 ? 'high' : 'low', category: 'Identity',
      title: ccs.length >= 2 ? 'Sign-in session used from several countries' : 'Sign-in session used from several networks',
      text: ccs.length >= 2 ? `The same sign-in session of ${user} was used from ${ccs.map(countryName).join(' and ')}. A session token travelling between countries is the signature of adversary-in-the-middle phishing (stolen cookie), which bypasses MFA.` : `Session of ${user} used from ${nets.length} networks (${((r.ips as string[]) ?? []).slice(0, 4).join(', ')}).`,
      facts: [['User', user], ['Session', r.session_id as string], ['Countries', ccs.map(countryName).join(', ') || '—'], ['IPs', ((r.ips as string[]) ?? []).slice(0, 6).join(', ')], ['Events', n(r.cnt as number)], ['Period', fmtPeriod(r.first_ts as string, r.last_ts as string)]],
      entityType: 'session', entityValue: r.session_id as string, users: (r.upns as string[]) ?? [], eventIds: r.ids as number[], eventCount: r.cnt as number,
      evidenceQuery: { session: r.session_id as string }, firstTs: r.first_ts as string, lastTs: r.last_ts as string,
    });
  }
}

async function teamsExternal(ctx: Ctx, out: FindingDraft[]) {
  const { b, where } = ctx.base();
  const rows = await query<Row>(`select e.user_upn, count(*)::int as cnt, min(e.ts) as first_ts, max(e.ts) as last_ts, (array_agg(e.id order by e.ts))[1:200] as ids from events e where ${where} and e.kind = 'teams' and e.raw::text ~* '#EXT#' and e.user_upn is not null group by e.user_upn limit 100`, b.params);
  for (const r of rows) out.push({
    signal: 'teamsext', fingerprint: `teamsext|${r.user_upn}`, severity: 'low', category: 'Teams', title: 'Teams activity with guests',
    text: `${r.user_upn} had ${r.cnt} Teams event${(r.cnt as number) === 1 ? '' : 's'} involving guest accounts.`,
    facts: [['User', r.user_upn as string], ['Events', String(r.cnt)], ['Period', fmtPeriod(r.first_ts as string, r.last_ts as string)]],
    entityType: 'user', entityValue: r.user_upn as string, users: [r.user_upn as string], eventIds: r.ids as number[], eventCount: r.cnt as number,
    evidenceQuery: { user: r.user_upn as string, kind: 'teams', q: '#EXT#' }, firstTs: r.first_ts as string, lastTs: r.last_ts as string,
  });
}

// ---------------------------------------------------------------- runner

export function thresholdsOf(ws: Workspace & { settings?: Record<string, unknown> }): Thresholds {
  const t = (ws.settings?.thresholds ?? {}) as Partial<Thresholds>;
  return { ...DEFAULT_THRESHOLDS, ...Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === 'number' && v > 0)) } as Thresholds;
}

async function inferTenantDomains(workspaceId: string, configured: string[]): Promise<Set<string>> {
  const s = new Set(configured.map((d) => d.toLowerCase()));
  if (s.size) return s;
  const rows = await query<{ dom: string }>(`select split_part(upn, '@', 2) as dom from identities where workspace_id = $1 and upn like '%@%' and upn not like '%#ext#%' group by 1 having sum(events) >= 3 order by sum(events) desc limit 5`, [workspaceId]);
  for (const r of rows) s.add(r.dom);
  return s;
}

const running = new Set<string>();

export async function runSignals(workspaceId: string): Promise<{ findings: number; ms: number }> {
  if (running.has(workspaceId)) return { findings: -1, ms: 0 };
  running.add(workspaceId);
  const t0 = Date.now();
  await query(`insert into signal_runs(workspace_id, started_at, finished_at, error) values ($1, now(), null, null) on conflict (workspace_id) do update set started_at = now(), finished_at = null, error = null`, [workspaceId]);
  try {
    const ws = (await loadWorkspace(workspaceId)) as (Workspace & { settings?: Record<string, unknown> }) | null;
    if (!ws) throw new Error('workspace not found');
    const ex = exclusionsOf(ws);
    const ctx: Ctx = {
      ws, thr: thresholdsOf(ws), tenantDomains: await inferTenantDomains(workspaceId, ws.tenantDomains),
      base: () => { const b = new SqlBuilder(); let where = `e.workspace_id = ${b.add(workspaceId)}`; const exc = exclusionSql(ex, b); if (exc) where += ` and not ${exc}`; return { b, where }; },
    };
    const out: FindingDraft[] = [];
    const steps: [string, (c: Ctx, o: FindingDraft[]) => Promise<void>][] = [
      ['brute', brute], ['spray', spray], ['rule', inboxRules], ['fwd', forwarding], ['families', sensitiveFamilies], ['bursts', bursts], ['share', sharing],
      ['ua', scriptedClients], ['azure', azureSignins], ['nets', manyNetworks], ['click', phishingClicks], ['consent', consentRisk], ['mfa', mfaChanges],
      ['purge', purge], ['search', mailboxSearches], ['country', unexpectedCountries], ['travel', impossibleTravel], ['session', sessions], ['teamsext', teamsExternal],
    ];
    for (const [name, fn] of steps) {
      try { await fn(ctx, out); } catch (e) { console.error(`signal ${name} failed:`, (e as Error).message); }
    }
    // Escalations: MFA change on an account that also has another high finding; external forwarding already handled.
    const highUsers = new Set(out.filter((f) => f.severity === 'high').flatMap((f) => f.users));
    for (const f of out) if (f.signal === 'mfa' && f.severity !== 'high' && f.users.some((u) => highUsers.has(u))) { f.severity = 'high'; f.text += ' This account also has other high-severity findings.'; }

    await withTx(async (c) => {
      await c.query('create temp table new_findings (fingerprint text primary key) on commit drop');
      for (const f of out) {
        await c.query(`insert into findings (workspace_id, signal, fingerprint, severity, category, title, text, facts, entity_type, entity_value, users, event_count, event_ids, evidence_query, first_ts, last_ts, computed_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
          on conflict (workspace_id, fingerprint) do update set severity = excluded.severity, category = excluded.category, title = excluded.title, text = excluded.text, facts = excluded.facts,
            entity_type = excluded.entity_type, entity_value = excluded.entity_value, users = excluded.users, event_count = excluded.event_count, event_ids = excluded.event_ids,
            evidence_query = excluded.evidence_query, first_ts = excluded.first_ts, last_ts = excluded.last_ts, computed_at = now()`,
          [workspaceId, f.signal, f.fingerprint, f.severity, f.category, f.title, f.text, JSON.stringify(f.facts), f.entityType, f.entityValue, uniq(f.users.map((u) => u.toLowerCase())), f.eventCount, f.eventIds, f.evidenceQuery ? JSON.stringify(f.evidenceQuery) : null, f.firstTs, f.lastTs]);
        await c.query('insert into new_findings values ($1) on conflict do nothing', [f.fingerprint]);
      }
      await c.query('delete from findings f where f.workspace_id = $1 and not exists (select 1 from new_findings n where n.fingerprint = f.fingerprint)', [workspaceId]);
    });
    const ms = Date.now() - t0;
    await query(`update signal_runs set finished_at = now(), duration_ms = $2, findings = $3 where workspace_id = $1`, [workspaceId, ms, out.length]);
    return { findings: out.length, ms };
  } catch (e) {
    await query(`update signal_runs set finished_at = now(), error = $2 where workspace_id = $1`, [workspaceId, (e as Error).message]);
    throw e;
  } finally {
    running.delete(workspaceId);
  }
}

