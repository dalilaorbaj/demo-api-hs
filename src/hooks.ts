import { useQuery } from '@tanstack/react-query';
import { apiGet, type HsList, type HsRecord, type Activity, type Meta } from './api';

export const useContacts = () => useQuery({ queryKey: ['contacts'], queryFn: () => apiGet<HsList>('/contacts') });
export const useDeals = () => useQuery({ queryKey: ['deals'], queryFn: () => apiGet<HsList>('/deals') });
export const useTasks = () => useQuery({ queryKey: ['tasks'], queryFn: () => apiGet<HsList>('/tasks') });
export const useActivities = () => useQuery({ queryKey: ['activities'], queryFn: () => apiGet<{ results: Activity[]; unavailable?: { type: string; status: number }[] }>('/activities') });
export const usePipelines = () => useQuery({ queryKey: ['pipelines'], queryFn: () => apiGet<{ results: Pipeline[] }>('/pipelines'), staleTime: 60 * 60 * 1000 });
export const useOwners = () => useQuery({ queryKey: ['owners'], queryFn: () => apiGet<{ results: Owner[] }>('/owners'), staleTime: 60 * 60 * 1000 });

export const useContactDetail = (id: string | null) =>
  useQuery({
    queryKey: ['contact', id],
    queryFn: () => apiGet<HsRecord & { propertyDefs: PropertyDef[] }>(`/contacts/${id}`),
    enabled: !!id,
  });

export const useMeta = () =>
  useQuery({ queryKey: ['meta'], queryFn: () => apiGet<Meta>('/_meta'), refetchInterval: 3000 });

// ---- Tipos auxiliares ----
export interface Owner {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface StageMeta {
  isClosed?: string;
  probability?: string;
}

export interface Stage {
  id: string;
  label: string;
  displayOrder: number;
  metadata: StageMeta;
}

export interface Pipeline {
  id: string;
  label: string;
  stages: Stage[];
}

export interface PropertyDef {
  name: string;
  label: string;
  groupName?: string;
}

// ---- Helpers de mapeo ----
export function buildOwnerMap(owners?: Owner[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const o of owners || []) {
    map[o.id] = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || o.id;
  }
  return map;
}

export interface StageInfo {
  label: string;
  isClosed: boolean;
  isWon: boolean;
  isLost: boolean;
  order: number;
}

export function buildStageMap(pipelines?: Pipeline[]): Record<string, StageInfo> {
  const map: Record<string, StageInfo> = {};
  for (const p of pipelines || []) {
    for (const s of p.stages || []) {
      const isClosed = s.metadata?.isClosed === 'true';
      const isWon = s.metadata?.probability === '1.0';
      map[s.id] = {
        label: s.label,
        isClosed,
        isWon,
        isLost: isClosed && !isWon,
        order: s.displayOrder,
      };
    }
  }
  return map;
}
