/** ISO 3166-1 alpha-2 → English short name (Intl.DisplayNames when available, with a fallback map). */
const FALLBACK: Record<string, string> = {
  AD: 'Andorra', AE: 'United Arab Emirates', AF: 'Afghanistan', AL: 'Albania', AM: 'Armenia', AO: 'Angola', AR: 'Argentina', AT: 'Austria', AU: 'Australia', AZ: 'Azerbaijan',
  BA: 'Bosnia and Herzegovina', BD: 'Bangladesh', BE: 'Belgium', BG: 'Bulgaria', BH: 'Bahrain', BR: 'Brazil', BY: 'Belarus', CA: 'Canada', CH: 'Switzerland', CL: 'Chile',
  CN: 'China', CO: 'Colombia', CY: 'Cyprus', CZ: 'Czechia', DE: 'Germany', DK: 'Denmark', DZ: 'Algeria', EE: 'Estonia', EG: 'Egypt', ES: 'Spain', FI: 'Finland', FR: 'France',
  GB: 'United Kingdom', GE: 'Georgia', GH: 'Ghana', GR: 'Greece', HK: 'Hong Kong', HR: 'Croatia', HU: 'Hungary', ID: 'Indonesia', IE: 'Ireland', IL: 'Israel', IN: 'India',
  IQ: 'Iraq', IR: 'Iran', IS: 'Iceland', IT: 'Italy', JO: 'Jordan', JP: 'Japan', KE: 'Kenya', KR: 'South Korea', KW: 'Kuwait', KZ: 'Kazakhstan', LB: 'Lebanon', LT: 'Lithuania',
  LU: 'Luxembourg', LV: 'Latvia', MA: 'Morocco', MD: 'Moldova', MT: 'Malta', MX: 'Mexico', MY: 'Malaysia', NG: 'Nigeria', NL: 'Netherlands', NO: 'Norway', NP: 'Nepal',
  NZ: 'New Zealand', PE: 'Peru', PH: 'Philippines', PK: 'Pakistan', PL: 'Poland', PT: 'Portugal', QA: 'Qatar', RO: 'Romania', RS: 'Serbia', RU: 'Russia', SA: 'Saudi Arabia',
  SE: 'Sweden', SG: 'Singapore', SI: 'Slovenia', SK: 'Slovakia', TH: 'Thailand', TN: 'Tunisia', TR: 'Türkiye', TW: 'Taiwan', UA: 'Ukraine', US: 'United States', UZ: 'Uzbekistan',
  VE: 'Venezuela', VN: 'Vietnam', ZA: 'South Africa',
};

let dn: Intl.DisplayNames | null = null;
try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { dn = null; }

export function countryName(cc: string | null | undefined): string {
  if (!cc) return 'Unknown';
  const c = cc.toUpperCase();
  if (c.length !== 2) return c;
  try { const n = dn?.of(c); if (n && n !== c) return n; } catch { /* ignore */ }
  return FALLBACK[c] ?? c;
}
