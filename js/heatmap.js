// Preis-Heatmap: färbt die Karte nach dem Bierpreis der Lokale in der Nähe
// (grün = günstig, rot = teuer). Inverse-Distanz-Gewichtung auf einem groben
// Raster, ausgeblendet, wo keine Preise in der Nähe liegen. Ohne Bibliothek.
/* global L */
import { getMap } from './map.js';

const RADIUS = 900;       // m: so weit reicht ein Preis
const CELL = 14;          // px pro Rasterzelle

let layer = null;
let points = [];          // [{ lat, lon, v }]
let range = null;         // { lo, hi }

export function priceColor(f) {
  // 0 = günstig (grün) … 0,5 = gelb … 1 = teuer (rot)
  const stops = [[46, 160, 80], [242, 180, 40], [214, 64, 40]];
  const t = Math.max(0, Math.min(1, f)) * 2;
  const i = Math.min(1, Math.floor(t));
  const k = t - i;
  return stops[i].map((c, j) => Math.round(c + (stops[i + 1][j] - c) * k));
}

// Wert an einem Punkt: IDW-Mittel der Preise im Umkreis + Deckkraft nach Nähe.
export function sampleAt(lat, lon, pts, radius = RADIUS) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180);
  let ws = 0, vs = 0, dmin = Infinity;
  for (const p of pts) {
    const dx = (p.lon - lon) * kx, dy = (p.lat - lat) * 111320;
    const d2 = dx * dx + dy * dy;
    if (d2 > radius * radius) continue;
    const w = 1 / (d2 + 120 * 120);
    ws += w; vs += w * p.v;
    if (d2 < dmin) dmin = d2;
  }
  if (!ws) return null;
  return { v: vs / ws, near: 1 - Math.sqrt(dmin) / radius };
}

const HeatLayer = typeof L === 'undefined' ? null : L.Layer.extend({
  onAdd(map) {
    this._canvas = L.DomUtil.create('canvas', 'heat-canvas');
    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on('moveend zoomend resize', this._draw, this);
    this._draw();
  },
  onRemove(map) {
    map.off('moveend zoomend resize', this._draw, this);
    this._canvas.remove();
  },
  _draw() {
    const map = this._map;
    if (!map) return;
    const size = map.getSize();
    const c = this._canvas;
    c.width = size.x; c.height = size.y;
    c.style.width = `${size.x}px`; c.style.height = `${size.y}px`;
    L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, size.x, size.y);
    if (!points.length || !range) return;
    const span = range.hi - range.lo;
    for (let y = 0; y < size.y; y += CELL) {
      for (let x = 0; x < size.x; x += CELL) {
        const ll = map.containerPointToLatLng([x + CELL / 2, y + CELL / 2]);
        const s = sampleAt(ll.lat, ll.lng, points);
        if (!s) continue;
        const [r, g, b] = priceColor((s.v - range.lo) / span);
        ctx.fillStyle = `rgba(${r},${g},${b},${(0.12 + 0.43 * s.near).toFixed(3)})`;
        ctx.fillRect(x, y, CELL, CELL);
      }
    }
  },
});

// pts: [{ lat, lon, v (Preis/0,5 l) }] → { lo, hi, n } oder null (zu wenige Daten)
export function showHeatmap(pts) {
  points = pts;
  const vals = pts.map(p => p.v).sort((a, b) => a - b);
  if (vals.length < 2) { hideHeatmap(); return null; }
  const q = f => vals[Math.min(vals.length - 1, Math.max(0, Math.round(f * (vals.length - 1))))];
  // Mindestens 1 € Spanne: sonst sähen 10 Cent Unterschied wie "billig vs. teuer" aus.
  const lo = q(0.1);
  range = { lo, hi: Math.max(q(0.9), lo + 1) };
  const map = getMap();
  if (!layer) layer = new HeatLayer();
  if (!map.hasLayer(layer)) layer.addTo(map); else layer._draw();
  return { ...range, n: vals.length };
}
export function hideHeatmap() {
  const map = getMap();
  if (layer && map.hasLayer(layer)) map.removeLayer(layer);
}
