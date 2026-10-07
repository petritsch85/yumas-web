/* What the relay set aside as "not a bill", newest first. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: cols, error: e0 } = await db.from('inbound_skipped').select('*').limit(1);
if (e0) { console.log('Fehler:', e0.message); process.exit(1); }
console.log('Spalten:', Object.keys(cols?.[0] ?? {}).join(', '), '\n');

const { data } = await db.from('inbound_skipped').select('*')
  .order('received_at', { ascending: false }).limit(200);

const by = new Map();
for (const r of data ?? []) {
  const k = String(r.document_type ?? '?');
  by.set(k, (by.get(k) ?? 0) + 1);
}
console.log('Nach Dokumenttyp:');
for (const [k, n] of [...by.entries()].sort((a, z) => z[1] - a[1])) console.log(`  ${String(n).padStart(3)}x  ${k}`);

console.log('\nDie letzten 40:');
for (const r of (data ?? []).slice(0, 40)) {
  console.log(`  ${String(r.received_at).slice(5, 16)}  ${String(r.document_type ?? '?').padEnd(22)}  ${String(r.supplier_name ?? r.email_from ?? '—').slice(0, 30).padEnd(30)}  ${r.file_name}`);
}
