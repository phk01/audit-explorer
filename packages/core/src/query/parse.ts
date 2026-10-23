/**
 * Search query language.
 *
 *   term                 free text (matches any field, including raw JSON)
 *   "quoted phrase"      exact phrase
 *   field:value          field match; globs * and ? allowed; quotes allowed: user:"ann@x.dk"
 *   -term / -field:v     negate
 *   a OR b               groups separated by OR; implicit AND inside a group
 *   Parameters.ForwardTo:*   unknown fields are resolved as paths inside the raw record
 *                            (case-insensitive, walks Name/Value arrays)
 *   ip:10.0.0.0/8        CIDR on ip fields
 *   ts:>2025-01-01       comparison on time (also <, >=, <=)
 */
export type QueryField =
  | 'user' | 'op' | 'ip' | 'wl' | 'group' | 'result' | 'obj' | 'ua' | 'type' | 'id' | 'owner' | 'item' | 'detail'
  | 'kind' | 'country' | 'session' | 'source' | 'mid' | 'nmid' | 'counterpart' | 'import' | 'failed' | 'ts' | 'usertype' | 'correlation' | 'sensitive';

export const FIELD_ALIASES: Record<string, QueryField> = {
  user: 'user', userid: 'user', upn: 'user', actor: 'user',
  op: 'op', operation: 'op', activity: 'op',
  ip: 'ip', clientip: 'ip',
  wl: 'wl', workload: 'wl',
  group: 'group', area: 'group',
  result: 'result', status: 'result',
  obj: 'obj', object: 'obj', objectid: 'obj',
  ua: 'ua', agent: 'ua', client: 'ua', useragent: 'ua',
  type: 'type', recordtype: 'type', rt: 'type',
  id: 'id', recordid: 'id',
  owner: 'owner', ipowner: 'owner', iporg: 'owner',
  item: 'item', subject: 'item', subj: 'item', file: 'item', app: 'item',
  detail: 'detail', details: 'detail',
  kind: 'kind',
  country: 'country', cc: 'country',
  session: 'session', sid: 'session', sessionid: 'session',
  source: 'source', src: 'source', layer: 'source',
  mid: 'mid', messageid: 'mid',
  nmid: 'nmid', networkmessageid: 'nmid',
  counterpart: 'counterpart', to: 'counterpart', from: 'counterpart', target: 'counterpart', recipient: 'counterpart', sender: 'counterpart', mailbox: 'counterpart',
  import: 'import', importid: 'import',
  failed: 'failed',
  ts: 'ts', time: 'ts', date: 'ts',
  usertype: 'usertype',
  correlation: 'correlation', correlationid: 'correlation', cid: 'correlation',
  sensitive: 'sensitive', family: 'sensitive',
};

export interface Term {
  negate: boolean;
  /** Known field, or null for free text. */
  field: QueryField | null;
  /** Raw-record path when the field is unknown (e.g. ["Parameters","ForwardTo"]). */
  path: string[] | null;
  value: string;
  quoted: boolean;
  /** Comparison for ts: terms. */
  cmp?: '>' | '<' | '>=' | '<=';
}

export interface ParsedQuery {
  /** OR of AND-groups. */
  groups: Term[][];
  text: string;
}

const TOKEN_RX = /(-)?(?:([A-Za-z_][\w.\-]*):)?(?:"([^"]*)"|'([^']*)'|(\S+))/g;

export function parseQuery(input: string): ParsedQuery {
  const text = (input ?? '').trim();
  const groups: Term[][] = [[]];
  if (!text) return { groups: [], text };
  TOKEN_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RX.exec(text))) {
    const [, neg, fieldRaw, dq, sq, bare] = m;
    if (!fieldRaw && !neg && (bare === 'OR' || bare === 'or' || bare === '||')) {
      if (groups[groups.length - 1].length) groups.push([]);
      continue;
    }
    if (!fieldRaw && !neg && (bare === 'AND' || bare === 'and' || bare === '&&')) continue;
    let value = dq ?? sq ?? bare ?? '';
    const quoted = dq != null || sq != null;
    if (!value) continue;
    let field: QueryField | null = null;
    let path: string[] | null = null;
    let cmp: Term['cmp'];
    if (fieldRaw) {
      // "https://x" is not a field
      if (/^https?$/i.test(fieldRaw) && bare?.startsWith('//')) { value = fieldRaw + ':' + value; }
      else {
        const k = fieldRaw.toLowerCase().replace(/[-_]/g, '');
        field = FIELD_ALIASES[k] ?? null;
        if (!field) path = fieldRaw.split('.').filter(Boolean);
      }
    }
    if (field === 'ts') {
      const c = value.match(/^(>=|<=|>|<)(.*)$/);
      if (c) { cmp = c[1] as Term['cmp']; value = c[2]; }
    }
    groups[groups.length - 1].push({ negate: !!neg, field, path, value, quoted, cmp });
  }
  return { groups: groups.filter((g) => g.length), text };
}

export function hasGlob(v: string): boolean { return /[*?]/.test(v); }

/** Convert a glob to a SQL LIKE pattern (escaping % and _). */
export function globToLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => '\\' + c).replace(/\*/g, '%').replace(/\?/g, '_');
}

/** Help text shown next to the search box. */
export const QUERY_HELP: { example: string; meaning: string }[] = [
  { example: 'anna@contoso.com', meaning: 'free text — matches any field, including the raw record' },
  { example: 'user:anna* op:new-inboxrule', meaning: 'field filters, globs allowed; several terms are ANDed' },
  { example: 'result:failed OR op:userloginfailed', meaning: 'OR between groups' },
  { example: '-owner:m365 country:RU', meaning: 'negate with a leading minus' },
  { example: 'ip:185.220.0.0/16', meaning: 'CIDR on client IP' },
  { example: 'Parameters.ForwardTo:*', meaning: 'any property inside the raw record, including Name/Value lists' },
  { example: 'LogonError:Invalid* ts:>2026-01-01', meaning: 'raw property glob plus a time bound' },
  { example: 'sensitive:* or sensitive:"inbox rules"', meaning: 'operations in a sensitive family: roles, consent, tenant settings, audit config, inbox rules, forwarding…' },
  { example: 'session:7f3a… kind:mail', meaning: 'pivot on sign-in session; kinds: signin dir admin mail file teams msg click copilot' },
];
