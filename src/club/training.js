/**
 * club/training.js — Trainingswoche, Einheiten, Attribut-Entwicklung, Form, Frische.
 * ============================================================================
 *
 * Training ist in TRAUMVEREIN kein Beiwerk, sondern der zweite Motor neben dem
 * Transfermarkt. Wer klug plant, formt aus einem 62er-Talent einen 84er-Star.
 * Wer sein Team totlaufen lässt, schaut beim Absturz zu.
 *
 * ZIELKORRIDORE (nachgemessen von tools/test-training.js):
 *   • Talent 19 J. (ovr 62 / pot 85), gutes Training + Stammplatz  → mit 25 ovr 80–85
 *   • dasselbe Talent ohne Spielzeit                               → mit 25 ca. ovr 70
 *   • Peak-Spieler (24–28) mit Luft nach oben, sehr gutes Training  → +1 bis +2 pro Saison
 *   • Veteran (33 J.)                                              → −2 bis −4 pro Saison
 *
 * SO RECHNET DAS MODUL
 *   1. Jede Woche bekommt ein Spieler ein Rohpunkte-Budget P (Attributpunkte).
 *      P = BASIS × Alter × Potenzial × Spielzeit × Trainingsplan × Stab × Moral
 *          × Persönlichkeit × Traits × Frische × difficulty.xpGain
 *   2. Der Wochenplan erzeugt einen Schwerpunktvektor (welche Attribute?).
 *      Ein Drittel davon ist immer positionsspezifisches Grundprogramm.
 *   3. Zuwachs je Attribut = P × Schwerpunktanteil. Der Overall folgt daraus
 *      automatisch (Overall = positionsgewichtetes Mittel, siehe engine/ratings.js).
 *      Wer die falschen Dinge trainiert, verschenkt also echte Entwicklung.
 *   4. Ab DECLINE_START kommt ein Abbau-Vektor dazu, der in Overall-Punkten
 *      kalibriert ist (Tempo/Ausdauer/Sprungkraft zuerst, Übersicht/Führung steigen).
 *
 * ZUSTÄNDIGKEIT (Abschnitt 11 der CONTRACTS.md)
 *   Dieses Modul schreibt: player.attributes, player.form, player.sharpness,
 *   player.fitness, player.training.*, club.training.*.
 *   Es fasst NICHT an: Verletzungsheilung (club/medical.js), Moral im Großen
 *   (club/morale.js), Buchhaltung (club/finances.js). Ausnahmen, bewusst und klein:
 *     – Trainingsverletzungen werden hier ERZEUGT (player.injury), aber nie geheilt.
 *     – ±2 Moralpunkte pro Woche aus der Trainingsarbeit.
 *     – Das Trainingslager bucht seine Kosten mit der in core/state.js
 *       dokumentierten Ledger-Zeile { day, season, betrag, kategorie, text }.
 *
 * Kein DOM, kein Math.random(), kein Date.now().
 */

import {
  ATTRIBUTES, ATTRIBUTE_NAMES, POSITION_WEIGHTS, KEEPER_ATTRIBUTES,
  INJURY_TYPES, DIFFICULTIES
} from '../core/constants.js';
import { clamp, round, avg, sortBy, formatMoney } from '../core/util.js';
import { createRng, hashString } from '../core/rng.js';
import { playerOverall } from '../engine/ratings.js';
import { SAISON_TAGE } from '../data/leagues.js';
import { verletzen } from './medical.js';

/* ==========================================================================
 * 1. BALANCING — alle Stellschrauben an einer Stelle
 * ======================================================================== */

/** Trainingswochen pro Saison (52 minus Sommer-/Winterurlaub). */
export const WOCHEN_PRO_SAISON = 44;

/** Rohe Attributpunkte pro Woche unter Idealbedingungen (vor allen Faktoren). */
const BASIS_WOCHENPUNKTE = 0.395;

/** Altersfaktor der Lernfähigkeit. Zwischenwerte werden interpoliert. */
const ALTER_KURVE = [
  [15, 1.05], [17, 1.22], [19, 1.30], [21, 1.16], [23, 0.92],
  [25, 0.70], [27, 0.52], [29, 0.30], [31, 0.16], [34, 0.08], [40, 0.04]
];

/** Ab hier zehrt das Alter sichtbar an der Substanz. */
const DECLINE_START = 29;

/** Overall-Verlust pro Saison durch Alterung (vor Milderung). */
const ABBAU_KURVE = [
  [28, 0.0], [29, 0.45], [30, 1.05], [31, 1.70], [32, 2.25],
  [33, 2.85], [34, 3.45], [35, 4.10], [36, 4.70], [40, 5.60]
];

/**
 * Abbau-Profil: 1.0 = fällt zuerst weg, negativ = wächst mit der Erfahrung.
 * Wird so skaliert, dass der Overall-Verlust exakt der ABBAU_KURVE entspricht.
 */
const ABBAU_PROFIL = {
  tempo: 1.00, sprungkraft: 0.92, ausdauer: 0.86, dribbling: 0.60, koerper: 0.52,
  zweikampf: 0.46, schuss: 0.45, technik: 0.40, kopfball: 0.40, passspiel: 0.34,
  standards: 0.28, aggressivitaet: 0.30, reflexe: 0.50, strafraumbeherrschung: 0.36,
  abschlag: 0.30, stellungsspiel: 0.18,
  uebersicht: -0.30, positionsspiel: -0.32, nervenstaerke: -0.26, fuehrung: -0.42
};

/** Torhüter altern gnädiger. */
const ABBAU_TORWART = 0.72;

/** Potenzialfaktor: rest / (rest + POT_HALBWERT). Bei rest = 0 ist Schluss. */
const POT_HALBWERT = 6.5;

/** Ein Attribut darf maximal so weit über das Potenzial hinauswachsen. */
const ATTR_UEBER_POT = 6;

/** Spielzeitfaktor: keine Minuten … Dauerbrenner. */
const SPIELZEIT_MIN = 0.34;
const SPIELZEIT_SPANNE = 0.74;

/** Anteil des positionsspezifischen Grundprogramms am Schwerpunktvektor. */
const GRUNDPROGRAMM_ANTEIL = 0.35;

/** Referenz-Trainingsgüte (Σ Schwerpunkt × Positionsgewicht) eines guten Plans. */
const GUETE_REFERENZ = 0.128;

/** Stabsfaktor: von der Kreisliga-Pfeife bis zum Ausbilder-Papst. */
const STAB_MIN = 0.62;
const STAB_MAX = 1.38;

/** Frischefaktor der Entwicklung: ausgelaugte Spieler lernen nichts. */
const FRISCHE_MIN = 0.58;

/** Moral- und Persönlichkeitseinfluss. */
const MORAL_SPANNE = 0.22;
const PERSOENLICHKEIT = {
  profi: 1.14, ehrgeizig: 1.08, fuehrungstyp: 1.04, loyal: 1.0,
  gelassen: 0.94, geldgierig: 0.9, schwierig: 0.86
};

/**
 * Mentorenbonus (club/chemie.js, Roadmap-Stufe 4, Punkt 2).
 *
 * Eine Legende neben dem Trainingsplatz ist die billigste Ausbildungsmaßnahme,
 * die ein Verein haben kann: Bei einer perfekten Paarung (Passung 100) lernt
 * das Talent 42 % schneller, bei einer typischen (Passung 65) rund 27 %.
 * Zum Vergleich: der Trainerstab spannt 0,62 bis 1,38, das Trait `wunderkind`
 * steht bei 1,38 — der Mentor bleibt also unter dem größten Einzelhebel des
 * Moduls. Gelesen wird ausschließlich `player.mentor`; club/chemie.js wird
 * bewusst NICHT importiert, damit die beiden Module nicht im Kreis
 * voneinander abhängen.
 */
const MENTOR_GEWINN_MAX = 0.42;
const MENTOR_STAERKE_STANDARD = 55;   // wenn ein Paar ohne Passungswert gesetzt wurde

/** Trait-Multiplikatoren auf den Zuwachs. */
const TRAIT_LERN = { wunderkind: 1.38, spaetzuender: 1.12, laufwunder: 1.03, mimose: 0.95 };
/** Trait-Multiplikatoren auf den Abbau (kleiner = altert langsamer). */
const TRAIT_ABBAU = { spaetzuender: 0.58, laufwunder: 0.86, glasknochen: 1.12 };

/** Individualtraining: Anteil des Schwerpunkts, der auf ein Attribut wandert. */
const INDIV_ANTEIL_MIN = 0.22;
const INDIV_ANTEIL_SPANNE = 0.44;
const INDIV_ERMUEDUNG = 2.2;

/* --- Frische / Ermüdung ---------------------------------------------------- */
const ERM_SKALA = 0.48;          // Umrechnung Einheit.ermuedung → Fitnesspunkte
const REGEN_BASIS = 3.3;         // Grunderholung pro Tag
const SPIEL_BELASTUNG = 8.0;     // Fitnesskosten für 90 Spielminuten
const URLAUB_ERHOLUNG = 5.5;

/* --- Frische im Wettkampf (sharpness) -------------------------------------- */
const SHARP_TRAEGHEIT = 0.30;
const SHARP_OHNE_SPIEL = 34;

/* --- Form ------------------------------------------------------------------ */
const FORM_TRAEGHEIT = 0.34;
const FORM_RAUSCHEN = 4.2;
const FORM_BANK_MALUS = 5.0;
const FORM_NOTE_REF = 6.2;

/* --- Verletzungsrisiko ------------------------------------------------------ */
const RISIKO_SKALA = 0.00062;    // je Risikopunkt und Trainingstag
const RISIKO_ALTER = 0.022;      // je Jahr über 28
const RISIKO_GLASKNOCHEN = 1.9;

/* --- Moral aus dem Training ------------------------------------------------- */
const MORAL_SKALA = 0.55;
const MORAL_MAX_WOCHE = 2.2;

/* ==========================================================================
 * 2. TRAININGSEINHEITEN
 * ========================================================================
 * dauer            Minuten auf dem Platz
 * attribute        welche Attribute die Einheit anspricht (relative Gewichte)
 * ermuedung        Belastung; NEGATIV = die Einheit erholt
 * risiko           Verletzungsrisiko-Punkte
 * moralEffekt      Laune der Mannschaft (−1 … +1.2)
 * benoetigtStab    Stabsrolle, die diese Einheit leitet (state.staff[].role)
 * minAlterEffekt   Bis zu diesem Alter volle Aufbauwirkung. Danach hält die
 *                  Einheit den Wert nur noch (ALTER_ERHALT), statt ihn zu heben —
 *                  Sprinttraining bringt einem 33-Jährigen eben nichts mehr.
 */

const ALTER_ERHALT = 0.35;

