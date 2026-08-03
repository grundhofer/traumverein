# TRAUMVEREIN – Der Fußballmanager

Ein Fußballmanager im Geist von **Anstoss 1/2**: Managerbüro, Aktenschrank-Navigation,
trockener Reporterton – aber mit moderner Simulationstiefe und einem eigenen Dreh.

## Worum es geht

Der Auftrag war, zwei Dinge einzufangen: die **ran-Fußball-Romantik** und den **Take der
Anstoss-Reihe**.

Also Samstagabend, Fanfare, Bauchbinde. Der Reporterton, der ein 0:0 in Uerdingen
ernst nimmt. Das Gefühl, dass ein Spieltag ein Ereignis ist und kein Datensatz. Und
dazu Anstoss' Blick auf den Beruf: Manager sein heißt Büro, Aktenschrank, Vorstand,
Presse – die Elf ist nur eine von vielen Baustellen, und das Spiel nimmt sich dabei
selbst nie ganz ernst.

Daraus ist ein Fußballmanager geworden, der beides zusammenbringt – mit einem Dreh,
den es so nicht gibt: **jeder Verein tritt mit seiner historisch stärksten Elf an,
gemeinsam mit dem aktuellen Kader.**

Umgesetzt in **reinem JavaScript, ohne eine einzige Abhängigkeit und ohne Build-Schritt** –
ES-Module, Canvas 2D, ein Entwicklungsserver aus Node-Bordmitteln. Was hier liegt, läuft in
zehn Jahren noch, wenn ein Browser es öffnet.

Die verbindlichen Modulverträge stehen in [`docs/CONTRACTS.md`](docs/CONTRACTS.md), der
Bauverlauf in [`docs/ROADMAP.md`](docs/ROADMAP.md). Grundsatz beider Dokumente: **jede Zahl
ist gemessen, nicht behauptet** – `npm run check` fährt 30 Prüfstände, und was ein Ziel
verfehlt, steht dort als offener Punkt mit Zahl, statt stillschweigend zu verschwinden.

## Der besondere Dreh

**Jeder Verein tritt mit seiner historisch stärksten Mannschaft an – zusammen mit dem aktuellen Kader.**
Bei Bayern steht Franz Beckenbauer neben Harry Kane, bei Gladbach dirigiert Günter Netzer,
beim HSV stürmt Uwe Seeler. Die Generationen müssen sich erst finden: Die Chemie zwischen
Legenden und modernen Spielern ist zu Beginn schlechter und wächst mit gemeinsamer Spielzeit.

**Das gilt in beiden Profiligen.** Auch die 2. Bundesliga ist von Hand geschrieben: Toni
Turek hält für Fortuna, Robert Enke für Hannover 96, Oliver Kahn für den KSC, Torsten
Mattuschka zaubert für Union, Ivan Klasnic trifft für St. Pauli. Wer absteigt, landet
deshalb nicht in einer Welt aus Zufallsnamen, sondern zwischen Vereinen, die selbst schon
Deutscher Meister waren. Insgesamt **864 handgepflegte Spieler in 36 Kadern**, je 24 Mann,
davon rund 41 % Legenden – jede mit dem Etikett ihrer Ära („Ära 1974", „Ära 1997").

## Starten

Das Spiel braucht keinen Build-Schritt, aber einen Webserver (ES-Module laufen nicht über `file://`):

```bash
cd fussball
npm start          # oder: node tools/server.js
```

Der mitgelieferte Server (`tools/server.js`, nur Node-Bordmittel) schaltet den
Browser-Zwischenspeicher ab. `python3 -m http.server` tut das nicht und liefert nach
Änderungen gern den alten Stand aus – bei ES-Modulen führt das zu Importfehlern, die
wie Codefehler aussehen.

Dann `http://localhost:8123` im Browser öffnen.

## Spielen

| Taste | Wirkung |
|---|---|
| `1` … `9` | Büro, Kader, Taktik, Training, Spieltag, Tabelle, Europapokal, Transfermarkt, Finanzen |
| `0` | Stadion |
| `Q` `W` `E` `R` `T` | Jugend, Medizin, Trainerstab, Presse, Verein |
| `Z` | Chronik |
| `U` | Einstellungen |
| `Leertaste` / `Enter` | Weiter (Tag/Spieltag) |
| `Strg` + `S` | Speichern |
| `Strg` + `Umschalt` + `E` | Editor (siehe unten) |
| `ESC` | Auswahl aufgeben · Dialog schließen · Schlüsselszene der Simulation überlassen · zurück ins Büro |

