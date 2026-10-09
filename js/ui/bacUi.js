// Promille-Rechner (Dialog).
import { loadBac, saveBac, prefs, savePrefs } from '../store.js';
import { state } from '../state.js';
import { DRINK_PRESETS, FOOD_STATES, simulateBac, bacStage, gramsOfAlcohol } from '../bac.js';
import { COUNTRIES, countryInfo } from '../legal.js';
import { icon } from '../icons.js';
import { escapeHtml, fmtClock, fmtDuration, timeAgo } from '../util.js';
import { $, openDialog, toast, animateNumber } from './dom.js';

let bac = loadBac();
let tick = null;
const fmtP = v => v.toFixed(2).replace('.', ',');

export function openBac() {
  const dlg = $('#bacDialog');
  bac = loadBac(); // kann sich per Sync/Tagebuch geändert haben
  renderShell();
  renderAll(true);
  openDialog(dlg);
  clearInterval(tick);
  tick = setInterval(() => renderAll(false), 30000);
  dlg.addEventListener('close', () => clearInterval(tick), { once: true });
}

function renderShell() {
  const p = bac.profile;
  $('#bacBody').innerHTML = `
    <h2 id="bacTitle" class="dlg-title">${icon('calculator', { size: 22 })}Promille-Rechner</h2>
    <div class="bac-top">
      <div class="bac-glass" id="bacGlass" aria-hidden="true">
        <svg viewBox="0 0 80 110">
          <defs><clipPath id="bacClip"><path d="M12 10h52l-6 88a6 6 0 0 1-6 5.6H24a6 6 0 0 1-6-5.6z"/></clipPath></defs>
          <g clip-path="url(#bacClip)">
            <g class="bac-liquid" id="bacLiquid"><rect x="0" y="0" width="80" height="120"/><rect class="bac-foam" x="0" y="-6" width="80" height="9" rx="4"/>
              <circle class="bl-bub" cx="30" cy="100" r="2"/><circle class="bl-bub b2" cx="46" cy="104" r="1.6"/><circle class="bl-bub b3" cx="38" cy="98" r="1.3"/></g>
          </g>
          <path d="M12 10h52l-6 88a6 6 0 0 1-6 5.6H24a6 6 0 0 1-6-5.6z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="bac-readout">
        <div class="bac-num"><span id="bacNum">0,00</span><small>‰</small></div>
        <div class="bac-stage" id="bacStage"></div>
        <div class="bac-desc" id="bacDesc"></div>
      </div>
    </div>
    <div id="bacChart" class="bac-chart"></div>
    <div id="bacTimes" class="bac-times"></div>

    <h3 class="pd-h">${icon('plus', { size: 16 })}Getränk dazu</h3>
    <div class="drink-grid" id="drinkGrid">
      ${Object.entries(DRINK_PRESETS).map(([k, d]) => `<button class="drink" data-k="${k}"><b>${escapeHtml(d.label)}</b><small>${d.abv.toString().replace('.', ',')} %</small></button>`).join('')}
    </div>
    <div class="drink-when">
      <label>Getrunken <select id="bacWhen">
        <option value="0">gerade eben</option><option value="15">vor 15 Min</option><option value="30">vor 30 Min</option>
        <option value="60">vor 1 Std</option><option value="90">vor 1,5 Std</option><option value="120">vor 2 Std</option><option value="180">vor 3 Std</option>
      </select></label>
      <details class="custom-drink"><summary>Eigenes Getränk</summary>
        <div class="custom-row">
          <label>ml <input id="bacCVol" type="number" min="10" max="2000" value="500"></label>
          <label>% <input id="bacCAbv" type="number" min="0" max="80" step="0.1" value="5"></label>
          <button class="btn btn-soft" id="bacCAdd">${icon('plus', { size: 15 })}Dazu</button>
        </div>
      </details>
    </div>
    <ul id="bacLog" class="bac-log"></ul>

    <details class="prefs bac-profile" ${p._set ? '' : 'open'}>
      <summary>${icon('sliders', { size: 16 })}Dein Profil <span class="prefs-summary" id="bacProfileSummary"></span><span class="chev">${icon('chevronDown', { size: 16 })}</span></summary>
      <div class="prefs-body">
        <div class="segmented" id="bacSex" role="radiogroup" aria-label="Geschlecht">
          <button role="radio" data-v="m" aria-checked="${p.sex === 'm'}">Männlich</button>
          <button role="radio" data-v="f" aria-checked="${p.sex === 'f'}">Weiblich</button>
          <button role="radio" data-v="d" aria-checked="${p.sex === 'd'}">Divers</button>
        </div>
        <div class="field-row">
          <label class="field"><span class="field-label">Gewicht (kg)</span><input id="bacW" type="number" min="35" max="250" value="${p.weight}"></label>
          <label class="field"><span class="field-label">Größe (cm)</span><input id="bacH" type="number" min="120" max="220" value="${p.height}"></label>
          <label class="field"><span class="field-label">Alter</span><input id="bacA" type="number" min="16" max="100" value="${p.age}"></label>
        </div>
        <label class="field"><span class="field-label">Gegessen?</span>
          <select id="bacFood">${Object.entries(FOOD_STATES).map(([k, f]) => `<option value="${k}" ${p.food === k ? 'selected' : ''}>${f.label}</option>`).join('')}</select>
        </label>
      </div>
    </details>

    <div class="bac-legal">
      <div class="bac-legal-head">
        <h3 class="pd-h">${icon('alertTriangle', { size: 16 })}Grenzwerte</h3>
        <select id="bacCountry" aria-label="Land">${Object.entries(COUNTRIES).map(([k, c]) => `<option value="${k}" ${state.country === k ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
      </div>
      <div id="bacLegalRows"></div>
    </div>
    <div class="bac-facts" id="bacFacts"></div>
    <p class="fine bac-disclaimer">Statistische Schätzung (Watson-Körperwasser, Resorption & Abbau ca. 0,15 ‰/h). Tagesform, Medikamente und Gewöhnung verändern den echten Wert stark. Kein medizinischer oder rechtlicher Rat — im Zweifel <b>nicht fahren</b>. Bei Erbrechen, Verwirrtheit oder Bewusstlosigkeit sofort den Notruf <b id="bacEmergency"></b> wählen.</p>
  `;
  wire();
}

function wire() {
  $('#drinkGrid').addEventListener('click', e => {
    const b = e.target.closest('.drink');
    if (!b) return;
    const d = DRINK_PRESETS[b.dataset.k];
    addDrink({ ...d, key: b.dataset.k });
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  });
  $('#bacCAdd').onclick = () => {
    const volume = Number($('#bacCVol').value) || 0;
    const abv = Number($('#bacCAbv').value) || 0;
    if (volume <= 0) return;
    addDrink({ label: `${volume} ml · ${abv} %`, volume, abv, kcal100: abv * 7 + 10, key: 'custom' });
  };
  $('#bacLog').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    bac.log = bac.log.filter(x => String(x.timestamp) !== b.dataset.rm);
    saveBac(bac);
    renderAll(false);
  });
  $('#bacSex').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    bac.profile.sex = b.dataset.v;
    $('#bacSex').querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    saveProfile();
  });
  ['#bacW', '#bacH', '#bacA', '#bacFood'].forEach(s => $(s).addEventListener('change', saveProfile));
  $('#bacCountry').addEventListener('change', e => {
    state.country = e.target.value;
    prefs.country = e.target.value;
    savePrefs();
    renderAll(false);
  });
}

function saveProfile() {
  const p = bac.profile;
  p.weight = Number($('#bacW').value) || 75;
  p.height = Number($('#bacH').value) || 175;
  p.age = Number($('#bacA').value) || 30;
  p.food = $('#bacFood').value;
  p._set = true;
  saveBac(bac);
  renderAll(false);
}

function addDrink(d) {
  const minAgo = Number($('#bacWhen').value) || 0;
  bac.log.push({ label: d.label, volume: d.volume, abv: d.abv, kcal100: d.kcal100, qty: 1, timestamp: Date.now() - minAgo * 60000 });
  // Einträge älter als 2 Tage aufräumen
  bac.log = bac.log.filter(x => x.timestamp > Date.now() - 48 * 3600000);
  saveBac(bac);
  renderAll(true);
  toast(`${d.label} eingetragen`, { ms: 1400 });
}

function renderAll(animate) {
  const now = Date.now();
  const sim = simulateBac(bac.profile, bac.log, now);
  const v = sim.current;
  const stage = bacStage(v);
  const c = countryInfo(state.country);

  const num = $('#bacNum');
  if (animate) animateNumber(num, v, { decimals: 2 }); else { num.textContent = fmtP(v); num.dataset.value = String(v); }
  $('#bacStage').textContent = stage.name;
  $('#bacStage').className = `bac-stage tone-${stage.tone}`;
  $('#bacDesc').textContent = stage.desc;
  // Glas innen von y=10 bis y=104 (SVG-Einheiten); schon kleine Werte sichtbar füllen.
  const level = v <= 0.005 ? 0 : 0.12 + 0.88 * Math.min(1, v / 1.6);
  $('#bacLiquid').style.transform = `translateY(${104 - level * 92}px)`;
  $('#bacGlass').dataset.tone = stage.tone;

  // Zeiten
  const rows = [];
  const lim = [...c.car.filter(l => l.bac > 0).map(l => ({ bac: l.bac, label: l.label })), { bac: c.bike.bac, label: 'Fahrrad' }]
    .filter((l, i, a) => a.findIndex(x => x.bac === l.bac) === i).sort((a, b) => b.bac - a.bac);
  for (const l of lim) {
    if (v > l.bac) {
      const t = sim.below(l.bac);
      if (t) rows.push(`<div class="bt"><span>Unter ${fmtP(l.bac)} ‰ <small>${escapeHtml(l.label)}</small></span><b>${fmtClock(t)}</b></div>`);
    }
  }
  if (sim.soberAt && sim.soberAt.getTime() > now) {
    rows.push(`<div class="bt bt-sober"><span>Wieder bei 0 ‰</span><b>${fmtClock(sim.soberAt)} <small>in ${fmtDuration((sim.soberAt - now) / 1000)}</small></b></div>`);
  }
  if (sim.peak > v + 0.02 && sim.peakAt.getTime() > now) {
    rows.unshift(`<div class="bt"><span>Höchstwert noch nicht erreicht</span><b>${fmtP(sim.peak)} ‰ <small>um ${fmtClock(sim.peakAt)}</small></b></div>`);
  }
  $('#bacTimes').innerHTML = rows.join('') || `<div class="bt bt-sober"><span>${bac.log.length ? 'Alles abgebaut' : 'Noch nichts getrunken'}</span><b>0 ‰</b></div>`;

  renderChart(sim, now, c);

  // Log
  const log = bac.log.slice().sort((a, b) => b.timestamp - a.timestamp);
  $('#bacLog').innerHTML = log.length ? log.map(e => `<li>
      <span>${icon('beerMug', { size: 15 })}<b>${escapeHtml(e.label)}</b></span>
      <small>${gramsOfAlcohol(e).toFixed(0)} g · ${timeAgo(e.timestamp)}</small>
      <button class="icon-btn small" data-rm="${e.timestamp}" aria-label="Entfernen">${icon('x', { size: 14 })}</button>
    </li>`).join('') + `<li class="bac-log-clear"><button class="link-btn" id="bacClear">${icon('trash', { size: 13 })}Alles löschen</button></li>` : '';
  const clr = $('#bacClear');
  if (clr) clr.onclick = () => { bac.log = []; saveBac(bac); renderAll(true); };

  const p = bac.profile;
  $('#bacProfileSummary').textContent = `${p.weight} kg · ${p.height} cm · ${FOOD_STATES[p.food] ? FOOD_STATES[p.food].label : ''}`;
  $('#bacLegalRows').innerHTML = [...c.car, { bac: c.bike.bac, label: c.bike.label, bike: true }].map(l => `
    <div class="legal-row${v > l.bac && l.bac > 0 ? ' over' : ''}">${icon(l.bike ? 'bike' : 'fuel', { size: 14 })}<span>${escapeHtml(l.label)}</span><b>${fmtP(l.bac)} ‰</b></div>`).join('');
  $('#bacEmergency').textContent = c.emergencyLabel;

  const kcal = sim.totalKcal;
  const alcoholic = bac.log.filter(e => e.abv > 1).length;
  $('#bacFacts').innerHTML = bac.log.length ? `
    <div class="fact-tile">${icon('flame', { size: 18 })}<b>${Math.round(kcal)}</b><small>kcal</small></div>
    <div class="fact-tile">${icon('activity', { size: 18 })}<b>${(kcal / 65).toFixed(1).replace('.', ',')} km</b><small>joggen zum Verbrennen</small></div>
    <div class="fact-tile">${icon('droplet', { size: 18 })}<b>${alcoholic}</b><small>Gläser Wasser empfohlen</small></div>` : '';
}

function renderChart(sim, now, c) {
  const box = $('#bacChart');
  if (!sim.series.length) { box.innerHTML = ''; return; }
  const t0 = Math.min(sim.series[0].t, now - 30 * 60000);
  const tEnd = Math.max(sim.soberAt ? sim.soberAt.getTime() : now, now + 60 * 60000);
  const yMax = Math.max(0.6, sim.peak * 1.25, c.bike.bac * 1.1);
  const W = 600, H = 150, padL = 4, padB = 20, padT = 8;
  const x = t => padL + ((t - t0) / (tEnd - t0)) * (W - padL * 2);
  const y = v => padT + (1 - v / yMax) * (H - padT - padB);
  const past = sim.series.filter(s => s.t <= now);
  const future = sim.series.filter(s => s.t >= now - 5 * 60000);
  const path = arr => arr.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s.bac).toFixed(1)}`).join('');
  const lines = [...new Set([0.5, c.bike.bac])].filter(v => v < yMax).map(v => `
    <line class="lim" x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="lim-t" x="${W - 4}" y="${y(v) - 4}" text-anchor="end">${fmtP(v)} ‰${v === c.bike.bac ? ' Rad' : ''}</text>`).join('');
  const ticks = [];
  const step = (tEnd - t0) > 8 * 3600000 ? 3 : (tEnd - t0) > 4 * 3600000 ? 2 : 1;
  const firstHour = new Date(t0); firstHour.setMinutes(0, 0, 0);
  for (let t = firstHour.getTime() + 3600000; t < tEnd; t += step * 3600000) {
    ticks.push(`<text class="tick" x="${x(t)}" y="${H - 4}" text-anchor="middle">${new Date(t).getHours()}:00</text>`);
  }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Promille-Verlauf">
    <defs><linearGradient id="bacGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".45"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${lines}
    ${past.length > 1 ? `<path d="${path(past)}L${x(past[past.length - 1].t)},${y(0)}L${x(past[0].t)},${y(0)}Z" fill="url(#bacGrad)"/><path class="curve" d="${path(past)}"/>` : ''}
    ${future.length > 1 ? `<path class="curve future" d="${path(future)}"/>` : ''}
    <line class="now" x1="${x(now)}" x2="${x(now)}" y1="${padT}" y2="${H - padB}"/>
    <circle class="now-dot" cx="${x(now)}" cy="${y(sim.current)}" r="5"/>
    ${ticks.join('')}
  </svg>`;
}
