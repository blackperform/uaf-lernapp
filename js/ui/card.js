// Lernkarte mit Active Recall: Lösung erst nach eigener Antwort bzw. Auswahl.
import { h, nextId } from './dom.js';
import { STATUS_LABELS } from '../catalog-parser.js';
import { shuffle } from '../derive.js';
import { gradeCard } from '../grading.js';
import { speechSupported, recognizeOnce } from '../speech.js';

export function badges(card, { showSource = true } = {}) {
  const wrap = h('div', { class: 'badges' });
  if (card.tags?.includes('original-2025') && !card.derivedFrom) wrap.append(h('span', { class: 'badge badge-original' }, `Originalfrage 2025${card.originalNumber ? ' · Nr. ' + card.originalNumber : ''}`));
  if (card.tags?.includes('umkehraufgabe')) wrap.append(h('span', { class: 'badge' }, 'Umkehraufgabe'));
  if (card.tags?.includes('mehrfachauswahl') || card.type === 'multiple-choice') wrap.append(h('span', { class: 'badge' }, 'Mehrfachauswahl'));
  if (card.sourceStatus === 'needs-current-verification') wrap.append(h('span', { class: 'badge badge-warn' }, '⚠ Aktualität prüfen'));
  if (showSource) wrap.append(h('span', { class: 'badge badge-muted' }, card.topic));
  return wrap;
}

export function sourceBlock(card) {
  return h('details', { class: 'source' },
    h('summary', {}, 'Quelle und Prüfstatus'),
    h('dl', {},
      h('dt', {}, 'Prüfstatus'), h('dd', {}, STATUS_LABELS[card.sourceStatus] || card.sourceStatus),
      h('dt', {}, 'Quelle'), h('dd', {}, card.source || '–'),
      card.verificationNote ? [h('dt', {}, 'Hinweis'), h('dd', {}, card.verificationNote)] : null,
      h('dt', {}, 'Lernziel'), h('dd', {}, card.learningObjective)));
}

export function verificationWarning(card) {
  if (card.tags?.includes('loesung-offen')) return h('p', { class: 'warn-box', role: 'note' }, h('strong', {}, 'Lösung offen: '), card.verificationNote || '', ' Diese Frage wird nicht abgefragt.');
  if (card.sourceStatus !== 'needs-current-verification') return null;
  return h('p', { class: 'warn-box', role: 'note' },
    h('strong', {}, 'Nicht verbindlich: '),
    (card.verificationNote || 'Angabe ist regional, älter oder unbestätigt') + '. Vor der Prüfung mit den aktuellen offiziellen Ausbildungsunterlagen abgleichen.');
}

/**
 * Rendert eine Lernkarte.
 * @param {object} opts { mode: 'learn'|'oral', showSource, onRated(rating), announce(msg) }
 */
