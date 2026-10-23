/**
 * Translate an EventQuery (+ the free-form query language) into a parameterised SQL WHERE clause.
 */
import { parseQuery, hasGlob, globToLike, type EventQuery, type Term, type QueryField } from '@audit/core';
import { v4ToInt, v6Top } from '@audit/ipdata';

export class SqlBuilder {
  params: unknown[] = [];
  add(v: unknown): string { this.params.push(v); return `$${this.params.length}`; }
}

const FIELD_COLUMNS: Record<QueryField, string> = {
  user: 'e.user_upn', op: 'e.operation_key', ip: 'e.client_ip', wl: 'e.workload', group: 'e.workload_group', result: 'e.result',
  obj: 'e.object_id', ua: 'e.user_agent', type: 'e.record_type', id: 'e.source_record_id', owner: 'e.ip_owner', item: 'e.item',
  detail: 'e.detail', kind: 'e.kind', country: 'e.ip_country', session: 'e.session_id', source: 'e.source', mid: 'e.message_id',
  nmid: 'e.network_message_id', counterpart: 'e.counterpart', import: 'e.import_id::text', failed: 'e.failed', ts: 'e.ts',
  usertype: 'e.user_type', correlation: 'e.correlation_id', sensitive: 'e.sensitive_family',
};

/** Columns compared case-insensitively with exact or glob semantics. */
function textMatch(col: string, value: string, b: SqlBuilder): string {
  if (hasGlob(value)) return `${col} ilike ${b.add(globToLike(value))} escape '\\'`;
  return `lower(${col}) = ${b.add(value.toLowerCase())}`;
}

function cidr(col: string, value: string, b: SqlBuilder): string | null {
  const m = value.match(/^(.+)\/(\d{1,3})$/);
  if (!m) return null;
  const [, base, lenS] = m;
  const len = +lenS;
  if (v4ToInt(base) != null && len <= 32) return `(${col} ~ '^\\d+\\.\\d+\\.\\d+\\.\\d+$' and ${col}::inet <<= ${b.add(`${base}/${len}`)}::inet)`;
  if (v6Top(base) != null && len <= 128) return `(${col} like '%:%' and ${col}::inet <<= ${b.add(`${base}/${len}`)}::inet)`;
  return null;
}

