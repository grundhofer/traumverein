/**
 * Minispiel „Kombination im letzten Drittel"  —  KeyMoment.kind === 'kombination'
 * ---------------------------------------------------------------------------
 * Draufsicht auf das letzte Drittel. Die eigenen Spieler laufen sich frei, die
 * Gegner verschieben in Echtzeit und rücken auf den Ballführenden. Der Manager
 * entscheidet, WEN er anspielt und WIE:
 *
 *   [F] Flachpass    schnell und sicher, aber abfangbar
 *   [S] Steilpass    riskant – der Empfänger startet in die Tiefe (hoher Ertrag)
 *   [C] Chip         über die Abwehrkette hinweg, dafür langsam
 *   [D] Doppelpass   Wandspieler legt zurück, der Passgeber zieht selbst durch
 *
 * ---------------------------------------------------------------------------
 * WAS SICH MIT DEM PHYSIKKERN GEÄNDERT HAT (Umbauplan, Paket 8)
 * ---------------------------------------------------------------------------
 * Früher entschied EIN Würfel im Moment des Klicks über Erfolg oder Fehlpass;
 * der Ballflug war Deko. Heute wird nur noch die AUSFÜHRUNG gewürfelt
 * (Winkelfehler und Abschussstärke), danach entscheidet Geometrie:
 *
 *   • Der Ball ist ein Objekt mit {fx, fy, z} und einer echten Bahn (Flug −g,
 *     Aufsetzer, Rutsch-/Rollphase). Die Bahn wird beim Abspiel EINMAL auf das
 *     feste Teilschritt-Raster gerechnet und danach nur noch abgetastet —
 *     dieselbe Tabelle für Anzeige, Vorhersage und Auflösung.
 *   • Wer den Ball bekommt, entscheidet `interceptZeit()`: das kleinste `t`
 *     gewinnt. Reaktionszeit, Anlauf, Wendekosten und Sprungkraft (für hohe
 *     Bälle) gehen ein.
 *   • Zweikämpfe lösen sich über GENAU EINEN `rng.chance` beim diskreten
 *     Ereignis — nie im Teilschritt. Sonst hinge die Zahl der Würfe an der
 *     Bildrate und die Szene wäre nicht mehr reproduzierbar.
 *   • Die Passlinie zeigt DIESELBE Rechnung, über die Streubreite des Passes
 *     gemittelt. Vorhersage und Auflösung können nicht auseinanderlaufen; der
 *     Prüfstand misst die Kalibrierung nach (Gruppe 4b).
 *
 * ---------------------------------------------------------------------------
 * WOFÜR DIE PASSLINIE DA IST — und wofür nicht
 * ---------------------------------------------------------------------------
 * Die Passlinie beantwortet zwei verschiedene Fragen, und sie ist bei ihnen
 * verschieden gut. Wer nur die zweite misst, hält sie für nutzlos.
 *
 *   1. WEN spiele ich an?  Das ist die Frage, die der Spieler zuerst und am
 *      häufigsten stellt (Maus, [1]-[5]) — und hier NÜTZT die Anzeige klar.
 *      Gemessen an 651 Spiellagen aus FÜNF Saatfamilien (Prüfstand, Gruppe
 *      4e): bei festem Knopf [F] kommen 80,8 % der Pässe an, wenn man dem
 *      höchsten angezeigten Wert folgt.
 *      Gegen jede feste Ersatzregel, gepaart Lage für Lage gerechnet:
 *      reihum +9,1 ± 1,9 · freiester Mitspieler +7,2 ± 1,8 · tiefster
 *      Mitspieler +5,8 ± 1,9 · erster Kandidat +31,2 ± 1,9 Punkte. Nur gegen
 *      „immer den nächsten Mitspieler" reicht es nicht (+3,4 ± 2,0). Die
 *      Obergrenze — je Lage den besten Empfänger treffen — liegt bei 95,2 %.
 *
 *   2. WELCHEN Knopf drücke ich?  Hier kann die Anzeige nur wenig ausrichten,
 *      und zwar aus einem Grund, der im SPIEL liegt und nicht in der Anzeige:
 *      der Flachpass ist objektiv der beste Knopf. Über dieselben Lagen
 *      kommen an — flach 77,4 % · chip 70,6 % · steil 57,3 % · doppelpass
 *      52,9 % (bequeme Anspielstation) bzw. 69,9 / 63,4 / 28,3 / 37,1 % bei
 *      freier Empfängerwahl. Ein Orakel, das je Lage den besten Knopf trifft,
 *      käme auf 89,8 bzw. 84,8 % — der ganze Spielraum einer denkbaren Anzeige
 *      beträgt also 12,4 bzw. 15,0 Punkte. Davon ist wenig hebbar: eine
 *      erschöpfende Suche über acht beobachtbare Merkmale (Tiefe, Freiraum,
 *      Distanz, Druck, Zeitmarge, Anzeigewerte) findet KEINE Schwelle, ab der
 *      der Steilpass besser wäre als der Flachpass, und für den Chip
 *      bestenfalls 3 bis 5 Punkte.
 *
 * Die Aufgabe der Anzeige ist deshalb nicht, den Flachpass zu schlagen — sie
 * ist, über jeden Knopf die Wahrheit zu sagen. Genau daran ist sie zuletzt
 * gescheitert; siehe den nächsten Abschnitt.
 *
 * Und weil sie über den einzelnen Knopf keine ehrliche ZAHL sagen kann (die
 * Begründung steht bei P_GOOD/P_OK), sagt sie seit dieser Welle keine mehr:
 * die Passlinie zeigt GUT / MITTEL / RISKANT. Gemessen kommen dahinter
 * 82,7 / 65,4 / 37,1 % der Pässe an — drei sauber getrennte Stufen
 * (+17,2 ± 2,1 und +28,3 ± 2,1 Punkte Abstand, fünf Saatfamilien, Gruppe 4b).
 *
 * ---------------------------------------------------------------------------
 * REPARIERT: die Passlinie sortierte die vier Knöpfe falsch
 * ---------------------------------------------------------------------------
 * Die angezeigte Zahl war je Passart unterschiedlich gut kalibriert: der Chip
 * wurde zu pessimistisch angezeigt, und der Steilpass wurde gegenüber den
 * anderen drei Knöpfen zu weit vorn einsortiert.
 *
 * NACHTRAG DIESER WELLE: der Faktor des DOPPELPASSES war dabei falsch
 * eingestellt. Er stand auf 0,92 und verschlechterte die Kalibrierung
 * gegenüber dem unveränderten 1,00 messbar (6,47 ± 0,57 gegen 4,06 ± 0,59
 * Punkte, gepaart +2,41 ± 0,22 über sechs Saatfamilien) — also genau die
 * Kennzahl, die er laut Begründung minimieren sollte. Er steht jetzt auf 1,00.
 * Die vollständige Messung samt den drei anderen Knöpfen steht bei
 * `PASS_TYPES`.
 *
 * Gemessen (Gruppe 4c des Prüfstands, FÜNF Saatfamilien à 700 Abspiele je
 * Passart): GEWICHTETE MITTLERE Abweichung zwischen Anzeigeklasse und Ausgang,
 * über die besetzten Klassen mit n als Gewicht; Ziel wären höchstens 7 (halbe
 * Klassenbreite plus Messrauschen). Angegeben ist der gepoolte Wert, in
 * Klammern das Mittel über die Familien ± Standardfehler.
 *
 *   VORHER, nur auf der bequemen Anspielstation gemessen:
 *     flach 9,0 · steil 4,8 · chip 11,0 · doppelpass 3,2
 *   NACHHER, über BEIDE Empfängerwahlen gemessen (die Probe ist damit
 *   strenger geworden — sie enthält jetzt die Lagen, in denen die Anzeige
 *   zuletzt danebenlag) und mit der Kalibrierung je Knopf:
 *     flach 7,8 (7,9 ± 0,2) · steil 4,9 (6,0 ± 0,4) ·
 *     chip 13,0 (13,1 ± 1,4) · doppelpass 3,3 (3,9 ± 0,7)
 *
 * Der Steilpass war und bleibt gut kalibriert, der Chip ist der schlechte Fall,
 * und der Doppelpass ist mit dem korrigierten Faktor 1,00 (5,1 → 3,3) der
 * bestkalibrierte Knopf. Die beiden offenen Knöpfe sind damit dieselben wie
 * zuvor (flach und chip) — unter einem Lineal, das die halbe Szene mehr
 * abdeckt. Warum der Chip sich
 * nicht kalibrieren lässt, steht bei `PASS_TYPES`: seine Anzeige trägt oberhalb
 * von 50 % kaum noch Information.
 *
 * Die grösste Abweichung EINER Klasse ist ausdrücklich KEINE Kennzahl des
 * Modells, auch wenn hier lange eine stand: sie sucht sich die kleinste,
 * verrauschteste Anzeigeklasse und schwankt je Saatfamilie um bis zu 12 Punkte.
 * Die frühere Zeile „flach 11,9 · steil 11,9 · chip 20,2 · doppelpass 10,9" war
 * eine Aussage über eine Saatfolge, nicht über die Passlinie.
 *
 * Was das beim Spielen bedeutete, misst Gruppe 4d — an WIRKLICH gespielten
 * Pässen (jede Lage viermal wiederholt, je einmal pro Knopf), nicht über eine
 * aus der Anzeige zurückgerechnete Ersatzwirklichkeit. Verglichen wird GEPAART,
 * Lage für Lage, gegen den besten festen Knopf; angegeben ist der Vorsprung mit
 * seinem Standardfehler (fünf Saatfamilien, 1036 Lagen, 4144 gespielte Pässe).
 * VORHER — mit einem gemeinsamen Anzeigefaktor für alle vier Knöpfe:
 *
 *   • bequeme Anspielstation: 75,7 % gegen 76,4 % bei blind immer [F], gepaart
 *     −0,8 ± 1,2 Punkte — also nichts. 13,1 % falsch angeführte Knöpfe.
 *   • Empfänger reihum ([1]-[5]): 60,2 % gegen 70,6 %, gepaart −10,4 ± 1,5
 *     Punkte, 24,2 % falsch angeführt. Der Fehler sass fast ganz beim
 *     Steilpass: wo die Anzeige „steil vor flach" sagte (n = 209), kamen
 *     wirklich 17,2 % gegen 70,3 % an.
 *
 * NACHHER — mit der gemessenen Kalibrierung je Knopf (`PASS_TYPES[*].anzeige`,
 * dieselben Lagen, dieselben Seeds):
 *
 *   • bequeme Anspielstation: 79,4 % gegen 77,4 %, gepaart +2,0 ± 1,0 Punkte
 *     (die Zusicherung verlangt zwei Standardfehler, also 1,9) — der Vorsprung
 *     ist damit belegt, aber MIT SEHR WENIG LUFT. Wer an der Anzeige oder an
 *     der Ersatzregie dreht, misst diese Zahl nach; sie kippt, bevor irgendein
 *     anderer Korridor es tut. Falsch angeführte Knöpfe 13,1 → 10,3 %.
 *   • Empfänger reihum: 69,3 % gegen 69,9 %, gepaart −0,6 ± 1,1 Punkte. Die
 *     Anzeige ist hier nicht mehr messbar schlechter als blind [F]; ein
 *     Vorsprung ist es aber auch nicht. Falsch angeführt 24,2 → 15,5 %.
 *   • Der Schaden sass, wie die Diagnose vorhergesagt hat, ganz beim
 *     Steilpass: die Anzeige führt ihn jetzt in 2,1 statt 12,2 % (bequem) bzw.
 *     7,2 statt 24,8 % (reihum) der Lagen an.
 *
 * DAS BLEIBT OFFEN, und zwar begründet: bei freier Empfängerwahl kommt die
 * Anzeige über „nicht schlechter als blind [F]" nicht hinaus. Das ist kein
 * Modellfehler mehr, sondern der oben gemessene Spielraum — der Flachpass ist
 * in dieser Szene objektiv der beste Knopf, und kein beobachtbares Merkmal
 * findet die Lagen, in denen ein anderer es wäre.
 *
 * Was die Kalibrierung die ANDERE Entscheidung kostet, ist mitgemessen: nichts.
 * Die Empfängerwahl (Gruppe 4e) liegt bei 80,8 % angekommene Pässe. Das ist
 * kein Zufall, sondern der Grund, warum der Faktor je Passart und nicht je
 * Lage wirkt: bei fester Passart ist er eine gemeinsame Konstante über alle
 * Empfänger und kann ihre Reihenfolge nicht verändern. Eine frühere Fassung
 * mit dem Faktor 1,15 für den Flachpass kostete hier 0,9 Punkte, weil sie an
 * die Klemmung PASS_ANZ_MAX stiess und gute Empfänger ununterscheidbar machte.
 * HIER STAND „mit 1,06 bleibt die Anzeige unter der Decke" — der Flachpass
 * steht auf 1,14 und streift die Decke damit sehr wohl (0,86 · 1,14 = 0,9804).
 * Nachgemessen ist das folgenlos: geklemmt werden ausschliesslich die Pässe,
 * deren Geometrie ohnehin auf dem Anschlag geo = 1 sitzt und die auch ohne
 * Faktor nicht unterscheidbar wären (1306 von 3653). Die Einzelheiten stehen
 * bei `PASS_TYPES`.
 *
 * Zwei ältere Anläufe, das als PHYSIK zu heilen, sind gemessen und wieder
 * ausgebaut worden: die Flughöhe über der Kette als Zeitfrage statt als
 * Höhentest, und eine Vorlagenprüfung „kommt der Empfänger überhaupt bis zum
 * Zielpunkt". Beide machten einzelne Passarten besser und die Sortierung
 * schlechter (falsch angeführter Knopf 17,8 % → 27,4 %, altes Lineal).
 * Zwei weitere sind in dieser Welle gemessen und ebenfalls verworfen worden:
 * `margeFuer()` ganz auf den angespielten Mann zu beziehen (gepaarter
 * Vorsprung auf der bequemen Anspielstation −0,8 → −7,5 Punkte) und ein
 * eigener Zielanteil-Faktor daneben (−0,8 → −5,0). Beide ziehen den CHIP
 * künstlich hoch: seine Bahn fliegt, und über einem fliegenden Ball findet
 * `interceptZeit()` kaum einen Gegenspieler. Die Zeitmarge allein unterscheidet
 * die Passarten nicht — deshalb trägt jetzt eine gemessene Zahl je Passart die
 * Unterscheidung, und keine erfundene Physik.
 *
 * ---------------------------------------------------------------------------
 * DREI REPARATUREN AN DIESER FASSUNG
 * ---------------------------------------------------------------------------
 *   1. DOPPELPASS. Er zählt erst als angekommen, wenn AUCH der Rückpass sein
 *      Ziel findet — `passChance()` bewertete aber nur das erste Bein und log
 *      dadurch um bis zu 37 Punkte. Jetzt bewertet sie beide (`rueckChance()`),
 *      der Rückpass zielt in den LAUF des Passgebers (`rueckZiel()`), und der
 *      Passgeber läuft ihm nach, statt stur geradeaus weiterzusprinten.
 *   2. PASSQUOTE. `stat.paesseAn++` stand vor der Abseitsprüfung; ein Zuspiel,
 *      das mit dem Banner ABSEITS! als 'abgefangen' endet, ging als
 *      angekommener Pass in die Quote ein. Und ein Ball, den irgendein anderer
 *      Mitspieler aufsammelt, hat seinen Mann nicht gefunden — er zählt weder
 *      als Pass noch als Station (`passAngekommen(gezielt)`).
 *   3. DER BALL BLIEB NICHT IM BILD. 20 % der Szenen endeten mit „PASS
 *      VERSPRUNGEN!", 9 % mit „INS AUS!". Die Rollphysik ist daran unschuldig
 *      und bleibt unangetastet: ein Ball mit 15 m/s rollt auch bei ehrlichen
 *      0,72 m/s² über 150 m weit, und kein Bildausschnitt und keine Kamerafahrt
 *      hält ihn. Repariert wurde, was ihn wirklich hält — eine Abschussstärke,
 *      die zur Entfernung passt (`abschussTempo()`), und die Regel, dass der
 *      Ball dem gehört, der WIRKLICH an ihm ist, sobald die Vorhersage ihren
 *      Sieger nicht mehr trägt (`amBall()`).
 *
 * LEISTUNGSGRENZE (verbindlich, Umbauplan Punkt 6): `interceptZeit()` läuft
 * NICHT in jedem Teilschritt, sondern auf einem festen 60-Hz-Raster, nur
 * während der Passphase, mit höchstens INTER_PROBEN = 12 Zeitproben je Akteur.
 * Obergrenze damit 11 · 12 · 60 = 7920 Auswertungen je Sekunde.
 *
 * DETERMINISMUS: Die gesamte Simulation läuft auf einem festen Teilschritt
 * (PHYS_STEP = 1/120 s) mit Akkumulator. Alle Zufallszüge liegen auf diesem
 * Raster oder davor. Zwei Läufe mit gleichem Seed und unterschiedlichem
 * Frame-dt liefern deshalb identische Ergebnisse (tools/test-kombination.js).
 *
 * Steuerung:
 *   Maus / [1]-[5]   Mitspieler anwählen
 *   Klick            Pass spielen
 *   [Leertaste]      selbst abschließen  (outcome 'abgeschlossen')
 *   [ESC]            abbrechen -> null (Simulation übernimmt)
 *
 * Rückgabe: { outcome, quality, targetPlayerId, xgDelta } – siehe CONTRACTS 6.1.
 * `'abseits'` ist KEIN zulässiger Outcome — Abseits wird als `'abgefangen'`
 * mit eigenem Banner abgebildet (Vertrag §6.1 ist abschließend).
 */

import { clamp, lerp } from '../core/util.js';
import {
  G, laufwerte, sprintStrecke, sprintZeit, sprintSchritt, lenke, wendeKosten
} from '../core/ballistik.js';

/* ========================================================================== *
 *  BALANCING-KONSTANTEN
 * ========================================================================== */

const CANVAS_W = 960;
const CANVAS_H = 600;
const HARD_TIMEOUT_S = 20;

/** Zeitbudget: Grundzeit + Bonus je gelungener Station (in Sekunden). */
const SCENE_BASE_S = 9.0;
const SCENE_STATION_BONUS_S = 2.6;
const SCENE_MAX_S = 17.0;

/** Maximale Anzahl Stationen laut Aufgabenstellung. */
const MAX_STATIONS = 3;

/* --- Weltkoordinaten: fx 0..68 (quer), fy 0..35 (Meter vor dem Tor) ------- */
const FIELD_W = 68;
const FIELD_D = 35;
const PPM = 12.9;                       // Pixel pro Meter
const ORIGIN = { x: 41, y: 86 };
const GOAL_CENTER = { fx: 34, fy: 0 };
const RAND_X0 = 2, RAND_X1 = FIELD_W - 2;
const RAND_Y0 = 1.5, RAND_Y1 = FIELD_D - 1;

/* --- Zeitraster ----------------------------------------------------------- */
/** Fester Teilschritt der Simulation. dt ist auf 0,05 s geklemmt → max. 6 Schritte/Frame. */
const PHYS_STEP = 1 / 120;
/** interceptZeit() läuft auf jedem zweiten Teilschritt = 60 Hz (Leistungsgrenze). */
const RASTER_JEDER = 2;
/** Höchstens so viele Zeitproben je Akteur und Auswertung (Leistungsgrenze). */
const INTER_PROBEN = 12;
/** Die optionale Regie (Prüfstand) wird nur alle 24 Teilschritte gefragt = 5 Hz. */
const REGIE_JEDER = 24;
/** Sicherheits-Timeout eines Passes; die Bahn wird nie länger gerechnet. */
const BAHN_TMAX = 3.0;
const BAHN_N = Math.round(BAHN_TMAX / PHYS_STEP) + 2;

