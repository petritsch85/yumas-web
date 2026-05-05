// Sync production catalog → recipes table
// Run: node scripts/sync-recipes.mjs

const SUPABASE_URL = 'https://mjviztygjgvcblhutusg.supabase.co';
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdml6dHlnamd2Y2JsaHV0dXNnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTk5MTE2NywiZXhwIjoyMDkxNTY3MTY3fQ.ylpS8P-KquY8feqgqvlSecHTflaTa62H1n2fwhbdwMc';

const headers = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

async function get(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function post(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}

// ── The 47-item production catalog ───────────────────────────────────────────
const CATALOG = [
  { name: 'Guacamole',                category: 'Salsas/ Dips'   },
  { name: 'Schärfemix',               category: 'Salsas/ Dips'   },
  { name: 'Maissalsa',                category: 'Salsas/ Dips'   },
  { name: 'Tomatensalsa',             category: 'Salsas/ Dips'   },
  { name: 'Sour Cream',               category: 'Salsas/ Dips'   },
  { name: 'Crema Nogada',             category: 'Salsas/ Dips'   },
  { name: 'Salsa Torta',              category: 'Salsas/ Dips'   },
  { name: 'Pozole',                   category: 'Supper'         },
  { name: 'Marinade Chicken',         category: 'Marinades'      },
  { name: 'Pico de Gallo',            category: 'Salsas/ Dips'   },
  { name: 'Schoko-Avocado Mousse',    category: 'Desserts'       },
  { name: 'Brownie',                  category: 'Desserts'       },
  { name: 'Carlota de Limon',         category: 'Desserts'       },
  { name: 'Mole',                     category: 'Veggy options'  },
  { name: 'Marinade Al Pastor',       category: 'Meat options'   },
  { name: 'Barbacoa',                 category: 'Meat options'   },
  { name: 'Chili con Carne',          category: 'Meat options'   },
  { name: 'Cochinita',                category: 'Meat options'   },
  { name: 'Kartoffel Würfel',         category: 'Vegetables'     },
  { name: 'Vinaigrette',              category: 'Dressings'      },
  { name: 'Honig Sesam / Senf',       category: 'Dressings'      },
  { name: 'Zwiebeln karamellisiert',  category: 'Vegetables'     },
  { name: 'Karotten karamellisiert',  category: 'Vegetables'     },
  { name: 'Bohnencreme',              category: 'Salsas/ Dips'   },
  { name: 'Alambre - Zwiebel',        category: 'Veggy options'  },
  { name: 'Salsa Habanero',           category: 'Salsas/ Dips'   },
  { name: 'Salsa Verde',              category: 'Salsas/ Dips'   },
  { name: 'Chipotle SourCream',       category: 'Salsas/ Dips'   },
  { name: 'Salsa de Jamaica',         category: 'Salsas/ Dips'   },
  { name: 'Humo Salsa',               category: 'Salsas/ Dips'   },
  { name: 'Fuego Salsa',              category: 'Salsas/ Dips'   },
  { name: 'Salsa Pitaya',             category: 'Salsas/ Dips'   },
  { name: 'Rinderfilet Steak',        category: 'Meat options'   },
  { name: 'Filetspitzen',             category: 'Meat options'   },
  { name: 'Hähnchenkeule (ganz)',     category: 'Meat options'   },
  { name: 'Mole Rojo',               category: 'Meat options'   },
  { name: 'Chorizo',                  category: 'Meat options'   },
  { name: 'Carne Vegetal',            category: 'Veggy options'  },
  { name: 'Costilla de Res',          category: 'Meat options'   },
  { name: 'Salsa für Costilla de Res',category: 'Salsas/ Dips'   },
  { name: 'Rote Zwiebeln eingelegt',  category: 'Vegetables'     },
  { name: 'Pulpo',                    category: 'Meat options'   },
  { name: 'Salsa für Pulpo',          category: 'Salsas/ Dips'   },
  { name: 'Birria',                   category: 'Meat options'   },
  { name: 'Salsa Birria',             category: 'Salsas/ Dips'   },
  { name: 'Füllung Nogada',           category: 'Meat options'   },
  { name: 'Gambas',                   category: 'Meat options'   },
];

function normalise(s) {
  return s.toLowerCase().replace(/[\s\-\/().]/g, '').trim();
}

async function main() {
  // 1. Fetch all existing semi-finished items
  const existingItems = await get('items?product_type=eq.semi_finished&is_active=eq.true&select=id,name');
  console.log(`\nExisting recipes in DB: ${existingItems.length}`);
  existingItems.forEach(i => console.log(`  ✓ ${i.name}`));

  const existingNorms = new Set(existingItems.map(i => normalise(i.name)));

  // 2. Find catalog items with no match
  const missing = CATALOG.filter(c => !existingNorms.has(normalise(c.name)));
  console.log(`\nMissing (${missing.length} items to create):`);
  missing.forEach(m => console.log(`  ✗ ${m.name} [${m.category}]`));

  if (missing.length === 0) {
    console.log('\nAll catalog items already have a recipe. Nothing to do.');
    return;
  }

  // 3. Fetch all categories
  const categories = await get('categories?select=id,name');
  const catMap = {};
  for (const c of categories) catMap[c.name] = c.id;
  console.log('\nAvailable categories:', Object.keys(catMap).join(', '));

  // 4. Create items + recipes for each missing entry
  let created = 0;
  for (const entry of missing) {
    // Match category name (case-insensitive, fuzzy)
    const catId = Object.entries(catMap).find(
      ([name]) => normalise(name) === normalise(entry.category)
    )?.[1] ?? null;

    // Insert item
    const [newItem] = await post('items', {
      name:         entry.name,
      product_type: 'semi_finished',
      is_produced:  true,
      is_active:    true,
      category_id:  catId,
    });

    // Insert empty recipe linked to item
    await post('recipes', {
      name:              entry.name,
      output_item_id:    newItem.id,
      output_quantity:   1,
      yield_percent:     100,
      process_steps_en:  [],
      process_steps_de:  [],
      process_steps_es:  [],
    });

    console.log(`  ✓ Created: ${entry.name}`);
    created++;
  }

  console.log(`\nDone. Created ${created} new recipes.`);
}

main().catch(err => { console.error(err); process.exit(1); });
