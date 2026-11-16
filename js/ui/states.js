// Leer-, Fehler- und Offline-Zustände: kleine Zeichnung im App-Stil, ein Satz, ein nächster Schritt.
// (docs/design.md: jeder Zustand sagt, was los ist, und bietet genau eine Sache an.)
import { icon } from '../icons.js';
import { escapeHtml } from '../util.js';

const GLASS = 'M0 0h26l-2.6 34a3 3 0 0 1-3 2.8H5.6a3 3 0 0 1-3-2.8z';
const HANDLE = 'M26 7h3.4a3.2 3.2 0 0 1 3.2 3.2v7.6a3.2 3.2 0 0 1-3.2 3.2H25';
const svg = body => `<svg class="state-art" viewBox="0 0 120 84" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ART = {
  // Leeres Glas, darüber ein Ortszeiger: "Wo bist du?"
  where: svg(`
    <ellipse class="art-soft" cx="60" cy="76" rx="34" ry="5" stroke="none"/>
    <g transform="translate(40 36)"><path d="${GLASS}"/><path d="${HANDLE}"/></g>
    <path class="art-beer" d="M53 6a9 9 0 0 1 9 9c0 6.2-9 13.5-9 13.5S44 21.200 44 15a9 9 0 0 1 9-9z"/>
    <circle class="art-foam" cx="53" cy="15" r="3" stroke="none"/>`),
  // Umgedrehtes Glas auf dem Deckel: hier gibt es nichts.
  nothing: svg(`
    <ellipse class="art-beer" cx="60" cy="74" rx="36" ry="6"/>
    <ellipse cx="60" cy="74" rx="29" ry="3.6" stroke-width="1.2"/>
    <g transform="translate(47 71) scale(1 -1)"><path class="art-panel" d="${GLASS}"/></g>`),
  // Umgekipptes Glas mit Pfütze: da ist was schiefgegangen.
  error: svg(`
    <path class="art-beer" d="M56 70c8-6 30-7 44-1 6 3 2 9-8 9H62c-9 0-11-5-6-8z"/>
    <g transform="translate(60 44) rotate(90)"><path class="art-panel" d="${GLASS}"/></g>
    <path d="M96 38l5-5M102 46h7M92 30v-7"/>`),
  // Glas neben durchgestrichenem Funksignal: kein Netz.
  offline: svg(`
    <ellipse class="art-soft" cx="60" cy="76" rx="34" ry="5" stroke="none"/>
    <g transform="translate(26 36)"><path class="art-beer" d="M1.200 16h23.600l-1.400 18a3 3 0 0 1-3 2.800H5.600a3 3 0 0 1-3-2.800z" stroke="none"/><path d="${GLASS}"/><path d="${HANDLE}"/></g>
    <path d="M74 40a22 22 0 0 1 30 0M80 48a13 13 0 0 1 18 0"/><circle cx="89" cy="56" r="1.6" fill="currentColor"/>
    <path class="art-bad" d="M74 62l30-32"/>`),
};

// → HTML. `action` = { id, label, icon } wird als ein Knopf angeboten (Klick verdrahtet der Aufrufer).
export function stateBlock({ art, title, text = '', action = null, small = false }) {
  return `<div class="state${small ? ' small' : ''}">
    ${ART[art] || ''}
    <h3>${escapeHtml(title)}</h3>
    ${text ? `<p>${escapeHtml(text)}</p>` : ''}
    ${action ? `<button class="btn btn-primary" id="${action.id}">${action.icon ? icon(action.icon, { size: 20 }) : ''}${escapeHtml(action.label)}</button>` : ''}
  </div>`;
}
