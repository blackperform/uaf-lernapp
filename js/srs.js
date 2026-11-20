// Vereinfachte SM-2-Variante für die Bewertungsskala 0–3.
// Reine Funktionen ohne DOM-/Speicherzugriff → vollständig unit-testbar.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const EASE_START = 2.5;
export const EASE_MIN = 1.3;
export const EASE_MAX = 3.0;
export const MAX_INTERVAL_DAYS = 180;
export const MAX_LEVEL = 5;
export const HISTORY_LIMIT = 50;

export const RATING_LABELS = Object.freeze({
  0: 'Nicht gewusst / falsch',
  1: 'Große Lücken',
  2: 'Überwiegend richtig',
  3: 'Vollständig und sicher'
});

/** Leerer Lernstand einer Frage (Datenschema v2). */
export function newProgress(questionId) {
  return {
    questionId,
    attempts: 0,
    lastRating: null,
    lastReviewed: null,   // ISO-Zeitpunkt
    due: null,            // ISO-Zeitpunkt; null = neu
    interval: 0,          // Tage
    ease: EASE_START,
    level: 0,             // Lernstufe 0–5
    streak: 0,            // richtige Serie (Bewertung ≥ 2)
    errors: 0,            // Fehlerzähler (Bewertung ≤ 1)
    history: []           // Fehler-/Bewertungshistorie [{at, rating, mode}]
  };
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round2(v) { return Math.round(v * 100) / 100; }

/**
 * Wendet eine Bewertung an und liefert einen NEUEN Lernstand.
 * Intervalle:
 *  0 → Intervall 0, sofort fällig (Wiederholung in derselben Sitzung übernimmt session.js)
 *  1 → 1 Tag
 *  2 → 3 Tage (Erstbewertung bzw. vorheriges Intervall < 3), sonst max(4, vorher × 1,5)
 *  3 → 10 Tage beim ersten Mal, 14 Tage wenn bereits ≥ 3 Tage Intervall, danach vorher × Leichtigkeitsfaktor
 */
export function applyRating(progress, rating, now = new Date(), mode = 'learn') {
  if (![0, 1, 2, 3].includes(rating)) throw new RangeError(`Ungültige Bewertung: ${rating}`);
  const p = progress ? structuredCloneSafe(progress) : newProgress('unknown');
  const prev = Number(p.interval) || 0;
  let interval;
  switch (rating) {
    case 0:
      interval = 0;
      p.ease = clamp(round2(p.ease - 0.2), EASE_MIN, EASE_MAX);
      p.level = 0;
      p.streak = 0;
      p.errors += 1;
      break;
    case 1:
      interval = 1;
      p.ease = clamp(round2(p.ease - 0.15), EASE_MIN, EASE_MAX);
      p.level = 1;
      p.streak = 0;
      p.errors += 1;
      break;
    case 2:
      interval = prev < 3 ? 3 : Math.max(4, Math.round(prev * 1.5));
      p.ease = clamp(round2(p.ease - 0.02), EASE_MIN, EASE_MAX);
      p.level = clamp(Math.max(2, p.level + 1), 0, 4);
      p.streak += 1;
      break;
    case 3:
      if (prev < 3) interval = 10;
      else if (prev < 10) interval = 14;
      else interval = Math.round(prev * p.ease);
      p.ease = clamp(round2(p.ease + 0.1), EASE_MIN, EASE_MAX);
      p.level = clamp(Math.max(3, p.level + 1), 0, MAX_LEVEL);
      p.streak += 1;
      break;
  }
  interval = Math.min(interval, MAX_INTERVAL_DAYS);
  p.interval = interval;
  p.attempts += 1;
  p.lastRating = rating;
  p.lastReviewed = now.toISOString();
  p.due = new Date(now.getTime() + interval * DAY_MS).toISOString();
  p.history = [...(p.history || []), { at: p.lastReviewed, rating, mode }].slice(-HISTORY_LIMIT);
  return p;
}

export function isDue(progress, now = new Date()) {
  if (!progress || !progress.due) return false;
  return new Date(progress.due).getTime() <= now.getTime();
}

export function overdueDays(progress, now = new Date()) {
  if (!progress || !progress.due) return 0;
  return (now.getTime() - new Date(progress.due).getTime()) / DAY_MS;
}

function structuredCloneSafe(o) {
  return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o));
}
