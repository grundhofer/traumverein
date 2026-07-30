/**
 * engine/tactics.js — Formationen, Spielstile, Rollen, Zusatzanweisungen und Aufstellungshilfe.
 *
 * Vertrag: docs/CONTRACTS.md Abschnitt 8 (und 5.3 für die Tactics-Struktur).
 *
 * KEINE DOM-Zugriffe, kein Math.random(), kein Date.now().
 *
 * ---------------------------------------------------------------------------
 * KOORDINATEN (Taktikbrett, siehe CONTRACTS 1.)
 *   x = 0 (linker Rand) … 100 (rechter Rand)   — aus Sicht des eigenen Teams
 *   y = 0 (eigenes Tor)  … 100 (gegnerisches Tor)
 *
 * SKALEN (einheitlich im ganzen Modul, damit Balancing leichtfällt)
 *   • Formations-Kennzahlen (defensivwert, offensivwert, breite, kompaktheit,
 *     risiko) sind 0..100-Werte. 50 = Bundesliga-Durchschnitt.
 *   • Stil-Mods `tempo`, `passLaenge`, `pressinghoehe`, `risiko` sind
 *     0..100-ZIELWERTE für die Slider. `sliders` des Spielers überschreiben sie
 *     (der Spieler hat immer das letzte Wort), der Stil liefert nur die Vorgabe.
 *   • Stil-Mods `chancenRate`, `gegenchancenRate`, `ausdauerkosten` sind
 *     MULTIPLIKATOREN um 1.0 herum (1.0 = neutral). engine/match.js multipliziert
 *     damit seine Basisraten.
 *   • Rollen-Mods `mods{attribut:faktor}` sind MULTIPLIKATOREN auf die
 *     Spielerattribute (1.0 = unverändert), `benoetigt{attribut:minWert}` sind
 *     absolute 1..99-Schwellen. Wer sie reißt, spielt die Rolle schlecht.
 *   • Rollen-/Anweisungs-`teamEffekt` sind ADDITIVE Punkte auf Team-Kennwerte
 *     (siehe TEAM_EFFECT_KEYS). engine/ratings.js summiert sie auf.
 * ---------------------------------------------------------------------------
 */

import { POSITION_AFFINITY, POSITION_NAMES, TRAITS } from '../core/constants.js';
import { clamp, round, avg, sortBy } from '../core/util.js';
import { playerRatingForSlot } from './ratings.js';

/* =========================================================================
 * BALANCING-KONSTANTEN — hier zuerst schrauben
 * ========================================================================= */

/** Kennwerte, die Rollen/Anweisungen additiv verändern dürfen. */
export const TEAM_EFFECT_KEYS = [
  'aufbau',              // Spielaufbau von hinten heraus
  'kreativitaet',        // Ideen im letzten Drittel
  'defensivstabilitaet', // Zugriff und Absicherung
  'konterwucht',         // Wucht im Umschaltmoment
  'flankenlast',         // wie viel über außen läuft
  'pressingwucht',       // Intensität beim Anlaufen
  'torgefahr',           // Abschlussvolumen
  'breite',              // Feldbreite
  'kompaktheit',         // Abstände zwischen den Ketten
  'kartenrisiko'         // Verwarnungsgefahr
];

/** Slider-Neutralwerte (CONTRACTS 5.3). */
export const DEFAULT_SLIDERS = Object.freeze({
  tempo: 50, breite: 50, pressinghoehe: 50, risiko: 50, haerte: 50, offensivdrang: 50
});

/** Ab dieser Fitness gilt ein Spieler als frisch genug für die Startelf. */
const FITNESS_OK = 78;
/** Ab dieser Fitness gibt es eine Warnung in validateTactics(). */
const FITNESS_WARN = 70;
/** Fitness, unterhalb derer autoLineup() einen Spieler praktisch aussortiert. */
const FITNESS_HARD_FLOOR = 45;

/** Gewichte für die Kandidatenbewertung in autoLineup(). */
const LINEUP_W = {
  fitness: 0.30,   // wie stark Fitness die Bewertung drückt (0 = egal)
  form: 0.12,      // Einfluss der Tagesform (form 0..100, 50 = neutral)
  moral: 0.06,     // Einfluss der Moral
  sharpness: 0.08, // Spielpraxis / Spritzigkeit
  rotation: 0.22,  // Zusatzgewicht auf Frische, wenn opts.rotation aktiv ist
  schonenMalus: 0.55 // Faktor auf die Bewertung geschonter Spieler
};

/** Wie viele Verbesserungsdurchläufe die Nachoptimierung höchstens macht. */
const OPTIMIZE_PASSES = 40;

/** Maximale Bankgröße (CONTRACTS 5.3: max 9). */
const MAX_BENCH = 9;

/** Ab welcher Positions-Affinität ein Spieler als "auf Position" gilt. */
const AFFINITY_OK = 0.72;
/** Darunter: deutliche Warnung "weit außer Position". */
const AFFINITY_BAD = 0.6;

/* =========================================================================
 * 1. FORMATIONEN
 * =========================================================================
 * Jede Formation hat GENAU 11 Slots (s1..s11), s1 ist immer der Torwart.
 * Zusätzliche Kennzahlen für Ratings, Co-Trainer und Konter-Matrix.
 */

/** Kleiner Helfer, damit die Slot-Listen unten kompakt bleiben. */
function S(id, pos, x, y) { return { id, pos, x, y }; }

/**
 * @typedef {object} Formation
 * @property {string} id
 * @property {string} name
 * @property {string} desc            deutsche Beschreibung
 * @property {Array}  slots           genau 11 × { id, pos, x, y }
 * @property {string[]} staerken
 * @property {string[]} schwaechen
 * @property {object} anforderungen   { attribut: minWert } — Kaderprofil-Bedarf
 * @property {number} risiko          0..100
 * @property {number} defensivwert    0..100
 * @property {number} offensivwert    0..100
 * @property {number} breite          0..100
 * @property {number} kompaktheit     0..100
 */

