// Builds data/geo.json from the upstream CC0 dataset (npm: @ip-location-db/geo-whois-asn-country).
// Encoding: base64 of [varint(delta of range start), cc index byte]* — gaps between ranges get index 255.
// IPv4 starts are 32-bit numbers; IPv6 starts are the top 64 bits. Country list + centroids come from data/countries.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const out = join(dataDir, 'geo.json');
if (existsSync(out) && !process.argv.includes('--force')) { console.log('geo.json present, skipping (use --force to rebuild)'); process.exit(0); }

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@ip-location-db/geo-whois-asn-country/package.json'));
const version = require('@ip-location-db/geo-whois-asn-country/package.json').version;
const { cc: CC, nm } = JSON.parse(readFileSync(join(dataDir, 'countries.json'), 'utf8'));
const idx = new Map(CC.map((c, i) => [c, i]));

function encode(csv, big) {
  const bytes = [];
  const varint = (n) => { // n: bigint
    while (n >= 128n) { bytes.push(Number(n & 127n) | 128); n >>= 7n; }
    bytes.push(Number(n));
  };
  let prev = 0n, expectedNext = null;
  for (const line of csv.split('\n')) {
    if (!line) continue;
    const [s, e, c] = line.split(',');
    let start = BigInt(s), end = BigInt(e);
    if (big) { start >>= 64n; end >>= 64n; }
    if (expectedNext != null && start > expectedNext) { varint(expectedNext - prev); bytes.push(255); prev = expectedNext; }
    if (start < prev) continue; // overlapping /64 after truncation
    const ci = idx.get(c.trim());
    varint(start - prev); bytes.push(ci == null ? 255 : ci); prev = start;
    expectedNext = end + 1n;
  }
  return Buffer.from(bytes).toString('base64');
}

const v4 = encode(readFileSync(join(pkgDir, 'geo-whois-asn-country-ipv4-num.csv'), 'utf8'), false);
const v6 = encode(readFileSync(join(pkgDir, 'geo-whois-asn-country-ipv6-num.csv'), 'utf8'), true);
writeFileSync(out, JSON.stringify({ src: `ip-location-db geo-whois-asn-country ${version} (CC0)`, cc: CC, v4, v6, nm }));
console.log(`geo.json written (${version}): v4 ${v4.length} chars, v6 ${v6.length} chars`);
