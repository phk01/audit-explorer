import type { NormalizedEvent, NormalizeContext, EventKind } from './types.js';
import type { SourceId } from '../catalog/sources.js';
import { str, lower, toIso, truncate, hashKey, normalizeMessageId, splitAddresses } from './util.js';
import { normalizeOperationKey } from '../catalog/activities.js';
import { cleanIp } from '@audit/ipdata';

type Obj = Record<string, unknown>;

const get = (row: Obj, ctx: NormalizeContext, role: string): unknown => {
  const c = ctx.col(role);
  return c ? row[c] : undefined;
};

export function traceStatusLabel(s: string | null): string | null {
  if (!s) return null;
  const k = s.toLowerCase();
  const map: [RegExp, string][] = [
    [/^deliver/, 'Delivered'], [/^fail/, 'Failed'], [/^drop/, 'Dropped'], [/^defer|^gettingstatus|^pending/, 'Pending'],
    [/^quarantin/, 'Quarantined'], [/^filteredasspam|^spam/, 'Junk'], [/^expand/, 'Expanded (distribution list)'],
    [/^receive/, 'Received'], [/^resolve/, 'Resolved'], [/^send$/, 'Sent'], [/^recall/, 'Recalled'], [/^replac/, 'Replaced'],
  ];
  for (const [rx, label] of map) if (rx.test(k)) return label;
  return s;
}

const UNDELIVERED_RX = /fail|block|quarant|junk|drop|reject|replac|expired|deferred/i;

/** Exchange message trace: enhanced summary, extended report, Get-MessageTrace(V2) exports. One event per recipient. */
export function normalizeMessageTrace(row: Obj, ctx: NormalizeContext): NormalizedEvent[] {
  const g = (r: string) => get(row, ctx, r);
  const ts = toIso(g('date'));
  const sender = lower(g('sender'));
  const subject = str(g('subject'));
  const mid = normalizeMessageId(g('mid'));
  const nmid = lower(g('nmid'));
  const fromIp = cleanIp(g('fromip'));
  const size = str(g('size'));
  const dir = str(g('dir'));
  const tid = str(g('tid'));
  const baseStatus = str(g('status'));

  const recipients: { addr: string; status: string | null }[] = [];
  const rstatus = str(g('rstatus'));
  if (rstatus) {
    for (const part of rstatus.split(';')) {
      const [addr, st] = part.split('##');
      const a = addr?.trim().toLowerCase();
      if (!a) continue;
      const last = st ? st.split(',').pop()!.trim() : null;
      recipients.push({ addr: a, status: last });
    }
  }
  const single = lower(g('rcpt'));
  if (!recipients.length && single) for (const a of splitAddresses(single)) recipients.push({ addr: a, status: baseStatus });
  if (!recipients.length) recipients.push({ addr: '', status: baseStatus });

  return recipients.map(({ addr, status }) => {
    const label = traceStatusLabel(status ?? baseStatus);
    const failed = UNDELIVERED_RX.test(status ?? baseStatus ?? '');
    const id = 'mt|' + hashKey(tid ?? mid ?? nmid ?? ts, addr, status ?? baseStatus, ts);
    return {
      source: 'message_trace',
      sourceRecordId: id,
      ts,
      workload: 'MessageTrace',
      workloadGroup: 'exchange',
      recordType: 'MessageTrace',
      recordTypeId: null,
      operation: 'EmailDelivery',
      operationKey: 'emaildelivery',
      kind: 'msg' as EventKind,
      userUpn: addr || null,
      userType: null,
      objectId: mid,
      item: truncate(subject),
      detail: truncate([sender ? `from ${sender}` : null, dir, fromIp ? `sender IP ${fromIp}` : null, size ? `${Math.round(+size / 1024)} KB` : null].filter(Boolean).join(' · ') || null),
      clientIp: fromIp,
      userAgent: null,
      result: label,
      failed,
      sessionId: null,
      correlationId: tid,
      messageId: mid,
      networkMessageId: nmid,
      counterpart: sender,
      raw: row,
      envelope: null,
    };
  });
}

function clickLabel(action: string | null, thru: unknown): string | null {
  if (action == null) return null;
  const n = Number(action);
  let label: string;
  if (!Number.isNaN(n) && action.trim() !== '') label = ['None', 'Blocked', 'Scan in progress', 'Clicked through block page', 'Clicked through scan page', 'Pending detonation override'][n] ?? action;
  else if (/^ClickAllowed$/i.test(action)) label = 'Allowed';
  else if (/^ClickBlocked/i.test(action)) label = 'Blocked';
  else if (/UrlScanInProgress/i.test(action)) label = 'Scan in progress';
  else if (/UrlErrorPage/i.test(action)) label = 'Error page';
  else label = action;
  if (thru === true || String(thru).toLowerCase() === 'true') label += ' (clicked through warning)';
  return label;
}

