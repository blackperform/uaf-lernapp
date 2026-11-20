// Parser und Validator für den Fragenkatalog (Markdown oder JSON).
// Läuft identisch im Browser (Katalogimport) und in Node (scripts/build-catalog.mjs).
import { CATALOG_FORMAT } from './config.js';

export const QUESTION_TYPES = ['open', 'single-choice', 'multiple-choice', 'ordering', 'image', 'case'];
export const SOURCE_STATUS = ['confirmed-original', 'confirmed-training-material', 'needs-current-verification'];

export const STATUS_LABELS = Object.freeze({
  'confirmed-original': 'Originalfrage 2025 (bestätigt)',
  'confirmed-training-material': 'Lernunterlage',
  'needs-current-verification': 'Aktualität prüfen'
});

/** Begriffe in Musterlösungen, die auf regionale/alte/unbestätigte Angaben hinweisen. */
const VERIFY_PATTERNS = [
  [/Achtung/i, 'Musterlösung enthält einen Achtung-Hinweis'],
  [/Stand 2008/i, 'Quelle Stand 2008'],
  [/Nordrhein/i, 'Regionale Quelle (DRK-LV Nordrhein)'],
  [/aktuell bestätigen|regional aktuell|vor dem nächsten Lehrgang bestätigen/i, 'Aktualität laut Katalog vor dem Lehrgang bestätigen'],
  [/hinterlegte[nr]? Merkkarte/i, 'Fahrzeugkennzahlen aus hinterlegter Merkkarte (regional)'],
  [/offizielle DV 102 ist maßgeblich/i, 'Verweis auf maßgebliche DV 102']
];

const NEEDS_IMAGE_PATTERN = /(gezeigte|dargestellte|links oben|Option \d)/i;
const STRENGTH_PATTERN = /\b(\d{1,3})\/(\d{1,3})\/(\d{1,3})\/(\d{1,3})\b/g;

/** Fachliche Domänen für Interleaving und Auswertung. */
export function domainOf(topic) {
  const t = String(topic || '').toLowerCase();
  if (/dv 100|befehl|führungsmittel|meldewesen/.test(t)) return 'DV 100 / Befehl & Meldung';
  if (/hik/.test(t)) return 'HiK 3.0';
  if (/taktische zeichen|taktische zeit|kennzeichnung|dienststellung/.test(t)) return 'Taktische Zeichen & Kennzeichnung';
  if (/rechtsgrundlagen|katastrophenschutz rlp/.test(t)) return 'Recht & RLP-Konzepte';
  if (/führung/.test(t)) return 'Führung';
  if (/raep/.test(t)) return 'RAEP';
  if (/kfz|fahrzeug|bahn/.test(t)) return 'KFZ-Marsch & Fahrzeuge';
  if (/manv|sichtung|versorgungsweg|medizin/.test(t)) return 'MANV & Medizin';
  if (/dokumentation|einsatznachbesprechung/.test(t)) return 'Dokumentation';
  if (/einheiten|stärke/.test(t)) return 'Einheiten & Stärken';
  if (/funk|abkürzung/.test(t)) return 'Funk & Abkürzungen';
  if (/gefahr|sicherheit|besondere|bereitstellung|grundbegriffe|räume|stellen/.test(t)) return 'Gefahren & Einsatzorganisation';
  return 'Sonstiges';
}

