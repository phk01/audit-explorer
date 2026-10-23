import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, one, camel } from '../lib/db.js';
import { hashPassword, verifyPassword, createSession, setSessionCookie, clearSessionCookie, destroySession, requireAuth } from '../lib/auth.js';
import type { User } from '@audit/core';

const USER_COLS = 'id, email, name, role, created_at, last_login_at';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const row = await one<Record<string, unknown>>(`select ${USER_COLS}, password_hash from users where email = $1`, [body.email.toLowerCase()]);
    if (!row || !(await verifyPassword(row.password_hash as string, body.password))) {
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Email or password is incorrect.' });
    }
    const s = await createSession(row.id as string, req);
    setSessionCookie(reply, s.id, s.expiresAt);
    delete row.password_hash;
    return camel<User>(row);
  });

  app.post('/auth/logout', async (req, reply) => {
    await destroySession(req);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated', message: 'Sign in required.' });
    return req.user;
  });

  app.post('/auth/password', { preHandler: requireAuth() }, async (req, reply) => {
    const body = z.object({ current: z.string(), next: z.string().min(10) }).parse(req.body);
    const row = await one<{ password_hash: string }>('select password_hash from users where id = $1', [req.user!.id]);
    if (!row || !(await verifyPassword(row.password_hash, body.current))) return reply.code(400).send({ error: 'bad_password', message: 'Current password is incorrect.' });
    await query('update users set password_hash = $2 where id = $1', [req.user!.id, await hashPassword(body.next)]);
    return { ok: true };
  });

  // --- user administration ---
  app.get('/users', { preHandler: requireAuth(['admin']) }, async () => (await query<Record<string, unknown>>(`select ${USER_COLS} from users order by created_at`)).map((r) => camel<User>(r)));

  app.post('/users', { preHandler: requireAuth(['admin']) }, async (req, reply) => {
    const body = z.object({ email: z.string().email(), name: z.string().min(1), role: z.enum(['admin', 'analyst']).default('analyst'), password: z.string().min(10) }).parse(req.body);
    const exists = await one('select 1 from users where email = $1', [body.email.toLowerCase()]);
    if (exists) return reply.code(409).send({ error: 'exists', message: 'A user with that email already exists.' });
    const row = await one<Record<string, unknown>>(`insert into users(email, name, role, password_hash) values ($1,$2,$3,$4) returning ${USER_COLS}`, [body.email.toLowerCase(), body.name, body.role, await hashPassword(body.password)]);
    return camel<User>(row!);
  });

  app.patch('/users/:id', { preHandler: requireAuth(['admin']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(1).optional(), role: z.enum(['admin', 'analyst']).optional(), password: z.string().min(10).optional() }).parse(req.body);
    if (body.name) await query('update users set name = $2 where id = $1', [id, body.name]);
    if (body.role) await query('update users set role = $2 where id = $1', [id, body.role]);
    if (body.password) { await query('update users set password_hash = $2 where id = $1', [id, await hashPassword(body.password)]); await query('delete from sessions where user_id = $1', [id]); }
    const row = await one<Record<string, unknown>>(`select ${USER_COLS} from users where id = $1`, [id]);
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'User not found.' });
    return camel<User>(row);
  });

  app.delete('/users/:id', { preHandler: requireAuth(['admin']) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === req.user!.id) return reply.code(400).send({ error: 'self', message: 'You cannot delete your own account.' });
    await query('delete from users where id = $1', [id]);
    return { ok: true };
  });
}
