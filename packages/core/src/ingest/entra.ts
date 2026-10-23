import type { NormalizedEvent, NormalizeContext } from './types.js';
import { str, lower, toIso, prop, truncate, hashKey, parseJsonMaybe } from './util.js';
import { normalizeOperationKey } from '../catalog/activities.js';
import { cleanIp } from '@audit/ipdata';

type Obj = Record<string, unknown>;

const get = (row: Obj, ctx: NormalizeContext, role: string): unknown => {
  const c = ctx.col(role);
  return c ? row[c] : undefined;
};

/** Entra ID sign-in logs — CSV download (friendly headers) or Graph signIn JSON. */
export function normalizeEntraSignIn(row: Obj, ctx: NormalizeContext): NormalizedEvent[] {
  const g = (r: string) => get(row, ctx, r);
  const ts = toIso(g('date'));
  const statusRaw = g('status');
  const statusObj = typeof statusRaw === 'object' && statusRaw ? (statusRaw as Obj) : parseJsonMaybe(statusRaw);
  const code = statusObj ? Number(prop(statusObj, 'errorCode') ?? 0) : Number(str(g('code')) ?? 0);
  const reason = statusObj ? str(prop(statusObj, 'failureReason')) : str(g('reason'));
  const statusText = statusObj ? null : str(statusRaw);
  const interrupted = /interrupt/i.test(statusText ?? '') || /interrupt/i.test(reason ?? '');
  const failed = !interrupted && (/fail/i.test(statusText ?? '') || (!!code && code !== 0));
  const result = failed ? 'Failed' : interrupted ? 'Interrupted' : 'Success';

  const locRaw = g('loc');
  let loc = str(locRaw);
  const locObj = typeof locRaw === 'object' && locRaw ? (locRaw as Obj) : null;
  if (locObj) loc = [str(prop(locObj, 'city')), str(prop(locObj, 'state')), str(prop(locObj, 'countryOrRegion'))].filter(Boolean).join(', ') || null;

  const dev = prop(row, 'deviceDetail') as Obj | undefined;
  const ua = str(g('ua'));
  const browser = str(g('browser')) ?? str(prop(dev, 'browser'));
  const os = str(g('os')) ?? str(prop(dev, 'operatingSystem'));
  const client = str(g('client'));
  const userUpn = lower(g('user')) ?? lower(g('spName'));
  const spName = str(g('spName'));
  const app = str(g('app')), res = str(g('res'));
  const mfa = str(g('mfa'));
  const ca = str(g('ca'));
  const types = prop(row, 'signInEventTypes');
  const inter = g('inter');
  const kindLabel = Array.isArray(types) && types.length ? String(types[0]) : inter === false || String(inter).toLowerCase() === 'false' ? 'nonInteractiveUser' : spName ? 'servicePrincipal' : 'interactiveUser';
  const authReq = str(g('authReq'));
  const risk = str(g('risk')) ?? str(g('riskAgg'));

  const operation = failed ? 'UserLoginFailed' : 'UserLoggedIn';
  const detail = [res ? `to ${res}` : null, loc, mfa ? `MFA: ${mfa}` : authReq ? authReq : null, ca ? `CA: ${ca}` : null, risk && risk !== 'none' ? `risk ${risk}` : null, reason ?? (code ? `Error ${code}` : null)].filter(Boolean).join(' · ') || null;
  const rid = str(g('rid')) ?? str(prop(row, 'id'));
  const id = rid ?? hashKey(ts, userUpn, str(g('ip')), app, String(code));

  return [{
    source: 'entra_signin',
    sourceRecordId: id,
    ts,
    workload: 'EntraSignIn',
    workloadGroup: 'identity',
    recordType: kindLabel === 'servicePrincipal' || kindLabel === 'managedIdentity' ? 'EntraServicePrincipalSignIn' : kindLabel === 'nonInteractiveUser' ? 'EntraNonInteractiveSignIn' : 'EntraInteractiveSignIn',
    recordTypeId: null,
    operation,
    operationKey: normalizeOperationKey(operation),
    kind: 'signin',
    userUpn,
    userType: spName ? 'ServicePrincipal' : str(g('userType')),
    objectId: str(g('resId')) ?? res,
    item: truncate(app),
    detail: truncate(detail),
    clientIp: cleanIp(g('ip')),
    userAgent: truncate(ua ?? ([browser, os].filter(Boolean).join(' / ') || client), 500),
    result,
    failed,
    sessionId: str(g('sid')),
    correlationId: str(g('cid')),
    messageId: null,
    networkMessageId: null,
    counterpart: null,
    raw: row,
    envelope: null,
  }];
}

