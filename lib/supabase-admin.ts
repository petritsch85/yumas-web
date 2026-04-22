import { createClient } from '@supabase/supabase-js';

// Server-side only. Called at request time, never at module load — safe for build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabaseAdmin(): ReturnType<typeof createClient<any>> {
  return createClient<any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
