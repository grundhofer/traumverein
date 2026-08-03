/**
 * Minispiel „Torabschluss"  —  KeyMoment.kind === 'abschluss'
 * ---------------------------------------------------------------------------
 * Schräge Ansicht aus dem Rücken des Schützen Richtung Tor. Der Ball wird
 * angenommen (Anlauf-Phase), dann öffnet sich ein kurzes Schussfenster. Alles
 * bewegt sich in Echtzeit:
 *
 *   • Der Torwart verkürzt den Winkel (läuft heraus) und folgt dem Zielkreuz
 *     mit Verzögerung  ->  die freie Torfläche schrumpft von Frame zu Frame.
 *   • Verteidiger rücken heran  ->  je später der Schuss, desto größer die
 *     Blockgefahr.
 *   • Ganz früh geschossen ist der Spieler noch nicht ausbalanciert
 *     ->  deutlich größere Streuung.
 *
 * Daraus entsteht die eigentliche Abwägung: früh = ungenau, spät = riskant.
 * Wer wartet, kann den Torwart aber auch aus der Reserve locken und ihn per
 * Heber überwinden.
 *
 * Steuerung:
 *   Maus              zielen (Zielkreuz wandert über die Torfläche)
 *   [1] / [2] / [3]   Schusstyp WÄHLEN: flach / Heber / platziert
 *   Klick / [Leert.]  abziehen – mit dem gewählten Typ
 *   ESC               abbrechen (Simulation übernimmt, Rückgabe null)
 *
 * Die Tasten wählen nur aus, sie feuern nicht. Das ist der Grund: die rote
 * Skyline im Tor zeigt die Abdeckung des ANGEWÄHLTEN Typs (`S.typ`). Wer den
 * Heber wählt, sieht sofort, dass der Torwart unten alles zumacht und oben eine
 * Lücke bleibt — vorher wurde immer der Flachschuss gezeichnet, weil der Typ
 * erst beim Abschuss feststand.
 *
 * ---------------------------------------------------------------------------
 * ZIELHILFE: GENAU EINE GRÖSSE — DIE TORCHANCE
 * ---------------------------------------------------------------------------
 * An jedem der drei Knöpfe steht die TORCHANCE dieses Schusstyps in Prozent.
 * Das ist die einzige Zahl der Szene, und sie kommt aus denselben Spalten, die
 * auch gezeichnet werden (`coverHoehe`/`sperrHoehe` → `torchance`): die
 * Wahrscheinlichkeit, dass der Ball im Tor OBERHALB der roten Skyline landet —
 * mit der Streuung DIESES Typs um sein bestes gelbes Feld —, mal die
 * Wahrscheinlichkeit, dass kein Verteidiger im Weg steht. Beide Bausteine sind
 * die des Modells: `coverHoehe` invertiert `haltewahrscheinlichkeit`, und die
 * Streuung ist dieselbe, die `loeseSchuss()` würfelt.
 *
 * Vorher stand in der Fußzeile „TOR ZU x %": der Anteil der Torfläche, der
 * nicht gelb ist. Als Beschreibung des Bildes war das richtig, als Wahl
 * zwischen [1], [2] und [3] war es unbrauchbar, seit es ein graues Band gibt:
 * grau (unerreichbar) und rot (Torwart) wogen gleich schwer, obwohl ein
 * schmales gelbes Band über dem herausgelaufenen Torwart die beste Chance der
 * ganzen Szene sein kann.
 *
 * WIE HIER GEMESSEN WIRD (Abschnitt 4b von tools/test-abschluss.js): je Lage
 * und Typ ein Raster von 15 × 7 Zielpunkten über die ganze Torfläche, jeder
 * Punkt mit denselben zehn Würfeln beschossen. Nachgemessen werden mit
 * denselben achtzig frischen Würfeln ZWEI Punkte:
 *
 *   (a) der beste Punkt des Rasters   — was in dieser Lage möglich wäre,
 *   (b) der Punkt, den `torchance` selbst gewählt hat — was der Spieler
 *       bekommt, wenn er der Anzeige folgt.
 *
 * Diese Wahrheit weiß von keiner der Kennzahlen etwas; (b) fragt die Kennzahl
 * nur nach ihrem Zielpunkt, bewertet wird er vom Modell. Ohne (b) wäre eine
 * falsche ZIELPUNKTWAHL unsichtbar: die Zahl dürfte beliebig schlecht zielen,
 * solange irgendwo auf der Torfläche ein guter Punkt liegt. Frühere Zahlen an
 * dieser Stelle sind ersatzlos entfallen: sie stammen aus einer Wahrheit, die
 * den Zielpunkt mit derselben Heuristik suchte wie die Kennzahl selbst
 * (breitestes gelbes Band).
 *
 * 36 Großchancen-Lagen bzw. 23 Lagen im kurzen Band (≤ 8 m) — und zwar über
 * SECHS unabhängige Saatfamilien, angegeben als Mittel ± Standardfehler über
 * die Familien. Eine Saatfolge ist keine Messung; wie weit die Zahlen von Lauf
 * zu Lauf wandern, steht weiter unten unter „Wie genau das ist".
 *
 *                      falscher Knopf            wer ihr folgt, trifft
 *   Fläche „TOR ZU"   49,5±1,8 / 31,2±4,8       79,3±2,0 / 89,2±1,8
 *   Torchance         38,4±1,8 / 21,7±3,4       81,9±1,9 / 90,9±1,4
 *   nur das rote Band 18,1±2,1 / 21,7±4,5           —    /     —
 *   bestmöglich             —                   89,9±1,4 / 93,6±1,5
 *
 * Die Spalte „wer ihr folgt" unterstellt, dass danach OPTIMAL gezielt wird —
 * nur so sind Fläche, rotes Band und Torchance vergleichbar, denn die beiden
 * anderen haben gar keinen Zielpunkt. Wer der Torchance auch beim ZIELEN folgt,
 * kommt auf 83,7±1,9 / 90,3±1,5 %. Die Lücke (a) − (b) je Typ, im Mittel über
 * die Lagen: flach −2,6±0,6 / −2,2±0,4 P., platziert −3,1±0,7 / −0,8±0,5 P.,
 * HEBER 11,8±1,6 / 7,2±1,2 P. — nur der Heber zielt wirklich daneben (warum,
 * steht bei `chanceAmZiel`).
 *
 * Die Torchance führt also seltener in die Irre als die Flächenzahl und trifft
 * öfter — aber sie ist nicht gut, und der Prüfstand meldet das bei jedem Lauf
 * als offenes Ziel. Jede Zahl steht als MITTEL über die Lagen UND als Größtwert
 * einer Einzellage, und mit dem Lineal dazu: der Mittelwert ist nicht die
 * Grenze des Fehlers, sondern liegt weit darunter.
 *
 *   • Sie verspricht ZU VIEL. Gegen ihren EIGENEN Zielpunkt (b) im Mittel
 *     6,6±1,2 (Großchancen) bzw. 8,7±0,4 Punkte (kurzes Band); gegen (a)
 *     9,8±1,0 bzw. 7,7±0,7 Punkte. In der schlimmsten EINZELLAGE sind es
 *     64,9±9,1 bzw. 73,4±5,0 Punkte gegen (b) — dort steht am Knopf eine Zahl
 *     nahe 100 %, während das Modell am angezeigten Zielpunkt kaum etwas
 *     liefert. Das ist der größte verbliebene Fehler der Szene.
 *   • Sie verspricht ZU WENIG, gegen (b) im Mittel bis 3,7±1,3 Punkte
 *     (Großchancen; im kurzen Band untertreibt kein Typ). Einzellagen sind
 *     trotzdem grob daneben: bis 51,2±0,5 bzw. 28,0±3,7 Punkte zu wenig.
 *
 * Beides sitzt in der Bewertung EINES Punktes, nicht in der Wahl des Punktes.
 * Was dagegen gebaut, gemessen und wieder ausgebaut wurde — die binäre Kante
 * `COVER_SCHWELLE` durch eine 2-D-Durchlasstabelle zu ersetzen —, steht mit
 * allen Zahlen bei `chanceAmZiel`. Kurzfassung: für flach und platziert wirkt
 * sie (Eichfehler −4,4 bzw. −3,3 Punkte, gepaart über sechs Familien, t 8,6
 * und 21), für den Heber nicht (t 1,3) — dessen Fehler sitzt in der Bezugsbahn,
 * nicht in der Schwelle. Ausgebaut ist sie trotzdem: sie sprengt das
 * Frame-Budget und die 25-Punkte-Regressionsklammer des Prüfstands.
 * Ebenfalls dort: die Bodenzählung ist entfallen. Das ist ein gemessener
 * TAUSCH — die Eichung des Hebers im kurzen Band wird um 7,8 Punkte besser
 * (t 5,4), die Knopfwahl dort um 6,5 Punkte schlechter (t 2,7).
 *
 * WIE GENAU DAS IST. Hier stand einmal „ein Lauf, keine Streuung über
 * Saatfolgen — auf ein bis zwei Punkte genau, nicht besser". Das war aus EINEM
 * Lauf geschätzt und um eine Größenordnung zu optimistisch. Nachgemessen über
 * sechs Saatfamilien (Standardabweichung ÜBER die Familien, Mischung / kurzes
 * Band):
 *
 *   falsch angeführter Knopf        ± 4,5 / ± 8,2 Punkte
 *   wer der Zahl folgt, trifft      ± 4,6 / ± 3,5 Punkte
 *   Eichfehler im Mittel gegen (b)  ± 3,0 / ± 1,0 Punkte
 *   Lücke (a) − (b) beim Heber      ± 3,9 / ± 2,8 Punkte
 *   größte EINZELLAGE gegen (b)     ± 22  / ± 12  Punkte
 *
 * Ein Mittelwert aus sechs Familien ist damit auf 0,4 bis 5 Punkte genau
 * (Standardfehler); eine EINZELNE Saatfolge auf 3 bis 8 Punkte; ein
 * Einzellagen-Größtwert überhaupt nicht — er wandert um mehr als 20 Punkte.
 * Wer aus einem Lauf eine Eigenschaft des Modells macht, irrt sich also nicht
 * um ein bis zwei Punkte, sondern um fünf bis zwanzig. Genau daran sind in
 * diesem Umbau mehrere Zahlen gestorben.
 *
 * Nur der ROTE Anteil ohne Grau sortiert die Knöpfe (gegen dieselbe ehrliche
 * Wahrheit) sogar besser als die Torchance — der Prüfstand druckt die Zahl bei
 * jedem Lauf mit. Er steht trotzdem nicht in der Fußzeile: er ist keine
 * Wahrscheinlichkeit, und für den Heber ab 9 m meldet er „0 % zu" über einer
 * Torfläche, die dieser Typ gar nicht erreicht. Als Zahl, an der ein Spieler
 * „73 %" liest, wäre er eine Lüge.
 *
 * Die Flächenzahl gibt es weiter als `abdeckung()`; sie beschreibt das Bild,
 * und der Prüfstand rechnet damit nach, dass rot + gelb + grau die Torfläche
 * ergeben. Im Bild steht sie nicht mehr: zwei Prozentzahlen über dieselbe Lage
 * waren schon einmal der Fehler (siehe `abdeckung`, „WINKEL ZU").
 *
 * ---------------------------------------------------------------------------
 * DREI BÄNDER IM TOR — UND DAS ZIELKREUZ MEINT DIE HÖHE, DIE ES ZEIGT
 * ---------------------------------------------------------------------------
 * Die Torfläche zerfällt für den ANGEWÄHLTEN Typ in genau drei Bänder:
 *
 *   rot   von unten bis `coverHoehe`  – dort kommt der Torwart hin
 *   gelb  von dort bis `sperrHoehe`   – dort ist wirklich frei
 *   grau  darüber                     – dorthin bringt DIESER TYP den Ball nicht
 *
 * Das graue Band ersetzt die stille Höhenstauchung `zScale`. Sie rechnete das
 * Zielkreuz auf `aimV · 2,44 m`, schoss den Ball aber auf `aimV · 2,44 · 0,55`:
 * Kreuz auf 2,20 m hieß Ball auf 1,26 m, und 35–49 % der GEZEICHNETEN gelben
 * Fläche waren für den Flachschuss überhaupt nicht erreichbar (gemessen bei
 * 16 m: 0 % der Schüsse mit dem Kreuz mitten im Gelb landeten im Gelb, 52 %
 * Parade). Jetzt gilt: `zZielVon()` ist die EINZIGE Stelle, die aus (aimU, aimV)
 * eine Höhe macht — Zielkreuz, Skyline und `loeseSchuss()` fragen alle dort.
 *
 * Woher die Deckelung kommt (`deckeTabelle`):
 *   • aus dem Typ:      der Flachschuss verlässt den Fuß flach, über
 *                       `SHOT_TYPES.flach.zMax` bekommt man ihn nicht.
 *   • aus der Ballistik: für den Heber sucht `loeseAbschuss` die Bogenlösung.
 *                       Gemessen gibt es sie aus 6 m in die Mitte nur bis
 *                       0,72 m, aus 8 m bis 0,20 m, ab 9 m gar nicht mehr — der
 *                       „Heber" ist dort ein Roller, der auf Ballhöhe über die
 *                       Linie geht. Vorher behauptete die Zielhilfe dort einen
 *                       Bogen, den es nicht gibt: 6 m zentral zeigte 100 % GELB,
 *                       während das Modell jeden Heber über ~0,6 m hielt
 *                       (1,22 m → 75 % Parade, 1,83 m → 86 % Parade, 0 % Tor).
 *
 * Die Grenze hängt an der WEGLÄNGE, nicht an der Torentfernung: in die Ecke ist
 * der Weg länger als in die Mitte. Das graue Band ist deshalb eine Treppe über
 * die Torbreite, keine Waagerechte.
 *
 * Gemessen wird die Deckelung mit derselben Funktion, die auch schießt; wo sie
 * keine Lösung findet, behauptet die Zielhilfe keine.
 *
 * Kopfball-Variante (moment.high === true): statt Zielen ein Timing-Balken für
 * den Absprung; die Richtung kommt aus der Mausquerlage.
 *
 * Rückgabe: { outcome, quality, targetPlayerId, xgDelta } – siehe CONTRACTS 6.1.
 *
 * ---------------------------------------------------------------------------
 * WELT, KAMERA, MASSSTAB
 * ---------------------------------------------------------------------------
 * Die Szene rechnet in METERN, nicht in Bildschirmpixeln:
 *
 *   x = quer, 0 = Tormitte, +x = rechts aus Sicht des Schützen
 *   y = Tiefe, 0 = Torlinie, +y = Richtung Spielfeld
 *   z = Höhe über dem Boden
 *
 * Woher die Szene weiß, wo sie spielt: `moment.at` liefert den Ort des
 * Abschlusses in Weltmetern (CONTRACTS §6.1). Daraus entstehen Tiefe und
 * seitliche Ablage — ein Abschluss aus 6 m halbrechts sieht deshalb anders aus
 * als einer aus 22 m zentral. (Vorher wurde `moment.at` überhaupt nicht
 * gelesen; zwei aufeinanderfolgende Szenen waren pixelgleich.)
 *
 * Es gibt GENAU EINE Projektion: eine Lochkamera hinter dem Schützen, nach dem
 * Vorbild von penalty.js. Tor, Torwart, Verteidiger, Schütze, Ball, Linien und
 * Netz gehen alle durch `cam.project()`; Figuren bekommen ihren Maßstab aus
 * derselben Abbildung (`figurMassstab`). Damit stimmt das Größenverhältnis
 * Tor : Spieler auf gleicher Tiefe automatisch: 2,44 m / 1,80 m = 1,36.
 *
 * ABWEICHUNG vom Nachtrag (dort: back = 9,0 m, h = 2,2 m, focal = 2100):
 * Mit back = 9 wird der Schütze 1,80 m · 2100/9 = 420 px hoch, und das Tor ist
 * aus 6 m mit 1024 px BREITER als das Bild — genau der fotografierte Fehler
 * („die Verteidiger füllen das halbe Bild und verdecken das Tor").
 *
 * Gewählt ist stattdessen Fernsehoptik nach Abschnitt 0 des Nachtrags, und der
 * Kameraabstand wächst mit der Torentfernung mit:
 *
 *   back   = clamp(18,0 + 1,00 · Distanz, 26, 58) m
 *   focal  = 3200 px  (Bildwinkel 17°, vorher 2100 px = 26°)
 *   h      = 2,8 m
 *   Schwenk: die Tormitte sitzt IMMER auf Bildzeile 300 (HORIZON_TOR_Y),
 *            der Horizont wandert entsprechend (121 px bei 2,2 m, 218 bei 22 m).
 *
 * Warum der wachsende Abstand: die Verteidiger stehen immer nur wenige Meter
 * vor dem Ball. Je näher die Kamera, desto größer sind sie gegenüber dem Tor
 * dahinter. Der große Abstand plus lange Brennweite staucht die Tiefe, und ein
 * 6-m-Abschluss bekommt einen anderen Bildausschnitt als einer aus 22 m.
 *
 * Gemessen (zentral, `tools/test-abschluss.js` Abschnitt 3):
 *
 *            Torbreite   Schützenhöhe   Figurenhöhe : Torhöhe   Tor im Bild
 *   back 9     1024 px       420 px           1,32               NEIN
 *   back 16     624 px       236 px           1,03               ja
 *   jetzt       732 px       222 px           0,92               ja
 *
 * und bei 22 m 378 px Torbreite gegen 144 px Schützenhöhe (vorher 399/236 —
 * der Schütze war auf jeder Entfernung gleich groß).
 */

import { clamp, lerp } from '../core/util.js';
import {
  BALL_R, G,
  createFlug, loeseAbschuss, abschussVektor,
  twParameter, twReichweite, sprungProfil, kopfHoehe, timingGuete
} from '../core/ballistik.js';

/* ========================================================================== *
 *  BALANCING-KONSTANTEN  (alles an einem Ort, damit Feintuning leichtfällt)
 * ========================================================================== */

const CANVAS_W = 960;
const CANVAS_H = 600;

/** Notbremse laut Vertrag: nach 20 s wird auf jeden Fall aufgelöst. */
const HARD_TIMEOUT_S = 20;

/** Ballannahme/Anlauf, bevor das Schussfenster aufgeht. */
const APPROACH_S = 0.85;

/** Länge des Schussfensters (Sekunden) – wird über Nervenstärke interpoliert. */
const WINDOW_MIN_S = 1.2;
const WINDOW_MAX_S = 2.5;
/** Harte Grenzen nach der Schwierigkeitsskalierung. */
const WINDOW_CLAMP = [0.85, 3.2];

/** Anteil des Fensters, in dem der Schütze noch nicht sauber steht. */
const SETTLE_FRAC = 0.34;
const EARLY_SPREAD_MULT = 1.95;   // Streuungsfaktor ganz zu Beginn
const LATE_SPREAD_MULT = 0.88;    // …und am Ende des Fensters (voll ausbalanciert)

/**
 * Grundstreuung des Abschusswinkels in RADIANT bei Skill 50 (≈ 2,5°).
 * Vorher war die Streuung in Tor-Einheiten absolut (0,125 · 7,32 m = 0,92 m) —
 * ein Abschluss aus 5 m war damit genauso ungenau wie einer aus 25 m.
 *
 * NACHTARIERT (Σ-xG-Abnahme): 0,038 rad ergab aus 8 m nur 0,30 m Streuung am
 * Tor; in der Großchancen-Mischung gingen daneben und Aluminium zusammen auf
 * 2,9 % zurück (Altstand 13,1 %). Die Szene wurde dadurch messbar
 * torgefährlicher, ohne dass mehr Tore fielen: was nicht danebengeht, zählt in
 * `quality` voll. 0,044 rad (0,35 m aus 8 m) ist der größte Wert, der die
 * Torquote im kurzen Band noch über 34 % lässt.
 */
const AIM_SPREAD_RAD = 0.044;
/**
 * Vertikale Streuung relativ zur horizontalen.
 * ACHTUNG, bewusste Abweichung vom Plan: der Plan nennt 1,60 und meint damit den
 * ALTEN Wert in Tor-Einheiten. In Metern war das 0,125·1,60·2,44 m = 0,49 m
 * vertikal gegen 0,92 m horizontal, also 0,53. In Radiant übernommen wäre 1,60
 * eine Verdreifachung der Höhenstreuung — jeder zweite Schuss aus 20 m ginge
 * über die Latte. Übernommen ist deshalb der metrisch identische Wert.
 */
