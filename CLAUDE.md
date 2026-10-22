# Bier-Locator — Hinweise für Claude

Private Spaß-App für mich und Freunde (DACH), fast nur am Handy benutzt. Live unter
https://speedpeed.github.io/Noahs-BierLocator (GitHub Pages aus `main`, Root-Ordner) und als
Android-App (TWA, zeigt die Live-Seite). **Alles, was auf `main` landet, ist sofort live.**

## Arbeitsweise
- Mit mir auf **Deutsch** kommunizieren. Details darfst du selbst entscheiden.
- **Oberfläche nicht überladen**: Neue Funktionen hinter Menü, eingeklappte Bereiche oder „Mehr“,
  keine neuen dauerhaft sichtbaren Knöpfe.
- Reines HTML/CSS/JS mit ES-Modulen, **kein Build-Schritt**. Keine Frameworks einführen.
- Neue/umbenannte JS-Dateien in `sw.js` (`SHELL_FILES`) eintragen und `VERSION` erhöhen.
- Lokal starten: `python scripts/serve.py` → http://localhost:8000, Tests: http://localhost:8000/tests/
  (DOM-freie Logik bekommt Tests in `tests/run.js`).

## Was wichtig ist
- **Gleichmäßige, schöne Radtouren** haben oberste Priorität (`js/tour/`). Änderungen am Planer gegen
  echtes Routing (BRouter) prüfen, nicht nur gegen die synthetischen Tests.
- **Datenehrlichkeit**: Unrealistische Preise dürfen sich nicht melden lassen (`js/prices.js`, gleiche
  Grenzen serverseitig in `supabase/schema.sql`). Texterkennung/Scanner schlagen nur vor.
- Bot-Schutz von Shops (Coop, REWE, ALDI SÜD, Netto …) **nie umgehen**.

## Supabase
Läuft (schema.sql, 002_features.sql, 003_runde.sql sind ausgeführt). Neue SQL-Dateien führe ich selbst im
Supabase SQL-Editor aus — nummeriert ablegen (`004_….sql`), mehrfach ausführbar schreiben, und die App muss
ohne das Update weiter funktionieren. Der anon-Key in `js/config.js` ist öffentlich gedacht.

## Nicht im Repo (nur auf meinem PC)
- Geheimnisse (APK-Signaturschlüssel, VAPID-Privatschlüssel, Alarm-Token) — liegen außerhalb des Repos und als
  GitHub-Secrets. **Niemals ins Repo schreiben.** Das Repo ist öffentlich.
- Wöchentliches Preis-Update für SPAR/Migros/PENNY DE läuft als geplante Aufgabe auf meinem Windows-PC
  (`scripts/local_update.ps1`), weil diese Shops GitHub-Server blocken. Der Rest läuft als GitHub Action.