function slug(s) {
  return String(s).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
export { slug };

/** Einfacher, deterministischer Hash (FNV-1a 32 Bit) für Versions-/Prüfsummen. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Zerlegt das Markdown in Rohdatensätze.
 * Erkennt Themen-Überschriften (beliebige Ebene) und „Frage N“-Überschriften.
 */
export function parseMarkdownRaw(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  let start = lines.findIndex(l => /^#{1,6}\s*Fragenkatalog\s*$/i.test(l.trim()));
  start = start === -1 ? 0 : start + 1;
  const raws = [];
  let topic = null, cur = null, lastKey = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s*Kritische Prüfhinweise/i.test(line.trim())) break;
    const h = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (h) {
      const text = h[2].trim();
      const fm = /^Frage\s+(\d+)\s*$/i.exec(text);
      if (cur) raws.push(cur);
      cur = null; lastKey = null;
      if (fm) cur = { number: Number(fm[1]), topic, fields: {}, line: i + 1 };
      else topic = text;
      continue;
    }
    const f = /^\s*[-*]\s+\*\*([^*]+?):\*\*\s*(.*)$/.exec(line);
    if (f && cur) {
      lastKey = f[1].trim().toLowerCase();
      cur.fields[lastKey] = f[2].trim();
    } else if (cur && lastKey && line.trim() && !/^[-*]\s/.test(line.trim()) && !/^---/.test(line.trim())) {
      cur.fields[lastKey] += ' ' + line.trim();
    }
  }
  if (cur) raws.push(cur);
  return raws;
}

/** Normalisiert einen Rohdatensatz in das Question-Modell und sammelt Datenprobleme. */
export function normalizeRaw(raw, problems, overrides = {}) {
  const id = 'q' + raw.number;
  const where = `Frage ${raw.number} (Zeile ${raw.line})`;
  const f = raw.fields;
  const statusText = f['status'] || '';
  const typeRaw = (f['typ'] || '').trim();
  const weight = Number(f['gewichtung']);
  let questionText = (f['frage'] || '').trim();
  const modelAnswer = (f['musterlösung'] || f['musterloesung'] || '').trim();

  if (!questionText) problems.push({ level: 'error', id, message: `${where}: Fragetext fehlt.` });
  if (!modelAnswer) problems.push({ level: 'error', id, message: `${where}: Musterlösung fehlt.` });
  if (!raw.topic) problems.push({ level: 'error', id, message: `${where}: Keinem Thema zugeordnet.` });

  let topic = raw.topic || 'Ohne Thema';
  const tags = [];
  const isOriginalTopic = /^Original 2025\s*·\s*/.test(topic);
  if (isOriginalTopic) topic = topic.replace(/^Original 2025\s*·\s*/, '').trim();

  let originalNumber;
  const om = /^Originalfrage\s+(\d+):\s*/.exec(questionText);
  if (om) { originalNumber = Number(om[1]); questionText = questionText.slice(om[0].length); }

  let sourceStatus;
  const reasons = [];
  if (/Bestätigte Originalfrage 2025/i.test(statusText)) {
    sourceStatus = 'confirmed-original';
    tags.push('original-2025');
  } else if (/Lernfrage/i.test(statusText)) {
    sourceStatus = 'confirmed-training-material';
  } else {
    sourceStatus = 'needs-current-verification';
    problems.push({ level: 'warn', id, message: `${where}: Unbekannter Status „${statusText}“ → als „Aktualität prüfen“ markiert.` });
  }
  if (isOriginalTopic !== (sourceStatus === 'confirmed-original')) {
    problems.push({ level: 'warn', id, message: `${where}: Thema „Original 2025“ und Status passen nicht zusammen.` });
  }
  if (sourceStatus !== 'confirmed-original') {
    for (const [re, why] of VERIFY_PATTERNS) if (re.test(modelAnswer)) reasons.push(why);
    if (reasons.length) sourceStatus = 'needs-current-verification';
  }

  let type;
  if (QUESTION_TYPES.includes(typeRaw)) type = typeRaw;
  else if (typeRaw === 'forms2025') {
    type = 'open';
    problems.push({ level: 'info', id, message: `${where}: Typ „forms2025“ ist kein Modelltyp → abgeleitet.` });
  } else {
    type = 'open';
    problems.push({ level: 'warn', id, message: `${where}: Unbekannter Typ „${typeRaw}“ → „open“.` });
  }

  let correctAnswers;
  if (/(Ordne|Reihenfolge|von oben nach unten)/i.test(questionText) && modelAnswer.includes('→')) {
    type = 'ordering';
    correctAnswers = modelAnswer.split('→').map(s => s.trim().replace(/\.$/, '')).filter(Boolean);
  }

  let difficulty = Number.isFinite(weight) ? weight : 2;
  if (!Number.isFinite(weight)) problems.push({ level: 'warn', id, message: `${where}: Gewichtung fehlt → 2.` });
  if (difficulty > 3 || difficulty < 1) {
    problems.push({ level: 'info', id, message: `${where}: Gewichtung ${weight} außerhalb 1–3 → difficulty ${Math.min(3, Math.max(1, difficulty))}, Originalgewicht bleibt in „weight“.` });
    difficulty = Math.min(3, Math.max(1, difficulty));
  }

  if (NEEDS_IMAGE_PATTERN.test(questionText + ' ' + modelAnswer)) {
    tags.push('bild-fehlt');
    problems.push({ level: 'warn', id, message: `${where}: Frage bezieht sich auf ein Bild bzw. eine Forms-Option, die im Katalog fehlt.` });
  }

  for (const m of modelAnswer.matchAll(STRENGTH_PATTERN)) {
    const [, a, b, c, d] = m.map(Number);
    if (a + b + c !== d) problems.push({ level: 'error', id, message: `${where}: Stärke ${m[0]} ist rechnerisch inkonsistent (${a}+${b}+${c}≠${d}).` });
  }

  const source = sourceStatus === 'confirmed-original'
    ? `Forms-Gesamtwiederholung 2025, Originalfrage ${originalNumber ?? raw.number - 1000}`
    : 'Vorhandener Lernkatalog / hinterlegte Lernunterlagen';

  /** @type {any} */
  const q = {
    id,
    number: raw.number,
    topic,
    domain: domainOf(topic),
    learningObjective: 'lo-' + id,
    type,
    question: questionText,
    modelAnswer,
    source,
    sourceStatus,
    tags,
    difficulty,
    weight: Number.isFinite(weight) ? weight : difficulty
  };
  if (correctAnswers) q.correctAnswers = correctAnswers;
  if (originalNumber !== undefined) q.originalNumber = originalNumber;
  if (reasons.length) q.verificationNote = reasons.join('; ');

  const ov = overrides[id];
  if (ov) {
    for (const k of ['learningObjective', 'type', 'sourceStatus', 'explanation', 'imagePath', 'grading']) if (ov[k] !== undefined) q[k] = ov[k];
    if (ov.verificationNote) q.verificationNote = [q.verificationNote, ov.verificationNote].filter(Boolean).join('; ');
    if (ov.addTags) q.tags = [...new Set([...q.tags, ...ov.addTags])];
  }
  return q;
}