export const FORMATIONS = {

  '4-4-2': {
    id: '4-4-2', name: '4-4-2 Flach',
    desc: 'Der Klassiker. Zwei Viererketten, zwei Spitzen – jeder weiß, wo er steht. '
      + 'Kein Schnickschnack, dafür grundsolide und für jeden Kader spielbar.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 14, 24), S('s3', 'IV', 38, 20), S('s4', 'IV', 62, 20), S('s5', 'RV', 86, 24),
      S('s6', 'LM', 14, 52), S('s7', 'ZM', 38, 48), S('s8', 'ZM', 62, 48), S('s9', 'RM', 86, 52),
      S('s10', 'ST', 40, 80), S('s11', 'ST', 60, 80)
    ],
    staerken: ['Klare Zuordnung', 'Zwei Anspielstationen vorne', 'Gute Restverteidigung'],
    schwaechen: ['Zentrale Unterzahl gegen Dreier-Mittelfeld', 'Wenig Kreativität zwischen den Ketten'],
    anforderungen: { ausdauer: 60, zweikampf: 58 },
    risiko: 45, defensivwert: 60, offensivwert: 58, breite: 68, kompaktheit: 60
  },

  '4-4-2-raute': {
    id: '4-4-2-raute', name: '4-4-2 Raute',
    desc: 'Mittelfeldraute mit Sechser und Zehner. Zentral erdrückend, aber die '
      + 'Außenbahnen müssen die Verteidiger allein beackern.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 14, 24), S('s3', 'IV', 38, 20), S('s4', 'IV', 62, 20), S('s5', 'RV', 86, 24),
      S('s6', 'DM', 50, 38), S('s7', 'LM', 22, 52), S('s8', 'RM', 78, 52), S('s9', 'OM', 50, 64),
      S('s10', 'ST', 40, 82), S('s11', 'ST', 60, 82)
    ],
    staerken: ['Zentrale Überzahl', 'Kurze Passwege', 'Zehner findet Räume'],
    schwaechen: ['Flügel offen', 'Außenverteidiger laufen sich tot'],
    anforderungen: { ausdauer: 68, passspiel: 62, uebersicht: 60 },
    risiko: 55, defensivwert: 54, offensivwert: 66, breite: 38, kompaktheit: 72
  },

  '4-2-3-1': {
    id: '4-2-3-1', name: '4-2-3-1',
    desc: 'Die moderne Standardformation. Doppelsechs sichert ab, drei Offensive '
      + 'hinter der Spitze suchen die Lücken. Balance in Reinform.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 12, 26), S('s3', 'IV', 37, 20), S('s4', 'IV', 63, 20), S('s5', 'RV', 88, 26),
      S('s6', 'DM', 36, 40), S('s7', 'DM', 64, 40),
      S('s8', 'LA', 15, 64), S('s9', 'OM', 50, 62), S('s10', 'RA', 85, 64),
      S('s11', 'ST', 50, 84)
    ],
    staerken: ['Sehr ausgewogen', 'Doppelsechs schützt die Kette', 'Viele Umschaltoptionen'],
    schwaechen: ['Einzelspitze wird isoliert', 'Braucht einen echten Zehner'],
    anforderungen: { passspiel: 60, positionsspiel: 60 },
    risiko: 48, defensivwert: 64, offensivwert: 64, breite: 62, kompaktheit: 66
  },

  '4-3-3': {
    id: '4-3-3', name: '4-3-3',
    desc: 'Breites Angriffstrio, dahinter ein Dreier-Mittelfeld. Wer Flügelflitzer '
      + 'im Kader hat, zieht die gegnerische Abwehr damit auseinander.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 12, 26), S('s3', 'IV', 37, 20), S('s4', 'IV', 63, 20), S('s5', 'RV', 88, 26),
      S('s6', 'DM', 50, 40), S('s7', 'ZM', 30, 52), S('s8', 'ZM', 70, 52),
      S('s9', 'LA', 14, 76), S('s10', 'ST', 50, 84), S('s11', 'RA', 86, 76)
    ],
    staerken: ['Maximale Feldbreite', 'Hohes Pressing möglich', 'Dreier-Mittelfeld'],
    schwaechen: ['Große Räume hinter den Außenverteidigern', 'Anfällig für schnelle Konter'],
    anforderungen: { tempo: 66, ausdauer: 66, dribbling: 62 },
    risiko: 60, defensivwert: 55, offensivwert: 72, breite: 82, kompaktheit: 52
  },

  '4-1-4-1': {
    id: '4-1-4-1', name: '4-1-4-1',
    desc: 'Ein Sechser als Staubsauger, davor eine kompakte Viererreihe. Der '
      + 'Sicherheitsgurt für schwere Auswärtsspiele – ohne komplett zu mauern.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 12, 26), S('s3', 'IV', 37, 20), S('s4', 'IV', 63, 20), S('s5', 'RV', 88, 26),
      S('s6', 'DM', 50, 38),
      S('s7', 'LM', 14, 58), S('s8', 'ZM', 38, 56), S('s9', 'ZM', 62, 56), S('s10', 'RM', 86, 58),
      S('s11', 'ST', 50, 82)
    ],
    staerken: ['Zwei kompakte Reihen', 'Sechser räumt vor der Kette auf', 'Schwer zu bespielen'],
    schwaechen: ['Stürmer allein auf weiter Flur', 'Wenig Präsenz im Strafraum'],
    anforderungen: { ausdauer: 66, positionsspiel: 62, zweikampf: 60 },
    risiko: 38, defensivwert: 70, offensivwert: 52, breite: 66, kompaktheit: 72
  },

  '4-5-1': {
    id: '4-5-1', name: '4-5-1',
    desc: 'Fünf Mann im Mittelfeld, einer vorne. Der Gegner soll sich am dichten '
      + 'Zentrum die Zähne ausbeißen. Nichts für Freunde des Offensivspektakels.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 12, 24), S('s3', 'IV', 37, 19), S('s4', 'IV', 63, 19), S('s5', 'RV', 88, 24),
      S('s6', 'LM', 12, 50), S('s7', 'ZM', 31, 46), S('s8', 'ZM', 50, 44), S('s9', 'ZM', 69, 46),
      S('s10', 'RM', 88, 50),
      S('s11', 'ST', 50, 78)
    ],
    staerken: ['Mittelfeldüberzahl', 'Kaum Räume zwischen den Linien', 'Ideal zum Ergebnis halten'],
    schwaechen: ['Kaum Torgefahr', 'Der Stürmer verhungert', 'Passiv gegen tiefe Gegner'],
    anforderungen: { ausdauer: 68, zweikampf: 60 },
    risiko: 28, defensivwert: 76, offensivwert: 42, breite: 70, kompaktheit: 76
  },

  '3-5-2': {
    id: '3-5-2', name: '3-5-2',
    desc: 'Dreierkette mit rackernden Schienenspielern. Zentral steht man satt, '
      + 'aber die Flügel müssen 90 Minuten rauf und runter.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'IV', 26, 22), S('s3', 'IV', 50, 19), S('s4', 'IV', 74, 22),
      S('s5', 'LM', 10, 52), S('s6', 'ZM', 34, 46), S('s7', 'DM', 50, 38), S('s8', 'ZM', 66, 46),
      S('s9', 'RM', 90, 52),
      S('s10', 'ST', 40, 80), S('s11', 'ST', 60, 80)
    ],
    staerken: ['Zentrale Überzahl', 'Zwei Spitzen', 'Dreierkette deckt sich gegenseitig ab'],
    schwaechen: ['Enorme Laufleistung nötig', 'Flügel bei Ballverlust offen'],
    anforderungen: { ausdauer: 72, tempo: 62, zweikampf: 62 },
    risiko: 52, defensivwert: 62, offensivwert: 64, breite: 74, kompaktheit: 64
  },

  '3-4-3': {
    id: '3-4-3', name: '3-4-3',
    desc: 'Mutig bis übermütig: Dreierkette, breite Schienen, drei Angreifer. '
      + 'Entweder überrollt man den Gegner – oder wird selbst überrollt.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'IV', 26, 22), S('s3', 'IV', 50, 19), S('s4', 'IV', 74, 22),
      S('s5', 'LM', 12, 50), S('s6', 'ZM', 38, 46), S('s7', 'ZM', 62, 46), S('s8', 'RM', 88, 50),
      S('s9', 'LA', 18, 76), S('s10', 'ST', 50, 82), S('s11', 'RA', 82, 76)
    ],
    staerken: ['Hoher Druck auf die gegnerische Kette', 'Drei Abnehmer im Strafraum', 'Sehr breit'],
    schwaechen: ['Nur zwei Zentrale', 'Konteranfällig', 'Innenverteidiger stehen oft eins gegen eins'],
    anforderungen: { tempo: 68, ausdauer: 70, zweikampf: 62 },
    risiko: 72, defensivwert: 48, offensivwert: 78, breite: 84, kompaktheit: 46
  },

  '5-3-2': {
    id: '5-3-2', name: '5-3-2',
    desc: 'Fünferkette, drei Zentrale, zwei Spitzen zum Kontern. Das Bollwerk des '
      + 'Abstiegskampfes – hinten dicht, vorne blitzschnell.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 8, 34), S('s3', 'IV', 28, 20), S('s4', 'IV', 50, 17), S('s5', 'IV', 72, 20),
      S('s6', 'RV', 92, 34),
      S('s7', 'ZM', 30, 50), S('s8', 'DM', 50, 44), S('s9', 'ZM', 70, 50),
      S('s10', 'ST', 40, 78), S('s11', 'ST', 60, 78)
    ],
    staerken: ['Bombensichere Zentrale', 'Zwei Konterspitzen', 'Wenig Gegenchancen'],
    schwaechen: ['Wenig Ballbesitz', 'Passives Spiel', 'Schienenspieler kommen kaum nach vorn'],
    anforderungen: { zweikampf: 62, positionsspiel: 62, kopfball: 58 },
    risiko: 26, defensivwert: 82, offensivwert: 46, breite: 72, kompaktheit: 74
  },

  '5-4-1': {
    id: '5-4-1', name: '5-4-1',
    desc: 'Der Beton. Fünf hinten, vier davor, einer vorn. Wer so spielt, will '
      + 'die Null halten – und der Vorstand fragt nach der Zuschauerzahl.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 8, 32), S('s3', 'IV', 28, 19), S('s4', 'IV', 50, 16), S('s5', 'IV', 72, 19),
      S('s6', 'RV', 92, 32),
      S('s7', 'LM', 16, 52), S('s8', 'ZM', 38, 48), S('s9', 'ZM', 62, 48), S('s10', 'RM', 84, 52),
      S('s11', 'ST', 50, 76)
    ],
    staerken: ['Maximale Defensivdichte', 'Kaum Räume im Strafraum', 'Ideal in Unterzahl'],
    schwaechen: ['Praktisch keine Offensive', 'Fans und Vorstand murren', 'Ballbesitz nahe null'],
    anforderungen: { zweikampf: 60, positionsspiel: 64, ausdauer: 58 },
    risiko: 18, defensivwert: 88, offensivwert: 34, breite: 68, kompaktheit: 82
  },

  '4-3-1-2': {
    id: '4-3-1-2', name: '4-3-1-2',
    desc: 'Enges Zentrum mit Zehner hinter zwei Spitzen. Kombinationsfußball auf '
      + 'kleinem Raum – braucht Techniker, keine Holzfäller.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 12, 25), S('s3', 'IV', 37, 20), S('s4', 'IV', 63, 20), S('s5', 'RV', 88, 25),
      S('s6', 'ZM', 26, 46), S('s7', 'DM', 50, 40), S('s8', 'ZM', 74, 46),
      S('s9', 'OM', 50, 62),
      S('s10', 'ST', 38, 82), S('s11', 'ST', 62, 82)
    ],
    staerken: ['Kurze Passwege', 'Zehner als Schaltzentrale', 'Doppelspitze bindet zwei Verteidiger'],
    schwaechen: ['Kaum Breite', 'Flanken kommen nur von den Außenverteidigern'],
    anforderungen: { technik: 64, passspiel: 66, uebersicht: 62 },
    risiko: 58, defensivwert: 52, offensivwert: 70, breite: 34, kompaktheit: 74
  },

  '3-4-1-2': {
    id: '3-4-1-2', name: '3-4-1-2',
    desc: 'Dreierkette, Doppelsechs, Zehner und zwei Spitzen. Zentral brandgefährlich, '
      + 'auf den Außenbahnen ein einziges Wagnis.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'IV', 26, 22), S('s3', 'IV', 50, 19), S('s4', 'IV', 74, 22),
      S('s5', 'LM', 12, 50), S('s6', 'DM', 38, 42), S('s7', 'DM', 62, 42), S('s8', 'RM', 88, 50),
      S('s9', 'OM', 50, 64),
      S('s10', 'ST', 38, 82), S('s11', 'ST', 62, 82)
    ],
    staerken: ['Zentrale Dominanz', 'Zehner zwischen den Linien', 'Doppelsechs sichert die Dreierkette'],
    schwaechen: ['Schienenspieler völlig auf sich gestellt', 'Anfällig für Verlagerungen'],
    anforderungen: { ausdauer: 70, technik: 62, passspiel: 62 },
    risiko: 62, defensivwert: 54, offensivwert: 72, breite: 48, kompaktheit: 70
  },

  '4-2-4': {
    id: '4-2-4', name: '4-2-4 Angriffsfußball',
    desc: 'Vier Angreifer, zwei Mittelfeldspieler, viel Gottvertrauen. Volles Risiko '
      + 'für die letzten zwanzig Minuten – oder für Mutige über neunzig.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 12, 26), S('s3', 'IV', 37, 20), S('s4', 'IV', 63, 20), S('s5', 'RV', 88, 26),
      S('s6', 'ZM', 36, 46), S('s7', 'ZM', 64, 46),
      S('s8', 'LA', 12, 72), S('s9', 'ST', 38, 82), S('s10', 'ST', 62, 82), S('s11', 'RA', 88, 72)
    ],
    staerken: ['Brutale Offensivpräsenz', 'Vier Abnehmer im Sechzehner', 'Zwingt jeden Gegner zurück'],
    schwaechen: ['Mittelfeld chronisch unterbesetzt', 'Jeder Konter ist lebensgefährlich'],
    anforderungen: { schuss: 64, ausdauer: 68, tempo: 64 },
    risiko: 92, defensivwert: 32, offensivwert: 90, breite: 78, kompaktheit: 34
  },

  '4-4-1-1': {
    id: '4-4-1-1', name: '4-4-1-1',
    desc: 'Zwei Viererketten mit hängender Spitze hinter dem Mittelstürmer. Ein '
      + '4-4-2 mit Köpfchen – der Zweite fällt ins Mittelfeld zurück.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 12, 24), S('s3', 'IV', 37, 19), S('s4', 'IV', 63, 19), S('s5', 'RV', 88, 24),
      S('s6', 'LM', 13, 50), S('s7', 'ZM', 38, 46), S('s8', 'ZM', 62, 46), S('s9', 'RM', 87, 50),
      S('s10', 'OM', 50, 66),
      S('s11', 'ST', 50, 84)
    ],
    staerken: ['Kompakte Grundordnung', 'Hängende Spitze stört den Aufbau', 'Leicht umzustellen'],
    schwaechen: ['Nur ein echter Strafraumspieler', 'Braucht einen laufstarken Zehner'],
    anforderungen: { ausdauer: 64, uebersicht: 58 },
    risiko: 42, defensivwert: 64, offensivwert: 58, breite: 66, kompaktheit: 68
  },

  '3-6-1': {
    id: '3-6-1', name: '3-6-1',
    desc: 'Sechs Mittelfeldspieler ersticken jeden gegnerischen Spielaufbau. '
      + 'Ballbesitzfußball für Feinschmecker – und Schlaftabletten für die Kurve.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'IV', 26, 22), S('s3', 'IV', 50, 19), S('s4', 'IV', 74, 22),
      S('s5', 'LM', 10, 52), S('s6', 'DM', 37, 38), S('s7', 'DM', 63, 38), S('s8', 'RM', 90, 52),
      S('s9', 'OM', 34, 60), S('s10', 'OM', 66, 60),
      S('s11', 'ST', 50, 80)
    ],
    staerken: ['Totale Ballkontrolle', 'Gegner kommt nie in Ballbesitz', 'Sofortiges Gegenpressing'],
    schwaechen: ['Nur ein Stürmer', 'Dreierkette ohne Absicherung bei langen Bällen'],
    anforderungen: { passspiel: 68, uebersicht: 66, ausdauer: 70 },
    risiko: 50, defensivwert: 58, offensivwert: 58, breite: 72, kompaktheit: 68
  },

  '4-2-2-2': {
    id: '4-2-2-2', name: '4-2-2-2',
    desc: 'Doppelsechs, zwei Halbraum-Zehner, zwei Spitzen. Die Halbräume werden '
      + 'zugestellt, über die Mitte kommt keiner durch.',
    slots: [
      S('s1', 'TW', 50, 6),
      S('s2', 'LV', 12, 26), S('s3', 'IV', 37, 20), S('s4', 'IV', 63, 20), S('s5', 'RV', 88, 26),
      S('s6', 'DM', 36, 40), S('s7', 'DM', 64, 40),
      S('s8', 'OM', 22, 62), S('s9', 'OM', 78, 62),
      S('s10', 'ST', 38, 82), S('s11', 'ST', 62, 82)
    ],
    staerken: ['Halbräume besetzt', 'Doppelsechs sichert ab', 'Kurze Wege zum Gegenpressing'],
    schwaechen: ['Grundlinie bleibt unbespielt', 'Außenverteidiger müssen die Breite allein geben'],
    anforderungen: { ausdauer: 68, technik: 60, positionsspiel: 60 },
    risiko: 56, defensivwert: 58, offensivwert: 68, breite: 50, kompaktheit: 70
  }
};

