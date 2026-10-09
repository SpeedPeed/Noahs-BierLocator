// Ein Set schlichter, strichbasierter SVG-Icons (24x24, currentColor).
const ICONS = {
  pin: '<path d="M12 21s-6.5-6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.25"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M19.5 19.5l-4.3-4.3"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M5.5 17.5L10 8h5l3.5 9.5"/><path d="M9 8h4"/><path d="M12 8l2.5 5.5H8"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M9 12h11M4 18h13M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v9M9.5 9.5c0-1.1 1-2 2.5-2s2.5.8 2.5 2-1 1.7-2.5 2-2.5.9-2.5 2 1 2 2.5 2 2.5-.9 2.5-2"/>',
  map: '<path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z"/><path d="M9 4v14M15 6v14"/>',
  shuffle: '<path d="M3 6h3.5L15 17.5H21M15 6.5h6M17.5 4l3 2.5-3 2.5M3 17.5h3.5L11 11"/><path d="M17.5 20l3-2.5-3-2.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.6 6"/><path d="M20 5v6h-6"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9l-2 6-4 2 2-6z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  tag: '<path d="M11.5 3.5H5a1.5 1.5 0 0 0-1.5 1.5v6.5a1.5 1.5 0 0 0 .44 1.06l8.5 8.5a1.5 1.5 0 0 0 2.12 0l6.44-6.44a1.5 1.5 0 0 0 0-2.12l-8.5-8.5a1.5 1.5 0 0 0-1.06-.44z"/><circle cx="8.2" cy="8.2" r="1.3"/>',
  star: '<path d="M12 4l2.47 5.34 5.53.62-4.2 3.9 1.15 5.64L12 16.7l-4.95 2.8 1.15-5.64-4.2-3.9 5.53-.62z"/>',
  alertTriangle: '<path d="M12 4L2.5 20h19z"/><path d="M12 10.5v4"/><circle cx="12" cy="17.2" r="0.15"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="0.2"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  undo: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v6h6"/>',
  flag: '<path d="M6 21V4"/><path d="M6 5h10.5l-2.3 4 2.3 4H6"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  moon: '<path d="M20 14.2A8.5 8.5 0 1 1 9.8 4a7 7 0 0 0 10.2 10.2z"/>',
  download: '<path d="M12 4v11.5"/><path d="M7.5 11l4.5 4.5L16.5 11"/><path d="M4.5 19.5h15"/>',
  upload: '<path d="M12 19.5V8"/><path d="M7.5 12.5L12 8l4.5 4.5"/><path d="M4.5 19.5h15"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4M8.2 13.2l7.6 4"/>',
  trash: '<path d="M5 7h14"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/><path d="M7 7l1 12.5A1.5 1.5 0 0 0 9.5 21h5a1.5 1.5 0 0 0 1.5-1.5L17 7"/><path d="M10.3 11v6M13.7 11v6"/>',
  calculator: '<rect x="5" y="3" width="14" height="18" rx="2.2"/><path d="M7.5 6.5h9v3.5h-9z"/><circle cx="8" cy="14" r="0.9"/><circle cx="12" cy="14" r="0.9"/><circle cx="16" cy="14" r="0.9"/><circle cx="8" cy="17.5" r="0.9"/><circle cx="12" cy="17.5" r="0.9"/><circle cx="16" cy="17.5" r="0.9"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  cloud: '<path d="M7.5 17.5a4 4 0 1 1 .8-7.9 5.2 5.2 0 0 1 10 1.9 3.4 3.4 0 0 1-1 6z"/>',
  cloudSun: '<path d="M8 4.5v1.5M3.5 9H5M4.8 5.8l1 1"/><path d="M5.8 11.2A3.5 3.5 0 0 1 11.2 7"/><path d="M9 19.5a3.5 3.5 0 1 1 .7-6.9 4.5 4.5 0 0 1 8.6 1.6 2.9 2.9 0 0 1-.8 5.3z"/>',
  cloudRain: '<path d="M7.5 15.5a4 4 0 1 1 .8-7.9 5.2 5.2 0 0 1 10 1.9 3.4 3.4 0 0 1-1 6z"/><path d="M9 19l-1 2.5M13 19l-1 2.5M17 19l-1 2.5"/>',
  cloudSnow: '<path d="M7.5 14.5a4 4 0 1 1 .8-7.9 5.2 5.2 0 0 1 10 1.9 3.4 3.4 0 0 1-1 6z"/><circle cx="9" cy="19.5" r="0.4"/><circle cx="13" cy="19.5" r="0.4"/><circle cx="17" cy="19.5" r="0.4"/>',
  cloudStorm: '<path d="M7.5 14.5a4 4 0 1 1 .8-7.9 5.2 5.2 0 0 1 10 1.9 3.4 3.4 0 0 1-1 6z"/><path d="M13 16.5l-2.5 4h3l-2 3.5"/>',
  fog: '<path d="M6.5 9.5h11M4 13.5h16M7 17.5h10"/>',
  thermometer: '<path d="M12 4a2 2 0 0 1 2 2v8.3a4 4 0 1 1-4 0V6a2 2 0 0 1 2-2z"/><path d="M12 9v5.5"/>',
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/>',
  flame: '<path d="M12 3s5 4.5 5 9.5a5 5 0 1 1-10 0c0-1 .3-2 1-3 0 1.3 1 2 1 2-.3-3 1-4.5 3-6.5-.5 2-.3 3.3.5 4.5.7-1 .5-2.2-.5-6.5z"/>',
  activity: '<path d="M3 12h4l2.2-7L13 19l2.5-7H21"/>',
  mountain: '<path d="M2.5 19.5L9 8l3.5 6 2.5-4 6.5 9.5z"/><path d="M7.4 10.8L9 12l1.6-1.2"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  droplet: '<path d="M12 3.5s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11z"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.6 2.6L16 9.5"/>',
  phone: '<path d="M5 4h3.5l1.5 4.5-2 1.3a11 11 0 0 0 6.2 6.2l1.3-2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A15.5 15.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5S9.6 5.9 12 3.5z"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
  beerMug: '<path d="M6.5 8h9v11a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2z"/><path d="M15.5 10.5h1.8A1.7 1.7 0 0 1 19 12.2v2.6a1.7 1.7 0 0 1-1.7 1.7h-1.8"/><path d="M8.5 5v3M11.2 4v4M13.8 5v3"/>',
  barrel: '<ellipse cx="12" cy="5.5" rx="6" ry="2"/><path d="M6 5.5c-1 2-1.5 4.2-1.5 6.5s.5 4.5 1.5 6.5M18 5.5c1 2 1.5 4.2 1.5 6.5s-.5 4.5-1.5 6.5"/><path d="M6 18.5c0 1.1 2.7 2 6 2s6-.9 6-2"/><path d="M4.7 9.5c1.6.8 4.2 1.3 7.3 1.3s5.7-.5 7.3-1.3M4.7 14.5c1.6.8 4.2 1.3 7.3 1.3s5.7-.5 7.3-1.3"/>',
  tree: '<path d="M12 3l4.5 7h-2.6L17.5 16H6.5l3.6-6H7.5z"/><path d="M12 16v5"/>',
  utensils: '<path d="M8 3v6a2 2 0 0 0 4 0V3M10 9v12M6 3v5M14.5 3c-1.4 0-2.5 1.8-2.5 4.5S13.1 12 14.5 12M14.5 3v18"/>',
  sandwich: '<path d="M4 11.5h16L18 17H6z"/><path d="M4 11.5c0-4 3.6-7 8-7s8 3 8 7"/><path d="M5 14.2h14"/>',
  disc: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/>',
  fuel: '<path d="M5 21V6.5A2 2 0 0 1 7 4.5h4a2 2 0 0 1 2 2V21"/><path d="M3.5 21h11"/><path d="M13 10.5h1.8l2.7 2.7v4.3a1.5 1.5 0 0 1-3 0v-1.8h-1.5"/>',
  cart: '<circle cx="9.5" cy="20" r="1.1"/><circle cx="17" cy="20" r="1.1"/><path d="M3 4h2.2l2 11h10.9L20 8.5H7"/>',
  box: '<path d="M3.5 8L12 3.5 20.5 8 12 12.5z"/><path d="M3.5 8v8.5L12 21l8.5-4.5V8"/><path d="M12 12.5V21"/>',
  store: '<path d="M4 9.5V20h16V9.5"/><path d="M3 9.5l1.3-5h15.4l1.3 5z"/><path d="M9.5 20v-5.5h5V20"/>',
  book: '<path d="M5 4.5h9.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9.5"/><path d="M9 8h5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.5 14.2a5 5 0 0 1 5.5 5.3"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M7.5 8.5v7M10 8.5v7M12.5 8.5v7M15 8.5v7M16.5 8.5v7"/>',
  thumbUp: '<path d="M7 11v9H4.5V11zM7 11l4-7a2 2 0 0 1 2.5 2.4L12.8 10H18a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7"/>',
  thumbDown: '<path d="M17 13V4h2.5v9zM17 13l-4 7a2 2 0 0 1-2.5-2.4l.7-3.6H6a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7.2 4H17"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M7 15l4-4 3 3 5-6"/>',
  wheelchair: '<circle cx="11" cy="4.5" r="1.6"/><path d="M11 7.5v6h5l2 5"/><path d="M11 10.5h4"/><path d="M8 11.2a5 5 0 1 0 6.6 6.3"/>',
};

export function icon(name, opts = {}) {
  const size = opts.size || 18;
  const cls = 'icon' + (opts.className ? ' ' + opts.className : '');
  const fill = opts.filled ? 'currentColor' : 'none';
  const sw = opts.strokeWidth || 1.7;
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    const size = el.dataset.iconSize ? parseInt(el.dataset.iconSize, 10) : 18;
    el.innerHTML = icon(el.dataset.icon, { size, filled: el.dataset.iconFilled === 'true' });
  });
}
