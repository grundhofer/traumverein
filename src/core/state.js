/**
 * VERBINDLICHES STATE-SCHEMA des Spiels.
 *
 * Alle Module (club/*, screens/*, engine/*) lesen und schreiben ausschließlich
 * die hier definierten Felder. Wer ein neues Feld braucht, legt es hier an –
 * nicht ad hoc irgendwo im Code.
 *
 *   state.clubs[clubId]      -> Verein inkl. aller Laufzeitdaten
 *   state.players[playerId]  -> Spieler inkl. Form/Moral/Fitness/Statistik
 *   state.staff[staffId]     -> Trainerstab
 *   state.fixtures           -> alle Spiele aller Wettbewerbe der Saison
 *   state.leagues[leagueId]  -> { id, clubIds } – wer in welcher Liga spielt
 *   state.inbox              -> Postfach des Managers
 */

import {
  SAVE_VERSION, DIFFICULTIES, MATCH_VIEW, SEASON_DAYS, START_YEAR,
  POSITIONS, ATTRIBUTES, TRAITS, NATION_NAMES, DEFAULT_COLORS
} from './constants.js';
import { createRng } from './rng.js';
import { clamp, deepClone, uid } from './util.js';

import { CLUBS, CLUBS_BY_ID } from '../data/clubs.js';
import { ALL_SQUAD_PLAYERS } from '../data/squads/index.js';
import { generateSquad, generateStaff, generateYouthProspect, generateFreeAgent, ovrForClub } from '../data/generator.js';
import { NATION_POOL_TRANSFER } from '../data/names.js';
import { LEAGUES, AMATEUR_CLUBS, EURO_CLUBS, CUP, generateFixtures, generateCupDraw, seasonCalendar } from '../data/leagues.js';
import { defaultTactics } from '../engine/tactics.js';
// club/europa.js importiert seinerseits weder core/state.js noch core/loop.js
// (wie der Rest von club/*, siehe club/finances.js:157) – der Aufruf unten bleibt
// deshalb zyklenfrei.
import { europaStart } from '../club/europa.js';

export const SAVE_PREFIX = 'traumverein.save.';
export const SAVE_INDEX = 'traumverein.saves';

/* ------------------------------------------------------------------ *
 *  Laufzeitfelder
 * ------------------------------------------------------------------ */

/** Ergänzt einen Datensatz aus data/ um alle Laufzeitfelder. */
export function initPlayerRuntime(player, rng) {
  const p = player;
  p.form = p.form !== undefined ? p.form : clamp(Math.round(rng.gauss(50, 12)), 20, 80);
  p.morale = p.morale !== undefined ? p.morale : clamp(Math.round(rng.gauss(68, 10)), 30, 95);
  p.fitness = 100;
  p.sharpness = clamp(Math.round(rng.gauss(58, 10)), 25, 85);
  p.injury = null;
  p.cards = { yellow: 0, red: 0, ban: 0, seasonYellow: 0 };
  p.happiness = {
    spielzeit: 60, gehalt: 60, ambition: 60, trainer: 60,
    beschwerden: []
  };
  p.personality = p.personality || pickPersonality(rng, p);
  p.training = { focus: null, gains: {}, intensitaet: 50, woche: 0 };
  p.stats = {
    season: emptyStatLine(),
    career: emptyStatLine(),
    history: []               // [{ season, clubId, ...statLine }]
  };
  p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
  p.joined = { season: 1, day: 0 };
  p.captain = false;
  return p;
}

export function emptyStatLine() {
  return {
    spiele: 0, startelf: 0, minuten: 0, tore: 0, vorlagen: 0, schuesse: 0,
    paraden: 0, gegentore: 0, zuNull: 0, zweikaempfe: 0, zweikaempfeGewonnen: 0,
    gelb: 0, gelbrot: 0, rot: 0, notenSumme: 0, notenAnzahl: 0, motm: 0
  };
}

const PERSONALITIES = [
  { id: 'ehrgeizig', name: 'Ehrgeizig', desc: 'Will spielen und gewinnen. Reagiert empfindlich auf die Bank.', moraleSwing: 1.2, loyalty: 0.7, ambition: 1.4 },
  { id: 'loyal', name: 'Vereinstreu', desc: 'Bleibt auch in schweren Zeiten.', moraleSwing: 0.8, loyalty: 1.5, ambition: 0.7 },
  { id: 'profi', name: 'Musterprofi', desc: 'Trainiert hart, hält den Mund.', moraleSwing: 0.7, loyalty: 1.1, ambition: 1.0 },
  { id: 'schwierig', name: 'Schwieriger Charakter', desc: 'Sorgt regelmäßig für Schlagzeilen.', moraleSwing: 1.6, loyalty: 0.6, ambition: 1.2 },
  { id: 'gelassen', name: 'Gelassen', desc: 'Nichts bringt ihn aus der Ruhe.', moraleSwing: 0.5, loyalty: 1.0, ambition: 0.8 },
  { id: 'fuehrungstyp', name: 'Führungstyp', desc: 'Nimmt die Mannschaft mit.', moraleSwing: 0.9, loyalty: 1.2, ambition: 1.1 },
  { id: 'geldgierig', name: 'Geschäftsmann', desc: 'Am Ende entscheidet das Gehalt.', moraleSwing: 1.1, loyalty: 0.4, ambition: 1.0 }
];

export function pickPersonality(rng, player) {
  let pool = PERSONALITIES;
  if (player && player.traits) {
    if (player.traits.includes('leader') || player.traits.includes('kabinenleader')) {
      pool = PERSONALITIES.filter(p => p.id === 'fuehrungstyp' || p.id === 'profi' || p.id === 'loyal');
    } else if (player.traits.includes('querulant') || player.traits.includes('mimose')) {
      pool = PERSONALITIES.filter(p => p.id === 'schwierig' || p.id === 'geldgierig');
    }
  }
  return deepClone(rng.pick(pool));
}

export { PERSONALITIES };

/** Ergänzt einen Verein aus data/clubs.js um alle Laufzeitfelder. */
export function initClubRuntime(club, rng, opts = {}) {
  const c = club;
  const rep = c.reputation || 50;

  c.playerIds = c.playerIds || [];
  c.staffIds = c.staffIds || [];
  c.tactics = c.tactics || null;         // wird nach Kaderaufbau gesetzt

  c.finances = Object.assign({
    balance: 0, debt: 0, ticketBase: 25,
    transferBudget: 0, wageBudget: 0,
    ledger: [],                          // [{ day, season, betrag, kategorie, text }]
    saison: emptyFinanceLine(),
    letzteSaison: null,
    kredite: []                          // [{ betrag, restschuld, zinsSatz, rateProWoche, laufzeitWochen }]
  }, c.finances || {});

  c.sponsors = c.sponsors || {
    trikot: null, aermel: null, ausruester: null, stadion: null, bande: [],
    angebote: [], boniErfuellt: []
  };

  c.board = c.board || {
    name: c.boardName || 'Der Vorstand',
    zufriedenheit: 60,
    geduld: 60,
    erwartung: expectationFor(rep),
    saisonziel: null,
    forderungen: [],
    warnungen: 0,
    vertrauen: 60
  };

  c.fans = Object.assign({
    members: 10000, ultras: 40, mood: 60, potential: 50,
    protest: 0, dauerkarten: 0, erwartung: 55
  }, c.fanbase || {}, c.fans || {});

  c.stadiumState = c.stadiumState || {
    ausbau: null,                        // { stufe, kostenGesamt, restTage, plaetzeNeu }
    preise: { sitz: c.finances.ticketBase, steh: Math.round(c.finances.ticketBase * 0.45), vip: Math.round(c.finances.ticketBase * 4.5), dauerkarte: Math.round(c.finances.ticketBase * 17) },
    catering: 50, parkplaetze: 50, sicherheit: 60, rasenZustand: c.stadium ? c.stadium.pitch : 80,
    letzteZuschauer: 0, auslastungSchnitt: 0
  };

  c.youth = c.youth || {
    akademie: c.facilities ? c.facilities.youth : 50,
    talente: [],                          // playerIds im Nachwuchs
    scoutingRegionen: ['Deutschland'],
    naechsteSichtung: 0,
    jahrgang: []
  };

  c.training = c.training || {
    wochenplan: null, intensitaet: 55, schwerpunkt: 'ausgeglichen',
    trainingslager: null, letzteBewertung: null
  };

  c.season = c.season || {
    form: [], tore: 0, gegentore: 0, punkte: 0, platz: 0,
    serie: 0, letzteErgebnisse: []
  };

  c.chemistryHistory = c.chemistryHistory !== undefined ? c.chemistryHistory : 30;
  c.moral = c.moral !== undefined ? c.moral : 62;
  c.manager = c.manager || null;          // KI-Trainername oder null (= Spieler)
  c.transferliste = c.transferliste || [];
  c.beobachtet = c.beobachtet || [];      // gescoutete Spieler
  c.gerüchte = c.gerüchte || [];

  return c;
}

export function emptyFinanceLine() {
  return {
    einnahmenZuschauer: 0, einnahmenTv: 0, einnahmenSponsoren: 0, einnahmenTransfer: 0,
    einnahmenMerch: 0, einnahmenPraemien: 0, einnahmenSonstige: 0,
    ausgabenGehaelter: 0, ausgabenTransfer: 0, ausgabenStadion: 0, ausgabenStab: 0,
    ausgabenJugend: 0, ausgabenBetrieb: 0, ausgabenZinsen: 0, ausgabenSonstige: 0
  };
}

const AMATEUR_FARBEN = [
  ['#1c4f8f', '#ffffff'], ['#c1272d', '#ffffff'], ['#2f7d32', '#ffffff'], ['#f0c020', '#1a1a1a'],
  ['#1a1a1a', '#ffffff'], ['#6b2d8f', '#ffffff'], ['#0e7a7a', '#ffffff'], ['#d95a00', '#1a1a1a']
];