export function renderLearnCard(card, opts) {
  const { mode = 'learn', showSource = true, onRated, announce = () => {} } = opts;
  const root = h('article', { class: 'card qcard', 'aria-labelledby': 'qtitle' });
  const titleId = 'qtitle';
  root.append(badges(card, { showSource }));
  root.append(h('h2', { id: titleId, class: 'qtext', tabindex: '-1' }, card.question));
  if (card.context) root.append(h('blockquote', { class: 'context' }, card.context));
  if (card.imagePath) root.append(h('figure', { class: 'sign-figure' },
    h('img', { src: card.imagePath, alt: card.tags?.includes('zeichen') || /Zeichen/.test(card.question) ? 'Taktisches Zeichen (Bild-Aufgabe, Bedeutung ist zu bestimmen)' : 'Schaubild zur Frage', width: '240', height: '180' }),
    card.sourceStatus === 'needs-current-verification' && card.tags?.includes('zeichen') ? h('figcaption', {}, 'Nachgezeichnet – mit DV 102 abgleichen') : null));
  if (card.tags?.includes('bild-fehlt')) root.append(h('p', { class: 'warn-box', role: 'note' }, 'Das Originalbild bzw. die Antwortoptionen fehlen im Katalog. Beantworte die Frage aus dem Gedächtnis.'));

  const form = h('form', { class: 'answer-form', novalidate: true });
  root.append(form);
  const feedback = h('div', { class: 'feedback', hidden: true });
  root.append(feedback);

  let getResponse; let isAnswered;
  const submitBtn = h('button', { class: 'btn btn-primary', type: 'submit', disabled: true }, card.type === 'ordering' ? 'Reihenfolge prüfen' : 'Antwort prüfen');
  const dontKnow = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Weiß ich nicht');
  const update = () => { submitBtn.disabled = !isAnswered(); };

  if (card.type === 'ordering' && Array.isArray(card.correctAnswers)) {
    let order = shuffle(card.correctAnswers);
    if (order.every((v, i) => v === card.correctAnswers[i])) order = order.slice().reverse();
    const list = h('ol', { class: 'order-list', 'aria-label': 'Reihenfolge – mit den Pfeiltasten-Buttons verschieben' });
    const renderList = (focusIdx, dir) => {
      list.replaceChildren(...order.map((item, i) => h('li', { class: 'order-item' },
        h('span', { class: 'order-text' }, item),
        h('span', { class: 'order-btns' },
          h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': `„${item}“ nach oben`, disabled: i === 0, dataset: { idx: i, dir: 'up' }, on: { click: () => move(i, -1) } }, '▲'),
          h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': `„${item}“ nach unten`, disabled: i === order.length - 1, dataset: { idx: i, dir: 'down' }, on: { click: () => move(i, 1) } }, '▼')))));
      if (focusIdx !== undefined) {
        const btn = list.querySelector(`button[data-idx="${focusIdx}"][data-dir="${dir}"]`) || list.querySelector(`button[data-idx="${focusIdx}"]:not([disabled])`);
        btn?.focus();
      }
    };
    const move = (i, d) => {
      const j = i + d; if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      renderList(j, d < 0 ? 'up' : 'down');
      announce(`„${order[j]}“ jetzt an Position ${j + 1}.`);
    };
    renderList();
    form.append(list);
    getResponse = () => order.slice();
    isAnswered = () => true;
  } else if (card.type === 'open' || card.type === 'case' || !card.options) {
    if (mode === 'oral') {
      const parts = ['Definition', 'Zweck', 'Beispiel'].map(label => {
        const id = nextId('oral');
        const ta = h('textarea', { id, rows: '2', class: 'input', autocomplete: 'off', 'aria-describedby': id + '-hint' });
        ta.addEventListener('input', update);
        const mic = speechSupported() ? h('button', {
          class: 'btn btn-small', type: 'button', 'aria-label': `${label} per Sprache diktieren`,
          on: { click: async () => {
            mic.disabled = true; announce('Spracheingabe läuft …');
            try { const t = await recognizeOnce(); ta.value = (ta.value + ' ' + t).trim(); update(); announce('Text übernommen.'); }
            catch (e) { announce(e.message); }
            finally { mic.disabled = false; }
          } }
        }, '🎤 Diktieren') : null;
        return { label, ta, el: h('div', { class: 'field' }, h('label', { for: id }, label), ta, h('span', { id: id + '-hint', class: 'hint' }, hintFor(label)), mic) };
      });
      form.append(h('p', { class: 'hint' }, 'Antwortstruktur für die mündliche Prüfung: Definition – Zweck – Beispiel.' + (speechSupported() ? '' : ' Spracheingabe wird von diesem Browser nicht unterstützt; bitte tippen.')));
      parts.forEach(p => form.append(p.el));
      getResponse = () => parts.map(p => p.ta.value.trim() ? `${p.label}: ${p.ta.value.trim()}` : '').filter(Boolean).join('\n');
      isAnswered = () => parts.some(p => p.ta.value.trim().length > 0);
    } else {
      const id = nextId('ans');
      const ta = h('textarea', { id, rows: '4', class: 'input', autocomplete: 'off' });
      ta.addEventListener('input', update);
      form.append(h('div', { class: 'field' }, h('label', { for: id }, 'Deine Antwort (aus dem Gedächtnis)'), ta));
      getResponse = () => ta.value.trim();
      isAnswered = () => ta.value.trim().length > 0;
    }
  } else {
    const multi = card.type === 'multiple-choice';
    const idxs = shuffle(card.options.map((_, i) => i));
    const fs = h('fieldset', { class: 'options' }, h('legend', { class: 'sr-only' }, multi ? 'Mehrere Antworten möglich' : 'Eine Antwort wählen'));
    const name = nextId('opt');
    for (const i of idxs) {
      const id = nextId('o');
      const input = h('input', { type: multi ? 'checkbox' : 'radio', name, id, value: card.options[i] });
      input.addEventListener('change', update);
      const content = card.optionImages ? [h('img', { src: card.optionImages[i], alt: `Zeichen-Option ${idxs.indexOf(i) + 1}`, width: '120', height: '90' }), h('span', { class: 'sr-only' }, `Option ${idxs.indexOf(i) + 1}`)] : card.options[i];
      fs.append(h('label', { class: 'option' + (card.optionImages ? ' option-image' : ''), for: id }, input, h('span', { class: 'option-text' }, content)));
    }
    form.append(fs);
    getResponse = () => {
      const chosen = [...fs.querySelectorAll('input:checked')].map(x => x.value);
      return multi ? chosen : chosen[0] ?? null;
    };
    isAnswered = () => fs.querySelectorAll('input:checked').length > 0;
  }

  const actions = h('div', { class: 'actions' }, submitBtn, dontKnow);
  form.append(actions);
  update();

  const reveal = (response, gaveUp) => {
    form.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = true; });
    actions.hidden = true;
    feedback.hidden = false;
    const g = gaveUp ? { ...gradeCard(card, null), rating: 0, correct: false } : gradeCard(card, response);
    const d = g.detail;

    if (d.kind === 'choice') {
      form.querySelectorAll('label.option').forEach(l => {
        const inp = l.querySelector('input');
        if (card.correctAnswers.includes(inp.value)) l.classList.add(inp.checked ? 'is-correct' : 'is-missed');
        else if (inp.checked) l.classList.add('is-wrong');
      });
    }
    const verdict = g.correct ? 'Richtig.' : g.rating >= 2 ? 'Überwiegend richtig.' : g.rating === 1 ? 'Teilweise richtig.' : 'Nicht richtig.';
    feedback.append(h('p', { class: 'result ' + (g.correct ? 'ok' : g.rating >= 1 ? 'partial' : 'bad') }, verdict,
      h('span', { class: 'score' }, ` Systembewertung ${g.rating}/3`)));

    if (d.kind === 'choice' && card.type === 'multiple-choice') {
      feedback.append(h('p', { class: 'hint' }, `${d.hits} von ${d.total} richtigen Optionen gewählt` + (d.wrong ? `, ${d.wrong} falsche gewählt.` : '.')));
    }
    if (d.kind === 'ordering' && Array.isArray(response)) {
      feedback.append(h('div', { class: 'compare' }, h('h3', {}, `Deine Reihenfolge (${d.positions} von ${d.total} Positionen richtig)`), h('p', {}, response.join(' → '))));
    }
    if (d.kind === 'text') {
      if (!gaveUp) feedback.append(h('div', { class: 'compare' }, h('h3', {}, 'Deine Antwort'), h('p', { class: 'pre' }, String(response ?? ''))));
      const req = d.required ?? 1;
      feedback.append(h('div', { class: 'checklist' },
        h('h3', {}, `Erkannt: ${d.found.length} – benötigt: ${req}`),
        h('ul', { class: 'plain' },
          ...d.found.map(x => h('li', { class: 'hit' }, '✓ ', x)),
          ...d.missing.map(x => h('li', { class: 'miss' }, '✗ ', x)))));
    }
    feedback.append(h('div', { class: 'model' }, h('h3', {}, 'Musterlösung'), h('p', { class: 'pre' }, card.modelAnswer)));
    if (card.explanation) feedback.append(h('p', { class: 'hint' }, card.explanation));
    const w = verificationWarning(card); if (w) feedback.append(w);
    if (showSource) feedback.append(sourceBlock(card));
    if (!g.correct) feedback.append(h('p', { class: 'hint' }, g.rating === 0 ? 'Diese Frage kommt in dieser Einheit nach 2–3 anderen Fragen erneut – möglichst in anderer Form.' : 'Die Frage wird bald wiederholt.'));
    const next = h('button', { class: 'btn btn-primary btn-next', type: 'button', dataset: { rating: g.rating }, on: { click: () => finish(g.rating) } }, 'Weiter');
    feedback.append(h('div', { class: 'actions' }, next));
    announce(`${verdict} Systembewertung ${g.rating} von 3. Musterlösung: ${card.modelAnswer}`);
    next.focus();
  };
  let done = false;
  const finish = r => { if (done) return; done = true; onRated(r); };

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!isAnswered()) return;
    reveal(getResponse(), false);
  });
  dontKnow.addEventListener('click', () => reveal(getResponse(), true));
  return root;
}

function hintFor(label) {
  return { Definition: 'Was ist es? (Begriff klar bestimmen)', Zweck: 'Wozu dient es? Warum ist es wichtig?', Beispiel: 'Konkretes Einsatzbeispiel' }[label];
}
