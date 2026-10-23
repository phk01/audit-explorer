import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Workspace } from '@audit/core';
import { ApiError, endpoints } from '../lib/api';
import { keys, useWorkspaces } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { useTime } from '../lib/time';
import { fmtInt } from '../lib/format';
import { ChipInput, Dialog, EmptyState, ErrorState, Skeleton } from '../components/Basics';
import { SourceChip } from '../components/Badges';
import { ThemeToggle, TzToggle, UserMenu } from '../components/TopControls';
import { IconPlus } from '../components/Icons';

export function PlainTop({ title }: { title?: string }) {
  const { user } = useAuth();
  return (
    <header className="plain-top">
      <Link to="/" className="brand"><img src="/icon.svg" alt="" /><span>Audit Explorer</span></Link>
      {title && <span className="muted">/ {title}</span>}
      <div className="topbar-right">
        {user?.role === 'admin' && <Link className="btn btn-ghost btn-sm" to="/admin/users">Users</Link>}
        <TzToggle />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

export function WorkspacesPage() {
  const ws = useWorkspaces();
  const [create, setCreate] = useState(false);
  const t = useTime();
  return (
    <>
      <PlainTop />
      <main className="plain-main">
        <div className="page">
          <div className="page-head">
            <div><h1>Workspaces</h1><p>One workspace per customer tenant or investigation. Imports, people and exclusion rules are scoped to the workspace.</p></div>
            <button className="btn btn-primary" onClick={() => setCreate(true)}><IconPlus size={14} /> New workspace</button>
          </div>
          {ws.isPending ? (
            <div className="ws-grid">{[0, 1, 2].map((i) => <div className="card ws-card" key={i}><Skeleton w="60%" h={20} /><Skeleton w="90%" /><Skeleton w="40%" /></div>)}</div>
          ) : ws.isError ? <ErrorState error={ws.error} retry={() => ws.refetch()} /> : !ws.data?.length ? (
            <EmptyState title="No workspaces yet" text="Create a workspace for the tenant you are investigating, then import the Purview, Entra, message-trace and Defender exports." action={{ label: 'New workspace', onClick: () => setCreate(true) }} />
          ) : (
            <div className="ws-grid">
              {ws.data.map((w) => {
                const s = w.stats;
                return (
                  <Link key={w.id} to={`/w/${w.id}`} className="card ws-card">
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <div className="grow"><h2>{w.name}</h2><div className="small muted">{w.tenantDomains.length ? w.tenantDomains.join(', ') : 'No tenant domains set'}</div></div>
                      {s && s.runningImports > 0 && <span className="pill pill-accent"><span className="running-dot" aria-hidden /> {s.runningImports} importing</span>}
                    </div>
                    <div className="ws-stats">
                      <div className="ws-stat"><b>{fmtInt(s?.events ?? 0)}</b><span>events</span></div>
                      <div className="ws-stat"><b>{fmtInt(s?.people ?? 0)}</b><span>people</span></div>
                      <div className="ws-stat"><b>{fmtInt(s?.imports ?? 0)}</b><span>imports</span></div>
                    </div>
                    <div className="small muted mono">{s?.firstEvent ? `${t.date(s.firstEvent)} → ${t.date(s.lastEvent)}` : 'No events yet'}</div>
                    <div className="chips">{(s?.sourcesCollected ?? []).map((src) => <SourceChip key={src} id={src} />)}{!s?.sourcesCollected.length && <span className="small muted">No sources imported</span>}</div>
                    <div className="small muted">Last import {s?.lastImportAt ? t.relative(s.lastImportAt) : 'never'}</div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
      <NewWorkspaceDialog open={create} onClose={() => setCreate(false)} />
    </>
  );
}

export function NewWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const m = useMutation({
    mutationFn: () => endpoints.createWorkspace({ name: name.trim(), tenantDomains: domains, expectedCountries: countries }),
    onSuccess: (w: Workspace) => { qc.invalidateQueries({ queryKey: keys.workspaces }); onClose(); navigate(`/w/${w.id}/imports`); },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to create workspace.'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!name.trim()) return; setError(null); m.mutate(); };
  return (
    <Dialog open={open} onClose={onClose} title="New workspace">
      <form onSubmit={submit} className="stack">
        <label className="field"><span>Name</span><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoso A/S — Q4 investigation" autoFocus /></label>
        <div className="field"><span className="field-label">Tenant domains</span><ChipInput label="Tenant domains" values={domains} onChange={setDomains} placeholder="contoso.com, contoso.onmicrosoft.com" transform={(s) => s.toLowerCase()} /><span className="field-help">Used to tell internal from external addresses in People.</span></div>
        <div className="field"><span className="field-label">Expected countries</span><ChipInput label="Expected countries" values={countries} onChange={setCountries} placeholder="DK, SE" transform={(s) => s.toUpperCase()} validate={(s) => /^[A-Z]{2}$/.test(s)} /><span className="field-help">ISO alpha-2 codes. Sign-ins from other countries are highlighted.</span></div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={m.isPending || !name.trim()}>{m.isPending ? 'Creating…' : 'Create workspace'}</button></div>
      </form>
    </Dialog>
  );
}
