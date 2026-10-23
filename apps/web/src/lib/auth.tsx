import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@audit/core';
import { endpoints, onUnauthorized } from './api';
import { keys, useMe } from './queries';

interface AuthCtx { user: User | null; loading: boolean; signOut: () => Promise<void>; refresh: () => void }
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => onUnauthorized(() => {
    qc.setQueryData(keys.me, null);
    if (!location.pathname.startsWith('/login')) {
      const next = location.pathname + location.search;
      navigate(`/login${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`, { replace: true });
    }
  }), [qc, navigate, location.pathname, location.search]);

  const value: AuthCtx = {
    user: me.data ?? null,
    loading: me.isPending,
    signOut: async () => { try { await endpoints.logout(); } finally { qc.clear(); navigate('/login', { replace: true }); } },
    refresh: () => { qc.invalidateQueries({ queryKey: keys.me }); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}

/** Gate: renders children only when signed in, otherwise redirects to /login (preserving the target). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!loading && !user) {
      const next = location.pathname + location.search;
      navigate(`/login${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`, { replace: true });
    }
  }, [loading, user, navigate, location.pathname, location.search]);
  if (loading) return <div className="app-loading"><div className="skeleton" style={{ width: 240, height: 14 }} /></div>;
  if (!user) return null;
  return <>{children}</>;
}
