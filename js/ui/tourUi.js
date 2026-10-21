// "Bier-Radtour": Formular, Planung mit Fortschritt, Ergebnis mit Zeitplan,
// Höhenprofil, Wetter, Promille-Hochrechnung, Tauschen/Entfernen einzelner Stopps.
// Während einer Live-Tour (liveUi.js) zeigt die Zeitleiste die tatsächliche Lage.
import { prefs, savePrefs, isHidden, loadBac } from '../store.js';
import { state, rememberPlaces, emit } from '../state.js';
import { TYPE_META, fetchPlacesAround, fetchPlacesByIds } from '../places.js';
import { loadSummaries, getSummary } from '../community.js';
import { placeStatus, statusBadge, tourQuality } from '../placeInfo.js';
import { isOpenAt } from '../openingHours.js';
import { planTour, rerouteTour, TOUR_TOLERANCE } from '../tour/tourPlan.js';
import { alternativesForStop, legStats } from '../tour/planner.js';
import { routeThrough, RIDE_STYLES } from '../tour/routing.js';
import { liveSchedule } from '../tour/live.js';
import { weatherForWindow, weatherIcon, weatherText, windDirName } from '../weather.js';
import { simulateBac, DRINK_PRESETS } from '../bac.js';
import { countryInfo } from '../legal.js';
import { tourLink, shareLink } from '../share.js';
import { cheapestChainPrice } from '../chainPrices.js';
import { icon } from '../icons.js';
import { escapeHtml, fmtDist, fmtKm, fmtDuration, fmtClock, haversine, clamp } from '../util.js';
import { $, toast, animateNumber, downloadFile } from './dom.js';
import { attachAutocomplete } from './autocomplete.js';
import { searchPlaces } from '../geo.js';
import { setSheet, mobile } from './sheet.js';
import * as mapview from '../map.js';

const TOUR_CORE_TYPES = ['pub', 'biergarten', 'brewery', 'gasthaus'];
const TOUR_EXTRA_TYPES = ['restaurant', 'beverages', 'convenience', 'supermarket', 'fuel'];

export const TOUR_THEMES = {
  all:        { label: 'Alles', icon: 'beerMug' },
  brewery:    { label: 'Brauereien', icon: 'barrel' },
  biergarten: { label: 'Biergärten', icon: 'tree' },
  cheap:      { label: 'Günstig', icon: 'coin' },
  mix:        { label: 'Bunt gemischt', icon: 'shuffle' },
};
const BREW_NAME = /bräu|brau(haus|erei|stube|keller|gasthof)|brewery|brewpub|brauwerk/i;
const isBreweryLike = p => p.type === 'brewery' || p.tags.microbrewery === 'yes' || BREW_NAME.test(p.name);
const isGardenLike = p => p.type === 'biergarten' || p.tags.outdoor_seating === 'yes' || p.tags.beer_garden === 'yes';

let openPlace = () => {};
let dest = null;         // { lat, lon, label }
let tour = null;         // aktuelle Tour
let pool = [];
let poolTheme = null;
let shownKeys = new Set();
let busy = false;
let lastWx = null;       // Wetter während der geplanten Tour

