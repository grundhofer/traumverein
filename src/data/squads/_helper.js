/**
 * Autoren-Helfer für Kaderdaten.
 *
 * Kader werden kompakt notiert: Man gibt eine Gesamtstärke (`ovr`) und nur die
 * charakterprägenden Attribute an – der Rest wird aus dem Positionsprofil so
 * abgeleitet, dass `playerOverall()` wieder ungefähr `ovr` ergibt.
 *
 *   mk({ club:'bayern', vn:'Franz', nn:'Beckenbauer', pos:'IV', ovr:94, ... })
 */

import { POSITION_WEIGHTS, ATTRIBUTES, KEEPER_ATTRIBUTES } from '../../core/constants.js';
import { hashString } from '../../core/rng.js';
import { clamp, slug } from '../../core/util.js';
import { CLUBS_BY_ID } from '../clubs.js';

/** Basiswerte für nicht positionsrelevante Attribute, relativ zur Gesamtstärke. */
const OFF_PROFILE_FACTOR = 0.72;
const OFF_PROFILE_BASE = 14;

const HAIR_STYLES = ['kurz', 'mittel', 'lang', 'glatze', 'afro', 'vokuhila', 'zopf', 'undercut', 'locken', 'irokese'];
const BEARDS = ['keiner', 'keiner', 'stoppeln', 'schnauzer', 'vollbart', 'kinnbart', 'koteletten'];
const BUILDS = ['schlank', 'normal', 'normal', 'kraeftig'];
const HAIR_COLORS = ['#1b1310', '#2b1d14', '#4a3221', '#6b4a2a', '#8a6b3d', '#b58b4c', '#d9bb7a', '#7a7a7a', '#c9c9c9'];
const EYE_COLORS = ['#3a2a1a', '#2d1f14', '#4a3b23', '#3c5a72', '#4d6b4a', '#5a5a5a'];

/** Hautton-Tendenz nach Nation (0 = sehr hell … 5 = sehr dunkel). */
const SKIN_BY_NATION = {
  DE: [0, 1, 1, 2], AT: [0, 1, 1], CH: [0, 1, 1], NL: [0, 1, 1, 2], BE: [0, 1, 2], DK: [0, 0, 1],
  SE: [0, 0, 1], NO: [0, 0, 1], FI: [0, 0, 1], IS: [0, 0], PL: [0, 1], CZ: [0, 1], SK: [0, 1],
  HU: [0, 1], RO: [1, 1, 2], BG: [1, 1], UA: [0, 1], RU: [0, 1], EN: [0, 1, 2, 3], SCO: [0, 1],
  IE: [0, 1], WAL: [0, 1], FR: [1, 2, 3, 4], ES: [1, 2], PT: [1, 2, 3], IT: [1, 2], GR: [1, 2],
  HR: [0, 1], RS: [0, 1], BA: [0, 1], SI: [0, 1], AL: [1, 2], XK: [1, 2], MK: [1, 2], ME: [0, 1],
  TR: [1, 2, 3], GE: [1, 2], AM: [1, 2], IL: [1, 2], BR: [1, 2, 3, 4], AR: [1, 1, 2], UY: [1, 2],
  CL: [1, 2], CO: [2, 3], PE: [2, 3], EC: [2, 3], PY: [2, 2], VE: [2, 3], MX: [2, 3],
  US: [1, 2, 3, 4], CA: [1, 2, 3], JP: [1, 2], KR: [1, 2], CN: [1, 2], IR: [2, 3],
  SA: [2, 3], EG: [2, 3], MA: [2, 3], DZ: [2, 3], TN: [2, 3], SN: [5, 5, 4], NG: [5, 5, 4],
  GH: [5, 4], CM: [5, 4], CI: [5, 4], ML: [5, 4], BF: [5, 4], CD: [5, 4], GN: [5, 4],
  GA: [4, 5], CV: [3, 4], AO: [5, 4], ZM: [5, 4], TG: [5, 4], BJ: [5, 4], ZA: [3, 4, 5],
  AU: [0, 1, 2], NZ: [1, 2], LU: [0, 1], SY: [2, 3]
};

function seedFor(id) { return hashString(id); }

/** Deterministischer Pseudozufall aus einem Seed + Kanal, Ergebnis [0,1). */
function det(seed, channel) {
  let x = (seed ^ (channel * 0x9e3779b9)) >>> 0;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  return x / 4294967296;
}

