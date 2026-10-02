import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { extractText, getDocumentProxy } from 'unpdf';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const { data: bills } = await db.from('bills')
  .select('id,supplier_name,invoice_number,invoice_date,due_date,due_date_source,payment_method,gross_amount,file_path')
  .eq('invoice_date','2026-09-03').eq('gross_amount',1210);
for (const b of bills ?? []) {
  const lag = Math.round((new Date(b.due_date)-new Date(b.invoice_date))/86400000);
  console.log(`${b.supplier_name} · ${b.invoice_number} · ${b.invoice_date} -> ${b.due_date} (+${lag}d) · source ${b.due_date_source}`);
  console.log('  payment_method:', JSON.stringify(b.payment_method));
  const { data: f } = await db.storage.from('bills').download(b.file_path);
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(await f.arrayBuffer())),{mergePages:true});
  const flat = text.replace(/\s+/g,' ');
  for (const re of [/.{0,80}sofort.{0,80}/i, /.{0,60}(zahlbar|f[äa]llig|Zahlungsziel|netto Kasse|Tage netto).{0,60}/i]) {
    const m = flat.match(re); if (m) console.log('  PDF:', m[0].trim());
  }
}
