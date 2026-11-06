// Kleine, DOM-freie Hilfsfunktionen (auch in den Tests nutzbar).
import { t, num, money, LOCALE } from './i18n.js';

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export const dist = (a, b) => haversine(a.lat, a.lon, b.lat, b.lon);

export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function fmtDist(m) {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${num(m / 1000, m < 10000 ? 1 : 0)} km`;
}
export function fmtKm(m, digits = 1) { return num(m / 1000, digits); }
export function fmtDuration(seconds) {
  if (seconds < 60) return t('< 1 Min');
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (!h) return t('{min} Min', { min });
  return min ? t('{h} h {min} Min', { h, min }) : `${h} h`;
}
export function fmtEuro(v) { return money(v, 'EUR'); }
export function fmtClock(date) {
  return date.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}
export function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('gerade eben');
  if (min < 60) return t('vor {n} Min', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('vor {n} Std', { n: h });
  const days = Math.floor(h / 24);
  if (days === 1) return t('gestern');
  if (days < 30) return t('vor {n} Tagen', { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? t('vor 1 Monat') : t('vor {n} Monaten', { n: months });
  const years = Math.floor(months / 12);
  return years === 1 ? t('vor 1 Jahr') : t('vor {n} Jahren', { n: years });
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
export function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
export function stdDev(arr) {
  const m = mean(arr);
  return Math.sqrt(mean(arr.map(v => (v - m) ** 2)));
}

// Einfacher, reproduzierbarer Zufallsgenerator (für "Andere Route" mit Seed).
export function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// fetch mit Timeout (AbortSignal.timeout ist nicht überall vorhanden).
export async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const outer = opts.signal;
  if (outer) outer.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
