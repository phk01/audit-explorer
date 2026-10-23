import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Finding, Severity } from '@audit/core';
import { useUpdateFinding } from '../lib/queries';
import { useToast } from '../lib/toast';
import { useTime } from '../lib/time';
import { fmtInt, plural } from '../lib/format';
import { evidenceUrl } from '../lib/event-query';
import { StatusPill } from './Badges';
import { SeverityPill } from './Verdict';
import { IconChevronRight } from './Icons';

export const userUrl = (wsId: string, upn: string) => `/w/${wsId}/investigate/user/${encodeURIComponent(upn)}`;
export const ipUrl = (wsId: string, ip: string) => `/w/${wsId}/investigate/ip/${encodeURIComponent(ip)}`;

const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low'];
const SEVERITY_LABEL: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** Status / note controls shared by finding rows and verdict indicators. */
export function FindingActions({ finding, wsId, compact }: { finding: Finding; wsId: string; compact?: boolean }) {
  const update = useUpdateFinding(wsId);
  const { toast } = useToast();
  const [note, setNote] = useState(finding.note ?? '');
  useEffect(() => { setNote(finding.note ?? ''); }, [finding.note, finding.id]);
  const set = (status: Finding['status']) => update.mutate({ id: finding.id, patch: { status } }, { onError: (e) => toast(e.message, 'error') });
  const saveNote = () => { const v = note.trim() || null; if (v === (finding.note ?? null)) return; update.mutate({ id: finding.id, patch: { note: v } }, { onSuccess: () => toast('Note saved', 'ok'), onError: (e) => toast(e.message, 'error') }); };
  return (
    <div className={`finding-actions ${compact ? 'is-compact' : ''}`}>
      <div className="row row-wrap">
        {finding.status !== 'confirmed' && <button className="btn btn-sm" onClick={() => set('confirmed')} disabled={update.isPending}>Confirm</button>}
        {finding.status !== 'dismissed' && <button className="btn btn-sm" onClick={() => set('dismissed')} disabled={update.isPending}>Dismiss</button>}
        {finding.status !== 'open' && <button className="btn btn-sm" onClick={() => set('open')} disabled={update.isPending}>Reopen</button>}
        <FindingStatusPill status={finding.status} />
      </div>
      <div className="finding-note">
        <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} placeholder="Add a note for the case file…" aria-label="Finding note" />
      </div>
    </div>
  );
}

export function FindingStatusPill({ status }: { status: Finding['status'] }) {
  if (status === 'open') return null;
  return <StatusPill tone={status === 'confirmed' ? 'crit' : 'neutral'}>{status}</StatusPill>;
}

function Who({ users, wsId, max = 3 }: { users: string[]; wsId: string; max?: number }) {
  if (!users.length) return <span className="muted">—</span>;
  const shown = users.slice(0, max);
  return (
    <span className="finding-who">
      {shown.map((u, i) => <span key={u}>{i > 0 && ', '}<Link to={userUrl(wsId, u)} onClick={(e) => e.stopPropagation()}>{u.split('@')[0]}</Link></span>)}
      {users.length > max && <span className="muted"> +{users.length - max} more</span>}
    </span>
  );
}

export function FindingRow({ finding: f, wsId, defaultOpen }: { finding: Finding; wsId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const t = useTime();
  const when = f.firstTs ? (f.lastTs && f.lastTs !== f.firstTs ? `${t.dateTime(f.firstTs, { seconds: false })} → ${t.dateTime(f.lastTs, { seconds: false })}` : t.dateTime(f.firstTs, { seconds: false })) : '—';
  return (
    <li className={`finding ${open ? 'is-open' : ''} status-${f.status}`}>
      <div className="finding-head" onClick={() => setOpen((o) => !o)}>
        <button type="button" className="finding-toggle" aria-expanded={open}>
          <span className="finding-chev"><IconChevronRight size={14} /></span>
          <SeverityPill severity={f.severity} />
          <span className="finding-title">{f.title}<FindingStatusPill status={f.status} /></span>
        </button>
        <span className="finding-meta">
          <Who users={f.users} wsId={wsId} />
          <span className="mono small muted nowrap">{when}</span>
          <span className="num small muted nowrap">{plural(f.eventCount, 'event')}</span>
        </span>
      </div>
      {open && (
        <div className="finding-body">
          <p>{f.text}</p>
          {f.facts.length > 0 && (
            <dl className="facts facts-tight">{f.facts.map(([k, v]) => <FactItem key={k} k={k} v={v} />)}</dl>
          )}
          <div className="row row-wrap gap-12 mb-8">
            {f.evidenceQuery && <Link className="btn btn-sm" to={evidenceUrl(wsId, f.evidenceQuery)}>Show evidence ({fmtInt(f.eventCount)})</Link>}
            {f.entityType === 'ip' && f.entityValue && <Link className="btn btn-sm" to={ipUrl(wsId, f.entityValue)}>Open IP {f.entityValue}</Link>}
            {f.users.slice(0, 6).map((u) => <Link key={u} className="btn btn-sm" to={userUrl(wsId, u)}>Open {u.split('@')[0]}</Link>)}
            {f.users.length > 6 && <span className="small muted">+{f.users.length - 6} more accounts</span>}
          </div>
          <FindingActions finding={f} wsId={wsId} />
        </div>
      )}
    </li>
  );
}

function FactItem({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd className={/^[\d.:→ \-A-Z]+$/.test(v) && v.length < 48 ? 'mono' : ''}>{v}</dd></>;
}

/** Findings grouped by severity. */
export function FindingList({ findings, wsId, empty }: { findings: Finding[]; wsId: string; empty?: ReactNode }) {
  if (!findings.length) return <>{empty ?? <div className="muted small">No findings.</div>}</>;
  return (
    <div className="finding-groups">
      {SEVERITY_ORDER.map((sev) => {
        const list = findings.filter((f) => f.severity === sev);
        if (!list.length) return null;
        return (
          <section key={sev} className="finding-group">
            <h3 className={`finding-group-title tone-${sev === 'high' ? 'crit' : sev === 'medium' ? 'warn' : 'low'}`}>{SEVERITY_LABEL[sev]} <span className="muted">· {list.length}</span></h3>
            <ul className="finding-list">{list.map((f) => <FindingRow key={f.id} finding={f} wsId={wsId} />)}</ul>
          </section>
        );
      })}
    </div>
  );
}
