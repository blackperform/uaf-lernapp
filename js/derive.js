// Erzeugt zusätzliche Lernkarten AUSSCHLIESSLICH aus vorhandenen Katalogdaten:
//  - Umkehraufgaben (Antwort → passende Fragestellung)
//  - SEG-/Einheiten-Stärken (Einheit ↔ Stärke), Fahrzeuge (Einheit ↔ Fahrzeuge, Abkürzung ↔ Bezeichnung/Kennzahl)
//  - Taktische Zeichen (Bild ↔ Bedeutung) mit schematischen Platzhaltern
// Es werden keine neuen fachlichen Lösungen erfunden; Distraktoren stammen aus anderen Katalogeinträgen.
import { slug, domainOf } from './catalog-parser.js';
import { specFor, gradeText, isGradable } from './grading.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9äöüß/]+/g, '');

/** Wählt n Distraktoren nach Nähe (gleiches Thema > gleiche Domäne > Rest). */
function pickDistractors(candidates, target, n, keyFn, rng) {
  const tierOf = c => (c.topic === target.topic ? 0 : c.domain === target.domain ? 1 : 2);
  const groups = [[], [], []];
  for (const c of candidates) groups[tierOf(c)].push(c);
  const out = [];
  for (const g of groups) {
    for (const c of shuffle(g, rng)) {
      if (out.length >= n) break;
      if (out.some(o => norm(keyFn(o)) === norm(keyFn(c)))) continue;
      out.push(c);
    }
  }
  return out;
}

const CARD_BASE = q => ({
  topic: q.topic, domain: q.domain, learningObjective: q.learningObjective,
  source: q.source, sourceStatus: q.sourceStatus, difficulty: q.difficulty, weight: q.weight,
  verificationNote: q.verificationNote, derivedFrom: q.id
});

/** Umkehraufgabe: Musterlösung gegeben → passende Fragestellung auswählen. */
export function reverseCards(questions) {
  const pool = questions.filter(q => isGradable(q) && q.type !== 'ordering');
  const cards = [];
  for (const q of pool) {
    const rng = mulberry32(seedFrom(q.id + '-r'));
    const candidates = pool.filter(c => c.id !== q.id && c.learningObjective !== q.learningObjective && norm(c.modelAnswer) !== norm(q.modelAnswer));
    const distractors = pickDistractors(candidates, q, 3, c => c.question, rng);
    if (distractors.length < 2) continue;
    cards.push({
      ...CARD_BASE(q),
      id: q.id + '-r',
      type: 'single-choice',
      question: 'Umkehraufgabe: Zu welcher Fragestellung gehört diese Antwort?',
      context: q.modelAnswer,
      options: [q.question, ...distractors.map(d => d.question)],
      correctAnswers: [q.question],
      modelAnswer: q.question,
      explanation: `Musterlösung zu Frage ${q.number}${q.originalNumber ? ` (Originalfrage ${q.originalNumber})` : ''}.`,
      tags: ['umkehraufgabe', ...q.tags.filter(t => t !== 'original-2025')]
    });
  }
  return cards;
}

/** Liest Einheit + Stärke aus Katalogfragen („Welche Stärke hat … nach …?“). */
export function extractStrengthUnits(questions) {
  const re = /Welche\s+(?:Gesamt)?[Ss]tärke\s+hat\s+(?:ein|eine|der|die|das)\s+(.+?)\s+nach\s+(.+?)\?/;
  const units = [];
  for (const q of questions) {
    const m = re.exec(q.question);
    const s = /\b(\d+\/\d+\/\d+\/\d+)\b/.exec(q.modelAnswer);
    if (!m || !s) continue;
    const basis = /HiK/i.test(m[2]) ? 'HiK-Konzept 3.0' : 'Taschenkarte DRK-LV Nordrhein, Stand 2008';
    units.push({ unit: m[1].trim(), strength: s[1], basis, ref: q });
  }
  return units;
}

