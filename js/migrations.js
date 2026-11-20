// Versionierte Migrationen für Lernstand und Backups.
// Grundsatz: Migrationen dürfen Lernstand NIE verwerfen. Unbekannte Fragen werden als „verwaist“ behalten.
import { DATA_SCHEMA_VERSION } from './config.js';
import { EASE_START, EASE_MIN, EASE_MAX, newProgress } from './srs.js';

/**
 * Schema v1 (Prototyp, localStorage-Key „uaf-progress-v1“):
 *   { id, reps, ef, interval, due:number(ms), last:number(ms), lastGrade, lapses, streak }
 * Schema v2 (aktuell, IndexedDB):
 *   { questionId, attempts, lastRating, lastReviewed:ISO, due:ISO, interval, ease, level, streak, errors, history[] }
 */
export function migrateRecordV1toV2(r) {
  const p = newProgress(String(r.id ?? r.questionId));
  p.attempts = Number(r.reps) || 0;
  p.lastRating = Number.isInteger(r.lastGrade) ? Math.min(3, Math.max(0, r.lastGrade)) : null;
  p.lastReviewed = r.last ? new Date(r.last).toISOString() : null;
  p.due = r.due ? new Date(r.due).toISOString() : null;
  p.interval = Number(r.interval) || 0;
  p.ease = Math.min(EASE_MAX, Math.max(EASE_MIN, Number(r.ef) || EASE_START));
  p.streak = Number(r.streak) || 0;
  p.errors = Number(r.lapses) || 0;
  // Lernstufe aus richtiger Serie abschätzen (v1 kannte keine Stufe).
  p.level = p.lastRating === null ? 0 : p.lastRating <= 1 ? p.lastRating : Math.min(5, 1 + p.streak);
  p.history = p.lastReviewed ? [{ at: p.lastReviewed, rating: p.lastRating ?? 0, mode: 'migration-v1' }] : [];
  return p;
}

const RECORD_MIGRATIONS = {
  1: migrateRecordV1toV2
};

/** Migriert eine Liste von Lernstand-Datensätzen von fromVersion auf DATA_SCHEMA_VERSION. */
export function migrateProgressList(list, fromVersion) {
  if (fromVersion > DATA_SCHEMA_VERSION) throw new Error(`Lernstand-Version ${fromVersion} ist neuer als die App (${DATA_SCHEMA_VERSION}). Bitte App aktualisieren.`);
  let out = list;
  for (let v = fromVersion; v < DATA_SCHEMA_VERSION; v++) {
    const fn = RECORD_MIGRATIONS[v];
    if (!fn) throw new Error(`Keine Migration von Version ${v} vorhanden.`);
    out = out.map(fn);
  }
  return out;
}

/**
 * Wendet einen (neuen) Fragenkatalog auf bestehenden Lernstand an:
 *  - idAliases { alteId: neueId } benennen Fragen um, Lernstand wandert mit
 *  - bei Kollision gewinnt der zuletzt bearbeitete Datensatz
 *  - Lernstand zu nicht mehr vorhandenen Fragen bleibt erhalten (orphaned)
 */
export function applyCatalogToProgress(progressList, cardIds, idAliases = {}) {
  const ids = new Set(cardIds);
  const result = new Map();
  const renamed = [];
  for (const rec of progressList) {
    let id = rec.questionId;
    if (idAliases[id] && idAliases[id] !== id) { renamed.push([id, idAliases[id]]); id = idAliases[id]; }
    const next = { ...rec, questionId: id };
    const existing = result.get(id);
    if (!existing || time(next) > time(existing)) result.set(id, next);
  }
  const progress = [...result.values()];
  const orphaned = progress.filter(p => !ids.has(p.questionId)).map(p => p.questionId);
  return { progress, renamed, orphaned };
}
const time = p => (p.lastReviewed ? new Date(p.lastReviewed).getTime() : 0);

/** Backup-Migration: formatVersion 1 enthielt „cards“ statt „progress“ im v1-Datensatzformat. */
export function migrateBackup(obj) {
  const v = Number(obj.formatVersion);
  if (v === DATA_SCHEMA_VERSION) return obj;
  if (v === 1) {
    return {
      ...obj,
      formatVersion: DATA_SCHEMA_VERSION,
      progress: migrateProgressList(Array.isArray(obj.cards) ? obj.cards : [], 1),
      meta: obj.meta || { settings: {}, daily: {}, examHistory: [] },
      migratedFrom: 1
    };
  }
  throw new Error(`Backup-Formatversion ${obj.formatVersion} wird nicht unterstützt.`);
}
