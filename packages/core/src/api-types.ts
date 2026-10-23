/**
 * API contract shared by the server and the web client. Every route is under /api.
 * All timestamps are ISO-8601 UTC strings. IDs are UUIDs unless noted.
 */
import type { SourceId, Layer } from './catalog/sources.js';
import type { WorkloadGroup } from './catalog/workloads.js';
import type { EventKind } from './ingest/types.js';

export type Role = 'admin' | 'analyst';

export interface User { id: string; email: string; name: string; role: Role; createdAt: string; lastLoginAt: string | null }

export interface Workspace {
  id: string;
  name: string;
  /** Customer tenant domains (lower-case). Used to tell internal from external addresses. */
  tenantDomains: string[];
  /** Expected sign-in countries (ISO alpha-2). */
  expectedCountries: string[];
  notes: string;
  /** IP exclusion rules, one per line (ip, CIDR, glob, # comments). */
  excludedIps: string;
  excludeMicrosoftIps: boolean;
  excludeKeepitIps: boolean;
  createdAt: string;
  updatedAt: string;
  stats?: WorkspaceStats;
}

export interface WorkspaceStats {
  events: number;
  imports: number;
  people: number;
  firstEvent: string | null;
  lastEvent: string | null;
  lastImportAt: string | null;
  runningImports: number;
  clientIps: number;
  sourcesCollected: SourceId[];
}

export type ImportStatus = 'queued' | 'detecting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';