export function initTour(opts) {
  openPlace = opts.openPlace;
  const t = prefs.tour;

  // Tourart
  const seg = $('#tourMode');
  const setMode = round => {
    t.roundtrip = round;
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String((b.dataset.value === 'round') === round)));
    $('#tourDestWrap').hidden = round;
    $('#tourCalmRow').hidden = !round;
    savePrefs();
  };
  seg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.value === 'round'); });
  $('#tourDest').addEventListener('input', () => { dest = null; }); // Text geändert → altes Ziel verwerfen
  attachAutocomplete($('#tourDest'), $('#tourDestSuggest'), {
    onPick: it => { dest = it; },
    near: () => state.location,
    onClear: () => { dest = null; },
  });

  // Länge
  const km = $('#tourKm');
  km.value = t.km;
  const showKm = () => { $('#tourKmValue').textContent = `${km.value} km`; paintRange(km); };
  km.addEventListener('input', showKm);
  km.addEventListener('change', () => { t.km = +km.value; savePrefs(); });
  showKm();

  // Stopps
  const out = $('#tourStopsValue');
  out.textContent = t.stops;
  $('#tourStops').addEventListener('click', e => {
    const b = e.target.closest('button[data-step]');
    if (!b) return;
    t.stops = clamp(t.stops + Number(b.dataset.step), 1, 12);
    out.textContent = t.stops;
    out.classList.remove('bump'); void out.offsetWidth; out.classList.add('bump');
    savePrefs();
  });

  // Start & Pause
  const startInput = $('#tourStart');
  const now = new Date();
  const q = new Date(Math.ceil(now.getTime() / (15 * 60000)) * 15 * 60000);
  startInput.value = `${String(q.getHours()).padStart(2, '0')}:${String(q.getMinutes()).padStart(2, '0')}`;
  $('#tourDwell').value = String(t.dwell);
  $('#tourDwell').addEventListener('change', e => { t.dwell = +e.target.value; savePrefs(); });

  // Fahrstil
  $('#tourStyle').innerHTML = Object.entries(RIDE_STYLES).map(([k, s]) => `
    <button role="radio" data-style="${k}" aria-checked="${t.style === k}">
      <b>${s.label}</b><small>${s.desc}</small>
    </button>`).join('');
  $('#tourStyle').addEventListener('click', e => {
    const b = e.target.closest('button[data-style]');
    if (!b) return;
    t.style = b.dataset.style;
    $('#tourStyle').querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    savePrefs();
  });

  // Thema & Extras (eingeklappt, damit das Formular schlank bleibt)
  if (!TOUR_THEMES[t.theme]) t.theme = 'all';
  $('#tourTheme').innerHTML = Object.entries(TOUR_THEMES).map(([k, th]) =>
    `<button type="button" class="type-chip" role="radio" data-theme="${k}" aria-pressed="${t.theme === k}" style="--c:var(--accent-strong)">${icon(th.icon, { size: 15 })}<span>${th.label}</span></button>`).join('');
  $('#tourTheme').addEventListener('click', e => {
    const b = e.target.closest('[data-theme]');
    if (!b) return;
    t.theme = b.dataset.theme;
    $('#tourTheme').querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    pool = [];
    savePrefs();
    extrasSummary();
  });
  const sw = (id, key, def) => {
    const el = $(id);
    el.checked = t[key] == null ? def : !!t[key];
    el.addEventListener('change', () => { t[key] = el.checked; if (key === 'shops') pool = []; savePrefs(); extrasSummary(); });
  };
  sw('#tourCalm', 'calmLate', true);
  sw('#tourWind', 'wind', true);
  sw('#tourShops', 'shops', false);
  extrasSummary();
  setMode(t.roundtrip);

  $('#btnPlan').addEventListener('click', () => plan());
  $('#btnReroll').addEventListener('click', () => plan({ reroll: true }));
  $('#btnTourEdit').addEventListener('click', () => { $('#tourForm').hidden = false; $('#tourForm').scrollIntoView({ behavior: 'smooth' }); });
  $('#btnLive').addEventListener('click', () => emit('live-start'));
  initMoreMenu();

  $('#tourTimeline').addEventListener('click', onTimelineClick);
}

function extrasSummary() {
  const t = prefs.tour;
  const parts = [];
  if (t.theme && t.theme !== 'all') parts.push(TOUR_THEMES[t.theme].label);
  if (t.shops) parts.push('+ Läden');
  $('#tourExtrasSummary').textContent = parts.join(' · ');
}

// "Mehr"-Menü der fertigen Tour: Teilen, GPX, Google Maps, Bingo, Speichern.
function initMoreMenu() {
  const btn = $('#btnTourMore'), menu = $('#tourMoreMenu');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('#tourMoreWrap')) close(); });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-more]');
    if (!b) return;
    close();
    const a = b.dataset.more;
    if (a === 'share') shareTour();
    else if (a === 'gpx') exportGpx();
    else if (a === 'gmaps') openGmaps();
    else if (a === 'bingo') emit('open-bingo');
    else if (a === 'save') emit('tour-save');
  });
}

export function paintRange(el) {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--pct', `${pct}%`);
}

function startDate() {
  const [h, m] = ($('#tourStart').value || '').split(':').map(Number);
  const d = new Date();
  if (isFinite(h)) {
    d.setHours(h, m || 0, 0, 0);
    if (d.getTime() < Date.now() - 2 * 3600000) d.setDate(d.getDate() + 1); // Uhrzeit liegt weit zurück → morgen
  }
  return d;
}

function setProgress(text) {
  $('#tourProgress').hidden = false;
  $('#tourProgressText').textContent = text;
}

/* ---------- Thema ---------- */
function effectivePer05(p) {
  const s = getSummary(p.id);
  if (s.cheapest && !s.cheapest.stale) return s.cheapest.per05;
  const c = cheapestChainPrice(p);
  return c ? c.per05 : null;
}

// Pool nach Thema eingrenzen. → { list, note }
function themedPool(all, theme, k) {
  if (theme === 'brewery') {
    const list = all.filter(isBreweryLike);
    if (list.length < k) throw new Error(`Nur ${list.length} Brauerei${list.length === 1 ? '' : 'en'} in der Gegend — weniger Stopps, eine längere Tour oder ein anderes Thema probieren.`);
    return { list };
  }
  if (theme === 'biergarten') {
    const list = all.filter(isGardenLike);
    if (list.length < k) throw new Error(`Nur ${list.length} Biergärten bzw. Lokale mit Gastgarten in der Gegend — weniger Stopps oder ein anderes Thema probieren.`);
    return { list };
  }
  if (theme === 'cheap') {
    const priced = all.filter(p => effectivePer05(p) != null);
    if (priced.length >= k * 2) return { list: priced };
    return { list: all, note: `Nur ${priced.length} Lokale mit bekanntem Preis — die anderen Stopps sind nach Gefühl gewählt. Preise melden hilft!` };
  }
  return { list: all };
}

