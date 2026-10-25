// Nimmt Screenshots der Live-App mit einem festen Demo-Standort auf.
//
//   node scripts/bluesky/capture.mjs bamberg /tmp/bl-out
//
// Legt im Zielordner an: finden.png, tour.png, surprise-*.png und manifest.json.
// Im Manifest stehen die Positionen der markierten Elemente (für Kreise in compose.py).
// Es wird ein frischer Browser-Kontext ohne gespeicherte Daten verwendet.
import { createRequire } from 'module';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const spots = JSON.parse(readFileSync(join(here, 'spots.json'), 'utf8'));
const [spotKey, outDir, baseArg] = process.argv.slice(2);
const spot = spots[spotKey];
if (!spot || !outDir) {
  console.error('Aufruf: node capture.mjs <spot> <outDir> [baseUrl]');
  process.exit(2);
}
const base = baseArg || 'https://speedpeed.github.io/Noahs-BierLocator/';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'de-DE',
  colorScheme: 'light',
  geolocation: { latitude: spot.lat, longitude: spot.lon },
  permissions: ['geolocation'],
});
const page = await ctx.newPage();
const manifest = { spot: spotKey, shots: {} };

// Bounding-Boxen (in CSS-Pixeln) für Kreise im Bild.
async function boxes(selectors) {
  const out = {};
  for (const sel of selectors) {
    const b = await page.locator(sel).first().boundingBox().catch(() => null);
    if (b) out[sel] = b;
  }
  return out;
}

// 1) Ortsliste
await page.goto(base, { waitUntil: 'networkidle', timeout: 90000 });
// Warten, bis echte Ergebnisse da sind (vorher steht dort „0“ und „Suche …“).
await page.waitForFunction(() => {
  const n = parseInt(document.querySelector('#resultCount')?.textContent ?? '', 10);
  const loading = document.querySelector('#results')?.textContent?.includes('Suche');
  return n > 0 && !loading;
}, null, { timeout: 180000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(outDir, 'finden.png') });
manifest.shots.finden = await boxes(['#searchBox', '#typeChips', '#fOpen', '#resultCount', '#btnLocate', '#btnSurprise']);

// Jeder Schritt ist einzeln abgesichert: Fällt einer aus, bleiben die anderen Bilder erhalten.
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    manifest.errors = [...(manifest.errors || []), `${name}: ${String(e.message).split('\n')[0]}`];
  }
}

// 2) Bier-Radtour mit echter Planung (BRouter)
await step('tour', async () => {
  await page.click('#tabTour');
  // Die Planung hängt oft an Overpass oder BRouter: bis zu dreimal neu anstoßen.
  for (let attempt = 1; ; attempt++) {
    await page.click('#btnPlan');
    try {
      await page.waitForFunction(() => {
        const el = document.querySelector('#tourResult');
        return el && el.offsetParent !== null && el.textContent.trim().length > 80;
      }, null, { timeout: 120000 });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, 'tour.png') });
  manifest.shots.tour = await boxes(['#tourResult', '#tourStats', '#tourElev', '#tourTimeline']);
});

// 3) Kurze Bildfolge für das Glücksrad (Überrasch mich), nur wenn der Knopf sichtbar ist
await step('surprise', async () => {
  await page.click('#tabFind');
  await page.waitForSelector('#btnSurprise:not([hidden])', { timeout: 60000 });
  await page.click('#btnSurprise');
  for (let i = 0; i < 12; i++) {
    await page.screenshot({ path: join(outDir, `surprise-${String(i).padStart(2, '0')}.png`) });
    await page.waitForTimeout(160);
  }
});

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
await browser.close();
console.log(`fertig: ${outDir}`);
