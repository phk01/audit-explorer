import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { EmailCandidate, ResolveResult } from '@audit/core';
import { useWorkspaceCtx } from './WorkspaceShell';
import { useFindings, useRecomputeFindings, useResolve } from '../lib/queries';
import { useDebounced } from '../lib/url';
import { endpoints } from '../lib/api';
import { useTime } from '../lib/time';
import { fmtInt, plural } from '../lib/format';
import { useToast } from '../lib/toast';
import { EmptyState, ErrorState, Section, SkeletonRows } from '../components/Basics';
import { CountryBadge, OwnerBadge, SourceChip } from '../components/Badges';
import { FindingList, ipUrl, userUrl } from '../components/Findings';
import { DefenderVerdictPill, VerdictPill } from '../components/Verdict';
import { IconArrowRight, IconMail, IconRefresh, IconSearch, IconUser } from '../components/Icons';

export const emailUrl = (wsId: string, key: string) => `/w/${wsId}/investigate/email/${encodeURIComponent(key)}`;
export const emailSearchUrl = (wsId: string, q: string) => `/w/${wsId}/investigate/email?q=${encodeURIComponent(q)}`;
export const urlUrl = (wsId: string, q: string) => `/w/${wsId}/investigate/url?q=${encodeURIComponent(q)}`;

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+:[0-9a-f:]*$/i;
const DOMAIN_RE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i;
export const looksLikeIp = (s: string) => IP_RE.test(s.trim());
export const looksLikeUrl = (s: string) => !s.includes('@') && DOMAIN_RE.test(s.trim());

type Hit = { kind: 'user' | 'email' | 'ip' | 'url'; label: ReactNode; to: string; key: string };

export function InvestigatePage() {
  const { wsId, workspace } = useWorkspaceCtx();
  const findings = useFindings(wsId);
  const recompute = useRecomputeFindings(wsId);
  const { toast } = useToast();
  const t = useTime();
  const noEvents = (workspace.stats?.events ?? 1) === 0;

  return (
    <div className="page investigate">
      <div className="inv-hero">
        <h1>What do you want to check?</h1>
        <p className="muted">Start from a person, a suspicious email, a link or an address. You get a verdict first and the evidence underneath.</p>
        <OmniSearch wsId={wsId} />
      </div>

      <div className="quick-grid">
        <QuickCard icon={<IconUser size={18} />} title="Check a user" text="Has this account been phished or taken over?" placeholder="name or UPN" onSubmit={(v) => `${userUrl(wsId, v)}`} resolveUser wsId={wsId} />
        <QuickCard icon={<IconMail size={18} />} title="Check a suspicious email" text="Who got it, who clicked, what happened next." placeholder="subject, sender or message id" onSubmit={(v) => emailSearchUrl(wsId, v)} />
        <QuickCard icon={<IconSearch size={18} />} title="Check a URL or domain" text="Which emails carried it and who clicked." placeholder="fabrikam-docs-share.com" onSubmit={(v) => urlUrl(wsId, v)} />
        <QuickCard small title="Check an IP" placeholder="45.142.212.61" onSubmit={(v) => ipUrl(wsId, v.trim())} />
      </div>

      <Section className="findings-card" title={<span>Findings</span>} right={
        <div className="row gap-12">
          {findings.data?.lastRun?.finishedAt ? <span title={t.dateTime(findings.data.lastRun.finishedAt)}>Last detection run {t.relative(findings.data.lastRun.finishedAt)}{findings.data.lastRun.error ? ' · failed' : ''}</span> : findings.data ? <span>Detections have not run yet</span> : null}
          <button className="btn btn-sm" disabled={recompute.isPending || noEvents} onClick={() => recompute.mutate(undefined, { onSuccess: (r) => toast(`${plural(r.findings, 'finding')} in ${fmtInt(r.ms)} ms`, 'ok'), onError: (e) => toast(e.message, 'error') })}><IconRefresh size={13} /> {recompute.isPending ? 'Running…' : 'Re-run detections'}</button>
        </div>
      }>
        {findings.data && !noEvents && (
          <p className="muted small" style={{ marginBottom: 12 }}>
            {findings.data.counts.high + findings.data.counts.medium + findings.data.counts.low === 0 ? 'Nothing suspicious was detected in the imported data.' : <>Across the workspace: <b className="tone-crit">{findings.data.counts.high} high</b>, <b className="tone-warn">{findings.data.counts.medium} medium</b>, <b className="tone-low">{findings.data.counts.low} low</b>{findings.data.counts.dismissed ? <> · {findings.data.counts.dismissed} dismissed</> : null}. Open a finding to read what happened and decide whether it matters.</>}
          </p>
        )}
        {noEvents ? <EmptyState compact title="No events yet" text="Import a Purview audit export, Entra sign-in log, message trace or Defender export; detections run automatically after each import." action={{ label: 'Go to Imports', to: `/w/${wsId}/imports` }} />
          : findings.isPending ? <SkeletonRows rows={6} cols={4} />
          : findings.isError ? <ErrorState error={findings.error} retry={() => findings.refetch()} />
          : <FindingList findings={findings.data.items} wsId={wsId} empty={<EmptyState compact title="No open findings" text="Nothing in the imported data tripped a detection. That is not proof of innocence: check Data Coverage to see which logs are missing." action={{ label: 'Data coverage', to: `/w/${wsId}/coverage` }} />} />}
      </Section>
    </div>
  );
}

