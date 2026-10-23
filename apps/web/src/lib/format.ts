const nf = new Intl.NumberFormat('en-US');

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return nf.format(Math.round(n));
}

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) < 10_000) return nf.format(n);
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

export function fmtPct(part: number, total: number): string {
  if (!total) return '0%';
  const p = (part / total) * 100;
  return p < 1 && p > 0 ? '<1%' : `${Math.round(p)}%`;
}

export function plural(n: number, one: string, many = one + 's'): string { return `${fmtInt(n)} ${n === 1 ? one : many}`; }

export function truncate(s: string | null | undefined, max = 80): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Split a comma list parameter into trimmed values. */
export function splitList(v: string | null | undefined): string[] { return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []; }
export function joinList(v: string[]): string { return v.join(','); }

/** Short, stable label for an IP owner category. */
export const OWNER_SHORT: Record<string, string> = { m365: 'M365', msvc: 'MS svc', azure: 'Azure', msnet: 'MS', keepit: 'Keepit', priv: 'LAN' };
export const OWNER_LONG: Record<string, string> = { m365: 'Microsoft 365', msvc: 'Microsoft service', azure: 'Azure', msnet: 'Microsoft', keepit: 'Keepit', priv: 'Private network' };

export const KIND_LABEL: Record<string, string> = {
  signin: 'Sign-in', dir: 'Directory', admin: 'Admin', mail: 'Mail', file: 'File', teams: 'Teams', msg: 'Message', msgpost: 'Post-delivery',
  click: 'URL click', urlinfo: 'URL info', attachment: 'Attachment', risk: 'Risk', copilot: 'Copilot', other: 'Other',
};

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); resolve(); } catch (e) { reject(e); } finally { ta.remove(); }
  });
}