function pickDet(arr, seed, channel) {
  return arr[Math.floor(det(seed, channel) * arr.length) % arr.length];
}

/**
 * Erzeugt den kompletten Attributsatz aus Gesamtstärke + Positionsprofil.
 * Gewichtete Attribute liegen nahe an `ovr`, ungewichtete deutlich darunter.
 */
function deriveAttributes(pos, ovr, overrides, seed, age, isKeeper) {
  const weights = POSITION_WEIGHTS[pos] || POSITION_WEIGHTS.ZM;
  const att = {};
  let ch = 100;

  for (const key of ATTRIBUTES) {
    const w = weights[key];
    let base;
    if (w !== undefined) {
      // Streuung: wichtige Attribute schwanken weniger stark um ovr
      const spread = 7 - Math.min(5, w * 22);
      base = ovr + (det(seed, ch++) * 2 - 1) * spread;
    } else if (KEEPER_ATTRIBUTES.includes(key)) {
      base = isKeeper ? ovr * 0.8 : OFF_PROFILE_BASE + det(seed, ch++) * 12;
    } else {
      base = OFF_PROFILE_BASE + ovr * OFF_PROFILE_FACTOR * (0.72 + det(seed, ch++) * 0.4);
    }
    att[key] = clamp(Math.round(base), 3, 99);
  }

  // Alter beeinflusst Physis
  if (age >= 31) {
    const decay = (age - 30) * 1.7;
    att.tempo = clamp(Math.round(att.tempo - decay), 3, 99);
    att.ausdauer = clamp(Math.round(att.ausdauer - decay * 0.8), 3, 99);
    att.sprungkraft = clamp(Math.round(att.sprungkraft - decay * 0.6), 3, 99);
    att.uebersicht = clamp(Math.round(att.uebersicht + Math.min(6, (age - 30) * 1.1)), 3, 99);
    att.positionsspiel = clamp(Math.round(att.positionsspiel + Math.min(7, (age - 30) * 1.2)), 3, 99);
  } else if (age <= 20) {
    const green = (21 - age) * 2.2;
    att.uebersicht = clamp(Math.round(att.uebersicht - green), 3, 99);
    att.positionsspiel = clamp(Math.round(att.positionsspiel - green), 3, 99);
    att.nervenstaerke = clamp(Math.round(att.nervenstaerke - green * 0.8), 3, 99);
    att.koerper = clamp(Math.round(att.koerper - green * 0.7), 3, 99);
  }

  // Explizite Vorgaben gewinnen immer
  if (overrides) {
    for (const k in overrides) {
      if (ATTRIBUTES.includes(k)) att[k] = clamp(Math.round(overrides[k]), 1, 99);
    }
  }

  // Nachjustieren, damit die gewichtete Summe wieder ovr trifft.
  //
  // Nur die NICHT ausdrücklich gesetzten Attribute werden nachgezogen, und zwar auf ein
  // gemeinsames Niveau statt um eine Differenz verschoben. Sonst schießen genau die
  // Attribute nach oben, die der Autor bewusst nicht genannt hat (ein Beckenbauer mit
  // Kopfball 98, weil sein Tempo mit 79 angegeben wurde).
  let wsum = 0, fixedAcc = 0, freeW = 0;
  const freeKeys = [];
  for (const k in weights) {
    wsum += weights[k];
    if (overrides && overrides[k] !== undefined) {
      fixedAcc += weights[k] * att[k];
    } else {
      freeW += weights[k];
      freeKeys.push(k);
    }
  }
  if (freeKeys.length && freeW > 0) {
    const ziel = (ovr * wsum - fixedAcc) / freeW;
    // Nie über die Gesamtstärke hinaus – ungenannte Attribute sind nicht die Stärke des Spielers.
    const niveau = clamp(ziel, 10, ovr + 1);
    const obergrenze = Math.min(99, ovr + 1);
    let ch2 = 400;
    for (const k of freeKeys) {
      const jitter = (det(seed, ch2++) * 2 - 1) * 3;
      att[k] = clamp(Math.round(niveau + jitter), 3, obergrenze);
    }
  }
  return att;
}