function termSql(t: Term, b: SqlBuilder): string {
  let sql: string;
  if (t.path) {
    const p = b.add(t.path);
    sql = t.value === '*' ? `ae_prop(e.raw, ${p}::text[]) is not null` : hasGlob(t.value) ? `ae_prop(e.raw, ${p}::text[]) ilike ${b.add(globToLike(t.value))} escape '\\'` : `lower(ae_prop(e.raw, ${p}::text[])) = ${b.add(t.value.toLowerCase())}`;
  } else if (t.field) {
    const col = FIELD_COLUMNS[t.field];
    switch (t.field) {
      case 'ts': {
        const d = new Date(t.value);
        if (Number.isNaN(d.getTime())) { sql = 'true'; break; }
        const op = t.cmp ?? '>=';
        sql = `e.ts ${op} ${b.add(d.toISOString())}::timestamptz`;
        break;
      }
      case 'failed': sql = /^(1|true|yes)$/i.test(t.value) ? 'e.failed' : 'not e.failed'; break;
      case 'result':
        if (/^fail/i.test(t.value)) sql = 'e.failed';
        else if (/^(succe|ok|success)/i.test(t.value)) sql = 'not e.failed';
        else sql = textMatch(col, t.value, b);
        break;
      case 'ip': sql = cidr(col, t.value, b) ?? textMatch(col, t.value, b); break;
      case 'op': sql = textMatch(col, t.value.toLowerCase().replace(/\.$/, ''), b); break;
      case 'source':
        if (/^a$/i.test(t.value)) sql = `e.layer = 'A'`; else if (/^b$/i.test(t.value)) sql = `e.layer = 'B'`; else sql = textMatch(col, t.value, b);
        break;
      case 'user': case 'counterpart':
        sql = `(${textMatch(col, t.value, b)}${t.field === 'user' && !hasGlob(t.value) ? ` or lower(e.counterpart) = ${b.add(t.value.toLowerCase())}` : ''})`;
        break;
      default:
        sql = t.value === '*' ? `${col} is not null` : textMatch(col, t.value, b);
    }
  } else {
    // free text: tsvector prefix match + ILIKE on the key columns; globs → ILIKE on raw text
    const v = t.value;
    if (hasGlob(v) && !t.quoted) {
      const like = b.add('%' + globToLike(v) + '%');
      sql = `(e.raw::text ilike ${like} escape '\\' or e.user_upn ilike ${like} escape '\\' or e.item ilike ${like} escape '\\')`;
    } else {
      const words = v.split(/\s+/).filter(Boolean).map((w) => w.replace(/[':&|!()<>\\]/g, ' ').trim()).filter(Boolean);
      const tsq = words.length ? words.map((w) => `'${w.replace(/'/g, "''")}':*`).join(' & ') : null;
      const like = b.add('%' + v.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
      const parts = [
        tsq ? `e.search @@ to_tsquery('simple', ${b.add(tsq)})` : null,
        `e.user_upn ilike ${like} escape '\\'`, `e.item ilike ${like} escape '\\'`, `e.detail ilike ${like} escape '\\'`, `e.operation ilike ${like} escape '\\'`,
        `e.client_ip ilike ${like} escape '\\'`, `e.counterpart ilike ${like} escape '\\'`, `e.object_id ilike ${like} escape '\\'`,
        t.quoted || v.length >= 3 ? `e.raw::text ilike ${like} escape '\\'` : null,
      ].filter(Boolean);
      sql = `(${parts.join(' or ')})`;
    }
  }
  return t.negate ? `not coalesce(${sql}, false)` : sql;
}

export interface Exclusions { rules: string[]; microsoft: boolean; keepit: boolean }

export function exclusionSql(ex: Exclusions | null, b: SqlBuilder): string | null {
  if (!ex) return null;
  const parts: string[] = [];
  if (ex.microsoft) parts.push(`e.ip_owner in ('m365','msvc')`);
  if (ex.keepit) parts.push(`e.ip_owner = 'keepit'`);
  for (const line of ex.rules) {
    const raw = line.replace(/#.*/, '').trim();
    if (!raw) continue;
    for (const tok of raw.split(/[\s,;]+/)) {
      if (!tok) continue;
      const c = tok.includes('/') ? cidr('e.client_ip', tok, b) : null;
      if (c) parts.push(c);
      else if (hasGlob(tok)) parts.push(`e.client_ip ilike ${b.add(globToLike(tok))} escape '\\'`);
      else parts.push(`lower(e.client_ip) = ${b.add(tok.toLowerCase())}`);
    }
  }
  return parts.length ? `(e.client_ip is not null and (${parts.join(' or ')}))` : null;
}

export interface Compiled { where: string; params: unknown[]; exclusionClause: string | null }

export function compileQuery(workspaceId: string, q: EventQuery, exclusions: Exclusions | null): Compiled {
  const b = new SqlBuilder();
  const clauses: string[] = [`e.workspace_id = ${b.add(workspaceId)}`];
  const list = (v: string | undefined) => v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

  if (q.from) clauses.push(`e.ts >= ${b.add(new Date(q.from).toISOString())}::timestamptz`);
  if (q.to) clauses.push(`e.ts <= ${b.add(new Date(q.to).toISOString())}::timestamptz`);
  if (q.user) clauses.push(`(${textMatch('e.user_upn', q.user, b)} or ${textMatch('e.counterpart', q.user, b)})`);
  if (q.op) clauses.push(textMatch('e.operation_key', q.op.toLowerCase(), b));
  if (q.ip) clauses.push(cidr('e.client_ip', q.ip, b) ?? textMatch('e.client_ip', q.ip, b));
  const sources = list(q.source); if (sources.length) clauses.push(`e.source = any(${b.add(sources)}::text[])`);
  const groups = list(q.group); if (groups.length) clauses.push(`e.workload_group = any(${b.add(groups)}::text[])`);
  if (q.workload) clauses.push(textMatch('e.workload', q.workload, b));
  const kinds = list(q.kind); if (kinds.length) clauses.push(`e.kind = any(${b.add(kinds)}::text[])`);
  if (q.result === 'failed') clauses.push('e.failed'); else if (q.result === 'succeeded') clauses.push('not e.failed');
  const countries = list(q.country); if (countries.length) clauses.push(`e.ip_country = any(${b.add(countries.map((c) => c.toUpperCase()))}::text[])`);
  const owners = list(q.owner); if (owners.length) clauses.push(`e.ip_owner = any(${b.add(owners)}::text[])`);
  if (q.importId) clauses.push(`e.import_id = ${b.add(q.importId)}::uuid`);
  if (q.session) clauses.push(`e.session_id = ${b.add(q.session)}`);
  if (q.mid) clauses.push(`e.message_id = ${b.add(q.mid.replace(/^<|>$/g, '').toLowerCase())}`);
  if (q.nmid) clauses.push(`e.network_message_id = ${b.add(q.nmid.toLowerCase())}`);
  if (q.sensitive) clauses.push(q.sensitive === '1' || q.sensitive === '*' || q.sensitive === 'true' ? 'e.sensitive_family is not null' : textMatch('e.sensitive_family', q.sensitive, b));

  if (q.q) {
    const parsed = parseQuery(q.q);
    if (parsed.groups.length) {
      const or = parsed.groups.map((g) => '(' + g.map((t) => termSql(t, b)).join(' and ') + ')').join(' or ');
      clauses.push(`(${or})`);
    }
  }
  const ex = q.exclusions === 'off' ? null : exclusionSql(exclusions, b);
  if (ex) clauses.push(`not ${ex}`);
  return { where: clauses.join(' and '), params: b.params, exclusionClause: ex };
}

/** Cursor = "<ts iso>|<id>" for keyset pagination on (ts desc, id desc). */
export function decodeCursor(c: string | undefined): { ts: string | null; id: number } | null {
  if (!c) return null;
  try {
    const [ts, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
    return { ts: ts === 'null' ? null : ts, id: Number(id) };
  } catch { return null; }
}
export function encodeCursor(ts: string | null, id: number): string {
  return Buffer.from(`${ts ?? 'null'}|${id}`).toString('base64url');
}
