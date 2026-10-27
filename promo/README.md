# Werbespot & Logo

Fertiges Video: [`bier-locator-werbespot.mp4`](bier-locator-werbespot.mp4) (1080×1920, 24 s, mit Ton).
Gemacht für WhatsApp-Status, Instagram Reels und TikTok und auch ohne Ton verständlich.

| Zeit | Szene | Inhalt |
|---|---|---|
| 0–2 s | Einstieg | „6,50 € für EIN Bier?!“ → durchgestrichen → „Geht auch billiger.“ |
| 2–8 s | Bier finden | Echte Karte (Bregenz), günstigstes Bier, Online-Preise bei Spar |
| 8–14 s | Bier-Radtour | Tour planen → Route mit gleichmäßig verteilten Stopps |
| 14–20 s | Meine Runde | Bestenliste, ein Bier mehr, Abrechnung „wer schuldet wem“ |
| 20–24 s | Logo | Pin füllt sich mit Bier, „Bier-Locator“ + Slogan |

Musik und Geräusche (Umpa-Beat mit 120 BPM, Kronkorken, Kasse, Einschenken, Anstoßen) werden
in `audio.py` selbst erzeugt. Sie sind lizenzfrei, die Szenenwechsel liegen auf dem Takt.

## Neu bauen

```bash
python scripts/serve.py                 # Terminal 1: App lokal
node promo/record.js                    # Terminal 2: App aufnehmen → promo/build/clips/
node promo/render.js                    # Video bauen → promo/bier-locator-werbespot.mp4
node promo/render.js --stills 1,5,9     # nur Einzelbilder zum Prüfen
```

Voraussetzungen: Node mit Playwright (Chromium), ffmpeg, python3 mit numpy.

- **Texte, Timing und Schnitte** stehen in `timeline.json`. `segments` bildet die Videozeit auf
  die Aufnahmezeit ab: `[von, bis, aufnahmeVon, aufnahmeBis]`.
- **Gestaltung** liegt in `spot.html`. Jedes Bild ist eine Funktion der Zeit (`window.seek(t)`).
- `record.js` nimmt die echte App auf. „Meine Runde“ läuft dabei gegen eine nachgebaute
  Demo-Gruppe, die Supabase-Aufrufe werden abgefangen. Falls die Overpass-Server nicht
  erreichbar sind: `OVERPASS_URL=https://overpass.osm.ch/api/interpreter node promo/record.js`.

## Logo

Ein Standort-Pin, gefüllt mit Bier, Schaumkrone oben und zwei Bläschen. Die einzige Quelle ist
`scripts/gen_icons.js`. Es erzeugt `icons/logo.svg`, `icons/icon.svg`, alle PNG-Icons sowie:

- `brand/logo-1024.png`: Logo freigestellt
- `brand/play-store-icon-512.png`: fürs APK bzw. den Store (Android-App neu bauen, damit das Icon dort ankommt)
- `brand/social-preview.png`: GitHub → Settings → General → *Social preview* hochladen

```bash
node scripts/gen_icons.js
```
