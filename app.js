'use strict';

/* ---------- Konfiguration ---------- */
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_BASE = 'https://routing.openstreetmap.de/routed-bike';
const BROUTER_URL = 'https://brouter.de/brouter';
const BROUTER_PROFILE = 'safety'; // bevorzugt Radwege/ruhige Straßen, meidet Hauptstraßen
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const STORAGE_KEY_DATA = 'bierlocator_data_v1';
const STORAGE_KEY_PREFS = 'bierlocator_prefs_v1';
const STORAGE_KEY_THEME = 'bierlocator_theme_v1';
const STORAGE_KEY_BAC = 'bierlocator_bac_v1';
const MAX_PLACES = 250; // Obergrenze gegen Einfrieren bei sehr vielen Treffern

// Getränke-Presets für den Promille-Rechner: Volumen in ml, Alkoholgehalt in %, kcal pro 100ml (Richtwerte)
const DRINK_PRESETS = {
  bier05:    { label: 'Bier 0,5 l',              volume: 500, abv: 5,    kcal100: 43 },
  bier033:   { label: 'Bier 0,33 l',              volume: 330, abv: 5,    kcal100: 43 },
  weizen:    { label: 'Weizenbier 0,5 l',         volume: 500, abv: 5.4,  kcal100: 44 },
  radler:    { label: 'Radler 0,5 l',             volume: 500, abv: 2.5,  kcal100: 21 },
  alkoholfrei: { label: 'Alkoholfreies Bier',     volume: 500, abv: 0,    kcal100: 25 },
  wein:      { label: 'Wein 0,2 l (Achtel/Viertel)', volume: 200, abv: 12, kcal100: 70 },
  sekt:      { label: 'Sekt/Prosecco 0,1 l',      volume: 100, abv: 11,   kcal100: 80 },
  schnaps:   { label: 'Schnaps 2 cl',             volume: 20,  abv: 40,   kcal100: 250 },
  longdrink: { label: 'Longdrink/Cocktail 4 cl Spirituose', volume: 40, abv: 40, kcal100: 250 },
  custom:    { label: 'Eigene Angabe',            volume: 500, abv: 5,    kcal100: 45 },
};

// Rausch-Stadien nach forensischer Faustregel (Promille-Grenzwerte sind Richtwerte, keine exakte Wissenschaft)
const BAC_STAGES = [
  { max: 0.2, name: 'Nüchtern', color: 'good', desc: 'Kaum messbare Wirkung.' },
  { max: 0.5, name: 'Euphorie', color: 'good', desc: 'Enthemmt, gehoben, Reaktionszeit schon leicht verlängert. Für Führerschein-Neulinge & Berufskraftfahrer (0,1‰-Grenze) bereits über dem Limit.' },
  { max: 1.0, name: 'Exzitation', color: 'warn', desc: 'Enthemmung, Konzentrations- und Sehstörungen, Selbstüberschätzung. Über der allgemeinen 0,5‰-Grenze (AT/DE).' },
  { max: 1.5, name: 'Rausch', color: 'warn', desc: 'Deutliche Ausfallerscheinungen: Gleichgewicht, verwaschene Sprache, Reaktionszeit stark verlängert.' },
  { max: 2.0, name: 'Schwerer Rausch', color: 'bad', desc: 'Verwirrtheit, Orientierungslosigkeit, Übelkeit/Erbrechen möglich.' },
  { max: 3.0, name: 'Betäubung', color: 'bad', desc: 'Bewusstseinstrübung, Gedächtnislücken ("Filmriss"), Gleichgewichtsverlust. Ärztliche Hilfe erwägen.' },
  { max: 4.0, name: 'Lähmung', color: 'bad', desc: 'Koma-Gefahr, Unterkühlung, Reflexverlust — lebensgefährlich. Notarzt rufen (144/112).' },
  { max: Infinity, name: 'Akute Lebensgefahr', color: 'bad', desc: 'Gefahr von Atemlähmung. Sofort Notarzt rufen (144/112) und Person nicht allein lassen!' },
];
function bacStageFor(bac) { return BAC_STAGES.find(s => bac <= s.max); }

/* ---------- Icon-System ---------------------------------------------------
 * Ein einziges Set schlichter, strichbasierter SVG-Icons (24x24, currentColor)
 * ersetzt Emoji als Bildsprache — konsistente Strichstärke statt Symbol-Wildwuchs
 * aus unterschiedlichen Schriftarten/Plattform-Renderern.
 * -------------------------------------------------------------------------- */
const ICONS = {
  pin: '<path d="M12 21s-6.5-6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.25"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M19.5 19.5l-4.3-4.3"/>',
  bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M5.5 17.5L10 8h5l3.5 9.5"/><path d="M9 8h4"/><path d="M12 8l2.5 5.5H8"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M9 12h11M4 18h13M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4 2v-8.5z"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 9.5c0-1.1 1-2 2.5-2s2.5.8 2.5 2-1 1.7-2.5 2-2.5.9-2.5 2 1 2 2.5 2 2.5-.9 2.5-2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="18" r="1.1"/>',
  map: '<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z"/><path d="M9 4v14M15 6v14"/>',
  shuffle: '<path d="M3 6h3.5L15 17.5H21M15 6.5h6M17.5 4l3 2.5-3 2.5M3 17.5h3.5L11 11"/><path d="M17.5 20l3-2.5-3-2.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.6 6"/><path d="M20 5v6h-6"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9l-2 6-4 2 2-6z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  tag: '<path d="M11.5 3.5H5a1.5 1.5 0 0 0-1.5 1.5v6.5a1.5 1.5 0 0 0 .44 1.06l8.5 8.5a1.5 1.5 0 0 0 2.12 0l6.44-6.44a1.5 1.5 0 0 0 0-2.12l-8.5-8.5a1.5 1.5 0 0 0-1.06-.44z"/><circle cx="8.2" cy="8.2" r="1.3"/>',
  star: '<path d="M12 4l2.47 5.34 5.53.62-4.2 3.9 1.15 5.64L12 16.7l-4.95 2.8 1.15-5.64-4.2-3.9 5.53-.62z"/>',
  alertTriangle: '<path d="M12 4L2.5 20h19z"/><path d="M12 10.5v4"/><circle cx="12" cy="17.2" r="0.15"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  undo: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v6h6"/>',
  flag: '<path d="M6 21V4"/><path d="M6 5h10.5l-2.3 4 2.3 4H6"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  moon: '<path d="M20 14.2A8.5 8.5 0 1 1 9.8 4a7 7 0 0 0 10.2 10.2z"/>',
  download: '<path d="M12 4v11.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 19.5V8"/><path d="M7.5 12.5L12 8l4.5 4.5"/><path d="M4.5 19.5h15"/>',
  trash: '<path d="M5 7h14"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/><path d="M7 7l1 12.5A1.5 1.5 0 0 0 9.5 21h5a1.5 1.5 0 0 0 1.5-1.5L17 7"/><path d="M10.3 11v6M13.7 11v6"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2.2"/><path d="M7.5 6.5h9v3.5h-9z"/><circle cx="8" cy="14" r="0.9"/><circle cx="12" cy="14" r="0.9"/><circle cx="16" cy="14" r="0.9"/><circle cx="8" cy="17.5" r="0.9"/><circle cx="12" cy="17.5" r="0.9"/><circle cx="16" cy="17.5" r="0.9"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  cloud: '<path d="M7.5 17.5a4 4 0 1 1 .8-7.9 5.2 5.2 0 0 1 10 1.9 3.4 3.4 0 0 1-1 6z"/>',
  cloudRain: '<path d="M7.5 15.5a4 4 0 1 1 .8-7.9 5.2 5.2 0 0 1 10 1.9 3.4 3.4 0 0 1-1 6z"/><path d="M9 19l-1 2.5M13 19l-1 2.5M17 19l-1 2.5"/>',
  cloudSnow: '<path d="M7.5 14.5a4 4 0 1 1 .8-7.9 5.2 5.2 0 0 1 10 1.9 3.4 3.4 0 0 1-1 6z"/><circle cx="9" cy="19.5" r="0.4"/><circle cx="13" cy="19.5" r="0.4"/><circle cx="17" cy="19.5" r="0.4"/>',
  cloudStorm: '<path d="M7.5 14.5a4 4 0 1 1 .8-7.9 5.2 5.2 0 0 1 10 1.9 3.4 3.4 0 0 1-1 6z"/><path d="M13 16.5l-2.5 4h3l-2 3.5"/>',
  fog: '<path d="M4 9h13M4 13h16M6 17h12M4 21h16" opacity="0" /><path d="M6.5 9.5h11M4 13.5h16M7 17.5h10"/>',
  thermometer: '<path d="M12 4a2 2 0 0 1 2 2v8.3a4 4 0 1 1-4 0V6a2 2 0 0 1 2-2z"/><path d="M12 9v5.5"/>',
  flame: '<path d="M12 3s5 4.5 5 9.5a5 5 0 1 1-10 0c0-1 .3-2 1-3 0 1.3 1 2 1 2-.3-3 1-4.5 3-6.5-.5 2-.3 3.3.5 4.5.7-1 .5-2.2-.5-6.5z"/>',
  activity: '<path d="M3 12h4l2.2-7L13 19l2.5-7H21"/>',
  droplet: '<path d="M12 3.5s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11z"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.6 2.6L16 9.5"/>',
  beerMug: '<path d="M6.5 8h9v11a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2z"/><path d="M15.5 10.5h1.8A1.7 1.7 0 0 1 19 12.2v2.6a1.7 1.7 0 0 1-1.7 1.7h-1.8"/><path d="M8.5 5v3M11.2 4v4M13.8 5v3"/>',
  tree: '<path d="M12 3l4.5 7h-2.6L17.5 16H6.5l3.6-6H7.5z"/><path d="M12 16v5"/>',
  utensils: '<path d="M8 3v6a2 2 0 0 0 4 0V3M10 9v12M6 3v5M6 3v0M14.5 3c-1.4 0-2.5 1.8-2.5 4.5S13.1 12 14.5 12M14.5 3v18"/>',
  sandwich: '<path d="M4 11.5h16L18 17H6z"/><path d="M4 11.5c0-4 3.6-7 8-7s8 3 8 7"/><path d="M5 14.2h14"/>',
  disc: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/>',
  fuel: '<path d="M5 21V6.5A2 2 0 0 1 7 4.5h4a2 2 0 0 1 2 2V21"/><path d="M3.5 21h11"/><path d="M13 10.5h1.8l2.7 2.7v4.3a1.5 1.5 0 0 1-3 0v-1.8h-1.5"/>',
  cart: '<circle cx="9.5" cy="20" r="1.1"/><circle cx="17" cy="20" r="1.1"/><path d="M3 4h2.2l2 11h10.9L20 8.5H7"/>',
  box: '<path d="M3.5 8L12 3.5 20.5 8 12 12.5z"/><path d="M3.5 8v8.5L12 21l8.5-4.5V8"/><path d="M12 12.5V21"/>',
  store: '<path d="M4 9.5V20h16V9.5"/><path d="M3 9.5l1.3-5h15.4l1.3 5z"/><path d="M9.5 20v-5.5h5V20"/>',
};
function icon(name, opts) {
  opts = opts || {};
  const size = opts.size || 18;
  const cls = 'icon' + (opts.className ? ' ' + opts.className : '');
  const body = ICONS[name] || '';
  const fill = opts.filled ? 'currentColor' : 'none';
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
function hydrateIcons(root) {
  (root || document).querySelectorAll('[data-icon]').forEach(el => {
    const size = el.dataset.iconSize ? parseInt(el.dataset.iconSize, 10) : 18;
    el.innerHTML = icon(el.dataset.icon, { size, filled: el.dataset.iconFilled === 'true' });
  });
}

const TYPE_META = {
  pub:         { label: 'Kneipe/Bar',    icon: 'beerMug' },
  biergarten:  { label: 'Biergarten',    icon: 'tree' },
  restaurant:  { label: 'Restaurant',    icon: 'utensils' },
  fastfood:    { label: 'Imbiss',        icon: 'sandwich' },
  nightclub:   { label: 'Club/Disco',    icon: 'disc' },
  fuel:        { label: 'Tankstelle',    icon: 'fuel' },
  supermarket: { label: 'Supermarkt',    icon: 'cart' },
  beverages:   { label: 'Getränkemarkt', icon: 'box' },
  convenience: { label: 'Kiosk',         icon: 'store' },
};
// Mapping von OSM-Tags auf unsere internen Typen
const OSM_TAG_TO_TYPE = {
  'amenity=bar': 'pub',
  'amenity=pub': 'pub',
  'amenity=biergarten': 'biergarten',
  'amenity=restaurant': 'restaurant',
  'amenity=fast_food': 'fastfood',
  'amenity=nightclub': 'nightclub',
  'amenity=fuel': 'fuel',
  'shop=supermarket': 'supermarket',
  'shop=beverages': 'beverages',
  'shop=alcohol': 'beverages',
  'shop=convenience': 'convenience',
};

// Umrechnung diverser Gebindegrößen auf Preis pro 0,5l zum fairen Vergleich
const UNIT_TO_HALF_LITER = {
  '0.33l': 0.33 / 0.5,
  '0.5l': 1,
  '1l': 1 / 0.5,
  'kasten20x0.5l': 1 / 20,
  'kasten24x0.33l': 1 / (24 * 0.33 / 0.5),
};
const UNIT_LABELS = {
  '0.33l': '0,33 l Flasche/Glas',
  '0.5l': '0,5 l Flasche/Glas',
  '1l': '1 l (Maß)',
  'kasten20x0.5l': 'Kasten 20×0,5 l',
  'kasten24x0.33l': 'Kasten 24×0,33 l',
};

/* ---------- State ---------- */
let map, markerLayer, routeLayer;
let userLocation = null; // {lat, lon}
let allPlaces = [];       // rohe Orte aus Overpass, angereichert mit lokalen Daten
let localData = loadLocalData();
let prefs = loadPrefs();
let activeMarkers = {};
let lastWeather = null;
let currentTour = null;      // { orderedStops, legs, start, endPoint, distance, duration }
let lastTourParams = null;   // { pool, start, endPoint, desiredKm, minStops } — für "Andere Route würfeln"
let bacState = loadBac();    // { profile: {weight, r}, log: [{presetKey,label,volume,abv,kcal100,qty,timestamp}] }
let bacTickInterval = null;

/* ---------- Persistence ---------- */
function loadLocalData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DATA);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function saveLocalData() {
  localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(localData));
}
function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFS);
    return raw ? JSON.parse(raw) : { beerType: '', maxPrice: null, radius: 1000, biergartenPref: false };
  } catch (e) { return { beerType: '', maxPrice: null, radius: 1000, biergartenPref: false }; }
}
function savePrefs() {
  localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(prefs));
}
function getPlaceRecord(id) {
  if (!localData[id]) localData[id] = { prices: [], ratings: [], favorite: false, hidden: false };
  return localData[id];
}
function countHiddenPlaces() {
  return Object.values(localData).filter(r => r.hidden).length;
}
function loadBac() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BAC);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { profile: { weight: 75, r: 0.68 }, log: [] };
}
function saveBac() {
  localStorage.setItem(STORAGE_KEY_BAC, JSON.stringify(bacState));
}

