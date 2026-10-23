import type { DetectedFormat } from './types.js';
import { normalizeHeaderKey } from './util.js';

/**
 * Decide what kind of export a row set is, from its header names (CSV) or object keys (JSON).
 * Header matching is forgiving: case, spaces, underscores, dashes and parentheses are ignored,
 * so "Date (UTC)", "date_utc" and "DateUTC" are the same key.
 */
export function detectFormat(sample: Record<string, unknown>[]): DetectedFormat {
  const keys = new Set<string>();
  const original = new Map<string, string>();
  for (const row of sample) {
    for (const k of Object.keys(row)) {
      const nk = normalizeHeaderKey(k);
      keys.add(nk);
      if (!original.has(nk)) original.set(nk, k);
    }
  }
  const has = (...names: string[]) => names.some((n) => keys.has(n));
  const first = (...names: string[]) => { for (const n of names) if (keys.has(n)) return original.get(n)!; return undefined; };
  const columns: Record<string, string> = {};
  const map = (role: string, ...names: string[]) => { const c = first(...names); if (c) columns[role] = c; };
  const notes: string[] = [];

  // --- Purview unified audit log (AuditData column or a bare AuditData object) ---
  if (has('auditdata') || (has('recordtype') && has('operation', 'operations') && has('creationtime', 'creationdate'))) {
    map('auditdata', 'auditdata');
    map('date', 'creationdate', 'creationtime', 'dateutc', 'date');
    map('user', 'userids', 'userid', 'user');
    map('op', 'operations', 'operation', 'activity');
    map('rt', 'recordtype');
    map('id', 'recordid', 'identity', 'id');
    map('adminunits', 'associatedadminunits');
    const label = has('recordid') ? 'Purview audit export (new portal)' : has('runspaceid') || has('resultindex') ? 'Search-UnifiedAuditLog export' : 'Purview audit export';
    return { source: 'purview', label, columns, notes };
  }

  // --- Graph-shaped JSON objects ---
  if (has('activitydisplayname') && (has('targetresources') || has('initiatedby') || has('loggedbyservice'))) {
    return { source: 'entra_audit', label: 'Entra ID audit log (JSON)', columns, notes };
  }
  if (has('riskeventtype') && (has('riskstate') || has('risklevel'))) {
    return { source: 'entra_risk', label: 'Entra ID Protection risk detections', columns, notes };
  }

  // --- Entra sign-in log (CSV or JSON) ---
  if ((has('requestid', 'correlationid', 'createddatetime') && has('ipaddress')) || (has('userprincipalname') && has('appdisplayname'))) {
    map('date', 'dateutc', 'createddatetime', 'date');
    map('user', 'username', 'userprincipalname', 'user');
    map('userDisplay', 'user', 'userdisplayname');
    map('userId', 'userid');
    map('userType', 'usertype');
    map('app', 'application', 'appdisplayname');
    map('appId', 'applicationid', 'appid');
    map('res', 'resource', 'resourcedisplayname');
    map('resId', 'resourceid');
    map('ip', 'ipaddress');
    map('loc', 'location');
    map('status', 'status');
    map('code', 'signinerrorcode', 'errorcode');
    map('reason', 'failurereason');
    map('ua', 'useragent');
    map('client', 'clientapp', 'clientappused');
    map('os', 'operatingsystem');
    map('browser', 'browser');
    map('device', 'deviceid');
    map('mfa', 'multifactorauthenticationresult');
    map('mfaMethod', 'multifactorauthenticationauthmethod');
    map('ca', 'conditionalaccess', 'conditionalaccessstatus');
    map('sid', 'sessionid');
    map('rid', 'requestid', 'id');
    map('cid', 'correlationid');
    map('inter', 'isinteractive');
    map('tokenType', 'incomingtokentype');
    map('authReq', 'authenticationrequirement');
    map('risk', 'risklevelduringsignin');
    map('riskAgg', 'risklevelaggregated');
    map('riskState', 'riskstate');
    map('spName', 'serviceprincipalname');
    map('spId', 'serviceprincipalid');
    map('asn', 'autonomoussystemnumber');
    const isJson = has('createddatetime');
    return { source: 'entra_signin', label: isJson ? 'Entra ID sign-in log (JSON)' : 'Entra ID sign-in log (CSV)', columns, notes };
  }

  // --- Entra audit log CSV (flattened Target1…/AdditionalDetail1…) ---
  if (has('activity') && has('category') && has('correlationid') && !has('auditdata')) {
    map('date', 'dateutc', 'activitydatetime', 'date');
    map('activity', 'activity');
    map('category', 'category');
    map('service', 'service');
    map('result', 'result');
    map('resultReason', 'resultreason');
    map('actorUpn', 'actoruserprincipalname');
    map('actorName', 'actordisplayname');
    map('actorSp', 'actorserviceprincipalname');
    map('actorType', 'actortype');
    map('actorIp', 'actoripaddress');
    map('cid', 'correlationid');
    map('id', 'id');
    return { source: 'entra_audit', label: 'Entra ID audit log (CSV)', columns, notes };
  }

  // --- Exchange message trace ---
  if (!has('auditdata') && ((has('senderaddress', 'sender_address') && has('recipientaddress', 'recipientstatus', 'recipient_status')) || has('messagetraceid'))) {
    map('date', 'received', 'origintimestamputc', 'origintimestamp', 'datetimeutc', 'date', 'timestamp');
    map('sender', 'senderaddress', 'sender_address');
    map('rcpt', 'recipientaddress', 'recipient_address');
    map('rstatus', 'recipientstatus', 'recipient_status');
    map('subject', 'subject', 'messagesubject', 'message_subject');
    map('status', 'status', 'deliverystatus', 'eventtype', 'eventid', 'event_id');
    map('mid', 'messageid', 'message_id', 'internetmessageid');
    map('nmid', 'networkmessageid', 'network_message_id');
    map('fromip', 'fromip', 'originalclientip', 'original_client_ip', 'senderip', 'clientip', 'client_ip');
    map('toip', 'toip', 'serverip', 'server_ip');
    map('size', 'size', 'totalbytes', 'total_bytes');
    map('dir', 'directionality', 'direction');
    map('tid', 'messagetraceid');
    map('connector', 'connectorid', 'connector_id');
    const label = has('event_id', 'eventid') ? 'Message trace — extended report' : has('messagetraceid') ? 'Get-MessageTrace export' : 'Message trace — enhanced summary';
    return { source: 'message_trace', label, columns, notes };
  }

  // --- Defender for Office 365 (Advanced Hunting / Threat Explorer) ---
  if (!has('auditdata') && (has('networkmessageid') || (has('url') && has('accountupn')) || has('deliveryaction'))) {
    map('table', 'table', 'tablename', 'source', '$table');
    map('date', 'timestamp', 'emaildateutc', 'datetimeutc', 'date', 'timereceived');
    map('nmid', 'networkmessageid');
    map('mid', 'internetmessageid');
    map('rcpt', 'recipientemailaddress', 'recipients', 'recipient');
    map('sender', 'senderfromaddress', 'senderaddress', 'sender', 'sendermailfromaddress');
    map('senderIp', 'senderipv4', 'senderip');
    map('subject', 'subject');
    map('dact', 'deliveryaction');
    map('dloc', 'deliverylocation', 'latestdeliverylocation', 'originaldeliverylocation');
    map('threats', 'threattypes', 'threats', 'threattype');
    map('threatNames', 'threatnames');
    map('detection', 'detectionmethods', 'detectiontechnology');
    map('dir', 'emaildirection', 'directionality');
    map('actionType', 'actiontype');
    map('action', 'action');
    map('actionResult', 'actionresult');
    map('url', 'url');
    map('urlDomain', 'urldomain');
    map('urlLocation', 'urllocation');
    map('user', 'accountupn', 'userprincipalname', 'user');
    map('ip', 'ipaddress');
    map('thru', 'isclickedthrough');
    map('workload', 'workload');
    map('app', 'appname');
    map('fileName', 'filename');
    map('fileType', 'filetype');
    map('sha256', 'sha256');
    map('reportId', 'reportid');
    const sub = has('table', 'tablename', '$table') ? 'union' : has('filename') && has('sha256') ? 'attachment' : has('url') && (has('accountupn') || has('actiontype')) && !has('recipientemailaddress') ? 'click' : has('url') && !has('recipientemailaddress') ? 'urlinfo' : has('actiontype') && !has('deliveryaction') && has('recipientemailaddress') ? 'post' : 'email';
    const source = sub === 'union' ? 'defender_email' : sub === 'click' ? 'defender_url_click' : sub === 'urlinfo' ? 'defender_url_info' : sub === 'post' ? 'defender_post_delivery' : sub === 'attachment' ? 'defender_attachment' : 'defender_email';
    const labels: Record<string, string> = { union: 'Defender advanced hunting (union of email tables)', click: 'Defender UrlClickEvents', urlinfo: 'Defender EmailUrlInfo', post: 'Defender EmailPostDeliveryEvents', attachment: 'Defender EmailAttachmentInfo', email: 'Defender EmailEvents / Threat Explorer' };
    columns.__sub = sub;
    return { source, label: labels[sub], columns, notes };
  }

  return { source: 'unknown', label: 'Unrecognised export', columns, notes: ['No AuditData, sign-in, message trace or Defender columns found.'] };
}
