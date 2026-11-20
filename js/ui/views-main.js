// Hauptansichten: Start, Lernen, Zeichen, Katalog, Fortschritt/Mehr.
import { h, nextId, formatDate } from './dom.js';
import {
  app, saveSettings, exportBackup, downloadJson, backupFileName, importBackupText,
  restoreInternalBackup, resetAllProgress, useCatalog, resetToDefaultCatalog, setBanner
} from '../app-state.js';
import { dueCount } from '../session.js';
import { topicStats, weakestTopics, overallMastery, streak, dayKey, objectiveStatus } from '../stats.js';
import { STATUS_LABELS, importCatalogText } from '../catalog-parser.js';
import { buildModeQueue } from './views-session.js';
import { badges, verificationWarning } from './card.js';
import { createSyncAdapter } from '../sync.js';
import { EXAM_SIZES, DATA_SCHEMA_VERSION } from '../config.js';

// ---------------------------------------------------------------- Start
export function renderHome(main) {
  const due = dueCount(app.cards, app.progress);
  const newCount = app.cards.filter(c => !app.progress.get(c.id)?.attempts).length;
  const today = app.daily[dayKey()] || 0;
  const goal = app.settings.dailyGoal;
  const mastery = overallMastery(app.cards, app.progress);
  const weak = weakestTopics(topicStats(app.cards, app.progress));
  const str = streak(app.daily);
  main.append(
    h('h1', { tabindex: '-1' }, 'Start'),
    h('section', { class: 'stat-grid', 'aria-label': 'Tagesübersicht' },
      stat('Heute fällig', String(due), due ? `${due} Wiederholung${due === 1 ? '' : 'en'} warten` : `keine fälligen Wiederholungen · ${newCount} neue Karten`),
      stat('Tagesziel', `${Math.min(today, goal)} / ${goal}`, today >= goal ? 'Tagesziel erreicht ✓' : `noch ${goal - today} Antworten`, h('progress', { max: goal, value: Math.min(today, goal), 'aria-label': 'Tagesziel-Fortschritt' })),
      stat('Lernserie', `${str} Tag${str === 1 ? '' : 'e'}`, str ? 'Lerne heute, um die Serie zu halten' : 'Starte heute eine Serie'),
      stat('Gesamtbeherrschung', `${mastery.percent} %`, `${mastery.secureObjectives} von ${mastery.objectives} Lernzielen sicher`)),
    h('a', { class: 'btn btn-primary btn-block btn-hero', href: '#/sitzung/faellig' }, '10-Fragen-Einheit starten'),
    h('section', { class: 'card', 'aria-labelledby': 'weakh' },
      h('h2', { id: 'weakh' }, 'Drei schwächste Themen'),
      weak.length
        ? h('ol', { class: 'weak-list' }, ...weak.map(t => h('li', {},
          h('a', { href: `#/sitzung/thema/${encodeURIComponent(t.topic)}` }, t.topic),
          h('span', { class: 'hint' }, ` · Fehlerquote ${Math.round(t.errorRate * 100)} % · Ø Lernstufe ${t.meanLevel.toFixed(1).replace('.', ',')}`))))
        : h('p', { class: 'hint' }, 'Noch keine Daten – nach den ersten Antworten erscheinen hier deine schwächsten Themen.')),
    h('p', { class: 'hint' }, `Hinweis: Lernstufe „sicher“ erfordert zwei korrekt beantwortete, unterschiedlich formulierte Fragen desselben Lernziels.`)
  );
}

function stat(label, value, sub, extra) {
  return h('div', { class: 'stat card' }, h('p', { class: 'stat-label' }, label), h('p', { class: 'stat-value' }, value), extra || null, h('p', { class: 'stat-sub' }, sub));
}

