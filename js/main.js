// Einstieg: verbindet Karte, Sheet, Suche, Modi und Dialoge.
import { hydrateIcons, icon } from './icons.js';
import { state, on } from './state.js';
import { prefs, savePrefs, loadTheme, saveTheme, loadLastLocation, saveLastLocation, exportBundle, importBundle } from './store.js';
import { getPosition, reverseGeocode, geolocationGranted } from './geo.js';
import { fetchWeather, weatherIcon, isBiergartenWeather } from './weather.js';
import { isShared, migrateLocalToShared, exportLocalCommunity, importLocalCommunity } from './community.js';
import { readHash, clearHash } from './share.js';
import { haversine } from './util.js';
import * as mapview from './map.js';
import { $, $$, toast, wireDialog, openDialog, closeDialog, downloadFile, initBack, syncBack } from './ui/dom.js';
import { initSheet, sheetOcclusion, setSheet, getSheet, mobile, onSheetChange } from './ui/sheet.js';
import { initFinder, searchAt, render as renderFinder, onRender, pricedPoints, currentRadius, beerSuggestion, findBeer, clearBeer } from './ui/finder.js';
import { initDetail, openPlace } from './ui/detail.js';
import { initTour, loadSharedTour, onTourModeShown, onTourModeHidden, paintRange } from './ui/tourUi.js';
import { attachAutocomplete } from './ui/autocomplete.js';
import { openBac } from './ui/bacUi.js';
import { initSync } from './sync.js';
import { openSync, joinFromLink } from './ui/syncUi.js';
import { openDiary, diaryBeerSuggestions, setTourLoader } from './ui/diaryUi.js';
import { openAlerts, checkAlerts, initAlerts } from './ui/alertsUi.js';
import { openGroupMenu, joinGroupFromLink, activeGroup, initGroup, groupLiveTick, groupLiveStop, groupMates } from './ui/groupUi.js';
import { initLive } from './ui/liveUi.js';
import { openHome } from './ui/homeUi.js';
import { openBingo, openSurprise } from './ui/funUi.js';
import { initBadges } from './ui/badgesUi.js';
import { showHeatmap, hideHeatmap } from './heatmap.js';
import { loadChainPrices } from './chainPrices.js';
import { yearStats } from './ui/wrappedUi.js';
import { t, num, LANG, LANGS, setLang, translateDom, privacyPage } from './i18n.js';

/* ---------- Theme ---------- */
function currentTheme() {
  const saved = loadTheme();
  if (saved === 'dark' || saved === 'light') return saved;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(theme, persist = false) {
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) saveTheme(theme);
  mapview.setMapTheme(theme);
}

/* ---------- Standort ---------- */
async function setLocation(loc, { label = null, country = null, search = true, fit = true } = {}) {
  state.location = { lat: loc.lat, lon: loc.lon, accuracy: loc.accuracy };
  mapview.setUserLocation(state.location);
  saveLastLocation({ lat: loc.lat, lon: loc.lon, label });
  setLocLabel(label || t('Standort wird bestimmt…'));
  if (search) {
    mapview.setView(loc.lat, loc.lon, 15);
    searchAt(state.location, null, { fit });
  }
  loadWeather(loc);
  if (country) setCountry(country);
  if (!label || !country) {
    const r = await reverseGeocode(loc.lat, loc.lon);
    if (r) {
      if (!label) { setLocLabel(r.short); saveLastLocation({ lat: loc.lat, lon: loc.lon, label: r.short }); }
      if (r.country) setCountry(r.country);
    } else if (!label) setLocLabel(t('Mein Standort'));
  }
}
// Neues Land: dessen Kettenpreise laden und die Liste neu zeichnen.
function setCountry(code) {
  if (code === state.country) return;
  state.country = code;
  loadChainPrices().then(() => renderFinder());
}
function setLocLabel(text) {
  state.locationLabel = text;
  $('#locLabel').textContent = text;
}

