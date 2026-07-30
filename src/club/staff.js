/**
 * club/staff.js — Der Trainerstab.
 * ============================================================================
 *
 * Zuständig für: Co-Trainer, Torwart-, Athletik- und Mentaltrainer, Ärzte,
 * Physios, Scouts, Jugendtrainer, Videoanalyst, Zeugwart und Sportdirektor.
 * Einstellung, Gehalt, Weiterbildung, Abwerbung, Konflikte — und die Wirkung
 * des Stabs auf den Rest des Spiels (stabWirkung()).
 *
 * Wer liest stabWirkung()?
 *   training.js  -> .training, .taktik, .torwart
 *   medical.js   -> .regeneration, .verletzungsschutz
 *   transfers.js -> .scouting, .analyse
 *   youth.js     -> .jugend
 *   morale.js    -> .moral
 *   ratings.js   -> coachBonus (über core/loop.js)
 *
 * KEIN DOM, kein Math.random(), kein Date.now(). Alle Balancing-Zahlen stehen
 * als benannte Konstanten ganz oben.
 *
 * ---------------------------------------------------------------------------
 * ANNAHMEN ÜBER FREMDE MODULE (bewusst weich angebunden, siehe buchen()):
 *   club/finances.js exportiert  buchen(state, clubId, betrag, kategorie, text)
 *   mit betrag < 0 = Ausgabe. Fehlt das Modul oder schlägt der Aufruf fehl,
 *   bucht dieses Modul selbst schemakonform auf club.finances.
 * ---------------------------------------------------------------------------
 */

import { clamp, round, sortBy, formatMoney, uid, avg } from '../core/util.js';
import { createRng, hashString } from '../core/rng.js';
import { POSITION_NAMES, POSITION_GROUP } from '../core/constants.js';
import { playerOverall } from '../engine/ratings.js';

/* ==========================================================================
 * 0. Weiche Anbindung an club/finances.js
 * ======================================================================== */

let _finanzen = null;
try {
  _finanzen = await import('./finances.js');
} catch (e) {
  _finanzen = null;   // Finanzmodul noch nicht vorhanden -> Eigenbuchung
}

/** Bucht Geld. Negativer Betrag = Ausgabe. Kategorie = Schlüssel aus emptyFinanceLine(). */
function buchen(state, clubId, betrag, kategorie, text) {
  const club = state.clubs[clubId];
  if (!club || !betrag) return;
  if (_finanzen && typeof _finanzen.buchen === 'function') {
    const vorher = club.finances.balance;
    try {
      _finanzen.buchen(state, clubId, betrag, kategorie, text);
      if (club.finances.balance !== vorher) return;   // hat gegriffen
    } catch (e) { /* fällt unten durch */ }
  }
  eigenbuchung(state, club, betrag, kategorie, text);
}

function eigenbuchung(state, club, betrag, kategorie, text) {
  const f = club.finances;
  f.balance += betrag;
  if (!f.ledger) f.ledger = [];
  f.ledger.push({ day: state.date.day, season: state.date.season, betrag, kategorie, text });
  if (f.ledger.length > 1500) f.ledger.shift();
  if (!f.saison) f.saison = {};
  f.saison[kategorie] = (f.saison[kategorie] || 0) + Math.abs(betrag);
}

/* ==========================================================================
 * 1. BALANCING — hier wird geschraubt
 * ======================================================================== */

/** Gehaltsformel: gehaltBasis × Qualitätsfaktor × Vereinsfaktor. */
const GEHALT_QUAL_SOCKEL = 0.42;          // bei Qualität 0
const GEHALT_QUAL_SPANNE = 1.18;          // Zuschlag bei Qualität 100
const GEHALT_REP_SOCKEL = 0.70;           // bei Reputation 0
const GEHALT_REP_SPANNE = 0.62;           // Zuschlag bei Reputation 100
const GEHALT_ALTER_BONUS = 0.006;         // je Jahr über 40 (Erfahrung kostet)

/** Wirkung. */
const WIRKUNG_BASIS = 25;                 // Verein ganz ohne Stab
const WIRKUNG_STACK_DAEMPFUNG = 0.55;     // jeder weitere Beitrag zählt weniger
const WIRKUNG_ZUFRIEDEN_MIN = 0.84;       // Faktor bei Zufriedenheit 0
const WIRKUNG_ZUFRIEDEN_SPANNE = 0.32;    // Zuschlag bei Zufriedenheit 100
const WIRKUNG_SPEZI_BONUS = 8;            // Spezialisierung auf das passende Feld

/** Personalmarkt. */
const ABFINDUNG_FAKTOR = 0.60;            // Anteil des Restvertrags
const ABFINDUNG_MINDEST = 0.30;           // mindestens 30 % eines Jahresgehalts
const ABWERBE_CHANCE_WOCHE = 0.010;       // Grundchance je Verein und Woche
const ABWERBE_QUALITAETS_SCHWELLE = 68;   // darunter will keiner
const ABWERBE_FRIST_TAGE = 14;
const KONFLIKT_CHANCE_WOCHE = 0.018;
const UNZUFRIEDEN_DRIFT = 1.2;            // Punkte je Woche bei Unterbezahlung
const ZUFRIEDEN_ERHOLUNG = 0.6;           // Punkte je Woche bei fairer Bezahlung
const VERTRAG_STANDARD_JAHRE = 2;

/** Bewerbermarkt. */
const BEWERBER_MIN = 3;
const BEWERBER_MAX = 6;
const BEWERBER_QUAL_REP_FAKTOR = 0.62;    // Reputation zieht bessere Leute an
const BEWERBER_FORDERUNG_STREUUNG = 0.22;

/* ==========================================================================
 * 2. ROLLEN
 * ======================================================================== */

/**
 * Die Wirkfelder eines Stabsmitglieds. Beitrag = Qualität × Gewicht.
 * Felder: training, regeneration, verletzungsschutz, scouting, jugend,
 *         taktik, moral, torwart, analyse.
 */