Die Bildschirme liegen in der Reihenfolge der Aktenleiste auf der Tastatur – erst die
Zahlenreihe, dann die Buchstabenreihe darunter. Kein Bildschirm ohne Kürzel. Jedes Kürzel
steht am rechten Rand seines Reiters, die vollständige Tabelle noch einmal unter
**Einstellungen** (`U`). Die Belegung entsteht aus der Reiterreihenfolge und verschiebt
sich mit, wenn ein Bildschirm dazukommt – die Tabelle oben gilt für die 17 Reiter dieser
Fassung.

Spielstände liegen in der **IndexedDB** des Browsers – ein Spielstand ist mehrere Megabyte
groß und würde das localStorage-Kontingent sprengen. Über das Symbol ⬇ in der Kopfleiste
lässt sich ein Spielstand zusätzlich als Datei sichern und später wieder einlesen; das
überlebt auch das Löschen der Browserdaten.

### Drei Wege, ein Spiel zu erleben

1. **Textkonferenz** – nur der Live-Ticker, schnell durch die Saison.
2. **Höhepunkte** – das Stadion zeigt Tore, Großchancen und Karten.
3. **Ganzes Spiel** – die komplette Partie in der Vogelperspektive.

Zusätzlich lässt sich **Selbst eingreifen** aktivieren: Bei Elfmetern, Freistößen, Ecken,
Torabschlüssen und Kombinationen im letzten Drittel übernehmen Sie die Rolle des Schützen
oder Passgebers. Geschick hilft – aber die Fähigkeiten des Spielers bleiben maßgeblich.
Jede Szenenart lässt sich einzeln an- und abschalten.

### Einstellungen

Der Reiter **Einstellungen** (`T`) sammelt alles, was das Spiel *anfühlt*, aber nichts,
was es *entscheidet*: Ansichtsstufe, Spieltempo, Animationen, Eingreifen samt Auswahl der
Szenenarten, Lautstärke, Stadionatmosphäre, Klänge, Textgeschwindigkeit des Tickers,
Rückfragen bei folgenschweren Aktionen und die automatische Aufstellung vor eigenen
Spielen. Die Werte hängen am Spielstand – jede Karriere darf ihre eigenen Vorlieben haben.

### Editor (hinter einem Schalter)

`Strg` + `Umschalt` + `E` öffnet die **Werkstatt**. Sie steht bewusst nicht in der
Aktenleiste: Ein Manager-Spiel lebt davon, dass die Zahlen gelten, und ein Reiter „Editor"
neben „Verein" wäre der Knopf, den man im dritten Rückstand drückt.

Bearbeitbar sind

* **Vereine** – Name, Kurzname, Kürzel, Stadt, Gründungsjahr, Farben, Trikotmuster für
  Heim und Auswärts, Wappen (Form, Motiv, Farben), Stadionname, Kapazität, Stehplatzanteil,
  Ränge, Flutlicht, Rasen, Reputation, Vorstand und Titelzahl – mit Live-Vorschau von
  Wappen und beiden Trikots;
* **Spieler** – Stammdaten, Aussehen (Hautton, Gesichtsform, Frisur, Bart, Statur,
  Accessoire – mit Live-Portrait), alle zwanzig Attribute, Potenzial, Eigenschaften,
  Neben­positionen, Ära samt Beschriftung, Vertrag und Marktwert;
* **Neuanlagen** – eigene Vereine und eigene Spieler.

Gearbeitet wird auf einem **Entwurf**: Erst „Übernehmen" schreibt in den Spielstand.
Gelöscht wird nur nach Rückfrage – und ein Verein, der in einer Liga steht oder im
Spielplan vorkommt, lässt sich gar nicht erst löschen. Bei Spielern nennt die Rückfrage,
was an ihnen hängt (Startelf, Kapitänsbinde, Mentorenbogen, Statistik).

**Stammdaten weitergeben.** Der Reiter „Austausch" schreibt eine JSON-Datei mit *nur*
Vereinen und Spielern – kein Tabellenstand, kein Kassenbuch, kein Postfach. Wer seine
Kader jemandem geben will, gibt genau diese Datei weiter und behält seine Karriere für
sich. Das ist zugleich die Antwort auf „meine Kader sind veraltet", ohne dass dieses Spiel
je eine Datenquelle aus dem Netz braucht. Der Import ist nachsichtig und laut zugleich:
Unbekannte Felder werden übergangen, fehlende aus dem vorhandenen Datensatz ergänzt,
Ungültiges namentlich gemeldet und übersprungen. Geschrieben wird erst, wenn die ganze
Datei gelesen ist – es gibt kein „halb importiert".

