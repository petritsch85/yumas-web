/* Have the two month_documents migrations actually been run? Tested, not assumed. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anon  = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/* ── 1. multi: two rows, same kind+month, different filename ──
   The old index was unique on (kind, month), so the second insert fails with
   23505 if the migration has not run. */
const probe = { kind: 'wolt', month: '1999-01-01', bucket: 'cashflow-files', byte_size: 1 };
await admin.from('month_documents').delete().eq('month', '1999-01-01');
const a = await admin.from('month_documents').insert({ ...probe, filename: 'probe_a.pdf', file_path: 'probe/a' });
const b = await admin.from('month_documents').insert({ ...probe, filename: 'probe_b.pdf', file_path: 'probe/b' });
console.log('add_month_documents_multi.sql');
if (a.error) console.log('  ?  erster Testdatensatz schlug fehl:', a.error.message);
else if (!b.error) console.log('  ✔ GELAUFEN — zwei Dateien pro Position/Monat sind erlaubt');
else if (b.error.code === '23505') console.log('  ✘ NICHT gelaufen — zweite Datei abgelehnt:', b.error.message);
else console.log('  ?  unerwartet:', b.error.code, b.error.message);

/* Does re-uploading the same filename overwrite rather than double? That is
   what onConflict kind,month,filename needs, and it needs the new index. */
const c = await admin.from('month_documents')
  .upsert({ ...probe, filename: 'probe_a.pdf', file_path: 'probe/a2' }, { onConflict: 'kind,month,filename' });
console.log(`  upsert onConflict kind,month,filename: ${c.error ? '✘ ' + c.error.message : '✔ akzeptiert'}`);

await admin.from('month_documents').delete().eq('month', '1999-01-01');

/* ── 2. rls: can a non-service client see anything at all? ──
   The policy grants the authenticated role. anon is not authenticated, so an
   empty result here is expected either way — what it does rule out is the
   table being wide open. A hard error names the real state. */
console.log('\nadd_month_documents_rls.sql');
const r = await anon.from('month_documents').select('kind,month').limit(3);
if (r.error) console.log('  anon-Lesen:', r.error.code, r.error.message);
else console.log(`  anon-Lesen: ${r.data.length} Zeile(n) — RLS lässt anon ${r.data.length ? 'DURCH (Policy zu weit?)' : 'nicht durch (erwartet)'}`);

const w = await anon.from('month_documents').insert({ ...probe, filename: 'anon.pdf', file_path: 'probe/anon' });
console.log(`  anon-Schreiben: ${w.error ? w.error.code + ' ' + w.error.message.slice(0, 60) : '✘ ERLAUBT — Policy zu weit'}`);
await admin.from('month_documents').delete().eq('month', '1999-01-01');