function QuickCard({ icon, title, text, placeholder, onSubmit, small, resolveUser, wsId }: { icon?: ReactNode; title: string; text?: string; placeholder: string; onSubmit: (v: string) => string; small?: boolean; resolveUser?: boolean; wsId?: string }) {
  const navigate = useNavigate();
  const [v, setV] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const val = v.trim();
    if (!val) return;
    if (resolveUser && wsId && !val.includes('@')) {
      // a name fragment: resolve to a UPN first
      const r = await endpoints.resolve(wsId, val).catch(() => null);
      if (r?.users.length === 1) { navigate(userUrl(wsId, r.users[0].upn)); return; }
      if (r && r.users.length > 1) { navigate(`/w/${wsId}/people?search=${encodeURIComponent(val)}`); return; }
    }
    navigate(onSubmit(val));
  };
  return (
    <form className={`quick-card card ${small ? 'is-small' : ''}`} onSubmit={submit}>
      <div className="quick-head">{icon && <span className="quick-ico">{icon}</span>}<span className="quick-title">{title}</span></div>
      {text && <div className="quick-text">{text}</div>}
      <div className="quick-input">
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={title} />
        <button type="submit" className="icon-btn" aria-label="Go" disabled={!v.trim()}><IconArrowRight size={16} /></button>
      </div>
    </form>
  );
}

