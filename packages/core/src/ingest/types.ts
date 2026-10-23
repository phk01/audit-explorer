import type { SourceId } from '../catalog/sources.js';
import type { WorkloadGroup } from '../catalog/workloads.js';

/** Coarse shape of an event, used for column labelling and timeline sentences. */
export type EventKind =
  | 'signin'
  | 'dir'
  | 'admin'
  | 'mail'
  | 'file'
  | 'teams'
  | 'msg'
  | 'msgpost'
  | 'click'
  | 'urlinfo'
  | 'attachment'
  | 'risk'
  | 'copilot'
  | 'other';

export interface NormalizedEvent {
  source: SourceId;
  /** Stable identity of the source record — the dedup key within a workspace. */
  sourceRecordId: string;
  /** ISO-8601 UTC timestamp, or null when the record has none. */
  ts: string | null;
  workload: string | null;
  workloadGroup: WorkloadGroup;
  recordType: string | null;
  recordTypeId: number | null;
  operation: string;
  operationKey: string;
  kind: EventKind;
  /** Actor (lower-cased UPN or principal name). */
  userUpn: string | null;
  userType: string | null;
  objectId: string | null;
  /** Short human-readable "what" (subject, file name, app, team…). */
  item: string | null;
  /** Short human-readable context (folder, site, error, recipient…). */
  detail: string | null;
  clientIp: string | null;
  userAgent: string | null;
  result: string | null;
  failed: boolean;
  sessionId: string | null;
  correlationId: string | null;
  messageId: string | null;
  networkMessageId: string | null;
  /** The other party: recipient, sender, target user, mailbox owner. */
  counterpart: string | null;
  /** The original record, untouched (AuditData object, Graph object, or the CSV row). */
  raw: Record<string, unknown>;
  /** Export columns that wrapped the record (e.g. the CSV columns besides AuditData). */
  envelope: Record<string, unknown> | null;
}

export interface DetectedFormat {
  source: SourceId;
  /** Human label of the detected export, e.g. "Purview audit export (new portal)". */
  label: string;
  /** Original header → role mapping used by the normaliser. */
  columns: Record<string, string>;
  /** Format confidence notes for the import log. */
  notes: string[];
}

export interface NormalizeContext {
  /** Lower-cased header lookup prepared by detection. */
  col: (role: string) => string | undefined;
  format: DetectedFormat;
}
