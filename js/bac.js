// Promille-Modell (DOM-frei, getestet in tests/).
//
// Gegenüber der einfachen Widmark-Formel ("alles sofort im Blut, Abbau ab dem
// ersten Schluck") wird hier jedes Getränk einzeln über eine Resorptionsphase
// aufgenommen, während gleichzeitig konstant abgebaut wird. Der Verteilungsfaktor
// kommt aus dem Körperwasser nach Watson (Alter, Größe, Gewicht, Geschlecht),
// wie in der forensischen Praxis üblich, abzüglich eines Resorptionsdefizits.

export const DRINK_PRESETS = {
  bier05:      { label: 'Bier 0,5 l',          volume: 500,  abv: 5.0,  kcal100: 43 },
  bier033:     { label: 'Bier 0,33 l',         volume: 330,  abv: 5.0,  kcal100: 43 },
  mass:        { label: 'Maß 1 l',             volume: 1000, abv: 5.8,  kcal100: 48 },
  weizen:      { label: 'Weizen 0,5 l',        volume: 500,  abv: 5.4,  kcal100: 44 },
  craft:       { label: 'IPA / Craft 0,33 l',  volume: 330,  abv: 6.5,  kcal100: 55 },
  radler:      { label: 'Radler 0,5 l',        volume: 500,  abv: 2.5,  kcal100: 21 },
  alkoholfrei: { label: 'Alkoholfrei 0,5 l',   volume: 500,  abv: 0.4,  kcal100: 25 },
  spritzer:    { label: 'Spritzer 0,25 l',     volume: 250,  abv: 6.0,  kcal100: 40 },
  wein:        { label: 'Wein 0,125 l',        volume: 125,  abv: 12,   kcal100: 70 },
  sekt:        { label: 'Sekt 0,1 l',          volume: 100,  abv: 11,   kcal100: 80 },
  schnaps:     { label: 'Schnaps 2 cl',        volume: 20,   abv: 40,   kcal100: 230 },
  longdrink:   { label: 'Longdrink (4 cl)',    volume: 40,   abv: 40,   kcal100: 230 },
};

export const FOOD_STATES = {
  empty: { label: 'Nüchterner Magen', absorbMin: 30, deficit: 0.10 },
  snack: { label: 'Kleinigkeit gegessen', absorbMin: 60, deficit: 0.15 },
  meal:  { label: 'Ordentlich gegessen', absorbMin: 90, deficit: 0.20 },
};

export const ELIMINATION_PER_HOUR = 0.15; // ‰/h, typischer Mittelwert (0,10–0,20)
const ETHANOL_DENSITY = 0.8;              // g/ml
const KM = 0.08;                          // ‰, Halbsättigung des Abbaus (Michaelis-Menten)

export function gramsOfAlcohol(drink) {
  return (drink.qty || 1) * drink.volume * (drink.abv / 100) * ETHANOL_DENSITY;
}
export function kcalOf(drink) {
  return (drink.qty || 1) * (drink.volume / 100) * (drink.kcal100 || 0);
}

// Körperwasser nach Watson (Liter) → Verteilungsfaktor r.
export function distributionFactor({ sex = 'm', weight = 75, height = 178, age = 30 }) {
  const tbwM = 2.447 - 0.09516 * age + 0.1074 * height + 0.3362 * weight;
  const tbwF = -2.097 + 0.1069 * height + 0.2466 * weight;
  const tbw = sex === 'f' ? tbwF : sex === 'd' ? (tbwM + tbwF) / 2 : tbwM;
  // Blut besteht zu ~80 % aus Wasser; 1,055 = Dichte des Blutes.
  const r = (1.055 * tbw) / (0.8 * weight);
  return Math.max(0.4, Math.min(0.9, r));
}

