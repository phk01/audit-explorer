import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { copyText } from '../lib/format';
import { useToast } from '../lib/toast';
import { IconCopy, IconSearch } from './Icons';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const LONG = 160;

function isNameValueList(v: unknown): v is { Name: string; Value: unknown }[] {
  if (!Array.isArray(v) || !v.length) return false;
  return v.every((e) => e && typeof e === 'object' && !Array.isArray(e) && (() => { const keys = Object.keys(e as object).map((k) => k.toLowerCase()).sort(); return keys.length === 2 && keys[0] === 'name' && keys[1] === 'value'; })());
}
function nvName(e: Record<string, unknown>): string { return String(e.Name ?? e.name ?? ''); }
function nvValue(e: Record<string, unknown>): unknown { return 'Value' in e ? e.Value : e.value; }

function tryParseJson(s: string): Json | undefined {
  const t = s.trim();
  if (!(t.startsWith('{') && t.endsWith('}')) && !(t.startsWith('[') && t.endsWith(']'))) return undefined;
  try { return JSON.parse(t) as Json; } catch { return undefined; }
}

/** Collect every path whose key or primitive value matches the needle. */
function collectMatches(value: unknown, needle: string, path: string, out: Set<string>, parents: Set<string>): void {
  if (!needle) return;
  const n = needle.toLowerCase();
  const mark = () => { out.add(path); let p = path; while (p.includes('/')) { p = p.slice(0, p.lastIndexOf('/')); parents.add(p); } parents.add(''); };
  if (value === null || typeof value !== 'object') { if (String(value).toLowerCase().includes(n)) mark(); return; }
  if (isNameValueList(value)) {
    value.forEach((e, i) => { const k = nvName(e as Record<string, unknown>); const cp = `${path}/${i}`; if (k.toLowerCase().includes(n)) { out.add(cp); mark(); } collectMatches(nvValue(e as Record<string, unknown>), needle, cp, out, parents); });
    return;
  }
  if (Array.isArray(value)) { value.forEach((e, i) => collectMatches(e, needle, `${path}/${i}`, out, parents)); return; }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const cp = `${path}/${k}`;
    if (k.toLowerCase().includes(n)) { out.add(cp); let p = cp; while (p.includes('/')) { p = p.slice(0, p.lastIndexOf('/')); parents.add(p); } parents.add(''); }
    collectMatches(v, needle, cp, out, parents);
  }
}

function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + needle.length)}</mark>{text.slice(i + needle.length)}</>;
}

interface Ctx { needle: string; matches: Set<string>; parents: Set<string>; copy: (v: unknown) => void; forceOpen: number; forceClose: number }

const Primitive = memo(function Primitive({ value, ctx, path }: { value: null | boolean | number | string; ctx: Ctx; path: string }) {
  const [expanded, setExpanded] = useState(false);
  const [parsed, setParsed] = useState(false);
  const isMatch = ctx.matches.has(path);
  if (typeof value === 'string') {
    const inner = parsed ? tryParseJson(value) : undefined;
    if (parsed && inner !== undefined) return <span className="jt-parsed"><button className="jt-mini" onClick={() => setParsed(false)}>raw string</button><Node name={null} value={inner} path={path + '/(parsed)'} depth={0} ctx={ctx} /></span>;
    const long = value.length > LONG && !expanded && !ctx.needle;
    const shown = long ? value.slice(0, LONG) : value;
    const parseable = !parsed && tryParseJson(value) !== undefined;
    return (
      <span className={`jt-val jt-str ${isMatch ? 'is-match' : ''}`}>
        <button className="jt-copy" title="Click to copy" onClick={() => ctx.copy(value)}>"<Highlight text={shown} needle={ctx.needle} />{long ? '…' : ''}"</button>
        {long && <button className="jt-mini" onClick={() => setExpanded(true)}>show all {value.length.toLocaleString('en-US')} chars</button>}
        {parseable && <button className="jt-mini" onClick={() => setParsed(true)}>parse JSON</button>}
      </span>
    );
  }
  const cls = value === null ? 'jt-null' : typeof value === 'boolean' ? 'jt-bool' : 'jt-num';
  return <span className={`jt-val ${cls} ${isMatch ? 'is-match' : ''}`}><button className="jt-copy" title="Click to copy" onClick={() => ctx.copy(value)}><Highlight text={String(value)} needle={ctx.needle} /></button></span>;
});

