// Orte aus OpenStreetMap (Overpass): Abfrage mit mehreren Servern, Klassifizierung
// und ein kleiner Cache, damit wiederholte Suchen sofort da sind.

import { OVERPASS_ENDPOINTS, MAX_PLACES } from './config.js';
import { haversine, fetchWithTimeout } from './util.js';

export const TYPE_META = {
  pub:         { label: 'Kneipe & Bar',  short: 'Kneipe',     icon: 'beerMug',  color: '#e8921b', tour: 0.95 },
  biergarten:  { label: 'Biergarten',    short: 'Biergarten', icon: 'tree',     color: '#3e9a52', tour: 1.0 },
  brewery:     { label: 'Brauerei',      short: 'Brauerei',   icon: 'barrel',   color: '#b4532a', tour: 1.0 },
  gasthaus:    { label: 'Gasthaus & Wirtshaus', short: 'Gasthaus', icon: 'beerMug', color: '#8a4b22', tour: 0.9 },
  restaurant:  { label: 'Restaurant',    short: 'Restaurant', icon: 'utensils', color: '#a0569f', tour: 0.6 },
  fastfood:    { label: 'Imbiss',        short: 'Imbiss',     icon: 'sandwich', color: '#d9662b', tour: 0.3 },
  nightclub:   { label: 'Club',          short: 'Club',       icon: 'disc',     color: '#6a4fd0', tour: 0.3 },
  fuel:        { label: 'Tankstelle',    short: 'Tanke',      icon: 'fuel',     color: '#5c6c7c', tour: 0.35 },
  supermarket: { label: 'Supermarkt',    short: 'Supermarkt', icon: 'cart',     color: '#2f7fc1', tour: 0.4 },
  beverages:   { label: 'Getränkemarkt', short: 'Getränke',   icon: 'box',      color: '#1b9696', tour: 0.5 },
  convenience: { label: 'Kiosk & Späti', short: 'Kiosk',      icon: 'store',    color: '#8a6d4f', tour: 0.45 },
};
export const TYPE_ORDER = Object.keys(TYPE_META);

// Gasthäuser/Wirtshäuser sind in OSM meist "restaurant" — erkennbar an Küche oder Name.
// Gerade auf dem Land sind sie die wichtigsten Bierorte.
const INN_CUISINE = 'regional|austrian|german|bavarian|styrian|tyrolean|swiss|franconian|heuriger';
const INN_NAME = 'gasthaus|gasthof|wirtshaus|wirt|bräu|brau|stube|stüb|keller|heurig|buschenschank|beisl|beisel|krug|schenke|hütte|einkehr|brauhaus|taverne';
const INN_CUISINE_RE = new RegExp(INN_CUISINE, 'i');
const INN_NAME_RE = new RegExp(INN_NAME, 'i');

// Welche OSM-Selektoren brauchen welche Typen (damit nur Nötiges geladen wird).
const SELECTORS = {
  pub:         ['["amenity"~"^(bar|pub)$"]'],
  biergarten:  ['["amenity"="biergarten"]', '["beer_garden"="yes"]'],
  brewery:     ['["craft"="brewery"]', '["microbrewery"="yes"]'],
  gasthaus:    [`["amenity"="restaurant"]["cuisine"~"${INN_CUISINE}",i]`, `["amenity"="restaurant"]["name"~"${INN_NAME}",i]`],
  restaurant:  ['["amenity"="restaurant"]'],
  fastfood:    ['["amenity"="fast_food"]'],
  nightclub:   ['["amenity"="nightclub"]'],
  fuel:        ['["amenity"="fuel"]'],
  supermarket: ['["shop"="supermarket"]'],
  beverages:   ['["shop"~"^(alcohol|beverages)$"]'],
  convenience: ['["shop"~"^(convenience|kiosk)$"]'],
};

// Nur diese Tags werden behalten (spart Speicher im Cache).
const KEEP_TAGS = /^(name|brand|operator|opening_hours|addr:(street|housenumber|postcode|city)|website|contact:website|phone|contact:phone|outdoor_seating|beer_garden|brewery|microbrewery|craft|amenity|shop|cuisine|wheelchair|drink:.*|description|internet_access)$/;

export function classify(tags) {
  if (!tags) return null;
  if (tags['drink:beer'] === 'no') return null;
  const a = tags.amenity, s = tags.shop;
  if (tags.craft === 'brewery' || tags.microbrewery === 'yes') return 'brewery';
  if (a === 'biergarten' || (tags.beer_garden === 'yes' && (a === 'pub' || a === 'bar' || a === 'restaurant'))) return 'biergarten';
  if (a === 'pub' || a === 'bar') return 'pub';
  if (a === 'restaurant') return (INN_CUISINE_RE.test(tags.cuisine || '') || INN_NAME_RE.test(tags.name || '')) ? 'gasthaus' : 'restaurant';
  if (a === 'fast_food') return 'fastfood';
  if (a === 'nightclub') return 'nightclub';
  if (a === 'fuel') return 'fuel';
  if (s === 'supermarket') return 'supermarket';
  if (s === 'alcohol' || s === 'beverages') return 'beverages';
  if (s === 'convenience' || s === 'kiosk') return 'convenience';
  return null;
}