function deriveAppearance(look, seed, nat, age, pos) {
  const l = look || {};
  const skinPool = SKIN_BY_NATION[nat] || [1, 2, 3];
  const skin = l.skin !== undefined ? l.skin : pickDet(skinPool, seed, 11);
  let hair = l.hair || pickDet(HAIR_STYLES, seed, 12);
  if (age >= 33 && det(seed, 13) < 0.3 && !l.hair) hair = 'kurz';
  const hairColor = l.hairColor || (skin >= 4
    ? '#120d0a'
    : (age >= 34 && det(seed, 14) < 0.35 ? '#8f8f8f' : pickDet(HAIR_COLORS, seed, 15)));
  return {
    skin,
    hair,
    hairColor,
    beard: l.beard || pickDet(BEARDS, seed, 16),
    build: l.build || (pos === 'TW' ? 'kraeftig' : pickDet(BUILDS, seed, 17)),
    height: l.height || (pos === 'TW' ? 186 + Math.floor(det(seed, 18) * 10)
      : pos === 'IV' ? 183 + Math.floor(det(seed, 18) * 10)
        : 172 + Math.floor(det(seed, 18) * 16)),
    eyes: l.eyes || pickDet(EYE_COLORS, seed, 19),
    accessory: l.accessory || (pos === 'TW' ? 'handschuhe' : (det(seed, 20) < 0.07 ? 'stirnband' : 'keiner')),
    face: l.face !== undefined ? l.face : Math.floor(det(seed, 21) * 8)
  };
}

/** Marktwert aus Stärke, Potenzial und Alter (grobe Bundesliga-Kurve). */
export function deriveValue(ovr, pot, age) {
  const base = Math.pow(Math.max(1, ovr - 38) / 10, 3.35) * 210000;
  let ageF;
  if (age <= 19) ageF = 1.35;
  else if (age <= 23) ageF = 1.45;
  else if (age <= 27) ageF = 1.25;
  else if (age <= 30) ageF = 0.95;
  else if (age <= 32) ageF = 0.6;
  else if (age <= 34) ageF = 0.34;
  else ageF = 0.15;
  const potF = 1 + Math.max(0, pot - ovr) * (age <= 23 ? 0.05 : 0.018);
  const v = base * ageF * potF;
  return Math.max(50000, Math.round(v / 50000) * 50000);
}

/* ------------------------------------------------------------------ *
 * Gehaltsskala
 * ------------------------------------------------------------------ *
 *
 * Das Weltmarktgehalt (weltmarktGehalt) hängt allein am Spieler: Marktwert,
 * Stärke, Alter. Das reicht nicht. In diesem Spiel hat JEDER Erstligist rund
 * zehn Weltklasse-Legenden im Kader – Heidenheim zahlte damit Weltmarkt-
 * gehälter bei Voith-Arena-Einnahmen (Gehaltsquote 180 %).
 *
 * Deshalb kommt zwischen Weltmarkt und Vertrag der Verein:
 *
 *   • `wirtschaftskraft(club)`  Größe des Vereins, FC Bayern = 1. Sie speist
 *     sich aus Reputation (Marke, Sponsoren, Merchandising), Stadiongröße
 *     (Zuschauer, Catering) und Mitgliederzahl – genau die drei Größen, aus
 *     denen club/finances.js die Einnahmen aufbaut.
 *   • `ligaNiveau(club)`        Gehaltsniveau der Spielklasse. Die drei Größen
 *     oben sehen die Liga nicht: Schalke hat als Zweitligist dasselbe Stadion
 *     und dieselben Mitglieder wie als Erstligist, aber ein Fünftel der
 *     Fernsehgelder. club/finances.js kennt diesen Knick längst (BETRIEB_LIGA,
 *     der Ligafaktor beim Sponsoring); die Gehaltsskala hat ihn bis
 *     Roadmap-Stufe 5 nicht gekannt.
 *   • `gehaltsSpitze(club)`     Größenordnung des Spitzengehalts dieses
 *     Vereins. Darüber wird es für ihn nicht unmöglich, aber teuer:
 *     Der Verlauf staucht sich, statt abzureißen.
 *   • `vereinsgehalt(w, club)`  Weltmarktgehalt → tatsächliches Jahresgehalt.
 *
 * Damit verdient eine Vereinslegende bei IHREM Verein Bestandsgehalt statt
 * Weltmarktgehalt: Uwe Seeler hat beim HSV nie Bayern-Gehälter bekommen.
 * Innerhalb einer Spielklasse ist die Kurve in beiden Argumenten streng monoton
 * und stetig – ein stärkerer Spieler verdient immer mehr, ein größerer Verein
 * zahlt immer mehr. Über die Ligagrenze hinweg gilt das bewusst NICHT: Ein
 * abgestiegener Traditionsverein zahlt weniger als ein kleiner Erstligist. Das
 * ist kein Bruch, sondern die Abstiegsklausel. Gemessen wird die Skala mit
 * tools/test-wirtschaft.js.
 *
 * Dieselbe Skala benutzen data/generator.js (prozedurale Kader) und
 * club/transfers.js (marktGehalt) – sonst spränge der erste Transfer die
 * Reparatur wieder auf.
 *
 * WICHTIG: Die Marktwerte (deriveValue) bleiben davon unberührt. Sie steuern
 * die Ablösen und sollen sich nicht verschieben.
 */

