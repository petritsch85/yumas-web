/* What the Gmail Nachtrag has put into the system so far. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();

const { data: fresh } = await db.from('bills')
  .select('id,supplier_name,invoice_number,invoice_date,gross_amount,status,created_at')
  .gte('created_at', since).order('created_at');

console.log(`Neu angelegt seit ${since.slice(0, 16)}: ${fresh?.length ?? 0} Rechnungen\n`);
const by = new Map();
for (const b of fresh ?? []) {
  const k = (b.supplier_name ?? '—').trim();
  const c = by.get(k) ?? { n: 0, sum: 0, sep: 0 };
  c.n++; c.sum += Number(b.gross_amount ?? 0);
  if (String(b.invoice_date ?? '').startsWith('2026-09')) c.sep++;
  by.set(k, c);
}
for (const [name, c] of [...by.entries()].sort((a, z) => z[1].n - a[1].n)) {
  console.log(`  ${String(c.n).padStart(3)}x  ${c.sum.toFixed(2).padStart(10)} €  ${name}${c.sep ? `   (${c.sep} mit Sept.-Datum)` : ''}`);
}

const { count: aside, error: aErr } = await db.from('inbound_skipped')
  .select('*', { count: 'exact', head: true }).gte('created_at', since);
console.log(`\nAls "keine Rechnung" aussortiert: ${aErr ? aErr.message : (aside ?? 0)}`);
