/** Well-known first-party application IDs seen in sign-in and audit records. */
export const KNOWN_APPS: Record<string, string> = {
  '00000002-0000-0ff1-ce00-000000000000': 'Exchange Online',
  '00000003-0000-0ff1-ce00-000000000000': 'SharePoint Online',
  '00000003-0000-0000-c000-000000000000': 'Microsoft Graph',
  '00000002-0000-0000-c000-000000000000': 'Azure AD Graph',
  '1fec8e78-bce4-4aaf-ab1b-5451cc387264': 'Microsoft Teams',
  '5e3ce6c0-2b1f-4285-8d4b-75ee78787346': 'Teams web',
  '27922004-5251-4030-b22d-91ecd9a37ea4': 'Outlook mobile',
  'd3590ed6-52b3-4102-aeff-aad2292ab01c': 'Microsoft Office',
  '4765445b-32c6-49b0-83e6-1d93765276ca': 'Office web (OfficeHome)',
  '00000006-0000-0ff1-ce00-000000000000': 'Microsoft 365 portal',
  'c44b4083-3bb0-49c1-b47d-974e53cbdf3c': 'Azure portal',
  '1b730954-1685-4b74-9bfd-dac224a7b894': 'Azure AD PowerShell',
  '04b07795-8ddb-461a-bbee-02f9e1bf7b46': 'Azure CLI',
  '1950a258-227b-4e31-a9cf-717495945fc2': 'Azure PowerShell',
  'de8bc8b5-d9f9-48b1-a8ad-b748da725064': 'Graph Explorer',
  '14d82eec-204b-4c2f-b7e8-296a70dab67e': 'Microsoft Graph PowerShell',
  '29d9ed98-a469-4536-ade2-f981bc1d605e': 'Microsoft Authentication Broker',
  'fb78d390-0c51-40cd-8e17-fdbfab77341b': 'Exchange Online PowerShell',
  'ab9b8c07-8f02-4f72-87fa-80105867a763': 'OneDrive sync',
  '9bc3ab49-b65d-410a-85ad-de819febfddc': 'SharePoint Online PowerShell',
  '00b41c95-dab0-4487-9791-b9d2c32c80f2': 'Office 365 Management',
  '89bee1f7-5e6e-4d8a-9f3d-ecd601259da7': 'Office 365 Shell',
  '0000000c-0000-0000-c000-000000000000': 'My Apps',
  '4345a7b9-9a63-4910-a426-35363201d503': 'Microsoft 365 suite UX',
  'a0c73c16-a7e3-4564-9a95-2bdf47383716': 'Exchange Online Remote PowerShell',
  '872cd9fa-d31f-45e0-9eab-6e460a02d1f1': 'Visual Studio',
  'cf36b471-5b44-428c-9ce7-313bf84528de': 'Microsoft Bing Search',
  'b23dd4db-9142-4734-867f-3577f640ad0c': 'Office 365 Management APIs',
  'bc59ab01-8403-45c6-8796-ac3ef710b3e3': 'Outlook Online Add-in',
  'fc0f3af4-6835-4174-b806-f7db311fd2f3': 'Microsoft Intune',
};

export function appName(id: string | null | undefined): string {
  if (!id) return '';
  return KNOWN_APPS[String(id).toLowerCase()] ?? String(id);
}

