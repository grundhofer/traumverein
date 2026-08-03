/**
 * FREISTOSS – interaktives Minispiel.
 *
 * Vertrag: docs/CONTRACTS.md §9 (interactive/*.js) und §6.1 (KeyMoment / resolution).
 *
 * Drei-Phasen-Eingabe, wie es sich für einen ruhenden Ball gehört:
 *   1. RICHTUNG – ein Marker wandert über die Torebene. Er zeigt die ABSCHUSSRICHTUNG
 *                 (nicht das Endziel!) – der Effet biegt den Ball später noch.
 *   2. HÖHE     – senkrechter Balken. Zu flach = die Mauer köpft ihn weg, zu hoch =
 *                 die Tribüne freut sich. Das sichere Fenster wird umso deutlicher
 *                 angezeigt, je besser die Standards des Schützen sind
 *                 (Freistoßspezialisten sehen es komplett).
 *   3. EFFET    – waagerechter Balken von „Innenrist links" bis „Außenrist rechts".
 *                 Der Effet krümmt die Bahn sichtbar um die Mauer herum; während der
 *                 ersten Flugphase darf man mit der Maus noch minimal nachziehen.
 *
 * ---------------------------------------------------------------------------
 * PHYSIK – seit dem Umbau vollständig aus `core/ballistik.js`
 * ---------------------------------------------------------------------------
 * Es gibt keine Kurvenfits mehr. Der Abschuss ist ein Vektor, der Rest ist
 * Integration:
 *
 *   v0  = lerp(V0_MIN, V0_MAX, skill)          Abschussbetrag in m/s
 *   vz  = Höhenbalken                           vertikaler Anteil
 *   vH  = sqrt(max(VH_MIN², v0² − vz²))        → mehr Loft kostet Vortrieb
 *   w   = drallVektor(richtung, effet, topspin) Sidespin biegt, Topspin senkt
 *
 * Damit stimmt alles von selbst: der Ball geht laut los und kommt sichtbar
 * langsamer an, über 16 m biegt er kaum und über 30 m deutlich, und die Flugzeit
 * ist eine Folge des Schusses statt einer Konstanten.
 *
 * Drei Dinge liegen bewusst NEBEN dem Integrator, weil sie Spielmechanik sind
 * und keine Ballistik:
 *   • Der FLATTERBALL ist eine kleine, deterministisch gezogene Schwingung, die
 *     auf die integrierte Seitenlage addiert wird. Ein echter Knuckleball käme
 *     aus einer instationären Grenzschicht – die hat der Kern (zu Recht) nicht.
 *   • Das NACHZIEHEN („steer") ändert den Drall und rechnet die Bahn neu. Das ist
 *     physikalisch geschummelt, aber es ist die Bedienung dieser Szene.
 *   • Die MAUER springt nach einem Zeitprofil, nicht nach einer Impulsbilanz.
 *
 * Eine Uhr: `flight.T` ist die integrierte Flugzeit bis zur Torlinie. JEDE
 * Torwartbewegung – im Modell wie in der Anzeige – kommt aus `tReal = flightT·T`.
 *
 * ---------------------------------------------------------------------------
 * KALIBRIERUNG — fünf bewusste Abweichungen vom Umbauplan, alle gemessen
 * ---------------------------------------------------------------------------
 * Die Zahlen stammen aus `tools/test-freistoss.js`; wer sie ändert, misst neu.
 *
 * 1. `v0` bekommt einen DISTANZFAKTOR (V0_DIST_NEAR/FAR). Der Plan nennt
 *    v0 = lerp(23, 30, skill) ohne Distanzbezug. Damit sind die beiden
 *    Flugzeitkorridore nicht gleichzeitig erreichbar: derselbe Abschussbetrag
 *    ergibt bei 16 m rund 0,69 s (Korridor 0,60–0,78 ✓) und bei 32 m rund 1,66 s
 *    (Korridor 1,20–1,50 ✗) — der Luftwiderstand frisst über die doppelte
 *    Strecke überproportional viel. Aus 32 m wird eben voll durchgezogen.
 *    Gemessen: 16 m 0,71 s · 32 m 1,25 s (Mediane).
 * 2. `SPIN_SIDE_MAX = 125` rad/s statt der im Plan geschätzten 60. Mit 60 rad/s
 *    liegt die Ablage bei 25 m bei 2,25 m; der Plan verlangt aber ausdrücklich,
 *    die alte CURVE_MAX-Ablage von 3,40 m zu erhalten, und die 32-m-Vorgabe
 *    (5,5–8,0 m) ist mit 60 rad/s um mehr als ein Drittel verfehlt. Der
 *    Zielwert war die Ablage, nicht die Drallzahl.
 *    Gemessen: 16 m 1,64 m · 25 m 3,85 m · 32 m 6,30 m.
 * 3. `CURVE_CONFUSION` von 0,62 auf 0,38. Der Faktor multipliziert die ABLAGE;
 *    die ist von maximal 3,85 m auf 6,30 m gewachsen. Bei unverändertem Faktor
 *    hätte der Torwart plötzlich bis zu 3,9 m Vorhersagefehler — genau die
 *    Doppelschwächung, die der Plan unter Punkt 4 verbietet.
 * 4. `AIM_SPAN_NEAR/FAR` von 5,0/8,2 auf 3,2/4,5 (Nachtrag §0 verlangt
 *    ausdrücklich, die Zielspannen mit der Kamera mitzuziehen). Die neue
 *    Brennweite vergrößert das Tor im Bild um Faktor 1,26 (16 m) bis 1,42
 *    (32 m); mit den alten Spannen liefe der Zielmarker aus dem Bild.
 * 5. NAHBEREICH (NAH_BIS, SPIN_TOP_NAH, WALL_JUMP_NAH). Mit dem echten
 *    Integrator war „über die Mauer UND unter die Latte" zwischen 16 und 23 m
 *    geometrisch UNMÖGLICH: der Ball erreichte seinen Scheitel erst hinter der
 *    Torlinie (bei 16 m vz/g ≈ 0,82 s gegen eine Flugzeit von 0,69 s), es gab
 *    dort also gar kein Absacken mehr. Gemessen bei 16 m, Standards 65:
 *    vz = 8 → 2,02 m an der Mauer / 2,14 m am Tor (Oberkante 2,27 → geblockt),
 *    vz = 9 → 2,39 m / 2,76 m (frei, aber über der Latte). Eine Gittersuche über
 *    17 425 Abschüsse fand bei 16 und 18 m NULL Wege über die Mauer ins Tor; der
 *    Anteil gelber Notfenster lag bei 41,5 % (16 m) bis 59,5 % (23 m). Die Szene
 *    war lösbar, aber genau die Bewegung, die der Spieler versucht, gab es nicht.
 *    Zwei Stellschrauben, beide nur im Nahbereich (linear bis NAH_BIS = 26 m):
 *      • SPIN_TOP_NAH = 1,75 — ein kurzer Freistoß wird nicht durchgezogen,
 *        sondern mit viel Schnitt getreten. Bei Standards 65 sind das 58 statt
 *        33 rad/s (9,2 U/s) und damit die Hälfte mehr Magnus-Abtrieb: bei
 *        27 m/s Ballgeschwindigkeit 6,4 statt 4,2 m/s².
 *      • WALL_JUMP_NAH = 0,06 m — aus kurzer Distanz springt die Mauer nicht.
 *        Der Ball ist 0,4 s nach dem Schuss an ihr, allein der Weg zum Scheitel
 *        eines 0,42-m-Sprungs dauert 0,29 s, und ein Sprung reißt das Loch
 *        darunter auf. Topspin ALLEIN reicht nicht: mit unveränderter Mauer
 *        bräuchte es bei 16 m 140 rad/s (22 U/s), um überhaupt ein Band zu
 *        öffnen — das wäre keine Kalibrierung mehr, sondern eine Erfindung.
 *    Danach (Standards 65, 200 gleichverteilte Richtungen je Szene, sechs
 *    Anstellwinkel × 13 Distanzen): gelbe Notfenster höchstens 11,5 % (bei 21 m),
 *    bei 16/18/20/23 m 0…4,5 %; Wege über die Mauer ins Tor: 180 bis 500 je
 *    Szene. Preis im Hauptlauf: Mauerblock 18,4 % → 14,0 %, Torquote 7,0 % → 7,8 %
 *    (beide Korridore weiter eingehalten), Flugzeiten unverändert.
 * 6. BALKENLUPE (FENSTER_MIN_MS) — und der Mauerblock als bewusst offener
 *    Korridor. Die Zeit, die der Marker im grünen Höhenfenster steht, ist die
 *    Bedienbarkeit dieser Szene; als bloßer Anteil des Balkens ist sie nicht
 *    lesbar. Ohne Lupe gemessen (Profi, je 250 Szenen, Richtung wie ein Spieler
 *    gezogen): 16 m 917 ms · 20 m 662 ms · 25 m 266 ms · 32 m 342 ms im Median,
 *    das zehnte Perzentil bei 675/194/111/247 ms. Bei 25 m lag also schon der
 *    Median unter den 300 ms, die dieselbe Datei dem Nachziehfenster zusichert.
 *    Mit der Lupe hält jedes grüne Fenster 300 ms.
 *    Das kostet Mauerblöcke, und zwar zwangsläufig: Bedienzeit IST Zielgenauigkeit
 *    der Höhe. Gemessen über 4000 Freistöße — Mauerblock 12,0 % → 10,2 %,
 *    Torquote 8,8 % → 10,1 %, gehalten 40,7 % → 42,3 %, daneben 31,5 % → 30,6 %;
 *    nur der Mauerblock verlässt damit seinen Plankorridor (12–20 %) und steht in
 *    tools/test-freistoss.js als `offen()` bei jedem Lauf sichtbar da.
 *    Gegenprobe, warum es nicht anders geht: ein um 31 % schnellerer
 *    Richtungsbalken (DIR_PERIOD_MS 1700 → 1300) holt nur 10,2 % → 11,1 % zurück
 *    und verschlechtert die Bedienbarkeit an anderer Stelle; die Mauer selbst ist
 *    Geometrie (1,85 m, 9,15 m) und keine Stellschraube.
 *
 * Kamera: schräg-seitliche Sicht hinter dem Schützen, saubere Lochkamera
 * (`scaleAt(u,v) = CAM_FOCAL / (camV − v)`). Die Kamerawerte sind seit dem Umbau
 * auf Fernsehoptik gesetzt: weit hinten, lange Brennweite. Dadurch stauchen sich
 * die Tiefen und Schütze : Tor steht bei ≈ 1,35 statt bei 1,94.
 *
 * Kein Math.random (immer host.rng), kein Date.now (performance.now nur für Animation).
 */

import { clamp, lerp } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { DEFAULT_COLORS, TRAITS } from '../core/constants.js';
import { getClub } from '../data/clubs.js';
import { createFlug, drallVektor, twParameter, twReichweite } from '../core/ballistik.js';

/* ══════════════════════════════════════════════════════════════════════════
   BALANCING – alles Wichtige steht hier oben.
   ══════════════════════════════════════════════════════════════════════════ */

const CANVAS_W = 960, CANVAS_H = 600;

/* --- Geometrie (Meter) --- */
const GOAL_HALF_W = 3.66;
const GOAL_H = 2.44;
const POST_R = 0.06;
const BALL_R = 0.11;
// Randband von Pfosten und Latte. Ein Ball, dessen Endpunkt näher als das an
// Pfosten oder Latte liegt, wird als Aluminium abgerechnet – aufsTor() und
// loeseTorlinie() benutzen deshalb dieselbe Zahl.
const TOR_RAND = POST_R + BALL_R;
const BALL_H0 = 0.11;
const WALL_DIST = 9.15;        // Vorschriftsmäßiger Mauerabstand
const WALL_MAN_W = 0.52;       // Schulterbreite eines Mauerspielers
const WALL_MAN_H = 1.85;
const WALL_JUMP = 0.42;        // Sprunghöhe der Mauer aus normaler Entfernung
// Aus kurzer Distanz springt eine Mauer nicht. Der Ball ist 0,4 s nach dem
// Schuss da, ein Standsprung braucht allein 0,3 s bis zum Scheitel – und ein
// Sprung reißt genau das Loch auf, durch das der flache Ball dann geht. Genau
// das ist die Anweisung, die jeder Trainer für Freistöße an der Strafraumkante
// gibt. Ohne diese Staffelung ist „über die Mauer" unter 20 m unmöglich – siehe
// Dateikopf-Abschnitt „Kalibrierung", Punkt 5.
const WALL_JUMP_NAH = 0.06;    // Sprunghöhe bei DIST_MIN
const WALL_ARM = 0.16;         // seitlicher Sicherheitszuschlag (Arme)
const DIST_MIN = 16, DIST_MAX = 32;
const NAH_BIS = 26;            // ab hier ist der Freistoß „normal" (Sprung, Topspin)

/* --- Abschuss (ersetzt das frühere konstante BALL_SPEED = 21,0) --- */
const V0_MIN = 23.0, V0_MAX = 30.0;   // Abschussbetrag m/s über die Fähigkeit
// Aus 32 m wird voll durchgezogen, aus 17 m platziert. Ohne diesen Faktor
// verfehlt die Flugzeit den Abnahmekorridor an einem der beiden Enden — siehe
// Dateikopf-Abschnitt „Kalibrierung".
const V0_DIST_NEAR = 0.98, V0_DIST_FAR = 1.15;
const VH_MIN_SQ = 64;                 // vH = sqrt(max(64, v0²−vz²)) → nie unter 8 m/s
const FLUG_TMAX = 3.0;                // s, Obergrenze für die Integration

/* --- Drall (rad/s) --- */
const SPIN_SIDE_MAX = 125;      // voller Effet-Ausschlag bei Fähigkeit 1
const SPIN_SIDE_MIN_F = 0.25;  // Faktor bei Fähigkeit 0 (wie früher CURVE_MIN/CURVE_MAX)
const SPIN_TOP_MIN = 10.5;     // Topspin („Dip") bei Fähigkeit 0
const SPIN_TOP_MAX = 45.0;     // … bei Fähigkeit 1
// Kurze Freistöße werden nicht durchgezogen, sondern mit viel Schnitt getreten:
// nur ein steil abfallender Ball ist über der Mauer und zugleich unter der Latte.
const SPIN_TOP_NAH = 1.75;     // Faktor auf den Topspin bei DIST_MIN, ab NAH_BIS 1,0