export const STAFF_ROLES = {
  cotrainer: {
    id: 'cotrainer', name: 'Co-Trainer',
    desc: 'Ihre rechte Hand. Leitet Einheiten, liest den Gegner und sagt Ihnen auch mal die Wahrheit.',
    wirkung: 'Hebt Trainingsqualität und Taktikverständnis, stützt die Stimmung.',
    gehaltBasis: 450000, maxAnzahl: 1,
    effekte: { training: 0.50, taktik: 0.46, moral: 0.20 },
    spezialisierungen: ['Defensivspezialist', 'Offensivfuchs', 'Motivator', 'Taktiktüftler', 'Standardspezialist']
  },
  torwarttrainer: {
    id: 'torwarttrainer', name: 'Torwarttrainer',
    desc: 'Wirft eine Stunde lang Bälle in Ecken, in die kein Mensch springen möchte.',
    wirkung: 'Entwickelt die Torhüter, verbessert Reflexe und Strafraumbeherrschung.',
    gehaltBasis: 220000, maxAnzahl: 1,
    effekte: { torwart: 0.82, training: 0.10 },
    spezialisierungen: ['Reflexschule', 'Strafraumbeherrschung', 'Spielaufbau', 'Elfmeterlesen']
  },
  athletiktrainer: {
    id: 'athletiktrainer', name: 'Athletiktrainer',
    desc: 'Glaubt fest daran, dass Fußball zu 80 Prozent Laufarbeit ist. Leider hat er recht.',
    wirkung: 'Verbessert Kondition, Frische und senkt muskuläre Verletzungen.',
    gehaltBasis: 180000, maxAnzahl: 2,
    effekte: { regeneration: 0.44, verletzungsschutz: 0.30, training: 0.20 },
    spezialisierungen: ['Ausdauer', 'Schnellkraft', 'Regeneration', 'Rehabilitation']
  },
  mannschaftsarzt: {
    id: 'mannschaftsarzt', name: 'Mannschaftsarzt',
    desc: 'Stellt Diagnosen, die entweder beruhigen oder die Saison beenden.',
    wirkung: 'Kürzere Ausfallzeiten, seltenere Rückfälle, präzisere Prognosen.',
    gehaltBasis: 260000, maxAnzahl: 1,
    effekte: { verletzungsschutz: 0.55, regeneration: 0.28 },
    spezialisierungen: ['Orthopädie', 'Sportmedizin', 'Chirurgie', 'Diagnostik']
  },
  physiotherapeut: {
    id: 'physiotherapeut', name: 'Physiotherapeut',
    desc: 'Knetet Spieler wieder fit, die morgens noch am Stock gingen.',
    wirkung: 'Beschleunigt Regeneration und Reha spürbar.',
    gehaltBasis: 110000, maxAnzahl: 3,
    effekte: { regeneration: 0.42, verletzungsschutz: 0.16 },
    spezialisierungen: ['Manuelle Therapie', 'Reha', 'Massage', 'Faszientraining']
  },
  chefscout: {
    id: 'chefscout', name: 'Chefscout',
    desc: 'Kennt jeden Zweitligisten mit Namen — und dessen Schwager gleich mit.',
    wirkung: 'Genauere Spielerberichte, mehr Scouting-Regionen möglich.',
    gehaltBasis: 200000, maxAnzahl: 1,
    effekte: { scouting: 0.58, analyse: 0.14, jugend: 0.10 },
    spezialisierungen: ['Talentsuche', 'Gegneranalyse', 'Ablösefreie', 'Auslandsmärkte']
  },
  scout: {
    id: 'scout', name: 'Scout',
    desc: 'Sitzt bei Nieselregen in Zwickau und macht sich Notizen.',
    wirkung: 'Deckt Regionen ab und verkleinert die Unschärfe der Berichte.',
    gehaltBasis: 85000, maxAnzahl: 5,
    effekte: { scouting: 0.32, jugend: 0.08 },
    spezialisierungen: ['Deutschland', 'Südamerika', 'Afrika', 'Skandinavien', 'Osteuropa', 'Jugendspiele']
  },
  jugendtrainer: {
    id: 'jugendtrainer', name: 'Jugendtrainer',
    desc: 'Erzieht Sechzehnjährige zu Profis — und manchmal auch zu Menschen.',
    wirkung: 'Beschleunigt die Entwicklung im Nachwuchs deutlich.',
    gehaltBasis: 130000, maxAnzahl: 3,
    effekte: { jugend: 0.60, training: 0.10 },
    spezialisierungen: ['Technikschulung', 'Spielintelligenz', 'Athletik', 'Persönlichkeit']
  },
  videoanalyst: {
    id: 'videoanalyst', name: 'Videoanalyst',
    desc: 'Hat den Gegner 14 Mal gesehen und weiß, welcher Innenverteidiger links nicht kann.',
    wirkung: 'Bessere Gegnervorbereitung, präzisere Taktikanpassungen.',
    gehaltBasis: 95000, maxAnzahl: 2,
    effekte: { analyse: 0.66, taktik: 0.24, training: 0.08 },
    spezialisierungen: ['Gegneranalyse', 'Standardsituationen', 'Datenanalyse', 'Eigenanalyse']
  },
  mentaltrainer: {
    id: 'mentaltrainer', name: 'Mentaltrainer',
    desc: 'Redet mit der Mannschaft über Gefühle. Die Alten finden das albern, die Jungen nicht.',
    wirkung: 'Stabilisiert Moral und Nervenstärke, entschärft Krisen.',
    gehaltBasis: 120000, maxAnzahl: 1,
    effekte: { moral: 0.62, training: 0.10, taktik: 0.06 },
    spezialisierungen: ['Krisenbewältigung', 'Nervenstärke', 'Teambuilding', 'Einzelbetreuung']
  },
  zeugwart: {
    id: 'zeugwart', name: 'Zeugwart',
    desc: 'Seit 1987 im Verein. Weiß mehr über die Kabine als der ganze Vorstand zusammen.',
    wirkung: 'Kleiner Stimmungsbonus, sorgt für Ordnung im Alltag.',
    gehaltBasis: 55000, maxAnzahl: 1,
    effekte: { moral: 0.22, regeneration: 0.08 },
    spezialisierungen: ['Kabinenseele', 'Materialwart', 'Organisator']
  },
  sportdirektor: {
    id: 'sportdirektor', name: 'Sportdirektor',
    desc: 'Verhandelt Verträge, beruhigt den Vorstand und nimmt Ihnen Arbeit ab — oder Kompetenzen.',
    wirkung: 'Bessere Transferverhandlungen, breiteres Scouting, mehr Ruhe im Verein.',
    gehaltBasis: 700000, maxAnzahl: 1,
    effekte: { scouting: 0.30, analyse: 0.18, jugend: 0.16, moral: 0.12, taktik: 0.08 },
    spezialisierungen: ['Verhandlungsführer', 'Netzwerker', 'Kaderplaner', 'Sparkommissar']
  }
};

export const STAFF_ROLE_IDS = Object.keys(STAFF_ROLES);

/** Alt-Bezeichner aus core/state.js bzw. data/generator.js auf die Rollen-IDs abbilden. */
const ROLLEN_ALIAS = {
  athletik: 'athletiktrainer', athletiktrainer: 'athletiktrainer',
  arzt: 'mannschaftsarzt', doktor: 'mannschaftsarzt', mannschaftsarzt: 'mannschaftsarzt',
  physio: 'physiotherapeut', physiotherapeut: 'physiotherapeut',
  scout: 'scout', chefscout: 'chefscout',
  jugend: 'jugendtrainer', jugendtrainer: 'jugendtrainer',
  co: 'cotrainer', cotrainer: 'cotrainer',
  torwart: 'torwarttrainer', torwarttrainer: 'torwarttrainer',
  video: 'videoanalyst', videoanalyst: 'videoanalyst',
  mental: 'mentaltrainer', mentaltrainer: 'mentaltrainer',
  zeugwart: 'zeugwart', sportdirektor: 'sportdirektor', manager: 'sportdirektor'
};

/** Liefert die kanonische Rollen-ID eines Stabsmitglieds (oder null). */
export function rolleVon(s) {
  if (!s) return null;
  const raw = String(s.roleId || s.role || s.rolle || '').toLowerCase();
  return ROLLEN_ALIAS[raw] || (STAFF_ROLES[raw] ? raw : null);
}

/** Alle Wirkfelder in fester Reihenfolge. */
export const WIRKUNG_FELDER = [
  'training', 'regeneration', 'verletzungsschutz', 'scouting',
  'jugend', 'taktik', 'moral', 'torwart', 'analyse'
];

export const WIRKUNG_NAMEN = {
  training: 'Trainingsqualität', regeneration: 'Regeneration',
  verletzungsschutz: 'Verletzungsschutz', scouting: 'Scouting', jugend: 'Nachwuchsarbeit',
  taktik: 'Taktikarbeit', moral: 'Stimmung', torwart: 'Torwartarbeit', analyse: 'Spielanalyse'
};

/** Spezialisierung -> zusätzliches Wirkfeld (WIRKUNG_SPEZI_BONUS Punkte). */
const SPEZI_FELD = {
  'Defensivspezialist': 'taktik', 'Offensivfuchs': 'taktik', 'Motivator': 'moral',
  'Taktiktüftler': 'taktik', 'Standardspezialist': 'analyse',
  'Reflexschule': 'torwart', 'Strafraumbeherrschung': 'torwart', 'Spielaufbau': 'torwart',
  'Elfmeterlesen': 'torwart', 'Ausdauer': 'regeneration', 'Schnellkraft': 'training',
  'Regeneration': 'regeneration', 'Rehabilitation': 'verletzungsschutz',
  'Orthopädie': 'verletzungsschutz', 'Sportmedizin': 'verletzungsschutz',
  'Chirurgie': 'verletzungsschutz', 'Diagnostik': 'verletzungsschutz',
  'Manuelle Therapie': 'regeneration', 'Reha': 'regeneration', 'Massage': 'regeneration',
  'Faszientraining': 'regeneration', 'Talentsuche': 'jugend', 'Gegneranalyse': 'analyse',
  'Ablösefreie': 'scouting', 'Auslandsmärkte': 'scouting', 'Deutschland': 'scouting',
  'Südamerika': 'scouting', 'Afrika': 'scouting', 'Skandinavien': 'scouting',
  'Osteuropa': 'scouting', 'Jugendspiele': 'jugend', 'Technikschulung': 'training',
  'Spielintelligenz': 'jugend', 'Athletik': 'regeneration', 'Persönlichkeit': 'moral',
  'Datenanalyse': 'analyse', 'Eigenanalyse': 'analyse', 'Standardsituationen': 'analyse',
  'Krisenbewältigung': 'moral', 'Nervenstärke': 'moral', 'Teambuilding': 'moral',
  'Einzelbetreuung': 'moral', 'Kabinenseele': 'moral', 'Materialwart': 'regeneration',
  'Organisator': 'analyse', 'Verhandlungsführer': 'scouting', 'Netzwerker': 'scouting',
  'Kaderplaner': 'jugend', 'Sparkommissar': 'analyse'
};

/* ==========================================================================
 * 3. PERSÖNLICHKEITEN, EIGENSCHAFTEN, KURSE
 * ======================================================================== */

