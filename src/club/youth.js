/**
 * club/youth.js — Jugendakademie, Talente, Nachwuchs.
 * ============================================================================
 *
 * Der Nachwuchs ist das langsamste, unsicherste und auf lange Sicht lohnendste
 * Geschäft des Vereins. Ein Eigengewächs kostet keine Ablöse, verdient wenig,
 * macht die Fans glücklich und lässt sich notfalls für richtig Geld verkaufen.
 * Nur: Es dauert Jahre, und aus vier von fünf Talenten wird nie etwas.
 *
 * Zuständigkeit dieses Moduls (siehe CONTRACTS.md §11):
 *   club.youth.*            Akademie, Talente, Regionen, Sichtungen, Ausbau
 *   club.facilities.youth   Ausbaustufe der Akademie
 *   player.nachwuchs.*      Entwicklungsdaten eines Talents (eigenes Feld)
 *   player.eigengewaechs    Marke für durchgebrachte Spieler
 *
 * Fremde Felder werden NICHT verändert — mit einer bewusst kleinen Ausnahme:
 * beim Debüt eines Eigengewächses gibt es einen einmaligen kleinen Schub auf
 * club.fans.mood (EIGENGEWAECHS_MOOD_SCHUB). Das ist das Herzstück des Anreizes.
 *
 * KEIN DOM, kein Math.random(), kein Date.now().
 *
 * ---------------------------------------------------------------------------
 * ANNAHMEN ÜBER FREMDE MODULE (weich angebunden, Fallback jeweils vorhanden):
 *   data/generator.js  -> generateYouthProspect(rng, club, opts)
 *   core/state.js      -> initPlayerRuntime(player, rng)
 *   club/finances.js   -> buchen(state, clubId, betrag, kategorie, text)
 * ---------------------------------------------------------------------------
 */

import { clamp, round, sortBy, avg, formatMoney, uid } from '../core/util.js';
import { createRng, hashString } from '../core/rng.js';
import { POSITIONS, POSITION_NAMES, POSITION_WEIGHTS, POSITION_GROUP, ATTRIBUTES } from '../core/constants.js';
import { playerOverall, marketValue } from '../engine/ratings.js';
import { mk, deriveSalary, kostenSkala } from '../data/squads/_helper.js';
import { stabWirkung, stabVon } from './staff.js';

/* ==========================================================================
 * 0. Weiche Anbindung an fremde Module
 * ======================================================================== */

let _gen = null, _stateMod = null, _finanzen = null;
try { _gen = await import('../data/generator.js'); } catch (e) { _gen = null; }
try { _stateMod = await import('../core/state.js'); } catch (e) { _stateMod = null; }
try { _finanzen = await import('./finances.js'); } catch (e) { _finanzen = null; }

function buchen(state, clubId, betrag, kategorie, text) {
  const club = state.clubs[clubId];
  if (!club || !betrag) return;
  if (_finanzen && typeof _finanzen.buchen === 'function') {
    const vorher = club.finances.balance;
    try {
      _finanzen.buchen(state, clubId, betrag, kategorie, text);
      if (club.finances.balance !== vorher) return;
    } catch (e) { /* Eigenbuchung unten */ }
  }
  const f = club.finances;
  f.balance += betrag;
  if (!f.ledger) f.ledger = [];
  f.ledger.push({ day: state.date.day, season: state.date.season, betrag, kategorie, text });
  if (f.ledger.length > 1500) f.ledger.shift();
  if (!f.saison) f.saison = {};
  f.saison[kategorie] = (f.saison[kategorie] || 0) + Math.abs(betrag);
}

/* ==========================================================================
 * 1. BALANCING
 * ======================================================================== */

/** Entwicklung. Werte sind Gesamtstärke-Punkte pro WOCHE. */
const ENTW_BASIS = 0.075;                 // Grundtempo eines Talents
const ENTW_AKADEMIE_SPANNE = 0.85;        // Akademie 0..100 -> ×(1 .. 1.85)
const ENTW_TRAINER_SPANNE = 0.95;         // Jugendtrainer-Wirkung 0..100 -> ×(0,55 .. 1,5)
const ENTW_LUECKE_SKALA = 22;             // Abstand zum Potenzial wirkt bis hierhin voll
const ENTW_ALTER_PEAK = 17;               // schnellste Entwicklung
const ENTW_ALTER_ABFALL = 0.085;          // je Jahr Abstand vom Peak
const ENTW_STREUUNG = 0.55;               // Zufallsanteil (0 = völlig planbar)

/** Potenzial ist NICHT in Stein gemeißelt. */
const POTENZIAL_REVISION_CHANCE = 0.022;  // je Talent und Woche
const POTENZIAL_REVISION_SD = 4.5;
const POTENZIAL_REGRESSION = 1.4;         // Hochbegabte werden häufiger nach unten korrigiert

/** Scouting-Unschärfe. */
const SCHAETZ_FEHLER_MAX = 20;            // Punkte Potenzial bei Sicherheit 0
const SICHERHEIT_BASIS = 18;
const SICHERHEIT_JE_JAHR_IM_VEREIN = 14;
const SICHERHEIT_SCOUTING_SPANNE = 45;

/** Akademie & Betrieb. */
const AKADEMIE_BETRIEB_FAKTOR = 5200;     // × akademie^1.6 × Vereinsgröße = Kosten pro Jahr
const KOSTEN_JE_TALENT = 26000;           // Internat, Schule, Betreuung pro Jahr
const SICHTUNG_KOSTEN = 12000;
const SICHTUNG_ABSTAND_MIN = 38;
const SICHTUNG_ABSTAND_MAX = 68;
const AUSBAU_BAUZEIT_FAKTOR = 1.0;

/** Jahrgang. */
const JAHRGANG_BASIS = 2.4;               // Talente pro Saison bei Akademie 0
const JAHRGANG_AKADEMIE = 4.2;            // zusätzlich bei Akademie 100
const JAHRGANG_MAX = 14;                  // Obergrenze im Nachwuchskader
const JUGEND_MAX_ALTER = 20;              // danach: Profivertrag oder Abschied
const JUGEND_MAX_JAHRE = 5;               // Notbremse, falls kein Alterungsmodul läuft

/** Beförderung & Eigengewächse. */
const PROFI_SCHWELLE_SOCKEL = 38;
const PROFI_SCHWELLE_REP = 0.28;
const EIGENGEWAECHS_GEHALT_FAKTOR = 0.55; // Eigengewächse verdienen anfangs deutlich weniger
const EIGENGEWAECHS_MOOD_SCHUB = 2;       // einmalig bei der Beförderung
const EIGENGEWAECHS_FAN_MAX = 12;         // maximaler Dauer-Bonus für die Fanstimmung

/** Jugendturnier. */
const TURNIER_TAGE = [26, 208];           // Sommer- und Wintervorbereitung
const TURNIER_STARTGELD = 15000;
const TURNIER_PREISGELD = [120000, 60000, 30000, 15000, 8000, 5000, 3000, 0];

/* ==========================================================================
 * 2. AKADEMIE-STUFEN
 * ======================================================================== */

export const AKADEMIE_STUFEN = [
  { stufe: 1, name: 'Bolzplatz und guter Wille', wert: 20, kosten: 0, tage: 0, desc: 'Zwei Trainer, ein Ballnetz, ein Trainingsplatz mit Maulwürfen.' },
  { stufe: 2, name: 'Vereinsheim mit Kunstrasen', wert: 38, kosten: 2600000, tage: 120, desc: 'Endlich Flutlicht und eine Umkleide, die nicht nach 1974 riecht.' },
  { stufe: 3, name: 'Nachwuchsleistungszentrum', wert: 55, kosten: 8500000, tage: 180, desc: 'Zertifiziert, mit Physioraum, Videoraum und viel Papierkram.' },
  { stufe: 4, name: 'NLZ mit Internat', wert: 70, kosten: 19000000, tage: 240, desc: 'Talente aus der ganzen Republik können jetzt hier wohnen und zur Schule gehen.' },
  { stufe: 5, name: 'Nachwuchs-Campus', wert: 84, kosten: 38000000, tage: 300, desc: 'Eigene Reha, eigene Küche, eigener Rasenmäher-Fuhrpark.' },
  { stufe: 6, name: 'Talentschmiede von Weltruf', wert: 95, kosten: 76000000, tage: 365, desc: 'Wer hier ausgebildet wird, spielt irgendwo erste Liga. Irgendwo.' }
];

export function akademieStufeVon(wert) {
  let s = AKADEMIE_STUFEN[0];
  for (const st of AKADEMIE_STUFEN) if (wert >= st.wert - 3) s = st;
  return s;
}

/* ==========================================================================
 * 3. SCOUTING-REGIONEN
 * ======================================================================== */

/**
 * Jede Region kostet laufend Geld und liefert typische Profile:
 *   bias  = Attributzuschläge (in Punkten) für die Region
 *   pos   = bevorzugte Positionen
 *   pot   = Zuschlag auf das Potenzial (Auslandsmärkte sind teuer, aber ergiebig)
 */