/* --- Ball ----------------------------------------------------------------- */
const ROLL_A = 0.72;                    // m/s² Rollreibung auf kurzem Rasen
const PRALL_Z = 0.5;                    // vertikale Restitution beim Aufsetzer
const PRALL_H = 0.72;                   // horizontaler Verlust beim Aufsetzer
const BALL_HAFT_VZ = 0.35;              // darunter bleibt der Ball nach dem Prall liegen
const CHIP_VZ_MAX = 8.0;                // m/s: Scheitel des Chips bleibt unter ~3,3 m
const BALL_STILL = 0.25;                // m/s: darunter gilt der Ball als ausgerollt
const BALL_NACHFRIST_S = 0.9;           // s, in denen ein liegender Ball noch erlaufen wird

/* --- Abfangen ------------------------------------------------------------- */
const PLAY_REACH = 0.95;                // m Spielreichweite (Fuß/Kopf am Ball)
const REACT_MIN = 0.16;                 // s bei positionsspiel/uebersicht = 99
const REACT_MAX = 0.34;                 // s bei 0
const Z_LAUF = 0.55;                    // m: so hoch nimmt ein laufender Spieler mit
const Z_SPRUNG_BASIS = 2.05;            // m Kopfballhöhe …
const Z_SPRUNG_SPANNE = 0.55;           // … plus Sprungkraft
const Z_SPRUNG_VORLAUF = 0.35;          // s, die er zum Stellen braucht
const DUELL_FENSTER = 0.15;             // s: so nah beieinander = Zweikampf statt Annahme
/**
 * So lange nach dem Abspiel ist der Abgeber für die Ballannahme gesperrt —
 * sonst nähme er seinen eigenen Pass im ersten Teilschritt wieder an.
 */
const KONTAKT_SPERRE_S = 0.30;
/**
 * Strafe je Meter, den ein Akteur am Ball vorbeiläuft. Wer die Bahn nicht
 * schneiden kann, ist damit nicht aus dem Spiel — er setzt nach, und wer
 * dichter drankommt, hat den besseren Zugriff. Grössenordnung: ein Meter
 * Fehlbetrag kostet gut ein Drittel einer Sekunde. Nachsetzen lohnt sich also,
 * ist aber deutlich schlechter als abfangen.
 */
const NAH_STRAFE = 0.35;

/* --- Passmodell (Ausführung, nicht Ausgang) ------------------------------- */
/**
 * Winkelfehler des Abspiels bei Können 0, in Radiant (Umbauplan Punkt 4).
 *
 * Der Wert stand zwischenzeitlich auf 0,11 rad, mit der Begründung, sonst liege
 * die Passquote über dem Korridor. Diese Begründung ist nachgemessen falsch:
 * mit 0,085 liegt die Passquote bei 69,90 % ± 1,14 und damit im Korridor
 * 58–72 %, und die Kennzahl, um die es beim Befund „Ball verlässt das Bild"
 * ging, ist mit 8,07 % ± 1,09 deutlich besser als die 11,07 % bei 0,11. Die
 * Anhebung kostete rund drei Punkte auf genau der Grösse, die sie verbessern
 * sollte, und machte jeden Pass jedes Spielers ungenauer.
 *
 * Was hier NICHT mehr steht, weil es nur für eine Saatfolge galt: „mit 0,085
 * liegen ALLE VIER Korridore im Soll … Abseits 7,73 %". Über zwölf
 * Saatfamilien à 1000 Szenen (Gruppe 4 des Prüfstands) liegt Abseits bei
 * 7,90 % ± 0,84 — der Mittelwert hält die obere Grenze von 8 % gerade eben,
 * sein Fehlerband nicht mehr, und 5 der 12 Saatfolgen liegen darüber (Spanne
 * 6,70 … 9,40 %). Es ist keine Frage von AIM_SIGMA — aber, und das ist der
 * korrigierte Teil, auch KEINE der Abseitskonstanten dieser Datei.
 *
 * Hier stand: „die Grösse hängt an TIEFENLAUF_ANTEIL und ABSEITS_MERKEN_S".
 * Das ist nachgemessen falsch. Sechzehn Einstellungen über neun Konstanten —
 * TIEFENLAUF_ANTEIL (0,26/0,20/0,16), ABSEITS_MERKEN_S (0,35 … 0,05),
 * ABSEITS_VORLAUF (0,8 … 0,0), ABSEITS_FREILAUF (0,9 … 1,6),
 * ABSEITS_RUECKWEG, DEF_GOALSIDE (0,4 … 0,8), DEF_BALL_BIAS, KETTE_VOR, dazu
 * ein Tiefenlaufziel und eine harte Linienklemme auf den Freilaufwegen —
 * halten die Quote sämtlich zwischen 6,98 und 8,79 % (je 6 Saatfamilien à
 * 800 Szenen, Kontrolle 7,35 %). Mehrere der „Verbesserungen" machen sie
 * schlechter. Der Grund ist eine Rückkopplung: die Abseitslinie IST die
 * Abwehrkette, und die Kette stellt sich `DEF_GOALSIDE · 4` m torseitig ihres
 * Gegenspielers auf. Jede Konstante, die einen Abstand ZUR LINIE beschreibt,
 * verschiebt damit auch die Linie — das System pendelt sich auf denselben
 * Abstand wieder ein.
 *
 * Woran die Quote wirklich hängt, steht in tools/test-kombination.js: an
 * REGIE_LINIE_TOL, der Toleranz der ERSATZREGIE (0,7 m → 7,35 % · 0,5 m →
 * 5,63 % · 0,3 m → 3,29 % · 0,0 m → exakt 0,00 %). Jedes einzelne gemessene
 * Abseits ist ein Pass, den der Ersatzmanager auf einen Mann spielt, der
 * sichtbar davorsteht — die Szene selbst erzeugt keines. Das ist eine Aussage
 * über den Prüfstand, nicht über das Minispiel; die Entscheidung, wie
 * unaufmerksam ein Mensch vor einer gezeichneten, bei Abseits GELB werdenden
 * Linie sein darf, gehört nicht in eine Balancekonstante dieser Datei.
 * Die anderen drei Korridore halten mit Abstand (Abschluss 49,20 % ± 1,31,
 * Zweikampf 13,72 % ± 1,35).
 *
 * Bei Können 99 bleiben 0,085 · (1 − AIM_SKILL_W) = 0,013 rad = 0,7° Winkel-
 * fehler übrig — das ist sehr genau. Die Antwort darauf wäre eine KÖNNENS-
 * ABHÄNGIGE Streuung (AIM_SKILL_W kleiner), nicht eine pauschale Anhebung.
 */
const AIM_SIGMA = 0.085;
const AIM_SKILL_W = 0.85;
const AIM_PRESSURE_W = 0.40;            // Zuschlag bei maximalem Gegnerdruck
const V0_SIGMA = 0.10;                  // relative Streuung der Abschussstärke
const V0_SKILL_W = 0.60;
/**
 * Vorhalt auf die Laufrichtung des Empfängers, in Vielfachen der geschätzten
 * Flugzeit `d/v0`. Man spielt in den Lauf, nicht auf den Standort.
 *
 * Solange der flache Pass fälschlich auf 0,11 m abhob, dreimal aufsetzte und
 * dabei zwei Drittel seines Tempos verlor, war ein Vorhalt schädlich: der Ball
 * blieb ohnehin nach gut 20 m liegen, und der Empfänger hatte drei Sekunden
 * Zeit, ihn abzuholen. Seit der Ball ehrlich rollt, kommt er nach 0,9 s an —
 * ohne Vorhalt ist der Empfänger dann fünf Meter weiter. Gemessen über
 * 3000 Szenen: ohne Vorhalt 24,9 % Passquote, mit Vorhalt 70,7 %.
 *
 * Der Zuschlag über 1,0 fängt auf, dass `d/v0` die Flugzeit unterschätzt (der
 * Vorhaltepunkt liegt weiter weg als der Empfänger, und der Ball wird durch
 * ROLL_A langsamer).
 */
const VORHALT_W = 1.08;

/**
 * Ausführungsfaktor der Anzeige.
 *
 * `passChance()` rechnet reine Geometrie: wer kann die Bahn zuerst schneiden.
 * Zwischen „kann schneiden" und „hat den Ball" liegt aber der wirkliche
 * Laufweg — mit Wendebogen, Anlauf und einem Ball, der mit 15–20 m/s durch die
 * Spielreichweite von 0,95 m läuft. Dieser Unterschied ist seit dem Streichen
 * des Teleports SICHTBAR, denn niemand wird mehr an den Ball gezogen.
 *
 * Der GEMEINSAME Anteil aller vier Knöpfe. Er ist an der Kalibrierprobe des
 * Prüfstands eingestellt (Gruppe 4c, heute 14 000 Abspiele — 3500 je Passart
 * aus fünf Saatfamilien, Passart fest vorgegeben) und hebt die reine Geometrie
 * auf den gemessenen Ausgang.
 *
 * WIDERSPRUCH ZUR FRÜHEREN FASSUNG, ausdrücklich benannt: hier stand „EIN
 * Faktor für alle vier Knöpfe — ausdrücklich KEIN Korrekturfaktor je Passart",
 * mit dem richtigen Argument, dass ein gemeinsamer Faktor eine Schieflage
 * ZWISCHEN den Passarten nicht beheben kann. Genau diese Schieflage war
 * gemessen das ganze Problem: wo die Anzeige den Steilpass anführte, kam er in
 * 44,4 % (bequeme Anspielstation) bzw. 21,5 % (Empfänger reihum) der Lagen an,
 * während der Flachpass in DENSELBEN Lagen 71,4 bzw. 71,1 % lieferte. Der
 * Verzicht auf einen Faktor je Passart war damit kein Verzicht auf eine
 * Krücke, sondern der Grund, warum die Passlinie die Knöpfe falsch sortierte.
 * Er ist deshalb aufgegeben: `PASS_TYPES[*].anzeige` trägt die Passart, dieser
 * Faktor den Rest. Die Begründung und alle Zahlen stehen bei `PASS_TYPES`.
 *
 * Es wurde geprüft, ob sich dieser Faktor durch eine gerechnete Grösse ersetzen
 * lässt — Trefferfenster `2 · PLAY_REACH / v` gegen einen mit dem Laufweg
 * wachsenden Zeitfehler. Das ist physikalisch die richtige Beschreibung, hat
 * die Kalibrierung aber NICHT verbessert (die Anpassung zog den Einfluss des
 * Laufwegs gegen null), und wurde deshalb wieder ausgebaut statt als schöner
 * Zusatz stehen zu bleiben.
 */
const AUSFUEHRUNG = 0.86;

/**
 * Klemmung der Anzeige. Die Kurve selbst braucht keine Parameter mehr: sie
 * ergibt sich aus derselben Zeitmarge und demselben Duellfenster, mit denen
 * `entscheideBall()` den Ball vergibt. Gemessen über alle Passarten gemittelt
 * (tools/test-kombination.js, Gruppe 4b — 2705 Abspiele aus FÜNF Saatfamilien
 * à 620 Szenen; bis zuletzt lief ausgerechnet diese Gruppe über EINE
 * Saatfolge): Anzeige 15 % → 27,6 % Ausgang, 25 % → 28,6 %, 35 % → 48,7 %,
 * 45 % → 50,9 %, 55 % → 69,2 %, 65 % → 65,0 %, 75 % → 62,5 %, 95 % → 91,9 %.
 * Grösste Abweichung je Saatfamilie 20,7 ± 2,6 Punkte; die Zahl ist ein
 * Maximum über acht Klassen und schwankt entsprechend stark. Die gewichtete
 * mittlere Abweichung, die weniger laut ist, liegt bei 7,8 ± 0,5 Punkten.
 */
const PASS_ANZ_MIN = 0.02;
const PASS_ANZ_MAX = 0.98;

/**
 * Antwortkurve der Anzeige: von der Zeitmarge auf die Wahrscheinlichkeit.
 *
 * Die Kurve ist bewusst flach (−0,35 … +0,55 s statt einer knappen
 * Viertelsekunde um DUELL_FENSTER). Sie MUSS flach sein, solange `margeFuer()`
 * das Minimum über alle eigenen Spieler nimmt: die Marge ist dann in den oberen
 * Klassen gesättigt (gemessener Mittelwert 2,2–3,0 s) und trüge mit einer
 * steilen Kurve überhaupt keine Information mehr.
 *
 * Gemessen (tools/test-kombination.js, Gruppe 4c, fünf Saatfamilien à 700
 * Abspiele je Passart): gewichtete mittlere Abweichung zwischen Anzeigeklasse
 * und Ausgang — flach 7,8 · steil 4,9 · chip 13,0 · doppelpass 3,3 Punkte.
 * Der Chip ist der schlechte Fall, nicht der Steilpass; das war unter der
 * früheren Maximum-Statistik (flach 11,9 · steil 11,9 · chip 20,2 ·
 * doppelpass 10,9, eine Saatfolge) nicht zu erkennen — dort trug die kleinste
 * Klasse die Zahl.
 *
 * Ein erschöpfender Sweep über ANZ_MARGE_LO/HI, ANZ_BODEN und AUSFUEHRUNG kam
 * über alle vier Passarten bestenfalls auf 11,3 Punkte GRÖSSTE Abweichung, und
 * das nur mit einer fast senkrechten Kurve, die die Anzeige auf fünf Klassen
 * zusammenzieht. Diese Sweep-Zahl ist am alten Lineal (Maximum, eine
 * Saatfolge) erhoben und mit den vier Zahlen darüber nicht vergleichbar — wer
 * den Sweep wiederholt, misst ihn am gewichteten Mittel neu. Die Aussage bleibt
 * unberührt: die Zeitmarge allein reicht nicht aus, um die Passarten zu
 * unterscheiden — siehe „DAS BLEIBT OFFEN" im Dateikopf.
 *
 * ANZ_BODEN ist die ehrliche Untergrenze — auch ein Ball, den nach dem Modell
 * jemand anderes zuerst erreicht, kommt oft doch an, weil niemand den Weg so
 * läuft, wie ihn das idealisierte Sprintmodell rechnet. Er darf REGIE_P_NOT
 * (0,16) nicht überschreiten, sonst spielt die Ersatzregie des Prüfstands jeden
 * Pass und der Korridor „Abschluss 45–60 %" bricht.
 */
const ANZ_MARGE_LO = -0.35;
const ANZ_MARGE_HI = 0.55;
const ANZ_BODEN = 0.15;
/**
 * Kopplung der beiden Beine des Doppelpasses.
 *
 * Ein reines Produkt `p1 · p2` behandelt Hin- und Rückpass als unabhängige
 * Ereignisse. Sie sind es nicht: beide laufen durch DIESELBE Lücke, gegen
 * DIESELBEN Verteidiger, in derselben Sekunde. Wer die Wand findet, findet
 * meistens auch den Rückpass. Ungekoppelt zeigte die Anzeige im Bereich
 * 20–30 % einen Wert, hinter dem tatsächlich 44 % standen.
 */
const RUECK_KOPPLUNG = 0.35;

/**
 * Die drei Stufen der Passlinie — und warum dort keine Prozentzahl mehr steht.
 *
 * Bis zu dieser Welle schrieb die Passlinie `Math.round(p · 100) + ' %'` an den
 * Ball. Diese Zahl ist gemessen NICHT haltbar, und zwar aus einem Grund, der
 * sich nicht wegkalibrieren lässt: derselbe Modellwert bedeutet je nach Lage
 * etwas anderes. Beim Steilpass kommen bei gleichem Anzeigewert auf der
 * bequemen Anspielstation 57,2 % an, bei freier Empfängerwahl 27,8 %. Und über
 * alle Passarten gemittelt versprach die Anzeige zuletzt in der Klasse 30–40 %
 * einen Wert, hinter dem 51,1 % standen (Prüfstand, Gruppe 4b) — eine
 * systematische Untertreibung von 16 Punkten, die ein erschöpfender Sweep über
 * ANZ_MARGE_LO/HI, ANZ_BODEN und AUSFUEHRUNG nicht beseitigt hat.
 *
 * Eine Zahl, die 35 % verspricht und 51 % liefert, ist schädlicher als eine
 * Angabe, die nichts verspricht, was sie nicht halten kann. Die Passlinie sagt
 * deshalb nur noch, was sie belegen kann: eine REIHENFOLGE. Die drei Stufen
 * sind an denselben Schwellen aufgehängt, die schon immer die Farbe bestimmt
 * haben — Text und Farbe sind jetzt EINE Aussage statt zweier.
 *
 * Was die Stufen halten, misst der Prüfstand (Gruppe 4b) und zwar als das,
 * was sie behaupten: GUT muss messbar mehr liefern als MITTEL, MITTEL mehr als
 * RISKANT. Gemessen liegen sie bei rund 85 / 63 / 38 % angekommener Pässe.
 * Der interne Wert `p` bleibt unverändert und voll aufgelöst — die Kalibrier-
 * proben rechnen weiter mit ihm, und die Ersatzregie des Prüfstands auch.
 */
const P_GOOD = 0.72;
const P_OK = 0.48;
const STUFE_GUT = 'GUT';
const STUFE_MITTEL = 'MITTEL';
const STUFE_RISKANT = 'RISKANT';
/** Stufe einer Anzeigewahrscheinlichkeit. Rein, DOM-frei, auch für den Prüfstand. */
function passStufe(p) {
  return p >= P_GOOD ? STUFE_GUT : p >= P_OK ? STUFE_MITTEL : STUFE_RISKANT;
}

/* --- Laufverhalten -------------------------------------------------------- */
const DEF_GOALSIDE = 0.40;              // Gegner stellen sich torseitig
const DEF_BALL_BIAS = 0.18;             // Anteil, um den sie zum Ball einrücken
const DEF_VORHALT_S = 0.35;             // s Vorhalt des Pressers auf den Ballführenden
const DEF_BREMS_R = 5.0;                // m: ab hier bremst der Presser …
const DEF_BREMS_CAP = 0.55;             // … auf diesen Anteil seines Tempos
const MARK_REPICK_S = 1.0;              // s: Manndeckung neu zuordnen
/**
 * Die Abwehrkette. Sie orientiert sich am BALL, nicht am jeweiligen Gegenspieler:
 * kein Verteidiger lässt sich tiefer fallen als die Kette. Erst dadurch gibt es
 * überhaupt eine Abseitslinie, die HÄLT — eine reine Manndeckung folgt jedem
 * Tiefenlauf und kennt kein Abseits.
 */
const KETTE_VOR = 5.0;                  // m, die die Kette vor dem Ball steht
const KETTE_MIN = 5.5;
const KETTE_MAX = 24;
const RUN_REPICK_S = 2.2;               // Intervall für neue Freilaufwege
const SUPPORT_DIST = 14;                // m: Wunschabstand zum Ballführenden
const CARRY_SPEED = 2.2;                // m/s, mit denen der Ballführende andribbelt
const CARRY_MIN_FY = 16;                // so weit kommt er allein – danach ist zu
const CARRY_SCHIRM_R = 3.5;             // m: ab hier dreht er vom Druck weg
const DUELL_R = 1.1;                    // m: so nah ist ein Zweikampf
const DUELL_LOESE_R = 2.4;              // m: erst hier gilt der Zweikampf als überstanden
/**
 * Grundchance des Ballführenden im Zweikampf. Ein Verteidiger, der herankommt,
 * gewinnt den Ball NICHT automatisch — er zwingt zur Entscheidung. Der Wert ist
 * am Zielkorridor „Ballverlust im Zweikampf 8–15 % der Szenen" kalibriert.
 *
 * Er stand bei 0,95, und das ging nur auf, solange der flache Pass nach gut
 * 20 m liegen blieb: der Korridor wurde damals überwiegend aus RENNEN UM DEN
 * LIEGENDEN BALL gefüllt, nicht aus Zweikämpfen am Ballführenden. Mit einem
 * Ball, der ehrlich durchrollt, gibt es im 68 × 35 m großen Szenenausschnitt
 * keine liegenden Bälle mehr — er verlässt den Ausschnitt. Gemessen fiel der
 * Korridor damit von 11,6 % auf 2,6 %. Übrig bleibt die einzige ehrliche
 * Quelle: der angegriffene Ballführende. 0,95 war dafür ohnehin absurd
 * großzügig — reale Bodenzweikämpfe gehen etwa 50:50 aus. Mit DUELL_SPREIZUNG
 * und der Klemmung auf 0,25…0,96 liegt ein guter Dribbler weiterhin über 50 %.
 */
