// Teilen per Link: Orte (#ort=node/123) und Touren (#tour=…) im URL-Hash.

const r5 = v => Math.round(v * 1e5) / 1e5;

export function encodeTour({ start, end, stopIds, style, km, dwell }) {
  const parts = [
    `${r5(start.lat)},${r5(start.lon)}`,
    end ? `${r5(end.lat)},${r5(end.lon)}` : 'R',
    stopIds.join(','),
    style || 'trekking',
    km || '',
    dwell || '',
  ];
  return parts.join(';');
}

export function decodeTour(str) {
  const [s, e, ids, style, km, dwell] = decodeURIComponent(str).split(';');
  const ll = v => { const [lat, lon] = v.split(',').map(Number); return isFinite(lat) && isFinite(lon) ? { lat, lon } : null; };
  const start = ll(s || '');
  const stopIds = (ids || '').split(',').filter(x => /^(node|way|relation)\/\d+$/.test(x));
  if (!start || !stopIds.length) return null;
  return {
    start,
    end: e && e !== 'R' ? ll(e) : null,
    stopIds,
    style: style || 'trekking',
    km: km ? Number(km) : null,
    dwell: dwell ? Number(dwell) : null,
  };
}

export function placeLink(placeId) {
  return `${location.origin}${location.pathname}#ort=${placeId}`;
}
export function tourLink(tour) {
  return `${location.origin}${location.pathname}#tour=${encodeURIComponent(encodeTour(tour))}`;
}

export function readHash() {
  const h = location.hash.slice(1);
  if (h.startsWith('ort=')) return { kind: 'place', id: decodeURIComponent(h.slice(4)) };
  if (h.startsWith('tour=')) { const t = decodeTour(h.slice(5)); return t ? { kind: 'tour', tour: t } : null; }
  if (h.startsWith('sync=')) return { kind: 'sync', code: decodeURIComponent(h.slice(5)) };
  if (h.startsWith('gruppe=')) return { kind: 'group', code: decodeURIComponent(h.slice(7)).replace(/[^A-Za-z0-9]/g, '') };
  if (h === 'alarme') return { kind: 'alerts' };
  if (h === 'tagebuch') return { kind: 'diary' };
  return null;
}
export function clearHash() {
  history.replaceState(null, '', location.pathname + location.search);
}

// Natives Teilen (Handy) oder Link kopieren. → 'shared' | 'copied' | 'failed'
export async function shareLink({ title, text, url }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(url); return 'copied'; }
  catch (e) { return 'failed'; }
}
