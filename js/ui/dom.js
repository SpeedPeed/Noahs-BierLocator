// DOM-Helfer: Toast, Dialoge, animierte Zahlen, Lade-Animation.
import { icon } from '../icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let toastTimer;
// Als "Popover" liegt der Toast auch über offenen Dialogen (Top Layer).
function toastLayer(el, show) {
  if (!el.showPopover) return;
  try {
    if (el.matches(':popover-open')) el.hidePopover();
    if (show) el.showPopover();
  } catch (e) { /* ältere Browser: normaler Toast */ }
}
export function toast(msg, { tone = 'info', ms = 2800, action = null } = {}) {
  const el = $('#toast');
  const ic = tone === 'good' ? 'checkCircle' : tone === 'bad' ? 'alertTriangle' : 'info';
  el.className = `toast toast-${tone}`;
  el.innerHTML = `${icon(ic, { size: 17 })}<span>${msg}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = () => { action.run(); el.hidden = true; toastLayer(el, false); };
    el.appendChild(b);
  }
  el.hidden = false;
  toastLayer(el, true);
  el.classList.remove('toast-in');
  void el.offsetWidth;
  el.classList.add('toast-in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; toastLayer(el, false); }, action ? ms + 2500 : ms);
}

/* ---------- Dialoge (natives <dialog>, mit Ein-/Ausblend-Animation) ---------- */
export function openDialog(dlg) {
  if (dlg.open) return;
  dlg.classList.remove('closing');
  dlg.showModal();
  dlg.scrollTop = 0;
}
export function closeDialog(dlg) {
  if (!dlg.open || dlg.classList.contains('closing')) return;
  if (reducedMotion()) { dlg.close(); return; }
  dlg.classList.add('closing');
  setTimeout(() => { dlg.classList.remove('closing'); dlg.close(); }, 180);
}
export function wireDialog(dlg, onClose) {
  dlg.addEventListener('click', e => {
    if (e.target === dlg || e.target.closest('[data-close]')) closeDialog(dlg);
  });
  dlg.addEventListener('cancel', e => { e.preventDefault(); closeDialog(dlg); });
  if (onClose) dlg.addEventListener('close', onClose);
}

// Allzweck-Dialog für kleinere Ansichten (Überraschung, Bingo, Heimweg, Tour-Ende …).
export function openMisc(html, { wide = false } = {}) {
  const dlg = $('#miscDialog');
  dlg.classList.toggle('dlg-wide', wide);
  $('#miscBody').innerHTML = html;
  openDialog(dlg);
  return $('#miscBody');
}
export const miscOpen = () => $('#miscDialog').open;
export const closeMisc = () => closeDialog($('#miscDialog'));

// Kleines Konfetti (für Bingo & Abzeichen) — respektiert "weniger Bewegung".
export function confetti(n = 40) {
  if (reducedMotion()) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#f2a01c', '#3e9a52', '#c43d25', '#2f7fc1', '#fde9c2'];
  box.innerHTML = Array.from({ length: n }, (_, i) => `<i style="--x:${Math.random() * 100}vw;--d:${(Math.random() * 0.6).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--c:${colors[i % colors.length]}"></i>`).join('');
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2600);
}

/* ---------- Animierte Zahl ---------- */
export function animateNumber(el, to, { decimals = 0, suffix = '', duration = 700 } = {}) {
  const from = parseFloat((el.dataset.value || '0')) || 0;
  el.dataset.value = String(to);
  const fmt = v => v.toFixed(decimals).replace('.', ',') + suffix;
  if (reducedMotion() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Bierglas, das sich füllt — als Lade-Animation.
export function beerLoader(text = 'Lädt…') {
  return `<div class="beer-loader" role="status">
    <svg viewBox="0 0 40 48" width="44" height="52" aria-hidden="true">
      <defs><clipPath id="blClip"><path d="M8 8h22l-2.4 33a3 3 0 0 1-3 2.8H13.4a3 3 0 0 1-3-2.8z"/></clipPath></defs>
      <g clip-path="url(#blClip)">
        <rect class="bl-fill" x="0" y="0" width="40" height="48"/>
        <rect class="bl-foam" x="0" y="0" width="40" height="6"/>
        <circle class="bl-bub" cx="15" cy="40" r="1.3"/><circle class="bl-bub b2" cx="22" cy="42" r="1"/><circle class="bl-bub b3" cx="19" cy="38" r="0.9"/>
      </g>
      <path d="M8 8h22l-2.4 33a3 3 0 0 1-3 2.8H13.4a3 3 0 0 1-3-2.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <path d="M30 14h3.2a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H29" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <span>${text}</span>
  </div>`;
}

export function skeletonCards(n = 5) {
  return Array.from({ length: n }, (_, i) => `<div class="card skeleton" style="--i:${i}"><div class="sk sk-ico"></div><div class="sk-lines"><div class="sk sk-l1"></div><div class="sk sk-l2"></div></div></div>`).join('');
}

export function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
