// Heimweg: ruhige Radroute nach Hause, zurück zum Tourstart oder zum nächsten
// Bahnhof — mit Link zur Öffi-Verbindung. Warnt, wenn man laut Promille-Rechner
// gerade über der Fahrrad-Grenze liegt.
import { prefs, savePrefs, loadBac } from '../store.js';
import { state } from '../state.js';
import { getPosition } from '../geo.js';
import { fetchStations } from '../places.js';
import { routeThrough } from '../tour/routing.js';
import { simulateBac } from '../bac.js';
import { countryInfo } from '../legal.js';
import { icon } from '../icons.js';
import { escapeHtml, fmtDist, fmtDuration, haversine } from '../util.js';
import { $, toast, openMisc, closeMisc, beerLoader } from './dom.js';
import { attachAutocomplete } from './autocomplete.js';
import * as mapview from '../map.js';

let target = 'home';
let seq = 0;

async function currentPos() {
  if (state.live && state.location) return state.location;
  try { return await getPosition(); } catch (e) { return state.location; }
}

export async function openHome() {
  const tour = state.tour;
  if (!prefs.home && !tour) target = 'station';
  else if (target === 'start' && !tour) target = 'home';
  const body = openMisc(`
    <h2 class="dlg-title">${icon('home', { size: 22 })}Heimweg</h2>
    <div id="homeBac"></div>
    <div class="segmented" id="homeTarget" role="radiogroup" aria-label="Ziel">
      <button role="radio" data-t="home">Nach Hause</button>
      ${tour ? '<button role="radio" data-t="start">Zum Start</button>' : ''}
      <button role="radio" data-t="station">Bahnhof</button>
    </div>
    <div id="homeResult" class="home-result"></div>
    <details class="prefs home-set" id="homeSet">
      <summary>${icon('pin', { size: 16 })}Zuhause ${prefs.home ? 'ändern' : 'festlegen'}<span class="prefs-summary">${prefs.home ? escapeHtml(prefs.home.label) : ''}</span><span class="chev">${icon('chevronDown', { size: 16 })}</span></summary>
      <div class="prefs-body">
        <div class="searchbox inline">
          <span class="searchbox-icon">${icon('search', { size: 17 })}</span>
          <input id="homeInput" type="search" placeholder="Adresse suchen…" autocomplete="off" aria-label="Zuhause">
          <ul id="homeSuggest" class="suggest" role="listbox" hidden></ul>
        </div>
        <button class="btn btn-soft" id="homeHere">${icon('locate', { size: 16 })}Mein aktueller Standort</button>
      </div>
    </details>`);
  bacWarning();
  body.querySelector('#homeTarget').addEventListener('click', e => {
    const b = e.target.closest('[data-t]');
    if (b) { target = b.dataset.t; show(); }
  });
  attachAutocomplete(body.querySelector('#homeInput'), body.querySelector('#homeSuggest'), {
    near: () => state.location,
    onPick: it => setHome({ lat: it.lat, lon: it.lon, label: it.label }),
  });
  body.querySelector('#homeHere').onclick = async () => {
    const p = await currentPos();
    if (!p) { toast('Standort unbekannt', { tone: 'bad' }); return; }
    setHome({ lat: p.lat, lon: p.lon, label: state.locationLabel || 'Zuhause' });
  };
  show();
}

function setHome(h) {
  prefs.home = h;
  savePrefs();
  toast(`Zuhause: ${escapeHtml(h.label)}`, { tone: 'good', ms: 1800 });
  target = 'home';
  $('#homeSet').open = false;
  $('#homeSet summary .prefs-summary').textContent = h.label;
  show();
}

function bacWarning() {
  const { profile, log } = loadBac();
  if (!log || !log.length) return;
  const cur = simulateBac(profile, log, Date.now()).current;
  const lim = countryInfo(state.country).bike;
  if (cur >= lim.bac * 0.85) {
    $('#homeBac').innerHTML = `<div class="notice notice-bad">${icon('alertTriangle', { size: 18 })}<div>Laut Promille-Rechner hast du gerade etwa <b>${cur.toFixed(2).replace('.', ',')} ‰</b> — die Fahrrad-Grenze liegt bei ${lim.bac.toFixed(1).replace('.', ',')} ‰. Lieber schieben, Öffis oder ein Taxi nehmen.</div></div>`;
  }
}

