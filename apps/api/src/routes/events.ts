import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EventQuery, EventPage, EventFacets, Histogram, EventDetail, FacetBucket, Import } from '@audit/core';
import { activityFor, friendlyOperation, recordTypeName, sourceLabel, WORKLOAD_GROUPS } from '@audit/core';
import { countryName, OWNER_LABEL, type IpOwnerCategory } from '@audit/ipdata';
import { query, one, camel, pool } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { loadWorkspace, exclusionsOf, EVENT_COLUMNS, toEventRow } from '../lib/workspace.js';
import { compileQuery, decodeCursor, encodeCursor } from '../lib/search.js';

const querySchema = z.object({
  q: z.string().max(4000).optional(),
  from: z.string().optional(), to: z.string().optional(),
  user: z.string().optional(), op: z.string().optional(), ip: z.string().optional(),
  source: z.string().optional(), group: z.string().optional(), workload: z.string().optional(), kind: z.string().optional(),
  result: z.enum(['failed', 'succeeded']).optional(), country: z.string().optional(), owner: z.string().optional(),
  importId: z.string().uuid().optional(), session: z.string().optional(), mid: z.string().optional(), nmid: z.string().optional(), sensitive: z.string().optional(),
  exclusions: z.enum(['on', 'off']).optional(), sort: z.enum(['ts', '-ts']).optional(),
  cursor: z.string().optional(), limit: z.coerce.number().min(1).max(500).optional(),
});

export function parseEventQuery(raw: unknown): EventQuery {
  const q = querySchema.parse(raw);
  for (const k of Object.keys(q) as (keyof EventQuery)[]) if (q[k] === '' || q[k] === undefined) delete q[k];
  return q as EventQuery;
}