export const SCOUTING_REGIONEN = {
  'de-nord': {
    id: 'de-nord', name: 'Deutschland Nord', kostenJahr: 140000, deutsch: true, potBonus: 0,
    nationen: ['DE', 'DE', 'DE', 'DK', 'PL'], pos: ['IV', 'ST', 'TW', 'ZM'],
    bias: { koerper: 5, kopfball: 5, zweikampf: 4, technik: -3 },
    profil: 'Groß, robust, kopfballstark. Feintechniker sind hier selten.'
  },
  'de-sued': {
    id: 'de-sued', name: 'Deutschland Süd', kostenJahr: 150000, deutsch: true, potBonus: 2,
    nationen: ['DE', 'DE', 'DE', 'AT', 'HR'], pos: ['ZM', 'OM', 'IV', 'RV'],
    bias: { positionsspiel: 5, passspiel: 4, uebersicht: 3 },
    profil: 'Gut ausgebildete Vereinsarbeit, taktisch früh geschult.'
  },
  'de-west': {
    id: 'de-west', name: 'Deutschland West', kostenJahr: 155000, deutsch: true, potBonus: 3,
    nationen: ['DE', 'DE', 'DE', 'TR', 'MA', 'PL'], pos: ['LA', 'RA', 'OM', 'ST'],
    bias: { dribbling: 6, tempo: 4, technik: 4, positionsspiel: -3 },
    profil: 'Die dichteste Talentlandschaft Europas. Straßenfußballer mit Tempo.'
  },
  'de-ost': {
    id: 'de-ost', name: 'Deutschland Ost', kostenJahr: 110000, deutsch: true, potBonus: -1,
    nationen: ['DE', 'DE', 'DE', 'CZ'], pos: ['DM', 'IV', 'LV', 'ST'],
    bias: { ausdauer: 5, aggressivitaet: 5, zweikampf: 4, technik: -2 },
    profil: 'Wenig Geld, viel Wille. Läufer und Kämpfer, günstig zu haben.'
  },
  'at-ch': {
    id: 'at-ch', name: 'Österreich/Schweiz', kostenJahr: 190000, potBonus: 1,
    nationen: ['AT', 'CH', 'DE', 'XK', 'AL'], pos: ['ZM', 'RV', 'LV', 'ST'],
    bias: { ausdauer: 4, positionsspiel: 4, nervenstaerke: 3 },
    profil: 'Sauber ausgebildet, sofort bundesligatauglich, selten spektakulär.'
  },
  'skandinavien': {
    id: 'skandinavien', name: 'Skandinavien', kostenJahr: 300000, potBonus: 2,
    nationen: ['SE', 'NO', 'DK', 'FI', 'IS'], pos: ['ST', 'IV', 'TW', 'DM'],
    bias: { koerper: 6, sprungkraft: 4, nervenstaerke: 4, dribbling: -3 },
    profil: 'Athletisch, professionell, spätreif — und sprachlich unproblematisch.'
  },
  'benelux': {
    id: 'benelux', name: 'Benelux', kostenJahr: 340000, potBonus: 4,
    nationen: ['NL', 'BE', 'LU', 'MA', 'CD'], pos: ['LA', 'RA', 'ZM', 'IV'],
    bias: { technik: 6, passspiel: 5, uebersicht: 4, koerper: -3 },
    profil: 'Technisch top ausgebildet. Die Ajax-Schule wirkt bis in die Kreisklasse.'
  },
  'frankreich': {
    id: 'frankreich', name: 'Frankreich', kostenJahr: 420000, potBonus: 6,
    nationen: ['FR', 'FR', 'SN', 'ML', 'CI', 'DZ'], pos: ['ST', 'LA', 'DM', 'IV'],
    bias: { tempo: 7, sprungkraft: 5, koerper: 4, positionsspiel: -3 },
    profil: 'Die besten Athleten Europas. Teuer umkämpft, aber der Markt ist riesig.'
  },
  'iberien': {
    id: 'iberien', name: 'Iberische Halbinsel', kostenJahr: 400000, potBonus: 5,
    nationen: ['ES', 'PT', 'BR', 'AO', 'CV'], pos: ['OM', 'ZM', 'RA', 'LV'],
    bias: { technik: 7, passspiel: 6, dribbling: 5, koerper: -5 },
    profil: 'Ballsicher von klein auf. Körperlich brauchen sie zwei Jahre.'
  },
  'suedosteuropa': {
    id: 'suedosteuropa', name: 'Südosteuropa', kostenJahr: 260000, potBonus: 3,
    nationen: ['HR', 'RS', 'BA', 'RO', 'BG', 'AL', 'GR', 'MK'], pos: ['ZM', 'ST', 'IV', 'TW'],
    bias: { zweikampf: 6, nervenstaerke: 5, aggressivitaet: 5, ausdauer: 3 },
    profil: 'Mentalität und Zweikampf. Günstig, aber die Berater sind hartnäckig.'
  },
  'westafrika': {
    id: 'westafrika', name: 'Westafrika', kostenJahr: 430000, potBonus: 8,
    nationen: ['SN', 'NG', 'GH', 'CI', 'ML', 'BF', 'GN', 'TG', 'CM'], pos: ['ST', 'LA', 'DM', 'IV'],
    bias: { tempo: 8, sprungkraft: 7, koerper: 5, positionsspiel: -7, uebersicht: -5 },
    profil: 'Rohdiamanten mit gewaltiger Physis. Taktisch ein Jahr Nachhilfe nötig.'
  },
  'suedamerika': {
    id: 'suedamerika', name: 'Südamerika', kostenJahr: 540000, potBonus: 9,
    nationen: ['BR', 'AR', 'UY', 'CO', 'CL', 'PY', 'PE', 'EC'], pos: ['OM', 'LA', 'ST', 'RA'],
    bias: { dribbling: 9, technik: 7, schuss: 4, koerper: -4, ausdauer: -3 },
    profil: 'Die spektakulärsten Talente der Welt — und die kompliziertesten Verträge.'
  },
  'japan-korea': {
    id: 'japan-korea', name: 'Japan/Korea', kostenJahr: 380000, potBonus: 4,
    nationen: ['JP', 'KR'], pos: ['RM', 'LM', 'ZM', 'ST'],
    bias: { ausdauer: 7, positionsspiel: 5, technik: 4, koerper: -4 },
    profil: 'Diszipliniert, unermüdlich, lernwillig. Anpassung meist unproblematisch.'
  },
  'nordamerika': {
    id: 'nordamerika', name: 'Nordamerika', kostenJahr: 310000, potBonus: 3,
    nationen: ['US', 'CA', 'MX'], pos: ['TW', 'RV', 'ZM', 'ST'],
    bias: { koerper: 5, ausdauer: 5, sprungkraft: 4, technik: -3 },
    profil: 'College-Athleten mit Nachholbedarf am Ball, dafür topfit und günstig.'
  }
};

export const REGION_IDS = Object.keys(SCOUTING_REGIONEN);

/** Ordnet einen Verein anhand seiner Stadt einer Heimatregion zu. */
const STADT_REGION = [
  [['Hamburg', 'Bremen', 'Kiel', 'Rostock', 'Hannover', 'Wolfsburg', 'Braunschweig', 'Osnabrück', 'Lübeck', 'Oldenburg', 'Magdeburg'], 'de-nord'],
  [['München', 'Nürnberg', 'Fürth', 'Stuttgart', 'Freiburg', 'Augsburg', 'Heidenheim', 'Sandhausen', 'Regensburg', 'Ulm', 'Karlsruhe', 'Hoffenheim', 'Sinsheim', 'Ingolstadt', 'Unterhaching'], 'de-sued'],
  [['Dortmund', 'Gelsenkirchen', 'Leverkusen', 'Köln', 'Düsseldorf', 'Mönchengladbach', 'Bochum', 'Essen', 'Duisburg', 'Bielefeld', 'Paderborn', 'Münster', 'Aachen', 'Wuppertal', 'Frankfurt', 'Mainz', 'Darmstadt', 'Kaiserslautern', 'Saarbrücken', 'Wiesbaden', 'Elversberg'], 'de-west'],
  [['Leipzig', 'Dresden', 'Berlin', 'Cottbus', 'Jena', 'Erfurt', 'Chemnitz', 'Zwickau', 'Aue', 'Halle', 'Potsdam'], 'de-ost']
];

export function heimatRegion(club) {
  const stadt = (club && club.city) || '';
  for (const [staedte, region] of STADT_REGION) {
    for (const s of staedte) if (stadt.indexOf(s) >= 0) return region;
  }
  return 'de-west';
}

/** Normalisiert die (evtl. aus core/state.js stammende) Regionsliste auf gültige IDs. */
function regionenVon(state, club) {
  const y = ensureYouth(state, club);
  const raw = Array.isArray(y.scoutingRegionen) ? y.scoutingRegionen : [];
  const out = [];
  for (const r of raw) {
    const id = SCOUTING_REGIONEN[r] ? r : (String(r).toLowerCase() === 'deutschland' ? heimatRegion(club) : null);
    if (id && !out.includes(id)) out.push(id);
  }
  if (!out.length) out.push(heimatRegion(club));
  y.scoutingRegionen = out;
  return out;
}

