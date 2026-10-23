/** Shared helpers for the normalisers. */

export function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') { const t = v.trim(); return t === '' ? null : t; }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

export function lower(v: unknown): string | null {
  const s = str(v);
  return s ? s.toLowerCase() : null;
}

/**
 * Parse the many timestamp shapes Microsoft exports use and return ISO-8601 UTC.
 *  - "2025-01-31T09:12:44.0000000Z"         (new Purview portal, Graph)
 *  - "2025-01-31T09:12:44"                   (AuditData.CreationTime — UTC, no suffix)
 *  - "1/31/2025 9:12:44 AM"                  (Export-Csv with US culture — UTC, no suffix)
 *  - "31-01-2025 09:12:44"                   (Export-Csv with da-DK culture)
 *  - "2025-01-31 09:12:44 UTC" / epoch ms
 */
export function toIso(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'number') return v > 1e11 ? new Date(v).toISOString() : new Date(v * 1000).toISOString();
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/(\.\d{3})\d+/, '$1');
  const hasZone = /(UTC|GMT|Z|[+-]\d\d:?\d\d)$/i.test(s);
  if (/^\d{4}-\d\d-\d\d[T ][\d:.]+$/.test(s)) s = s.replace(' ', 'T') + 'Z';
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s) && !hasZone) s += ' UTC';
  else if (/^\d{1,2}[-.]\d{1,2}[-.]\d{4}/.test(s)) {
    // day-first culture (da-DK, de-DE…)
    const m = s.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{4})[ T]?(\d{1,2})?:?(\d{2})?:?(\d{2})?/);
    if (m) {
      const [, d, mo, y, h = '0', mi = '0', se = '0'] = m;
      const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
      return Number.isNaN(t) ? null : new Date(t).toISOString();
    }
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Try to parse a JSON string; returns the input unchanged if it is already an object. */
export function parseJsonMaybe(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || (s[0] !== '{' && s[0] !== '[')) return null;
  try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : null; } catch { return null; }
}

/** Case-insensitive property access on a plain object. */
export function prop(o: Record<string, unknown> | null | undefined, name: string): unknown {
  if (!o) return undefined;
  if (name in o) return o[name];
  const k = name.toLowerCase();
  for (const key of Object.keys(o)) if (key.toLowerCase() === k) return o[key];
  return undefined;
}

/** Read a Name/Value pair array ({Name, Value}[]) case-insensitively. */
export function nv(arr: unknown, name: string): string | null {
  if (!Array.isArray(arr)) return null;
  const k = name.toLowerCase();
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const n = prop(e as Record<string, unknown>, 'Name');
    if (typeof n === 'string' && n.toLowerCase() === k) return str(prop(e as Record<string, unknown>, 'Value'));
  }
  return null;
}

/** Turn a Parameters[] array into a plain object. */
export function nvObject(arr: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(arr)) return out;
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const n = prop(e as Record<string, unknown>, 'Name');
    if (typeof n === 'string') out[n] = str(prop(e as Record<string, unknown>, 'Value')) ?? '';
  }
  return out;
}

export function normalizeMessageId(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return s.replace(/^<|>$/g, '').toLowerCase();
}

export function normalizeHeaderKey(k: string): string {
  return k.replace(/^﻿/, '').toLowerCase().replace(/[\s_()\-]/g, '');
}

export function truncate(s: string | null, n = 400): string | null {
  if (s == null) return null;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function lastSegment(path: string | null): string | null {
  if (!path) return null;
  const p = path.replace(/[\\/]+$/, '');
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) || p : p;
}

export function splitAddresses(v: unknown): string[] {
  const s = str(v);
  if (!s) return [];
  return s.split(/[;,]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/** Stable hash for synthesised record ids (FNV-1a 64-bit, hex). */
export function hashKey(...parts: (string | null | undefined)[]): string {
  const s = parts.map((p) => p ?? '').join('\u0001');
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}
