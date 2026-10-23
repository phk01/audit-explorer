import { Link, useNavigate, useParams } from 'react-router-dom';
import type { FacetBucket } from '@audit/core';
import { useWorkspaceCtx } from './WorkspaceShell';
import { usePerson } from '../lib/queries';
import { useTime } from '../lib/time';
import { fmtInt } from '../lib/format';
import { countryName } from '../lib/countries';
import { BarList, ErrorState, Kpi, Section, Skeleton } from '../components/Basics';
import { Histogram } from '../components/Histogram';
import { Heatmap } from '../components/Heatmap';
import { SimpleTable } from '../components/DataTable';
import { CountryBadge, OwnerBadge, PersonKindPill, SourceChip, groupLabel } from '../components/Badges';
import { friendly } from './Overview';

export function PersonPage() {
  const { wsId, workspace } = useWorkspaceCtx();
  const { upn: raw = '' } = useParams();
  const upn = decodeURIComponent(raw);
  const p = usePerson(wsId, upn);
  const t = useTime();
  const navigate = useNavigate();
  const expected = new Set(workspace.expectedCountries.map((c) => c.toUpperCase()));
  const act = (params: Record<string, string>) => `/w/${wsId}/activity?${new URLSearchParams({ user: upn, ...params }).toString()}`;
  const go = (params: Record<string, string>) => navigate(act(params));

  if (p.isError) return <div className="page"><ErrorState error={p.error} retry={() => p.refetch()} /><Link className="btn" to={`/w/${wsId}/people`}>Back to People</Link></div>;
  const d = p.data;
  const initials = upn.split('@')[0].split(/[._-]/).map((s) => s[0]?.toUpperCase() ?? '').join('').slice(0, 2) || '?';
  const bar = (items: FacetBucket[] | undefined, key: string, render?: (b: FacetBucket) => React.ReactNode) => (d ? <BarList items={items ?? []} onClick={(it) => go({ [key]: it.value })} render={render} /> : <Skeleton h={100} />);

  return (
    <div className="page">
      <div className="page-head">
        <div className="person-head">
          <span className="avatar" aria-hidden>{initials}</span>
          <div>
            <h1 style={{ wordBreak: 'break-all' }}>{upn}</h1>
            <div className="row row-wrap small muted" style={{ marginTop: 4 }}>
              {d && <PersonKindPill kind={d.kind} />}
              {d && <span>first seen {t.dateTime(d.firstSeen)} · last seen {t.dateTime(d.lastSeen)} ({t.relative(d.lastSeen)})</span>}
              {d && <span className="chips">{d.sources.map((s) => <SourceChip key={s} id={s} />)}</span>}
            </div>
          </div>
        </div>
        <div className="row"><Link className="btn" to={`/w/${wsId}/people`}>All people</Link><Link className="btn btn-primary" to={act({})}>View all events</Link></div>
      </div>

      <div className="grid grid-kpi mb-16">
        {!d ? Array.from({ length: 6 }).map((_, i) => <div className="kpi" key={i}><Skeleton w="50%" h={11} /><Skeleton w="60%" h={26} style={{ marginTop: 6 }} /></div>) : (
          <>
            <Kpi label="Events" value={fmtInt(d.events)} to={act({})} />
            <Kpi label="Failed" value={fmtInt(d.failed)} tone={d.failed ? 'crit' : undefined} to={act({ result: 'failed' })} />
            <Kpi label="Sign-ins" value={fmtInt(d.signIns)} to={act({ kind: 'signin' })} />
            <Kpi label="Sensitive" value={fmtInt(d.sensitiveEvents)} tone={d.sensitiveEvents ? 'warn' : undefined} to={act({ sensitive: '1' })} />
            <Kpi label="Client IPs" value={fmtInt(d.ipCount)} />
            <Kpi label="Countries" value={<span className="chips">{d.countriesDetail.length ? d.countriesDetail.map((c) => <CountryBadge key={c.value} cc={c.value} alert={expected.size > 0 && !expected.has(c.value.toUpperCase())} />) : '—'}</span>} />
          </>
        )}
      </div>

      <div className="grid grid-2 mb-16">
        <Section title="Activity" right={d ? <span>per {d.histogram.unit}</span> : null}>
          <Histogram data={d?.histogram} loading={p.isPending} height={140} onBucketClick={(from, to) => go({ from, to })} />
        </Section>
        <Section title="Weekday × hour">
          {d ? <Heatmap data={d.hourHeatmap} /> : <Skeleton h={160} />}
        </Section>
      </div>

      <div className="person-tables mb-16">
        <Section title="Client IPs">
          {d ? <SimpleTable ariaLabel="Client IPs" dense rows={d.ips} rowKey={(r) => r.ip} onRowClick={(r) => go({ ip: r.ip })} columns={[
            { id: 'ip', header: 'IP', width: 'auto', cell: (r) => <span className="ip-cell"><span className="mono">{r.ip}</span><CountryBadge cc={r.country} alert={!!r.country && expected.size > 0 && !expected.has(r.country.toUpperCase()) && !r.owner} /><OwnerBadge owner={r.owner} name={r.ownerName} /></span> },
            { id: 'country', header: 'Country', width: '120px', cell: (r) => <span className="small">{r.country ? countryName(r.country) : '—'}</span> },
            { id: 'events', header: 'Events', width: '80px', align: 'right', cell: (r) => <span className="num">{fmtInt(r.events)}</span> },
            { id: 'failed', header: 'Failed', width: '70px', align: 'right', cell: (r) => <span className={`num ${r.failed ? 'tone-crit' : 'muted'}`}>{fmtInt(r.failed)}</span> },
            { id: 'first', header: 'First', width: '120px', cell: (r) => <span className="small muted mono nowrap">{t.dateTime(r.firstSeen, { seconds: false })}</span> },
            { id: 'last', header: 'Last', width: '120px', cell: (r) => <span className="small muted mono nowrap">{t.dateTime(r.lastSeen, { seconds: false })}</span> },
          ]} /> : <Skeleton h={120} />}
        </Section>
        <Section title="Clients">
          {d ? <SimpleTable ariaLabel="Client families" dense rows={d.clients} rowKey={(r) => r.family} onRowClick={(r) => go({ q: `ua:*${r.family.replace(/[*?"]/g, '')}*` })} columns={[
            { id: 'family', header: 'Client', width: 'auto', cell: (r) => r.family },
            { id: 'events', header: 'Events', width: '80px', align: 'right', cell: (r) => <span className="num">{fmtInt(r.events)}</span> },
            { id: 'first', header: 'First', width: '120px', cell: (r) => <span className="small muted mono nowrap">{t.dateTime(r.firstSeen, { seconds: false })}</span> },
            { id: 'last', header: 'Last', width: '120px', cell: (r) => <span className="small muted mono nowrap">{t.dateTime(r.lastSeen, { seconds: false })}</span> },
          ]} /> : <Skeleton h={120} />}
        </Section>
      </div>

      <div className="grid grid-3 mb-16">
        <Section title="Operations">{bar(d?.operations, 'op', (b) => <span className="op-pair"><span className="op-friendly">{b.label ?? friendly(b.value)}</span><span className="op-raw">{b.value}</span></span>)}</Section>
        <Section title="Workloads">{bar(d?.workloads, 'workload')}</Section>
        <Section title="Workload groups">{bar(d?.groups, 'group', (b) => <span className="ellipsis">{b.label ?? groupLabel(b.value)}</span>)}</Section>
      </div>
      <div className="grid grid-3">
        <Section title="Countries">{bar(d?.countriesDetail, 'country', (b) => { const alert = expected.size > 0 && !expected.has(b.value.toUpperCase()); return <span className="row gap-4"><CountryBadge cc={b.value} alert={alert} /><span className={alert ? 'tone-crit' : ''}>{b.label ?? countryName(b.value)}</span></span>; })}</Section>
        <Section title="Counterparts">{d ? <BarList items={d.counterparts} onClick={(it) => go({ q: `counterpart:"${it.value}"` })} render={(b) => <span className="ellipsis" title={b.value}>{b.value}</span>} /> : <Skeleton h={100} />}</Section>
        <Section title="Sensitive families">
          {!d ? <Skeleton h={100} /> : !d.sensitive.length ? <div className="muted small">No sensitive operations for this person.</div> : (
            <SimpleTable ariaLabel="Sensitive operation families" dense rows={d.sensitive} rowKey={(r) => r.family} onRowClick={(r) => go({ sensitive: r.family })} columns={[
              { id: 'f', header: 'Family', width: 'auto', cell: (r) => <span className="pill pill-sensitive">{r.family}</span> },
              { id: 'c', header: 'Events', width: '70px', align: 'right', cell: (r) => <span className="num">{fmtInt(r.count)}</span> },
              { id: 'l', header: 'Last', width: '130px', cell: (r) => <span className="small muted mono">{t.dateTime(r.lastSeen, { seconds: false })}</span> },
            ]} />
          )}
        </Section>
      </div>
    </div>
  );
}