const DUELL_CARRY_BASIS = 0.44;
/**
 * Beim losen Ball entscheidet, wer eher da ist und wer der bessere Zweikämpfer
 * ist. `DUELL_ZEIT_W` gewichtet den Zeitvorsprung innerhalb des Duellfensters:
 * Wer 0,15 s früher am Ball ist, gewinnt ihn meistens; wer gleichzeitig kommt,
 * spielt 50:50 gegen den Zweikampfwert.
 */
const DUELL_BALL_BASIS = 0.50;
const DUELL_SPREIZUNG = 0.42;
const DUELL_ZEIT_W = 0.45;
const CAP_NAH = 0.42;                   // Tempo-Regime: Wegpunkt < 4 m
const CAP_NAH_R = 4.0;
const CAP_WEIT_R = 12.0;                // Wegpunkt > 12 m → Vollgas
const CAP_MITTE = 0.75;

/**
 * Vorlage in den Lauf. Früher 7,5 m — das ging nur, weil der Empfänger auf den
 * Zielpunkt TELEPORTIERT wurde (Umbauplan Punkt 8 streicht den Teleport
 * ausdrücklich). Wer die Strecke wirklich laufen muss, kommt bei 7,5 m nie an;
 * 4,5 m ist die Vorlage, die ein antrittsschneller Stürmer erreicht.
 */
const STEIL_LEAD = 4.5;
const DOPPEL_RUN = 8.5;                 // m, die der Passgeber beim Doppelpass zieht
/**
 * Dämpfung der Vorausschau auf das zweite Bein des Doppelpasses. Über eine
 * Flugzeit von rund einer Sekunde hält niemand Richtung und Tempo exakt durch;
 * eine ungedämpfte Fortschreibung liesse jeden Verteidiger geradeaus aus dem
 * Bild laufen und würde die Anzeige des Rückpasses systematisch schönen.
 */
const PROG_DAEMPF = 0.75;

/* --- Abseits -------------------------------------------------------------- */
const ABSEITS_SICHER = 0.5;             // m, die ein Tiefenlauf vor der Linie halten soll
const ABSEITS_VORLAUF = 0.8;            // m Nachlässigkeit bei positionsspiel = 0
/** Freilaufwege halten mehr Abstand als ein Tiefenlauf — niemand klebt sekundenlang an der Linie. */
const ABSEITS_FREILAUF = 0.9;
/** Wer doch dahinter steht, geht aktiv zurück (bis auf die Nachlässigkeit `vorlauf`). */
const ABSEITS_RUECKWEG = 0.7;
/**
 * Anteil der Freilaufwege, die echte Tiefenläufe AN die Linie sind. Ohne sie
 * bliebe jeder Angreifer brav zwei Meter davor stehen und die Szene kennte kein
 * Abseits mehr — ein Stürmer, der nie zu früh startet, ist keiner.
 */
const TIEFENLAUF_ANTEIL = 0.26;
/**
 * Wie lange ein Angreifer braucht, bis er merkt, dass er im Abseits steht, und
 * zurückgeht. Ohne diesen Nachlauf korrigiert die Mannschaft sich in demselben
 * Teilschritt, in dem die Kette aufrückt — Abseits käme praktisch nie vor
 * (gemessen 1,2 % gegen den Zielkorridor 3–8 %).
 */
const ABSEITS_MERKEN_S = 0.35;

/* --- Torwart -------------------------------------------------------------- */
const TW_V_BASIS = 5.4;                 // m/s · (0,85 + 0,3·stellungsspiel/99)
const TW_MARGE_S = 0.25;                // s Marge, ab der er herausläuft
const TW_AUSLAUF_MIN = 1.8;             // m vor der Linie
const TW_AUSLAUF_MAX = 5.5;

/* --- Bewertung ------------------------------------------------------------ */
const XG_MIN = -0.10;
const XG_MAX = 0.40;
const DANGER_XG_W = 0.46;
const STATION_XG_BONUS = 0.04;

/**
 * Abschussstärke über null Meter und Distanz, ab der voll gespielt wird.
 *
 * `v0a + v0b·können` (Umbauplan Punkt 5) ist die Stärke für ein Zuspiel über
 * D_VOLL Meter, NICHT für jeden Pass: ein Ball über zwölf Meter wird real
 * nicht mit 21 m/s getreten. Solange die Stärke distanzunabhängig war, lief
 * jeder kurze Pass seinem Empfänger davon — der Ball war nach 0,6 s am Ziel,
 * der Empfänger nach 1,1 s, und danach rollte er weiter aus dem 68 × 35 m
 * grossen Ausschnitt heraus.
 *
 * Die Rollphysik bleibt unangetastet; sie ist nicht das Problem. Ein Ball mit
 * 15 m/s rollt auch bei ehrlicher Reibung von 0,72 m/s² über 150 m weit — kein
 * Bildausschnitt der Welt hält ihn, und eine mitziehende Kamera würde nur
 * zeigen, wie er wegrollt. Was ihn hält, ist ein Empfänger, der ihn erreichen
 * KANN, und dafür muss der Pass zur Entfernung passen.
 */
const V0_KURZ = 9.0;
const D_VOLL = 20.0;

/**
 * Passarten. `v0a/v0b` = Abschussgeschwindigkeit `v0a + v0b·können` in m/s
 * über D_VOLL Meter. `hoch` schickt den Ball auf eine Parabel über die Kette.
 *
 * `anzeige` ist die GEMESSENE Kalibrierung der Passlinie je Knopf — der einzige
 * Wert dieser Datei, der die Passart in die ANZEIGE trägt.
 *
 * HIER STAND EINE REGEL, DIE NICHT STIMMTE: „Jeder Faktor minimiert die
 * Kalibrierung SEINES EIGENEN KNOPFES." Für den Doppelpass war sie schlicht
 * falsch, und niemand hatte es nachgerechnet. Nachgemessen ist sie jetzt mit
 * genau dem Lineal, das sie behauptet — Gruppe 4c: gewichtete mittlere
 * Abweichung zwischen Anzeigeklasse und tatsächlichem Ausgang, über die
 * besetzten Klassen mit n als Gewicht — über SECHS unabhängige Saatfamilien à
 * 700 Abspiele je Passart (rund 3650 wirklich gespielte Pässe je Knopf, über
 * BEIDE Empfängerwahlen, damit die Eichung nicht auf der bequemen Hälfte des
 * Spiels sitzt). Angegeben ist das Mittel über die Familien ± Standardfehler:
 *
 *   Knopf         heute              bei 1,00        gemessenes Minimum
 *   flach        1,14 →  7,97 ± 0,17  12,69 ± 0,60   1,38 →  5,10 ± 0,47
 *   steil        0,70 →  6,23 ± 0,41  19,17 ± 1,02   0,68 →  3,38 ± 0,44
 *   chip         0,92 → 12,99 ± 1,18  14,03 ± 0,66   0,92 (flach, 0,90 … 1,04)
 *   doppelpass   1,00 →  4,06 ± 0,59        —        1,04 … 1,08 → 3,50 ± 0,57
 *
 * (Diese Nachmessung lief über sechs Familien, der Prüfstand selbst läuft aus
 * Rechenzeitgründen über fünf und meldet deshalb leicht andere Zahlen —
 * flach 7,9 ± 0,2 · steil 6,0 ± 0,4 · chip 13,1 ± 1,4 · doppelpass 3,9 ± 0,7.
 * Die Rangfolge und jede Aussage unten sind in beiden Sätzen dieselbe.)
 *
 * DER DOPPELPASS STAND AUF 0,92 UND WAR DAMIT SCHLECHTER ALS GANZ OHNE
 * KALIBRIERUNG: 6,47 ± 0,57 gegen 4,06 ± 0,59 Punkte, GEPAART je Saatfamilie
 * +2,41 ± 0,22. Der Faktor verschlechterte also genau die Kennzahl, die er
 * laut seiner eigenen Begründung minimieren sollte. Er steht deshalb auf 1,00.
 *
 * WARUM 1,00 UND NICHT 1,08. Das gemessene Minimum ist flach und liegt
 * zwischen 1,00 und 1,08; gepaart je Saatfamilie gegen 1,00 gerechnet:
 * 1,02 → +0,06 ± 0,16 · 1,04 → −0,46 ± 0,36 · 1,06 → −0,47 ± 0,40 ·
 * 1,08 → −0,56 ± 0,41. Kein Wert dieses Bereichs schlägt 1,00 um mehr als sein
 * eigenes Fehlerband. Ein Faktor, dessen Nutzen kleiner ist als sein Messfehler,
 * ist keine Kalibrierung, sondern eine Zahl — und 1,00 ist die ehrliche Form
 * von „an diesem Knopf ist nichts zu kalibrieren". Ausserhalb des flachen
 * Bereichs wird es sofort wieder messbar schlechter (0,92 → +2,41 ± 0,22 ·
 * 1,10 → +1,15 ± 0,52).
 *
 * DIE ANDEREN DREI, mit demselben Lineal nachgeprüft. Zwei liegen ebenfalls
 * NICHT auf ihrem Minimum — die Regel oben war also auch für sie zu grob —,
 * aber keiner von ihnen ist schlechter als 1,00, und darin liegt der ganze
 * Unterschied zum Doppelpass:
 *
 *   • FLACH 1,14 ist nicht das Minimum: 1,38 holt gepaart 2,87 ± 0,41 Punkte
 *     mehr heraus, das ist belegt. Der Grund für 1,14 ist eine Abwägung gegen
 *     die EMPFÄNGERWAHL (Gruppe 4e) und steht so seit der letzten Welle:
 *     ein höherer Faktor drückt die Anzeige gegen PASS_ANZ_MAX, und eine
 *     geklemmte Anzeige macht zwei gute Empfänger ununterscheidbar. Diese
 *     Abwägung ist hier NICHT nachgemessen worden; nachgemessen ist nur, dass
 *     1,14 die Klemmung bereits streift (0,86 · 1,14 = 0,9804) — folgenlos,
 *     denn betroffen sind ausschliesslich die 1306 von 3653 Flachpässen, deren
 *     Geometrie ohnehin auf dem Anschlag geo = 1 sitzt und die auch bei 1,00
 *     nicht unterscheidbar wären. Bei 1,38 läge die Klemmschwelle dagegen bei
 *     geo ≈ 0,83 und träfe die halbe Verteilung.
 *   • STEIL 0,70 ist knapp nicht das Minimum: 0,68 holt gepaart 2,85 ± 0,57
 *     Punkte. Der Sprung zwischen 0,68 und 0,70 ist ein Artefakt des Lineals —
 *     bei 0,70 rutscht eine weitere Klasse über KLASSE_MIN und wird gewertet.
 *     Gegenüber 1,00 holt der Faktor 12,93 ± 1,04 Punkte; er trägt also klar.
 *   • CHIP 0,92 ist das Minimum, aber ein flaches: gegenüber 1,00 sind es nur
 *     −1,05 ± 1,11 Punkte, also NICHT belegt. Der Grund steht seit der letzten
 *     Welle und gilt unverändert: die Chip-Anzeige trägt oberhalb von 50 % kaum
 *     noch Information — dort kommen 76 bis 83 % an, fast unabhängig vom
 *     angezeigten Wert. Ein Faktor verschiebt diese flache Kurve nur; er macht
 *     sie nicht steiler. Das bleibt offen (Gruppe 4c) und ist ehrlich als
 *     solches ausgewiesen.
 *
 * WARUM ES DIESEN WERT ÜBERHAUPT GIBT. Die Zeitmarge, aus der die Anzeige
 * rechnet, kennt die Passart nicht: sie fragt „wer ist zuerst an der Bahn".
 * Der Ausgang, den die Szene zählt, hängt aber sehr wohl an ihr — der
 * Steilpass schickt den Ball STEIL_LEAD Meter in einen Raum, den der Empfänger
 * erst noch laufen muss. Zwei Versuche, das als Physik zu heilen (Marge auf den
 * angespielten Mann; ein eigener Zielanteil-Faktor), sind gemessen und wieder
 * ausgebaut worden — sie machen die Sortierung SCHLECHTER, weil sie den Chip
 * künstlich hochziehen: seine Bahn fliegt, und über einen fliegenden Ball
 * findet das Modell kaum Gegenspieler (gemessen: gepaarter Vorsprung auf der
 * bequemen Anspielstation −0,8 → −5,0 bzw. −7,5 Punkte). Die ehrliche Antwort
 * ist deshalb keine erfundene Physik, sondern eine gemessene Kalibrierung.
 *
 * DER STEILPASS BLEIBT DER UNEHRLICHE REST, und zwar unvermeidlich: derselbe
 * Anzeigewert bedeutet bei ihm auf der bequemen Anspielstation 57,2 % und bei
 * freier Empfängerwahl 27,8 %. EINE Zahl kann nicht beides sein. 0,70 ist der
 * gemeinsame Kompromiss; er zeigt den Steilpass in der bequemen Lage eher zu
 * pessimistisch und bei freier Wahl noch eher zu optimistisch. Wer ihn allein
 * auf Sortierung stellt (0,4 statt 0,70), holt gemessen 0,4 Punkte heraus und
 * macht die Anzeige dafür in der halben Szene um 28 Punkte falsch — das ist
 * kein Handel, den diese Datei eingeht.
 *
 * DASS EINE ZAHL NICHT BEIDES SEIN KANN, ist der eigentliche Befund dieser
 * Welle und der Grund, warum der nächste Schritt keine weitere Kalibrierung
 * sein sollte, sondern WENIGER GENAUIGKEIT: eine dreistufige Angabe
 * (gut / mittel / riskant) verspricht keine Zahl, die sie nicht halten kann,
 * und trägt genau die Aussage, die das Modell belegen kann — eine Reihenfolge.
 * Das ist ein Eingriff in die Darstellung und keine Messfrage; er steht
 * bewusst offen.
 */
const PASS_TYPES = {
  flach: {
    key: 'F', name: 'Flachpass', desc: 'passschnell, abfangbar',
    v0a: 13, v0b: 8, lead: 0, hoch: false, reward: 1.00, streuung: 1.00,
    anzeige: 1.14
  },
  steil: {
    key: 'S', name: 'Steilpass', desc: 'in die Tiefe – riskant',
    v0a: 15, v0b: 8, lead: STEIL_LEAD, hoch: false, reward: 1.45, streuung: 1.25,
    anzeige: 0.70
  },
  chip: {
    key: 'C', name: 'Chip', desc: 'über die Kette',
    v0a: 10, v0b: 4, lead: 2.0, hoch: true, reward: 1.20, streuung: 1.10,
    anzeige: 0.92
  },
  doppelpass: {
    key: 'D', name: 'Doppelpass', desc: 'Wand + Rückpass, nur kurz',
    v0a: 12, v0b: 6, lead: 0, hoch: false, reward: 1.35, streuung: 0.90,
    /* 1,00 heisst hier NICHT „noch nicht kalibriert", sondern das Ergebnis der
       Messung: der Doppelpass braucht keinen Faktor, und jeder andere Wert war
       gemessen schlechter. Begründung und Zahlen im Kopf dieses Blocks. */
    anzeige: 1.00,
    /* Zwei Beine: erst zur Wand, dann zurück in den Lauf. Die Anzeige muss
       BEIDE bewerten, sonst verspricht sie den halben Pass. */
    rueck: true
  }
};
const TYPE_ORDER = ['flach', 'steil', 'chip', 'doppelpass'];

const COL = {
  rasen: '#2f7d32', rasenDunkel: '#276b2a', rasenRand: '#1f5520',
  linie: '#f4f4ec', outline: '#0d1116',
  beige: '#e8d9b0', papier: '#f2e8cf', holz: '#8b5a2b',
  rot: '#c1272d', blau: '#1c4f8f', gelb: '#f5c518', gruen: '#3fae4a',
  dunkel: '#1a1f28', hellblau: '#8fc4f0',
  rangA: '#3b4149', rangB: '#2b3037', rangC: '#1a1e23'
};

/* ========================================================================== *
 *  HELFER (rein, DOM-frei)
 * ========================================================================== */

const att = (p, key, fallback = 50) => {
  const v = p && p.attributes ? p.attributes[key] : undefined;
  return typeof v === 'number' ? v : fallback;
};
const hasTrait = (p, key) => !!(p && Array.isArray(p.traits) && p.traits.indexOf(key) >= 0);
const nameOf = (p, fallback = 'Mitspieler') => (p && (p.shortName || p.lastName)) || fallback;

const toX = (fx) => ORIGIN.x + fx * PPM;
const toY = (fy) => ORIGIN.y + fy * PPM;

function dist(a, b) { return Math.hypot(a.fx - b.fx, a.fy - b.fy); }

/**
 * Deterministische Streuung ohne rng-Zug — dieselbe Bauart wie `hash01()` in
 * `render/pitch.js`. Wichtig, weil Freilaufwege JEDEN Teilschritt fällig werden
 * können: ein rng.next() an dieser Stelle würde die Zahl der Züge an die
 * Bildrate hängen und die Szene unreproduzierbar machen.
 */
