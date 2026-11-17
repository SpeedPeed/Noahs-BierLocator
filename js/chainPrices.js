// Online-Preise von Supermarkt-/Diskonterketten (data/prices/<Land>.json, nur die nötigen Länder).
// Ketten haben meist landesweit einheitliche Online-Preise — sie werden deshalb
// pro Kette gepflegt und automatisch jeder Filiale zugeordnet (über die OSM-Tags
// brand/name/operator). Angezeigt als "Online-Preis · Stand …", getrennt von den
// Meldungen der Community.

import { UNITS } from './prices.js';
import { state } from './state.js';
import { COUNTRIES, currencyFor } from './countries.js';

const byChain = new Map();   // Kette → ihre Preise (die Bier-Suche fragt alle Orte ab)

// Reihenfolge wichtig: spezifischere Muster zuerst (z.B. "Billa Plus" vor "Billa").
const CHAIN_PATTERNS = {
  AT: [
    ['billa_plus', /billa\s*plus|merkur/i],
    ['billa', /\bbilla\b/i],
    ['interspar', /interspar/i],
    ['eurospar', /eurospar/i],
    ['spar', /\bspar\b|spar gourmet/i],
    ['hofer', /\bhofer\b/i],
    ['lidl', /\blidl\b/i],
    ['penny', /\bpenny\b/i],
    ['mpreis', /m-?preis/i],
    ['sutterluety', /sutterl(ü|ue)ty/i],
    ['adeg', /\badeg\b/i],
    ['nahundfrisch', /nah\s*(&|und)\s*frisch/i],
    ['unimarkt', /unimarkt/i],
  ],
  DE: [
    ['rewe', /\brewe\b/i],
    ['edeka', /\bedeka\b|marktkauf/i],
    ['aldi_sued', /aldi\s*s(ü|ue)d/i],
    ['aldi_nord', /aldi\s*nord/i],
    ['lidl', /\blidl\b/i],
    ['kaufland', /kaufland/i],
    ['netto', /netto/i],
    ['penny', /\bpenny\b/i],
    ['trinkgut', /trinkgut/i],
    ['getraenke_hoffmann', /getr(ä|ae)nke\s*hoffmann/i],
  ],
  CH: [
    ['coop', /\bcoop\b/i],
    ['migros', /migros/i],
    ['denner', /denner/i],
    ['aldi', /\baldi\b/i],
    ['lidl', /\blidl\b/i],
    ['volg', /\bvolg\b/i],
    ['spar', /\bspar\b/i],
  ],
  // Kroatien: Preise aus den gesetzlichen Preislisten (scripts/scrapers/hr_cijene.py)
  HR: [
    ['interspar', /interspar/i],
    ['spar', /\bspar\b/i],
    ['kaufland', /kaufland/i],
    ['plodine', /plodine/i],
    ['tommy', /\btommy\b/i],
    ['ribola', /ribola/i],
    ['eurospin', /eurospin/i],
  ],
};

// Hat eine Format-Variante keine eigenen Preise, gelten die der Hauptmarke.
const FALLBACK = { eurospar: 'spar', interspar: 'spar', billa_plus: 'billa' };

export const CHAIN_LABELS = {
  billa: 'BILLA', billa_plus: 'BILLA PLUS', spar: 'SPAR', eurospar: 'EUROSPAR', interspar: 'INTERSPAR',
  hofer: 'HOFER', lidl: 'Lidl', penny: 'PENNY', mpreis: 'MPREIS', unimarkt: 'Unimarkt',
  sutterluety: 'Sutterlüty', adeg: 'ADEG', nahundfrisch: 'Nah&Frisch',
  rewe: 'REWE', edeka: 'EDEKA', aldi_sued: 'ALDI SÜD', aldi_nord: 'ALDI NORD', kaufland: 'Kaufland',
  netto: 'Netto', trinkgut: 'trinkgut', getraenke_hoffmann: 'Getränke Hoffmann',
  coop: 'Coop', migros: 'Migros', denner: 'Denner', aldi: 'ALDI SUISSE', volg: 'Volg',
  plodine: 'Plodine', tommy: 'Tommy', ribola: 'Ribola', eurospin: 'Eurospin',
};

let data = null;      // { updated, prices: [...] } aller bisher geladenen Länder
const perCountry = new Map();   // Land → Promise<{ updated, prices }>

function loadCountry(code) {
  if (!perCountry.has(code)) {
    // Länder ohne Datei (noch keine Ketten) liefern 404 → einfach leer
    perCountry.set(code, fetch(`data/prices/${code}.json`)
      .then(r => (r.ok ? r.json() : { prices: [] }))
      .catch(() => ({ prices: [] }))
      .then(d => {
        const today = new Date().toISOString().slice(0, 10);
        // Nur aktuell gültige Aktionen (abgelaufene und noch nicht gestartete ausblenden)
        d.prices = (d.prices || []).filter(p => (!p.valid_until || p.valid_until >= today) && (!p.valid_from || p.valid_from <= today));
        for (const p of d.prices) {
          const u = UNITS[p.unit];
          // Mehrfachpackungen/Fässer: über die Gesamtmenge auf 0,5 l umrechnen
          p.per05 = u ? p.price / u.halves : p.volume_l ? p.price / (p.volume_l * 2) : null;
          p.currency = p.currency || currencyFor(p.country);
        }
        return d;
      }));
  }
  return perCountry.get(code);
}

