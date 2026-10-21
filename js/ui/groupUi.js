// "Meine Runde": Gruppe für eine gemeinsame Tour. Bestenliste & Biere zählen,
// Live-Standort (nur wenn eingeschaltet), Runden & Abrechnung, Abstimmung über
// den nächsten Stopp und über einzelne Stopps.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { deviceSecret, loadDiary, loadTours, loadStats } from '../store.js';
import { state, on, rememberPlaces } from '../state.js';
import { fetchPlacesByIds } from '../places.js';
import { getSummary } from '../community.js';
import { cheapestChainPrice } from '../chainPrices.js';
import { evaluateBadges } from '../badges.js';
import { balances, settle } from '../settle.js';
import { icon } from '../icons.js';
import { escapeHtml, fetchWithTimeout, timeAgo, fmtEuro } from '../util.js';
import { $, openDialog, toast } from './dom.js';
import { shareLink } from '../share.js';
import { loadSharedTour, getTour, alternativesFor, swapStop } from './tourUi.js';
import * as mapview from '../map.js';

const KEY = 'bl_group_v1';      // { code, name }
const NAME = 'bl_group_name_v1';
const SHARE = 'bl_group_share_v1'; // Gruppencode, für den der Standort geteilt wird
let poll = null;
let tab = 'people';
let last = null;                // letzter Gruppenstatus
let lastPing = 0, lastFetch = 0, dirty = false, loadedTourKey = null, pollNotified = null;
const money = v => (state.country === 'CH' ? `CHF ${v.toFixed(2)}` : fmtEuro(v));

const current = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
const setCurrent = v => (v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY));
const groupLink = code => `${location.origin}${location.pathname}#gruppe=${code}`;
export const activeGroup = () => current();
const sharing = () => { const g = current(); return !!g && localStorage.getItem(SHARE) === g.code; };
const v3 = st => !!(st && st.v >= 3);
const COLORS = ['#e8921b', '#3e9a52', '#2f7fc1', '#a0569f', '#c43d25', '#1b9696', '#6a4fd0', '#8a4b22'];
const colorOf = id => COLORS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