/** Bezugsverein der Skala: FC Bayern (Rep. 95, 75.024 Plätze, 380.000 Mitglieder). */
const KRAFT_REF_REPUTATION = 95;
const KRAFT_REF_PLAETZE = 75024;
const KRAFT_REF_MITGLIEDER = 380000;
/** Gewichte der drei Einnahmenträger: Marke, Stadion, Mitglieder. */
const KRAFT_REPUTATION_EXP = 0.90;
const KRAFT_STADION_EXP = 0.85;
const KRAFT_MITGLIEDER_EXP = 0.20;
/** Untergrenze, damit Amateurvereine ohne Stammdaten nicht auf null fallen. */
const KRAFT_MIN = 0.010;
/** Dämpfung der Strukturkosten gegenüber der Vereinsgröße (siehe kostenSkala). */
const KOSTEN_SKALA_EXP = 0.42;

/** Grundniveau unterhalb der Vereinsspitze … */
const GEHALT_NIVEAU = 2.40;
/** … und wie stark es mit der Vereinsgröße steigt. */
const GEHALT_NIVEAU_EXP = 0.15;
/** Spitzengehalt beim Bezugsverein (Größenordnung, keine harte Grenze) … */
const GEHALT_SPITZE_REF = 3300000;
/** … und wie es mit der Vereinsgröße wächst.
 *  Gemessen mit tools/test-wirtschaft.js: Bei 1,12 stauchte die Kurve die
 *  kleinen Vereine zu hart — Elversberg, Preußen und Paderborn kamen auf 29–34 %
 *  Gehaltsquote, während der Ligaschnitt bei 50 % lag. 1,05 hebt genau diesen
 *  unteren Rand und lässt das Gefälle stehen: Bayern zahlt rund das Neunfache
 *  von Heidenheim. */
const GEHALT_SPITZE_EXP = 1.05;
/** Reststeigung oberhalb der Spitze (0 = Deckel, 1 = keine Stauchung). */
const GEHALT_STAUCHUNG = 0.50;
/** Gehaltsniveau je Spielklasse (1. Liga = 1).
 *
 *  Gemessen mit tools/test-wirtschaft.js, nachdem die 2. Liga in Roadmap-Stufe 5
 *  ihre Legendenkader bekommen hat: Ohne diesen Faktor sprang die Gehaltsquote
 *  der 2. Liga von 48,3 % auf 98,3 % vom Umsatz — sechzehn von achtzehn Vereinen
 *  über der 72-Prozent-Marke, Dynamo Dresden bei 148 %. Ursache ist keine zu
 *  starke Kadereichung, sondern eine Lücke im Modell: Zwischen den Ligen liegt
 *  beim Umsatz Faktor 5,4 (3.740 zu 692 Mio), bei der reinen Vereinsgröße aber
 *  nur Faktor 3 — den Rest machen Fernsehgeld, Prämien und Sponsoring aus, und
 *  die hängen an der Spielklasse, nicht am Stadion.
 *
 *  0,44 bringt die 2. Liga auf gut 50 % zurück, also auf das Niveau, das sie mit
 *  den prozeduralen Kadern hatte. Das entspricht auch der Größenordnung echter
 *  Abstiegsklauseln (40–60 % Gehaltsverzicht).
 *
 *  Ligen ohne Eintrag (Europapokalgegner, Pokalvereine, Amateure) zahlen
 *  unverändert nach Vereinsgröße — dort ist die Spielklasse nicht modelliert. */
