// Zentrale Konfiguration. Für geteilte Preise/Bewertungen (alle Nutzer sehen
// dieselben Daten) hier die Daten eines kostenlosen Supabase-Projekts eintragen —
// Anleitung siehe README.md. Leer = alles bleibt lokal im Browser.
export const SUPABASE_URL = 'https://uiqxntuthokelgwoxocw.supabase.co';
// "anon"-Key: darf öffentlich sein (NIEMALS den service_role-Key hier eintragen!)
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpcXhudHV0aG9rZWxnd294b2N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyNjIzMTcsImV4cCI6MjEwNjgzODMxN30.VZ7qoU0-xukEV0NmimZOlD-wjy13xU78GjUNOvwbDn8';

// Mehrere Overpass-Server: einzelne sind oft überlastet (504) — die App fragt die
// ersten beiden parallel, dann gestaffelt weitere an und nimmt die erste Antwort.
export const OVERPASS_ENDPOINTS = [
  'https://z.overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
export const PHOTON_URL = 'https://photon.komoot.io';
export const BROUTER_URL = 'https://brouter.de/brouter';
export const OSRM_BASE = 'https://routing.openstreetmap.de/routed-bike';
export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

export const MAX_PLACES = 600;
export const DEFAULT_VIEW = { lat: 47.6, lon: 12.2, zoom: 6 }; // DACH

// Öffentlicher Web-Push-Schlüssel (VAPID) für Preisalarme. Der private Schlüssel
// liegt nur als GitHub-Secret VAPID_PRIVATE_KEY vor (nie ins Repo!).
export const VAPID_PUBLIC_KEY = 'BDpbYgNYW-Piu-B8nzoXL9wXbsIGD6Be9fJW70ihViEh4QssxoMcSVCQk8Qg8dhFURx50BkRZD9DeznBbiyuOfI';