/** Alle Formations-IDs in einer stabilen Reihenfolge (für UI-Listen). */
export const FORMATION_IDS = Object.keys(FORMATIONS);

/* =========================================================================
 * 2. SPIELSTILE
 * ========================================================================= */

/**
 * mods:
 *   tempo, passLaenge, pressinghoehe, risiko  → 0..100 Zielwerte (Slider-Vorgabe)
 *   chancenRate, gegenchancenRate, ausdauerkosten → Multiplikatoren um 1.0
 *   benoetigteAttribute → Attribut-Keys, die der Stil vom Kader verlangt
 */
export const STYLES = {

  ballbesitz: {
    id: 'ballbesitz', name: 'Ballbesitz',
    desc: 'Den Ball laufen lassen, den Gegner müde spielen. Wenig Risiko, viel Geduld – '
      + 'bis sich die Lücke auftut.',
    mods: {
      tempo: 42, passLaenge: 26, pressinghoehe: 58, risiko: 38,
      chancenRate: 1.02, gegenchancenRate: 0.84, ausdauerkosten: 0.94,
      benoetigteAttribute: ['technik', 'passspiel', 'uebersicht']
    },
    passtZu: 'Technisch starke Mittelfeldspieler mit hoher Übersicht; Tempo ist zweitrangig.'
  },

  konter: {
    id: 'konter', name: 'Konterfußball',
    desc: 'Tief stehen, Ball erobern, mit drei Pässen vors Tor. Wenige Chancen – '
      + 'aber die sitzen.',
    mods: {
      tempo: 64, passLaenge: 70, pressinghoehe: 26, risiko: 44,
      chancenRate: 0.86, gegenchancenRate: 0.76, ausdauerkosten: 0.9,
      benoetigteAttribute: ['tempo', 'schuss', 'positionsspiel']
    },
    passtZu: 'Schnelle Spitzen und diszipliniertes Mittelfeld; ideal als Außenseiter.'
  },

  pressing: {
    id: 'pressing', name: 'Pressing',
    desc: 'Den Gegner schon im Aufbau anlaufen. Wer die Lunge hat, gewinnt den Ball '
      + 'dort, wo es weh tut.',
    mods: {
      tempo: 68, passLaenge: 44, pressinghoehe: 88, risiko: 60,
      chancenRate: 1.14, gegenchancenRate: 1.12, ausdauerkosten: 1.28,
      benoetigteAttribute: ['ausdauer', 'aggressivitaet', 'zweikampf']
    },
    passtZu: 'Junger, laufstarker Kader mit viel Aggressivität und breiter Bank.'
  },

  kick_and_rush: {
    id: 'kick_and_rush', name: 'Kick and Rush',
    desc: 'Lange Bälle nach vorn, zweite Bälle erobern, draufhalten. Hässlich, '
      + 'anstrengend – und erstaunlich wirksam.',
    mods: {
      tempo: 78, passLaenge: 92, pressinghoehe: 60, risiko: 70,
      chancenRate: 1.08, gegenchancenRate: 1.16, ausdauerkosten: 1.14,
      benoetigteAttribute: ['kopfball', 'koerper', 'sprungkraft']
    },
    passtZu: 'Kopfballstarker Zielspieler, robuste Zweikämpfer, wenig Technik nötig.'
  },

  ausgeglichen: {
    id: 'ausgeglichen', name: 'Ausgeglichen',
    desc: 'Kein Extrem, keine Schwäche. Die Grundeinstellung, mit der man nie '
      + 'komplett falsch liegt.',
    mods: {
      tempo: 50, passLaenge: 50, pressinghoehe: 50, risiko: 50,
      chancenRate: 1.0, gegenchancenRate: 1.0, ausdauerkosten: 1.0,
      benoetigteAttribute: []
    },
    passtZu: 'Jeder Kader. Die sichere Bank, wenn man den Gegner nicht einschätzen kann.'
  },

  defensiv: {
    id: 'defensiv', name: 'Defensiv',
    desc: 'Räume zu, Abstände eng, Ergebnis verwalten. Der Trainer nennt es '
      + 'Ordnung, die Fans nennen es anders.',
    mods: {
      tempo: 36, passLaenge: 56, pressinghoehe: 20, risiko: 24,
      chancenRate: 0.74, gegenchancenRate: 0.68, ausdauerkosten: 0.86,
      benoetigteAttribute: ['positionsspiel', 'zweikampf', 'nervenstaerke']
    },
    passtZu: 'Erfahrene, positionsstarke Abwehr; funktioniert auch mit müdem Kader.'
  },

  offensiv: {
    id: 'offensiv', name: 'Offensiv',
    desc: 'Alle Mann nach vorn. Wer den Rückstand aufholen muss, hat keine Zeit '
      + 'für Absicherung.',
    mods: {
      tempo: 68, passLaenge: 46, pressinghoehe: 72, risiko: 80,
      chancenRate: 1.24, gegenchancenRate: 1.30, ausdauerkosten: 1.12,
      benoetigteAttribute: ['schuss', 'dribbling', 'technik']
    },
    passtZu: 'Torgefährliche Offensive und ein Kader, der Gegentore verkraften kann.'
  },

  umschaltspiel: {
    id: 'umschaltspiel', name: 'Umschaltspiel',
    desc: 'Mittelhoch verteidigen und im Moment der Balleroberung sofort nach vorn. '
      + 'Der Kompromiss zwischen Pressing und Konter.',
    mods: {
      tempo: 72, passLaenge: 60, pressinghoehe: 62, risiko: 56,
      chancenRate: 1.10, gegenchancenRate: 1.00, ausdauerkosten: 1.16,
      benoetigteAttribute: ['tempo', 'ausdauer', 'uebersicht']
    },
    passtZu: 'Athletische Außenbahnen und ein Sechser, der die Bälle abfängt.'
  }
};

export const STYLE_IDS = Object.keys(STYLES);

/* =========================================================================
 * 3. SPIELERROLLEN
 * ========================================================================= */

/**
 * mods       → Multiplikatoren auf die Attribute des Spielers in dieser Rolle
 * benoetigt  → absolute Mindestwerte; darunter erfüllt der Spieler die Rolle nur halb
 * teamEffekt → additive Punkte auf Team-Kennwerte (TEAM_EFFECT_KEYS)
 */
