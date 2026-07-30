/**
 * club/stadium.js — Stadion, Zuschauer, Ticketpreise, Ausbau.
 *
 * Zuständig für: Kapazität und Ränge, Ticketpreise, Zuschauerzahlen und
 * Zuschauereinnahmen, Dauerkarten, Catering/Fanshop/Parkplätze, Rasenpflege,
 * Betriebskosten und Ausbauprojekte.
 *
 * Reine Logik: kein DOM, kein Math.random(), kein Date.now(). Aller Zufall
 * kommt aus einer übergebenen Rng-Instanz (ctx.rng bzw. Parameter `rng`).
 *
 * Alle Aktionen liefern `{ ok:boolean, text:string, … }` — sie werfen keine
 * Exceptions für normale Fehlbedienung.
 *
 * Nachfragemodell (Kurzfassung):
 *   anwesend(Segment) = Kapazität(Segment)
 *                     × Kernauslastung(Verein)          // Fanbasis, Ruf, Stadiongröße, Liga
 *                     × Kontextfaktor                   // Tabelle, Form, Gegner, Wetter, …
 *                     × Preisfaktor(Segment)            // glatte, monoton fallende Kurve
 *   … gedeckelt auf die Segmentkapazität, mit den Dauerkarteninhabern als Untergrenze.
 */

import { clamp, round, formatMoney, nfmt } from '../core/util.js';
import { WEATHER } from '../core/constants.js';
import { SAISON_TAGE } from '../data/leagues.js';

/* ------------------------------------------------------------------ *
 *  Anbindung an club/finances.js
 *
 *  buchen() ist die einzige erlaubte Art, Geld zu bewegen. Damit stadium.js
 *  auch isoliert (Smoke-Test, Teilbau des Projekts) lauffähig bleibt, wird
 *  finances.js weich eingebunden: liegt das Modul vor, wird ausschließlich
 *  dessen buchen() benutzt. Fehlt es, greift ein formatgleicher Notnagel,
 *  der direkt in `finances.ledger` und die Saisonlinie schreibt.
 * ------------------------------------------------------------------ */

let _buchen = null;
try {
  const fin = await import('./finances.js');
  _buchen = typeof fin.buchen === 'function' ? fin.buchen : null;
} catch (e) {
  _buchen = null;     // finances.js noch nicht vorhanden -> Notnagel unten
}

/** Ledger-Kategorie -> Feld in finances.saison (nur für den Notnagel). */
const KATEGORIE_FELD = {
  zuschauer: ['einnahmenZuschauer', 'ausgabenSonstige'],
  merch: ['einnahmenMerch', 'ausgabenSonstige'],
  stadion: ['einnahmenSonstige', 'ausgabenStadion']
};

function buchen(state, clubId, betrag, kategorie, text) {
  if (_buchen) return _buchen(state, clubId, betrag, kategorie, text);
  const club = state.clubs[clubId];
  if (!club) return 0;
  const f = club.finances;
  f.balance = Math.round(f.balance + betrag);
  f.ledger.push({ day: state.date.day, season: state.date.season, betrag: Math.round(betrag), kategorie, text });
  if (f.ledger.length > 2000) f.ledger.splice(0, f.ledger.length - 2000);
  const felder = KATEGORIE_FELD[kategorie] || ['einnahmenSonstige', 'ausgabenSonstige'];
  const feld = betrag >= 0 ? felder[0] : felder[1];
  if (f.saison && f.saison[feld] !== undefined) f.saison[feld] += Math.abs(Math.round(betrag));
  return f.balance;
}

/* ================================================================== *
 *  BALANCING-KONSTANTEN
 * ================================================================== */

/* --- Referenzpreise („marktüblich") ------------------------------- */
const REF_SITZ_SOCKEL = 20;          // € Sitzplatz-Sockel
const REF_SITZ_PRO_REP = 0.34;       // € je Reputationspunkt
const REF_TICKETBASE_GEWICHT = 0.35; // Mischung Formel / club.finances.ticketBase
const REF_STEH_ANTEIL = 0.50;        // Steh  = Anteil vom Sitzplatzpreis
const REF_VIP_ANTEIL = 4.50;         // VIP   = Vielfaches vom Sitzplatzpreis
const REF_DK_ANTEIL = 15.0;          // Dauerkarte = Vielfaches vom Sitzplatzpreis (17 Heimspiele => ~12 % Rabatt)

/* --- Preiselastizität: f(r) = 2 / (1 + r^E), r = Preis/Referenz ---- */
const ELAST_STEH = 1.85;             // Stehplatzpublikum reagiert am härtesten
const ELAST_SITZ = 1.55;
const ELAST_VIP = 1.00;              // Business-Kundschaft ist preisunempfindlich
const ELAST_DK = 1.40;
const PREISFAKTOR_MIN = 0.06;
const PREISFAKTOR_MAX = 1.28;

/* --- Kernauslastung ----------------------------------------------- */
const KERN_SOCKEL = 0.165;
const KERN_PRO_POTENTIAL = 0.0055;
const KERN_PRO_REPUTATION = 0.0028;
const KERN_MITGLIEDER = 0.045;       // je (Mitglieder / Kapazität), gedeckelt
const KERN_MITGLIEDER_MAX = 4.0;
const KERN_KAPAZITAET = 0.20;        // kleine Stadien füllen sich leichter
const KERN_KAP_REFERENZ = 35000;
const KERN_KAP_SPANNE = 3.5;
const LIGA_FAKTOR = { bl1: 1.0, bl2: 0.86 };
const KERN_MIN = 0.22, KERN_MAX = 1.40;

/* --- Kontextfaktoren ---------------------------------------------- */
const TAB_SOCKEL = 1.13, TAB_PRO_PLATZ = 0.013;   // Platz 1 -> 1.13, Platz 18 -> 0.909
const TAB_ABSTIEGSKAMPF = 1.06;                    // späte Saison, Platz >= 14
const FORM_MIN = 0.90, FORM_SPANNE = 0.20;
const GEGNER_SOCKEL = 0.88, GEGNER_PRO_REP = 0.0034;
const DERBY_WIRKUNG = 0.55;          // wie stark derbyFaktor auf die Nachfrage durchschlägt
const SPITZENSPIEL_BONUS = 1.07;
const STIMMUNG_SOCKEL = 0.80, STIMMUNG_PRO_PUNKT = 0.0031;
const PROTEST_WIRKUNG = 0.0016;      // je Protestpunkt
const WETTER_FAKTOR = { sonnig: 1.03, bewoelkt: 1.00, wind: 0.97, regen: 0.93, schnee: 0.86, hitze: 0.97 };
const DACH_DAEMPFUNG = 0.5;          // Dach halbiert den Wettereinfluss
const WOCHENTAG_FAKTOR = [0.90, 0.94, 0.94, 0.94, 0.98, 1.03, 1.00]; // Mo..So
const ANSTOSS_FAKTOR = { '13:30': 0.96, '15:30': 1.02, '17:30': 1.00, '18:30': 1.00, '18:45': 0.99, '20:30': 0.97, '20:45': 0.96 };
const WETTBEWERB_FAKTOR = { bl1: 1.00, bl2: 1.00, pokal: 0.88, europa: 1.12 };
const POKAL_SPAETRUNDE = 1.18;       // ab Viertelfinale
const AUFTAKT_BONUS = 1.05;          // erste Saisonwochen
const WINTER_MALUS = 0.96;
const ENDSPURT_BONUS = 1.04;
const TOTES_SPIEL_MALUS = 0.90;
const KOMFORT_MAX = 1.06, KOMFORT_MIN = 0.94;

/* --- Segmente ------------------------------------------------------ */
const VIP_SOCKEL = 0.006, VIP_PRO_REP = 0.00042, VIP_PRO_RANG = 0.003;
const VIP_MIN = 0.008, VIP_MAX = 0.055;
const SEG_MOD_STEH = 1.06;           // Stehplätze sind zuerst voll
const SEG_MOD_SITZ = 1.00;
const SEG_MOD_VIP = 0.85;            // Logen füllen sich zäher
const DK_ERSCHEINEN_MIN = 0.84, DK_ERSCHEINEN_MAX = 0.97;
const STEH_UEBERLAUF = 0.30;         // Anteil der abgewiesenen Stehplatz-Nachfrage, der auf Sitzplätze ausweicht

/* --- Preisgrenzen --------------------------------------------------- */
const PREIS_MIN = { steh: 4, sitz: 8, vip: 25, dauerkarte: 50 };
const PREIS_MAX_FAKTOR = 4.0;        // maximal das Vierfache des Referenzpreises
const PREISSCHOCK_SCHWELLE = 1.08;   // ab +8 % gibt es Ärger auf den Rängen
const PREISSCHOCK_STIMMUNG = 26;     // max. Stimmungsverlust bei Verdopplung
const PREISSENKUNG_STIMMUNG = 10;    // max. Stimmungsgewinn

/* --- Catering / Fanshop / Parken (pro Kopf, €) ---------------------- */
const GASTRO_SOCKEL = 3.5, GASTRO_PRO_LEVEL = 0.040;
const FANSHOP_SOCKEL = 0.8, FANSHOP_PRO_REP = 0.022;
const PARKEN_SOCKEL = 0.3, PARKEN_PRO_LEVEL = 0.012;
const VIP_CATERING_ZUSCHLAG = 38;    // € pro VIP-Gast zusätzlich
const MUSEUM_BONUS = 1.25;           // Fanshop-Multiplikator mit Museum
const DACH_GASTRO_BONUS = 1.05;

/* --- Betriebskosten -------------------------------------------------- *
 * Der Satz je Platz war so hoch angesetzt, dass er zusammen mit den Abschrei-
 * bungen aus club/finances.js jeden Verein mit großem Stadion in kleiner Liga
 * erwürgt hat (Lautern: 15 Mio Stadionkosten bei 43 Mio Umsatz). Eine leere
 * Betonschüssel kostet Geld, aber nicht so viel. */
const BETRIEB_PRO_PLATZ_JAHR = 95;   // € je Platz und Jahr (Grundlast)
const BETRIEB_DACH = 1.12;
const BETRIEB_PRO_FLUTLICHT = 0.015;
const BETRIEB_PRO_RANG = 0.05;
const BETRIEB_SICHERHEIT = 0.0004;   // je Sicherheitspunkt
const SPIELTAG_KOSTEN_PRO_ZUSCHAUER = 1.35;  // Ordner, Reinigung, Sanitäter

