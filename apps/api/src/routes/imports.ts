import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rename, unlink, stat, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import type { Import, ImportProgressEvent } from '@audit/core';
import { query, one, camel } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { enqueueImport, cancelImport, importEvents, rebuildInventories } from '../lib/importer.js';
import { loadWorkspace } from '../lib/workspace.js';

const ACCEPTED = /\.(csv|json|jsonl|ndjson|txt)$/i;
/** Chunk size for resumable uploads — comfortably below Cloudflare's 100 MB request limit. */
export const CHUNK_SIZE = 32 * 1024 * 1024;

interface UploadMeta { fileName: string; fileSize: number; userId: string; createdAt: string; received: number }
async function readMeta(workspaceId: string, uploadId: string): Promise<UploadMeta | null> {
  if (!/^[0-9a-f-]{36}$/.test(uploadId)) return null;
  try { return JSON.parse(await readFile(join(config.dataDir, 'uploads', workspaceId, `${uploadId}.json`), 'utf8')) as UploadMeta; } catch { return null; }
}
async function writeMeta(workspaceId: string, uploadId: string, meta: UploadMeta): Promise<void> {
  await writeFile(join(config.dataDir, 'uploads', workspaceId, `${uploadId}.json`), JSON.stringify(meta));
}

/** Shared tail of both upload paths: dedup by hash, create the import row, move the file into place, enqueue. */
async function finalizeUpload(a: { workspaceId: string; fileName: string; tmpPath: string; size: number; sha: string; userId: string; force: boolean }): Promise<{ created: Import } | { skipped: { fileName: string; reason: string } }> {
  if (!a.force) {
    const dup = await one<{ id: string; file_name: string; status: string }>(`select id, file_name, status from imports where workspace_id = $1 and sha256 = $2 and status <> 'failed' limit 1`, [a.workspaceId, a.sha]);
    if (dup) { await unlink(a.tmpPath).catch(() => {}); return { skipped: { fileName: a.fileName, reason: `Identical to "${dup.file_name}" which is already imported (${dup.status}).` } }; }
  }
  const row = await one<Record<string, unknown>>(
    `insert into imports(workspace_id, file_name, file_path, file_size, sha256, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [a.workspaceId, a.fileName, a.tmpPath, a.size, a.sha, a.userId]);
  const ext = (a.fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const finalPath = join(config.dataDir, 'imports', a.workspaceId, `${row!.id as string}${ext}`);
  await rename(a.tmpPath, finalPath);
  await query('update imports set file_path = $2 where id = $1', [row!.id, finalPath]);
  delete row!.file_path;
  enqueueImport(row!.id as string);
  return { created: camel<Import>(row!) };
}

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
      const res = await finalizeUpload({ workspaceId: id, fileName, tmpPath: tmp, size, sha, userId: req.user!.id, force });
      if ('skipped' in res) skipped.push(res.skipped); else created.push(res.created);
    }
    return { created, skipped };
  });

  // ---------- chunked (resumable) uploads: works through proxies with small body limits (Cloudflare: 100 MB) ----------
  app.post('/workspaces/:id/uploads', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ws = await loadWorkspace(id);
    if (!ws) return reply.code(404).send({ error: 'not_found', message: 'Workspace not found.' });
    const body = (req.body ?? {}) as { fileName?: string; fileSize?: number };
    const fileName = String(body.fileName ?? 'upload');
    const fileSize = Number(body.fileSize ?? 0);
    if (!ACCEPTED.test(fileName)) return reply.code(400).send({ error: 'unsupported', message: 'Only .csv, .json, .jsonl and .txt exports are accepted.' });
    if (!Number.isFinite(fileSize) || fileSize <= 0) return reply.code(400).send({ error: 'bad_size', message: 'fileSize is required.' });
    if (fileSize > config.MAX_UPLOAD_MB * 1024 * 1024) return reply.code(413).send({ error: 'too_large', message: `Larger than the ${config.MAX_UPLOAD_MB} MB upload limit.` });
    const uploadId = randomUUID();
    const dir = join(config.dataDir, 'uploads', id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${uploadId}.json`), JSON.stringify({ fileName, fileSize, userId: req.user!.id, createdAt: new Date().toISOString(), received: 0 }));
    await writeFile(join(dir, `${uploadId}.part`), '');
    return { uploadId, chunkSize: CHUNK_SIZE };
  });

  /** Append one chunk. Chunks must arrive in order; the current offset is returned so a client can resume. */
  app.put('/workspaces/:id/uploads/:uploadId/chunks/:index', { bodyLimit: CHUNK_SIZE + 1024 * 1024 }, async (req, reply) => {
    const { id, uploadId, index } = req.params as { id: string; uploadId: string; index: string };
    const meta = await readMeta(id, uploadId);
    if (!meta) return reply.code(404).send({ error: 'not_found', message: 'Upload not found or expired.' });
    const i = Number(index);
    const expectedOffset = i * CHUNK_SIZE;
    if (expectedOffset !== meta.received) {
      if (expectedOffset < meta.received) return { received: meta.received, duplicate: true };
      return reply.code(409).send({ error: 'out_of_order', message: `Expected chunk at offset ${meta.received}.`, received: meta.received });
    }
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) return reply.code(400).send({ error: 'empty', message: 'Empty chunk.' });
    if (meta.received + buf.length > meta.fileSize) return reply.code(400).send({ error: 'overflow', message: 'More data than announced.' });
    await appendFile(join(config.dataDir, 'uploads', id, `${uploadId}.part`), buf);
    meta.received += buf.length;
    await writeMeta(id, uploadId, meta);
    return { received: meta.received };
  });

  app.get('/workspaces/:id/uploads/:uploadId', async (req, reply) => {
    const { id, uploadId } = req.params as { id: string; uploadId: string };
    const meta = await readMeta(id, uploadId);
    if (!meta) return reply.code(404).send({ error: 'not_found', message: 'Upload not found or expired.' });
    return { received: meta.received, fileSize: meta.fileSize, chunkSize: CHUNK_SIZE };
  });

  app.post('/workspaces/:id/uploads/:uploadId/complete', async (req, reply) => {
    const { id, uploadId } = req.params as { id: string; uploadId: string };
    const force = (req.query as { force?: string }).force === '1';
    const meta = await readMeta(id, uploadId);
    if (!meta) return reply.code(404).send({ error: 'not_found', message: 'Upload not found or expired.' });
    if (meta.received !== meta.fileSize) return reply.code(400).send({ error: 'incomplete', message: `Received ${meta.received} of ${meta.fileSize} bytes.`, received: meta.received });
    const part = join(config.dataDir, 'uploads', id, `${uploadId}.part`);
    const hash = createHash('sha256');
    await pipeline(createReadStream(part), new Transform({ transform(c, _e, cb) { hash.update(c); cb(null, c); } }), new Writable({ write(_c, _e, cb) { cb(); } }));
    const sha = hash.digest('hex');
    const dir = join(config.dataDir, 'imports', id);
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `upload-${uploadId}.part`);
    await rename(part, tmp);
    await unlink(join(config.dataDir, 'uploads', id, `${uploadId}.json`)).catch(() => {});
    const res = await finalizeUpload({ workspaceId: id, fileName: meta.fileName, tmpPath: tmp, size: meta.fileSize, sha, userId: req.user!.id, force });
    return 'skipped' in res ? { created: [], skipped: [res.skipped] } : { created: [res.created], skipped: [] };
  });

  app.delete('/workspaces/:id/uploads/:uploadId', async (req) => {
    const { id, uploadId } = req.params as { id: string; uploadId: string };
    await unlink(join(config.dataDir, 'uploads', id, `${uploadId}.part`)).catch(() => {});
    await unlink(join(config.dataDir, 'uploads', id, `${uploadId}.json`)).catch(() => {});
    return { ok: true };
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