/** Wie viele Regionen darf der Verein gleichzeitig beobachten? Hängt am Scoutingstab. */
export function maxRegionen(state, clubId) {
  const stab = stabVon(state, clubId);
  let n = 1;
  for (const s of stab) {
    if (s.roleId === 'scout') n += 1;
    else if (s.roleId === 'chefscout') n += 2;
    else if (s.roleId === 'sportdirektor') n += 1;
  }
  return clamp(n, 1, REGION_IDS.length);
}

/* ==========================================================================
 * 4. Namen für den Nachwuchs
 * ======================================================================== */

const NAMEN = {
  DE: [['Luca', 'Ben', 'Noah', 'Elias', 'Finn', 'Jona', 'Nick', 'Til', 'Lennard', 'Malte', 'Fabio', 'Mika', 'Emil', 'Jannik', 'Tom'],
    ['Wenzel', 'Kraft', 'Hübner', 'Meinhardt', 'Stroh', 'Deubel', 'Rickert', 'Lampe', 'Weiler', 'Schuster', 'Bauer', 'Röhl', 'Kienzle', 'Osterloh', 'Grabowski', 'Nachtigall', 'Pfaff', 'Sattler']],
  AT: [['Fabian', 'Lukas', 'Matthias', 'Simon', 'David'], ['Gruber', 'Steinlechner', 'Pichler', 'Wallner', 'Hinteregger']],
  CH: [['Nils', 'Yann', 'Loris', 'Silvan'], ['Widmer', 'Zbinden', 'Ruprecht', 'Gasser']],
  DK: [['Mads', 'Rasmus', 'Emil', 'Anders'], ['Jensen', 'Nyholm', 'Kristensen', 'Bak']],
  SE: [['Viktor', 'Elias', 'Gustav', 'Hugo'], ['Lindgren', 'Ekdal', 'Nyström', 'Bergqvist']],
  NO: [['Ola', 'Erling', 'Jonas', 'Sindre'], ['Haugen', 'Nordby', 'Ødegård', 'Solberg']],
  FI: [['Eetu', 'Onni', 'Väinö'], ['Koskinen', 'Virtanen', 'Laine']],
  IS: [['Arnar', 'Birkir'], ['Sigurdsson', 'Jónsson']],
  NL: [['Sem', 'Daan', 'Jurriën', 'Thijs', 'Ruben'], ['van Dijk', 'Bakker', 'de Wit', 'Veerman', 'Hoogland']],
  BE: [['Lars', 'Arne', 'Wout'], ['Vermeulen', 'Claes', 'De Ketelaere']],
  LU: [['Yann'], ['Thill']],
  FR: [['Enzo', 'Nathan', 'Ilyes', 'Mathis', 'Théo', 'Warren'], ['Dubois', 'Bamba', 'Mendy', 'Lefèvre', 'Traoré', 'Ndiaye']],
  ES: [['Iker', 'Pablo', 'Álvaro', 'Nico'], ['Herrera', 'Vidal', 'Serrano', 'Bermejo']],
  PT: [['Diogo', 'Rúben', 'Tomás'], ['Ferreira', 'Almeida', 'Cardoso']],
  IT: [['Matteo', 'Lorenzo'], ['Rossetti', 'Bernardi']],
  HR: [['Luka', 'Ivan', 'Marko'], ['Kovačić', 'Perišić', 'Babić']],
  RS: [['Nikola', 'Stefan'], ['Jovanović', 'Marković']],
  BA: [['Amar', 'Edin'], ['Hodžić', 'Begović']],
  AL: [['Ardit', 'Endrit'], ['Hoxha', 'Krasniqi']],
  XK: [['Bledian', 'Arber'], ['Berisha', 'Gashi']],
  MK: [['Darko'], ['Trajkovski']],
  GR: [['Giorgos', 'Dimitris'], ['Papadopoulos', 'Nikolaidis']],
  RO: [['Andrei', 'Ionut'], ['Popescu', 'Marin']],
  BG: [['Georgi'], ['Iliev']],
  CZ: [['Tomáš', 'Jakub'], ['Novák', 'Dvořák']],
  PL: [['Kacper', 'Szymon', 'Filip'], ['Kowalczyk', 'Zieliński', 'Nowak']],
  TR: [['Emre', 'Kerem', 'Baris'], ['Yildiz', 'Öztürk', 'Kaplan']],
  SN: [['Ousmane', 'Ibrahima', 'Cheikh'], ['Diallo', 'Ndiaye', 'Sarr']],
  NG: [['Chidi', 'Emeka', 'Samuel'], ['Okafor', 'Adeyemi', 'Eze']],
  GH: [['Kwame', 'Kofi'], ['Mensah', 'Boateng']],
  CI: [['Yacine', 'Serge'], ['Kouassi', 'Bakayoko']],
  ML: [['Moussa', 'Amadou'], ['Traoré', 'Konaté']],
  BF: [['Issa'], ['Ouédraogo']],
  GN: [['Mamadou'], ['Camara']],
  TG: [['Kodjo'], ['Agbeko']],
  CM: [['Éric', 'Vincent'], ['Ngoumou', 'Fai']],
  MA: [['Bilal', 'Anas'], ['El Amrani', 'Benali']],
  DZ: [['Riad'], ['Belkacem']],
  AO: [['Nuno'], ['Miguel']],
  CV: [['Elvis'], ['Tavares']],
  CD: [['Junior'], ['Mbala']],
  BR: [['Gabriel', 'Vinícius', 'Kauã', 'Matheus', 'Léo'], ['Silva', 'Ribeiro', 'Cardoso', 'dos Santos', 'Moraes']],
  AR: [['Facundo', 'Thiago', 'Lautaro'], ['Gómez', 'Álvarez', 'Ferrari']],
  UY: [['Santiago'], ['Rodríguez']],
  CO: [['Juan', 'Andrés'], ['Ospina', 'Restrepo']],
  CL: [['Benjamín'], ['Contreras']],
  PY: [['Diego'], ['Benítez']],
  PE: [['Piero'], ['Quispe']],
  EC: [['Kendry'], ['Plata']],
  JP: [['Sota', 'Ren', 'Haruto'], ['Tanaka', 'Watanabe', 'Kobayashi']],
  KR: [['Min-jae', 'Seung-ho'], ['Kim', 'Lee']],
  US: [['Tyler', 'Cameron', 'Malik'], ['Johnson', 'Miller', 'Robinson']],
  CA: [['Liam'], ['Tremblay']],
  MX: [['Diego', 'Santiago'], ['Hernández', 'Ramírez']]
};

function nameFuer(nat, rng) {
  const pool = NAMEN[nat] || NAMEN.DE;
  return { vn: rng.pick(pool[0]), nn: rng.pick(pool[1]) };
}

/* ==========================================================================
 * 5. Lazy-Init und Helfer
 * ======================================================================== */

function ensureYouth(state, club) {
  if (!club.youth) {
    club.youth = {
      akademie: club.facilities ? club.facilities.youth : 50,
      talente: [], scoutingRegionen: [], naechsteSichtung: 0, jahrgang: []
    };
  }
  const y = club.youth;
  if (!Array.isArray(y.talente)) y.talente = [];
  if (!Array.isArray(y.jahrgang)) y.jahrgang = [];
  if (y.akademie === undefined) y.akademie = club.facilities ? club.facilities.youth : 50;
  if (y.naechsteSichtung === undefined) y.naechsteSichtung = 0;
  if (y.ausbau === undefined) y.ausbau = null;
  if (y.durchbrueche === undefined) y.durchbrueche = 0;
  if (y.abgaenge === undefined) y.abgaenge = 0;
  if (y.befoerdert === undefined) y.befoerdert = 0;
  if (y.turnier === undefined) y.turnier = null;
  return y;
}

/** Entwicklungsdaten eines Talents (eigenes Namensfeld, kollidiert mit nichts). */
function ensureNachwuchs(state, p) {
  if (!p.nachwuchs) {
    p.nachwuchs = {
      seit: { season: state.date.season, day: state.date.day },
      jahre: 0,
      fortschritt: 0,
      startOvr: playerOverall(p),
      bestOvr: playerOverall(p),
      region: null,
      revisionen: 0,
      gemeldet: 0,
      turniere: 0
    };
  }
  return p.nachwuchs;
}

export function talenteRoh(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return [];
  const y = ensureYouth(state, club);
  const out = [];
  for (const id of y.talente) {
    const p = state.players[id];
    if (p) { ensureNachwuchs(state, p); out.push(p); }
  }
  return out;
}

function actionRng(state, label) {
  return createRng(hashString(label + ':' + state.seed + ':' + state.tick + ':' + state.date.day));
}