/* --- Rasen ----------------------------------------------------------- */
const RASEN_VERSCHLEISS_TAG = 0.10;
const RASEN_SPIELTAG = 1.7;
const RASEN_REGENERATION = 0.32;
const RASEN_FROST_MALUS = 0.55;      // Dezember–Februar ohne Rasenheizung
const RASEN_PFLEGE_KOSTEN_PRO_PUNKT = 9500;   // € je gewonnenem Zustandspunkt
const RASEN_PFLEGE_MAX = 12;         // max. Punkte je Maßnahme
const RASEN_MAX_OHNE_HEIZUNG = 94;

/* --- Ausbau ----------------------------------------------------------- */
const ANZAHLUNG_ANTEIL = 0.35;       // sofort fällig
const STORNO_ANTEIL = 0.12;          // Vertragsstrafe auf die Restsumme
const BAUKOSTEN_TOLERANZ = 1.0;      // Reserve für spätere Schwierigkeitsgrad-Skalierung

/* --- Dauerkarten ------------------------------------------------------- */
const DK_MAX_ANTEIL = 0.66;          // höchstens 66 % der Kapazität als Dauerkarten
const DK_BASIS_ANTEIL = 0.30;
const DK_ERFOLG_WIRKUNG = 0.14;
const DK_STIMMUNG_WIRKUNG = 0.16;
const DK_STREUUNG = 0.035;           // Zufallsanteil beim Verkauf

/* --- Sonstiges ---------------------------------------------------------- */
const HEIMSPIELE_LIGA = 17;
const ZIEL_AUSLASTUNG = 0.93;        // Zielwert für preisEmpfehlung()

/* ================================================================== *
 *  Interne Helfer
 * ================================================================== */

/** Legt fehlende Stadion-Laufzeitfelder beim ersten Zugriff an. */
function st(club) {
  if (!club.stadiumState) {
    const base = club.finances ? club.finances.ticketBase || 25 : 25;
    club.stadiumState = {
      ausbau: null,
      preise: { sitz: base, steh: Math.round(base * 0.45), vip: Math.round(base * 4.5), dauerkarte: Math.round(base * 17) },
      catering: 50, parkplaetze: 50, sicherheit: 60,
      rasenZustand: club.stadium ? club.stadium.pitch : 80,
      letzteZuschauer: 0, auslastungSchnitt: 0
    };
  }
  const s = club.stadiumState;
  if (s.vipAnteil === undefined) s.vipAnteil = clamp(VIP_SOCKEL + (club.reputation || 50) * VIP_PRO_REP + (club.stadium.tiers || 1) * VIP_PRO_RANG, VIP_MIN, VIP_MAX);
  if (s.rasenheizung === undefined) s.rasenheizung = (club.reputation || 50) >= 70;
  if (s.videowand === undefined) s.videowand = (club.reputation || 50) >= 62;
  if (s.museum === undefined) s.museum = (club.reputation || 50) >= 78;
  if (s.ausbauHistorie === undefined) s.ausbauHistorie = [];
  if (s.heimspiele === undefined) s.heimspiele = 0;
  if (s.zuschauerSumme === undefined) s.zuschauerSumme = 0;
  if (s.saisonEinnahmen === undefined) s.saisonEinnahmen = 0;
  if (s.dauerkartenErloes === undefined) s.dauerkartenErloes = 0;
  if (s.dauerkartenSaison === undefined) s.dauerkartenSaison = 0;
  if (s.letztePreisaenderung === undefined) s.letztePreisaenderung = null;
  return s;
}

function istManager(state, clubId) { return state.managerClubId === clubId; }

/**
 * Zugriff auf den Stadion-Laufzeitzustand eines Vereins (legt fehlende Felder an).
 * Einziger erlaubter Weg für Screens, an preise/rasenZustand/ausbau heranzukommen.
 */
export function stadionState(state, clubId) {
  const club = state.clubs[clubId];
  return club ? st(club) : null;
}

/** Marktübliche Referenzpreise dieses Vereins. */
export function referenzPreise(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { sitz: 25, steh: 12, vip: 110, dauerkarte: 380 };
  const rep = club.reputation || 50;
  const base = (club.finances && club.finances.ticketBase) || 22;
  const sitz = (1 - REF_TICKETBASE_GEWICHT) * (REF_SITZ_SOCKEL + rep * REF_SITZ_PRO_REP)
    + REF_TICKETBASE_GEWICHT * base;
  return {
    sitz: round(sitz, 1),
    steh: round(sitz * REF_STEH_ANTEIL, 1),
    vip: round(sitz * REF_VIP_ANTEIL, 0),
    dauerkarte: round(sitz * REF_DK_ANTEIL, 0)
  };
}

/**
 * Glatte, streng monoton fallende Nachfragekurve.
 * f(1) = 1.0, f(0) -> Deckel, f(unendlich) -> 0. Keine Sprünge, keine Knicke.
 */
function preisFaktor(preis, referenz, elast) {
  const r = Math.max(0.02, preis / Math.max(0.5, referenz));
  return clamp(2 / (1 + Math.pow(r, elast)), PREISFAKTOR_MIN, PREISFAKTOR_MAX);
}

/** Kapazitätsaufteilung des Stadions. */
export function raenge(state, clubId) {
  const club = state.clubs[clubId];
  const s = st(club);
  const cap = Math.max(0, Math.round(club.stadium.capacity || 0));
  const stehAnteil = clamp(club.stadium.standing || 0, 0, 0.45);
  const vipAnteil = clamp(s.vipAnteil, 0, 0.08);
  const steh = Math.round(cap * stehAnteil);
  const vip = Math.round(cap * vipAnteil);
  const sitz = Math.max(0, cap - steh - vip);
  return { gesamt: cap, steh, sitz, vip, stehAnteil, vipAnteil };
}

/** Kernauslastung: wie voll wäre das Stadion bei Normalpreis und Normalgegner? */
function kernAuslastung(club) {
  const cap = Math.max(1000, club.stadium.capacity || 10000);
  const fans = club.fans || club.fanbase || {};
  const potential = fans.potential !== undefined ? fans.potential : 50;
  const rep = club.reputation || 50;
  const mitglieder = clamp((fans.members || 0) / cap, 0, KERN_MITGLIEDER_MAX);
  const kapTerm = clamp(Math.log(KERN_KAP_REFERENZ / cap) / Math.log(KERN_KAP_SPANNE), -0.6, 1) * KERN_KAPAZITAET;
  const liga = LIGA_FAKTOR[club.leagueId] !== undefined ? LIGA_FAKTOR[club.leagueId] : 0.8;
  const kern = KERN_SOCKEL
    + potential * KERN_PRO_POTENTIAL
    + rep * KERN_PRO_REPUTATION
    + mitglieder * KERN_MITGLIEDER
    + kapTerm;
  return clamp(kern * liga, KERN_MIN, KERN_MAX);
}

/** Tabellenplatz eines Vereins (oder null). */
function platzVon(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return null;
  const tab = state.tables && state.tables[club.leagueId];
  if (Array.isArray(tab) && tab.length) {
    const row = tab.find(r => r.clubId === clubId);
    if (row && row.platz) return row.platz;
  }
  if (club.season && club.season.platz) return club.season.platz;
  return null;
}

/** Punkte aus den letzten fünf Spielen (0..15) oder null. */
function formPunkte(state, clubId) {
  const club = state.clubs[clubId];
  let form = club && club.season ? club.season.form : null;
  if ((!form || !form.length) && state.tables && club) {
    const tab = state.tables[club.leagueId];
    const row = Array.isArray(tab) ? tab.find(r => r.clubId === clubId) : null;
    if (row && row.form) form = row.form;
  }
  if (!Array.isArray(form) || !form.length) return null;
  const letzte = form.slice(-5);
  let p = 0;
  for (const e of letzte) {
    const v = typeof e === 'string' ? e.toUpperCase() : '';
    if (v === 'S') p += 3; else if (v === 'U') p += 1;
  }
  return (p / letzte.length) * 5;   // auf fünf Spiele hochgerechnet
}

/** Reputation eines Gegners – auch Amateur- und Europapokalvereine. */
function gegnerReputation(state, id) {
  if (!id) return 50;
  const c = state.clubs[id];
  if (c) return c.reputation || 50;
  if (String(id).startsWith('am_')) return 36;
  return 62;
}

function gegnerName(state, id) {
  const c = state.clubs[id];
  if (c) return c.shortName || c.name;
  return String(id || 'der Gegner').replace(/^am_/, '');
}

function wettbewerbFaktor(fixture) {
  if (!fixture) return 1.0;
  const id = fixture.competitionId || 'bl1';
  if (id === 'pokal') {
    const spaet = ['vf', 'hf', 'fin'].includes(fixture.round);
    return spaet ? POKAL_SPAETRUNDE : WETTBEWERB_FAKTOR.pokal;
  }
  if (WETTBEWERB_FAKTOR[id] !== undefined) return WETTBEWERB_FAKTOR[id];
  return WETTBEWERB_FAKTOR.europa;
}

function anstossVonWochentag(weekday) {
  return ['20:30', '20:45', '20:45', '18:45', '20:30', '15:30', '17:30'][clamp(weekday, 0, 6)];
}

/* ================================================================== *
 *  DERBYS
 * ================================================================== */

/**
 * Echte Rivalitäten. Werte sind Nachfrage-Multiplikatoren 1.0 … 1.6.
 * Format: [idA, idB, faktor, Bezeichnung]
 */
