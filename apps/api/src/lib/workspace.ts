import type { Workspace, EventRow } from '@audit/core';
import { friendlyOperation } from '@audit/core';
import { one, camel } from './db.js';
import type { Exclusions } from './search.js';

export interface WorkspaceRow extends Workspace { }

export async function loadWorkspace(id: string): Promise<Workspace | null> {
  const row = await one<Record<string, unknown>>('select * from workspaces where id = $1', [id]);
  return row ? camel<Workspace>(row) : null;
}

export function exclusionsOf(ws: Workspace): Exclusions | null {
  const rules = ws.excludedIps.split(/\r?\n/);
  const any = rules.some((l) => l.replace(/#.*/, '').trim()) || ws.excludeMicrosoftIps || ws.excludeKeepitIps;
  return any ? { rules, microsoft: ws.excludeMicrosoftIps, keepit: ws.excludeKeepitIps } : null;
}

export const EVENT_COLUMNS = `e.id, e.import_id, e.source, e.layer, e.source_record_id, e.ts, e.workload, e.workload_group, e.record_type, e.record_type_id,
  e.operation, e.operation_key, e.kind, e.user_upn, e.user_type, e.object_id, e.item, e.detail, e.client_ip, e.ip_country, e.ip_owner, e.ip_owner_name,
  e.user_agent, e.result, e.failed, e.session_id, e.correlation_id, e.message_id, e.network_message_id, e.counterpart, e.sensitive_family`;

export function toEventRow(r: Record<string, unknown>): EventRow {
  const c = camel<EventRow & { friendlyOperation?: string | null }>(r);
  const f = friendlyOperation(c.operation);
  c.friendlyOperation = f === c.operation ? null : f;
  return c;
}
