// Tourplaner (DOM-frei, getestet in tests/).
//
// Problem der alten Planung: Stopps wurden pro Himmelsrichtung "irgendwo" gewählt
// und anschließend gegen nähere getauscht — dadurch klumpten sie (3 Orte auf einem
// Fleck, dann eine lange Leerfahrt).
//
// Neuer Ansatz — "Form zuerst, Orte danach":
//   1. Eine ideale Tourform erzeugen: Kreis/Ellipse durch den Start (Rundtour) oder
//      einen Bogen vom Start zum Ziel. Auf ihr liegen k Ankerpunkte in exakt
//      gleichen Abständen.
//   2. Jedem Anker den passendsten Bierort in seiner Nähe zuordnen (global greedy,
//      mit Mindestabstand zwischen den Stopps → kein Klumpen).
//   3. Hunderte Varianten (Drehung, Form, Größe) rein geometrisch bewerten:
//      Gleichmäßigkeit der Etappen, Längenfehler, Kreuzungen, Spitzkehren,
//      Ortsqualität, Öffnung zur geschätzten Ankunftszeit.
//   4. Nur die besten Kandidaten werden tatsächlich geroutet (siehe tourPlan.js);
//      der gemessene Umwegfaktor kalibriert die nächste Runde.

import { haversine, mean, stdDev, clamp } from '../util.js';

const M_PER_DEG_LAT = 111320;

export function makeProjection(origin) {
  const kx = M_PER_DEG_LAT * Math.cos(origin.lat * Math.PI / 180);
  return {
    toXY: p => ({ x: (p.lon - origin.lon) * kx, y: (p.lat - origin.lat) * M_PER_DEG_LAT }),
    toLL: (x, y) => ({ lat: origin.lat + y / M_PER_DEG_LAT, lon: origin.lon + x / kx }),
  };
}

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---------- Formen ---------- */

// Ellipse durch den Ursprung. θ = Richtung (Bogenmaß, 0 = Nord, im Uhrzeigersinn)
// vom Start zur Ellipsenmitte, A = Halbachse in diese Richtung, B = quer dazu.
function loopCurve(theta, A, B, n = 240) {
  const u = { x: Math.sin(theta), y: Math.cos(theta) };
  const v = { x: Math.cos(theta), y: -Math.sin(theta) };
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const phi = (i / n) * 2 * Math.PI;
    const a = A - A * Math.cos(phi), b = B * Math.sin(phi);
    pts.push({ x: u.x * a + v.x * b, y: u.y * a + v.y * b });
  }
  return pts;
}

// Quadratische Bézierkurve von O nach E mit seitlicher Ausbuchtung h (Meter, Vorzeichen = Seite)
// und Verschiebung der Spitze entlang der Achse (skew, -0.5..0.5).
function arcCurve(E, h, skew = 0, n = 200) {
  const len = Math.hypot(E.x, E.y) || 1;
  const nx = -E.y / len, ny = E.x / len;
  const t = 0.5 + skew;
  const C = { x: E.x * t + nx * 2 * h, y: E.y * t + ny * 2 * h };
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, a = (1 - s) * (1 - s), b = 2 * (1 - s) * s, c = s * s;
    pts.push({ x: b * C.x + c * E.x, y: b * C.y + c * E.y });
  }
  return pts;
}

// k Anker in gleichen Bogenlängen-Abständen (ohne Start/Ende). `shift` verschiebt
// alle Anker gemeinsam entlang der Kurve (Bruchteil eines Abstands) — liefert bei
// A→B-Touren andere, gleich gleichmäßige Kandidaten.
function anchorsOnCurve(pts, k, shift = 0) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + d2(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const anchors = [];
  let j = 1;
  for (let i = 1; i <= k; i++) {
    const target = (total * clamp(i + shift, 0.35, k + 0.65)) / (k + 1);
    while (j < cum.length - 1 && cum[j] < target) j++;
    const seg = cum[j] - cum[j - 1] || 1;
    const f = (target - cum[j - 1]) / seg;
    anchors.push({
      x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * f,
      y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * f,
      arc: target,
    });
  }
  return { anchors, total, spacing: total / (k + 1) };
}

function chordLength(points) {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += d2(points[i - 1], points[i]);
  return s;
}

/* ---------- Geometrie-Bewertung ---------- */