const RIVALITAETEN = [
  ['dortmund', 'schalke', 1.60, 'Revierderby'],
  ['hsv', 'stpauli', 1.58, 'Hamburger Stadtderby'],
  ['nuernberg', 'fuerth', 1.56, 'Frankenderby'],
  ['hannover', 'braunschweig', 1.55, 'Niedersachsenderby'],
  ['hsv', 'bremen', 1.52, 'Nordderby'],
  ['bayern', 'dortmund', 1.50, 'Der Klassiker'],
  ['hertha', 'union', 1.50, 'Berliner Stadtderby'],
  ['koeln', 'gladbach', 1.48, 'Rheinisches Derby'],
  ['bayern', 'am_1860', 1.46, 'Münchner Stadtderby'],
  ['stuttgart', 'ksc', 1.45, 'Baden-Württemberg-Derby'],
  ['dresden', 'magdeburg', 1.45, 'Ostduell'],
  ['kaiserslautern', 'mainz', 1.42, 'Südwestderby'],
  ['frankfurt', 'mainz', 1.42, 'Rhein-Main-Derby'],
  ['frankfurt', 'darmstadt', 1.40, 'Hessenderby'],
  ['kaiserslautern', 'am_saarbruecken', 1.40, 'Pfalz-Saar-Derby'],
  ['wolfsburg', 'braunschweig', 1.40, 'Derby an der Aller'],
  ['leipzig', 'dresden', 1.40, 'Sachsenduell'],
  ['gladbach', 'duesseldorf', 1.38, 'Niederrhein-Derby'],
  ['paderborn', 'bielefeld', 1.38, 'Ostwestfalenderby'],
  ['bayern', 'nuernberg', 1.36, 'Bayernderby'],
  ['dortmund', 'bochum', 1.35, 'Revier-Nachbarschaft'],
  ['schalke', 'bochum', 1.35, 'Revier-Nachbarschaft'],
  ['koeln', 'leverkusen', 1.35, 'Rheinderby'],
  ['koeln', 'duesseldorf', 1.35, 'Rheinderby'],
  ['muenster', 'bielefeld', 1.35, 'Westfalenderby'],
  ['union', 'leipzig', 1.35, 'Ostduell mit Beigeschmack'],
  ['elversberg', 'kaiserslautern', 1.35, 'Saar-Pfalz-Duell'],
  ['dortmund', 'am_rwessen', 1.34, 'Revier-Nachbarschaft'],
  ['schalke', 'am_rwessen', 1.34, 'Revier-Nachbarschaft'],
  ['bochum', 'am_oberhausen', 1.32, 'Revier-Nachbarschaft'],
  ['augsburg', 'bayern', 1.34, 'Bayerisches Derby'],
  ['kiel', 'hsv', 1.32, 'Nordduell'],
  ['wolfsburg', 'hannover', 1.32, 'Niedersachsen-Duell'],
  ['freiburg', 'ksc', 1.32, 'Badisches Derby'],
  ['hoffenheim', 'stuttgart', 1.30, 'Schwaben-Kraichgau'],
  ['hoffenheim', 'ksc', 1.30, 'Badisch-Kurpfälzisch'],
  ['leverkusen', 'gladbach', 1.30, 'Rheinduell'],
  ['kiel', 'stpauli', 1.30, 'Nordduell'],
  ['bremen', 'hannover', 1.30, 'Norddeutsches Duell'],
  ['hsv', 'hannover', 1.30, 'Norddeutsches Duell'],
  ['mainz', 'darmstadt', 1.30, 'Rhein-Main-Duell'],
  ['augsburg', 'nuernberg', 1.28, 'Bayerisches Duell'],
  ['heidenheim', 'stuttgart', 1.28, 'Schwabenduell'],
  ['bielefeld', 'dortmund', 1.28, 'Westfalenduell'],
  ['bayern', 'leipzig', 1.28, 'Tradition gegen Brause'],
  ['dortmund', 'leipzig', 1.28, 'Tradition gegen Brause'],
  ['duesseldorf', 'schalke', 1.25, 'Rhein-Ruhr-Duell'],
  ['magdeburg', 'am_aue', 1.25, 'Ostduell'],
  ['dresden', 'am_aue', 1.30, 'Sachsenderby'],
  ['dresden', 'am_cottbus', 1.30, 'Ostduell'],
  ['am_1860', 'am_unterhaching', 1.28, 'Münchner Vorstadtduell'],
  ['stuttgart', 'am_stuttgarterk', 1.32, 'Stuttgarter Stadtderby'],
  ['koeln', 'am_viktoria', 1.28, 'Kölner Stadtduell'],
  ['freiburg', 'stuttgart', 1.28, 'Ländle-Duell'],
  ['bremen', 'am_oldenburg', 1.25, 'Nordwest-Duell'],
  ['hannover', 'am_havelse', 1.22, 'Regionalduell']
];

const RIVALITAET_INDEX = (() => {
  const map = new Map();
  for (const [a, b, f, name] of RIVALITAETEN) {
    map.set(a + '|' + b, { faktor: f, name });
    map.set(b + '|' + a, { faktor: f, name });
  }
  return map;
})();

const STADT_DERBY = 1.45;
const NACHBAR_DERBY = 1.12;

/**
 * Rivalitätsfaktor zweier Vereine.
 * @returns {number} 1.0 (fremd) … 1.6 (echtes Derby)
 */
export function derbyFaktor(state, homeId, awayId) {
  return derbyInfo(state, homeId, awayId).faktor;
}

/** Wie derbyFaktor(), liefert aber zusätzlich den Namen der Rivalität. */
export function derbyInfo(state, homeId, awayId) {
  if (!homeId || !awayId || homeId === awayId) return { faktor: 1.0, name: null };
  const eintrag = RIVALITAET_INDEX.get(homeId + '|' + awayId);
  if (eintrag) return { faktor: eintrag.faktor, name: eintrag.name };
  const a = state.clubs[homeId], b = state.clubs[awayId];
  if (a && b && a.city && b.city) {
    if (a.city === b.city) return { faktor: STADT_DERBY, name: 'Stadtderby' };
  }
  return { faktor: 1.0, name: null };
}

/** Alle bekannten Rivalen eines Vereins – für den Stadion- und Presseschirm. */
export function rivalenVon(state, clubId) {
  const out = [];
  for (const [a, b, f, name] of RIVALITAETEN) {
    if (a === clubId) out.push({ clubId: b, faktor: f, name });
    else if (b === clubId) out.push({ clubId: a, faktor: f, name });
  }
  return out.sort((x, y) => y.faktor - x.faktor);
}

/* ================================================================== *
 *  ZUSCHAUER
 * ================================================================== */

/**
 * Berechnet Zuschauer und Einnahmen eines Heimspiels.
 *
 * @param {object} state
 * @param {string} clubId    Heimverein
 * @param {object|null} fixture  Spiel aus state.fixtures (null = neutrales Durchschnittsspiel)
 * @param {object} opts
 *   - preise      {sitz,steh,vip}  überschreibt die eingestellten Preise (für Simulationen)
 *   - wetter      Schlüssel aus core/constants.js WEATHER
 *   - anstoss     '15:30' | '20:30' | …
 *   - weekday     0=Mo … 6=So (sonst aus fixture.dayIndex abgeleitet)
 *   - neutral     true = alle Kontextfaktoren auf 1.0 (reine Preis-/Basisbetrachtung)
 *   - verbuchen   true = Einnahmen sofort über buchen() erfassen (Default: false)
 *
 * @returns {{gesamt,sitz,steh,vip,dauerkarten,auslastung,einnahmen,aufschluesselung}}
 */
