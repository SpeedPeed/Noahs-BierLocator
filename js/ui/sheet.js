// Bottom-Sheet fürs Handy (wie bei Karten-Apps): drei Stufen, mit Wischgeste.
// Ab 900 px Breite ist es eine feste Seitenleiste.
import { $ } from './dom.js';

const PEEK = 172; // sichtbare Höhe im eingeklappten Zustand

let sheet, grab, body, mq;
let state = 'half';
let listeners = [];

const isMobile = () => mq.matches;
const vh = () => window.innerHeight;
const topLimit = () => {
  const bar = $('.topbar');
  return bar ? bar.getBoundingClientRect().bottom + 10 : 80;
};
function heightFor(s) {
  if (s === 'full') return vh() - topLimit();
  if (s === 'half') return Math.round(vh() * 0.48);
  return PEEK;
}
function apply(s, animate = true) {
  state = s;
  if (!isMobile()) { document.documentElement.style.removeProperty('--sheet-h'); sheet.dataset.state = 'desktop'; return; }
  sheet.classList.toggle('no-anim', !animate);
  document.documentElement.style.setProperty('--sheet-h', `${heightFor(s)}px`);
  sheet.dataset.state = s;
  listeners.forEach(fn => fn(s));
}

export function initSheet() {
  sheet = $('#sheet');
  grab = $('#sheetGrab');
  body = $('#sheetBody');
  mq = matchMedia('(max-width: 899px)');
  mq.addEventListener('change', () => apply(state, false));
  window.addEventListener('resize', () => apply(state, false));

  let startY = 0, startH = 0, lastY = 0, lastT = 0, vel = 0, dragging = false, moved = false;
  grab.addEventListener('pointerdown', e => {
    if (!isMobile() || e.target.closest('button, input, select, a')) return;
    dragging = true; moved = false;
    startY = lastY = e.clientY; lastT = performance.now(); vel = 0;
    startH = sheet.getBoundingClientRect().height;
    sheet.classList.add('no-anim');
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 4) moved = true;
    const now = performance.now();
    vel = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY; lastT = now;
    const h = Math.max(PEEK - 40, Math.min(vh() - topLimit(), startH - dy));
    document.documentElement.style.setProperty('--sheet-h', `${h}px`);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('no-anim');
    if (!moved) { // Tippen auf den Griff: umschalten
      apply(state === 'peek' ? 'half' : state === 'half' ? 'full' : 'half');
      return;
    }
    const h = sheet.getBoundingClientRect().height;
    const order = ['peek', 'half', 'full'];
    let target;
    if (vel < -0.5) target = order[Math.min(2, order.indexOf(nearest(h)) + 1)];
    else if (vel > 0.5) target = order[Math.max(0, order.indexOf(nearest(h)) - 1)];
    else target = nearest(h);
    apply(target);
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);

  // Scrollt man im voll ausgeklappten Inhalt ganz oben weiter nach unten → einklappen.
  let touchStartY = null;
  body.addEventListener('touchstart', e => { touchStartY = body.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  body.addEventListener('touchmove', e => {
    if (touchStartY == null || state !== 'full') return;
    if (e.touches[0].clientY - touchStartY > 70) { touchStartY = null; apply('half'); }
  }, { passive: true });

  apply('half', false);
}

function nearest(h) {
  return ['peek', 'half', 'full'].reduce((best, s) => (Math.abs(heightFor(s) - h) < Math.abs(heightFor(best) - h) ? s : best), 'peek');
}

export function setSheet(s) { apply(s); }
export function getSheet() { return state; }
export function onSheetChange(fn) { listeners.push(fn); }

// Wie viel der Karte das Sheet verdeckt (für Karten-Padding).
export function sheetOcclusion() {
  if (!sheet) return { bottom: 0, left: 0 };
  if (!isMobile()) return { bottom: 0, left: sheet.getBoundingClientRect().right };
  return { bottom: Math.min(heightFor(state), vh() * 0.6), left: 0 };
}
export const mobile = () => isMobile();
