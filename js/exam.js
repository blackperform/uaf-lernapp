// Prüfungssimulation: zufällige Reihenfolge, Zeitvorgabe, Auswertung erst nach Abschluss.
// Alle Antworten werden ausschließlich vom System bewertet (siehe grading.js).
import { EXAM_SIZES, PERSONAL_GOAL_PERCENT } from './config.js';
import { shuffle } from './derive.js';
import { gradeCard, isGradable } from './grading.js';

export function examPool(cards, { includeUnverified = false } = {}) {
  return cards.filter(c => isGradable(c) && (includeUnverified || c.sourceStatus !== 'needs-current-verification'));
}

export function buildExam(cards, { size = 20, secondsPerQuestion = 90, includeUnverified = false, rng = Math.random, now = new Date() } = {}) {
  if (!EXAM_SIZES.includes(size)) throw new RangeError(`Prüfungsumfang ${size} nicht erlaubt (${EXAM_SIZES.join('/')}).`);
  const pool = shuffle(examPool(cards, { includeUnverified }), rng);
  const used = new Set();
  const items = [];
  for (const c of pool) {
    if (items.length >= size) break;
    if (used.has(c.learningObjective)) continue;
    used.add(c.learningObjective);
    items.push({ id: c.id, response: null, optionOrder: c.options ? shuffle(c.options.map((_, i) => i), rng) : null });
  }
  return {
    id: 'exam-' + now.getTime().toString(36),
    startedAt: now.toISOString(),
    durationSec: items.length * secondsPerQuestion,
    includeUnverified,
    items,
    state: 'running',          // running → finished
    result: null
  };
}

export function setResponse(exam, index, response) {
  if (exam.state !== 'running') throw new Error('Prüfung ist bereits abgegeben.');
  exam.items[index].response = response;
}

export function remainingSeconds(exam, now = new Date()) {
  const end = new Date(exam.startedAt).getTime() + exam.durationSec * 1000;
  return Math.max(0, Math.round((end - now.getTime()) / 1000));
}

/** Für Rückwärtskompatibilität der Tests: 1 = richtig, 0 = falsch. */
export function scoreAuto(card, response) { return gradeCard(card, response).correct ? 1 : 0; }

/** Abgabe: jede Antwort wird vom System bewertet (1 Punkt je vollständig richtiger Antwort). */
export function submitExam(exam, cardsById, now = new Date()) {
  if (exam.state !== 'running') return exam;
  exam.submittedAt = now.toISOString();
  for (const it of exam.items) {
    const g = gradeCard(cardsById.get(it.id), it.response);
    it.points = g.points;
    it.rating = g.rating;
    it.detail = g.detail;
  }
  exam.state = 'finished';
  exam.result = computeResult(exam, cardsById);
  return exam;
}

export function computeResult(exam, cardsById) {
  const byTopic = new Map();
  let points = 0;
  for (const it of exam.items) {
    const c = cardsById.get(it.id);
    points += it.points || 0;
    const t = byTopic.get(c.topic) || { topic: c.topic, points: 0, max: 0 };
    t.points += it.points || 0; t.max += 1; byTopic.set(c.topic, t);
  }
  const max = exam.items.length;
  const percent = max ? Math.round((points / max) * 1000) / 10 : 0;
  return {
    points, max, percent,
    personalGoalPercent: PERSONAL_GOAL_PERCENT,
    personalGoalReached: percent >= PERSONAL_GOAL_PERCENT,
    byTopic: [...byTopic.values()].map(t => ({ ...t, percent: Math.round((t.points / t.max) * 100) }))
      .sort((a, b) => a.percent - b.percent)
  };
}

/** Ergebnis ist ausschließlich nach Abschluss verfügbar. */
export function getResult(exam) {
  return exam.state === 'finished' ? exam.result : null;
}

/** Systembewertungen für den Lernstand (erst nach Abschluss). */
export function ratingsFromExam(exam) {
  if (exam.state !== 'finished') return [];
  return exam.items.map(it => ({ id: it.id, rating: it.rating }));
}