export function strengthCards(questions) {
  const units = extractStrengthUnits(questions);
  const cards = [];
  for (const u of units) {
    const q = u.ref;
    const rng = mulberry32(seedFrom(q.id + '-seg'));
    const sameBasis = units.filter(o => o.basis === u.basis);
    const otherStrengths = [...new Set(units.map(o => o.strength).filter(s => s !== u.strength))];
    const strengthOpts = shuffle(otherStrengths, rng).slice(0, 3);
    const base = { ...CARD_BASE(q), topic: 'SEG-Stärken und Fahrzeuge', domain: domainOf('Einheiten und Stärke'), tags: ['seg', ...q.tags.filter(t => t !== 'original-2025')] };
    cards.push({
      ...base,
      id: `seg-${slug(u.unit)}-e2s`,
      type: 'single-choice',
      question: `Einheit → Stärke: Welche Stärke hat ${u.unit} (${u.basis})?`,
      options: [u.strength, ...strengthOpts],
      correctAnswers: [u.strength],
      modelAnswer: u.strength,
      explanation: `Quelle: Frage ${q.number}. Schreibweise Führer/Unterführer/Helfer/Gesamt.`
    });
    const correctUnits = sameBasis.filter(o => o.strength === u.strength).map(o => o.unit);
    // Pro Stärke nur eine Umkehrkarte (bei mehreren Einheiten gleicher Stärke → Mehrfachauswahl).
    if (correctUnits[0] !== u.unit) continue;
    const distractUnits = shuffle(units.filter(o => o.strength !== u.strength).map(o => o.unit), rng).slice(0, Math.max(2, 4 - correctUnits.length));
    cards.push({
      ...base,
      id: `seg-${slug(u.strength)}-${slug(u.basis)}-s2e`,
      learningObjective: q.learningObjective,
      type: correctUnits.length > 1 ? 'multiple-choice' : 'single-choice',
      question: `Stärke → Einheit: Welche Einheit${correctUnits.length > 1 ? 'en haben' : ' hat'} nach ${u.basis} die Stärke ${u.strength}?` + (correctUnits.length > 1 ? ' (Mehrfachauswahl)' : ''),
      options: [...correctUnits, ...distractUnits],
      correctAnswers: correctUnits,
      modelAnswer: correctUnits.join(' und '),
      explanation: correctUnits.length > 1 ? 'Achtung: Mehrere Einheiten haben laut Katalog dieselbe Stärke.' : `Quelle: Frage ${q.number}.`
    });
  }
  return cards;
}

