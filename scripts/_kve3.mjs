import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';
for (const l of readFileSync('.env.local','utf8').split('\n')) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) process.env[m[1]] ??= m[2].trim(); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: claims } = await db.storage.from('inbound-emails').list('claims', { limit: 8, sortBy: { column: 'created_at', order: 'desc' } });
for (const c of claims??[]) { const { data } = await db.storage.from('inbound-emails').download('claims/'+c.name); console.log(String(c.created_at).slice(0,16), (await data.text()).slice(0,120)); }
// all bill-bucket files from the last 3 days
for (const folder of ['bills','skipped']) {
  const { data } = await db.storage.from('bills').list(folder, { limit: 8, sortBy: { column: 'created_at', order: 'desc' } });
  console.log(`\nbills/${folder}:`); for (const f of data??[]) console.log(`   ${String(f.created_at).slice(0,16)}  ${f.name}`);
}
