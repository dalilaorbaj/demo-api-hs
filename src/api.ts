export interface HsHistoryEntry {
  value: string;
  timestamp: string;
  sourceType?: string;
}

export interface HsRecord {
  id: string;
  properties: Record<string, string | null>;
  propertiesWithHistory?: Record<string, HsHistoryEntry[]>;
  associations?: Record<string, { results: { id: string; type: string }[] }>;
  createdAt?: string;
  updatedAt?: string;
}

export interface HsList {
  results: HsRecord[];
  paging?: unknown;
}

export interface Activity {
  id: string;
  type: 'calls' | 'emails' | 'meetings' | 'notes';
  title: string;
  body: string;
  ownerId: string | null;
  timestamp: string;
  raw: Record<string, string>;
}

export interface Meta {
  realCalls: number;
  cacheHits: number;
  rateLimited: number;
  errors: number;
  lastCallAt: string | null;
  startedAt: string;
}

export async function apiGet<T>(path: string, fresh = false): Promise<T> {
  const url = `/api${path}${fresh ? (path.includes('?') ? '&' : '?') + 'fresh=1' : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || res.statusText);
  }
  return res.json() as Promise<T>;
}