export function vehicleCards(questions, vehicleData) {
  const byId = new Map(questions.map(q => [q.id, q]));
  const cards = [];
  const list = vehicleData?.vehicles || [];
  for (const v of list) {
    const q = byId.get(v.ref);
    if (!q) continue;
    const rng = mulberry32(seedFrom('veh-' + v.abbr));
    const others = list.filter(o => o.abbr !== v.abbr);
    const lo = 'lo-veh-' + slug(v.abbr);
    const base = {
      ...CARD_BASE(q), learningObjective: lo, topic: 'SEG-Stärken und Fahrzeuge', domain: domainOf('Fahrzeuge'),
      sourceStatus: 'needs-current-verification',
      verificationNote: 'Fahrzeugkennzahlen/Bezeichnungen aus hinterlegter Merkkarte – regional prüfen',
      tags: ['fahrzeug']
    };
    cards.push({
      ...base, id: `veh-${slug(v.abbr)}-a2n`, type: 'single-choice',
      question: `Wofür steht die Abkürzung ${v.abbr}?`,
      options: [v.name, ...shuffle(others, rng).slice(0, 3).map(o => o.name)],
      correctAnswers: [v.name], modelAnswer: v.name, explanation: `Quelle: Frage ${q.number}.`
    });
    cards.push({
      ...base, id: `veh-${slug(v.abbr)}-n2a`, type: 'single-choice',
      question: `Welche Abkürzung gehört zu „${v.name}“?`,
      options: [v.abbr, ...shuffle(others, rng).slice(0, 3).map(o => o.abbr)],
      correctAnswers: [v.abbr], modelAnswer: v.abbr, explanation: `Quelle: Frage ${q.number}.`
    });
    cards.push({
      ...base, id: `veh-${slug(v.abbr)}-a2c`, learningObjective: lo + '-kennzahl', type: 'single-choice',
      question: `Welche Kennzahl hat ${v.abbr} laut hinterlegter Merkkarte?`,
      options: [v.code, ...shuffle(others.filter(o => o.code !== v.code), rng).slice(0, 3).map(o => o.code)],
      correctAnswers: [v.code], modelAnswer: v.code, explanation: `Quelle: Frage ${q.number}. Regional abweichend möglich.`
    });
    cards.push({
      ...base, id: `veh-${slug(v.abbr)}-c2a`, learningObjective: lo + '-kennzahl', type: 'single-choice',
      question: `Welches Fahrzeug hat laut hinterlegter Merkkarte die Kennzahl ${v.code}?`,
      options: [v.abbr, ...shuffle(others.filter(o => o.code !== v.code), rng).slice(0, 3).map(o => o.abbr)],
      correctAnswers: [v.abbr], modelAnswer: v.abbr, explanation: `Quelle: Frage ${q.number}. Regional abweichend möglich.`
    });
  }
  for (const uv of vehicleData?.unitVehicles || []) {
    const q = byId.get(uv.ref);
    if (!q) continue;
    const units = extractStrengthUnits(questions).filter(u => u.basis === uv.basis && u.unit !== uv.unit).map(u => u.unit);
    const base = { ...CARD_BASE(q), topic: 'SEG-Stärken und Fahrzeuge', domain: domainOf('HiK 3.0'), tags: ['seg', 'fahrzeug'] };
    cards.push({
      ...base, id: `seg-${slug(uv.unit)}-e2f`, type: 'open',
      question: `Einheit → Fahrzeuge: Welche Fahrzeuge gehören nach ${uv.basis} zur ${uv.unit}?`,
      modelAnswer: uv.vehicles, explanation: `Quelle: Frage ${q.number}.`
    });
    if (units.length >= 2) {
      cards.push({
        ...base, id: `seg-${slug(uv.unit)}-f2e`, type: 'single-choice',
        question: `Fahrzeuge → Einheit: Zu welcher Einheit gehören nach ${uv.basis} „${uv.vehicles}“?`,
        options: [uv.unit, ...units.slice(0, 3)], correctAnswers: [uv.unit], modelAnswer: uv.unit,
        explanation: `Quelle: Frage ${q.number}. Im Katalog liegt nur diese eine Fahrzeugzuordnung vor.`
      });
    }
  }
  return cards;
}

export function signCards(signData, questions = []) {
  const signs = signData?.signs || [];
  const byId = new Map(questions.map(q => [q.id, q]));
  const cards = [];
  for (const s of signs) {
    const rng = mulberry32(seedFrom('sign-' + s.id));
    const others = shuffle(signs.filter(o => o.id !== s.id), rng).slice(0, 3);
    const ref = byId.get(s.ref);
    const base = {
      topic: 'Taktische Zeichen', domain: domainOf('Taktische Zeichen'), learningObjective: 'lo-sign-' + s.id,
      source: s.source + (ref ? ` · Bezug: Frage ${ref.originalNumber ? 'Original ' + ref.originalNumber : ref.number}` : ''),
      sourceStatus: s.verified ? 'confirmed-training-material' : 'needs-current-verification',
      verificationNote: s.verified ? undefined : 'Grafik nachgezeichnet – mit DV 102 / Lehrgangsunterlage abgleichen',
      explanation: s.hint,
      difficulty: 2, weight: 2, tags: ['zeichen'], imagePath: s.imagePath, derivedFrom: s.ref
    };
    cards.push({
      ...base, id: `sign-${s.id}-bild`, type: 'image', question: 'Bild erkennen: Welches Grundzeichen ist dargestellt?',
      options: [s.name, ...others.map(o => o.name)], correctAnswers: [s.name], modelAnswer: s.name, tags: [...base.tags, 'zeichen-bild']
    });
    cards.push({
      ...base, id: `sign-${s.id}-nennen`, type: 'open', question: 'Bedeutung nennen: Wofür steht dieses Grundzeichen?',
      modelAnswer: s.name, tags: [...base.tags, 'zeichen-nennen']
    });
    cards.push({
      ...base, id: `sign-${s.id}-umkehr`, type: 'image', imagePath: undefined,
      question: `Umgekehrt zuordnen: Welches Zeichen steht für „${s.name}“?`,
      options: [s.name, ...others.map(o => o.name)],
      optionImages: [s.imagePath, ...others.map(o => o.imagePath)],
      correctAnswers: [s.name], modelAnswer: s.name, tags: [...base.tags, 'zeichen-umkehr']
    });
  }
  return cards;
}

