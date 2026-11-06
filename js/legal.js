// Länderspezifische Grenzwerte & Notrufnummern (Stand 2026, ohne Gewähr).
import { t } from './i18n.js';
export const COUNTRIES = {
  AT: {
    name: t('Österreich'),
    emergency: '144',
    emergencyLabel: t('Rettung 144 · Euronotruf 112'),
    car: [
      { bac: 0.1, label: t('Probeführerschein, Lkw/Bus/Taxi') },
      { bac: 0.5, label: t('Allgemeine Grenze Auto') },
      { bac: 0.8, label: t('Höhere Strafe, Führerscheinentzug') },
    ],
    bike: { bac: 0.8, label: t('Grenze Fahrrad & E-Scooter') },
  },
  DE: {
    name: t('Deutschland'),
    emergency: '112',
    emergencyLabel: t('Notruf 112'),
    car: [
      { bac: 0.0, label: t('Probezeit & unter 21: absolutes Alkoholverbot') },
      { bac: 0.5, label: t('Ordnungswidrigkeit Auto') },
      { bac: 1.1, label: t('Absolute Fahruntüchtigkeit (Straftat)') },
    ],
    bike: { bac: 1.6, label: t('Fahrrad: absolute Fahruntüchtigkeit (ab 0,3 ‰ mit Ausfallerscheinungen strafbar)') },
  },
  CH: {
    name: t('Schweiz'),
    emergency: '144',
    emergencyLabel: t('Sanität 144 · Notruf 112'),
    car: [
      { bac: 0.1, label: t('Neulenker (Ausweis auf Probe) & Berufsfahrer') },
      { bac: 0.5, label: t('Angetrunkenheit (Busse)') },
      { bac: 0.8, label: t('Qualifizierte Angetrunkenheit (Ausweisentzug)') },
    ],
    bike: { bac: 0.5, label: t('Gilt auch auf dem Velo') },
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