/** Defender for Office 365 advanced-hunting / Threat Explorer exports. Handles the union-of-tables export too. */
export function normalizeDefender(row: Obj, ctx: NormalizeContext): NormalizedEvent[] {
  const g = (r: string) => get(row, ctx, r);
  let sub = ctx.format.columns.__sub ?? 'email';
  if (sub === 'union') {
    const t = (str(g('table')) ?? '').toLowerCase();
    sub = t.includes('urlclick') ? 'click' : t.includes('urlinfo') ? 'urlinfo' : t.includes('postdelivery') ? 'post' : t.includes('attachment') ? 'attachment' : 'email';
  }
  const ts = toIso(g('date'));
  const nmid = lower(g('nmid'));
  const mid = normalizeMessageId(g('mid'));
  const sender = lower(g('sender'));
  const subject = str(g('subject'));
  const threats = str(g('threats'));
  const dir = str(g('dir'));

  if (sub === 'click') {
    const user = lower(g('user'));
    const url = str(g('url'));
    const action = str(g('actionType')) ?? str(g('action'));
    const label = clickLabel(action, g('thru'));
    const blocked = /block/i.test(label ?? '') && !/through/i.test(label ?? '');
    return [{
      source: 'defender_url_click' as SourceId, sourceRecordId: 'uc|' + hashKey(nmid, user, ts, url), ts,
      workload: 'SafeLinks', workloadGroup: 'security', recordType: 'UrlClickEvents', recordTypeId: null,
      operation: 'LinkClicked', operationKey: 'linkclicked', kind: 'click', userUpn: user, userType: null,
      objectId: url, item: truncate(url), detail: truncate([label, str(g('workload')), threats ? `threats: ${threats}` : null, str(g('app'))].filter(Boolean).join(' · ') || null),
      clientIp: cleanIp(g('ip')), userAgent: null, result: label, failed: blocked, sessionId: null, correlationId: str(g('reportId')),
      messageId: null, networkMessageId: nmid, counterpart: null, raw: row, envelope: null,
    }];
  }
  if (sub === 'urlinfo') {
    const url = str(g('url'));
    return [{
      source: 'defender_url_info', sourceRecordId: 'ui|' + hashKey(nmid, url, str(g('urlLocation'))), ts,
      workload: 'DefenderEmail', workloadGroup: 'security', recordType: 'EmailUrlInfo', recordTypeId: null,
      operation: 'EmailUrlInfo', operationKey: 'emailurlinfo', kind: 'urlinfo', userUpn: null, userType: null,
      objectId: url, item: truncate(url), detail: truncate([str(g('urlDomain')), str(g('urlLocation'))].filter(Boolean).join(' · ') || null),
      clientIp: null, userAgent: null, result: null, failed: false, sessionId: null, correlationId: str(g('reportId')),
      messageId: null, networkMessageId: nmid, counterpart: null, raw: row, envelope: null,
    }];
  }
  if (sub === 'attachment') {
    const rcpt = lower(g('rcpt'));
    const file = str(g('fileName'));
    return [{
      source: 'defender_attachment', sourceRecordId: 'ea|' + hashKey(nmid, rcpt, file, str(g('sha256'))), ts,
      workload: 'DefenderEmail', workloadGroup: 'security', recordType: 'EmailAttachmentInfo', recordTypeId: null,
      operation: 'EmailAttachment', operationKey: 'emailattachment', kind: 'attachment', userUpn: rcpt, userType: null,
      objectId: str(g('sha256')), item: truncate(file), detail: truncate([str(g('fileType')), threats ? `threats: ${threats}` : null, sender ? `from ${sender}` : null].filter(Boolean).join(' · ') || null),
      clientIp: null, userAgent: null, result: threats, failed: !!threats, sessionId: null, correlationId: str(g('reportId')),
      messageId: null, networkMessageId: nmid, counterpart: sender, raw: row, envelope: null,
    }];
  }
  if (sub === 'post') {
    const rcpt = lower(g('rcpt'));
    const actionType = str(g('actionType'));
    const action = str(g('action'));
    return [{
      source: 'defender_post_delivery', sourceRecordId: 'pd|' + hashKey(nmid, rcpt, actionType, ts), ts,
      workload: 'DefenderEmail', workloadGroup: 'security', recordType: 'EmailPostDeliveryEvents', recordTypeId: null,
      operation: actionType ?? 'EmailPostDelivery', operationKey: normalizeOperationKey(actionType ?? 'EmailPostDelivery'), kind: 'msgpost', userUpn: rcpt, userType: null,
      objectId: mid, item: truncate(action ?? subject), detail: truncate([str(g('dloc')), threats ? `threats: ${threats}` : null, str(g('actionResult'))].filter(Boolean).join(' · ') || null),
      clientIp: null, userAgent: null, result: action ?? str(g('actionResult')), failed: false, sessionId: null, correlationId: str(g('reportId')),
      messageId: mid, networkMessageId: nmid, counterpart: sender, raw: row, envelope: null,
    }];
  }
  // email events — one per recipient
  const rcpts = splitAddresses(g('rcpt'));
  if (!rcpts.length) rcpts.push('');
  const dact = str(g('dact'));
  const dloc = str(g('dloc'));
  return rcpts.map((rcpt) => ({
    source: 'defender_email' as SourceId, sourceRecordId: 'ee|' + hashKey(nmid ?? mid ?? ts, rcpt, dact, ts), ts,
    workload: 'DefenderEmail', workloadGroup: 'security', recordType: 'EmailEvents', recordTypeId: null,
    operation: 'EmailDelivery', operationKey: 'emaildelivery', kind: 'msg' as EventKind, userUpn: rcpt || null, userType: null,
    objectId: mid, item: truncate(subject), detail: truncate([sender ? `from ${sender}` : null, dloc, threats ? `threats: ${threats}` : null, str(g('detection')), dir].filter(Boolean).join(' · ') || null),
    clientIp: cleanIp(g('senderIp')), userAgent: null, result: dact, failed: UNDELIVERED_RX.test(dact ?? '') || !!threats, sessionId: null, correlationId: str(g('reportId')),
    messageId: mid, networkMessageId: nmid, counterpart: sender, raw: row, envelope: null,
  }));
}