export const EINHEITEN = {
  ausdauerlauf: {
    id: 'ausdauerlauf', name: 'Ausdauerlauf', kategorie: 'kondition',
    desc: 'Waldlauf im Nieselregen. Niemand mag ihn, jeder braucht ihn.',
    dauer: 75, attribute: { ausdauer: 1.0, koerper: 0.15 },
    ermuedung: 6, risiko: 1.0, moralEffekt: -0.15, benoetigtStab: 'athletik', minAlterEffekt: 34
  },
  intervalltraining: {
    id: 'intervalltraining', name: 'Intervalltraining', kategorie: 'kondition',
    desc: 'Vollgas, Pause, Vollgas. Danach liegt die halbe Mannschaft im Gras.',
    dauer: 70, attribute: { ausdauer: 0.8, tempo: 0.4, koerper: 0.2 },
    ermuedung: 8, risiko: 1.8, moralEffekt: -0.3, benoetigtStab: 'athletik', minAlterEffekt: 32
  },
  kraftraum: {
    id: 'kraftraum', name: 'Kraftraum', kategorie: 'kondition',
    desc: 'Eisen bewegen, bis das Trikot spannt.',
    dauer: 60, attribute: { koerper: 1.0, sprungkraft: 0.35, zweikampf: 0.2 },
    ermuedung: 5, risiko: 1.2, moralEffekt: -0.05, benoetigtStab: 'athletik', minAlterEffekt: 35
  },
  sprinttraining: {
    id: 'sprinttraining', name: 'Sprinttraining', kategorie: 'kondition',
    desc: 'Antritte über 20 Meter. Für junge Beine ein Segen, für alte ein Risiko.',
    dauer: 55, attribute: { tempo: 1.0, sprungkraft: 0.2 },
    ermuedung: 7, risiko: 2.4, moralEffekt: 0.05, benoetigtStab: 'athletik', minAlterEffekt: 29
  },
  beweglichkeit: {
    id: 'beweglichkeit', name: 'Beweglichkeit', kategorie: 'kondition',
    desc: 'Dehnen, Mobilisieren, Rumpfstabilität. Der Physio strahlt.',
    dauer: 45, attribute: { sprungkraft: 0.5, technik: 0.25, ausdauer: 0.15 },
    ermuedung: 2, risiko: 0.4, moralEffekt: 0.1, benoetigtStab: 'physio', minAlterEffekt: 37
  },

  passspiel: {
    id: 'passspiel', name: 'Passspiel', kategorie: 'technik',
    desc: 'Rondo, Doppelpass, Verlagerung. Das Einmaleins.',
    dauer: 60, attribute: { passspiel: 1.0, uebersicht: 0.3, technik: 0.2 },
    ermuedung: 3, risiko: 0.5, moralEffekt: 0.1, benoetigtStab: 'cotrainer', minAlterEffekt: 35
  },
  ballannahme: {
    id: 'ballannahme', name: 'Ballan- und -mitnahme', kategorie: 'technik',
    desc: 'Erster Kontakt. Wer den verstolpert, spielt bei uns nicht.',
    dauer: 55, attribute: { technik: 1.0, dribbling: 0.25, passspiel: 0.2 },
    ermuedung: 3, risiko: 0.5, moralEffekt: 0.05, benoetigtStab: 'cotrainer', minAlterEffekt: 34
  },
  dribbling: {
    id: 'dribbling', name: 'Dribbling', kategorie: 'technik',
    desc: 'Hütchen, Finten, ein Gegner aus Fleisch und Blut.',
    dauer: 55, attribute: { dribbling: 1.0, technik: 0.35, tempo: 0.15 },
    ermuedung: 4, risiko: 0.9, moralEffekt: 0.15, benoetigtStab: 'cotrainer', minAlterEffekt: 31
  },
  torschuss: {
    id: 'torschuss', name: 'Torschuss', kategorie: 'technik',
    desc: 'Bälle aufs Tor dreschen, bis die Netze qualmen.',
    dauer: 55, attribute: { schuss: 1.0, technik: 0.2, nervenstaerke: 0.15 },
    ermuedung: 4, risiko: 0.8, moralEffekt: 0.25, benoetigtStab: 'cotrainer', minAlterEffekt: 34
  },
  kopfball: {
    id: 'kopfball', name: 'Kopfballtraining', kategorie: 'technik',
    desc: 'Hoch, höher, Brummschädel.',
    dauer: 45, attribute: { kopfball: 1.0, sprungkraft: 0.4, koerper: 0.2 },
    ermuedung: 5, risiko: 1.6, moralEffekt: 0.0, benoetigtStab: 'cotrainer', minAlterEffekt: 33
  },
  standards: {
    id: 'standards', name: 'Standards', kategorie: 'technik',
    desc: 'Ecken und Freistöße. Ein Drittel aller Tore fällt so — sagt der Co-Trainer.',
    dauer: 45, attribute: { standards: 1.0, schuss: 0.25, technik: 0.2 },
    ermuedung: 2, risiko: 0.4, moralEffekt: 0.05, benoetigtStab: 'cotrainer', minAlterEffekt: 37
  },
  flanken: {
    id: 'flanken', name: 'Flankentraining', kategorie: 'technik',
    desc: 'Von außen scharf in die Mitte. Der Zielspieler freut sich.',
    dauer: 50, attribute: { standards: 0.5, passspiel: 0.5, technik: 0.25 },
    ermuedung: 3, risiko: 0.6, moralEffekt: 0.05, benoetigtStab: 'cotrainer', minAlterEffekt: 35
  },

  taktik_defensiv: {
    id: 'taktik_defensiv', name: 'Defensivtaktik', kategorie: 'taktik',
    desc: 'Kette schieben, Räume zustellen, Hütchen anschreien.',
    dauer: 70, attribute: { positionsspiel: 1.0, zweikampf: 0.4, uebersicht: 0.25 },
    ermuedung: 3, risiko: 0.3, moralEffekt: -0.1, benoetigtStab: 'cotrainer', minAlterEffekt: 39
  },
  taktik_offensiv: {
    id: 'taktik_offensiv', name: 'Offensivtaktik', kategorie: 'taktik',
    desc: 'Einstudierte Spielzüge bis in die Schlafphase.',
    dauer: 70, attribute: { uebersicht: 1.0, positionsspiel: 0.5, passspiel: 0.25 },
    ermuedung: 3, risiko: 0.3, moralEffekt: -0.05, benoetigtStab: 'cotrainer', minAlterEffekt: 39
  },
  pressing: {
    id: 'pressing', name: 'Pressingschulung', kategorie: 'taktik',
    desc: 'Anlaufen, nachsetzen, Ball erobern. Kostet Körner.',
    dauer: 65, attribute: { aggressivitaet: 0.8, ausdauer: 0.6, zweikampf: 0.5 },
    ermuedung: 7, risiko: 1.4, moralEffekt: 0.0, benoetigtStab: 'cotrainer', minAlterEffekt: 32
  },
  umschaltspiel: {
    id: 'umschaltspiel', name: 'Umschaltspiel', kategorie: 'taktik',
    desc: 'Drei Sekunden nach Ballgewinn entscheidet sich alles.',
    dauer: 60, attribute: { uebersicht: 0.6, tempo: 0.5, passspiel: 0.5, positionsspiel: 0.3 },
    ermuedung: 5, risiko: 0.8, moralEffekt: 0.1, benoetigtStab: 'cotrainer', minAlterEffekt: 34
  },
  abseitsfalle: {
    id: 'abseitsfalle', name: 'Abseitsfalle', kategorie: 'taktik',
    desc: 'Arm hoch und beten, dass der Linienrichter hinschaut.',
    dauer: 40, attribute: { positionsspiel: 1.0, uebersicht: 0.4 },
    ermuedung: 2, risiko: 0.2, moralEffekt: -0.15, benoetigtStab: 'cotrainer', minAlterEffekt: 39
  },
  standardverteidigung: {
    id: 'standardverteidigung', name: 'Standardverteidigung', kategorie: 'taktik',
    desc: 'Wer nimmt wen? Diese Frage hat schon Meisterschaften gekostet.',
    dauer: 45, attribute: { kopfball: 0.6, positionsspiel: 0.6, zweikampf: 0.35 },
    ermuedung: 3, risiko: 0.7, moralEffekt: -0.1, benoetigtStab: 'cotrainer', minAlterEffekt: 37
  },

  spielformen: {
    id: 'spielformen', name: 'Spielformen', kategorie: 'spiel',
    desc: 'Fünf gegen fünf auf Kleinfeld. Da lernt man mehr als in jeder Theoriestunde.',
    dauer: 70, attribute: { technik: 0.4, passspiel: 0.4, uebersicht: 0.35, zweikampf: 0.3, dribbling: 0.25 },
    ermuedung: 5, risiko: 1.0, moralEffekt: 0.3, benoetigtStab: 'cotrainer', minAlterEffekt: 35
  },
  abschlussspiel: {
    id: 'abschlussspiel', name: 'Abschlussspiel', kategorie: 'spiel',
    desc: 'Elf gegen elf, volle Pulle. Der Klassiker vor dem Spieltag.',
    dauer: 75, attribute: { schuss: 0.5, positionsspiel: 0.35, nervenstaerke: 0.3, zweikampf: 0.3, ausdauer: 0.2 },
    ermuedung: 6, risiko: 1.5, moralEffekt: 0.35, benoetigtStab: 'cotrainer', minAlterEffekt: 34
  },
  torwarttraining: {
    id: 'torwarttraining', name: 'Torwarttraining', kategorie: 'spezial',
    desc: 'Hechten, fangen, abschlagen. Die Feldspieler grinsen — bis sie mal ins Tor müssen.',
    dauer: 60, attribute: { reflexe: 1.0, stellungsspiel: 0.6, strafraumbeherrschung: 0.5, abschlag: 0.35 },
    ermuedung: 4, risiko: 0.8, moralEffekt: 0.1, benoetigtStab: 'torwarttrainer', minAlterEffekt: 37,
    nurTorwart: true
  },
  mentaltraining: {
    id: 'mentaltraining', name: 'Mentaltraining', kategorie: 'spezial',
    desc: 'Ein Psychologe erklärt, warum der Elfmeter nur im Kopf schwer ist.',
    dauer: 45, attribute: { nervenstaerke: 1.0, fuehrung: 0.4, uebersicht: 0.2 },
    ermuedung: 1, risiko: 0.1, moralEffekt: 0.2, benoetigtStab: 'cotrainer', minAlterEffekt: 42
  },
  videoanalyse: {
    id: 'videoanalyse', name: 'Videoanalyse', kategorie: 'spezial',
    desc: 'Zwei Stunden Beamer im abgedunkelten Raum. Drei Spieler schlafen.',
    dauer: 60, attribute: { uebersicht: 0.8, positionsspiel: 0.8, nervenstaerke: 0.15 },
    ermuedung: 1, risiko: 0.05, moralEffekt: -0.1, benoetigtStab: 'cotrainer', minAlterEffekt: 43
  },

  regeneration: {
    id: 'regeneration', name: 'Regeneration', kategorie: 'erholung',
    desc: 'Eistonne, Massagebank, Radfahren. Die halbe Miete nach englischen Wochen.',
    dauer: 50, attribute: {},
    ermuedung: -6, risiko: 0.05, moralEffekt: 0.15, benoetigtStab: 'physio', minAlterEffekt: 45
  },
  auslaufen: {
    id: 'auslaufen', name: 'Auslaufen', kategorie: 'erholung',
    desc: 'Locker traben und über das Spiel schimpfen.',
    dauer: 35, attribute: { ausdauer: 0.15 },
    ermuedung: -3, risiko: 0.1, moralEffekt: 0.1, benoetigtStab: 'physio', minAlterEffekt: 45
  },
  frei: {
    id: 'frei', name: 'Trainingsfrei', kategorie: 'erholung',
    desc: 'Familie, Sofa, Playstation. Auch das gehört zum Beruf.',
    dauer: 0, attribute: {},
    ermuedung: -8, risiko: 0, moralEffekt: 0.3, benoetigtStab: null, minAlterEffekt: 45
  },
  teambuilding: {
    id: 'teambuilding', name: 'Teambuilding', kategorie: 'erholung',
    desc: 'Kartfahren, Kegelabend, Hochseilgarten. Wirkt Wunder — oder peinlich.',
    dauer: 180, attribute: { fuehrung: 0.5, nervenstaerke: 0.25 },
    ermuedung: 1, risiko: 0.15, moralEffekt: 1.2, benoetigtStab: 'cotrainer', minAlterEffekt: 45
  }
};

