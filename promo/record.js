// Nimmt die echte App für den Werbespot auf (Handy-Ansicht, Bregenz).
// Pro Szene ein Ordner promo/build/clips/<szene>/ mit JPG-Bildern + meta.json
// (Zeitstempel jedes Bildes und die Tipp-Positionen für die Finger-Animation).
//
//   python scripts/serve.py          (in einem zweiten Terminal)
//   node promo/record.js [szene …]   (find | tour | group, Standard: alle)
//
// „Meine Runde“ läuft gegen eine nachgebaute Demo-Gruppe (Supabase wird abgefangen),
// damit für das Video nichts in die echte Datenbank geschrieben wird.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const APP = process.env.APP_URL || 'http://localhost:8000/';
const OUT = path.join(__dirname, 'build', 'clips');
const VIEW = { width: 390, height: 844 };
const HOME = { latitude: 47.5031, longitude: 9.7471 }; // Bregenz
// Die üblichen Overpass-Server sind aus manchen Netzen (z. B. Cloud) nicht erreichbar —
// dann alle Anfragen an diesen Server umleiten.
const OVERPASS = process.env.OVERPASS_URL || '';

const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Demo-Gruppe ---------- */
const ago = min => new Date(Date.now() - min * 60000).toISOString();
const group = {
  v: 3, code: 'PROST7', title: 'Seerunde Bregenz', is_owner: true, tour: null, poll: null,
  members: [
    { id: 'm1', name: 'Noah', me: true, drinks: 3, last_seen: ago(0), stats: { badges: 7, prices: 12, km: 16 } },
    { id: 'm2', name: 'Lena', drinks: 4, last_seen: ago(1), stats: { badges: 5, prices: 4, km: 16 }, lat: 47.505, lon: 9.744 },
    { id: 'm3', name: 'Jonas', drinks: 3, last_seen: ago(2), stats: { badges: 3, km: 16 } },
    { id: 'm4', name: 'Mia', drinks: 2, last_seen: ago(4), stats: { badges: 4, prices: 2, km: 12 } },
  ],
  rounds: [
    { id: 1, payer: 'm1', amount: 15.6, beers: 4, participants: ['m1', 'm2', 'm3', 'm4'], place_name: 'Kreuzbar', created_at: ago(95), mine: true },
    { id: 2, payer: 'm2', amount: 16.8, beers: 4, participants: ['m1', 'm2', 'm3', 'm4'], place_name: 'Beach Bar Bregenz', created_at: ago(50) },
    { id: 3, payer: 'm1', amount: 11.4, beers: 3, participants: ['m1', 'm2', 'm3'], place_name: 'Fischersteg', created_at: ago(15), mine: true },
  ],
};
async function mockGroup(ctx) {
  await ctx.route(/\/rest\/v1\/rpc\/group_/, async route => {
    const fn = route.request().url().split('/rpc/')[1];
    const body = JSON.parse(route.request().postData() || '{}');
    if (fn === 'group_drink') group.members[0].drinks += body.p_delta;
    const json = fn === 'group_state' ? group : null;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: json ? JSON.stringify(json) : '' });
  });
}

/* ---------- Aufnahme ---------- */
async function recorder(page, name) {
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [], taps = [], marks = {};
  let t0 = null, n = 0;
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (t0 == null) t0 = metadata.timestamp;
    const file = String(n++).padStart(5, '0') + '.jpg';
    fs.writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
    frames.push({ file, t: +(metadata.timestamp - t0).toFixed(3) });
  });
  const now = () => (t0 == null ? 0 : Date.now() / 1000 - t0);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEW.width * 2, maxHeight: VIEW.height * 2, everyNthFrame: 1 });
  // Ein erstes Bild erzwingen, damit t0 feststeht
  await page.evaluate(() => { document.body.style.outline = '0 solid transparent'; });
  while (t0 == null) await wait(20);
  return {
    mark: label => { marks[label] = +now().toFixed(3); },
    async tap(selector, opts = {}) {
      const el = page.locator(selector).first();
      let box = await el.boundingBox();
      if (box.y < 60 || box.y + box.height > VIEW.height - 20) {
        await el.evaluate(e => e.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        await wait(900);
        box = await el.boundingBox();
      }
      const x = box.x + box.width * (opts.fx ?? 0.5), y = box.y + box.height * (opts.fy ?? 0.5);
      taps.push({ t: +now().toFixed(3), x: +x.toFixed(1), y: +y.toFixed(1) });
      await wait(160); // Finger sieht man kurz vor dem Auslösen
      await page.touchscreen.tap(x, y);
    },
    async stop() {
      await wait(300);
      await cdp.send('Page.stopScreencast');
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ view: VIEW, frames, taps, marks, duration: +now().toFixed(3) }, null, 1));
      console.log(`${name}: ${frames.length} Bilder, ${now().toFixed(1)} s`);
    },
  };
}

