// "Bier finden": Liste und Karte. Zeigt zuerst echte Bierorte im passenden Umkreis;
// alles Weitere (Ortstypen, Schalter, Sortierung, Vorlieben) liegt hinter "Filter".
import { prefs, savePrefs, isFavorite, isHidden, hiddenCount, unhideAll, BEER_TYPES } from '../store.js';
import { state, rememberPlaces, emit } from '../state.js';
import { TYPE_META, TYPE_ORDER, fetchPlacesAround, autoRadius } from '../places.js';
import { getSummary, loadSummaries } from '../community.js';
import { placeStatus, statusShort, contextReason, isLate } from '../placeInfo.js';
import { isBiergartenWeather, isRainy } from '../weather.js';
import { icon } from '../icons.js';
import { fmtDist, fmtWalk, escapeHtml, timeAgo, debounce, haversine } from '../util.js';
import { $, toast, skeletonCards, beerLoader } from './dom.js';
import { stateBlock } from './states.js';
import * as mapview from '../map.js';
import { BEER_SUGGESTIONS } from '../prices.js';
import { loadChainPrices, chainPricesFor, cheapestChainPrice, CHAIN_LABELS, chainOf, placeCurrency } from '../chainPrices.js';
import { currencyFor } from '../countries.js';
import { t, num, money, moneyParts, LOCALE, pkg, privacyPage } from '../i18n.js';

let openPlace = () => {};
let loading = false;
let searchSeq = 0;
let retryWhenOnline = () => {};

// Umkreis: ohne Vorgabe erst nah suchen; sind dort zu wenige Bierorte, einmal weit (Stadt eng, Land weit).
// Zwei Stufen, damit das Dorf höchstens zwei Abfragen braucht.
const AUTO_STEPS = [1000, 6000];
const MAX_RADIUS = 6000;
const ENOUGH = 8;
let fetchedRadius = 0;   // so weit reichen die geladenen Orte
let shownRadius = 0;     // so weit zeigt die Liste
let autoMode = true;
export const currentRadius = () => shownRadius || 1000;

const BEER = new Set(BEER_TYPES);
const LATE_TYPES = new Set(['convenience', 'fuel']);
const SHOP_TYPES = new Set(['supermarket', 'beverages', 'convenience', 'fuel']);
const TOGGLES = { fOpen: 'onlyOpen', fPrice: 'onlyPrice', fFav: 'onlyFav' };
// Hat man an den Ortstypen gedreht? Dann entscheidet man selbst, und die App mischt nichts dazu.
const customTypes = () => prefs.types.length !== BEER.size || prefs.types.some(ty => !BEER.has(ty));
const reach = p => p.reach ?? p.distance;
const wanted = () => { const types = new Set(prefs.types); return state.places.filter(p => types.has(p.type) && !isHidden(p.id)); };

