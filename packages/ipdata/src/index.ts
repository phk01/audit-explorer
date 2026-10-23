/**
 * Offline IP enrichment.
 *
 *  - Country lookup from the CC0 "geo-whois-asn-country" table (sapics/ip-location-db),
 *    stored as varint delta-encoded range starts (data/geo.json).
 *  - Owner classification against Microsoft 365 published endpoints, Azure service tags,
 *    the Microsoft backbone ASN set and Keepit (M365 backup vendor) ranges (data/msip.json).
 *
 * Both tables are loaded lazily on first use so importing this module is cheap.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type IpOwnerCategory = 'm365' | 'msvc' | 'azure' | 'msnet' | 'keepit' | 'priv';

export interface IpOwner {
  category: IpOwnerCategory;
  name: string;
}

export interface IpEnrichment {
  country: string | null; // ISO 3166-1 alpha-2
  owner: IpOwner | null;
}

export const OWNER_LABEL: Record<IpOwnerCategory, string> = {
  keepit: 'Keepit',
  m365: 'Microsoft 365',
  msvc: 'Microsoft service',
  azure: 'Azure',
  msnet: 'Microsoft',
  priv: 'Private',
};

/** Owner categories that should not count as "where the user was" for location-based logic. */
export const NON_GEO_OWNERS: ReadonlySet<IpOwnerCategory> = new Set(['m365', 'msvc', 'msnet', 'keepit', 'priv']);

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

interface GeoFile { src: string; cc: string[]; v4: string; v6: string; nm: Record<string, [string, number, number]> }
interface MsipFile { asOf: string; tagsChange: number; g: [IpOwnerCategory, string, string, string][] }

// ---------- address parsing ----------

export function v4ToInt(ip: string): number | null {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    if (!/^\d+$/.test(x)) return null;
    const v = +x;
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** Top 64 bits of an IPv6 address as a bigint (null if not IPv6). */
export function v6Top(ipIn: string): bigint | null {
  const ip = String(ipIn).split('%')[0];
  if (!ip.includes(':') || ip.includes('.')) return null;
  const [a, b] = ip.split('::');
  const h = a ? a.split(':') : [];
  const t = b != null && b ? b.split(':') : [];
  if (b == null && h.length !== 8) return null;
  const fill = 8 - h.length - t.length;
  if (fill < 0) return null;
  const all = [...h, ...Array(b != null ? fill : 0).fill('0'), ...t];
  let x = 0n;
  for (let i = 0; i < 4; i++) {
    const v = parseInt(all[i] || '0', 16);
    if (Number.isNaN(v)) return null;
    x = (x << 16n) | BigInt(v);
  }
  return x;
}

/** Strip ports / IPv4-mapped prefixes: "[2001:db8::1]:443" -> "2001:db8::1", "1.2.3.4:5" -> "1.2.3.4". */
export function cleanIp(raw: unknown): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const m6 = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (m6) s = m6[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));
  if (s.toLowerCase().startsWith('::ffff:') && s.includes('.')) s = s.slice(7);
  return s;
}

// ---------- geo ----------

interface GeoIndex { v4: { st: Float64Array; cc: Uint8Array }; v6: { st: BigUint64Array; cc: Uint8Array } }
let geo: GeoFile | null = null;
let geoIdx: GeoIndex | null = null;

function loadGeo(): void {
  if (geo) return;
  geo = JSON.parse(readFileSync(join(dataDir, 'geo.json'), 'utf8')) as GeoFile;
  const decode = (b64: string, big: boolean) => {
    const bin = Buffer.from(b64, 'base64');
    const n = bin.length;
    let i = 0;
    if (!big) {
      const st: number[] = [];
      const cc: number[] = [];
      let prev = 0;
      while (i < n) {
        let d = 0, mul = 1, x: number;
        do { x = bin[i++]; d += (x & 127) * mul; mul *= 128; } while (x & 128);
        prev += d; st.push(prev); cc.push(bin[i++]);
      }
      return { st: Float64Array.from(st), cc: Uint8Array.from(cc) };
    }
    const st: bigint[] = [];
    const cc: number[] = [];
    let prev = 0n;
    const MAX = (1n << 64n) - 1n;
    while (i < n) {
      let d = 0n, sh = 0n, x: number;
      do { x = bin[i++]; d |= BigInt(x & 127) << sh; sh += 7n; } while (x & 128);
      prev += d; st.push(prev > MAX ? MAX : prev); cc.push(bin[i++]);
    }
    return { st: BigUint64Array.from(st), cc: Uint8Array.from(cc) };
  };
  geoIdx = { v4: decode(geo.v4, false) as GeoIndex['v4'], v6: decode(geo.v6, true) as GeoIndex['v6'] };
}

function bsearch<T extends number | bigint>(arr: ArrayLike<T>, x: T): number {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= x) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  return ans;
}

const geoCache = new Map<string, string | null>();

export function countryOf(ipRaw: string | null | undefined): string | null {
  const ip = cleanIp(ipRaw);
  if (!ip) return null;
  const hit = geoCache.get(ip);
  if (hit !== undefined) return hit;
  loadGeo();
  let cc: string | null = null;
  const n = v4ToInt(ip);
  if (n != null) {
    const r = bsearch(geoIdx!.v4.st, n);
    if (r >= 0 && geoIdx!.v4.cc[r] !== 255) cc = geo!.cc[geoIdx!.v4.cc[r]];
  } else {
    const x = v6Top(ip);
    if (x != null) {
      const r = bsearch(geoIdx!.v6.st, x);
      if (r >= 0 && geoIdx!.v6.cc[r] !== 255) cc = geo!.cc[geoIdx!.v6.cc[r]];
    }
  }
  if (geoCache.size > 200_000) geoCache.clear();
  geoCache.set(ip, cc);
  return cc;
}