function themedQuality(theme, wx) {
  if (theme === 'cheap') {
    return p => {
      const v = effectivePer05(p);
      const bonus = v == null ? -0.12 : clamp((4.6 - v) / 3, -0.3, 0.45);
      return clamp(tourQuality(p, wx) + bonus, 0, 1);
    };
  }
  return p => tourQuality(p, wx);
}
const mixKey = p => (p.tags.brewery ? `bier:${p.tags.brewery.split(';')[0].trim().toLowerCase()}` : `typ:${p.type}`);

/* ---------- Planung ---------- */
async function plan({ reroll = false } = {}) {
  if (busy) return;
  const t = prefs.tour;
  const theme = TOUR_THEMES[t.theme] ? t.theme : 'all';
  $('#tourError').hidden = true;
  if (!state.location) {
    showError('Bitte zuerst oben einen Startpunkt festlegen — Standort teilen oder einen Ort suchen.');
    return;
  }
  if (!t.roundtrip && !dest) {
    // Ziel getippt, aber keinen Vorschlag gewählt → selbst auflösen
    const q = $('#tourDest').value.trim();
    if (q.length >= 2) {
      setProgress('Ziel wird gesucht…');
      try { [dest] = await searchPlaces(q, state.location, 1); } catch (e) { dest = null; }
      $('#tourProgress').hidden = true;
    }
    if (!dest) {
      showError(q ? `Ziel „${q}“ nicht gefunden.` : 'Bitte ein Ziel eingeben (oder „Rundtour“ wählen).');
      $('#tourDest').focus();
      return;
    }
  }
  busy = true;
  $('#btnPlan').disabled = true;
  $('#btnReroll').disabled = true;
  const start = { lat: state.location.lat, lon: state.location.lon };
  const end = t.roundtrip ? null : { lat: dest.lat, lon: dest.lon };
  const targetM = t.km * 1000;
  const startTime = startDate();
  if (!reroll) shownKeys = new Set();
  if (mobile()) setSheet('half');

  try {
    let note = null;
    if (!reroll || !pool.length || poolTheme !== theme) {
      setProgress('Bierorte in der Umgebung werden gesucht…');
      let types = t.shops ? [...TOUR_CORE_TYPES, ...TOUR_EXTRA_TYPES] : TOUR_CORE_TYPES;
      if (theme === 'brewery' || theme === 'biergarten') types = [...new Set([...types, 'restaurant'])]; // Brauhäuser & Gastgärten sind oft "Restaurant"
      const center = end ? { lat: (start.lat + end.lat) / 2, lon: (start.lon + end.lon) / 2 } : start;
      const direct = end ? haversine(start.lat, start.lon, end.lat, end.lon) : 0;
      const radius = clamp(end ? Math.max(direct / 2 + 1500, targetM * 0.3) : targetM * 0.36 + 600, 1000, 22000);
      const { places } = await fetchPlacesAround(center, radius, types, { ref: start, limit: 0 });
      // Orte ohne Namen findet man vor Ort schlecht — nur nehmen, wenn sonst zu wenig da ist.
      const visible = places.filter(p => !isHidden(p.id));
      const named = visible.filter(p => !p.unnamed);
      const base = named.length >= t.stops * 3 ? named : visible;
      rememberPlaces(base);
      // Bewertungen/Preise fließen in die Qualität ein — Fehler hier sind egal.
      try { await loadSummaries(base.slice(0, 600).map(p => p.id)); } catch (e) { /* weiter ohne */ }
      const themed = themedPool(base, theme, t.stops);
      pool = themed.list;
      note = themed.note || null;
      poolTheme = theme;
      if (pool.length < t.stops) {
        throw new Error(`Nur ${pool.length} passende Orte in der Gegend gefunden. Mehr Ortstypen erlauben („Thema & Extras“), die Länge ändern oder weniger Stopps wählen.`);
      }
    }

    // Wetter während der Tour (Vorhersage): Biergärten bei Sonne, drinnen bei Regen, Wind.
    const estEnd = new Date(startTime.getTime() + (targetM / 4.2 + t.stops * t.dwell * 60) * 1000);
    const wx = weatherForWindow(state.weather, startTime, estEnd);
    lastWx = wx;
    const wind = t.wind !== false && wx && wx.wind ? wx.wind : null;

    const country = state.country;
    const result = await planTour({
      pool, start, end, targetM, k: t.stops, style: t.style,
      startTime, dwellSec: t.dwell * 60,
      quality: themedQuality(theme, wx),
      isOpenAt: (p, date) => isOpenAt(p.tags.opening_hours, date, country),
      reroll, avoidKeys: shownKeys,
      wind, diversityKey: theme === 'mix' ? mixKey : null, calmLate: t.calmLate !== false,
      onProgress: ({ phase, step }) => setProgress(
        phase === 'shape' ? 'Schönste Tourform wird gesucht…'
          : phase === 'route' ? 'Fahrradroute wird berechnet…'
          : phase === 'reverse' ? 'Prüfe, ob andersrum weniger Anstiege nach den Bieren kommen…'
          : `Feinschliff auf ${t.km} km (Runde ${step})…`),
    });
    shownKeys.add(result.variant.key);
    tour = { ...result, theme, wind, wx, note };
    state.tour = tour;
    renderTour({ animate: true });
  } catch (e) {
    showError(e.message || String(e));
  } finally {
    busy = false;
    $('#btnPlan').disabled = false;
    $('#btnReroll').disabled = false;
    $('#tourProgress').hidden = true;
  }
}

