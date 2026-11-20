// Lernsitzungen (alle Lernmodi) und Prüfungssimulation.
import { h, nextId } from './dom.js';
import { app, recordRating, addExamToHistory, saveSettings } from '../app-state.js';
import { buildQueue, weakCards, interleave, createSession, currentItem, isFinished, answer, sessionSummary } from '../session.js';
import { renderLearnCard, badges, verificationWarning } from './card.js';
import { buildExam, setResponse, submitExam, remainingSeconds, getResult, ratingsFromExam, examPool } from '../exam.js';
import { isGradable } from '../grading.js';
import { EXAM_SIZES, PERSONAL_GOAL_PERCENT } from '../config.js';
import { RATING_LABELS } from '../srs.js';
const gradable = c => isGradable(c);
import { shuffle } from '../derive.js';

const isBase = c => !c.derivedFrom;

export const MODES = {
  faellig:          { title: 'Heute fällig – adaptive Einheit', nav: 'lernen', filter: () => true },
  schwach:          { title: 'Schwachstellen', nav: 'lernen', filter: () => true, weak: true },
  original:         { title: 'Originalfragen 2025', nav: 'lernen', filter: c => c.tags.includes('original-2025') && isBase(c) },
  seg:              { title: 'SEG-Stärken und Fahrzeuge', nav: 'lernen', filter: c => c.tags.includes('seg') || c.tags.includes('fahrzeug') },
  muendlich:        { title: 'Mündliche Prüfung', nav: 'lernen', filter: c => (c.type === 'open' || c.type === 'case') && isBase(c), oral: true },
  'zeichen-bild':   { title: 'Taktische Zeichen – Bild erkennen', nav: 'zeichen', filter: c => c.tags.includes('zeichen-bild') },
  'zeichen-nennen': { title: 'Taktische Zeichen – Bedeutung nennen', nav: 'zeichen', filter: c => c.tags.includes('zeichen-nennen') },
  'zeichen-umkehr': { title: 'Taktische Zeichen – umgekehrt zuordnen', nav: 'zeichen', filter: c => c.tags.includes('zeichen-umkehr') },
  thema:            { title: 'Thema', nav: 'lernen', filter: (c, p) => c.topic === p }
};

export function buildModeQueue(modeKey, param) {
  const mode = MODES[modeKey];
  if (!mode) return [];
  const limit = app.settings.sessionSize || 10;
  const pool = app.cards.filter(c => gradable(c) && mode.filter(c, param));
  if (mode.weak) {
    const seen = new Set();
    const list = weakCards(pool, app.progress).filter(c => !seen.has(c.learningObjective) && seen.add(c.learningObjective));
    return interleave(list.slice(0, limit));
  }
  return buildQueue(pool, app.progress, { limit });
}

export function renderSession(main, { mode: modeKey, param }) {
  const mode = MODES[modeKey];
  if (!mode) { main.append(h('h1', { tabindex: '-1' }, 'Unbekannter Lernmodus'), h('a', { href: '#/lernen', class: 'btn' }, 'Zurück')); return; }
  const title = modeKey === 'thema' ? `Thema: ${param}` : mode.title;
  const cards = buildModeQueue(modeKey, param);
  const head = h('div', { class: 'session-head' },
    h('h1', { tabindex: '-1' }, title),
    h('a', { href: mode.nav === 'zeichen' ? '#/zeichen' : '#/lernen', class: 'btn btn-ghost btn-small' }, 'Einheit beenden'));
  main.append(head);
  if (!cards.length) {
    main.append(h('p', { class: 'card' }, modeKey === 'schwach'
      ? 'Aktuell keine Schwachstellen erkannt. Bearbeite zuerst einige Fragen – Fragen mit Lernstufe 0 oder 1 erscheinen dann hier.'
      : 'Für diesen Modus sind keine Fragen vorhanden.'));
    return;
  }
  const session = createSession(cards, { mode: modeKey });
  const progressEl = h('p', { class: 'session-progress', 'aria-live': 'off' });
  const bar = h('progress', { max: '1', value: '0', 'aria-label': 'Fortschritt der Einheit' });
  const slot = h('div', { class: 'slot' });
  main.append(progressEl, bar, slot);

  const showNext = () => {
    if (isFinished(session)) return showSummary();
    const item = currentItem(session);
    const card = app.cardsById.get(item.id);
    progressEl.textContent = `Frage ${session.index + 1} von ${session.queue.length}` + (item.repeat ? ' · Wiederholung in anderer Form' : '');
    bar.max = String(session.queue.length); bar.value = String(session.index);
    const el = renderLearnCard(card, {
      mode: mode.oral ? 'oral' : 'learn',
      showSource: app.settings.showSource,
      announce: app.announce,
      onRated: async rating => {
        await recordRating(card, rating, modeKey);
        const re = answer(session, card, rating, app.cardsByObjective);
        if (re) app.announce('Diese Frage kommt in dieser Einheit nach zwei bis drei anderen Fragen erneut – möglichst in anderer Form.');
        showNext();
      }
    });
    if (item.repeat) el.prepend(h('p', { class: 'repeat-note' }, '↻ Wiederholung einer zuvor falsch beantworteten Frage'));
    slot.replaceChildren(el);
    el.querySelector('.qtext')?.focus();
  };
  const showSummary = () => {
    const s = sessionSummary(session);
    bar.value = bar.max;
    progressEl.textContent = 'Einheit abgeschlossen';
    slot.replaceChildren(h('section', { class: 'card summary', 'aria-labelledby': 'sumh' },
      h('h2', { id: 'sumh', tabindex: '-1' }, 'Einheit abgeschlossen'),
      h('p', {}, `${s.answered} Antworten, davon ${s.repeated} Wiederholungen.`),
      h('p', { class: 'hint' }, 'Alle Antworten wurden vom System bewertet:'),
      h('ul', { class: 'plain' }, ...[3, 2, 1, 0].map(r => h('li', {}, `${r} – ${RATING_LABELS[r]}: ${s.counts[r]}`))),
      h('div', { class: 'actions' },
        h('a', { href: `#/sitzung/${modeKey}${param ? '/' + encodeURIComponent(param) : ''}`, class: 'btn btn-primary', on: { click: e => { e.preventDefault(); app.rerender(); } } }, 'Neue Einheit'),
        h('a', { href: '#/start', class: 'btn' }, 'Zur Startseite'))));
    slot.querySelector('h2').focus();
    app.announce('Einheit abgeschlossen.');
  };
  showNext();
}

