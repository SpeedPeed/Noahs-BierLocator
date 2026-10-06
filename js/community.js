// Preise & Bewertungen. Mit konfiguriertem Supabase (config.js) für alle Nutzer
// geteilt, sonst lokal im Browser — die Schnittstelle ist in beiden Fällen gleich.
//
// Geteilter Modus: kein Login. Jedes Gerät hat ein zufälliges Geheimnis
// (store.deviceSecret); die Datenbank speichert nur dessen SHA-256-Hash. Damit
// zählt pro Gerät und Ort genau eine Bewertung, und eigene Preise lassen sich
// wieder löschen. Alle Schreibzugriffe laufen über Datenbank-Funktionen, die die
// Plausibilität der Preise zusätzlich serverseitig prüfen.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { deviceSecret, LEGACY_DATA_KEY } from './store.js';
import { per05, validatePrice, STALE_DAYS } from './prices.js';
import { fetchWithTimeout } from './util.js';

export const isShared = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

const summaries = new Map(); // placeId → summary

/* ---------- Zusammenfassung pro Ort ---------- */
function summarize(prices, rating) {
  const sorted = prices.slice().sort((a, b) => b.created_at - a.created_at);
  const staleCut = Date.now() - STALE_DAYS * 86400000;
  let cheapest = null;
  for (const p of sorted) {
    const v = per05(p.price, p.unit);
    p.per05 = v;
    p.stale = p.created_at < staleCut;
    if (!p.stale && (!cheapest || v < cheapest.per05)) cheapest = p;
  }
  if (!cheapest && sorted.length) {
    cheapest = sorted.reduce((a, b) => (b.per05 < a.per05 ? b : a));
  }
  return { prices: sorted, cheapest, rating: rating || { avg: null, count: 0, mine: null } };
}
export const EMPTY_SUMMARY = Object.freeze({ prices: [], cheapest: null, rating: { avg: null, count: 0, mine: null } });
export function getSummary(id) { return summaries.get(id) || EMPTY_SUMMARY; }

/* ---------- Lokales Backend ---------- */
const LOCAL_KEY = 'bl_community_local_v1';
let local = null;
function loadLocal() {
  if (local) return local;
  try { local = JSON.parse(localStorage.getItem(LOCAL_KEY)) || null; } catch (e) { local = null; }
  if (!local) {
    local = {};
    // Altdaten (v1) übernehmen
    try {
      const old = JSON.parse(localStorage.getItem(LEGACY_DATA_KEY)) || {};
      for (const [id, r] of Object.entries(old)) {
        const prices = (r.prices || []).filter(p => UNIT_OK(p.unit) && p.price > 0).map((p, i) => ({
          id: `l${p.reportedAt || Date.now()}${i}`, beer: p.beerType || 'Bier', price: p.price, unit: p.unit, created_at: p.reportedAt || Date.now(), mine: true,
        }));
        const myRating = r.ratings && r.ratings.length ? r.ratings[r.ratings.length - 1] : null;
        if (prices.length || myRating) local[id] = { prices, myRating };
      }
    } catch (e) { /* keine Altdaten */ }
    saveLocal();
  }
  return local;
}
const UNIT_OK = u => ['0.33l', '0.5l', '1l', 'kasten20x0.5l', 'kasten24x0.33l'].includes(u);
function saveLocal() { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch (e) { /* voll */ } }
function localSummary(id) {
  const r = loadLocal()[id];
  if (!r) return summarize([], null);
  return summarize(r.prices.map(p => ({ ...p })), r.myRating ? { avg: r.myRating, count: 1, mine: r.myRating } : null);
}

