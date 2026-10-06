// Abgeleitete Infos zu einem Ort (Öffnung, Text-Bausteine, Tour-Qualität).
import { openStatus } from './openingHours.js';
import { state } from './state.js';
import { fmtClock } from './util.js';
import { TYPE_META } from './places.js';
import { getSummary } from './community.js';
import { isFavorite } from './store.js';
import { isBiergartenWeather, isRainy } from './weather.js';

export function placeStatus(place, date = new Date()) {
  return openStatus(place.tags.opening_hours, date, state.country);
}

const sameDay = (a, b) => a.toDateString() === b.toDateString();
function whenLabel(d, now = new Date()) {
  if (sameDay(d, now)) return fmtClock(d);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, tomorrow)) return `morgen ${fmtClock(d)}`;
  return d.toLocaleDateString('de-DE', { weekday: 'short' }) + ' ' + fmtClock(d);
}

// → { tone: 'open'|'soon'|'closed'|'unknown', text }
export function statusBadge(st) {
  if (!st) return { tone: 'unknown', text: 'Öffnungszeiten unbekannt' };
  if (st.open) {
    if (st.always) return { tone: 'open', text: 'Durchgehend offen' };
    if (st.closingSoon) return { tone: 'soon', text: `Schließt bald · ${fmtClock(st.until)}` };
    return { tone: 'open', text: st.until ? `Offen bis ${whenLabel(st.until)}` : 'Geöffnet' };
  }
  return { tone: 'closed', text: st.opensAt ? `Geschlossen · öffnet ${whenLabel(st.opensAt)}` : 'Geschlossen' };
}

// Qualität 0..1 für die Tourplanung: Typ + Bonus für Bewertung, Preis, Favorit, Wetter.
export function tourQuality(place) {
  let q = TYPE_META[place.type].tour;
  const s = getSummary(place.id);
  if (s.rating.avg) q += (s.rating.avg - 3) * 0.05;
  if (s.cheapest) q += 0.05;
  if (isFavorite(place.id)) q += 0.15;
  if (place.unnamed) q -= 0.15;
  const outdoor = place.type === 'biergarten' || place.tags.outdoor_seating === 'yes';
  const w = state.weather && state.weather.current;
  if (outdoor && isBiergartenWeather(w)) q += 0.1;
  if (place.type === 'biergarten' && isRainy(w)) q -= 0.25;
  return Math.max(0, Math.min(1, q));
}
