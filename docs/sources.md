# Preisquellen

Jede Quelle wird vor dem Einbau hier geprüft: Art der Daten, robots.txt und Nutzungsbedingungen,
Bot-Schutz, Abdeckung, Aktualität. Bot-Schutz (Captcha, Cloudflare-Prüfung, Akamai …) wird nie umgangen.
Alle Scraper melden sich mit `Bier-Locator/1.0 (+Repo-Link)` als User-Agent und halten Wartezeiten ein.

## In Betrieb

| Quelle | Land | Art | Abdeckung | Stand / Takt | Läuft |
|---|---|---|---|---|---|
| SPAR, BILLA, MPREIS, PENNY, Lidl | AT | öffentliches JSON der Webshops | SPAR, BILLA, MPREIS komplett, sonst Aktionen | wöchentlich | SPAR nur vom eigenen PC |
| EDEKA (edeka24), ALDI NORD, Kaufland, Lidl, PENNY, trinkgut, Getränke Hoffmann | DE | Webshop-HTML/JSON | EDEKA 24 Biere, sonst Aktionen/Teilsortiment | wöchentlich | PENNY nur vom eigenen PC |
| Migros, ALDI SUISSE, Volg, Denner, Lidl | CH | Webshop-JSON | Migros nur alkoholfrei | wöchentlich | Migros nur vom eigenen PC |
| **cijene.dev** (gesetzliche Preislisten) | **HR** | offenes Tagesarchiv (ZIP mit CSV) | SPAR, Kaufland, Plodine, Tommy, Ribola, Eurospin: ~1.340 Biere | täglich erzeugt, wir holen wöchentlich | GitHub-Job |

### cijene.dev (Kroatien), geprüft 17.11.2026

- **Herkunft:** Seit 2025 müssen Händler in Kroatien ihre Preise täglich pro Filiale veröffentlichen.
  cijene.dev (Open Source) sammelt diese Listen und stellt sie unter `https://api.cijene.dev/v0/list`
  als Tagesarchiv bereit, ohne Anmeldung. Die übrige API (`/v1/…`) braucht einen Schlüssel und wird nicht genutzt.
- **Umfang:** ~130 MB pro Archiv, darin pro Kette `products.csv`, `stores.csv`, `prices.csv`.
- **Was wir daraus machen:** Bier über den Namen (`pivo`, Marken), Median des Preises über alle Filialen
  (meist überall gleich). Verworfen werden Pfand-Zeilen (`DEPOZIT`), Abverkäufe unter der Hälfte des
  ausgewiesenen Normalpreises und Einträge, bei denen Menge im Namen und Literpreis nicht zusammenpassen.
- **Lücken:** Konzum und Lidl fehlen im Archiv. Namen sind Kassensystem-Kürzel („Pitt.Bezalk“).
- **Risiko:** Ein privates Projekt. Fällt es weg, greift der Gesundheitsbericht und die alten Daten bleiben.

## Geprüft und (vorerst) nicht eingebaut

| Quelle | Land | Ergebnis | Grund |
|---|---|---|---|
| Open Prices (Open Food Facts) | weltweit | offene API, ODbL, Preise direkt an OSM-Orten | 1.886 Bierpreise weltweit, davon 1.522 FR, 96 DE (Supermärkte), 0 AT, 1 CH. Zu dünn. Wiederprüfen, wenn es wächst. |
| SPAR Slowenien (online.spar.si) | SI | Cloudflare-Prüfung | Bot-Schutz, bleibt draußen |
| SPAR Ungarn (spar.hu) | HU | Cloudflare Turnstile eingebunden | Bot-Schutz, bleibt draußen |
| Kaufland Filialangebote | CZ, SK, HR, PL | Übersichtsseiten unter den DE-Pfaden nicht vorhanden (404) | eigene Seitenstruktur pro Land, später prüfen |
| REWE, Netto, ALDI SÜD, Coop | DE, CH | Bot-Schutz | bleibt draußen |

## Nächste Kandidaten

- Kaufland-Angebote in CZ/SK über die jeweiligen Länderseiten (gleiche Technik wie DE, andere Pfade).
- Lidl-Onlineshops in CZ/SK/PL (gleiche Such-API wie lidl.de, falls ohne Bot-Schutz).
- Italien/Südtirol: Webshops von Despar/Eurospar (gleiche SPAR-Plattform wie AT?) prüfen.