const GEHALT_LIGA = { bl1: 1.00, bl2: 0.44 };
const GEHALT_LIGA_SONST = 1.00;

/**
 * Wirtschaftliche Größe eines Vereins, normiert auf den FC Bayern (= 1).
 *
 * Reputation (Marke, Sponsoren, Merchandising), Stadiongröße (Zuschauer,
 * Catering) und Mitgliederzahl sind genau die drei Größen, aus denen
 * club/finances.js die Einnahmen speist.
 *
 * @param {object} club  Club-Objekt aus data/clubs.js bzw. state.clubs
 */
export function wirtschaftskraft(club) {
  if (!club) return 1;
  const rep = clamp(club.reputation === undefined ? 50 : club.reputation, 1, 100);
  const plaetze = clamp((club.stadium && club.stadium.capacity) || 8000, 1000, 120000);
  const fans = club.fans || club.fanbase || {};
  const mitglieder = clamp(fans.members || 2000, 200, 600000);
  const k = Math.pow(rep / KRAFT_REF_REPUTATION, KRAFT_REPUTATION_EXP)
    * Math.pow(plaetze / KRAFT_REF_PLAETZE, KRAFT_STADION_EXP)
    * Math.pow(mitglieder / KRAFT_REF_MITGLIEDER, KRAFT_MITGLIEDER_EXP);
  return Math.max(KRAFT_MIN, k);
}

/**
 * Größenfaktor für Strukturkosten, gedämpft (Bezugsverein FC Bayern = 1).
 *
 * Dieselbe Frage wie beim Gehalt, nur auf der Kostenseite: Ein Zweitligist
 * unterhält keine kleine Ausgabe eines Spitzenvereins, er unterhält einen
 * kleinen Verein — Trainingsgelände, Medizin und Nachwuchs wachsen mit ihm.
 * Der Exponent unter 1 dämpft das: Ein Verein halber Größe zahlt mehr als die
 * Hälfte, denn ein Rasenmäher kostet überall gleich viel.
 *
 * Benutzt von club/finances.js (Abschreibungen) und club/youth.js (Akademie).
 * Die laufenden Betriebskosten hängen dagegen direkt an `wirtschaftskraft()` —
 * ein Verwaltungsapparat skaliert ungedämpft mit dem Verein.
 */
export function kostenSkala(club) {
  return Math.pow(wirtschaftskraft(club), KOSTEN_SKALA_EXP);
}

/**
 * Gehaltsniveau der Spielklasse, in der dieser Verein antritt (1. Liga = 1).
 *
 * Die Ligazugehörigkeit steht im Spielstand (`state.leagues`); `club.leagueId`
 * läuft als Kopie mit und ist die Fassung, die hier verfügbar ist — dieselbe
 * Quelle, die auch club/finances.js für BETRIEB_LIGA liest. Steigt ein Verein
 * auf oder ab, gilt das neue Niveau ab dem nächsten Vertrag; laufende Verträge
 * behalten ihr Gehalt, genau wie in der Wirklichkeit.
 */
export function ligaNiveau(club) {
  if (!club) return 1;
  const l = club.leagueId;
  return GEHALT_LIGA[l] !== undefined ? GEHALT_LIGA[l] : GEHALT_LIGA_SONST;
}

/** Größenordnung des Spitzengehalts, das dieser Verein zahlt (Euro/Jahr). */
export function gehaltsSpitze(club) {
  return GEHALT_SPITZE_REF * Math.pow(wirtschaftskraft(club), GEHALT_SPITZE_EXP) * ligaNiveau(club);
}

/**
 * Rechnet ein Weltmarktgehalt in das um, was dieser Verein tatsächlich zahlt.
 * Unterhalb der Vereinsspitze fast linear, darüber gestaucht.
 *
 * Das Liganiveau geht in beide Größen ein – in das Grundniveau `x` wie in die
 * Vereinsspitze. Dadurch verschiebt es die Kurve als Ganzes, statt sie zu
 * verbiegen: Der Abstand zwischen einem Weltklassespieler und einem Ergänzungs-
 * spieler bleibt in der 2. Liga derselbe wie in der ersten, nur eben in kleinerer
 * Währung.
 *
 * @param {number} weltmarkt  Jahresgehalt ohne Vereinsbezug
 * @param {object} club       Club-Objekt; ohne Verein bleibt der Weltmarkt stehen
 */
