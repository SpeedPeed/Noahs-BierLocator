// Gebinde, Umrechnung auf 0,5 l und Plausibilitätsprüfung.
// Die Grenzen sind identisch mit denen in supabase/schema.sql.

export const UNITS = {
  '0.5l':           { label: '0,5 l',             halves: 1 },
  '0.33l':          { label: '0,33 l',            halves: 0.66 },
  '1l':             { label: '1 l (Maß)',         halves: 2 },
  'kasten20x0.5l':  { label: 'Kasten 20 × 0,5 l', halves: 20, crate: true },
  'kasten24x0.33l': { label: 'Kasten 24 × 0,33 l', halves: 15.84, crate: true },
};

// Erlaubter Bereich, umgerechnet auf €/0,5 l.
export const PLAUSIBLE = {
  single: { min: 0.30, max: 15 },
  crate:  { min: 0.25, max: 4 },
};

export const STALE_DAYS = 180;   // ältere Preise werden ausgegraut und zählen nicht als "günstigster"

export function per05(price, unit) {
  const u = UNITS[unit];
  return u ? price / u.halves : NaN;
}

// → { ok, per05, message }
export function validatePrice(rawPrice, unit, beer = 'x') {
  const price = typeof rawPrice === 'number' ? rawPrice : parseFloat(String(rawPrice).replace(',', '.'));
  const u = UNITS[unit];
  if (!u) return { ok: false, message: 'Unbekanntes Gebinde.' };
  if (!beer || !String(beer).trim()) return { ok: false, message: 'Welche Biersorte?' };
  if (String(beer).trim().length > 40) return { ok: false, message: 'Biersorte bitte kürzer (max. 40 Zeichen).' };
  if (!isFinite(price) || price <= 0) return { ok: false, message: 'Bitte einen Preis eingeben.' };
  const p05 = price / u.halves;
  const range = u.crate ? PLAUSIBLE.crate : PLAUSIBLE.single;
  const lo = range.min * u.halves, hi = range.max * u.halves;
  const fmt = v => v.toFixed(2).replace('.', ',') + ' €';
  if (p05 < range.min) return { ok: false, per05: p05, message: `Das ist unrealistisch billig — für ${u.label} sind mindestens ${fmt(lo)} plausibel.` };
  if (p05 > range.max) return { ok: false, per05: p05, message: `Das ist unrealistisch teuer — für ${u.label} sind höchstens ${fmt(hi)} plausibel.` };
  return { ok: true, per05: p05, price: Math.round(price * 100) / 100 };
}

export const BEER_SUGGESTIONS = [
  'Pils', 'Helles', 'Märzen', 'Weizen', 'Zwickl', 'Radler', 'Dunkles', 'Lager', 'IPA', 'Kellerbier', 'Export', 'Bock',
  'Alkoholfrei', 'Kölsch', 'Altbier', 'Stiegl', 'Gösser', 'Ottakringer', 'Zipfer', 'Puntigamer', 'Augustiner',
  'Paulaner', 'Tegernseer', 'Feldschlösschen', 'Krombacher', 'Becks', 'Heineken',
];

/* ---------- Getränkekarte per Foto (Texterkennung → Preisvorschläge) ---------- */
const BEERISH = /bier|pils|helle|märzen|marzen|weizen|wei(ß|ss)|zwi?c?kl|radler|lager|\bipa\b|\bale\b|stout|porter|dunkel|bock|keller|export|kölsch|koelsch|\balt\b|zipfer|stiegl|gösser|goesser|ottakringer|puntigamer|augustiner|paulaner|tegernseer|krombacher|beck'?s|heineken|hofbr|schlossgold|edelwei|kaiser|murauer|hirter|trumer|feldschl|warsteiner|bitburger|erdinger|franziskaner|löwenbr|spaten|astra|jever|radeberger|budweiser|pilsner|urquell|krügerl|seidl|halbe|\bmaß\b|vom fass|zwickel|gösser|egger|schremser|freistädter|wieselburger|calanda|eichhof|quöllfrisch|appenzeller/i;
const VOL_WORDS = { 'maß': 1, 'mass': 1, 'krügerl': 0.5, 'kruegerl': 0.5, 'halbe': 0.5, 'seidl': 0.3, 'pfiff': 0.2 };
// Mengen ohne "l" (0,5 / 0,33) und typische Lesefehler der Texterkennung: "0,5 l" → "0,51", "0,5|", "0,5I".
const TOKEN_RE = /(\d+(?:[.,]\d{1,2})?)\s*(?:l|ltr|lt|liter)\.?(?![a-zäöüß])|\b(maß|mass|krügerl|kruegerl|halbe|seidl|pfiff)\b|(?<![\d.,])(0[.,](?:25|33|2|3|4|5))(?:[1lI|](?![\d]))?(?![\d])|(?:€\s*)?(?<![\d.,])(\d{1,2})[.,](\d{2}|-{1,2})(?![\d])\s*(?:€|eur|chf|fr\.?)?/gi;