export interface Import {
  id: string;
  workspaceId: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  source: SourceId | null;
  formatLabel: string | null;
  status: ImportStatus;
  rowsTotal: number | null;
  rowsProcessed: number;
  eventsInserted: number;
  eventsDuplicate: number;
  rowsFailed: number;
  bytesProcessed: number;
  checkpointRow: number;
  minTs: string | null;
  maxTs: string | null;
  error: string | null;
  warnings: string[];
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface EventRow {
  id: number;
  importId: string;
  source: SourceId;
  layer: Layer;
  sourceRecordId: string;
  ts: string | null;
  workload: string | null;
  workloadGroup: WorkloadGroup;
  recordType: string | null;
  recordTypeId: number | null;
  operation: string;
  operationKey: string;
  friendlyOperation: string | null;
  kind: EventKind;
  userUpn: string | null;
  userType: string | null;
  objectId: string | null;
  item: string | null;
  detail: string | null;
  clientIp: string | null;
  ipCountry: string | null;
  ipOwner: string | null;
  ipOwnerName: string | null;
  userAgent: string | null;
  result: string | null;
  failed: boolean;
  sessionId: string | null;
  correlationId: string | null;
  messageId: string | null;
  networkMessageId: string | null;
  counterpart: string | null;
  sensitiveFamily: string | null;
}

export interface EventDetail extends EventRow {
  raw: Record<string, unknown>;
  envelope: Record<string, unknown> | null;
  import: Pick<Import, 'id' | 'fileName' | 'formatLabel' | 'createdAt'>;
  activity: { friendlyName: string; description: string } | null;
  recordTypeDescription: string | null;
  /** Events sharing the same session / correlation / message id (small, capped). */
  related: { bySession: number; byCorrelation: number; byMessage: number };
}

export interface EventQuery {
  q?: string;
  from?: string;
  to?: string;
  user?: string;
  op?: string;
  ip?: string;
  source?: string;      // comma-separated SourceIds
  group?: string;       // comma-separated WorkloadGroups
  workload?: string;
  kind?: string;
  result?: 'failed' | 'succeeded';
  country?: string;
  owner?: string;
  importId?: string;
  session?: string;
  mid?: string;
  nmid?: string;
  /** Only events whose operation belongs to a sensitive family (optionally a specific family name). */
  sensitive?: string;
  /** Apply the workspace IP exclusion rules (default true). */
  exclusions?: 'on' | 'off';
  sort?: 'ts' | '-ts';
  cursor?: string;
  limit?: number;
}

export interface EventPage {
  items: EventRow[];
  nextCursor: string | null;
  /** Exact count when cheap, otherwise an estimate flagged by `approx`. */
  total: number;
  approx: boolean;
  hiddenByExclusions: number;
}

export interface FacetBucket { value: string; count: number; label?: string }

export interface EventFacets {
  sources: FacetBucket[];
  groups: FacetBucket[];
  workloads: FacetBucket[];
  operations: FacetBucket[];
  users: FacetBucket[];
  ips: FacetBucket[];
  countries: FacetBucket[];
  owners: FacetBucket[];
  results: FacetBucket[];
  kinds: FacetBucket[];
  recordTypes: FacetBucket[];
}

export interface HistogramBucket { ts: string; count: number; failed: number }
export interface Histogram { unit: 'hour' | 'day' | 'week'; buckets: HistogramBucket[]; from: string | null; to: string | null }

export interface Person {
  upn: string;
  displayName: string | null;
  kind: 'member' | 'guest' | 'service' | 'system' | 'external';
  firstSeen: string | null;
  lastSeen: string | null;
  events: number;
  failed: number;
  signIns: number;
  sources: SourceId[];
  ipCount: number;
  countries: string[];
  sensitiveEvents: number;
}

export interface PersonDetail extends Person {
  ips: { ip: string; country: string | null; owner: string | null; ownerName: string | null; events: number; failed: number; firstSeen: string; lastSeen: string }[];
  clients: { family: string; events: number; firstSeen: string; lastSeen: string }[];
  operations: FacetBucket[];
  workloads: FacetBucket[];
  groups: FacetBucket[];
  countriesDetail: FacetBucket[];
  counterparts: FacetBucket[];
  histogram: Histogram;
  hourHeatmap: number[][]; // 7 x 24 (Mon..Sun x hour UTC)
  sensitive: { family: string; count: number; lastSeen: string }[];
}

export interface SourceCoverage {
  source: SourceId;
  layer: Layer;
  label: string;
  description: string;
  status: 'collected' | 'not_collected';
  events: number;
  imports: number;
  firstEvent: string | null;
  lastEvent: string | null;
  lastImportAt: string | null;
  retentionDays: number;
  retentionDaysPremium: number | null;
  retentionNote: string;
  /** Date after which the oldest evidence window of this source can no longer be exported from Microsoft. */
  retentionHorizon: string | null;
  retentionWarning: string | null;
  howToExport: string[];
  docsUrl: string;
  /** Days between firstEvent and lastEvent with zero events (Layer A only; a hint of missing slices). */
  gaps: { from: string; to: string; days: number }[];
  recordTypes: { recordType: string; recordTypeId: number | null; events: number; inCatalog: boolean }[];
  importsHitRowLimit: number;
}

export interface Coverage {
  generatedAt: string;
  workspaceId: string;
  sources: SourceCoverage[];
  groups: { group: WorkloadGroup; label: string; events: number; recordTypes: number; operations: number }[];
  unknownOperations: { operation: string; workload: string | null; recordType: string | null; events: number; firstSeen: string; lastSeen: string }[];
  catalog: { recordTypes: number; activities: number; geoSource: string; ipOwnerDataAsOf: string };
  warnings: string[];
}

export interface Overview {
  stats: WorkspaceStats;
  histogram: Histogram;
  topUsers: FacetBucket[];
  topOperations: FacetBucket[];
  topIps: (FacetBucket & { country: string | null; owner: string | null })[];
  countries: FacetBucket[];
  groups: FacetBucket[];
  failedEvents: number;
  sensitiveEvents: number;
  sources: FacetBucket[];
  recentImports: Import[];
}

export interface ImportProgressEvent {
  type: 'progress' | 'status';
  importId: string;
  workspaceId: string;
  status: ImportStatus;
  rowsProcessed: number;
  eventsInserted: number;
  eventsDuplicate: number;
  rowsFailed: number;
  bytesProcessed: number;
  fileSize: number;
  formatLabel: string | null;
  source: SourceId | null;
  error: string | null;
}

export interface SavedSearch { id: string; workspaceId: string | null; name: string; query: EventQuery; createdBy: string; createdAt: string }

export interface ApiError { error: string; message: string; details?: unknown }