/* --- Kamera (Fernsehoptik: weit hinten, lange Brennweite) --- */
const CAM_BACK = 26.0;
const CAM_SIDE = 1.35;         // seitlicher Versatz → schräge Ansicht
const CAM_H = 3.10;
const CAM_FOCAL = 3200;
const HORIZON_Y = 158;

/* --- Eingabe-Balken --- */
const AIM_SPAN_NEAR = 3.2;     // seitliche Auslenkung des Richtungsmarkers bei 16 m
const AIM_SPAN_FAR = 4.5;      // … bei 32 m  (größere Distanz = kleineres Zielfenster)
const VZ_MIN = 4.0, VZ_MAX = 11.0;   // vertikale Abschussgeschwindigkeit m/s
const VZ_RAISE_STEP = 0.25;    // Fenster-Garantie: VZ_MAX szenenweise anheben …
const VZ_RAISE_MAX = 2.0;      // … höchstens um so viel
const WINDOW_MIN_FRAC = 0.06;  // … bis mindestens 6 % des Balkens grün sind
// BALKENLUPE – Mindest-BEDIENZEIT des grünen Fensters in Millisekunden.
// Der Balken ist ein Zeitfenster, kein Lineal: was zählt, ist nicht der Anteil,
// den das Fenster bekommt, sondern die Zeit, die der Marker darin steht. Sie ist
// Anteil · halbe Balkenperiode. Deshalb steht hier eine Zeit und keine Zahl ohne
// Einheit: `lupeAnteil()` rechnet sie in den Mindestanteil um, den DIESE Szene
// braucht (ein starker Schütze hat einen langsameren Balken und braucht weniger).
// Bezugspunkt ist Profi-Schwierigkeit; höhere Grade beschleunigen absichtlich
// alle drei Balken. Ohne die Lupe lag die Bedienzeit bei 25 m im Median bei
// 266 ms und im zehnten Perzentil bei 111 ms – unter 300 ms ist die Höhe kein
// Zielen mehr, sondern ein Glücksspiel. Die Lupe verspricht nichts Falsches: das
// grüne Band zeigt weiterhin GENAU die Höhen, die durchkommen, es bekommt nur
// mehr Balken als sein roher Anteil an VZ_MIN…vzMax. Außerhalb wird der Balken
// dafür gröber – Danebenliegen wird also nicht billiger, sondern teurer.
const FENSTER_MIN_MS = 300;
const STEER_MAX = 7.5;         // rad/s zusätzlicher Drall durch Nachziehen
const STEER_PER_PX = 0.056;
const STEER_UNTIL = 0.34;      // nur in den ersten 34 % des Flugs

/* --- Zeiten (ms) --- */
const INTRO_MS = 950;
const DIR_PERIOD_MS = 1700;
const DIR_LIMIT_MS = 4500;
// Der Höhenbalken läuft langsamer als die anderen beiden: er trägt die engste
// Entscheidung. Bei Profi-Schwierigkeit dauert ein Balkendurchlauf 962 ms
// (schwacher Schütze) bis 1690 ms (starker); in den 3800 ms der Höhenphase
// überstreicht der Marker den Balken also zwei- bis vier Mal.
const HGT_PERIOD_MS = 2600;
const HGT_LIMIT_MS = 3800;
const CRV_PERIOD_MS = 1850;
const CRV_LIMIT_MS = 3200;
const RUNUP_MS = 480;
const RESULT_MS = 1700;
const HARD_TIMEOUT_MS = 20000;
const SLOWMO = 1.15;           // Zeitlupenfaktor der Anzeige
const ANIM_MIN_MS = 900;       // Untergrenze der Anzeigedauer …
const ANIM_MAX_MS = 2100;      // … und Obergrenze

/* --- Mauer als Rennen --- */
const WALL_JUMP_MS = 220;      // mittlerer Absprung nach dem Schuss
const WALL_JUMP_SD = 45;
const WALL_JUMP_DUR = 340;     // Absprung → Landung

/* --- Flatterball --- */
const KNUCKLE_BAND = 0.14;     // |crvMark−0.5|·2 unterhalb davon flattert der Ball
const KNUCKLE_PRED_SD = 0.35;  // zusätzlicher Vorhersagefehler des Torworts

/* --- Torwart --- */
const KEEPER_START_U = 1.55;       // Startposition auf der offenen Torhälfte
const KEEPER_REACT_MS_SLOW = 400;  // Reaktionsbeginn in ms bei Reflexen 0
const KEEPER_REACT_MS_FAST = 260;  // … bei Reflexen 99
const KEEPER_ANTIZ_MS = 90;        // Abzug durch Stellungsspiel
const KEEPER_SPEED_BASE = 3.6;     // m/s – Klammer um den VORHERGESAGTEN Zielpunkt
const KEEPER_SPEED_PER = 2.7;      // + reflexe/100 * dieser Wert
const KEEPER_REACH_DIFF = 0.22;    // Schwierigkeitsanteil der Reichweite
// Effet-Täuschung. Der Wert stand auf 0,62, als die maximale Ablage 3,85 m
// betrug (CURVE_MAX + Trait). Mit der echten Magnus-Bahn sind es bis zu 6,3 m —
// bei unverändertem Faktor hätte der Torwart plötzlich fast 4 m Vorhersagefehler
// und wäre gegen die Absicht des Plans doppelt geschwächt. 0,62·3,85/6,3 ≈ 0,38
// hält den ABSOLUTEN Fehler dort, wo er vorher war.
const CURVE_CONFUSION = 0.38;
const KEEPER_NOISE = 0.22;
const KEEPER_SAVE_BASE = 0.86;     // Grundwahrscheinlichkeit direkt am Körper
const KEEPER_SAVE_SKILL = 0.11;    // Zuschlag bei Können 1
const KEEPER_SAVE_FALLOFF = 0.40;  // Abfall zum Rand der Reichweite
const KEEPER_SAVE_CEIL = 0.97;

/* --- Bewertung --- */
const Q_W_PLACEMENT = 0.40, Q_W_LOFT = 0.34, Q_W_CURVE = 0.26;
const XG_SPAN = 0.34;
const XG_MIN = -0.10, XG_MAX = 0.40;

/* --- Trait / Attribute --- */
const TRAIT_SPEC_SKILL = 0.14;     // 'freistossspezialist'
const TRAIT_SPEC_SPIN = 8;         // rad/s zusätzlicher Effet
const WINDOW_HINT_FROM = 45;       // ab diesem Standards-Wert wird das Fenster sichtbar
const WINDOW_HINT_FULL = 85;

/* --- Farben (Stil-Leitfaden §14) --- */
const C = {
  grassA: '#2f7d32', grassB: '#276b2a',
  line: '#f2f6ef', crowdBg: '#1b2430', banden: '#123a6b',
  wood: '#8b5a2b', beige: '#e8d9b0', paper: '#f2e8cf',
  red: '#c1272d', blue: '#1c4f8f', gold: '#f2c53d', green: '#3fa64a',
  ink: '#14181e', shadow: 'rgba(0,0,0,0.35)',
  net: 'rgba(245,248,255,0.55)', post: '#f4f6f8'
};

const SKIN_TONES = ['#f2d3b3', '#e6bd94', '#d09a66', '#b57a4b', '#8d5524', '#5c3317'];

/** Eigene Figuren-Routinen: Mauersprung/Hechte müssen exakt zur Projektion passen. */
const USE_HOST_PLAYER = false;
const HOST_PLAYER_SCALE_UNIT = 96;

/* ══════════════════════════════════════════════════════════════════════════
   HELFER
   ══════════════════════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;
const clamp01 = (v) => clamp(v, 0, 1);
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeIn = (t) => t * t;

function att(player, key, fallback = 50) {
  const a = player && player.attributes;
  const v = a ? a[key] : undefined;
  return typeof v === 'number' ? v : fallback;
}

function hasTrait(player, key) {
  return !!(player && Array.isArray(player.traits) && player.traits.includes(key));
}

function kitOf(player) {
  const club = player && player.clubId ? getClub(player.clubId) : null;
  const col = (club && club.colors) || DEFAULT_COLORS;
  return {
    primary: col.primary || DEFAULT_COLORS.primary,
    secondary: col.secondary || DEFAULT_COLORS.secondary,
    accent: col.accent || DEFAULT_COLORS.accent,
    shorts: (club && club.kit && club.kit.shorts) || col.secondary || '#ffffff',
    socks: (club && club.kit && club.kit.socks) || col.primary || '#222222'
  };
}

function keeperKit() {
  return { primary: '#3aa04a', secondary: '#12331a', accent: '#f2c53d', shorts: '#12331a', socks: '#3aa04a' };
}

/**
 * Kamera auf der Ball-Tor-Achse.
 * Welt: u = seitlich (0 = Tormitte), v = Entfernung zur Torlinie, h = Höhe.
 * Kameraframe: a = Tiefe entlang der Achse, b = seitlich dazu.
 */
