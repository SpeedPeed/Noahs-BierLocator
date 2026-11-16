// "Bier finden": Filter, Sortierung, Ergebnisliste, Karte mit Markern.
import { prefs, savePrefs, isFavorite, isHidden, hiddenCount, unhideAll } from '../store.js';
import { state, rememberPlaces, emit } from '../state.js';
import { TYPE_META, TYPE_ORDER, fetchPlacesAround, breweries } from '../places.js';
import { getSummary, loadSummaries } from '../community.js';
import { placeStatus, statusBadge } from '../placeInfo.js';
import { isBiergartenWeather, isRainy } from '../weather.js';
import { icon } from '../icons.js';
import { fmtDist, fmtEuro, escapeHtml, timeAgo, debounce } from '../util.js';
import { $, toast, skeletonCards, beerLoader } from './dom.js';
import { stateBlock } from './states.js';
import * as mapview from '../map.js';
import { BEER_SUGGESTIONS } from '../prices.js';
import { loadChainPrices, chainPricesFor, cheapestChainPrice, CHAIN_LABELS, chainOf } from '../chainPrices.js';
import { t, num, money, moneyParts, LOCALE, pkg } from '../i18n.js';

let openPlace = () => {};
let loading = false;
let searchSeq = 0;
let lastRadius = prefs.radius;
let retryWhenOnline = () => {};
const MAX_RADIUS = 5000;

