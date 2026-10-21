// Spielerisches: Bier-Bingo für die Tour und "Überrasch mich" (Glücksrad).
import { makeCard, completeLines, LINES } from '../bingo.js';
import { bumpStat, isHidden, prefs } from '../store.js';
import { state, emit } from '../state.js';
import { TYPE_META } from '../places.js';
import { placeStatus, statusBadge, tourQuality } from '../placeInfo.js';
import { icon } from '../icons.js';
import { escapeHtml, fmtDist } from '../util.js';
import { toast, openMisc, closeMisc, confetti, reducedMotion } from './dom.js';
import { activeGroup } from './groupUi.js';

/* ---------- Bier-Bingo ---------- */
const BINGO = 'bl_bingo_v1'; // { [seed]: { marks: [9], best: n } }

function bingoSeed() {
  const g = activeGroup();
  if (g) return `gruppe-${g.code}`; // gleiche Karte für die ganze Runde
  if (state.tour) return `tour-${state.tour.stops.map(s => s.id).join(',')}`;
  return `tag-${new Date().toDateString()}`;
}
function loadBingo() { try { return JSON.parse(localStorage.getItem(BINGO)) || {}; } catch (e) { return {}; } }
function saveBingo(all) {
  const keys = Object.keys(all).filter(k => k !== '_cur');
  if (keys.length > 12) keys.slice(0, keys.length - 12).forEach(k => delete all[k]);
  localStorage.setItem(BINGO, JSON.stringify(all));
}

export function openBingo(newCard = false) {
  const base = bingoSeed();
  const all = loadBingo();
  all._cur = all._cur || {};
  let n = all._cur[base] || 0;
  if (newCard === true) n++;
  all._cur[base] = n;
  saveBingo(all);
  renderBingo(n ? `${base}#${n}` : base);
}

function renderBingo(seed) {
  const all = loadBingo();
  const rec = all[seed] || { marks: Array(9).fill(false), best: 0 };
  const cells = makeCard(seed);
  const lines = completeLines(rec.marks);
  const inLine = new Set(lines.flat());
  const body = openMisc(`
    <h2 class="dlg-title">${icon('grid', { size: 22 })}Bier-Bingo</h2>
    <p class="fine">${activeGroup() ? 'Alle in deiner Runde haben dieselbe Karte — wer hat zuerst eine Reihe?' : 'Tipp an, was auf der Tour passiert. Drei in einer Reihe = Bingo!'}</p>
    <div class="bingo" role="grid">${cells.map((c, i) => `<button class="bingo-cell${rec.marks[i] || i === 4 ? ' on' : ''}${inLine.has(i) ? ' line' : ''}${i === 4 ? ' free' : ''}" data-cell="${i}" ${i === 4 ? 'disabled' : ''}>${escapeHtml(c)}</button>`).join('')}</div>
    <div class="row-btns">
      <span class="bingo-count">${lines.length ? `${icon('star', { size: 16 })}${lines.length} Reihe${lines.length === 1 ? '' : 'n'}` : ''}</span>
      <button class="btn btn-soft" id="bingoNew">${icon('shuffle', { size: 16 })}Neue Karte</button>
    </div>`);
  body.querySelectorAll('[data-cell]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.cell);
    rec.marks[i] = !rec.marks[i];
    const n = completeLines(rec.marks).length;
    if (n > rec.best) {
      rec.best = n;
      bumpStat('bingos');
      confetti(60);
      toast(n === LINES.length ? 'VOLLE KARTE! 🍻🍻🍻' : 'BINGO! 🍻', { tone: 'good' });
      emit('bingo');
    }
    const store = loadBingo();
    store[seed] = rec;
    saveBingo(store);
    renderBingo(seed);
  });
  body.querySelector('#bingoNew').onclick = () => openBingo(true);
}

/* ---------- Überrasch mich ---------- */
const WHEEL_TYPES = new Set(['pub', 'biergarten', 'brewery', 'gasthaus']);

