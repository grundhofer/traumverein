/**
 * Wettbewerbsstruktur, Spielplan, Tabellen und Saisonkalender.
 *
 * Zeitrechnung: `dayIndex` 0 = 1. Juli des Saison-Startjahres (siehe core/util.js).
 * Wochentage ergeben sich aus `dayIndex % 7`:
 *   0 = Di, 1 = Mi, 2 = Do, 3 = Fr, 4 = Sa, 5 = So, 6 = Mo.
 * Ligaspieltage liegen daher auf `% 7 === 4` (Samstag, 1. Liga) bzw. `% 7 === 5`
 * (Sonntag, 2. Liga), Pokal- und Europapokalrunden auf Di/Mi/Do.
 *
 * Kein Math.random(), kein Date.now() – aller Zufall kommt aus core/rng.js.
 */

import { createRng } from '../core/rng.js';
import { pad, clamp } from '../core/util.js';

// ---------------------------------------------------------------------------
// Saison-Grundgerüst
// ---------------------------------------------------------------------------

/** Feste Ankerpunkte der Saison (dayIndex). */
export const SAISON_TAGE = {
  saisonStart: 0,               // 1. Juli
  sommerurlaub: [0, 13],        // Mannschaft in Urlaub
  vorbereitungStart: 14,        // Trainingsauftakt
  trainingslagerSommer: [21, 31],
  pokalRunde1: [39, 40],        // 9./10. August
  ligaStart: 46,                // Sa, 16. August
  hinrundeEnde: 172,            // Sa, 20. Dezember
  winterpause: [176, 204],      // 24. Dezember bis 21. Januar
  winterurlaub: [176, 189],
  trainingslagerWinter: [190, 197],
  rueckrundeStart: 207,         // Sa, 24. Januar
  saisonEnde: 319,              // Sa, 16. Mai
  pokalFinale: 326,             // Sa, 23. Mai
  abschlussfeier: 328,          // Mo, 25. Mai
  mitgliederversammlung: 146,   // Mo, 24. November
  transferfenster: {
    sommer: [0, 62],            // bis 1. September
    winter: [184, 215]          // 1. Januar bis 1. Februar
  }
};

/** Erfolgsprämien (zusätzlich zum TV-Geld) je Tabellenplatz, in Euro. */
const BL1_BONI = [
  8000000, 5500000, 4500000, 3800000, 3000000, 2400000, 2000000, 1700000, 1500000,
  1300000, 1100000, 1000000, 900000, 800000, 700000, 600000, 500000, 400000
];
const BL2_BONI = [
  1200000, 900000, 750000, 600000, 500000, 450000, 400000, 350000, 320000,
  300000, 280000, 250000, 220000, 200000, 180000, 150000, 120000, 100000
];

/**
 * Gesamtausschüttung je Platz = TV-Sockel + platzabhängiger TV-Anteil + Erfolgsprämie.
 * Platz 1 steht an Index 0.
 */
function ausschuettung(base, perPlace, boni) {
  const n = boni.length;
  return boni.map((bonus, i) => Math.round(base + perPlace * (n - 1 - i) + bonus));
}

// ---------------------------------------------------------------------------
// Ligen
// ---------------------------------------------------------------------------

export const LEAGUES = {
  bl1: {
    id: 'bl1',
    name: '1. Bundesliga',
    short: 'BL',
    tier: 1,
    clubIds: [
      'bayern', 'dortmund', 'leverkusen', 'leipzig', 'stuttgart', 'frankfurt',
      'gladbach', 'bremen', 'hsv', 'koeln', 'wolfsburg', 'hoffenheim',
      'freiburg', 'mainz', 'augsburg', 'union', 'stpauli', 'heidenheim'
    ],
    promotion: 0,
    relegation: 3,          // Plätze 16–18 steigen direkt ab
    relegationPlayoff: 1,   // Platz 15 spielt Relegation
    europeSpots: { cl: 4, el: 2, conf: 1 },
    tvMoney: { base: 30000000, perPlace: 3200000 },
    prizeMoney: ausschuettung(30000000, 3200000, BL1_BONI),
    matchdays: 34,
    dayShift: 0,            // Spieltag am Samstag
    meisterTitel: 'Deutscher Meister',
    colors: { primary: '#1c4f8f', secondary: '#f2e8cf' }
  },
  bl2: {
    id: 'bl2',
    name: '2. Bundesliga',
    short: '2BL',
    tier: 2,
    clubIds: [
      'schalke', 'hertha', 'duesseldorf', 'hannover', 'kaiserslautern', 'nuernberg',
      'ksc', 'elversberg', 'paderborn', 'darmstadt', 'kiel', 'bochum',
      'braunschweig', 'muenster', 'bielefeld', 'dresden', 'magdeburg', 'fuerth'
    ],
    promotion: 2,           // Plätze 1–2 steigen direkt auf
    promotionPlayoff: 1,    // Platz 3 spielt Relegation
    relegation: 3,          // Plätze 16–18 steigen ab
    europeSpots: { cl: 0, el: 0, conf: 0 },
    tvMoney: { base: 6000000, perPlace: 650000 },
    prizeMoney: ausschuettung(6000000, 650000, BL2_BONI),
    matchdays: 34,
    dayShift: 1,            // Spieltag am Sonntag
    meisterTitel: 'Zweitliga-Meister',
    colors: { primary: '#8b5a2b', secondary: '#e8d9b0' }
  }
};

// Spieltagstermine vorberechnen (reine Funktion, kein Zufall).
LEAGUES.bl1.spieltage = ligaSpieltage(LEAGUES.bl1.matchdays, LEAGUES.bl1.dayShift);
LEAGUES.bl2.spieltage = ligaSpieltage(LEAGUES.bl2.matchdays, LEAGUES.bl2.dayShift);

export const LEAGUE_IDS = ['bl1', 'bl2'];

// ---------------------------------------------------------------------------
// DFB-Pokal
// ---------------------------------------------------------------------------

/**
 * 28 Amateur- und Drittligavertreter, die das Pokalfeld auf 64 Mannschaften
 * auffüllen. Sie besitzen keine Kader – die Match-Engine behandelt sie über
 * `tier`/`reputation` als Underdogs.
 */
