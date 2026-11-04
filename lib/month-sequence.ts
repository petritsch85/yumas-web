import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeSequence } from './month-folder';

/**
 * The print order chosen under "Sequencing": one small file next to the
 * month's other documents, the same way the forecast snapshots are kept.
 */
const BUCKET = 'cashflow-files';
const PATH = 'month-folder/sequence.json';

export async function readSequence(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.storage.from(BUCKET).download(PATH);
  if (!data) return normalizeSequence(null);
  try { return normalizeSequence(JSON.parse(await data.text())); } catch { return normalizeSequence(null); }
}

export async function writeSequence(admin: SupabaseClient, order: unknown): Promise<string[]> {
  const clean = normalizeSequence(order);
  const { error } = await admin.storage.from(BUCKET).upload(PATH, JSON.stringify(clean), {
    contentType: 'application/json', upsert: true, cacheControl: '0',
  });
  if (error) throw new Error(error.message);
  return clean;
}
