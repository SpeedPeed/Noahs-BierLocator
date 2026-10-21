// Live-Tour: GPS verfolgen, nächster Stopp mit Entfernung & Ankunftszeit,
// Verspätung zum Plan, Warnung wenn ein späterer Stopp dann schon zu hat (mit
// Ersatzvorschlag), Ankunft/Abfahrt automatisch, Tour-Ende mit Zusammenfassung.
import { state, on, emit } from '../state.js';
import { TYPE_META } from '../places.js';
import { placeStatus } from '../placeInfo.js';
import { newLive, updateLive, liveSchedule, arrive, depart, skip, stopAlongs, serializeTour, reviveTour } from '../tour/live.js';
import { addTour, loadDiary, loadTours } from '../store.js';
import { icon } from '../icons.js';
import { escapeHtml, fmtDist, fmtClock, fmtDuration, fmtKm, clamp } from '../util.js';
import { $, toast, openMisc, closeMisc } from './dom.js';
import { renderTour, getTour, setTour, swapStop, currentTourLink } from './tourUi.js';
import { openDiary } from './diaryUi.js';
import { setSheet, mobile } from './sheet.js';
import * as mapview from '../map.js';

const KEY = 'bl_live_v1';
let watchId = null, wakeLock = null, lastRender = 0, lastTimeline = 0, lastSave = 0, lastPos = null;
let groupTick = () => {}, groupStop = () => {}, groupMates = () => [];

export function initLive({ onGroupTick, onGroupStop, groupMembers, setMode }) {
  groupTick = onGroupTick || groupTick;
  groupStop = onGroupStop || groupStop;
  groupMates = groupMembers || groupMates;
  on('live-start', () => start());
  on('live-redrawn', () => drawProgress());
  on('tour-changed', () => { if (state.live) { resyncProgress(); persist(true); renderCard(); } });
  on('live-stop-removed', i => { if (state.live) shiftAfterRemove(i); });
  on('tour-save', () => saveFinished({ planned: true }));
  $('#tourLive').addEventListener('click', onCardClick);
  mapview.onUserDrag(() => { if (state.live && mapview.isFollowing()) { mapview.setFollow(false); renderCard(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.live) requestWakeLock(); });

  // Laufende Tour nach dem Neuladen fortsetzen?
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { saved = null; }
  if (saved && saved.live && Date.now() - saved.live.startedAt < 16 * 3600000) {
    setTimeout(() => toast('Deine Biertour läuft noch.', {
      ms: 9000, action: { label: 'Fortsetzen', run: () => { setTour(reviveTour(saved.tour)); setMode('tour'); start(saved.live); } },
    }), 1500);
  } else if (saved) localStorage.removeItem(KEY);
}

export const isLive = () => !!state.live;

/* ---------- Start / Ende ---------- */
function start(resume = null) {
  const tour = getTour();
  if (!tour) { toast('Erst eine Tour planen.'); return; }
  if (!navigator.geolocation) { toast('Dieses Gerät kann keinen Standort bestimmen.', { tone: 'bad' }); return; }
  if (!resume) {
    // Der Plan beginnt jetzt — sonst wäre man gleich "zu spät".
    tour.startTime = new Date();
    state.live = newLive();
  } else state.live = resume;
  persist(true);
  $('#tourLive').hidden = false;
  mapview.setFollow(true);
  requestWakeLock();
  watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  renderTour({ fit: false });
  renderCard();
  if (mobile()) setSheet('peek');
  if (!resume) toast('Gute Fahrt! Die App merkt selbst, wann du an einem Stopp bist.', { tone: 'good', ms: 3500 });
}

function stopTracking() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  mapview.setFollow(false);
  groupStop();
}

async function requestWakeLock() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } }
  catch (e) { /* Bildschirm darf ausgehen */ }
}

function persist(force = false) {
  if (!state.live) return;
  if (!force && Date.now() - lastSave < 20000) return;
  lastSave = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify({ tour: serializeTour(getTour()), live: state.live })); } catch (e) { /* voll */ }
}

/* ---------- GPS ---------- */
function onPosition(p) {
  const live = state.live;
  const tour = getTour();
  if (!live || !tour) return;
  const pos = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy };
  lastPos = pos;
  state.location = { ...pos };
  mapview.setUserLocation(pos);
  mapview.followTo(pos.lat, pos.lon);
  const events = updateLive(live, tour, pos);
  for (const ev of events) handleEvent(ev, tour);
  drawProgress();
  groupTick(pos);
  const now = Date.now();
  if (events.length || now - lastRender > 4000) {
    lastRender = now;
    renderCard();
    if (events.length || now - lastTimeline > 15000) { lastTimeline = now; renderTour({ fit: false }); }
  }
  persist(events.length > 0);
}

