// Persönliche Daten im Browser (localStorage): Vorlieben, Favoriten, ausgeblendete
// Orte, Theme, Promille-Log, letzter Standort. Geteilte Preise/Bewertungen liegen
// in community.js.

const KEYS = {
  prefs: 'bl_prefs_v2',
  personal: 'bl_personal_v2',  // { [placeId]: { favorite, hidden } }
  theme: 'bl_theme_v1',
  bac: 'bl_bac_v2',
  location: 'bl_last_location_v1',
  device: 'bl_device_secret_v1',
  meta: 'bl_sync_meta_v1',     // Zeitstempel für den Geräte-Sync
  diary: 'bl_diary_v1',        // [{ id, t, deleted?, … }]
  watches: 'bl_watches_v1',    // Preisalarme [{ id, q, max05, country }]
};

/* ---------- Änderungen melden (für den Geräte-Sync) ---------- */
const changeListeners = [];
export function onDataChange(fn) { changeListeners.push(fn); }
let silent = false; // beim Einspielen von Sync-Daten keine Rück-Meldung
function changed() { if (!silent) changeListeners.forEach(fn => { try { fn(); } catch (e) { /* egal */ } }); }
const meta = (() => { try { return JSON.parse(localStorage.getItem('bl_sync_meta_v1')) || {}; } catch (e) { return {}; } })();
function touch(section) { meta[section] = Date.now(); write(KEYS.meta, meta); }
const LEGACY = { data: 'bierlocator_data_v1', prefs: 'bierlocator_prefs_v1', theme: 'bierlocator_theme_v1', bac: 'bierlocator_bac_v1' };

function read(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch (e) { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* voll/privat → egal */ }
}

export const DEFAULT_TYPES = ['pub', 'biergarten', 'brewery', 'gasthaus', 'restaurant', 'nightclub', 'fuel', 'supermarket', 'beverages', 'convenience'];
const DEFAULT_PREFS = {
  beerType: '', maxPrice: null, radius: 1000, biergartenPref: false,
  types: DEFAULT_TYPES, sort: 'recommended', onlyOpen: false, onlyPrice: false, onlyFav: false,
  tour: { roundtrip: true, km: 15, stops: 4, style: 'trekking', dwell: 30, shops: false },
  country: null,
};

export const prefs = Object.assign({}, DEFAULT_PREFS, read(KEYS.prefs, null) || migratePrefs());
prefs.tour = Object.assign({}, DEFAULT_PREFS.tour, prefs.tour);
// Neu hinzugekommene Ortstypen bei bestehenden Profilen einmalig aktivieren
prefs.knownTypes = prefs.knownTypes || ['pub', 'biergarten', 'brewery', 'restaurant', 'fastfood', 'nightclub', 'fuel', 'supermarket', 'beverages', 'convenience'];
for (const t of DEFAULT_TYPES) if (!prefs.knownTypes.includes(t)) { prefs.knownTypes.push(t); if (!prefs.types.includes(t)) prefs.types.push(t); }
export function savePrefs() { write(KEYS.prefs, prefs); touch('prefs'); changed(); }

function migratePrefs() {
  const old = read(LEGACY.prefs, null);
  if (!old) return {};
  return { beerType: old.beerType || '', maxPrice: old.maxPrice ?? null, radius: old.radius || 1000, biergartenPref: !!old.biergartenPref };
}

/* ---------- Favoriten & Ausblenden ---------- */
const personal = read(KEYS.personal, null) || migratePersonal();
function migratePersonal() {
  const old = read(LEGACY.data, {});
  const out = {};
  for (const [id, rec] of Object.entries(old)) {
    if (rec.favorite || rec.hidden) out[id] = { favorite: !!rec.favorite, hidden: !!rec.hidden };
  }
  return out;
}
const rec = id => personal[id] || (personal[id] = { favorite: false, hidden: false });
function savePersonal(id) { if (id) rec(id).t = Date.now(); write(KEYS.personal, personal); changed(); }
export function isFavorite(id) { return !!(personal[id] && personal[id].favorite); }
export function isHidden(id) { return !!(personal[id] && personal[id].hidden); }
export function toggleFavorite(id) { rec(id).favorite = !rec(id).favorite; savePersonal(id); return rec(id).favorite; }
export function setHidden(id, v) { rec(id).hidden = v; savePersonal(id); }
export function hiddenCount() { return Object.values(personal).filter(r => r.hidden).length; }
export function unhideAll() { const t = Date.now(); Object.values(personal).forEach(r => { if (r.hidden) { r.hidden = false; r.t = t; } }); savePersonal(); }
export function favoriteIds() { return Object.keys(personal).filter(id => personal[id].favorite); }

/* ---------- Theme ---------- */
export function loadTheme() { return read(KEYS.theme, null) || (localStorage.getItem(LEGACY.theme) || null); }
export function saveTheme(t) { write(KEYS.theme, t); }

