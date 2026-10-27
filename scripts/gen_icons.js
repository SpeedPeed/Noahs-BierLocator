// Erzeugt Logo (SVG) und alle App-Icons (PNG) für Bier-Locator aus einer einzigen Vorlage.
// Logo: Standort-Pin, gefüllt mit Bier, Schaumkrone oben, zwei aufsteigende Bläschen.
//
//   node scripts/gen_icons.js
//
// Braucht Playwright mit Chromium (zum Rastern der SVGs). Schreibt nach icons/ und promo/brand/.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const ICONS = path.join(ROOT, 'icons');
const BRAND = path.join(ROOT, 'promo', 'brand');

const BG = '#1f160d';      // dunkles Malzbraun
const FOAM = '#fff7e6';
const PIN = 'M256 476C224 412 100 332 100 210a156 156 0 0 1 312 0c0 122-124 202-156 266z';
const FOAM_PATH = 'M80 30H432V178q-22-16-44 0t-44 0v44a17 17 0 0 1-34 0v-44q-22-16-44 0t-44 0t-44 0t-44 0t-44 0z';
const BUBBLES = [[166, 84, 31], [226, 52, 21]];
const BUBBLE_GAP = 11;

// Das Zeichen selbst im 512er-Raster, ohne Hintergrund. `id` hält IDs eindeutig, falls
// mehrere Logos in einer Seite stehen.
function mark(id = 'bl') {
  const cut = BUBBLES.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + BUBBLE_GAP}" fill="#000"/>`).join('');
  const bubbles = BUBBLES.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${FOAM}"/>`).join('');
  return `<defs>
    <linearGradient id="${id}-beer" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc94f"/><stop offset="1" stop-color="#df8510"/></linearGradient>
    <clipPath id="${id}-pin"><path d="${PIN}"/></clipPath>
    <mask id="${id}-gap"><rect width="512" height="512" fill="#fff"/>${cut}</mask>
  </defs>
  <g mask="url(#${id}-gap)">
    <path d="${PIN}" fill="url(#${id}-beer)"/>
    <g clip-path="url(#${id}-pin)">
      <path d="${FOAM_PATH}" fill="#c8740c" fill-opacity=".45" transform="translate(0 10)"/>
      <path d="${FOAM_PATH}" fill="${FOAM}"/>
      <path d="M160 236v116" stroke="#fff" stroke-opacity=".5" stroke-width="20" stroke-linecap="round"/>
      <circle cx="296" cy="318" r="14" fill="#fff" fill-opacity=".55"/>
      <circle cx="258" cy="382" r="9" fill="#fff" fill-opacity=".5"/>
      <circle cx="232" cy="270" r="8" fill="#fff" fill-opacity=".5"/>
    </g>
  </g>
  ${bubbles}`;
}

// bg: 'none' | 'rounded' | 'square'; scale: Größe des Zeichens (maskable braucht Rand).
function svg({ bg = 'none', scale = 1 } = {}) {
  const back = bg === 'none' ? '' : `<rect width="512" height="512"${bg === 'rounded' ? ' rx="112"' : ''} fill="${BG}"/>`;
  const t = scale === 1 ? '' : ` transform="translate(${256 * (1 - scale)} ${256 * (1 - scale)}) scale(${scale})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${back}<g${t}>${mark()}</g></svg>\n`;
}

const PNGS = [
  // [Datei, Größe, Variante]
  ['icons/icon-192.png', 192, { bg: 'rounded', scale: 0.86 }],
  ['icons/icon-512.png', 512, { bg: 'rounded', scale: 0.86 }],
  ['icons/icon-192-maskable.png', 192, { bg: 'square', scale: 0.7 }],
  ['icons/icon-512-maskable.png', 512, { bg: 'square', scale: 0.7 }],
  ['icons/apple-touch-icon.png', 180, { bg: 'square', scale: 0.8 }],
  ['icons/favicon-32.png', 32, { bg: 'rounded', scale: 0.92 }],
  ['icons/favicon-16.png', 16, { bg: 'rounded', scale: 0.96 }],
  ['promo/brand/logo-1024.png', 1024, { bg: 'none' }],
  ['promo/brand/play-store-icon-512.png', 512, { bg: 'square', scale: 0.8 }],
];

(async () => {
  fs.mkdirSync(BRAND, { recursive: true });
  fs.writeFileSync(path.join(ICONS, 'logo.svg'), svg());
  fs.writeFileSync(path.join(ICONS, 'icon.svg'), svg({ bg: 'rounded', scale: 0.86 }));
  console.log('wrote icons/logo.svg, icons/icon.svg');

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, size, opts] of PNGS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(opts).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(ROOT, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote', file);
  }

  // Vorschaubild für GitHub (Settings → Social preview), 1280×640
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.setContent(`<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Figtree:wght@500&display=swap"></head>
    <body style="margin:0;width:1280px;height:640px;display:flex;align-items:center;gap:56px;padding:0 110px;box-sizing:border-box;
      background:radial-gradient(circle at 25% 60%,#3a2610,${BG} 60%);color:${FOAM};font-family:Figtree,sans-serif">
      ${svg().replace('<svg ', '<svg width="340" height="340" ')}
      <div><div style="font:800 104px/1 'Bricolage Grotesque',sans-serif;letter-spacing:-2px">Bier-Locator</div>
      <div style="margin-top:22px;font-size:32px;white-space:nowrap;opacity:.8">Dein nächstes Bier ist näher, als du denkst.</div></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(BRAND, 'social-preview.png') });
  console.log('wrote promo/brand/social-preview.png');
  await browser.close();
})();