export function zuschauerBerechnen(state, clubId, fixture = null, opts = {}) {
  const club = state.clubs[clubId];
  if (!club) {
    return { gesamt: 0, sitz: 0, steh: 0, vip: 0, dauerkarten: 0, auslastung: 0, einnahmen: 0, aufschluesselung: {} };
  }
  const s = st(club);
  const r = raenge(state, clubId);
  const ref = referenzPreise(state, clubId);
  const preise = Object.assign({}, s.preise, opts.preise || {});

  const neutral = !!opts.neutral;
  const kern = kernAuslastung(club);

  /* ---- Kontextfaktoren ---- */
  const f = {
    tabelle: 1, form: 1, gegner: 1, derby: 1, stimmung: 1,
    wetter: 1, termin: 1, saisonphase: 1, wettbewerb: 1, komfort: 1
  };
  let derbyName = null;
  let gegnerId = null;

  const tag = fixture && fixture.dayIndex !== undefined ? fixture.dayIndex : state.date.day;
  const weekday = opts.weekday !== undefined ? opts.weekday : ((tag + 1) % 7);
  const wetterKey = opts.wetter && WEATHER[opts.wetter] ? opts.wetter : 'bewoelkt';
  const anstoss = opts.anstoss || anstossVonWochentag(weekday);

  if (!neutral) {
    // Tabellenplatz
    const platz = platzVon(state, clubId);
    if (platz) {
      f.tabelle = TAB_SOCKEL - TAB_PRO_PLATZ * (platz - 1);
      if (platz >= 14 && tag > SAISON_TAGE.rueckrundeStart + 40) f.tabelle *= TAB_ABSTIEGSKAMPF;
    }
    // Form der letzten fünf Spiele
    const fp = formPunkte(state, clubId);
    if (fp !== null) f.form = FORM_MIN + (fp / 15) * FORM_SPANNE;

    // Gegner
    gegnerId = fixture ? (fixture.homeId === clubId ? fixture.awayId : fixture.homeId) : null;
    if (gegnerId) {
      const repG = gegnerReputation(state, gegnerId);
      f.gegner = GEGNER_SOCKEL + (repG - 50) * GEGNER_PRO_REP;
      const d = derbyInfo(state, clubId, gegnerId);
      f.derby = 1 + (d.faktor - 1) * DERBY_WIRKUNG;
      derbyName = d.name;
      const platzG = platzVon(state, gegnerId);
      if (platz && platzG && platz <= 4 && platzG <= 4) f.gegner *= SPITZENSPIEL_BONUS;
    }

    // Stimmung auf den Rängen
    const fans = club.fans || {};
    const mood = fans.mood !== undefined ? fans.mood : 60;
    f.stimmung = STIMMUNG_SOCKEL + mood * STIMMUNG_PRO_PUNKT - (fans.protest || 0) * PROTEST_WIRKUNG;

    // Wetter (Dach dämpft)
    const w = WETTER_FAKTOR[wetterKey] !== undefined ? WETTER_FAKTOR[wetterKey] : 1;
    f.wetter = club.stadium.roof ? 1 + (w - 1) * DACH_DAEMPFUNG : w;

    // Wochentag und Anstoßzeit
    f.termin = WOCHENTAG_FAKTOR[clamp(weekday, 0, 6)] * (ANSTOSS_FAKTOR[anstoss] !== undefined ? ANSTOSS_FAKTOR[anstoss] : 1);

    // Saisonphase
    if (tag <= SAISON_TAGE.ligaStart + 30) f.saisonphase = AUFTAKT_BONUS;
    else if (tag >= SAISON_TAGE.hinrundeEnde - 25 && tag <= SAISON_TAGE.rueckrundeStart + 25) f.saisonphase = WINTER_MALUS;
    else if (tag >= SAISON_TAGE.saisonEnde - 25) {
      const relevant = platz ? (platz <= 7 || platz >= 13) : true;
      f.saisonphase = relevant ? ENDSPURT_BONUS : TOTES_SPIEL_MALUS;
    }

    f.wettbewerb = wettbewerbFaktor(fixture);

    // Komfort: Dach, Flutlicht, Videowand, Sicherheit, Rasen
    const komfort = 1
      + (club.stadium.roof ? 0.015 : 0)
      + (club.stadium.floodlight || 3) * 0.004
      + (s.videowand ? 0.010 : 0)
      + (s.sicherheit - 60) * 0.0004
      + (s.rasenZustand - 80) * 0.0003
      - 0.030;
    f.komfort = clamp(komfort, KOMFORT_MIN, KOMFORT_MAX);
  }

  const kontext = f.tabelle * f.form * f.gegner * f.derby * f.stimmung
    * f.wetter * f.termin * f.saisonphase * f.wettbewerb * f.komfort;

  /* ---- Nachfrage je Segment ---- */
  const basis = kern * kontext;
  const nStehRoh = r.steh * basis * SEG_MOD_STEH * preisFaktor(preise.steh, ref.steh, ELAST_STEH);
  const nSitzRoh = r.sitz * basis * SEG_MOD_SITZ * preisFaktor(preise.sitz, ref.sitz, ELAST_SITZ);
  const nVipRoh = r.vip * basis * SEG_MOD_VIP * preisFaktor(preise.vip, ref.vip, ELAST_VIP);

  let steh = Math.min(r.steh, nStehRoh);
  const ueberlauf = Math.max(0, nStehRoh - r.steh) * STEH_UEBERLAUF;
  let sitz = Math.min(r.sitz, nSitzRoh + Math.min(ueberlauf, Math.max(0, r.sitz - nSitzRoh)));
  let vip = Math.min(r.vip, nVipRoh);

  /* ---- Dauerkarten als Untergrenze ---- */
  const dkGesamt = clamp(Math.round((club.fans && club.fans.dauerkarten) || 0), 0, r.steh + r.sitz);
  const dkAnteilSteh = (r.steh + r.sitz) > 0 ? r.steh / (r.steh + r.sitz) : 0;
  const dkSteh = Math.round(dkGesamt * dkAnteilSteh);
  const dkSitz = dkGesamt - dkSteh;
  const erscheinen = clamp(DK_ERSCHEINEN_MIN + (kontext - 1) * 0.35, DK_ERSCHEINEN_MIN, DK_ERSCHEINEN_MAX);
  const dkAnwesendSteh = Math.min(r.steh, dkSteh * erscheinen);
  const dkAnwesendSitz = Math.min(r.sitz, dkSitz * erscheinen);
  steh = Math.max(steh, dkAnwesendSteh);
  sitz = Math.max(sitz, dkAnwesendSitz);

  steh = Math.round(steh); sitz = Math.round(sitz); vip = Math.round(vip);
  const gesamt = steh + sitz + vip;
  const auslastung = r.gesamt > 0 ? gesamt / r.gesamt : 0;

  /* ---- Einnahmen: nur Tageskarten fließen am Spieltag ---- */
  const tagesSteh = Math.max(0, steh - dkAnwesendSteh);
  const tagesSitz = Math.max(0, sitz - dkAnwesendSitz);
  const erloesSteh = Math.round(tagesSteh * preise.steh);
  const erloesSitz = Math.round(tagesSitz * preise.sitz);
  const erloesVip = Math.round(vip * preise.vip);
  const einnahmen = erloesSteh + erloesSitz + erloesVip;
  const dkAnteil = Math.round((s.dauerkartenErloes || 0) / HEIMSPIELE_LIGA);

  const ergebnis = {
    gesamt, sitz, steh, vip,
    dauerkarten: Math.round(dkAnwesendSteh + dkAnwesendSitz),
    auslastung: round(auslastung, 4),
    einnahmen,
    aufschluesselung: {
      kapazitaet: r.gesamt,
      kapSteh: r.steh, kapSitz: r.sitz, kapVip: r.vip,
      preise: { steh: preise.steh, sitz: preise.sitz, vip: preise.vip },
      referenz: ref,
      erloesSteh, erloesSitz, erloesVip,
      dauerkartenAnteil: dkAnteil,
      gesamtwert: einnahmen + dkAnteil,
      dauerkartenVerkauft: dkGesamt,
      kern: round(kern, 4),
      kontext: round(kontext, 4),
      faktoren: {
        tabelle: round(f.tabelle, 3), form: round(f.form, 3), gegner: round(f.gegner, 3),
        derby: round(f.derby, 3), stimmung: round(f.stimmung, 3), wetter: round(f.wetter, 3),
        termin: round(f.termin, 3), saisonphase: round(f.saisonphase, 3),
        wettbewerb: round(f.wettbewerb, 3), komfort: round(f.komfort, 3)
      },
      derbyName,
      gegnerId,
      wetter: wetterKey,
      anstoss
    }
  };

  if (opts.verbuchen) verbucheSpieltag(state, clubId, ergebnis, fixture);
  return ergebnis;
}

/** Bucht Ticket- und Cateringerlöse sowie die Spieltagskosten. */
function verbucheSpieltag(state, clubId, z, fixture) {
  const club = state.clubs[clubId];
  const s = st(club);
  const gegner = fixture ? gegnerName(state, fixture.homeId === clubId ? fixture.awayId : fixture.homeId) : 'Heimspiel';
  buchen(state, clubId, z.einnahmen, 'zuschauer', `Zuschauereinnahmen gegen ${gegner} (${nfmt(z.gesamt)})`);

  const cat = cateringErtrag(state, clubId, z);
  buchen(state, clubId, cat.gesamt, 'merch', `Catering, Fanshop und Parken gegen ${gegner}`);

  const kosten = Math.round(z.gesamt * SPIELTAG_KOSTEN_PRO_ZUSCHAUER);
  buchen(state, clubId, -kosten, 'stadion', `Spieltagsbetrieb gegen ${gegner}`);

  s.letzteZuschauer = z.gesamt;
  s.heimspiele = (s.heimspiele || 0) + 1;
  s.zuschauerSumme = (s.zuschauerSumme || 0) + z.gesamt;
  s.saisonEinnahmen = (s.saisonEinnahmen || 0) + z.einnahmen + cat.gesamt - kosten;
  s.auslastungSchnitt = round(s.zuschauerSumme / Math.max(1, s.heimspiele) / Math.max(1, club.stadium.capacity), 4);
  return { catering: cat, kosten };
}

/**
 * Komplette Spieltagsabrechnung: berechnet die Zuschauer und verbucht alles.
 * Einstiegspunkt für den Spieltagsablauf.
 */
export function spieltagAbrechnen(state, clubId, fixture, opts = {}) {
  return zuschauerBerechnen(state, clubId, fixture, Object.assign({}, opts, { verbuchen: true }));
}

/**
 * Heimvorteil-Beitrag des Stadions für engine/match.js.
 * @returns {{wert:number, auslastung:number, text:string}} wert 0..1
 */
export function heimvorteil(state, clubId, z = null) {
  const club = state.clubs[clubId];
  if (!club) return { wert: 0.5, auslastung: 0, text: 'Unbekanntes Stadion' };
  const s = st(club);
  const auslastung = z ? z.auslastung : (s.auslastungSchnitt || 0.7);
  const stehAnteil = clamp(club.stadium.standing || 0, 0, 0.45);
  const ultras = clamp(((club.fans && club.fans.ultras) || 40) / 100, 0, 1);
  const mood = clamp(((club.fans && club.fans.mood) || 60) / 100, 0, 1);
  const dach = club.stadium.roof ? 0.06 : 0;      // Lautstärke bleibt drin
  const wert = clamp(
    0.10 + auslastung * 0.52 + stehAnteil * 0.55 + ultras * 0.16 + mood * 0.12 + dach,
    0, 1
  );
  let text;
  if (wert >= 0.82) text = 'Ein Hexenkessel. Der Gegner versteht sein eigenes Wort nicht.';
  else if (wert >= 0.66) text = 'Ordentlich Betrieb – hier spielt es sich angenehm.';
  else if (wert >= 0.48) text = 'Solide Kulisse, aber kein Sturm der Begeisterung.';
  else if (wert >= 0.30) text = 'Halbleere Ränge. Man hört den Trainer meckern.';
  else text = 'Gespenstisch. Die Hausmeisterin zählt mit.';
  return { wert: round(wert, 3), auslastung: round(auslastung, 3), text };
}

/* ================================================================== *
 *  PREISE
 * ================================================================== */

const PREIS_LABEL = { steh: 'Stehplatz', sitz: 'Sitzplatz', vip: 'VIP-Loge', dauerkarte: 'Dauerkarte' };

/**
 * Setzt die Ticketpreise. Kräftige Erhöhungen kosten Stimmung.
 * @param {object} preise { sitz, steh, vip, dauerkarte } – Teilangaben erlaubt
 */
