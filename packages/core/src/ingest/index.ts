import type { DetectedFormat, NormalizedEvent, NormalizeContext } from './types.js';
import { detectFormat } from './detect.js';
import { normalizePurview } from './purview.js';
import { normalizeEntraSignIn, normalizeEntraAudit, normalizeEntraRisk } from './entra.js';
import { normalizeMessageTrace, normalizeDefender } from './email.js';
import { normalizeHeaderKey } from './util.js';

export * from './types.js';
export { detectFormat } from './detect.js';
export { describe, mailItems } from './purview.js';
export { traceStatusLabel } from './email.js';
export { toIso, parseJsonMaybe, prop, nv, nvObject, normalizeMessageId, hashKey } from './util.js';

export type Normalizer = (row: Record<string, unknown>) => NormalizedEvent[];

/** Build a row → events function for a detected format. */
export function createNormalizer(format: DetectedFormat): Normalizer {
  const ctx: NormalizeContext = { col: (role) => format.columns[role], format };
  switch (format.source) {
    case 'purview': return (row) => normalizePurview(row, ctx);
    case 'entra_signin': return (row) => normalizeEntraSignIn(row, ctx);
    case 'entra_audit': return (row) => normalizeEntraAudit(row, ctx);
    case 'entra_risk': return (row) => normalizeEntraRisk(row, ctx);
    case 'message_trace': return (row) => normalizeMessageTrace(row, ctx);
    case 'defender_email':
    case 'defender_url_click':
    case 'defender_url_info':
    case 'defender_post_delivery':
    case 'defender_attachment':
      return (row) => normalizeDefender(row, ctx);
    default:
      return () => [];
  }
}

/**
 * Unwrap the containers JSON exports come in and make every item look like a row:
 *  - Graph pages: { value: [...] }        - some tools: { records: [...] } / { Results: [...] }
 *  - bare arrays                           - a single object
 *  - arrays of raw AuditData objects (no AuditData column) are passed through as-is; the Purview
 *    normaliser recognises them by Operation/RecordType.
 */
export function unwrapJsonDocument(doc: unknown): Record<string, unknown>[] {
  if (Array.isArray(doc)) return doc.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
  if (doc && typeof doc === 'object') {
    const o = doc as Record<string, unknown>;
    for (const k of ['value', 'records', 'Results', 'results', 'items', 'data']) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
    return [o];
  }
  return [];
}

/** A format detected from JSON items should still work when the items carry mixed casing. */
export function detectFromRows(rows: Record<string, unknown>[]): DetectedFormat {
  return detectFormat(rows.slice(0, 50));
}

export { normalizeHeaderKey };
