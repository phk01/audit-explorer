import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Finding, StoryMoment, TimelineLine, UserInvestigation, Verdict, VerdictIndicator } from '@audit/core';
import { useWorkspaceCtx } from './WorkspaceShell';
import { useTimeline, useUserInvestigation } from '../lib/queries';
import { useLocalPref } from '../lib/url';
import { fromInputValue, useTime } from '../lib/time';
import { usePrefs } from '../lib/prefs';
import { fmtInt, plural } from '../lib/format';
import { countryName } from '../lib/countries';
import { evidenceUrl } from '../lib/event-query';
import { ApiError } from '../lib/api';
import { EmptyState, ErrorState, Section, Skeleton } from '../components/Basics';
import { CountryBadge, OwnerBadge, PersonKindPill, sourceLabel } from '../components/Badges';
import { FindingActions, FindingStatusPill, ipUrl } from '../components/Findings';
import { SeverityPill, VERDICT, VerdictPill } from '../components/Verdict';
import { EventInspectorHost, useEventInspector } from '../components/EventInspectorHost';
import { IconChevronRight, IconClose } from '../components/Icons';
import { PersonBody } from './Person';
import { urlUrl } from './Investigate';

export function InvestigateUserPage() {
  const { wsId } = useWorkspaceCtx();
  const { upn: raw = '' } = useParams();
  const upn = decodeURIComponent(raw);
  const inv = useUserInvestigation(wsId, upn);
  const insp = useEventInspector();
  const t = useTime();
  const d = inv.data;
  const initials = upn.split('@')[0].split(/[._-]/).map((s) => s[0]?.toUpperCase() ?? '').join('').slice(0, 2) || '?';
  const act = `/w/${wsId}/activity?${new URLSearchParams({ user: upn }).toString()}`;

  if (inv.isError) {
    const notFound = inv.error instanceof ApiError && inv.error.status === 404;
    return (
      <div className="page">
        <div className="page-head"><div><h1 style={{ wordBreak: 'break-all' }}>{upn}</h1></div></div>
        {notFound ? <EmptyState title="No activity for this account" text={<>Nothing in the imported data mentions <span className="mono">{upn}</span>. Check the spelling, or look at Data Coverage to see which logs were imported.</>} action={{ label: 'Back to Investigate', to: `/w/${wsId}` }} /> : <ErrorState error={inv.error} retry={() => inv.refetch()} />}
      </div>
    );
  }

  return (
    <div className="page investigate">
      <div className="page-head">
        <div className="person-head">
          <span className={`avatar ${d ? `avatar-${d.verdict.level}` : ''}`} aria-hidden>{initials}</span>
          <div>
            <h1 style={{ wordBreak: 'break-all' }}>{d?.person?.displayName ?? upn.split('@')[0]}</h1>
            <div className="row row-wrap small muted" style={{ marginTop: 4 }}>
              <span className="mono">{upn}</span>
              {d?.person && <PersonKindPill kind={d.person.kind} />}
              {d && <VerdictPill level={d.verdict.level} />}
            </div>
          </div>
        </div>
        <div className="row"><Link className="btn" to={`/w/${wsId}/people`}>All people</Link><Link className="btn" to={act}>All events</Link></div>
      </div>

      {!d ? <VerdictSkeleton /> : (
        <>
          <VerdictCard v={d.verdict} findings={d.findings} wsId={wsId} onOpenEvent={insp.open} />
          <p className="data-window small muted">
            Based on {plural(d.person?.events ?? 0, 'event')} between {t.date(d.dataWindow.from)} and {t.date(d.dataWindow.to)} from {d.dataWindow.sources.length ? d.dataWindow.sources.map((s) => sourceLabel(s)).join(', ') : 'no sources'}.
          </p>

          {d.phishing && (d.phishing.clicks || d.phishing.flaggedClicks || d.phishing.phishMailReceived || d.phishing.zapped) ? <PhishingStrip inv={d} wsId={wsId} /> : null}

          <Section title="Story" className="story-card">
            <p className="muted small" style={{ marginBottom: 14 }}>The moments that matter, in order. Click a moment to open the underlying event.</p>
            <Story moments={d.story} findings={d.findings} wsId={wsId} onOpenEvent={insp.open} />
          </Section>

          <FullTimeline upn={upn} wsId={wsId} window={d.dataWindow} onOpenEvent={insp.open} />

          <details className="details-card card">
            <summary><span className="details-title">Details &amp; statistics</span><span className="small muted">Client IPs, clients, operations, workloads, countries, counterparts and the weekday × hour heatmap.</span><span className="finding-chev"><IconChevronRight size={14} /></span></summary>
            <div className="details-body"><PersonBody d={d.person} upn={upn} loading={false} /></div>
          </details>
        </>
      )}
      <EventInspectorHost eventId={insp.eventId} onClose={insp.close} />
    </div>
  );
}

