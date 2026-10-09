// Bier-Tagebuch: Check-ins mit Statistik. Wird über den Geräte-Sync geteilt und
// kann jedes Getränk gleich in den Promille-Rechner übernehmen.
import { loadDiary, saveDiary, loadBac, saveBac } from '../store.js';
import { BEER_SUGGESTIONS } from '../prices.js';
import { TYPE_META } from '../places.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../util.js';
import { $, openDialog, toast, animateNumber } from './dom.js';

const SIZES = { 330: '0,33 l', 500: '0,5 l', 1000: '1 l (Maß)', 250: '0,25 l (Seidl)', 300: '0,3 l (Pfiff)' };
let prefill = null;

export function openDiary(place = null) {
  prefill = place;
  render(true);
  openDialog($('#diaryDialog'));
  if (place) setTimeout(() => $('#diaryBeer') && $('#diaryBeer').focus(), 300);
}

const live = () => loadDiary().filter(e => !e.deleted);
const dayKey = ts => new Date(ts).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function stats(list) {
  const beers = new Map(), places = new Map();
  for (const e of list) {
    const b = e.beer.trim().toLowerCase();
    beers.set(b, { name: e.beer, n: (beers.get(b)?.n || 0) + 1 });
    if (e.placeName) places.set(e.placeId || e.placeName, { name: e.placeName, n: (places.get(e.placeId || e.placeName)?.n || 0) + 1 });
  }
  const liters = list.reduce((s, e) => s + (e.ml || 500), 0) / 1000;
  const days = new Set(list.map(e => new Date(e.at).toDateString())).size;
  // längste Serie an Tagen mit mind. einem Bier
  const ds = [...new Set(list.map(e => Math.floor((e.at - new Date(e.at).getTimezoneOffset() * 60000) / 86400000)))].sort((a, b) => a - b);
  let streak = 0, cur = 0;
  ds.forEach((d, i) => { cur = i && d === ds[i - 1] + 1 ? cur + 1 : 1; streak = Math.max(streak, cur); });
  return {
    total: list.length, liters, days, streak,
    topBeers: [...beers.values()].sort((a, b) => b.n - a.n).slice(0, 5),
    topPlaces: [...places.values()].sort((a, b) => b.n - a.n).slice(0, 5),
    uniqueBeers: beers.size, uniquePlaces: places.size,
  };
}