function showError(msg) {
  const el = $('#tourError');
  el.hidden = false;
  el.innerHTML = `${icon('alertTriangle', { size: 18 })}<div>${escapeHtml(msg)}</div>`;
}

/* ---------- Zeitplan ---------- */
function schedule(tr) {
  const out = [];
  let t = tr.startTime.getTime();
  tr.stops.forEach((s, i) => {
    t += tr.route.legs[i].duration * 1000;
    const arrive = new Date(t);
    t += tr.dwellSec * 1000;
    out.push({ stop: s, arrive, leave: new Date(t), leg: tr.route.legs[i] });
  });
  const last = tr.route.legs[tr.route.legs.length - 1];
  const endTime = new Date(t + last.duration * 1000);
  return { rows: out, endTime, lastLeg: last };
}

/* ---------- Darstellung ---------- */
export function renderTour({ animate = false, fit = true } = {}) {
  if (!tour) return;
  const tr = tour;
  const live = state.live;
  const { rows, endTime, lastLeg } = schedule(tr);
  const ls = live ? liveSchedule(tr, live) : null;
  const r = tr.route;
  const dev = (r.distance - tr.targetM) / tr.targetM;
  const legs = r.legs.map(l => l.distance);
  const lst = legStats(legs);

  $('#tourForm').hidden = true;
  $('#tourResult').hidden = false;
  $('#tourResult').classList.toggle('is-live', !!live);
  $('#tourTitle').textContent = live ? 'Unterwegs' : tr.roundtrip ? 'Deine Bier-Rundtour' : 'Deine Biertour';
  $('#btnTourEdit').hidden = !!live;

  const devText = Math.abs(dev) <= TOUR_TOLERANCE ? `≈ Wunsch ${tr.targetM / 1000} km` : `${dev > 0 ? '+' : '−'}${Math.round(Math.abs(dev) * 100)} % vs. ${tr.targetM / 1000} km`;
  const devTone = Math.abs(dev) <= TOUR_TOLERANCE ? 'good' : Math.abs(dev) <= 0.2 ? 'warn' : 'bad';
  $('#tourStats').innerHTML = `
    <div class="stat stat-hero"><span class="stat-ico">${icon('route', { size: 18 })}</span><b><span data-num="${(r.distance / 1000).toFixed(1)}" data-dec="1">0</span> km</b><small class="tone-${devTone}">${devText}</small></div>
    <div class="stat"><span class="stat-ico">${icon('bike', { size: 18 })}</span><b>${fmtDuration(r.duration)}</b><small>reine Fahrzeit</small></div>
    <div class="stat"><span class="stat-ico">${icon('clock', { size: 18 })}</span><b>${fmtClock(endTime)}</b><small>zurück · ${fmtDuration((endTime - tr.startTime) / 1000)} gesamt</small></div>
    <div class="stat"><span class="stat-ico">${icon('mountain', { size: 18 })}</span><b>${r.ascent.up != null ? `<span data-num="${r.ascent.up}" data-dec="0">0</span> Hm` : '–'}</b><small>bergauf</small></div>
    <div class="stat"><span class="stat-ico">${icon('beerMug', { size: 18 })}</span><b>${tr.stops.length}</b><small>Bierstopps</small></div>
    <div class="stat"><span class="stat-ico">${icon('activity', { size: 18 })}</span><b>${fmtKm(Math.min(...legs))}–${fmtKm(Math.max(...legs))} km</b><small>pro Etappe${lst.cv < 0.3 ? ' · gleichmäßig' : ''}</small></div>`;
  $('#tourStats').querySelectorAll('[data-num]').forEach(el => {
    if (animate) animateNumber(el, Number(el.dataset.num), { decimals: Number(el.dataset.dec), duration: 900 });
    else el.textContent = Number(el.dataset.num).toFixed(Number(el.dataset.dec)).replace('.', ',');
  });

  // Wetter während der Tour
  const w = weatherForWindow(state.weather, tr.startTime, endTime);
  $('#tourWeather').innerHTML = w ? `<div class="weather-strip">
      ${icon(weatherIcon(w.code), { size: 22 })}
      <span><b>${Math.round(w.min)}–${Math.round(w.max)} °C</b>, ${weatherText(w.code)}${w.wind && w.wind.speed >= 10 ? ` · Wind ${w.wind.speed} km/h aus ${windDirName(w.wind.from)}` : ''}</span>
      <span class="rain ${w.rain >= 50 ? 'tone-bad' : w.rain >= 25 ? 'tone-warn' : ''}">${icon('umbrella', { size: 15 })}${w.rain} %</span>
    </div>` : '';

  // Hinweise
  const hints = [];
  if (!r.bikeFriendly) hints.push(['alertTriangle', 'Der Fahrrad-Router war nicht erreichbar — das ist eine Standard-Route ohne Radweg-Vorliebe.']);
  if (tr.note) hints.push(['info', escapeHtml(tr.note)]);
  if (tr.evenerK && tr.evenerK < tr.stops.length) hints.push(['info', `Für ${tr.stops.length} Stopps liegen die Bierorte hier ungünstig verteilt. Mit ${tr.evenerK} Stopps wird die Tour gleichmäßiger. <button class="link-btn" data-even="${tr.evenerK}">Mit ${tr.evenerK} Stopps planen</button>`]);
  if (tr.k < tr.requestedK) hints.push(['info', `Nur ${tr.k} statt ${tr.requestedK} Stopps möglich — mehr Orte gibt die Gegend nicht her.`]);
  const sortedLegs = legs.slice().sort((a, b) => a - b);
  const median = sortedLegs[Math.floor(sortedLegs.length / 2)];
  const gapIdx = legs.findIndex(l => l > median * 2.2 && l > 2500);
  if (gapIdx >= 0 && !tr.evenerK) {
    const from = gapIdx === 0 ? 'Start' : `Stopp ${gapIdx}`;
    const to = gapIdx === legs.length - 1 ? 'Ziel' : `Stopp ${gapIdx + 1}`;
    hints.push(['info', `Zwischen ${from} und ${to} (${fmtDist(legs[gapIdx])}) gibt es keine passenden Bierorte — da hilft nur durchradeln.`]);
  }
  if (r.overlap > 0.25) hints.push(['info', `Etwa ${Math.round(r.overlap * 100)} % der Strecke fährst du doppelt (Stichstraßen). „Andere Route“ probieren?`]);
  if (dev > 0.2) hints.push(['info', 'Deutlich länger als gewünscht — die passenden Orte liegen weiter auseinander.']);
  else if (dev < -0.2) hints.push(['info', 'Kürzer als gewünscht — weiter draußen gibt es keine passenden Orte.']);
  if (tr.wx && tr.wx.rainy) hints.push(['cloudRain', tr.theme === 'biergarten' ? 'Regen angesagt — für eine Biergarten-Runde eher ungünstig.' : 'Regen angesagt — Lokale mit Innenraum wurden bevorzugt, Biergärten gemieden.']);
  else if (tr.wx && tr.wx.sunny) hints.push(['sun', 'Biergartenwetter — Lokale mit Garten wurden bevorzugt.']);
  if (tr.reversed) hints.push(['mountain', 'Andersrum gefahren: so liegen die Anstiege vor den Bieren statt danach.']);
  if (tr.wind && tr.wind.speed >= 12 && tr.effort && tr.roundtrip) {
    hints.push(['activity', tr.effort.headwind < -0.15 ? `Rückenwind auf dem Heimweg (Wind aus ${windDirName(tr.wind.from)}, ${tr.wind.speed} km/h).` : tr.effort.headwind > 0.15 ? `Gegen Ende Gegenwind (aus ${windDirName(tr.wind.from)}, ${tr.wind.speed} km/h) — anders ging's hier nicht.` : `Wind aus ${windDirName(tr.wind.from)} (${tr.wind.speed} km/h) kommt meist von der Seite.`]);
  }
  const bac = projectBac(rows);
  if (bac) hints.push([bac.over ? 'alertTriangle' : 'beerMug', bac.text]);
  $('#tourHints').innerHTML = hints.map(([ic, h]) => `<div class="hint-row">${icon(ic, { size: 16 })}<span>${h}</span></div>`).join('');
  $('#tourHints').querySelectorAll('[data-even]').forEach(b => b.onclick = () => {
    prefs.tour.stops = Number(b.dataset.even); savePrefs();
    $('#tourStopsValue').textContent = prefs.tour.stops;
    plan();
  });

  renderElevation(r, rows);

  // Zeitleiste (live: tatsächliche Lage und neu berechnete Zeiten)
  const lrow = i => ls && ls.rows[i];
  const legHm = leg => (leg.up != null && leg.up >= 15 ? ` · ${icon('mountain', { size: 12 })}${leg.up} Hm` : '');
  $('#tourTimeline').innerHTML = `
    <li class="tl-item tl-start${live ? ' tl-done' : ''}" style="--i:0">
      <span class="tl-dot">${icon('flag', { size: 14, strokeWidth: 2.2 })}</span>
      <div class="tl-body"><b>Start</b><small>${fmtClock(live ? new Date(live.startedAt) : tr.startTime)} Uhr${state.locationLabel && !live ? ' · ' + escapeHtml(state.locationLabel) : ''}</small></div>
    </li>
    ${rows.map((row, i) => {
      const s = row.stop, m = TYPE_META[s.type];
      const lr = lrow(i);
      const arrive = lr && lr.arrive ? lr.arrive : row.arrive;
      const leave = lr && lr.leave ? lr.leave : row.leave;
      const st = placeStatus(s, arrive);
      const b = statusBadge(st);
      const closesEarly = st && st.open && st.until && st.until < leave;
      const openAtArrival = st ? (st.open ? (closesEarly ? `${icon('alertTriangle', { size: 13 })} schließt ${fmtClock(st.until)}` : `${icon('checkCircle', { size: 13 })} offen bei Ankunft`) : `${icon('alertTriangle', { size: 13 })} ${b.text}`) : `${icon('info', { size: 13 })} Zeiten unbekannt`;
      const tone = st ? (st.open && !closesEarly ? 'open' : 'closed') : 'unknown';
      const status = lr ? lr.status : '';
      const done = status === 'done';
      const times = done ? (lr.arrive ? `war da ${fmtClock(lr.arrive)}` : 'übersprungen')
        : status === 'here' ? `seit ${fmtClock(lr.arrive)} · weiter ca. ${fmtClock(lr.leave)}`
        : `an ${fmtClock(arrive)} – ab ${fmtClock(leave)}`;
      const shift = lr && !done && status !== 'here' ? Math.round((lr.arrive - lr.plannedArrive) / 60000) : 0;
      return `<li class="tl-leg${done || status === 'here' ? ' tl-done' : ''}" style="--i:${i * 2 + 1}"><span>${icon('bike', { size: 13 })}${fmtDist(row.leg.distance)} · ${fmtDuration(row.leg.duration)}${legHm(row.leg)}</span></li>
      <li class="tl-item${done ? ' tl-done' : ''}${status === 'here' ? ' tl-here' : ''}${status === 'next' ? ' tl-next' : ''}" data-stop="${i}" style="--c:${m.color};--i:${i * 2 + 2}">
        <span class="tl-dot tl-num">${done ? icon('check', { size: 15, strokeWidth: 3 }) : i + 1}</span>
        <div class="tl-body">
          <button class="tl-name" data-open="${s.id}">${escapeHtml(s.name)}</button>
          <small>${m.short} · ${times}${Math.abs(shift) >= 5 ? ` <span class="${shift > 0 ? 'tone-warn' : 'tone-good'}">(${shift > 0 ? '+' : '−'}${Math.abs(shift)} Min)</span>` : ''}</small>
          ${done ? '' : `<span class="status status-${tone}">${openAtArrival}</span>`}
        </div>
        ${done ? '' : `<div class="tl-actions">
          <button class="icon-btn small" data-swap="${i}" aria-label="Anderen Ort an dieser Stelle" title="Tauschen">${icon('shuffle', { size: 16 })}</button>
          ${tr.stops.length > 1 && status !== 'here' ? `<button class="icon-btn small" data-remove="${i}" aria-label="Stopp entfernen" title="Entfernen">${icon('x', { size: 16 })}</button>` : ''}
        </div>`}
      </li>`;
    }).join('')}
    <li class="tl-leg" style="--i:${rows.length * 2 + 1}"><span>${icon('bike', { size: 13 })}${fmtDist(lastLeg.distance)} · ${fmtDuration(lastLeg.duration)}${legHm(lastLeg)}</span></li>
    <li class="tl-item tl-end" style="--i:${rows.length * 2 + 2}">
      <span class="tl-dot">${icon(tr.roundtrip ? 'flag' : 'checkCircle', { size: 14, strokeWidth: 2.2 })}</span>
      <div class="tl-body"><b>${tr.roundtrip ? 'Zurück am Start' : 'Ziel'}</b><small>ca. ${fmtClock(ls ? ls.endTime : endTime)} Uhr${!tr.roundtrip && dest ? ' · ' + escapeHtml(dest.label) : ''}</small></div>
    </li>`;
  $('#tourTimeline').classList.toggle('animate', animate);

  mapview.showPlaceMarkers(false);
  const doneSet = live ? new Set(ls.rows.filter(x => x.status === 'done').map(x => x.i)) : null;
  mapview.drawRoute(tr, id => openPlace(id), { fit, done: doneSet });
  if (live) emit('live-redrawn');
}

