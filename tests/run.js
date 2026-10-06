// Minimaler Test-Runner im Browser: tests/index.html über einen lokalen Server öffnen.
import { parseOpeningHours, openStatus, isOpenAt, weekSchedule, isHoliday } from '../js/openingHours.js';
import { simulateBac, distributionFactor } from '../js/bac.js';
import { validatePrice, per05 } from '../js/prices.js';
import { generateVariants, overlapRatio, legStats, makeProjection } from '../js/tour/planner.js';
import { encodeTour, decodeTour } from '../js/share.js';
import { classify } from '../js/places.js';
import { seededRandom, haversine } from '../js/util.js';

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}
function eq(a, b, msg = '') { if (a !== b) throw new Error(`${msg} erwartet ${JSON.stringify(b)}, bekommen ${JSON.stringify(a)}`); }
function ok(v, msg = 'Bedingung nicht erfüllt') { if (!v) throw new Error(msg); }

// 2026-09-28 ist ein Montag.
const at = (day, hh, mm = 0) => new Date(2026, 8, 28 + day, hh, mm);

/* ---------- Öffnungszeiten ---------- */
test('einfacher Wochenplan', () => {
  eq(isOpenAt('Mo-Fr 10:00-22:00', at(0, 12)), true);
  eq(isOpenAt('Mo-Fr 10:00-22:00', at(0, 23)), false);
  eq(isOpenAt('Mo-Fr 10:00-22:00', at(5, 12)), false, 'Samstag');
});
test('"Su off" überschreibt vorige Regel', () => {
  eq(isOpenAt('Mo-Su 10:00-22:00; Su off', at(6, 12)), false);
  eq(isOpenAt('Mo-Su 10:00-22:00; Su off', at(5, 12)), true);
});
test('über Mitternacht', () => {
  eq(isOpenAt('Fr-Sa 18:00-03:00', at(5, 1)), true, 'Sa 01:00 gehört zu Freitag');
  eq(isOpenAt('Fr-Sa 18:00-03:00', at(0, 1)), false, 'Mo 01:00');
  eq(isOpenAt('Fr-Sa 18:00-03:00', at(6, 2)), true, 'So 02:00 gehört zu Samstag');
});
test('mehrere Zeitspannen & Zusatzregeln mit Komma', () => {
  const s = 'Mo-Fr 11:00-14:00,17:00-23:00, Sa 17:00-24:00';
  eq(isOpenAt(s, at(1, 15)), false);
  eq(isOpenAt(s, at(1, 18)), true);
  eq(isOpenAt(s, at(5, 23, 30)), true);
  eq(isOpenAt(s, at(6, 18)), false);
});
test('24/7 und unbekannte Formate', () => {
  eq(isOpenAt('24/7', at(3, 4)), true);
  eq(isOpenAt('sunrise-sunset', at(3, 12)), null);
  eq(isOpenAt('Mo[1] 10:00-12:00', at(3, 12)), null);
  eq(isOpenAt('', at(3, 12)), null);
});
test('Feiertage (PH)', () => {
  // 26.10. Nationalfeiertag AT
  const d = new Date(2026, 9, 26, 12);
  ok(isHoliday(d, 'AT'), 'AT-Feiertag');
  ok(!isHoliday(d, 'DE'), 'kein DE-Feiertag');
  eq(isOpenAt('Mo-Fr 10:00-20:00; PH off', d, 'AT'), false);
  eq(isOpenAt('Mo-Fr 10:00-20:00; PH off', d, 'DE'), true);
  ok(isHoliday(new Date(2026, 3, 6), 'DE'), 'Ostermontag 2026');
});
test('Monatsbereich (Biergarten-Saison)', () => {
  const s = 'Apr-Oct Mo-Su 11:00-22:00; Nov-Mar off';
  eq(isOpenAt(s, new Date(2026, 6, 1, 12)), true);
  eq(isOpenAt(s, new Date(2026, 11, 1, 12)), false);
});
test('Status: schließt bald & öffnet um', () => {
  const st = openStatus('Mo-Fr 10:00-22:00', at(0, 21, 30));
  ok(st.open && st.closingSoon, 'schließt bald');
  const st2 = openStatus('Mo-Fr 10:00-22:00', at(0, 8));
  ok(!st2.open && st2.opensAt.getHours() === 10, 'öffnet um 10');
});
test('offenes Ende "18:00+"', () => {
  eq(isOpenAt('Mo-Sa 18:00+', at(2, 20)), true);
});
test('Wochenplan-Darstellung', () => {
  const w = weekSchedule('Mo-Fr 10:00-22:00; Sa 12:00-24:00; Su off', at(0, 12));
  eq(w[0].text, '10:00–22:00');
  eq(w[5].text, '12:00–24:00');
  eq(w[6].text, 'geschlossen');
  ok(w[0].today);
});
test('Parser ist robust bei Kommentaren', () => {
  ok(parseOpeningHours('Mo-Fr 10:00-18:00 "nach Vereinbarung"'));
});

