// Steuert die Planung: geometrische Varianten erzeugen (planner.js), die besten
// davon tatsächlich routen, den gemessenen Umwegfaktor zurückfüttern und so die
// Wunschlänge treffen — bei gleichmäßigen Etappen und möglichst wenig doppelt
// gefahrener Strecke.

import { generateVariants, routedScore } from './planner.js';
import { routeThrough, RIDE_STYLES } from './routing.js';
import { mean, clamp, haversine } from '../util.js';

export const TOUR_TOLERANCE = 0.08;
const MAX_ROUTE_CALLS = 5;

function jaccard(a, b) {
  const A = new Set(a.stops.map(s => s.id)), B = new Set(b.stops.map(s => s.id));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

function weightedPick(list, rng) {
  const base = list[0].score;
  const weights = list.map(v => Math.exp(-(v.score - base) * 2.5));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

export async function planTour(opts) {
  const {
    pool, start, end = null, targetM, k, style = 'trekking',
    startTime = new Date(), dwellSec = 30 * 60, quality = () => 0.7, isOpenAt = null,
    onProgress = () => {}, avoidKeys = new Set(), reroll = false, rng = Math.random,
  } = opts;
  const roundtrip = !end;
  const endPoint = end || start;
  let detour = (RIDE_STYLES[style] || RIDE_STYLES.trekking).detour;

  onProgress({ phase: 'shape' });
  let effectiveK = k, variants = [];
  for (; effectiveK >= 1; effectiveK--) {
    variants = generateVariants(pool, start, end, { targetM, k: effectiveK, detour, roundtrip, quality, isOpenAt, startTime, dwellSec });
    if (variants.length) break;
  }
  if (!variants.length) throw new Error('In dieser Gegend lassen sich keine passenden Bierorte zu einer Tour verbinden. Mehr Ortstypen erlauben oder eine andere Länge probieren.');

  // Gibt die Gegend so viele gleichmäßig verteilte Stopps nicht her, die größte
  // Anzahl suchen, mit der es sauber klappt — als Vorschlag für die Oberfläche.
  let evenerK = null;
  if (variants[0].relaxed) {
    for (let kk = effectiveK - 1; kk >= 2; kk--) {
      const v = generateVariants(pool, start, end, { targetM, k: kk, detour, roundtrip, quality, isOpenAt, startTime, dwellSec, maxVariants: 1 });
      if (v.length && !v[0].relaxed) { evenerK = kk; break; }
    }
  }

  // Lernende Umweg-Karte: jede geroutete Etappe ist ein Messpunkt "so viel länger
  // als die Luftlinie ist Radfahren hier". Neue Varianten werden Etappe für Etappe
  // mit dem Wert der nahen Messpunkte geschätzt — Hügel/Flüsse/Umwege werden so
  // ortsgenau berücksichtigt statt mit einem einzigen Faktor für alles.
  const samples = [];
  const detourAt = (a, b) => {
    if (!samples.length) return detour;
    const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    let wSum = 1 / (2500 * 2500), vSum = detour * wSum; // schwacher Prior: globaler Faktor
    for (const sm of samples) {
      const d = haversine(mid.lat, mid.lon, sm.lat, sm.lon);
      const w = sm.weight / (d * d + 600 * 600);
      wSum += w; vSum += w * sm.ratio;
    }
    return vSum / wSum;
  };
  const learn = (points, route) => {
    route.legs.forEach((leg, i) => {
      const a = points[i], b = points[i + 1];
      const chord = haversine(a.lat, a.lon, b.lat, b.lon);
      if (chord < 250 || !leg.distance) return;
      samples.push({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2, ratio: clamp(leg.distance / chord, 1, 3), weight: Math.min(1, chord / 2000) + 0.2 });
    });
  };

  const tried = new Map();
  let best = null, calls = 0;
  const routeVariant = async (v) => {
    if (tried.has(v.key)) return tried.get(v.key);
    calls++;
    const points = [start, ...v.stops, endPoint];
    const route = await routeThrough(points, style);
    learn(points, route);
    const q = mean(v.stops.map(quality));
    const result = { variant: v, route, score: routedScore(route, targetM, q), detourMeasured: route.distance / v.geomLen };
    tried.set(v.key, result);
    if (!best || result.score < best.score) best = result;
    return result;
  };
  const fresh = list => list.filter(v => !tried.has(v.key) && !avoidKeys.has(v.key));

  // Runde 1: zwei möglichst verschiedene gute Varianten parallel routen.
  onProgress({ phase: 'route', step: 1 });
  let pool1 = fresh(variants);
  if (!pool1.length) pool1 = variants;
  const first = reroll ? weightedPick(pool1.slice(0, 12), rng) : pool1[0];
  const second = pool1.find(v => v !== first && jaccard(v, first) < 0.5);
  await Promise.all([first, second].filter(Boolean).map(routeVariant));

  // Runden 2+: mit dem gemessenen Umwegfaktor neu planen, bis die Länge passt.
  let round = 2;
  while (calls < MAX_ROUTE_CALLS && Math.abs(best.route.distance - targetM) / targetM > TOUR_TOLERANCE) {
    // Formgröße: geometrisches Mittel aller gemessenen Faktoren (pendelt nicht);
    // die Längenschätzung pro Variante macht dann die lokale Umweg-Karte.
    const measured = [...tried.values()].map(r => r.detourMeasured);
    detour = clamp(Math.exp(mean(measured.map(Math.log))), 1.05, 2.4);
    onProgress({ phase: 'refine', step: round++ });
    variants = generateVariants(pool, start, end, { targetM, k: effectiveK, detour, detourAt, roundtrip, quality, isOpenAt, startTime, dwellSec });
    const candidates = fresh(variants);
    if (!candidates.length) break;
    // Im Feinschliff zählt die Länge: unter den guten Varianten die mit passender
    // (jetzt kalibrierter) Längenschätzung bevorzugen.
    const top = candidates.slice(0, 10);
    const lengthFit = top.filter(v => v.metrics.lenErr <= 0.05);
    const pickFrom = lengthFit.length ? lengthFit : top.slice().sort((a, b) => a.metrics.lenErr - b.metrics.lenErr).slice(0, 3);
    const next = reroll ? weightedPick(pickFrom.slice(0, 6), rng) : pickFrom[0];
    const prevBest = best;
    const res = await routeVariant(next);
    if (best === prevBest && Math.abs(res.route.distance - targetM) >= Math.abs(prevBest.route.distance - targetM) && round > 3) break;
  }

  return {
    stops: best.variant.stops,
    variant: best.variant,
    route: best.route,
    k: effectiveK,
    requestedK: k,
    evenerK,
    attempts: [...tried.values()].map(r => ({
      km: +(r.route.distance / 1000).toFixed(2), est: +(r.variant.estLen / 1000).toFixed(2),
      detour: +r.detourMeasured.toFixed(2), score: +r.score.toFixed(3), overlap: +r.route.overlap.toFixed(2),
    })),
    detour,
    roundtrip,
    start, end: endPoint,
    targetM, style, startTime, dwellSec,
  };
}

// Route für eine geänderte Stopp-Liste neu berechnen (Tauschen/Entfernen).
export async function rerouteTour(tour, newStops) {
  const route = await routeThrough([tour.start, ...newStops, tour.end], tour.style);
  return { ...tour, stops: newStops, route };
}