// ---------------------------------------------------------------- Lernen
export function renderLearn(main) {
  const count = m => buildModeQueue(m).length;
  const modes = [
    ['faellig', 'Heute fällig', '10 adaptive Fragen: überfällig → unsicher → lange nicht geprüft → neu.'],
    ['schwach', 'Schwachstellen', 'Fragen und Themen mit Lernstufe 0 oder 1.'],
    ['original', 'Originalfragen 2025', 'Nur bestätigte Fragen aus der Forms-Gesamtwiederholung.'],
    ['seg', 'SEG-Stärken und Fahrzeuge', 'Einheit ↔ Stärke, Einheit ↔ Fahrzeuge, Abkürzungen und Kennzahlen.'],
    ['muendlich', 'Mündliche Prüfung', 'Offene Fragen mit Struktur Definition – Zweck – Beispiel, optional per Sprache.']
  ];
  const topics = [...new Set(app.cards.filter(c => !c.derivedFrom).map(c => c.topic))].sort((a, b) => a.localeCompare(b, 'de'));
  const topicId = nextId('topic');
  main.append(
    h('h1', { tabindex: '-1' }, 'Lernen'),
    h('ul', { class: 'mode-list' }, ...modes.map(([k, t, d]) => {
      const n = count(k);
      return h('li', {}, h('a', { class: 'mode card', href: `#/sitzung/${k}` },
        h('span', { class: 'mode-title' }, t), h('span', { class: 'mode-desc' }, d),
        h('span', { class: 'mode-count' }, n ? `${n} Fragen in dieser Einheit` : 'aktuell keine Fragen')));
    }),
    h('li', {}, h('a', { class: 'mode card', href: '#/pruefung' },
      h('span', { class: 'mode-title' }, 'Prüfungssimulation'),
      h('span', { class: 'mode-desc' }, `Zeitvorgabe, zufällige Reihenfolge, Auswertung erst am Ende. ${EXAM_SIZES.join('/')} Fragen, Standard ${app.settings.examSize}.`)))),
    h('form', { class: 'card form-inline', on: { submit: e => { e.preventDefault(); const v = e.target.querySelector('select').value; if (v) location.hash = `#/sitzung/thema/${encodeURIComponent(v)}`; } } },
      h('label', { for: topicId }, 'Gezielt ein Thema lernen'),
      h('select', { id: topicId, class: 'input' }, ...topics.map(t => h('option', { value: t }, t))),
      h('button', { class: 'btn', type: 'submit' }, 'Starten'))
  );
}

// ---------------------------------------------------------------- Zeichen
export function renderSigns(main) {
  const signs = app.extras.signs?.signs || [];
  main.append(
    h('h1', { tabindex: '-1' }, 'Taktische Zeichen'),
    h('p', { class: 'warn-box', role: 'note' }, 'Grundzeichen nach DV 102 nachgezeichnet. Durch die Gesamtwiederholung belegt sind nur „Maßnahme“ (Dreieck) und das Zugführer-Zeichen. Die übrigen Formen bitte mit der Lehrgangsunterlage abgleichen – offizielle Grafiken unter gleichem Dateinamen in assets/signs/ ersetzen sie.'),
    h('details', { class: 'card' }, h('summary', {}, 'Achtung: Größenordnungszeichen (Punkte/Striche)'),
      h('p', {}, 'In der Gesamtwiederholung 2025 trägt der Zugführer drei Punkte und der Gruppenführer zwei Punkte (ältere DRK-DV 102). Die aktuelle BBK-Empfehlung zur DV 102 (2024) zählt dagegen: Trupp 1 Punkt, Staffel 2, Gruppe 3, Zug 1 Strich.'),
      h('p', { class: 'hint' }, 'Vor dem Lehrgang klären, welche Fassung geprüft wird. Die App fragt Größenordnungszeichen deshalb noch nicht ab.')),
    h('ul', { class: 'mode-list' },
      ...[['zeichen-bild', 'Bild erkennen', 'Zeichen sehen → Bedeutung auswählen'],
        ['zeichen-nennen', 'Bedeutung nennen', 'Zeichen sehen → Bedeutung frei eintippen'],
        ['zeichen-umkehr', 'Umgekehrt zuordnen', 'Bedeutung lesen → passendes Zeichen wählen']]
        .map(([k, t, d]) => h('li', {}, h('a', { class: 'mode card', href: `#/sitzung/${k}` }, h('span', { class: 'mode-title' }, t), h('span', { class: 'mode-desc' }, d))))),
    h('h2', {}, 'Übersicht'),
    h('ul', { class: 'sign-gallery' }, ...signs.map(s => h('li', { class: 'card' },
      h('img', { src: s.imagePath, alt: '', width: '120', height: '90' }), h('span', {}, s.name))))
  );
}