export const AMATEUR_CLUBS = [
  { id: 'am_1860', name: 'TSV 1860 München', short: '1860', abbr: 'M60', tier: 3, reputation: 46 },
  { id: 'am_rwessen', name: 'Rot-Weiss Essen', short: 'RW Essen', abbr: 'RWE', tier: 3, reputation: 42 },
  { id: 'am_rostock', name: 'F.C. Hansa Rostock', short: 'Rostock', abbr: 'HRO', tier: 3, reputation: 44 },
  { id: 'am_saarbruecken', name: '1. FC Saarbrücken', short: 'Saarbrücken', abbr: 'FCS', tier: 3, reputation: 40 },
  { id: 'am_aue', name: 'FC Erzgebirge Aue', short: 'Aue', abbr: 'AUE', tier: 3, reputation: 39 },
  { id: 'am_ingolstadt', name: 'FC Ingolstadt 04', short: 'Ingolstadt', abbr: 'FCI', tier: 3, reputation: 38 },
  { id: 'am_mannheim', name: 'SV Waldhof Mannheim', short: 'Waldhof', abbr: 'SVW', tier: 3, reputation: 37 },
  { id: 'am_wiesbaden', name: 'SV Wehen Wiesbaden', short: 'Wiesbaden', abbr: 'SVW', tier: 3, reputation: 36 },
  { id: 'am_regensburg', name: 'SSV Jahn Regensburg', short: 'Regensburg', abbr: 'SSV', tier: 3, reputation: 36 },
  { id: 'am_unterhaching', name: 'SpVgg Unterhaching', short: 'Unterhaching', abbr: 'SPU', tier: 3, reputation: 34 },
  { id: 'am_viktoria', name: 'FC Viktoria Köln', short: 'Viktoria Köln', abbr: 'VIK', tier: 3, reputation: 34 },
  { id: 'am_verl', name: 'SC Verl', short: 'Verl', abbr: 'SCV', tier: 3, reputation: 33 },
  { id: 'am_sandhausen', name: 'SV Sandhausen', short: 'Sandhausen', abbr: 'SVS', tier: 3, reputation: 33 },
  { id: 'am_cottbus', name: 'FC Energie Cottbus', short: 'Cottbus', abbr: 'FCE', tier: 3, reputation: 35 },
  { id: 'am_ulm', name: 'SSV Ulm 1846', short: 'Ulm', abbr: 'ULM', tier: 3, reputation: 33 },
  { id: 'am_aachen', name: 'Alemannia Aachen', short: 'Aachen', abbr: 'AAC', tier: 3, reputation: 35 },
  { id: 'am_havelse', name: 'TSV Havelse', short: 'Havelse', abbr: 'HAV', tier: 3, reputation: 26 },
  { id: 'am_luebeck', name: 'VfB Lübeck', short: 'Lübeck', abbr: 'LUE', tier: 4, reputation: 27 },
  { id: 'am_halle', name: 'Hallescher FC', short: 'Halle', abbr: 'HFC', tier: 4, reputation: 31 },
  { id: 'am_offenbach', name: 'Kickers Offenbach', short: 'Offenbach', abbr: 'OFC', tier: 4, reputation: 32 },
  { id: 'am_bfcdynamo', name: 'BFC Dynamo', short: 'BFC Dynamo', abbr: 'BFC', tier: 4, reputation: 29 },
  { id: 'am_oberhausen', name: 'Rot-Weiß Oberhausen', short: 'Oberhausen', abbr: 'RWO', tier: 4, reputation: 28 },
  { id: 'am_stuttgarterk', name: 'Stuttgarter Kickers', short: 'Stgt. Kickers', abbr: 'SKI', tier: 4, reputation: 28 },
  { id: 'am_chemnitz', name: 'Chemnitzer FC', short: 'Chemnitz', abbr: 'CFC', tier: 4, reputation: 29 },
  { id: 'am_trier', name: 'SV Eintracht Trier', short: 'Trier', abbr: 'TRI', tier: 4, reputation: 24 },
  { id: 'am_homburg', name: 'FC 08 Homburg', short: 'Homburg', abbr: 'HOM', tier: 4, reputation: 25 },
  { id: 'am_oldenburg', name: 'VfB Oldenburg', short: 'Oldenburg', abbr: 'OLD', tier: 4, reputation: 24 },
  { id: 'am_bremersv', name: 'Bremer SV', short: 'Bremer SV', abbr: 'BSV', tier: 5, reputation: 18 }
];

export const CUP = {
  id: 'pokal',
  name: 'DFB-Pokal',
  short: 'Pokal',
  tier: 0,
  teams: 64,
  profis: 36,
  amateure: 28,
  finalOrt: 'Berlin, Olympiastadion',
  siegPraemie: 5000000,
  siegerTitel: 'DFB-Pokalsieger',
  /** Der Pokalsieger erhält einen Europapokal-Startplatz. */
  europaPlatz: 'el',
  rounds: [
    { id: 'r1', name: '1. Runde', short: '1. Rd.', teams: 64, prize: 200000, days: [39, 40], neutral: false },
    { id: 'r2', name: '2. Runde', short: '2. Rd.', teams: 32, prize: 400000, days: [119, 120], neutral: false },
    { id: 'af', name: 'Achtelfinale', short: 'AF', teams: 16, prize: 850000, days: [154, 155], neutral: false },
    { id: 'vf', name: 'Viertelfinale', short: 'VF', teams: 8, prize: 1700000, days: [224, 225], neutral: false },
    { id: 'hf', name: 'Halbfinale', short: 'HF', teams: 4, prize: 3400000, days: [280, 281], neutral: false },
    { id: 'fin', name: 'Finale', short: 'Finale', teams: 2, prize: 2500000, days: [326], neutral: true }
  ],
  amateurClubs: AMATEUR_CLUBS
};

// ---------------------------------------------------------------------------
// Europapokal
// ---------------------------------------------------------------------------

/**
 * Europäische Gegner für die Ligaphase. Ausschließlich für den Europapokal –
 * diese Vereine tauchen nie in Bundesliga oder Pokal auf. `pot` steuert, in
 * welchem Wettbewerb sie gelost werden können.
 */
