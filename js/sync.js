// Geräte-Sync über Supabase: alle Geräte mit demselben Sync-Code teilen Favoriten,
// Vorlieben, Promille-Log, Tagebuch und Preisalarme. Kein Login — der Code ist der
// Schlüssel (wird per QR-Code/Link übertragen, gespeichert wird nur sein Hash).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { exportSync, importSync, onDataChange } from './store.js';
import { fetchWithTimeout, debounce } from './util.js';
import { emit } from './state.js';

const KEY = 'bl_sync_code_v1';
const LAST = 'bl_sync_last_v1';
let running = null;

export const syncAvailable = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export function syncCode() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
export function lastSync() { const v = Number(localStorage.getItem(LAST)); return v ? new Date(v) : null; }

// 25 Zeichen aus einem Alphabet ohne verwechselbare Zeichen (~125 Bit).
export function newCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(25));
  const raw = Array.from(bytes, b => abc[b % abc.length]).join('');
  return raw.match(/.{5}/g).join('-');
}
export const normalizeCode = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{5})(?=.)/g, '$1-');
export const syncLink = code => `${location.origin}${location.pathname}#sync=${code}`;

async function rpc(fn, body) {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  const res = await fetchWithTimeout(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) }, 15000);
  if (!res.ok) throw new Error(`Sync-Fehler ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Holen → zusammenführen → zurückschreiben. Gibt true zurück, wenn sich lokal etwas geändert hat.
export async function syncNow() {
  const code = syncCode();
  if (!code || !syncAvailable()) return false;
  if (running) return running;
  running = (async () => {
    const remote = await rpc('sync_pull', { p_code: code });
    const localChanged = remote && remote.data ? importSync(remote.data) : false;
    await rpc('sync_push', { p_code: code, p_data: exportSync() });
    localStorage.setItem(LAST, String(Date.now()));
    if (localChanged) emit('sync-changed');
    return localChanged;
  })().finally(() => { running = null; });
  return running;
}

export async function enableSync(code) {
  localStorage.setItem(KEY, normalizeCode(code));
  return syncNow();
}
export function disableSync() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LAST);
}

export function initSync() {
  if (!syncAvailable()) return;
  const push = debounce(() => { syncNow().catch(() => {}); }, 2500);
  onDataChange(() => { if (syncCode()) push(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && syncCode()) syncNow().catch(() => {});
  });
  if (syncCode()) syncNow().catch(() => {});
}

// QR-Code-Bibliothek erst bei Bedarf laden.
let qrLib = null;
export function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!qrLib) {
    qrLib = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
      s.onload = () => resolve(window.qrcode);
      s.onerror = () => reject(new Error('QR-Code konnte nicht geladen werden'));
      document.head.appendChild(s);
    });
  }
  return qrLib;
}
export async function qrSvg(text) {
  const qrcode = await loadQr();
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}