export const STAB_PERSOENLICHKEITEN = [
  { id: 'loyal', name: 'Vereinsmensch', desc: 'Bleibt, solange man ihn anständig behandelt.', loyalitaet: 1.5, ehrgeiz: 0.6, konflikt: 0.6 },
  { id: 'ehrgeizig', name: 'Ehrgeizig', desc: 'Will selbst einmal Cheftrainer werden.', loyalitaet: 0.6, ehrgeiz: 1.5, konflikt: 1.1 },
  { id: 'kumpel', name: 'Kumpeltyp', desc: 'Bei den Spielern beliebt, beim Vorstand mittel.', loyalitaet: 1.1, ehrgeiz: 0.8, konflikt: 0.7 },
  { id: 'pedant', name: 'Pedant', desc: 'Alles nach Plan. Alles. Wirklich alles.', loyalitaet: 1.0, ehrgeiz: 1.0, konflikt: 1.3 },
  { id: 'sturkopf', name: 'Sturkopf', desc: 'Hat eine Meinung und behält sie auch.', loyalitaet: 0.9, ehrgeiz: 1.1, konflikt: 1.7 },
  { id: 'gelassen', name: 'Gelassen', desc: 'Bringt nichts aus der Ruhe, auch keine Niederlagenserie.', loyalitaet: 1.2, ehrgeiz: 0.7, konflikt: 0.4 },
  { id: 'geschaeftsmann', name: 'Geschäftsmann', desc: 'Am Ende zählt, was auf dem Zettel steht.', loyalitaet: 0.4, ehrgeiz: 1.2, konflikt: 1.0 }
];

export const STAB_TRAITS = {
  trainingsfanatiker: { name: 'Trainingsfanatiker', desc: 'Schindet die Mannschaft — Trainingsertrag hoch, Frische leidet.' },
  entdecker: { name: 'Spürnase', desc: 'Findet Talente, die andere übersehen.' },
  diplomat: { name: 'Diplomat', desc: 'Schlichtet Konflikte, bevor sie in der Zeitung stehen.' },
  medienprofi: { name: 'Medienprofi', desc: 'Redet gut — manchmal zu gut und zu oft.' },
  sparfuchs: { name: 'Bescheiden', desc: 'Verlangt weniger Gehalt als üblich.' },
  aufsteiger: { name: 'Aufsteiger', desc: 'Jung, hungrig, entwickelt sich noch weiter.' },
  altgedient: { name: 'Altgedient', desc: 'Kennt jeden Trick — und jede Ausrede.' },
  querkopf: { name: 'Querkopf', desc: 'Stellt Ihre Entscheidungen gerne öffentlich in Frage.' },
  laborratte: { name: 'Datengläubig', desc: 'Vertraut der Tabelle mehr als dem Auge.' },
  menschenfaenger: { name: 'Menschenfänger', desc: 'Spieler laufen für ihn durch die Wand.' }
};

export const KURSE = [
  { id: 'uefa_b', name: 'UEFA-B-Lizenz', desc: 'Grundlagenkurs beim Verband.', kosten: 18000, tage: 28, plus: 3 },
  { id: 'uefa_a', name: 'UEFA-A-Lizenz', desc: 'Der ernsthafte Schritt nach oben.', kosten: 45000, tage: 56, plus: 5 },
  { id: 'fussballlehrer', name: 'Fußballlehrer-Lehrgang', desc: 'Zehn Monate Köln. Danach ist er reif für mehr — im Guten wie im Schlechten.', kosten: 120000, tage: 84, plus: 8 },
  { id: 'athletik_zert', name: 'Athletik-Zertifikat', desc: 'Moderne Belastungssteuerung statt Waldlauf.', kosten: 28000, tage: 35, plus: 4, rollen: ['athletiktrainer', 'physiotherapeut'] },
  { id: 'sportmedizin', name: 'Sportmedizin-Fortbildung', desc: 'Neueste Verfahren aus der Reha.', kosten: 34000, tage: 35, plus: 4, rollen: ['mannschaftsarzt', 'physiotherapeut'] },
  { id: 'torwart_akademie', name: 'Torwart-Akademie', desc: 'Eine Woche mit den Besten der Zunft.', kosten: 22000, tage: 21, plus: 4, rollen: ['torwarttrainer'] },
  { id: 'scouting_seminar', name: 'Scouting-Seminar', desc: 'Datenbanken, Netzwerke, Kaffee.', kosten: 16000, tage: 21, plus: 3, rollen: ['scout', 'chefscout', 'sportdirektor'] },
  { id: 'videoanalyse', name: 'Videoanalyse-Workshop', desc: 'Software, die niemand außer ihm bedienen kann.', kosten: 20000, tage: 21, plus: 4, rollen: ['videoanalyst', 'cotrainer'] },
  { id: 'psychologie', name: 'Sportpsychologie', desc: 'Reden hilft. Angeblich.', kosten: 26000, tage: 42, plus: 4, rollen: ['mentaltrainer', 'cotrainer', 'jugendtrainer'] },
  { id: 'hospitanz', name: 'Auslandshospitanz', desc: 'Zwei Wochen bei einem Spitzenklub zuschauen und mitschreiben.', kosten: 40000, tage: 14, plus: 3 }
];

const VORNAMEN = ['Michael', 'Thomas', 'Andreas', 'Stefan', 'Jürgen', 'Klaus', 'Peter', 'Uwe', 'Frank',
  'Dirk', 'Ralf', 'Holger', 'Bernd', 'Matthias', 'Sven', 'Torsten', 'Olaf', 'Marco', 'Sascha', 'Kai',
  'Lars', 'Heiko', 'Norbert', 'Wolfgang', 'Hansi', 'Rainer', 'Detlef', 'Markus', 'Christian', 'Oliver',
  'Sandra', 'Nicole', 'Katrin', 'Anke', 'Britta', 'Martina', 'Silke', 'Steffi', 'Yvonne', 'Bianca'];

const NACHNAMEN = ['Krause', 'Hoffmann', 'Sommer', 'Berger', 'Kluge', 'Reinhardt', 'Stark', 'Winkler',
  'Vollmer', 'Ziegler', 'Brandt', 'Hübner', 'Kettner', 'Rausch', 'Dahlmann', 'Petzold', 'Wiegand',
  'Bartsch', 'Grothe', 'Neuberger', 'Ostermann', 'Fischbach', 'Lindner', 'Sauer', 'Weidner', 'Kolbe',
  'Merten', 'Ruhnke', 'Timm', 'Gebhardt', 'Aschenbach', 'Rothe', 'Vogler', 'Simon', 'Enders', 'Kastner',
  'Bergmann', 'Klose', 'Hartung', 'Sieber', 'Wehrmann', 'Nolte', 'Damm', 'Uhlig', 'Zeidler'];

/* ==========================================================================
 * 4. Laufzeit-Ergänzung (Lazy-Init auf fremd erzeugten Stabsdaten)
 * ======================================================================== */

/** Was Qualität heißt: 20 = Kreisklasse, 50 = solide, 75 = sehr gut, 90+ = Weltklasse. */
export function qualitaetVon(s) {
  if (!s) return 50;
  const q = s.qualitaet ?? s.quality ?? s.staerke ?? s.rating ?? 50;
  return clamp(Math.round(q), 1, 99);
}

/** Marktgehalt einer Rolle für einen Verein. */
export function marktGehalt(roleId, qualitaet, reputation, alter = 45) {
  const role = STAFF_ROLES[roleId] || STAFF_ROLES.scout;
  const qf = GEHALT_QUAL_SOCKEL + (clamp(qualitaet, 1, 99) / 100) * GEHALT_QUAL_SPANNE;
  const rf = GEHALT_REP_SOCKEL + (clamp(reputation, 1, 100) / 100) * GEHALT_REP_SPANNE;
  const af = 1 + Math.max(0, alter - 40) * GEHALT_ALTER_BONUS;
  return Math.max(24000, Math.round(role.gehaltBasis * qf * rf * af / 1000) * 1000);
}