/** Ab welcher Stärke ist ein Talent profitauglich für diesen Verein? */
export function profiSchwelle(club) {
  return Math.round(PROFI_SCHWELLE_SOCKEL + (club.reputation || 50) * PROFI_SCHWELLE_REP);
}

/* ==========================================================================
 * 6. Talente erzeugen
 * ======================================================================== */

function runtimeFuellen(state, p, rng) {
  if (_stateMod && typeof _stateMod.initPlayerRuntime === 'function') {
    try { return _stateMod.initPlayerRuntime(p, rng); } catch (e) { /* Fallback unten */ }
  }
  p.form = clamp(Math.round(rng.gauss(50, 12)), 20, 80);
  p.morale = clamp(Math.round(rng.gauss(70, 10)), 35, 95);
  p.fitness = 100;
  p.sharpness = clamp(Math.round(rng.gauss(50, 10)), 20, 80);
  p.injury = null;
  p.cards = { yellow: 0, red: 0, ban: 0, seasonYellow: 0 };
  p.happiness = { spielzeit: 60, gehalt: 60, ambition: 60, trainer: 60, beschwerden: [] };
  p.training = { focus: null, gains: {}, intensitaet: 50, woche: 0 };
  p.stats = {
    season: { spiele: 0, startelf: 0, minuten: 0, tore: 0, vorlagen: 0, schuesse: 0, paraden: 0, gegentore: 0, zuNull: 0, zweikaempfe: 0, zweikaempfeGewonnen: 0, gelb: 0, gelbrot: 0, rot: 0, notenSumme: 0, notenAnzahl: 0, motm: 0 },
    career: { spiele: 0, startelf: 0, minuten: 0, tore: 0, vorlagen: 0, schuesse: 0, paraden: 0, gegentore: 0, zuNull: 0, zweikaempfe: 0, zweikaempfeGewonnen: 0, gelb: 0, gelbrot: 0, rot: 0, notenSumme: 0, notenAnzahl: 0, motm: 0 },
    history: []
  };
  p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
  p.joined = { season: state.date.season, day: state.date.day };
  p.captain = false;
  return p;
}

/** Notfall-Generator, falls data/generator.js (noch) nicht verfügbar ist. */
function fallbackProspect(rng, club, opts) {
  const nat = opts.nation || 'DE';
  const { vn, nn } = nameFuer(nat, rng);
  const alter = opts.alter !== undefined ? opts.alter : rng.int(15, 18);
  const pot = clamp(Math.round(opts.potenzial !== undefined ? opts.potenzial : rng.gauss(58, 13)), 32, 94);
  const ovr = clamp(Math.round(pot - rng.int(14, 32)), 18, pot);
  return mk({
    id: uid('p_' + club.id + '_jug', rng),
    club: club.id, vn, nn, nat, age: alter,
    pos: opts.position || rng.pick(POSITIONS),
    ovr, pot,
    until: 0
  });
}

/** Erzeugt ein neues Talent für einen Verein aus einer Region. */
function neuesTalent(state, club, regionId, rng, opts = {}) {
  const region = SCOUTING_REGIONEN[regionId] || SCOUTING_REGIONEN[heimatRegion(club)];
  const y = ensureYouth(state, club);
  const nat = rng.pick(region.nationen);
  const alter = opts.alter !== undefined ? opts.alter : rng.int(15, 18);

  // Potenzial: Akademie und Vereinsruf ziehen bessere Jungs an, Auslandsmärkte auch.
  const basis = 42 + y.akademie * 0.16 + (club.reputation || 50) * 0.13 + region.potBonus;
  const pot = clamp(Math.round(rng.gauss(basis, 11) + (opts.potBonus || 0)), 30, 96);

  let p = null;
  if (_gen && typeof _gen.generateYouthProspect === 'function') {
    try {
      p = _gen.generateYouthProspect(rng.fork('prospect'), club, {
        nation: nat, nationality: nat, alter, age: alter, potenzial: pot, potential: pot,
        position: opts.position, region: region.id
      });
    } catch (e) { p = null; }
  }
  if (!p || !p.attributes) p = fallbackProspect(rng, club, { nation: nat, alter, potenzial: pot, position: opts.position });

  // Nachbearbeitung: Herkunft, Alter und Potenzial gehören uns, egal was der Generator tat.
  p.nationality = nat;
  p.age = alter;
  p.potential = clamp(Math.max(pot, playerOverall(p) + 2), 30, 96);
  p.clubId = club.id;
  if (!p.contract) p.contract = { salary: 0, until: 0, signOn: 0, releaseClause: null };
  p.contract.salary = Math.round(18000 + y.akademie * 260);   // Förderlizenz, kein Profivertrag
  p.contract.until = state.date.season + 2;

  // Regionalprofil aufprägen
  for (const key in region.bias) {
    if (!ATTRIBUTES.includes(key)) continue;
    p.attributes[key] = clamp(Math.round(p.attributes[key] + region.bias[key]), 3, 99);
  }
  if (opts.position && POSITION_WEIGHTS[opts.position]) p.position = opts.position;
  else if (rng.chance(0.55)) p.position = rng.pick(region.pos);

  p.value = marketValue(p);
  p.jugend = true;
  runtimeFuellen(state, p, rng);
  const n = ensureNachwuchs(state, p);
  n.region = region.id;
  n.startOvr = playerOverall(p);
  n.bestOvr = n.startOvr;

  state.players[p.id] = p;
  y.talente.push(p.id);
  return p;
}

/**
 * Neuer Jahrgang zum Saisonstart. Größe hängt an der Akademie, Herkunft an den
 * beobachteten Regionen.
 */
export function jugendJahrgang(state, clubId, rng) {
  const club = state.clubs[clubId];
  if (!club) return [];
  const y = ensureYouth(state, club);
  const r = rng || actionRng(state, 'jahrgang:' + clubId);
  const regionen = regionenVon(state, club);

  let anzahl = JAHRGANG_BASIS + (y.akademie / 100) * JAHRGANG_AKADEMIE;
  anzahl = Math.max(1, Math.round(anzahl + r.gauss(0, 0.8)));
  anzahl = Math.min(anzahl, Math.max(0, JAHRGANG_MAX - y.talente.length));

  const neue = [];
  for (let i = 0; i < anzahl; i++) {
    // Die Heimatregion liefert die Masse, Auslandsregionen die Ausreißer.
    const regionId = r.pickWeighted(regionen, id => (SCOUTING_REGIONEN[id].deutsch ? 3 : 1.4));
    neue.push(neuesTalent(state, club, regionId, r.fork('t' + i), { alter: r.int(15, 17) }));
  }
  y.jahrgang = neue.map(p => p.id);
  return neue;
}

/* ==========================================================================
 * 7. Bewertung mit Scouting-Unschärfe
 * ======================================================================== */

/** Deterministischer, spielerspezifischer Schätzfehler in [-1, 1]. */
function schaetzBias(playerId) {
  return (hashString('schaetz:' + playerId) / 4294967296) * 2 - 1;
}

/**
 * Wie sicher ist die Einschätzung? Steigt mit Scoutingqualität, Jugendarbeit,
 * Alter des Spielers und der Zeit, die er schon im Verein ist.
 */
function sicherheitVon(state, club, p) {
  const w = stabWirkung(state, club.id);
  const n = ensureNachwuchs(state, p);
  const scout = (w.scouting * 0.6 + w.jugend * 0.4) / 100;
  const jahre = clamp(n.jahre + (state.date.day / 365), 0, 5);
  const reife = clamp((p.age - 15) * 6, 0, 24);
  return clamp(Math.round(
    SICHERHEIT_BASIS + scout * SICHERHEIT_SCOUTING_SPANNE + jahre * SICHERHEIT_JE_JAHR_IM_VEREIN + reife
  ), 5, 97);
}

function sterneVon(pot) {
  if (pot >= 82) return 5;
  if (pot >= 72) return 4;
  if (pot >= 62) return 3;
  if (pot >= 50) return 2;
  return 1;
}

