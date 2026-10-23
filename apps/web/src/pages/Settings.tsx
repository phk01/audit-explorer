import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceCtx } from './WorkspaceShell';
import { keys, useUpdateWorkspace } from '../lib/queries';
import { ApiError, endpoints } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { ChipInput, ConfirmDialog, Section } from '../components/Basics';

export function SettingsPage() {
  const { wsId, workspace } = useWorkspaceCtx();
  const { user } = useAuth();
  const update = useUpdateWorkspace(wsId);
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState(workspace.name);
  const [domains, setDomains] = useState(workspace.tenantDomains);
  const [countries, setCountries] = useState(workspace.expectedCountries);
  const [notes, setNotes] = useState(workspace.notes);
  const [excluded, setExcluded] = useState(workspace.excludedIps);
  const [exMs, setExMs] = useState(workspace.excludeMicrosoftIps);
  const [exKeepit, setExKeepit] = useState(workspace.excludeKeepitIps);
  const [del, setDel] = useState(false);

  // if another view (inspector "add IP") changed the workspace, pick it up when we are not mid-edit of that field
  useEffect(() => { setExcluded((cur) => (cur === workspace.excludedIps ? cur : workspace.excludedIps)); }, [workspace.excludedIps]);

  const dirty = name !== workspace.name || domains.join() !== workspace.tenantDomains.join() || countries.join() !== workspace.expectedCountries.join() || notes !== workspace.notes || excluded !== workspace.excludedIps || exMs !== workspace.excludeMicrosoftIps || exKeepit !== workspace.excludeKeepitIps;
  const ruleCount = excluded.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    update.mutate({ name: name.trim(), tenantDomains: domains, expectedCountries: countries, notes, excludedIps: excluded, excludeMicrosoftIps: exMs, excludeKeepitIps: exKeepit }, {
      onSuccess: () => toast('Workspace saved', 'ok'),
      onError: (err) => toast(err instanceof ApiError ? err.message : 'Save failed', 'error'),
    });
  };
  const remove = useMutation({ mutationFn: () => endpoints.deleteWorkspace(wsId), onSuccess: () => { qc.invalidateQueries({ queryKey: keys.workspaces }); toast('Workspace deleted', 'ok'); navigate('/'); }, onError: (err) => toast(err instanceof ApiError ? err.message : 'Delete failed', 'error') });

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head"><div><h1>Settings</h1><p>Workspace identity, expected geography and the IP exclusion rules applied to every view.</p></div></div>
      <form onSubmit={submit} className="stack stack-16">
        <Section title="Workspace">
          <div className="form-grid">
            <label className="field span-2"><span>Name</span><input required value={name} onChange={(e) => setName(e.target.value)} /></label>
            <div className="field"><span className="field-label">Tenant domains</span><ChipInput label="Tenant domains" values={domains} onChange={setDomains} placeholder="contoso.com" transform={(s) => s.toLowerCase()} /><span className="field-help">Addresses outside these domains are classified as external in People.</span></div>
            <div className="field"><span className="field-label">Expected countries</span><ChipInput label="Expected countries" values={countries} onChange={setCountries} placeholder="DK" transform={(s) => s.toUpperCase()} validate={(s) => /^[A-Z]{2}$/.test(s)} /><span className="field-help">ISO alpha-2. Activity from other countries is highlighted in red.</span></div>
            <label className="field span-2"><span>Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scope, contacts, case references…" /></label>
          </div>
        </Section>

        <Section title="IP exclusions" right={<span>{ruleCount} rule{ruleCount === 1 ? '' : 's'}</span>}>
          <p className="small muted">Events from excluded client IPs are hidden from every view and count by default (the Exclusions toggle in Global Activity shows them again). One rule per line:</p>
          <ul className="small muted" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
            <li><code>203.0.113.7</code> — a single IPv4 or IPv6 address</li>
            <li><code>203.0.113.0/24</code> — a CIDR range</li>
            <li><code>203.0.113.*</code> — a glob (<code>*</code> and <code>?</code>)</li>
            <li><code># text</code> — comments; the inspector's "Add IP to exclusions" appends <code>ip   # added YYYY-MM-DD</code></li>
          </ul>
          <textarea className="mono" rows={8} value={excluded} onChange={(e) => setExcluded(e.target.value)} aria-label="IP exclusion rules" placeholder={'203.0.113.7   # office NAT\n198.51.100.0/24'} spellCheck={false} style={{ width: '100%' }} />
          <div className="stack stack-8 mt-8">
            <label className="check"><input type="checkbox" checked={exMs} onChange={(e) => setExMs(e.target.checked)} />Exclude Microsoft 365 and Microsoft service IPs <span className="muted small">(owner M365 / MS svc — server-side activity such as Exchange background processing)</span></label>
            <label className="check"><input type="checkbox" checked={exKeepit} onChange={(e) => setExKeepit(e.target.checked)} />Exclude Keepit backup IPs <span className="muted small">(backup service reads every mailbox and site)</span></label>
          </div>
        </Section>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {dirty && <span className="small muted">Unsaved changes</span>}
          <button type="button" className="btn" disabled={!dirty || update.isPending} onClick={() => { setName(workspace.name); setDomains(workspace.tenantDomains); setCountries(workspace.expectedCountries); setNotes(workspace.notes); setExcluded(workspace.excludedIps); setExMs(workspace.excludeMicrosoftIps); setExKeepit(workspace.excludeKeepitIps); }}>Reset</button>
          <button className="btn btn-primary" disabled={!dirty || update.isPending}>{update.isPending ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>

      {user?.role === 'admin' && (
        <Section title="Danger zone" className="danger-zone mt-16">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><strong>Delete this workspace</strong><div className="small muted">Removes every import, event and person in <strong>{workspace.name}</strong>. Uploaded files are deleted from disk.</div></div>
            <button className="btn btn-danger" onClick={() => setDel(true)}>Delete workspace</button>
          </div>
        </Section>
      )}
      <ConfirmDialog open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} busy={remove.isPending} title="Delete workspace" confirmLabel="Delete workspace" text={<>Permanently delete <strong>{workspace.name}</strong> and all of its data? This cannot be undone.</>} />
    </div>
  );
}
