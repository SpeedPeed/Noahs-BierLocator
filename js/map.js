// Leaflet-Karte: Kacheln passend zum Theme, Ortsmarker mit Clustering,
// Standortpunkt, animierte Tourlinie.
/* global L */
import { DEFAULT_VIEW } from './config.js';
import { TYPE_META } from './places.js';
import { icon } from './icons.js';
import { escapeHtml } from './util.js';
import { reducedMotion } from './ui/dom.js';

let map, tiles, cluster, routeLayer, userMarker, accuracyCircle;
let markers = new Map();
let programmatic = false;
let autoTimer;
const auto = () => { programmatic = true; clearTimeout(autoTimer); autoTimer = setTimeout(() => { programmatic = false; }, 1500); };
let paddingProvider = () => ({ top: 80, bottom: 40, left: 20, right: 20 });

// OSM-Standardkacheln (kein API-Key nötig). Im dunklen Design werden sie per
// CSS-Filter invertiert (siehe .tiles-dark in styles.css).
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende';

export function initMap({ onMoveEnd } = {}) {
  map = L.map('map', { zoomControl: false, attributionControl: true, tapTolerance: 20, maxZoom: 20, minZoom: 3 })
    .setView([DEFAULT_VIEW.lat, DEFAULT_VIEW.lon], DEFAULT_VIEW.zoom);
  map.attributionControl.setPrefix(false);
  if (matchMedia('(min-width: 900px)').matches) L.control.zoom({ position: 'bottomright' }).addTo(map);

  cluster = L.markerClusterGroup({
    maxClusterRadius: 44,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 17,
    iconCreateFunction: c => {
      const n = c.getChildCount();
      const size = n < 10 ? 38 : n < 50 ? 44 : 50;
      return L.divIcon({ html: `<div class="cluster"><span>${n}</span></div>`, className: 'cluster-wrap', iconSize: [size, size] });
    },
  }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);

  // Nur Bewegungen durch Nutzer melden — eigene fitBounds/flyTo zählen nicht.
  if (onMoveEnd) map.on('moveend', () => {
    if (programmatic) { programmatic = false; return; }
    onMoveEnd();
  });
  window.addEventListener('resize', () => map.invalidateSize());
  return map;
}

export function setMapTheme(theme) {
  if (!tiles) {
    tiles = L.tileLayer(TILE_URL, { maxZoom: 19, maxNativeZoom: 19, attribution: ATTRIBUTION, className: 'base-tiles' }).addTo(map);
  }
  map.getContainer().classList.toggle('tiles-dark', theme === 'dark');
}

export function setPaddingProvider(fn) { paddingProvider = fn; }
function fitOptions(extra = 24) {
  const p = paddingProvider();
  return { paddingTopLeft: [p.left + extra, p.top + extra], paddingBottomRight: [p.right + extra, p.bottom + extra] };
}

// Kartenmitte so verschieben, dass der Punkt im sichtbaren (nicht verdeckten) Bereich liegt.
export function flyToVisible(lat, lon, zoom) {
  const p = paddingProvider();
  const z = zoom ?? map.getZoom();
  const target = map.project([lat, lon], z);
  const offset = L.point((p.left - p.right) / 2, (p.top - p.bottom) / 2);
  const center = map.unproject(target.subtract(offset), z);
  auto();
  if (reducedMotion()) map.setView(center, z);
  else map.flyTo(center, z, { duration: 0.8 });
}

export function getViewInfo() {
  const c = map.getCenter();
  const b = map.getBounds();
  const radius = Math.min(c.distanceTo(b.getNorthEast()), 6000);
  return { center: { lat: c.lat, lon: c.lng }, radius, zoom: map.getZoom() };
}

