import type { ReactNode } from 'react';
import type { EventFacets, FacetBucket } from '@audit/core';
import { fmtInt, KIND_LABEL } from '../lib/format';
import { useLocalPref } from '../lib/url';
import { countryName } from '../lib/countries';
import { CountryBadge, OwnerBadge, SourceChip, groupLabel } from './Badges';
import { Skeleton } from './Basics';
import { IconChevronRight } from './Icons';
import { friendly } from '../pages/Overview';

export interface FacetSelection {
  isSelected: (key: string, value: string) => boolean;
  toggle: (key: string, value: string) => void;
}

interface Def { id: keyof EventFacets; title: string; key: string; render?: (b: FacetBucket, ctx: { ownerByIp?: Map<string, string> }) => ReactNode }

const DEFS: Def[] = [
  { id: 'sources', title: 'Sources', key: 'source', render: (b) => <><SourceChip id={b.value} /></> },
  { id: 'groups', title: 'Workload groups', key: 'group', render: (b) => <span className="ellipsis">{b.label ?? groupLabel(b.value)}</span> },
  { id: 'operations', title: 'Operations', key: 'op', render: (b) => <span className="facet-op"><span className="ellipsis">{b.label ?? friendly(b.value)}</span><small>{b.value}</small></span> },
  { id: 'users', title: 'Users', key: 'user', render: (b) => <span className="ellipsis" title={b.value}>{b.value}</span> },
  { id: 'ips', title: 'Client IPs', key: 'ip', render: (b, ctx) => <span className="ip-cell"><span className="mono ellipsis">{b.value}</span><OwnerBadge owner={ctx.ownerByIp?.get(b.value)} /></span> },
  { id: 'countries', title: 'Countries', key: 'country', render: (b) => <><CountryBadge cc={b.value} /><span className="ellipsis">{b.label ?? countryName(b.value)}</span></> },
  { id: 'owners', title: 'IP owners', key: 'owner', render: (b) => <><OwnerBadge owner={b.value} /><span className="ellipsis">{b.label ?? b.value}</span></> },
  { id: 'results', title: 'Results', key: 'res', render: (b) => <span className={`ellipsis ${/fail/i.test(b.value) ? 'tone-crit' : ''}`}>{b.value}</span> },
  { id: 'kinds', title: 'Kinds', key: 'kind', render: (b) => <span className="ellipsis">{KIND_LABEL[b.value] ?? b.value}</span> },
  { id: 'recordTypes', title: 'Record types', key: 'type', render: (b) => <span className="ellipsis mono" style={{ fontSize: 11.5 }}>{b.value}</span> },
];

export function FacetsPanel({ facets, loading, sel, ownerByIp }: { facets: EventFacets | undefined; loading: boolean; sel: FacetSelection; ownerByIp?: Map<string, string> }) {
  const [closed, setClosed] = useLocalPref<Record<string, boolean>>('ae.facets.closed', {});
  return (
    <aside className="facets" aria-label="Facets">
      {DEFS.map((d) => {
        const items = facets?.[d.id] ?? [];
        const selectedCount = items.filter((b) => sel.isSelected(d.key, b.value)).length;
        const open = !closed[d.id];
        if (facets && !items.length && !selectedCount) return null;
        return (
          <details key={d.id} className="facet" open={open} onToggle={(e) => setClosed((c) => ({ ...c, [d.id]: !(e.target as HTMLDetailsElement).open }))}>
            <summary><IconChevronRight size={12} />{d.title}{selectedCount > 0 && <span className="count-badge">{selectedCount}</span>}</summary>
            {!facets && loading ? <div className="stack-8 stack" style={{ padding: '4px 6px' }}><Skeleton w="80%" h={12} /><Skeleton w="60%" h={12} /><Skeleton w="70%" h={12} /></div> : (
              <ul className="facet-list">
                {items.map((b) => {
                  const on = sel.isSelected(d.key, b.value);
                  return (
                    <li key={b.value}>
                      <button type="button" className={`facet-btn ${on ? 'is-selected' : ''}`} aria-pressed={on} onClick={() => sel.toggle(d.key, b.value)} title={b.label ? `${b.label} (${b.value})` : b.value}>
                        <span className="facet-check" aria-hidden>{on ? '✓' : ''}</span>
                        <span className="facet-label">{d.render ? d.render(b, { ownerByIp }) : b.label ?? b.value}</span>
                        <span className="facet-count">{fmtInt(b.count)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </details>
        );
      })}
    </aside>
  );
}
