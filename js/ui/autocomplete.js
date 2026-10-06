// Ortssuche mit Vorschlägen (Tastatur: ↑/↓/Enter/Esc).
import { searchPlaces } from '../geo.js';
import { debounce, escapeHtml } from '../util.js';
import { icon } from '../icons.js';

export function attachAutocomplete(input, list, { onPick, near = () => null, onClear } = {}) {
  let items = [], active = -1, seq = 0;

  const close = () => { list.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); };
  const draw = () => {
    if (!items.length) { close(); return; }
    list.innerHTML = items.map((it, i) => `<li role="option" id="${list.id}-${i}" aria-selected="${i === active}" data-i="${i}">
      ${icon(it.kind === 'city' || it.kind === 'town' || it.kind === 'village' ? 'map' : 'pin', { size: 16 })}
      <span><b>${escapeHtml(it.label)}</b>${it.sub ? `<small>${escapeHtml(it.sub)}</small>` : ''}</span></li>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
  };
  const pick = i => {
    const it = items[i];
    if (!it) return;
    input.value = it.label;
    close();
    onPick(it);
  };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { items = []; close(); return; }
    const my = ++seq;
    try {
      const res = await searchPlaces(q, near());
      if (my !== seq) return;
      items = res; active = -1; draw();
    } catch (e) { /* Suche offline → still */ }
  }, 220);

  input.addEventListener('input', () => { run(); if (!input.value && onClear) onClear(); });
  input.addEventListener('focus', () => { if (items.length && input.value.trim().length >= 2) draw(); });
  input.addEventListener('keydown', async e => {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; draw(); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; draw(); }
    else if (e.key === 'Escape') { close(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) pick(active);
      else if (items.length) pick(0);
      else if (input.value.trim().length >= 2) {
        try { items = await searchPlaces(input.value.trim(), near()); pick(0); } catch (err) { /* nichts */ }
      }
    }
  });
  list.addEventListener('pointerdown', e => {
    const li = e.target.closest('li[data-i]');
    if (li) { e.preventDefault(); pick(+li.dataset.i); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  return { close };
}
