import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, endpoints } from '../lib/api';
import { keys } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { IconAlert } from '../components/Icons';

export function LoginPage() {
  const [sp] = useSearchParams();
  const next = sp.get('next') || '/';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loading && user) navigate(next.startsWith('/') ? next : '/', { replace: true }); }, [user, loading, navigate, next]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const u = await endpoints.login(email.trim(), password);
      qc.setQueryData(keys.me, u);
      navigate(next.startsWith('/') ? next : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 429 ? 'Too many attempts. Wait a minute and try again.' : err.message) : 'Sign-in failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit} aria-labelledby="login-title">
        <div className="brand"><img src="/icon.svg" alt="" /><span id="login-title">Audit Explorer</span></div>
        <p className="muted small" style={{ margin: 0 }}>Microsoft 365 unified audit &amp; investigation platform. Sign in with your analyst account.</p>
        <label className="field"><span>Email</span><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="form-error" role="alert"><IconAlert size={14} />{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ height: 34, justifyContent: 'center' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
