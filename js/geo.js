// Standort: Geolocation, Adresssuche mit Vorschlägen und Rückwärtssuche (Photon/Komoot).
import { PHOTON_URL } from './config.js';
import { fetchWithTimeout } from './util.js';
import { t, LANG } from './i18n.js';

// Photon kennt de, en, fr, it (sonst "default" = Ortssprache).
const PHOTON_LANG = ['de', 'en', 'fr', 'it'].includes(LANG) ? LANG : 'default';

function featureToResult(f) {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const main = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || t('Ort');
  const sub = [p.name && p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : null, p.postcode, p.city || p.town || p.village, p.country]
    .filter((v, i, a) => v && a.indexOf(v) === i && v !== main).join(', ');
  return { lat, lon, label: main, sub, country: (p.countrycode || '').toUpperCase() || null, kind: p.osm_value };
}

export async function searchPlaces(query, near = null, limit = 6) {
  const params = new URLSearchParams({ q: query, lang: PHOTON_LANG, limit: String(limit) });
  if (near) { params.set('lat', near.lat.toFixed(4)); params.set('lon', near.lon.toFixed(4)); }
  const res = await fetchWithTimeout(`${PHOTON_URL}/api/?${params}`, {}, 10000);
  if (!res.ok) throw new Error(t('Suche nicht erreichbar'));
  const data = await res.json();
  // Dubletten (gleicher Name, < 300 m auseinander, z.B. Straße + Haltestelle) zusammenfassen
  const out = [];
  for (const r of (data.features || []).map(featureToResult)) {
    if (out.some(o => o.label === r.label && Math.abs(o.lat - r.lat) < 0.003 && Math.abs(o.lon - r.lon) < 0.004)) continue;
    out.push(r);
  }
  return out;
}

export async function reverseGeocode(lat, lon) {
  try {
    const res = await fetchWithTimeout(`${PHOTON_URL}/reverse?lat=${lat}&lon=${lon}&lang=${PHOTON_LANG}`, {}, 8000);
    if (!res.ok) return null;
    const data = await res.json();
    const f = data.features && data.features[0];
    if (!f) return null;
    const r = featureToResult(f);
    const p = f.properties;
    const place = p.district || p.locality || p.city || p.town || p.village || r.label;
    return { ...r, short: [p.street, place].filter(Boolean).join(', ') || r.label };
  } catch (e) { return null; }
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error(t('Dieser Browser kann keinen Standort bestimmen.'))); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => reject(new Error(err.code === 1 ? t('Standortzugriff wurde nicht erlaubt.') : t('Standort konnte nicht bestimmt werden.'))),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  });
}

export async function geolocationGranted() {
  try {
    const st = await navigator.permissions.query({ name: 'geolocation' });
    return st.state === 'granted';
  } catch (e) { return false; }
}
