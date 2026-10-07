/* Are the freshly imported bills duplicates, and do they clear a payment? */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const all = [];
for (let pg = 0; ; pg++) {
  const { data, error } = await db.from('bills')
    .select('id,supplier_name,invoice_number,invoice_date,gross_amount,net_amount,status,created_at,file_path,notes')
    .range(pg * 1000, pg * 1000 + 999).order('id');
  if (error) throw error;
  all.push(...(data ?? []));
  if ((data ?? []).length < 1000) break;
}

const since = Date.now() - 12 * 3600 * 1000;
const fresh = all.filter(b => new Date(b.created_at).getTime() >= since);
const older = all.filter(b => new Date(b.created_at).getTime() < since);

const eur = n => Number(n ?? 0).toFixed(2).padStart(9) + ' €';
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

console.log(`${fresh.length} neu importiert, ${older.length} bereits im System\n`);

for (const b of fresh.sort((a, z) => Number(z.gross_amount) - Number(a.gross_amount))) {
  console.log(`${eur(b.gross_amount)}  ${String(b.invoice_date).slice(0, 10)}  ${(b.supplier_name ?? '—').slice(0, 42)}`);
  console.log(`            Rg-Nr ${b.invoice_number ?? '—'}   (${b.id})`);

  const num = norm(b.invoice_number);
  const hits = older.filter(o => {
    const sameNum = num && num.length >= 4 && norm(o.invoice_number) === num;
    const sameAmt = Math.abs(Number(o.gross_amount ?? 0) - Number(b.gross_amount ?? 0)) < 0.01;
    const sameSup = norm(o.supplier_name).slice(0, 8) === norm(b.supplier_name).slice(0, 8);
    return sameNum || (sameAmt && sameSup);
  });
  if (hits.length === 0) {
    console.log('            → kein Treffer im Bestand: NEU');
  } else {
    for (const h of hits) {
      const why = norm(h.invoice_number) === num && num ? 'gleiche Rg-Nr' : 'gleicher Betrag + Lieferant';
      console.log(`            → DUBLETTE? ${why}: ${h.id} · ${String(h.invoice_date).slice(0, 10)} · ${eur(h.gross_amount)} · ${h.status}`);
      console.log(`               Datei gleich: ${h.file_path === b.file_path ? 'JA' : 'nein'}  | alt angelegt ${String(h.created_at).slice(0, 10)}`);
    }
  }
  console.log('');
}
