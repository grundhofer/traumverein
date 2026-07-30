/** Globale Konstanten – von allen Schichten benutzt. */

export const GAME_TITLE = 'TRAUMVEREIN';
export const GAME_SUBTITLE = 'Der Fußballmanager';
/**
 * Spielstandformat.
 *   1  Urfassung.
 *   2  `state.leagues` ist die Wahrheit über die Ligazugehörigkeit
 *      (Roadmap-Stufe 1). Ältere Stände hebt state.js:migrate() an.
 *   3  Der Europapokal (Roadmap-Stufe 3): die 66 Vereine aus EURO_CLUBS stehen
 *      in `state.clubs`, `state.europa` führt Feld, Runden und Prämien.
 *   4  Die Spielstandbremse (ROADMAP 8.1): Vergangenheit wird beim
 *      Saisonwechsel verdichtet statt mitgeschleppt – zurückgetretene Spieler
 *      auf die Felder der Ruhmeshalle, Protokoll- und Zwischenspeicherlisten
 *      auf ihr Lesefenster. state.js:verdichteVergangenheit() macht die Arbeit,
 *      state.js:migrate() holt ältere Stände einmalig nach.
 */
export const SAVE_VERSION = 4;
export const SEASON_DAYS = 365;
export const START_YEAR = 2025;

export const POSITIONS = ['TW', 'IV', 'LV', 'RV', 'DM', 'ZM', 'LM', 'RM', 'OM', 'LA', 'RA', 'ST'];

export const POSITION_NAMES = {
  TW: 'Torwart', IV: 'Innenverteidiger', LV: 'Linksverteidiger', RV: 'Rechtsverteidiger',
  DM: 'Defensives Mittelfeld', ZM: 'Zentrales Mittelfeld', LM: 'Linkes Mittelfeld',
  RM: 'Rechtes Mittelfeld', OM: 'Offensives Mittelfeld', LA: 'Linksaußen',
  RA: 'Rechtsaußen', ST: 'Stürmer'
};

export const POSITION_GROUP = {
  TW: 'TW', IV: 'ABW', LV: 'ABW', RV: 'ABW',
  DM: 'MIT', ZM: 'MIT', LM: 'MIT', RM: 'MIT', OM: 'MIT',
  LA: 'STU', RA: 'STU', ST: 'STU'
};

export const GROUP_NAMES = { TW: 'Tor', ABW: 'Abwehr', MIT: 'Mittelfeld', STU: 'Sturm' };

/** Positions-Verwandtschaft: 1.0 = identisch, 0 = völlig fremd. Basis für positionPenalty(). */
export const POSITION_AFFINITY = {
  TW: { TW: 1 },
  IV: { IV: 1, LV: .72, RV: .72, DM: .74, ZM: .55 },
  LV: { LV: 1, RV: .82, IV: .72, LM: .78, LA: .62, DM: .5 },
  RV: { RV: 1, LV: .82, IV: .72, RM: .78, RA: .62, DM: .5 },
  DM: { DM: 1, ZM: .88, IV: .74, LM: .6, RM: .6, OM: .58 },
  ZM: { ZM: 1, DM: .88, OM: .84, LM: .74, RM: .74, IV: .5 },
  LM: { LM: 1, RM: .8, LA: .86, ZM: .74, LV: .78, OM: .7 },
  RM: { RM: 1, LM: .8, RA: .86, ZM: .74, RV: .78, OM: .7 },
  OM: { OM: 1, ZM: .84, LA: .76, RA: .76, ST: .74, LM: .7, RM: .7 },
  LA: { LA: 1, RA: .84, LM: .86, ST: .72, OM: .76 },
  RA: { RA: 1, LA: .84, RM: .86, ST: .72, OM: .76 },
  ST: { ST: 1, LA: .72, RA: .72, OM: .74 }
};

export const ATTRIBUTES = [
  'schuss', 'technik', 'passspiel', 'dribbling', 'kopfball', 'standards',
  'tempo', 'ausdauer', 'koerper', 'sprungkraft',
  'uebersicht', 'positionsspiel', 'zweikampf', 'aggressivitaet', 'nervenstaerke', 'fuehrung',
  'reflexe', 'stellungsspiel', 'strafraumbeherrschung', 'abschlag'
];

export const ATTRIBUTE_NAMES = {
  schuss: 'Schuss', technik: 'Technik', passspiel: 'Passspiel', dribbling: 'Dribbling',
  kopfball: 'Kopfball', standards: 'Standards', tempo: 'Tempo', ausdauer: 'Ausdauer',
  koerper: 'Körperlichkeit', sprungkraft: 'Sprungkraft', uebersicht: 'Übersicht',
  positionsspiel: 'Positionsspiel', zweikampf: 'Zweikampf', aggressivitaet: 'Aggressivität',
  nervenstaerke: 'Nervenstärke', fuehrung: 'Führung', reflexe: 'Reflexe',
  stellungsspiel: 'Stellungsspiel', strafraumbeherrschung: 'Strafraum', abschlag: 'Abschlag'
};

