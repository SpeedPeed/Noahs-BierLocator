// Preisalarme: "Sag mir, wenn ein Kasten Zipfer unter 16 € kostet."
// Die gleiche Logik steckt in scripts/send_alerts.py (Push-Versand per GitHub-Job).

export const KINDS = {
  any: 'egal',
  single: 'Flasche/Dose',
  pack: 'Sixpack/Tray',
  crate: 'Kiste',
};

function kindOf(p) {
  if (p.unit && p.unit.startsWith('kasten')) return 'crate';
  if (p.unit !== 'other') return 'single';
  const v = p.volume_l || 0;
  return v >= 6 ? 'crate' : v >= 1.5 ? 'pack' : 'single';
}

export function isActive(p, today = new Date().toISOString().slice(0, 10)) {
  return (!p.valid_until || p.valid_until >= today) && (!p.valid_from || p.valid_from <= today);
}

export function matches(watch, p) {
  if (watch.country && p.country !== watch.country) return false;
  if (watch.kind && watch.kind !== 'any' && kindOf(p) !== watch.kind) return false;
  if (watch.max && p.price > watch.max) return false;
  const hay = `${p.beer} ${p.package || ''}`.toLowerCase();
  return watch.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

// → [{ watch, hits: [preis, …] }] — Treffer nach Preis sortiert
export function evaluate(watches, prices) {
  return watches.map(w => ({
    watch: w,
    hits: prices.filter(p => isActive(p) && matches(w, p)).sort((a, b) => a.price - b.price),
  }));
}

export const hitKey = p => `${p.country}|${p.chain}|${p.beer}|${p.package}|${p.price}`;