const EINSCHAETZUNG_HOCH = [
  'So einen sieht man alle paar Jahre. Wenn er gesund bleibt, spielt er irgendwann international.',
  'Der Junge hat alles: Anlagen, Kopf, Wille. Wir sollten ihn festbinden, bevor es andere merken.',
  'Da traut sich der ganze Nachwuchsbereich nicht, laut zu träumen. Aber alle tun es.'
];
const EINSCHAETZUNG_GUT = [
  'Ein richtig guter Junge. Erste Liga ist realistisch, wenn ihn niemand kaputtspielt.',
  'Solide Anlagen, gute Einstellung. Aus dem wird was — nur eben nicht morgen.',
  'Der könnte in zwei, drei Jahren im Profikader ganz selbstverständlich mittrainieren.'
];
const EINSCHAETZUNG_MITTEL = [
  'Zweite Liga würde ich ihm zutrauen. Für ganz oben fehlt vermutlich das letzte Prozent.',
  'Ordentlich, unauffällig, fleißig. So einer wird 300 Spiele im Unterhaus machen.',
  'Kann man mitnehmen. Kann man aber auch ziehen lassen, ohne nachts wach zu liegen.'
];
const EINSCHAETZUNG_SCHWACH = [
  'Ehrlich? Der wird kein Profi. Netter Kerl, spielt gern, das war es dann aber.',
  'Für unseren Nachwuchs reicht es, für den Profikader nicht einmal ansatzweise.',
  'Wir sollten ihm frühzeitig raten, das Abitur ernst zu nehmen.'
];
const UNSICHER_ZUSATZ = [
  'Allerdings haben wir ihn erst zweimal gesehen — das ist eher ein Gefühl als ein Bericht.',
  'Belastbar ist das noch nicht, dafür ist er zu jung und wir zu selten dabei.',
  'Der Scout schreibt selbst dazu: „Bitte nicht auf mich festnageln.“'
];
const SICHER_ZUSATZ = [
  'Wir beobachten ihn seit Jahren, an der Einschätzung wird sich wenig ändern.',
  'Da sind sich Jugendtrainer und Scouting ausnahmsweise einig.',
  'Diese Bewertung würden wir auch schriftlich abgeben.'
];

/**
 * Bewertet ein Talent aus Vereinssicht — bewusst UNGENAU.
 * Ein 5-Sterne-Talent kann floppen, ein 2-Sterne-Talent durchstarten.
 */
export function talentBewerten(state, clubId, playerId) {
  const club = state.clubs[clubId];
  const p = state.players[playerId];
  if (!club || !p) return null;
  ensureNachwuchs(state, p);

  const sicherheit = sicherheitVon(state, club, p);
  const fehler = SCHAETZ_FEHLER_MAX * (1 - sicherheit / 100);
  const bias = schaetzBias(p.id);
  const ovr = playerOverall(p);
  const potSchaetzung = clamp(Math.round(p.potential + bias * fehler), Math.max(ovr, 25), 99);
  const ovrSchaetzung = clamp(Math.round(ovr + bias * fehler * 0.35), 15, 99);
  const sterne = sterneVon(potSchaetzung);

  const rng = createRng(hashString('einsch:' + p.id + ':' + sterne));
  let text;
  if (sterne >= 5) text = rng.pick(EINSCHAETZUNG_HOCH);
  else if (sterne === 4) text = rng.pick(EINSCHAETZUNG_GUT);
  else if (sterne === 3) text = rng.pick(EINSCHAETZUNG_MITTEL);
  else text = rng.pick(EINSCHAETZUNG_SCHWACH);
  if (sicherheit < 45) text += ' ' + rng.pick(UNSICHER_ZUSATZ);
  else if (sicherheit > 80) text += ' ' + rng.pick(SICHER_ZUSATZ);

  return {
    playerId: p.id,
    sterne,
    potenzialSchaetzung: potSchaetzung,
    ovrSchaetzung,
    sicherheit,
    spanne: [clamp(potSchaetzung - Math.round(fehler), 20, 99), clamp(potSchaetzung + Math.round(fehler), 20, 99)],
    einschaetzung: text
  };
}

/** Alle Talente eines Vereins inklusive Scouting-Unschärfe. */
export function talente(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return [];
  const liste = talenteRoh(state, clubId).map(p => {
    const b = talentBewerten(state, clubId, p.id);
    const n = p.nachwuchs;
    return {
      player: p,
      id: p.id,
      name: `${p.firstName} ${p.lastName}`,
      shortName: p.shortName,
      alter: p.age,
      position: p.position,
      positionName: POSITION_NAMES[p.position],
      nationalitaet: p.nationality,
      region: n.region ? (SCOUTING_REGIONEN[n.region] || {}).name : null,
      jahreImVerein: n.jahre,
      sterne: b.sterne,
      potenzialSchaetzung: b.potenzialSchaetzung,
      ovrSchaetzung: b.ovrSchaetzung,
      sicherheit: b.sicherheit,
      spanne: b.spanne,
      einschaetzung: b.einschaetzung,
      profireif: playerOverall(p) >= profiSchwelle(club),
      wert: p.value
    };
  });
  return sortBy(liste, t => ({ key: t.sterne * 100 + t.potenzialSchaetzung, desc: true }));
}

/* ==========================================================================
 * 8. Entwicklung
 * ======================================================================== */

/** Hebt die Gesamtstärke um `punkte` (ganzzahlig), verteilt auf die Positionsattribute. */
function ovrAnheben(p, punkte, rng) {
  const weights = POSITION_WEIGHTS[p.position] || POSITION_WEIGHTS.ZM;
  for (let i = 0; i < punkte; i++) {
    for (const key in weights) {
      p.attributes[key] = clamp(p.attributes[key] + 1, 3, 99);
    }
    // Ein bisschen Streuung außerhalb des Profils — junge Spieler wachsen breit.
    const extra = rng.pick(ATTRIBUTES);
    p.attributes[extra] = clamp(p.attributes[extra] + 1, 3, 99);
  }
}

const DURCHBRUCH_TEXTE = [
  'hat in den letzten Wochen einen Sprung gemacht, den keiner erklären kann.',
  'trainiert plötzlich bei den Profis mit, ohne dass es peinlich wird.',
  'ist körperlich fertig geworden — und auf einmal ist er nicht mehr aufzuhalten.',
  'spielt die Jugendliga in Grund und Boden. Da müssen wir jetzt aufpassen.'
];
const ENTTAEUSCHUNG_TEXTE = [
  'kommt seit Monaten nicht weiter. Die Scouts revidieren ihre Einschätzung nach unten.',
  'hat den Anschluss verloren. Alle anderen sind gewachsen, er nicht.',
  'wirkt lustlos im Training. Aus dem großen Versprechen wird gerade ein normaler Junge.',
  'ist im Kopf nicht angekommen. Talent allein reicht in diesem Geschäft eben nicht.'
];

function talentEntwickeln(state, club, p, ctx, wJugend, rng, mine) {
  const y = club.youth;
  const n = ensureNachwuchs(state, p);
  const ovr = playerOverall(p);

  // Potenzialrevision: Das große Versprechen kann platzen — oder aufgehen.
  if (rng.chance(POTENZIAL_REVISION_CHANCE)) {
    const drift = rng.gauss(0, POTENZIAL_REVISION_SD) - (p.potential > 78 ? POTENZIAL_REGRESSION : 0);
    const alt = p.potential;
    p.potential = clamp(Math.round(p.potential + drift), Math.max(ovr, 28), 96);
    n.revisionen++;
    if (mine && alt - p.potential >= 7 && n.gemeldet < 3) {
      n.gemeldet++;
      ctx.log(`${p.firstName} ${p.lastName} (${p.age}) ${rng.pick(ENTTAEUSCHUNG_TEXTE)}`,
        'jugend', { from: 'Nachwuchsleitung', subject: `Rückschlag: ${p.lastName}` });
    }
  }

  if (ovr >= p.potential) {
    n.bestOvr = Math.max(n.bestOvr, ovr);
    return;
  }

  const luecke = clamp((p.potential - ovr) / ENTW_LUECKE_SKALA, 0.15, 1);
  const akademieF = 1 + (y.akademie / 100) * ENTW_AKADEMIE_SPANNE;
  const trainerF = 0.55 + (wJugend / 100) * ENTW_TRAINER_SPANNE;
  const alterF = clamp(1 - Math.abs(p.age - ENTW_ALTER_PEAK) * ENTW_ALTER_ABFALL, 0.35, 1);
  const moralF = 0.85 + (p.morale || 70) / 100 * 0.3;
  const zufall = 1 + rng.gauss(0, ENTW_STREUUNG);

  const gewinn = ENTW_BASIS * luecke * akademieF * trainerF * alterF * moralF * Math.max(0, zufall);
  n.fortschritt += gewinn;

  if (n.fortschritt >= 1) {
    const punkte = Math.floor(n.fortschritt);
    n.fortschritt -= punkte;
    ovrAnheben(p, punkte, rng);
    const neu = playerOverall(p);
    p.value = marketValue(p);

    if (mine && neu - n.bestOvr >= 6 && neu >= 55) {
      ctx.log(`${p.firstName} ${p.lastName} (${p.age}, ${POSITION_NAMES[p.position]}) ${rng.pick(DURCHBRUCH_TEXTE)} ` +
        `Aktuelle Einschätzung: ${talentBewerten(state, club.id, p.id).sterne} Sterne.`,
        'jugend', { from: 'Nachwuchsleitung', subject: `Durchbruch im Nachwuchs: ${p.lastName}` });
      y.durchbrueche++;
    }
    n.bestOvr = Math.max(n.bestOvr, neu);
  }
}

/* ==========================================================================
 * 9. TICK
 * ======================================================================== */

