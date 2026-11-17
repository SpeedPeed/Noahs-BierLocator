// Alles Länderspezifische an einer Stelle: Währung, Feiertage, Promillegrenzen, Notruf (Stand 2026, ohne Gewähr).
// Ein neues Land = ein Eintrag hier (und, wenn es eine neue Währung hat, einer in CURRENCIES).
import { t } from './i18n.js';

// Plausible Preise werden in Euro gedacht und mit `perEuro` in die Landeswährung umgerechnet.
// Grob gerundet, keine Tageskurse: die Grenzen sind weit genug. Gleiche Werte in supabase/006_waehrung.sql.
export const CURRENCIES = {
  EUR: { perEuro: 1 },
  CHF: { perEuro: 1 },   // Franken ~ Euro; Schweizer Kneipenpreise liegen trotzdem klar unter der Obergrenze
};

// Feiertage: fest als 'M-T', bewegliche als Tage ab Ostersonntag.
export const COUNTRIES = {
  AT: {
    name: t('Österreich'),
    currency: 'EUR',
    holidays: { fixed: ['1-1', '1-6', '5-1', '8-15', '10-26', '11-1', '12-8', '12-25', '12-26'], easter: [1, 39, 50, 60] },
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
    currency: 'EUR',
    holidays: { fixed: ['1-1', '5-1', '10-3', '12-25', '12-26'], easter: [-2, 1, 39, 50] },
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
    currency: 'CHF',
    holidays: { fixed: ['1-1', '8-1', '12-25', '12-26'], easter: [-2, 1, 39, 50] },
    emergency: '144',
    emergencyLabel: t('Sanität 144 · Notruf 112'),
    car: [
      { bac: 0.1, label: t('Neulenker (Ausweis auf Probe) & Berufsfahrer') },
      { bac: 0.5, label: t('Angetrunkenheit (Busse)') },
      { bac: 0.8, label: t('Qualifizierte Angetrunkenheit (Ausweisentzug)') },
    ],
    bike: { bac: 0.5, label: t('Gilt auch auf dem Velo') },
  },
  HR: {
    name: t('Kroatien'),
    currency: 'EUR',
    holidays: { fixed: ['1-1', '1-6', '5-1', '5-30', '6-22', '8-5', '8-15', '11-1', '11-18', '12-25', '12-26'], easter: [0, 1, 60] },
    emergency: '112',
    emergencyLabel: t('Notruf 112 · Rettung 194'),
    car: [
      { bac: 0.0, label: t('Unter 24 Jahren & Berufsfahrer: absolutes Alkoholverbot') },
      { bac: 0.5, label: t('Allgemeine Grenze Auto') },
    ],
    bike: { bac: 0.5, label: t('Gilt auch auf dem Fahrrad') },
  },
};

export function countryInfo(code) {
  return COUNTRIES[code] || COUNTRIES.DE;
}
export const currencyFor = code => countryInfo(code).currency;

export function guessCountryFromLocale() {
  const lang = (navigator.language || '').toUpperCase();
  if (lang.endsWith('-AT')) return 'AT';
  if (lang.endsWith('-CH')) return 'CH';
  if (lang.endsWith('-DE')) return 'DE';
  return 'AT';
}
