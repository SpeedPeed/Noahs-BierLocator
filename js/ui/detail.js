// Detailansicht eines Ortes (Dialog).
import { state, rememberPlaces } from '../state.js';
import { TYPE_META, placeAddress, fetchPlacesByIds } from '../places.js';
import { getSummary, loadSummaries, submitPrice, deletePrice, setRating, isShared } from '../community.js';
import { isFavorite, toggleFavorite, isHidden, setHidden } from '../store.js';
import { placeStatus, statusBadge } from '../placeInfo.js';
import { weekSchedule } from '../openingHours.js';
import { UNITS, validatePrice, STALE_DAYS } from '../prices.js';
import { placeLink, shareLink } from '../share.js';
import { icon } from '../icons.js';
import { escapeHtml, fmtDist, fmtEuro, timeAgo, haversine } from '../util.js';
import { $, openDialog, closeDialog, toast, beerLoader } from './dom.js';
import * as mapview from '../map.js';
import { loadChainPrices, chainPricesFor, chainOf, CHAIN_LABELS } from '../chainPrices.js';

let dlg, current = null, onChange = () => {};

export function initDetail(opts) {
  dlg = $('#placeDialog');
  onChange = opts.onChange || onChange;
}

export async function openPlace(id) {
  let place = state.placeIndex.get(id);
  dlg = dlg || $('#placeDialog');
  if (!place) {
    $('#placeBody').innerHTML = beerLoader('Ort wird geladen…');
    openDialog(dlg);
    try {
      const [p] = await fetchPlacesByIds([id]);
      if (!p) throw new Error('Ort nicht gefunden');
      const ref = state.location || p;
      p.distance = haversine(ref.lat, ref.lon, p.lat, p.lon);
      rememberPlaces([p]);
      place = p;
      mapview.setView(p.lat, p.lon, 17);
    } catch (e) {
      $('#placeBody').innerHTML = `<div class="notice notice-bad">${icon('alertTriangle', { size: 18 })}<div>${escapeHtml(e.message)}</div></div>`;
      return;
    }
  }
  current = place;
  await loadChainPrices();
  render();
  openDialog(dlg);
  loadSummaries([id]).then(() => { if (current && current.id === id) render(); }).catch(() => {});
}