### Schwierigkeitsgrade

| Grad | Charakter |
|---|---|
| Kreisliga-Legende | Nachsichtiger Vorstand, lockeres Geld, gnädige Minispiele |
| Profi | Die ausgewogene Variante |
| Weltklasse | Knappe Kassen, ungeduldige Bosse, harte Minispiele |
| Legendenstatus | Jeder Fehler zählt |

## Projektstruktur

```
index.html            Einstieg
styles/               Designsystem (Anstoss-Look) und Bildschirmstile
src/
  core/               RNG, Hilfsfunktionen, Konstanten, Spielzustand, Tagesablauf
  data/               Vereine, Ligen, Namen, Generator
  data/squads/        Handgepflegte Kader: gruppe1–6 = 1. Liga, gruppe7–12 = 2. Liga
                      (je 3 Vereine à 24 Spieler, Legenden + aktueller Kader)
  engine/             Bewertung, Taktik, Spielsimulation
  render/             Portraits, Spielerfiguren, Trikots/Wappen, Spielfeld, UI-Bausteine
  interactive/        Minispiele: Elfmeter, Freistoß, Ecke, Abschluss, Kombination
  club/               Finanzen, Sponsoren, Stadion, Vorstand, Fans, Stab, Jugend,
                      Medizin, Transfers, Training, Moral
  game/               Spieltags-Regie (verbindet Engine, Grafik und Minispiele)
  screens/            17 Reiter des Aktenschranks, dazu saison.js (kommt einmal im
                      Jahr von selbst) und editor.js (hinter einem Tastenkürzel)
tools/                Prüf- und Balancing-Skripte (Node), dazu server.js und
                      check-suite.js, die alle Prüfskripte hintereinander startet
docs/                 Technische Verträge, Roadmap
```

Spielstände wachsen nicht unbegrenzt: Bei jedem Saisonwechsel verdichtet
`core/state.js:verdichteVergangenheit()` die Vergangenheit — ein Spieler, der vor drei
Jahren aufgehört hat, steht mit vierzehn Feldern im Stand statt mit sechzig, ausgemusterte
Nachwuchsspieler verschwinden, Postfach, Kassenbücher und Verletzungsakten laufen gegen
feste Grenzen. Die Chronik zeigt danach unverändert dasselbe; nachgerechnet wird das über
acht Spielzeiten von `tools/test-spielstand.js`. Ältere Spielstände werden beim Laden
gehoben.

Alles ist Vanilla JavaScript (ES-Module), ohne Abhängigkeiten und ohne Build-Schritt.
Der Zufall läuft ausschließlich über einen deterministischen Generator (`src/core/rng.js`),
damit Spielstände reproduzierbar bleiben.

## Prüfskripte

```bash
npm run check              # alle 23 Skripte hintereinander, mit Zusammenfassung
npm run check -- --laut    # dasselbe, aber mit der vollen Ausgabe jedes Skripts
npm run check -- saison    # nur Skripte mit „saison" im Namen
```

`tools/check-suite.js` **liest** das Verzeichnis, statt eine Liste zu pflegen: Wer morgen
ein neues `tools/test-*.js` anlegt, läuft ab dem nächsten `npm run check` mit. Ausgenommen
sind nur `server.js` (kehrt nie zurück) und die Suite selbst. Jedes Skript bekommt einen
eigenen Node-Prozess, die Laufzeiten werden gemessen, und der Lauf endet mit Exit-Code 1,
sobald ein Skript rot ist. Ein voller Durchlauf dauert rund sieben Minuten.

Alle 23 Skripte laufen ohne Argumente und liefern Exit-Code 0:

