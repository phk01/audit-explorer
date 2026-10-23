import { Link } from 'react-router-dom';
import type { SourceCoverage } from '@audit/core';
import { useWorkspaceCtx } from './WorkspaceShell';
import { useCoverage } from '../lib/queries';
import { useTime, fmtRelative } from '../lib/time';
import { fmtInt } from '../lib/format';
import { Collapsible, ErrorState, Section, Skeleton } from '../components/Basics';
import { SimpleTable } from '../components/DataTable';
import { SourceChip, StatusPill } from '../components/Badges';
import { IconAlert, IconExternal } from '../components/Icons';

export function CoveragePage() {
  const { wsId } = useWorkspaceCtx();
  const cov = useCoverage(wsId);
  const t = useTime();
  if (cov.isError) return <div className="page"><ErrorState error={cov.error} retry={() => cov.refetch()} /></div>;
  const d = cov.data;
  const layerA = d?.sources.filter((s) => s.layer === 'A') ?? [];
  const layerB = d?.sources.filter((s) => s.layer === 'B') ?? [];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Data Coverage &amp; Health</h1><p>Which exports are in this workspace, how complete they look, and how long Microsoft keeps each source so evidence is pulled before it ages out.</p></div>{d && <span className="small muted">Generated {t.dateTime(d.generatedAt)}</span>}</div>

      {!d ? <Skeleton h={60} className="mb-16" /> : d.warnings.length ? (
        <div className="alert alert-warn mb-16" role="status"><IconAlert size={16} /><ul>{d.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
      ) : <div className="alert alert-ok mb-16">No coverage warnings. Every collected source is inside its retention window and no day-level gaps were found.</div>}

      <h2 style={{ marginBottom: 8 }}>Layer A — Purview unified audit log</h2>
      <p className="muted small mb-8">The foundation: every workload's audit records. Everything else is joined to it.</p>
      <div className="cov-grid mb-16">{!d ? <Skeleton h={220} /> : layerA.map((s) => <SourceCard key={s.source} s={s} wsId={wsId} />)}</div>

      <h2 style={{ marginBottom: 8 }}>Layer B — cross-product telemetry</h2>
      <p className="muted small mb-8">Entra sign-in and audit logs, message trace and Defender tables add detail that the unified log does not carry. Short retention: export early.</p>
      <div className="cov-grid mb-16">{!d ? <><Skeleton h={220} /><Skeleton h={220} /></> : layerB.map((s) => <SourceCard key={s.source} s={s} wsId={wsId} />)}</div>

      <div className="grid grid-2 mb-16">
        <Section title="Workload groups">
          {d ? <SimpleTable ariaLabel="Workload groups" dense rows={d.groups} rowKey={(g) => g.group} columns={[
            { id: 'g', header: 'Group', width: 'auto', cell: (g) => g.events ? <Link to={`/w/${wsId}/activity?group=${g.group}`}>{g.label}</Link> : <span className="muted">{g.label}</span> },
            { id: 'e', header: 'Events', width: '90px', align: 'right', cell: (g) => <span className={`num ${g.events ? '' : 'muted'}`}>{fmtInt(g.events)}</span> },
            { id: 'r', header: 'Record types', width: '110px', align: 'right', cell: (g) => <span className="num">{fmtInt(g.recordTypes)}</span> },
            { id: 'o', header: 'Operations', width: '100px', align: 'right', cell: (g) => <span className="num">{fmtInt(g.operations)}</span> },
          ]} /> : <Skeleton h={200} />}
        </Section>
        <Section title="Operations not in the catalog" right={d ? <span>{fmtInt(d.unknownOperations.length)} operations</span> : null}>
          <p className="small muted">Seen in the data but without a friendly name or description yet. They are searchable and shown with their raw name everywhere.</p>
          {d ? <SimpleTable ariaLabel="Unknown operations" dense rows={d.unknownOperations} rowKey={(o) => `${o.operation}|${o.recordType}`} empty={<div className="muted small">Every operation in this workspace is in the catalog.</div>} columns={[
            { id: 'op', header: 'Operation', width: 'auto', cell: (o) => <Link className="mono" to={`/w/${wsId}/activity?op=${encodeURIComponent(o.operation)}`}>{o.operation}</Link> },
            { id: 'wl', header: 'Workload', width: '120px', cell: (o) => <span className="small">{o.workload ?? '—'}</span> },
            { id: 'rt', header: 'Record type', width: '150px', cell: (o) => <span className="small mono">{o.recordType ?? '—'}</span> },
            { id: 'n', header: 'Events', width: '70px', align: 'right', cell: (o) => <span className="num">{fmtInt(o.events)}</span> },
            { id: 'f', header: 'First', width: '100px', cell: (o) => <span className="small muted mono">{t.date(o.firstSeen)}</span> },
            { id: 'l', header: 'Last', width: '100px', cell: (o) => <span className="small muted mono">{t.date(o.lastSeen)}</span> },
          ]} /> : <Skeleton h={200} />}
        </Section>
      </div>

      {d && <div className="small muted">Catalog: {fmtInt(d.catalog.recordTypes)} record types · {fmtInt(d.catalog.activities)} activities · Geo: {d.catalog.geoSource} · IP owner data as of {d.catalog.ipOwnerDataAsOf}</div>}
    </div>
  );
}