// Simuliert den Blutalkoholverlauf. Rückgabe enthält eine Zeitreihe (alle 5 Min)
// vom ersten Getränk bis zum Wiedererreichen von 0 ‰.
export function simulateBac(profile, drinks, now = Date.now(), opts = {}) {
  const food = FOOD_STATES[profile.food] || FOOD_STATES.snack;
  const beta = opts.beta ?? ELIMINATION_PER_HOUR;
  const vmax = beta * (KM + 0.8) / 0.8; // so skaliert, dass bei 0,8 ‰ genau β abgebaut wird
  const r = distributionFactor(profile);
  const weight = profile.weight || 75;
  const empty = { current: 0, peak: 0, peakAt: null, soberAt: null, series: [], r, totalGrams: 0, totalKcal: 0, below: () => null };
  const list = (drinks || []).filter(d => d && d.volume > 0);
  if (!list.length) return empty;

  const totalGrams = list.reduce((s, d) => s + gramsOfAlcohol(d), 0);
  const totalKcal = list.reduce((s, d) => s + kcalOf(d), 0);
  const t0 = Math.min(...list.map(d => d.timestamp));
  const lastAbsorbEnd = Math.max(...list.map(d => d.timestamp)) + food.absorbMin * 60000;
  const stepMs = 60000;
  const perStep = list.map(d => ({
    from: d.timestamp, to: d.timestamp + food.absorbMin * 60000,
    bacPerMin: (gramsOfAlcohol(d) * (1 - food.deficit)) / (weight * r) / food.absorbMin,
  }));

  let bac = 0, peak = 0, peakAt = t0, current = 0, soberAt = null;
  const series = [];
  const horizon = Math.max(now, lastAbsorbEnd) + 48 * 3600000;
  for (let t = t0, step = 0; t <= horizon; t += stepMs, step++) {
    let inflow = 0;
    for (const p of perStep) if (t >= p.from && t < p.to) inflow += p.bacPerMin;
    // Michaelis-Menten-Abbau: bei üblichen Werten ≈ konstant β, bei sehr niedrigen
    // Werten langsamer (sonst würde ein einzelnes Bier "weggerechnet", bevor es ankommt).
    const elim = (vmax / 60) * bac / (KM + bac);
    bac = Math.max(0, bac + inflow - elim);
    if (bac < 0.004 && t > lastAbsorbEnd) bac = 0;
    if (bac > peak) { peak = bac; peakAt = t; }
    if (t <= now) current = bac;
    if (step % 5 === 0) series.push({ t, bac });
    if (bac === 0 && t > lastAbsorbEnd) { soberAt = t; series.push({ t, bac: 0 }); break; }
  }

  // Zeitpunkt, ab dem der Wert dauerhaft unter `limit` liegt (null = schon jetzt).
  const below = (limit) => {
    let lastAbove = -1;
    for (let i = 0; i < series.length; i++) if (series[i].bac > limit) lastAbove = i;
    if (lastAbove < 0) return null;
    const t = series[lastAbove + 1] ? series[lastAbove + 1].t : series[lastAbove].t + 5 * 60000;
    return t > now ? new Date(t) : null;
  };
  return { current, peak, peakAt: new Date(peakAt), soberAt: soberAt ? new Date(soberAt) : null, series, r, totalGrams, totalKcal, below };
}

export const BAC_STAGES = [
  { max: 0.2, name: 'Nüchtern', tone: 'good', desc: 'Kaum messbare Wirkung.' },
  { max: 0.5, name: 'Angeheitert', tone: 'good', desc: 'Leicht enthemmt, Reaktionszeit beginnt sich zu verlängern.' },
  { max: 1.0, name: 'Beschwipst', tone: 'warn', desc: 'Konzentrations- und Sehstörungen, Selbstüberschätzung. Nicht mehr fahren!' },
  { max: 1.5, name: 'Betrunken', tone: 'warn', desc: 'Gleichgewicht und Sprache leiden deutlich, Reaktionszeit stark verlängert.' },
  { max: 2.0, name: 'Schwer betrunken', tone: 'bad', desc: 'Verwirrtheit, Orientierungslosigkeit, Übelkeit möglich.' },
  { max: 3.0, name: 'Betäubung', tone: 'bad', desc: 'Bewusstseinstrübung, Filmriss, Gleichgewichtsverlust. Ärztliche Hilfe erwägen.' },
  { max: Infinity, name: 'Lebensgefahr', tone: 'bad', desc: 'Gefahr von Bewusstlosigkeit und Atemlähmung — sofort Notruf wählen und die Person nicht allein lassen!' },
];
export function bacStage(bac) { return BAC_STAGES.find(s => bac <= s.max); }
