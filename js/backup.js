// Export/Import des Lernstands als JSON inkl. Validierung, Prüfsumme und Zusammenführung.
import { APP_VERSION, BACKUP_FORMAT, DATA_SCHEMA_VERSION } from './config.js';
import { fnv1a } from './catalog-parser.js';
import { migrateBackup } from './migrations.js';

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export function checksumOf(payload) {
  return 'fnv1a-' + fnv1a(stableStringify({ progress: payload.progress, meta: payload.meta }));
}

/** Erzeugt das Exportobjekt: alle Lernstände, Statistiken, Einstellungen und App-Version. */
export function createBackup({ progress, meta, catalogVersion, deviceLabel = '', now = new Date() }) {
  const payload = {
    format: BACKUP_FORMAT,
    formatVersion: DATA_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now.toISOString(),
    catalogVersion: catalogVersion || null,
    deviceLabel,
    progress: progress.slice().sort((a, b) => a.questionId.localeCompare(b.questionId)),
    meta: {
      settings: meta.settings || {},
      daily: meta.daily || {},
      examHistory: meta.examHistory || []
    }
  };
  payload.statistics = {
    cardsWithProgress: payload.progress.length,
    totalAttempts: payload.progress.reduce((s, p) => s + (p.attempts || 0), 0),
    totalErrors: payload.progress.reduce((s, p) => s + (p.errors || 0), 0),
    activeDays: Object.keys(payload.meta.daily).length,
    exams: payload.meta.examHistory.length
  };
  payload.checksum = checksumOf(payload);
  return payload;
}

function validRecord(r) {
  const isoOrNull = v => v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));
  return r && typeof r === 'object' &&
    typeof r.questionId === 'string' && r.questionId.length > 0 && r.questionId.length < 200 &&
    Number.isInteger(r.attempts) && r.attempts >= 0 &&
    (r.lastRating === null || [0, 1, 2, 3].includes(r.lastRating)) &&
    isoOrNull(r.lastReviewed) && isoOrNull(r.due) &&
    typeof r.interval === 'number' && r.interval >= 0 &&
    typeof r.ease === 'number' && r.ease >= 1 && r.ease <= 5 &&
    Number.isInteger(r.level) && r.level >= 0 && r.level <= 5 &&
    Number.isInteger(r.streak) && r.streak >= 0 &&
    Number.isInteger(r.errors) && r.errors >= 0 &&
    Array.isArray(r.history);
}

/**
 * Liest und validiert eine Backup-Datei. Gibt NIE teilweise Daten zurück:
 * Entweder {ok:true, backup} oder {ok:false, errors}.
 */
export function parseBackup(text) {
  const errors = [];
  if (typeof text !== 'string' || !text.trim()) return { ok: false, errors: ['Datei ist leer.'] };
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, errors: ['Datei ist zu groß.'] };
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, errors: ['Datei ist kein gültiges JSON (beschädigt?).'] }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['Unerwartete Dateistruktur.'] };
  if (obj.format !== BACKUP_FORMAT) return { ok: false, errors: [`Fremde Datei: „format“ ist nicht „${BACKUP_FORMAT}“.`] };
  if (Number(obj.formatVersion) > DATA_SCHEMA_VERSION) return { ok: false, errors: [`Backup stammt aus einer neueren App-Version (Format ${obj.formatVersion}). Bitte App aktualisieren.`] };
  if (Number(obj.formatVersion) === DATA_SCHEMA_VERSION) {
    if (!obj.checksum) errors.push('Prüfsumme fehlt.');
    else if (obj.checksum !== checksumOf(obj)) errors.push('Prüfsumme stimmt nicht – Datei wurde verändert oder ist beschädigt.');
  }
  if (errors.length) return { ok: false, errors };
  let migrated;
  try { migrated = migrateBackup(obj); } catch (e) { return { ok: false, errors: [e.message] }; }
  if (!Array.isArray(migrated.progress)) return { ok: false, errors: ['Feld „progress“ fehlt.'] };
  const bad = migrated.progress.findIndex(r => !validRecord(r));
  if (bad !== -1) return { ok: false, errors: [`Ungültiger Lernstand-Datensatz an Position ${bad + 1}.`] };
  const ids = new Set();
  for (const r of migrated.progress) {
    if (ids.has(r.questionId)) return { ok: false, errors: [`Doppelter Lernstand für ${r.questionId}.`] };
    ids.add(r.questionId);
  }
  const meta = migrated.meta || {};
  if (meta.daily && (typeof meta.daily !== 'object' || Array.isArray(meta.daily))) return { ok: false, errors: ['Tagesstatistik ungültig.'] };
  if (meta.examHistory && !Array.isArray(meta.examHistory)) return { ok: false, errors: ['Prüfungshistorie ungültig.'] };
  return { ok: true, backup: migrated };
}

/** Zusammenführen zweier Geräte: je Frage gewinnt der zuletzt bearbeitete Stand. */
export function mergeBackupIntoLocal(local, incoming) {
  const map = new Map(local.progress.map(p => [p.questionId, p]));
  let taken = 0;
  for (const p of incoming.progress) {
    const cur = map.get(p.questionId);
    const t = x => (x && x.lastReviewed ? Date.parse(x.lastReviewed) : -1);
    if (!cur || t(p) > t(cur)) { map.set(p.questionId, p); taken += 1; }
  }
  const daily = { ...(local.meta.daily || {}) };
  for (const [k, v] of Object.entries(incoming.meta.daily || {})) daily[k] = Math.max(daily[k] || 0, v);
  const exams = new Map((local.meta.examHistory || []).map(e => [e.id, e]));
  for (const e of incoming.meta.examHistory || []) if (!exams.has(e.id)) exams.set(e.id, e);
  return {
    progress: [...map.values()],
    meta: { settings: local.meta.settings, daily, examHistory: [...exams.values()].sort((a, b) => String(a.at).localeCompare(String(b.at))) },
    taken
  };
}