function SourceCard({ s, wsId }: { s: SourceCoverage; wsId: string }) {
  const t = useTime();
  const collected = s.status === 'collected';
  const horizonMs = s.retentionHorizon ? new Date(s.retentionHorizon).getTime() - Date.now() : null;
  const daysLeft = horizonMs != null ? Math.floor(horizonMs / 864e5) : null;
  const tone = s.retentionWarning ? (daysLeft != null && daysLeft < 0 ? 'is-crit' : 'is-warn') : '';
  return (
    <section className={`card cov-card ${collected ? '' : 'is-off'}`} aria-label={s.label}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow"><div className="row gap-4"><SourceChip id={s.source} /><strong>{s.label}</strong></div><div className="small muted" style={{ marginTop: 2 }}>{s.description}</div></div>
        <StatusPill tone={collected ? 'ok' : 'neutral'}>{collected ? '● Collected' : '○ Not collected'}</StatusPill>
      </div>
      {collected && (
        <div className="cov-facts">
          <div><b>Events</b><Link className="num" to={`/w/${wsId}/activity?source=${s.source}`}>{fmtInt(s.events)}</Link></div>
          <div><b>Imports</b><span className="num">{fmtInt(s.imports)}</span>{s.importsHitRowLimit > 0 && <span className="tone-warn small"> · {s.importsHitRowLimit} hit row limit</span>}</div>
          <div><b>Last import</b><span className="small">{s.lastImportAt ? fmtRelative(s.lastImportAt) : '—'}</span></div>
          <div><b>First event</b><span className="mono small">{t.dateTime(s.firstEvent, { seconds: false })}</span></div>
          <div><b>Last event</b><span className="mono small">{t.dateTime(s.lastEvent, { seconds: false })}</span></div>
          <div><b>Retention</b><span className="small">{s.retentionDays} days{s.retentionDaysPremium ? ` · ${s.retentionDaysPremium} premium` : ''}</span></div>
        </div>
      )}
      {!collected && <div className="small"><b className="muted">Retention:</b> {s.retentionDays} days{s.retentionDaysPremium ? ` (${s.retentionDaysPremium} with the higher licence)` : ''}</div>}
      <div className="small muted">{s.retentionNote}</div>
      {(s.retentionHorizon || s.retentionWarning) && (
        <div className={`cov-horizon ${tone}`} role={s.retentionWarning ? 'status' : undefined}>
          {s.retentionHorizon && daysLeft != null && <div><strong>Retention horizon:</strong> {t.date(s.retentionHorizon)} — {daysLeft < 0 ? `${Math.abs(daysLeft)} days ago` : daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}</div>}
          {s.retentionWarning && <div className="row gap-4" style={{ alignItems: 'flex-start' }}><IconAlert size={14} /><span>{s.retentionWarning}</span></div>}
        </div>
      )}
      {s.gaps.length > 0 && (
        <div className="alert alert-warn" style={{ padding: '6px 10px' }}><IconAlert size={14} /><div><strong>{s.gaps.length} gap{s.gaps.length === 1 ? '' : 's'} with zero events</strong><ul className="small">{s.gaps.slice(0, 6).map((g) => <li key={g.from}>{t.date(g.from)} → {t.date(g.to)} ({g.days} day{g.days === 1 ? '' : 's'})</li>)}{s.gaps.length > 6 && <li>…and {s.gaps.length - 6} more</li>}</ul></div></div>
      )}
      {s.recordTypes.length > 0 && (
        <Collapsible small title={`Record types (${s.recordTypes.length})`} defaultOpen={s.recordTypes.length <= 6}>
          <SimpleTable ariaLabel={`Record types in ${s.label}`} dense rows={s.recordTypes} rowKey={(r) => r.recordType} columns={[
            { id: 'n', header: 'Record type', width: 'auto', cell: (r) => <span className="mono small">{r.recordType}{!r.inCatalog && <span className="pill pill-warn" style={{ marginLeft: 6 }}>not in catalog</span>}</span> },
            { id: 'id', header: 'Id', width: '50px', align: 'right', cell: (r) => <span className="num small muted">{r.recordTypeId ?? '—'}</span> },
            { id: 'e', header: 'Events', width: '80px', align: 'right', cell: (r) => <span className="num">{fmtInt(r.events)}</span> },
          ]} />
        </Collapsible>
      )}
      <Collapsible small title="How to export">
        <div className="howto"><ol>{s.howToExport.map((step, i) => <li key={i}>{step}</li>)}</ol><a href={s.docsUrl} target="_blank" rel="noreferrer noopener" className="small row gap-4" style={{ display: 'inline-flex' }}>Microsoft documentation <IconExternal size={12} /></a></div>
      </Collapsible>
    </section>
  );
}
