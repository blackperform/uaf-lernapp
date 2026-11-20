// Fortschrittsanalyse: Lernziel-Sicherheit, Themenstatistik, Lernserie, Tagesziel.
import { MAX_LEVEL } from './srs.js';

export function groupByObjective(cards) {
  const m = new Map();
  for (const c of cards) {
    const l = m.get(c.learningObjective) || [];
    l.push(c); m.set(c.learningObjective, l);
  }
  return m;
}

/**
 * Lernziel-Status:
 *  'sicher'   – mindestens ZWEI unterschiedlich formulierte Karten zuletzt mit ≥ 2 bewertet
 *  'gefestigt'– eine Karte korrekt, aber keine zweite Frageform korrekt
 *  'lernend'  – bearbeitet, aber nicht korrekt
 *  'neu'      – nicht bearbeitet
 *  singleForm=true – nur eine Frageform vorhanden → „sicher“ grundsätzlich nicht erreichbar
 */
export function objectiveStatus(objectiveCards, progressMap) {
  const correct = new Set();
  let attempted = false;
  for (const c of objectiveCards) {
    const p = progressMap.get(c.id);
    if (p && p.attempts) attempted = true;
    if (p && p.lastRating !== null && p.lastRating >= 2) correct.add(normalizeWording(c));
  }
  const forms = new Set(objectiveCards.map(normalizeWording)).size;
  let status = 'neu';
  if (correct.size >= 2) status = 'sicher';
  else if (correct.size === 1) status = 'gefestigt';
  else if (attempted) status = 'lernend';
  return { status, singleForm: forms < 2 };
}
// Zwei Karten gelten als unterschiedlich formuliert, wenn sich Fragetext oder Kontext unterscheiden.
const normalizeWording = c => (c.question + '|' + (c.context || '') + '|' + (c.imagePath || '')).toLowerCase();

export function topicStats(cards, progressMap) {
  const byObj = groupByObjective(cards);
  const topics = new Map();
  for (const c of cards) {
    const t = topics.get(c.topic) || { topic: c.topic, domain: c.domain, cards: 0, attempted: 0, errors: 0, attempts: 0, levelSum: 0, objectives: new Set(), secure: 0 };
    t.cards += 1;
    const p = progressMap.get(c.id);
    if (p && p.attempts) { t.attempted += 1; t.errors += p.errors; t.attempts += p.attempts; t.levelSum += p.level; }
    t.objectives.add(c.learningObjective);
    topics.set(c.topic, t);
  }
  const out = [];
  for (const t of topics.values()) {
    let secure = 0;
    for (const lo of t.objectives) if (objectiveStatus(byObj.get(lo), progressMap).status === 'sicher') secure += 1;
    out.push({
      topic: t.topic, domain: t.domain, cards: t.cards, attempted: t.attempted, errors: t.errors,
      errorRate: t.attempts ? t.errors / t.attempts : 0,
      meanLevel: t.attempted ? t.levelSum / t.attempted : 0,
      objectives: t.objectives.size, secureObjectives: secure,
      secure: secure === t.objectives.size && t.objectives.size > 0
    });
  }
  return out.sort((a, b) => a.topic.localeCompare(b.topic, 'de'));
}

/** Drei schwächste Themen (nur bearbeitete): hohe Fehlerquote, niedrige Lernstufe. */
export function weakestTopics(stats, n = 3) {
  return stats.filter(s => s.attempted > 0)
    .sort((a, b) => (b.errorRate - a.errorRate) || (a.meanLevel - b.meanLevel))
    .slice(0, n);
}

export function overallMastery(cards, progressMap) {
  const byObj = groupByObjective(cards);
  let secure = 0, levelSum = 0;
  for (const list of byObj.values()) if (objectiveStatus(list, progressMap).status === 'sicher') secure += 1;
  for (const c of cards) levelSum += progressMap.get(c.id)?.level || 0;
  return {
    objectives: byObj.size,
    secureObjectives: secure,
    percent: byObj.size ? Math.round((secure / byObj.size) * 100) : 0,
    meanLevelPercent: cards.length ? Math.round((levelSum / (cards.length * MAX_LEVEL)) * 100) : 0
  };
}

export function dayKey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Lernserie: aufeinanderfolgende Tage mit Aktivität, endend heute oder gestern. */
export function streak(daily, now = new Date()) {
  const has = k => (daily?.[k] || 0) > 0;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (has(dayKey(d))) { n += 1; d.setDate(d.getDate() - 1); }
  return n;
}
