/**
 * Food sub-category classifier shared by the COGS analysis and the Items page,
 * so a purchased good's category means the same thing in both places.
 *
 * Keyword-based on the invoice description (German + Spanish food terms); the
 * first list to match wins, in CLASSIFICATION_ORDER.
 */
export const SUB_CATEGORIES = ['All', 'Fruit & Veg', 'Meat', 'Spices', 'Dairy', 'Leergut', 'Other'] as const;
export type SubCategory = typeof SUB_CATEGORIES[number];

// Keyword-based sub-category classifier (German + Spanish food terms)
const SUB_CATEGORY_KEYWORDS: Record<Exclude<SubCategory, 'All' | 'Other'>, string[]> = {
  'Fruit & Veg': [
    'banana', 'banane', 'tomate', 'tomato', 'paprika', 'zwiebel', 'onion', 'cebolla',
    'gurke', 'cucumber', 'avocado', 'limette', 'lime', 'limon', 'limón', 'zitrone',
    'lemon', 'mango', 'ananas', 'pineapple', 'salat', 'lettuce', 'spinat', 'spinach',
    'karotte', 'carrot', 'zanahoria', 'kohl', 'cabbage', 'repollo', 'chayote',
    'courgette', 'zucchini', 'aubergine', 'eggplant', 'berenjena', 'pilze', 'mushroom',
    'seta', 'blumenkohl', 'cauliflower', 'brokkoli', 'broccoli', 'mais', 'corn', 'maiz',
    'gemüse', 'vegetables', 'obst', 'fruit', 'fruta', 'verdura', 'jalapeño', 'jalapeno',
    'habanero', 'chile', 'chili', 'poblano', 'serrano', 'peperoni', 'knoblauch', 'garlic',
    'ajo', 'ingwer', 'ginger', 'jengibre', 'koriander', 'cilantro', 'petersilie',
    'parsley', 'minze', 'mint', 'hierba', 'kräuter', 'herbs',
  ],
  'Meat': [
    'rind', 'beef', 'res', 'carne', 'schwein', 'pork', 'cerdo', 'hähnchen', 'huhn',
    'chicken', 'pollo', 'lamm', 'lamb', 'cordero', 'fleisch', 'meat', 'filet', 'steak',
    'hackfleisch', 'minced', 'molida', 'wurst', 'sausage', 'chorizo', 'bacon',
    'speck', 'schinken', 'ham', 'jamón', 'barbacoa', 'birria', 'carnitas', 'al pastor',
    'costilla', 'ribs', 'rippe', 'geflügel', 'poultry', 'aves', 'truthahn', 'turkey',
    'pavo', 'ente', 'duck', 'pato', 'garnele', 'shrimp', 'camarón', 'fisch', 'fish',
    'pescado', 'lachs', 'salmon', 'salmón', 'thunfisch', 'tuna', 'atún',
  ],
  'Spices': [
    'gewürz', 'spice', 'especias', 'salz', 'salt', 'sal', 'pfeffer', 'pepper', 'pimienta',
    'oregano', 'cumin', 'kreuzkümmel', 'comino', 'paprikapulver', 'paprika powder',
    'chili powder', 'chilipulver', 'zimt', 'cinnamon', 'canela', 'vanille', 'vanilla',
    'vainilla', 'curry', 'kurkuma', 'turmeric', 'cúrcuma', 'koriandersamen', 'coriander',
    'muskat', 'nutmeg', 'nuez moscada', 'lorbeer', 'bay leaf', 'laurel', 'anis', 'anise',
    'thymian', 'thyme', 'tomillo', 'rosmarin', 'rosemary', 'romero', 'majoran',
    'marjoram', 'mejorana', 'sauce', 'soße', 'salsa', 'marinade', 'gewürzmischung',
    'seasoning', 'sazon', 'achiote', 'annatto', 'mole',
  ],
  'Dairy': [
    'milch', 'milk', 'leche', 'sahne', 'cream', 'crema', 'käse', 'cheese', 'queso',
    'quark', 'joghurt', 'yogurt', 'yoghurt', 'butter', 'mantequilla', 'ei', 'egg',
    'huevo', 'eier', 'eggs', 'huevos', 'rahm', 'creme', 'schmand', 'crème fraîche',
    'mozzarella', 'parmesan', 'gouda', 'emmental', 'feta', 'ricotta', 'mascarpone',
    'condensed', 'kondensmilch', 'molke', 'whey',
  ],
  'Leergut': [
    'leergut', 'klappkiste', 'rollcontainer',
  ],
};

const CLASSIFICATION_ORDER: Array<Exclude<SubCategory, 'All' | 'Other'>> = [
  'Leergut', 'Fruit & Veg', 'Meat', 'Spices', 'Dairy',
];

/**
 * Keywords this short must begin a word rather than match anywhere.
 *
 * German and Spanish compounds make bare substring matching unsafe for short
 * terms: 'ei' (egg) sits inside Seitan, Bleichsellerie and LANGKORNREIS; 'res'
 * (beef) inside Espresso and Speisereste; 'ham' inside CHAMPIGNON; 'sal' (salt)
 * inside HYGIENEUNIVERSAL; 'ajo' (garlic) inside Majoran. Together those
 * miscategorised 250 of 5433 Food Cost lines.
 *
 * Longer keywords keep plain substring matching, because there the compound is
 * usually the point — Hackfleisch, Mischsalat, Buttermilch, Frischkäse.
 */
const MIN_SUBSTRING_KEYWORD = 4;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does `kw` match `lower` (already lowercased)? */
function keywordMatches(lower: string, kw: string): boolean {
  if (kw.length >= MIN_SUBSTRING_KEYWORD) return lower.includes(kw);
  // Word-initial only: matches "ei", "eier", "eiweiss" — not "seitan" or "reis".
  return new RegExp(`\\b${escapeRegExp(kw)}`).test(lower);
}

export function classifyLine(description: string): Exclude<SubCategory, 'All'> {
  const lower = description.toLowerCase();
  for (const cat of CLASSIFICATION_ORDER) {
    if (SUB_CATEGORY_KEYWORDS[cat].some((kw) => keywordMatches(lower, kw))) {
      return cat;
    }
  }
  return 'Other';
}
