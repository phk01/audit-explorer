/**
 * Universal ingestion pipeline.
 *
 *   file on disk ──► row stream (CSV / JSON / JSONL) ──► detect format from the first rows
 *      ──► normalise each row into 0..n events ──► enrich IPs ──► batch upsert (dedup on source id)
 *      ──► checkpoint + progress after every batch ──► refresh people & operation inventories
 *
 * Properties the product spec demands:
 *   - nothing is dropped: unknown operations/record types still become events with their raw record;
 *   - resumable: imports interrupted by a restart continue from checkpoint_row;
 *   - idempotent: re-importing overlapping exports never duplicates activity;
 *   - observable: progress events stream to the UI; every import keeps its warnings.
 */
import { EventEmitter } from 'node:events';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parse as csvParse } from 'csv-parse';
import StreamJson from 'stream-json';
import StreamArrayMod from 'stream-json/streamers/StreamArray.js';
import PickMod from 'stream-json/filters/Pick.js';
import StreamChain from 'stream-chain';
import {
  detectFormat, createNormalizer, unwrapJsonDocument, sensitiveFamily, SOURCES,
  type NormalizedEvent, type DetectedFormat, type ImportProgressEvent, type ImportStatus, type SourceId,
} from '@audit/core';
import { enrichIp } from '@audit/ipdata';
import { pool, query, one } from './db.js';
import { runSignals } from './signals.js';

export const importEvents = new EventEmitter();
importEvents.setMaxListeners(200);

const BATCH = 1000;
const SAMPLE = 50;
const cancelled = new Set<string>();
let running = 0;
const MAX_PARALLEL = Number(process.env.IMPORT_PARALLELISM ?? 1);
const queue: string[] = [];

export function enqueueImport(id: string): void {
  if (!queue.includes(id)) queue.push(id);
  void pump();
}

export function cancelImport(id: string): void {
  cancelled.add(id);
  const i = queue.indexOf(id);
  if (i >= 0) queue.splice(i, 1);
}

async function pump(): Promise<void> {
  while (running < MAX_PARALLEL && queue.length) {
    const id = queue.shift()!;
    running++;
    runImport(id).catch((e) => console.error('import crashed', id, e)).finally(() => { running--; void pump(); });
  }
}

/** On startup: anything that was in flight is re-queued and resumes from its checkpoint. */
export async function resumeInterruptedImports(): Promise<void> {
  const rows = await query<{ id: string }>(`select id from imports where status in ('queued','detecting','running') order by created_at`);
  for (const r of rows) enqueueImport(r.id);
}

interface ImportRow {
  id: string; workspace_id: string; file_name: string; file_path: string; file_size: number; status: ImportStatus;
  checkpoint_row: number; rows_processed: number; events_inserted: number; events_duplicate: number; rows_failed: number; bytes_processed: number;
  format_columns: Record<string, string> | null; source: SourceId | null; format_label: string | null; warnings: string[];
}

function emit(row: ImportRow, status: ImportStatus, extra?: Partial<ImportProgressEvent>): void {
  const ev: ImportProgressEvent = {
    type: status === 'running' ? 'progress' : 'status', importId: row.id, workspaceId: row.workspace_id, status,
    rowsProcessed: row.rows_processed, eventsInserted: row.events_inserted, eventsDuplicate: row.events_duplicate, rowsFailed: row.rows_failed,
    bytesProcessed: row.bytes_processed, fileSize: row.file_size, formatLabel: row.format_label, source: row.source, error: null, ...extra,
  };
  importEvents.emit('progress', ev);
}

// ---------- row streams ----------

type RowStream = AsyncIterable<{ row: Record<string, unknown>; bytes: number }>;

