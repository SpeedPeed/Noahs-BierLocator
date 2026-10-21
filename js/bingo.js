// Bier-Bingo für unterwegs (DOM-frei, getestet in tests/): 3 × 3 Felder, die Mitte
// ist frei. Gleicher Seed (z.B. Gruppencode) = gleiche Karte für alle in der Runde.
import { seededRandom } from './util.js';

export const BINGO_TASKS = [
  'Ein Radler bestellen', 'Ein Bier unter 3 €', 'Ein Bier über 5 €', 'Mit Fremden anstoßen',
  'Ein Hund im Lokal', 'Bierdeckel als Andenken', 'Bier aus dem Ort', 'Eine Maß oder ein Krügerl',
  'Ein Weizen', 'Ein Dunkles', 'Etwas Alkoholfreies', 'Brezn oder Snack',
  'Gruppenfoto am Rad', 'Jemand verfährt sich', 'Bergauf schieben', 'Ein paar Regentropfen',
  'Biergarten unter Kastanien', 'Die Wirtin oder der Wirt erzählt was', 'Stammtisch entdeckt', 'Eine Sorte, die keiner kennt',
  'Jemand bestellt das Falsche', 'Kühe am Wegrand', 'Über eine Brücke fahren', 'Für jemanden klingeln',
  'Jemand singt', 'Bier vom Fass', 'Selbstgebrautes Bier', 'Bierdeckel-Turm bauen',
  'Schnaps angeboten bekommen', 'Etwas wird verschüttet', 'Ein Lokal hat zu', 'Pause im Grünen',
  'Kirchenglocken hören', 'Fußball im Fernsehen', 'Ein Kellerbier', 'Andere Radler grüßen',
];

export const FREE = 'Prost! (frei)';

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// → 9 Felder (Index 4 = frei)
export function makeCard(seed) {
  const rnd = seededRandom(hash(String(seed)) || 1);
  const pool = BINGO_TASKS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const cells = pool.slice(0, 8);
  cells.splice(4, 0, FREE);
  return cells;
}

export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

// marked: 9 Booleans (Mitte zählt immer) → vollständige Reihen
export function completeLines(marked) {
  const m = marked.map((v, i) => v || i === 4);
  return LINES.filter(l => l.every(i => m[i]));
}
