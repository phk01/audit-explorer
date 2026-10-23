import { z } from 'zod';
import { resolve } from 'node:path';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@127.0.0.1:5432/audit_explorer'),
  /** Where uploaded evidence files are kept (immutable originals). */
  DATA_DIR: z.string().default('./data'),
  /** Secret for session cookies; generate with `openssl rand -hex 32`. */
  SESSION_SECRET: z.string().min(16).default('dev-only-session-secret-change-me'),
  SESSION_TTL_HOURS: z.coerce.number().default(24 * 14),
  /** First admin, created at startup if no users exist. */
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_NAME: z.string().default('Administrator'),
  /** Comma-separated allowed origins for CORS (dev only; in production the web app is served by the API). */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Serve the built web app from this directory when set (production). */
  WEB_DIST: z.string().optional(),
  /** Max upload size in MB. */
  MAX_UPLOAD_MB: z.coerce.number().default(2048),
  /** Secure cookies (set to false only behind plain HTTP in a lab). */
  COOKIE_SECURE: z.string().default('auto'),
  /** Trust X-Forwarded-* headers from the reverse proxy. */
  TRUST_PROXY: z.string().default('true'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.parse(process.env);

export const config = {
  ...parsed,
  dataDir: resolve(parsed.DATA_DIR),
  isProd: parsed.NODE_ENV === 'production',
  corsOrigins: parsed.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  cookieSecure: parsed.COOKIE_SECURE === 'auto' ? parsed.NODE_ENV === 'production' : parsed.COOKIE_SECURE === 'true',
  trustProxy: parsed.TRUST_PROXY !== 'false',
};
export type Config = typeof config;
