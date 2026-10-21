// Abzeichen: neue freischalten (mit Toast & Konfetti) und als Raster anzeigen.
import { evaluateBadges } from '../badges.js';
import { loadDiary, loadTours, loadStats } from '../store.js';
import { on, emit } from '../state.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../util.js';
import { toast, confetti } from './dom.js';

const SEEN = 'bl_badges_seen_v1';

export function badgeList() {
  return evaluateBadges({ diary: loadDiary(), tours: loadTours(), stats: loadStats() });
}

export function checkBadges() {
  const list = badgeList();
  const unlocked = list.filter(b => b.unlocked).map(b => b.id);
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(SEEN)); } catch (e) { seen = null; }
  localStorage.setItem(SEEN, JSON.stringify(unlocked));
  if (!Array.isArray(seen)) return; // erster Start: nichts nachträglich feiern
  const fresh = list.filter(b => b.unlocked && !seen.includes(b.id));
  if (!fresh.length) return;
  confetti();
  toast(`Abzeichen freigeschaltet: <b>${escapeHtml(fresh[0].title)}</b>${fresh.length > 1 ? ` (+${fresh.length - 1})` : ''}`, {
    tone: 'good', ms: 6000, action: { label: 'Ansehen', run: () => emit('open-diary', 'badges') },
  });
}

export function initBadges() {
  ['diary-added', 'tour-saved', 'price-reported', 'bingo'].forEach(ev => on(ev, () => setTimeout(checkBadges, 300)));
  checkBadges();
}

export function badgesHtml() {
  // Freigeschaltete zuerst, dann die, bei denen am wenigsten fehlt.
  const list = badgeList().sort((a, b) => (b.unlocked - a.unlocked) || (b.pct - a.pct));
  const n = list.filter(b => b.unlocked).length;
  return `
    <div class="badge-head"><b>${n}</b> von ${list.length} Abzeichen</div>
    <div class="badge-grid">${list.map(b => `
      <div class="badge${b.unlocked ? ' on' : ''}" title="${escapeHtml(b.desc)}">
        <span class="badge-ico">${icon(b.unlocked ? b.icon : 'trophy', { size: 22 })}</span>
        <b>${escapeHtml(b.title)}</b>
        <small>${escapeHtml(b.desc)}</small>
        ${b.unlocked ? '' : `<span class="badge-prog"><i style="width:${Math.round(b.pct * 100)}%"></i></span><small class="badge-num">${Math.min(b.value, b.goal)} / ${b.goal}</small>`}
      </div>`).join('')}</div>
    <p class="fine">Abzeichen kommen aus deinem Tagebuch, gefahrenen Touren, gemeldeten Preisen und Bingo. In deiner Runde sieht man, wie viele du hast.</p>`;
}