// ---------------------------------------------------------------------------
// Prüfungssimulation
// ---------------------------------------------------------------------------

let activeExam = null;

export function renderExam(main) {
  let timer = null;
  const cleanup = () => { if (timer) clearInterval(timer); timer = null; };
  main.append(h('h1', { tabindex: '-1' }, 'Prüfungssimulation'));
  const slot = h('div', { class: 'slot' });
  main.append(slot);

  const showConfig = () => {
    cleanup();
    const s = app.settings;
    const sizeId = nextId('size'), secId = nextId('sec'), incId = nextId('inc');
    const poolSize = examPool(app.cards, { includeUnverified: s.examIncludeUnverified }).length;
    const form = h('form', { class: 'card form-grid', novalidate: true },
      h('p', {}, 'Zufällige Reihenfolge, Zeitvorgabe, keine Rückmeldung während der Prüfung. Das System bewertet alle Antworten; die Auswertung erscheint erst nach der Abgabe.'),
      h('div', { class: 'field' }, h('label', { for: sizeId }, 'Anzahl Fragen'),
        h('select', { id: sizeId, class: 'input' }, ...EXAM_SIZES.map(n => h('option', { value: n, selected: n === s.examSize }, String(n))))),
      h('div', { class: 'field' }, h('label', { for: secId }, 'Sekunden pro Frage'),
        h('input', { id: secId, class: 'input', type: 'number', min: '20', max: '600', step: '10', value: s.examSecondsPerQuestion, inputmode: 'numeric' })),
      h('div', { class: 'field field-check' },
        h('input', { id: incId, type: 'checkbox', checked: s.examIncludeUnverified }),
        h('label', { for: incId }, 'Auch Fragen mit ungeprüftem Stand aufnehmen (werden markiert)')),
      h('p', { class: 'hint' }, `Fragenpool: ${poolSize} Karten (je Lernziel höchstens eine Karte pro Prüfung). ${PERSONAL_GOAL_PERCENT} % ist ein persönliches Lernziel, keine offizielle Bestehensgrenze.`),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Prüfung starten')));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const size = Number(form.querySelector('#' + sizeId).value);
      const sec = Math.min(600, Math.max(20, Number(form.querySelector('#' + secId).value) || 90));
      const inc = form.querySelector('#' + incId).checked;
      await saveSettings({ examSize: size, examSecondsPerQuestion: sec, examIncludeUnverified: inc });
      activeExam = buildExam(app.cards, { size, secondsPerQuestion: sec, includeUnverified: inc });
      showQuestion(0);
    });
    slot.replaceChildren(form);
  };

  const timerEl = h('p', { class: 'timer', role: 'timer', 'aria-live': 'off' });
  const startTimer = () => {
    if (timer) return;
    let warned = new Set();
    const tick = () => {
      const left = remainingSeconds(activeExam);
      const m = Math.floor(left / 60), sec = String(left % 60).padStart(2, '0');
      timerEl.textContent = `Restzeit ${m}:${sec}`;
      for (const mark of [300, 60]) if (left <= mark && !warned.has(mark) && activeExam.durationSec > mark) { warned.add(mark); app.announce(`Noch ${mark / 60} Minute${mark === 60 ? '' : 'n'}.`); }
      if (left <= 0) { cleanup(); app.announce('Zeit abgelaufen. Die Prüfung wurde automatisch abgegeben.'); doSubmit(); }
    };
    tick();
    timer = setInterval(tick, 1000);
  };

  const showQuestion = i => {
    const ex = activeExam;
    const item = ex.items[i];
    const card = app.cardsById.get(item.id);
    startTimer();
    const answered = ex.items.filter(x => x.response !== null && x.response !== '' && !(Array.isArray(x.response) && !x.response.length)).length;
    const wrap = h('section', { class: 'card qcard exam-card', 'aria-labelledby': 'exq' },
      h('div', { class: 'exam-meta' }, h('span', {}, `Frage ${i + 1} von ${ex.items.length}`), h('span', {}, `${answered} beantwortet`), timerEl),
      badges(card, { showSource: false }),
      h('h2', { id: 'exq', tabindex: '-1', class: 'qtext' }, card.question),
      card.context ? h('blockquote', { class: 'context' }, card.context) : null,
      card.imagePath ? h('figure', { class: 'sign-figure' }, h('img', { src: card.imagePath, alt: 'Taktisches Zeichen (Bild-Aufgabe)', width: '240', height: '180' })) : null,
      verificationWarning(card),
      examInput(card, item, v => setResponse(ex, i, v)),
      h('div', { class: 'actions exam-nav' },
        h('button', { class: 'btn', type: 'button', disabled: i === 0, on: { click: () => showQuestion(i - 1) } }, 'Zurück'),
        i < ex.items.length - 1
          ? h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => showQuestion(i + 1) } }, 'Weiter')
          : null,
        h('button', { class: 'btn btn-danger', type: 'button', on: { click: () => confirmSubmit(answered) } }, 'Prüfung abgeben')));
    slot.replaceChildren(wrap);
    wrap.querySelector('#exq').focus();
  };

  const confirmSubmit = () => {
    const open = activeExam.items.filter(x => x.response === null || x.response === '' || (Array.isArray(x.response) && !x.response.length)).length;
    if (open && !window.confirm(`${open} Frage(n) sind unbeantwortet. Trotzdem abgeben?`)) return;
    doSubmit();
  };

  const doSubmit = () => {
    cleanup();
    submitExam(activeExam, app.cardsById);
    showResult();
  };

  const showResult = async () => {
    const ex = activeExam;
    const res = getResult(ex);
    for (const r of ratingsFromExam(ex)) await recordRating(app.cardsById.get(r.id), r.rating, 'exam');
    await addExamToHistory({ id: ex.id, at: ex.startedAt, size: ex.items.length, points: res.points, percent: res.percent, byTopic: res.byTopic });
    slot.replaceChildren(h('section', { class: 'exam-result' },
      h('h2', { tabindex: '-1', id: 'resh' }, 'Auswertung'),
      h('p', { class: 'big' }, `${res.points.toLocaleString('de-DE')} von ${res.max} Punkten · ${res.percent.toLocaleString('de-DE')} %`),
      h('p', { class: res.personalGoalReached ? 'ok' : 'bad' },
        res.personalGoalReached ? `Persönliches Lernziel (${PERSONAL_GOAL_PERCENT} %) erreicht.` : `Persönliches Lernziel (${PERSONAL_GOAL_PERCENT} %) noch nicht erreicht.`),
      h('p', { class: 'hint' }, `Hinweis: ${PERSONAL_GOAL_PERCENT} % ist ein persönliches Lernziel und keine offizielle Bestehensgrenze.`),
      h('h3', {}, 'Themenanalyse'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Thema'), h('th', { scope: 'col' }, 'Punkte'), h('th', { scope: 'col' }, '%'))),
        h('tbody', {}, ...res.byTopic.map(t => h('tr', {}, h('th', { scope: 'row' }, t.topic), h('td', {}, `${(Math.round(t.points * 100) / 100).toLocaleString('de-DE')}/${t.max}`), h('td', {}, `${t.percent} %`)))))),
      h('h3', {}, 'Einzelergebnisse'),
      h('ol', { class: 'review-list' }, ...ex.items.map(it => {
        const c = app.cardsById.get(it.id);
        const ok = it.points >= 1 ? 'ok' : it.points > 0 ? 'partial' : 'bad';
        return h('li', { class: 'review ' + ok },
          h('p', {}, h('strong', {}, c.question), c.context ? ` (${c.context})` : ''),
          h('p', {}, 'Deine Antwort: ', formatResponse(it.response)),
          h('p', {}, 'Musterlösung: ', c.modelAnswer),
          it.detail?.kind === 'text' && it.detail.missing.length ? h('p', { class: 'hint' }, `Erkannt ${it.detail.found.length}, benötigt ${it.detail.required}. Fehlend: ${it.detail.missing.join(', ')}`) : null,
          h('p', { class: 'hint' }, `Punkte: ${it.points} · Systembewertung ${it.rating}/3`));
      })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => { activeExam = null; showConfig(); } } }, 'Neue Prüfung'),
        h('a', { class: 'btn', href: '#/start' }, 'Zur Startseite'))));
    slot.querySelector('#resh').focus();
    app.announce(`Auswertung: ${res.percent} Prozent.`);
  };

  if (activeExam && activeExam.state === 'running') showQuestion(0);
  else { activeExam = null; showConfig(); }
  return cleanup;
}

