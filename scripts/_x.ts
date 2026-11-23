process.loadEnvFile('.env.local');
import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  const { data } = await s.from('webshop_orders').select('*').gte('sale_date', '2026-11-24');
  console.log(data);
})();