/* ---------- Promille ---------- */
test('Verteilungsfaktor plausibel', () => {
  const m = distributionFactor({ sex: 'm', weight: 80, height: 180, age: 30 });
  const f = distributionFactor({ sex: 'f', weight: 60, height: 165, age: 30 });
  ok(m > 0.6 && m < 0.85, 'Mann ' + m);
  ok(f > 0.5 && f < 0.75, 'Frau ' + f);
  ok(m > f);
});
test('Promille steigt erst während der Resorption', () => {
  const t0 = Date.UTC(2026, 0, 1, 18);
  const drinks = [{ volume: 500, abv: 5, qty: 1, timestamp: t0 }];
  const p = { sex: 'm', weight: 80, height: 180, age: 30, food: 'snack' };
  const at5 = simulateBac(p, drinks, t0 + 5 * 60000).current;
  const at60 = simulateBac(p, drinks, t0 + 60 * 60000).current;
  ok(at5 < at60, 'nach 5 Min weniger als nach 60 Min');
  ok(at60 > 0.15 && at60 < 0.45, 'ein Bier ≈ 0,2–0,4 ‰, war ' + at60.toFixed(2));
});
test('Verteilte Getränke ergeben weniger Spitze als auf einmal', () => {
  const t0 = Date.UTC(2026, 0, 1, 18);
  const p = { sex: 'm', weight: 80, height: 180, age: 30, food: 'snack' };
  const once = simulateBac(p, [0, 0, 0].map(() => ({ volume: 500, abv: 5, qty: 1, timestamp: t0 })), t0);
  const spread = simulateBac(p, [0, 1, 2].map(i => ({ volume: 500, abv: 5, qty: 1, timestamp: t0 + i * 3600000 })), t0);
  ok(spread.peak < once.peak, `verteilt ${spread.peak.toFixed(2)} < auf einmal ${once.peak.toFixed(2)}`);
});
test('Nüchtern-Zeitpunkt liegt in der Zukunft', () => {
  const now = Date.now();
  const r = simulateBac({ sex: 'm', weight: 75, height: 178, age: 30, food: 'empty' }, [{ volume: 500, abv: 5, qty: 2, timestamp: now - 30 * 60000 }], now);
  ok(r.soberAt && r.soberAt.getTime() > now, 'soberAt in der Zukunft');
  ok(r.below(0.5) === null || r.below(0.5) > new Date(now), 'unter 0,5');
});

/* ---------- Preise ---------- */
test('Plausibilitätsprüfung', () => {
  ok(validatePrice(4.2, '0.5l', 'Pils').ok);
  ok(!validatePrice(0.01, '0.5l', 'Pils').ok, '1 Cent abgelehnt');
  ok(!validatePrice(99, '0.5l', 'Pils').ok, '99 € abgelehnt');
  ok(validatePrice(18, 'kasten20x0.5l', 'Pils').ok, 'Kasten 18 €');
  ok(!validatePrice(3, 'kasten20x0.5l', 'Pils').ok, 'Kasten 3 € abgelehnt');
  ok(!validatePrice(4, '0.5l', '').ok, 'ohne Sorte abgelehnt');
  ok(validatePrice('3,90', '0.5l', 'Pils').ok, 'Komma als Dezimaltrenner');
  ok(Math.abs(per05(13, '1l') - 6.5) < 1e-9);
});

