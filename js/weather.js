// Wetter von open-meteo (ohne API-Key): aktuell + stündliche Vorhersage.
import { OPEN_METEO_URL } from './config.js';
import { fetchWithTimeout } from './util.js';

export function weatherIcon(code) {
  if (code === 0) return 'sun';
  if (code === 1 || code === 2) return 'cloudSun';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'cloudRain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'cloudSnow';
  if (code >= 95) return 'cloudStorm';
  return 'thermometer';
}
export function weatherText(code) {
  if (code === 0) return 'sonnig';
  if (code <= 2) return 'leicht bewölkt';
  if (code === 3) return 'bewölkt';
  if (code <= 48) return 'neblig';
  if (code <= 67 || (code >= 80 && code <= 82)) return 'Regen';
  if (code <= 86) return 'Schnee';
  return 'Gewitter';
}
export const isBiergartenWeather = w => !!w && w.temperature >= 17 && w.code <= 3 && (w.precipProb ?? 0) < 40;
export const isRainy = w => !!w && (w.code >= 51 || (w.precipProb ?? 0) >= 60);

export async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(3), longitude: lon.toFixed(3),
    current: 'temperature_2m,weather_code,precipitation,wind_speed_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability,wind_speed_10m,wind_direction_10m',
    forecast_days: '3', timezone: 'auto',
  });
  const res = await fetchWithTimeout(`${OPEN_METEO_URL}?${params}`, {}, 10000);
  if (!res.ok) throw new Error('Wetter nicht verfügbar');
  const d = await res.json();
  const hourly = (d.hourly.time || []).map((t, i) => ({
    time: new Date(t), temperature: d.hourly.temperature_2m[i], code: d.hourly.weather_code[i], precipProb: d.hourly.precipitation_probability[i],
    wind: d.hourly.wind_speed_10m ? d.hourly.wind_speed_10m[i] : null, windFrom: d.hourly.wind_direction_10m ? d.hourly.wind_direction_10m[i] : null,
  }));
  const nowH = hourly.find(h => h.time.getTime() > Date.now() - 3600000);
  return {
    current: { temperature: d.current.temperature_2m, code: d.current.weather_code, wind: d.current.wind_speed_10m, precipProb: nowH ? nowH.precipProb : null },
    hourly,
  };
}

// Wetter für einen Zeitraum (z.B. die Tour): Min/Max-Temperatur, max. Regenwahrscheinlichkeit.
export function weatherForWindow(weather, from, to) {
  if (!weather) return null;
  const hrs = weather.hourly.filter(h => h.time >= new Date(from.getTime() - 3600000) && h.time <= to);
  if (!hrs.length) return null;
  const temps = hrs.map(h => h.temperature);
  const worst = hrs.reduce((a, b) => (b.code > a.code ? b : a));
  const rain = Math.max(...hrs.map(h => h.precipProb || 0));
  const max = Math.max(...temps);
  return {
    min: Math.min(...temps), max, rain, code: worst.code,
    wind: windForWindow(hrs),
    sunny: max >= 17 && worst.code <= 3 && rain < 40,
    rainy: worst.code >= 51 || rain >= 55,
  };
}

// Mittlerer Wind (Vektormittel der Richtung) über einen Zeitraum → { from, speed } | null
export function windForWindow(hrs) {
  const w = hrs.filter(h => h.wind != null && h.windFrom != null);
  if (!w.length) return null;
  let x = 0, y = 0, s = 0;
  for (const h of w) {
    x += Math.sin(h.windFrom * Math.PI / 180) * h.wind;
    y += Math.cos(h.windFrom * Math.PI / 180) * h.wind;
    s += h.wind;
  }
  const from = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  return { from: Math.round(from), speed: Math.round(s / w.length) };
}

const DIRS = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'];
export const windDirName = deg => DIRS[Math.round(deg / 45) % 8];
