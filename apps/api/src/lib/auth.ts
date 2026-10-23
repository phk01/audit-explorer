import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { User, Role } from '@audit/core';
import { query, one, camel } from './db.js';
import { config } from './config.js';

export const SESSION_COOKIE = 'ae_session';

declare module 'fastify' {
  interface FastifyRequest { user: User | null }
}

export async function hashPassword(pw: string): Promise<string> {
  return argon2.hash(pw, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
}

export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  try { return await argon2.verify(hash, pw); } catch { return false; }
}

export async function createSession(userId: string, req: FastifyRequest): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600_000);
  await query('insert into sessions(id, user_id, expires_at, user_agent, ip) values ($1,$2,$3,$4,$5)', [id, userId, expiresAt, req.headers['user-agent'] ?? null, req.ip]);
  await query('update users set last_login_at = now() where id = $1', [userId]);
  return { id, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, id: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires: expiresAt, signed: true });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function userFromRequest(req: FastifyRequest): Promise<User | null> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const un = req.unsignCookie(raw);
  if (!un.valid || !un.value) return null;
  const row = await one<Record<string, unknown>>(
    `select u.id, u.email, u.name, u.role, u.created_at, u.last_login_at
       from sessions s join users u on u.id = s.user_id
      where s.id = $1 and s.expires_at > now()`, [un.value]);
  return row ? camel<User>(row) : null;
}

export async function destroySession(req: FastifyRequest): Promise<void> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return;
  const un = req.unsignCookie(raw);
  if (un.valid && un.value) await query('delete from sessions where id = $1', [un.value]);
}

export function requireAuth(roles?: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthenticated', message: 'Sign in required.' });
    if (roles && !roles.includes(req.user.role)) return reply.code(403).send({ error: 'forbidden', message: 'Insufficient role.' });
  };
}

/** Create the first admin from env if the users table is empty. */
export async function bootstrapAdmin(app: FastifyInstance): Promise<void> {
  const n = await one<{ n: number }>('select count(*)::int as n from users');
  if (n && n.n > 0) return;
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    app.log.warn('No users exist and ADMIN_EMAIL/ADMIN_PASSWORD are not set — nobody can sign in. Set them and restart.');
    return;
  }
  await query('insert into users(email, name, role, password_hash) values ($1,$2,$3,$4)', [config.ADMIN_EMAIL.toLowerCase(), config.ADMIN_NAME, 'admin', await hashPassword(config.ADMIN_PASSWORD)]);
  app.log.info(`Created initial admin ${config.ADMIN_EMAIL}`);
}
