import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local','utf8').split('\n')) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) process.env[m[1]] ??= m[2].trim(); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
for (const [bucket, prefix] of [['bills',''],['inbound-emails',''],['inbound-emails','claims']]) {
  const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 15, sortBy: { column: 'created_at', order: 'desc' } });
  console.log(`\n${bucket}/${prefix}: ${error ? error.message : ''}`);
  for (const f of data??[]) console.log(`   ${String(f.created_at).slice(0,16)}  ${f.name}`);
}
