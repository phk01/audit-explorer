import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Workspace, WorkspaceStats, Overview, FacetBucket, Import } from '@audit/core';
import { countryName } from '@audit/ipdata';
import { friendlyOperation } from '@audit/core';
import { query, one, camel } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { loadWorkspace, exclusionsOf } from '../lib/workspace.js';
import { compileQuery } from '../lib/search.js';
import { histogram } from './events.js';

const wsSchema = z.object({
  name: z.string().min(1).max(200),
  tenantDomains: z.array(z.string()).optional(),
  expectedCountries: z.array(z.string().length(2)).optional(),
  notes: z.string().max(20000).optional(),
  excludedIps: z.string().max(100000).optional(),
  excludeMicrosoftIps: z.boolean().optional(),
  excludeKeepitIps: z.boolean().optional(),
});

async function statsFor(ids: string[]): Promise<Map<string, WorkspaceStats>> {
  const out = new Map<string, WorkspaceStats>();
  if (!ids.length) return out;
  const rows = await query<Record<string, unknown>>(`
    select w.id,
      coalesce(s.events, 0) as events, coalesce(s.first_event, null) as first_event, s.last_event,
      coalesce(i.imports, 0) as imports, i.last_import_at, coalesce(i.running, 0) as running_imports,
      coalesce(p.people, 0) as people, coalesce(s.sources, '{}') as sources, coalesce(s.client_ips, 0) as client_ips
    from workspaces w
    left join lateral (select count(*) as events, min(ts) as first_event, max(ts) as last_event, array_agg(distinct source) as sources, count(distinct client_ip) as client_ips from events e where e.workspace_id = w.id) s on true
    left join lateral (select count(*) as imports, max(created_at) as last_import_at, count(*) filter (where status in ('queued','detecting','running')) as running from imports im where im.workspace_id = w.id) i on true
    left join lateral (select count(*) as people from identities p where p.workspace_id = w.id) p on true
    where w.id = any($1::uuid[])`, [ids]);
  for (const r of rows) {
    out.set(r.id as string, {
      events: r.events as number, imports: r.imports as number, people: r.people as number,
      firstEvent: r.first_event as string | null, lastEvent: r.last_event as string | null, lastImportAt: r.last_import_at as string | null,
      runningImports: r.running_imports as number, clientIps: r.client_ips as number, sourcesCollected: (r.sources as string[]).filter(Boolean) as WorkspaceStats['sourcesCollected'],
    });
  }
  return out;
}

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth());

  app.get('/workspaces', async () => {
    const rows = (await query<Record<string, unknown>>('select * from workspaces order by name')).map((r) => camel<Workspace>(r));
    const stats = await statsFor(rows.map((r) => r.id));
    return rows.map((w) => ({ ...w, stats: stats.get(w.id) }));
  });

  app.post('/workspaces', async (req) => {
    const b = wsSchema.parse(req.body);
    const row = await one<Record<string, unknown>>(
      `insert into workspaces(name, tenant_domains, expected_countries, notes, excluded_ips, exclude_microsoft_ips, exclude_keepit_ips, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [b.name, (b.tenantDomains ?? []).map((d) => d.toLowerCase()), (b.expectedCountries ?? []).map((c) => c.toUpperCase()), b.notes ?? '', b.excludedIps ?? '', b.excludeMicrosoftIps ?? false, b.excludeKeepitIps ?? false, req.user!.id]);
    return camel<Workspace>(row!);
  });

  app.get('/workspaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await loadWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const stats = await statsFor([id]);
    return { ...ws, stats: stats.get(id) };
  });

  app.patch('/workspaces/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = wsSchema.partial().parse(req.body);
    const ws = await loadWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const row = await one<Record<string, unknown>>(
      `update workspaces set name = $2, tenant_domains = $3, expected_countries = $4, notes = $5, excluded_ips = $6, exclude_microsoft_ips = $7, exclude_keepit_ips = $8, updated_at = now() where id = $1 returning *`,
      [id, b.name ?? ws.name, (b.tenantDomains ?? ws.tenantDomains).map((d) => d.toLowerCase()), (b.expectedCountries ?? ws.expectedCountries).map((c) => c.toUpperCase()), b.notes ?? ws.notes, b.excludedIps ?? ws.excludedIps, b.excludeMicrosoftIps ?? ws.excludeMicrosoftIps, b.excludeKeepitIps ?? ws.excludeKeepitIps]);
    return camel<Workspace>(row!);
  });

  app.delete('/workspaces/:id', { preHandler: requireAuth(['admin']) }, async (req) => {
    const { id } = req.params as { id: string };
    await query('delete from workspaces where id = $1', [id]);
    return { ok: true };
  });

  /** Dashboard numbers for a workspace (respects IP exclusions). */
  app.get('/workspaces/:id/overview', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await loadWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const q = req.query as { from?: string; to?: string; exclusions?: 'on' | 'off' };
    const { where, params } = compileQuery(id, { from: q.from, to: q.to, exclusions: q.exclusions }, exclusionsOf(ws));
    const top = async (col: string, extra = '') => (await query<FacetBucket>(`select ${col} as value, count(*)::int as count ${extra} from events e where ${where} and ${col} is not null group by ${col} order by count desc limit 10`, params));
    const [stats, hist, topUsers, topOperations, topIpsRaw, countries, groups, sources, agg, recent] = await Promise.all([
      statsFor([id]), histogram(where, params, 'auto'),
      top('e.user_upn'), top('e.operation'),
      query<FacetBucket & { country: string | null; owner: string | null }>(`select e.client_ip as value, count(*)::int as count, min(e.ip_country) as country, min(e.ip_owner) as owner from events e where ${where} and e.client_ip is not null group by e.client_ip order by count desc limit 10`, params),
      top('e.ip_country', ''), top('e.workload_group'), top('e.source'),
      one<{ failed: number; sensitive: number }>(`select count(*) filter (where e.failed)::int as failed, count(*) filter (where e.sensitive_family is not null)::int as sensitive from events e where ${where}`, params),
      query<Record<string, unknown>>('select * from imports where workspace_id = $1 order by created_at desc limit 5', [id]),
    ]);
    const res: Overview = {
      stats: stats.get(id)!, histogram: hist, topUsers, topOperations: topOperations.map((b) => ({ ...b, label: friendlyOperation(b.value) })), topIps: topIpsRaw,
      countries: countries.map((c) => ({ ...c, label: countryName(c.value) })), groups, sources,
      failedEvents: agg?.failed ?? 0, sensitiveEvents: agg?.sensitive ?? 0,
      recentImports: recent.map((r) => { delete r.file_path; delete r.format_columns; return camel<Import>(r); }),
    };
    return res;
  });
}