function VerdictSkeleton() {
  return <div className="verdict verdict-insufficient"><div className="verdict-body"><Skeleton w="40%" h={22} /><Skeleton w="90%" h={14} style={{ marginTop: 12 }} /><Skeleton w="80%" h={14} style={{ marginTop: 6 }} /><Skeleton w="60%" h={14} style={{ marginTop: 6 }} /></div></div>;
}

// ------------------------------------------------------------------ verdict

function VerdictCard({ v, findings, wsId, onOpenEvent }: { v: Verdict; findings: Finding[]; wsId: string; onOpenEvent: (id: number | string) => void }) {
  const own = v.indicators.filter((i) => !i.targetedOnly);
  const targeted = v.indicators.filter((i) => i.targetedOnly);
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  return (
    <section className={`verdict verdict-${v.level}`} aria-label="Verdict">
      <div className="verdict-body">
        <div className="verdict-level">{VERDICT[v.level]?.label ?? v.level}</div>
        <h2 className="verdict-headline">{v.headline}</h2>
        <p className="verdict-summary">{v.summary}</p>

        {own.length > 0 && (
          <>
            <div className="verdict-sub">What points to it</div>
            <ul className="ind-list">{own.map((i, n) => <IndicatorRow key={`${i.findingId ?? n}`} ind={i} finding={i.findingId ? byId.get(i.findingId) : undefined} wsId={wsId} onOpenEvent={onOpenEvent} />)}</ul>
          </>
        )}
        {targeted.length > 0 && (
          <div className="targeted">
            <div className="verdict-sub">Targeted by <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· attacker activity against many accounts; this is not evidence against this user</span></div>
            <ul className="ind-list ind-list-quiet">{targeted.map((i, n) => <IndicatorRow key={`${i.findingId ?? n}`} ind={i} finding={i.findingId ? byId.get(i.findingId) : undefined} wsId={wsId} quiet onOpenEvent={onOpenEvent} />)}</ul>
          </div>
        )}
        {v.blindSpots.length > 0 && (
          <div className="blind">
            <div className="verdict-sub">What we couldn't see</div>
            <ul>{v.blindSpots.map((b, i) => <li key={i}>{b}</li>)}</ul>
          </div>
        )}
      </div>
    </section>
  );
}