function makeCamera(ballU, ballV, w, h) {
  const D = Math.max(6, Math.hypot(ballU, ballV));
  const cosP = ballV / D, sinP = ballU / D;
  const camA = D + CAM_BACK, camB = CAM_SIDE;
  const cx = w * 0.52;
  const cy = HORIZON_Y * (h / CANVAS_H);
  function toCam(u, v) { return { a: v * cosP + u * sinP, b: u * cosP - v * sinP }; }
  return {
    D, cosP, sinP, cx, cy, camA, camB, toCam,
    project(u, v, ht) {
      const c = toCam(u, v);
      const depth = Math.max(0.6, camA - c.a);
      const k = CAM_FOCAL / depth;
      return { x: cx + (c.b - camB) * k, y: cy + (CAM_H - ht) * k, k, depth };
    },
    scaleAt(u, v) {
      const c = toCam(u, v);
      return CAM_FOCAL / Math.max(0.6, camA - c.a);
    }
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   FLUGMODELL – DOM-frei, komplett auf core/ballistik.js
   ══════════════════════════════════════════════════════════════════════════ */

/** Fähigkeit des Schützen 0..1 – steuert Abschusstempo, Drall und Balkentempo. */
function shooterSkill(actor) {
  const s = (att(actor, 'standards') * 0.42 + att(actor, 'technik') * 0.30
    + att(actor, 'schuss') * 0.18 + att(actor, 'nervenstaerke') * 0.10) / 100;
  return clamp01(s + (hasTrait(actor, 'freistossspezialist') ? TRAIT_SPEC_SKILL : 0));
}

/**
 * Periode eines Eingabebalkens in ms bei Profi-Schwierigkeit. Ein starker
 * Schütze bekommt langsamere Balken – das ist der eigentliche Fähigkeitsbonus
 * dieser Szene. `play()` teilt zusätzlich durch die Schwierigkeit.
 */
function balkenPeriode(basisMs, skill) { return basisMs * lerp(0.74, 1.30, skill); }

/**
 * Mindestanteil des Höhenbalkens für das grüne Fenster (Balkenlupe).
 * Ein Durchlauf über den Balken dauert eine HALBE Periode – der Marker ist eine
 * Dreieckschwingung. Damit das Fenster FENSTER_MIN_MS lang bedienbar ist, muss
 * es also 2·FENSTER_MIN_MS / Periode des Balkens breit sein.
 */
function lupeAnteil(skill) {
  return clamp01(2 * FENSTER_MIN_MS / balkenPeriode(HGT_PERIOD_MS, skill));
}

/**
 * Nahbereichsanteil: 0 bei DIST_MIN, 1 ab NAH_BIS. Aus kurzer Distanz ist der
 * Freistoß ein anderes Spiel – die Mauer kommt nicht mehr hoch, dafür braucht
 * der Ball viel mehr Schnitt, um rechtzeitig abzusacken.
 */
function nahAnteil(D) { return clamp01((D - DIST_MIN) / (NAH_BIS - DIST_MIN)); }

/** Sprunghöhe der Mauer aus dieser Entfernung. */
function mauerSprung(D) { return lerp(WALL_JUMP_NAH, WALL_JUMP, nahAnteil(D)); }

/** Fußhöhe eines Mauerspielers zum Zeitpunkt tMs nach dem Schuss. */
function wallFeet(tMs, startMs, hoehe) {
  const u = clamp01((tMs - startMs) / WALL_JUMP_DUR);
  return (hoehe === undefined ? WALL_JUMP : hoehe) * Math.sin(Math.PI * u);
}

/**
 * Eingabeobjekt eines Schusses. Wird wiederverwendet – in der rAF-Schleife wird
 * nichts erzeugt.
 *   aimU  = Abschussrichtung, gemessen als Durchstoßpunkt auf der Torlinie (m)
 *   vz    = vertikale Abschussgeschwindigkeit (m/s)
 *   spin  = Sidespin (rad/s, > 0 = biegt nach rechts)
 *   kFac  = Flatteranteil 0..1
 */
function makeEingabe() { return { aimU: 0, vz: 7, spin: 0, kFac: 0 }; }

const _zRoh = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
const _zA = { u: 0, v: 0, h: 0, vBetrag: 0 };
const _zB = { u: 0, v: 0, h: 0, vBetrag: 0 };
const _zC = { u: 0, v: 0, h: 0, vBetrag: 0 };

/**
 * Baut das Flugmodell dieses Freistoßes.
 *
 * `bahn(ein)` integriert die Bahn genau einmal je Eingabe und hält sie fest,
 * solange die Eingabe gleich bleibt. Die Adapter `zustand`/`heightAt`/`sideAt`
 * greifen nur noch auf `flug.at()` zu.
 *
 * ACHTUNG (Signaturänderung gegenüber der Fassung vor dem Umbau): heightAt und
 * sideAt bekommen jetzt die vollständige Eingabe statt einzelner Skalare. Ohne
 * aimU UND vz UND Drall gibt es keine Bahn mehr – die alten Teilsignaturen
 * hätten stillen Modulzustand gebraucht, und der wäre für den Prüfexport
 * `modell` nicht reproduzierbar gewesen.
 */
function makeFlight(ballU, ballV, D, skill, flatter) {
  const v0 = lerp(V0_MIN, V0_MAX, skill)
    * lerp(V0_DIST_NEAR, V0_DIST_FAR, clamp01((D - DIST_MIN) / (DIST_MAX - DIST_MIN)));
  const topspinUps = lerp(SPIN_TOP_MIN, SPIN_TOP_MAX, skill)
    * lerp(SPIN_TOP_NAH, 1, nahAnteil(D)) / TAU;

  const p0 = { x: ballU, y: ballV, z: BALL_H0 };
  const vVek = { x: 0, y: 0, z: 0 };
  const wVek = { x: 0, y: 0, z: 0 };
  const init = { p: p0, v: vVek, w: wVek, boden: 0, tMax: FLUG_TMAX };

  let flug = null;
  let kAim = NaN, kVz = NaN, kSpin = NaN;
  let wallV = 0;

  const F = {
    v0, D, ballU, ballV, topspinUps, flatter,
    T: 0, tWall: 0, tWallFrac: 0.5, erreichtTor: false, flug: null,

    /** Ebene der Mauer festlegen (ändert die gecachte Bahn nicht, nur tWall). */
    setzeMauerEbene(v) { wallV = v; kAim = NaN; },

    /** Integriert die Bahn für `ein` – oder liefert die bereits vorhandene. */
    bahn(ein) {
      if (flug && ein.aimU === kAim && ein.vz === kVz && ein.spin === kSpin) return F;
      const dx = ein.aimU - ballU, dy = -ballV;
      const n = Math.hypot(dx, dy) || 1;
      const rx = dx / n, ry = dy / n;
      const vz = clamp(ein.vz, 0, v0 - 1);
      const vH = Math.sqrt(Math.max(VH_MIN_SQ, v0 * v0 - vz * vz));
      vVek.x = rx * vH; vVek.y = ry * vH; vVek.z = vz;
      drallVektor(rx, ry, ein.spin / TAU, topspinUps, wVek);

      if (flug) flug.freigeben();
      flug = createFlug(init);
      kAim = ein.aimU; kVz = ein.vz; kSpin = ein.spin;

      const tor = flug.trefferEbene('y', 0);
      F.erreichtTor = !!tor;
      F.T = tor ? tor.t : Math.max(0.2, flug.dauer);
      const mw = wallV > 0 ? flug.trefferEbene('y', wallV) : null;
      F.tWall = mw ? mw.t : F.T * 0.5;
      F.tWallFrac = clamp01(F.tWall / Math.max(1e-6, F.T));
      F.flug = flug;
      return F;
    },

    /** Seitliche Zusatzlage des Flatterballs (rein, ohne Integrator). */
    flatterU(t01, T, kFac) {
      if (!(kFac > 0) || !flatter) return 0;
      const s = T * t01;
      return kFac * (flatter.a1 * Math.sin(TAU * flatter.f1 * s + flatter.p1)
        + flatter.a2 * Math.sin(TAU * flatter.f2 * s + flatter.p2)) * t01;
    },

    /** Zustand zum Zeitanteil t01 (0 = Abschuss, 1 = Torlinie). */
    zustand(t01, ein, out) {
      F.bahn(ein);
      const o = out || _zA;
      const s = flug.at(clamp01(t01) * F.T, _zRoh);
      o.u = s.x + F.flatterU(clamp01(t01), F.T, ein.kFac);
      o.v = s.y;
      o.h = s.z;
      o.vBetrag = s.v;
      return o;
    },

    /** Zustand zu einer absoluten Flugzeit in Sekunden. */
    zustandBeiZeit(tAbs, ein, out) { return F.zustand(tAbs / Math.max(1e-6, F.T), ein, out); },

    /* Dünne Adapter – dieselben Namen wie vor dem Umbau, jetzt auf flug.at(). */
    heightAt(t01, ein) { return F.zustand(t01, ein, _zC).h; },
    sideAt(t01, ein) { return F.zustand(t01, ein, _zC).u; },
    vAt(t01, ein) { return F.zustand(t01, ein, _zC).v; },

    /** Gibt die gehaltene Bahn an den Pool zurück. Danach nicht weiterbenutzen. */
    freigeben() { if (flug) { flug.freigeben(); flug = null; kAim = NaN; } }
  };
  return F;
}

/** Mauergeometrie in Weltkoordinaten. */
function makeWall(ballU, ballV, D, count, foot) {
  const fw = clamp(WALL_DIST / D, 0.12, 0.72);
  // Nächstgelegener Pfosten: der auf der Ballseite. Bei zentralen Freistößen
  // stellt der Torwart die Mauer auf die „natürliche" Schussseite des Schützen.
  const sign = ballU > 0.8 ? 1 : ballU < -0.8 ? -1 : (foot === 'links' ? -1 : 1);
  const nearPostU = sign * GOAL_HALF_W;
  const edge = ballU + (nearPostU - ballU) * fw;      // äußere Kante der Mauer
  const width = count * WALL_MAN_W;
  const inner = edge - sign * width;
  return {
    v: ballV * (1 - fw), t: fw, sign, count,
    uMin: Math.min(edge, inner), uMax: Math.max(edge, inner),
    /** Mittelpunkt des i-ten Mauerspielers. */
    manU(i) { return edge - sign * (WALL_MAN_W * (i + 0.5)); }
  };
}

/**
 * Trifft der Ball die Mauer? Geprüft wird die tatsächliche Fußhöhe JEDES
 * Mauerspielers zum tatsächlichen Durchgangszeitpunkt – dieselbe Funktion, die
 * `drawWall` zeichnet. Mal springt einer zu früh, mal zu spät.
 * Rückgabe: null oder { i, u, v, h, t }.
 */
function mauerTreffer(szene, ein) {
  const fl = szene.flight.bahn(ein);
  if (!(fl.tWall > 0) || szene.wall.v <= 0) return null;
  const z = szene.flight.zustandBeiZeit(fl.tWall, ein, _zB);
  const tMs = fl.tWall * 1000;
  const halb = WALL_MAN_W * 0.5 + WALL_ARM + BALL_R;
  for (let i = 0; i < szene.wall.count; i++) {
    const f = wallFeet(tMs, szene.jumpStarts[i], szene.wallJump);
    const mu = szene.wall.manU(i);
    if (z.u > mu - halb && z.u < mu + halb && z.h > f - BALL_R && z.h < f + WALL_MAN_H + BALL_R) {
      return { i, u: z.u, v: z.v, h: z.h, t: fl.tWall };
    }
  }
  return null;
}

/**
 * Kommt der Ball bei dieser Höhe überhaupt aufs Tor?
 *
 * Die Grenzen sind EXAKT die, mit denen `loeseTorlinie` Latte und Pfosten
 * abrechnet (|endH − GOAL_H| ≤ TOR_RAND bzw. ||endU| − GOAL_HALF_W| ≤ TOR_RAND).
 * Vorher standen hier 0,14 und 0,15 m: das grüne Fenster versprach am oberen
 * Rand 3 cm mehr Tor, als das Modell hergab – in einem Drittel der Fenster gab
 * es dort eine Höhe, bei der KEIN Effetwert mehr ins Tor ging, während das HUD
 * „unter die Latte" behauptete. Die Zielhilfe darf nie mehr versprechen als die
 * Abrechnung.
 */
function aufsTor(h, u) {
  return h > 0.12 && h < GOAL_H - TOR_RAND && Math.abs(u) < GOAL_HALF_W - TOR_RAND;
}

/**
 * Sicheres Höhenfenster als normierter Bereich 0..1 des Höhenbalkens.
 *
 * FENSTER-GARANTIE (Pflicht aus der Risikoanalyse): Das Ergebnis ist NIE leer.
 * Drei Stufen, in dieser Reihenfolge:
 *   1. Echt sicher: an der Mauer vorbei (über, unter oder außen herum – mit dem
 *      vorhandenen Effet-Spielraum) und danach aufs Tor.
 *      Reicht das nicht für WINDOW_MIN_FRAC des Balkens, wird VZ_MAX szenenweise
 *      in VZ_RAISE_STEP-Schritten um höchstens VZ_RAISE_MAX angehoben.
 *   2. Notfenster: die Höhen, die wenigstens aufs Tor gehen.
 *   3. Falls selbst das leer bliebe: ein WINDOW_MIN_FRAC breites Band um die
 *      Höhe mit der besten Torlage. Damit ist die Nichtleere strukturell
 *      garantiert und hängt nicht am Zufall der Szene.
 *
 * `grund` sagt dem HUD, WARUM es kein sicheres Fenster gibt – und zwar die
 * gemessene Ursache, nicht die vermutete:
 *   'mauer'      – jede Höhe wird von der Mauer erwischt: die Richtung ist schuld.
 *   'entfernung' – der Ball war über der Mauer frei, kommt aber vor der Torlinie
 *                  nicht mehr unter die Latte. Da hilft keine andere Höhe, nur
 *                  ein anderer Weg (außen herum). Aus 16–20 m ist das der Normal-
 *                  fall für jede Richtung, die in die Mauer zeigt.
 *
 * Rückgabe: { fenster:[0..1,0..1], vzBand:[m/s,m/s]|null, vzMax, sicher, grund }.
 * `vzBand` ist der Höhenbereich, den das grüne Band bedeutet; `vzAusBalken`
 * rechnet die Markerstellung damit wieder in eine Abschussgeschwindigkeit um.
 */
function fensterFuer(szene, aimU) {
  const GN = 36;                       // Stützstellen über den GESAMTEN vz-Bereich
  const vzOben = VZ_MAX + VZ_RAISE_MAX;
  const spinProben = szene.curveMax > 0.01
    ? [0, szene.curveMax, -szene.curveMax, szene.curveMax * 0.5, -szene.curveMax * 0.5]
    : [0];
  const ein = makeEingabe();
  ein.aimU = aimU; ein.kFac = 0;

  let besterVz = VZ_MIN + (vzOben - VZ_MIN) * 0.5, besterFehler = Infinity;
  let freiZuHoch = false;              // an der Mauer vorbei, aber über der Latte

  /**
   * Eine Höhe über alle Effet-Proben prüfen.
   * 0 = nichts, 1 = wenigstens aufs Tor, 2 = an der Mauer vorbei UND aufs Tor.
   */
  const probeVz = (vz) => {
    ein.vz = vz;
    let r = 0;
    for (let s = 0; s < spinProben.length; s++) {
      ein.spin = spinProben[s];
      const fl = szene.flight.bahn(ein);
      if (!fl.erreichtTor) continue;
      const z = szene.flight.zustand(1, ein, _zB);
      const zh = z.h, zu = z.u;                 // kopieren: mauerTreffer nutzt _zB
      const t = aufsTor(zh, zu);
      if (t && r < 1) r = 1;
      const blockiert = !!mauerTreffer(szene, ein);
      if (t && !blockiert) return 2;
      if (!blockiert && zh >= GOAL_H - TOR_RAND && Math.abs(zu) < GOAL_HALF_W - TOR_RAND) freiZuHoch = true;
      const fehler = Math.abs(zh - 1.2) + Math.max(0, Math.abs(zu) - GOAL_HALF_W + 0.2) * 2;
      if (fehler < besterFehler) { besterFehler = fehler; besterVz = vz; }
    }
    return r;
  };

  // Ein einziger Durchgang über vz. Das Anheben von VZ_MAX ändert nur, WELCHER
  // Ausschnitt dieses Bereichs auf dem Balken landet – nicht die Physik.
  const sicher = new Array(GN + 1), imTor = new Array(GN + 1);
  const schritt = (vzOben - VZ_MIN) / GN;
  for (let i = 0; i <= GN; i++) {
    const r = probeVz(lerp(VZ_MIN, vzOben, i / GN));
    sicher[i] = r === 2; imTor[i] = r >= 1;
  }
  const grund = freiZuHoch ? 'entfernung' : 'mauer';

  /**
   * Kante eines sicheren Bandes nachmessen. Das Raster ist 0,25 m/s grob; auf
   * kurzer Distanz ist das sichere Band selbst kaum breiter, und ein einzelner
   * Rasterpunkt ergäbe ein Fenster der Breite null – aus einem echten Weg würde
   * ein gelbes Notfenster. Zwei Halbierungen je Seite; JEDE zurückgegebene Kante
   * ist gemessen, nicht geschätzt.
   */
  const kante = (vz, richtung) => {
    let rand = vz, s = schritt * 0.5;
    for (let k = 0; k < 2; k++) {
      const p = rand + richtung * s;
      if (p >= VZ_MIN && p <= vzOben && probeVz(p) === 2) rand = p;
      s *= 0.5;
    }
    return rand;
  };

  /**
   * Längster zusammenhängender Bereich als [vzA, vzB] oder null.
   * `verfeinern` misst die beiden Kanten zwischen den Rasterpunkten nach.
   */
  const laengstes = (flags, verfeinern) => {
    let bLo = -1, bLen = 0, lo = -1;
    for (let i = 0; i <= GN; i++) {
      if (flags[i]) { if (lo < 0) lo = i; }
      else if (lo >= 0) { if (i - lo > bLen) { bLen = i - lo; bLo = lo; } lo = -1; }
    }
    if (lo >= 0 && GN + 1 - lo > bLen) { bLen = GN + 1 - lo; bLo = lo; }
    if (bLen <= 0) return null;
    const f = (j) => lerp(VZ_MIN, vzOben, j / GN);
    const a = f(bLo), b = f(bLo + bLen - 1);
    return verfeinern ? [kante(a, -1), kante(b, 1)] : [a, b];
  };

  /**
   * Ausschnitt [vzA,vzB] auf den Balken mit dieser Obergrenze abbilden – und
   * dabei auf mindestens den Anteil dehnen, den `lupeAnteil` für die geforderte
   * Bedienzeit verlangt (Balkenlupe, siehe dort). Die Lage bleibt erhalten: ein tiefes Fenster bleibt unten am Balken,
   * ein hohes oben. `roh` ist der ungedehnte Anteil – NUR er entscheidet, ob
   * VZ_MAX weiter angehoben wird; sonst würde die Lupe die Fenster-Garantie
   * mit einem gedehnten Splitter zufriedenstellen.
   * Rückgabe { fenster, vzBand, roh } oder null.
   */
  const lupe = lupeAnteil(szene.skill);
  const aufBalken = (band, vzMax) => {
    const a = Math.max(band[0], VZ_MIN), b = Math.min(band[1], vzMax);
    if (!(b > a)) return null;
    const s = vzMax - VZ_MIN;
    let p0 = clamp01((a - VZ_MIN) / s), p1 = clamp01((b - VZ_MIN) / s);
    const roh = p1 - p0;
    if (roh < lupe) {
      const unten = p0, oben = 1 - p1;
      const rest = 1 - lupe;
      p0 = (unten + oben) > 1e-9 ? rest * unten / (unten + oben) : rest * 0.5;
      p1 = p0 + lupe;
    }
    return { fenster: [p0, p1], vzBand: [a, b], roh };
  };

  const stufen = Math.round(VZ_RAISE_MAX / VZ_RAISE_STEP);
  const band = laengstes(sicher, true);
  if (band) {
    let letzterTreffer = null;
    for (let r = 0; r <= stufen; r++) {
      const vzMax = VZ_MAX + r * VZ_RAISE_STEP;
      const f = aufBalken(band, vzMax);
      if (!f) continue;
      letzterTreffer = { fenster: f.fenster, vzBand: f.vzBand, vzMax, sicher: true, grund: 'sicher' };
      if (f.roh >= WINDOW_MIN_FRAC) return letzterTreffer;
    }
    if (letzterTreffer) return letzterTreffer;
  }

  // Stufe 2: Notfenster – wenigstens aufs Tor.
  const notBand = laengstes(imTor, false);
  if (notBand) {
    for (let r = 0; r <= stufen; r++) {
      const vzMax = VZ_MAX + r * VZ_RAISE_STEP;
      const f = aufBalken(notBand, vzMax);
      if (f) return { fenster: f.fenster, vzBand: f.vzBand, vzMax, sicher: false, grund };
    }
  }

  // Stufe 3: Band um die beste Höhe. Kann strukturell nicht leer sein.
  // Ohne vzBand – hier wird der Balken linear gelesen, es gibt nichts zu dehnen.
  const m = clamp01((besterVz - VZ_MIN) / (VZ_MAX - VZ_MIN));
  const halb = WINDOW_MIN_FRAC * 0.5;
  const lo = clamp(m - halb, 0, 1 - WINDOW_MIN_FRAC);
  return { fenster: [lo, lo + WINDOW_MIN_FRAC], vzBand: null, vzMax: VZ_MAX, sicher: false, grund };
}

/**
 * Markerstellung des Höhenbalkens (0 = unten/Mauer, 1 = oben/Latte) in die
 * vertikale Abschussgeschwindigkeit. Umkehrung der Balkenlupe und damit die
 * EINZIGE Stelle, an der der Balken gelesen wird – Vorschau, Abschuss und
 * Prüfstand benutzen dieselbe Funktion, sonst zeigt die gestrichelte Linie
 * eine andere Bahn als der Schuss nimmt.
 *
 * Drei streng monotone Abschnitte: unterhalb des Fensters, im Fenster, oberhalb.
 * Ohne `vzBand` (Stufe 3 von fensterFuer) bleibt der Balken linear.
 */
function vzAusBalken(f, mark) {
  const m = clamp01(mark);
  const band = f && f.vzBand;
  const vzMax = (f && f.vzMax) || VZ_MAX;
  if (!band) return lerp(VZ_MIN, vzMax, m);
  const p0 = f.fenster[0], p1 = f.fenster[1];
  if (m <= p0) return p0 > 1e-6 ? lerp(VZ_MIN, band[0], m / p0) : band[0];
  if (m >= p1) return p1 < 1 - 1e-6 ? lerp(band[1], vzMax, (m - p1) / (1 - p1)) : band[1];
  return lerp(band[0], band[1], (m - p0) / (p1 - p0));
}

/**
 * Torwart-Plan: Wann setzt er sich in Bewegung, wohin, wie weit kommt er?
 * Effet und Flattern täuschen ihn – je stärker, desto größer sein Fehler.
 *
 * Der Plan wird EINMAL beim Abschuss gezogen (diskretes Ereignis, zwei
 * rng-Züge). Wer danach noch nachzieht, täuscht ihn wirklich – das ist der
 * ganze Sinn des Nachziehfensters.
 *
 * `maxTravel` ist bewusst KEINE Laufstrecke, sondern die Klammer um den
 * VORHERGESAGTEN Zielpunkt. Die tatsächliche Reichweite kommt aus
 * `ballistik.twReichweite` und ist nach dem Absprung linear in der Zeit.
 */
function planeTorwart(rng, keeper, flightT, endU, endH, ablageM, kFac, startU, diff) {
  const reflex = att(keeper, 'reflexe', 55);
  const stellung = att(keeper, 'stellungsspiel', 55);
  const skill = clamp01((reflex * 0.6 + stellung * 0.25 + att(keeper, 'sprungkraft', 55) * 0.15) / 100
    + (hasTrait(keeper, 'torwartlegende') ? 0.08 : 0));

  const reactMs = lerp(KEEPER_REACT_MS_SLOW, KEEPER_REACT_MS_FAST, clamp01(reflex / 99))
    - lerp(0, KEEPER_ANTIZ_MS, clamp01(stellung / 99));
  const reactS = Math.max(0.09, reactMs / 1000);
  const reactT = clamp(reactS / Math.max(0.2, flightT), 0.12, 0.95);

  const par = twParameter({
    reflexe: reflex, antizipation: stellung,
    sprungkraft: att(keeper, 'sprungkraft', 55), groesse: 1.88
  });
  // EINE Uhr: die Reaktionszeit dieser Szene ersetzt die Voreinstellung des Kerns.
  par.tReakt = reactS;

  const speed = (KEEPER_SPEED_BASE + (reflex / 100) * KEEPER_SPEED_PER) * (0.85 + 0.25 * diff);
  const maxTravel = speed * Math.max(0, flightT - reactS);

  const predErr = ablageM * CURVE_CONFUSION * (1 - skill * 0.75)
    + rng.gauss(0, KEEPER_NOISE) + kFac * rng.gauss(0, KNUCKLE_PRED_SD);
  const predU = endU + predErr;
  const targetU = clamp(predU, startU - maxTravel, startU + maxTravel);
  return {
    reactT, reactS, targetU, maxTravel, skill, par, startU,
    zielH: endH, side: targetU >= startU ? 1 : -1
  };
}

/** Seitliche Position des Torwarts zur echten Flugzeit tReal (Sekunden). */
function torwartU(plan, tReal) {
  const koerper = Math.max(0, twReichweite(plan.par, tReal, plan.zielH) - plan.par.arm);
  return plan.startU + plan.side * Math.min(Math.abs(plan.targetU - plan.startU), koerper);
}

/** Parade-Entscheidung. Zieht genau EINEN rng-Zug. */
function parade(plan, flightT, endU, endH, rng, diff) {
  const reach = twReichweite(plan.par, flightT, endH)
    * (1 - KEEPER_REACH_DIFF + KEEPER_REACH_DIFF * clamp(diff, 0.6, 1.7));
  const erreicht = Math.min(reach, Math.abs(plan.targetU - plan.startU) + plan.par.arm);
  const d = endU - plan.startU;
  const dist = Math.abs(d);
  const richtig = (d >= 0 ? 1 : -1) === plan.side || dist <= plan.par.arm;
  let p = 0;
  if (richtig && dist <= erreicht) {
    // Anders als beim Elfmeter hält ein Torwart fast alles, woran er wirklich
    // drankommt — die Kunst des Freistoßes liegt darin, ihn nicht drankommen zu
    // lassen. Deshalb flach in der Mitte und erst zum Rand hin abfallend.
    const x = dist / Math.max(0.4, erreicht);
    p = clamp((KEEPER_SAVE_BASE + KEEPER_SAVE_SKILL * plan.skill) * (1 - KEEPER_SAVE_FALLOFF * x * x),
      0, KEEPER_SAVE_CEIL);
  }
  const wurf = rng.chance(p);   // immer ziehen: konstante Zugzahl = reproduzierbar
  return { gehalten: p > 0 && wurf, p, reach, erreicht, dist };
}

/** Ausführungsgüte 0..1 aus Platzierung, Höhenfenster und Effet-Nutzung. */
function computeQuality(endU, endH, spin, hWall, wallTopH, blocked) {
  // Platzierung: Ecken zählen, Mitte nicht.
  const cU = clamp01((Math.abs(endU) - 0.7) / (GOAL_HALF_W - 1.0));
  const cH = clamp01((endH - 0.25) / 1.7);
  let placement = clamp01(cU * 0.62 + cH * 0.38);
  if (Math.abs(endU) > GOAL_HALF_W + 0.35 || endH > GOAL_H + 0.35) placement *= 0.30;

  // Höhe: knapp über die Mauer ist die Kunst, weit drüber ist Glück.
  let loft;
  if (blocked) loft = 0.05;
  else {
    const over = hWall - wallTopH;
    loft = clamp01(1 - Math.abs(over - 0.35) / 1.1);
    if (endH > GOAL_H) loft *= 0.35;
  }

  // Effet: belohnt wird, wer den Ball um die Mauer herum zieht.
  const passedOutside = hWall <= wallTopH && !blocked;   // seitlich vorbei
  const curveUse = clamp01(Math.abs(spin) / SPIN_SIDE_MAX);
  const curveQ = blocked ? 0.05 : clamp01((passedOutside ? 0.55 : 0.30) + curveUse * 0.55);

  return clamp(Q_W_PLACEMENT * placement + Q_W_LOFT * loft + Q_W_CURVE * curveQ, 0.02, 1);
}

function xgAus(quality, outcome) {
  let xg = (quality - 0.5) * XG_SPAN;
  if (outcome === 'tor') xg += 0.10;
  else if (outcome === 'parade') xg -= 0.03;
  else if (outcome === 'latte' || outcome === 'pfosten') xg -= 0.05;
  else if (outcome === 'daneben') xg -= 0.12;
  else if (outcome === 'geblockt') xg -= 0.10;
  return Math.round(clamp(xg, XG_MIN, XG_MAX) * 1000) / 1000;
}

/**
 * Endabrechnung an der Torlinie. `plan` kommt aus planeTorwart und wurde beim
 * Abschuss gezogen; hier fällt nur noch der Paraden-Würfel.
 */
function loeseTorlinie(szene, ein, plan, rng, diff) {
  const fl = szene.flight.bahn(ein);
  const e = szene.flight.zustand(1, ein, _zA);
  const endU = e.u, endH = e.h;
  const hWall = szene.flight.zustandBeiZeit(fl.tWall, ein, _zB).h;

  const overBar = endH > GOAL_H + TOR_RAND;
  const wide = Math.abs(endU) > GOAL_HALF_W + TOR_RAND;
  const hitPost = Math.abs(Math.abs(endU) - GOAL_HALF_W) <= TOR_RAND && endH < GOAL_H + POST_R;
  const hitBar = Math.abs(endH - GOAL_H) <= TOR_RAND && Math.abs(endU) < GOAL_HALF_W + POST_R;
  const kurz = !fl.erreichtTor || endH < 0.02;

  const par = parade(plan, fl.T, endU, endH, rng, diff);

  let outcome;
  if (kurz || overBar || wide) outcome = 'daneben';
  else if (hitBar) outcome = 'latte';
  else if (hitPost) outcome = 'pfosten';
  else if (par.gehalten) outcome = 'parade';
  else outcome = 'tor';

  const quality = computeQuality(endU, endH, ein.spin, hWall, szene.wallTop, false);
  return {
    outcome,
    quality: Math.round(quality * 1000) / 1000,
    xgDelta: xgAus(quality, outcome),
    endU, endH, hWall, tFlug: fl.T, keeperU: plan.targetU, pSave: par.p
  };
}

/** Ergebnis eines Mauerblocks. */
function loeseBlock(szene, ein, treffer) {
  const fl = szene.flight.bahn(ein);
  const e = szene.flight.zustand(1, ein, _zA);
  const quality = computeQuality(e.u, e.h, ein.spin, treffer.h, szene.wallTop, true);
  return {
    outcome: 'geblockt',
    quality: Math.round(quality * 1000) / 1000,
    xgDelta: xgAus(quality, 'geblockt'),
    endU: treffer.u, endH: treffer.h, hWall: treffer.h, tFlug: fl.T, keeperU: 0, pSave: 0
  };
}

/**
 * Baut die komplette Szene (Geometrie, Flugmodell, Mauer, Fenster).
 * DOM-frei – `play()` und der Prüfexport `modell` benutzen dieselbe Funktion.
 */
function baueSzene(moment, opt) {
  const o = opt || {};
  const rng = o.rng || createRng(19740707);
  const actor = moment.actor || { shortName: 'Schütze', attributes: {} };
  const defenders = Array.isArray(moment.defenders) ? moment.defenders : [];

  // Heim greift Richtung +x an (Tor bei x=105), Gäste Richtung -x (Tor bei x=0).
  const at = moment.at || { x: 85, y: 30 };
  const isHome = moment.team !== 'away';
  const goalX = isHome ? 105 : 0;
  const rawV = Math.abs(goalX - (typeof at.x === 'number' ? at.x : 85));
  const rawU = isHome ? (34 - (typeof at.y === 'number' ? at.y : 30))
    : ((typeof at.y === 'number' ? at.y : 30) - 34);
  let ballU = clamp(rawU, -16, 16);
  let ballV = clamp(rawV, 6, DIST_MAX);
  let D = Math.hypot(ballU, ballV);
  if (D < DIST_MIN) { const f = DIST_MIN / D; ballU *= f; ballV *= f; D = DIST_MIN; }
  else if (D > DIST_MAX) { const f = DIST_MAX / D; ballU *= f; ballV *= f; D = DIST_MAX; }

  const skill = shooterSkill(actor);
  const isSpecialist = hasTrait(actor, 'freistossspezialist');

  // Flatterball: einmalig, deterministisch beim Aufbau gezogen.
  const flatter = {
    a1: rng.float(0.10, 0.20), a2: rng.float(0.05, 0.12),
    f1: rng.float(1.2, 1.8), f2: rng.float(2.1, 2.9),
    p1: rng.float(0, TAU), p2: rng.float(0, TAU)
  };

  const flight = makeFlight(ballU, ballV, D, skill, flatter);
  const wallCount = clamp(defenders.length || 4, 2, 6);
  const wall = makeWall(ballU, ballV, D, wallCount, actor.foot);
  flight.setzeMauerEbene(wall.v);

  // Sprungrennen der Mauer – wie wallPhase deterministisch beim Aufbau gezogen.
  const jumpStarts = [];
  for (let i = 0; i < wallCount; i++) jumpStarts.push(WALL_JUMP_MS + rng.gauss(0, WALL_JUMP_SD));

  const aimSpan = lerp(AIM_SPAN_NEAR, AIM_SPAN_FAR, clamp01((D - DIST_MIN) / (DIST_MAX - DIST_MIN)));
  const curveMax = SPIN_SIDE_MAX * lerp(SPIN_SIDE_MIN_F, 1, skill) + (isSpecialist ? TRAIT_SPEC_SPIN : 0);

  const szene = {
    ballU, ballV, D, skill, isSpecialist, actor, defenders,
    flight, wall, wallCount, jumpStarts, flatter,
    wallJump: mauerSprung(D),
    wallTop: WALL_MAN_H + mauerSprung(D),
    aimSpan, curveMax,
    // Vorbelegung. Das echte Fenster hängt an der GEWÄHLTEN Richtung und wird
    // erst beim Wechsel in die Höhenphase berechnet (fensterFuer) – vorher wird
    // es auch nicht gezeichnet.
    hFenster: { fenster: [0.35, 0.65], vzBand: null, vzMax: VZ_MAX, sicher: true, grund: 'sicher' },
    /** Gibt die gehaltene Bahn an den Pool zurück (Prüfstand, 4000 Szenen). */
    freigeben() { flight.freigeben(); }
  };
  return szene;
}

/** Flatteranteil aus der Effet-Markerstellung. */
function knuckleFaktor(crvMark, skill) {
  const aus = Math.abs(crvMark - 0.5) * 2;
  return clamp01(1 - aus / KNUCKLE_BAND) * lerp(0.4, 1.0, skill);
}

/**
 * Kompletter Schuss in einem Aufruf – für den Prüfexport `modell`.
 * `eingabe` = { aimU, vz, spin, kFac }.  Zieht genau 3 rng-Züge (2 im Plan,
 * 1 in der Parade), unabhängig vom Ausgang.
 */
function loeseSchuss(szene, eingabe, keeper, rng, diff) {
  const ein = makeEingabe();
  ein.aimU = eingabe.aimU; ein.vz = eingabe.vz;
  ein.spin = eingabe.spin; ein.kFac = eingabe.kFac || 0;

  const fl = szene.flight.bahn(ein);
  const e = szene.flight.zustand(1, ein, _zA);
  const startU = -szene.wall.sign * KEEPER_START_U;
  const ablage = e.u - ein.aimU;
  const plan = planeTorwart(rng, keeper, fl.T, e.u, e.h, ablage, ein.kFac, startU, diff);

  const treffer = mauerTreffer(szene, ein);
  if (treffer) {
    rng.chance(0);   // Zugzahl konstant halten
    return Object.assign(loeseBlock(szene, ein, treffer), { plan, blockedAt: treffer });
  }
  return Object.assign(loeseTorlinie(szene, ein, plan, rng, diff), { plan, blockedAt: null });
}

const RESULT_TEXT = {
  tor: { title: 'TOR!', color: '#2f7d32', sub: 'Traumtor! Der Ball senkt sich unhaltbar ins Netz.' },
  parade: { title: 'GEHALTEN!', color: '#1c4f8f', sub: 'Der Keeper fliegt und kratzt ihn aus dem Winkel.' },
  geblockt: { title: 'MAUER!', color: '#8b5a2b', sub: 'Abgeblockt – die Mauer stand goldrichtig.' },
  daneben: { title: 'DANEBEN!', color: '#c1272d', sub: 'Drüber und vorbei. Die Kurve war zu großzügig.' },
  latte: { title: 'LATTE!', color: '#8b5a2b', sub: 'Aluminium! Ein Zentimeter tiefer und er wäre drin.' },
  pfosten: { title: 'PFOSTEN!', color: '#8b5a2b', sub: 'An den Innenpfosten und zurück ins Feld!' }
};

/* ══════════════════════════════════════════════════════════════════════════
   SZENE – Zeichnen
   ══════════════════════════════════════════════════════════════════════════ */

/** Farben der Ränge aus dem Stadionkontext (Paket 2, Punkt 10) – defensiv. */
function rangFarben(moment) {
  const f = moment && moment.context && moment.context.farben;
  const heim = (f && (f.heim || f.home)) || null;
  const gast = (f && (f.gast || f.away)) || null;
  return {
    heim: (heim && (heim.primary || heim)) || null,
    gast: (gast && (gast.primary || gast)) || null
  };
}

function mischeFarbe(hex, richtungHell, anteil) {
  const s = String(hex || '#888888').replace('#', '');
  const n = s.length === 3
    ? [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)]
    : [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  const ziel = richtungHell ? 255 : 0;
  const r = n.map(v => {
    const b = isFinite(v) ? v : 128;                 // unbekanntes Format → neutral
    return Math.round(b + (ziel - b) * anteil);
  });
  return `rgb(${clamp(r[0], 0, 255)},${clamp(r[1], 0, 255)},${clamp(r[2], 0, 255)})`;
}

/**
 * Zuschauerränge: drei Rangstufen mit nach hinten abnehmender Helligkeit,
 * eingefärbt in den Vereinsfarben – kein Konfetti mehr (Nachtrag §5).
 * Die Leute werden beim Aufbau EINMAL gezogen und liegen in `crowd`.
 */
function makeCrowd(rng, W, cy, farben) {
  const basis = [farben.heim || '#c9ced6', farben.gast || '#404a58', '#e8d9b0', '#8b5a2b'];
  const raenge = [];
  const hoehe = 34;
  for (let r = 0; r < 3; r++) {
    const y = cy - 4 - (r + 1) * hoehe;
    raenge.push({
      y, h: hoehe,
      bg: mischeFarbe('#2a3644', false, r * 0.22),
      kante: mischeFarbe('#4a5768', false, r * 0.22),
      hell: 1 - r * 0.30
    });
  }
  const leute = [];
  for (let r = 0; r < 3; r++) {
    const rg = raenge[r];
    const reihen = 4;
    for (let reihe = 0; reihe < reihen; reihe++) {
      const y = rg.y + 5 + reihe * ((rg.h - 8) / reihen);
      for (let x = 3; x < W; x += 7) {
        if (rng.next() < 0.22) continue;
        const c = basis[rng.int(0, basis.length - 1)];
        leute.push({ x: x + rng.int(-1, 1), y, s: 3, c: mischeFarbe(c, false, (1 - rg.hell) * 0.55), ph: rng.float(0, TAU) });
      }
    }
  }
  const blitze = [];
  for (let i = 0; i < 26; i++) {
    blitze.push({ x: rng.int(0, W), y: cy - rng.int(10, 3 * hoehe), t: rng.float(0, 6) });
  }
  return { raenge, leute, blitze, oben: raenge[2].y };
}

function drawStands(ctx, cam, w, crowd, tSec) {
  const horizon = cam.cy;
  ctx.fillStyle = C.crowdBg;
  ctx.fillRect(0, 0, w, horizon + 6);
  // Oberrang/Dach als dunkle Fläche
  ctx.fillStyle = '#141c26';
  ctx.fillRect(0, 0, w, Math.max(0, crowd.oben));
  for (let i = 0; i < crowd.raenge.length; i++) {
    const r = crowd.raenge[i];
    ctx.fillStyle = r.bg;
    ctx.fillRect(0, r.y, w, r.h);
    ctx.fillStyle = r.kante;
    ctx.fillRect(0, r.y + r.h - 3, w, 3);
  }
  for (let i = 0; i < crowd.leute.length; i++) {
    const p = crowd.leute[i];
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y + Math.sin(tSec * 1.7 + p.ph) * 1.2, p.s, p.s);
  }
  // Blitzlichter wie in render/pitch.js
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < crowd.blitze.length; i++) {
    const b = crowd.blitze[i];
    const f = (tSec * 0.9 + b.t) % 6;
    if (f < 0.09) ctx.fillRect(b.x, b.y, 3, 3);
  }
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizon);
  ctx.fillStyle = C.banden;
  ctx.fillRect(0, horizon - 4, w, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let x = 0; x < w; x += 104) ctx.fillRect(x + 10, horizon, 44, 7);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 3;
  ctx.strokeRect(-2, horizon - 4, w + 4, 16);
}