function kindOf(fileName: string, head: string): 'csv' | 'json' | 'jsonl' {
  const ext = fileName.toLowerCase().split('.').pop();
  const h = head.replace(/^﻿/, '').trimStart();
  if (ext === 'json' || (h.startsWith('{') && !h.includes('\n{')) || h.startsWith('[')) {
    // JSONL: first char "{" and the first line is a complete object followed by another
    if (ext === 'jsonl' || ext === 'ndjson') return 'jsonl';
    if (ext === 'json') return 'json';
    const firstLine = h.split('\n')[0];
    try { JSON.parse(firstLine); return h.includes('\n{') ? 'jsonl' : 'json'; } catch { return 'json'; }
  }
  if (ext === 'jsonl' || ext === 'ndjson' || (h.startsWith('{') && h.includes('\n{'))) return 'jsonl';
  return 'csv';
}

async function readHead(path: string, n = 4096): Promise<string> {
  return new Promise((res, rej) => {
    const s = createReadStream(path, { start: 0, end: n - 1, encoding: 'utf8' });
    let out = '';
    s.on('data', (c) => { out += c; });
    s.on('end', () => res(out));
    s.on('error', rej);
  });
}

async function* csvRows(path: string): RowStream {
  const parser = createReadStream(path).pipe(csvParse({
    columns: (h: string[]) => h.map((x, i) => (x ?? '').replace(/^﻿/, '').trim() || `column${i + 1}`),
    bom: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true, trim: false, info: true,
  }));
  for await (const rec of parser as AsyncIterable<{ record: Record<string, unknown>; info: { bytes: number } }>) {
    yield { row: rec.record, bytes: rec.info.bytes };
  }
}

async function* jsonlRows(path: string): RowStream {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let bytes = 0;
  for await (const line of rl) {
    bytes += Buffer.byteLength(line) + 1;
    const t = line.trim();
    if (!t) continue;
    try { const o = JSON.parse(t); if (o && typeof o === 'object') yield { row: o, bytes }; } catch { yield { row: { __unparsed: t }, bytes }; }
  }
}