/* ---------- Utilities ---------- */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function fmtDist(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
function fmtDuration(seconds) {
  if (seconds < 60) return '< 1 Min';
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return h > 0 ? `${h} Std ${min} Min` : `${min} Min`;
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'vor 1 Tag';
  if (days < 30) return `vor ${days} Tagen`;
  const months = Math.floor(days / 30);
  if (months < 12) return `vor ${months} Monat(en)`;
  return `vor ${Math.floor(months / 12)} Jahr(en)`;
}
function showToast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, ms);
}
function cheapestPriceForPlace(place) {
  const rec = getPlaceRecord(place.id);
  if (!rec.prices.length) return null;
  let best = null;
  for (const p of rec.prices) {
    const factor = UNIT_TO_HALF_LITER[p.unit] || 1;
    const per05 = p.price / factor;
    if (!best || per05 < best.per05) best = { ...p, per05 };
  }
  return best;
}
function avgRating(place) {
  const rec = getPlaceRecord(place.id);
  if (!rec.ratings.length) return null;
  return rec.ratings.reduce((a, b) => a + b, 0) / rec.ratings.length;
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Öffnungszeiten (Best-Effort-Schätzung) ---------- */
const OH_DAY_INDEX = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };
function expandOhDays(dayPart) {
  const days = new Set();
  for (const token of dayPart.split(',')) {
    if (token.includes('-')) {
      const [a, b] = token.split('-');
      const ai = OH_DAY_INDEX[a], bi = OH_DAY_INDEX[b];
      if (ai == null || bi == null) continue;
      for (let i = ai; ; i = (i + 1) % 7) {
        days.add(i);
        if (i === bi) break;
      }
    } else if (OH_DAY_INDEX[token] != null) {
      days.add(OH_DAY_INDEX[token]);
    }
  }
  return days.size ? days : null;
}
function isOpenNow(openingHours) {
  if (!openingHours) return null;
  if (/24\/7/i.test(openingHours)) return true;
  const now = new Date();
  const nowIso = (now.getDay() + 6) % 7; // Mo=0..Su=6
  const prevIso = (nowIso + 6) % 7;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const segments = openingHours.split(';').map(s => s.trim()).filter(Boolean);
  let matchedAnySegment = false;
  for (const seg of segments) {
    const m = seg.match(/^([A-Za-z,\-]+)\s+(.+)$/);
    if (!m) continue;
    if (/off|closed/i.test(m[2])) continue;
    const days = expandOhDays(m[1]);
    if (!days) continue;
    for (const tr of m[2].split(',').map(s => s.trim())) {
      const tm = tr.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!tm) continue;
      matchedAnySegment = true;
      const startMin = (+tm[1]) * 60 + (+tm[2]);
      let endMin = (+tm[3]) * 60 + (+tm[4]);
      const spansMidnight = endMin <= startMin;
      if (spansMidnight) endMin += 24 * 60;
      if (days.has(nowIso)) {
        if (!spansMidnight && nowMin >= startMin && nowMin < endMin) return true;
        if (spansMidnight && nowMin >= startMin) return true;
      }
      if (spansMidnight && days.has(prevIso) && nowMin < (endMin - 24 * 60)) return true;
    }
  }
  return matchedAnySegment ? false : null;
}