export function initFinder(opts) {
  openPlace = opts.openPlace;

  // Typ-Chips
  $('#typeChips').innerHTML = TYPE_ORDER.map(t => {
    const m = TYPE_META[t];
    const on = prefs.types.includes(t);
    return `<button class="type-chip" data-type="${t}" aria-pressed="${on}" style="--c:${m.color}">${icon(m.icon, { size: 16 })}<span>${m.short}</span></button>`;
  }).join('');
  $('#typeChips').addEventListener('click', e => {
    const b = e.target.closest('.type-chip');
    if (!b) return;
    const ty = b.dataset.type;
    const on = b.getAttribute('aria-pressed') !== 'true';
    // Langes Drücken wäre schöner; hier: Doppeltipp = "nur dieser Typ"
    if (b._lastTap && Date.now() - b._lastTap < 350) {
      prefs.types = [ty];
      document.querySelectorAll('.type-chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.type === ty)));
      toast(t('Nur {type}', { type: TYPE_META[ty].label }), { ms: 1600 });
    } else {
      b.setAttribute('aria-pressed', String(on));
      prefs.types = on ? [...new Set([...prefs.types, ty])] : prefs.types.filter(x => x !== ty);
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

  $('#btnUnhide').addEventListener('click', () => { unhideAll(); render(); toast(t('Alle ausgeblendeten Orte sind wieder sichtbar.'), { tone: 'good' }); });

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
  $('#dealCard').addEventListener('click', e => {
    const c = e.target.closest('[data-place]');
    if (c) openPlace(c.dataset.place);
  });
  $('#btnSurprise').addEventListener('click', () => emit('open-surprise'));

  renderEmpty();
  loadChainPrices().then(() => render());
}

function renderEmpty() {
  $('#results').innerHTML = stateBlock({
    art: 'where', title: t('Wo gibt\'s hier Bier?'), text: t('Sag mir, wo du bist, oder such oben nach einem Ort.'),
    action: { id: 'btnEmptyLocate', label: t('Standort verwenden'), icon: 'locate' },
  });
  $('#btnEmptyLocate').onclick = () => emit('request-locate');
}

/* ---------- Suche ---------- */
export async function searchAt(center, radius = prefs.radius, { fit = true, quiet = false } = {}) {
  const seq = ++searchSeq;
  loading = true;
  lastRadius = radius;
  window.removeEventListener('online', retryWhenOnline);
  state.searchCenter = center;
  $('#btnSearchArea').hidden = true;
  if (!quiet) {
    $('#results').innerHTML = beerLoader(t('Schau mich um …')) + skeletonCards(4);
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
    // Preise/Bewertungen nachladen, dann neu zeichnen
    loadSummaries(places.map(p => p.id)).then(() => { if (seq === searchSeq) render(); })
      .catch(() => toast(t('Die Preise kommen gerade nicht durch.'), { tone: 'bad' }));
  } catch (e) {
    if (seq !== searchSeq) return;
    loading = false;
    const offline = navigator.onLine === false;
    $('#results').innerHTML = stateBlock(offline
      ? { art: 'offline', title: t('Kein Netz.'), text: t('Sobald du wieder Empfang hast, schau ich mich um.'), action: { id: 'btnRetry', label: t('Nochmal'), icon: 'refresh' } }
      : { art: 'error', title: t('Das hat nicht geklappt.'), text: e.message, action: { id: 'btnRetry', label: t('Nochmal'), icon: 'refresh' } });
    retryWhenOnline = () => searchAt(center, radius, { fit });
    $('#btnRetry').onclick = retryWhenOnline;
    if (offline) window.addEventListener('online', retryWhenOnline, { once: true });
    $('#resultCount').textContent = '0';
  }
}

/* ---------- Filtern & Sortieren ---------- */
// Preis für Liste/Karte: Community-Meldung (aktuell) vor Online-Preis der Kette
// vor veralteter Meldung.
function effectivePrice(p, s) {
  if (s.cheapest && !s.cheapest.stale) return s.cheapest;
  const c = cheapestChainPrice(p);
  if (c) return { per05: c.per05, beer: c.beer, created_at: Date.parse(c.seen), online: true, promo: c.promo, currency: c.currency, chain: CHAIN_LABELS[chainOf(p).key] };
  return s.cheapest;
}
// Preis pro Halbe als Bierdeckel: voll = vor Ort gemeldet, nur Rand = Online-Preis, blass = alt.
function deckel(pr, size = 'md') {
  const { value, unit } = moneyParts(pr.per05, pr.currency);
  const what = pr.online ? t('Online-Preis {chain}', { chain: pr.chain }) : timeAgo(pr.created_at);
  return `<span class="deckel deckel-${size}${pr.online ? ' online' : ''}${pr.stale ? ' stale' : ''}" title="${escapeHtml(`${pr.beer} · ${what}`)}"><b>${value}</b><small>${unit}</small></span>`;
}
// Bierorte stehen auf der Karte vorn, alles andere tritt zurück.
const MAJOR_TYPES = new Set(['pub', 'biergarten', 'brewery', 'gasthaus']);
function recommendationScore(p, s, st, price) {
  let score = (1 - Math.min(p.distance / (prefs.radius || 1000), 1)) * 40;
  if (price) {
    score += prefs.maxPrice ? (price.per05 <= prefs.maxPrice ? 22 : -18) : 8;
    if (prefs.beerType && price.beer.toLowerCase().includes(prefs.beerType.toLowerCase())) score += 12;
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
  list = list.map(p => { const s = getSummary(p.id); return { p, s, st: placeStatus(p, now), price: effectivePrice(p, s) }; });
  if (prefs.onlyOpen) list = list.filter(x => x.st && x.st.open);
  if (prefs.onlyPrice) list = list.filter(x => x.price);
  if (prefs.onlyFav) list = list.filter(x => isFavorite(x.p.id));
  if (beer) list = list.filter(x => x.s.prices.some(pr => pr.beer.toLowerCase().includes(beer)) || chainPricesFor(x.p).some(pr => pr.beer.toLowerCase().includes(beer)));

  if (prefs.sort === 'distance') list.sort((a, b) => a.p.distance - b.p.distance);
  else if (prefs.sort === 'price') {
    list.sort((a, b) => {
      const pa = a.price, pb = b.price;
      if (!pa && !pb) return a.p.distance - b.p.distance;
      if (!pa) return 1;
      if (!pb) return -1;
      return pa.per05 - pb.per05;
    });
  } else if (prefs.sort === 'rating') {
    list.sort((a, b) => (b.s.rating.avg || 0) - (a.s.rating.avg || 0) || a.p.distance - b.p.distance);
  } else {
    list.forEach(x => { x.score = recommendationScore(x.p, x.s, x.st, x.price); });
    list.sort((a, b) => b.score - a.score);
  }
  return list;
}

/* ---------- Darstellung ---------- */
export function render() {
  if (!state.searchCenter) return;
  const list = visibleList();
  const cheapest = list.filter(x => x.price && !x.price.stale && x.price.currency !== 'CHF').sort((a, b) => a.price.per05 - b.price.per05)[0]
    || list.filter(x => x.price && !x.price.stale).sort((a, b) => a.price.per05 - b.price.per05)[0];

  if (state.mode === 'find') {
    const hasMajor = list.some(x => MAJOR_TYPES.has(x.p.type));
    mapview.renderPlaceMarkers(list.map(x => ({
      place: x.p,
      info: {
        price: x.price && !x.price.stale ? x.price.per05 : null, online: !!(x.price && x.price.online),
        closed: x.st && !x.st.open, favorite: isFavorite(x.p.id), best: cheapest && cheapest.p.id === x.p.id,
        minor: hasMajor && !MAJOR_TYPES.has(x.p.type),
      },
    })), id => openPlace(id));
  }

  $('#resultCount').textContent = list.length;
  $('#resultNoun').textContent = list.length === 1 ? t('Ort') : t('Orte');
  const hc = hiddenCount();
  $('#btnUnhide').hidden = !hc;
  $('#btnUnhide').textContent = t('{n} ausgeblendet · zeigen', { n: hc });

  const pr = [];
  if (prefs.radius) pr.push(fmtDist(prefs.radius));
  if (prefs.beerType) pr.push(prefs.beerType);
  if (prefs.maxPrice) pr.push(`≤ ${fmtEuro(prefs.maxPrice)}`);
  $('#prefsSummary').textContent = pr.join(' · ');

  // Günstigstes Bier
  const cc = $('#cheapestCard');
  if (cheapest) {
    const c = cheapest.price;
    cc.hidden = false;
    cc.innerHTML = `<button class="cheapest-inner" data-place="${cheapest.p.id}">
      ${deckel(c, 'lg')}
      <span class="cheapest-text">
        <span class="cheapest-kicker">${t('Günstigste Halbe')}${c.online ? ' · ' + t('Online-Preis') : ''}</span>
        <span class="cheapest-beer">${escapeHtml(c.beer)}</span>
        <span class="cheapest-where">${escapeHtml(cheapest.p.name)} · ${fmtDist(cheapest.p.distance)} · ${c.online ? t('Stand {date}', { date: new Date(c.created_at).toLocaleDateString(LOCALE) }) : timeAgo(c.created_at)}</span>
      </span>
    </button>`;
  } else {
    cc.hidden = true;
  }
  renderDeal(list);
  $('#btnSurprise').hidden = !list.some(x => SURPRISE_TYPES.has(x.p.type));
  renderListeners.forEach(fn => fn(list));

  const box = $('#results');
  if (loading) return;
  if (!list.length) {
    if (state.places.length) {
      // Orte wären da, die Filter lassen nur keinen durch → ein Tipp lockert sie.
      box.innerHTML = stateBlock({ art: 'nothing', small: true, title: t('Mit diesen Filtern bleibt nichts übrig.'), action: { id: 'btnLoosen', label: t('Filter lockern') } });
      $('#btnLoosen').onclick = loosenFilters;
    } else {
      const wider = Math.min(MAX_RADIUS, Math.max(lastRadius * 2, 1000));
      const canWiden = wider > lastRadius;
      box.innerHTML = stateBlock({
        art: 'nothing', small: true, title: t('Hier ist nichts.'),
        text: t('Im Umkreis von {r} kennt die Karte keinen Bierort.', { r: fmtDist(lastRadius) }),
        action: canWiden ? { id: 'btnWiden', label: t('Weiter weg schauen') } : null,
      });
      if (canWiden) $('#btnWiden').onclick = () => {
        prefs.radius = wider; savePrefs();
        $('#radius').value = wider; $('#radius').dispatchEvent(new Event('input'));
        searchAt(state.searchCenter, wider, { fit: true });
      };
    }
    return;
  }
  box.innerHTML = list.slice(0, 120).map((x, i) => cardHtml(x, i)).join('')
    + (list.length > 120 ? `<p class="fine center">${t('+ {n} weitere auf der Karte', { n: list.length - 120 })}</p>` : '');
}

// Erst die Schalter und den Sortenfilter aus; reicht das nicht, alle Ortstypen an.
function loosenFilters() {
  prefs.onlyOpen = prefs.onlyPrice = prefs.onlyFav = false;
  $('#filterBeer').value = '';
  if (!visibleList().length) prefs.types = TYPE_ORDER.slice();
  savePrefs();
  for (const [id, key] of Object.entries({ fOpen: 'onlyOpen', fPrice: 'onlyPrice', fFav: 'onlyFav' })) $('#' + id).setAttribute('aria-pressed', String(!!prefs[key]));
  document.querySelectorAll('.type-chip').forEach(c => c.setAttribute('aria-pressed', String(prefs.types.includes(c.dataset.type))));
  render();
}

/* ---------- Lieblingsbier im Angebot ---------- */
// Aktion für die Lieblingssorte (Vorlieben) in einer Filiale in der Nähe.
export function favDeal(list) {
  const q = (prefs.beerType || '').trim().toLowerCase();
  if (q.length < 3) return null;
  const words = q.split(/\s+/).filter(Boolean);
  const byChain = new Map();
  for (const x of list) {
    const c = chainOf(x.p);
    if (!c) continue;
    const k = `${c.country}|${c.key}`;
    const near = byChain.get(k);
    if (!near || x.p.distance < near.distance) byChain.set(k, x.p);
  }
  let best = null;
  for (const store of byChain.values()) {
    for (const pr of chainPricesFor(store)) {
      if (!pr.promo || pr.per05 == null) continue;
      const hay = `${pr.beer} ${pr.package || ''}`.toLowerCase();
      if (!words.every(w => hay.includes(w))) continue;
      if (!best || pr.per05 < best.pr.per05 - 0.005 || (Math.abs(pr.per05 - best.pr.per05) < 0.005 && store.distance < best.p.distance)) best = { p: store, pr };
    }
  }
  return best;
}

function renderDeal(list) {
  const box = $('#dealCard');
  const d = favDeal(list);
  if (!d) { box.hidden = true; return; }
  const { p, pr } = d;
  const until = pr.valid_until ? ' · ' + t('bis {date}', { date: new Date(pr.valid_until).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' }) }) : '';
  box.hidden = false;
  box.innerHTML = `<button class="deal-inner" data-place="${p.id}">
    <span class="deal-ico">${icon('tag', { size: 20 })}</span>
    <span class="deal-text">
      <span class="deal-kicker">${t('Dein {beer} im Angebot', { beer: escapeHtml(prefs.beerType) })}</span>
      <b>${escapeHtml(pr.beer)} <small>${escapeHtml(pkg(pr.package))}</small></b>
      <span>${escapeHtml(CHAIN_LABELS[chainOf(p).key] || p.name)} · ${fmtDist(p.distance)}${until}</span>
    </span>
    <span class="deal-price">${money(pr.price, pr.currency)}</span>
  </button>`;
}

/* ---------- Für Heatmap & Co. ---------- */
const renderListeners = [];
export function onRender(fn) { renderListeners.push(fn); }
const SHOP_TYPES = new Set(['supermarket', 'beverages', 'convenience', 'fuel']);
const SURPRISE_TYPES = new Set(['pub', 'biergarten', 'brewery', 'gasthaus']);
// Orte mit aktuellem Preis → [{ lat, lon, v, gastro }]
export function pricedPoints(list) {
  return list.filter(x => x.price && !x.price.stale && x.price.per05 != null)
    .map(x => ({ lat: x.p.lat, lon: x.p.lon, v: x.price.per05, gastro: !SHOP_TYPES.has(x.p.type) }));
}

function stars(avg) {
  return `<span class="mini-stars" style="--v:${(avg / 5) * 100}%" aria-label="${t('{avg} von 5 Sternen', { avg: num(avg, 1) })}">★★★★★</span>`;
}

function cardHtml({ p, s, st, price: pr }, i) {
  const m = TYPE_META[p.type];
  const b = statusBadge(st);
  const extras = [];
  if (p.tags.outdoor_seating === 'yes' && p.type !== 'biergarten') extras.push(`<span class="tag">${icon('sun', { size: 16 })}${t('Draußen')}</span>`);
  if (breweries(p.tags)) extras.push(`<span class="tag">${escapeHtml(breweries(p.tags)[0])}</span>`);
  return `<article class="card" data-place="${p.id}" style="--c:${m.color};--i:${Math.min(i, 14)}" tabindex="0" role="button" aria-label="${escapeHtml(p.name)}, ${m.label}, ${fmtDist(p.distance)}">
    <div class="card-ico">${icon(m.icon, { size: 20 })}</div>
    <div class="card-main">
      <div class="card-top">
        <h3 class="card-name">${escapeHtml(p.name)}${isFavorite(p.id) ? `<span class="card-fav">${icon('heart', { size: 16, filled: true })}</span>` : ''}</h3>
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
    ${pr ? deckel(pr) : ''}
    <button class="icon-btn card-locate" data-action="locate" aria-label="${t('Auf der Karte zeigen')}">${icon('pin', { size: 16 })}</button>
  </article>`;
}

// Tastatur: Enter/Leertaste auf einer Karte öffnet sie.
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.card[data-place]')) {
    e.preventDefault();
    openPlace(e.target.dataset.place);
  }
});