function onGeoError(e) {
  if (e.code === 1) {
    toast('Ohne Standortzugriff kann die Live-Tour nicht mitfahren. Du kannst „Bin da“ / „Weiter“ selbst tippen.', { tone: 'bad', ms: 6000 });
  }
  renderCard();
}

function handleEvent(ev, tour) {
  if (navigator.vibrate) navigator.vibrate(ev.type === 'arrive' ? [80, 60, 80] : 60);
  if (ev.type === 'arrive') {
    const s = tour.stops[ev.i];
    toast(`Angekommen: ${escapeHtml(s.name)} — Prost! 🍺`, { tone: 'good', ms: 7000, action: { label: 'Einchecken', run: () => openDiary(s) } });
  } else if (ev.type === 'leave') {
    const next = tour.stops[ev.i + 1];
    toast(next ? `Weiter zu ${escapeHtml(next.name)}` : 'Auf zum Ziel!', { ms: 2500 });
  } else if (ev.type === 'finish') {
    finish();
  }
}

/* ---------- Karte ---------- */
function drawProgress() {
  const live = state.live, tour = getTour();
  if (!live || !tour || state.mode !== 'tour') return;
  const { latlngs, cum } = tour.route;
  const done = [];
  for (let i = 0; i < latlngs.length && cum[i] <= live.progress; i++) done.push(latlngs[i]);
  mapview.setRouteProgress(done);
}

// Nach Tauschen/Entfernen hat die Route eine neue Form: Fortschritt auf den letzten
// erledigten Stopp setzen, die nächste GPS-Messung holt den Rest auf.
function resyncProgress() {
  const live = state.live, tour = getTour();
  const along = stopAlongs(tour.route);
  const lastDone = live.here != null ? live.here : live.next - 1;
  live.progress = lastDone >= 0 ? along[lastDone] || 0 : 0;
  if (lastPos) updateLive(live, tour, lastPos);
}

function shiftAfterRemove(i) {
  const live = state.live;
  const shift = obj => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) { const n = +k; if (n < i) out[n] = v; else if (n > i) out[n - 1] = v; }
    return out;
  };
  live.arrivals = shift(live.arrivals);
  live.departures = shift(live.departures);
  if (live.here != null && live.here > i) live.here--;
  if (live.next > i) live.next--;
}