async function rpc(fn, body) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) }, 15000);
  if (!res.ok) {
    let msg = `Server-Fehler ${res.status}`;
    try { const j = await res.json(); msg = j.message || msg; } catch (e) { /* egal */ }
    if (res.status === 404 && /function/i.test(msg)) msg = 'Dafür fehlt noch das Datenbank-Update (supabase/003_runde.sql).';
    if (/not found/.test(msg)) msg = 'Diese Gruppe gibt es nicht (mehr) — Gruppen gelten 7 Tage.';
    if (/full/.test(msg)) msg = 'Die Gruppe ist voll (max. 30).';
    if (/implausible/.test(msg)) msg = 'Der Betrag ist unrealistisch (0,30–15 € pro Bier).';
    throw new Error(msg);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function tourPayload() {
  const t = state.tour;
  return {
    start: t.start, end: t.roundtrip ? null : t.end, style: t.style,
    km: Math.round(t.targetM / 1000), dwell: Math.round(t.dwellSec / 60),
    stopIds: t.stops.map(s => s.id),
    names: Object.fromEntries(t.stops.map(s => [s.id, s.name])),
  };
}

function myStats() {
  const tours = loadTours().filter(t => !t.deleted);
  const unlocked = evaluateBadges({ diary: loadDiary(), tours, stats: loadStats() }).filter(b => b.unlocked).length;
  return { badges: unlocked, prices: loadStats().prices || 0, km: Math.round(tours.reduce((s, t) => s + (t.km || 0), 0)) };
}

export function initGroup() {
  on('open-group', () => openGroupMenu());
  // Während einer Live-Tour zählt jedes eingecheckte Bier auch in der Runde.
  on('diary-added', async () => {
    const g = current();
    if (!g || !state.live) return;
    try { await rpc('group_drink', { p_code: g.code, p_secret: deviceSecret(), p_delta: 1 }); } catch (e) { /* egal */ }
  });
}

/* ---------- Einstieg ---------- */
// Menü "Meine Runde" bzw. Button "Mit Freunden" in der Tour
export async function openGroupMenu() {
  const g = current();
  if (g) { await openGroup(g.code); return; }
  const hasTour = !!state.tour;
  $('#groupBody').innerHTML = `
    <h2 class="dlg-title" id="groupTitle">${icon('users', { size: 22 })}Meine Runde</h2>
    <p>Mach eine Gruppe für deine Leute: ${hasTour ? 'alle sehen dieselbe Tour, ' : ''}Biere zählen, Runden abrechnen, über Stopps abstimmen — und unterwegs sehen, wo die anderen sind.</p>
    <form class="group-form" id="groupCreate">
      <label class="field"><span class="field-label">Dein Name</span><input name="name" required maxlength="24" value="${escapeHtml(localStorage.getItem(NAME) || '')}" autocomplete="nickname"></label>
      <label class="field"><span class="field-label">Name der Runde</span><input name="title" required maxlength="60" value="Biertour ${new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}"></label>
      <button class="btn btn-primary btn-big" type="submit">${icon('users', { size: 18 })}Gruppe erstellen${hasTour ? ' (mit Tour)' : ''}</button>
    </form>
    <div class="sync-or"><span>oder mit Code beitreten</span></div>
    <form class="sync-join" id="groupCode">
      <input name="code" placeholder="z.B. K7PX3M" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Gruppencode">
      <button class="btn btn-soft" type="submit">Beitreten</button>
    </form>
    <p class="fine">Gruppen gelten 7 Tage. Dein Standort wird nur geteilt, wenn du das in der Gruppe selbst einschaltest.</p>`;
  openDialog($('#groupDialog'));
  $('#groupCreate').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    localStorage.setItem(NAME, f.name.value.trim());
    try {
      const code = await rpc('group_create', { p_secret: deviceSecret(), p_name: f.name.value.trim(), p_title: f.title.value.trim(), p_tour: state.tour ? tourPayload() : null });
      setCurrent({ code, name: f.name.value.trim() });
      tab = 'people';
      await renderGroup(code);
      share(code);
    } catch (err) { toast(err.message, { tone: 'bad' }); }
  };
  $('#groupCode').onsubmit = e => {
    e.preventDefault();
    const c = e.target.code.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (c.length !== 6) { toast('Der Code hat 6 Zeichen.', { tone: 'bad' }); return; }
    joinGroupFromLink(c);
  };
}
export const openGroupFromTour = openGroupMenu;

async function share(code) {
  const r = await shareLink({ title: 'Bier-Runde', text: `Komm in meine Runde! Code ${code}`, url: groupLink(code) });
  if (r === 'copied') toast('Einladungslink kopiert', { tone: 'good' });
}

export async function openGroup(code) {
  openDialog($('#groupDialog'));
  await renderGroup(code);
}

// Link "#gruppe=CODE"
export async function joinGroupFromLink(code) {
  code = code.toUpperCase();
  const g = current();
  if (g && g.code === code) { await openGroup(code); await loadTour(code); return; }
  $('#groupBody').innerHTML = `
    <h2 class="dlg-title" id="groupTitle">${icon('users', { size: 22 })}Runde ${escapeHtml(code)} beitreten</h2>
    <form class="group-form" id="groupJoin">
      <label class="field"><span class="field-label">Dein Name</span><input name="name" required maxlength="24" value="${escapeHtml(localStorage.getItem(NAME) || '')}" autocomplete="nickname"></label>
      <button class="btn btn-primary btn-big" type="submit">${icon('check', { size: 18 })}Beitreten</button>
    </form>`;
  openDialog($('#groupDialog'));
  $('#groupJoin').onsubmit = async e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    localStorage.setItem(NAME, name);
    try {
      await rpc('group_join', { p_code: code, p_secret: deviceSecret(), p_name: name });
      setCurrent({ code, name });
      tab = 'people';
      await renderGroup(code);
      await loadTour(code);
    } catch (err) { toast(err.message, { tone: 'bad' }); }
  };
}

