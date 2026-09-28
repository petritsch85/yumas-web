'use client';

/**
 * The active locations, fetched once and shared.
 *
 * Six pages used to run their own query under the same React Query key,
 * `['locations-active']`, but return different things from it: some the three
 * restaurants, some all four locations with ZK, and all of them dropping the
 * `type` field on the way out. One key holding several shapes means whichever
 * page mounted first decided what the others saw, and a page asking for
 * restaurants could be handed a list it could not filter — there was no `type`
 * left on it to filter by.
 *
 * So there is one query, it keeps every field, and a page that wants only the
 * restaurants narrows the list itself.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase-browser';

export interface LocationRow {
  id: string;
  name: string;
  /** 'restaurant' | 'production' — ZK is production, not a restaurant. */
  type: string | null;
}

export const LOCATIONS_QUERY_KEY = ['locations-active'] as const;

export function useActiveLocations() {
  return useQuery<LocationRow[]>({
    queryKey: LOCATIONS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, type')
        .eq('is_active', true)
        .order('name');
      /* Thrown, not swallowed. A query that quietly returned [] on failure is
         how an empty location picker looked exactly like a company with no
         restaurants. */
      if (error) throw new Error(`Could not load locations: ${error.message}`);
      return (data ?? []) as LocationRow[];
    },
    staleTime: 5 * 60_000,
  });
}

/** Just the restaurants: ZK produces food but does not take covers. */
export const restaurantsOnly = (rows: LocationRow[]) => rows.filter(l => l.type === 'restaurant');