export const ATTRIBUTE_GROUPS = {
  Technik: ['schuss', 'technik', 'passspiel', 'dribbling', 'kopfball', 'standards'],
  Physis: ['tempo', 'ausdauer', 'koerper', 'sprungkraft'],
  Mental: ['uebersicht', 'positionsspiel', 'zweikampf', 'aggressivitaet', 'nervenstaerke', 'fuehrung'],
  Torwart: ['reflexe', 'stellungsspiel', 'strafraumbeherrschung', 'abschlag']
};

export const KEEPER_ATTRIBUTES = ATTRIBUTE_GROUPS.Torwart;

/** Positionsgewichte für playerOverall(). Summe je Position = 1.0 (wird normalisiert). */
export const POSITION_WEIGHTS = {
  TW: { reflexe: .26, stellungsspiel: .2, strafraumbeherrschung: .16, abschlag: .09, nervenstaerke: .11, positionsspiel: .07, koerper: .06, sprungkraft: .05 },
  IV: { zweikampf: .2, kopfball: .15, positionsspiel: .16, koerper: .13, uebersicht: .07, tempo: .09, passspiel: .08, aggressivitaet: .07, sprungkraft: .05 },
  LV: { tempo: .16, zweikampf: .16, ausdauer: .13, passspiel: .12, positionsspiel: .12, dribbling: .09, koerper: .08, technik: .08, kopfball: .06 },
  RV: { tempo: .16, zweikampf: .16, ausdauer: .13, passspiel: .12, positionsspiel: .12, dribbling: .09, koerper: .08, technik: .08, kopfball: .06 },
  DM: { zweikampf: .19, positionsspiel: .17, passspiel: .16, uebersicht: .13, ausdauer: .11, koerper: .09, technik: .08, aggressivitaet: .07 },
  ZM: { passspiel: .19, uebersicht: .17, technik: .14, ausdauer: .12, zweikampf: .11, positionsspiel: .1, dribbling: .09, schuss: .08 },
  LM: { ausdauer: .15, passspiel: .15, tempo: .14, technik: .13, dribbling: .13, uebersicht: .11, zweikampf: .1, schuss: .09 },
  RM: { ausdauer: .15, passspiel: .15, tempo: .14, technik: .13, dribbling: .13, uebersicht: .11, zweikampf: .1, schuss: .09 },
  OM: { technik: .18, uebersicht: .18, passspiel: .17, dribbling: .14, schuss: .13, tempo: .1, nervenstaerke: .1 },
  LA: { tempo: .2, dribbling: .19, technik: .15, schuss: .14, passspiel: .11, ausdauer: .11, nervenstaerke: .1 },
  RA: { tempo: .2, dribbling: .19, technik: .15, schuss: .14, passspiel: .11, ausdauer: .11, nervenstaerke: .1 },
  ST: { schuss: .26, positionsspiel: .16, technik: .13, kopfball: .12, tempo: .12, koerper: .11, nervenstaerke: .1 }
};

export const MATCH_VIEW = { TEXT: 'text', HIGHLIGHTS: 'highlights', FULL: 'full' };

export const MATCH_VIEW_NAMES = {
  text: 'Nur Textkonferenz',
  highlights: 'Höhepunkte im Stadion',
  full: 'Komplettes Spiel'
};

export const DIFFICULTIES = {
  amateur: {
    id: 'amateur', name: 'Kreisliga-Legende', desc: 'Entspannt. Der Vorstand ist nachsichtig, das Geld sitzt locker.',
    aiStrength: 0.88, moneyFactor: 1.35, boardPatience: 1.6, transferLuck: 1.25,
    injuryRate: 0.7, minigame: 0.62, opponentFinishing: 0.88, xpGain: 1.25, fanPatience: 1.5
  },
  profi: {
    id: 'profi', name: 'Profi', desc: 'Die ausgewogene Variante. So war Anstoß gedacht.',
    aiStrength: 1.0, moneyFactor: 1.0, boardPatience: 1.0, transferLuck: 1.0,
    injuryRate: 1.0, minigame: 1.0, opponentFinishing: 1.0, xpGain: 1.0, fanPatience: 1.0
  },
  weltklasse: {
    id: 'weltklasse', name: 'Weltklasse', desc: 'Knallharte Konkurrenz, knappe Kassen, ungeduldige Bosse.',
    aiStrength: 1.1, moneyFactor: 0.78, boardPatience: 0.72, transferLuck: 0.82,
    injuryRate: 1.25, minigame: 1.32, opponentFinishing: 1.1, xpGain: 0.85, fanPatience: 0.75
  },
  legende: {
    id: 'legende', name: 'Legendenstatus', desc: 'Jeder Fehler zählt. Nur für Managerlegenden.',
    aiStrength: 1.22, moneyFactor: 0.6, boardPatience: 0.5, transferLuck: 0.65,
    injuryRate: 1.45, minigame: 1.6, opponentFinishing: 1.2, xpGain: 0.7, fanPatience: 0.5
  }
};