function segmentsCross(p1, p2, p3, p4) {
  const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return o(p1, p2, p3) !== o(p1, p2, p4) && o(p3, p4, p1) !== o(p3, p4, p2)
    && o(p1, p2, p3) !== 0 && o(p3, p4, p1) !== 0;
}
function countCrossings(pts) {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 2; j < pts.length - 1; j++) {
      if (i === 0 && j === pts.length - 2 && d2(pts[0], pts[pts.length - 1]) < 1) continue; // Rundtour: erste & letzte Etappe teilen den Start
      if (segmentsCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) n++;
    }
  }
  return n;
}
// Spitzkehren: Richtungswechsel > 145° an einem Stopp (hin & gleich wieder zurück).
function countSpikes(pts) {
  let n = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i].x - pts[i - 1].x, ay = pts[i].y - pts[i - 1].y;
    const bx = pts[i + 1].x - pts[i].x, by = pts[i + 1].y - pts[i].y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (!la || !lb) continue;
    const cos = (ax * bx + ay * by) / (la * lb);
    if (cos < Math.cos(145 * Math.PI / 180)) n++;
  }
  return n;
}

export function legStats(legs) {
  const m = mean(legs);
  return { cv: m ? stdDev(legs) / m : 0, minRatio: m ? Math.min(...legs) / m : 0, maxRatio: m ? Math.max(...legs) / m : 0 };
}