function hash01(a, b) {
  let h = ((a | 0) * 374761393 + (b | 0) * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function normWinkel(w) {
  while (w > Math.PI) w -= Math.PI * 2;
  while (w < -Math.PI) w += Math.PI * 2;
  return w;
}

function smoothstep(a, b, v) {
  if (b === a) return v < a ? 0 : 1;
  let t = (v - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** Passkönnen 0..1 aus Passspiel/Übersicht/Technik. */
function passKoennen(p) {
  return clamp(
    (att(p, 'passspiel') * 0.58 + att(p, 'uebersicht') * 0.27 + att(p, 'technik') * 0.15) / 99,
    0, 1);
}

/** Abschussgeschwindigkeit in m/s: volle Stärke erst ab D_VOLL Metern. */
function abschussTempo(spec, skill, d) {
  const voll = spec.v0a + spec.v0b * skill;
  return V0_KURZ + (voll - V0_KURZ) * clamp(d / D_VOLL, 0, 1);
}

/* ========================================================================== *
 *  BALLBAHN — einmal rechnen, danach nur noch abtasten
 * ========================================================================== */

/**
 * Integriert eine Passbahn auf das feste Teilschritt-Raster in `buf`
 * (je Stützstelle drei Werte: fx, fy, z) und liefert die Zahl der Stützstellen.
 *
 * Modell nach Umbauplan Punkt 5: im Flug nur −g, am Boden Rollreibung ROLL_A,
 * Aufsetzer `vz → −0,5·vz`, horizontal `×0,72`. Bewusst KEIN Luftwiderstand:
 * über 10–25 m und unter 2 s ist er kleiner als der Winkelfehler des Passes,
 * und die Bahn muss von `interceptZeit()` millionenfach abgetastet werden.
 */
function bahnBauen(buf, fx, fy, z, vx, vy, vz) {
  const dt = PHYS_STEP;
  buf[0] = fx; buf[1] = fy; buf[2] = z;
  let n = 1;
  while (n < BAHN_N) {
    if (z > 0 || vz > 0) {
      vz -= G * dt;
      const nz = z + vz * dt;
      fx += vx * dt; fy += vy * dt;
      if (nz <= 0) {
        z = 0;
        vz = -PRALL_Z * vz;
        vx *= PRALL_H; vy *= PRALL_H;
        if (vz < BALL_HAFT_VZ) vz = 0;
      } else {
        z = nz;
      }
    } else {
      z = 0; vz = 0;
      const s = Math.hypot(vx, vy);
      if (s > 1e-6) {
        const ns = Math.max(0, s - ROLL_A * dt);
        vx = vx / s * ns; vy = vy / s * ns;
      }
      fx += vx * dt; fy += vy * dt;
    }
    const i = n * 3;
    buf[i] = fx; buf[i + 1] = fy; buf[i + 2] = z;
    n++;
    if (fx < 0 || fx > FIELD_W || fy < 0 || fy > FIELD_D) break;
    if (z <= 0 && Math.hypot(vx, vy) < BALL_STILL) break;
  }
  return n;
}

/* ========================================================================== *
 *  SZENENKERN — vollständig DOM-frei, unter Node lauffähig
 * ========================================================================== */

/**
 * Baut eine spielbare Kombinationsszene ohne jeden Bildschirmbezug.
 *
 * @param {object} opts { moment, rng, difficulty }
 *        `rng` muss die Rng-API aus core/rng.js erfüllen, `difficulty` ist die
 *        Zahl aus `DIFFICULTIES[...].minigame` (0,4 … 2).
 * @returns {object} Szene mit `schritt(dt)`, Zustand und Statistik.
 */
export function erzeugeSzene(opts) {
  const o = opts || {};
  const m = o.moment || {};
  const rng = o.rng || { next: () => 0.5, gauss: () => 0, chance: () => false };
  const diff = clamp(typeof o.difficulty === 'number' ? o.difficulty : 1, 0.4, 2);

  const actor = m.actor || null;
  const context = m.context || {};
  const pressure = clamp(typeof m.pressure === 'number' ? m.pressure : 45, 0, 100);

  /* ---- Akteure ---------------------------------------------------------- */

  let idSeq = 0;

  function baueAkteur(player, fx, fy, seite) {
    const k = laufwerte({
      tempo: att(player, 'tempo'),
      antritt: att(player, 'antritt', att(player, 'tempo')),
      koerper: att(player, 'koerper'),
      fitness: player && typeof player.fitness === 'number' ? player.fitness : 100
    });
    const wachheit = (att(player, 'positionsspiel') * 0.5 + att(player, 'uebersicht') * 0.5) / 99;
    const fit = player && typeof player.fitness === 'number' ? clamp(player.fitness, 0, 100) : 100;
    return {
      player, fx, fy, vx: 0, vy: 0, seite,
      idx: ++idSeq,
      k,
      /* Ausdauerkonto: Startwert aus der Fitness, Verbrauch aus dem Attribut. */
      stam: clamp(fit / 100, 0.5, 1),
      drain: lerp(1 / 7, 1 / 16, clamp(att(player, 'ausdauer') / 99, 0, 1)),
      kEff: { vmax: k.vmax, apeak: k.apeak, tau: k.tau, aBrems: k.aBrems, aLat: k.aLat },
      reakt: lerp(REACT_MAX, REACT_MIN, wachheit),
      sprung: att(player, 'sprungkraft'),
      zweikampf: att(player, 'zweikampf'),
      /* Freilauf */
      wp: { fx, fy }, wpT: 0, wpN: 0,
      /* Verteidiger */
      mark: null, reaktRest: 0, altZielFx: fx, altZielFy: fy, duellAn: false,
      abseitsSeit: 0,
      /* Abfangen */
      tInter: Infinity, iFx: fx, iFy: fy,
      /* Zugriffszeit und nächster Annäherungspunkt aus interceptZeit() */
      tZug: Infinity, nahT: 0, nahD: Infinity,
      /* Vorausschau für das zweite Bein des Doppelpasses (siehe prognose()) */
      pFx: fx, pFy: fy, pVx: 0, pVy: 0,
      /* Darstellung */
      blick: Math.PI * 0.5, gang: 0, tempoNow: 0, boost: 0
    };
  }

  /* Ballführender startet zentral am Rand des letzten Drittels. */
  const carrierStart = {
    fx: clamp(34 + (rng.next() * 18 - 9), 8, 60),
    fy: 25 + rng.next() * 5
  };
  let carrier = baueAkteur(actor, carrierStart.fx, carrierStart.fy, 'eigen');
  const passer0 = carrier;

  const rawTargets = (Array.isArray(m.targets) ? m.targets : []).filter(Boolean).slice(0, 5);
  const mates = [];
  const STARTS = [
    { fx: 15, fy: 19 }, { fx: 53, fy: 18 }, { fx: 34, fy: 13 },
    { fx: 24, fy: 25 }, { fx: 46, fy: 26 }
  ];
  const mateCount = Math.max(3, Math.min(5, rawTargets.length || 3));
  for (let i = 0; i < mateCount; i++) {
    const s = STARTS[i % STARTS.length];
    mates.push(baueAkteur(rawTargets[i] || null,
      clamp(s.fx + (rng.next() * 6 - 3), 4, 64),
      clamp(s.fy + (rng.next() * 5 - 2.5), 5, 33), 'eigen'));
  }

  const rawDefs = (Array.isArray(m.defenders) ? m.defenders : []).filter(Boolean).slice(0, 5);
  const opps = [];
  const oppCount = Math.max(3, Math.min(5, rawDefs.length || 4));
  for (let i = 0; i < oppCount; i++) {
    const ziel = mates[i % mates.length];
    const d = baueAkteur(rawDefs[i] || null,
      clamp(ziel.fx + (rng.next() * 8 - 4), 3, 65),
      clamp(ziel.fy - (3 + rng.next() * 4), 3, 32), 'gegner');
    /* Der Schwierigkeitsgrad sitzt in Wachheit und Tempo der Gegner. */
    d.kEff.vmax = d.k.vmax = d.k.vmax * (0.90 + 0.10 * diff);
    d.reakt = clamp(d.reakt / (0.85 + 0.15 * diff), 0.10, 0.45);
    d.mark = ziel;
    opps.push(d);
  }

  /* Torwart: eigener Akteur mit eigenem Tempolimit (Umbauplan Punkt 10). */
  const keeper = baueAkteur(m.keeper || null, 34, 2.6, 'gegner');
  keeper.k.vmax = TW_V_BASIS * (0.85 + 0.30 * clamp(att(m.keeper, 'stellungsspiel') / 99, 0, 1));
  keeper.k.tau = keeper.k.vmax / keeper.k.apeak;
  keeper.kEff.vmax = keeper.k.vmax;
  keeper.kEff.tau = keeper.k.tau;

  /** Alle Gegner inklusive Torwart — persistentes Array, keine Allokation je Frame. */
  const gegner = opps.concat([keeper]);
  /** Alle Akteure. Wird bei Ballwechseln umgehängt, aber nie neu gebaut. */
  const alle = [];
  function alleNeu() {
    alle.length = 0;
    alle.push(carrier);
    for (const a of mates) alle.push(a);
    for (const a of gegner) alle.push(a);
  }
  alleNeu();

  /* ---- Zustand ---------------------------------------------------------- */

  const ball = { fx: carrier.fx, fy: carrier.fy, z: 0, live: false };

  const S = {
    phase: 'spiel',              // spiel | pass | ergebnis
    t: 0, phaseT: 0,
    budget: SCENE_BASE_S,
    stations: 0,
    qualities: [],
    dangerBefore: 0,
    type: 'flach',
    selected: mates[0],
    pass: null,
    banner: '',
    bannerColor: COL.gelb,
    markT: 0
  };

  const stat = {
    paesse: 0, paesseAn: 0,
    zweikaempfe: 0, zweikaempfeVerloren: 0,
    abseits: 0, abschluss: 0, fehlpass: 0, zeit: 0
  };

  /* Bahnpuffer: einer für den laufenden Pass, einer für die Vorschau. */
  const bahnBuf = new Float64Array(BAHN_N * 3);
  const vorBuf = new Float64Array(BAHN_N * 3);
  const bahnRef = { buf: bahnBuf, n: 1, dauer: 0 };
  const vorRef = { buf: vorBuf, n: 1, dauer: 0 };

  /* Kratzobjekte — in der Schleife wird nichts alloziert. */
  const _p = { x: 0, y: 0, vx: 0, vy: 0 };
  const _bp = { fx: 0, fy: 0, z: 0 };
  const _bp2 = { fx: 0, fy: 0, z: 0 };
  const _aim = { fx: 0, fy: 0 };
  /* Zielpunkt und Abschussort des zweiten Beins (Doppelpass). */
  const _aim2 = { fx: 0, fy: 0 };
  const _wand = { fx: 0, fy: 0 };
  /* Rückgabepuffer von passChance() — der Renderer ruft sie je Frame auf, und
   * in der rAF-Schleife wird nichts alloziert. */
  const _chanceAim = { fx: 0, fy: 0 };
  const _chanceErg = { p: 0, aim: _chanceAim, interceptor: null, d: 0, marge: 0 };

  /**
   * Schaltet `interceptZeit()` und `nachlaufZeit()` auf die vorausgeschriebenen
   * Positionen um. Gebraucht ausschliesslich für das ZWEITE Bein des
   * Doppelpasses: der Rückpass fällt erst, wenn der erste Ball angekommen ist,
   * und bis dahin steht niemand mehr dort, wo er beim Abspiel stand.
   */
  let _progAn = false;


  let rasterZ = 0, regieZ = 0;
  /* Nächster Bahnpunkt aus dem letzten `interceptZeit()`-Durchgang. */
  let _interNahT = 0, _interNahD = 0;

  /* ====================================================================== *
   *  BAHN ABTASTEN
   * ====================================================================== */

  function bahnAt(ref, t, out) {
    const n = ref.n;
    let f = t / PHYS_STEP;
    if (!(f > 0)) f = 0;
    let i = f | 0;
    if (i >= n - 1) { i = n - 2; f = 1; } else { f -= i; }
    if (i < 0) { i = 0; f = 0; }
    const a = i * 3, b = a + 3, g = 1 - f;
    out.fx = ref.buf[a] * g + ref.buf[b] * f;
    out.fy = ref.buf[a + 1] * g + ref.buf[b + 1] * f;
    out.z = ref.buf[a + 2] * g + ref.buf[b + 2] * f;
    return out;
  }

  /* ====================================================================== *
   *  ABFANGEN ALS ZEITFRAGE
   * ====================================================================== */

  /**
   * Frühester Zeitpunkt, zu dem `a` den Ball der Bahn `ref` erreichen KANN,
   * oder Infinity. Höchstens INTER_PROBEN Zeitproben — das ist die verbindliche
   * Leistungsgrenze aus Punkt 6 des Umbauplans.
   */
  function interceptZeit(a, ref, tJetzt, tMax) {
    const t1 = Math.min(ref.dauer, tJetzt + tMax);
    if (!(t1 > tJetzt)) return Infinity;
    const k = a.kEff;
    const aFx = _progAn ? a.pFx : a.fx, aFy = _progAn ? a.pFy : a.fy;
    const aVx = _progAn ? a.pVx : a.vx, aVy = _progAn ? a.pVy : a.vy;
    const s = Math.hypot(aVx, aVy);
    const zSprung = Z_SPRUNG_BASIS + Z_SPRUNG_SPANNE * clamp(a.sprung / 99, 0, 1);
    const spanne = t1 - tJetzt;
    /* Vorheriger Fehlschlag, für die Zwischenschätzung. Ohne sie lieferte die
     * Funktion nur die zwölf Rasterzeiten zurück — und dann hätten reihenweise
     * Akteure EXAKT dieselbe Ankunftszeit, jeder Ball wäre ein Zweikampf und
     * das Duellfenster von 0,15 s bedeutungslos. */
    let gPrev = NaN, tPrev = tJetzt;
    /* Nebenprodukt für den Fall, dass es NICHT reicht: die Zeitprobe, an der
     * der Ball ihm am nächsten kommt. Seit die flachen Pässe nicht mehr nach
     * 24 m ausrollen, sondern durchlaufen, liegt das Bahnende irgendwo an der
     * Feldkante — wer dorthin läuft, läuft vom Ball weg. */
    _interNahT = tJetzt; _interNahD = Infinity;
    for (let i = 1; i <= INTER_PROBEN; i++) {
      const vorlauf = spanne * i / INTER_PROBEN;
      const t = tJetzt + vorlauf;
      bahnAt(ref, t, _bp);
      const zMax = vorlauf >= Z_SPRUNG_VORLAUF ? zSprung : Z_LAUF;
      if (_bp.z > zMax) continue;
      const dx = _bp.fx - aFx, dy = _bp.fy - aFy;
      const dRoh = Math.hypot(dx, dy);
      if (dRoh < _interNahD) { _interNahD = dRoh; _interNahT = t; }
      const d = dRoh - PLAY_REACH;
      let noetig = a.reakt;
      /* Anlauf: Wer schon läuft, startet nicht bei null. Der Vorsprung ist der
       * Anteil des Tempos, der in die Zielrichtung zeigt; die Wende dazwischen
       * kostet nach `wendeKosten` extra. Ohne diesen Anlauf wäre jeder
       * sprintende Verteidiger so langsam wie ein stehender — und jeder Pass
       * käme an. */
      let t0 = 0, s0 = 0;
      if (s > 0.4) {
        const rad = normWinkel(Math.atan2(dy, dx) - Math.atan2(aVy, aVx));
        noetig += wendeKosten(s, Math.abs(rad) * 180 / Math.PI);
        const sMit = s * Math.max(0, Math.cos(rad));
        if (sMit > 0.2) {
          t0 = -k.tau * Math.log(1 - clamp(sMit / k.vmax, 0, 0.985));
          s0 = sprintStrecke(t0, k);
        }
      }
      if (d > 0) noetig += sprintZeit(s0 + d, k) - t0;
      const g = noetig - vorlauf;
      if (g <= 0) {
        a.nahT = _interNahT; a.nahD = _interNahD;
        if (isFinite(gPrev) && gPrev > 0) {
          const u = gPrev / (gPrev - g);
          return tPrev + (t - tPrev) * (u > 0 && u < 1 ? u : 1);
        }
        return t;
      }
      gPrev = g; tPrev = t;
    }
    a.nahT = _interNahT; a.nahD = _interNahD;
    return Infinity;
  }

  /**
   * Ankunftszeit am RUHENDEN Ball am Bahnende.
   */
  function nachlaufZeit(a, ref, endFx, endFy) {
    const aFx = _progAn ? a.pFx : a.fx, aFy = _progAn ? a.pFy : a.fy;
    const d = Math.max(0, Math.hypot(endFx - aFx, endFy - aFy) - PLAY_REACH);
    return ref.dauer + a.reakt + sprintZeit(d, a.kEff);
  }

  /**
   * Liegt der Bahnendpunkt so, dass ihn überhaupt jemand erreichen kann? Die
   * Akteure sind auf RAND_* geklemmt; ein Ball, der hinter der Bildkante liegen
   * bleibt, gehört niemandem mehr.
   */
  function endeErreichbar(ref) {
    bahnAt(ref, ref.dauer, _bp2);
    return _bp2.fx > RAND_X0 - PLAY_REACH && _bp2.fx < RAND_X1 + PLAY_REACH
      && _bp2.fy > RAND_Y0 - PLAY_REACH && _bp2.fy < RAND_Y1 + PLAY_REACH;
  }

  /**
   * Zugriffszeit je Akteur auf die Bahn `ref`. Drei Wege, in dieser Reihenfolge:
   *
   *   1. Er schneidet die Bahn im Lauf          -> `interceptZeit()`
   *   2. Er setzt nach und kommt nicht ganz hin -> Zeitpunkt der grössten
   *      Annäherung plus NAH_STRAFE je Meter Fehlbetrag
   *   3. Der Ball bleibt im Bild liegen         -> `nachlaufZeit()`
   *
   * DIESELBE Rechnung für Auflösung und Anzeige. Genau hier liefen sie
   * auseinander: die Auflösung liess nachsetzen und den liegenden Ball holen,
   * die Anzeige kannte nur „schneiden oder gar nicht" und zeigte sonst 0 %.
   */
  function zugriffRechnen(ref) {
    const holbar = endeErreichbar(ref);
    const endFx = _bp2.fx, endFy = _bp2.fy;
    for (const a of alle) {
      const t = interceptZeit(a, ref, 0, ref.dauer);
      a.tInter = t;
      let z = t;
      if (!isFinite(z) && isFinite(a.nahD)) {
        z = a.nahT + NAH_STRAFE * Math.max(0, a.nahD - PLAY_REACH);
      }
      if (holbar) {
        const n = nachlaufZeit(a, ref, endFx, endFy);
        if (n < z) z = n;
      }
      a.tZug = z;
    }
  }

  /**
   * Wer bekommt den Ball — und wann?
   *
   * Das ist der Kern der Umstellung: „Kleinstes `t` gewinnt den Ball"
   * (Umbauplan Punkt 6). Die Entscheidung fällt EINMAL, beim diskreten Ereignis
   * Abspiel, aus der bereits fertig integrierten Bahn. Sie ist damit dieselbe
   * Rechnung, die `passChance()` für die Anzeige macht — Vorhersage und
   * Auflösung KÖNNEN nicht auseinanderlaufen.
   *
   * Ein Zweikampf entsteht, wenn zwei Akteure verschiedener Seiten innerhalb
   * DUELL_FENSTER am Ball wären; er kostet genau einen `rng.chance`.
   */
  function entscheideBall() {
    zugriffRechnen(bahnRef);
    const grenze = bahnRef.dauer + BALL_NACHFRIST_S;
    let sieger = null, tSieg = Infinity;
    for (const a of alle) if (a.tZug < tSieg) { tSieg = a.tZug; sieger = a; }
    if (!sieger || tSieg > grenze) return { sieger: null, t: tSieg };
    let rival = null, tRival = Infinity;
    for (const a of alle) {
      if (a.seite === sieger.seite) continue;
      if (a.tZug < tRival) { tRival = a.tZug; rival = a; }
    }
    if (rival && tRival - tSieg < DUELL_FENSTER && !duell(sieger, rival, tRival - tSieg)) {
      /* `duell: true` heisst genau eine Sache: der Zweikampf hat den Ausgang
       * GEDREHT. Wer den Ball ohnehin bekommen hätte, hat ihn nicht „im
       * Zweikampf verloren" — das wäre ein Abfangen, und der Prüfstand zählt
       * beides getrennt. */
      return { sieger: rival, t: tRival, duell: true };
    }
    return { sieger, t: tSieg, duell: false };
  }

  /** Ein Auswertungsdurchgang auf dem 60-Hz-Raster: Zeit und Zielpunkt je Akteur. */
  function intercepteRechnen() {
    const tJetzt = S.phaseT;
    const rest = bahnRef.dauer - tJetzt;
    const ruht = !(rest > 0);
    bahnAt(bahnRef, bahnRef.dauer, _bp2);
    const endFx = _bp2.fx, endFy = _bp2.fy;
    for (const a of alle) {
      if (a.reaktRest > 0) { a.tInter = Infinity; continue; }
      if (ruht) {
        /* Der Ball liegt: jeder kann ihn holen, es zählt nur noch der Weg. */
        a.iFx = endFx; a.iFy = endFy;
        const d = Math.max(0, Math.hypot(endFx - a.fx, endFy - a.fy) - PLAY_REACH);
        a.tInter = tJetzt + a.reakt + sprintZeit(d, a.kEff);
        continue;
      }
      const t = interceptZeit(a, bahnRef, tJetzt, rest);
      a.tInter = t;
      /* Wer die Bahn schneiden kann, läuft auf den Schnittpunkt. Wer nicht,
       * läuft auf den Punkt, an dem ihm der Ball am nächsten kommt — NICHT
       * ans Bahnende. Ein durchlaufender Flachpass endet an der Feldkante,
       * und dorthin zu sprinten ist keine Verfolgung, sondern eine Flucht. */
      bahnAt(bahnRef, isFinite(t) ? t : _interNahT, _bp2);
      a.iFx = _bp2.fx; a.iFy = _bp2.fy;
    }
  }

  /* ====================================================================== *
   *  BEWERTUNG
   * ====================================================================== */

  /** Nächster Gegner (inklusive Torwart, Umbauplan Punkt 10). */
  function nearestOppDist(pt, ignore) {
    let best = 99;
    for (const g of gegner) {
      if (g === ignore) continue;
      const d = dist(g, pt);
      if (d < best) best = d;
    }
    return best;
  }

  /** Gefahrengrad der aktuellen Position: 0 = harmlos, 1 = Riesenchance. */
  function chanceValue(pt) {
    const d = Math.hypot(pt.fx - GOAL_CENTER.fx, pt.fy - GOAL_CENTER.fy);
    const distF = clamp(1 - (d - 6) / 24, 0, 1);
    const angleF = clamp(1 - Math.abs(pt.fx - 34) / 26, 0.22, 1);
    const freeF = clamp(nearestOppDist(pt) / 7, 0, 1);
    return clamp(distF * angleF * (0.35 + 0.65 * freeF), 0, 1);
  }

  /** Abseitslinie: zweitkleinstes fy über Gegner + Torwart. */
  function abseitslinie() {
    let a = 99, b = 99;
    for (const g of gegner) {
      if (g.fy < a) { b = a; a = g.fy; }
      else if (g.fy < b) { b = g.fy; }
    }
    return b < 99 ? b : FIELD_D;
  }

  /**
   * Zielpunkt eines Passes: in den Lauf des Empfängers (VORHALT_W), plus die
   * Vorlage der Passart, geklemmt an der Abseitslinie.
   *
   * Der Vorhalt war früher aus Messgründen entfernt — unter dem alten,
   * ausgebremsten Ball kostete er 2–4 Punkte Passquote. Mit einem Ball, der
   * nicht mehr nach 24 m liegen bleibt, dreht sich das um: der Empfänger ist
   * nach 0,9 s Flugzeit nicht mehr da, wo er beim Abspiel stand. Die gewollte
   * Vorlage in die Tiefe macht weiterhin `spec.lead`.
   */
  function zielpunkt(from, to, spec, out) {
    const linie = abseitslinie();
    /* Der Vorlauf ist die Nachlässigkeit des Empfängers: ein guter
     * Positionsspieler bleibt vor der Linie, ein schlechter läuft hinein. */
    const vorlauf = ABSEITS_VORLAUF * (1 - clamp(att(to.player, 'positionsspiel') / 99, 0, 1));
    const grenze = Math.max(1.5, linie + ABSEITS_SICHER - vorlauf);
    const dRoh = Math.hypot(to.fx - from.fx, to.fy - from.fy);
    const v0 = abschussTempo(spec, passKoennen(from.player), dRoh);
    const tFlug = dRoh / Math.max(4, v0);
    out.fx = to.fx + to.vx * tFlug * VORHALT_W;
    out.fy = Math.max(spec.lead > 0 ? grenze : 1.5, to.fy + to.vy * tFlug * VORHALT_W - spec.lead);
    if (out.fy > from.fy && spec.lead > 0) out.fy = to.fy;
    return out;
  }

  /**
   * Zielpunkt des RÜCKPASSES beim Doppelpass: in den LAUF des Passgebers, nicht
   * auf seinen Standort. Die Flugzeit wird zweimal nachgezogen, weil der
   * Zielpunkt mit ihr wandert.
   *
   * Dieselbe Rechnung benutzen die Anzeige (mit den vorausgeschriebenen
   * Positionen aus `prognose()`) und die Auflösung in `kontakteRegeln()` (mit
   * den echten). Der frühere Rückpass zielte auf `passer + v · 0,3 s` — dorthin,
   * wo der Passgeber schon gewesen war.
   */
  function rueckZiel(wFx, wFy, lFx, lFy, lVx, lVy, v0, out) {
    const v = Math.max(4, v0);
    let t = Math.hypot(lFx - wFx, lFy - wFy) / v;
    for (let i = 0; i < 2; i++) {
      const zx = lFx + lVx * t * VORHALT_W;
      const zy = Math.max(2.5, lFy + lVy * t * VORHALT_W);
      t = Math.hypot(zx - wFx, zy - wFy) / v;
    }
    out.fx = clamp(lFx + lVx * t * VORHALT_W, RAND_X0, RAND_X1);
    out.fy = clamp(Math.max(2.5, lFy + lVy * t * VORHALT_W), RAND_Y0, RAND_Y1);
    return out;
  }

  /**
   * Vorausschau: wo steht jeder Akteur, wenn die Wand den Ball hat? Geradlinig
   * fortgeschrieben und gedämpft (PROG_DAEMPF).
   */
  function prognose(t) {
    const f = t * PROG_DAEMPF;
    for (const a of alle) {
      a.pFx = clamp(a.fx + a.vx * f, RAND_X0, RAND_X1);
      a.pFy = clamp(a.fy + a.vy * f, RAND_Y0, RAND_Y1);
      a.pVx = a.vx; a.pVy = a.vy;
    }
  }

  /** Streuungsmaß des Abspiels in Radiant — dieselbe Formel wie beim echten Pass. */
  function aimSigma(from, spec) {
    return AIM_SIGMA * (1 - AIM_SKILL_W * passKoennen(from.player))
      * (1 + AIM_PRESSURE_W * pressure / 100) * spec.streuung;
  }

  /**
   * Zeitmarge einer konkreten Vorschaubahn: bester Gegner minus dem schnellsten
   * EIGENEN Spieler.
   *
   * `tEigen` ist das Minimum über ALLE eigenen Spieler und beantwortet damit die
   * Frage „bleibt der Ball in unseren Reihen?". Der Knopf verspricht genau
   * genommen etwas anderes — „kommt DIESER Pass bei DIESEM Mann an?" —, und so
   * zählt die Szene ihn auch (`passAngekommen(gezielt)`: ein Ball, den ein
   * anderer Mitspieler aufsammelt, ist keine Station und kein angekommener
   * Pass). Diese Lücke ist bekannt, VIERMAL gemessen und viermal nicht
   * geschlossen worden — sie zu schliessen macht die Anzeige messbar
   * schlechter, nicht besser:
   *
   *   • Zusammen mit weiteren Modellkorrekturen (damaliges Lineal, aus Gruppe 4c
   *     zurückgerechnete Ersatzwirklichkeit): falsch angeführte Knöpfe
   *     17,8 % → 27,4 %. Zurückgenommen.
   *   • Allein, mit ANZ_MARGE_LO −0,35 → −0,90 nachgezogen (eine Saatfolge):
   *     Empfänger reihum besser, die Anspielstation schlechter, und der
   *     Korridor „Szene endet mit Abschluss" bricht auf 41,6 %.
   *   • `tEigen` vollständig durch die Zeit des Empfängers ersetzt, gemessen
   *     über vier Saatfamilien an 4124 wirklich gespielten Pässen: gepaarter
   *     Vorsprung gegen blind [F] auf der bequemen Anspielstation
   *     −0,8 → −7,5 ± 2,2 Punkte, reihum −10,4 → +0,4 ± 2,1.
   *   • Derselbe Gedanke als ZUSÄTZLICHER Faktor („welcher Anteil entfällt auf
   *     den angespielten Mann"), multiplikativ neben die Marge gestellt:
   *     −0,8 → −5,0 ± 1,5 bzw. −10,4 → 0,0 ± 1,4.
   *
   * Beide Fassungen der letzten Welle scheitern an derselben Stelle, und die
   * ist lehrreich: sie ziehen den CHIP künstlich hoch. `interceptZeit()` prüft
   * die Ballhöhe (Z_LAUF, Z_SPRUNG_BASIS) und findet über einem fliegenden
   * Ball fast keinen Mitspieler, der ihn „wegschnappen" könnte — die Anzeige
   * des Chips stieg dadurch auf das Zwei- bis Dreifache der des Flachpasses
   * (gemessen 62 % gegen 35 %), und der Chip führte plötzlich in 80 % aller
   * Lagen. Er liefert dort aber weniger als der Flachpass. Was aussieht wie die
   * ehrlichere Frage, ist im Modell ein Höhenartefakt.
   *
   * Die Umstellung bleibt deshalb draußen. Die Passart trägt jetzt eine
   * gemessene Zahl (`PASS_TYPES[*].anzeige`), keine erfundene Physik.
   */
  function margeFuer() {
    zugriffRechnen(vorRef);
    const grenze = vorRef.dauer + BALL_NACHFRIST_S;
    let tEigen = Infinity, tGegner = Infinity, worst = null;
    for (const a of alle) {
      const z = a.tZug;
      if (a.seite === 'gegner') { if (z < tGegner) { tGegner = z; worst = a; } }
      else if (z < tEigen) tEigen = z;
    }
    if (Math.min(tEigen, tGegner) > grenze) return { marge: 0, worst: null, offen: true };
    if (tEigen > grenze) return { marge: -9, worst, offen: false };
    if (tGegner > grenze) return { marge: 9, worst: null, offen: false };
    return { marge: tGegner - tEigen, worst, offen: false };
  }

  /**
   * Zeitmarge -> geometrische Erfolgsaussicht (siehe ANZ_MARGE_*). OHNE den
   * Boden: ANZ_BODEN beschreibt, dass die Vorhersage nicht das letzte Wort hat,
   * und das gilt je ENTSCHEIDUNG, nicht je Bein. Beim Doppelpass zweimal
   * angewandt hätte der Boden sich selbst quadriert und den unteren Bereich der
   * Anzeige nach unten gedrückt.
   */
  function margeChance(marge) {
    return smoothstep(ANZ_MARGE_LO, ANZ_MARGE_HI, marge);
  }

  const SIGMA_PROBEN = [-1.4, -0.7, 0, 0.7, 1.4];
  const SIGMA_GEWICHT = [0.12, 0.24, 0.28, 0.24, 0.12];
  /* Das zweite Bein liegt weiter in der Zukunft und ist ohnehin unschärfer —
     drei Proben genügen und halten den Aufwand der Anzeigefunktion bei rund
     1,6 statt 2,0 Bahnsätzen. */
  const RUECK_PROBEN = [-1.0, 0, 1.0];
  const RUECK_GEWICHT = [0.27, 0.46, 0.27];

  /**
   * Wahrscheinlichkeit, dass das ZWEITE Bein eines Doppelpasses ankommt.
   *
   * Der Doppelpass zählt erst als angekommen, wenn der Rückpass den Passgeber
   * erreicht — `kontakteRegeln()` ruft `passAngekommen()` erst nach `leg === 1`.
   * Die Anzeige rechnete bis hierher nur das erste Bein und versprach damit bis
   * zu 37 Punkte zu viel, während der Spieler [D] als eine von vier
   * gleichrangigen Passarten wählt.
   *
   * Gerechnet wird auf der vorausgeschriebenen Welt zum Zeitpunkt der
   * Ballannahme an der Wand: die Wand steht am Zielpunkt des ersten Beins, der
   * Passgeber hat sich um seinen Laufweg nach vorn angeboten, alle anderen sind
   * mit ihrer Geschwindigkeit fortgeschrieben.
   */
  function rueckChance(from, to, aim1, d1, v0, spec) {
    /* Ankunftszeit des ersten Beins beim rollenden Ball: d = v₀t − ½·ROLL_A·t². */
    const w = v0 * v0 - 2 * ROLL_A * d1;
    const t1 = w > 0 ? (v0 - Math.sqrt(w)) / ROLL_A : d1 / Math.max(4, v0);

    prognose(t1);
    to.pFx = clamp(aim1.fx, RAND_X0, RAND_X1);
    to.pFy = clamp(aim1.fy, RAND_Y0, RAND_Y1);
    const k = from.kEff;
    const lauf = Math.min(DOPPEL_RUN, sprintStrecke(t1, k));
    const vLauf = lauf >= DOPPEL_RUN ? 0 : k.vmax * (1 - Math.exp(-t1 / Math.max(1e-3, k.tau)));
    from.pFx = from.fx;
    from.pFy = clamp(from.fy - lauf, RAND_Y0, RAND_Y1);
    from.pVx = 0; from.pVy = -vLauf;

    _wand.fx = to.pFx; _wand.fy = to.pFy;
    const v02 = abschussTempo(spec, passKoennen(to.player),
      Math.hypot(from.pFx - _wand.fx, from.pFy - _wand.fy));
    rueckZiel(_wand.fx, _wand.fy, from.pFx, from.pFy, 0, -vLauf, v02, _aim2);
    const d2 = Math.hypot(_aim2.fx - _wand.fx, _aim2.fy - _wand.fy);
    if (!(d2 > 0.4)) return 0;
    const winkel = Math.atan2(_aim2.fy - _wand.fy, _aim2.fx - _wand.fx);
    const sigma2 = aimSigma(to, spec);

    let summe = 0;
    _progAn = true;
    for (let i = 0; i < RUECK_PROBEN.length; i++) {
      bahnVorbereiten(vorRef, vorBuf, _wand, winkel + RUECK_PROBEN[i] * sigma2, v02, spec, d2);
      const r = margeFuer();
      summe += RUECK_GEWICHT[i] * (r.offen ? 0 : margeChance(r.marge));
    }
    _progAn = false;
    return summe;
  }

  /**
   * Anzeigefunktion der Passlinie — ZIEHT KEINEN ZUFALL (der Renderer ruft sie
   * je Frame auf).
   *
   * Sie rechnet FÜNF Bahnen: den Idealpass und vier um Vielfache von σ
   * verzogene, gewichtet wie eine Normalverteilung. Das ist der Unterschied
   * zwischen einer Zahl und einer EHRLICHEN Zahl: der Idealpass allein zeigt
   * „92 %", während der reale, gestreute Ball oft doch am Verteidiger landet.
   *
   * Für jede Bahn ist die Auflösung dieselbe wie im Ernstfall (`entscheideBall`):
   * die kleinere Ankunftszeit gewinnt, innerhalb von DUELL_FENSTER entscheidet
   * ein Zweikampf — also ungefähr 50:50. Genau das bildet der `smoothstep` über
   * das Duellfenster ab. tools/test-kombination.js, Gruppe 4b, misst nach.
   *
   * ACHTUNG: Die Rückgabe ist ein WIEDERVERWENDETES Objekt (keine Allokation je
   * Frame). Wer zwei Ergebnisse gleichzeitig braucht, kopiert das erste.
   */
  function passChance(from, to, typeKey) {
    const spec = PASS_TYPES[typeKey] || PASS_TYPES.flach;
    const aim = zielpunkt(from, to, spec, _chanceAim);
    const d = Math.hypot(aim.fx - from.fx, aim.fy - from.fy);
    const v0 = abschussTempo(spec, passKoennen(from.player), d);
    const winkel0 = Math.atan2(aim.fy - from.fy, aim.fx - from.fx);
    const sigma = aimSigma(from, spec);

    let summe = 0, worst = null, margeMitte = 0;
    for (let i = 0; i < SIGMA_PROBEN.length; i++) {
      bahnVorbereiten(vorRef, vorBuf, from, winkel0 + SIGMA_PROBEN[i] * sigma, v0, spec, d);
      const r = margeFuer();
      if (SIGMA_PROBEN[i] === 0) { worst = r.worst; margeMitte = r.marge; }
      else if (!worst) worst = r.worst;
      /* Bahn, die niemand erreicht: der Ball versickert — kein eigener Ballbesitz. */
      summe += SIGMA_GEWICHT[i] * (r.offen ? 0 : margeChance(r.marge));
    }
    /* Zwei Beine heisst zwei Ausführungen — AUSFUEHRUNG steckt in beiden.
       Der Anzeigeboden dagegen gilt einmal, für die Entscheidung als Ganzes.
       `spec.anzeige` ist die gemessene Kalibrierung DIESES Knopfes und gilt
       einmal je Entscheidung, nicht je Bein. */
    let geo = summe;
    let fuehrung = AUSFUEHRUNG * spec.anzeige;
    if (spec.rueck) {
      geo *= lerp(rueckChance(from, to, aim, d, v0, spec), 1, RUECK_KOPPLUNG);
      fuehrung *= AUSFUEHRUNG;
    }
    const p = (ANZ_BODEN + (1 - ANZ_BODEN) * geo) * fuehrung * (1.06 - 0.06 * diff)
      + (hasTrait(from.player, 'spielmacher_trait') ? 0.03 : 0);
    _chanceErg.p = clamp(p, PASS_ANZ_MIN, PASS_ANZ_MAX);
    _chanceErg.interceptor = worst;
    _chanceErg.d = d;
    _chanceErg.marge = margeMitte;
    return _chanceErg;
  }

  /** Abschussvektor eines Passes bauen und die Bahn integrieren. */
  function bahnVorbereiten(ref, buf, from, winkel, v0, spec, d) {
    let vx = Math.cos(winkel) * v0, vy = Math.sin(winkel) * v0, vz = 0;
    if (spec.hoch) {
      /* Chip: horizontal v0, senkrecht so, dass er die Strecke d überfliegt —
       * gedeckelt, sonst wird aus einem Chip über 30 m eine Mondrakete mit
       * acht Metern Scheitel. Über die Deckelgrenze hinaus fällt der Ball
       * bewusst zu kurz; ein Chip ist kein Weitschlag. */
      const tFlug = Math.max(0.35, d / Math.max(4, v0));
      vz = Math.min(CHIP_VZ_MAX, 0.5 * G * tFlug);
    }
    ref.buf = buf;
    /* Abschusshöhe. ENTSCHEIDUNG: der flache Pass startet auf z = 0.
     *
     * `bahnBauen()` hat den Boden bei z = 0 und führt den Ball als PUNKT auf
     * dieser Ebene — einen Ballradius gibt es in diesem Modell nicht. Ein
     * Flachpass, der auf 0,11 m losgeschickt wird, fällt deshalb SOFORT diese
     * 11 cm, setzt in der ersten halben Sekunde dreimal auf und verliert je
     * Aufsetzer 28 % seines Tempos (PRALL_H): aus v₀ = 21 m/s wurden nach
     * 0,5 s noch 7,74 m/s, die Laufweite brach von 60 auf 24 m ein, und die
     * vom Plan vorgeschriebene Rollreibung von 0,72 m/s² kam überhaupt erst
     * danach zum Tragen. Ein flacher Pass über 20 m brauchte 2,3 s statt gut
     * einer Sekunde.
     *
     * Die andere mögliche Auflösung — den Boden konsistent auf Ballradius
     * legen — hätte JEDE Höhenprüfung mitverschoben (Z_LAUF, Z_SPRUNG_BASIS,
     * Chip-Scheitel, Zeichenhöhe) und damit alle abgenommenen Korridore neu
     * aufgemacht, für exakt dasselbe Ergebnis: ein rollender Ball rollt.
     * Deshalb z = 0.
     *
     * Chips und hohe Bälle behalten ihre Abschusshöhe — sie sollen fliegen,
     * und ihre 0,15 m sind gegenüber dem Scheitel bedeutungslos. */
    ref.n = bahnBauen(buf, from.fx, from.fy, spec.hoch ? 0.15 : 0, vx, vy, vz);
    ref.dauer = (ref.n - 1) * PHYS_STEP;
  }

  /* ====================================================================== *
   *  BEWEGUNG
   * ====================================================================== */

  /** Ausdauerkonto und daraus die wirksamen Laufwerte. */
  function ausdauerSchritt(a, dt) {
    const s = Math.hypot(a.vx, a.vy);
    const last = clamp(s / Math.max(1e-6, a.k.vmax), 0, 1);
    if (last > 0.55) a.stam -= a.drain * dt * last;
    else a.stam += a.drain * 0.35 * dt;
    a.stam = clamp(a.stam, 0.25, 1);
    a.kEff.vmax = a.k.vmax * lerp(0.86, 1, a.stam);
    a.kEff.apeak = a.k.apeak * lerp(0.80, 1, a.stam);
    a.kEff.tau = a.kEff.vmax / a.kEff.apeak;
    a.kEff.aBrems = a.k.aBrems;
    a.kEff.aLat = a.k.aLat * lerp(0.85, 1, a.stam);
    a.tempoNow = s;
  }

  /**
   * Ein Zeitschritt in Richtung (tx, ty). `cap` ist das Tempo-Regime
   * (1,0 = Vollgas). Enge Kurven laufen über `lenke()` — das ist ein
   * VOLLSTÄNDIGER Zeitschritt und darf deshalb nicht mit `sprintSchritt()`
   * im selben Schritt kombiniert werden (sonst doppelte Ortsintegration).
   */
  function steuere(a, tx, ty, dt, cap, voll) {
    const k = a.kEff;
    _p.x = a.fx; _p.y = a.fy; _p.vx = a.vx; _p.vy = a.vy;
    const dx = tx - a.fx, dy = ty - a.fy;
    const d = Math.hypot(dx, dy);
    const s = Math.hypot(a.vx, a.vy);
    if (d < 1e-4) {
      sprintSchritt(_p, 0, 0, k, dt);
    } else {
      const zielRi = Math.atan2(dy, dx);
      const w = s > 1e-6 ? Math.abs(normWinkel(zielRi - Math.atan2(a.vy, a.vx))) : 0;
      if (s > 2.2 && w > 0.30 && w < 2.20) {
        lenke(_p, zielRi, k, dt);
      } else {
        /* Ankunftsgeschwindigkeit aus dem Bremsweg — sonst schießt jeder
         * Akteur über seinen Wegpunkt hinaus und zappelt. `voll` schaltet das
         * ab: wer einem Ball hinterherjagt, bremst nicht vor dem Treffpunkt,
         * sonst kommt er später an, als `interceptZeit()` es vorhergesagt hat —
         * und Vorhersage und Auflösung dürfen nicht auseinanderlaufen. */
        const vWunsch = voll ? k.vmax * cap
          : Math.min(k.vmax * cap, Math.sqrt(2 * k.aBrems * Math.max(0, d - 0.35)));
        sprintSchritt(_p, Math.cos(zielRi) * vWunsch, Math.sin(zielRi) * vWunsch, k, dt);
      }
    }
    let nx = _p.x, ny = _p.y, nvx = _p.vx, nvy = _p.vy;
    if (nx < RAND_X0) { nx = RAND_X0; if (nvx < 0) nvx = 0; }
    else if (nx > RAND_X1) { nx = RAND_X1; if (nvx > 0) nvx = 0; }
    if (ny < RAND_Y0) { ny = RAND_Y0; if (nvy < 0) nvy = 0; }
    else if (ny > RAND_Y1) { ny = RAND_Y1; if (nvy > 0) nvy = 0; }
    a.fx = nx; a.fy = ny; a.vx = nvx; a.vy = nvy;
  }

  /** Tempo-Regime aus der Wegpunktdistanz (Umbauplan Punkt 2). */
  function regime(d, eilig) {
    if (eilig || d > CAP_WEIT_R) return 1.0;
    if (d < CAP_NAH_R) return CAP_NAH;
    return CAP_MITTE;
  }

  /**
   * Freilaufziel: frei stehen, anspielbar bleiben, Richtung Tor arbeiten und
   * den Mitspielern nicht in die Füße laufen. Streuung über `hash01`, damit
   * hier KEIN rng-Zug im Teilschritt liegt.
   */
  function pickWaypoint(mate) {
    const linie = abseitslinie();
    const vorlauf = ABSEITS_VORLAUF * (1 - clamp(att(mate.player, 'positionsspiel') / 99, 0, 1));
    mate.wpN++;
    const tiefenlauf = hash01(mate.idx * 53, mate.wpN * 29 + 7) < TIEFENLAUF_ANTEIL;
    const tiefGrenze = Math.max(2.5,
      linie + (tiefenlauf ? 0 : ABSEITS_FREILAUF) - vorlauf);
    let best = null, bestScore = -99, bx = mate.fx, by = mate.fy;
    for (let i = 0; i < 7; i++) {
      const h1 = hash01(mate.idx * 31 + i, mate.wpN);
      const h2 = hash01(mate.idx * 17 + i, mate.wpN * 7 + 3);
      const cfx = clamp(mate.fx + (h1 * 32 - 16), 5, 63);
      const cfy = clamp(Math.max(tiefGrenze, mate.fy + (h2 * 24 - 12)), 4, 33);
      const cand = { fx: cfx, fy: cfy };
      const free = clamp(nearestOppDist(cand) / 8, 0, 1);
      const support = clamp(1 - Math.abs(dist(cand, carrier) - SUPPORT_DIST) / SUPPORT_DIST, 0, 1);
      const forward = clamp(1 - cfy / 32, 0, 1);
      let spread = 99;
      for (const other of mates) {
        if (other === mate) continue;
        const dd = dist(other, cand);
        if (dd < spread) spread = dd;
      }
      spread = clamp(spread / 12, 0, 1);
      const sc = free * 1.55 + support * 1.05 + forward * 0.5 + spread * 0.40
        - Math.abs(cfx - 34) / 110;
      if (sc > bestScore) { bestScore = sc; bx = cfx; by = cfy; best = cand; }
    }
    mate.wp.fx = bx; mate.wp.fy = by;
    mate.wpT = RUN_REPICK_S * (0.7 + 0.6 * hash01(mate.idx, mate.wpN * 13));
    return best;
  }

  /** Manndeckung neu zuordnen (rein geometrisch, kein Zufall). */
  function markZuordnen() {
    for (const d of opps) {
      let best = null, bestD = 1e9;
      for (const mate of mates) {
        let belegt = false;
        for (const other of opps) if (other !== d && other.mark === mate) { belegt = true; break; }
        const dd = dist(d, mate) + (belegt ? 9 : 0);
        if (dd < bestD) { bestD = dd; best = mate; }
      }
      d.mark = best || carrier;
    }
  }

  function stepMates(dt) {
    const empfaenger = (S.phase === 'pass' && S.pass) ? S.pass.receiver : null;
    /* Wer den Ball laut `entscheideBall()` bekommt, muss auch hinlaufen —
     * auch wenn er nicht der angespielte Mann ist. Solange nur der Empfänger
     * lief, wurde der „andere eigene Spieler, der die Situation klärt" allein
     * vom gestrichenen Teleport an den Ball gebracht und kam sonst nie an. */
    const jaeger = (S.phase === 'pass' && S.pass) ? S.pass.sieger : null;
    const linie = abseitslinie();
    for (const mate of mates) {
      if (mate.boost > 0) mate.boost -= dt;
      if (mate === empfaenger || mate === jaeger) {
        /* Der Empfänger LÄUFT auf den Ball — kein Teleport mehr. */
        steuere(mate, mate.iFx, mate.iFy, dt, 1.0, true);
        continue;
      }
      /* Wer im Abseits steht, geht zurück. Ohne das schiebt die Kette die
       * Angreifer laufend ins Abseits, und die Szene endet an der Fahne. */
      const vorlauf = ABSEITS_VORLAUF * (1 - clamp(att(mate.player, 'positionsspiel') / 99, 0, 1));
      if (mate.fy < linie - vorlauf) {
        mate.abseitsSeit += dt;
        if (mate.abseitsSeit > ABSEITS_MERKEN_S) {
          steuere(mate, mate.fx, linie + ABSEITS_RUECKWEG, dt, 1.0);
          continue;
        }
      } else {
        mate.abseitsSeit = 0;
      }
      mate.wpT -= dt;
      const dWp = dist(mate, mate.wp);
      if (mate.wpT <= 0 || dWp < 1.2) pickWaypoint(mate);
      steuere(mate, mate.wp.fx, mate.wp.fy, dt, regime(dWp, mate.boost > 0));
    }
  }

  function stepCarrier(dt) {
    if (S.phase !== 'spiel') {
      const pass = S.pass;
      if (pass && pass.back) {
        if (pass.leg === 0) {
          /* Erstes Bein: der Passgeber BIETET SICH AN — auf einen beim Abspiel
           * festgelegten Punkt. Früher war das Ziel `carrier.fy − DOPPEL_RUN`,
           * jeden Teilschritt neu gerechnet: es lief mit ihm mit, er sprintete
           * bis an den Fünfmeterraum und war beim Rückpass längst durch. */
          steuere(carrier, pass.laufFx, pass.laufFy, dt, 1.0);
        } else {
          /* Zweites Bein: der Rückpass läuft — jetzt zählt nur noch der Ball.
           * Ohne diesen Zweig lief der Passgeber stur geradeaus weiter, während
           * der Ball hinter ihm ins Leere rollte. Das war die eigentliche
           * Ursache dafür, dass die Anzeige um bis zu 37 Punkte log. */
          steuere(carrier, carrier.iFx, carrier.iFy, dt, 1.0, true);
        }
      } else {
        steuere(carrier, carrier.fx, carrier.fy, dt, 0.4);
      }
      return;
    }
    let tx = carrier.fx, ty = Math.max(CARRY_MIN_FY, carrier.fy - 3);
    /* Abschirmen: kommt ein Gegner heran, dreht der Ballführende vom Druck weg.
     * Das bleibt im Schritttempo — freies Andribbeln ist ausdrücklich NICHT
     * Teil dieses Pakets (Umbauplan Punkt 11). Aber es zappelt nicht mehr. */
    let naechster = null, nd = 1e9;
    for (const g of opps) { const dd = dist(g, carrier); if (dd < nd) { nd = dd; naechster = g; } }
    if (naechster && nd < CARRY_SCHIRM_R) {
      const ax = carrier.fx - naechster.fx, ay = carrier.fy - naechster.fy;
      const n = Math.hypot(ax, ay) || 1;
      tx = clamp(carrier.fx + ax / n * 4, 4, 64);
      ty = clamp(carrier.fy + ay / n * 4, 3, FIELD_D - 2);
    }
    const d = Math.hypot(tx - carrier.fx, ty - carrier.fy);
    const cap = clamp(CARRY_SPEED / Math.max(0.5, carrier.kEff.vmax), 0.05, 1);
    steuere(carrier, tx, ty, dt, d < 0.2 ? 0 : cap);
  }

  function stepOpps(dt) {
    /* Presser bestimmen: der Nächste am Ballführenden. */
    let presser = null, pressD = 1e9;
    for (const d of opps) {
      const dd = dist(d, carrier);
      if (dd < pressD) { pressD = dd; presser = d; }
    }
    /**
     * Wer dem Ball am nächsten ist, geht IHM nach — auch wenn er die Bahn nach
     * `interceptZeit()` nicht mehr schneiden kann. Vorher gab genau dieser
     * Verteidiger die Verfolgung auf und stellte stattdessen den Empfänger zu.
     */
    let nachsetzer = null;
    if (S.phase === 'pass') {
      let bestD = 1e9;
      for (const d of opps) {
        const dd = Math.hypot(ball.fx - d.fx, ball.fy - d.fy);
        if (dd < bestD) { bestD = dd; nachsetzer = d; }
      }
    }
    for (const d of opps) {
      let tx, ty, cap = 1.0;
      if (d.reaktRest > 0) {
        /* Reaktionszeit friert NICHT ein: er läuft auf das alte Ziel weiter. */
        d.reaktRest -= dt;
        tx = d.altZielFx; ty = d.altZielFy;
      } else if (S.phase === 'pass' && (isFinite(d.tInter) || d === nachsetzer)) {
        d.altZielFx = d.iFx; d.altZielFy = d.iFy;
        steuere(d, d.iFx, d.iFy, dt, 1.0, true);
        continue;
      } else if (S.phase === 'pass') {
        /* Kein Abfangen möglich: den Empfänger zustellen. */
        const ziel = S.pass && S.pass.receiver ? S.pass.receiver : carrier;
        tx = ziel.fx; ty = clamp(ziel.fy - DEF_GOALSIDE * 3, 2, FIELD_D - 2);
      } else if (d === presser) {
        tx = carrier.fx + carrier.vx * DEF_VORHALT_S;
        ty = carrier.fy + carrier.vy * DEF_VORHALT_S;
        if (pressD < DEF_BREMS_R) cap = DEF_BREMS_CAP;
      } else {
        const mark = d.mark && mates.indexOf(d.mark) >= 0 ? d.mark : carrier;
        const kette = clamp(carrier.fy - KETTE_VOR, KETTE_MIN, KETTE_MAX);
        tx = lerp(mark.fx, carrier.fx, DEF_BALL_BIAS);
        ty = clamp(Math.max(kette, lerp(mark.fy, carrier.fy, DEF_BALL_BIAS) - DEF_GOALSIDE * 4),
          2, FIELD_D - 2);
      }
      d.altZielFx = tx; d.altZielFy = ty;
      steuere(d, tx, clamp(ty, RAND_Y0, RAND_Y1), dt, cap);
    }
  }

  function stepKeeper(dt) {
    /* Grundstellung auf der Winkelhalbierenden Tor→Ball. */
    const bx = S.phase === 'pass' ? ball.fx : carrier.fx;
    const by = S.phase === 'pass' ? ball.fy : carrier.fy;
    const dx = bx - GOAL_CENTER.fx, dy = by - GOAL_CENTER.fy;
    const d = Math.hypot(dx, dy) || 1;
    const auslauf = clamp(TW_AUSLAUF_MIN + 0.09 * d, TW_AUSLAUF_MIN, TW_AUSLAUF_MAX);

    /* Herauslaufen: nur, wenn er mit TW_MARGE_S Vorsprung am Ball ist. */
    if (S.phase === 'pass' && isFinite(keeper.tInter)) {
      let tAngreifer = Infinity;
      if (isFinite(carrier.tInter)) tAngreifer = carrier.tInter;
      for (const a of mates) if (a.tInter < tAngreifer) tAngreifer = a.tInter;
      if (keeper.tInter < tAngreifer - TW_MARGE_S) {
        steuere(keeper, keeper.iFx, keeper.iFy, dt, 1.0, true);
        return;
      }
    }
    const tx = GOAL_CENTER.fx + dx / d * auslauf;
    const ty = GOAL_CENTER.fy + dy / d * auslauf;
    steuere(keeper, clamp(tx, 26, 42), clamp(ty, 1.2, 9), dt, 0.55);
  }

  /** Blickrichtung, Schrittphase und Pose — reine Anzeigedaten, aber billig. */
  function blickSchritt(a, dt) {
    const s = a.tempoNow;
    let ziel;
    if (s > 3.2) ziel = Math.atan2(a.vy, a.vx);
    else ziel = Math.atan2(ball.fy - a.fy, ball.fx - a.fx);
    a.blick += normWinkel(ziel - a.blick) * Math.min(1, dt * 9);
    if (s > 0.5) {
      const stride = clamp(1.35 + 0.38 * s, 1.5, 4.6);
      a.gang += s * dt / stride;
      if (a.gang > 1) a.gang -= Math.floor(a.gang);
    }
  }

  /* ====================================================================== *
   *  AKTIONEN
   * ====================================================================== */

  function finishScene(outcome, quality, targetPlayerId, xgDelta, banner, color, endart) {
    if (S.ergebnis) return;
    S.ergebnis = {
      outcome,
      quality: clamp(quality, 0, 1),
      targetPlayerId: targetPlayerId || null,
      xgDelta: clamp(xgDelta, XG_MIN, XG_MAX)
    };
    S.endart = endart;
    S.banner = banner;
    S.bannerColor = color || COL.gelb;
    S.phase = 'ergebnis';
    S.phaseT = 0;
    ball.live = false;
  }

  const mittel = (arr, fallback) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : fallback;

  /** Abschluss aus der aktuellen Situation heraus. */
  function shoot() {
    if (S.phase !== 'spiel') return;
    const danger = chanceValue(carrier);
    const avgQ = mittel(S.qualities, 0.35);
    const quality = clamp(0.22 + 0.45 * avgQ + 0.38 * danger, 0, 1);
    const xg = XG_MIN + danger * DANGER_XG_W + S.stations * STATION_XG_BONUS + quality * 0.14;
    stat.abschluss++;
    if (S.klang) S.klang('schuss');
    finishScene('abgeschlossen', quality,
      carrier.player && carrier.player.id ? carrier.player.id : null, xg,
      danger > 0.6 ? 'HERAUSGESPIELT!' : danger > 0.3 ? 'ABSCHLUSS!' : 'AUS DER DISTANZ …',
      danger > 0.5 ? COL.gruen : COL.gelb, 'abschluss');
  }

  /**
   * Pass auf den angewählten Mitspieler. HIER liegen die einzigen beiden
   * Zufallszüge des Abspiels — und zwar über die AUSFÜHRUNG, nicht über den
   * Ausgang: Winkelfehler und Abschussstärke. Ab hier entscheidet Geometrie.
   */
  function playPass(zielAkteur, typKey) {
    if (S.phase !== 'spiel') return false;
    const target = zielAkteur || S.selected;
    if (!target || target === carrier) return false;
    const typ = typKey || S.type;
    const spec = PASS_TYPES[typ] || PASS_TYPES.flach;

    zielpunkt(carrier, target, spec, _aim);
    const dx = _aim.fx - carrier.fx, dy = _aim.fy - carrier.fy;
    const d = Math.hypot(dx, dy);
    if (d < 0.4) return false;

    const skill = passKoennen(carrier.player);
    const sigma = AIM_SIGMA * (1 - AIM_SKILL_W * skill)
      * (1 + AIM_PRESSURE_W * pressure / 100) * spec.streuung;
    const winkelFehler = rng.gauss(0, sigma);
    const v0 = abschussTempo(spec, skill, d)
      * (1 + rng.gauss(0, V0_SIGMA * (1 - V0_SKILL_W * skill)));

    const winkel = Math.atan2(dy, dx) + winkelFehler;
    bahnVorbereiten(bahnRef, bahnBuf, carrier, winkel, Math.max(4, v0), spec, d);

    const linie = abseitslinie();
    const abseits = target.fy < linie && target.fy < carrier.fy;

    S.dangerBefore = chanceValue(carrier);
    S.pass = {
      passer: carrier,
      abgeber: carrier,
      receiver: target,
      type: typ,
      aim: { fx: _aim.fx, fy: _aim.fy },
      p: passChanceCache(carrier, target, typ),
      abseits,
      back: !!spec.rueck,
      /* Anbietepunkt des Passgebers beim Doppelpass — EINMAL festgelegt. */
      laufFx: carrier.fx,
      laufFy: Math.max(3, carrier.fy - DOPPEL_RUN),
      leg: 0
    };
    stat.paesse++;
    S.phase = 'pass';
    S.phaseT = 0;
    ball.live = true;
    if (S.klang) S.klang('schuss', { lautstaerke: 0.45, hoehe: 1.45 });

    /* Ausgang aus der Geometrie — einmal, beim diskreten Ereignis. */
    const aus = entscheideBall();
    S.pass.sieger = aus.sieger;
    S.pass.tEnde = aus.sieger ? aus.t : bahnRef.dauer + BALL_NACHFRIST_S;
    S.pass.duell = !!aus.duell;

    /* Gegner brauchen einen Moment, um auf den neuen Ballweg zu reagieren —
     * die Reaktionszeit kommt aus den Attributen, nicht aus der Passart.
     * Das betrifft nur ihr LAUFVERHALTEN; in `interceptZeit()` steckt die
     * Reaktion bereits als Zeitkosten. */
    for (const g of gegner) g.reaktRest = g.reakt;
    intercepteRechnen();
    return true;
  }

  /* Der Anzeigewert wird beim Abspiel einmal mitgeschrieben (nur Statistik). */
  function passChanceCache(from, to, typ) {
    const info = passChance(from, to, typ);
    return info.p;
  }

  /**
   * Der Ball ist bei einem eigenen Spieler angekommen.
   *
   * `gezielt` unterscheidet zwei sehr verschiedene Dinge, die vorher in einen
   * Topf fielen: den Pass, der SEINEN MANN gefunden hat, und den Ball, den
   * irgendein anderer Mitspieler nach einem verunglückten Zuspiel aufsammelt.
   * Der Kommentar an der Aufrufstelle sagte schon immer „Station zählt nicht" —
   * gezählt wurde sie trotzdem, samt Passquote und Zeitbonus. Der Angriff läuft
   * in beiden Fällen weiter, aber nur der erste ist ein angekommener Pass.
   */
  function passAngekommen(gezielt) {
    const pass = S.pass;
    const spec = PASS_TYPES[pass.type];

    /* Abseits wird VOR der Passquote geprüft. Ein Pass, der mit dem Banner
     * ABSEITS! als 'abgefangen' endet, ist kein angekommener Pass — der Ball
     * gehört danach dem Gegner. Solange `stat.paesseAn++` davor stand, meldete
     * der Prüfstand die Quote systematisch zu günstig (gemessen über 3000
     * Szenen: 70,65 % gegen ehrliche 66,13 %). */
    if (gezielt && pass.abseits) {
      stat.abseits++;
      finishScene('abgefangen', clamp(0.10 + 0.2 * mittel(S.qualities, 0.3), 0, 0.45),
        pass.receiver.player && pass.receiver.player.id ? pass.receiver.player.id : null,
        XG_MIN, 'ABSEITS!', COL.rot, 'abseits');
      return;
    }
    if (gezielt) stat.paesseAn++;

    const oldCarrier = carrier;
    if (pass.receiver !== carrier) {
      const idxNew = mates.indexOf(pass.receiver);
      if (idxNew >= 0) mates.splice(idxNew, 1);
      if (mates.indexOf(oldCarrier) < 0) mates.push(oldCarrier);
      oldCarrier.wpT = 0;
      carrier = pass.receiver;
      for (const d of opps) if (d.mark === carrier) d.mark = oldCarrier;
      alleNeu();
    }
    carrier.boost = pass.type === 'steil' ? 1.1 : 0.5;

    if (gezielt) {
      const dangerAfter = chanceValue(carrier);
      const gain = clamp((dangerAfter - S.dangerBefore) * 2.5 + 0.30, 0, 1);
      const q = clamp(0.20 + 0.45 * pass.p + 0.35 * gain, 0, 1)
        * clamp(0.85 + 0.15 * spec.reward, 0, 1.2);
      S.qualities.push(clamp(q, 0, 1));
      S.stations++;
      S.budget = Math.min(SCENE_MAX_S, S.budget + SCENE_STATION_BONUS_S);
      if (S.klang) S.klang('trommel', { lautstaerke: 0.6 });
    } else if (S.klang) {
      S.klang('raunen', { lautstaerke: 0.35 });
    }

    S.pass = null;
    ball.live = false;
    S.phase = 'spiel';
    S.phaseT = 0;

    if (S.stations >= MAX_STATIONS) { shoot(); return; }
    for (const mate of mates) mate.wpT = 0;
    S.selected = mates[0];
  }

  /** Der Ball ist weg — Fehlpass, abgefangen oder versprungen. */
  function passVerloren(text, endart) {
    const q = clamp(0.10 + 0.22 * mittel(S.qualities, 0.3), 0, 0.45);
    if (endart === 'zweikampf') stat.zweikaempfeVerloren++;
    else stat.fehlpass++;
    if (S.klang) S.klang('raunen', { lautstaerke: 0.8 });
    const ziel = S.pass && S.pass.receiver && S.pass.receiver.player;
    finishScene('abgefangen', q, ziel && ziel.id ? ziel.id : null,
      XG_MIN + q * 0.08, text || 'ABGEFANGEN!', COL.rot, endart || 'fehlpass');
  }

  /** Zeit abgelaufen: freistehend wird noch abgeschlossen, sonst ist der Ball weg. */
  function timeUp() {
    const danger = chanceValue(carrier);
    const free = nearestOppDist(carrier);
    if (free > 5.5 && danger > 0.32) { shoot(); return; }
    stat.zeit++;
    if (S.klang) S.klang('raunen', { lautstaerke: 0.9 });
    finishScene('abgefangen', clamp(0.08 + 0.2 * mittel(S.qualities, 0.25), 0, 0.4),
      carrier.player && carrier.player.id ? carrier.player.id : null,
      XG_MIN, 'ZU LANGE GEZÖGERT!', COL.rot, 'zeit');
  }

  /**
   * Zweikampf am Ball. GENAU EIN rng-Zug, ausgelöst durch ein diskretes
   * Ereignis (zwei Akteure innerhalb DUELL_FENSTER am Ball) — niemals im
   * Teilschritt-Loop, sonst hinge die Zahl der Züge an der Bildrate.
   */
  function duell(a, b, vorsprung) {
    stat.zweikaempfe++;
    const za = clamp(a.zweikampf / 99, 0, 1), zb = clamp(b.zweikampf / 99, 0, 1);
    const zeit = clamp((vorsprung || 0) / DUELL_FENSTER, 0, 1);
    const p = clamp(DUELL_BALL_BASIS + DUELL_SPREIZUNG * (za - zb) + DUELL_ZEIT_W * zeit,
      0.12, 0.94);
    return rng.chance(p);
  }

  /* ====================================================================== *
   *  KONTAKT UND PHASENLOGIK
   * ====================================================================== */

  /**
   * Der beim Abspiel bestimmte Zeitpunkt ist erreicht: der Ball wechselt den
   * Besitzer — aber NUR, wenn der Sieger wirklich am Ball ist.
   *
   * `entscheideBall()` legt fest, WER den Ball bekommt; `interceptZeit()`
   * liefert dazu den FRÜHESTEN Zeitpunkt, zu dem er ihn erreichen KANN. Das
   * ist eine Vorhersage aus einem idealisierten Sprintmodell — der tatsächlich
   * gelaufene Weg entsteht Teilschritt für Teilschritt in `steuere()` und
   * hinkt ihr regelmäßig hinterher.
   *
   * Umbauplan Punkt 8 sagt dazu wörtlich: „Teleport streichen: der Empfänger
   * läuft." Hier wurde der Sieger früher trotzdem an den Ball gezogen
   * (`sieger.fx += dx·f`) — gemessen über 1500 Szenen sprang er dabei in 1124
   * Fällen weiter als 0,15 m in EINEM Teilschritt, in 798 Fällen weiter als
   * 1,00 m, im Extremfall 17,72 m quer über den halben Strafraum.
   *
   * Es wird nicht mehr nachgerückt, und `pass.tEnde` ist keine Schranke mehr:
   * der Kontakt fällt, WENN der Ball wirklich in Spielreichweite ist — je
   * Teilschritt aus den echten Positionen geprüft. Das ist dieselbe
   * Entscheidung wie vorher, nur ohne die Lücke dazwischen. Gemessen über
   * 600 Szenen lag der Ball zum vorhergesagten `tEnde` im Median 1,97 m vom
   * Sieger entfernt, im Verlauf des Passes aber 0,93 m — die Vorhersage trifft
   * den ORT gut und den ZEITPUNKT schlecht. Wer ihr den Zeitpunkt glaubt,
   * braucht hinterher einen Teleport, um das geradezuziehen.
   *
   * Erreicht niemand den Ball, beendet die Notbremse in `teilschritt()` den
   * Pass nach Bahn plus BALL_NACHFRIST_S als ehrlichen Fehlpass — der Ball
   * läuft eben durch. `pass.tEnde` wird nur noch mitgeschrieben, damit der
   * Vorhersagezeitpunkt für den Prüfstand sichtbar bleibt; als Schranke dient
   * er nicht mehr.
   */
  function inReichweite(a) {
    if (Math.hypot(ball.fx - a.fx, ball.fy - a.fy) > PLAY_REACH) return false;
    return ball.z <= Z_SPRUNG_BASIS + Z_SPRUNG_SPANNE * clamp(a.sprung / 99, 0, 1);
  }

  /**
   * Wer ist JETZT wirklich am Ball? Reine Geometrie, kein Zufall.
   *
   * DIE VORHERSAGE IST KEIN BESITZANSPRUCH. Solange ausschliesslich der beim
   * Abspiel bestimmte Sieger geprüft wurde, rollte der Ball an jedem anderen
   * vorbei: ein Verteidiger, der mitten auf der Bahn stand, aber nicht der
   * Schnellste war, liess ihn durch die Beine laufen, und die Szene endete mit
   * „INS AUS!". Der Anspruch des Siegers gilt deshalb nur, SOLANGE das Modell
   * ihn trägt — `intercepteRechnen()` rechnet seine Ankunftszeit im 60-Hz-
   * Raster nach. Kann er die Bahn nicht mehr schneiden, ist der Ball frei.
   *
   * Das kostet KEINEN zusätzlichen rng-Zug: der Zweikampf ist beim Abspiel
   * bereits ausgewürfelt. Die Zahl der Züge hängt weiterhin nicht an der
   * Bildrate.
   */
  function amBall(pass) {
    const sperre = S.phaseT < KONTAKT_SPERRE_S;
    const sieger = pass.sieger;
    if (sieger && !(sperre && sieger === pass.abgeber) && inReichweite(sieger)) return sieger;
    if (sieger && isFinite(sieger.tInter)) return null;
    let best = null, bestD = PLAY_REACH;
    for (const a of alle) {
      if (sperre && a === pass.abgeber) continue;
      if (!inReichweite(a)) continue;
      const d = Math.hypot(ball.fx - a.fx, ball.fy - a.fy);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  function kontakteRegeln() {
    const pass = S.pass;
    if (!pass) return;

    const sieger = amBall(pass);
    if (!sieger) return;

    if (sieger.seite === 'gegner') {
      /* „Zweikampf verloren" heisst: der beim Abspiel ausgewürfelte Zweikampf
       * hat den Ausgang gedreht. Wer den Ball nur aufsammelt, hat abgefangen. */
      if (pass.duell && sieger === pass.sieger) passVerloren('ZWEIKAMPF VERLOREN!', 'zweikampf');
      else passVerloren('ABGEFANGEN!', 'fehlpass');
      return;
    }

    /* Eigener Spieler am Ball. */
    if (pass.back && pass.leg === 0 && sieger === pass.receiver) {
      /* Wand gespielt: sofortiger Rückpass in den Lauf des Passgebers. */
      const spec = PASS_TYPES.doppelpass;
      const skill = passKoennen(sieger.player);
      const v0 = abschussTempo(spec, skill,
        Math.hypot(pass.passer.fx - sieger.fx, pass.passer.fy - sieger.fy));
      rueckZiel(sieger.fx, sieger.fy, pass.passer.fx, pass.passer.fy,
        pass.passer.vx, pass.passer.vy, v0, _aim2);
      const dx = _aim2.fx - sieger.fx, dy = _aim2.fy - sieger.fy;
      const d = Math.hypot(dx, dy);
      bahnVorbereiten(bahnRef, bahnBuf, sieger, Math.atan2(dy, dx), Math.max(4, v0), spec, d);
      pass.leg = 1;
      pass.abgeber = sieger;
      pass.receiver = pass.passer;
      pass.aim.fx = _aim2.fx; pass.aim.fy = _aim2.fy;
      S.phaseT = 0;
      const aus = entscheideBall();
      pass.sieger = aus.sieger;
      pass.tEnde = aus.sieger ? aus.t : bahnRef.dauer + BALL_NACHFRIST_S;
      pass.duell = !!aus.duell;
      for (const g of gegner) g.reaktRest = g.reakt * 0.6;
      intercepteRechnen();
      return;
    }

    if (sieger === pass.receiver) { passAngekommen(true); return; }
    /* Ein anderer eigener Spieler klärt die Situation — der Ball bleibt in den
     * eigenen Reihen, aber der PASS hat seinen Mann nicht gefunden: keine
     * Station, keine Passquote, kein Zeitbonus. */
    pass.receiver = sieger;
    passAngekommen(false);
  }

  /**
   * Zweikampf um den Ballführenden während der Spielphase.
   *
   * Der Wurf fällt genau EINMAL je Annäherung: `d.duellAn` wird gesetzt, wenn
   * der Verteidiger in den Zweikampfradius kommt, und erst wieder gelöscht,
   * wenn er ihn verlassen hat. Ohne diese Hysterese würfelte die Szene bei
   * jedem Teilschritt neu — und die Zahl der Würfe hinge doch wieder an der
   * Bildrate, was diese Datei gerade abschaffen soll.
   */
  function carryDuell() {
    /* Nur der nächste Gegner greift an. Vier gleichzeitig angreifende
     * Verteidiger sind kein Zweikampf, sondern eine Traube — und sie machen aus
     * vier harmlosen Annäherungen einen fast sicheren Ballverlust. */
    let presser = null, pressD = 1e9;
    for (const d of opps) {
      const dd = dist(d, carrier);
      if (dd > DUELL_LOESE_R) d.duellAn = false;
      if (dd < pressD) { pressD = dd; presser = d; }
    }
    for (const d of presser ? [presser] : []) {
      const dd = pressD;
      if (dd > DUELL_R || d.duellAn || d.reaktRest > 0) continue;
      d.duellAn = true;
      stat.zweikaempfe++;
      const za = clamp(carrier.zweikampf / 99, 0, 1) * 0.55
        + clamp(att(carrier.player, 'dribbling') / 99, 0, 1) * 0.45;
      const zb = clamp(d.zweikampf / 99, 0, 1);
      const p = clamp(DUELL_CARRY_BASIS + DUELL_SPREIZUNG * (za - zb), 0.25, 0.96);
      if (!rng.chance(p)) {
        stat.zweikaempfeVerloren++;
        if (S.klang) S.klang('raunen', { lautstaerke: 0.85 });
        finishScene('abgefangen', clamp(0.08 + 0.2 * mittel(S.qualities, 0.25), 0, 0.42),
          carrier.player && carrier.player.id ? carrier.player.id : null,
          XG_MIN, 'ZWEIKAMPF VERLOREN!', COL.rot, 'zweikampf');
      }
      return;
    }
  }

  /* ====================================================================== *
   *  TEILSCHRITT
   * ====================================================================== */

  function teilschritt() {
    const dt = PHYS_STEP;
    S.t += dt;
    S.phaseT += dt;

    if (S.phase === 'ergebnis') {
      if (S.phaseT >= 1.2) S.fertig = true;
      return;
    }

    /* Ball: in der Passphase Tabellenwert, sonst am Fuß des Ballführenden. */
    if (S.phase === 'pass') {
      const t = Math.min(S.phaseT, bahnRef.dauer);
      bahnAt(bahnRef, t, _bp);
      ball.fx = _bp.fx; ball.fy = _bp.fy; ball.z = _bp.z;
    } else {
      ball.fx = carrier.fx + carrier.vx * 0.06;
      ball.fy = carrier.fy + carrier.vy * 0.06;
      ball.z = 0;
    }

    /* interceptZeit auf festem 60-Hz-Raster, NUR während der Passphase. */
    rasterZ++;
    if (S.phase === 'pass' && rasterZ >= RASTER_JEDER) { rasterZ = 0; intercepteRechnen(); }

    S.markT -= dt;
    if (S.markT <= 0) { S.markT = MARK_REPICK_S; markZuordnen(); }

    for (const a of alle) ausdauerSchritt(a, dt);
    stepMates(dt);
    stepCarrier(dt);
    stepOpps(dt);
    stepKeeper(dt);
    for (const a of alle) blickSchritt(a, dt);

    if (S.phase === 'pass') {
      kontakteRegeln();
      /* Notbremse: sollte der Übergabezeitpunkt aus irgendeinem Grund nicht
       * greifen, endet der Pass spätestens nach Bahn plus Nachfrist. */
      if (S.phase === 'pass' && S.phaseT >= bahnRef.dauer + BALL_NACHFRIST_S + PHYS_STEP) {
        const b = bahnRef.buf, i = (bahnRef.n - 1) * 3;
        const raus = b[i] < 0.2 || b[i] > FIELD_W - 0.2 || b[i + 1] < 0.2 || b[i + 1] > FIELD_D - 0.2;
        passVerloren(raus ? 'INS AUS!' : 'PASS VERSPRUNGEN!', 'fehlpass');
      }
    } else if (S.phase === 'spiel') {
      carryDuell();
      if (S.phase === 'spiel' && S.t >= S.budget) timeUp();
    }
  }

  /* ====================================================================== *
   *  ÖFFENTLICHE SCHNITTSTELLE
   * ====================================================================== */

  let akku = 0;

  const szene = {
    /* Zustand (lesend für den Renderer) */
    S, stat, ball, mates, opps, gegner, keeper, alle,
    get carrier() { return carrier; },
    get passer() { return passer0; },
    bahnRef, vorRef,
    PASS_TYPES, TYPE_ORDER,
    /** Optionale Regie (Prüfstand). Läuft auf dem festen Raster, nie je Frame. */
    regie: null,

    /** Frame-Schritt mit Akkumulator; dt wird auf 0,05 s geklemmt. */
    schritt(dt) {
      akku += clamp(dt, 0, 0.05);
      let n = 0;
      while (akku >= PHYS_STEP && n < 24) {
        akku -= PHYS_STEP;
        n++;
        if (szene.regie) {
          regieZ++;
          if (regieZ >= REGIE_JEDER) { regieZ = 0; szene.regie(szene); }
        }
        teilschritt();
        if (S.fertig) break;
      }
      return !!S.fertig;
    },

    passSpielen(ziel, typ) { return playPass(ziel, typ); },
    abschliessen() { shoot(); },
    passChance,
    chanceValue,
    nearestOppDist,
    abseitslinie,
    zielpunkt(from, to, spec, out) { return zielpunkt(from, to, spec, out || { fx: 0, fy: 0 }); },
    waehle(a) { if (a) S.selected = a; },
    setzeTyp(t) { if (PASS_TYPES[t]) S.type = t; },
    setzeKlang(fn) { S.klang = fn; },
    abbruchErgebnis() {
      return S.ergebnis || {
        outcome: 'abgefangen', quality: 0.2,
        targetPlayerId: carrier.player && carrier.player.id ? carrier.player.id : null,
        xgDelta: -0.05
      };
    }
  };
  S.ergebnis = null;
  S.fertig = false;
  S.endart = null;
  S.klang = null;
  return szene;
}

/* ========================================================================== *
 *  PRÜFEXPORT (Vertrag §9: additiv, DOM-frei, rng nur als Parameter)
 * ========================================================================== */

export const modell = {
  erzeugeSzene,
  bahnBauen,
  passKoennen,
  hash01,
  /* Die dreistufige Angabe der Passlinie — das ist ab jetzt das, was der
     Spieler sieht, und deshalb das, was der Prüfstand nachrechnen muss. */
  passStufe,
  P_GOOD,
  P_OK,
  PASS_TYPES,
  PHYS_STEP,
  PLAY_REACH,
  INTER_PROBEN,
  BAHN_TMAX,
  FIELD_W,
  FIELD_D,
  MAX_STATIONS
};

/* ========================================================================== *
 *  MINISPIEL (Bildschirmseite)
 * ========================================================================== */

export const minigame = {
  id: 'kombination',
  kind: 'kombination',
  title: 'Kombination',
  instructions:
    'Maus oder [1]-[5] wählt den Mitspieler · [F] flach · [S] steil · [C] Chip · [D] Doppelpass · ' +
    'Klick = Pass · [Leertaste] = selbst abschließen · [ESC] Simulation entscheiden lassen',

  async play(host, moment) {
    const canvas = host && host.canvas;
    const ctx = (host && host.ctx) || (canvas && canvas.getContext && canvas.getContext('2d'));
    if (!canvas || !ctx) {
      console.warn('[kombination] Kein Canvas/Kontext übergeben – Minispiel wird übersprungen.');
      return null;
    }

    const m = moment || {};
    const actor = m.actor || null;
    const context = m.context || {};
    const score = Array.isArray(context.score) ? context.score : [0, 0];
    const minute = typeof m.minute === 'number' ? m.minute : (context.minute || 0);

    // Eigene RNG – fork() lässt den Zustand der Eltern-RNG unangetastet, damit
    // die Simulation trotz variabler Frame-Zahl deterministisch bleibt.
    const rng = (host.rng && typeof host.rng.fork === 'function')
      ? host.rng.fork('minigame:kombination:' + (actor && actor.id ? actor.id : '?'))
      : (host.rng || { next: () => 0.5, gauss: () => 0, chance: () => false });

    const diff = clamp((host.difficulty && host.difficulty.minigame) || 1, 0.4, 2);
    // Klangnamen aus dem Vertrag von render/sound.js. Der zweite Parameter geht
    // unverändert an die Klangbank durch ({ lautstaerke, hoehe, panorama }).
    const sfx = (n, o) => { try { if (typeof host.sound === 'function') host.sound(n, o); } catch (e) { /* egal */ } };

    const szene = erzeugeSzene({ moment: m, rng, difficulty: diff });
    szene.setzeKlang(sfx);
    const S = szene.S;
    const mates = szene.mates;
    const ball = szene.ball;

    /* Vereinsfarben aus dem Stadionkontext (Paket 2 reicht sie durch) —
       defensiv abgesichert, das Feld darf fehlen. */
    const farben = context.farben || null;
    const heimSeite = m.team !== 'away';
    const eigen = farben ? (heimSeite ? farben.heim : farben.gast) : null;
    const fremd = farben ? (heimSeite ? farben.gast : farben.heim) : null;
    const COL_EIGEN = (eigen && eigen.primary) || COL.blau;
    const COL_FREMD = (fremd && fremd.primary) || COL.rot;
    const COL_RANG = (eigen && eigen.secondary) || COL.beige;

    /* Knopfbeschriftungen einmal bauen statt je Frame. */
    const TYP_LABEL = {};
    for (const key of TYPE_ORDER) TYP_LABEL[key] = `[${PASS_TYPES[key].key}] ${PASS_TYPES[key].name}`;

    const zeichnePlayer = typeof host.drawPlayer === 'function' ? host.drawPlayer : null;
    /** Sichtbare Körpergröße; wie in pitch.js bewusst überhöht (Lesbarkeit). */
    const SPRITE_SCALE = clamp(PPM * 2.6 / 47, 0.4, 1.4);
    let spriteKaputt = false;

    /* ====================================================================== *
     *  ZEICHNEN
     * ====================================================================== */

    function drawRaenge() {
      /* Drei Rangstufen hinter dem Tor, nach hinten dunkler — dieselbe
         Bildsprache wie die Ränge in render/pitch.js. */
      const y0 = 40, y1 = toY(0) - 10;
      const h = (y1 - y0) / 3;
      const stufen = [COL.rangC, COL.rangB, COL.rangA];
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = stufen[i];
        ctx.fillRect(0, y0 + i * h, CANVAS_W, h + 0.5);
        /* Zuschauertupfer in den Vereinsfarben, deterministisch gesetzt. */
        for (let j = 0; j < 90; j++) {
          const r = hash01(i * 97 + j, 11);
          ctx.fillStyle = r < 0.5 ? COL_RANG : COL_EIGEN;
          ctx.globalAlpha = 0.18 + 0.22 * (i / 2);
          ctx.fillRect(hash01(j, i * 7 + 3) * CANVAS_W, y0 + i * h + hash01(j, i + 41) * h, 3, 3);
        }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, y1 - 4, CANVAS_W, 4);
    }

    function drawPitch() {
      const x0 = toX(0), y0 = toY(0), w = FIELD_W * PPM, h = FIELD_D * PPM;
      ctx.fillStyle = COL.rasenRand;
      ctx.fillRect(0, toY(0) - 10, CANVAS_W, CANVAS_H - (toY(0) - 10));
      // Mähstreifen quer zur Spielrichtung, wie render/pitch.js
      const streifen = 12;
      const sw = CANVAS_W / streifen;
      for (let i = 0; i < streifen; i++) {
        ctx.fillStyle = i % 2 ? COL.rasen : COL.rasenDunkel;
        ctx.fillRect(i * sw, toY(0) - 10, sw + 0.5, CANVAS_H - (toY(0) - 10));
      }
      ctx.strokeStyle = COL.linie;
      ctx.lineWidth = 3;
      ctx.strokeRect(x0, y0, w, h);
      ctx.strokeRect(toX(13.84), y0, (54.16 - 13.84) * PPM, 16.5 * PPM);
      ctx.strokeRect(toX(24.84), y0, (43.16 - 24.84) * PPM, 5.5 * PPM);
      ctx.fillStyle = COL.linie;
      ctx.beginPath(); ctx.arc(toX(34), toY(11), 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.arc(toX(34), toY(11), 9.15 * PPM, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
      // Tor mit Netz
      const gx0 = toX(30.34), gx1 = toX(37.66), gy = y0, gd = 2.2 * PPM;
      ctx.fillStyle = 'rgba(12,20,26,0.5)';
      ctx.fillRect(gx0, gy - gd, gx1 - gx0, gd);
      ctx.strokeStyle = 'rgba(240,245,246,0.5)'; ctx.lineWidth = 1.4;
      for (let i = 0; i <= 8; i++) {
        const x = lerp(gx0, gx1, i / 8);
        ctx.beginPath(); ctx.moveTo(x, gy - gd); ctx.lineTo(x, gy); ctx.stroke();
      }
      for (let j = 0; j <= 3; j++) {
        const y = lerp(gy - gd, gy, j / 3);
        ctx.beginPath(); ctx.moveTo(gx0, y); ctx.lineTo(gx1, y); ctx.stroke();
      }
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(gx0, gy); ctx.lineTo(gx0, gy - gd);
      ctx.moveTo(gx1, gy); ctx.lineTo(gx1, gy - gd);
      ctx.moveTo(gx0, gy - gd); ctx.lineTo(gx1, gy - gd); ctx.stroke();
      ctx.strokeStyle = COL.linie; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(gx0, gy); ctx.lineTo(gx0, gy - gd);
      ctx.moveTo(gx1, gy); ctx.lineTo(gx1, gy - gd);
      ctx.moveTo(gx0, gy - gd); ctx.lineTo(gx1, gy - gd); ctx.stroke();
    }

    function drawAbseits() {
      const linie = szene.abseitslinie();
      if (linie >= FIELD_D - 0.5) return;
      const y = toY(linie);
      const gefahr = S.selected && S.selected.fy < linie;
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = gefahr ? COL.gelb : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = gefahr ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(toX(0), y); ctx.lineTo(toX(FIELD_W), y); ctx.stroke();
      ctx.restore();
    }

    function text(str, x, y, color, size, align) {
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      ctx.textAlign = align || 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = Math.max(2.5, size * 0.26); ctx.lineJoin = 'round';
      ctx.strokeStyle = COL.outline; ctx.strokeText(str, x, y);
      ctx.fillStyle = color; ctx.fillText(str, x, y);
    }
    const label = (str, x, y, color, size = 12) => text(str, x, y, color, size, 'center');

    /** Notfall-Scheibe, falls host.drawPlayer fehlt oder wirft. */
    function scheibe(x, y, r, fill, ring) {
      ctx.save();
      ctx.globalAlpha = 0.32; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.5, r * 1.05, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = COL.outline; ctx.stroke();
      if (ring) {
        ctx.lineWidth = 3.5; ctx.strokeStyle = ring;
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke();
      }
    }

    /**
     * Spielersprite wie in der Vogelperspektive (Nachtrag §3): dieselbe
     * `drawPlayer`-Figur, Bodenschatten kommt aus render/players.js.
     */
    function figur(a, farbe, ring, ringR) {
      const x = toX(a.fx), y = toY(a.fy);
      if (ring) {
        ctx.strokeStyle = ring; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(x, y + 3, ringR || 15, (ringR || 15) * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (!zeichnePlayer || spriteKaputt || !a.player) {
        scheibe(x, y - 8, 11, farbe, null);
        return;
      }
      try {
        zeichnePlayer(ctx, a.player, x, y, SPRITE_SCALE, {
          teamColor: farbe,
          pose: a.tempoNow > 0.6 ? 'lauf' : 'stand',
          dir: Math.cos(a.blick) >= 0 ? 1 : -1,
          frame: a.gang,
          /* Draufsicht: Schrittweite mit dem Tempo, Breite mit der Blickrichtung.
             Beides sind additive Zusatzangaben aus render/players.js. */
          gait: clamp(0.5 + a.tempoNow / 9, 0.5, 1.35),
          yaw: a.blick
        });
      } catch (err) {
        spriteKaputt = true;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('interactive/combination.js: drawPlayer() nicht nutzbar, Scheiben aktiv.', err);
        }
      }
    }

    function drawHoefe() {
      /* Der rote Hof ist die echte Spielreichweite aus dem Modell (PLAY_REACH),
         nicht mehr ein frei gewählter „Deckungsschatten". */
      const hof = PLAY_REACH * PPM;
      for (const o of szene.opps) {
        ctx.beginPath();
        ctx.arc(toX(o.fx), toY(o.fy), hof, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(193,39,45,0.10)'; ctx.fill();
        ctx.strokeStyle = 'rgba(193,39,45,0.30)'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    /* Persistente Zeichenliste — in der rAF-Schleife wird nichts alloziert. */
    const zeichenListe = [];

    function drawFiguren() {
      const carrier = szene.carrier;
      zeichenListe.length = 0;
      for (const a of szene.alle) zeichenListe.push(a);
      /* Von hinten nach vorn, sonst überdeckt ein weiter oben stehender Spieler
         den vor ihm — dieselbe Regel wie in render/pitch.js. */
      zeichenListe.sort((a, b) => a.fy - b.fy);

      for (const a of zeichenListe) {
        const x = toX(a.fx), y = toY(a.fy);
        if (a === szene.keeper) {
          figur(a, '#f0a020', null, 0);
          label('TW', x, y + 13, COL.gelb, 11);
          continue;
        }
        if (a.seite === 'gegner') {
          figur(a, COL_FREMD, null, 0);
          if (a.player && a.player.number) label(String(a.player.number), x, y + 13, COL.papier, 11);
          continue;
        }
        if (a === carrier) {
          figur(a, COL_EIGEN, COL.papier, 17);
          label(nameOf(a.player, 'Ballführend'), x, y + 27, COL.papier, 12);
          continue;
        }
        const i = mates.indexOf(a);
        const sel = a === S.selected;
        figur(a, COL_EIGEN, sel ? COL.gelb : null, 15);
        if (i >= 0) label(String(i + 1), x, y + 13, COL.papier, 12);
        label(nameOf(a.player, 'Mitspieler'), x, y + 27, sel ? COL.gelb : COL.papier, 11);
      }
    }

    function drawPassLine() {
      if (S.phase !== 'spiel' || !S.selected) return;
      const carrier = szene.carrier;
      const info = szene.passChance(carrier, S.selected, S.type);
      const spec = szene.PASS_TYPES[S.type];
      const ax = toX(carrier.fx), ay = toY(carrier.fy);
      const bx = toX(info.aim.fx), by = toY(info.aim.fy);
      const col = info.p >= P_GOOD ? COL.gruen : info.p >= P_OK ? COL.gelb : COL.rot;

      ctx.save();
      ctx.lineCap = 'round';
      if (spec.hoch) ctx.setLineDash([12, 8]);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]);

      const ang = Math.atan2(by - ay, bx - ax);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - Math.cos(ang - 0.4) * 18, by - Math.sin(ang - 0.4) * 18);
      ctx.lineTo(bx - Math.cos(ang + 0.4) * 18, by - Math.sin(ang + 0.4) * 18);
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = COL.outline; ctx.stroke();

      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      /* Dreistufige Angabe statt Prozentzahl — Begründung bei P_GOOD/P_OK. */
      const txt = passStufe(info.p);
      ctx.font = 'bold 15px system-ui, sans-serif';
      const w = ctx.measureText(txt).width + 14;
      ctx.fillStyle = COL.dunkel; ctx.fillRect(mx - w / 2, my - 12, w, 22);
      ctx.lineWidth = 2; ctx.strokeStyle = COL.outline;
      ctx.strokeRect(mx - w / 2, my - 12, w, 22);
      label(txt, mx, my + 4, col, 15);
      ctx.restore();
    }

    /**
     * Ball mit echter Höhe: der Schatten bleibt am Boden, der Ball hebt ab und
     * wird größer — dieselbe Konvention, die Paket 3 für pitch.js festlegt.
     */
    function drawBall() {
      if (!ball.live && S.phase !== 'spiel') return;
      const x = toX(ball.fx), y = toY(ball.fy);
      const z = Math.max(0, ball.z);
      const lift = 9 * z / (1 + z / 12);
      const r = Math.max(3.4, 5.0 * (1 + z * 0.10));
      ctx.save();
      ctx.globalAlpha = 0.38 / (1 + z * 0.30); ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x + 1.4, y + 1.0, 5.0 * (0.95 + z * 0.10), 5.0 * (0.50 + z * 0.055), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(x, y - lift, r, 0, Math.PI * 2);
      ctx.fillStyle = COL.papier; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = COL.outline; ctx.stroke();
    }

    /**
     * Auswahlknopf einer Passart. Label und Beschreibung wurden früher an
     * dieselbe Stelle gezeichnet und überlagerten sich unlesbar — jetzt wird
     * mit `measureText` getrennt: eine Zeile, wenn beides nebeneinander passt,
     * sonst zwei Zeilen mit kleinerer Beschreibung.
     */
    function drawTypButton(spec, labelTxt, x, y, w, h, active) {
      ctx.fillStyle = active ? COL.beige : '#2b3543';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = active ? COL.gelb : COL.outline;
      ctx.lineWidth = active ? 3 : 2;
      ctx.strokeRect(x, y, w, h);

      const descTxt = spec.desc;
      const labelCol = active ? COL.outline : COL.papier;
      const descCol = active ? '#5a4a2a' : '#9fb0c2';
      const pad = 9;

      ctx.font = 'bold 14px system-ui, sans-serif';
      const wLabel = ctx.measureText(labelTxt).width;
      ctx.font = 'bold 11px system-ui, sans-serif';
      const wDesc = ctx.measureText(descTxt).width;

      if (wLabel + wDesc + pad * 3 <= w) {
        text(labelTxt, x + pad, y + h * 0.66, labelCol, 14, 'left');
        text(descTxt, x + w - pad, y + h * 0.66, descCol, 11, 'right');
      } else {
        text(labelTxt, x + pad, y + 15, labelCol, 14, 'left');
        text(descTxt, x + pad, y + 28, descCol, 11, 'left');
      }
    }

    function drawHud() {
      const carrier = szene.carrier;
      ctx.fillStyle = COL.dunkel; ctx.fillRect(0, 0, CANVAS_W, 40);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 38, CANVAS_W, 2);
      label(nameOf(carrier.player, 'Ballführend').toUpperCase(), 90, 27, COL.gelb, 18);
      label(`${minute}. MINUTE`, 400, 27, COL.papier, 16);
      label(`STAND  ${score[0]} : ${score[1]}`, 570, 27, COL.papier, 16);
      label(String(context.competition || ''), 830, 27, COL.hellblau, 14);

      const danger = szene.chanceValue(carrier);
      ctx.fillStyle = COL.dunkel; ctx.fillRect(CANVAS_W - 232, 46, 220, 46);
      ctx.lineWidth = 2; ctx.strokeStyle = COL.outline;
      ctx.strokeRect(CANVAS_W - 232, 46, 220, 46);
      label(`STATION ${S.stations} / ${MAX_STATIONS}`, CANVAS_W - 122, 64, COL.papier, 14);
      const bw = 190;
      ctx.fillStyle = '#2b3543'; ctx.fillRect(CANVAS_W - 217, 70, bw, 14);
      ctx.fillStyle = danger > 0.6 ? COL.gruen : danger > 0.32 ? COL.gelb : COL.rot;
      ctx.fillRect(CANVAS_W - 217, 70, bw * danger, 14);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2;
      ctx.strokeRect(CANVAS_W - 217, 70, bw, 14);
      label('GEFAHR', CANVAS_W - 122, 82, COL.outline, 11);

      const rest = clamp(1 - S.t / S.budget, 0, 1);
      ctx.fillStyle = COL.dunkel; ctx.fillRect(12, 46, 220, 30);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(12, 46, 220, 30);
      ctx.fillStyle = '#2b3543'; ctx.fillRect(20, 54, 204, 14);
      ctx.fillStyle = rest > 0.4 ? COL.gruen : rest > 0.18 ? COL.gelb : COL.rot;
      ctx.fillRect(20, 54, 204 * rest, 14);
      ctx.strokeStyle = COL.outline; ctx.strokeRect(20, 54, 204, 14);
      label('ZEIT', 122, 66, COL.outline, 11);

      // Fußzeile: Passarten
      const fh = 62;
      ctx.fillStyle = COL.dunkel; ctx.fillRect(0, CANVAS_H - fh, CANVAS_W, fh);
      let x = 14;
      const bwid = 210, bhi = 34;
      for (const key of TYPE_ORDER) {
        drawTypButton(PASS_TYPES[key], TYP_LABEL[key], x, CANVAS_H - fh + 4, bwid, bhi, S.type === key);
        x += bwid + 12;
      }
      label('Maus/[1]-[5] wählen · Klick = Pass · [Leertaste] abschließen · [ESC] Simulation',
        CANVAS_W / 2, CANVAS_H - 6, '#b9c4d2', 12);
    }

    function drawBanner() {
      if (!S.banner) return;
      const w = 560, h = 76, x = (CANVAS_W - w) / 2, y = 210;
      ctx.fillStyle = COL.beige; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
      ctx.lineWidth = 3; ctx.strokeStyle = COL.outline;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.font = 'bold 34px "Arial Black", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.strokeStyle = COL.outline;
      ctx.strokeText(S.banner, CANVAS_W / 2, y + 50);
      ctx.fillStyle = S.bannerColor;
      ctx.fillText(S.banner, CANVAS_W / 2, y + 50);
    }

    function render() {
      ctx.save();
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawRaenge();
      drawPitch();
      drawAbseits();
      drawHoefe();
      drawPassLine();
      drawFiguren();
      drawBall();
      drawHud();
      drawBanner();
      ctx.restore();
    }

    /* ====================================================================== *
     *  EINGABE / SCHLEIFE
     * ====================================================================== */

    return new Promise((resolve) => {
      let done = false, rafId = 0, watchdog = 0, lastTs = 0;
      const bound = [];
      const prevCursor = canvas.style.cursor;

      function on(target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        bound.push([target, type, fn, opts]);
      }
      function cleanup() {
        if (rafId) cancelAnimationFrame(rafId);
        if (watchdog) clearTimeout(watchdog);
        for (const [t, ty, fn, o] of bound) t.removeEventListener(ty, fn, o);
        bound.length = 0;
        canvas.style.cursor = prevCursor;
      }
      function settle(res) {
        if (done) return;
        done = true;
        cleanup();
        resolve(res);
      }

      function pointerPos(ev) {
        const r = canvas.getBoundingClientRect();
        const sx = canvas.width / (r.width || canvas.width);
        const sy = canvas.height / (r.height || canvas.height);
        return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
      }

      on(canvas, 'mousemove', (ev) => {
        const p = pointerPos(ev);
        let best = null, bestD = 1e9;
        for (const mate of mates) {
          const d = Math.hypot(toX(mate.fx) - p.x, toY(mate.fy) - p.y);
          if (d < bestD) { bestD = d; best = mate; }
        }
        if (best) szene.waehle(best);
      });

      on(canvas, 'mousedown', (ev) => { ev.preventDefault(); szene.passSpielen(S.selected, S.type); });

      on(window, 'keydown', (ev) => {
        const k = ev.key;
        if (k === 'Escape') { settle(null); return; }
        if (S.phase !== 'spiel') return;
        const lower = typeof k === 'string' ? k.toLowerCase() : '';
        if (lower === 'f') { szene.setzeTyp('flach'); ev.preventDefault(); }
        else if (lower === 's') { szene.setzeTyp('steil'); ev.preventDefault(); }
        else if (lower === 'c') { szene.setzeTyp('chip'); ev.preventDefault(); }
        else if (lower === 'd') { szene.setzeTyp('doppelpass'); ev.preventDefault(); }
        else if (k === ' ' || k === 'Enter') { ev.preventDefault(); szene.abschliessen(); }
        else if (k >= '1' && k <= '5') {
          const i = Number(k) - 1;
          if (mates[i]) { szene.waehle(mates[i]); ev.preventDefault(); }
        }
      });

      canvas.style.cursor = 'pointer';

      watchdog = setTimeout(() => settle(szene.abbruchErgebnis()), HARD_TIMEOUT_S * 1000);

      function frame(ts) {
        if (done) return;
        if (!lastTs) lastTs = ts;
        const dt = clamp((ts - lastTs) / 1000, 0, 0.05);
        lastTs = ts;
        const fertig = szene.schritt(dt);
        if (done) return;
        render();
        if (fertig) { settle(szene.abbruchErgebnis()); return; }
        rafId = requestAnimationFrame(frame);
      }
      rafId = requestAnimationFrame(frame);
    });
  }
};

export default minigame;