function render(animate = false) {
  const list = live().sort((a, b) => b.at - a.at);
  const st = stats(list);
  const p = prefill;
  const groups = [];
  for (const e of list.slice(0, 200)) {
    const k = dayKey(e.at);
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, items: [] });
    groups[groups.length - 1].items.push(e);
  }
  $('#diaryBody').innerHTML = `
    <h2 class="dlg-title" id="diaryTitle">${icon('book', { size: 22 })}Bier-Tagebuch</h2>
    <form class="diary-form" id="diaryForm">
      ${p ? `<div class="diary-place" style="--c:${TYPE_META[p.type]?.color || 'var(--accent)'}">${icon(TYPE_META[p.type]?.icon || 'pin', { size: 16 })}<span>${escapeHtml(p.name)}</span><button type="button" class="icon-btn small" id="diaryNoPlace" aria-label="Ort entfernen">${icon('x', { size: 14 })}</button></div>` : ''}
      <div class="diary-row">
        <input id="diaryBeer" name="beer" list="beerList" placeholder="Was trinkst du?" maxlength="60" required autocomplete="off">
        <select name="ml" aria-label="Menge">${Object.entries(SIZES).map(([ml, l]) => `<option value="${ml}" ${ml === '500' ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="diary-row">
        <div class="star-input small" id="diaryStars" role="radiogroup" aria-label="Bewertung">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-n="${n}" aria-label="${n} Sterne">${icon('star', { size: 24, filled: true })}</button>`).join('')}</div>
        <label class="switch-row small"><input type="checkbox" class="switch" name="bac" checked><span>Promille-Rechner</span></label>
      </div>
      <input name="note" placeholder="Notiz (optional)" maxlength="140" autocomplete="off">
      <button class="btn btn-primary" type="submit">${icon('plus', { size: 17 })}Eintragen</button>
    </form>

    ${st.total ? `
    <div class="stat-grid diary-stats">
      <div class="stat stat-hero"><span class="stat-ico">${icon('beerMug', { size: 18 })}</span><b data-num="${st.total}">0</b><small>Biere</small></div>
      <div class="stat"><span class="stat-ico">${icon('droplet', { size: 18 })}</span><b>${st.liters.toFixed(1).replace('.', ',')} l</b><small>insgesamt</small></div>
      <div class="stat"><span class="stat-ico">${icon('tag', { size: 18 })}</span><b>${st.uniqueBeers}</b><small>Sorten</small></div>
      <div class="stat"><span class="stat-ico">${icon('pin', { size: 18 })}</span><b>${st.uniquePlaces}</b><small>Orte</small></div>
      <div class="stat"><span class="stat-ico">${icon('clock', { size: 18 })}</span><b>${st.days}</b><small>Biertage</small></div>
      <div class="stat"><span class="stat-ico">${icon('flame', { size: 18 })}</span><b>${st.streak}</b><small>Tage in Folge (Rekord)</small></div>
    </div>
    <div class="diary-tops">
      ${st.topBeers.length ? `<div><h3 class="pd-h">${icon('star', { size: 15 })}Lieblingsbiere</h3><ol>${st.topBeers.map(b => `<li><span>${escapeHtml(b.name)}</span><b>${b.n}×</b></li>`).join('')}</ol></div>` : ''}
      ${st.topPlaces.length ? `<div><h3 class="pd-h">${icon('pin', { size: 15 })}Stammlokale</h3><ol>${st.topPlaces.map(b => `<li><span>${escapeHtml(b.name)}</span><b>${b.n}×</b></li>`).join('')}</ol></div>` : ''}
    </div>
    <div class="diary-list">${groups.map(g => `
      <h4>${g.k}</h4>
      <ul>${g.items.map(e => `<li>
        <span class="dl-time">${new Date(e.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
        <div class="dl-main"><b>${escapeHtml(e.beer)}</b> <small>${SIZES[e.ml] || ''}</small>
          ${e.placeName ? `<small class="dl-place">${icon('pin', { size: 12 })}${escapeHtml(e.placeName)}</small>` : ''}
          ${e.note ? `<small class="dl-note">${escapeHtml(e.note)}</small>` : ''}</div>
        ${e.stars ? `<span class="mini-stars" style="--v:${e.stars * 20}%">★★★★★</span>` : ''}
        <button class="icon-btn small" data-del="${e.id}" aria-label="Eintrag löschen">${icon('trash', { size: 14 })}</button>
      </li>`).join('')}</ul>`).join('')}</div>`
    : `<div class="empty small"><div class="empty-art">${icon('book', { size: 40, strokeWidth: 1.4 })}</div><h3>Noch leer</h3><p>Trag dein erstes Bier ein — oder tippe bei einem Lokal auf „Einchecken“.</p></div>`}`;

  if (animate) document.querySelectorAll('#diaryBody [data-num]').forEach(el => animateNumber(el, Number(el.dataset.num)));
  else document.querySelectorAll('#diaryBody [data-num]').forEach(el => { el.textContent = el.dataset.num; });
  wire();
}

function wire() {
  let stars = 0;
  const sb = [...document.querySelectorAll('#diaryStars button')];
  sb.forEach(b => b.onclick = () => {
    stars = stars === +b.dataset.n ? 0 : +b.dataset.n;
    sb.forEach((x, i) => x.classList.toggle('on', i < stars));
  });
  const np = $('#diaryNoPlace');
  if (np) np.onclick = () => { prefill = null; render(); };
  $('#diaryForm').onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    const beer = f.beer.value.trim();
    if (!beer) return;
    const ml = Number(f.ml.value);
    const now = Date.now();
    const entry = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, t: now, at: now,
      beer, ml, stars: stars || null, note: f.note.value.trim() || null,
      placeId: prefill ? prefill.id : null, placeName: prefill ? prefill.name : null, type: prefill ? prefill.type : null,
    };
    saveDiary([entry, ...loadDiary()]);
    if (f.bac.checked) {
      const bac = loadBac();
      const abv = /alkoholfrei|0[.,]0/i.test(beer) ? 0.4 : /radler/i.test(beer) ? 2.5 : /bock|doppel/i.test(beer) ? 7 : /weizen|weiß|weiss/i.test(beer) ? 5.4 : 5;
      bac.log.push({ label: `${beer} ${SIZES[ml] || ''}`.trim(), volume: ml, abv, kcal100: 43, qty: 1, timestamp: now });
      saveBac(bac);
    }
    toast(`Prost! ${escapeHtml(beer)} eingetragen 🍺`, { tone: 'good', ms: 2000 });
    render(true);
  };
  document.querySelectorAll('#diaryBody [data-del]').forEach(b => b.onclick = () => {
    const list = loadDiary().map(e => (e.id === b.dataset.del ? { id: e.id, at: e.at, t: Date.now(), deleted: true } : e));
    saveDiary(list);
    render();
  });
}

// Suggestions für das Bierfeld ergänzen (eigene Tagebuch-Biere zuerst)
export function diaryBeerSuggestions() {
  const own = [...new Set(live().map(e => e.beer))];
  return [...own, ...BEER_SUGGESTIONS.filter(b => !own.includes(b))];
}
