import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2].trim(); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const since = new Date(Date.now() - 15 * 60000).toISOString();
const { data: b } = await db.from('bills').select('id,supplier_name,invoice_number,invoice_date,gross_amount,created_at,file_path').gte('created_at', since);
console.log('new bills', b);
const { data: s } = await db.from('inbound_skipped').select('received_at,document_type,supplier_name,file_name,gross_amount').gte('received_at', since);
console.log('skipped', s);