/** Big search with type-ahead across users, emails, IPs and URLs. */
export function OmniSearch({ wsId, autoFocus = true, compact }: { wsId: string; autoFocus?: boolean; compact?: boolean }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const res = useResolve(wsId, dq);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const t = useTime();
  const boxRef = useRef<HTMLDivElement>(null);

  const hits = useMemo<{ group: string; items: Hit[] }[]>(() => buildHits(res.data, wsId, t.date), [res.data, wsId, t]);
  const flat = useMemo(() => hits.flatMap((g) => g.items), [hits]);
  useEffect(() => { setActive(0); }, [dq]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const go = (text: string) => {
    const v = text.trim();
    if (!v) return;
    const exactUser = res.data?.users.find((u) => u.upn.toLowerCase() === v.toLowerCase());
    if (exactUser) return navigate(userUrl(wsId, exactUser.upn));
    if (looksLikeIp(v)) return navigate(ipUrl(wsId, v));
    if (v.includes('@') && !/\s/.test(v)) return navigate(userUrl(wsId, v));
    if (looksLikeUrl(v)) return navigate(urlUrl(wsId, v));
    if (flat[active]) return navigate(flat[active].to);
    navigate(emailSearchUrl(wsId, v));
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); setOpen(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter') { e.preventDefault(); if (open && flat[active] && !looksLikeIp(q) && !q.includes('@')) navigate(flat[active].to); else go(q); }
  };
  const showPop = open && dq.trim().length >= 2;

  return (
    <div className={`omni ${compact ? 'is-compact' : ''}`} ref={boxRef}>
      <div className="omni-box">
        <IconSearch size={18} />
        <input value={q} autoFocus={autoFocus} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} placeholder="Search a user, email subject, sender, URL or IP" aria-label="Search a user, email subject, sender, URL or IP" aria-expanded={showPop} aria-autocomplete="list" role="combobox" aria-controls="omni-list" spellCheck={false} autoComplete="off" />
        <button type="button" className="btn btn-primary" onClick={() => go(q)} disabled={!q.trim()}>Check</button>
      </div>
      {showPop && (
        <div className="omni-pop" id="omni-list" role="listbox">
          {res.isPending ? <div className="omni-empty muted small">Searching…</div>
            : !flat.length ? <div className="omni-empty muted small">Nothing matches “{dq}”. Press Enter to search email subjects and senders.</div>
            : hits.map((g) => (
              <div key={g.group} className="omni-group">
                <div className="omni-group-title">{g.group}</div>
                {g.items.map((h) => { const i = flat.indexOf(h); return <Link key={h.key} to={h.to} role="option" aria-selected={i === active} className={`omni-item ${i === active ? 'is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => setOpen(false)}>{h.label}</Link>; })}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function buildHits(r: ResolveResult | undefined, wsId: string, date: (v: string | null) => string): { group: string; items: Hit[] }[] {
  if (!r) return [];
  const out: { group: string; items: Hit[] }[] = [];
  if (r.users?.length) out.push({ group: 'Users', items: r.users.slice(0, 6).map((u) => ({ kind: 'user', key: `u:${u.upn}`, to: userUrl(wsId, u.upn), label: <><span className="omni-main">{u.upn}</span><span className="omni-side"><VerdictPill level={u.verdictLevel} />{u.findings > 0 && <span className="small muted">{plural(u.findings, 'finding')}</span>}<span className="small muted num">{fmtInt(u.events)} events</span></span></> })) });
  if (r.emails?.length) out.push({ group: 'Emails', items: r.emails.slice(0, 4).map((e) => ({ kind: 'email', key: `e:${e.key}`, to: emailUrl(wsId, e.key), label: <><span className="omni-main"><span className="ellipsis">{e.subject ?? '(no subject)'}</span><span className="small muted ellipsis">from {e.sender ?? 'unknown'} · {date(e.firstSeen)} · {plural(e.recipients, 'recipient')}</span></span><span className="omni-side"><DefenderVerdictPill verdict={e.verdict} /></span></> })) });
  if (r.ips?.length) out.push({ group: 'IP addresses', items: r.ips.slice(0, 6).map((ip) => ({ kind: 'ip', key: `i:${ip.ip}`, to: ipUrl(wsId, ip.ip), label: <><span className="omni-main mono">{ip.ip}</span><span className="omni-side"><CountryBadge cc={ip.country} /><OwnerBadge owner={ip.owner} /><span className="small muted num">{fmtInt(ip.events)} events</span></span></> })) });
  if (r.urls?.length) out.push({ group: 'URLs', items: r.urls.slice(0, 6).map((u) => ({ kind: 'url', key: `l:${u.url}`, to: urlUrl(wsId, u.url), label: <><span className="omni-main mono ellipsis">{u.url}</span><span className="omni-side"><span className="small muted num">{plural(u.clicks, 'click')}</span></span></> })) });
  return out;
}

/** Row used by the email picker and URL page. */
export function EmailCandidateRow({ e, wsId }: { e: EmailCandidate; wsId: string }) {
  const t = useTime();
  return (
    <Link to={emailUrl(wsId, e.key)} className="email-cand">
      <div className="email-cand-main">
        <div className="email-cand-subject">{e.subject ?? <span className="muted">(no subject)</span>}</div>
        <div className="small muted">from {e.sender ?? 'unknown sender'} · first seen {t.dateTime(e.firstSeen, { seconds: false })} · {plural(e.recipients, 'recipient')}</div>
      </div>
      <div className="row gap-4 row-wrap" style={{ justifyContent: 'flex-end' }}>
        <DefenderVerdictPill verdict={e.verdict} />
        <span className="chips">{e.sources.map((s) => <SourceChip key={s} id={s} />)}</span>
      </div>
    </Link>
  );
}
