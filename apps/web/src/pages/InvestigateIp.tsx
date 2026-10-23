import { Link, useParams } from 'react-router-dom';
import { useWorkspaceCtx } from './WorkspaceShell';
import { useIpInvestigation } from '../lib/queries';
import { useTime } from '../lib/time';
import { fmtInt, OWNER_LONG, plural } from '../lib/format';
import { BarList, ErrorState, Kpi, Section, Skeleton } from '../components/Basics';
import { SimpleTable } from '../components/DataTable';
import { CountryBadge, OwnerBadge } from '../components/Badges';
import { FindingList, userUrl } from '../components/Findings';
import { friendly } from './Overview';

export function InvestigateIpPage() {
  const { wsId, workspace } = useWorkspaceCtx();
  const { ip: raw = '' } = useParams();
  const ip = decodeURIComponent(raw);
  const inv = useIpInvestigation(wsId, ip);
  const t = useTime();
  const d = inv.data;
  const expected = new Set(workspace.expectedCountries.map((c) => c.toUpperCase()));
  const unexpected = !!d?.country && expected.size > 0 && !expected.has(d.country.toUpperCase()) && !d.owner;
  const act = `/w/${wsId}/activity?${new URLSearchParams({ ip }).toString()}`;
  const high = d?.findings.filter((f) => f.severity === 'high' && f.status !== 'dismissed').length ?? 0;
  const level = !d ? 'insufficient' : high > 0 || unexpected ? 'compromised' : d.findings.length ? 'suspicious' : 'clean';

  if (inv.isError) return <div className="page"><ErrorState error={inv.error} retry={() => inv.refetch()} /><Link className="btn" to={`/w/${wsId}`}>Back to Investigate</Link></div>;

  return (
    <div className="page investigate">
      <div className="page-head">
        <div>
          <div className="small muted" style={{ marginBottom: 4 }}>IP address</div>
          <h1 className="mono">{ip}</h1>
          {d && <div className="row row-wrap small muted" style={{ marginTop: 6 }}><CountryBadge cc={d.country} alert={unexpected} /><span className={unexpected ? 'tone-crit' : ''}>{d.countryName ?? 'Unknown country'}{unexpected ? ' — outside the expected countries' : ''}</span>{d.owner && <><OwnerBadge owner={d.owner} name={d.ownerName} /><span>{d.ownerName ?? OWNER_LONG[d.owner] ?? d.owner}</span></>}</div>}
        </div>
        <Link className="btn" to={act}>All events from this IP</Link>
      </div>

      {!d ? <div className="verdict verdict-insufficient"><div className="verdict-body"><Skeleton w="60%" h={20} /></div></div> : (
        <>
          <section className={`verdict verdict-${level}`} aria-label="Summary">
            <div className="verdict-body">
              <h2 className="verdict-headline">{d.headline}</h2>
              <div className="grid grid-kpi mt-16">
                <Kpi label="Events" value={fmtInt(d.events)} to={act} />
                <Kpi label="Failed" value={fmtInt(d.failed)} tone={d.failed ? 'crit' : undefined} to={`${act}&result=failed`} />
                <Kpi label="Accounts" value={fmtInt(d.users.length)} sub={`${d.users.filter((u) => u.succeededSignIns > 0).length} signed in successfully`} />
                <Kpi label="First seen" value={<span style={{ fontSize: 18 }}>{t.dateTime(d.firstSeen, { seconds: false })}</span>} />
                <Kpi label="Last seen" value={<span style={{ fontSize: 18 }}>{t.dateTime(d.lastSeen, { seconds: false })}</span>} sub={d.lastSeen ? t.relative(d.lastSeen) : undefined} />
              </div>
            </div>
          </section>

          <Section title="Accounts touched by this address" right={<span>{plural(d.users.length, 'account')}</span>}>
            <SimpleTable ariaLabel="Accounts" dense rows={d.users} rowKey={(r) => r.upn} columns={[
              { id: 'u', header: 'User', width: 'auto', cell: (r) => <Link to={userUrl(wsId, r.upn)} style={{ fontWeight: 500 }}>{r.upn}</Link> },
              { id: 'e', header: 'Events', width: '80px', align: 'right', cell: (r) => <span className="num">{fmtInt(r.events)}</span> },
              { id: 'f', header: 'Failed', width: '80px', align: 'right', cell: (r) => <span className={`num ${r.failed ? 'tone-crit' : 'muted'}`}>{fmtInt(r.failed)}</span> },
              { id: 's', header: 'Successful sign-ins', width: '150px', align: 'right', cell: (r) => <span className={`num ${r.succeededSignIns ? 'tone-crit' : 'muted'}`} style={{ fontWeight: r.succeededSignIns ? 600 : undefined }}>{fmtInt(r.succeededSignIns)}</span> },
              { id: 'first', header: 'First', width: '140px', cell: (r) => <span className="small muted mono nowrap">{t.dateTime(r.firstSeen, { seconds: false })}</span> },
              { id: 'last', header: 'Last', width: '140px', cell: (r) => <span className="small muted mono nowrap">{t.dateTime(r.lastSeen, { seconds: false })}</span> },
            ]} />
          </Section>

          <div className="grid grid-2 mt-16">
            <Section title="What it did"><BarList items={d.operations} render={(b) => <span className="op-pair"><span className="op-friendly">{b.label ?? friendly(b.value)}</span><span className="op-raw">{b.value}</span></span>} /></Section>
            <Section title="Clients used"><BarList items={d.clients} /></Section>
          </div>

          <Section title="Findings involving this address" className="mt-16">
            <FindingList findings={d.findings} wsId={wsId} empty={<div className="muted small">No detections mention this address.</div>} />
          </Section>
        </>
      )}
    </div>
  );
}
