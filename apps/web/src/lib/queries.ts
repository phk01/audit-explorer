import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventQuery, Finding, UserInvestigation, Workspace } from '@audit/core';
import { endpoints, type FindingPatch, type FindingsQuery, type FindingsResult, type PeopleQuery, type TimelineQuery } from './api';

export const keys = {
  me: ['me'] as const,
  users: ['users'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspace', id] as const,
  overview: (id: string) => ['overview', id] as const,
  events: (id: string, q: EventQuery) => ['events', id, q] as const,
  facets: (id: string, q: EventQuery) => ['facets', id, q] as const,
  histogram: (id: string, q: EventQuery, unit: string) => ['histogram', id, q, unit] as const,
  event: (id: number | string) => ['event', String(id)] as const,
  imports: (id: string) => ['imports', id] as const,
  people: (id: string, q: PeopleQuery) => ['people', id, q] as const,
  person: (id: string, upn: string) => ['person', id, upn] as const,
  coverage: (id: string) => ['coverage', id] as const,
  findings: (id: string, q: FindingsQuery) => ['findings', id, q] as const,
  resolve: (id: string, q: string) => ['resolve', id, q] as const,
  investigateUser: (id: string, upn: string) => ['investigateUser', id, upn] as const,
  timeline: (id: string, q: TimelineQuery) => ['timeline', id, q] as const,
  emailSearch: (id: string, q: string) => ['emailSearch', id, q] as const,
  email: (id: string, key: string) => ['email', id, key] as const,
  url: (id: string, q: string) => ['url', id, q] as const,
  ip: (id: string, ip: string) => ['ip', id, ip] as const,
  catalogSources: ['catalog', 'sources'] as const,
  catalogGroups: ['catalog', 'groups'] as const,
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: endpoints.me, retry: false, staleTime: 5 * 60_000 });
export const useUsers = () => useQuery({ queryKey: keys.users, queryFn: endpoints.users });
export const useWorkspaces = () => useQuery({ queryKey: keys.workspaces, queryFn: endpoints.workspaces, staleTime: 30_000 });
export const useWorkspace = (id: string) => useQuery({ queryKey: keys.workspace(id), queryFn: () => endpoints.workspace(id), staleTime: 60_000 });
export const useOverview = (id: string) => useQuery({ queryKey: keys.overview(id), queryFn: () => endpoints.overview(id), placeholderData: keepPreviousData });

export function useEventsInfinite(id: string, q: EventQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.events(id, q),
    queryFn: ({ pageParam, signal }) => endpoints.events(id, { ...q, cursor: pageParam || undefined, limit: 100 }, signal),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 30_000,
  });
}
export const useFacets = (id: string, q: EventQuery, enabled = true) =>
  useQuery({ queryKey: keys.facets(id, q), queryFn: ({ signal }) => endpoints.facets(id, q, signal), placeholderData: keepPreviousData, enabled, staleTime: 30_000 });
export const useHistogram = (id: string, q: EventQuery, unit: 'auto' | 'hour' | 'day' | 'week' = 'auto', enabled = true) =>
  useQuery({ queryKey: keys.histogram(id, q, unit), queryFn: ({ signal }) => endpoints.histogram(id, q, unit, signal), placeholderData: keepPreviousData, enabled, staleTime: 30_000 });
export const useEvent = (id: number | null) => useQuery({ queryKey: keys.event(id ?? 0), queryFn: () => endpoints.event(id!), enabled: id != null, staleTime: 5 * 60_000 });

export const useImports = (id: string) => useQuery({ queryKey: keys.imports(id), queryFn: () => endpoints.imports(id), placeholderData: keepPreviousData });
export const usePeople = (id: string, q: PeopleQuery) => useQuery({ queryKey: keys.people(id, q), queryFn: () => endpoints.people(id, q), placeholderData: keepPreviousData });
export const usePerson = (id: string, upn: string) => useQuery({ queryKey: keys.person(id, upn), queryFn: () => endpoints.person(id, upn), placeholderData: keepPreviousData });
export const useCoverage = (id: string) => useQuery({ queryKey: keys.coverage(id), queryFn: () => endpoints.coverage(id), placeholderData: keepPreviousData });
export const useCatalogSources = () => useQuery({ queryKey: keys.catalogSources, queryFn: endpoints.catalogSources, staleTime: Infinity });
export const useActivityCatalog = () => useQuery({ queryKey: ['catalog', 'activities'], queryFn: () => endpoints.catalogActivities(''), staleTime: Infinity, select: (list) => new Map(list.map((a) => [a.operation.toLowerCase(), a.friendlyName])) });
export const useCatalogGroups = () => useQuery({ queryKey: keys.catalogGroups, queryFn: endpoints.catalogGroups, staleTime: Infinity });