/* ---------- Wetter (open-meteo, kein API-Key nötig) ---------- */
function weatherIconName(code) {
  if (code === 0) return 'sun';
  if ([1, 2, 3].includes(code)) return 'cloud';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'cloudRain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'cloudSnow';
  if ([95, 96, 99].includes(code)) return 'cloudStorm';
  return 'thermometer';
}
function isGoodBiergartenWeather(cw) {
  return cw && cw.temperature >= 18 && [0, 1, 2, 3].includes(cw.weathercode);
}
function isRainy(cw) {
  return cw && cw.weathercode >= 51;
}
async function fetchWeather(lat, lon) {
  try {
    const url = `${OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.current_weather) return;
    lastWeather = data.current_weather;
    const el = document.getElementById('weatherBadge');
    let extra = '';
    if (isGoodBiergartenWeather(lastWeather)) extra = ' — gutes Biergartenwetter';
    else if (isRainy(lastWeather)) extra = ' — eher drinnen bleiben';
    el.hidden = false;
    el.innerHTML = `${icon(weatherIconName(lastWeather.weathercode), { size: 16 })} ${Math.round(lastWeather.temperature)}°C${extra}`;
    renderAll();
  } catch (e) { /* Wetter ist nur ein Bonus, Fehler hier sind unkritisch */ }
}

/* ---------- Map ---------- */
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([51.1657, 10.4515], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende'
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
}

/* ---------- Standort & Geocoding ---------- */
async function geocode(query) {
  const url = `${NOMINATIM_URL}?format=json&q=${encodeURIComponent(query)}&limit=1`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), label: data[0].display_name };
}

function geolocate() {
  const status = document.getElementById('locationStatus');
  if (!navigator.geolocation) {
    status.textContent = 'Geolocation wird von diesem Browser nicht unterstützt.';
    return;
  }
  status.textContent = 'Standort wird ermittelt…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      status.textContent = `Standort gefunden (±${Math.round(pos.coords.accuracy)} m).`;
      map.setView([userLocation.lat, userLocation.lon], 15);
      L.marker([userLocation.lat, userLocation.lon], { title: 'Du bist hier' })
        .addTo(map).bindPopup('Dein Standort');
      searchNearby();
      fetchWeather(userLocation.lat, userLocation.lon);
    },
    err => {
      status.textContent = `Standort nicht verfügbar (${err.message}). Bitte Adresse eingeben oder über HTTPS/localhost öffnen.`;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function searchAddress() {
  const q = document.getElementById('addressInput').value.trim();
  const status = document.getElementById('locationStatus');
  if (!q) return;
  status.textContent = 'Adresse wird gesucht…';
  try {
    const geo = await geocode(q);
    if (!geo) {
      status.textContent = 'Adresse nicht gefunden.';
      return;
    }
    userLocation = { lat: geo.lat, lon: geo.lon };
    status.textContent = `Standort: ${geo.label}`;
    map.setView([userLocation.lat, userLocation.lon], 15);
    searchNearby();
    fetchWeather(userLocation.lat, userLocation.lon);
  } catch (e) {
    status.textContent = 'Fehler bei der Adresssuche: ' + e.message;
  }
}

/* ---------- Overpass-Abfrage ---------- */
function buildOverpassQuery(lat, lon, radius) {
  return `[out:json][timeout:25];
(
  node["amenity"~"^(bar|pub|biergarten|restaurant|fast_food|nightclub|fuel)$"](around:${radius},${lat},${lon});
  way["amenity"~"^(bar|pub|biergarten|restaurant|fast_food|nightclub|fuel)$"](around:${radius},${lat},${lon});
  node["shop"~"^(alcohol|beverages|supermarket|convenience)$"](around:${radius},${lat},${lon});
  way["shop"~"^(alcohol|beverages|supermarket|convenience)$"](around:${radius},${lat},${lon});
);
out center tags;`;
}

function classify(tags) {
  for (const key of ['amenity', 'shop']) {
    if (tags[key] && OSM_TAG_TO_TYPE[`${key}=${tags[key]}`]) {
      return OSM_TAG_TO_TYPE[`${key}=${tags[key]}`];
    }
  }
  return null;
}

async function fetchOverpass(query, attempt = 1) {
  const res = await fetch(OVERPASS_URL, { method: 'POST', body: 'data=' + encodeURIComponent(query) });
  if (!res.ok) {
    if ((res.status === 504 || res.status === 429) && attempt < 3) {
      await sleep(1500 * attempt);
      return fetchOverpass(query, attempt + 1);
    }
    throw new Error('Overpass-Antwort: ' + res.status);
  }
  return res.json();
}

// Generische Ortssuche: liefert rohe, angereicherte Orte zurück, ohne globalen State zu verändern.
async function fetchPlacesNear(centerLat, centerLon, radius, refLat = centerLat, refLon = centerLon) {
  const query = buildOverpassQuery(centerLat, centerLon, radius);
  const data = await fetchOverpass(query);
  return (data.elements || []).map(el => {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const type = classify(el.tags || {});
    if (lat == null || lon == null || !type) return null;
    return {
      id: `${el.type}/${el.id}`,
      type,
      name: el.tags.name || TYPE_META[type].label,
      lat, lon,
      tags: el.tags || {},
      distance: haversine(refLat, refLon, lat, lon),
    };
  }).filter(Boolean);
}

function mergeIntoAllPlaces(newPlaces) {
  const existing = new Set(allPlaces.map(p => p.id));
  for (const p of newPlaces) {
    if (!existing.has(p.id)) { allPlaces.push(p); existing.add(p.id); }
  }
}

async function searchNearby() {
  if (!userLocation) {
    showToast('Bitte zuerst einen Standort festlegen.');
    return;
  }
  const status = document.getElementById('locationStatus');
  status.textContent = 'Orte werden geladen… (der öffentliche Kartenserver ist manchmal etwas langsam)';
  const radius = prefs.radius || 1000;
  try {
    const parsed = await fetchPlacesNear(userLocation.lat, userLocation.lon, radius);
    // Bei sehr vielen Treffern (großer Umkreis in dichter Stadt) nur die
    // nächsten MAX_PLACES behalten, sonst friert die Karte beim Rendern ein.
    parsed.sort((a, b) => a.distance - b.distance);
    const truncated = parsed.length > MAX_PLACES;
    allPlaces = parsed.slice(0, MAX_PLACES);
    status.textContent = truncated
      ? `${allPlaces.length} von ${parsed.length} gefundenen Orten angezeigt (nächstgelegene) — verkleinere den Umkreis für ein vollständiges Bild.`
      : `${allPlaces.length} Orte gefunden.`;
    renderAll();
  } catch (e) {
    status.textContent = 'Fehler beim Laden der Orte: ' + e.message;
    showToast('Konnte Orte nicht laden (Overpass-API nicht erreichbar?).');
  }
}

/* ---------- Filter, Sortierung, Empfehlung ---------- */
function getActiveTypeFilters() {
  return Array.from(document.querySelectorAll('#typeFilters input:checked')).map(el => el.value);
}
function recommendationScore(place) {
  let score = 0;
  const maxRadius = prefs.radius || 1000;
  score += (1 - Math.min(place.distance / maxRadius, 1)) * 40; // näher = besser

  const cheapest = cheapestPriceForPlace(place);
  if (cheapest) {
    if (prefs.maxPrice) {
      score += cheapest.per05 <= prefs.maxPrice ? 25 : -15;
    } else {
      score += 10;
    }
    if (prefs.beerType && cheapest.beerType.toLowerCase().includes(prefs.beerType.toLowerCase())) {
      score += 20;
    }
  }
  const rec = getPlaceRecord(place.id);
  if (rec.prices.some(p => prefs.beerType && p.beerType.toLowerCase().includes(prefs.beerType.toLowerCase()))) {
    score += 15;
  }
  const rating = avgRating(place);
  if (rating) score += rating * 4;
  if (place.type === 'biergarten') {
    if (prefs.biergartenPref) score += 15;
    if (lastWeather) {
      if (isGoodBiergartenWeather(lastWeather)) score += 10;
      else if (isRainy(lastWeather)) score -= 20;
    }
  }
  if (rec.favorite) score += 10;
  return score;
}

function filterAndSortPlaces() {
  const activeTypes = new Set(getActiveTypeFilters());
  const beerFilter = document.getElementById('filterBeerType').value.trim().toLowerCase();
  const onlyWithPrice = document.getElementById('onlyWithPrice').checked;
  const onlyFavorites = document.getElementById('onlyFavorites').checked;
  const sortBy = document.getElementById('sortSelect').value;

  let list = allPlaces.filter(p => activeTypes.has(p.type) && !getPlaceRecord(p.id).hidden);

  if (beerFilter) {
    list = list.filter(p => getPlaceRecord(p.id).prices.some(pr => pr.beerType.toLowerCase().includes(beerFilter)));
  }
  if (onlyWithPrice) {
    list = list.filter(p => getPlaceRecord(p.id).prices.length > 0);
  }
  if (onlyFavorites) {
    list = list.filter(p => getPlaceRecord(p.id).favorite);
  }

  list = list.slice();
  if (sortBy === 'distance') {
    list.sort((a, b) => a.distance - b.distance);
  } else if (sortBy === 'price') {
    list.sort((a, b) => {
      const pa = cheapestPriceForPlace(a), pb = cheapestPriceForPlace(b);
      if (!pa && !pb) return a.distance - b.distance;
      if (!pa) return 1;
      if (!pb) return -1;
      return pa.per05 - pb.per05;
    });
  } else if (sortBy === 'rating') {
    list.sort((a, b) => (avgRating(b) || 0) - (avgRating(a) || 0));
  } else {
    list.sort((a, b) => recommendationScore(b) - recommendationScore(a));
  }
  return list;
}

/* ---------- Rendering: Orte finden ---------- */
function renderAll() {
  const list = filterAndSortPlaces();
  renderMarkers(list);
  renderList(list);
  renderCheapest(list);
  renderHiddenPlacesRow();
}

function renderHiddenPlacesRow() {
  const count = countHiddenPlaces();
  const row = document.getElementById('hiddenPlacesRow');
  row.hidden = count === 0;
  document.getElementById('hiddenPlacesCount').textContent = count;
}

function renderMarkers(list) {
  markerLayer.clearLayers();
  activeMarkers = {};
  for (const place of list) {
    const cheapest = cheapestPriceForPlace(place);
    const marker = L.marker([place.lat, place.lon]).addTo(markerLayer);
    marker.bindPopup(popupHtml(place, cheapest));
    marker.on('click', () => openDetail(place.id));
    activeMarkers[place.id] = marker;
  }
}

function popupHtml(place, cheapest) {
  const meta = TYPE_META[place.type];
  let html = `<div style="display:flex;align-items:center;gap:6px"><span style="color:var(--accent-dark)">${icon(meta.icon, { size: 15 })}</span><b>${escapeHtml(place.name)}</b></div>${meta.label} · ${fmtDist(place.distance)}`;
  if (cheapest) html += `<br><b style="color:var(--good)">${cheapest.per05.toFixed(2)} € / 0,5l</b> (${escapeHtml(cheapest.beerType)})`;
  return html;
}

function renderList(list) {
  document.getElementById('resultCount').textContent = list.length;
  const container = document.getElementById('resultsList');
  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<div class="hint">Keine Orte gefunden. Standort festlegen und "Orte in der Nähe suchen" klicken.</div>';
    return;
  }
  for (const place of list) {
    const meta = TYPE_META[place.type];
    const rec = getPlaceRecord(place.id);
    const cheapest = cheapestPriceForPlace(place);
    const rating = avgRating(place);
    const card = document.createElement('div');
    card.className = 'place-card';
    card.innerHTML = `
      <div class="pc-top">
        <span class="pc-name">
          <span class="pc-type-icon">${icon(meta.icon, { size: 16 })}</span>
          ${escapeHtml(place.name)}
          ${rec.favorite ? `<span class="pc-star">${icon('star', { size: 13, filled: true })}</span>` : ''}
        </span>
        <span class="pc-dist">${fmtDist(place.distance)}</span>
      </div>
      <div class="pc-meta">
        <span class="badge">${meta.label}</span>
        ${rating ? `<span class="badge badge-rating">${icon('star', { size: 11, filled: true })} ${rating.toFixed(1)}</span>` : ''}
        ${cheapest ? `<span class="pc-price">${cheapest.per05.toFixed(2)} €/0,5l</span> · ${escapeHtml(cheapest.beerType)}` : '<span class="hint" style="display:inline">Kein Preis gemeldet</span>'}
      </div>
    `;
    card.addEventListener('click', () => openDetail(place.id));
    container.appendChild(card);
  }
}

function renderCheapest(list) {
  const panel = document.getElementById('cheapestPanel');
  const withPrice = list.map(p => ({ p, c: cheapestPriceForPlace(p) })).filter(x => x.c);
  if (!withPrice.length) { panel.hidden = true; return; }
  withPrice.sort((a, b) => a.c.per05 - b.c.per05);
  const best = withPrice[0];
  panel.hidden = false;
  document.getElementById('cheapestBox').innerHTML = `
    <div class="cb-price">${best.c.per05.toFixed(2)} € / 0,5l</div>
    <div>${escapeHtml(best.c.beerType)} bei <b>${escapeHtml(best.p.name)}</b></div>
    <div class="hint">${fmtDist(best.p.distance)} entfernt · gemeldet ${timeAgo(best.c.reportedAt)}</div>
  `;
}

/* ---------- Detailansicht ---------- */
function osmEditUrl(placeId) {
  const [type, id] = placeId.split('/');
  return `https://www.openstreetmap.org/edit?${type}=${id}`;
}

function openDetail(placeId) {
  const place = allPlaces.find(p => p.id === placeId);
  if (!place) return;
  const rec = getPlaceRecord(place.id);
  const meta = TYPE_META[place.type];
  const rating = avgRating(place);
  const addr = [place.tags['addr:street'], place.tags['addr:housenumber']].filter(Boolean).join(' ') +
    (place.tags['addr:city'] ? `, ${place.tags['addr:city']}` : '');
  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`;

  const openState = isOpenNow(place.tags.opening_hours);
  let openBadge = '';
  if (openState === true) openBadge = `<span class="badge badge-open"><span class="status-dot"></span> Jetzt geöffnet (geschätzt)</span>`;
  else if (openState === false) openBadge = `<span class="badge badge-closed"><span class="status-dot"></span> Jetzt geschlossen (geschätzt)</span>`;

  const pricesHtml = rec.prices.length
    ? rec.prices.slice().sort((a, b) => b.reportedAt - a.reportedAt).map((p) => `
      <div class="price-entry">
        <span>${escapeHtml(p.beerType)} — <b>${p.price.toFixed(2)} €</b> (${UNIT_LABELS[p.unit] || p.unit})</span>
        <span class="pe-age">${timeAgo(p.reportedAt)}</span>
      </div>
    `).join('')
    : '<div class="hint">Noch keine Preise gemeldet. Sei der/die Erste!</div>';

  const unitOptions = Object.entries(UNIT_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  document.getElementById('detailContent').innerHTML = `
    <h3>
      <span class="detail-type-icon">${icon(meta.icon, { size: 22 })}</span>
      ${escapeHtml(place.name)}
      <button class="fav-toggle" id="favToggle" aria-label="Favorit" title="Als Favorit markieren">${icon('star', { size: 20, filled: rec.favorite })}</button>
    </h3>
    <div class="hint">${meta.label}${addr ? ' · ' + escapeHtml(addr) : ''} · ${fmtDist(place.distance)} entfernt</div>
    ${openBadge ? `<div style="margin-top:6px">${openBadge}</div>` : ''}
    ${place.tags.opening_hours ? `<div class="hint icon-row">${icon('clock', { size: 13 })} ${escapeHtml(place.tags.opening_hours)}</div>` : ''}
    <a class="detail-link" href="${gmapsUrl}" target="_blank" rel="noopener">${icon('compass', { size: 15 })} Route in Google Maps öffnen</a>

    <div class="detail-section">
      <h4>${icon('star', { size: 14 })} Bewertung ${rating ? `<span class="detail-section-meta">Ø ${rating.toFixed(1)} aus ${rec.ratings.length}</span>` : ''}</h4>
      <div class="stars" id="starInput">${[1, 2, 3, 4, 5].map(n => `<span data-n="${n}">${icon('star', { size: 22, className: 'star-input-icon' })}</span>`).join('')}</div>
    </div>

    <div class="detail-section">
      <h4>${icon('tag', { size: 14 })} Gemeldete Preise <span class="detail-section-meta">crowdsourced</span></h4>
      ${pricesHtml}
      <form class="add-price-form" id="addPriceForm">
        <input type="text" name="beerType" placeholder="Biersorte (z.B. Pils)" required>
        <input type="number" name="price" placeholder="Preis €" min="0" step="0.01" required>
        <select name="unit">${unitOptions}</select>
        <button type="submit" class="btn-secondary">Preis melden</button>
      </form>
    </div>

    <div class="detail-section">
      <h4>${icon('alertTriangle', { size: 14 })} Daten stimmen nicht?</h4>
      <div class="hint">Diese Karte basiert auf OpenStreetMap — falsche, veraltete oder fehlende Einträge lassen sich dort direkt für alle korrigieren.</div>
      <div class="row" style="margin-top:8px">
        <a href="${osmEditUrl(place.id)}" target="_blank" rel="noopener" class="btn-secondary btn-icon-label" style="flex:1">${icon('edit', { size: 15 })} Bei OpenStreetMap korrigieren</a>
      </div>
      <button id="btnHidePlace" class="btn-secondary full btn-icon-label" style="margin-top:6px">${icon(rec.hidden ? 'undo' : 'flag', { size: 15 })} ${rec.hidden ? 'Wieder einblenden' : 'Als falsch/geschlossen melden'}</button>
    </div>
  `;

  document.getElementById('favToggle').onclick = () => {
    rec.favorite = !rec.favorite;
    saveLocalData();
    openDetail(placeId);
    renderAll();
  };
  document.getElementById('btnHidePlace').onclick = () => {
    rec.hidden = !rec.hidden;
    saveLocalData();
    renderAll();
    if (rec.hidden) {
      showToast('Danke für den Hinweis — Ort ausgeblendet.');
      document.getElementById('detailOverlay').hidden = true;
    } else {
      showToast('Wieder eingeblendet.');
      openDetail(placeId);
    }
  };
  document.querySelectorAll('#starInput span').forEach(el => {
    el.onclick = () => {
      rec.ratings.push(parseInt(el.dataset.n, 10));
      saveLocalData();
      openDetail(placeId);
      renderAll();
      showToast('Danke für deine Bewertung!');
    };
  });
  document.getElementById('addPriceForm').onsubmit = (ev) => {
    ev.preventDefault();
    const f = ev.target;
    rec.prices.push({
      beerType: f.beerType.value.trim(),
      price: parseFloat(f.price.value),
      unit: f.unit.value,
      reportedAt: Date.now(),
    });
    saveLocalData();
    openDetail(placeId);
    renderAll();
    showToast('Preis gespeichert — danke für deinen Beitrag!');
  };

  document.getElementById('detailOverlay').hidden = false;
}

/* ---------- Export / Import ---------- */
function exportData() {
  const payload = { localData, prefs, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bierlocator-daten.json';
  a.click();
  URL.revokeObjectURL(url);
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      if (payload.localData) localData = payload.localData;
      if (payload.prefs) prefs = payload.prefs;
      saveLocalData();
      savePrefs();
      applyPrefsToForm();
      renderAll();
      showToast('Daten importiert.');
    } catch (e) {
      showToast('Import fehlgeschlagen: ' + e.message);
    }
  };
  reader.readAsText(file);
}

/* ---------- Theme ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY_THEME, theme);
  const themeIcon = document.getElementById('themeIcon');
  if (themeIcon) {
    themeIcon.dataset.icon = theme === 'dark' ? 'sun' : 'moon';
    hydrateIcons(themeIcon.parentElement);
  }
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ---------- Prefs <-> Form ---------- */
function applyPrefsToForm() {
  document.getElementById('prefBeerType').value = prefs.beerType || '';
  document.getElementById('prefMaxPrice').value = prefs.maxPrice ?? '';
  document.getElementById('radiusSlider').value = prefs.radius || 1000;
  document.getElementById('radiusValue').textContent = `${prefs.radius || 1000} m`;
  document.getElementById('prefBiergarten').checked = !!prefs.biergartenPref;
}
function readPrefsFromForm() {
  prefs.beerType = document.getElementById('prefBeerType').value.trim();
  const mp = document.getElementById('prefMaxPrice').value;
  prefs.maxPrice = mp ? parseFloat(mp) : null;
  prefs.radius = parseInt(document.getElementById('radiusSlider').value, 10);
  prefs.biergartenPref = document.getElementById('prefBiergarten').checked;
}

/* ---------- Modus-Umschalter (Orte finden / Radtour) ---------- */
function setMode(mode) {
  document.querySelectorAll('.tap-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
  document.getElementById('modeFinden').hidden = mode !== 'finden';
  document.getElementById('modeTour').hidden = mode !== 'tour';
}

/* ---------- Bier-Radtour (Fahrrad-Routenplaner) ---------- */

// Reines Straßen-Routing OHNE Neusortierung — verbindet die Punkte exakt in der
// gegebenen Reihenfolge. Dient als Fallback, falls der Fahrrad-Routingdienst
// (BRouter) nicht erreichbar ist, ohne die gewählte Stopp-Reihenfolge zu verwerfen.
async function osrmRouteFixedOrder(points, attempt = 1) {
  const coordStr = points.map(p => `${p.lon},${p.lat}`).join(';');
  const url = `${OSRM_BASE}/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url);
  if (!res.ok) {
    if (attempt < 3) { await sleep(1000 * attempt); return osrmRouteFixedOrder(points, attempt + 1); }
    throw new Error('Routing-Server antwortet nicht (' + res.status + ')');
  }
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error('Routing fehlgeschlagen: ' + data.code);
  const route = data.routes[0];
  return {
    geometryLatLngs: route.geometry.coordinates.map(c => [c[1], c[0]]),
    distance: route.distance,
    duration: route.duration,
    legs: route.legs.map(l => ({ distance: l.distance, duration: l.duration })),
  };
}

