// Speicher-Schicht: IndexedDB mit kontrolliertem Rückfall auf einen temporären Sitzungsspeicher.
// Bewusst ohne Dexie.js (siehe README „Architekturentscheidungen“): keine Fremdabhängigkeit,
// die App läuft ohne Build-Schritt und der Service Worker muss nur eigene Dateien cachen.
import { DB_NAME, DB_VERSION, DATA_SCHEMA_VERSION, DEFAULT_SETTINGS } from './config.js';
import { migrateProgressList } from './migrations.js';

export const STORES = {
  meta: { keyPath: 'key' },
  progress: { keyPath: 'questionId' },
  backups: { keyPath: 'id' }
};

const promisify = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export class IdbBackend {
  constructor(db) { this.db = db; this.persistent = true; }
  _tx(store, mode = 'readonly') { return this.db.transaction(store, mode).objectStore(store); }
  get(store, key) { return promisify(this._tx(store).get(key)); }
  getAll(store) { return promisify(this._tx(store).getAll()); }
  put(store, value) { return promisify(this._tx(store, 'readwrite').put(value)); }
  delete(store, key) { return promisify(this._tx(store, 'readwrite').delete(key)); }
  /** Atomar: ersetzt (clear=true) oder ergänzt Datensätze in einer Transaktion. */
  bulkPut(store, values, { clear = false } = {}) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      if (clear) os.clear();
      for (const v of values) os.put(v);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaktion abgebrochen'));
    });
  }
  close() { this.db.close(); }
}

export class MemoryBackend {
  constructor() { this.persistent = false; this.data = Object.fromEntries(Object.keys(STORES).map(k => [k, new Map()])); }
  _key(store, v) { return v[STORES[store].keyPath]; }
  async get(store, key) { const v = this.data[store].get(key); return v === undefined ? undefined : clone(v); }
  async getAll(store) { return [...this.data[store].values()].map(clone); }
  async put(store, value) { this.data[store].set(this._key(store, value), clone(value)); }
  async delete(store, key) { this.data[store].delete(key); }
  async bulkPut(store, values, { clear = false } = {}) {
    if (clear) this.data[store].clear();
    for (const v of values) this.data[store].set(this._key(store, v), clone(v));
  }
  close() {}
}
const clone = v => JSON.parse(JSON.stringify(v));

function openIdb(idb, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('IndexedDB antwortet nicht (Zeitüberschreitung).')); } }, timeoutMs);
    let req;
    try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { clearTimeout(timer); reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, opts] of Object.entries(STORES)) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
    };
    req.onblocked = () => { /* andere Tabs offen – wir warten auf Timeout */ };
    req.onsuccess = () => { if (done) { req.result.close(); return; } done = true; clearTimeout(timer); resolve(req.result); };
    req.onerror = () => { if (done) return; done = true; clearTimeout(timer); reject(req.error || new Error('IndexedDB-Fehler')); };
  });
}

/**
 * Öffnet die Datenbank. Schlägt IndexedDB fehl (Sandbox, privater Modus, eingebetteter Viewer,
 * Speicher gesperrt), wird kontrolliert in den Sitzungsmodus gewechselt – kein Absturz.
 */
export async function openStorage({ idb, timeoutMs = 4000 } = {}) {
  let factory = idb;
  try { if (factory === undefined) factory = globalThis.indexedDB; } catch (e) { factory = null; }
  if (!factory) return { backend: new MemoryBackend(), persistent: false, reason: 'IndexedDB ist in dieser Umgebung nicht verfügbar.' };
  try {
    const db = await openIdb(factory, timeoutMs);
    const backend = new IdbBackend(db);
    // Schreib-/Leseprobe: manche Sandboxen öffnen die DB, verweigern aber Schreibzugriffe.
    await backend.put('meta', { key: '__probe', value: Date.now() });
    await backend.get('meta', '__probe');
    return { backend, persistent: true, reason: null };
  } catch (e) {
    return { backend: new MemoryBackend(), persistent: false, reason: `Browser-Speicher gesperrt (${e && e.name ? e.name : 'Fehler'}: ${e && e.message ? e.message : e}).` };
  }
}

