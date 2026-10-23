import type { EventFacets, EventPage, FacetBucket } from '@audit/core';
import type { Preset } from '../lib/event-query';
import { fmtInt } from '../lib/format';
import { ActivityView, type AreaTile } from './Activity';

export interface AreaPreset extends Preset { tiles: (f: EventFacets | undefined, p: EventPage | undefined) => AreaTile[] }

const sum = (list: FacetBucket[] | undefined, pred: (b: FacetBucket) => boolean) => (list ?? []).filter(pred).reduce((a, b) => a + b.count, 0);
const n = (v: number | undefined, loading: boolean) => (loading ? '…' : fmtInt(v ?? 0));
const byValue = (list: FacetBucket[] | undefined, ...values: string[]) => sum(list, (b) => values.includes(b.value));
const failed = (f: EventFacets | undefined) => sum(f?.results, (b) => /fail|block|quarant|dropped|undeliver/i.test(b.value));

export const AREA_PRESETS: AreaPreset[] = [
  {
    path: 'emails', label: 'Emails',
    description: 'Mailbox activity from Purview, per-recipient delivery from the message trace, and Defender email, Safe Links, URL, attachment and post-delivery (ZAP) telemetry.',
    base: { kind: 'mail,msg,msgpost,click,urlinfo,attachment' },
    tiles: (f, p) => {
      const l = !f;
      return [
        { label: 'Email events', value: n(p?.total, !p) },
        { label: 'Delivered', value: n(byValue(f?.results, 'Delivered', 'Succeeded', 'Success'), l), tone: 'ok' },
        { label: 'Undelivered / blocked', value: n(sum(f?.results, (b) => /fail|block|quarant|junk|dropped|undeliver/i.test(b.value)), l), tone: 'crit' },
        { label: 'Safe Links clicks', value: n(byValue(f?.kinds, 'click'), l) },
        { label: 'Post-delivery (ZAP)', value: n(byValue(f?.kinds, 'msgpost'), l), tone: 'warn' },
      ];
    },
  },
  {
    path: 'files', label: 'SharePoint & OneDrive',
    description: 'File, folder, site, list, page and sharing activity across SharePoint Online and OneDrive for Business.',
    base: { group: 'sharepoint,onedrive' },
    tiles: (f, p) => {
      const l = !f;
      const ops = f?.operations;
      return [
        { label: 'File events', value: n(p?.total, !p) },
        { label: 'Downloads / sync', value: n(sum(ops, (b) => /download|sync/i.test(b.value)), l) },
        { label: 'Sharing', value: n(sum(ops, (b) => /shar|anonymouslink|securelink|permission/i.test(b.value)), l), tone: 'warn' },
        { label: 'Deletions', value: n(sum(ops, (b) => /delet|recycl/i.test(b.value)), l), tone: 'crit' },
        { label: 'Users', value: l ? '…' : `${(f?.users ?? []).length}${(f?.users?.length ?? 0) >= 15 ? '+' : ''}` },
      ];
    },
  },
  {
    path: 'teams', label: 'Teams',
    description: 'Teams, channels, membership, messages, meetings, apps and policy changes.',
    base: { group: 'teams' },
    tiles: (f, p) => {
      const l = !f;
      const ops = f?.operations;
      return [
        { label: 'Teams events', value: n(p?.total, !p) },
        { label: 'Membership changes', value: n(sum(ops, (b) => /member|owner/i.test(b.value)), l), tone: 'warn' },
        { label: 'Messages & chats', value: n(sum(ops, (b) => /message|chat/i.test(b.value)), l) },
        { label: 'Sessions / meetings', value: n(sum(ops, (b) => /session|meeting/i.test(b.value)), l) },
      ];
    },
  },
  {
    path: 'identity', label: 'Identity & Access',
    description: 'Entra ID sign-ins (interactive and non-interactive), directory changes, roles, applications, consent and authentication settings.',
    base: { group: 'identity' },
    tiles: (f) => {
      const l = !f;
      return [
        { label: 'Sign-ins', value: n(byValue(f?.kinds, 'signin'), l) },
        { label: 'Failed', value: n(failed(f), l), tone: 'crit' },
        { label: 'Countries', value: l ? '…' : String((f?.countries ?? []).length) },
        { label: 'Directory changes', value: n(byValue(f?.kinds, 'dir', 'admin'), l), tone: 'warn' },
        { label: 'Client IPs', value: l ? '…' : `${(f?.ips ?? []).length}${(f?.ips?.length ?? 0) >= 12 ? '+' : ''}` },
      ];
    },
  },
  {
    path: 'administration', label: 'Administration',
    description: 'Administrative cmdlets and directory changes: Exchange and Teams admin operations, Entra directory edits, role and policy changes, audit configuration.',
    base: { q: 'kind:admin OR kind:dir OR type:*Admin*' },
    tiles: (f, p) => {
      const l = !f;
      return [
        { label: 'Admin events', value: n(p?.total, !p) },
        { label: 'Exchange admin', value: n(sum(f?.recordTypes, (b) => /^ExchangeAdmin/i.test(b.value)), l) },
        { label: 'Directory changes', value: n(byValue(f?.kinds, 'dir'), l), tone: 'warn' },
        { label: 'Admins active', value: l ? '…' : String((f?.users ?? []).length) },
      ];
    },
  },
  {
    path: 'security', label: 'Security & Compliance',
    description: 'Defender alerts, investigations, quarantine, threat intelligence, risk detections, plus Purview DLP, labels, retention, eDiscovery and audit configuration.',
    base: { group: 'security,purview' },
    tiles: (f, p) => {
      const l = !f;
      return [
        { label: 'Events', value: n(p?.total, !p) },
        { label: 'Security telemetry', value: n(byValue(f?.groups, 'security'), l), tone: 'crit' },
        { label: 'Purview & compliance', value: n(byValue(f?.groups, 'purview'), l) },
        { label: 'Failed / blocked', value: n(failed(f), l), tone: 'warn' },
      ];
    },
  },
  {
    path: 'applications', label: 'Applications & Automation',
    description: 'Power Platform (Power Apps, Automate, BI, Dynamics, Fabric), Copilot and AI interactions, and the remaining workloads (Forms, Planner, Stream, Viva…).',
    base: { group: 'powerplatform,copilot,other' },
    tiles: (f, p) => {
      const l = !f;
      return [
        { label: 'Events', value: n(p?.total, !p) },
        { label: 'Power Platform', value: n(byValue(f?.groups, 'powerplatform'), l) },
        { label: 'Copilot & AI', value: n(byValue(f?.groups, 'copilot'), l) },
        { label: 'Other workloads', value: n(byValue(f?.groups, 'other'), l) },
      ];
    },
  },
];

export function AreaPage({ preset }: { preset: AreaPreset }) {
  return <ActivityView key={preset.path} preset={preset} title={preset.label} description={preset.description} tiles={preset.tiles} />;
}
