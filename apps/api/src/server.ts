import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ZodError } from 'zod';
import { config } from './lib/config.js';
import { migrate, pool } from './lib/db.js';
import { userFromRequest, bootstrapAdmin } from './lib/auth.js';
import { resumeInterruptedImports } from './lib/importer.js';
import { authRoutes } from './routes/auth.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { eventRoutes } from './routes/events.js';
import { importRoutes } from './routes/imports.js';
import { peopleRoutes } from './routes/people.js';
import { coverageRoutes } from './routes/coverage.js';

export async function buildServer() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: config.trustProxy,
    bodyLimit: 10 * 1024 * 1024,
    disableRequestLogging: config.isProd,
  });

  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { files: 50, fileSize: config.MAX_UPLOAD_MB * 1024 * 1024 } });
  if (!config.isProd) await app.register(cors, { origin: config.corsOrigins, credentials: true });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => { req.user = await userFromRequest(req); });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'validation', message: 'Invalid request.', details: err.issues });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err as Error);
    reply.code(status).send({ error: (err as { code?: string }).code ?? 'error', message: status >= 500 && config.isProd ? 'Internal error.' : (err as Error).message });
  });

  app.get('/api/health', async () => {
    await pool.query('select 1');
    return { ok: true, version: process.env.APP_VERSION ?? 'dev', time: new Date().toISOString() };
  });

  await app.register(async (api) => {
    await api.register(authRoutes);
    await api.register(workspaceRoutes);
    await api.register(eventRoutes);
    await api.register(importRoutes);
    await api.register(peopleRoutes);
    await api.register(coverageRoutes);
  }, { prefix: '/api' });

  // Production: serve the built SPA from the same origin (no CORS, one container).
  const dist = config.WEB_DIST ? resolve(config.WEB_DIST) : null;
  if (dist && existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: '/', wildcard: false, maxAge: '1h', immutable: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found', message: 'No such route.' });
      return reply.sendFile('index.html', dist, { maxAge: 0 });
    });
    app.addHook('onSend', async (req, reply, payload) => {
      if (!req.url.startsWith('/api/')) {
        reply.header('x-content-type-options', 'nosniff');
        reply.header('referrer-policy', 'no-referrer');
        reply.header('x-frame-options', 'DENY');
        reply.header('x-robots-tag', 'noindex, nofollow');
        reply.header('content-security-policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'");
      }
      return payload;
    });
  }
  return app;
}

async function main() {
  await mkdir(join(config.dataDir, 'imports'), { recursive: true });
  await migrate();
  const app = await buildServer();
  await bootstrapAdmin(app);
  await app.listen({ port: config.PORT, host: config.HOST });
  await resumeInterruptedImports();
  const shutdown = async () => { await app.close(); await pool.end(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