/* ---------- Standort ---------- */
export function setUserLocation(loc) {
  const ll = [loc.lat, loc.lon];
  if (!userMarker) {
    userMarker = L.marker(ll, {
      icon: L.divIcon({ className: '', html: '<div class="me-dot"><span></span></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: 1000, keyboard: false, interactive: false,
    }).addTo(map);
  } else {
    userMarker.setLatLng(ll);
  }
  if (loc.accuracy && loc.accuracy < 2000) {
    if (!accuracyCircle) accuracyCircle = L.circle(ll, { radius: loc.accuracy, className: 'me-accuracy', interactive: false }).addTo(map);
    else accuracyCircle.setLatLng(ll).setRadius(loc.accuracy);
  } else if (accuracyCircle) {
    map.removeLayer(accuracyCircle); accuracyCircle = null;
  }
}

/* ---------- Ortsmarker ---------- */
function markerHtml(place, info) {
  const meta = TYPE_META[place.type];
  const price = info.price != null ? `<span class="pm-price">${info.price.toFixed(2).replace('.', ',')}</span>` : '';
  const fav = info.favorite ? `<span class="pm-fav">${icon('heart', { size: 10, filled: true })}</span>` : '';
  return `<div class="pm${info.closed ? ' pm-closed' : ''}${info.best ? ' pm-best' : ''}" style="--c:${meta.color};--d:${info.delay || 0}ms">
    <span class="pm-dot">${icon(meta.icon, { size: 16, strokeWidth: 2 })}</span>${price}${fav}</div>`;
}

// list: [{ place, info: { price, closed, favorite, best } }]
export function renderPlaceMarkers(list, onClick) {
  cluster.clearLayers();
  markers = new Map();
  const layers = list.map(({ place, info }, i) => {
    const m = L.marker([place.lat, place.lon], {
      icon: L.divIcon({ className: 'pm-wrap', html: markerHtml(place, { ...info, delay: Math.min(i, 30) * 12 }), iconSize: [34, 34], iconAnchor: [17, 17] }),
      title: place.name, riseOnHover: true, keyboard: true,
      zIndexOffset: info.best ? 500 : info.price != null ? 200 : 0,
    });
    m.on('click', () => onClick(place.id));
    markers.set(place.id, m);
    return m;
  });
  cluster.addLayers(layers);
}

export function highlightPlace(id) {
  const m = markers.get(id);
  if (!m) return;
  cluster.zoomToShowLayer(m, () => {
    const el = m.getElement();
    if (el) {
      el.classList.remove('pm-ping');
      void el.offsetWidth;
      el.classList.add('pm-ping');
    }
  });
}

export function fitToPlaces(list, center) {
  if (!list.length) return;
  const pts = list.slice(0, 40).map(p => [p.lat, p.lon]);
  if (center) pts.push([center.lat, center.lon]);
  auto();
  map.fitBounds(L.latLngBounds(pts), { ...fitOptions(), maxZoom: 16, animate: !reducedMotion() });
}

export function setView(lat, lon, zoom = 15) {
  flyToVisible(lat, lon, zoom);
}

/* ---------- Tour ---------- */
export function showPlaceMarkers(show) {
  if (show && !map.hasLayer(cluster)) map.addLayer(cluster);
  if (!show && map.hasLayer(cluster)) map.removeLayer(cluster);
}

export function clearRoute() { routeLayer.clearLayers(); elevMarker = null; }

export function drawRoute(tour, onStopClick) {
  routeLayer.clearLayers();
  elevMarker = null;
  const latlngs = tour.route.latlngs;
  L.polyline(latlngs, { className: 'route-casing', weight: 9, interactive: false }).addTo(routeLayer);
  const line = L.polyline(latlngs, { className: 'route-line', weight: 5, interactive: false }).addTo(routeLayer);

  const startHtml = `<div class="tm tm-start">${icon('flag', { size: 14, strokeWidth: 2.2 })}</div>`;
  L.marker([tour.start.lat, tour.start.lon], { icon: L.divIcon({ className: '', html: startHtml, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 900 })
    .addTo(routeLayer).bindTooltip(tour.roundtrip ? 'Start & Ziel' : 'Start', { direction: 'top', offset: [0, -14] });
  tour.stops.forEach((s, i) => {
    const meta = TYPE_META[s.type];
    const html = `<div class="tm" style="--c:${meta.color};--d:${300 + i * 140}ms">${i + 1}</div>`;
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 1000, title: s.name })
      .addTo(routeLayer)
      .bindTooltip(escapeHtml(s.name), { direction: 'top', offset: [0, -14] })
      .on('click', () => onStopClick(s.id));
  });
  if (!tour.roundtrip) {
    const endHtml = `<div class="tm tm-end">${icon('checkCircle', { size: 15, strokeWidth: 2.2 })}</div>`;
    L.marker([tour.end.lat, tour.end.lon], { icon: L.divIcon({ className: '', html: endHtml, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 900 })
      .addTo(routeLayer).bindTooltip('Ziel', { direction: 'top', offset: [0, -14] });
  }

  auto();
  map.fitBounds(L.latLngBounds(latlngs), { ...fitOptions(16), animate: !reducedMotion() });

  // Linie "zeichnen"
  if (!reducedMotion()) {
    requestAnimationFrame(() => {
      const path = line.getElement();
      if (!path || !path.getTotalLength) return;
      const len = path.getTotalLength();
      path.style.transition = 'none';
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      path.getBoundingClientRect();
      path.style.transition = 'stroke-dashoffset 1.6s cubic-bezier(.6,.05,.3,1)';
      path.style.strokeDashoffset = '0';
      const done = () => { path.style.strokeDasharray = ''; path.style.strokeDashoffset = ''; path.style.transition = ''; };
      path.addEventListener('transitionend', done, { once: true });
      map.once('zoomstart', done);
    });
  }
}

// Kleiner Marker für die Position im Höhenprofil (Hover).
let elevMarker = null;
export function showTrackPoint(latlng) {
  if (!latlng) { if (elevMarker) { routeLayer.removeLayer(elevMarker); elevMarker = null; } return; }
  if (!elevMarker) {
    elevMarker = L.circleMarker(latlng, { radius: 7, className: 'track-point', interactive: false }).addTo(routeLayer);
  } else {
    elevMarker.setLatLng(latlng);
  }
}

export function invalidate() { map && map.invalidateSize(); }
