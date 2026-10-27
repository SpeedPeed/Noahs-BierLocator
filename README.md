<p align="center"><img src="icons/logo.svg" width="128" alt="Bier-Locator Logo"></p>

# Bier-Locator

Findet Kneipen, Gasthäuser, Biergärten, Brauereien und Läden in der Nähe,
vergleicht Bierpreise und plant **gleichmäßige Fahrrad-Biertouren**. Gemacht fürs
Handy (installierbar als App), funktioniert aber auch am PC.

## Funktionen

**Bier finden**
- Vollbild-Karte mit farbigen Markern je Ortstyp, Preis-Etikett und Gruppierung bei vielen Orten
- Suche mit Vorschlägen (Orte, Adressen, Lokale) oder GPS-Standort
- „In diesem Bereich suchen“, nachdem man die Karte verschoben hat
- Filter: Ortstypen (Doppeltipp = nur dieser Typ), *Jetzt offen*, *Mit Preis*, *Favoriten*, Sorte
- Sortierung „Für dich“ (Entfernung, Preis, Bewertung, Öffnung, Wetter, Vorlieben)
- **Gasthäuser & Wirtshäuser** werden erkannt, obwohl sie in OSM als „Restaurant“ eingetragen sind
- Detailansicht: Wochenplan der Öffnungszeiten (inkl. Feiertage AT/DE/CH), Route, Anrufen, Website, Teilen

**Preise & Bewertungen**
- Preise melden mit Live-Prüfung: unrealistische Preise (z.B. 0,05 € oder 50 € für 0,5 l) lassen sich gar nicht abschicken
- Umrechnung auf €/0,5 l (auch Maß und Kästen), Preise älter als 180 Tage werden ausgegraut
- Eine Bewertung pro Gerät, jederzeit änderbar; eigene Preise löschbar
- Optional **für alle geteilt** über Supabase (siehe unten), sonst lokal im Browser

**Bier-Radtour**
- Rundtour oder von A nach B, Wunschlänge, Anzahl Stopps, Startzeit, Pause pro Stopp
- Fahrstil: *Ausgewogen*, *Ruhig & sicher*, *Zügig* (BRouter-Profile)
- **Gleichmäßig verteilte Stopps** — keine Klumpen mehr (siehe „Wie die Tourplanung funktioniert“)
- Nur Orte, die zur **geschätzten Ankunftszeit geöffnet** haben
- Zeitplan mit Ankunft/Abfahrt, Höhenprofil (Hover zeigt die Stelle auf der Karte), Wetter während der Tour
- Einzelne Stopps tauschen oder entfernen, „Andere Route“, GPX-Export, Google Maps, Teilen per Link
- Promille-Hochrechnung „1 Bier pro Stopp“ im Vergleich zur Fahrrad-Grenze des Landes

- **Thema & Extras** (eingeklappt): *Brauereien*, *Biergärten*, *Günstig*, *Bunt gemischt*;
  „Anstiege nicht am Ende“ fährt die Runde andersrum, wenn sonst nach den Bieren die Höhenmeter kommen;
  „Wetter & Wind“ plant mit der Vorhersage (Biergärten bei Sonne, drinnen bei Regen, Rückenwind auf dem Heimweg)