/** Ergänzt ein (evtl. fremd erzeugtes) Stabsmitglied um alle Felder, die dieses Modul braucht. */
export function ensureStabRuntime(state, s) {
  if (!s) return s;
  const club = s.clubId ? state.clubs[s.clubId] : null;
  const rep = club ? (club.reputation || 50) : 50;
  const roleId = rolleVon(s) || 'scout';
  if (s.roleId !== roleId) s.roleId = roleId;
  if (s.name === undefined) s.name = `${s.firstName || 'Ralf'} ${s.lastName || 'Krause'}`;
  if (s.alter === undefined) s.alter = s.age !== undefined ? s.age : 46;
  if (s.qualitaet === undefined) s.qualitaet = qualitaetVon(s);
  if (s.gehalt === undefined) s.gehalt = s.salary !== undefined ? s.salary : marktGehalt(roleId, s.qualitaet, rep, s.alter);
  if (s.vertragBis === undefined) s.vertragBis = (s.contract && s.contract.until) || state.date.season + VERTRAG_STANDARD_JAHRE;
  if (s.zufriedenheit === undefined) s.zufriedenheit = 66;
  if (s.spezialisierung === undefined) {
    const pool = (STAFF_ROLES[roleId] || STAFF_ROLES.scout).spezialisierungen;
    s.spezialisierung = pool[hashString(s.id || s.name) % pool.length];
  }
  if (s.persoenlichkeit === undefined) {
    s.persoenlichkeit = STAB_PERSOENLICHKEITEN[hashString('p' + (s.id || s.name)) % STAB_PERSOENLICHKEITEN.length];
  }
  if (!Array.isArray(s.traits)) s.traits = [];
  if (s.kurs === undefined) s.kurs = null;
  if (s.seit === undefined) s.seit = { season: state.date.season, day: state.date.day };
  if (s.abwerbung === undefined) s.abwerbung = null;
  if (s.erfahrung === undefined) s.erfahrung = 0;
  return s;
}

/** Alle Stabsmitglieder eines Vereins (laufzeitfertig). */
export function stabVon(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return [];
  if (!club.staffIds) club.staffIds = [];
  const out = [];
  for (const id of club.staffIds) {
    const s = state.staff[id];
    if (!s) continue;
    if (!s.clubId) s.clubId = clubId;
    out.push(ensureStabRuntime(state, s));
  }
  return out;
}

/* ==========================================================================
 * 5. WIRKUNG
 * ======================================================================== */

/**
 * Gesamtwirkung des Trainerstabs, je Feld 0..100.
 * Beiträge werden absteigend sortiert und gedämpft addiert — der dritte Physio
 * bringt eben nicht mehr so viel wie der erste.
 */
export function stabWirkung(state, clubId) {
  const beitraege = {};
  for (const f of WIRKUNG_FELDER) beitraege[f] = [];

  for (const s of stabVon(state, clubId)) {
    const role = STAFF_ROLES[s.roleId];
    if (!role) continue;
    if (s.kurs && s.kurs.abwesend) continue;            // im Lehrgang, fehlt im Alltag
    const zf = WIRKUNG_ZUFRIEDEN_MIN + (clamp(s.zufriedenheit, 0, 100) / 100) * WIRKUNG_ZUFRIEDEN_SPANNE;
    const q = qualitaetVon(s);
    const speziFeld = SPEZI_FELD[s.spezialisierung] || null;
    for (const feld in role.effekte) {
      let wert = q * role.effekte[feld] * zf;
      if (feld === speziFeld) wert += WIRKUNG_SPEZI_BONUS;
      beitraege[feld].push(wert);
    }
    if (speziFeld && !role.effekte[speziFeld]) {
      beitraege[speziFeld].push(WIRKUNG_SPEZI_BONUS * 0.6);
    }
  }

  const out = {};
  for (const feld of WIRKUNG_FELDER) {
    const liste = beitraege[feld].sort((a, b) => b - a);
    let summe = 0;
    for (let i = 0; i < liste.length; i++) summe += liste[i] / (1 + WIRKUNG_STACK_DAEMPFUNG * i);
    out[feld] = clamp(Math.round(WIRKUNG_BASIS + summe), 0, 100);
  }
  return out;
}

/** Kurzform: Ein Wert 0..100 für die Bank insgesamt (z. B. als coachBonus-Baustein). */
export function stabGesamtwert(state, clubId) {
  const w = stabWirkung(state, clubId);
  return Math.round((w.training * 0.3 + w.taktik * 0.25 + w.moral * 0.15 +
    w.regeneration * 0.15 + w.analyse * 0.15));
}

/* ==========================================================================
 * 6. TICK
 * ======================================================================== */

export function tickStab(state, ctx) {
  const eigener = state.managerClubId;
  const monatsRng = ctx.rng;

  for (const clubId in state.clubs) {
    const club = state.clubs[clubId];
    const mine = clubId === eigener;
    const stab = stabVon(state, clubId);
    if (!stab.length && !ctx.isSeasonEnd) continue;

    if (ctx.isMonthStart) gehaelterZahlen(state, club, stab, ctx, mine);
    if (!ctx.isWeekStart) continue;

    const rng = monatsRng.fork('stab:' + clubId);

    kurseFortschreiben(state, club, stab, ctx, mine);
    zufriedenheitPflegen(state, club, stab, ctx, mine, rng);
    abwerbungPruefen(state, club, stab, ctx, mine, rng);
    if (mine) konflikte(state, club, stab, ctx, rng);
    if (ctx.isSeasonEnd && club.stabJahresabschluss !== state.date.season) {
      club.stabJahresabschluss = state.date.season;
      for (const s of stab) s.alter += 1;
      vertraegePruefen(state, club, stab, ctx, mine, rng);
    }
  }
}

function gehaelterZahlen(state, club, stab, ctx, mine) {
  let summe = 0;
  for (const s of stab) summe += s.gehalt / 12;
  summe = Math.round(summe);
  if (summe <= 0) return;
  buchen(state, club.id, -summe, 'ausgabenStab', 'Gehälter Trainerstab');
  if (mine && ctx.isMonthStart && club.finances.balance < 0) {
    ctx.log(`Die Gehälter des Trainerstabs (${formatMoney(summe)}) sind abgebucht. Das Konto steht bei ` +
      `${formatMoney(club.finances.balance)}. Der Schatzmeister hat dazu bereits etwas gesagt, das wir hier nicht wiedergeben.`,
      'finanzen', { from: 'Geschäftsstelle', subject: 'Stabsgehälter abgebucht' });
  }
}

function kurseFortschreiben(state, club, stab, ctx, mine) {
  for (const s of stab) {
    if (!s.kurs) continue;
    s.kurs.restTage -= 7;
    if (s.kurs.restTage > 0) continue;
    const kurs = KURSE.find(k => k.id === s.kurs.id) || { name: s.kurs.name || 'Lehrgang', plus: 3 };
    const zuwachs = s.kurs.plus !== undefined ? s.kurs.plus : kurs.plus;
    s.qualitaet = clamp(s.qualitaet + zuwachs, 1, 99);
    s.erfahrung += 1;
    s.zufriedenheit = clamp(s.zufriedenheit + 5, 0, 100);
    s.kurs = null;
    if (mine) {
      ctx.log(`${s.name} ist vom Lehrgang „${kurs.name}“ zurück und deutlich schlauer als vorher ` +
        `(Qualität jetzt ${s.qualitaet}). Ob er es auch anwendet, sehen wir im Training.`,
        'stab', { from: 'Trainerstab', subject: `Lehrgang beendet: ${s.name}` });
    }
  }
}

function zufriedenheitPflegen(state, club, stab, ctx, mine, rng) {
  const rep = club.reputation || 50;
  for (const s of stab) {
    const soll = marktGehalt(s.roleId, s.qualitaet, rep, s.alter);
    const verhaeltnis = s.gehalt / Math.max(1, soll);
    if (verhaeltnis < 0.9) {
      const gier = s.persoenlichkeit ? (2 - s.persoenlichkeit.loyalitaet) : 1;
      s.zufriedenheit = clamp(s.zufriedenheit - UNZUFRIEDEN_DRIFT * gier * (1 - verhaeltnis) * 4, 0, 100);
    } else {
      s.zufriedenheit = clamp(s.zufriedenheit + ZUFRIEDEN_ERHOLUNG, 0, 100);
    }
    // Erfolg macht zufrieden, Krise nicht
    const serie = club.season ? (club.season.serie || 0) : 0;
    if (serie >= 3) s.zufriedenheit = clamp(s.zufriedenheit + 1, 0, 100);
    else if (serie <= -3) s.zufriedenheit = clamp(s.zufriedenheit - 1.5, 0, 100);

    if (mine && s.zufriedenheit < 25 && rng.chance(0.25)) {
      ctx.log(`${s.name} (${STAFF_ROLES[s.roleId].name}) hat in der Kaffeeküche durchblicken lassen, ` +
        `dass er sich „nach zwölf Jahren im Fußball anders behandelt gefühlt“ habe. Sein Gehalt liegt bei ` +
        `${formatMoney(s.gehalt)}, marktüblich wären ${formatMoney(soll)}.`,
        'stab', { from: 'Trainerstab', subject: `${s.name} ist unzufrieden` });
    }
  }
}