/** Streams a JSON array (bare, or under value/records/results/items/data) item by item. */
async function* jsonRows(path: string, head: string): RowStream {
  const h = head.replace(/^﻿/, '').trimStart();
  const wrapperKey = h.startsWith('{') ? (h.match(/"(value|records|Results|results|items|data)"\s*:\s*\[/)?.[1] ?? null) : null;
  if (h.startsWith('{') && !wrapperKey) {
    // a single object or an object we don't know how to stream: load it whole (these are small)
    const txt = await new Promise<string>((res, rej) => { let s = ''; createReadStream(path, { encoding: 'utf8' }).on('data', (c) => { s += c; }).on('end', () => res(s)).on('error', rej); });
    let bytes = 0;
    for (const row of unwrapJsonDocument(JSON.parse(txt.replace(/^﻿/, '')))) { bytes += JSON.stringify(row).length; yield { row, bytes }; }
    return;
  }
  const pipeline = (StreamChain as unknown as (fns: unknown[]) => AsyncIterable<{ key: number; value: unknown }>)([
    createReadStream(path),
    StreamJson.parser(),
    ...(wrapperKey ? [PickMod.pick({ filter: wrapperKey })] : []),
    StreamArrayMod.streamArray(),
  ]);
  let bytes = 0;
  for await (const { value } of pipeline as AsyncIterable<{ key: number; value: unknown }>) {
    if (value && typeof value === 'object') { bytes += JSON.stringify(value).length; yield { row: value as Record<string, unknown>, bytes }; }
  }
}

// ---------- batch insert ----------

const COLS = ['workspace_id', 'import_id', 'source', 'layer', 'source_record_id', 'ts', 'workload', 'workload_group', 'record_type', 'record_type_id', 'operation', 'operation_key', 'kind', 'user_upn', 'user_type', 'object_id', 'item', 'detail', 'client_ip', 'ip_country', 'ip_owner', 'ip_owner_name', 'user_agent', 'result', 'failed', 'session_id', 'correlation_id', 'message_id', 'network_message_id', 'counterpart', 'sensitive_family', 'raw', 'envelope'] as const;
const TYPES = ['uuid', 'uuid', 'text', 'char(1)', 'text', 'timestamptz', 'text', 'text', 'text', 'int', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'char(2)', 'text', 'text', 'text', 'text', 'boolean', 'text', 'text', 'text', 'text', 'text', 'text', 'jsonb', 'jsonb'];

const INSERT_SQL = `
  insert into events (${COLS.join(',')}, search)
  select ${COLS.map((c) => `u.${c}`).join(',')},
         ae_search_vector(concat_ws(' ', u.user_upn, u.operation, u.item, u.detail, u.client_ip, u.object_id, u.counterpart, u.user_agent, u.message_id, u.raw::text))
    from unnest(${COLS.map((_, i) => `$${i + 1}::${TYPES[i]}[]`).join(',')}) as u(${COLS.join(',')})
  on conflict (workspace_id, source_record_id) do nothing`;

async function insertBatch(workspaceId: string, importId: string, batch: NormalizedEvent[]): Promise<number> {
  if (!batch.length) return 0;
  // de-dup inside the batch (ON CONFLICT can't see rows from the same statement)
  const seen = new Set<string>();
  const rows = batch.filter((e) => { if (seen.has(e.sourceRecordId)) return false; seen.add(e.sourceRecordId); return true; });
  const cols: unknown[][] = COLS.map(() => []);
  for (const e of rows) {
    const ip = e.clientIp ? enrichIp(e.clientIp) : null;
    const vals = [
      workspaceId, importId, e.source, e.source === 'purview' ? 'A' : 'B', e.sourceRecordId, e.ts, e.workload, e.workloadGroup, e.recordType, e.recordTypeId,
      e.operation, e.operationKey, e.kind, e.userUpn, e.userType, e.objectId, e.item, e.detail, e.clientIp, ip?.country ?? null, ip?.owner?.category ?? null, ip?.owner?.name ?? null,
      e.userAgent, e.result, e.failed, e.sessionId, e.correlationId, e.messageId, e.networkMessageId, e.counterpart, sensitiveFamily(e.operationKey),
      JSON.stringify(e.raw), e.envelope ? JSON.stringify(e.envelope) : null,
    ];
    vals.forEach((v, i) => cols[i].push(v));
  }
  const r = await pool.query(INSERT_SQL, cols);
  return r.rowCount ?? 0;
}

// ---------- the run ----------

export async function runImport(id: string): Promise<void> {
  const row = await one<ImportRow>('select * from imports where id = $1', [id]);
  if (!row || ['completed', 'failed', 'cancelled', 'skipped'].includes(row.status)) return;
  cancelled.delete(id);
  const warnings: string[] = Array.isArray(row.warnings) ? [...row.warnings] : [];
  const resuming = row.checkpoint_row > 0;
  await query(`update imports set status = 'detecting', started_at = coalesce(started_at, now()), error = null where id = $1`, [id]);
  row.status = 'detecting';
  emit(row, 'detecting');

  let format: DetectedFormat | null = row.format_columns && row.source ? { source: row.source, label: row.format_label ?? '', columns: row.format_columns, notes: [] } : null;
  let normalize: ((r: Record<string, unknown>) => NormalizedEvent[]) | null = format ? createNormalizer(format) : null;

  const head = await readHead(row.file_path);
  const kind = kindOf(row.file_name, head);
  const stream: RowStream = kind === 'csv' ? csvRows(row.file_path) : kind === 'jsonl' ? jsonlRows(row.file_path) : jsonRows(row.file_path, head);

  let sample: Record<string, unknown>[] = [];
  let pending: { row: Record<string, unknown>; bytes: number }[] = [];
  let batch: NormalizedEvent[] = [];
  let rowIndex = 0;
  let minTs: string | null = null, maxTs: string | null = null;
  let lastFlush = Date.now();

  const flush = async (final = false) => {
    if (batch.length) {
      const inserted = await insertBatch(row.workspace_id, id, batch);
      row.events_inserted += inserted;
      row.events_duplicate += batch.length - inserted;
      batch = [];
    }
    row.checkpoint_row = rowIndex;
    await query(
      `update imports set rows_processed = $2, events_inserted = $3, events_duplicate = $4, rows_failed = $5, bytes_processed = $6, checkpoint_row = $7,
              min_ts = least(coalesce(min_ts, $8::timestamptz), $8::timestamptz), max_ts = greatest(coalesce(max_ts, $9::timestamptz), $9::timestamptz), warnings = $10
        where id = $1`,
      [id, row.rows_processed, row.events_inserted, row.events_duplicate, row.rows_failed, row.bytes_processed, row.checkpoint_row, minTs, maxTs, JSON.stringify(warnings.slice(0, 50))]);
    minTs = maxTs = null;
    lastFlush = Date.now();
    if (!final) emit(row, 'running');
  };

  const handle = (r: Record<string, unknown>) => {
    try {
      const evs = normalize!(r);
      if (!evs.length) { row.rows_failed++; if (warnings.length < 50) warnings.push(`Row ${rowIndex}: produced no event`); return; }
      for (const e of evs) {
        batch.push(e);
        if (e.ts) { if (!minTs || e.ts < minTs) minTs = e.ts; if (!maxTs || e.ts > maxTs) maxTs = e.ts; }
      }
    } catch (e) {
      row.rows_failed++;
      if (warnings.length < 50) warnings.push(`Row ${rowIndex}: ${(e as Error).message}`);
    }
  };

  try {
    for await (const item of stream) {
      rowIndex++;
      if (cancelled.has(id)) throw new Error('__cancelled');
      row.bytes_processed = item.bytes;
      if (!format) {
        sample.push(item.row);
        pending.push(item);
        if (sample.length < SAMPLE) continue;
        format = detectFormat(sample);
        if (format.source === 'unknown') throw new Error(`Could not recognise this file. ${format.notes.join(' ')} Columns seen: ${Object.keys(sample[0] ?? {}).slice(0, 12).join(', ')}`);
        normalize = createNormalizer(format);
        row.source = format.source; row.format_label = format.label;
        await query(`update imports set status = 'running', source = $2, format_label = $3, format_columns = $4 where id = $1`, [id, format.source, format.label, JSON.stringify(format.columns)]);
        row.status = 'running';
        let i = 0;
        for (const p of pending) { i++; if (i <= row.checkpoint_row) continue; handle(p.row); row.rows_processed++; }
        pending = []; sample = [];
        continue;
      }
      if (rowIndex <= row.checkpoint_row) continue; // resuming: skip already-processed rows
      handle(item.row);
      row.rows_processed++;
      if (batch.length >= BATCH || Date.now() - lastFlush > 2000) await flush();
    }
    // small files: fewer rows than the detection sample
    if (!format) {
      if (!sample.length) throw new Error('The file is empty.');
      format = detectFormat(sample);
      if (format.source === 'unknown') throw new Error(`Could not recognise this file. ${format.notes.join(' ')} Columns seen: ${Object.keys(sample[0] ?? {}).slice(0, 12).join(', ')}`);
      normalize = createNormalizer(format);
      row.source = format.source; row.format_label = format.label; row.status = 'running';
      await query(`update imports set status = 'running', source = $2, format_label = $3, format_columns = $4 where id = $1`, [id, format.source, format.label, JSON.stringify(format.columns)]);
      let i = 0;
      for (const p of pending) { i++; if (i <= row.checkpoint_row) continue; handle(p.row); row.rows_processed++; }
    }
    await flush(true);

    const def = row.source && row.source !== 'unknown' ? SOURCES[row.source] : null;
    const limits = def?.exportRowLimit ? [def.exportRowLimit, ...(row.source === 'purview' ? [1_000_000] : [])] : [];
    if (limits.some((l) => Math.abs(rowIndex - l) <= 1)) warnings.unshift(`This file has exactly ${rowIndex.toLocaleString()} rows, which is an export limit for ${def!.label}. The search that produced it probably had more results — split the date range and export again.`);
    if (row.rows_failed) warnings.unshift(`${row.rows_failed} row(s) could not be normalised; they are listed below.`);
    if (resuming) warnings.unshift(`Resumed from row ${row.checkpoint_row.toLocaleString()} after a restart.`);

    await refreshInventories(row.workspace_id, id);
    await query(`update imports set status = 'completed', finished_at = now(), rows_total = $2, warnings = $3 where id = $1`, [id, rowIndex, JSON.stringify(warnings.slice(0, 60))]);
    row.status = 'completed';
    emit(row, 'completed');
    // Detections run after the import is visible; failures never fail the import.
    runSignals(row.workspace_id).catch((e) => console.error('signals failed', e));
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === '__cancelled') {
      await query(`update imports set status = 'cancelled', finished_at = now() where id = $1`, [id]);
      emit(row, 'cancelled');
      return;
    }
    console.error(`import ${id} failed:`, e);
    await query(`update imports set status = 'failed', finished_at = now(), error = $2, warnings = $3 where id = $1`, [id, msg, JSON.stringify(warnings.slice(0, 60))]);
    emit(row, 'failed', { error: msg });
  }
}