export const ROLES = {

  spielmacher: {
    id: 'spielmacher', name: 'Spielmacher',
    desc: 'Lässt den Ball laufen, sucht den entscheidenden Pass und bestimmt den Rhythmus. '
      + 'Defensivarbeit ist nicht seine Kernkompetenz.',
    positions: ['ZM', 'OM', 'DM'],
    mods: { passspiel: 1.10, uebersicht: 1.12, technik: 1.06, zweikampf: 0.92, ausdauer: 0.96 },
    benoetigt: { passspiel: 70, uebersicht: 68, technik: 62 },
    teamEffekt: { aufbau: 6, kreativitaet: 7, defensivstabilitaet: -3 }
  },

  sechser_zerstoerer: {
    id: 'sechser_zerstoerer', name: 'Abräumer',
    desc: 'Der Staubsauger vor der Abwehr. Zerstört gegnerische Angriffe, bevor sie '
      + 'entstehen – und kassiert dafür auch mal Gelb.',
    positions: ['DM', 'ZM'],
    mods: { zweikampf: 1.12, aggressivitaet: 1.10, positionsspiel: 1.06, passspiel: 0.94, dribbling: 0.9 },
    benoetigt: { zweikampf: 68, positionsspiel: 62, ausdauer: 62 },
    teamEffekt: { defensivstabilitaet: 9, kompaktheit: 5, kreativitaet: -3, kartenrisiko: 6 }
  },

  box_to_box: {
    id: 'box_to_box', name: 'Box-to-Box',
    desc: 'Rennt von Strafraum zu Strafraum, hilft überall aus. Der Motor der Mannschaft – '
      + 'und in der Schlussphase der Erste, dem die Beine schwer werden.',
    positions: ['ZM', 'DM', 'OM'],
    mods: { ausdauer: 1.12, zweikampf: 1.04, schuss: 1.04, passspiel: 1.02, positionsspiel: 0.98 },
    benoetigt: { ausdauer: 72, zweikampf: 60, passspiel: 58 },
    teamEffekt: { konterwucht: 5, defensivstabilitaet: 4, torgefahr: 3 }
  },

  achter_offensiv: {
    id: 'achter_offensiv', name: 'Offensiver Achter',
    desc: 'Schiebt aus dem Zentrum in den Strafraum nach und taucht als zweite Welle auf. '
      + 'Torgefährlich, aber defensiv nur bedingt zuverlässig.',
    positions: ['ZM', 'OM'],
    mods: { schuss: 1.10, technik: 1.06, dribbling: 1.05, positionsspiel: 0.96, zweikampf: 0.94 },
    benoetigt: { schuss: 62, technik: 62, ausdauer: 64 },
    teamEffekt: { torgefahr: 6, kreativitaet: 4, defensivstabilitaet: -4 }
  },

  libero: {
    id: 'libero', name: 'Libero',
    desc: 'Der letzte Mann alter Schule: liest das Spiel, räumt hinter der Kette auf und '
      + 'schaltet sich mit dem Ball am Fuß in den Aufbau ein.',
    positions: ['IV', 'DM'],
    mods: { positionsspiel: 1.12, uebersicht: 1.10, passspiel: 1.06, zweikampf: 1.02, tempo: 0.96 },
    benoetigt: { positionsspiel: 70, uebersicht: 66, passspiel: 60 },
    teamEffekt: { defensivstabilitaet: 7, aufbau: 6, kompaktheit: 4 }
  },

  innenverteidiger_aufbau: {
    id: 'innenverteidiger_aufbau', name: 'Aufbauender Innenverteidiger',
    desc: 'Eröffnet das Spiel mit Pässen durch die Linien statt mit Befreiungsschlägen. '
      + 'Bei Ballverlust in der eigenen Hälfte wird es allerdings brenzlig.',
    positions: ['IV'],
    mods: { passspiel: 1.12, uebersicht: 1.08, technik: 1.06, zweikampf: 0.98 },
    benoetigt: { passspiel: 64, uebersicht: 58, technik: 55 },
    teamEffekt: { aufbau: 8, kreativitaet: 3, defensivstabilitaet: -2 }
  },

  aussenverteidiger_offensiv: {
    id: 'aussenverteidiger_offensiv', name: 'Offensiver Außenverteidiger',
    desc: 'Schiebt bis zur Grundlinie durch und kurbelt das Flügelspiel an. Hinter ihm '
      + 'bleibt dabei viel Rasen unbewacht.',
    positions: ['LV', 'RV', 'LM', 'RM'],
    mods: { tempo: 1.08, ausdauer: 1.08, passspiel: 1.05, dribbling: 1.05, positionsspiel: 0.94 },
    benoetigt: { tempo: 66, ausdauer: 70 },
    teamEffekt: { flankenlast: 9, breite: 6, defensivstabilitaet: -5 }
  },

  aussenverteidiger_defensiv: {
    id: 'aussenverteidiger_defensiv', name: 'Defensiver Außenverteidiger',
    desc: 'Bleibt hinten, macht die Seite dicht und lässt den Flügelstürmer verzweifeln. '
      + 'Nach vorn kommt von ihm wenig.',
    positions: ['LV', 'RV', 'IV'],
    mods: { zweikampf: 1.10, positionsspiel: 1.08, koerper: 1.04, dribbling: 0.92, tempo: 0.98 },
    benoetigt: { zweikampf: 62, positionsspiel: 60 },
    teamEffekt: { defensivstabilitaet: 7, flankenlast: -4, kompaktheit: 3 }
  },

  fluegelfluitzer: {
    id: 'fluegelfluitzer', name: 'Flügelflitzer',
    desc: 'Nimmt den Ball, nimmt Tempo auf und geht außen vorbei. Danach die Flanke – '
      + 'oder der Bericht der Sportschau über sein Tempo.',
    positions: ['LA', 'RA', 'LM', 'RM'],
    mods: { tempo: 1.12, dribbling: 1.10, ausdauer: 1.04, zweikampf: 0.9, kopfball: 0.92 },
    benoetigt: { tempo: 72, dribbling: 66 },
    teamEffekt: { flankenlast: 8, breite: 8, konterwucht: 5, defensivstabilitaet: -3 }
  },

  invertierter_fluegel: {
    id: 'invertierter_fluegel', name: 'Invertierter Flügel',
    desc: 'Zieht mit dem starken Fuß nach innen und sucht den Abschluss. Macht die Mitte '
      + 'gefährlich, die Außenbahn dafür leer.',
    positions: ['LA', 'RA', 'OM'],
    mods: { schuss: 1.12, technik: 1.08, dribbling: 1.05, kopfball: 0.9 },
    benoetigt: { schuss: 66, technik: 64, dribbling: 62 },
    teamEffekt: { torgefahr: 7, kreativitaet: 4, breite: -6, flankenlast: -3 }
  },

  zehner: {
    id: 'zehner', name: 'Klassischer Zehner',
    desc: 'Lebt zwischen den Linien, wo ihn keiner greifen kann. Ein Zauberpass pro Spiel – '
      + 'dafür verzeiht man ihm die fehlende Rückwärtsbewegung.',
    positions: ['OM', 'ZM'],
    mods: { technik: 1.12, uebersicht: 1.10, passspiel: 1.08, dribbling: 1.05, ausdauer: 0.9, zweikampf: 0.86 },
    benoetigt: { technik: 68, uebersicht: 66, passspiel: 64 },
    teamEffekt: { kreativitaet: 10, torgefahr: 4, defensivstabilitaet: -6, pressingwucht: -4 }
  },

  haengende_spitze: {
    id: 'haengende_spitze', name: 'Hängende Spitze',
    desc: 'Lässt sich fallen, holt den Ball ab und legt für den Mitspieler ab. Bindet '
      + 'einen Innenverteidiger und reißt so Lücken.',
    positions: ['ST', 'OM'],
    mods: { technik: 1.08, passspiel: 1.08, uebersicht: 1.06, kopfball: 0.94 },
    benoetigt: { technik: 62, passspiel: 60 },
    teamEffekt: { kreativitaet: 6, aufbau: 4, torgefahr: 2 }
  },

  mittelstuermer: {
    id: 'mittelstuermer', name: 'Mittelstürmer',
    desc: 'Der komplette Neuner: hält den Ball, geht in die Tiefe, trifft. Nichts '
      + 'Spektakuläres, aber zuverlässig gefährlich.',
    positions: ['ST'],
    mods: { schuss: 1.08, positionsspiel: 1.06, koerper: 1.04, kopfball: 1.03 },
    benoetigt: { schuss: 64, positionsspiel: 58 },
    teamEffekt: { torgefahr: 7 }
  },

  zielspieler: {
    id: 'zielspieler', name: 'Zielspieler',
    desc: 'Der Turm im Sturmzentrum. Jeder lange Ball geht auf seinen Kopf, jeder '
      + 'zweite Ball auf den nachrückenden Mitspieler.',
    positions: ['ST'],
    mods: { kopfball: 1.14, koerper: 1.10, sprungkraft: 1.08, tempo: 0.9, dribbling: 0.9 },
    benoetigt: { kopfball: 70, koerper: 68 },
    teamEffekt: { torgefahr: 5, konterwucht: -3, flankenlast: 6 }
  },

  wandspieler: {
    id: 'wandspieler', name: 'Wandspieler',
    desc: 'Steht mit dem Rücken zum Tor, behauptet den Ball und legt klatschen lassen '
      + 'ab. Der beste Freund jedes nachrückenden Achters.',
    positions: ['ST', 'OM'],
    mods: { koerper: 1.10, technik: 1.06, passspiel: 1.06, tempo: 0.94 },
    benoetigt: { koerper: 66, technik: 58, passspiel: 56 },
    teamEffekt: { aufbau: 5, kreativitaet: 4, torgefahr: 2 }
  },

  torjaeger: {
    id: 'torjaeger', name: 'Torjäger',
    desc: 'Sieht das ganze Spiel nicht statt – und macht dann das 1:0. Lebt im '
      + 'Sechzehner und sonst nirgends.',
    positions: ['ST'],
    mods: { schuss: 1.14, positionsspiel: 1.08, nervenstaerke: 1.06, passspiel: 0.88, ausdauer: 0.92 },
    benoetigt: { schuss: 70, positionsspiel: 62 },
    teamEffekt: { torgefahr: 10, aufbau: -4, pressingwucht: -3 }
  },

  torwart_mitspielend: {
    id: 'torwart_mitspielend', name: 'Mitspielender Torwart',
    desc: 'Der elfte Feldspieler. Steht hoch, eröffnet flach und rettet außerhalb des '
      + 'Strafraums – solange es gutgeht.',
    positions: ['TW'],
    mods: { abschlag: 1.10, stellungsspiel: 1.06, passspiel: 1.15, reflexe: 0.98 },
    benoetigt: { abschlag: 62, stellungsspiel: 62, passspiel: 45 },
    teamEffekt: { aufbau: 7, kompaktheit: 4, defensivstabilitaet: -3 }
  },

  torwart_linienhueter: {
    id: 'torwart_linienhueter', name: 'Linienhüter',
    desc: 'Bleibt auf der Linie und hält, was zu halten ist. Vom Spielaufbau hält er '
      + 'ungefähr so viel wie von Kunstrasen.',
    positions: ['TW'],
    mods: { reflexe: 1.10, nervenstaerke: 1.04, abschlag: 0.92, passspiel: 0.85 },
    benoetigt: { reflexe: 66 },
    teamEffekt: { defensivstabilitaet: 5, aufbau: -6 }
  }
};

export const ROLE_IDS = Object.keys(ROLES);

/* =========================================================================
 * 4. ZUSATZANWEISUNGEN
 * ========================================================================= */

export const INSTRUCTIONS = {

  zeitspiel: {
    id: 'zeitspiel', name: 'Zeitspiel',
    desc: 'Einwürfe dauern plötzlich sehr lange, der Torwart bindet sich die Schuhe neu. '
      + 'Bringt Führungen über die Zeit – und die Gegenfans auf die Palme.',
    mods: { tempo: -12, chancenRate: 0.86, gegenchancenRate: 0.84, ausdauerkosten: 0.92, kartenrisiko: 8, fanStimmung: -3 }
  },

  langeBaelle: {
    id: 'langeBaelle', name: 'Lange Bälle',
    desc: 'Das Mittelfeld wird überspielt. Der lange Ball auf die Spitze – Kopfball, '
      + 'zweiter Ball, Chance. Oder eben Einwurf für den Gegner.',
    mods: { passLaenge: 28, chancenRate: 1.04, gegenchancenRate: 1.06, ballbesitz: -10, kopfballGewicht: 1.15 }
  },

  flankenSpiel: {
    id: 'flankenSpiel', name: 'Flügelspiel',
    desc: 'Alles über außen. Grundlinie, Flanke, Kopfball. Braucht Abnehmer im Strafraum, '
      + 'sonst segeln die Bälle ins Nichts.',
    mods: { breite: 14, flankenlast: 14, chancenRate: 1.05, kopfballGewicht: 1.12, kreativitaet: -3 }
  },

  abseitsfalle: {
    id: 'abseitsfalle', name: 'Abseitsfalle',
    desc: 'Die Kette rückt geschlossen auf. Klappt es, steht der Stürmer im Abseits – '
      + 'klappt es nicht, steht er allein vor dem Torwart.',
    mods: { abseitsRate: 1.45, gegenchancenRate: 0.9, patzerRisiko: 1.35, kompaktheit: 6 }
  },

  kurzpassspiel: {
    id: 'kurzpassspiel', name: 'Kurzpassspiel',
    desc: 'Flach und sauber von hinten heraus. Sicherer Ballbesitz, aber gegen hohes '
      + 'Pressing ein gefährliches Spiel mit dem Feuer.',
    mods: { passLaenge: -26, ballbesitz: 9, chancenRate: 1.02, patzerRisiko: 1.18, aufbau: 6 }
  },

  gegenpressing: {
    id: 'gegenpressing', name: 'Gegenpressing',
    desc: 'Nach Ballverlust sofort wieder drauf. Erobert den Ball in der gefährlichen '
      + 'Zone – kostet aber richtig Körner.',
    mods: { pressinghoehe: 16, pressingwucht: 12, chancenRate: 1.08, gegenchancenRate: 1.1, ausdauerkosten: 1.22, kartenrisiko: 6 }
  },

  tiefstehen: {
    id: 'tiefstehen', name: 'Tief stehen',
    desc: 'Die Kette bleibt am eigenen Sechzehner. Hinter der Abwehr gibt es keinen Raum '
      + 'mehr – vor ihr dafür jede Menge.',
    mods: { pressinghoehe: -22, gegenchancenRate: 0.82, chancenRate: 0.86, ballbesitz: -8, kompaktheit: 8 }
  },

  hoheAussenverteidiger: {
    id: 'hoheAussenverteidiger', name: 'Hohe Außenverteidiger',
    desc: 'Die Außenverteidiger schieben auf Höhe des Mittelfelds. Mehr Breite im Angriff, '
      + 'weite Wege zurück.',
    mods: { breite: 10, flankenlast: 10, offensivdrang: 8, gegenchancenRate: 1.12, ausdauerkosten: 1.1 }
  }
};

export const INSTRUCTION_IDS = Object.keys(INSTRUCTIONS);

/* =========================================================================
 * 5. KLEINE HELFER
 * ========================================================================= */

/** Attributwert mit Fallback (Kader aus data/ hat immer alle Keys, Tests evtl. nicht). */
function att(player, key) {
  const v = player && player.attributes ? player.attributes[key] : undefined;
  return typeof v === 'number' ? v : 50;
}

/** Laufzeitfeld mit Fallback – Spieler aus data/ haben noch keine Laufzeitfelder. */
function rt(player, key, fallback) {
  const v = player ? player[key] : undefined;
  return typeof v === 'number' ? v : fallback;
}

/** true, wenn der Spieler verletzt ist. */
export function isInjured(player) {
  return !!(player && player.injury);
}

/** true, wenn der Spieler gesperrt ist. */
export function isBanned(player) {
  return !!(player && player.cards && player.cards.ban > 0);
}

/** true, wenn der Spieler grundsätzlich einsatzfähig ist. */
export function isAvailable(player) {
  return !!player && !isInjured(player) && !isBanned(player);
}