/**
 * Mehrfachauswahl aus Aufzählungsfragen: richtige Optionen = Punkte der Lösung,
 * falsche Optionen = Punkte anderer Fragen, die laut Bewertungslogik NICHT zur Lösung passen.
 */
export function listChoiceCards(questions) {
  const pool = questions.filter(q => isGradable(q) && (q.type === 'open' || q.type === 'case'));
  const specs = new Map(pool.map(q => [q.id, specFor(q)]));
  const okLabel = g => g.label.length <= 70 && g.label.length >= 3 && !/^(nachdem|dass|wenn|weil|damit)\b/i.test(g.label);
  const usable = q => { const sp = specs.get(q.id); return sp.mode === 'groups' && !sp.sentence && sp.groups.length >= 3 && sp.groups.every(okLabel); };
  const cards = [];
  for (const q of pool.filter(usable)) {
    if (q.id === 'q11') continue;
    const sp = specs.get(q.id);
    const rng = mulberry32(seedFrom(q.id + '-mc'));
    const correct = shuffle(sp.groups.map(g => g.label), rng).slice(0, Math.min(4, sp.groups.length));
    const candidates = [];
    for (const o of pool) {
      if (o.learningObjective === q.learningObjective || o.id === q.id) continue;
      const osp = specs.get(o.id);
      if (osp.mode !== 'groups') continue;
      for (const g of osp.groups) {
        if (osp.sentence || !okLabel(g)) continue;
        if (gradeText(g.label, sp).found.length) continue;                  // passt doch zur Lösung → ungeeignet
        if (sp.groups.some(t => gradeText(t.label, { mode: 'groups', required: 1, groups: [g] }).found.length)) continue;
        candidates.push({ label: g.label, tier: o.topic === q.topic ? 0 : o.domain === q.domain ? 1 : 2 });
      }
    }
    const seen = new Set(sp.groups.map(g => norm(g.label)));
    const distract = [];
    for (const tier of [0, 1, 2]) for (const c of shuffle(candidates.filter(c => c.tier === tier), rng)) {
      if (distract.length >= 3) break;
      if (seen.has(norm(c.label))) continue;
      seen.add(norm(c.label)); distract.push(c.label);
    }
    if (distract.length < 2) continue;
    cards.push({
      ...CARD_BASE(q),
      id: q.id + '-mc',
      type: 'multiple-choice',
      question: `${q.question} – Wähle alle zutreffenden Antworten.`,
      options: [...correct, ...distract],
      correctAnswers: correct,
      modelAnswer: q.modelAnswer,
      explanation: `Mehrfachauswahl abgeleitet aus Frage ${q.originalNumber ? 'Original ' + q.originalNumber : q.number}. Falsche Optionen stammen aus anderen Katalogfragen.`,
      tags: ['mehrfachauswahl', ...q.tags.filter(t => t !== 'original-2025')]
    });
  }
  return cards;
}

/** Baut die vollständige Kartenliste: Katalogfragen + abgeleitete Karten. */
export function buildCards(catalog, { vehicles, signs } = {}) {
  const base = catalog.questions.map(q => ({ ...q, domain: q.domain || domainOf(q.topic) }));
  return [
    ...base,
    ...reverseCards(base),
    ...(Array.isArray(catalog.derivedChoices) ? catalog.derivedChoices : listChoiceCards(base)),
    ...strengthCards(base),
    ...vehicleCards(base, vehicles),
    ...signCards(signs, base)
  ];
}
