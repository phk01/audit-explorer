import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceCtx } from '../pages/WorkspaceShell';
import { useLocalPref, useUrlState } from '../lib/url';
import { Inspector } from './Inspector';

/**
 * Lets any page open the existing event Inspector drawer: the selected event id lives in the `ev`
 * URL param, pivots jump to Global Activity with the chosen filters.
 */
export function useEventInspector() {
  const [url, setUrl] = useUrlState();
  const eventId = url.ev ? Number(url.ev) : null;
  const open = useCallback((id: number | string) => setUrl({ ev: String(id) }, { replace: true }), [setUrl]);
  const close = useCallback(() => setUrl({ ev: null }, { replace: true }), [setUrl]);
  return { eventId, open, close };
}

export function EventInspectorHost({ eventId, onClose }: { eventId: number | null; onClose: () => void }) {
  const { wsId, workspace } = useWorkspaceCtx();
  const navigate = useNavigate();
  const [width, setWidth] = useLocalPref<number>('ae.drawer.width', 520);
  const pivot = useCallback((params: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    navigate(`/w/${wsId}/activity?${sp.toString()}`);
  }, [navigate, wsId]);
  return <Inspector eventId={eventId} onClose={onClose} wsId={wsId} workspace={workspace} onPivot={pivot} width={width} setWidth={setWidth} />;
}