/** Repository mit fachlichen Zugriffen und Start-Migration. */
export class Repository {
  constructor(backend) { this.b = backend; }

  async getMeta(key, fallback) { const r = await this.b.get('meta', key); return r ? r.value : fallback; }
  async setMeta(key, value) { await this.b.put('meta', { key, value }); }

  /** Führt beim Start Datenmigrationen aus; übernimmt ggf. Prototyp-Lernstand aus localStorage. */
  async init({ legacyStorage } = {}) {
    let version = await this.getMeta('dataSchemaVersion', null);
    const progress = await this.b.getAll('progress');
    if (version === null) {
      let legacy = [];
      try {
        const raw = legacyStorage && legacyStorage.getItem('uaf-progress-v1');
        if (raw) legacy = JSON.parse(raw);
      } catch { legacy = []; }
      if (Array.isArray(legacy) && legacy.length && !progress.length) {
        await this.b.bulkPut('progress', migrateProgressList(legacy, 1));
        await this.setMeta('migrationLog', [{ at: new Date().toISOString(), from: 1, to: DATA_SCHEMA_VERSION, count: legacy.length }]);
      }
      version = DATA_SCHEMA_VERSION;
      await this.setMeta('dataSchemaVersion', version);
    } else if (version < DATA_SCHEMA_VERSION) {
      const migrated = migrateProgressList(progress, version);
      await this.b.bulkPut('progress', migrated, { clear: true });
      await this.setMeta('dataSchemaVersion', DATA_SCHEMA_VERSION);
    }
    return { dataSchemaVersion: DATA_SCHEMA_VERSION };
  }

  async allProgress() { return this.b.getAll('progress'); }
  async saveProgress(p) { await this.b.put('progress', p); }
  async replaceProgress(list) { await this.b.bulkPut('progress', list, { clear: true }); }

  async settings() { return { ...DEFAULT_SETTINGS, ...(await this.getMeta('settings', {})) }; }
  async saveSettings(s) { await this.setMeta('settings', s); }

  async daily() { return this.getMeta('daily', {}); }
  async bumpDaily(key, n = 1) {
    const d = await this.daily();
    d[key] = (d[key] || 0) + n;
    await this.setMeta('daily', d);
    return d;
  }
  async examHistory() { return this.getMeta('examHistory', []); }
  async addExam(entry) {
    const h = await this.examHistory();
    h.push(entry);
    await this.setMeta('examHistory', h.slice(-100));
  }

  async snapshotMeta() {
    return { settings: await this.getMeta('settings', {}), daily: await this.daily(), examHistory: await this.examHistory() };
  }

  /** Interne Sicherung (z. B. vor Import). Die letzten 3 werden behalten. */
  async createInternalBackup(backupObj, reason) {
    const id = 'bk-' + Date.now().toString(36);
    await this.b.put('backups', { id, at: new Date().toISOString(), reason, data: backupObj });
    const all = (await this.b.getAll('backups')).sort((a, b) => a.at.localeCompare(b.at));
    for (const old of all.slice(0, Math.max(0, all.length - 3))) await this.b.delete('backups', old.id);
    return id;
  }
  async internalBackups() { return (await this.b.getAll('backups')).sort((a, b) => b.at.localeCompare(a.at)); }

  /** Ersetzt den kompletten Lernstand atomar (nur nach erfolgreicher Validierung aufrufen). */
  async restore({ progress, meta }) {
    await this.b.bulkPut('progress', progress, { clear: true });
    const cur = await this.getMeta('settings', {});
    await this.setMeta('settings', { ...cur, ...(meta.settings || {}) });
    await this.setMeta('daily', meta.daily || {});
    await this.setMeta('examHistory', meta.examHistory || []);
  }

  async resetProgress() {
    await this.b.bulkPut('progress', [], { clear: true });
    await this.setMeta('daily', {});
    await this.setMeta('examHistory', []);
  }
}
