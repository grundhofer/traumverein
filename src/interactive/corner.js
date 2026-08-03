/**
 * Minispiel „Eckball"  —  KeyMoment.kind === 'ecke'
 * ---------------------------------------------------------------------------
 * Blick von schräg hinter der Torlinie auf den Strafraum. Drei Phasen:
 *
 *   1. VARIANTE   Hoch an den langen Pfosten · kurz ausgeführt ·
 *                 scharf an den ersten Pfosten · zurück an die Strafraumkante.
 *   2. FLANKE     Zielpunkt mit der Maus, Flugkurve mit [A]/[D] (Innen-/Außenrist),
 *                 Kraft über den pendelnden Balken (Maus gedrückt halten, loslassen).
 *   3. KOPFBALL   Timing-Klick, wenn der Ball ankommt. Der grüne Bereich wächst mit
 *                 Kopfball/Sprungkraft des Abnehmers, „Kopfballungeheuer" hilft extra.
 *
 * Verteidiger und Torwart bewegen sich in Echtzeit. Läuft der Keeper heraus,
 * muss früher abgenommen werden – sonst faustet er.
 *
 * Rückgabe: { outcome, quality, targetPlayerId, xgDelta } – siehe CONTRACTS 6.1.
 * outcomes: 'kopfball_tor' | 'tor' | 'parade' | 'daneben' | 'geblockt' |
 *           'abgefangen' | 'latte' | 'pfosten'
 *
 * ===========================================================================
 * PHYSIK — was hier gerechnet und was nur gezeichnet wird
 * ===========================================================================
 * Die Flanke ist ein echter Flug aus `core/ballistik.js`: Abschussstärke aus dem
 * Kraftbalken, Abschusswinkel aus der Variante, Effet als Drallvektor. Flugzeit,
 * Landepunkt und Ablage durch den Effet fallen aus der Integration, nichts davon
 * ist mehr gefittet. Der Kopfball erzeugt eine ZWEITE Bahn; Tor, Pfosten, Latte,
 * Parade und Block entscheiden sich geometrisch an dieser Bahn.
 *
 * DIE FALLE DIESES MINISPIELS — Timingfenster in absoluten Millisekunden.
 * Vorher waren `HEAD_GREEN_BASE`, `BAR_START` und `HEAD_MOMENT` ANTEILE einer
 * konstanten Flugzeit von 1,55 s. Mit echter Physik schwankt die Flugzeit
 * zwischen 1,19 s (kurze Ecke) und 2,77 s (lange Ecke) — dasselbe „Anteilsfenster"
 * wäre absolut zwischen 0,32 s und 0,86 s breit gewesen: die kurze Ecke wäre
 * unspielbar, die lange fast unfehlbar geworden. Deshalb ist das grüne Fenster
 * jetzt in MILLISEKUNDEN definiert (`HEAD_GREEN_MS_BASE/SKILL`) und wird erst
 * beim Zeichnen in einen Anteil der Flugzeit umgerechnet.
 *
 * Abweichungen vom Umbauplan (Abschnitt 3, Paket 6) — bewusst und gemessen:
 *   • `elev = lerp(18°, 42°)` ergibt für die lange Ecke 2,96 s Flugzeit und
 *     verfehlt damit den Abnahmekorridor 2,3–2,9 s. Obergrenze deshalb 39°
 *     (gemessen 2,77 s).
 *   • `v0 = lerp(14, 26)` legt die ideale Kraft der kurzen Ecke auf 0,03 —
 *     der Kraftbalken wäre dort nicht mehr bedienbar. Bereich deshalb 11…27 m/s
 *     (ideale Kraft dann 0,22 / 0,59 / 0,78 / 0,79 für die vier Varianten).
 *   • Effet `w.z = curve · 55` rad/s ergibt 7,6 m Ablage über die lange Flanke,
 *     gefordert sind 2–4 m. Deshalb `CURVE_SPIN = 14` rad/s (gemessen 3,4 m).
 *     Vorzeichen negativ, damit „nach innen" den Ball zum Tor zieht.
 *
 * ---------------------------------------------------------------------------
 * BALANCE — was gegen die Abnahmekorridore nachgezogen werden musste
 * ---------------------------------------------------------------------------
 * Die Korridore aus dem Umbauplan (Torquote 2,5–4,5 %, Abnahme 55–70 %, Torwart
 * klärt 8–15 %) sind mit den dort genannten Startwerten NICHT erreichbar; alle
 * Zahlen unten sind gegen `tools/test-ecke.js` gemessen, nicht geschätzt:
 *
 *   • Die kurze Ecke und der Ball an die Strafraumkante sind keine Kopfbälle.
 *     Ein „9-m/s-Kopfball" aus 24 m wäre Unsinn — `spec.kopf === false` löst
 *     deshalb einen SCHUSS aus (`FUSS_V_*`, `FUSS_SIGMA_*`).
 *   • Der Abschusswinkel des Abschlusses kommt aus `loeseAbschuss`, also aus dem
 *     Integrator. Ein reiner Sichtlinienvektor unterschlägt die Schwerkraft; der
 *     Ball setzte damit im Schnitt sechsmal vor der Linie auf.
 *   • Ein Kopfball ist eine ABLENKUNG: die Richtung mischt Anflugrichtung und
 *     Wunschrichtung im Verhältnis `lerp(0.42, 0.94, kopf)`. Ohne diesen Term
 *     gingen nur 16 % der Kopfbälle vorbei (Torquote 9,2 %), mit ihm 33 %.
 *   • `sigmaRad` steht auf `lerp(0.225, 0.085)` statt `lerp(0.16, 0.05)`.
 *   • Der Torwart bekommt zwei Terme, die es bei Elfmeter und Freistoß nicht
 *     gibt, weil es dort keinen vollen Strafraum gibt: `KEEPER_VERKEHR_S`
 *     (Laufzeit durch Körper hindurch) und `TW_SICHT_S` (Reaktionsverlust, weil
 *     er den Abschluss verdeckt sieht). Ohne den zweiten hält er 74 % aller
 *     Kopfbälle aufs Tor. Der Mut zum Herauslaufen fällt zusätzlich mit der
 *     Entfernung des Kontaktpunkts vom Tor.
 *   • `DUELL_ANGRIFF_BONUS = 0,07 m`: wer in den Ball hineinläuft, kommt höher
 *     an ihn als wer rückwärts verteidigt. Der Wert ist extrem empfindlich —
 *     0,20 m ließ die Abwehr auf 5 % Klärungen zusammenbrechen.
 *
 * Gemessen (4000 Ecken, solider Mensch, Schwierigkeit 1,0): Torquote 4,25 %,
 * Abnahme durch einen Angreifer 57,13 %, Torwart klärt die Flanke 12,43 %,
 * Parade gegen den Abschluss 13,10 %.
 *
 * ===========================================================================
 * REPARATUR — das Bild darf dem Banner nicht widersprechen
 * ===========================================================================
 * (1) NACHSPIEL. Die Folgebahn des Abschlusses lief im Ergebnisbild UNGEBREMST
 *     weiter: bei 'parade' flog der Ball sichtbar INS TOR, während „GEHALTEN!"
 *     auf dem Banner stand, bei 'geblockt' durch das Bein des Verteidigers, bei
 *     Aluminium durch den Pfosten — zusammen 22,9 % aller Ecken. Die Bahn wird
 *     jetzt am Trefferzeitpunkt gekappt (`S.folgeStopS`); ab dort läuft ein
 *     echter Abpraller (`S.nachFlug`) oder der Ball ruht in den Handschuhen
 *     (`S.ruhe`). Gegenprobe: 0 von 339 Parade-, Block- und Aluminiumszenen
 *     zeigen den Ball noch hinter der Linie; ein Tor bleibt im Netz hängen
 *     (1,9 m hinter der Linie) statt hinter dem Stadion zu verschwinden.
 *     NICHT behoben und hiermit gemeldet: RESULT_S = 1,5 s ist für die
 *     Fuß-Varianten (Schuss aus 18–24 m) zu kurz — bei rund der Hälfte dieser
 *     Tore endet das Bild, bevor der Ball die Linie erreicht. Das widerspricht
 *     dem Banner nicht, es schneidet nur früh; eine längere Ergebnisphase würde
 *     jede Ecke verlangsamen.
 *
 * (2) ROTER TORWARTBEREICH. Er kam aus `keeperArrivalS`, also aus der ANKUNFT
 *     des Torwarts am Kontaktpunkt — der Ball ist dort aber noch lange nicht.
 *     Im Median sperrte er 0,34 s vor dem Kopfball: bei 46,5 % der langen Ecken
 *     mit herauslaufendem Torwart war das GESAMTE grüne Fenster rot überdeckt,
 *     bei 63,3 % blieben weniger als 100 ms sauber. Der Balken sagte damit
 *     „grün = klicken" und „ab hier rot" über derselben Stelle.
 *     Maßgebend ist jetzt sein BALLKONTAKT `keeperKontaktS = max(Ankunft,
 *     tFaust)`, wobei `tFaust` der Zeitpunkt ist, zu dem der Ball auf Fausthöhe
 *     fällt (rund 25 cm über der Stirn des Abnehmers). Gemessen über 3000 lange
 *     Ecken: sauberes grünes Fenster median 267 ms (vorher 22 ms), 0 % unter
 *     120 ms (vorher 66,4 %); wer rechtzeitig vor dem Torwart abnimmt, liegt in
 *     100 % der Fälle im Grünen (headOffset median −0,41 statt −1,08).
 *     Zusätzlich malt der Balken kein Grün und kein Gelb mehr UNTER den roten
 *     Bereich — was dort steht, ist auch noch zu holen.
 *     Nachgezogene Balance (gemessen, nicht geschätzt): der ehrliche Kontakt
 *     nimmt dem Torwart Bälle weg (Faustabwehr fiel auf 2,53 %), deshalb
 *     `KEEPER_ENTSCHEID` 0,25 → 0,20 und `KEEPER_MUT_DAEMPFER` 1,0 → 1,55. Weil
 *     der Angreifer den herauslaufenden Torwart jetzt wirklich schlagen kann,
 *     stieg die Torquote um 0,4 Punkte über den Korridor; `TW_SICHT_S`
 *     0,055 → 0,045 s zieht sie zurück (4,25 %).
 *     Die Zahlen oben gelten für die LANGE Ecke. Der Torwart kommt aber auch
 *     zum ersten Pfosten heraus (gemessen über die 1500 Ecken je Variante des
 *     Prüfstands: 'lang' 34,9 %, 'erster' 25,0 %, 'kurz' und 'zurueck' 0).
 *     Dort flog der Ball flacher — und `tFaust` war eine reine HÖHENSCHWELLE
 *     ohne Ortsbedingung: der Torwart faustete einen Ball, der zu diesem
 *     Zeitpunkt im Median noch 3,27 m vom Kontaktpunkt entfernt war. Das drückte
 *     das saubere grüne Fenster am ersten Pfosten auf median 173 ms, in 15,7 %
 *     der Herauslauf-Fälle unter `KEEPER_FAIR_S` (über drei Seed-Sätze
 *     9,2–15,7 %). `tFaust` verlangt jetzt BEIDES: Fausthöhe und Reichweite
 *     (`TW_FAUST_R`) um den Kontaktpunkt. Gemessen, drei Seed-Sätze:
 *     'erster' median 232 ms, Minimum 174 ms, 0 % unter `KEEPER_FAIR_S`;
 *     'lang' unverändert (median 267 ms, headOffset median −0,41), Torquote
 *     unverändert 4,25 %, Faustabwehr 12,83 → 12,43 %.
 *     Der Balken malt weiterhin kein Grün und kein Gelb unter den roten Bereich
 *     und schaltet unterhalb `KEEPER_FAIR_S` die Kopfzeile auf „TORWART IST
 *     ZUERST AM BALL!" um. Bei Schwierigkeit 1,0 feuert dieser Pfad seit dem
 *     Reichweitengatter nicht mehr (0 von 899 Herauslauf-Fällen); er bleibt das
 *     Netz für schmale Fenster — bei Schwierigkeit 2,0 ist das halbe Fenster nur
 *     noch 120…215 ms breit, dann kann der Torwart es wieder aufzehren.
 *     Die Messreihen stehen im Kopf von Gruppe 10 in `tools/test-ecke.js`;
 *     die Gruppe misst alle vier Varianten.
 *
 * ===========================================================================
 * PROJEKTION — Lochkamera statt Affinabbildung
 * ===========================================================================
 * Vorher war die Abbildung rein affin (keine perspektivische Division), und die
 * Figuren bekamen einen FESTEN Maßstab: der Eckenschütze wurde mit 1,0 gezeichnet,
 * die Spieler im Strafraum mit 0,95 — der weiter entfernte Mann war also der
 * größere. Jetzt gilt die allgemeine Homographie
 *
 *     w = 1 + pX·(X−34) + pY·Y ,   x = ox + (…)/w ,   y = oy + (…)/w
 *
 * Das ist exakt die Form, die eine Lochkamera auf einer Ebene erzeugt, und sie
 * ist EXAKT invertierbar: für Z = 0 bleibt das Gleichungssystem in (X, Y) linear
 * (siehe `toWorld`), es braucht keine Newton-Iteration. Der Nachtrag erlaubt
 * ausdrücklich eine iterative Lösung — die ist hier nicht nötig, die Maussteuerung
 * bleibt also millimetergenau. `pX < 0` bedeutet: die linke Seite (und damit die
 * Eckfahne) liegt weiter von der Kamera weg.
 *
 * Der Figurenmaßstab kommt aus derselben Division (`figurenSkala`).
 *
 * NICHT geändert (und hiermit gemeldet): das Verhältnis Figurengröße zu
 * Torgröße stimmt nicht — `P.zs = 11` px/m für Höhen gegen ~26 px/m der
 * Spielersprites. Das Tor wird dadurch rund 2,4× zu klein gegenüber den Figuren
 * gezeichnet (dieselbe Klasse Fehler, die der Nachtrag in `finish.js` beschreibt).
 * Der Nachtrag nennt für `corner.js` nur Division, Figurenmaßstab und Ballschatten;
 * eine Korrektur von `zs` würde die ganze Szene neu einrichten und die Figuren auf
 * ~20 px Höhe schrumpfen. Bewusst offen gelassen.
 */