function cumulativeDistances(latLngs) {
  const cum = [0];
  for (let i = 1; i < latLngs.length; i++) {
    cum.push(cum[i - 1] + haversine(latLngs[i - 1][0], latLngs[i - 1][1], latLngs[i][0], latLngs[i][1]));
  }
  return cum;
}

// Findet für jeden Wegpunkt den nächstgelegenen Punkt auf dem Track — die Suche
// beginnt jeweils dort, wo der vorherige Wegpunkt gefunden wurde, damit die
// Reihenfolge (und damit die Etappen-Aufteilung) garantiert stimmt.
function matchTrackIndices(trackLatLngs, waypoints) {
  let searchStart = 0;
  return waypoints.map(wp => {
    let bestIdx = searchStart, bestDist = Infinity;
    for (let i = searchStart; i < trackLatLngs.length; i++) {
      const d = haversine(wp.lat, wp.lon, trackLatLngs[i][0], trackLatLngs[i][1]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    searchStart = bestIdx;
    return bestIdx;
  });
}

// Fahrrad-Routing über BRouter (öffentlicher Dienst) mit dem "safety"-Profil,
// das Radwege/ruhige Straßen bevorzugt und Hauptstraßen meidet — im Gegensatz
// zum schnelleren, aber straßenlastigeren OSRM-Bike-Profil.
async function fetchBrouterRoute(waypoints, profile = BROUTER_PROFILE, attempt = 1) {
  const lonlats = waypoints.map(w => `${w.lon},${w.lat}`).join('|');
  const url = `${BROUTER_URL}?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;
  const res = await fetch(url);
  if (!res.ok) {
    if (attempt < 3) { await sleep(1000 * attempt); return fetchBrouterRoute(waypoints, profile, attempt + 1); }
    throw new Error('BRouter-Antwort: ' + res.status);
  }
  const data = await res.json();
  const feature = data.features && data.features[0];
  if (!feature || !feature.geometry || !feature.geometry.coordinates.length) throw new Error('BRouter: keine Route gefunden');
  const trackLatLngs = feature.geometry.coordinates.map(c => [c[1], c[0]]);
  const times = (feature.properties.times || []).map(Number);
  const cum = cumulativeDistances(trackLatLngs);
  const indices = matchTrackIndices(trackLatLngs, waypoints);
  const legs = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    legs.push({
      distance: Math.max(0, cum[indices[i + 1]] - cum[indices[i]]),
      duration: Math.max(0, (times[indices[i + 1]] || 0) - (times[indices[i]] || 0)),
    });
  }
  const lastIdx = indices[indices.length - 1];
  return { geometryLatLngs: trackLatLngs, distance: cum[lastIdx], duration: times[lastIdx] || 0, legs };
}

// Erfahrungswert: eine gefahrene Radstrecke ist etwa 1.35x länger als die
// Luftlinie (Straßennetz, Umwege um Hindernisse). Nur der Startwert der
// Regelschleife unten hängt davon ab — der Rest korrigiert sich selbst.
const ROAD_DETOUR_FACTOR = 1.35;
const TOUR_TOLERANCE = 0.08;        // ±8% gelten als "trifft die Wunschlänge"
const TOUR_MAX_ROUTE_CALLS = 9;     // Obergrenze für Routing-Anfragen pro Planung

// Peilung (0-360°) von `start` zu `point` — Norden = 0°, Osten = 90° usw.
function bearingFrom(start, point) {
  const toRad = d => d * Math.PI / 180;
  const lat1 = toRad(start.lat), lat2 = toRad(point.lat);
  const dLon = toRad(point.lon - start.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Welchen Radius braucht eine Schleife über `k` Stopps, damit die GEFAHRENE
// Strecke etwa `targetM` lang wird? Ein regelmäßiges k-Eck auf einem Kreis mit
// Radius r hat den Umfang 2*k*r*sin(pi/k) (k=3 -> 5.20*r, k=6 -> 6.00*r, erst für
// große k nähert sich das dem Kreisumfang 2*pi*r an — deshalb war die alte
// Annahme "targetM/(2*pi)" bei wenigen Stopps systematisch zu großzügig).
function loopRadiusForTarget(targetM, k) {
  const polygonPerimeterFactor = 2 * k * Math.sin(Math.PI / k);
  return targetM / (polygonPerimeterFactor * ROAD_DETOUR_FACTOR);
}

// Rundtour: Kompass in `k` Sektoren teilen und pro Sektor den Ort wählen, der am
// nächsten an `radius` liegt — aber NIEMALS weiter als `maxDist`. Diese Obergrenze
// ist entscheidend: ein einzelner weit entfernter Ort in einer dünn besetzten
// Himmelsrichtung hat vorher die ganze Tour aufgeblasen (Hin- und Rückweg zählen
// doppelt). Die Rückgabe ist nach Peilung sortiert, wodurch die Schleife sich
// nicht selbst kreuzt — ein eigener Routing-Aufruf zur Sortierung entfällt damit.
// `radii` ist ein Array mit einem Wunsch-Radius pro Sektor. Unterschiedliche Radien
// je Sektor sind der Feinsteller der Längensteuerung: die erreichbaren Routenlängen
// bilden eine Treppenfunktion, und ein einheitlicher Radius springt oft über die
// Wunschlänge hinweg. Einzelne Sektoren weiter außen zu wählen füllt diese Lücken.
function pickRadialStops(candidates, start, k, radii, maxDist, sectorOffset = 0) {
  const sectorSize = 360 / k;
  const used = new Set();
  const picked = [];
  for (let i = 0; i < k; i++) {
    const from = (sectorOffset + i * sectorSize) % 360;
    const to = from + sectorSize;
    const wantRadius = Array.isArray(radii) ? radii[i] : radii;
    let best = null, bestDiff = Infinity;
    for (const c of candidates) {
      if (used.has(c.id) || c.distance > maxDist) continue;
      let brg = bearingFrom(start, c);
      if (brg < from) brg += 360;              // Sektor über die 360°-Grenze hinweg
      if (brg < from || brg >= to) continue;
      const diff = Math.abs(c.distance - wantRadius);
      if (diff < bestDiff) { bestDiff = diff; best = c; }
    }
    if (best) { picked.push(best); used.add(best.id); }
  }
  picked.sort((a, b) => bearingFrom(start, a) - bearingFrom(start, b));
  return picked;
}

// Punkt-zu-Punkt: Orte entlang des Korridors Start->Ziel auswählen. `t` ist der
// Fortschritt auf der Achse (0 = Start, 1 = Ziel), `lateral` der seitliche Abstand
// zur Achse. Das Streckenbudget (Wunschlänge minus Luftlinie) begrenzt, wie weit
// ein Stopp seitlich abweichen darf — sonst reißt ein Ort quer draußen die Tour auf.
function projectOnAxis(start, end, p) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(start.lat * Math.PI / 180);
  const ax = (end.lon - start.lon) * mPerDegLon, ay = (end.lat - start.lat) * mPerDegLat;
  const px = (p.lon - start.lon) * mPerDegLon, py = (p.lat - start.lat) * mPerDegLat;
  const axisLen2 = ax * ax + ay * ay;
  if (axisLen2 === 0) return { t: 0, lateral: Math.hypot(px, py) };
  const t = (px * ax + py * ay) / axisLen2;
  const lateral = Math.abs(px * ay - py * ax) / Math.sqrt(axisLen2);
  return { t, lateral };
}

function pickCorridorStops(candidates, start, end, k, budgetM, tOffset = 0) {
  const direct = haversine(start.lat, start.lon, end.lat, end.lon);
  const slack = Math.max(0, budgetM - direct * ROAD_DETOUR_FACTOR);
  // Ein seitlicher Abstecher kostet grob 2x den Abstand; das Restbudget wird auf die
  // Stopps verteilt. Wichtig: das ist ein ANGESTREBTER Abstand, keine Obergrenze —
  // würde man seitliche Abweichung nur bestrafen, klebte die Auswahl immer an der
  // Direktlinie und die Wunschlänge wäre bei längeren Touren nie erreichbar.
  const targetLateral = slack / (2 * k) / ROAD_DETOUR_FACTOR;
  const maxLateral = Math.max(300, targetLateral * 2.2);
  const enriched = candidates
    .map(c => ({ c, ...projectOnAxis(start, end, c) }))
    .filter(x => x.t > -0.15 && x.t < 1.15 && x.lateral <= maxLateral);

  const used = new Set();
  const picked = [];
  for (let i = 1; i <= k; i++) {
    const targetT = clamp(((i + tOffset) / (k + 1)), 0, 1);
    let best = null, bestScore = Infinity;
    for (const x of enriched) {
      if (used.has(x.c.id)) continue;
      // Fortschritt auf der Achse zählt stärker als die Abweichung vom Wunsch-Abstand.
      const score = Math.abs(x.t - targetT) * direct * 1.5 + Math.abs(x.lateral - targetLateral);
      if (score < bestScore) { bestScore = score; best = x; }
    }
    if (best) { picked.push(best); used.add(best.c.id); }
  }
  picked.sort((a, b) => a.t - b.t);
  return picked.map(x => x.c);
}

// Holt die tatsächlich gefahrene Route: bevorzugt BRouter ("safety"-Profil,
// Radwege/ruhige Straßen), sonst normales Straßen-Routing in fester Reihenfolge.
async function fetchTourRoute(points) {
  try {
    return { ...await fetchBrouterRoute(points), bikeFriendly: true };
  } catch (e) {
    return { ...await osrmRouteFixedOrder(points), bikeFriendly: false };
  }
}

// Sucht die Stopp-Auswahl, deren TATSÄCHLICH GEFAHRENE Strecke der Wunschlänge am
// nächsten kommt. Gemessen wird immer mit demselben Router, der auch angezeigt wird —
// vorher wurde mit OSRM ausgewählt, aber die bewusst umwegigere BRouter-Strecke
// dargestellt, was systematisch zu lange Routen ergab.
//
// Die erreichbaren Längen bilden eine Treppenfunktion (es gibt nur endlich viele
// Orte), deshalb wird nicht proportional nachgeregelt — das pendelte zwischen "zu
// kurz" und "zu lang" hin und her, ohne je in der Mitte zu landen. Stattdessen:
//   1. Intervall einschachteln,  2. halbieren,
//   3. einzelne Stopps weiter nach außen ziehen, um Treppenlücken zu füllen,
//   4. falls noch zu lang: Umweg-Verursacher gegen näheren Ort tauschen.
async function planTour(pool, start, endPoint, desiredKm, minStops, opts = {}) {
  const targetM = desiredKm * 1000;
  const roundtrip = opts.roundtrip;
  const jitter = opts.jitter || 0;
  const onProgress = opts.onProgress || (() => {});
  // Bei einer Rundtour kostet ein Stopp in der Entfernung d mindestens 2*d
  // (hin und zurück) — weiter als knapp die halbe Wunschlänge darf keiner liegen.
  const maxStopDist = targetM * 0.42;
  const k = minStops;
  const tolerance = targetM * TOUR_TOLERANCE;

  let calls = 0;
  let best = null;

  const selectStops = (scale) => roundtrip
    ? pickRadialStops(pool, start, k, loopRadiusForTarget(targetM * scale, k), maxStopDist * Math.max(1, scale), jitter * 360)
    : pickCorridorStops(pool, start, endPoint, k, targetM * scale, jitter);

  // Misst eine Auswahl und merkt sie, falls sie näher an der Wunschlänge liegt.
  const evaluate = async (stops, label) => {
    calls++;
    onProgress(label || calls);
    const route = await fetchTourRoute([start, ...stops, endPoint]);
    const err = route.distance - targetM;
    if (!best || Math.abs(err) < Math.abs(best.err)) best = { stops, route, err };
    return err;
  };

  /* 1. Einschachteln: ein Intervall [lo = zu kurz, hi = zu lang] finden. */
  let lo = null, hi = null, scale = 1;
  for (let i = 0; i < 4 && calls < TOUR_MAX_ROUTE_CALLS; i++) {
    const stops = selectStops(scale);
    if (stops.length < minStops) {
      scale *= 1.45;                    // Suchbereich zu eng -> aufweiten
      if (scale > 6) break;
      continue;
    }
    const err = await evaluate(stops);
    if (Math.abs(err) <= tolerance) return best;
    if (err < 0) { lo = scale; if (hi) break; scale *= 1.6; }
    else         { hi = scale; if (lo) break; scale /= 1.6; }
  }
  if (!best) throw new Error('Keine passende Route mit genügend Stopps gefunden');

  /* 2. Intervallhalbierung (geometrisches Mittel, da der Radius multiplikativ wirkt). */
  for (let i = 0; i < 3 && lo && hi && calls < TOUR_MAX_ROUTE_CALLS; i++) {
    const mid = Math.sqrt(lo * hi);
    const stops = selectStops(mid);
    if (stops.length < minStops) break;
    const err = await evaluate(stops);
    if (Math.abs(err) <= tolerance) return best;
    if (err < 0) lo = mid; else hi = mid;
  }

  /* 3. Treppenlücke füllen: einzelne Sektoren auf den größeren Radius hochziehen.
        Damit entstehen Zwischenlängen, die ein einheitlicher Radius überspringt. */
  if (roundtrip && lo && hi && Math.abs(best.err) > tolerance) {
    const rLo = loopRadiusForTarget(targetM * lo, k);
    const rHi = loopRadiusForTarget(targetM * hi, k);
    const maxMixes = Math.min(k - 1, 2);   // mehr bringt erfahrungsgemäß nichts mehr
    for (let m = 1; m <= maxMixes && calls < TOUR_MAX_ROUTE_CALLS; m++) {
      const radii = Array.from({ length: k }, (_, i) => (i < m ? rHi : rLo));
      const stops = pickRadialStops(pool, start, k, radii, maxStopDist * Math.max(1, hi), jitter * 360);
      if (stops.length < minStops) continue;
      const err = await evaluate(stops, 'feinschliff');
      if (Math.abs(err) <= tolerance) return best;
    }
  }

  /* 4. Noch zu lang? Den Stopp mit dem größten Umweg-Anteil gegen einen näher
        gelegenen TAUSCHEN (nicht löschen) — so bleibt die Mindestanzahl erhalten. */
  while (calls < TOUR_MAX_ROUTE_CALLS && best.route.distance > targetM + tolerance) {
    const stops = best.stops;
    const legs = best.route.legs;
    let worstIdx = -1, worstCost = -Infinity;
    for (let i = 0; i < stops.length; i++) {
      const prev = i === 0 ? start : stops[i - 1];
      const next = i === stops.length - 1 ? endPoint : stops[i + 1];
      const direct = haversine(prev.lat, prev.lon, next.lat, next.lon);
      const cost = (legs[i] ? legs[i].distance : 0) + (legs[i + 1] ? legs[i + 1].distance : 0) - direct;
      if (cost > worstCost) { worstCost = cost; worstIdx = i; }
    }
    if (worstIdx < 0) break;

    const inUse = new Set(stops.map(s => s.id));
    const prev = worstIdx === 0 ? start : stops[worstIdx - 1];
    const next = worstIdx === stops.length - 1 ? endPoint : stops[worstIdx + 1];
    let replacement = null, bestCost = worstCost;
    for (const c of pool) {
      if (inUse.has(c.id)) continue;
      const cost = haversine(prev.lat, prev.lon, c.lat, c.lon)
        + haversine(c.lat, c.lon, next.lat, next.lon)
        - haversine(prev.lat, prev.lon, next.lat, next.lon);
      if (cost < bestCost) { bestCost = cost; replacement = c; }
    }
    if (!replacement) break;

    const candidateStops = stops.slice();
    candidateStops[worstIdx] = replacement;
    const prevErr = Math.abs(best.err);
    await evaluate(candidateStops, 'feinschliff');
    if (Math.abs(best.err) >= prevErr) break;   // keine Verbesserung -> aufhören
  }

  return best;
}

async function buildTour() {
  const status = document.getElementById('tourStatus');
  document.getElementById('tourResultPanel').hidden = true;
  if (!userLocation) {
    status.textContent = 'Bitte zuerst oben unter „Standort" einen Startpunkt festlegen.';
    return;
  }
  const roundtrip = document.getElementById('tourRoundtrip').checked;
  const desiredKm = parseFloat(document.getElementById('tourKm').value);
  const minStops = Math.max(1, parseInt(document.getElementById('tourMinStops').value, 10) || 1);
  const start = userLocation;
  let endPoint = start;

  if (!roundtrip) {
    const q = document.getElementById('tourDestInput').value.trim();
    if (!q) { status.textContent = 'Bitte einen Zielort eingeben oder "Rundtour" aktivieren.'; return; }
    status.textContent = 'Zielort wird gesucht…';
    const geo = await geocode(q);
    if (!geo) { status.textContent = 'Zielort nicht gefunden.'; return; }
    endPoint = { lat: geo.lat, lon: geo.lon };
  }

  status.textContent = 'Bierorte entlang der Route werden gesucht…';
  const centerLat = (start.lat + endPoint.lat) / 2;
  const centerLon = (start.lon + endPoint.lon) / 2;
  // Suchradius: bei einer Rundtour reicht etwas über die halbe Wunschlänge; bei
  // Punkt-zu-Punkt muss zusätzlich der ganze Korridor bis zum Ziel abgedeckt sein.
  const directToEnd = haversine(start.lat, start.lon, endPoint.lat, endPoint.lon);
  let radius = clamp(Math.max(desiredKm * 1000 * 0.55, directToEnd * 0.6 + 1000), 800, 20000);
  const activeTypes = new Set(getActiveTypeFilters());

  let candidates = [];
  let closedCount = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const found = await fetchPlacesNear(centerLat, centerLon, radius, start.lat, start.lon);
      const typed = found.filter(p => activeTypes.has(p.type) && !getPlaceRecord(p.id).hidden);
      closedCount = typed.filter(p => isOpenNow(p.tags.opening_hours) === false).length;
      // Orte ohne Öffnungszeiten-Angabe bleiben drin (unbekannt ≠ geschlossen) —
      // nur nachweislich geschlossene werden ausgeschlossen.
      candidates = typed.filter(p => isOpenNow(p.tags.opening_hours) !== false);
    } catch (e) {
      status.textContent = 'Fehler bei der Ortssuche: ' + e.message;
      return;
    }
    if (candidates.length >= minStops) break;
    radius = Math.min(radius * 1.7, 20000);
  }
  if (candidates.length < minStops) {
    status.textContent = `Nur ${candidates.length} passende, aktuell geöffnete Bierort(e) in der Umgebung gefunden — weniger als die gewünschte Mindestanzahl (${minStops}). Vergrößere die Wunschlänge, wähle mehr Ortstypen im Filter, oder reduziere die Mindestanzahl.`;
    return;
  }
  if (closedCount > 0) showToast(`ℹ️ ${closedCount} aktuell geschlossene Orte ausgeblendet.`);
  mergeIntoAllPlaces(candidates);

  const pool = candidates;
  lastTourParams = { pool, start, endPoint, desiredKm, minStops, roundtrip };

  try {
    const best = await planTour(pool, start, endPoint, desiredKm, minStops, {
      roundtrip,
      onProgress: p => {
        status.textContent = p === 'feinschliff'
          ? 'Route wird auf die Wunschlänge feinjustiert…'
          : `Fahrradroute wird berechnet… (Versuch ${p})`;
      },
    });
    renderTour(best, start, endPoint, desiredKm);
    status.textContent = '';
  } catch (e) {
    status.textContent = 'Fehler beim Berechnen der Route: ' + e.message;
  }
}

async function rerollTour() {
  if (!lastTourParams) return;
  const status = document.getElementById('tourStatus');
  status.textContent = 'Neue Route wird gewürfelt…';
  const { pool, start, endPoint, desiredKm, minStops, roundtrip } = lastTourParams;
  try {
    const best = await planTour(pool, start, endPoint, desiredKm, minStops, {
      roundtrip,
      jitter: Math.random(),   // Sektoren/Korridor versetzt -> andere Orte, gleiche Länge
      onProgress: p => {
        status.textContent = p === 'feinschliff'
          ? 'Route wird auf die Wunschlänge feinjustiert…'
          : `Neue Route wird berechnet… (Versuch ${p})`;
      },
    });
    renderTour(best, start, endPoint, desiredKm);
    status.textContent = '';
  } catch (e) {
    status.textContent = 'Fehler: ' + e.message;
  }
}

// Zeichnet eine fertig geplante Tour (Karte + Seitenleiste). Die Streckenlänge ist
// zu diesem Zeitpunkt bereits final — hier wird nicht mehr gerechnet.
function renderTour(best, start, endPoint, desiredKm) {
  const targetM = (desiredKm || 0) * 1000;
  const orderedStops = best.stops;
  const { geometryLatLngs, legs, distance: totalDistance, duration: totalDuration, bikeFriendly } = best.route;
  if (!bikeFriendly) showToast('Fahrradfreundliches Routing nicht erreichbar — zeige Standard-Route.');

  currentTour = {
    orderedStops, legs, start, endPoint, geometryLatLngs,
    distance: totalDistance, duration: totalDuration,
  };

  routeLayer.clearLayers();
  const routeColor = getComputedStyle(document.documentElement).getPropertyValue('--route-color').trim() || '#a53a2b';
  L.polyline(geometryLatLngs, { color: routeColor, weight: 5, opacity: 0.85 }).addTo(routeLayer);
  L.marker([start.lat, start.lon], {
    icon: L.divIcon({ className: '', html: '<div class="tour-num-icon tour-num-icon-start">S</div>', iconSize: [26, 26], iconAnchor: [13, 13] })
  }).addTo(routeLayer).bindPopup('Start');
  orderedStops.forEach((s, i) => {
    L.marker([s.lat, s.lon], {
      icon: L.divIcon({ className: '', html: `<div class="tour-num-icon">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })
    }).addTo(routeLayer).bindPopup(popupHtml(s, cheapestPriceForPlace(s))).on('click', () => openDetail(s.id));
  });
  if (endPoint !== start) {
    L.marker([endPoint.lat, endPoint.lon], {
      icon: L.divIcon({ className: '', html: '<div class="tour-num-icon tour-num-icon-start">Z</div>', iconSize: [26, 26], iconAnchor: [13, 13] })
    }).addTo(routeLayer).bindPopup('Ziel');
  }
  const bounds = L.latLngBounds(geometryLatLngs);
  map.fitBounds(bounds, { padding: [40, 40] });

  const deviation = targetM ? (totalDistance - targetM) / targetM : 0;
  const deviationLabel = !targetM ? ''
    : Math.abs(deviation) <= TOUR_TOLERANCE ? `Ziel: ${desiredKm} km ✓`
    : `${deviation > 0 ? '+' : '−'}${Math.abs(Math.round(deviation * 100))} % vs. ${desiredKm} km`;

  document.getElementById('tourStats').innerHTML = `
    <div class="tour-stat"><b>${(totalDistance / 1000).toFixed(1)} km</b><span>${deviationLabel || 'Gesamtlänge'}</span></div>
    <div class="tour-stat"><b>${fmtDuration(totalDuration)}</b><span>Fahrzeit ca.</span></div>
    <div class="tour-stat"><b>${orderedStops.length}</b><span>Bierorte</span></div>
  `;
  const hints = [
    bikeFriendly
      ? `${icon('bike', { size: 13 })} Routing bevorzugt Radwege &amp; ruhige Straßen`
      : `${icon('alertTriangle', { size: 13 })} Standard-Routing (Fahrrad-Routingdienst nicht erreichbar)`,
  ];
  if (targetM && deviation > TOUR_TOLERANCE) {
    hints.push(`${icon('alertTriangle', { size: 13 })} Länger als gewünscht: näher gelegene Orte hätten sich hier nicht zu einer sinnvollen Schleife verbinden lassen. Mehr Ortstypen im Filter erlauben oder die Mindestanzahl senken schafft mehr Auswahl.`);
  } else if (targetM && deviation < -TOUR_TOLERANCE) {
    hints.push(`${icon('alertTriangle', { size: 13 })} Kürzer als gewünscht: das ist die längste Runde, die sich hier ohne unnötigen Umweg ergibt (weiter entfernte Orte hätten die Tour deutlich über ${desiredKm} km gebracht). Mehr Stopps oder eine größere Wunschlänge geben mehr Spielraum.`);
  }
  document.getElementById('tourRoutingHint').innerHTML = hints.map(h => `<div class="icon-row">${h}</div>`).join('');
  document.getElementById('tourStops').innerHTML = orderedStops.map((s, i) => {
    const meta = TYPE_META[s.type];
    return `<div class="tour-stop" data-id="${s.id}">
      <span class="ts-num">${i + 1}</span>
      <span class="ts-icon">${icon(meta.icon, { size: 15 })}</span>
      <span>${escapeHtml(s.name)}</span>
      <span class="ts-leg">${fmtDist(legs[i].distance)}</span>
    </div>`;
  }).join('') + `<div class="tour-stop">
      <span class="ts-num ts-num-flag">${icon('flag', { size: 12 })}</span>
      <span>${endPoint === start ? 'Zurück zum Start' : 'Ziel'}</span>
      <span class="ts-leg">${fmtDist(legs[legs.length - 1].distance)}</span>
    </div>`;
  document.querySelectorAll('.tour-stop[data-id]').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.id));
  });
  document.getElementById('tourResultPanel').hidden = false;
}

