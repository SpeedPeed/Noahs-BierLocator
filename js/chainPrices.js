// Online-Preise von Supermarkt-/Diskonterketten (data/chain-prices.json).
// Ketten haben meist landesweit einheitliche Online-Preise — sie werden deshalb
// pro Kette gepflegt und automatisch jeder Filiale zugeordnet (über die OSM-Tags
// brand/name/operator). Angezeigt als "Online-Preis · Stand …", getrennt von den
// Meldungen der Community.

import { UNITS } from './prices.js';
import { state } from './state.js';

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
};

// Hat eine Format-Variante keine eigenen Preise, gelten die der Hauptmarke.
const FALLBACK = { eurospar: 'spar', interspar: 'spar', billa_plus: 'billa' };

export const CHAIN_LABELS = {
  billa: 'BILLA', billa_plus: 'BILLA PLUS', spar: 'SPAR', eurospar: 'EUROSPAR', interspar: 'INTERSPAR',
  hofer: 'HOFER', lidl: 'Lidl', penny: 'PENNY', mpreis: 'MPREIS', unimarkt: 'Unimarkt',
  rewe: 'REWE', edeka: 'EDEKA', aldi_sued: 'ALDI SÜD', aldi_nord: 'ALDI NORD', kaufland: 'Kaufland',
  netto: 'Netto', trinkgut: 'trinkgut', getraenke_hoffmann: 'Getränke Hoffmann',
  coop: 'Coop', migros: 'Migros', denner: 'Denner', aldi: 'ALDI SUISSE', volg: 'Volg',
};

let data = null;      // { updated, prices: [...] }
let loading = null;

export function loadChainPrices() {
  if (data) return Promise.resolve(data);
  if (!loading) {
    loading = fetch('data/chain-prices.json')
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
          p.currency = p.currency || (p.country === 'CH' ? 'CHF' : 'EUR');
        }
        data = d;
        return data;
      });
  }
  return loading;
}

const ELIGIBLE_TYPES = new Set(['supermarket', 'beverages', 'convenience', 'fuel']);

function placeCountry(place) {
  const c = (place.tags['addr:country'] || '').toUpperCase();
  return CHAIN_PATTERNS[c] ? c : state.country;
}

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
  const pick = key => data.prices.filter(p => p.country === chain.country && p.chain === key);
  let list = pick(chain.key);
  if (!list.length && FALLBACK[chain.key]) list = pick(FALLBACK[chain.key]);
  return list;
}

// Günstigster Online-Preis (Normalpreis bevorzugt, Aktionen nur wenn sonst nichts).
export function cheapestChainPrice(place) {
  const list = chainPricesFor(place).filter(p => p.per05 != null);
  if (!list.length) return null;
  const regular = list.filter(p => !p.promo);
  const pool = regular.length ? regular : list;
  return pool.reduce((a, b) => (b.per05 < a.per05 ? b : a));
}

export function chainDataDate() { return data && data.updated; }
