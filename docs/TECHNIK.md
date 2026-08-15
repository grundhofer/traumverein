# TRAUMVEREIN – Technische Details

Dieses Dokument richtet sich an alle, die im Code arbeiten. Wer nur spielen will, ist mit
dem [README](../README.md) besser bedient.

## Grundsätze

Alles ist **Vanilla JavaScript (ES-Module), ohne Abhängigkeiten und ohne Build-Schritt** –
Canvas 2D für Spielfeld, Portraits und Wappen, ein Entwicklungsserver aus Node-Bordmitteln.
Es gibt kein `node_modules`, kein Bundling, keine Transpilation. Was hier liegt, läuft in
zehn Jahren noch, wenn ein Browser es öffnet.

Der Zufall läuft **ausschließlich** über einen deterministischen Generator
(`src/core/rng.js`), damit Spielstände reproduzierbar bleiben. `Math.random()` ist in
Spiellogik und Bildschirmen verboten; `check-screens.js` prüft das.

Grundsatz der Dokumentation: **jede Zahl ist gemessen, nicht behauptet.** `npm run check`
fährt die Prüfstände, und was ein Ziel verfehlt, steht in
[`ROADMAP.md`](ROADMAP.md) als offener Punkt mit Zahl, statt stillschweigend zu
verschwinden.

## Starten

```bash
npm start          # oder: node tools/server.js
```

Der mitgelieferte Server (`tools/server.js`, nur Node-Bordmittel) schaltet den
Browser-Zwischenspeicher ab. `python3 -m http.server` tut das nicht und liefert nach
Änderungen gern den alten Stand aus – bei ES-Modulen führt das zu Importfehlern, die wie
Codefehler aussehen.

## Ausliefern

Zwei Wege, beide ohne Bauvorgang im Alltag:

**GitHub Pages** liefert das Repository unverändert aus – jeder Pfad im Projekt ist
relativ, es gibt nichts umzubauen. `.nojekyll` ist dabei Pflicht und keine Formalie:
Jekyll verschluckt Dateien mit führendem Unterstrich, und `src/data/squads/_helper.js`
wäre genau das Modul, das dann fehlt.

**Eine einzige HTML-Datei** für den Download erzeugt `npm run build:single`
(→ `dist/traumverein.html`, rund 4,4 MB, in `.gitignore`).

```bash
npm run build:single
```

Der Trick dahinter: Ein Browser lädt ES-Module nicht über `file://`. Das Skript legt
deshalb jedes Modul als Zeichenkette in die Datei, macht daraus zur Laufzeit je einen Blob
und verdrahtet sie über eine **Import-Map**. Weil relative Angaben gegen
`blob:null/<uuid>` aufgelöst würden und ins Leere liefen, schreibt es jede Angabe in einen
absoluten Namen um – aus `'./finances.js'` in `club/stadium.js` wird `'tv:club/finances.js'`.
Das gilt auch für die dynamische Vorlage `` import(`./screens/${id}.js`) ``, deren fester
Anfang mit ersetzt wird.

Der Ausdruck trifft zwangsläufig auch Import-Beispiele in JSDoc-Kommentaren. Was auf kein
existierendes Modul zeigt, bleibt unangetastet und wird am Ende des Laufs aufgelistet –
lieber ein Kommentar zu viel im Bericht als eine stillschweigend verbogene Zeile. Derselbe
Bericht nennt die dynamischen Vorlagen, die niemand statisch prüfen kann.