function abwerbungPruefen(state, club, stab, ctx, mine, rng) {
  // Laufende Abwerbeversuche zuerst abarbeiten
  for (const s of stab.slice()) {
    if (!s.abwerbung) continue;
    s.abwerbung.restTage -= 7;
    if (s.abwerbung.restTage > 0) continue;
    const bleibt = s.zufriedenheit > 70 && s.gehalt >= s.abwerbung.angebot * 0.85;
    if (bleibt) {
      s.abwerbung = null;
      if (mine) ctx.log(`${s.name} hat abgesagt und bleibt bei uns. „Hier fühle ich mich wohl“, sagt er. ` +
        `Wir tun so, als glaubten wir das.`, 'stab', { from: 'Trainerstab', subject: `${s.name} bleibt` });
    } else {
      const ziel = s.abwerbung.clubName;
      stabMitgliedEntfernen(state, club, s);
      if (mine) ctx.log(`${s.name} verlässt uns Richtung ${ziel}. Der Posten des ${STAFF_ROLES[s.roleId].name}s ist ab sofort verwaist. ` +
        `Bewerbungen liegen erfahrungsgemäß schneller vor, als einem lieb ist.`,
        'stab', { from: 'Trainerstab', subject: `${s.name} geht`, wichtig: true });
      else if (rng.chance(0.7)) ersatzEinstellen(state, club, s.roleId, rng);
    }
  }

  if (!stab.length) return;
  if (!rng.chance(ABWERBE_CHANCE_WOCHE * (mine ? 1.4 : 1))) return;

  const kandidat = rng.pick(stab.filter(s => !s.abwerbung && qualitaetVon(s) >= ABWERBE_QUALITAETS_SCHWELLE));
  if (!kandidat) return;
  // Europapokal-Gegner (core/state.js:euroClub) haben keinen Stab und stellen
  // auch keinen ein – sonst hätten sie durch ihren hohen Ruf den halben
  // Bewerberkreis für sich.
  const interessent = rng.pick(Object.values(state.clubs).filter(c =>
    c.id !== club.id && !c.istEuropaeisch && (c.reputation || 50) > (club.reputation || 50) - 5));
  if (!interessent) return;

  const angebot = Math.round(marktGehalt(kandidat.roleId, kandidat.qualitaet, interessent.reputation || 50, kandidat.alter) * rng.float(1.05, 1.3));
  kandidat.abwerbung = { clubId: interessent.id, clubName: interessent.name, angebot, restTage: ABWERBE_FRIST_TAGE };
  if (mine) {
    ctx.log(`${interessent.name} hat bei ${kandidat.name} angeklopft und ihm ${formatMoney(angebot)} im Jahr geboten ` +
      `(aktuell: ${formatMoney(kandidat.gehalt)}). Wir haben zwei Wochen Zeit, ihn zu halten — ` +
      `am besten mit einem Angebot, das er nicht laut vorlesen muss.`,
      'stab', { from: 'Trainerstab', subject: `Abwerbeversuch: ${kandidat.name}`, wichtig: true });
  }
}

function konflikte(state, club, stab, ctx, rng) {
  if (stab.length < 2) return;
  const streithaehne = stab.filter(s => s.persoenlichkeit && s.persoenlichkeit.konflikt >= 1.2);
  if (!streithaehne.length) return;
  const diplomat = stab.some(s => (s.traits || []).includes('diplomat'));
  const p = KONFLIKT_CHANCE_WOCHE * streithaehne.length * (diplomat ? 0.4 : 1);
  if (!rng.chance(p)) return;

  const a = rng.pick(streithaehne);
  const b = rng.pick(stab.filter(s => s.id !== a.id));
  if (!b) return;
  a.zufriedenheit = clamp(a.zufriedenheit - rng.int(4, 12), 0, 100);
  b.zufriedenheit = clamp(b.zufriedenheit - rng.int(2, 8), 0, 100);
  const themen = [
    'die Trainingssteuerung', 'die Belastung der Stammelf', 'einen Videoabend, der drei Stunden dauerte',
    'die Aufteilung der Kabinenplätze', 'die Frage, wer beim Auswärtsspiel vorne im Bus sitzt',
    'die Bewertung eines Zweitliga-Innenverteidigers', 'die Musik in der Kabine'
  ];
  ctx.log(`Es gab Ärger im Stab: ${a.name} und ${b.name} sind wegen ${rng.pick(themen)} aneinandergeraten. ` +
    `Lautstark. Vor der Mannschaft. Beide sind eingeschnappt, die Wirkung des Stabs leidet vorerst.`,
    'stab', { from: 'Trainerstab', subject: 'Zoff im Trainerstab' });
}

function vertraegePruefen(state, club, stab, ctx, mine, rng) {
  for (const s of stab.slice()) {
    if (s.vertragBis > state.date.season) continue;
    if (mine) {
      ctx.log(`Der Vertrag von ${s.name} (${STAFF_ROLES[s.roleId].name}, Qualität ${s.qualitaet}) läuft zum Saisonende aus. ` +
        `Er verdient ${formatMoney(s.gehalt)}. Verlängern kostet Geld, nicht verlängern kostet Nerven.`,
        'stab', { from: 'Trainerstab', subject: `Vertrag läuft aus: ${s.name}`, wichtig: true });
      s.vertragBis = state.date.season + 1;   // Gnadenfrist bis zur Entscheidung des Managers
    } else {
      const bleibt = s.zufriedenheit > 45 || rng.chance(0.6);
      if (bleibt) {
        s.vertragBis = state.date.season + rng.int(1, 3);
        s.gehalt = marktGehalt(s.roleId, s.qualitaet, club.reputation || 50, s.alter);
      } else {
        stabMitgliedEntfernen(state, club, s);
        ersatzEinstellen(state, club, s.roleId, rng);
      }
    }
  }
}

/* ==========================================================================
 * 7. PERSONALFABRIK
 * ======================================================================== */

function macheName(rng) {
  return `${rng.pick(VORNAMEN)} ${rng.pick(NACHNAMEN)}`;
}

function macheTraits(rng, qualitaet, alter) {
  const pool = Object.keys(STAB_TRAITS);
  const traits = [];
  const anzahl = rng.chance(0.35) ? 2 : rng.chance(0.75) ? 1 : 0;
  for (let i = 0; i < anzahl; i++) {
    const t = rng.pick(pool);
    if (!traits.includes(t)) traits.push(t);
  }
  if (alter <= 34 && !traits.includes('aufsteiger') && rng.chance(0.4)) traits.push('aufsteiger');
  if (alter >= 58 && !traits.includes('altgedient') && rng.chance(0.5)) traits.push('altgedient');
  return traits.slice(0, 3);
}

/** Erzeugt ein vollständiges Stabsmitglied (ohne es einzustellen). */
export function macheStabMitglied(state, clubId, roleId, qualitaet, rng) {
  const role = STAFF_ROLES[roleId] || STAFF_ROLES.scout;
  const club = state.clubs[clubId];
  const rep = club ? (club.reputation || 50) : 50;
  const alter = clamp(Math.round(rng.gauss(46, 9)), 27, 66);
  const q = clamp(Math.round(qualitaet), 12, 97);
  const traits = macheTraits(rng, q, alter);
  const gehalt = Math.round(marktGehalt(roleId, q, rep, alter) * (traits.includes('sparfuchs') ? 0.8 : 1));
  return {
    id: uid('stab', rng),
    clubId: clubId || null,
    role: roleId, roleId,
    name: macheName(rng),
    alter,
    qualitaet: q,
    spezialisierung: rng.pick(role.spezialisierungen),
    persoenlichkeit: rng.pick(STAB_PERSOENLICHKEITEN),
    traits,
    gehalt,
    vertragBis: state.date.season + VERTRAG_STANDARD_JAHRE,
    zufriedenheit: clamp(Math.round(rng.gauss(70, 9)), 35, 95),
    kurs: null,
    abwerbung: null,
    erfahrung: rng.int(0, 4),
    seit: { season: state.date.season, day: state.date.day }
  };
}

function ersatzEinstellen(state, club, roleId, rng) {
  const q = clamp(Math.round((club.reputation || 50) * 0.82 + rng.gauss(0, 7)), 18, 92);
  const s = macheStabMitglied(state, club.id, roleId, q, rng);
  state.staff[s.id] = s;
  club.staffIds.push(s.id);
  return s;
}

function stabMitgliedEntfernen(state, club, s) {
  club.staffIds = (club.staffIds || []).filter(id => id !== s.id);
  delete state.staff[s.id];
}

/** Deterministische Rng, wenn eine Aktion ohne eigene Rng aufgerufen wird. */
function actionRng(state, label) {
  return createRng(hashString(label + ':' + state.seed + ':' + state.tick + ':' + state.date.day));
}

/* ==========================================================================
 * 8. AKTIONEN
 * ======================================================================== */

const REFERENZ_ROLLEN = ['Co-Trainer', 'Jugendtrainer', 'Athletiktrainer', 'Scout', 'Videoanalyst', 'Torwarttrainer'];