export const TRAITS = {
  leader: { name: 'Führungsspieler', desc: 'Hebt die Moral der Mitspieler, besonders im Rückstand.', icon: '🎖️' },
  elfmeterkiller: { name: 'Elfmeterkiller', desc: 'Extrem sicher vom Punkt.', icon: '🎯' },
  freistossspezialist: { name: 'Freistoßspezialist', desc: 'Gefährlich bei ruhenden Bällen.', icon: '🌀' },
  kopfballungeheuer: { name: 'Kopfballungeheuer', desc: 'Dominiert in der Luft.', icon: '🗿' },
  eckenspezialist: { name: 'Eckenspezialist', desc: 'Bringt Ecken punktgenau.', icon: '📐' },
  tempodribbler: { name: 'Tempodribbler', desc: 'Geht immer in den Zweikampf – und meist vorbei.', icon: '💨' },
  spielmacher_trait: { name: 'Regisseur', desc: 'Verteilt die Bälle mit Übersicht.', icon: '🎩' },
  knipser: { name: 'Knipser', desc: 'Braucht nur eine Chance.', icon: '⚽' },
  eisenfuss: { name: 'Eisenfuß', desc: 'Geht rustikal zur Sache – Kartenrisiko.', icon: '🪓' },
  glasknochen: { name: 'Glasknochen', desc: 'Verletzt sich überdurchschnittlich oft.', icon: '🩹' },
  spaetzuender: { name: 'Spätzünder', desc: 'Entwickelt sich auch jenseits der 27 weiter.', icon: '🌙' },
  wunderkind: { name: 'Wunderkind', desc: 'Reift ungewöhnlich schnell.', icon: '✨' },
  kabinenleader: { name: 'Kabinenleader', desc: 'Schlichtet Konflikte im Team.', icon: '🗣️' },
  mimose: { name: 'Mimose', desc: 'Moral schwankt stark.', icon: '🌸' },
  eisblock: { name: 'Nervenstark', desc: 'In engen Spielen ein Fels.', icon: '🧊' },
  laufwunder: { name: 'Laufwunder', desc: 'Ermüdet spürbar langsamer.', icon: '🫁' },
  torwartlegende: { name: 'Torwartlegende', desc: 'Hält auch das Unhaltbare.', icon: '🧤' },
  weltfussballer: { name: 'Weltfußballer', desc: 'Kann ein Spiel im Alleingang entscheiden.', icon: '👑' },
  fanliebling: { name: 'Fanliebling', desc: 'Verkauf sorgt für Ärger auf den Rängen.', icon: '❤️' },
  querulant: { name: 'Querulant', desc: 'Sorgt regelmäßig für Unruhe.', icon: '💣' }
};

export const WEATHER = {
  sonnig: { name: 'Sonnig', icon: '☀️', tempoMod: 1.0, injuryMod: 1.0, errorMod: 1.0 },
  bewoelkt: { name: 'Bewölkt', icon: '☁️', tempoMod: 1.0, injuryMod: 1.0, errorMod: 1.0 },
  regen: { name: 'Regen', icon: '🌧️', tempoMod: 0.94, injuryMod: 1.15, errorMod: 1.22 },
  wind: { name: 'Windig', icon: '🌬️', tempoMod: 0.97, injuryMod: 1.0, errorMod: 1.18 },
  schnee: { name: 'Schnee', icon: '❄️', tempoMod: 0.88, injuryMod: 1.3, errorMod: 1.35 },
  hitze: { name: 'Hitze', icon: '🔥', tempoMod: 0.9, injuryMod: 1.2, errorMod: 1.08 }
};

