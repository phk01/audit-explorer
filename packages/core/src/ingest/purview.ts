import type { NormalizedEvent, NormalizeContext, EventKind } from './types.js';
import { str, lower, toIso, parseJsonMaybe, prop, nv, nvObject, normalizeMessageId, truncate, lastSegment, hashKey } from './util.js';
import { resolveRecordType } from '../catalog/record-types.js';
import { workloadGroupFor } from '../catalog/workloads.js';
import { normalizeOperationKey } from '../catalog/activities.js';
import { appName, GUID_RX } from '../catalog/known.js';
import { cleanIp } from '@audit/ipdata';

type Obj = Record<string, unknown>;

const USER_TYPES: Record<number, string> = { 0: 'Regular', 1: 'Reserved', 2: 'Admin', 3: 'DCAdmin', 4: 'System', 5: 'Application', 6: 'ServicePrincipal', 7: 'CustomPolicy', 8: 'SystemPolicy', 9: 'PartnerTechnician', 10: 'Guest' };

interface MailItem { subject: string | null; folder: string | null; id: string | null; size: number | null; mid: string | null }

/** Collect mail items from the many shapes Exchange mailbox records use. */
export function mailItems(d: Obj): MailItem[] {
  const out: MailItem[] = [];
  const push = (it: unknown, folder: string | null) => {
    if (!it || typeof it !== 'object') return;
    const o = it as Obj;
    const pf = prop(o, 'ParentFolder') as Obj | undefined;
    out.push({
      subject: str(prop(o, 'Subject')),
      folder: folder ?? str(prop(pf, 'Path')) ?? str(prop(pf, 'Name')),
      id: str(prop(o, 'Id')) ?? str(prop(o, 'ImmutableId')),
      size: typeof prop(o, 'SizeInBytes') === 'number' ? (prop(o, 'SizeInBytes') as number) : null,
      mid: normalizeMessageId(prop(o, 'InternetMessageId')),
    });
  };
  const affected = prop(d, 'AffectedItems');
  if (Array.isArray(affected)) affected.forEach((x) => push(x, null));
  const item = prop(d, 'Item');
  if (item && typeof item === 'object') push(item, null);
  const folders = prop(d, 'Folders');
  if (Array.isArray(folders)) {
    for (const f of folders) {
      if (!f || typeof f !== 'object') continue;
      const path = str(prop(f as Obj, 'Path'));
      const items = prop(f as Obj, 'FolderItems');
      if (Array.isArray(items)) items.forEach((x) => push(x, path));
    }
  }
  return out;
}

function mailSummary(d: Obj, items: MailItem[]): string | null {
  const opCount = Number(nv(prop(d, 'OperationProperties'), 'OperationCount') ?? prop(d, 'OperationCount') ?? 0);
  const n = Math.max(items.length, opCount || 0);
  const first = items.find((i) => i.subject)?.subject ?? null;
  if (first) return n > 1 ? `${first} (+${n - 1} more)` : first;
  if (n > 0) return `${n} email${n === 1 ? '' : 's'} (no subject recorded)`;
  return null;
}

function firstTargetId(d: Obj): string | null {
  const t = prop(d, 'Target');
  if (!Array.isArray(t)) return null;
  for (const x of t) {
    const id = str(prop(x as Obj, 'ID'));
    if (id && !GUID_RX.test(id) && !/^(User|Group|ServicePrincipal|Application|Role|Policy|Device|Other|Directory|Tenant)_/i.test(id)) return id;
  }
  for (const x of t) { const id = str(prop(x as Obj, 'ID')); if (id) return id; }
  return null;
}

function modifiedSummary(d: Obj, max = 2): string | null {
  const mp = prop(d, 'ModifiedProperties');
  if (!Array.isArray(mp)) return null;
  const parts: string[] = [];
  for (const p of mp) {
    const o = p as Obj;
    const name = str(prop(o, 'Name'));
    if (!name || /Included Updated Properties|TargetId\./i.test(name)) continue;
    const nvv = str(prop(o, 'NewValue'));
    parts.push(nvv ? `${name}: ${truncate(nvv.replace(/^\[\s*"?|"?\s*\]$/g, ''), 80)}` : name);
    if (parts.length >= max) break;
  }
  return parts.length ? parts.join(' · ') : null;
}

