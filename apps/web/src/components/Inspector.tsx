import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { EventDetail, Workspace } from '@audit/core';
import { useEvent, useUpdateWorkspace } from '../lib/queries';
import { fmtDateTime, useTime } from '../lib/time';
import { countryName } from '../lib/countries';
import { OWNER_LONG, fmtInt } from '../lib/format';
import { useToast } from '../lib/toast';
import { Drawer } from './Drawer';
import { JsonTree } from './JsonTree';
import { ErrorState, Skeleton } from './Basics';
import { CountryBadge, GroupChip, KindChip, OwnerBadge, ResultCell, SensitivePill, SourceChip, groupLabel } from './Badges';
import { IconUser } from './Icons';
import { friendly } from '../pages/Overview';

export function Inspector({ eventId, onClose, wsId, workspace, onPivot, width, setWidth }: {
  eventId: number | null; onClose: () => void; wsId: string; workspace: Workspace; width: number; setWidth: (v: number | ((prev: number) => number)) => void;
  /** Apply a filter set in the current activity view. */
  onPivot: (params: Record<string, string | null>) => void;
}) {
  const ev = useEvent(eventId);
  return (
    <Drawer open={eventId != null} onClose={onClose} ariaLabel="Event inspector" width={width} setWidth={setWidth} title={ev.data ? <Header e={ev.data} /> : <><Skeleton w="60%" h={18} /><Skeleton w="40%" h={12} style={{ marginTop: 6 }} /></>}>
      {ev.isError ? <ErrorState error={ev.error} retry={() => ev.refetch()} /> : !ev.data ? <InspectorSkeleton /> : <Body e={ev.data} wsId={wsId} workspace={workspace} onPivot={onPivot} />}
    </Drawer>
  );
}

function Header({ e }: { e: EventDetail }) {
  return (
    <div>
      <div className="row row-wrap gap-4" style={{ marginBottom: 2 }}><SourceChip id={e.source} /><GroupChip group={e.workloadGroup} workload={e.workload} /><KindChip kind={e.kind} /><SensitivePill family={e.sensitiveFamily} /></div>
      <div className="insp-op">{e.friendlyOperation ?? e.activity?.friendlyName ?? friendly(e.operation)}</div>
      <div className="insp-raw">{e.operation}{e.recordType ? ` · ${e.recordType}` : ''}</div>
      <div className="insp-times">
        <span>UTC <b>{fmtDateTime(e.ts, 'utc')}</b></span>
        <span>Local <b>{fmtDateTime(e.ts, 'local')}</b></span>
      </div>
    </div>
  );
}

function InspectorSkeleton() {
  return <div className="stack"><Skeleton h={12} w="70%" /><Skeleton h={12} w="50%" /><Skeleton h={12} w="80%" /><Skeleton h={12} w="40%" /><Skeleton h={200} style={{ marginTop: 12 }} /></div>;
}