/** Upsert per-person and per-operation inventories from the rows this import added. */
export async function refreshInventories(workspaceId: string, importId: string | null): Promise<void> {
  const scope = importId ? 'and e.import_id = $2' : '';
  const params = importId ? [workspaceId, importId] : [workspaceId];
  await query(`
    insert into identities (workspace_id, upn, kind, first_seen, last_seen, events, failed, sign_ins, sensitive_events, ip_count, countries, sources, updated_at)
    select e.workspace_id, e.user_upn,
           case when e.user_upn like '%#ext#%' then 'guest'
                when e.user_upn not like '%@%' then 'system'
                when e.user_upn ~ '^[0-9a-f]{8}-[0-9a-f]{4}-' then 'service'
                else 'member' end,
           min(e.ts), max(e.ts), count(*), count(*) filter (where e.failed), count(*) filter (where e.kind = 'signin'),
           count(*) filter (where e.sensitive_family is not null), count(distinct e.client_ip),
           coalesce(array_agg(distinct e.ip_country) filter (where e.ip_country is not null), '{}'),
           array_agg(distinct e.source), now()
      from events e where e.workspace_id = $1 ${scope} and e.user_upn is not null
     group by e.workspace_id, e.user_upn
    on conflict (workspace_id, upn) do update set
      first_seen = least(identities.first_seen, excluded.first_seen),
      last_seen = greatest(identities.last_seen, excluded.last_seen),
      events = identities.events + excluded.events,
      failed = identities.failed + excluded.failed,
      sign_ins = identities.sign_ins + excluded.sign_ins,
      sensitive_events = identities.sensitive_events + excluded.sensitive_events,
      ip_count = greatest(identities.ip_count, excluded.ip_count),
      countries = (select coalesce(array_agg(distinct c), '{}') from unnest(identities.countries || excluded.countries) c),
      sources = (select coalesce(array_agg(distinct s), '{}') from unnest(identities.sources || excluded.sources) s),
      updated_at = now()`, params);
  await query(`
    insert into discovered_operations (workspace_id, source, workload, record_type, operation, operation_key, events, first_seen, last_seen)
    select e.workspace_id, e.source, min(e.workload), e.record_type, min(e.operation), e.operation_key, count(*), min(e.ts), max(e.ts)
      from events e where e.workspace_id = $1 ${scope}
     group by e.workspace_id, e.source, e.record_type, e.operation_key
    on conflict (workspace_id, source, operation_key, record_type_key) do update set
      events = discovered_operations.events + excluded.events,
      first_seen = least(discovered_operations.first_seen, excluded.first_seen),
      last_seen = greatest(discovered_operations.last_seen, excluded.last_seen)`, params);
  // Exact counters after deletes: when called without an import, rebuild from scratch.
  if (!importId) {
    await query(`delete from identities i where workspace_id = $1 and not exists (select 1 from events e where e.workspace_id = $1 and e.user_upn = i.upn)`, [workspaceId]);
  }
}

/** Full rebuild (used after deleting an import). */
export async function rebuildInventories(workspaceId: string): Promise<void> {
  await query('delete from identities where workspace_id = $1', [workspaceId]);
  await query('delete from discovered_operations where workspace_id = $1', [workspaceId]);
  await refreshInventories(workspaceId, null);
}