- **Live-Tour** („Los geht's“): GPS-Position auf der Route, nächster Stopp mit Entfernung & Ankunft,
  Verspätung zum Plan, automatisches Erkennen von Ankunft/Abfahrt, Warnung + Ersatzvorschlag, wenn ein
  späterer Stopp dann schon zu hat. Bildschirm bleibt an, läuft nach dem Neuladen weiter.
- **Heimweg**: ruhigste Radroute nach Hause, zurück zum Start oder zum nächsten Bahnhof (mit Öffi-Link);
  warnt, wenn man laut Promille-Rechner über der Fahrrad-Grenze liegt
- **Meine Touren**: gefahrene Touren mit Spur, Stopps, Mitfahrenden — „Nochmal fahren“ mit einem Tipp

**Mit Freunden („Meine Runde“)**
- Bestenliste (Biere, Abzeichen, Preise, Tour-km), Biere zählen
- Live-Standort der anderen auf der Karte — nur wer es selbst einschaltet, verfällt nach 15 Minuten
- Runden eintragen und **Abrechnung** mit möglichst wenigen Überweisungen
- **Abstimmung über den nächsten Stopp** (der Ersteller übernimmt den Gewinner für alle)

**Spaß**
- **Abzeichen** (23 Stück, aus Tagebuch, Touren, Preisen & Bingo)
- **Bier-Bingo** für unterwegs (gleiche Karte für die ganze Runde)
- **Überrasch mich**: Glücksrad wählt ein offenes Lokal in der Nähe
- **Jahresrückblick** „Mein Bier-Jahr“ als teilbares Bild (im Dezember gibt's einen Hinweis)

**Preise, mehr**
- **Preis-Heatmap** (Menü): grün = günstig, rot = teuer
- **Getränkekarte fotografieren**: Texterkennung schlägt Preise vor, gemeldet wird nur, was man abhakt
- **Lieblingsbier im Angebot**: Lieblingssorte eintragen → Aktionen in Filialen in der Nähe erscheinen

**Promille-Rechner**
- Körperwasser nach Watson (Geschlecht, Gewicht, Größe, Alter), Resorption je Getränk, Michaelis-Menten-Abbau
- Verlaufsdiagramm, Zeitpunkte „unter 0,5 ‰“ / „wieder nüchtern“, Grenzwerte für AT, DE und CH

## Wie die Tourplanung funktioniert

Früher wurden Stopps „irgendwo in jeder Himmelsrichtung“ gesucht und danach gegen
nähere getauscht — dadurch lagen oft drei Orte auf einem Fleck und dann kam eine
lange Leerfahrt. Jetzt gilt **Form zuerst, Orte danach** (`js/tour/planner.js`):

1. Es wird eine ideale Tourform erzeugt (Kreis/Oval durch den Start oder ein Bogen
   von A nach B) und darauf werden die Stopps als **exakt gleich weit auseinander
   liegende Ankerpunkte** verteilt.
2. Jeder Anker bekommt den passendsten Bierort in seiner Nähe (mit Mindestabstand
   zwischen den Stopps, Bevorzugung guter Lokale, Öffnung zur Ankunftszeit).
3. Hunderte Varianten (Drehung, Form, Größe) werden ohne Netzwerkanfragen bewertet:
   Gleichmäßigkeit der Etappen, Länge, Kreuzungen, Spitzkehren.
4. Nur die besten Kandidaten werden mit BRouter geroutet; der gemessene Umwegfaktor
   der echten Straßen kalibriert die nächste Runde, bis die Wunschlänge (±8 %) passt.
   Doppelt gefahrene Strecke (Stichstraßen) wird bestraft.

Gibt die Gegend die gewünschte Anzahl gleichmäßig verteilter Stopps nicht her,
sagt die App das ehrlich und schlägt eine passende Anzahl vor.

## Android-App

**[APK herunterladen](https://github.com/SpeedPeed/Noahs-BierLocator/releases/latest)** — am Handy öffnen und
installieren. Die App ist eine *Trusted Web Activity*: Sie zeigt die Live-Website im Vollbild
(ohne Browserleiste) und ist daher immer automatisch aktuell. Die Verknüpfung App ↔ Website
läuft über `https://speedpeed.github.io/.well-known/assetlinks.json` (Repo `speedpeed.github.io`).

Neue APK nötig ist nur bei Änderungen an Name, Icon oder Paket. Dafür den Signaturschlüssel
aus `Documents/BierLocator-Schluessel` verwenden (gleiches Paket `io.github.speedpeed.bierlocator`,
höhere `appVersionCode`) — **dieser Schlüssel darf nie verloren gehen**, sonst lassen sich
Updates nicht mehr über die bestehende App installieren.

## Geräte-Sync, Tagebuch, Preisalarme, Gruppen-Touren

Diese Funktionen brauchen zusätzlich [`supabase/002_features.sql`](supabase/002_features.sql)
(einmal im Supabase SQL-Editor ausführen). „Meine Runde“ mit Live-Standort, Abrechnung und Abstimmung
braucht zusätzlich [`supabase/003_runde.sql`](supabase/003_runde.sql) — ohne läuft die Gruppe wie bisher
(Biere zählen, Stopps bewerten). Preisalarme per Push verschickt der GitHub-Job
„Preisalarme verschicken“ nach jedem Preis-Update; er braucht die Secrets `ALERTS_TOKEN`
und `VAPID_PRIVATE_KEY`.

## Starten (lokal)

Standortbestimmung funktioniert nur über `https://` oder `localhost`:

```bash
python scripts/serve.py
```

Dann <http://localhost:8000> öffnen. (`python -m http.server` geht auch, cached aber
Dateien hartnäckig im Browser.)

**Tests:** <http://localhost:8000/tests/> öffnen — testet Öffnungszeiten-Parser,
Promille-Modell, Preisprüfung, Tourplaner und Tour-Links direkt im Browser.

## Veröffentlichen mit GitHub Pages

1. Auf GitHub im Repo: **Settings → Pages → Build and deployment → Source: „Deploy from a branch“**,
   Branch `main`, Ordner `/ (root)` → Save.
2. Nach ~1 Minute läuft die App unter `https://<benutzername>.github.io/<repo>/`.
3. Am Handy öffnen → „Zum Startbildschirm hinzufügen“ → läuft wie eine App.

## Geteilte Preise & Bewertungen (Supabase, kostenlos)

Ohne Einrichtung bleiben Preise/Bewertungen nur auf dem jeweiligen Gerät. Damit
alle dieselben Daten sehen:

1. Kostenloses Konto auf <https://supabase.com> anlegen → **New project**.
2. Im Projekt: **SQL Editor → New query**, den kompletten Inhalt von
   [`supabase/schema.sql`](supabase/schema.sql) einfügen → **Run**.
3. **Project Settings → API**: *Project URL* und den *anon / publishable key* kopieren.
4. In [`js/config.js`](js/config.js) eintragen:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ…'; // oder sb_publishable_…
   ```
5. Committen & pushen — fertig. Der Key ist öffentlich gedacht; die Datenbank
   lässt nur geprüfte Schreibzugriffe über ihre Funktionen zu.

Sicherheit ohne Login: Jedes Gerät hat eine zufällige geheime ID, gespeichert wird
nur ihr Hash. Damit zählt pro Gerät und Ort eine Bewertung, eigene Preise lassen
sich löschen, und es gibt ein Tageslimit gegen Spam. Lokal gemeldete Preise werden
beim ersten Start im Community-Modus automatisch hochgeladen.

## Online-Preise der Supermarktketten

Rund **1.650 Bierpreise** aus den Online-Sortimenten der Ketten. Jede Filiale zeigt die
Preise ihrer Kette als „Online-Preis · Stand …“ (durchsuchbar, mit Link zum Produkt);
Community-Meldungen haben Vorrang. Aktionen erscheinen erst ab ihrem Start und
verschwinden nach ihrem Ende von selbst.

| Land | Komplettes Sortiment | Nur Aktionen / Teilsortiment | Händisch (Shop gesperrt) |
|---|---|---|---|
| AT | SPAR/EUROSPAR/INTERSPAR, BILLA/BILLA PLUS, MPREIS | PENNY, Lidl | HOFER |
| DE | EDEKA (edeka24), ALDI NORD | Kaufland, Lidl (Partyfässer), PENNY, trinkgut, Getränke Hoffmann | ALDI SÜD, Netto |
| CH | Migros (nur alkoholfrei), ALDI SUISSE, Volg | Denner, Lidl | Coop |

Ohne Online-Preise: Sutterlüty, ADEG, Nah&Frisch (nur PDF-/Bild-Flugblätter), REWE und
SPAR Schweiz. Bot-Schutz (Captchas o. ä.) wird bewusst nicht umgangen.

**Aktualisieren** (dauert ein paar Minuten, braucht `curl`):

```bash
python scripts/scrape_prices.py
```

Holt alle Ketten neu (`scripts/scrapers/<land>_<kette>.py`), schreibt `data/sources/auto-*.json`
und baut `data/chain-prices.json`. Einzelne Ketten: `python scripts/scrape_prices.py at_spar at_billa`.
Jeder Eintrag wird auf Plausibilität geprüft (z.B. keine Einzeldose über 5 €).

## Technik

Reines HTML/CSS/JavaScript mit ES-Modulen — **kein Build-Schritt**.

```
index.html, styles.css, sw.js, manifest.json
js/
  main.js          Einstieg, Verdrahtung
  config.js        Server-Adressen, Supabase-Zugang
  places.js        Overpass-Abfrage (mehrere Server, Cache), Ortstypen
  openingHours.js  opening_hours-Parser inkl. Feiertage AT/DE/CH
  community.js     Preise & Bewertungen (Supabase oder lokal)
  prices.js        Gebinde, Umrechnung, Plausibilitätsprüfung
  bac.js, legal.js Promille-Modell, Grenzwerte je Land
  tour/            planner.js (Geometrie, Wind), tourPlan.js (Steuerung), routing.js (BRouter/OSRM),
                   live.js (GPS auf der Route, Zeitplan unterwegs)
  settle.js, bingo.js, badges.js, heatmap.js   Abrechnung, Bingo, Abzeichen, Preis-Heatmap
  ui/              Sheet, Liste, Detail, Tour, Live, Heimweg, Runde, Tagebuch, Spiele, Promille, Suche
supabase/schema.sql   Datenbank für geteilte Preise (+ 002_features.sql, 003_runde.sql)
tests/                Browser-Tests
```

Datenquellen (alle ohne API-Key): OpenStreetMap/Overpass (Orte), OSM-Kacheln
(Karte), Photon/Komoot (Suche), BRouter (Radrouten, Fallback OSRM/FOSSGIS),
Open-Meteo (Wetter).

*Bitte verantwortungsvoll trinken — wer trinkt, fährt nicht. Auch nicht mit dem Rad.*