function exportTourGpx() {
  if (!currentTour) return;
  const trkpts = currentTour.geometryLatLngs.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"></trkpt>`).join('\n');
  const wpts = currentTour.orderedStops.map(s =>
    `<wpt lat="${s.lat}" lon="${s.lon}"><name>${escapeHtml(s.name)}</name></wpt>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Bier-Locator" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
<trk><name>Bier-Radtour</name><trkseg>
${trkpts}
</trkseg></trk>
</gpx>`;
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bier-radtour.gpx';
  a.click();
  URL.revokeObjectURL(url);
}

function openTourInGoogleMaps() {
  if (!currentTour) return;
  const { start, endPoint, orderedStops } = currentTour;
  const origin = `${start.lat},${start.lon}`;
  const destination = `${endPoint.lat},${endPoint.lon}`;
  const params = new URLSearchParams({ api: '1', origin, destination, travelmode: 'bicycling' });
  if (orderedStops.length) {
    // Google Maps' Web-Directions-URL honoriert zuverlässig nur die ersten ~9 Wegpunkte.
    params.set('waypoints', orderedStops.slice(0, 9).map(s => `${s.lat},${s.lon}`).join('|'));
  }
  window.open(`https://www.google.com/maps/dir/?${params.toString()}`, '_blank', 'noopener');
}

/* ---------- Promille-Rechner ---------- */
const BETA_PER_HOUR = 0.15; // Abbaurate ‰/h (typischer Mittelwert 0,10-0,20)

function bacGramsForEntry(e) { return e.qty * e.volume * (e.abv / 100) * 0.8; }
function bacKcalForEntry(e) { return e.qty * (e.volume / 100) * e.kcal100; }

function computeBac() {
  const { profile, log } = bacState;
  if (!log.length) return { bac: 0, peakBac: 0, totalGrams: 0, totalKcal: 0, hoursSinceFirst: 0, alcoholicCount: 0 };
  const now = Date.now();
  const totalGrams = log.reduce((s, e) => s + bacGramsForEntry(e), 0);
  const totalKcal = log.reduce((s, e) => s + bacKcalForEntry(e), 0);
  const earliest = Math.min(...log.map(e => e.timestamp));
  const hoursSinceFirst = Math.max(0, (now - earliest) / 3600000);
  const peakBac = totalGrams / (profile.weight * profile.r);
  const bac = Math.max(0, peakBac - BETA_PER_HOUR * hoursSinceFirst);
  const alcoholicCount = log.reduce((s, e) => s + (e.abv > 0 ? e.qty : 0), 0);
  return { bac, peakBac, totalGrams, totalKcal, hoursSinceFirst, alcoholicCount };
}

function fmtClockIn(hoursFromNow) {
  const d = new Date(Date.now() + hoursFromNow * 3600000);
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function renderBacLog() {
  const el = document.getElementById('bacLogList');
  if (!el) return;
  if (!bacState.log.length) {
    el.innerHTML = '<div class="hint">Noch nichts eingetragen — oben ein Getränk hinzufügen.</div>';
    return;
  }
  el.innerHTML = bacState.log.slice().sort((a, b) => b.timestamp - a.timestamp).map(e => `
    <div class="bac-log-item">
      <span>${e.qty}× ${escapeHtml(e.label)} (${e.abv}%)</span>
      <span>${timeAgo(e.timestamp) === 'heute' ? fmtMinutesAgo(e.timestamp) : timeAgo(e.timestamp)}</span>
      <button class="bli-remove" data-ts="${e.timestamp}" title="Entfernen">${icon('x', { size: 13 })}</button>
    </div>
  `).join('');
  el.querySelectorAll('.bli-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const ts = parseFloat(btn.dataset.ts);
      bacState.log = bacState.log.filter(e => e.timestamp !== ts);
      saveBac();
      renderBacLog();
      renderBacResult();
    });
  });
}
function fmtMinutesAgo(ts) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'gerade eben';
  if (min === 1) return 'vor 1 Min';
  return `vor ${min} Min`;
}

