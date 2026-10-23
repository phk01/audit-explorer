import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspaceCtx } from './WorkspaceShell';
import { useUrlInvestigation } from '../lib/queries';
import { useUrlState } from '../lib/url';
import { useTime } from '../lib/time';
import { fmtInt, plural } from '../lib/format';
import { EmptyState, ErrorState, Section, SkeletonRows } from '../components/Basics';
import { CountryBadge, StatusPill } from '../components/Badges';
import { SimpleTable } from '../components/DataTable';
import { ipUrl, userUrl } from '../components/Findings';
import { VerdictPill } from '../components/Verdict';
import { IconSearch } from '../components/Icons';
import { EmailCandidateRow, emailUrl } from './Investigate';

export function InvestigateUrlPage() {
  const { wsId } = useWorkspaceCtx();
  const [url, setUrl] = useUrlState();
  const q = url.q ?? '';
  const [text, setText] = useState(q);
  const inv = useUrlInvestigation(wsId, q);
  const t = useTime();
  const submit = (e: FormEvent) => { e.preventDefault(); setUrl({ q: text.trim() || null }); };
  const d = inv.data;
  const through = d?.users.filter((u) => u.clickedThrough).length ?? 0;

  return (
    <div className="page investigate">
      <div className="page-head"><div><h1>Check a URL or domain</h1><p>Which emails carried this link, who clicked it and whether they went through the Safe Links warning.</p></div></div>
      <form className="omni is-compact" onSubmit={submit}><div className="omni-box"><IconSearch size={18} /><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Domain or full URL, e.g. fabrikam-docs-share.com" aria-label="URL or domain" autoFocus={!q} spellCheck={false} /><button className="btn btn-primary" type="submit" disabled={!text.trim()}>Check</button></div></form>

      {q && (inv.isPending ? <Section className="mt-16"><SkeletonRows rows={4} cols={3} /></Section> : inv.isError ? <div className="mt-16"><ErrorState error={inv.error} retry={() => inv.refetch()} /></div> : d && (
        <>
          <section className={`verdict mt-16 verdict-${through > 0 ? 'compromised' : d.users.length ? 'suspicious' : d.emails.length ? 'insufficient' : 'clean'}`} aria-label="Summary">
            <div className="verdict-body">
              <div className="verdict-level mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{d.query}</div>
              <h2 className="verdict-headline">
                {!d.emails.length && !d.clicks.length ? 'Nothing in the imported data mentions this link'
                  : `${plural(d.emails.length, 'email')} carried it · ${plural(d.users.length, 'person', 'people')} clicked${through ? ` · ${through} went through the warning` : ''}`}
              </h2>
              {!d.emails.length && !d.clicks.length && <p className="verdict-summary">Safe Links clicks and URL detections only exist if the Defender URL click / URL info exports were imported for the period. Check Data Coverage.</p>}
            </div>
          </section>

          <div className="grid grid-2 mt-16 url-grid">
            <Section title="Emails carrying this link">
              {!d.emails.length ? <div className="muted small">No emails found with this link.</div> : <div className="email-cands">{d.emails.map((e) => <EmailCandidateRow key={e.key} e={e} wsId={wsId} />)}</div>}
            </Section>
            <Section title="People who clicked">
              {!d.users.length ? <div className="muted small">No clicks recorded.</div> : (
                <SimpleTable ariaLabel="People who clicked" dense rows={d.users} rowKey={(r) => r.upn} columns={[
                  { id: 'u', header: 'User', width: 'auto', cell: (r) => <Link to={userUrl(wsId, r.upn)} style={{ fontWeight: 500 }}>{r.upn}</Link> },
                  { id: 'v', header: 'Verdict', width: '130px', cell: (r) => <VerdictPill level={r.verdictLevel} /> },
                  { id: 'c', header: 'Clicks', width: '70px', align: 'right', cell: (r) => <span className="num">{fmtInt(r.clicks)}</span> },
                  { id: 't', header: 'Warning', width: '150px', cell: (r) => r.clickedThrough ? <StatusPill tone="crit">clicked through</StatusPill> : <span className="small muted">blocked / warned</span> },
                ]} />
              )}
            </Section>
          </div>

          {d.clicks.length > 0 && (
            <Section title="All clicks" className="mt-16" right={<span>{fmtInt(d.clicks.length)} clicks</span>}>
              <SimpleTable ariaLabel="Clicks" dense rows={d.clicks} rowKey={(r, ) => `${r.ts}-${r.upn}-${r.url}`} columns={[
                { id: 'ts', header: 'Time', width: '150px', cell: (r) => <span className="mono small">{t.dateTime(r.ts)}</span> },
                { id: 'u', header: 'User', width: 'auto', cell: (r) => <Link to={userUrl(wsId, r.upn)}>{r.upn}</Link> },
                { id: 'r', header: 'Result', width: '220px', cell: (r) => <span className={`small ${/through|allowed/i.test(r.result ?? '') ? 'tone-crit' : /block/i.test(r.result ?? '') ? 'tone-ok' : ''}`}>{r.result ?? '—'}</span> },
                { id: 'ip', header: 'From IP', width: '170px', cell: (r) => r.ip ? <Link to={ipUrl(wsId, r.ip)} className="ip-cell"><span className="mono">{r.ip}</span><CountryBadge cc={r.country} /></Link> : <span className="muted">—</span> },
                { id: 'url', header: 'URL', width: 'auto', cell: (r) => <span className="mono small ellipsis" style={{ maxWidth: 320, display: 'inline-block', verticalAlign: 'bottom' }} title={r.url}>{r.url}</span> },
                { id: 'm', header: 'Email', width: '90px', cell: (r) => r.networkMessageId ? <Link className="small" to={emailUrl(wsId, r.networkMessageId)}>open</Link> : <span className="muted">—</span> },
              ]} />
            </Section>
          )}
        </>
      ))}
      {!q && <div className="mt-16"><EmptyState compact title="Enter a link to check" text="Paste the full URL from the email, or just the domain." /></div>}
    </div>
  );
}
