import { Link, useNavigate } from 'react-router-dom';
import { useOverview, useCoverage, useActivityCatalog } from '../lib/queries';
import { useWorkspaceCtx } from './WorkspaceShell';
import { useTime, fmtDuration } from '../lib/time';
import { fmtInt } from '../lib/format';
import { countryName } from '../lib/countries';
import { BarList, EmptyState, ErrorState, Kpi, Section, Skeleton } from '../components/Basics';
import { Histogram } from '../components/Histogram';
import { CountryBadge, OwnerBadge, SourceChip, StatusPill, importStatusTone, groupLabel, sourceLabel } from '../components/Badges';
import { IconAlert } from '../components/Icons';


export function OverviewPage() {
  const { wsId, workspace } = useWorkspaceCtx();
  const ov = useOverview(wsId);
  const cov = useCoverage(wsId);
  const catalog = useActivityCatalog();
  const t = useTime();
  const navigate = useNavigate();
  const act = (params: Record<string, string>) => `/w/${wsId}/activity?${new URLSearchParams(params).toString()}`;
  const expected = new Set(workspace.expectedCountries.map((c) => c.toUpperCase()));

  if (ov.isError) return <div className="page"><ErrorState error={ov.error} retry={() => ov.refetch()} /></div>;
  const d = ov.data;
  const s = d?.stats;
  if (d && s && s.events === 0) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>{workspace.name}</h1><p>Overview</p></div></div>
        <EmptyState title="No events yet" text="Import a Purview audit export, Entra sign-in log, message trace or Defender hunting export to get started." action={{ label: 'Import an export', to: `/w/${wsId}/imports` }} />
      </div>
    );
  }
  const span = s?.firstEvent && s.lastEvent ? fmtDuration(new Date(s.lastEvent).getTime() - new Date(s.firstEvent).getTime()) : '—';

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{workspace.name}</h1><p>{workspace.tenantDomains.length ? workspace.tenantDomains.join(', ') : 'Overview'}{s?.lastImportAt ? ` · last import ${t.relative(s.lastImportAt)}` : ''}</p></div>
        <div className="row"><Link className="btn" to={`/w/${wsId}`}>Investigate</Link><Link className="btn" to={`/w/${wsId}/activity`}>Open Global Activity</Link></div>
      </div>

      <div className="grid grid-kpi mb-16">
        {!d ? Array.from({ length: 6 }).map((_, i) => <div className="kpi" key={i}><Skeleton w="50%" h={11} /><Skeleton w="70%" h={26} style={{ marginTop: 6 }} /></div>) : (
          <>
            <Kpi label="Events" value={fmtInt(s!.events)} to={act({})} sub={`${fmtInt(s!.imports)} imports`} />
            <Kpi label="People" value={fmtInt(s!.people)} to={`/w/${wsId}/people`} />
            <Kpi label="Client IPs" value={fmtInt(s!.clientIps)} sub="distinct addresses" to={act({})} />
            <Kpi label="Failed events" value={fmtInt(d.failedEvents)} tone={d.failedEvents ? 'crit' : undefined} to={act({ result: 'failed' })} />
            <Kpi label="Sensitive operations" value={fmtInt(d.sensitiveEvents)} tone={d.sensitiveEvents ? 'warn' : undefined} sub="role, consent, rules, forwarding…" to={act({ sensitive: '1' })} />
            <Kpi label="Time span" value={span} sub={s?.firstEvent ? `${t.date(s.firstEvent)} → ${t.date(s.lastEvent)}` : undefined} />
          </>
        )}
      </div>

      {cov.data?.warnings.length ? (
        <div className="alert alert-warn mb-16" role="status">
          <IconAlert size={16} />
          <div className="grow">
            <ul>{cov.data.warnings.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}</ul>
            <Link to={`/w/${wsId}/coverage`} className="small" style={{ fontWeight: 600 }}>Data Coverage &amp; Health{cov.data.warnings.length > 3 ? ` · ${cov.data.warnings.length - 3} more` : ''} →</Link>
          </div>
        </div>
      ) : null}

      <Section title="Activity" right={d ? <span>per {d.histogram.unit} · failed in red</span> : null} className="mb-16">
        <Histogram data={d?.histogram} loading={ov.isPending} height={150} onBucketClick={(from, to) => navigate(act({ from, to }))} />
      </Section>

      <div className="grid grid-3 mb-16">
        <Section title="Top users">
          {d ? <BarList items={d.topUsers} onClick={(it) => navigate(act({ user: it.value }))} render={(it) => <span className="ellipsis">{it.value}</span>} /> : <Skeleton h={120} />}
          {d && <Link to={`/w/${wsId}/people`} className="small" style={{ display: 'inline-block', marginTop: 8 }}>All people →</Link>}
        </Section>
        <Section title="Top operations">
          {d ? <BarList items={d.topOperations} onClick={(it) => navigate(act({ op: it.value }))} render={(it) => <span className="op-pair"><span className="op-friendly">{it.label ?? catalog.data?.get(it.value.toLowerCase()) ?? friendly(it.value)}</span><span className="op-raw">{it.value}</span></span>} /> : <Skeleton h={120} />}
        </Section>
        <Section title="Top client IPs">
          {d ? <BarList items={d.topIps} onClick={(it) => navigate(act({ ip: it.value }))} render={(it) => { const ip = it as typeof d.topIps[number]; return <span className="ip-cell"><span className="mono">{ip.value}</span><CountryBadge cc={ip.country} alert={!!ip.country && expected.size > 0 && !expected.has(ip.country) && !ip.owner} /><OwnerBadge owner={ip.owner} /></span>; }} /> : <Skeleton h={120} />}
        </Section>
      </div>

      <div className="grid grid-3 mb-16">
        <Section title="Countries" right={expected.size ? <span>expected: {[...expected].join(', ')}</span> : null}>
          {d ? <BarList items={d.countries} onClick={(it) => navigate(act({ country: it.value }))} render={(it) => { const alert = expected.size > 0 && !expected.has(it.value.toUpperCase()); return <span className="row gap-4"><CountryBadge cc={it.value} alert={alert} /><span className={alert ? 'tone-crit' : ''}>{it.label ?? countryName(it.value)}</span></span>; }} /> : <Skeleton h={120} />}
        </Section>
        <Section title="Sources">
          {d ? <BarList items={d.sources} onClick={(it) => navigate(act({ source: it.value }))} render={(it) => <span className="row gap-4"><SourceChip id={it.value} /><span className="small muted ellipsis">{sourceLabel(it.value)}</span></span>} /> : <Skeleton h={120} />}
        </Section>
        <Section title="Workload groups">
          {d ? <BarList items={d.groups} onClick={(it) => navigate(act({ group: it.value }))} render={(it) => <span className="ellipsis">{groupLabel(it.value)}</span>} /> : <Skeleton h={120} />}
        </Section>
      </div>

      <Section title="Recent imports" right={<Link to={`/w/${wsId}/imports`}>All imports →</Link>}>
        {!d ? <Skeleton h={80} /> : !d.recentImports.length ? <div className="muted small">No imports yet.</div> : (
          <div className="table-wrap"><table className="table table-dense" aria-label="Recent imports"><thead><tr><th scope="col">File</th><th scope="col">Format</th><th scope="col">Status</th><th scope="col" className="is-right">Inserted</th><th scope="col">When</th></tr></thead><tbody>
            {d.recentImports.map((im) => (
              <tr key={im.id}>
                <td><Link to={act({ importId: im.id })} className="mono small">{im.fileName}</Link></td>
                <td className="small"><span className="row gap-4"><SourceChip id={im.source} />{im.formatLabel && <span className="muted ellipsis" style={{ maxWidth: 260 }}>{im.formatLabel}</span>}</span></td>
                <td><StatusPill tone={importStatusTone(im.status)}>{im.status}</StatusPill></td>
                <td className="is-right num">{fmtInt(im.eventsInserted)}</td>
                <td className="small muted" title={t.dateTime(im.createdAt)}>{t.relative(im.createdAt)}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </Section>
    </div>
  );
}

/** Fallback humaniser for operations without a catalog label (e.g. "FileSyncDownloadedFull" → "File sync downloaded full"). */
export function friendly(op: string): string {
  if (!op) return '';
  if (op.includes('-')) return op;
  return op.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}
