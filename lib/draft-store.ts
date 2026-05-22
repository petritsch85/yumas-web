const PREFIX = 'yumas-draft-';

export type Draft = {
  counts:         Record<string, string>;
  comment:        string;
  savedAt:        string;
  elapsedSeconds: number;
  timerStarted:   boolean;
};

export function saveDraft(
  locationId: string,
  counts: Record<string, string>,
  comment: string,
  elapsedSeconds = 0,
  timerStarted = false,
) {
  try {
    localStorage.setItem(
      PREFIX + locationId,
      JSON.stringify({ counts, comment, savedAt: new Date().toISOString(), elapsedSeconds, timerStarted })
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