export const EURO_CLUBS = [
  { id: 'eu_real', name: 'Real Madrid', short: 'Real', abbr: 'RMA', country: 'ES', reputation: 98, pot: ['cl'] },
  { id: 'eu_barca', name: 'FC Barcelona', short: 'Barcelona', abbr: 'FCB', country: 'ES', reputation: 95, pot: ['cl'] },
  { id: 'eu_atletico', name: 'Atlético Madrid', short: 'Atlético', abbr: 'ATM', country: 'ES', reputation: 89, pot: ['cl'] },
  { id: 'eu_sevilla', name: 'FC Sevilla', short: 'Sevilla', abbr: 'SEV', country: 'ES', reputation: 78, pot: ['el'] },
  { id: 'eu_betis', name: 'Betis Sevilla', short: 'Betis', abbr: 'BET', country: 'ES', reputation: 74, pot: ['el', 'conf'] },
  { id: 'eu_villarreal', name: 'FC Villarreal', short: 'Villarreal', abbr: 'VIL', country: 'ES', reputation: 79, pot: ['cl', 'el'] },
  { id: 'eu_city', name: 'Manchester City', short: 'Man City', abbr: 'MCI', country: 'EN', reputation: 96, pot: ['cl'] },
  { id: 'eu_liverpool', name: 'FC Liverpool', short: 'Liverpool', abbr: 'LIV', country: 'EN', reputation: 94, pot: ['cl'] },
  { id: 'eu_arsenal', name: 'FC Arsenal', short: 'Arsenal', abbr: 'ARS', country: 'EN', reputation: 92, pot: ['cl'] },
  { id: 'eu_chelsea', name: 'FC Chelsea', short: 'Chelsea', abbr: 'CHE', country: 'EN', reputation: 88, pot: ['cl', 'el'] },
  { id: 'eu_united', name: 'Manchester United', short: 'Man United', abbr: 'MUN', country: 'EN', reputation: 86, pot: ['cl', 'el'] },
  { id: 'eu_tottenham', name: 'Tottenham Hotspur', short: 'Tottenham', abbr: 'TOT', country: 'EN', reputation: 84, pot: ['cl', 'el'] },
  { id: 'eu_aston', name: 'Aston Villa', short: 'Aston Villa', abbr: 'AVL', country: 'EN', reputation: 80, pot: ['el', 'conf'] },
  { id: 'eu_psg', name: 'Paris Saint-Germain', short: 'Paris SG', abbr: 'PSG', country: 'FR', reputation: 93, pot: ['cl'] },
  { id: 'eu_marseille', name: 'Olympique Marseille', short: 'Marseille', abbr: 'OM', country: 'FR', reputation: 79, pot: ['cl', 'el'] },
  { id: 'eu_monaco', name: 'AS Monaco', short: 'Monaco', abbr: 'ASM', country: 'FR', reputation: 78, pot: ['cl', 'el'] },
  { id: 'eu_lyon', name: 'Olympique Lyon', short: 'Lyon', abbr: 'OL', country: 'FR', reputation: 75, pot: ['el', 'conf'] },
  { id: 'eu_lille', name: 'OSC Lille', short: 'Lille', abbr: 'LIL', country: 'FR', reputation: 73, pot: ['el', 'conf'] },
  { id: 'eu_inter', name: 'Inter Mailand', short: 'Inter', abbr: 'INT', country: 'IT', reputation: 91, pot: ['cl'] },
  { id: 'eu_milan', name: 'AC Mailand', short: 'Milan', abbr: 'ACM', country: 'IT', reputation: 88, pot: ['cl', 'el'] },
  { id: 'eu_juve', name: 'Juventus Turin', short: 'Juventus', abbr: 'JUV', country: 'IT', reputation: 87, pot: ['cl'] },
  { id: 'eu_napoli', name: 'SSC Neapel', short: 'Neapel', abbr: 'NAP', country: 'IT', reputation: 86, pot: ['cl'] },
  { id: 'eu_roma', name: 'AS Rom', short: 'Rom', abbr: 'ROM', country: 'IT', reputation: 82, pot: ['el'] },
  { id: 'eu_atalanta', name: 'Atalanta Bergamo', short: 'Atalanta', abbr: 'ATA', country: 'IT', reputation: 83, pot: ['cl', 'el'] },
  { id: 'eu_lazio', name: 'Lazio Rom', short: 'Lazio', abbr: 'LAZ', country: 'IT', reputation: 78, pot: ['el', 'conf'] },
  { id: 'eu_fiorentina', name: 'AC Florenz', short: 'Florenz', abbr: 'FIO', country: 'IT', reputation: 74, pot: ['conf', 'el'] },
  { id: 'eu_ajax', name: 'Ajax Amsterdam', short: 'Ajax', abbr: 'AJA', country: 'NL', reputation: 80, pot: ['cl', 'el'] },
  { id: 'eu_psv', name: 'PSV Eindhoven', short: 'PSV', abbr: 'PSV', country: 'NL', reputation: 79, pot: ['cl', 'el'] },
  { id: 'eu_feyenoord', name: 'Feyenoord Rotterdam', short: 'Feyenoord', abbr: 'FEY', country: 'NL', reputation: 76, pot: ['cl', 'el'] },
  { id: 'eu_az', name: 'AZ Alkmaar', short: 'AZ', abbr: 'AZA', country: 'NL', reputation: 68, pot: ['conf', 'el'] },
  { id: 'eu_benfica', name: 'Benfica Lissabon', short: 'Benfica', abbr: 'SLB', country: 'PT', reputation: 82, pot: ['cl'] },
  { id: 'eu_porto', name: 'FC Porto', short: 'Porto', abbr: 'FCP', country: 'PT', reputation: 81, pot: ['cl', 'el'] },
  { id: 'eu_sporting', name: 'Sporting Lissabon', short: 'Sporting', abbr: 'SCP', country: 'PT', reputation: 80, pot: ['cl', 'el'] },
  { id: 'eu_braga', name: 'SC Braga', short: 'Braga', abbr: 'BRA', country: 'PT', reputation: 70, pot: ['el', 'conf'] },
  { id: 'eu_galatasaray', name: 'Galatasaray Istanbul', short: 'Galatasaray', abbr: 'GAL', country: 'TR', reputation: 77, pot: ['cl', 'el'] },
  { id: 'eu_fenerbahce', name: 'Fenerbahçe Istanbul', short: 'Fenerbahçe', abbr: 'FEN', country: 'TR', reputation: 76, pot: ['el', 'cl'] },
  { id: 'eu_besiktas', name: 'Beşiktaş Istanbul', short: 'Beşiktaş', abbr: 'BJK', country: 'TR', reputation: 71, pot: ['el', 'conf'] },
  { id: 'eu_salzburg', name: 'FC Red Bull Salzburg', short: 'Salzburg', abbr: 'RBS', country: 'AT', reputation: 72, pot: ['cl', 'el'] },
  { id: 'eu_rapid', name: 'SK Rapid Wien', short: 'Rapid Wien', abbr: 'SKR', country: 'AT', reputation: 63, pot: ['conf', 'el'] },
  { id: 'eu_sturm', name: 'Sturm Graz', short: 'Sturm Graz', abbr: 'STU', country: 'AT', reputation: 65, pot: ['cl', 'el'] },
  { id: 'eu_ybern', name: 'BSC Young Boys', short: 'Young Boys', abbr: 'YB', country: 'CH', reputation: 66, pot: ['cl', 'el'] },
  { id: 'eu_basel', name: 'FC Basel', short: 'Basel', abbr: 'BAS', country: 'CH', reputation: 67, pot: ['el', 'conf'] },
  { id: 'eu_celtic', name: 'Celtic Glasgow', short: 'Celtic', abbr: 'CEL', country: 'SCO', reputation: 71, pot: ['cl', 'el'] },
  { id: 'eu_rangers', name: 'Glasgow Rangers', short: 'Rangers', abbr: 'RAN', country: 'SCO', reputation: 69, pot: ['el', 'conf'] },
  { id: 'eu_bruegge', name: 'FC Brügge', short: 'Brügge', abbr: 'CLB', country: 'BE', reputation: 72, pot: ['cl', 'el'] },
  { id: 'eu_anderlecht', name: 'RSC Anderlecht', short: 'Anderlecht', abbr: 'AND', country: 'BE', reputation: 66, pot: ['el', 'conf'] },
  { id: 'eu_roterstern', name: 'Roter Stern Belgrad', short: 'Roter Stern', abbr: 'CZV', country: 'RS', reputation: 70, pot: ['cl', 'el'] },
  { id: 'eu_zagreb', name: 'Dinamo Zagreb', short: 'Zagreb', abbr: 'DIN', country: 'HR', reputation: 68, pot: ['cl', 'el'] },
  { id: 'eu_slavia', name: 'Slavia Prag', short: 'Slavia', abbr: 'SLA', country: 'CZ', reputation: 67, pot: ['cl', 'el'] },
  { id: 'eu_sparta', name: 'Sparta Prag', short: 'Sparta', abbr: 'SPA', country: 'CZ', reputation: 65, pot: ['el', 'conf'] },
  { id: 'eu_schachtar', name: 'Schachtar Donezk', short: 'Schachtar', abbr: 'SHK', country: 'UA', reputation: 69, pot: ['cl', 'el'] },
  { id: 'eu_kiew', name: 'Dynamo Kiew', short: 'Dynamo Kiew', abbr: 'DKI', country: 'UA', reputation: 64, pot: ['el', 'conf'] },
  { id: 'eu_olympiakos', name: 'Olympiakos Piräus', short: 'Olympiakos', abbr: 'OLY', country: 'GR', reputation: 68, pot: ['cl', 'el'] },
  { id: 'eu_panathinaikos', name: 'Panathinaikos Athen', short: 'Panathinaikos', abbr: 'PAO', country: 'GR', reputation: 63, pot: ['el', 'conf'] },
  { id: 'eu_kopenhagen', name: 'FC Kopenhagen', short: 'Kopenhagen', abbr: 'FCK', country: 'DK', reputation: 66, pot: ['cl', 'el'] },
  { id: 'eu_broendby', name: 'Brøndby IF', short: 'Brøndby', abbr: 'BIF', country: 'DK', reputation: 58, pot: ['conf'] },
  { id: 'eu_malmoe', name: 'Malmö FF', short: 'Malmö', abbr: 'MFF', country: 'SE', reputation: 60, pot: ['el', 'conf'] },
  { id: 'eu_bodoe', name: 'FK Bodø/Glimt', short: 'Bodø/Glimt', abbr: 'BOD', country: 'NO', reputation: 62, pot: ['el', 'conf'] },
  { id: 'eu_legia', name: 'Legia Warschau', short: 'Legia', abbr: 'LEG', country: 'PL', reputation: 61, pot: ['conf', 'el'] },
  { id: 'eu_ferencvaros', name: 'Ferencváros Budapest', short: 'Ferencváros', abbr: 'FTC', country: 'HU', reputation: 60, pot: ['el', 'conf'] },
  { id: 'eu_bratislava', name: 'Slovan Bratislava', short: 'Bratislava', abbr: 'SLB', country: 'SK', reputation: 57, pot: ['conf'] },
  { id: 'eu_maccabi', name: 'Maccabi Tel Aviv', short: 'Maccabi', abbr: 'MTA', country: 'IL', reputation: 58, pot: ['conf', 'el'] },
  { id: 'eu_gent', name: 'KAA Gent', short: 'Gent', abbr: 'GNT', country: 'BE', reputation: 59, pot: ['conf'] },
  { id: 'eu_twente', name: 'FC Twente Enschede', short: 'Twente', abbr: 'TWE', country: 'NL', reputation: 62, pot: ['el', 'conf'] },
  { id: 'eu_bologna', name: 'FC Bologna', short: 'Bologna', abbr: 'BOL', country: 'IT', reputation: 72, pot: ['cl', 'el'] },
  { id: 'eu_bilbao', name: 'Athletic Bilbao', short: 'Bilbao', abbr: 'ATH', country: 'ES', reputation: 78, pot: ['cl', 'el'] }
];