/** Baut aus einem Amateur-Stammdatensatz einen vollwertigen, aber leichten Verein. */
export function amateurClub(raw, rng) {
  const i = Math.abs(raw.id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % AMATEUR_FARBEN.length;
  const [primary, secondary] = AMATEUR_FARBEN[i];
  const kapazitaet = 3000 + (Math.abs(raw.reputation || 40) * 220);
  return {
    id: raw.id,
    name: raw.name,
    shortName: raw.short || raw.name,
    abbr: raw.abbr || raw.name.slice(0, 3).toUpperCase(),
    city: raw.city || raw.short || raw.name,
    founded: 1910,
    colors: { primary, secondary, accent: secondary },
    kit: { pattern: 'plain', shorts: secondary, socks: primary },
    awayKit: { primary: secondary, secondary: primary, pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: primary, fg: secondary },
    stadium: {
      name: `Stadion am Sportpark (${raw.short || raw.name})`,
      capacity: kapazitaet, standing: 0.6, roof: false, floodlight: 2, pitch: 62, tiers: 1
    },
    reputation: raw.reputation || 38,
    finances: { balance: 400000, debt: 0, ticketBase: 12 },
    fanbase: { members: 1200, ultras: 20, mood: 62, potential: 30 },
    facilities: { training: 35, medical: 30, youth: 40, scouting: 25 },
    boardName: 'Der Vereinsvorstand',
    leagueId: 'amateur',
    istAmateur: true,
    lazySquad: true,
    history: { titles: 0, lastTitle: null, honours: ['Regionaler Traditionsverein'] }
  };
}

/* ------------------------------------------------------------------ *
 *  Europäische Vereine
 * ------------------------------------------------------------------ */

/**
 * Landestypische Farbwelten, Trikotmuster, Wappenformen und Stadionnamen.
 *
 * Zweck: Wer die Auslosung aufschlägt, soll auf einen Blick sehen, dass da
 * kein deutscher Verein steht – und trotzdem soll es hübsch aussehen. Die
 * Farben sind Landesfarben, nicht Vereinsfarben; welcher Verein welche
 * Kombination bekommt, entscheidet ein Hash über die Vereins-ID (stabil über
 * alle Spielstände hinweg, ohne dass wir 66 Paletten von Hand pflegen).
 *
 *   nat: Nationalität, aus der sich der Kader überwiegend speist. `null`,
 *        wenn data/names.js für das Land keine Namen kennt (dann bleibt es
 *        beim internationalen Standardtopf) – SCO wird auf EN abgebildet,
 *        weil beides denselben Namensvorrat trifft.
 */
const EURO_LAENDER = {
  ES: { land: 'Spanien', nat: 'ES', form: 'shield', muster: ['stripes', 'plain', 'halves'],
    motive: ['bull', 'lion', 'letters'],
    farben: [['#c8102e', '#ffffff'], ['#00429b', '#ffffff'], ['#ffffff', '#c8102e'], ['#8a1538', '#f2c14e']],
    stadion: s => `Estadio ${s}` },
  EN: { land: 'England', nat: 'EN', form: 'round', muster: ['plain', 'stripes', 'chest'],
    motive: ['lion', 'ball', 'letters'],
    farben: [['#c8102e', '#ffffff'], ['#0b2c6b', '#ffffff'], ['#ffffff', '#c8102e'], ['#6a1b3d', '#89ccff']],
    stadion: s => `${s} Park` },
  FR: { land: 'Frankreich', nat: 'FR', form: 'round', muster: ['plain', 'chest', 'sash'],
    motive: ['ball', 'star', 'letters'],
    farben: [['#00308f', '#ffffff'], ['#ffffff', '#00308f'], ['#0d2b52', '#e63946'], ['#1b7a4a', '#ffffff']],
    stadion: s => `Stade ${s}` },
  IT: { land: 'Italien', nat: 'IT', form: 'shield', muster: ['stripes', 'plain', 'halves'],
    motive: ['eagle', 'wheel', 'letters'],
    farben: [['#0b3d91', '#ffffff'], ['#1a1a1a', '#c8102e'], ['#7ec8e3', '#0b2c4d'], ['#0e6b3d', '#ffffff']],
    stadion: s => `Stadio ${s}` },
  NL: { land: 'Niederlande', nat: 'NL', form: 'diamond', muster: ['plain', 'halves', 'chest'],
    motive: ['lion', 'star', 'letters'],
    farben: [['#e8600d', '#ffffff'], ['#c8102e', '#ffffff'], ['#ffffff', '#e8600d'], ['#0b3d91', '#f0c020']],
    stadion: s => `${s} Arena` },
  PT: { land: 'Portugal', nat: 'PT', form: 'round', muster: ['plain', 'halves', 'hoops'],
    motive: ['eagle', 'ball', 'letters'],
    farben: [['#046a38', '#ffffff'], ['#c8102e', '#ffffff'], ['#ffffff', '#046a38'], ['#0b3d91', '#f2c14e']],
    stadion: s => `Estádio ${s}` },
  TR: { land: 'Türkei', nat: 'TR', form: 'round', muster: ['halves', 'stripes', 'plain'],
    motive: ['star', 'eagle', 'letters'],
    farben: [['#c8102e', '#f2c14e'], ['#1a1a1a', '#f2c14e'], ['#0b3d91', '#f5f5f5'], ['#c8102e', '#ffffff']],
    stadion: s => `${s} Stadyumu` },
  AT: { land: 'Österreich', nat: 'AT', form: 'shield', muster: ['plain', 'stripes', 'chest'],
    motive: ['eagle', 'ball', 'letters'],
    farben: [['#c8102e', '#ffffff'], ['#1b7a4a', '#ffffff'], ['#ffffff', '#c8102e'], ['#4a1f6b', '#ffffff']],
    stadion: s => `${s}-Stadion` },
  CH: { land: 'Schweiz', nat: 'CH', form: 'shield', muster: ['plain', 'halves', 'chest'],
    motive: ['star', 'ball', 'letters'],
    farben: [['#d52b1e', '#ffffff'], ['#f2c14e', '#0b2c4d'], ['#ffffff', '#d52b1e'], ['#0b3d91', '#ffffff']],
    stadion: s => `${s}-Stadion` },
  SCO: { land: 'Schottland', nat: 'EN', form: 'classic', muster: ['hoops', 'plain', 'stripes'],
    motive: ['lion', 'star', 'letters'],
    farben: [['#0b6b3a', '#ffffff'], ['#0b3d91', '#ffffff'], ['#1a1a1a', '#f2c14e'], ['#5c2d91', '#ffffff']],
    stadion: s => `${s} Park` },
  BE: { land: 'Belgien', nat: 'BE', form: 'round', muster: ['stripes', 'plain', 'chest'],
    motive: ['lion', 'ball', 'letters'],
    farben: [['#1a1a1a', '#f2c14e'], ['#5a1a6b', '#ffffff'], ['#0b6b3a', '#ffffff'], ['#c8102e', '#1a1a1a']],
    stadion: s => `${s} Stadion` },
  RS: { land: 'Serbien', nat: 'RS', form: 'shield', muster: ['stripes', 'plain', 'sash'],
    motive: ['eagle', 'star', 'letters'],
    farben: [['#c6363c', '#ffffff'], ['#0c4076', '#ffffff'], ['#ffffff', '#c6363c'], ['#1a1a1a', '#c6363c']],
    stadion: s => `Stadion ${s}` },
  HR: { land: 'Kroatien', nat: 'HR', form: 'shield', muster: ['plain', 'stripes', 'chest'],
    motive: ['star', 'ball', 'letters'],
    farben: [['#0b3d91', '#ffffff'], ['#c8102e', '#ffffff'], ['#ffffff', '#0b3d91'], ['#171796', '#f2c14e']],
    stadion: s => `Stadion ${s}` },
  CZ: { land: 'Tschechien', nat: 'CZ', form: 'shield', muster: ['plain', 'halves', 'stripes'],
    motive: ['lion', 'star', 'letters'],
    farben: [['#c8102e', '#ffffff'], ['#11457e', '#ffffff'], ['#7d1128', '#f2c14e'], ['#ffffff', '#11457e']],
    stadion: s => `Stadion ${s}` },
  UA: { land: 'Ukraine', nat: 'UA', form: 'round', muster: ['stripes', 'plain', 'chest'],
    motive: ['wheel', 'star', 'letters'],
    farben: [['#005bbb', '#ffd500'], ['#ffd500', '#005bbb'], ['#1a1a1a', '#ffd500'], ['#c8102e', '#ffffff']],
    stadion: s => `Stadion ${s}` },
  GR: { land: 'Griechenland', nat: 'GR', form: 'round', muster: ['stripes', 'plain', 'hoops'],
    motive: ['anchor', 'star', 'letters'],
    farben: [['#c8102e', '#ffffff'], ['#0d5eaf', '#ffffff'], ['#0b6b3a', '#ffffff'], ['#ffffff', '#0d5eaf']],
    stadion: s => `Stadio ${s}` },
  DK: { land: 'Dänemark', nat: 'DK', form: 'round', muster: ['plain', 'halves', 'chest'],
    motive: ['star', 'ball', 'letters'],
    farben: [['#c60c30', '#ffffff'], ['#0b3d91', '#f2c14e'], ['#ffffff', '#c60c30'], ['#f2c14e', '#0b2c4d']],
    stadion: s => `${s} Stadion` },
  SE: { land: 'Schweden', nat: 'SE', form: 'round', muster: ['plain', 'chest', 'halves'],
    motive: ['star', 'ball', 'letters'],
    farben: [['#0b5ea8', '#ffd500'], ['#ffd500', '#0b5ea8'], ['#1a6b4a', '#ffffff'], ['#c8102e', '#ffffff']],
    stadion: s => `${s} Stadion` },
  NO: { land: 'Norwegen', nat: 'NO', form: 'round', muster: ['plain', 'halves', 'chest'],
    motive: ['anchor', 'star', 'letters'],
    farben: [['#f2c14e', '#0b2c4d'], ['#ba0c2f', '#ffffff'], ['#00205b', '#ffffff'], ['#ffffff', '#ba0c2f']],
    stadion: s => `${s} Stadion` },
  PL: { land: 'Polen', nat: 'PL', form: 'shield', muster: ['plain', 'stripes', 'sash'],
    motive: ['eagle', 'star', 'letters'],
    farben: [['#dc143c', '#ffffff'], ['#ffffff', '#dc143c'], ['#0b6b3a', '#ffffff'], ['#1a1a1a', '#dc143c']],
    stadion: s => `Stadion ${s}` },
  HU: { land: 'Ungarn', nat: 'HU', form: 'shield', muster: ['stripes', 'plain', 'chest'],
    motive: ['eagle', 'star', 'letters'],
    farben: [['#0b6b3a', '#ffffff'], ['#ce2939', '#ffffff'], ['#ffffff', '#0b6b3a'], ['#1a4a8f', '#ffffff']],
    stadion: s => `Stadion ${s}` },
  SK: { land: 'Slowakei', nat: 'SK', form: 'shield', muster: ['plain', 'stripes', 'chest'],
    motive: ['eagle', 'star', 'letters'],
    farben: [['#0b4ea2', '#ffffff'], ['#ee1c25', '#ffffff'], ['#ffffff', '#0b4ea2'], ['#1a1a1a', '#0b4ea2']],
    stadion: s => `Stadion ${s}` },
  IL: { land: 'Israel', nat: null, form: 'round', muster: ['plain', 'chest', 'halves'],
    motive: ['star', 'ball', 'letters'],
    farben: [['#0038b8', '#ffffff'], ['#ffffff', '#0038b8'], ['#f2c14e', '#0038b8'], ['#1a6b4a', '#ffffff']],
    stadion: s => `${s}-Stadion` }
};

/** Rückfallebene, falls data/leagues.js ein Land nachträgt, das hier noch fehlt. */
const EURO_LAND_STANDARD = {
  land: 'Europa', nat: null, form: 'round', muster: ['plain', 'stripes', 'chest'],
  motive: ['star', 'ball', 'letters'],
  farben: [['#1c4f8f', '#ffffff'], ['#c1272d', '#ffffff'], ['#2f7d32', '#ffffff'], ['#1a1a1a', '#f0c020']],
  stadion: s => `Stadion ${s}`
};

export function euroLand(country) {
  return EURO_LAENDER[country] || EURO_LAND_STANDARD;
}

function idHash(id) {
  return Math.abs(String(id).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
}

/**
 * Baut aus einem EURO_CLUBS-Eintrag einen vollwertigen, aber leichten Verein.
 *
 * Wie amateurClub(): keine Spieler, kein Stab, kein Nachwuchs. `lazySquad`
 * sorgt dafür, dass der Kader erst beim ersten Spiel gegen den Verein entsteht
 * (ensureSquad). 66 volle Kader wären rund 1.500 Spielerdatensätze und damit
 * mehrere Megabyte Spielstand für Gegner, die man nie zu Gesicht bekommt.
 *
 * Alles Sichtbare leitet sich aus `reputation` und `country` ab – siehe
 * EURO_LAENDER. `leagueId` ist 'europa' und steht bewusst in KEINER Ligaliste:
 * state.leagues kennt nur bl1 und bl2, sonst tauchten Real Madrid und Ajax in
 * der Bundesligatabelle auf.
 */
export function euroClub(raw, rng) {
  const L = euroLand(raw.country);
  const rep = clamp(raw.reputation === undefined ? 60 : raw.reputation, 30, 100);
  const h = idHash(raw.id);
  const short = raw.short || raw.name;

  const [primary, secondary] = L.farben[h % L.farben.length];
  const pattern = L.muster[(h >> 3) % L.muster.length];
  const motif = L.motive[(h >> 6) % L.motive.length];
  // Gold ab Weltklasse, Silber fürs gehobene Mittelfeld – der billigste Trick,
  // um Ruf sichtbar zu machen, und der 1996 schon funktioniert hat.
  const accent = rep >= 88 ? '#e8c65a' : rep >= 74 ? '#d5dae0' : secondary;

  const kapazitaet = clamp(
    Math.round((16000 + (rep - 55) * 1300 + rng.int(-1500, 1500)) / 500) * 500,
    11000, 85000);

  const titel = Math.max(0, Math.round((rep - 52) / 3.2));

  return {
    id: raw.id,
    name: raw.name,
    shortName: short,
    abbr: raw.abbr || raw.name.slice(0, 3).toUpperCase(),
    city: short,
    country: raw.country,
    founded: rng.int(1889, 1926),
    colors: { primary, secondary, accent },
    kit: { pattern, shorts: pattern === 'plain' ? secondary : primary, socks: primary },
    awayKit: { primary: secondary, secondary: primary, pattern: pattern === 'plain' ? 'plain' : 'chest' },
    crest: { shape: rep >= 88 ? 'classic' : L.form, motif, bg: primary, fg: secondary },
    stadium: {
      name: L.stadion(short),
      capacity: kapazitaet,
      standing: rep >= 70 ? 0.05 : 0.2,
      roof: rep >= 70,
      floodlight: rep >= 85 ? 5 : rep >= 70 ? 4 : 3,
      pitch: clamp(Math.round(rep * 0.85 + 15), 62, 95),
      tiers: rep >= 88 ? 3 : rep >= 68 ? 2 : 1
    },
    reputation: rep,
    finances: {
      balance: Math.round((rep - 48) * 1600000),
      debt: 0,
      ticketBase: clamp(Math.round(16 + (rep - 55) * 0.55), 12, 45)
    },
    fanbase: {
      members: Math.max(3000, Math.round(6000 + (rep - 50) * 2600)),
      ultras: clamp(Math.round((6000 + (rep - 50) * 2600) / 850), 15, 400),
      mood: 66,
      potential: clamp(rep, 35, 96)
    },
    facilities: {
      training: clamp(rep - 3, 30, 96),
      medical: clamp(rep - 6, 28, 94),
      youth: clamp(rep - 9, 25, 92),
      scouting: clamp(rep - 8, 25, 92)
    },
    boardName: 'Die Vereinsführung',
    leagueId: 'europa',
    istEuropaeisch: true,
    lazySquad: true,
    history: {
      titles: titel,
      lastTitle: null,
      honours: [titel > 0 ? `${titel}× Meister von ${L.land}` : `Erstligist in ${L.land}`]
    }
  };
}

function expectationFor(rep) {
  if (rep >= 90) return { text: 'Meisterschaft und Titel', platz: 1, minPlatz: 3 };
  if (rep >= 82) return { text: 'Champions-League-Qualifikation', platz: 3, minPlatz: 6 };
  if (rep >= 74) return { text: 'Internationales Geschäft', platz: 6, minPlatz: 10 };
  if (rep >= 64) return { text: 'Gesichertes Mittelfeld', platz: 10, minPlatz: 14 };
  if (rep >= 54) return { text: 'Klassenerhalt ohne Zittern', platz: 13, minPlatz: 15 };
  return { text: 'Klassenerhalt', platz: 15, minPlatz: 16 };
}

/* ------------------------------------------------------------------ *
 *  Neues Spiel
 * ------------------------------------------------------------------ */

export function createNewGame(opts = {}) {
  const seed = opts.seed !== undefined ? opts.seed : Math.floor(Math.abs(hashSeedFromString(opts.managerName || 'traumverein')) % 1e9);
  const rng = createRng(seed);
  const difficulty = DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'profi';

  const state = {
    version: SAVE_VERSION,
    seed,
    rngState: null,
    difficulty,
    settings: Object.assign({
      matchView: MATCH_VIEW.HIGHLIGHTS,
      interactive: true,
      minigames: { elfmeter: true, freistoss: true, ecke: true, abschluss: true, kombination: true },
      speed: 2,
      autoAufstellung: false,
      textTempo: 'normal',
      animationen: true,
      bestaetigungen: true
    }, opts.settings || {}),
    date: { season: 1, day: 0, startYear: START_YEAR },
    managerClubId: opts.clubId,
    manager: {
      name: opts.managerName || 'Neuer Trainer',
      age: opts.managerAge || 42,
      nationality: 'DE',
      reputation: 40,
      lizenz: 'A-Lizenz',
      skills: { training: 45, taktik: 45, motivation: 45, verhandlung: 45, jugend: 45, medien: 45 },
      erfahrung: 0, level: 1,
      bilanz: { spiele: 0, siege: 0, unentschieden: 0, niederlagen: 0, tore: 0, gegentore: 0 },
      karriere: [],
      titel: [],
      appearance: opts.appearance || null
    },
    clubs: {},
    players: {},
    staff: {},
    fixtures: [],
    tables: {},
    // Ligazugehörigkeit. Ab Spielstandversion 2 steht hier die Wahrheit –
    // LEAGUES aus data/leagues.js ist nur noch die Vorlage für die erste Saison
    // sowie die Quelle für Prämien, Termine und Regeln (siehe ROADMAP 5.1).
    leagues: {},
    inbox: [],
    news: [],
    freeAgents: [],
    kalender: {},
    pokal: { runde: 0, paarungen: [], ausgeschieden: [] },
    europa: { teilnehmer: [], runde: 0, paarungen: [] },
    history: { seasons: [], transfers: [], titel: {} },
    flags: { erstesSpielGespielt: false, tutorialGesehen: false },
    tick: 0
  };

  // --- Vereine ---
  for (const raw of CLUBS) {
    const club = deepClone(raw);
    initClubRuntime(club, rng);
    state.clubs[club.id] = club;
  }

  // Pokal-Amateurvereine: nur als Kulisse für die ersten Runden. Ihre Kader entstehen
  // erst, wenn wirklich gegen sie gespielt wird (siehe loop.js buildMatchTeam) – das
  // hält den Spielstand klein und den Spielstart schnell.
  for (const raw of AMATEUR_CLUBS) {
    const club = amateurClub(raw, rng);
    initClubRuntime(club, rng);
    state.clubs[club.id] = club;
  }

  // Europapokal-Gegner: dieselbe Bauart wie die Amateure, nur teurer angezogen.
  // Sie stehen in state.clubs, damit Auslosung, Spielplan und Spieltag ganz
  // normal mit ihnen arbeiten können – aber in keiner Ligaliste und ohne Kader.
  for (const raw of EURO_CLUBS) {
    const club = euroClub(raw, rng);
    initClubRuntime(club, rng);
    state.clubs[club.id] = club;
  }

  // --- Ligazugehörigkeit in den Spielstand übernehmen ---
  // Von hier an wird sie nur noch über state.leagues fortgeschrieben
  // (core/loop.js:saisonWechsel). club.leagueId läuft als Kopie mit, damit die
  // zehn Aufrufer von leagueOfClub() weiterhin das Richtige lesen.
  for (const league of Object.values(LEAGUES)) {
    state.leagues[league.id] = { id: league.id, clubIds: league.clubIds.slice() };
    for (const clubId of league.clubIds) {
      const club = state.clubs[clubId];
      if (!club) throw new Error(`[state] Liga ${league.id} nennt den unbekannten Verein "${clubId}"`);
      club.leagueId = league.id;
    }
  }

  // --- Handgepflegte Kader (Legenden + aktuelle Spieler) ---
  // Seit Roadmap-Stufe 5 sind das beide Profiligen: 36 Vereine, 864 Spieler.
  for (const raw of ALL_SQUAD_PLAYERS) {
    const p = deepClone(raw);
    initPlayerRuntime(p, rng);
    state.players[p.id] = p;
    const club = state.clubs[p.clubId];
    if (!club) throw new Error(`[state] Spieler ${p.id} verweist auf unbekannten Verein "${p.clubId}"`);
    club.playerIds.push(p.id);
  }

  // --- Auffangnetz: prozedurale Kader für Vereine ohne handgepflegte Daten ---
  // Greift seit Stufe 5 für keinen Verein der beiden Profiligen mehr, nur noch
  // für neu hinzugekommene Vereine ohne Kaderdatei (z. B. Amateurvereine).
  for (const club of Object.values(state.clubs)) {
    if (club.playerIds.length > 0 || club.lazySquad) continue;
    const squad = generateSquad(rng.fork('squad:' + club.id), club, { size: 24, avgOvr: ovrForClub(club) });
    for (const p of squad) {
      initPlayerRuntime(p, rng);
      state.players[p.id] = p;
      club.playerIds.push(p.id);
    }
  }

  // --- Trainerstab, Nachwuchs, Taktik ---
  for (const club of Object.values(state.clubs)) {
    if (club.lazySquad) continue;
    const q = clamp(Math.round((club.reputation || 50) * 0.9 + rng.gauss(0, 8)), 20, 95);
    for (const role of ['cotrainer', 'torwarttrainer', 'athletik', 'arzt', 'physio', 'scout', 'jugendtrainer']) {
      const s = generateStaff(rng.fork('staff:' + club.id + role), role, q);
      state.staff[s.id] = s;
      s.clubId = club.id;
      club.staffIds.push(s.id);
    }
    for (let i = 0; i < 6; i++) {
      const t = generateYouthProspect(rng.fork('youth:' + club.id + i), club, {});
      initPlayerRuntime(t, rng);
      t.jugend = true;
      state.players[t.id] = t;
      club.youth.talente.push(t.id);
    }
    const squadPlayers = club.playerIds.map(id => state.players[id]);
    club.tactics = defaultTactics(club, squadPlayers);
    club.board.saisonziel = club.board.erwartung;
    // Budgets
    const rep = club.reputation || 50;
    const diff = DIFFICULTIES[difficulty];
    club.finances.transferBudget = Math.round(club.finances.balance * 0.55 * diff.moneyFactor);
    club.finances.wageBudget = Math.round(squadPlayers.reduce((s, p) => s + p.contract.salary, 0) * 1.18);
    club.fans.dauerkarten = Math.round((club.stadium.capacity || 20000) * (0.35 + rep / 300));
  }

  // --- Vertragslose Spieler ---
  for (let i = 0; i < 45; i++) {
    const p = generateFreeAgent(rng.fork('frei:' + i), {});
    initPlayerRuntime(p, rng);
    p.clubId = null;
    state.players[p.id] = p;
    state.freeAgents.push(p.id);
  }

  // --- Spielpläne ---
  for (const league of Object.values(state.leagues)) {
    const fx = generateFixtures(league.clubIds, { rng: rng.fork('fixtures:' + league.id), competitionId: league.id, season: 1 });
    state.fixtures.push(...fx);
    state.tables[league.id] = [];
  }
  // Pokal: Runden sind 0-basiert (CUP.rounds[0] = 1. Runde).
  // Europäische Vereine bleiben draußen – der DFB-Pokal hat 64 Teilnehmer, und
  // Real Madrid in Runde eins wäre zwar unterhaltsam, aber falsch.
  const cup = generateCupDraw(rng.fork('pokal'), pokalfeld(state), 0, null, 1);
  state.fixtures.push(...cup);

  // Europapokal: In der ersten Saison gibt es keine Vorsaison, aus der sich
  // Startplätze ableiten ließen – club/europa.js vergibt sie dann nach dem Ruf.
  // Ohne diesen Aufruf liefe der Europapokal erst ab Saison 2 (ROADMAP Stufe 3).
  europaStart(state);

  state.kalender = seasonCalendar(1, state.fixtures);
  state.rngState = rng.state();

  // --- Startpost ---
  const myClub = state.clubs[state.managerClubId];
  pushMessage(state, {
    kind: 'vorstand',
    from: myClub.board.name,
    subject: 'Herzlich willkommen!',
    body: `Willkommen bei ${myClub.name}, ${state.manager.name}!\n\n` +
      `Der Aufsichtsrat hat sich einstimmig für Sie entschieden. Unser Saisonziel lautet: ` +
      `${myClub.board.erwartung.text}. Für Transfers stehen Ihnen zunächst ` +
      `${(club_money(myClub.finances.transferBudget))} zur Verfügung.\n\n` +
      `Enttäuschen Sie uns nicht. Wir schauen genau hin.`,
    wichtig: true
  });

  return state;
}

function club_money(v) {
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + ' Mio €';
  return Math.round(v / 1000) + ' Tsd €';
}

function hashSeedFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

/* ------------------------------------------------------------------ *
 *  Postfach
 * ------------------------------------------------------------------ */

export function pushMessage(state, msg) {
  const m = Object.assign({
    id: uid('msg'),
    day: state.date.day,
    season: state.date.season,
    kind: 'info',
    from: 'Geschäftsstelle',
    subject: '',
    body: '',
    gelesen: false,
    wichtig: false,
    aktionen: null
  }, msg);
  state.inbox.unshift(m);
  if (state.inbox.length > 300) state.inbox.length = 300;
  return m;
}

export function pushNews(state, text, kind = 'info', extra = {}) {
  state.news.unshift(Object.assign({
    id: uid('news'), day: state.date.day, season: state.date.season, text, kind
  }, extra));
  if (state.news.length > 200) state.news.length = 200;
}

export function unreadCount(state) {
  return state.inbox.filter(m => !m.gelesen).length;
}

/* ------------------------------------------------------------------ *
 *  Zugriffs-Helfer
 * ------------------------------------------------------------------ */

/**
 * Das Teilnehmerfeld des DFB-Pokals: alle Vereine des Spielstands OHNE die
 * europäischen Gegner. Wer `generateCupDraw()` mit `Object.values(state.clubs)`
 * füttert, lost sonst ab Stufe 3 Real Madrid in die erste Hauptrunde – der
 * Losbeutel kennt keinen Unterschied, wir müssen ihn machen.
 */
export function pokalfeld(state) {
  return Object.values(state.clubs).filter(c => c && !c.istEuropaeisch);
}

/**
 * Erzeugt den Kader eines Amateur- oder Europapokalvereins erst dann, wenn
 * wirklich gegen ihn gespielt wird. Spart im Spielstand rund 900 (Amateure)
 * bzw. bis zu 1.500 (Europa) Datensätze.
 *
 * Kadergröße, Stärke und Stabsqualität hängen an `club.reputation`: Real
 * Madrid (98) bekommt 24 Mann auf Weltklasseniveau, ein zyprischer Meister
 * (55) achtzehn Mann Kreisklasse plus.
 */
export function ensureSquad(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) throw new Error(`[state] Unbekannter Verein: ${clubId}`);
  if (club.playerIds.length > 0) return club;

  const rep = clamp(club.reputation === undefined ? 40 : club.reputation, 1, 100);
  const europa = club.istEuropaeisch === true;
  const rng = createRng(`${state.seed}:lazysquad:${clubId}`);

  const size = europa ? clamp(Math.round(18 + (rep - 55) / 7), 18, 24) : 18;
  const opts = { size, avgOvr: ovrForClub(club) };
  if (europa) {
    // Der Kader soll nach dem Land klingen, in dem er spielt. Kennt data/names.js
    // das Land nicht (Israel), bleibt es beim internationalen Topf – NICHT beim
    // Standard von generateSquad, der auf den Jugendtopf zurückfällt und einem
    // Verein aus Tel Aviv elf Deutsche in die Startelf stellt.
    const nat = euroLand(club.country).nat;
    const summe = NATION_POOL_TRANSFER.reduce((s, e) => s + (e.weight || 0), 0);
    opts.nationPool = nat
      ? [{ nat, weight: Math.round(summe * 1.2) }, ...NATION_POOL_TRANSFER]
      : NATION_POOL_TRANSFER;
  }

  const squad = generateSquad(rng, club, opts);
  for (const p of squad) {
    initPlayerRuntime(p, rng);
    state.players[p.id] = p;
    club.playerIds.push(p.id);
  }
  const stabQualitaet = europa ? clamp(Math.round(rep * 0.88), 30, 92) : 35;
  for (const role of ['cotrainer', 'arzt', 'physio']) {
    const s = generateStaff(rng.fork('staff:' + clubId + role), role, stabQualitaet);
    s.clubId = clubId;
    state.staff[s.id] = s;
    club.staffIds.push(s.id);
  }
  club.tactics = defaultTactics(club, squad);
  club.lazySquad = false;
  return club;
}

/**
 * Ligazugehörigkeit eines Vereins ('bl1' | 'bl2' | 'amateur' | null).
 *
 * DIE eine Quelle: state.leagues. club.leagueId ist nur die mitgeführte Kopie
 * und darf sich nie widersprechen – wer beides pflegt, pflegt irgendwann zwei
 * Wahrheiten, und die zweite ist unsichtbar falsch (ROADMAP 5.1).
 */
export function ligaVonVerein(state, clubId) {
  const ligen = state && state.leagues;
  if (ligen) {
    for (const id in ligen) {
      const e = ligen[id];
      if (e && Array.isArray(e.clubIds) && e.clubIds.indexOf(clubId) >= 0) return id;
    }
  }
  const club = state && state.clubs ? state.clubs[clubId] : null;
  return club ? (club.leagueId || null) : null;
}

export const myClub = (state) => state.clubs[state.managerClubId];
export const squadOf = (state, clubId) => state.clubs[clubId].playerIds.map(id => state.players[id]);
export const staffOf = (state, clubId) => state.clubs[clubId].staffIds.map(id => state.staff[id]).filter(Boolean);
export const youthOf = (state, clubId) => state.clubs[clubId].youth.talente.map(id => state.players[id]).filter(Boolean);
export const difficultyOf = (state) => DIFFICULTIES[state.difficulty] || DIFFICULTIES.profi;

export function fixturesOfDay(state, day, season = state.date.season) {
  return state.fixtures.filter(f => f.dayIndex === day && f.season === season && !f.played);
}

export function nextFixtureFor(state, clubId) {
  return state.fixtures
    .filter(f => !f.played && (f.homeId === clubId || f.awayId === clubId) && f.dayIndex >= state.date.day)
    .sort((a, b) => a.dayIndex - b.dayIndex)[0] || null;
}

export function lastFixturesFor(state, clubId, n = 5) {
  return state.fixtures
    .filter(f => f.played && (f.homeId === clubId || f.awayId === clubId))
    .sort((a, b) => b.dayIndex - a.dayIndex)
    .slice(0, n);
}

export function isMatchday(state) {
  return fixturesOfDay(state, state.date.day).some(
    f => f.homeId === state.managerClubId || f.awayId === state.managerClubId
  );
}

export function stateRng(state, label = '') {
  const rng = createRng(state.seed);
  if (state.rngState) rng.setState(state.rngState);
  const forked = label ? rng.fork(label + ':' + state.tick) : rng;
  state.rngState = rng.state();
  return forked;
}

/* ══════════════════════════════════════════════════════════════════════════ *
 *  DIE SPIELSTANDBREMSE
 *
 *  Gemessen ohne sie (Seed 7, HSV, Profi): 9,51 MB nach einer Spielzeit,
 *  13,05 MB nach dreien, 20,56 MB nach achten – rund anderthalb Megabyte je
 *  Jahr, und nichts wird je einen Datensatz los. Die Prüfschwelle von 25 MB
 *  fällt damit in Spielzeit elf, nicht in Spielzeit acht wie in ROADMAP 8.1
 *  geschätzt; gesehen hat es trotzdem nie jemand, weil nie jemand so lange
 *  gespielt hat.
 *
 *  Die Bremse läuft beim SAISONWECHSEL, nicht beim Speichern: Was sie kürzt,
 *  ist damit aus dem Spielstand verschwunden und nicht nur aus der Datei –
 *  serialize() weiter unten kürzt zusätzlich, aber nur für die Ablage.
 *  Aufrufstelle: core/loop.js:saisonWechsel(), Abschnitt l – ganz am Ende,
 *  nachdem der Kalender umgesprungen ist. Wer diese Zeile dort nicht findet,
 *  hat eine Bremse, die niemand zieht: Bis zur Schlussabnahme war genau das der
 *  Fall, acht Prüfzeilen grün und im Spiel wirkungslos, weil jeder Prüfstand
 *  verdichteVergangenheit() selbst aufgerufen hat. Dagegen steht heute Z11 in
 *  tools/test-spielstand.js.
 *
 *  GRUNDSATZ: Verdichtet wird ausschließlich VERGANGENHEIT. Was ein Bildschirm
 *  noch zeigt, bleibt vollständig. Der strengste Prüfer ist die Ruhmeshalle in
 *  screens/chronik.js – sie führt jeden zurückgetretenen Spieler mit Zahlen,
 *  Portrait und Abschiedstext auf. Nach der Bremse muss sie dasselbe zeigen wie
 *  davor; tools/test-spielstand.js rechnet das beidseitig nach.
 *
 *  NICHT angefasst, obwohl es verlockend aussieht – jedes davon würde eine
 *  Zahl in der Chronik verschieben:
 *    • player.stats.history  – chronik.js:juengsterDebuetant liest den ERSTEN
 *      Eintrag als Debütsaison und lässt Spieler mit voller Liste (12) bewusst
 *      draußen. Wer hier kappt, erfindet Debüts.
 *    • state.history.transfers – der Rekord „Teuerster Transfer" liest sie alle.
 *    • state.history.seasons / .titel / .rekorde – das Archiv selbst.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Alle Grenzen der Bremse an einer Stelle. */
export const VERDICHTUNG = {
  postfach: 150,            // Nachrichten insgesamt (Abschiedsbriefe zählen nicht mit)
  meldungen: 80,            // state.news
  ledgerEigen: 400,         // Kassenbuchzeilen eigener Verein
  ledgerKi: 25,             //                  KI-Verein
  einsaetze: 3,             // medizin.einsaetze je Spieler
  verletzungsJahre: 2,      // medizin.historie – genau das Fenster, das medical.js liest
  sponsorHistorie: 8,
  trainingHistorie: 8,
  konflikteErledigt: 5,     // beigelegte Kabinenkonflikte je Verein
  jugendAbschiedAlter: 22   // ab hier ist ein Nachwuchsspieler ohne Pflichtspiel Vergangenheit
};

/**
 * Was ein zurückgetretener Spieler behält – und wer es liest.
 *
 *   id/firstName/lastName/shortName  Ruhmeshalle, Bestenlisten, chemie.js:erbeAntreten
 *   clubId                           Rückfall für „Zuletzt bei" (steht nach dem
 *                                    Karriereende ohnehin auf null)
 *   nationality/age/position         Kopfzeile der Karte, Tabelle „Weitere Karriereenden"
 *   era/eraLabel                     Legendenabzeichen und Sortierung der Halle
 *   number                           Rückennummer-Erbe (club/chemie.js:erbeAntreten)
 *   appearance                       Portrait (render/portraits.js)
 *   attributes                       Spalte „Stärke" = engine/ratings.js:playerOverall
 *   retired                          Saison, Alter, Grund, letzter Verein, Legende
 *   stats.career                     Spiele, Tore, Vorlagen, Zu Null
 *
 * Alles Übrige – Moral, Fitness, Form, Vertrag, Verletzungsakte, Trainingsplan,
 * Charakter, Angebote, Karten, Nationalelf, Mentor – beschreibt ein Berufsleben,
 * das zu Ende ist. Es fliegt raus.
 */
const RUHMESHALLE_FELDER = [
  'id', 'firstName', 'lastName', 'shortName', 'clubId',
  'nationality', 'age', 'position', 'era', 'eraLabel', 'number',
  'appearance', 'attributes', 'retired'
];

/**
 * Dampft einen zurückgetretenen Spieler ein – IM VORHANDENEN OBJEKT.
 *
 * Kein neues Objekt: `p.mentor.mentorId` und `lehrer.mentees` zeigen quer durch
 * den Kader, und club/chemie.js hält den Lehrer noch in der Hand, wenn der
 * Zögling seine Nummer erbt. Ein Austausch würde diese Verweise ins Leere laufen
 * lassen, ohne dass es irgendwo knallt – die schlimmste Sorte Fehler.
 */
function ruecktrittEindampfen(p) {
  const career = (p.stats && p.stats.career) || emptyStatLine();
  for (const feld in p) {
    if (RUHMESHALLE_FELDER.indexOf(feld) < 0) delete p[feld];
  }
  // Die laufende Saisonzeile legt loop.js:spielerFortschreiben beim nächsten
  // Wechsel von selbst wieder an; sie steht hier bewusst nicht mit drin.
  p.stats = { career };
}

/** Steht an diesem Spieler noch etwas, das die Ruhmeshalle nicht braucht? */
function nochNichtEingedampft(p) {
  for (const feld in p) {
    if (feld !== 'stats' && RUHMESHALLE_FELDER.indexOf(feld) < 0) return true;
  }
  return !!(p.stats && (p.stats.season !== undefined || p.stats.history !== undefined));
}

/**
 * Streicht einen Spieler restlos aus dem Spielstand.
 *
 * Restlos heißt: aus jeder Liste, die ihn nennen könnte. Ein Spieler, den es
 * nicht mehr gibt, aber der noch in `club.beobachtet` steht, ist eine leere
 * Zeile im Scoutingbericht – und die fällt erst drei Bildschirme später auf.
 */
function spielerEntfernen(state, playerId) {
  const p = state.players[playerId];
  if (!p) return false;

  delete state.players[playerId];
  if (Array.isArray(state.freeAgents)) {
    state.freeAgents = state.freeAgents.filter(id => id !== playerId);
  }

  for (const clubId in state.clubs) {
    const club = state.clubs[clubId];
    if (!club) continue;
    if (Array.isArray(club.playerIds)) club.playerIds = club.playerIds.filter(id => id !== playerId);
    if (Array.isArray(club.transferliste)) club.transferliste = club.transferliste.filter(id => id !== playerId);
    if (Array.isArray(club.beobachtet)) {
      club.beobachtet = club.beobachtet.filter(e =>
        e !== playerId && !(e && typeof e === 'object' && e.playerId === playerId));
    }
    if (Array.isArray(club['gerüchte'])) {
      club['gerüchte'] = club['gerüchte'].filter(e => !e || e.playerId !== playerId);
    }
    const y = club.youth;
    if (y) {
      if (Array.isArray(y.talente)) y.talente = y.talente.filter(id => id !== playerId);
      if (Array.isArray(y.jahrgang)) {
        y.jahrgang = y.jahrgang.filter(e => e !== playerId && !(e && typeof e === 'object' && e.id === playerId));
      }
    }
    const k = club.kabine;
    if (k) {
      if (Array.isArray(k.konflikte)) {
        k.konflikte = k.konflikte.filter(c =>
          !c || !Array.isArray(c.playerIds) || c.playerIds.indexOf(playerId) < 0);
      }
      if (Array.isArray(k.mannschaftsrat)) k.mannschaftsrat = k.mannschaftsrat.filter(id => id !== playerId);
    }
    aufstellungSaeubern(club, playerId);
  }

  for (const id in state.players) {
    const q = state.players[id];
    if (!q) continue;
    if (q.mentor && q.mentor.mentorId === playerId) q.mentor = null;
    if (Array.isArray(q.mentees)) q.mentees = q.mentees.filter(x => x !== playerId);
  }
  return true;
}

/**
 * Nimmt einen Spieler aus Aufstellung, Bank, Standards und Sonderrollen.
 *
 * Dieselbe Arbeit erledigt club/karriere.js:aufstellungBereinigen – von hier
 * aus ist sie aber nicht erreichbar, ohne dass core/state.js ein club/-Modul
 * importiert. Das tut es an keiner Stelle und soll es auch nicht anfangen
 * (importStammdaten weiter unten löst dasselbe Problem genauso).
 */
function aufstellungSaeubern(club, playerId) {
  const t = club && club.tactics;
  if (!t) return;
  if (t.lineup && typeof t.lineup === 'object') {
    for (const slot in t.lineup) if (t.lineup[slot] === playerId) delete t.lineup[slot];
  }
  if (Array.isArray(t.bench)) t.bench = t.bench.filter(id => id !== playerId);
  if (t.setPieces && typeof t.setPieces === 'object') {
    for (const k in t.setPieces) if (t.setPieces[k] === playerId) t.setPieces[k] = null;
  }
  if (t.roles && typeof t.roles === 'object' && t.roles[playerId] !== undefined) delete t.roles[playerId];
}

/**
 * Ausgemusterte Nachwuchsspieler, die nie befördert wurden.
 *
 * Zwei Fälle, beide eindeutig:
 *   a) `p.jugend` gesetzt, aber kein Verein führt ihn mehr im Nachwuchs –
 *      ein Waisenkind aus einem abgebrochenen Jahrgangswechsel.
 *   b) Aus einer Akademie gekommen (`p.nachwuchs`), ohne Verein, ohne ein
 *      einziges Pflichtspiel, und alt genug, dass daraus nichts mehr wird.
 *
 * Wer je auf dem Platz stand, bleibt – und zwar nach der strengsten Lesart:
 * keine Spiele, keine Minuten, keine einzige Zeile in `stats.history`. Sonst
 * fiele er womöglich aus der Bestenliste oder – schlimmer – aus der Rechnung
 * für den jüngsten Debütanten, die chronik.js aus genau dieser Liste zieht.
 */
function jugendAusmustern(state) {
  const imNachwuchs = new Set();
  for (const clubId in state.clubs) {
    const y = state.clubs[clubId] && state.clubs[clubId].youth;
    if (y && Array.isArray(y.talente)) for (const pid of y.talente) imNachwuchs.add(pid);
  }

  const weg = [];
  for (const pid of Object.keys(state.players).sort()) {
    const p = state.players[pid];
    if (!p || p.retired) continue;
    if (p.jugend) {
      if (!imNachwuchs.has(pid)) weg.push(pid);
      continue;
    }
    if (p.clubId || !p.nachwuchs) continue;
    if ((p.age || 0) < VERDICHTUNG.jugendAbschiedAlter) continue;
    const c = (p.stats && p.stats.career) || {};
    if ((c.spiele || 0) > 0 || (c.minuten || 0) > 0) continue;
    if (p.stats && Array.isArray(p.stats.history) && p.stats.history.length) continue;
    weg.push(pid);
  }

  for (const pid of weg) spielerEntfernen(state, pid);
  return weg.length;
}

/**
 * Gespielte Partien vergangener Spielzeiten auf die Ergebniszeile eindampfen:
 * wer, gegen wen, wie ausgegangen, in welchem Wettbewerb, an welchem Spieltag.
 * Statistikblöcke und Torschützenlisten braucht danach niemand mehr.
 *
 * HEUTE FINDET DAS NICHTS: core/loop.js:spielplaeneNeu() wirft die Partien der
 * abgelaufenen Saison beim Wechsel komplett weg (ROADMAP 5.7 / S1) – strenger,
 * als hier gekürzt würde. Die Regel steht trotzdem hier, weil sie die Grenze
 * zieht: Sollte je jemand alte Spielpläne stehen lassen, kosten sie ab dann
 * eine Zeile und keinen Statistikblock. tools/test-spielstand.js meldet die
 * Zahl, damit niemand glaubt, hier werde gearbeitet, wo nichts zu tun ist.
 */
function fixturesEindampfen(state) {
  const saison = (state.date && state.date.season) || 1;
  let n = 0;
  for (const f of state.fixtures || []) {
    if (!f || !f.played || (f.season || 0) >= saison) continue;
    let getroffen = false;
    // Nur der Statistikblock und die Torschützenliste – Ergebnis, Wettbewerb,
    // Spieltag und alles Weitere am Datensatz bleiben stehen. Wer hier `result`
    // durch ein frisches Objekt ersetzt, verliert stillschweigend auch
    // Elfmeterschießen und Verlängerung.
    if (f.result && f.result.stats !== undefined) { delete f.result.stats; getroffen = true; }
    if (f.torschuetzen !== undefined) { delete f.torschuetzen; getroffen = true; }
    if (getroffen) n++;
  }
  return n;
}

/**
 * Postfach kappen – mit zwei Ausnahmen, die nicht verhandelbar sind:
 * Abschiedsbriefe (`kind: 'karriere'`) sind der Text unter jeder Karte der
 * Ruhmeshalle, und die Saisonrückblicke sind der Kiosk im Chronikbildschirm.
 * Beide zählen nicht gegen das Kontingent. Nachgeschoben wird nichts – was
 * pushMessage() bei 300 Nachrichten schon hinausgedrängt hat, bleibt draußen.
 */
function postfachKappen(state) {
  const inbox = Array.isArray(state.inbox) ? state.inbox : null;
  if (!inbox) return 0;
  let frei = VERDICHTUNG.postfach;
  const neu = [];
  for (const m of inbox) {
    const geschuetzt = !!m && (m.kind === 'karriere' ||
      String(m.subject || '').indexOf('Saisonrückblick') === 0);
    if (geschuetzt) { neu.push(m); continue; }
    if (frei > 0) { neu.push(m); frei--; }
  }
  const weg = inbox.length - neu.length;
  if (weg > 0) state.inbox = neu;
  return weg;
}

/** Kassenbuch, Kabinen-Zwischenspeicher, Fanaktionen, Historien eines Vereins. */
function vereinVerdichten(state, club, eigen) {
  const saison = (state.date && state.date.season) || 1;

  const f = club.finances;
  if (f && Array.isArray(f.ledger)) {
    const max = eigen ? VERDICHTUNG.ledgerEigen : VERDICHTUNG.ledgerKi;
    if (f.ledger.length > max) {
      const weg = f.ledger.slice(0, f.ledger.length - max);
      // Dieselbe Buchführung wie kompaktVerein() beim Speichern: Die gekappte
      // Summe wandert nach `ledgerGekuerzt`, sonst stimmt die Bilanz nicht mehr.
      f.ledgerGekuerzt = (f.ledgerGekuerzt || 0) + weg.reduce((s, e) => s + ((e && e.betrag) || 0), 0);
      f.ledger = f.ledger.slice(-max);
    }
  }

  // Beziehungsmatrix und Hierarchie sind TAGESZWISCHENSPEICHER (morale.js:
  // beziehungenCache prüft `beziehungenTag === heute`). Sie stehen mit rund
  // einem Megabyte im Spielstand und werden nach dem Laden ohnehin neu
  // gerechnet. -999 ist derselbe Wert, mit dem morale.js selbst eine
  // Neuberechnung erzwingt.
  const k = club.kabine;
  if (k) {
    if (k.beziehungen) { k.beziehungen = null; k.beziehungenTag = -999; }
    if (k.hierarchie) { k.hierarchie = null; k.hierarchieTag = -999; }
    if (Array.isArray(k.konflikte)) {
      const erledigt = k.konflikte.filter(c => c && c.status !== 'offen');
      const behalten = new Set(erledigt.slice(-VERDICHTUNG.konflikteErledigt));
      k.konflikte = k.konflikte.filter(c => c && (c.status === 'offen' || behalten.has(c)));
    }
  }

  // Fanaktionen: alle offenen bleiben, von den erledigten nur die jüngste je
  // Art. club/fans.js sucht mit `find(x => x.typ === …)` die letzte Aktion
  // einer Art als Sperrfrist – die findet danach exakt denselben Eintrag.
  const fa = club.fans;
  if (fa && Array.isArray(fa.aktionen)) {
    const gesehen = new Set();
    fa.aktionen = fa.aktionen.filter(a => {
      if (!a) return false;
      if (!a.erledigt) return true;
      if (gesehen.has(a.typ)) return false;
      gesehen.add(a.typ);
      return true;
    });
  }

  const sp = club.sponsors;
  if (sp && Array.isArray(sp.historie) && sp.historie.length > VERDICHTUNG.sponsorHistorie) {
    sp.historie = sp.historie.slice(-VERDICHTUNG.sponsorHistorie);
  }
  const tr = club.training;
  if (tr && Array.isArray(tr.historie) && tr.historie.length > VERDICHTUNG.trainingHistorie) {
    tr.historie = tr.historie.slice(-VERDICHTUNG.trainingHistorie);
  }

  // Zwei Listen mit Fixture-Kennungen als Doppelbuchungsschutz. Die Partien,
  // auf die sie zeigen, hat spielplaeneNeu() gerade weggeräumt.
  if (club.medizin && Array.isArray(club.medizin.spieleVerarbeitet)) club.medizin.spieleVerarbeitet = [];
  if (club.stadiumState && Array.isArray(club.stadiumState.abgerechnet)) club.stadiumState.abgerechnet = [];

  if (Array.isArray(club['gerüchte'])) {
    club['gerüchte'] = club['gerüchte'].filter(g => g && (g.season === undefined || g.season >= saison));
  }
}

/** Verletzungsakte, Belastungsfenster und Tagesbegründungen eines Spielers. */
function spielerVerdichten(state, p) {
  const saison = (state.date && state.date.season) || 1;

  const m = p.medizin;
  if (m) {
    if (Array.isArray(m.einsaetze) && m.einsaetze.length > VERDICHTUNG.einsaetze) {
      // club/medical.js:belastung() rechnet über ein Tagesfenster – nach dem
      // Wechsel liegt jeder Eintrag aus der Vorsaison ohnehin außerhalb.
      m.einsaetze = m.einsaetze.slice(-VERDICHTUNG.einsaetze);
    }
    if (Array.isArray(m.historie) && m.historie.length > 1) {
      // Genau das Fenster, das medical.js:risikoFaktoren() abfragt („Verletzungen
      // in den letzten zwei Jahren"). Die jüngste Verletzung bleibt in jedem
      // Fall stehen, sonst verliert langzeitschaeden() seinen Anker.
      const juengste = m.historie[m.historie.length - 1];
      const gefiltert = m.historie.filter(h => h && (saison - (h.saison || 0)) <= VERDICHTUNG.verletzungsJahre);
      m.historie = gefiltert.length ? gefiltert : [juengste];
    }
  }
  // Beide werden im laufenden Betrieb jeden Tick neu erzeugt.
  if (p.happiness && Array.isArray(p.happiness.gruende) && p.happiness.gruende.length) {
    p.happiness.gruende = [];
  }
  if (p.training && p.training.fortschritt) p.training.fortschritt = null;
}

/**
 * Verdichtet die Vergangenheit eines Spielstands. Aufzurufen beim
 * Saisonwechsel, NACHDEM der Kalender umgesprungen ist.
 *
 * @param {object} state
 * @param {object} [opts]
 *   messen: boolean  Spielstandgröße vor und nach der Arbeit ermitteln. Kostet
 *                    zwei volle Serialisierungen und bleibt deshalb aus, solange
 *                    niemand danach fragt (tools/test-spielstand.js tut es).
 * @returns {object} Bericht – wie viel wovon, in Stück und (auf Wunsch) in Byte.
 *                   Der Bericht ist die halbe Miete: Eine Bremse, die still
 *                   arbeitet, merkt niemand, wenn sie eines Tages nicht mehr greift.
 */
export function verdichteVergangenheit(state, opts = {}) {
  if (!state || !state.players || !state.clubs) {
    throw new Error('[state] verdichteVergangenheit() braucht einen vollständigen Spielstand.');
  }
  const messen = opts.messen === true;
  const vorher = messen ? serialize(state).length : null;
  const bericht = {
    saison: (state.date && state.date.season) || 1,
    ruecktritte: 0, jugendGeloescht: 0, fixtures: 0,
    postfach: 0, meldungen: 0, vereine: 0, spieler: 0,
    vorher, nachher: vorher, gespart: 0
  };

  for (const pid of Object.keys(state.players).sort()) {
    const p = state.players[pid];
    if (!p) continue;
    if (p.retired) {
      if (!nochNichtEingedampft(p)) continue;
      ruecktrittEindampfen(p);
      bericht.ruecktritte++;
    } else {
      spielerVerdichten(state, p);
      bericht.spieler++;
    }
  }

  bericht.jugendGeloescht = jugendAusmustern(state);
  bericht.fixtures = fixturesEindampfen(state);
  bericht.postfach = postfachKappen(state);

  if (Array.isArray(state.news) && state.news.length > VERDICHTUNG.meldungen) {
    bericht.meldungen = state.news.length - VERDICHTUNG.meldungen;
    state.news.length = VERDICHTUNG.meldungen;
  }

  const eigenerVerein = state.managerClubId;
  for (const clubId of Object.keys(state.clubs).sort()) {
    const club = state.clubs[clubId];
    if (!club) continue;
    vereinVerdichten(state, club, clubId === eigenerVerein);
    bericht.vereine++;
  }

  if (messen) {
    bericht.nachher = serialize(state).length;
    bericht.gespart = bericht.vorher - bericht.nachher;
  }
  return bericht;
}

/* ------------------------------------------------------------------ *
 *  Speichern / Laden
 * ------------------------------------------------------------------ */

/* ---- Kompaktierung beim Speichern --------------------------------- *
 *
 * Der volle Spielzustand wächst über eine Saison auf über 6 MB an und sprengt
 * damit localStorage. Beim Speichern werden deshalb reine Protokoll- und
 * Ableitungsdaten der KI-Vereine gekürzt – der laufende Zustand im Speicher
 * bleibt unangetastet, es wird nur die abgelegte Fassung schlanker.
 *
 * Gekürzt wird ausschließlich:
 *   - finances.ledger   (Kassenbuch; die gekappte Summe wandert nach
 *                        `ledgerGekuerzt`, das club/finances.js bereits führt,
 *                        damit die Bilanz stimmig bleibt)
 *   - happiness.gruende (deutsche Begründungstexte, werden jeden Tick neu erzeugt)
 *   - medizin.einsaetze (Einsatzprotokoll für die Belastungssteuerung)
 *   - training.fortschritt und stats.history (Verlaufsdaten)
 *
 * Für den Verein des Spielers und dessen Spieler bleibt alles vollständig –
 * das sind die Daten, die der Manager tatsächlich zu sehen bekommt.
 */
const KOMPAKT = {
  ledgerEigen: 400, ledgerKi: 25,
  einsaetzeKi: 6, historyMax: 12
};

function kompaktVerein(club, eigen) {
  const max = eigen ? KOMPAKT.ledgerEigen : KOMPAKT.ledgerKi;
  const ledger = club.finances && Array.isArray(club.finances.ledger) ? club.finances.ledger : null;
  if (!ledger || ledger.length <= max) return club;

  const weg = ledger.slice(0, ledger.length - max);
  const summe = weg.reduce((s, e) => s + (e.betrag || 0), 0);
  return Object.assign({}, club, {
    finances: Object.assign({}, club.finances, {
      ledger: ledger.slice(-max),
      ledgerGekuerzt: (club.finances.ledgerGekuerzt || 0) + summe
    })
  });
}

function kompaktSpieler(player, eigen) {
  if (eigen) return player;
  const p = Object.assign({}, player);
  if (p.happiness && p.happiness.gruende && p.happiness.gruende.length) {
    p.happiness = Object.assign({}, p.happiness, { gruende: [] });
  }
  if (p.medizin && Array.isArray(p.medizin.einsaetze) && p.medizin.einsaetze.length > KOMPAKT.einsaetzeKi) {
    p.medizin = Object.assign({}, p.medizin, { einsaetze: p.medizin.einsaetze.slice(-KOMPAKT.einsaetzeKi) });
  }
  if (p.training && p.training.fortschritt) {
    p.training = Object.assign({}, p.training, { fortschritt: null });
  }
  if (p.stats && Array.isArray(p.stats.history) && p.stats.history.length > KOMPAKT.historyMax) {
    p.stats = Object.assign({}, p.stats, { history: p.stats.history.slice(-KOMPAKT.historyMax) });
  }
  return p;
}

/** Kürzt Zahlen auf zwei Nachkommastellen – spart Platz ohne Spielwirkung. */
function zahlenKuerzen(key, value) {
  return typeof value === 'number' && !Number.isInteger(value)
    ? Math.round(value * 100) / 100
    : value;
}

export function serialize(state) {
  const eigenerVerein = state.managerClubId;
  const eigeneSpieler = new Set(
    (state.clubs[eigenerVerein] ? state.clubs[eigenerVerein].playerIds : []).concat(
      state.clubs[eigenerVerein] ? state.clubs[eigenerVerein].youth.talente : [])
  );

  const clubs = {};
  for (const id in state.clubs) clubs[id] = kompaktVerein(state.clubs[id], id === eigenerVerein);

  const players = {};
  for (const id in state.players) players[id] = kompaktSpieler(state.players[id], eigeneSpieler.has(id));

  return JSON.stringify(Object.assign({}, state, { clubs, players }), zahlenKuerzen);
}

/** Größe des Spielstands in Byte – für Warnungen in der Oberfläche. */
export function saveSize(state) {
  return serialize(state).length;
}

export function deserialize(json) {
  const state = typeof json === 'string' ? JSON.parse(json) : json;
  if (state.version !== SAVE_VERSION) migrate(state);
  return state;
}

/**
 * Hebt einen älteren Spielstand auf das aktuelle Schema.
 *
 * Grundsatz: lieber laut scheitern als still das Falsche laden. Ein Spielstand
 * aus einer NEUEREN Fassung wird deshalb abgelehnt – wir wissen nicht, was
 * darin steht, und raten hilft hier niemandem.
 */
function migrate(state) {
  const von = Number(state.version) || 1;
  if (von > SAVE_VERSION) {
    throw new Error(
      `Dieser Spielstand stammt aus Version ${von}, dieses Spiel kennt nur ${SAVE_VERSION}. ` +
      `Bitte die neuere Fassung des Spiels benutzen.`);
  }

  /* --- 1 -> 2: Ligazugehörigkeit wandert in den Spielstand -------------- */
  if (!state.leagues || typeof state.leagues !== 'object') {
    state.leagues = {};
    for (const league of Object.values(LEAGUES)) {
      // Der Spielstand weiß es besser als die Vorlage: nach einem Auf- oder
      // Abstieg steht die richtige Antwort in club.leagueId.
      const ausSpielstand = Object.keys(state.clubs || {})
        .filter(id => state.clubs[id] && state.clubs[id].leagueId === league.id);
      state.leagues[league.id] = {
        id: league.id,
        clubIds: ausSpielstand.length ? ausSpielstand : league.clubIds.slice()
      };
    }
    console.warn(`[state] Spielstand von Version ${von} auf ${SAVE_VERSION} gehoben: ` +
      `Ligazugehörigkeit aus club.leagueId übernommen.`);
  }

  // Beide Seiten in Deckung bringen – state.leagues gewinnt.
  for (const id in state.leagues) {
    const e = state.leagues[id];
    if (!e || !Array.isArray(e.clubIds)) continue;
    if (!e.id) e.id = id;
    for (const clubId of e.clubIds) {
      const club = state.clubs && state.clubs[clubId];
      if (club) club.leagueId = id;
    }
  }

  // Felder, die Stufe 1 neu befüllt und ältere Stände noch nicht kennen.
  if (!state.history || typeof state.history !== 'object') state.history = {};
  if (!Array.isArray(state.history.seasons)) state.history.seasons = [];
  if (!Array.isArray(state.history.transfers)) state.history.transfers = [];
  if (!state.history.titel || typeof state.history.titel !== 'object') state.history.titel = {};

  /* --- 2 -> 3: der Europapokal zieht ein ------------------------------- */
  //
  // Ohne diesen Schritt lädt ein Stand aus Stufe 2 zwar ohne Fehler, aber
  // state.clubs kennt keinen einzigen europäischen Verein. club/europa.js lost
  // dann nur noch die deutschen Teilnehmer gegeneinander: gemessen 24 statt 288
  // Partien in der Ligaphase – still das Falsche, genau das, was der Grundsatz
  // oben verbietet.
  if (state.clubs && !EURO_CLUBS.every(raw => state.clubs[raw.id])) {
    const rng = createRng(`${state.seed}:migration:euro`);
    let neu = 0;
    for (const raw of EURO_CLUBS) {
      if (state.clubs[raw.id]) continue;
      const club = euroClub(raw, rng);
      initClubRuntime(club, rng);
      state.clubs[club.id] = club;
      neu++;
    }
    console.warn(`[state] Spielstand von Version ${von} auf ${SAVE_VERSION} gehoben: ` +
      `${neu} europäische Vereine nachgetragen. Der Europapokal beginnt mit der nächsten Saison.`);
  }
  if (!state.europa || typeof state.europa !== 'object') {
    state.europa = { teilnehmer: [], runde: 0, paarungen: [] };
  }
  if (!Array.isArray(state.europa.teilnehmer)) state.europa.teilnehmer = [];
  if (!Array.isArray(state.europa.paarungen)) state.europa.paarungen = [];

  /* --- 3 -> 4: die Spielstandbremse ------------------------------------ */
  //
  // Ein Stand aus Version 3 hat noch nie verdichtet: zurückgetretene Spieler
  // schleppen ihren kompletten Berufsalltag mit, die Beziehungsmatrizen aller
  // 130 Vereine stehen als Tageszwischenspeicher in der Datei, und die
  // Protokolllisten sind über Jahre gewachsen. Er läuft auch ohne diesen
  // Schritt – aber er bliebe für immer so groß, wie er beim letzten Speichern
  // war, denn die Bremse greift erst beim nächsten Saisonwechsel.
  //
  // Deshalb einmal von Hand: laut, mit Zahl, und ohne den Ladevorgang zu
  // gefährden – ein Spielstand, der sich nicht verdichten lässt, ist immer noch
  // ein Spielstand.
  if (von < 4) {
    try {
      const b = verdichteVergangenheit(state, { messen: true });
      console.warn(`[state] Spielstand von Version ${von} auf ${SAVE_VERSION} gehoben: ` +
        `${b.ruecktritte} Karriereenden eingedampft, ${b.jugendGeloescht} ausgemusterte ` +
        `Nachwuchsspieler gestrichen, ${(b.gespart / 1048576).toFixed(2).replace('.', ',')} MB frei.`);
    } catch (err) {
      console.warn('[state] Die Verdichtung des alten Spielstands ist gescheitert – ' +
        'er wird ungekürzt geladen und beim nächsten Saisonwechsel nachgeholt:', err);
    }
  }

  state.version = SAVE_VERSION;
  return state;
}

/*
 * Spielstände liegen in IndexedDB: Ein Spielstand ist auch nach der Kompaktierung
 * mehrere Megabyte groß und würde das localStorage-Kontingent (meist 5 MB für die
 * gesamte Herkunft) sprengen. Nur das kleine Verzeichnis der Spielstände bleibt in
 * localStorage, damit der Startbildschirm es ohne Warten anzeigen kann.
 */

const DB_NAME = 'traumverein';
const DB_STORE = 'spielstaende';
let dbPromise = null;

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (e) { /* Privatmodus */ }
  return null;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB ist in diesem Browser nicht verfügbar.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB konnte nicht geöffnet werden.'));
  });
  return dbPromise;
}