export const EINHEIT_IDS = Object.keys(EINHEITEN);

export const EINHEIT_KATEGORIEN = {
  kondition: 'Kondition', technik: 'Technik', taktik: 'Taktik',
  spiel: 'Spielformen', spezial: 'Spezialtraining', erholung: 'Erholung'
};

/** Nachschlagen mit Fallback — Screens dürfen ruhig Unsinn übergeben. */
export function einheit(id) {
  return EINHEITEN[id] || null;
}

export const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/* ==========================================================================
 * 3. SCHWERPUNKTE & STANDARDPLÄNE
 * ======================================================================== */

export const SCHWERPUNKTE = {
  ausgeglichen: { id: 'ausgeglichen', name: 'Ausgeglichen', desc: 'Von allem etwas. Der Klassiker.' },
  kondition: { id: 'kondition', name: 'Kondition', desc: 'Laufen, laufen, laufen. Am Ende steht die Mannschaft noch.' },
  technik: { id: 'technik', name: 'Technik', desc: 'Ball und Fuß sollen Freunde werden.' },
  taktik: { id: 'taktik', name: 'Taktik', desc: 'Ordnung ist das halbe Spiel.' },
  regeneration: { id: 'regeneration', name: 'Regeneration', desc: 'Beine hoch. Für englische Wochen.' },
  standards: { id: 'standards', name: 'Standards', desc: 'Ecken, Freistöße, ruhende Bälle.' },
  offensive: { id: 'offensive', name: 'Offensive', desc: 'Tore schießen ist auch eine Fertigkeit.' },
  defensive: { id: 'defensive', name: 'Defensive', desc: 'Erst mal hinten dichtmachen.' }
};

export const SCHWERPUNKT_IDS = Object.keys(SCHWERPUNKTE);

/**
 * Wochenplan-Vorlage. Schlüssel 0 = Montag … 6 = Sonntag, max. 2 Einheiten/Tag.
 * Samstag bleibt frei — dort liegt der Ligaspieltag.
 */
export function standardplan(schwerpunkt = 'ausgeglichen') {
  const s = SCHWERPUNKTE[schwerpunkt] ? schwerpunkt : 'ausgeglichen';
  const P = {
    ausgeglichen: {
      0: ['auslaufen', 'videoanalyse'],
      1: ['ausdauerlauf', 'passspiel'],
      2: ['spielformen', 'torschuss'],
      3: ['taktik_offensiv', 'ballannahme'],
      4: ['standards', 'abschlussspiel'],
      5: [],
      6: ['frei']
    },
    kondition: {
      0: ['regeneration', 'beweglichkeit'],
      1: ['ausdauerlauf', 'kraftraum'],
      2: ['intervalltraining', 'spielformen'],
      3: ['sprinttraining', 'passspiel'],
      4: ['beweglichkeit', 'abschlussspiel'],
      5: [],
      6: ['frei']
    },
    technik: {
      0: ['auslaufen', 'ballannahme'],
      1: ['passspiel', 'dribbling'],
      2: ['torschuss', 'flanken'],
      3: ['ballannahme', 'spielformen'],
      4: ['standards', 'abschlussspiel'],
      5: [],
      6: ['frei']
    },
    taktik: {
      0: ['videoanalyse', 'auslaufen'],
      1: ['taktik_defensiv', 'passspiel'],
      2: ['taktik_offensiv', 'umschaltspiel'],
      3: ['pressing', 'spielformen'],
      4: ['abseitsfalle', 'abschlussspiel'],
      5: [],
      6: ['frei']
    },
    regeneration: {
      0: ['regeneration'],
      1: ['auslaufen', 'beweglichkeit'],
      2: ['passspiel', 'regeneration'],
      3: ['spielformen'],
      4: ['auslaufen', 'standards'],
      5: [],
      6: ['frei']
    },
    standards: {
      0: ['auslaufen', 'videoanalyse'],
      1: ['standards', 'flanken'],
      2: ['kopfball', 'standardverteidigung'],
      3: ['standards', 'spielformen'],
      4: ['flanken', 'abschlussspiel'],
      5: [],
      6: ['frei']
    },
    offensive: {
      0: ['auslaufen', 'videoanalyse'],
      1: ['torschuss', 'dribbling'],
      2: ['umschaltspiel', 'flanken'],
      3: ['taktik_offensiv', 'torschuss'],
      4: ['standards', 'abschlussspiel'],
      5: [],
      6: ['frei']
    },
    defensive: {
      0: ['auslaufen', 'videoanalyse'],
      1: ['taktik_defensiv', 'kraftraum'],
      2: ['pressing', 'standardverteidigung'],
      3: ['taktik_defensiv', 'kopfball'],
      4: ['abseitsfalle', 'abschlussspiel'],
      5: [],
      6: ['frei']
    }
  }[s];
  // Frische Kopie, damit Aufrufer nicht die Vorlage verbiegen.
  const out = {};
  for (let d = 0; d < 7; d++) out[d] = (P[d] || []).slice();
  return out;
}

/* ==========================================================================
 * 4. TRAININGSLAGER
 * ======================================================================== */

export const TRAININGSLAGER_ORTE = {
  heimisch: {
    id: 'heimisch', name: 'Heimisches Trainingsgelände', land: 'Deutschland',
    desc: 'Kein Flug, keine Hotelrechnung, dafür jeden Tag dreißig Autogrammjäger am Zaun.',
    kostenProTagUndSpieler: 90, kondition: 0.70, teamgeist: 0.55, technik: 0.9,
    risiko: 1.0, fanReaktion: 2
  },
  bad_ragaz: {
    id: 'bad_ragaz', name: 'Bad Ragaz', land: 'Schweiz',
    desc: 'Thermalquellen, Bergluft und ein Physioteam, das jeden Muskel kennt.',
    kostenProTagUndSpieler: 340, kondition: 1.15, teamgeist: 1.0, technik: 1.0,
    risiko: 0.82, fanReaktion: 1
  },
  marbella: {
    id: 'marbella', name: 'Marbella', land: 'Spanien',
    desc: 'Sonne, perfekte Plätze, und abends winkt die Promenade. Disziplin ist Chefsache.',
    kostenProTagUndSpieler: 265, kondition: 1.18, teamgeist: 1.10, technik: 1.1,
    risiko: 0.95, fanReaktion: 3
  },
  belek: {
    id: 'belek', name: 'Belek', land: 'Türkei',
    desc: 'Zwölf Plätze, All-inclusive und drei andere Bundesligisten im selben Hotel.',
    kostenProTagUndSpieler: 225, kondition: 1.25, teamgeist: 0.95, technik: 1.0,
    risiko: 1.0, fanReaktion: 1
  },
  katar: {
    id: 'katar', name: 'Doha', land: 'Katar',
    desc: 'Modernste Anlagen, üppige Antrittsprämie — und ein Fanblock, der Transparente malt.',
    kostenProTagUndSpieler: 520, kondition: 1.10, teamgeist: 0.85, technik: 1.05,
    risiko: 1.12, fanReaktion: -7
  }
};

export const LAGER_BUDGETS = {
  sparsam: { id: 'sparsam', name: 'Sparsam', faktor: 0.65, wirkung: 0.82, moral: -0.6 },
  normal: { id: 'normal', name: 'Normal', faktor: 1.0, wirkung: 1.0, moral: 0.4 },
  luxus: { id: 'luxus', name: 'Erste Klasse', faktor: 1.55, wirkung: 1.14, moral: 1.6 }
};

/** Zeitfenster, in denen ein Trainingslager überhaupt möglich ist. */
const LAGER_FENSTER = [
  { von: 14, bis: 45, name: 'Sommervorbereitung' },
  { von: 183, bis: 206, name: 'Wintervorbereitung' }
];

/* ==========================================================================
 * 5. Kleine Helfer
 * ======================================================================== */

/** 0 = Montag … 6 = Sonntag (identisch zu core/util.js dateFromDayIndex). */
export function wochentagVon(day) {
  return (((day + 1) % 7) + 7) % 7;
}

/** Sommer- und Winterurlaub: kein Training, nur Erholung. */
export function istUrlaub(day) {
  const d = ((day % 365) + 365) % 365;
  const [su0, su1] = SAISON_TAGE.sommerurlaub;
  const [wu0, wu1] = SAISON_TAGE.winterurlaub;
  if (d >= su0 && d <= su1) return true;
  if (d >= wu0 && d <= wu1) return true;
  return d >= SAISON_TAGE.abschlussfeier + 6;   // Saisonpause nach der Abschlussfeier
}

function lerpKurve(kurve, x) {
  if (x <= kurve[0][0]) return kurve[0][1];
  const last = kurve[kurve.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < kurve.length; i++) {
    const [x1, y1] = kurve[i];
    const [x0, y0] = kurve[i - 1];
    if (x <= x1) return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
  }
  return last[1];
}

/**
 * Optionaler Draht zu club/staff.js. Sobald main.js
 * `setStabWirkungHook((state, clubId) => stabWirkung(state, clubId))` aufruft,
 * benutzt das Training die dortige Bewertung. Ohne Hook wird der Stab direkt
 * aus state.staff gelesen — dieses Modul bleibt dadurch eigenständig lauffähig.
 */
let stabWirkungHook = null;
export function setStabWirkungHook(fn) { stabWirkungHook = typeof fn === 'function' ? fn : null; }

/** Robuste Qualitätsauslese eines Stabsmitglieds (Schema von club/staff.js offen). */
function stabQualitaetVon(s) {
  const kandidaten = [s.qualitaet, s.quality, s.koennen, s.rating, s.staerke, s.wert, s.skill, s.niveau];
  for (const k of kandidaten) {
    if (typeof k === 'number' && k > 0) return k <= 20 ? k * 5 : k;
  }
  if (s.skills && typeof s.skills === 'object') {
    const werte = Object.values(s.skills).filter(v => typeof v === 'number');
    if (werte.length) return avg(werte);
  }
  return 0;
}

/** Beste verfügbare Qualität einer Stabsrolle, 1..100. */
function stabWert(state, club, rolle) {
  if (!rolle) return 60;
  let best = 0;
  for (const id of club.staffIds || []) {
    const s = state.staff && state.staff[id];
    if (!s) continue;
    const r = s.role || s.rolle || s.typ || s.art;
    if (r !== rolle) continue;
    const q = stabQualitaetVon(s);
    if (q > best) best = q;
  }
  if (best <= 0) best = ((club.facilities && club.facilities.training) || 50) * 0.75;
  return clamp(best, 1, 100);
}

/** Gesamter Ausbildungswert eines Vereins (Stab + Anlagen + Trainerskill), 1..100. */
export function ausbildungsniveau(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return 50;
  if (stabWirkungHook) {
    try {
      const w = stabWirkungHook(state, clubId);
      if (w && typeof w.training === 'number' && w.training > 0) {
        return clamp(w.training <= 3 ? w.training * 33 : w.training, 1, 100);
      }
    } catch (e) { /* staff.js noch nicht bereit – Fallback unten */ }
  }
  const co = stabWert(state, club, 'cotrainer');
  const ath = stabWert(state, club, 'athletik');
  const anlagen = (club.facilities && club.facilities.training) || 50;
  let wert = 0.36 * co + 0.16 * ath + 0.34 * anlagen;
  if (clubId === state.managerClubId && state.manager && state.manager.skills) {
    wert += 0.14 * clamp(state.manager.skills.training || 45, 1, 100);
  } else {
    wert += 0.14 * clamp(anlagen * 0.9, 1, 100);
  }
  return clamp(wert, 1, 100);
}

