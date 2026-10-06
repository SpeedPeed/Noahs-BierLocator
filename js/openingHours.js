// Parser für das OSM-Format opening_hours — deckt die in der Praxis häufigen
// Formen ab (Wochentage, Zeitspannen über Mitternacht, "off", Feiertage "PH",
// Monatsbereiche, offenes Ende "18:00+", mehrere Regeln mit ";" und ",").
// Alles, was nicht sicher verstanden wird (sunrise, week, Mo[1] …), liefert
// "unbekannt" (null) statt einer falschen Aussage.

const DAY_TOKENS = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };
const MONTH_TOKENS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
export const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const OPEN_END_MINUTES = 6 * 60; // "18:00+" → wir nehmen grob 6 Stunden an

/* ---------- Feiertage (bundesweit/landesweit, ohne Regionalfeiertage) ---------- */
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
const dayKey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const holidayCache = new Map();
export function holidaysFor(country, year) {
  const key = `${country}-${year}`;
  if (holidayCache.has(key)) return holidayCache.get(key);
  const easter = easterSunday(year);
  const rel = n => { const d = new Date(easter); d.setDate(d.getDate() + n); return d; };
  const fix = (m, d) => new Date(year, m - 1, d);
  let list;
  if (country === 'AT') {
    list = [fix(1, 1), fix(1, 6), rel(1), fix(5, 1), rel(39), rel(50), rel(60), fix(8, 15), fix(10, 26), fix(11, 1), fix(12, 8), fix(12, 25), fix(12, 26)];
  } else if (country === 'CH') {
    list = [fix(1, 1), rel(-2), rel(1), rel(39), rel(50), fix(8, 1), fix(12, 25), fix(12, 26)];
  } else {
    list = [fix(1, 1), rel(-2), rel(1), fix(5, 1), rel(39), rel(50), fix(10, 3), fix(12, 25), fix(12, 26)];
  }
  const set = new Set(list.map(dayKey));
  holidayCache.set(key, set);
  return set;
}
export function isHoliday(date, country = 'DE') {
  return holidaysFor(country, date.getFullYear()).has(dayKey(date));
}

/* ---------- Lexer ---------- */
function tokenize(str) {
  const tokens = [];
  const re = /\s*(\d{1,2}:\d{2}|\d{1,2}|[A-Za-z]+|[-,+:\[\]\/])/y;
  let pos = 0;
  while (pos < str.length) {
    re.lastIndex = pos;
    const m = re.exec(str);
    if (!m) {
      if (/^\s*$/.test(str.slice(pos))) break;
      return null;
    }
    tokens.push(m[1]);
    pos = re.lastIndex;
  }
  return tokens;
}
const isDayTok = t => t in DAY_TOKENS || t === 'PH' || t === 'SH';
const isTimeTok = t => /^\d{1,2}:\d{2}$/.test(t);
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/* ---------- Parser ---------- */
function parseSegment(tokens) {
  const rules = [];
  let i = 0;
  const peek = (o = 0) => tokens[i + o];
  let additional = false;
  while (i < tokens.length) {
    const rule = { months: null, days: null, ph: false, shOnly: false, times: null, off: false, additional };

    // Monatsbereich: "Apr-Oct", "May 01-Sep 30", "Dec"
    if (peek() in MONTH_TOKENS) {
      rule.months = [];
      for (;;) {
        const m1 = MONTH_TOKENS[tokens[i++]];
        let d1 = 1;
        if (/^\d{1,2}$/.test(peek() || '')) d1 = Number(tokens[i++]);
        let m2 = m1, d2 = 31;
        if (peek() === '-') {
          i++;
          if (peek() in MONTH_TOKENS) m2 = MONTH_TOKENS[tokens[i++]];
          if (/^\d{1,2}$/.test(peek() || '')) d2 = Number(tokens[i++]);
          else if (!(tokens[i - 1] in MONTH_TOKENS)) return null;
        } else if (d1 !== 1 || /^\d/.test(tokens[i - 1])) {
          d2 = d1; // einzelnes Datum "Dec 24"
        }
        rule.months.push({ m1, d1, m2, d2 });
        if (peek() === ',' && peek(1) in MONTH_TOKENS) { i++; continue; }
        break;
      }
      if (peek() === ':') i++; // "Apr-Oct: Mo-Su ..." (Doppelpunkt nach Monat)
    }

    // Tage: "Mo-Fr", "Sa,Su", "PH", "Mo-Fr,PH"
    if (isDayTok(peek() || '')) {
      rule.days = new Set();
      let sawRealDay = false, sawSH = false;
      for (;;) {
        const t = tokens[i++];
        if (t === 'PH') rule.ph = true;
        else if (t === 'SH') sawSH = true;
        else {
          const a = DAY_TOKENS[t];
          if (peek() === '[') return null; // "Mo[1]" — n-ter Wochentag, nicht unterstützt
          sawRealDay = true;
          if (peek() === '-' && peek(1) in DAY_TOKENS) {
            i++;
            const b = DAY_TOKENS[tokens[i++]];
            for (let d = a; ; d = (d + 1) % 7) { rule.days.add(d); if (d === b) break; }
          } else {
            rule.days.add(a);
          }
        }
        if (peek() === ',' && isDayTok(peek(1) || '')) { i++; continue; }
        break;
      }
      if (sawSH && !sawRealDay && !rule.ph) rule.shOnly = true; // nur Schulferien → wissen wir nicht
      if (peek() === ':') i++;
    }

    // Zeiten / Status
    const t = peek();
    if (t && isTimeTok(t)) {
      rule.times = [];
      for (;;) {
        if (!isTimeTok(peek() || '')) return null;
        const s = toMin(tokens[i++]);
        let e;
        if (peek() === '+') { i++; e = s + OPEN_END_MINUTES; }
        else if (peek() === '-' && isTimeTok(peek(1) || '')) {
          i++;
          e = toMin(tokens[i++]);
          if (peek() === '+') i++; // "18:00-02:00+" → Ende als Richtwert
          if (e <= s) e += 1440;    // über Mitternacht
        } else return null;
        rule.times.push({ s, e });
        if (peek() === ',' && isTimeTok(peek(1) || '')) { i++; continue; }
        break;
      }
    } else if (t === 'off' || t === 'closed') {
      i++; rule.off = true;
    } else if (t === 'open') {
      i++; rule.times = [{ s: 0, e: 1440 }];
    } else if (t && /^[A-Za-z]+$/.test(t) && !isDayTok(t) && !(t in MONTH_TOKENS)) {
      return null; // sunrise, week, unknown, … → lieber "unbekannt"
    }

    if (!rule.times && !rule.off) {
      if (!rule.days && !rule.months) return null;
      rule.times = [{ s: 0, e: 1440 }]; // "Mo-Fr" ohne Zeit = ganztägig
    }
    rules.push(rule);

    if (i >= tokens.length) break;
    if (peek() === ',') { i++; additional = true; continue; }
    return null; // unerwartetes Token
  }
  return rules;
}