export const EURO = {
  id: 'europa',
  name: 'Europapokal',
  short: 'EC',
  tier: 0,
  /** Ligaphase: acht Spieltage, jeder Teilnehmer 4 Heim- und 4 Auswärtsspiele. */
  leaguePhase: {
    matchdays: 8,
    /** Basistage (immer ein Dienstag). CL spielt Di/Mi, EL und Conference Do. */
    days: [77, 91, 112, 126, 147, 161, 210, 217]
  },
  /** Wettbewerbe unter dem Dach „Europapokal". */
  competitions: {
    cl: {
      id: 'cl', name: 'UEFA Champions League', short: 'CL', teams: 36, dayOffsets: [0, 1],
      minReputation: 66,
      prizeMoney: {
        start: 18600000, sieg: 2100000, remis: 700000, platzPraemie: 275000,
        playoff: 1000000, achtelfinale: 11000000, viertelfinale: 12500000,
        halbfinale: 15000000, finale: 18500000, titel: 6500000
      }
    },
    el: {
      id: 'el', name: 'UEFA Europa League', short: 'EL', teams: 36, dayOffsets: [2],
      minReputation: 56,
      prizeMoney: {
        start: 4310000, sieg: 450000, remis: 150000, platzPraemie: 70000,
        playoff: 300000, achtelfinale: 1750000, viertelfinale: 2500000,
        halbfinale: 4200000, finale: 7000000, titel: 4000000
      }
    },
    conf: {
      id: 'conf', name: 'UEFA Conference League', short: 'UECL', teams: 36, dayOffsets: [2],
      minReputation: 0,
      prizeMoney: {
        start: 3170000, sieg: 400000, remis: 133000, platzPraemie: 40000,
        playoff: 200000, achtelfinale: 800000, viertelfinale: 1300000,
        halbfinale: 2500000, finale: 4000000, titel: 3000000
      }
    }
  },
  /** K.-o.-Runden nach der Ligaphase (Basistage, jeweils Hin- und Rückspiel). */
  knockout: [
    { id: 'po', name: 'Play-off-Runde', short: 'PO', legs: 2, days: [231, 238], teams: 24 },
    { id: 'af', name: 'Achtelfinale', short: 'AF', legs: 2, days: [259, 266], teams: 16 },
    { id: 'vf', name: 'Viertelfinale', short: 'VF', legs: 2, days: [287, 294], teams: 8 },
    { id: 'hf', name: 'Halbfinale', short: 'HF', legs: 2, days: [301, 308], teams: 4 },
    { id: 'fin', name: 'Finale', short: 'Finale', legs: 1, days: [], teams: 2, neutral: true }
  ],
  /** Endspieltermine je Wettbewerb (neutraler Ort). */
  finalDays: { conf: 316, el: 317, cl: 323 },
  clubs: EURO_CLUBS
};

// ---------------------------------------------------------------------------
// Spieltagstermine
// ---------------------------------------------------------------------------

/**
 * Verteilt `count` Termine zwischen `firstDay` und `lastDay` im Wochenrhythmus.
 * Überschüssige Wochen werden als 14-Tage-Lücken (Länderspielpausen) möglichst
 * gleichmäßig eingestreut, sodass der letzte Termin auf `lastDay` fällt.
 */
function spread(count, firstDay, lastDay) {
  if (count <= 0) return [];
  if (count === 1) return [firstDay];
  const intervals = count - 1;
  const wochen = Math.floor((lastDay - firstDay) / 7);
  const pausen = Math.max(0, Math.min(intervals, wochen - intervals));
  const pausenAn = new Set();
  for (let j = 0; j < pausen; j++) {
    pausenAn.add(clamp(Math.round((j + 0.5) * intervals / pausen), 1, intervals));
  }
  const days = [firstDay];
  let d = firstDay;
  for (let i = 1; i <= intervals; i++) {
    d += pausenAn.has(i) ? 14 : 7;
    days.push(d);
  }
  return days;
}

/**
 * Termine aller Ligaspieltage einer Saison.
 * Hinrunde: Mitte August bis kurz vor Weihnachten, Rückrunde: nach der
 * Winterpause bis Mitte Mai. `dayShift` verschiebt die ganze Liga um n Tage
 * (0 = Samstag, 1 = Sonntag).
 */
export function ligaSpieltage(matchdays = 34, dayShift = 0) {
  const hin = Math.ceil(matchdays / 2);
  const rueck = matchdays - hin;
  return [
    ...spread(hin, SAISON_TAGE.ligaStart + dayShift, SAISON_TAGE.hinrundeEnde + dayShift),
    ...spread(rueck, SAISON_TAGE.rueckrundeStart + dayShift, SAISON_TAGE.saisonEnde + dayShift)
  ];
}

// ---------------------------------------------------------------------------
// Spielplan (Doppelrundenturnier)
// ---------------------------------------------------------------------------

/**
 * Berger-/Kreisverfahren für eine einfache Runde mit `n` (geraden) Teilnehmern.
 * Liefert n-1 Runden mit je n/2 Paarungen [heimIndex, gastIndex].
 *
 * Die Heimrechtsvergabe folgt der kanonischen Berger-Tabelle: sie erreicht mit
 * n-2 „Breaks" das nachweisbare Minimum an Wiederholungen desselben Heimrechts;
 * kein Verein hat innerhalb einer Halbserie mehr als zwei gleiche Spielorte
 * hintereinander.
 */