/** Lazy-Init der Trainingsfelder eines Vereins. */
function ensureClubTraining(club) {
  const t = club.training || (club.training = {});
  if (t.intensitaet == null) t.intensitaet = 55;
  if (!t.schwerpunkt) t.schwerpunkt = 'ausgeglichen';
  if (!t.wochenplan) t.wochenplan = standardplan(t.schwerpunkt);
  if (!t.woche) t.woche = leereWoche();
  if (t.trainingslager === undefined) t.trainingslager = null;
  if (t.letzteBewertung === undefined) t.letzteBewertung = null;
  if (!t.historie) t.historie = [];
  return t;
}

/** Lazy-Init der Trainingsfelder eines Spielers. */
function ensurePlayerTraining(p) {
  const t = p.training || (p.training = { focus: null, gains: {}, intensitaet: 50, woche: 0 });
  if (!t.gains) t.gains = {};
  if (!t.fortschritt) t.fortschritt = {};
  if (t.intensitaet == null) t.intensitaet = 50;
  if (t.woche == null) t.woche = 0;
  if (!t.letzteWoche) t.letzteWoche = { minuten: 0, spiele: 0, note: 0 };
  if (!t.merker) t.merker = { minuten: 0, spiele: 0, notenSumme: 0, notenAnzahl: 0 };
  return t;
}

function leereWoche() {
  return { tage: 0, einheiten: {}, ermuedung: 0, risiko: 0, moralEffekt: 0, spieltage: 0 };
}

/** Deterministische Ersatz-Rng, falls ein Screen ohne ctx.rng aufruft. */
function fallbackRng(state, label) {
  return createRng(hashString(String(label) + ':' + (state.seed || 1) + ':' + (state.tick || 0)));
}

function difficultyOf(state, ctx) {
  if (ctx && ctx.difficulty && typeof ctx.difficulty.xpGain === 'number') return ctx.difficulty;
  return DIFFICULTIES[state.difficulty] || DIFFICULTIES.profi;
}

function spielerName(p) { return p.shortName || p.lastName || p.id; }

/* ==========================================================================
 * 6. Tagesablauf
 * ======================================================================== */

/** Welche Einheiten stehen heute an? Berücksichtigt Spieltag, Urlaub, Lager. */
function tagesEinheiten(club, weekday, hatSpiel, urlaub) {
  const t = club.training;
  if (urlaub) return [];
  if (hatSpiel) return ['auslaufen'];
  const lager = t.trainingslager;
  if (lager && lager.restTage > 0) {
    return lager.plan[weekday % lager.plan.length] || ['ausdauerlauf', 'spielformen'];
  }
  const plan = t.wochenplan || standardplan(t.schwerpunkt);
  const roh = plan[weekday] || plan[String(weekday)] || [];
  return roh.filter(id => EINHEITEN[id]).slice(0, 2);
}

/** Tagesbelastung eines Spielers: Fitness fortschreiben. */
function tagesFrische(state, club, p, ids, urlaub) {
  const a = p.attributes || {};
  const ausdauer = clamp(a.ausdauer || 55, 1, 99);
  const intensitaet = clamp(club.training.intensitaet, 0, 100);
  const pt = p.training;

  let belastung = 0, erholung = 0;
  for (const id of ids) {
    const e = EINHEITEN[id];
    if (!e) continue;
    if (e.ermuedung >= 0) belastung += e.ermuedung;
    else erholung += -e.ermuedung;
  }
  if (pt.focus && belastung > 0) belastung += INDIV_ERMUEDUNG * (clamp(pt.intensitaet, 0, 100) / 100);

  const alterLast = p.age >= 31 ? 1 + (p.age - 30) * 0.05 : 1;
  const lastFaktor = (1.3 - ausdauer / 150) * (0.55 + intensitaet / 90) * alterLast;
  let delta = -belastung * ERM_SKALA * lastFaktor;

  const fitness = clamp(p.fitness == null ? 100 : p.fitness, 0, 100);
  const regen = (urlaub ? URLAUB_ERHOLUNG : REGEN_BASIS)
    * (0.75 + ausdauer / 200)
    * (1 + ((100 - fitness) / 100) * 0.8);
  delta += regen + erholung * ERM_SKALA * 1.05;

  // Verletzte trainieren nicht mit, erholen sich aber auch nicht richtig.
  if (p.injury) delta = Math.min(delta, 1.2);

  p.fitness = clamp(round(fitness + delta, 1), 5, 100);
  return delta;
}

/** Ein Tag Trainingslager: Kondition, Teamgeist, Risiko. */
function lagerTag(state, club, ctx, rng) {
  const lager = club.training.trainingslager;
  if (!lager || lager.restTage <= 0) return;
  const ort = TRAININGSLAGER_ORTE[lager.ortId] || TRAININGSLAGER_ORTE.heimisch;
  const budget = LAGER_BUDGETS[lager.budget] || LAGER_BUDGETS.normal;
  const wirkung = ort.kondition * budget.wirkung;

  for (const pid of club.playerIds) {
    const p = state.players[pid];
    if (!p || p.injury) continue;
    p.morale = clamp(round((p.morale ?? 70) + ort.teamgeist * budget.wirkung * 0.18 + budget.moral * 0.1, 1), 1, 100);
    p.sharpness = clamp(round((p.sharpness ?? 60) + 0.55 * wirkung, 1), 1, 100);
  }
  club.moral = clamp(round((club.moral ?? 62) + ort.teamgeist * 0.2, 1), 1, 100);

  lager.restTage--;
  if (lager.restTage <= 0) {
    lager.beendet = true;
    if (ctx && ctx.log && club.id === state.managerClubId) {
      ctx.log(
        `Das Trainingslager in ${ort.name} ist beendet. ${lager.tage} Tage Schinderei, ` +
        `${lager.verletzungen || 0} Blessuren und eine Mannschaft, die sich wieder riechen kann.`,
        'training', { subject: 'Trainingslager beendet', from: 'Co-Trainer' }
      );
    }
    club.training.trainingslager = null;
  }
}

/**
 * Tagestick für alle Vereine. Montags wird zusätzlich die Woche ausgewertet.
 * Läuft für 36 Vereine × 365 Tage — deshalb bewusst schlank gehalten.
 */
export function tickTraining(state, ctx = {}) {
  const day = ctx.day != null ? ctx.day : state.date.day;
  const season = ctx.season != null ? ctx.season : state.date.season;
  const weekday = ctx.weekday != null ? ctx.weekday : wochentagVon(day);
  const rng = ctx.rng || fallbackRng(state, 'training:' + day);
  const urlaub = istUrlaub(day);

  // Ein einziger Durchlauf über den Spielplan pro Tag statt 36 Filterläufe.
  const spieltHeute = new Set();
  for (const f of state.fixtures || []) {
    if (f.dayIndex === day && f.season === season) { spieltHeute.add(f.homeId); spieltHeute.add(f.awayId); }
  }

  for (const clubId in state.clubs) {
    const club = state.clubs[clubId];
    if (!club || !club.playerIds) continue;
    const t = ensureClubTraining(club);
    const hatSpiel = spieltHeute.has(clubId);

    lagerTag(state, club, ctx, rng);

    const ids = tagesEinheiten(club, weekday, hatSpiel, urlaub);

    // Wochenprotokoll füllen (Basis der Montagsauswertung).
    if (hatSpiel) t.woche.spieltage++;
    if (ids.length && !urlaub) {
      t.woche.tage++;
      for (const id of ids) {
        const e = EINHEITEN[id];
        if (!e) continue;
        t.woche.einheiten[id] = (t.woche.einheiten[id] || 0) + 1;
        t.woche.ermuedung += Math.max(0, e.ermuedung);
        t.woche.risiko += e.risiko;
        t.woche.moralEffekt += e.moralEffekt;
      }
    }

    for (const pid of club.playerIds) {
      const p = state.players[pid];
      if (!p) continue;
      ensurePlayerTraining(p);
      tagesFrische(state, club, p, ids, urlaub);
    }
  }

  // Montag: Woche abrechnen.
  if (weekday === 0) {
    for (const clubId in state.clubs) {
      const club = state.clubs[clubId];
      if (!club || !club.playerIds || !club.playerIds.length) continue;
      const istManager = clubId === state.managerClubId;
      const res = wocheAuswerten(state, clubId, {
        rng: (ctx.rng ? ctx.rng.fork('woche:' + clubId) : fallbackRng(state, 'woche:' + clubId + ':' + day)),
        difficulty: difficultyOf(state, ctx),
        day, season, urlaub, kurz: !istManager
      });
      if (istManager && ctx.log && res && res.bericht) {
        ctx.log(res.bericht, 'training', { subject: 'Trainingsbericht der Woche', from: 'Co-Trainer' });
        for (const v of res.verletzungen || []) {
          if (ctx.news) ctx.news(v.text, 'verletzung');
        }
      }
    }
  }
}

/* ==========================================================================
 * 7. Wochenauswertung
 * ======================================================================== */

/** Minuten/Noten der abgelaufenen Woche aus den Saisonstatistiken ableiten. */
function wochenLeistung(p) {
  const t = ensurePlayerTraining(p);
  const s = (p.stats && p.stats.season) || {};
  const minuten = Math.max(0, (s.minuten || 0) - t.merker.minuten);
  const spiele = Math.max(0, (s.spiele || 0) - t.merker.spiele);
  const nSumme = Math.max(0, (s.notenSumme || 0) - t.merker.notenSumme);
  const nAnzahl = Math.max(0, (s.notenAnzahl || 0) - t.merker.notenAnzahl);
  t.merker = {
    minuten: s.minuten || 0, spiele: s.spiele || 0,
    notenSumme: s.notenSumme || 0, notenAnzahl: s.notenAnzahl || 0
  };
  const note = nAnzahl > 0 ? nSumme / nAnzahl : 0;
  t.letzteWoche = { minuten, spiele, note: round(note, 2) };
  return t.letzteWoche;
}

/**
 * Wertet eine Trainingswoche für einen Verein aus: Entwicklung, Form,
 * Spielpraxis, Ermüdung, Verletzungen, Moral — plus deutscher Wochenbericht.
 */