/** Kompletter Markdown-Import inkl. Konsistenzprüfungen. */
export function parseCatalogMarkdown(md, { overrides = {}, idAliases = {} } = {}) {
  const problems = [];
  const raws = parseMarkdownRaw(md);
  if (!raws.length) problems.push({ level: 'error', id: null, message: 'Keine Fragen gefunden („### Frage N“ + „- **Feld:** Wert“ erwartet).' });
  const seen = new Set();
  const questions = [];
  for (const r of raws) {
    const q = normalizeRaw(r, problems, overrides);
    if (seen.has(q.id)) { problems.push({ level: 'error', id: q.id, message: `Doppelte Frage-ID ${q.id} – zweites Vorkommen ignoriert.` }); continue; }
    seen.add(q.id);
    questions.push(q);
  }
  crossChecks(questions, problems);
  const body = JSON.stringify(questions);
  return {
    format: CATALOG_FORMAT,
    schemaVersion: 1,
    catalogVersion: 'md-' + fnv1a(body),
    source: 'Markdown-Import',
    idAliases,
    questions,
    problems
  };
}

/** Prüfungen über mehrere Fragen hinweg. */
export function crossChecks(questions, problems) {
  const originals = questions.filter(q => q.sourceStatus === 'confirmed-original' && q.originalNumber);
  if (originals.length) {
    const nums = new Set(originals.map(q => q.originalNumber));
    const max = Math.max(...nums);
    const missing = [];
    for (let i = 1; i <= max; i++) if (!nums.has(i)) missing.push(i);
    if (missing.length) problems.push({ level: 'info', id: null, message: `Originalfragen 2025: ${originals.length} von mind. ${max} vorhanden; fehlend: ${missing.join(', ')}.` });
  }
  const byAnswer = new Map();
  for (const q of questions) {
    const m = q.modelAnswer.match(/^\d+\/\d+\/\d+\/\d+$/);
    if (m) {
      const list = byAnswer.get(m[0]) || [];
      list.push(q.id); byAnswer.set(m[0], list);
    }
  }
  for (const [ans, ids] of byAnswer) if (ids.length > 1) {
    problems.push({ level: 'warn', id: null, message: `Identische Stärke ${ans} bei ${ids.join(', ')} → Umkehrfrage „Stärke → Einheit“ hat mehrere richtige Antworten.` });
  }
  if (!questions.some(q => q.options && q.options.length)) {
    problems.push({ level: 'info', id: null, message: 'Kein Katalogeintrag enthält originale Antwortoptionen. Auswahlfragen werden nur aus Katalogdaten abgeleitet (Umkehraufgaben, Stärken, Fahrzeuge, Zeichen).' });
  }
}