import { clamp, lerp } from '../core/util.js';
import {
  BALL_R,
  createFlug, abschussVektor, loeseAbschuss,
  laufwerte, sprintStrecke,
  twParameter, twReichweite
} from '../core/ballistik.js';

/* ========================================================================== *
 *  BALANCING-KONSTANTEN
 * ========================================================================== */

const CANVAS_W = 960;
const CANVAS_H = 600;
const HARD_TIMEOUT_S = 20;
const GRAD = Math.PI / 180;

/** Zeitfenster der einzelnen Phasen (Sekunden). Der Flug dauert so lange wie er dauert. */
const PHASE_VARIANT_S = 5.0;
const PHASE_AIM_S = 7.0;
const RESULT_S = 1.5;

/** Kraftbalken: Durchläufe pro Sekunde und Breite des optimalen Bereichs. */
const POWER_SPEED = 1.15;
const POWER_SWEET = 0.13;

/** Abschuss der Flanke. */
const V0_MIN = 11.0;             // m/s bei Kraft 0
const V0_MAX = 27.0;             // m/s bei Kraft 1
const ELEV_MIN = 18 * GRAD;      // Abschusswinkel bei hoehe 0
const ELEV_MAX = 39 * GRAD;      // Abschusswinkel bei hoehe 1
const CURVE_SPIN = 14.0;         // rad/s Drall um die Hochachse bei |curve| = 1

/** Kopfball-Timing — ABSOLUT in Millisekunden, siehe Dateikopf. */
const HEAD_GREEN_MS_BASE = 240;  // halbe Fensterbreite bei Kopfballwert 0
const HEAD_GREEN_MS_SKILL = 190; // Zuschlag bei Kopfballwert 1
const HEAD_TRAIT_BONUS = 1.35;   // Trait 'kopfballungeheuer'
const HEAD_MISS_OFFSET = 2.2;    // ab diesem Vielfachen ist es ein Luftloch
const HEAD_GREEN_MIN_S = 0.10;
const HEAD_GREEN_MAX_S = 0.60;

/** Kopfballduell. */
const HEAD_MAX_Z = 2.6;          // höher als das köpft niemand
const HEAD_REACH_R = 1.5;        // m, in denen der Abnehmer an den Ball kommt
const HEAD_MITTE_Z = 1.55;       // Mittelpunkt der Trefferkugel über dem Boden
const HEAD_REAKT_S = 0.18;       // bis der Abnehmer losläuft
const DUELL_GLEICHSTAND = 0.10;  // m Unterschied, ab dem es kein Gleichstand mehr ist
const DUELL_FENSTER_S = 0.15;    // wer so viel später da ist, spielt nicht mehr mit
const DUELL_TIMING_MALUS = 0.10; // m Reichweite je Einheit Timingfehler
/** Wer in den Ball hineinläuft, kommt höher an ihn als wer rückwärts verteidigt. */
const DUELL_ANGRIFF_BONUS = 0.07;

/** Ausführungsgüte der Flanke. */
const DELIVERY_FAIL = 0.20;      // darunter kommt die Ecke gar nicht erst an
const AIM_TOLERANCE = 9.0;       // m Abweichung von der Variante = voller Abzug

/** Abschluss nach der Abnahme. */
const KOPF_V_MIN = 9.0;          // m/s bei Kopfballwert 0
const KOPF_V_MAX = 17.0;         // m/s bei Kopfballwert 1
const KOPF_SIGMA_MIN = 0.085;     // rad Winkelstreuung bei Kopfballwert 1
const KOPF_SIGMA_MAX = 0.225;     // rad Winkelstreuung bei Kopfballwert 0
/* Die kurze Ecke und der Ball an die Strafraumkante werden nicht geköpft,
 * sondern geschossen — mit dem Fuß und aus deutlich größerer Entfernung. */
const FUSS_V_MIN = 15.0;
const FUSS_V_MAX = 25.0;
const FUSS_SIGMA_MIN = 0.065;
const FUSS_SIGMA_MAX = 0.160;
const BLOCK_FENSTER_S = 0.25;    // so lange kann ein Bein den Kopfball noch blocken
const BLOCK_HALB_X = 0.62;
const BLOCK_HALB_Y = 0.30;
const TW_HAND_R = 0.36;

/** Nachspiel: womit der Ball weiterfliegt, nachdem er irgendwo angeschlagen ist. */
const NACH_DAEMPFUNG_BEIN = 0.45;  // Abpraller vom Verteidigerbein
const NACH_DAEMPFUNG_HOLZ = 0.55;  // Pfosten und Latte
const NACH_DAEMPFUNG_HAND = 0.30;  // vom Torwart abgeklatscht
const NACH_DAEMPFUNG_NETZ = 0.10;  // das Netz frisst fast alles
const TW_FEST_V = 11.0;            // m/s; darunter hält der Torwart ihn fest
const NETZ_TIEFE = 1.9;            // m hinter der Torlinie (wie in drawGoal)
const NACH_TMAX = 1.8;             // s Nachspiel — deckt RESULT_S ab

/** Tor in Weltkoordinaten (X quer, Tormitte 34; Y = Meter von der Torlinie). */
const GOAL_HALF = 3.66;
const GOAL_H = 2.44;
const PFOSTEN_BAND = 0.06;

/** Torwart läuft heraus. */
const KEEPER_OUT_RANGE = 12;     // m vom Tor, bis wohin er sich traut
const KEEPER_MUT_MIN = 0.35;     // Herauslaufen ist Mut, nicht Können
const KEEPER_MUT_MAX = 0.90;
const KEEPER_MUT_DAEMPFER = 1.55; // gemessen gegen den Korridor „Torwart klärt 8–15 %"
const KEEPER_ENTSCHEID = 0.20;   // Anteil der Flugzeit, ab dem er sich entscheidet
const KEEPER_VOR_S = 0.06;       // so viel früher muss er am Ball sein
/** Höhe, in der der Torwart die Faust an den Ball bringt (Stand + Sprung). */
const TW_FAUST_STAND = 2.05;
/** Wie weit die Faust um den Kontaktpunkt herum greift — weiter als ein Kopf
 *  (HEAD_REACH_R = 1,5 m). Gemessen gegen das grüne Fenster am ersten Pfosten:
 *  1,5 m gattert zu scharf (Faustabwehr 12,8 → 9,6 %), 2,0 m schließt die Lücke
 *  ohne messbare Balanceänderung, 2,6 m lässt sie halb offen. */
const TW_FAUST_R = 2.0;
const TW_FAUST_SPRUNG_MIN = 0.30;
const TW_FAUST_SPRUNG_MAX = 0.68;
/** So viel vom grünen Fenster muss sauber bleiben, sonst sagt der Balken die Wahrheit. */
const KEEPER_FAIR_S = 0.12;
const KEEPER_V_MIN = 3.8;        // m/s
const KEEPER_V_MAX = 5.4;
/** Jeder Körper im Weg kostet den herauslaufenden Torwart Zeit. */
const KEEPER_VERKEHR_S = 0.30;
const KEEPER_VERKEHR_R = 1.3;    // m Abstand zur Laufachse, ab dem jemand im Weg steht
const TW_SICHT_S = 0.045;        // s Reaktionsverlust je Körper auf der Sichtachse

const XG_MIN = -0.10;
const XG_MAX = 0.40;

/** Ecke wird von hier ausgeführt (Weltkoordinaten). */
const CORNER = { X: 0.6, Y: 0.6 };

/** Eckenvarianten. zone = angepeilter Zielpunkt in Weltkoordinaten. */
const VARIANTS = {
  lang: {
    key: '1', name: 'Hoch an den langen Pfosten', short: 'LANGER PFOSTEN',
    zone: { X: 39.5, Y: 6.0 }, hoehe: 1.00, idealCurve: 0.75, kopf: true,
    desc: 'Der Klassiker: hoch und weit – Zielwasser für die Kopfballstarken.'
  },
  kurz: {
    key: '2', name: 'Kurz ausgeführt', short: 'KURZ',
    zone: { X: 12.0, Y: 8.0 }, hoehe: 0.30, idealCurve: 0.0, kopf: false,
    desc: 'Kurz ablegen, flach zurück – zieht die Abwehr auseinander.'
  },
  erster: {
    key: '3', name: 'Scharf an den ersten Pfosten', short: 'ERSTER PFOSTEN',
    zone: { X: 29.5, Y: 3.5 }, hoehe: 0.55, idealCurve: 1.0, kopf: true,
    desc: 'Scharf und schnell – schwer zu verteidigen, schwer zu treffen.'
  },
  zurueck: {
    key: '4', name: 'Zurück an die Strafraumkante', short: 'STRAFRAUMKANTE',
    zone: { X: 34.0, Y: 17.5 }, hoehe: 0.70, idealCurve: -0.4, kopf: false,
    desc: 'Für den Schuss aus der zweiten Reihe – sicher, aber weit weg.'
  }
};
const VARIANT_ORDER = ['lang', 'kurz', 'erster', 'zurueck'];

/* --- Projektion: Lochkamera schräg hinter der Torlinie -------------------- *
 *  X = 0..68 quer (Tormitte 34), Y = Meter von der Torlinie weg, Z = Höhe.
 *  w = 1 + pX·(X−34) + pY·Y ist die homogene Koordinate; pX < 0 heißt: links
 *  (und damit die Eckfahne) liegt weiter weg.                                */
const P = {
  ox: 470, oy: 300, ax: 12.6, ay: -2.4, bx: 5.0, by: 9.6, zs: 11.0,
  pX: -0.0090, pY: 0.0140
};
/** Untergrenze für w — verhindert, dass Randgeometrie ins Unendliche läuft. */
const W_MIN = 0.35;
/** Figurenmaßstab bei w = 1 (also auf Höhe der Tormitte). */
const FIG_BASIS = 0.98;

const COL = {
  rasen: '#2f7d32', rasenDunkel: '#276b2a', linie: '#f4f4ec', outline: '#0d1116',
  beige: '#e8d9b0', papier: '#f2e8cf', holz: '#8b5a2b', dunkel: '#1a1f28',
  rot: '#c1272d', blau: '#1c4f8f', gelb: '#f5c518', gruen: '#3fae4a', hellblau: '#8fc4f0'
};

/* ========================================================================== *
 *  HELFER
 * ========================================================================== */

let warnedDraw = false;

const att = (p, key, fallback = 50) => {
  const v = p && p.attributes ? p.attributes[key] : undefined;
  return typeof v === 'number' ? v : fallback;
};
const hasTrait = (p, key) => !!(p && Array.isArray(p.traits) && p.traits.indexOf(key) >= 0);
const nameOf = (p, fallback = 'Spieler') => (p && (p.shortName || p.lastName)) || fallback;

function rFloat(rng, a, b) { return a + rng.next() * (b - a); }
function rChance(rng, p) { return rng.next() < p; }
/** Normalverteilt über Box-Muller aus rng.next() — kommt ohne rng.gauss aus. */
function rGauss(rng) {
  const u = Math.max(1e-9, rng.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * rng.next());
}

/** Homogene Koordinate (Tiefe) eines Weltpunkts. */
function tiefe(X, Y) {
  const w = 1 + P.pX * (X - 34) + P.pY * Y;
  return w < W_MIN ? W_MIN : w;
}

/** Weltkoordinaten -> Bildschirm (perspektivische Division). */
function toScreen(X, Y, Z = 0) {
  const w = tiefe(X, Y);
  const X1 = X - 34;
  return {
    x: P.ox + (X1 * P.ax + Y * P.bx) / w,
    y: P.oy + (X1 * P.ay + Y * P.by - Z * P.zs) / w
  };
}

/**
 * Bildschirm -> Weltkoordinaten auf dem Boden. Exakte Umkehrung:
 * mit Z = 0 bleibt das System in (X−34, Y) linear, weil w selbst affin ist.
 *   (sx−ox)·w = X1·ax + Y·bx   ⇒   X1·(ax − dx·pX) + Y·(bx − dx·pY) = dx
 *   (sy−oy)·w = X1·ay + Y·by   ⇒   X1·(ay − dy·pX) + Y·(by − dy·pY) = dy
 */
function toWorld(sx, sy) {
  const dx = sx - P.ox, dy = sy - P.oy;
  const a11 = P.ax - dx * P.pX, a12 = P.bx - dx * P.pY;
  const a21 = P.ay - dy * P.pX, a22 = P.by - dy * P.pY;
  const det = a11 * a22 - a12 * a21;
  if (!isFinite(det) || Math.abs(det) < 1e-9) return { X: 34, Y: 0 };
  return { X: (dx * a22 - dy * a12) / det + 34, Y: (a11 * dy - a21 * dx) / det };
}

/** Figurenmaßstab aus derselben Division — weit weg heißt klein. */
function figurenSkala(X, Y) { return FIG_BASIS / tiefe(X, Y); }

