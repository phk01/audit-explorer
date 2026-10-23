/**
 * Workload groups — the ten coverage groups from the product spec — and how raw records map to them.
 *
 * Mapping is best-effort and additive: an unknown Workload or RecordType lands in `other`, never dropped.
 */
export type WorkloadGroup =
  | 'identity'
  | 'sharepoint'
  | 'onedrive'
  | 'teams'
  | 'exchange'
  | 'copilot'
  | 'purview'
  | 'powerplatform'
  | 'security'
  | 'other';

export const WORKLOAD_GROUPS: Record<WorkloadGroup, { label: string; description: string }> = {
  identity: { label: 'Identity, access & administration', description: 'Entra ID sign-ins, directory changes, roles, applications, consent, authentication settings.' },
  sharepoint: { label: 'SharePoint Online', description: 'Files, folders, sites, lists, pages, sharing and permissions.' },
  onedrive: { label: 'OneDrive for Business', description: 'Personal file storage, sync and sharing.' },
  teams: { label: 'Microsoft Teams', description: 'Teams, channels, membership, messages, meetings, apps and policies.' },
  exchange: { label: 'Exchange Online & email', description: 'Mailbox access, mail flow, rules, delegation, admin cmdlets, message trace and Defender email telemetry.' },
  copilot: { label: 'Microsoft 365 Copilot & AI', description: 'Copilot interactions, agents, plugins and AI app interactions.' },
  purview: { label: 'Purview & compliance', description: 'DLP, sensitivity labels, retention, eDiscovery, audit configuration, insider risk, communication compliance.' },
  powerplatform: { label: 'Power Platform & business apps', description: 'Power Apps, Power Automate, Power BI, Dynamics 365, Fabric.' },
  security: { label: 'Security & threat telemetry', description: 'Defender alerts, investigations, quarantine, threat intelligence, attack simulation, risk detections.' },
  other: { label: 'Additional workloads', description: 'Forms, Planner, Stream, Viva, To Do, Project, Yammer and everything not yet categorised.' },
};

/** Navigation areas of the product. */
export type NavArea =
  | 'activity'
  | 'people'
  | 'emails'
  | 'files'
  | 'teams'
  | 'identity'
  | 'administration'
  | 'security'
  | 'applications'
  | 'cases'
  | 'coverage';

const WORKLOAD_VALUE_TO_GROUP: Record<string, WorkloadGroup> = {
  exchange: 'exchange',
  sharepoint: 'sharepoint',
  onedrive: 'onedrive',
  azureactivedirectory: 'identity',
  microsoftteams: 'teams',
  skypeforbusiness: 'teams',
  securitycompliancecenter: 'purview',
  compliancemanager: 'purview',
  powerbi: 'powerplatform',
  powerapps: 'powerplatform',
  microsoftflow: 'powerplatform',
  powerplatform: 'powerplatform',
  crm: 'powerplatform',
  dynamics365: 'powerplatform',
  fabric: 'powerplatform',
  copilot: 'copilot',
  microsoftcopilot: 'copilot',
  threatintelligence: 'security',
  microsoftdefenderforidentity: 'security',
  mcas: 'security',
  aip: 'purview',
  microsoftforms: 'other',
  microsoftstream: 'other',
  planner: 'other',
  yammer: 'other',
  vivaengage: 'other',
  microsofttodo: 'other',
  project: 'other',
  kaizala: 'other',
};

const RT_PREFIX_TO_GROUP: [RegExp, WorkloadGroup][] = [
  [/^exchange|^mailsubmission|^owaauth|^hygieneevent/i, 'exchange'],
  [/^onedrive/i, 'onedrive'],
  [/^sharepoint/i, 'sharepoint'],
  [/^azureactivedirectory|^crosstenantaccesspolicy|^urbac|^applicationaudit/i, 'identity'],
  [/^microsoftteams|^teams|^skypeforbusiness/i, 'teams'],
  [/copilot|^aiappinteraction|^connectedaiappinteraction|^aiinteractions|^aiguardrail/i, 'copilot'],
  [/^compliance|^dlp|^mip|^aip|^discovery$|^aed$|^label|^sensitivitylabel|^informationbarrier|^datagovernance|^securitycompliancecenter|^securitycompliancerbac|^securitycomplianceuserchange|^audit|^insiderrisk|^purviewinsiderrisk|^datasecurityinvestigation|^trainableclassifier|^datascanclassification|^sensitiveinfodiscovered|^irmactivity|^omeportal|^privapriva|^datacatalog|^backup|^restore|^exchangesearch|^sharepointsearch|^datacentersecurity/i, 'purview'],
  [/^powerbi|^powerapps|^microsoftflow|^powerplatform|^powerpages|^crm$|^dynamics365|^fabricaudit|^datainsightsrestapi/i, 'powerplatform'],
  [/^threat|^securitycompliancealerts|^securitycomplianceinsights|^air|^wdatpalerts|^mcasalerts|^attacksim|^mstic|^ms365dcustomdetection|^microsoftdefenderforidentity|^defender|^quarantine|^campaign|^aadriskdetection|^webcontentfiltering|^noisyalertpolicy|^devicediscovery|^sentinel|^usxworkspace|^copilotforsecurity/i, 'security'],
];

export function workloadGroupFor(workload: string | null | undefined, recordType: string | null | undefined): WorkloadGroup {
  const w = (workload ?? '').replace(/[\s_-]/g, '').toLowerCase();
  if (w && WORKLOAD_VALUE_TO_GROUP[w]) return WORKLOAD_VALUE_TO_GROUP[w];
  const rt = (recordType ?? '').trim();
  if (rt) for (const [rx, g] of RT_PREFIX_TO_GROUP) if (rx.test(rt)) return g;
  if (w) for (const [rx, g] of RT_PREFIX_TO_GROUP) if (rx.test(w)) return g;
  return 'other';
}

/** Which navigation areas a group contributes to (besides Global Activity and People). */
export const GROUP_TO_AREAS: Record<WorkloadGroup, NavArea[]> = {
  identity: ['identity', 'administration'],
  sharepoint: ['files'],
  onedrive: ['files'],
  teams: ['teams'],
  exchange: ['emails', 'administration'],
  copilot: ['applications'],
  purview: ['security', 'administration'],
  powerplatform: ['applications'],
  security: ['security'],
  other: ['applications'],
};