/** Validiert einen JSON-Katalog (z. B. data/catalog.json oder Benutzerimport). */
export function validateCatalogJson(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Keine JSON-Objektstruktur.'] };
  if (obj.format !== CATALOG_FORMAT) errors.push(`Feld „format“ muss „${CATALOG_FORMAT}“ sein.`);
  if (!Array.isArray(obj.questions) || !obj.questions.length) errors.push('Feld „questions“ fehlt oder ist leer.');
  const ids = new Set();
  (obj.questions || []).forEach((q, i) => {
    const at = `questions[${i}]`;
    if (!q || typeof q !== 'object') { errors.push(`${at}: kein Objekt.`); return; }
    if (typeof q.id !== 'string' || !q.id) errors.push(`${at}: id fehlt.`);
    else if (ids.has(q.id)) errors.push(`${at}: doppelte id ${q.id}.`);
    else ids.add(q.id);
    for (const k of ['topic', 'learningObjective', 'question', 'modelAnswer']) if (typeof q[k] !== 'string' || !q[k]) errors.push(`${at}: ${k} fehlt.`);
    if (!QUESTION_TYPES.includes(q.type)) errors.push(`${at}: ungültiger type „${q.type}“.`);
    if (!SOURCE_STATUS.includes(q.sourceStatus)) errors.push(`${at}: ungültiger sourceStatus „${q.sourceStatus}“.`);
    if (![1, 2, 3].includes(q.difficulty)) errors.push(`${at}: difficulty muss 1, 2 oder 3 sein.`);
    if (!Array.isArray(q.tags)) errors.push(`${at}: tags muss ein Array sein.`);
    if (q.options !== undefined && !Array.isArray(q.options)) errors.push(`${at}: options muss ein Array sein.`);
    if (q.correctAnswers !== undefined && !Array.isArray(q.correctAnswers)) errors.push(`${at}: correctAnswers muss ein Array sein.`);
  });
  return { ok: errors.length === 0, errors: errors.slice(0, 50) };
}