export function vereinsgehalt(weltmarkt, club) {
  const w = Math.max(0, weltmarkt || 0);
  if (!club) return w;
  const x = w * GEHALT_NIVEAU * Math.pow(wirtschaftskraft(club), GEHALT_NIVEAU_EXP) * ligaNiveau(club);
  const spitze = gehaltsSpitze(club);
  return x * Math.pow(1 + x / spitze, GEHALT_STAUCHUNG - 1);
}

/** Jahresgehalt auf dem Weltmarkt – ohne Verein, allein aus Marktwert und Stärke. */
export function weltmarktGehalt(ovr, value) {
  return value * 0.14 + Math.pow(Math.max(1, ovr - 45), 2.4) * 900;
}

/**
 * Jahresgehalt aus Marktwert und Stärke.
 * @param {object|string} [club]  Verein (Objekt oder ID). Fehlt er, kommt das
 *                                reine Weltmarktgehalt zurück – so verhalten
 *                                sich Vertragslose und Jugendspieler wie bisher.
 */
export function deriveSalary(ovr, value, age, club) {
  const c = typeof club === 'string' ? CLUBS_BY_ID[club] : club;
  const s = vereinsgehalt(weltmarktGehalt(ovr, value), c);
  return Math.max(60000, Math.round(s / 10000) * 10000);
}

/**
 * Baut ein vollständiges Player-Objekt (Datenteil, ohne Laufzeitfelder).
 *
 * @param {object} d
 *  club, vn (Vorname), nn (Nachname), pos, ovr, pot
 *  optional: alt[], age, era ('legend'|'modern'), eraLabel, nr, nat, foot,
 *            att{}, traits[], look{}, salary, until, value, shortName, id
 */
export function mk(d) {
  const last = d.nn;
  const id = d.id || `p_${d.club}_${slug(last)}${d.idSuffix ? '_' + d.idSuffix : ''}`;
  const seed = seedFor(id);
  const age = d.age !== undefined ? d.age : 26;
  const pos = d.pos;
  const isKeeper = pos === 'TW';
  const ovr = clamp(d.ovr, 20, 99);
  const pot = clamp(d.pot !== undefined ? d.pot : Math.max(ovr, ovr + (age < 23 ? 8 : age < 26 ? 3 : 0)), ovr, 99);
  const nat = d.nat || 'DE';
  const value = d.value !== undefined ? d.value : deriveValue(ovr, pot, age);
  // Ein ausdrücklich gesetztes Gehalt gilt unverändert; sonst entscheidet der
  // Verein über das Niveau (siehe Gehaltsskala oben).
  const salary = d.salary !== undefined ? d.salary : deriveSalary(ovr, value, age, CLUBS_BY_ID[d.club]);

  return {
    id,
    firstName: d.vn,
    lastName: last,
    shortName: d.shortName || last,
    clubId: d.club,
    nationality: nat,
    age,
    era: d.era || 'modern',
    eraLabel: d.eraLabel || null,
    position: pos,
    altPositions: d.alt || [],
    attributes: deriveAttributes(pos, ovr, d.att, seed, age, isKeeper),
    potential: pot,
    foot: d.foot || (det(seed, 30) < 0.22 ? 'links' : det(seed, 31) < 0.06 ? 'beidfüßig' : 'rechts'),
    traits: d.traits || [],
    appearance: deriveAppearance(d.look, seed, nat, age, pos),
    number: d.nr || 0,
    contract: {
      salary,
      until: d.until !== undefined ? d.until : 2 + Math.floor(det(seed, 32) * 3),
      signOn: 0,
      releaseClause: d.releaseClause || null
    },
    value
  };
}

/** Vergibt freie Rückennummern und meldet Duplikate. */
export function assignNumbers(players) {
  const byClub = {};
  for (const p of players) (byClub[p.clubId] || (byClub[p.clubId] = [])).push(p);
  for (const clubId in byClub) {
    const used = new Set();
    for (const p of byClub[clubId]) {
      if (p.number && !used.has(p.number)) { used.add(p.number); continue; }
      let n = p.position === 'TW' ? 1 : 2;
      while (used.has(n) && n < 99) n++;
      p.number = n;
      used.add(n);
    }
  }
  return players;
}