| Skript | Was es prüft |
|---|---|
| `check-all.js` | Gesamtintegration: Syntax, Ladbarkeit, Importe, Determinismus, 120 Tage Spiel, Spielstandgröße |
| `check-data.js` | Kader- und Vereinsdaten: 864 Spieler in 36 Kadern, Nummern, Positionen, Ära-Mischung |
| `check-euroclubs.js` | Die 66 europäischen Vereine: Länder, Farben, Wappen, Kadererzeugung |
| `check-screens.js` | Bildschirme gegen ihre Module: Vertrag, Importe, CSS-Klassen, verbotene Zufallsquellen |
| `check-sound.js` | Die Tonschicht, prozedural und ohne eine einzige Audiodatei |
| `test-chemie.js` | Kabine, Cliquen, Mentorenbögen, Hierarchie (Stufe 4) |
| `test-europa.js` | Europapokal über mehrere Saisons: Feld, Ligaphase, K.-o.-Runden, Prämien (Stufe 3) |
| `test-fans.js` | Fanstimmung, Ultras, Protest, Dauerkarten |
| `test-finanzen.js` | Bilanzen über drei Saisons |
| `test-jugend.js` | Fünf Jahre Jugendarbeit |
| `test-karriere.js` | Zehn Jahre Managerkarriere ohne einen einzigen Anpfiff |
| `test-match.js` | Simulationsbalance über viele Spiele |
| `test-medizin.js` | Verletzungen, Ausfallzeiten, Sperren |
| `test-moral.js` | Moral, Zufriedenheit, Konflikte |
| `test-ratings.js` | Stärkeberechnung und Positionsabzüge |
| `test-saison.js` | Saisonwechsel über drei Spielzeiten: Auf-/Abstieg, Alterung, Karriereenden (Stufe 1) |
| `test-screens.js` | Alle 19 Bildschirme gegen eine DOM-Attrappe: jedes Bedienelement einmal, Dialoge, Escape-Kette, Fokusringe |
| `test-shootout.js` | Elfmeterschießen |
| `test-spielstand.js` | Die Spielstandbremse über acht Spielzeiten: Größe, Chronik vor und nach der Verdichtung, alte Spielstände |
| `test-stadion.js` | Ausbau, Preise, Zuschauer |
| `test-tactics.js` | Formationen, Aufstellungslogik, Stile |
| `test-transfers.js` | Transfermarkt, Angebote, Leihen, Vertragsenden |
| `test-wirtschaft.js` | Gehaltsskala und Vereinsbilanzen in beiden Ligen |

Die technischen Verträge zwischen allen Modulen stehen in [`docs/CONTRACTS.md`](docs/CONTRACTS.md),
die Ausbaupläne in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Stand

Die Roadmap-Stufen 1 bis 6 sind gebaut, der Anschlussabschnitt „Was als Nächstes" ebenfalls:

| Stufe | Inhalt |
|---|---|
| **1** | Saisonwechsel: Auf- und Abstieg, Alterung, Karriereenden, Managerlaufbahn, Titelchronik |
| **2** | Ton und Stadionatmosphäre – prozedural erzeugt, ohne eine einzige Audiodatei – sowie die Tastaturbedienung |
| **3** | Europapokal mit 66 europäischen Vereinen, Ligaphase und K.-o.-Runden |
| **4** | Kabine: Cliquen, Hierarchie, Konflikte und Mentorenbögen zwischen Legenden und Talenten |
| **5** | Legendenkader auch in der 2. Bundesliga – 864 handgepflegte Spieler in 36 Kadern |
| **6** | Chronik und Saisonrückblick im Zeitungslayout, durchgehende Escape-Kette, Bildschirme bis hinunter zum 10-Zoll-Tablet, Editor mit Stammdaten-Austausch, `npm run check` über alle Prüfskripte |
| **danach** | Spielstandbremse (verdichtet die Vergangenheit beim Saisonwechsel), Bildschirm-Prüfstand `test-screens.js`, **Ära-Konflikte** |

**Ära-Konflikte** sind der Punkt, an dem der besondere Dreh aufhört, eine Zahl zu sein.
Wenn eine Legende und ein junger Star aneinandergeraten, stellt die Kabine eine Frage –
*„Wer hat hier recht, der Mann mit den Titeln oder der Mann mit der Zukunft?"* – und es
gibt zwei Antworten, die es sonst nirgends gibt: **„Der Alte hat recht"** kostet die Laune
der ganzen jungen Garde und Ihren Kredit bei ihr, **„Die Zeiten haben sich geändert"**
kostet die Legende monatelang ihr Ansehen in der Kabine. Aussitzen geht auch. Das kostet
am Ende meistens mehr.

Alles Weitere – was gemessen wurde, was bewusst offen blieb und was der nächste ehrliche
Schritt wäre – steht in [`docs/ROADMAP.md`](docs/ROADMAP.md), Abschnitte 8 und 9.