function dbTx(modus, arbeit) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, modus);
    const store = tx.objectStore(DB_STORE);
    let ergebnis;
    try { ergebnis = arbeit(store); } catch (err) { reject(err); return; }
    tx.oncomplete = () => resolve(ergebnis && ergebnis.result !== undefined ? ergebnis.result : ergebnis);
    tx.onerror = () => reject(tx.error || new Error('Datenbankzugriff fehlgeschlagen.'));
    tx.onabort = () => reject(tx.error || new Error('Datenbankzugriff abgebrochen.'));
  }));
}

function saveEntry(state, slot, label) {
  const club = myClub(state);
  return {
    slot,
    label: label || `${club.shortName} – Saison ${state.date.season}`,
    manager: state.manager.name,
    club: club.name,
    clubId: club.id,
    season: state.date.season,
    day: state.date.day,
    difficulty: state.difficulty,
    gespeichertTick: state.tick,
    groesse: 0
  };
}

export async function saveGame(state, slot = 1, label = '') {
  const json = serialize(state);
  const entry = saveEntry(state, slot, label);
  entry.groesse = json.length;

  await dbTx('readwrite', store => store.put(json, SAVE_PREFIX + slot));

  const store = storage();
  if (store) {
    const rest = listSaves().filter(e => e.slot !== slot);
    rest.push(entry);
    try { store.setItem(SAVE_INDEX, JSON.stringify(rest)); }
    catch (e) { console.warn('[state] Spielstandverzeichnis konnte nicht aktualisiert werden:', e); }
  }
  return entry;
}

