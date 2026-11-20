// Optionale Spracheingabe über die Web Speech API. Fallback: Texteingabe (immer vorhanden).
export function speechSupported() {
  try { return Boolean(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition); } catch { return false; }
}

/** Startet eine einmalige Erkennung (de-DE) und liefert den erkannten Text. */
export function recognizeOnce({ lang = 'de-DE', timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const Ctor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!Ctor) { reject(new Error('Spracheingabe wird von diesem Browser nicht unterstützt.')); return; }
    const rec = new Ctor();
    rec.lang = lang; rec.interimResults = false; rec.maxAlternatives = 1;
    const timer = setTimeout(() => { try { rec.stop(); } catch { /* ignorieren */ } }, timeoutMs);
    let text = '';
    rec.onresult = e => { text = Array.from(e.results).map(r => r[0].transcript).join(' '); };
    rec.onerror = e => { clearTimeout(timer); reject(new Error('Spracheingabe fehlgeschlagen: ' + (e.error || 'unbekannt'))); };
    rec.onend = () => { clearTimeout(timer); resolve(text.trim()); };
    try { rec.start(); } catch (e) { clearTimeout(timer); reject(e); }
  });
}