export function tickJugend(state, ctx) {
  const eigener = state.managerClubId;

  for (const clubId in state.clubs) {
    const club = state.clubs[clubId];
    // Europapokal-Gegner haben keine Jugendabteilung (core/state.js:euroClub).
    // 66 Vereine, die pro Saison sichten und einen Jahrgang nachziehen, wären
    // über drei Jahre rund tausend Spielerdatensätze für Talente, die nie ein
    // Mensch zu Gesicht bekommt – und knapp zwei Megabyte Spielstand.
    if (club.istEuropaeisch) continue;
    const y = ensureYouth(state, club);
    const mine = clubId === eigener;

    if (ctx.isMonthStart) jugendKostenBuchen(state, club, ctx, mine);

    if (y.ausbau) ausbauFortschritt(state, club, ctx, mine);

    if (TURNIER_TAGE.includes(ctx.day)) {
      const res = jugendturnier(state, clubId, ctx);
      if (mine && res && res.ok) {
        ctx.log(res.text, 'jugend', { from: 'Nachwuchsleitung', subject: 'Jugendturnier' });
      }
    }

    if (!ctx.isWeekStart) continue;
    const rng = ctx.rng.fork('jugend:' + clubId);

    // Sichtungstermine
    if (ctx.day >= (y.naechsteSichtung || 0)) sichtung(state, club, ctx, rng, mine);

    // Entwicklung
    const wJugend = stabWirkung(state, clubId).jugend;
    for (const p of talenteRoh(state, clubId)) {
      talentEntwickeln(state, club, p, ctx, wJugend, rng.fork(p.id), mine);
    }

    // Jahrgangswechsel
    if (ctx.isSeasonEnd && y.jahresabschluss !== state.date.season) {
      y.jahresabschluss = state.date.season;
      jahrgangswechsel(state, club, ctx, rng, mine);
    }
  }
}

/**
 * Betriebskosten der Akademie pro Jahr.
 *
 * Nicht nur die Stufe zählt, sondern auch der Verein: Ein Leistungszentrum mit
 * Stufenwert 60 heißt beim FC Bayern zehn Mannschaften, Internat und eigener
 * Küche — bei Elversberg heißt es zwei Trainer und ein Kunstrasenplatz. Ohne
 * `kostenSkala()` zahlte ein Zweitligist Bundesligapreise für seinen Nachwuchs
 * (gemessen: Paderborn 4,1 Mio bei 17,3 Mio Umsatz).
 */
function akademieBetriebJahr(club) {
  const y = club.youth || {};
  return Math.pow(clamp(y.akademie === undefined ? 50 : y.akademie, 5, 100), 1.6)
    * AKADEMIE_BETRIEB_FAKTOR * kostenSkala(club);
}

function jugendKostenBuchen(state, club, ctx, mine) {
  const y = club.youth;
  const regionen = regionenVon(state, club);
  const betriebJahr = akademieBetriebJahr(club);
  const talentJahr = y.talente.length * KOSTEN_JE_TALENT;
  const regionJahr = regionen.reduce((s, id) => s + SCOUTING_REGIONEN[id].kostenJahr, 0);
  const monat = Math.round((betriebJahr + talentJahr + regionJahr) / 12);
  if (monat > 0) buchen(state, club.id, -monat, 'ausgabenJugend', 'Nachwuchs und Scouting');
}

function sichtung(state, club, ctx, rng, mine) {
  const y = club.youth;
  const regionen = regionenVon(state, club);
  y.naechsteSichtung = ctx.day + rng.int(SICHTUNG_ABSTAND_MIN, SICHTUNG_ABSTAND_MAX);
  if (y.talente.length >= JAHRGANG_MAX) return;

  buchen(state, club.id, -SICHTUNG_KOSTEN, 'ausgabenJugend', 'Sichtungstermin');

  const w = stabWirkung(state, club.id);
  const chance = clamp(0.28 + (w.scouting - 40) / 190 + (y.akademie - 50) / 260, 0.08, 0.85);
  if (!rng.chance(chance)) {
    if (mine && rng.chance(0.35)) {
      ctx.log(`Die Sichtung in ${(SCOUTING_REGIONEN[regionen[0]] || {}).name || 'der Region'} hat nichts ergeben. ` +
        `Vierzig Jungs, viel Regen, kein Talent. So läuft das meistens.`,
        'jugend', { from: 'Nachwuchsleitung', subject: 'Sichtung ohne Ertrag' });
    }
    return;
  }

  const regionId = rng.pickWeighted(regionen, id => (SCOUTING_REGIONEN[id].deutsch ? 2.5 : 1.5));
  const p = neuesTalent(state, club, regionId, rng.fork('sicht'), { alter: rng.int(15, 18) });
  if (mine) {
    const b = talentBewerten(state, club.id, p.id);
    ctx.log(`Neuzugang im Nachwuchs: ${p.firstName} ${p.lastName} (${p.age}, ${POSITION_NAMES[p.position]}, ` +
      `${(SCOUTING_REGIONEN[regionId] || {}).name}). Erste Einschätzung: ${b.sterne} von 5 Sternen ` +
      `(Sicherheit ${b.sicherheit} %). ${b.einschaetzung}`,
      'jugend', { from: 'Nachwuchsleitung', subject: `Sichtung: ${p.lastName} verpflichtet` });
  }
}

function ausbauFortschritt(state, club, ctx, mine) {
  const y = club.youth;
  y.ausbau.restTage -= 1;
  if (y.ausbau.restTage > 0) return;
  const stufe = y.ausbau.stufe;
  y.akademie = y.ausbau.zielWert;
  if (!club.facilities) club.facilities = {};
  club.facilities.youth = y.ausbau.zielWert;
  const info = AKADEMIE_STUFEN.find(s => s.stufe === stufe) || { name: 'Akademie' };
  y.ausbau = null;
  if (mine) {
    ctx.log(`Der Ausbau ist fertig: „${info.name}“ steht. Die Akademie liegt jetzt bei ${y.akademie} von 100. ` +
      `Der Vorstand hat ein Band durchgeschnitten, die Nachwuchsleitung hat geweint. Vor Freude, hoffen wir.`,
      'jugend', { from: 'Nachwuchsleitung', subject: 'Akademieausbau abgeschlossen', wichtig: true });
  }
}

function jahrgangswechsel(state, club, ctx, rng, mine) {
  const y = club.youth;
  const schwelle = profiSchwelle(club);

  for (const p of talenteRoh(state, club.id)) {
    const n = p.nachwuchs;
    n.jahre++;
    if (p.age < JUGEND_MAX_ALTER && n.jahre < JUGEND_MAX_JAHRE) continue;

    const ovr = playerOverall(p);
    if (ovr >= schwelle || (p.potential >= schwelle + 8 && ovr >= schwelle - 6)) {
      const res = befoerdern(state, p.id);
      if (mine && res.ok) {
        ctx.log(`${p.firstName} ${p.lastName} (${p.age}) ist dem Nachwuchs entwachsen und steht ab sofort im Profikader. ` +
          `${res.text}`, 'jugend', { from: 'Nachwuchsleitung', subject: `Eigengewächs: ${p.lastName} rückt auf`, wichtig: true });
      }
    } else {
      abgang(state, club, p, ctx, rng, mine, schwelle - ovr);
    }
  }

  // Neuer Jahrgang für die kommende Saison
  const neue = jugendJahrgang(state, club.id, rng.fork('jahrgang'));
  if (mine && neue.length) {
    const beste = sortBy(neue.map(p => talentBewerten(state, club.id, p.id)), b => ({ key: b.sterne, desc: true }))[0];
    ctx.log(`Der neue Jahrgang ist da: ${neue.length} Spieler rücken in die A-Jugend. ` +
      `Der interessanteste ist ${state.players[beste.playerId].lastName} mit ${beste.sterne} Sternen. ` +
      `In vier Jahren wissen wir, ob das stimmt.`,
      'jugend', { from: 'Nachwuchsleitung', subject: 'Neuer Jahrgang im Nachwuchs' });
  }
}

function abgang(state, club, p, ctx, rng, mine, abstand) {
  const y = club.youth;
  y.talente = y.talente.filter(id => id !== p.id);
  y.abgaenge++;
  const ovr = playerOverall(p);

  if (ovr >= 48 && state.freeAgents) {
    // Für die Liga taugt er noch — er versucht es woanders.
    p.clubId = null;
    p.jugend = false;
    if (p.contract) p.contract.salary = Math.round(deriveSalary(ovr, p.value || 100000, p.age) * 0.7);
    state.freeAgents.push(p.id);
  } else {
    delete state.players[p.id];
  }

  if (mine && rng.chance(0.5)) {
    ctx.log(`${p.firstName} ${p.lastName} (${p.age}) bekommt keinen Profivertrag. ` +
      (abstand > 12
        ? 'Es hat nie ernsthaft gereicht, und das wusste er selbst am besten.'
        : 'Knapp daneben — vielleicht sehen wir ihn in ein paar Jahren in der zweiten Liga wieder.'),
      'jugend', { from: 'Nachwuchsleitung', subject: `Abschied: ${p.lastName}` });
  }
}

/* ==========================================================================
 * 10. AKTIONEN
 * ======================================================================== */