// ---------------------------------------------------------------- Katalog
export function renderCatalog(main) {
  const base = app.cards.filter(c => !c.derivedFrom);
  const topics = [...new Set(base.map(c => c.topic))].sort((a, b) => a.localeCompare(b, 'de'));
  const qId = nextId('q'), tId = nextId('t'), sId = nextId('s');
  const state = { q: '', topic: '', status: '' };
  const list = h('ul', { class: 'catalog-list' });
  const countEl = h('p', { class: 'hint', 'aria-live': 'polite' });
  const render = () => {
    const q = state.q.toLowerCase();
    const items = base.filter(c =>
      (!state.topic || c.topic === state.topic) &&
      (!state.status || (state.status === 'original' ? c.tags.includes('original-2025') : c.sourceStatus === state.status)) &&
      (!q || (c.question + ' ' + c.modelAnswer + ' ' + c.topic).toLowerCase().includes(q)));
    countEl.textContent = `${items.length} von ${base.length} Fragen`;
    list.replaceChildren(...items.map(c => {
      const p = app.progress.get(c.id);
      const st = objectiveStatus(app.cardsByObjective.get(c.learningObjective), app.progress);
      return h('li', { class: 'card catalog-item', dataset: { id: c.id } },
        badges(c, { showSource: true }),
        h('h2', { class: 'catalog-q' }, `${c.number ? c.number + ' · ' : ''}${c.question}`),
        h('details', {}, h('summary', {}, 'Musterlösung anzeigen'),
          h('p', { class: 'pre' }, c.modelAnswer),
          c.options ? h('ul', { class: 'opt-list' }, ...c.options.map(o => h('li', { class: c.correctAnswers?.includes(o) ? 'ok' : '' }, (c.correctAnswers?.includes(o) ? '✓ ' : '– ') + o))) : null,
          c.offeneOptionen ? h('ul', { class: 'opt-list' }, ...c.offeneOptionen.map(o => h('li', {}, '? ' + o))) : null,
          c.explanation ? h('p', { class: 'hint' }, c.explanation) : null,
          verificationWarning(c),
          h('dl', { class: 'meta-dl' },
            h('dt', {}, 'Prüfstatus'), h('dd', {}, STATUS_LABELS[c.sourceStatus]),
            h('dt', {}, 'Quelle'), h('dd', {}, c.source),
            h('dt', {}, 'Lernziel'), h('dd', {}, `${c.learningObjective} · ${st.status}${st.singleForm ? ' (nur eine Frageform)' : ''}`),
            h('dt', {}, 'Lernstand'), h('dd', {}, p && p.attempts ? `Stufe ${p.level}, ${p.attempts} Versuche, ${p.errors} Fehler, fällig ${formatDate(p.due)}` : 'neu'))));
    }));
  };
  const onInput = (k) => e => { state[k] = e.target.value; render(); };
  const fileId = nextId('cat');
  const msg = h('div', { role: 'status', 'aria-live': 'polite' });
  main.append(
    h('h1', { tabindex: '-1' }, 'Katalog'),
    h('form', { class: 'card filters', role: 'search', on: { submit: e => e.preventDefault() } },
      h('div', { class: 'field' }, h('label', { for: qId }, 'Suche'), h('input', { id: qId, class: 'input', type: 'search', on: { input: onInput('q') } })),
      h('div', { class: 'field' }, h('label', { for: tId }, 'Thema'),
        h('select', { id: tId, class: 'input', on: { change: onInput('topic') } }, h('option', { value: '' }, 'Alle Themen'), ...topics.map(t => h('option', { value: t }, t)))),
      h('div', { class: 'field' }, h('label', { for: sId }, 'Prüfstatus'),
        h('select', { id: sId, class: 'input', on: { change: onInput('status') } },
          h('option', { value: '' }, 'Alle'),
          h('option', { value: 'original' }, 'Nur Originalfragen 2025'),
          h('option', { value: 'confirmed-training-material' }, STATUS_LABELS['confirmed-training-material']),
          h('option', { value: 'needs-current-verification' }, STATUS_LABELS['needs-current-verification'])))),
    countEl, list,
    h('section', { class: 'card', 'aria-labelledby': 'cimp' },
      h('h2', { id: 'cimp' }, 'Fragenkatalog importieren'),
      h('p', { class: 'hint' }, `Aktiv: ${app.catalogIsCustom ? 'importierter Katalog' : 'Standardkatalog'} · Version ${app.catalog.catalogVersion} · ${base.length} Fragen. Der Lernstand bleibt beim Katalogwechsel erhalten.`),
      h('label', { for: fileId, class: 'btn' }, 'Markdown- oder JSON-Katalog wählen …'),
      h('input', { id: fileId, type: 'file', accept: '.md,.markdown,.json,text/markdown,application/json', class: 'visually-hidden-file', on: { change: async e => {
        const f = e.target.files[0]; if (!f) return;
        const res = importCatalogText(await f.text(), f.name, { overrides: app.extras.overrides, forms: app.extras.forms });
        e.target.value = '';
        if (!res.ok) { msg.replaceChildren(h('p', { class: 'error' }, 'Import abgelehnt: ' + res.errors.join(' '))); return; }
        const errs = res.problems.filter(p => p.level === 'error').length;
        if (!window.confirm(`${res.catalog.questions.length} Fragen gefunden, ${res.problems.length} Hinweise (${errs} Fehler). Katalog übernehmen? Der Lernstand bleibt erhalten.`)) return;
        const r = await useCatalog(res.catalog, { persist: true });
        app.catalogIsCustom = true;
        msg.replaceChildren(h('p', { class: 'ok' }, `Katalog übernommen: ${r.cards} Lernkarten. ${r.orphaned.length} Lernstände ohne passende Frage bleiben gespeichert.`));
        app.rerender();
      } } }),
      app.catalogIsCustom ? h('button', { class: 'btn btn-ghost', type: 'button', on: { click: async () => { await resetToDefaultCatalog(); app.rerender(); } } }, 'Standardkatalog wiederherstellen') : null,
      msg,
      h('details', {}, h('summary', {}, `Datenprüfung (${(app.catalog.problems || []).length} Hinweise)`),
        h('ul', { class: 'problems' }, ...(app.catalog.problems || []).map(p => h('li', { class: 'problem-' + p.level }, `[${p.level}] ${p.message}`)))))
  );
  render();
}