// "1 Bier pro Stopp" hochrechnen und mit der Fahrrad-Grenze vergleichen.
function projectBac(rows) {
  if (!rows.length) return null;
  const { profile } = loadBac();
  const beer = DRINK_PRESETS.bier05;
  const drinks = rows.map(r => ({ ...beer, qty: 1, timestamp: r.arrive.getTime() + 5 * 60000 }));
  const last = rows[rows.length - 1].leave.getTime();
  const sim = simulateBac(profile, drinks, last);
  const peak = sim.peak;
  const limit = countryInfo(state.country).bike;
  const fmt = v => v.toFixed(2).replace('.', ',');
  const over = peak >= limit.bac;
  return {
    over,
    text: `Bei einem Bier (0,5 l) pro Stopp: bis zu ca. <b>${fmt(peak)} ‰</b>. ${over
      ? `Das liegt über der Fahrrad-Grenze (${fmt(limit.bac)} ‰, ${countryInfo(state.country).name}) — lieber Radler, Alkoholfreies oder schieben!`
      : `Fahrrad-Grenze in ${countryInfo(state.country).name}: ${fmt(limit.bac)} ‰.`} <small>(grobe Schätzung, Profil im Promille-Rechner)</small>`,
  };
}

/* ---------- Höhenprofil ---------- */
function renderElevation(route, rows) {
  const box = $('#tourElev');
  const ele = route.elevations;
  if (!ele || ele.filter(v => v != null).length < 5) { box.innerHTML = ''; return; }
  const total = route.cum[route.cum.length - 1] || route.distance;
  const N = 160;
  const pts = [];
  for (let i = 0, j = 0; i <= N; i++) {
    const d = (total * i) / N;
    while (j < route.cum.length - 1 && route.cum[j] < d) j++;
    pts.push({ d, e: ele[j] ?? ele.find(v => v != null), idx: j });
  }
  const es = pts.map(p => p.e);
  let min = Math.min(...es), max = Math.max(...es);
  if (max - min < 30) { const mid = (max + min) / 2; min = mid - 15; max = mid + 15; }
  const W = 600, H = 110, padT = 10, padB = 18;
  const x = d => (d / total) * W;
  const y = e => padT + (1 - (e - min) / (max - min)) * (H - padT - padB);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.e).toFixed(1)}`).join('');
  let acc = 0;
  const stopMarks = rows.map((r, i) => {
    acc += route.legs[i].distance;
    return `<g class="elev-stop" transform="translate(${x(Math.min(acc, total)).toFixed(1)},0)"><line y1="${padT}" y2="${H - padB}"/><circle cy="${padT - 2}" r="8"/><text y="${padT + 1}" text-anchor="middle">${i + 1}</text></g>`;
  }).join('');
  const prog = state.live ? clamp(state.live.progress / total, 0, 1) : 0;
  box.innerHTML = `
    <div class="elev-head"><span>${icon('mountain', { size: 14 })}Höhenprofil</span><small>${Math.round(min)}–${Math.round(max)} m</small></div>
    <svg viewBox="0 -8 ${W} ${H + 8}" preserveAspectRatio="none" role="img" aria-label="Höhenprofil der Tour">
      <defs><linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".55"/><stop offset="1" stop-color="var(--accent)" stop-opacity=".04"/></linearGradient></defs>
      <path class="elev-area" d="${line}L${W},${H - padB}L0,${H - padB}Z" fill="url(#elevGrad)"/>
      <path class="elev-line" d="${line}" fill="none"/>
      ${prog ? `<rect class="elev-done" x="0" y="0" width="${(prog * W).toFixed(1)}" height="${H - padB}"/><line class="elev-me" x1="${(prog * W).toFixed(1)}" x2="${(prog * W).toFixed(1)}" y1="${padT}" y2="${H - padB}"/>` : ''}
      ${stopMarks}
      <line class="elev-cursor" y1="${padT}" y2="${H - padB}" x1="-10" x2="-10"/>
    </svg>
    <div class="elev-axis"><span>0 km</span><span>${fmtKm(total / 2)} km</span><span>${fmtKm(total)} km</span></div>`;
  const svg = box.querySelector('svg');
  const cursor = box.querySelector('.elev-cursor');
  const move = e => {
    const rect = svg.getBoundingClientRect();
    const fx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const p = pts[Math.round(fx * N)];
    cursor.setAttribute('x1', fx * W); cursor.setAttribute('x2', fx * W);
    mapview.showTrackPoint(route.latlngs[p.idx]);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { cursor.setAttribute('x1', -10); cursor.setAttribute('x2', -10); mapview.showTrackPoint(null); });
}

/* ---------- Stopps bearbeiten ---------- */
async function onTimelineClick(e) {
  const open = e.target.closest('[data-open]');
  if (open) { openPlace(open.dataset.open); return; }
  const swap = e.target.closest('[data-swap]');
  const rem = e.target.closest('[data-remove]');
  if (!swap && !rem) return;
  if (busy) return;
  const i = Number((swap || rem).dataset.swap ?? (swap || rem).dataset.remove);
  if (swap) await swapStop(i);
  else await removeStop(i);
}

// Alternativen für Stopp i; bei laufender Tour nur Orte, die zur neuen Ankunftszeit offen haben.
export function alternativesFor(i, { arriveAt = null } = {}) {
  if (!tour) return [];
  const used = new Set(tour.stops.map(s => s.id));
  let alts = alternativesForStop(pool.length ? pool : tour.stops, tour.variant, i, used, tourQuality);
  if (arriveAt) alts = alts.filter(p => isOpenAt(p.tags.opening_hours, arriveAt, state.country) !== false);
  return alts;
}

export async function swapStop(i, { replacement = null, arriveAt = null } = {}) {
  const stops = tour.stops.slice();
  let pick = replacement;
  if (!pick) {
    tour.swapHistory = tour.swapHistory || {};
    const tried = tour.swapHistory[i] || (tour.swapHistory[i] = new Set([stops[i].id]));
    let alts = alternativesFor(i, { arriveAt }).filter(p => !tried.has(p.id));
    if (!alts.length) { tried.clear(); tried.add(stops[i].id); alts = alternativesFor(i, { arriveAt }); }
    if (!alts.length) { toast(arriveAt ? 'In der Nähe hat zu der Zeit nichts anderes offen.' : 'Hier gibt es keine Alternative in der Nähe.'); return false; }
    pick = alts[0];
    tried.add(pick.id);
  }
  stops[i] = pick;
  return applyStops(stops, { i, label: `Neu: ${pick.name}` });
}

async function removeStop(i) {
  const stops = tour.stops.slice();
  stops.splice(i, 1);
  const variant = { ...tour.variant, anchors: tour.variant.anchors.slice() };
  variant.anchors.splice(i, 1);
  tour = { ...tour, variant, swapHistory: {} };
  if (state.live) emit('live-stop-removed', i);
  return applyStops(stops, { i });
}

async function applyStops(stops, { i, label = null }) {
  busy = true;
  const li = document.querySelector(`#tourTimeline [data-stop="${i}"]`);
  if (li) li.classList.add('working');
  try {
    tour = await rerouteTour(tour, stops);
    state.tour = tour;
    emit('tour-changed', tour);
    renderTour({ fit: !state.live });
    if (label) toast(escapeHtml(label), { ms: 1800 });
    return true;
  } catch (err) {
    toast('Neuberechnung fehlgeschlagen: ' + err.message, { tone: 'bad' });
    renderTour({ fit: false });
    return false;
  } finally {
    busy = false;
  }
}