/** Positions-Affinität aus constants.js (1.0 = Idealposition, 0 = fremd). */
function affinity(player, pos) {
  if (!player) return 0;
  if (player.position === pos) return 1;
  const table = POSITION_AFFINITY[player.position] || {};
  let best = table[pos] || 0;
  for (const alt of player.altPositions || []) {
    if (alt === pos) best = Math.max(best, 0.94);
    else best = Math.max(best, (POSITION_AFFINITY[alt] || {})[pos] || 0);
  }
  return best;
}

/** Findet einen Spieler in einer Liste. */
function byId(players, id) {
  for (const p of players) if (p && p.id === id) return p;
  return null;
}

/** Formation robust auflösen – akzeptiert ID, Formation-Objekt oder Tactics. */
function resolveFormation(f) {
  if (!f) return null;
  if (typeof f === 'string') return FORMATIONS[f] || null;
  if (f.slots && f.id) return f;
  if (f.formation) return resolveFormation(f.formation);
  return null;
}

/** Zählt Slots je Mannschaftsteil (ohne Torwart). */
export function formationLines(formationId) {
  const f = resolveFormation(formationId);
  if (!f) return { abwehr: 0, mittelfeld: 0, sturm: 0 };
  let abwehr = 0, mittelfeld = 0, sturm = 0;
  for (const s of f.slots) {
    if (s.pos === 'TW') continue;
    if (s.y <= 34) abwehr++;
    else if (s.y <= 68) mittelfeld++;
    else sturm++;
  }
  return { abwehr, mittelfeld, sturm };
}

/* =========================================================================
 * 6. slotLabel() / formationShape()
 * ========================================================================= */

/** Positionen, die schon von sich aus eine Seite tragen. */
const SIDED = new Set(['LV', 'RV', 'LM', 'RM', 'LA', 'RA']);

/**
 * Kurzlabel für die UI: "LV", "IV rechts", "ST links" …
 * @param {{pos:string,x:number}} slot
 * @returns {string}
 */
export function slotLabel(slot) {
  if (!slot || !slot.pos) return '?';
  const pos = slot.pos;
  if (pos === 'TW' || SIDED.has(pos)) return pos;
  const x = typeof slot.x === 'number' ? slot.x : 50;
  if (x <= 42) return pos + ' links';
  if (x >= 58) return pos + ' rechts';
  return pos;
}

/** Ausführliches Label für Tooltips: "Innenverteidiger (rechts)". */
export function slotLabelLong(slot) {
  if (!slot || !slot.pos) return 'Unbekannt';
  const name = POSITION_NAMES[slot.pos] || slot.pos;
  if (slot.pos === 'TW' || SIDED.has(slot.pos)) return name;
  const x = typeof slot.x === 'number' ? slot.x : 50;
  if (x <= 42) return `${name} (links)`;
  if (x >= 58) return `${name} (rechts)`;
  return name;
}

/**
 * Slots für die Taktikbrett-Darstellung, angereichert um Label und Reihe.
 * @param {string} formationId
 * @returns {Array<{id,pos,x,y,label,labelLang,reihe,gruppe}>}
 */
export function formationShape(formationId) {
  const f = resolveFormation(formationId);
  if (!f) return [];
  // Reihen = y-Bänder, damit das Brett Linien zeichnen kann
  const bands = [];
  const slots = f.slots.map(s => ({ ...s }));
  for (const s of slots) {
    let band = bands.find(b => Math.abs(b.y - s.y) <= 9);
    if (!band) { band = { y: s.y, slots: [] }; bands.push(band); }
    band.slots.push(s);
    band.y = avg(band.slots, q => q.y);
  }
  bands.sort((a, b) => a.y - b.y);
  const bandIndex = new Map();
  bands.forEach((b, i) => b.slots.forEach(s => bandIndex.set(s.id, i)));

  return slots.map(s => ({
    id: s.id,
    pos: s.pos,
    x: s.x,
    y: s.y,
    label: slotLabel(s),
    labelLang: slotLabelLong(s),
    reihe: bandIndex.get(s.id) || 0,
    gruppe: s.pos === 'TW' ? 'TW' : s.y <= 34 ? 'ABW' : s.y <= 68 ? 'MIT' : 'STU'
  }));
}

/* =========================================================================
 * 7. AUTOMATISCHE AUFSTELLUNG
 * ========================================================================= */

/**
 * Bewertet einen Spieler für einen konkreten Slot.
 * Basis ist playerRatingForSlot() aus engine/ratings.js, darauf kommen
 * Zustandsfaktoren (Fitness, Form, Moral, Spielpraxis) und die Opts-Wünsche.
 */
function candidateScore(player, slot, opts) {
  let score = playerRatingForSlot(player, slot.pos);
  if (!(score > 0)) score = 1;

  const fitness = rt(player, 'fitness', 100);
  const form = rt(player, 'form', 50);
  const morale = rt(player, 'morale', 70);
  const sharpness = rt(player, 'sharpness', 60);

  // Fitness: 100 = neutral, darunter linear abwerten
  if (opts.respectFitness !== false) {
    const lack = Math.max(0, 100 - fitness) / 100;
    score *= (1 - lack * LINEUP_W.fitness);
    if (fitness < FITNESS_HARD_FLOOR) score *= 0.35;   // praktisch nicht aufstellbar
  }

  // Tagesform / Moral / Spritzigkeit (jeweils um 50 bzw. 70 herum neutral)
  score *= 1 + ((form - 50) / 100) * LINEUP_W.form;
  score *= 1 + ((morale - 70) / 100) * LINEUP_W.moral;
  score *= 1 + ((sharpness - 60) / 100) * LINEUP_W.sharpness;

  // Rotation: frische Spieler bekommen zusätzliches Gewicht
  if (opts.rotation) {
    score *= 1 + ((fitness - 85) / 100) * LINEUP_W.rotation;
  }

  // Bewusst geschont
  if (opts.schonenSet && opts.schonenSet.has(player.id)) {
    score *= LINEUP_W.schonenMalus;
  }

  return score;
}

/**
 * Baut automatisch die beste Elf: Greedy-Zuordnung mit anschließender
 * Tausch-Nachoptimierung (lokale Suche über alle Slot-Paare und Bankspieler).
 *
 * @param {Array} players  kompletter Kader
 * @param {object} tactics Ausgangstaktik (Formation/Stil/Slider werden übernommen)
 * @param {object} [opts]  { respectFitness, rotation, schonen:[playerIds], formation }
 * @returns {object} vollständige Tactics inkl. lineup, bench, roles, setPieces
 */
export function autoLineup(players, tactics, opts = {}) {
  const base = tactics || {};
  const formationId = opts.formation || base.formation || '4-4-2';
  const formation = resolveFormation(formationId) || FORMATIONS['4-4-2'];

  const o = {
    respectFitness: opts.respectFitness !== false,
    rotation: !!opts.rotation,
    schonenSet: new Set(opts.schonen || [])
  };

  const pool = (players || []).filter(p => p && p.id && isAvailable(p));
  const slots = formation.slots;

  // --- Bewertungsmatrix ---------------------------------------------------
  // scoreOf[playerId][slotId]
  const scoreOf = new Map();
  for (const p of pool) {
    const row = {};
    for (const s of slots) row[s.id] = candidateScore(p, s, o);
    scoreOf.set(p.id, row);
  }
  const sc = (p, s) => (p ? scoreOf.get(p.id)[s.id] : 0);

  // --- Schritt 1: Greedy --------------------------------------------------
  // Alle Paare nach Bewertung sortieren, von oben nach unten belegen.
  const pairs = [];
  for (const p of pool) for (const s of slots) pairs.push({ p, s, v: sc(p, s) });
  pairs.sort((a, b) => b.v - a.v);

  const assign = new Map();          // slotId -> player
  const used = new Set();            // playerIds
  for (const pr of pairs) {
    if (assign.size >= slots.length) break;
    if (assign.has(pr.s.id) || used.has(pr.p.id)) continue;
    assign.set(pr.s.id, pr.p);
    used.add(pr.p.id);
  }

  // Notfall: zu wenige verfügbare Spieler – dann auch Gesperrte/Verletzte,
  // damit die Elf überhaupt zustande kommt (validateTactics meckert dann).
  if (assign.size < slots.length) {
    const rest = (players || []).filter(p => p && p.id && !used.has(p.id));
    const restSorted = sortBy(rest, p => ({ key: playerRatingForSlot(p, 'ZM'), desc: true }));
    for (const s of slots) {
      if (assign.has(s.id)) continue;
      const p = restSorted.shift();
      if (!p) break;
      assign.set(s.id, p);
      used.add(p.id);
      if (!scoreOf.has(p.id)) {
        const row = {};
        for (const q of slots) row[q.id] = candidateScore(p, q, o);
        scoreOf.set(p.id, row);
      }
    }
  }

  // --- Schritt 2: Nachoptimierung ----------------------------------------
  // (a) Slot-Slot-Tausch, (b) Startelf gegen Reservepool tauschen.
  const reserve = pool.filter(p => !used.has(p.id));
  for (let pass = 0; pass < OPTIMIZE_PASSES; pass++) {
    let improved = false;

    // (a) zwei Startelf-Spieler tauschen die Slots
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i], b = slots[j];
        const pa = assign.get(a.id), pb = assign.get(b.id);
        if (!pa || !pb) continue;
        const now = sc(pa, a) + sc(pb, b);
        const swapped = sc(pa, b) + sc(pb, a);
        if (swapped > now + 1e-9) {
          assign.set(a.id, pb); assign.set(b.id, pa);
          improved = true;
        }
      }
    }

    // (b) Reservist ersetzt Startelfspieler auf dessen Slot
    for (const s of slots) {
      const cur = assign.get(s.id);
      let bestIdx = -1, bestGain = 1e-9;
      for (let k = 0; k < reserve.length; k++) {
        const gain = sc(reserve[k], s) - sc(cur, s);
        if (gain > bestGain) { bestGain = gain; bestIdx = k; }
      }
      if (bestIdx >= 0) {
        const inP = reserve[bestIdx];
        reserve[bestIdx] = cur;
        assign.set(s.id, inP);
        improved = true;
      }
    }

    if (!improved) break;
  }

  // --- Lineup-Objekt ------------------------------------------------------
  const lineup = {};
  for (const s of slots) {
    const p = assign.get(s.id);
    if (p) lineup[s.id] = p.id;
  }
  const starterIds = new Set(Object.values(lineup));

  // --- Bank ---------------------------------------------------------------
  const bench = pickBench(players, starterIds, o);

  // --- Rollen -------------------------------------------------------------
  const roles = { ...(base.roles || {}) };
  for (const s of slots) {
    const p = assign.get(s.id);
    if (!p) continue;
    if (!roles[p.id]) roles[p.id] = suggestRole(p, s.pos);
  }

  // --- Standards ----------------------------------------------------------
  const starters = slots.map(s => assign.get(s.id)).filter(Boolean);
  const setPieces = pickSetPieces(starters, base.setPieces);

  return {
    formation: formation.id,
    style: base.style || 'ausgeglichen',
    lineup,
    bench,
    roles,
    sliders: { ...DEFAULT_SLIDERS, ...(base.sliders || {}) },
    setPieces,
    offsideTrap: base.offsideTrap !== undefined ? base.offsideTrap : false,
    manMarking: base.manMarking !== undefined ? base.manMarking : null,
    instructions: { ...defaultInstructions(), ...(base.instructions || {}) }
  };
}

/** Alle Zusatzanweisungen auf false. */
function defaultInstructions() {
  const out = {};
  for (const k of INSTRUCTION_IDS) out[k] = false;
  return out;
}