function website(t) {
  const w = t.website || t['contact:website'];
  if (!w) return null;
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

function render() {
  const p = current;
  const m = TYPE_META[p.type];
  const s = getSummary(p.id);
  const st = placeStatus(p);
  const b = statusBadge(st);
  const addr = placeAddress(p);
  const fav = isFavorite(p.id);
  const week = p.tags.opening_hours ? weekSchedule(p.tags.opening_hours, new Date(), state.country) : null;
  const web = website(p.tags);
  const phone = p.tags.phone || p.tags['contact:phone'];
  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;

  const facts = [];
  if (p.tags.outdoor_seating === 'yes') facts.push(`${icon('sun', { size: 14 })}Sitzplätze draußen`);
  if (p.tags.wheelchair === 'yes') facts.push(`${icon('wheelchair', { size: 14 })}Barrierefrei`);
  if (p.tags.brewery) facts.push(`${icon('beerMug', { size: 14 })}${escapeHtml(p.tags.brewery.split(';').slice(0, 4).join(', '))}`);
  if (p.tags['drink:craft_beer'] === 'yes') facts.push(`${icon('barrel', { size: 14 })}Craft-Bier`);

  const my = s.rating.mine;
  const ratingText = s.rating.count
    ? `Ø ${s.rating.avg.toFixed(1).replace('.', ',')} aus ${s.rating.count} ${s.rating.count === 1 ? 'Bewertung' : 'Bewertungen'}`
    : 'Noch keine Bewertung';

  const priceRows = s.prices.length ? s.prices.map(pr => `
    <li class="price-row${pr.stale ? ' stale' : ''}${s.cheapest && s.cheapest.id === pr.id ? ' best' : ''}">
      <div class="pr-main">
        <span class="pr-beer">${escapeHtml(pr.beer)}</span>
        <span class="pr-unit">${UNITS[pr.unit] ? UNITS[pr.unit].label : escapeHtml(pr.unit)}${pr.unit !== '0.5l' ? ` · ${fmtEuro(pr.per05)}/0,5 l` : ''}</span>
      </div>
      <span class="pr-price">${fmtEuro(pr.price)}</span>
      <span class="pr-age" title="${new Date(pr.created_at).toLocaleString('de-DE')}">${timeAgo(pr.created_at)}${pr.stale ? ' · veraltet' : ''}</span>
      ${pr.mine ? `<button class="icon-btn small" data-del="${pr.id}" aria-label="Eigene Meldung löschen" title="Meine Meldung löschen">${icon('trash', { size: 15 })}</button>` : '<span></span>'}
    </li>`).join('') : '';

  $('#placeBody').innerHTML = `
    <header class="pd-hero" style="--c:${m.color}">
      <div class="pd-ico">${icon(m.icon, { size: 28 })}</div>
      <div class="pd-titles">
        <span class="pd-kicker">${m.label}${p.distance != null ? ` · ${fmtDist(p.distance)}` : ''}</span>
        <h2 id="placeTitle">${escapeHtml(p.name)}</h2>
        ${addr ? `<span class="pd-addr">${escapeHtml(addr)}</span>` : ''}
      </div>
    </header>

    <div class="pd-actions">
      <a class="pd-action" href="${navUrl}" target="_blank" rel="noopener">${icon('compass', { size: 20 })}<span>Route</span></a>
      <button class="pd-action${fav ? ' on' : ''}" id="pdFav" aria-pressed="${fav}">${icon('heart', { size: 20, filled: fav })}<span>${fav ? 'Favorit' : 'Merken'}</span></button>
      <button class="pd-action" id="pdShare">${icon('share', { size: 20 })}<span>Teilen</span></button>
      ${phone ? `<a class="pd-action" href="tel:${escapeHtml(phone.split(';')[0].replace(/\s/g, ''))}">${icon('phone', { size: 20 })}<span>Anrufen</span></a>` : ''}
      ${web ? `<a class="pd-action" href="${escapeHtml(web)}" target="_blank" rel="noopener">${icon('globe', { size: 20 })}<span>Website</span></a>` : ''}
    </div>

    <section class="pd-section">
      <div class="pd-status-row">
        <span class="status status-${b.tone} big"><span class="status-dot"></span>${b.text}</span>
      </div>
      ${week ? `<details class="week"><summary>Öffnungszeiten ${icon('chevronDown', { size: 15 })}</summary><table>${week.map(d => `<tr class="${d.today ? 'today' : ''}"><th>${d.label}${d.holiday ? ' <small>Feiertag</small>' : ''}</th><td>${d.text}</td></tr>`).join('')}</table></details>`
        : p.tags.opening_hours ? `<p class="fine">${icon('clock', { size: 13 })} ${escapeHtml(p.tags.opening_hours)}</p>` : ''}
      ${facts.length ? `<div class="facts">${facts.map(f => `<span class="fact">${f}</span>`).join('')}</div>` : ''}
    </section>

    <section class="pd-section">
      <h3 class="pd-h">${icon('star', { size: 16 })}Bewertung <span class="pd-h-meta">${ratingText}</span></h3>
      <div class="star-input" id="pdStars" role="radiogroup" aria-label="Deine Bewertung">
        ${[1, 2, 3, 4, 5].map(n => `<button role="radio" aria-checked="${my === n}" data-n="${n}" class="${my && n <= my ? 'on' : ''}" aria-label="${n} Stern${n > 1 ? 'e' : ''}">${icon('star', { size: 30, filled: true })}</button>`).join('')}
      </div>
      <p class="fine">${my ? `Deine Bewertung: ${my} ★ · <button class="link-btn" id="pdUnrate">zurücknehmen</button>` : 'Tippe auf einen Stern. Pro Gerät zählt eine Bewertung — du kannst sie jederzeit ändern.'}</p>
    </section>

    ${chainSection(p)}

    <section class="pd-section">
      <h3 class="pd-h">${icon('tag', { size: 16 })}Bierpreise <span class="pd-h-meta">${isShared() ? 'von der Community' : 'nur auf diesem Gerät'}</span></h3>
      ${s.prices.length ? `<ul class="price-list">${priceRows}</ul>` : `<p class="fine">Noch kein Preis gemeldet — sei die erste Person!</p>`}
      <form class="price-form" id="pdPriceForm" novalidate>
        <input name="beer" type="text" list="beerList" placeholder="Sorte, z.B. Zwickl" maxlength="40" required autocomplete="off" aria-label="Biersorte">
        <div class="price-input"><input name="price" type="text" inputmode="decimal" placeholder="0,00" required aria-label="Preis in Euro"><span>€</span></div>
        <select name="unit" aria-label="Gebinde">${Object.entries(UNITS).map(([k, u]) => `<option value="${k}">${u.label}</option>`).join('')}</select>
        <button type="submit" class="btn btn-primary" disabled>${icon('plus', { size: 16 })}Melden</button>
        <p class="form-msg" id="pdPriceMsg" aria-live="polite"></p>
      </form>
      <p class="fine">Preise älter als ${STALE_DAYS} Tage werden ausgegraut. Unrealistische Preise lassen sich nicht abschicken.</p>
    </section>

    <section class="pd-section pd-muted">
      <h3 class="pd-h">${icon('alertTriangle', { size: 16 })}Stimmt was nicht?</h3>
      <p class="fine">Die Orte stammen aus OpenStreetMap. Falsche oder geschlossene Einträge kannst du dort für alle korrigieren.</p>
      <div class="row-btns">
        <a class="btn btn-soft" href="https://www.openstreetmap.org/edit?${p.id.replace('/', '=')}" target="_blank" rel="noopener">${icon('edit', { size: 16 })}In OSM korrigieren</a>
        <button class="btn btn-soft" id="pdHide">${icon(isHidden(p.id) ? 'undo' : 'flag', { size: 16 })}${isHidden(p.id) ? 'Wieder einblenden' : 'Für mich ausblenden'}</button>
      </div>
    </section>`;

  wire(p);
}

const CHAIN_PREVIEW = 8;
const money = (v, cur) => (cur === 'CHF' ? `CHF ${v.toFixed(2)}` : fmtEuro(v));

function chainSection(p) {
  const list = chainPricesFor(p);
  if (!list.length) return '';
  const label = CHAIN_LABELS[chainOf(p).key] || 'Kette';
  const seen = list.map(x => x.seen).sort().pop();
  return `<section class="pd-section">
    <h3 class="pd-h">${icon('globe', { size: 16 })}Online-Preise ${escapeHtml(label)} <span class="pd-h-meta">${list.length} Biere · Stand ${new Date(seen).toLocaleDateString('de-DE')}</span></h3>
    ${list.length > CHAIN_PREVIEW ? `<div class="chain-search">${icon('search', { size: 16 })}<input id="pdChainSearch" type="search" placeholder="Sorte oder Marke suchen…" autocomplete="off" aria-label="Online-Preise durchsuchen"></div>` : ''}
    <ul class="price-list" id="pdChainList"></ul>
    <button class="link-btn" id="pdChainMore" hidden></button>
    <p class="fine">Laut Online-Shop der Kette, ohne Pfand, sortiert nach Preis pro 0,5 l. In der Filiale kann der Preis abweichen — wenn du ihn vor Ort siehst, melde ihn unten.</p>
  </section>`;
}

function chainRow(x) {
  const until = x.valid_until ? ' bis ' + new Date(x.valid_until).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '';
  return `<li class="price-row online">
    <div class="pr-main">
      <span class="pr-beer">${escapeHtml(x.beer)}${x.promo ? ` <span class="promo">Aktion${until}</span>` : ''}</span>
      <span class="pr-unit">${escapeHtml(x.package || (UNITS[x.unit] ? UNITS[x.unit].label : ''))}${x.per05 != null && x.unit !== '0.5l' ? ` · ${money(x.per05, x.currency)}/0,5 l` : ''}</span>
    </div>
    <span class="pr-price">${money(x.price, x.currency)}</span>
    <a class="pr-age" href="${escapeHtml(x.source)}" target="_blank" rel="noopener">Quelle</a>
    <span></span>
  </li>`;
}

// Liste mit Suche: zuerst die günstigsten, "alle anzeigen" klappt auf.
function wireChainList(p) {
  const ul = $('#pdChainList');
  if (!ul) return;
  const all = chainPricesFor(p).slice().sort((a, b) => (a.per05 ?? 99) - (b.per05 ?? 99));
  const input = $('#pdChainSearch');
  const more = $('#pdChainMore');
  let showAll = false;
  const draw = () => {
    const q = input ? input.value.trim().toLowerCase() : '';
    const words = q.split(/\s+/).filter(Boolean);
    const hits = words.length ? all.filter(x => words.every(w => `${x.beer} ${x.package}`.toLowerCase().includes(w))) : all;
    const shown = showAll || words.length ? hits.slice(0, 300) : hits.slice(0, CHAIN_PREVIEW);
    ul.innerHTML = shown.map(chainRow).join('') || '<li class="fine">Nichts gefunden.</li>';
    const rest = hits.length - shown.length;
    more.hidden = rest <= 0;
    more.textContent = `Alle ${hits.length} anzeigen`;
  };
  if (input) input.addEventListener('input', draw);
  more.onclick = () => { showAll = true; draw(); };
  draw();
}

function wire(p) {
  wireChainList(p);
  $('#pdFav').onclick = () => {
    const on = toggleFavorite(p.id);
    toast(on ? 'Als Favorit gemerkt' : 'Aus Favoriten entfernt', { tone: on ? 'good' : 'info', ms: 1600 });
    render(); onChange();
  };
  $('#pdShare').onclick = async () => {
    const r = await shareLink({ title: p.name, text: `${p.name} — gefunden mit dem Bier-Locator`, url: placeLink(p.id) });
    if (r === 'copied') toast('Link kopiert!', { tone: 'good' });
    else if (r === 'failed') toast('Teilen nicht möglich', { tone: 'bad' });
  };
  $('#pdHide').onclick = () => {
    const hide = !isHidden(p.id);
    setHidden(p.id, hide);
    onChange();
    if (hide) {
      closeDialog(dlg);
      toast('Ort ausgeblendet', { action: { label: 'Rückgängig', run: () => { setHidden(p.id, false); onChange(); } } });
    } else render();
  };

  // Sterne (mit Hover-Vorschau)
  const starBox = $('#pdStars');
  const btns = [...starBox.querySelectorAll('button')];
  const preview = n => btns.forEach((b, i) => b.classList.toggle('hover', i < n));
  btns.forEach(b => {
    b.onmouseenter = () => preview(+b.dataset.n);
    b.onclick = async () => {
      const n = +b.dataset.n;
      btns.forEach((x, i) => x.classList.toggle('on', i < n));
      b.classList.add('pop');
      try { await setRating(p.id, n); toast(`Danke! ${n} ★`, { tone: 'good', ms: 1500 }); render(); onChange(); }
      catch (e) { toast(e.message, { tone: 'bad' }); render(); }
    };
  });
  starBox.onmouseleave = () => preview(0);
  const unrate = $('#pdUnrate');
  if (unrate) unrate.onclick = async () => {
    try { await setRating(p.id, null); render(); onChange(); } catch (e) { toast(e.message, { tone: 'bad' }); }
  };

  // Eigene Preise löschen
  $('#placeBody').querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = async () => {
      try { await deletePrice(p.id, isShared() ? Number(btn.dataset.del) : btn.dataset.del); toast('Meldung gelöscht'); render(); onChange(); }
      catch (e) { toast(e.message, { tone: 'bad' }); }
    };
  });

  // Preis melden — mit Live-Prüfung, unrealistische Preise sind nicht abschickbar
  const form = $('#pdPriceForm');
  const msg = $('#pdPriceMsg');
  const submit = form.querySelector('button[type="submit"]');
  const check = () => {
    const beer = form.beer.value, price = form.price.value, unit = form.unit.value;
    if (!price.trim()) { submit.disabled = true; msg.textContent = ''; msg.className = 'form-msg'; return null; }
    const v = validatePrice(price, unit, beer || 'x');
    submit.disabled = !v.ok || !beer.trim();
    if (!v.ok) { msg.textContent = v.message; msg.className = 'form-msg bad'; }
    else if (!beer.trim()) { msg.textContent = 'Noch die Sorte eintragen.'; msg.className = 'form-msg'; }
    else { msg.textContent = unit === '0.5l' ? 'Passt!' : `Entspricht ${fmtEuro(v.per05)} pro 0,5 l.`; msg.className = 'form-msg good'; }
    return v;
  };
  form.addEventListener('input', check);
  form.addEventListener('change', check);
  form.onsubmit = async e => {
    e.preventDefault();
    const v = check();
    if (!v || !v.ok || !form.beer.value.trim()) return;
    submit.disabled = true;
    try {
      await submitPrice(p.id, { beer: form.beer.value, price: v.price, unit: form.unit.value });
      toast('Preis gemeldet — danke! 🍻', { tone: 'good' });
      render(); onChange();
    } catch (err) {
      msg.textContent = err.message; msg.className = 'form-msg bad';
      submit.disabled = false;
    }
  };
}
