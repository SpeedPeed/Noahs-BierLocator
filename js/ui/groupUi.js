// Gruppen-Tour: Tour mit Freunden teilen, über Stopps abstimmen, Biere mitzählen.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { deviceSecret } from '../store.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { escapeHtml, fetchWithTimeout, timeAgo } from '../util.js';
import { $, openDialog, toast } from './dom.js';
import { shareLink } from '../share.js';
import { loadSharedTour } from './tourUi.js';

const KEY = 'bl_group_v1';      // { code, name }
const NAME = 'bl_group_name_v1';
let poll = null;

const current = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
const setCurrent = v => (v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY));
const groupLink = code => `${location.origin}${location.pathname}#gruppe=${code}`;
export const activeGroup = () => current();

async function rpc(fn, body) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) }, 15000);
  if (!res.ok) {
    let msg = `Server-Fehler ${res.status}`;
    try { const j = await res.json(); msg = j.message || msg; } catch (e) { /* egal */ }
    if (/not found/.test(msg)) msg = 'Diese Gruppe gibt es nicht (mehr) — Gruppen gelten 7 Tage.';
    if (/full/.test(msg)) msg = 'Die Gruppe ist voll (max. 30).';
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

// Button "Mit Freunden fahren" in der Tour
export async function openGroupFromTour() {
  const g = current();
  if (g) { await openGroup(g.code); return; }
  if (!state.tour) { toast('Erst eine Tour planen.'); return; }
  $('#groupBody').innerHTML = `
    <h2 class="dlg-title" id="groupTitle">${icon('users', { size: 22 })}Mit Freunden fahren</h2>
    <p>Teile die Tour mit deiner Runde: Alle sehen dieselbe Route, stimmen über die Stopps ab und zählen ihre Biere mit.</p>
    <form class="group-form" id="groupCreate">
      <label class="field"><span class="field-label">Dein Name</span><input name="name" required maxlength="24" value="${escapeHtml(localStorage.getItem(NAME) || '')}" autocomplete="nickname"></label>
      <label class="field"><span class="field-label">Name der Tour</span><input name="title" required maxlength="60" value="Biertour ${new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })}"></label>
      <button class="btn btn-primary btn-big" type="submit">${icon('users', { size: 18 })}Gruppe erstellen</button>
    </form>
    <p class="fine">Gruppen gelten 7 Tage. Es wird kein Standort geteilt.</p>`;
  openDialog($('#groupDialog'));
  $('#groupCreate').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    localStorage.setItem(NAME, f.name.value.trim());
    try {
      const code = await rpc('group_create', { p_secret: deviceSecret(), p_name: f.name.value.trim(), p_title: f.title.value.trim(), p_tour: tourPayload() });
      setCurrent({ code, name: f.name.value.trim() });
      await renderGroup(code);
      share(code);
    } catch (err) { toast(err.message, { tone: 'bad' }); }
  };
}

async function share(code) {
  const r = await shareLink({ title: 'Bier-Radtour', text: `Fahr mit! Gruppe ${code}`, url: groupLink(code) });
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
    <h2 class="dlg-title" id="groupTitle">${icon('users', { size: 22 })}Gruppe ${escapeHtml(code)} beitreten</h2>
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
      await renderGroup(code);
      await loadTour(code);
    } catch (err) { toast(err.message, { tone: 'bad' }); }
  };
}

async function loadTour(code) {
  const st = await rpc('group_state', { p_code: code, p_secret: deviceSecret() });
  if (st && st.tour && st.tour.stopIds) {
    document.querySelector('#tabTour').click();
    loadSharedTour(st.tour);
  }
}