export function wocheAuswerten(state, clubId, ctx = {}) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.', entwicklungen: [] };
  const t = ensureClubTraining(club);
  const rng = ctx.rng || fallbackRng(state, 'woche:' + clubId);
  const difficulty = difficultyOf(state, ctx);
  const urlaub = !!ctx.urlaub;
  const kurz = !!ctx.kurz;

  const woche = t.woche && t.woche.tage ? t.woche : { ...leereWoche(), einheiten: planEinheiten(t), tage: 5 };
  const niveau = ausbildungsniveau(state, clubId);
  const stabFaktor = STAB_MIN + (STAB_MAX - STAB_MIN) * (niveau / 100);

  const entwicklungen = [];
  const formAenderungen = [];
  const verletzungen = [];
  let fitnessSumme = 0, moralSumme = 0, n = 0;

  const eCtx = {
    rng, difficulty, einheiten: woche.einheiten, tage: woche.tage,
    club, stabFaktor, niveau, urlaub, intensitaet: clamp(t.intensitaet, 0, 100)
  };

  for (const pid of club.playerIds) {
    const p = state.players[pid];
    if (!p) continue;
    ensurePlayerTraining(p);
    const leistung = wochenLeistung(p);

    // Spielbelastung der vergangenen Woche auf die Frische umlegen.
    if (leistung.minuten > 0) {
      p.fitness = clamp(round((p.fitness ?? 100) - (leistung.minuten / 90) * SPIEL_BELASTUNG, 1), 5, 100);
    }

    const ent = entwicklung(state, pid, eCtx);
    if (ent && ent.veraenderungen && ent.veraenderungen.length) {
      for (const v of ent.veraenderungen) {
        entwicklungen.push({ playerId: pid, attribut: v.attribut, delta: v.delta });
      }
    }
    const form = formEntwicklung(state, pid, { rng, guete: ent ? ent.guete : GUETE_REFERENZ, leistung });
    if (form && Math.abs(form.delta) >= 1) formAenderungen.push({ playerId: pid, delta: form.delta, form: form.form });
    spielpraxis(state, pid);

    // Moral aus der Trainingsarbeit (klein — club/morale.js führt die Regie).
    const moralDelta = clamp(woche.moralEffekt * MORAL_SKALA * (0.7 + (100 - eCtx.intensitaet) / 200),
      -MORAL_MAX_WOCHE, MORAL_MAX_WOCHE);
    p.morale = clamp(round((p.morale ?? 70) + moralDelta, 1), 1, 100);
    moralSumme += moralDelta;

    const v = verletzungsWurf(state, club, p, woche, eCtx);
    if (v) verletzungen.push(v);

    fitnessSumme += p.fitness ?? 100;
    n++;
    p.training.woche = (p.training.woche || 0) + 1;
  }

  t.woche = leereWoche();

  const schnittFitness = n ? round(fitnessSumme / n, 1) : 100;
  const bewertung = {
    saison: state.date.season, tag: state.date.day,
    tage: woche.tage, einheiten: woche.einheiten, intensitaet: eCtx.intensitaet,
    schwerpunkt: t.schwerpunkt, niveau: round(niveau, 1), frische: schnittFitness,
    aufsteiger: [], absteiger: [], verletzungen: verletzungen.length
  };

  let bericht = '';
  if (!kurz) {
    const gruppiert = gruppiereEntwicklung(state, entwicklungen);
    bewertung.aufsteiger = gruppiert.aufsteiger.slice(0, 5);
    bewertung.absteiger = gruppiert.absteiger.slice(0, 3);
    bericht = berichtText(state, club, {
      woche, schnittFitness, gruppiert, verletzungen, urlaub,
      niveau, intensitaet: eCtx.intensitaet
    });
  }
  bewertung.bericht = bericht;
  t.letzteBewertung = bewertung;
  t.historie.push({ saison: state.date.season, tag: state.date.day, frische: schnittFitness, tage: woche.tage });
  if (t.historie.length > 60) t.historie.shift();

  return {
    ok: true,
    entwicklungen,
    formAenderungen,
    ermuedung: schnittFitness,
    verletzungen,
    moralEffekt: round(n ? moralSumme / n : 0, 2),
    bericht
  };
}

/** Einheitenzählung direkt aus dem Wochenplan (Fallback ohne Tagesprotokoll). */
function planEinheiten(t) {
  const plan = t.wochenplan || standardplan(t.schwerpunkt);
  const out = {};
  for (let d = 0; d < 7; d++) {
    for (const id of (plan[d] || plan[String(d)] || [])) {
      if (EINHEITEN[id]) out[id] = (out[id] || 0) + 1;
    }
  }
  return out;
}

/** Entwicklungen je Spieler bündeln — für Bericht und Screens. */
function gruppiereEntwicklung(state, entwicklungen) {
  const byPlayer = new Map();
  for (const e of entwicklungen) {
    if (!byPlayer.has(e.playerId)) byPlayer.set(e.playerId, []);
    byPlayer.get(e.playerId).push(e);
  }
  const aufsteiger = [], absteiger = [];
  for (const [pid, liste] of byPlayer) {
    const p = state.players[pid];
    if (!p) continue;
    const plus = liste.filter(e => e.delta > 0);
    const minus = liste.filter(e => e.delta < 0);
    const eintrag = (l) => ({
      playerId: pid, name: spielerName(p),
      attribute: sortBy(l, e => ({ key: Math.abs(e.delta), desc: true })).slice(0, 3)
        .map(e => `${ATTRIBUTE_NAMES[e.attribut] || e.attribut} ${e.delta > 0 ? '+' : ''}${e.delta}`),
      summe: l.reduce((s, e) => s + Math.abs(e.delta), 0)
    });
    if (plus.length) aufsteiger.push(eintrag(plus));
    if (minus.length) absteiger.push(eintrag(minus));
  }
  return {
    aufsteiger: sortBy(aufsteiger, a => ({ key: a.summe, desc: true })),
    absteiger: sortBy(absteiger, a => ({ key: a.summe, desc: true }))
  };
}

/** Der Wochenbericht des Co-Trainers — trocken, deutsch, 90er. */
function berichtText(state, club, d) {
  const zeilen = [];
  const einheitenText = Object.keys(d.woche.einheiten)
    .map(id => `${EINHEITEN[id].name}${d.woche.einheiten[id] > 1 ? ' (' + d.woche.einheiten[id] + '×)' : ''}`)
    .join(', ');

  if (d.urlaub) {
    zeilen.push('Die Mannschaft ist im Urlaub. Der Platzwart grüßt aus der leeren Kabine.');
  } else if (!d.woche.tage) {
    zeilen.push('Diese Woche stand kein einziges Training auf dem Programm. Bemerkenswert.');
  } else {
    zeilen.push(`${d.woche.tage} Trainingstage bei Intensität ${Math.round(d.intensitaet)}: ${einheitenText}.`);
  }

  zeilen.push(d.schnittFitness >= 92
    ? `Die Frische liegt bei ${d.schnittFitness} — die Jungs stehen im Saft.`
    : d.schnittFitness >= 80
      ? `Frische im Schnitt ${d.schnittFitness}. Geht in Ordnung.`
      : d.schnittFitness >= 68
        ? `Frische nur ${d.schnittFitness}. Ein paar Beine werden schwer.`
        : `Frische im Keller (${d.schnittFitness}). So läuft uns niemand mehr davon.`);

  if (d.gruppiert.aufsteiger.length) {
    const top = d.gruppiert.aufsteiger.slice(0, 3)
      .map(a => `${a.name} (${a.attribute.join(', ')})`).join('; ');
    zeilen.push(`Aufwärtstrend: ${top}.`);
  } else if (!d.urlaub && d.woche.tage) {
    zeilen.push('Große Sprünge hat diese Woche niemand gemacht.');
  }

  if (d.gruppiert.absteiger.length) {
    const flop = d.gruppiert.absteiger.slice(0, 2)
      .map(a => `${a.name} (${a.attribute.join(', ')})`).join('; ');
    zeilen.push(`Der Zahn der Zeit nagt: ${flop}.`);
  }

  for (const v of d.verletzungen.slice(0, 3)) zeilen.push(v.text);

  if (d.niveau >= 78) zeilen.push('Der Trainerstab arbeitet auf höchstem Niveau — das sieht man an jeder Einheit.');
  else if (d.niveau <= 42) zeilen.push('Mit diesem Stab und diesen Anlagen ist Ausbildung ein frommer Wunsch.');
  if (d.intensitaet >= 85) zeilen.push('Bei dieser Intensität sollten Sie die Physios vorwarnen.');
  if (d.intensitaet <= 25) zeilen.push('So gemütlich wie zuletzt trainiert sonst nur die Altherren-Mannschaft.');

  return zeilen.join('\n');
}

/* ==========================================================================
 * 8. Verletzungen aus dem Training
 * ======================================================================== */

function verletzungsWurf(state, club, p, woche, eCtx) {
  if (p.injury || !woche.tage) return null;
  const a = p.attributes || {};
  const fitness = clamp(p.fitness ?? 100, 1, 100);
  const medizin = ((club.facilities && club.facilities.medical) || 55);

  let risiko = woche.risiko * RISIKO_SKALA;
  risiko *= 0.5 + eCtx.intensitaet / 55;
  risiko *= 1 + Math.max(0, (100 - fitness)) * 0.016;
  risiko *= 1 + Math.max(0, p.age - 28) * RISIKO_ALTER;
  risiko *= 1.25 - (a.ausdauer || 55) / 220;
  risiko *= 1.2 - medizin / 320;
  risiko *= eCtx.difficulty.injuryRate || 1;
  if ((p.traits || []).includes('glasknochen')) risiko *= RISIKO_GLASKNOCHEN;
  if (club.training.trainingslager) {
    const ort = TRAININGSLAGER_ORTE[club.training.trainingslager.ortId];
    if (ort) risiko *= ort.risiko;
  }

  if (!eCtx.rng.chance(clamp(risiko, 0, 0.5))) return null;

  // Verletzungen gehören laut Zuständigkeitstabelle (CONTRACTS Abschnitt 11) der
  // medizinischen Abteilung. Ein eigener Objektaufbau hier hatte zur Folge, dass
  // Trainingsverletzungen ein anderes Feld für die Restdauer trugen als medical.js
  // liest – sie wurden mit „rund NaN Monate" angezeigt und heilten nie ab.
  // waehleTyp() in medical.js gewichtet schwere Blessuren bei ursache 'training'
  // bereits selbst herunter – hier ist nichts weiter einzustellen.
  const ergebnis = verletzen(state, p.id, { rng: eCtx.rng, ursache: 'training' });
  if (!ergebnis || !ergebnis.ok) return null;

  p.fitness = clamp(Math.min(p.fitness ?? 100, 62), 5, 100);
  if (club.training.trainingslager) {
    club.training.trainingslager.verletzungen = (club.training.trainingslager.verletzungen || 0) + 1;
  }
  const tage = p.injury ? p.injury.tageRest : 0;
  return {
    playerId: p.id, typ: p.injury ? p.injury.typ : null, tage,
    text: ergebnis.text || `${spielerName(p)} hat sich im Training verletzt — ${tage} Tage Pause.`
  };
}

/* ==========================================================================
 * 9. Entwicklung — das Herzstück
 * ======================================================================== */

/** Positionsprofil als normierter Vektor (Summe 1). */
function positionsVektor(p) {
  const w = POSITION_WEIGHTS[p.position] || POSITION_WEIGHTS.ZM;
  const out = {};
  let s = 0;
  for (const k in w) { out[k] = w[k]; s += w[k]; }
  if (s > 0) for (const k in out) out[k] /= s;
  return out;
}

/**
 * Schwerpunktvektor der Woche für EINEN Spieler.
 * Mischung aus Wochenplan (65 %) und positionsspezifischem Grundprogramm (35 %),
 * anschließend das Individualtraining eingeblendet.
 */