export interface Described { kind: EventKind; item: string | null; detail: string | null; counterpart: string | null; messageId: string | null; networkMessageId: string | null }

/** Classify a Purview record and pick its human "item" and "detail" strings. */
export function describe(d: Obj, workload: string | null, recordType: string | null, operationKey: string, userUpn: string | null): Described {
  const wl = (workload ?? '').toLowerCase();
  const rt = (recordType ?? '').toLowerCase();
  const out: Described = { kind: 'other', item: null, detail: null, counterpart: null, messageId: null, networkMessageId: null };

  if (operationKey === 'tiurlclickdata') {
    out.kind = 'click';
    out.item = str(prop(d, 'Url'));
    const a = str(prop(d, 'URLClickAction'));
    const thru = prop(d, 'IsClickedThrough');
    out.detail = [a ? `Action ${a}` : null, thru === true || thru === 'True' ? 'clicked through' : null].filter(Boolean).join(' · ') || null;
    out.networkMessageId = lower(prop(d, 'NetworkMessageId'));
    return out;
  }
  if (operationKey === 'timaildata' || rt === 'threatintelligence' || rt === 'threatintelligenceatpcontent') {
    out.kind = 'msg';
    out.item = str(prop(d, 'Subject'));
    const sender = lower(prop(d, 'P1Sender')) ?? lower(prop(d, 'P2Sender'));
    out.counterpart = sender;
    out.detail = [sender ? `from ${sender}` : null, str(prop(d, 'Verdict')), str(prop(d, 'DeliveryAction')) ?? str(prop(d, 'Delivery Action'))].filter(Boolean).join(' · ') || null;
    out.messageId = normalizeMessageId(prop(d, 'InternetMessageId'));
    out.networkMessageId = lower(prop(d, 'NetworkMessageId'));
    return out;
  }
  if (operationKey === 'userloggedin' || operationKey === 'userloginfailed' || operationKey === 'userloggedoff' || /stslogon|accountlogon/.test(rt)) {
    out.kind = 'signin';
    const app = appName(str(prop(d, 'ApplicationId')) ?? str(prop(d, 'AppId')));
    const res = appName(str(prop(d, 'ObjectId')));
    out.item = app || res || null;
    const err = str(prop(d, 'LogonError'));
    const rtype = nv(prop(d, 'ExtendedProperties'), 'RequestType');
    out.detail = [res && res !== app ? `to ${res}` : null, err, rtype && !err ? rtype : null].filter(Boolean).join(' · ') || null;
    return out;
  }
  if (operationKey === 'copilotinteraction' || rt.includes('copilot') || rt === 'aiappinteraction') {
    out.kind = 'copilot';
    const ced = prop(d, 'CopilotEventData') as Obj | undefined;
    const host = str(prop(ced, 'AppHost'));
    const res = prop(ced, 'AccessedResources');
    const n = Array.isArray(res) ? res.length : 0;
    out.item = host ? `Copilot in ${host}` : 'Copilot';
    out.detail = n ? `${n} resource${n === 1 ? '' : 's'} accessed` : null;
    return out;
  }
  if (wl === 'exchange' || rt.startsWith('exchange')) {
    const items = mailItems(d);
    if (items.length || operationKey === 'mailitemsaccessed' || rt.startsWith('exchangeitem')) {
      out.kind = 'mail';
      out.item = mailSummary(d, items);
      const folders = [...new Set(items.map((i) => i.folder).filter(Boolean))] as string[];
      const dest = prop(d, 'DestFolder') as Obj | undefined;
      const destPath = str(prop(dest, 'Path'));
      const access = nv(prop(d, 'OperationProperties'), 'MailAccessType');
      out.detail = [folders.slice(0, 2).join(', ') + (folders.length > 2 ? ` +${folders.length - 2}` : ''), destPath ? `→ ${destPath}` : null, access === 'Sync' ? 'folder sync' : null].filter(Boolean).join(' ') || null;
      const owner = lower(prop(d, 'MailboxOwnerUPN'));
      out.counterpart = owner && owner !== userUpn ? owner : null;
      out.messageId = items.find((i) => i.mid)?.mid ?? null;
      return out;
    }
    const params = prop(d, 'Parameters');
    if (Array.isArray(params) || rt === 'exchangeadmin') {
      out.kind = 'admin';
      const p = nvObject(params);
      out.item = p.Identity ?? p.Mailbox ?? str(prop(d, 'ObjectId'));
      const rest = Object.entries(p).filter(([k]) => !/^(Identity|Mailbox|ErrorAction|Confirm|Force|DomainController|WarningAction|Verbose)$/i.test(k)).slice(0, 3).map(([k, v]) => `${k}=${truncate(v, 60)}`);
      out.detail = rest.join(' · ') || null;
      return out;
    }
  }
  if (wl === 'sharepoint' || wl === 'onedrive' || prop(d, 'SourceFileName') != null || prop(d, 'SiteUrl') != null) {
    out.kind = 'file';
    const obj = str(prop(d, 'ObjectId'));
    out.item = str(prop(d, 'SourceFileName')) ?? lastSegment(obj);
    const site = str(prop(d, 'SiteUrl'));
    let sitePath: string | null = null;
    if (site) { try { sitePath = new URL(site).pathname; } catch { sitePath = site; } }
    const rel = str(prop(d, 'SourceRelativeUrl'));
    const target = str(prop(d, 'TargetUserOrGroupName'));
    out.detail = [sitePath ? sitePath + (rel ? '/' + rel : '') : rel, target ? `→ ${target}` : null].filter(Boolean).join(' ') || null;
    out.counterpart = target ? target.toLowerCase() : null;
    return out;
  }
  if (wl === 'microsoftteams' || rt.startsWith('microsoftteams')) {
    out.kind = 'teams';
    const team = str(prop(d, 'TeamName')), ch = str(prop(d, 'ChannelName')), chat = str(prop(d, 'ChatName'));
    out.item = team ? team + (ch ? ' › ' + ch : '') : chat ?? (str(prop(d, 'CommunicationType')) === 'Meeting' ? 'Meeting' : null) ?? str(prop(d, 'ObjectId'));
    const members = prop(d, 'Members');
    out.detail = [str(prop(d, 'CommunicationType')), str(prop(d, 'ChannelType')), str(prop(d, 'ItemName')), Array.isArray(members) ? `${members.length} member${members.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || null;
    return out;
  }
  if (wl === 'azureactivedirectory' || rt.startsWith('azureactivedirectory')) {
    out.kind = 'dir';
    out.item = firstTargetId(d) ?? str(prop(d, 'ObjectId'));
    out.detail = modifiedSummary(d);
    out.counterpart = out.item && out.item.includes('@') ? out.item.toLowerCase() : null;
    return out;
  }
  out.item = str(prop(d, 'ObjectId')) ?? str(prop(d, 'ItemName')) ?? str(prop(d, 'Name'));
  return out;
}

export function normalizePurview(row: Record<string, unknown>, ctx: NormalizeContext): NormalizedEvent[] {
  const col = ctx.col;
  const adCol = col('auditdata');
  let d: Obj | null = adCol ? parseJsonMaybe(row[adCol]) : null;
  const envelope: Obj = {};
  if (adCol) for (const [k, v] of Object.entries(row)) if (k !== adCol) envelope[k] = v;
  if (!d) {
    // A bare AuditData object (JSON export of records) — the row IS the record.
    if (!adCol && (prop(row, 'Operation') != null || prop(row, 'RecordType') != null)) d = row as Obj;
    else d = {};
  }

  const operation = str(prop(d, 'Operation')) ?? (col('op') ? str(row[col('op')!]) : null) ?? 'Unknown';
  const operationKey = normalizeOperationKey(operation);
  const rtRaw = prop(d, 'RecordType') ?? (col('rt') ? row[col('rt')!] : null);
  const resolved = resolveRecordType(rtRaw);
  const recordTypeId = resolved.id;
  const recordType = resolved.name ?? (recordTypeId != null ? `RecordType ${recordTypeId}` : null);
  const workload = str(prop(d, 'Workload')) ?? (recordType ? inferWorkload(recordType) : null);
  const userUpn = lower(prop(d, 'UserId')) ?? (col('user') ? lower(row[col('user')!]) : null);
  const ts = toIso(prop(d, 'CreationTime')) ?? (col('date') ? toIso(row[col('date')!]) : null);
  const id = str(prop(d, 'Id')) ?? (col('id') ? str(row[col('id')!]) : null) ?? hashKey(ts, userUpn, operation, JSON.stringify(d).slice(0, 2000));

  const ext = prop(d, 'ExtendedProperties');
  const clientIp = cleanIp(prop(d, 'ClientIP') ?? prop(d, 'ClientIPAddress') ?? prop(d, 'ActorIpAddress') ?? prop(d, 'ClientIp') ?? prop(d, 'IPAddress') ?? prop(d, 'UserIp') ?? nv(ext, 'ClientIP') ?? nv(ext, 'IpAddress'));
  const userAgent = str(prop(d, 'UserAgent')) ?? nv(ext, 'UserAgent') ?? str(prop(d, 'ClientInfoString'));
  let result = str(prop(d, 'ResultStatus'));
  if (result === 'True') result = 'Succeeded'; else if (result === 'False') result = 'Failed';
  const failed = operationKey === 'userloginfailed' || /fail|error/i.test(result ?? '');
  if (operationKey === 'userloginfailed' && !result) result = 'Failed';
  const aac = prop(d, 'AppAccessContext') as Obj | undefined;
  const sessionId = str(prop(aac, 'AADSessionId')) ?? str(prop(d, 'SessionId')) ?? nv(prop(d, 'DeviceProperties'), 'SessionId') ?? nv(ext, 'SessionId');
  const correlationId = str(prop(aac, 'CorrelationId')) ?? str(prop(d, 'CorrelationId')) ?? str(prop(d, 'ClientRequestId')) ?? nv(ext, 'CorrelationId');
  const ut = prop(d, 'UserType');
  const userType = typeof ut === 'number' ? USER_TYPES[ut] ?? String(ut) : str(ut);

  const desc = describe(d, workload, recordType, operationKey, userUpn);

  return [{
    source: 'purview',
    sourceRecordId: id,
    ts,
    workload,
    workloadGroup: workloadGroupFor(workload, recordType),
    recordType,
    recordTypeId,
    operation,
    operationKey,
    kind: desc.kind,
    userUpn,
    userType,
    objectId: truncate(str(prop(d, 'ObjectId')), 1000),
    item: truncate(desc.item),
    detail: truncate(desc.detail),
    clientIp,
    userAgent: truncate(userAgent, 500),
    result,
    failed,
    sessionId,
    correlationId,
    messageId: desc.messageId,
    networkMessageId: desc.networkMessageId,
    counterpart: desc.counterpart,
    raw: d,
    envelope: Object.keys(envelope).length ? envelope : null,
  }];
}

function inferWorkload(rt: string): string | null {
  if (/^Exchange/.test(rt)) return 'Exchange';
  if (/^SharePoint/.test(rt)) return 'SharePoint';
  if (/^OneDrive/.test(rt)) return 'OneDrive';
  if (/^AzureActiveDirectory/.test(rt)) return 'AzureActiveDirectory';
  if (/^MicrosoftTeams/.test(rt)) return 'MicrosoftTeams';
  return null;
}