export function preiseSetzen(state, clubId, preise = {}) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.' };
  const s = st(club);
  const ref = referenzPreise(state, clubId);
  const alt = Object.assign({}, s.preise);
  const neu = Object.assign({}, alt);
  const fehler = [];

  for (const key of ['steh', 'sitz', 'vip', 'dauerkarte']) {
    if (preise[key] === undefined || preise[key] === null) continue;
    const v = Math.round(Number(preise[key]));
    if (!isFinite(v)) { fehler.push(`${PREIS_LABEL[key]}: das ist keine Zahl.`); continue; }
    const min = PREIS_MIN[key];
    const max = Math.round(ref[key] * PREIS_MAX_FAKTOR);
    if (v < min) { fehler.push(`${PREIS_LABEL[key]}: unter ${min} € macht die Geschäftsstelle nicht mit.`); continue; }
    if (v > max) { fehler.push(`${PREIS_LABEL[key]}: mehr als ${max} € nimmt Ihnen kein Mensch ab.`); continue; }
    neu[key] = v;
  }
  if (fehler.length) return { ok: false, text: fehler.join(' '), preise: alt };

  // Gewichtete Preisänderung für die Stimmungswirkung (Dauerkarte zählt halb)
  const r = raenge(state, clubId);
  const gew = { steh: r.steh, sitz: r.sitz, vip: r.vip * 0.2, dauerkarte: (r.steh + r.sitz) * 0.25 };
  let gewSumme = 0, verhaeltnis = 0;
  for (const key of ['steh', 'sitz', 'vip', 'dauerkarte']) {
    const g = gew[key] || 0;
    if (g <= 0 || alt[key] <= 0) continue;
    gewSumme += g;
    verhaeltnis += g * (neu[key] / alt[key]);
  }
  const schnitt = gewSumme > 0 ? verhaeltnis / gewSumme : 1;

  s.preise = neu;
  s.letztePreisaenderung = { day: state.date.day, season: state.date.season, schnitt: round(schnitt, 3) };

  let stimmungsEffekt = 0;
  const fans = club.fans || (club.fans = { mood: 60, protest: 0 });
  if (schnitt > PREISSCHOCK_SCHWELLE) {
    const ueber = clamp((schnitt - PREISSCHOCK_SCHWELLE) / (2 - PREISSCHOCK_SCHWELLE), 0, 1);
    stimmungsEffekt = -Math.round(PREISSCHOCK_STIMMUNG * Math.pow(ueber, 0.8));
    fans.mood = clamp((fans.mood || 60) + stimmungsEffekt, 0, 100);
    fans.protest = clamp((fans.protest || 0) - stimmungsEffekt * 0.8, 0, 100);
  } else if (schnitt < 0.96) {
    const unter = clamp((0.96 - schnitt) / 0.46, 0, 1);
    stimmungsEffekt = Math.round(PREISSENKUNG_STIMMUNG * unter);
    fans.mood = clamp((fans.mood || 60) + stimmungsEffekt, 0, 100);
    fans.protest = clamp((fans.protest || 0) - stimmungsEffekt, 0, 100);
  }

  const teile = [];
  for (const key of ['steh', 'sitz', 'vip', 'dauerkarte']) {
    if (neu[key] !== alt[key]) teile.push(`${PREIS_LABEL[key]} ${alt[key]} € → ${neu[key]} €`);
  }
  let text;
  if (!teile.length) text = 'Nichts geändert. Auch eine Entscheidung.';
  else if (stimmungsEffekt <= -12) text = `${teile.join(', ')}. Die Fanabteilung tobt – und der Ultra-Vorsänger hat schon ein Transparent bestellt.`;
  else if (stimmungsEffekt < 0) text = `${teile.join(', ')}. Auf der Südtribüne wird gemurrt, aber gezahlt.`;
  else if (stimmungsEffekt > 0) text = `${teile.join(', ')}. Die Fans loben Sie in den höchsten Tönen. Der Kassenwart weniger.`;
  else text = `${teile.join(', ')}. Zur Kenntnis genommen.`;

  return { ok: true, text, preise: Object.assign({}, neu), alt, stimmungsEffekt, schnitt: round(schnitt, 3) };
}

/**
 * Empfohlene Preise: sucht die Preisstufe, bei der die erwartete Auslastung
 * nahe ZIEL_AUSLASTUNG liegt – also möglichst voll, aber nicht verschenkt.
 * @returns {{ok, preise, aktuell, referenz, erwarteteAuslastung, mehrerloes, begruendung, text}}
 */
export function preisEmpfehlung(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.' };
  const s = st(club);
  const ref = referenzPreise(state, clubId);
  const aktuell = Object.assign({}, s.preise);

  const bewerte = (skala) => zuschauerBerechnen(state, clubId, null, {
    neutral: true,
    preise: { steh: ref.steh * skala, sitz: ref.sitz * skala, vip: ref.vip * skala }
  });

  // Bisektion über einen gemeinsamen Preis-Skalierungsfaktor.
  let lo = 0.70, hi = 3.0;
  for (let i = 0; i < 34; i++) {
    const mid = (lo + hi) / 2;
    if (bewerte(mid).auslastung > ZIEL_AUSLASTUNG) lo = mid; else hi = mid;
  }
  const skala = clamp((lo + hi) / 2, 0.70, 3.0);

  const empfohlen = {
    steh: Math.max(PREIS_MIN.steh, Math.round(ref.steh * skala)),
    sitz: Math.max(PREIS_MIN.sitz, Math.round(ref.sitz * skala)),
    vip: Math.max(PREIS_MIN.vip, Math.round(ref.vip * skala / 5) * 5),
    dauerkarte: Math.max(PREIS_MIN.dauerkarte, Math.round(ref.dauerkarte * skala / 10) * 10)
  };

  const jetzt = zuschauerBerechnen(state, clubId, null, { neutral: true });
  const dann = zuschauerBerechnen(state, clubId, null, { neutral: true, preise: empfohlen });
  const mehrerloes = (dann.einnahmen - jetzt.einnahmen) * HEIMSPIELE_LIGA;

  const begruendung = [];
  begruendung.push(`Marktüblich für einen Verein Ihrer Größe: Steh ${ref.steh} €, Sitz ${ref.sitz} €, VIP ${ref.vip} €.`);
  if (skala > 1.12) begruendung.push('Ihr Stadion ist chronisch ausverkauft – da ist Luft nach oben beim Preis.');
  else if (skala < 0.9) begruendung.push('Die Ränge bleiben leer. Günstigere Karten füllen das Stadion und die Kasse gleich mit.');
  else begruendung.push('Ihre Preise liegen im Rahmen. Große Sprünge lohnen sich nicht.');
  const mood = (club.fans && club.fans.mood) || 60;
  if (mood < 45) begruendung.push('Bei dieser Stimmung wäre eine Preiserhöhung ein Griff ins Wespennest.');
  if ((club.fans && club.fans.dauerkarten || 0) > club.stadium.capacity * 0.55) {
    begruendung.push('Über die Hälfte der Plätze ist per Dauerkarte vergeben – Tagespreise wirken dadurch nur begrenzt.');
  }
  begruendung.push(`Erwartete Auslastung mit der Empfehlung: ${round(dann.auslastung * 100, 1)} %.`);

  return {
    ok: true,
    preise: empfohlen,
    aktuell,
    referenz: ref,
    erwarteteAuslastung: round(dann.auslastung, 3),
    mehrerloes: Math.round(mehrerloes),
    begruendung,
    text: `Empfehlung der Geschäftsstelle: Steh ${empfohlen.steh} €, Sitz ${empfohlen.sitz} €, ` +
      `VIP ${empfohlen.vip} €, Dauerkarte ${empfohlen.dauerkarte} €. ` +
      (mehrerloes >= 0
        ? `Das brächte über die Saison rund ${formatMoney(mehrerloes)} zusätzlich.`
        : `Das kostet zwar rund ${formatMoney(-mehrerloes)}, füllt aber die Ränge.`)
  };
}

/* ================================================================== *
 *  DAUERKARTEN
 * ================================================================== */

/**
 * Dauerkartenverkauf zum Saisonstart. Setzt club.fans.dauerkarten und
 * verbucht den Erlös (Kategorie 'zuschauer').
 */
export function dauerkartenVerkauf(state, clubId, rng) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.', anzahl: 0, einnahmen: 0 };
  const s = st(club);
  const r = raenge(state, clubId);
  const ref = referenzPreise(state, clubId);
  const kern = kernAuslastung(club);
  const fans = club.fans || {};
  const mood = fans.mood !== undefined ? fans.mood : 60;

  const preisF = preisFaktor(s.preise.dauerkarte, ref.dauerkarte, ELAST_DK);
  const erfolg = clamp(((club.reputation || 50) - 50) / 50, -1, 1);
  const stimmung = clamp((mood - 60) / 40, -1, 1);

  let anteil = (DK_BASIS_ANTEIL + kern * 0.34)
    * preisF
    * (1 + erfolg * DK_ERFOLG_WIRKUNG)
    * (1 + stimmung * DK_STIMMUNG_WIRKUNG);
  if (rng && rng.gauss) anteil *= 1 + rng.gauss(0, DK_STREUUNG);
  anteil = clamp(anteil, 0.03, DK_MAX_ANTEIL);

  const verkaufbar = r.steh + r.sitz;
  const anzahl = Math.round(verkaufbar * anteil);
  const einnahmen = Math.round(anzahl * s.preise.dauerkarte);

  club.fans = club.fans || {};
  club.fans.dauerkarten = anzahl;
  s.dauerkartenErloes = einnahmen;
  s.dauerkartenSaison = state.date.season;
  s.heimspiele = 0; s.zuschauerSumme = 0; s.saisonEinnahmen = einnahmen; s.auslastungSchnitt = 0;

  buchen(state, clubId, einnahmen, 'zuschauer', `Dauerkartenverkauf Saison ${state.date.season} (${nfmt(anzahl)} Stück)`);

  const quote = verkaufbar > 0 ? anzahl / verkaufbar : 0;
  let text;
  if (quote > 0.6) text = `${nfmt(anzahl)} Dauerkarten verkauft – die Geschäftsstelle musste zweimal nachdrucken lassen.`;
  else if (quote > 0.42) text = `${nfmt(anzahl)} Dauerkarten verkauft. Ein solides Grundrauschen für die Saison.`;
  else if (quote > 0.25) text = `${nfmt(anzahl)} Dauerkarten verkauft. Ausbaufähig, sagt der Vorstand mit hochgezogener Augenbraue.`;
  else text = `Nur ${nfmt(anzahl)} Dauerkarten verkauft. Der Vertriebsleiter starrt seit Tagen aus dem Fenster.`;

  return { ok: true, text, anzahl, einnahmen, quote: round(quote, 3) };
}

/* ================================================================== *
 *  CATERING
 * ================================================================== */

/**
 * Erlös aus Gastronomie, Fanshop und Parkplätzen eines Spieltags.
 * @param {number|object} zuschauer  Zuschauerzahl oder Ergebnis von zuschauerBerechnen()
 * @returns {{gesamt, proKopf, gastro, fanshop, parken, vipZuschlag}}
 */
export function cateringErtrag(state, clubId, zuschauer) {
  const club = state.clubs[clubId];
  if (!club) return { gesamt: 0, proKopf: 0, gastro: 0, fanshop: 0, parken: 0, vipZuschlag: 0 };
  const s = st(club);
  const z = typeof zuschauer === 'number'
    ? { gesamt: Math.max(0, Math.round(zuschauer)), vip: 0 }
    : { gesamt: Math.max(0, Math.round(zuschauer.gesamt || 0)), vip: Math.max(0, Math.round(zuschauer.vip || 0)) };

  const rep = club.reputation || 50;
  const gastroProKopf = (GASTRO_SOCKEL + s.catering * GASTRO_PRO_LEVEL)
    * (1 + rep / 400)
    * (club.stadium.roof ? DACH_GASTRO_BONUS : 1);
  const fanshopProKopf = (FANSHOP_SOCKEL + rep * FANSHOP_PRO_REP) * (s.museum ? MUSEUM_BONUS : 1);
  const parkenProKopf = PARKEN_SOCKEL + s.parkplaetze * PARKEN_PRO_LEVEL;

  const gastro = Math.round(z.gesamt * gastroProKopf);
  const fanshop = Math.round(z.gesamt * fanshopProKopf);
  const parken = Math.round(z.gesamt * parkenProKopf);
  const vipZuschlag = Math.round(z.vip * VIP_CATERING_ZUSCHLAG);
  const gesamt = gastro + fanshop + parken + vipZuschlag;

  return {
    gesamt, gastro, fanshop, parken, vipZuschlag,
    proKopf: z.gesamt > 0 ? round(gesamt / z.gesamt, 2) : 0
  };
}

