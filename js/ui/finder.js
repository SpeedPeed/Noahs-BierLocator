// "Bier finden": Filter, Sortierung, Ergebnisliste, Karte mit Markern.
import { prefs, savePrefs, isFavorite, isHidden, hiddenCount, unhideAll } from '../store.js';
import { state, rememberPlaces, emit } from '../state.js';
import { TYPE_META, TYPE_ORDER, fetchPlacesAround } from '../places.js';
import { getSummary, loadSummaries } from '../community.js';
import { placeStatus, statusBadge } from '../placeInfo.js';
import { isBiergartenWeather, isRainy } from '../weather.js';
import { icon } from '../icons.js';
import { fmtDist, fmtEuro, escapeHtml, timeAgo, debounce } from '../util.js';
import { $, toast, skeletonCards, beerLoader } from './dom.js';
import * as mapview from '../map.js';
import { BEER_SUGGESTIONS } from '../prices.js';

let openPlace = () => {};
let loading = false;
let searchSeq = 0;

export function initFinder(opts) {
  openPlace = opts.openPlace;

  // Typ-Chips
  $('#typeChips').innerHTML = TYPE_ORDER.map(t => {
    const m = TYPE_META[t];
    const on = prefs.types.includes(t);
    return `<button class="type-chip" data-type="${t}" aria-pressed="${on}" style="--c:${m.color}">${icon(m.icon, { size: 15 })}<span>${m.short}</span></button>`;
  }).join('');
  $('#typeChips').addEventListener('click', e => {
    const b = e.target.closest('.type-chip');
    if (!b) return;
    const t = b.dataset.type;
    const on = b.getAttribute('aria-pressed') !== 'true';
    // Langes Drücken wäre schöner; hier: Doppeltipp = "nur dieser Typ"
    if (b._lastTap && Date.now() - b._lastTap < 350) {
      prefs.types = [t];
      document.querySelectorAll('.type-chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.type === t)));
      toast(`Nur ${TYPE_META[t].label}`, { ms: 1600 });
    } else {
      b.setAttribute('aria-pressed', String(on));
      prefs.types = on ? [...new Set([...prefs.types, t])] : prefs.types.filter(x => x !== t);
    }
    b._lastTap = Date.now();
    savePrefs();
    render();
  });

  // Schalter
  const toggles = { fOpen: 'onlyOpen', fPrice: 'onlyPrice', fFav: 'onlyFav' };
  for (const [id, key] of Object.entries(toggles)) {
    const el = $('#' + id);
    el.setAttribute('aria-pressed', String(!!prefs[key]));
    el.addEventListener('click', () => {
      prefs[key] = !prefs[key];
      el.setAttribute('aria-pressed', String(prefs[key]));
      savePrefs();
      render();
    });
  }
  const sort = $('#sortSelect');
  sort.value = prefs.sort;
  sort.addEventListener('change', () => { prefs.sort = sort.value; savePrefs(); render(); });

  // Vorlieben
  $('#beerList').innerHTML = BEER_SUGGESTIONS.map(b => `<option value="${b}">`).join('');
  const radius = $('#radius');
  radius.value = prefs.radius;
  const showRadius = () => { $('#radiusValue').textContent = fmtDist(+radius.value); };
  showRadius();
  radius.addEventListener('input', showRadius);
  radius.addEventListener('change', () => {
    prefs.radius = +radius.value; savePrefs();
    if (state.searchCenter) searchAt(state.searchCenter, prefs.radius, { fit: true });
  });
  $('#prefBeer').value = prefs.beerType || '';
  $('#prefMaxPrice').value = prefs.maxPrice ?? '';
  $('#prefBiergarten').checked = !!prefs.biergartenPref;
  const savePrefsFromForm = () => {
    prefs.beerType = $('#prefBeer').value.trim();
    const mp = parseFloat(String($('#prefMaxPrice').value).replace(',', '.'));
    prefs.maxPrice = isFinite(mp) && mp > 0 ? mp : null;
    prefs.biergartenPref = $('#prefBiergarten').checked;
    savePrefs();
    render();
  };
  ['#prefBeer', '#prefMaxPrice'].forEach(s => $(s).addEventListener('input', debounce(savePrefsFromForm, 300)));
  $('#prefBiergarten').addEventListener('change', savePrefsFromForm);
  $('#filterBeer').addEventListener('input', debounce(render, 200));

  $('#btnUnhide').addEventListener('click', () => { unhideAll(); render(); toast('Alle ausgeblendeten Orte sind wieder sichtbar.', { tone: 'good' }); });

  $('#results').addEventListener('click', e => {
    const card = e.target.closest('[data-place]');
    if (!card) return;
    if (e.target.closest('[data-action="locate"]')) { mapview.highlightPlace(card.dataset.place); return; }
    openPlace(card.dataset.place);
  });
  $('#cheapestCard').addEventListener('click', e => {
    const c = e.target.closest('[data-place]');
    if (c) openPlace(c.dataset.place);
  });

  renderEmpty();
}

function renderEmpty() {
  $('#results').innerHTML = `<div class="empty">
    <div class="empty-art">${icon('beerMug', { size: 54, strokeWidth: 1.3 })}</div>
    <h3>Wo gibt's hier Bier?</h3>
    <p>Teile deinen Standort oder such oben nach einem Ort — dann zeigt die Karte Kneipen, Biergärten, Brauereien und Läden in der Nähe.</p>
    <button class="btn btn-primary" id="btnEmptyLocate">${icon('locate', { size: 18 })}Standort verwenden</button>
  </div>`;
  $('#btnEmptyLocate').onclick = () => emit('request-locate');
}

/* ---------- Suche ---------- */
export async function searchAt(center, radius = prefs.radius, { fit = true, quiet = false } = {}) {
  const seq = ++searchSeq;
  loading = true;
  state.searchCenter = center;
  $('#btnSearchArea').hidden = true;
  if (!quiet) {
    $('#results').innerHTML = beerLoader('Suche Bier in der Nähe…') + skeletonCards(4);
    $('#resultCount').textContent = '…';
  }
  try {
    const ref = state.location || center;
    const { places, total, fromCache } = await fetchPlacesAround(center, radius, TYPE_ORDER, { ref });
    if (seq !== searchSeq) return;
    state.places = places;
    rememberPlaces(places);
    loading = false;
    render();
    if (fit) mapview.fitToPlaces(visibleList().slice(0, 25).map(x => x.p), center);
    if (total > places.length) toast(`${places.length} von ${total} Orten (die nächsten) — kleinerer Radius zeigt alle.`, { ms: 4000 });
    // Preise/Bewertungen nachladen, dann neu zeichnen
    loadSummaries(places.map(p => p.id)).then(() => { if (seq === searchSeq) render(); })
      .catch(() => toast('Preise konnten nicht geladen werden.', { tone: 'bad' }));
    if (!fromCache && !places.length) toast('Hier wurde nichts gefunden — größerer Radius?', { ms: 3500 });
  } catch (e) {
    if (seq !== searchSeq) return;
    loading = false;
    $('#results').innerHTML = `<div class="notice notice-bad">${icon('alertTriangle', { size: 18 })}<div><b>Das hat nicht geklappt.</b><br>${escapeHtml(e.message)}</div><button class="btn btn-soft" id="btnRetry">${icon('refresh', { size: 16 })}Nochmal</button></div>`;
    $('#btnRetry').onclick = () => searchAt(center, radius, { fit });
    $('#resultCount').textContent = '0';
  }
}

/* ---------- Filtern & Sortieren ---------- */
function recommendationScore(p, s, st) {
  let score = (1 - Math.min(p.distance / (prefs.radius || 1000), 1)) * 40;
  if (s.cheapest) {
    score += prefs.maxPrice ? (s.cheapest.per05 <= prefs.maxPrice ? 22 : -18) : 8;
    if (prefs.beerType && s.cheapest.beer.toLowerCase().includes(prefs.beerType.toLowerCase())) score += 12;
  }
  if (prefs.beerType && s.prices.some(x => x.beer.toLowerCase().includes(prefs.beerType.toLowerCase()))) score += 14;
  if (s.rating.avg) score += (s.rating.avg - 2.5) * 6;
  if (st) score += st.open ? 12 : -25;
  const outdoor = p.type === 'biergarten' || p.tags.outdoor_seating === 'yes';
  const w = state.weather && state.weather.current;
  if (outdoor) {
    if (prefs.biergartenPref) score += 12;
    if (isBiergartenWeather(w)) score += 10;
    else if (isRainy(w) && p.type === 'biergarten') score -= 15;
  }
  score += TYPE_META[p.type].tour * 22; // Kneipe/Biergarten/Brauerei vor Supermarkt & Tanke
  if (p.unnamed) score -= 10;
  if (isFavorite(p.id)) score += 12;
  return score;
}

function visibleList() {
  const types = new Set(prefs.types);
  const beer = $('#filterBeer').value.trim().toLowerCase();
  const now = new Date();
  let list = state.places.filter(p => types.has(p.type) && !isHidden(p.id));
  list = list.map(p => ({ p, s: getSummary(p.id), st: placeStatus(p, now) }));
  if (prefs.onlyOpen) list = list.filter(x => x.st && x.st.open);
  if (prefs.onlyPrice) list = list.filter(x => x.s.prices.length);
  if (prefs.onlyFav) list = list.filter(x => isFavorite(x.p.id));
  if (beer) list = list.filter(x => x.s.prices.some(pr => pr.beer.toLowerCase().includes(beer)));

  if (prefs.sort === 'distance') list.sort((a, b) => a.p.distance - b.p.distance);
  else if (prefs.sort === 'price') {
    list.sort((a, b) => {
      const pa = a.s.cheapest, pb = b.s.cheapest;
      if (!pa && !pb) return a.p.distance - b.p.distance;
      if (!pa) return 1;
      if (!pb) return -1;
      return pa.per05 - pb.per05;
    });
  } else if (prefs.sort === 'rating') {
    list.sort((a, b) => (b.s.rating.avg || 0) - (a.s.rating.avg || 0) || a.p.distance - b.p.distance);
  } else {
    list.forEach(x => { x.score = recommendationScore(x.p, x.s, x.st); });
    list.sort((a, b) => b.score - a.score);
  }
  return list;
}

/* ---------- Darstellung ---------- */
export function render() {
  if (!state.searchCenter) return;
  const list = visibleList();
  const cheapest = list.filter(x => x.s.cheapest && !x.s.cheapest.stale).sort((a, b) => a.s.cheapest.per05 - b.s.cheapest.per05)[0];

  if (state.mode === 'find') {
    mapview.renderPlaceMarkers(list.map(x => ({
      place: x.p,
      info: { price: x.s.cheapest ? x.s.cheapest.per05 : null, closed: x.st && !x.st.open, favorite: isFavorite(x.p.id), best: cheapest && cheapest.p.id === x.p.id },
    })), id => openPlace(id));
  }

  $('#resultCount').textContent = list.length;
  $('#resultNoun').textContent = list.length === 1 ? 'Ort' : 'Orte';
  const hc = hiddenCount();
  $('#btnUnhide').hidden = !hc;
  $('#btnUnhide').textContent = `${hc} ausgeblendet · zeigen`;

  const pr = [];
  if (prefs.radius) pr.push(fmtDist(prefs.radius));
  if (prefs.beerType) pr.push(prefs.beerType);
  if (prefs.maxPrice) pr.push(`≤ ${fmtEuro(prefs.maxPrice)}`);
  $('#prefsSummary').textContent = pr.join(' · ');

  // Günstigstes Bier
  const cc = $('#cheapestCard');
  if (cheapest) {
    const c = cheapest.s.cheapest;
    cc.hidden = false;
    cc.innerHTML = `<button class="cheapest-inner" data-place="${cheapest.p.id}">
      <div class="cheapest-glass" aria-hidden="true">${icon('coin', { size: 26 })}</div>
      <div class="cheapest-text">
        <span class="cheapest-kicker">Günstigstes Bier hier</span>
        <span class="cheapest-price">${fmtEuro(c.per05)}<small> / 0,5 l</small></span>
        <span class="cheapest-where">${escapeHtml(c.beer)} · ${escapeHtml(cheapest.p.name)} · ${fmtDist(cheapest.p.distance)}</span>
      </div>
      <span class="cheapest-age">${timeAgo(c.created_at)}</span>
    </button>`;
  } else {
    cc.hidden = true;
  }

  const box = $('#results');
  if (loading) return;
  if (!list.length) {
    box.innerHTML = `<div class="empty small"><div class="empty-art">${icon('search', { size: 40, strokeWidth: 1.4 })}</div>
      <h3>Keine Treffer</h3><p>${state.places.length ? 'Die Filter sind gerade sehr streng — ein paar Ortstypen oder Schalter lockern?' : 'Hier gibt\'s laut OpenStreetMap nichts. Größerer Radius?'}</p></div>`;
    return;
  }
  box.innerHTML = list.slice(0, 120).map((x, i) => cardHtml(x, i)).join('')
    + (list.length > 120 ? `<p class="fine center">+ ${list.length - 120} weitere auf der Karte</p>` : '');
}

function stars(avg) {
  return `<span class="mini-stars" style="--v:${(avg / 5) * 100}%" aria-label="${avg.toFixed(1)} von 5 Sternen">★★★★★</span>`;
}

function cardHtml({ p, s, st }, i) {
  const m = TYPE_META[p.type];
  const b = statusBadge(st);
  const price = s.cheapest
    ? `<span class="card-price${s.cheapest.stale ? ' stale' : ''}" title="${escapeHtml(s.cheapest.beer)} · ${timeAgo(s.cheapest.created_at)}">${fmtEuro(s.cheapest.per05)}</span>`
    : '';
  const extras = [];
  if (p.tags.outdoor_seating === 'yes' && p.type !== 'biergarten') extras.push(`<span class="tag">${icon('sun', { size: 12 })}Draußen</span>`);
  if (p.tags.brewery) extras.push(`<span class="tag">${escapeHtml(p.tags.brewery.split(';')[0])}</span>`);
  return `<article class="card" data-place="${p.id}" style="--c:${m.color};--i:${Math.min(i, 14)}" tabindex="0" role="button" aria-label="${escapeHtml(p.name)}, ${m.label}, ${fmtDist(p.distance)}">
    <div class="card-ico">${icon(m.icon, { size: 20 })}</div>
    <div class="card-main">
      <div class="card-top">
        <h3 class="card-name">${escapeHtml(p.name)}${isFavorite(p.id) ? `<span class="card-fav">${icon('heart', { size: 13, filled: true })}</span>` : ''}</h3>
        ${price}
      </div>
      <div class="card-meta">
        <span>${m.short}</span><span class="sep">·</span><span>${fmtDist(p.distance)}</span>
        ${s.rating.avg ? `<span class="sep">·</span>${stars(s.rating.avg)}<span class="muted">(${s.rating.count})</span>` : ''}
      </div>
      <div class="card-bottom">
        <span class="status status-${b.tone}"><span class="status-dot"></span>${b.text}</span>
        ${extras.join('')}
      </div>
    </div>
    <button class="icon-btn card-locate" data-action="locate" aria-label="Auf der Karte zeigen">${icon('pin', { size: 17 })}</button>
  </article>`;
}

// Tastatur: Enter/Leertaste auf einer Karte öffnet sie.
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.card[data-place]')) {
    e.preventDefault();
    openPlace(e.target.dataset.place);
  }
});
