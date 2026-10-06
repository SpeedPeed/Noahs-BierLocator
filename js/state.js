// Gemeinsamer Laufzeit-Zustand + ein winziger Event-Bus zwischen den UI-Modulen.
import { prefs } from './store.js';
import { guessCountryFromLocale } from './legal.js';

export const state = {
  location: null,        // { lat, lon, accuracy? }
  locationLabel: '',
  country: prefs.country || guessCountryFromLocale(),
  places: [],            // aktuelle Ergebnisse (alle Typen)
  placeIndex: new Map(), // id → place (auch Tour-/Link-Orte)
  searchCenter: null,
  weather: null,
  mode: 'find',
  tour: null,
};

export function rememberPlaces(list) {
  for (const p of list) state.placeIndex.set(p.id, p);
}

const bus = new EventTarget();
export function emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })); }
export function on(name, fn) { bus.addEventListener(name, e => fn(e.detail)); }