/* ---------- Supabase-Backend ---------- */
async function rpc(fn, body) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  const res = await fetchWithTimeout(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }, 15000);
  if (!res.ok) {
    let msg = `Server-Fehler ${res.status}`;
    try { const j = await res.json(); msg = j.message || msg; } catch (e) { /* egal */ }
    if (/implausible/i.test(msg)) msg = 'Der Preis ist unrealistisch und wurde nicht gespeichert.';
    if (/rate limit/i.test(msg)) msg = 'Heute schon sehr viele Preise gemeldet — morgen wieder!';
    throw new Error(msg);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ---------- Öffentliche API ---------- */

// Lädt Zusammenfassungen für viele Orte (geteilt: in Paketen, sonst lokal).
export async function loadSummaries(ids, { force = false } = {}) {
  if (!isShared()) {
    for (const id of ids) summaries.set(id, localSummary(id));
    return;
  }
  const missing = force ? ids.slice() : ids.filter(id => !summaries.has(id));
  for (let i = 0; i < missing.length; i += 300) {
    const chunk = missing.slice(i, i + 300);
    const data = await rpc('place_data', { p_ids: chunk, p_secret: deviceSecret() });
    const prices = new Map(chunk.map(id => [id, []]));
    for (const p of data.prices || []) {
      prices.get(p.place_id)?.push({ id: p.id, beer: p.beer, price: Number(p.price), unit: p.unit, created_at: new Date(p.created_at).getTime(), mine: !!p.mine });
    }
    const ratings = new Map((data.ratings || []).map(r => [r.place_id, { avg: Number(r.avg), count: Number(r.count), mine: r.mine ?? null }]));
    for (const id of chunk) summaries.set(id, summarize(prices.get(id), ratings.get(id)));
  }
}

export async function submitPrice(placeId, { beer, price, unit }) {
  const v = validatePrice(price, unit, beer);
  if (!v.ok) throw new Error(v.message);
  if (isShared()) {
    await rpc('submit_price', { p_place_id: placeId, p_beer: beer.trim(), p_price: v.price, p_unit: unit, p_secret: deviceSecret() });
    await loadSummaries([placeId], { force: true });
  } else {
    const db = loadLocal();
    const r = db[placeId] || (db[placeId] = { prices: [], myRating: null });
    r.prices.push({ id: `l${Date.now()}`, beer: beer.trim(), price: v.price, unit, created_at: Date.now(), mine: true });
    saveLocal();
    summaries.set(placeId, localSummary(placeId));
  }
  return getSummary(placeId);
}

export async function deletePrice(placeId, priceId) {
  if (isShared()) {
    await rpc('delete_price', { p_id: priceId, p_secret: deviceSecret() });
    await loadSummaries([placeId], { force: true });
  } else {
    const r = loadLocal()[placeId];
    if (r) { r.prices = r.prices.filter(p => p.id !== priceId); saveLocal(); }
    summaries.set(placeId, localSummary(placeId));
  }
  return getSummary(placeId);
}

// stars = 1..5 oder null (Bewertung zurücknehmen)
export async function setRating(placeId, stars) {
  if (isShared()) {
    await rpc('set_rating', { p_place_id: placeId, p_stars: stars, p_secret: deviceSecret() });
    await loadSummaries([placeId], { force: true });
  } else {
    const db = loadLocal();
    const r = db[placeId] || (db[placeId] = { prices: [], myRating: null });
    r.myRating = stars;
    saveLocal();
    summaries.set(placeId, localSummary(placeId));
  }
  return getSummary(placeId);
}

// Einmalig: lokal gemeldete Preise in die geteilte Datenbank hochladen.
export async function migrateLocalToShared() {
  if (!isShared()) return 0;
  const FLAG = 'bl_migrated_v1';
  if (localStorage.getItem(FLAG)) return 0;
  const db = loadLocal();
  let n = 0;
  for (const [id, r] of Object.entries(db)) {
    for (const p of r.prices.slice(-5)) {
      if (!validatePrice(p.price, p.unit, p.beer).ok) continue;
      try { await rpc('submit_price', { p_place_id: id, p_beer: p.beer, p_price: p.price, p_unit: p.unit, p_secret: deviceSecret() }); n++; }
      catch (e) { /* einzelne Fehler ignorieren */ }
      if (n >= 40) break;
    }
    if (r.myRating) { try { await rpc('set_rating', { p_place_id: id, p_stars: r.myRating, p_secret: deviceSecret() }); } catch (e) { /* egal */ } }
  }
  localStorage.setItem(FLAG, '1');
  return n;
}

export function exportLocalCommunity() { return isShared() ? null : loadLocal(); }
export function importLocalCommunity(data) {
  if (!data || isShared()) return;
  const db = loadLocal();
  for (const [id, r] of Object.entries(data)) {
    const cur = db[id] || (db[id] = { prices: [], myRating: null });
    const known = new Set(cur.prices.map(p => p.id));
    for (const p of r.prices || []) if (!known.has(p.id)) cur.prices.push(p);
    if (r.myRating) cur.myRating = r.myRating;
  }
  saveLocal();
  summaries.clear();
}
