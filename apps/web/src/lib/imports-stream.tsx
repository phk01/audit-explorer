import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Import, ImportProgressEvent } from '@audit/core';
import { keys, useInvalidateWorkspaceData } from './queries';

export type LiveImport = ImportProgressEvent & { fileName?: string; updatedAt: number };
interface StreamCtx { live: Record<string, LiveImport>; connected: boolean }

const Ctx = createContext<StreamCtx>({ live: {}, connected: false });
const ACTIVE = new Set(['queued', 'detecting', 'running']);

/** One SSE subscription per workspace shell; progress is merged into the imports query cache too. */
export function ImportStreamProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const [live, setLive] = useState<Record<string, LiveImport>>({});
  const [connected, setConnected] = useState(false);
  const qc = useQueryClient();
  const invalidate = useInvalidateWorkspaceData(workspaceId);
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;

  useEffect(() => {
    setLive({});
    const es = new EventSource(`/api/workspaces/${workspaceId}/imports/stream`, { withCredentials: true });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const handle = (e: MessageEvent) => {
      let ev: ImportProgressEvent;
      try { ev = JSON.parse(e.data as string) as ImportProgressEvent; } catch { return; }
      if (ev.workspaceId !== workspaceId) return;
      const list = qc.getQueryData<Import[]>(keys.imports(workspaceId));
      const known = list?.find((i) => i.id === ev.importId);
      setLive((prev) => {
        const next = { ...prev, [ev.importId]: { ...prev[ev.importId], ...ev, fileName: known?.fileName ?? prev[ev.importId]?.fileName, updatedAt: Date.now() } };
        if (!ACTIVE.has(ev.status)) {
          // keep the final state briefly so the banner can show "completed", then drop it
          setTimeout(() => setLive((p) => { const { [ev.importId]: _gone, ...rest } = p; void _gone; return rest; }), 4000);
        }
        return next;
      });
      // merge into cached import rows for instant table updates
      if (list) {
        qc.setQueryData<Import[]>(keys.imports(workspaceId), list.map((i) => i.id === ev.importId
          ? { ...i, status: ev.status, rowsProcessed: ev.rowsProcessed, eventsInserted: ev.eventsInserted, eventsDuplicate: ev.eventsDuplicate, rowsFailed: ev.rowsFailed, bytesProcessed: ev.bytesProcessed, formatLabel: ev.formatLabel ?? i.formatLabel, source: ev.source ?? i.source, error: ev.error }
          : i));
      } else {
        qc.invalidateQueries({ queryKey: keys.imports(workspaceId) });
      }
      if (ev.type === 'status' && !ACTIVE.has(ev.status)) invalidateRef.current();
      else if (ev.type === 'status') qc.invalidateQueries({ queryKey: keys.imports(workspaceId) });
    };
    es.addEventListener('progress', handle);
    es.addEventListener('status', handle);
    return () => { es.close(); setConnected(false); };
  }, [workspaceId, qc]);

  const value = useMemo(() => ({ live, connected }), [live, connected]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useImportStream(): StreamCtx { return useContext(Ctx); }
export function isActiveImport(status: string): boolean { return ACTIVE.has(status); }