function renderBacResult() {
  const box = document.getElementById('bacResult');
  if (!box) return;
  const { bac, peakBac, totalKcal, alcoholicCount } = computeBac();
  const stage = bacStageFor(bac);
  const gaugeMax = 3.0;
  const markerPos = clamp((bac / gaugeMax) * 100, 0, 100);

  const hoursToZero = bac / BETA_PER_HOUR;
  const hoursTo05 = Math.max(0, (bac - 0.5) / BETA_PER_HOUR);
  const hoursTo01 = Math.max(0, (bac - 0.1) / BETA_PER_HOUR);

  const pizzaSlices = totalKcal / 285;
  const jogKm = totalKcal / 65;
  const waterGlasses = Math.ceil(alcoholicCount * 0.8);

  let hangoverRisk = 'gering', hangoverColor = 'good';
  if (peakBac >= 1.5) { hangoverRisk = 'hoch'; hangoverColor = 'bad'; }
  else if (peakBac >= 0.7) { hangoverRisk = 'mittel'; hangoverColor = 'warn'; }

  box.innerHTML = `
    <div class="bac-result">
      <div class="bac-num" style="color:var(--${stage.color})">${bac.toFixed(2)} ‰</div>
      <div class="bac-stage-name" style="color:var(--${stage.color})">${stage.name}</div>
      <div class="bac-gauge"><div class="bac-gauge-marker" style="left:${markerPos}%"></div></div>
      <div class="bac-gauge-labels"><span>0‰</span><span>1‰</span><span>2‰</span><span>3‰+</span></div>
      <div class="bac-stage-desc">${stage.desc}</div>
    </div>

    <div class="bac-timeline">
      ${bac > 0.1 ? `<div class="bt-row"><span class="icon-row">${icon('alertTriangle', { size: 13 })} Unter 0,1‰ (Neulinge/Berufsfahrer)</span><span>ca. ${fmtDuration(hoursTo01 * 3600)} · ${fmtClockIn(hoursTo01)} Uhr</span></div>` : ''}
      ${bac > 0.5 ? `<div class="bt-row"><span class="icon-row">${icon('alertTriangle', { size: 13 })} Unter 0,5‰ (allg. Grenze AT/DE)</span><span>ca. ${fmtDuration(hoursTo05 * 3600)} · ${fmtClockIn(hoursTo05)} Uhr</span></div>` : ''}
      ${bac > 0 ? `<div class="bt-row"><span class="icon-row">${icon('checkCircle', { size: 13 })} Rechnerisch nüchtern (0‰)</span><span>ca. ${fmtDuration(hoursToZero * 3600)} · ${fmtClockIn(hoursToZero)} Uhr</span></div>` : `<div class="bt-row"><span class="icon-row">${icon('checkCircle', { size: 13 })} Rechnerisch nüchtern</span><span>jetzt</span></div>`}
    </div>

    <div class="bac-facts">
      <div class="tour-stat"><b>${icon('flame', { size: 15, className: 'stat-icon' })} ${Math.round(totalKcal)}</b><span>kcal getrunken</span></div>
      <div class="tour-stat"><b>${icon('activity', { size: 15, className: 'stat-icon' })} ${jogKm.toFixed(1)} km</b><span>Joggen zum Verbrennen</span></div>
      <div class="tour-stat"><b>${icon('droplet', { size: 15, className: 'stat-icon' })} ${waterGlasses}</b><span>Gläser Wasser</span></div>
    </div>
    <div class="bac-facts">
      <div class="tour-stat"><b style="color:var(--${hangoverColor})">${hangoverRisk}</b><span>Kater-Risiko morgen</span></div>
      <div class="tour-stat"><b>${pizzaSlices.toFixed(1)}</b><span>Pizzastücke entspr.</span></div>
    </div>

    <div class="bac-legal">
      <div class="bac-legal-row"><span>Führerschein-Neulinge / Berufskraftfahrer</span><span>0,1‰</span></div>
      <div class="bac-legal-row"><span>Allgemeine Grenze (AT/DE)</span><span>0,5‰</span></div>
      <div class="bac-legal-row"><span>Straftat-Schwelle (absolute Fahruntüchtigkeit)</span><span>1,1‰</span></div>
    </div>

    <div class="bac-disclaimer">Grobe statistische Schätzung (Widmark-Formel) für einen "durchschnittlichen" Körper — individuelle Faktoren (Medikamente, Gesundheit, Tagesform, Nahrung, Erfahrung) wirken stark auf den echten Wert. Kein medizinischer oder rechtlicher Rat, Grenzwerte variieren je nach Land. Im Zweifel <b>nicht fahren</b> und bei Anzeichen einer Alkoholvergiftung (Erbrechen, Verwirrtheit, Bewusstlosigkeit) sofort den Notruf (144/112) wählen.</div>
  `;
}

