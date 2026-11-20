// Vorbereitete, standardmäßig DEAKTIVIERTE Cloud-Synchronisationsschnittstelle.
// Es werden keine Daten übertragen. Eine Aktivierung erfordert ein Backend (HTTPS)
// und ein Identitätskonzept (siehe README „Synchronisation“).
export const SYNC_ENABLED = false;

/**
 * @typedef {Object} SyncAdapter
 * @property {() => Promise<object|null>} pull  – lädt das entfernte Backup (Format uaf-lernapp-backup)
 * @property {(backup: object) => Promise<void>} push – speichert ein Backup entfernt
 */

/** @returns {SyncAdapter} */
export function createSyncAdapter() {
  const disabled = async () => { throw new Error('Cloud-Synchronisation ist deaktiviert. Bitte JSON-Export/-Import verwenden.'); };
  return { enabled: SYNC_ENABLED, pull: disabled, push: disabled };
}

/** Ablauf für eine spätere Aktivierung: pull → mergeBackupIntoLocal → push. */
export async function synchronize(adapter, { exportLocal, mergeRemote }) {
  if (!adapter.enabled) return { skipped: true, reason: 'deaktiviert' };
  const remote = await adapter.pull();
  if (remote) await mergeRemote(remote);
  await adapter.push(await exportLocal());
  return { skipped: false };
}