function Fact({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  if (v === null || v === undefined || v === '') return null;
  return <><dt>{k}</dt><dd className={mono ? 'mono' : ''}>{v}</dd></>;
}

function Body({ e, wsId, workspace, onPivot }: { e: EventDetail; wsId: string; workspace: Workspace; onPivot: (p: Record<string, string | null>) => void }) {
  const t = useTime();
  const navigate = useNavigate();
  const { toast } = useToast();
  const update = useUpdateWorkspace(wsId);
  const expected = new Set(workspace.expectedCountries.map((c) => c.toUpperCase()));
  const unexpected = !!e.ipCountry && expected.size > 0 && !expected.has(e.ipCountry.toUpperCase()) && !e.ipOwner;
  const alreadyExcluded = useMemo(() => !!e.clientIp && workspace.excludedIps.split('\n').some((l) => l.replace(/#.*/, '').trim().split(/[\s,;]+/).includes(e.clientIp!)), [workspace.excludedIps, e.clientIp]);

  const addExclusion = () => {
    if (!e.clientIp) return;
    const line = `${e.clientIp}   # added ${new Date().toISOString().slice(0, 10)}`;
    const next = workspace.excludedIps.trim() ? `${workspace.excludedIps.replace(/\s+$/, '')}\n${line}` : line;
    update.mutate({ excludedIps: next }, { onSuccess: () => toast(`${e.clientIp} added to exclusions`, 'ok'), onError: (err) => toast(err.message, 'error') });
  };
  const hourAround = () => {
    if (!e.ts || !e.userUpn) return;
    const ms = new Date(e.ts).getTime();
    onPivot({ user: e.userUpn, from: new Date(ms - 36e5).toISOString(), to: new Date(ms + 36e5).toISOString(), session: null, mid: null, nmid: null });
  };
  const sessionCount = e.related.bySession, msgCount = e.related.byMessage, corrCount = e.related.byCorrelation;

  return (
    <div>
      <dl className="facts">
        <Fact k="User" v={e.userUpn ? <span className="row gap-4"><Link to={`/w/${wsId}/investigate/user/${encodeURIComponent(e.userUpn)}`}>{e.userUpn}</Link>{e.userType && <span className="small muted">({e.userType})</span>}</span> : null} />
        <Fact k={e.kind === 'mail' || e.kind === 'msg' ? 'Counterpart / mailbox' : 'Counterpart'} v={e.counterpart} />
        <Fact k="Result" v={<ResultCell result={e.result} failed={e.failed} />} />
        <Fact k="Client IP" v={e.clientIp ? <span className="row row-wrap gap-4"><span className="mono">{e.clientIp}</span><CountryBadge cc={e.ipCountry} alert={unexpected} />{e.ipCountry && <span className={unexpected ? 'tone-crit' : 'muted'}>{countryName(e.ipCountry)}{unexpected ? ' — outside expected countries' : ''}</span>}<OwnerBadge owner={e.ipOwner} name={e.ipOwnerName} />{e.ipOwner && <span className="muted small">{e.ipOwnerName ?? OWNER_LONG[e.ipOwner] ?? e.ipOwner}</span>}</span> : null} />
        <Fact k="User agent" v={e.userAgent} mono />
        <Fact k="Workload" v={<span>{e.workload ?? '—'} <span className="muted small">· {groupLabel(e.workloadGroup)}</span></span>} />
        <Fact k="Record type" v={e.recordType ? <span>{e.recordType}{e.recordTypeId != null && <span className="muted small"> (#{e.recordTypeId})</span>}{e.recordTypeDescription && e.recordTypeDescription !== e.recordType && <div className="small muted">{e.recordTypeDescription}</div>}</span> : null} />
        <Fact k="Item" v={e.item} />
        <Fact k="Details" v={e.detail} />
        <Fact k="Object" v={e.objectId} mono />
        <Fact k="Session" v={e.sessionId} mono />
        <Fact k="Correlation" v={e.correlationId} mono />
        <Fact k="Message id" v={e.messageId} mono />
        <Fact k="Network msg id" v={e.networkMessageId} mono />
        <Fact k="Record id" v={e.sourceRecordId} mono />
        <Fact k="Import" v={<span className="row row-wrap gap-4"><Link className="mono small" to={`/w/${wsId}/activity?importId=${e.importId}`}>{e.import?.fileName ?? e.importId}</Link>{e.import?.formatLabel && <span className="small muted">{e.import.formatLabel}</span>}{e.import?.createdAt && <span className="small muted">· {t.relative(e.import.createdAt)}</span>}</span>} />
      </dl>

      {e.activity?.description && <div className="insp-desc"><strong>{e.activity.friendlyName}.</strong> {e.activity.description}</div>}

      <div className="insp-section">Pivot</div>
      <div className="pivots">
        {e.sessionId && <button className="btn btn-sm" onClick={() => onPivot({ session: e.sessionId, user: null, from: null, to: null, mid: null, nmid: null })}>{fmtInt(sessionCount)} events in this sign-in session</button>}
        {(e.messageId || e.networkMessageId) && <button className="btn btn-sm" onClick={() => onPivot(e.networkMessageId ? { nmid: e.networkMessageId, mid: null, session: null, user: null } : { mid: e.messageId, nmid: null, session: null, user: null })}>{fmtInt(msgCount)} events for the same message</button>}
        {e.correlationId && corrCount > 1 && <button className="btn btn-sm" onClick={() => onPivot({ q: `correlation:${e.correlationId}` })}>{fmtInt(corrCount)} with this correlation</button>}
        {e.userUpn && e.ts && <button className="btn btn-sm" onClick={hourAround}>±1 hour for this user</button>}
        {e.userUpn && <button className="btn btn-sm" onClick={() => navigate(`/w/${wsId}/investigate/user/${encodeURIComponent(e.userUpn!)}`)}><IconUser size={13} /> Investigate user</button>}
        {e.clientIp && <button className="btn btn-sm" onClick={() => onPivot({ ip: e.clientIp, session: null })}>All from {e.clientIp}</button>}
        {e.clientIp && <button className="btn btn-sm" disabled={alreadyExcluded || update.isPending} onClick={addExclusion} title={alreadyExcluded ? 'Already in the exclusion list' : 'Append this IP to the workspace exclusion rules'}>{alreadyExcluded ? 'IP already excluded' : 'Add IP to exclusions'}</button>}
      </div>

      <div className="insp-section">Raw record</div>
      <JsonTree value={e.raw} />
      {e.envelope && Object.keys(e.envelope).length > 0 && (
        <>
          <div className="insp-section">Export envelope</div>
          <JsonTree value={e.envelope} />
        </>
      )}
    </div>
  );
}