/* ================================================================== *
 *  RASEN
 * ================================================================== */

/**
 * Zusätzliche Rasenpflege. Kostet Geld, hebt den Zustandswert.
 * @param {number} intensitaet 0..100
 */
export function rasenPflegen(state, clubId, intensitaet = 50) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.' };
  const s = st(club);
  const i = clamp(Number(intensitaet) || 0, 0, 100);
  if (i <= 0) return { ok: false, text: 'Ohne Intensität wächst auch kein Gras.' };

  const maxWert = s.rasenheizung ? 99 : RASEN_MAX_OHNE_HEIZUNG;
  const luft = maxWert - s.rasenZustand;
  if (luft <= 0.5) {
    return { ok: false, text: 'Der Platz ist bereits in Wimbledon-Zustand. Der Greenkeeper bittet, ihn in Ruhe zu lassen.' };
  }
  const gewinn = Math.min(luft, RASEN_PFLEGE_MAX * (i / 100));
  const kosten = Math.round(gewinn * RASEN_PFLEGE_KOSTEN_PRO_PUNKT);
  if (club.finances.balance < kosten) {
    return { ok: false, text: `Dafür fehlt das Geld. Die Rechnung läge bei ${formatMoney(kosten)}.`, kosten };
  }

  s.rasenZustand = clamp(round(s.rasenZustand + gewinn, 1), 0, 99);
  club.stadium.pitch = Math.round(s.rasenZustand);
  buchen(state, clubId, -kosten, 'stadion', 'Rasenpflege und Platzarbeiten');

  let text;
  if (gewinn >= 8) text = `Vertikutiert, gedüngt, nachgesät: Der Rasen liegt wie ein Billardtuch (${Math.round(s.rasenZustand)}). Kostenpunkt ${formatMoney(kosten)}.`;
  else if (gewinn >= 4) text = `Der Platzwart hat ganze Arbeit geleistet – Rasen jetzt bei ${Math.round(s.rasenZustand)}. ${formatMoney(kosten)}.`;
  else text = `Ein bisschen Kosmetik am Grün (${Math.round(s.rasenZustand)}) für ${formatMoney(kosten)}.`;

  return { ok: true, text, kosten, gewinn: round(gewinn, 1), rasen: Math.round(s.rasenZustand) };
}

/* ================================================================== *
 *  AUSBAUSTUFEN
 * ================================================================== */

const V = {
  immer: { text: '', pruef: () => true },
  keinDach: { text: 'Nur ohne vorhandene Überdachung.', pruef: (club) => !club.stadium.roof },
  hatDach: { text: 'Setzt eine Überdachung voraus.', pruef: (club) => !!club.stadium.roof },
  flutlicht: { text: 'Nur solange die Flutlichtstufe unter 5 liegt.', pruef: (club) => (club.stadium.floodlight || 0) < 5 },
  keineHeizung: { text: 'Nur ohne vorhandene Rasenheizung.', pruef: (club, s) => !s.rasenheizung },
  keinRang3: { text: 'Nur bei Stadien mit weniger als drei Rängen.', pruef: (club) => (club.stadium.tiers || 1) < 3 },
  keineVideowand: { text: 'Nur ohne vorhandene Videowand.', pruef: (club, s) => !s.videowand },
  keinMuseum: { text: 'Nur ohne Vereinsmuseum.', pruef: (club, s) => !s.museum },
  hatSteh: { text: 'Setzt mindestens 8 % Stehplätze voraus.', pruef: (club) => (club.stadium.standing || 0) >= 0.08 },
  wenigSteh: { text: 'Setzt höchstens 30 % Stehplätze voraus.', pruef: (club) => (club.stadium.standing || 0) <= 0.30 },
  grossverein: { text: 'Setzt einen Ruf von mindestens 70 voraus.', pruef: (club) => (club.reputation || 0) >= 70 },
  catering: { text: 'Nur solange die Gastronomie unter 90 liegt.', pruef: (club, s) => s.catering < 90 },
  parken: { text: 'Nur solange die Parkplatzlage unter 90 liegt.', pruef: (club, s) => s.parkplaetze < 90 },
  sicherheit: { text: 'Nur solange die Sicherheitstechnik unter 90 liegt.', pruef: (club, s) => s.sicherheit < 90 }
};

/**
 * Alle Ausbauprojekte.
 * `effekt` wird bei Fertigstellung generisch angewendet:
 *   plaetze      +Plätze (Kapazität)
 *   stehDelta    Änderung des Stehplatzanteils (absolut, z. B. -0.10)
 *   vipDelta     Änderung des VIP-Anteils
 *   tiers/floodlight/roof/pitch  Stadionwerte
 *   catering/parkplaetze/sicherheit  Levels 0..100
 *   rasenheizung/videowand/museum    Schalter
 *   moodDelta    Sofortwirkung auf die Fanstimmung
 */
export const AUSBAUSTUFEN = [
  {
    id: 'tribuene_klein', kategorie: 'kapazitaet', name: 'Zusatztribüne',
    desc: 'Eine schlichte Stahlrohrtribüne hinter dem Tor. Nicht schön, aber 4.000 zahlende Kehlen mehr.',
    kosten: 15500000, dauerTage: 180,
    effekt: { plaetze: 4000, stehDelta: 0.02 }, voraussetzung: V.immer
  },
  {
    id: 'tribuene_mittel', kategorie: 'kapazitaet', name: 'Ränge erweitern',
    desc: 'Beide Hintertortribünen aufstocken. 10.000 Plätze mehr – und zwei Jahre Baulärm.',
    kosten: 43000000, dauerTage: 300,
    effekt: { plaetze: 10000 }, voraussetzung: V.immer
  },
  {
    id: 'tribuene_gross', kategorie: 'kapazitaet', name: 'Großausbau',
    desc: 'Der ganz große Wurf: 18.000 zusätzliche Plätze rundum. Der Kämmerer wird blass.',
    kosten: 82000000, dauerTage: 400,
    effekt: { plaetze: 18000 }, voraussetzung: V.grossverein
  },
  {
    id: 'oberrang', kategorie: 'kapazitaet', name: 'Zweiter Rang',
    desc: 'Ein kompletter Oberrang auf die Haupttribüne. Steil, hoch, laut.',
    kosten: 58000000, dauerTage: 360,
    effekt: { plaetze: 12000, tiers: 1 }, voraussetzung: V.keinRang3
  },
  {
    id: 'dach', kategorie: 'komfort', name: 'Stadiondach',
    desc: 'Überdachung aller Ränge. Der Regen bleibt draußen, der Lärm bleibt drin.',
    kosten: 24000000, dauerTage: 200,
    effekt: { roof: true, moodDelta: 4 }, voraussetzung: V.keinDach
  },
  {
    id: 'flutlicht', kategorie: 'technik', name: 'Flutlichtanlage',
    desc: 'Eine Stufe heller. Dienstagabend, Nebel, Flutlicht – so muss Fußball riechen.',
    kosten: 5800000, dauerTage: 90,
    effekt: { floodlight: 1 }, voraussetzung: V.flutlicht
  },
  {
    id: 'rasenheizung', kategorie: 'platz', name: 'Rasenheizung',
    desc: 'Schluss mit Ausfällen im Januar. 40 Kilometer Rohr unter dem Grün.',
    kosten: 3200000, dauerTage: 60,
    effekt: { rasenheizung: true, pitch: 4 }, voraussetzung: V.keineHeizung
  },
  {
    id: 'hybridrasen', kategorie: 'platz', name: 'Hybridrasen',
    desc: 'Kunstfaser im Naturrasen. Hält auch, wenn die Alten Herren am Sonntag drauf dürfen.',
    kosten: 2600000, dauerTage: 40,
    effekt: { pitch: 10 }, voraussetzung: V.immer
  },
  {
    id: 'vip_logen', kategorie: 'erloes', name: 'VIP-Logen',
    desc: 'Businessplätze mit Buffet und Panoramascheibe. Der Sponsor will schließlich sitzen.',
    kosten: 14000000, dauerTage: 150,
    effekt: { vipDelta: 0.014, catering: 6 }, voraussetzung: V.immer
  },
  {
    id: 'videowand', kategorie: 'technik', name: 'Videowand',
    desc: 'Zwei riesige Anzeigetafeln. Wiederholungen strittiger Szenen nur bei Heimtoren.',
    kosten: 4500000, dauerTage: 70,
    effekt: { videowand: true, moodDelta: 3 }, voraussetzung: V.keineVideowand
  },
  {
    id: 'parkplaetze', kategorie: 'erloes', name: 'Parkhaus & Zufahrt',
    desc: 'Endlich kommt man nach dem Abpfiff vor Mitternacht heim.',
    kosten: 7200000, dauerTage: 120,
    effekt: { parkplaetze: 30 }, voraussetzung: V.parken
  },
  {
    id: 'museum', kategorie: 'erloes', name: 'Museum & Fanshop',
    desc: 'Vereinsmuseum mit Pokalvitrine und einem Fanshop, der auch dienstags offen hat.',
    kosten: 9500000, dauerTage: 160,
    effekt: { museum: true, moodDelta: 5 }, voraussetzung: V.keinMuseum
  },
  {
    id: 'gastronomie', kategorie: 'erloes', name: 'Gastronomie-Ausbau',
    desc: 'Mehr Zapfhähne, kürzere Schlangen. Rechnet sich schneller als jede Tribüne.',
    kosten: 8000000, dauerTage: 120,
    effekt: { catering: 25 }, voraussetzung: V.catering
  },
  {
    id: 'sitzumbau', kategorie: 'kapazitaet', name: 'Sitzplatzumbau',
    desc: 'Stehplätze werden bestuhlt. Bringt Geld pro Kopf – und garantiert Ärger mit der Kurve.',
    kosten: 11000000, dauerTage: 140,
    effekt: { stehDelta: -0.10, plaetze: -1200, moodDelta: -12 }, voraussetzung: V.hatSteh
  },
  {
    id: 'stehplatzumbau', kategorie: 'kapazitaet', name: 'Stehplatzrückbau',
    desc: 'Sitze raus, Wellenbrecher rein. Die Kurve jubelt, der Ligaverband seufzt.',
    kosten: 6500000, dauerTage: 110,
    effekt: { stehDelta: 0.09, plaetze: 1400, moodDelta: 9 }, voraussetzung: V.wenigSteh
  },
  {
    id: 'sicherheit', kategorie: 'technik', name: 'Sicherheitstechnik',
    desc: 'Kameras, Drehkreuze, getrennte Blockzugänge. Senkt Strafen und Betriebskosten.',
    kosten: 5500000, dauerTage: 100,
    effekt: { sicherheit: 28 }, voraussetzung: V.sicherheit
  }
];

