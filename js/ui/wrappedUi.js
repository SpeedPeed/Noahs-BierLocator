// Jahresrückblick ("Dein Bier-Jahr"): Statistik eines Jahres als teilbares Bild.
import { loadDiary, loadTours } from '../store.js';
import { badgeList } from './badgesUi.js';
import { icon } from '../icons.js';
import { toast, downloadFile } from './dom.js';
import { t, num } from '../i18n.js';

const MONTHS = [t('Jänner'), t('Februar'), t('März'), t('April'), t('Mai'), t('Juni'), t('Juli'), t('August'), t('September'), t('Oktober'), t('November'), t('Dezember')];
const DAYS = [t('Sonntag'), t('Montag'), t('Dienstag'), t('Mittwoch'), t('Donnerstag'), t('Freitag'), t('Samstag')];

const top = map => [...map.entries()].sort((a, b) => b[1].n - a[1].n)[0];
function count(map, key, label) { const c = map.get(key) || { n: 0, label }; c.n++; map.set(key, c); }

export function yearsWithData() {
  const ys = new Set([new Date().getFullYear()]);
  loadDiary().filter(e => !e.deleted).forEach(e => ys.add(new Date(e.at).getFullYear()));
  loadTours().filter(t => !t.deleted).forEach(t => ys.add(new Date(t.at).getFullYear()));
  return [...ys].sort((a, b) => b - a);
}

export function yearStats(year) {
  const inYear = ts => new Date(ts).getFullYear() === year;
  const diary = loadDiary().filter(e => !e.deleted && inYear(e.at));
  const tours = loadTours().filter(t => !t.deleted && inYear(t.at));
  const beers = new Map(), places = new Map(), months = new Map(), days = new Map();
  for (const e of diary) {
    count(beers, e.beer.trim().toLowerCase(), e.beer.trim());
    if (e.placeName) count(places, e.placeId || e.placeName, e.placeName);
    const d = new Date(e.at);
    count(months, d.getMonth(), MONTHS[d.getMonth()]);
    count(days, d.getDay(), DAYS[d.getDay()]);
  }
  const tb = top(beers), tp = top(places), tm = top(months), td = top(days);
  return {
    year,
    beers: diary.length,
    liters: diary.reduce((s, e) => s + (e.ml || 500), 0) / 1000,
    sorts: beers.size,
    places: places.size,
    topBeer: tb ? tb[1] : null,
    topPlace: tp ? tp[1] : null,
    topMonth: tm ? tm[1] : null,
    topDay: td ? td[1] : null,
    tours: tours.length,
    km: Math.round(tours.reduce((s, t) => s + (t.km || 0), 0)),
    mates: new Set(tours.flatMap(t => t.mates || [])).size,
    badges: badgeList().filter(b => b.unlocked).length,
  };
}

/* ---------- Bild ---------- */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fit(ctx, text, max) {
  let t = String(text);
  while (ctx.measureText(t).width > max && t.length > 3) t = t.slice(0, -2) + '…';
  return t;
}