function bergerRounds(n) {
  const m = n - 1;
  const half = n / 2;
  const rounds = [];
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(i);
  for (let r = 0; r < m; r++) {
    const round = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      // Paarung 0 enthält den ruhenden Verein: dessen Heimrecht alterniert je Runde,
      // alle übrigen Paarungen alternieren über den Paarungsindex.
      const tausch = (i === 0) ? (r % 2 === 1) : (i % 2 === 1);
      round.push(tausch ? [b, a] : [a, b]);
    }
    rounds.push(round);
    arr.splice(1, 0, arr.pop());   // Kreisverfahren: arr[0] bleibt stehen
  }
  return rounds;
}

/**
 * Erzeugt den kompletten Spielplan eines Doppelrundenturniers.
 *
 * @param {string[]} clubIds  Teilnehmer (gerade Anzahl; bei ungerader Anzahl gibt es spielfrei)
 * @param {object} opts
 *   - rng           Rng-Instanz (Pflicht für Reproduzierbarkeit; sonst deterministisch abgeleitet)
 *   - competitionId 'bl1' | 'bl2' | ...
 *   - season        Saisonnummer (1-basiert)
 *   - dayShift      Verschiebung aller Spieltage in Tagen (Default aus LEAGUES)
 *   - matchDays     Optionale explizite dayIndex-Liste (überschreibt die Berechnung)
 *   - mirrorShift   Versatz der Rückrunde gegenüber der Hinrunde in Spieltagen.
 *                   1 (Default) senkt die Zahl der Heim-/Auswärtsserien deutlich
 *                   (34 statt 48 Breaks) und verhindert drei gleiche Spielorte
 *                   in Folge. 0 = exakte Spiegelung wie in der echten Bundesliga.
 * @returns {Array} [{ id, competitionId, season, matchday, dayIndex, homeId, awayId, played, result }]
 */
export function generateFixtures(clubIds, opts = {}) {
  const ids = Array.isArray(clubIds) ? clubIds.filter(Boolean) : [];
  if (ids.length < 2) return [];

  const competitionId = opts.competitionId || 'bl1';
  const season = opts.season || 1;
  const liga = LEAGUES[competitionId] || null;
  const rng = opts.rng || createRng(`spielplan:${competitionId}:${season}`);
  const dayShift = opts.dayShift !== undefined ? opts.dayShift : (liga ? liga.dayShift : 0);
  const mirrorShift = opts.mirrorShift !== undefined ? opts.mirrorShift : 1;

  const slots = rng.shuffle(ids);
  if (slots.length % 2 === 1) slots.push(null);   // spielfrei-Platzhalter
  const n = slots.length;

  const hinrunde = bergerRounds(n);
  const m = hinrunde.length;
  const runden = hinrunde.slice();
  for (let r = 0; r < m; r++) {
    const quelle = hinrunde[(r + mirrorShift % m + m) % m];
    runden.push(quelle.map(([h, a]) => [a, h]));
  }

  const tage = Array.isArray(opts.matchDays) && opts.matchDays.length
    ? opts.matchDays
    : ligaSpieltage(runden.length, dayShift);

  const fixtures = [];
  runden.forEach((runde, ri) => {
    const matchday = ri + 1;
    const dayIndex = ri < tage.length
      ? tage[ri]
      : tage[tage.length - 1] + 7 * (ri - tage.length + 1);
    for (const [hi, ai] of runde) {
      const homeId = slots[hi];
      const awayId = slots[ai];
      if (!homeId || !awayId) continue;   // spielfrei
      fixtures.push({
        id: `${competitionId}_s${season}_st${pad(matchday, 2)}_${homeId}_${awayId}`,
        competitionId,
        season,
        matchday,
        dayIndex,
        homeId,
        awayId,
        played: false,
        result: null
      });
    }
  });
  return fixtures;
}

// ---------------------------------------------------------------------------
// DFB-Pokal-Auslosung
// ---------------------------------------------------------------------------

function tierOf(id) {
  if (LEAGUES.bl1.clubIds.includes(id)) return 1;
  if (LEAGUES.bl2.clubIds.includes(id)) return 2;
  const am = AMATEUR_CLUBS.find(c => c.id === id);
  return am ? am.tier : 3;
}

/** Normalisiert Vereins-IDs oder Vereinsobjekte auf { id, name, tier }. */
function toEntry(c) {
  if (!c) return null;
  if (typeof c === 'string') return { id: c, name: c, tier: tierOf(c) };
  const tier = c.tier !== undefined ? c.tier
    : c.leagueId === 'bl1' ? 1
      : c.leagueId === 'bl2' ? 2
        : tierOf(c.id);
  return { id: c.id, name: c.name || c.id, tier };
}

/**
 * Baut das komplette Pokalfeld (36 Profivereine + 28 Amateurvertreter).
 * `clubs` darf IDs oder Club-Objekte enthalten.
 */
export function cupParticipants(clubs) {
  const profis = (clubs && clubs.length
    ? clubs
    : [...LEAGUES.bl1.clubIds, ...LEAGUES.bl2.clubIds]).map(toEntry).filter(Boolean);
  return [...profis, ...AMATEUR_CLUBS.map(toEntry)];
}

/** Prämie für das Erreichen einer Pokalrunde (Finalsieg extra über CUP.siegPraemie). */
export function cupPrizeFor(roundId, gewonnen = false) {
  const rd = CUP.rounds.find(r => r.id === roundId);
  if (!rd) return 0;
  return rd.prize + (rd.id === 'fin' && gewonnen ? CUP.siegPraemie : 0);
}

/**
 * Losung einer DFB-Pokal-Runde.
 *
 * @param {object} rng             Rng-Instanz
 * @param {Array}  clubs           Alle möglichen Teilnehmer (IDs oder Club-Objekte)
 * @param {number|string} round    Rundenindex (0-basiert) oder Runden-ID ('r1','af',…)
 * @param {string[]} previousWinners  Sieger der Vorrunde; leer/undefined => 1. Runde
 * @param {number} season          Saisonnummer (nur für die Fixture-IDs)
 * @returns {Array} Spielpaarungen im Fixture-Format (zusätzlich: round, roundName,
 *                  neutral, freilos)
 *
 * Heimrecht: In der 1. und 2. Runde spielt stets der klassentiefere Verein zu
 * Hause – Zweitligisten sind damit gegen Bundesligisten heimrechtsbevorzugt.
 * Ab dem Achtelfinale wird das Heimrecht ausgelost; nur bei mindestens zwei
 * Klassen Unterschied behält der Außenseiter sein Heimrecht. Das Finale findet
 * auf neutralem Boden in Berlin statt.
 */