async function locate() {
  const btn = $('#btnLocate');
  btn.classList.add('busy');
  try {
    const pos = await getPosition();
    await setLocation(pos);
  } catch (e) {
    toast(t('{msg} Such stattdessen oben nach einem Ort.', { msg: e.message }), { tone: 'bad', ms: 4500 });
    $('#searchInput').focus();
  } finally {
    btn.classList.remove('busy');
  }
}

async function loadWeather(loc) {
  try {
    state.weather = await fetchWeather(loc.lat, loc.lon);
    const w = state.weather.current;
    const chip = $('#weatherChip');
    chip.hidden = false;
    chip.innerHTML = `${icon(weatherIcon(w.code), { size: 16 })}<b>${Math.round(w.temperature)}°</b>`;
    chip.classList.toggle('sunny', isBiergartenWeather(w));
    renderFinder();
  } catch (e) { /* Wetter ist nur ein Bonus */ }
}

/* ---------- Modus ---------- */
function setMode(mode) {
  state.mode = mode;
  $$('.tab').forEach(t => {
    const on = t.dataset.mode === mode;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $('.tabs').dataset.mode = mode;
  $('#paneFind').hidden = mode !== 'find';
  $('#paneTour').hidden = mode !== 'tour';
  $('#btnSearchArea').hidden = true;
  $('#sheetBody').scrollTop = 0;
  if (mode === 'tour') { onTourModeShown(); hideHeatmap(); $('#heatLegend').hidden = true; }
  else { onTourModeHidden(); renderFinder(); }
}

/* ---------- Preis-Heatmap ---------- */
let lastList = null;
function applyHeat(list) {
  $('#prefHeat').checked = !!prefs.heatmap;
  const legend = $('#heatLegend');
  if (!prefs.heatmap || state.mode !== 'find' || !list) { hideHeatmap(); legend.hidden = true; return; }
  const all = pricedPoints(list);
  const gastro = all.filter(p => p.gastro);
  const pts = gastro.length >= 3 ? gastro : all;
  const r = showHeatmap(pts);
  if (!r) { legend.hidden = true; return; }
  const f = v => num(v, 2);
  legend.hidden = false;
  legend.innerHTML = `<b>${t('Halbe')}</b><span>${f(r.hi)}</span><span class="hl-bar"></span><span>${f(r.lo)}</span><small>${pts === all && gastro.length < 3 ? t('{n} Preise, inkl. Läden', { n: r.n }) : t('{n} Preise', { n: r.n })}</small>`;
}
function toggleHeat() {
  prefs.heatmap = !prefs.heatmap;
  savePrefs();
  if (prefs.heatmap && state.mode !== 'find') setMode('find');
  applyHeat(lastList);
  if (prefs.heatmap) {
    const n = lastList ? pricedPoints(lastList).length : 0;
    toast(n >= 2 ? t('Preis-Heatmap an: grün = günstig, rot = teuer') : t('Heatmap an. Hier gibt es aber kaum Preise.'), { ms: 3500 });
  }
}

/* ---------- "In diesem Bereich suchen" ---------- */
function onMapMoved() {
  // Bei der Bier-Suche zoomt die App selbst auf die Treffer; "hier suchen" wäre dann nur verwirrend.
  if (state.mode !== 'find' || !state.searchCenter || $('#filterBeer').value) return;
  const { center, radius } = mapview.getViewInfo();
  const moved = haversine(center.lat, center.lon, state.searchCenter.lat, state.searchCenter.lon);
  $('#btnSearchArea').hidden = moved < Math.max(250, currentRadius() * 0.4) || (mobile() && getSheet() === 'full');
  $('#btnSearchArea').dataset.radius = String(Math.round(Math.max(400, Math.min(radius, 6000))));
}

/* ---------- Menü ---------- */
function initMenu() {
  const btn = $('#btnMenu'), menu = $('#menu');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('button').focus();
  });
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.menu-wrap')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    close();
    const a = b.dataset.action;
    if (a === 'bac') openBac();
    else if (a === 'diary') openDiary();
    else if (a === 'group') openGroupMenu();
    else if (a === 'home') openHome();
    else if (a === 'alerts') openAlerts();
    else if (a === 'sync') openSync();
    else if (a === 'about') openAbout();
  });
  on('backup-export', () => {
    const data = exportBundle({ community: exportLocalCommunity() });
    downloadFile(`bierlocator-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast(t('Daten exportiert'), { tone: 'good' });
  });
  on('backup-import', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        importBundle(payload);
        if (payload.community) importLocalCommunity(payload.community);
        if (payload.localData) importLocalCommunity(convertLegacy(payload.localData));
        toast(t('Daten importiert. Lädt neu …'), { tone: 'good' });
        setTimeout(() => location.reload(), 900);
      } catch (err) {
        toast(t('Import fehlgeschlagen: {msg}', { msg: err.message }), { tone: 'bad' });
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  });
}
function convertLegacy(localData) {
  const out = {};
  for (const [id, r] of Object.entries(localData)) {
    const prices = (r.prices || []).map((p, i) => ({ id: `l${p.reportedAt}${i}`, beer: p.beerType, price: p.price, unit: p.unit, created_at: p.reportedAt, mine: true }));
    out[id] = { prices, myRating: r.ratings && r.ratings.length ? r.ratings[r.ratings.length - 1] : null };
  }
  return out;
}

function openAbout() {
  $('#aboutBody').innerHTML = `
    <h2 id="aboutTitle" class="dlg-title">${icon('beerMug', { size: 20 })}Bier-Locator</h2>
    <p>${t('Findet Kneipen, Biergärten, Brauereien und Läden in der Nähe, vergleicht Bierpreise und plant gleichmäßige Fahrrad-Biertouren.')}</p>
    <div class="notice ${isShared() ? 'notice-good' : ''}">${icon(isShared() ? 'globe' : 'info', { size: 20 })}<div>${isShared()
      ? t('<b>Community-Modus:</b> Preise & Bewertungen sehen alle. Kein Login, pro Gerät zählt eine Bewertung.')
      : t('<b>Lokaler Modus:</b> Preise & Bewertungen bleiben auf diesem Gerät. Für geteilte Preise muss ein Supabase-Projekt eingetragen werden (siehe README).')}</div></div>
    ${/android/i.test(navigator.userAgent) && !document.referrer.startsWith('android-app://') && !matchMedia('(display-mode: standalone)').matches
      ? `<a class="btn btn-primary btn-big" href="https://github.com/SpeedPeed/Noahs-BierLocator/releases/latest" target="_blank" rel="noopener">${icon('download', { size: 20 })}${t('Android-App herunterladen')}</a><p class="fine center">${t('Läuft wie eine normale App, aktualisiert sich von selbst.')}</p>` : ''}
    <h3 class="pd-h">${icon('map', { size: 16 })}${t('Datenquellen')}</h3>
    <ul class="about-list">
      <li>${t('<b>Orte:</b> OpenStreetMap via Overpass API')}</li>
      <li>${t('<b>Karte:</b> Stadia Maps · © OpenMapTiles · © OpenStreetMap-Mitwirkende')}</li>
      <li>${t('<b>Suche:</b> Photon (Komoot)')}</li>
      <li>${t('<b>Radrouten:</b> BRouter (Fallback: OSRM/FOSSGIS)')}</li>
      <li>${t('<b>Wetter:</b> Open-Meteo')}</li>
    </ul>
    <h3 class="pd-h">${icon('info', { size: 16 })}${t('Tipps')}</h3>
    <ul class="about-list">
      <li>${t('Karte verschieben → „In diesem Bereich suchen“.')}</li>
      <li>${t('In der Tour lassen sich Stopps tauschen oder entfernen. „Los geht’s“ startet die Live-Tour, der Zeitplan fährt mit.')}</li>
      <li>${t('Lieblingssorte unter „Filter“ eintragen, dann erscheinen Aktionen in der Nähe von selbst.')}</li>
      <li>${t('„Meine Runde“ im Menü: Biere zählen, Runden abrechnen, über Stopps abstimmen.')}</li>
      <li>${t('Bei einem Lokal liest „Karte fotografieren“ die Preise von der Getränkekarte.')}</li>
      <li>${t('Taste <kbd>/</kbd> springt in die Suche.')}</li>
    </ul>
    <p class="fine">${t('Online-Preise ohne Gewähr. Der Bier-Locator hat mit den Händlern nichts zu tun.')}</p>
    <p class="fine">${t('Bitte verantwortungsvoll trinken. Wer trinkt, fährt nicht, auch nicht mit dem Rad.')}</p>
    <p class="fine center"><a href="${privacyPage()}">${t('Datenschutz &amp; Impressum')}</a></p>
    <label class="lang-pick">${icon('moon', { size: 16 })}${t('Design')}
      <select id="themeSelect">${[['light', t('Hell')], ['dark', t('Dunkel')]].map(([k, v]) => `<option value="${k}"${k === document.documentElement.getAttribute('data-theme') ? ' selected' : ''}>${v}</option>`).join('')}</select>
    </label>
    <label class="lang-pick">${icon('globe', { size: 16 })}${t('Sprache')} / Language
      <select id="langSelect">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}"${k === LANG ? ' selected' : ''}>${v}</option>`).join('')}</select>
    </label>`;
  $('#langSelect').onchange = e => setLang(e.target.value);
  $('#themeSelect').onchange = e => applyTheme(e.target.value, true);
  openDialog($('#aboutDialog'));
}

/* ---------- Links (#ort=…, #tour=…) ---------- */
async function handleHash() {
  const h = readHash();
  if (!h) return false;
  clearHash();
  if (h.kind === 'place') {
    openPlace(h.id);
    return true;
  }
  if (h.kind === 'sync') { joinFromLink(h.code); return false; }
  if (h.kind === 'group') { joinGroupFromLink(h.code); return true; }
  if (h.kind === 'alerts') { openAlerts(); return false; }
  if (h.kind === 'diary') { openDiary(); return false; }
  if (h.kind === 'tour') {
    setMode('tour');
    await setLocation(h.tour.start, { search: false });
    loadSharedTour(h.tour);
    return true;
  }
  return false;
}

/* ---------- Service Worker ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast(t('Neue Version verfügbar'), { action: { label: t('Neu laden'), run: () => location.reload() }, ms: 8000 });
        }
      });
    });
  }).catch(() => { /* egal */ });
}

/* ---------- Jahresrückblick-Hinweis (Dezember / Anfang Jänner) ---------- */
function wrappedTeaser() {
  const now = new Date();
  const year = now.getMonth() === 11 ? now.getFullYear() : now.getMonth() === 0 && now.getDate() <= 15 ? now.getFullYear() - 1 : null;
  if (!year) return;
  const flag = `bl_wrapped_seen_${year}`;
  if (localStorage.getItem(flag)) return;
  if (yearStats(year).beers < 5) return;
  setTimeout(() => toast(t('Dein Bier-Jahr {year} ist fertig.', { year }), { tone: 'good', ms: 9000, action: { label: t('Ansehen'), run: () => { localStorage.setItem(flag, '1'); openDiary(null, 'year'); } } }), 4000);
}

/* ---------- Start ---------- */
async function init() {
  translateDom();
  hydrateIcons();
  mapview.initMap({ onMoveEnd: onMapMoved });
  applyTheme(currentTheme());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!loadTheme()) applyTheme(currentTheme()); });

  initSheet();
  mapview.setPaddingProvider(() => {
    const occ = sheetOcclusion();
    const top = mobile() ? $('.topbar').getBoundingClientRect().bottom : 0;
    return { top, bottom: occ.bottom, left: occ.left, right: 0 };
  });
  initBack({ open: () => mobile() && getSheet() === 'full', close: () => setSheet('half') });
  onSheetChange(s => {
    syncBack();
    setTimeout(() => mapview.invalidate(), 320);
    if (s === 'full') $('#btnSearchArea').hidden = true;
  });

  initFinder({ openPlace });
  onRender(list => { lastList = list; applyHeat(list); });
  initDetail({ onChange: () => renderFinder() });
  initTour({ openPlace });
  initMenu();
  initGroup();
  initLive({ onGroupTick: groupLiveTick, onGroupStop: groupLiveStop, groupMembers: groupMates, setMode });
  initBadges();
  setTourLoader(async t => { setMode('tour'); if (mobile()) setSheet('half'); await setLocation(t.start, { search: false }); loadSharedTour(t); });
  on('open-diary', tabName => openDiary(null, tabName));
  on('open-home', () => openHome());
  on('open-bingo', () => openBingo());
  on('open-surprise', () => openSurprise(openPlace));
  $$('dialog').forEach(d => wireDialog(d));
  document.querySelectorAll('input[type=range]').forEach(r => { paintRange(r); r.addEventListener('input', () => paintRange(r)); });

  // Suche oben
  const si = $('#searchInput');
  attachAutocomplete(si, $('#searchSuggest'), {
    near: () => state.location || mapview.getViewInfo().center,
    extra: q => (state.mode === 'find' ? beerSuggestion(q) : null),
    onClear: clearBeer,
    onPick: it => {
      si.blur();
      $('#searchClear').hidden = false;
      if (it.kind === 'beer') { findBeer(it.label); if (mobile()) setSheet('half'); return; }
      clearBeer();
      setLocation({ lat: it.lat, lon: it.lon }, { label: it.label, country: it.country });
      if (mobile()) setSheet('half');
    },
  });
  si.addEventListener('input', () => { $('#searchClear').hidden = !si.value; });
  $('#searchClear').addEventListener('click', () => { si.value = ''; $('#searchClear').hidden = true; clearBeer(); si.focus(); });
  on('beer-cleared', () => { si.value = ''; $('#searchClear').hidden = true; });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.target.closest('input, textarea, select') && !document.querySelector('dialog[open]')) { e.preventDefault(); si.focus(); }
  });

  $('#btnLocate').addEventListener('click', () => {
    // Während der Live-Tour: Karte wieder dem Standort folgen lassen
    if (state.live) { mapview.setFollow(true); if (state.location) mapview.followTo(state.location.lat, state.location.lon); return; }
    locate();
  });
  on('request-locate', locate);
  $('#btnBrand').addEventListener('click', openAbout);
  $('#prefHeat').addEventListener('change', toggleHeat);
  $$('.tab').forEach(t => t.addEventListener('click', () => { setMode(t.dataset.mode); if (mobile()) setSheet('half'); }));
  $('#btnSearchArea').addEventListener('click', () => {
    const { center } = mapview.getViewInfo();
    searchAt(center, Number($('#btnSearchArea').dataset.radius) || null, { fit: false });
  });
  window.addEventListener('hashchange', handleHash);

  registerSW();
  initSync();
  initAlerts();
  on('sync-changed', () => { renderFinder(); toast(t('Daten von deinem anderen Gerät übernommen'), { tone: 'good', ms: 2200 }); });
  $('#btnGroup').addEventListener('click', openGroupMenu);
  const g = activeGroup();
  if (g) $('#btnGroup').innerHTML = `${icon('users', { size: 16 })}${t('Runde {code}', { code: g.code })}`;
  wrappedTeaser();
  $('#beerList').innerHTML = diaryBeerSuggestions().map(b => `<option value="${b.replace(/"/g, '&quot;')}">`).join('');
  setTimeout(() => checkAlerts().catch(() => {}), 2500);
  if (isShared()) migrateLocalToShared().then(n => { if (n) toast(t('{n} lokale Preise mit der Community geteilt', { n }), { tone: 'good' }); }).catch(() => {});

  // Startpunkt: Link > letzter Standort > (falls erlaubt) GPS
  if (await handleHash()) return;
  const last = loadLastLocation();
  const granted = await geolocationGranted();
  if (last) {
    setLocation(last, { label: last.label || null });
    if (granted) {
      getPosition().then(pos => {
        if (haversine(pos.lat, pos.lon, last.lat, last.lon) > 150) setLocation(pos);
        else { state.location.accuracy = pos.accuracy; mapview.setUserLocation({ ...state.location }); }
      }).catch(() => {});
    }
  } else if (granted) {
    locate();
  }
}

document.addEventListener('DOMContentLoaded', init);