// ---------------------------------------------------------------- Fortschritt / Mehr
export function renderMore(main) {
  const stats = topicStats(app.cards, app.progress);
  const mastery = overallMastery(app.cards, app.progress);
  const statusMsg = h('div', { role: 'status', 'aria-live': 'polite', class: 'status-msg' });
  const importId = nextId('imp');
  const strategyName = nextId('strat');

  const doExport = async () => {
    const b = await exportBackup();
    downloadJson(b, backupFileName());
    statusMsg.replaceChildren(h('p', { class: 'ok' }, `Export erstellt: ${b.progress.length} Lernstände, App ${b.appVersion}, Format ${b.formatVersion}.`));
  };

  const doImport = async file => {
    const text = await file.text();
    const strategy = main.querySelector(`input[name="${strategyName}"]:checked`)?.value || 'replace';
    const choice = await askBackupBeforeImport();
    if (choice === 'cancel') { statusMsg.replaceChildren(h('p', {}, 'Import abgebrochen.')); return; }
    if (choice === 'download') await doExport();
    const res = await importBackupText(text, { strategy });
    if (!res.ok) { statusMsg.replaceChildren(h('p', { class: 'error', role: 'alert' }, 'Import abgelehnt – Datenbank unverändert. ' + res.errors.join(' '))); return; }
    setBanner('flash', { kind: 'ok', text: `Import erfolgreich (${strategy === 'merge' ? 'zusammengeführt' : 'ersetzt'}): ${res.count} Lernstände${res.migratedFrom ? `, migriert von Format ${res.migratedFrom}` : ''}. Interne Sicherung des vorherigen Stands wurde angelegt.`, dismissible: true });
    app.rerender();
  };

  const dailyId = nextId('goal'), themeId = nextId('theme'), srcId = nextId('src'), sessId = nextId('sess');
  const sync = createSyncAdapter();
  main.append(
    h('h1', { tabindex: '-1' }, 'Fortschritt & Mehr'),
    h('section', { class: 'card', 'aria-labelledby': 'ph' },
      h('h2', { id: 'ph' }, 'Fortschritt je Thema'),
      h('p', {}, `Gesamt: ${mastery.secureObjectives} von ${mastery.objectives} Lernzielen sicher (${mastery.percent} %) · Ø Lernstufe ${mastery.meanLevelPercent} % des Maximums.`),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('caption', { class: 'sr-only' }, 'Fehlerstatistik und Lernstand je Thema'),
        h('thead', {}, h('tr', {}, ...['Thema', 'Bearbeitet', 'Fehler', 'Ø Stufe', 'Sichere Lernziele'].map(t => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, ...stats.map(s => h('tr', {},
          h('th', { scope: 'row' }, s.topic),
          h('td', {}, `${s.attempted}/${s.cards}`),
          h('td', {}, String(s.errors)),
          h('td', {}, s.meanLevel.toFixed(1).replace('.', ',')),
          h('td', {}, `${s.secureObjectives}/${s.objectives}${s.secure ? ' ✓' : ''}`))))))),
    h('section', { class: 'card', 'aria-labelledby': 'bh' },
      h('h2', { id: 'bh' }, 'Datensicherung'),
      h('p', { class: 'hint' }, 'Der Lernstand liegt nur lokal auf diesem Gerät. Zum Gerätewechsel: hier exportieren, Datei übertragen, auf dem anderen Gerät importieren.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', type: 'button', on: { click: doExport } }, 'Lernstand exportieren (JSON)')),
      h('fieldset', { class: 'options options-inline' }, h('legend', {}, 'Beim Import'),
        radio(strategyName, 'replace', 'Lokalen Stand ersetzen', true),
        radio(strategyName, 'merge', 'Zusammenführen (neuerer Stand je Frage gewinnt)', false)),
      h('label', { for: importId, class: 'btn' }, 'Lernstand importieren …'),
      h('input', { id: importId, type: 'file', accept: '.json,application/json', class: 'visually-hidden-file', on: { change: async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await doImport(f); } } }),
      statusMsg,
      internalBackupsBlock()),
    h('section', { class: 'card', 'aria-labelledby': 'sh' },
      h('h2', { id: 'sh' }, 'Einstellungen'),
      h('form', { class: 'form-grid', on: { submit: e => e.preventDefault() } },
        h('div', { class: 'field' }, h('label', { for: dailyId }, 'Tagesziel (Antworten)'),
          h('input', { id: dailyId, class: 'input', type: 'number', min: '5', max: '200', value: app.settings.dailyGoal, inputmode: 'numeric',
            on: { change: e => saveSettings({ dailyGoal: Math.min(200, Math.max(5, Number(e.target.value) || 20)) }) } })),
        h('div', { class: 'field' }, h('label', { for: sessId }, 'Fragen pro Einheit'),
          h('input', { id: sessId, class: 'input', type: 'number', min: '5', max: '30', value: app.settings.sessionSize, inputmode: 'numeric',
            on: { change: e => saveSettings({ sessionSize: Math.min(30, Math.max(5, Number(e.target.value) || 10)) }) } })),
        h('div', { class: 'field' }, h('label', { for: themeId }, 'Darstellung'),
          h('select', { id: themeId, class: 'input', on: { change: e => { saveSettings({ theme: e.target.value }); applyTheme(e.target.value); } } },
            ...[['auto', 'Wie System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, t]) => h('option', { value: v, selected: app.settings.theme === v }, t)))),
        h('div', { class: 'field field-check' },
          h('input', { id: srcId, type: 'checkbox', checked: app.settings.showSource, on: { change: e => saveSettings({ showSource: e.target.checked }) } }),
          h('label', { for: srcId }, 'Quelle und Prüfstatus bei jeder Frage anzeigen')))),
    h('section', { class: 'card', 'aria-labelledby': 'ih' },
      h('h2', { id: 'ih' }, 'App & Speicher'),
      h('dl', { class: 'meta-dl' },
        h('dt', {}, 'App-Version'), h('dd', {}, app.version),
        h('dt', {}, 'Datenformat'), h('dd', {}, `v${DATA_SCHEMA_VERSION}`),
        h('dt', {}, 'Katalog'), h('dd', {}, `${app.catalog.catalogVersion} · ${app.cards.length} Lernkarten`),
        h('dt', {}, 'Speicher'), h('dd', {}, app.persistent ? 'IndexedDB (dauerhaft)' : 'Temporärer Sitzungsmodus'),
        h('dt', {}, 'Verwaiste Lernstände'), h('dd', {}, String(app.orphaned.length)),
        h('dt', {}, 'Cloud-Synchronisation'), h('dd', {}, sync.enabled ? 'aktiv' : 'deaktiviert (Schnittstelle vorbereitet, keine Datenübertragung)')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', id: 'check-update', on: { click: () => app.checkForUpdate?.() } }, 'Nach Update suchen'),
        h('button', { class: 'btn btn-danger', type: 'button', on: { click: async () => {
          if (!window.confirm('Gesamten Lernstand zurücksetzen? Vorher wird eine interne Sicherung angelegt.')) return;
          await resetAllProgress(); app.rerender();
        } } }, 'Lernstand zurücksetzen'))),
    examHistoryBlock()
  );
}

function radio(name, value, label, checked) {
  const id = nextId('rd');
  return h('label', { class: 'option', for: id }, h('input', { type: 'radio', name, id, value, checked }), label);
}

function internalBackupsBlock() {
  const wrap = h('details', {}, h('summary', {}, 'Interne Sicherungen (automatisch vor Import/Zurücksetzen)'));
  const list = h('ul', { class: 'plain' });
  wrap.append(list);
  app.repo.internalBackups().then(items => {
    if (!items.length) { list.append(h('li', { class: 'hint' }, 'Keine internen Sicherungen vorhanden.')); return; }
    for (const b of items) list.append(h('li', {},
      `${new Date(b.at).toLocaleString('de-DE')} · ${b.reason} · ${b.data.progress.length} Lernstände `,
      h('button', { class: 'btn btn-small', type: 'button', on: { click: async () => {
        if (!window.confirm('Diese Sicherung wiederherstellen? Der aktuelle Stand wird vorher ebenfalls gesichert.')) return;
        const r = await restoreInternalBackup(b.id); if (r.ok) app.rerender();
      } } }, 'Wiederherstellen')));
  }).catch(() => list.append(h('li', { class: 'hint' }, 'Sicherungen nicht lesbar.')));
  return wrap;
}

function examHistoryBlock() {
  const sec = h('section', { class: 'card', 'aria-labelledby': 'eh' }, h('h2', { id: 'eh' }, 'Prüfungshistorie'));
  app.repo.examHistory().then(list => {
    if (!list.length) { sec.append(h('p', { class: 'hint' }, 'Noch keine Prüfungssimulation abgeschlossen.')); return; }
    sec.append(h('ul', { class: 'plain' }, ...list.slice().reverse().slice(0, 10).map(e =>
      h('li', {}, `${new Date(e.at).toLocaleString('de-DE')}: ${e.percent.toLocaleString('de-DE')} % (${e.size} Fragen)`))));
  }).catch(() => {});
  return sec;
}

/** Dialog: Sicherung vor Import anbieten. Ergebnis: 'download' | 'skip' | 'cancel'. */
function askBackupBeforeImport() {
  return new Promise(resolve => {
    const dlg = document.getElementById('dialog');
    const done = v => { dlg.close(); resolve(v); };
    dlg.replaceChildren(h('form', { method: 'dialog', class: 'dialog-body' },
      h('h2', { id: 'dlgh' }, 'Vor dem Import sichern?'),
      h('p', {}, 'Der aktuelle Lernstand wird zusätzlich automatisch intern gesichert. Möchtest du ihn außerdem als Datei herunterladen?'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => done('download') } }, 'Sichern und importieren'),
        h('button', { class: 'btn', type: 'button', on: { click: () => done('skip') } }, 'Ohne Datei importieren'),
        h('button', { class: 'btn btn-ghost', type: 'button', on: { click: () => done('cancel') } }, 'Abbrechen'))));
    dlg.setAttribute('aria-labelledby', 'dlgh');
    dlg.addEventListener('cancel', () => resolve('cancel'), { once: true });
    dlg.showModal();
    dlg.querySelector('button')?.focus();
  });
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme; else delete root.dataset.theme;
}