async function loadTour(code) {
  const st = await rpc('group_state', { p_code: code, p_secret: deviceSecret() });
  if (st && st.tour && st.tour.stopIds) {
    loadedTourKey = st.tour.stopIds.join(',');
    document.querySelector('#tabTour').click();
    loadSharedTour(st.tour);
  }
}

/* ---------- Gruppenansicht ---------- */
async function renderGroup(code, { quiet = false } = {}) {
  clearInterval(poll);
  let st;
  try { st = await rpc('group_state', { p_code: code, p_secret: deviceSecret() }); }
  catch (e) {
    if (quiet) return;
    if (/gibt es nicht/.test(e.message)) setCurrent(null);
    $('#groupBody').innerHTML = `<h2 class="dlg-title">${icon('users', { size: 22 })}Runde</h2><div class="notice notice-bad">${icon('alertTriangle', { size: 18 })}<div>${escapeHtml(e.message)}</div></div>`;
    return;
  }
  last = st;
  dirty = false;
  const me = st.members.find(m => m.me);
  if (!me) { setCurrent(null); return; }

  $('#groupBody').innerHTML = `
    <h2 class="dlg-title" id="groupTitle">${icon('users', { size: 22 })}${escapeHtml(st.title)}</h2>
    <div class="group-code"><span>Code</span><b>${escapeHtml(st.code)}</b><button class="btn btn-soft" id="gShare">${icon('share', { size: 16 })}Einladen</button></div>
    <div class="segmented group-tabs" role="tablist">
      <button role="tab" data-gtab="people" aria-checked="${tab === 'people'}">Leute</button>
      <button role="tab" data-gtab="money" aria-checked="${tab === 'money'}">Runden</button>
      <button role="tab" data-gtab="tour" aria-checked="${tab === 'tour'}">Tour</button>
    </div>
    <div id="gPane">${tab === 'money' ? moneyPane(st) : tab === 'tour' ? tourPane(st) : peoplePane(st)}</div>
    <p class="fine">Aktualisiert sich alle 15 Sekunden. Gilt bis 7 Tage nach dem Erstellen.</p>
    <button class="link-btn danger" id="gLeave">${icon('x', { size: 14 })}Gruppe auf diesem Gerät verlassen</button>`;

  $('#gShare').onclick = () => share(st.code);
  $('#groupBody').querySelectorAll('[data-gtab]').forEach(b => b.onclick = () => { tab = b.dataset.gtab; renderGroup(st.code); });
  $('#gLeave').onclick = () => {
    if (sharing()) stopSharing();
    setCurrent(null); clearInterval(poll); $('#groupDialog').close(); mapview.setFriends([]); toast('Gruppe verlassen');
  };
  if (tab === 'people') wirePeople(st);
  else if (tab === 'money') wireMoney(st);
  else wireTour(st);

  // Nur neu zeichnen, wenn gerade niemand etwas eintippt.
  poll = setInterval(() => {
    if (!$('#groupDialog').open) { clearInterval(poll); return; }
    if (dirty || $('#groupBody').contains(document.activeElement) && document.activeElement.matches('input, select')) return;
    renderGroup(st.code, { quiet: true });
  }, 15000);
}

const nameOf = (st, id) => (st.members.find(m => m.id === id) || { name: '?' }).name;

