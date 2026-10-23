import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type UrlPatch = Record<string, string | number | boolean | null | undefined>;

/**
 * Every filter lives in the URL. Returns the current params as a plain object and a setter that
 * patches them (null/undefined/'' removes a key). Patches made within the same tick are merged.
 */
export function useUrlState(): [Record<string, string>, (patch: UrlPatch, opts?: { replace?: boolean }) => void] {
  const [sp, setSp] = useSearchParams();
  const pending = useRef<{ patch: UrlPatch; replace: boolean } | null>(null);
  const params = useMemo(() => {
    const o: Record<string, string> = {};
    sp.forEach((v, k) => { o[k] = v; });
    return o;
  }, [sp]);

  const set = useCallback((patch: UrlPatch, opts?: { replace?: boolean }) => {
    if (pending.current) { Object.assign(pending.current.patch, patch); pending.current.replace = pending.current.replace && (opts?.replace ?? false); return; }
    pending.current = { patch: { ...patch }, replace: opts?.replace ?? false };
    queueMicrotask(() => {
      const p = pending.current!; pending.current = null;
      setSp((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(p.patch)) {
          if (v === null || v === undefined || v === '' || v === false) next.delete(k);
          else next.set(k, v === true ? '1' : String(v));
        }
        return next;
      }, { replace: p.replace });
    });
  }, [setSp]);

  return [params, set];
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Persisted local UI preference (not shared state). */
export function useLocalPref<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw == null ? initial : (JSON.parse(raw) as T); } catch { return initial; }
  });
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setV((prev) => {
      const val = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
      return val;
    });
  }, [key]);
  return [v, set];
}
