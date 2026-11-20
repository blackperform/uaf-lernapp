// Auswahl, Priorisierung, Interleaving und Sitzungsablauf (rein funktional, testbar).
import { DAY_MS, isDue, overdueDays } from './srs.js';
import { shuffle } from './derive.js';

export const STALE_DAYS = 14;
export const MAX_REPEATS_PER_OBJECTIVE = 2;

/**
 * Priorisierungsklasse einer Karte:
 *  0 = überfällig/fällig, 1 = unsicher (Lernstufe ≤ 1), 2 = lange nicht geprüft, 3 = neu, 4 = nicht dran
 */
export function priorityClass(progress, now = new Date()) {
  if (!progress || !progress.attempts) return 3;
  if (isDue(progress, now)) return 0;
  if (progress.level <= 1) return 1;
  const last = progress.lastReviewed ? new Date(progress.lastReviewed).getTime() : 0;
  if (now.getTime() - last >= STALE_DAYS * DAY_MS) return 2;
  return 4;
}

/** Sortiert Karten nach Lernpriorität. Neue Karten: Originalfragen und Basiskarten zuerst. */
export function prioritize(cards, progressMap, now = new Date()) {
  const getP = c => progressMap.get(c.id);
  return cards
    .map((c, i) => ({ c, i, cls: priorityClass(getP(c), now), p: getP(c) }))
    .sort((a, b) => {
      if (a.cls !== b.cls) return a.cls - b.cls;
      if (a.cls === 0) return overdueDays(b.p, now) - overdueDays(a.p, now) || a.p.level - b.p.level;
      if (a.cls === 1) return a.p.level - b.p.level || b.p.errors - a.p.errors || time(a.p) - time(b.p);
      if (a.cls === 2 || a.cls === 4) return time(a.p) - time(b.p);
      // neu
      const ao = a.c.tags?.includes('original-2025') ? 0 : 1, bo = b.c.tags?.includes('original-2025') ? 0 : 1;
      const ad = a.c.derivedFrom ? 1 : 0, bd = b.c.derivedFrom ? 1 : 0;
      return ao - bo || ad - bd || a.i - b.i;
    })
    .map(x => ({ card: x.c, cls: x.cls }));
}
const time = p => (p && p.lastReviewed ? new Date(p.lastReviewed).getTime() : 0);

/** Interleaving: keine zwei Karten derselben Domäne hintereinander, solange vermeidbar. */
export function interleave(cards, keyFn = c => c.domain) {
  const rest = cards.slice();
  const out = [];
  let lastKey = null;
  while (rest.length) {
    let idx = rest.findIndex(c => keyFn(c) !== lastKey);
    if (idx === -1) idx = 0;
    const [c] = rest.splice(idx, 1);
    out.push(c);
    lastKey = keyFn(c);
  }
  return out;
}

/**
 * Baut eine adaptive Einheit: Priorität überfällig → unsicher → lange nicht geprüft → neu.
 * Pro Lernziel höchstens eine Karte, danach Interleaving über Themen-Domänen.
 */
export function buildQueue(cards, progressMap, { now = new Date(), limit = 10, includeNotDue = true } = {}) {
  const ranked = prioritize(cards, progressMap, now);
  const usedObjectives = new Set();
  const picked = [];
  for (const { card, cls } of ranked) {
    if (picked.length >= limit) break;
    if (cls === 4 && !includeNotDue) continue;
    if (usedObjectives.has(card.learningObjective)) continue;
    usedObjectives.add(card.learningObjective);
    picked.push(card);
  }
  return interleave(picked);
}

/** Schwachstellen: Karten mit Lernstufe 0/1 bzw. aus Themen mit Ø-Lernstufe ≤ 1 und Fehlern. */
export function weakCards(cards, progressMap) {
  const topicAgg = new Map();
  for (const c of cards) {
    const p = progressMap.get(c.id);
    if (!p || !p.attempts) continue;
    const t = topicAgg.get(c.topic) || { sum: 0, n: 0, errors: 0 };
    t.sum += p.level; t.n += 1; t.errors += p.errors; topicAgg.set(c.topic, t);
  }
  const weakTopics = new Set([...topicAgg].filter(([, t]) => t.sum / t.n <= 1 && t.errors > 0).map(([k]) => k));
  return cards.filter(c => {
    const p = progressMap.get(c.id);
    if (p && p.attempts && p.level <= 1) return true;
    return weakTopics.has(c.topic) && (!p || p.level <= 2);
  }).sort((a, b) => (progressMap.get(b.id)?.errors || 0) - (progressMap.get(a.id)?.errors || 0));
}

/** Anzahl heute fälliger Karten (bereits gelernt und Fälligkeit erreicht). */
export function dueCount(cards, progressMap, now = new Date()) {
  return cards.filter(c => isDue(progressMap.get(c.id), now)).length;
}

// ---------------------------------------------------------------------------
// Sitzungsablauf mit fehlerbasierter Wiederholung
// ---------------------------------------------------------------------------

export function createSession(cards, { mode = 'learn', rng = Math.random } = {}) {
  return {
    mode,
    queue: cards.map(c => ({ id: c.id, repeat: false })),
    index: 0,
    results: [],            // {id, rating, repeat}
    repeats: {},            // learningObjective → Anzahl Wiederholungen
    rng
  };
}

export function currentItem(session) {
  return session.queue[session.index] || null;
}

export function isFinished(session) {
  return session.index >= session.queue.length;
}

/**
 * Registriert eine Bewertung. Bei Bewertung 0 wird eine Wiederholung nach 2–3 anderen
 * Karten eingeplant – bevorzugt eine andere Frageform desselben Lernziels (Umkehraufgabe).
 * @param {Map<string, any[]>} cardsByObjective
 */
export function answer(session, card, rating, cardsByObjective) {
  const item = currentItem(session);
  if (!item || item.id !== card.id) throw new Error('Antwort passt nicht zur aktuellen Karte.');
  session.results.push({ id: card.id, rating, repeat: item.repeat });
  let requeued = null;
  if (rating === 0) {
    const lo = card.learningObjective;
    const count = session.repeats[lo] || 0;
    if (count < MAX_REPEATS_PER_OBJECTIVE) {
      session.repeats[lo] = count + 1;
      const variants = (cardsByObjective?.get(lo) || []).filter(c => c.id !== card.id);
      const variant = variants.length ? variants[Math.floor(session.rng() * variants.length)] : card;
      const gap = 2 + (session.rng() < 0.5 ? 0 : 1); // 2 oder 3 andere Fragen dazwischen
      const pos = Math.min(session.index + 1 + gap, session.queue.length);
      session.queue.splice(pos, 0, { id: variant.id, repeat: true, of: card.id });
      requeued = { id: variant.id, position: pos };
    }
  }
  session.index += 1;
  return requeued;
}

export function sessionSummary(session) {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const r of session.results) counts[r.rating] += 1;
  return {
    answered: session.results.length,
    counts,
    repeated: session.results.filter(r => r.repeat).length
  };
}

export { shuffle };