/** Talent in den Profikader hochziehen. Eigengewächse sind billig — das ist der Punkt. */
export function befoerdern(state, playerId) {
  const p = state.players[playerId];
  if (!p) return { ok: false, text: 'Diesen Spieler gibt es nicht.' };
  const club = state.clubs[p.clubId];
  if (!club) return { ok: false, text: 'Zu diesem Spieler ist kein Verein hinterlegt.' };
  const y = ensureYouth(state, club);
  if (!y.talente.includes(p.id)) return { ok: false, text: `${p.lastName} steht gar nicht im Nachwuchs.` };
  if (club.playerIds.length >= 32) return { ok: false, text: 'Der Profikader ist voll. Erst ausmisten, dann nachrücken lassen.' };

  y.talente = y.talente.filter(id => id !== p.id);
  y.befoerdert++;
  p.jugend = false;
  p.eigengewaechs = true;
  p.joined = { season: state.date.season, day: state.date.day };
  club.playerIds.push(p.id);

  const ovr = playerOverall(p);
  p.value = marketValue(p);
  // Mit `club`: das Gehalt richtet sich nach der Größe des Vereins, nicht nach
  // dem Weltmarkt (Gehaltsskala in data/squads/_helper.js).
  const gehalt = Math.max(90000, Math.round(deriveSalary(ovr, p.value, p.age, club) * EIGENGEWAECHS_GEHALT_FAKTOR / 10000) * 10000);
  p.contract = {
    salary: gehalt,
    until: state.date.season + 3,
    signOn: 0,
    releaseClause: null
  };

  // Freie Rückennummer suchen
  const belegt = new Set(club.playerIds.map(id => state.players[id]).filter(Boolean).map(x => x.number));
  let nr = p.position === 'TW' ? 12 : 20;
  while (belegt.has(nr) && nr < 60) nr++;
  p.number = nr;

  // Der eine kleine Fremdeingriff: Eigengewächse machen die Kurve glücklich.
  if (club.fans) club.fans.mood = clamp((club.fans.mood || 60) + EIGENGEWAECHS_MOOD_SCHUB, 0, 100);

  return {
    ok: true, player: p, gehalt,
    text: `Profivertrag bis Saison ${p.contract.until} für ${formatMoney(gehalt)} im Jahr — ` +
      `ein Bruchteil dessen, was ein vergleichbarer Zugang kosten würde. Rückennummer ${nr}.`
  };
}

/** Zurück in den Nachwuchs (nur für sehr junge Spieler sinnvoll). */
export function zurueckstufen(state, playerId) {
  const p = state.players[playerId];
  if (!p) return { ok: false, text: 'Diesen Spieler gibt es nicht.' };
  const club = state.clubs[p.clubId];
  if (!club) return { ok: false, text: 'Zu diesem Spieler ist kein Verein hinterlegt.' };
  if (p.age > 21) return { ok: false, text: `${p.lastName} ist ${p.age} — den kann man nicht mehr in die A-Jugend schicken, ohne dass es albern wird.` };
  const y = ensureYouth(state, club);
  if (y.talente.includes(p.id)) return { ok: false, text: `${p.lastName} ist bereits im Nachwuchs.` };
  if (!club.playerIds.includes(p.id)) return { ok: false, text: `${p.lastName} gehört nicht zu unserem Profikader.` };

  club.playerIds = club.playerIds.filter(id => id !== p.id);
  y.talente.push(p.id);
  p.jugend = true;
  ensureNachwuchs(state, p);

  return {
    ok: true,
    text: `${p.firstName} ${p.lastName} trainiert ab sofort wieder im Nachwuchs. Spielpraxis statt Bank — ` +
      `in seinem Alter ist das keine Strafe, sondern eine Chance. Sagen Sie ihm das am besten persönlich.`
  };
}

/**
 * Akademie ausbauen. `stufe` ist die ZIELstufe aus AKADEMIE_STUFEN (2..6).
 * Zwischenstufen werden mitbezahlt — wer von 2 auf 5 springt, zahlt 3, 4 und 5.
 */
export function akademieAusbauen(state, clubId, stufe) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.' };
  const y = ensureYouth(state, club);
  if (y.ausbau) return { ok: false, text: `Es wird bereits gebaut („${y.ausbau.name}“, noch ${y.ausbau.restTage} Tage).` };

  const aktuell = akademieStufeVon(y.akademie);
  const ziel = AKADEMIE_STUFEN.find(s => s.stufe === Number(stufe));
  if (!ziel) return { ok: false, text: 'Diese Ausbaustufe gibt es nicht.' };
  if (ziel.stufe <= aktuell.stufe) {
    return { ok: false, text: `Wir sind bereits auf Stufe ${aktuell.stufe} („${aktuell.name}“). Rückwärts bauen wir nicht.` };
  }

  let kosten = 0, tage = 0;
  for (const s of AKADEMIE_STUFEN) {
    if (s.stufe > aktuell.stufe && s.stufe <= ziel.stufe) { kosten += s.kosten; tage += s.tage; }
  }
  tage = Math.round(tage * AUSBAU_BAUZEIT_FAKTOR);

  const kasse = club.finances.balance;
  if (kasse < kosten * 0.4) {
    return {
      ok: false, kosten,
      text: `„${ziel.name}“ kostet ${formatMoney(kosten)}. Auf dem Konto liegen ${formatMoney(kasse)}. ` +
        `Die Bank lacht. Erst Geld verdienen, dann Beton gießen.`
    };
  }

  buchen(state, clubId, -kosten, 'ausgabenJugend', `Akademieausbau: ${ziel.name}`);
  y.ausbau = { stufe: ziel.stufe, name: ziel.name, restTage: tage, kosten, zielWert: ziel.wert };

  return {
    ok: true, kosten, tage, zielWert: ziel.wert,
    text: `Der Ausbau zu „${ziel.name}“ ist beauftragt: ${formatMoney(kosten)}, Bauzeit ${tage} Tage. ` +
      `Danach steht die Akademie bei ${ziel.wert} von 100. ${ziel.desc}`
  };
}

/** Scouting-Region an- oder abschalten. */
export function scoutingRegion(state, clubId, region, aktiv = true) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.' };
  const id = SCOUTING_REGIONEN[region] ? region :
    REGION_IDS.find(r => SCOUTING_REGIONEN[r].name.toLowerCase() === String(region).toLowerCase());
  if (!id) return { ok: false, text: 'Diese Region kennen wir nicht.' };
  const r = SCOUTING_REGIONEN[id];
  const aktuelle = regionenVon(state, club);
  const y = club.youth;

  if (!aktiv) {
    if (!aktuelle.includes(id)) return { ok: false, text: `${r.name} wird von uns gar nicht beobachtet.` };
    if (aktuelle.length <= 1) return { ok: false, text: 'Eine Region müssen wir behalten, sonst können wir den Nachwuchsbereich gleich schließen.' };
    y.scoutingRegionen = aktuelle.filter(x => x !== id);
    return { ok: true, text: `${r.name} wird nicht mehr beobachtet. Spart ${formatMoney(r.kostenJahr)} im Jahr — und kostet uns die Jungs von dort.` };
  }

  if (aktuelle.includes(id)) return { ok: false, text: `${r.name} beobachten wir bereits.` };
  const max = maxRegionen(state, clubId);
  if (aktuelle.length >= max) {
    return {
      ok: false, max,
      text: `Mit unserem Scoutingstab schaffen wir ${max} Region(en) gleichzeitig. ` +
        `Wer mehr will, stellt Scouts ein — oder einen Chefscout, der zwei Regionen abdeckt.`
    };
  }
  y.scoutingRegionen = aktuelle.concat([id]);
  return {
    ok: true, kostenJahr: r.kostenJahr,
    text: `${r.name} wird ab sofort beobachtet. Laufende Kosten: ${formatMoney(r.kostenJahr)} im Jahr. ${r.profil}`
  };
}

/* ==========================================================================
 * 11. Jugendturnier
 * ======================================================================== */

const TURNIER_NAMEN = [
  'Sparkassen-Cup der A-Jugend', 'Hallenturnier um den Pokal des Bürgermeisters',
  'Nachwuchs-Turnier in Bad Sassendorf', 'Internationales Junioren-Turnier',
  'Pfingstturnier des Kreisverbands', 'U19-Einladungsturnier'
];

/**
 * Ein Jugendturnier: kostet Startgeld, bringt Preisgeld, Entwicklungsschub für
 * die Teilnehmer — und mit etwas Glück entdeckt man beim Gegner ein Talent.
 */
