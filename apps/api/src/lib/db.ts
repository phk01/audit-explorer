import pg from 'pg';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';

const { Pool, types } = pg;
// Keep bigint counts as numbers (they fit comfortably) and timestamps as ISO strings.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1184, (v) => new Date(v).toISOString());
types.setTypeParser(1114, (v) => new Date(v + 'Z').toISOString());

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 12, application_name: 'audit-explorer', options: '-c timezone=UTC -c work_mem=64MB' });

pool.on('error', (err) => { console.error('pg pool error', err); });

export type Queryable = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = [], q: Queryable = pool): Promise<T[]> {
  const r = await q.query<T>(text, params as never[]);
  return r.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = [], q: Queryable = pool): Promise<T | null> {
  const rows = await query<T>(text, params, q);
  return rows[0] ?? null;
}

export async function withTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const here = dirname(fileURLToPath(import.meta.url));

/** Apply migrations/*.sql in order, once each. */
export async function migrate(): Promise<void> {
  // src/lib → apps/api/migrations in dev; dist/src/lib → apps/api/migrations (or dist/migrations) in production
  const dir = [join(here, '..', '..', 'migrations'), join(here, '..', '..', '..', 'migrations')].find((d) => existsSync(d));
  if (!dir) throw new Error('migrations directory not found');
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const applied = new Set((await query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(sql);
      await c.query('insert into schema_migrations(name) values ($1)', [f]);
      await c.query('commit');
      console.log(`migration applied: ${f}`);
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    } finally {
      c.release();
    }
  }
}

/** snake_case row → camelCase object. */
export function camel<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  return out as T;
}
