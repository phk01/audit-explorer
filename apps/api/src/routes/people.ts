import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Person, PersonDetail, FacetBucket } from '@audit/core';
import { friendlyOperation, userAgentFamily, WORKLOAD_GROUPS } from '@audit/core';
import { countryName } from '@audit/ipdata';
import { query, one, camel } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { loadWorkspace, exclusionsOf } from '../lib/workspace.js';
import { compileQuery } from '../lib/search.js';
import { histogram } from './events.js';

function classify(upn: string, tenantDomains: string[]): Person['kind'] {
  if (upn.includes('#ext#')) return 'guest';
  if (!upn.includes('@')) return 'system';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(upn)) return 'service';
  const dom = upn.split('@')[1];
  if (tenantDomains.length && !tenantDomains.includes(dom)) return 'external';
  return 'member';
}

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth());

  app.get('/workspaces/:id/people', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await loadWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const q = z.object({ search: z.string().max(200).optional(), kind: z.string().optional(), sort: z.enum(['events', 'lastSeen', 'failed', 'sensitive', 'upn']).default('events'), limit: z.coerce.number().min(1).max(2000).default(200), offset: z.coerce.number().min(0).default(0) }).parse(req.query);
    const params: unknown[] = [id];
    let where = 'workspace_id = $1';
    if (q.search) { params.push('%' + q.search + '%'); where += ` and upn ilike $${params.length}`; }
    if (q.kind) {
      const kinds = q.kind.split(',');
      const parts: string[] = [];
      if (kinds.includes('guest')) parts.push(`upn like '%#ext#%'`);
      if (kinds.includes('system')) parts.push(`upn not like '%@%'`);
      if (kinds.includes('service')) parts.push(`upn ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'`);
      if (kinds.includes('external') && ws.tenantDomains.length) { params.push(ws.tenantDomains); parts.push(`(upn like '%@%' and upn not like '%#ext#%' and split_part(upn, '@', 2) <> all($${params.length}::text[]))`); }
      if (kinds.includes('member')) { params.push(ws.tenantDomains); parts.push(`(upn like '%@%' and upn not like '%#ext#%' and upn !~ '^[0-9a-f]{8}-[0-9a-f]{4}-' and (cardinality($${params.length}::text[]) = 0 or split_part(upn, '@', 2) = any($${params.length}::text[])))`); }
      if (parts.length) where += ` and (${parts.join(' or ')})`;
    }
    const order = { events: 'events desc', lastSeen: 'last_seen desc nulls last', failed: 'failed desc', sensitive: 'sensitive_events desc', upn: 'upn asc' }[q.sort];
    const rows = await query<Record<string, unknown>>(`select * from identities where ${where} order by ${order} limit ${q.limit} offset ${q.offset}`, params);
    const total = await one<{ n: number }>(`select count(*)::int as n from identities where ${where}`, params);
    const items: Person[] = rows.map((r) => { const p = camel<Person & { sensitiveEvents: number }>(r); return { ...p, kind: classify(p.upn, ws.tenantDomains), displayName: null } as Person; });
    return { items, total: total?.n ?? 0 };
  });

  app.get('/workspaces/:id/people/:upn', async (req, reply) => {
    const { id, upn: upnRaw } = req.params as { id: string; upn: string };
    const upn = decodeURIComponent(upnRaw).toLowerCase();
    const ws = await loadWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const qs = req.query as { from?: string; to?: string; exclusions?: 'on' | 'off' };
    const ident = await one<Record<string, unknown>>('select * from identities where workspace_id = $1 and upn = $2', [id, upn]);
    const { where, params } = compileQuery(id, { user: upn, from: qs.from, to: qs.to, exclusions: qs.exclusions }, exclusionsOf(ws));
    const facet = (col: string, n = 15) => query<FacetBucket>(`select ${col} as value, count(*)::int as count from events e where ${where} and ${col} is not null group by 1 order by 2 desc limit ${n}`, params);
    const [agg, ips, uas, operations, workloads, groups, countries, counterparts, hist, heat, sensitive] = await Promise.all([
      one<Record<string, unknown>>(`select count(*)::int as events, count(*) filter (where e.failed)::int as failed, count(*) filter (where e.kind='signin')::int as sign_ins, count(*) filter (where e.sensitive_family is not null)::int as sensitive_events, count(distinct e.client_ip)::int as ip_count, min(e.ts) as first_seen, max(e.ts) as last_seen, coalesce(array_agg(distinct e.source), '{}') as sources, coalesce(array_agg(distinct e.ip_country) filter (where e.ip_country is not null), '{}') as countries from events e where ${where}`, params),
      query<Record<string, unknown>>(`select e.client_ip as ip, min(e.ip_country) as country, min(e.ip_owner) as owner, min(e.ip_owner_name) as owner_name, count(*)::int as events, count(*) filter (where e.failed)::int as failed, min(e.ts) as first_seen, max(e.ts) as last_seen from events e where ${where} and e.client_ip is not null group by e.client_ip order by events desc limit 100`, params),
      query<{ ua: string; events: number; first_seen: string; last_seen: string }>(`select e.user_agent as ua, count(*)::int as events, min(e.ts) as first_seen, max(e.ts) as last_seen from events e where ${where} and e.user_agent is not null group by e.user_agent order by events desc limit 300`, params),
      facet('e.operation', 25), facet('e.workload'), facet('e.workload_group'), facet('e.ip_country'), facet('e.counterpart', 15),
      histogram(where, params, 'auto'),
      query<{ dow: number; hour: number; n: number }>(`select extract(isodow from e.ts)::int as dow, extract(hour from e.ts)::int as hour, count(*)::int as n from events e where ${where} and e.ts is not null group by 1,2`, params),
      query<{ family: string; count: number; last_seen: string }>(`select e.sensitive_family as family, count(*)::int as count, max(e.ts) as last_seen from events e where ${where} and e.sensitive_family is not null group by 1 order by 2 desc`, params),
    ]);
    // collapse user agents into families
    const fam = new Map<string, { family: string; events: number; firstSeen: string; lastSeen: string }>();
    for (const u of uas) {
      const f = userAgentFamily(u.ua) || u.ua;
      const cur = fam.get(f);
      if (cur) { cur.events += u.events; if (u.first_seen < cur.firstSeen) cur.firstSeen = u.first_seen; if (u.last_seen > cur.lastSeen) cur.lastSeen = u.last_seen; }
      else fam.set(f, { family: f, events: u.events, firstSeen: u.first_seen, lastSeen: u.last_seen });
    }
    const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const h of heat) heatmap[h.dow - 1][h.hour] = h.n;
    const a = agg ?? {};
    const detail: PersonDetail = {
      upn, displayName: null, kind: classify(upn, ws.tenantDomains),
      firstSeen: (a.first_seen as string) ?? null, lastSeen: (a.last_seen as string) ?? null,
      events: (a.events as number) ?? 0, failed: (a.failed as number) ?? 0, signIns: (a.sign_ins as number) ?? 0,
      sources: ((a.sources as string[]) ?? []) as PersonDetail['sources'], ipCount: (a.ip_count as number) ?? 0, countries: (a.countries as string[]) ?? [],
      sensitiveEvents: (a.sensitive_events as number) ?? 0,
      ips: ips.map((r) => camel(r)) as PersonDetail['ips'],
      clients: [...fam.values()].sort((x, y) => y.events - x.events),
      operations: operations.map((b) => ({ ...b, label: friendlyOperation(b.value) })),
      workloads, groups: groups.map((b) => ({ ...b, label: WORKLOAD_GROUPS[b.value as keyof typeof WORKLOAD_GROUPS]?.label ?? b.value })),
      countriesDetail: countries.map((b) => ({ ...b, label: countryName(b.value) })),
      counterparts, histogram: hist, hourHeatmap: heatmap,
      sensitive: sensitive.map((s) => ({ family: s.family, count: s.count, lastSeen: s.last_seen })),
    };
    if (!ident && !detail.events) return reply.code(404).send({ error: 'not_found', message: 'No activity for this person.' });
    return detail;
  });
}