function schwerpunktVektor(state, club, p, einheiten, stabRoh) {
  const istTW = p.position === 'TW';
  const plan = {};
  let summe = 0;

  for (const id in einheiten) {
    const e = EINHEITEN[id];
    if (!e) continue;
    const anzahl = einheiten[id];
    // Torwarttraining: Feldspieler machen derweil ein Ersatzprogramm.
    if (e.nurTorwart && !istTW) {
      const ersatz = EINHEITEN.spielformen;
      for (const k in ersatz.attribute) {
        const v = ersatz.attribute[k] * anzahl * 0.55;
        plan[k] = (plan[k] || 0) + v; summe += v;
      }
      continue;
    }
    if (istTW && !e.nurTorwart && e.kategorie === 'technik') {
      // Feldspieler-Technik bringt dem Keeper wenig.
      for (const k in e.attribute) {
        const v = e.attribute[k] * anzahl * 0.4;
        plan[k] = (plan[k] || 0) + v; summe += v;
      }
      continue;
    }
    // Stabsqualität der Einheit
    const q = stabRoh[e.benoetigtStab] != null ? stabRoh[e.benoetigtStab] : 60;
    const qf = 0.74 + 0.52 * (q / 100);
    // Altersgrenze der Einheit
    const af = p.age > e.minAlterEffekt ? ALTER_ERHALT : 1;
    for (const k in e.attribute) {
      const v = e.attribute[k] * anzahl * qf * af;
      plan[k] = (plan[k] || 0) + v; summe += v;
    }
  }
  if (summe > 0) for (const k in plan) plan[k] /= summe;

  const pos = positionsVektor(p);
  const mix = {};
  for (const k of ATTRIBUTES) {
    const v = (1 - GRUNDPROGRAMM_ANTEIL) * (plan[k] || 0) + GRUNDPROGRAMM_ANTEIL * (pos[k] || 0);
    if (v > 0) mix[k] = v;
  }

  // Individualtraining
  const fokus = p.training && p.training.focus;
  if (fokus && ATTRIBUTES.includes(fokus)) {
    const anteil = clamp(INDIV_ANTEIL_MIN + INDIV_ANTEIL_SPANNE * (clamp(p.training.intensitaet, 0, 100) / 100), 0, 0.7);
    for (const k in mix) mix[k] *= (1 - anteil);
    mix[fokus] = (mix[fokus] || 0) + anteil;
  }

  let s2 = 0;
  for (const k in mix) s2 += mix[k];
  if (s2 > 0) for (const k in mix) mix[k] /= s2;
  return mix;
}

/** Spielzeitquote 0..1.2 als gleitender Mittelwert. */
/**
 * Wie stark fördert der Mentor dieses Talent? 1 = kein Mentor, >1 = gefördert.
 * Der Mentor muss leben, im selben Verein stehen und darf nicht zurückgetreten
 * sein — sonst wirkt ein Eintrag weiter, den längst niemand mehr einlöst.
 */
function mentorFaktor(state, p) {
  const m = p && p.mentor;
  if (!m || !m.mentorId) return 1;
  const mentor = state.players ? state.players[m.mentorId] : null;
  if (!mentor || mentor.retired || mentor.clubId !== p.clubId) return 1;
  const staerke = Number.isFinite(m.staerke) ? m.staerke : MENTOR_STAERKE_STANDARD;
  return 1 + MENTOR_GEWINN_MAX * clamp(staerke / 100, 0, 1);
}

function spielzeitQuote(p) {
  const t = ensurePlayerTraining(p);
  const woche = t.letzteWoche || { minuten: 0 };
  const aktuell = clamp(woche.minuten / 90, 0, 1.25);
  const alt = t.einsatzquote != null ? t.einsatzquote : 0.5;
  t.einsatzquote = round(alt * 0.78 + aktuell * 0.22, 4);
  return t.einsatzquote;
}

/**
 * Attributentwicklung einer Woche. Mutiert player.attributes und
 * player.training.fortschritt / .gains.
 *
 * @returns {{ playerId, veraenderungen:[{attribut,delta}], ovrVorher, ovrNachher,
 *             ovrDelta, punkte, guete, faktoren }}
 */
export function entwicklung(state, playerId, ctx = {}) {
  const p = state.players[playerId];
  if (!p || !p.attributes) return null;
  const club = ctx.club || state.clubs[p.clubId];
  const t = ensurePlayerTraining(p);
  const difficulty = difficultyOf(state, ctx);
  const ovrVorher = playerOverall(p);

  const einheiten = ctx.einheiten || (club ? planEinheiten(ensureClubTraining(club)) : {});
  const tage = ctx.tage != null ? ctx.tage : 5;
  const intensitaet = ctx.intensitaet != null ? ctx.intensitaet : (club ? clamp(club.training.intensitaet, 0, 100) : 55);
  const stabFaktor = ctx.stabFaktor != null ? ctx.stabFaktor
    : STAB_MIN + (STAB_MAX - STAB_MIN) * (ausbildungsniveau(state, p.clubId) / 100);

  const stabRoh = ctx.stabRoh || (club ? {
    cotrainer: stabWert(state, club, 'cotrainer'),
    athletik: stabWert(state, club, 'athletik'),
    torwarttrainer: stabWert(state, club, 'torwarttrainer'),
    physio: stabWert(state, club, 'physio')
  } : {});

  /* --- Faktoren ---------------------------------------------------------- */
  const traits = p.traits || [];
  let alterFaktor = lerpKurve(ALTER_KURVE, p.age || 26);
  if (traits.includes('spaetzuender') && p.age >= 26) alterFaktor *= 2.1;
  if (traits.includes('wunderkind') && p.age <= 23) alterFaktor *= 1.12;

  const rest = Math.max(0, (p.potential || ovrVorher) - ovrVorher);
  const potFaktor = rest / (rest + POT_HALBWERT);

  const quote = spielzeitQuote(p);
  const spielzeitFaktor = SPIELZEIT_MIN + SPIELZEIT_SPANNE * clamp(quote, 0, 1.1);

  const fitness = clamp(p.fitness ?? 100, 1, 100);
  const frischeFaktor = FRISCHE_MIN + (1 - FRISCHE_MIN) * (fitness / 100);

  const moral = clamp(p.morale ?? 70, 1, 100);
  const moralFaktor = 1 - MORAL_SPANNE / 2 + MORAL_SPANNE * (moral / 100);

  const persId = (p.personality && p.personality.id) || 'loyal';
  const persFaktor = PERSOENLICHKEIT[persId] || 1;

  let traitFaktor = 1;
  for (const tr of traits) if (TRAIT_LERN[tr]) traitFaktor *= TRAIT_LERN[tr];

  // Trainingsumfang: 5 Tage = Norm. Weniger Einheiten, weniger Fortschritt.
  const umfangFaktor = clamp(0.35 + 0.13 * tage, 0.3, 1.15);
  const intensitaetFaktor = clamp(0.55 + intensitaet / 90, 0.55, 1.35);

  const vektor = schwerpunktVektor(state, club || { training: {} }, p, einheiten, stabRoh);
  const w = POSITION_WEIGHTS[p.position] || POSITION_WEIGHTS.ZM;
  let guete = 0;
  for (const k in vektor) guete += vektor[k] * (w[k] || 0);

  const mentor = mentorFaktor(state, p);

  let punkte = BASIS_WOCHENPUNKTE * alterFaktor * potFaktor * spielzeitFaktor
    * frischeFaktor * moralFaktor * persFaktor * traitFaktor
    * stabFaktor * umfangFaktor * intensitaetFaktor * mentor
    * (difficulty.xpGain || 1);
  if (ctx.urlaub) punkte *= 0.15;
  if (p.injury) punkte *= 0.2;

  /* --- Zuwachs verteilen -------------------------------------------------- */
  const fort = t.fortschritt;
  const deckel = Math.min(99, (p.potential || 99) + ATTR_UEBER_POT);
  for (const k in vektor) {
    const alt = p.attributes[k];
    if (alt == null) continue;
    if (alt >= deckel || alt >= 99) continue;
    fort[k] = (fort[k] || 0) + punkte * vektor[k];
  }

  /* --- Abbau (Alterung) --------------------------------------------------- */
  let abbauOvr = 0;
  if ((p.age || 26) >= DECLINE_START) {
    let jahresVerlust = lerpKurve(ABBAU_KURVE, p.age);
    for (const tr of traits) if (TRAIT_ABBAU[tr]) jahresVerlust *= TRAIT_ABBAU[tr];
    if (p.position === 'TW') jahresVerlust *= ABBAU_TORWART;
    // Gute Regeneration und Betreuung bremsen den Verfall.
    const regenAnteil = (einheiten.regeneration || 0) + (einheiten.auslaufen || 0) + (einheiten.beweglichkeit || 0);
    const medizin = (club && club.facilities && club.facilities.medical) || 55;
    jahresVerlust *= clamp(1.12 - regenAnteil * 0.035 - medizin / 900, 0.72, 1.15);
    jahresVerlust *= clamp(1.16 - fitness / 320, 0.85, 1.16);

    abbauOvr = jahresVerlust / WOCHEN_PRO_SAISON;
    // Profil so skalieren, dass der Overall-Verlust exakt getroffen wird.
    let netto = 0;
    for (const k in ABBAU_PROFIL) netto += ABBAU_PROFIL[k] * (w[k] || 0);
    const skala = abbauOvr / Math.max(0.04, netto);
    for (const k in ABBAU_PROFIL) {
      const alt = p.attributes[k];
      if (alt == null) continue;
      const d = -ABBAU_PROFIL[k] * skala;
      if (d > 0 && alt >= Math.min(99, (p.potential || 99) + ATTR_UEBER_POT)) continue;
      fort[k] = (fort[k] || 0) + d;
    }
  }

  /* --- Ganzzahlige Schritte übernehmen ------------------------------------ */
  const veraenderungen = [];
  for (const k in fort) {
    const wert = fort[k];
    if (wert >= 1) {
      const schritte = Math.floor(wert);
      const neu = clamp(p.attributes[k] + schritte, 1, 99);
      const echt = neu - p.attributes[k];
      p.attributes[k] = neu;
      fort[k] = wert - schritte;
      if (echt !== 0) {
        veraenderungen.push({ attribut: k, delta: echt });
        t.gains[k] = (t.gains[k] || 0) + echt;
      }
    } else if (wert <= -1) {
      const schritte = Math.ceil(wert);
      const neu = clamp(p.attributes[k] + schritte, 1, 99);
      const echt = neu - p.attributes[k];
      p.attributes[k] = neu;
      fort[k] = wert - schritte;
      if (echt !== 0) {
        veraenderungen.push({ attribut: k, delta: echt });
        t.gains[k] = (t.gains[k] || 0) + echt;
      }
    }
  }

  const ovrNachher = playerOverall(p);
  if (veraenderungen.length) {
    t.letzteEntwicklung = { saison: state.date.season, tag: state.date.day, ovr: ovrNachher };
  }
  return {
    playerId,
    veraenderungen,
    ovrVorher, ovrNachher, ovrDelta: ovrNachher - ovrVorher,
    punkte: round(punkte, 4), guete: round(guete, 4),
    faktoren: {
      alter: round(alterFaktor, 3), potenzial: round(potFaktor, 3),
      spielzeit: round(spielzeitFaktor, 3), frische: round(frischeFaktor, 3),
      moral: round(moralFaktor, 3), stab: round(stabFaktor, 3),
      trait: round(traitFaktor, 3), umfang: round(umfangFaktor, 3),
      intensitaet: round(intensitaetFaktor, 3), mentor: round(mentor, 3),
      abbau: round(abbauOvr, 4)
    }
  };
}

/* ==========================================================================
 * 10. Form & Spielpraxis
 * ======================================================================== */

/**
 * Form schwankt: gute Noten heben sie, Bank und laues Training senken sie.
 * @returns {{ form, delta, ziel, text }}
 */
