// Zentraler App-Zustand und fachliche Aktionen (Bewerten, Katalog laden, Export/Import).
import { APP_VERSION, DEFAULT_SETTINGS } from './config.js';
import { openStorage, Repository, MemoryBackend } from './db.js';
import { applyRating, newProgress } from './srs.js';
import { buildCards, listChoiceCards } from './derive.js';
import { groupByObjective, dayKey } from './stats.js';
import { applyCatalogToProgress } from './migrations.js';
import { createBackup, parseBackup, mergeBackupIntoLocal } from './backup.js';
import { validateCatalogJson } from './catalog-parser.js';

export const app = {
  version: APP_VERSION,
  repo: null,
  persistent: false,
  storageReason: null,
  catalog: null,
  catalogIsCustom: false,
  extras: { vehicles: null, signs: null, overrides: {} },
  cards: [],
  cardsById: new Map(),
  cardsByObjective: new Map(),
  progress: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  daily: {},
  orphaned: [],
  listeners: new Set(),
  banners: new Map(),
  announce: () => {},
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { for (const fn of this.listeners) { try { fn(); } catch (e) { console.error(e); } } }
};

function safeLocalStorage() {
  try { const ls = globalThis.localStorage; ls.getItem('__probe'); return ls; } catch { return null; }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export function setBanner(id, banner) {
  if (banner) app.banners.set(id, banner); else app.banners.delete(id);
  app.emit();
}

/** Start: Speicher öffnen, migrieren, Katalog laden, Lernstand einlesen. */
export async function initApp({ idb } = {}) {
  const storage = await openStorage({ idb });
  await activateStorage(storage);
  const [vehicles, signs, overrides, forms] = await Promise.all([
    fetchJson('data/vehicles.json').catch(() => null),
    fetchJson('data/signs.json').catch(() => null),
    fetchJson('data/catalog-overrides.json').catch(() => ({})),
    fetchJson('data/forms2025.json').catch(() => null)
  ]);
  app.extras = { vehicles, signs, overrides, forms };
  const custom = await app.repo.getMeta('customCatalog', null);
  let catalog = null;
  if (custom && validateCatalogJson(custom).ok) { catalog = custom; app.catalogIsCustom = true; }
  else catalog = await fetchJson('data/catalog.json');
  await useCatalog(catalog, { persist: false });
  app.settings = await app.repo.settings();
  app.daily = await app.repo.daily();
  return app;
}

async function activateStorage(storage) {
  app.repo = new Repository(storage.backend);
  app.persistent = storage.persistent;
  app.storageReason = storage.reason;
  try {
    await app.repo.init({ legacyStorage: safeLocalStorage() });
  } catch (e) {
    // Migration/Initialisierung fehlgeschlagen → nichts überschreiben, Sitzungsmodus.
    app.repo = new Repository(new MemoryBackend());
    await app.repo.init({});
    app.persistent = false;
    app.storageReason = 'Initialisierung des Speichers fehlgeschlagen: ' + e.message;
  }
  if (!app.persistent) {
    setBanner('storage', {
      kind: 'warn',
      text: `Temporärer Sitzungsmodus: ${app.storageReason} Der Lernstand bleibt nur bis zum Schließen erhalten. ` +
        'Bitte unter „Mehr → Datensicherung“ exportieren oder die App direkt im Browser (nicht im eingebetteten Dokumentbetrachter) öffnen.'
    });
  } else {
    try { await navigator.storage?.persist?.(); } catch { /* optional */ }
  }
}

/** Setzt einen Katalog aktiv. Lernstand bleibt erhalten (Aliase, verwaiste Datensätze). */
export async function useCatalog(catalog, { persist = true } = {}) {
  if (!Array.isArray(catalog.derivedChoices)) catalog.derivedChoices = listChoiceCards(catalog.questions);
  const cards = buildCards(catalog, { vehicles: app.extras.vehicles, signs: app.extras.signs });
  const stored = await app.repo.allProgress();
  const { progress, renamed, orphaned } = applyCatalogToProgress(stored, cards.map(c => c.id), catalog.idAliases || {});
  if (renamed.length) await safeWrite(() => app.repo.replaceProgress(progress));
  if (persist) await safeWrite(() => app.repo.setMeta('customCatalog', catalog));
  app.catalog = catalog;
  app.cards = cards;
  app.cardsById = new Map(cards.map(c => [c.id, c]));
  app.cardsByObjective = groupByObjective(cards);
  app.progress = new Map(progress.map(p => [p.questionId, p]));
  app.orphaned = orphaned;
  app.emit();
  return { renamed, orphaned, cards: cards.length };
}

export async function resetToDefaultCatalog() {
  await safeWrite(() => app.repo.setMeta('customCatalog', null));
  app.catalogIsCustom = false;
  return useCatalog(await fetchJson('data/catalog.json'), { persist: false });
}

/** Schreibfehler zur Laufzeit (Quota, Sandbox) führen nicht zum Absturz. */
async function safeWrite(fn) {
  try { await fn(); return true; } catch (e) {
    console.error(e);
    setBanner('write', { kind: 'warn', text: 'Speichern fehlgeschlagen (' + (e.message || e) + '). Änderungen sind nur in dieser Sitzung vorhanden – bitte Lernstand exportieren.' });
    return false;
  }
}

export async function recordRating(card, rating, mode = 'learn') {
  const prev = app.progress.get(card.id) || newProgress(card.id);
  const next = applyRating(prev, rating, new Date(), mode);
  app.progress.set(card.id, next);
  await safeWrite(() => app.repo.saveProgress(next));
  app.daily[dayKey()] = (app.daily[dayKey()] || 0) + 1;
  await safeWrite(() => app.repo.setMeta('daily', app.daily));
  return next;
}

export async function saveSettings(patch) {
  app.settings = { ...app.settings, ...patch };
  await safeWrite(() => app.repo.saveSettings(app.settings));
  app.emit();
}

export async function addExamToHistory(entry) {
  await safeWrite(() => app.repo.addExam(entry));
}

export async function exportBackup() {
  return createBackup({
    progress: [...app.progress.values()],
    meta: { settings: app.settings, daily: app.daily, examHistory: await app.repo.examHistory() },
    catalogVersion: app.catalog?.catalogVersion
  });
}

export function downloadJson(obj, fileName) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function backupFileName(prefix = 'uaf-lernstand') {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
}

/**
 * Import mit Validierung. Bei Fehlern bleibt die Datenbank unverändert.
 * Vor dem Schreiben wird immer eine interne Sicherung angelegt.
 */
export async function importBackupText(text, { strategy = 'replace' } = {}) {
  const parsed = parseBackup(text);
  if (!parsed.ok) return parsed;
  const current = await exportBackup();
  await safeWrite(() => app.repo.createInternalBackup(current, 'vor Import'));
  const local = { progress: current.progress, meta: current.meta };
  const next = strategy === 'merge'
    ? mergeBackupIntoLocal(local, parsed.backup)
    : { progress: parsed.backup.progress, meta: { ...parsed.backup.meta, settings: { ...app.settings, ...(parsed.backup.meta.settings || {}) } } };
  const ok = await safeWrite(() => app.repo.restore(next));
  app.progress = new Map(next.progress.map(p => [p.questionId, p]));
  app.daily = next.meta.daily || {};
  app.settings = { ...DEFAULT_SETTINGS, ...(next.meta.settings || {}) };
  const ids = new Set(app.cards.map(c => c.id));
  app.orphaned = next.progress.filter(p => !ids.has(p.questionId)).map(p => p.questionId);
  app.emit();
  return { ok: true, persisted: ok, count: next.progress.length, taken: next.taken, migratedFrom: parsed.backup.migratedFrom };
}

export async function restoreInternalBackup(id) {
  const all = await app.repo.internalBackups();
  const b = all.find(x => x.id === id);
  if (!b) return { ok: false, errors: ['Sicherung nicht gefunden.'] };
  return importBackupText(JSON.stringify(b.data), { strategy: 'replace' });
}

export async function resetAllProgress() {
  const current = await exportBackup();
  await safeWrite(() => app.repo.createInternalBackup(current, 'vor Zurücksetzen'));
  await safeWrite(() => app.repo.resetProgress());
  app.progress = new Map();
  app.daily = {};
  app.emit();
}