async function show() {
  const my = ++seq;
  document.querySelectorAll('#homeTarget [data-t]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.t === target)));
  const box = $('#homeResult');
  if (target === 'home' && !prefs.home) {
    box.innerHTML = `<p class="fine">Leg unten fest, wo du wohnst — dann zeigt die App jederzeit den ruhigsten Radweg dorthin.</p>`;
    $('#homeSet').open = true;
    return;
  }
  box.innerHTML = beerLoader('Weg wird gesucht…');
  const pos = await currentPos();
  if (my !== seq) return;
  if (!pos) { box.innerHTML = `<p class="fine">Ohne Standort geht's leider nicht — oben „Mein Standort“ antippen.</p>`; return; }
  try {
    if (target === 'station') { await showStations(pos, box, my); return; }
    const dest = target === 'home'
      ? { ...prefs.home, icon: 'home' }
      : { lat: state.tour.start.lat, lon: state.tour.start.lon, label: 'Tourstart', icon: 'flag' };
    await showRoute(pos, dest, box, my);
  } catch (e) {
    if (my === seq) box.innerHTML = `<div class="notice notice-bad">${icon('alertTriangle', { size: 18 })}<div>${escapeHtml(e.message)}</div></div>`;
  }
}

async function showRoute(pos, dest, box, my, extraHtml = '') {
  const direct = haversine(pos.lat, pos.lon, dest.lat, dest.lon);
  if (direct < 80) { box.innerHTML = `<p class="fine center">Du bist schon da. 🍺</p>${extraHtml}`; return; }
  const route = await routeThrough([pos, dest], 'safety');
  if (my !== seq) return;
  const gm = `https://www.google.com/maps/dir/?api=1&origin=${pos.lat},${pos.lon}&destination=${dest.lat},${dest.lon}&travelmode=bicycling`;
  box.innerHTML = `
    <div class="home-route">
      <div><b>${fmtDist(route.distance)}</b><span>${fmtDuration(route.duration)} gemütlich · ruhige Strecke${route.ascent.up ? ` · ${route.ascent.up} Hm` : ''}</span><small>nach ${escapeHtml(dest.label)}</small></div>
    </div>
    ${route.distance > 25000 ? `<p class="fine">${icon('info', { size: 13 })} Ganz schön weit fürs Rad — vielleicht doch mit Öffis („Bahnhof“)?</p>` : ''}
    <div class="row-btns">
      <button class="btn btn-primary" id="homeShow">${icon('map', { size: 16 })}Auf der Karte</button>
      <a class="btn btn-soft" href="${gm}" target="_blank" rel="noopener">${icon('compass', { size: 16 })}Navigation</a>
    </div>${extraHtml}`;
  box.querySelector('#homeShow').onclick = () => {
    closeMisc();
    mapview.drawExtraRoute(route.latlngs, dest);
    toast(`Heimweg: ${fmtDist(route.distance)}`, { ms: 8000, action: { label: 'Ausblenden', run: () => mapview.clearExtraRoute() } });
  };
}

async function showStations(pos, box, my) {
  let list = await fetchStations(pos, 5000);
  if (!list.length) list = await fetchStations(pos, 15000);
  if (my !== seq) return;
  if (!list.length) { box.innerHTML = `<p class="fine">Kein Bahnhof in der Nähe gefunden.</p>`; return; }
  const draw = async idx => {
    const st = list[idx];
    const transit = prefs.home
      ? `https://www.google.com/maps/dir/?api=1&origin=${st.lat},${st.lon}&destination=${prefs.home.lat},${prefs.home.lon}&travelmode=transit`
      : null;
    const picker = `<div class="station-list">${list.slice(0, 4).map((s, i) => `<button class="chip-btn${i === idx ? ' on' : ''}" data-st="${i}">${icon('pin', { size: 14 })}${escapeHtml(s.name)} <small>${fmtDist(s.distance)}</small></button>`).join('')}</div>`;
    const extra = `${transit ? `<a class="btn btn-soft btn-wide" href="${transit}" target="_blank" rel="noopener">${icon('route', { size: 16 })}Öffi-Verbindung nach Hause</a>` : '<p class="fine">Mit festgelegtem Zuhause gibt\'s hier auch gleich die Zugverbindung.</p>'}${picker}`;
    await showRoute(pos, { lat: st.lat, lon: st.lon, label: st.name, icon: 'flag' }, box, my, extra);
    box.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { box.innerHTML = beerLoader('Weg wird gesucht…'); draw(Number(b.dataset.st)); });
  };
  await draw(0);
}
