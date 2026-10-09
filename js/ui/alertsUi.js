// Dialog "Preisalarme" + Prüfung beim Start + optionale Push-Benachrichtigungen.
import { loadWatches, saveWatches, deviceSecret, onDataChange } from '../store.js';
import { loadChainPrices, CHAIN_LABELS } from '../chainPrices.js';
import { evaluate, hitKey, KINDS } from '../alerts.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from '../config.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { escapeHtml, fetchWithTimeout, debounce } from '../util.js';
import { $, openDialog, toast } from './dom.js';

const SEEN = 'bl_alerts_seen_v1';
const PUSH = 'bl_push_on_v1';
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!SUPABASE_URL;
const money = (v, cur) => (cur === 'CHF' ? `CHF ${v.toFixed(2)}` : `${v.toFixed(2).replace('.', ',')} €`);

async function results() {
  const data = await loadChainPrices();
  return evaluate(loadWatches(), data.prices || []);
}

// Beim Start: neue Treffer seit dem letzten Mal → Badge + Hinweis
export async function checkAlerts({ notify = true } = {}) {
  const watches = loadWatches();
  const badge = $('#alertBadge');
  if (!watches.length) { badge.hidden = true; return; }
  const res = await results();
  let seen;
  try { seen = new Set(JSON.parse(localStorage.getItem(SEEN)) || []); } catch (e) { seen = new Set(); }
  const fresh = res.flatMap(r => r.hits).filter(h => !seen.has(hitKey(h)));
  badge.hidden = !fresh.length;
  badge.textContent = fresh.length;
  if (notify && fresh.length) {
    const best = fresh.sort((a, b) => a.price - b.price)[0];
    toast(`Preisalarm: ${escapeHtml(best.beer)} ${money(best.price, best.currency)} bei ${CHAIN_LABELS[best.chain] || best.chain}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ''}`,
      { tone: 'good', ms: 6000, action: { label: 'Ansehen', run: () => openAlerts() } });
  }
}

export async function openAlerts() {
  await render();
  openDialog($('#alertsDialog'));
  // Alles Gezeigte gilt als gesehen
  const res = await results();
  localStorage.setItem(SEEN, JSON.stringify(res.flatMap(r => r.hits).map(hitKey)));
  $('#alertBadge').hidden = true;
}

async function render() {
  const res = await results();
  const pushOn = pushSupported() && localStorage.getItem(PUSH) === '1' && Notification.permission === 'granted';
  $('#alertsBody').innerHTML = `
    <h2 class="dlg-title" id="alertsTitle">${icon('bell', { size: 22 })}Preisalarme</h2>
    <p class="fine">Die App prüft die Online-Preise aller Ketten (wöchentlich aktualisiert) gegen deine Wunschpreise.</p>
    <form class="alert-form" id="alertForm">
      <input name="q" placeholder="z.B. Zipfer Märzen" required maxlength="40" autocomplete="off" list="beerList">
      <select name="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <div class="price-input"><input name="max" inputmode="decimal" placeholder="max. Preis" required><span>${state.country === 'CH' ? 'CHF' : '€'}</span></div>
      <button class="btn btn-primary" type="submit">${icon('plus', { size: 16 })}Alarm</button>
    </form>
    <div class="alert-list">${res.length ? res.map(({ watch: w, hits }) => `
      <div class="alert-item">
        <div class="alert-head">
          <b>${escapeHtml(w.q)}</b><small>${KINDS[w.kind || 'any']} · bis ${money(w.max, w.country === 'CH' ? 'CHF' : 'EUR')} · ${w.country || ''}</small>
          <button class="icon-btn small" data-del="${w.id}" aria-label="Alarm löschen">${icon('trash', { size: 14 })}</button>
        </div>
        ${hits.length ? `<ul>${hits.slice(0, 6).map(h => `<li>
          <span>${escapeHtml(CHAIN_LABELS[h.chain] || h.chain)}</span>
          <span class="ah-beer">${escapeHtml(h.beer)} <small>${escapeHtml(h.package || '')}</small>${h.promo ? ' <span class="promo">Aktion</span>' : ''}</span>
          <a href="${escapeHtml(h.source)}" target="_blank" rel="noopener"><b>${money(h.price, h.currency)}</b></a></li>`).join('')}</ul>
          ${hits.length > 6 ? `<p class="fine">+ ${hits.length - 6} weitere</p>` : ''}`
        : '<p class="fine">Gerade kein Treffer — die App meldet sich, sobald es soweit ist.</p>'}
      </div>`).join('') : '<p class="fine center">Noch keine Alarme.</p>'}</div>
    ${pushSupported() ? `<label class="switch-row push-row">
      <input type="checkbox" class="switch" id="pushToggle" ${pushOn ? 'checked' : ''}>
      <span>Benachrichtigung aufs Handy <small>(auch wenn die App zu ist — kommt montags nach dem Preis-Update)</small></span>
    </label>` : ''}`;

  $('#alertForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const max = parseFloat(String(f.max.value).replace(',', '.'));
    if (!isFinite(max) || max <= 0) { toast('Bitte einen Preis eingeben', { tone: 'bad' }); return; }
    saveWatches([...loadWatches(), { id: Date.now().toString(36), q: f.q.value.trim(), kind: f.kind.value, max, country: state.country }]);
    await render();
  };
  document.querySelectorAll('#alertsBody [data-del]').forEach(b => b.onclick = async () => {
    saveWatches(loadWatches().filter(w => w.id !== b.dataset.del));
    await render();
  });
  const pt = $('#pushToggle');
  if (pt) pt.onchange = async () => {
    try {
      if (pt.checked) { await enablePush(); toast('Benachrichtigungen an', { tone: 'good' }); }
      else { await disablePush(); toast('Benachrichtigungen aus'); }
    } catch (err) {
      pt.checked = false;
      toast(err.message, { tone: 'bad' });
    }
  };
}

/* ---------- Web Push ---------- */
function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function rpc(fn, body) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) }, 15000);
  if (!res.ok) throw new Error(`Server-Fehler ${res.status}`);
}
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  await rpc('alerts_save', { p_secret: deviceSecret(), p_subscription: sub.toJSON(), p_watches: loadWatches() });
  localStorage.setItem(PUSH, '1');
}
async function disablePush() {
  localStorage.removeItem(PUSH);
  await rpc('alerts_save', { p_secret: deviceSecret(), p_subscription: null, p_watches: [] });
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
}

// Alarme geändert (auch per Sync) → Push-Abo mit den neuen Wunschpreisen aktualisieren
export function initAlerts() {
  const resave = debounce(async () => {
    if (localStorage.getItem(PUSH) !== '1' || !pushSupported() || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await rpc('alerts_save', { p_secret: deviceSecret(), p_subscription: sub.toJSON(), p_watches: loadWatches() });
    } catch (e) { /* nächstes Mal */ }
  }, 3000);
  onDataChange(resave);
}