// Lädt die Preise der genannten Länder dazu (Standard: das Land des Standorts).
export async function loadChainPrices(countries = [state.country]) {
  const want = [...new Set(countries.filter(Boolean))];
  const missing = want.filter(c => !perCountry.has(c));
  await Promise.all(want.map(loadCountry));
  if (missing.length || !data) {
    const parts = await Promise.all([...perCountry.values()]);
    data = { updated: parts.map(d => d.updated).filter(Boolean).sort().pop(), prices: parts.flatMap(d => d.prices) };
    byChain.clear();
  }
  return data;
}

const ALCOHOL_FREE = /alkoholfrei|alkoholarm|\b0[.,]0\b|0[.,]0\s*%|\bnon\b|ohne alkohol|ohne alcool|sans alcool|senza alcol|alcohol[- ]?free|\bfrei\b|\bfree\b|\bzero\b/i;
const MIXED = /radler|shandy|panas?ch|alsterwasser|russ'?n\b|biermix|mischgetr|cola|lemon|zitron|limo|cider|seltzer|\bhugo\b/i;
// Ketten, die gar keinen Alkohol verkaufen: alles dort ist alkoholfrei, egal wie es heißt.
const NO_ALCOHOL_CHAINS = new Set(['CH|migros']);
const ELIGIBLE_TYPES = new Set(['supermarket', 'beverages', 'convenience', 'fuel']);

// 'bier' | 'radler' (auch andere Mischgetränke) | 'alkoholfrei'.
// Im Zweifel lieber kein Bier: ein fehlender Preis ist besser als ein falscher.
export function beerKind(p) {
  if (NO_ALCOHOL_CHAINS.has(`${p.country}|${p.chain}`) || ALCOHOL_FREE.test(p.beer)) return 'alkoholfrei';
  return MIXED.test(p.beer) ? 'radler' : 'bier';
}
const KIND_ORDER = { bier: 0, radler: 1, alkoholfrei: 2 };
// Für Listen: echtes Bier zuerst, darin nach Preis pro Halbe.
export const byKindThenPrice = (a, b) => KIND_ORDER[beerKind(a)] - KIND_ORDER[beerKind(b)] || (a.per05 ?? 99) - (b.per05 ?? 99);

// Land eines Ortes: aus OSM, sonst das Land des gesuchten Standorts.
// shortcut: direkt an der Grenze (Basel, Konstanz) zählt das Land der Suche, bis Orte ein eigenes Land bekommen.
export function placeCountry(place) {
  const c = ((place.tags && place.tags['addr:country']) || '').toUpperCase();
  return COUNTRIES[c] ? c : state.country;
}
export const placeCurrency = place => currencyFor(placeCountry(place));

export function chainOf(place) {
  if (!ELIGIBLE_TYPES.has(place.type)) return null;
  const country = placeCountry(place);
  const text = [place.tags.brand, place.tags.name, place.tags.operator].filter(Boolean).join(' | ');
  if (!text) return null;
  for (const [key, re] of CHAIN_PATTERNS[country] || []) {
    if (re.test(text)) return { key, country };
  }
  return null;
}

// Online-Preise für eine Filiale (leer, wenn Kette unbekannt oder Daten noch nicht geladen).
export function chainPricesFor(place) {
  if (!data) return [];
  const chain = chainOf(place);
  if (!chain) return [];
  const id = `${chain.country}|${chain.key}`;
  if (!byChain.has(id)) {
    const pick = key => data.prices.filter(p => p.country === chain.country && p.chain === key);
    let list = pick(chain.key);
    if (!list.length && FALLBACK[chain.key]) list = pick(FALLBACK[chain.key]);
    byChain.set(id, list);
  }
  return byChain.get(id);
}

// Günstigstes echtes Bier einer Preisliste (Normalpreis bevorzugt, Aktionen nur wenn sonst
// nichts). Radler und Alkoholfreies zählen nie: gibt es kein echtes Bier, gibt es keinen Preis.
export function cheapestOf(list) {
  const beers = list.filter(p => p.per05 != null && beerKind(p) === 'bier');
  if (!beers.length) return null;
  const regular = beers.filter(p => !p.promo);
  return (regular.length ? regular : beers).reduce((a, b) => (b.per05 < a.per05 ? b : a));
}
export const cheapestChainPrice = place => cheapestOf(chainPricesFor(place));

export function chainDataDate() { return data && data.updated; }

// Nächste Filiale einer Kette unter den geladenen Orten (Preise von SPAR gelten
// auch für EUROSPAR/INTERSPAR usw.).
export function nearestStore(chainKey, country, places) {
  let best = null;
  for (const p of places) {
    const c = chainOf(p);
    if (!c || c.country !== country || (c.key !== chainKey && FALLBACK[c.key] !== chainKey)) continue;
    if (!best || p.distance < best.distance) best = p;
  }
  return best;
}