export const GUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** User-agent family classifier (ported from the previous analyser). */
export function userAgentFamily(ua: string | null | undefined): string {
  if (!ua) return '';
  const s = ua;
  const t = [
    [/python/i, 'Python'], [/axios/i, 'axios'], [/curl\//i, 'curl'], [/powershell/i, 'PowerShell'], [/okhttp/i, 'okhttp'],
    [/go-http/i, 'Go HTTP'], [/BAV2ROPC/i, 'Legacy auth (ROPC)'], [/postman/i, 'Postman'], [/node-fetch/i, 'node-fetch'],
    [/java\//i, 'Java'], [/wget/i, 'wget'], [/Outlook-iOS/i, 'Outlook iOS'], [/Outlook-Android/i, 'Outlook Android'],
    [/OneDrive|SkyDriveSync|Microsoft SkyDriveSync/i, 'OneDrive sync'], [/Teams/i, 'Teams'], [/Client=OWA/i, 'Outlook on the web'],
    [/Outlook|MSOffice|Client=MSExchangeRPC|Microsoft Office/i, 'Office / Outlook app'], [/Client=REST/i, 'REST client'],
    [/ActiveSync|AirSync/i, 'ActiveSync'], [/Edg\//i, 'Edge'], [/Firefox/i, 'Firefox'], [/Chrome/i, 'Chrome'], [/Safari/i, 'Safari'],
  ] as const;
  for (const [rx, name] of t) if (rx.test(s)) return name;
  const m = s.match(/Client=([A-Za-z]+)/);
  if (m) return 'Exchange ' + m[1];
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

export const SCRIPTED_UA_RX = /python|curl\/|axios|go-http|okhttp|powershell|libwww|postman|java\/|node-fetch|bav2ropc|httpclient|wget|scrapy|aiohttp|ruby|perl/i;

/** Sensitive operation families used for highlighting and later for detections. */
export const SENSITIVE_OPERATIONS: Record<string, string[]> = {
  'Role assignment': ['add member to role', 'add eligible member to role', 'add scoped member to role', 'add-rolegroupmember', 'new-managementroleassignment', 'add member to role scoped over restricted management administrative unit'],
  'Application consent & credentials': ['consent to application', 'add delegated permission grant', 'add oauth2permissiongrant', 'add app role assignment to service principal', 'add app role assignment grant to user', 'add service principal credentials', 'update application - certificates and secrets management', 'add owner to application', 'add owner to service principal', 'add service principal', 'add application'],
  'Tenant security settings': ['set domain authentication', 'set federation settings on domain', 'add domain to company', 'verify domain', 'disable strong authentication', 'update conditional access policy', 'delete conditional access policy', 'add policy', 'update policy', 'set company information', 'update authorization policy'],
  'Account lifecycle': ['reset user password', 'set force change user password', 'add user', 'delete user', 'restore user', 'update user credentials', 'change user password'],
  'Audit configuration': ['set-adminauditlogconfig', 'set-mailboxauditbypassassociation', 'set-organizationconfig', 'disable-organizationcustomization', 'remove-mailboxauditbypassassociation'],
  'Content search & export': ['searchexported', 'searchexportdownloaded', 'new-compliancesearchaction', 'searchcreated', 'new-compliancesearch', 'viewedsearchexported', 'previewitemlisted', 'search-mailbox'],
  'Mailbox permissions': ['add-mailboxpermission', 'add-recipientpermission', 'add-mailboxfolderpermission', 'set-mailboxfolderpermission', 'add-adpermission', 'update-rolegroupmember'],
  'Inbox rules': ['new-inboxrule', 'set-inboxrule', 'updateinboxrules', 'enable-inboxrule'],
  'Mail flow rules': ['new-transportrule', 'set-transportrule'],
  'Mail forwarding': ['set-mailbox'],
};

const sensitiveIndex = new Map<string, string>();
for (const [family, ops] of Object.entries(SENSITIVE_OPERATIONS)) for (const o of ops) sensitiveIndex.set(o, family);

export function sensitiveFamily(operationKey: string): string | null {
  return sensitiveIndex.get(operationKey) ?? null;
}

export const DOWNLOAD_OPERATIONS = new Set(['filedownloaded', 'filesyncdownloadedfull', 'filesyncdownloadedpartial', 'filecopied']);
export const DELETE_OPERATIONS = new Set(['filedeleted', 'filerecycled', 'filedeletedfirststagerecyclebin', 'filedeletedsecondstagerecyclebin', 'folderdeleted', 'folderrecycled', 'harddelete', 'softdelete', 'movetodeleteditems']);
/** Everyday activity that is hidden from investigation timelines by default (shown with "routine" on, and always shown when a finding touches the event). */
export const ROUTINE_OPERATIONS = new Set(['fileaccessed', 'filepreviewed', 'fileaccessedextended', 'filemodified', 'filemodifiedextended', 'filecheckedin', 'filecheckedout', 'filesyncdownloadedfull', 'filesyncuploadedfull', 'folderaccessed', 'pageviewed', 'pageviewedextended', 'searchqueryperformed', 'listviewed', 'listitemviewed',
  'mailitemsaccessed', 'send', 'create', 'update', 'move', 'folderbind', 'mailboxlogin', 'movetodeleteditems', 'softdelete',
  'userloggedin', 'userloginfailed',
  'messagesent', 'teamssessionstarted', 'messageread', 'messagesread', 'chatretrieved', 'messageupdated', 'meetingparticipantdetail', 'messageshown', 'chatcreated', 'meetingdetail', 'reactedtomessage', 'messagecreatedhaslink', 'messageslistedinchat',
  'viewdashboard', 'viewreport', 'copilotinteraction']);