/* ---------- Promille ---------- */
export function loadBac() {
  const v = read(KEYS.bac, null);
  if (v) return v;
  const old = read(LEGACY.bac, null);
  return {
    profile: { sex: old && old.profile && old.profile.r < 0.6 ? 'f' : 'm', weight: (old && old.profile && old.profile.weight) || 75, height: 178, age: 30, food: 'snack' },
    log: [],
  };
}
export function saveBac(state) { write(KEYS.bac, state); touch('bac'); changed(); }

/* ---------- Bier-Tagebuch ---------- */
export function loadDiary() { return read(KEYS.diary, []); }
export function saveDiary(list) { write(KEYS.diary, list); changed(); }

/* ---------- Preisalarme ---------- */
export function loadWatches() { return read(KEYS.watches, []); }
export function saveWatches(list) { write(KEYS.watches, list); touch('watches'); changed(); }

/* ---------- Geräte-Sync: Export & Zusammenführen ----------
   Favoriten/Ausgeblendet: pro Ort gewinnt der neuere Eintrag. Tagebuch: Einträge
   werden vereinigt (Löschungen als "deleted" mit Zeitstempel). Vorlieben,
   Promille und Preisalarme: der neuere Stand gewinnt als Ganzes. */
export function exportSync() {
  return {
    v: 1,
    prefs: { t: meta.prefs || 0, data: prefs },
    personal,
    bac: { t: meta.bac || 0, data: loadBac() },
    diary: loadDiary(),
    watches: { t: meta.watches || 0, data: loadWatches() },
  };
}
export function importSync(remote) {
  if (!remote || remote.v !== 1) return false;
  let localChanged = false;
  silent = true;
  try {
    if (remote.prefs && remote.prefs.t > (meta.prefs || 0)) {
      Object.assign(prefs, remote.prefs.data); write(KEYS.prefs, prefs); meta.prefs = remote.prefs.t; localChanged = true;
    }
    for (const [id, r] of Object.entries(remote.personal || {})) {
      const mine = personal[id];
      if (!mine || (r.t || 0) > (mine.t || 0)) { personal[id] = r; localChanged = true; }
    }
    write(KEYS.personal, personal);
    if (remote.bac && remote.bac.t > (meta.bac || 0)) {
      write(KEYS.bac, remote.bac.data); meta.bac = remote.bac.t; localChanged = true;
    }
    if (remote.watches && remote.watches.t > (meta.watches || 0)) {
      write(KEYS.watches, remote.watches.data); meta.watches = remote.watches.t; localChanged = true;
    }
    const diary = loadDiary();
    const byId = new Map(diary.map(e => [e.id, e]));
    for (const e of remote.diary || []) {
      const mine = byId.get(e.id);
      if (!mine || (e.t || 0) > (mine.t || 0)) { byId.set(e.id, e); localChanged = true; }
    }
    write(KEYS.diary, [...byId.values()].sort((a, b) => b.at - a.at));
    write(KEYS.meta, meta);
  } finally {
    silent = false;
  }
  return localChanged;
}

/* ---------- Letzter Standort ---------- */
export function loadLastLocation() { return read(KEYS.location, null); }
export function saveLastLocation(loc) { write(KEYS.location, loc); }

/* ---------- Anonyme Geräte-ID (für "eine Bewertung pro Gerät") ---------- */
export function deviceSecret() {
  let s = read(KEYS.device, null);
  if (!s) {
    s = (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')) + '-' + Date.now().toString(36);
    write(KEYS.device, s);
  }
  return s;
}

/* ---------- Export / Import ---------- */
export function exportBundle(extra = {}) {
  return { app: 'bier-locator', version: 2, exportedAt: new Date().toISOString(), prefs, personal, bac: loadBac(), ...extra };
}
export function importBundle(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Keine gültige Datei');
  if (payload.version === 2) {
    if (payload.prefs) Object.assign(prefs, payload.prefs);
    if (payload.personal) Object.assign(personal, payload.personal);
    if (payload.bac) saveBac(payload.bac);
  } else if (payload.localData) {
    // altes Format (v1): Favoriten/Ausgeblendet übernehmen
    for (const [id, r] of Object.entries(payload.localData)) {
      if (r.favorite || r.hidden) personal[id] = { favorite: !!r.favorite, hidden: !!r.hidden };
    }
    const p = payload.prefs;
    if (p) Object.assign(prefs, { beerType: p.beerType || '', maxPrice: p.maxPrice ?? null, radius: p.radius || 1000, biergartenPref: !!p.biergartenPref });
  } else {
    throw new Error('Unbekanntes Format');
  }
  savePrefs();
  write(KEYS.personal, personal);
}

export const LEGACY_DATA_KEY = LEGACY.data;