export function generateCupDraw(rng, clubs, round = 0, previousWinners = null, season = 1) {
  const idx = typeof round === 'number'
    ? round
    : Math.max(0, CUP.rounds.findIndex(r => r.id === round || r.name === round));
  const rd = CUP.rounds[clamp(idx, 0, CUP.rounds.length - 1)];

  const alle = (Array.isArray(clubs) ? clubs : []).map(toEntry).filter(Boolean);
  const byId = new Map(alle.map(e => [e.id, e]));

  let feld;
  if (Array.isArray(previousWinners) && previousWinners.length) {
    feld = previousWinners.map(id => byId.get(id) || toEntry(id)).filter(Boolean);
  } else {
    feld = alle.length ? alle : cupParticipants(null);
  }
  if (feld.length < 2) return [];

  const gemischt = rng.shuffle(feld);
  const paare = [];

  if (idx <= 1) {
    // Zwei Töpfe: Profis (Liga 1+2) gegen Amateure – Amateur hat Heimrecht.
    const profis = gemischt.filter(e => e.tier <= 2);
    const amateure = gemischt.filter(e => e.tier > 2);
    const k = Math.min(profis.length, amateure.length);
    for (let i = 0; i < k; i++) paare.push([amateure[i], profis[i]]);
    const rest = profis.slice(k).concat(amateure.slice(k));
    for (let i = 0; i + 1 < rest.length; i += 2) paare.push(heimrecht(rest[i], rest[i + 1], rng, true));
    if (rest.length % 2 === 1) paare.push([rest[rest.length - 1], null]);   // Freilos
  } else {
    for (let i = 0; i + 1 < gemischt.length; i += 2) {
      paare.push(heimrecht(gemischt[i], gemischt[i + 1], rng, false));
    }
    if (gemischt.length % 2 === 1) paare.push([gemischt[gemischt.length - 1], null]);
  }

  return paare.map((paar, i) => {
    const [heim, gast] = paar;
    const dayIndex = rd.days[i % rd.days.length];
    if (!gast) {
      return {
        id: `pokal_s${season}_${rd.id}_${heim.id}_freilos`,
        competitionId: CUP.id,
        season,
        round: rd.id,
        roundName: rd.name,
        matchday: idx + 1,
        dayIndex,
        homeId: heim.id,
        awayId: null,
        neutral: false,
        freilos: true,
        played: true,
        result: null
      };
    }
    return {
      id: `pokal_s${season}_${rd.id}_${heim.id}_${gast.id}`,
      competitionId: CUP.id,
      season,
      round: rd.id,
      roundName: rd.name,
      matchday: idx + 1,
      dayIndex: rd.neutral ? rd.days[0] : dayIndex,
      homeId: heim.id,
      awayId: gast.id,
      neutral: !!rd.neutral,
      freilos: false,
      played: false,
      result: null
    };
  });
}

/** Ermittelt Heim-/Gastverein nach Klassenunterschied bzw. Los. */
function heimrecht(a, b, rng, unterklassigZuerst) {
  const diff = a.tier - b.tier;
  const schwelle = unterklassigZuerst ? 1 : 2;
  if (diff >= schwelle) return [a, b];
  if (-diff >= schwelle) return [b, a];
  return rng.chance(0.5) ? [a, b] : [b, a];
}

// ---------------------------------------------------------------------------
// Europapokal
// ---------------------------------------------------------------------------

function normalisiereTeilnehmer(participants) {
  const out = { cl: [], el: [], conf: [] };
  if (Array.isArray(participants)) {
    for (const p of participants) {
      if (typeof p === 'string') { out.cl.push(p); continue; }
      if (!p) continue;
      const wb = p.competition || p.wettbewerb || p.competitionId || 'cl';
      const id = p.clubId || p.id;
      if (id && out[wb]) out[wb].push(id);
      else if (id) out.cl.push(id);
    }
  } else if (participants && typeof participants === 'object') {
    for (const k of ['cl', 'el', 'conf']) {
      if (Array.isArray(participants[k])) out[k] = participants[k].filter(Boolean).slice();
    }
  }
  return out;
}

/**
 * Erzeugt den Europapokal-Spielplan einer Saison (Ligaphase mit acht Spieltagen).
 *
 * Simuliert werden nur Partien mit deutscher Beteiligung – jeder Teilnehmer
 * erhält acht verschiedene europäische Gegner, davon vier Heim- und vier
 * Auswärtsspiele im Wechsel.
 *
 * @param {object} rng
 * @param {object|Array} participants  { cl:[ids], el:[ids], conf:[ids] } oder
 *                                     [{ clubId, competition }]
 * @param {number} season
 * @returns {{ season, participants, fixtures, opponents, knockout, finals }}
 */
export function generateEuropeSchedule(rng, participants, season = 1) {
  const r = rng || createRng(`europa:${season}`);
  const teilnehmer = normalisiereTeilnehmer(participants);
  const fixtures = [];
  const opponents = {};
  const belegt = EURO.leaguePhase.days.map(() => new Set());

  for (const wbId of ['cl', 'el', 'conf']) {
    const wb = EURO.competitions[wbId];
    const pool = EURO_CLUBS.filter(c => c.pot.includes(wbId));
    if (!pool.length) continue;

    for (const clubId of teilnehmer[wbId]) {
      const auswahl = r.shuffle(pool);
      const genommen = new Set();
      const gegner = [];
      for (let md = 0; md < EURO.leaguePhase.matchdays; md++) {
        let kandidat = auswahl.find(c => !genommen.has(c.id) && !belegt[md].has(c.id));
        if (!kandidat) kandidat = auswahl.find(c => !genommen.has(c.id));
        if (!kandidat) kandidat = auswahl[md % auswahl.length];
        genommen.add(kandidat.id);
        belegt[md].add(kandidat.id);
        gegner.push(kandidat);
      }
      opponents[clubId] = gegner.map(g => g.id);

      const startetDaheim = r.chance(0.5);
      for (let md = 0; md < gegner.length; md++) {
        const daheim = (md % 2 === 0) ? startetDaheim : !startetDaheim;
        const homeId = daheim ? clubId : gegner[md].id;
        const awayId = daheim ? gegner[md].id : clubId;
        const basis = EURO.leaguePhase.days[md];
        const offset = wb.dayOffsets.length > 1 ? r.pick(wb.dayOffsets) : wb.dayOffsets[0];
        fixtures.push({
          id: `${wbId}_s${season}_st${pad(md + 1, 2)}_${homeId}_${awayId}`,
          competitionId: wbId,
          season,
          matchday: md + 1,
          dayIndex: basis + offset,
          homeId,
          awayId,
          played: false,
          result: null
        });
      }
    }
  }

  const finals = {};
  for (const k of ['cl', 'el', 'conf']) finals[k] = EURO.finalDays[k];

  return { season, participants: teilnehmer, fixtures, opponents, knockout: EURO.knockout, finals };
}

// ---------------------------------------------------------------------------
// Tabelle
// ---------------------------------------------------------------------------

/** Liest das Ergebnis eines Spiels tolerant aus. -> [heimTore, gastTore] | null */
function toreAus(fixture) {
  const res = fixture && fixture.result;
  if (!res) return null;
  if (Array.isArray(res) && res.length >= 2) return [res[0], res[1]];
  if (Array.isArray(res.score) && res.score.length >= 2) return [res.score[0], res.score[1]];
  if (typeof res.home === 'number' && typeof res.away === 'number') return [res.home, res.away];
  if (typeof res.homeGoals === 'number' && typeof res.awayGoals === 'number') return [res.homeGoals, res.awayGoals];
  if (typeof res.heim === 'number' && typeof res.gast === 'number') return [res.heim, res.gast];
  return null;
}