// ---- investigations ----
export const useFindings = (id: string, q: FindingsQuery = {}) => useQuery({ queryKey: keys.findings(id, q), queryFn: () => endpoints.findings(id, q), placeholderData: keepPreviousData });
export const useResolve = (id: string, q: string) => useQuery({ queryKey: keys.resolve(id, q), queryFn: ({ signal }) => endpoints.resolve(id, q, signal), enabled: q.trim().length >= 2, placeholderData: keepPreviousData, staleTime: 30_000 });
export const useUserInvestigation = (id: string, upn: string) => useQuery({ queryKey: keys.investigateUser(id, upn), queryFn: () => endpoints.investigateUser(id, upn), enabled: !!upn });
export const useTimeline = (id: string, q: TimelineQuery, enabled = true) => useQuery({ queryKey: keys.timeline(id, q), queryFn: ({ signal }) => endpoints.investigateTimeline(id, q, signal), placeholderData: keepPreviousData, enabled, staleTime: 30_000 });
export const useEmailSearch = (id: string, q: string) => useQuery({ queryKey: keys.emailSearch(id, q), queryFn: ({ signal }) => endpoints.emailSearch(id, q, signal), enabled: q.trim().length > 0, placeholderData: keepPreviousData });
export const useEmailInvestigation = (id: string, key: string) => useQuery({ queryKey: keys.email(id, key), queryFn: () => endpoints.investigateEmail(id, key), enabled: !!key });
export const useUrlInvestigation = (id: string, q: string) => useQuery({ queryKey: keys.url(id, q), queryFn: ({ signal }) => endpoints.investigateUrl(id, q, signal), enabled: q.trim().length > 0, placeholderData: keepPreviousData });
export const useIpInvestigation = (id: string, ip: string) => useQuery({ queryKey: keys.ip(id, ip), queryFn: () => endpoints.investigateIp(id, ip), enabled: !!ip });

export function useRecomputeFindings(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => endpoints.recomputeFindings(id),
    onSuccess: () => { for (const k of ['findings', 'investigateUser', 'resolve', 'ip', 'url', 'email']) qc.invalidateQueries({ queryKey: [k, id] }); },
  });
}

/** Patch a finding's status / note; every cached copy (findings lists, user investigations, IP pages) is updated optimistically. */
export function useUpdateFinding(wsId: string) {
  const qc = useQueryClient();
  const patchEverywhere = (findingId: string, patch: Partial<Finding>) => {
    const apply = (f: Finding) => (f.id === findingId ? { ...f, ...patch } : f);
    qc.setQueriesData<FindingsResult>({ queryKey: ['findings', wsId] }, (old) => (old ? { ...old, items: old.items.map(apply) } : old));
    qc.setQueriesData<UserInvestigation>({ queryKey: ['investigateUser', wsId] }, (old) => (old ? { ...old, findings: old.findings.map(apply) } : old));
    qc.setQueriesData<{ findings: Finding[] }>({ queryKey: ['ip', wsId] }, (old) => (old ? { ...old, findings: old.findings.map(apply) } : old));
  };
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: FindingPatch }) => endpoints.updateFinding(id, patch),
    onMutate: async ({ id, patch }) => { patchEverywhere(id, patch as Partial<Finding>); },
    onSuccess: (f) => { patchEverywhere(f.id, f); },
    onError: () => { qc.invalidateQueries({ queryKey: ['findings', wsId] }); qc.invalidateQueries({ queryKey: ['investigateUser', wsId] }); qc.invalidateQueries({ queryKey: ['ip', wsId] }); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['findings', wsId], refetchType: 'none' }); },
  });
}

export function useUpdateWorkspace(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Partial<Workspace>) => endpoints.updateWorkspace(id, b),
    onSuccess: (ws) => {
      qc.setQueryData(keys.workspace(id), (old: Workspace | undefined) => ({ ...ws, stats: old?.stats }));
      qc.invalidateQueries({ queryKey: keys.workspaces });
      // exclusion changes affect every event view
      qc.invalidateQueries({ queryKey: ['events', id] });
      qc.invalidateQueries({ queryKey: ['facets', id] });
      qc.invalidateQueries({ queryKey: ['histogram', id] });
      qc.invalidateQueries({ queryKey: keys.overview(id) });
    },
  });
}

/** Invalidate everything derived from events in a workspace (after an import completes or is deleted). */
export function useInvalidateWorkspaceData(id: string) {
  const qc = useQueryClient();
  return () => {
    for (const k of ['events', 'facets', 'histogram', 'people', 'person', 'findings', 'investigateUser', 'timeline', 'resolve', 'emailSearch', 'email', 'url', 'ip']) qc.invalidateQueries({ queryKey: [k, id] });
    qc.invalidateQueries({ queryKey: keys.overview(id) });
    qc.invalidateQueries({ queryKey: keys.coverage(id) });
    qc.invalidateQueries({ queryKey: keys.imports(id) });
    qc.invalidateQueries({ queryKey: keys.workspace(id) });
    qc.invalidateQueries({ queryKey: keys.workspaces });
  };
}
