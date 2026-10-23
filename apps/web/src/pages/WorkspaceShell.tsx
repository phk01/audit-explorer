import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import type { Workspace } from '@audit/core';
import { useWorkspace, useWorkspaces } from '../lib/queries';
import { useLocalPref } from '../lib/url';
import { ImportStreamProvider, useImportStream } from '../lib/imports-stream';
import { fmtInt, fmtPct } from '../lib/format';
import { ThemeToggle, TzToggle, UserMenu } from '../components/TopControls';
import { ErrorState } from '../components/Basics';
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconMenu, IconSearch } from '../components/Icons';

export interface ShellCtx { workspace: Workspace; wsId: string }
export function useWorkspaceCtx(): ShellCtx { return useOutletContext<ShellCtx>(); }

const ico = (d: string) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '', label: 'Investigate', end: true, icon: ico('M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-3.5-3.5M11 8v3l2 2') },
  { to: 'people', label: 'People', icon: ico('M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 9v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8') },
  { to: 'activity', label: 'Global Activity', icon: ico('M3 12h4l3-8 4 16 3-8h4') },
  { to: 'emails', label: 'Emails', icon: ico('M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0 9 6 9-6') },
  { to: 'files', label: 'SharePoint & OneDrive', icon: ico('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z') },
  { to: 'teams', label: 'Teams', icon: ico('M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z') },
  { to: 'identity', label: 'Identity & Access', icon: ico('M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4') },
  { to: 'administration', label: 'Administration', icon: ico('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.8-1L14.7 3H9.3l-.4 2.6a7.6 7.6 0 0 0-1.8 1l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.8 1.8 1l.4 2.6h5.4l.4-2.6c.7-.2 1.3-.6 1.8-1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1Z') },
  { to: 'security', label: 'Security & Compliance', icon: ico('M12 2 3 7v6c0 5.5 3.8 9.7 9 11 5.2-1.3 9-5.5 9-11V7l-9-5Zm0 6v5m0 3h.01') },
  { to: 'applications', label: 'Applications & Automation', icon: ico('M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z') },
  { to: 'cases', label: 'Cases & Investigations', icon: ico('M9 3h6l1 3h4v15H4V6h4l1-3Zm0 9 2 2 4-4') },
  { to: 'overview', label: 'Overview', icon: ico('M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-4H4v4Zm10-9h6V4h-6v7Z') },
  { to: 'coverage', label: 'Data Coverage & Health', icon: ico('M3 12h4l2-5 4 10 3-7 2 2h3M4 20h16') },
];
const NAV_BOTTOM = [
  { to: 'imports', label: 'Imports', icon: ico('M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3') },
  { to: 'settings', label: 'Settings', icon: ico('M4 6h16M4 12h16M4 18h16M8 4v4m8 2v4m-6 4v4') },
];

export function WorkspaceShell() {
  const { wsId = '' } = useParams();
  const ws = useWorkspace(wsId);
  const all = useWorkspaces();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useLocalPref('ae.sidebar.collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const investigating = /\/investigate(\/|$)/.test(useLocation().pathname);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setMobileOpen(false); }, [wsId]);
  useEffect(() => { if (ws.data) document.title = `${ws.data.name} · Audit Explorer`; return () => { document.title = 'Audit Explorer'; }; }, [ws.data]);

  const ctx = useMemo<ShellCtx | null>(() => (ws.data ? { workspace: ws.data, wsId } : null), [ws.data, wsId]);

  if (ws.isError) return <div className="page"><ErrorState error={ws.error} retry={() => ws.refetch()} /><a className="btn" href="/">All workspaces</a></div>;

  return (
    <ImportStreamProvider workspaceId={wsId}>
      <div className={`shell ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}>
        <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />
        <aside className="sidebar" aria-label="Workspace navigation">
          <div className="sidebar-top">
            <NavLink to="/" className="brand" title="All workspaces"><img src="/icon.svg" alt="" /><span>Audit Explorer</span></NavLink>
            <button className="icon-btn" style={{ marginLeft: 'auto' }} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed((c) => !c)}>{collapsed ? <IconChevronRight /> : <IconChevronLeft />}</button>
          </div>
          <div className="ws-switch">
            <select aria-label="Switch workspace" value={wsId} onChange={(e) => { if (e.target.value === '__all') navigate('/'); else navigate(`/w/${e.target.value}`); }}>
              {(all.data ?? (ws.data ? [ws.data] : [])).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              <option value="__all">All workspaces…</option>
            </select>
            <IconChevronDown size={14} />
          </div>
          <nav className="nav">
            {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} title={n.label} onClick={() => setMobileOpen(false)} className={n.to === '' && investigating ? 'active' : undefined}><span className="nav-ico">{n.icon}</span><span className="nav-txt">{n.label}</span></NavLink>)}
          </nav>
          <div className="nav-bottom">
            {NAV_BOTTOM.map((n) => <NavLink key={n.to} to={n.to} title={n.label} onClick={() => setMobileOpen(false)}><span className="nav-ico">{n.icon}</span><span className="nav-txt">{n.label}</span></NavLink>)}
          </div>
        </aside>
        <header className="topbar">
          <button className="icon-btn mobile-only" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><IconMenu /></button>
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); navigate(`/w/${wsId}/activity?q=${encodeURIComponent(q)}`); }}>
            <IconSearch size={15} />
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events: user:anna* op:new-inboxrule, Parameters.ForwardTo:*" aria-label="Search events" />
            <kbd aria-hidden>/</kbd>
          </form>
          <div className="topbar-right">
            <TzToggle />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="main" id="main">
          <LiveBanner />
          {ctx ? <Outlet context={ctx} /> : <div className="page"><span className="skeleton" style={{ width: 220, height: 24 }} /></div>}
        </main>
      </div>
    </ImportStreamProvider>
  );
}

function LiveBanner() {
  const { live } = useImportStream();
  const items = Object.values(live).filter((l) => l.status === 'queued' || l.status === 'detecting' || l.status === 'running' || Date.now() - l.updatedAt < 4000);
  if (!items.length) return null;
  const first = items[0];
  const pct = first.fileSize ? Math.min(100, (first.bytesProcessed / first.fileSize) * 100) : 0;
  const done = first.status === 'completed' || first.status === 'failed' || first.status === 'cancelled';
  return (
    <div className="live-banner" role="status" aria-live="polite">
      {!done && <span className="running-dot" aria-hidden />}
      <span style={{ fontWeight: 600 }}>{done ? (first.status === 'completed' ? 'Import completed' : `Import ${first.status}`) : first.status === 'queued' ? 'Queued' : first.status === 'detecting' ? 'Detecting format' : 'Importing'}</span>
      <span className="ellipsis" style={{ maxWidth: 260 }}>{first.fileName ?? first.formatLabel ?? first.importId.slice(0, 8)}</span>
      <div className={`progress ${first.fileSize ? '' : 'is-indeterminate'}`} aria-label="Progress"><span style={{ width: `${pct}%` }} /></div>
      <span className="mono small">{fmtInt(first.rowsProcessed)} rows · {fmtInt(first.eventsInserted)} inserted · {first.fileSize ? fmtPct(first.bytesProcessed, first.fileSize) : '…'}</span>
      {items.length > 1 && <span className="small">+{items.length - 1} more</span>}
    </div>
  );
}
