// Abzeichen (DOM-frei, getestet in tests/): werden aus Tagebuch, gefahrenen Touren
// und gemeldeten Preisen berechnet — nichts davon muss extra gespeichert werden.

export const BADGES = [
  { id: 'beer1',    icon: 'beerMug',  title: 'Erstes Bier',        desc: 'Ein Bier im Tagebuch',            metric: 'beers',     goal: 1 },
  { id: 'beer10',   icon: 'beerMug',  title: 'Zehnerl',            desc: '10 Biere eingetragen',            metric: 'beers',     goal: 10 },
  { id: 'beer50',   icon: 'beerMug',  title: 'Stammgast',          desc: '50 Biere eingetragen',            metric: 'beers',     goal: 50 },
  { id: 'beer100',  icon: 'flame',    title: 'Bierlegende',        desc: '100 Biere eingetragen',           metric: 'beers',     goal: 100 },
  { id: 'sorts5',   icon: 'tag',      title: 'Neugierig',          desc: '5 verschiedene Sorten',           metric: 'sorts',     goal: 5 },
  { id: 'sorts15',  icon: 'tag',      title: 'Sortenkenner',       desc: '15 verschiedene Sorten',          metric: 'sorts',     goal: 15 },
  { id: 'sorts30',  icon: 'star',     title: 'Biersommelier',      desc: '30 verschiedene Sorten',          metric: 'sorts',     goal: 30 },
  { id: 'places5',  icon: 'pin',      title: 'Unterwegs',          desc: 'In 5 Lokalen eingecheckt',        metric: 'places',    goal: 5 },
  { id: 'places20', icon: 'map',      title: 'Kneipentourist',     desc: 'In 20 Lokalen eingecheckt',       metric: 'places',    goal: 20 },
  { id: 'brew1',    icon: 'barrel',   title: 'Brauerei-Besuch',    desc: 'In einer Brauerei eingecheckt',   metric: 'breweries', goal: 1 },
  { id: 'brew10',   icon: 'barrel',   title: 'Brauerei-Jäger',     desc: '10 verschiedene Brauereien',      metric: 'breweries', goal: 10 },
  { id: 'garden5',  icon: 'tree',     title: 'Biergarten-Saison',  desc: '5 Biere im Biergarten',           metric: 'gardens',   goal: 5 },
  { id: 'tour1',    icon: 'bike',     title: 'Erste Biertour',     desc: 'Eine Radtour gefahren',           metric: 'tours',     goal: 1 },
  { id: 'tour5',    icon: 'bike',     title: 'Tourenfahrer',       desc: '5 Radtouren gefahren',            metric: 'tours',     goal: 5 },
  { id: 'km50',     icon: 'route',    title: 'Kilometerfresser',   desc: '50 km auf Biertouren',            metric: 'km',        goal: 50 },
  { id: 'km250',    icon: 'route',    title: 'Bier-Pedaleur',      desc: '250 km auf Biertouren',           metric: 'km',        goal: 250 },
  { id: 'group1',   icon: 'users',    title: 'Gesellig',           desc: 'Eine Tour mit Freunden',          metric: 'groupTours', goal: 1 },
  { id: 'dach',     icon: 'globe',    title: 'DACH-Tour',          desc: 'Bier in AT, DE und CH',           metric: 'countries', goal: 3 },
  { id: 'price1',   icon: 'coin',     title: 'Preis-Scout',        desc: 'Einen Preis gemeldet',            metric: 'prices',    goal: 1 },
  { id: 'price25',  icon: 'coin',     title: 'Preis-Detektiv',     desc: '25 Preise gemeldet',              metric: 'prices',    goal: 25 },
  { id: 'early',    icon: 'sun',      title: 'Frühschoppen',       desc: 'Ein Bier vor 11 Uhr',             metric: 'early',     goal: 1 },
  { id: 'af3',      icon: 'droplet',  title: 'Vernünftig',         desc: '3 Alkoholfreie oder Radler',      metric: 'light',     goal: 3 },
  { id: 'bingo',    icon: 'checkCircle', title: 'Bingo!',          desc: 'Eine Bingo-Reihe voll',           metric: 'bingos',    goal: 1 },
];

const LIGHT = /alkoholfrei|alkoholarm|0[.,]0|radler|alster/i;

// data: { diary: [entry], tours: [tour], stats: { prices, bingos } }
export function metrics({ diary = [], tours = [], stats = {} }) {
  const live = diary.filter(e => !e.deleted);
  const sorts = new Set(live.map(e => e.beer.trim().toLowerCase()));
  const places = new Set(live.filter(e => e.placeId || e.placeName).map(e => e.placeId || e.placeName));
  const breweries = new Set(live.filter(e => e.type === 'brewery').map(e => e.placeId || e.placeName));
  const countries = new Set([...live.map(e => e.country), ...tours.map(t => t.country)].filter(Boolean));
  const ridden = tours.filter(t => !t.deleted);
  return {
    beers: live.length,
    sorts: sorts.size,
    places: places.size,
    breweries: breweries.size,
    gardens: live.filter(e => e.type === 'biergarten').length,
    tours: ridden.length,
    km: Math.round(ridden.reduce((s, t) => s + (t.km || 0), 0)),
    groupTours: ridden.filter(t => t.mates && t.mates.length).length,
    countries: countries.size,
    prices: stats.prices || 0,
    early: live.filter(e => { const h = new Date(e.at).getHours(); return h >= 5 && h < 11; }).length,
    light: live.filter(e => LIGHT.test(e.beer)).length,
    bingos: stats.bingos || 0,
  };
}

// → [{ …badge, value, unlocked, pct }]
export function evaluateBadges(data) {
  const m = metrics(data);
  return BADGES.map(b => {
    const value = m[b.metric] || 0;
    return { ...b, value, unlocked: value >= b.goal, pct: Math.min(1, value / b.goal) };
  });
}