/** Deterministisches Rauschen für Ränge und Blitzlichter (kein rng im Bild!). */
function hash01(i) {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/* ========================================================================== *
 *  FLUGMODELL  (DOM-frei, ohne Zustand — auch vom Prüfexport benutzt)
 * ========================================================================== */

const _vv = { x: 0, y: 0, z: 0 };
const _ww = { x: 0, y: 0, z: 0 };
const _initFlanke = { p: { x: 0, y: 0, z: 0 }, v: _vv, w: _ww, boden: 0, tMax: 5.0 };
const _zustand = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
/** Mittelpunkt der Faustkugel — der Kontaktpunkt auf Fausthöhe. */
const _faustMitte = { x: 0, y: 0, z: 0 };
const _faustMitteFn = () => _faustMitte;

/**
 * Ein Flankenflug. Richtung aus dem Zielpunkt, Stärke aus dem Kraftbalken,
 * Abschusswinkel aus der Variantenhöhe, Effet als Drall um die Hochachse.
 * Die Fehlerterme kommen aus der Ausführungsgüte des Schützen.
 */
function flankenFlug(aimX, aimY, power, hoehe, curve, gierFehler, neigFehler, tempoFaktor) {
  const dx = aimX - CORNER.X, dy = aimY - CORNER.Y;
  const gier = Math.atan2(dy, dx) + (gierFehler || 0);
  const v0 = Math.max(3, lerp(V0_MIN, V0_MAX, clamp(power, 0, 1)) * (tempoFaktor || 1));
  const elev = clamp(lerp(ELEV_MIN, ELEV_MAX, clamp(hoehe, 0, 1)) + (neigFehler || 0), 0.05, 1.30);
  abschussVektor(v0, gier, elev, _vv);
  _ww.x = 0; _ww.y = 0; _ww.z = -clamp(curve, -1, 1) * CURVE_SPIN;
  _initFlanke.p.x = CORNER.X; _initFlanke.p.y = CORNER.Y; _initFlanke.p.z = BALL_R;
  _initFlanke.tMax = 5.0;
  return createFlug(_initFlanke);
}

const TABELLE_N = 17;
/** Reichweite über die Kraft (bei fester Variantenhöhe) — einmal je Variante. */
function reichweiteTabelle(hoehe) {
  const t = new Float64Array(TABELLE_N);
  for (let i = 0; i < TABELLE_N; i++) {
    const f = flankenFlug(CORNER.X + 10, CORNER.Y + 10, i / (TABELLE_N - 1), hoehe, 0, 0, 0, 1);
    const l = f.landung();
    t[i] = l ? Math.hypot(l.x - CORNER.X, l.y - CORNER.Y) : 0;
    f.freigeben();
  }
  return t;
}
/** Umkehrung der Tabelle: welche Kraft trägt genau D Meter weit? */
function kraftFuer(D, tab) {
  if (!tab || !tab.length) return 0.6;
  if (D <= tab[0]) return 0;
  for (let i = 1; i < tab.length; i++) {
    if (D <= tab[i]) {
      const f = (D - tab[i - 1]) / Math.max(1e-6, tab[i] - tab[i - 1]);
      return clamp((i - 1 + f) / (tab.length - 1), 0, 1);
    }
  }
  return 1;
}

/** Halbe Breite des grünen Kopfballfensters — in SEKUNDEN, nicht in Anteilen. */
function gruenesFensterS(kopfWert, ungeheuer, diff) {
  const ms = HEAD_GREEN_MS_BASE + HEAD_GREEN_MS_SKILL * clamp(kopfWert, 0, 1);
  return clamp(ms / 1000 * (ungeheuer ? HEAD_TRAIT_BONUS : 1) / clamp(diff || 1, 0.4, 2),
    HEAD_GREEN_MIN_S, HEAD_GREEN_MAX_S);
}

/** Wie hoch dieser Spieler den Ball noch erreicht (Scheitel der Stirn). */
function zReichweite(player) {
  return 1.78 + att(player, 'koerper') / 99 * 0.22
    + lerp(0.30, 0.68, att(player, 'sprungkraft') / 99);
}

/**
 * Wie hoch der Torwart die FAUST an den Ball bringt. Rund 25 cm über der Stirn
 * eines gleich gebauten Feldspielers — genau daraus entsteht sein Vorsprung:
 * er nimmt den Ball ein paar Hundertstel früher, nicht drei Zehntel.
 */
function zFaustReichweite(player) {
  return TW_FAUST_STAND + att(player, 'koerper', 55) / 99 * 0.25
    + lerp(TW_FAUST_SPRUNG_MIN, TW_FAUST_SPRUNG_MAX, att(player, 'sprungkraft', 55) / 99);
}

/** Zeitpunkt, zu dem der Ball auf dem ABSTEIGENDEN Ast durch die Höhe z fällt. */
function abstiegsZeit(flug, z, tBis) {
  const ts = flug.scheitel().t;
  if (flug.scheitel().z <= z) return ts;
  const tr = flug.trefferEbene('z', z, ts, tBis);
  return tr ? tr.t : ts;
}

/* ========================================================================== *
 *  SZENE  (DOM-frei: Zustand, Physik und Auflösung ohne einen einzigen
 *          Canvas-Zugriff — `minigame.play` zeichnet sie nur, `modell.szene`
 *          fährt dieselbe Maschine kopflos durch.)
 * ========================================================================== */

const ATT_SPOTS = [{ X: 38, Y: 5.5 }, { X: 31, Y: 4.5 }, { X: 34.5, Y: 9.5 }, { X: 26, Y: 8.0 }];
const DEF_SPOTS = [{ X: 36.5, Y: 4.0 }, { X: 29.5, Y: 3.0 }, { X: 33, Y: 7.5 }, { X: 24, Y: 6.0 }];

function createSzene(cfg) {
  const rng = cfg.rng;
  const diff = clamp((cfg.diff === undefined ? 1 : cfg.diff), 0.4, 2);
  const taker = cfg.taker || null;
  const keeper = cfg.keeper || null;
  const sfx = typeof cfg.sfx === 'function' ? cfg.sfx : () => { };

  const rawTargets = (Array.isArray(cfg.targets) ? cfg.targets : []).filter(Boolean).slice(0, 4);
  const rawDefs = (Array.isArray(cfg.defenders) ? cfg.defenders : []).filter(Boolean).slice(0, 4);

  /** Ein Akteur im Strafraum. `_m` ist der wiederverwendete Puffer für trefferKugel. */
  function baueAkteur(player, spot, seite, streuung) {
    return {
      player,
      seite,
      X: clamp(spot.X + rFloat(rng, -streuung, streuung), 15, 53),
      Y: clamp(spot.Y + rFloat(rng, -streuung * 0.8, streuung * 0.8), 1.5, 18),
      X0: 0, Y0: 0,
      kopf: clamp((att(player, 'kopfball') * 0.62 + att(player, 'sprungkraft') * 0.38) / 99, 0, 1),
      zweikampf: att(player, 'zweikampf') / 99,
      schussWert: att(player, 'schuss') / 99,
      technik: att(player, 'technik') / 99,
      sprungkraft: att(player, 'sprungkraft'),
      zReach: zReichweite(player),
      k: laufwerte({
        tempo: att(player, 'tempo'), antritt: att(player, 'aggressivitaet'),
        koerper: att(player, 'koerper'), fitness: (player && player.fitness) || 100
      }),
      zielX: 0, zielY: 0,
      _m: { x: 0, y: 0, z: HEAD_MITTE_Z }
    };
  }

  const attackers = [];
  for (let i = 0; i < Math.max(3, rawTargets.length); i++) {
    attackers.push(baueAkteur(rawTargets[i] || null, ATT_SPOTS[i % ATT_SPOTS.length], 'att', 1.5));
  }
  const defenders = [];
  for (let i = 0; i < Math.max(3, rawDefs.length); i++) {
    defenders.push(baueAkteur(rawDefs[i] || null, DEF_SPOTS[i % DEF_SPOTS.length], 'def', 1.5));
  }
  const alleAkteure = attackers.concat(defenders);
  for (const a of alleAkteure) {
    // Der Abnehmer wird zum Ball geführt; die Sprungwerte bleiben unangetastet.
    a.mittelFn = (t) => {
      const s = sprintStrecke(Math.max(0, t - HEAD_REAKT_S), a.k);
      const dx = a.zielX - a.X0, dy = a.zielY - a.Y0;
      const d = Math.hypot(dx, dy);
      const f = d > 1e-6 ? Math.min(1, s / d) : 0;
      a._m.x = a.X0 + dx * f; a._m.y = a.Y0 + dy * f;
      return a._m;
    };
  }

  const kp = {
    player: keeper, X: 34, Y: 1.4, seite: 'tw',
    zFaust: zFaustReichweite(keeper),
    speed: lerp(KEEPER_V_MIN, KEEPER_V_MAX, att(keeper, 'strafraumbeherrschung', 55) / 99),
    par: twParameter({
      reflexe: att(keeper, 'reflexe', 55),
      antizipation: att(keeper, 'stellungsspiel', 55),
      sprungkraft: att(keeper, 'sprungkraft', 55),
      groesse: (keeper && keeper.appearance && keeper.appearance.height)
        ? keeper.appearance.height / 100 : 1.88
    })
  };

  const takerAkteur = { player: taker, X: 0.9, Y: 1.0, seite: 'schuetze' };

  const takerSkill = clamp(
    (att(taker, 'standards') * 0.50 + att(taker, 'technik') * 0.25 + att(taker, 'uebersicht') * 0.25) / 99, 0, 1)
    * (hasTrait(taker, 'eckenspezialist') ? 1.12 : 1);
  const keeperSkill = clamp(
    (att(keeper, 'strafraumbeherrschung', 55) * 0.55 + att(keeper, 'reflexe', 55) * 0.45) / 99, 0, 1);

  const S = {
    phase: 'variante',        // variante | zielen | flug | ergebnis
    t: 0, phaseT: 0,
    variant: 'lang',
    aim: { X: VARIANTS.lang.zone.X, Y: VARIANTS.lang.zone.Y },
    curve: VARIANTS.lang.idealCurve,
    power: 0, powerDir: 1, charging: false, lockedPower: 0,
    deliveryQ: 0, failedDelivery: false,
    flug: null, flightS: 1.4, flugEndeS: 1.4, landing: null,
    tHead: null, kontakt: null, kandidaten: [],
    receiver: null, halfS: 0.3, barStart: 0.3,
    headOffset: null,         // Timingabweichung in Vielfachen des grünen Bereichs
    headTimeS: null,
    keeperGeprueft: false, keeperOut: false, keeperArrivalS: 99,
    tFaust: 99, keeperKontaktS: 99,
    folgeFlug: null,          // Kopfball- oder Faustabwehrbahn (fürs Bild)
    folgeStopS: Infinity,     // Zeitpunkt, an dem diese Bahn anschlägt
    nachFlug: null,           // Abpraller ab diesem Zeitpunkt
    ruhe: null,               // oder: der Ball liegt/ruht hier
    duellSieger: null,
    resolution: null,
    banner: '', bannerColor: COL.gelb,
    hoverVariant: null
  };

  const tabellen = {};
  const tabelleFuer = (key) => {
    if (!tabellen[key]) tabellen[key] = reichweiteTabelle(VARIANTS[key].hoehe);
    return tabellen[key];
  };

  /** Optimale Kraft für die aktuelle Zieldistanz (0..1) — aus dem Integrator. */
  function idealPower() {
    const d = Math.hypot(S.aim.X - CORNER.X, S.aim.Y - CORNER.Y);
    return kraftFuer(d, tabelleFuer(S.variant));
  }

  function chooseVariant(key) {
    if (S.phase !== 'variante' || !VARIANTS[key]) return;
    S.variant = key;
    S.aim = { X: VARIANTS[key].zone.X, Y: VARIANTS[key].zone.Y };
    S.curve = VARIANTS[key].idealCurve;
    tabelleFuer(key);
    S.phase = 'zielen';
    S.phaseT = 0;
    sfx('klick');
  }

  function setAim(X, Y) {
    if (S.phase !== 'zielen') return;
    S.aim.X = clamp(X, 8, 58);
    S.aim.Y = clamp(Y, 1.5, 22);
  }
  function setCurve(c) { S.curve = clamp(c, -1, 1); }

  /* ---------------------------------------------------------------- *
   *  Flanke abgeben
   * ---------------------------------------------------------------- */

  function deliver(power) {
    if (S.phase !== 'zielen') return;
    const spec = VARIANTS[S.variant];
    S.lockedPower = clamp(power, 0, 1);

    const powDev = clamp(Math.abs(S.lockedPower - idealPower()) / 0.30, 0, 1);
    // Ausführung: die Streuung sitzt jetzt im ABSCHUSS, nicht im Landepunkt.
    const basis = clamp(0.20 + 0.55 * takerSkill + 0.25 * (1 - powDev), 0, 1);
    const streu = 1 - basis;
    const gierFehler = rGauss(rng) * streu * 0.075;
    const neigFehler = rGauss(rng) * streu * 0.055;
    const tempoFaktor = 1 + rGauss(rng) * streu * 0.09;

    if (S.flug) { S.flug.freigeben(); S.flug = null; }
    S.flug = flankenFlug(S.aim.X, S.aim.Y, S.lockedPower, spec.hoehe, S.curve,
      gierFehler, neigFehler, tempoFaktor);

    const l = S.flug.landung();
    S.flightS = l ? l.t : S.flug.dauer;
    S.landing = l ? { X: l.x, Y: l.y } : { X: S.aim.X, Y: S.aim.Y };

    // Der Effet verschiebt den Landepunkt wirklich — also wird er hier bewertet.
    const aimDev = clamp(
      Math.hypot(S.landing.X - spec.zone.X, S.landing.Y - spec.zone.Y) / AIM_TOLERANCE, 0, 1);
    let q = 0.10 + 0.34 * takerSkill + 0.36 * (1 - aimDev) + 0.20 * (1 - powDev);
    q *= (1.14 - 0.14 * diff);
    S.deliveryQ = clamp(q, 0, 1);
    S.failedDelivery = S.deliveryQ < DELIVERY_FAIL;

    for (const a of alleAkteure) {
      a.X0 = a.X; a.Y0 = a.Y;
      a.zielX = S.landing.X; a.zielY = S.landing.Y;
    }

    kontaktSuchen();

    S.phase = 'flug';
    S.phaseT = 0;
    sfx('schuss', { lautstaerke: 0.7, hoehe: 1.25 });
  }

  /**
   * Kontaktpunkt und Bewerber. Der Ball muss unter HEAD_MAX_Z sein UND unter der
   * persönlichen Reichweite des Bewerbers, und der Bewerber muss den Punkt
   * räumlich erreichen (Sprintmodell in `mittelFn`, geprüft mit trefferKugel).
   */
  function kontaktSuchen() {
    const flug = S.flug;
    const l = flug.landung();
    const tBis = Math.min(flug.dauer, (l ? l.t : flug.dauer) + 0.25);
    const tAb = abstiegsZeit(flug, HEAD_MAX_Z, tBis);

    S.kandidaten.length = 0;
    let frueh = null;
    for (const a of alleAkteure) {
      const von = Math.max(tAb, abstiegsZeit(flug, Math.min(a.zReach, HEAD_MAX_Z), tBis));
      if (von >= tBis) continue;
      const tr = flug.trefferKugel(a.mittelFn, HEAD_REACH_R, von, tBis);
      if (!tr || tr.z > a.zReach + 0.05) continue;
      const eintrag = { a, t: tr.t, X: tr.x, Y: tr.y, Z: tr.z };
      S.kandidaten.push(eintrag);
      if (!frueh || eintrag.t < frueh.t) frueh = eintrag;
    }

    if (frueh) {
      S.tHead = frueh.t;
      S.kontakt = { X: frueh.X, Y: frueh.Y, Z: frueh.Z, t: frueh.t };
      // Wer mehr als DUELL_FENSTER_S später da ist, kommt nicht mehr ins Duell.
      S.kandidaten = S.kandidaten.filter((e) => e.t <= frueh.t + DUELL_FENSTER_S);
    } else {
      // Niemand geht hin: der Ball fällt trotzdem irgendwann durch 2,6 m.
      S.tHead = Math.min(tAb > 0 ? tAb : S.flightS * 0.85, S.flightS);
      const b = flug.at(S.tHead, _zustand);
      S.kontakt = { X: b.x, Y: b.y, Z: b.z, t: S.tHead };
    }

    /* Wann kann der herauslaufende Torwart den Ball frühestens FAUSTEN? Zwei
     * Bedingungen, nicht eine: der Ball muss auf Fausthöhe gefallen sein UND in
     * Reichweite des Kontaktpunkts sein, an dem der Torwart steht. Ohne die
     * zweite Bedingung faustet er einen Ball, der noch drei Meter weit weg ist —
     * bei der flachen Ecke an den ersten Pfosten lag er zu diesem Zeitpunkt im
     * Median 3,27 m daneben, und der rote Bereich im Timingbalken fraß dadurch
     * das grüne Fenster von 267 auf 173 ms zusammen. Die Faust greift weiter als
     * ein Kopf (TW_FAUST_R gegen HEAD_REACH_R) — genau das ist sein Vorsprung. */
    {
      const vonFaust = abstiegsZeit(flug, kp.zFaust, tBis);
      _faustMitte.x = S.kontakt.X; _faustMitte.y = S.kontakt.Y; _faustMitte.z = kp.zFaust;
      const trF = flug.trefferKugel(_faustMitteFn, TW_FAUST_R, vonFaust, tBis);
      S.tFaust = trF ? trF.t : tBis;
    }

    // Vorläufiger Abnehmer: der Angreifer mit der größten Reichweite. Das
    // endgültige Duell (samt Verteidigern und Timing) fällt erst beim Kontakt.
    let best = null;
    for (const e of S.kandidaten) {
      if (e.a.seite !== 'att') continue;
      if (!best || e.a.zReach > best.a.zReach) best = e;
    }
    S.receiver = best ? best.a : null;

    S.halfS = gruenesFensterS(
      S.receiver ? S.receiver.kopf : 0.5,
      S.receiver && hasTrait(S.receiver.player, 'kopfballungeheuer'), diff);
    S.barStart = clamp(S.tHead / Math.max(0.2, S.flightS) - 0.55, 0.1, 0.6);
    S.flugEndeS = Math.min(
      Math.max(S.flightS, S.tHead + S.halfS * HEAD_MISS_OFFSET + 0.10),
      S.flightS + 1.2);
  }

  /* ---------------------------------------------------------------- *
   *  Torwart — laufende Entscheidung, einmal gezogen
   * ---------------------------------------------------------------- */

  /** Wie viele Körper stehen zwischen Torwart und Kontaktpunkt? */
  function verkehrAufDemWeg() {
    const ax = kp.X, ay = kp.Y;
    const bx = S.kontakt.X, by = S.kontakt.Y;
    const dx = bx - ax, dy = by - ay;
    const ll = dx * dx + dy * dy;
    if (ll < 1e-6) return 0;
    let n = 0;
    for (const a of alleAkteure) {
      const u = clamp(((a.X - ax) * dx + (a.Y - ay) * dy) / ll, 0, 1);
      const qx = ax + dx * u - a.X, qy = ay + dy * u - a.Y;
      if (Math.hypot(qx, qy) < KEEPER_VERKEHR_R) n++;
    }
    return n;
  }

  /**
   * Läuft der Torwart heraus — und ab wann gehört ihm der Ball?
   *
   * ENTSCHEIDEND und vorher falsch: `keeperArrivalS` ist der Zeitpunkt, zu dem er
   * am KONTAKTPUNKT ANKOMMT. Der Ball liegt dann noch lange nicht dort. Wer aus
   * dieser Ankunft den roten Bereich im Timingbalken zeichnet, sperrt im Schnitt
   * 0,34 s vor dem Kopfball — und damit fast das ganze grüne Fenster (gemessen:
   * bei 46,5 % der langen Ecken mit herauslaufendem Torwart war es VOLLSTÄNDIG
   * rot). Der Balken sagte dann „grün = klicken" und „ab hier rot" über derselben
   * Stelle.
   *
   * Richtig ist der Zeitpunkt, zu dem er den BALL erreicht: er muss da sein UND
   * der Ball muss auf Fausthöhe gefallen sein. Weil seine Faust nur rund 25 cm
   * über der Stirn des Abnehmers steht, sind das wenige Hundertstel vor dem
   * Kopfball — das grüne Fenster bleibt bedienbar, und „früher abnehmen" ist eine
   * Aufforderung, die man auch erfüllen kann.
   */
  function keeperEntscheidung() {
    S.keeperGeprueft = true;
    const t0 = KEEPER_ENTSCHEID * S.flightS;
    const dK = Math.hypot(kp.X - S.kontakt.X, kp.Y - S.kontakt.Y);
    // Der Weg durch den vollen Strafraum ist kein freier Sprint.
    S.keeperArrivalS = t0 + dK / kp.speed + verkehrAufDemWeg() * KEEPER_VERKEHR_S;
    S.keeperKontaktS = Math.max(S.keeperArrivalS, S.tFaust);
    const distToGoal = Math.hypot(S.kontakt.X - 34, S.kontakt.Y);
    // Mut, nicht Können — und je weiter draußen, desto seltener.
    const mut = lerp(KEEPER_MUT_MIN, KEEPER_MUT_MAX, keeperSkill)
      * KEEPER_MUT_DAEMPFER * clamp(1 - (distToGoal - 6) / 9, 0.12, 1);
    S.keeperOut = S.keeperKontaktS < S.tHead - KEEPER_VOR_S
      && distToGoal < KEEPER_OUT_RANGE
      && rChance(rng, mut);
  }

  /* ---------------------------------------------------------------- *
   *  Kopfball
   * ---------------------------------------------------------------- */

  function headAttempt() {
    if (S.phase !== 'flug' || S.headOffset !== null) return;
    headAttemptBei(S.phaseT);
  }
  function headAttemptBei(t) {
    if (S.phase !== 'flug' || S.headOffset !== null) return;
    S.headTimeS = t;
    S.headOffset = (t - S.tHead) / Math.max(1e-3, S.halfS);
    sfx('block', { hoehe: 1.35 });
  }

  /** Duell am Kontaktpunkt. Timing zahlt auf die eigene Reichweite ein. */
  function duellLoesen() {
    const off = S.headOffset === null ? 99 : Math.abs(S.headOffset);
    let bestA = null, bestD = null;
    for (const e of S.kandidaten) {
      const z = e.a.seite === 'att'
        ? e.a.zReach + DUELL_ANGRIFF_BONUS - DUELL_TIMING_MALUS * clamp(off, 0, 2)
        : e.a.zReach;
      if (e.a.seite === 'att') { if (!bestA || z > bestA.z) bestA = { a: e.a, z }; }
      else if (!bestD || z > bestD.z) bestD = { a: e.a, z };
    }
    if (!bestA && !bestD) return null;
    if (!bestD) return bestA.a;
    if (!bestA) return bestD.a;
    if (Math.abs(bestA.z - bestD.z) <= DUELL_GLEICHSTAND) {
      // Gleichstand: EIN Wurf, Basis Zweikampfwert (+ Kopfballstärke als Gewicht).
      const p = clamp(0.5 + 0.42 * (bestA.a.zweikampf - bestD.a.zweikampf)
        + 0.16 * (bestA.a.kopf - bestD.a.kopf), 0.10, 0.90);
      return rChance(rng, p) ? bestA.a : bestD.a;
    }
    return bestA.z > bestD.z ? bestA.a : bestD.a;
  }

  const _abVon = { x: 0, y: 0, z: 0 };
  const _abNach = { x: 0, y: 0, z: 0 };
  const _abBall = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };

  /**
   * Zweite Bahn: der Abschluss selbst. Der Kopfball wird geköpft, die kurze Ecke
   * und der Ball an die Strafraumkante werden GESCHOSSEN — sonst käme ein
   * 9-m/s-„Kopfball" aus 20 m Entfernung heraus.
   *
   * Der Abschusswinkel kommt aus `loeseAbschuss`, also aus dem echten Integrator;
   * ein reiner Sichtlinien-Vektor würde die Schwerkraft unterschlagen und jeden
   * Ball meterweit vor der Linie aufsetzen lassen. Erst danach wird gestreut.
   */
  function abschlussFlug(receiver, mitKopf) {
    const K = S.kontakt;
    const off = Math.abs(S.headOffset);
    const kraft = (mitKopf
      ? lerp(KOPF_V_MIN, KOPF_V_MAX, receiver.kopf)
      : lerp(FUSS_V_MIN, FUSS_V_MAX, receiver.schussWert))
      * clamp(1 - 0.30 * off, 0.40, 1);
    const sigma = (mitKopf
      ? lerp(KOPF_SIGMA_MAX, KOPF_SIGMA_MIN, receiver.kopf)
      : lerp(FUSS_SIGMA_MAX, FUSS_SIGMA_MIN, receiver.technik)) * (1 + off);

    // Zielpunkt: die vom Torwart abgewandte Torhälfte.
    const seite = kp.X >= 34 ? -1 : 1;
    _abVon.x = K.X; _abVon.y = K.Y; _abVon.z = Math.max(BALL_R, K.Z);
    const zielX = 34 + seite * 1.9, zielY = -0.4;
    let zx = zielX - K.X, zy = zielY - K.Y;
    const zn = Math.max(0.4, Math.hypot(zx, zy));
    zx /= zn; zy /= zn;

    /* Ein Kopfball ist eine ABLENKUNG, kein freier Schuss: die Richtung ist eine
     * Mischung aus der Anflugrichtung des Balls und der gewollten Richtung. Wer
     * gut köpft, dreht den Ball weiter herum; wer schlecht köpft, verlängert die
     * Flanke quer über den Kasten. Genau das ist der Grund, warum die meisten
     * Kopfbälle am Tor vorbeigehen — und deshalb hängt hier `kopf` am stärksten. */
    S.flug.at(S.tHead, _abBall);
    const bn = Math.hypot(_abBall.vx, _abBall.vy);
    const gw = mitKopf
      ? lerp(0.42, 0.94, receiver.kopf)
      : lerp(0.70, 0.98, receiver.technik);
    let rx = zx, ry = zy;
    if (bn > 1e-6) {
      rx = zx * gw + (_abBall.vx / bn) * (1 - gw);
      ry = zy * gw + (_abBall.vy / bn) * (1 - gw);
      const rn = Math.max(1e-6, Math.hypot(rx, ry));
      rx /= rn; ry /= rn;
    }
    _abNach.x = K.X + rx * zn;
    _abNach.y = K.Y + ry * zn;
    _abNach.z = mitKopf ? 0.85 : 1.05;

    const l = loeseAbschuss(_abVon, _abNach, kraft);
    let gier, neig;
    if (l) {
      gier = l.gier; neig = l.neigung;
    } else {
      // Zu wenig Wucht für die Distanz — dann eben flach und hoffen.
      const dx = _abNach.x - K.X, dy = _abNach.y - K.Y;
      gier = Math.atan2(dy, dx);
      neig = 0.12;
    }
    gier += rGauss(rng) * sigma;
    neig = clamp(neig + rGauss(rng) * sigma, -0.75, 1.10);

    abschussVektor(kraft, gier, neig, _vv);
    _ww.x = 0; _ww.y = 0; _ww.z = 0;
    _initFlanke.p.x = _abVon.x; _initFlanke.p.y = _abVon.y; _initFlanke.p.z = _abVon.z;
    _initFlanke.tMax = 2.6;
    const f = createFlug(_initFlanke);
    _initFlanke.tMax = 5.0;
    return f;
  }

  const _twStart = { x: 0, y: 0, z: 1.05 };
  const _twZiel = { x: 0, y: 0, z: 0 };
  const _twHand = { x: 0, y: 0, z: 0 };
  const _twPar = { tReakt: 0.2, vHecht: 3.9, arm: 1.05 };

  /**
   * Hält der Torwart? Handbahn linear nach dem Absprung (ballistisch), Reichweite
   * aus `ballistik.twReichweite`. Rückgabe ist der Treffer samt Handnormale —
   * das Bild braucht ihn, um den Ball an den Fäusten abprallen zu lassen.
   *
   * Zusatz gegenüber Elfmeter/Freistoß: bei einer Ecke steht der Keeper im
   * VERKEHR. Er sieht den Abschluss erst, wenn der Ball zwischen den Beinen
   * hindurch ist — jeder Körper auf der Sichtachse kostet Reaktionszeit. Ohne
   * diesen Term hält er 74 % aller Kopfbälle aufs Tor, was den Abnahmekorridor
   * „Torwart klärt 8–15 %" um mehr als das Doppelte reißt.
   */
  function torwartHaelt(f2, tr) {
    _twPar.tReakt = kp.par.tReakt + TW_SICHT_S * verkehrAufDemWeg();
    _twPar.vHecht = kp.par.vHecht;
    _twPar.arm = kp.par.arm;
    _twStart.x = kp.X; _twStart.y = kp.Y;
    _twZiel.x = clamp(tr.x, 34 - GOAL_HALF - 0.4, 34 + GOAL_HALF + 0.4);
    _twZiel.y = 0.18;
    _twZiel.z = clamp(tr.z, 0.25, 2.35);
    const dx = _twZiel.x - _twStart.x, dy = _twZiel.y - _twStart.y, dz = _twZiel.z - _twStart.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-6) return { t: tr.t, nx: 0, ny: 1, nz: 0, v: Math.hypot(tr.vx, tr.vy, tr.vz) };
    const maxReich = twReichweite(_twPar, tr.t, tr.z);
    const hand = (t) => {
      const s = Math.min(d, twReichweite(_twPar, t, tr.z), maxReich);
      const f = s / d;
      _twHand.x = _twStart.x + dx * f;
      _twHand.y = _twStart.y + dy * f;
      _twHand.z = _twStart.z + dz * f;
      return _twHand;
    };
    const treffer = f2.trefferKugel(hand, TW_HAND_R, 0, tr.t);
    if (!treffer) return null;
    const h = hand(treffer.t);
    return {
      t: treffer.t,
      nx: treffer.x - h.x, ny: treffer.y - h.y, nz: treffer.z - h.z,
      v: f2.at(treffer.t, _stopZ).v
    };
  }

  const _bMin = { x: 0, y: 0, z: 0 };
  const _bMax = { x: 0, y: 0, z: 0 };

  /** Blockt ein Bein den Kopfball in den ersten Zehnteln? Liefert den Treffer. */
  function geblockt(f2) {
    for (const d of defenders) {
      if (Math.hypot(d.X - S.kontakt.X, d.Y - S.kontakt.Y) > 4.0) continue;
      _bMin.x = d.X - BLOCK_HALB_X; _bMax.x = d.X + BLOCK_HALB_X;
      _bMin.y = d.Y - BLOCK_HALB_Y; _bMax.y = d.Y + BLOCK_HALB_Y;
      _bMin.z = 0; _bMax.z = 1.85 + 0.42 * d.sprungkraft / 99;
      // Ab 0,04 s, damit der Kontaktpunkt selbst nicht als Block zählt.
      const tr = f2.trefferQuader(_bMin, _bMax, 0.04, BLOCK_FENSTER_S);
      if (tr) return tr;
    }
    return null;
  }

  /* ---------------------------------------------------------------- *
   *  Nachspiel — was der Ball NACH dem Anschlag macht
   *
   *  Vorher lief die Folgebahn im Ergebnisbild ungebremst weiter: bei einer
   *  Parade flog der Ball sichtbar ins Tor, während „GEHALTEN!" auf dem Banner
   *  stand, beim Block durch das Bein, am Aluminium durch den Pfosten. Über
   *  4000 Ecken betraf das jede fünfte. Deshalb wird die Folgebahn jetzt am
   *  Trefferzeitpunkt GEKAPPT und ab dort das ehrliche Nachspiel gezeigt.
   * ---------------------------------------------------------------- */

  const _stopZ = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };

  /**
   * Kappt `f2` bei `t` und hängt einen Abpraller an der Fläche mit der Normalen
   * (nx, ny, nz) an. `daempfung <= 0` heißt: der Ball wird festgehalten und
   * bleibt liegen.
   *
   * `nachVorn` erzwingt, dass der Ball vom Tor WEG springt. Nötig, weil ein
   * Streifschuss an Handschuh, Bein oder Pfosten geometrisch weiter Richtung
   * Linie zeigen kann — und dann liefe das Bild dem Banner wieder davon (in
   * 11,7 % der Parade-, Block- und Aluminiumszenen war genau das der Fall).
   * Wer wirklich noch reingeht, ist im Modell ohnehin kein „GEHALTEN!".
   */
  function nachspiel(f2, t, nx, ny, nz, daempfung, nachVorn) {
    S.folgeStopS = t;
    f2.at(t, _stopZ);
    if (!(daempfung > 0)) {
      S.ruhe = { x: _stopZ.x, y: _stopZ.y, z: Math.max(BALL_R, _stopZ.z) };
      return;
    }
    const n = Math.hypot(nx, ny, nz) || 1;
    const ux = nx / n, uy = ny / n, uz = nz / n;
    // Nur spiegeln, wenn der Ball wirklich auf die Fläche zuläuft.
    const vn = _stopZ.vx * ux + _stopZ.vy * uy + _stopZ.vz * uz;
    const s = vn < 0 ? 2 * vn : 0;
    _vv.x = (_stopZ.vx - s * ux) * daempfung;
    _vv.y = (_stopZ.vy - s * uy) * daempfung;
    _vv.z = (_stopZ.vz - s * uz) * daempfung;
    if (nachVorn && _vv.y < 0) _vv.y = -_vv.y;
    _ww.x = 0; _ww.y = 0; _ww.z = 0;
    _initFlanke.p.x = _stopZ.x; _initFlanke.p.y = _stopZ.y;
    _initFlanke.p.z = Math.max(BALL_R, _stopZ.z);
    _initFlanke.tMax = NACH_TMAX;
    if (S.nachFlug) { S.nachFlug.freigeben(); S.nachFlug = null; }
    S.nachFlug = createFlug(_initFlanke);
    _initFlanke.tMax = 5.0;
  }

  /** Flächennormale eines Quadertreffers ('x-', 'y+', …). */
  function quaderNormale(flaeche, out) {
    out.x = 0; out.y = 0; out.z = 0;
    const achse = flaeche ? flaeche[0] : 'y';
    const vz = flaeche && flaeche[1] === '+' ? 1 : -1;
    out[achse === 'x' ? 'x' : achse === 'z' ? 'z' : 'y'] = vz;
    return out;
  }
  const _norm = { x: 0, y: 0, z: 0 };

  /* ---------------------------------------------------------------- *
   *  Auflösung
   * ---------------------------------------------------------------- */

  function finish(outcome, quality, banner, color, targetId) {
    const q = clamp(quality, 0, 1);
    const klang = AUSGANG_KLANG[outcome];
    if (klang) sfx(klang[0], klang[1]);
    S.resolution = {
      outcome,
      quality: q,
      targetPlayerId: targetId || null,
      xgDelta: clamp(XG_MIN + Math.pow(q, 1.15) * 0.50, XG_MIN, XG_MAX)
    };
    S.banner = banner;
    S.bannerColor = color;
    S.phase = 'ergebnis';
    S.phaseT = 0;
  }

  function resolveScene() {
    if (S.phase !== 'flug') return;

    // 1) Flanke war Murks
    if (S.failedDelivery) {
      finish('abgefangen', clamp(S.deliveryQ * 0.6, 0, 0.35), 'ZU UNGENAU!', COL.rot);
      return;
    }

    const sieger = duellLoesen();
    const idOf = (a) => (a && a.player && a.player.id) ? a.player.id : null;

    // 2) Niemand kommt an den Ball
    if (!sieger) {
      finish('abgefangen', clamp(S.deliveryQ * 0.35, 0, 0.3), 'NIEMAND GEHT HIN!', COL.rot);
      return;
    }
    S.duellSieger = sieger;

    // 3) Der Torwart war vor allen anderen am Ball
    // Wer FRÜHER abnimmt, ist vor dem Torwart am Ball — genau das ist die
    // Entscheidung, die der rote Bereich im Timingbalken ankündigt. Maßstab ist
    // sein Ballkontakt, nicht seine Ankunft am Kontaktpunkt.
    const abnahmeZeit = S.headTimeS === null ? Infinity : S.headTimeS;
    if (S.keeperOut && abnahmeZeit > S.keeperKontaktS) {
      S.folgeFlug = faustFlug();
      finish('abgefangen', clamp(0.2 + S.deliveryQ * 0.3, 0, 0.5), 'FAUSTABWEHR!', COL.hellblau);
      return;
    }

    // 4) Ein Verteidiger klärt
    if (sieger.seite === 'def') {
      finish('abgefangen', clamp(0.15 + S.deliveryQ * 0.25 - 0.10 * sieger.kopf, 0, 0.45),
        'GEKLÄRT!', COL.rot);
      return;
    }

    // 5) Gar nicht abgenommen
    if (S.headOffset === null) {
      finish('abgefangen', clamp(S.deliveryQ * 0.35, 0, 0.3), 'NIEMAND GEHT HIN!', COL.rot);
      return;
    }
    // 6) Luftloch
    if (Math.abs(S.headOffset) > HEAD_MISS_OFFSET) {
      finish('daneben', clamp(S.deliveryQ * 0.25, 0, 0.25), 'LUFTLOCH!', COL.rot, idOf(sieger));
      return;
    }

    /* ---- 7) Der Kopfball fliegt wirklich ---------------------------- */
    const spec = VARIANTS[S.variant];
    const targetId = idOf(sieger);
    const timing = clamp(1 - Math.abs(S.headOffset) * 0.55, 0, 1);
    const total = clamp(0.45 * S.deliveryQ + 0.55 * timing, 0, 1);

    const f2 = abschlussFlug(sieger, spec.kopf);
    S.folgeFlug = f2;

    const block = geblockt(f2);
    if (block) {
      // Der Ball prallt vom Bein ab — er fliegt NICHT durch den Verteidiger.
      quaderNormale(block.flaeche, _norm);
      nachspiel(f2, block.t, _norm.x, _norm.y, _norm.z, NACH_DAEMPFUNG_BEIN, true);
      finish('geblockt', clamp(total * 0.55, 0, 1), 'GEBLOCKT!', COL.gelb, targetId);
      return;
    }

    const tr = f2.trefferEbene('y', 0, 0, f2.dauer);
    if (!tr) {
      finish('daneben', clamp(total * 0.45, 0, 1), 'DANEBEN!', COL.gelb, targetId);
      return;
    }
    const seitlich = Math.abs(tr.x - 34);
    const amPfosten = Math.abs(seitlich - GOAL_HALF) <= PFOSTEN_BAND && tr.z <= GOAL_H + PFOSTEN_BAND;
    const anDerLatte = Math.abs(tr.z - GOAL_H) <= PFOSTEN_BAND && seitlich <= GOAL_HALF + PFOSTEN_BAND;
    if (anDerLatte) {
      // Latte: nach vorn und nach oben weg, nicht durch das Aluminium hindurch.
      nachspiel(f2, tr.t, 0, 0.60, 0.80, NACH_DAEMPFUNG_HOLZ, true);
      finish('latte', clamp(0.35 + total * 0.45, 0, 1), 'AN DIE LATTE!', COL.gelb, targetId);
      return;
    }
    if (amPfosten) {
      nachspiel(f2, tr.t, tr.x >= 34 ? 0.80 : -0.80, 0.60, 0, NACH_DAEMPFUNG_HOLZ, true);
      finish('pfosten', clamp(0.35 + total * 0.45, 0, 1), 'AN DEN PFOSTEN!', COL.gelb, targetId);
      return;
    }
    if (seitlich > GOAL_HALF || tr.z > GOAL_H || tr.z < 0) {
      finish('daneben', clamp(total * 0.5, 0, 1), 'DANEBEN!', COL.gelb, targetId);
      return;
    }
    const twTr = torwartHaelt(f2, tr);
    if (twTr) {
      // Langsame Bälle hält er fest, harte klatscht er ab — beides endet vor der
      // Linie, denn genau davon redet das Banner.
      nachspiel(f2, twTr.t, twTr.nx, twTr.ny, twTr.nz,
        twTr.v <= TW_FEST_V ? 0 : NACH_DAEMPFUNG_HAND, true);
      finish('parade', clamp(total * 0.8, 0, 1), 'GEHALTEN!', COL.hellblau, targetId);
      return;
    }
    // Tor: der Ball bleibt im Netz hängen, statt hinter dem Stadion zu verschwinden.
    const netz = f2.trefferEbene('y', -NETZ_TIEFE, tr.t, f2.dauer);
    if (netz) nachspiel(f2, netz.t, 0, 1, 0, NACH_DAEMPFUNG_NETZ, false);
    finish(spec.kopf ? 'kopfball_tor' : 'tor', clamp(0.45 + total * 0.55, 0, 1),
      spec.kopf ? 'KOPFBALL – TOR!' : 'TOR!!!', COL.gruen, targetId);
  }

  /** Faustabwehr: der Ball bekommt eine eigene, schwache Bahn nach vorn. */
  function faustFlug() {
    const v0 = rFloat(rng, 6, 9);
    const gier = Math.atan2(1, rFloat(rng, -0.9, 0.9));
    abschussVektor(v0, gier, 0.35, _vv);
    _ww.x = 0; _ww.y = 0; _ww.z = 0;
    _initFlanke.p.x = S.kontakt.X; _initFlanke.p.y = S.kontakt.Y;
    _initFlanke.p.z = Math.max(BALL_R, S.kontakt.Z);
    _initFlanke.tMax = 2.2;
    const f = createFlug(_initFlanke);
    _initFlanke.tMax = 5.0;
    return f;
  }

  /* ---------------------------------------------------------------- *
   *  Bewegung
   * ---------------------------------------------------------------- */

  function moveTo(a, tx, ty, speed, dt) {
    const dx = tx - a.X, dy = ty - a.Y;
    const d = Math.hypot(dx, dy);
    if (d < 0.08) return;
    const step = Math.min(d, speed * dt);
    a.X += dx / d * step; a.Y += dy / d * step;
  }

  function stepActors(dt) {
    if (S.phase === 'flug' && S.landing) {
      for (const a of attackers) {
        const lead = a === S.receiver ? 0 : 1.6;
        moveTo(a, S.landing.X + lead, S.landing.Y + lead * 0.6, a.k.vmax, dt);
      }
      for (let i = 0; i < defenders.length; i++) {
        const d = defenders[i];
        moveTo(d, S.landing.X - 1.2 - i * 0.7, Math.max(1.2, S.landing.Y - 1.0), d.k.vmax, dt);
      }
      if (S.keeperOut) moveTo(kp, S.landing.X, Math.max(1.2, S.landing.Y - 0.6), kp.speed, dt);
      else moveTo(kp, clamp(S.landing.X * 0.25 + 34 * 0.75, 31, 37), 1.4, 2.4, dt);
    } else {
      // Vor der Flanke: der nächstgelegene Angreifer bietet sich am Zielpunkt an
      // (ohne ihn wäre die kurze Ecke prinzipiell unerreichbar).
      let anbieter = null, bd = 1e9;
      for (const a of attackers) {
        const d = Math.hypot(a.X - S.aim.X, a.Y - S.aim.Y);
        if (d < bd) { bd = d; anbieter = a; }
      }
      for (let i = 0; i < attackers.length; i++) {
        const a = attackers[i];
        if (a === anbieter && S.phase === 'zielen') {
          moveTo(a, clamp(S.aim.X + 1.0, 8, 58), clamp(S.aim.Y + 0.6, 1.5, 20), a.k.vmax * 0.7, dt);
          continue;
        }
        const sway = Math.sin(S.t * (1.1 + i * 0.17) + i) * 1.4;
        moveTo(a, ATT_SPOTS[i % ATT_SPOTS.length].X + sway,
          ATT_SPOTS[i % ATT_SPOTS.length].Y + Math.cos(S.t * 0.9 + i) * 1.0, 2.2, dt);
      }
      for (let i = 0; i < defenders.length; i++) {
        const d = defenders[i];
        const mark = attackers[i % attackers.length];
        moveTo(d, mark.X - 1.0, Math.max(1.3, mark.Y - 1.1), Math.min(3.2, d.k.vmax), dt);
      }
      moveTo(kp, clamp(S.aim.X * 0.2 + 34 * 0.8, 31.5, 36.5), 1.4, 1.8, dt);
    }
  }

  /* ---------------------------------------------------------------- *
   *  Zeitschritt
   * ---------------------------------------------------------------- */

  function step(dt) {
    S.t += dt;
    S.phaseT += dt;
    stepActors(dt);

    if (S.phase === 'variante') {
      if (S.phaseT >= PHASE_VARIANT_S) chooseVariant('lang');
    } else if (S.phase === 'zielen') {
      if (S.charging) {
        S.power += S.powerDir * POWER_SPEED * dt;
        if (S.power >= 1) { S.power = 1; S.powerDir = -1; }
        if (S.power <= 0) { S.power = 0; S.powerDir = 1; }
      }
      if (S.phaseT >= PHASE_AIM_S) deliver(S.charging ? S.power : idealPower());
    } else if (S.phase === 'flug') {
      if (!S.keeperGeprueft && S.phaseT >= KEEPER_ENTSCHEID * S.flightS) keeperEntscheidung();
      if (S.headOffset !== null && S.phaseT >= Math.max(S.headTimeS, S.tHead)) resolveScene();
      else if (S.phaseT >= S.flugEndeS) resolveScene();
    }
  }

  /**
   * Ballposition fürs Bild — Flanke im Flug, Folgebahn im Ergebnis. Die
   * Folgebahn endet am Trefferzeitpunkt (`folgeStopS`); danach läuft der
   * Abpraller, oder der Ball ruht dort, wo ihn jemand festgehalten hat.
   */
  function ballZustand() {
    if (S.phase === 'flug' && S.flug) return S.flug.at(Math.min(S.phaseT, S.flug.dauer), _zustand);
    if (S.phase === 'ergebnis' && S.folgeFlug) {
      if (S.phaseT <= S.folgeStopS) {
        return S.folgeFlug.at(Math.min(S.phaseT, S.folgeFlug.dauer), _zustand);
      }
      if (S.nachFlug) {
        return S.nachFlug.at(Math.min(S.phaseT - S.folgeStopS, S.nachFlug.dauer), _zustand);
      }
      if (S.ruhe) {
        _zustand.x = S.ruhe.x; _zustand.y = S.ruhe.y; _zustand.z = S.ruhe.z;
        _zustand.vx = 0; _zustand.vy = 0; _zustand.vz = 0; _zustand.v = 0;
        return _zustand;
      }
      return S.folgeFlug.at(Math.min(S.phaseT, S.folgeFlug.dauer), _zustand);
    }
    if (S.phase === 'ergebnis' && S.flug && S.kontakt) {
      _zustand.x = S.kontakt.X; _zustand.y = S.kontakt.Y; _zustand.z = S.kontakt.Z;
      return _zustand;
    }
    return null;
  }

  function freigeben() {
    if (S.flug) { S.flug.freigeben(); S.flug = null; }
    if (S.folgeFlug) { S.folgeFlug.freigeben(); S.folgeFlug = null; }
    if (S.nachFlug) { S.nachFlug.freigeben(); S.nachFlug = null; }
  }

  return {
    S, attackers, defenders, kp, takerAkteur, taker, keeper, diff,
    takerSkill, keeperSkill,
    chooseVariant, setAim, setCurve, deliver, idealPower,
    headAttempt, headAttemptBei, step, ballZustand, resolveScene, freigeben
  };
}