function openBacTool() {
  const presetOptions = Object.entries(DRINK_PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  document.getElementById('toolContent').innerHTML = `
    <h3><span class="detail-type-icon">${icon('calculator', { size: 20 })}</span> Promille-Rechner</h3>
    <div class="hint">Trage getrunkene Getränke ein — der Rechner läuft live weiter, während das Fenster offen ist.</div>

    <form class="bac-form" id="bacProfileForm">
      <div class="bac-form-row">
        <label class="field">Körpergewicht (kg)<input type="number" name="weight" min="30" max="250" value="${bacState.profile.weight}"></label>
        <label class="field">Geschlecht (Körperwasseranteil)
          <select name="gender">
            <option value="0.68" ${bacState.profile.r === 0.68 ? 'selected' : ''}>Männlich</option>
            <option value="0.55" ${bacState.profile.r === 0.55 ? 'selected' : ''}>Weiblich</option>
            <option value="0.615" ${bacState.profile.r === 0.615 ? 'selected' : ''}>Divers / unsicher</option>
          </select>
        </label>
      </div>
    </form>

    <div class="field" style="margin-top:10px">Getränk hinzufügen</div>
    <div class="bac-add-row">
      <select id="bacPreset">${presetOptions}</select>
      <input type="number" id="bacQty" min="0.5" step="0.5" value="1" style="width:60px" title="Anzahl">
      <input type="number" id="bacMinAgo" min="0" step="5" value="0" style="width:70px" title="Vor wie vielen Minuten getrunken">
      <span class="hint" style="margin:0">Min. her</span>
      <button id="btnAddDrink" class="btn-secondary">+ Hinzufügen</button>
    </div>
    <div id="bacCustomFields" class="bac-add-row" style="display:none;margin-top:6px">
      <input type="number" id="bacCustomVolume" min="1" value="500" style="width:80px" title="ml"><span class="hint" style="margin:0">ml</span>
      <input type="number" id="bacCustomAbv" min="0" max="90" step="0.1" value="5" style="width:60px" title="%"><span class="hint" style="margin:0">%</span>
    </div>

    <div id="bacLogList" class="bac-log-list"></div>
    <button id="btnClearBacLog" class="btn-secondary btn-icon-label" style="margin-top:8px">${icon('trash', { size: 14 })} Log leeren</button>

    <div id="bacResult"></div>
  `;

  const presetSelect = document.getElementById('bacPreset');
  const customFields = document.getElementById('bacCustomFields');
  presetSelect.addEventListener('change', () => {
    customFields.style.display = presetSelect.value === 'custom' ? 'flex' : 'none';
  });

  document.getElementById('bacProfileForm').addEventListener('change', () => {
    const f = document.getElementById('bacProfileForm');
    bacState.profile.weight = parseFloat(f.weight.value) || 75;
    bacState.profile.r = parseFloat(f.gender.value);
    saveBac();
    renderBacResult();
  });

  document.getElementById('btnAddDrink').addEventListener('click', () => {
    const key = presetSelect.value;
    const preset = DRINK_PRESETS[key];
    const qty = parseFloat(document.getElementById('bacQty').value) || 1;
    const minAgo = parseFloat(document.getElementById('bacMinAgo').value) || 0;
    const volume = key === 'custom' ? (parseFloat(document.getElementById('bacCustomVolume').value) || 500) : preset.volume;
    const abv = key === 'custom' ? (parseFloat(document.getElementById('bacCustomAbv').value) || 0) : preset.abv;
    bacState.log.push({
      label: preset.label, volume, abv, kcal100: preset.kcal100, qty,
      timestamp: Date.now() - minAgo * 60000,
    });
    saveBac();
    renderBacLog();
    renderBacResult();
    showToast(`${preset.label} hinzugefügt`);
  });

  document.getElementById('btnClearBacLog').addEventListener('click', () => {
    bacState.log = [];
    saveBac();
    renderBacLog();
    renderBacResult();
  });

  renderBacLog();
  renderBacResult();
  clearInterval(bacTickInterval);
  bacTickInterval = setInterval(renderBacResult, 30000);
  document.getElementById('toolOverlay').hidden = false;
}

/* ---------- Init ---------- */
function init() {
  hydrateIcons();
  initMap();
  applyPrefsToForm();
  const savedTheme = localStorage.getItem(STORAGE_KEY_THEME) || 'light';
  applyTheme(savedTheme);

  document.getElementById('btnGeolocate').addEventListener('click', geolocate);
  document.getElementById('btnSearchAddress').addEventListener('click', searchAddress);
  document.getElementById('addressInput').addEventListener('keydown', e => { if (e.key === 'Enter') searchAddress(); });

  document.getElementById('radiusSlider').addEventListener('input', e => {
    document.getElementById('radiusValue').textContent = `${e.target.value} m`;
  });
  document.getElementById('btnSavePrefs').addEventListener('click', () => {
    readPrefsFromForm();
    savePrefs();
    showToast('Profil gespeichert.');
    renderAll();
  });

  document.getElementById('btnRefresh').addEventListener('click', () => { readPrefsFromForm(); savePrefs(); searchNearby(); });
  document.querySelectorAll('#typeFilters input, #onlyWithPrice, #onlyFavorites, #sortSelect').forEach(el =>
    el.addEventListener('change', renderAll)
  );
  document.getElementById('btnResetHidden').addEventListener('click', (e) => {
    e.preventDefault();
    Object.values(localData).forEach(rec => { rec.hidden = false; });
    saveLocalData();
    renderAll();
    showToast('Alle ausgeblendeten Orte sind wieder sichtbar.');
  });
  document.getElementById('filterBeerType').addEventListener('input', renderAll);

  document.getElementById('btnCloseDetail').addEventListener('click', () => { document.getElementById('detailOverlay').hidden = true; });
  document.getElementById('detailOverlay').addEventListener('click', (e) => { if (e.target.id === 'detailOverlay') e.currentTarget.hidden = true; });
  const closeBacTool = () => { document.getElementById('toolOverlay').hidden = true; clearInterval(bacTickInterval); };
  document.getElementById('btnCloseTool').addEventListener('click', closeBacTool);
  document.getElementById('toolOverlay').addEventListener('click', (e) => { if (e.target.id === 'toolOverlay') closeBacTool(); });

  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); });
  document.getElementById('btnTheme').addEventListener('click', toggleTheme);
  document.getElementById('btnBac').addEventListener('click', openBacTool);

  document.querySelectorAll('.tap-tab').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

  document.getElementById('tourRoundtrip').addEventListener('change', e => {
    document.getElementById('tourDestRow').hidden = e.target.checked;
  });
  document.getElementById('tourKm').addEventListener('input', e => {
    document.getElementById('tourKmValue').textContent = `${e.target.value} km`;
  });
  document.getElementById('btnBuildTour').addEventListener('click', buildTour);
  document.getElementById('btnRerollTour').addEventListener('click', rerollTour);
  document.getElementById('btnExportGpx').addEventListener('click', exportTourGpx);
  document.getElementById('btnTourGmaps').addEventListener('click', openTourInGoogleMaps);
  window.addEventListener('resize', () => map.invalidateSize());

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);

/* ---------- PWA: Service Worker registrieren ("Zum Startbildschirm hinzufügen") ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service Worker Registrierung fehlgeschlagen:', err));
  });
}