/* ---------- Live-Karte im Sheet ---------- */
function renderCard() {
  const live = state.live, tour = getTour();
  const box = $('#tourLive');
  if (!live || !tour) { box.hidden = true; box.innerHTML = ''; return; }
  const ls = liveSchedule(tour, live);
  const total = tour.route.cum[tour.route.cum.length - 1] || tour.route.distance;
  const pct = clamp(live.progress / total, 0, 1);
  const along = stopAlongs(tour.route);
  const here = live.here != null ? tour.stops[live.here] : null;
  const nextI = live.next;
  const atEnd = nextI >= tour.stops.length;
  const target = here || (atEnd ? null : tour.stops[nextI]);
  const row = ls.rows.find(r => r.status === 'here' || r.status === 'next');
  const delay = ls.delayMin;
  const delayTxt = Math.abs(delay) < 3 ? '<span class="tone-good">im Plan</span>'
    : delay > 0 ? `<span class="tone-warn">${delay} Min hinter Plan</span>` : `<span class="tone-good">${-delay} Min vor Plan</span>`;

  // Spätere Stopps, die bei der neuen Ankunftszeit zu haben
  const warns = ls.rows.filter(r => r.status === 'next' || r.status === 'later').map(r => {
    const s = tour.stops[r.i];
    const st = placeStatus(s, r.arrive);
    if (!st) return null;
    if (!st.open) return { i: r.i, text: `${escapeHtml(s.name)} hat bei Ankunft (${fmtClock(r.arrive)}) zu.` };
    if (st.until && st.until < r.leave) return { i: r.i, text: `${escapeHtml(s.name)} schließt schon ${fmtClock(st.until)}.` };
    return null;
  }).filter(Boolean);

  const m = target ? TYPE_META[target.type] : null;
  const ticks = along.map((a, i) => `<i class="${i < nextI && live.here !== i ? 'done' : ''}" style="left:${(clamp(a / total, 0, 1) * 100).toFixed(1)}%"></i>`).join('');
  box.hidden = false;
  box.innerHTML = `
    <div class="live-top">
      <span class="live-dot"></span><b>Live</b>
      <span class="live-km">${fmtKm(live.progress)} / ${fmtKm(total)} km</span>
      ${!mapview.isFollowing() ? `<button class="link-btn" data-live="follow">${icon('locate', { size: 14 })}Mitführen</button>` : ''}
      <button class="icon-btn small" data-live="end" aria-label="Tour beenden" title="Tour beenden">${icon('x', { size: 16 })}</button>
    </div>
    <div class="live-bar"><span style="width:${(pct * 100).toFixed(1)}%"></span>${ticks}</div>
    ${here ? `
      <div class="live-next" style="--c:${m.color}">
        <span class="live-num">${live.here + 1}</span>
        <div><small>Du bist bei</small><b>${escapeHtml(here.name)}</b><span>seit ${fmtClock(new Date(live.arrivals[live.here]))} · weiter ca. ${fmtClock(row.leave)} · ${delayTxt}</span></div>
      </div>
      <div class="live-actions">
        <button class="btn btn-primary" data-live="checkin">${icon('beerMug', { size: 17 })}Einchecken</button>
        <button class="btn btn-soft" data-live="leave">${icon('bike', { size: 17 })}Weiter</button>
      </div>`
    : target ? `
      <div class="live-next" style="--c:${m.color}">
        <span class="live-num">${nextI + 1}</span>
        <div><small>Nächster Stopp</small><b>${escapeHtml(target.name)}</b><span>${ls.toNext != null ? fmtDist(ls.toNext) : '–'} · an ${fmtClock(row.arrive)} · ${delayTxt}</span></div>
      </div>
      <div class="live-actions">
        <button class="btn btn-soft" data-live="arrive">${icon('flag', { size: 17 })}Bin da</button>
        <button class="btn btn-soft" data-live="skip">${icon('chevronRight', { size: 17 })}Überspringen</button>
      </div>`
    : `
      <div class="live-next">
        <span class="live-num">${icon(tour.roundtrip ? 'flag' : 'checkCircle', { size: 16, strokeWidth: 2.2 })}</span>
        <div><small>Letzte Etappe</small><b>${tour.roundtrip ? 'Zurück zum Start' : 'Zum Ziel'}</b><span>${ls.toNext != null ? fmtDist(ls.toNext) : '–'} · an ca. ${fmtClock(ls.endTime)}</span></div>
      </div>
      <div class="live-actions"><button class="btn btn-primary" data-live="end">${icon('checkCircle', { size: 17 })}Tour beenden</button></div>`}
    ${warns.map(w => `<div class="live-warn">${icon('alertTriangle', { size: 15 })}<span>${w.text}</span><button class="link-btn" data-live="replace" data-i="${w.i}">Ersatz suchen</button></div>`).join('')}
    ${live.offRoute ? `<p class="fine">${icon('compass', { size: 13 })} Du bist gerade abseits der Route.</p>` : ''}
    ${watchId == null ? '' : !lastPos ? `<p class="fine">${icon('locate', { size: 13 })} Warte auf GPS…</p>` : ''}
    <div class="live-tools">
      <button class="chip-btn" data-live="home">${icon('home', { size: 15 })}Heimweg</button>
      <button class="chip-btn" data-live="bingo">${icon('grid', { size: 15 })}Bingo</button>
      <button class="chip-btn" data-live="group">${icon('users', { size: 15 })}Runde</button>
    </div>`;
}

async function onCardClick(e) {
  const b = e.target.closest('[data-live]');
  if (!b) return;
  const live = state.live, tour = getTour();
  if (!live || !tour) return;
  const a = b.dataset.live;
  const now = Date.now();
  if (a === 'arrive' && live.next < tour.stops.length) {
    arrive(live, live.next, now);
    handleEvent({ type: 'arrive', i: live.next }, tour);
  } else if (a === 'leave' && live.here != null) {
    const i = live.here;
    depart(live, i, now);
    handleEvent({ type: 'leave', i }, tour);
  } else if (a === 'skip' && live.next < tour.stops.length) {
    skip(live, live.next);
    toast('Stopp übersprungen');
  } else if (a === 'checkin') {
    openDiary(tour.stops[live.here]);
    return;
  } else if (a === 'replace') {
    const i = Number(b.dataset.i);
    const row = liveSchedule(tour, live).rows.find(r => r.i === i);
    b.disabled = true;
    await swapStop(i, { arriveAt: row ? row.arrive : null });
    return;
  } else if (a === 'follow') {
    mapview.setFollow(true);
    if (lastPos) mapview.followTo(lastPos.lat, lastPos.lon);
  } else if (a === 'end') { confirmEnd(); return; }
  else if (a === 'home') { emit('open-home'); return; }
  else if (a === 'bingo') { emit('open-bingo'); return; }
  else if (a === 'group') { emit('open-group'); return; }
  persist(true);
  renderCard();
  renderTour({ fit: false });
}

