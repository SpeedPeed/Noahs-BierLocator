// Abgeleitete Infos zu einem Ort (Öffnung, Text-Bausteine, Tour-Qualität).
import { openStatus } from './openingHours.js';
import { state } from './state.js';
import { fmtClock } from './util.js';
import { t, LOCALE } from './i18n.js';
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
  if (sameDay(d, tomorrow)) return t('morgen {time}', { time: fmtClock(d) });
  return d.toLocaleDateString(LOCALE, { weekday: 'short' }) + ' ' + fmtClock(d);
}

// → { tone: 'open'|'soon'|'closed'|'unknown', text }
export function statusBadge(st) {
  if (!st) return { tone: 'unknown', text: t('Öffnungszeiten unbekannt') };
  if (st.open) {
    if (st.always) return { tone: 'open', text: t('Durchgehend offen') };
    if (st.closingSoon) return { tone: 'soon', text: t('Schließt bald · {time}', { time: fmtClock(st.until) }) };
    return { tone: 'open', text: st.until ? t('Offen bis {when}', { when: whenLabel(st.until) }) : t('Geöffnet') };
  }
  return { tone: 'closed', text: st.opensAt ? t('Geschlossen · öffnet {when}', { when: whenLabel(st.opensAt) }) : t('Geschlossen') };
}

// Kurzform für die Listenzeile: "bis 02:00", "schließt 23:00", "zu, öffnet 16:00".
export function statusShort(st) {
  if (!st) return { tone: 'unknown', text: t('Zeiten unbekannt') };
  if (st.open) {
    if (st.always) return { tone: 'open', text: t('immer offen') };
    if (st.closingSoon) return { tone: 'soon', text: t('schließt {time}', { time: fmtClock(st.until) }) };
    // "bis 02:00" versteht jeder als heute Nacht: kein "morgen" davor.
    const when = st.until - Date.now() < 20 * 3600e3 ? fmtClock(st.until) : whenLabel(st.until);
    return { tone: 'open', text: st.until ? t('bis {when}', { when }) : t('offen') };
  }
  return { tone: 'closed', text: st.opensAt ? t('zu, öffnet {when}', { when: whenLabel(st.opensAt) }) : t('zu') };
}

// Warum die Liste so aussieht, wie sie aussieht: ein Grund, der wichtigste zuerst.
// → 'closed' | 'late' | 'rain' | 'sun' | null
export const isLate = hour => hour >= 22 || hour < 5;
export function contextReason({ widened, late, sunny, rainy }) {
  if (widened) return 'closed';
  if (late) return 'late';
  if (rainy) return 'rain';
  if (sunny) return 'sun';
  return null;
}

// Qualität 0..1 für die Tourplanung: Typ + Bonus für Bewertung, Preis, Favorit, Wetter.
// `wx` = Wetter während der Tour ({ sunny, rainy }, aus der Vorhersage); ohne
// Angabe zählt das aktuelle Wetter.
export function tourQuality(place, wx = null) {
  let q = TYPE_META[place.type].tour;
  const s = getSummary(place.id);
  if (s.rating.avg) q += (s.rating.avg - 3) * 0.05;
  if (s.cheapest) q += 0.05;
  if (isFavorite(place.id)) q += 0.15;
  if (place.unnamed) q -= 0.15;
  const outdoor = place.type === 'biergarten' || place.tags.outdoor_seating === 'yes';
  const w = state.weather && state.weather.current;
  const sunny = wx ? wx.sunny : isBiergartenWeather(w);
  const rainy = wx ? wx.rainy : isRainy(w);
  if (outdoor && sunny) q += 0.12;
  if (rainy) {
    if (place.type === 'biergarten') q -= 0.3;
    else if (INDOOR.has(place.type)) q += 0.08; // drinnen sitzen, wenn's schüttet
  }
  return Math.max(0, Math.min(1, q));
}
const INDOOR = new Set(['pub', 'gasthaus', 'brewery', 'restaurant']);