/* ---------- Export & Teilen ---------- */
function xmlEsc(s) { return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }

function exportGpx() {
  if (!tour) return;
  const r = tour.route;
  const trkpts = r.latlngs.map(([lat, lon], i) => `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${r.elevations[i] != null ? `<ele>${r.elevations[i]}</ele>` : ''}</trkpt>`).join('\n');
  const wpts = tour.stops.map((s, i) => `<wpt lat="${s.lat}" lon="${s.lon}"><name>${i + 1}. ${xmlEsc(s.name)}</name><type>${xmlEsc(TYPE_META[s.type].label)}</type></wpt>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Bier-Locator" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>Bier-Radtour ${(r.distance / 1000).toFixed(1)} km</name><time>${new Date().toISOString()}</time></metadata>
${wpts}
<trk><name>Bier-Radtour</name><trkseg>
${trkpts}
</trkseg></trk>
</gpx>`;
  downloadFile(`bier-radtour-${Math.round(r.distance / 1000)}km.gpx`, gpx, 'application/gpx+xml');
  toast('GPX gespeichert — passt in Komoot, Garmin & Co.', { tone: 'good' });
}

function openGmaps() {
  if (!tour) return;
  const params = new URLSearchParams({
    api: '1', origin: `${tour.start.lat},${tour.start.lon}`, destination: `${tour.end.lat},${tour.end.lon}`, travelmode: 'bicycling',
  });
  params.set('waypoints', tour.stops.slice(0, 9).map(s => `${s.lat},${s.lon}`).join('|'));
  window.open(`https://www.google.com/maps/dir/?${params}`, '_blank', 'noopener');
  if (tour.stops.length > 9) toast('Google Maps übernimmt nur die ersten 9 Stopps.');
}

export function currentTourLink() {
  if (!tour) return null;
  return tourLink({
    start: tour.start, end: tour.roundtrip ? null : tour.end, stopIds: tour.stops.map(s => s.id),
    style: tour.style, km: tour.targetM / 1000, dwell: tour.dwellSec / 60,
  });
}

async function shareTour() {
  if (!tour) return;
  const res = await shareLink({ title: 'Bier-Radtour', text: `${(tour.route.distance / 1000).toFixed(1)} km, ${tour.stops.length} Bierstopps — fährst du mit?`, url: currentTourLink() });
  if (res === 'copied') toast('Tour-Link kopiert!', { tone: 'good' });
  else if (res === 'failed') toast('Teilen nicht möglich', { tone: 'bad' });
}

// Geteilte Tour aus einem Link laden.
export async function loadSharedTour(t) {
  setProgress('Geteilte Tour wird geladen…');
  $('#tourForm').hidden = true;
  $('#tourResult').hidden = true;
  try {
    const stops = await fetchPlacesByIds(t.stopIds);
    if (!stops.length) throw new Error('Die Orte dieser Tour gibt es nicht mehr.');
    rememberPlaces(stops);
    const end = t.end || t.start;
    const route = await routeThrough([t.start, ...stops, end], t.style);
    const startTime = new Date(Math.ceil(Date.now() / (15 * 60000)) * 15 * 60000);
    tour = {
      stops, route, start: t.start, end, roundtrip: !t.end, style: t.style,
      targetM: (t.km || route.distance / 1000) * 1000, startTime, dwellSec: (t.dwell || 30) * 60,
      k: stops.length, requestedK: stops.length, evenerK: null,
      variant: { anchors: stops.map(s => ({ lat: s.lat, lon: s.lon })), spacing: route.distance / (stops.length + 1), key: 'shared' },
    };
    if (t.end) dest = { ...t.end, label: 'Ziel' };
    state.tour = tour;
    if (state.live) emit('tour-changed', tour);
    renderTour({ animate: !state.live, fit: !state.live });
  } catch (e) {
    $('#tourForm').hidden = false;
    showError(e.message);
  } finally {
    $('#tourProgress').hidden = true;
  }
}

// Gespeicherte Tour (z.B. eine laufende Live-Tour nach dem Neuladen) direkt übernehmen.
export function setTour(t) {
  tour = t;
  state.tour = t;
  if (!t.roundtrip) dest = { ...t.end, label: 'Ziel' };
}
export const getTour = () => tour;

export function onTourModeShown() {
  if (tour) { mapview.showPlaceMarkers(false); renderTour({ fit: !state.live }); }
  else mapview.showPlaceMarkers(true);
}
export function onTourModeHidden() {
  mapview.clearRoute();
  mapview.showPlaceMarkers(true);
}
export function hasTour() { return !!tour; }
export function tourWeather() { return lastWx; }
