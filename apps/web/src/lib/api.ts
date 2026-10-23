import type {
  User, Workspace, Overview, EventQuery, EventPage, EventFacets, Histogram, EventDetail, Import, Person, PersonDetail, Coverage, FacetBucket,
} from '@audit/core';
import type { SourceDefinition } from '@core/sources';
import type { WorkloadGroup } from '@core/workloads';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Listener = () => void;
const unauthListeners = new Set<Listener>();
/** Subscribe to 401 responses (the app redirects to /login). */
export function onUnauthorized(fn: Listener): () => void {
  unauthListeners.add(fn);
  return () => { unauthListeners.delete(fn); };
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/** Build a query string, dropping empty/undefined values. */
export function qs(params?: QueryParams): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    sp.set(k, v === true ? '1' : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'include', ...init });
  } catch (e) {
    throw new ApiError(0, 'network', 'Cannot reach the server.', e);
  }
  if (res.status === 401) {
    for (const fn of unauthListeners) fn();
    throw new ApiError(401, 'unauthenticated', 'Sign in required.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, err.error ?? 'error', err.message ?? `Request failed (${res.status}).`, err.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, params?: QueryParams, init?: RequestInit) => request<T>('GET', path + qs(params), undefined, init),
  post: <T>(path: string, body?: unknown, params?: QueryParams) => request<T>('POST', path + qs(params), body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

// ---- typed endpoints ----

export interface PeopleQuery { search?: string; sort?: 'events' | 'lastSeen' | 'failed' | 'sensitive' | 'upn'; kind?: string; limit?: number; offset?: number }
export interface UploadResult { created: Import[]; skipped: { fileName: string; reason: string }[] }
export type CatalogGroups = Record<WorkloadGroup, { label: string; description: string }>;
export interface Activity { operation: string; friendlyName: string; description: string }

export const endpoints = {
  me: () => api.get<User>('/auth/me'),
  login: (email: string, password: string) => api.post<User>('/auth/login', { email, password }),
  logout: () => api.post<{ ok: true }>('/auth/logout'),
  changePassword: (current: string, next: string) => api.post<{ ok: true }>('/auth/password', { current, next }),
  users: () => api.get<User[]>('/users'),
  createUser: (b: { email: string; name: string; role: 'admin' | 'analyst'; password: string }) => api.post<User>('/users', b),
  updateUser: (id: string, b: { name?: string; role?: 'admin' | 'analyst'; password?: string }) => api.patch<User>(`/users/${id}`, b),
  deleteUser: (id: string) => api.delete<{ ok: true }>(`/users/${id}`),

  workspaces: () => api.get<Workspace[]>('/workspaces'),
  workspace: (id: string) => api.get<Workspace>(`/workspaces/${id}`),
  createWorkspace: (b: Partial<Workspace> & { name: string }) => api.post<Workspace>('/workspaces', b),
  updateWorkspace: (id: string, b: Partial<Workspace>) => api.patch<Workspace>(`/workspaces/${id}`, b),
  deleteWorkspace: (id: string) => api.delete<{ ok: true }>(`/workspaces/${id}`),
  overview: (id: string) => api.get<Overview>(`/workspaces/${id}/overview`),

  events: (id: string, q: EventQuery, signal?: AbortSignal) => api.get<EventPage>(`/workspaces/${id}/events`, q as QueryParams, { signal }),
  facets: (id: string, q: EventQuery, signal?: AbortSignal) => api.get<EventFacets>(`/workspaces/${id}/events/facets`, q as QueryParams, { signal }),
  histogram: (id: string, q: EventQuery, unit: 'auto' | 'hour' | 'day' | 'week' = 'auto', signal?: AbortSignal) =>
    api.get<Histogram>(`/workspaces/${id}/events/histogram`, { ...(q as QueryParams), unit }, { signal }),
  suggest: (id: string, field: 'user' | 'op' | 'ip' | 'workload' | 'recordType', prefix: string) => api.get<FacetBucket[]>(`/workspaces/${id}/events/suggest`, { field, prefix }),
  exportCsvUrl: (id: string, q: EventQuery, raw: boolean) => `/api/workspaces/${id}/events/export.csv${qs({ ...(q as QueryParams), raw: raw ? '1' : undefined })}`,
  event: (id: number | string) => api.get<EventDetail>(`/events/${id}`),

  imports: (id: string) => api.get<Import[]>(`/workspaces/${id}/imports`),
  import: (id: string) => api.get<Import>(`/imports/${id}`),
  cancelImport: (id: string) => api.post<{ ok: true }>(`/imports/${id}/cancel`),
  retryImport: (id: string) => api.post<{ ok: true }>(`/imports/${id}/retry`),
  deleteImport: (id: string) => api.delete<{ ok: true }>(`/imports/${id}`),

  people: (id: string, q: PeopleQuery) => api.get<{ items: Person[]; total: number }>(`/workspaces/${id}/people`, q as QueryParams),
  person: (id: string, upn: string) => api.get<PersonDetail>(`/workspaces/${id}/people/${encodeURIComponent(upn)}`),

  coverage: (id: string) => api.get<Coverage>(`/workspaces/${id}/coverage`),
  catalogSources: () => api.get<SourceDefinition[]>('/catalog/sources'),
  catalogGroups: () => api.get<CatalogGroups>('/catalog/groups'),
  catalogActivities: (q: string) => api.get<Activity[]>('/catalog/activities', { q }),
};

/** Upload files with XHR so we get upload progress. */
export function uploadImports(workspaceId: string, files: File[], opts: { force?: boolean; onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal }): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/workspaces/${workspaceId}/imports${qs({ force: opts.force ? '1' : undefined })}`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total); };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Upload failed.'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Upload cancelled.'));
    xhr.onload = () => {
      if (xhr.status === 401) { for (const fn of unauthListeners) fn(); reject(new ApiError(401, 'unauthenticated', 'Sign in required.')); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as UploadResult);
      else { const r = (xhr.response ?? {}) as { error?: string; message?: string }; reject(new ApiError(xhr.status, r.error ?? 'error', r.message ?? `Upload failed (${xhr.status}).`)); }
    };
    opts.signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(fd);
  });
}