/**
 * Bank füllen: mindestens ein Ersatztorwart, dann die stärksten Feldspieler,
 * ausgewogen über die Mannschaftsteile.
 */
function pickBench(players, starterIds, o) {
  const avail = (players || []).filter(p => p && p.id && !starterIds.has(p.id) && isAvailable(p));
  const bench = [];

  // 1. Ersatztorwart
  const keepers = sortBy(avail.filter(p => p.position === 'TW'),
    p => ({ key: candidateScore(p, { id: 'k', pos: 'TW' }, o), desc: true }));
  if (keepers[0]) bench.push(keepers[0].id);

  // 2. Je ein Vertreter pro Mannschaftsteil, damit man wechseln kann
  const wanted = [['IV', 'LV', 'RV'], ['DM', 'ZM'], ['LM', 'RM', 'LA', 'RA'], ['ST']];
  for (const group of wanted) {
    if (bench.length >= MAX_BENCH) break;
    const cands = sortBy(
      avail.filter(p => !bench.includes(p.id) && (group.includes(p.position)
        || (p.altPositions || []).some(a => group.includes(a)))),
      p => ({ key: candidateScore(p, { id: 'g', pos: group[0] }, o), desc: true })
    );
    if (cands[0]) bench.push(cands[0].id);
  }

  // 3. Auffüllen mit den besten Verbliebenen
  const rest = sortBy(avail.filter(p => !bench.includes(p.id)),
    p => ({ key: candidateScore(p, { id: 'r', pos: p.position }, o), desc: true }));
  for (const p of rest) {
    if (bench.length >= MAX_BENCH) break;
    bench.push(p.id);
  }
  return bench.slice(0, MAX_BENCH);
}

