# Bier-Locator: Leitlinie

Eine Seite. Wer etwas baut oder textet, prüft es hiergegen.

## Persönlichkeit

Ein guter Stammwirt. Kennt die Gegend, sagt ehrlich, was er weiß und was nicht, hat trockenen Humor
und redet nicht zu viel. Nie albern, nie Werbung, nie belehrend. Wenn er nichts weiß, sagt er das.

## Stimme

- **Kurz und konkret.** Erst die Antwort, dann höchstens ein Grund. Kein Satz erklärt die App.
- **Du-Form, Präsens, aktiv.** „Hat bis 2 offen“ statt „Dieses Lokal ist bis 02:00 Uhr geöffnet“.
- **Zahlen sprechen.** „4 Min zu Fuß“, „Halbe 4,80 €“, „zu in 20 Min“.
- **Humor höchstens einmal pro Bildschirm,** nie in Fehlern, nie bei Promille und Heimweg.
- **Keine Emojis, keine Ausrufezeichen-Ketten, keine Gedankenstrich-Einschübe, keine Klammern in Schaltern.**
  Was eine Klammer bräuchte, ist entweder überflüssig oder gehört in den Namen des Schalters.
- **Englisch** wird neu geschrieben, nicht übersetzt: britisch, trocken, gleiche Länge.

| Situation | So | Nicht so |
|---|---|---|
| Laden | Schau mich um … | Suche Bier in der Nähe… |
| Leer | Hier ist nichts. Weiter weg schauen? | Keine Treffer. Die Filter sind gerade sehr streng — … |
| Fehler | Die Kartenserver streiken gerade. Nochmal? | Das hat nicht geklappt. |
| Offline | Kein Netz. Das hier ist von vorhin. | |
| Bestätigung | Gemeldet. Danke. | Preis gemeldet — danke! 🍻 |
| Kein Preis | Noch kein Preis. Was kostet’s dort? | Sei die erste Person! |
| Kontext | Biergärten vorn, weil die Sonne scheint. | Biergartenwetter! |

### Begriffe (immer gleich)

| Begriff | Bedeutung | Englisch |
|---|---|---|
| Halbe | 0,5 l, die Vergleichsgröße im Fließtext und auf Preisschildern | half-litre |
| 0,5 l / 0,33 l | nur in der Gebinde-Auswahl und in Produktzeilen | 0.5 l / 0.33 l |
| Bierort | Kneipe, Biergarten, Brauerei, Gasthaus | beer spot |
| Laden | Supermarkt, Getränkemarkt, Kiosk/Späti, Tankstelle | shop |
| Online-Preis | Preis aus dem Webshop einer Kette, immer mit Stand | online price |
| gemeldet | Preis von jemandem vor Ort | reported |
| Stopp | Halt auf einer Tour | stop |
| Runde | die Freundesgruppe | crew |

Regionale Wörter (Krügerl, Seidl, Stange, Späti, Beisl) nur dort, wo das Land des Ortes sie spricht,
und nur als Bezeichnung, nicht als Witz.

## Bildsprache

Zwei Signaturen, sonst nichts:

1. **Der Bierdeckel.** Jeder Preis sitzt auf einem runden Deckel mit feinem Doppelrand: auf der Karte,
   in der Liste, im Detail. Gemeldete Preise voll in Bernstein, Online-Preise nur als Rand, alte blass.
   Wer Bernstein auf einem Deckel sieht, weiß: Das ist ein Preis. Cluster sind ein Stapel leerer
   Deckel in Papierfarbe, damit Bernstein nichts anderes bedeutet.
2. **Die Schaumkrone.** Eine einzige Wellenlinie als Oberkante des Sheets, als Füllstand beim Laden
   und als Fortschritt auf der Tour. Schaum bedeutet immer: Hier tut sich etwas.

Alles andere ist flach und ruhig: Flächen in `--panel`, Trennung durch Linien statt Schatten,
kein Verlauf außer im Bier des Logos und des Laders.

### Tokens

| | Werte |
|---|---|
| Abstand | 4, 8, 12, 16, 24, 32 |
| Radius | 8 (Felder, Etiketten), 14 (Zeilen, Karten), 24 (Sheet, Dialog). Pille nur für Chips und Schalter |
| Schatten | 1 (liegt auf), 2 (schwebt: Kopfzeile, Marker), 3 (darüber: Dialog, Toast) |
| Icons | 16 im Text, 20 in Knöpfen. Strich 1,75 |
| Tippfläche | mindestens 44 × 44 |
| Schrift | 12, 14, 16, 20, 26. Keine halben Pixel. Einzige Ausnahme: 44 für die Promille-Zahl |
| Zahlen | Bricolage Grotesque, `tabular-nums`, eine Stufe größer als ihr Etikett |

Typo-Rollen: Bricolage Grotesque für Namen, Überschriften und Zahlen. Figtree für alles andere.
Großbuchstaben mit Sperrung nur für die eine Zeile über einer Zahl.

### Karte

- Bierorte: großer Marker in Typfarbe mit Icon. Läden, Tankstellen, Restaurants, Imbiss: kleiner Punkt
  ohne Icon, wird erst beim Hineinzoomen zum Marker.
- Geschlossen: hohl. Favorit: Herz statt Icon. Preis: Deckel rechts oben.
- Kacheln warm getönt, im Dunklen braun statt grau.

## Bewegung

Jede Bewegung sagt etwas, sonst fliegt sie raus. Erlaubt sind:

| Bewegung | Sagt |
|---|---|
| Glas füllt sich | Ich lade |
| Sheet gleitet | Du hast gezogen |
| Marker blinkt einmal | Hier ist der Ort aus der Liste |
| Route zeichnet sich | Das ist dein Weg |
| Zwei Gläser stoßen an | Eingecheckt |
| Zahl zählt hoch | Das Ergebnis ist neu |

Dauer 150 bis 250 ms, eine Kurve (`--ease-out`), Feder nur beim Anstoßen. Kein gestaffeltes Aufpoppen,
kein Glitzern, kein Pulsieren im Ruhezustand. Mit `prefers-reduced-motion` entfällt alles bis auf Überblenden.

## Prüffragen vor jedem Merge

1. Beantwortet der Bildschirm die Frage, bevor man tippt?
2. Kann etwas weg, statt dass etwas dazukommt?
3. Würde der Wirt das so sagen?
4. Stimmt jede Zahl, und steht dabei, woher sie kommt?
5. Trifft man es mit dem Daumen, einhändig, nach dem dritten Bier?