export function countryName(cc: string | null | undefined): string {
  if (!cc) return '';
  loadGeo();
  return geo!.nm[cc]?.[0] ?? cc;
}

/** Great-circle distance between two country centroids in km, or null if unknown. */
export function countryDistanceKm(a: string, b: string): number | null {
  loadGeo();
  const A = geo!.nm[a], B = geo!.nm[b];
  if (!A || !B) return null;
  const R = 6371, toR = (x: number) => (x * Math.PI) / 180;
  const dLat = toR(B[1] - A[1]), dLon = toR(B[2] - A[2]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(A[1])) * Math.cos(toR(B[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function geoSource(): string { loadGeo(); return geo!.src; }

// ---------- owner ----------

interface OwnerDb {
  v4: Map<string, number>;
  v6: Map<string, number>;
  svc: { cat: IpOwnerCategory; name: string; p: number }[];
  l4: number[];
  l6: number[];
  asOf: string;
}
let ownerDb: OwnerDb | null = null;
const PREC: Record<IpOwnerCategory, number> = { keepit: 0, m365: 0, msvc: 1, azure: 2, msnet: 3, priv: 9 };

function loadOwner(): OwnerDb {
  if (ownerDb) return ownerDb;
  const f = JSON.parse(readFileSync(join(dataDir, 'msip.json'), 'utf8')) as MsipFile;
  const v4 = new Map<string, number>(), v6 = new Map<string, number>();
  const svc: OwnerDb['svc'] = [];
  const l4 = new Set<number>(), l6 = new Set<number>();
  f.g.forEach(([c, n, s4, s6], gi) => {
    svc.push({ cat: c, name: n, p: PREC[c] });
    const put = (m: Map<string, number>, k: string) => {
      const cur = m.get(k);
      if (cur == null || svc[cur].p > svc[gi].p) m.set(k, gi);
    };
    for (const e of s4 ? s4.split(' ') : []) { const [h, l] = e.split('/'); l4.add(+l); put(v4, l + ':' + parseInt(h, 16)); }
    for (const e of s6 ? s6.split(' ') : []) { const [h, l] = e.split('/'); l6.add(+l); put(v6, l + ':' + h); }
  });
  ownerDb = { v4, v6, svc, l4: [...l4].sort((a, b) => b - a), l6: [...l6].sort((a, b) => b - a), asOf: f.asOf };
  return ownerDb;
}

const ownerCache = new Map<string, IpOwner | null>();

export function ownerOf(ipRaw: string | null | undefined): IpOwner | null {
  const ip = cleanIp(ipRaw);
  if (!ip) return null;
  const hit = ownerCache.get(ip);
  if (hit !== undefined) return hit;
  const db = loadOwner();
  let res: IpOwner | null = null;
  const n = v4ToInt(ip);
  if (n != null) {
    if (/^(10\.|192\.168\.|127\.|169\.254\.)/.test(ip) || (n >= 0xac100000 && n <= 0xac1fffff)) {
      res = { category: 'priv', name: 'Private or local network' };
    } else {
      let best: number | null = null;
      for (const l of db.l4) {
        const mask = l === 0 ? 0 : (0xffffffff << (32 - l)) >>> 0;
        const g = db.v4.get(l + ':' + ((n & mask) >>> 0));
        if (g != null && (best == null || db.svc[g].p < db.svc[best].p)) best = g;
      }
      if (best != null) res = { category: db.svc[best].cat, name: db.svc[best].name };
    }
  } else {
    const x = v6Top(ip);
    if (x != null) {
      if (x >> 56n === 0xfdn || x >> 56n === 0xfcn || x >> 54n === 0x3fan || x === 0n) {
        res = { category: 'priv', name: 'Private or local network' };
      } else {
        let best: number | null = null;
        for (const l of db.l6) {
          const sh = 64n - BigInt(l);
          const g = db.v6.get(l + ':' + ((x >> sh) << sh).toString(16));
          if (g != null && (best == null || db.svc[g].p < db.svc[best].p)) best = g;
        }
        if (best != null) res = { category: db.svc[best].cat, name: db.svc[best].name };
      }
    }
  }
  if (ownerCache.size > 200_000) ownerCache.clear();
  ownerCache.set(ip, res);
  return res;
}

export function ownerDataAsOf(): string { return loadOwner().asOf; }

export function enrichIp(ip: string | null | undefined): IpEnrichment {
  return { country: countryOf(ip), owner: ownerOf(ip) };
}

/** /16 for IPv4, /48 for IPv6 — a coarse "network" key for grouping. */
export function networkKey(ipRaw: string): string | null {
  const ip = cleanIp(ipRaw);
  if (!ip) return null;
  const n = v4ToInt(ip);
  if (n != null) return `${n >>> 24}.${(n >>> 16) & 255}.0.0/16`;
  const x = v6Top(ip);
  if (x != null) return ((x >> 16n) << 16n).toString(16) + '/48';
  return null;
}
