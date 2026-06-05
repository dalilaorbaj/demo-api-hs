import type { HsRecord } from './api';

export function ownerLabel(id: string | null | undefined, map: Record<string, string>): string {
  if (!id) return '—';
  return map[id] || `Vendedor #${id}`;
}

// IDs de propietario distintos presentes en uno o más listados de records.
export function distinctOwnerIds(...lists: (HsRecord[] | undefined)[]): string[] {
  const set = new Set<string>();
  for (const list of lists) {
    for (const r of list || []) {
      const id = r.properties.hubspot_owner_id;
      if (id) set.add(id);
    }
  }
  return [...set];
}
