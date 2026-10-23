/**
 * Source registry — every kind of export the platform can ingest.
 *
 * Layer A = Microsoft Purview Unified Audit Log (the foundation).
 * Layer B = cross-product telemetry joined to audit events (Entra, Exchange message trace, Defender).
 *
 * Retention figures are Microsoft's documented defaults as of October 2026 and are used by
 * Data Coverage & Health to warn before evidence falls out of the export window.
 */
export type SourceId =
  | 'purview'
  | 'entra_signin'
  | 'entra_audit'
  | 'entra_risk'
  | 'message_trace'
  | 'defender_email'
  | 'defender_url_click'
  | 'defender_url_info'
  | 'defender_post_delivery'
  | 'defender_attachment'
  | 'unknown';

export type Layer = 'A' | 'B';

export interface SourceDefinition {
  id: SourceId;
  layer: Layer;
  label: string;
  vendorName: string;
  description: string;
  /** Days the tenant keeps this data by default (lowest common licence). */
  retentionDays: number;
  /** Retention with the higher licence tier, if different. */
  retentionDaysPremium?: number;
  retentionNote: string;
  /** Export recipe shown to analysts in Data Coverage & Health. */
  howToExport: string[];
  /** Maximum rows per export file (for completeness warnings). */
  exportRowLimit?: number;
  docsUrl: string;
}

