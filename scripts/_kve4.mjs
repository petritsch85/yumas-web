import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';
for (const l of readFileSync('.env.local','utf8').split('\n')) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) process.env[m[1]] ??= m[2].trim(); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await db.storage.from('bills').list('bills', { limit: 40, sortBy: { column: 'created_at', order: 'desc' } });
for (const f of data??[]) {
  const path = 'bills/'+f.name;
  const { data: b } = await db.from('bills').select('supplier_name,invoice_number').eq('file_path', path).maybeSingle();
  if (b) continue;
  const { data: file } = await db.storage.from('bills').download(path);
  let head='';
  try { const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer())); const { text } = await extractText(pdf,{mergePages:true}); head=String(text).replace(/\s+/g,' ').slice(0,120); } catch(e){ head='(nicht lesbar)'; }
  console.log(`OHNE RECHNUNGSZEILE  ${String(f.created_at).slice(0,16)}  ${f.name}\n      ${head}`);
}