export function initFinder(opts) {
  openPlace = opts.openPlace;

  $('#typeChips').innerHTML = TYPE_ORDER.map(ty => {
    const m = TYPE_META[ty];
    return `<button class="type-chip" data-type="${ty}" aria-pressed="${prefs.types.includes(ty)}" style="--c:${m.color}">${icon(m.icon, { size: 16 })}<span>${m.short}</span></button>`;
  }).join('');
  $('#typeChips').addEventListener('click', e => {
    const b = e.target.closest('.type-chip');
    if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    prefs.types = on ? [...new Set([...prefs.types, b.dataset.type])] : prefs.types.filter(x => x !== b.dataset.type);
    savePrefs();
    if (autoMode) shownRadius = autoRadius(wanted().map(reach), fetchedRadius);
    render();
  });

  for (const [id, key] of Object.entries(TOGGLES)) {
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

  $('#beerList').innerHTML = BEER_SUGGESTIONS.map(b => `<option value="${b}">`).join('');
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
  for (const id of ['#results', '#cheapestCard', '#dealCard']) {
    $(id).addEventListener('click', e => {
      const c = e.target.closest('[data-place]');
      if (c) openPlace(c.dataset.place);
    });
  }
  $('#btnSurprise').addEventListener('click', () => emit('open-surprise'));
  $('#btnWider').addEventListener('click', widen);

  renderEmpty();
  loadChainPrices().then(() => render());
}

// Erster Start und "kein Standort" sind derselbe Bildschirm: ein Satz, ein Knopf, das Kleingedruckte.
function renderEmpty() {
  $('#results').innerHTML = stateBlock({
    art: 'where', title: t('Wo gibt\'s hier Bier?'), text: t('Sag mir, wo du bist, oder such oben nach einem Ort.'),
    action: { id: 'btnEmptyLocate', label: t('Standort verwenden'), icon: 'locate' },
  }) + `<p class="fine center">${t('Für Erwachsene. Dein Standort geht nur an Karten-, Routen- und Wetterdienste.')} <a href="${privacyPage()}">${t('Datenschutz &amp; Impressum')}</a></p>`;
  $('#btnEmptyLocate').onclick = () => emit('request-locate');
}

/* ---------- Suche ---------- */
// radius = null: Umkreis passend zur Dichte. Mit Radius (z.B. "In diesem Bereich suchen"): genau der.
export async function searchAt(center, radius = null, { fit = true, quiet = false } = {}) {
  const seq = ++searchSeq;
  loading = true;
  window.removeEventListener('online', retryWhenOnline);
  state.searchCenter = center;
  $('#btnSearchArea').hidden = true;
  $('#filterBox').hidden = false;
  if (!quiet) {
    $('#results').innerHTML = beerLoader(t('Schau mich um …')) + skeletonCards(4);
    $('#resultTitle').textContent = '…';
    $('#resultsFoot').hidden = true;
  }
  try {
    const ref = state.location || center;
    const types = new Set(prefs.types);
    let places = [], fetched = 0;
    for (const step of radius ? [radius] : AUTO_STEPS) {
      ({ places } = await fetchPlacesAround(center, step, TYPE_ORDER, { ref }));
      if (seq !== searchSeq) return;
      fetched = step;
      if (places.filter(p => types.has(p.type) && !isHidden(p.id)).length >= ENOUGH) break;
    }
    for (const p of places) p.reach = haversine(center.lat, center.lon, p.lat, p.lon);
    state.places = places;
    rememberPlaces(places);
    fetchedRadius = fetched;
    autoMode = !radius;
    shownRadius = radius || autoRadius(wanted().map(reach), fetched);
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
    $('#resultTitle').textContent = '';
  }
}

function widen() {
  const next = Math.min(MAX_RADIUS, shownRadius * 2);
  if (next > fetchedRadius) { searchAt(state.searchCenter, next); return; }
  shownRadius = next;
  autoMode = false;
  render();
  mapview.fitToPlaces(visibleList().slice(0, 25).map(x => x.p), state.searchCenter);
}

/* ---------- Filtern & Sortieren ---------- */
// Preis für Liste/Karte: Community-Meldung (aktuell) vor Online-Preis der Kette
// vor veralteter Meldung.
function effectivePrice(p, s) {
  const own = s.cheapest && { ...s.cheapest, currency: s.cheapest.currency || placeCurrency(p) };
  if (own && !own.stale) return own;
  const c = cheapestChainPrice(p);
  if (c) return { per05: c.per05, beer: c.beer, created_at: Date.parse(c.seen), online: true, promo: c.promo, currency: c.currency, chain: CHAIN_LABELS[chainOf(p).key] };
  return own;
}
// Preis pro Halbe als Bierdeckel: voll = vor Ort gemeldet, nur Rand = Online-Preis, blass = alt.
function deckel(pr, size = 'md') {
  const { value, unit } = moneyParts(pr.per05, pr.currency);
  const what = pr.online ? t('Online-Preis {chain}', { chain: pr.chain }) : timeAgo(pr.created_at);
  return `<span class="deckel deckel-${size}${pr.online ? ' online' : ''}${pr.stale ? ' stale' : ''}" title="${escapeHtml(`${pr.beer} · ${what}`)}"><b>${value}</b><small>${unit}</small></span>`;
}
function recommendationScore({ p, s, st, price }, now, late) {
  let score = (1 - Math.min(reach(p) / currentRadius(), 1)) * 30;
  if (price) {
    score += prefs.maxPrice ? (price.per05 <= prefs.maxPrice ? 22 : -18) : 8;
    if (prefs.beerType && price.beer.toLowerCase().includes(prefs.beerType.toLowerCase())) score += 12;
  }
  if (prefs.beerType && s.prices.some(x => x.beer.toLowerCase().includes(prefs.beerType.toLowerCase()))) score += 14;
  if (s.rating.avg) score += (s.rating.avg - 2.5) * 6;
  // Die Frage ist "wo krieg ich jetzt ein Bier": offen schlägt nah, zu steht hinten.
  if (st) score += st.open ? 30 : -30;
  // Spät am Abend zählt, wie lange noch offen ist.
  if (late && st && st.open && st.until) score += Math.min((st.until - now) / 3600000, 4) * 3;
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

// Was die Liste zuletzt von selbst dazugenommen hat (für die Erklärzeile).
let ctx = { widened: false, late: false };

function visibleList() {
  const now = new Date();
  const late = isLate(now.getHours());
  const beer = $('#filterBeer').value.trim().toLowerCase();
  const types = new Set(prefs.types);
  const row = p => { const s = getSummary(p.id); return { p, s, st: placeStatus(p, now), price: effectivePrice(p, s) }; };
  const near = state.places.filter(p => !isHidden(p.id) && reach(p) <= shownRadius);
  let list = near.filter(p => types.has(p.type)).map(row);

  // Kontext statt Knopf: Hat kein Bierort offen, kommt dazu, was offen hat. Spät am Abend Spätis und Tankstellen.
  ctx = { widened: false, late: false };
  if (!customTypes()) {
    // Unbekannte Zeiten zählen nicht als offen, sonst greift das in der Stadt nie.
    const noneOpen = !list.some(x => x.st && x.st.open);
    const extra = noneOpen ? p => !types.has(p.type) : late ? p => LATE_TYPES.has(p.type) : null;
    // Dafür auch weiter weg schauen als die Liste reicht: die nächsten paar, die sicher offen haben.
    const more = extra ? state.places.filter(p => !isHidden(p.id) && extra(p)).map(row).filter(x => x.st && x.st.open).sort((a, b) => a.p.distance - b.p.distance).slice(0, 8) : [];
    if (more.length) { ctx = { widened: noneOpen, late: !noneOpen }; list = list.concat(more); }
  }

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
    list.forEach(x => { x.score = recommendationScore(x, now, late); });
    list.sort((a, b) => b.score - a.score);
  }
  return list;
}

/* ---------- Darstellung ---------- */
const REASONS = {
  closed: () => t('Kein Bierort hier hat sicher offen. Das hier schon.'),
  late: () => t('Spät dran: Spätis und Tankstellen sind dabei.'),
  rain: () => t('Drinnen sitzen vorn, weil es regnet.'),
  sun: () => t('Biergärten vorn, weil die Sonne scheint.'),
};

export function render() {
  if (!state.searchCenter) return;
  const list = visibleList();
  const custom = customTypes();
  const activeFilters = [prefs.onlyOpen, prefs.onlyPrice, prefs.onlyFav, custom, prefs.sort !== 'recommended', !!$('#filterBeer').value.trim()].filter(Boolean).length;

  if (state.mode === 'find') {
    const hasBeer = list.some(x => BEER.has(x.p.type));
    mapview.renderPlaceMarkers(list.map(x => ({
      place: x.p,
      info: {
        price: x.price && !x.price.stale ? x.price.per05 : null, online: !!(x.price && x.price.online),
        closed: x.st && !x.st.open, favorite: isFavorite(x.p.id), minor: hasBeer && !BEER.has(x.p.type),
      },
    })), id => openPlace(id));
  }

  // Kopfzeile: was man sieht und wie weit, daneben der eine Knopf für alles Weitere.
  const n = list.length;
  const mixed = custom || ctx.widened || ctx.late;
  const count = mixed ? (n === 1 ? t('1 Ort') : t('{n} Orte', { n })) : (n === 1 ? t('1 Bierort') : t('{n} Bierorte', { n }));
  // Hat die Liste von selbst weiter weg gesucht, stimmt der Umkreis nicht mehr: dann ohne.
  $('#resultTitle').innerHTML = loading ? '…' : `${count}${ctx.widened || ctx.late ? '' : ` <small>${t('bis {r}', { r: fmtDist(shownRadius) })}</small>`}`;
  $('#filterCount').hidden = !activeFilters;
  $('#filterCount').textContent = activeFilters;
  const hc = hiddenCount();
  $('#btnUnhide').hidden = !hc;
  $('#btnUnhide').textContent = t('{n} ausgeblendet · zeigen', { n: hc });

  // Erklärzeile: warum die Liste so aussieht. Wetter zählt nur bei "Empfohlen".
  const w = state.weather && state.weather.current;
  const byWeather = prefs.sort === 'recommended' && n > 1;
  const reason = contextReason({
    ...ctx,
    rainy: byWeather && isRainy(w) && list.some(x => x.p.type === 'biergarten'),
    sunny: byWeather && isBiergartenWeather(w) && list.some(x => x.p.type === 'biergarten' || x.p.tags.outdoor_seating === 'yes'),
  });
  $('#contextLine').hidden = !reason || loading;
  $('#contextLine').textContent = reason ? REASONS[reason]() : '';

  // Günstigste Halbe: im Kneipen-Kontext nur ein vor Ort gemeldeter Preis, nie ein Supermarktpreis.
  const fresh = list.filter(x => x.price && !x.price.stale);
  const byPrice = (a, b) => a.price.per05 - b.price.per05;
  // Nur in einer Währung vergleichen: der des Standorts (an der Grenze sonst Franken gegen Euro).
  const cheapest = fresh.filter(x => x.price.currency === currencyFor(state.country)).sort(byPrice)[0] || fresh.sort(byPrice)[0];
  const shopContext = !prefs.types.some(ty => BEER.has(ty));
  const cc = $('#cheapestCard');
  cc.hidden = !cheapest || (cheapest.price.online && !shopContext);
  if (!cc.hidden) {
    const c = cheapest.price;
    cc.innerHTML = `<button class="cheapest-inner" data-place="${cheapest.p.id}">
      ${deckel(c, 'lg')}
      <span class="cheapest-text">
        <span class="cheapest-kicker">${t('Günstigste Halbe')}${c.online ? ' · ' + t('Online-Preis') : ''}</span>
        <span class="cheapest-beer">${escapeHtml(c.beer)}</span>
        <span class="cheapest-where">${escapeHtml(cheapest.p.name)} · ${fmtWalk(cheapest.p.distance)} · ${c.online ? t('Stand {date}', { date: new Date(c.created_at).toLocaleDateString(LOCALE) }) : timeAgo(c.created_at)}</span>
      </span>
    </button>`;
  }
  renderDeal(list);
  $('#resultsFoot').hidden = loading || !n;
  $('#btnWider').hidden = shownRadius >= MAX_RADIUS;
  $('#btnSurprise').hidden = !list.some(x => BEER.has(x.p.type));
  renderListeners.forEach(fn => fn(list));

  const box = $('#results');
  if (loading) return;
  if (!n) {
    if (activeFilters) {
      // Orte wären da, die Filter lassen nur keinen durch → ein Tipp lockert sie.
      box.innerHTML = stateBlock({ art: 'nothing', small: true, title: t('Mit diesen Filtern bleibt nichts übrig.'), action: { id: 'btnLoosen', label: t('Filter lockern') } });
      $('#btnLoosen').onclick = loosenFilters;
    } else {
      const canWiden = shownRadius < MAX_RADIUS;
      box.innerHTML = stateBlock({
        art: 'nothing', small: true, title: t('Hier ist nichts.'),
        text: t('Im Umkreis von {r} kennt die Karte keinen Bierort.', { r: fmtDist(shownRadius) }),
        action: canWiden ? { id: 'btnWiden', label: t('Weiter weg schauen') } : null,
      });
      if (canWiden) $('#btnWiden').onclick = widen;
    }
    return;
  }
  box.innerHTML = list.slice(0, 60).map(cardHtml).join('')
    + (n > 60 ? `<p class="fine center">${t('+ {n} weitere auf der Karte', { n: n - 60 })}</p>` : '');
}

// Erst die Schalter, den Sortenfilter und die Sortierung zurück; reicht das nicht, wieder die Bierorte.
function loosenFilters() {
  prefs.onlyOpen = prefs.onlyPrice = prefs.onlyFav = false;
  prefs.sort = 'recommended';
  $('#sortSelect').value = prefs.sort;
  $('#filterBeer').value = '';
  if (!visibleList().length) prefs.types = BEER_TYPES.slice();
  savePrefs();
  for (const [id, key] of Object.entries(TOGGLES)) $('#' + id).setAttribute('aria-pressed', String(!!prefs[key]));
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

// Die Aktion gilt für Läden, die in der Bierort-Liste gar nicht stehen: deshalb über alle geladenen Orte.
function renderDeal() {
  const box = $('#dealCard');
  const d = favDeal(state.places.filter(p => !isHidden(p.id)).map(p => ({ p })));
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
// Orte mit aktuellem Preis → [{ lat, lon, v, gastro }]
export function pricedPoints(list) {
  return list.filter(x => x.price && !x.price.stale && x.price.per05 != null)
    .map(x => ({ lat: x.p.lat, lon: x.p.lon, v: x.price.per05, gastro: !SHOP_TYPES.has(x.p.type) }));
}

// Eine Zeile = eine Entscheidung: Name, offen bis wann, wie weit zu Fuß, was für ein Ort, Preis.
function cardHtml({ p, s, st, price: pr }) {
  const m = TYPE_META[p.type];
  const b = statusShort(st);
  const walk = fmtWalk(p.distance);
  const outdoor = p.type === 'biergarten' || p.tags.outdoor_seating === 'yes';
  return `<article class="card" data-place="${p.id}" style="--c:${m.color}" tabindex="0" role="button" aria-label="${escapeHtml(`${p.name}, ${m.label}, ${b.text}, ${walk}${outdoor ? ', ' + t('draußen') : ''}`)}">
    <div class="card-ico">${icon(m.icon, { size: 20 })}</div>
    <div class="card-main">
      <h3 class="card-name"><span>${escapeHtml(p.name)}</span>${isFavorite(p.id) ? `<span class="card-fav">${icon('heart', { size: 16, filled: true })}</span>` : ''}${outdoor ? `<span class="card-out" title="${t('draußen')}">${icon('sun', { size: 16 })}</span>` : ''}</h3>
      <div class="card-meta">
        <span class="status status-${b.tone}">${b.text}</span>
        <span>${walk === fmtDist(p.distance) ? walk : icon('walk', { size: 16 }) + walk.replace(/ zu Fuß| walk/, '')}</span>
        <span>${m.short}</span>${s.rating.avg ? `<span>★ ${num(s.rating.avg, 1)}</span>` : ''}
      </div>
    </div>
    ${pr ? deckel(pr) : ''}
  </article>`;
}

// Tastatur: Enter/Leertaste auf einer Karte öffnet sie.
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.card[data-place]')) {
    e.preventDefault();
    openPlace(e.target.dataset.place);
  }
});