/** Was am Ende der Szene zu hören ist – je Ausgang genau ein Klang. */
const AUSGANG_KLANG = {
  tor: ['tor', null],
  kopfball_tor: ['tor', null],
  parade: ['parade', null],
  geblockt: ['block', null],
  latte: ['pfosten', null],
  pfosten: ['pfosten', null],
  daneben: ['raunen', { lautstaerke: 0.85 }],
  abgefangen: ['raunen', { lautstaerke: 0.7 }]
};

/* ========================================================================== *
 *  MINISPIEL
 * ========================================================================== */

export const minigame = {
  id: 'ecke',
  kind: 'ecke',
  title: 'Eckball',
  instructions:
    '1) Variante mit [1]-[4] wählen · 2) Maus = Zielpunkt, [A]/[D] = Flugkurve, ' +
    'Maustaste halten = Kraft, loslassen = Flanke · 3) [Leertaste]/Klick zum Kopfball · [ESC] Simulation',

  async play(host, moment) {
    const canvas = host && host.canvas;
    const ctx = (host && host.ctx) || (canvas && canvas.getContext && canvas.getContext('2d'));
    if (!canvas || !ctx) {
      console.warn('[ecke] Kein Canvas/Kontext übergeben – Minispiel wird übersprungen.');
      return null;
    }

    const m = moment || {};
    const context = m.context || {};
    const score = Array.isArray(context.score) ? context.score : [0, 0];
    const minute = typeof m.minute === 'number' ? m.minute : (context.minute || 0);

    // Eigene RNG (fork lässt den Zustand der Eltern-RNG unberührt).
    const rng = (host.rng && typeof host.rng.fork === 'function')
      ? host.rng.fork('minigame:ecke:' + (m.actor && m.actor.id ? m.actor.id : '?'))
      : (host.rng || { next: () => 0.5 });

    // Klangnamen aus dem Vertrag von render/sound.js.
    const sfx = (n, o) => { try { if (typeof host.sound === 'function') host.sound(n, o); } catch (e) { /* egal */ } };

    const szene = createSzene({
      rng,
      diff: (host.difficulty && host.difficulty.minigame) || 1,
      taker: m.actor || null,
      keeper: m.keeper || null,
      targets: m.targets,
      defenders: m.defenders,
      sfx
    });
    const S = szene.S;
    const taker = szene.taker;
    const attackers = szene.attackers;
    const defenders = szene.defenders;
    const kp = szene.kp;

    /** Vereinsfarben für die Ränge (Paket 2 liefert sie additiv nach). */
    const farben = context.farben || {};
    const rangFarbe = typeof farben.heim === 'string' ? farben.heim : '#3a4a63';
    const rangFarbe2 = typeof farben.gast === 'string' ? farben.gast : '#5a4a3a';

    let settle = () => { };

    /* ====================================================================== *
     *  ZEICHNEN
     * ====================================================================== */

    function poly(pts, fill, stroke, lw) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
    }

    function line(a, b, color, lw) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
    }

    function label(str, x, y, color, size = 12, align = 'center') {
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = Math.max(3, size * 0.28); ctx.lineJoin = 'round';
      ctx.strokeStyle = COL.outline; ctx.strokeText(str, x, y);
      ctx.fillStyle = color; ctx.fillText(str, x, y);
    }

    /** Farbe abdunkeln (0 = schwarz, 1 = unverändert). */
    function dunkler(hex, f) {
      const h = /^#([0-9a-f]{6})$/i.exec(String(hex));
      if (!h) return '#3a4a63';
      const n = parseInt(h[1], 16);
      const r = Math.round(((n >> 16) & 255) * f);
      const g = Math.round(((n >> 8) & 255) * f);
      const b = Math.round((n & 255) * f);
      return `rgb(${r},${g},${b})`;
    }

    /** Zuschauerränge: drei Rangstufen, nach hinten dunkler. Kein Konfetti. */
    const RANG_STUFEN = [
      { y0: -7.0, y1: -12.0, z0: 1.4, z1: 5.2, f: 1.00 },
      { y0: -12.0, y1: -18.0, z0: 5.2, z1: 9.8, f: 0.72 },
      { y0: -18.0, y1: -26.0, z0: 9.8, z1: 15.5, f: 0.50 }
    ];
    function drawRaenge() {
      const X0 = -14, X1 = 82, SCHEIBEN = 12;
      for (let s = 0; s < RANG_STUFEN.length; s++) {
        const st = RANG_STUFEN[s];
        for (let i = 0; i < SCHEIBEN; i++) {
          const xa = lerp(X0, X1, i / SCHEIBEN), xb = lerp(X0, X1, (i + 1) / SCHEIBEN);
          const grund = (i + s) % 2 ? rangFarbe : rangFarbe2;
          const ton = st.f * (0.86 + 0.14 * hash01(i * 7 + s * 31));
          poly([toScreen(xa, st.y0, st.z0), toScreen(xb, st.y0, st.z0),
          toScreen(xb, st.y1, st.z1), toScreen(xa, st.y1, st.z1)],
            dunkler(grund, ton), null);
        }
        // Brüstung als helle Kante
        line(toScreen(X0, st.y0, st.z0), toScreen(X1, st.y0, st.z0), 'rgba(20,26,34,0.75)', 3);
      }
      // Blitzlichter: feste Plätze, Helligkeit rein aus der Szenenuhr.
      ctx.save();
      for (let i = 0; i < 26; i++) {
        const fx = lerp(-10, 78, hash01(i * 3.1));
        const fy = lerp(-8, -24, hash01(i * 5.7 + 1));
        const fz = lerp(2.0, 14.0, hash01(i * 9.3 + 2));
        const ph = hash01(i * 2.3 + 5) * 6.283;
        const a = Math.max(0, Math.sin(S.t * 2.6 + ph) - 0.86) * 7;
        if (a <= 0.01) continue;
        const p = toScreen(fx, fy, fz);
        ctx.globalAlpha = Math.min(1, a);
        ctx.fillStyle = '#fdf6d8';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      // Bandenwerbung zwischen Rang und Rasen
      poly([toScreen(X0, -5.4, 0), toScreen(X1, -5.4, 0),
      toScreen(X1, -7.0, 1.4), toScreen(X0, -7.0, 1.4)], '#1d232c', null);
    }

    function drawPitch() {
      ctx.fillStyle = COL.rasen;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      drawRaenge();
      // Rasenstreifen entlang der Torlinie
      for (let i = -1; i < 9; i++) {
        if (((i % 2) + 2) % 2) continue;
        const a = toScreen(-14, i * 3), b = toScreen(82, i * 3);
        const c = toScreen(82, i * 3 + 3), d = toScreen(-14, i * 3 + 3);
        poly([a, b, c, d], COL.rasenDunkel, null);
      }
      // Torlinie und Strafraum
      line(toScreen(0, 0), toScreen(68, 0), COL.linie, 4);
      poly([toScreen(13.84, 0), toScreen(13.84, 16.5), toScreen(54.16, 16.5), toScreen(54.16, 0)],
        null, COL.linie, 4);
      poly([toScreen(24.84, 0), toScreen(24.84, 5.5), toScreen(43.16, 5.5), toScreen(43.16, 0)],
        null, COL.linie, 3);
      // Elfmeterpunkt
      const pen = toScreen(34, 11);
      ctx.beginPath(); ctx.arc(pen.x, pen.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = COL.linie; ctx.fill();
      // Eckfahne
      const flag = toScreen(0.4, 0.4);
      const fs = figurenSkala(0.4, 0.4);
      line(flag, { x: flag.x, y: flag.y - 34 * fs }, COL.papier, 4);
      poly([{ x: flag.x, y: flag.y - 34 * fs }, { x: flag.x + 18 * fs, y: flag.y - 28 * fs },
      { x: flag.x, y: flag.y - 22 * fs }], COL.rot, COL.outline, 2);
    }

    function drawGoal() {
      const lp = toScreen(30.34, 0), rp = toScreen(37.66, 0);
      const lpT = toScreen(30.34, 0, GOAL_H), rpT = toScreen(37.66, 0, GOAL_H);
      const back = 1.9;
      const lb = toScreen(30.34, -back), rb = toScreen(37.66, -back);
      const lbT = toScreen(30.34, -back, GOAL_H), rbT = toScreen(37.66, -back, GOAL_H);
      // Netz
      poly([lpT, rpT, rbT, lbT], 'rgba(14,22,28,0.45)', null);
      poly([lpT, lbT, lb, lp], 'rgba(14,22,28,0.35)', null);
      poly([rpT, rbT, rb, rp], 'rgba(14,22,28,0.35)', null);
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        line({ x: lerp(lpT.x, rpT.x, t), y: lerp(lpT.y, rpT.y, t) },
          { x: lerp(lbT.x, rbT.x, t), y: lerp(lbT.y, rbT.y, t) }, 'rgba(240,245,246,0.45)', 1.3);
        line({ x: lerp(lp.x, rp.x, t), y: lerp(lp.y, rp.y, t) },
          { x: lerp(lpT.x, rpT.x, t), y: lerp(lpT.y, rpT.y, t) }, 'rgba(240,245,246,0.25)', 1);
      }
      // Rahmen dick
      for (const [a, b] of [[lp, lpT], [rp, rpT], [lpT, rpT]]) {
        line(a, b, COL.outline, 11);
        line(a, b, COL.linie, 7);
      }
    }

    /** Bodenschatten einer Figur — flache Ellipse, mit dem Maßstab skaliert. */
    function bodenschatten(sx, sy, scale) {
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 2 * scale, 15 * scale, 5 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /** Spielerfigur über host.drawPlayer oder Notdarstellung. */
    function figure(player, x, y, scale, opts, colA) {
      if (typeof host.drawPlayer === 'function' && player) {
        try { host.drawPlayer(ctx, player, x, y, scale, opts || {}); return; }
        catch (e) {
          if (!warnedDraw) { warnedDraw = true; console.warn('[ecke] host.drawPlayer fehlgeschlagen, nutze Notdarstellung:', e); }
        }
      }
      const s = scale * 30;
      ctx.lineWidth = 2.5; ctx.strokeStyle = COL.outline;
      ctx.fillStyle = '#20202a';
      ctx.fillRect(x - s * 0.20, y - s * 0.42, s * 0.16, s * 0.42);
      ctx.fillRect(x + s * 0.04, y - s * 0.42, s * 0.16, s * 0.42);
      ctx.strokeRect(x - s * 0.20, y - s * 0.42, s * 0.16, s * 0.42);
      ctx.strokeRect(x + s * 0.04, y - s * 0.42, s * 0.16, s * 0.42);
      ctx.fillStyle = colA;
      ctx.fillRect(x - s * 0.28, y - s * 1.00, s * 0.56, s * 0.58);
      ctx.strokeRect(x - s * 0.28, y - s * 1.00, s * 0.56, s * 0.58);
      ctx.fillStyle = '#d9a273';
      ctx.beginPath(); ctx.arc(x, y - s * 1.16, s * 0.19, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }

    const zeichenListe = [];
    function drawActors() {
      zeichenListe.length = 0;
      for (const a of attackers) zeichenListe.push({ a, col: COL.blau });
      for (const d of defenders) zeichenListe.push({ a: d, col: COL.rot });
      zeichenListe.push({ a: kp, col: '#f0a020' });
      zeichenListe.push({ a: szene.takerAkteur, col: COL.blau });
      // Maleralgorithmus über die Tiefe: was weiter weg ist, kommt zuerst.
      zeichenListe.sort((p, q) => tiefe(q.a.X, q.a.Y) - tiefe(p.a.X, p.a.Y));
      const zeigeRing = S.phase === 'flug' && S.phaseT > 0.35 * S.flightS;
      for (const item of zeichenListe) {
        const s = toScreen(item.a.X, item.a.Y);
        const scale = figurenSkala(item.a.X, item.a.Y);
        bodenschatten(s.x, s.y, scale);
        const schuetze = item.a === szene.takerAkteur;
        const pose = schuetze
          ? (S.phase === 'flug' || S.phase === 'ergebnis' ? 'schuss' : 'stand')
          : (S.phase === 'flug' ? 'lauf' : 'stand');
        figure(item.a.player, s.x, s.y, scale,
          { pose, dir: 1, frame: (S.t * 3) % 1, club: null }, item.col);
        if (schuetze) {
          label(nameOf(taker, 'Schütze'), s.x, s.y + 22 * scale, COL.papier, 13);
        } else if (item.a === S.receiver && zeigeRing) {
          ctx.beginPath(); ctx.ellipse(s.x, s.y + 2 * scale, 20 * scale, 8 * scale, 0, 0, Math.PI * 2);
          ctx.strokeStyle = COL.gelb; ctx.lineWidth = 3.5; ctx.stroke();
          label(nameOf(item.a.player, 'Abnehmer'), s.x, s.y + 24 * scale, COL.gelb, 13);
        }
      }
    }

    function drawBall() {
      const b = szene.ballZustand();
      if (!b) return;
      const w = tiefe(b.x, b.y);
      const ground = toScreen(b.x, b.y, 0);
      const air = toScreen(b.x, b.y, b.z);
      // Schatten liegt am BODEN und trägt die Höhe: größer und blasser mit z.
      const shR = 8 / w;
      ctx.save();
      ctx.globalAlpha = 0.32 / (1 + b.z * 0.30);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y, shR * (0.95 + b.z * 0.10), shR * (0.45 + b.z * 0.05), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const r = Math.max(3, 8 / w);
      ctx.beginPath(); ctx.arc(air.x, air.y, r, 0, Math.PI * 2);
      ctx.fillStyle = COL.papier; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = COL.outline; ctx.stroke();
    }

    /* ---- Vorschau: echte Bahn aus dem Integrator ------------------------- */
    const VORSCHAU_N = 26;
    const vorschauPuffer = new Float32Array(VORSCHAU_N * 3);
    let vorschauFlug = null, vorschauKey = '';

    function vorschauAktualisieren() {
      const p = S.charging ? S.power : szene.idealPower();
      const key = `${S.variant}|${Math.round(S.aim.X * 8)}|${Math.round(S.aim.Y * 8)}|`
        + `${Math.round(S.curve * 50)}|${Math.round(p * 60)}`;
      if (key === vorschauKey && vorschauFlug) return;
      vorschauKey = key;
      if (vorschauFlug) vorschauFlug.freigeben();
      vorschauFlug = flankenFlug(S.aim.X, S.aim.Y, p, VARIANTS[S.variant].hoehe, S.curve, 0, 0, 1);
      vorschauFlug.abtasten(VORSCHAU_N, vorschauPuffer);
    }

    function drawAimPreview() {
      if (S.phase !== 'zielen') return;
      vorschauAktualisieren();
      ctx.save();
      ctx.setLineDash([9, 7]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(245,197,24,0.85)';
      ctx.beginPath();
      for (let i = 0; i < VORSCHAU_N; i++) {
        const p = toScreen(vorschauPuffer[i * 3], vorschauPuffer[i * 3 + 1], vorschauPuffer[i * 3 + 2]);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // Wo der Ball wirklich aufkommt (der Effet verschiebt das sichtbar)
      const l = vorschauFlug && vorschauFlug.landung();
      if (l) {
        const lp = toScreen(l.x, l.y);
        ctx.strokeStyle = 'rgba(245,197,24,0.9)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(lp.x, lp.y, 14 / tiefe(l.x, l.y), 6 / tiefe(l.x, l.y), 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Zielkreuz
      const s = toScreen(S.aim.X, S.aim.Y);
      const spec = VARIANTS[S.variant];
      const dev = Math.hypot(S.aim.X - spec.zone.X, S.aim.Y - spec.zone.Y) / AIM_TOLERANCE;
      const col = dev < 0.35 ? COL.gruen : dev < 0.75 ? COL.gelb : COL.rot;
      const ws = 1 / tiefe(S.aim.X, S.aim.Y);
      ctx.lineWidth = 5; ctx.strokeStyle = COL.outline;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, 26 * ws, 11 * ws, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 3; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.ellipse(s.x, s.y, 26 * ws, 11 * ws, 0, 0, Math.PI * 2); ctx.stroke();
      // Sollbereich der Variante
      const z = toScreen(spec.zone.X, spec.zone.Y);
      const zs = 1 / tiefe(spec.zone.X, spec.zone.Y);
      ctx.setLineDash([6, 6]); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.ellipse(z.x, z.y, 40 * zs, 17 * zs, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    function drawVariantMenu() {
      if (S.phase !== 'variante') return;
      ctx.fillStyle = 'rgba(10,14,20,0.72)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      label('ECKBALL – WIE SOLL SIE KOMMEN?', CANVAS_W / 2, 120, COL.gelb, 30);
      for (let i = 0; i < VARIANT_ORDER.length; i++) {
        const spec = VARIANTS[VARIANT_ORDER[i]];
        const y = 168 + i * 74;
        const hover = S.hoverVariant === VARIANT_ORDER[i];
        ctx.fillStyle = hover ? COL.beige : '#2b3543';
        ctx.fillRect(180, y, 600, 60);
        ctx.strokeStyle = hover ? COL.gelb : COL.outline;
        ctx.lineWidth = hover ? 4 : 3;
        ctx.strokeRect(180, y, 600, 60);
        label(`[${spec.key}]`, 214, y + 38, hover ? COL.rot : COL.gelb, 22);
        label(spec.name, 258, y + 27, hover ? COL.outline : COL.papier, 19, 'left');
        label(spec.desc, 258, y + 48, hover ? '#5a4a2a' : '#9fb0c2', 13, 'left');
      }
      const rest = Math.max(0, PHASE_VARIANT_S - S.phaseT);
      label(`Entscheidung in ${rest.toFixed(1)} s – sonst kommt sie an den langen Pfosten`,
        CANVAS_W / 2, 500, COL.papier, 15);
    }

    function drawPowerBar() {
      if (S.phase !== 'zielen') return;
      const w = 300, h = 26, x = 40, y = CANVAS_H - 108;
      ctx.fillStyle = COL.dunkel; ctx.fillRect(x - 6, y - 24, w + 12, h + 32);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(x - 6, y - 24, w + 12, h + 32);
      label('KRAFT (Maustaste halten)', x + w / 2, y - 6, COL.papier, 13);
      ctx.fillStyle = '#2b3543'; ctx.fillRect(x, y, w, h);
      const ideal = szene.idealPower();
      ctx.fillStyle = 'rgba(63,174,74,0.75)';
      ctx.fillRect(x + Math.max(0, ideal - POWER_SWEET) * w, y,
        (Math.min(1, ideal + POWER_SWEET) - Math.max(0, ideal - POWER_SWEET)) * w, h);
      ctx.fillStyle = COL.gelb;
      ctx.fillRect(x, y, S.power * w, h);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);

      // Flugkurve
      const cx = 400, cw = 200;
      ctx.fillStyle = COL.dunkel; ctx.fillRect(cx - 6, y - 24, cw + 12, h + 32);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(cx - 6, y - 24, cw + 12, h + 32);
      label('FLUGKURVE  [A] / [D]', cx + cw / 2, y - 6, COL.papier, 13);
      ctx.fillStyle = '#2b3543'; ctx.fillRect(cx, y, cw, h);
      const mid = cx + cw / 2;
      ctx.fillStyle = COL.hellblau;
      const cv = clamp(S.curve, -1, 1);
      ctx.fillRect(Math.min(mid, mid + cv * cw / 2), y, Math.abs(cv) * cw / 2, h);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(cx, y, cw, h);
      label(cv > 0.15 ? 'nach innen' : cv < -0.15 ? 'nach außen' : 'gerade',
        mid, y + 18, COL.papier, 13);

      const rest = Math.max(0, PHASE_AIM_S - S.phaseT);
      label(`noch ${rest.toFixed(1)} s`, 700, y + 18, rest < 2 ? COL.rot : COL.papier, 16);
    }

    function drawTimingBar() {
      if (S.phase !== 'flug' || S.failedDelivery || S.tHead === null) return;
      const barVon = S.barStart * S.flightS;
      if (S.phaseT < barVon * 0.6) return;
      const spanne = Math.max(0.25, S.flugEndeS - barVon);
      const toBar = (t) => clamp((t - barVon) / spanne, 0, 1);

      const w = 520, h = 32, x = (CANVAS_W - w) / 2, y = CANVAS_H - 112;
      ctx.fillStyle = COL.dunkel; ctx.fillRect(x - 6, y - 26, w + 12, h + 34);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(x - 6, y - 26, w + 12, h + 34);

      const half = S.halfS;
      /* Der rote Bereich beginnt beim BALLKONTAKT des Torwarts. Alles rechts davon
       * gehört ihm — deshalb wird dort auch kein Grün und kein Gelb mehr gemalt.
       * Der Balken verspricht nur noch, was der Spieler wirklich bekommen kann. */
      const rot = S.keeperOut ? toBar(S.keeperKontaktS) : 1;
      const sauberS = S.keeperOut
        ? Math.max(0, Math.min(S.tHead + half, S.keeperKontaktS) - (S.tHead - half))
        : 2 * half;
      const knapp = S.keeperOut && sauberS < KEEPER_FAIR_S;
      label(knapp ? 'TORWART IST ZUERST AM BALL!'
        : S.keeperOut ? 'TORWART KOMMT – FRÜHER ABNEHMEN!' : 'ABNEHMEN!',
        x + w / 2, y - 8, S.keeperOut ? COL.rot : COL.papier, 15);
      ctx.fillStyle = '#2b3543'; ctx.fillRect(x, y, w, h);

      /** Ein Abschnitt des Balkens — nur, wenn er nach dem Kappen noch existiert. */
      const abschnitt = (a, b, farbe) => {
        const a1 = clamp(a, 0, 1), b1 = clamp(b, 0, 1);
        if (b1 <= a1) return;
        ctx.fillStyle = farbe;
        ctx.fillRect(x + a1 * w, y, (b1 - a1) * w, h);
      };
      const g0 = toBar(S.tHead - half), g1 = toBar(S.tHead + half);
      const y0 = toBar(S.tHead - half * HEAD_MISS_OFFSET);
      const y1 = toBar(S.tHead + half * HEAD_MISS_OFFSET);
      abschnitt(y0, Math.min(g0, rot), 'rgba(245,197,24,0.45)');
      abschnitt(Math.max(g1, 0), Math.min(y1, rot), 'rgba(245,197,24,0.45)');
      abschnitt(g0, Math.min(g1, rot), COL.gruen);
      if (S.keeperOut) abschnitt(rot, 1, 'rgba(193,39,45,0.75)');
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
      const mx = x + toBar(S.phaseT) * w;
      ctx.fillStyle = COL.papier; ctx.fillRect(mx - 4, y - 8, 8, h + 16);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(mx - 4, y - 8, 8, h + 16);
      if (S.headOffset !== null) {
        const off = Math.abs(S.headOffset);
        label(off < 1 ? 'PERFEKT!' : off < 2 ? 'unsauber' : 'daneben',
          x + w / 2, y + 23, off < 1 ? COL.outline : COL.rot, 16);
      }
      // Bei `knapp` steht die Wahrheit schon in der Kopfzeile — keine zweite,
      // überlappende Zeile daneben (siehe Nachtrag, Abschnitt 4).
      if (!knapp) {
        label(S.keeperOut
          ? `noch ${Math.round(sauberS * 1000)} ms grün`
          : `Fenster ± ${Math.round(half * 1000)} ms`,
          x + w - 6, y - 8, '#b9c4d2', 12, 'right');
      }
    }

    function drawHud() {
      ctx.fillStyle = COL.dunkel; ctx.fillRect(0, 0, CANVAS_W, 40);
      label(nameOf(taker, 'Schütze').toUpperCase(), 100, 27, COL.gelb, 18);
      label(`${minute}. MINUTE`, 400, 27, COL.papier, 16);
      label(`STAND  ${score[0]} : ${score[1]}`, 570, 27, COL.papier, 16);
      label(String(context.competition || ''), 850, 27, COL.hellblau, 14);

      const spec = VARIANTS[S.variant];
      if (S.phase !== 'variante') {
        ctx.fillStyle = COL.dunkel; ctx.fillRect(CANVAS_W - 268, 48, 256, 28);
        ctx.strokeStyle = COL.outline; ctx.lineWidth = 2; ctx.strokeRect(CANVAS_W - 268, 48, 256, 28);
        label('VARIANTE: ' + spec.short, CANVAS_W - 140, 68, COL.gelb, 14);
      }

      ctx.fillStyle = COL.dunkel; ctx.fillRect(0, CANVAS_H - 54, CANVAS_W, 54);
      if (S.phase === 'zielen') {
        label('Maus = Zielpunkt · [A]/[D] = Flugkurve · Maustaste halten und im grünen Bereich loslassen',
          CANVAS_W / 2, CANVAS_H - 32, COL.papier, 14);
      } else if (S.phase === 'flug') {
        label('[Leertaste] oder Klick, wenn der Marker im grünen Bereich steht',
          CANVAS_W / 2, CANVAS_H - 32, COL.papier, 14);
      } else if (S.phase === 'variante') {
        label('Variante mit [1]-[4] oder Mausklick wählen', CANVAS_W / 2, CANVAS_H - 32, COL.papier, 14);
      }
      label('[ESC] = Simulation entscheiden lassen', CANVAS_W / 2, CANVAS_H - 12, '#b9c4d2', 12);
    }

    function drawBanner() {
      if (!S.banner) return;
      const w = 560, h = 78, x = (CANVAS_W - w) / 2, y = 190;
      ctx.fillStyle = COL.beige; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
      ctx.strokeStyle = COL.outline; ctx.lineWidth = 3; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.font = 'bold 36px "Arial Black", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.strokeStyle = COL.outline;
      ctx.strokeText(S.banner, CANVAS_W / 2, y + 52);
      ctx.fillStyle = S.bannerColor;
      ctx.fillText(S.banner, CANVAS_W / 2, y + 52);
    }

    function render() {
      ctx.save();
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawPitch();
      drawGoal();
      drawAimPreview();
      drawActors();
      drawBall();
      drawPowerBar();
      drawTimingBar();
      drawHud();
      drawVariantMenu();
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
        if (vorschauFlug) { vorschauFlug.freigeben(); vorschauFlug = null; }
        szene.freigeben();
      }
      function settleInner(res) {
        if (done) return;
        done = true;
        cleanup();
        resolve(res);
      }
      settle = settleInner;

      function pointerPos(ev) {
        const r = canvas.getBoundingClientRect();
        const sx = canvas.width / (r.width || canvas.width);
        const sy = canvas.height / (r.height || canvas.height);
        return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
      }

      on(canvas, 'mousemove', (ev) => {
        const p = pointerPos(ev);
        if (S.phase === 'variante') {
          S.hoverVariant = null;
          for (let i = 0; i < VARIANT_ORDER.length; i++) {
            const y = 168 + i * 74;
            if (p.x >= 180 && p.x <= 780 && p.y >= y && p.y <= y + 60) S.hoverVariant = VARIANT_ORDER[i];
          }
        } else if (S.phase === 'zielen') {
          const w = toWorld(p.x, p.y);
          szene.setAim(w.X, w.Y);
        }
      });

      on(canvas, 'mousedown', (ev) => {
        ev.preventDefault();
        if (S.phase === 'variante') {
          if (S.hoverVariant) szene.chooseVariant(S.hoverVariant);
        } else if (S.phase === 'zielen') {
          S.charging = true; S.power = 0; S.powerDir = 1;
        } else if (S.phase === 'flug') {
          szene.headAttempt();
        }
      });

      on(window, 'mouseup', () => {
        if (S.phase === 'zielen' && S.charging) {
          S.charging = false;
          szene.deliver(S.power);
        }
      });

      on(window, 'keydown', (ev) => {
        const k = ev.key;
        if (k === 'Escape') { settleInner(null); return; }
        if (S.phase === 'variante') {
          const idx = VARIANT_ORDER.find((id) => VARIANTS[id].key === k);
          if (idx) { ev.preventDefault(); szene.chooseVariant(idx); }
        } else if (S.phase === 'zielen') {
          const lower = typeof k === 'string' ? k.toLowerCase() : '';
          if (lower === 'a' || k === 'ArrowLeft') { szene.setCurve(S.curve - 0.18); ev.preventDefault(); }
          else if (lower === 'd' || k === 'ArrowRight') { szene.setCurve(S.curve + 0.18); ev.preventDefault(); }
          else if (k === ' ') {
            // Tastatur-Alternative zum Kraftbalken
            ev.preventDefault();
            if (!S.charging) { S.charging = true; S.power = 0; S.powerDir = 1; }
            else { S.charging = false; szene.deliver(S.power); }
          }
        } else if (S.phase === 'flug' && (k === ' ' || k === 'Enter')) {
          ev.preventDefault();
          szene.headAttempt();
        }
      });

      canvas.style.cursor = 'crosshair';

      watchdog = setTimeout(() => {
        settleInner(S.resolution || {
          outcome: 'abgefangen', quality: 0.2,
          targetPlayerId: null, xgDelta: -0.05
        });
      }, HARD_TIMEOUT_S * 1000);

      function frame(ts) {
        if (done) return;
        if (!lastTs) lastTs = ts;
        const dt = clamp((ts - lastTs) / 1000, 0, 0.05);
        lastTs = ts;
        szene.step(dt);
        if (S.phase === 'ergebnis' && S.phaseT >= RESULT_S) { settleInner(S.resolution); return; }
        if (done) return;
        render();
        rafId = requestAnimationFrame(frame);
      }
      rafId = requestAnimationFrame(frame);
    });
  }
};

/* ========================================================================== *
 *  PRÜFEXPORT  (CONTRACTS §9 — DOM-frei, rng immer als Parameter)
 * ========================================================================== */

export const modell = {
  /** Konstanten, gegen die der Prüfstand rechnet. */
  konstanten: {
    V0_MIN, V0_MAX, ELEV_MIN, ELEV_MAX, CURVE_SPIN,
    HEAD_GREEN_MS_BASE, HEAD_GREEN_MS_SKILL, HEAD_TRAIT_BONUS, HEAD_MISS_OFFSET,
    GOAL_HALF, GOAL_H, CORNER, VARIANTS, VARIANT_ORDER, AIM_TOLERANCE,
    // Schwelle, ab der die Kopfzeile des Timingbalkens auf „TORWART IST ZUERST
    // AM BALL!" umschaltet — der Prüfstand soll gegen DIESE Zahl messen und
    // nicht gegen eine eigene.
    KEEPER_FAIR_S
  },

  /** Projektion und ihre Umkehrung — für die Prüfung der Zielsteuerung. */
  toScreen, toWorld, figurenSkala, tiefe,

  /** Halbe Breite des grünen Fensters in SEKUNDEN (variantenunabhängig). */
  gruenesFensterS,

  /** Fertiger Flankenflug. Aufrufer muss `freigeben()` rufen. */
  flankenFlug,

  /** Ideale Kraft für eine Zieldistanz bei gegebener Variantenhöhe. */
  idealKraft(variantKey, aimX, aimY) {
    const spec = VARIANTS[variantKey] || VARIANTS.lang;
    const tab = reichweiteTabelle(spec.hoehe);
    return kraftFuer(Math.hypot(aimX - CORNER.X, aimY - CORNER.Y), tab);
  },

  /** Flugzeit einer Flanke bei gegebener Kraft (Sekunden). */
  flugzeit(power, variantKey, curve = 0) {
    const spec = VARIANTS[variantKey] || VARIANTS.lang;
    const f = flankenFlug(spec.zone.X, spec.zone.Y, power, spec.hoehe, curve, 0, 0, 1);
    const l = f.landung();
    const t = l ? l.t : f.dauer;
    f.freigeben();
    return t;
  },

  /**
   * Eine vollständige Ecke, kopflos. `cfg` wie createSzene, zusätzlich:
   *   variant, aimX, aimY, curve, power (fehlt = ideal),
   *   zielzeit (s Vorlauf für die Laufwege, Vorgabe 2.5),
   *   timingFehlerS (Abweichung vom Kontaktzeitpunkt), abnehmen (false = gar nicht),
   *   dt (Zeitschritt der Flugphase, Vorgabe 1/60).
   */
  szene(cfg) {
    const s = createSzene(cfg);
    const dtZiel = 1 / 60;
    const dtFlug = cfg.dt || 1 / 60;

    s.chooseVariant(cfg.variant || 'lang');
    if (cfg.aimX !== undefined) s.setAim(cfg.aimX, cfg.aimY);
    if (cfg.curve !== undefined) s.setCurve(cfg.curve);

    const vorlauf = cfg.zielzeit === undefined ? 2.5 : cfg.zielzeit;
    for (let t = 0; t < vorlauf - 1e-9; t += dtZiel) s.step(dtZiel);

    s.deliver(cfg.power === undefined ? s.idealPower() : cfg.power);

    const S = s.S;
    const diagnose = {
      flightS: S.flightS, tHead: S.tHead, halfS: S.halfS, barStart: S.barStart,
      deliveryQ: S.deliveryQ, failedDelivery: S.failedDelivery,
      landing: S.landing, kontakt: S.kontakt,
      kandidaten: S.kandidaten.length,
      receiver: S.receiver ? S.receiver.seite : null
    };
    /* Abnahmezeitpunkt. `frueh` bildet den Spieler ab, der den roten Bereich im
     * Timingbalken liest und vor dem herauslaufenden Torwart abnimmt. */
    let wache = 0;
    while (S.phase === 'flug' && wache++ < 4000) {
      if (S.headOffset === null && cfg.abnehmen !== false && S.tHead !== null) {
        let ziel = Math.max(0, S.tHead + (cfg.timingFehlerS || 0));
        if (cfg.frueh && S.keeperGeprueft && S.keeperOut) {
          ziel = Math.min(ziel, Math.max(0, S.keeperKontaktS - 0.05));
        }
        if (S.phaseT >= ziel) s.headAttemptBei(ziel);
      }
      s.step(dtFlug);
    }
    if (S.phase === 'flug') s.resolveScene();

    diagnose.keeperOut = S.keeperOut;
    diagnose.keeperArrivalS = S.keeperArrivalS;
    diagnose.keeperKontaktS = S.keeperKontaktS;
    diagnose.tFaust = S.tFaust;
    /* Sauberes grünes Fenster: der Teil des grünen Bereichs, der VOR dem
     * Ballkontakt des herauslaufenden Torworts liegt — genau das, was der
     * Timingbalken noch grün malt. */
    diagnose.sauberGruenS = S.keeperOut
      ? Math.max(0, Math.min(S.tHead + S.halfS, S.keeperKontaktS) - (S.tHead - S.halfS))
      : 2 * S.halfS;
    diagnose.headOffset = S.headOffset;
    diagnose.duell = S.duellSieger ? S.duellSieger.seite : null;
    diagnose.banner = S.banner;

    /* Die Ergebnisphase wird mitgespielt: nur so lässt sich prüfen, dass das BILD
     * zum Banner passt (der Ball darf bei Parade, Block und Aluminium nicht mehr
     * über die Linie). */
    diagnose.folgeStopS = S.folgeStopS;
    let minY = Infinity, imTor = false;
    let vY = null, vX = 0, vZ = 0;
    for (let t = 0; t < RESULT_S - 1e-9; t += dtFlug) {
      const b = s.ballZustand();
      if (b) {
        if (b.y < minY) minY = b.y;
        // Torlinie wird nur beim DURCHGANG geprüft — ein Ball, der über die Latte
        // fliegt und dahinter herunterkommt, ist kein Tor.
        if (vY !== null && vY > 0 && b.y <= 0) {
          const u = vY / Math.max(1e-9, vY - b.y);
          const x = vX + (b.x - vX) * u, z = vZ + (b.z - vZ) * u;
          if (Math.abs(x - 34) <= GOAL_HALF && z <= GOAL_H) imTor = true;
        }
        vY = b.y; vX = b.x; vZ = b.z;
      }
      s.step(dtFlug);
    }
    diagnose.ballMinY = minY === Infinity ? null : minY;
    diagnose.ballImTor = imTor;

    const res = S.resolution;
    s.freigeben();
    return { resolution: res, diagnose };
  }
};

export default minigame;