export function parseOpeningHours(str) {
  if (!str || typeof str !== 'string') return null;
  const cleaned = str.replace(/"[^"]*"/g, '').trim();
  if (!cleaned) return null;
  if (/^24\/7$/i.test(cleaned)) return { alwaysOpen: true, rules: [] };
  const rules = [];
  for (const seg of cleaned.split(/;|\|\|/).map(s => s.trim()).filter(Boolean)) {
    if (/^24\/7$/i.test(seg)) { rules.push({ months: null, days: null, ph: false, times: [{ s: 0, e: 1440 }], off: false, additional: false }); continue; }
    const tokens = tokenize(seg);
    if (!tokens || !tokens.length) return null;
    const parsed = parseSegment(tokens);
    if (!parsed) return null;
    rules.push(...parsed);
  }
  return rules.length ? { alwaysOpen: false, rules } : null;
}

function monthMatches(ranges, date) {
  const md = date.getMonth() * 100 + date.getDate();
  return ranges.some(({ m1, d1, m2, d2 }) => {
    const a = m1 * 100 + d1, b = m2 * 100 + d2;
    return a <= b ? md >= a && md <= b : md >= a || md <= b; // über den Jahreswechsel
  });
}

// Öffnungsintervalle (Minuten ab Mitternacht, Ende kann > 1440 sein) für einen Kalendertag.
export function dayIntervals(oh, date, country = 'DE') {
  if (oh.alwaysOpen) return [{ s: 0, e: 1440 }];
  const iso = (date.getDay() + 6) % 7;
  const ph = isHoliday(date, country);
  let intervals = [];
  for (const r of oh.rules) {
    if (r.shOnly) continue;
    if (r.months && !monthMatches(r.months, date)) continue;
    const dayOk = !r.days || r.days.has(iso) || (r.ph && ph);
    if (!dayOk) continue;
    if (r.additional) {
      if (!r.off) intervals = intervals.concat(r.times);
    } else {
      intervals = r.off ? [] : r.times.slice();
    }
  }
  return intervals;
}

// Absolute Öffnungszeiträume von "Tag -1" bis "Tag +days" um `ref` herum, zusammengeführt.
function absoluteIntervals(oh, ref, country, days = 7) {
  const out = [];
  for (let off = -1; off <= days; off++) {
    const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + off);
    for (const { s, e } of dayIntervals(oh, d, country)) {
      out.push([d.getTime() + s * 60000, d.getTime() + e * 60000]);
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of out) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push(iv.slice());
  }
  return merged;
}

// Status zu einem Zeitpunkt: { open, until, opensAt, closingSoon } oder null (unbekannt).
export function openStatus(ohOrString, date = new Date(), country = 'DE') {
  const oh = typeof ohOrString === 'string' ? parseOpeningHours(ohOrString) : ohOrString;
  if (!oh) return null;
  if (oh.alwaysOpen) return { open: true, until: null, opensAt: null, closingSoon: false, always: true };
  const t = date.getTime();
  const ivs = absoluteIntervals(oh, date, country);
  const cur = ivs.find(([a, b]) => a <= t && t < b);
  if (cur) {
    const until = new Date(cur[1]);
    return { open: true, until, opensAt: null, closingSoon: cur[1] - t <= 45 * 60000 };
  }
  const next = ivs.find(([a]) => a > t);
  return { open: false, until: null, opensAt: next ? new Date(next[0]) : null, closingSoon: false };
}

export function isOpenAt(ohString, date = new Date(), country = 'DE') {
  const st = openStatus(ohString, date, country);
  return st ? st.open : null;
}

const fmtM = m => {
  m = m % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
// Wochenplan Mo–So der aktuellen Woche: [{ label, text, today }]
export function weekSchedule(ohString, ref = new Date(), country = 'DE') {
  const oh = parseOpeningHours(ohString);
  if (!oh) return null;
  const iso = (ref.getDay() + 6) % 7;
  const monday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - iso);
  return DAY_LABELS.map((label, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const ivs = dayIntervals(oh, d, country).slice().sort((a, b) => a.s - b.s);
    const text = !ivs.length ? 'geschlossen'
      : ivs.some(v => v.s === 0 && v.e >= 1440) ? 'durchgehend'
      : ivs.map(v => `${fmtM(v.s)}–${v.e === 1440 ? '24:00' : fmtM(v.e)}`).join(', ');
    return { label, text, today: i === iso, holiday: isHoliday(d, country) };
  });
}
