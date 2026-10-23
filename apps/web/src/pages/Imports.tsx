import { useCallback, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { Import } from '@audit/core';
import { useWorkspaceCtx } from './WorkspaceShell';
import { useCatalogSources, useImports, useInvalidateWorkspaceData } from '../lib/queries';
import { ApiError, endpoints, uploadImports, type UploadResult } from '../lib/api';
import { isActiveImport, useImportStream } from '../lib/imports-stream';
import { useTime } from '../lib/time';
import { fmtBytes, fmtInt, fmtPct } from '../lib/format';
import { useToast } from '../lib/toast';
import { Collapsible, ConfirmDialog, EmptyState, ErrorState, Section, SkeletonRows } from '../components/Basics';
import { SourceChip, StatusPill, importStatusTone } from '../components/Badges';
import { IconAlert, IconExternal, IconRefresh, IconStop, IconTrash, IconUpload } from '../components/Icons';

const ACCEPT = '.csv,.json,.jsonl,.ndjson,.txt';
const ACCEPT_RX = /\.(csv|json|jsonl|ndjson|txt)$/i;

interface Upload { id: number; files: File[]; loaded: number; total: number; status: 'uploading' | 'done' | 'error'; result?: UploadResult; error?: string; force?: boolean }

export function ImportsPage() {
  const { wsId } = useWorkspaceCtx();
  const imports = useImports(wsId);
  const sources = useCatalogSources();
  const { live } = useImportStream();
  const invalidate = useInvalidateWorkspaceData(wsId);
  const t = useTime();
  const { toast } = useToast();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const [del, setDel] = useState<Import | null>(null);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const start = useCallback((files: File[], force = false) => {
    const accepted = files.filter((f) => ACCEPT_RX.test(f.name));
    const rejected = files.filter((f) => !ACCEPT_RX.test(f.name));
    if (rejected.length) toast(`${rejected.length} file${rejected.length === 1 ? '' : 's'} skipped: only .csv, .json, .jsonl and .txt exports are accepted.`, 'error');
    if (!accepted.length) return;
    const id = ++seq.current;
    const total = accepted.reduce((a, f) => a + f.size, 0);
    setUploads((u) => [{ id, files: accepted, loaded: 0, total, status: 'uploading', force }, ...u]);
    uploadImports(wsId, accepted, { force, onProgress: (loaded) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, loaded } : x))) })
      .then((result) => {
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, status: 'done', loaded: total, result } : x)));
        invalidate();
        if (result.created.length) toast(`${result.created.length} file${result.created.length === 1 ? '' : 's'} queued for import`, 'ok');
      })
      .catch((e) => { setUploads((u) => u.map((x) => (x.id === id ? { ...x, status: 'error', error: e instanceof ApiError ? e.message : 'Upload failed' } : x))); toast(e instanceof ApiError ? e.message : 'Upload failed', 'error'); });
  }, [wsId, invalidate, toast]);

  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); start(Array.from(e.dataTransfer.files)); };
  const action = useMutation({
    mutationFn: ({ kind, id }: { kind: 'cancel' | 'retry' | 'delete'; id: string }) => kind === 'cancel' ? endpoints.cancelImport(id) : kind === 'retry' ? endpoints.retryImport(id) : endpoints.deleteImport(id),
    onSuccess: (_r, v) => { invalidate(); setDel(null); toast(v.kind === 'delete' ? 'Import deleted' : v.kind === 'retry' ? 'Import queued again' : 'Cancel requested', 'ok'); },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error'),
  });

  const rows = (imports.data ?? []).map((im) => { const l = live[im.id]; return l ? { ...im, status: l.status, rowsProcessed: l.rowsProcessed, eventsInserted: l.eventsInserted, eventsDuplicate: l.eventsDuplicate, rowsFailed: l.rowsFailed, bytesProcessed: l.bytesProcessed, formatLabel: l.formatLabel ?? im.formatLabel, source: l.source ?? im.source, error: l.error ?? im.error } : im; });
  const active = rows.filter((r) => isActiveImport(r.status));
  const history = rows.filter((r) => !isActiveImport(r.status));

  return (
    <div className="page">
      <div className="page-head"><div><h1>Imports</h1><p>Upload Microsoft exports. Formats are detected automatically; identical files are skipped and overlapping exports are de-duplicated per record.</p></div></div>
      <div className="imports-layout">
        <div className="stack stack-16">
          <div className={`dropzone ${over ? 'is-over' : ''}`} role="button" tabIndex={0} aria-label="Upload export files"
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
            onClick={() => inputRef.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}>
            <IconUpload size={26} />
            <div className="dz-title">Drop export files here, or click to choose</div>
            <div className="dz-sub">Purview audit CSV · Entra sign-in / audit JSON or CSV · Exchange message trace CSV · Defender advanced hunting CSV · multiple files at once · {ACCEPT}</div>
            <input ref={inputRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }} onChange={(e) => { start(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          </div>

          {uploads.length > 0 && (
            <Section title="Uploads" right={<button className="link-btn small" onClick={() => setUploads((u) => u.filter((x) => x.status === 'uploading'))}>Clear finished</button>}>
              {uploads.map((u) => (
                <div key={u.id} className="upload-item">
                  <div className="ellipsis"><strong>{u.files.length === 1 ? u.files[0].name : `${u.files.length} files`}</strong> <span className="muted small">{fmtBytes(u.total)}{u.force ? ' · forced' : ''}</span></div>
                  <div className="small" style={{ textAlign: 'right' }}>{u.status === 'uploading' ? `${fmtPct(u.loaded, u.total)} uploaded` : u.status === 'done' ? <span className="tone-ok">Uploaded</span> : <span className="tone-crit">{u.error}</span>}</div>
                  {u.status === 'uploading' && <div className="progress"><span style={{ width: `${(u.loaded / Math.max(1, u.total)) * 100}%` }} /></div>}
                  {u.result && u.result.skipped.length > 0 && (
                    <div className="alert alert-warn" style={{ gridColumn: '1 / -1', padding: '6px 10px' }}>
                      <IconAlert size={14} />
                      <div className="grow">
                        {u.result.skipped.map((s) => {
                          const file = u.files.find((f) => f.name === s.fileName);
                          const identical = /identical/i.test(s.reason);
                          return <div key={s.fileName} className="row row-wrap" style={{ justifyContent: 'space-between' }}><span><strong className="fg">{s.fileName}</strong> skipped — {s.reason}</span>{identical && file && <button className="btn btn-sm" onClick={() => start([file], true)}>Import anyway</button>}</div>;
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </Section>
          )}

          {active.length > 0 && (
            <Section title="Processing">
              {active.map((im) => {
                const pct = im.fileSize ? Math.min(100, (im.bytesProcessed / im.fileSize) * 100) : 0;
                return (
                  <div key={im.id} className="upload-item">
                    <div className="row row-wrap gap-4"><StatusPill tone={importStatusTone(im.status)}>{im.status}</StatusPill><strong className="mono small">{im.fileName}</strong>{im.source && <SourceChip id={im.source} />}{im.formatLabel && <span className="small muted">{im.formatLabel}</span>}</div>
                    <div style={{ textAlign: 'right' }}><button className="btn btn-sm" onClick={() => action.mutate({ kind: 'cancel', id: im.id })} disabled={action.isPending}><IconStop size={12} /> Cancel</button></div>
                    <div className={`progress ${im.status === 'running' && im.fileSize ? '' : 'is-indeterminate'}`}><span style={{ width: `${pct}%` }} /></div>
                    <div className="small muted mono" style={{ gridColumn: '1 / -1' }}>{fmtInt(im.rowsProcessed)} rows{im.rowsTotal ? ` of ${fmtInt(im.rowsTotal)}` : ''} · {fmtInt(im.eventsInserted)} inserted · {fmtInt(im.eventsDuplicate)} duplicates · {fmtInt(im.rowsFailed)} failed · {fmtBytes(im.bytesProcessed)} / {fmtBytes(im.fileSize)}</div>
                  </div>
                );
              })}
            </Section>
          )}

          <Section title="Import history" right={imports.data ? <span>{fmtInt(history.length)} imports</span> : null}>
            {imports.isPending ? <SkeletonRows rows={5} cols={6} /> : imports.isError ? <ErrorState error={imports.error} retry={() => imports.refetch()} /> : !history.length && !active.length ? (
              <EmptyState compact title="No imports yet" text="Drop an export above. The side panel explains what to export from each Microsoft portal." />
            ) : (
              <div className="table-wrap">
                <table className="table" aria-label="Import history">
                  <thead><tr><th scope="col">File</th><th scope="col">Format</th><th scope="col">Status</th><th scope="col" className="is-right">Rows</th><th scope="col" className="is-right">Inserted</th><th scope="col" className="is-right">Dupes</th><th scope="col" className="is-right">Failed</th><th scope="col">Covers</th><th scope="col">Uploaded</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {history.map((im) => (
                      <tr key={im.id}>
                        <td><div className="cell-2" style={{ maxWidth: 240 }}><span className="mono small" title={im.fileName}>{im.fileName}</span><span className="cell-sub">{fmtBytes(im.fileSize)}</span></div>
                          {im.error && <div className="small tone-crit" style={{ marginTop: 4 }}>{im.error}</div>}
                          {im.warnings.length > 0 && <Collapsible small title={`${im.warnings.length} warning${im.warnings.length === 1 ? '' : 's'}`}><ul className="warn-list">{im.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Collapsible>}
                        </td>
                        <td><div className="cell-2" style={{ maxWidth: 220 }}><span><SourceChip id={im.source} /></span><span className="cell-sub" title={im.formatLabel ?? ''}>{im.formatLabel ?? '—'}</span></div></td>
                        <td><StatusPill tone={importStatusTone(im.status)}>{im.status}</StatusPill></td>
                        <td className="is-right num">{fmtInt(im.rowsProcessed)}</td>
                        <td className="is-right num">{fmtInt(im.eventsInserted)}</td>
                        <td className={`is-right num ${im.eventsDuplicate ? '' : 'muted'}`}>{fmtInt(im.eventsDuplicate)}</td>
                        <td className={`is-right num ${im.rowsFailed ? 'tone-crit' : 'muted'}`}>{fmtInt(im.rowsFailed)}</td>
                        <td className="small mono nowrap">{im.minTs ? <>{t.date(im.minTs)}<br />→ {t.date(im.maxTs)}</> : '—'}</td>
                        <td className="small muted nowrap" title={t.dateTime(im.createdAt)}>{t.relative(im.createdAt)}</td>
                        <td>
                          <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                            {im.status === 'completed' && im.eventsInserted > 0 && <Link className="btn btn-sm" to={`/w/${wsId}/activity?importId=${im.id}`}>Events</Link>}
                            {(im.status === 'failed' || im.status === 'cancelled') && <button className="btn btn-sm" onClick={() => action.mutate({ kind: 'retry', id: im.id })} disabled={action.isPending} title="Re-run from the last checkpoint"><IconRefresh size={12} /> Retry</button>}
                            <button className="icon-btn" aria-label={`Delete import ${im.fileName}`} title="Delete import and its events" onClick={() => setDel(im)}><IconTrash size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>

        <aside className="stack">
          <Section title="What to export from Microsoft">
            <p className="small muted">Export everything in the date range of the investigation, unfiltered. Split by date when a portal caps the row count; the importer merges the parts.</p>
            {sources.data ? sources.data.map((s) => (
              <Collapsible key={s.id} small title={<span className="row gap-4"><SourceChip id={s.id} /> {s.label}</span>}>
                <div className="howto">
                  <div className="small muted mb-8">{s.vendorName} · keeps {s.retentionDays}{s.retentionDaysPremium ? `–${s.retentionDaysPremium}` : ''} days{s.exportRowLimit ? ` · max ${fmtInt(s.exportRowLimit)} rows per file` : ''}</div>
                  <ol>{s.howToExport.map((step, i) => <li key={i}>{step}</li>)}</ol>
                  <a href={s.docsUrl} target="_blank" rel="noreferrer noopener" className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Documentation <IconExternal size={12} /></a>
                </div>
              </Collapsible>
            )) : <SkeletonRows rows={5} cols={1} />}
          </Section>
        </aside>
      </div>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && action.mutate({ kind: 'delete', id: del.id })} busy={action.isPending} title="Delete import" text={<>Delete <strong className="mono">{del?.fileName}</strong> and the <strong>{fmtInt(del?.eventsInserted ?? 0)}</strong> events it produced? People and operation inventories are rebuilt afterwards. This cannot be undone.</>} />
    </div>
  );
}