async function renderGroup(code) {
  clearInterval(poll);
  let st;
  try { st = await rpc('group_state', { p_code: code, p_secret: deviceSecret() }); }
  catch (e) {
    setCurrent(null);
    $('#groupBody').innerHTML = `<h2 class="dlg-title">${icon('users', { size: 22 })}Gruppe</h2><div class="notice notice-bad">${icon('alertTriangle', { size: 18 })}<div>${escapeHtml(e.message)}</div></div>`;
    return;
  }
  const me = st.members.find(m => m.me);
  const votes = new Map((st.votes || []).map(v => [v.stop_id, v]));
  const stops = st.tour ? st.tour.stopIds : [];
  const total = st.members.reduce((s, m) => s + m.drinks, 0);
  $('#groupBody').innerHTML = `
    <h2 class="dlg-title" id="groupTitle">${icon('users', { size: 22 })}${escapeHtml(st.title)}</h2>
    <div class="group-code"><span>Gruppencode</span><b>${escapeHtml(st.code)}</b><button class="btn btn-soft" id="gShare">${icon('share', { size: 16 })}Einladen</button></div>

    <h3 class="pd-h">${icon('beerMug', { size: 16 })}Runde <span class="pd-h-meta">${total} Bier${total === 1 ? '' : 'e'} gesamt</span></h3>
    <ul class="group-members">${st.members.map(m => `
      <li class="${m.me ? 'me' : ''}">
        <span class="gm-name">${escapeHtml(m.name)}${m.me ? ' <small>(du)</small>' : ''}</span>
        <small class="gm-seen">${m.me ? '' : timeAgo(new Date(m.last_seen).getTime())}</small>
        ${m.me ? `<div class="stepper small"><button data-drink="-1" aria-label="Ein Bier weniger">${icon('minus', { size: 14 })}</button><output>${m.drinks}</output><button data-drink="1" aria-label="Ein Bier mehr">${icon('plus', { size: 14 })}</button></div>`
          : `<b class="gm-drinks">${m.drinks} 🍺</b>`}
      </li>`).join('')}</ul>

    ${stops.length ? `<h3 class="pd-h">${icon('route', { size: 16 })}Stopps <span class="pd-h-meta">abstimmen</span></h3>
    <ol class="group-stops">${stops.map((id, i) => {
      const v = votes.get(id) || { up: 0, down: 0, mine: null };
      return `<li><span class="ts-num">${i + 1}</span><span class="gs-name">${escapeHtml(st.tour.names?.[id] || id)}</span>
        <button class="vote ${v.mine === 1 ? 'on' : ''}" data-vote="1" data-stop="${id}" aria-label="Dafür">${icon('thumbUp', { size: 16 })}<small>${v.up}</small></button>
        <button class="vote down ${v.mine === -1 ? 'on' : ''}" data-vote="-1" data-stop="${id}" aria-label="Dagegen">${icon('thumbDown', { size: 16 })}<small>${v.down}</small></button></li>`;
    }).join('')}</ol>` : ''}

    <div class="row-btns">
      <button class="btn btn-soft" id="gLoad">${icon('map', { size: 16 })}Tour auf Karte</button>
      ${st.is_owner ? `<button class="btn btn-soft" id="gUpdate">${icon('refresh', { size: 16 })}Meine aktuelle Tour übernehmen</button>` : ''}
    </div>
    <p class="fine">Aktualisiert sich alle 15 Sekunden. Gilt bis 7 Tage nach dem Erstellen.</p>
    <button class="link-btn danger" id="gLeave">${icon('x', { size: 14 })}Gruppe auf diesem Gerät verlassen</button>`;

  $('#gShare').onclick = () => share(st.code);
  $('#gLoad').onclick = () => loadTour(st.code);
  const up = $('#gUpdate');
  if (up) up.onclick = async () => {
    if (!state.tour) { toast('Erst eine Tour planen.'); return; }
    try { await rpc('group_set_tour', { p_code: st.code, p_secret: deviceSecret(), p_tour: tourPayload() }); toast('Tour für alle aktualisiert', { tone: 'good' }); renderGroup(st.code); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  };
  $('#gLeave').onclick = () => { setCurrent(null); clearInterval(poll); $('#groupDialog').close(); toast('Gruppe verlassen'); };
  document.querySelectorAll('#groupBody [data-drink]').forEach(b => b.onclick = async () => {
    try { await rpc('group_drink', { p_code: st.code, p_secret: deviceSecret(), p_delta: +b.dataset.drink }); renderGroup(st.code); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  });
  document.querySelectorAll('#groupBody [data-vote]').forEach(b => b.onclick = async () => {
    const v = votes.get(b.dataset.stop);
    const want = v && v.mine === +b.dataset.vote ? 0 : +b.dataset.vote;
    try { await rpc('group_vote', { p_code: st.code, p_secret: deviceSecret(), p_stop_id: b.dataset.stop, p_vote: want }); renderGroup(st.code); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  });
  if (!me) setCurrent(null);

  poll = setInterval(() => { if ($('#groupDialog').open) renderGroup(st.code); else clearInterval(poll); }, 15000);
}
