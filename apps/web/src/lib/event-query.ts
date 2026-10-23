import type { EventQuery } from '@audit/core';
import { parseQuery, type Term } from '@core/query';
import { splitList, joinList } from './format';

/** URL keys that map 1:1 onto EventQuery scalar params. */
export const SCALAR_KEYS = ['user', 'op', 'ip', 'workload', 'result', 'importId', 'session', 'mid', 'nmid', 'sensitive', 'from', 'to', 'sort'] as const;
/** URL keys holding comma lists (OR within, AND across). */
export const LIST_KEYS = ['source', 'group', 'kind', 'country', 'owner'] as const;
/** URL keys that become query-language terms (no dedicated API param). */
export const TERM_KEYS: Record<string, string> = { res: 'result', type: 'type' };

export type FilterKey = typeof SCALAR_KEYS[number] | typeof LIST_KEYS[number] | 'res' | 'type' | 'q' | 'exclusions';

export interface Preset {
  path: string;
  label: string;
  description: string;
  base: Partial<Record<'q' | typeof LIST_KEYS[number], string>>;
}

function serializeTerm(t: Term): string {
  const head = t.field ? `${t.field}:` : t.path ? `${t.path.join('.')}:` : '';
  const cmp = t.field === 'ts' && t.cmp ? t.cmp : '';
  const v = t.quoted || /\s/.test(t.value) || !t.value ? `"${t.value.replace(/"/g, '')}"` : t.value;
  return `${t.negate ? '-' : ''}${head}${cmp}${v}`;
}

/**
 * AND several queries together. The language has no parentheses, so (A1 OR A2) AND (B1 OR B2) is
 * distributed into A1 B1 OR A1 B2 OR A2 B1 OR A2 B2.
 */
export function combineQueries(parts: (string | undefined | null)[]): string | undefined {
  const groupSets = parts.filter((p): p is string => !!p && !!p.trim()).map((p) => parseQuery(p).groups).filter((g) => g.length);
  if (!groupSets.length) return undefined;
  if (groupSets.length === 1) return parts.find((p) => p && p.trim())!.trim();
  let acc: Term[][] = [[]];
  for (const gs of groupSets) {
    const next: Term[][] = [];
    for (const a of acc) for (const g of gs) next.push([...a, ...g]);
    acc = next;
    if (acc.length > 64) break; // pathological; keep it bounded
  }
  return acc.map((g) => g.map(serializeTerm).join(' ')).join(' OR ');
}

function intersectList(preset: string | undefined, url: string | undefined): string | undefined {
  const p = splitList(preset), u = splitList(url);
  if (!p.length) return u.length ? joinList(u) : undefined;
  if (!u.length) return joinList(p);
  const both = u.filter((x) => p.includes(x));
  return joinList(both.length ? both : p);
}

/** Effective API query from URL params plus an optional locked preset. */
export function buildEventQuery(url: Record<string, string>, preset?: Preset | null): EventQuery {
  const q: EventQuery = {};
  for (const k of SCALAR_KEYS) if (url[k]) (q as Record<string, string>)[k] = url[k];
  for (const k of LIST_KEYS) { const v = intersectList(preset?.base[k], url[k]); if (v) q[k] = v; }
  const terms: string[] = [];
  for (const [uk, field] of Object.entries(TERM_KEYS)) if (url[uk]) terms.push(`${field}:"${url[uk]}"`);
  const combined = combineQueries([preset?.base.q, url.q, ...terms]);
  if (combined) q.q = combined;
  if (url.exclusions === 'off') q.exclusions = 'off';
  if (q.result && q.result !== 'failed' && q.result !== 'succeeded') delete q.result;
  return q;
}

/** Toggle a value inside a list key (returns the new URL value or null to remove the key). */
export function toggleListValue(current: string | undefined, value: string): string | null {
  const list = splitList(current);
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  return next.length ? joinList(next) : null;
}

export function listHas(current: string | undefined, value: string): boolean { return splitList(current).includes(value); }

export const CHIP_LABEL: Record<string, string> = {
  user: 'user', op: 'operation', ip: 'client IP', workload: 'workload', result: 'result', importId: 'import', session: 'session', mid: 'message id', nmid: 'network message id',
  sensitive: 'sensitive', from: 'from', to: 'to', source: 'source', group: 'group', kind: 'kind', country: 'country', owner: 'IP owner', res: 'result', type: 'record type', sort: 'sort',
};

/** Flatten URL filters into chips (one per list value). */
export function activeChips(url: Record<string, string>): { key: string; value: string; display: string }[] {
  const out: { key: string; value: string; display: string }[] = [];
  for (const k of SCALAR_KEYS) if (url[k] && k !== 'from' && k !== 'to') out.push({ key: k, value: url[k], display: k === 'sensitive' && (url[k] === '1' || url[k] === '*') ? 'Sensitive operations' : url[k] });
  for (const k of LIST_KEYS) for (const v of splitList(url[k])) out.push({ key: k, value: v, display: v });
  for (const k of Object.keys(TERM_KEYS)) if (url[k]) out.push({ key: k, value: url[k], display: url[k] });
  return out;
}

/** Keys that are considered "filters" for the clear-all button (not UI state). */
export const FILTER_URL_KEYS: string[] = [...SCALAR_KEYS, ...LIST_KEYS, ...Object.keys(TERM_KEYS), 'q', 'exclusions'];