/** Polygon aus Weltpunkten [[u,v,h], …] füllen/zeichnen. */
function poly(ctx, cam, pts, fill, stroke, lw) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = cam.project(pts[i][0], pts[i][1], pts[i][2] || 0);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}

function drawPitch(ctx, cam, w, h) {
  ctx.fillStyle = C.grassA;
  ctx.fillRect(0, cam.cy, w, h - cam.cy);
  // Rasenstreifen parallel zur Torlinie (perspektivisch verzerrt)
  for (let v = -4; v < 46; v += 4) {
    poly(ctx, cam, [[-46, v], [46, v], [46, v + 4], [-46, v + 4]],
      (Math.floor(v / 4) % 2 === 0) ? C.grassB : C.grassA, null, 0);
  }
  // Torlinie, Strafraum, Torraum
  poly(ctx, cam, [[-40, 0], [40, 0], [40, 0.12], [-40, 0.12]], C.line, null, 0);
  ctx.lineJoin = 'round';
  for (const [depth, half] of [[16.5, 20.16], [5.5, 9.16]]) {
    poly(ctx, cam, [[-half, 0], [-half, depth], [half, depth], [half, 0]], null, C.line, 3);
  }
  // Elfmeterpunkt
  const sp = cam.project(0, 11, 0);
  ctx.fillStyle = C.line;
  ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 6, 2.5, 0, 0, TAU); ctx.fill();
}