function Node({ name, value, path, depth, ctx, nv }: { name: string | null; value: unknown; path: string; depth: number; ctx: Ctx; nv?: boolean }): ReactNode {
  const isObj = value !== null && typeof value === 'object';
  const nameValue = isObj && isNameValueList(value);
  const entries: [string, unknown][] = useMemo(() => {
    if (!isObj) return [];
    if (nameValue) return (value as Record<string, unknown>[]).map((e) => [nvName(e), nvValue(e)] as [string, unknown]);
    if (Array.isArray(value)) return value.map((v, i) => [String(i), v]);
    return Object.entries(value as Record<string, unknown>);
  }, [value, isObj, nameValue]);
  const hasMatchBelow = ctx.parents.has(path);
  const [open, setOpen] = useState(depth < 2 || hasMatchBelow);
  useEffect(() => { if (ctx.needle && hasMatchBelow) setOpen(true); }, [ctx.needle, hasMatchBelow]);
  useEffect(() => { if (ctx.forceOpen) setOpen(true); }, [ctx.forceOpen]);
  useEffect(() => { if (ctx.forceClose) setOpen(depth < 1); }, [ctx.forceClose, depth]);

  const keyMatch = ctx.matches.has(path) && isObj;
  const label = name != null && (
    <span className={`jt-key ${keyMatch || (!isObj && ctx.matches.has(path) && ctx.needle && name.toLowerCase().includes(ctx.needle.toLowerCase())) ? 'is-match' : ''}`}>
      <Highlight text={name} needle={ctx.needle} />{nv && <span className="jt-nv" title="From a Name/Value pair">nv</span>}
    </span>
  );

  if (!isObj) {
    return (
      <div className="jt-row" style={{ paddingLeft: depth * 14 }}>
        {label}{name != null && <span className="jt-colon">:</span>}
        <Primitive value={value as null | boolean | number | string} ctx={ctx} path={path} />
      </div>
    );
  }
  const count = entries.length;
  const summary = nameValue ? `${count} name/value pair${count === 1 ? '' : 's'}` : Array.isArray(value) ? `${count} item${count === 1 ? '' : 's'}` : `${count} ${count === 1 ? 'property' : 'properties'}`;
  return (
    <div className="jt-node">
      <div className="jt-row" style={{ paddingLeft: depth * 14 }}>
        <button className="jt-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${name ?? 'record'}`} onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'}</button>
        {label}{name != null && <span className="jt-colon">:</span>}
        <span className="jt-summary">{Array.isArray(value) && !nameValue ? '[' : '{'}{!open && <span className="muted"> {summary} </span>}{!open && (Array.isArray(value) && !nameValue ? ']' : '}')}</span>
        {!open && count === 0 && null}
      </div>
      {open && (
        <>
          {entries.map(([k, v], i) => <Node key={nameValue ? `${i}:${k}` : k} name={k} value={v} path={nameValue ? `${path}/${i}` : `${path}/${k}`} depth={depth + 1} ctx={ctx} nv={nameValue} />)}
          <div className="jt-row jt-close" style={{ paddingLeft: depth * 14 + 18 }}>{Array.isArray(value) && !nameValue ? ']' : '}'}</div>
        </>
      )}
    </div>
  );
}

export function JsonTree({ value, title, defaultSearch = '' }: { value: unknown; title?: ReactNode; defaultSearch?: string }) {
  const [needle, setNeedle] = useState(defaultSearch);
  const [forceOpen, setForceOpen] = useState(0);
  const [forceClose, setForceClose] = useState(0);
  const { toast } = useToast();
  const copy = useCallback((v: unknown) => { copyText(typeof v === 'string' ? v : JSON.stringify(v)).then(() => toast('Copied', 'ok'), () => toast('Copy failed', 'error')); }, [toast]);
  const { matches, parents } = useMemo(() => {
    const matches = new Set<string>(), parents = new Set<string>();
    collectMatches(value, needle.trim(), '', matches, parents);
    return { matches, parents };
  }, [value, needle]);
  const ctx = useMemo<Ctx>(() => ({ needle: needle.trim(), matches, parents, copy, forceOpen, forceClose }), [needle, matches, parents, copy, forceOpen, forceClose]);
  const json = useMemo(() => JSON.stringify(value, null, 2), [value]);
  return (
    <div className="jt">
      <div className="jt-toolbar">
        {title && <div className="jt-title">{title}</div>}
        <label className="jt-search">
          <IconSearch size={14} />
          <input type="search" placeholder="Search in record" value={needle} onChange={(e) => setNeedle(e.target.value)} aria-label="Search in record" />
          {needle.trim() && <span className="small muted mono">{matches.size}</span>}
        </label>
        <button className="btn btn-sm" onClick={() => setForceOpen((n) => n + 1)}>Expand all</button>
        <button className="btn btn-sm" onClick={() => setForceClose((n) => n + 1)}>Collapse</button>
        <button className="btn btn-sm" onClick={() => copy(json)} title="Copy the whole record as JSON"><IconCopy size={14} /> Copy JSON</button>
      </div>
      <div className="jt-body mono" key={`${forceOpen}-${forceClose}`}>
        <Node name={null} value={value} path="" depth={0} ctx={ctx} />
      </div>
    </div>
  );
}
