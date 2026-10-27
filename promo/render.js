// Rendert den Werbespot aus promo/spot.html + den Aufnahmen (promo/record.js) + dem Ton (promo/audio.py).
//
//   node promo/render.js                 → promo/bier-locator-werbespot.mp4
//   node promo/render.js --stills 1,5,9  → nur Einzelbilder nach promo/build/stills/
//   node promo/render.js --audio-only    → nur die Tonspur (promo/build/audio.wav)
//
// Braucht Playwright (Chromium), ffmpeg und python3 mit numpy.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(__dirname, 'build');
const OUT = path.join(__dirname, 'bier-locator-werbespot.mp4');
const TL = JSON.parse(fs.readFileSync(path.join(__dirname, 'timeline.json'), 'utf8'));
const FPS = Number(process.env.FPS || TL.fps);
const DURATION = TL.offset + TL.beats * 60 / TL.bpm;

const TYPES = { '.mp3': 'audio/mpeg', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, () => r(server)));
}

(async () => {
  const stillsArg = process.argv.indexOf('--stills');
  const stills = stillsArg > 0 ? process.argv[stillsArg + 1].split(',').map(Number) : null;

  const server = await serve();
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', e => console.log('Seitenfehler:', e.message));
  await page.goto(`http://localhost:${server.address().port}/promo/spot.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });

  if (stills) {
    const dir = path.join(BUILD, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const t of stills) {
      await page.evaluate(t => window.seek(t), t);
      await page.screenshot({ path: path.join(dir, `t${t.toFixed(2)}.png`) });
    }
    console.log('Einzelbilder in', dir);
    await browser.close(); server.close();
    return;
  }

  // Ton: Geräusche-Fahrplan aus der Komposition + Musik
  const events = await page.evaluate(() => window.SFX);
  fs.writeFileSync(path.join(BUILD, 'sfx.json'), JSON.stringify({ duration: DURATION, music: TL.music, events }, null, 1));
  execFileSync('python3', [path.join(__dirname, 'audio.py'), path.join(BUILD, 'sfx.json'), path.join(BUILD, 'audio.wav')], { stdio: 'inherit' });
  if (process.argv.includes('--audio-only')) { await browser.close(); server.close(); return; }

  const frames = path.join(BUILD, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  const total = Math.round(DURATION * FPS);
  for (let i = 0; i < total; i++) {
    await page.evaluate(t => window.seek(t), i / FPS);
    await page.screenshot({ path: path.join(frames, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94 });
    if (i % FPS === 0) process.stdout.write(`\r${i}/${total} Bilder`);
  }
  console.log(`\r${total}/${total} Bilder`);
  await browser.close(); server.close();

  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', path.join(BUILD, 'audio.wav'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
  console.log('fertig:', path.relative(ROOT, OUT));
})();
