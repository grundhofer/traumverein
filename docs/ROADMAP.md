# TRAUMVEREIN — Ausbauplanung

**Stand: Die Roadmap ist abgearbeitet — und Abschnitt 8 dazu.** Alle sechs Stufen sind
gebaut, fünf davon mit eigener Abnahme (Stufe 1 nicht — was das gekostet hat, steht bei
5.3). Danach sind die drei Vorhaben aus Abschnitt 8 gefolgt: die **Spielstandbremse**, der
Bildschirm-Prüfstand **`tools/test-screens.js`** und die **Ära-Konflikte**. Alle drei stehen
und sind abgenommen; die Messwerte und das bewusst offen Gebliebene stehen in Abschnitt 8,
die Schlussbetrachtung in Abschnitt 9. Damit sind **alle sieben Befunde der
Bestandsaufnahme erledigt** (S1–S7, Abschnitt 2). Dieses Dokument beschreibt, was gebaut
wurde, in welcher Reihenfolge — und was bewusst nie gebaut wird.

Grundlage ist der tatsächliche Code, nicht die Absicht. Jede Zahl in diesem Dokument ist
gemessen (`node tools/check-all.js`, `tools/test-*.js`) oder aus der Datei abgelesen; wo
etwas nur gelesen und nicht gemessen wurde, steht das dabei. Die verbindlichen
Modulverträge stehen in [`CONTRACTS.md`](CONTRACTS.md), das State-Schema in
`src/core/state.js`.

## Messlage

Alle **23** Skripte unter `tools/` liefern Exit-Code 0, gestartet von einem einzigen
`npm run check` (`tools/check-suite.js`, seit Stufe 6). Gesamtlaufzeit **417 Sekunden**,
davon 122 s `test-spielstand.js` (acht Spielzeiten), 80 s `test-europa.js`, 58 s
`test-saison.js` und 41 s `test-screens.js`.

*Stand: Abnahme von Abschnitt 8 — der letzten.* Die Zeilen unten stammen aus der Abnahme
von Stufe 6, soweit nichts anderes dabeisteht; die Zeilen zum Spielstand und zu den
Bildschirmen sind neu gemessen.

| Prüfung | Ergebnis |
|---|---|
| `node tools/check-all.js` | **0 Fehler, 0 Hinweise** (bis Stufe 5: 1 Hinweis). Die Torschnitt-Korridore sind seit Stufe 5 nach Ligatyp getrennt (5.8 erledigt): bl1 **2,98**, bl2 **3,41** Tore je Spiel über je 90 Partien. Der Legendenkorridor steht seit 8.6 auf **2,9–4,3** statt 3,1–3,8 — nachgemessen über zehn Spielstände liegt dieser Punktwert bei Mittel 3,58 mit **sd 0,35**, nicht 0,19; Seed 7 ist der niedrigste von zehn. Trefferquote bl1 10,62 %, bl2 11,44 % (Spreizung 0,82 Prozentpunkte). 0 von 36 Profivereinen nach 120 Tagen im Minus. |
| `node tools/check-data.js` | 0 Fehler, 1 Warnung · **864** handgepflegte Spieler in **36** Kadern (beide Profiligen). Ø24 im Ligamittel: bl1 76,9, bl2 69,1. Die Warnung nennt fünf Vereine, deren Ruf und Kaderstärke auseinanderliegen (Union, St. Pauli, Dynamo, Magdeburg, Braunschweig) |
| `node tools/check-euroclubs.js` | 27 Prüfungen grün · 66 europäische Vereine aus 23 Ländern, alle `lazySquad` |
| `node tools/check-screens.js` | **19 Bildschirme** (17 in der Navigation + `saison` und `editor` ohne Reiter), 0 Fehler, 0 Hinweise |
| `node tools/test-chemie.js` | **10 von 10 Zusicherungen grün** · 3 Saisons · Eingespieltheit 30,0 → 69,5 ohne einen Zugang, 37,1 mit fünf |
| `node tools/check-sound.js` | 37 Prüfungen grün · 16 Klänge, 4 Gongarten, 4 Aliase — und in Node bleibt es still |
| `node tools/test-europa.js` | **14 von 14 Zusicherungen grün** · 2 Seeds × 3 Saisons · 423 Europapokalpartien je Saison |
| `node tools/test-saison.js` | 15 von 15 Zusicherungen grün über drei Saisons |
| `node tools/test-shootout.js` | 51 Prüfungen grün · 5.000 Elfmeterschießen, 52.103 Schüsse · Trefferquote **73,37 %** (vor Stufe 5: 75,15 %; Korridor auf 72–78 % gesenkt, Begründung im Skriptkopf) |
| `node tools/test-match.js` | alle Einzelprüfungen grün, darunter **alle numerischen Zielkorridore** · 2000 Spiele in 845 ms (0,42 ms/Spiel) |
| `node tools/test-transfers.js` | 0 fehlgeschlagen (Korridor `SOMMER_GROSS_MIN` bei der Abnahme von Stufe 4 von 8 auf 6 gemessen — siehe dort). Seit 8.6 prüft „Der Manager wird umworben" über die Spielstände hinweg statt je Spielstand: Gemessen über zehn Ströme liegt die Zahl der Angebote bei 16/14/0/7/2/4/10/13/15/15 und hängt fast nur daran, wie viele eigene Spieler weg wollen |
| `node tools/test-wirtschaft.js` | alle Zielkorridore eingehalten · Gehaltsquote 1. Liga **50,4 %**, 2. Liga **46,2 %** (ohne den neuen Ligafaktor wäre die 2. Liga bei 98,3 % gelandet — siehe Stufe 5) · tragbare Quote 1. Liga 84,2 %, 2. Liga 60,3 % |
| Syntax / Ladbarkeit / Determinismus | alle Dateien · DOM-freie Module unverändert · 0 `Math.random()`, 0 `Date.now()` in der Spiellogik |
| `node tools/test-spielstand.js` | **11 von 11 Zusicherungen grün** · acht Spielzeiten mit Bremse (17,01 MB) gegen acht ohne (20,56 MB) · Ruhmeshalle, ewige Tabelle, Titelchronik und Rekordbuch 8× identisch vor und nach jeder Verdichtung |
| `node tools/test-screens.js` | **19 Bildschirme an zwei Zeitpunkten** · 954 betätigte Bedienelemente, 134 Dialoge, 699/699 Fokusringe, Escape-Kette in vier Varianten · **0 Laufzeitfehler, 0 `console.error`** |
| Spielstand nach 120 Tagen | **11,96 MB** (`players` 76,0 %, `clubs` 34,7 %, `fixtures` 3,2 %) · Warnschwelle im Prüfstand seit Stufe 6 auf 25 MB · gemessen vor der Bremse; sie greift erst beim Saisonwechsel |
| Spielstand nach **drei / acht Saisons** | **11,37 / 17,01 MB** (Seed 7, HSV) — ohne Bremse wären es 13,05 / 20,56 MB. Der Zuwachs sinkt von 1,66 auf 1,00 MB je Spielzeit, statt bei 1,5 MB stehen zu bleiben. Siehe S3, 5.7 und 8.1 |
| Determinismus über **acht Spielzeiten** | gleicher Seed, zwei getrennte Prozesse → byteweise derselbe Spielstand in jeder der acht Spielzeiten; anderer Seed → anderer Stand |
| Laufzeit einer Spielzeit | **9,5 s** (Spielzeit 1) bis **9,9 s** (Spielzeit 3), Saisonwechsel 20 ms davon 2–3 ms Bremse. Vor der Bremse: 9,9 / 10,5 s |
| Umfang | `src/` **83.945** Zeilen in **77** Dateien · `tools/` **16.976** in 25 Dateien (23 Prüfskripte + `check-suite.js` + `server.js`) · `styles/` **1.940** · `docs/` 2.490 |

~~**Die wichtigste Einschränkung dieser Messlage:** Sie deckt die Simulation, nicht die
Oberfläche.~~ — **behoben.** `tools/test-screens.js` liegt seit Abschnitt 8 im Projekt und
läuft bei jedem `npm run check` mit; der Harnisch, der viermal gebaut und viermal
weggeworfen wurde, ist beim fünften Mal geblieben (5.5, 8.2).

**Die Einschränkung, die bleibt:** Er misst nichts. Eine DOM-Attrappe kann sagen „nichts
wirft", nicht „nichts läuft aus dem Container". Layout, Farben, Zeichnungen, echte
Browser-Eingabe und alles, was von einer Frist lebt, sind weiterhin ungeprüft — der
Dateikopf zählt es auf. **Die Breitenprüfung des Projekts ist statisch gerechnet und bleibt
es.**

**Die zweitwichtigste:** Eine grüne Suite ist kein Beweis. Bei der Abnahme von Stufe 3 kam
ein Fehler aus Stufe 1 ans Licht, der zwei Stufen lang unter zwanzig grünen Skripten lag und
das Spiel ab Saison 3 unspielbar machte — kein einziges Skript prüfte die Frage, ob ein
Verein am Saisonende überhaupt noch elf Spieler aufstellen kann (5.3, 5.5). Bei der Abnahme
von Stufe 4 wiederholte sich das Muster in klein: Ein Prüfstand mit zehn Zusicherungen war
zu acht grün, und genau die beiden roten waren die, auf die es ankam. **Beide Male war der
Fund ein Tageszähler, der beim Saisonwechsel auf 0 zurückspringt** (`medical.js:day === 0`,
`chemie.js:mentorPruefung`).

*Und ein drittes Mal in Stufe 6:* 21 grüne Skripte, und trotzdem setzte ein Rundlauf durch
den Editor — exportieren, **nichts** ändern, importieren — die Mitgliederzahl jedes Vereins
auf den Gründungsstand zurück (HSV nach drei Saisons 147.854 → 96.000). Ursache war eine
einzige Fallback-Reihenfolge (`state.js:clubStammdaten`, `c.fanbase || c.fans` statt
`c.fans || c.fanbase`). **Das Muster diesmal: zwei Felder für dieselbe Sache, eines davon
tot.** Vier andere Module lasen längst in der richtigen Reihenfolge; genau eines nicht.

*Und ein viertes Mal in der Schlussabnahme:* Die Spielstandbremse war vollständig gebaut und
mit zehn grünen Zusicherungen über acht Spielzeiten belegt — und im Spiel **nie aufgerufen**.
`core/loop.js` kannte `verdichteVergangenheit()` nicht; der einzige Aufruf stand im
Prüfstand selbst. **Das Muster diesmal: Ein Prüfstand, der die geprüfte Funktion selbst
anstößt, prüft die Funktion und nicht das Spiel.** Die Gegenmaßnahme ist eine einzige
Zusicherung (Z11), die denselben Weg ohne Prüfschalter geht.

*Nicht mehr zutreffend:* Der frühere Satz „Kein einziger Test hat je einen Saisonwechsel
gesehen" gilt seit Stufe 1 nicht mehr — `test-saison.js`, `test-karriere.js` und
`test-europa.js` spielen je drei volle Saisons, `test-spielstand.js` seit Abschnitt 8 acht.

---

## 1. Wo das Spiel heute steht

Reifegrad-Skala:

| Grad | Bedeutung |
|---|---|
| **Fertig** | Im Sinne von Anstoss 1/2 abgeschlossen. Ausbau möglich, aber nicht nötig. |
| **Tief** | Trägt das Spiel, hat aber benannte Lücken. |
| **Grundfunktion** | Spielbar, aber flach. |
| **Gerüst** | Daten und Verträge vorhanden, keine Wirkung im Spiel. |
| **Fehlt** | — |

### 1.1 Daten

| Bereich | Reifegrad | Lücken |
|---|---|---|
| 18 Erstligavereine, je 24 Spieler handgepflegt (`src/data/squads/gruppe1–6.js`, 2.827 Z.) | **Fertig** | — |
| 18 Zweitligavereine, je 24 Spieler handgepflegt (`src/data/squads/gruppe7–12.js`, 2.768 Z.) | **Fertig** *(Stufe 5)* | Turek, Enke, Franke, Köpke, Kahn, Lehmann, Mattuschka, Klasnic — 178 Legenden (41 % der Liga), jede mit `eraLabel`, alle 18 Vereine mit mindestens 3 Legenden und 3 Modernen. Damit greift die Ära-Mischung auch hier. Ø24 im Ligamittel 69,1 gegen 76,9 in der ersten Liga. |
| Gesamtbestand | **Fertig** | **864 Spieler in 36 Kadern**, geprüft von `check-data.js` (Kadergröße, Verteilung 3/8/8/5, Rückennummern, Attributgrenzen, Marktwerte, Legendenanteil, Ruf-Plausibilität). Die prozedurale Kadererzeugung in `core/state.js` ist damit nur noch Auffangnetz für Vereine ohne Kaderdatei. |
| 28 Amateur-/Drittligavertreter (`AMATEUR_CLUBS`) | **Grundfunktion** | Nur Pokalkulisse. `lazySquad: true`, der Kader entsteht erst beim ersten Anpfiff (`state.js:ensureSquad`). Farben aus einer 8er-Tabelle (`state.js:173`), Wappen immer `motif: 'letters'`. Gewollt sparsam, aber sichtbar. |
| 66 europäische Vereine (`EURO_CLUBS`) | **Grundfunktion** | Seit Stufe 3 in `state.clubs`: `core/state.js:euroClub()` leitet Farben, Trikot, Wappen, Stadion und Finanzen aus `reputation` und `country` ab, `lazySquad: true` hält den Kader zurück, bis wirklich gegen sie gespielt wird. Gemessen: nach drei Saisons haben 14–16 von 66 einen Kader. Geprüft von `tools/check-euroclubs.js`. Lücken: keine handgepflegten Spieler, keine Legenden, keine Vereinshistorie über eine Zahl hinaus. |
| Namen, Nationen, Generator (`data/names.js`, `data/generator.js`) | **Tief** | Trägt Jugend, Vertragslose und Amateurkader zuverlässig; die Zweitligakader hat er seit Stufe 5 abgegeben. Für nichtdeutsche Ligen zu deutschlandlastig. `REFEREE_NAMES` (34 Namen) liegt ungenutzt herum. |
| Ligen, Pokal, Kalender (`data/leagues.js`, 1.026 Z.) | **Tief** | Spielplan, Tabelle mit direktem Vergleich, Prämienstaffeln, Kalender: sauber und getestet. `LEAGUES.*.clubIds` ist seit Stufe 1 nur noch die Vorlage; die Wahrheit steht in `state.leagues` — siehe 5.1. |
| Europapokal als Wettbewerb (`club/europa.js`, 1.459 Z.) | **Tief** | Qualifikation, Auslosung mit Töpfen, Ligaphase über 8 Spieltage, fünf K.-o.-Runden mit Hin- und Rückspiel, Elfmeterschießen, Prämien, Reise- und Belastungsbuchung, Meldungen ins Postfach. 14 Zusicherungen grün. Lücken: die Doppelbelastung wirkt schwächer als geplant (5.11), die Prämien spreizen die Liga (5.10). |

### 1.2 Engine

| Bereich | Reifegrad | Lücken |
|---|---|---|
| `engine/match.js` (3.533 Z.) | **Fertig** | Zonenmodell mit xG, Minutensimulation, Phasen fürs Rendering, Live-Hooks (`onPhase`/`onHalftime`/`onMinute`), Key Moments, deutscher Reporterticker, `quickSimulate` für KI-Partien. Alle 15 Zielkorridore erfüllt. Die Konstanten sind durchgehend kommentiert und begründet — die am besten dokumentierte Datei des Projekts. |
| `engine/ratings.js` (1.183 Z.) | **Fertig** | Positionsgewichte, Positionsmalus, Form/Moral/Fitness, Chemie mit deutschen Begründungen, Taktik-Matchup. Gewichte als Kommentar dokumentiert (Vertrag §7). Bei der Abnahme von Stufe 4 an genau einer Zahl korrigiert: `CHEMISTRY.eraMixMin` von 3 auf 1 — vorher war die Eingespieltheit für jede Elf mit weniger als drei Spielern der Minderheits-Ära wirkungslos. |
| `engine/tactics.js` (1.759 Z.) | **Fertig** | ≥12 Formationen, 8 Stile, ≥14 Rollen, `autoLineup`, `validateTactics`, `formationCounter`. |
| Verlängerung / Elfmeterschießen (`engine/shootout.js`, 684 Z.) | **Fertig** | Seit Stufe 3. Echte Schützen, echter Torwart, wachsender Druck. Löst Pokal- **und** Europapokalduelle auf; der Münzwurf `ctx.rng.chance(0.55)` in `loop.js:pokalWeiterlosen` ist damit weg. Verlängerung gibt es im Pokalfinale (`loop.js:pokalFinaleEntscheiden`) und im europäischen Rückspiel (`europa.js:1045`), in den früheren Pokalrunden geht es direkt an den Punkt. Geprüft von `tools/test-shootout.js` (419 Z.), Z06 in `test-europa.js`. Nicht interaktiv: KI-Duelle werden ausgeschossen, ohne dass `interactive/penalty.js` zum Zug kommt. |

### 1.3 Taktik und Spieltag

| Bereich | Reifegrad | Lücken |
|---|---|---|
| Taktikbrett (`screens/taktik.js`, 1.735 Z.) | **Fertig** | Formation, Stil, sechs Slider, Rollen, Standardschützen, Chemie-Anzeige, Ära-Mischung. |
| Spieltags-Regie (`game/matchday.js`, 558 Z.) | **Tief** | Drei Ansichtsstufen, Halbzeitdialog, Wechsel und Ansprache im laufenden Spiel, Minispiel-Bühne mit Notbremse. `sound: () => {}` (`matchday.js:421`) ist ein leerer Rumpf. |
| Spieltagsbildschirm (`screens/spieltag.js`, 1.406 Z.) | **Tief** | Vorbericht, Konferenz, Nachbericht. Der Schiedsrichter im Vorbericht ist ein Platzhalter (`spieltag.js:348`: `{ name: 'noch nicht angesetzt', strictness: 50, homeBias: 50 }`) — `matchday.js:118` setzt für die Partie selbst einen echten an. Zwei Wahrheiten in zwei Dateien. |

### 1.4 Wirtschaft

| Bereich | Reifegrad | Lücken |
|---|---|---|
| `club/finances.js` (987 Z.) | **Tief** | Konto, Kredite, Kassenbuch, Bilanz, Prognose, Insolvenzprüfung, Saisonabschluss mit Historie. Balance ist die offene Frage: 15 von 36 Vereinen nach 120 Tagen im Minus. |
| `club/sponsors.js` (819 Z.) | **Tief** | Vier Slots (Trikot, Ärmel, Ausrüster, Stadion) plus Banden, Angebote, Verhandlung, Erfolgsboni. **Kein Testskript.** |
| `club/stadium.js` (1.418 Z.) | **Tief** | Ausbaustufen, Ränge, Preise, Dauerkarten, Catering, Rasen, Derbyfaktor. |
| `club/transfers.js` (3.173 Z.) | **Tief** | Marktwerte, Scouting, mehrstufige Verhandlung, Berater, Leihen, KI-Vereine, Fensterlogik (Sommer Tag 0–62, Winter 184–215), Deadline Day mit eigener Quote und eigenem Nachlass, Vertragsende zum Saisonwechsel. 43 Prüfungen grün. |
| Europapokal-Prämien | **Tief** | Seit Stufe 3 verbucht: `club/europa.js:europaPraemien` → `finances.js:praemieErhalten`, mit Start-, Sieg-, Remis-, Platz- und Rundenprämie plus Marktanteil. Gemessen 221–330 Mio je Saison an 7–8 Vereine, im Korridor CL 20–140 Mio / Conference 3–25 Mio. **Die offene Frage ist die Wirkung:** nach drei Saisons liegen die Europateilnehmer im Schnitt 155–167 Mio über dem Rest der beiden Profiligen — siehe 5.10. |

### 1.5 Vereinsleben

