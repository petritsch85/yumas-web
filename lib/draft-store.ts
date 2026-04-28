const PREFIX = 'yumas-draft-';

export type Draft = {
  counts:  Record<string, string>;
  comment: string;
  savedAt: string;
};

export function saveDraft(locationId: string, counts: Record<string, string>, comment: string) {
  try {
    localStorage.setItem(
      PREFIX + locationId,
      JSON.stringify({ counts, comment, savedAt: new Date().toISOString() })
    );
  } catch { /* storage full or unavailable */ }
}

export function loadDraft(locationId: string): Draft | null {
  try {
    const raw = localStorage.getItem(PREFIX + locationId);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function clearDraft(locationId: string) {
  try { localStorage.removeItem(PREFIX + locationId); } catch { /* ignore */ }
}
