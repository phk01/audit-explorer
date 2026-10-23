/**
 * Generates a fictional 10-day tenant export set for demos and tests:
 *   purview-audit.csv        new Purview portal export (RecordId, CreationDate, RecordType, Operation, UserId, AuditData, …)
 *   entra-signins.csv        Entra admin center interactive sign-in CSV
 *   entra-signins.json       Graph-shaped JSON (non-interactive)
 *   message-trace.csv        Exchange enhanced summary report
 *   defender-union.csv       Advanced hunting union of EmailEvents / UrlClickEvents / EmailUrlInfo / EmailPostDeliveryEvents
 *
 * Usage: tsx scripts/generate-sample.ts [outDir] [seed]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? './sample-data';
let seed = Number(process.argv[3] ?? 42);
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const guid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.floor(rnd() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); });

const DOMAIN = 'fabrikam-demo.dk';
const USERS = ['anna.holm', 'bo.nielsen', 'carla.sørensen', 'dan.jensen', 'eva.larsen', 'finn.poulsen', 'gitte.madsen', 'hans.kristensen', 'ida.thomsen', 'jonas.berg', 'karen.lund', 'lars.friis', 'mette.dahl', 'niels.ravn'].map((u) => `${u}@${DOMAIN}`);
const ADMIN = `it-admin@${DOMAIN}`;
const VICTIM = USERS[0];
const INSIDER = USERS[5];
const HOME_IPS: Record<string, string> = Object.fromEntries(USERS.map((u, i) => [u, `87.52.${100 + i}.${10 + i}`]));
const OFFICE_IP = '185.17.146.22';
const ATTACKER_IP = '45.142.212.61';   // NG
const ATTACKER_IP2 = '103.75.190.14';  // ID
const AZURE_IP = '20.56.88.101';
const M365_IP = '52.96.42.18';
const KEEPIT_IP = '185.221.245.37';
const SITE = `https://fabrikamdemo.sharepoint.com/sites/Finance`;

const start = Date.UTC(2026, 9, 5, 0, 0, 0); // 5 Oct 2026
const DAYS = 10;
const t = (day: number, hour: number, minute = Math.floor(rnd() * 60), second = Math.floor(rnd() * 60)) => new Date(start + day * 86400000 + hour * 3600000 + minute * 60000 + second * 1000);
const iso7 = (d: Date) => d.toISOString().replace('Z', '0000Z');
const isoPlain = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '');

interface P { ts: Date; rt: [number, string]; op: string; user: string; wl: string; ip?: string; ua?: string; extra?: Record<string, unknown>; result?: string }
const purview: P[] = [];
const UAS = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15', 'Outlook-iOS/2.0', 'Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17928)'];
const FILES = ['Budget 2027.xlsx', 'Q3 forecast.pptx', 'Supplier contracts.docx', 'Payroll October.xlsx', 'Board minutes.docx', 'Invoice 20481.pdf', 'Invoice 20482.pdf', 'Bank details.xlsx', 'Org chart.pdf', 'Strategy.pptx'];
const SUBJECTS = ['Faktura 20481', 'Re: Budget 2027', 'Board meeting agenda', 'Payment approval needed', 'FW: Supplier contract', 'Lunch Friday?', 'Overførsel bekræftelse', 'Q3 numbers', 'Password reset', 'Re: Re: Offer'];

// --- baseline activity ---
for (let day = 0; day < DAYS; day++) {
  const weekend = [6, 0].includes(new Date(start + day * 86400000).getUTCDay());
  for (const u of USERS) {
    if (weekend && rnd() < 0.8) continue;
    const ip = rnd() < 0.6 ? OFFICE_IP : HOME_IPS[u];
    const ua = pick(UAS);
    for (let i = 0; i < 2 + Math.floor(rnd() * 3); i++) {
      purview.push({ ts: t(day, 6 + Math.floor(rnd() * 11)), rt: [15, 'AzureActiveDirectoryStsLogon'], op: 'UserLoggedIn', user: u, wl: 'AzureActiveDirectory', ip, ua, extra: { ApplicationId: pick(['00000002-0000-0ff1-ce00-000000000000', '1fec8e78-bce4-4aaf-ab1b-5451cc387264', '00000003-0000-0ff1-ce00-000000000000']), ObjectId: '00000003-0000-0000-c000-000000000000', ExtendedProperties: [{ Name: 'UserAgent', Value: ua }, { Name: 'RequestType', Value: 'OAuth2:Authorize' }, { Name: 'ResultStatusDetail', Value: 'Success' }], DeviceProperties: [{ Name: 'OS', Value: 'Windows10' }, { Name: 'BrowserType', Value: 'Edge' }, { Name: 'SessionId', Value: `sess-${u.split('@')[0]}-${day}` }], Actor: [{ ID: u, Type: 5 }], Target: [{ ID: 'Microsoft Graph', Type: 1 }] } });
    }
    for (let i = 0; i < 3 + Math.floor(rnd() * 8); i++) {
      const f = pick(FILES);
      purview.push({ ts: t(day, 7 + Math.floor(rnd() * 10)), rt: [6, 'SharePointFileOperation'], op: pick(['FileAccessed', 'FileAccessed', 'FileModified', 'FileDownloaded', 'FilePreviewed', 'FileUploaded']), user: u, wl: 'SharePoint', ip, ua, extra: { ObjectId: `${SITE}/Shared Documents/${f}`, SiteUrl: SITE + '/', SourceRelativeUrl: 'Shared Documents', SourceFileName: f, SourceFileExtension: f.split('.').pop(), ItemType: 'File', EventSource: 'SharePoint', Site: '1a2b3c4d-0000-0000-0000-000000000001', ListId: guid(), ListItemUniqueId: guid() } });
    }
    for (let i = 0; i < 2 + Math.floor(rnd() * 6); i++) {
      const n = 1 + Math.floor(rnd() * 6);
      purview.push({ ts: t(day, 7 + Math.floor(rnd() * 10)), rt: [50, 'ExchangeItemAggregated'], op: 'MailItemsAccessed', user: u, wl: 'Exchange', ip, ua, extra: { MailboxOwnerUPN: u, LogonType: 0, ClientInfoString: ua.includes('Outlook-iOS') ? 'Client=OutlookService;Outlook-iOS/2.0' : 'Client=OWA;Action=ViaProxy', OperationProperties: [{ Name: 'MailAccessType', Value: 'Bind' }, { Name: 'IsThrottled', Value: 'False' }, { Name: 'OperationCount', Value: String(n) }], Folders: [{ Path: '\\Inbox', Id: guid(), FolderItems: Array.from({ length: n }, () => ({ Id: guid(), InternetMessageId: `<${guid()}@${DOMAIN}>`, Subject: pick(SUBJECTS), SizeInBytes: 2000 + Math.floor(rnd() * 90000) })) }] } });
    }
    if (rnd() < 0.5) purview.push({ ts: t(day, 8 + Math.floor(rnd() * 9)), rt: [2, 'ExchangeItem'], op: 'Send', user: u, wl: 'Exchange', ip, ua, extra: { MailboxOwnerUPN: u, LogonType: 0, Item: { Id: guid(), InternetMessageId: `<${guid()}@${DOMAIN}>`, Subject: pick(SUBJECTS), ParentFolder: { Path: '\\Sent Items' }, SizeInBytes: 12000 }, SaveToSentItems: true } });
    if (rnd() < 0.7) purview.push({ ts: t(day, 8 + Math.floor(rnd() * 9)), rt: [25, 'MicrosoftTeams'], op: pick(['MessageSent', 'MessageSent', 'TeamsSessionStarted', 'MeetingParticipantDetail', 'ChatCreated']), user: u, wl: 'MicrosoftTeams', ip, ua, extra: { TeamName: pick(['Finance', 'All staff', 'Project Nordlys']), ChannelName: 'General', CommunicationType: 'Channel', ChannelType: 'Standard', MessageId: guid() } });
    if (rnd() < 0.15) purview.push({ ts: t(day, 9 + Math.floor(rnd() * 8)), rt: [261, 'CopilotInteraction'], op: 'CopilotInteraction', user: u, wl: 'Copilot', ip, ua, extra: { CopilotEventData: { AppHost: pick(['Teams', 'Word', 'Outlook', 'BizChat']), ThreadId: guid(), AccessedResources: [{ Id: guid(), Name: pick(FILES), SiteUrl: SITE, Type: 'File', Action: 'Read' }], MessageIds: [guid()] } } });
    if (rnd() < 0.1) purview.push({ ts: t(day, 9 + Math.floor(rnd() * 8)), rt: [20, 'PowerBIAudit'], op: pick(['ViewReport', 'ViewDashboard', 'ExportReport']), user: u, wl: 'PowerBI', ip, ua, extra: { ReportName: 'Finance KPIs', WorkspaceName: 'Finance', Activity: 'ViewReport', ItemName: 'Finance KPIs', DatasetName: 'Finance model' } });
  }
  // Keepit backup reads everything each night
  purview.push({ ts: t(day, 2, 5), rt: [50, 'ExchangeItemAggregated'], op: 'MailItemsAccessed', user: `backup-svc@${DOMAIN}`, wl: 'Exchange', ip: KEEPIT_IP, ua: 'Keepit/4.0 (+https://www.keepit.com)', extra: { MailboxOwnerUPN: pick(USERS), LogonType: 1, OperationProperties: [{ Name: 'MailAccessType', Value: 'Sync' }, { Name: 'IsThrottled', Value: 'False' }, { Name: 'OperationCount', Value: '450' }], Folders: [{ Path: '\\Inbox', FolderItems: [] }] } });
  for (let i = 0; i < 40; i++) purview.push({ ts: t(day, 2 + Math.floor(rnd() * 2)), rt: [6, 'SharePointFileOperation'], op: 'FileSyncDownloadedFull', user: `backup-svc@${DOMAIN}`, wl: 'SharePoint', ip: KEEPIT_IP, ua: 'Keepit/4.0', extra: { ObjectId: `${SITE}/Shared Documents/${pick(FILES)}`, SiteUrl: SITE + '/', SourceFileName: pick(FILES), SourceRelativeUrl: 'Shared Documents' } });
  // routine M365 service events
  purview.push({ ts: t(day, 1), rt: [1, 'ExchangeAdmin'], op: 'Set-MailboxPlan', user: 'NT AUTHORITY\\SYSTEM (w3wp)', wl: 'Exchange', ip: M365_IP, extra: { Parameters: [{ Name: 'Identity', Value: 'ExchangeOnlineEnterprise' }, { Name: 'IssueWarningQuota', Value: '98 GB' }], ExternalAccess: true, OriginatingServer: 'CP1P152MB1234 (15.20.4200.000)' } });
}

// --- attack chain ---
// Day 2: password spray from ATTACKER_IP against 9 accounts, then brute force on VICTIM, success at 11:42
for (const u of USERS.slice(0, 9)) for (let i = 0; i < 2; i++) purview.push({ ts: t(2, 3, 10 + i * 7), rt: [15, 'AzureActiveDirectoryStsLogon'], op: 'UserLoginFailed', user: u, wl: 'AzureActiveDirectory', ip: ATTACKER_IP, ua: 'BAV2ROPC', result: 'Failed', extra: { ApplicationId: '00000002-0000-0ff1-ce00-000000000000', LogonError: 'InvalidUserNameOrPassword', ErrorNumber: '50126', ExtendedProperties: [{ Name: 'UserAgent', Value: 'BAV2ROPC' }, { Name: 'RequestType', Value: 'OAuth2:Token' }, { Name: 'ResultStatusDetail', Value: 'UserError' }] } });
for (let i = 0; i < 14; i++) purview.push({ ts: t(2, 11, i * 2, 12), rt: [15, 'AzureActiveDirectoryStsLogon'], op: 'UserLoginFailed', user: VICTIM, wl: 'AzureActiveDirectory', ip: ATTACKER_IP, ua: 'BAV2ROPC', result: 'Failed', extra: { ApplicationId: '00000002-0000-0ff1-ce00-000000000000', LogonError: 'InvalidUserNameOrPassword', ErrorNumber: '50126', ExtendedProperties: [{ Name: 'UserAgent', Value: 'BAV2ROPC' }, { Name: 'RequestType', Value: 'OAuth2:Token' }] } });
const ATT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/118.0 Safari/537.36';
purview.push({ ts: t(2, 11, 42, 3), rt: [15, 'AzureActiveDirectoryStsLogon'], op: 'UserLoggedIn', user: VICTIM, wl: 'AzureActiveDirectory', ip: ATTACKER_IP, ua: ATT_UA, extra: { ApplicationId: '00000002-0000-0ff1-ce00-000000000000', ExtendedProperties: [{ Name: 'UserAgent', Value: ATT_UA }, { Name: 'RequestType', Value: 'OAuth2:Token' }, { Name: 'ResultStatusDetail', Value: 'Success' }], DeviceProperties: [{ Name: 'SessionId', Value: 'sess-attacker-1' }, { Name: 'BrowserType', Value: 'Chrome' }] } });
// inbox rule hiding mail + forwarding
purview.push({ ts: t(2, 11, 49, 30), rt: [1, 'ExchangeAdmin'], op: 'New-InboxRule', user: VICTIM, wl: 'Exchange', ip: ATTACKER_IP, extra: { ObjectId: `${DOMAIN.replace('.', '')}.onmicrosoft.com/Users/anna.holm\\...`, Parameters: [{ Name: 'Identity', Value: '.' }, { Name: 'Name', Value: '.' }, { Name: 'SubjectOrBodyContainsWords', Value: 'invoice;faktura;betaling;payment' }, { Name: 'MoveToFolder', Value: 'RSS Subscriptions' }, { Name: 'MarkAsRead', Value: 'True' }, { Name: 'StopProcessingRules', Value: 'True' }], ExternalAccess: false, AppAccessContext: { AADSessionId: 'sess-attacker-1' } } });
purview.push({ ts: t(2, 11, 53, 1), rt: [1, 'ExchangeAdmin'], op: 'Set-Mailbox', user: VICTIM, wl: 'Exchange', ip: ATTACKER_IP, extra: { Parameters: [{ Name: 'Identity', Value: VICTIM }, { Name: 'ForwardingSmtpAddress', Value: 'smtp:anna.holm.finance@gmail.com' }, { Name: 'DeliverToMailboxAndForward', Value: 'True' }], AppAccessContext: { AADSessionId: 'sess-attacker-1' } } });
// mass mail read with throttling
for (let i = 0; i < 25; i++) purview.push({ ts: t(2, 12, i * 2), rt: [50, 'ExchangeItemAggregated'], op: 'MailItemsAccessed', user: VICTIM, wl: 'Exchange', ip: ATTACKER_IP, ua: ATT_UA, extra: { MailboxOwnerUPN: VICTIM, LogonType: 0, ClientInfoString: 'Client=OWA;Action=ViaProxy', OperationProperties: [{ Name: 'MailAccessType', Value: 'Bind' }, { Name: 'IsThrottled', Value: i === 24 ? 'True' : 'False' }, { Name: 'OperationCount', Value: '40' }], Folders: [{ Path: '\\Inbox', FolderItems: Array.from({ length: 8 }, () => ({ Id: guid(), InternetMessageId: `<${guid()}@${DOMAIN}>`, Subject: pick(SUBJECTS), SizeInBytes: 5000 })) }], AppAccessContext: { AADSessionId: 'sess-attacker-1' } } });
purview.push({ ts: t(2, 12, 30), rt: [2, 'ExchangeItem'], op: 'SearchQueryInitiatedExchange', user: VICTIM, wl: 'Exchange', ip: ATTACKER_IP, ua: ATT_UA, extra: { QueryText: 'bank IBAN betaling', ScenarioName: 'Mail' } });
// consent to a malicious app
purview.push({ ts: t(2, 12, 40), rt: [8, 'AzureActiveDirectory'], op: 'Consent to application.', user: VICTIM, wl: 'AzureActiveDirectory', ip: ATTACKER_IP, extra: { ObjectId: guid(), Target: [{ ID: 'ServicePrincipal_' + guid(), Type: 2 }, { ID: 'Mail Sync Helper', Type: 1 }], ModifiedProperties: [{ Name: 'ConsentContext.IsAdminConsent', NewValue: 'False', OldValue: '' }, { Name: 'ConsentAction.Permissions', NewValue: '[] => [[Id: xx, ClientId: yy, PrincipalId: zz, ResourceId: rr, ConsentType: Principal, Scope: Mail.ReadWrite Mail.Send offline_access User.Read]]', OldValue: '' }], Actor: [{ ID: VICTIM, Type: 5 }] } });
// session replay from a second country (AiTM-style token theft)
purview.push({ ts: t(2, 14, 5), rt: [15, 'AzureActiveDirectoryStsLogon'], op: 'UserLoggedIn', user: VICTIM, wl: 'AzureActiveDirectory', ip: ATTACKER_IP2, ua: ATT_UA, extra: { ApplicationId: '00000002-0000-0ff1-ce00-000000000000', ExtendedProperties: [{ Name: 'UserAgent', Value: ATT_UA }], DeviceProperties: [{ Name: 'SessionId', Value: 'sess-attacker-1' }] } });
// Day 3: admin adds attacker-controlled account to Global Administrator (compromised admin), MFA changed on victim
purview.push({ ts: t(3, 9, 12), rt: [8, 'AzureActiveDirectory'], op: 'Add member to role.', user: ADMIN, wl: 'AzureActiveDirectory', ip: AZURE_IP, extra: { ObjectId: guid(), Target: [{ ID: `svc-monitoring@${DOMAIN}`, Type: 5 }, { ID: 'User_' + guid(), Type: 2 }], ModifiedProperties: [{ Name: 'Role.DisplayName', NewValue: 'Global Administrator', OldValue: '' }, { Name: 'Role.ObjectID', NewValue: guid(), OldValue: '' }], Actor: [{ ID: ADMIN, Type: 5 }] } });
purview.push({ ts: t(3, 9, 30), rt: [8, 'AzureActiveDirectory'], op: 'User registered security info', user: VICTIM, wl: 'AzureActiveDirectory', ip: ATTACKER_IP, extra: { ObjectId: VICTIM, Target: [{ ID: VICTIM, Type: 5 }], ModifiedProperties: [{ Name: 'Authentication Method', NewValue: 'Microsoft Authenticator (push)', OldValue: '' }], Actor: [{ ID: VICTIM, Type: 5 }] } });
purview.push({ ts: t(3, 10, 0), rt: [8, 'AzureActiveDirectory'], op: 'Update application – Certificates and secrets management ', user: ADMIN, wl: 'AzureActiveDirectory', ip: AZURE_IP, extra: { ObjectId: guid(), Target: [{ ID: 'Mail Sync Helper', Type: 1 }, { ID: 'Application_' + guid(), Type: 2 }], ModifiedProperties: [{ Name: 'KeyDescription', NewValue: '[KeyIdentifier=…,KeyType=Password,KeyUsage=Verify,DisplayName=backup]', OldValue: '[]' }], Actor: [{ ID: ADMIN, Type: 5 }] } });
// Day 4: insider mass download + anonymous link + mass delete
for (let i = 0; i < 160; i++) purview.push({ ts: t(4, 19, Math.floor(i / 3), i % 60), rt: [6, 'SharePointFileOperation'], op: 'FileDownloaded', user: INSIDER, wl: 'SharePoint', ip: HOME_IPS[INSIDER], ua: UAS[0], extra: { ObjectId: `${SITE}/Shared Documents/Archive/doc-${i}.pdf`, SiteUrl: SITE + '/', SourceRelativeUrl: 'Shared Documents/Archive', SourceFileName: `doc-${i}.pdf`, SourceFileExtension: 'pdf' } });
purview.push({ ts: t(4, 20, 2), rt: [14, 'SharePointSharingOperation'], op: 'AnonymousLinkCreated', user: INSIDER, wl: 'SharePoint', ip: HOME_IPS[INSIDER], ua: UAS[0], extra: { ObjectId: `${SITE}/Shared Documents/Payroll October.xlsx`, SiteUrl: SITE + '/', SourceFileName: 'Payroll October.xlsx', SourceRelativeUrl: 'Shared Documents', TargetUserOrGroupType: 'Guest', EventData: '<Type>Edit</Type>' } });
purview.push({ ts: t(4, 20, 5), rt: [14, 'SharePointSharingOperation'], op: 'SharingInvitationCreated', user: INSIDER, wl: 'SharePoint', ip: HOME_IPS[INSIDER], ua: UAS[0], extra: { ObjectId: `${SITE}/Shared Documents/Supplier contracts.docx`, SiteUrl: SITE + '/', SourceFileName: 'Supplier contracts.docx', TargetUserOrGroupName: 'finn.private@outlook.com', TargetUserOrGroupType: 'Guest' } });
for (let i = 0; i < 70; i++) purview.push({ ts: t(5, 7, Math.floor(i / 2)), rt: [6, 'SharePointFileOperation'], op: 'FileRecycled', user: INSIDER, wl: 'SharePoint', ip: OFFICE_IP, ua: UAS[0], extra: { ObjectId: `${SITE}/Shared Documents/Archive/doc-${i}.pdf`, SiteUrl: SITE + '/', SourceRelativeUrl: 'Shared Documents/Archive', SourceFileName: `doc-${i}.pdf` } });
// Day 6: phishing campaign — Safe Links clicks recorded in audit log too
const PHISH_URL = 'https://fabrikam-docs-share.com/secure/view?id=88213';
const PHISH_NMID = guid();
for (const u of USERS.slice(2, 8)) purview.push({ ts: t(6, 9, 20 + USERS.indexOf(u)), rt: [41, 'ThreatIntelligenceUrl'], op: 'TIUrlClickData', user: u, wl: 'ThreatIntelligence', ip: HOME_IPS[u], extra: { Url: PHISH_URL, URLClickAction: USERS.indexOf(u) % 2 ? 2 : 4, IsClickedThrough: USERS.indexOf(u) % 2 === 0, NetworkMessageId: PHISH_NMID, SourceWorkload: 0, UserIp: HOME_IPS[u], TimeOfClick: t(6, 9, 20).toISOString() } });
purview.push({ ts: t(6, 9, 0), rt: [28, 'ThreatIntelligence'], op: 'TIMailData', user: 'ThreatIntel', wl: 'ThreatIntelligence', extra: { Subject: 'Shared document: Payment approval needed', P1Sender: 'docs@fabrikam-docs-share.com', P2Sender: 'docs@fabrikam-docs-share.com', Recipients: USERS.slice(2, 8), Verdict: 'Phish', DeliveryAction: 'Delivered', NetworkMessageId: PHISH_NMID, InternetMessageId: `<camp-${PHISH_NMID}@fabrikam-docs-share.com>`, SenderIp: '91.219.236.9', DetectionType: 'Delayed', DetectionMethod: 'URL detonation reputation' } });
// Day 7: audit tampering + content search by the compromised admin
purview.push({ ts: t(7, 22, 10), rt: [1, 'ExchangeAdmin'], op: 'Set-MailboxAuditBypassAssociation', user: `svc-monitoring@${DOMAIN}`, wl: 'Exchange', ip: AZURE_IP, extra: { Parameters: [{ Name: 'Identity', Value: `svc-monitoring@${DOMAIN}` }, { Name: 'AuditBypassEnabled', Value: 'True' }] } });
purview.push({ ts: t(7, 22, 15), rt: [18, 'SecurityComplianceCenterEOPCmdlet'], op: 'New-ComplianceSearch', user: `svc-monitoring@${DOMAIN}`, wl: 'SecurityComplianceCenter', ip: AZURE_IP, extra: { Parameters: [{ Name: 'Name', Value: 'all mail' }, { Name: 'ExchangeLocation', Value: 'All' }, { Name: 'ContentMatchQuery', Value: 'subject:invoice OR subject:faktura' }] } });
purview.push({ ts: t(7, 22, 40), rt: [24, 'Discovery'], op: 'SearchExported', user: `svc-monitoring@${DOMAIN}`, wl: 'SecurityComplianceCenter', ip: AZURE_IP, extra: { ObjectId: 'all mail', ExchangeLocations: ['All'], Query: 'subject:invoice OR subject:faktura', ExportName: 'all mail_Export' } });
// a brand-new, uncatalogued operation to prove nothing is dropped
purview.push({ ts: t(8, 10, 0), rt: [384, 'CopilotAgentManagement'], op: 'AgentPublishedToOrgCatalog', user: ADMIN, wl: 'Copilot', ip: OFFICE_IP, extra: { AgentName: 'Finance Helper', AgentId: guid(), Scope: 'Organization', FutureProperty: { Nested: true, Values: [1, 2, 3] } } });
purview.push({ ts: t(8, 10, 5), rt: [999, 'RecordType 999'], op: 'SomethingMicrosoftInventedLastWeek', user: ADMIN, wl: 'NewService', ip: OFFICE_IP, extra: { Detail: 'unknown record type and workload — must still be searchable' } });

// --- write Purview CSV (new portal shape) ---
const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
purview.sort((a, b) => a.ts.getTime() - b.ts.getTime());
const orgId = guid();
const purviewLines = ['RecordId,CreationDate,RecordType,Operation,UserId,AuditData,AssociatedAdminUnits,AssociatedAdminUnitsNames'];
for (const p of purview) {
  const id = guid();
  const ad: Record<string, unknown> = {
    CreationTime: isoPlain(p.ts), Id: id, Operation: p.op, OrganizationId: orgId, RecordType: p.rt[0], ResultStatus: p.result ?? (p.rt[0] === 1 ? 'True' : 'Succeeded'),
    UserKey: guid(), UserType: p.user.includes('SYSTEM') ? 4 : p.user === ADMIN ? 2 : 0, Version: 1, Workload: p.wl, UserId: p.user, ...(p.ip ? { ClientIP: p.ip } : {}), ...(p.ua && p.wl !== 'Exchange' ? { UserAgent: p.ua } : {}), ...(p.ua && p.wl === 'Exchange' ? { ClientInfoString: p.ua } : {}), ...p.extra,
  };
  purviewLines.push([id, iso7(p.ts), p.rt[1], p.op, p.user, JSON.stringify(ad), '', ''].map(csvCell).join(','));
}

// --- Entra sign-in CSV (interactive) mirrors the STS logons with Microsoft's geo ---
const GEO: Record<string, string> = { [OFFICE_IP]: 'Copenhagen, Capital Region, DK', [ATTACKER_IP]: 'Lagos, Lagos, NG', [ATTACKER_IP2]: 'Jakarta, Jakarta, ID', [AZURE_IP]: 'Amsterdam, North Holland, NL' };
const entraHead = ['Date (UTC)', 'Request ID', 'User agent', 'Correlation ID', 'User ID', 'User', 'Username', 'User type', 'Cross tenant access type', 'Incoming token type', 'Authentication Protocol', 'Unique token identifier', 'Original transfer method', 'Client credential type', 'Token Protection - Sign In Session', 'Application', 'Application ID', 'App owner tenant ID', 'Resource', 'Resource ID', 'Resource tenant ID', 'Resource owner tenant ID', 'Home tenant ID', 'Home tenant name', 'IP address', 'Location', 'Status', 'Sign-in error code', 'Failure reason', 'Client app', 'Device ID', 'Browser', 'Operating System', 'Compliant', 'Managed', 'Join Type', 'Multifactor authentication result', 'Multifactor authentication auth method', 'Multifactor authentication auth detail', 'Authentication requirement', 'Sign-in identifier', 'Session ID', 'IP address (seen by resource)', 'Through Global Secure Access', 'Global Secure Access IP address', 'Autonomous system number', 'Flagged for review', 'Token issuer type', 'Token issuer name', 'Latency', 'Conditional Access', 'Managed Identity type', 'Associated Resource Id', 'Federated Token Id', 'Federated Token Issuer'];
const entraLines = [entraHead.join(',')];
const entraJson: unknown[] = [];
for (const p of purview.filter((x) => x.rt[0] === 15)) {
  const failed = p.op === 'UserLoginFailed';
  const ip = p.ip!;
  const loc = GEO[ip] ?? (ip.startsWith('87.52') ? pick(['Aarhus, Central Jutland, DK', 'Odense, Southern Denmark, DK', 'Copenhagen, Capital Region, DK']) : 'Copenhagen, Capital Region, DK');
  const sid = (p.extra?.DeviceProperties as { Name: string; Value: string }[] | undefined)?.find((d) => d.Name === 'SessionId')?.Value ?? '';
  const browser = p.ua?.includes('Edg') ? 'Edge 130.0.0' : p.ua?.includes('Chrome') ? 'Chrome 118.0.0' : p.ua?.includes('Safari') ? 'Safari 17.6' : '';
  const os = p.ua?.includes('Windows') ? 'Windows10' : p.ua?.includes('Mac') ? 'MacOs' : p.ua?.includes('iOS') ? 'Ios' : '';
  const reqId = guid();
  const row: Record<string, string> = { 'Date (UTC)': p.ts.toISOString().replace(/\.\d{3}Z$/, 'Z'), 'Request ID': reqId, 'User agent': p.ua ?? '', 'Correlation ID': guid(), 'User ID': guid(), User: p.user.split('@')[0].replace('.', ' '), Username: p.user, 'User type': 'Member', 'Incoming token type': 'none', 'Authentication Protocol': p.ua === 'BAV2ROPC' ? 'ropc' : 'oAuth2', Application: 'Office 365 Exchange Online', 'Application ID': '00000002-0000-0ff1-ce00-000000000000', Resource: 'Office 365 Exchange Online', 'IP address': ip, Location: loc, Status: failed ? 'Failure' : 'Success', 'Sign-in error code': failed ? '50126' : '0', 'Failure reason': failed ? 'Error validating credentials due to invalid username or password.' : 'Other.', 'Client app': p.ua === 'BAV2ROPC' ? 'Other clients' : 'Browser', Browser: browser, 'Operating System': os, 'Multifactor authentication result': failed ? '' : ip === ATTACKER_IP || ip === ATTACKER_IP2 ? 'MFA requirement satisfied by claim in the token' : 'MFA completed in Azure AD', 'Authentication requirement': 'multiFactorAuthentication', 'Session ID': sid, 'Conditional Access': failed ? 'Not Applied' : 'Success', 'Autonomous system number': ip === ATTACKER_IP ? '37282' : '3292' };
  entraLines.push(entraHead.map((h) => csvCell(row[h] ?? '')).join(','));
  entraJson.push({ id: reqId, createdDateTime: p.ts.toISOString(), userDisplayName: row.User, userPrincipalName: p.user, userId: row['User ID'], appId: row['Application ID'], appDisplayName: row.Application, ipAddress: ip, clientAppUsed: row['Client app'], correlationId: row['Correlation ID'], conditionalAccessStatus: failed ? 'notApplied' : 'success', isInteractive: false, riskDetail: 'none', riskLevelAggregated: ip === ATTACKER_IP ? 'high' : 'none', riskLevelDuringSignIn: ip === ATTACKER_IP ? 'medium' : 'none', riskState: ip === ATTACKER_IP ? 'atRisk' : 'none', resourceDisplayName: 'Microsoft Graph', resourceId: '00000003-0000-0000-c000-000000000000', status: { errorCode: failed ? 50126 : 0, failureReason: row['Failure reason'], additionalDetails: failed ? 'The user didn\'t enter the right credentials.' : 'MFA requirement satisfied by claim in the token' }, deviceDetail: { deviceId: '', displayName: '', operatingSystem: os, browser, isCompliant: false, isManaged: false, trustType: '' }, location: { city: loc.split(', ')[0], state: loc.split(', ')[1], countryOrRegion: loc.split(', ')[2], geoCoordinates: { latitude: 55.67, longitude: 12.56 } }, signInEventTypes: ['nonInteractiveUser'], sessionId: sid, userAgent: p.ua ?? '', authenticationRequirement: 'multiFactorAuthentication' });
}

// --- message trace: enhanced summary ---
const traceLines = ['origin_timestamp_utc,sender_address,recipient_status,message_subject,total_bytes,message_id,network_message_id,original_client_ip,directionality,connector_id,delivery_priority'];
for (let day = 0; day < DAYS; day++) for (let i = 0; i < 25; i++) {
  const from = rnd() < 0.5 ? pick(USERS) : pick(['newsletter@vendor.example', 'support@supplier.example', 'noreply@bank.example']);
  const to = pick(USERS);
  traceLines.push([t(day, 7 + Math.floor(rnd() * 10)).toISOString().replace(/\.\d{3}Z$/, '.0000000Z'), from, `${to}##Receive, Deliver`, pick(SUBJECTS), String(3000 + Math.floor(rnd() * 200000)), `<${guid()}@${from.split('@')[1]}>`, guid(), from.endsWith(DOMAIN) ? OFFICE_IP : '203.0.113.' + Math.floor(rnd() * 200), from.endsWith(DOMAIN) ? 'Originating' : 'Incoming', '', 'Normal'].map(csvCell).join(','));
}
traceLines.push([t(6, 8, 58).toISOString().replace(/\.\d{3}Z$/, '.0000000Z'), 'docs@fabrikam-docs-share.com', USERS.slice(2, 8).map((u) => `${u}##Receive, Deliver`).join(';'), 'Shared document: Payment approval needed', '18220', `<camp-${PHISH_NMID}@fabrikam-docs-share.com>`, PHISH_NMID, '91.219.236.9', 'Incoming', '', 'Normal'].map(csvCell).join(','));
// forwarded copies leaving via the rule
for (let i = 0; i < 12; i++) traceLines.push([t(2 + Math.floor(i / 4), 13 + (i % 4) * 2).toISOString().replace(/\.\d{3}Z$/, '.0000000Z'), VICTIM, 'anna.holm.finance@gmail.com##Receive, Deliver', 'FW: ' + pick(SUBJECTS), '22000', `<${guid()}@${DOMAIN}>`, guid(), M365_IP, 'Originating', 'Outbound to Internet', 'Normal'].map(csvCell).join(','));

// --- Defender union export ---
const defHead = ['Table', 'Timestamp', 'NetworkMessageId', 'InternetMessageId', 'SenderFromAddress', 'SenderIPv4', 'RecipientEmailAddress', 'Subject', 'EmailDirection', 'DeliveryAction', 'DeliveryLocation', 'ThreatTypes', 'ThreatNames', 'DetectionMethods', 'Url', 'UrlDomain', 'UrlLocation', 'ActionType', 'AccountUpn', 'IPAddress', 'IsClickedThrough', 'Workload', 'Action', 'ActionTrigger', 'ActionResult', 'ReportId'];
const defLines = [defHead.join(',')];
const defRow = (o: Record<string, unknown>) => defLines.push(defHead.map((h) => csvCell(o[h] ?? '')).join(','));
for (const u of USERS.slice(2, 8)) defRow({ Table: 'EmailEvents', Timestamp: t(6, 8, 58).toISOString(), NetworkMessageId: PHISH_NMID, InternetMessageId: `<camp-${PHISH_NMID}@fabrikam-docs-share.com>`, SenderFromAddress: 'docs@fabrikam-docs-share.com', SenderIPv4: '91.219.236.9', RecipientEmailAddress: u, Subject: 'Shared document: Payment approval needed', EmailDirection: 'Inbound', DeliveryAction: 'Delivered', DeliveryLocation: 'Inbox/folder', ThreatTypes: 'Phish', ThreatNames: '', DetectionMethods: '{"Phish":["URL detonation reputation"]}', ReportId: guid() });
defRow({ Table: 'EmailUrlInfo', Timestamp: t(6, 8, 58).toISOString(), NetworkMessageId: PHISH_NMID, Url: PHISH_URL, UrlDomain: 'fabrikam-docs-share.com', UrlLocation: 'Body', ReportId: guid() });
for (const u of USERS.slice(2, 8)) defRow({ Table: 'UrlClickEvents', Timestamp: t(6, 9, 20 + USERS.indexOf(u)).toISOString(), NetworkMessageId: PHISH_NMID, Url: PHISH_URL, ActionType: USERS.indexOf(u) % 2 ? 'ClickBlocked' : 'ClickAllowed', AccountUpn: u, IPAddress: HOME_IPS[u], IsClickedThrough: USERS.indexOf(u) % 2 === 0 ? 'True' : 'False', Workload: 'Email', ThreatTypes: 'Phish', ReportId: guid() });
for (const u of USERS.slice(2, 8)) defRow({ Table: 'EmailPostDeliveryEvents', Timestamp: t(6, 10, 40).toISOString(), NetworkMessageId: PHISH_NMID, InternetMessageId: `<camp-${PHISH_NMID}@fabrikam-docs-share.com>`, RecipientEmailAddress: u, Action: 'Moved to quarantine', ActionType: 'Phish ZAP', ActionTrigger: 'ZAP', ActionResult: 'Success', DeliveryLocation: 'Quarantine', ThreatTypes: 'Phish', ReportId: guid() });
for (let day = 0; day < DAYS; day++) for (let i = 0; i < 6; i++) { const to = pick(USERS); defRow({ Table: 'EmailEvents', Timestamp: t(day, 8 + i).toISOString(), NetworkMessageId: guid(), InternetMessageId: `<${guid()}@vendor.example>`, SenderFromAddress: 'newsletter@vendor.example', SenderIPv4: '203.0.113.9', RecipientEmailAddress: to, Subject: pick(SUBJECTS), EmailDirection: 'Inbound', DeliveryAction: rnd() < 0.1 ? 'Junked' : 'Delivered', DeliveryLocation: 'Inbox/folder', ThreatTypes: '', ReportId: guid() }); }

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'purview-audit.csv'), '﻿' + purviewLines.join('\r\n') + '\r\n');
writeFileSync(join(outDir, 'entra-signins.csv'), '﻿' + entraLines.join('\r\n') + '\r\n');
writeFileSync(join(outDir, 'entra-signins.json'), JSON.stringify({ '@odata.context': 'https://graph.microsoft.com/beta/$metadata#auditLogs/signIns', value: entraJson }, null, 1));
writeFileSync(join(outDir, 'message-trace.csv'), traceLines.join('\r\n') + '\r\n');
writeFileSync(join(outDir, 'defender-union.csv'), defLines.join('\r\n') + '\r\n');
console.log(`sample data written to ${outDir}: purview ${purview.length} rows, entra ${entraLines.length - 1} rows, trace ${traceLines.length - 1} rows, defender ${defLines.length - 1} rows`);
