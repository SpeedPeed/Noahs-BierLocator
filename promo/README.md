# Werbespot & Logo

Fertiges Video: [`bier-locator-werbespot.mp4`](bier-locator-werbespot.mp4) (1080×1920, 60 fps, ca. 24 s, mit Ton).
Gemacht für WhatsApp-Status, Instagram Reels und TikTok und auch ohne Ton verständlich.

Der Stil ist eine 3D-„Knetwelt“, also eine kleine Stadt am See in Bier-Farben (Three.js). Die
Kamera fliegt hindurch, Oberflächen ploppen darüber auf, und zwischendurch sieht man echte
Ausschnitte aus der App im Handy.

| Schläge | Szene |
|---|---|
| 0–4 | „Durst?“: Das Logo wird zum Ring, die Kamera fliegt hindurch (Drop der Musik) |
| 4–10 | „Du bist hier.“: Bier-Pins fallen in Wellen, Preisschilder |
| 10–16 | Preiskarte an der Kneipe: „Gemeldet von Leuten wie dir.“ |
| 16–22 | Schwenk zum Supermarkt, echter App-Ausschnitt (Online-Preise SPAR) |
| 22–30 | Radtour: Route zeichnet sich, Stopps fallen, Sprint aus Fahrerperspektive, „Offen bis 23:00“ |
| 30–36 | Meine Runde: Freunde am Biertisch, echter App-Ausschnitt mit Abrechnung |
| 36–41,5 | Zoom zurück in den Ring, Bier füllt ihn, Logo, Slogan |

## Musik

**„Cool and Crisp (featuring OMB)“ von Ketsa**, Lizenz [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Die Quelle ist [freemusicarchive.org](https://freemusicarchive.org/music/Ketsa/cc-by-free-to-use-for-anything/cool-and-crisp-featuring-omb/).
Die Lizenz verlangt eine Namensnennung. Im Video steht sie klein am Ende. Zusätzlich gehört sie
in die Beschreibung jedes Posts:

> Musik: „Cool and Crisp“ von Ketsa (freemusicarchive.org/music/Ketsa), CC BY 4.0

Die Soundeffekte (Whooshes, Boom, Bläschen, Münzen, Gläser) werden in `audio.py` selbst
synthetisiert.

## Neu bauen

```bash
python scripts/serve.py                 # Terminal 1: App lokal
node promo/record.js                    # Terminal 2: App aufnehmen → promo/build/clips/
node promo/render.js                    # Video bauen → promo/bier-locator-werbespot.mp4 (~25 min)
node promo/render.js --stills 1,5,9     # nur Einzelbilder (Sekunden) zum Prüfen
node promo/render.js --audio-only       # nur die Tonspur
```

Voraussetzungen: Node mit Playwright (Chromium), ffmpeg, python3 mit numpy. Internet wird für
Three.js und die Schriften gebraucht.

- `timeline.json`: Tempo (`bpm`), Musik-Ausschnitt (`music.start` = Sekunde im Track bei
  Videobeginn) und Bildrate. Alle Animationen sind in Schlägen angegeben und bleiben deshalb auf
  dem Takt, auch wenn die Musik wechselt.
- `spot.html`: Ablauf, Kamera, Texte, Oberflächen und Geräusch-Fahrplan. Jedes Bild ist eine
  Funktion der Zeit (`window.seek(t)`).
- `world.js`: die 3D-Stadt (Häuser, See, Bäume, Pins, Radroute).
- `record.js`: nimmt die echte App auf. „Meine Runde“ läuft dabei gegen eine nachgebaute
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