export const NATION_NAMES = {
  DE: 'Deutschland', FR: 'Frankreich', ES: 'Spanien', IT: 'Italien', NL: 'Niederlande',
  PT: 'Portugal', BR: 'Brasilien', AR: 'Argentinien', EN: 'England', AT: 'Österreich',
  CH: 'Schweiz', PL: 'Polen', HR: 'Kroatien', RS: 'Serbien', DK: 'Dänemark', SE: 'Schweden',
  NO: 'Norwegen', BE: 'Belgien', CZ: 'Tschechien', TR: 'Türkei', GR: 'Griechenland',
  UA: 'Ukraine', RU: 'Russland', MA: 'Marokko', SN: 'Senegal', NG: 'Nigeria', GH: 'Ghana',
  CM: 'Kamerun', CI: 'Elfenbeinküste', ML: 'Mali', DZ: 'Algerien', TN: 'Tunesien',
  JP: 'Japan', KR: 'Südkorea', US: 'USA', CA: 'Kanada', MX: 'Mexiko', CO: 'Kolumbien',
  UY: 'Uruguay', CL: 'Chile', PE: 'Peru', EC: 'Ecuador', PY: 'Paraguay', VE: 'Venezuela',
  SK: 'Slowakei', SI: 'Slowenien', HU: 'Ungarn', RO: 'Rumänien', BG: 'Bulgarien',
  FI: 'Finnland', IS: 'Island', IE: 'Irland', SCO: 'Schottland', WAL: 'Wales',
  BA: 'Bosnien', AL: 'Albanien', XK: 'Kosovo', MK: 'Nordmazedonien', ME: 'Montenegro',
  GE: 'Georgien', AM: 'Armenien', IL: 'Israel', EG: 'Ägypten', ZA: 'Südafrika',
  AU: 'Australien', NZ: 'Neuseeland', CN: 'China', IR: 'Iran', SA: 'Saudi-Arabien',
  LU: 'Luxemburg', BF: 'Burkina Faso', CD: 'DR Kongo', GN: 'Guinea', GA: 'Gabun',
  CV: 'Kap Verde', AO: 'Angola', ZM: 'Sambia', TG: 'Togo', BJ: 'Benin', SY: 'Syrien'
};

/** Vereinsfarben-Fallback, falls ein Club keine Angaben hat. */
export const DEFAULT_COLORS = { primary: '#2c3e50', secondary: '#ecf0f1', accent: '#e74c3c' };

export const INJURY_TYPES = [
  { id: 'prellung', name: 'Prellung', min: 2, max: 7, severity: 1 },
  { id: 'zerrung', name: 'Muskelzerrung', min: 7, max: 21, severity: 2 },
  { id: 'faserriss', name: 'Muskelfaserriss', min: 21, max: 45, severity: 3 },
  { id: 'baenderriss', name: 'Bänderriss', min: 42, max: 110, severity: 4 },
  { id: 'meniskus', name: 'Meniskusschaden', min: 50, max: 130, severity: 4 },
  { id: 'knochenbruch', name: 'Knochenbruch', min: 60, max: 150, severity: 5 },
  { id: 'kreuzband', name: 'Kreuzbandriss', min: 180, max: 300, severity: 6 },
  { id: 'gehirn', name: 'Gehirnerschütterung', min: 5, max: 18, severity: 2 },
  { id: 'sehne', name: 'Sehnenriss', min: 90, max: 200, severity: 5 },
  { id: 'erschoepfung', name: 'Erschöpfung', min: 3, max: 10, severity: 1 }
];

/**
 * Die Reiter der Navigationsleiste, in dieser Reihenfolge. Aus ihr entstehen in
 * src/main.js auch die Tastenkürzel – wer hier etwas einschiebt, verschiebt alle
 * Kürzel dahinter. Die Chronik steht direkt hinter der Vereinsakte: Beide lesen
 * dieselben Akten, nur schaut die eine nach vorn und die andere zurück.
 */
export const SCREEN_ORDER = [
  'buero', 'kader', 'taktik', 'training', 'spieltag', 'tabelle', 'europa', 'transfer',
  'finanzen', 'stadion', 'jugend', 'medizin', 'stab', 'presse', 'verein', 'chronik',
  'einstellungen'
];

/**
 * Nur Anzeigenamen der Wettbewerbe. Teilnehmerzahlen, Spielpläne, Prämien und
 * Qualifikationsregeln stehen ausschließlich in src/data/leagues.js – das ist die
 * maßgebliche Quelle. Hier keine Zahlen doppeln.
 */
export const COMPETITIONS = {
  bl1: { id: 'bl1', name: '1. Bundesliga', short: 'BL', tier: 1 },
  bl2: { id: 'bl2', name: '2. Bundesliga', short: '2BL', tier: 2 },
  pokal: { id: 'pokal', name: 'DFB-Pokal', short: 'Pokal', tier: 0 },
  europa: { id: 'europa', name: 'Europapokal', short: 'EC', tier: 0 }
};