export const AUSBAU_BY_ID = AUSBAUSTUFEN.reduce((m, a) => { m[a.id] = a; return m; }, {});

/** Was kostet die Stufe diesen Verein konkret? (Reserve für Skalierungen) */
export function ausbauKosten(state, clubId, stufeId) {
  const stufe = AUSBAU_BY_ID[stufeId];
  if (!stufe) return 0;
  return Math.round(stufe.kosten * BAUKOSTEN_TOLERANZ);
}

/** Liste aller Stufen mit Verfügbarkeit für einen Verein – für den Bildschirm. */
export function ausbauAngebot(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return [];
  const s = st(club);
  return AUSBAUSTUFEN.map(stufe => {
    const erlaubt = stufe.voraussetzung.pruef(club, s);
    const kosten = ausbauKosten(state, clubId, stufe.id);
    return {
      id: stufe.id, name: stufe.name, desc: stufe.desc, kategorie: stufe.kategorie,
      kosten, dauerTage: stufe.dauerTage, effekt: stufe.effekt,
      moeglich: erlaubt && !s.ausbau,
      grund: s.ausbau ? 'Es wird bereits gebaut.' : (erlaubt ? null : stufe.voraussetzung.text),
      anzahlung: Math.round(kosten * ANZAHLUNG_ANTEIL),
      bezahlbar: club.finances.balance >= Math.round(kosten * ANZAHLUNG_ANTEIL)
    };
  });
}

/**
 * Startet ein Ausbauprojekt. 35 % Anzahlung sofort, der Rest in Wochenraten
 * über die Bauzeit.
 */
export function ausbauStarten(state, clubId, stufeId) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.' };
  const s = st(club);
  const stufe = AUSBAU_BY_ID[stufeId];
  if (!stufe) return { ok: false, text: 'Dieses Bauvorhaben steht nicht im Katalog.' };
  if (s.ausbau) return { ok: false, text: `Auf der Baustelle steht schon der Kran: „${s.ausbau.name}" läuft noch ${s.ausbau.restTage} Tage.` };
  if (!stufe.voraussetzung.pruef(club, s)) return { ok: false, text: `Nicht möglich. ${stufe.voraussetzung.text}` };

  const kosten = ausbauKosten(state, clubId, stufeId);
  const anzahlung = Math.round(kosten * ANZAHLUNG_ANTEIL);
  if (club.finances.balance < anzahlung) {
    return { ok: false, text: `Die Anzahlung von ${formatMoney(anzahlung)} ist nicht gedeckt. Erst Geld, dann Beton.`, kosten, anzahlung };
  }

  const wochen = Math.max(1, Math.round(stufe.dauerTage / 7));
  const rest = kosten - anzahlung;
  s.ausbau = {
    stufe: stufeId,
    name: stufe.name,
    kostenGesamt: kosten,
    restTage: stufe.dauerTage,
    tageGesamt: stufe.dauerTage,
    plaetzeNeu: stufe.effekt.plaetze || 0,
    anzahlung,
    rateProWoche: Math.round(rest / wochen),
    restZahlung: rest,
    gezahlt: anzahlung,
    startTag: state.date.day,
    startSaison: state.date.season
  };
  buchen(state, clubId, -anzahlung, 'stadion', `Anzahlung Bauvorhaben „${stufe.name}"`);

  return {
    ok: true,
    text: `„${stufe.name}" ist beauftragt. Gesamtkosten ${formatMoney(kosten)}, davon ${formatMoney(anzahlung)} sofort, ` +
      `der Rest in ${wochen} Wochenraten à ${formatMoney(Math.round(rest / wochen))}. Fertigstellung in ${stufe.dauerTage} Tagen.`,
    kosten, anzahlung, rateProWoche: Math.round(rest / wochen),
    dauerTage: stufe.dauerTage, fertigTag: state.date.day + stufe.dauerTage
  };
}

/** Bricht den laufenden Ausbau ab. Bezahltes Geld ist weg, dazu Vertragsstrafe. */
export function ausbauAbbrechen(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Diesen Verein gibt es nicht.' };
  const s = st(club);
  if (!s.ausbau) return { ok: false, text: 'Es wird gerade gar nicht gebaut.' };

  const a = s.ausbau;
  const offen = Math.max(0, a.kostenGesamt - a.gezahlt);
  const storno = Math.round(offen * STORNO_ANTEIL);
  buchen(state, clubId, -storno, 'stadion', `Vertragsstrafe Bauabbruch „${a.name}"`);
  s.ausbau = null;
  s.ausbauHistorie.push({ stufe: a.stufe, name: a.name, season: state.date.season, day: state.date.day, abgebrochen: true, kosten: a.gezahlt + storno });

  const fans = club.fans || (club.fans = { mood: 60 });
  fans.mood = clamp((fans.mood || 60) - 4, 0, 100);

  return {
    ok: true,
    text: `„${a.name}" wird abgeblasen. ${formatMoney(a.gezahlt)} sind versenkt, dazu ${formatMoney(storno)} Vertragsstrafe. ` +
      `Die Bauruine bleibt vorerst stehen und wird zum Lieblingsmotiv der Lokalpresse.`,
    stornokosten: storno, verloren: a.gezahlt + storno
  };
}

/** Wendet den Effekt einer fertigen Stufe an. */
function ausbauAnwenden(state, club, stufe) {
  const s = st(club);
  const e = stufe.effekt || {};
  const alteKap = club.stadium.capacity;

  if (e.plaetze) club.stadium.capacity = Math.max(1000, Math.round(club.stadium.capacity + e.plaetze));
  if (e.stehDelta) club.stadium.standing = clamp(round((club.stadium.standing || 0) + e.stehDelta, 3), 0, 0.42);
  if (e.vipDelta) s.vipAnteil = clamp(round(s.vipAnteil + e.vipDelta, 4), VIP_MIN, VIP_MAX);
  if (e.tiers) club.stadium.tiers = clamp((club.stadium.tiers || 1) + e.tiers, 1, 4);
  if (e.floodlight) club.stadium.floodlight = clamp((club.stadium.floodlight || 0) + e.floodlight, 0, 5);
  if (e.roof !== undefined) club.stadium.roof = e.roof;
  if (e.pitch) {
    s.rasenZustand = clamp(round(s.rasenZustand + e.pitch, 1), 0, 99);
    club.stadium.pitch = Math.round(s.rasenZustand);
  }
  if (e.rasenheizung !== undefined) s.rasenheizung = e.rasenheizung;
  if (e.videowand !== undefined) s.videowand = e.videowand;
  if (e.museum !== undefined) s.museum = e.museum;
  if (e.catering) s.catering = clamp(s.catering + e.catering, 0, 100);
  if (e.parkplaetze) s.parkplaetze = clamp(s.parkplaetze + e.parkplaetze, 0, 100);
  if (e.sicherheit) s.sicherheit = clamp(s.sicherheit + e.sicherheit, 0, 100);
  if (e.moodDelta) {
    const fans = club.fans || (club.fans = { mood: 60 });
    fans.mood = clamp((fans.mood || 60) + e.moodDelta, 0, 100);
  }
  return { alteKap, neueKap: club.stadium.capacity };
}

/* ================================================================== *
 *  WERT UND BERICHT
 * ================================================================== */

const WERT_PRO_PLATZ = 1800;
const WERT_PRO_RANG = 450;
const WERT_DACH = 700;
const WERT_PRO_FLUTLICHT = 90;
const WERT_VIP = 8000;        // je Prozentpunkt VIP-Anteil × 100
const WERT_RASENHEIZUNG = 60;
const WERT_MUSEUM = 40;
const WERT_VIDEOWAND = 35;
const WERT_GRUNDSTUECK = 6000000;

/** Buchwert der Immobilie in Euro. */
export function stadionWert(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return 0;
  const s = st(club);
  const proPlatz = WERT_PRO_PLATZ
    + (club.stadium.tiers || 1) * WERT_PRO_RANG
    + (club.stadium.roof ? WERT_DACH : 0)
    + (club.stadium.floodlight || 0) * WERT_PRO_FLUTLICHT
    + s.vipAnteil * WERT_VIP
    + (s.rasenheizung ? WERT_RASENHEIZUNG : 0)
    + (s.museum ? WERT_MUSEUM : 0)
    + (s.videowand ? WERT_VIDEOWAND : 0);
  const zustand = 0.82 + (s.sicherheit / 100) * 0.10 + (s.rasenZustand / 100) * 0.10;
  return Math.round(club.stadium.capacity * proPlatz * zustand + WERT_GRUNDSTUECK);
}

/** Jährliche Betriebskosten (Grundlast ohne Spieltagsbetrieb). */
export function betriebskostenJahr(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return 0;
  const s = st(club);
  let k = club.stadium.capacity * BETRIEB_PRO_PLATZ_JAHR;
  if (club.stadium.roof) k *= BETRIEB_DACH;
  k *= 1 + (club.stadium.floodlight || 0) * BETRIEB_PRO_FLUTLICHT;
  k *= 1 + ((club.stadium.tiers || 1) - 1) * BETRIEB_PRO_RANG;
  k *= 1 + (s.sicherheit - 60) * BETRIEB_SICHERHEIT;
  if (s.rasenheizung) k *= 1.04;
  return Math.round(k);
}