/* ---------- Tourplaner ---------- */
const START = { lat: 48.2082, lon: 16.3738 };
function syntheticPool(seed, { clustered }) {
  const rnd = seededRandom(seed);
  const proj = makeProjection(START);
  const pool = [];
  if (clustered) {
    // "Dörfer": Klumpen aus Orten, dazwischen nichts — der schwierige Fall.
    for (let c = 0; c < 26; c++) {
      const cx = (rnd() - 0.5) * 16000, cy = (rnd() - 0.5) * 16000;
      const n = 2 + Math.floor(rnd() * 8);
      for (let i = 0; i < n; i++) {
        const ll = proj.toLL(cx + (rnd() - 0.5) * 500, cy + (rnd() - 0.5) * 500);
        pool.push({ id: `node/${c}${i}`, ...ll, type: 'pub' });
      }
    }
  } else {
    for (let i = 0; i < 400; i++) {
      const ll = proj.toLL((rnd() - 0.5) * 16000, (rnd() - 0.5) * 16000);
      pool.push({ id: `node/${i}`, ...ll, type: 'pub' });
    }
  }
  return pool;
}
function chordLegs(start, stops, end) {
  const pts = [start, ...stops, end];
  const legs = [];
  for (let i = 1; i < pts.length; i++) legs.push(haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon));
  return legs;
}
for (const clustered of [false, true]) {
  for (const k of [3, 5, 8]) {
    test(`Rundtour ${clustered ? 'Klumpen' : 'gleichmäßig'} k=${k}: gleichmäßige Etappen & Länge`, () => {
      const pool = syntheticPool(42 + k, { clustered });
      const target = 18000, detour = 1.3;
      const t0 = performance.now();
      const v = generateVariants(pool, START, null, { targetM: target, k, detour });
      const ms = performance.now() - t0;
      ok(v.length > 0, 'keine Variante');
      const best = v[0];
      eq(best.stops.length, k, 'Anzahl Stopps');
      if (best.relaxed) {
        // Gegend gibt k gleichmäßige Stopps nicht her → Planer muss das kennzeichnen,
        // und mit weniger Stopps muss es streng klappen.
        ok(clustered, 'gelockerter Modus nur bei Klumpen erwartet');
        const fewer = generateVariants(pool, START, null, { targetM: target, k: k - 3, detour });
        ok(fewer.length && !fewer[0].relaxed, 'mit weniger Stopps gleichmäßig möglich');
        return;
      }
      const legs = chordLegs(START, best.stops, START);
      const { cv, minRatio } = legStats(legs);
      const est = legs.reduce((a, b) => a + b, 0) * detour;
      ok(Math.abs(est - target) / target < 0.12, `Länge ${Math.round(est)} vs ${target}`);
      ok(cv < (clustered ? 0.45 : 0.3), `Etappen ungleichmäßig (CV ${cv.toFixed(2)})`);
      ok(minRatio > (clustered ? 0.3 : 0.45), `Klumpen: kürzeste Etappe ${(minRatio * 100).toFixed(0)} % vom Schnitt`);
      ok(best.metrics.crossings === 0, 'Route kreuzt sich');
      ok(ms < 1500, `zu langsam (${ms.toFixed(0)} ms)`);
    });
  }
}
test('A→B mit Umweg: Stopps entlang des Bogens', () => {
  const pool = syntheticPool(7, { clustered: false });
  const end = makeProjection(START).toLL(6000, 2000);
  const v = generateVariants(pool, START, end, { targetM: 14000, k: 4, detour: 1.3, roundtrip: false });
  ok(v.length, 'keine Variante');
  const legs = chordLegs(START, v[0].stops, end);
  ok(legStats(legs).cv < 0.35, 'CV ' + legStats(legs).cv.toFixed(2));
  ok(Math.abs(legs.reduce((a, b) => a + b, 0) * 1.3 - 14000) / 14000 < 0.12, 'Länge');
});
test('Geschlossene Orte werden ausgeschlossen', () => {
  const pool = syntheticPool(3, { clustered: false });
  const closed = new Set(pool.slice(0, 200).map(p => p.id));
  const v = generateVariants(pool, START, null, { targetM: 15000, k: 4, detour: 1.3, isOpenAt: p => !closed.has(p.id) });
  ok(v.length && v[0].stops.every(s => !closed.has(s.id)));
});
test('Überlappung: Hin & zurück = ~50 %', () => {
  const line = [];
  for (let i = 0; i <= 100; i++) line.push([48.2 + i * 0.0002, 16.37]);
  const back = line.slice().reverse();
  const r = overlapRatio([...line, ...back]);
  ok(r > 0.4 && r < 0.6, 'ratio ' + r.toFixed(2));
  ok(overlapRatio(line) < 0.02, 'gerade Strecke ohne Überlappung');
});

/* ---------- Ortstypen ---------- */
test('Gasthäuser werden erkannt, normale Restaurants nicht', () => {
  eq(classify({ amenity: 'restaurant', name: 'Gasthof Pfleger' }), 'gasthaus');
  eq(classify({ amenity: 'restaurant', name: 'Zur Post', cuisine: 'regional' }), 'gasthaus');
  eq(classify({ amenity: 'restaurant', name: 'Buschenschank Erart' }), 'gasthaus');
  eq(classify({ amenity: 'restaurant', name: 'Pizzeria Roma', cuisine: 'pizza' }), 'restaurant');
  eq(classify({ amenity: 'pub', microbrewery: 'yes' }), 'brewery');
  eq(classify({ amenity: 'restaurant', 'drink:beer': 'no' }), null);
});

/* ---------- Teilen ---------- */
test('Tour-Link: kodieren & dekodieren', () => {
  const t = { start: { lat: 48.2, lon: 16.37 }, end: null, stopIds: ['node/1', 'way/22'], style: 'safety', km: 15, dwell: 30 };
  const back = decodeTour(encodeTour(t));
  eq(back.stopIds.join(), t.stopIds.join());
  eq(back.style, 'safety');
  ok(Math.abs(back.start.lat - 48.2) < 1e-5);
  eq(back.end, null);
});

/* ---------- Ausgabe ---------- */
const passed = results.filter(r => r.ok).length;
document.getElementById('summary').innerHTML = `<span class="${passed === results.length ? 'pass' : 'fail'}">${passed} / ${results.length} Tests bestanden</span>`;
document.getElementById('out').innerHTML = results.map(r =>
  `<div class="${r.ok ? 'pass' : 'fail'}">${r.ok ? '✓' : '✗'} ${r.name}${r.err ? `<pre>${r.err}</pre>` : ''}</div>`).join('');
window.__testResults = results;