`build-single.js` ist ausdrücklich **kein Build-Schritt des Projekts**, sondern ein
Erzeuger für ein Download-Artefakt; es steht darum in der Ausnahmeliste von
`check-suite.js`. Die Einzeldatei setzt Import-Maps voraus: Chrome/Edge ab 89, Firefox ab
108, Safari ab 16.4.

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
docs/                 Technische Verträge, Roadmap, Bildschirmfotos
```

## Spielstände

Spielstände liegen in der **IndexedDB** des Browsers – ein Spielstand ist mehrere Megabyte
groß (gemessen: 2,85 MB am ersten Tag) und würde das localStorage-Kontingent sprengen.
Über das Symbol ⬇ in der Kopfleiste lässt sich ein Spielstand zusätzlich als Datei sichern
und wieder einlesen.

**Verzeichnis und Inhalt liegen getrennt.** Die Liste der Spielstände (Verein, Saison, Tag,
Größe) steht als kleine JSON-Zeile in `localStorage` unter `traumverein.saves`, damit
`listSaves()` **synchron** arbeiten kann – der Startbildschirm entscheidet ohne Warten, ob
er „Spielstand laden" anbietet. Die mehrere Megabyte großen Stände selbst liegen in der
IndexedDB unter `traumverein.save.<slot>`.

**Automatisch gespeichert** wird in den Slot `'auto'` (den `hasAutosave()` seit jeher
vorsieht), angestoßen am Ende von `weiter()` in `main.js` und gedrosselt auf höchstens
einen Schreibvorgang je `AUTOSAVE_ABSTAND` Ticks. Von Hand gespeicherte Stände liegen in
Slot 1 und werden davon nie überschrieben. Ein `beforeunload`-Wächter meldet sich, wenn
`state.tick` über den zuletzt gesicherten Stand hinausgelaufen ist.

**Die Datenbank wird ohne Versionsnummer geöffnet.** Eine feste Zahl in
`indexedDB.open(DB_NAME, 1)` ist eine Falle: Steht die Datenbank aus irgendeinem Grund
höher, scheitert jedes Öffnen mit „The requested version (1) is less than the existing
version (2)" – und der Spielstand ist unerreichbar, dauerhaft. Ohne Angabe nimmt der
Browser die vorhandene Fassung; existiert sie nicht, legt er Version 1 an. Fehlt in einer
vorhandenen Datenbank die Ablage – möglich, wenn ein Upgrade beim ersten Mal abbrach –,
zählt `openDb()` die Version einmal hoch und legt sie nachträglich an, statt den Spieler
mit einer unbrauchbaren Datenbank sitzen zu lassen.

**Über `file://` gibt es keine Datenbank – aber eine zweite Ablage.** Chrome verweigert
einer lokal geöffneten Datei den IndexedDB-Zugriff, und zwar wortlos: `indexedDB`
existiert, `open()` nimmt den Aufruf an, und danach kommt weder `onsuccess` noch
`onerror`. Ohne Gegenmaßnahme wartet das Spiel ewig auf eine Antwort, die nie kommt.
`openDb()` prüft deshalb das Protokoll und lehnt sofort ab; ein Zeitgeber von 8 s fängt
zusätzlich alles ab, was sich anders aufhängt (Privatmodus, gesperrte Datenbanken).

`localStorage` erlaubt der Browser auch lokal – nur passt ein Spielstand dort nicht hinein:
2,71 MB roh gegen rund 5 MB Kontingent für alles zusammen. Gemessen komprimiert ein Stand
aber um den **Faktor 12,2**: 2,71 MB → 0,22 MB gzip → 0,30 MB als Base64. Deshalb schreibt
`ablageSchreiben()` erst in die Datenbank und, wenn die nicht antwortet, gepackt in den
lokalen Speicher; `ablageLesen()` sieht in beiden nach. Gepackt wird mit `CompressionStream`
— das kann jeder Browser, der auch Import-Maps beherrscht, also keine Bibliothek.

Der Spielstandeintrag merkt sich in `ablage`, wo er liegt (`'datenbank'` oder `'lokal'`).
Nachgemessen: online `datenbank` ohne lokale Kopie, in der Einzeldatei `lokal` mit 724 KB
gepackt — und in einer getrennten Browsersitzung wieder ladbar.

Unabhängig davon bleibt „Als Datei sichern" (⬇) der Weg, der auch das Löschen der
Browserdaten überlebt und zwischen beiden Fassungen funktioniert.

Sie wachsen nicht unbegrenzt: Bei jedem Saisonwechsel verdichtet
`core/state.js:verdichteVergangenheit()` die Vergangenheit — ein Spieler, der vor drei
Jahren aufgehört hat, steht mit vierzehn Feldern im Stand statt mit sechzig, ausgemusterte
Nachwuchsspieler verschwinden, Postfach, Kassenbücher und Verletzungsakten laufen gegen
feste Grenzen. Die Chronik zeigt danach unverändert dasselbe; nachgerechnet wird das über
acht Spielzeiten von `tools/test-spielstand.js`. Ältere Spielstände werden beim Laden
gehoben.

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

Alles Weitere – was gemessen wurde, was bewusst offen blieb und was der nächste ehrliche
Schritt wäre – steht in [`ROADMAP.md`](ROADMAP.md), Abschnitte 8 und 9.

## Editor: Regeln

Gearbeitet wird auf einem **Entwurf**: Erst „Übernehmen" schreibt in den Spielstand.
Gelöscht wird nur nach Rückfrage – und ein Verein, der in einer Liga steht oder im
Spielplan vorkommt, lässt sich gar nicht erst löschen. Bei Spielern nennt die Rückfrage,
was an ihnen hängt (Startelf, Kapitänsbinde, Mentorenbogen, Statistik).

Der Stammdaten-Austausch schreibt eine JSON-Datei mit *nur* Vereinen und Spielern – kein
Tabellenstand, kein Kassenbuch, kein Postfach. Der Import ist nachsichtig und laut
zugleich: Unbekannte Felder werden übergangen, fehlende aus dem vorhandenen Datensatz
ergänzt, Ungültiges namentlich gemeldet und übersprungen. Geschrieben wird erst, wenn die
ganze Datei gelesen ist – es gibt kein „halb importiert".

## Weiterführend

* [`CONTRACTS.md`](CONTRACTS.md) – die verbindlichen Verträge zwischen allen Modulen
* [`ROADMAP.md`](ROADMAP.md) – Bauverlauf, Messwerte, offene Punkte