/* --- Leute & Bestenliste --- */
function peoplePane(st) {
  const ranked = st.members.slice().sort((a, b) => b.drinks - a.drinks || a.name.localeCompare(b.name));
  const total = st.members.reduce((s, m) => s + m.drinks, 0);
  const top = ranked[0] && ranked[0].drinks > 0 ? ranked[0].drinks : null;
  const paid = new Map();
  for (const r of st.rounds || []) paid.set(r.payer, (paid.get(r.payer) || 0) + 1);
  const maxPaid = Math.max(0, ...paid.values());
  return `
    <h3 class="pd-h">${icon('beerMug', { size: 16 })}Bestenliste <span class="pd-h-meta">${total} Bier${total === 1 ? '' : 'e'} gesamt</span></h3>
    <ul class="group-members">${ranked.map(m => {
      const s = m.stats || {};
      const chips = [
        s.badges ? `<span title="Abzeichen">${icon('star', { size: 12 })}${s.badges}</span>` : '',
        s.prices ? `<span title="Gemeldete Preise">${icon('coin', { size: 12 })}${s.prices}</span>` : '',
        s.km ? `<span title="Tour-Kilometer">${icon('bike', { size: 12 })}${s.km} km</span>` : '',
        maxPaid && paid.get(m.id) === maxPaid ? `<span title="Hat die meisten Runden gezahlt">${icon('heart', { size: 12 })}Spendabel</span>` : '',
        m.lat != null ? `<span title="Teilt den Standort">${icon('pin', { size: 12 })}live</span>` : '',
      ].filter(Boolean).join('');
      return `<li class="${m.me ? 'me' : ''}">
        <span class="gm-avatar" style="--c:${colorOf(m.id || m.name)}">${escapeHtml(m.name.slice(0, 1).toUpperCase())}</span>
        <span class="gm-name"><span>${top && m.drinks === top ? '👑 ' : ''}${escapeHtml(m.name)}${m.me ? ' <small>(du)</small>' : ''}</span>
          ${chips ? `<span class="gm-chips">${chips}</span>` : ''}${m.me ? '' : `<small class="gm-seen">${timeAgo(new Date(m.last_seen).getTime())}</small>`}</span>
        ${m.me ? `<div class="stepper small"><button data-drink="-1" aria-label="Ein Bier weniger">${icon('minus', { size: 14 })}</button><output>${m.drinks}</output><button data-drink="1" aria-label="Ein Bier mehr">${icon('plus', { size: 14 })}</button></div>`
          : `<b class="gm-drinks">${m.drinks} 🍺</b>`}
      </li>`;
    }).join('')}</ul>
    ${v3(st) ? `<label class="switch-row"><input type="checkbox" class="switch" id="gShareLoc" ${sharing() ? 'checked' : ''}><span>Meinen Standort während der Live-Tour teilen <small>(nur mit dieser Gruppe, verfällt nach 15 Min)</small></span></label>`
      : `<p class="fine">${icon('info', { size: 13 })} Live-Standort, Runden & Abstimmung brauchen noch das Datenbank-Update <code>supabase/003_runde.sql</code>.</p>`}`;
}
function wirePeople(st) {
  document.querySelectorAll('#groupBody [data-drink]').forEach(b => b.onclick = async () => {
    try { await rpc('group_drink', { p_code: st.code, p_secret: deviceSecret(), p_delta: +b.dataset.drink }); renderGroup(st.code); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  });
  const sl = $('#gShareLoc');
  if (sl) sl.onchange = async () => {
    if (sl.checked) {
      localStorage.setItem(SHARE, st.code);
      toast(state.live ? 'Dein Standort wird mit der Gruppe geteilt.' : 'Wird geteilt, sobald du eine Live-Tour startest.', { tone: 'good' });
      lastPing = 0;
      if (state.live && state.location) groupLiveTick(state.location);
    } else {
      await stopSharing();
      toast('Standort wird nicht mehr geteilt.');
    }
  };
  // Stats für die Bestenliste mitschicken (ohne Standort)
  if (v3(st)) rpc('group_ping', { p_code: st.code, p_secret: deviceSecret(), p_lat: sharing() && state.live && state.location ? state.location.lat : null, p_lon: sharing() && state.live && state.location ? state.location.lon : null, p_stats: myStats() }).catch(() => {});
}
async function stopSharing() {
  const g = current();
  localStorage.removeItem(SHARE);
  if (g) { try { await rpc('group_ping', { p_code: g.code, p_secret: deviceSecret(), p_lat: null, p_lon: null, p_stats: null }); } catch (e) { /* egal */ } }
}

/* --- Runden & Abrechnung --- */
function currentStopPrice() {
  const t = getTour();
  if (!t) return { price: null, place: null };
  const i = state.live ? (state.live.here != null ? state.live.here : Math.min(state.live.next, t.stops.length - 1)) : 0;
  const p = t.stops[i];
  if (!p) return { price: null, place: null };
  const s = getSummary(p.id);
  const c = s.cheapest && !s.cheapest.stale ? s.cheapest.per05 : (cheapestChainPrice(p) || {}).per05;
  return { price: c || null, place: state.live ? p : null };
}

function moneyPane(st) {
  if (!v3(st)) return `<div class="notice">${icon('info', { size: 18 })}<div>Runden & Abrechnung brauchen noch das Datenbank-Update: <code>supabase/003_runde.sql</code> einmal im Supabase SQL-Editor ausführen.</div></div>`;
  const ids = st.members.map(m => m.id);
  const rounds = (st.rounds || []).map(r => ({ ...r, amount: Number(r.amount) }));
  const transfers = settle(balances(rounds, ids));
  const sum = rounds.reduce((s, r) => s + r.amount, 0);
  const { price, place } = currentStopPrice();
  return `
    <form class="round-form" id="gRound">
      <div class="field-row">
        <label class="field"><span class="field-label">Wer zahlt?</span>
          <select name="payer">${st.members.map(m => `<option value="${m.id}" ${m.me ? 'selected' : ''}>${escapeHtml(m.name)}${m.me ? ' (du)' : ''}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Preis pro Bier</span>
          <div class="price-input"><input name="price" inputmode="decimal" placeholder="4,50" value="${price ? price.toFixed(2).replace('.', ',') : ''}" required><span>${state.country === 'CH' ? 'CHF' : '€'}</span></div></label>
      </div>
      <div class="field"><span class="field-label">Wer trinkt mit? <b id="gRoundSum"></b></span>
        <div class="who-chips">${st.members.map(m => `<label class="who"><input type="checkbox" name="who" value="${m.id}" checked><span>${escapeHtml(m.name)}</span></label>`).join('')}</div></div>
      <input type="hidden" name="place" value="${place ? escapeHtml(place.name) : ''}">
      <button class="btn btn-primary" type="submit">${icon('beerMug', { size: 17 })}Runde eintragen${place ? ` · ${escapeHtml(place.name)}` : ''}</button>
    </form>
    ${rounds.length ? `
      <h3 class="pd-h">${icon('coin', { size: 16 })}Abrechnung <span class="pd-h-meta">${money(sum)} gesamt</span></h3>
      ${transfers.length ? `<ul class="settle-list">${transfers.map(t => `<li><b>${escapeHtml(nameOf(st, t.from))}</b>${icon('chevronRight', { size: 14 })}<b>${escapeHtml(nameOf(st, t.to))}</b><span>${money(t.amount)}</span></li>`).join('')}</ul>`
        : '<p class="fine">Alles ausgeglichen. 🍻</p>'}
      <h3 class="pd-h">${icon('book', { size: 16 })}Runden</h3>
      <ul class="round-list">${rounds.slice().reverse().map(r => `<li>
        <div><b>${escapeHtml(nameOf(st, r.payer))}</b> zahlt ${r.beers} × ${money(r.amount / r.beers)}${r.place_name ? ` <small>· ${escapeHtml(r.place_name)}</small>` : ''}<small>${new Date(r.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</small></div>
        <span>${money(r.amount)}</span>
        ${r.mine || st.is_owner ? `<button class="icon-btn small" data-delround="${r.id}" aria-label="Runde löschen">${icon('trash', { size: 14 })}</button>` : '<span></span>'}
      </li>`).join('')}</ul>`
      : '<p class="fine">Noch keine Runde eingetragen. Wer eine Runde ausgibt, trägt sie hier ein — am Ende rechnet die App aus, wer wem was schuldet.</p>'}`;
}
function wireMoney(st) {
  const f = $('#gRound');
  if (!f) return;
  const parse = () => parseFloat(String(f.price.value).replace(',', '.'));
  const upd = () => {
    const n = f.querySelectorAll('[name=who]:checked').length;
    const p = parse();
    $('#gRoundSum').textContent = n && p > 0 ? `${n} × = ${money(n * p)}` : '';
  };
  f.addEventListener('input', () => { dirty = true; upd(); });
  upd();
  f.onsubmit = async e => {
    e.preventDefault();
    const who = [...f.querySelectorAll('[name=who]:checked')].map(x => x.value);
    const p = parse();
    if (!who.length) { toast('Wer trinkt mit?', { tone: 'bad' }); return; }
    if (!(p >= 0.3 && p <= 15)) { toast('Bitte einen realistischen Preis pro Bier (0,30–15 €).', { tone: 'bad' }); return; }
    try {
      await rpc('group_round_add', { p_code: st.code, p_secret: deviceSecret(), p_payer: f.payer.value, p_participants: who, p_amount: Math.round(p * who.length * 100) / 100, p_beers: who.length, p_place_name: f.place.value || null });
      toast('Runde eingetragen — Prost! 🍻', { tone: 'good' });
      renderGroup(st.code);
    } catch (err) { toast(err.message, { tone: 'bad' }); }
  };
  document.querySelectorAll('#groupBody [data-delround]').forEach(b => b.onclick = async () => {
    try { await rpc('group_round_del', { p_code: st.code, p_secret: deviceSecret(), p_id: Number(b.dataset.delround) }); renderGroup(st.code); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  });
}

/* --- Tour: Abstimmung über den nächsten Stopp & über einzelne Stopps --- */
function pollIndex() {
  const t = getTour();
  if (!t) return 0;
  return state.live ? Math.min(state.live.here != null ? state.live.here + 1 : state.live.next, t.stops.length - 1) : 0;
}
function tourPane(st) {
  const votes = new Map((st.votes || []).map(v => [v.stop_id, v]));
  const stops = st.tour ? st.tour.stopIds : [];
  const pl = st.poll;
  const counts = pl ? pl.counts || {} : {};
  const maxVotes = pl ? Math.max(0, ...pl.options.map(o => counts[o.id] || 0)) : 0;
  const changed = st.tour && loadedTourKey && st.tour.stopIds.join(',') !== loadedTourKey;
  return `
    ${changed ? `<div class="notice notice-good">${icon('refresh', { size: 18 })}<div>Die Tour der Gruppe wurde geändert.</div><button class="btn btn-soft" id="gReload">Laden</button></div>` : ''}
    ${pl ? `<div class="poll-card">
      <h3 class="pd-h">${icon('thumbUp', { size: 16 })}Abstimmung: Stopp ${pl.stop + 1} <span class="pd-h-meta">${Object.values(counts).reduce((a, b) => a + b, 0)} von ${st.members.length} Stimmen</span></h3>
      <div class="poll-options">${pl.options.map((o, i) => {
        const n = counts[o.id] || 0;
        return `<button class="poll-opt${pl.mine === o.id ? ' on' : ''}" data-pollvote="${o.id}">
          <span class="poll-bar" style="width:${st.members.length ? (n / st.members.length) * 100 : 0}%"></span>
          <b>${escapeHtml(o.name)}</b><small>${i === 0 ? 'bisheriger Stopp' : escapeHtml(o.kind || 'Alternative')}${o.dist ? ` · ${escapeHtml(o.dist)}` : ''}</small>
          <span class="poll-n">${n}${n && n === maxVotes ? ' 👑' : ''}</span></button>`;
      }).join('')}</div>
      <div class="row-btns">
        ${st.is_owner ? `<button class="btn btn-primary" id="gPollApply">${icon('check', { size: 16 })}Gewinner übernehmen</button>` : ''}
        <button class="btn btn-soft" id="gPollEnd">${icon('x', { size: 16 })}Abstimmung beenden</button>
      </div>
    </div>` : ''}
    ${!pl && v3(st) && st.tour && getTour() ? `<button class="btn btn-soft btn-wide" id="gPollNew">${icon('thumbUp', { size: 16 })}Über den nächsten Stopp abstimmen</button>` : ''}
    ${stops.length ? `<h3 class="pd-h">${icon('route', { size: 16 })}Stopps <span class="pd-h-meta">Daumen hoch oder runter</span></h3>
    <ol class="group-stops">${stops.map((id, i) => {
      const v = votes.get(id) || { up: 0, down: 0, mine: null };
      return `<li><span class="ts-num">${i + 1}</span><span class="gs-name">${escapeHtml(st.tour.names?.[id] || id)}</span>
        <button class="vote ${v.mine === 1 ? 'on' : ''}" data-vote="1" data-stop="${id}" aria-label="Dafür">${icon('thumbUp', { size: 16 })}<small>${v.up}</small></button>
        <button class="vote down ${v.mine === -1 ? 'on' : ''}" data-vote="-1" data-stop="${id}" aria-label="Dagegen">${icon('thumbDown', { size: 16 })}<small>${v.down}</small></button></li>`;
    }).join('')}</ol>` : '<p class="fine">Diese Runde hat noch keine Tour. Plane eine unter „Bier-Radtour“ und übernimm sie hier.</p>'}
    <div class="row-btns">
      ${st.tour ? `<button class="btn btn-soft" id="gLoad">${icon('map', { size: 16 })}Tour auf Karte</button>` : ''}
      ${st.is_owner ? `<button class="btn btn-soft" id="gUpdate">${icon('refresh', { size: 16 })}Meine Tour übernehmen</button>` : ''}
    </div>`;
}
function wireTour(st) {
  const bind = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  bind('#gLoad', () => loadTour(st.code));
  bind('#gReload', () => loadTour(st.code));
  bind('#gUpdate', async () => {
    if (!state.tour) { toast('Erst eine Tour planen.'); return; }
    try { await rpc('group_set_tour', { p_code: st.code, p_secret: deviceSecret(), p_tour: tourPayload() }); loadedTourKey = state.tour.stops.map(s => s.id).join(','); toast('Tour für alle aktualisiert', { tone: 'good' }); renderGroup(st.code); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  });
  document.querySelectorAll('#groupBody [data-vote]').forEach(b => b.onclick = async () => {
    const v = (st.votes || []).find(x => x.stop_id === b.dataset.stop);
    const want = v && v.mine === +b.dataset.vote ? 0 : +b.dataset.vote;
    try { await rpc('group_vote', { p_code: st.code, p_secret: deviceSecret(), p_stop_id: b.dataset.stop, p_vote: want }); renderGroup(st.code); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  });
  bind('#gPollNew', async () => {
    const t = getTour();
    const i = pollIndex();
    const cur = t.stops[i];
    const alts = alternativesFor(i).slice(0, 2);
    if (!alts.length) { toast('Für diesen Stopp gibt es keine Alternative in der Nähe.'); return; }
    const kind = p => ({ pub: 'Kneipe', biergarten: 'Biergarten', brewery: 'Brauerei', gasthaus: 'Gasthaus' }[p.type] || 'Lokal');
    const options = [cur, ...alts].map(p => ({ id: p.id, name: p.name.slice(0, 60), kind: kind(p) }));
    try { await rpc('group_poll_set', { p_code: st.code, p_secret: deviceSecret(), p_poll: { stop: i, options } }); toast('Abstimmung gestartet — alle können jetzt wählen.', { tone: 'good' }); renderGroup(st.code); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  });
  document.querySelectorAll('#groupBody [data-pollvote]').forEach(b => b.onclick = async () => {
    try { await rpc('group_poll_vote', { p_code: st.code, p_secret: deviceSecret(), p_option: b.dataset.pollvote }); renderGroup(st.code); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  });
  bind('#gPollEnd', async () => {
    try { await rpc('group_poll_set', { p_code: st.code, p_secret: deviceSecret(), p_poll: null }); renderGroup(st.code); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  });
  bind('#gPollApply', async () => {
    const pl = st.poll;
    const counts = pl.counts || {};
    const win = pl.options.slice().sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))[0];
    const t = getTour();
    if (!t || !t.stops[pl.stop] || t.stops[pl.stop].id !== pl.options[0].id) { toast('Lade zuerst die Tour der Gruppe („Tour auf Karte“).'); return; }
    try {
      if (win.id !== pl.options[0].id) {
        let place = state.placeIndex.get(win.id);
        if (!place) { [place] = await fetchPlacesByIds([win.id]); if (place) rememberPlaces([place]); }
        if (!place) throw new Error('Ort nicht gefunden');
        const ok = await swapStop(pl.stop, { replacement: place });
        if (!ok) return;
        await rpc('group_set_tour', { p_code: st.code, p_secret: deviceSecret(), p_tour: tourPayload() });
        loadedTourKey = state.tour.stops.map(s => s.id).join(',');
      }
      await rpc('group_poll_set', { p_code: st.code, p_secret: deviceSecret(), p_poll: null });
      toast(win.id === pl.options[0].id ? 'Bleibt wie geplant.' : `Neuer Stopp: ${escapeHtml(win.name)}`, { tone: 'good' });
      renderGroup(st.code);
    } catch (e) { toast(e.message, { tone: 'bad' }); }
  });
}

/* ---------- Live-Tour: Standort teilen & Freunde auf der Karte ---------- */
export async function groupLiveTick(pos) {
  const g = current();
  if (!g) return;
  const now = Date.now();
  try {
    if (sharing() && now - lastPing > 20000) {
      lastPing = now;
      await rpc('group_ping', { p_code: g.code, p_secret: deviceSecret(), p_lat: +pos.lat.toFixed(5), p_lon: +pos.lon.toFixed(5), p_stats: myStats() });
    }
    if (now - lastFetch > 20000) {
      lastFetch = now;
      const st = await rpc('group_state', { p_code: g.code, p_secret: deviceSecret() });
      last = st;
      const friends = st.members.filter(m => !m.me && m.lat != null).map(m => ({
        name: m.name, lat: m.lat, lon: m.lon, color: colorOf(m.id || m.name), ago: timeAgo(new Date(m.pos_at).getTime()),
      }));
      mapview.setFriends(friends);
      // Tour von der Gruppe geändert (z.B. nach einer Abstimmung)?
      if (st.tour && st.tour.stopIds && !st.is_owner) {
        const key = st.tour.stopIds.join(',');
        const mine = getTour() ? getTour().stops.map(s => s.id).join(',') : null;
        if (mine && key !== mine && key !== loadedTourKey) {
          loadedTourKey = key;
          toast('Die Runde hat die Tour geändert.', { ms: 9000, action: { label: 'Laden', run: () => loadSharedTour(st.tour) } });
        }
      }
      if (st.poll && !st.poll.mine && st.poll.at !== pollNotified && (pollNotified = st.poll.at)) toast('Abstimmung über den nächsten Stopp läuft.', { ms: 6000, action: { label: 'Abstimmen', run: () => { tab = 'tour'; openGroup(g.code); } } });
    }
  } catch (e) { /* nächstes Mal */ }
}
export function groupLiveStop() {
  mapview.setFriends([]);
  if (sharing()) {
    const g = current();
    rpc('group_ping', { p_code: g.code, p_secret: deviceSecret(), p_lat: null, p_lon: null, p_stats: myStats() }).catch(() => {});
  }
}
// Namen der anderen in der Runde (für "Meine Touren")
export function groupMates() {
  if (!current() || !last) return [];
  return last.members.filter(m => !m.me).map(m => m.name);
}