| Bereich | Reifegrad | Lücken |
|---|---|---|
| `club/morale.js` (2.300 Z.) | **Tief** | Moral, sieben Persönlichkeiten, Kabinenhierarchie, Beziehungen, Konflikte, Gespräche, Ansprachen, Mannschaftsrat, Kapitän. Seit Stufe 4 die **Gruppenebene**: `cliquenGruppen()` verdichtet die Beziehungen zu Cliquen nach Nationalität, Ära und Jahrgang; die Laune des Wortführers steckt an (höchstens 1,4 Punkte je Tag), zwei starke Lager heben das Konfliktrisiko. Gemessen 5,5 Cliquen je Verein. Kostet die Hälfte des Tagesablaufs (5,3 s je Saison) — das teuerste Vereinsmodul. |
| `club/board.js` (1.560 Z.) | **Tief** | Erwartung, Geduld, Forderungen, Budgetverhandlung, Vertrauensfrage, Entlassung, Jobangebote, Rücktritt. **Kein Testskript** — und das ist das Modul, das den Spieler feuern kann. |
| `club/media.js` (1.765 Z.) | **Tief** | Blätter, Schlagzeilenkatalog, Pressekonferenz mit Fragenkatalog, Interviews, Gerüchte, Saisonrückblick. **Kein Testskript.** |
| `club/fans.js` (1.993 Z.), `medical.js` (1.601), `training.js` (1.740), `staff.js` (1.134), `youth.js` (1.222) | **Tief** | Alle mit deutschen Texten und Berichten. Tests für `fans`, `medical`, `youth` vorhanden; für `training` und `staff` nicht. **`medical.js` hat bei der Abnahme von Stufe 3 den schwersten Fehler des Projekts beigesteuert** (5.3) — trotz eigenem Testskript, weil dieses nur innerhalb einer Saison prüfte. |
| `club/karriere.js` (1.776 Z.) | **Tief** | Seit Stufe 1: Karriereenden mit Begründung, Regenerierung, Trainerlaufbahn (`skills`, `erfahrung`, `level`, `reputation`, `titel`), Titelchronik in `history.titel[saison]`, Elf der Saison. Seit Stufe 4 fünf **Lizenzstufen** (C bis „Fußball-Lehrer mit Auszeichnung") und acht **Fortbildungen**. Geprüft von `tools/test-karriere.js`. Lücken: die Chronik wird geschrieben, aber von keinem Bildschirm gezeigt (Stufe 6) — und `fortbildungen()`/`fortbildungBelegen()` ruft **kein einziger Bildschirm** auf, der Spieler kann also keine buchen. |
| **Team-Chemie über Zeit** (`club/chemie.js`, 1.191 Z.) | **Tief** | Seit Stufe 4 eingelöst. `club.chemie.paare` führt ein **paarweises** Gitter für den Verein des Managers (158 Paare nach drei Saisons, 5,9 kB), alle KI-Vereine laufen über den Vereinsmittelwert `club.chemistryHistory`. Der Wert wächst mit gemeinsamen Einsatzminuten (gemessen 30,0 → 69,5 über drei Saisons ohne Zugang), fällt bei Fluktuation (fünf Zugänge kosten 17,9 Punkte), bei Konflikten und in der Sommerpause. Startniveau eines Paares nach Ära, Nation, Position und Alter — eine Legende neben einem 22-Jährigen beginnt bei ~11 statt ~46. **Lücke: die Wirkung in der Engine ist für die Standardelf (9:2) mit 0,03 Punkten je Spiel klein** — Zahlen und Nachstellschrauben stehen bei Stufe 4. |
| **Mentoren und Cliquen** | **Tief** | Seit Stufe 4. Eine Legende nimmt ein Talent unter die Fittiche: Trainingsfaktor bis 1,42 (gemessen **+44 % Attributzuwachs**), die Persönlichkeit färbt monatlich ab und kippt bei 72 %, der Mentor gewinnt Ansehen in `morale.js:hierarchie`, beim Karriereende erbt der Zögling die Rückennummer. Sichtbar auf Kader- und Vereinsbildschirm. Lücke: `mentorPaare()` prüft `retired`/`clubId` nicht selbst — für einen Tag nach dem Saisonwechsel zeigt es Paare, die `tickChemie` erst am Folgetag löst. |
| **Manager-Entwicklung** | **Tief** | Seit Stufe 1 eingelöst: `manager.bilanz` schreibt `loop.js:applyResult` nach jeder Partie, `skills`/`erfahrung`/`level`/`reputation`/`titel` füllt `club/karriere.js` zum Saisonende. Seit Stufe 4 dazu Lizenzstufen und Fortbildungen. Lücke: die Fortbildungen haben **keine Bedienoberfläche** (siehe oben). |
| Nationalmannschaft (`club/national.js`, 1.099 Z.) | **Tief** | Seit Stufe 4. Berufungen nach Leistung und Nationalität, Länderspielpausen mit Reisebelastung je Konföderation, Turniere in jeder ungeraden Saison (WM/EM im Wechsel), Verbandsakte je Spieler, ab genug Ruf ein Angebot als Nationaltrainer über `board.js:1236`. Gemessen: 8 Aufgebote, 131 Berufungen, 1,21 Fitnesspunkte je Spieler und Pause, kein Verletzter aus einer Berufung heraus. Läuft aus `loop.js:advanceDay`, **nicht** aus `tickAlleModule` — ein Verband ist kein Vereinsmodul. |

### 1.6 Grafik und Oberfläche

| Bereich | Reifegrad | Lücken |
|---|---|---|
| `render/portraits.js` (1.480 Z.) | **Fertig** | Prozedurale, klar unterscheidbare Gesichter mit Alterung ab 30. |
| `render/players.js` (929 Z.) | **Fertig** | Ganzkörper, Posen, Torwart, vereinfachte Darstellung ab kleiner Skalierung. |
| `render/kits.js` (1.673 Z.) | **Fertig** | Trikotmuster, prozedurale Wappen, Flaggen. |
| `render/pitch.js` (1.803 Z.) | **Fertig** | Vollperspektive, Phasenanimation, Banner, Tempostufen. |
| `render/ui.js` (1.647 Z.) | **Fertig** | Anstoss-Panels, sortierbare Tabellen mit `aria-sort` **und `tabIndex = 0`**, Tabellenhüllen mit eigener Waagerechtrolle (`overflow:auto`), Dialoge mit `role="dialog"`, Fokusfalle im obersten Dialog, ESC nur für den obersten. Gemessen bei der Abnahme von Stufe 6: **585 von 585 Bedienelementen über alle 19 Bildschirme werden von einer `:focus-visible`-Regel getroffen, die auch etwas zeichnet**; keines ist ohne Tastatur erreichbar (die Reiterleisten nutzen korrektes Roving-Tabindex mit Pfeiltasten). |
| **Ton** | **Fertig** *(Stufe 2)* | 16 Klänge, 4 Gongarten, Stadionatmosphäre — rein prozedural über WebAudio, keine Audiodatei im Projekt. Siehe 1.9. |
| **Kleine Bildschirme** | **Tief** *(Stufe 6)* | Fünf Schwellen statt vier Media Queries: 1250 px (Detailspalte unter die Liste), 1100 px (Kachelgitter, Editor-Werkbank), **1080 px** (Aktenschrank wird Symbolleiste, 210 → 56 px), 900 px (Editor einspaltig), **860 px** (alles einspaltig, Leiste 50 px). Zielbild ist das 10-Zoll-Tablet im Querformat, ausdrücklich nicht das Telefon. Gemessen: keine einzige CSS-Regel des Projekts verlangt bei 900 px mehr Breite als die 828 px, die dann zur Verfügung stehen (breiteste Regel 352 px). |

### 1.7 Minispiele

| Spiel | Datei | Zeilen | Reifegrad |
|---|---|---|---|
| Elfmeter | `interactive/penalty.js` | 1.183 | **Fertig** |
| Freistoß | `interactive/freekick.js` | 1.182 | **Fertig** |
| Ecke | `interactive/corner.js` | 919 | **Fertig** |
| Torabschluss | `interactive/finish.js` | 1.006 | **Fertig** |
| Kombination | `interactive/combination.js` | 917 | **Fertig** |

Alle fünf halten den Vertrag aus CONTRACTS.md §9 (20-s-Timeout, ESC ⇒ `null`,
Schwierigkeitsskalierung über `difficulty.minigame` **und** die Attribute des Akteurs).
Lücken: kein Trainingsmodus zum Üben, keine Torwartperspektive, kein Kopfballduell,
kein Dribbling, keine Tastatursteuerung, kein Ton.

### 1.8 Bildschirme

**19 Bildschirme**: 17 in der Navigationsleiste plus `saison` und `editor` ohne Reiter, alle
statisch geprüft (`tools/check-screens.js`), von `einstellungen` (446 Z.) bis `transfer`
(2.230 Z.). Neu seit Stufe 2: `einstellungen`; seit Stufe 3: `europa` (840 Z.); seit
Stufe 6: **`chronik` (1.555 Z.)** und **`editor` (1.290 Z.)**.

Gemessen bei der Abnahme von Stufe 6 mit einem Wegwerf-Harnisch gegen ein DOM-Ersatzstück:
alle 19 an **Tag 1** und **nach drei Saisons**, jeder Knopf, Reiter, Regler, Auswahlkasten
und sortierbare Tabellenkopf einmal betätigt — **931 Bedienungen von 939 Bedienelementen**
(6 deaktiviert, 2× der Tagesvorlauf gesondert), **140 Dialoge** geöffnet und wieder
geschlossen, **0 Laufzeitfehler und 0 `console.error`**. Die Abnahme von Stufe 4 hatte
dasselbe mit 3.996 Bedienungen an drei Zeitpunkten getan, Stufe 3 mit 5.946.

Der Editor steht bewusst **nicht** in `SCREEN_ORDER`: Zwei absichtlich unbequeme Türen
führen hinein (Strg + Umschalt + E und ein Knopf in den Einstellungen). Die Begründung
steht im Dateikopf von `screens/editor.js` und ist die richtige: Ein Reiter „Editor"
zwischen „Verein" und „Chronik" ist der Knopf, den man im dritten Rückstand drückt.

Was offen bleibt:

- **Der Spieltagsbildschirm zeigt für Europapokalpartien der KI keine Spielerstatistik** —
  `club/europa.js` trägt Fernergebnisse ohne `playerStats` ein. Das ist die Gegenleistung
  für den kleinen Spielstand und gewollt, steht aber nirgends in der Oberfläche.
- **Drei Tabellen brauchen bei kleinen Breiten die Waagerechtrolle** (statisch aus den
  Spaltenbreiten gerechnet, nicht gerendert gemessen): die Kabinentabelle im Kader
  (13 Spalten, ~1.204 px) ab 1280 px, die Spielersuche im Transfermarkt (~1.036 px) ab
  1024 px und die Trainingsübersicht (~908 px) ab 900 px. Sie rollen **in ihrem eigenen
  Kasten** (`ui.js:.tv-tabelle-huelle{overflow:auto}`), die Seite selbst rollt nicht.
  Das ist das Zielverhalten aus Stufe 6, Punkt 4 — aber es ist eine Rolle, kein Layout.
- **`chronik.js` erfindet nichts.** `loop.js:saisonAbschluss` archiviert je Tabellenzeile
  nur `{ clubId, platz, punkte, diff }`; Siege, Unentschieden und Tore fallen beim
  Archivieren weg. Die ewige Tabelle liest diese Felder **optional** und blendet die
  Spalten aus, wenn sie fehlen — mit einer Fußnote, die sagt, warum. Wer
  `saisonAbschluss()` eines Tages die vollen Zeilen schreiben lässt, füllt den Bildschirm
  ohne eine weitere Zeile Arbeit. **Das ist die billigste offene Verbesserung im ganzen
  Projekt** (siehe Abschnitt 8).

### 1.9 Technik

| Bereich | Reifegrad | Bemerkung |
|---|---|---|
| Determinismus | **Fertig** | Kein `Math.random()`, kein `Date.now()` in 34 geprüften Dateien. Gleicher Seed ⇒ identische Spielwelt nach 40 Tagen, identisches Einzelspiel, identischer Transferverlauf — seit Stufe 4 gegengemessen auch für **Mentoren (296 Paare), Cliquen (258 Gruppen) und Berufungen (27 Aufgebote)**. Das ist die stärkste Eigenschaft des Projekts und die Voraussetzung für mehrere Ideen in Abschnitt 4. |
| Modulverträge | **Fertig** | 280 relative Importe, 0 Abweichungen. `CONTRACTS.md` ist gepflegt und wird eingehalten. |
| Speichern | **Tief** | IndexedDB plus Dateiexport, Kompaktierung beim Serialisieren. `migrate()` hat seit Stufe 3 zwei echte Schritte: 1→2 hebt die Ligazugehörigkeit in den Spielstand, 2→3 trägt die 66 europäischen Vereine nach. `SAVE_VERSION` steht auf 3 **und bleibt dort**: Stufe 4 legt alle neuen Felder faul an (`chemie.js:chemieAkte`, `national.js:sicherState`), ein Schritt 3→4 wäre leer. Ein Stand aus einer neueren Fassung wird laut abgelehnt. **Gegengemessen:** ein nachgebauter Stufe-2-Stand lädt und bekommt 288 Ligaphasenpartien statt 24; ein nachgebauter Stufe-3-Stand (ohne `state.national`, `club.chemie`, `player.mentor`) lädt, spielt 45 Tage fehlerfrei weiter und hat danach 55 Chemiepaare. |
| Prüfskripte | **Tief** | **23 Skripte, 16.976 Zeilen**, dazu seit Stufe 6 `tools/check-suite.js` als Aufmarsch: `npm run check` startet jedes Skript in einem eigenen Node-Prozess, misst die Laufzeiten und endet mit Exit 1, sobald eines rot ist. **Die Liste wird nicht gepflegt, sondern gelesen** — wer morgen `tools/test-kabine.js` anlegt, läuft ab dem nächsten Lauf mit. Ausgenommen sind nur `server.js` und die Suite selbst, beide mit Begründung im Quelltext. Alles jenseits von Tag 120 ist über `test-saison.js`, `test-karriere.js`, `test-europa.js` und `test-chemie.js` (je drei Saisons) und `test-spielstand.js` (acht) gedeckt, die Oberfläche seit Abschnitt 8 über `test-screens.js`; ohne Test bleiben `media.js`, `board.js` und `staff.js`. |
| Ton | **Tief** | `render/sound.js` (1.513 Zeilen), rein prozedural über WebAudio — 16 Klänge, 4 Gongarten, 4 Aliase, Stadionatmosphäre mit selbst berechneter Impulsantwort. **Keine Audiodatei im Projekt.** Ohne AudioContext (Node, alter Browser) liefert `createSoundBank()` eine vollständige stumme Attrappe mit `verfuegbar === false`; der Import in Node wirft nicht. Geprüft von `tools/check-sound.js` (37 Prüfungen). |
| Oberfläche unter Last | **Tief** | Kein Test *im Projekt* fährt die Bildschirme gegen ein DOM. Die Abnahmen von Stufe 2 (16 Bildschirme, 980 Klicks), Stufe 3 (17, 5.946 Bedienungen), Stufe 4 (17, drei Zeitpunkte, 3.996 Bedienungen) und Stufe 6 (**19, zwei Zeitpunkte, 931 Bedienungen, 0 Laufzeitfehler**) haben das je mit einem Wegwerf-Harnisch getan — **alle vier liegen nicht in `tools/`** und laufen in keiner Suite mit. Viermal derselbe Aufwand; siehe 5.5 und Abschnitt 8. |
| Bedienung | **Tief** | Tastenkürzel für alle 17 Reiter (1…9, 0, Q W E R T Z U), Strg+S zum Speichern, Strg+Umschalt+E für den Editor, Fokusfalle im Dialog, `:focus-visible`-Ringe an allen 585 gemessenen Bedienelementen und seit Stufe 6 eine durchgehende **Escape-Kette**: Überlagerungen → `screen.onEscape()` → Fokus loslassen → zurück ins Büro. Gemessen: aus allen 19 Bildschirmen führt ESC ins Büro, ohne je einen offenen Dialog zu überspringen; bei zwei gestapelten Dialogen nimmt ESC nur den obersten. **Was fehlt:** eine Tastaturbedienung, mit der sich die fünf Minispiele auch *gewinnen* lassen — die `keydown`-Pfade gibt es seit Stufe 2, ob sie ausreichen, hat nie jemand gemessen. |

---

## 2. Was zuerst weg muss

Nach Dringlichkeit sortiert. Alles hier war bei der Bestandsaufnahme im Spiel sichtbar oder
messbar.

**Stand nach Stufe 6 — die Schlussbilanz der sieben Befunde:**

| | Befund | Stand | Erledigt in |
|---|---|---|---|
| **S1** | Der Saisonwechsel ist eine Attrappe | **behoben** | Stufe 1 |
| **S2** | Der Europapokal existiert nur auf dem Papier | **behoben** | Stufe 3 |
| **S3** | Spielstandwachstum ohne Bremse | **behoben** — `state.js:verdichteVergangenheit()`, aufgerufen in `loop.js:saisonWechsel()`. 17,01 statt 20,56 MB nach acht Spielzeiten, Zuwachs sinkt von 1,66 auf 1,00 MB je Jahr | Abschnitt 8 |
| **S4** | Kein Ton | **behoben** | Stufe 2 |
| **S5** | Bedienung (Tasten, Einstellungen, Dialoge, kleine Bildschirme) | **behoben** — der letzte offene Punkt (Breakpoints unter 1000 px) fiel in Stufe 6 | Stufe 2 + 6 |
| **S6** | Zwei Torschnitt-Wahrheiten in der Dokumentation | **behoben** | vor Stufe 5 |
| **S7** | Dokumentation zeigt auf Dateien, die es nicht gibt | **behoben** — seit Stufe 6 startet `npm run check` wirklich alle Skripte, und die README zählt alle 21 einzeln auf | Stufe 6 |

~~**Sechs von sieben sind erledigt. Der eine, der bleibt, ist S3.**~~ — **Alle sieben sind
erledigt.** S3 fiel als erster Punkt von Abschnitt 8, zwei Stufen nachdem er zuerst
aufgeschrieben wurde. Er war nie ein Hindernis für eine Ausbaustufe und stand deshalb immer
hinter etwas Sichtbarerem an; genau daran lässt sich ablesen, wie lange ein Befund
überleben kann, der niemandem im Weg steht.

### S1 — Der Saisonwechsel ist eine Attrappe · **erledigt in Stufe 1**

Behoben durch `core/loop.js:saisonWechsel`, `club/karriere.js`, `screens/saison.js` und
`state.leagues`. Nachgewiesen von `tools/test-saison.js` (15 Zusicherungen über drei
Saisons), `tools/test-karriere.js` und `tools/test-europa.js`.

**Mit einer Einschränkung, die teuer war:** Stufe 1 hatte keine eigene Abnahme. Zwei Stufen
später kam heraus, dass der Saisonwechsel in `club/medical.js` nie ankam — Sperren liefen nie
ab, und ab Saison 3 konnte kein Verein mehr elf Spieler aufbieten (5.3). Der Befund unten ist
also erledigt, aber die Art, wie er erledigt wurde, hat eine Rechnung hinterlassen.

<details><summary>Ursprünglicher Befund (nicht mehr zutreffend)</summary>

`src/main.js:462–488` (`saisonEnde`) ist der **einzige** Ort im Projekt, an dem eine Saison
endet. Er tut: Saison hochzählen, Tag auf 0, Vereinsform leeren, **alle** Fixtures auf
`played = false` zurücksetzen, Statistiken in `career` umbuchen, `p.age++`. Der Kommentar
in Zeile 472 sagt es selbst: *„Saisonwechsel: vorerst einfacher Neustart des Kalenders"*.

Gemessen an einem Durchlauf über 364 Tage plus Saisonwechsel plus 120 weitere Tage:

| Symptom | Messung |
|---|---|
| **Kein Auf-/Abstieg** | Die Absteiger der Saison 1 spielen Saison 2 erneut erstklassig, die Aufsteiger bleiben unten. `qualificationFor()` in `leagues.js:988` liefert `meister`/`cl`/`el`/`conf`/`relegation`/`abstieg`/`aufstieg` fertig aus — die Funktion wird von `board.js` und `media.js` für Texte benutzt, aber ihr Ergebnis hat nie eine Folge. |
| **Identischer Ligaspielplan** | 1. Spieltag Saison 2 = 1. Spieltag Saison 1, Paarung für Paarung, Heimrecht für Heimrecht. |
| **Der Pokal wird nachgespielt statt neu gelost** | 63 alte Pokalpaarungen aller sechs Runden stehen wieder als „ungespielt" im Plan. Ein Verein hat sein Achtel- und Viertelfinale in Saison 2 fest terminiert, unabhängig davon, ob er die 1. Runde überlebt. `state.pokal.runde` bleibt bei 5, `pokalWeiterlosen()` steigt in `loop.js:282` sofort aus. |
| **Keine Karriereenden** | Nach 1,3 Saisons stehen Spieler mit 38+ Jahren unter Vertrag. Attribute bauen ab (`training.js`, `ABBAU_KURVE`), aber niemand hört auf. `p.retired` wird von `fans.js:1706` bereits respektiert — das Feld ist vorgesehen und wird nie gesetzt. |
| **Keine Regenerierung** | Kein Ersatz für Abgänge über den Jugendjahrgang hinaus. Die Ligastärke tropft über Jahre weg. |
| **Keine Titelchronik** | `state.history.titel` bleibt `{}`. Der Deutsche Meister wird in `loop.js:saisonAbschluss` ermittelt, in `history.seasons` abgelegt — und nie als Titel festgehalten. |
| **Manager altert nicht** | Bilanz 0/0/0, Erfahrung 0, Ruf 40 nach einer vollen Saison. |
| **Kein Europapokal** | Es gibt keine Qualifikation, weil es keinen Saisonabschluss gibt, der eine vergäbe. |

Der eine Teil, der funktioniert: Vertragsjahre. `restlaufzeit = contract.until − state.date.season`,
und `transfers.js:saisonEndeVertraege` räumt bei `ctx.isSeasonEnd` auf (rund 106 auslaufende
Verträge am Ende von Saison 1).

**Warum das zuerst weg muss:** Jeder weitere Inhalt — zweite Liga mit Legenden, Europapokal,
Chronik, Nationalmannschaft — setzt auf einer Karriere über mehrere Jahre auf. Wer vorher
Inhalte baut, baut sie zweimal.

</details>

### S2 — Der Europapokal existiert nur auf dem Papier · **erledigt in Stufe 3**

> *Ursprünglicher Befund:* `data/leagues.js` enthält 66 europäische Vereine, drei Wettbewerbe
> mit vollständigen Prämientabellen, acht Ligaphasen-Spieltage mit festen Terminen
> (`days: [77, 91, 112, 126, 147, 161, 210, 217]`), fünf K.-o.-Runden, Endspieltermine — und
> `generateEuropeSchedule()` **wird von keiner Zeile des Projekts aufgerufen**. Gemessen:
> 0 Europapokal-Fixtures nach einer kompletten Saison. `state.europa` bleibt leer.

Behoben. `src/club/europa.js` (1.459 Z.) treibt Qualifikation, Auslosung, Ligaphase,
K.-o.-Runden, Prämien und Doppelbelastung; `core/loop.js:advanceDay` ruft `tickEuropa()`,
`core/state.js:euroClub()` stellt die 66 Vereine mit `lazySquad: true` in `state.clubs`.
Gemessen über zwei Seeds und je drei Saisons: 423 Europapokalpartien je Saison, davon 288 in
der Ligaphase; alle 14 Zusicherungen von `tools/test-europa.js` grün. Der Bildschirm dazu ist
`src/screens/europa.js` (der 17.). Was dabei an Fehlern gefunden wurde, steht bei Stufe 3.

Auch das, was auf Europa gewartet hat, zieht jetzt: `board.js:europaLage`, die
`media.js`-Schlagzeilen `europapokal` und `doppelbelastung`, der Wettbewerbsfaktor 1,12 in
`stadium.js`, der Sponsorenbonus `europacup`, `CUP.europaPlatz = 'el'`.

### S3 — Spielstandwachstum ohne Bremse · **erledigt in Abschnitt 8**

**Behoben.** `core/state.js:verdichteVergangenheit()` verdichtet beim Saisonwechsel, was
Vergangenheit ist; aufgerufen wird sie in `core/loop.js:saisonWechsel()`, Abschnitt l.
`SAVE_VERSION` steht auf 4, ein alter Stand wird beim Laden gehoben. Gemessen über acht
Spielzeiten: **17,01 statt 20,56 MB**, und — wichtiger als die Größe — der jährliche
Zuwachs sinkt von 1,66 auf 1,00 MB, statt bei 1,5 MB stehen zu bleiben. Die Ruhmeshalle
zeigt dabei acht von acht Mal exakt dasselbe wie ohne Bremse. Die vollständigen Zahlen
stehen in Abschnitt 8.1, der Prüfstand ist `tools/test-spielstand.js` (11 Zusicherungen).

*Der Rest dieses Abschnitts ist der Befund, wie er über fünf Stufen dastand — er erklärt,
wovon die Bremse befreit hat.*

**Stand nach Stufe 6:** 11,96 MB nach 120 Tagen, **13,21 MB nach drei Saisons** (Seed 7,
HSV, mit `tools/check-suite.js` gegengemessen). Stufe 6 hat daran nichts geändert — Chronik
und Editor legen kein einziges neues Feld im Spielstand an, sie lesen nur, was schon
dasteht. Das war Absicht und ist der Grund, warum die letzte Ausbaustufe die billigste war.
Was blieb, war die alte Rechnung: rund 1,5 MB je Saison, und nichts im Projekt wurde je
einen Datensatz wieder los. Siehe 5.7 und Abschnitt 8.1.

Ursprünglich 6,56 MB nach 120 Tagen. **Gemessen nach Stufe 3** (Seeds 7 und 2024,
je drei volle Saisons, `tools/test-europa.js` Z10):

| Zeitpunkt | Spielstand | Spielerdatensätze |
|---|---|---|
| Anpfiff | 2,71 MB | 1.125 |
| Ende Saison 1 | 9,55 MB | 2.040–2.044 |
| Ende Saison 2 | 11,3 MB | 2.390–2.405 |
| Ende Saison 3 | **12,98 / 13,29 MB** | 2.735 / 2.779 |

(Die Zahlen sind nach Stufe 4 nachgemessen; vor Stufe 4 standen dort 12,83 / 13,01 MB.
`tools/test-europa.js` Z10 misst 12,98 MB, `tools/test-chemie.js` Z07 misst 13,48 MB — die
drei Skripte spielen die Partien des eigenen Vereins unterschiedlich ab. Die Größenordnung
ist dieselbe.)

**Was Stufe 4 gekostet hat: 280 kB, also 2,1 %** — gemessen am selben Spielstand, einmal mit
und einmal ohne die neuen Felder. Der Posten, um den die Roadmap sich Sorgen gemacht hat —
das paarweise Chemiegitter — ist mit **5,9 kB** der kleinste von allen. Teuer sind
`player.mentor` (114,8 kB, davon 59,3 kB allein der gespeicherte deutsche Begleitsatz, der
sich aus `chemie.js:mentorText()` jederzeit neu bauen lässt) und `player.national`
(107,9 kB).

Die Lazy-Regel hält, was sie versprochen hat: Nach drei Saisons haben **14 bzw. 16 von 66**
europäischen Vereinen einen Kader (280 bzw. 320 Spieler). Volle Kader für alle 66 hätten rund
1.400 Datensätze und etwa 1,4 MB gekostet.

Die Prüfschwelle liegt bei 15 MB — der Abstand beträgt noch **rund 1,7 MB, also etwa eine
weitere Saison**. Die Kompaktierung in `state.js:kompaktSpieler/kompaktVerein` kürzt
weiterhin nur Protokolle, nie Datensätze; gemessen bleiben nach drei Saisons **49 bzw. 61**
Spielerdatensätze ohne Verein, Nachwuchs oder Vertragslosenliste liegen — die
zurückgetretenen Spieler aus `club/karriere.js`, Tendenz steigend (17/20 nach Saison 1).

**Korrektur nach der Abnahme von Stufe 5:** Die hier veranschlagten „~0,8 MB für 18 weitere
Kader" hat es nie gegeben. Die 2. Liga stand auch vorher mit 432 Spielern im Spielstand, nur
prozedural erzeugt; Stufe 5 hat sie ersetzt, nicht hinzugefügt. Gemessen: **2,709 MB beim
Neustart gegen 2,713 MB vorher**, 12,83 gegen 12,86 MB nach 200 Tagen. ~~Die Bremse bleibt
fällig~~ — **gebaut, siehe oben.**

### S4 — Kein Ton · **erledigt in Stufe 2**

> *Ursprünglicher Befund:* Fünf Minispiele rufen `host.sound(...)` mit den Namen `klick`,
> `schuss`, `tor`, `parade`, `pfosten`, `block` auf. `matchday.js:421` liefert `() => { }`.
> Kein Stadionrauschen, kein Torjubel, kein Anpfiff.

Behoben. `src/render/sound.js` liefert die Bank, `matchday.js:klangbankHolen` reicht die
**eine** Bank des Rahmens (`main.js:klang`) an Spieltag und Minispiele durch. Gemessen an
einer vollständigen Partie: 1× `atmoStart`, 298× `atmo`, 46 Einzelklänge, 15 Gongs, 1×
`atmoStop`. Die Atmosphäre wird in jedem Ausgang wieder abgeräumt — auch wenn die
Simulation mittendrin wirft (`matchday.js:751–756`, `ton.aus()` im `finally`).

**Was bewusst offen blieb:** Der Stadionsprecher ist Gong plus Bildschirmtext, keine
Stimme — Sprachaufnahmen wären Assets und Persönlichkeitsrechte (so geplant, siehe
Stufe 2, Punkt 3).

### S5 — Bedienung · **erledigt in Stufe 2 und Stufe 6**

| Befund | Ort | Stand |
|---|---|---|
| Tasten `1`–`9` schalten Bildschirme, es gibt **14**. `jugend`, `medizin`, `stab`, `presse`, `verein` sind per Tastatur nicht erreichbar. | `main.js:231`, `constants.js:180` | **erledigt** — `main.js:TASTEN_FOLGE` legt `1`–`9`,`0`,`Q W E R T` über die 15 Reiter der Navigationsleiste. Nachgewiesen: jede Taste landet auf ihrem Bildschirm, Groß- wie Kleinschreibung, keine doppelte Belegung, keine Kollision mit Leertaste/Enter (Weiter) oder Strg+S (Speichern); im Eingabefeld und bei offenem Dialog wirken sie nicht. Die Belegung steht als Tabelle im Einstellungsbildschirm — aus `ctx.tasten`, nicht als zweite Wahrheit im Quelltext. |
| Vier Einstellungen (`autoAufstellung`, `textTempo`, `animationen`, `bestaetigungen`) werden von **keiner Zeile** gelesen. | `state.js:238–241` | **erledigt** — alle vier sind angeschlossen und mit beiden Werten gegengemessen, siehe Stufe 2 unten. |
| Minispiele sind reine Zeigerspiele, kein Tastaturpfad. | `interactive/*.js` | **erledigt** — alle fünf haben einen `keydown`-Pfad (Elfmeter und Freistoß Pfeiltasten + Leertaste, Ecke `1`–`4`/`A`/`D`, Abschluss `1`–`3`, Kombination `1`–`5`/`F`/`S`/`C`/`D`), überall bricht `ESC` zugunsten der Simulation ab. **Nicht** geprüft: ob sich eine Szene mit der Tastatur allein *gewinnen* lässt — der Abnahme-Harnisch hat die Minispiele nur anlaufen und auslaufen lassen, nicht gespielt. |
| Dialoge fangen den Fokus nicht ein. | `render/ui.js` | **erledigt** — `ui.js:604–613` hält Tab und Shift+Tab im obersten Dialog, `:690–692` setzt den Erstfokus auf den Primärknopf, `:708` gibt ihn beim Schließen zurück, `:599–603` schließt mit ESC. |
| Kleinste CSS-Schwelle liegt bei 1100 px. Unter ~1000 px unbenutzbar, auf Tablets im Hochformat gar nicht. | `styles/main.css:212` | **erledigt in Stufe 6** — zwei neue Rahmenstufen: bei **1080 px** wird der 210 px breite Aktenschrank zu einer 56 px schmalen Symbolleiste (alle 17 Reiter bleiben sichtbar, die Beschriftung geht in `title` und `aria-label`), bei **860 px** wird alles einspaltig. Dazu 1100 px für die Kachelgitter und 900 px für die Editor-Werkbank. Die Wahl „Leiste statt Schublade" ist in `styles/main.css` mit drei nachgerechneten Gründen belegt (Platz, Höhe, Zustandsfreiheit) — das ist der am besten begründete Kommentar außerhalb von `engine/match.js`. **Nicht erledigt und nicht geplant:** das Hochformat. |
| *(neu in Stufe 6)* Escape hatte außerhalb von Dialogen keine Bedeutung; wer in einem Filterfeld stand, kam ohne Maus nicht heraus. | `main.js:escapeKette` | **erledigt** — vierstufige Kette (Überlagerungen → `screen.onEscape()` → Fokus loslassen → Büro). Gemessen über alle 19 Bildschirme, mit offenem Dialog, mit zwei gestapelten Dialogen und mit Fokus im Eingabefeld: kein Fall, in dem ESC einen offenen Dialog überspringt. |

### S6 — Zwei Torschnitt-Wahrheiten in der Dokumentation · *klein, aber irreführend*

Hier liegt ein **Widerspruch zwischen zwei Stellen im Projekt**, der aufgelöst gehört:

| Quelle | Aussage |
|---|---|
| `engine/match.js:132–136` | *„Die Trefferquote ist in der 1. Bundesliga und in einer prozedural erzeugten Durchschnittsliga exakt gleich (11,5 %). Dass die Bundesliga hier bei rund 3,4 statt 2,9 Toren liegt, kommt allein daher, dass die Vereinslegenden ~20 % mehr Abschlüsse herausspielen — **das ist gewollt und kein Fehler der Simulation**."* |
| `check-all.js:472–477` | Die Fehlermeldung des Prüfskripts nennt denselben Mechanismus, rahmt ihn aber als Mangel: *„Der Rest steckt in der Abschlussgüte: `MATCH_CONSTANTS.xgSkillSpanne` spreizt stärker als `twWirkung` …"* |

**Entschieden wird zugunsten von `engine/match.js`.** Die Begründung ist messbar und
überzeugend: Wenn die Trefferquote in beiden Ligen identisch ist, ist die Abschlussgüte
*nicht* das Problem — dann ist der Unterschied reine Chancenmenge, und dass eine Elf aus
Beckenbauer, Netzer und Seeler mehr Chancen erspielt als ein prozeduraler Zweitligakader,
ist genau der Punkt des Spiels.

Daraus folgt konkret:

1. Die Fehlermeldung in `check-all.js:472–477` gehört umformuliert. Sie beschreibt heute
   einen Bug, der keiner ist, und schickt den nächsten Entwickler in eine Sackgasse.
2. Der Zielkorridor gehört **je Liga getrennt**: `test-match.js` prüft synthetische Kader
   gegen 2,8–3,2 (gemessen 2,91, korrekt). Für die Bundesliga mit Legendenkadern ist rund
   3,4 der Sollwert, nicht die Ausnahme.
3. Die einzige Zahl, die tatsächlich offen ist: **Die 2. Bundesliga liegt bei 2,66** und
   damit unter dem Korridor für prozedurale Kader. Über 90 Partien ist das noch keine
   belastbare Stichprobe — bevor jemand daran dreht, gehört das über eine ganze Saison
   und mehrere Seeds gemessen.

**Stand nach Stufe 5: alle drei Punkte erledigt.** Die Meldung in `check-all.js` ist
umformuliert, die Korridore sind nach Ligatyp getrennt (5.8), und die offene Zahl hat sich
von selbst beantwortet — die 2. Liga spielt jetzt mit Legendenkadern und liegt über acht
Seeds à 200 Tage bei ⌀ 3,38 Toren (3,14–3,58), die 1. Liga bei ⌀ 3,58 (3,20–3,74). Die
Trefferquote, die laut `engine/match.js` in beiden Fällen gleich sein *muss*, liegt bei
11,89 % gegen 11,65 % — 0,24 Prozentpunkte auseinander. Die These von `engine/match.js` hat
sich damit an einem zweiten, unabhängigen Fall bestätigt: Der Unterschied im Torschnitt ist
Chancenmenge, nicht Abschlussgüte.

**Sperrgebiet-Hinweis:** `engine/match.js` und `engine/ratings.js` sind für Beiarbeiten
tabu. Wenn an der Balance gedreht wird, dann in einer eigenen, isolierten Aufgabe mit
`test-match.js` als Messlatte — nie nebenbei.

### S7 — Dokumentation zeigt auf Dateien, die es nicht gibt · **erledigt**

> *Ursprünglicher Befund:* `README.md:86–87` nennt `tools/check-engine.js` und
> `tools/test-training.js`, `package.json` nennt als `npm run check` die Datei
> `tools/check.js`. Alle drei fehlen.

Behoben. ~~`npm run check` zeigt auf `tools/check-all.js`~~ — **seit Stufe 6 zeigt es auf
`tools/check-suite.js` und startet damit wirklich alle 21 Skripte**, nicht nur eines. Bis
dahin übersprang `npm run check` still zwanzig Prüfungen, darunter genau die, die in den
Stufen 3 bis 5 die schwersten Funde gemacht hatten. Der Restposten ist damit weg: Die
README zählt alle 21 Skripte einzeln mit einer Zeile auf, was sie prüfen.

Die Suite **liest** das Verzeichnis, statt eine Liste zu pflegen — genau daran war die alte
Fassung gescheitert. Ausgenommen sind nur `server.js` und die Suite selbst, beide mit
Begründung im Quelltext. Ein zweiter Fund derselben Art fiel bei der Abnahme mit ab:
`index.html` empfahl im Startfehler-Text ausgerechnet `python3 -m http.server` — den einen
Server, vor dem der Kopf von `tools/server.js` mit Begründung warnt. Auch das ist korrigiert.

---

## 3. Ausbaustufen

Sechs Stufen. Aufwand: **S** bis ~1 Arbeitstag, **M** 2–4 Tage, **L** 1–2 Wochen,
**XL** mehr. „Risiko" bewertet die Gefahr, Bestehendes zu beschädigen — nicht die
Schwierigkeit.

---

### Stufe 1 — „Die Saison schließt sich"

**Ziel:** Eine Karriere über zehn Jahre, in der sich nichts wiederholt. Das ist die
Voraussetzung für fast alles andere und behebt S1.

**Umfang**

1. **Saisonwechsel raus aus der Oberfläche.** Neu: `saisonWechsel(state, ctx)` in
   `core/loop.js`, direkt neben `saisonAbschluss` (das heute nur *bewertet*). `main.js`
   ruft auf und zeigt an. Ohne diesen Schnitt ist der Übergang von keinem Testskript
   erreichbar — siehe 5.2.
2. **Ligazugehörigkeit in den State.** `state.leagues = { bl1: { clubIds: [...] }, bl2: {…} }`,
   angelegt in `core/state.js`, gelesen von `loop.js:aktualisiereTabellen`. `LEAGUES` aus
   `data/leagues.js` bleibt die Vorlage für Saison 1 und die Quelle für Prämien, Termine
   und Regeln — aber nicht mehr die Wahrheit über die Zugehörigkeit.
3. **Auf-/Abstieg und Relegation.** `qualificationFor()` liefert die Wertung fertig; sie
   muss nur angewendet werden. Relegation als echtes Hin- und Rückspiel (Platz 16 BL1
   gegen Platz 3 BL2).
4. **Neue Spielpläne.** `generateFixtures()` je Liga mit neu gemischten Slots. Fixtures der
   Vorsaison verdichten oder verwerfen (siehe S3) — auf keinen Fall unverändert liegen lassen.
5. **Pokal neu auslosen.** `state.pokal` zurücksetzen, `generateCupDraw(rng, …, 0, null, saison)`.
   Alte Pokalfixtures **müssen** aus `state.fixtures` verschwinden, sonst bleibt der Fehler
   aus S1 bestehen.
6. **Karriereenden.** Rücktrittswahrscheinlichkeit aus Alter, Restpotenzial, Einsatzminuten
   und Verletzungshistorie. Abschiedsspiel als Postnachricht, Eintrag in die Chronik.
   `p.retired` setzen — `fans.js:1706` wertet es bereits aus.
7. **Regenerierung.** Für jeden Abgang ein neues Talent, damit die Ligastärke nicht
   wegtropft. `generateYouthProspect` und `generateFreeAgent` sind vorhanden und getestet.
8. **Manager-Karriere.** `manager.bilanz` nach jedem Spiel fortschreiben (der Ort dafür ist
   `loop.js:applyResult`), `erfahrung`/`level` nach Saisonende, `skills` langsam steigen
   lassen, `reputation` bei Erfolg heben, `titel` füllen. Alle Felder existieren und werden
   bereits gelesen — u. a. von `loop.js:coachBonusOf`, wo sie heute konstant 45 liefern.
9. **Titelchronik.** `state.history.titel[saison] = { meister, pokalsieger, absteiger,
   aufsteiger, torschuetzenkoenig }`, plus Rekordlisten als Grundlage für Stufe 6.
10. **Saisonabschluss-Bildschirm** statt des heutigen Drei-Absatz-Dialogs: Abschlusstabelle,
    Torschützenkrone, Auf- und Absteiger, Elf der Saison, Vorstandsurteil, Vertragsangebote.

**Aufwand:** L–XL · **Risiko:** hoch

**Abhängigkeiten / Kollateralschäden:** Berührt `core/state.js` und `core/loop.js`, also
das Fundament. `leagueOfClub()` wird an **10 Stellen** in sechs Dateien aufgerufen
(`sponsors.js` 2×, `media.js` 1×, `board.js` 1×, `finances.js` 3×, `transfers.js` 2×,
`screens/transfer.js` 1×). Glücksfall: **jede** dieser Stellen bevorzugt bereits
`club.leagueId` und nutzt `leagueOfClub()` nur als Rückfallebene — das macht den Umbau
machbar. Er muss aber vollständig sein, sonst entstehen zwei Wahrheiten über die
Ligazugehörigkeit. `state.tables` ist nach Liga-ID indiziert und bleibt unverändert.
`state.js:migrate()` muss zum ersten Mal wirklich etwas tun — Stufe 1 bricht das Schema.

**Prüfung:** Neues `tools/test-saison.js`, das **drei Saisons** durchspielt und zusichert:
jede Liga hat immer 18 Vereine · kein Verein in zwei Ligen · das Pokalfeld umfasst jede
Saison 64 Mannschaften mit frischer Auslosung · kein Spielplan wiederholt sich · kein
Spieler älter als 42 unter Vertrag · Kadergrößen zwischen 18 und 32 · Manager-Bilanz
stimmt mit der Zahl der gespielten Partien überein · Spielstand unter 15 MB.
**Dieses Skript zuerst schreiben, dann die Stufe bauen.**

---

### Stufe 2 — „Ton und Stadion" · **gebaut und abgenommen**

**Ziel:** Das Spiel klingt, und man kann die Minispiele üben, statt sie im Pokalfinale zum
ersten Mal zu sehen. Behebt S4 und den Einstellungsteil von S5.

Diese Stufe steht bewusst an zweiter Stelle: Sie ist die einzige mit **niedrigem Risiko
bei hoher spürbarer Wirkung**, sie hängt von nichts ab, und nach dem schweren Umbau in
Stufe 1 ist sie die richtige Belohnung.

#### Stand der Abnahme

Alle sechs Punkte sind umgesetzt. Was dabei geprüft wurde und was **nicht**:

| Punkt | Umgesetzt in | Nachweis |
|---|---|---|
| 1 Tonschicht | `src/render/sound.js` (1.513 Z.) | `tools/check-sound.js`: 37 Prüfungen grün. 16 Klänge, 4 Gongarten, 4 Aliase. Keine Audiodatei, kein `Math.random()`, kein `Date.now()`. Import in Node wirft nicht, `createSoundBank()` liefert dort eine vollständige Attrappe mit `verfuegbar === false`. |
| 2 Stadionatmosphäre | `matchday.js:tonRegie` | Über eine volle Partie: 1× `atmoStart`, 298× `atmo`, 1× `atmoStop`. Mit `atmosphaere: false` **kein einziges** `atmoStart`; mit `klaenge: false` **kein einziger** `play()`/`gong()`. Nach einem erzwungenen Absturz der Simulation bleibt nichts offen. |
| 3 Stadionsprecher | Gong + Ticker | Wie geplant ohne Stimme. |
| 4 Übungsplatz | `screens/training.js:1414 ff.` (Abschnitt 11) | Alle fünf Minispiele starten aus dem Trainingsbildschirm, bauen ihre Bühne auf und laufen wieder aus. Ein serialisierter Spielstand vor und nach einer Einheit ist **byteweise identisch** — bis auf `club.training.uebungsplatz`. |
| 5 Einstellungsbildschirm | `screens/einstellungen.js` (446 Z.) | Eigener Reiter (Taste `T`). Alle vier toten Einstellungen angeschlossen, jede mit beiden Werten gegengemessen — siehe Tabelle unten. |
| 6 Schiedsrichter | `matchday.js:schiedsrichterFuer` | Über alle 644 Fixtures einer Saison: gleiche Fixture-ID ⇒ identische Akte (Name, Strenge, Heimbonus, Kartenschnitt, Spitzname). Unabhängig von der Aufrufreihenfolge — die Ansetzung verbraucht **keinen** RNG-Strom, sie ist ein FNV-1a-Streuwert über die Fixture-ID. 34 von 34 Unparteiischen kommen zum Zug (12–26 Ansetzungen je Person). |

**Die vier früher toten Einstellungen — wer sie liest und wie es gemessen wurde:**

| Einstellung | Gelesen in | Messung mit beiden Werten |
|---|---|---|
| `autoAufstellung` | `loop.js:68` (`autoAufstellungAnwenden`, gerufen aus `advanceDay` an zwei Stellen) | Elf absichtlich mit den schwächsten Spielern besetzt, dann bis zum Spieltag vorgeschaltet. **Aus:** Aufstellung unverändert. **An:** umgestellt, Elfstärke 782 → 927. |
| `textTempo` | `matchday.js:530` (Faktor aus `TEXT_TEMPO`), angewandt in `pause()`, `matchday.js:628` | Zwei komplette Partien im Textmodus, gezählt wurde die Summe aller angeforderten Wartezeiten. **schnell:** 4.335 ms in 150 Pausen. **langsam:** 13.860 ms in 510 Pausen. |
| `animationen` | `matchday.js:533`, wirksam ab `:539` | Zwei komplette Partien in der Höhepunkte-Ansicht. **An:** Spielfeldbühne sichtbar. **Aus:** `ui.buehne.style.display === 'none'`, nur Ticker. |
| `bestaetigungen` | `ui.js:729` (`confirm`), gesetzt aus `main.js:272` und live aus `einstellungen.js:353` | **An:** `confirm()` öffnet den Dialog, „Abbrechen" liefert `false`. **Aus:** löst sofort zu `true` auf, ohne Overlay. **Aus + `{ immer: true }`:** fragt trotzdem (Spielstand löschen). Der Schalter im Einstellungsbildschirm zieht `ui.js` live nach, nicht erst beim nächsten Spielstart. |

**Beim Abnehmen gefunden und behoben:**

* `matchday.js:minispielStarten` schrieb bei jedem Start eines Minispiels ein Hilfsfeld
  `state.__mgRng = null` in den Spielstand (`rng: (state.__mgRng || (state.__mgRng = null)) || null`).
  Der Ausdruck war wirkungslos — `host.rng` wird 20 Zeilen später ohnehin mit der
  szeneneigenen RNG überschrieben —, landete aber über `JSON.stringify` in **jedem
  gespeicherten Spielstand** und brach das Versprechen des Übungsplatzes, außer seiner
  Statistik nichts anzufassen. Ersetzt durch `rng: null`. Gefunden hat es der Vergleich
  eines serialisierten Spielstands vor und nach der ersten Übungseinheit.
* `interactive/freekick.js:minigame.instructions` beschrieb dem Spieler nur den Mauspfad,
  obwohl das Minispiel Leertaste, Enter, `←`/`→` und `ESC` kennt. Text berichtigt.

**Was bewusst offen blieb:**

* Der Stadionsprecher bleibt stumm (Punkt 3, so geplant).
* Die CSS-Schwelle aus S5 (unter 1100 px unbenutzbar) ist **nicht** angefasst worden — sie
  gehörte nie zum Umfang dieser Stufe. Sie steht weiter in S5 und gehört zu Stufe 6.
  *(Nachtrag: in Stufe 6 erledigt — 1080 px Symbolleiste, 860 px einspaltig.)*
* Der Abnahme-Harnisch, der alle 16 Bildschirme gegen ein echtes DOM fährt, liegt im
  Wegwerfverzeichnis und **nicht** in `tools/`. Damit ist die Oberfläche nach wie vor durch
  keine laufende Suite gedeckt — siehe 5.5.
* Ob sich ein Minispiel mit der Tastatur allein *gewinnen* lässt, ist ungeprüft. Der Harnisch
  hat die fünf Szenen nur anlaufen und in ihre eigenen Zeitschranken laufen lassen.

**Umfang (ursprüngliche Planung)**

1. **Tonschicht** `src/render/sound.js`: `createSoundBank()` → `sound(name, opts)`.
   Rein prozedural über WebAudio (Oszillatoren, Rauschen, Filter, Hüllkurven) — **keine
   Audiodateien**, damit die Regel „keine Abhängigkeiten, kein Build" unangetastet bleibt
   und der Spielstand nicht wächst. Die Klangnamen sind bereits verdrahtet: `klick`,
   `schuss`, `tor`, `parade`, `pfosten`, `block`. Nur `matchday.js:421` muss die echte
   Bank statt `() => {}` liefern.
2. **Stadionatmosphäre:** Grundrauschen, dessen Lautstärke an Zuschauerzahl, Auslastung,
   Fanstimmung und Spielstand hängt (`fans.js:stimmung` und `stadium.js:zuschauerBerechnen`
   liefern die Werte bereits). Anschwellen bei Angriffen, Torjubel, Pfeifkonzert bei
   Rückstand, Auswärtsblock hörbar abgesetzt.
3. **Stadionsprecher** ohne Sprachmaterial: Gong plus Bildschirmtext. Der Ticker liefert
   die Sprache schon, Sprachaufnahmen wären Assets und Persönlichkeitsrechte.
4. **Trainingsmodus** auf dem Trainingsbildschirm: jedes Minispiel einzeln startbar, mit
   echten eigenen Spielern, ohne Spielwirkung, mit kleiner Statistik („12 von 20 Elfmetern").
   Technisch billig — `matchday.js:minispielStarten` ist schon eine eigenständige Bühne und
   braucht nur einen zweiten Aufrufer und einen synthetischen `KeyMoment`.
5. **Einstellungsbildschirm** (eigener Reiter oder Teil von `verein.js`): Ansichtsstufe,
   Eingreifen, Minispielauswahl je Szenenart, Tempo, Lautstärke, Textgeschwindigkeit.
   Dabei die vier toten Einstellungen aus S5 entweder anschließen oder aus `state.js`
   ersatzlos entfernen — beides ist besser als der heutige Zustand.
6. **Schiedsrichter ansetzen:** `spieltag.js:348` durch einen echten Namen aus
   `REFEREE_NAMES` ersetzen, deterministisch aus Fixture-ID gezogen, mit `strictness` und
   `homeBias` je Schiedsrichter. Danach eine Schiedsrichter-Akte im Vorbericht („pfeift
   streng, 4,8 Karten im Schnitt"). Rein additiv, wirkt sofort.

**Aufwand:** M · **Risiko:** niedrig — *rückblickend zutreffend: keine Balancezahl bewegt,
alle 17 Prüfskripte blieben grün.*

**Abhängigkeiten:** keine. Kann jederzeit vorgezogen werden.

---

### Stufe 3 — „Europa" · **gebaut und abgenommen**

**Ziel:** Aus dem Datengerüst einen Wettbewerb machen, der Geld, Terminstress und
Schlagzeilen erzeugt. Behebt S2.

#### Stand der Abnahme

Alle sieben Punkte sind umgesetzt. Was dabei geprüft wurde, mit welchem Ergebnis — und was
**nicht**:

| Punkt | Umgesetzt in | Nachweis |
|---|---|---|
| 1 Qualifikation | `club/europa.js:qualifikationErmitteln`, gerufen aus `loop.js:saisonWechsel` | `test-europa.js` Z01/Z02 über sechs Spielzeiten: 7 oder 8 Startplätze, Nachrückregel greift, kein Verein hat zwei. |
| 2 Vereine in `state.clubs` | `core/state.js:euroClub` (+`initClubRuntime`) | 66 von 66 nach `createNewGame()`. Z09: nach drei Saisons haben **14–16** einen Kader, und **kein** Kader entsteht ohne ein Spiel gegen den Verein. |
| 3 Ligaphase | `club/europa.js:ligaphaseAnsetzen` über `generateEuropeSchedule()` | Z03 über sechs Spielzeiten: je Teilnehmer 8 Spiele gegen 8 verschiedene Gegner, 4 Heim / 4 Auswärts. 288 Ligaphasenpartien je Saison. |
| 4 K.-o.-Runden | `club/europa.js:duellEntscheiden`, `engine/shootout.js` (neu), `tools/test-shootout.js` | Z06/Z07: kein Duell endet unentschieden, jede Saison genau ein Sieger je Wettbewerb. Der Münzwurf in `loop.js:pokalWeiterlosen` ist mit ersetzt. |
| 5 Prämien | `club/europa.js:europaPraemien` → `finances.js:praemieErhalten` | Z08: CL 20–140 Mio, Conference 3–25 Mio. Summe je Saison 221–330 Mio an 7–8 Vereine. Z13: höchstens 12 von 36 Profivereinen im Minus, keiner unter −60 Mio. |
| 6 Doppelbelastung | `club/europa.js:belastungBuchen` (Reise, Intensität, Härte) | Z11, siehe unten — **teilweise nachweisbar**. Die Terminverdichtung ist eindeutig belegt, die Wirkung auf die Verletzungszahl nur über einen ganzen Lauf. |
| 7 Bildschirm | `src/screens/europa.js` (der 17.) | Harnisch: 719–827 Knoten, Reiter je Wettbewerb, 0 Laufzeitfehler an Tag 1 und Tag 201. |

**Gemessen bei der Abnahme** (Seeds 7 und 2024, je drei volle Saisons, sofern nicht anders
angegeben):

| Frage | Ergebnis |
|---|---|
| Terminkollisionen über Liga, Pokal und alle drei Europapokale | **0** in sechs Spielzeiten. Kein Verein hat je zwei Pflichtspiele am selben Tag. |
| Spielstand nach drei Saisons | **12,83 / 13,01 MB** (Grenze 15 MB). Start 2,71 MB. Siehe S3. |
| Europäische Vereine mit Kader nach drei Saisons | **14 bzw. 16 von 66** (280 bzw. 320 Spieler). |
| Prämienschere nach drei Saisons | Europateilnehmer im Schnitt **+155 bzw. +167 Mio** gegenüber dem Rest der beiden Profiligen. Bestes Konto 747 bzw. 828 Mio. Siehe 5.10. |
| Verweise auf entfernte Partien oder Spieler europäischer Vereine | **0**. Was liegen bleibt, sind 49 bzw. 61 Datensätze zurückgetretener Spieler — ein Altlastenproblem aus Stufe 1, nicht aus Europa (S3). |
| Determinismus | Z14 grün: gleicher Seed ⇒ identische Teilnehmer, Auslosung, Duelle und Sieger über zwei Saisons. |
| Alle 17 Bildschirme gegen ein echtes DOM | Tag 1 und Tag 201, **5.946 Bedienungen**, 439 Navigationen, **0 Laufzeitfehler**. |

**Beim Abnehmen gefunden und behoben:**

* **`src/club/medical.js` — der Saisonreset lief seit Stufe 1 kein einziges Mal.** Er hing an
  `if (day === 0)`, aber `core/loop.js:advanceDay` zählt den Tag hoch, **bevor** es die
  Vereinsmodule ruft: Der erste Tick einer Saison sieht Tag 1, Tag 0 kam nie an. Folge:
  `k.sperrCursor` blieb auf 363 stehen, `verpassteSpieleNachholen()` stieg jeden Tag sofort
  wieder aus und rief damit `sperrenAbbauen()` nie — **Sperren liefen nie ab.** Gemessen
  (Seed 2024): Ende Saison 1 63 gesperrte Spieler und kein Verein in Not; Ende Saison 2
  **596 Gesperrte, und 25 der 36 Vereine konnten keine elf Mann mehr aufbieten**; in Saison 3
  traf das **alle 36**, die meisten mit null verfügbaren Spielern. Die Match-Engine lieferte
  für solche Partien keine Spielerstatistik mehr, also gab es weder Einsätze noch Belastung
  noch Spielverletzungen: die gebuchten Einsatzminuten fielen von 1,42 Mio (Saison 1) auf
  0,32 Mio (Saison 3), die Spielverletzungen von 103 auf 37. Nebenbei liefen
  `verletzungenSaison` und `ausfalltage.saison` als Mehrjahressummen weiter und logen den
  Medizinbildschirm an. Der Wechsel wird jetzt an der Saisonnummer erkannt
  (`k.saison !== state.date.season`) — derselbe Weg, den `finances.js` mit `abrechnungSaison`
  geht. Danach: 130 bzw. 152 Gesperrte am Saisonende, Gelbe Karten 2.622 / 2.732 / 2.724
  statt 2.622 / 4.932 / 5.690. **Das war der schwerste Fund dieser Abnahme, und er war kein
  Europafehler — Europa hat ihn nur sichtbar gemacht.**
* **`src/core/state.js` + `src/core/constants.js` — ein Spielstand aus Stufe 2 verlor Europa
  stillschweigend.** `SAVE_VERSION` stand weiter auf 2, also lief `migrate()` für einen
  Stufe-2-Stand gar nicht erst an. Der Stand lud ohne Fehler, hatte aber **keinen einzigen**
  der 66 europäischen Vereine in `state.clubs`; `club/europa.js` loste daraufhin nur die
  deutschen Teilnehmer gegeneinander — gemessen **24 statt 288** Ligaphasenpartien, und das
  für den Rest der Karriere. Genau der Fall, den der Grundsatz über `migrate()` („lieber laut
  scheitern als still das Falsche laden") ausschließen sollte. `SAVE_VERSION` steht jetzt auf
  3, die Migration 2→3 trägt die Vereine nach und meldet das über `console.warn`. Gegenprobe:
  derselbe Stand liefert danach 288 Partien und 66 von 66 Vereinen.
* **`tools/test-europa.js` — Zusicherung Z11 konnte ihre eigene Frage nicht beantworten.** Sie
  stellte die Europateilnehmer gegen den Rest der 1. Liga und verglich `verletzungenSaison`.
  Beide Gruppen unterscheiden sich aber strukturell (medizinische Abteilung 82–86 gegen 75–79
  Punkte, breitere Kader, robustere Spieler), und rund zwei Drittel aller Ausfälle entstehen
  im Training, nicht im Spiel — die Mehrspiele können darauf gar nicht wirken. Über neun
  Spielzeiten (Seeds 2024, 7, 11) traf der Verletzungsvergleich je Saison 7 von 9 Mal zu, die
  Ausfalltage nur 3 von 9 Mal: Rauschen. Neu wird dreistufig geprüft — je Saison
  deterministisch **mehr Pflichtspiele** und **mehr Belastungsspitzen** (Spieltage mit ≥ 4
  Pflichtspielen in 15 Tagen, also genau der Wert, den `medical.js:risikoFaktoren` in
  Risiko umrechnet; gemessen 24–27 gegen 2–5, **9 von 9** Spielzeiten), und einmal je Lauf
  über alle Saisons zusammengefasst **mehr Verletzungen** (Seed 7: 9,7 gegen 8,0 je Verein
  und Saison über 23 bzw. 31 Vereinssaisons; Seed 2024: 7,8 gegen 7,3 — dasselbe Vorzeichen
  in allen drei geprüften Seeds, aber der Abstand ist dünn).

**Was bewusst offen blieb:**

* **Die Doppelbelastung tut noch zu wenig weh.** Zwölf bis dreizehn Mehrspiele bringen rund
  eine zusätzliche Verletzung je Verein und Saison. Über eine einzelne Saison ist das vom
  Gruppenunterschied nicht zu trennen. Härtere Werte hat schon der Erbauer gegengeprüft
  (Reise 12/5, Intensität 1,5, Härte +20) — sie brachten nur mehr Streuung. Der eigentliche
  Hebel liegt woanders: Solange zwei Drittel der Ausfälle aus dem Training kommen und das
  Training **nicht** weiß, dass die Mannschaft mittwochs in Piräus war, kann Spieldichte
  nicht durchschlagen. Das gehört in eine eigene Aufgabe an `club/training.js` mit
  `test-medizin.js` als Messlatte, nicht nebenbei — siehe 5.11.
* **Die Prämienschere ist nicht angefasst worden** (5.10). Sie ist gemessen und benannt,
  aber jede Gegenmaßnahme verschiebt `check-all.js` und `test-wirtschaft.js`.
* **Sperren, die nur im eigenen Wettbewerb ablaufen**, bleiben bei ausgeschiedenen Vereinen
  hängen (5.12). Nach dem Reset-Fix sind es 130–152 statt 596–834; die Restmenge ist klein,
  aber sie wächst über die Jahre weiter.
* **Der Abnahme-Harnisch für die 17 Bildschirme liegt wieder im Wegwerfverzeichnis**, nicht
  in `tools/`. Die Oberfläche ist damit weiterhin durch keine laufende Suite gedeckt (5.5).
* **Der Übungsplatz und die Minispiele** sind vom Harnisch nur angelaufen worden, nicht
  gespielt — wie schon bei Stufe 2.

**Umfang (ursprüngliche Planung)**

1. **Qualifikation** am Saisonende aus der Abschlusstabelle (`europeSpots: { cl: 4, el: 2,
   conf: 1 }`) plus Pokalsieger (`CUP.europaPlatz = 'el'`), mit Nachrückregel, wenn der
   Pokalsieger bereits qualifiziert ist. Braucht Stufe 1.
2. **Europäische Vereine in `state.clubs`** — mit demselben Trick wie die Amateure:
   `lazySquad: true`, der Kader entsteht erst beim ersten Spiel gegen sie
   (`state.js:ensureSquad`). Dazu ein `euroClub()` neben `amateurClub()`, das aus
   `reputation` und `country` Farben, Trikot, Wappen und Stadion ableitet. `render/kits.js`
   zeichnet Flaggen für die Länder bereits.
3. **Ligaphase** über `generateEuropeSchedule()`: 8 Spieltage, je vier Heim- und vier
   Auswärtsspiele, CL Di/Mi (`dayOffsets: [0, 1]`), EL und Conference Do (`[2]`).
   Die Tabelle kann `computeTable()` ohne Änderung berechnen — die Funktion ist
   wettbewerbsunabhängig.
4. **K.-o.-Runden** mit Hin- und Rückspiel. Auswärtstorregel: **ja oder nein entscheiden
   und im Code dokumentieren**, nicht offen lassen. Elfmeterschießen einführen — hier
   zahlt sich `interactive/penalty.js` doppelt aus, und derselbe Mechanismus behebt
   nebenbei den Münzwurf in `loop.js:pokalWeiterlosen`. Auslosung als eigener kleiner
   Bildschirmmoment mit Töpfen.
5. **Prämien verbuchen** über `finances.js:praemieErhalten` nach
   `EURO.competitions[*].prizeMoney`. Start-, Sieg-, Remis-, Platz- und Rundenprämien sind
   alle beziffert. Achtung Wirtschaftsbalance: CL-Startgeld allein sind 18,6 Mio € — das
   verschiebt die Liga spürbar und muss gegen den Hinweis aus `check-all.js` (15 von 36
   Vereinen im Minus) gemessen werden.
6. **Doppelbelastung.** `medical.js:belastungssteuerung` und `training.js` reagieren bereits
   auf Spieldichte; drei Spiele in acht Tagen müssen weh tun. Die `media.js`-Schlagzeile
   `doppelbelastung` liegt mit Gewicht 7 im Katalog und wartet.
7. **Europapokal-Bildschirm** ausbauen: Ligaphasentabelle über 36 Vereine, eigener Weg,
   K.-o.-Baum, Gegnerporträt. Ersetzt den Dauersatz aus `tabelle.js:832`.

**Aufwand:** L · **Risiko:** mittel (Spielstandgröße, Terminkollisionen, Wirtschaftsbalance)
— *rückblickend zutreffend, aber an der falschen Stelle: Spielstand und Termine hielten auf
Anhieb, die Wirtschaftsbalance ist die offene Flanke geblieben (5.10). Der teuerste Fund
lag ganz woanders, in `club/medical.js`.*

**Abhängigkeiten:** Stufe 1. Spielstandbudget aus S3.

**Prüfung:** ~~Erweiterung von `test-saison.js`~~ — stattdessen ein eigenes
`tools/test-europa.js` (1.400 Z., 14 Zusicherungen) und `tools/check-euroclubs.js` für die
Stammdaten der 66 Vereine, dazu `tools/test-shootout.js` für das Elfmeterschießen. Alle drei
grün; der Lauf über zwei Seeds und je drei Saisons dauert rund 140 Sekunden.

---

### Stufe 4 — „Kabine und Karriere" · **gebaut und abgenommen**

**Ziel:** Das Legenden-Konzept spielmechanisch zu Ende denken. Behebt die Chemie-Lücke und
die Manager-Lücke aus 1.5 (soweit Stufe 1 sie nicht schon geschlossen hat).

**Das ist die Stufe, in der aus dem Einfall ein Spielprinzip wird.**

Der Stand der Abnahme steht unten unter *Stand der Abnahme*; die Kurzfassung: Die Mechanik
ist gebaut, sie war nach dem Bau aber in der Engine **wirkungslos**, weil der Ära-Abzug in
`engine/ratings.js` erst ab drei Spielern der Minderheits-Ära griff — und die Standardelf
eines Traumverein-Kaders ist 9:2. Für sie bewegte die Eingespieltheit exakt **0**
Chemiepunkte. Das ist behoben. Wie viel sie jetzt bewegt, steht mit Zahlen unten.

**Umfang**

1. **Chemie wächst.** `club.chemistryHistory` steigt mit gemeinsamen Einsatzminuten der
   Startelf, sinkt bei Fluktuation (existiert, `−4` je Zugang), bei Konflikten und in der
   Sommerpause. Der ehrlichere Weg wäre paarweise Eingespieltheit `state.chemie[pidA][pidB]`;
   das kostet Spielstand. Kompromiss: paarweise nur für den Verein des Spielers, ein
   Vereinsmittelwert für die KI. **Die Engine muss dafür nicht angefasst werden** —
   `ratings.js:567` liest den Wert bereits über `tactics.chemistryHistory`.
2. **Mentoren.** Eine Legende nimmt ein Talent unter die Fittiche: Der Trainingsgewinn des
   Talents steigt, die Persönlichkeit färbt ab (`p.personality` existiert, sieben Typen),
   die Legende gewinnt Führungsansehen. Paarungen nach Position, Nationalität,
   Persönlichkeit und Hierarchie (`morale.js` hat Hierarchie und Beziehungen bereits).
   Sichtbar im Kabinenbericht und auf dem Kaderbildschirm.
3. **Cliquen.** Gruppen aus den vorhandenen Beziehungen verdichten (Nationalität, Ära,
   Altersgruppe, gemeinsame Vergangenheit), mit Wirkung auf Moralausbreitung und
   Konfliktrisiko. `morale.js` hat Beziehungen und Konflikte, es fehlt die Gruppenebene.
4. **Nationalmannschaft.** Berufungen nach Leistung und Nationalität; die Länderspielpausen
   im Kalender (`leagues.js:944`) bekommen Reisebelastung, Verletzungsrisiko und
   Moralwirkung; Turniere alle zwei Saisons; ab genug Ruf ein Angebot als Nationaltrainer
   (`board.js:jobangebote` ist die vorbereitete Andockstelle). `media.js:981` hat die
   Reporterfrage dazu schon im Katalog.
5. **Manager-Entwicklung vervollständigen**, falls Stufe 1 nur die Bilanz nachgetragen hat:
   Lizenzstufen, Trainerfortbildung analog `staff.js:KURSE`, Ruf durch Titel.

**Aufwand:** M–L · **Risiko:** niedrig bis mittel (Balancing; `morale.js` ist mit 2.033
Zeilen groß, aber gut sortiert und getestet)

**Abhängigkeiten:** Die Nationalmannschaft profitiert von Stufe 1 (Mehrjahreszyklus).
Chemie und Mentoren sind davon unabhängig und könnten jederzeit vorgezogen werden —
sie beheben das Kernversprechen aus der README.

**Prüfung:** ~~`tools/test-moral.js` erweitern~~ — stattdessen ein eigenes
`tools/test-chemie.js` (1.121 Z., 10 Zusicherungen), das gegen einen im Voraus
festgeschriebenen Vertrag prüft und bei jeder gerissenen Zusicherung gleich mitliefert,
**wo** nachzujustieren wäre. Genau dieser Hinweis hat den Fehler der Stufe gefunden.

#### Stand der Abnahme

**Gebaut:** `src/club/chemie.js` (1.191 Z., Zweitname `club/kabine.js`), `src/club/national.js`
(1.099 Z.), Erweiterungen in `club/morale.js` (Cliquen, +267 Z.), `club/training.js`
(Mentorenfaktor), `screens/kader.js`, `screens/verein.js`, `screens/taktik.js`.
Alle **21** Skripte unter `tools/` grün.

**Behoben bei der Abnahme (drei Funde):**

| Fund | Datei | Was |
|---|---|---|
| **Die Chemie war Dekoration** | `engine/ratings.js:CHEMISTRY.eraMixMin` | Stand auf `3`. Bei einer Elf mit 10:1 oder 9:2 ist die Minderheit 1 bzw. 2 — der Ära-Abzug griff **gar nicht**, und die Eingespieltheit hatte nichts zu verkleinern. Gemessen: Chemiespanne zwischen Eingespieltheit 5 und 95 **exakt 0 Punkte**. Seit der Korrektur auf `1` staffelt der Abzug stetig ab dem ersten Spieler der Minderheit (5 Punkte je Spieler). |
| **Der eigene Verein bildete ab Saison 2 nie wieder ein Mentorenpaar** | `club/chemie.js:mentorenPflegen` | Der Prüfcursor `chemie.mentorPruefung` ist ein Tag **innerhalb** der Saison und springt beim Saisonwechsel auf 0 zurück. Der reine Abstandsvergleich `heute - mentorPruefung < 30` stand danach für immer auf „nicht fällig": Cursor eingefroren auf 361, drei Saisons lang. Die 35 KI-Vereine (eigener Zweig, Modulo-Rechnung) machten weiter — gemessen 405 Paare bei der KI gegen 0 beim Spieler. Ein Rücksprung zählt jetzt selbst als Fälligkeit. |
| **Rücktritt ließ eine tote Mentorenbindung liegen** | `club/karriere.js:ausAllenListen` | `p.mentor` stand nicht in der Liste der Felder, die beim Karriereende geräumt werden. Wer aufhört, wird von `mentorenPflegen` nie wieder besucht (das läuft über `club.playerIds`). Jetzt geräumt, inklusive Rückverweis in `mentees`. |

Dazu eine gemessene Korrektur am Prüfstand: `tools/test-transfers.js:SOMMER_GROSS_MIN` stand
auf 8 — kalibriert an drei Seeds. Über acht Seeds gemessen liegt die Verteilung bei
7/7/13/8/7/12/11/13; der Boden ist 7, und zwar **schon vor Stufe 4** (Seeds 11 und 123
rissen die Grenze auch ohne Kabinenlogik). Die Grenze steht jetzt auf 6.

**Wirkt die Chemie? Die Zahlen.** 6.000 `quickSimulate`-Partien je Stufe, dieselbe Elf,
identische Zufallsströme, fünf Gegner ähnlicher Stärke (HSV, Seed 7):

| Elf (Legenden:Moderne) | Chemiespanne 5→95 | vorher | Punkte/Spiel 5→95 | Punkte/Spiel 30→85 | über 34 Spieltage |
|---|---|---|---|---|---|
| 10:1 | 5 | **0** | 0,023 | 0,013 | 0,4 |
| **9:2 (Standardelf)** | **9** | **0** | **0,056** | **0,030** | **1,0** |
| 8:3 | 14 | 4 | 0,116 | 0,062 | 2,1 |
| 7:4 | 18 | 9 | 0,075 | 0,034 | 1,2 |
| 6:5 | 23 | 13 | 0,127 | 0,074 | 2,5 |

**Ehrlich gelesen:** Wer wirklich mischt (drei und mehr Spieler der Minderheits-Ära),
bekommt über die volle Spanne **0,12 Punkte je Spiel** — die Schwelle, ab der man von
Spielmechanik reden darf. Wer die Standardelf stellt (9:2), bekommt **0,056**, und über die
im Spiel tatsächlich erreichbare Spanne (Eingespieltheit 30 zu Saisonbeginn, ~85 nach zwei
Saisons) nur **0,030 Punkte je Spiel — ein Punkt in einer ganzen Saison.** Das ist mehr als
die 0,000 von vorher, aber für die Standardaufstellung ist die Chemie **weiterhin eher
Würze als Spielprinzip.** Die Zeile 7:4 fällt aus der Reihe, weil sich mit der Mischung auch
die Elf ändert; jede Zeile für sich ist gültig, der Vergleich über Zeilen hinweg nicht.

*Wo nachzujustieren wäre, wenn das zu wenig ist* (in dieser Reihenfolge, beides ungetan):
`ratings.js:CHEMISTRY.eraPenaltyPerPlayer` von 5 auf ~10 heben **und gleichzeitig** bei
etwa 25 Punkten deckeln — sonst reißt eine 6:5-Elf den Korridor in `test-ratings.js`
(„Chemie-Effekt auf Gesamtstärke", 0,4–3,5 %; heute 3,0 %). Das brächte die Standardelf auf
rund 0,10 Punkte je Spiel. Der zweite Hebel, `WEIGHTS.chemie` von 0,12 anzuheben, wirkt auf
**alles** in `chemistry()` — Kapitänsbinde, Querulanten, Nationenblöcke — und verschiebt die
Ligabalance breiter, als diese Frage es rechtfertigt.

**Heben Mentoren die Entwicklung? Die Zahlen.** 207 Talente aller 36 Profivereine, je einmal
mit und einmal ohne Mentor, sonst bitgleich: **+5,6 Attributpunkte und +0,53 Overall über
drei Saisons Trainingswochen, +44 % gegenüber demselben Spieler ohne Mentor**
(`training.js:MENTOR_GEWINN_MAX = 0,42`, Passung im Schnitt 68,7 → Faktor 1,288). Der
Prüfstand misst dasselbe an einem Einzelpaar: +1,0 Overall und 73 gegen 55 Attributpunkte
nach zwei Saisons. Das ist deutlich sichtbar und die stärkste Mechanik der Stufe.

**Spielstand.** 13,29 MB nach drei Saisons (Seed 7), 12,98 MB (Seed 2024) — Grenze 15 MB,
also 1,7 MB Luft. Der Aufschlag der ganzen Stufe sind **280 kB (2,1 %)**, aufgeschlüsselt:

| Feld | Größe nach drei Saisons |
|---|---|
| `player.mentor` (432 Einträge) | 114,8 kB — **davon 59,3 kB allein der deutsche Begleitsatz** |
| `player.national` | 107,9 kB |
| `state.national` | 22,1 kB |
| `player.mentees` | 11,0 kB |
| **`club.chemie` (das paarweise Gitter)** | **5,9 kB bei 158 Paaren** |

Das befürchtete Problem ist keins: Der Kompromiss „paarweise nur für den eigenen Verein"
kostet **6 kB**. Teuer ist stattdessen der gespeicherte Mentorentext — und der ist
**redundant**, `chemie.js:mentorPaare()` baut ihn bei Bedarf aus `mentorText()` neu. Wer die
Spielstandbremse vor Stufe 5 sucht (5.7): hier liegen 59 kB ohne Gegenwert.

**Weitere Abnahmemessungen:**

- **Vereinswechsel des Managers:** `club.chemie` des alten Vereins wird gelöscht, keine
  fremden Paargitter im Spielstand (gemessen: 108 Paare vorher, 0 zurückgeblieben).
- **Zurückgetretene und abgewanderte Mentoren:** werden am nächsten Tageslauf gelöst
  (gemessen 32 + 34 direkt nach dem Saisonwechsel, **0** drei Tage später). In dem einen Tag
  dazwischen zeigt `mentorPaare()` sie noch an — es prüft `retired`/`clubId` nicht selbst.
  Offen und bewusst nicht behoben: **25 vertragslose Spieler** (`clubId === null`) tragen
  weiter ein `player.mentor`-Feld, weil `mentorenPflegen` nur über Vereinskader läuft. Ohne
  Wirkung (`training.js:mentorFaktor` prüft den Verein), ohne Anzeige, ~3 kB.
- **Determinismus:** gleicher Seed → identische Mentoren (296 Paare), Cliquen (258 Gruppen)
  und Berufungen (27 Aufgebote); ein anderer Seed liefert eine andere Kabine.
- **Spielstand aus Stufe 3:** lädt. `SAVE_VERSION` steht weiterhin auf 3 und **das ist
  richtig** — alle neuen Felder entstehen faul (`chemie.js:chemieAkte`,
  `national.js:sicherState`), ein Migrationsschritt 3→4 ist nicht nötig. Gegengemessen mit
  einem nachgebauten Stufe-3-Stand (ohne `state.national`, `club.chemie`, `player.mentor`):
  45 Tage weitergespielt, kein Fehler, danach 55 Paare und ein Verbandsdatensatz da.
- **Laufzeit:** eine Saison 10,2 s gegen 9,5 s ohne die Kabinenlogik — **+7 %**, rund 2 ms
  je Spieltag. `tickChemie` allein kostet 0,23 s je Saison (2,2 % des Laufs); die teuerste
  Neuerung ist die Cliquenbildung in `tickMoral`, das mit 5,3 s ohnehin die Hälfte des
  Tagesablaufs trägt.
- **Bildschirme:** alle 17 gegen ein echtes DOM an Tag 1, nach 250 Tagen und in Saison 2 —
  **3.996 Bedienungen von 4.064 Bedienelementen** (der Rest ist deaktiviert), **0
  Laufzeitfehler**. Der Harnisch liegt wieder außerhalb des Projekts; siehe 5.5.
- **Nebenwirkung auf die Ligabalance, gewollt:** Weil der Ära-Abzug jetzt greift, sinkt der
  Torschnitt der 1. Bundesliga in `check-all.js` von **3,83 auf 3,62** Tore je Spiel — ein
  Schritt in Richtung des Engine-Korridors 2,8–3,2 (5.8), ohne dass an der Engine gedreht
  wurde.

**Vollständig aus dem geplanten Umfang:** alle fünf Punkte sind gebaut, auch Punkt 5 —
`club/karriere.js` hat fünf Lizenzstufen (C bis „Fußball-Lehrer mit Auszeichnung", am
Saisonende automatisch fortgeschrieben) und acht Fortbildungen nach dem Muster von
`staff.js:KURSE`. Das Angebot als Nationaltrainer hängt an
`national.js:nationaltrainerAngebot`, gerufen von `board.js:1236`.

**Die eine Lücke, die die Abnahme dabei gefunden hat:** `karriere.js` exportiert
`lizenzStand`, `fortbildungStand`, `fortbildungen` und `fortbildungBelegen` — **kein
einziger Bildschirm ruft eine davon.** Die Lizenz steigt von selbst und steht in
`verein.js:883`, `saison.js:823` und `stab.js:453` als Text neben dem Ruf; eine Fortbildung
kann der Spieler aber nirgends buchen. Das ist die Umkehrung von 5.4 (dort: Felder, die
gelesen und nie geschrieben werden) und gehört auf den Trainerstab-Bildschirm, wo die
Kurse des Stabs bereits stehen. **Nicht behoben** — das ist Oberflächenarbeit, keine
Abnahme.

---

### Stufe 5 — „Legenden in Liga zwei" · **gebaut und abgenommen**

**Ziel:** Der Kern des Spiels endet nicht an der Ligagrenze. Nach Stufe 1 kann man
absteigen — dann darf die 2. Liga nicht in eine Welt aus Zufallsnamen führen.

**Umfang**

- 18 handgepflegte Zweitligakader nach dem Muster von `data/squads/gruppe1–6.js`:
  Legenden in Bestform plus aktueller Kader, je 24 Spieler, Positionsverteilung 3/8/8/5
  nach Gruppen (so prüft es `check-data.js:114–123`).
- Die Vorlage schreibt sich fast von selbst: Schalke, Hertha, Kaiserslautern, Nürnberg,
  Düsseldorf, Hannover, Bochum, Bielefeld, Braunschweig, Dresden, Magdeburg, Fürth, KSC,
  Darmstadt, Kiel, Münster, Paderborn, Elversberg. Mehrere davon waren Deutscher Meister —
  dass sie heute ohne eine einzige Legende antreten, ist die auffälligste inhaltliche Lücke.
- `eraLabel` konsequent setzen („Ära 1997", „Ära 1974"), damit die Ära-Mischung im
  Taktikbrett und die Chemie-Begründungen greifen.
- Ausbaureserve: 8–12 Amateurvereine mit eigenen Farben, Wappenmotiven und einem kleinen
  handgepflegten Kern, damit Pokalauslosungen Charakter bekommen.

**Aufwand:** L (fast reine Datenpflege, dafür viel davon) · **Risiko:** niedrig

**Warum erst hier?** Weil diese Stufe nur mit Stufe 1 Sinn ergibt (ohne Abstieg sieht der
Spieler die 2. Liga nie von innen) und weil sie die Balance verschiebt: Die 2. Bundesliga
liegt heute bei 2,66 Toren; mit Legendenkadern wandert sie in Richtung 3,4. Das ist nach
der Analyse in S6 zu erwarten und kein Fehler — aber die Korridore in `check-all.js`
müssen vorher je Ligatyp getrennt sein, sonst kippt der Lauf ins Rot.

**Abhängigkeiten:** Stufe 1. Hebt den Spielstand um ~0,8 MB (siehe S3).

**Prüfung:** `check-data.js` deckt Kadergröße, Positionsverteilung, Nummernvergabe,
Attributgrenzen, Marktwerte und Ruf-Plausibilität bereits vollständig ab. Es muss nichts
Neues geschrieben werden — nur die Erwartung von 432 auf 864 Spieler gehoben.

#### Abnahme

**Gebaut:** `src/data/squads/gruppe7–12.js` (2.768 Zeilen, 432 Spieler), eingebunden über
`data/squads/index.js`. `ALL_SQUAD_PLAYERS` enthält jetzt **864 Spieler in 36 Kadern**.
`core/state.js` hat die neuen Kader ohne Eingriff übernommen — die prozedurale Erzeugung
lief schon immer nur für Vereine ohne Spieler und greift jetzt für keinen Profiverein mehr;
die beiden Kommentare an der Stelle waren allerdings falsch geworden und sind korrigiert.

**Was die Abnahme gefunden hat.** Fünf der 21 Prüfskripte kippten allein durch das
Einbinden der Daten. Drei davon waren echte Fehler:

1. **Die Gehaltsskala trug die 2. Liga nicht** (`data/squads/_helper.js`). Die Gehaltsquote
   der 2. Liga sprang von 48,3 % auf **98,3 %** vom Umsatz; 16 von 18 Vereinen lagen über
   der 72-Prozent-Marke, Dynamo Dresden bei 148 %, achtzehn von 36 Profivereinen schrieben
   rote Zahlen. `test-wirtschaft.js`, `test-europa.js` (Z13) und `test-transfers.js` fielen
   daran, `check-all.js` gleich mit — ein Torschnitt von 3,98 in der **ersten** Liga war die
   Fernwirkung ausverkaufter Kader.
   Ursache war keine zu starke Kadereichung, sondern eine Lücke im Modell:
   `wirtschaftskraft()` kennt Reputation, Stadion und Mitglieder — aber nicht die
   Spielklasse. Schalke hat als Zweitligist dasselbe Stadion und dieselben Mitglieder wie
   als Erstligist und ein Fünftel der Fernsehgelder. Zwischen den Ligen liegt beim Umsatz
   Faktor 5,4, bei der reinen Vereinsgröße nur Faktor 3.
   `club/finances.js` kennt diesen Knick längst (`BETRIEB_LIGA`, der Ligafaktor beim
   Sponsoring). Die Gehaltsskala hat ihn jetzt auch: **`ligaNiveau(club)`** mit
   `{ bl1: 1,00, bl2: 0,44 }`, angewandt auf `gehaltsSpitze()` und `vereinsgehalt()`
   gleichermaßen, damit die Kurve verschoben und nicht verbogen wird. Ergebnis: 2. Liga
   **46,2 %**, 1. Liga 50,4 %, alle Korridore grün und **weniger** Vereine im Minus als vor
   Stufe 5 (10–12 von 36 statt 15). Preis: Über die Ligagrenze hinweg ist die Skala nicht
   mehr monoton — ein abgestiegener Traditionsverein zahlt weniger als ein kleiner
   Erstligist. Das ist gewollt und dokumentiert; es ist die Abstiegsklausel.

2. **Der Ausverkauf beim Absteiger hat Vereinslegenden verschoben**
   (`club/karriere.js:ligawechselKader`). Gemessen: **13 von 50 Wechseln** je Saison waren
   Legenden — Mattuschka verließ Union, Klasnic St. Pauli, Schnatterer Heidenheim. Das ist
   das Gegenteil des Spielprinzips, und es war schon vor Stufe 5 falsch (nur eben nur in
   einer Richtung, weil die 2. Liga nichts zu verlieren hatte). `gruppeSortiert()`
   überspringt jetzt `era === 'legend'`. Bei drei Auf- und drei Absteigern bleiben 44 statt
   50 Wechsel — der Tausch trägt also weiterhin, und die Ligastärke
   der 1. Liga tropft nicht weg (`test-karriere.js` Z14: 76,9 → 73,1 über
   20 Saisons, erlaubt sind 6 Punkte Verfall).

3. **Zwei Prüfstände maßen eine Welt, die es nicht mehr gibt.** Kein Fehler im Spiel, aber
   zwei Korridore, die gegen die halb-prozedurale Welt geeicht waren:
   - `test-karriere.js` Z2 lief zehn Saisons und nahm das Maximum über den ganzen Lauf.
     Seit Stufe 5 sind alle 864 Profis von Hand geschrieben und alle zum Start in Bestform
     — ein Jahrgangsberg um die 27, der geschlossen altert. Der Anteil ab 33 steigt bis
     Saison 8 auf 45,7 % und fällt danach; ab Saison 14 liegt er bei 13–17 %, das
     Gleichgewicht steht bei ⌀ 27,0 Jahren. Zehn Saisons endeten mitten in der Welle und
     maßen deren Scheitel. Der Lauf geht jetzt über **20 Saisons** (0,3 s teurer), und Z2
     misst den eingeschwungenen Teil. **Die Welle selbst wird als Hinweis ausgewiesen** —
     sie ist real, und wer zehn Saisons am Stück spielt, sieht sie.
   - `test-shootout.js` verlangte 74–78 % Elfmeterquote. Seit jeder der 36 Vereine seinen
     besten Torwart aller Zeiten stellt (Turek, Enke, Franke, Köpke, Kahn, Lehmann), sind
     es **73,37 %** statt 75,15 %. `engine/shootout.js` ist unverändert. Getrennt gemessen
     liegen beide Ligen gleich (1. Liga 73,60 %, 2. Liga 72,87 % über je 21.000 Schüsse) —
     es ist kein Ligatyp-Effekt, sondern das neue Niveau. Untergrenze auf **72 %** gesenkt;
     Elfmeterschießen in großen Turnieren liegen bei 70–75 %.

**Messwerte nach der Abnahme.** Die Spalte „nach Stufe 5" ist über 8 Seeds à 200 Tage
gemessen, die Spalte „vor Stufe 5" über die drei Seeds 7, 42 und 2024 desselben Laufs
(dafür musste `squads/index.js` vorübergehend auf sechs Gruppen zurückgesetzt werden):

| Kennzahl | vor Stufe 5 | nach Stufe 5 |
|---|---|---|
| Tore je Spiel, 1. Liga | ⌀ 3,46 | ⌀ **3,58** (3,20–3,74) |
| Tore je Spiel, 2. Liga | ⌀ 3,08 | ⌀ **3,38** (3,14–3,58) |
| Trefferquote 1. Liga | 11,34 % | **11,89 %** |
| Trefferquote 2. Liga | 11,45 % | **11,65 %** |
| Spreizung der Trefferquote | 0,11 Pp. | **0,24 Pp.** (erlaubt 2,0) |
| Gehaltsquote 2. Liga | 48,3 % | **46,2 %** (ohne `ligaNiveau`: 98,3 %) |
| Spielstand beim Neustart | 2,713 MB | **2,709 MB** |
| Spielstand nach 200 Tagen | 12,86 MB | **12,83 MB** |
| Elfmeterquote | 75,15 % | **73,37 %** |

Die beiden Trefferquoten sind praktisch gleich — genau das, was `check-all.js` verlangt:
Der Torschnitt darf am Ligatyp hängen, die Quote, mit der aus einem Abschluss ein Tor wird,
nicht.

**Die Spielstandrechnung der Roadmap war falsch.** Erwartet waren +0,8 MB, gemessen sind es
**−0,004 MB**. Der Grund ist banal: Die 2. Liga hatte auch vorher 432 Spieler im Spielstand,
nur eben prozedural erzeugte. Stufe 5 ersetzt sie, sie kommen nicht hinzu. Damit war die
Spielstandbremse (5.7) **nie eine Voraussetzung für diese Stufe** — sie bleibt fällig, aber
aus eigenem Recht.

**Nicht behoben, bewusst:**

- Die **Kaderaltersstruktur der handgeschriebenen Welt** hat keine Pyramide: 374 der 864
  Spieler sind 26 bis 28 Jahre alt, nur 114 sind 23 oder jünger (die prozedurale 2. Liga
  hatte allein 172). Daraus entsteht die Alterswelle oben. Ein Versuch, sie durch Verjüngen
  wegzunehmen — ein Drittel aller modernen Spieler beider Ligen von 26–29 auf 20–23 — hat
  den Scheitel nur von 45,7 % auf 41,9 % gedrückt. Die Welle ist der Preis des
  Spielprinzips („jeder Verein tritt mit seinen Legenden in Bestform an"), nicht ein Fehler
  in `club/karriere.js`. Wer sie wirklich wegnehmen will, braucht einen zweiten Ausgang aus
  der Spielwelt (Wechsel ins Ausland) — das ist eine eigene Stufe.
- Die **Torhüter der 2. Liga** liegen mit ⌀ 82,3 Elfmeterwert nur 2,1 Punkte unter denen
  der ersten (⌀ 84,4), während die Kader dahinter fast acht Punkte trennen. Historisch ist
  das richtig — Turek war Weltmeister, Enke Nationaltorwart —, für die Balance ist es eine
  Schieflage. Sie ist gemessen und dokumentiert, aber nicht geglättet: Dafür müsste man
  18 Legenden schwächer machen, als sie waren.
- `check-data.js` meldet weiterhin **eine Warnung**: Bei Union, St. Pauli, Dynamo,
  Magdeburg und Braunschweig weichen Ruf und Kaderstärke stark voneinander ab. Bei den drei
  neuen ist die Ursache dieselbe wie bei den zwei alten — ein niedriger `reputation`-Wert
  trifft auf eine große Vergangenheit. Das ist eine Frage an `data/clubs.js`, nicht an die
  Kader.
- Die **Ausbaureserve** (8–12 Amateurvereine mit handgepflegtem Kern) ist nicht gebaut.

---

### Stufe 6 — „Chronik, Bedienung, Editor" · **gebaut und abgenommen**

**Ziel war:** Das Spiel erinnert sich, und man kann es auch auf einem kleineren Bildschirm
bedienen. Behebt den Rest von S5 (Breakpoints) und S7.

**Was gebaut wurde**

1. **Chronikbereich** (`screens/chronik.js`, 1.555 Z., 16. Reiter der Aktenleiste, Taste
   `Z`): sechs Reiter —
   ewige Tabelle je Liga, Titelchronik als Zeitleiste, Rekordbuch, Ruhmeshalle, „Meine
   Laufbahn" (zwei Canvas-Diagramme) und der Saisonrückblick als Zeitungsseite. Der
   Bildschirm **rechnet nichts nach, was der Spielstand schon weiß**, und er erfindet
   nichts: Fehlt ein Feld im Archiv, verschwindet die Spalte und eine Fußnote sagt, warum.
2. **Saisonrückblick als Zeitung:** `media.js:saisonRueckblick` liefert den fertigen Text,
   `chronik.js:zeitungsSeite` das Blattlayout mit Aufmacher, Elf der Saison und Anekdoten.
   War, wie vorhergesagt, fast geschenkt.
3. **Escape-Kette und Fokusringe:** `main.js:escapeKette` in vier Stufen plus der neue,
   additive Vertrag `screen.onEscape(): boolean`. Sortierbare Tabellenköpfe bekamen
   `tabIndex = 0` und einen Enter/Leertaste-Pfad. Gemessen: **585 von 585 Bedienelementen**
   über alle 19 Bildschirme werden von einer `:focus-visible`-Regel getroffen, die auch
   etwas zeichnet; keines ist ohne Tastatur erreichbar.
4. **Kleinere Bildschirme:** zwei neue Rahmenstufen (1080 px Symbolleiste, 860 px
   einspaltig) plus je eine für Editor und Bildschirmklassen. Tabellen rollen waagerecht
   im eigenen Kasten. Zielbild 1024 × 768 erreicht.
5. **Editor** (`screens/editor.js`, 1.290 Z., hinter Strg + Umschalt + E): Vereine und
   Spieler in allen Stammdaten ändern, neu anlegen, löschen — und ein **zweites
   Dateiformat für reine Stammdaten** (`state.js:exportStammdaten` / `importStammdaten`).
   Gearbeitet wird auf einem Entwurf, nicht am Spielstand.
6. **Hotseat für zwei Manager:** *nicht gebaut* — war Ausbaureserve und niemand hat gefragt.
7. **Aufräumen aus S7:** `tools/check-suite.js` startet alle 21 Skripte, die README nennt
   sie alle. Siehe S7.

**Aufwand:** wie veranschlagt L · **Risiko:** wie veranschlagt niedrig — Stufe 6 ist die
einzige Stufe, die **kein einziges Feld** im Spielstand angelegt hat.

**Prüfumfang der Abnahme**

| Was | Wie | Ergebnis |
|---|---|---|
| Prüfskripte | `npm run check` (alle 21, eigener Prozess je Skript) | **21 grün, 0 rot, 244 s** |
| Alle 19 Bildschirme | Wegwerf-Harnisch gegen ein DOM-Ersatzstück, an Tag 1 **und** nach drei gespielten Saisons, jeder Knopf/Reiter/Regler/Tabellenkopf einmal | **931 Bedienungen von 939**, 140 Dialoge, **0 Laufzeitfehler, 0 `console.error`** |
| Ewige Tabelle | Zeile für Zeile gegen `state.history.seasons` nachgerechnet (Punkte, Differenz, Spielzeiten, Spiele, beste Platzierung) | **0 Abweichungen** in beiden Ligen, je 24 Vereine über 3 Spielzeiten (bl1 Σ 2.572 Punkte, bl2 Σ 2.519) |
| Titel und Rekorde | jeder Meister, Pokalsieger und Torschützenkönig aus `history.titel` im Bildschirmtext gesucht | **0 fehlend**; Rekordbuch führt alle sieben Felder, höchster Sieg „HSV 13:1 Wolfsburg", längste Serie Bayern 12 |
| Ruhmeshalle | alle `player.retired` gegen die Anzeige gezählt | **115 von 115** (4 Karten + 111 Tabellenzeilen), **0 fehlend** |
| Editor-Rundlauf | Verein und Spieler ändern → exportieren → **frischen** Spielstand laden → importieren | alle neun Felder kommen an (Name, Stadt, Farbe, Stadionname, Vor-/Nachname, Attribut, Rückennummer); Vollexport 36 Vereine / 765 Spieler / 940 kB importiert mit 0 Meldungen |
| Kaputte Dateien | zehn Sorten (abgeschnittenes JSON, gar kein JSON, `{}`, `null`, Liste, fremdes Format, Spielstand statt Stammdaten, zu neue Fassung, Müll in den Feldern, unbekannter Verein) | **acht abgelehnt, Spielstand Byte-gleich unverändert.** Die beiden übrigen sind teilgültige Dateien und werden absichtsgemäß teilweise übernommen — mit namentlicher Meldung je verworfenem Feld |
| Escape-Kette | ESC aus jedem der 19 Bildschirme, dazu mit offenem Dialog, mit zwei gestapelten Dialogen und mit Fokus im Eingabefeld | aus allen 19 zurück ins Büro; **kein Fall, in dem ESC einen offenen Dialog überspringt**; bei zwei Dialogen nimmt ESC nur den obersten |
| Vier Breiten | 1600 / 1280 / 1024 / 900 px, statisch aus den CSS-Regeln und den Spaltenbreiten gerechnet | **keine CSS-Regel** verlangt bei 900 px mehr als die dann verfügbaren 828 px (breiteste 352 px). Drei Tabellen rollen waagerecht in ihrem eigenen Kasten — siehe 1.8 |

**Was die Abnahme gefunden hat (beides behoben)**

1. **`state.js:clubStammdaten` las die Gründungswerte statt der laufenden.** `club.fanbase`
   ist die Vorlage aus `data/clubs.js` und wird nie fortgeschrieben, `club.fans` ist der
   laufende Zustand — vier andere Module lasen längst `fans || fanbase`, genau dieses eine
   `fanbase || fans`. Folge: Ein Rundlauf durch den Editor, bei dem man **nichts** ändert,
   setzte die Mitgliederzahl jedes Vereins auf den Stand von Tag eins zurück (HSV nach drei
   Saisons 147.854 → 96.000). Nach der Korrektur ist der erste Rundlauf verlustfrei und
   jeder weitere ein Nulldurchgang.
2. **`screens/editor.js:onEscape` verpuffte im Vereinsreiter.** Es setzte `zustand.clubId`
   auf `null`, aber die erste Zeile von `render()` setzte den Wert sofort wieder auf den
   eigenen Verein. ESC war damit *verbraucht*, ohne etwas zu tun — und weil `onEscape()`
   `true` meldete, kam man aus dem Editor per Tastatur **überhaupt nicht mehr heraus**.
   Behoben über dieselbe Konvention, die `zustand.kaderClubId` schon benutzte:
   `undefined` = noch nie gewählt, `null` = bewusst abgewählt.

**Was bewusst offen blieb**

- **Hotseat** (Punkt 6) — Ausbaureserve, nicht gebaut. Er greift überall in die Annahme
  „es gibt genau einen eigenen Verein" ein, und niemand hat danach gefragt.
- **`saisonAbschluss()` archiviert weiterhin nur vier Felder je Tabellenzeile.** Die ewige
  Tabelle könnte Siege, Unentschieden, Niederlagen und Tore zeigen, sobald sie dastehen —
  der Bildschirm ist darauf vorbereitet und liest sie optional. Vier Zeilen in
  `core/loop.js`, und die Datei gehörte nicht zu dieser Stufe. Siehe Abschnitt 8.
- **Europapokalsieger vergangener Jahre stehen nirgends.** `state.europa.sieger` gilt nur
  für die laufende Spielzeit. Die Zeitleiste zeigt deshalb, was belegt ist, statt zu raten.
- **Der Editor legt neue Vereine ohne Ligazugehörigkeit an** (`club.leagueId = null`, kein
  Eintrag in `state.leagues`) und sagt das auch. Ein 19. Verein in einer 18er-Liga wäre ein
  stiller Totalschaden; ein neuer Spielplan entsteht frühestens zur nächsten Saison.
- **Die Minispiele sind weiterhin nicht nachweislich mit der Tastatur *gewinnbar*.** Die
  `keydown`-Pfade existieren seit Stufe 2, der Harnisch lässt sie an- und auslaufen, aber
  er spielt sie nicht. Das steht seit Stufe 2 so da und steht jetzt zum vierten Mal da.
- ~~**Kein Prüfskript im Projekt fährt die Bildschirme.**~~ — **behoben nach Stufe 6:** Der
  Harnisch liegt seit Abschnitt 8 als `tools/test-screens.js` im Projekt und läuft bei jedem
  `npm run check` mit. Siehe 5.5 und 8.2.

---

### Reihenfolge und Abhängigkeiten

```
S6/S7 Doku-Aufräumen  ────────────────  GEBAUT (S7-Rest erst in Stufe 6)

Stufe 1  Saisonwechsel  ──┬──►  Stufe 3  Europa             GEBAUT + abgenommen
                          ├──►  Stufe 4  Kabine & Karriere  GEBAUT + abgenommen
                          ├──►  Stufe 5  Legenden Liga 2    GEBAUT + abgenommen
                          └──►  Stufe 6  Chronik            GEBAUT + abgenommen

Stufe 2  Ton & Stadion  ───────────────  GEBAUT + abgenommen (unabhängig)

                                         ►  Abschnitt 8: was danach lohnt
```

**Vorschlag:** ~~S7~~ → ~~**Stufe 1**~~ → ~~Stufe 2~~ → ~~Stufe 3~~ → ~~Stufe 4~~ → ~~Stufe 5~~ → ~~Stufe 6~~. **Alles abgearbeitet.**

S7, Stufe 2, Stufe 3, Stufe 4, Stufe 5 und Stufe 6 sind gebaut und abgenommen, je mit dem
oben belegten Prüfumfang. Stufe 1 ist gebaut — `loop.js:saisonWechsel`, `club/karriere.js`,
`screens/saison.js` und `tools/test-saison.js` über drei Saisons sind vorhanden und grün —,
hatte aber **keine eigene Abnahme**. Das hat sich gerächt: Der schwerste Fund der
Stufe-3-Abnahme (`club/medical.js:saisonReset` lief seit Stufe 1 kein einziges Mal, alle 36
Vereine konnten ab Saison 3 keine elf Mann mehr aufbieten) stammt aus Stufe 1 und lag zwei
Stufen lang unentdeckt unter drei grünen Prüfläufen. **Wenn nur eine Lehre aus dieser
Abnahme mitgenommen wird, dann diese: Eine grüne Suite ist kein Ersatz für eine Abnahme.**
Stufe 4 hat das bestätigt: Auch dort war die Suite grün, bis ein Prüfstand die richtige
Frage stellte — und auch dort war der Fund ein Tageszähler, der beim Saisonwechsel auf 0
zurückspringt.

**Stufe 5 hat die Lehre ein drittes Mal bestätigt** — und diesmal am deutlichsten: Die
Suite war grün, das Einbinden von 432 reinen Datenzeilen hat fünf von 21 Skripten gekippt,
und zwei der drei Funde saßen weder in den Daten noch in dem Modul, das man verdächtigt
hätte. Die Gehaltsskala kannte die Spielklasse nicht, und `ligawechselKader()` verschob seit
Stufe 1 Vereinslegenden zum Aufsteiger. Der zweite Fehler war **die ganze Zeit da** und
wurde erst sichtbar, als er in beide Richtungen wirkte.

**Von den beiden Vorbedingungen, die vor Stufe 5 standen, war eine erledigt und eine falsch:**

1. **Die Torschnitt-Korridore je Ligatyp trennen** (5.8, S6) — war vorher erledigt und hat
   sich bewährt: `check-all.js` liest den Ligatyp aus dem Legendenanteil der Daten und hat
   die 2. Liga von selbst umgestuft, ohne dass jemand eine Zeile anfassen musste.
2. **Die Spielstandbremse** (5.7) — war **keine** Vorbedingung. Die veranschlagten ~0,8 MB
   waren ein Rechenfehler: Die 2. Liga stand auch vorher mit 432 Spielern im Spielstand.
   Gemessen sind es −0,004 MB. Die Bremse bleibt fällig, aber sie hat nichts blockiert.

**Stufe 6 hat die Lehre ein viertes Mal bestätigt, und zum ersten Mal in der freundlichen
Variante:** Die Suite war grün, der Prüfstand fand zwei Fehler, und **beide lagen dort, wo
zwei Felder dieselbe Sache meinen** (`club.fanbase` gegen `club.fans`) beziehungsweise **wo
zwei Stellen sich gegenseitig aufheben** (`onEscape()` setzt zurück, `render()` setzt
sofort wieder). Kein Prüfskript hätte das je gesehen: Das eine ist erst sichtbar, wenn man
einen vollen Rundlauf durch ein Dateiformat macht, das andere erst, wenn man eine Taste
zweimal drückt.

**Damit ist die Roadmap abgearbeitet.** Alle sechs Stufen sind gebaut, fünf davon
abgenommen. Was jetzt lohnt, steht in Abschnitt 8. Wer stattdessen am Kernkonzept
weiterarbeiten will, findet die billigste Fortsetzung in Abschnitt 4: **Ära-Konflikte** —
die Empfehlung von damals gilt unverändert, weil sich an ihrer Grundlage nichts geändert
hat (41 % Legenden in beiden Ligen, alle 36 Vereine mit mindestens drei Legenden und drei
Modernen).

Begründung der einen ungewöhnlichen Stelle, die bleibt: Stufe 2 (Ton) steht früh, weil sie
billig ist, nichts kaputt machen kann und nach dem schweren Umbau in Stufe 1 sofort spürbar
wirkt. Die Reihenfolge hat sich im Rückblick gehalten; die einzige, die man heute anders
legen würde, ist Stufe 6 — ihr Aufräumteil (`check-suite.js`) hätte am Anfang gestanden
und in den Stufen 3 bis 5 jeweils Stunden gespart.

---

## 4. Ideen für den einzigartigen Dreh

Das Spiel hat einen Einfall, den kein anderer Manager hat: Legenden und aktuelle Spieler in
einer Elf, mit Chemie als Preis dafür. Bis Stufe 3 war das eine **Startaufstellung**. Nach
Stufe 4 ist es eine **Mechanik** — für die Standardelf allerdings eine leise: 0,03 Punkte je
Spiel über die im Spiel erreichbare Spanne, 0,07 für eine wirklich gemischte Elf (Zahlen bei
Stufe 4). Ein **Spielprinzip**, das den Spieler zu Entscheidungen zwingt, ist es damit noch
nicht ganz.

Das Fundament steht jetzt. **Stand nach Stufe 6: von den acht Ideen ist eine gebaut, eine
halb vorhanden, und sechs warten.** Stufe 6 hat an dieser Liste nichts geändert — Chronik,
Bedienung und Editor sind Werkzeuge, keine Spielmechanik. Was sie beigetragen hat, ist
etwas anderes: **Die Ruhmeshalle gibt dem Karriereende einer Legende zum ersten Mal einen
Ort** (gemessen: 115 Karriereenden nach drei Saisons, davon 3 Vereinslegenden, jede mit
Abschiedstext aus dem Postfach). Damit ist die Idee „Legenden als Co-Trainer" ein Stück
billiger geworden: Der Bildschirm, auf dem das Angebot später auftauchen müsste, steht.

| | |
|---|---|
| **gebaut** | Mentorenbogen als Erzählung (Stufe 4) · **Ära-Konflikte (Abschnitt 8)** |
| **wartet** | Legenden als Co-Trainer · Zeitreise-Pokal · Was-wäre-wenn · Historische Szenarien · Ära-Ziele des Vorstands · Legenden-Draft |

**Stand nach Abschnitt 8: von den acht Ideen sind zwei gebaut, sechs warten.** Mit den
Ära-Konflikten hat der Einfall zum ersten Mal eine Form, die eine Antwort verlangt statt
eines Notenpunkts.


| Idee | Was sie tut | Stand | Aufwand |
|---|---|---|---|
| **Ära-Konflikte** | Netzer und ein 22-jähriger Instagram-Profi über Trainingsdisziplin. Kein neues System nötig: `morale.js:KONFLIKT_ARTEN` braucht Konfliktarten mit der Bedingung „ära-übergreifend" plus Lösungswege, die es sonst nicht gibt („Der Alte hat recht" / „Die Zeiten haben sich geändert"). Beide Antworten haben Folgekosten in der Kabine. | **GEBAUT** in Abschnitt 8. `morale.js:istAeraKonflikt()` verlangt beides — eine Streitart mit `aera: true` UND beide Lager unter den Beteiligten. `LOESUNGS_METHODEN.alte_schule` und `.neue_zeit` stehen nur dort zur Wahl und dann zuerst, mit der Streitfrage darüber (`KONFLIKT_ARTEN[…].frage`) und einer Rückfrage davor; die Bedienung sitzt in `screens/verein.js`. **Gebaut in Abschnitt 8, balanciert und abgenommen in 8.6.** Gemessen nach der Abnahme: **3,08 Ära-Konflikte je Spielzeit beim eigenen Verein** (vorher 0,38), 34 % aller Kabinenkonflikte, Gesamtzahl und Laufzeit unverändert. Die beiden Wege kosten über 120 Tage **60,4 gegen 77,2** — Verhältnis 1,28 in zwei unabhängigen Messaufbauten, und **keiner ist mehr auf allen Achsen der billigere**. Offen: In einer intakten Kabine steht es 1,45 zugunsten von „Der Alte hat recht" (8.6). | **S** |
| **Mentorenbogen als Erzählung** | Aus Stufe 4 wird eine Geschichte: Schöpft ein Talent unter einer Legende über 30 Punkte Potenzial aus, gibt es eine Postnachricht, in der die Legende sich äußert. Hört die Legende auf, übernimmt das Talent ihre Rückennummer. | **GEBAUT** in Stufe 4. `chemie.js:erzaehlen()` meldet zwei Stufen (12 und 30 Punkte Zuwachs), `chemie.js:erbeAntreten()` vererbt die Rückennummer, wenn sie frei ist — mit Meldung vom Zeugwart. Zusätzlich kippt die Persönlichkeit des Zöglings nach ~6 Monaten in die des Mentors („die Zwillinge"). | **S**, Wirkung groß |
| **Legenden als Co-Trainer** | Beim Karriereende (Stufe 1) kommt ein Angebot: Seeler übernimmt die Stürmer. Technisch ein `staff.js`-Datensatz mit sehr hoher Qualität in genau einer Spezialisierung und der Persönlichkeit des Spielers. Bindet das Karriereende an die Zukunft, statt es zu einer Löschung zu machen. | offen — `staff.js` kennt weiterhin keinen einzigen Bezug auf `era: 'legend'`. **Seit Stufe 6 aber billiger:** Die Ruhmeshalle in `screens/chronik.js` listet jedes Karriereende mit Abschiedstext (gemessen 115 nach drei Saisons); der Ort, an dem das Angebot auftauchen müsste, existiert. | **M** |
| **Zeitreise-Pokal** | Ein Sommerturnier, in dem jeder Verein ausschließlich mit `era: 'legend'` antritt. Kein neues Wettbewerbssystem nötig: `generateCupDraw` plus ein Kaderfilter. Vier Runden in der Vorbereitung, kleine Prämien, großes Prestige. | offen | **M** |
| **Was-wäre-wenn** | Beim Saisonabschluss die Frage: Was wäre passiert, wenn Sie den Transfer im Winter gemacht hätten? Die Engine ist deterministisch und schnell (0,44 ms/Spiel) — 34 Spieltage in einer Variante kosten unter einer Sekunde. **Der Determinismus ist ein Alleinstellungsmerkmal, das man verschenkt, wenn man ihn nicht nutzt.** | offen — der Determinismus ist bei der Abnahme von Stufe 4 erneut gegengemessen worden, jetzt auch für Kabine und Verband | **M** |
| **Historische Szenarien** | „Rette den HSV 2018", „Kaiserslautern steigt auf und wird Meister": vorgegebener Verein, Startzeitpunkt, Kader- und Finanzlage, ein klares Ziel, Bewertung am Ende. Braucht Szenariodateien unter `data/szenarien/` und einen Reiter im Startbildschirm. Der teure Teil ist die Datenpflege je Szenario. | offen — kein `data/szenarien/`. **Seit Stufe 6 deutlich billiger:** Das Stammdatenformat aus dem Editor (`exportStammdaten`/`importStammdaten`, geprüft mit 36 Vereinen und 765 Spielern) **ist** bereits das Szenarioformat. Was fehlt, sind Startbedingungen, ein Ziel und ein Reiter im Startbildschirm — nicht mehr das Dateiformat. | **S** Mechanik, **M** je Szenario |
| **Ära-Ziele des Vorstands** | Statt „Platz 6" fordert der Vorstand „Spielen Sie wie 1974". Bewertet werden Stil, Ballbesitz und Legendenanteil in der Elf — `board.js:FORDERUNGS_TYPEN` ist genau dafür gebaut. | offen — elf Forderungstypen, keiner davon ära-bezogen | **S** |
| **Legenden-Draft** | Alternativer Spielstart: Die Legenden aller Vereine liegen in einem Topf, 18 KI-Trainer und der Spieler ziehen abwechselnd. Danach läuft eine normale Saison — aber mit Kadern, die es nie gab, und mit Chemie am Boden, weil niemand jemanden kennt. **Der eine Modus, der aus dem Einfall ein eigenes Spiel macht.** | offen | **L** |

~~Wenn nur eine dieser Ideen gebaut wird: **Mentorenbogen**.~~ — **gebaut, und die Empfehlung
hat sich gehalten.** Der Mentorenbogen ist das Stück Stufe 4, das im Spiel am meisten
hergibt: messbar (+44 % Attributzuwachs), sichtbar (Kaderbildschirm, Kabinenbericht) und
erzählend (drei Postnachrichten je Paar plus die Rückennummer).

~~**Die nächste Empfehlung heißt jetzt anders: Ära-Konflikte.**~~ — **gebaut, und die
Begründung hat gehalten.** Sie war die billigste der verbliebenen Ideen, sie greift die
Schwäche auf, die bei der Abnahme von Stufe 4 gemessen wurde — die Chemie kostet den Spieler
zu wenig, um eine Entscheidung zu erzwingen — und sie löst das über eine **Frage** statt über
eine Zahl. Kein einziger Wert in `WEIGHTS.chemie` musste dafür angefasst werden.

Was die erste Abnahme hinzuzufügen hatte: Die Frage wurde selten gestellt (0,38 mal je
Spielzeit beim eigenen Verein), und in Zahlen war eine der beiden Antworten deutlich
billiger als die andere. **Beides ist inzwischen erledigt und in 8.6 nachgemessen:** 3,08
Fragen je Spielzeit, Kosten 60,4 gegen 77,2 über 120 Tage, kein Weg mehr auf allen Achsen
der billigere. Was offen blieb, steht ebenfalls dort — die eine Kabinenlage, in der es
immer noch 1,45 steht.

**Die nächste Empfehlung heißt jetzt: Legenden als Co-Trainer.** Sie ist die einzige
verbliebene Idee, die den Einfall weiterträgt statt ihn zu wiederholen, und seit Stufe 6 ist
der Ort dafür gebaut — die Ruhmeshalle.

---

## 5. Technische Schulden

Konkret, mit Dateibezug, sortiert nach Schmerz beim Umbau.

**Schlussstand nach Stufe 6.** Was seit der ersten Fassung dazugekommen und was
verschwunden ist:

| | |
|---|---|
| **erledigt** | 5.1 Ligazugehörigkeit · 5.2 Saisonwechsel in der Oberfläche · 5.4 Felder ohne Schreiber · 5.8 Torschnitt-Korridore · **5.7 Spielstandbremse** (Abschnitt 8) |
| **offen, unverändert** | 5.3 geteilte Saisonwechsel-Zuständigkeit · 5.9 Gehaltsspreizung · 5.10 Europapokal-Prämien · 5.11 Doppelbelastung im Training · 5.12 Sperren im eigenen Wettbewerb · **die vier toten Exporte aus 5.4** (`karriere.js:fortbildungen()`, `fortbildungBelegen()`, `fortbildungStand()`, `lizenzStand()`) — an der Datei nachgeprüft: kein Bildschirm ruft sie, auch `screens/stab.js` nicht. Acht fertige Trainerfortbildungen, die niemand buchen kann. |
| **offen, kleiner geworden** | 5.5 fehlende Tests — die Bildschirme sind seit Abschnitt 8 mit `test-screens.js` gedeckt, offen bleiben `board.js` und `media.js` · 5.6 Provisorien — der Schiedsrichter-Rückfallwert und die vier Notnagel-Pfade stehen noch, aber `npm run check` deckt sie jetzt mit allen 23 Skripten ab |
| **neu dazugekommen** | **5.13** Zwei Felder für die Fanzahlen (`club.fanbase` gegen `club.fans`) — die Ursache des schwersten Funds von Stufe 6, behoben, aber nicht beseitigt |

**Stufe 6 hat unterm Strich Schulden abgebaut, nicht aufgebaut.** Sie ist die einzige Stufe,
die kein Feld im Spielstand angelegt hat, und sie hat mit `tools/check-suite.js` die
Grundlage dafür geschaffen, dass die anderen Schulden überhaupt auffallen: Bis Stufe 6
startete `npm run check` genau ein Skript von einundzwanzig.

### 5.1 Ligazugehörigkeit ist eine Modulkonstante · **erledigt in Stufe 1**

`state.leagues[leagueId].clubIds` ist die Wahrheit; `LEAGUES.*.clubIds` in `data/leagues.js`
ist nur noch die Vorlage für Saison 1. `loop.js:ligaVereine` liest den Spielstand und fällt
nur auf die Vorlage zurück, wenn dort nichts steht; `state.js:ligaVonVerein` ebenso.
`club.leagueId` läuft als Kopie mit und wird an einer Stelle (`state.js:migrate`) mit
`state.leagues` in Deckung gebracht.

**Restposten:** Die Kopie `club.leagueId` bleibt eine zweite Ablage derselben Information.
Sie widerspricht sich heute nicht — aber nichts hindert den nächsten Umbau daran, nur eine
der beiden zu pflegen. Europäische Vereine tragen `leagueId: 'europa'` und stehen bewusst in
**keiner** Ligaliste; wer `state.leagues` durchzählt, findet sie nicht, wer `club.leagueId`
auswertet, schon.

### 5.2 Der Saisonwechsel steht in der Oberfläche · **erledigt in Stufe 1**

`core/loop.js:saisonWechsel(state, ctx)` ist der eine Ort, an dem eine Saison endet;
`main.js` ruft auf und zeigt an, `screens/saison.js` stellt den Bericht dar. Damit ist der
Übergang für Prüfskripte erreichbar — `test-saison.js`, `test-karriere.js` und
`test-europa.js` spielen ihn je zweimal je Lauf.

**Was der Umbau nicht mitgenommen hat:** Die drei Vereinsmodule, die den Saisonwechsel
weiterhin selbst erkennen, statt von `saisonWechsel()` gerufen zu werden. Genau daran ist
`club/medical.js` gescheitert — siehe 5.3.

### 5.3 Die Zuständigkeit für „Saisonwechsel" ist geteilt und undokumentiert · *hat bereits weh getan*

Drei Vereinsmodule erkennen den Saisonwechsel selbst und räumen eigenständig auf — jedes
über eine eigene Erkennung:

| Modul | Erkennung | Was es tut |
|---|---|---|
| `finances.js:391` | `t.season > f.abrechnungSaison` | Bilanz, Budget, Altlasten |
| `medical.js:1428` | ~~`if (day === 0)`~~ → `k.saison !== state.date.season` | Verletzungszähler, Ausfalltage, Karten, Sperrcursor |
| `transfers.js:3043` | `if (ctx.isSeasonEnd)` | auslaufende Verträge, Leihrückkehr |

**Der vorhergesagte Schaden ist eingetreten, und er war groß.** `medical.js` erkannte den
Wechsel an `day === 0` — ein Tag, den `core/loop.js:advanceDay` nie an die Vereinsmodule
weiterreicht, weil es den Zähler vorher hochsetzt. Der Reset lief von Stufe 1 an **kein
einziges Mal**; Sperren liefen deshalb nie ab, und ab Saison 3 konnte kein einziger der 36
Vereine noch elf Spieler aufstellen. Gefunden erst bei der Abnahme von Stufe 3, unter drei
grünen Prüfläufen hindurch. Die vollständige Messung steht bei Stufe 3.

Behoben ist der eine Fall, **nicht das Muster**: `fans.js`, `sponsors.js`, `board.js`,
`morale.js`, `youth.js`, `staff.js`, `training.js` und `stadium.js` tun beim Saisonwechsel
weiterhin **nichts**, und ob das Absicht oder Auslassung ist, steht nirgends. CONTRACTS.md
§11 kennt nur `tick<Modul>(state, ctx)`. Ein zusätzlicher Vertrag
`saisonwechsel<Modul>(state, ctx)`, den `loop.js:saisonWechsel` **explizit** ruft, würde die
Frage ein für alle Mal klären und die Selbsterkennung überflüssig machen. Solange sie
bleibt, kann derselbe Fehler in jedem der drei Module noch einmal passieren.

### 5.4 Felder, die gelesen und nie geschrieben werden

Nach Stufe 1 bis 4 ist von dieser Liste **keine Zeile mehr übrig** — alles eingelöst.
Nachgeprüft an der Datei, nicht am Versprechen:

| Feld | Stand |
|---|---|
| `manager.bilanz.*` | **geschrieben** — `loop.js:applyResult` nach jeder eigenen Partie |
| `manager.erfahrung`, `.level`, `.skills.*`, `.reputation`, `.titel` | **geschrieben** — `club/karriere.js:1132–1172` nach jedem Saisonende |
| `history.titel[saison]` | **geschrieben** — `club/karriere.js:1449`, gelesen von `:1521`. Ein Bildschirm dafür fehlt weiterhin (Stufe 6). |
| `player.retired` | **geschrieben** — `club/karriere.js:503` |
| `settings.autoAufstellung`, `.textTempo`, `.animationen`, `.bestaetigungen` | **gelesen und geschrieben** seit Stufe 2, mit beiden Werten gegengemessen |
| `state.europa.*` | **geschrieben** — `club/europa.js`, eigener Bildschirm `screens/europa.js` |
| **`club.chemistryHistory`** | **geschrieben** seit Stufe 4 — `club/chemie.js:leitwertSchreiben` für den eigenen Verein (aus dem Paargitter), `kiMittelSchritt` für alle anderen. Gemessen 30,0 → 69,5 über drei Saisons. |
| `club.chemie.paare`, `player.mentor`, `player.mentees`, `state.national` | **geschrieben und gelesen** seit Stufe 4 — `club/chemie.js`, `club/national.js`; angezeigt auf `screens/kader.js`, `screens/verein.js`, `screens/taktik.js` |

Damit ist das Kernversprechen aus der README (*„Die Chemie … wächst mit gemeinsamer
Spielzeit"*) eingelöst. **Neu auf der Liste steht dafür die Umkehrung** — Funktionen, die
exportiert und nie gerufen werden:

| Export | Stand |
|---|---|
| `karriere.js:fortbildungen()`, `fortbildungBelegen()`, `fortbildungStand()`, `lizenzStand()` | **von keinem Bildschirm gerufen.** Acht Trainerfortbildungen mit Preis, Text und Wirkung liegen fertig da; der Spieler kann keine buchen. Gehört auf `screens/stab.js`, wo die Kurse des Trainerstabs bereits stehen. |
| `chemie.js:mentorVorschlaege()` / `mentorZuweisen()` / `mentorLoesen()` | **gerufen** — `screens/kader.js` importiert alle drei |

### 5.5 Fehlende Tests

| Modul | Zeilen | Testskript |
|---|---|---|
| `match`, `ratings`, `tactics`, `transfers`, `finances`, `stadium`, `fans`, `youth`, `medical`, `morale` | — | vorhanden |
| **`club/board.js`** | 1.560 | **fehlt** — Entlassung, Vertrauensfrage und Jobangebote sind völlig ungetestet, obwohl das Modul das Spiel beenden kann |
| **`club/media.js`** | 1.765 | **fehlt** |
| `club/training.js` | 1.772 | mitgeprüft von `test-karriere.js` und seit Stufe 4 von `test-chemie.js` Z03 (Mentorenfaktor) — kein eigenes Skript |
| `club/chemie.js` | 1.191 | **vorhanden** seit Stufe 4 — `test-chemie.js`, 10 Zusicherungen |
| `club/national.js` | 1.099 | mitgeprüft von `test-chemie.js` Z09 (Berufungen, Fitnesskosten, keine Verletzten) — kein eigenes Skript |
| `club/staff.js` | 1.134 | mitgeprüft von `test-jugend.js` (kein eigenes Skript) |
| `club/sponsors.js` | 819 | mitgeprüft von `test-finanzen.js` (kein eigenes Skript) |
| `render/sound.js` | 1.513 | **vorhanden** seit Stufe 2 — `check-sound.js`, 37 Prüfungen, gegen einen Attrappen-AudioContext |
| `game/matchday.js`, übriges `render/*`, `interactive/*` | — | keine Tests — DOM- und Canvas-gebunden |
| `club/europa.js` | 1.459 | **vorhanden** seit Stufe 3 — `test-europa.js` (14 Zusicherungen), `check-euroclubs.js`, `test-shootout.js` |
| **Die Bildschirme gegen ein echtes DOM** | — | **vorhanden** seit Abschnitt 8 — `tools/test-screens.js`. Viermal gebaut und viermal weggeworfen (Stufen 2, 3, 4, 6), beim fünften Mal behalten. 19 Bildschirme an zwei Zeitpunkten, 954 betätigte Bedienelemente, 134 Dialoge, Escape-Kette in vier Varianten, 699 von 699 Fokusringen, 0 Laufzeitfehler. Beim Einbau hat er sofort wieder zwei Fehler gefunden, die kein anderes Skript sehen konnte (siehe 8.2). Im Dateikopf steht auf zwei Bildschirmseiten, **was er nicht prüft** — Layout, Aussehen, Zeichnungen, echte Eingabe, Nebenläufigkeit, Wartezeiten, Dauerlast. |
| Alles jenseits von Tag 120 / Saison 1 | — | **vorhanden** seit Stufe 1 — `test-saison.js`, `test-karriere.js`, `test-europa.js` (je drei Saisons), seit Abschnitt 8 zusätzlich `test-spielstand.js` über **acht** Spielzeiten |

`check-screens.js` prüft die Bildschirme statisch (Exporte, Importe, CSS-Klassen) — gut,
aber kein Ersatz für einen echten Durchlauf; den macht seit Abschnitt 8 `test-screens.js`.
**Damit steht `test-board.js` an erster Stelle**, weil `club/board.js` das ungeprüfte Modul
mit der härtesten Konsequenz ist: Es kann das Spiel beenden.

**Und eine dritte Lehre, aus der Schlussabnahme:** Auch ein Prüfstand mit elf Zusicherungen
über acht Spielzeiten kann acht Zeilen lang grün sein und trotzdem am Spiel vorbeiprüfen —
wenn er die geprüfte Funktion selbst aufruft, statt zu prüfen, ob das Spiel sie aufruft.
Genau das ist der Spielstandbremse passiert (8.1). Die Gegenmaßnahme kostet eine
Zusicherung: **einmal denselben Weg gehen, den das Spiel geht, ohne Prüfschalter.**

**Und eine Lehre aus dieser Abnahme, die über die Testliste hinausgeht:** Der Fehler in
`medical.js` (5.3) lag zwei Stufen lang unter zwanzig grünen Prüfskripten. Kein einziges
davon prüft die simpelste Frage überhaupt — **können am Ende einer Saison alle Vereine noch
elf Spieler aufstellen?** Eine solche Plausibilitätsprüfung in `test-saison.js` (verfügbare
Spieler je Verein ≥ 14, gesperrte Spieler je Liga in einem Korridor) hätte ihn sofort
gefunden und kostet zehn Zeilen.

**Die Lehre aus der Abnahme von Stufe 4 ist eine andere und eine bessere:** Sie wurde
gefunden, weil `test-chemie.js` **vor** der Mechanik geschrieben wurde und weil es nicht nur
prüft, sondern bei jeder gerissenen Zusicherung einen Hinweis mitliefert, **wo** man
nachjustieren müsste. Der Satz „`engine/ratings.js:CHEMISTRY.eraMixMin = 3` — bei 9:2 ist
die Minderheit nur 2, der Ära-Abzug greift gar nicht" stand fertig im Prüfprotokoll; die
Abnahme musste ihn nur noch bestätigen und die Zahl ändern. **Kein anderes Prüfskript im
Projekt tut das.** Wenn ein zweites diese Eigenschaft bekommt, dann `check-all.js` — dort
steht seit Monaten ein Torschnitt-Hinweis ohne Angabe, an welcher Schraube er hängt.

### 5.6 Provisorien mit Kommentar im Code

| Ort | Provisorium | Stand |
|---|---|---|
| ~~`main.js:472`~~ | „Saisonwechsel: vorerst einfacher Neustart des Kalenders" | **weg** seit Stufe 1 (`loop.js:saisonWechsel`) |
| ~~`state.js:585`~~ | `migrate()` als Versionsstempel ohne Logik | **weg** seit Stufe 3: zwei echte Migrationsschritte, `SAVE_VERSION = 3`, neuere Stände werden laut abgelehnt |
| ~~`matchday.js:421`~~ | `sound: () => { }` | **weg** seit Stufe 2 |
| ~~`loop.js:252`~~ | `if (fx.competitionId === state.managerClubId)` — Wettbewerbs-ID gegen Vereins-ID | **weg** |
| `spieltag.js:356` | Schiedsrichter-Rückfallwert „noch nicht angesetzt", `strictness: 50`, `homeBias: 50` | **offen, aber entschärft**: seit Stufe 2 setzt `matchday.js:schiedsrichterFuer` einen echten an, der Rückfallwert greift nur noch, wenn gar keine Akte gefunden wird |
| `stadium.js:41`, `staff.js:42`, `sponsors.js:149`, `training.js:586` | Notnagel-Pfade aus der Entstehungszeit („finances.js noch nicht vorhanden", „data/names.js liegt noch nicht vor", „staff.js noch nicht bereit") | **offen.** Alle vier Module existieren längst. Toter Code, der im Fehlerfall **still das Falsche tut, statt laut zu scheitern** |
| `screens/stab.js:90` | „Notlösung für Eigenschaften, die `data/generator.js` vergibt" | **offen** |

### 5.7 Spielstandwachstum ohne Bremse · **erledigt in Abschnitt 8**

**Gebaut.** Die Bremse steht in `core/state.js:verdichteVergangenheit()` und läuft beim
Saisonwechsel. Zwei Vorhersagen dieses Abschnitts sind dabei überprüft worden:

- **Die Prüfschwelle wäre erreicht worden** — aber später als hier geschätzt. Ungebremst
  gemessen: 20,56 MB nach acht Spielzeiten, also fällt die 25-MB-Schwelle in Spielzeit elf,
  nicht in Spielzeit acht. Der Unterschied ändert nichts an der Sache: Der Zuwachs hörte
  nicht auf.
- **`player.mentor.text` war tatsächlich der billigste Posten** — die Bremse nimmt ihn
  zurückgetretenen Spielern zusammen mit allem anderen ab, was ein beendetes Berufsleben
  beschreibt. Ein `delete` im Schema war dafür nicht nötig, weil `mentorPaare()` den Satz
  ohnehin neu baut.

Und eine dritte Vorhersage hat sich als richtig erwiesen, nur anders als gedacht: *„Wer die
Bremse baut, baut sie gegen die Ruhmeshalle als Abnahmekriterium."* Genau das tut
`tools/test-spielstand.js` — es rechnet die vier Chronikauswertungen bei jedem Saisonwechsel
vor und nach der Verdichtung nach. Sie waren acht von acht Mal identisch. Was dabei **nicht**
geprüft war und beinahe durchgerutscht wäre: ob das Spiel die Bremse überhaupt aufruft. Es
tat es nicht. Siehe 8.1.

*Der Rest dieses Abschnitts ist der Befund, wie er dastand.*

Siehe S3. Es gibt weiterhin keinen Mechanismus, der Datensätze wieder loswird: keine
Archivierung alter Fixtures, keine Bereinigung ausgemusterter Jugendspieler, und
zurückgetretene Spieler bleiben als vollständige Datensätze liegen (**gemessen bei der
Abnahme von Stufe 6: 115 nach drei Saisons**, mit `p.retired` gesetzt und ohne Verein —
mehr als doppelt so viele wie die 50–66, die nach Stufe 4 gezählt wurden).
`state.js:KOMPAKT` kürzt ausschließlich Protokolle (Kassenbücher, Einsatzlisten,
Verlaufsdaten), nie Objekte.

**Stufe 6 hat diese Rechnung zum ersten Mal von zwei Seiten beleuchtet.** Die Chronik
*braucht* die zurückgetretenen Spieler — die Ruhmeshalle zeigt alle 115 mit Spielen, Toren,
Alter und Abschiedstext. Das entwertet den naheliegendsten Sparvorschlag nicht, es schärft
ihn: Ein Spieler, der vor drei Jahren aufgehört hat, braucht in `state.players` **keine
zwanzig Attribute, kein Aussehen, keinen Vertrag und keine Trainingskurve** — er braucht
Name, Position, Verein, Karrierezahlen und den Abschiedstext. Das sind rund zehn Felder
statt sechzig, und die Chronik läuft unverändert weiter. **Wer die Bremse baut, baut sie
gegen die Ruhmeshalle als Abnahmekriterium** — sie ist der einzige Verbraucher, der
widersprechen würde.

**Neu ist, dass die Rechnung aufgeht und knapp wird.** Gemessen nach Stufe 6: **13,21 MB**
nach drei Saisons (Seed 7, HSV), 11,96 MB nach 120 Tagen. Die Lazy-Regel für die
europäischen Vereine hat gehalten (nur 14–16 von 66 mit Kader), das war die richtige
Entscheidung — aber der Zuwachs von rund **1,5 MB je Saison** läuft weiter.

*Zur Prüfschwelle:* `check-all.js:764` prüft gegen **25 MB**, mit der im Quelltext
mitgelieferten Begründung, dass der Spielstand in IndexedDB liegt und dort das
5-MB-Kontingent von `localStorage` nicht gilt. Das ist sachlich richtig und verschiebt die
Frage trotzdem nur: Bei 1,5 MB je Saison ist die Schwelle nach etwa acht Spielzeiten
erreicht. **Eine Schwelle ist keine Bremse.**

~~Stufe 5 kommt mit weiteren ~0,8 MB obendrauf.~~ — **falsch, gemessen bei der Abnahme von
Stufe 5: −0,004 MB.** Die 2. Liga hatte auch vorher 432 Spieler im Spielstand, nur
prozedural erzeugte; die handgepflegten Kader ersetzen sie. Ein handgeschriebener Spieler ist
im JSON keinen Deut größer als ein generierter.

**Stufe 4 hat sich dabei ordentlich gehalten** (280 kB, siehe S3) — aber sie hat auch die
billigste Bremse des ganzen Projekts hinterlassen: `player.mentor.text` ist ein fertig
formulierter deutscher Satz je Mentorenpaar, **59 kB nach drei Saisons**, und
`chemie.js:mentorPaare()` baut ihn ohnehin aus `mentorText()` neu, wenn er fehlt. Ein
`delete` in `mentorSetzen()` und ein Feld weniger im Schema. Wer die Bremse sucht, fängt
hier an, bevor er sich an die zurückgetretenen Spieler wagt.

~~Die Entscheidung, wie viel Vergangenheit ein Spielstand mitschleppen darf, bleibt
**fällig**.~~ — **Getroffen.** Sie steht als `VERDICHTUNG` und `RUHMESHALLE_FELDER` in
`core/state.js`, beide an einer Stelle und beide kommentiert. Der Satz, mit dem dieser
Abschnitt endete, ist genau der Bauplan geworden: Ein Spieler, der vor drei Jahren
aufgehört hat, steht heute mit vierzehn Feldern im Spielstand statt mit sechzig — und die
Chronik zeigt ihn unverändert.

### 5.8 Die Torschnitt-Korridore sind nicht nach Ligatyp getrennt · **erledigt vor Stufe 5**

`check-all.js` liest den Ligatyp seit der Trennung **aus den Daten**, nicht aus einer
Ligaliste: Liegt der Anteil der Spieler mit `era === 'legend'` über 20 %, gilt der
Legendenkorridor 3,1–3,8, sonst der prozedurale 2,6–3,3. Damit hat die Prüfung die
2. Bundesliga von selbst umgestuft, als sie in Stufe 5 ihre Legendenkader bekam — beide
Ligen melden jetzt „41 % Legenden". Dazu kommt die Trefferquote als eigene,
ligaübergreifende Prüfung (10–13 %, höchstens 2,0 Prozentpunkte Spreizung); gemessen nach
Stufe 5 sind es 11,89 % gegen 11,65 %. Der Rest dieses Abschnitts ist die Vorgeschichte.

Siehe S6. `test-match.js` prüft mit synthetischen Kadern gegen 2,8–3,2 und misst 2,91 —
korrekt. `check-all.js:472` prüft die echten Ligen gegen die aufgeweitete Toleranz 2,4–3,6
und lässt damit sowohl die 1. Liga (**3,62** nach Stufe 4, vorher 3,83) als auch die 2. Liga
(2,91) durchgehen. Beide Skripte sind grün, und die eine Zahl, die wirklich eine Frage
aufwirft, verschwindet in der Toleranz.

*Nachtrag Stufe 4:* Der Torschnitt der 1. Liga ist ohne einen einzigen Eingriff in
`engine/match.js` um 0,21 gefallen — die Korrektur an `CHEMISTRY.eraMixMin` schwächt jede
gemischte Elf zu Saisonbeginn, und das sind in dieser Liga fast alle. Das ist ein Hinweis
darauf, dass der hohe Torschnitt **nicht** allein an den Legendenkadern hängt, sondern auch
daran, wie stark die Elf am ersten Spieltag rechnerisch ist.

Sauber wäre: ein Korridor für Ligen mit Legendenkadern (~3,2–3,7) und einer für Ligen mit
prozeduralen Kadern (2,8–3,2), plus die Trefferquote als eigene, ligaübergreifende Prüfung
— sie ist die Kennzahl, die laut `engine/match.js` in beiden Fällen gleich sein *muss*
(11,5 %). Wenn die auseinanderläuft, ist wirklich etwas kaputt.

### 5.9 Die Gehälter innerhalb eines Kaders liegen zu dicht beieinander

Entstanden bei der Reparatur der Vereinswirtschaft (siehe unten). `vereinsgehalt()` in
`data/squads/_helper.js` staucht alles oberhalb der Vereinsspitze über
`x · (1 + x/spitze)^(−0,5)`. Das rettet die Bilanz, trifft aber die Spitzenverdiener
deutlich härter als den Rest: Die Spreizung Bestverdiener zu Schlechtestverdiener fiel von
6,3× auf 2,6–3,1×. Gemessen bei Bayern: Beckenbauer 12,8 Mio, Median 9,6 Mio, letzter
Mann 4,7 Mio.

Ein Teil davon ist berechtigt — ein Kader aus lauter Legenden *hat* eine flache
Gehaltsstruktur. Der Rest kostet Spieltiefe: Vertragsverhandlungen, das Panel
„Gehaltsstruktur" im Finanzbildschirm und die Abwägung „Star halten oder Kader verbreitern"
leben davon, dass ein Weltklassespieler spürbar mehr kostet als ein Ergänzungsspieler.

*Nachtrag Stufe 5:* Die Skala hat einen dritten Faktor bekommen (`ligaNiveau()`, siehe
Stufe 5). Er verschiebt die Kurve als Ganzes und lässt die Spreizung innerhalb eines Kaders
unberührt — an diesem Punkt ändert sich also nichts.

Nicht angefasst, weil die Skala über vier Seeds und sechs Prüfstände kalibriert ist und
`check-all.js` (Torschnitt) sowie `test-transfers.js` (Wintertransfers) laut Messprotokoll
schon auf ±3 % Parameteränderung reagieren. Wer das angeht, braucht denselben Messaufbau:
`tools/test-wirtschaft.js` erweitern um eine Zusicherung zur Spreizung (Ziel etwa 5–8× je
Kader), dann den Stauchungsexponenten anheben und die Vereinsspitze gegensteuernd senken,
sodass die *Summe* je Verein gleich bleibt.

### 5.10 Die Europapokal-Prämien spreizen die Liga · *neu mit Stufe 3*

Gemessen nach drei Saisons (Seeds 7 und 2024, Vereine der beiden Profiligen):

| | Seed 7 | Seed 2024 |
|---|---|---|
| Konto im Schnitt, **mit** Europapokal | 165,6 Mio (13 Vereine) | 151,8 Mio (13 Vereine) |
| Konto im Schnitt, **ohne** | −1,3 Mio (23 Vereine) | −3,0 Mio (23 Vereine) |
| **Schere** | **167,0 Mio** | **154,8 Mio** |
| Bestes Konto | 827,7 Mio | 747,2 Mio |
| Vereine im Minus | 12 von 36 | 15 von 36 |

Die Zahlen sind kein Fehler — sie sind die ehrliche Folge der Prämientabelle in
`data/leagues.js` (CL-Startgeld 18,6 Mio, dazu Sieg-, Platz- und Rundenprämien plus
Marktanteil). Wie stark sie den Wettbewerb verformen, ist nach drei Saisons **noch nicht
entschieden**, und man sollte hier nichts behaupten:

* *Dafür, dass es eng wird:* Die 13 Vereine, die in drei Saisons je einmal international
  gespielt haben, belegen am Ende die Plätze 1 bis 12 (Seed 7 zusätzlich 13, beide Seeds
  zusätzlich 18) — die fünf BL1-Vereine, die nie dabei waren, stehen geschlossen auf 13 bis
  17. Eine Schichtung ist da.
* *Dagegen:* Der Kreis der Teilnehmer wechselt kräftig. Über drei Saisons ist nur **ein**
  Verein durchgehend dabei (Seed 2024: Bayern; Seed 7: Bayern und Frankfurt). Und die
  Schichtung ist auch die *Ursache* der Teilnahme, nicht nur ihre Folge — Europa spielt, wer
  oben steht.

Sicher ist nur: Über drei Saisons lässt sich Ursache und Wirkung **nicht** trennen. Wer das
klären will, braucht einen Lauf über acht bis zehn Saisons und eine Kennzahl dafür, wie oft
ein Verein ohne Europapokal noch die Plätze 1 bis 4 erreicht.

Ein Punkt ist aber schon jetzt eindeutig faul: Die KI-Vereine geben das Geld nicht aus.
`club/transfers.js` deckelt die KI-Aktivität, also **liegt der Gewinn auf dem Konto herum,
statt zu Spielern zu werden**. Ein Konto von 828 Mio ohne jede Wirkung ist eine Zahl, die
den Finanzbildschirm unglaubwürdig macht — und in dem Moment, in dem jemand die KI-Ausgaben
realistischer macht, kippt die Liga. **Das ist der Grund, warum die Schere heute harmlos
aussieht: nicht Balance, sondern Untätigkeit.**

Was zu tun wäre, in dieser Reihenfolge: (1) eine Zusicherung in `tools/test-wirtschaft.js`,
die die Schere misst statt nur den Kontostand je Verein; (2) die KI-Transferausgaben an das
tatsächliche Budget koppeln; (3) erst danach über eine Umverteilung nachdenken (Solidarpakt,
Ligaanteil an den Prämien). Nicht angefasst, weil jeder dieser Schritte `check-all.js` und
`test-transfers.js` bewegt.

### 5.11 Die Doppelbelastung erreicht das Training nicht · *neu mit Stufe 3*

`club/europa.js:belastungBuchen` bucht Reisekosten (Fitness −8 auswärts / −3 daheim), höhere
Einsatzintensität (1,4 / 1,25) und einen Härtezuschlag von 12. Das kommt in
`club/medical.js:risikoFaktoren` an: Europateilnehmer haben gemessen **24 bis 27**
Spieltage je Saison mit mindestens vier Pflichtspielen in 15 Tagen, der Rest der Liga **2
bis 5**. Der Aufschlag `BELASTUNG_RISIKO_PRO_SPIEL` greift also.

Nur bringt er wenig, weil er an der falschen Stelle sitzt: **rund zwei Drittel aller
Ausfälle entstehen im Training** (gemessen über eine Saison, alle Vereine: 395 Trainings-,
103 Spielverletzungen, 81 Infekte, 5 privat — also 68 % Training, 18 % Spiel), und
`club/training.js` weiß nicht, dass die Mannschaft mittwochs in Piräus war. Ein Verein mit drei Spielen in acht Tagen trainiert im Spiel genauso hart wie
einer mit einem. Solange das so ist, kann Spieldichte die Verletzungsbilanz nicht
nennenswert bewegen — zwölf Mehrspiele bringen rund **eine** zusätzliche Verletzung je
Verein und Saison, und das verschwindet je Saison im Rauschen (Zusicherung Z11 in
`tools/test-europa.js` beschreibt die Messlage im Detail).

Der Hebel ist deshalb **nicht** ein höherer Reiseabzug — das hat schon der Erbauer
gegengeprüft (Reise 12/5, Intensität 1,5, Härte +20: nur mehr Streuung) —, sondern eine
Trainingssteuerung, die auf Spieldichte reagiert: weniger Intensität und weniger
Verletzungswürfe in einer englischen Woche, dafür spürbar mehr Fitnessverlust aus den
Spielen selbst. Eigene Aufgabe an `club/training.js` mit `tools/test-medizin.js` als
Messlatte, nicht nebenbei.

### 5.12 Sperren laufen nur im eigenen Wettbewerb ab · *neu, klein*

`club/medical.js:sperrenAbbauen` zählt eine Sperre nur herunter, wenn der Verein im
passenden Wettbewerbstyp wieder spielt (Liga gegen Nicht-Liga). Wer im Europapokal oder
Pokal gesperrt wird und danach **ausscheidet**, sitzt die Sperre nie ab — sie bleibt bis
zum nächsten Saisonreset stehen. Mit dem Europapokal gibt es dafür jetzt dreimal so viele
Gelegenheiten wie vorher.

Gemessen nach dem Reset-Fix aus 5.3: 63 / 130 / 152 gesperrte Spieler am Ende der Saisons
1 bis 3, und in Saison 3 vorübergehend drei bis fünf Vereine mit weniger als elf verfügbaren
Spielern. Das ist eine Größenordnung besser als vorher (596 / 834 und alle 36 Vereine), aber
es ist noch nicht null, und der Trend zeigt nach oben. Sauber wäre, eine Sperre nach einer
festen Zahl von Kalendertagen ohne passendes Spiel verfallen zu lassen — oder sie beim
Ausscheiden aus dem Wettbewerb auf die Liga umzubuchen, wie es der DFB tut.

### 5.13 Zwei Felder für dieselbe Sache: `club.fanbase` und `club.fans` · *neu mit Stufe 6*

`club.fanbase` ist die **Gründungsvorlage** aus `data/clubs.js` (`{ members, ultras, mood,
potential }`) und wird nie fortgeschrieben. `club.fans` ist der **laufende Zustand** und
enthält dieselben vier Felder plus `protest`, `dauerkarten`, `erwartung`, `groll` und
weitere. `state.js:initClubRuntime:133` baut `fans` beim Anlegen aus `fanbase` auf; danach
laufen die beiden auseinander (gemessen: HSV nach drei Saisons 147.854 gegen 96.000
Mitglieder).

Vier Module lesen die richtige Reihenfolge (`club.fans || club.fanbase` in `sponsors.js:238`,
`stadium.js:262`, `finances.js:288` und `:365`), eines las die falsche — und genau dieses
eine war das Dateiformat des Editors. **Die Folge war ein Datenverlust ohne jede
Fehlermeldung:** Wer exportierte, nichts änderte und importierte, warf drei Jahre
Mitgliederentwicklung weg. Behoben in `state.js:clubStammdaten` (eine Zeile, mit
Begründung im Quelltext); nachgemessen ist der erste Rundlauf jetzt verlustfrei und jeder
weitere ein Nulldurchgang, auch über alle 36 Vereine und 765 Spieler.

**Behoben ist der Fall, nicht die Schuld.** Solange zwei Felder dieselbe Sache meinen,
kann derselbe Fehler an jeder neuen Lesestelle noch einmal passieren, und keine Prüfung im
Projekt würde es merken. Sauber wäre eines von beiden: entweder `fanbase` beim Anlegen in
`fans` auflösen und das Feld löschen (Migration nötig, `SAVE_VERSION` 3 → 4), oder
`fanbase` ausdrücklich als *Gründungswert* dokumentieren und in CONTRACTS.md festhalten,
dass es **nur** `initClubRuntime` lesen darf. Der zweite Weg kostet zehn Minuten, der erste
ist der richtige.

---

## 6. Nicht geplant

Damit der Umfang nicht ausufert. Diese Entscheidungen sind Teil des Produkts, nicht Faulheit.

| Nicht geplant | Warum |
|---|---|
| **Online-Mehrspieler, Ligen über das Netz** | Braucht Server, Konten, Anti-Cheat und Betrieb. Das Spiel ist bewusst eine `index.html` plus ES-Module ohne Build und ohne Backend. Hotseat war in Stufe 6 als Ausbaureserve vorgesehen und wurde **nicht** gebaut (niemand hat gefragt); Netz nein — und zwar endgültig. |
| **Echte Vereinslogos, Spielerfotos, Sprachaufnahmen, Lizenzdaten** | Rechtlich unmöglich und gegen das Prinzip. Alles Grafische ist prozedural (`render/portraits.js`, `kits.js`) — das ist der Grund, warum 2.000 Spieler unterscheidbare Gesichter haben, ohne dass eine einzige Bilddatei im Projekt liegt. |
| **3D-Ansicht** | Die Vogelperspektive aus `render/pitch.js` **ist** die Anstoss-Geste. 3D wäre ein anderes Spiel und würde die 0,44 ms/Spiel zerstören, auf denen mehrere Ideen aus Abschnitt 4 aufbauen. |
| **Weltweite Ligapyramide (50 Länder, 500 Vereine)** | Spielstand, Datenpflege und Simulationszeit. Zwei deutsche Ligen plus Europapokal sind das Zielbild. Denkbare Ausbaureserve: **eine** zweite spielbare Nation (Österreich oder Schweiz — klein, mit eigenen Legenden). Sie wäre jetzt möglich, steht aber hinter allen drei Punkten aus Abschnitt 8 — und hinter der Spielstandbremse allein schon deshalb, weil sie den Spielstand um eine weitere Liga verbreitert. |
| **3. Liga und Amateurpyramide als spielbare Ebene** | Die 28 Amateurvereine bleiben Pokalkulisse. Der Abstieg aus der 2. Liga endet als Spielende („In der Regionalliga werden Sie nicht gebraucht") — das ist eine Konsequenz, kein Feature. |
| **Spielerverhandlung als Minispiel, Trainerlaufbahn im Ausland, Aktienkurse, Vereinspolitik als eigenes Ressort** | Anstoss 1/2 hatte das nicht. Jede dieser Ideen ist für sich gut und würde das Spiel unschärfer machen. |
| **Echtzeit-Multiplayer im Spieltag, Streaming, Zuschauermodus** | Kein Nutzen für einen Einzelspieler-Manager. |
| **Frameworks, Bundler, TypeScript, npm-Abhängigkeiten** | Harte Regel aus CONTRACTS.md §0. `node --check`, die Skripte unter `tools/` und der Browser sind die gesamte Werkzeugkette und sollen es bleiben. Wer mehr braucht, hat sich verlaufen. |
| **Automatische Kaderaktualisierung nach echten Transfers** | Braucht eine Datenquelle und damit Netzwerkzugriff. Der Editor aus Stufe 6 **ist** die Antwort darauf und steht: Stammdaten als eingerücktes JSON, das man in jedem Texteditor nachpflegen kann, geprüft mit 36 Vereinen und 765 Spielern. Wer neue Kader will, schreibt sie — oder tauscht die Datei mit jemandem, der es getan hat. |
| **Vollständige Barrierefreiheit nach WCAG AA** | Erreicht sind Tastaturbedienung (alle 17 Reiter auf je einer Taste, Escape-Kette, Fokusfalle im Dialog), Fokusringe (585 von 585 Bedienelementen gemessen) und sortierbare Tabellen mit `aria-sort` und Tabstopp. **Nicht** erreicht und nicht angestrebt: ein canvasbasiertes Spielfeld und fünf Zeigerminispiele werden nie vollständig zugänglich sein — und ob sich die Minispiele mit der Tastatur allein *gewinnen* lassen, hat bis heute niemand gemessen. Das wird benannt, nicht behauptet. |

---

## 7. Wenn Sie hier in einem halben Jahr weiterarbeiten

Fünf Sätze zum Mitnehmen:

1. **Eine grüne Suite ist kein Beweis.** Das ist die Lehre aus der Abnahme von Stufe 3.
   Zwanzig Skripte waren grün, während ab Saison 3 kein einziger der 36 Vereine mehr elf
   Spieler aufstellen konnte (5.3). Kein Skript prüfte diese Frage, weil sie zu einfach
   aussah. **Prüfen Sie nach jedem Umbau am Weltzustand zuerst die dümmste denkbare Frage:
   Kann die Welt noch spielen?**
   *Und ihr kleiner Bruder aus Stufe 4:* **Misstrauen Sie jedem Tageszähler.** `state.date.day`
   springt beim Saisonwechsel auf 0 zurück. Zweimal in vier Stufen hat genau das eine Mechanik
   still abgeschaltet — `medical.js` (`day === 0`) und `chemie.js` (`heute - mentorPruefung`).
   Wer einen Tag speichert, speichert die Saison dazu oder prüft auf Rücksprung.
2. **Nehmen Sie jede Stufe ab, nicht nur die, bei denen es Spaß macht.** Stufe 1 wurde
   gebaut und für fertig erklärt, ohne dass jemand eine dritte Saison von innen angesehen
   hat. Der Fehler daraus kostete zwei Stufen später einen halben Arbeitstag Suche —
   und wäre bei einer Abnahme in zehn Minuten aufgefallen.
   *Und ihre Steigerung aus Stufe 5:* **Auch eine reine Datenstufe ist eine Stufe.** 432
   Zeilen Kaderdaten, kein Zeichen Logik — und trotzdem fielen fünf von 21 Skripten, weil
   die Daten Annahmen verletzten, die niemand aufgeschrieben hatte (die Gehaltsskala kennt
   die Spielklasse nicht; `ligawechselKader()` kennt keine Legenden). **Fragen Sie bei
   jedem neuen Datenbestand: Welches Modell hat sich stillschweigend darauf verlassen, dass
   es diese Daten nicht gibt?**
   *Und ihre Fassung aus Stufe 6:* **Misstrauen Sie jedem zweiten Feld für dieselbe Sache.**
   `club.fanbase` und `club.fans` meinen beide „so viele Mitglieder hat der Verein". Vier
   Module lasen sie in der richtigen Reihenfolge, eines nicht — und dieses eine warf beim
   Editor-Rundlauf drei Jahre Vereinsentwicklung weg, ohne eine Zeile Fehlermeldung (5.13).
   **Wenn Sie zwei Felder für eine Wahrheit finden, schreiben Sie auf, welches gilt — oder
   löschen Sie eines.**
3. **Die Roadmap ist abgearbeitet, Abschnitt 8 auch. Was jetzt lohnt, steht in Abschnitt 9.**
   Alle Zusagen im Schema sind seit Stufe 4 eingelöst (5.4), alle sechs Ausbaustufen sind
   gebaut, **alle sieben** Befunde aus Abschnitt 2 sind behoben — S3, der Platz, als
   letzter. Und ein Satz zur Chemie, damit ihn niemand zweimal
   lernen muss: Sie zu **schreiben** war die halbe Arbeit; sie in der Engine **ankommen**
   zu lassen war die andere, und die hätte man beinahe übersehen. Eine Zahl, die sich
   bewegt, ist noch keine Mechanik — messen Sie immer bis zum Ergebnis durch, in Punkten je
   Spiel.
4. **Halten Sie sich an CONTRACTS.md, auch wenn es unbequem ist.** Der Grund, warum dieses
   Projekt bei 83.000 Zeilen ohne einen einzigen Fehler durchläuft, sind die Verträge und
   der deterministische Zufall. Wenn Sie einen Vertrag ändern müssen — ein
   `saisonwechsel<Modul>(state, ctx)` nach 5.3 wäre der nächste fällige Fall — dann ändern
   Sie **zuerst das Dokument, dann den Code**. Beim neuen Vertrag `screen.onEscape():
   boolean` aus Stufe 6 ist das **nicht** passiert — er stand im Code und fehlte in
   CONTRACTS.md §12, bis die Abnahme ihn nachgetragen hat. Genau in dieser Lücke saß auch
   der zweite Fund der Stufe: Ohne aufgeschriebene Regel („nur `true` liefern, wenn sich
   sichtbar etwas ändert") war nicht zu erkennen, dass der Editor sie brach.
5. **Trauen Sie den Kommentaren in `engine/match.js`.** Diese Datei ist die am besten
   begründete des Projekts, und ihre Aussage zum Torschnitt der Bundesliga (S6) ist
   belastbarer als die Fehlermeldung im Prüfskript, die ihr widerspricht. Wo im Code zwei
   Stellen etwas Gegensätzliches sagen, gewinnt die, die eine Messung mitliefert.
6. ~~**Und der Satz, der nach vier Abnahmen übrig bleibt:** … heben Sie den Harnisch
   auf.~~ — **getan.** Er liegt als `tools/test-screens.js` im Projekt und hat beim Einbau
   sofort wieder zwei Fehler gefunden (8.2). Fünfmal gebaut, viermal weggeworfen, einmal
   behalten. Der Satz bleibt trotzdem stehen, weil er für alles gilt, was man in diesem
   Projekt zweimal von Hand macht: **Wenn Sie einen Harnisch zum zweiten Mal bauen, bauen
   Sie ihn als Datei.**
7. **Und der Satz aus der Schlussabnahme:** Fragen Sie bei jeder fertig geprüften Funktion
   einmal die Frage, die kein Skript stellt — **ruft das Spiel das eigentlich auf?** Die
   Spielstandbremse war zehn grüne Zusicherungen und acht Spielzeiten lang wirkungslos,
   weil der Aufruf nur im Prüfstand stand. Ein `grep` nach dem Funktionsnamen in `src/`
   hätte gereicht, und niemand hat ihn gemacht.

---

## 8. Was als Nächstes · **abgearbeitet**

Hier standen drei Vorhaben. Alle drei sind gebaut und abgenommen. Was jetzt folgt, ist
kein Plan mehr, sondern ein Protokoll: was entstanden ist, was dabei gemessen wurde und
was bewusst liegen geblieben ist. Die Reihenfolge ist die alte.

### 8.1 Die Spielstandbremse · **gebaut**

**Gebaut wurde:** `core/state.js:verdichteVergangenheit()` samt `VERDICHTUNG` (alle Grenzen
an einer Stelle) und `RUHMESHALLE_FELDER` (was ein Zurückgetretener behält). Zurückgetretene
Spieler schrumpfen von rund sechzig Feldern auf vierzehn plus `stats.career` — Name,
Nation, Alter, Position, Ära samt Beschriftung, Rückennummer, Aussehen, Attribute,
Karriereende und Karrierezahlen. Alles andere beschreibt ein Berufsleben, das zu Ende ist,
und fliegt raus. Ausgemusterte Nachwuchsspieler ab 22 ohne Pflichtspiel verschwinden ganz;
Postfach, Meldungen, Kassenbücher, Verletzungsakten,
Sponsoren- und Trainingsverläufe und beigelegte Kabinenkonflikte laufen gegen feste Grenzen.
`SAVE_VERSION` steht auf **4**; die Migration 3 → 4 verdichtet einen alten Stand beim Laden.
Aufgerufen wird die Bremse in `core/loop.js:saisonWechsel()`, Abschnitt l — ganz am Ende,
nachdem der Kalender umgesprungen ist.

**Gemessen** (Seed 7, HSV, Profi, acht Spielzeiten, `tools/test-spielstand.js --referenz`):

| Saison | ohne Bremse | mit Bremse | Ersparnis | Zuwachs ohne | Zuwachs mit |
|---|---|---|---|---|---|
| 1 | 9,51 MB | 8,34 MB | 1,17 MB | 6,80 MB | 5,64 MB |
| 2 | 11,32 MB | 10,00 MB | 1,32 MB | 1,81 MB | 1,66 MB |
| 3 | 13,05 MB | 11,37 MB | 1,68 MB | 1,74 MB | 1,37 MB |
| 4 | 14,56 MB | 12,67 MB | 1,89 MB | 1,51 MB | 1,30 MB |
| 5 | 16,26 MB | 14,01 MB | 2,25 MB | 1,70 MB | 1,34 MB |
| 6 | 18,04 MB | 15,09 MB | 2,96 MB | 1,78 MB | 1,07 MB |
| 7 | 19,36 MB | 15,85 MB | 3,51 MB | 1,32 MB | 0,76 MB |
| 8 | **20,56 MB** | **17,01 MB** | 3,55 MB | 1,20 MB | 1,16 MB |

Der entscheidende Wert steht nicht in der Größenspalte, sondern in der Zuwachsspalte: Ohne
Bremse liegt der jährliche Zuwachs bei durchschnittlich 1,58 MB und sinkt nicht; mit Bremse
fällt er von 1,66 auf 1,00 MB (erste gegen zweite Hälfte der Spielzeiten 2–8). Die
Prüfschwelle von 25 MB rückt damit von Spielzeit elf auf ungefähr Spielzeit sechzehn.
**Ein Versprechen für die Ewigkeit ist das nicht** — der Stand wächst weiter, nur langsamer
und mit fallender Tendenz. Es ist die erste Kurve in diesem Projekt, die sich nach unten
biegt statt geradeaus zu laufen.

**Die Chronik hat kein Wort verloren.** `tools/test-spielstand.js` baut die vier
Auswertungen aus `screens/chronik.js` nach — Ruhmeshalle, ewige Tabelle, Titelchronik,
Rekordbuch — und rechnet sie bei jedem Saisonwechsel vor und nach der Verdichtung: **acht
von acht Mal identisch**, zuletzt mit 790 Karriereenden in der Halle, ⌀ 1.054 Byte je
Datensatz, kein einziger Verweis ins Leere unter 4.894 Spielern.

**Ein alter Spielstand lädt.** Ein nachgebauter Stand der Fassung 3 (zwei Spielzeiten,
ungebremst, 11,27 MB) wird beim Laden auf 9,87 MB gehoben, behält seine 105 Karriereenden
mit unveränderter Chronik und ließ sich anschließend eine volle Spielzeit weiterspielen.

**Und der Fund, für den diese Abnahme da war:** Die Bremse war vollständig gebaut,
vollständig geprüft — und im Spiel **nie aufgerufen**. `core/loop.js` kannte
`verdichteVergangenheit()` nicht; der Aufruf existierte ausschließlich in
`tools/test-spielstand.js`, das ihn selbst anstieß. Zehn grüne Zusicherungen über acht
Spielzeiten, und der Spielstand wuchs im Spiel weiter wie eh und je. Behoben, und dagegen
steht jetzt **Z11: „Der Saisonwechsel des Spiels verdichtet von selbst"** — ein Zwilling
geht denselben Wechsel ohne den Prüfschalter und muss dabei kleiner werden. **Die Lehre ist
allgemein: Ein Prüfstand, der die geprüfte Funktion selbst aufruft, prüft die Funktion und
nicht das Spiel.**

**Die Laufzeit ist nicht schlechter geworden, sondern besser.** Die Verdichtung selbst
kostet 2 bis 3 ms je Saisonwechsel (der ganze Wechsel dauert 20 ms). Der Tagesablauf einer
Spielzeit ging von 9,90 / 10,12 / 10,49 s (Spielzeiten 1–3, ungebremst) auf 9,46 / 9,75 /
9,90 s zurück — **4 bis 6 % schneller**, weil ein kleinerer Spielstand weniger Datensätze
hat, durch die zu laufen ist. Zum Vergleich: Bei der Abnahme von Stufe 4 lag eine Spielzeit
bei 10,2 s.

**Der Determinismus hält über acht Spielzeiten.** Zwei Läufe mit demselben Seed in je einem
eigenen Node-Prozess liefern acht Spielzeiten lang byteweise denselben Spielstand
(Fingerabdruck und Länge je Saison identisch); ein anderer Seed liefert einen anderen. Eine
Einschränkung, die dabei aufgefallen ist und keine ist: Zwei Karrieren **im selben Prozess**
unterscheiden sich um wenige Dutzend Byte, weil `util.js:uid()` einen Zähler je Prozess
führt und die Kennungen der zweiten Karriere dadurch eine Stelle länger werden. Am Spiel
ändert das nichts — ein Browser lädt eine Seite, nicht zwei Karrieren hintereinander — aber
wer einen Prüfstand baut, der zweimal dasselbe spielt, muss es wissen.

### 8.2 `tools/test-screens.js` · **behalten**

**Gebaut wurde:** der Harnisch, der viermal gebaut und viermal weggeworfen wurde, diesmal
als Datei im Projekt. **2.116 Zeilen**: DOM-Attrappe (`document`, `Element`, `classList`,
ein kleiner Selektor mit `:not()`, ein wirkungsloser Canvas-Kontext, IndexedDB- und
localStorage-Attrappen) plus der Durchlauf. Keine Abhängigkeit, keine Ausnahme von
CONTRACTS.md §0. Er fährt den echten Spielrahmen hoch (`main.boot()` → Startbildschirm →
„Spielstand laden"), nimmt alle 19 Bildschirme an zwei Zeitpunkten (Tag 1 und nach drei
durchgespielten Spielzeiten, unmittelbar vor einer eigenen Partie), betätigt jedes
Bedienelement einmal, öffnet und schließt jeden Dialog, läuft die Escape-Kette in vier
Varianten ab und zählt die Fokusringe.

**Gemessen:** 38 Bildschirmaufrufe, **954 betätigte Bedienelemente**, 90 Reiter, 134
Dialoge geöffnet und geschlossen, 36 Bildschirmwechsel über angeklickte Verweise, 2.243
DOM-Knoten in der Spitze, **699 von 699 Bedienelementen treffen eine
`:focus-visible`-Regel**, 0 Laufzeitfehler, 0 `console.error`. Laufzeit 42 s.

**Zwei Funde, beide in Code, den 21 grüne Skripte für in Ordnung hielten:**

1. `main.js:tastatur()` prüfte `document.querySelector('.tv-overlay')`. Diese Hülle bleibt
   nach dem Schließen eines Dialogs noch 260 ms im Dokument stehen (Ausblendanimation in
   `render/ui.js`). Für eine Viertelsekunde war die **gesamte** Tastatur stumm — ESC, alle
   zwanzig Reiter-Kürzel und Strg+S. Behoben mit `:not(.tv-overlay--zu)`.
2. Der Fund, den erst die Behebung des ersten sichtbar gemacht hat: Danach erledigte **ein**
   ESC-Druck zwei Dinge — Dialog zu *und* zurück ins Büro. `ui.js:dialogTasten` hängt in der
   Einfangphase am Dokument, `main.js:tastatur` in der Blasenphase am selben Dokument; ohne
   `stopPropagation()` laufen beide. Behoben in `render/ui.js`.

**Im Dateikopf steht, was er nicht prüft** — sieben Punkte, jeder mit Begründung: Layout
(`getBoundingClientRect()` liefert eine erfundene Zahl), Aussehen (kein Kaskadenrechner),
Zeichnungen (der Canvas-Kontext ist wirkungslos), echte Eingabe (ein Klick auf ein `<label>`
aktiviert hier nichts), Nebenläufigkeit, Wartezeiten und Dauerlast. **Die Breitenprüfung des
Projekts bleibt statisch gerechnet.**

**Drei Oberflächen-Altlasten aus Stufe 6 sind mit erledigt** — keine davon findet ein
Prüfskript, alle drei standen als Befund in der Abnahme von Stufe 6:

- `screens/buero.js`, interne Torjägerliste: Der Spielername stand als einziger von vier
  Namenszeilen dieses Bildschirms mit `flex: 1` **ohne** `min-width: 0` neben einem
  `flex: 0 1 auto`. Damit greift `min-width: auto`, und ein Abzeichen wie
  „Weltpokalsiegerbesieger 2002" drückt die Zeile aus dem Kasten, statt sie umbrechen zu
  lassen. Angeglichen an die drei anderen Stellen derselben Datei.
- `screens/taktik.js:302`, der Ära-Balken: Die Abschnittsbreite ist ein Prozentsatz der
  Elf, also ist der Abschnitt für „1 Legende" bei **jeder** Fensterbreite rund 9 % breit —
  die Beschriftung brach dort auf zwei Zeilen um, und der 15 px hohe Balken schnitt die
  zweite ab. `white-space: nowrap` und `line-height: 1`.
- `styles/screens.css`, zwei widersprechende `.tv-rang`-Regeln: eine als Gitter im
  Kabinen-Abschnitt, eine als Flex-Zeile im Stadion-Abschnitt. Gleiche Spezifität, spätere
  Zeile — das Gitter war seit jeher wirkungslos, und niemand hatte es bemerkt. Geblieben ist
  die eine Regel, die wirklich gerendert hat; im Kommentar steht, warum nicht andersherum
  (die vierte Gitterspalte gibt der Pille 84 px, „Führungsspieler" braucht rund 115).

*Was dabei ehrlich bleibt:* Die drei Zahlen aus der Stufe-6-Abnahme (30 px Überlauf, 8 px
Beschnitt) sind statisch gerechnet und ohne Browser nicht nachzumessen. Behoben wurde die
jeweils benannte Ursache, nicht die Zahl.

### 8.3 Ära-Konflikte · **gebaut**

**Gebaut wurde:** `club/morale.js:istAeraKonflikt()` (die Art muss `aera: true` tragen UND
es müssen beide Lager am Tisch sitzen — zwei Legenden im Positionsstreit sind kein
Generationenkonflikt), zwei neue Wege in `LOESUNGS_METHODEN`, die `loesungsWege()` nur bei
solchen Konflikten und dann zuerst ausliefert, und eine `frage` an den Konfliktarten
`legende_star` und `generation`. Im Bildschirm `screens/verein.js` stehen die beiden Wege
golden abgesetzt über den sieben allgemeinen, mit der Frage darüber und einer Rückfrage
davor.

**Entstehen sie im normalen Spielverlauf?** Ja, ohne Zutun und ohne dass man sie provozieren
muss. Gemessen über acht Spielzeiten (Seed 7, HSV, Profi, jeder Verein, der eine Kabine
führt): **826 Kabinenkonflikte insgesamt, davon 100 echte Ära-Konflikte (12,1 %)** — 53
Generationskonflikte, 47 „Legende gegen jungen Star". Das sind **12,5 je Spielzeit** in der
ganzen Spielwelt, und die Zahl schwankt zwischen 5 und 23 im Jahr.

**Für den eigenen Verein waren es beim ersten Anlauf 0,38 je Spielzeit** — drei in acht
Jahren. Das war zu wenig, um ein Spielprinzip zu sein, und die Rechnung der beiden Wege
ging ebenfalls nicht auf:

| Weg | Moral des ganzen Kaders | davon Legenden | davon Moderne | Ansehen der Legende | Trainervertrauen (Kader) |
|---|---|---|---|---|---|
| Der Alte hat recht | **−45,7** | +4,0 | −49,8 | +5,5 | **−112,1** |
| Die Zeiten haben sich geändert | **+8,3** | −8,4 | +16,7 | **−17,8** | −10,2 |

**Wer nur rechnete, wählte immer „Die Zeiten haben sich geändert".** Beides ist in der
Balance-Aufgabe danach angegangen und in **8.6** abgenommen worden — mit einem anderen
Ergebnis, als der Bauagent berichtet hatte.

### 8.4 Was dabei bewusst offen geblieben ist

- ~~**Die Balance der beiden Ära-Wege**~~ und ~~**die Häufigkeit beim eigenen Verein**~~ —
  beides in der Balance-Aufgabe angegangen und in **8.6** abgenommen. Was danach noch offen
  ist, steht dort.
- **Der Hinweis aus `test-screens.js` zu `editor.js`:** Der Editor verbraucht den ersten
  ESC-Anschlag frisch nach dem Aufbau. Das ist nach CONTRACTS.md §12 erlaubt, weil dabei
  sichtbar etwas zurückgesetzt wird (die Vereinsauswahl fällt auf die Liste zurück). Der
  Hinweis bleibt stehen, damit es niemand für einen Zufall hält.
- **Die Breitenprüfung bleibt statisch.** Eine DOM-Attrappe misst nichts. Wer wissen will,
  ob etwas aus einem Kasten läuft, braucht einen Browser, und den will dieses Projekt zu
  Recht nicht in `tools/` haben.

### 8.5 Und was Sie nicht tun sollten

Unverändert gültig:

- **Nicht an `engine/match.js` oder `engine/ratings.js` drehen**, außer in einer eigenen,
  isolierten Aufgabe mit `test-match.js` als Messlatte. Der Sperrgebiet-Hinweis bei S6 gilt
  unverändert.
- **Nicht die KI-Transferausgaben realistischer machen**, ohne vorher die Schere aus 5.10
  zu messen. Heute sieht die Liga ausgeglichen aus, **weil die KI ihr Geld nicht ausgibt**
  — nicht, weil sie ausgeglichen wäre. Wer das ändert, kippt sie in einem Zug.
- **Nicht den Hotseat bauen**, solange niemand danach fragt. Er greift überall in die
  Annahme „es gibt genau einen eigenen Verein" ein, und diese Annahme steckt nach sechs
  Stufen in jedem Bildschirm.

Und einer ist dazugekommen:

- **Keinen Prüfstand schreiben, der die geprüfte Funktion selbst aufruft**, ohne mindestens
  eine Zusicherung, die den echten Weg geht. Die Spielstandbremse war acht Zeilen
  Prüfprotokoll lang grün und im Spiel wirkungslos. Wo ein Prüfschalter nötig ist
  (`saisonWechsel(state, ctx, { bremse: false })`), gehört daneben die Gegenprobe ohne ihn.

### 8.6 Abnahme der Ära-Balance · **die Frage kostet jetzt in beiden Antworten**

Die Balance-Aufgabe aus 8.4 ist gebaut und hier unabhängig nachgemessen worden — mit einem
eigenen Messaufbau, nicht mit dem des Bauagenten. Das war nötig: **Der Bericht des
Bauagenten stimmte nicht.** Er meldete ein Verhältnis von 1,01 bei ausgeglichenen Achsen;
nachgemessen an 121 echten, im Spielverlauf von selbst entstandenen Ära-Konflikten **beim
Verein des Spielers** stand es 42,9 : 87,0 — Verhältnis **2,03**, und „Die Zeiten haben sich
geändert" war auf **allen vier Achsen** der teurere Weg. Die Schieflage war nicht behoben,
sondern umgedreht.

**Die Zahlen nach der Abnahme.** Kosten über 120 Tage als Verlust gegenüber einem Zwilling,
in dem derselbe Streit ohne Preis endet. Zwei unabhängige Grundgesamtheiten, damit keine
Zahl über eine einzige Stichprobe entscheidet:

Alle Zahlen sind **Kosten**: je größer, desto teurer. Die Hackordnung steht getrennt, weil
sie eine andere Einheit hat und in einem Fall ein *Gewinn* ist (dann negativ).

| Messaufbau | Weg | Kadermoral | Trainervertrauen | Teamgeist | **Summe** | Hackordnung |
|---|---|---|---|---|---|---|
| (a) 121 Fälle beim Verein des Spielers, 8 Seeds × 5 Spielzeiten | Der Alte hat recht | **29,7** | 14,2 | **16,5** | **60,4** | −226 (Gewinn) |
| | Die Zeiten haben sich geändert | 27,5 | **34,5** | 15,1 | **77,2** | **+1322** |
| (b) 113 Läufe `test-moral.js` 4c (alle Vereine + zwei ausgedünnte Kaderbilder) | Der Alte hat recht | **37,7** | 17,5 | **21,6** | **76,8** | −5,8 (Gewinn) |
| | Die Zeiten haben sich geändert | 14,8 | **33,0** | 12,5 | **60,2** | **+34,2** |

*(a) summiert den Einfluss der Legende über 120 Tage, (b) misst ihn am Stichtag — daher die
verschiedenen Größenordnungen bei derselben Aussage.*

- **Verhältnis teurer/billiger: 1,28 in beiden Aufbauten** (Median 1,08 bzw. 1,36).
  Korridor ≤ 1,40 — **gehalten**, in beiden.
- **Keine strikte Unterlegenheit mehr.** „Der Alte hat recht" ist teurer in Laune und
  Teamgeist, „Die Zeiten …" im Trainervertrauen, im Ansehen der Legende, in den
  Mentorenbögen und in den Wechselwünschen. Je Einzelfall war (a) 58 : 63, (b) 39 : 74 —
  welcher Weg billiger ist, entscheidet die Lage der Kabine.
- **Der Zuschnitt stimmt weiterhin:** sofortige Delle 3,6 bzw. 4,2 gegen 0,3 bzw. 0,5
  Launepunkte je Kopf, halb aufgeholt nach 4 gegen 23 bis 29 Tagen. Breit und kurz gegen
  schmal und lang.
- **Zusätzliche Wechselwünsche: 0,0 bzw. 0,16 je Entscheidung** (vorher 1,19).
  `AERA_LAUNE_BODEN` hält.

**Häufigkeit.** Der Bauagent meldete 2,85 Ära-Konflikte je Spielzeit. Unabhängig
nachgemessen über vier Seeds waren es 2,2 — und wichtiger als der Mittelwert war der
Verlauf: **5·2·0·0·0 · 6·3·2·1·1 · 7·4·2·3·1 · 1·3·3·0·1** (Spielzeit 1 bis 5). Die Frage
stellte sich im ersten Jahr und versickerte danach — genau der Befund von 8.3, nur zwei
Jahre später. **Die Ursache war ein Rechenfehler in der Schranke, nicht die Rate:**
`legende_star` verlangte von seinem „jungen Star" `leistungPct > 0,45`, den Rang im
GANZEN Kader. Ein Legendenverein hat zehn Legenden in einem 20-Mann-Kader, und Legenden sind
die besten Spieler — sie belegen die obere Hälfte vollständig. **Ab Spielzeit 3 konnte kein
moderner Spieler diese Schranke erreichen, auch nicht mit Altersgrenze 28.** Der laut
Kommentar wichtigste Streit des Spiels war rechnerisch unmöglich. Gemessen wird jetzt der
Rang **im modernen Lager**. Danach, acht Seeds × fünf Spielzeiten, voller Tagesablauf:

| | vorher | nachher | Korridor |
|---|---|---|---|
| Ära-Konflikte je Spielzeit, eigener Verein (Mittel) | 2,2 | **3,08** | 1,5–4 ✔ |
| … Spanne über acht Spielstände | 1,2–3,4 | 1,6–4,8 | ✘ nach oben bei zwei von acht |
| … wenn der Manager alles aussitzt (Mittel / Spanne) | 1,85 | **2,55** / 2,0–3,6 | ✔ bei allen acht |
| Konflikte insgesamt je Spielzeit, eigener Verein | 8,85 | **9,03** | nicht gestiegen ✔ |
| Konflikte je KI-Verein und Spielzeit | 1,08 | **1,08** | unverändert ✔ |
| Laufzeit einer Spielzeit im Tagesablauf | 10,3 s | **10,2 s** | unverändert ✔ |

**Was die Messreihen übersehen hätten** (alles einzeln headless nachgestellt — echter
Spielstand, echter Konflikt, Vereinsbildschirm über eine DOM-Attrappe gerendert):

- **Die gekränkte Legende betreut ein Talent:** Der Mentorenbogen reißt bei „Die Zeiten …",
  bleibt bei „Der Alte hat recht" — in beiden Feldern konsistent (`p.mentor` UND
  `mentor.mentees`, dieselbe Buchung wie `chemie.js:mentorLoesen`). Und er bleibt gerissen:
  90 Tage voller Vereinsmodule stellen dasselbe Paar nicht wieder her. Die Andeutung nennt
  den Zögling vorher mit Namen.
- **Die Legende ist Kapitän** (46 von 121 Fällen): Die Binde wechselt nicht ungefragt den
  Träger — das wäre eine zweite Entscheidung. Der Einfluss fällt sichtbar (100 → 72,6). Die
  Abrechnung erwähnte das mit keinem Wort; **behoben**, der Satz steht jetzt drin.
- **Zwei Ära-Konflikte gleichzeitig** (4 von 121): Beide lassen sich am selben Tag
  entscheiden, der Nachhall bleibt in seinen Grenzen. Trifft es zweimal dieselbe Legende,
  greift `ANSEHEN_MIN` — und die **Andeutung versprach trotzdem 28 Punkte**, während 12
  gebucht wurden. **Behoben:** `aeraBesetzung()` rechnet den buchbaren Betrag vor.
- **Sind die Folgen vor der Entscheidung lesbar?** Ja — der Vereinsbildschirm wurde headless
  gerendert. Beide Wege stehen mit Namen, Stückzahlen und Streitfrage da, wortgleich bei
  jedem Neuzeichnen. **Eine Lücke war da:** Geht die Kabine nicht mit — in der Messung 56
  von 121 bzw. 50 von 121 Entscheidungen, also fast jede zweite —, rechnet
  `AERA_FEHLSCHLAG` mit 1,55 ab. Die Andeutung versprach 28 Punkte Ansehen, das Spiel buchte
  40. **Behoben:** Der Vorbehalt steht jetzt an jeder Fassung beider Wege.
- **Determinismus:** Gleicher Seed, gleicher erster Ära-Konflikt, wortgleicher Text,
  gleiche Chance, identische Kabine — auch 60 Tage später.

**OFFEN GEBLIEBEN, und zwar ausdrücklich:**

1. **Beim Verein des Spielers mit intakter Kabine (Ø Laune ≥ 46, 48 der 121 Fälle) steht es
   69,5 : 100,7, also 1,45** — dort ist „Der Alte hat recht" der spürbar billigere Weg. Der
   Grund ist strukturell: Laune kehrt mit ~20 % je Tag zurück (Integral über 120 Tage:
   Faktor 5), Trainervertrauen mit 6 % (Faktor 16,7). Wer über ein Vierteljahr summiert,
   vergleicht immer auch eine schnelle mit einer langsamen Währung; in einer Kabine, in der
   `AERA_LAUNE_BODEN` nichts abfängt, gewinnt die langsame. Das ließe sich nur mit einem
   neuen, langsamen Kostenkanal für „Der Alte hat recht" schließen — und der gehört nicht in
   eine Abnahme.
2. **Die Spanne der Häufigkeit über die Spielstände ist 1,6 bis 4,8**, wenn der Manager
   jeden Streit beantwortet; zwei von acht Karrieren liegen damit über dem Korridor. Sitzt
   er alles aus, hält er bei allen acht (2,0 bis 3,6). Die Spanne hängt daran, wie sich der
   Kader über die Jahre entwickelt, und ließe sich nur mit einer Rückkopplung glätten.
3. **Die beiden Messaufbauten sind sich über das VORZEICHEN nicht einig:** (a) sieht „Die
   Zeiten …" als den etwas teureren Weg, (b) „Der Alte hat recht". Beide liegen im Korridor,
   aber der Punkt, an dem beide hineinpassen, ist eng. Wer hier weiterdreht, muss beide
   messen.

**Was dabei kaputtging und repariert werden musste — und die Lehre daraus.** Nach der
Ära-Arbeit waren zwei der 23 Prüfskripte rot, obwohl an ihren Modulen keine Zeile geändert
wurde: `check-all.js` (bl1 2,98 statt 3,80 Tore je Spiel) und `test-transfers.js` (26 statt
≤ 25 Wintertransfers, später 0 statt ≥ 2 Angebote). Nachgemessen über zehn Spielstände:

- **bl1-Torschnitt:** Mittel 3,58, **sd 0,35**, Spanne 2,98–4,10. Der Korridor 3,1–3,8 hielt
  in 6 von 10 Strömen. Der Kommentar im Skript rechnete mit sd 0,19 — das ist der Fehler der
  Torverteilung bei GLEICHER Welt, nicht der eines anderen Zufallsstroms. Korridor auf
  2,9–4,3 gestellt (Mittel ± 2 sd), mit dem Vermerk, was dabei verloren geht.
- **Wintertransfers:** Mittel 20,2, sd 4,4, Spanne 13–25 — hält im Endstand in 10 von 10
  Strömen, keine Änderung nötig.
- **Angebote für eigene Spieler:** 16/14/0/7/2/4/10/13/15/15. Die Zahl hängt fast
  vollständig daran, wie viele eigene Spieler weg wollen (`reiz *= 2,0`). Ein Spielstand mit
  null Angeboten ist keine Fehlfunktion, sondern eine Lage — Seed 2024 steht auf Platz 2,
  hat 42 Mio auf dem Konto und einen einzigen Unzufriedenen. Die Zusicherung prüft jetzt
  über die Spielstände hinweg statt in jedem einzelnen.

**Die Lehre:** Dieses Projekt hat mehrere Zusicherungen, die Punktwerte eines EINZIGEN
Zufallsstroms gegen enge Korridore halten. Sie prüfen nicht die Mechanik, sondern den Strom
— und jede Änderung an einem beliebigen Vereinsmodul kann sie umwerfen. Wer hier arbeitet,
sollte damit rechnen und die Korridore an einer gemessenen Streuung führen, nicht an einer
gerechneten.

---

## 9. Was dieses Spiel geworden ist

Aus einem Manager mit einem hübschen Einfall ist einer mit einem **Spielprinzip** geworden.
Der Einfall — Legenden und Gegenwart in einer Elf — war bis Stufe 3 eine Startaufstellung,
nach Stufe 4 eine Mechanik, die 0,03 Notenpunkte je Spiel wert war, und ist seit den
Ära-Konflikten eine **Frage**: Wer hat in dieser Kabine recht, der Mann mit den Titeln oder
der Mann mit der Zukunft? Auf eine Frage kann man keine 0,03 Punkte antworten. Das ist der
Unterschied zwischen einer Zahl, die man optimiert, und einer Entscheidung, die man abends
nacherzählt.

Drum herum steht ein vollständiges Spiel: 36 Vereine mit 864 handgeschriebenen Spielern in
beiden Profiligen, Saisonwechsel mit Auf- und Abstieg und Karriereenden, ein Europapokal
mit 66 Vereinen, Kabine, Jugend, Medizin, Stadion, Presse, Vorstand, eine Chronik, die sich
an alles erinnert, und ein Editor, der es ändern lässt — knapp 84.000 Zeilen ohne eine
einzige Abhängigkeit, ohne Build-Schritt und ohne eine Datei, die nicht im Klartext
dasteht. Und seit dieser Abnahme ein Spielstand, dessen Zuwachs von Jahr zu Jahr **kleiner**
wird statt größer: 1,66 MB in Spielzeit 2, 0,76 MB in Spielzeit 7.

Und es ist ein Spiel geworden, das seine eigenen Fehler findet. Drei der vier schwersten
Funde dieses Projekts kamen nicht aus einem Prüfskript, sondern aus einem Harnisch, den
jemand für einen Nachmittag gebaut und danach weggeworfen hat. Der liegt jetzt als
`tools/test-screens.js` im Verzeichnis, und der letzte Fund — eine Bremse, die niemand zog
— kam von der Frage, die keine Datei stellt: *Ruft das Spiel das eigentlich auf?*

**Die Ära-Frage ist inzwischen eine Entscheidung, auch rechnerisch.** Sie wird 3,08 mal je
Spielzeit gestellt statt 0,38 mal, und die beiden Antworten kosten über 120 Tage 60,4 gegen
77,2 Punkte — in zwei unabhängigen Messaufbauten dasselbe Verhältnis von 1,28, und keine
Antwort ist mehr auf allen Achsen die billigere. Wer sich vor die Legende stellt, zahlt in
Laune und Teamgeist, sofort und vor dem nächsten Spiel. Wer dem Jungen recht gibt, zahlt in
Vertrauen und Hackordnung, ein Vierteljahr lang, und verliert womöglich einen Mentorenbogen
und die Ikone dazu. Zwei Dinge sind dabei ehrlich zu sagen: In einer intakten Kabine steht
es weiterhin 1,45 zugunsten des Machtworts für den Alten, und wie oft die Frage kommt,
schwankt über acht Karrieren zwischen 1,6 und 4,8 im Jahr. Beides steht mit Zahlen in 8.6.

**Der nächste ehrliche Schritt** ist keine neue Mechanik. Es ist `tools/test-board.js`.
`club/board.js` hat 1.576 Zeilen, kann das Spiel beenden — Entlassung, Vertrauensfrage,
Jobangebot — und ist als einziges großes Vereinsmodul völlig ungeprüft. Danach, und erst
danach, die eine offene Kabinenlage aus 8.6 — und die braucht keinen neuen Regler, sondern
einen langsamen Kostenkanal für „Der Alte hat recht", damit ein Machtwort nicht nur bis zum
Wochenende weh tut.