const volUnit = l => (l == null ? null : Math.abs(l - 0.5) < 0.01 ? '0.5l' : Math.abs(l - 0.33) < 0.01 ? '0.33l' : Math.abs(l - 1) < 0.01 ? '1l' : null);
const cleanName = s => s.replace(/[.…·_|*]{2,}/g, ' ').replace(/[^A-Za-zÄÖÜäöüß' &-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[-&' ]+|[-&' ]+$/g, '');

// Text (z.B. aus der Texterkennung eines Fotos der Getränkekarte) → Kandidaten
// [{ beer, price, unit, volL, beerish, ok, message }]. Nichts wird automatisch
// gemeldet — die Liste ist nur ein Vorschlag zum Bestätigen.
export function parseMenuText(text) {
  const out = [];
  let pendingName = '', headVols = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const tokens = [];
    for (const m of line.matchAll(TOKEN_RE)) {
      if (m[1] != null) tokens.push({ kind: 'vol', at: m.index, l: Number(m[1].replace(',', '.')) });
      else if (m[2] != null) tokens.push({ kind: 'vol', at: m.index, l: VOL_WORDS[m[2].toLowerCase()] });
      else if (m[3] != null) tokens.push({ kind: 'vol', at: m.index, l: Number(m[3].replace(',', '.')) });
      else if (m[4] != null) {
        const v = Number(m[4]) + (/^\d{2}$/.test(m[5]) ? Number(m[5]) / 100 : 0);
        if (v >= 1) tokens.push({ kind: 'price', at: m.index, v });
      }
    }
    const prices = tokens.filter(t => t.kind === 'price');
    if (!prices.length) {
      const name = cleanName(line);
      // Zeile nur mit Menge (z.B. Spaltenkopf "0,5 l") gilt für die Zeilen darunter
      const vols = tokens.filter(t => t.kind === 'vol');
      if (vols.length) headVols = vols.map(v => v.l);
      if (/[A-Za-zÄÖÜäöü]{2,}/.test(name) && name.length <= 40) pendingName = name;
      continue;
    }
    let name = cleanName(line.slice(0, tokens[0].at));
    if (name.length < 2) name = pendingName;
    else pendingName = name;
    if (!name) continue;
    const vols = tokens.filter(t => t.kind === 'vol');
    const used = new Set();
    prices.forEach((p, k) => {
      let vol = [...vols].reverse().find(v => v.at < p.at && !used.has(v));
      if (!vol) vol = vols.find(v => v.at > p.at && !used.has(v));
      if (vol) used.add(vol);
      // ohne Menge in der Zeile: Spaltenköpfe ("0,3 l  0,5 l") der Reihe nach
      const head = headVols.length === prices.length ? headVols[k] : headVols.length === 1 ? headVols[0] : null;
      const volL = vol ? vol.l : !vols.length ? head : null;
      // Ohne erkannte Menge: 0,5 l annehmen, aber nicht vorauswählen (bitte prüfen)
      const guessed = volL == null;
      const unit = guessed ? '0.5l' : volUnit(volL);
      const beer = name.slice(0, 40);
      const check = unit ? validatePrice(p.v, unit, beer) : { ok: false, message: `${String(volL).replace('.', ',')} l gibt es als Gebinde nicht — bitte anpassen.` };
      const beerish = BEERISH.test(name);
      if (out.some(o => o.beer === beer && o.unit === unit && o.price === p.v)) return;
      out.push({ beer, price: p.v, unit, volL, guessed, beerish, ok: check.ok, message: check.ok ? (guessed ? 'Menge nicht erkannt — 0,5 l angenommen, bitte prüfen.' : '') : check.message });
    });
  }
  return out.slice(0, 40);
}

// "500 ml", "0,33 l", "20 x 0,5 l" (Open Food Facts) → Gebinde-Schlüssel oder null
export function parsePackLabel(text) {
  const t = String(text || '').toLowerCase().replace(',', '.').replace('×', 'x');
  const m = t.match(/(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)\s*(ml|cl|l)\b/);
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  const l = Number(m[2]) / (m[3] === 'ml' ? 1000 : m[3] === 'cl' ? 100 : 1);
  const near = (a, b) => Math.abs(a - b) < 0.01;
  if (n === 1 && near(l, 0.5)) return '0.5l';
  if (n === 1 && near(l, 0.33)) return '0.33l';
  if (n === 1 && near(l, 1)) return '1l';
  if (n === 20 && near(l, 0.5)) return 'kasten20x0.5l';
  if (n === 24 && near(l, 0.33)) return 'kasten24x0.33l';
  return null;
}
