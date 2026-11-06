// Preisverlauf der Kettenpreise (data/price-history.json, wöchentlich fortgeschrieben).
import { t, money as fmtMoney, LOCALE } from './i18n.js';
let hist = null, loading = null;

export function loadHistory() {
  if (hist) return Promise.resolve(hist);
  if (!loading) {
    loading = fetch('data/price-history.json')
      .then(r => (r.ok ? r.json() : { items: {} }))
      .catch(() => ({ items: {} }))
      .then(d => (hist = d));
  }
  return loading;
}

const fmtDate = iso => new Date(iso).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: '2-digit' });

// → { points, since, text, svg } für einen Kettenpreis-Eintrag
export function describe(p) {
  if (!hist) return null;
  const key = [p.country, p.chain, p.beer, p.package || ''].join('|');
  const pts = hist.items[key] || [];
  const cur = p.currency === 'CHF' ? 'CHF ' : '';
  const money = v => (cur ? `${cur}${v.toFixed(2)}` : fmtMoney(v));
  const lines = [];
  const regs = pts.filter(x => x[1] != null);
  if (regs.length) {
    const first = regs[0][1], last = regs[regs.length - 1][1];
    const changeAt = [...regs].reverse().find((x, i, arr) => arr[i + 1] && arr[i + 1][1] !== x[1]);
    if (first !== last) {
      const prm = { from: money(first), to: money(last) };
      lines.push((last > first ? t('Normalpreis gestiegen: {from} → {to}', prm) : t('Normalpreis gesunken: {from} → {to}', prm))
        + (changeAt ? ' ' + t('(seit {date})', { date: fmtDate(changeAt[0]) }) : ''));
    } else lines.push(t('Normalpreis unverändert {price} seit {date}', { price: money(last), date: fmtDate(regs[0][0]) }));
  }
  // Aktionsphasen: zusammenhängende Punkte mit Aktionspreis
  const phases = [];
  pts.forEach((x, i) => { if (x[2] != null && (i === 0 || pts[i - 1][2] == null)) phases.push(x); });
  if (phases.length) {
    const lastPhase = phases[phases.length - 1];
    lines.push(t('Letzte Aktion ab {date}: {price}', { date: fmtDate(lastPhase[0]), price: money(lastPhase[2]) }));
    if (phases.length >= 2) {
      const gaps = phases.slice(1).map((x, i) => (new Date(x[0]) - new Date(phases[i][0])) / 86400000);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const weeks = Math.max(1, Math.round(avg / 7)), prm = { n: weeks, count: phases.length, date: fmtDate(hist.since) };
      lines.push(weeks === 1 ? t('Aktion etwa alle 1 Wochen ({count}× seit {date})', prm) : t('Aktion etwa alle {n} Wochen ({count}× seit {date})', prm));
    }
  } else if (pts.length) {
    lines.push(t('Keine Aktion seit Beginn der Aufzeichnung ({date})', { date: fmtDate(hist.since) }));
  }
  if (!pts.length) lines.push(t('Verlauf wird seit {date} aufgezeichnet — noch keine Daten.', { date: fmtDate(hist.since || new Date().toISOString()) }));
  return { points: pts, text: lines, svg: pts.length >= 2 ? sparkline(pts) : '' };
}

function sparkline(pts) {
  const W = 260, H = 54, pad = 4;
  const t0 = new Date(pts[0][0]).getTime(), t1 = new Date(pts[pts.length - 1][0]).getTime() || t0 + 1;
  const vals = pts.flatMap(x => [x[1], x[2]]).filter(v => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 0.01) { lo -= 0.5; hi += 0.5; }
  const x = t => pad + ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
  const y = v => pad + (1 - (v - lo) / (hi - lo)) * (H - 2 * pad);
  const reg = pts.filter(p => p[1] != null).map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const dots = pts.filter(p => p[2] != null).map(p => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[2]).toFixed(1)}" r="3.5"/>`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('Preisverlauf')}"><path d="${reg}"/>${dots}</svg>`;
}