export function formEntwicklung(state, playerId, ctx = {}) {
  const p = state.players[playerId];
  if (!p) return null;
  const t = ensurePlayerTraining(p);
  const rng = ctx.rng || fallbackRng(state, 'form:' + playerId);
  const leistung = ctx.leistung || t.letzteWoche || { minuten: 0, note: 0 };
  const alt = clamp(p.form ?? 50, 1, 99);

  let ziel = 46
    + ((p.morale ?? 70) - 60) * 0.14
    + ((p.fitness ?? 100) - 90) * 0.16;

  if (leistung.minuten > 0 && leistung.note > 0) {
    ziel += (leistung.note - FORM_NOTE_REF) * 7.5;
    ziel += clamp(leistung.minuten / 90, 0, 2) * 1.5;
  } else if (!p.injury) {
    ziel -= FORM_BANK_MALUS;
  }
  if (p.injury) ziel -= 8;

  const guete = ctx.guete != null ? ctx.guete : GUETE_REFERENZ;
  ziel += clamp((guete / GUETE_REFERENZ - 1) * 6, -5, 5);

  ziel = clamp(ziel, 5, 95);
  const swing = (p.personality && p.personality.moraleSwing) || 1;
  const neu = clamp(alt + (ziel - alt) * FORM_TRAEGHEIT + rng.gauss(0, FORM_RAUSCHEN) * swing, 1, 99);
  p.form = Math.round(neu);

  const delta = p.form - Math.round(alt);
  return {
    form: p.form, delta, ziel: round(ziel, 1),
    text: delta >= 4 ? `${spielerName(p)} zieht im Training das Tempo an.`
      : delta <= -4 ? `${spielerName(p)} wirkt neben der Spur.`
        : ''
  };
}

/**
 * Spielfrische (sharpness): Wettkampfrhythmus. Wer nur trainiert, bleibt stumpf.
 * @returns {{ sharpness, delta, minuten, text }}
 */
export function spielpraxis(state, playerId) {
  const p = state.players[playerId];
  if (!p) return null;
  const t = ensurePlayerTraining(p);
  const minuten = (t.letzteWoche && t.letzteWoche.minuten) || 0;
  const alt = clamp(p.sharpness ?? 60, 1, 100);

  let ziel;
  if (p.injury) ziel = Math.max(20, SHARP_OHNE_SPIEL - 8);
  else if (minuten >= 170) ziel = 94;
  else if (minuten >= 80) ziel = 84;
  else if (minuten >= 30) ziel = 66;
  else if (minuten > 0) ziel = 55;
  else ziel = SHARP_OHNE_SPIEL;

  const neu = clamp(alt + (ziel - alt) * SHARP_TRAEGHEIT, 1, 100);
  p.sharpness = Math.round(neu);
  const delta = p.sharpness - Math.round(alt);
  return {
    sharpness: p.sharpness, delta, minuten,
    text: p.sharpness < 45
      ? `${spielerName(p)} fehlt der Spielrhythmus — im Training ist er top, im Spiel eine Bremse.`
      : ''
  };
}

/* ==========================================================================
 * 11. Aktionen für die Screens
 * ======================================================================== */

/**
 * Wochenplan setzen. plan = { 0:[einheitId, einheitId], … 6:[…] }, max. 2/Tag.
 * @returns {{ ok, text, warnungen, plan }}
 */
export function wochenplanSetzen(state, clubId, plan) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Unbekannter Verein.', warnungen: [] };
  if (!plan || typeof plan !== 'object') {
    return { ok: false, text: 'Kein gültiger Wochenplan übergeben.', warnungen: [] };
  }
  const t = ensureClubTraining(club);
  const neu = {};
  const warnungen = [];
  let einheitenGesamt = 0, harte = 0, freieTage = 0;

  for (let d = 0; d < 7; d++) {
    const roh = plan[d] || plan[String(d)] || [];
    if (!Array.isArray(roh)) {
      return { ok: false, text: `Der ${WOCHENTAGE[d]} enthält keine Einheitenliste.`, warnungen };
    }
    const gefiltert = [];
    for (const id of roh) {
      if (!EINHEITEN[id]) {
        return { ok: false, text: `„${id}" ist keine bekannte Trainingseinheit.`, warnungen };
      }
      if (gefiltert.length >= 2) {
        warnungen.push(`${WOCHENTAGE[d]}: mehr als zwei Einheiten sind nicht drin — der Rest fällt weg.`);
        break;
      }
      gefiltert.push(id);
    }
    neu[d] = gefiltert;
    einheitenGesamt += gefiltert.length;
    for (const id of gefiltert) if (EINHEITEN[id].ermuedung >= 6) harte++;
    if (!gefiltert.length || (gefiltert.length === 1 && gefiltert[0] === 'frei')) freieTage++;
  }

  if (freieTage === 0) warnungen.push('Kein einziger freier Tag. Die Mannschaft wird das nicht lange mitmachen.');
  if (harte >= 6) warnungen.push('Sechs harte Einheiten pro Woche — der Physio kauft schon mal Verbandszeug.');
  if (einheitenGesamt <= 3) warnungen.push('So wenig Training bringt keine Entwicklung. Aber erholt sind sie.');
  if ((neu[5] || []).length >= 2) warnungen.push('Am Samstag wird gespielt, nicht trainiert — die Einheiten verfallen an Spieltagen.');

  t.wochenplan = neu;
  t.schwerpunkt = erkenneSchwerpunkt(neu);
  return {
    ok: true, plan: neu, warnungen,
    text: `Neuer Wochenplan steht: ${einheitenGesamt} Einheiten, Schwerpunkt ${SCHWERPUNKTE[t.schwerpunkt].name}.`
  };
}

/** Aus einem freien Plan den dominierenden Schwerpunkt ableiten. */
function erkenneSchwerpunkt(plan) {
  const zaehler = {};
  for (let d = 0; d < 7; d++) {
    for (const id of plan[d] || []) {
      const e = EINHEITEN[id];
      if (!e) continue;
      zaehler[e.kategorie] = (zaehler[e.kategorie] || 0) + 1;
    }
  }
  const beste = sortBy(Object.keys(zaehler), k => ({ key: zaehler[k], desc: true }))[0];
  const map = {
    kondition: 'kondition', technik: 'technik', taktik: 'taktik',
    erholung: 'regeneration', spiel: 'ausgeglichen', spezial: 'ausgeglichen'
  };
  return map[beste] || 'ausgeglichen';
}

/** Trainingsintensität 0..100 setzen. */
export function intensitaetSetzen(state, clubId, wert) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  const t = ensureClubTraining(club);
  t.intensitaet = clamp(Math.round(wert), 0, 100);
  const text = t.intensitaet >= 85 ? 'Volle Pulle. Hoffentlich hält das Lazarett stand.'
    : t.intensitaet >= 60 ? 'Zügige Intensität — so kommt Entwicklung zustande.'
      : t.intensitaet >= 35 ? 'Gemäßigtes Pensum. Die Beine bleiben frisch.'
        : 'Schongang. Entwicklung findet woanders statt.';
  return { ok: true, intensitaet: t.intensitaet, text };
}

/** Schwerpunkt per Vorlage setzen (überschreibt den Wochenplan). */
export function schwerpunktSetzen(state, clubId, schwerpunkt) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  if (!SCHWERPUNKTE[schwerpunkt]) {
    return { ok: false, text: `„${schwerpunkt}" ist kein bekannter Schwerpunkt.` };
  }
  const t = ensureClubTraining(club);
  t.schwerpunkt = schwerpunkt;
  t.wochenplan = standardplan(schwerpunkt);
  return { ok: true, text: `Schwerpunkt ${SCHWERPUNKTE[schwerpunkt].name}: ${SCHWERPUNKTE[schwerpunkt].desc}` };
}

/**
 * Individualtraining: ein Spieler arbeitet gezielt an einem Attribut.
 * attribut = null beendet es.
 * @returns {{ ok, text }}
 */
export function individualtraining(state, playerId, attribut, intensitaet = 60) {
  const p = state.players[playerId];
  if (!p) return { ok: false, text: 'Diesen Spieler gibt es nicht.' };
  const t = ensurePlayerTraining(p);

  if (attribut === null || attribut === undefined || attribut === '') {
    t.focus = null;
    return { ok: true, text: `${spielerName(p)} trainiert wieder ganz normal mit der Mannschaft.` };
  }
  if (!ATTRIBUTES.includes(attribut)) {
    return { ok: false, text: `„${attribut}" ist kein Attribut, an dem man arbeiten kann.` };
  }
  const istTW = p.position === 'TW';
  if (!istTW && KEEPER_ATTRIBUTES.includes(attribut)) {
    return { ok: false, text: `${spielerName(p)} ist kein Torwart. Reflexe übt er woanders.` };
  }
  if (p.injury) {
    return { ok: false, text: `${spielerName(p)} liegt beim Physio. Zusatzschichten sind da schlecht.` };
  }
  const wert = p.attributes[attribut] || 0;
  const deckel = Math.min(99, (p.potential || 99) + ATTR_UEBER_POT);
  if (wert >= deckel) {
    return { ok: false, text: `${ATTRIBUTE_NAMES[attribut]} ist bei ${spielerName(p)} ausgereizt. Mehr geht nicht.` };
  }

  t.focus = attribut;
  t.intensitaet = clamp(Math.round(intensitaet), 0, 100);
  const hart = t.intensitaet >= 75;
  return {
    ok: true, attribut, intensitaet: t.intensitaet,
    text: `${spielerName(p)} hängt ab sofort Sonderschichten an: ${ATTRIBUTE_NAMES[attribut]}` +
      (hart ? ' — mit voller Härte. Der Rest seines Spiels leidet und die Beine werden schwer.'
        : '. Der Rest seiner Entwicklung läuft etwas langsamer.')
  };
}

/**
 * Trainingslager buchen.
 * @param ziel   Ort-Id aus TRAININGSLAGER_ORTE
 * @param dauer  Tage (4..16)
 * @param budget 'sparsam'|'normal'|'luxus' oder ein Euro-Betrag
 */
export function trainingslager(state, clubId, ziel, dauer = 8, budget = 'normal') {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Unbekannter Verein.' };
  const ort = TRAININGSLAGER_ORTE[ziel];
  if (!ort) return { ok: false, text: `„${ziel}" steht nicht im Reisekatalog.` };
  const t = ensureClubTraining(club);
  if (t.trainingslager) {
    return { ok: false, text: 'Die Mannschaft ist bereits im Trainingslager. Zwei Reisen gleichzeitig gehen nicht.' };
  }
  const tage = clamp(Math.round(dauer), 4, 16);

  const tag = state.date.day;
  const fenster = LAGER_FENSTER.find(f => tag >= f.von && tag <= f.bis);
  if (!fenster) {
    return {
      ok: false,
      text: 'Mitten im Spielbetrieb ins Trainingslager? Der Spielplan lässt das nicht zu. ' +
        'Möglich ist das nur in der Sommer- oder Wintervorbereitung.'
    };
  }

  const kader = club.playerIds.length || 24;
  const normalKosten = ort.kostenProTagUndSpieler * tage * kader;
  let budgetId = 'normal';
  if (typeof budget === 'string' && LAGER_BUDGETS[budget]) budgetId = budget;
  else if (typeof budget === 'number' && budget > 0) {
    const f = budget / Math.max(1, normalKosten);
    budgetId = f < 0.82 ? 'sparsam' : f > 1.3 ? 'luxus' : 'normal';
  }
  const b = LAGER_BUDGETS[budgetId];
  const kosten = Math.round(normalKosten * b.faktor);

  const kasse = club.finances.balance - kosten;
  if (kasse < -Math.max(2000000, club.finances.balance * 0.5)) {
    return {
      ok: false, kosten,
      text: `${formatMoney(kosten)} für ein Trainingslager? Der Schatzmeister lacht heiser und legt auf.`
    };
  }

  // Buchung in der von core/state.js dokumentierten Ledger-Form (club/finances.js führt das Konto).
  club.finances.balance -= kosten;
  club.finances.ledger.push({
    day: state.date.day, season: state.date.season, betrag: -kosten,
    kategorie: 'training', text: `Trainingslager ${ort.name} (${tage} Tage, ${b.name})`
  });
  if (club.finances.saison) {
    club.finances.saison.ausgabenSonstige = (club.finances.saison.ausgabenSonstige || 0) + kosten;
  }

  // Fan-Reaktion (club/fans.js bleibt Herr über die Stimmung — das hier ist ein Stups).
  const fanDelta = ort.fanReaktion + (budgetId === 'luxus' ? -1 : 0);
  club.fans.mood = clamp(round((club.fans.mood ?? 60) + fanDelta * 0.5, 1), 0, 100);
  if (fanDelta < 0) club.fans.protest = clamp((club.fans.protest || 0) + 3, 0, 100);

  t.trainingslager = {
    ortId: ort.id, name: ort.name, tage, restTage: tage, budget: budgetId,
    startTag: state.date.day, saison: state.date.season, kosten, verletzungen: 0,
    plan: lagerPlan(ort)
  };

  const fanText = fanDelta <= -5
    ? ' Auf den Rängen wird schon an Transparenten gemalt.'
    : fanDelta >= 3 ? ' Die Fans planen bereits die Reisebusse.' : '';
  return {
    ok: true, kosten, ort: ort.id, dauer: tage, budget: budgetId,
    text: `${tage} Tage ${ort.name} (${ort.land}), ${b.name.toLowerCase()} gebucht. ` +
      `Kosten: ${formatMoney(kosten)}.${fanText}`
  };
}