/* ---------- Räumlicher Index ---------- */
function buildGrid(items, cell) {
  const grid = new Map();
  for (const it of items) {
    const key = `${Math.floor(it.x / cell)},${Math.floor(it.y / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(it);
  }
  return {
    near(p, radius) {
      const out = [];
      const r = Math.ceil(radius / cell);
      const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const list = grid.get(`${cx + dx},${cy + dy}`);
          if (list) for (const it of list) if (d2(it, p) <= radius) out.push(it);
        }
      }
      return out;
    },
  };
}

/* ---------- Zuordnung Anker → Orte ---------- */
function assignStops(anchors, spacing, grid, ctx) {
  const { startXY, endXY, quality, openPenalty, minGap } = ctx;
  const pairs = [];
  const tryRadius = (i, radius, extra) => {
    for (const c of grid.near(anchors[i], radius)) {
      if (d2(c, startXY) < spacing * 0.3 || d2(c, endXY) < spacing * 0.3) continue; // nicht direkt am Start/Ziel
      const pen = openPenalty(c, i);
      if (pen === Infinity) continue;
      const cost = d2(c, anchors[i]) / spacing + (1 - quality(c)) * 0.35 + pen + extra;
      pairs.push({ i, c, cost });
    }
  };
  anchors.forEach((_, i) => tryRadius(i, spacing * 0.5, 0));
  pairs.sort((a, b) => a.cost - b.cost);

  const chosen = new Array(anchors.length).fill(null);
  const used = new Set();
  const place = list => {
    for (const { i, c } of list) {
      if (chosen[i] || used.has(c.id)) continue;
      if (chosen.some(s => s && d2(s, c) < minGap)) continue; // Anti-Klumpen
      chosen[i] = c; used.add(c.id);
    }
  };
  place(pairs);

  // Lücken mit erweitertem Suchradius (teurer) füllen.
  if (chosen.some(s => !s)) {
    const more = [];
    const before = pairs.length;
    chosen.forEach((s, i) => { if (!s) tryRadius(i, spacing * ctx.fillRadius, 0.6); });
    more.push(...pairs.slice(before));
    more.sort((a, b) => a.cost - b.cost);
    place(more);
  }
  return chosen;
}

/* ---------- Variantensuche ---------- */

// Erzeugt und bewertet geometrische Tour-Varianten. Rückgabe: nach Score sortiert,
// ohne doppelte Stopp-Mengen. Jede Variante: { stops, anchors (lat/lon), spacing,
// geomLen, estLen, score, metrics, shape }.
export function generateVariants(pool, start, end, opts) {
  const {
    targetM, k, detour = 1.3, roundtrip = !end,
    detourAt = null,           // (a, b) → lokaler Umwegfaktor für die Etappe a→b (gelernt aus echten Routen)
    quality = () => 0.7,
    isOpenAt = null,           // (place, Date) → true | false | null
    startTime = new Date(), speedMps = 4.2, dwellSec = 30 * 60,
    maxVariants = 40,
  } = opts;
  const proj = makeProjection(start);
  const startXY = { x: 0, y: 0 };
  const endXY = roundtrip ? startXY : proj.toXY(end);
  const items = pool.map(p => ({ ...proj.toXY(p), id: p.id, place: p }));
  const qualityXY = it => quality(it.place);

  const shapes = [];
  if (roundtrip) {
    const forms = [
      { name: 'Kreis', a: 1, b: 1 },
      { name: 'Oval längs', a: 1.45, b: 0.8 },
      { name: 'Oval quer', a: 0.75, b: 1.3 },
    ];
    for (let deg = 0; deg < 360; deg += 15) {
      for (const f of forms) {
        const unit = loopCurve(deg * Math.PI / 180, f.a, f.b);
        const { anchors } = anchorsOnCurve(unit, k);
        const unitChord = chordLength([startXY, ...anchors, startXY]);
        const baseScale = targetM / (detour * unitChord);
        for (const s of [0.76, 0.88, 1, 1.12]) {
          const scale = baseScale * s;
          shapes.push({ key: `${f.name}-${deg}-${s}`, name: f.name, pts: unit.map(p => ({ x: p.x * scale, y: p.y * scale })) });
        }
      }
    }
  } else {
    const direct = Math.hypot(endXY.x, endXY.y);
    // Ausbuchtung h so wählen, dass Sehnen × Umweg ≈ Wunschlänge.
    const solveH = (skew, side, target) => {
      const lenFor = h => chordLength([startXY, ...anchorsOnCurve(arcCurve(endXY, h * side, skew), k).anchors, endXY]) * detour;
      if (lenFor(0) >= target) return 0;
      let lo = 0, hi = Math.max(direct, 500);
      while (lenFor(hi) < target && hi < direct * 20 + 50000) hi *= 1.6;
      for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (lenFor(mid) < target) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    };
    for (const side of [1, -1]) {
      for (const skew of [-0.3, -0.15, 0, 0.15, 0.3]) {
        for (const s of [0.8, 0.9, 1, 1.1, 1.2]) {
          const h = solveH(skew, side, targetM * s);
          for (const shift of [-0.25, 0, 0.25]) {
            shapes.push({ key: `Bogen-${side}-${skew}-${s}-${shift}`, name: h ? 'Bogen' : 'Direkt', pts: arcCurve(endXY, h * side, skew), shift });
          }
          if (!h) break; // ohne Ausbuchtung sind alle Skalierungen gleich
        }
      }
    }
  }

  const maxReach = Math.max(...shapes.map(s => Math.max(...s.pts.map(p => Math.hypot(p.x, p.y)))));
  const cellSize = clamp(maxReach / 20, 150, 1500);
  const grid = buildGrid(items, cellSize);

  const variants = [];
  const seen = new Set();
  // Erst streng (Stopps nah an ihren Ankern, großer Mindestabstand); findet das in
  // dünn besiedelten Gegenden nichts, ein zweiter, toleranterer Durchlauf.
  const passes = [
    { fillRadius: 0.85, minGap: 0.4, relaxed: false },
    { fillRadius: 1.4, minGap: 0.22, relaxed: true },
  ];
  for (const pass of passes) {
    if (variants.length) break;
    for (const shape of shapes) {
      evaluateShape(shape, pass);
    }
  }

  function evaluateShape(shape, pass) {
    const { anchors, total, spacing } = anchorsOnCurve(shape.pts, k, shape.shift || 0);
    const etaFor = i => new Date(startTime.getTime() + ((anchors[i].arc * 1.12) / speedMps + i * dwellSec) * 1000);
    const openPenalty = isOpenAt
      ? (c, i) => { const o = isOpenAt(c.place, etaFor(i)); return o === false ? Infinity : o === null ? 0.12 : 0; }
      : () => 0;
    const chosen = assignStops(anchors, spacing, grid, {
      startXY, endXY, quality: qualityXY, openPenalty, minGap: spacing * pass.minGap, fillRadius: pass.fillRadius,
    });
    if (chosen.some(s => !s)) return;

    const key = chosen.map(c => c.id).join('|');
    if (seen.has(key)) return;
    seen.add(key);

    const pts = [startXY, ...chosen, endXY];
    const legs = [];
    for (let i = 1; i < pts.length; i++) legs.push(d2(pts[i - 1], pts[i]));
    const geomLen = legs.reduce((a, b) => a + b, 0);
    let estLen = geomLen * detour;
    if (detourAt) {
      const ll = [start, ...chosen.map(c => c.place), roundtrip ? start : end];
      estLen = legs.reduce((sum, l, i) => sum + l * detourAt(ll[i], ll[i + 1]), 0);
    }
    const lenErr = Math.abs(estLen - targetM) / targetM;
    const { cv, minRatio } = legStats(legs);
    const crossings = countCrossings(pts);
    const spikes = countSpikes(pts);
    const q = mean(chosen.map(qualityXY));
    const dev = mean(chosen.map((c, i) => d2(c, anchors[i]) / spacing));
    const unknownOpen = isOpenAt ? chosen.filter((c, i) => isOpenAt(c.place, etaFor(i)) === null).length / k : 0;

    const score = 2.6 * lenErr
      + 1.6 * cv
      + 3.0 * Math.max(0, 0.5 - minRatio)
      + 0.9 * crossings
      + 0.45 * spikes
      + 0.7 * (1 - q)
      + 0.4 * dev
      + 0.25 * unknownOpen;

    variants.push({
      stops: chosen.map(c => c.place),
      anchors: anchors.map(a => proj.toLL(a.x, a.y)),
      spacing, curveLen: total, geomLen, estLen, score, shape: shape.name, key, relaxed: pass.relaxed,
      metrics: { lenErr, cv, minRatio, crossings, spikes, quality: q, dev },
    });
  }
  variants.sort((a, b) => a.score - b.score);
  return variants.slice(0, maxVariants);
}

// Alternative Orte für einen bestehenden Stopp (für "Stopp tauschen").
export function alternativesForStop(pool, variant, index, usedIds, quality = () => 0.7) {
  const anchor = variant.anchors[index];
  const radius = variant.spacing * 0.9;
  return pool
    .filter(p => !usedIds.has(p.id))
    .map(p => ({ p, d: haversine(anchor.lat, anchor.lon, p.lat, p.lon) }))
    .filter(x => x.d <= radius)
    .sort((a, b) => (a.d / variant.spacing + (1 - quality(a.p)) * 0.35) - (b.d / variant.spacing + (1 - quality(b.p)) * 0.35))
    .map(x => x.p);
}

/* ---------- Bewertung echter Routen ---------- */

// Anteil der Strecke, der bereits zuvor gefahren wurde (Hin-und-zurück auf derselben
// Straße). 0 = jede Straße nur einmal, 0.3 = 30 % doppelt.
export function overlapRatio(latlngs) {
  if (latlngs.length < 2) return 0;
  const step = 15, cell = 22, gapSamples = 30;
  const samples = [];
  for (let i = 1; i < latlngs.length; i++) {
    const [la1, lo1] = latlngs[i - 1], [la2, lo2] = latlngs[i];
    const segLen = haversine(la1, lo1, la2, lo2);
    const n = Math.max(1, Math.round(segLen / step));
    for (let j = 0; j < n; j++) samples.push([la1 + (la2 - la1) * j / n, lo1 + (lo2 - lo1) * j / n]);
  }
  const proj = makeProjection({ lat: latlngs[0][0], lon: latlngs[0][1] });
  const seen = new Map();
  let reused = 0;
  samples.forEach(([lat, lon], idx) => {
    const { x, y } = proj.toXY({ lat, lon });
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        const prev = seen.get(`${cx + dx},${cy + dy}`);
        if (prev !== undefined && idx - prev > gapSamples) hit = true;
      }
    }
    if (hit) reused++;
    const key = `${cx},${cy}`;
    if (!seen.has(key)) seen.set(key, idx);
  });
  return reused / samples.length;
}

// Für jeden Wegpunkt den nächstgelegenen Track-Punkt (in Reihenfolge).
export function matchTrackIndices(trackLatLngs, waypoints) {
  let searchStart = 0;
  return waypoints.map((wp, wi) => {
    if (wi === waypoints.length - 1) {
      // Ende: ab dem vorigen Treffer suchen, aber bevorzugt hinten (Rundtour endet am Start).
      let bestIdx = trackLatLngs.length - 1, bestDist = Infinity;
      for (let i = trackLatLngs.length - 1; i >= searchStart; i--) {
        const d = haversine(wp.lat, wp.lon, trackLatLngs[i][0], trackLatLngs[i][1]);
        if (d < bestDist - 1) { bestDist = d; bestIdx = i; }
        if (d < 15) break;
      }
      return bestIdx;
    }
    let bestIdx = searchStart, bestDist = Infinity;
    for (let i = searchStart; i < trackLatLngs.length; i++) {
      const d = haversine(wp.lat, wp.lon, trackLatLngs[i][0], trackLatLngs[i][1]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    searchStart = bestIdx;
    return bestIdx;
  });
}

// Score einer tatsächlich gerouteten Variante (kleiner = besser).
export function routedScore(route, targetM, quality) {
  const lenErr = Math.abs(route.distance - targetM) / targetM;
  const { cv, minRatio } = legStats(route.legs.map(l => l.distance));
  return 3 * lenErr + 1.3 * cv + 2.5 * Math.max(0, 0.45 - minRatio) + 2.2 * (route.overlap || 0) + 0.6 * (1 - quality);
}
