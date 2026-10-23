import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { User } from '@audit/core';
import { ApiError, endpoints } from '../lib/api';
import { keys, useUsers } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { useTime } from '../lib/time';
import { useToast } from '../lib/toast';
import { ConfirmDialog, Dialog, ErrorState, Section, SkeletonRows } from '../components/Basics';
import { SimpleTable } from '../components/DataTable';
import { StatusPill } from '../components/Badges';
import { PlainTop } from './Workspaces';
import { IconPlus } from '../components/Icons';

export function AdminUsersPage() {
  const { user } = useAuth();
  const users = useUsers();
  const qc = useQueryClient();
  const t = useTime();
  const { toast } = useToast();
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState<User | null>(null);
  const [del, setDel] = useState<User | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.users });
  const remove = useMutation({ mutationFn: (id: string) => endpoints.deleteUser(id), onSuccess: () => { invalidate(); setDel(null); toast('User deleted', 'ok'); }, onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error') });
  const role = useMutation({ mutationFn: ({ id, role }: { id: string; role: 'admin' | 'analyst' }) => endpoints.updateUser(id, { role }), onSuccess: () => { invalidate(); toast('Role updated', 'ok'); }, onError: (e) => toast(e instanceof ApiError ? e.message : 'Failed', 'error') });
  if (user && user.role !== 'admin') return <Navigate to="/" replace />;
  return (
    <>
      <PlainTop title="Users" />
      <main className="plain-main">
        <div className="page" style={{ maxWidth: 960 }}>
          <div className="page-head"><div><h1>Users</h1><p>Analysts can use every workspace. Admins can also manage users and delete workspaces.</p></div><button className="btn btn-primary" onClick={() => setAdd(true)}><IconPlus size={14} /> Add user</button></div>
          <Section>
            {users.isPending ? <SkeletonRows rows={4} /> : users.isError ? <ErrorState error={users.error} retry={() => users.refetch()} /> : (
              <SimpleTable ariaLabel="Users" rows={users.data} rowKey={(u) => u.id} columns={[
                { id: 'name', header: 'Name', width: 'auto', cell: (u) => <div className="cell-2"><span style={{ fontWeight: 500 }}>{u.name}{u.id === user?.id && <span className="muted"> (you)</span>}</span><span className="cell-sub">{u.email}</span></div> },
                { id: 'role', header: 'Role', width: '140px', cell: (u) => (
                  <select aria-label={`Role for ${u.email}`} value={u.role} disabled={u.id === user?.id || role.isPending} onChange={(e) => role.mutate({ id: u.id, role: e.target.value as 'admin' | 'analyst' })} style={{ height: 26 }}>
                    <option value="analyst">analyst</option><option value="admin">admin</option>
                  </select>) },
                { id: 'last', header: 'Last sign-in', width: '160px', cell: (u) => <span className="small muted" title={t.dateTime(u.lastLoginAt)}>{u.lastLoginAt ? t.relative(u.lastLoginAt) : 'never'}</span> },
                { id: 'created', header: 'Created', width: '140px', cell: (u) => <span className="small muted mono">{t.date(u.createdAt)}</span> },
                { id: 'actions', header: '', width: '200px', align: 'right', cell: (u) => <span className="row" style={{ justifyContent: 'flex-end', gap: 4 }}><button className="btn btn-sm" onClick={() => setEdit(u)}>Set password</button><button className="btn btn-sm btn-danger" disabled={u.id === user?.id} onClick={() => setDel(u)}>Delete</button></span> },
              ]} />
            )}
          </Section>
        </div>
      </main>
      <UserDialog open={add} onClose={() => setAdd(false)} onSaved={invalidate} />
      {edit && <StatusPasswordDialog user={edit} onClose={() => setEdit(null)} />}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del.id)} busy={remove.isPending} title="Delete user" text={<>Delete <strong>{del?.email}</strong>? Their sessions end immediately. This cannot be undone.</>} />
    </>
  );
}

function UserDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [roleV, setRole] = useState<'admin' | 'analyst'>('analyst'); const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const m = useMutation({ mutationFn: () => endpoints.createUser({ email: email.trim(), name: name.trim(), role: roleV, password }), onSuccess: () => { onSaved(); onClose(); toast('User created', 'ok'); setEmail(''); setName(''); setPassword(''); setRole('analyst'); }, onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed.') });
  const submit = (e: FormEvent) => { e.preventDefault(); setError(null); m.mutate(); };
  return (
    <Dialog open={open} onClose={onClose} title="Add user" width={440}>
      <form className="stack" onSubmit={submit}>
        <label className="field"><span>Name</span><input required value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label className="field"><span>Email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Role</span><select value={roleV} onChange={(e) => setRole(e.target.value as 'admin' | 'analyst')}><option value="analyst">Analyst</option><option value="admin">Admin</option></select></label>
        <label className="field"><span>Initial password</span><input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /><span className="field-help">At least 10 characters.</span></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={m.isPending}>{m.isPending ? 'Creating…' : 'Create user'}</button></div>
      </form>
    </Dialog>
  );
}

function StatusPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState(''); const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const m = useMutation({ mutationFn: () => endpoints.updateUser(user.id, { password }), onSuccess: () => { toast('Password set; their sessions were signed out', 'ok'); onClose(); }, onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed.') });
  return (
    <Dialog open onClose={onClose} title={`Set password for ${user.name}`} width={420}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); setError(null); m.mutate(); }}>
        <div className="row small muted"><StatusPill tone="neutral">{user.role}</StatusPill>{user.email}</div>
        <label className="field"><span>New password</span><input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Set password'}</button></div>
      </form>
    </Dialog>
  );
}