export function jugendturnier(state, clubId, ctx) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.' };
  const y = ensureYouth(state, club);
  const rng = (ctx && ctx.rng ? ctx.rng.fork('turnier:' + clubId) : actionRng(state, 'turnier:' + clubId));
  const kader = talenteRoh(state, clubId);
  if (kader.length < 6) {
    return { ok: false, text: 'Für ein Turnier haben wir nicht einmal genug Jungs zusammen. Das ersparen wir uns.' };
  }

  buchen(state, clubId, -TURNIER_STARTGELD, 'ausgabenJugend', 'Startgeld Jugendturnier');

  const beste = sortBy(kader, p => ({ key: playerOverall(p), desc: true })).slice(0, 11);
  const staerke = avg(beste, p => playerOverall(p)) + y.akademie * 0.12 + stabWirkung(state, clubId).jugend * 0.10;
  const gegnerStaerke = 44 + (club.reputation || 50) * 0.18 + rng.gauss(0, 5);
  const diff = staerke - gegnerStaerke;

  let platz = clamp(Math.round(4.5 - diff * 0.32 + rng.gauss(0, 1.4)), 1, 8);
  const preis = TURNIER_PREISGELD[platz - 1] || 0;
  if (preis) buchen(state, clubId, preis, 'einnahmenPraemien', 'Preisgeld Jugendturnier');

  // Turniererfahrung: kleiner Schub für alle Teilnehmer
  for (const p of beste) {
    const n = ensureNachwuchs(state, p);
    n.turniere++;
    n.fortschritt += rng.float(0.05, 0.3) * (platz <= 3 ? 1.4 : 1);
    p.morale = clamp((p.morale || 70) + (platz <= 3 ? 4 : -1), 20, 100);
  }

  // Entdeckung beim Gegner
  let entdeckung = null;
  const w = stabWirkung(state, clubId);
  if (y.talente.length < JAHRGANG_MAX && rng.chance(clamp(0.12 + (w.scouting - 45) / 300, 0.05, 0.45))) {
    const regionen = regionenVon(state, club);
    entdeckung = neuesTalent(state, club, rng.pick(regionen), rng.fork('entdeckt'), {
      alter: rng.int(15, 17), potBonus: rng.int(4, 12)
    });
  }

  const name = rng.pick(TURNIER_NAMEN);
  const platzText = platz === 1 ? 'Turniersieg!' : platz === 2 ? 'Finalniederlage.' :
    platz === 3 ? 'Dritter Platz.' : `Platz ${platz}.`;
  y.turnier = { season: state.date.season, day: state.date.day, name, platz, preis };

  let text = `${name}: ${platzText} ` +
    (preis ? `Das bringt ${formatMoney(preis)} in die Nachwuchskasse. ` : 'Preisgeld: nichts. Dafür Erfahrung. ') +
    (platz <= 3 ? 'Die Jungs sind kaum zu bremsen. ' : 'Die Rückfahrt im Bus war still. ');
  if (entdeckung) {
    const b = talentBewerten(state, clubId, entdeckung.id);
    text += `Und: Unser Scout hat beim Gegner ${entdeckung.firstName} ${entdeckung.lastName} (${entdeckung.age}, ` +
      `${POSITION_NAMES[entdeckung.position]}) gesehen und ihn noch am selben Abend überredet. ${b.sterne} Sterne. ` +
      `${b.einschaetzung}`;
  }

  return { ok: true, platz, preis, name, entdeckung, teilnehmer: beste.length, text };
}

/* ==========================================================================
 * 12. Eigengewächse und Berichte
 * ======================================================================== */

/**
 * Was der Nachwuchs dem Verein bringt: Fanstimmung, Gehaltsersparnis, Buchwert.
 * Eigengewächse verdienen weniger als Zugänge gleicher Stärke und stehen mit
 * null Ablöse in den Büchern — genau das ist der Hebel.
 */
export function eigengewaechsBonus(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return null;
  const kader = (club.playerIds || []).map(id => state.players[id]).filter(Boolean);
  const eigen = kader.filter(p => p.eigengewaechs);
  const anzahl = eigen.length;
  const quote = kader.length ? anzahl / kader.length : 0;

  let ersparnis = 0, wert = 0;
  for (const p of eigen) {
    const ovr = playerOverall(p);
    const marktGehalt = deriveSalary(ovr, marketValue(p), p.age, club);
    ersparnis += Math.max(0, marktGehalt - p.contract.salary);
    wert += p.value || 0;
  }

  const stammelf = club.tactics && club.tactics.lineup
    ? Object.values(club.tactics.lineup).filter(id => {
      const p = state.players[id];
      return p && p.eigengewaechs;
    }).length
    : 0;

  const fanBonus = clamp(Math.round(anzahl * 1.4 + stammelf * 1.6), 0, EIGENGEWAECHS_FAN_MAX);

  let text;
  if (anzahl === 0) text = 'Kein einziger Eigengewächs-Spieler im Kader. Die Kurve erwähnt das regelmäßig.';
  else if (stammelf >= 3) text = `${stammelf} Eigengewächse in der Startelf — dafür verzeihen die Fans sogar eine Niederlage im Derby. Fast.`;
  else if (anzahl >= 3) text = `${anzahl} Jungs aus der eigenen Jugend im Kader. Das kommt auf den Rängen gut an und spart erhebliche Gehälter.`;
  else text = `${anzahl} Eigengewächs${anzahl === 1 ? '' : 'e'} im Profikader. Ein Anfang.`;

  const bonus = {
    anzahl, quote: round(quote, 3), inStammelf: stammelf,
    fanBonus, gehaltsErsparnis: Math.round(ersparnis), buchwert: Math.round(wert),
    spieler: eigen.map(p => ({ id: p.id, name: p.shortName, alter: p.age, ovr: playerOverall(p), wert: p.value })),
    text
  };
  const y = ensureYouth(state, club);
  y.eigengewaechs = { anzahl, quote: bonus.quote, fanBonus, inStammelf: stammelf };
  return bonus;
}

export function nachwuchsBericht(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return null;
  const y = ensureYouth(state, club);
  const liste = talente(state, clubId);
  const regionen = regionenVon(state, club).map(id => ({
    id, name: SCOUTING_REGIONEN[id].name, kostenJahr: SCOUTING_REGIONEN[id].kostenJahr, profil: SCOUTING_REGIONEN[id].profil
  }));
  const stufe = akademieStufeVon(y.akademie);
  const w = stabWirkung(state, clubId);

  const betriebJahr = Math.round(akademieBetriebJahr(club));
  const kostenJahr = betriebJahr + y.talente.length * KOSTEN_JE_TALENT +
    regionen.reduce((s, r) => s + r.kostenJahr, 0);

  const schwelle = profiSchwelle(club);
  const reif = liste.filter(t => t.profireif);
  const hoffnung = liste.filter(t => t.sterne >= 4);

  let bewertung;
  if (y.akademie >= 85 && w.jugend >= 70) bewertung = 'Eine Nachwuchsabteilung, die selbst tragen könnte. Hier wachsen Spieler heran, die andere Vereine kaufen müssten.';
  else if (y.akademie >= 65) bewertung = 'Gute Arbeit. Aus diesem Jahrgang schafft es normalerweise einer, manchmal zwei.';
  else if (y.akademie >= 45) bewertung = 'Durchschnitt. Wir bilden aus, aber die wirklich Guten gehen mit sechzehn woanders hin.';
  else bewertung = 'Der Nachwuchsbereich ist ein Zuschussgeschäft ohne Ertrag. So wird das nie etwas.';

  let empfehlung;
  if (y.ausbau) empfehlung = `Der Ausbau zu „${y.ausbau.name}“ läuft noch ${y.ausbau.restTage} Tage. Abwarten.`;
  else if (w.jugend < 50) empfehlung = 'Zuerst einen ordentlichen Jugendtrainer einstellen — ohne den nützt auch der schönste Rasen nichts.';
  else if (y.akademie < stufe.wert + 10 && stufe.stufe < 6) {
    const naechste = AKADEMIE_STUFEN.find(s => s.stufe === stufe.stufe + 1);
    empfehlung = `Nächster sinnvoller Schritt: „${naechste.name}“ für ${formatMoney(naechste.kosten)}.`;
  } else if (regionen.length < maxRegionen(state, clubId)) empfehlung = 'Wir könnten eine weitere Scouting-Region abdecken — der Stab gibt es her.';
  else if (reif.length) empfehlung = `${reif.map(t => t.shortName).join(', ')} ${reif.length === 1 ? 'ist' : 'sind'} profireif. Länger warten bringt nichts.`;
  else empfehlung = 'Weitermachen und Geduld haben. Nachwuchsarbeit zahlt sich frühestens in drei Jahren aus.';

  return {
    clubId,
    akademie: y.akademie,
    stufe: stufe.stufe,
    stufeName: stufe.name,
    ausbau: y.ausbau,
    talente: liste,
    anzahl: liste.length,
    schwelle,
    profireif: reif.map(t => t.shortName),
    hoffnungstraeger: hoffnung.map(t => `${t.shortName} (${t.sterne}★)`),
    regionen,
    maxRegionen: maxRegionen(state, clubId),
    kostenJahr,
    wirkungJugend: w.jugend,
    wirkungScouting: w.scouting,
    durchbrueche: y.durchbrueche,
    befoerdert: y.befoerdert,
    abgaenge: y.abgaenge,
    letztesTurnier: y.turnier,
    eigengewaechse: eigengewaechsBonus(state, clubId),
    bewertung,
    empfehlung
  };
}