export const SOURCES: Record<Exclude<SourceId, 'unknown'>, SourceDefinition> = {
  purview: {
    id: 'purview',
    layer: 'A',
    label: 'Purview unified audit log',
    vendorName: 'Microsoft Purview Audit',
    description: 'All workloads: Exchange, SharePoint, OneDrive, Teams, Entra ID, Power Platform, Copilot, Purview and every other audited service.',
    retentionDays: 180,
    retentionDaysPremium: 365,
    retentionNote: 'Audit (Standard) keeps 180 days. Audit (Premium) keeps Exchange, SharePoint, OneDrive and Entra records for 1 year by default; up to 10 years with the add-on.',
    howToExport: [
      'Purview portal → Audit → New search. Leave Activities and Record types empty to get everything.',
      'Export → Download all results (CSV). Audit (Standard) exports at most 50,000 rows, Audit (Premium) 1,000,000.',
      'If a search hits the row limit, split the date range and export each part; the importer merges and de-duplicates them.',
      'PowerShell alternative: Search-UnifiedAuditLog -SessionCommand ReturnLargeSet in 1-hour slices | Export-Csv.',
    ],
    exportRowLimit: 50000,
    docsUrl: 'https://learn.microsoft.com/en-us/purview/audit-search',
  },
  entra_signin: {
    id: 'entra_signin',
    layer: 'B',
    label: 'Entra ID sign-in logs',
    vendorName: 'Microsoft Entra ID',
    description: 'Interactive, non-interactive, service principal and managed identity sign-ins with location, device, MFA and Conditional Access detail.',
    retentionDays: 7,
    retentionDaysPremium: 30,
    retentionNote: 'Entra ID Free keeps 7 days; P1/P2 keep 30 days. Not retroactive after a licence upgrade.',
    howToExport: [
      'Entra admin center → Monitoring & health → Sign-in logs. Set the date range and remove filters.',
      'Download → JSON (preferred: complete fields) or CSV. Pick each sign-in category you need: interactive, non-interactive, application, managed identity.',
      'Up to 100,000 records per file; split by date if the download times out.',
    ],
    exportRowLimit: 100000,
    docsUrl: 'https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-download-logs',
  },
  entra_audit: {
    id: 'entra_audit',
    layer: 'B',
    label: 'Entra ID audit logs',
    vendorName: 'Microsoft Entra ID',
    description: 'Directory changes: users, groups, roles, applications, policies, PIM, self-service password reset.',
    retentionDays: 7,
    retentionDaysPremium: 30,
    retentionNote: 'Entra ID Free keeps 7 days; P1/P2 keep 30 days. Most of these changes are also in the Purview audit log (AzureActiveDirectory record type) for 180 days or more.',
    howToExport: [
      'Entra admin center → Monitoring & health → Audit logs.',
      'Download → JSON (preferred) or CSV. Up to 250,000 records per file.',
    ],
    exportRowLimit: 250000,
    docsUrl: 'https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-download-logs',
  },
  entra_risk: {
    id: 'entra_risk',
    layer: 'B',
    label: 'Entra ID Protection risk detections',
    vendorName: 'Microsoft Entra ID Protection',
    description: 'Risk detections and risky sign-ins (impossible travel, anonymous IP, leaked credentials, password spray and more).',
    retentionDays: 7,
    retentionDaysPremium: 90,
    retentionNote: 'Risky sign-ins: Free 7 days, P1 30 days, P2 90 days. Risky users are kept until remediated.',
    howToExport: [
      'Entra admin center → Protection → Identity Protection → Risk detections (or Risky sign-ins) → Download.',
      'Graph alternative: GET /identityProtection/riskDetections saved as JSON.',
    ],
    docsUrl: 'https://learn.microsoft.com/en-us/entra/identity/monitoring-health/reference-reports-data-retention',
  },
  message_trace: {
    id: 'message_trace',
    layer: 'B',
    label: 'Exchange message trace',
    vendorName: 'Exchange Online',
    description: 'Per-recipient delivery outcome of every message sent or received, with sender IP and message IDs.',
    retentionDays: 10,
    retentionDaysPremium: 90,
    retentionNote: 'Real-time trace covers 10 days. Historical search / Get-MessageTraceV2 cover 90 days in 10-day slices; client IP is only kept for 10 days.',
    howToExport: [
      'Exchange admin center → Mail flow → Message trace → Start a trace with the date range and no sender/recipient filter.',
      'For >10 days pick "Enhanced summary report" (CSV, up to 100,000 rows) — one file per 10-day slice.',
      'PowerShell: Get-MessageTraceV2 -StartDate … -EndDate … -ResultSize 5000 | Export-Csv (page with StartingRecipientAddress/EndDate).',
    ],
    exportRowLimit: 100000,
    docsUrl: 'https://learn.microsoft.com/en-us/exchange/monitoring/trace-an-email-message/message-trace-modern-eac',
  },
  defender_email: {
    id: 'defender_email',
    layer: 'B',
    label: 'Defender email events',
    vendorName: 'Microsoft Defender for Office 365',
    description: 'EmailEvents / Threat Explorer: threat verdicts, delivery action and location, detection technology per message and recipient.',
    retentionDays: 30,
    retentionNote: 'Advanced hunting and Threat Explorer keep 30 days.',
    howToExport: [
      'Defender portal → Hunting → Advanced hunting. Run: EmailEvents | where Timestamp > ago(30d) → Export (CSV, up to 100,000 rows per query).',
      'Or run the combined query: union withsource=Table EmailEvents, EmailPostDeliveryEvents, EmailUrlInfo, UrlClickEvents | where Timestamp > ago(30d) — the importer splits it by table.',
      'Threat Explorer → All email → Export also works (up to 200,000 rows).',
    ],
    exportRowLimit: 100000,
    docsUrl: 'https://learn.microsoft.com/en-us/defender-xdr/advanced-hunting-emailevents-table',
  },
  defender_url_click: {
    id: 'defender_url_click',
    layer: 'B',
    label: 'Safe Links URL clicks',
    vendorName: 'Microsoft Defender for Office 365',
    description: 'UrlClickEvents: who clicked which link, whether it was blocked, and whether they clicked through a warning.',
    retentionDays: 30,
    retentionNote: 'Advanced hunting keeps 30 days.',
    howToExport: ['Advanced hunting: UrlClickEvents | where Timestamp > ago(30d) → Export (CSV).'],
    exportRowLimit: 100000,
    docsUrl: 'https://learn.microsoft.com/en-us/defender-xdr/advanced-hunting-urlclickevents-table',
  },
  defender_url_info: {
    id: 'defender_url_info',
    layer: 'B',
    label: 'Email URL info',
    vendorName: 'Microsoft Defender for Office 365',
    description: 'EmailUrlInfo: the links contained in each message.',
    retentionDays: 30,
    retentionNote: 'Advanced hunting keeps 30 days.',
    howToExport: ['Advanced hunting: EmailUrlInfo | where Timestamp > ago(30d) → Export (CSV).'],
    exportRowLimit: 100000,
    docsUrl: 'https://learn.microsoft.com/en-us/defender-xdr/advanced-hunting-emailurlinfo-table',
  },
  defender_post_delivery: {
    id: 'defender_post_delivery',
    layer: 'B',
    label: 'Post-delivery actions (ZAP)',
    vendorName: 'Microsoft Defender for Office 365',
    description: 'EmailPostDeliveryEvents: zero-hour auto purge and manual remediation after delivery.',
    retentionDays: 30,
    retentionNote: 'Advanced hunting keeps 30 days.',
    howToExport: ['Advanced hunting: EmailPostDeliveryEvents | where Timestamp > ago(30d) → Export (CSV).'],
    exportRowLimit: 100000,
    docsUrl: 'https://learn.microsoft.com/en-us/defender-xdr/advanced-hunting-emailpostdeliveryevents-table',
  },
  defender_attachment: {
    id: 'defender_attachment',
    layer: 'B',
    label: 'Email attachment info',
    vendorName: 'Microsoft Defender for Office 365',
    description: 'EmailAttachmentInfo: attachments per message with hashes and verdicts.',
    retentionDays: 30,
    retentionNote: 'Advanced hunting keeps 30 days.',
    howToExport: ['Advanced hunting: EmailAttachmentInfo | where Timestamp > ago(30d) → Export (CSV).'],
    exportRowLimit: 100000,
    docsUrl: 'https://learn.microsoft.com/en-us/defender-xdr/advanced-hunting-emailattachmentinfo-table',
  },
};

export const SOURCE_IDS = Object.keys(SOURCES) as Exclude<SourceId, 'unknown'>[];

export function sourceLabel(id: SourceId): string {
  return id === 'unknown' ? 'Unknown source' : SOURCES[id].label;
}
