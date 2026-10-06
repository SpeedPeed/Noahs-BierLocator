import { BROUTER_URL, OSRM_BASE } from '../config.js';
import { haversine, sleep, fetchWithTimeout } from '../util.js';
import { matchTrackIndices, overlapRatio } from './planner.js';

export const LEISURE_SPEED_MPS = 4.2;

// Fahrstile → BRouter-Profile. Umwegfaktor = Startwert für die Längenschätzung
// (Straßenkilometer pro Luftlinienkilometer), wird pro Planung nachkalibriert.
export const RIDE_STYLES = {
  trekking: { label: 'Ausgewogen', desc: 'Radwege & Nebenstraßen, gut fahrbar', profile: 'trekking', detour: 1.32 },
  safety:   { label: 'Ruhig & sicher', desc: 'Meidet Verkehr konsequent, dafür mehr Umwege', profile: 'safety', detour: 1.42 },
  fastbike: { label: 'Zügig', desc: 'Asphalt, direkter, auch mal Landstraße', profile: 'fastbike', detour: 1.25 },
};

function cumulative(latlngs) {
  const cum = [0];
  for (let i = 1; i < latlngs.length; i++) {
    cum.push(cum[i - 1] + haversine(latlngs[i - 1][0], latlngs[i - 1][1], latlngs[i][0], latlngs[i][1]));
  }
  return cum;
}

function computeAscent(elevations) {
  // leicht geglättet, damit Messrauschen nicht als Höhenmeter zählt
  let up = 0, down = 0, ref = elevations.find(e => e != null);
  if (ref == null) return { up: null, down: null };
  for (const e of elevations) {
    if (e == null) continue;
    if (e - ref > 3) { up += e - ref; ref = e; }
    else if (ref - e > 3) { down += ref - e; ref = e; }
  }
  return { up: Math.round(up), down: Math.round(down) };
}

async function brouter(points, profile, attempt = 1) {
  const lonlats = points.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join('|');
  const url = `${BROUTER_URL}?lonlats=${lonlats}&profile=${profile}&alternativeidx=0&format=geojson`;
  let res;
  try {
    res = await fetchWithTimeout(url, {}, 30000);
  } catch (e) {
    if (attempt < 2) { await sleep(800); return brouter(points, profile, attempt + 1); }
    throw e;
  }
  if (!res.ok) {
    if (attempt < 2 && res.status >= 500) { await sleep(1000); return brouter(points, profile, attempt + 1); }
    throw new Error('BRouter ' + res.status);
  }
  const data = await res.json();
  const f = data.features && data.features[0];
  if (!f || !f.geometry || !f.geometry.coordinates.length) throw new Error('BRouter: keine Route');
  const coords = f.geometry.coordinates;
  const latlngs = coords.map(c => [c[1], c[0]]);
  const elevations = coords.map(c => (c.length > 2 ? c[2] : null));
  const times = (f.properties.times || []).map(Number);
  const cum = cumulative(latlngs);
  const idx = matchTrackIndices(latlngs, points);
  const legs = [];
  for (let i = 0; i < points.length - 1; i++) {
    legs.push({
      distance: Math.max(0, cum[idx[i + 1]] - cum[idx[i]]),
      duration: Math.max(0, (times[idx[i + 1]] || 0) - (times[idx[i]] || 0)),
    });
  }
  const distance = Number(f.properties['track-length']) || cum[cum.length - 1];
  const duration = Number(f.properties['total-time']) || times[times.length - 1] || distance / 4.2;
  return { latlngs, elevations, cum, distance, duration, legs, ascent: computeAscent(elevations), bikeFriendly: true };
}

async function osrm(points) {
  const coordStr = points.map(p => `${p.lon},${p.lat}`).join(';');
  const url = `${OSRM_BASE}/route/v1/driving/${coordStr}?overview=full&geometries=geojson&steps=false`;
  const res = await fetchWithTimeout(url, {}, 25000);
  if (!res.ok) throw new Error('Routing-Server antwortet nicht (' + res.status + ')');
  const data = await res.json();
  if (data.code !== 'Ok') throw new Error('Routing fehlgeschlagen: ' + data.code);
  const r = data.routes[0];
  const latlngs = r.geometry.coordinates.map(c => [c[1], c[0]]);
  return {
    latlngs, elevations: latlngs.map(() => null), cum: cumulative(latlngs),
    distance: r.distance, duration: r.duration,
    legs: r.legs.map(l => ({ distance: l.distance, duration: l.duration })),
    ascent: { up: null, down: null }, bikeFriendly: false,
  };
}

// Route über alle Punkte in fester Reihenfolge. Fällt auf OSRM zurück, wenn BRouter
// nicht erreichbar ist.
export async function routeThrough(points, style = 'trekking') {
  const profile = (RIDE_STYLES[style] || RIDE_STYLES.trekking).profile;
  let route;
  try {
    route = await brouter(points, profile);
  } catch (e) {
    route = await osrm(points);
  }
  // Gemütliches Biertour-Tempo (~15 km/h) plus Steigungszuschlag (~10 Hm/Min)
  // statt der sportlichen Router-Zeiten; Etappen anteilig.
  const leisure = d => d / LEISURE_SPEED_MPS;
  const climb = (route.ascent.up || 0) * 6;
  route.duration = leisure(route.distance) + climb;
  route.legs.forEach(l => { l.duration = leisure(l.distance) + (route.distance ? climb * l.distance / route.distance : 0); });
  route.overlap = overlapRatio(route.latlngs);
  return route;
}
