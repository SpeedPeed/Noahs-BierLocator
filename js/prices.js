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
