// Automatische Bewertung durch das System – keine Selbstbewertung.
//  - Auswahl (single/multiple/image): exakter Mengenvergleich
//  - Reihenfolge: exakter Positionsvergleich
//  - Freitext: Begriffsgruppen mit Synonymen und Tippfehlertoleranz
//    · Originalfragen: Gruppen aus den „Richtigen Antworten“ der Forms-Auswertung, Mindestanzahl laut Frage
//    · Lernfragen: Gruppen automatisch aus den Punkten der Musterlösung abgeleitet
//  - Exakt: z. B. taktische Zeit (160758sep24), Stärken (1/1/2/4)

/** Kleinschreibung, Umlaute → ae/oe/ue/ss, Satzzeichen → Leerzeichen. */
export function normalize(s) {
  return String(s ?? '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9/]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Nur Buchstaben/Ziffern – macht „Rahmen-, Alarm- und Einsatzplan“ ≙ „Rahmen Alarm und Einsatz Plan“. */
export function compact(s) { return normalize(s).replace(/[^a-z0-9]/g, ''); }

/** Approximative Teilstring-Suche (Sellers): minimale Editierdistanz von needle zu einem Teilstring von hay. */
export function approxDistance(hay, needle) {
  const m = needle.length, n = hay.length;
  if (!m) return 0;
  let prev = new Array(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  let best = prev[m];
  for (let j = 1; j <= n; j++) {
    const cur = new Array(m + 1);
    cur[0] = 0;
    for (let i = 1; i <= m; i++) {
      const cost = needle[i - 1] === hay[j - 1] ? 0 : 1;
      cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + cost);
    }
    best = Math.min(best, cur[m]);
    prev = cur;
  }
  return best;
}

export function allowedTypos(len) { return len >= 12 ? 2 : len >= 6 ? 1 : 0; }

/** true, wenn das Muster (kompakt) im Antworttext vorkommt – mit Tippfehlertoleranz ab 6 Zeichen. */
export function patternFound(answerCompact, pattern, answerWords) {
  const p = compact(pattern);
  if (!p) return false;
  // Kurze Muster (≤ 3 Zeichen, z. B. „wo“, „öl“, „5“) nur als ganzes Wort
  if (p.length <= 3 && answerWords) return answerWords.includes(p);
  if (answerCompact.includes(p)) return true;
  const tol = allowedTypos(p.length);
  return tol > 0 && approxDistance(answerCompact, p) <= tol;
}

/** Ziffernmuster wie 1/1/2/4 oder 5 werden exakt (mit Wortgrenzen) gesucht. */
function numericFound(answerNorm, pattern) {
  const p = normalize(pattern).replace(/\s+/g, '');
  const a = ' ' + answerNorm.replace(/\s*\/\s*/g, '/') + ' ';
  return new RegExp(`(^|[^0-9/])${p.replace(/\//g, '\\/')}([^0-9/]|$)`).test(a);
}

/**
 * Bewertet Freitext gegen eine Gruppen-Spezifikation.
 * spec = { mode:'groups', required:n, groups:[{label, accept:[…], all?:[…] }] }  |  { mode:'exact', accept:[…] }
 * Gruppe gilt als genannt, wenn eines der accept-Muster vorkommt; bei `minWords` müssen so viele
 * Schlüsselwörter aus `words` vorkommen (abgeleitete Lernfragen).
 */
export function gradeText(answer, spec) {
  const norm = normalize(answer);
  const comp = compact(answer);
  if (!spec) return { found: [], missing: [], required: 1, correct: false, fraction: 0, rating: 0 };
  if (spec.mode === 'exact') {
    const ok = spec.accept.some(a => /\d\/\d/.test(a) ? numericFound(norm, a) : compact(a) === comp || comp.includes(compact(a)) && compact(a).length >= 8);
    return { found: ok ? [spec.label || spec.accept[0]] : [], missing: ok ? [] : [spec.label || spec.accept[0]], required: 1, correct: ok, fraction: ok ? 1 : 0, rating: ok ? 3 : 0 };
  }
  const words = norm.replace(/\//g, ' ').split(' ').filter(Boolean);
  const found = [], missing = [];
  // Wortstämme aller Gruppen: ein Antwortwort zählt nicht für einen kürzeren Stamm,
  // wenn es bereits einen längeren Stamm einer anderen Gruppe enthält („Durchführung“ ≠ „Führung“).
  const stemsByGroup = spec.groups.map(g => (g.words || []).map(stemOf));
  for (let gi = 0; gi < spec.groups.length; gi++) {
    const g = spec.groups[gi];
    const otherStems = stemsByGroup.filter((_, j) => j !== gi).flat();
    const usable = st => words.filter(w => !otherStems.some(o => o.length > st.length && w.includes(o)));
    const hitWord = kw => { const st = stemOf(kw); return stemFound(usable(st), st); };
    let hit = false;
    if (g.alts) hit = g.alts.filter(alt => alt.some(hitWord)).length >= (g.minWords || 1);
    else if (g.words) hit = g.words.filter(hitWord).length >= (g.minWords || 1);
    if (!hit && g.accept) hit = g.accept.some(a => /^\d+(\/\d+)*$/.test(a.trim()) ? numericFound(norm, a) : patternFound(comp, a, words));
    (hit ? found : missing).push(g.label);
  }
  const required = Math.min(spec.required ?? spec.groups.length, spec.groups.length);
  const fraction = required ? Math.min(1, found.length / required) : 0;
  const correct = found.length >= required;
  return { found, missing, required, correct, fraction, rating: ratingFromFraction(fraction, correct) };
}

/** Wortstamm: Präfix mit ≈75 % der Wortlänge (mind. 4 Zeichen). */
function stemOf(kw) { const k = compact(kw); return k.slice(0, Math.max(4, Math.ceil(k.length * 0.75))); }
/** Stamm kommt in einem Antwortwort vor (auch in Zusammensetzungen); ab 6 Zeichen 1 Tippfehler erlaubt. */
function stemFound(words, stem) {
  if (words.some(w => w.includes(stem))) return true;
  if (stem.length >= 6) return words.some(w => w.length >= stem.length - 1 && approxDistance(w, stem) <= 1);
  return false;
}

export function ratingFromFraction(f, correct) {
  if (correct || f >= 0.9) return 3;
  if (f >= 0.6) return 2;
  if (f >= 0.3) return 1;
  return 0;
}

const STOP = new Set(('nahe haben viele eine einer eines einem einen oder bzw sowie nach dass werden wird sind ist mit ohne der die das den dem des und auch beim zum zur vom von fuer gegebenenfalls ggf moeglichst sich dort diese dieser dies wenn alle allem nicht kein keine noch nur bei als aus auf durch ueber unter vor jede jeder jedes zuerst erst wie was wer wann').split(' '));

/** Zerlegt eine Musterlösung in prüfbare Punkte (für Lernfragen ohne hinterlegte Gruppen). */
export function splitModelAnswer(modelAnswer) {
  let t = String(modelAnswer)
    .replace(/\([^)]*\)/g, ' ')
    .split(/(?<=\.)\s+(?=[A-ZÄÖÜ])/)
    .filter(s => !/^(Achtung|Regional|Bereiche sind|Der Vorgang|In der App|Konkrete Regeln|Karten-)/.test(s) && !/(bestätigen|maßgeblich)/.test(s))
    .join(' ')
    .replace(/[.]\s*$/, '');
  let parts;
  if (t.includes(';')) parts = t.split(';');
  else if (/\?\s/.test(t)) parts = t.split('?');
  else if (t.includes('→')) parts = t.split('→');
  else parts = t.split(/,|\bsowie\b|\bund\b(?=[^,]*$)/);
  parts = parts.map(s => s.replace(/^\s*(und|sowie)\s+/i, '').trim()).filter(s => s.length > 1);
  // Nebensätze („…, nachdem …“) nicht als eigenen Punkt werten
  const merged = [];
  for (const p of parts) {
    if (merged.length && /^(nachdem|dass|wenn|weil|damit|sodass|so dass|um|wobei|die|der|das)\b/i.test(p)) merged[merged.length - 1] += ', ' + p;
    else merged.push(p);
  }
  return merged;
}

function keywordsOf(text) {
  return [...new Set(normalize(text).replace(/\//g, ' ').split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)))];
}
/** Schrägstrich-Alternativen („Airway/Atemweg“) zählen als ein Schlüsselbegriff. */
function keywordAlternatives(text) {
  return normalize(text).split(' ').filter(Boolean).map(tok => tok.split('/').filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w))).filter(a => a.length);
}

/** Leitet eine Bewertungs-Spezifikation aus der Musterlösung ab. */
export function deriveSpec(modelAnswer) {
  const clean = String(modelAnswer).trim();
  const time = /^(\d{6}[a-z]{3}\d{2})\.?$/i.exec(clean);
  if (time) return { mode: 'exact', label: time[1], accept: [time[1]] };
  const strength = /^(\d+\/\d+\/\d+\/\d+)\b/.exec(clean);
  if (strength) return { mode: 'exact', label: strength[1], accept: [strength[1]] };
  const items = splitModelAnswer(clean);
  const groups = [];
  for (const it of items) {
    const alts = keywordAlternatives(it);
    if (!alts.length) continue;
    const words = alts.flat();
    const need = alts.length <= 2 ? 1 : Math.ceil(alts.length / 2);
    groups.push({ label: it, words, alts, minWords: need });
  }
  // Einzelner langer Satz → Schlüsselwörter einzeln prüfen, Hälfte muss genannt sein
  if (groups.length === 1 && groups[0].alts.length >= 4) {
    const alts = groups[0].alts;
    return { mode: 'groups', derived: true, sentence: true, required: Math.ceil(alts.length / 2), groups: alts.map(a => ({ label: a.join('/'), words: a, alts: [a], minWords: 1 })) };
  }
  return { mode: 'groups', derived: true, required: Math.max(1, Math.ceil(groups.length * 0.75)), groups };
}

export function specFor(card) {
  if (card.grading) return card.grading;
  return deriveSpec(card.modelAnswer);
}

/**
 * Einheitliche Bewertung jeder Karte.
 * @returns {{rating:0|1|2|3, correct:boolean, points:number, detail:object}}
 */
export function gradeCard(card, response) {
  const empty = response === null || response === undefined || response === '' || (Array.isArray(response) && !response.length);
  if (card.type === 'ordering') {
    const c = card.correctAnswers;
    const ok = Array.isArray(response) && response.length === c.length && response.every((v, i) => v === c[i]);
    const pos = Array.isArray(response) ? response.filter((v, i) => v === c[i]).length : 0;
    return { rating: ok ? 3 : pos / c.length >= 0.5 ? 1 : 0, correct: ok, points: ok ? 1 : 0, detail: { kind: 'ordering', positions: pos, total: c.length } };
  }
  if (card.options && card.correctAnswers) {
    const chosen = empty ? [] : Array.isArray(response) ? response : [response];
    const a = new Set(chosen), b = new Set(card.correctAnswers);
    const ok = a.size === b.size && [...a].every(x => b.has(x));
    const hits = [...a].filter(x => b.has(x)).length;
    const wrong = a.size - hits;
    const partial = !ok && hits > 0 && wrong === 0 && hits / b.size >= 0.5;
    return { rating: ok ? 3 : partial ? 1 : 0, correct: ok, points: ok ? 1 : 0, detail: { kind: 'choice', hits, wrong, total: b.size } };
  }
  if (empty) {
    const spec = specFor(card);
    return { rating: 0, correct: false, points: 0, detail: { kind: 'text', found: [], missing: spec.mode === 'exact' ? [spec.label] : spec.groups.map(g => g.label), required: spec.required ?? 1 } };
  }
  const r = gradeText(response, specFor(card));
  return { rating: r.rating, correct: r.correct, points: r.correct ? 1 : 0, detail: { kind: 'text', ...r } };
}

/** Karten, die das System bewerten kann (ausgeschlossen: Lösung offen / Bild fehlt). */
export function isGradable(card) {
  return !card.tags?.includes('loesung-offen') && !card.tags?.includes('bild-fehlt');
}
