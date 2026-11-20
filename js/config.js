// Zentrale Konstanten. APP_VERSION wird beim Build zusätzlich in den Service Worker gestempelt.
export const APP_VERSION = '1.1.0';
/** Version des Lernstand-/Backup-Formats. Änderungen erfordern eine Migration in migrations.js. */
export const DATA_SCHEMA_VERSION = 2;
/** Version der IndexedDB-Objektstruktur (Object Stores). */
export const DB_NAME = 'uaf-lernapp';
export const DB_VERSION = 1;
export const BACKUP_FORMAT = 'uaf-lernapp-backup';
export const CATALOG_FORMAT = 'uaf-catalog';
export const DEFAULT_SETTINGS = Object.freeze({
  dailyGoal: 20,
  theme: 'auto',            // auto | light | dark
  showSource: true,         // Quelle und Prüfstatus bei jeder Frage anzeigen
  examSize: 20,             // 10 | 20 | 30 | 50
  examSecondsPerQuestion: 90,
  examIncludeUnverified: false,
  sessionSize: 10
});
export const EXAM_SIZES = [10, 20, 30, 50];
export const PERSONAL_GOAL_PERCENT = 70;