export async function drawWrapped(s) {
  try { await document.fonts.ready; } catch (e) { /* egal */ }
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const disp = '"Bricolage Grotesque", Figtree, system-ui, sans-serif';
  const body = 'Figtree, system-ui, sans-serif';
  // Hintergrund: Bier mit Schaumkrone
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ffd56b'); g.addColorStop(0.45, '#f2a01c'); g.addColorStop(1, '#b85f04');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.lineTo(W, 150);
  for (let x = W; x >= 0; x -= 90) ctx.quadraticCurveTo(x - 45, 205 + (x % 180 ? 18 : -12), x - 90, 150);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  for (let i = 0; i < 26; i++) { ctx.beginPath(); ctx.arc((i * 397) % W, 260 + ((i * 631) % (H - 300)), 4 + (i % 5) * 3, 0, Math.PI * 2); ctx.fill(); }

  ctx.fillStyle = '#2b1a05';
  ctx.font = `800 54px ${disp}`;
  ctx.fillText(t('Mein Bier-Jahr'), 80, 105);
  ctx.font = `800 210px ${disp}`;
  ctx.fillText(String(s.year), 70, 420);

  const tiles = [
    [String(s.beers), s.beers === 1 ? t('Bier') : t('Biere')],
    [num(s.liters, 1), t('Liter')],
    [String(s.sorts), t('Sorten')],
    [String(s.places), t('Lokale')],
    [String(s.km), t('Tour-km')],
    [String(s.badges), t('Abzeichen')],
  ];
  tiles.forEach(([v, l], i) => {
    const x = 80 + (i % 3) * 315, y = 480 + Math.floor(i / 3) * 210;
    ctx.fillStyle = 'rgba(255,250,240,.9)';
    roundRect(ctx, x, y, 290, 185, 34); ctx.fill();
    ctx.fillStyle = '#2b1a05';
    ctx.font = `800 82px ${disp}`;
    ctx.fillText(fit(ctx, v, 250), x + 26, y + 102);
    ctx.font = `600 34px ${body}`;
    ctx.fillStyle = '#5b4630';
    ctx.fillText(l, x + 28, y + 152);
  });

  const lines = [];
  if (s.topBeer) lines.push([t('Lieblingsbier'), `${s.topBeer.label} (${s.topBeer.n}×)`]);
  if (s.topPlace) lines.push([t('Stammlokal'), `${s.topPlace.label} (${s.topPlace.n}×)`]);
  if (s.topMonth) lines.push([t('Bester Monat'), s.topMonth.label]);
  if (s.tours) {
    lines.push([t('Biertouren'), !s.mates ? t('{n} × geradelt', { n: s.tours })
      : s.mates === 1 ? t('{n} × geradelt, mit 1 Freund*in', { n: s.tours })
        : t('{n} × geradelt, mit {m} Leuten', { n: s.tours, m: s.mates })]);
  } else if (s.topDay) lines.push([t('Lieblingstag'), s.topDay.label]);
  let y = 935;
  for (const [k, v] of lines.slice(0, 4)) {
    ctx.fillStyle = 'rgba(43,26,5,.7)';
    ctx.font = `700 30px ${body}`;
    ctx.fillText(k.toUpperCase(), 80, y);
    ctx.fillStyle = '#fffaf0';
    ctx.font = `800 50px ${disp}`;
    ctx.fillText(fit(ctx, v, W - 160), 80, y + 56);
    y += 88;
  }
  ctx.fillStyle = 'rgba(255,250,240,.85)';
  ctx.font = `600 28px ${body}`;
  ctx.fillText(t('Bier-Locator · Prost & fahr vorsichtig!'), 80, H - 50);
  return c;
}

export function wrappedHtml(years, year) {
  return `
    <div class="wrapped-head">
      <label class="sort-select"><span class="sr-only">${t('Jahr')}</span><select id="wrapYear">${years.map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
      <div class="row-btns"><button class="btn btn-primary" id="wrapShare">${icon('share', { size: 16 })}${t('Teilen')}</button><button class="btn btn-soft" id="wrapSave">${icon('download', { size: 16 })}${t('Bild')}</button></div>
    </div>
    <div class="wrapped-img" id="wrapImg"></div>`;
}

export async function renderWrapped(year) {
  const s = yearStats(year);
  const box = document.getElementById('wrapImg');
  if (!s.beers && !s.tours) {
    box.innerHTML = `<div class="empty small"><div class="empty-art">${icon('star', { size: 40, strokeWidth: 1.4 })}</div><h3>${t('{year} ist noch leer', { year })}</h3><p>${t("Trag Biere ins Tagebuch ein oder fahr eine Tour — dann gibt's hier deinen Rückblick.")}</p></div>`;
    return null;
  }
  const canvas = await drawWrapped(s);
  const url = canvas.toDataURL('image/png');
  box.innerHTML = `<img src="${url}" alt="${t('Mein Bier-Jahr {year}: {beers} Biere, {sorts} Sorten, {km} Tour-Kilometer', { year, beers: s.beers, sorts: s.sorts, km: s.km })}">`;
  return canvas;
}

export async function shareWrapped(canvas, year, download = false) {
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const file = new File([blob], `bier-jahr-${year}.png`, { type: 'image/png' });
  if (!download && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: t('Mein Bier-Jahr {year}', { year }) }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  downloadFile(file.name, blob, 'image/png');
  toast(t('Bild gespeichert'), { tone: 'good' });
}