export async function loadGame(slot = 1) {
  const raw = await dbTx('readonly', store => store.get(SAVE_PREFIX + slot));
  if (!raw) return null;
  return deserialize(raw);
}

export function listSaves() {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(SAVE_INDEX);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

export async function deleteSave(slot) {
  await dbTx('readwrite', store => store.delete(SAVE_PREFIX + slot));
  const store = storage();
  if (store) store.setItem(SAVE_INDEX, JSON.stringify(listSaves().filter(e => e.slot !== slot)));
}

export function hasAutosave() {
  return listSaves().some(e => e.slot === 'auto');
}

/** Spielstand als Datei sichern – unabhängig vom Browserspeicher. */
export function exportSave(state) {
  const club = myClub(state);
  const name = `traumverein-${slugName(club.shortName)}-s${state.date.season}-t${state.date.day}.json`;
  return { name, inhalt: serialize(state) };
}

export function importSave(json) {
  const state = deserialize(json);
  if (!state || !state.clubs || !state.managerClubId) {
    throw new Error('Die Datei enthält keinen gültigen Traumverein-Spielstand.');
  }
  return state;
}

function slugName(s) {
  return String(s).toLowerCase().replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* ══════════════════════════════════════════════════════════════════════════ *
 *  STAMMDATEN – das zweite Dateiformat
 *
 *  exportSave/importSave oben schreiben und lesen einen ganzen SPIELSTAND:
 *  Tabellenstand, Kassenbuch, Verletzungen, Postfach, Zufallszustand. Das ist
 *  genau richtig, um weiterzuspielen – und genau falsch, um gepflegte Kader
 *  weiterzugeben. Wer seine Zweitligakader von Hand nachgezogen hat, will sie
 *  verschicken können, ohne seine Karriere mitzuschicken.
 *
 *  Deshalb hier ein zweites, viel kleineres Format: nur die Felder, die auch
 *  in data/clubs.js bzw. data/squads/*.js stehen würden. Kein Laufzeitfeld,
 *  keine Statistik, keine Ligazugehörigkeit als Tatsache (nur als Wunsch).
 *  Damit ist es zugleich die Antwort auf „meine Kader sind veraltet" – ohne
 *  dass dieses Spiel je eine Datenquelle aus dem Netz braucht.
 *
 *  Der Import ist bewusst nachsichtig UND laut:
 *    • unbekannte Felder werden ignoriert (das Format darf wachsen),
 *    • fehlende Felder werden ergänzt (aus dem vorhandenen Datensatz oder
 *      aus einer Vorlage),
 *    • Ungültiges wird NAMENTLICH gemeldet und übersprungen.
 *  Der Spielstand wird erst angefasst, wenn die ganze Datei gelesen ist –
 *  eine kaputte Datei kann ihn deshalb nicht halb umschreiben.
 * ══════════════════════════════════════════════════════════════════════════ */

export const STAMMDATEN_FORMAT = 'traumverein-stammdaten';
export const STAMMDATEN_VERSION = 1;

/** Trikot- und Wappenformen, die render/kits.js zeichnen kann. */
export const KIT_PATTERNS = ['plain', 'stripes', 'hoops', 'halves', 'sash', 'chest'];

/* ---- kleine Prüfer ------------------------------------------------------ */

const istText = (v) => typeof v === 'string' && v.trim().length > 0;

function alsText(v, max, ersatz = '') {
  return istText(v) ? v.trim().slice(0, max) : ersatz;
}

function alsZahl(v, min, max, ersatz) {
  const n = Number(v);
  if (!Number.isFinite(n)) return ersatz;
  return clamp(Math.round(n), min, max);
}

function alsFarbe(v, ersatz) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : ersatz;
}

function alsAuswahl(v, erlaubt, ersatz) {
  return erlaubt.indexOf(v) >= 0 ? v : ersatz;
}

function alsListe(v, max, laenge) {
  if (!Array.isArray(v)) return [];
  return v.filter(istText).slice(0, max).map(t => t.trim().slice(0, laenge));
}

/* ---- Herauslesen -------------------------------------------------------- */

/**
 * Die reinen Stammdaten eines Vereins – dasselbe Feldbild wie ein Eintrag in
 * data/clubs.js. `leagueId` fährt mit, ist beim Import aber nur ein Wunsch:
 * Wer in welcher Liga spielt, entscheidet state.leagues (ROADMAP 5.1).
 */
export function clubStammdaten(club) {
  const c = club || {};
  const farben = c.colors || {};
  const kit = c.kit || {};
  const away = c.awayKit || {};
  const crest = c.crest || {};
  const st = c.stadium || {};
  const fin = c.finances || {};
  // `fans` VOR `fanbase`: `fanbase` ist die Gründungsvorlage aus data/clubs.js
  // und wird nie fortgeschrieben, `fans` ist der laufende Zustand. Andersherum
  // trug ein Export die Zahlen von Tag eins, und ein Rundlauf ohne eine
  // einzige Änderung setzte den Verein auf sie zurück (gemessen: HSV nach drei
  // Saisons 147.854 Mitglieder → 96.000). Dieselbe Reihenfolge wie in
  // club/sponsors.js:238, club/stadium.js:262 und club/finances.js:288.
  const fans = c.fans || c.fanbase || {};
  const fac = c.facilities || {};
  const hist = c.history || {};
  return {
    id: c.id,
    name: c.name || c.id,
    shortName: c.shortName || c.name || c.id,
    abbr: c.abbr || String(c.name || c.id).slice(0, 3).toUpperCase(),
    city: c.city || '',
    founded: c.founded || 1900,
    colors: {
      primary: farben.primary || DEFAULT_COLORS.primary,
      secondary: farben.secondary || DEFAULT_COLORS.secondary,
      accent: farben.accent || DEFAULT_COLORS.accent
    },
    kit: {
      pattern: kit.pattern || 'plain',
      shorts: kit.shorts || farben.primary || DEFAULT_COLORS.primary,
      socks: kit.socks || farben.primary || DEFAULT_COLORS.primary
    },
    awayKit: {
      primary: away.primary || farben.secondary || DEFAULT_COLORS.secondary,
      secondary: away.secondary || farben.primary || DEFAULT_COLORS.primary,
      pattern: away.pattern || 'plain'
    },
    crest: {
      shape: crest.shape || 'round',
      motif: crest.motif || 'letters',
      bg: crest.bg || farben.primary || DEFAULT_COLORS.primary,
      fg: crest.fg || farben.secondary || DEFAULT_COLORS.secondary
    },
    stadium: {
      name: st.name || 'Stadion',
      capacity: st.capacity || 15000,
      standing: st.standing === undefined ? 0.2 : st.standing,
      roof: !!st.roof,
      floodlight: st.floodlight === undefined ? 3 : st.floodlight,
      pitch: st.pitch === undefined ? 75 : st.pitch,
      tiers: st.tiers || 1
    },
    reputation: c.reputation === undefined ? 50 : c.reputation,
    finances: {
      balance: fin.balance || 0,
      debt: fin.debt || 0,
      ticketBase: fin.ticketBase || 20
    },
    fanbase: {
      members: fans.members || 5000,
      ultras: fans.ultras || 30,
      mood: fans.mood === undefined ? 60 : fans.mood,
      potential: fans.potential === undefined ? 50 : fans.potential
    },
    facilities: {
      training: fac.training === undefined ? 50 : fac.training,
      medical: fac.medical === undefined ? 50 : fac.medical,
      youth: fac.youth === undefined ? 50 : fac.youth,
      scouting: fac.scouting === undefined ? 50 : fac.scouting
    },
    boardName: c.boardName || (c.board && c.board.name) || 'Der Vorstand',
    leagueId: c.leagueId || null,
    history: {
      titles: hist.titles || 0,
      lastTitle: hist.lastTitle === undefined ? null : hist.lastTitle,
      honours: Array.isArray(hist.honours) ? hist.honours.slice() : []
    }
  };
}

/** Die reinen Stammdaten eines Spielers – Feldbild wie data/squads/_helper.js:mk(). */
export function playerStammdaten(player) {
  const p = player || {};
  const att = {};
  for (const key of ATTRIBUTES) att[key] = (p.attributes && p.attributes[key]) || 1;
  const a = p.appearance || {};
  const v = p.contract || {};
  return {
    id: p.id,
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    shortName: p.shortName || p.lastName || '',
    clubId: p.clubId || null,
    nationality: p.nationality || 'DE',
    age: p.age === undefined ? 26 : p.age,
    era: p.era || 'modern',
    eraLabel: p.eraLabel || null,
    position: p.position || 'ZM',
    altPositions: Array.isArray(p.altPositions) ? p.altPositions.slice() : [],
    attributes: att,
    potential: p.potential === undefined ? 60 : p.potential,
    foot: p.foot || 'rechts',
    traits: Array.isArray(p.traits) ? p.traits.slice() : [],
    appearance: {
      skin: a.skin === undefined ? 1 : a.skin,
      hair: a.hair || 'kurz',
      hairColor: a.hairColor || '#2b1d14',
      beard: a.beard || 'keiner',
      build: a.build || 'normal',
      height: a.height || 180,
      eyes: a.eyes || '#3a2a1a',
      accessory: a.accessory || 'keiner',
      face: a.face === undefined ? 0 : a.face
    },
    number: p.number || 0,
    contract: {
      salary: v.salary || 0,
      until: v.until === undefined ? 2 : v.until,
      signOn: v.signOn || 0,
      releaseClause: v.releaseClause === undefined ? null : v.releaseClause
    },
    value: p.value || 0
  };
}

/**
 * Stammdaten als Datei – Vereine und Spieler ohne jeden Laufzeitzustand.
 *
 * @param {object} state
 * @param {object} [opts]
 *   clubIds: string[]  nur diese Vereine (Vorgabe: alle Vereine der Ligen,
 *                      also weder Amateur- noch Europapokalkulisse)
 *   vereine: boolean   Vereinsdaten mitschreiben (Vorgabe true)
 *   spieler: boolean   Kader mitschreiben (Vorgabe true)
 *   titel: string      freie Beschriftung, die in der Datei landet
 *   name: string       Dateiname erzwingen
 * @returns {{name:string, inhalt:string}}
 */
export function exportStammdaten(state, opts = {}) {
  const mitVereinen = opts.vereine !== false;
  const mitSpielern = opts.spieler !== false;

  let ids;
  if (Array.isArray(opts.clubIds) && opts.clubIds.length) {
    ids = opts.clubIds.filter(id => state.clubs && state.clubs[id]);
  } else {
    // Vorgabe: die Vereine, die wirklich in einer Liga stehen. Die 66
    // Europapokalgegner und die Amateurkulisse sind erzeugte Statisten –
    // sie in eine Kaderdatei zu schreiben, hilft niemandem.
    const inLiga = new Set();
    for (const id in (state.leagues || {})) {
      const e = state.leagues[id];
      if (e && Array.isArray(e.clubIds)) for (const cid of e.clubIds) inLiga.add(cid);
    }
    ids = Object.keys(state.clubs || {}).filter(id => inLiga.has(id));
  }

  const vereine = mitVereinen ? ids.map(id => clubStammdaten(state.clubs[id])) : [];

  const spieler = [];
  if (mitSpielern) {
    for (const id of ids) {
      const club = state.clubs[id];
      if (!club || !Array.isArray(club.playerIds)) continue;
      for (const pid of club.playerIds) {
        const p = state.players[pid];
        if (p && !p.retired) spieler.push(playerStammdaten(p));
      }
    }
  }

  const doc = {
    format: STAMMDATEN_FORMAT,
    version: STAMMDATEN_VERSION,
    meta: {
      titel: alsText(opts.titel, 120, ''),
      manager: (state.manager && state.manager.name) || '',
      saison: (state.date && state.date.season) || 1,
      tag: (state.date && state.date.day) || 0,
      vereine: vereine.length,
      spieler: spieler.length
    },
    vereine,
    spieler
  };

  const name = opts.name || (ids.length === 1
    ? `traumverein-kader-${slugName(state.clubs[ids[0]].shortName || ids[0])}.json`
    : `traumverein-stammdaten-${ids.length}-vereine.json`);

  // Mit Einrückung: Die Datei soll man in einem Texteditor nachpflegen können –
  // das ist der halbe Zweck des Formats.
  return { name, inhalt: JSON.stringify(doc, null, 1) };
}

/* ---- Einlesen ----------------------------------------------------------- */

/** Vollständiger, aber nackter Vereinsdatensatz – Grundlage für neue Vereine. */
function vereinsVorlage(id, name) {
  return clubStammdaten({ id, name, shortName: name, city: name });
}

/** Nimmt einen Spieler aus Aufstellung und Bank seines Vereins. */
function ausAufstellungNehmen(club, playerId) {
  const t = club && club.tactics;
  if (!t) return false;
  let raus = false;
  if (t.lineup && typeof t.lineup === 'object') {
    for (const slot in t.lineup) {
      if (t.lineup[slot] === playerId) { delete t.lineup[slot]; raus = true; }
    }
  }
  if (Array.isArray(t.bench)) {
    const i = t.bench.indexOf(playerId);
    if (i >= 0) { t.bench.splice(i, 1); raus = true; }
  }
  return raus;
}

/** Übernimmt geprüfte Vereins-Stammdaten in einen vorhandenen Vereinsdatensatz. */
function vereinBefuellen(club, d) {
  club.name = d.name;
  club.shortName = d.shortName;
  club.abbr = d.abbr;
  club.city = d.city;
  club.founded = d.founded;
  club.colors = d.colors;
  club.kit = d.kit;
  club.awayKit = d.awayKit;
  club.crest = d.crest;
  club.reputation = d.reputation;
  club.boardName = d.boardName;
  club.history = d.history;
  club.facilities = d.facilities;
  club.stadium = Object.assign({}, club.stadium || {}, d.stadium);
  club.finances = Object.assign({}, club.finances || {}, d.finances);
  // fanbase ist die Vorlage, fans der laufende Zustand – beide nachziehen,
  // sonst zeigt der Fanbildschirm bis zum nächsten Spieltag alte Zahlen.
  club.fanbase = d.fanbase;
  if (club.fans) {
    club.fans.members = d.fanbase.members;
    club.fans.ultras = d.fanbase.ultras;
    club.fans.potential = d.fanbase.potential;
  }
  if (club.board) club.board.name = d.boardName;
  return club;
}

/** Übernimmt geprüfte Spieler-Stammdaten in einen vorhandenen Spielerdatensatz. */
function spielerBefuellen(player, d) {
  player.firstName = d.firstName;
  player.lastName = d.lastName;
  player.shortName = d.shortName;
  player.nationality = d.nationality;
  player.age = d.age;
  player.era = d.era;
  player.eraLabel = d.eraLabel;
  player.position = d.position;
  player.altPositions = d.altPositions;
  player.attributes = d.attributes;
  player.potential = d.potential;
  player.foot = d.foot;
  player.traits = d.traits;
  player.appearance = d.appearance;
  player.number = d.number;
  player.contract = Object.assign({}, player.contract || {}, d.contract);
  player.value = d.value;
  return player;
}

/**
 * Prüft einen Vereinseintrag aus einer Stammdatendatei.
 *
 * `vorhanden` ist der Verein, den es im Spielstand schon gibt – er dient als
 * Rückfallebene für jedes Feld, das die Datei nicht nennt. Nur so darf eine
 * Datei „nur die Farben" oder „nur die Stadionkapazität" nachziehen, ohne
 * alles Übrige auf Vorlagenwerte zurückzusetzen.
 *
 * @returns {{d:object}|{fehler:string}}
 */
function vereinPruefen(roh, nr, vorhanden) {
  if (!roh || typeof roh !== 'object') return { fehler: `Vereinseintrag ${nr}: kein Datensatz.` };
  const rohName = alsText(roh.name, 60, '');
  const id = alsText(roh.id, 40, '') || slugName(rohName);
  if (!id) return { fehler: `Vereinseintrag ${nr}: weder Kennung noch Name – übersprungen.` };

  const v = vorhanden ? clubStammdaten(vorhanden) : vereinsVorlage(id, rohName);
  const name = rohName || (vorhanden ? v.name : '');
  if (!name) return { fehler: `Verein „${id}": kein Name angegeben – übersprungen.` };

  const f = roh.colors || {};
  const k = roh.kit || {};
  const a = roh.awayKit || {};
  const w = roh.crest || {};
  const st = roh.stadium || {};
  const fin = roh.finances || {};
  const fans = roh.fanbase || {};
  const fac = roh.facilities || {};
  const hist = roh.history || {};

  const d = {
    id,
    name,
    shortName: alsText(roh.shortName, 30, v.shortName || name),
    abbr: alsText(roh.abbr, 5, v.abbr || name.slice(0, 3)).toUpperCase(),
    city: alsText(roh.city, 40, v.city),
    founded: alsZahl(roh.founded, 1800, 2100, v.founded),
    colors: {
      primary: alsFarbe(f.primary, v.colors.primary),
      secondary: alsFarbe(f.secondary, v.colors.secondary),
      accent: alsFarbe(f.accent, v.colors.accent)
    },
    kit: {
      pattern: alsAuswahl(k.pattern, KIT_PATTERNS, v.kit.pattern),
      shorts: alsFarbe(k.shorts, v.kit.shorts),
      socks: alsFarbe(k.socks, v.kit.socks)
    },
    awayKit: {
      primary: alsFarbe(a.primary, v.awayKit.primary),
      secondary: alsFarbe(a.secondary, v.awayKit.secondary),
      pattern: alsAuswahl(a.pattern, KIT_PATTERNS, v.awayKit.pattern)
    },
    crest: {
      shape: alsText(w.shape, 20, v.crest.shape),
      motif: alsText(w.motif, 20, v.crest.motif),
      bg: alsFarbe(w.bg, v.crest.bg),
      fg: alsFarbe(w.fg, v.crest.fg)
    },
    stadium: {
      name: alsText(st.name, 60, v.stadium.name),
      capacity: alsZahl(st.capacity, 500, 150000, v.stadium.capacity),
      standing: clamp(Number(st.standing) >= 0 ? Number(st.standing) : v.stadium.standing, 0, 0.35),
      roof: st.roof === undefined ? v.stadium.roof : !!st.roof,
      floodlight: alsZahl(st.floodlight, 0, 5, v.stadium.floodlight),
      pitch: alsZahl(st.pitch, 20, 100, v.stadium.pitch),
      tiers: alsZahl(st.tiers, 1, 3, v.stadium.tiers)
    },
    reputation: alsZahl(roh.reputation, 1, 100, v.reputation),
    finances: {
      balance: alsZahl(fin.balance, -500000000, 1000000000, v.finances.balance),
      debt: alsZahl(fin.debt, 0, 1000000000, v.finances.debt),
      ticketBase: alsZahl(fin.ticketBase, 1, 300, v.finances.ticketBase)
    },
    fanbase: {
      members: alsZahl(fans.members, 50, 2000000, v.fanbase.members),
      ultras: alsZahl(fans.ultras, 0, 500, v.fanbase.ultras),
      mood: alsZahl(fans.mood, 0, 100, v.fanbase.mood),
      potential: alsZahl(fans.potential, 1, 100, v.fanbase.potential)
    },
    facilities: {
      training: alsZahl(fac.training, 1, 100, v.facilities.training),
      medical: alsZahl(fac.medical, 1, 100, v.facilities.medical),
      youth: alsZahl(fac.youth, 1, 100, v.facilities.youth),
      scouting: alsZahl(fac.scouting, 1, 100, v.facilities.scouting)
    },
    boardName: alsText(roh.boardName, 50, v.boardName),
    leagueId: alsText(roh.leagueId, 20, v.leagueId || '') || null,
    history: {
      titles: alsZahl(hist.titles, 0, 99, v.history.titles),
      lastTitle: hist.lastTitle === undefined
        ? v.history.lastTitle
        : (hist.lastTitle === null ? null : alsZahl(hist.lastTitle, 1800, 2200, null)),
      honours: Array.isArray(hist.honours) ? alsListe(hist.honours, 12, 120) : v.history.honours
    }
  };
  return { d };
}

/** Vollständiger, aber blasser Spielerdatensatz – Grundlage für neue Spieler. */
function spielerVorlage(id, clubId) {
  const att = {};
  for (const key of ATTRIBUTES) att[key] = 40;
  return playerStammdaten({ id, clubId, attributes: att, age: 24, potential: 60 });
}

/**
 * Prüft einen Spielereintrag aus einer Stammdatendatei.
 *
 * `vorhanden` ist derselbe Gedanke wie bei vereinPruefen(): Was die Datei
 * nicht nennt, kommt aus dem Datensatz, den es schon gibt. Eine Datei darf
 * deshalb auch nur „Schuss: 99" für einen einzigen Spieler enthalten.
 *
 * @returns {{d:object, hinweis:?string}|{fehler:string}}
 */
function spielerPruefen(roh, nr, vorhanden) {
  if (!roh || typeof roh !== 'object') return { fehler: `Spielereintrag ${nr}: kein Datensatz.` };

  const lastName = alsText(roh.lastName, 40, '');
  const firstName = alsText(roh.firstName, 40, '');
  const wer = lastName || firstName ||
    (vorhanden ? (vorhanden.lastName || vorhanden.id) : alsText(roh.id, 60, `Eintrag ${nr}`));
  if (!lastName && !firstName && !vorhanden) {
    return { fehler: `Spielereintrag ${nr}: kein Name – übersprungen.` };
  }

  const clubId = roh.clubId === null ? null
    : (istText(roh.clubId) ? roh.clubId.trim() : (vorhanden ? (vorhanden.clubId || null) : null));
  const id = alsText(roh.id, 60, '') ||
    (vorhanden ? vorhanden.id : `p_${clubId || 'frei'}_${slugName(lastName || firstName)}`);

  const v = vorhanden ? playerStammdaten(vorhanden) : spielerVorlage(id, clubId);

  // Position: Erlaubt sind nur die zwölf aus POSITIONS. Sie steuert Bewertung,
  // Aufstellung und Formation – ein „XY" würde erst drei Bildschirme später
  // auffallen, und dann als Fehler an der falschen Stelle.
  const position = roh.position === undefined ? v.position : alsAuswahl(roh.position, POSITIONS, null);
  if (!position) {
    return { fehler: `${wer}: unbekannte Position „${roh.position}" – übersprungen. Erlaubt: ${POSITIONS.join(', ')}.` };
  }

  const rohAtt = (roh.attributes && typeof roh.attributes === 'object') ? roh.attributes : {};
  const attribute = {};
  let unbekannt = 0;
  for (const key in rohAtt) if (ATTRIBUTES.indexOf(key) < 0) unbekannt++;
  for (const key of ATTRIBUTES) attribute[key] = alsZahl(rohAtt[key], 1, 99, v.attributes[key]);

  const rohTraits = Array.isArray(roh.traits) ? roh.traits : null;
  const traits = rohTraits ? rohTraits.filter(t => istText(t) && TRAITS[t]) : v.traits;
  const traitMuell = rohTraits ? rohTraits.filter(t => !istText(t) || !TRAITS[t]) : [];

  const app = (roh.appearance && typeof roh.appearance === 'object') ? roh.appearance : {};
  const nat = alsText(roh.nationality, 4, '').toUpperCase();
  const vertrag = (roh.contract && typeof roh.contract === 'object') ? roh.contract : {};
  const staerke = Math.round(ATTRIBUTES.reduce((s, k) => s + attribute[k], 0) / ATTRIBUTES.length);

  const d = {
    id,
    firstName: firstName || v.firstName,
    lastName: lastName || v.lastName,
    shortName: alsText(roh.shortName, 40, lastName || v.shortName),
    clubId,
    nationality: nat ? (NATION_NAMES[nat] ? nat : v.nationality) : v.nationality,
    age: alsZahl(roh.age, 15, 45, v.age),
    era: alsAuswahl(roh.era, ['modern', 'legend'], v.era),
    eraLabel: roh.eraLabel === undefined ? v.eraLabel : (alsText(roh.eraLabel, 40, '') || null),
    position,
    altPositions: Array.isArray(roh.altPositions)
      ? roh.altPositions.filter(p => POSITIONS.indexOf(p) >= 0).slice(0, 4)
      : v.altPositions,
    attributes: attribute,
    potential: alsZahl(roh.potential, 1, 99, Math.max(v.potential, staerke)),
    foot: alsAuswahl(roh.foot, ['rechts', 'links', 'beidfüßig'], v.foot),
    traits,
    appearance: {
      skin: alsZahl(app.skin, 0, 5, v.appearance.skin),
      hair: alsText(app.hair, 20, v.appearance.hair),
      hairColor: alsFarbe(app.hairColor, v.appearance.hairColor),
      beard: alsText(app.beard, 20, v.appearance.beard),
      build: alsText(app.build, 20, v.appearance.build),
      height: alsZahl(app.height, 150, 215, v.appearance.height),
      eyes: alsFarbe(app.eyes, v.appearance.eyes),
      accessory: alsText(app.accessory, 20, v.appearance.accessory),
      face: alsZahl(app.face, 0, 7, v.appearance.face)
    },
    number: alsZahl(roh.number, 0, 99, v.number),
    contract: {
      salary: alsZahl(vertrag.salary, 0, 100000000, v.contract.salary),
      until: alsZahl(vertrag.until, 0, 12, v.contract.until),
      signOn: alsZahl(vertrag.signOn, 0, 100000000, v.contract.signOn),
      releaseClause: vertrag.releaseClause === undefined
        ? v.contract.releaseClause
        : (vertrag.releaseClause === null ? null : alsZahl(vertrag.releaseClause, 0, 1000000000, null))
    },
    value: alsZahl(roh.value, 0, 1000000000, v.value)
  };

  const anmerkungen = [];
  if (unbekannt) anmerkungen.push(`${unbekannt} unbekannte Attribute ignoriert`);
  if (traitMuell.length) anmerkungen.push(`unbekannte Eigenschaften ignoriert: ${traitMuell.join(', ')}`);
  if (nat && !NATION_NAMES[nat]) anmerkungen.push(`unbekannte Nation „${nat}" – ${d.nationality} beibehalten`);

  return { d, hinweis: anmerkungen.length ? `${wer}: ${anmerkungen.join('; ')}.` : null };
}

/**
 * Liest eine Stammdatendatei ein und schreibt sie in den Spielstand.
 *
 * Zweistufig: Erst wird die GANZE Datei geprüft, dann erst wird geschrieben.
 * Eine unlesbare oder fremde Datei lässt den Spielstand deshalb unberührt –
 * es gibt keinen Zustand „halb importiert".
 *
 * @param {object} state
 * @param {string|object} json
 * @returns {{ok:boolean, uebernommen:object, fehler:string[]}}
 *   ok            – die Datei war brauchbar (einzelne übersprungene Datensätze
 *                   machen sie nicht unbrauchbar, sie stehen in `fehler`)
 *   uebernommen   – { vereine, spieler, neueVereine, neueSpieler, umgezogen }
 *   fehler        – namentliche Meldungen, auch wenn `ok` true ist
 */
export function importStammdaten(state, json) {
  const fehler = [];
  const uebernommen = { vereine: 0, spieler: 0, neueVereine: 0, neueSpieler: 0, umgezogen: 0 };
  const abbruch = (text) => { fehler.push(text); return { ok: false, uebernommen, fehler }; };

  if (!state || !state.clubs || !state.players) {
    return abbruch('Kein Spielstand geladen – es gibt nichts, wohin die Daten könnten.');
  }

  /* --- 1. Datei lesen --------------------------------------------------- */
  let doc;
  if (typeof json === 'string') {
    try { doc = JSON.parse(json); }
    catch (err) { return abbruch('Die Datei ist kein gültiges JSON: ' + (err && err.message)); }
  } else {
    doc = json;
  }
  if (!doc || typeof doc !== 'object') return abbruch('Die Datei enthält keinen Datensatz.');

  // Ein Spielstand hat kein `format`, dafür `clubs` (eine Stammdatendatei hat
  // `vereine`). Ihn an der Versionsnummer scheitern zu lassen, wäre technisch
  // richtig und für den Benutzer nutzlos – er hat schlicht die falsche Datei
  // erwischt, und das soll auch dastehen.
  if (doc.clubs && typeof doc.clubs === 'object') {
    return abbruch('Das ist ein Spielstand, keine Stammdatendatei. ' +
      'Spielstände lädt man im Hauptmenü unter „Spielstand laden".');
  }
  if (doc.format && doc.format !== STAMMDATEN_FORMAT) {
    return abbruch(`Fremdes Dateiformat „${doc.format}". Erwartet wird „${STAMMDATEN_FORMAT}".`);
  }
  const version = Number(doc.version) || 1;
  if (version > STAMMDATEN_VERSION) {
    return abbruch(`Die Datei stammt aus Fassung ${version}, dieses Spiel kennt nur ${STAMMDATEN_VERSION}.`);
  }

  const rohVereine = Array.isArray(doc.vereine) ? doc.vereine : [];
  const rohSpieler = Array.isArray(doc.spieler) ? doc.spieler : [];
  if (!rohVereine.length && !rohSpieler.length) {
    return abbruch('Die Datei enthält weder Vereine noch Spieler.');
  }

  /* --- 2. Alles prüfen, noch nichts schreiben --------------------------- */
  const planV = [];
  const gesehenV = new Set();
  rohVereine.forEach((roh, i) => {
    const kennung = istText(roh && roh.id) ? roh.id.trim() : slugName(alsText(roh && roh.name, 60, ''));
    const erg = vereinPruefen(roh, i + 1, kennung ? state.clubs[kennung] : null);
    if (erg.fehler) { fehler.push(erg.fehler); return; }
    if (gesehenV.has(erg.d.id)) {
      fehler.push(`Verein „${erg.d.name}" (${erg.d.id}) steht doppelt in der Datei – der zweite wurde übergangen.`);
      return;
    }
    gesehenV.add(erg.d.id);
    planV.push(erg.d);
  });

  // Vereine, die es nach dem Import geben wird – der Spielerteil darf sich
  // schon auf sie beziehen, obwohl noch nichts geschrieben ist.
  const kuenftigeVereine = new Set(Object.keys(state.clubs));
  for (const d of planV) kuenftigeVereine.add(d.id);

  const planS = [];
  const gesehenS = new Set();
  rohSpieler.forEach((roh, i) => {
    const vorhanden = istText(roh && roh.id) ? state.players[roh.id.trim()] : null;
    const erg = spielerPruefen(roh, i + 1, vorhanden);
    if (erg.fehler) { fehler.push(erg.fehler); return; }
    if (erg.hinweis) fehler.push(erg.hinweis);
    const d = erg.d;
    if (d.clubId && !kuenftigeVereine.has(d.clubId)) {
      fehler.push(`${d.lastName}: unbekannter Verein „${d.clubId}" – übersprungen.`);
      return;
    }
    if (gesehenS.has(d.id)) {
      fehler.push(`Spieler „${d.lastName}" (${d.id}) steht doppelt in der Datei – der zweite wurde übergangen.`);
      return;
    }
    gesehenS.add(d.id);
    planS.push(d);
  });

  if (!planV.length && !planS.length) {
    fehler.push('Kein einziger Datensatz war brauchbar – der Spielstand wurde nicht angefasst.');
    return { ok: false, uebernommen, fehler };
  }

  /* --- 3. Schreiben ----------------------------------------------------- */
  const rng = createRng(`${state.seed}:stammdaten:${state.tick || 0}`);

  for (const d of planV) {
    let club = state.clubs[d.id];
    if (!club) {
      club = deepClone(d);
      // `leagueId` aus der Datei ist ein Wunsch, keine Tatsache: Die Wahrheit
      // steht in state.leagues (ROADMAP 5.1), und dort trägt sich der Verein
      // hier gerade NICHT ein. Ein neuer Verein mit leagueId 'bl1', der in
      // keiner Ligaliste steht, wäre genau der Widerspruch, den 5.1 beschreibt.
      club.leagueId = null;
      initClubRuntime(club, rng);
      club.tactics = club.tactics || null;
      state.clubs[d.id] = club;
      uebernommen.neueVereine++;
      // Bewusst KEIN Eintrag in state.leagues: Ein Spielplan steht schon,
      // und ein 19. Verein in einer 18er-Liga wäre ein stiller Totalschaden.
      fehler.push(`Verein „${d.name}" ist neu angelegt – er steht in keiner Liga. ` +
        `Ein neuer Spielplan entsteht erst zur nächsten Saison.`);
    } else {
      vereinBefuellen(club, d);
    }
    uebernommen.vereine++;
  }

  for (const d of planS) {
    const alt = state.players[d.id];
    if (!alt) {
      const p = deepClone(d);
      initPlayerRuntime(p, rng);
      state.players[p.id] = p;
      if (p.clubId && state.clubs[p.clubId]) {
        const club = state.clubs[p.clubId];
        club.playerIds = club.playerIds || [];
        if (club.playerIds.indexOf(p.id) < 0) club.playerIds.push(p.id);
      } else {
        p.clubId = null;
        state.freeAgents = state.freeAgents || [];
        if (state.freeAgents.indexOf(p.id) < 0) state.freeAgents.push(p.id);
      }
      uebernommen.neueSpieler++;
    } else {
      const vorher = alt.clubId || null;
      spielerBefuellen(alt, d);
      if (vorher !== d.clubId) {
        const altClub = vorher ? state.clubs[vorher] : null;
        if (altClub && Array.isArray(altClub.playerIds)) {
          const i = altClub.playerIds.indexOf(alt.id);
          if (i >= 0) altClub.playerIds.splice(i, 1);
          ausAufstellungNehmen(altClub, alt.id);
        }
        if (!vorher && Array.isArray(state.freeAgents)) {
          const i = state.freeAgents.indexOf(alt.id);
          if (i >= 0) state.freeAgents.splice(i, 1);
        }
        alt.clubId = d.clubId;
        if (d.clubId && state.clubs[d.clubId]) {
          const neu = state.clubs[d.clubId];
          neu.playerIds = neu.playerIds || [];
          if (neu.playerIds.indexOf(alt.id) < 0) neu.playerIds.push(alt.id);
        } else {
          state.freeAgents = state.freeAgents || [];
          if (state.freeAgents.indexOf(alt.id) < 0) state.freeAgents.push(alt.id);
        }
        uebernommen.umgezogen++;
      }
    }
    uebernommen.spieler++;
  }

  // state.rngState wird bewusst NICHT fortgeschrieben: Der Zufallsstrom des
  // Spiels gehört dem Spiel. Ein Import soll Stammdaten ändern und nicht
  // nebenbei jede künftige Verletzung und jeden künftigen Transfer verschieben.
  return { ok: true, uebernommen, fehler };
}

export { CLUBS_BY_ID, SEASON_DAYS };
