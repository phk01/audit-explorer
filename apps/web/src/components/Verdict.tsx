import type { Severity, VerdictLevel } from '@audit/core';
import { StatusPill, type StatusTone } from './Badges';

export const VERDICT: Record<VerdictLevel, { label: string; tone: StatusTone; short: string }> = {
  compromised: { label: 'Likely compromised', tone: 'crit', short: 'Compromised' },
  suspicious: { label: 'Suspicious', tone: 'warn', short: 'Suspicious' },
  clean: { label: 'No signs of compromise', tone: 'ok', short: 'Clean' },
  insufficient: { label: 'Not enough data', tone: 'neutral', short: 'Insufficient data' },
};

/** Small verdict pill used in lists and headers (VerdictLevel → label + colour). */
export function VerdictPill({ level, long }: { level: VerdictLevel | null | undefined; long?: boolean }) {
  if (!level) return <span className="muted small">not checked</span>;
  const v = VERDICT[level] ?? VERDICT.insufficient;
  return <StatusPill tone={v.tone} title={v.label}>{long ? v.label : v.short}</StatusPill>;
}

export function severityTone(s: Severity | 'info' | 'none' | null | undefined): StatusTone {
  switch (s) {
    case 'high': return 'crit';
    case 'medium': return 'warn';
    case 'low': return 'low';
    default: return 'neutral';
  }
}

export function SeverityPill({ severity, quiet }: { severity: Severity | 'none' | null | undefined; quiet?: boolean }) {
  if (!severity || severity === 'none') return <StatusPill tone="neutral">none</StatusPill>;
  if (quiet) return <StatusPill tone="neutral" title={`${severity} severity, but this account is only one of the targets`}>{severity}</StatusPill>;
  return <StatusPill tone={severityTone(severity)}>{severity}</StatusPill>;
}

/** Defender's own verdict string ("Phishing", "Phish", "Malware", "Spam", null) → pill. */
export function DefenderVerdictPill({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return <StatusPill tone="neutral">no Defender verdict</StatusPill>;
  const v = verdict.toLowerCase();
  const tone: StatusTone = /phish|malware|malicious/.test(v) ? 'crit' : /spam|bulk|suspicious/.test(v) ? 'warn' : /clean|none|not/.test(v) ? 'ok' : 'neutral';
  return <StatusPill tone={tone} title="Defender verdict">{verdict}</StatusPill>;
}