const VERT_SPREAD_RATIO = 0.55;
/** Druck des Gegners erhöht die Streuung um bis zu diesen Faktor. */
const PRESSURE_SPREAD = 0.35;

/** Tor in Weltkoordinaten (Meter). */
const TOR_HALB = 3.66;
const TOR_HOEHE = 2.44;
const PFOSTEN_R = 0.06;
const NETZ_TIEFE = 2.0;
/** Ball trifft Aluminium, wenn sein Mittelpunkt so nah am Rahmen vorbeigeht. */
const HOLZ_BAND = PFOSTEN_R + BALL_R;

/**
 * Lochkamera in FERNSEHOPTIK (siehe Dateikopf).
 *
 * Der Abstand hinter dem Schützen wächst mit der Torentfernung: ein Abschluss
 * aus 6 m bekommt sonst denselben Bildausschnitt wie einer aus 25 m, und die
 * Verteidiger — die immer nur ein paar Meter vor dem Ball stehen — sind aus der
 * Nähe fast so hoch wie das Tor. Je weiter die Kamera zurückgeht, desto stärker
 * staucht sie die Tiefe: Verteidiger und Tor rücken im Bild zusammen.
 */
const CAM_BACK_BASIS = 18.0;      // Meter hinter dem Schützen bei 0 m Torentfernung
const CAM_BACK_PRO_M = 1.00;      // …und so viele Meter mehr je Meter Torentfernung
const CAM_BACK_MIN = 26.0;
const CAM_BACK_MAX = 58.0;
const CAM_H = 2.8;
/**
 * Lange Brennweite (Bildwinkel 2·atan(480/3000) = 18°) — das ist die
 * Fernsehoptik, die Abschnitt 0 des Nachtrags für den Freistoß vorgibt.
 * Vorher: 2100 (26°) bei festen 16 m Abstand.
 */
const CAM_FOCAL = 3200;
/**
 * Bildaufbau statt fester Horizontlinie: die Kamera schwenkt so, dass die
 * Tormitte immer auf dieser Bildzeile sitzt. Damit bleibt das Tor auf JEDER
 * Entfernung vollständig im Bild und der Schütze steht nie im Fußzeilen-Panel.
 */
const HORIZON_TOR_Y = 300;
const HORIZON_MIN = 90;
const HORIZON_MAX = 250;

/** Kameraabstand hinter dem Schützen für diese Torentfernung (Meter). */
export function kameraAbstand(distance) {
  return clamp(CAM_BACK_BASIS + CAM_BACK_PRO_M * Math.max(0, distance),
    CAM_BACK_MIN, CAM_BACK_MAX);
}

/** Referenzhöhen für den Figurenmaßstab. */
const SPRITE_H_PX = 47;        // render/players.js: scale 1 ≈ 47 px Gesamthöhe
const SPIELER_H_M = 1.80;      // …und das entspricht 1,80 m
const KEEPER_H_M = 1.88;

/** Torwart: Herauslaufen in m/s (aus Stellungsspiel), Deckel in Metern. */
const KEEPER_OUT_MIN = 2.6;
const KEEPER_OUT_MAX = 3.4;
const KEEPER_OUT_M_MAX = 6.0;
const KEEPER_OUT_ANTEIL = 0.50;   // nie näher als die halbe Distanz an den Schützen
const KEEPER_OUT_START = 0.4;     // Startabstand von der Linie
/**
 * Gegen einen Fernschuss stürmt kein Torwart heraus – er verkürzt den Winkel nur,
 * wenn der Schütze nah genug ist. Ohne diese Bremse liefe er auch bei 25 m sechs
 * Meter vor sein Tor und der Heber wäre dort die dominante Strategie.
 */
const KEEPER_OUT_FERN = 14.0;
/** Wie schnell der Torwart dem Zielkreuz folgt (Meter pro Sekunde). */
const KEEPER_TRACK_SPEED = 1.9;
/** So dicht kommt er dem Zielkreuz höchstens – er stellt den Winkel, er rät nicht. */
const KEEPER_TRACK_DEADZONE = 0.30;
/** Weiter als das darf er sich nicht aus seiner Winkelhalbierenden ziehen lassen. */
const KEEPER_MAX_OFFSET = 1.00;
/**
 * Kein harter Schnitt am Reichweitenrand: bis 0,55 der Reichweite hält er
 * sicher, von dort bis 1,0 fällt die Haltewahrscheinlichkeit auf 0,10.
 * (Ersetzt KEEPER_SAVE_EDGE, KEEPER_HEIGHT_FALLOFF und KEEPER_LUCK; die
 * Höhenabhängigkeit steckt jetzt in `twReichweite`.)
 *
 * ABWEICHUNG vom Plan: der nennt 0,85 als Beginn des weichen Randes. Gemessen
 * ergibt das im ganz kurzen Band 27 % Torquote statt der geforderten 34–46 % —
 * ein voll gestreckter Torwart hält eben nicht alles, was er gerade noch
 * berührt. Der Korridor ist das verbindliche Abnahmekriterium, also beginnt der
 * weiche Rand früher.
 */
const KEEPER_EDGE_VON = 0.55;
const KEEPER_EDGE_P0 = 0.85;
const KEEPER_EDGE_P1 = 0.10;
/**
 * Wer herausläuft, kann nicht mehr hechten. Der Malus greift über den ANTEIL der
 * Distanz, den der Torwart schon zugelaufen ist: nah am Schützen ist er in der
 * Vorwärtsbewegung und praktisch nur noch ein Hindernis, kein Fänger. Genau das
 * macht das Herauslaufen zum Risiko und den Heber zur Antwort darauf.
 */
const KEEPER_LAUF_MALUS = 0.90;
const KEEPER_LAUF_REL = 0.80;
/**
 * Höher als das kommt der Torwart nicht mehr – darüber ist der Heber durch.
 * Die Grenze hängt davon ab, wie weit er sich schon nach vorn festgelegt hat:
 * auf der Linie springt er bis unter die Latte, sechs Meter draußen kann er dem
 * Ball nicht mehr hinterher. Ohne diese Kopplung wäre der Heber auch aus 20 m
 * die dominante Wahl (gemessen: 16 % Torquote gegen 5 % beim Flachschuss),
 * obwohl der Torwart dort zwei Sekunden Zeit hat.
 */
const KEEPER_HOCH_LINIE = 2.60;
const KEEPER_HOCH_DRAUSSEN = 2.20;
const KEEPER_HOCH_REF = 3.0;
/**
 * Rückwärtstempo des Torwarts. Ein Heber, der ihm über den Kopf segelt, ist nur
 * dann ein Tor, wenn der Ball SCHNELL genug hinter ihm ist. Bei einem Lob aus
 * 20 m hängt der Ball zwei Sekunden in der Luft — da steht der Torwart längst
 * wieder auf der Linie und pflückt ihn herunter.
 */
const KEEPER_RUECK_SPEED = 2.0;
/** Lesen, umdrehen, anlaufen – bevor der Rückweg überhaupt beginnt. */
const KEEPER_UMKEHR = 0.5;
/** Aufsetzer vor dem Torwart senken die Haltewahrscheinlichkeit. */
const AUFSETZER_MALUS = [0.12, 0.18];
/** Ab dieser Haltewahrscheinlichkeit gilt eine Torspalte als „zu" (rote Skyline). */
const COVER_SCHWELLE = 0.45;
/** Spaltenzahl der roten Skyline – Bild und angezeigte Prozentzahl teilen sie. */
const SKYLINE_SPALTEN = 30;
/**
 * Höhenstufen je Torspalte, über die `torchance()` seinen Zielpunkt sucht
 * (`ZIEL_HOEHEN + 1` Punkte von der roten bis zur grauen Kante). Zusammen mit
 * SKYLINE_SPALTEN ist das ein Raster von 120 Zielpunkten je Typ.
 *
 * Vier Stufen genügen. Gemessen über 60 Großchancen-Lagen × 3 Typen (Ø der
 * angezeigten Zahl / Median der Rechenzeit für alle drei Knöpfe):
 *   2 Stufen 87,66 % / 0,130 ms · 3 Stufen 87,67 % / 0,160 ms
 *   4 Stufen 87,71 % / 0,188 ms · 8 Stufen 87,72 % / 0,282 ms
 * Von vier auf acht Stufen ändert sich die Zahl also um 0,01 Punkte und kostet
 * 50 % mehr.
 */
const ZIEL_HOEHEN = 3;
/**
 * Stützstellen des Höhenprofils der Bezugsbahn je Schusstyp (Zielhilfe) und die
 * Zielhöhe, auf die sie gemessen wird.
 */
const PROFIL_N = 8;
const PROFIL_Z_TIEF = 0.35;
const PROFIL_Z_HOCH = 2.05;
const TYP_INDEX = { flach: 0, heber: 1, platziert: 2, kopfball: 3 };

/** Verteidiger-Körper als Quader um seinen Standpunkt (Meter). */
const BLOCK_HALB_X = 0.62;
const BLOCK_HALB_Y = 0.25;
const BLOCK_H_BASIS = 1.85;
const BLOCK_H_SPRUNG = 0.42;
/** Startabstand vom Ball (Meter, Richtung Tor) und Schließgeschwindigkeit (m/s). */
const BLOCK_AB_HINTEN = -2.5;      // negativ = der Verteidiger ist überspielt
const BLOCK_AB_ANTEIL = 0.85;      // …bis knapp vor die Torlinie
const BLOCK_AB_MIN = 2.6;
const BLOCK_ZU_SPEED = [0.8, 1.6];
/** Ab hier zählt ein Verteidiger überhaupt als Blockkandidat (Meter vor dem Ball). */
const BLOCK_AB_AKTIV = 0.5;
/**
 * Seitliche Streuung der Verteidiger quer zur Schussachse (Meter, Standardabw.).
 *
 * NACHTARIERT (Σ-xG-Abnahme): mit 3,6 m stand der typische Verteidiger fast drei
 * Meter neben der Schussachse und war damit gar kein Blockkandidat mehr — in der
 * Großchancen-Mischung wurden nur noch 26 % der Abschlüsse geblockt, gegen 36 %
 * im Altstand. Ein geblockter Ball kostet `quality` 0,18 und `xgDelta` 0,05;
 * genau daran hing der größere Teil der Σ-xG-Abweichung. 2,5 m heißt: die drei
 * Verteidiger einer Großchance laufen zum Ball und nicht irgendwohin.
 */
const BLOCK_QUER_STREU = 2.5;
const BLOCK_QUER_MAX = 6.5;
/** Wie schnell Verteidiger dem Zielkreuz nachschieben (Meter je Sekunde). */
const BLOCK_TRACK = 0.20;
/** Streifschuss am Körperrand: Richtungsänderung in Grad (abgefälscht). */
const ABLENK_GRAD = [8, 20];

/** xgDelta-Grenzen laut Vertrag. */
const XG_MIN = -0.10;
const XG_MAX = 0.40;

/** Kopfball-Timing: halbe Breite des grünen Bereichs in SEKUNDEN bei Skill 50. */
const HEAD_GREEN_BASE = 0.10;
const HEAD_GREEN_SKILL = 0.09;
/** Flugzeit der Flanke, falls sie sich nicht berechnen lässt. */
const HEAD_WINDOW_S = 2.4;
/** Zielspanne des Kopfballs aus der Mausquerlage. */
const HEAD_YAW_GRAD = 25;

/**
 * Höchste Höhe, auf die überhaupt gezielt werden kann (über der Latte = daneben)
 * und tiefste. `aimV` läuft bis 1,15 Tor-Einheiten, damit ein Schuss auch drüber
 * gehen kann.
 */
const AIM_Z_MAX = 1.15 * TOR_HOEHE;
const AIM_Z_MIN = 0.05;
/** Schrittzahl der Halbierung, mit der `deckeTabelle` die Ballistik ausmisst. */
const DECKE_SCHRITTE = 6;
/**
 * So viele Streifen bekommt die Höhengrenze über die Torbreite. Sie hängt an der
 * Weglänge, und die ist zur Ecke deutlich größer als zur Mitte — eine einzige
 * Zahl fürs ganze Tor wäre entweder in der Ecke gelogen oder in der Mitte
 * unnötig streng (siehe `deckeTabelle`).
 */
const DECKE_SPALTEN = 5;

/**
 * Schusstypen. `v0` ist eine echte Abschussgeschwindigkeit in m/s, `hoch` wählt
 * die Lob-Lösung, `zMax` ist die Höhe, über die der Typ den Ball nicht mehr
 * bekommt (Meter über dem Boden, gemessen auf der Torlinie).
 *
 * ABGELÖST: `zScale`/`zLift`. Die stauchten `aimV` still auf 55 % der Torhöhe,
 * während Zielkreuz und Skyline weiter die volle Höhe zeigten (siehe Dateikopf).
 * Gemessen liefert die Ballistik dem Flachschuss JEDE Zielhöhe punktgenau —
 * aus 4 bis 22 m landet ein Schuss auf 2,30 m auch auf 2,30 m. Die Stauchung
 * hatte also keine physikalische Entsprechung, sie war nur eine falsch
 * gezeichnete Zielhilfe. Was der Flachschuss wirklich nicht kann, ist ihn hoch
 * anzuheben: dafür steht jetzt `zMax` — dieselbe Grenze wie vorher (1,15 · 2,44
 * · 0,55 + 0,05 = 1,59 m), aber als das benannt, was sie ist, und im Bild als
 * graues Band sichtbar.
 */
const SHOT_TYPES = {
  flach: {
    name: 'Flachschuss', hint: 'schnell, flach, blockbar',
    spread: 1.00, v0: 27, zMax: 1.60, hoch: false, xg: 0.02
  },
  heber: {
    name: 'Heber', hint: 'über alles hinweg, aber langsam',
    spread: 1.28, v0: 15, zMax: AIM_Z_MAX, hoch: true, xg: 0.00
  },
  // Hinweis zu `heber`: v0 ist hier nur der Deckel – die tatsächliche
  // Abschussgeschwindigkeit kommt aus `v0Von()`, siehe dort. Seine wirkliche
  // Höhengrenze kommt nicht von hier, sondern aus `zDecke()`.
  platziert: {
    name: 'Platziert', hint: 'genau – der Keeper hat mehr Zeit',
    spread: 0.75, v0: 21, zMax: AIM_Z_MAX, hoch: false, xg: 0.01
  },
  kopfball: {
    name: 'Kopfball', hint: 'Timing entscheidet',
    spread: 1.00, v0: 13, zMax: AIM_Z_MAX, hoch: false, xg: 0.00
  }
};

/** Tastenbelegung der Schusstypen – Auswahl, nicht Auslösung (siehe Dateikopf). */
const TYP_VON_TASTE = { '1': 'flach', '2': 'heber', '3': 'platziert' };
/** Fußzeilen-Knöpfe: Taste, Beschriftung, Farbe. Konstant, keine Allokation je Frame. */
const TYP_KNOEPFE = [
  ['1', 'Flach', '#f5c518'], ['2', 'Heber', '#3fae4a'], ['3', 'Platziert', '#8fc4f0']
];

/** Retro-Palette (siehe Stil-Leitfaden im Vertrag). */
const COL = {
  himmel: '#16283f', rangDunkel: '#22344c', rangHell: '#37506e',
  rasen: '#2f7d32', rasenDunkel: '#276b2a', rasenHell: '#3b8f3e',
  linie: '#f4f4ec', netz: '#e3eaec', outline: '#0d1116',
  holz: '#8b5a2b', beige: '#e8d9b0', papier: '#f2e8cf', sperr: '#5a6675',
  rot: '#c1272d', blau: '#1c4f8f', gelb: '#f5c518', gruen: '#3fae4a', schwarz: '#0d1116'
};

/** Strichmuster des Zielstrahls – konstant, damit im Frame kein Array entsteht. */
const STRICH_AN = [9, 7];
const STRICH_AUS = [];

/** Zuschauerfarben – konstant, damit im Frame kein Array entsteht. */
const ZUSCHAUER_FARBEN = ['#d9d2c2', '#c1272d', '#1c4f8f', '#f5c518', '#8b5a2b'];

/** Fallback, wenn `moment.at` fehlt (Vertrag: darf fehlen). */
const FALLBACK_TIEFE = 14;
const FALLBACK_SEIT = 0;

/* ========================================================================== *
 *  KLEINE HELFER  (bewusst lokal – interactive/-Module bleiben eigenständig)
 * ========================================================================== */

let warnedDraw = false;

const att = (p, key, fallback = 50) => {
  const v = p && p.attributes ? p.attributes[key] : undefined;
  return typeof v === 'number' ? v : fallback;
};

const hasTrait = (p, key) => !!(p && Array.isArray(p.traits) && p.traits.indexOf(key) >= 0);

const nameOf = (p, fallback = 'Spieler') =>
  (p && (p.shortName || p.lastName)) || fallback;

/** Körpergröße in Metern aus dem Aussehen (cm), mit Rückfall auf 1,80 m. */
function groesseM(p, fallback = SPIELER_H_M) {
  const h = p && p.appearance && p.appearance.height;
  return typeof h === 'number' && h > 120 && h < 230 ? h / 100 : fallback;
}