/** Mini-Tabelle für den direkten Vergleich innerhalb einer punktgleichen Gruppe. */
function direkterVergleich(clubIds, fixtures, pSieg, pRemis) {
  const menge = new Set(clubIds);
  const t = new Map(clubIds.map(id => [id, { punkte: 0, diff: 0, auswaertstore: 0 }]));
  for (const f of fixtures) {
    if (!menge.has(f.homeId) || !menge.has(f.awayId)) continue;
    const tore = toreAus(f);
    if (!tore) continue;
    const [h, a] = tore;
    const th = t.get(f.homeId);
    const ta = t.get(f.awayId);
    th.diff += h - a;
    ta.diff += a - h;
    ta.auswaertstore += a;
    if (h > a) th.punkte += pSieg;
    else if (h < a) ta.punkte += pSieg;
    else { th.punkte += pRemis; ta.punkte += pRemis; }
  }
  return t;
}

/**
 * Berechnet die Tabelle aus gespielten Partien.
 *
 * Sortierung: Punkte, Tordifferenz, erzielte Tore, direkter Vergleich
 * (Punkte, Tordifferenz, Auswärtstore untereinander). Bleibt es gleich,
 * entscheidet die Reihenfolge in `clubIds`.
 *
 * @param {Array} fixtures
 * @param {string[]} clubIds
 * @param {object} opts  { competitionId, upTo (Spieltag), pointsWin, pointsDraw,
 *                         formLength, deductions:{clubId:punkte} }
 * @returns {Array} [{ clubId, spiele, s, u, n, tore, gegentore, diff, punkte, platz, form }]
 */
export function computeTable(fixtures, clubIds, opts = {}) {
  const pSieg = opts.pointsWin !== undefined ? opts.pointsWin : 3;
  const pRemis = opts.pointsDraw !== undefined ? opts.pointsDraw : 1;
  const formLen = opts.formLength !== undefined ? opts.formLength : 5;
  const ids = (clubIds || []).slice();
  const reihenfolge = new Map(ids.map((id, i) => [id, i]));

  const zeilen = ids.map(id => ({
    clubId: id, spiele: 0, s: 0, u: 0, n: 0,
    tore: 0, gegentore: 0, diff: 0, punkte: 0, platz: 0, form: []
  }));
  const byId = new Map(zeilen.map(z => [z.clubId, z]));

  const relevant = (fixtures || []).filter(f =>
    f && f.played && byId.has(f.homeId) && byId.has(f.awayId) &&
    (!opts.competitionId || f.competitionId === opts.competitionId) &&
    (opts.upTo === undefined || f.matchday <= opts.upTo) &&
    toreAus(f) !== null
  );

  const chronologisch = relevant.slice().sort((a, b) =>
    (a.dayIndex - b.dayIndex) || (a.matchday - b.matchday));

  const formAlle = new Map(ids.map(id => [id, []]));
  for (const f of chronologisch) {
    const [h, a] = toreAus(f);
    const zh = byId.get(f.homeId);
    const za = byId.get(f.awayId);
    zh.spiele++; za.spiele++;
    zh.tore += h; zh.gegentore += a;
    za.tore += a; za.gegentore += h;
    if (h > a) {
      zh.s++; za.n++; zh.punkte += pSieg;
      formAlle.get(f.homeId).push('S'); formAlle.get(f.awayId).push('N');
    } else if (h < a) {
      za.s++; zh.n++; za.punkte += pSieg;
      formAlle.get(f.homeId).push('N'); formAlle.get(f.awayId).push('S');
    } else {
      zh.u++; za.u++; zh.punkte += pRemis; za.punkte += pRemis;
      formAlle.get(f.homeId).push('U'); formAlle.get(f.awayId).push('U');
    }
  }

  for (const z of zeilen) {
    if (opts.deductions && opts.deductions[z.clubId]) z.punkte -= opts.deductions[z.clubId];
    z.diff = z.tore - z.gegentore;
    const alle = formAlle.get(z.clubId) || [];
    z.form = formLen > 0 ? alle.slice(Math.max(0, alle.length - formLen)) : [];
  }

  const sortiert = zeilen.slice().sort((a, b) =>
    (b.punkte - a.punkte) || (b.diff - a.diff) || (b.tore - a.tore) ||
    (reihenfolge.get(a.clubId) - reihenfolge.get(b.clubId)));

  // Punkt-, Differenz- und Torgleichheit über den direkten Vergleich auflösen.
  let i = 0;
  while (i < sortiert.length) {
    let j = i + 1;
    while (j < sortiert.length &&
      sortiert[j].punkte === sortiert[i].punkte &&
      sortiert[j].diff === sortiert[i].diff &&
      sortiert[j].tore === sortiert[i].tore) j++;
    if (j - i > 1) {
      const gruppe = sortiert.slice(i, j);
      const mini = direkterVergleich(gruppe.map(z => z.clubId), relevant, pSieg, pRemis);
      gruppe.sort((a, b) => {
        const ma = mini.get(a.clubId);
        const mb = mini.get(b.clubId);
        return (mb.punkte - ma.punkte) || (mb.diff - ma.diff) ||
          (mb.auswaertstore - ma.auswaertstore) ||
          (reihenfolge.get(a.clubId) - reihenfolge.get(b.clubId));
      });
      for (let k = i; k < j; k++) sortiert[k] = gruppe[k - i];
    }
    i = j;
  }

  sortiert.forEach((z, k) => { z.platz = k + 1; });
  return sortiert;
}

// ---------------------------------------------------------------------------
// Saisonkalender
// ---------------------------------------------------------------------------

const KALENDER_TYP = {
  bl1: 'liga', bl2: 'liga', pokal: 'pokal',
  cl: 'europa', el: 'europa', conf: 'europa', europa: 'europa'
};

function wettbewerbName(competitionId) {
  if (LEAGUES[competitionId]) return LEAGUES[competitionId].name;
  if (competitionId === CUP.id) return CUP.name;
  if (EURO.competitions[competitionId]) return EURO.competitions[competitionId].name;
  return EURO.name;
}

/**
 * Baut den Terminkalender einer Saison.
 *
 * @param {number} season
 * @param {Array|object} fixtures  Alle Spiele (Liga, Pokal, Europapokal) – Array
 *                                 oder Objekt mit Arrays als Werten.
 * @returns {object} { [dayIndex]: [ Eintrag, … ] }
 *
 * Eintragstypen: 'liga' | 'pokal' | 'europa' | 'training' | 'transferfenster' |
 * 'winterpause' | 'urlaub' | 'termin'. ('termin' fasst Mitgliederversammlung,
 * Saisonabschlussfeier und Länderspielpausen zusammen.)
 */