export async function histogram(where: string, params: unknown[], unit: 'auto' | 'hour' | 'day' | 'week'): Promise<Histogram> {
  const range = await one<{ min: string | null; max: string | null }>(`select min(e.ts) as min, max(e.ts) as max from events e where ${where}`, params);
  let u: 'hour' | 'day' | 'week' = unit === 'auto' ? 'day' : unit;
  if (unit === 'auto' && range?.min && range.max) {
    const days = (new Date(range.max).getTime() - new Date(range.min).getTime()) / 86_400_000;
    u = days <= 3 ? 'hour' : days <= 120 ? 'day' : 'week';
  }
  const rows = await query<{ ts: string; count: number; failed: number }>(
    `select date_trunc('${u}', e.ts) as ts, count(*)::int as count, count(*) filter (where e.failed)::int as failed from events e where ${where} and e.ts is not null group by 1 order by 1`, params);
  return { unit: u, buckets: rows, from: range?.min ?? null, to: range?.max ?? null };
}

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth());

  const prepare = async (id: string, raw: unknown) => {
    const ws = await loadWorkspace(id);
    if (!ws) return null;
    const q = parseEventQuery(raw);
    const compiled = compileQuery(id, q, exclusionsOf(ws));
    return { ws, q, ...compiled };
  };

  /** Keyset-paginated search. */
  app.get('/workspaces/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prepare(id, req.query);
    if (!p) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const limit = p.q.limit ?? 100;
    const desc = p.q.sort !== 'ts';
    const params = [...p.params];
    let where = p.where;
    const cur = decodeCursor(p.q.cursor);
    if (cur) {
      // nulls sort last in desc order; cursor with null ts means we're in the null tail
      if (cur.ts == null) where += ` and e.ts is null and e.id ${desc ? '<' : '>'} $${params.push(cur.id)}`;
      else {
        const tsIdx = params.push(cur.ts), idIdx = params.push(cur.id);
        where += desc
          ? ` and (e.ts < $${tsIdx}::timestamptz or (e.ts = $${tsIdx}::timestamptz and e.id < $${idIdx}) or e.ts is null)`
          : ` and (e.ts > $${tsIdx}::timestamptz or (e.ts = $${tsIdx}::timestamptz and e.id > $${idIdx}))`;
      }
    }
    const order = desc ? 'e.ts desc nulls last, e.id desc' : 'e.ts asc nulls last, e.id asc';
    const rows = await query<Record<string, unknown>>(`select ${EVENT_COLUMNS} from events e where ${where} order by ${order} limit ${limit + 1}`, params);
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map(toEventRow);
    const last = items[items.length - 1];

    // total: exact up to 20k rows, otherwise the planner's estimate (flagged approx)
    let total = 0, approx = false;
    const cnt = await one<{ n: number }>(`select count(*)::int as n from (select 1 from events e where ${p.where} limit 20001) s`, p.params);
    total = cnt?.n ?? 0;
    if (total > 20000) {
      approx = true;
      const plan = await pool.query(`explain (format json) select 1 from events e where ${p.where}`, p.params as never[]);
      // never report fewer than we actually counted
      total = Math.max(20000, Number(plan.rows[0]['QUERY PLAN'][0].Plan['Plan Rows'] ?? total));
    }
    let hidden = 0;
    if (p.exclusionClause) {
      const h = await one<{ n: number }>(`select count(*)::int as n from (select 1 from events e where ${p.where.replace(`and not ${p.exclusionClause}`, `and ${p.exclusionClause}`)} limit 20001) s`, p.params);
      hidden = h?.n ?? 0;
    }
    const page: EventPage = { items, nextCursor: more && last ? encodeCursor(last.ts, last.id) : null, total, approx, hiddenByExclusions: hidden };
    return page;
  });

  app.get('/workspaces/:id/events/facets', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prepare(id, req.query);
    if (!p) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    // One pass over the matching rows with GROUPING SETS instead of eleven separate aggregates.
    const cols = ['source', 'workload_group', 'workload', 'operation', 'user_upn', 'client_ip', 'ip_country', 'ip_owner', 'result', 'kind', 'record_type'] as const;
    const rows = await query<Record<string, string | number | null>>(
      `select ${cols.map((c) => `e.${c}`).join(', ')}, count(*)::int as n, grouping(${cols.map((c) => `e.${c}`).join(', ')}) as g
         from events e where ${p.where}
        group by grouping sets (${cols.map((c) => `(e.${c})`).join(', ')})`, p.params);
    // grouping() returns a bitmask with a 0 bit for the column that is NOT aggregated away
    const buckets: Record<string, FacetBucket[]> = Object.fromEntries(cols.map((c) => [c, []]));
    const full = (1 << cols.length) - 1;
    for (const r of rows) {
      const g = Number(r.g);
      const idx = cols.findIndex((_, i) => ((g >> (cols.length - 1 - i)) & 1) === 0);
      if (idx < 0 || g === full) continue;
      const col = cols[idx];
      const value = r[col];
      if (value == null) continue;
      buckets[col].push({ value: String(value), count: Number(r.n) });
    }
    const top = (c: (typeof cols)[number], n: number) => buckets[c].sort((a, b) => b.count - a.count).slice(0, n);
    const f: EventFacets = {
      sources: top('source', 12).map((b) => ({ ...b, label: sourceLabel(b.value as never) })),
      groups: top('workload_group', 12).map((b) => ({ ...b, label: WORKLOAD_GROUPS[b.value as keyof typeof WORKLOAD_GROUPS]?.label ?? b.value })),
      workloads: top('workload', 12),
      operations: top('operation', 15).map((b) => ({ ...b, label: friendlyOperation(b.value) })),
      users: top('user_upn', 15), ips: top('client_ip', 12),
      countries: top('ip_country', 12).map((b) => ({ ...b, label: countryName(b.value) })),
      owners: top('ip_owner', 12).map((b) => ({ ...b, label: OWNER_LABEL[b.value as IpOwnerCategory] ?? b.value })),
      results: top('result', 12), kinds: top('kind', 12), recordTypes: top('record_type', 15),
    };
    return f;
  });

  app.get('/workspaces/:id/events/histogram', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prepare(id, req.query);
    if (!p) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const unit = ((req.query as { unit?: string }).unit ?? 'auto') as 'auto' | 'hour' | 'day' | 'week';
    return histogram(p.where, p.params, unit);
  });

  /** Streaming CSV export of the current search (same filters). */
  app.get('/workspaces/:id/events/export.csv', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prepare(id, req.query);
    if (!p) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const includeRaw = (req.query as { raw?: string }).raw === '1';
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="audit-events-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv"`);
    const cols = ['ts', 'source', 'workload', 'record_type', 'operation', 'user_upn', 'counterpart', 'item', 'detail', 'client_ip', 'ip_country', 'ip_owner', 'user_agent', 'result', 'failed', 'session_id', 'message_id', 'source_record_id', 'import_id'];
    const cell = (v: unknown) => {
      if (v == null) return '';
      let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const { Readable } = await import('node:stream');
    const client = await pool.connect();
    async function* gen() {
      try {
        yield '﻿' + [...cols, ...(includeRaw ? ['raw'] : [])].join(',') + '\n';
        let cursor: { ts: string | null; id: number } | null = null;
        for (;;) {
          const params = [...p!.params];
          let where = p!.where;
          if (cursor) {
            if (cursor.ts == null) where += ` and e.ts is null and e.id < $${params.push(cursor.id)}`;
            else { const a = params.push(cursor.ts), b = params.push(cursor.id); where += ` and (e.ts < $${a}::timestamptz or (e.ts = $${a}::timestamptz and e.id < $${b}) or e.ts is null)`; }
          }
          const rows = (await client.query(`select ${cols.map((c) => 'e.' + c).join(',')}, e.id${includeRaw ? ', e.raw' : ''} from events e where ${where} order by e.ts desc nulls last, e.id desc limit 5000`, params as never[])).rows;
          if (!rows.length) break;
          let chunk = '';
          for (const r of rows) chunk += cols.map((c) => cell(r[c])).concat(includeRaw ? [cell(r.raw)] : []).join(',') + '\n';
          yield chunk;
          const last = rows[rows.length - 1];
          cursor = { ts: last.ts, id: last.id };
          if (rows.length < 5000) break;
        }
      } finally {
        client.release();
      }
    }
    return reply.send(Readable.from(gen()));
  });

  /** Autocomplete values for a field. */
  app.get('/workspaces/:id/events/suggest', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { field, prefix } = z.object({ field: z.enum(['user', 'op', 'ip', 'workload', 'recordType']), prefix: z.string().max(200).default('') }).parse(req.query);
    const col = { user: 'upn', op: 'operation', ip: 'client_ip', workload: 'workload', recordType: 'record_type' }[field];
    if (field === 'user') return query<FacetBucket>(`select upn as value, events::int as count from identities where workspace_id = $1 and upn ilike $2 order by events desc limit 20`, [id, prefix + '%']);
    if (field === 'op') return query<FacetBucket>(`select min(operation) as value, sum(events)::int as count from discovered_operations where workspace_id = $1 and operation ilike $2 group by operation_key order by 2 desc limit 20`, [id, '%' + prefix + '%']);
    return query<FacetBucket>(`select ${col} as value, count(*)::int as count from events where workspace_id = $1 and ${col} ilike $2 group by 1 order by 2 desc limit 20`, [id, prefix + '%']).catch(() => reply.code(400).send({ error: 'bad_field', message: 'Unsupported field.' }));
  });

  /** Full record with raw JSON and relations. */
  app.get('/events/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await one<Record<string, unknown>>(`select ${EVENT_COLUMNS}, e.raw, e.envelope, e.workspace_id from events e where e.id = $1`, [Number(id)]);
    if (!r) return reply.code(404).send({ error: 'not_found', message: 'Event not found.' });
    const base = toEventRow(r);
    const imp = await one<Record<string, unknown>>('select id, file_name, format_label, created_at from imports where id = $1', [base.importId]);
    const ws = r.workspace_id as string;
    const [bySession, byCorrelation, byMessage] = await Promise.all([
      base.sessionId ? one<{ n: number }>('select count(*)::int as n from events where workspace_id = $1 and session_id = $2', [ws, base.sessionId]) : null,
      base.correlationId ? one<{ n: number }>('select count(*)::int as n from events where workspace_id = $1 and correlation_id = $2', [ws, base.correlationId]) : null,
      base.messageId || base.networkMessageId ? one<{ n: number }>('select count(*)::int as n from events where workspace_id = $1 and (message_id = $2 or network_message_id = $3)', [ws, base.messageId ?? '', base.networkMessageId ?? '']) : null,
    ]);
    const act = activityFor(base.operation);
    const detail: EventDetail = {
      ...base,
      raw: r.raw as Record<string, unknown>,
      envelope: (r.envelope as Record<string, unknown> | null) ?? null,
      import: camel<Pick<Import, 'id' | 'fileName' | 'formatLabel' | 'createdAt'>>(imp ?? {}),
      activity: act ? { friendlyName: act.friendlyName, description: act.description } : null,
      recordTypeDescription: base.recordTypeId != null ? recordTypeName(base.recordTypeId) : null,
      related: { bySession: bySession?.n ?? 0, byCorrelation: byCorrelation?.n ?? 0, byMessage: byMessage?.n ?? 0 },
    };
    return detail;
  });
}
