import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const since = new Date(Date.now() - 3 * 3600e3).toISOString();
const { data: b } = await db.from('bills').select('id,supplier_name,invoice_number,invoice_date,gross_amount,file_path,created_at').gte('created_at', since).order('created_at');
console.log('neue Rechnungen (3h):', b);
const { data: s } = await db.from('inbound_skipped').select('received_at,document_type,supplier_name,file_name,file_path,gross_amount,status').gte('received_at', since);
console.log('nicht importiert (3h):', s);
const { data: f } = await db.storage.from('bills').list('bills', { search: 'Nata', limit: 20, sortBy: { column: 'created_at', order: 'desc' } });
console.log('Dateien "Nata":', (f ?? []).map(x => `${x.name} ${x.created_at}`));
const { data: c } = await db.storage.from('inbound-emails').list('claims', { limit: 5, sortBy: { column: 'created_at', order: 'desc' } });
console.log('letzte Eingänge (claims):', (c ?? []).map(x => x.created_at));
