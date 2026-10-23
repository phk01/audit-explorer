import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { usePrefs } from '../lib/prefs';
import { useAuth } from '../lib/auth';
import { ApiError, endpoints } from '../lib/api';
import { useToast } from '../lib/toast';
import { tzLabel } from '../lib/time';
import { Dialog } from './Basics';
import { IconMoon, IconSun, IconUser } from './Icons';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = usePrefs();
  const dark = resolvedTheme === 'dark';
  return (
    <button className="icon-btn" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}

export function TzToggle() {
  const { tz, setTz } = usePrefs();
  return (
    <div className="seg" role="group" aria-label="Time zone for displayed times">
      <button className={tz === 'utc' ? 'is-active' : ''} aria-pressed={tz === 'utc'} onClick={() => setTz('utc')} title="Show all times in UTC">UTC</button>
      <button className={tz === 'local' ? 'is-active' : ''} aria-pressed={tz === 'local'} onClick={() => setTz('local')} title={`Show all times in your local time zone (${tzLabel('local')})`}>Local</button>
    </div>
  );
}

export function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!user) return null;
  return (
    <div className="menu" ref={ref}>
      <button className={`icon-btn ${open ? 'is-active' : ''}`} aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><IconUser /></button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="menu-head"><div style={{ fontWeight: 600 }}>{user.name}</div><div className="small muted">{user.email} · {user.role}</div></div>
          {user.role === 'admin' && <Link className="menu-item" role="menuitem" to="/admin/users" onClick={() => setOpen(false)}>Users</Link>}
          <Link className="menu-item" role="menuitem" to="/" onClick={() => setOpen(false)}>All workspaces</Link>
          <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); setPw(true); }}>Change password</button>
          <button className="menu-item" role="menuitem" onClick={() => void signOut()}>Sign out</button>
        </div>
      )}
      <ChangePasswordDialog open={pw} onClose={() => setPw(false)} />
    </div>
  );
}

export function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { setError('The new passwords do not match.'); return; }
    if (next.length < 10) { setError('Use at least 10 characters.'); return; }
    setBusy(true); setError(null);
    try { await endpoints.changePassword(current, next); toast('Password changed', 'ok'); onClose(); setCurrent(''); setNext(''); setConfirm(''); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Failed.'); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Change password" width={420}>
      <form onSubmit={submit} className="stack">
        <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label className="field"><span>New password</span><input type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} /><span className="field-help">At least 10 characters.</span></label>
        <label className="field"><span>Repeat new password</span><input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
      </form>
    </Dialog>
  );
}
