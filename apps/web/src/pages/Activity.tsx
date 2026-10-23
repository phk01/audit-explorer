import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { EventFacets, EventPage, EventRow } from '@audit/core';
import { QUERY_HELP, FIELD_ALIASES } from '@core/query';
import { useWorkspaceCtx } from './WorkspaceShell';
import { useDebounced, useLocalPref, useUrlState } from '../lib/url';
import { useEventsInfinite, useFacets, useHistogram } from '../lib/queries';
import { endpoints } from '../lib/api';
import { activeChips, buildEventQuery, CHIP_LABEL, FILTER_URL_KEYS, LIST_KEYS, listHas, toggleListValue, type Preset } from '../lib/event-query';
import { fmtInt, truncate } from '../lib/format';
import { fromInputValue, toInputValue, useTime } from '../lib/time';
import { usePrefs } from '../lib/prefs';
import { DataTable, type Column } from '../components/DataTable';
import { Histogram } from '../components/Histogram';
import { FacetsPanel } from '../components/Facets';
import { Inspector } from '../components/Inspector';
import { EmptyState, ErrorState } from '../components/Basics';
import { GroupChip, IpCell, ResultCell, SensitivePill, SourceChip, sourceShort } from '../components/Badges';
import { IconClose, IconColumns, IconDownload, IconFilter, IconHelp, IconLock, IconSearch } from '../components/Icons';
import { friendly } from './Overview';

export interface AreaTile { label: string; value: ReactNode; tone?: 'crit' | 'warn' | 'ok' }

interface Props {
  preset?: Preset | null;
  title?: string;
  description?: string;
  tiles?: (facets: EventFacets | undefined, page: EventPage | undefined) => AreaTile[];
}

type ColId = 'ts' | 'user' | 'activity' | 'source' | 'item' | 'detail' | 'ip' | 'result' | 'recordType' | 'ua' | 'session' | 'counterpart' | 'recordId' | 'file';
const DEFAULT_COLS: ColId[] = ['ts', 'user', 'activity', 'source', 'item', 'detail', 'ip', 'result'];
const OPTIONAL_COLS: { id: ColId; label: string }[] = [
  { id: 'recordType', label: 'Record type' }, { id: 'ua', label: 'User agent' }, { id: 'session', label: 'Session' }, { id: 'counterpart', label: 'Counterpart' }, { id: 'recordId', label: 'Record id' }, { id: 'file', label: 'Source file' },
];
const ALL_COLS: { id: ColId; label: string }[] = [
  { id: 'ts', label: 'Time' }, { id: 'user', label: 'User' }, { id: 'activity', label: 'Activity' }, { id: 'source', label: 'Source / workload' }, { id: 'item', label: 'Item' }, { id: 'detail', label: 'Details' }, { id: 'ip', label: 'Client IP' }, { id: 'result', label: 'Result' }, ...OPTIONAL_COLS,
];

export function ActivityPage() { return <ActivityView />; }

