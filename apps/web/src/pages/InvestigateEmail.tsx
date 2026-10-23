import { useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { EmailRecipient } from '@audit/core';
import { useWorkspaceCtx } from './WorkspaceShell';
import { useEmailInvestigation, useEmailSearch } from '../lib/queries';
import { useUrlState } from '../lib/url';
import { useTime } from '../lib/time';
import { fmtInt, plural } from '../lib/format';
import { EmptyState, ErrorState, Section, Skeleton, SkeletonRows } from '../components/Basics';
import { CountryBadge, SourceChip, StatusPill } from '../components/Badges';
import { ipUrl, userUrl } from '../components/Findings';
import { DefenderVerdictPill, SeverityPill, VerdictPill } from '../components/Verdict';
import { IconChevronRight, IconSearch } from '../components/Icons';
import { EmailCandidateRow, emailUrl, urlUrl } from './Investigate';

/** /investigate/email?q= : search box, or picker when several candidates match; jumps straight to a single match. */
export function EmailSearchPage() {
  const { wsId } = useWorkspaceCtx();
  const [url, setUrl] = useUrlState();
  const q = url.q ?? '';
  const [text, setText] = useState(q);
  const res = useEmailSearch(wsId, q);
  const submit = (e: FormEvent) => { e.preventDefault(); setUrl({ q: text.trim() || null }); };

  if (q && res.data?.items.length === 1) return <Navigate to={emailUrl(wsId, res.data.items[0].key)} replace />;

  return (
    <div className="page investigate">
      <div className="page-head"><div><h1>Check a suspicious email</h1><p>Search by subject, sender address or message id. You will see who received it, who clicked and what those people did next.</p></div></div>
      <form className="omni is-compact" onSubmit={submit}><div className="omni-box"><IconSearch size={18} /><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Subject, sender or message id" aria-label="Email search" autoFocus={!q} /><button className="btn btn-primary" type="submit" disabled={!text.trim()}>Search</button></div></form>
      {q && (
        <Section title={res.data ? `${plural(res.data.items.length, 'match', 'matches')} for “${q}”` : `Searching for “${q}”`} className="mt-16">
          {res.isPending ? <SkeletonRows rows={4} cols={3} /> : res.isError ? <ErrorState error={res.error} retry={() => res.refetch()} /> : !res.data.items.length ? <EmptyState compact title="No email matches" text="Try a shorter part of the subject, or the sender's domain. Emails only appear once a message trace or Defender export has been imported." action={{ label: 'Go to Imports', to: `/w/${wsId}/imports` }} /> : (
            <div className="email-cands">{res.data.items.map((e) => <EmailCandidateRow key={e.key} e={e} wsId={wsId} />)}</div>
          )}
        </Section>
      )}
    </div>
  );
}

const RISK_ORDER: Record<EmailRecipient['risk'], number> = { high: 0, medium: 1, low: 2, none: 3 };

export function InvestigateEmailPage() {
  const { wsId } = useWorkspaceCtx();
  const { key = '' } = useParams();
  const inv = useEmailInvestigation(wsId, key);
  const t = useTime();
  const d = inv.data;

  if (inv.isError) return <div className="page"><ErrorState error={inv.error} retry={() => inv.refetch()} /><Link className="btn" to={`/w/${wsId}/investigate/email`}>Search emails</Link></div>;

  const recipients = d ? [...d.recipients].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || (b.clicks.length - a.clicks.length)) : [];
  const s = d?.summary;
  return (
    <div className="page investigate">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="small muted" style={{ marginBottom: 4 }}>Email investigation</div>
          <h1 style={{ overflowWrap: 'anywhere' }}>{d ? (d.subject ?? '(no subject)') : <Skeleton w={360} h={22} />}</h1>
          {d && (
            <div className="row row-wrap small muted" style={{ marginTop: 6 }}>
              <span>from <span className="fg">{d.sender ?? 'unknown sender'}</span>{d.senderIp && <> · sender IP <Link className="mono" to={ipUrl(wsId, d.senderIp)}>{d.senderIp}</Link></>}</span>
              <span>· first seen {t.dateTime(d.firstSeen, { seconds: false })}</span>
              <DefenderVerdictPill verdict={d.verdict} />
              <span className="chips">{d.sources.map((x) => <SourceChip key={x} id={x} />)}</span>
            </div>
          )}
        </div>
        <Link className="btn" to={`/w/${wsId}/investigate/email`}>Another email</Link>
      </div>

      {!d ? <VerdictLikeSkeleton /> : (
        <>
          <section className={`verdict verdict-${s!.atRisk > 0 ? 'compromised' : s!.clicked > 0 ? 'suspicious' : 'clean'}`} aria-label="Summary">
            <div className="verdict-body">
              <h2 className="verdict-headline">{d.headline}</h2>
              <div className="sum-tiles">
                <SumTile n={s!.recipients} label="recipients" />
                <SumTile n={s!.delivered} label="delivered" sub={s!.undelivered ? `${fmtInt(s!.undelivered)} blocked` : undefined} />
                <SumTile n={s!.opened} label="opened" />
                <SumTile n={s!.clicked} label="clicked" tone={s!.clicked ? 'warn' : undefined} />
                <SumTile n={s!.clickedThrough} label="clicked through a warning" tone={s!.clickedThrough ? 'crit' : undefined} />
                <SumTile n={s!.zapped} label="removed by ZAP" />
                <SumTile n={s!.replied} label="replied or forwarded" tone={s!.replied ? 'warn' : undefined} />
                <SumTile n={s!.atRisk} label="look compromised" tone={s!.atRisk ? 'crit' : undefined} />
              </div>
              {d.urls.length > 0 && (
                <div className="email-urls">
                  <div className="verdict-sub">Links in the email</div>
                  <ul>{d.urls.map((u) => <li key={u}><Link className="mono" to={urlUrl(wsId, u)} style={{ overflowWrap: 'anywhere' }}>{u}</Link></li>)}</ul>
                </div>
              )}
              {(d.messageId || d.networkMessageId) && <div className="small muted" style={{ marginTop: 10 }}>{d.networkMessageId && <>Network message id <span className="mono">{d.networkMessageId}</span></>}{d.messageId && <> · Message id <span className="mono" style={{ overflowWrap: 'anywhere' }}>{d.messageId}</span></>}</div>}
            </div>
          </section>

          <Section title="Recipients" right={<span>sorted by risk · click a row for what happened after the click</span>}>
            {!recipients.length ? <div className="muted small">No per-recipient data: import the message trace or Defender email export for this period.</div> : (
              <div className="table-wrap">
                <table className="table recip-table" aria-label="Recipients">
                  <thead><tr><th scope="col" style={{ width: 28 }} /><th scope="col">Risk</th><th scope="col">User</th><th scope="col">Delivery</th><th scope="col">Opened</th><th scope="col">Clicks</th><th scope="col">After delivery</th><th scope="col">Replied / forwarded</th></tr></thead>
                  <tbody>{recipients.map((r) => <RecipientRow key={r.upn} r={r} wsId={wsId} />)}</tbody>
                </table>
              </div>
            )}
            {d.nonRecipientClicks.length > 0 && (
              <div className="alert alert-warn mt-16"><div><b>{plural(d.nonRecipientClicks.length, 'click')}</b> on this email's links came from people who are not listed as recipients (forwarded copy or shared link): {d.nonRecipientClicks.map((c, i) => <span key={i}>{i > 0 && ', '}<Link to={userUrl(wsId, c.upn)}>{c.upn}</Link> <span className="mono small">{t.dateTime(c.ts, { seconds: false })}</span>{c.result ? ` (${c.result})` : ''}</span>)}.</div></div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function VerdictLikeSkeleton() { return <div className="verdict verdict-insufficient"><div className="verdict-body"><Skeleton w="60%" h={20} /><Skeleton w="90%" h={14} style={{ marginTop: 12 }} /></div></div>; }

function SumTile({ n, label, sub, tone }: { n: number; label: string; sub?: string; tone?: 'crit' | 'warn' }) {
  return <div className={`sum-tile ${n && tone ? `is-${tone}` : ''} ${!n ? 'is-zero' : ''}`}><span className="sum-n">{fmtInt(n)}</span><span className="sum-l">{label}</span>{sub && <span className="sum-s">{sub}</span>}</div>;
}

function RecipientRow({ r, wsId }: { r: EmailRecipient; wsId: string }) {
  const [open, setOpen] = useState(false);
  const t = useTime();
  const expandable = r.afterClick.length > 0 || r.clicks.length > 0 || !!r.deliveryLocation;
  const through = r.clicks.some((c) => /through|allowed/i.test(c.result ?? ''));
  return (
    <>
      <tr className={`recip ${expandable ? 'is-expandable' : ''} ${open ? 'is-open' : ''}`} onClick={expandable ? () => setOpen((o) => !o) : undefined} tabIndex={expandable ? 0 : undefined} onKeyDown={expandable ? (e) => { if (e.key === 'Enter') setOpen((o) => !o); } : undefined} aria-expanded={expandable ? open : undefined}>
        <td>{expandable && <span className="finding-chev"><IconChevronRight size={14} /></span>}</td>
        <td><SeverityPill severity={r.risk} /></td>
        <td><span className="row gap-4 row-wrap"><Link to={userUrl(wsId, r.upn)} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 500 }}>{r.upn}</Link>{r.verdictLevel && r.verdictLevel !== 'clean' && <VerdictPill level={r.verdictLevel} />}</span></td>
        <td className="small">{r.delivery ? <StatusPill tone={/deliver/i.test(r.delivery) && !/undeliver|fail/i.test(r.delivery) ? 'neutral' : 'warn'}>{r.delivery}</StatusPill> : <span className="muted">—</span>}</td>
        <td className="small">{r.opened ? <span title={r.opened.clients.join(', ')}>{t.dateTime(r.opened.first, { seconds: false })}{r.opened.count > 1 && <span className="muted"> ×{r.opened.count}</span>}</span> : <span className="muted">—</span>}</td>
        <td className="small">{r.clicks.length ? <span className={through ? 'tone-crit' : 'tone-warn'} style={{ fontWeight: 500 }}>{plural(r.clicks.length, 'click')}{through ? ', went through the warning' : ''}</span> : <span className="muted">no clicks</span>}</td>
        <td className="small">{r.postDelivery ?? <span className="muted">—</span>}</td>
        <td className="small">{r.repliedOrForwarded.length ? <span className="tone-warn">{plural(r.repliedOrForwarded.length, 'message')}</span> : <span className="muted">—</span>}</td>
      </tr>
      {open && (
        <tr className="recip-detail"><td /><td colSpan={7}>
          <div className="stack stack-8">
            {r.deliveryLocation && <div className="small muted">{r.deliveryLocation}</div>}
            {r.clicks.length > 0 && (
              <div>
                <div className="verdict-sub">Clicks</div>
                <ul className="plain-list">{r.clicks.map((c, i) => <li key={i} className="row row-wrap gap-12 small"><span className="mono">{t.dateTime(c.ts)}</span><span className={/through|allowed/i.test(c.result ?? '') ? 'tone-crit' : ''}>{c.result ?? '—'}</span>{c.ip && <Link to={ipUrl(wsId, c.ip)} className="ip-cell"><span className="mono">{c.ip}</span><CountryBadge cc={c.country} /></Link>}{c.url && <Link className="mono ellipsis" style={{ maxWidth: 420 }} to={urlUrl(wsId, c.url)} title={c.url}>{c.url}</Link>}</li>)}</ul>
              </div>
            )}
            {r.repliedOrForwarded.length > 0 && (
              <div>
                <div className="verdict-sub">Replied / forwarded</div>
                <ul className="plain-list">{r.repliedOrForwarded.map((m, i) => <li key={i} className="small"><span className="mono">{t.dateTime(m.ts, { seconds: false })}</span> · {m.subject}</li>)}</ul>
              </div>
            )}
            <div>
              <div className="verdict-sub">After the click</div>
              {!r.afterClick.length ? <div className="small muted">Nothing suspicious in the 90 minutes after the first click.</div> : (
                <ul className="ind-list">{r.afterClick.map((a, i) => <li key={i} className="ind is-open"><div className="ind-head" style={{ cursor: 'default' }}><SeverityPill severity={a.severity} /><span className="ind-title">{a.title}</span>{a.ts && <span className="small muted mono">{t.dateTime(a.ts, { seconds: false })}</span>}</div><div className="ind-body"><p>{a.text}</p>{a.evidenceQuery && <Link className="btn btn-sm" to={`/w/${wsId}/activity?${new URLSearchParams(a.evidenceQuery as Record<string, string>).toString()}`}>Show evidence</Link>}</div></li>)}</ul>
              )}
            </div>
            <div><Link className="btn btn-sm" to={userUrl(wsId, r.upn)}>Open user investigation</Link></div>
          </div>
        </td></tr>
      )}
    </>
  );
}