/** Deutscher Lagebericht fürs Postfach. */
export function stadionBericht(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return 'Kein Stadion, kein Bericht.';
  const s = st(club);
  const r = raenge(state, clubId);
  const ref = referenzPreise(state, clubId);
  const z = zuschauerBerechnen(state, clubId, null, { neutral: true });
  const schnitt = s.heimspiele > 0 ? Math.round(s.zuschauerSumme / s.heimspiele) : z.gesamt;
  const auslastung = s.heimspiele > 0 ? s.auslastungSchnitt : z.auslastung;

  const zeilen = [];
  zeilen.push(`${club.stadium.name} – Kapazität ${nfmt(r.gesamt)} Plätze ` +
    `(${nfmt(r.steh)} Steh, ${nfmt(r.sitz)} Sitz, ${nfmt(r.vip)} VIP), ${club.stadium.tiers || 1} Ränge, ` +
    `${club.stadium.roof ? 'überdacht' : 'ohne Dach'}, Flutlicht Stufe ${club.stadium.floodlight || 0}.`);
  zeilen.push('');
  zeilen.push(`Schnitt: ${nfmt(schnitt)} Zuschauer (${round(auslastung * 100, 1)} % Auslastung), ` +
    `davon ${nfmt((club.fans && club.fans.dauerkarten) || 0)} Dauerkarteninhaber.`);
  zeilen.push(`Preise: Steh ${s.preise.steh} € (markt ${ref.steh} €), Sitz ${s.preise.sitz} € (markt ${ref.sitz} €), ` +
    `VIP ${s.preise.vip} € (markt ${ref.vip} €), Dauerkarte ${s.preise.dauerkarte} € (markt ${ref.dauerkarte} €).`);

  if (auslastung > 0.97) zeilen.push('Ausverkauft, Spiel für Spiel. Die Warteliste für Dauerkarten ist länger als der Kader.');
  else if (auslastung > 0.88) zeilen.push('Volles Haus – so soll es sein.');
  else if (auslastung > 0.72) zeilen.push('Ordentlich besucht. Auf der Gegengeraden ist aber noch Platz für die Schwiegermutter.');
  else if (auslastung > 0.55) zeilen.push('Da geht mehr. Entweder über den Preis oder über die Tabelle.');
  else zeilen.push('Die Ränge sind erschreckend leer. Der Stadionsprecher begrüßt die Zuschauer inzwischen namentlich.');

  zeilen.push('');
  zeilen.push(`Rasen: ${Math.round(s.rasenZustand)} von 99 ${s.rasenheizung ? '(mit Rasenheizung)' : '(ohne Rasenheizung)'}. ` +
    (s.rasenZustand > 88 ? 'Der Greenkeeper hat sich einen Orden verdient.'
      : s.rasenZustand > 70 ? 'Bespielbar, mehr aber auch nicht.'
        : 'Ein Acker. Bei Regen spielt hier niemand freiwillig Kurzpass.'));
  zeilen.push(`Gastronomie ${s.catering}, Parkplätze ${s.parkplaetze}, Sicherheitstechnik ${s.sicherheit}` +
    `${s.videowand ? ', Videowand vorhanden' : ''}${s.museum ? ', Museum und Fanshop vorhanden' : ''}.`);
  zeilen.push(`Betriebskosten: ${formatMoney(betriebskostenJahr(state, clubId))} pro Jahr. ` +
    `Buchwert der Immobilie: ${formatMoney(stadionWert(state, clubId))}.`);

  if (s.ausbau) {
    zeilen.push('');
    const fortschritt = round(100 * (1 - s.ausbau.restTage / Math.max(1, s.ausbau.tageGesamt)), 0);
    zeilen.push(`Baustelle: „${s.ausbau.name}" – ${fortschritt} % erledigt, noch ${s.ausbau.restTage} Tage. ` +
      `Bezahlt ${formatMoney(s.ausbau.gezahlt)} von ${formatMoney(s.ausbau.kostenGesamt)}.`);
  } else {
    zeilen.push('');
    zeilen.push('Keine Baustelle. Der Bauausschuss tagt trotzdem jeden Donnerstag.');
  }
  return zeilen.join('\n');
}

/* ================================================================== *
 *  TAGESABLAUF
 * ================================================================== */

/**
 * Tägliche Stadionabläufe für ALLE Vereine:
 * Baufortschritt und Ratenzahlung, Rasenverschleiß und -regeneration,
 * monatliche Betriebskosten, Dauerkartenverkauf zum Saisonstart.
 */
export function tickStadion(state, ctx) {
  const tag = ctx.day;
  const winter = tag >= SAISON_TAGE.hinrundeEnde - 20 && tag <= SAISON_TAGE.rueckrundeStart + 20;
  const spieleHeute = new Set();
  const heimspiele = new Map();          // clubId -> fixture (für die Abrechnung)
  for (const fx of state.fixtures) {
    if (fx.dayIndex !== tag || fx.season !== state.date.season) continue;
    spieleHeute.add(fx.homeId);
    if (!fx.freilos && fx.awayId && !heimspiele.has(fx.homeId)) heimspiele.set(fx.homeId, fx);
  }

  for (const clubId of Object.keys(state.clubs)) {
    const club = state.clubs[clubId];
    const s = st(club);
    const meins = istManager(state, clubId);

    /* --- Dauerkartenverkauf zum Saisonstart --- */
    if (tag === SAISON_TAGE.vorbereitungStart && s.dauerkartenSaison !== state.date.season) {
      const res = dauerkartenVerkauf(state, clubId, ctx.rng ? ctx.rng.fork('dk:' + clubId) : null);
      if (meins && res.ok) {
        ctx.log(`${res.text}\n\nErlös: ${formatMoney(res.einnahmen)}.`, 'stadion', { subject: 'Dauerkartenverkauf', from: 'Ticketing' });
      }
    }

    /* --- Baustelle --- */
    if (s.ausbau) {
      const a = s.ausbau;
      a.restTage = Math.max(0, a.restTage - 1);

      if (ctx.isWeekStart && a.restTage > 0) {
        const offen = Math.max(0, a.kostenGesamt - a.gezahlt);
        const rate = Math.min(a.rateProWoche, offen);
        if (rate > 0) {
          a.gezahlt += rate;
          buchen(state, clubId, -rate, 'stadion', `Baurate „${a.name}"`);
        }
      }

      if (a.restTage <= 0) {
        const offen = Math.max(0, a.kostenGesamt - a.gezahlt);
        if (offen > 0) {
          a.gezahlt += offen;
          buchen(state, clubId, -offen, 'stadion', `Schlussrechnung „${a.name}"`);
        }
        const stufe = AUSBAU_BY_ID[a.stufe];
        let info = { alteKap: club.stadium.capacity, neueKap: club.stadium.capacity };
        if (stufe) info = ausbauAnwenden(state, club, stufe);
        s.ausbauHistorie.push({ stufe: a.stufe, name: a.name, season: state.date.season, day: tag, abgebrochen: false, kosten: a.gezahlt });
        s.ausbau = null;

        if (meins) {
          const delta = info.neueKap - info.alteKap;
          const kapText = delta !== 0
            ? ` Die Kapazität liegt jetzt bei ${nfmt(info.neueKap)} Plätzen (${delta > 0 ? '+' : ''}${nfmt(delta)}).`
            : '';
          ctx.log(
            `Das Bauvorhaben „${a.name}" ist abgeschlossen.${kapText}\n\n` +
            `Gesamtkosten: ${formatMoney(a.gezahlt)}. Der Bauleiter hat pünktlich abgeliefert – ` +
            `das schreibt sich morgen keine Zeitung auf die Titelseite, aber wir wissen es zu schätzen.`,
            'stadion', { subject: `Fertig: ${a.name}`, from: 'Bauleitung', wichtig: true }
          );
          ctx.news(`${club.shortName}: ${a.name} fertiggestellt.`, 'stadion');
        }
      } else if (meins && a.restTage === 30) {
        ctx.log(`Noch 30 Tage bis zur Fertigstellung von „${a.name}". Die Bauleitung bittet um Geduld und um Geld.`,
          'stadion', { subject: 'Baufortschritt', from: 'Bauleitung' });
      }
    }

    /* --- Rasen --- */
    let rasen = s.rasenZustand;
    rasen -= RASEN_VERSCHLEISS_TAG;
    if (spieleHeute.has(clubId)) rasen -= RASEN_SPIELTAG;
    if (winter && !s.rasenheizung) rasen -= RASEN_FROST_MALUS;
    const maxWert = s.rasenheizung ? 99 : RASEN_MAX_OHNE_HEIZUNG;
    const pflegeQualitaet = 0.6 + ((club.facilities && club.facilities.training) || 50) / 250;
    if (rasen < maxWert) rasen += RASEN_REGENERATION * pflegeQualitaet;
    s.rasenZustand = clamp(round(rasen, 2), 25, maxWert);
    club.stadium.pitch = Math.round(s.rasenZustand);

    if (meins && s.rasenZustand < 55 && tag % 14 === 0) {
      ctx.log(`Der Platzwart schaut betreten zu Boden – im Wortsinn. Der Rasen steht bei ${Math.round(s.rasenZustand)}. ` +
        `Eine Grundpflege wäre überfällig.`, 'stadion', { subject: 'Der Rasen ruft', from: 'Platzwart' });
    }

    /* --- Heimspiel abrechnen: Tickets, Catering, Spieltagskosten ---------
     * spieltagAbrechnen() ist der dokumentierte Einstiegspunkt dafür. Ruft ihn
     * niemand, sieht kein Verein je eine Mark Zuschauereinnahmen – und die ganze
     * Liga rutscht binnen einer Hinrunde ins Minus. Deshalb hängt die Abrechnung
     * hier am Tagesablauf, für Manager- und KI-Vereine gleichermaßen. */
    const heimspiel = heimspiele.get(clubId);
    if (heimspiel) {
      if (!Array.isArray(s.abgerechnet)) s.abgerechnet = [];
      if (s.abgerechnet.indexOf(heimspiel.id) < 0) {
        s.abgerechnet.push(heimspiel.id);
        if (s.abgerechnet.length > 12) s.abgerechnet.shift();
        const z = spieltagAbrechnen(state, clubId, heimspiel, {
          neutral: !!heimspiel.neutral,
          weekday: ctx.weekday
        });
        if (meins && z && z.gesamt) {
          ctx.log(
            `${nfmt(z.gesamt)} Zuschauer im ${club.stadium.name} ` +
            `(${Math.round(z.auslastung * 100)} % Auslastung).\n\n` +
            `Ticketerlös: ${formatMoney(z.einnahmen)}.`,
            'stadion', { subject: 'Spieltagsabrechnung', from: 'Ticketing' });
        }
      }
    }

    /* --- Betriebskosten monatlich --- */
    if (ctx.isMonthStart) {
      const monat = Math.round(betriebskostenJahr(state, clubId) / 12);
      buchen(state, clubId, -monat, 'stadion', 'Stadionbetrieb (Monatspauschale)');
    }
  }
}

export default {
  tickStadion, zuschauerBerechnen, derbyFaktor, preiseSetzen, preisEmpfehlung,
  AUSBAUSTUFEN, ausbauStarten, ausbauAbbrechen, stadionWert, cateringErtrag,
  dauerkartenVerkauf, rasenPflegen, stadionBericht
};
