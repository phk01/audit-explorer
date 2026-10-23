import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Person } from '@audit/core';
import { useWorkspaceCtx } from './WorkspaceShell';
import { usePeople } from '../lib/queries';
import { useDebounced, useUrlState } from '../lib/url';
import { useTime } from '../lib/time';
import { fmtInt } from '../lib/format';
import { EmptyState, ErrorState, Section, SkeletonRows } from '../components/Basics';
import { CountryBadge, PersonKindPill, SourceChip } from '../components/Badges';
import { IconSearch } from '../components/Icons';

type Sort = 'events' | 'lastSeen' | 'failed' | 'sensitive' | 'upn';
const SORTS: { id: Sort; label: string }[] = [{ id: 'events', label: 'Events' }, { id: 'lastSeen', label: 'Last seen' }, { id: 'failed', label: 'Failed' }, { id: 'sensitive', label: 'Sensitive' }, { id: 'upn', label: 'Name' }];
const KINDS = ['member', 'guest', 'external', 'service', 'system'];

export function PeoplePage() {
  const { wsId, workspace } = useWorkspaceCtx();
  const [url, setUrl] = useUrlState();
  const search = useDebounced(url.search ?? '', 250);
  const sort = (SORTS.some((s) => s.id === url.sort) ? url.sort : 'events') as Sort;
  const q = useMemo(() => ({ search: search || undefined, sort, kind: url.kind || undefined, limit: 500 }), [search, sort, url.kind]);
  const people = usePeople(wsId, q);
  const t = useTime();
  const navigate = useNavigate();
  const expected = new Set(workspace.expectedCountries.map((c) => c.toUpperCase()));
  const open = (p: Person) => navigate(`/w/${wsId}/people/${encodeURIComponent(p.upn)}`);

  const th = (id: Sort, label: string, right = false) => <th scope="col" className={`sortable ${sort === id ? 'sorted' : ''} ${right ? 'is-right' : ''}`} aria-sort={sort === id ? 'descending' : 'none'} onClick={() => setUrl({ sort: id })}>{label}{sort === id ? ' ▾' : ''}</th>;

  return (
    <div className="page">
      <div className="page-head"><div><h1>People</h1><p>Every actor seen in the imported data: members, guests, external addresses, service principals and system accounts. Counts respect the IP exclusion rules.</p></div></div>
      <div className="people-toolbar">
        <div className="qinput" style={{ flex: '0 1 320px' }}><IconSearch size={15} /><input type="search" value={url.search ?? ''} onChange={(e) => setUrl({ search: e.target.value || null }, { replace: true })} placeholder="Search by UPN" aria-label="Search people" style={{ paddingRight: 10 }} /></div>
        <div className="btn-group" role="group" aria-label="Filter by kind">
          <button className={`btn btn-sm ${!url.kind ? 'is-active' : ''}`} onClick={() => setUrl({ kind: null })}>All</button>
          {KINDS.map((k) => <button key={k} className={`btn btn-sm ${url.kind === k ? 'is-active' : ''}`} onClick={() => setUrl({ kind: url.kind === k ? null : k })}>{k}</button>)}
        </div>
        <span className="small muted">{people.data ? `${fmtInt(people.data.items.length)}${people.data.total > people.data.items.length ? ` of ${fmtInt(people.data.total)}` : ''} people` : ''}</span>
      </div>
      <Section>
        {people.isPending ? <SkeletonRows rows={8} cols={6} /> : people.isError ? <ErrorState error={people.error} retry={() => people.refetch()} /> : !people.data.items.length ? (
          <EmptyState compact title={search || url.kind ? 'Nobody matches' : 'No people yet'} text={search || url.kind ? 'Try a different search or kind.' : 'People appear once events are imported.'} action={!search && !url.kind ? { label: 'Go to Imports', to: `/w/${wsId}/imports` } : undefined} />
        ) : (
          <div className="table-wrap">
            <table className="table table-clickable" aria-label="People">
              <thead><tr>{th('upn', 'Person')}<th scope="col">Kind</th>{th('events', 'Events', true)}{th('failed', 'Failed', true)}<th scope="col" className="is-right">Sign-ins</th>{th('sensitive', 'Sensitive', true)}<th scope="col">Countries</th><th scope="col">First seen</th>{th('lastSeen', 'Last seen')}<th scope="col">Sources</th></tr></thead>
              <tbody>
                {people.data.items.map((p) => (
                  <tr key={p.upn} tabIndex={0} onClick={() => open(p)} onKeyDown={(e) => { if (e.key === 'Enter') open(p); }}>
                    <td><span style={{ fontWeight: 500 }}>{p.upn}</span></td>
                    <td><PersonKindPill kind={p.kind} /></td>
                    <td className="is-right num">{fmtInt(p.events)}</td>
                    <td className={`is-right num ${p.failed ? 'tone-crit' : 'muted'}`}>{fmtInt(p.failed)}</td>
                    <td className="is-right num">{fmtInt(p.signIns)}</td>
                    <td className={`is-right num ${p.sensitiveEvents ? 'tone-warn' : 'muted'}`}>{fmtInt(p.sensitiveEvents)}</td>
                    <td><span className="chips">{p.countries.map((c) => <CountryBadge key={c} cc={c} alert={expected.size > 0 && !expected.has(c.toUpperCase())} />)}</span></td>
                    <td className="small muted mono nowrap">{t.date(p.firstSeen)}</td>
                    <td className="small mono nowrap" title={t.dateTime(p.lastSeen)}>{t.date(p.lastSeen)} <span className="muted">{p.lastSeen ? t.relative(p.lastSeen) : ''}</span></td>
                    <td><span className="chips">{p.sources.map((s) => <SourceChip key={s} id={s} />)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
