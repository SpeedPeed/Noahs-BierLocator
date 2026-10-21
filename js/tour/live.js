// Live-Tour (DOM-frei, getestet in tests/): GPS-Position auf die Route projizieren,
// Fortschritt verfolgen, Ankunft/Abfahrt an Stopps erkennen und den Zeitplan der
// restlichen Tour aus der tatsächlichen Lage neu berechnen.

import { haversine, clamp } from '../util.js';
import { makeProjection } from './planner.js';

export const ARRIVE_RADIUS = 60;    // m: so nah am Lokal = angekommen
export const LEAVE_RADIUS = 160;    // m: so weit weg vom Lokal = weitergefahren
export const OFF_ROUTE = 150;       // m: weiter weg von der Linie = abseits der Route

// Position auf die Routenlinie projizieren (Segment für Segment). Durchsucht nur den
// Abschnitt [fromAlong, toAlong] (Meter entlang der Route), damit bei Rundtouren,
// die dieselbe Straße zweimal nutzen, nicht auf den falschen Durchgang gesprungen wird.
// → { dist (m zur Linie), along (m entlang der Route), idx (Segmentanfang) }
export function projectOnRoute(route, pos, { fromAlong = -Infinity, toAlong = Infinity } = {}) {
  const ll = route.latlngs, cum = route.cum;
  const proj = makeProjection(pos);
  let best = { dist: Infinity, along: 0, idx: 0 };
  for (let i = 0; i < ll.length - 1; i++) {
    if (cum[i + 1] < fromAlong) continue;
    if (cum[i] > toAlong) break;
    const a = proj.toXY({ lat: ll[i][0], lon: ll[i][1] });
    const b = proj.toXY({ lat: ll[i + 1][0], lon: ll[i + 1][1] });
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? clamp(-(a.x * dx + a.y * dy) / len2, 0, 1) : 0;
    const d = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (d < best.dist) best = { dist: d, along: cum[i] + t * (cum[i + 1] - cum[i]), idx: i };
  }
  return best;
}

// Meter entlang der Route, an denen die Stopps liegen (aus den Etappenlängen).
export function stopAlongs(route) {
  const out = [];
  let acc = 0;
  for (let i = 0; i < route.legs.length - 1; i++) { acc += route.legs[i].distance; out.push(acc); }
  return out;
}

// Neuer Live-Zustand. `here` = Index des Stopps, an dem man gerade ist (oder null),
// `next` = Index des nächsten Ziels (stops.length = Tourende).
export function newLive(now = Date.now()) {
  return { startedAt: now, progress: 0, next: 0, here: null, arrivals: {}, departures: {}, offRoute: false, ridden: 0, last: null, track: [] };
}

// Eine GPS-Messung verarbeiten. Verändert `live` und gibt Ereignisse zurück:
// [{ type: 'arrive' | 'leave' | 'finish', i }]
export function updateLive(live, tour, pos, now = Date.now()) {
  const events = [];
  const route = tour.route;
  const total = route.cum[route.cum.length - 1] || route.distance;
  if (pos.accuracy != null && pos.accuracy > 80) return events; // zu ungenau

  // Gefahrene Strecke (nur echte Bewegung, kein GPS-Zittern)
  if (live.last) {
    const d = haversine(live.last.lat, live.last.lon, pos.lat, pos.lon);
    if (d > 8 && d < 2000) { live.ridden += d; live.last = { lat: pos.lat, lon: pos.lon }; recordTrack(live, pos); }
  } else { live.last = { lat: pos.lat, lon: pos.lon }; recordTrack(live, pos); }

  // Fortschritt entlang der Route: erst im Fenster um den letzten Stand, dann (falls
  // man abgekürzt hat) im ganzen restlichen Teil.
  let r = projectOnRoute(route, pos, { fromAlong: live.progress - 150, toAlong: live.progress + 2500 });
  if (r.dist > 120) {
    const g = projectOnRoute(route, pos, { fromAlong: live.progress - 150 });
    if (g.dist < r.dist) r = g;
  }
  live.offRoute = r.dist > OFF_ROUTE;
  if (!live.offRoute) live.progress = Math.max(live.progress, Math.min(r.along, total));

  // Ankunft / Abfahrt
  const stops = tour.stops;
  if (live.here != null) {
    const s = stops[live.here];
    if (haversine(pos.lat, pos.lon, s.lat, s.lon) > LEAVE_RADIUS) {
      events.push({ type: 'leave', i: live.here });
      depart(live, live.here, now);
    }
  } else if (live.next < stops.length) {
    const s = stops[live.next];
    const near = Math.min(120, ARRIVE_RADIUS + (pos.accuracy || 0) * 0.5);
    if (haversine(pos.lat, pos.lon, s.lat, s.lon) <= near) {
      events.push({ type: 'arrive', i: live.next });
      arrive(live, live.next, now);
    }
  } else if (live.next === stops.length) {
    const end = tour.end;
    if (haversine(pos.lat, pos.lon, end.lat, end.lon) <= ARRIVE_RADIUS + 40 && live.progress > total * 0.8) {
      events.push({ type: 'finish' });
      live.next = stops.length + 1;
    }
  }
  return events;
}