function macheReferenzen(state, roleId, qualitaet, alter, rng) {
  const clubs = Object.values(state.clubs);
  const jahr = (state.date.startYear || 2025) + (state.date.season - 1);
  const out = [];
  const anzahl = clamp(1 + Math.floor((alter - 30) / 9), 1, 4);
  for (let i = 0; i < anzahl; i++) {
    const c = rng.pick(clubs);
    if (!c) break;
    const von = jahr - rng.int(3, 22);
    const bis = von + rng.int(1, 6);
    const rolle = i === 0 ? (STAFF_ROLES[roleId] || STAFF_ROLES.scout).name : rng.pick(REFERENZ_ROLLEN);
    out.push(`${rolle} bei ${c.name} (${von}–${Math.min(bis, jahr)})`);
  }
  if (qualitaet >= 78 && rng.chance(0.6)) {
    out.push(rng.pick([
      'Fußballlehrer-Lizenz mit Auszeichnung',
      'Hospitanz bei Ajax Amsterdam',
      'Zwei Aufstiege als Assistent',
      'Verbandsauswahl-Trainer beim DFB',
      'Autor eines Fachbuchs, das erstaunlich viele Kollegen gelesen haben'
    ]));
  }
  if (qualitaet < 45 && rng.chance(0.5)) {
    out.push(rng.pick([
      'Zuletzt zwei Jahre ohne Verein',
      'Kreisliga-Erfahrung, aber viel davon',
      'Empfohlen vom Schwager des Zeugwarts',
      'Bringt eigene Trainingshütchen mit'
    ]));
  }
  return out;
}

/**
 * Bewerberliste für eine Rolle. 3–6 Kandidaten, Qualität skaliert mit der
 * Reputation des Vereins — bei Zweitligisten bewirbt sich eben kein Weltklassemann.
 */
export function bewerber(state, clubId, role, rng) {
  const roleId = ROLLEN_ALIAS[String(role).toLowerCase()] || role;
  if (!STAFF_ROLES[roleId]) return [];
  const club = state.clubs[clubId];
  if (!club) return [];
  const r = rng || actionRng(state, 'bewerber:' + clubId + ':' + roleId);
  const rep = club.reputation || 50;
  const geld = club.finances ? club.finances.balance : 0;
  const anzahl = r.int(BEWERBER_MIN, BEWERBER_MAX);
  const basisQual = 22 + rep * BEWERBER_QUAL_REP_FAKTOR;

  const out = [];
  for (let i = 0; i < anzahl; i++) {
    const q = clamp(Math.round(r.gauss(basisQual, 13)), 15, 96);
    const alter = clamp(Math.round(r.gauss(46, 10)), 27, 66);
    const traits = macheTraits(r, q, alter);
    let forderung = marktGehalt(roleId, q, rep, alter);
    forderung = Math.round(forderung * r.float(1 - BEWERBER_FORDERUNG_STREUUNG, 1 + BEWERBER_FORDERUNG_STREUUNG));
    if (traits.includes('sparfuchs')) forderung = Math.round(forderung * 0.78);
    if (geld < 0) forderung = Math.round(forderung * 1.12);   // Risikozuschlag für Pleitekandidaten
    out.push({
      id: uid('bew', r),
      role: roleId, roleId,
      name: macheName(r),
      alter,
      qualitaet: q,
      spezialisierung: r.pick(STAFF_ROLES[roleId].spezialisierungen),
      gehaltsforderung: Math.round(forderung / 1000) * 1000,
      persoenlichkeit: r.pick(STAB_PERSOENLICHKEITEN),
      referenzen: macheReferenzen(state, roleId, q, alter, r),
      traits,
      vertragsWunschJahre: r.int(1, 3)
    });
  }
  return sortBy(out, b => ({ key: b.qualitaet, desc: true }));
}

/** Anzahl bereits besetzter Stellen einer Rolle. */
export function anzahlInRolle(state, clubId, roleId) {
  return stabVon(state, clubId).filter(s => s.roleId === roleId).length;
}

/**
 * Stellt einen Bewerber ein.
 * @param {object} bewerber Eintrag aus bewerber(); `gehaltsforderung` gilt als vereinbartes Gehalt.
 */
export function einstellen(state, clubId, kandidat) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.' };
  if (!kandidat) return { ok: false, text: 'Kein Bewerber ausgewählt.' };
  const roleId = ROLLEN_ALIAS[String(kandidat.roleId || kandidat.role).toLowerCase()] || kandidat.roleId;
  const role = STAFF_ROLES[roleId];
  if (!role) return { ok: false, text: 'Diese Position gibt es in unserem Verein nicht.' };

  if (anzahlInRolle(state, clubId, roleId) >= role.maxAnzahl) {
    return {
      ok: false,
      text: `Für die Position ${role.name} sind bereits ${role.maxAnzahl} Stelle(n) besetzt. ` +
        `Erst entlassen, dann einstellen — so herum funktioniert das Arbeitsrecht.`
    };
  }

  const gehalt = Math.round(kandidat.vereinbartesGehalt || kandidat.gehaltsforderung || marktGehalt(roleId, kandidat.qualitaet || 50, club.reputation || 50, kandidat.alter || 45));
  const monatsrate = gehalt / 12;
  if (club.finances.balance < -5000000 && club.finances.balance < monatsrate * 6) {
    return { ok: false, text: 'Der Vorstand hat eine Einstellungssperre verhängt. Erst das Konto sortieren, dann Personal.' };
  }

  const s = {
    id: uid('stab'),
    clubId,
    role: roleId, roleId,
    name: kandidat.name,
    alter: kandidat.alter || 45,
    qualitaet: clamp(Math.round(kandidat.qualitaet || 50), 1, 99),
    spezialisierung: kandidat.spezialisierung || role.spezialisierungen[0],
    persoenlichkeit: kandidat.persoenlichkeit || STAB_PERSOENLICHKEITEN[0],
    traits: Array.isArray(kandidat.traits) ? kandidat.traits.slice() : [],
    gehalt,
    vertragBis: state.date.season + (kandidat.vertragsWunschJahre || VERTRAG_STANDARD_JAHRE),
    zufriedenheit: 72,
    kurs: null,
    abwerbung: null,
    erfahrung: 0,
    referenzen: kandidat.referenzen || [],
    seit: { season: state.date.season, day: state.date.day }
  };
  state.staff[s.id] = s;
  if (!club.staffIds) club.staffIds = [];
  club.staffIds.push(s.id);

  return {
    ok: true,
    staff: s,
    text: `${s.name} übernimmt ab sofort den Posten als ${role.name}. Jahresgehalt ${formatMoney(gehalt)}, ` +
      `Vertrag bis Saison ${s.vertragBis}. Willkommen an Bord — die Kaffeemaschine steht links.`
  };
}

/** Entlassung inklusive Abfindung (Restlaufzeit, mindestens 30 % eines Jahresgehalts). */
export function entlassen(state, staffId) {
  const s = state.staff[staffId];
  if (!s) return { ok: false, text: 'Dieses Stabsmitglied kennen wir nicht.' };
  ensureStabRuntime(state, s);
  const club = state.clubs[s.clubId];
  if (!club) return { ok: false, text: 'Zu dieser Person ist kein Verein hinterlegt.' };

  const restJahre = Math.max(0, (s.vertragBis || state.date.season) - state.date.season) + 0.5;
  const abfindung = Math.round(Math.max(s.gehalt * ABFINDUNG_MINDEST, s.gehalt * restJahre * ABFINDUNG_FAKTOR));
  const role = STAFF_ROLES[s.roleId] || { name: 'Mitarbeiter' };

  buchen(state, club.id, -abfindung, 'ausgabenStab', `Abfindung ${s.name}`);
  stabMitgliedEntfernen(state, club, s);

  return {
    ok: true,
    abfindung,
    text: `${s.name} ist als ${role.name} freigestellt. Die Abfindung von ${formatMoney(abfindung)} ` +
      `wurde überwiesen. Er wird uns in Ruhe lassen — vermutlich bis zum nächsten Interview.`
  };
}

/**
 * Gehaltsverhandlung. Liegt das Angebot über der Forderung, steigt die Zufriedenheit,
 * ein laufender Abwerbeversuch wird abgewehrt. Zu niedrige Angebote beleidigen.
 */
