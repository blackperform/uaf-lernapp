// Einstiegspunkt: Speicher/Katalog initialisieren, Router, Banner, Service-Worker-Updates.
import { app, initApp, setBanner } from './app-state.js';
import { h } from './ui/dom.js';
import { renderHome, renderLearn, renderSigns, renderCatalog, renderMore, applyTheme } from './ui/views-main.js';
import { renderSession, renderExam, MODES } from './ui/views-session.js';

const main = document.getElementById('main');
const live = document.getElementById('live');
const bannerRegion = document.getElementById('banner-region');
let cleanup = null;

app.announce = msg => {
  live.textContent = '';
  // Kurze Verzögerung, damit Screenreader identische Meldungen erneut vorlesen.
  setTimeout(() => { live.textContent = msg; }, 30);
};

function parseRoute() {
  const parts = (location.hash || '#/start').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { name: parts[0] || 'start', args: parts.slice(1) };
}

const ROUTES = {
  start: { nav: 'start', title: 'Start', render: renderHome },
  lernen: { nav: 'lernen', title: 'Lernen', render: renderLearn },
  zeichen: { nav: 'zeichen', title: 'Taktische Zeichen', render: renderSigns },
  katalog: { nav: 'katalog', title: 'Katalog', render: renderCatalog },
  mehr: { nav: 'mehr', title: 'Fortschritt & Mehr', render: renderMore },
  sitzung: { nav: null, title: 'Lernsitzung', render: (m, args) => renderSession(m, { mode: args[0], param: args[1] }) },
  pruefung: { nav: 'lernen', title: 'Prüfungssimulation', render: renderExam }
};

function route({ focus = true } = {}) {
  if (cleanup) { try { cleanup(); } catch { /* ignorieren */ } cleanup = null; }
  const { name, args } = parseRoute();
  const r = ROUTES[name] || ROUTES.start;
  const nav = r.nav ?? (MODES[args[0]]?.nav || 'lernen');
  document.querySelectorAll('.bottom-nav a').forEach(a => {
    if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${r.title} · UaF-Lernapp`;
  main.replaceChildren();
  try {
    const c = r.render(main, args);
    if (typeof c === 'function') cleanup = c;
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('h1', { tabindex: '-1' }, 'Fehler'), h('p', { class: 'error' }, 'Die Ansicht konnte nicht geladen werden: ' + e.message));
  }
  if (focus) (main.querySelector('h1') || main).focus({ preventScroll: false });
  window.scrollTo(0, 0);
}
app.rerender = () => route({ focus: true });

function renderBanners() {
  bannerRegion.replaceChildren(...[...app.banners].map(([id, b]) => h('div', { class: `banner banner-${b.kind}`, role: b.kind === 'warn' ? 'alert' : 'status' },
    h('p', {}, b.text),
    b.action ? h('button', { class: 'btn btn-small', type: 'button', on: { click: b.action.run } }, b.action.label) : null,
    b.dismissible ? h('button', { class: 'btn btn-small btn-ghost', type: 'button', 'aria-label': 'Hinweis schließen', on: { click: () => setBanner(id, null) } }, '✕') : null)));
}

function updateOnlineState() {
  const off = !navigator.onLine;
  document.getElementById('offline-indicator').hidden = !off;
}

// ---------------------------------------------------------------- Service Worker
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setBanner('sw', { kind: 'info', text: 'Dieser Browser unterstützt keine Offline-Installation (Service Worker). Die App funktioniert online.', dismissible: true });
    return;
  }
  if (!window.isSecureContext) {
    setBanner('sw', { kind: 'info', text: 'Offline-Modus und Installation benötigen HTTPS (oder localhost).', dismissible: true });
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('service-worker.js', { scope: './' });
    const offerUpdate = worker => setBanner('update', {
      kind: 'info',
      text: 'Eine neue App-Version ist verfügbar. Dein Lernstand bleibt beim Aktualisieren erhalten.',
      action: { label: 'Jetzt aktualisieren', run: () => { app.userRequestedUpdate = true; worker.postMessage({ type: 'SKIP_WAITING' }); } },
      dismissible: true
    });
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
      });
    });
    // Kontrolliertes Update: Neuladen nur, wenn der Nutzer „Jetzt aktualisieren“ gewählt hat.
    app.userRequestedUpdate = false;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !app.userRequestedUpdate) return;
      reloading = true; location.reload();
    });
    app.checkForUpdate = async () => {
      try { await reg.update(); app.announce(reg.waiting ? 'Update verfügbar.' : 'Keine neue Version gefunden.'); }
      catch { app.announce('Update-Prüfung nicht möglich (offline?).'); }
    };
  } catch (e) {
    console.warn('Service Worker nicht registriert:', e);
  }
}

// ---------------------------------------------------------------- Start
async function start() {
  app.onChange(renderBanners);
  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
  updateOnlineState();
  try {
    await initApp();
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('h1', { tabindex: '-1' }, 'Start nicht möglich'),
      h('p', { class: 'error' }, 'Der Fragenkatalog konnte nicht geladen werden. Beim allerersten Aufruf ist eine Internetverbindung nötig. Details: ' + e.message),
      h('button', { class: 'btn btn-primary', type: 'button', on: { click: () => location.reload() } }, 'Erneut versuchen'));
    renderBanners();
    return;
  }
  applyTheme(app.settings.theme);
  renderBanners();
  window.addEventListener('hashchange', () => route());
  route({ focus: false });
  document.documentElement.dataset.ready = 'true';
  registerServiceWorker();
}

start();
