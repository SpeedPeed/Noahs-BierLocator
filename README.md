# 🍺 Bier-Locator

Eine Web-App, die reale Orte in der Nähe anzeigt, an denen man Bier kaufen kann
(Kneipen, Bars, Biergärten, Supermärkte, Getränkemärkte, Kioske) – inklusive
Preisvergleich, Bewertungen, Favoriten und einem Profil für persönliche
Ansprüche.

## Wichtiger Hinweis zu den Preisen

Es gibt keine offizielle, öffentliche Datenquelle für Bierpreise pro Laden/Kneipe
(anders als z.B. bei Tankstellen). Die **Standorte** kommen live und aktuell von
OpenStreetMap. Die **Preise** werden crowdsourced gepflegt: du (und ggf. andere
Nutzer im selben Browser) tragt Preise ein, jeweils mit Zeitstempel ("gemeldet
vor X Tagen"), damit klar ist, wie aktuell eine Angabe ist.

## Starten

Browser-Geolocation funktioniert aus Sicherheitsgründen nicht bei `file://`.
Daher die App über einen lokalen Server öffnen:

```bash
python -m http.server 8000
```

Danach im Browser öffnen: http://localhost:8000

(Alternative, falls Node installiert ist: `npx serve .`)

## Funktionen

- **Standort**: eigener Standort per Geolocation oder Adresssuche
- **Live-Kartendaten** von OpenStreetMap (Overpass API) – Kneipen, Bars,
  Biergärten, Restaurants, Imbisse, Clubs, Tankstellen, Supermärkte,
  Getränkemärkte, Kioske
- **Preisvergleich**: Preise pro Biersorte melden, automatische Umrechnung auf
  Preis pro 0,5 l zum fairen Vergleich (auch bei Kästen)
- **"Günstigstes Bier in der Nähe"**-Anzeige
- **Profil ("Meine Ansprüche")**: Lieblingssorte, Maximalpreis, bevorzugter
  Umkreis, Biergarten-Präferenz – fließt in den Sortiermodus "Für dich
  empfohlen" ein (inkl. Wetter-Bonus für Biergärten)
- **Filter**: nach Ortstyp, Biersorte, nur mit Preisangabe, nur Favoriten
- **Sortierung**: empfohlen / Entfernung / Preis / Bewertung
- **Bewertungen** (Sterne) und **Favoriten** pro Ort
- **"Jetzt geöffnet"-Schätzung** aus den OSM-Öffnungszeiten (Best-Effort)
- **Live-Wetter** am Standort inkl. Biergarten-Tauglichkeits-Hinweis
- **🚲 Bier-Radtour-Planer**: Start festlegen, optional ein Zielort (sonst
  Rundtour), Wunschlänge in km und Mindestanzahl an Bierorten einstellen –
  die App berechnet eine echte Fahrradroute (OSRM-Routing über reale
  Radwege/Straßen) entlang möglichst passender Bierorte, zeigt sie auf der
  Karte, lässt sich neu würfeln und als GPX für Fahrradcomputer/Komoot/Garmin
  exportieren
- **🧮 Promille-Rechner** (Widmark-Formel, grobe Schätzung, keine Rechtsgrundlage)
- **Routenlink** zu Google Maps
- **Dark/Light Mode**
- **Export/Import** der eigenen Daten (Preise, Bewertungen, Profil) als JSON –
  praktisch für Backup oder Umzug auf ein anderes Gerät, da alles nur lokal im
  Browser (localStorage) gespeichert wird

## Technik

Reines HTML/CSS/JavaScript (kein Build-Schritt), Leaflet.js für die Karte,
OpenStreetMap/Overpass für Orte, Nominatim für Adresssuche, der öffentliche
FOSSGIS-OSRM-Dienst (routing.openstreetmap.de) für die Fahrrad-Routenplanung
und open-meteo.com für das Wetter — alles kostenlos, ohne API-Key. Alle
nutzergenerierten Daten (Preise, Bewertungen, Favoriten, Profil) liegen im
`localStorage` des Browsers – es gibt keinen Server/Backend.
