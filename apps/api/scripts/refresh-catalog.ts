/**
 * Refresh the activity catalog from Microsoft's documentation.
 *
 *   pnpm --filter @audit/api catalog:refresh
 *
 * 1. Scrapes https://learn.microsoft.com/en-us/purview/audit-log-activities — every "Friendly name | Operation | Description"
 *    table under its H2/H3 headings — into packages/core/data/activities.learn.json. (The Purview docs have no public
 *    markdown source, so HTML is the only machine-readable form.)
 * 2. Re-parses the AuditLogRecordType enum from the public markdown of the Management Activity API schema and reports
 *    any record types that are missing from packages/core/src/catalog/record-types.ts so they can be added.
 *
 * Needs outbound HTTPS to learn.microsoft.com and raw.githubusercontent.com. Safe to re-run; writes are atomic.
 */
import { writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RECORD_TYPES, workloadGroupFor, type WorkloadGroup } from '@audit/core';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', 'packages', 'core', 'data');
const LEARN = 'https://learn.microsoft.com/en-us/purview/audit-log-activities';
const SCHEMA_RAW = 'https://raw.githubusercontent.com/MicrosoftDocs/office-365-management-api/main/office-365-management-api/office-365-management-activity-api-schema.md';

const decode = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function groupForHeading(h: string): WorkloadGroup {
  const s = h.toLowerCase();
  if (/sharepoint|file and page|folder|sharing|site|list/.test(s)) return 'sharepoint';
  if (/onedrive/.test(s)) return 'onedrive';
  if (/teams|shifts|healthcare/.test(s)) return 'teams';
  if (/exchange|mailbox|email|quarantine|encrypted message/.test(s)) return 'exchange';
  if (/copilot|agent|ai /.test(s)) return 'copilot';
  if (/directory|user administration|group administration|role administration|application administration|azure ad|entra/.test(s)) return 'identity';
  if (/power|dynamics|fabric|dataverse/.test(s)) return 'powerplatform';
  if (/ediscovery|retention|label|dlp|compliance|information barrier|insider risk|disposition|content explorer|data security|posture|communication/.test(s)) return 'purview';
  if (/threat|defender|attack|security/.test(s)) return 'security';
  return workloadGroupFor(null, h) ?? 'other';
}

async function scrapeLearn(): Promise<number> {
  const res = await fetch(LEARN, { headers: { 'user-agent': 'audit-explorer-catalog-refresh/1.0' } });
  if (!res.ok) throw new Error(`Learn fetch failed: ${res.status}`);
  const html = await res.text();
  // Walk the main content in document order: remember the latest heading, parse every table under it.
  const main = html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));
  const tokens = main.split(/(?=<h[23][^>]*>)|(?=<table)/);
  let heading = '';
  const out: { operation: string; friendlyName: string; description: string; group: WorkloadGroup; source: string; section: string }[] = [];
  for (const tok of tokens) {
    if (/^<h[23]/.test(tok)) { heading = decode(tok.match(/<h[23][^>]*>(.*?)<\/h[23]>/s)?.[1] ?? ''); continue; }
    if (!tok.startsWith('<table')) continue;
    const table = tok.slice(0, tok.indexOf('</table>'));
    const headerCells = [...(table.match(/<th[^>]*>.*?<\/th>/gs) ?? [])].map(decode).map((x) => x.toLowerCase());
    const iFriendly = headerCells.findIndex((h) => h.includes('friendly')), iOp = headerCells.findIndex((h) => h === 'operation' || h.includes('operation')), iDesc = headerCells.findIndex((h) => h.includes('description'));
    if (iOp < 0) continue;
    for (const tr of table.match(/<tr[^>]*>.*?<\/tr>/gs) ?? []) {
      const cells = [...(tr.match(/<td[^>]*>.*?<\/td>/gs) ?? [])].map(decode);
      if (!cells.length) continue;
      const operation = cells[iOp];
      if (!operation) continue;
      for (const op of operation.split(/,\s*|\s+or\s+/).map((s) => s.trim()).filter((s) => s && !/\s{2,}/.test(s))) {
        out.push({ operation: op, friendlyName: iFriendly >= 0 ? cells[iFriendly] ?? op : op, description: iDesc >= 0 ? cells[iDesc] ?? '' : '', group: groupForHeading(heading), source: 'learn.microsoft.com/purview/audit-log-activities', section: heading });
      }
    }
  }
  if (out.length < 200) throw new Error(`Only ${out.length} activities parsed from Learn — page layout probably changed; not overwriting.`);
  const file = join(dataDir, 'activities.learn.json');
  writeFileSync(file + '.tmp', JSON.stringify({ generatedAt: new Date().toISOString(), source: LEARN, activities: out }, null, 0));
  renameSync(file + '.tmp', file);
  return out.length;
}

async function checkRecordTypes(): Promise<void> {
  const res = await fetch(SCHEMA_RAW);
  if (!res.ok) throw new Error(`schema fetch failed: ${res.status}`);
  const md = await res.text();
  const start = md.indexOf('### Enum: AuditLogRecordType');
  const section = md.slice(start, md.indexOf('\n### ', start + 10));
  const found = new Map<number, string>();
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*\[?(\d+)\]?(?:\([^)]*\))?\s*\|\s*([^|]+?)\s*\|/);
    if (m) found.set(+m[1], m[2].replace(/\s+/g, ' ').trim());
  }
  const known = new Map(RECORD_TYPES.map(([id, n]) => [id, n]));
  const missing = [...found].filter(([id]) => !known.has(id));
  const renamed = [...found].filter(([id, n]) => known.has(id) && known.get(id)!.toLowerCase() !== n.replace(/\s/g, '').toLowerCase() && n.toLowerCase() !== 'viva engage' && n.toLowerCase() !== 'vivainsights (formerly workplaceanalytics)');
  console.log(`record types: ${found.size} in Microsoft's schema, ${known.size} known locally`);
  if (missing.length) {
    console.log('ADD to packages/core/src/catalog/record-types.ts:');
    for (const [id, n] of missing) console.log(`  [${id}, '${n.replace(/\s+/g, '')}'],`);
  }
  if (renamed.length) { console.log('renamed upstream (review):'); for (const [id, n] of renamed) console.log(`  ${id}: ${known.get(id)} -> ${n}`); }
  if (!missing.length && !renamed.length) console.log('record types are up to date');
}

let failures = 0;
try { const n = await scrapeLearn(); console.log(`activities.learn.json written with ${n} operations`); }
catch (e) { failures++; console.error(`Learn scrape failed: ${(e as Error).message}`); }
try { await checkRecordTypes(); }
catch (e) { failures++; console.error(`record type check failed: ${(e as Error).message}`); }
process.exit(failures ? 1 : 0);