export function gehaltVerhandeln(state, staffId, angebot) {
  const s = state.staff[staffId];
  if (!s) return { ok: false, text: 'Dieses Stabsmitglied kennen wir nicht.' };
  ensureStabRuntime(state, s);
  const club = state.clubs[s.clubId];
  const rep = club ? (club.reputation || 50) : 50;
  const markt = marktGehalt(s.roleId, s.qualitaet, rep, s.alter);
  const gier = s.persoenlichkeit ? (2 - s.persoenlichkeit.loyalitaet) : 1;
  let forderung = markt * (0.94 + 0.14 * gier);
  if (s.abwerbung) forderung = Math.max(forderung, s.abwerbung.angebot * 0.95);
  forderung = Math.round(forderung / 1000) * 1000;

  const betrag = Math.round(angebot);
  if (betrag < forderung * 0.7) {
    s.zufriedenheit = clamp(s.zufriedenheit - 12, 0, 100);
    return {
      ok: false, forderung,
      text: `${s.name} hat das Angebot über ${formatMoney(betrag)} nicht einmal zu Ende gelesen. ` +
        `Unter ${formatMoney(forderung)} braucht man ihm nicht zu kommen — und beleidigt ist er jetzt auch.`
    };
  }
  if (betrag < forderung) {
    s.zufriedenheit = clamp(s.zufriedenheit - 4, 0, 100);
    return {
      ok: false, forderung,
      text: `${s.name} lehnt ab. Er will ${formatMoney(forderung)}, wir bieten ${formatMoney(betrag)}. ` +
        `„Da liegen wir nicht weit auseinander“, sagt er. Weit genug offenbar schon.`
    };
  }

  const alt = s.gehalt;
  s.gehalt = betrag;
  s.vertragBis = Math.max(s.vertragBis, state.date.season + 2);
  s.zufriedenheit = clamp(s.zufriedenheit + 14 + (betrag > forderung * 1.15 ? 6 : 0), 0, 100);
  const abgewehrt = !!s.abwerbung;
  s.abwerbung = null;

  return {
    ok: true, forderung, alt, neu: betrag, abgewehrt,
    text: `${s.name} unterschreibt bis Saison ${s.vertragBis} — ${formatMoney(alt)} werden zu ${formatMoney(betrag)}. ` +
      (abgewehrt ? 'Die Abwerbung ist damit vom Tisch. ' : '') +
      `Der Schatzmeister hat kurz die Augen geschlossen, aber unterschrieben.`
  };
}

/** Schickt ein Stabsmitglied auf einen Lehrgang. Kostet sofort Geld und für die Dauer Wirkung. */
export function weiterbildung(state, staffId, kurs) {
  const s = state.staff[staffId];
  if (!s) return { ok: false, text: 'Dieses Stabsmitglied kennen wir nicht.' };
  ensureStabRuntime(state, s);
  const k = typeof kurs === 'string' ? KURSE.find(x => x.id === kurs) : kurs;
  if (!k) return { ok: false, text: 'Diesen Lehrgang gibt es nicht im Programm des Verbands.' };
  if (s.kurs) return { ok: false, text: `${s.name} sitzt bereits im Lehrgang „${s.kurs.name}“ (noch ${s.kurs.restTage} Tage).` };
  if (k.rollen && !k.rollen.includes(s.roleId)) {
    return { ok: false, text: `„${k.name}“ ist nichts für einen ${STAFF_ROLES[s.roleId].name}. Der Verband nimmt ihn gar nicht erst an.` };
  }
  if (s.qualitaet >= 96) return { ok: false, text: `${s.name} kann in seinem Fach niemand mehr etwas beibringen. Er behauptet das zumindest — und diesmal stimmt es.` };

  const club = state.clubs[s.clubId];
  if (club && club.finances.balance < k.kosten && club.finances.balance < 0) {
    return { ok: false, text: `Für „${k.name}“ (${formatMoney(k.kosten)}) ist bei dieser Kontolage kein Spielraum.` };
  }
  const plus = clamp(Math.round(k.plus * (s.qualitaet >= 85 ? 0.5 : s.qualitaet <= 45 ? 1.25 : 1) *
    ((s.traits || []).includes('aufsteiger') ? 1.3 : 1)), 1, 12);

  if (club) buchen(state, club.id, -k.kosten, 'ausgabenStab', `Lehrgang ${k.name} (${s.name})`);
  s.kurs = { id: k.id, name: k.name, restTage: k.tage, plus, abwesend: k.tage >= 42 };

  return {
    ok: true, kosten: k.kosten, tage: k.tage, erwartet: plus,
    text: `${s.name} fährt für ${k.tage} Tage zum Lehrgang „${k.name}“. Kosten: ${formatMoney(k.kosten)}. ` +
      (s.kurs.abwesend ? 'So lange fehlt er im Alltagsbetrieb — das wird man merken. ' : '') +
      `Erwarteter Zugewinn: rund ${plus} Punkte Qualität.`
  };
}

/* ==========================================================================
 * 9. BERICHTE
 * ======================================================================== */

export function stabBericht(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return null;
  const stab = stabVon(state, clubId);
  const wirkung = stabWirkung(state, clubId);
  const kostenJahr = Math.round(stab.reduce((s, m) => s + m.gehalt, 0));
  const schnitt = stab.length ? round(avg(stab, s => qualitaetVon(s)), 1) : 0;

  const mitglieder = sortBy(stab.map(s => ({
    id: s.id, name: s.name, rolle: STAFF_ROLES[s.roleId].name, roleId: s.roleId,
    alter: s.alter, qualitaet: qualitaetVon(s), spezialisierung: s.spezialisierung,
    gehalt: s.gehalt, vertragBis: s.vertragBis, zufriedenheit: Math.round(s.zufriedenheit),
    persoenlichkeit: s.persoenlichkeit ? s.persoenlichkeit.name : '—',
    traits: (s.traits || []).map(t => (STAB_TRAITS[t] || { name: t }).name),
    kurs: s.kurs ? `${s.kurs.name} (noch ${Math.max(0, s.kurs.restTage)} Tage)` : null,
    abwerbung: s.abwerbung ? `${s.abwerbung.clubName} bietet ${formatMoney(s.abwerbung.angebot)}` : null
  })), m => STAFF_ROLE_IDS.indexOf(m.roleId));

  const luecken = [];
  for (const id of STAFF_ROLE_IDS) {
    const n = mitglieder.filter(m => m.roleId === id).length;
    if (n === 0) luecken.push(`Kein ${STAFF_ROLES[id].name} im Verein — ${STAFF_ROLES[id].wirkung.toLowerCase()}`);
  }

  const schwach = mitglieder.filter(m => m.qualitaet < 40).map(m => m.name);
  const unzufrieden = mitglieder.filter(m => m.zufriedenheit < 35).map(m => m.name);

  let bewertung;
  if (schnitt >= 80) bewertung = 'Ein Trainerstab, um den uns halb Europa beneidet. So etwas sieht man auf dem Platz.';
  else if (schnitt >= 68) bewertung = 'Ein sehr ordentlicher Stab. Hier arbeitet niemand gegen den anderen.';
  else if (schnitt >= 55) bewertung = 'Solide Bundesliga-Kost. Es fehlt der eine Fachmann, der den Unterschied macht.';
  else if (schnitt >= 42) bewertung = 'Ausbaufähig. Ein Teil der Arbeit bleibt schlicht liegen.';
  else if (schnitt > 0) bewertung = 'Ehrlich gesagt: Das ist Kreisliga mit Bundesliga-Trikots.';
  else bewertung = 'Wir haben schlicht keinen Trainerstab. Sie machen hier alles allein, Chef.';

  return {
    clubId, mitglieder, anzahl: stab.length, schnitt, kostenJahr,
    kostenMonat: Math.round(kostenJahr / 12), wirkung,
    gesamtwert: stabGesamtwert(state, clubId),
    luecken, schwach, unzufrieden, bewertung
  };
}

/* ==========================================================================
 * 10. CO-TRAINER-RAT
 * ======================================================================== */

const THEMEN = ['aufstellung', 'gegner', 'training', 'transfer', 'form'];

function coTrainer(state, clubId) {
  const stab = stabVon(state, clubId);
  return stab.find(s => s.roleId === 'cotrainer') ||
    stab.find(s => s.roleId === 'sportdirektor') ||
    stab.find(s => s.roleId === 'videoanalyst') || null;
}

function kaderVon(state, clubId) {
  const club = state.clubs[clubId];
  if (!club || !club.playerIds) return [];
  return club.playerIds.map(id => state.players[id]).filter(Boolean);
}

function naechsterGegner(state, clubId) {
  let best = null;
  for (const f of state.fixtures) {
    if (f.played) continue;
    if (f.season !== undefined && f.season !== state.date.season) continue;
    if (f.homeId !== clubId && f.awayId !== clubId) continue;
    if (f.dayIndex < state.date.day) continue;
    if (!best || f.dayIndex < best.dayIndex) best = f;
  }
  if (!best) return null;
  const gegnerId = best.homeId === clubId ? best.awayId : best.homeId;
  return { fixture: best, gegner: state.clubs[gegnerId], heim: best.homeId === clubId };
}

