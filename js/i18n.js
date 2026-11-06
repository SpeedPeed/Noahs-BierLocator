// Sprache: Deutsch (Standard) oder Englisch. Die deutschen Texte sind zugleich die
// Schlüssel: t('Jetzt offen') → 'Open now'. Fehlt eine Übersetzung, bleibt Deutsch.
// Platzhalter: t('Noch {n} km', { n: 3 }). DOM-frei bis auf translateDom (für index.html).
import EN from './lang/en.js';

const KEY = 'bl_lang_v1';
export const LANGS = { de: 'Deutsch', en: 'English' };

function detect() {
  if (globalThis.__BL_LANG === 'de' || globalThis.__BL_LANG === 'en') return globalThis.__BL_LANG; // Tests
  try { const s = localStorage.getItem(KEY); if (s === 'de' || s === 'en') return s; } catch (e) { /* kein Speicher */ }
  const langs = typeof navigator !== 'undefined' ? (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) : [];
  for (const l of langs) {
    const p = String(l || '').slice(0, 2).toLowerCase();
    if (p === 'de' || p === 'en') return p;
  }
  return 'en';
}

export const LANG = detect();
export const LOCALE = LANG === 'de' ? 'de-DE' : 'en-GB';

const fill = (s, params) => params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s;

// Übersetzen in eine bestimmte Sprache (für Tests); t() nimmt die aktuelle.
export function tr(lang, s, params) {
  const out = lang === 'en' && Object.prototype.hasOwnProperty.call(EN, s) ? EN[s] : s;
  return fill(out, params);
}
export const t = (s, params) => tr(LANG, s, params);

export function setLang(lang) {
  try { localStorage.setItem(KEY, lang); } catch (e) { /* egal */ }
  location.reload();
}

// Zahlen mit dem Dezimaltrennzeichen der Sprache (4,5 / 4.5).
export function num(v, digits = 1) {
  const s = Number(v).toFixed(digits);
  return LANG === 'de' ? s.replace('.', ',') : s;
}
// Geldbetrag: "4,50 €" / "€4.50"; Franken wie in der Schweiz üblich "CHF 4.50".
export function money(v, currency = 'EUR') {
  if (currency === 'CHF') return `CHF ${Number(v).toFixed(2)}`; // Schweiz: immer Punkt
  return LANG === 'de' ? `${num(v, 2)} €` : `€${num(v, 2)}`;
}

// Gebinde-Angaben aus den Händlerdaten ("6×0,5 l Dosen") nur zur Anzeige übersetzen.
const PKG_WORDS = { Dosen: 'cans', Dose: 'Can', Flasche: 'Bottle', Flaschen: 'bottles', Einweg: 'single-use', Mehrweg: 'returnable' };
export function pkg(s) {
  if (!s || LANG === 'de') return s || '';
  return String(s).replace(/(\d),(\d)/g, '$1.$2').replace(/\b(Dosen|Dose|Flaschen|Flasche|Einweg|Mehrweg)\b/g, w => PKG_WORDS[w]);
}

// Statische Texte in index.html: Textknoten und Attribute, die exakt einem Schlüssel entsprechen.
export function translateDom(root = document.body) {
  if (LANG === 'de') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = n.nodeValue, key = raw.trim();
    if (key && Object.prototype.hasOwnProperty.call(EN, key)) n.nodeValue = raw.replace(key, EN[key]);
  }
  for (const attr of ['placeholder', 'aria-label', 'title', 'alt']) {
    root.querySelectorAll(`[${attr}]`).forEach(el => {
      const v = el.getAttribute(attr);
      if (Object.prototype.hasOwnProperty.call(EN, v)) el.setAttribute(attr, EN[v]);
    });
  }
  if (Object.prototype.hasOwnProperty.call(EN, document.title)) document.title = EN[document.title];
  document.documentElement.lang = LANG;
}

export const dictionarySize = () => Object.keys(EN).length;
export const privacyPage = () => (LANG === 'en' ? 'privacy.html' : 'datenschutz.html');
export const dictionary = () => EN;