async function newApp(browser) {
  const ctx = await browser.newContext({
    viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    geolocation: HOME, permissions: ['geolocation'], locale: 'de-AT', timezoneId: 'Europe/Vienna',
    serviceWorkers: 'block',
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('bl_theme_v1', JSON.stringify('light'));
    localStorage.setItem('bl_group_v1', JSON.stringify({ code: 'PROST7', name: 'Noah' }));
    localStorage.setItem('bl_group_name_v1', 'Noah');
  });
  if (OVERPASS) {
    await ctx.route(/overpass|maps\.mail\.ru\/osm/, async route => {
      if (route.request().url().startsWith(OVERPASS)) return route.continue();
      try {
        const resp = await route.fetch({ url: OVERPASS, timeout: 90000 });
        await route.fulfill({ response: resp, headers: { ...resp.headers(), 'access-control-allow-origin': '*' } });
      } catch (e) { route.abort(); }
    });
  }
  await mockGroup(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('Seitenfehler:', e.message));
  await page.goto(APP);
  await page.waitForFunction(() => parseInt(document.querySelector('#resultCount')?.textContent, 10) > 0, null, { timeout: 120000 });
  await wait(4000); // Kacheln & Marker fertig laden
  return page;
}
const setSheet = (page, s) => page.evaluate(s => import('/js/ui/sheet.js').then(m => m.setSheet(s)), s);

const SCENES = {
  // Karte mit allen Lokalen → Liste mit günstigstem Bier → Lokal antippen
  async find(page) {
    await setSheet(page, 'peek');
    await wait(1500);
    const r = await recorder(page, 'find');
    await wait(1200);
    r.mark('half');
    await setSheet(page, 'half');
    await wait(2000);
    r.mark('full');
    await setSheet(page, 'full');
    await wait(1300);
    await r.tap('#results > *:has(.card-price)', { fy: 0.35 });
    r.mark('detail');
    await wait(3200);
    await r.stop();
    await page.keyboard.press('Escape');
    await wait(500);
  },
  // Radtour planen → Route mit gleichmäßig verteilten Stopps
  async tour(page) {
    await setSheet(page, 'half');
    await wait(800);
    const r = await recorder(page, 'tour');
    await wait(600);
    await r.tap('#tabTour');
    await wait(1400);
    await r.tap('#btnPlan');
    r.mark('plan');
    await page.waitForSelector('#tourResult:not([hidden])', { timeout: 120000 });
    r.mark('result');
    await wait(2500);
    r.mark('peek');
    await setSheet(page, 'peek');
    await wait(2500);
    await r.stop();
  },
  // Meine Runde: Bestenliste, ein Bier mehr, Abrechnung
  async group(page) {
    await setSheet(page, 'half');
    await wait(800);
    const r = await recorder(page, 'group');
    await wait(500);
    await r.tap('#btnMenu');
    await wait(600);
    await r.tap('[data-action="group"]');
    r.mark('open');
    await wait(1800);
    await r.tap('#groupBody [data-drink="1"]');
    await wait(1500);
    await r.tap('#groupBody [data-gtab="money"]');
    r.mark('money');
    await wait(3000);
    await r.stop();
  },
};

(async () => {
  const which = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENES);
  const browser = await chromium.launch({ args: ['--lang=de-AT'] });
  const page = await newApp(browser);
  for (const name of which) await SCENES[name](page);
  await browser.close();
})();