export function ActivityView({ preset, title, description, tiles }: Props) {
  const { wsId, workspace } = useWorkspaceCtx();
  const [url, setUrl] = useUrlState();
  const navigate = useNavigate();
  const t = useTime();
  const query = useMemo(() => buildEventQuery(url, preset), [url, preset]);
  const events = useEventsInfinite(wsId, query);
  const facets = useFacets(wsId, query);
  const hist = useHistogram(wsId, query);
  const [showFacets, setShowFacets] = useLocalPref('ae.activity.facets', true);
  const [cols, setCols] = useLocalPref<ColId[]>('ae.activity.cols', DEFAULT_COLS);
  const [colMenu, setColMenu] = useState(false);
  const [drawerWidth, setDrawerWidth] = useLocalPref<number>('ae.drawer.width', 520);
  const [exportMenu, setExportMenu] = useState(false);
  const selectedId = url.ev ? Number(url.ev) : null;
  const expected = useMemo(() => new Set(workspace.expectedCountries.map((c) => c.toUpperCase())), [workspace.expectedCountries]);

  const rows = useMemo(() => events.data?.pages.flatMap((p) => p.items) ?? [], [events.data]);
  const first = events.data?.pages[0];
  const importNames = useRef(new Map<string, string>());

  // facet selection helpers
  const sel = useMemo(() => ({
    isSelected: (key: string, value: string) => (LIST_KEYS as readonly string[]).includes(key) ? listHas(url[key], value) : url[key] === value,
    toggle: (key: string, value: string) => {
      if ((LIST_KEYS as readonly string[]).includes(key)) setUrl({ [key]: toggleListValue(url[key], value), ev: null });
      else setUrl({ [key]: url[key] === value ? null : value, ev: null });
    },
  }), [url, setUrl]);
  const ownerByIp = useMemo(() => { const m = new Map<string, string>(); for (const r of rows) if (r.clientIp && r.ipOwner) m.set(r.clientIp, r.ipOwner); return m; }, [rows]);

  const openRow = useCallback((row: EventRow) => setUrl({ ev: row.id }, { replace: true }), [setUrl]);
  const closeInspector = useCallback(() => setUrl({ ev: null }, { replace: true }), [setUrl]);
  const pivot = useCallback((params: Record<string, string | null>) => {
    if (preset) { // leave the area: pivots are global
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
      navigate(`/w/${wsId}/activity?${sp.toString()}`);
    } else setUrl({ ...params, ev: null });
  }, [preset, navigate, wsId, setUrl]);

  useEffect(() => {
    if (!colMenu && !exportMenu) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.menu')) { setColMenu(false); setExportMenu(false); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [colMenu, exportMenu]);

  const columns = useMemo<Column<EventRow>[]>(() => {
    const defs: Record<ColId, Column<EventRow>> = {
      ts: { id: 'ts', header: <button className="link-btn" style={{ color: 'inherit', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit' }} onClick={() => setUrl({ sort: url.sort === 'ts' ? null : 'ts' })} title="Toggle sort order">Time {url.sort === 'ts' ? '↑' : '↓'}</button>, width: '164px', cell: (r) => <span className="cell-2 cell-time"><span>{t.dateTime(r.ts)}</span><span className="cell-sub">{r.ts ? t.relative(r.ts) : 'no timestamp'}</span></span> },
      user: { id: 'user', header: 'User', width: 'minmax(140px, 1.1fr)', cell: (r) => <span className="cell-2"><span title={r.userUpn ?? ''}>{r.userUpn ?? <span className="muted">—</span>}</span>{r.counterpart && r.counterpart !== r.userUpn && <span className="cell-sub" title={`Counterpart: ${r.counterpart}`}>→ {r.counterpart}</span>}</span> },
      activity: { id: 'activity', header: 'Activity', width: 'minmax(160px, 1.2fr)', cell: (r) => <span className="cell-2"><span className="row gap-4" style={{ minWidth: 0 }}><span className="ellipsis">{r.friendlyOperation ?? friendly(r.operation)}</span><SensitivePill family={r.sensitiveFamily} /></span><span className="cell-sub mono">{r.operation}</span></span> },
      source: { id: 'source', header: 'Source', width: '130px', cell: (r) => <span className="cell-2"><span><SourceChip id={r.source} /></span><span className="cell-sub"><GroupChip group={r.workloadGroup} workload={r.workload} /></span></span> },
      item: { id: 'item', header: 'Item', width: 'minmax(120px, 1.1fr)', cell: (r) => <span title={r.item ?? ''} className="ellipsis">{r.item ?? <span className="muted">—</span>}</span> },
      detail: { id: 'detail', header: 'Details', width: 'minmax(140px, 1.5fr)', cell: (r) => <span title={r.detail ?? ''} className="ellipsis small">{r.detail ?? <span className="muted">—</span>}</span> },
      ip: { id: 'ip', header: 'Client IP', width: '180px', cell: (r) => <IpCell ip={r.clientIp} cc={r.ipCountry} owner={r.ipOwner} ownerName={r.ipOwnerName} alert={!!r.ipCountry && expected.size > 0 && !expected.has(r.ipCountry.toUpperCase()) && !r.ipOwner} /> },
      result: { id: 'result', header: 'Result', width: '100px', cell: (r) => <ResultCell result={r.result} failed={r.failed} /> },
      recordType: { id: 'recordType', header: 'Record type', width: '170px', cell: (r) => <span className="mono small">{r.recordType ?? '—'}</span> },
      ua: { id: 'ua', header: 'User agent', width: 'minmax(160px, 1fr)', cell: (r) => <span className="mono small ellipsis" title={r.userAgent ?? ''}>{r.userAgent ?? '—'}</span> },
      session: { id: 'session', header: 'Session', width: '160px', cell: (r) => <span className="mono small ellipsis" title={r.sessionId ?? ''}>{r.sessionId ?? '—'}</span> },
      counterpart: { id: 'counterpart', header: 'Counterpart', width: 'minmax(150px, 1fr)', cell: (r) => <span className="ellipsis" title={r.counterpart ?? ''}>{r.counterpart ?? '—'}</span> },
      recordId: { id: 'recordId', header: 'Record id', width: '240px', cell: (r) => <span className="mono small ellipsis" title={r.sourceRecordId}>{r.sourceRecordId}</span> },
      file: { id: 'file', header: 'Source file', width: '180px', cell: (r) => <span className="mono small ellipsis">{importNames.current.get(r.importId) ?? r.importId.slice(0, 8)}</span> },
    };
    return cols.map((c) => defs[c]).filter(Boolean);
  }, [cols, t, expected, url.sort, setUrl]);

  useEffect(() => {
    if (!cols.includes('file') || importNames.current.size) return;
    endpoints.imports(wsId).then((list) => { for (const i of list) importNames.current.set(i.id, i.fileName); }).catch(() => {});
  }, [cols, wsId]);

  const chips = activeChips(url);
  const total = first?.total ?? 0;
  const hidden = first?.hiddenByExclusions ?? 0;
  const exclusionsOff = url.exclusions === 'off';
  const hasFilters = FILTER_URL_KEYS.some((k) => url[k]);
  const tileItems = tiles ? tiles(facets.data, first) : [];

  return (
    <div className={`activity ${selectedId != null ? 'has-drawer' : ''}`} style={selectedId != null ? ({ '--drawer-w': `${drawerWidth}px` } as React.CSSProperties) : undefined}>
      <div className="filterbar">
        {(title || description) && <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><div><h1 style={{ fontSize: 18 }}>{title}</h1>{description && <div className="muted small">{description}</div>}</div></div>}
        <div className="filterbar-row">
          <button className={`icon-btn ${showFacets ? 'is-active' : ''}`} aria-label={showFacets ? 'Hide facets' : 'Show facets'} aria-pressed={showFacets} title="Facets" onClick={() => setShowFacets((v) => !v)}><IconFilter /></button>
          <QueryInput value={url.q ?? ''} onChange={(q) => setUrl({ q: q || null, ev: null }, { replace: true })} onSubmit={(q) => setUrl({ q: q || null, ev: null })} />
          <DateRange from={url.from} to={url.to} onChange={(from, to) => setUrl({ from, to, ev: null })} />
          <button className={`toggle ${url.result === 'failed' ? 'is-on' : ''}`} aria-pressed={url.result === 'failed'} onClick={() => setUrl({ result: url.result === 'failed' ? null : 'failed', ev: null })}><span className="sw" aria-hidden />Failed only</button>
          <button className={`toggle ${url.sensitive === '1' ? 'is-on' : ''}`} aria-pressed={url.sensitive === '1'} onClick={() => setUrl({ sensitive: url.sensitive ? null : '1', ev: null })} title="Only operations in a sensitive family (roles, consent, inbox rules, forwarding…)"><span className="sw" aria-hidden />Sensitive only</button>
          <button className={`toggle ${!exclusionsOff ? 'is-on' : ''}`} aria-pressed={!exclusionsOff} onClick={() => setUrl({ exclusions: exclusionsOff ? null : 'off', ev: null })} title="Apply the workspace IP exclusion rules"><span className="sw" aria-hidden />Exclusions{hidden > 0 && !exclusionsOff ? <span className="muted"> · {fmtInt(hidden)} hidden</span> : null}</button>
        </div>
        {(chips.length > 0 || preset || url.from || url.to) && (
          <div className="fchips">
            {preset && Object.entries(preset.base).map(([k, v]) => <span key={k} className="fchip is-locked" title="Fixed for this area"><IconLock size={11} /><span className="fchip-k">{CHIP_LABEL[k] ?? k}</span><span className="fchip-v">{k === 'q' ? v : v!.split(',').map((x) => k === 'source' ? sourceShort(x) : x).join(', ')}</span></span>)}
            {url.from && <Chip k="from" v={t.dateTime(url.from, { seconds: false })} onRemove={() => setUrl({ from: null, ev: null })} />}
            {url.to && <Chip k="to" v={t.dateTime(url.to, { seconds: false })} onRemove={() => setUrl({ to: null, ev: null })} />}
            {chips.map((c) => <Chip key={`${c.key}:${c.value}`} k={CHIP_LABEL[c.key] ?? c.key} v={c.key === 'importId' ? (importNames.current.get(c.value) ?? truncate(c.value, 12)) : c.display} onRemove={() => sel.toggle(c.key, c.value)} />)}
            {hasFilters && <button className="link-btn small" onClick={() => setUrl(Object.fromEntries([...FILTER_URL_KEYS, 'ev'].map((k) => [k, null])))}>Clear all</button>}
          </div>
        )}
      </div>

      {tileItems.length > 0 && (
        <div className="area-tiles">
          {tileItems.map((tile) => <div className="area-tile" key={tile.label}><div className="t-label">{tile.label}</div><div className={`t-value ${tile.tone ? `tone-${tile.tone}` : ''}`}>{tile.value}</div></div>)}
        </div>
      )}

      <div className={`activity-body ${showFacets ? '' : 'no-facets'}`}>
        {showFacets && <FacetsPanel facets={facets.data} loading={facets.isPending} sel={sel} ownerByIp={ownerByIp} />}
        <div className="results">
          <div className="results-head">
            <div className="results-count" aria-live="polite">{events.isPending && !first ? <span className="skeleton" style={{ width: 120, height: 18 }} /> : <>{first?.approx && <span className="approx" title="Estimated count">≈ </span>}{fmtInt(total)} <span className="muted" style={{ fontWeight: 400 }}>{total === 1 ? 'event' : 'events'}</span></>}</div>
            {events.isFetching && !events.isFetchingNextPage && first && <span className="small muted">updating…</span>}
            <div className="grow" />
            <div className="menu">
              <button className="btn btn-sm" onClick={() => { setExportMenu((v) => !v); setColMenu(false); }} aria-haspopup="menu" aria-expanded={exportMenu}><IconDownload size={14} /> Export CSV</button>
              {exportMenu && (
                <div className="colmenu" role="menu">
                  <a role="menuitem" className="menu-item btn btn-ghost" style={{ justifyContent: 'flex-start' }} href={endpoints.exportCsvUrl(wsId, query, false)} download onClick={() => setExportMenu(false)}>Normalised columns</a>
                  <a role="menuitem" className="menu-item btn btn-ghost" style={{ justifyContent: 'flex-start' }} href={endpoints.exportCsvUrl(wsId, query, true)} download onClick={() => setExportMenu(false)}>With raw JSON column</a>
                  <div className="small muted" style={{ padding: '4px 6px' }}>Exports every event matching the current filters.</div>
                </div>
              )}
            </div>
            <div className="menu">
              <button className="btn btn-sm" onClick={() => { setColMenu((v) => !v); setExportMenu(false); }} aria-haspopup="menu" aria-expanded={colMenu}><IconColumns size={14} /> Columns</button>
              {colMenu && (
                <div className="colmenu">
                  {ALL_COLS.map((c) => <label key={c.id}><input type="checkbox" checked={cols.includes(c.id)} disabled={c.id === 'ts'} onChange={(e) => setCols((cur) => e.target.checked ? ALL_COLS.map((x) => x.id).filter((id) => id === c.id || cur.includes(id)) : cur.filter((id) => id !== c.id))} />{c.label}</label>)}
                  <button className="link-btn small" style={{ padding: '4px 6px', textAlign: 'left' }} onClick={() => setCols(DEFAULT_COLS)}>Reset to default</button>
                </div>
              )}
            </div>
          </div>
          <div className="results-hist">
            <Histogram data={hist.data} loading={hist.isPending} compact height={64} selectedRange={{ from: url.from, to: url.to }} onBucketClick={(from, to) => setUrl({ from, to, ev: null })} />
          </div>
          {events.isError ? <ErrorState error={events.error} retry={() => events.refetch()} /> : (
            <DataTable<EventRow>
              ariaLabel="Events"
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              rowHeight={44}
              selectedKey={selectedId}
              onSelect={(r) => setUrl({ ev: r.id }, { replace: true })}
              onOpen={openRow}
              hasMore={!!events.hasNextPage}
              fetchingMore={events.isFetchingNextPage}
              onEndReached={() => { if (events.hasNextPage && !events.isFetchingNextPage) void events.fetchNextPage(); }}
              loading={events.isPending}
              rowClassName={(r) => (r.failed ? 'is-failed' : '')}
              empty={hasFilters || preset
                ? <EmptyState compact title="No events match" text={hidden > 0 && !exclusionsOff ? `${fmtInt(hidden)} events are hidden by the IP exclusion rules. Switch exclusions off to see them.` : 'Try removing a filter or widening the date range.'} action={hasFilters ? { label: 'Clear filters', onClick: () => setUrl(Object.fromEntries([...FILTER_URL_KEYS, 'ev'].map((k) => [k, null]))) } : undefined} />
                : <EmptyState compact title="No events yet" text="Import an export from Microsoft to start exploring." action={{ label: 'Go to Imports', to: `/w/${wsId}/imports` }} />}
              footer={rows.length ? <><span>{fmtInt(rows.length)} loaded{events.hasNextPage ? ' · scroll for more' : ''}</span><span>·</span><span>Times in {t.label}</span><span className="grow" /><span className="small">↑↓ move · Enter opens</span></> : undefined}
            />
          )}
        </div>
      </div>

      <Inspector eventId={selectedId} onClose={closeInspector} wsId={wsId} workspace={workspace} onPivot={pivot} width={drawerWidth} setWidth={setDrawerWidth} />
    </div>
  );
}

function Chip({ k, v, onRemove }: { k: string; v: string; onRemove: () => void }) {
  return <span className="fchip"><span className="fchip-k">{k}</span><span className="fchip-v" title={v}>{v}</span><button aria-label={`Remove filter ${k} ${v}`} onClick={onRemove}><IconClose size={12} /></button></span>;
}

function QueryInput({ value, onChange, onSubmit }: { value: string; onChange: (q: string) => void; onSubmit: (q: string) => void }) {
  const [text, setText] = useState(value);
  const [help, setHelp] = useState(false);
  const debounced = useDebounced(text, 250);
  const lastSent = useRef(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (value !== lastSent.current) { lastSent.current = value; setText(value); } }, [value]);
  useEffect(() => { if (debounced !== lastSent.current) { lastSent.current = debounced; onChange(debounced.trim()); } }, [debounced, onChange]);
  useEffect(() => {
    if (!help) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.qinput')) setHelp(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setHelp(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [help]);
  const fields = useMemo(() => { const seen = new Map<string, string[]>(); for (const [alias, f] of Object.entries(FIELD_ALIASES)) { const l = seen.get(f) ?? []; if (alias !== f) l.push(alias); seen.set(f, l); } return [...seen.entries()]; }, []);
  return (
    <form className="qinput" role="search" onSubmit={(e) => { e.preventDefault(); lastSent.current = text.trim(); onSubmit(text.trim()); }}>
      <IconSearch size={15} />
      <input ref={ref} value={text} onChange={(e) => setText(e.target.value)} placeholder='Query: user:anna* op:new-inboxrule  ·  Parameters.ForwardTo:*  ·  -owner:m365 country:RU' aria-label="Event query" spellCheck={false} autoComplete="off" />
      <div className="qinput-actions">
        {text && <button type="button" className="icon-btn" aria-label="Clear query" onClick={() => { setText(''); lastSent.current = ''; onSubmit(''); ref.current?.focus(); }}><IconClose size={14} /></button>}
        <button type="button" className={`icon-btn ${help ? 'is-active' : ''}`} aria-label="Query language help" aria-expanded={help} onClick={() => setHelp((h) => !h)}><IconHelp size={15} /></button>
      </div>
      {help && (
        <div className="help-pop" role="dialog" aria-label="Query language help">
          <table><tbody>{QUERY_HELP.map((h) => <tr key={h.example}><td><button type="button" className="link-btn mono" style={{ fontSize: 12 }} onClick={() => { setText(h.example); setHelp(false); ref.current?.focus(); }}>{h.example}</button></td><td className="muted">{h.meaning}</td></tr>)}</tbody></table>
          <div className="fields">
            <span className="small muted" style={{ width: '100%' }}>Fields (aliases in grey):</span>
            {fields.map(([f, aliases]) => <code key={f} title={aliases.length ? `aliases: ${aliases.join(', ')}` : undefined}>{f}{aliases.length ? <span className="muted"> {aliases.slice(0, 2).join(' ')}</span> : null}</code>)}
          </div>
        </div>
      )}
    </form>
  );
}

function DateRange({ from, to, onChange }: { from?: string; to?: string; onChange: (from: string | null, to: string | null) => void }) {
  const { tz } = usePrefs();
  const t = useTime();
  return (
    <div className="daterange" role="group" aria-label="Date range">
      <input type="datetime-local" aria-label="From" value={toInputValue(from, tz)} max={toInputValue(to, tz) || undefined} onChange={(e) => onChange(fromInputValue(e.target.value, tz), to ?? null)} />
      <span className="muted">–</span>
      <input type="datetime-local" aria-label="To" value={toInputValue(to, tz)} min={toInputValue(from, tz) || undefined} onChange={(e) => onChange(from ?? null, fromInputValue(e.target.value, tz))} />
      <span className="tz-tag" title="Date pickers use the selected time zone">{t.label}</span>
      {(from || to) && <button className="icon-btn" aria-label="Clear date range" onClick={() => onChange(null, null)}><IconClose size={14} /></button>}
    </div>
  );
}