/** Zufalls-Helfer, die nur rng.next() voraussetzen. */
function rFloat(rng, a, b) { return a + rng.next() * (b - a); }
function rChance(rng, p) { return rng.next() < p; }
function rGauss(rng, mean, sd) {
  if (typeof rng.gauss === 'function') return rng.gauss(mean, sd);
  let u = 0, v = 0, s = 0;
  do { u = rng.next() * 2 - 1; v = rng.next() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  return mean + sd * (u * Math.sqrt(-2 * Math.log(s) / s));
}

/**
 * Verteilungsfunktion der Normalverteilung (Abramowitz/Stegun 7.1.26, Fehler
 * unter 1,5e-7) und die Masse eines Intervalls um den Mittelwert 0.
 * Gebraucht wird das von `torchance()`: dort wird gefragt, wie viel der eigenen
 * Streuung in einem Band landet — ohne zu würfeln, denn die Zahl steht in jedem
 * Frame im Bild und darf den RNG-Strom nicht anfassen.
 */
function normPhi(z) {
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}
function normMasse(a, b, sd) {
  if (!(sd > 1e-9)) return a <= 0 && b >= 0 ? 1 : 0;
  return Math.max(0, normPhi(b / sd) - normPhi(a / sd));
}

/* ========================================================================== *
 *  SZENE UND KAMERA  (reine Geometrie, DOM-frei, auch vom Prüfexport genutzt)
 * ========================================================================== */

/**
 * Ort des Abschlusses aus `moment.at` (Weltmeter nach CONTRACTS §1) in die
 * Szenenkoordinaten der Schlüsselszene übersetzen.
 *
 *   tiefe = senkrechter Abstand zur Torlinie
 *   seit  = seitliche Ablage, + = rechts aus Sicht des Schützen
 */
export function szeneAus(moment) {
  const m = moment || {};
  const at = m.at;
  const auswaerts = m.team === 'away';
  let tiefe = FALLBACK_TIEFE, seit = FALLBACK_SEIT;
  if (at && typeof at.x === 'number' && typeof at.y === 'number') {
    const torX = auswaerts ? 0 : 105;
    tiefe = Math.abs(torX - at.x);
    seit = auswaerts ? (at.y - 34) : (34 - at.y);
  }
  tiefe = clamp(tiefe, 2.2, 40);
  seit = clamp(seit, -26, 26);
  const distance = Math.hypot(tiefe, seit);
  return { tiefe, seit, distance };
}

/**
 * Lochkamera hinter dem Schützen, Blick auf die Tormitte, Horizont waagerecht.
 * Ein Objekt je Szene; `project` schreibt in ein mitgegebenes out-Objekt und
 * allokiert damit im rAF-Takt nichts.
 *
 * Abstand und Horizontzeile hängen von der Torentfernung ab (siehe die
 * CAM_*-Konstanten): weit weg stehende Kamera, lange Brennweite, Tormitte
 * immer auf derselben Bildzeile.
 */
export function macheKamera(sz) {
  const D = Math.max(1e-3, sz.distance);
  // Blickrichtung Schütze -> Tormitte
  const nx = -sz.seit / D, ny = -sz.tiefe / D;
  // Rechts-Vektor der Kamera (90° gedreht) – für seit = 0 ist das (+1, 0)
  const rx = -ny, ry = nx;
  // Kamera steht `back` Meter hinter dem Schützen auf derselben Achse
  const back = kameraAbstand(D);
  const f = 1 + back / D;
  const cx = sz.seit * f, cy = sz.tiefe * f;
  const CX = CANVAS_W / 2;
  const d0 = -cx * nx - cy * ny;
  const s0 = -cx * rx - cy * ry;
  // Schwenk: Tormitte (z = TOR_HOEHE/2, Tiefe D + back) auf HORIZON_TOR_Y legen
  const kTor = CAM_FOCAL / Math.max(0.5, D + back);
  const HOR = clamp(HORIZON_TOR_Y - (CAM_H - TOR_HOEHE / 2) * kTor, HORIZON_MIN, HORIZON_MAX);

  return {
    nx, ny, rx, ry, cx, cy, CX, back, focal: CAM_FOCAL, hoehe: CAM_H, horizont: HOR,
    /** Pixel je Meter in der Tiefe d vor der Kamera. */
    massstabD(d) { return CAM_FOCAL / Math.max(0.5, d); },
    /** Tiefe eines Weltpunktes vor der Kamera (Meter). */
    tiefeVon(x, y) { return (x - cx) * nx + (y - cy) * ny; },
    /** Pixel je Meter am Ort (x, y). */
    massstab(x, y) { return CAM_FOCAL / Math.max(0.5, (x - cx) * nx + (y - cy) * ny); },
    /** Weltpunkt -> Bildschirm. out = { x, y, k }. */
    project(x, y, z, out) {
      const o = out || { x: 0, y: 0, k: 0 };
      const dx = x - cx, dy = y - cy;
      const d = dx * nx + dy * ny;
      const s = dx * rx + dy * ry;
      const k = CAM_FOCAL / Math.max(0.5, d);
      o.x = CX + s * k;
      o.y = HOR + (CAM_H - z) * k;
      o.k = k;
      o.d = d;
      return o;
    },
    /** Rückprojektion auf die Torebene (y = 0) – exakt, fürs Zielen mit der Maus. */
    unprojectTor(sx, sy, out) {
      const o = out || { x: 0, z: 0 };
      const A = sx - CX;
      const nenner = A * nx - CAM_FOCAL * rx;
      const x = Math.abs(nenner) < 1e-6 ? 0 : (CAM_FOCAL * s0 - A * d0) / nenner;
      const d = Math.max(0.5, nx * x + d0);
      const k = CAM_FOCAL / d;
      o.x = x;
      o.z = CAM_H - (sy - HOR) / k;
      return o;
    }
  };
}

/** Sprite-Maßstab für eine Figur der Höhe hoehe (m) bei k Pixeln je Meter. */
export function figurMassstab(k, hoehe) {
  return (hoehe || SPIELER_H_M) * k / SPRITE_H_PX;
}

/**
 * Abschussgeschwindigkeit eines Schusstyps auf dieser Distanz.
 *
 * ABWEICHUNG vom Plan (dort: Heber pauschal 15 m/s): 15 m/s zusammen mit der
 * Lob-Lösung ergibt aus 11 m einen Mondball mit 2,56 s Flugzeit — der Torwart
 * spaziert in Ruhe zurück auf seine Linie und pflückt ihn herunter, und aus
 * 20 m wäre der Heber trotzdem die dominante Wahl gewesen (gemessen 15,5 %
 * gegen 4,9 % beim Flachschuss). Der Heber bekommt deshalb die FLACHSTE Lob-
 * Lösung, die auf dieser Distanz überhaupt noch bogenförmig ist:
 * v₀ = √(g·D) ist die 45°-Wurfweite. Das ergibt aus 6 m einen echten Lupfer
 * (rund 1,1 s) und aus 20 m einen langsamen Bogen (rund 2,0 s) — genau die
 * Staffelung, die den Heber zur Antwort auf den herausgelaufenen Torwart macht
 * und nicht zur Antwort auf alles.
 */
function v0Von(spec, distance) {
  if (!spec.hoch) return spec.v0;
  return clamp(Math.sqrt(G * (Math.max(2, distance) + 1.5)), 8, spec.v0);
}

/** Weltpunkt einer Tor-Koordinate (u = 0..1 quer, v = 0..1 hoch). */
function torPunkt(u, v, out) {
  const o = out || { x: 0, y: 0, z: 0 };
  o.x = lerp(-TOR_HALB, TOR_HALB, u);
  o.y = 0;
  o.z = v * TOR_HOEHE;
  return o;
}

/**
 * Winkelhalbierende: wo steht der Torwart auf der Linie, wenn er den Winkel
 * halbiert? (Winkelhalbierendensatz — teilt das Tor im Verhältnis der
 * Pfostenabstände.)
 */
function keeperBasisX(sz) {
  const dl = Math.hypot(sz.seit + TOR_HALB, sz.tiefe);
  const dr = Math.hypot(sz.seit - TOR_HALB, sz.tiefe);
  return TOR_HALB * (dl - dr) / Math.max(1e-6, dl + dr);
}

/* ========================================================================== *
 *  SZENENZUSTAND  (DOM-frei aufgebaut, damit tools/test-abschluss.js ihn fährt)
 * ========================================================================== */

/**
 * Baut den vollständigen, DOM-freien Zustand der Szene.
 * `rng` wird hier nur für die Verteidiger-Aufstellung gezogen (diskretes
 * Ereignis, kein Substep) — danach ist `schritt()` zufallsfrei.
 */
export function erzeugeSzene(moment, diff, rng) {
  const m = moment || {};
  const sz = szeneAus(m);
  const actor = m.actor || null;
  const keeper = m.keeper || null;
  const defenders = Array.isArray(m.defenders) ? m.defenders.slice(0, 3) : [];
  const pressure = clamp(typeof m.pressure === 'number' ? m.pressure : 45, 0, 100);
  const d = clamp(diff || 1, 0.4, 2);

  const nerven = att(actor, 'nervenstaerke');
  const skill01 = clamp(
    (att(actor, 'schuss') * 0.50 + att(actor, 'technik') * 0.28 + nerven * 0.22) / 99, 0, 1);
  const headSkill01 = clamp(
    (att(actor, 'kopfball') * 0.60 + att(actor, 'sprungkraft') * 0.40) / 99, 0, 1);
  const keeperSkill01 = clamp(
    (att(keeper, 'reflexe', 55) * 0.62 + att(keeper, 'stellungsspiel', 55) * 0.38) / 99, 0, 1);

  const windowS = clamp(
    lerp(WINDOW_MIN_S, WINDOW_MAX_S, clamp(nerven / 99, 0, 1)) / d,
    WINDOW_CLAMP[0], WINDOW_CLAMP[1]);

  const spreadMult = (1.50 - 1.00 * skill01)
    * (0.75 + 0.35 * d)
    * (1 + (pressure / 100) * PRESSURE_SPREAD)
    * (hasTrait(actor, 'knipser') ? 0.88 : 1)
    * (hasTrait(actor, 'weltfussballer') ? 0.92 : 1);

  // Torwart: Physikkern liefert Reaktionszeit, Hechtgeschwindigkeit, Armlänge.
  const twPar = twParameter({
    reflexe: att(keeper, 'reflexe', 55),
    antizipation: att(keeper, 'stellungsspiel', 55),
    sprungkraft: att(keeper, 'sprungkraft', 55),
    groesse: groesseM(keeper, KEEPER_H_M)
  });
  const twFaktor = (0.82 + 0.30 * d) * (hasTrait(keeper, 'torwartlegende') ? 1.12 : 1);
  const outSpeed = lerp(KEEPER_OUT_MIN, KEEPER_OUT_MAX, att(keeper, 'stellungsspiel', 55) / 99);

  const basisX = keeperBasisX(sz);
  const zurBall = {
    x: (sz.seit - basisX), y: sz.tiefe
  };
  const zbLen = Math.max(1e-6, Math.hypot(zurBall.x, zurBall.y));
  zurBall.x /= zbLen; zurBall.y /= zbLen;

  const S = {
    szene: sz,
    kamera: macheKamera(sz),
    actor, keeper, defenders,
    diff: d, pressure,
    skill01, headSkill01, keeperSkill01, nerven,
    windowS, spreadMult,
    twPar, twFaktor, outSpeed,
    keeperBasisX: basisX,
    keeperRichtung: zurBall,
    startZ: BALL_R,
    keeperOffset: 0,
    keeperOut: KEEPER_OUT_START,
    keeperOutMax: Math.min(KEEPER_OUT_M_MAX, KEEPER_OUT_ANTEIL * sz.distance),
    keeperX: basisX + KEEPER_OUT_START * zurBall.x,
    keeperY: KEEPER_OUT_START * zurBall.y,
    phase: 'anlauf',
    t: 0, phaseT: 0,
    aimU: 0.5, aimV: 0.45,
    // Angewählter Schusstyp. Er wird schon WÄHREND der Zielphase geführt, damit
    // die Zielhilfe die Abdeckung des Typs zeigt, den man gleich schießt.
    typ: m.high === true ? 'kopfball' : 'flach',
    // Flugzeit-Bezugswerte und Höhenprofile je Typ (faul gefüllt) sowie die
    // zugehörige Bahnlänge. Ein Puffer für alle vier Typen: eine Allokation.
    tFlug: {}, tFlugHoch: {},
    // Höchste Zielhöhe, die der Typ in DIESER Szene wirklich liefert (Meter),
    // und die beiden Zielhöhen, auf die seine Bezugsbahnen gemessen wurden.
    // `gemerktAb` hält fest, für welche Abschusshöhe das alles gilt.
    zDecke: {}, profilZTief: {}, profilZHoch: {}, gemerktAb: BALL_R,
    profil: new Float64Array(8 * (PROFIL_N + 1)),
    tFlugL: Math.max(1e-6, sz.distance),
    // Spaltenpuffer der Torchance: erst SKYLINE_SPALTEN rote, dann ebenso viele
    // Sperrhöhen. Einmal je Szene, damit `torchance()` im rAF-Takt nichts anlegt.
    chanceSpalten: new Float64Array(2 * SKYLINE_SPALTEN),
    defs: []
  };

  // Fehlt `defenders` ganz (der Vertrag erlaubt das), steht trotzdem jemand im
  // Weg — eine Großchance ohne jeden Gegenspieler gibt es nicht. Eine
  // AUSDRÜCKLICH leere Liste heißt dagegen wirklich: keiner. Sonst könnte ein
  // Prüfstand die Verteidiger gar nicht abschalten.
  const liste = defenders.length ? defenders : (Array.isArray(m.defenders) ? [] : [null]);
  const n = liste.length;
  for (let i = 0; i < n; i++) {
    const p = liste[i];
    S.defs.push({
      player: p,
      // Weltlage relativ zur Schussachse: ab = Meter vom Ball Richtung Tor,
      // quer = Meter seitlich davon. Beides sind echte Längen, keine Tor-Einheiten.
      // ab < 0 heißt: der Verteidiger ist überspielt und steht hinter dem Ball.
      ab: rFloat(rng, BLOCK_AB_HINTEN, BLOCK_AB_ANTEIL * sz.distance + 1.5),
      quer: clamp(rGauss(rng, 0, BLOCK_QUER_STREU), -BLOCK_QUER_MAX, BLOCK_QUER_MAX),
      speed: rFloat(rng, BLOCK_ZU_SPEED[0], BLOCK_ZU_SPEED[1])
        * (0.7 + att(p, 'tempo') / 160) * (0.75 + 0.5 * pressure / 100),
      hoehe: BLOCK_H_BASIS + BLOCK_H_SPRUNG * (att(p, 'sprungkraft') / 99),
      wx: 0, wy: 0
    });
  }
  defPositionen(S);
  return S;
}

/** Weltpositionen der Verteidiger aus ab (Achse) und quer (senkrecht dazu). */
function defPositionen(S) {
  const sz = S.szene;
  const D = Math.max(1e-6, sz.distance);
  const nx = -sz.seit / D, ny = -sz.tiefe / D;   // Ball -> Tormitte
  const qx = -ny, qy = nx;
  for (const d of S.defs) {
    d.wx = sz.seit + nx * d.ab + qx * d.quer;
    d.wy = sz.tiefe + ny * d.ab + qy * d.quer;
  }
}

/** Die drei sichtbaren Torkanten als Weltkoordinaten – einmal, nicht je Frame. */
const TOR_KANTEN = [
  [-TOR_HALB, 0, -TOR_HALB, TOR_HOEHE],
  [TOR_HALB, 0, TOR_HALB, TOR_HOEHE],
  [-TOR_HALB, TOR_HOEHE, TOR_HALB, TOR_HOEHE]
];

/** Vergleicher: hintere Verteidiger zuerst zeichnen. */
const nachTiefe = (a, b) => b.ab - a.ab;

/** Querlage der Ziellinie in der Tiefe eines Verteidigers (Meter). */
function zielQuerBei(S, ab) {
  const sz = S.szene;
  const D = Math.max(1e-6, sz.distance);
  const nx = -sz.seit / D, ny = -sz.tiefe / D;
  const qx = -ny, qy = nx;
  const zx = lerp(-TOR_HALB, TOR_HALB, S.aimU);
  const dx = zx - sz.seit, dy = -sz.tiefe;
  const L = Math.max(1e-6, Math.hypot(dx, dy));
  const f = clamp(ab / L, 0, 1);
  return (dx * f) * qx + (dy * f) * qy;
}

/**
 * Torwartposition aus Winkelhalbierender, Herauslaufen und Nachführung.
 *
 * `keeperOffset` ist bewusst in TORPROJEKTION gemessen: ein Schritt zur Seite
 * wirkt aus Sicht des Schützen doppelt, wenn der Torwart schon halb draußen
 * steht. Ohne diese Umrechnung deckt ein herausgelaufener Torwart das ganze Tor
 * ab, sobald er dem Zielkreuz folgt — er würde raten statt den Winkel zu stellen.
 */
function keeperPosition(S) {
  const sz = S.szene;
  S.keeperY = S.keeperOut * S.keeperRichtung.y;
  const anteil = sz.tiefe > 1e-6 ? clamp((sz.tiefe - S.keeperY) / sz.tiefe, 0, 1) : 1;
  S.keeperX = S.keeperBasisX + S.keeperOut * S.keeperRichtung.x + S.keeperOffset * anteil;
}

/**
 * Ein Zeitschritt der Szene — zufallsfrei und DOM-frei.
 * Der Prüfstand fährt damit dieselbe Mechanik wie die rAF-Schleife.
 */
export function schritt(S, dt) {
  S.t += dt; S.phaseT += dt;
  if (S.phase !== 'anlauf' && S.phase !== 'fenster' && S.phase !== 'flanke') return;

  // Der Torwart stellt den Winkel: er zieht in Richtung Zielkreuz, bleibt aber
  // in einem Korridor um seine Winkelhalbierende – die Ecken bleiben offen.
  const zielX = lerp(-TOR_HALB, TOR_HALB, S.aimU);
  const wunsch = clamp(zielX - S.keeperBasisX, -KEEPER_MAX_OFFSET, KEEPER_MAX_OFFSET);
  const gap = wunsch - S.keeperOffset;
  if (Math.abs(gap) > KEEPER_TRACK_DEADZONE) {
    const maxStep = KEEPER_TRACK_SPEED * (0.65 + 0.6 * S.keeperSkill01) * dt;
    S.keeperOffset += clamp(gap - Math.sign(gap) * KEEPER_TRACK_DEADZONE, -maxStep, maxStep);
  }
  S.keeperOffset = clamp(S.keeperOffset, -KEEPER_MAX_OFFSET, KEEPER_MAX_OFFSET);

  // … und läuft heraus, sobald der Ball beim Schützen ist.
  if (S.phase !== 'anlauf') {
    const fern = clamp(1.6 - S.szene.distance / KEEPER_OUT_FERN, 0.15, 1);
    S.keeperOut = clamp(S.keeperOut + S.outSpeed * fern * dt * (0.7 + 0.5 * S.diff), 0, S.keeperOutMax);
  }
  keeperPosition(S);

  // Verteidiger rücken heran und schieben leicht in die Schussrichtung nach.
  for (const d of S.defs) {
    // Wer schon überspielt ist (ab < 0), fällt weiter zurück – die Klemmung auf
    // BLOCK_AB_MIN gilt nur für die, die noch vor dem Ball sind.
    const zu = d.speed * dt * (0.65 + 0.45 * S.diff)
      * (d.ab > BLOCK_AB_MIN ? clamp((d.ab - BLOCK_AB_MIN) / 2.5, 0.15, 1) : 1);
    d.ab = d.ab > BLOCK_AB_MIN ? Math.max(BLOCK_AB_MIN, d.ab - zu) : d.ab - zu;
    const ziel = zielQuerBei(S, d.ab);
    const schritt = BLOCK_TRACK * dt;
    d.quer += clamp(ziel - d.quer, -schritt, schritt);
  }
  defPositionen(S);
}

/* ========================================================================== *
 *  ZIELHILFE
 * ========================================================================== */

/**
 * Abschusshöhe der Szene (Meter). Der Kopfball verlässt den Kopf, alles andere
 * den Rasen — und daran hängen Höhengrenze UND Bezugsbahnen. Ändert sie sich,
 * sind die gemerkten Werte ungültig; das passiert höchstens zweimal je Szene
 * (Kopfball: vor und nach dem Abschluss), nie im rAF-Takt.
 */
function startHoehe(S) {
  const z0 = S.startZ > BALL_R ? S.startZ : BALL_R;
  if (S.gemerktAb !== z0) {
    S.gemerktAb = z0;
    S.zDecke = {}; S.tFlug = {}; S.tFlugHoch = {};
    S.profilZTief = {}; S.profilZHoch = {};
  }
  return z0;
}

/**
 * Höhengrenze des Schusstyps über die Torbreite (Meter), in `DECKE_SPALTEN`
 * Streifen. Zwei Grenzen, die kleinere gewinnt:
 *
 *   • `spec.zMax` — was der Typ vom Fuß her hergibt (Flachschuss 1,60 m).
 *   • die Ballistik — die höchste Zielhöhe, für die `loeseAbschuss` mit der
 *     Abschussgeschwindigkeit dieses Typs überhaupt eine Lösung findet. Genau
 *     diese Funktion fragt auch `richtungZu()` beim Schuss; wo sie nichts
 *     findet, fällt der Abschluss auf eine Näherung zurück und der Ball landet
 *     NICHT dort, wo gezielt wurde. Gemessen für den Heber (zentral, auf die
 *     Tormitte): aus 6 m gibt es Lösungen bis 0,72 m, aus 8 m bis 0,20 m, ab
 *     9 m keine mehr — dort geht der Ball IMMER auf Ballhöhe über die Linie,
 *     egal wohin gezielt wird.
 *
 * WARUM STREIFEN und nicht eine Zahl fürs ganze Tor: die Grenze hängt an der
 * LÄNGE des Weges, nicht an der Torentfernung. Aus 4 m reicht der Heber in die
 * Mitte bis 1,75 m, in die Ecke (5,42 m Weg) nur bis 0,53 m. Mit einer einzigen
 * Zahl müsste man entweder in der Ecke zu viel versprechen (das Kreuz stand
 * gemessen 1,5 m über dem Ball) oder in der Mitte den Heber ganz verbieten,
 * obwohl er dort die beste Antwort auf den herausgelaufenen Torwart ist.
 *
 * Je Streifen wird sein WEITESTER Punkt gemessen: was dort geht, geht im ganzen
 * Streifen. Die Grenze ist monoton (weiter oder weiter weg ist nie leichter),
 * deshalb reicht eine Halbierung, und deshalb greifen die beiden Abkürzungen:
 * ist schon am kürzesten Weg nichts lösbar, ist es nirgends; reicht der längste
 * Weg bis zur Obergrenze, dann alle.
 *
 * Kosten: einmal je Szene und Typ. Flachschuss und Platzierter 0,1 ms (eine
 * Probe genügt), Heber 11–14 ms auf 4–8 m — nur dort gibt es überhaupt etwas zu
 * suchen — und unter 1 ms darüber. `zielhilfeVorwaermen()` erledigt das vor dem
 * ersten Frame (zusammen 6,8 ms im Mittel), danach ist es ein Feldzugriff.
 */
function deckeTabelle(S, typKey) {
  const z0 = startHoehe(S);
  const merk = S.zDecke[typKey];
  if (merk !== undefined) return merk;
  const spec = SHOT_TYPES[typKey] || SHOT_TYPES.flach;
  const sz = S.szene;
  const v0 = v0Von(spec, sz.distance);
  const obergrenze = Math.min(spec.zMax, AIM_Z_MAX);
  _deckeOpt.hoch = spec.hoch;
  _deckeOpt.tMax = spec.hoch ? 3.2 : 2.2;
  const y0 = Math.max(1, sz.tiefe);
  _start.x = sz.seit; _start.y = y0; _start.z = z0;
  _ziel.y = 0;
  /**
   * Höchste Höhe, die OHNE Luftwiderstand in der Entfernung D noch erreichbar
   * wäre (Wurfparabel-Einhüllende). Luft kann eine Bahn nur verkürzen, nie
   * verlängern — was hier schon nicht geht, geht mit Luft erst recht nicht.
   * Das spart die teure Suche in `loeseAbschuss` für alles, was ohnehin
   * unmöglich ist, und engt die Halbierung von vornherein ein.
   */
  const luftlosMax = (x) => {
    const dx = x - sz.seit;
    const D2 = dx * dx + y0 * y0;
    const v2 = v0 * v0;
    return z0 + (v2 * v2 - G * G * D2) / (2 * G * v2);
  };
  /**
   * Gefragt wird der Zweig, den auch `richtungZu()` zuerst nimmt. Dessen
   * zweiten Zweig (beim Heber die flache Lösung) lassen wir bewusst weg: er
   * hebt die Grenze gemessen um höchstens 1 cm (3 m: 2,36 gegen 2,37 m; ab 6 m
   * kein Unterschied), kostet aber die Hälfte der Rechenzeit. Zu wenig
   * versprechen ist erlaubt, zu viel nicht.
   * Der dritte Zweig (die luftlose Näherung) zählt nie als Lösung — er trifft
   * den Zielpunkt gar nicht, und genau daraus bestand Befund 2.
   */
  const geht = (x, z) => {
    if (z > luftlosMax(x)) return false;
    _ziel.x = x; _ziel.z = z;
    return !!loeseAbschuss(_start, _ziel, v0, _deckeOpt);
  };
  const grenze = (x, ob) => {
    if (ob <= BALL_R) return BALL_R;
    if (geht(x, ob)) return ob;
    if (!geht(x, AIM_Z_MIN)) return BALL_R;     // gar keine Lösung: der Ball rollt
    let a = AIM_Z_MIN, b = Math.min(ob, luftlosMax(x));
    for (let i = 0; i < DECKE_SCHRITTE; i++) {
      const m = 0.5 * (a + b);
      if (geht(x, m)) a = m; else b = m;
    }
    return a;
  };
  // Weitester Zielpunkt jedes Streifens. Die Tiefe ist für alle Spalten dieselbe,
  // deshalb ordnet die seitliche Ablage die Weglängen bereits richtig. Die
  // äußeren Streifen reichen bis an den Rand des Zielbereichs (aimU läuft von
  // −0,14 bis 1,14, damit man auch danebenzielen kann).
  const fernster = (i) => {
    const ua = i === 0 ? -0.14 : i / DECKE_SPALTEN;
    const ub = i === DECKE_SPALTEN - 1 ? 1.14 : (i + 1) / DECKE_SPALTEN;
    const xa = lerp(-TOR_HALB, TOR_HALB, ua), xb = lerp(-TOR_HALB, TOR_HALB, ub);
    return Math.abs(xa - sz.seit) >= Math.abs(xb - sz.seit) ? xa : xb;
  };
  const tab = new Float64Array(DECKE_SPALTEN);
  let iKurz = 0, iLang = 0, dKurz = Infinity, dLang = -1;
  for (let i = 0; i < DECKE_SPALTEN; i++) {
    const d = Math.abs(fernster(i) - sz.seit);
    if (d < dKurz) { dKurz = d; iKurz = i; }
    if (d > dLang) { dLang = d; iLang = i; }
  }
  const beste = grenze(fernster(iKurz), obergrenze);
  if (beste <= BALL_R || grenze(fernster(iLang), obergrenze) >= obergrenze) {
    tab.fill(beste <= BALL_R ? BALL_R : obergrenze);
  } else {
    for (let i = 0; i < DECKE_SPALTEN; i++) {
      tab[i] = i === iKurz ? beste : grenze(fernster(i), beste);
    }
  }
  S.zDecke[typKey] = tab;
  return tab;
}

/** Höhengrenze des Typs in der Torspalte u (Meter). */
function zDecke(S, typKey, u) {
  const tab = deckeTabelle(S, typKey);
  const i = clamp(Math.floor(clamp(u, 0, 0.999999) * DECKE_SPALTEN), 0, DECKE_SPALTEN - 1);
  return tab[i];
}

/**
 * DIE eine Stelle, die aus der Zielmarke (aimU, aimV) eine Höhe in Metern
 * macht. Zielkreuz, Skyline und `loeseSchuss()` fragen alle hier — deshalb kann
 * das Kreuz nicht mehr woanders stehen, als der Ball hinfliegt.
 */
function zZielVon(S, typKey, aimU, aimV) {
  return clamp(clamp(aimV, -0.05, 1.15) * TOR_HOEHE, AIM_Z_MIN, zDecke(S, typKey, aimU));
}

/**
 * Ab welcher Höhe (0..1 in Tor-Einheiten) ist die Torspalte u für diesen Typ
 * gesperrt? Das ist die Oberkante des gelben Bandes und zugleich die Höhe, an
 * der das Zielkreuz hängen bleibt.
 */
export function sperrHoehe(S, typKey, u) {
  return clamp(zDecke(S, SHOT_TYPES[typKey] ? typKey : 'flach',
    u === undefined ? 0.5 : u) / TOR_HOEHE, 0, 1);
}

/**
 * Eine Bezugsbahn des Typs auf die Zielhöhe `zZiel` integrieren: Flugzeit bis
 * zur Torlinie zurückgeben und das Höhenprofil über der Strecke in `profil`
 * ablegen (Anteil 0 = Abschuss, 1 = Torlinie). Es ist dieselbe Bahn, die auch
 * `loeseSchuss()` fliegt — inklusive der Abschusshöhe `z0` (Kopfball: am Kopf).
 */
function bezugsBahn(seit, tiefe, typKey, zZiel, profil, offset, z0) {
  const spec = SHOT_TYPES[typKey] || SHOT_TYPES.flach;
  const D = Math.hypot(seit, tiefe);
  const v0 = v0Von(spec, D);
  const y0 = Math.max(1, tiefe);
  const zAb = z0 === undefined ? BALL_R : z0;
  _start.x = seit; _start.y = y0; _start.z = zAb;
  _ziel.x = 0; _ziel.y = 0; _ziel.z = zZiel;
  const r = richtungZu(_start, _ziel, v0, spec.hoch);
  abschussVektor(v0, r.gier, r.neigung, _v0);
  _flugInit.tMax = spec.hoch ? 3.2 : 2.2;
  const f = createFlug(_flugInit);
  const tr = f.trefferEbene('y', 0);
  const t = tr ? tr.t : f.dauer;
  if (profil) {
    profil[offset] = zAb;
    for (let j = 1; j <= PROFIL_N; j++) {
      const s = f.trefferEbene('y', y0 * (1 - j / PROFIL_N));
      profil[offset + j] = s ? s.z : profil[offset + j - 1];
    }
  }
  f.freigeben();
  return t;
}

/**
 * Bezugsbahnen des Typs für diese Szene: je Typ ZWEI Bahnen — eine flach ins
 * Tor (PROFIL_Z_TIEF) und eine hoch (PROFIL_Z_HOCH). Einmal integriert, dann
 * gemerkt (rund 0,8 ms je Typ — nicht in jedem Frame bezahlbar).
 *
 * Warum zwei: die Zielhöhe ändert die Bahn nicht nur linear. Ein Heber auf den
 * unteren Torrand braucht bei gleicher Abschussgeschwindigkeit einen STEILEREN
 * Bogen als einer auf die Latte — er fliegt länger und steht über dem Torwart
 * höher, nicht tiefer. Mit einer einzigen Bezugsbahn plus linearer Korrektur
 * bekäme die Zielhilfe für den Heber genau das falsche Vorzeichen.
 *
 * Vorher stand hier die Näherung `Länge / (v0 · 0,93)`. Die unterschätzt den
 * Heber grob: über 11 m ergab sie 1,07 s gegen 1,51 s aus dem Modell — die
 * Heber-Skyline war also viel zu optimistisch.
 */
function bezugSichern(S, typKey) {
  startHoehe(S);                        // verwirft Gemerktes, wenn sich die Abschusshöhe geändert hat
  if (S.tFlug[typKey] !== undefined) return;
  // Beide Bezugshöhen müssen ERREICHBAR sein. Vorher stand die hohe fest auf
  // 2,05 m — für den Heber aus 6 m gibt es dorthin gar keine Bahn, gemessen
  // wurde also der Rückfall aus `richtungZu`, und `hoeheBei` interpolierte
  // daraus einen Bogen, den es nicht gibt (1,51 m über dem Torwart, wo in
  // Wahrheit keine Lösung existiert).
  // Die Bezugsbahnen fliegen auf die Tormitte – also gilt hier auch deren
  // Höhengrenze. (Der Aufruf setzt zugleich S.gemerktAb.)
  const decke = zDecke(S, typKey, 0.5);
  const z0 = S.gemerktAb;
  const zHoch = Math.min(PROFIL_Z_HOCH, decke);
  const zTief = Math.min(PROFIL_Z_TIEF, zHoch);
  const off = 2 * (TYP_INDEX[typKey] || 0) * (PROFIL_N + 1);
  const tTief = bezugsBahn(S.szene.seit, S.szene.tiefe, typKey, zTief,
    S.profil, off, z0);
  const tHoch = bezugsBahn(S.szene.seit, S.szene.tiefe, typKey, zHoch,
    S.profil, off + PROFIL_N + 1, z0);
  S.profilZTief[typKey] = zTief;
  S.profilZHoch[typKey] = zHoch;
  S.tFlug[typKey] = tTief;
  S.tFlugHoch[typKey] = tHoch;
}

/**
 * Alle Bezugsbahnen der Szene vor dem ersten Frame integrieren (rund 7 ms).
 * Nur die Darstellung ruft das auf — der DOM-freie Prüfstand fährt zehntausende
 * Szenen und soll dafür nicht bezahlen. Ohne das Vorwärmen kostet der erste
 * Tastendruck auf [2] mitten im Schussfenster 2,4 ms.
 */
export function zielhilfeVorwaermen(S) {
  if (S.typ === 'kopfball') { bezugSichern(S, 'kopfball'); return; }
  bezugSichern(S, 'flach'); bezugSichern(S, 'heber'); bezugSichern(S, 'platziert');
}

/**
 * Mischgewicht zwischen tiefer und hoher Bezugsbahn für die Zielhöhe z.
 * Die Stützhöhen kommen aus `bezugSichern` und liegen beide im erreichbaren
 * Bereich; liegen sie zu dicht beieinander (der Typ hat hier kaum Spielraum),
 * wird nicht extrapoliert, sondern die tiefe Bahn genommen.
 */
function bahnMischung(S, typKey, z) {
  const zt = S.profilZTief[typKey], zh = S.profilZHoch[typKey];
  const spanne = zh - zt;
  if (!(spanne > 0.05)) return 0;
  return clamp((z - zt) / spanne, -0.4, 1.4);
}

/**
 * Ballhöhe in der Ebene `anteil` (0 = Abschuss, 1 = Torlinie) für einen Schuss
 * auf die Zielhöhe zZiel — zwischen den beiden gemessenen Höhenprofilen.
 */
function hoeheBei(S, typKey, anteil, zZiel) {
  bezugSichern(S, typKey);
  const off = 2 * (TYP_INDEX[typKey] || 0) * (PROFIL_N + 1);
  const a = clamp(anteil, 0, 1) * PROFIL_N;
  const j = Math.min(PROFIL_N - 1, Math.floor(a)), fr = a - j;
  const zT = lerp(S.profil[off + j], S.profil[off + j + 1], fr);
  const zH = lerp(S.profil[off + PROFIL_N + 1 + j], S.profil[off + PROFIL_N + 2 + j], fr);
  return Math.max(BALL_R, lerp(zT, zH, bahnMischung(S, typKey, zZiel)));
}

/**
 * Flugzeit bis zu einer Ebene in der Tiefe yEbene (für die Zielhilfe).
 * Die Bezugswerte kommen aus dem echten Modell; quer über die Torbreite wird
 * mit dem Längenverhältnis im Grundriss skaliert.
 */
function flugzeitBis(S, zielX, zielZ, typKey, yEbene) {
  const sz = S.szene;
  bezugSichern(S, typKey);
  const dx = zielX - sz.seit;
  const L = Math.sqrt(dx * dx + sz.tiefe * sz.tiefe);
  const anteil = sz.tiefe > 1e-6 ? clamp((sz.tiefe - yEbene) / sz.tiefe, 0, 1) : 1;
  const t = lerp(S.tFlug[typKey], S.tFlugHoch[typKey], bahnMischung(S, typKey, zielZ));
  return t * (L / S.tFlugL) * anteil;
}

/**
 * Haltewahrscheinlichkeit des Torwarts für einen Treffer bei (dxk, hoehe) und
 * Flugzeit t. dxk ist der seitliche Abstand IN DER EBENE DES TORWARTS.
 * Eine Funktion für Auflösung und Anzeige — die Zielhilfe kann deshalb nicht
 * lügen.
 */
function haltewahrscheinlichkeit(S, dxk, hoehe, t, anLinie) {
  const out = anLinie ? 0 : S.keeperOut;
  const hochGrenze = lerp(KEEPER_HOCH_LINIE, KEEPER_HOCH_DRAUSSEN,
    clamp(out / KEEPER_HOCH_REF, 0, 1));
  if (hoehe > hochGrenze) return 0;
  const relOut = clamp(out / Math.max(1, S.szene.distance) / KEEPER_LAUF_REL, 0, 1);
  const lauf = lerp(1, KEEPER_LAUF_MALUS, relOut);
  const reach = twReichweite(S.twPar, t, hoehe) * S.twFaktor * lauf;
  if (reach <= 0) return 0;
  const rel = Math.abs(dxk) / reach;
  if (rel <= KEEPER_EDGE_VON) return 1;
  if (rel >= 1) return 0;
  return lerp(KEEPER_EDGE_P0, KEEPER_EDGE_P1, (rel - KEEPER_EDGE_VON) / (1 - KEEPER_EDGE_VON));
}

/**
 * Beste Haltechance: entweder dort, wo er steht — oder, wenn der Ball lange
 * genug unterwegs ist, nach dem Rückweg auf die Torlinie. Genau eine Funktion
 * für Auflösung UND Zielhilfe, damit die rote Skyline nicht lügen kann.
 */
function haltechance(S, xEbene, zEbene, tEbene, xLinie, zLinie, tLinie) {
  let p = haltewahrscheinlichkeit(S, xEbene - S.keeperX, zEbene, tEbene, false);
  if (p >= 1 || S.keeperY <= 0.3) return p;
  // Der Rückweg beginnt beim Abschuss, nicht erst wenn der Ball über ihm ist –
  // aber er kostet Umkehrzeit. Ein schneller Schuss ist vorher da.
  const tRueck = KEEPER_UMKEHR + S.keeperY / KEEPER_RUECK_SPEED;
  if (tLinie > tRueck) {
    const xL = S.keeperBasisX + S.keeperOffset;
    const pL = haltewahrscheinlichkeit(S, xLinie - xL, zLinie, tLinie - tRueck, true);
    if (pL > p) p = pL;
  }
  return p;
}

/**
 * Bis zu welcher Höhe (0..1 in Tor-Einheiten) ist der Torwart in dieser Spalte
 * eine echte Bedrohung? Das ist das rote Band der Skyline.
 *
 * Neu abgeleitet: für die Spalte u wird der Haltebereich aus
 * `twReichweite(tFlug(u, z), z)` invertiert — dieselbe Funktion, die auch den
 * Ausgang entscheidet. Vorher hing das an KEEPER_SAVE_EDGE/KEEPER_HEIGHT_FALLOFF,
 * die es beide nicht mehr gibt.
 *
 * Gerechnet wird — wie in der Auflösung (`loeseSchuss`, Schritt 6) — in der
 * EBENE DES TORWARTS, nicht auf der Torlinie. Für den Heber ist das der ganze
 * Unterschied: ein Ball, der auf der Linie bei 1,2 m einschlägt, segelt über dem
 * herausgelaufenen Torwart in drei Metern Höhe vorbei. Die Höhe dort kommt aus
 * der Wurfparabel durch beide Endpunkte (exakt ohne Luft, sehr gut mit).
 */
export function coverHoehe(S, u, typKey) {
  const typ = SHOT_TYPES[typKey] ? typKey : 'flach';
  const sz = S.szene;
  const zielX = lerp(-TOR_HALB, TOR_HALB, u);
  const anteil = sz.tiefe > 1e-6 ? clamp((sz.tiefe - S.keeperY) / sz.tiefe, 0, 1) : 1;
  // Wo kreuzt die Ziellinie die Ebene des Torwarts?
  const xk = sz.seit + (zielX - sz.seit) * anteil;
  const chance = (z) => {
    const tLinie = flugzeitBis(S, zielX, z, typ, 0);
    // Höhe in der Ebene des Torwarts – aus dem gemessenen Höhenprofil des Typs.
    const zk = hoeheBei(S, typ, anteil, z);
    return haltechance(S, xk, zk, tLinie * anteil, zielX, z, tLinie);
  };

  // Höher als bis zur Sperrhöhe wird nicht gefragt: dorthin kommt der Ball mit
  // diesem Typ ohnehin nicht, und die Haltefunktion bekäme eine Bahn vorgesetzt,
  // die es nicht gibt (genau der Fehler, aus dem der Phantom-Bogen entstand).
  const sperr = sperrHoehe(S, typ, u);
  if (sperr <= 1e-6) return 0;
  const N = 10;
  let letzteGut = -1;
  for (let i = 0; i <= N; i++) {
    if (chance((i / N) * sperr * TOR_HOEHE) >= COVER_SCHWELLE) letzteGut = i;
    else break;
  }
  if (letzteGut < 0) return 0;
  if (letzteGut >= N) return sperr;
  // Zwischen der letzten gedeckten und der ersten offenen Stützstelle interpolieren
  const z0 = (letzteGut / N) * sperr * TOR_HOEHE, z1 = ((letzteGut + 1) / N) * sperr * TOR_HOEHE;
  const p0 = chance(z0);
  const p1 = chance(z1);
  const f = p0 === p1 ? 0 : clamp((p0 - COVER_SCHWELLE) / (p0 - p1), 0, 1);
  return clamp(lerp(z0, z1, f) / TOR_HOEHE, 0, sperr);
}

/**
 * Wirklich freie Höhe der Spalte u (0..1 in Tor-Einheiten): das gelbe Band
 * zwischen der roten Skyline und dem grauen Sperrband. Das ist die Größe, an
 * der ein Spieler ablesen kann, ob es sich lohnt zu zielen.
 */
export function freieHoehe(S, u, typKey) {
  const typ = SHOT_TYPES[typKey] ? typKey : 'flach';
  return Math.max(0, sperrHoehe(S, typ, u) - coverHoehe(S, u, typ));
}

/**
 * Anteil der TORFLÄCHE, der nicht gelb ist: der Torwart (rot) plus das, wohin
 * dieser Typ den Ball gar nicht bringt (grau). Genau die gezeichnete Fläche —
 * der Prüfstand rechnet damit nach, dass rot + gelb + grau das Tor ergeben.
 *
 * IM BILD steht diese Zahl nicht mehr. Sie beschreibt das Bild richtig, aber sie
 * beantwortet die Frage nicht, für die sie benutzt wurde: welcher der drei
 * Knöpfe? Grau wiegt darin so schwer wie Rot, obwohl ein schmales gelbes Band
 * über dem herausgelaufenen Torwart die beste Chance der Szene sein kann.
 * Gegen eine unabhängig erhobene Wahrheit führt sie in 49,5±1,8 % der
 * Großchancen-Lagen und in 31,2±4,8 % der Lagen im kurzen Band den falschen
 * Knopf an (sechs Saatfamilien); im Bild steht deshalb `torchance` (Zahlen und
 * Messweise im Dateikopf).
 *
 * Zwei Prozentzahlen über dieselbe Lage waren schon einmal der Fehler: vorher
 * zeigte die Fußzeile „WINKEL ZU x %" aus einer reinen Winkelformel
 * (`coverFrac`), während die rote Fläche im Tor aus der Haltefunktion kam —
 * 25 m ergaben 22 % im Text gegen 80 % im Bild, 16 m 22 % gegen 68 %. Die
 * Winkelformel des Plans (Punkt 6) beschreibt nur, wie viel Winkel der Torwart
 * mit seinem Körper verstellt; sie unterschlägt, dass er bei einer Sekunde
 * Flugzeit ohnehin überall hinkommt. Sie ist ersatzlos entfallen.
 */
export function abdeckung(S, typKey) {
  let frei = 0;
  for (let i = 0; i < SKYLINE_SPALTEN; i++) {
    frei += freieHoehe(S, (i + 0.5) / SKYLINE_SPALTEN, typKey);
  }
  return clamp(1 - frei / SKYLINE_SPALTEN, 0, 1);
}

/**
 * Torchance EINES Zielpunkts (aimU, aimV) für diesen Typ (0..1) — der Kern der
 * Zahl im Bild:
 *
 *   1. die eigene Streuung um den Punkt legen (dieselbe wie in `loeseSchuss()`,
 *      bei sauberem Timing) und fragen, wie viel davon im Tor OBERHALB der
 *      roten Skyline landet,
 *   2. mal die Wahrscheinlichkeit, dass kein Verteidiger im Weg steht.
 *
 * Die roten und grauen Spalten stehen bereits in `S.chanceSpalten` — `torchance`
 * füllt sie einmal je Aufruf und probiert dann viele Zielpunkte dagegen.
 *
 * ZWEI DINGE, DIE HIER NICHT (MEHR) STEHEN — beide über sechs unabhängige
 * Saatfamilien gemessen (Mittel ± Standardfehler über die Familien; Messweise
 * wie im Dateikopf, 36 bzw. 23 Lagen je Familie).
 *
 * (1) DIE BODENZÄHLUNG IST ENTFALLEN. Bis zu dieser Welle reichte die Zählung
 *     in Spalten OHNE rotes Band nach unten offen weiter als bis zur Torlinie
 *     (`unten = −Infinity`): Begründung war, dass `loeseSchuss()` die untere
 *     Gaußhälfte nicht wegklemmt, sondern den Ball aufsetzen lässt — er springt
 *     und rollt trotzdem über die Linie. Das stimmt für den Ball, aber nicht für
 *     die Zahl: der Torwart pflückt ihn dort sehr wohl herunter — an vier
 *     Nahbereichslagen nachgemessen (je 400 Abschlüsse auf den angezeigten
 *     Zielpunkt) in 2,5 %, 12,8 %, 21,8 % und 28,3 % der Fälle, während die
 *     Zählung ihm die ganze Masse gutschrieb.
 *
 *     DAS IST EIN TAUSCH, KEIN FREIER GEWINN. Weil beide Stände über dieselben
 *     Saatfamilien laufen, ist die GEPAARTE Differenz die ehrliche Zahl (Mittel
 *     ± Standardfehler der Differenz, n = 6; Großchancen-Mischung / kurzes
 *     Band, negativ = besser):
 *
 *       Eichfehler Heber gegen (b)     −3,8±1,4 (t 2,8) · −7,8±1,4 (t 5,4)
 *       Lücke (a) − (b) beim Heber     −1,2±1,3 (t 0,9) · −3,8±1,7 (t 2,2)
 *       größte Übertreibung EINZELLAGE −14,4±15,8 (t 0,9) · −10,0±4,9 (t 2,1)
 *       wer der Zahl WIRKLICH folgt    +1,7±0,9 (t 1,8) · +1,2±1,3 (t 0,9)
 *       falsch angeführter Knopf       +1,4±1,6 (t 0,9) · +6,5±2,4 (t 2,7)
 *
 *     Gekauft wird die Eichung im kurzen Band: der Heber verspricht dort nicht
 *     mehr 16,4, sondern 8,7 Punkte zu viel, und das ist der klarste Effekt der
 *     ganzen Tabelle (t 5,4). Bezahlt wird mit der Knopfwahl im kurzen Band:
 *     6,5 Punkte häufiger der falsche Knopf, ebenfalls belastbar (t 2,7). Genau
 *     dafür hatte die vorige Welle die Zählung eingebaut — allerdings gegen EINE
 *     Saatfolge gemessen. Was ein Spieler am Ende TRIFFT, ändert sich in keiner
 *     Richtung belastbar (t 1,8 bzw. 0,9); in der Mischung ändert sich außer der
 *     Heber-Eichung überhaupt nichts Signifikantes, und dort wird sie sogar
 *     3,8 Punkte schlechter (von fast null auf 3,7 Punkte Untertreibung).
 *
 *     Entschieden wurde für die Eichung, weil die Fußzeile eine
 *     WAHRSCHEINLICHKEIT behauptet: eine Zahl, die 93 % anzeigt und 83 %
 *     liefert, bricht die Zusage dieser Szene („genau eine Größe, und die lügt
 *     nicht"), während ein falsch angeführter Knopf sie nur schlecht berät —
 *     und das messbar ohne Folgen für die Trefferquote. Wer anders gewichtet,
 *     dreht `unten` wieder auf `sp[i] > 0 ? … : −Infinity` und holt sich die
 *     16,4 Punkte Übertreibung im kurzen Band zurück.
 *
 * (2) EINE 2-D-DURCHLASSTABELLE STATT DER SCHWELLE — GEBAUT, GEMESSEN, WIEDER
 *     AUSGEBAUT. `COVER_SCHWELLE = 0,45` ist eine binäre Kante: eine Spalte, in
 *     der der Torwart mit 44 % hält, zählt als ganz offen. Der naheliegende
 *     Ersatz ist ein 30 × 8-Raster über die Torfläche, das je Zelle die
 *     tatsächliche Haltewahrscheinlichkeit führt. Gebaut und über dieselben
 *     sechs Saatfamilien gemessen (gepaarte Differenz gegen den Stand mit
 *     Schwelle, Mischung / kurzes Band, negativ = besser):
 *
 *       Eichfehler flach       −4,4±0,5 (t 8,6)  ·  −2,0±0,5 (t 4,3)
 *       Eichfehler platziert   −3,3±0,2 (t 21,1) ·  −1,5±0,4 (t 3,4)
 *       Eichfehler Heber       −2,5±2,0 (t 1,3)  ·  +2,4±1,7 (t 1,4)
 *       Lücke (a) − (b) Heber +19,7±1,9 (t 10,6) ·  +3,3±1,5 (t 2,2)
 *
 *     Die Diagnose der Schwelle ist für FLACH und PLATZIERT richtig, und zwar
 *     eindeutig: ihr Eichfehler fällt um zwei Drittel, bei t 3,4 bis 21. Für den
 *     HEBER ist sie falsch — dort ändert sich nichts Belastbares (t 1,3/1,4),
 *     denn die Haltefunktion gibt in der ganzen Torfläche nicht 0,44 zurück,
 *     sondern exakt 0. Grund: die Bezugsbahn des Hebers ist
 *     im Nahbereich eine Lobbahn auf die Tormitte, und die liegt in der Ebene
 *     des Torwarts über `KEEPER_HOCH_LINIE` — `haltewahrscheinlichkeit` steigt
 *     dort mit `return 0` aus. Eine Schwelle über lauter Nullen kann nichts
 *     unterschlagen; die Tabelle bildet dieselben Nullen nur feiner ab.
 *
 *     Ausgebaut wurde sie aus zwei Gründen, die beide nicht verhandelbar sind:
 *     sie kostet 0,59 ms für die drei Knöpfe gegen ein Budget von 0,5 ms
 *     (Abschnitt 4c; mit vier statt acht Höhenstufen 0,38–0,43 ms, also nur
 *     knapp darunter), und sie treibt die Lücke des Hebers in der Mischung in
 *     JEDER geprüften Fassung über die Regressionsklammer von 25 Punkten
 *     (32,7 mit Bodenzählung, 27,6 ohne, 27,2 bei vier Höhenstufen). Eine
 *     Abnahmegrenze zu lockern, damit die eigene Änderung hineinpasst, ist keine
 *     Option — also ist die Änderung gegangen.
 *
 *     Für die nächste Welle: die Schwelle ist NICHT die Wurzel des Heberfehlers.
 *     Die Wurzel ist die Bezugsbahn (`bezugSichern`/`hoeheBei`), die für den
 *     Heber eine Lobbahn auf die TORMITTE misst und sie für jede Spalte
 *     wiederverwendet. Wer den Heber eichen will, fängt dort an.
 */
function chanceAmZiel(S, typ, spec, uZiel, vZiel) {
  const sz = S.szene;
  const sp = S.chanceSpalten;
  const zZiel = zZielVon(S, typ, uZiel, vZiel);
  const zx = lerp(-TOR_HALB, TOR_HALB, uZiel);
  const sigma = AIM_SPREAD_RAD * S.spreadMult * spec.spread;
  const L = Math.hypot(zx - sz.seit, sz.tiefe);
  const sH = sigma * L;
  const sV = sH * VERT_SPREAD_RATIO;

  let p = 0;
  for (let i = 0; i < SKYLINE_SPALTEN; i++) {
    const x0 = lerp(-TOR_HALB, TOR_HALB, i / SKYLINE_SPALTEN);
    const x1 = lerp(-TOR_HALB, TOR_HALB, (i + 1) / SKYLINE_SPALTEN);
    const quer = normMasse(x0 - zx, x1 - zx, sH);
    if (quer < 1e-4) continue;
    // Gezählt wird von der Oberkante des roten Bandes bis zur Latte. Wo die
    // Spalte kein rotes Band hat, ist die Untergrenze die Torlinie.
    p += quer * normMasse(sp[i] * TOR_HOEHE - zZiel, TOR_HOEHE - zZiel, sV);
  }

  // Verteidiger: wer schon überspielt ist oder wem die Bahn über den Kopf geht,
  // zählt nicht. Die übrigen bekommen ihre Körperbreite plus Ballradius, gemessen
  // in ihrer eigenen Tiefe — dieselbe Quaderbreite wie in `loeseSchuss()`.
  // Indexschleife statt `for … of`: `torchance` ruft das je Frame 360-mal auf,
  // und ein Array-Iterator ist eine Allokation.
  for (let di = 0; di < S.defs.length; di++) {
    const d = S.defs[di];
    if (p <= 0) break;
    if (d.ab < BLOCK_AB_AKTIV) continue;
    const f = sz.tiefe > 1e-6 ? clamp((sz.tiefe - d.wy) / sz.tiefe, 0, 1) : 1;
    if (hoeheBei(S, typ, f, zZiel) > d.hoehe + BALL_R) continue;
    const xB = sz.seit + (zx - sz.seit) * f;
    const sd = sigma * Math.hypot(xB - sz.seit, sz.tiefe - d.wy);
    p *= 1 - normMasse(d.wx - BLOCK_HALB_X - BALL_R - xB,
      d.wx + BLOCK_HALB_X + BALL_R - xB, sd);
  }
  return p;
}

/**
 * DIE Zahl im Bild: die TORCHANCE dieses Schusstyps (0..1). Sie steht an seinem
 * Knopf in der Fußzeile und beantwortet die Frage, für die der Spieler die Zahl
 * benutzt — welcher von [1], [2], [3]?
 *
 * Gerechnet über dieselben Spalten, die gezeichnet werden: einmal die rote und
 * die graue Kante je Spalte, dann ein RASTER von Zielpunkten über die Torfläche
 * — jede Spalte quer, je Spalte `ZIEL_HOEHEN + 1` Höhen von der roten bis zur
 * grauen Kante. Der beste Punkt gewinnt, und „bester Punkt" heißt: bester nach
 * der VOLLSTÄNDIGEN Bewertung (`chanceAmZiel`), also gelbes Band UND
 * Verteidigerlage UND eigene Streuung.
 *
 * Vorher wurde der Zielpunkt in zwei Stufen gesucht: erst das breiteste gelbe
 * Band, dann dort die Bewertung. Das war voreingenommen. Die Skyline ist im
 * Normalfall spiegelsymmetrisch, `s - c > bFrei` behielt bei Gleichstand die
 * linkeste Spalte — die Zahl bewertete also immer den linken Pfosten. Stand dort
 * ein Verteidiger, beschrieb sie ausgerechnet die zugestellte Seite, während die
 * spiegelbildlich freie Seite offen war. Die Verteidiger gingen in die Wahl des
 * Punktes überhaupt nicht ein, obwohl sie in seine Bewertung eingehen.
 *
 * Was die Umstellung gebracht hat — und was nicht. Beide Stände gegen dieselbe
 * unabhängige Wahrheit (Abschnitt 4b), Großchancen-Mischung / kurzes Band,
 * „falscher Knopf" und größter Eichfehler gegen (a) (Vorzeichen: + = zu viel
 * versprochen). Die Zahlen der zweistufigen Suche stammen noch aus EINEM Lauf
 * und sind deshalb ohne Fehlerband; alles darunter ist über sechs Saatfamilien
 * gemessen:
 *
 *   zweistufige Suche (vorige Welle)  27,8 % / 17,4 %       −48,2 / −38,9 P.
 *   vollständige Suche                38,4±1,8 / 21,7±3,4   +9,8±1,0 / +7,7±0,7
 *
 * Die Eichung ist damit vier- bis fünfmal besser: die zweistufige Suche
 * bewertete einen schlechten Punkt und untertrieb deshalb um 36 bis 48 Punkte.
 * Die SORTIERUNG der Knöpfe ist dagegen nicht besser geworden, sondern
 * schlechter. Das ist kein Argument für die voreingenommene Suche: sie ist
 * nachweislich falsch, und ihre bessere Sortierung war Zufall — ihr 27,8 %
 * stammt zudem aus einer einzigen Saatfolge, und die Streuung dieser Kennzahl
 * über Saatfamilien beträgt allein ±4,5 (Mischung) bzw. ±8,2 Punkte (kurzes
 * Band). Der Abstand ist also kaum größer als das Rauschen.
 * Der Zeiger bleibt: der nächste Fehler sitzt in der BEWERTUNG eines Punktes
 * (Dateikopf), und eine ehrliche Suche legt ihn frei, statt ihn zu verdecken.
 *
 * Warum nicht die zugestellte Fläche (`abdeckung`): sie wiegt Grau wie Rot und
 * hat den Heber im kurzen Band systematisch verboten, obwohl er dort der beste
 * Schuss ist (Zahlen im Dateikopf). Warum das Graue trotzdem nicht einfach
 * wegfällt: über der Sperrkante kann der Ball nur noch durch STREUUNG landen —
 * gezielt wird dorthin nicht (`zZielVon` deckelt jeden Zielpunkt auf `zDecke`),
 * und deshalb schrumpft ein grau gedeckelter Typ hier von selbst, statt per
 * Strafabzug.
 *
 * Kosten: gemessen 0,060 ms je Typ, 0,181 ms für alle drei Knöpfe zusammen
 * (Median über 1000 Frames, Abschnitt 4c des Prüfstands) — das Budget von
 * 0,5 ms je Frame steht. Die Spalten sind weiterhin das Teure; das Raster
 * rechnet nur mit den bereits gefüllten Spaltenhöhen weiter.
 *
 * Der optionale dritte Parameter `ausgabe` bekommt den GEWÄHLTEN Zielpunkt
 * (`ausgabe.u`, `ausgabe.v` in denselben 0..1-Marken, die auch `loeseSchuss()`
 * entgegennimmt). Die Zeichenaufrufe lassen ihn weg — die Signatur bleibt für
 * sie unverändert, und ohne Objekt wird nichts geschrieben, also auch nichts im
 * rAF-Takt angelegt. Er ist nicht Diagnose, sondern Abnahmegröße: ohne ihn kann
 * ein Prüfstand nur messen, was in dieser Lage MÖGLICH wäre, nie, was der
 * Spieler bekommt, wenn er der Anzeige folgt. Genau diese Lücke misst Abschnitt
 * 4b des Prüfstands; eine falsche Zielpunktwahl wäre sonst strukturell
 * unsichtbar, weil die Zahl beliebig schlecht zielen dürfte, solange irgendwo
 * auf der Torfläche ein guter Punkt liegt.
 */
export function torchance(S, typKey, ausgabe) {
  const typ = SHOT_TYPES[typKey] ? typKey : 'flach';
  const spec = SHOT_TYPES[typ];
  const sp = S.chanceSpalten;
  for (let i = 0; i < SKYLINE_SPALTEN; i++) {
    const u = (i + 0.5) / SKYLINE_SPALTEN;
    sp[i] = coverHoehe(S, u, typ);
    sp[SKYLINE_SPALTEN + i] = sperrHoehe(S, typ, u);
  }
  // `best` startet bei -1, nicht bei 0: sonst bliebe der gewählte Punkt in einer
  // Lage ohne jede Chance (alle p = 0) unbesetzt, und `ausgabe` meldete einen
  // Punkt, den die Suche nie angesehen hat. Am Rückgabewert ändert das nichts,
  // `clamp` hebt -1 auf 0.
  let best = -1, bu = 0.5, bv = 0.5;
  for (let i = 0; i < SKYLINE_SPALTEN; i++) {
    const uZiel = (i + 0.5) / SKYLINE_SPALTEN;
    const c = sp[i], s = sp[SKYLINE_SPALTEN + i];
    const band = s - c;
    for (let k = 0; k <= ZIEL_HOEHEN; k++) {
      // Ohne gelbes Band bleibt nur die Sperrkante — genau dort hängt dann auch
      // das Zielkreuz, weil `zZielVon` auf `zDecke` deckelt.
      const vZiel = band > 1e-6 ? c + band * (k / ZIEL_HOEHEN) : s;
      const p = chanceAmZiel(S, typ, spec, uZiel, vZiel);
      if (p > best) { best = p; bu = uZiel; bv = vZiel; }
      if (!(band > 1e-6)) break;
    }
  }
  if (ausgabe) { ausgabe.u = bu; ausgabe.v = bv; }
  return clamp(best, 0, 1);
}

/* ========================================================================== *
 *  AUFLÖSUNG EINES ABSCHLUSSES  (geometrisch, aus der integrierten Bahn)
 * ========================================================================== */

const _v0 = { x: 0, y: 0, z: 0 };
const _start = { x: 0, y: 0, z: 0 };
const _ziel = { x: 0, y: 0, z: 0 };
const _flugInit = { p: _start, v: _v0, w: null, wind: null, boden: BALL_R, tMax: 3.2 };
const _min = { x: 0, y: 0, z: 0 };
const _max = { x: 0, y: 0, z: 0 };
const _sA = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
/** Optionen der Lösbarkeitsproben in `deckeTabelle` – konstant, keine Allokation. */
const _deckeOpt = { hoch: false, tMax: 2.2 };

/** Abschussrichtung zu einem Zielpunkt, mit Rückfall auf die luftlose Näherung. */
function richtungZu(start, ziel, v0, hoch) {
  const loes = loeseAbschuss(start, ziel, v0, { hoch, tMax: 3.2 });
  if (loes) return loes;
  const alt = hoch ? loeseAbschuss(start, ziel, v0, { tMax: 3.2 }) : null;
  if (alt) return alt;
  const dx = ziel.x - start.x, dy = ziel.y - start.y, dz = ziel.z - start.z;
  const D = Math.max(1e-6, Math.hypot(dx, dy));
  return { gier: Math.atan2(dy, dx), neigung: Math.atan2(dz, D) + 0.10, t: D / v0 };
}

/**
 * Löst einen Abschluss vollständig geometrisch auf:
 * Abschussparameter würfeln -> Bahn integrieren -> Block -> Torwart -> Rahmen.
 *
 * Rückgabe zusätzlich zu CONTRACTS 6.1:
 *   _flug     integrierte Bahn (muss vom Aufrufer freigegeben werden)
 *   _abgelenkt zweite Bahn nach einem Streifschuss (oder null)
 *   _tEnde    Zeitpunkt des entscheidenden Ereignisses in Sekunden
 */
export function loeseSchuss(S, typKey, aimU, aimV, tFrac, rng) {
  const spec = SHOT_TYPES[typKey] || SHOT_TYPES.flach;
  const sz = S.szene;

  /* 1) Streuung: früh = wacklig, spät = sauber gestanden. */
  const settleMult = tFrac < SETTLE_FRAC
    ? lerp(EARLY_SPREAD_MULT, 1, clamp(tFrac / SETTLE_FRAC, 0, 1))
    : lerp(1, LATE_SPREAD_MULT, clamp((tFrac - SETTLE_FRAC) / (1 - SETTLE_FRAC), 0, 1));
  // Punkt 8: ganz am Fensterende reißt der Abschluss ab.
  const hetze = tFrac > 0.9;
  const sigmaGier = AIM_SPREAD_RAD * S.spreadMult * settleMult * spec.spread * (hetze ? 2 : 1);
  const sigmaNeig = sigmaGier * VERT_SPREAD_RATIO;

  /* 2) Zielpunkt in Weltkoordinaten.
   * Die Höhe kommt aus derselben Funktion, die auch das Zielkreuz setzt und die
   * Skyline deckelt — deshalb fliegt der Ball genau dorthin, wo das Kreuz steht.
   * (zDecke() vor dem Beschreiben der Kratzobjekte fragen: sie teilt sie sich.) */
  const zZiel = zZielVon(S, typKey, aimU, aimV);
  _ziel.x = lerp(-TOR_HALB, TOR_HALB, clamp(aimU, -0.14, 1.14));
  _ziel.y = 0;
  _ziel.z = zZiel;

  _start.x = sz.seit; _start.y = sz.tiefe;
  _start.z = S.startZ > BALL_R ? S.startZ : BALL_R;   // Kopfball startet am Kopf

  /* 3) Abschussparameter. */
  const v0 = v0Von(spec, sz.distance) * (hetze ? 0.75 : 1) * (0.90 + 0.20 * S.skill01);
  const r = richtungZu(_start, _ziel, v0, spec.hoch);
  const gier = r.gier + rGauss(rng, 0, sigmaGier);
  const neigung = clamp(r.neigung + rGauss(rng, 0, sigmaNeig), -0.6, 1.45);
  abschussVektor(v0, gier, neigung, _v0);
  _flugInit.tMax = spec.hoch ? 3.2 : 2.2;
  const flug = createFlug(_flugInit);

  const torTreffer = flug.trefferEbene('y', 0);
  const tTor = torTreffer ? torTreffer.t : flug.dauer;

  /* 4) Block: Verteidigerkörper als Quader auf der Bahn. */
  let block = null;
  for (const d of S.defs) {
    if (d.ab < BLOCK_AB_AKTIV) continue;     // überspielt – der steht nicht mehr im Weg
    _min.x = d.wx - BLOCK_HALB_X; _max.x = d.wx + BLOCK_HALB_X;
    _min.y = d.wy - BLOCK_HALB_Y; _max.y = d.wy + BLOCK_HALB_Y;
    _min.z = 0; _max.z = d.hoehe;
    const tr = flug.trefferQuader(_min, _max, 0, tTor);
    if (tr && (!block || tr.t < block.t)) block = tr;
  }

  let abgelenkt = null;
  let geblockt = false;
  if (block) {
    const streif = block.flaeche === 'x-' || block.flaeche === 'x+';
    if (streif) {
      // Streiftreffer am Körperrand: der Ball wird abgefälscht, nicht gestoppt.
      const s = flug.at(block.t, _sA);
      const grad = rFloat(rng, ABLENK_GRAD[0], ABLENK_GRAD[1]) * (block.flaeche === 'x+' ? 1 : -1);
      const w = grad * Math.PI / 180;
      const co = Math.cos(w), si = Math.sin(w);
      _start.x = s.x; _start.y = s.y; _start.z = Math.max(BALL_R, s.z);
      _v0.x = s.vx * co - s.vy * si;
      _v0.y = s.vx * si + s.vy * co;
      _v0.z = s.vz;
      _flugInit.tMax = 2.2;
      abgelenkt = createFlug(_flugInit);
    } else {
      geblockt = true;
    }
  }

  const bahn = abgelenkt || flug;
  // Die abgefälschte Bahn hat eine EIGENE Zeitbasis ab dem Streifpunkt.
  const tVersatz = abgelenkt ? block.t : 0;
  const treffer = abgelenkt ? bahn.trefferEbene('y', 0) : torTreffer;
  const tEbene = treffer ? treffer.t : bahn.dauer;

  /* 5) Rahmen: innerhalb des Tores, Aluminium oder daneben. */
  let drin = false, holz = null;
  if (treffer) {
    const ax = Math.abs(treffer.x);
    const innenX = ax <= TOR_HALB, innenZ = treffer.z <= TOR_HOEHE && treffer.z >= 0;
    drin = innenX && innenZ;
    if (!drin) {
      const nahPfosten = !innenX && ax < TOR_HALB + HOLZ_BAND;
      const nahLatte = !innenZ && treffer.z < TOR_HOEHE + HOLZ_BAND;
      if (nahLatte && innenX) holz = 'latte';
      else if (nahPfosten && (innenZ || nahLatte)) holz = 'pfosten';
    }
  }

  /* 6) Torwart: Abfangebene ist seine eigene Tiefe, nicht die Torlinie. */
  let gehalten = false, dxk = 0, tKeeper = tEbene;
  if (drin && !geblockt) {
    const kY = Math.max(0, S.keeperY);
    const tr = kY > 0.02 ? bahn.trefferEbene('y', kY) : treffer;
    if (tr) {
      tKeeper = tr.t;
      dxk = tr.x - S.keeperX;
      let p = haltechance(S, tr.x, tr.z, tr.t, treffer.x, treffer.z, treffer.t);
      // Punkt 9: ein Aufsetzer vor dem Torwart ist schwerer zu greifen.
      if (p > 0) {
        const auf = bahn.aufsetzer();
        for (const a of auf) {
          if (a.t < tr.t) { p *= 1 - rFloat(rng, AUFSETZER_MALUS[0], AUFSETZER_MALUS[1]); break; }
        }
      }
      gehalten = p > 0 && (p >= 1 || rChance(rng, p));
    }
  }

  /* 7) Ausführungsgüte (das ist die Leistung des Menschen am Schirm). */
  // Wie weit vom Torwart – gemessen in der Torebene, damit „Ecke" Ecke bleibt.
  const anteil = sz.tiefe > 1e-6 ? clamp(sz.tiefe / Math.max(0.4, sz.tiefe - S.keeperY), 0, 6) : 1;
  const kProj = S.keeperX + (S.keeperX - sz.seit) * (anteil - 1);
  const zx = treffer ? treffer.x : 0, zz = treffer ? treffer.z : 0;
  // Referenz ist die halbe Torbreite, nicht mehr die alten 0,42 Tor-Einheiten
  // (= 3,07 m): mit der jetzt distanzabhängigen Streuung geht kaum noch ein
  // Abschluss aus kurzer Distanz daneben, und die alte, engere Referenz hätte
  // die Ausführungsgüte dadurch systematisch angehoben (gemessen +13,5 % Σ xG).
  const placement = clamp(Math.abs(zx - kProj) / TOR_HALB, 0, 1);
  const cornerV = clamp(Math.abs(zz - 1.02) / 1.17, 0, 1);
  const timingBonus = clamp(1 - Math.abs(tFrac - 0.55) / 0.55, 0, 1);
  const offTarget = drin ? 0 : (holz ? 0.45 : 1);
  let quality = 0.20
    + 0.40 * placement
    + 0.16 * cornerV
    + 0.16 * timingBonus
    - 0.42 * offTarget
    - 0.18 * (geblockt ? 1 : 0);
  quality = clamp(quality * (0.82 + 0.24 * S.skill01), 0, 1);

  let outcome;
  if (geblockt) outcome = 'geblockt';
  else if (!drin) outcome = holz || 'daneben';
  else if (gehalten) outcome = 'parade';
  else outcome = 'tor';

  if (outcome === 'tor') quality = clamp(quality + 0.12, 0, 1);
  if (outcome === 'latte' || outcome === 'pfosten') quality = clamp(quality + 0.10, 0, 1);

  const xgDelta = clamp(
    XG_MIN + (XG_MAX - XG_MIN) * Math.pow(quality, 1.25) + spec.xg
    + (outcome === 'tor' ? 0.05 : 0) + (outcome === 'geblockt' ? -0.05 : 0),
    XG_MIN, XG_MAX);

  const tEnde = geblockt ? block.t
    : tVersatz + (outcome === 'parade' ? tKeeper
      : treffer ? tEbene + 0.10
        : Math.min(bahn.dauer, 1.4));

  return {
    outcome,
    quality,
    targetPlayerId: S.actor && S.actor.id ? S.actor.id : null,
    xgDelta,
    _flug: flug,
    _abgelenkt: abgelenkt,
    _bahn: bahn,
    _tVersatz: tVersatz,
    _tEnde: Math.max(0.05, tEnde),
    _typ: typKey
  };
}

/** Gibt die Flugbahnen eines Ergebnisses an den Pool zurück. */
function freigeben(res) {
  if (!res) return;
  if (res._flug) { res._flug.freigeben(); res._flug = null; }
  if (res._abgelenkt) { res._abgelenkt.freigeben(); res._abgelenkt = null; }
  res._bahn = null;
}

/* ========================================================================== *
 *  ZEICHEN-BAUSTEINE
 * ========================================================================== */

function fillRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Anstoß-Panel mit 2px-Bevel (hell oben/links, dunkel unten/rechts). */
function panel(ctx, x, y, w, h, bg = COL.beige) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
  ctx.strokeStyle = COL.outline; ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function text(ctx, str, x, y, opts = {}) {
  const size = opts.size || 16;
  const weight = opts.weight || 'bold';
  ctx.font = `${weight} ${size}px "Arial Black", "Arial", system-ui, sans-serif`;
  ctx.textAlign = opts.align || 'left';
  ctx.textBaseline = opts.baseline || 'alphabetic';
  if (opts.outline !== false) {
    ctx.lineWidth = opts.outlineWidth || Math.max(3, size * 0.22);
    ctx.strokeStyle = opts.outlineColor || COL.outline;
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = opts.color || COL.papier;
  ctx.fillText(str, x, y);
}

/** Fallback-Spielerfigur, falls host.drawPlayer fehlt oder wirft. */
function figureFallback(ctx, x, y, scale, colorA, colorB) {
  const s = scale * 34;
  ctx.save();
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.strokeStyle = COL.outline;
  // Beine
  ctx.strokeStyle = COL.outline; ctx.fillStyle = '#1c1c22';
  ctx.fillRect(x - s * 0.22, y - s * 0.45, s * 0.18, s * 0.45);
  ctx.fillRect(x + s * 0.04, y - s * 0.45, s * 0.18, s * 0.45);
  ctx.strokeRect(x - s * 0.22, y - s * 0.45, s * 0.18, s * 0.45);
  ctx.strokeRect(x + s * 0.04, y - s * 0.45, s * 0.18, s * 0.45);
  // Rumpf
  ctx.fillStyle = colorA;
  ctx.fillRect(x - s * 0.30, y - s * 1.05, s * 0.60, s * 0.62);
  ctx.strokeRect(x - s * 0.30, y - s * 1.05, s * 0.60, s * 0.62);
  ctx.fillStyle = colorB;
  ctx.fillRect(x - s * 0.30, y - s * 1.05, s * 0.60, s * 0.16);
  // Kopf
  ctx.fillStyle = '#d9a273';
  ctx.beginPath(); ctx.arc(x, y - s * 1.22, s * 0.20, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

/** Vereinsfarben aus dem Kontext (Paket 2 liefert sie; darf fehlen). */
function rangFarben(context) {
  const f = context && context.farben;
  const raus = [COL.rangHell, COL.rangDunkel];
  if (!f) return raus;
  const kandidaten = Array.isArray(f)
    ? f
    : [f.primary || f.heim || f.home, f.secondary || f.gast || f.away, f.accent];
  const gut = kandidaten.filter(c => typeof c === 'string'
    && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(c));
  if (gut.length >= 2) return [gut[0], gut[1]];
  if (gut.length === 1) return [gut[0], COL.rangDunkel];
  return raus;
}

/** Farbe abdunkeln (für die Rangstufen nach hinten). */
function dunkler(hex, f) {
  const h = hex.length === 4
    ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
    : hex;
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  const m = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

/* ========================================================================== *
 *  MINISPIEL
 * ========================================================================== */

export const minigame = {
  id: 'abschluss',
  kind: 'abschluss',
  title: 'Torabschluss',
  instructions:
    'Maus zielen · [1] flach, [2] Heber, [3] platziert wählen · Klick oder ' +
    '[Leertaste] schießt · bei Flanken: [Leertaste] im grünen Bereich · ' +
    '[ESC] Simulation entscheiden lassen',

  async play(host, moment) {
    const canvas = host && host.canvas;
    const ctx = (host && host.ctx) || (canvas && canvas.getContext && canvas.getContext('2d'));
    if (!canvas || !ctx) {
      console.warn('[abschluss] Kein Canvas/Kontext übergeben – Minispiel wird übersprungen.');
      return null;
    }

    /* ---- Kontext auspacken ------------------------------------------------ */
    const m = moment || {};
    const actor = m.actor || null;
    const keeper = m.keeper || null;
    const context = m.context || {};
    const score = Array.isArray(context.score) ? context.score : [0, 0];
    const minute = typeof m.minute === 'number' ? m.minute : (context.minute || 0);
    const isHeader = m.high === true;

    // Eigene, abgezweigte RNG: fork() verändert den Zustand der Eltern-RNG NICHT,
    // dadurch bleibt die Match-Simulation trotz variabler Frame-Zahl deterministisch.
    const rng = (host.rng && typeof host.rng.fork === 'function')
      ? host.rng.fork('minigame:abschluss:' + (actor && actor.id ? actor.id : '?'))
      : (host.rng || { next: () => 0.5 });

    const diff = clamp((host.difficulty && host.difficulty.minigame) || 1, 0.4, 2);
    // Klangnamen aus dem Vertrag von render/sound.js. Der zweite Parameter geht
    // unverändert an die Klangbank durch ({ lautstaerke, hoehe, panorama }).
    const sfx = (n, o) => { try { if (typeof host.sound === 'function') host.sound(n, o); } catch (e) { /* egal */ } };

    /** Was am Ende des Fluges zu hören ist – je Ausgang genau ein Klang. */
    const AUSGANG_KLANG = {
      tor: ['tor', null],
      parade: ['parade', null],
      geblockt: ['block', null],
      latte: ['pfosten', { hoehe: 1.12 }],
      pfosten: ['pfosten', null],
      daneben: ['raunen', { lautstaerke: 0.9 }]
    };

    /* ---- Szene aufbauen ---------------------------------------------------- */
    const S = erzeugeSzene(m, diff, rng);
    const cam = S.kamera;
    const sz = S.szene;
    const windowS = S.windowS;
    S.phase = isHeader ? 'flanke' : 'anlauf';

    // Laufzeitfelder, die nur die Darstellung braucht
    S.shot = null;
    S.resolution = null;
    S.res = null;
    S.banner = '';
    S.barPos = 0;
    S.absprung = -1;
    // Zielhilfe vorbereiten, solange noch niemand zusieht.
    zielhilfeVorwaermen(S);

    /** Wird weiter unten (in der Promise) mit der echten Auflösung belegt. */
    let settle = () => { };

    // Ränge in Vereinsfarben (Nachtrag §5) – einmal berechnet, nicht je Frame.
    const rangF = rangFarben(context);
    const HOR = cam.horizont;
    const RANG_STUFEN = [
      { y: HOR - 34, h: 34, farbe: dunkler(rangF[0], 1.00) },
      { y: HOR - 66, h: 32, farbe: dunkler(rangF[1], 0.78) },
      { y: HOR - 96, h: 30, farbe: dunkler(rangF[0], 0.58) },
      { y: HOR - 122, h: 26, farbe: dunkler(rangF[1], 0.44) }
    ];
    const LAGE_TEXT = lageText();

    /* ---- Kopfball: echte Flanke, echter Absprung --------------------------- */
    const kopfPr = sprungProfil({
      sprungkraft: att(actor, 'sprungkraft'),
      koerper: att(actor, 'koerper'),
      fitness: (actor && actor.fitness) || 100
    });
    const kopfGroesse = groesseM(actor);
    let flanke = null, tAnkunft = HEAD_WINDOW_S;
    if (isHeader) {
      const vonX = sz.seit >= 0 ? -16 : 16;
      _start.x = vonX; _start.y = sz.tiefe + 11; _start.z = 0.2;
      _ziel.x = sz.seit; _ziel.y = sz.tiefe; _ziel.z = kopfGroesse * 0.94 + kopfPr.reichweite * 0.8;
      const r = richtungZu(_start, _ziel, 21, true);
      abschussVektor(21, r.gier, r.neigung, _v0);
      _flugInit.tMax = 3.2;
      flanke = createFlug(_flugInit);
      const tr = flanke.trefferEbene('y', sz.tiefe);
      tAnkunft = tr ? tr.t : Math.min(HEAD_WINDOW_S, flanke.dauer);
    }
    const kopfGruen = clamp(
      (HEAD_GREEN_BASE + HEAD_GREEN_SKILL * S.headSkill01)
      * (hasTrait(actor, 'kopfballungeheuer') ? 1.35 : 1) / diff, 0.04, 0.34);
    const kopfIdeal = clamp(tAnkunft - kopfPr.steigzeit, 0.05, Math.max(0.1, tAnkunft - 0.02));

    /* ====================================================================== *
     *  ZEICHNEN
     * ====================================================================== */

    // Wiederverwendete Projektionsziele – keine Allokation in der rAF-Schleife.
    const pA = { x: 0, y: 0, k: 0, d: 0 }, pB = { x: 0, y: 0, k: 0, d: 0 };
    const pC = { x: 0, y: 0, k: 0, d: 0 }, pD = { x: 0, y: 0, k: 0, d: 0 };
    const pE = { x: 0, y: 0, k: 0, d: 0 }, pF = { x: 0, y: 0, k: 0, d: 0 };
    const ballAus = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
    const zielAus = { x: 0, z: 0 };
    // Zeichen-Optionen wiederverwenden: im rAF-Takt wird nichts allokiert.
    // Torchance der drei Knöpfe – ein Puffer für die ganze Szene, je Frame neu
    // gefüllt statt neu angelegt.
    const chancen = [0, 0, 0];
    const optKeeper = { pose: 'parade', dir: 1, frame: 0 };
    const optDef = { pose: 'lauf', dir: -1, frame: 0 };
    const optSchuetze = { pose: 'lauf', dir: 1, frame: 0 };

    /** Weltlinie zeichnen, an der Nahebene abgeschnitten. */
    function linieWelt(x1, y1, z1, x2, y2, z2) {
      let d1 = cam.tiefeVon(x1, y1), d2 = cam.tiefeVon(x2, y2);
      const NAH = 0.8;
      if (d1 < NAH && d2 < NAH) return;
      let ax = x1, ay = y1, az = z1, bx = x2, by = y2, bz = z2;
      if (d1 < NAH) {
        const f = (NAH - d1) / (d2 - d1);
        ax = x1 + (x2 - x1) * f; ay = y1 + (y2 - y1) * f; az = z1 + (z2 - z1) * f;
      } else if (d2 < NAH) {
        const f = (NAH - d2) / (d1 - d2);
        bx = x2 + (x1 - x2) * f; by = y2 + (y1 - y2) * f; bz = z2 + (z1 - z2) * f;
      }
      cam.project(ax, ay, az, pA); cam.project(bx, by, bz, pB);
      ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.stroke();
    }

    function drawBackground() {
      const hor = HOR;
      // Himmel
      fillRect(ctx, 0, 0, CANVAS_W, hor, COL.himmel);
      // Rangstufen: vier Bänder, nach hinten dunkler (wie render/pitch.js).
      // Farben und Geometrie stehen einmal fest – im Frame wird nur gefüllt.
      for (const s of RANG_STUFEN) {
        fillRect(ctx, 0, s.y, CANVAS_W, s.h, s.farbe);
        fillRect(ctx, 0, s.y, CANVAS_W, 2, 'rgba(0,0,0,0.35)');
      }
      // Zuschauer-Pixel (deterministisch aus dem Index, kein Zufall pro Frame)
      for (let i = 0; i < 320; i++) {
        const x = (i * 97) % CANVAS_W;
        const s = RANG_STUFEN[i % 4];
        const y = s.y + 4 + ((i * 53) % Math.max(4, s.h - 8));
        fillRect(ctx, x, y, 4, 4, ZUSCHAUER_FARBEN[i % 5]);
      }
      // Blitzlichter
      for (let i = 0; i < 6; i++) {
        const ph = (S.t * 1.7 + i * 0.83) % 1;
        if (ph < 0.10) {
          const x = ((i * 313) % CANVAS_W);
          const y = hor - 120 + ((i * 37) % 100);
          fillRect(ctx, x, y, 5, 5, 'rgba(255,255,255,0.9)');
        }
      }
      // Bande
      fillRect(ctx, 0, hor - 8, CANVAS_W, 10, COL.holz);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2;
      ctx.strokeRect(-2, hor - 8, CANVAS_W + 4, 10);

      // Rasen bis zum Horizont
      fillRect(ctx, 0, hor, CANVAS_W, CANVAS_H - hor, COL.rasen);
      // Perspektivische Rasenstreifen aus Weltkoordinaten (alle 5 m)
      for (let i = 0; i < 12; i++) {
        const y0 = i * 5, y1 = y0 + 5;
        if (i % 2) continue;
        const d0 = cam.tiefeVon(0, y0), d1 = cam.tiefeVon(0, y1);
        if (d0 < 0.8 && d1 < 0.8) continue;
        const yA = HOR + CAM_H * cam.massstabD(Math.max(0.8, d0));
        const yB = HOR + CAM_H * cam.massstabD(Math.max(0.8, d1));
        const oben = Math.min(yA, yB), unten = Math.max(yA, yB);
        if (unten < HOR) continue;
        fillRect(ctx, 0, oben, CANVAS_W, Math.max(1, unten - oben), COL.rasenDunkel);
      }
      // Strafraum und Torraum in echten Maßen
      ctx.strokeStyle = COL.linie; ctx.lineWidth = 3;
      linieWelt(-20.16, 16.5, 0, 20.16, 16.5, 0);
      linieWelt(-20.16, 0, 0, -20.16, 16.5, 0);
      linieWelt(20.16, 0, 0, 20.16, 16.5, 0);
      linieWelt(-9.16, 5.5, 0, 9.16, 5.5, 0);
      linieWelt(-9.16, 0, 0, -9.16, 5.5, 0);
      linieWelt(9.16, 0, 0, 9.16, 5.5, 0);
      ctx.lineWidth = 4;
      linieWelt(-30, 0, 0, 30, 0, 0);   // Torlinie
    }

    function drawGoalAndCoverage(typeKey) {
      cam.project(-TOR_HALB, 0, 0, pA);          // links unten
      cam.project(-TOR_HALB, 0, TOR_HOEHE, pB);  // links oben
      cam.project(TOR_HALB, 0, TOR_HOEHE, pC);   // rechts oben
      cam.project(TOR_HALB, 0, 0, pD);           // rechts unten

      // Netz (hinter der Torfläche): Rückwand andeuten und Fläche abdunkeln
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.lineTo(pC.x, pC.y); ctx.lineTo(pD.x, pD.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(12,20,26,0.55)';
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = 'rgba(227,234,236,0.42)'; ctx.lineWidth = 1.5;
      for (let i = 0; i <= 18; i++) {
        const x = lerp(-TOR_HALB, TOR_HALB, i / 18);
        cam.project(x, -NETZ_TIEFE, 0, pE); cam.project(x, -NETZ_TIEFE, TOR_HOEHE, pF);
        ctx.beginPath(); ctx.moveTo(pE.x, pE.y); ctx.lineTo(pF.x, pF.y); ctx.stroke();
      }
      for (let j = 0; j <= 8; j++) {
        const z = TOR_HOEHE * j / 8;
        cam.project(-TOR_HALB, -NETZ_TIEFE, z, pE); cam.project(TOR_HALB, -NETZ_TIEFE, z, pF);
        ctx.beginPath(); ctx.moveTo(pE.x, pE.y); ctx.lineTo(pF.x, pF.y); ctx.stroke();
      }
      ctx.restore();

      // Drei Bänder je Spalte: rot (Torwart), gelb (wirklich frei), grau (dorthin
      // bringt DIESER Typ den Ball nicht). Dieselben Spalten liest die Torchance
      // an den Knöpfen – Bild und Zahl sind eine Rechnung.
      const cols = SKYLINE_SPALTEN;
      for (let i = 0; i < cols; i++) {
        const u0 = i / cols, u1 = (i + 1) / cols;
        const um = (u0 + u1) / 2;
        // Die Sperrhöhe hängt an der Weglänge und ist deshalb in der Mitte höher
        // als in den Ecken – sie wird je Spalte gefragt.
        const sperr = sperrHoehe(S, typeKey, um);
        const cov = Math.min(coverHoehe(S, um, typeKey), sperr);
        const x0 = lerp(-TOR_HALB, TOR_HALB, u0), x1 = lerp(-TOR_HALB, TOR_HALB, u1);
        cam.project(x0, 0, 0, pA);
        cam.project(x1, 0, 0, pB);
        cam.project(x0, 0, cov * TOR_HOEHE, pC);
        cam.project(x1, 0, cov * TOR_HOEHE, pD);
        if (cov > 0.01) {
          ctx.fillStyle = 'rgba(193,39,45,0.42)';
          ctx.beginPath();
          ctx.moveTo(pA.x, pA.y); ctx.lineTo(pC.x, pC.y);
          ctx.lineTo(pD.x, pD.y); ctx.lineTo(pB.x, pB.y);
          ctx.closePath(); ctx.fill();
        }
        if (sperr > cov + 0.01) {
          cam.project(x0, 0, sperr * TOR_HOEHE, pE);
          cam.project(x1, 0, sperr * TOR_HOEHE, pF);
          ctx.fillStyle = 'rgba(245,197,24,0.22)';
          ctx.beginPath();
          ctx.moveTo(pC.x, pC.y); ctx.lineTo(pE.x, pE.y);
          ctx.lineTo(pF.x, pF.y); ctx.lineTo(pD.x, pD.y);
          ctx.closePath(); ctx.fill();
        }
        if (sperr < 0.99) {
          cam.project(x0, 0, sperr * TOR_HOEHE, pC);
          cam.project(x1, 0, sperr * TOR_HOEHE, pD);
          cam.project(x0, 0, TOR_HOEHE, pE);
          cam.project(x1, 0, TOR_HOEHE, pF);
          ctx.fillStyle = 'rgba(90,102,117,0.55)';
          ctx.beginPath();
          ctx.moveTo(pC.x, pC.y); ctx.lineTo(pE.x, pE.y);
          ctx.lineTo(pF.x, pF.y); ctx.lineTo(pD.x, pD.y);
          ctx.closePath(); ctx.fill();
          // Unterkante des grauen Bandes: genau dort bleibt das Zielkreuz hängen,
          // also muss sie ablesbar sein.
          ctx.strokeStyle = COL.sperr; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(pC.x, pC.y); ctx.lineTo(pD.x, pD.y); ctx.stroke();
        }
      }

      // Rahmen: dicke weiße Balken mit schwarzer Outline, Stärke aus der Kamera
      const kTor = cam.massstab(0, 0);
      const stark = Math.max(4, 0.14 * kTor);
      ctx.lineCap = 'round';
      for (const [x1, z1, x2, z2] of TOR_KANTEN) {
        cam.project(x1, 0, z1, pA); cam.project(x2, 0, z2, pB);
        ctx.strokeStyle = COL.outline; ctx.lineWidth = stark + 5;
        ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.stroke();
        ctx.strokeStyle = COL.linie; ctx.lineWidth = stark;
        ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.stroke();
      }
    }

    function drawFigure(player, x, y, scale, opts, colA, colB) {
      if (typeof host.drawPlayer === 'function' && player) {
        try { host.drawPlayer(ctx, player, x, y, scale, opts || {}); return; }
        catch (e) {
          if (!warnedDraw) { warnedDraw = true; console.warn('[abschluss] host.drawPlayer fehlgeschlagen, nutze Notdarstellung:', e); }
        }
      }
      figureFallback(ctx, x, y, scale, colA || COL.blau, colB || COL.papier);
    }

    /** Bodenschatten unter einer Figur (Nachtrag §5: niemand schwebt). */
    function bodenschatten(x, y, k, breite) {
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, y, Math.max(3, breite * k), Math.max(1.5, breite * k * 0.32), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawKeeper() {
      cam.project(S.keeperX, S.keeperY, 0, pA);
      const scale = figurMassstab(pA.k, groesseM(keeper, KEEPER_H_M));
      bodenschatten(pA.x, pA.y + 2, pA.k, 0.45);
      optKeeper.frame = (S.t * 2) % 1;
      drawFigure(keeper, pA.x, pA.y, scale, optKeeper, COL.gruen, COL.gelb);
    }

    function drawDefenders() {
      // Von hinten nach vorne, damit die Überdeckung stimmt.
      // In-place sortiert: keine Allokation je Frame.
      S.defs.sort(nachTiefe);
      for (const d of S.defs) {
        cam.project(d.wx, d.wy, 0, pA);
        if (pA.d < 1.0) continue;
        const scale = figurMassstab(pA.k, groesseM(d.player));
        bodenschatten(pA.x, pA.y + 2, pA.k, 0.42);
        optDef.frame = (S.t * 3.2) % 1;
        drawFigure(d.player, pA.x, pA.y, scale, optDef, COL.rot, COL.papier);
      }
    }

    function drawShooter() {
      optSchuetze.pose = S.phase === 'flug' || S.phase === 'ergebnis' ? 'schuss' : 'lauf';
      // Der Schütze steht neben dem Ball, damit er das Tor nicht zustellt.
      const qx = -cam.ny, qy = cam.nx;   // quer zur Blickachse
      const x = sz.seit + qx * -0.85, y = sz.tiefe + qy * -0.85;
      cam.project(x, y, 0, pA);
      const hoehe = groesseM(actor);
      const scale = figurMassstab(pA.k, hoehe);
      bodenschatten(pA.x, pA.y + 2, pA.k, 0.45);
      optSchuetze.frame = (S.t * 3) % 1;
      drawFigure(actor, pA.x, pA.y, scale, optSchuetze, COL.blau, COL.papier);
    }

    /** Ball als Weltpunkt: Radius und Schatten kommen aus der Kamera. */
    function drawBallWelt(x, y, z) {
      cam.project(x, y, 0, pE);
      if (pE.d > 0.6) {
        ctx.save();
        ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(pE.x, pE.y, Math.max(2, BALL_R * 1.4 * pE.k), Math.max(1, BALL_R * 0.5 * pE.k), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      cam.project(x, y, z, pF);
      if (pF.d < 0.6) return;
      const r = Math.max(2.5, BALL_R * pF.k);
      ctx.beginPath(); ctx.arc(pF.x, pF.y, r, 0, Math.PI * 2);
      ctx.fillStyle = COL.papier; ctx.fill();
      ctx.lineWidth = Math.max(1.5, r * 0.3); ctx.strokeStyle = COL.outline; ctx.stroke();
      ctx.fillStyle = COL.outline;
      ctx.beginPath(); ctx.arc(pF.x - r * 0.25, pF.y - r * 0.2, r * 0.28, 0, Math.PI * 2); ctx.fill();
    }

    function drawCrosshair() {
      // Das Kreuz steht auf der Höhe, die `loeseSchuss()` gleich anfliegt —
      // dieselbe Funktion, kein zweiter Rechenweg. Über der Sperrhöhe bleibt es
      // an der grauen Kante hängen, statt eine Höhe zu versprechen, die dieser
      // Schusstyp nicht liefert.
      _ziel.x = lerp(-TOR_HALB, TOR_HALB, clamp(S.aimU, -0.14, 1.14));
      _ziel.y = 0;
      _ziel.z = zZielVon(S, S.typ, S.aimU, S.aimV);
      cam.project(_ziel.x, _ziel.y, _ziel.z, pA);
      const t = S.t * 6;
      const r = 16 + Math.sin(t) * 2.5;
      ctx.save();
      ctx.lineWidth = 5; ctx.strokeStyle = COL.outline;
      ctx.beginPath(); ctx.arc(pA.x, pA.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = COL.gelb;
      ctx.beginPath(); ctx.arc(pA.x, pA.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pA.x - r - 8, pA.y); ctx.lineTo(pA.x - 5, pA.y);
      ctx.moveTo(pA.x + 5, pA.y); ctx.lineTo(pA.x + r + 8, pA.y);
      ctx.moveTo(pA.x, pA.y - r - 8); ctx.lineTo(pA.x, pA.y - 5);
      ctx.moveTo(pA.x, pA.y + 5); ctx.lineTo(pA.x, pA.y + r + 8);
      ctx.lineWidth = 5; ctx.strokeStyle = COL.outline; ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = COL.gelb; ctx.stroke();
      // Schussstrahl vom Ball zum Ziel
      cam.project(sz.seit, sz.tiefe, BALL_R, pB);
      ctx.setLineDash(STRICH_AN);
      ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(245,197,24,0.6)';
      ctx.beginPath(); ctx.moveTo(pB.x, pB.y); ctx.lineTo(pA.x, pA.y); ctx.stroke();
      ctx.setLineDash(STRICH_AUS);
      ctx.restore();
    }

    /** „18 M · HALBRECHTS" – macht sichtbar, dass die Szene moment.at kennt. */
    function lageText() {
      const grad = Math.atan2(sz.seit, Math.max(0.5, sz.tiefe)) * 180 / Math.PI;
      const wo = grad > 14 ? 'HALBRECHTS' : grad < -14 ? 'HALBLINKS' : 'ZENTRAL';
      return `${Math.round(sz.distance)} M · ${wo}`;
    }

    function drawHud() {
      // Kopfzeile
      panel(ctx, 0, 0, CANVAS_W, 40, '#1a1f28');
      const teamLabel = m.team === 'away' ? 'Auswärts' : 'Heim';
      text(ctx, nameOf(actor, 'Unbekannt').toUpperCase(), 14, 27, { size: 19, color: COL.gelb });
      text(ctx, `${minute}.` + ' MINUTE', CANVAS_W / 2 - 150, 27, { size: 17, color: COL.papier, align: 'center' });
      text(ctx, `STAND  ${score[0]} : ${score[1]}`, CANVAS_W / 2 - 20, 27, { size: 17, color: COL.papier, align: 'center' });
      text(ctx, LAGE_TEXT, CANVAS_W / 2 + 140, 27, { size: 15, color: '#8fc4f0', align: 'center' });
      text(ctx, (context.competition || teamLabel) + '', CANVAS_W - 14, 27,
        { size: 15, color: '#b9c4d2', align: 'right' });

      // Fußzeile mit Kurzanleitung
      panel(ctx, 0, CANVAS_H - 62, CANVAS_W, 62, '#1a1f28');
      if (isHeader) {
        text(ctx, '[LEERTASTE] / KLICK im grünen Bereich = Absprung · Maus quer = Zielrichtung',
          14, CANVAS_H - 36, { size: 16, color: COL.papier });
        text(ctx, 'Zu früh: der Ball ist noch nicht da.  Zu spät: er ist schon vorbei.  [ESC] = Simulation',
          14, CANVAS_H - 14, { size: 13, color: '#b9c4d2' });
      } else {
        // Der angewählte Typ wird hervorgehoben – er ist es, den die rote
        // Skyline gerade zeigt und den ein Klick abfeuert. An jedem Knopf steht
        // die TORCHANCE seines Typs: das ist die eine Zahl der Szene, und der
        // beste Wert wird grün gesetzt, damit die Wahl ohne Rechnen geht.
        let besteChance = -1;
        for (let i = 0; i < TYP_KNOEPFE.length; i++) {
          chancen[i] = torchance(S, TYP_VON_TASTE[TYP_KNOEPFE[i][0]]);
          if (chancen[i] > besteChance) besteChance = chancen[i];
        }
        let x = 14;
        for (let i = 0; i < TYP_KNOEPFE.length; i++) {
          const [key, label, col] = TYP_KNOEPFE[i];
          const an = S.typ === TYP_VON_TASTE[key];
          panel(ctx, x, CANVAS_H - 52, 26, 24, an ? COL.gelb : COL.beige);
          text(ctx, key, x + 13, CANVAS_H - 34, { size: 15, color: COL.outline, align: 'center', outline: false });
          text(ctx, label, x + 33, CANVAS_H - 34, { size: 15, color: col });
          const proz = Math.round(100 * chancen[i]);
          text(ctx, `${proz} %`, x + 40 + label.length * 11, CANVAS_H - 34,
            { size: 15, color: chancen[i] >= besteChance ? COL.gruen : '#b9c4d2' });
          if (an) fillRect(ctx, x, CANVAS_H - 26, 26 + label.length * 11, 3, col);
          x += 92 + label.length * 11;
        }
        text(ctx, 'Maus zielen · die Zahl am Knopf ist die Torchance dieses Schusses · '
          + 'Klick oder [LEERTASTE] schießt · grau = dorthin geht dieser Schuss nicht · [ESC]',
          14, CANVAS_H - 12, { size: 13, color: '#b9c4d2' });
      }
    }

    function drawWindowBar() {
      if (S.phase !== 'fenster') return;
      const frac = clamp(1 - S.phaseT / windowS, 0, 1);
      const w = 320, x = (CANVAS_W - w) / 2, y = 48;
      panel(ctx, x - 4, y - 4, w + 8, 26, '#1a1f28');
      const col = frac > 0.55 ? COL.gruen : frac > 0.25 ? COL.gelb : COL.rot;
      fillRect(ctx, x, y, w * frac, 18, col);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, 18);
      text(ctx, 'SCHIESSEN!', CANVAS_W / 2, y + 15,
        { size: 14, color: COL.outline, align: 'center', outline: false });
    }

    function drawApproachHint() {
      if (S.phase !== 'anlauf') return;
      const pulse = 0.55 + 0.45 * Math.sin(S.t * 9);
      ctx.save();
      ctx.globalAlpha = pulse;
      text(ctx, 'BALL KOMMT …', CANVAS_W / 2, 78, { size: 24, color: COL.gelb, align: 'center' });
      ctx.restore();
    }

    /** Der Balken zeigt echte Zeit: die grüne Zone ist der richtige Absprung. */
    function drawHeaderBar() {
      if (S.phase !== 'flanke') return;
      const w = 560, h = 34, x = (CANVAS_W - w) / 2, y = CANVAS_H - 122;
      panel(ctx, x - 6, y - 6, w + 12, h + 12, '#1a1f28');
      fillRect(ctx, x, y, w, h, '#2b3543');
      const g0 = clamp((kopfIdeal - kopfGruen) / tAnkunft, 0, 1);
      const g1 = clamp((kopfIdeal + kopfGruen) / tAnkunft, 0, 1);
      fillRect(ctx, x + g0 * w, y, (g1 - g0) * w, h, COL.gruen);
      ctx.globalAlpha = 0.4;
      fillRect(ctx, x + clamp(g0 - kopfGruen / tAnkunft * 0.8, 0, 1) * w, y, kopfGruen / tAnkunft * 0.8 * w, h, COL.gelb);
      fillRect(ctx, x + g1 * w, y, kopfGruen / tAnkunft * 0.8 * w, h, COL.gelb);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
      const mx = x + clamp(S.barPos, 0, 1) * w;
      fillRect(ctx, mx - 4, y - 8, 8, h + 16, COL.papier);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(mx - 4, y - 8, 8, h + 16);
      text(ctx, 'ABSPRUNG', CANVAS_W / 2, y - 14, { size: 15, color: COL.papier, align: 'center' });
    }

    function drawBanner() {
      if (!S.banner) return;
      const w = 520, h = 74, x = (CANVAS_W - w) / 2, y = 200;
      panel(ctx, x, y, w, h, COL.beige);
      text(ctx, S.banner, CANVAS_W / 2, y + 50,
        { size: 38, color: COL.rot, align: 'center', outlineColor: COL.outline });
    }

    function render() {
      ctx.save();
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawBackground();
      // Gezeichnet wird die Abdeckung des ANGEWÄHLTEN Typs (`S.typ`) – vorher
      // hing das an `S.shot`, das erst beim Abschuss belegt wird: die Zielhilfe
      // zeigte deshalb während der ganzen Zielphase immer den Flachschuss.
      drawGoalAndCoverage(S.shot ? S.shot.type : S.typ);
      drawKeeper();
      drawDefenders();

      if (S.phase === 'fenster') {
        drawBallWelt(sz.seit, sz.tiefe, BALL_R);
      } else if (S.phase === 'anlauf') {
        // Ball rollt dem Schützen entgegen (aus dem Halbfeld heran)
        const k = clamp(S.phaseT / APPROACH_S, 0, 1);
        drawBallWelt(lerp(sz.seit + 6, sz.seit, k), lerp(sz.tiefe + 9, sz.tiefe, k), BALL_R);
      } else if (S.phase === 'flanke' && flanke) {
        const t = Math.min(S.phaseT, flanke.dauer);
        flanke.at(t, ballAus);
        drawBallWelt(ballAus.x, ballAus.y, ballAus.z);
      } else if (S.res && S.res._bahn) {
        const t = Math.min(S.phaseT, S.res._tEnde);
        const versatz = S.res._tVersatz || 0;
        const bahn = (S.res._abgelenkt && t >= versatz) ? S.res._abgelenkt : S.res._flug;
        if (bahn) {
          bahn.at(S.res._abgelenkt && t >= versatz ? t - versatz : t, ballAus);
          drawBallWelt(ballAus.x, ballAus.y, ballAus.z);
        } else if (S.res._bahn) {
          S.res._bahn.at(t, ballAus);
          drawBallWelt(ballAus.x, ballAus.y, ballAus.z);
        }
      }

      drawShooter();
      if (S.phase === 'fenster') drawCrosshair();

      drawApproachHint();
      drawWindowBar();
      drawHeaderBar();
      drawHud();
      drawBanner();
      ctx.restore();
    }

    /* ====================================================================== *
     *  SIMULATIONS-SCHRITT
     * ====================================================================== */

    const BANNER = {
      tor: 'TOR!!!', parade: 'GEHALTEN!', daneben: 'VORBEI!',
      geblockt: 'GEBLOCKT!', latte: 'LATTE!', pfosten: 'PFOSTEN!'
    };

    function step(dt) {
      schritt(S, dt);

      if (S.phase === 'anlauf' && S.phaseT >= APPROACH_S) {
        // Das Schussfenster geht auf. Ein Pfiff wäre hier falsch – niemand
        // unterbricht diese Szene, sie ist nur plötzlich Ihre.
        S.phase = 'fenster'; S.phaseT = 0; sfx('klick', { hoehe: 0.8, lautstaerke: 1.2 });
      } else if (S.phase === 'fenster' && S.phaseT >= windowS) {
        // Zu lange gezögert – jetzt wird es ein Schuss aus vollem Lauf.
        fireLate();
      } else if (S.phase === 'flanke') {
        S.barPos = clamp(S.phaseT / tAnkunft, 0, 1);
        if (S.phaseT >= tAnkunft) headerShot(false);
      } else if (S.phase === 'flug' && S.res && S.phaseT >= S.res._tEnde) {
        S.phase = 'ergebnis'; S.phaseT = 0;
        S.banner = BANNER[S.resolution.outcome] || '';
        // Aluminium, Handschuh, Bein oder Netz – jeder Ausgang klingt anders.
        const klang = AUSGANG_KLANG[S.resolution.outcome];
        if (klang) sfx(klang[0], klang[1]);
        if (S.resolution.outcome === 'latte' || S.resolution.outcome === 'pfosten') {
          sfx('raunen', { lautstaerke: 0.8, verzoegerung: 0.3 });
        }
      } else if (S.phase === 'ergebnis' && S.phaseT >= 1.1) {
        settle(S.resolution);
      }
    }

    /* ====================================================================== *
     *  AKTIONEN
     * ====================================================================== */

    function launch(res, typeKey) {
      S.res = res;
      S.resolution = {
        outcome: res.outcome, quality: res.quality,
        targetPlayerId: res.targetPlayerId, xgDelta: res.xgDelta
      };
      S.shot = { type: typeKey };
      S.phase = 'flug'; S.phaseT = 0;
      // Der Kopfball hat keinen Spann: heller, kürzer, weniger Wucht.
      sfx('schuss', typeKey === 'kopfball' ? { hoehe: 1.3, lautstaerke: 0.8 } : null);
    }

    function shoot(typeKey, tFracErzwungen) {
      if (S.phase !== 'fenster') return;
      const tFrac = tFracErzwungen != null ? tFracErzwungen : clamp(S.phaseT / windowS, 0, 1);
      launch(loeseSchuss(S, typeKey, S.aimU, S.aimV, tFrac, rng), typeKey);
    }

    /**
     * Fensterende: kein Münzwurf mehr. Es ist ein normaler Schuss mit tFrac = 1 —
     * und der ist wegen der Hetze (Punkt 8) langsam und ungenau genug, dass die
     * herangerückten Verteidiger ihn meistens erwischen. Geschossen wird der
     * angewählte Typ; wer den Heber gewählt hat, bekommt auch den Heber.
     */
    function fireLate() {
      if (S.phase !== 'fenster') return;
      shoot(S.typ, 1);
    }

    /** Kopfball nach Flanke: Absprung-Timing plus Zielrichtung aus der Maus. */
    function headerShot(gedrueckt) {
      if (S.phase !== 'flanke') return;
      const tA = gedrueckt ? S.phaseT : (S.absprung >= 0 ? S.absprung : -1);
      if (tA < 0) {
        // Nie abgesprungen – der Ball segelt über den Kopf.
        const res = {
          outcome: 'daneben', quality: 0.08,
          targetPlayerId: actor && actor.id ? actor.id : null,
          xgDelta: XG_MIN, _flug: null, _abgelenkt: null, _bahn: flanke,
          _tEnde: Math.min(flanke ? flanke.dauer : 0.6, tAnkunft + 0.5), _typ: 'kopfball'
        };
        launch(res, 'kopfball');
        return;
      }
      // `kopfIdeal` IST bereits der richtige Absprungzeitpunkt (Ankunft minus
      // Steigzeit) – der Fehler ist deshalb schlicht die Abweichung davon.
      const guete = timingGuete(kopfPr, tA - kopfIdeal);
      // Räumlicher Absprung: trifft der Kopf den Ball überhaupt?
      const zKopf = kopfHoehe(kopfPr, kopfGroesse, tAnkunft - tA);
      let zBall = zKopf;
      if (flanke) { flanke.at(Math.min(tAnkunft, flanke.dauer), ballAus); zBall = ballAus.z; }
      if (Math.abs(zBall - zKopf) > 0.22) {
        const res = {
          outcome: 'daneben', quality: 0.10,
          targetPlayerId: actor && actor.id ? actor.id : null,
          xgDelta: XG_MIN, _flug: null, _abgelenkt: null, _bahn: flanke,
          _tEnde: Math.min(flanke ? flanke.dauer : 0.6, tAnkunft + 0.4), _typ: 'kopfball'
        };
        launch(res, 'kopfball');
        return;
      }
      // Zielrichtung aus der Mausquerlage (±25°), nicht mehr aus dem Timing.
      const quer = clamp((S.mausX - CANVAS_W / 2) / (CANVAS_W / 2), -1, 1);
      const grund = Math.atan2(-sz.tiefe, -sz.seit);
      const gier = grund + quer * HEAD_YAW_GRAD * Math.PI / 180;
      // Zielpunkt auf der Torebene aus dieser Richtung
      const tx = sz.seit + (-sz.tiefe) * (Math.cos(gier) / Math.min(-1e-3, Math.sin(gier)));
      const aimU = clamp((tx + TOR_HALB) / (2 * TOR_HALB), -0.1, 1.1);
      const aimV = clamp(0.16 + 0.18 * (1 - guete), 0.05, 0.9);
      // Der Kopfball verlässt den Kopf, nicht den Rasen.
      S.startZ = zKopf;
      const res = loeseSchuss(S, 'kopfball', aimU, aimV, 0.5 + guete * 0.4, rng);
      S.startZ = BALL_R;
      res.quality = clamp(res.quality * (0.45 + 0.65 * guete), 0, 1);
      res.xgDelta = clamp(XG_MIN + (XG_MAX - XG_MIN) * Math.pow(res.quality, 1.2), XG_MIN, XG_MAX);
      launch(res, 'kopfball');
    }

    /* ====================================================================== *
     *  EINGABE, SCHLEIFE, AUFRÄUMEN
     * ====================================================================== */

    return new Promise((resolve) => {
      let done = false;
      let rafId = 0;
      let watchdog = 0;
      let lastTs = 0;
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
        if (flanke) { flanke.freigeben(); flanke = null; }
        freigeben(S.res);
      }

      function settleInner(res) {
        if (done) return;
        done = true;
        cleanup();
        resolve(res);
      }
      settle = settleInner;   // ab jetzt kann auch step() auflösen

      function pointerPos(ev) {
        const r = canvas.getBoundingClientRect();
        const sx = canvas.width / (r.width || canvas.width);
        const sy = canvas.height / (r.height || canvas.height);
        return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
      }

      on(canvas, 'mousemove', (ev) => {
        const p = pointerPos(ev);
        S.mausX = p.x; S.mausY = p.y;
        // Exakte Rückprojektion auf die Torebene – das Zielkreuz sitzt unter der
        // Maus, solange sie unter der grauen Sperrkante bleibt. Darüber bleibt es
        // an der Kante hängen: höher bringt dieser Schusstyp den Ball nicht, und
        // ein Kreuz, das dort stünde, würde lügen (siehe `zZielVon`).
        cam.unprojectTor(p.x, p.y, zielAus);
        S.aimU = clamp((zielAus.x + TOR_HALB) / (2 * TOR_HALB), -0.12, 1.12);
        S.aimV = clamp(zielAus.z / TOR_HOEHE, 0.02, 1.15);
      });

      on(canvas, 'mousedown', (ev) => {
        ev.preventDefault();
        if (S.phase === 'fenster') shoot(S.typ);
        else if (S.phase === 'flanke') { S.absprung = S.phaseT; }
      });

      on(window, 'keydown', (ev) => {
        if (ev.key === 'Escape') { settleInner(null); return; }
        if (S.phase === 'fenster' || S.phase === 'anlauf') {
          // [1]/[2]/[3] WÄHLEN nur aus – die Zielhilfe zeigt sofort die
          // Abdeckung des gewählten Typs. Abgezogen wird mit Klick oder Leertaste.
          // Wählen geht schon, während der Ball ankommt; schießen erst im Fenster
          // (`shoot` prüft die Phase selbst).
          const typ = TYP_VON_TASTE[ev.key];
          if (typ) {
            ev.preventDefault();
            if (S.typ !== typ) { S.typ = typ; sfx('klick', { hoehe: 1.15, lautstaerke: 0.7 }); }
          } else if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); shoot(S.typ); }
        } else if (S.phase === 'flanke' && (ev.key === ' ' || ev.key === 'Enter')) {
          ev.preventDefault();
          if (S.absprung < 0) S.absprung = S.phaseT;
        }
      });

      canvas.style.cursor = 'crosshair';
      S.mausX = CANVAS_W / 2; S.mausY = CANVAS_H / 2;

      // Absicherung: rAF pausiert in Hintergrund-Tabs – deshalb zusätzlich ein Timer.
      watchdog = setTimeout(() => {
        settleInner(S.resolution || {
          outcome: 'daneben', quality: 0.2,
          targetPlayerId: actor && actor.id ? actor.id : null, xgDelta: -0.02
        });
      }, HARD_TIMEOUT_S * 1000);

      function frame(ts) {
        if (done) return;
        if (!lastTs) lastTs = ts;
        const dt = clamp((ts - lastTs) / 1000, 0, 0.05);
        lastTs = ts;
        step(dt);
        if (done) return;
        render();
        rafId = requestAnimationFrame(frame);
      }
      rafId = requestAnimationFrame(frame);
    });
  }
};

/* ========================================================================== *
 *  PRÜFEXPORT  (CONTRACTS §9 – rein additiv, DOM-frei, rng nur als Parameter)
 * ========================================================================== */

/** Zufallsersatz ohne Streuung – nur für `modell.landehoehe()`, siehe dort. */
const OHNE_STREUUNG = { next: () => 0.5, gauss: (m) => m };

export const modell = {
  szeneAus,
  macheKamera,
  figurMassstab,
  kameraAbstand,

  /** Vollständiger, DOM-freier Szenenzustand. */
  neueSzene(moment, diff, rng) { return erzeugeSzene(moment, diff, rng); },

  /** Ein Zeitschritt (Torwart, Verteidiger) – zufallsfrei. */
  schritt(S, dt) { schritt(S, dt); return S; },

  /** Ein Abschluss, vollständig aufgelöst. Die Flugbahnen werden freigegeben. */
  abschluss(S, typ, aimU, aimV, tFrac, rng) {
    const res = loeseSchuss(S, typ, aimU, aimV, tFrac, rng);
    const aus = {
      outcome: res.outcome, quality: res.quality,
      targetPlayerId: res.targetPlayerId, xgDelta: res.xgDelta,
      tEnde: res._tEnde, typ: res._typ,
      abgefaelscht: !!res._abgelenkt
    };
    freigeben(res);
    return aus;
  },

  /** Zielhilfe: gedeckte Höhe (0..1) in der Torspalte u (rotes Band). */
  coverHoehe(S, u, typ) { return coverHoehe(S, u, typ || S.typ || 'flach'); },

  /**
   * Zielhilfe: Oberkante des gelben Bandes (0..1) in der Torspalte u – darüber
   * ist grau, dorthin bringt der Typ den Ball nicht. Ohne u: Tormitte.
   */
  sperrHoehe(S, typ, u) { return sperrHoehe(S, typ || S.typ || 'flach', u); },

  /** Zielhilfe: wirklich freie Höhe (0..1) in der Torspalte u (gelbes Band). */
  freieHoehe(S, u, typ) { return freieHoehe(S, u, typ || S.typ || 'flach'); },

  /** Höchste Höhe in METERN, die dieser Typ in der Torspalte u liefert. */
  zDecke(S, typ, u) {
    return zDecke(S, SHOT_TYPES[typ] ? typ : (S.typ || 'flach'), u === undefined ? 0.5 : u);
  },

  /**
   * Die EINE Umrechnung Zielmarke -> Höhe in Metern. Zielkreuz, Skyline und
   * `abschluss()` benutzen genau sie; ein Prüfstand kann damit nachrechnen,
   * dass das Kreuz dort steht, wo der Ball hinfliegt.
   */
  zZiel(S, typ, aimU, aimV) {
    return zZielVon(S, SHOT_TYPES[typ] ? typ : (S.typ || 'flach'), aimU, aimV);
  },

  /**
   * Höhe, in der der Ball die Torlinie WIRKLICH kreuzt, wenn ohne Streuung auf
   * (aimU, aimV) gezielt wird. Damit rechnet der Prüfstand nach, dass das
   * Zielkreuz nicht lügt: `zZiel()` und diese Höhe müssen gleich sein.
   * NaN, wenn der Ball die Torebene gar nicht erreicht.
   *
   * Gemessen wird ausdrücklich `_flug`, die ZIELBAHN, nicht `_bahn`: streift der
   * Ball einen Verteidiger, ist `_bahn` die abgefälschte Bahn, und die landet
   * woanders (gemessen bis 2,23 m daneben). Sie zu messen hieße, dem Zielkreuz
   * eine Lüge vorzuwerfen, die der Verteidiger begangen hat.
   */
  landehoehe(S, typ, aimU, aimV) {
    const res = loeseSchuss(S, SHOT_TYPES[typ] ? typ : 'flach', aimU, aimV, 0.5, OHNE_STREUUNG);
    const tr = res._flug ? res._flug.trefferEbene('y', 0) : null;
    const z = tr ? tr.z : NaN;
    freigeben(res);
    return z;
  },

  /**
   * Zugestellte Torfläche (0..1) – rot plus grau. Das ist genau die gezeichnete
   * Skyline-Fläche; als Wahl zwischen den Schusstypen taugt sie nicht (siehe
   * Dateikopf), dafür gibt es `torchance`.
   */
  abdeckung(S, typ) { return abdeckung(S, typ || S.typ || 'flach'); },

  /**
   * DIE Zielhilfe-Kennzahl (0..1): die Torchance dieses Schusstyps. Genau diese
   * Zahl steht an seinem Knopf in der Fußzeile.
   *
   * `ausgabe` ist optional und bekommt den Zielpunkt, den die Zahl BEWERTET
   * (`{u, v}`, dieselben Marken wie in `abschluss()`). Ohne ihn misst ein
   * Prüfstand nur die Höhe der Zahl, nicht die Güte der Zielpunktwahl.
   */
  torchance(S, typ, ausgabe) { return torchance(S, typ || S.typ || 'flach', ausgabe); },

  /** Anteil der Torbreite, an dem überhaupt etwas zu ist (0..1) – Diagnose. */
  skylineAnteil(S, typ) {
    let zu = 0;
    for (let i = 0; i < SKYLINE_SPALTEN; i++) {
      if (coverHoehe(S, (i + 0.5) / SKYLINE_SPALTEN, typ || S.typ || 'flach') > 0.01) zu++;
    }
    return zu / SKYLINE_SPALTEN;
  },

  /** Flugzeit eines Schusstyps über die Distanz bis zur Torlinie (Sekunden). */
  flugzeit(distance, typ, zZiel) {
    return bezugsBahn(0, distance, typ || 'flach',
      zZiel === undefined ? PROFIL_Z_TIEF : zZiel, null, 0, BALL_R);
  },

  /** Flugzeit, die die ZIELHILFE für diesen Typ und diese Zielhöhe ansetzt. */
  zielhilfeFlugzeit(S, typ, zZiel) {
    return flugzeitBis(S, 0, zZiel === undefined ? PROFIL_Z_TIEF : zZiel,
      typ || S.typ || 'flach', 0);
  },

  /** Ballhöhe in der Ebene `anteil` (0 = Abschuss, 1 = Torlinie) laut Zielhilfe. */
  zielhilfeHoehe(S, typ, anteil, zZiel) { return hoeheBei(S, typ, anteil, zZiel); },

  /** Bezugsbahnen aller Typen vorab integrieren (macht `play()` vor dem 1. Frame). */
  zielhilfeVorwaermen(S) { zielhilfeVorwaermen(S); return S; },

  /** Torwartreichweite in Metern (CONTRACTS §9: twReichweiteBei). */
  twReichweiteBei(tFlug, hoehe, keeper) {
    const par = twParameter({
      reflexe: att(keeper, 'reflexe', 55),
      antizipation: att(keeper, 'stellungsspiel', 55),
      sprungkraft: att(keeper, 'sprungkraft', 55),
      groesse: groesseM(keeper, KEEPER_H_M)
    });
    return twReichweite(par, tFlug, hoehe);
  },

  /**
   * Verhältnis Torhöhe : Spielerhöhe auf gleicher Tiefe (Abnahme Nachtrag §1).
   * Bewusst über den ECHTEN Zeichenweg gerechnet: die Spielerhöhe entsteht aus
   * `figurMassstab` mal Sprite-Referenzhöhe — ein falscher Figurenmaßstab fällt
   * damit auf, ein rein rechnerisches 2,44/1,80 würde ihn verstecken.
   */
  hoehenverhaeltnis(S, y) {
    const k = S.kamera.massstab(0, y === undefined ? 0 : y);
    const torPx = TOR_HOEHE * k;
    const spielerPx = SPRITE_H_PX * figurMassstab(k, SPIELER_H_M);
    return torPx / spielerPx;
  },

  /** Bildschirmpunkt eines Tor-Zielpunkts (für Prüfstände, die die Maus setzen). */
  zielZuMaus(S, u, v) {
    torPunkt(clamp(u, 0, 1), clamp(v, 0, 1), _ziel);
    return S.kamera.project(_ziel.x, _ziel.y, _ziel.z, { x: 0, y: 0, k: 0 });
  },

  /** Konstanten, gegen die der Prüfstand rechnet. */
  KONST: {
    TOR_HALB, TOR_HOEHE, CAM_H, CAM_FOCAL,
    CAM_BACK_BASIS, CAM_BACK_PRO_M, CAM_BACK_MIN, CAM_BACK_MAX, HORIZON_TOR_Y,
    AIM_SPREAD_RAD, VERT_SPREAD_RATIO, SPRITE_H_PX, SPIELER_H_M, SKYLINE_SPALTEN,
    CANVAS_W, CANVAS_H,
    XG_MIN, XG_MAX, APPROACH_S, SHOT_TYPES
  }
};

export default minigame;
