import type { Tz } from './prefs';
import { usePrefs } from './prefs';

const pad = (n: number) => String(n).padStart(2, '0');

interface Parts { y: number; mo: number; d: number; h: number; mi: number; s: number; dow: number }

function parts(d: Date, tz: Tz): Parts {
  return tz === 'utc'
    ? { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() }
    : { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(), dow: d.getDay() };
}

export function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 2026-10-07 11:49:30 */
export function fmtDateTime(v: string | number | Date | null | undefined, tz: Tz, opts: { seconds?: boolean } = {}): string {
  const d = toDate(v);
  if (!d) return '—';
  const p = parts(d, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}${opts.seconds === false ? '' : ':' + pad(p.s)}`;
}

export function fmtDate(v: string | number | Date | null | undefined, tz: Tz): string {
  const d = toDate(v);
  if (!d) return '—';
  const p = parts(d, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

export function fmtTime(v: string | number | Date | null | undefined, tz: Tz): string {
  const d = toDate(v);
  if (!d) return '—';
  const p = parts(d, tz);
  return `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** "3 days ago", "in 2 days", "just now". */
export function fmtRelative(v: string | number | Date | null | undefined, now = Date.now()): string {
  const d = toDate(v);
  if (!d) return '—';
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [[31536e6, 'year'], [2592e6, 'month'], [6048e5, 'week'], [864e5, 'day'], [36e5, 'hour'], [6e4, 'minute']];
  if (abs < 45_000) return 'just now';
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms);
      const s = `${n} ${name}${n === 1 ? '' : 's'}`;
      return diff < 0 ? `${s} ago` : `in ${s}`;
    }
  }
  const n = Math.round(abs / 1000);
  return diff < 0 ? `${n} seconds ago` : `in ${n} seconds`;
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  if (d >= 2) return `${d} days`;
  if (d >= 1) return `${d} day ${h} h`;
  if (h >= 1) return `${h} h ${m} min`;
  if (m >= 1) return `${m} min`;
  return `${Math.round(ms / 1000)} s`;
}

/** Value for <input type=datetime-local> representing the instant in the chosen tz. */
export function toInputValue(iso: string | null | undefined, tz: Tz): string {
  const d = toDate(iso);
  if (!d) return '';
  const p = parts(d, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Parse a datetime-local value interpreted in the chosen tz back to ISO UTC. */
export function fromInputValue(v: string, tz: Tz): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  const date = tz === 'utc' ? new Date(Date.UTC(y, mo - 1, d, h, mi, s || 0)) : new Date(y, mo - 1, d, h, mi, s || 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function tzLabel(tz: Tz): string {
  if (tz === 'utc') return 'UTC';
  const off = -new Date().getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `UTC${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Local offset in whole hours (for shifting the hour heatmap). */
export function localOffsetHours(): number { return Math.round(-new Date().getTimezoneOffset() / 60); }

export function useTime() {
  const { tz } = usePrefs();
  return {
    tz,
    dateTime: (v: string | number | Date | null | undefined, opts?: { seconds?: boolean }) => fmtDateTime(v, tz, opts),
    date: (v: string | number | Date | null | undefined) => fmtDate(v, tz),
    time: (v: string | number | Date | null | undefined) => fmtTime(v, tz),
    relative: fmtRelative,
    label: tzLabel(tz),
  };
}