/** Erkennt das Format einer Importdatei und liefert einen validierten Katalog. */
export function importCatalogText(text, fileName = '', opts = {}) {
  const trimmed = String(text).trim();
  if (fileName.toLowerCase().endsWith('.json') || trimmed.startsWith('{')) {
    let obj;
    try { obj = JSON.parse(trimmed); } catch (e) { return { ok: false, errors: ['JSON nicht lesbar: ' + e.message] }; }
    const v = validateCatalogJson(obj);
    if (!v.ok) return v;
    obj.questions.forEach(q => { q.domain = q.domain || domainOf(q.topic); });
    return { ok: true, catalog: obj, problems: obj.problems || [] };
  }
  let catalog = parseCatalogMarkdown(trimmed, opts);
  if (opts.forms) catalog = applyForms(catalog, opts.forms, opts.overrides || {});
  const fatal = catalog.problems.filter(p => p.level === 'error' && !p.id);
  if (fatal.length) return { ok: false, errors: fatal.map(p => p.message) };
  const v = validateCatalogJson(catalog);
  if (!v.ok) return v;
  return { ok: true, catalog, problems: catalog.problems };
}


/**
 * Ersetzt die Originalfragen des Markdown-Katalogs durch die vollständige Forms-Auswertung
 * (alle 50 Fragen mit originalen Antwortoptionen) und meldet Widersprüche.
 */
export function applyForms(catalog, forms, overrides = {}) {
  if (!forms || !Array.isArray(forms.questions)) return catalog;
  const problems = catalog.problems.filter(p => !(p.id && /^q10\d\d$/.test(p.id)) && !/^(Originalfragen 2025:|Kein Katalogeintrag enthält originale)/.test(p.message));
  const mdById = new Map(catalog.questions.map(q => [q.id, q]));
  const out = catalog.questions.filter(q => q.sourceStatus !== 'confirmed-original');
  for (const f of forms.questions) {
    const id = 'q' + (1000 + f.number);
    const confirmed = f.status === 'forms' || f.status === 'katalog';
    const tags = ['original-2025'];
    if (f.status === 'offen') tags.push('loesung-offen');
    const q = {
      id, number: 1000 + f.number, originalNumber: f.number,
      topic: f.topic, domain: domainOf(f.topic), learningObjective: 'lo-' + id,
      type: f.status === 'offen' ? 'open' : f.type,
      question: f.question, modelAnswer: f.model,
      source: `Forms-Gesamtwiederholung 2025, Frage ${f.number}` + (f.status === 'katalog' ? ' (Lösung laut Fragenkatalog)' : ''),
      sourceStatus: confirmed ? 'confirmed-original' : 'needs-current-verification',
      tags, difficulty: 3, weight: 4
    };
    if (f.options && f.status !== 'offen') q.options = f.options;
    if (f.options && f.status === 'offen') q.offeneOptionen = f.options;
    if (f.correct && f.correct.length) q.correctAnswers = f.correct;
    if (f.grading) q.grading = f.grading;
    if (f.imagePath) q.imagePath = f.imagePath;
    if (f.note) { if (confirmed) q.explanation = f.note; else q.verificationNote = f.note; }
    const ov = overrides[id];
    if (ov) {
      for (const k of ['learningObjective', 'explanation']) if (ov[k] !== undefined) q[k] = ov[k];
      if (ov.addTags) q.tags = [...new Set([...q.tags, ...ov.addTags])];
    }
    const md = mdById.get(id);
    if (md && f.status === 'offen') problems.push({ level: 'error', id, message: `Frage ${f.number}: Musterlösung im Markdown („${md.modelAnswer}“) wird durch die Forms-Auswertung nicht gestützt. ${f.note}` });
    else if (f.status === 'offen') problems.push({ level: 'warn', id, message: `Frage ${f.number}: Lösung offen. ${f.note}` });
    else if (f.status === 'abgeleitet') problems.push({ level: 'warn', id, message: `Frage ${f.number}: ${f.note}.` });
    else if (!md) problems.push({ level: 'info', id, message: `Frage ${f.number}: aus der Forms-Auswertung ergänzt (fehlte im Markdown-Katalog).` });
    out.push(q);
  }
  const cat = { ...catalog, questions: out, problems };
  cat.formsSource = forms._quelle;
  cat.catalogVersion = 'md-' + fnv1a(JSON.stringify(out));
  return cat;
}