function recordTrack(live, pos) {
  const t = live.track;
  const last = t[t.length - 1];
  if (!last || haversine(last[0], last[1], pos.lat, pos.lon) > 40) t.push([+pos.lat.toFixed(5), +pos.lon.toFixed(5)]);
  if (t.length > 1500) live.track = t.filter((_, i) => i % 2 === 0);
}

export function arrive(live, i, now = Date.now()) {
  live.here = i;
  live.arrivals[i] = now;
  live.next = i;
}
export function depart(live, i, now = Date.now()) {
  if (!live.arrivals[i]) live.arrivals[i] = now;
  live.departures[i] = now;
  live.here = null;
  live.next = i + 1;
}
// Stopp überspringen (z.B. hat zu): gilt als erledigt, ohne Ankunft.
export function skip(live, i) {
  live.departures[i] = live.departures[i] || null;
  if (live.here === i) live.here = null;
  live.next = Math.max(live.next, i + 1);
}

// Zeitplan aus der tatsächlichen Lage. Geplante Zeiten bleiben zum Vergleich erhalten.
// → { rows: [{ i, status: 'done'|'here'|'next'|'later', arrive, leave, plannedArrive }],
//     endTime, delayMin (Verspätung zum nächsten Ziel, + = später als geplant),
//     toNext: Meter bis zum nächsten Ziel }
export function liveSchedule(tour, live, now = Date.now()) {
  const legs = tour.route.legs;
  const dwell = tour.dwellSec * 1000;
  const along = stopAlongs(tour.route);
  // geplante Zeiten
  const planned = [];
  let p = tour.startTime.getTime();
  tour.stops.forEach((_, i) => { p += legs[i].duration * 1000; planned.push(p); p += dwell; });
  const plannedEnd = p + legs[legs.length - 1].duration * 1000;

  const rows = [];
  let t = now;
  let toNext = null, delayMin = 0;
  const total = tour.route.cum[tour.route.cum.length - 1] || tour.route.distance;
  for (let i = 0; i < tour.stops.length; i++) {
    const done = i < live.next && live.here !== i;
    if (done) {
      rows.push({ i, status: 'done', arrive: live.arrivals[i] ? new Date(live.arrivals[i]) : null, leave: live.departures[i] ? new Date(live.departures[i]) : null, plannedArrive: new Date(planned[i]) });
      continue;
    }
    if (live.here === i) {
      const a = live.arrivals[i];
      t = Math.max(now, a + dwell);
      rows.push({ i, status: 'here', arrive: new Date(a), leave: new Date(t), plannedArrive: new Date(planned[i]) });
      continue;
    }
    // unterwegs zu i (erste noch offene) oder später
    const leg = legs[i];
    let dur = leg.duration * 1000;
    if (i === live.next && live.here == null) {
      const remaining = Math.max(0, along[i] - live.progress);
      dur = leg.distance ? dur * clamp(remaining / leg.distance, 0, 1.5) : dur;
      toNext = remaining;
    }
    t += dur;
    const arrive = t;
    t += dwell;
    rows.push({ i, status: i === live.next && live.here == null ? 'next' : 'later', arrive: new Date(arrive), leave: new Date(t), plannedArrive: new Date(planned[i]) });
    if (i === live.next && live.here == null) delayMin = Math.round((arrive - planned[i]) / 60000);
  }
  // letzte Etappe zum Ziel
  const last = legs[legs.length - 1];
  let lastDur = last.duration * 1000;
  if (live.next >= tour.stops.length && live.here == null) {
    const remaining = Math.max(0, total - live.progress);
    lastDur = last.distance ? lastDur * clamp(remaining / last.distance, 0, 1.5) : lastDur;
    toNext = remaining;
    delayMin = Math.round((now + lastDur - plannedEnd) / 60000);
  }
  if (live.here != null) delayMin = Math.round((rows.find(r => r.status === 'here').leave.getTime() - (planned[live.here] + dwell)) / 60000);
  return { rows, endTime: new Date(t + lastDur), delayMin, toNext, plannedEnd: new Date(plannedEnd) };
}

// Live-Zustand speicherbar machen (Datumswerte als Zahlen) und wiederherstellen.
export function serializeTour(tour) {
  return { ...tour, startTime: tour.startTime.getTime(), swapHistory: undefined };
}
export function reviveTour(obj) {
  return { ...obj, startTime: new Date(obj.startTime) };
}
