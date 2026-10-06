// Länderspezifische Grenzwerte & Notrufnummern (Stand 2026, ohne Gewähr).
export const COUNTRIES = {
  AT: {
    name: 'Österreich',
    emergency: '144',
    emergencyLabel: 'Rettung 144 · Euronotruf 112',
    car: [
      { bac: 0.1, label: 'Probeführerschein, Lkw/Bus/Taxi' },
      { bac: 0.5, label: 'Allgemeine Grenze Auto' },
      { bac: 0.8, label: 'Höhere Strafe, Führerscheinentzug' },
    ],
    bike: { bac: 0.8, label: 'Grenze Fahrrad & E-Scooter' },
  },
  DE: {
    name: 'Deutschland',
    emergency: '112',
    emergencyLabel: 'Notruf 112',
    car: [
      { bac: 0.0, label: 'Probezeit & unter 21: absolutes Alkoholverbot' },
      { bac: 0.5, label: 'Ordnungswidrigkeit Auto' },
      { bac: 1.1, label: 'Absolute Fahruntüchtigkeit (Straftat)' },
    ],
    bike: { bac: 1.6, label: 'Fahrrad: absolute Fahruntüchtigkeit (ab 0,3 ‰ mit Ausfallerscheinungen strafbar)' },
  },
  CH: {
    name: 'Schweiz',
    emergency: '144',
    emergencyLabel: 'Sanität 144 · Notruf 112',
    car: [
      { bac: 0.1, label: 'Neulenker (Ausweis auf Probe) & Berufsfahrer' },
      { bac: 0.5, label: 'Angetrunkenheit (Busse)' },
      { bac: 0.8, label: 'Qualifizierte Angetrunkenheit (Ausweisentzug)' },
    ],
    bike: { bac: 0.5, label: 'Gilt auch auf dem Velo' },
  },
};

export function countryInfo(code) {
  return COUNTRIES[code] || COUNTRIES.DE;
}

export function guessCountryFromLocale() {
  const lang = (navigator.language || '').toUpperCase();
  if (lang.endsWith('-AT')) return 'AT';
  if (lang.endsWith('-CH')) return 'CH';
  if (lang.endsWith('-DE')) return 'DE';
  return 'AT';
}