/** Tagesprogramm im Trainingslager — zwei Einheiten, kein Pardon. */
function lagerPlan(ort) {
  if (ort.kondition >= 1.15) {
    return [
      ['ausdauerlauf', 'spielformen'],
      ['intervalltraining', 'passspiel'],
      ['kraftraum', 'torschuss'],
      ['sprinttraining', 'taktik_offensiv'],
      ['ausdauerlauf', 'abschlussspiel'],
      ['regeneration', 'teambuilding'],
      ['beweglichkeit', 'spielformen']
    ];
  }
  return [
    ['ausdauerlauf', 'passspiel'],
    ['kraftraum', 'spielformen'],
    ['taktik_defensiv', 'torschuss'],
    ['intervalltraining', 'standards'],
    ['spielformen', 'abschlussspiel'],
    ['regeneration', 'teambuilding'],
    ['auslaufen', 'taktik_offensiv']
  ];
}

/* ==========================================================================
 * 12. Berichte & Prognosen
 * ======================================================================== */

/**
 * Trainingsbericht für den Screen: Plan, Frische, Auf- und Absteiger, Warnungen.
 */
export function trainingsbericht(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Unbekannter Verein.', zeilen: [] };
  const t = ensureClubTraining(club);
  const spieler = club.playerIds.map(id => state.players[id]).filter(Boolean);
  const niveau = ausbildungsniveau(state, clubId);

  const frische = spieler.length ? round(avg(spieler, p => p.fitness ?? 100), 1) : 100;
  const form = spieler.length ? round(avg(spieler, p => p.form ?? 50), 1) : 50;
  const sharp = spieler.length ? round(avg(spieler, p => p.sharpness ?? 60), 1) : 60;
  const verletzte = spieler.filter(p => p.injury).length;

  const entwickler = sortBy(
    spieler.map(p => {
      const g = p.training && p.training.gains ? p.training.gains : {};
      let summe = 0;
      for (const k in g) summe += g[k];
      return { p, summe };
    }).filter(e => e.summe !== 0),
    e => ({ key: e.summe, desc: true })
  );

  const zeilen = [];
  zeilen.push(`Schwerpunkt: ${SCHWERPUNKTE[t.schwerpunkt] ? SCHWERPUNKTE[t.schwerpunkt].name : t.schwerpunkt}, Intensität ${Math.round(t.intensitaet)}.`);
  zeilen.push(`Ausbildungsniveau des Vereins: ${Math.round(niveau)} von 100.`);
  zeilen.push(`Frische ${frische}, Form ${form}, Spielrhythmus ${sharp}. ${verletzte} Spieler in Behandlung.`);

  const auf = entwickler.filter(e => e.summe > 0).slice(0, 4);
  const ab = entwickler.filter(e => e.summe < 0).slice(-3).reverse();
  if (auf.length) zeilen.push('Beste Entwicklung dieser Saison: ' + auf.map(e => `${spielerName(e.p)} (+${e.summe})`).join(', ') + '.');
  if (ab.length) zeilen.push('Abbau: ' + ab.map(e => `${spielerName(e.p)} (${e.summe})`).join(', ') + '.');

  const warnungen = [];
  if (frische < 78) warnungen.push('Die Mannschaft ist müde. Regeneration oder weniger Intensität wären angebracht.');
  if (niveau < 45) warnungen.push('Trainerstab und Anlagen sind unterdurchschnittlich — hier verschenken Sie Talente.');
  if (t.intensitaet > 85 && frische < 88) warnungen.push('Hohe Intensität bei müder Mannschaft: das Verletzungsrisiko steigt spürbar.');
  const jung = spieler.filter(p => p.age <= 21 && (p.potential || 0) - playerOverall(p) >= 8);
  const ohnePraxis = jung.filter(p => (p.training && p.training.einsatzquote != null ? p.training.einsatzquote : 0.5) < 0.25);
  if (ohnePraxis.length) {
    warnungen.push(`${ohnePraxis.map(spielerName).join(', ')} ${ohnePraxis.length === 1 ? 'braucht' : 'brauchen'} Spielminuten, sonst verpufft das Talent.`);
  }
  for (const w of warnungen) zeilen.push(w);

  return {
    ok: true, zeilen, text: zeilen.join('\n'),
    plan: t.wochenplan, intensitaet: t.intensitaet, schwerpunkt: t.schwerpunkt,
    niveau: round(niveau, 1), frische, form, sharpness: sharp, verletzte,
    letzteBewertung: t.letzteBewertung, lager: t.trainingslager, warnungen
  };
}

/**
 * Entwicklungsprognose eines Spielers über `jahre` Saisons — ohne Zufall,
 * rein aus den aktuellen Rahmenbedingungen hochgerechnet.
 */
export function talentEntwicklungsPrognose(state, playerId, jahre = 5) {
  const p = state.players[playerId];
  if (!p) return { ok: false, text: 'Diesen Spieler gibt es nicht.', jahre: [] };
  const club = state.clubs[p.clubId];
  const difficulty = DIFFICULTIES[state.difficulty] || DIFFICULTIES.profi;
  const n = clamp(Math.round(jahre), 1, 12);

  const niveau = club ? ausbildungsniveau(state, p.clubId) : 55;
  const stabFaktor = STAB_MIN + (STAB_MAX - STAB_MIN) * (niveau / 100);
  const einheiten = club ? planEinheiten(ensureClubTraining(club)) : planEinheiten({ schwerpunkt: 'ausgeglichen' });
  const intensitaet = club ? clamp(club.training.intensitaet, 0, 100) : 55;
  const traits = p.traits || [];
  const w = POSITION_WEIGHTS[p.position] || POSITION_WEIGHTS.ZM;

  const stabRoh = club ? {
    cotrainer: stabWert(state, club, 'cotrainer'),
    athletik: stabWert(state, club, 'athletik'),
    torwarttrainer: stabWert(state, club, 'torwarttrainer'),
    physio: stabWert(state, club, 'physio')
  } : {};
  const vektor = schwerpunktVektor(state, club || { training: {} }, p, einheiten, stabRoh);
  let guete = 0;
  for (const k in vektor) guete += vektor[k] * (w[k] || 0);

  const quote = (p.training && p.training.einsatzquote != null) ? p.training.einsatzquote : 0.55;
  const spielzeitFaktor = SPIELZEIT_MIN + SPIELZEIT_SPANNE * clamp(quote, 0, 1.1);
  const moralFaktor = 1 - MORAL_SPANNE / 2 + MORAL_SPANNE * (clamp(p.morale ?? 70, 1, 100) / 100);
  const persFaktor = PERSOENLICHKEIT[(p.personality && p.personality.id) || 'loyal'] || 1;
  let traitFaktor = 1;
  for (const tr of traits) if (TRAIT_LERN[tr]) traitFaktor *= TRAIT_LERN[tr];
  const umfangFaktor = clamp(0.35 + 0.13 * 5, 0.3, 1.15);
  const intensitaetFaktor = clamp(0.55 + intensitaet / 90, 0.55, 1.35);

  let ovr = playerOverall(p);
  let alter = p.age || 26;
  const pot = p.potential || ovr;
  const reihe = [{ saison: state.date.season, alter, ovr, prognose: false }];

  for (let i = 1; i <= n; i++) {
    alter += 1;
    let alterFaktor = lerpKurve(ALTER_KURVE, alter);
    if (traits.includes('spaetzuender') && alter >= 26) alterFaktor *= 2.1;
    if (traits.includes('wunderkind') && alter <= 23) alterFaktor *= 1.12;

    let ovrJahr = ovr;
    // In Wochenschritten, damit der Potenzialfaktor mitläuft.
    for (let woche = 0; woche < WOCHEN_PRO_SAISON; woche++) {
      const rest = Math.max(0, pot - ovrJahr);
      const potFaktor = rest / (rest + POT_HALBWERT);
      const punkte = BASIS_WOCHENPUNKTE * alterFaktor * potFaktor * spielzeitFaktor
        * 0.95 * moralFaktor * persFaktor * traitFaktor * stabFaktor
        * umfangFaktor * intensitaetFaktor * (difficulty.xpGain || 1);
      ovrJahr += punkte * guete;
    }
    if (alter >= DECLINE_START) {
      let verlust = lerpKurve(ABBAU_KURVE, alter);
      for (const tr of traits) if (TRAIT_ABBAU[tr]) verlust *= TRAIT_ABBAU[tr];
      if (p.position === 'TW') verlust *= ABBAU_TORWART;
      ovrJahr -= verlust;
    }
    ovr = clamp(ovrJahr, 20, 99);
    reihe.push({
      saison: state.date.season + i, alter,
      ovr: Math.round(ovr), min: Math.round(ovr - 2 - i * 0.6), max: Math.round(Math.min(pot + 1, ovr + 2 + i * 0.8)),
      prognose: true
    });
  }

  const ende = reihe[reihe.length - 1];
  const ausschoepfung = pot > 0 ? round((ende.ovr / pot) * 100, 0) : 100;
  let text;
  if (ende.ovr - reihe[0].ovr >= 12) text = `${spielerName(p)} kann in ${n} Jahren ein anderer Spieler sein — vorausgesetzt, er spielt.`;
  else if (ende.ovr - reihe[0].ovr >= 5) text = `${spielerName(p)} wird sich solide weiterentwickeln.`;
  else if (ende.ovr - reihe[0].ovr >= -1) text = `${spielerName(p)} ist ausentwickelt. Was Sie sehen, ist was Sie bekommen.`;
  else text = `${spielerName(p)} baut ab. Rechtzeitig verkaufen ist keine Schande.`;
  if (ausschoepfung >= 96) text += ' Sein Potenzial wäre damit praktisch ausgereizt.';
  else if (ausschoepfung <= 80) text += ' Von seinem Potenzial bliebe einiges liegen.';

  return {
    ok: true, playerId, name: spielerName(p), potenzial: pot,
    jahre: reihe, endOvr: ende.ovr, potenzialAusschoepfung: ausschoepfung, text
  };
}