/* ---------- Tour-Ende ---------- */
function summary() {
  const live = state.live, tour = getTour();
  const visited = Object.keys(live.arrivals).length;
  const beers = loadDiary().filter(e => !e.deleted && e.at >= live.startedAt).length;
  const secs = (Date.now() - live.startedAt) / 1000;
  return { visited, beers, secs, ridden: live.ridden, planned: tour.route.distance };
}

function confirmEnd() {
  const s = summary();
  const body = openMisc(`
    <h2 class="dlg-title">${icon('flag', { size: 22 })}Tour beenden?</h2>
    ${endStats(s)}
    <label class="switch-row"><input type="checkbox" class="switch" id="liveSave" ${s.ridden > 500 || s.visited ? 'checked' : ''}><span>In „Meine Touren“ speichern</span></label>
    <div class="row-btns">
      <button class="btn btn-soft" id="liveGoOn">${icon('bike', { size: 16 })}Weiterfahren</button>
      <button class="btn btn-primary" id="liveEnd">${icon('checkCircle', { size: 16 })}Beenden</button>
    </div>`);
  body.querySelector('#liveGoOn').onclick = closeMisc;
  body.querySelector('#liveEnd').onclick = () => { const save = body.querySelector('#liveSave').checked; closeMisc(); end({ save }); };
}

function endStats(s) {
  return `<div class="stat-grid">
    <div class="stat stat-hero"><span class="stat-ico">${icon('route', { size: 18 })}</span><b>${fmtKm(s.ridden > 300 ? s.ridden : s.planned)} km</b><small>${s.ridden > 300 ? 'gefahren' : 'geplant'}</small></div>
    <div class="stat"><span class="stat-ico">${icon('clock', { size: 18 })}</span><b>${fmtDuration(s.secs)}</b><small>unterwegs</small></div>
    <div class="stat"><span class="stat-ico">${icon('pin', { size: 18 })}</span><b>${s.visited}</b><small>Stopps besucht</small></div>
    <div class="stat"><span class="stat-ico">${icon('beerMug', { size: 18 })}</span><b>${s.beers}</b><small>Biere eingecheckt</small></div>
  </div>`;
}

function finish() {
  const s = summary();
  end({ save: true });
  openMisc(`
    <h2 class="dlg-title">${icon('checkCircle', { size: 22 })}Geschafft — Prost!</h2>
    ${endStats(s)}
    <p class="fine">Die Tour ist unter „Bier-Tagebuch → Touren“ gespeichert.</p>
    <button class="btn btn-primary btn-big" data-close>${icon('check', { size: 18 })}Super</button>`);
}

function end({ save }) {
  if (save) saveFinished({});
  stopTracking();
  state.live = null;
  localStorage.removeItem(KEY);
  mapview.setRouteProgress(null);
  $('#tourLive').hidden = true;
  renderTour({ fit: true });
}

// Tour ins Archiv ("Meine Touren"). planned = ohne Live-Aufzeichnung als gefahren eintragen.
function saveFinished({ planned = false }) {
  const tour = getTour();
  if (!tour) return;
  const live = planned ? null : state.live;
  const now = Date.now();
  const mates = groupMates();
  const stops = tour.stops.map((s, i) => ({ id: s.id, name: s.name, type: s.type, visited: live ? !!live.arrivals[i] : true }));
  const beers = live ? loadDiary().filter(e => !e.deleted && e.at >= live.startedAt).length : null;
  const entry = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, t: now,
    at: live ? live.startedAt : tour.startTime.getTime(), endAt: now,
    km: +((live && live.ridden > 300 ? live.ridden : tour.route.distance) / 1000).toFixed(1),
    plannedKm: +(tour.route.distance / 1000).toFixed(1), up: tour.route.ascent.up,
    stops, roundtrip: tour.roundtrip, style: tour.style, theme: tour.theme || 'all',
    link: currentTourLink(), mates, beers, country: state.country,
    track: simplify(live && live.track.length > 5 ? live.track : tour.route.latlngs, 120),
  };
  if (loadTours().some(t => !t.deleted && t.link === entry.link && Math.abs(t.at - entry.at) < 6 * 3600000)) {
    if (planned) { toast('Diese Tour ist schon gespeichert.'); return; }
  }
  addTour(entry);
  emit('tour-saved', entry);
  toast('Tour gespeichert — siehe Bier-Tagebuch → Touren', { tone: 'good' });
}

// Spur auf höchstens n Punkte ausdünnen (gleichmäßig).
function simplify(latlngs, n) {
  if (latlngs.length <= n) return latlngs.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = latlngs[Math.round(i * (latlngs.length - 1) / (n - 1))];
    out.push([+a.toFixed(5), +b.toFixed(5)]);
  }
  return out;
}