/** Rollenvorschlag für einen Spieler auf einer Position. */
export function suggestRole(player, pos) {
  let best = null, bestScore = -Infinity;
  for (const id of ROLE_IDS) {
    const role = ROLES[id];
    if (!role.positions.includes(pos)) continue;
    // Erfüllungsgrad der Anforderungen + Bonus für die verstärkten Attribute
    let score = 0, n = 0;
    for (const k in role.benoetigt) {
      score += att(player, k) - role.benoetigt[k];
      n++;
    }
    score = n ? score / n : 0;
    for (const k in role.mods) {
      if (role.mods[k] > 1) score += (att(player, k) - 50) * (role.mods[k] - 1) * 0.6;
    }
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return best;
}

/** Standardschützen und Kapitän bestimmen. */
function pickSetPieces(starters, existing) {
  const trait = (p, key) => (p.traits || []).includes(key);

  const pickBy = fn => {
    const s = sortBy(starters, p => ({ key: fn(p), desc: true }));
    return s[0] ? s[0].id : null;
  };

  const elfmeter = pickBy(p =>
    att(p, 'schuss') * 0.45 + att(p, 'nervenstaerke') * 0.45 + att(p, 'technik') * 0.1
    + (trait(p, 'elfmeterkiller') ? 18 : 0) + (trait(p, 'knipser') ? 5 : 0)
    - (p.position === 'TW' ? 60 : 0));

  const freistoss = pickBy(p =>
    att(p, 'standards') * 0.55 + att(p, 'technik') * 0.3 + att(p, 'schuss') * 0.15
    + (trait(p, 'freistossspezialist') ? 18 : 0)
    - (p.position === 'TW' ? 60 : 0));

  const ecke = pickBy(p =>
    att(p, 'standards') * 0.5 + att(p, 'passspiel') * 0.35 + att(p, 'technik') * 0.15
    + (trait(p, 'eckenspezialist') ? 18 : 0)
    - (p.position === 'TW' ? 60 : 0)
    - (att(p, 'kopfball') > 78 ? 10 : 0));   // Kopfballstarke lieber im Strafraum

  const kapitaen = pickBy(p =>
    att(p, 'fuehrung') * 0.7 + att(p, 'nervenstaerke') * 0.15 + Math.min(34, p.age || 26) * 0.5
    + (trait(p, 'leader') ? 15 : 0) + (trait(p, 'kabinenleader') ? 10 : 0)
    - (trait(p, 'querulant') ? 20 : 0));

  const ex = existing || {};
  const keep = (id, fallback) => (id && starters.some(p => p.id === id) ? id : fallback);

  return {
    elfmeter: keep(ex.elfmeter, elfmeter),
    freistoss: keep(ex.freistoss, freistoss),
    ecke: keep(ex.ecke, ecke),
    kapitaen: keep(ex.kapitaen, kapitaen)
  };
}

/* =========================================================================
 * 8. STARTTAKTIK
 * ========================================================================= */

/**
 * Sinnvolle Starttaktik für einen Verein: Formation nach Kaderprofil,
 * Stil nach Reputation und Kaderstärke.
 *
 * @param {object} club
 * @param {Array} players
 * @returns {object} Tactics
 */
export function defaultTactics(club, players) {
  const squad = (players || []).filter(p => p && p.id);
  const profile = squadProfile(squad);

  // --- Formation: beste Elf-Summe + Profilpassung ------------------------
  const ranked = rankFormations(squad, profile);
  const formation = ranked.length ? ranked[0].id : '4-4-2';

  // --- Stil ---------------------------------------------------------------
  const rep = club && typeof club.reputation === 'number' ? club.reputation : 55;
  let style;
  if (rep >= 78 && profile.technik >= 66) style = 'ballbesitz';
  // 'offensiv' ist ein Notfallstil ("Alle Mann nach vorn"), keine Grundordnung.
  // Als Dauereinstellung für die halbe Bundesliga treibt er die Torquote in
  // absurde Höhen – die Grundhaltung eines starken Kaders ist Umschaltspiel.
  // Wer wirklich gewinnen MUSS, bekommt 'offensiv' über suggestTactics().
  else if (rep >= 70) style = 'umschaltspiel';
  else if (rep <= 42 && profile.tempo >= 64) style = 'konter';
  // 'defensiv' ist eine situative Entscheidung (Auswärts beim Spitzenreiter, Führung
  // verteidigen), keine Dauerhaltung. Als Standard für kleine Vereine hat er ganze
  // Ligen erstickt: Sechs Zweitligisten im Dauer-Beton drückten den Ligaschnitt von
  // 2,78 auf 2,30 Tore pro Spiel. Außenseiter spielen jetzt auf Umschalten.
  else if (rep <= 42) style = 'umschaltspiel';
  else if (profile.ausdauer >= 70 && profile.aggressivitaet >= 64) style = 'pressing';
  else if (profile.kopfball >= 70 && profile.technik < 62) style = 'kick_and_rush';
  else style = 'ausgeglichen';

  const sliders = slidersForStyle(style);

  const draft = {
    formation, style, lineup: {}, bench: [], roles: {},
    sliders, setPieces: {}, offsideTrap: false, manMarking: null,
    instructions: defaultInstructions()
  };

  return autoLineup(squad, draft, { respectFitness: true });
}

/** Slider-Vorgabe aus einem Stil ableiten. */
export function slidersForStyle(styleId) {
  const st = STYLES[styleId] || STYLES.ausgeglichen;
  const m = st.mods;
  return {
    tempo: m.tempo,
    breite: clamp(50 + (m.passLaenge - 50) * 0.2, 25, 75),
    pressinghoehe: m.pressinghoehe,
    risiko: m.risiko,
    haerte: clamp(40 + m.pressinghoehe * 0.22, 25, 80),
    offensivdrang: clamp(m.risiko * 0.6 + (100 - m.pressinghoehe) * -0.05 + 30, 15, 92)
  };
}

/** Durchschnittsprofil eines Kaders (Top-16 nach Stärke, damit Ergänzungsspieler nicht verzerren). */
export function squadProfile(players) {
  const pool = (players || []).filter(p => p && p.attributes);
  const core = sortBy(pool, p => ({ key: playerRatingForSlot(p, p.position), desc: true }))
    .slice(0, Math.max(11, Math.min(16, pool.length)));
  const field = core.filter(p => p.position !== 'TW');
  const src = field.length >= 8 ? field : core;

  const m = k => round(avg(src, p => att(p, k)), 1);
  const counts = {};
  for (const p of pool) counts[p.position] = (counts[p.position] || 0) + 1;

  return {
    tempo: m('tempo'), technik: m('technik'), passspiel: m('passspiel'),
    uebersicht: m('uebersicht'), ausdauer: m('ausdauer'), zweikampf: m('zweikampf'),
    kopfball: m('kopfball'), koerper: m('koerper'), schuss: m('schuss'),
    dribbling: m('dribbling'), aggressivitaet: m('aggressivitaet'),
    positionsspiel: m('positionsspiel'), nervenstaerke: m('nervenstaerke'),
    counts,
    staerke: round(avg(core, p => playerRatingForSlot(p, p.position)), 1),
    kadergroesse: pool.length
  };
}

/**
 * Bewertet alle Formationen für einen Kader.
 * @returns {Array<{id, elfSumme, profilBonus, gesamt}>} absteigend sortiert
 */
export function rankFormations(players, profile) {
  const prof = profile || squadProfile(players);
  const out = [];
  for (const id of FORMATION_IDS) {
    const f = FORMATIONS[id];
    // Summe der besten 11 (schnelle Greedy-Variante ohne Nachoptimierung)
    const elfSumme = greedyStrength(players, f);
    // Erfüllt der Kader die Anforderungen der Formation?
    let bonus = 0;
    for (const k in f.anforderungen) {
      const diff = (prof[k] !== undefined ? prof[k] : 55) - f.anforderungen[k];
      bonus += diff > 0 ? Math.min(6, diff * 0.35) : Math.max(-16, diff * 0.8);
    }
    out.push({ id, elfSumme: round(elfSumme, 1), profilBonus: round(bonus, 1), gesamt: round(elfSumme / 11 + bonus * 0.6, 2) });
  }
  return sortBy(out, r => ({ key: r.gesamt, desc: true }));
}

/** Schnelle Greedy-Summe der besten 11 für eine Formation. */
function greedyStrength(players, formation) {
  const pool = (players || []).filter(p => p && p.id && isAvailable(p));
  if (pool.length < 11) return 0;
  const pairs = [];
  for (const p of pool) for (const s of formation.slots) pairs.push({ p, s, v: playerRatingForSlot(p, s.pos) });
  pairs.sort((a, b) => b.v - a.v);
  const takenSlot = new Set(), takenPlayer = new Set();
  let total = 0;
  for (const pr of pairs) {
    if (takenSlot.size >= 11) break;
    if (takenSlot.has(pr.s.id) || takenPlayer.has(pr.p.id)) continue;
    takenSlot.add(pr.s.id); takenPlayer.add(pr.p.id);
    total += pr.v;
  }
  return total;
}

/* =========================================================================
 * 9. VALIDIERUNG
 * ========================================================================= */

/**
 * Prüft eine Taktik auf Fehler (Spiel nicht startbar) und Warnungen (unklug).
 *
 * @param {object} tactics
 * @param {Array} players  Kader (mindestens alle aufgestellten Spieler)
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validateTactics(tactics, players) {
  const errors = [];
  const warnings = [];
  const squad = players || [];

  if (!tactics) {
    return { ok: false, errors: ['Es liegt keine Taktik vor.'], warnings: [] };
  }

  const formation = resolveFormation(tactics.formation);
  if (!formation) {
    errors.push(`Unbekannte Formation "${tactics.formation}".`);
  }
  if (tactics.style && !STYLES[tactics.style]) {
    warnings.push(`Unbekannter Spielstil "${tactics.style}" – es wird ausgeglichen gespielt.`);
  }

  const lineup = tactics.lineup || {};
  const slotIds = formation ? formation.slots.map(s => s.id) : Object.keys(lineup);
  const entries = slotIds
    .map(id => ({ slotId: id, playerId: lineup[id] }))
    .filter(e => !!e.playerId);

  // --- Fehler -------------------------------------------------------------
  if (entries.length < 11) {
    errors.push(`Es sind erst ${entries.length} von 11 Positionen besetzt.`);
  }

  // Doppelte Spieler
  const seen = new Map();
  for (const e of entries) {
    if (seen.has(e.playerId)) {
      const p = byId(squad, e.playerId);
      const nm = p ? p.shortName || p.lastName : e.playerId;
      errors.push(`${nm} ist doppelt aufgestellt.`);
    } else {
      seen.set(e.playerId, e.slotId);
    }
  }

  // Unbekannte Spieler / Torwart / Sperren / Verletzungen
  let keeperCount = 0;
  for (const e of entries) {
    const p = byId(squad, e.playerId);
    if (!p) {
      errors.push(`Aufgestellter Spieler "${e.playerId}" gehört nicht zum Kader.`);
      continue;
    }
    const slot = formation ? formation.slots.find(s => s.id === e.slotId) : null;
    const nm = p.shortName || p.lastName || p.id;
    // Nur ein gelernter Torwart zählt als Torwart – ein Feldspieler im Kasten ist ein Fehler.
    if (slot && slot.pos === 'TW') {
      if (p.position === 'TW') keeperCount++;
      else errors.push(`${nm} ist kein Torwart und kann nicht ins Tor gestellt werden.`);
    } else if (p.position === 'TW') {
      warnings.push(`${nm} ist Torwart und steht als Feldspieler auf dem Platz.`);
    }

    if (isBanned(p)) errors.push(`${nm} ist gesperrt und darf nicht spielen.`);
    if (isInjured(p)) {
      const inj = p.injury && p.injury.name ? ` (${p.injury.name})` : '';
      errors.push(`${nm} ist verletzt${inj} und kann nicht auflaufen.`);
    }
  }

  if (formation && keeperCount === 0) {
    errors.push('Es steht kein Torwart in der Startelf.');
  } else if (!formation) {
    // Ohne Formation notdürftig prüfen
    const anyKeeper = entries.some(e => {
      const p = byId(squad, e.playerId);
      return p && p.position === 'TW';
    });
    if (!anyKeeper) errors.push('Es steht kein Torwart in der Startelf.');
  }

  // --- Warnungen ----------------------------------------------------------
  const starters = [];
  for (const e of entries) {
    const p = byId(squad, e.playerId);
    if (!p) continue;
    starters.push(p);
    const slot = formation ? formation.slots.find(s => s.id === e.slotId) : null;
    const nm = p.shortName || p.lastName || p.id;

    if (slot) {
      const aff = affinity(p, slot.pos);
      if (aff < AFFINITY_BAD) {
        warnings.push(`${nm} spielt als ${slotLabelLong(slot)} völlig außer Position (gelernt: ${POSITION_NAMES[p.position] || p.position}).`);
      } else if (aff < AFFINITY_OK) {
        warnings.push(`${nm} ist auf ${slotLabel(slot)} nicht zu Hause – Abstriche einkalkuliert?`);
      }
    }

    const fit = rt(p, 'fitness', 100);
    if (fit < FITNESS_WARN) {
      warnings.push(`${nm} kommt nur auf ${Math.round(fit)} % Fitness – da droht die Luft auszugehen.`);
    }
  }

  // Führungsspieler
  const hasLeader = starters.some(p => att(p, 'fuehrung') >= 72 || (p.traits || []).includes('leader')
    || (p.traits || []).includes('kabinenleader'));
  if (starters.length && !hasLeader) {
    warnings.push('In der Startelf steht kein echter Führungsspieler – wer übernimmt Verantwortung?');
  }

  // Standards
  const sp = tactics.setPieces || {};
  const inLineup = id => id && starters.some(p => p.id === id);
  if (!inLineup(sp.elfmeter)) warnings.push('Es ist kein Elfmeterschütze bestimmt.');
  if (!inLineup(sp.freistoss)) warnings.push('Es ist kein Freistoßschütze bestimmt.');
  if (!inLineup(sp.ecke)) warnings.push('Es ist kein Eckenschütze bestimmt.');
  if (!inLineup(sp.kapitaen)) warnings.push('Es ist kein Kapitän bestimmt.');

  // Bank
  const bench = tactics.bench || [];
  if (bench.length > MAX_BENCH) {
    errors.push(`Die Bank fasst höchstens ${MAX_BENCH} Spieler (aktuell ${bench.length}).`);
  }
  const benchPlayers = bench.map(id => byId(squad, id)).filter(Boolean);
  for (const p of benchPlayers) {
    const nm = p.shortName || p.lastName || p.id;
    if (isBanned(p)) warnings.push(`${nm} sitzt auf der Bank, ist aber gesperrt.`);
    else if (isInjured(p)) warnings.push(`${nm} sitzt auf der Bank, ist aber verletzt.`);
  }
  const benchDupe = bench.filter(id => seen.has(id));
  for (const id of benchDupe) {
    const p = byId(squad, id);
    errors.push(`${p ? p.shortName || p.lastName : id} steht gleichzeitig in der Startelf und auf der Bank.`);
  }
  if (!benchPlayers.some(p => p.position === 'TW')) {
    warnings.push('Auf der Bank sitzt kein Ersatztorwart – ein Griff ins Klo, falls sich der Keeper verletzt.');
  }

  // Sonstige Plausibilität
  const st = STYLES[tactics.style];
  if (st && formation) {
    if (st.id === 'kick_and_rush' && formation.offensivwert < 45) {
      warnings.push('Lange Bälle ohne Abnehmer: Die Formation hat kaum Präsenz im Strafraum.');
    }
    if (st.id === 'ballbesitz' && formation.kompaktheit < 50) {
      warnings.push('Ballbesitzfußball mit weiten Abständen – die Passwege werden riskant lang.');
    }
    if (st.id === 'pressing') {
      const cond = avg(starters, p => att(p, 'ausdauer'));
      if (cond && cond < 62) warnings.push('Für dieses Pressing fehlt der Mannschaft schlicht die Kondition.');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/* =========================================================================
 * 10. FORMATIONS-KONTER
 * ========================================================================= */

/**
 * Wie gut schlägt sich Formation A gegen Formation B?
 * Positive Werte = Vorteil für A. Ergebnis grob -20..+20.
 *
 * Wirkende Effekte (bewusst simpel und nachvollziehbar für das Balancing):
 *  1. Mittelfeldüberzahl  — mehr Zentrale = mehr Ballkontrolle
 *  2. Breite vs. Enge     — breite Formation bespielt enge Formation außen
 *  3. Enge vs. Breite     — enge Formation überlädt das Zentrum der breiten
 *  4. Sturm vs. Kette     — 2 Spitzen gegen Dreierkette / 1 Spitze gegen Fünferkette
 *  5. Offensive vs. Defensive — hohes Risiko wird von Kontertypen bestraft
 */
export function formationMatchup(aId, bId) {
  const a = resolveFormation(aId), b = resolveFormation(bId);
  if (!a || !b) return 0;
  const la = formationLines(a.id), lb = formationLines(b.id);
  let v = 0;

  // 1. Mittelfeldüberzahl
  v += clamp((la.mittelfeld - lb.mittelfeld) * 2.6, -8, 8);

  // 2./3. Breite gegen Enge
  const dBreite = a.breite - b.breite;
  if (dBreite > 12) v += Math.min(6, (dBreite - 12) * 0.25);
  if (dBreite < -12) v += Math.min(4, (-dBreite - 12) * 0.16);   // Enge überlädt das Zentrum

  // 4. Sturmzahl gegen Kettenlänge
  if (la.sturm >= 2 && lb.abwehr === 3) v += 4.5;                 // zwei Spitzen binden drei IV
  if (la.sturm >= 3 && lb.abwehr === 3) v += 2.0;
  if (la.sturm === 1 && lb.abwehr >= 5) v -= 4.0;                 // Solospitze gegen Fünferkette
  if (la.sturm >= 3 && lb.abwehr >= 5) v -= 2.0;

  // 5. Risiko/Absicherung
  v += clamp((a.defensivwert - b.offensivwert) * 0.06, -4, 4);
  v += clamp((a.offensivwert - b.defensivwert) * 0.06, -4, 4);
  v -= clamp((a.risiko - 50) * 0.03, -2.5, 2.5);                   // Vabanque wird bestraft
  v += clamp((a.kompaktheit - b.kompaktheit) * 0.04, -3, 3);

  return round(v, 2);
}

/**
 * Gegen welche Formationen ist diese Formation stark bzw. anfällig?
 * @param {string} formationId
 * @returns {{strongVs:string[], weakVs:string[], erklaerung:string}}
 */
export function formationCounter(formationId) {
  const f = resolveFormation(formationId);
  if (!f) return { strongVs: [], weakVs: [], erklaerung: 'Unbekannte Formation.' };

  const scored = FORMATION_IDS
    .filter(id => id !== f.id)
    .map(id => ({ id, v: formationMatchup(f.id, id) }));

  const sorted = sortBy(scored, r => ({ key: r.v, desc: true }));
  const strongVs = sorted.slice(0, 3).filter(r => r.v > 0.5).map(r => r.id);
  const weakVs = sorted.slice(-3).reverse().filter(r => r.v < -0.5).map(r => r.id);

  const lines = formationLines(f.id);
  const teile = [];
  teile.push(`${f.name}: ${lines.abwehr} Verteidiger, ${lines.mittelfeld} im Mittelfeld, ${lines.sturm} vorne.`);
  if (f.breite >= 72) teile.push('Die Formation lebt von der Breite und zieht enge Gegner auseinander.');
  else if (f.breite <= 45) teile.push('Sehr eng gestaffelt – im Zentrum überlegen, außen verwundbar.');
  if (f.kompaktheit >= 72) teile.push('Die Abstände zwischen den Ketten sind kurz, dazwischen findet der Gegner kaum Räume.');
  if (f.risiko >= 70) teile.push('Das Risiko ist hoch: Jeder Ballverlust kann zum Konter führen.');
  else if (f.risiko <= 30) teile.push('Sehr absichernd angelegt – dafür fehlt vorne die Wucht.');
  if (strongVs.length) teile.push(`Besonders gut aufgehoben gegen: ${strongVs.map(id => FORMATIONS[id].name).join(', ')}.`);
  if (weakVs.length) teile.push(`Probleme drohen gegen: ${weakVs.map(id => FORMATIONS[id].name).join(', ')}.`);

  return { strongVs, weakVs, erklaerung: teile.join(' ') };
}

/* =========================================================================
 * 11. CO-TRAINER-VORSCHLAG
 * ========================================================================= */

/**
 * Der Co-Trainer schlägt Formation, Stil und Slider vor – mit Begründung.
 *
 * @param {Array} ownPlayers
 * @param {object} [opponentTeam]  { club, players, tactics, staerke }
 * @param {object} [context]       { heim, favorit, wichtig, muessGewinnen, wetter,
 *                                   tabellenplatz, gegnerPlatz, competition, restTage }
 * @returns {{formation:string, style:string, sliders:object, begruendung:string[]}}
 */
export function suggestTactics(ownPlayers, opponentTeam, context = {}) {
  const squad = (ownPlayers || []).filter(p => p && p.id);
  const profile = squadProfile(squad);
  const begruendung = [];

  const opp = opponentTeam || {};
  const oppFormationId = opp.tactics && opp.tactics.formation ? opp.tactics.formation : null;
  const oppStyleId = opp.tactics && opp.tactics.style ? opp.tactics.style : null;
  const oppProfile = opp.players && opp.players.length ? squadProfile(opp.players) : null;

  // --- Kräfteverhältnis ---------------------------------------------------
  let oppStrength = typeof opp.staerke === 'number' ? opp.staerke
    : oppProfile ? oppProfile.staerke : profile.staerke;
  const heim = context.heim !== false;
  const diff = profile.staerke - oppStrength + (heim ? 2.5 : -2.5);
  const favorit = context.favorit !== undefined ? !!context.favorit : diff > 3;
  const underdog = context.favorit !== undefined ? !context.favorit && diff < 0 : diff < -3;

  // --- Formation ----------------------------------------------------------
  const ranked = rankFormations(squad, profile);
  // Kaderpassung (60 %) + Konterwirkung gegen die gegnerische Formation (40 %)
  const scored = ranked.map(r => {
    const counter = oppFormationId ? formationMatchup(r.id, oppFormationId) : 0;
    const f = FORMATIONS[r.id];
    let situativ = 0;
    if (underdog) situativ += (f.defensivwert - 55) * 0.06 - (f.risiko - 50) * 0.05;
    if (favorit) situativ += (f.offensivwert - 55) * 0.05;
    if (context.muessGewinnen) situativ += (f.offensivwert - 55) * 0.09 - (f.defensivwert - 55) * 0.02;
    return { id: r.id, gesamt: r.gesamt + counter * 0.4 + situativ, kader: r.gesamt, counter: round(counter, 1) };
  });
  const best = sortBy(scored, s => ({ key: s.gesamt, desc: true }))[0];
  const formation = best ? best.id : '4-4-2';
  const fObj = FORMATIONS[formation];

  begruendung.push(`Formationsempfehlung: ${fObj.name}. ${fObj.staerken[0]} passt am besten zu diesem Kader.`);
  if (oppFormationId && FORMATIONS[oppFormationId]) {
    const oc = best ? best.counter : 0;
    if (oc > 1.5) begruendung.push(`Gegen das ${FORMATIONS[oppFormationId].name} des Gegners haben wir damit einen strukturellen Vorteil.`);
    else if (oc < -1.5) begruendung.push(`Achtung: Gegen das ${FORMATIONS[oppFormationId].name} bleibt das ein Wagnis – wir brauchen Disziplin.`);
    else begruendung.push(`Gegen das ${FORMATIONS[oppFormationId].name} des Gegners ist das ein sauberes Gegenstück.`);
  }

  // --- Stil ---------------------------------------------------------------
  let style = 'ausgeglichen';
  if (context.muessGewinnen) {
    style = profile.tempo >= 66 ? 'umschaltspiel' : 'offensiv';
    begruendung.push('Wir brauchen die drei Punkte – also volles Risiko nach vorn.');
  } else if (underdog) {
    if (profile.tempo >= 66) { style = 'konter'; begruendung.push('Als Außenseiter lassen wir den Ball dem Gegner und stechen über unser Tempo zu.'); }
    else { style = 'defensiv'; begruendung.push('Der Gegner ist eine Nummer zu groß – wir stellen die Räume zu und halten das Ergebnis flach.'); }
  } else if (favorit) {
    if (profile.technik >= 66 && profile.passspiel >= 66) { style = 'ballbesitz'; begruendung.push('Wir sind spielerisch überlegen: Ball laufen lassen und den Gegner müde spielen.'); }
    else if (profile.ausdauer >= 68 && profile.aggressivitaet >= 62) { style = 'pressing'; begruendung.push('Wir haben die frischeren Beine – früh anlaufen und den Gegner im Aufbau stellen.'); }
    else { style = 'offensiv'; begruendung.push('Als Favorit gehen wir das Spiel offensiv an.'); }
  } else {
    if (profile.kopfball >= 70 && profile.technik < 60) { style = 'kick_and_rush'; begruendung.push('Technisch sind wir limitiert, aber kopfballstark – lange Bälle sind unser Weg.'); }
    else if (profile.tempo >= 68) { style = 'umschaltspiel'; begruendung.push('Unsere Stärke ist der Umschaltmoment – mittelhoch verteidigen, dann sofort nach vorn.'); }
    else if (profile.technik >= 66) { style = 'ballbesitz'; begruendung.push('Mit dieser Technik im Mittelfeld sollten wir den Ball in den eigenen Reihen halten.'); }
    else begruendung.push('Auf Augenhöhe: eine ausgeglichene Einstellung ist die vernünftigste Wahl.');
  }

  // Gegnerstil kontern
  if (oppStyleId === 'pressing' || oppStyleId === 'gegenpressing') {
    begruendung.push('Der Gegner presst hoch – schnelle Verlagerungen und lange Bälle nehmen den Druck raus.');
  } else if (oppStyleId === 'ballbesitz' && style !== 'konter') {
    begruendung.push('Der Gegner will den Ball haben. Damit können wir leben, wenn wir kompakt bleiben.');
  } else if (oppStyleId === 'konter' && (style === 'offensiv' || style === 'ballbesitz')) {
    begruendung.push('Vorsicht vor dem Umschaltspiel: Die Restverteidigung muss stehen.');
  }

  // --- Slider -------------------------------------------------------------
  const sliders = slidersForStyle(style);
  if (context.wetter === 'regen' || context.wetter === 'schnee') {
    sliders.tempo = clamp(sliders.tempo - 8, 0, 100);
    begruendung.push('Bei diesem Wetter nehmen wir Tempo raus – der Ball rutscht, Fehler werden teuer.');
  }
  if (context.wetter === 'hitze') {
    sliders.tempo = clamp(sliders.tempo - 10, 0, 100);
    sliders.pressinghoehe = clamp(sliders.pressinghoehe - 10, 0, 100);
    begruendung.push('Bei der Hitze wäre Dauerpressing Selbstmord – wir teilen uns die Kräfte ein.');
  }
  if (heim) {
    sliders.offensivdrang = clamp(sliders.offensivdrang + 6, 0, 100);
    begruendung.push('Vor eigenem Publikum gehen wir einen Tick mutiger nach vorn.');
  } else {
    sliders.risiko = clamp(sliders.risiko - 5, 0, 100);
  }
  if (context.restTage !== undefined && context.restTage <= 3) {
    sliders.pressinghoehe = clamp(sliders.pressinghoehe - 12, 0, 100);
    begruendung.push('Nur wenige Tage Pause – wir sparen uns die Körner fürs Pressing.');
  }
  if (context.wichtig) {
    sliders.haerte = clamp(sliders.haerte + 8, 0, 100);
    begruendung.push('Ein Spiel dieser Größenordnung entscheidet sich über die Zweikämpfe.');
  }

  // --- Kaderhinweise ------------------------------------------------------
  const fitProblems = squad.filter(p => isAvailable(p) && rt(p, 'fitness', 100) < FITNESS_OK).length;
  if (fitProblems >= 4) {
    begruendung.push(`${fitProblems} Spieler sind nicht bei voller Fitness – über Rotation nachdenken.`);
  }
  const out = squad.filter(p => !isAvailable(p));
  if (out.length) {
    begruendung.push(`Nicht einsatzfähig: ${out.slice(0, 4).map(p => p.shortName || p.lastName).join(', ')}${out.length > 4 ? ' u. a.' : ''}.`);
  }
  for (const k in fObj.anforderungen) {
    const have = profile[k] !== undefined ? profile[k] : 55;
    if (have < fObj.anforderungen[k] - 4) {
      begruendung.push(`Warnung: ${fObj.name} verlangt mehr ${attName(k)}, als der Kader im Schnitt mitbringt.`);
    }
  }
  const stObj = STYLES[style];
  for (const k of stObj.mods.benoetigteAttribute) {
    const have = profile[k] !== undefined ? profile[k] : 55;
    if (have < 58) begruendung.push(`Für "${stObj.name}" wäre mehr ${attName(k)} wünschenswert (Schnitt ${have}).`);
  }

  return { formation, style, sliders, begruendung };
}

/** Deutsches Attributlabel (kleiner Wrapper, damit oben keine Imports nötig sind). */
function attName(key) {
  const map = {
    tempo: 'Tempo', technik: 'Technik', passspiel: 'Passspiel', uebersicht: 'Übersicht',
    ausdauer: 'Ausdauer', zweikampf: 'Zweikampfstärke', kopfball: 'Kopfballstärke',
    koerper: 'Körperlichkeit', schuss: 'Abschlussstärke', dribbling: 'Dribbling',
    aggressivitaet: 'Aggressivität', positionsspiel: 'Positionsspiel',
    nervenstaerke: 'Nervenstärke', sprungkraft: 'Sprungkraft', standards: 'Standardstärke'
  };
  return map[key] || key;
}

/* =========================================================================
 * 12. ZUSATZ-EXPORTE FÜR UI UND RATINGS
 * ========================================================================= */

/** Summiert alle Team-Effekte aus Rollen und Zusatzanweisungen einer Taktik. */
export function tacticsTeamEffects(tactics, players) {
  const out = {};
  for (const k of TEAM_EFFECT_KEYS) out[k] = 0;

  const roles = (tactics && tactics.roles) || {};
  const lineupIds = new Set(Object.values((tactics && tactics.lineup) || {}));
  for (const pid in roles) {
    if (lineupIds.size && !lineupIds.has(pid)) continue;
    const role = ROLES[roles[pid]];
    if (!role) continue;
    // Erfüllt der Spieler die Anforderungen? Sonst wirkt die Rolle nur halb.
    const p = players ? byId(players, pid) : null;
    let faktor = 1;
    if (p) {
      let miss = 0, n = 0;
      for (const k in role.benoetigt) { n++; if (att(p, k) < role.benoetigt[k]) miss++; }
      if (n) faktor = 1 - (miss / n) * 0.5;
    }
    for (const k in role.teamEffekt) {
      if (out[k] === undefined) out[k] = 0;
      out[k] += role.teamEffekt[k] * faktor;
    }
  }

  const instr = (tactics && tactics.instructions) || {};
  for (const key in instr) {
    if (!instr[key]) continue;
    const ins = INSTRUCTIONS[key];
    if (!ins) continue;
    for (const k in ins.mods) {
      if (TEAM_EFFECT_KEYS.includes(k)) out[k] = (out[k] || 0) + ins.mods[k];
    }
  }

  for (const k in out) out[k] = round(out[k], 1);
  return out;
}

/** Alle Rollen, die für eine Position in Frage kommen (für Auswahlmenüs). */
export function rolesForPosition(pos) {
  return ROLE_IDS.filter(id => ROLES[id].positions.includes(pos));
}

/** Menschliche Kurzbeschreibung einer Taktik (für Presse/Spielbericht). */
export function describeTactics(tactics) {
  const f = resolveFormation(tactics && tactics.formation);
  const s = STYLES[(tactics && tactics.style) || 'ausgeglichen'] || STYLES.ausgeglichen;
  if (!f) return `${s.name} in unbekannter Grundordnung.`;
  const on = INSTRUCTION_IDS.filter(k => tactics && tactics.instructions && tactics.instructions[k]);
  const anw = on.length ? ` Zusätzlich: ${on.map(k => INSTRUCTIONS[k].name).join(', ')}.` : '';
  return `${f.name}, ${s.name}.${anw}`;
}

/** Kleiner Trait-Hinweis für die UI (nutzt TRAITS aus constants.js). */
export function setPieceHint(player) {
  if (!player) return '';
  const t = (player.traits || []).find(k => ['elfmeterkiller', 'freistossspezialist', 'eckenspezialist'].includes(k));
  return t && TRAITS[t] ? TRAITS[t].name : '';
}