function formatResponse(r) {
  if (r === null || r === undefined || r === '' || (Array.isArray(r) && !r.length)) return '(keine Antwort)';
  return Array.isArray(r) ? r.join(' · ') : String(r);
}

/** Eingabe ohne jede Rückmeldung (Prüfungsmodus). */
function examInput(card, item, onChange) {
  const form = h('form', { class: 'answer-form', novalidate: true, on: { submit: e => e.preventDefault() } });
  if (card.type === 'ordering') {
    let order = Array.isArray(item.response) ? item.response.slice() : shuffle(card.correctAnswers);
    if (!Array.isArray(item.response) && order.every((v, i) => v === card.correctAnswers[i])) order.reverse();
    const list = h('ol', { class: 'order-list', 'aria-label': 'Reihenfolge' });
    const render = (fi, dir) => {
      list.replaceChildren(...order.map((it, i) => h('li', { class: 'order-item' }, h('span', { class: 'order-text' }, it),
        h('span', { class: 'order-btns' },
          h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': `„${it}“ nach oben`, disabled: i === 0, dataset: { idx: i, dir: 'up' }, on: { click: () => mv(i, -1) } }, '▲'),
          h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': `„${it}“ nach unten`, disabled: i === order.length - 1, dataset: { idx: i, dir: 'down' }, on: { click: () => mv(i, 1) } }, '▼')))));
      if (fi !== undefined) (list.querySelector(`button[data-idx="${fi}"][data-dir="${dir}"]:not([disabled])`) || list.querySelector(`button[data-idx="${fi}"]:not([disabled])`))?.focus();
    };
    const mv = (i, d) => { const j = i + d; [order[i], order[j]] = [order[j], order[i]]; onChange(order.slice()); render(j, d < 0 ? 'up' : 'down'); };
    render();
    form.append(list, h('p', { class: 'hint' }, 'Die angezeigte Reihenfolge wird bei Abgabe gewertet.'));
    if (!Array.isArray(item.response)) onChange(order.slice());
  } else if (card.options) {
    const multi = card.type === 'multiple-choice';
    const fs = h('fieldset', { class: 'options' }, h('legend', { class: 'sr-only' }, multi ? 'Mehrere Antworten möglich' : 'Eine Antwort wählen'));
    const name = nextId('ex');
    const order = item.optionOrder || card.options.map((_, i) => i);
    for (const i of order) {
      const id = nextId('eo');
      const val = card.options[i];
      const checked = multi ? Array.isArray(item.response) && item.response.includes(val) : item.response === val;
      const input = h('input', { type: multi ? 'checkbox' : 'radio', name, id, value: val, checked });
      input.addEventListener('change', () => {
        const chosen = [...fs.querySelectorAll('input:checked')].map(x => x.value);
        onChange(multi ? chosen : chosen[0] ?? null);
      });
      const content = card.optionImages ? h('img', { src: card.optionImages[i], alt: `Zeichen-Option ${order.indexOf(i) + 1}`, width: '120', height: '90' }) : val;
      fs.append(h('label', { class: 'option' + (card.optionImages ? ' option-image' : ''), for: id }, input, h('span', { class: 'option-text' }, content)));
    }
    form.append(fs);
  } else {
    const id = nextId('exa');
    const ta = h('textarea', { id, class: 'input', rows: '4', value: item.response || '' });
    ta.addEventListener('input', () => onChange(ta.value));
    form.append(h('div', { class: 'field' }, h('label', { for: id }, 'Deine Antwort'), ta));
  }
  return form;
}