function IndicatorRow({ ind, finding, wsId, quiet, onOpenEvent }: { ind: VerdictIndicator; finding?: Finding; wsId: string; quiet?: boolean; onOpenEvent: (id: number | string) => void }) {
  const [open, setOpen] = useState(false);
  const t = useTime();
  const dismissed = finding?.status === 'dismissed';
  return (
    <li className={`ind ${open ? 'is-open' : ''} ${dismissed ? 'is-dismissed' : ''}`}>
      <button type="button" className="ind-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="finding-chev"><IconChevronRight size={14} /></span>
        <SeverityPill severity={ind.severity} quiet={quiet} />
        <span className="ind-title">{ind.title}{finding && <FindingStatusPill status={finding.status} />}</span>
        {ind.ts && <span className="small muted mono nowrap">{t.dateTime(ind.ts, { seconds: false })}</span>}
      </button>
      {open && (
        <div className="ind-body">
          <p>{ind.text}</p>
          <div className="row row-wrap gap-12 mb-8">
            {ind.evidenceQuery && <Link className="btn btn-sm" to={evidenceUrl(wsId, ind.evidenceQuery)}>Show evidence{finding ? ` (${fmtInt(finding.eventCount)})` : ''}</Link>}
            {finding?.entityType === 'ip' && finding.entityValue && <Link className="btn btn-sm" to={ipUrl(wsId, finding.entityValue)}>Open IP {finding.entityValue}</Link>}
            {finding && finding.eventIds.length > 0 && finding.eventIds.length <= 3 && finding.eventIds.map((id) => <button key={String(id)} className="btn btn-sm" onClick={() => onOpenEvent(id)}>Open event</button>)}
          </div>
          {finding && <FindingActions finding={finding} wsId={wsId} compact />}
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ phishing strip

function PhishingStrip({ inv, wsId }: { inv: UserInvestigation; wsId: string }) {
  const p = inv.phishing!;
  const clickMoment = inv.story.find((m) => m.kind === 'click' && /https?:\/\//.test(m.sentence));
  const url = clickMoment ? clickMoment.sentence.match(/https?:\/\/\S+/)?.[0] : null;
  const act = (q: Record<string, string>) => `/w/${wsId}/emails?${new URLSearchParams({ user: inv.upn, ...q }).toString()}`;
  const tile = (label: string, value: number, to: string, tone?: 'crit' | 'warn') => (
    <Link to={to} className={`phish-tile ${value && tone ? `is-${tone}` : ''}`}><span className="phish-value">{fmtInt(value)}</span><span className="phish-label">{label}</span></Link>
  );
  return (
    <section className="phish" aria-label="Phishing exposure">
      <div className="phish-head">Phishing exposure</div>
      <div className="phish-tiles">
        {tile('phishing mails received', p.phishMailReceived, act({ kind: 'msg' }), 'warn')}
        {tile('links clicked', p.clicks, url ? urlUrl(wsId, url) : act({ kind: 'click' }), 'warn')}
        {tile('clicked through a warning', p.flaggedClicks, url ? urlUrl(wsId, url) : act({ kind: 'click' }), 'crit')}
        {tile('removed by ZAP after delivery', p.zapped, act({ kind: 'msgpost' }))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ story

function Story({ moments, findings, wsId, onOpenEvent }: { moments: StoryMoment[]; findings: Finding[]; wsId: string; onOpenEvent: (id: number | string) => void }) {
  const t = useTime();
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  if (!moments.length) return <div className="muted small">Nothing to tell: the account has no notable moments in the imported data.</div>;
  let lastDay = '';
  return (
    <ol className="story">
      {moments.map((m, i) => {
        const day = t.date(m.ts);
        const marker = day !== lastDay; lastDay = day;
        const f = m.findingId ? byId.get(m.findingId) : undefined;
        return (
          <li key={i} className={`moment sev-${m.severity} kind-${m.kind} ${f?.status === 'dismissed' ? 'is-dismissed' : ''}`}>
            {marker && <div className="story-day">{day}</div>}
            <Moment m={m} finding={f} wsId={wsId} onOpenEvent={onOpenEvent} />
          </li>
        );
      })}
    </ol>
  );
}

function Moment({ m, finding, wsId, onOpenEvent }: { m: StoryMoment; finding?: Finding; wsId: string; onOpenEvent: (id: number | string) => void }) {
  const [open, setOpen] = useState(false);
  const t = useTime();
  const expandable = !!(m.detail || m.evidenceQuery || m.eventId);
  return (
    <div className="moment-row">
      <span className="moment-dot" aria-hidden />
      <span className="moment-time mono">{t.time(m.ts).slice(0, 5)}</span>
      <div className="moment-main">
        <button type="button" className={`moment-sentence ${expandable ? 'is-expandable' : ''}`} onClick={() => { if (m.eventId && !m.detail && !m.evidenceQuery) onOpenEvent(m.eventId); else if (expandable) setOpen((o) => !o); }} aria-expanded={expandable ? open : undefined}>
          {m.sentence}{finding && <FindingStatusPill status={finding.status} />}
        </button>
        {open && (
          <div className="moment-detail">
            {m.detail && <p>{m.detail}</p>}
            <div className="row row-wrap gap-12">
              {m.eventId && <button className="btn btn-sm" onClick={() => onOpenEvent(m.eventId!)}>Open event</button>}
              {m.evidenceQuery && <Link className="btn btn-sm" to={evidenceUrl(wsId, m.evidenceQuery)}>Show evidence</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ full timeline

function FullTimeline({ upn, wsId, window: win, onOpenEvent }: { upn: string; wsId: string; window: UserInvestigation['dataWindow']; onOpenEvent: (id: number | string) => void }) {
  const [routine, setRoutine] = useLocalPref('ae.timeline.routine', false);
  const [newestFirst, setNewestFirst] = useLocalPref('ae.timeline.newest', false);
  const [limit, setLimit] = useState(80);
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const { tz } = usePrefs();
  const q = useMemo(() => ({ user: upn, routine: routine ? '1' as const : '0' as const, from: fromDay ? fromInputValue(`${fromDay}T00:00`, tz) ?? undefined : undefined, to: toDay ? fromInputValue(`${toDay}T23:59:59`, tz) ?? undefined : undefined }), [upn, routine, fromDay, toDay, tz]);
  const tl = useTimeline(wsId, q);
  const lines = useMemo(() => { const l = tl.data?.lines ?? []; return newestFirst ? [...l].reverse() : l; }, [tl.data, newestFirst]);
  const t = useTime();
  const { workspace } = useWorkspaceCtx();
  const expected = useMemo(() => new Set(workspace.expectedCountries.map((c) => c.toUpperCase())), [workspace.expectedCountries]);
  const minDay = win.from ? win.from.slice(0, 10) : undefined, maxDay = win.to ? win.to.slice(0, 10) : undefined;

  let lastDay = '';
  return (
    <Section title="Full timeline" className="timeline-card" right={<span>{tl.data ? `${fmtInt(tl.data.lines.length)} lines${tl.data.truncated ? ' · truncated, narrow the date range' : ''}` : ''}</span>}>
      <div className="tl-controls">
        <button className={`toggle ${routine ? 'is-on' : ''}`} aria-pressed={routine} onClick={() => setRoutine((v) => !v)} title="Routine lines are everyday activity (file reads, mail reads, normal sign-ins) that the detections consider uninteresting"><span className="sw" aria-hidden />Show routine activity</button>
        <div className="seg" role="group" aria-label="Order">
          <button className={!newestFirst ? 'is-active' : ''} onClick={() => setNewestFirst(false)}>Oldest first</button>
          <button className={newestFirst ? 'is-active' : ''} onClick={() => setNewestFirst(true)}>Newest first</button>
        </div>
        <div className="daterange">
          <input type="date" aria-label="From day" value={fromDay} min={minDay} max={toDay || maxDay} onChange={(e) => setFromDay(e.target.value)} />
          <span className="muted">–</span>
          <input type="date" aria-label="To day" value={toDay} min={fromDay || minDay} max={maxDay} onChange={(e) => setToDay(e.target.value)} />
          {(fromDay || toDay) && <button className="icon-btn" aria-label="Clear date range" onClick={() => { setFromDay(''); setToDay(''); }}><IconClose size={14} /></button>}
        </div>
      </div>
      {tl.isPending ? <div className="stack stack-8" style={{ padding: '8px 0' }}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={14} w={`${[70, 55, 80, 60, 75, 50][i]}%`} />)}</div>
        : tl.isError ? <ErrorState error={tl.error} retry={() => tl.refetch()} />
        : !lines.length ? <div className="muted small" style={{ padding: '8px 0' }}>{routine ? 'No activity in this range.' : 'No notable activity in this range. Switch on routine activity to see everything.'}</div>
        : (
          <ol className={`tl ${tl.isFetching ? 'is-refreshing' : ''}`}>
            {lines.slice(0, limit).map((l, i) => {
              const day = t.date(l.from);
              const marker = day !== lastDay; lastDay = day;
              return (
                <li key={`${l.from}-${l.operation}-${i}`} className={`tl-line ${l.routine ? 'is-routine' : ''} ${l.severity ? `sev-${l.severity}` : ''}`}>
                  {marker && <div className="story-day">{day}</div>}
                  <TimelineRow l={l} wsId={wsId} expected={expected} onOpenEvent={onOpenEvent} />
                </li>
              );
            })}
          </ol>
        )}
      {lines.length > limit && <div className="tl-more"><button className="btn btn-sm" onClick={() => setLimit((n) => n + 200)}>Show {fmtInt(Math.min(200, lines.length - limit))} more of {fmtInt(lines.length - limit)} remaining lines</button></div>}
    </Section>
  );
}

function TimelineRow({ l, wsId, expected, onOpenEvent }: { l: TimelineLine; wsId: string; expected: Set<string>; onOpenEvent: (id: number | string) => void }) {
  const [open, setOpen] = useState(false);
  const t = useTime();
  const span = l.to !== l.from ? `${t.time(l.from).slice(0, 5)}–${t.time(l.to).slice(0, 5)}` : t.time(l.from).slice(0, 5);
  const unexpected = !!l.ipCountry && expected.size > 0 && !expected.has(l.ipCountry.toUpperCase()) && !l.ipOwner;
  return (
    <div className="tl-row">
      <span className="tl-dot" aria-hidden />
      <span className="tl-time mono" title={`${t.dateTime(l.from)} → ${t.dateTime(l.to)}`}>{span}</span>
      <div className="tl-main">
        <button type="button" className="tl-sentence" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span>{l.sentence}</span>
          {l.severity && <SeverityPill severity={l.severity} />}
        </button>
        <div className="tl-meta small muted">
          {l.ip && <Link to={ipUrl(wsId, l.ip)} className="ip-cell" onClick={(e) => e.stopPropagation()}><span className="mono">{l.ip}</span><CountryBadge cc={l.ipCountry} alert={unexpected} />{l.ipCountry && <span className={unexpected ? 'tone-crit' : ''}>{countryName(l.ipCountry)}</span>}<OwnerBadge owner={l.ipOwner} /></Link>}
          {l.client && <span>{l.client}</span>}
          {l.count > 1 && <span className="num">{fmtInt(l.count)} events</span>}
        </div>
        {open && (
          <div className="tl-detail">
            {l.items.length > 0 && <ul className="tl-items">{l.items.slice(0, 25).map((it, i) => <li key={i} className="ellipsis" title={it}>{it}</li>)}{l.items.length > 25 && <li className="muted">+{l.items.length - 25} more</li>}</ul>}
            <div className="row row-wrap gap-4">
              {l.eventIds.slice(0, 8).map((id, i) => <button key={String(id)} className="btn btn-sm" onClick={() => onOpenEvent(id)}>{l.eventIds.length === 1 ? 'Open event' : `Event ${i + 1}`}</button>)}
              {l.eventIds.length > 8 && <Link className="btn btn-sm" to={evidenceUrl(wsId, { user: l.user ?? undefined, op: l.operation, from: l.from, to: l.to })}>All {fmtInt(l.eventIds.length)} events</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