export function seasonCalendar(season = 1, fixtures = []) {
  const cal = {};
  const add = (day, eintrag) => {
    const d = Math.round(day);
    if (d < 0 || d >= 365) return;
    (cal[d] || (cal[d] = [])).push(eintrag);
  };

  const liste = Array.isArray(fixtures)
    ? fixtures
    : Object.keys(fixtures || {}).reduce((acc, k) => acc.concat(fixtures[k] || []), []);

  // --- Spieltage --------------------------------------------------------
  const gruppen = new Map();
  const spieltagTage = new Set();
  for (const f of liste) {
    if (!f || typeof f.dayIndex !== 'number') continue;
    const key = `${f.dayIndex}|${f.competitionId}|${f.matchday || 0}|${f.round || ''}`;
    if (!gruppen.has(key)) gruppen.set(key, { fixture: f, ids: [] });
    gruppen.get(key).ids.push(f.id);
    spieltagTage.add(f.dayIndex);
  }
  for (const { fixture: f, ids } of gruppen.values()) {
    const typ = KALENDER_TYP[f.competitionId] || 'liga';
    const name = wettbewerbName(f.competitionId);
    const titel = f.roundName
      ? `${name} – ${f.roundName}`
      : `${name} – ${f.matchday}. Spieltag`;
    add(f.dayIndex, {
      type: typ,
      competitionId: f.competitionId,
      matchday: f.matchday || null,
      round: f.round || null,
      title: titel,
      fixtureIds: ids
    });
  }

  // --- Transferfenster --------------------------------------------------
  const fenster = [
    { phase: 'sommer', von: SAISON_TAGE.transferfenster.sommer[0], bis: SAISON_TAGE.transferfenster.sommer[1] },
    { phase: 'winter', von: SAISON_TAGE.transferfenster.winter[0], bis: SAISON_TAGE.transferfenster.winter[1] }
  ];
  for (const f of fenster) {
    for (let d = f.von; d <= f.bis; d++) {
      add(d, {
        type: 'transferfenster',
        phase: f.phase,
        open: true,
        closes: d === f.bis,
        title: d === f.bis
          ? (f.phase === 'sommer' ? 'Letzter Tag der Wechselfrist' : 'Letzter Tag der Winter-Wechselfrist')
          : (f.phase === 'sommer' ? 'Transferfenster geöffnet' : 'Winter-Transferfenster geöffnet')
      });
    }
  }

  // --- Winterpause & Urlaub --------------------------------------------
  for (let d = SAISON_TAGE.winterpause[0]; d <= SAISON_TAGE.winterpause[1]; d++) {
    add(d, { type: 'winterpause', title: 'Winterpause' });
  }
  const urlaube = [
    { von: SAISON_TAGE.sommerurlaub[0], bis: SAISON_TAGE.sommerurlaub[1], titel: 'Sommerpause – Mannschaft im Urlaub' },
    { von: SAISON_TAGE.winterurlaub[0], bis: SAISON_TAGE.winterurlaub[1], titel: 'Weihnachtsurlaub' },
    { von: SAISON_TAGE.abschlussfeier + 1, bis: 364, titel: 'Saisonende – Mannschaft im Urlaub' }
  ];
  const urlaubstage = new Set();
  for (const u of urlaube) {
    for (let d = u.von; d <= u.bis; d++) {
      urlaubstage.add(d);
      add(d, { type: 'urlaub', title: u.titel });
    }
  }

  // --- Trainingslager ---------------------------------------------------
  const lager = [
    { von: SAISON_TAGE.trainingslagerSommer[0], bis: SAISON_TAGE.trainingslagerSommer[1], titel: 'Trainingslager (Sommer)' },
    { von: SAISON_TAGE.trainingslagerWinter[0], bis: SAISON_TAGE.trainingslagerWinter[1], titel: 'Trainingslager (Winter)' }
  ];
  const lagertage = new Set();
  for (const l of lager) {
    for (let d = l.von; d <= l.bis; d++) {
      lagertage.add(d);
      add(d, { type: 'training', kind: 'trainingslager', title: l.titel });
    }
  }

  // --- Tägliches Training ----------------------------------------------
  for (let d = SAISON_TAGE.vorbereitungStart; d <= SAISON_TAGE.abschlussfeier; d++) {
    if (urlaubstage.has(d) || lagertage.has(d) || spieltagTage.has(d)) continue;
    const wochentag = d % 7;                 // 0=Di … 6=Mo
    if (wochentag === 4 || wochentag === 5) continue;   // Sa/So trainingsfrei
    add(d, { type: 'training', kind: 'einheit', title: 'Training' });
  }

  // --- Länderspielpausen (aus den Lücken im Ligaspielplan) --------------
  const ligatage = LEAGUES.bl1.spieltage;
  for (let k = 1; k < ligatage.length; k++) {
    const luecke = ligatage[k] - ligatage[k - 1];
    if (luecke >= 14 && ligatage[k] < SAISON_TAGE.hinrundeEnde + 1) {
      add(ligatage[k - 1] + 7, { type: 'termin', kind: 'laenderspielpause', title: 'Länderspielpause' });
    }
  }

  // --- Feste Vereinstermine --------------------------------------------
  add(SAISON_TAGE.vorbereitungStart, { type: 'termin', kind: 'trainingsauftakt', title: 'Trainingsauftakt' });
  add(SAISON_TAGE.mitgliederversammlung, {
    type: 'termin', kind: 'mitgliederversammlung',
    title: 'Mitgliederversammlung', text: 'Der Vorstand stellt sich den Fragen der Mitglieder.'
  });
  add(SAISON_TAGE.abschlussfeier, {
    type: 'termin', kind: 'saisonabschluss',
    title: 'Saisonabschlussfeier', text: 'Bankett im Vereinsheim – die Saison wird begossen.'
  });

  return cal;
}

// ---------------------------------------------------------------------------
// Geld & Qualifikation
// ---------------------------------------------------------------------------

/**
 * Gesamte Saisonausschüttung einer Liga für einen Tabellenplatz in Euro
 * (TV-Geld inklusive Platzierungsprämie). Meister der 1. Bundesliga ≈ 92 Mio,
 * Tabellenletzter ≈ 30 Mio; 2. Bundesliga ≈ 18 bis 6 Mio.
 */
export function prizeMoneyFor(leagueId, place) {
  const liga = LEAGUES[leagueId];
  if (!liga) return 0;
  const p = clamp(Math.round(place), 1, liga.prizeMoney.length);
  return liga.prizeMoney[p - 1];
}

/**
 * Sportliche Konsequenz eines Tabellenplatzes.
 * -> 'meister' | 'cl' | 'el' | 'conf' | 'aufstieg' | 'relegation' | 'abstieg' | null
 * ('aufstieg' gibt es nur in der 2. Bundesliga für Platz 2.)
 */
export function qualificationFor(leagueId, place) {
  const liga = LEAGUES[leagueId];
  if (!liga) return null;
  const n = liga.clubIds.length;
  const p = Math.round(place);
  if (!(p >= 1 && p <= n)) return null;

  if (liga.tier === 1) {
    const cl = liga.europeSpots.cl || 0;
    const el = liga.europeSpots.el || 0;
    const conf = liga.europeSpots.conf || 0;
    if (p === 1) return 'meister';
    if (p <= cl) return 'cl';
    if (p <= cl + el) return 'el';
    if (p <= cl + el + conf) return 'conf';
    if (p > n - liga.relegation) return 'abstieg';
    if (p > n - liga.relegation - (liga.relegationPlayoff || 0)) return 'relegation';
    return null;
  }

  if (p === 1) return 'meister';
  if (p <= (liga.promotion || 0)) return 'aufstieg';
  if (p <= (liga.promotion || 0) + (liga.promotionPlayoff || 0)) return 'relegation';
  if (p > n - liga.relegation) return 'abstieg';
  return null;
}

/** Ist an diesem Tag das Transferfenster geöffnet? */
export function isTransferWindowOpen(dayIndex) {
  const s = SAISON_TAGE.transferfenster.sommer;
  const w = SAISON_TAGE.transferfenster.winter;
  return (dayIndex >= s[0] && dayIndex <= s[1]) || (dayIndex >= w[0] && dayIndex <= w[1]);
}

/** Liga-ID zu einer Vereins-ID ('bl1' | 'bl2' | null). */
export function leagueOfClub(clubId) {
  for (const id of LEAGUE_IDS) if (LEAGUES[id].clubIds.includes(clubId)) return id;
  return null;
}