function drawGoal(ctx, cam, netHit) {
  const backV = -2.1;
  const P = (u, v, hh) => cam.project(u, v, hh);
  const fl = P(-GOAL_HALF_W, 0, GOAL_H), fr = P(GOAL_HALF_W, 0, GOAL_H);
  const bl = P(-GOAL_HALF_W, 0, 0), br = P(GOAL_HALF_W, 0, 0);
  const kl = P(-GOAL_HALF_W, backV, GOAL_H), kr = P(GOAL_HALF_W, backV, GOAL_H);
  const nl = P(-GOAL_HALF_W, backV, 0), nr = P(GOAL_HALF_W, backV, 0);

  ctx.fillStyle = 'rgba(20,28,36,0.30)';
  ctx.beginPath();
  ctx.moveTo(kl.x, kl.y); ctx.lineTo(kr.x, kr.y); ctx.lineTo(nr.x, nr.y); ctx.lineTo(nl.x, nl.y);
  ctx.closePath(); ctx.fill();

  ctx.strokeStyle = C.net; ctx.lineWidth = 1;
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    ctx.beginPath();
    ctx.moveTo(lerp(kl.x, kr.x, t), lerp(kl.y, kr.y, t));
    ctx.lineTo(lerp(nl.x, nr.x, t), lerp(nl.y, nr.y, t));
    ctx.stroke();
  }
  for (let j = 0; j <= 8; j++) {
    const t = j / 8;
    ctx.beginPath();
    ctx.moveTo(lerp(kl.x, nl.x, t), lerp(kl.y, nl.y, t));
    ctx.lineTo(lerp(kr.x, nr.x, t), lerp(kr.y, nr.y, t));
    ctx.stroke();
  }
  if (netHit && netHit.a > 0) {
    const p = cam.project(clamp(netHit.u, -GOAL_HALF_W + 0.2, GOAL_HALF_W - 0.2), backV + 0.3,
      clamp(netHit.h, 0.15, GOAL_H - 0.15));
    ctx.save();
    ctx.globalAlpha = clamp01(netHit.a);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 30 * netHit.a, 21 * netHit.a, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
    for (let r = 1; r <= 3; r++) {
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 10 * r * netHit.a, 7 * r * netHit.a, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(245,248,255,0.35)';
  for (let j = 0; j <= 4; j++) {
    const t = j / 4;
    ctx.beginPath(); ctx.moveTo(fl.x, lerp(fl.y, bl.y, t)); ctx.lineTo(kl.x, lerp(kl.y, nl.y, t)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fr.x, lerp(fr.y, br.y, t)); ctx.lineTo(kr.x, lerp(kr.y, nr.y, t)); ctx.stroke();
  }

  const postW = Math.max(4, Math.abs(bl.x - cam.project(-GOAL_HALF_W - 0.10, 0, 0).x));
  const bar = (a, b) => {
    ctx.strokeStyle = C.ink; ctx.lineWidth = postW + 4;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = C.post; ctx.lineWidth = postW;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  };
  bar(kl, kr); bar(fl, kl); bar(fr, kr);
  bar(bl, fl); bar(br, fr); bar(fl, fr);
}

function drawBall(ctx, cam, u, v, h, spin) {
  const sh = cam.project(u, v, 0);
  const k = cam.scaleAt(u, v);
  ctx.fillStyle = C.shadow;
  ctx.beginPath(); ctx.ellipse(sh.x, sh.y, BALL_R * k * 1.5, BALL_R * k * 0.5, 0, 0, TAU); ctx.fill();
  const p = cam.project(u, v, h);
  const r = Math.max(3, BALL_R * k);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(spin);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.34, 0, TAU); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const a = i * TAU / 5;
    ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72, r * 0.2, 0, TAU); ctx.fill();
  }
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.strokeStyle = C.ink;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  ctx.restore();
}

/**
 * Scheitel der Retro-Figur in Einheiten der Rumpfeinheit `bodyH`: Beine bis
 * 0,46 · Rumpf bis 0,97 · Kopfmitte bei 1,053 · Haaransatz-Oberkante bei
 * 1,1717. Ohne diesen Teiler stünde bei `height = WALL_MAN_H = 1,85 m` ein
 * 2,17 m großer Mann auf dem Schirm, während `mauerTreffer` nur bis 1,85 m
 * (plus Ballradius) blockt – der Ball ginge sichtbar durch die Köpfe und würde
 * trotzdem als „über die Mauer" abgerechnet. Das Tor wird mit der echten
 * GOAL_H gezeichnet, der Maßstab muss also bei den Figuren stimmen.
 * Die schräg erhobenen Arme der Mauerpose ragen noch 0,030·bodyH über diesen
 * Scheitel hinaus: bei 1,85 m Sollhöhe wird die Figur also 1,898 m hoch, während
 * `mauerTreffer` bis 1,85 m blockt. Die 4,8 cm liegen unter einem halben
 * Ballradius; nachgemessen mit einer Zeichenattrappe, die translate/rotate
 * mitführt (Figur 'stand': 1,8199 m bei Sollhöhe 1,82 m).
 */
const FIGUR_SCHEITEL = 1.1717;
/** Dasselbe für den Torwart (kein Haaransatz, andere Beinlänge). */
const KEEPER_SCHEITEL = 1.1428;