function toPlace(el) {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  const type = classify(el.tags);
  if (lat == null || lon == null || !type) return null;
  const tags = {};
  for (const [k, v] of Object.entries(el.tags)) if (KEEP_TAGS.test(k)) tags[k] = v;
  return {
    id: `${el.type}/${el.id}`,
    type, lat, lon, tags,
    name: el.tags.name || el.tags.brand || TYPE_META[type].label,
    unnamed: !el.tags.name && !el.tags.brand,
  };
}

/* ---------- Overpass mit mehreren Servern ---------- */
// Startet die ersten zwei Server gleichzeitig; kommt nichts, laufen gestaffelt die
// übrigen an. Die erste brauchbare Antwort gewinnt. Scheitern alle, gibt es nach
// kurzer Pause eine zweite Runde (Überlastung ist meist nach Sekunden vorbei).
async function overpass(query) {
  try {
    return await overpassRound(query);
  } catch (e) {
    await new Promise(r => setTimeout(r, 2500));
    return overpassRound(query);
  }
}

function overpassRound(query) {
  return new Promise((resolve, reject) => {
    const ctrls = [];
    const errors = [];
    let next = 0, pending = 0, done = false;
    const launch = () => {
      if (done || next >= OVERPASS_ENDPOINTS.length) return;
      const url = OVERPASS_ENDPOINTS[next++];
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      pending++;
      fetchWithTimeout(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: ctrl.signal,
      }, 45000)
        .then(async res => {
          if (!res.ok) throw new Error(`${new URL(url).host}: ${res.status}`);
          const data = await res.json();
          if (data.remark && /runtime error|timed out|out of memory/i.test(data.remark) && !(data.elements || []).length) throw new Error('Zeitüberschreitung');
          return data;
        })
        .then(data => {
          if (done) return;
          done = true;
          ctrls.forEach(c => c !== ctrl && c.abort());
          resolve(data);
        })
        .catch(err => {
          pending--;
          if (done) return;
          errors.push(err.message || String(err));
          if (next < OVERPASS_ENDPOINTS.length) launch();
          else if (pending === 0) reject(new Error('Die Kartenserver sind gerade überlastet. Bitte gleich nochmal versuchen.'));
        });
    };
    launch();
    launch();
    setTimeout(launch, 4000);
    setTimeout(launch, 8000);
    setTimeout(launch, 12000);
  });
}

/* ---------- Cache ---------- */
const CACHE_PREFIX = 'bl_oc_';
const CACHE_TTL = 12 * 3600 * 1000;
const CACHE_MAX = 8;
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (Date.now() - v.t > CACHE_TTL) return null;
    return v.places;
  } catch (e) { return null; }
}
function cachePut(key, places) {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX))
      .map(k => ({ k, t: (JSON.parse(localStorage.getItem(k)) || {}).t || 0 }))
      .sort((a, b) => a.t - b.t);
    while (keys.length >= CACHE_MAX) localStorage.removeItem(keys.shift().k);
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), places }));
  } catch (e) {
    // Speicher voll → alten Cache wegwerfen und es lassen
    try { Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX)).forEach(k => localStorage.removeItem(k)); } catch (_) { /* egal */ }
  }
}

function buildQuery(types, area) {
  const sel = new Set();
  for (const t of types) for (const s of SELECTORS[t] || []) sel.add(s);
  const body = [...sel].map(s => `  nwr${s}(${area});`).join('\n');
  return `[out:json][timeout:40];\n(\n${body}\n);\nout center tags qt;`;
}

// Orte im Umkreis. `ref` = Bezugspunkt für die Entfernung (Standard: Mittelpunkt).
export async function fetchPlacesAround(center, radius, types, { ref = center, limit = MAX_PLACES, useCache = true } = {}) {
  const r = Math.round(radius);
  const lat = center.lat.toFixed(4), lon = center.lon.toFixed(4);
  const query = buildQuery(types, `around:${r},${lat},${lon}`);
  const key = hash(query);
  let places = useCache ? cacheGet(key) : null;
  const fromCache = !!places;
  if (!places) {
    const data = await overpass(query);
    const seen = new Set();
    places = [];
    for (const el of data.elements || []) {
      const p = toPlace(el);
      if (p && !seen.has(p.id)) { seen.add(p.id); places.push(p); }
    }
    cachePut(key, places);
  }
  const typeSet = new Set(types);
  const list = places
    .filter(p => typeSet.has(p.type))
    .map(p => ({ ...p, distance: haversine(ref.lat, ref.lon, p.lat, p.lon) }))
    .sort((a, b) => a.distance - b.distance);
  return { places: limit ? list.slice(0, limit) : list, total: list.length, fromCache };
}

// Orte per ID (für geteilte Links).
export async function fetchPlacesByIds(ids) {
  const byType = { node: [], way: [], relation: [] };
  for (const id of ids) {
    const [t, n] = id.split('/');
    if (byType[t] && /^\d+$/.test(n)) byType[t].push(n);
  }
  const parts = Object.entries(byType).filter(([, v]) => v.length).map(([t, v]) => `  ${t}(id:${v.join(',')});`);
  if (!parts.length) return [];
  const data = await overpass(`[out:json][timeout:25];\n(\n${parts.join('\n')}\n);\nout center tags;`);
  const found = new Map();
  for (const el of data.elements || []) {
    const p = toPlace(el);
    if (p) found.set(p.id, p);
  }
  return ids.map(id => found.get(id)).filter(Boolean);
}

export function placeAddress(p) {
  const t = p.tags;
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
  const city = [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ');
  return [street, city].filter(Boolean).join(', ');
}
