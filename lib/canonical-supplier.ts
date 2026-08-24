/**
 * Post-extraction correction of OCR errors in supplier names.
 *
 * The extraction model occasionally misreads stylised logo text — e.g. the real
 * supplier "Bier-Zentrale Leleithner GmbH" has come back as "BIER-ZENTRALE
 * LEIEITHNER GMBH", "BIER-ZENTRALE LEITHNER GMBH" and "BIER-ZENTRALE RELEITHNER
 * GMBH". Those variants then fail to match the counterparty and show up under the
 * wrong name.
 *
 * We fix this by fuzzy-matching the *distinctive* tokens of the extracted name
 * against the counterparty names/keywords already on file. Matching is done per
 * token (or per multi-word window for multi-word terms), never against the whole
 * string, and short/generic tokens are skipped — so a shared word like
 * "Bier-Zentrale" or "GmbH" can never pull a bill onto the wrong supplier.
 */

/** Terms shorter than this are too collision-prone to fuzzy-match. */
const MIN_TERM_LEN = 7;

/** Normalised similarity a token must reach to be treated as the same term. */
const MIN_SIMILARITY = 0.8;

/** Legal-form and generic trade words that must never be fuzzy-matched. */
const STOPWORDS = new Set([
  'gmbh', 'mbh', 'ohg', 'kgaa', 'gmbhcokg', 'ug', 'ag', 'kg', 'gbr', 'ev', 'se',
  'co', 'und', 'the', 'ltd', 'limited', 'bv', 'nv', 'sarl', 'srl', 'spa', 'sa',
  'company', 'group', 'holding', 'international', 'deutschland', 'germany',
  'gastronomie', 'gastronomiepartner', 'getraenke', 'getraenkegrosshandel',
  'grosshandel', 'handel', 'vertrieb', 'service', 'services', 'systeme',
]);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length];
}

/** Case/accent/punctuation-insensitive comparison key. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

export type KnownTerm = { canonical: string; key: string; words: number };

/**
 * Build the vocabulary of distinctive supplier terms from the counterparties
 * table. Terms that are too short, are stopwords, or are ambiguous (the same
 * normalised key claimed by more than one counterparty) are dropped.
 */
export function buildKnownTerms(
  counterparties: { name: string; keywords: string[] | null }[],
): KnownTerm[] {
  const byKey = new Map<string, Set<string>>();
  const canonicalByKey = new Map<string, string>();

  for (const cp of counterparties) {
    const terms = [cp.name, ...(cp.keywords ?? [])].filter(Boolean);
    for (const term of terms) {
      const key = norm(term);
      if (key.length < MIN_TERM_LEN) continue;
      if (STOPWORDS.has(key)) continue;
      if (!byKey.has(key)) byKey.set(key, new Set());
      byKey.get(key)!.add(cp.name);
      if (!canonicalByKey.has(key)) canonicalByKey.set(key, term);
    }
  }

  const out: KnownTerm[] = [];
  for (const [key, owners] of byKey) {
    if (owners.size > 1) continue; // ambiguous across suppliers — never auto-correct
    const canonical = canonicalByKey.get(key)!;
    out.push({ canonical, key, words: canonical.trim().split(/\s+/).length });
  }
  return out;
}

/**
 * Correct OCR noise in `raw` by snapping near-miss tokens to their canonical
 * spelling. Returns `raw` unchanged when nothing matches confidently.
 */
export function canonicalizeSupplierName(raw: string, known: KnownTerm[]): string {
  if (!raw?.trim() || known.length === 0) return raw;

  // Split on whitespace but keep the original tokens so we can rebuild the string.
  const tokens = raw.split(/(\s+)/);
  const wordIdx = tokens.map((t, i) => (/\S/.test(t) ? i : -1)).filter(i => i >= 0);

  const maxWords = Math.max(...known.map(k => k.words));
  const replaced = new Set<number>();

  // Longest windows first so multi-word terms win over single-word ones.
  for (let win = Math.min(maxWords, wordIdx.length); win >= 1; win--) {
    const candidates = known.filter(k => k.words === win);
    if (candidates.length === 0) continue;

    for (let start = 0; start + win <= wordIdx.length; start++) {
      const idxs = wordIdx.slice(start, start + win);
      if (idxs.some(i => replaced.has(i))) continue;

      const phrase = idxs.map(i => tokens[i]).join(' ');
      const key = norm(phrase);
      if (key.length < MIN_TERM_LEN || STOPWORDS.has(key)) continue;

      let best: KnownTerm | null = null;
      let bestScore = 0;
      for (const cand of candidates) {
        const score = similarity(key, cand.key);
        if (score > bestScore) { bestScore = score; best = cand; }
      }

      if (!best || bestScore < MIN_SIMILARITY) continue;
      if (key === best.key) { idxs.forEach(i => replaced.add(i)); continue; } // already correct

      // Snap to the canonical spelling.
      tokens[idxs[0]] = best.canonical;
      for (let k = 1; k < idxs.length; k++) tokens[idxs[k]] = '';
      idxs.forEach(i => replaced.add(i));
    }
  }

  return tokens.join('').replace(/\s{2,}/g, ' ').trim();
}

let cache: { at: number; terms: KnownTerm[] } | null = null;
const TTL_MS = 60_000;

/** Fetch (and briefly cache) the known-supplier vocabulary. */
export async function getKnownTerms(): Promise<KnownTerm[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.terms;
  try {
    const { getSupabaseAdmin } = await import('@/lib/supabase-admin');
    const admin = getSupabaseAdmin();
    const { data } = await admin.from('counterparties').select('name, keywords');
    const terms = buildKnownTerms(data ?? []);
    cache = { at: Date.now(), terms };
    return terms;
  } catch {
    return cache?.terms ?? [];
  }
}