/**
 * Retro-Figur (Feldspieler). pose: 'stand' | 'lauf' | 'schuss' | 'mauer'
 * jump = zusätzliche Höhe in Metern (Mauersprung).
 * Der Bodenschatten liegt immer am Boden (Nachtrag §5) – auch im Sprung.
 */
function drawFigure(ctx, host, player, cam, u, v, opts) {
  const o = opts || {};
  if (USE_HOST_PLAYER && typeof host.drawPlayer === 'function' && (o.pose === 'stand' || o.pose === 'lauf')) {
    try {
      const k = cam.scaleAt(u, v);
      const p = cam.project(u, v, 0);
      host.drawPlayer(ctx, player, p.x, p.y, (1.82 * k) / HOST_PLAYER_SCALE_UNIT,
        { pose: o.pose, dir: o.dir || 1, frame: o.frame || 0 });
      return;
    } catch (e) { /* Fallback unten */ }
  }
  const kit = o.kit || kitOf(player);
  const k = cam.scaleAt(u, v);
  const jump = o.jump || 0;
  const foot = cam.project(u, v, jump);
  // bodyH ist die Rumpfeinheit, NICHT die Körpergröße: `height` ist die
  // Scheitelhöhe, und die liegt bei FIGUR_SCHEITEL·bodyH.
  const bodyH = (o.height || 1.82) * k / FIGUR_SCHEITEL;
  const w = bodyH * 0.30;
  const swing = o.pose === 'lauf' ? Math.sin((o.frame || 0) * TAU) : (o.pose === 'schuss' ? 1 : 0);
  const armUp = o.pose === 'mauer' ? 1 : 0;

  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  const gr = cam.project(u, v, 0);
  ctx.fillStyle = C.shadow;
  ctx.beginPath();
  ctx.ellipse(gr.x, gr.y, w * (0.85 + jump * 0.25), w * (0.26 + jump * 0.06), 0, 0, TAU);
  ctx.fill();

  ctx.translate(foot.x, foot.y);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.6, bodyH * 0.028);
  ctx.strokeStyle = C.ink;

  const legH = bodyH * 0.46, legW = w * 0.34;
  const leg = (dx, rot) => {
    ctx.save(); ctx.translate(dx, -legH); ctx.rotate(rot);
    ctx.fillStyle = kit.socks;
    ctx.beginPath(); ctx.rect(-legW / 2, 0, legW, legH); ctx.fill(); ctx.stroke();
    ctx.restore();
  };
  leg(-w * 0.28, -swing * 0.5); leg(w * 0.28, swing * 0.7);

  ctx.fillStyle = kit.shorts;
  ctx.beginPath(); ctx.rect(-w * 0.55, -legH - bodyH * 0.17, w * 1.1, bodyH * 0.19); ctx.fill(); ctx.stroke();

  const torsoY = -legH - bodyH * 0.17;
  ctx.fillStyle = kit.primary;
  ctx.beginPath(); ctx.rect(-w * 0.58, torsoY - bodyH * 0.34, w * 1.16, bodyH * 0.35); ctx.fill(); ctx.stroke();
  if (o.stripe) {
    ctx.fillStyle = kit.secondary;
    ctx.beginPath(); ctx.rect(-w * 0.16, torsoY - bodyH * 0.34, w * 0.3, bodyH * 0.35); ctx.fill();
  }

  const armH = bodyH * 0.30, armW = w * 0.24;
  const arm = (dx, rot) => {
    ctx.save(); ctx.translate(dx, torsoY - bodyH * 0.31); ctx.rotate(rot);
    ctx.fillStyle = kit.primary;
    ctx.beginPath(); ctx.rect(-armW / 2, 0, armW, armH); ctx.fill(); ctx.stroke();
    ctx.restore();
  };
  // In der Mauer: Arme vor dem Schritt bzw. schützend vors Gesicht
  arm(-w * 0.68, armUp ? 2.5 : swing * 0.6 - 0.15);
  arm(w * 0.68, armUp ? -2.5 : -swing * 0.6 + 0.15);

  const headR = bodyH * 0.105;
  const app = (player && player.appearance) || {};
  ctx.fillStyle = SKIN_TONES[clamp(app.skin | 0, 0, 5)] || '#e6bd94';
  ctx.beginPath(); ctx.arc(0, torsoY - bodyH * 0.36 - headR * 0.6, headR, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = app.hairColor || '#2b1d14';
  ctx.beginPath();
  ctx.arc(0, torsoY - bodyH * 0.36 - headR * 0.75, headR * 0.98, Math.PI, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * Torwart mit Hechtsprung: dive = 0..1, side = -1|1.
 * 1,88 m ist seine Körpergröße – dieselbe, mit der `twParameter` seine
 * Reichweite rechnet.
 */
function drawKeeper(ctx, player, cam, u, dive, side, high) {
  const kit = keeperKit();
  const v = 0.4;
  const k = cam.scaleAt(u, v);
  const bodyH = 1.88 * k / KEEPER_SCHEITEL, w = bodyH * 0.32;
  const foot = cam.project(u, v, 0);
  const rot = side * dive * 1.1;
  const lift = dive * (high ? 0.8 : 0.28) * k;

  ctx.save();
  ctx.fillStyle = C.shadow;
  ctx.beginPath(); ctx.ellipse(foot.x, foot.y, w * (1.05 + dive * 0.4), w * 0.28, 0, 0, TAU); ctx.fill();
  ctx.translate(foot.x, foot.y - lift);
  ctx.rotate(rot);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.8, bodyH * 0.03);
  ctx.strokeStyle = C.ink;

  const legH = bodyH * 0.45, legW = w * 0.32;
  for (const s of [-1, 1]) {
    ctx.save(); ctx.translate(s * w * 0.28, -legH); ctx.rotate(s * dive * 0.45);
    ctx.fillStyle = kit.socks;
    ctx.beginPath(); ctx.rect(-legW / 2, 0, legW, legH); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = kit.shorts;
  ctx.beginPath(); ctx.rect(-w * 0.55, -legH - bodyH * 0.18, w * 1.1, bodyH * 0.2); ctx.fill(); ctx.stroke();
  const torsoY = -legH - bodyH * 0.18;
  ctx.fillStyle = kit.primary;
  ctx.beginPath(); ctx.rect(-w * 0.6, torsoY - bodyH * 0.33, w * 1.2, bodyH * 0.34); ctx.fill(); ctx.stroke();

  const armH = bodyH * (0.30 + dive * 0.16), armW = w * 0.26;
  for (const a of [{ dx: -w * 0.72, r: -0.3 - dive * 1.0 }, { dx: w * 0.72, r: 0.3 + dive * 1.0 }]) {
    ctx.save(); ctx.translate(a.dx, torsoY - bodyH * 0.29); ctx.rotate(a.r);
    ctx.fillStyle = kit.primary;
    ctx.beginPath(); ctx.rect(-armW / 2, 0, armW, armH); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.gold;
    ctx.beginPath(); ctx.rect(-armW * 0.7, armH - armW * 0.55, armW * 1.4, armW); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  const headR = bodyH * 0.105;
  const app = (player && player.appearance) || {};
  ctx.fillStyle = SKIN_TONES[clamp(app.skin | 0, 0, 5)] || '#e6bd94';
  ctx.beginPath(); ctx.arc(0, torsoY - bodyH * 0.35 - headR * 0.55, headR, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════════════════
   HUD
   ══════════════════════════════════════════════════════════════════════════ */

function panel(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill || C.beige;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + 1, y + h - 1); ctx.lineTo(x + 1, y + 1); ctx.lineTo(x + w - 1, y + 1); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.moveTo(x + w - 1, y + 1); ctx.lineTo(x + w - 1, y + h - 1); ctx.lineTo(x + 1, y + h - 1); ctx.stroke();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

function schriftart(size, bold) {
  return `${bold ? 'bold ' : ''}${size}px system-ui, -apple-system, sans-serif`;
}

function text(ctx, s, x, y, opts = {}) {
  ctx.save();
  ctx.font = schriftart(opts.size || 14, opts.bold);
  ctx.textAlign = opts.align || 'left';
  ctx.textBaseline = opts.baseline || 'middle';
  if (opts.shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(s, x + (opts.shadowOff || 2), y + (opts.shadowOff || 2));
  }
  ctx.fillStyle = opts.color || C.ink;
  ctx.fillText(s, x, y);
  ctx.restore();
}

/**
 * Passt einen Text in eine Breite ein: erst kleinere Schrift, dann kürzen.
 * Rückgabe { s, size, w }.  Das ist die Zeilenverwaltung aus Nachtrag §4a –
 * vorher wurden Trait-Hinweis und Phasenanweisung übereinander gezeichnet.
 */
function passeEin(ctx, s, maxW, size, bold, minSize) {
  const mn = minSize === undefined ? 11 : minSize;
  let sz = size;
  ctx.save();
  while (sz > mn) {
    ctx.font = schriftart(sz, bold);
    if (ctx.measureText(s).width <= maxW) { ctx.restore(); return { s, size: sz, w: ctx.measureText(s).width }; }
    sz -= 1;
  }
  ctx.font = schriftart(mn, bold);
  let t = s;
  if (ctx.measureText(t).width > maxW) {
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    t = t.length > 1 ? t + '…' : '';
  }
  const w = ctx.measureText(t).width;
  ctx.restore();
  return { s: t, size: mn, w };
}

function drawHud(ctx, w, info) {
  panel(ctx, 0, 0, w, 64, C.paper);
  const nr = info.actor.number ? `#${info.actor.number} ` : '';
  text(ctx, `${nr}${info.actor.shortName || info.actor.lastName || 'Schütze'}`, 14, 20, { bold: true, size: 19 });
  text(ctx, `${info.posName} · ${info.footName} · Standards ${info.std} · Technik ${info.tec}`, 14, 44,
    { size: 13, color: '#4a4034' });
  text(ctx, `${info.minute}. Minute · ${info.score}`, w / 2, 20, { bold: true, size: 19, align: 'center' });
  text(ctx, `${info.competition} · ${info.dist} m · Mauer: ${info.wall}`, w / 2, 44,
    { size: 13, align: 'center', color: '#4a4034' });
  text(ctx, `Schwierigkeit: ${info.difficultyName}`, w - 14, 20, { bold: true, size: 15, align: 'right', color: C.red });
  text(ctx, `Torwart: ${info.keeperName} (Reflexe ${info.keeperReflex})`, w - 14, 44,
    { size: 13, align: 'right', color: '#4a4034' });

  panel(ctx, 0, 64, w, 30, C.wood);

  /* --- Zeilenverwaltung: Trait-Hinweis links, Anweisung mittig, Uhr rechts.
         Die drei Bereiche werden gemessen und schließen sich gegenseitig aus. --- */
  const timerBreite = (info.timer !== null && info.timer !== undefined) ? 134 : 0;
  let x0 = 14;
  if (info.badge) {
    const b = passeEin(ctx, info.badge, Math.min(320, w * 0.34), 14, true, 10);
    if (b.s) {
      text(ctx, b.s, 14, 79, { bold: true, size: b.size, color: C.gold });
      x0 = 14 + b.w + 16;
    }
  }
  const x1 = w - 14 - timerBreite;
  if (info.hint && x1 - x0 > 40) {
    const h = passeEin(ctx, info.hint, x1 - x0, 15, true, 10);
    if (h.s) text(ctx, h.s, (x0 + x1) / 2, 79, { bold: true, size: h.size, align: 'center', color: C.beige });
  }
  if (timerBreite) {
    const bw = 120;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(w - bw - 14, 72, bw, 14);
    ctx.fillStyle = info.timer < 0.3 ? C.red : C.gold;
    ctx.fillRect(w - bw - 14, 72, bw * clamp01(info.timer), 14);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    ctx.strokeRect(w - bw - 14, 72, bw, 14);
  }
}

/** Waagerechter Balken mit Marker (Richtung / Effet). */
function drawHBar(ctx, x, y, w, h, marker, label, opts = {}) {
  panel(ctx, x - 8, y - 28, w + 16, h + 40, C.wood);
  text(ctx, label, x + w / 2, y - 15, { bold: true, size: 13, align: 'center', color: C.gold });
  ctx.fillStyle = '#2a2118';
  ctx.fillRect(x, y, w, h);
  if (opts.center) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + w / 2 - 2, y, 4, h);
  }
  if (opts.zone) {
    ctx.save();
    ctx.globalAlpha = opts.zoneAlpha === undefined ? 1 : opts.zoneAlpha;
    ctx.fillStyle = C.green;
    ctx.fillRect(x + w * opts.zone[0], y, w * (opts.zone[1] - opts.zone[0]), h);
    ctx.restore();
  }
  const mx = x + w * clamp01(marker);
  ctx.fillStyle = C.red;
  ctx.fillRect(mx - 3, y - 6, 6, h + 12);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.strokeRect(mx - 3, y - 6, 6, h + 12);
  ctx.strokeRect(x, y, w, h);
  if (opts.left) text(ctx, opts.left, x + 2, y + h + 14, { size: 12, color: C.beige });
  if (opts.right) text(ctx, opts.right, x + w - 2, y + h + 14, { size: 12, color: C.beige, align: 'right' });
}

/** Senkrechter Höhenbalken. `sicher = false` → Notfenster, andere Farbe. */
function drawVBar(ctx, x, y, w, h, value, label, zone, zoneAlpha, sicher) {
  panel(ctx, x - 8, y - 28, w + 16, h + 38, C.wood);
  text(ctx, label, x + w / 2, y - 15, { bold: true, size: 13, align: 'center', color: C.gold });
  ctx.fillStyle = '#2a2118';
  ctx.fillRect(x, y, w, h);
  if (zone && zoneAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha = zoneAlpha;
    ctx.fillStyle = sicher === false ? C.gold : C.green;
    ctx.fillRect(x, y + h * (1 - zone[1]), w, h * (zone[1] - zone[0]));
    ctx.restore();
  }
  const my = y + h * (1 - clamp01(value));
  ctx.fillStyle = C.red;
  ctx.fillRect(x - 6, my - 3, w + 12, 6);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.strokeRect(x - 6, my - 3, w + 12, 6);
  ctx.strokeRect(x, y, w, h);
  text(ctx, 'LATTE', x + w / 2, y - 2, { size: 11, align: 'center', color: C.beige });
  text(ctx, 'MAUER', x + w / 2, y + h + 12, { size: 11, align: 'center', color: C.beige });
}

function drawBanner(ctx, w, h, title, sub, color) {
  const bw = 600, bh = 120;
  const x = (w - bw) / 2, y = h * 0.33;
  ctx.save(); ctx.globalAlpha = 0.92;
  panel(ctx, x, y, bw, bh, color);
  ctx.restore();
  text(ctx, title, w / 2, y + 44, { bold: true, size: 44, align: 'center', color: '#ffffff', shadow: true, shadowOff: 3 });
  text(ctx, sub, w / 2, y + 92, { bold: true, size: 17, align: 'center', color: '#ffffff', shadow: true });
}

/* ══════════════════════════════════════════════════════════════════════════
   MINIGAME
   ══════════════════════════════════════════════════════════════════════════ */

export const minigame = {
  id: 'freistoss',
  kind: 'freistoss',
  title: 'Freistoß',
  instructions: 'Drei Klicks (oder [Leertaste]): erst die Abschussrichtung, dann die Höhe '
    + 'über die Mauer, zuletzt den Effet. Während des Flugs darfst du mit der Maus oder '
    + '[←]/[→] noch nachziehen. [ESC] überlässt der Simulation den Schuss.',

  async play(host, moment) {
    const canvas = host && host.canvas;
    const ctx = host && host.ctx;
    if (!canvas || !ctx) return null;

    const rng = host.rng || createRng(19740707);
    const W = canvas.width || CANVAS_W;
    const H = canvas.height || CANVAS_H;
    const diff = (host.difficulty && typeof host.difficulty.minigame === 'number') ? host.difficulty.minigame : 1;
    const diffName = (host.difficulty && host.difficulty.name) || 'Profi';
    const actor = moment.actor || { shortName: 'Schütze', attributes: {} };
    const keeper = moment.keeper || { shortName: 'Torwart', attributes: { reflexe: 60, stellungsspiel: 58, sprungkraft: 58 } };
    const defenders = Array.isArray(moment.defenders) ? moment.defenders : [];
    // Klangnamen aus dem Vertrag von render/sound.js. Der zweite Parameter geht
    // unverändert an die Klangbank durch ({ lautstaerke, hoehe, panorama }).
    const sound = (n, o) => { try { if (typeof host.sound === 'function') host.sound(n, o); } catch (e) { /* egal */ } };

    /** Was am Ende des Fluges zu hören ist – je Ausgang genau ein Klang. */
    const AUSGANG_KLANG = {
      tor: ['tor', null],
      parade: ['parade', null],
      latte: ['pfosten', { hoehe: 1.12 }],
      pfosten: ['pfosten', null],
      daneben: ['raunen', { lautstaerke: 0.9 }]
    };

    /* ---- Szene aufbauen (DOM-frei, siehe modell.baueSzene) ---------------- */
    const szene = baueSzene(moment, { rng });
    const { ballU, ballV, D, skill, isSpecialist, flight, wall, wallCount } = szene;

    const cam = makeCamera(ballU, ballV, W, H);

    /* ---- Skill-abhängige Fenster & Tempi ---------------------------------- */
    const aimSpan = szene.aimSpan;
    const curveMax = szene.curveMax;
    const speedF = (base) => balkenPeriode(base, skill) / clamp(diff, 0.6, 1.7);
    const dirPeriod = speedF(DIR_PERIOD_MS);
    const hgtPeriod = speedF(HGT_PERIOD_MS);
    const crvPeriod = speedF(CRV_PERIOD_MS);
    // Sichtbarkeit des sicheren Höhenfensters – der eigentliche „Standards"-Bonus.
    const hintAlpha = isSpecialist ? 1
      : clamp01((att(actor, 'standards') - WINDOW_HINT_FROM) / (WINDOW_HINT_FULL - WINDOW_HINT_FROM)) * 0.85;
    // Länge der Flugbahn-Vorschau (0..1): schlechte Schützen sehen fast nichts.
    const previewLen = clamp01(0.22 + skill * 0.55 + (isSpecialist ? 0.22 : 0));

    const kit = kitOf(actor);
    const oppKit = kitOf(defenders[0] || keeper);
    const crowd = makeCrowd(rng, W, cam.cy, rangFarben(moment));

    const hudBase = {
      actor,
      posName: actor.position || 'ZM',
      footName: actor.foot === 'links' ? 'linker Fuß' : actor.foot === 'beidfüßig' ? 'beidfüßig' : 'rechter Fuß',
      std: att(actor, 'standards'), tec: att(actor, 'technik'),
      minute: moment.minute != null ? moment.minute : (moment.context && moment.context.minute) || 0,
      score: (moment.context && moment.context.score) ? `${moment.context.score[0]}:${moment.context.score[1]}` : '0:0',
      competition: (moment.context && moment.context.competition) || 'Freundschaftsspiel',
      dist: Math.round(D), wall: `${wallCount} Mann`,
      difficultyName: diffName,
      keeperName: keeper.shortName || keeper.lastName || 'Torwart',
      keeperReflex: att(keeper, 'reflexe'),
      badge: isSpecialist
        ? `${TRAITS.freistossspezialist.icon} ${TRAITS.freistossspezialist.name}: mehr Effet`
        : (att(actor, 'standards') < 55 ? '⚠ Kein Standardspezialist' : '')
    };

    return new Promise((resolve) => {
      /* ---- Zustand -------------------------------------------------------- */
      let finished = false, raf = 0;
      const tStart = performance.now();
      let lastFrame = tStart;
      let phase = 'intro';
      let phaseStart = tStart;
      const dirPhase = rng.float(0, 1), hgtPhase = rng.float(0, 1), crvPhase = rng.float(0, 1);
      let dirMark = 0.5, hgtMark = 0.5, crvMark = 0.5;
      let steer = 0, basisSpin = 0;
      let lastPointerX = null;
      let flightT = 0, ballSpin = 0, mauerGeprueft = false;
      let animMs = ANIM_MIN_MS;
      let result = null;                 // { outcome, quality, xgDelta, endU, endH }
      let plan = null;                   // Torwartplan
      let blockedAt = null;              // Weltpunkt des Mauertreffers
      let netHit = { u: 0, h: 0, a: 0 };
      let hFenster = szene.hFenster;      // { fenster, vzBand, vzMax, sicher, grund }
      const prevCursor = canvas.style.cursor;

      // Zwei wiederverwendete Eingabeobjekte: einer für den Schuss, einer für
      // die Vorschau. In der rAF-Schleife wird damit nichts erzeugt.
      const ein = makeEingabe();
      const einVor = makeEingabe();

      function detach() {
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerdown', onDown);
        window.removeEventListener('keydown', onKey);
        canvas.style.cursor = prevCursor;
      }
      function done(res) {
        if (finished) return;
        finished = true;
        if (raf) cancelAnimationFrame(raf);
        detach();
        resolve(res);
      }
      function bailout() {
        const r = result || { outcome: 'geblockt', quality: 0.30, xgDelta: -0.05 };
        done({ outcome: r.outcome, quality: r.quality, targetPlayerId: null, xgDelta: r.xgDelta });
      }

      /* ---- Eingabe -------------------------------------------------------- */
      function onMove(ev) {
        const r = canvas.getBoundingClientRect();
        const sx = (ev.clientX - r.left) * (W / Math.max(1, r.width));
        if (phase === 'flug' && flightT < STEER_UNTIL && flightT > 0) {
          if (lastPointerX !== null) {
            steer = clamp(steer + (sx - lastPointerX) * STEER_PER_PX, -STEER_MAX, STEER_MAX);
          }
        }
        lastPointerX = sx;
      }
      function press() {
        if (phase === 'richtung') {
          ein.aimU = (dirMark - 0.5) * 2 * aimSpan;
          setPhase('hoehe');
          sound('klick');
        } else if (phase === 'hoehe') {
          ein.vz = vzAusBalken(hFenster, hgtMark);
          setPhase('effet');
          sound('klick');
        } else if (phase === 'effet') {
          ein.spin = (crvMark - 0.5) * 2 * curveMax;
          ein.kFac = knuckleFaktor(crvMark, skill);
          setPhase('flug');
          sound('schuss');
        }
      }
      function onDown(ev) { ev.preventDefault(); press(); }
      function onKey(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); done(null); return; }
        if ((ev.key === ' ' || ev.key === 'Enter') && !ev.repeat) { ev.preventDefault(); press(); }
        if (phase === 'flug' && flightT < STEER_UNTIL) {
          const s = STEER_MAX * 0.19;
          if (ev.key === 'ArrowLeft') { steer = clamp(steer - s, -STEER_MAX, STEER_MAX); ev.preventDefault(); }
          if (ev.key === 'ArrowRight') { steer = clamp(steer + s, -STEER_MAX, STEER_MAX); ev.preventDefault(); }
        }
      }
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerdown', onDown);
      window.addEventListener('keydown', onKey);
      canvas.style.cursor = 'crosshair';

      function setPhase(p) {
        phase = p;
        phaseStart = performance.now();
        if (p === 'hoehe') {
          // Das Höhenfenster gilt für die JETZT festliegende Richtung. Ist es
          // leer, hebt fensterFuer VZ_MAX szenenweise an (Fenster-Garantie).
          hFenster = fensterFuer(szene, ein.aimU);
        } else if (p === 'flug') {
          flightT = 0; blockedAt = null; basisSpin = ein.spin; mauerGeprueft = false;
          // EINE Uhr: Anzeigedauer und Torwart hängen an derselben Flugzeit.
          const fl = flight.bahn(ein);
          animMs = clamp(fl.T * 1000 * SLOWMO, ANIM_MIN_MS, ANIM_MAX_MS);
          const e = flight.zustand(1, ein, _zA);
          const startU = -wall.sign * KEEPER_START_U;
          // Der Plan wird beim Abschuss gezogen – Nachziehen täuscht den Keeper.
          plan = planeTorwart(rng, keeper, fl.T, e.u, e.h, e.u - ein.aimU, ein.kFac, startU, diff);
        }
      }

      /* ---- Auflösung ------------------------------------------------------- */
      /** Gesamtdrall inkl. Nachziehen – `ein.spin` führt ihn bereits mit. */
      function spinJetzt() { return ein.spin; }

      function ballState(t, out) {
        return flight.zustand(t, ein, out || _zA);
      }

      /** Mauercheck exakt an der Mauerebene, pro Mauerspieler. */
      function checkWall() {
        const tr = mauerTreffer(szene, ein);
        if (tr) { blockedAt = tr; return true; }
        return false;
      }

      function finishFlight() {
        result = loeseTorlinie(szene, ein, plan, rng, diff);
        netHit = { u: result.endU, h: result.endH, a: 0 };
        // Vorher klang ein Ball, der zehn Meter über die Latte segelte, nach
        // Aluminium. Jetzt klingt jeder Ausgang nach dem, was er ist.
        const klang = AUSGANG_KLANG[result.outcome];
        if (klang) sound(klang[0], klang[1]);
        if (result.outcome === 'latte' || result.outcome === 'pfosten') {
          sound('raunen', { lautstaerke: 0.85, verzoegerung: 0.3 });
        }
      }

      function resolveBlocked() {
        result = loeseBlock(szene, ein, blockedAt);
        sound('block');
      }

      /* ---- Vorschau der Flugbahn (Skill-abhängig lang) ---------------------- */
      function drawPreview(ctx2, spin, aimU, vzWert, maxT) {
        einVor.aimU = aimU; einVor.vz = vzWert; einVor.spin = spin; einVor.kFac = 0;
        ctx2.save();
        ctx2.setLineDash([6, 6]);
        ctx2.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx2.lineWidth = 2.5;
        ctx2.beginPath();
        const steps = 26;
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * maxT;
          const z = flight.zustand(t, einVor, _zC);
          const p = cam.project(z.u, z.v, Math.max(0, z.h));
          if (i === 0) ctx2.moveTo(p.x, p.y); else ctx2.lineTo(p.x, p.y);
        }
        ctx2.stroke();
        ctx2.restore();
      }

      /* ---- Hauptschleife ---------------------------------------------------- */
      function frame(now) {
        raf = requestAnimationFrame(frame);
        if (finished) return;
        if (now - tStart > HARD_TIMEOUT_MS) { bailout(); return; }

        const dt = Math.min(0.10, Math.max(0, (now - lastFrame) / 1000));
        lastFrame = now;
        const tSec = (now - tStart) / 1000;
        const pt = now - phaseStart;
        let timer = null;

        /* --- Phasenlogik --- */
        if (phase === 'intro') {
          if (pt > INTRO_MS) setPhase('richtung');
        } else if (phase === 'richtung') {
          const tri = ((pt / dirPeriod) + dirPhase) % 1;
          dirMark = tri < 0.5 ? tri * 2 : 2 - tri * 2;
          timer = 1 - pt / DIR_LIMIT_MS;
          if (pt > DIR_LIMIT_MS) { ein.aimU = (dirMark - 0.5) * 2 * aimSpan; setPhase('hoehe'); }
        } else if (phase === 'hoehe') {
          const tri = ((pt / hgtPeriod) + hgtPhase) % 1;
          hgtMark = tri < 0.5 ? tri * 2 : 2 - tri * 2;
          timer = 1 - pt / HGT_LIMIT_MS;
          if (pt > HGT_LIMIT_MS) { ein.vz = vzAusBalken(hFenster, hgtMark); setPhase('effet'); }
        } else if (phase === 'effet') {
          const tri = ((pt / crvPeriod) + crvPhase) % 1;
          crvMark = tri < 0.5 ? tri * 2 : 2 - tri * 2;
          timer = 1 - pt / CRV_LIMIT_MS;
          if (pt > CRV_LIMIT_MS) {
            ein.spin = (crvMark - 0.5) * 2 * curveMax;
            ein.kFac = knuckleFaktor(crvMark, skill);
            setPhase('flug');
          }
        } else if (phase === 'flug') {
          flightT = clamp01((pt - RUNUP_MS) / animMs);
          if (flightT < STEER_UNTIL) ein.spin = basisSpin + steer;
          // Der Mauerdurchgang wird über eine Marke geprüft, nicht über den
          // Zeitvergleich zweier Bilder: das Nachziehen ändert tWallFrac, und ein
          // Rückwärtssprung würde die Prüfung sonst still überspringen.
          const wt = flight.bahn(ein).tWallFrac;
          if (!mauerGeprueft && !result && flightT >= wt) {
            mauerGeprueft = true;
            if (checkWall()) resolveBlocked();
          }
          if (!result && flightT >= 1) finishFlight();
          if (pt > RUNUP_MS + animMs + 700) setPhase('ergebnis');
        } else if (phase === 'ergebnis') {
          if (!result) { bailout(); return; }
          if (pt > RESULT_MS) {
            done({
              outcome: result.outcome,
              quality: result.quality,
              targetPlayerId: null,
              xgDelta: result.xgDelta
            });
            return;
          }
        }

        // Skalare kopieren: `flight` ist EIN Objekt, die Vorschau überschreibt es.
        const flT = flight.bahn(ein).T;
        const flWallFrac = flight.tWallFrac;
        const tReal = clamp01(flightT) * flT;      // EINE Uhr für alles

        /* --- Zeichnen --- */
        ctx.save();
        ctx.clearRect(0, 0, W, H);
        drawStands(ctx, cam, W, crowd, tSec);
        drawPitch(ctx, cam, W, H);
        drawGoal(ctx, cam, netHit);

        // Torwart – Weg und Anzeige aus derselben Funktion (ballistik.twReichweite)
        let kU = -wall.sign * KEEPER_START_U + Math.sin(tSec * 2.0) * 0.22;
        let kDive = 0, kSide = 1, kHigh = false;
        if (plan) {
          const tw = phase === 'ergebnis' ? flT + 0.20 : tReal;   // 200 ms Nachschwung
          kU = torwartU(plan, tw);
          kDive = clamp01((tw - plan.reactS) / Math.max(0.08, flT - plan.reactS));
          kSide = plan.side;
          kHigh = plan.zielH > 1.4;
        }
        drawKeeper(ctx, keeper, cam, kU, kDive, kSide, kHigh);

        // Ball vor oder hinter der Mauer? Korrekte Tiefensortierung.
        const b = (phase === 'flug' || phase === 'ergebnis') ? ballState(clamp01(flightT), _zA) : null;
        const ballBehindWall = b && b.v < wall.v;

        if (b && ballBehindWall) drawBallNow(b);
        drawWall();
        if (b && !ballBehindWall) drawBallNow(b);
        if (!b) drawBall(ctx, cam, ballU, ballV, BALL_H0, 0);

        function drawWall() {
          const tMs = (phase === 'flug' || phase === 'ergebnis') ? tReal * 1000 : 0;
          for (let i = 0; i < wallCount; i++) {
            const p = defenders[i] || null;
            drawFigure(ctx, host, p, cam, wall.manU(i), wall.v, {
              pose: 'mauer', kit: oppKit, height: WALL_MAN_H,
              jump: wallFeet(tMs, szene.jumpStarts[i], szene.wallJump), stripe: true
            });
          }
        }
        function drawBallNow(bb) {
          // Drall sichtbar: zeitbasiert, der Flatterball steht fast still.
          const omega = TAU * lerp(1.0, 10.0, clamp01(Math.abs(spinJetzt()) / Math.max(1, curveMax)));
          ballSpin += omega * dt;
          if (result && result.outcome === 'geblockt' && blockedAt) {
            // Abpraller von der Mauer zurück ins Feld
            const a = clamp01((flightT - flWallFrac) * 2.2);
            drawBall(ctx, cam, blockedAt.u - wall.sign * 1.2 * a,
              blockedAt.v + 5.5 * a, Math.max(0.14, blockedAt.h + 0.4 * a - 1.6 * a * a), ballSpin);
          } else if (flightT >= 1 && result) {
            const a = phase === 'ergebnis' ? 1 : clamp01((pt - RUNUP_MS - animMs) / 700);
            if (result.outcome === 'tor') {
              netHit.a = Math.min(1, netHit.a + dt / 0.12);
              drawBall(ctx, cam, result.endU * 0.92, lerp(0, -1.7, easeOut(a)),
                Math.max(0.12, result.endH * (1 - easeIn(a) * 0.8)), ballSpin);
            } else if (result.outcome === 'parade') {
              const s = result.endU >= 0 ? 1 : -1;
              drawBall(ctx, cam, result.endU + s * 3.6 * a, lerp(0, 5.0, a),
                Math.max(0.15, result.endH + 0.4 * a - 1.3 * a * a), ballSpin);
            } else if (result.outcome === 'latte' || result.outcome === 'pfosten') {
              drawBall(ctx, cam, result.endU * (1 - a * 0.4), lerp(0, 6.0, a),
                Math.max(0.15, result.endH + 0.35 * a - 1.8 * a * a), ballSpin);
            } else {
              drawBall(ctx, cam, result.endU * (1 + a * 0.2), lerp(0, -4.0, a),
                Math.max(0.1, result.endH + 0.3 * a - 0.8 * a * a), ballSpin);
            }
          } else {
            drawBall(ctx, cam, bb.u, bb.v, Math.max(0.05, bb.h), ballSpin);
          }
        }

        // Schütze
        const runT = (phase === 'flug' || phase === 'ergebnis')
          ? (phase === 'ergebnis' ? 1 : clamp01(pt / RUNUP_MS)) : 0;
        const shooterSide = ballU >= 0 ? -1 : 1;
        const sU = ballU + shooterSide * lerp(1.9, 0.55, easeIn(runT));
        const sV = ballV + lerp(2.4, 0.5, easeIn(runT));
        drawFigure(ctx, host, actor, cam, sU, sV, {
          pose: runT === 0 ? 'stand' : (runT < 1 ? 'lauf' : 'schuss'),
          frame: runT * 2.5, kit, alpha: flightT > 0.12 ? 0.5 : 1
        });

        /* --- Zielhilfen --- */
        if (phase === 'richtung') {
          const u = (dirMark - 0.5) * 2 * aimSpan;
          const top = cam.project(u, 0, 2.9), bot = cam.project(u, 0, 0);
          ctx.save();
          ctx.strokeStyle = C.red; ctx.lineWidth = 4;
          ctx.setLineDash([9, 7]);
          ctx.beginPath(); ctx.moveTo(bot.x, bot.y); ctx.lineTo(top.x, top.y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = C.gold;
          ctx.beginPath();
          ctx.moveTo(top.x, top.y - 16); ctx.lineTo(top.x - 11, top.y - 34); ctx.lineTo(top.x + 11, top.y - 34);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = C.ink; ctx.lineWidth = 2.5; ctx.stroke();
          ctx.restore();
        } else if (phase === 'hoehe') {
          drawPreview(ctx, 0, ein.aimU, vzAusBalken(hFenster, hgtMark), previewLen);
        } else if (phase === 'effet') {
          drawPreview(ctx, (crvMark - 0.5) * 2 * curveMax, ein.aimU, ein.vz, previewLen);
        }

        /* --- Balken --- */
        if (phase === 'richtung') {
          drawHBar(ctx, 250, H - 46, 460, 24, dirMark, 'RICHTUNG – Abschusswinkel',
            { center: true, left: 'links', right: 'rechts' });
        } else if (phase === 'hoehe') {
          drawVBar(ctx, W - 68, 190, 38, 250, hgtMark, 'HÖHE', hFenster.fenster, hintAlpha, hFenster.sicher);
        } else if (phase === 'effet') {
          drawHBar(ctx, 250, H - 46, 460, 24, crvMark, 'EFFET – Krümmung um die Mauer',
            { center: true, left: '↶ links', right: 'rechts ↷' });
        } else if (phase === 'flug' && flightT < STEER_UNTIL) {
          drawHBar(ctx, 330, H - 46, 300, 20, 0.5 + steer / (STEER_MAX * 2), 'NACHZIEHEN – Maus bewegen!',
            { center: true });
        }

        // Statusleiste mit den bereits gesetzten Werten
        if (phase !== 'intro') {
          panel(ctx, 12, H - 76, 214, 62, C.paper);
          text(ctx, `Richtung: ${phase === 'richtung' ? '…' : (ein.aimU >= 0 ? '+' : '') + ein.aimU.toFixed(1) + ' m'}`,
            22, H - 60, { size: 13, bold: true });
          text(ctx, `Höhe: ${phase === 'richtung' || phase === 'hoehe' ? '…' : ein.vz.toFixed(1) + ' m/s'}`,
            22, H - 42, { size: 13, bold: true });
          text(ctx, `Effet: ${phase === 'flug' || phase === 'ergebnis'
            ? (spinJetzt() >= 0 ? '+' : '') + spinJetzt().toFixed(0) + ' rad/s' : '…'}`,
            22, H - 24, { size: 13, bold: true });
        }

        /* --- HUD --- */
        const hints = {
          intro: `Freistoß aus ${Math.round(D)} Metern – ${wallCount} Mann in der Mauer.`,
          richtung: 'KLICK/[LEERTASTE]: Abschussrichtung festlegen (der Effet biegt ihn noch!)',
          hoehe: hFenster.sicher
            ? 'KLICK: Höhe wählen – über die Mauer, aber unter die Latte!'
            : hFenster.grund === 'entfernung'
              ? 'Aus dieser Entfernung kommt er über die Mauer nicht mehr runter – such den Weg außen herum!'
              : 'Diese Richtung zeigt in die Mauer – gelb = wenigstens aufs Tor, den Rest macht der Effet!',
          effet: 'KLICK: Effet festlegen – die gestrichelte Linie zeigt die Bahn',
          flug: flightT < STEER_UNTIL ? 'Maus bewegen: den Ball noch ein wenig nachziehen!' : 'Der Ball fliegt …',
          ergebnis: ''
        };
        drawHud(ctx, W, Object.assign({}, hudBase, { hint: hints[phase] || '', timer }));

        if (phase === 'ergebnis' && result) {
          const r = RESULT_TEXT[result.outcome] || RESULT_TEXT.daneben;
          drawBanner(ctx, W, H, r.title, r.sub, r.color);
          text(ctx, `Ausführung: ${Math.round(result.quality * 100)} %`, W / 2, H * 0.33 + 138,
            { bold: true, size: 16, align: 'center', color: '#ffffff', shadow: true });
        }
        ctx.restore();
      }

      raf = requestAnimationFrame(frame);
    });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   PRÜFEXPORT (Vertrag §9, additiv) – DOM-frei, rng immer als Parameter
   ══════════════════════════════════════════════════════════════════════════ */

export const modell = {
  baueSzene,
  fensterFuer,
  /** Nachfolger von safeLoftWindow() – gleiche Aufgabe, jetzt richtungsabhängig. */
  safeLoftWindow: fensterFuer,
  vzAusBalken,
  loeseSchuss,
  planeTorwart,
  parade,
  mauerTreffer,
  knuckleFaktor,
  shooterSkill,
  makeEingabe,
  wallFeet,
  balkenPeriode,
  lupeAnteil,

  /**
   * Bedienzeit des grünen Höhenfensters in ms: die Zeit, die der Marker bei
   * EINEM Durchlauf über den Balken im Grünen steht. Ein Durchlauf ist eine
   * halbe Balkenperiode (Dreieckschwingung). `diff` ist die Schwierigkeit.
   */
  bedienzeitMs(szene, fenster, diff) {
    const periode = balkenPeriode(HGT_PERIOD_MS, szene.skill) / clamp(diff === undefined ? 1 : diff, 0.6, 1.7);
    return (fenster.fenster[1] - fenster.fenster[0]) * periode / 2;
  },

  /** Flugzeit in Sekunden bis zur Torlinie. */
  flugzeit(szene, aimU, vz, spin) {
    const e = makeEingabe();
    e.aimU = aimU; e.vz = vz; e.spin = spin || 0;
    return szene.flight.bahn(e).T;
  },

  /** Seitliche Ablage durch den Effet: Endpunkt mit Drall minus Endpunkt ohne. */
  ablage(szene, aimU, vz, spin) {
    const e = makeEingabe();
    e.aimU = aimU; e.vz = vz; e.spin = 0;
    const ohne = szene.flight.zustand(1, e, _zB).u;
    e.spin = spin;
    const mit = szene.flight.zustand(1, e, _zC).u;
    return mit - ohne;
  },

  /** Geschwindigkeit am Abschuss und an der Torlinie (m/s). */
  tempoVerlauf(szene, aimU, vz, spin) {
    const e = makeEingabe();
    e.aimU = aimU; e.vz = vz; e.spin = spin || 0;
    const a = szene.flight.zustand(0, e, _zB).vBetrag;
    const b = szene.flight.zustand(1, e, _zC).vBetrag;
    return { start: a, ende: b };
  },

  /** Reichweite des Torworts nach tFlug Sekunden auf Zielhöhe. */
  twReichweiteBei(tFlug, hoehe, keeper) {
    const reflex = att(keeper, 'reflexe', 55);
    const stellung = att(keeper, 'stellungsspiel', 55);
    const par = twParameter({
      reflexe: reflex, antizipation: stellung,
      sprungkraft: att(keeper, 'sprungkraft', 55), groesse: 1.88
    });
    par.tReakt = Math.max(0.09, (lerp(KEEPER_REACT_MS_SLOW, KEEPER_REACT_MS_FAST, clamp01(reflex / 99))
      - lerp(0, KEEPER_ANTIZ_MS, clamp01(stellung / 99))) / 1000);
    return twReichweite(par, tFlug, hoehe);
  },

  /** Anzeigedauer des Flugs (ms) – daraus folgt das Nachziehfenster. */
  animDauerMs(tFlug) { return clamp(tFlug * 1000 * SLOWMO, ANIM_MIN_MS, ANIM_MAX_MS); },
  nachziehFensterMs(tFlug) { return this.animDauerMs(tFlug) * STEER_UNTIL; },

  konstanten: {
    GOAL_HALF_W, GOAL_H, WALL_DIST, WALL_MAN_H, WALL_JUMP, WALL_JUMP_NAH,
    NAH_BIS, SPIN_TOP_NAH,
    V0_MIN, V0_MAX, SPIN_SIDE_MAX, SPIN_TOP_MIN, SPIN_TOP_MAX,
    VZ_MIN, VZ_MAX, VZ_RAISE_STEP, VZ_RAISE_MAX, WINDOW_MIN_FRAC, FENSTER_MIN_MS,
    STEER_MAX, STEER_UNTIL, SLOWMO, ANIM_MIN_MS, ANIM_MAX_MS,
    AIM_SPAN_NEAR, AIM_SPAN_FAR, DIST_MIN, DIST_MAX,
    DIR_PERIOD_MS, HGT_PERIOD_MS, CRV_PERIOD_MS,
    KEEPER_REACT_MS_SLOW, KEEPER_REACT_MS_FAST, KEEPER_ANTIZ_MS,
    CAM_BACK, CAM_FOCAL, CAM_H, HORIZON_Y
  }
};

export default minigame;
