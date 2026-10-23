import type { FastifyInstance } from 'fastify';
import type { Coverage, SourceCoverage, SourceId, WorkloadGroup } from '@audit/core';
import { SOURCES, SOURCE_IDS, WORKLOAD_GROUPS, RECORD_TYPES, catalogSize, activityFor, allActivities, recordTypeId, workloadGroupFor } from '@audit/core';
import { geoSource, ownerDataAsOf } from '@audit/ipdata';
import { query } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { loadWorkspace } from '../lib/workspace.js';

const DAY = 86_400_000;

export async function coverageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth());

  app.get('/workspaces/:id/coverage', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await loadWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });

    const [perSource, perImport, rts, days, ops, perGroup] = await Promise.all([
      query<{ source: SourceId; events: number; first: string | null; last: string | null }>(`select source, count(*)::int as events, min(ts) as first, max(ts) as last from events where workspace_id = $1 group by source`, [id]),
      query<{ source: SourceId; imports: number; last_import_at: string; hit_limit: number }>(`select source, count(*)::int as imports, max(created_at) as last_import_at, count(*) filter (where warnings::text like '%export limit%')::int as hit_limit from imports where workspace_id = $1 and status = 'completed' group by source`, [id]),
      query<{ source: SourceId; record_type: string | null; record_type_id: number | null; events: number }>(`select source, record_type, min(record_type_id) as record_type_id, count(*)::int as events from events where workspace_id = $1 group by source, record_type order by events desc`, [id]),
      query<{ d: string; n: number }>(`select date_trunc('day', ts) as d, count(*)::int as n from events where workspace_id = $1 and source = 'purview' and ts is not null group by 1 order by 1`, [id]),
      query<{ operation: string; workload: string | null; record_type: string | null; events: number; first_seen: string; last_seen: string }>(`select min(operation) as operation, min(workload) as workload, record_type, sum(events)::int as events, min(first_seen) as first_seen, max(last_seen) as last_seen from discovered_operations where workspace_id = $1 group by operation_key, record_type order by events desc`, [id]),
      query<{ g: WorkloadGroup; events: number; rts: number; ops: number }>(`select workload_group as g, count(*)::int as events, count(distinct record_type)::int as rts, count(distinct operation_key)::int as ops from events where workspace_id = $1 group by 1`, [id]),
    ]);

    // gaps in Layer A: whole days with zero events between first and last
    const gaps: SourceCoverage['gaps'] = [];
    if (days.length > 1) {
      for (let i = 1; i < days.length; i++) {
        const prev = new Date(days[i - 1].d).getTime(), cur = new Date(days[i].d).getTime();
        const missing = Math.round((cur - prev) / DAY) - 1;
        if (missing >= 1) gaps.push({ from: new Date(prev + DAY).toISOString(), to: new Date(cur - DAY).toISOString(), days: missing });
      }
    }

    const now = Date.now();
    const warnings: string[] = [];
    const sources: SourceCoverage[] = SOURCE_IDS.map((sid) => {
      const def = SOURCES[sid];
      const ev = perSource.find((s) => s.source === sid);
      const im = perImport.find((s) => s.source === sid);
      const collected = !!ev;
      // Retention horizon: the oldest evidence we hold ages out of Microsoft's export window after first+retention.
      // More useful: when can the *newest* data still be pulled? newest+retention. We report the latter: after that date,
      // nothing newer than what we already have can be exported, so a refresh must happen before.
      let horizon: string | null = null, rw: string | null = null;
      if (ev?.last) {
        const h = new Date(ev.last).getTime() + def.retentionDays * DAY;
        horizon = new Date(h).toISOString();
        const left = Math.floor((h - now) / DAY);
        if (left < 0) rw = `Collection is ${-left} days past the ${def.retentionDays}-day retention window: anything that happened after ${ev.last.slice(0, 10)} can no longer be exported.`;
        else if (left <= 7) rw = `Only ${left} day${left === 1 ? '' : 's'} left to export activity after ${ev.last.slice(0, 10)} before it leaves Microsoft's ${def.retentionDays}-day retention.`;
      } else if (def.layer === 'B') {
        rw = `Not collected. ${def.vendorName} keeps this for ${def.retentionDays}${def.retentionDaysPremium ? `–${def.retentionDaysPremium}` : ''} days — export it early in an investigation.`;
      }
      if (rw && collected) warnings.push(`${def.label}: ${rw}`);
      return {
        source: sid, layer: def.layer, label: def.label, description: def.description,
        status: collected ? 'collected' : 'not_collected',
        events: ev?.events ?? 0, imports: im?.imports ?? 0, firstEvent: ev?.first ?? null, lastEvent: ev?.last ?? null, lastImportAt: im?.last_import_at ?? null,
        retentionDays: def.retentionDays, retentionDaysPremium: def.retentionDaysPremium ?? null, retentionNote: def.retentionNote,
        retentionHorizon: horizon, retentionWarning: rw, howToExport: def.howToExport, docsUrl: def.docsUrl,
        gaps: sid === 'purview' ? gaps : [],
        recordTypes: rts.filter((r) => r.source === sid).map((r) => ({ recordType: r.record_type ?? '(none)', recordTypeId: r.record_type_id, events: r.events, inCatalog: r.record_type != null && (r.record_type_id != null ? RECORD_TYPES.some(([n]) => n === r.record_type_id) : recordTypeId(r.record_type) != null) })),
        importsHitRowLimit: im?.hit_limit ?? 0,
      };
    });
    if (gaps.length) warnings.push(`Purview audit log has ${gaps.length} gap${gaps.length === 1 ? '' : 's'} with no events at all (${gaps.reduce((a, g) => a + g.days, 0)} days). Check whether an export slice is missing.`);
    const limitHits = perImport.reduce((a, i) => a + i.hit_limit, 0);
    if (limitHits) warnings.push(`${limitHits} import${limitHits === 1 ? '' : 's'} reached the export row limit; those searches were probably truncated.`);

    const groups = (Object.keys(WORKLOAD_GROUPS) as WorkloadGroup[]).map((g) => {
      const r = perGroup.find((x) => x.g === g);
      return { group: g, label: WORKLOAD_GROUPS[g].label, events: r?.events ?? 0, recordTypes: r?.rts ?? 0, operations: r?.ops ?? 0 };
    });
    const unknownOperations = ops.filter((o) => !activityFor(o.operation)).slice(0, 500).map((o) => ({ operation: o.operation, workload: o.workload, recordType: o.record_type, events: o.events, firstSeen: o.first_seen, lastSeen: o.last_seen }));

    const res: Coverage = {
      generatedAt: new Date().toISOString(), workspaceId: id, sources, groups, unknownOperations,
      catalog: { recordTypes: RECORD_TYPES.length, activities: catalogSize(), geoSource: geoSource(), ipOwnerDataAsOf: ownerDataAsOf() },
      warnings,
    };
    return res;
  });

  // --- static catalog ---
  app.get('/catalog/record-types', async () => RECORD_TYPES.map(([id, name]) => ({ id, name, group: workloadGroupFor(null, name) })));
  app.get('/catalog/sources', async () => SOURCE_IDS.map((s) => SOURCES[s]));
  app.get('/catalog/groups', async () => WORKLOAD_GROUPS);
  app.get('/catalog/activities', async (req) => {
    const q = ((req.query as { q?: string }).q ?? '').toLowerCase();
    const all = allActivities();
    return (q ? all.filter((a) => a.operation.toLowerCase().includes(q) || a.friendlyName.toLowerCase().includes(q)) : all).slice(0, 500);
  });
}