/** Entra ID audit (directory) logs — Graph directoryAudit JSON or the flattened CSV. */
export function normalizeEntraAudit(row: Obj, ctx: NormalizeContext): NormalizedEvent[] {
  const g = (r: string) => get(row, ctx, r);
  const isJson = prop(row, 'activityDisplayName') != null;
  const operation = str(prop(row, 'activityDisplayName')) ?? str(g('activity')) ?? 'Unknown';
  const ts = toIso(prop(row, 'activityDateTime') ?? g('date'));
  let actor: string | null = null, actorIp: string | null = null, actorType: string | null = null;
  if (isJson) {
    const ib = prop(row, 'initiatedBy') as Obj | undefined;
    const u = prop(ib, 'user') as Obj | undefined, a = prop(ib, 'app') as Obj | undefined;
    actor = lower(prop(u, 'userPrincipalName')) ?? lower(prop(a, 'servicePrincipalName')) ?? lower(prop(a, 'displayName'));
    actorIp = cleanIp(prop(u, 'ipAddress'));
    actorType = u && prop(u, 'userPrincipalName') ? 'User' : a ? 'Application' : null;
  } else {
    actor = lower(g('actorUpn')) ?? lower(g('actorSp')) ?? lower(g('actorName'));
    actorIp = cleanIp(g('actorIp'));
    actorType = str(g('actorType'));
  }
  const resultRaw = str(prop(row, 'result')) ?? str(g('result'));
  const failed = /fail|timeout/i.test(resultRaw ?? '');
  const category = str(prop(row, 'category')) ?? str(g('category'));
  const service = str(prop(row, 'loggedByService')) ?? str(g('service'));

  let item: string | null = null, counterpart: string | null = null, changes: string | null = null;
  if (isJson) {
    const tr = prop(row, 'targetResources');
    if (Array.isArray(tr) && tr.length) {
      const t = tr[0] as Obj;
      item = str(prop(t, 'userPrincipalName')) ?? str(prop(t, 'displayName')) ?? str(prop(t, 'id'));
      counterpart = lower(prop(t, 'userPrincipalName'));
      const mp = prop(t, 'modifiedProperties');
      if (Array.isArray(mp)) changes = mp.slice(0, 2).map((m) => { const o = m as Obj; return `${str(prop(o, 'displayName'))}: ${truncate(str(prop(o, 'newValue'))?.replace(/^\[\s*"?|"?\s*\]$/g, '') ?? '', 60)}`; }).join(' · ') || null;
    }
  } else {
    item = str(prop(row, 'Target1UserPrincipalName')) ?? str(prop(row, 'Target1DisplayName')) ?? str(prop(row, 'Target1ObjectId'));
    counterpart = lower(prop(row, 'Target1UserPrincipalName'));
    const n = str(prop(row, 'Target1ModifiedProperty1Name'));
    if (n) changes = `${n}: ${truncate(str(prop(row, 'Target1ModifiedProperty1NewValue')) ?? '', 60)}`;
  }
  const detail = [category, changes, str(prop(row, 'resultReason')) ?? str(g('resultReason'))].filter(Boolean).join(' · ') || null;
  const id = str(prop(row, 'id')) ?? str(g('id')) ?? hashKey(ts, actor, operation, item, str(prop(row, 'correlationId')) ?? str(g('cid')));

  return [{
    source: 'entra_audit',
    sourceRecordId: id,
    ts,
    workload: 'EntraAudit',
    workloadGroup: 'identity',
    recordType: service ? `EntraAudit:${service}` : 'EntraAudit',
    recordTypeId: null,
    operation,
    operationKey: normalizeOperationKey(operation),
    kind: 'dir',
    userUpn: actor,
    userType: actorType,
    objectId: item,
    item: truncate(item),
    detail: truncate(detail),
    clientIp: actorIp,
    userAgent: null,
    result: resultRaw,
    failed,
    sessionId: null,
    correlationId: str(prop(row, 'correlationId')) ?? str(g('cid')),
    messageId: null,
    networkMessageId: null,
    counterpart,
    raw: row,
    envelope: null,
  }];
}

/** Entra ID Protection risk detections — Graph riskDetection JSON (or a CSV with the same fields). */
export function normalizeEntraRisk(row: Obj, _ctx: NormalizeContext): NormalizedEvent[] {
  const ts = toIso(prop(row, 'activityDateTime') ?? prop(row, 'detectedDateTime') ?? prop(row, 'Date (UTC)'));
  const type = str(prop(row, 'riskEventType')) ?? 'riskDetection';
  const level = str(prop(row, 'riskLevel')), state = str(prop(row, 'riskState')), rdetail = str(prop(row, 'riskDetail'));
  const loc = prop(row, 'location') as Obj | undefined;
  const locS = loc ? [str(prop(loc, 'city')), str(prop(loc, 'countryOrRegion'))].filter(Boolean).join(', ') : null;
  const user = lower(prop(row, 'userPrincipalName'));
  const id = str(prop(row, 'id')) ?? hashKey(ts, user, type, str(prop(row, 'ipAddress')));
  return [{
    source: 'entra_risk',
    sourceRecordId: id,
    ts,
    workload: 'EntraIdProtection',
    workloadGroup: 'security',
    recordType: 'AadRiskDetection',
    recordTypeId: 294,
    operation: type,
    operationKey: normalizeOperationKey(type),
    kind: 'risk',
    userUpn: user,
    userType: null,
    objectId: str(prop(row, 'userId')),
    item: truncate([level ? `${level} risk` : null, str(prop(row, 'activity'))].filter(Boolean).join(' · ') || type),
    detail: truncate([state, rdetail && rdetail !== 'none' ? rdetail : null, locS, str(prop(row, 'detectionTimingType'))].filter(Boolean).join(' · ') || null),
    clientIp: cleanIp(prop(row, 'ipAddress')),
    userAgent: null,
    result: state,
    failed: false,
    sessionId: null,
    correlationId: str(prop(row, 'correlationId')) ?? str(prop(row, 'requestId')),
    messageId: null,
    networkMessageId: null,
    counterpart: null,
    raw: row,
    envelope: null,
  }];
}