/**
 * Empfehlung des Co-Trainers.
 * Ein starker Co-Trainer liegt fast immer richtig, ein schwacher redet auch mal Unsinn —
 * und man merkt es ihm nicht an. `vertrauen` sagt nur, wie belastbar er allgemein ist.
 *
 * @param {string} thema 'aufstellung'|'gegner'|'training'|'transfer'|'form'
 */
export function coTrainerRat(state, clubId, thema = 'aufstellung') {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.' };
  const co = coTrainer(state, clubId);
  if (!co) {
    return {
      ok: false, thema, vertrauen: 0,
      text: 'Sie haben keinen Co-Trainer. Sie könnten sich selbst um Rat fragen, aber das wirkt in der Kabine seltsam.'
    };
  }
  const t = THEMEN.includes(thema) ? thema : 'aufstellung';
  const q = qualitaetVon(co);
  const rng = actionRng(state, 'corat:' + clubId + ':' + t);
  const falschP = clamp(0.46 - q / 235, 0.02, 0.42);
  const falsch = rng.chance(falschP);
  const vertrauen = clamp(Math.round(q * 0.9 + (co.zufriedenheit - 50) * 0.1), 5, 98);

  const kader = kaderVon(state, clubId);
  let empfehlung = null;
  let satz = '';

  if (t === 'aufstellung') {
    const verfuegbar = kader.filter(p => !p.injury && !(p.cards && p.cards.ban > 0));
    const lineup = club.tactics && club.tactics.lineup ? Object.values(club.tactics.lineup).filter(Boolean) : [];
    const draussen = sortBy(verfuegbar.filter(p => !lineup.includes(p.id)),
      p => ({ key: playerOverall(p) + (p.form - 50) * 0.25, desc: true }));
    const drin = sortBy(verfuegbar.filter(p => lineup.includes(p.id)),
      p => playerOverall(p) + (p.form - 50) * 0.25);
    const rein = falsch ? rng.pick(draussen.slice(-6)) : draussen[0];
    const raus = falsch ? rng.pick(drin.slice(-5)) : drin[0];
    if (rein && raus) {
      empfehlung = { art: 'wechsel', reinId: rein.id, rausId: raus.id };
      satz = `Ich würde ${rein.shortName} (${POSITION_NAMES[rein.position]}) von Beginn an bringen und dafür ` +
        `${raus.shortName} auf die Bank setzen. Der hat zuletzt gewirkt, als hätte er den Ball zum ersten Mal gesehen.`;
    } else if (drin.length) {
      satz = `An der Elf gibt es nichts zu deuteln. Wer da draußen sitzt, sitzt zu Recht draußen.`;
      empfehlung = { art: 'keine' };
    } else {
      satz = 'Wir haben schlicht keine elf gesunden Leute. Das ist kein Aufstellungsproblem, das ist ein Notstand.';
      empfehlung = { art: 'notstand' };
    }
  }

  else if (t === 'gegner') {
    const g = naechsterGegner(state, clubId);
    if (!g || !g.gegner) {
      satz = 'Vor uns liegt kein Spiel. Genießen Sie das, so etwas kommt selten vor.';
      empfehlung = { art: 'keine' };
    } else {
      const wir = club.reputation || 50;
      const die = g.gegner.reputation || 50;
      const diff = falsch ? -(die - wir) : (die - wir);
      const form = (g.gegner.season && g.gegner.season.form || []).slice(-5).join('');
      let stil, rat;
      if (diff > 12) { stil = 'defensiv'; rat = 'tief stehen, kompakt bleiben, auf den einen Konter lauern'; }
      else if (diff > 4) { stil = 'konter'; rat = 'ihnen den Ball überlassen und schnell umschalten'; }
      else if (diff > -6) { stil = 'ausgeglichen'; rat = 'nichts riskieren, was wir nicht kontrollieren können'; }
      else if (diff > -14) { stil = 'pressing'; rat = 'früh draufgehen, die sind im Aufbau nervös'; }
      else { stil = 'offensiv'; rat = 'von der ersten Minute an drücken, sonst wird das zäh'; }
      empfehlung = { art: 'stil', stil, gegnerId: g.gegner.id, heim: g.heim };
      satz = `${g.gegner.name}${g.heim ? ' kommt zu uns' : ' – wir müssen hin'}. Zuletzt: ${form || 'keine Daten'}. ` +
        `Ich rate zu „${stil}“: ${rat}.`;
    }
  }

  else if (t === 'training') {
    const felder = {
      technik: avg(kader, p => p.attributes.technik + p.attributes.passspiel) / 2,
      kondition: avg(kader, p => p.attributes.ausdauer + p.attributes.tempo) / 2,
      defensive: avg(kader, p => p.attributes.zweikampf + p.attributes.positionsspiel) / 2,
      offensive: avg(kader, p => p.attributes.schuss + p.attributes.dribbling) / 2,
      standards: avg(kader, p => p.attributes.standards + p.attributes.kopfball) / 2
    };
    const sortiert = Object.entries(felder).sort((a, b) => a[1] - b[1]);
    const ziel = falsch ? sortiert[sortiert.length - 1] : sortiert[0];
    const namen = { technik: 'Technik', kondition: 'Kondition', defensive: 'Defensivarbeit', offensive: 'Offensivdrill', standards: 'Standards' };
    empfehlung = { art: 'schwerpunkt', schwerpunkt: ziel[0], wert: round(ziel[1], 1) };
    satz = `Wenn Sie mich fragen: Schwerpunkt ${namen[ziel[0]]}. Der Wert liegt bei ${round(ziel[1], 0)} — ` +
      `daran arbeiten wir zwei Wochen, dann sieht das anders aus.`;
  }

  else if (t === 'transfer') {
    const proGruppe = { TW: [], ABW: [], MIT: [], STU: [] };
    for (const p of kader) {
      const gruppe = POSITION_GROUP[p.position] || 'MIT';
      proGruppe[gruppe].push(playerOverall(p));
    }
    const soll = { TW: 2, ABW: 7, MIT: 8, STU: 5 };
    let schwaechste = null, wert = 1e9;
    for (const gruppe in proGruppe) {
      const liste = proGruppe[gruppe].sort((a, b) => b - a);
      const tiefe = liste.length / soll[gruppe];
      const staerke = avg(liste.slice(0, soll[gruppe])) || 0;
      const w = staerke * 0.7 + tiefe * 20;
      if (w < wert) { wert = w; schwaechste = gruppe; }
    }
    if (falsch) {
      const andere = Object.keys(proGruppe).filter(g => g !== schwaechste);
      schwaechste = rng.pick(andere);
    }
    const namen = { TW: 'im Tor', ABW: 'in der Abwehr', MIT: 'im Mittelfeld', STU: 'im Sturm' };
    empfehlung = { art: 'bedarf', gruppe: schwaechste, anzahl: proGruppe[schwaechste].length };
    satz = `Der größte Bedarf ist ${namen[schwaechste]}. Wir haben dort ${proGruppe[schwaechste].length} Mann, ` +
      `und wenn zwei davon umknicken, spielt der Zeugwart. Da müssen wir vor dem Transferschluss etwas machen.`;
  }

  else { // form
    const sorgen = sortBy(kader.filter(p => !p.injury), p => (p.form || 50) + (p.morale || 60) * 0.5).slice(0, 3);
    const gut = sortBy(kader.filter(p => !p.injury), p => ({ key: (p.form || 50) + (p.morale || 60) * 0.5, desc: true })).slice(0, 2);
    const liste = falsch ? gut : sorgen;
    if (!liste.length) {
      satz = 'Zur Form kann ich nichts sagen, wir haben ja kaum jemanden auf dem Platz.';
      empfehlung = { art: 'keine' };
    } else {
      empfehlung = { art: 'form', playerIds: liste.map(p => p.id) };
      satz = `Sorgenkinder: ${liste.map(p => `${p.shortName} (Form ${Math.round(p.form)}, Moral ${Math.round(p.morale)})`).join(', ')}. ` +
        `Mit ${liste[0].shortName} sollten Sie mal unter vier Augen reden, bevor das jemand in die Zeitung trägt.`;
    }
  }

  return {
    ok: true, thema: t, empfehlung, vertrauen,
    coTrainer: { id: co.id, name: co.name, qualitaet: q, spezialisierung: co.spezialisierung },
    text: `${co.name}: „${satz}“`
  };
}

/** Alle Themen auf einmal — für den Stab-Bildschirm. */
export function coTrainerRundumschlag(state, clubId) {
  return THEMEN.map(t => coTrainerRat(state, clubId, t)).filter(r => r.ok);
}

export { THEMEN as CO_TRAINER_THEMEN };
