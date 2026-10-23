import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { Import, ImportProgressEvent } from '@audit/core';
import { query, one, camel } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { enqueueImport, cancelImport, importEvents, rebuildInventories } from '../lib/importer.js';
import { loadWorkspace } from '../lib/workspace.js';

const ACCEPTED = /\.(csv|json|jsonl|ndjson|txt)$/i;

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth());

  app.get('/workspaces/:id/imports', async (req) => {
    const { id } = req.params as { id: string };
    return (await query<Record<string, unknown>>('select * from imports where workspace_id = $1 order by created_at desc limit 500', [id])).map((r) => { delete r.file_path; delete r.format_columns; return camel<Import>(r); });
  });

  /**
   * Multipart upload of one or more files. Each file is streamed to DATA_DIR/<workspace>/<import>.<ext>
   * while its SHA-256 is computed; identical files already imported into the workspace are skipped.
   */
  app.post('/workspaces/:id/imports', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await loadWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const force = (req.query as { force?: string }).force === '1';
    const dir = join(config.dataDir, 'imports', id);
    await mkdir(dir, { recursive: true });
    const created: Import[] = [];
    const skipped: { fileName: string; reason: string }[] = [];

    for await (const part of req.files({ limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024 } })) {
      const fileName = part.filename || 'upload';
      if (!ACCEPTED.test(fileName)) { skipped.push({ fileName, reason: 'Only .csv, .json, .jsonl and .txt exports are accepted.' }); await part.toBuffer().catch(() => {}); continue; }
      const tmp = join(dir, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}.part`);
      const hash = createHash('sha256');
      let size = 0;
      const tap = new Transform({ transform(chunk, _e, cb) { hash.update(chunk); size += chunk.length; cb(null, chunk); } });
      await pipeline(part.file, tap, createWriteStream(tmp));
      if (part.file.truncated) { await unlink(tmp).catch(() => {}); skipped.push({ fileName, reason: `Larger than the ${config.MAX_UPLOAD_MB} MB upload limit.` }); continue; }
      const sha = hash.digest('hex');
      if (!force) {
        const dup = await one<{ id: string; file_name: string; status: string }>(`select id, file_name, status from imports where workspace_id = $1 and sha256 = $2 and status <> 'failed' limit 1`, [id, sha]);
        if (dup) { await unlink(tmp).catch(() => {}); skipped.push({ fileName, reason: `Identical to "${dup.file_name}" which is already imported (${dup.status}).` }); continue; }
      }
      const row = await one<Record<string, unknown>>(
        `insert into imports(workspace_id, file_name, file_path, file_size, sha256, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
        [id, fileName, tmp, size, sha, req.user!.id]);
      const ext = (fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
      const finalPath = join(dir, `${row!.id as string}${ext}`);
      await rename(tmp, finalPath);
      await query('update imports set file_path = $2 where id = $1', [row!.id, finalPath]);
      delete row!.file_path;
      created.push(camel<Import>(row!));
      enqueueImport(row!.id as string);
    }
    return { created, skipped };
  });

  app.get('/imports/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await one<Record<string, unknown>>('select * from imports where id = $1', [id]);
    if (!r) return reply.code(404).send({ error: 'not_found', message: 'Import not found.' });
    delete r.file_path;
    return camel<Import>(r);
  });

  app.post('/imports/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await one<{ status: string }>('select status from imports where id = $1', [id]);
    if (!r) return reply.code(404).send({ error: 'not_found', message: 'Import not found.' });
    cancelImport(id);
    if (r.status === 'queued') await query(`update imports set status = 'cancelled', finished_at = now() where id = $1`, [id]);
    return { ok: true };
  });

  /** Re-run a failed or cancelled import from its checkpoint. */
  app.post('/imports/:id/retry', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await one<{ status: string; file_path: string }>('select status, file_path from imports where id = $1', [id]);
    if (!r) return reply.code(404).send({ error: 'not_found', message: 'Import not found.' });
    try { await stat(r.file_path); } catch { return reply.code(410).send({ error: 'file_gone', message: 'The uploaded file is no longer on disk; upload it again.' }); }
    await query(`update imports set status = 'queued', error = null, finished_at = null where id = $1`, [id]);
    enqueueImport(id);
    return { ok: true };
  });

  /** Delete an import and every event it produced; people/operation inventories are rebuilt. */
  app.delete('/imports/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await one<{ workspace_id: string; file_path: string; status: string }>('select workspace_id, file_path, status from imports where id = $1', [id]);
    if (!r) return reply.code(404).send({ error: 'not_found', message: 'Import not found.' });
    cancelImport(id);
    await query('delete from imports where id = $1', [id]);
    await unlink(r.file_path).catch(() => {});
    await rebuildInventories(r.workspace_id);
    return { ok: true };
  });

  /** Server-sent events with live progress for all imports in a workspace. */
  app.get('/workspaces/:id/imports/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    reply.raw.write(': connected\n\n');
    const onProgress = (ev: ImportProgressEvent) => { if (ev.workspaceId === id) reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`); };
    importEvents.on('progress', onProgress);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20000);
    req.raw.on('close', () => { importEvents.off('progress', onProgress); clearInterval(ping); });
    await new Promise(() => { /* keep open until the client disconnects */ });
  });
}