function candidates() {
  const now = new Date();
  let list = state.places.filter(p => WHEEL_TYPES.has(p.type) && !isHidden(p.id) && !p.unnamed && p.distance <= Math.max(prefs.radius, 1500));
  list = list.map(p => ({ p, st: placeStatus(p, now) })).filter(x => !x.st || x.st.open);
  if (list.length < 3) list = state.places.filter(p => (WHEEL_TYPES.has(p.type) || p.type === 'restaurant') && !isHidden(p.id)).map(p => ({ p, st: placeStatus(p, now) })).filter(x => !x.st || x.st.open);
  // nach Qualität & Nähe gewichtet, bis zu 8 Felder
  return list
    .map(x => ({ ...x, w: tourQuality(x.p) * (x.st && x.st.open ? 1.2 : 0.8) * (1 - Math.min(x.p.distance / 6000, 0.7)) * (0.6 + Math.random() * 0.8) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 8);
}

export function openSurprise(openPlace) {
  const list = candidates();
  if (list.length < 2) { toast('Erst oben einen Ort suchen oder den Standort teilen — dann dreht sich das Rad.'); return; }
  const n = list.length;
  const seg = 360 / n;
  const R = 140;
  const slices = list.map((x, i) => {
    const a0 = (i * seg - 90) * Math.PI / 180, a1 = ((i + 1) * seg - 90) * Math.PI / 180;
    const large = seg > 180 ? 1 : 0;
    const d = `M150,150 L${150 + R * Math.cos(a0)},${150 + R * Math.sin(a0)} A${R},${R} 0 ${large} 1 ${150 + R * Math.cos(a1)},${150 + R * Math.sin(a1)} Z`;
    const mid = (i + 0.5) * seg;
    const name = x.p.name.length > 15 ? x.p.name.slice(0, 14) + '…' : x.p.name;
    return `<path d="${d}" fill="${TYPE_META[x.p.type].color}" opacity="${i % 2 ? 0.82 : 1}"/>
      <text transform="rotate(${mid - 90} 150 150) translate(${150 + 62} ${150 + 4})" class="wheel-t">${escapeHtml(name)}</text>`;
  }).join('');
  const body = openMisc(`
    <h2 class="dlg-title">${icon('dice', { size: 22 })}Überrasch mich</h2>
    <div class="wheel-wrap">
      <span class="wheel-pin" aria-hidden="true"></span>
      <svg class="wheel" id="wheel" viewBox="0 0 300 300" role="img" aria-label="Glücksrad mit ${n} Lokalen">${slices}<circle cx="150" cy="150" r="22" class="wheel-hub"/></svg>
    </div>
    <div id="wheelResult" class="wheel-result"><p class="fine center">Das Rad wählt ein offenes Lokal in deiner Nähe.</p></div>
    <button class="btn btn-primary btn-big" id="wheelSpin">${icon('shuffle', { size: 18 })}Drehen!</button>`);
  let angle = 0;
  const spin = () => {
    const btn = body.querySelector('#wheelSpin');
    btn.disabled = true;
    const total = list.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total, pick = 0;
    for (let i = 0; i < n; i++) { r -= list[i].w; if (r <= 0) { pick = i; break; } }
    const target = 360 - (pick + 0.5) * seg + (Math.random() - 0.5) * seg * 0.6;
    angle = angle - (angle % 360) + 360 * 5 + target;
    const wheel = body.querySelector('#wheel');
    wheel.style.transform = `rotate(${angle}deg)`;
    const done = () => {
      btn.disabled = false;
      btn.innerHTML = `${icon('shuffle', { size: 18 })}Nochmal drehen`;
      const x = list[pick];
      const b = statusBadge(x.st);
      const m = TYPE_META[x.p.type];
      if (navigator.vibrate) navigator.vibrate(40);
      body.querySelector('#wheelResult').innerHTML = `
        <div class="wheel-hit" style="--c:${m.color}">
          <span class="card-ico">${icon(m.icon, { size: 20 })}</span>
          <div><b>${escapeHtml(x.p.name)}</b><small>${m.short} · ${fmtDist(x.p.distance)} · <span class="status-${b.tone}">${b.text}</span></small></div>
        </div>
        <div class="row-btns">
          <a class="btn btn-primary" href="https://www.google.com/maps/dir/?api=1&destination=${x.p.lat},${x.p.lon}" target="_blank" rel="noopener">${icon('compass', { size: 16 })}Hin da!</a>
          <button class="btn btn-soft" id="wheelDetails">${icon('info', { size: 16 })}Details</button>
        </div>`;
      body.querySelector('#wheelDetails').onclick = () => { closeMisc(); openPlace(x.p.id); };
    };
    if (reducedMotion()) done(); else setTimeout(done, 3300);
  };
  body.querySelector('#wheelSpin').onclick = spin;
}
