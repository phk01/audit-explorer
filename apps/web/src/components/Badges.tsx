import type { ReactNode } from 'react';
import { SOURCES } from '@core/sources';
import { WORKLOAD_GROUPS } from '@core/workloads';
import { countryName } from '../lib/countries';
import { OWNER_LONG, OWNER_SHORT, KIND_LABEL } from '../lib/format';

export function sourceLabel(id: string | null | undefined): string {
  if (!id) return 'Unknown source';
  return (SOURCES as Record<string, { label: string }>)[id]?.label ?? id;
}
export function sourceShort(id: string | null | undefined): string {
  const map: Record<string, string> = {
    purview: 'Purview', entra_signin: 'Entra sign-in', entra_audit: 'Entra audit', entra_risk: 'Entra risk', message_trace: 'Msg trace',
    defender_email: 'Defender email', defender_url_click: 'Safe Links', defender_url_info: 'URL info', defender_post_delivery: 'ZAP', defender_attachment: 'Attachments',
  };
  return id ? map[id] ?? id : 'Unknown';
}
export function groupLabel(g: string | null | undefined): string {
  if (!g) return '—';
  return (WORKLOAD_GROUPS as Record<string, { label: string }>)[g]?.label ?? g;
}
export function groupShort(g: string | null | undefined): string {
  const map: Record<string, string> = { identity: 'Identity', sharepoint: 'SharePoint', onedrive: 'OneDrive', teams: 'Teams', exchange: 'Exchange', copilot: 'Copilot', purview: 'Purview', powerplatform: 'Power Platform', security: 'Security', other: 'Other' };
  return g ? map[g] ?? g : '—';
}

export function SourceChip({ id, full, className = '' }: { id: string | null | undefined; full?: boolean; className?: string }) {
  const layer = id && id !== 'unknown' ? (SOURCES as Record<string, { layer: string }>)[id]?.layer : null;
  return <span className={`chip chip-source ${layer === 'B' ? 'chip-layer-b' : 'chip-layer-a'} ${className}`} title={sourceLabel(id)}>{full ? sourceLabel(id) : sourceShort(id)}</span>;
}

export function GroupChip({ group, workload, className = '' }: { group: string | null | undefined; workload?: string | null; className?: string }) {
  return <span className={`chip chip-group ${className}`} title={`${groupLabel(group)}${workload ? ` · ${workload}` : ''}`}>{workload && workload.toLowerCase() !== group ? workload : groupShort(group)}</span>;
}

export function KindChip({ kind }: { kind: string | null | undefined }) {
  if (!kind) return null;
  return <span className="chip chip-kind">{KIND_LABEL[kind] ?? kind}</span>;
}

export function OwnerBadge({ owner, name }: { owner: string | null | undefined; name?: string | null }) {
  if (!owner) return null;
  return <span className={`badge badge-owner badge-owner-${owner}`} title={name ? `${OWNER_LONG[owner] ?? owner}: ${name}` : OWNER_LONG[owner] ?? owner}>{OWNER_SHORT[owner] ?? owner}</span>;
}

export function CountryBadge({ cc, label, alert }: { cc: string | null | undefined; label?: string; alert?: boolean }) {
  if (!cc) return null;
  return <span className={`badge badge-cc ${alert ? 'badge-cc-alert' : ''}`} title={label ?? countryName(cc)}>{alert && <span className="sr-only">Unexpected country: </span>}{cc.toUpperCase()}</span>;
}

export function IpCell({ ip, cc, owner, ownerName, alert }: { ip: string | null | undefined; cc?: string | null; owner?: string | null; ownerName?: string | null; alert?: boolean }) {
  if (!ip) return <span className="muted">—</span>;
  return (
    <span className="ip-cell">
      <span className="mono">{ip}</span>
      <CountryBadge cc={cc} alert={alert} />
      <OwnerBadge owner={owner} name={ownerName} />
    </span>
  );
}

export function SensitivePill({ family }: { family: string | null | undefined }) {
  if (!family) return null;
  return <span className="pill pill-sensitive" title={`Sensitive operation family: ${family}`}>{family}</span>;
}

export function ResultCell({ result, failed }: { result: string | null | undefined; failed: boolean }) {
  if (failed) return <span className="result result-failed"><span className="result-dot" aria-hidden />{result || 'Failed'}</span>;
  if (!result) return <span className="muted">—</span>;
  return <span className="result result-ok">{result}</span>;
}

export type StatusTone = 'ok' | 'warn' | 'crit' | 'low' | 'neutral' | 'accent';
export function StatusPill({ tone = 'neutral', children, title }: { tone?: StatusTone; children: ReactNode; title?: string }) {
  return <span className={`pill pill-${tone}`} title={title}>{children}</span>;
}

export function importStatusTone(status: string): StatusTone {
  switch (status) {
    case 'completed': return 'ok';
    case 'failed': return 'crit';
    case 'cancelled': return 'warn';
    case 'skipped': return 'neutral';
    case 'running': case 'detecting': return 'accent';
    default: return 'low';
  }
}

export function PersonKindPill({ kind }: { kind: string }) {
  const tone: StatusTone = kind === 'member' ? 'neutral' : kind === 'guest' ? 'warn' : kind === 'external' ? 'low' : 'accent';
  return <StatusPill tone={tone}>{kind}</StatusPill>;
}
