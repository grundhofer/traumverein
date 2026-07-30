/**
 * club/fans.js — Die Seele des Vereins.
 *
 * Zuständig für: Stimmung, Mitglieder, Ultras, Choreos, Fanproteste,
 * Merchandising, Heimvorteil und die Mitgliederversammlung.
 *
 * Die Fans sind ein eigener Akteur, kein Zahlenbalken. Sie merken sich, was der
 * Manager tut: Ticketpreise, verkaufte Publikumslieblinge, Mauerfußball,
 * Jugendspieler in der Startelf, Derbysiege. Und sie melden sich zu Wort.
 *
 * Rein funktional, kein DOM, kein Math.random(), kein Date.now().
 *
 * ---------------------------------------------------------------------------
 * STATE-FELDER
 * ---------------------------------------------------------------------------
 * Aus core/state.js (initClubRuntime) vorhanden:
 *   club.fans = { members, ultras, mood, potential, protest, dauerkarten, erwartung }
 * Zusätzlich legt DIESES Modul beim ersten Zugriff lazy an (siehe fanState()):
 *   groll, kommunikation, startMitglieder, preisAnker, form, letzterSpieltag,
 *   letztesSpiel, verlauf, aktionen, choreo, kaderIds, ikonen, ziel, gruende,
 *   boykott, mvSaison, merchJahr, merchSaison, historie
 *
 * Fremde Bereiche werden nur an genau drei Stellen und nur minimal berührt:
 *   - club.finances (Merchandising-Einnahme, Geldstrafen, Choreo-Zuschuss)
 *     -> immer über bucheGeld(), Kategorie 'merchandising' | 'fans'
 *   - club.board.zufriedenheit/vertrauen (±4) bei expliziten Manager-Reaktionen
 *     und der Mitgliederversammlung -> immer über vorstandEcho()
 *   - club.youth.akademie (+1) bei angenommenem Beitragsantrag
 */

import { clamp, round, formatMoney, dateFromDayIndex } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { playerOverall } from '../engine/ratings.js';
import { SAISON_TAGE } from '../data/leagues.js';
import { referenzPreise } from './stadium.js';

/* ========================================================================== *
 *  BALANCING — alle Stellschrauben an einem Ort
 * ========================================================================== */

/** Tage einer Saison — nur für Abstandsrechnungen über einen Saisonwechsel hinweg. */
const SAISON_LAENGE = 365;
/** Neutrale Grundstimmung eines Vereins ohne besondere Vorkommnisse. */
const STIMMUNG_BASIS = 55;
/** Anteil der Distanz zur Zielstimmung, der pro Tag abgebaut wird. */
const TRAEGHEIT_TAG = 0.055;
/** Untergrenze/Obergrenze der Stimmung (0 und 100 fühlen sich tot an). */
const STIMMUNG_MIN = 3;
const STIMMUNG_MAX = 99;

/** Sofortiger Stimmungsschub direkt nach einem Spiel (vor Modifikatoren). */
const ERGEBNIS_SCHUB = { S: 3.4, U: -0.2, N: -3.6 };
/** Maximaler Ausschlag eines einzelnen Spiels. */
const ERGEBNIS_KAPPE = 14;
/** Gewicht des Ruf-Unterschieds: Sieg beim Großen zählt mehr. */
const GEGNER_GEWICHT = 42;
/** Heimniederlagen tun mehr weh, Auswärtssiege wiegen mehr. */
const HEIMNIEDERLAGE_FAKTOR = 1.28;
const AUSWAERTSSIEG_FAKTOR = 1.22;
/** Derbyzuschlag je Intensitätsstufe (1..3). */
const DERBY_ZUSCHLAG = 0.34;
/** Bonus je Tor über zwei, Malus je Gegentor über drei. */
const TORFESTIVAL_BONUS = 0.4;
const KLATSCHE_MALUS = 0.6;

/** Gewichte der Zielstimmung (Summe der Ausschläge ≈ ±70 um STIMMUNG_BASIS). */
const G_TABELLE = 20;        // Tabellenplatz gegen Erwartung
const G_FORM = 12;           // letzte fünf Ergebnisse
const G_PREIS_MALUS = 46;    // je 10 % Preiserhöhung ≈ 4,6 Punkte Stimmung
const G_PREIS_BONUS = 22;    // Preissenkungen wirken nur halb so stark wie Erhöhungen
const G_PREIS_KAPPE = [-26, 10];
/**
 * Zweiter Preisblock: Aufschlag auf das marktübliche Niveau aus club/stadium.js.
 * Bewusst einseitig — wer über dem Markt liegt, wird bestraft; wer darunter liegt,
 * bekommt seinen Bonus bereits über den Gewöhnungsanker. Sonst hätte jeder Verein
 * eine geschenkte Grundstimmung, weil die Basispreise unter der Referenz liegen.
 */
const G_MARKT_MALUS = 26;
const G_MARKT_KAPPE = -16;
const G_SPIELWEISE = 9;      // Fans wollen Fußball sehen
const G_IKONEN = 9;          // Legenden und Publikumslieblinge im Kader
const G_JUGEND = 8;          // Eigengewächse in der Startelf
const G_GROLL = 0.34;        // Transferpolitik (groll 0..100)
const G_PROTEST = 0.26;      // aktiver Protest drückt zusätzlich
const G_SPONSOR = 8;         // Wettanbieter, Investoren, Stadionname
const G_STADION = 6;         // Ausbau, Stehplätze, Rasen
const G_KOMMUNIKATION = 7;   // Auftreten des Trainers

/** Protestzuwachs je Niederlage (daheim / auswärts). */
const PROTEST_HEIMNIEDERLAGE = 5.0;
const PROTEST_AUSWAERTSNIEDERLAGE = 3.2;
/** Protestabbau je Sieg (Derbysieg räumt mehr auf). */
const PROTEST_SIEG = 4.5;
const PROTEST_DERBYSIEG = 9;

/** Abklingen pro Tag. */
const PROTEST_ABKLINGEN = 0.32;
const GROLL_ABKLINGEN = 0.28;
const KOMMUNIKATION_RUECKKEHR = 0.35;   // driftet Richtung 50
/**
 * Preisanker: so schnell gewöhnen sich Fans an neue Preise (Anteil/Tag).
 * Halbwertszeit rund 90 Tage — nach einer Saison ist der neue Preis der normale
 * Preis, geschimpft wird dann über etwas anderes.
 */
const PREISANKER_GEWOEHNUNG = 0.0078;
/** Wöchentlicher Direkteffekt der Ticketpreise (zusätzlich zur Zielstimmung). */
const PREIS_WOCHE_TOLERANZ = 1.02;     // bis hierhin murrt niemand
const PREIS_WOCHE_MALUS = 3.2;         // Punkte je 100 % Aufschlag
const PREIS_WOCHE_MALUS_MAX = 1.6;
const PREIS_WOCHE_BONUS = 1.0;
const PREIS_WOCHE_BONUS_MAX = 0.5;
const PREIS_WOCHE_PROTEST = 1.4;       // Protestzuwachs je verlorenem Stimmungspunkt
/** Ab diesem Vielfachen des marktüblichen Preises redet die Stadt darüber. */
const MARKT_WUCHER = 1.15;

/** Ab wie vielen Punkten Veränderung binnen zwei Wochen der Ticker anspringt. */
const STIMMUNG_TICKER_SCHWELLE = 4;
/** Ab diesem Vielfachen des alten Höchststands ist es ein neuer Mitgliederrekord. */
const MITGLIEDER_REKORD_SCHWELLE = 1.015;

/** Mitglieder: Anteil der Distanz zum Zielwert, der pro Woche zurückgelegt wird. */
const MITGLIEDER_TEMPO = 0.016;
const MITGLIEDER_MIN_FAKTOR = 0.62;    // Untergrenze relativ zum Startwert
const MITGLIEDER_MAX_FAKTOR = 2.1;     // Obergrenze relativ zum Startwert

/** Ultras: Kopfzahl aus Mitgliedern und Stadiongröße. */
const ULTRAS_PRO_MITGLIED = 0.012;
const ULTRAS_PRO_PLATZ = 0.025;

/**
 * Merchandising (Jahresumsatz).
 * Zielbild: Bayern 100–140 Mio, Dortmund 40–70 Mio, Bundesliga-Mittelfeld 8–25 Mio,
 * kleiner Erstligist 2–5 Mio, Zweitligist 1–8 Mio. Der Ruf wirkt überproportional —
 * ein Trikot verkauft sich nicht in der Stadt, sondern über den Namen des Vereins.
 */
const MERCH_PRO_MITGLIED = 52;         // €/Jahr
const MERCH_PRO_BESUCH = 14;           // €/Stadionbesuch
const MERCH_HEIMSPIELE = 17;
const MERCH_LIGA_FAKTOR = { bl1: 1.0, bl2: 0.58 };
const MERCH_RUF_REF = 62;              // Ruf, bei dem der Faktor genau 1,0 ist
const MERCH_RUF_EXP = 2.1;             // Steilheit der Markenwirkung
const MERCH_RUF_KAPPE = [0.45, 2.6];
const MERCH_STIMMUNG = [0.74, 1.26];   // bei Stimmung 0 bzw. 100
const MERCH_STAR_MAX = 1.22;           // bester Spieler des Kaders
/** Monatsanteile am Jahresumsatz (Index 0 = Januar). */
const MERCH_MONAT = [0.07, 0.06, 0.06, 0.06, 0.09, 0.07, 0.11, 0.12, 0.07, 0.07, 0.08, 0.14];

/** Heimvorteil. */
const HV_MIN = 0.9;
const HV_MAX = 1.18;
const HV_CHOREO = 0.052;
const HV_DERBY = 0.03;
const HV_BOYKOTT = 0.065;

/** Choreo. */
const CHOREO_KOSTEN_BASIS = 9000;      // € Grundkosten
const CHOREO_KOSTEN_PRO_PLATZ = 0.55;  // € je Zuschauerplatz
const CHOREO_VORLAUF_MIN = 4;          // Tage
const CHOREO_VORLAUF_MAX = 12;

/** Geldstrafen (DFB-Sportgericht). */
const PYRO_STRAFE_BASIS = 22000;
const PYRO_STRAFE_PRO_RUF = 1900;

/** Wahrscheinlichkeit, dass an einem Tag überhaupt eine Fanaktion entsteht. */
const AKTION_GRUNDCHANCE = 0.055;
const AKTION_PROTEST_CHANCE = 0.0022;  // je Protestpunkt zusätzlich
const AKTION_SPERRE_TAGE = 5;          // Mindestabstand zweier Aktionen
/** Mindestabstand, bevor sich dieselbe Aktion wiederholen darf. */
const AKTION_WIEDERHOLUNG_TAGE = 24;

/** Verkauf von Identifikationsfiguren. */
const VERKAUF_GROLL = { legend: 42, fanliebling: 22, eigengewaechs: 14, stammspieler: 8 };
const VERKAUF_PROTEST = { legend: 26, fanliebling: 13, eigengewaechs: 8, stammspieler: 4 };
const VERKAUF_SOFORT = { legend: -9, fanliebling: -4.5, eigengewaechs: -2.5, stammspieler: -1.2 };
/** Ein Weltklasse-Neuzugang besänftigt. */
const NEUZUGANG_TROST = 9;

/* ========================================================================== *
 *  Lokalkolorit: Rivalitäten (Intensität 1 = Kribbeln, 3 = Ausnahmezustand)
 * ========================================================================== */

const RIVALEN_ROH = [
  ['bayern', 'dortmund', 3], ['bayern', 'nuernberg', 2], ['bayern', 'augsburg', 2],
  ['dortmund', 'schalke', 3], ['dortmund', 'bochum', 2], ['schalke', 'bochum', 2],
  ['koeln', 'gladbach', 3], ['koeln', 'duesseldorf', 3], ['koeln', 'leverkusen', 2],
  ['gladbach', 'duesseldorf', 2], ['leverkusen', 'duesseldorf', 1],
  ['hsv', 'stpauli', 3], ['hsv', 'bremen', 3], ['hsv', 'hannover', 2], ['hsv', 'kiel', 2],
  ['bremen', 'hannover', 2], ['stpauli', 'kiel', 1],
  ['hannover', 'braunschweig', 3], ['braunschweig', 'wolfsburg', 2], ['hannover', 'wolfsburg', 2],
  ['nuernberg', 'fuerth', 3], ['nuernberg', 'augsburg', 1],
  ['hertha', 'union', 3], ['union', 'leipzig', 2], ['hertha', 'dresden', 2],
  ['dresden', 'magdeburg', 3], ['dresden', 'leipzig', 3], ['magdeburg', 'leipzig', 2],
  ['stuttgart', 'ksc', 3], ['ksc', 'freiburg', 2], ['stuttgart', 'freiburg', 2],
  ['stuttgart', 'hoffenheim', 2], ['ksc', 'hoffenheim', 2], ['stuttgart', 'heidenheim', 1],
  ['kaiserslautern', 'mainz', 3], ['kaiserslautern', 'elversberg', 2], ['mainz', 'frankfurt', 3],
  ['frankfurt', 'darmstadt', 3], ['frankfurt', 'hoffenheim', 1],
  ['bielefeld', 'paderborn', 3], ['bielefeld', 'muenster', 2], ['muenster', 'paderborn', 1],
  ['muenster', 'bielefeld', 2]
];

const RIVALEN = (() => {
  const m = {};
  for (const [a, b, i] of RIVALEN_ROH) {
    (m[a] || (m[a] = {}))[b] = Math.max(i, m[a][b] || 0);
    (m[b] || (m[b] = {}))[a] = Math.max(i, m[b][a] || 0);
  }
  return m;
})();

/** Intensität der Rivalität zweier Vereine (0 = keine). */
export function rivalitaet(aId, bId) {
  return (RIVALEN[aId] && RIVALEN[aId][bId]) || 0;
}

/* ========================================================================== *
 *  Kleine Helfer
 * ========================================================================== */

function fanState(club) {
  const f = club.fans || (club.fans = {});
  const basis = club.fanbase || {};
  if (f.members === undefined) f.members = basis.members || 8000;
  if (f.ultras === undefined) f.ultras = basis.ultras || 40;
  if (f.mood === undefined) f.mood = basis.mood || STIMMUNG_BASIS;
  if (f.potential === undefined) f.potential = basis.potential || 50;
  if (f.protest === undefined) f.protest = 0;
  if (f.dauerkarten === undefined) f.dauerkarten = 0;
  if (f.erwartung === undefined) f.erwartung = 55;

  // --- eigene Felder ---
  if (f.groll === undefined) f.groll = 0;                 // Zorn über Transferpolitik 0..100
  if (f.kommunikation === undefined) f.kommunikation = 50;// wie der Trainer redet 0..100
  if (f.boykott === undefined) f.boykott = 0;             // Anzahl Spiele mit Boykott
  if (f.startMitglieder === undefined) f.startMitglieder = f.members;
  if (f.mitgliederRekord === undefined) f.mitgliederRekord = f.members;
  // preisAnker wird bewusst NICHT hier gesetzt, sondern in anker() aus dem
  // Basispreis des Vereins. Sonst würde ein Preis, den der Manager vor dem
  // ersten Tick anfasst, sofort als "schon immer so" durchgehen.
  if (!Array.isArray(f.form)) f.form = [];                // ['S','U','N', ...] max 6
  if (f.letzterSpieltag === undefined) f.letzterSpieltag = -1;
  if (f.letztesSpiel === undefined) f.letztesSpiel = null;
  if (!Array.isArray(f.verlauf)) f.verlauf = [];          // Wochen-Schnappschüsse der Stimmung
  if (!Array.isArray(f.aktionen)) f.aktionen = [];        // offene/erledigte Fanaktionen
  if (f.choreo === undefined) f.choreo = null;
  if (!Array.isArray(f.kaderIds)) f.kaderIds = (club.playerIds || []).slice();
  if (f.ziel === undefined) f.ziel = f.mood;
  if (!Array.isArray(f.gruende)) f.gruende = [];
  if (f.letzteAktionTag === undefined) f.letzteAktionTag = -99;
  if (f.mvSaison === undefined) f.mvSaison = 0;
  if (f.merchSaison === undefined) f.merchSaison = 0;
  if (f.merchJahr === undefined) f.merchJahr = 0;
  return f;
}

function preiseVon(club) {
  const st = club.stadiumState;
  if (st && st.preise) return st.preise;
  const base = (club.finances && club.finances.ticketBase) || 25;
  return { sitz: base, steh: Math.round(base * 0.45), vip: Math.round(base * 4.5), dauerkarte: Math.round(base * 17) };
}

function kapazitaet(club) {
  return (club.stadium && club.stadium.capacity) || 20000;
}

/**
 * Preisniveau, an das die Fans gewöhnt sind.
 * Startwert ist der Basispreis des Vereins (club.finances.ticketBase) — also das,
 * was hier seit jeher an der Kasse verlangt wird. Der Anker wandert im Tick
 * langsam auf das tatsächliche Preisniveau zu (Gewöhnung, siehe tickFans).
 */
function anker(club, f) {
  if (!f.preisAnker) {
    const basis = (club.finances && club.finances.ticketBase) || 25;
    f.preisAnker = { sitz: basis, steh: Math.round(basis * 0.45), dauerkarte: Math.round(basis * 17) };
  }
  return f.preisAnker;
}

/** Gewichteter Vergleich der drei Kartenpreise gegen ein Referenzniveau. */
function preisVerhaeltnis(club, referenz) {
  const p = preiseVon(club);
  const teile = [
    [p.sitz, referenz.sitz, 0.5],
    [p.steh, referenz.steh, 0.32],
    [p.dauerkarte, referenz.dauerkarte, 0.18]
  ];
  let sum = 0, w = 0;
  for (const [ist, ref, gew] of teile) {
    if (!ref || !ist) continue;
    sum += (ist / ref) * gew;
    w += gew;
  }
  return w > 0 ? sum / w : 1;
}

/** Tore eines Fixtures robust auslesen (Format wie in data/leagues.js). */
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

/** Aktueller Tabellenplatz, sonst null. */
function platzVon(state, club) {
  const tab = state.tables && state.tables[club.leagueId];
  if (Array.isArray(tab) && tab.length) {
    for (let i = 0; i < tab.length; i++) {
      if (tab[i] && tab[i].clubId === club.id) return tab[i].platz || (i + 1);
    }
  }
  if (club.season && club.season.platz) return club.season.platz;
  return null;
}

function erwartungsPlatz(club) {
  const e = club.board && club.board.erwartung;
  if (e && typeof e.platz === 'number') return e.platz;
  const rep = club.reputation || 50;
  return rep >= 90 ? 1 : rep >= 82 ? 3 : rep >= 74 ? 6 : rep >= 64 ? 10 : rep >= 54 ? 13 : 15;
}

/** Formpunkte aus den letzten Ergebnissen: -1 (alles verloren) .. +1. */
function formPunkte(f) {
  const arr = f.form.slice(-5);
  if (!arr.length) return 0;
  let s = 0;
  for (const r of arr) s += r === 'S' ? 1 : r === 'N' ? -1 : 0.15;
  return s / arr.length;
}

function istMein(state, club) {
  return club.id === state.managerClubId;
}

/** Nachricht ins Postfach — ausschließlich für den Verein des Spielers. */
function melde(state, club, ctx, body, kind, opts) {
  if (!ctx || typeof ctx.log !== 'function' || !istMein(state, club)) return;
  ctx.log(body, kind || 'fans', Object.assign({ from: 'Fanbeauftragter', subject: 'Von den Rängen' }, opts || {}));
}

function ticker(state, club, ctx, text, kind) {
  if (!ctx || typeof ctx.news !== 'function' || !istMein(state, club)) return;
  ctx.news(text, kind || 'fans');
}

/** Kontrollierte Buchung im fremden Finanzbereich. */
function bucheGeld(state, club, betrag, kategorie, text) {
  const fin = club.finances || (club.finances = {});
  fin.balance = (fin.balance || 0) + betrag;
  if (!fin.saison) fin.saison = {};
  if (kategorie === 'merchandising') {
    fin.saison.einnahmenMerch = (fin.saison.einnahmenMerch || 0) + betrag;
  } else if (betrag < 0) {
    fin.saison.ausgabenSonstige = (fin.saison.ausgabenSonstige || 0) - betrag;
  } else {
    fin.saison.einnahmenSonstige = (fin.saison.einnahmenSonstige || 0) + betrag;
  }
  if (!Array.isArray(fin.ledger)) fin.ledger = [];
  fin.ledger.push({ day: state.date.day, season: state.date.season, betrag: Math.round(betrag), kategorie, text });
  if (fin.ledger.length > 2000) fin.ledger.splice(0, fin.ledger.length - 2000);
  return Math.round(betrag);
}

/** Kleiner, gedeckelter Ausschlag beim Vorstand (siehe Kopfkommentar). */
function vorstandEcho(club, zufriedenheit, vertrauen) {
  const b = club.board;
  if (!b) return;
  if (zufriedenheit) b.zufriedenheit = clamp((b.zufriedenheit || 60) + clamp(zufriedenheit, -4, 4), 0, 100);
  if (vertrauen) b.vertrauen = clamp((b.vertrauen || 60) + clamp(vertrauen, -4, 4), 0, 100);
}

function rngVon(state, ctx, label) {
  if (ctx && ctx.rng) return ctx.rng;
  return createRng('fans:' + label + ':' + (state.seed || 0) + ':' + state.date.day + ':' + state.date.season);
}

/* ========================================================================== *
 *  Bausteine der Zielstimmung
 * ========================================================================== */

/** Preisindex: 1.0 = so teuer wie gewohnt, 1.2 = 20 % über dem Gewohnten. */
function preisIndex(club, f) {
  return preisVerhaeltnis(club, anker(club, f));
}

/**
 * Preisindex gegen das marktübliche Niveau — die Referenzpreise kommen aus
 * club/stadium.js (referenzPreise), damit Fans, Kasse und Geschäftsstelle
 * dieselbe Zahl im Kopf haben. 1.0 = fair, 1.4 = Wucher.
 */
function marktIndex(state, club) {
  return preisVerhaeltnis(club, referenzPreise(state, club.id));
}

/** Stehplatzpreise treffen die Ultras direkt. */
function stehIndex(club, f) {
  const p = preiseVon(club);
  const a = anker(club, f);
  return a.steh ? p.steh / a.steh : 1;
}

/**
 * Spielweise: Fans wollen Fußball sehen, kein Verwalten.
 * Bewertet Stil, Offensivdrang/Risiko und die tatsächliche Torausbeute.
 */
function spielweiseWert(club) {
  const t = club.tactics;
  let v = 0;
  const STIL = {
    offensiv: 1.0, kick_and_rush: 0.7, pressing: 0.65, konter: 0.15,
    ballbesitz: 0.35, ausgeglichen: 0, defensiv: -1.0
  };
  if (t) {
    if (t.style && STIL[t.style] !== undefined) v += STIL[t.style] * 0.55;
    const s = t.sliders || {};
    if (typeof s.offensivdrang === 'number') v += ((s.offensivdrang - 50) / 50) * 0.3;
    if (typeof s.risiko === 'number') v += ((s.risiko - 50) / 50) * 0.15;
    if (t.instructions && t.instructions.zeitspiel) v -= 0.25;
  }
  const se = club.season || {};
  const spiele = (se.form && se.form.length) || 0;
  if (spiele >= 3 && typeof se.tore === 'number') {
    const proSpiel = se.tore / spiele;
    v += clamp((proSpiel - 1.35) * 0.45, -0.5, 0.5);
  }
  return clamp(v, -1, 1);
}

const IKONEN_STUFE = { legend: 3, fanliebling: 2, eigengewaechs: 1.2, stammspieler: 0.5 };

/** Welche Rolle hat der Spieler im Herzen der Fans? */
function identifikationsStufe(state, club, p) {
  if (!p) return null;
  if (p.era === 'legend') return 'legend';
  if (p.traits && p.traits.includes('fanliebling')) return 'fanliebling';
  if (p.jugend || p.eigengewaechs || p.ausJugend) return 'eigengewaechs';
  const jahre = state.date.season - ((p.joined && p.joined.season) || state.date.season);
  if (jahre >= 4) return 'eigengewaechs';
  if (p.captain) return 'fanliebling';
  const ovr = sicherOverall(p);
  if (ovr >= 76 || jahre >= 2) return 'stammspieler';
  return null;
}

function sicherOverall(p) {
  try { return playerOverall(p) || 50; } catch (e) { return 50; }
}

/** Vereinsikonen im Kader (0..1). */
function ikonenWert(state, club) {
  const ids = club.playerIds || [];
  let punkte = 0;
  for (const id of ids) {
    const p = state.players[id];
    if (!p) continue;
    const stufe = identifikationsStufe(state, club, p);
    if (stufe === 'legend') punkte += 1.0;
    else if (stufe === 'fanliebling') punkte += 0.55;
    else if (stufe === 'eigengewaechs') punkte += 0.25;
  }
  return clamp(punkte / 3.2, 0, 1);
}

/** Eigengewächse in der Startelf (0..1) — der wohl schönste Bonus im Spiel. */
function jugendWert(state, club) {
  const t = club.tactics;
  if (!t || !t.lineup) return 0;
  let n = 0, jung = 0;
  for (const slot in t.lineup) {
    const p = state.players[t.lineup[slot]];
    if (!p) continue;
    n++;
    const stufe = identifikationsStufe(state, club, p);
    if (stufe === 'eigengewaechs' || (p.age <= 21 && (p.jugend || p.eigengewaechs))) jung++;
    else if (p.age <= 20) jung += 0.45;
  }
  if (!n) return 0;
  return clamp(jung / 3, 0, 1);
}

/** Sponsoren: Wettanbieter, Investoren und verkaufte Stadionnamen ärgern die Kurve. */
function sponsorWert(club) {
  const sp = club.sponsors;
  if (!sp) return 0;
  let v = 0;
  const pruefe = (s, gewicht) => {
    if (!s) return;
    const branche = String(s.branche || s.kategorie || '').toLowerCase();
    const name = String(s.name || '').toLowerCase();
    if (s.umstritten === true) v -= 0.55 * gewicht;
    if (/wett|casino|glücks|gluecks|bet|tipp/.test(branche + name)) v -= 0.5 * gewicht;
    if (/investor|holding|fonds|capital|energy/.test(branche + name)) v -= 0.3 * gewicht;
    if (/region|stadtwerke|brauerei|handwerk|bäcker|baecker|sparkasse/.test(branche + name)) v += 0.4 * gewicht;
    if (typeof s.image === 'number') v += ((s.image - 50) / 50) * 0.4 * gewicht;
  };
  pruefe(sp.trikot, 1.0);
  pruefe(sp.aermel, 0.4);
  pruefe(sp.ausruester, 0.5);
  if (sp.stadion) {
    v -= 0.45;   // "Wir nennen es weiter, wie es immer hieß."
    pruefe(sp.stadion, 0.3);
  }
  return clamp(v, -1, 1);
}

/** Stadion: Ausbau macht Vorfreude, ein Acker als Rasen macht schlechte Laune. */
function stadionWert(club) {
  const st = club.stadiumState || {};
  let v = 0;
  if (st.ausbau) v += 0.6;
  const stehen = (club.stadium && club.stadium.standing) || 0;
  v += clamp((stehen - 0.15) * 2.2, -0.3, 0.45);
  if (typeof st.rasenZustand === 'number') v += clamp((st.rasenZustand - 72) / 60, -0.45, 0.25);
  if (typeof st.catering === 'number') v += clamp((st.catering - 50) / 140, -0.3, 0.3);
  return clamp(v, -1, 1);
}

/**
 * Zielstimmung: der Wert, auf den die Stimmung träge zuläuft.
 * Reine Leseoperation — keine Mutation.
 */
function zielStimmung(state, club) {
  const f = fanState(club);
  const gruende = [];
  const add = (label, delta, text) => {
    if (Math.abs(delta) < 0.35) return;
    gruende.push({ label, delta: round(delta, 1), text });
  };

  let wert = STIMMUNG_BASIS;

  // Tabellenplatz gegen die Erwartung der Kurve
  const platz = platzVon(state, club);
  if (platz) {
    const soll = erwartungsPlatz(club);
    const diff = clamp((soll - platz) / 6, -1.4, 1.4);
    const d = diff * G_TABELLE;
    wert += d;
    add('Tabellenplatz', d, platz <= soll
      ? `Platz ${platz} — genau da, wo man sich sieht. Oder besser.`
      : `Platz ${platz}. Erwartet wurde etwas um Rang ${soll}.`);
  }

  // Form
  const fp = formPunkte(f);
  if (f.form.length) {
    const d = fp * G_FORM;
    wert += d;
    add('Aktuelle Form', d, `Die letzten Spiele: ${f.form.slice(-5).join('–') || 'noch keine'}.`);
  }

  // Ticketpreise: zwei Fragen — teurer als gewohnt? Und teurer als anderswo?
  const pi = preisIndex(club, f);
  const mi = marktIndex(state, club);
  const dGewohnt = clamp(-(pi - 1) * (pi > 1 ? G_PREIS_MALUS : G_PREIS_BONUS), G_PREIS_KAPPE[0], G_PREIS_KAPPE[1]);
  const dMarkt = mi > 1 ? clamp(-(mi - 1) * G_MARKT_MALUS, G_MARKT_KAPPE, 0) : 0;
  const dPreis = dGewohnt + dMarkt;
  if (Math.abs(dPreis) > 0.35) {
    wert += dPreis;
    add('Ticketpreise', dPreis, mi > MARKT_WUCHER
      ? `Nirgends im Land zahlt man so viel wie hier — rund ${Math.round((mi - 1) * 100)} % über dem Üblichen.`
      : pi > 1.015
        ? `Die Karten sind rund ${Math.round((pi - 1) * 100)} % teurer als gewohnt. Das spricht sich herum.`
        : `Günstigere Karten als gewohnt — das rechnet man dem Verein hoch an.`);
  }

  // Spielweise
  const sw = spielweiseWert(club);
  if (Math.abs(sw) > 0.05) {
    const d = sw * G_SPIELWEISE;
    wert += d;
    add('Spielweise', d, sw > 0
      ? 'Es wird nach vorne gespielt. Dafür kommen die Leute.'
      : 'Mauern, Quergrätschen, Abstoß. So macht das keinen Spaß.');
  }

  // Ikonen und Jugend
  const ik = ikonenWert(state, club);
  if (ik > 0.03) {
    const d = ik * G_IKONEN;
    wert += d;
    add('Identifikationsfiguren', d, 'Da laufen noch Leute auf, für die man das Trikot kauft.');
  }
  const ju = jugendWert(state, club);
  if (ju > 0.03) {
    const d = ju * G_JUGEND;
    wert += d;
    add('Eigene Jugend', d, 'Eigengewächse in der Startelf. Genau so hat man sich das vorgestellt.');
  }

  // Groll aus der Transferpolitik
  if (f.groll > 1) {
    const d = -f.groll * G_GROLL;
    wert += d;
    add('Transferpolitik', d, 'Die Abgänge der letzten Zeit sitzen tief.');
  }

  // Aktiver Protest
  if (f.protest > 1) {
    const d = -f.protest * G_PROTEST;
    wert += d;
    add('Proteste', d, 'Auf den Rängen wird nicht mehr nur gesungen.');
  }

  // Sponsoren
  const sp = sponsorWert(club);
  if (Math.abs(sp) > 0.05) {
    const d = sp * G_SPONSOR;
    wert += d;
    add('Sponsoren', d, sp < 0
      ? 'Der Schriftzug auf der Brust gefällt der Kurve überhaupt nicht.'
      : 'Der Partner passt zum Verein — das sieht die Kurve auch so.');
  }

  // Stadion
  const stw = stadionWert(club);
  if (Math.abs(stw) > 0.05) {
    const d = stw * G_STADION;
    wert += d;
    add('Stadion', d, stw > 0 ? 'Am Stadion tut sich etwas.' : 'Das Stadion macht gerade wenig Freude.');
  }

  // Kommunikation des Trainers
  const komm = (f.kommunikation - 50) / 50;
  if (Math.abs(komm) > 0.06) {
    const d = komm * G_KOMMUNIKATION;
    wert += d;
    add('Auftreten des Trainers', d, komm > 0
      ? 'Der Trainer findet die richtigen Worte.'
      : 'Vom Trainer hört man wenig — und wenn, dann das Falsche.');
  }

  gruende.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { wert: clamp(wert, STIMMUNG_MIN, STIMMUNG_MAX), gruende };
}

const STIMMUNG_TEXTE = [
  [92, 'Ausnahmezustand. Die Stadt trägt Vereinsfarben.'],
  [82, 'Euphorie. Auf dem Marktplatz wird schon vom Titel geredet.'],
  [72, 'Beste Laune. Die Kurve singt vom Anpfiff bis zum Abpfiff.'],
  [62, 'Zufrieden. Man kann sich sonntags wieder unter Leute trauen.'],
  [52, 'Gelassen bis abwartend. Man hat schon Schlimmeres erlebt.'],
  [42, 'Unruhe. In den Kneipen wird lauter diskutiert als gesungen.'],
  [32, 'Miese Stimmung. Die ersten Transparente sind schon gemalt.'],
  [22, 'Wut. Der Fanbeauftragte geht nicht mehr ans Telefon.'],
  [12, 'Offene Revolte. Es geht nicht mehr um Fußball.'],
  [0, 'Der Verein und seine Anhänger reden nicht mehr miteinander.']
];

function stimmungsText(wert) {
  for (const [grenze, text] of STIMMUNG_TEXTE) if (wert >= grenze) return text;
  return STIMMUNG_TEXTE[STIMMUNG_TEXTE.length - 1][1];
}

/* ========================================================================== *
 *  ÖFFENTLICHE ABFRAGEN
 * ========================================================================== */

/**
 * Aktuelle Stimmungslage eines Vereins.
 * @returns {{wert:number, trend:number, trendText:string, text:string, ziel:number, gruende:Array}}
 */
export function stimmung(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { wert: 50, trend: 0, trendText: 'unbekannt', text: 'Kein solcher Verein.', ziel: 50, gruende: [] };
  const f = fanState(club);
  const ziel = zielStimmung(state, club);
  const frueher = f.verlauf.length ? f.verlauf[Math.max(0, f.verlauf.length - 4)] : f.mood;
  const trend = round(f.mood - frueher, 1);
  return {
    wert: round(f.mood, 1),
    trend,
    trendText: trend > 3 ? 'stark steigend' : trend > 0.8 ? 'steigend'
      : trend < -3 ? 'stark fallend' : trend < -0.8 ? 'fallend' : 'stabil',
    text: stimmungsText(f.mood),
    ziel: round(ziel.wert, 1),
    protest: round(f.protest, 1),
    groll: round(f.groll, 1),
    gruende: ziel.gruende
  };
}

/**
 * Die Ultras: Kopfzahl, eigene Stimmungslage und Bereitschaft zu Choreo bzw. Protest.
 */
export function ultras(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { anzahl: 0, stimmung: 50, choreoBereit: false, protestbereit: false, text: '' };
  const f = fanState(club);
  const intensitaet = clamp(f.ultras, 0, 100) / 100;
  const anzahl = Math.round(f.members * intensitaet * ULTRAS_PRO_MITGLIED
    + kapazitaet(club) * intensitaet * ULTRAS_PRO_PLATZ);

  const steh = stehIndex(club, f);
  const kommerz = -Math.min(0, sponsorWert(club));            // 0..1
  const tradition = clamp(((club.stadium && club.stadium.standing) || 0) * 45, 0, 16);
  let s = f.mood * 0.55 + 32 + tradition;
  s -= clamp((steh - 1) * 70, -8, 34);                        // Stehplatzpreise treffen hart
  s -= kommerz * 16;
  s -= f.groll * 0.22;
  s -= f.protest * 0.3;
  s += (f.kommunikation - 50) * 0.12;
  s = clamp(s, 0, 100);

  return {
    anzahl,
    stimmung: round(s, 1),
    choreoBereit: s >= 44 && !f.choreo && intensitaet > 0.2,
    protestbereit: s < 38 || f.protest > 45,
    text: s >= 70 ? 'Die Kurve brennt — im guten Sinne.'
      : s >= 50 ? 'Die Ultras ziehen mit, schauen aber genau hin.'
        : s >= 34 ? 'In der Kurve wird getuschelt. Das ist selten ein gutes Zeichen.'
          : 'Die Ultras haben innerlich gekündigt. Die Transparente sind fertig.'
  };
}

/**
 * Beliebtheit eines einzelnen Spielers bei den Fans (0..100).
 * Legenden und Eigengewächse sehr hoch, teure Fehleinkäufe niedrig.
 */
export function fanbeliebtheit(state, playerId) {
  const p = state.players[playerId];
  if (!p) return 50;
  const club = p.clubId ? state.clubs[p.clubId] : null;
  let v = 46;

  if (p.era === 'legend') v += 30;
  const traits = p.traits || [];
  if (traits.includes('fanliebling')) v += 17;
  if (traits.includes('weltfussballer')) v += 8;
  if (traits.includes('leader') || traits.includes('kabinenleader')) v += 5;
  if (traits.includes('querulant')) v -= 12;
  if (traits.includes('mimose')) v -= 5;
  if (p.captain) v += 6;
  if (p.jugend || p.eigengewaechs || p.ausJugend) v += 14;

  const jahre = clamp(state.date.season - ((p.joined && p.joined.season) || state.date.season), 0, 12);
  v += Math.min(12, jahre * 3);

  // Leistung dieser Saison
  const st = p.stats && p.stats.season;
  if (st && st.spiele > 0) {
    const note = st.notenAnzahl ? st.notenSumme / st.notenAnzahl : 0;
    if (note > 0) v += clamp((note - 6.0) * 9, -14, 16);
    const tore = (st.tore || 0) + (st.vorlagen || 0) * 0.6;
    v += clamp(tore * 1.4, 0, 14);
    if ((st.motm || 0) > 0) v += Math.min(6, st.motm * 2);
  } else if (p.age >= 24) {
    v -= 4;   // spielt nicht, kennt keiner
  }

  if (typeof p.morale === 'number') v += clamp((p.morale - 65) / 8, -4, 4);
  if (typeof p.form === 'number') v += clamp((p.form - 50) / 8, -5, 5);

  // Teurer Fehleinkauf: hohes Gehalt, wenig Ertrag
  if (club && club.playerIds && club.playerIds.length) {
    let gsum = 0, n = 0;
    for (const id of club.playerIds) {
      const q = state.players[id];
      if (q && q.contract) { gsum += q.contract.salary || 0; n++; }
    }
    const schnitt = n ? gsum / n : 0;
    const gehalt = (p.contract && p.contract.salary) || 0;
    if (schnitt > 0 && gehalt > schnitt * 1.6) {
      const ovr = sicherOverall(p);
      const spiele = (st && st.spiele) || 0;
      if (spiele < 6 || ovr < 72) v -= clamp((gehalt / schnitt - 1.6) * 12 + 6, 0, 24);
    }
    const abloese = p.abloese || (p.transfer && p.transfer.abloese) || 0;
    if (abloese > 0 && (!st || (st.spiele || 0) < 8) && jahre >= 1) v -= 8;
  }

  if (p.injury) v -= 2;
  return clamp(Math.round(v), 1, 99);
}

/**
 * Risiko, dass die Fans zu harten Mitteln greifen (Boykott, Rückgabe von Dauerkarten).
 */
export function boykottRisiko(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { wert: 0, stufe: 'keins', text: '', gruende: [] };
  const f = fanState(club);
  const u = ultras(state, clubId);
  const pi = preisIndex(club, f);
  const gruende = [];

  let r = 0;
  if (f.mood < 45) { const d = (45 - f.mood) * 0.011; r += d; gruende.push({ label: 'Grundstimmung', delta: round(d, 2) }); }
  if (f.protest > 20) { const d = (f.protest - 20) * 0.0085; r += d; gruende.push({ label: 'Laufende Proteste', delta: round(d, 2) }); }
  if (f.groll > 20) { const d = (f.groll - 20) * 0.005; r += d; gruende.push({ label: 'Transferpolitik', delta: round(d, 2) }); }
  if (pi > 1.08) { const d = (pi - 1.08) * 1.5; r += d; gruende.push({ label: 'Ticketpreise', delta: round(d, 2) }); }
  if (u.stimmung < 40) { const d = (40 - u.stimmung) * 0.008; r += d; gruende.push({ label: 'Ultras', delta: round(d, 2) }); }
  const ohneSieg = f.form.slice(-6).filter(x => x !== 'S').length;
  if (ohneSieg >= 4) { const d = (ohneSieg - 3) * 0.035; r += d; gruende.push({ label: 'Sieglos-Serie', delta: round(d, 2) }); }

  r = clamp(r, 0, 1);
  const stufe = r >= 0.7 ? 'akut' : r >= 0.45 ? 'ernst' : r >= 0.2 ? 'leicht' : 'keins';
  const text = {
    keins: 'Kein Grund zur Sorge. Man kommt, man singt, man geht.',
    leicht: 'Vereinzelt hört man Unmut. Noch nichts Organisiertes.',
    ernst: 'Die Fanszene bereitet etwas vor. Der Fanbeauftragte rät dringend zum Gespräch.',
    akut: 'Der Boykott ist beschlossene Sache. Es geht nur noch um das Wann.'
  }[stufe];
  gruende.sort((a, b) => b.delta - a.delta);
  return { wert: round(r, 2), stufe, text, gruende };
}

/**
 * Heimvorteil für die Match-Engine.
 * @param {object} fixture Optional — bestimmt Heim/Auswärts, Derby und Choreo.
 * @returns {{faktor:number, text:string, teile:Array}}
 */
export function heimvorteil(state, clubId, fixture) {
  const club = state.clubs[clubId];
  if (!club) return { faktor: 1, text: '', teile: [] };
  const f = fanState(club);
  const teile = [];
  const zu = (label, d) => { if (Math.abs(d) >= 0.004) teile.push({ label, delta: round(d, 3) }); return d; };

  const daheim = !fixture || fixture.homeId === clubId;
  const gegnerId = fixture ? (daheim ? fixture.awayId : fixture.homeId) : null;
  const derby = gegnerId ? rivalitaet(clubId, gegnerId) : 0;

  if (!daheim) {
    // Mitgereiste Fans: kleiner, aber spürbarer Rückhalt in der Fremde
    let a = 1;
    a += zu('Auswärtsfahrer', ((f.mood - 55) / 100) * 0.055);
    a += zu('Ultras', (clamp(f.ultras, 0, 100) - 45) / 100 * 0.025);
    if (derby) a += zu('Derby', 0.012 * derby);
    if (f.boykott > 0) a += zu('Boykott', -0.02);
    const faktor = clamp(a, 0.97, 1.06);
    return {
      faktor: round(faktor, 3),
      text: faktor >= 1.03 ? 'Der Gästeblock ist voll und laut.' : faktor <= 0.99 ? 'Der Gästeblock bleibt heute leer.' : 'Ein paar Hundert sind mitgefahren.',
      teile
    };
  }

  let v = 1;
  v += zu('Stimmung', ((f.mood - 55) / 100) * 0.105);
  const u = ultras(state, clubId);
  v += zu('Ultras', ((u.stimmung - 50) / 100) * 0.05);

  const st = club.stadiumState || {};
  const kap = kapazitaet(club);
  const zuschauer = st.letzteZuschauer || f.dauerkarten || Math.round(kap * 0.72);
  const auslastung = clamp(zuschauer / Math.max(1, kap), 0, 1);
  v += zu('Auslastung', (auslastung - 0.8) * 0.11);
  v += zu('Stehplätze', (((club.stadium && club.stadium.standing) || 0) - 0.15) * 0.13);

  if (f.choreo && f.choreo.status === 'genehmigt' && (!fixture || f.choreo.fixtureId === fixture.id)) {
    v += zu('Choreografie', HV_CHOREO);
  }
  if (derby) v += zu('Derby', HV_DERBY * (derby / 3) * 1.4);
  v += zu('Protest', -(f.protest / 100) * 0.095);
  if (f.boykott > 0) v += zu('Boykott', -HV_BOYKOTT);

  const faktor = clamp(v, HV_MIN, HV_MAX);
  let text;
  if (faktor >= 1.12) text = 'Das Stadion kocht. Die Gäste werden von der ersten Minute an niedergebrüllt.';
  else if (faktor >= 1.06) text = 'Ordentlich Betrieb auf den Rängen — hier spielt es sich gut.';
  else if (faktor >= 1.0) text = 'Solide Kulisse, mehr aber auch nicht.';
  else if (faktor >= 0.95) text = 'Auf den Rängen herrscht Bibliotheksatmosphäre.';
  else text = 'Pfiffe schon beim Aufwärmen. Dieses Stadion ist heute ein Nachteil.';
  return { faktor: round(faktor, 3), text, teile };
}

/* ========================================================================== *
 *  MITGLIEDER
 * ========================================================================== */

/**
 * Mitgliederentwicklung. Mit `ctx` wird der Wochenschritt tatsächlich gebucht,
 * ohne `ctx` gibt es nur eine Prognose.
 */
export function mitgliederEntwicklung(state, clubId, ctx) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Verein unbekannt.', alt: 0, neu: 0, delta: 0 };
  const f = fanState(club);

  const platz = platzVon(state, club);
  const soll = erwartungsPlatz(club);
  const erfolg = platz ? clamp((soll - platz) / 8, -0.6, 0.7) : 0;
  // Alle drei Faktoren sind auf 1,0 zentriert: bei durchschnittlicher Stimmung,
  // durchschnittlichem Potenzial und Erstligazugehörigkeit bleibt die Kartei stehen.
  // Sonst wüchse selbst ein Verein in offener Revolte noch.
  const stimmungsFaktor = 0.695 + (f.mood / 100) * 0.55;     // 0.695 .. 1.245, neutral bei 55
  const ligaFaktor = club.leagueId === 'bl1' ? 1.03 : 0.92;
  const potenzial = 1 + (((f.potential || 50) - 50) / 100) * 0.35;

  let ziel = f.startMitglieder * stimmungsFaktor * (1 + erfolg * 0.22) * ligaFaktor * potenzial;
  ziel *= 1 - clamp(f.groll / 100, 0, 1) * 0.12;
  ziel = clamp(ziel, f.startMitglieder * MITGLIEDER_MIN_FAKTOR, f.startMitglieder * MITGLIEDER_MAX_FAKTOR);

  const alt = Math.round(f.members);
  const schritt = (ziel - f.members) * MITGLIEDER_TEMPO;
  const neu = Math.round(f.members + schritt);
  const delta = neu - alt;

  if (ctx) {
    f.members = Math.max(200, neu);
    f.startMitglieder = f.startMitglieder || f.members;
  }

  let text;
  if (delta > alt * 0.004) text = `${nz(delta)} Neuzugänge in der Mitgliederkartei. Die Geschäftsstelle kommt mit dem Ausdrucken der Ausweise nicht hinterher.`;
  else if (delta > 0) text = `${nz(delta)} neue Mitglieder. Ruhiges, gesundes Wachstum.`;
  else if (delta < -alt * 0.003) text = `${nz(-delta)} Austritte. Die Kündigungen kommen inzwischen mit der Post im Bündel.`;
  else if (delta < 0) text = `${nz(-delta)} Austritte. Nichts Dramatisches, aber unschön.`;
  else text = 'Die Mitgliederzahl bewegt sich nicht.';

  return { ok: true, alt, neu, delta, ziel: Math.round(ziel), text };
}

function nz(v) { return Math.abs(Math.round(v)).toLocaleString('de-DE'); }

/* ========================================================================== *
 *  MERCHANDISING
 * ========================================================================== */

/**
 * Merchandising-Einnahmen. Ohne `ctx` nur Hochrechnung, mit `ctx` wird der
 * Monatsbetrag gebucht (Kategorie 'merchandising').
 */
export function merchandising(state, clubId, ctx) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Verein unbekannt.', betrag: 0, jahr: 0 };
  const f = fanState(club);

  const kap = kapazitaet(club);
  const st = club.stadiumState || {};
  const auslastung = clamp((st.auslastungSchnitt || (st.letzteZuschauer ? st.letzteZuschauer / kap : 0.78)), 0.25, 1);
  const besuche = kap * auslastung * MERCH_HEIMSPIELE;

  let jahr = f.members * MERCH_PRO_MITGLIED + besuche * MERCH_PRO_BESUCH;
  jahr *= MERCH_LIGA_FAKTOR[club.leagueId] !== undefined ? MERCH_LIGA_FAKTOR[club.leagueId] : 0.5;

  // Stimmung
  jahr *= MERCH_STIMMUNG[0] + (f.mood / 100) * (MERCH_STIMMUNG[1] - MERCH_STIMMUNG[0]);
  // Erfolg
  const platz = platzVon(state, club);
  if (platz) jahr *= clamp(1 + (erwartungsPlatz(club) - platz) * 0.022, 0.82, 1.3);
  // Ruf: überproportional — die Marke verkauft, nicht die Einwohnerzahl
  jahr *= clamp(Math.pow((club.reputation || 50) / MERCH_RUF_REF, MERCH_RUF_EXP),
    MERCH_RUF_KAPPE[0], MERCH_RUF_KAPPE[1]);
  // Stars: der beste Spieler verkauft Trikots
  let bester = 0;
  for (const id of (club.playerIds || [])) {
    const p = state.players[id];
    if (!p) continue;
    const o = sicherOverall(p) + (p.era === 'legend' ? 6 : 0);
    if (o > bester) bester = o;
  }
  jahr *= clamp(1 + (bester - 74) * 0.009, 0.9, MERCH_STAR_MAX);
  // Boykott und Groll gehen direkt in den Fanshop
  jahr *= 1 - clamp(f.protest / 100, 0, 1) * 0.16 - clamp(f.groll / 100, 0, 1) * 0.1;

  jahr = Math.max(0, Math.round(jahr));

  const d = dateFromDayIndex(state.date.day, state.date.season, state.date.startYear || 2025);
  const anteil = MERCH_MONAT[d.month] || (1 / 12);
  const betrag = Math.round(jahr * anteil);

  if (ctx) {
    bucheGeld(state, club, betrag, 'merchandising', `Merchandising ${monatsName(d.month)}`);
    f.merchSaison = (f.merchSaison || 0) + betrag;
    f.merchJahr = jahr;
  }

  return {
    ok: true,
    betrag,
    jahr,
    text: `Fanshop und Onlinehandel im ${monatsName(d.month)}: ${formatMoney(betrag)}. ` +
      `Hochgerechnet aufs Jahr sind das ${formatMoney(jahr)}.`
  };
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
function monatsName(m) { return MONATE[clamp(m, 0, 11)]; }

/* ========================================================================== *
 *  CHOREOGRAFIEN
 * ========================================================================== */

/**
 * Die Ultras fragen eine Choreografie für ein bestimmtes Spiel an.
 * Erzeugt eine Fanaktion vom Typ 'choreo' mit den Reaktionen
 * genehmigen / bezuschussen / ablehnen.
 */
export function choreoAnfrage(state, clubId, rng) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Verein unbekannt.' };
  const f = fanState(club);
  const r = rng || rngVon(state, null, 'choreo:' + clubId);

  if (f.choreo && f.choreo.status !== 'abgelehnt' && f.choreo.dayIndex >= state.date.day) {
    return { ok: false, text: 'Für das nächste Heimspiel liegt bereits eine Anfrage vor.' };
  }
  const u = ultras(state, clubId);
  if (u.stimmung < 30) {
    return { ok: false, text: 'Die Ultras planen derzeit keine Choreografie. Sie planen anderes.' };
  }

  // Passendes Heimspiel im Vorlauffenster suchen
  const von = state.date.day + CHOREO_VORLAUF_MIN;
  const bis = state.date.day + CHOREO_VORLAUF_MAX;
  let ziel = null, bestScore = -1;
  for (const fx of state.fixtures) {
    if (fx.played || fx.season !== state.date.season) continue;
    if (fx.homeId !== clubId) continue;
    if (fx.dayIndex < von || fx.dayIndex > bis) continue;
    const gegner = state.clubs[fx.awayId];
    if (!gegner) continue;
    const score = rivalitaet(clubId, fx.awayId) * 3 + (gegner.reputation || 50) / 25
      + (fx.competitionId === 'pokal' ? 2 : 0);
    if (score > bestScore) { bestScore = score; ziel = fx; }
  }
  if (!ziel) return { ok: false, text: 'Kein passendes Heimspiel in Sicht.' };

  const gegner = state.clubs[ziel.awayId];
  const derby = rivalitaet(clubId, ziel.awayId);
  const kosten = Math.round(CHOREO_KOSTEN_BASIS + kapazitaet(club) * CHOREO_KOSTEN_PRO_PLATZ * (1 + derby * 0.35));
  const gross = derby >= 2 || (gegner.reputation || 50) >= 85;

  const motive = gross
    ? ['ein Blockfahnenmeer über die gesamte Gegengerade', 'ein zwölf Meter hohes Vereinswappen aus Pappkarten',
      'eine Wanderfahne mit dem Gründungsjahr in Versalien', 'ein Bild der alten Haupttribüne, Baujahr anno dazumal']
    : ['ein Fahnenmeer in Vereinsfarben', 'ein Spruchband über zwei Blöcke',
      'eine Papierschnipsel-Choreo zum Einlaufen', 'hundert Doppelhalter mit dem Vereinswappen'];
  const motiv = r.pick(motive);

  f.choreo = {
    id: 'choreo_s' + state.date.season + '_' + ziel.id,
    fixtureId: ziel.id,
    dayIndex: ziel.dayIndex,
    gegner: gegner.shortName || gegner.name,
    gegnerId: gegner.id,
    kosten,
    zuschuss: 0,
    derby,
    motiv,
    status: 'angefragt'
  };

  const aktion = aktionAnlegen(state, club, {
    id: f.choreo.id,
    typ: 'choreo',
    art: 'anfrage',
    name: 'Choreografie zum Spiel gegen ' + f.choreo.gegner,
    text: `Drei Vertreter der Ultras stehen in der Geschäftsstelle. Sie wollen zum Spiel gegen ` +
      `${f.choreo.gegner} ${motiv} aufziehen. Material, Pyrotechnik-Verzicht und Genehmigung sind ihre Sache — ` +
      `${formatMoney(kosten)} und die Unterschrift des Vereins sind unsere. ` +
      `"Wir machen das sowieso", sagt der Älteste. "Schöner wär's mit euch."`,
    reaktionen: [
      { id: 'genehmigen', label: 'Genehmigen (Verein zahlt)' },
      { id: 'bezuschussen', label: 'Genehmigen und aufstocken' },
      { id: 'ablehnen', label: 'Ablehnen' }
    ],
    dayIndex: state.date.day
  });

  return { ok: true, text: aktion.text, aktion, choreo: f.choreo };
}

/** Entscheidung über eine vorliegende Choreo-Anfrage (auch via fanaktionAnwenden). */
export function choreoEntscheiden(state, clubId, entscheidung) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Verein unbekannt.' };
  const f = fanState(club);
  const c = f.choreo;
  if (!c || c.status !== 'angefragt') return { ok: false, text: 'Es liegt keine Choreo-Anfrage vor.' };

  if (entscheidung === 'ablehnen') {
    c.status = 'abgelehnt';
    f.mood = clamp(f.mood - 3.5, STIMMUNG_MIN, STIMMUNG_MAX);
    f.protest = clamp(f.protest + 9, 0, 100);
    f.ultras = clamp(f.ultras - 1.5, 0, 100);
    return {
      ok: true, text: `Die Anfrage ist abgelehnt. "Kein Problem", sagt der Älteste und zieht die Mütze tiefer. ` +
        `Am Spieltag hängt trotzdem ein Spruchband. Nur eben eines gegen den Verein.`,
      stimmung: round(f.mood, 1)
    };
  }

  const zuschuss = entscheidung === 'bezuschussen' ? Math.round(c.kosten * 0.6) : 0;
  const gesamt = c.kosten + zuschuss;
  const kasse = (club.finances && club.finances.balance) || 0;
  if (kasse < gesamt) {
    c.status = 'abgelehnt';
    return { ok: false, text: `Dafür ist kein Geld da. ${formatMoney(gesamt)} sind nicht im Etat — die Ultras nehmen es zur Kenntnis. Wortlos.` };
  }

  bucheGeld(state, club, -gesamt, 'fans', 'Choreografie gegen ' + c.gegner);
  c.zuschuss = zuschuss;
  c.status = 'genehmigt';
  f.mood = clamp(f.mood + (zuschuss ? 4.5 : 2.6), STIMMUNG_MIN, STIMMUNG_MAX);
  f.protest = clamp(f.protest - (zuschuss ? 10 : 6), 0, 100);
  f.ultras = clamp(f.ultras + (zuschuss ? 2 : 1), 0, 100);
  f.kommunikation = clamp(f.kommunikation + 3, 0, 100);

  return {
    ok: true,
    kosten: gesamt,
    stimmung: round(f.mood, 1),
    text: zuschuss
      ? `Genehmigt — und der Verein legt ${formatMoney(zuschuss)} obendrauf. In der Halle unter der Tribüne wird ab morgen ` +
        `genäht, gemalt und geklebt. Es riecht nach Leim und nach guter alter Zeit.`
      : `Genehmigt. ${formatMoney(gesamt)} für Stoff, Farbe und Pappe. Der Älteste nickt einmal kurz — mehr Dank gibt es nicht, ` +
        `aber am Spieltag sieht man ihn.`
  };
}

/* ========================================================================== *
 *  FANAKTIONEN
 * ========================================================================== */

const REAKTIONEN_PROTEST = [
  { id: 'dialog', label: 'Das Gespräch suchen' },
  { id: 'ignorieren', label: 'Aussitzen' },
  { id: 'vorstand', label: 'Vorstand einschalten' },
  { id: 'partei', label: 'Öffentlich Partei ergreifen' }
];
const REAKTIONEN_POSITIV = [
  { id: 'danken', label: 'Bedanken' },
  { id: 'mitfeiern', label: 'Mitfeiern' },
  { id: 'ignorieren', label: 'Zur Tagesordnung übergehen' }
];

/** Grundwirkung der Manager-Reaktionen. */
const REAKTION_WIRKUNG = {
  dialog: { mood: 2.6, protest: -14, groll: -8, kommunikation: 4, ultras: 1, board: 0, vertrauen: 0 },
  ignorieren: { mood: -1.8, protest: 6, groll: 3, kommunikation: -3, ultras: -1, board: 0, vertrauen: 0 },
  vorstand: { mood: -3.0, protest: -20, groll: 12, kommunikation: -2, ultras: -3, board: 1.5, vertrauen: 1 },
  partei: { mood: 6.0, protest: -11, groll: -6, kommunikation: 6, ultras: 3, board: -3, vertrauen: -1.5 },
  danken: { mood: 1.4, protest: -3, groll: -2, kommunikation: 2, ultras: 0.5, board: 0, vertrauen: 0 },
  mitfeiern: { mood: 4.0, protest: -6, groll: -4, kommunikation: 4, ultras: 2, board: -1, vertrauen: 0 }
};

const REAKTION_TEXT = {
  dialog: 'Zwei Stunden Fanabteilung, kalter Kaffee, offenes Wort. Am Ende gibt es zwar keine Einigung, aber Handschlag.',
  ignorieren: 'Kein Kommentar, keine Einladung, kein Termin. Auf den Rängen wird das sehr genau registriert.',
  vorstand: 'Der Vorstand schaltet den Ordnungsdienst ein. Ruhe kehrt ein — die Sorte Ruhe, die vor etwas kommt.',
  partei: 'Vor laufender Kamera stellt sich der Trainer vor die Fans. Die Kurve feiert. Im Präsidium schweigt man kalt.',
  danken: 'Ein kurzer Dank in der Pressekonferenz. Kostet nichts, wirkt trotzdem.',
  mitfeiern: 'Der Trainer steht nach dem Spiel selbst im Block, Schal über dem Kopf. Solche Bilder bleiben.'
};

/**
 * Aktionskatalog. `gewicht(k)` liefert 0, wenn die Aktion gerade nicht passt.
 * k = { club, f, mood, protest, groll, ultra, preisIndex, form, platz, soll,
 *       letztes, sieglos, siegserie, rng, state }
 */
const AKTIONS_KATALOG = [
  {
    id: 'standing_ovations', art: 'positiv', name: 'Standing Ovations',
    gewicht: k => (k.mood > 66 && k.letztes && k.letztes.ergebnis === 'S' && k.letztes.heim ? 3.5 : 0),
    text: k => `Nach dem Abpfiff bleibt niemand sitzen. Die Mannschaft geht Block für Block ab, und als der ` +
      `Kapitän das Trikot in die Kurve wirft, wird es noch einmal richtig laut. ${k.club.city} hat heute Abend gute Laune.`,
    wirkung: { mood: 1.8, protest: -4, groll: -2, ultras: 0.5 },
    reaktionen: REAKTIONEN_POSITIV
  },
  {
    id: 'autokorso', art: 'positiv', name: 'Autokorso',
    gewicht: k => (k.letztes && k.letztes.ergebnis === 'S' && k.letztes.derby >= 2 ? 4.5 : 0),
    text: k => `Bis nach Mitternacht hupt es durch die Innenstadt. Fahnen aus den Seitenfenstern, ` +
      `Schals aus den Schiebedächern, ein Ordnungsamt am Rande der Verzweiflung. Ein Derbysieg gegen ` +
      `${k.letztes.gegner} hält in ${k.club.city} ungefähr ein halbes Jahr.`,
    wirkung: { mood: 2.6, protest: -7, groll: -4, ultras: 1 },
    reaktionen: REAKTIONEN_POSITIV
  },
  {
    id: 'fanmarsch', art: 'positiv', name: 'Fanmarsch zum Stadion',
    gewicht: k => (k.mood > 52 && k.naechstesGross ? 3 : 0),
    text: k => `Die Fanabteilung meldet einen Marsch vom Hauptbahnhof zum Stadion an. ` +
      `Geschätzt ${nz(k.marschStaerke)} Menschen, Blaskapelle, zwei Wagen mit Trommeln und eine ` +
      `Genehmigung, die um 16 Uhr endet. Die Polizei bittet höflich um Beachtung.`,
    wirkung: { mood: 1.5, protest: -3, groll: -1, ultras: 1 },
    reaktionen: REAKTIONEN_POSITIV
  },
  {
    id: 'fanfest', art: 'positiv', name: 'Fanfest auf dem Vereinsgelände',
    gewicht: k => (k.mood > 48 && (k.tag < 44 || (k.tag > 176 && k.tag < 206)) ? 2.5 : 0),
    text: k => `Der Dachverband der Fanclubs richtet ein Fest auf dem Vereinsgelände aus: Bratwurst, Tombola, ` +
      `Autogrammstunde, ein Torwandschießen, an dem sich erwachsene Männer blamieren. ` +
      `Erwartet werden ${nz(k.marschStaerke * 2)} Besucher.`,
    wirkung: { mood: 2.2, protest: -5, groll: -3, mitglieder: 0.004 },
    reaktionen: REAKTIONEN_POSITIV
  },
  {
    id: 'spruchband_jugend', art: 'positiv', name: 'Spruchband für die Jugend',
    gewicht: k => (k.jugend > 0.35 ? 2.2 : 0),
    text: k => `Über der Gegengerade hängt ein handgemaltes Transparent: "AUS UNSERER STADT, IN UNSEREM TRIKOT". ` +
      `Darunter drei Namen aus der eigenen Jugend. Die Kurve hat gezählt, wer da spielt.`,
    wirkung: { mood: 2.0, protest: -4, groll: -3, ultras: 1 },
    reaktionen: REAKTIONEN_POSITIV
  },
  {
    id: 'protestbanner', art: 'protest', name: 'Protestbanner',
    gewicht: k => (k.mood < 48 || k.groll > 28 ? 3.2 : 0),
    text: k => `In der 20. Minute rollt die Kurve ein Transparent aus: "IHR VERWALTET, WIR LEIDEN." ` +
      `Der Stadionsprecher sagt nichts dazu, die Kameras halten drauf, und der Fanbeauftragte ` +
      `sieht plötzlich sehr müde aus.`,
    wirkung: { mood: -1.5, protest: 12, ultras: 0 },
    reaktionen: REAKTIONEN_PROTEST
  },
  {
    id: 'schweigen', art: 'protest', name: 'Zwölf Minuten Schweigen',
    gewicht: k => (k.preisIndex > 1.1 ? 5 : 0),
    text: k => `Zwölf Minuten lang keine Trommel, kein Vorsänger, kein Ton — für zwölf Euro Preiserhöhung. ` +
      `Es ist die unheimlichste Viertelstunde, die dieses Stadion seit Jahren erlebt hat. ` +
      `Dann ein Spruchband: "FUSSBALL MUSS BEZAHLBAR BLEIBEN."`,
    wirkung: { mood: -2.2, protest: 15, ultras: -1 },
    reaktionen: REAKTIONEN_PROTEST
  },
  {
    id: 'trauermarsch', art: 'protest', name: 'Trauermarsch',
    gewicht: k => (k.groll > 42 ? 4.5 : 0),
    text: k => `Schwarze Fahnen, ein Trauerkranz vor dem Haupteingang, darauf eine Schleife: ` +
      `"UNSEREM VEREIN — ER STARB AN DER BILANZ." ${k.abgangName ? `Auf dem Kranz steht auch ein Name: ${k.abgangName}.` : ''} ` +
      `Der Zug geht schweigend einmal ums Stadion.`,
    wirkung: { mood: -3.2, protest: 18, ultras: -1 },
    reaktionen: REAKTIONEN_PROTEST
  },
  {
    id: 'dauerkarten_rueckgabe', art: 'protest', name: 'Rückgabe von Dauerkarten',
    gewicht: k => (k.preisIndex > 1.16 && k.mood < 52 ? 4 : 0),
    text: k => `Vor der Geschäftsstelle bildet sich eine Schlange. Nicht zum Kaufen. ` +
      `${nz(k.rueckgaben)} Dauerkarten kommen zurück, säuberlich in Briefumschlägen, ` +
      `viele mit handschriftlichen Zetteln: "Seit 1974 dabei. Bis dieser Preis wieder stimmt, nicht mehr."`,
    wirkung: { mood: -3.5, protest: 14, dauerkarten: -0.06 },
    reaktionen: REAKTIONEN_PROTEST
  },
  {
    id: 'boykott20', art: 'protest', name: 'Boykott der ersten 20 Minuten',
    gewicht: k => (k.protest > 52 || k.boykottRisiko > 0.5 ? 5 : 0),
    text: k => `Beim Anpfiff ist die Kurve leer. Vollständig leer. Zwanzig Minuten lang steht die ` +
      `größte Tribüne des Landes als graue Betonwand da, während die Mannschaft ohne Rückhalt spielt. ` +
      `Dann strömen sie herein, alle auf einmal — und singen, als wäre nichts gewesen. Die Botschaft ist angekommen.`,
    wirkung: { mood: -4.0, protest: 10, boykott: 1 },
    reaktionen: REAKTIONEN_PROTEST
  },
  {
    id: 'pyro', art: 'protest', name: 'Pyrotechnik',
    gewicht: k => (k.ultra > 55 && (k.protest > 25 || (k.letztes && k.letztes.derby >= 2)) ? 3.5 : 0),
    text: k => `Beim Einlaufen brennt der ganze Block. Rote Fackeln, weißer Rauch, ein Bild wie aus dem Bilderbuch — ` +
      `und drei Minuten Unterbrechung, ein wütender Schiedsrichter und ein Brief vom Sportgericht, ` +
      `der schneller kommt als die Rechnung fürs Trikotwaschen.`,
    wirkung: { mood: -0.5, protest: 3, ultras: 1, strafe: true },
    reaktionen: REAKTIONEN_PROTEST
  },
  {
    id: 'trainer_raus', art: 'protest', name: 'Trainer-raus-Rufe',
    gewicht: k => (k.mood < 34 && k.sieglos >= 4 ? 5.5 : 0),
    text: k => `Nach dem Schlusspfiff geht ein Sprechchor durch die Kurve, kurz, hart, unmissverständlich. ` +
      `Es ist keine Frage mehr, ob der Name des Trainers dabei fällt — nur noch, wie lange.`,
    wirkung: { mood: -2.0, protest: 12, vertrauen: -2 },
    reaktionen: REAKTIONEN_PROTEST
  },
  {
    id: 'sturm_geschaeftsstelle', art: 'protest', name: 'Sturm auf die Geschäftsstelle',
    gewicht: k => (k.protest > 68 && k.mood < 28 ? 6 : 0),
    text: k => `Etwa 200 Anhänger stehen im Foyer der Geschäftsstelle. Keine Gewalt, aber auch kein Weichen. ` +
      `Sie wollen den Vorstand sprechen, sie wollen ihn heute sprechen, und sie haben Zeit mitgebracht. ` +
      `Eine Mitarbeiterin verteilt Kaffee, weil ihr nichts Besseres einfällt.`,
    wirkung: { mood: -3.0, protest: 8, board: -2 },
    reaktionen: REAKTIONEN_PROTEST
  },
  {
    id: 'mitgliederbegehren', art: 'protest', name: 'Antrag auf außerordentliche Versammlung',
    gewicht: k => (k.protest > 58 && k.mitglieder > 12000 ? 3.5 : 0),
    text: k => `Ein Bündnis aus Fanclubs sammelt Unterschriften für eine außerordentliche Mitgliederversammlung. ` +
      `${nz(k.unterschriften)} sind es bereits. Auf der Tagesordnung steht genau ein Punkt, und der ist nicht freundlich formuliert.`,
    wirkung: { mood: -1.5, protest: 10, board: -1 },
    reaktionen: REAKTIONEN_PROTEST
  },
  {
    id: 'investorenprotest', art: 'protest', name: 'Protest gegen den Hauptsponsor',
    gewicht: k => (k.sponsor < -0.3 ? 3.5 : 0),
    text: k => `Tennisbälle auf dem Rasen, ein Spruchband quer über den Oberrang: ` +
      `"UNSER VEREIN IST KEIN GESCHÄFTSMODELL." Die Partie steht sieben Minuten still, ` +
      `der Sponsor twittert etwas von "lebendiger Fankultur" und meint das Gegenteil.`,
    wirkung: { mood: -2.0, protest: 13, ultras: 1 },
    reaktionen: REAKTIONEN_PROTEST
  }
];

const AKTIONEN_BY_ID = AKTIONS_KATALOG.reduce((m, a) => (m[a.id] = a, m), {});

function aktionAnlegen(state, club, data) {
  const f = fanState(club);
  const aktion = Object.assign({
    id: 'fa_' + club.id + '_' + state.date.season + '_' + state.date.day,
    typ: 'protest',
    art: 'protest',
    name: 'Fanaktion',
    text: '',
    reaktionen: REAKTIONEN_PROTEST,
    dayIndex: state.date.day,
    season: state.date.season,
    erledigt: false,
    reaktion: null
  }, data);
  f.aktionen.unshift(aktion);
  if (f.aktionen.length > 24) f.aktionen.length = 24;
  f.letzteAktionTag = state.date.day;
  return aktion;
}

/** Kontext für die Gewichtung des Aktionskatalogs. */
function aktionsKontext(state, club, rng) {
  const f = fanState(club);
  const u = ultras(state, club.id);
  const platz = platzVon(state, club);
  const letzte6 = f.form.slice(-6);
  let sieglos = 0;
  for (let i = letzte6.length - 1; i >= 0; i--) { if (letzte6[i] === 'S') break; sieglos++; }
  let siegserie = 0;
  for (let i = letzte6.length - 1; i >= 0; i--) { if (letzte6[i] !== 'S') break; siegserie++; }

  // Steht ein großes Spiel an?
  let naechstesGross = false;
  for (const fx of state.fixtures) {
    if (fx.played || fx.season !== state.date.season) continue;
    if (fx.homeId !== club.id && fx.awayId !== club.id) continue;
    if (fx.dayIndex < state.date.day || fx.dayIndex > state.date.day + 5) continue;
    const gid = fx.homeId === club.id ? fx.awayId : fx.homeId;
    if (rivalitaet(club.id, gid) >= 2) { naechstesGross = true; break; }
    const g = state.clubs[gid];
    if (g && (g.reputation || 0) >= 86) { naechstesGross = true; break; }
  }

  return {
    state, club, f, rng,
    tag: state.date.day,
    mood: f.mood, protest: f.protest, groll: f.groll,
    ultra: u.stimmung, ultraZahl: u.anzahl,
    preisIndex: preisIndex(club, f),
    sponsor: sponsorWert(club),
    jugend: jugendWert(state, club),
    platz, soll: erwartungsPlatz(club),
    letztes: f.letztesSpiel,
    sieglos, siegserie,
    naechstesGross,
    mitglieder: f.members,
    boykottRisiko: boykottRisiko(state, club.id).wert,
    marschStaerke: Math.round(u.anzahl * 2.2 + f.members * 0.006),
    rueckgaben: Math.max(60, Math.round(f.dauerkarten * 0.045 + f.members * 0.002)),
    unterschriften: Math.max(500, Math.round(f.members * 0.09)),
    abgangName: f.letzterAbgang || null
  };
}

/**
 * Erzeugt — wenn die Lage danach ist — eine Fanaktion.
 * @returns {{ok:boolean, text:string, aktion?:object}}
 */
export function fanaktion(state, clubId, ctx) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Verein unbekannt.' };
  const f = fanState(club);
  const rng = rngVon(state, ctx, 'aktion:' + clubId);

  if (state.date.day - f.letzteAktionTag < AKTION_SPERRE_TAGE) {
    return { ok: false, text: 'Die Fanszene hat gerade erst von sich hören lassen.' };
  }

  const k = aktionsKontext(state, club, rng);
  // Dieselbe Aktion nicht in Endlosschleife: ein Protestbanner alle fünf Tage
  // wäre kein Protest mehr, sondern Tapete.
  const kandidaten = AKTIONS_KATALOG.filter(a => {
    if (a.gewicht(k) <= 0) return false;
    const letzte = f.aktionen.find(x => x.typ === a.id);
    if (!letzte) return true;
    const tage = (state.date.season - (letzte.season || state.date.season)) * SAISON_LAENGE
      + (state.date.day - letzte.dayIndex);
    return tage >= AKTION_WIEDERHOLUNG_TAGE;
  });
  if (!kandidaten.length) return { ok: false, text: 'Es ist alles ruhig.' };

  const gewaehlt = rng.pickWeighted(kandidaten, a => a.gewicht(k));
  if (!gewaehlt) return { ok: false, text: 'Es ist alles ruhig.' };

  const aktion = aktionAnlegen(state, club, {
    id: 'fa_' + gewaehlt.id + '_' + club.id + '_s' + state.date.season + '_t' + state.date.day,
    typ: gewaehlt.id,
    art: gewaehlt.art,
    name: gewaehlt.name,
    text: gewaehlt.text(k),
    reaktionen: gewaehlt.reaktionen
  });

  // Sofortwirkung der Aktion selbst
  const w = gewaehlt.wirkung || {};
  if (w.mood) f.mood = clamp(f.mood + w.mood, STIMMUNG_MIN, STIMMUNG_MAX);
  if (w.protest) f.protest = clamp(f.protest + w.protest, 0, 100);
  if (w.groll) f.groll = clamp(f.groll + w.groll, 0, 100);
  if (w.ultras) f.ultras = clamp(f.ultras + w.ultras, 0, 100);
  if (w.boykott) f.boykott = Math.max(f.boykott, w.boykott);
  if (w.dauerkarten) f.dauerkarten = Math.max(0, Math.round(f.dauerkarten * (1 + w.dauerkarten)));
  if (w.mitglieder) f.members = Math.round(f.members * (1 + w.mitglieder));
  if (w.board || w.vertrauen) vorstandEcho(club, w.board || 0, w.vertrauen || 0);

  // Pyrotechnik: das Sportgericht meldet sich
  if (w.strafe) {
    const strafe = Math.round(PYRO_STRAFE_BASIS + (club.reputation || 50) * PYRO_STRAFE_PRO_RUF * rng.float(0.6, 1.5));
    aktion.strafe = strafe;
    bucheGeld(state, club, -strafe, 'fans', 'Geldstrafe des Sportgerichts (Pyrotechnik)');
    aktion.text += ` Die Rechnung: ${formatMoney(strafe)}.`;
  }

  if (ctx) {
    melde(state, club, ctx, aktion.text, gewaehlt.art === 'positiv' ? 'fans' : 'protest', {
      from: gewaehlt.art === 'positiv' ? 'Fanbeauftragter' : 'Fanbeauftragter (dringend)',
      subject: gewaehlt.name,
      wichtig: gewaehlt.art !== 'positiv',
      aktionen: aktion.reaktionen.map(r => ({ id: r.id, label: r.label, modul: 'fans', aktionId: aktion.id }))
    });
    ticker(state, club, ctx, `${club.shortName}: ${gewaehlt.name}`, gewaehlt.art === 'positiv' ? 'fans' : 'protest');
  }

  return { ok: true, text: aktion.text, aktion };
}

/**
 * Reaktion des Managers auf eine Fanaktion. Jede Reaktion hat Folgen.
 * @param {string} reaktion  'dialog' | 'ignorieren' | 'vorstand' | 'partei' |
 *                           'danken' | 'mitfeiern' | 'genehmigen' | 'bezuschussen' | 'ablehnen'
 */
export function fanaktionAnwenden(state, clubId, aktionId, reaktion) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Verein unbekannt.' };
  const f = fanState(club);
  const aktion = f.aktionen.find(a => a.id === aktionId);
  if (!aktion) return { ok: false, text: 'Diese Fanaktion ist nicht mehr aktuell.' };
  if (aktion.erledigt) return { ok: false, text: 'Darauf wurde bereits reagiert.' };

  // Choreo-Anfragen laufen über die eigene Entscheidungslogik
  if (aktion.typ === 'choreo') {
    const res = choreoEntscheiden(state, clubId, reaktion);
    if (res.ok) { aktion.erledigt = true; aktion.reaktion = reaktion; aktion.ergebnisText = res.text; }
    return res;
  }

  const erlaubt = (aktion.reaktionen || []).some(r => r.id === reaktion);
  if (!erlaubt) return { ok: false, text: 'Diese Reaktion steht hier nicht zur Wahl.' };

  const w = REAKTION_WIRKUNG[reaktion];
  if (!w) return { ok: false, text: 'Unbekannte Reaktion.' };

  // Bei hoch gekochter Lage wirkt ein nettes Gespräch nur noch halb
  const daempfer = aktion.art === 'protest'
    ? clamp(1 - (f.protest - 45) / 130, 0.5, 1)
    : 1;
  // Wer den Vorstand schickt, obwohl die Ultras Recht haben, verschlimmert es
  const pi = preisIndex(club, f);
  const berechtigt = pi > 1.12 || f.groll > 40;

  let mood = w.mood * daempfer;
  let protest = w.protest * daempfer;
  let groll = w.groll;
  if (reaktion === 'vorstand' && berechtigt) { mood -= 2.5; groll += 6; protest *= 0.6; }
  if (reaktion === 'dialog' && berechtigt) { mood += 1.2; }
  if (reaktion === 'ignorieren' && aktion.art === 'positiv') { mood = -2.2; protest = 4; }

  f.mood = clamp(f.mood + mood, STIMMUNG_MIN, STIMMUNG_MAX);
  f.protest = clamp(f.protest + protest, 0, 100);
  f.groll = clamp(f.groll + groll, 0, 100);
  f.kommunikation = clamp(f.kommunikation + w.kommunikation, 0, 100);
  f.ultras = clamp(f.ultras + (w.ultras || 0), 0, 100);
  vorstandEcho(club, w.board || 0, w.vertrauen || 0);

  if (reaktion === 'dialog' || reaktion === 'partei') f.boykott = 0;

  aktion.erledigt = true;
  aktion.reaktion = reaktion;
  aktion.ergebnisText = REAKTION_TEXT[reaktion];

  return {
    ok: true,
    text: REAKTION_TEXT[reaktion],
    stimmung: round(f.mood, 1),
    protest: round(f.protest, 1),
    groll: round(f.groll, 1),
    delta: { mood: round(mood, 1), protest: round(protest, 1), groll: round(groll, 1) }
  };
}

/** Alle offenen Fanaktionen eines Vereins (für den Bildschirm). */
export function offeneFanaktionen(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return [];
  return fanState(club).aktionen.filter(a => !a.erledigt);
}

/* ========================================================================== *
 *  MITGLIEDERVERSAMMLUNG
 * ========================================================================== */

/**
 * Jahreshauptversammlung: Rechenschaft, Anträge, Abstimmungen.
 * Wird vom Tick am Stichtag ausgelöst, kann aber auch direkt aufgerufen werden.
 */
export function mitgliederversammlung(state, clubId, ctx) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Verein unbekannt.' };
  const f = fanState(club);
  if (f.mvSaison === state.date.season) {
    return { ok: false, text: 'Die Mitgliederversammlung hat in dieser Saison bereits stattgefunden.' };
  }
  f.mvSaison = state.date.season;

  const rng = rngVon(state, ctx, 'mv:' + clubId);
  const anwesend = Math.max(80, Math.round(f.members * clamp(0.035 + (60 - f.mood) / 900, 0.012, 0.11)));
  const pi = preisIndex(club, f);
  const platz = platzVon(state, club);
  const soll = erwartungsPlatz(club);

  const beschluesse = [];
  const zustimmung = (basis) => clamp(Math.round(basis + rng.gauss(0, 6)), 2, 99);

  // 1. Entlastung des Vorstands
  const entlastungJa = zustimmung(f.mood * 0.85 + 18 - f.protest * 0.35 - f.groll * 0.15);
  const entlastet = entlastungJa >= 50;
  beschluesse.push({
    id: 'entlastung', frage: 'Entlastung des Vorstands', ja: entlastungJa, angenommen: entlastet,
    text: entlastet
      ? `Der Vorstand wird mit ${entlastungJa} % entlastet. Applaus im Saal, ein paar verschränkte Arme in Reihe zwölf.`
      : `Der Vorstand wird NICHT entlastet — nur ${entlastungJa} % Zustimmung. Das hat es hier seit Menschengedenken nicht gegeben.`
  });
  if (!entlastet) {
    vorstandEcho(club, -4, -3);
    f.protest = clamp(f.protest + 10, 0, 100);
  } else {
    vorstandEcho(club, 1, 1);
  }

  // 2. Antrag gegen Ticketpreiserhöhungen
  if (pi > 1.04) {
    const ja = zustimmung(52 + (pi - 1) * 160 - f.mood * 0.2);
    const angenommen = ja >= 50;
    beschluesse.push({
      id: 'preisdeckel', frage: 'Antrag: Keine weiteren Ticketpreiserhöhungen', ja, angenommen,
      text: angenommen
        ? `Mit ${ja} % beschließt die Versammlung einen Preisdeckel. Die Kaufmännische Leitung notiert das mit steinerner Miene.`
        : `Der Preisdeckel-Antrag scheitert mit ${ja} %. Die Antragsteller kündigen an, wiederzukommen.`
    });
    if (angenommen) {
      const pa = anker(club, f);
      pa.sitz = Math.max(pa.sitz, preiseVon(club).sitz * 0.97);
      f.mood = clamp(f.mood + 2, STIMMUNG_MIN, STIMMUNG_MAX);
      f.protest = clamp(f.protest - 8, 0, 100);
    }
  }

  // 3. Beitragserhöhung zugunsten der Jugend
  if (f.mood > 55) {
    const ja = zustimmung(f.mood * 0.8 + 8);
    const angenommen = ja >= 50;
    const ertrag = Math.round(f.members * 12);
    beschluesse.push({
      id: 'beitrag', frage: 'Antrag: 12 € mehr Jahresbeitrag für die Nachwuchsarbeit', ja, angenommen,
      text: angenommen
        ? `Angenommen mit ${ja} %. ${formatMoney(ertrag)} pro Jahr zusätzlich für die eigene Jugend — ` +
          `beschlossen von Leuten, die selbst mal dort angefangen haben.`
        : `Abgelehnt mit ${ja} % Zustimmung. "Erst die Zahlen, dann das Geld", ruft jemand aus dem Saal.`
    });
    if (angenommen) {
      bucheGeld(state, club, ertrag, 'fans', 'Beitragserhöhung Nachwuchsarbeit');
      if (club.youth) club.youth.akademie = clamp((club.youth.akademie || 50) + 1, 1, 100);
      f.mood = clamp(f.mood + 1.5, STIMMUNG_MIN, STIMMUNG_MAX);
    }
  }

  // 4. Vertrauensvotum für den Trainer (nur beim Verein des Spielers)
  let vertrauensvotum = null;
  if (istMein(state, club)) {
    const basis = f.mood * 0.75 + 22 + (platz ? (soll - platz) * 1.8 : 0) - f.protest * 0.3
      + (f.kommunikation - 50) * 0.25;
    const ja = zustimmung(basis);
    vertrauensvotum = { ja, angenommen: ja >= 50 };
    beschluesse.push({
      id: 'vertrauen', frage: 'Vertrauensvotum für den Cheftrainer', ja, angenommen: ja >= 50,
      text: ja >= 75 ? `${ja} % sprechen dem Trainer das Vertrauen aus. Standing Ovations im Saal — so etwas hält man in Ehren.`
        : ja >= 50 ? `${ja} % sprechen dem Trainer das Vertrauen aus. Höflicher Applaus, mehr nicht.`
          : `Nur ${ja} % sprechen dem Trainer das Vertrauen aus. Der Saal wird sehr still, als das Ergebnis verlesen wird.`
    });
    vorstandEcho(club, ja >= 50 ? 1 : -3, ja >= 50 ? 1 : -3);
  }

  // Mitgliederschub
  const zuwachs = Math.round(f.members * (f.mood > 60 ? 0.006 : 0.001));
  f.members += zuwachs;

  const kopf = `Mitgliederversammlung ${(state.date.startYear || 2025) + state.date.season - 1}, ` +
    `${nz(anwesend)} stimmberechtigte Mitglieder in der Halle. Es riecht nach Filterkaffee und alten Wimpeln.`;
  const body = kopf + '\n\n' + beschluesse.map(b => `• ${b.frage}: ${b.text}`).join('\n\n');

  if (ctx) {
    melde(state, club, ctx, body, 'verein', {
      from: 'Geschäftsstelle', subject: 'Protokoll der Mitgliederversammlung', wichtig: true
    });
    ticker(state, club, ctx, `${club.shortName}: Mitgliederversammlung — Vorstand ${entlastet ? 'entlastet' : 'nicht entlastet'}`, 'verein');
  }

  return { ok: true, text: body, anwesend, beschluesse, entlastet, vertrauensvotum, zuwachs };
}

/* ========================================================================== *
 *  ERGEBNISVERARBEITUNG
 * ========================================================================== */

/** Index: clubId -> [zuletzt gespielte Fixtures] (ein Durchlauf pro Tick). */
function spieleIndex(state, abTag) {
  const map = new Map();
  for (const fx of state.fixtures) {
    if (!fx.played || fx.season !== state.date.season) continue;
    if (fx.dayIndex < abTag) continue;
    if (toreAus(fx) === null) continue;
    for (const id of [fx.homeId, fx.awayId]) {
      if (!id) continue;
      let liste = map.get(id);
      if (!liste) { liste = []; map.set(id, liste); }
      liste.push(fx);
    }
  }
  return map;
}

/** Verarbeitet ein einzelnes Ergebnis und liefert den sofortigen Stimmungsschub. */
function ergebnisSchub(state, club, f, fx) {
  const tore = toreAus(fx);
  if (!tore) return 0;
  const daheim = fx.homeId === club.id;
  const eigene = daheim ? tore[0] : tore[1];
  const fremde = daheim ? tore[1] : tore[0];
  const ergebnis = eigene > fremde ? 'S' : eigene < fremde ? 'N' : 'U';
  const gegnerId = daheim ? fx.awayId : fx.homeId;
  const gegner = state.clubs[gegnerId];
  const derby = rivalitaet(club.id, gegnerId);

  let d = ERGEBNIS_SCHUB[ergebnis];

  // Gegnerstärke
  if (gegner) {
    const repDiff = (gegner.reputation || 50) - (club.reputation || 50);
    if (ergebnis === 'S') d *= clamp(1 + repDiff / GEGNER_GEWICHT, 0.55, 2.1);
    else if (ergebnis === 'N') d *= clamp(1 - repDiff / GEGNER_GEWICHT, 0.5, 2.2);
    else d = repDiff > 12 ? 1.2 : repDiff < -12 ? -1.6 : d;
  }
  // Heim/Auswärts
  if (ergebnis === 'N' && daheim) d *= HEIMNIEDERLAGE_FAKTOR;
  if (ergebnis === 'S' && !daheim) d *= AUSWAERTSSIEG_FAKTOR;
  // Derby
  if (derby) d *= 1 + DERBY_ZUSCHLAG * derby;
  // Tore
  if (eigene > 2) d += TORFESTIVAL_BONUS * (eigene - 2);
  if (fremde > 3) d -= KLATSCHE_MALUS * (fremde - 3);
  // Pokal-Aus
  if (fx.competitionId === 'pokal' && ergebnis === 'N') d *= 1.35;

  d = clamp(d, -ERGEBNIS_KAPPE, ERGEBNIS_KAPPE);

  f.form.push(ergebnis);
  if (f.form.length > 8) f.form.shift();
  f.letztesSpiel = {
    ergebnis, heim: daheim, tore: [eigene, fremde], derby,
    gegner: gegner ? (gegner.shortName || gegner.name) : 'dem Gegner',
    gegnerId, tag: fx.dayIndex, wettbewerb: fx.competitionId
  };
  f.letzterSpieltag = Math.max(f.letzterSpieltag, fx.dayIndex);

  // Protest reagiert direkt mit
  if (ergebnis === 'S') f.protest = clamp(f.protest - (derby ? 8 : 4), 0, 100);
  else if (ergebnis === 'N') f.protest = clamp(f.protest + (daheim ? 3.5 : 2) * (1 + derby * 0.4), 0, 100);

  if (f.boykott > 0 && fx.homeId === club.id) f.boykott = Math.max(0, f.boykott - 1);

  return d;
}

/** Kadervergleich: Wer ist gegangen, wer gekommen? */
function kaderPruefen(state, club, f, ctx) {
  const jetzt = club.playerIds || [];
  const alt = f.kaderIds || [];
  if (!alt.length) { f.kaderIds = jetzt.slice(); return; }

  const jetztSet = new Set(jetzt);
  const altSet = new Set(alt);
  let grollNeu = 0, protestNeu = 0, moodNeu = 0;
  const abgaenge = [];

  for (const id of alt) {
    if (jetztSet.has(id)) continue;
    const p = state.players[id];
    if (!p) continue;
    if (p.clubId === club.id) continue;                       // nur umgehängt, kein Abgang
    if (p.retired || p.karriereende) continue;                // Karriereende: eigene Geschichte
    const stufe = identifikationsStufe(state, club, p) || 'stammspieler';
    grollNeu += VERKAUF_GROLL[stufe] || 0;
    protestNeu += VERKAUF_PROTEST[stufe] || 0;
    moodNeu += VERKAUF_SOFORT[stufe] || 0;
    abgaenge.push({ p, stufe });
  }

  let trost = 0;
  for (const id of jetzt) {
    if (altSet.has(id)) continue;
    const p = state.players[id];
    if (!p) continue;
    const ovr = sicherOverall(p);
    if (ovr >= 80) trost += NEUZUGANG_TROST;
    else if (ovr >= 74) trost += NEUZUGANG_TROST * 0.5;
    else if (p.age <= 20 && (p.potential || 0) >= 80) trost += NEUZUGANG_TROST * 0.35;
  }

  if (grollNeu || trost) {
    f.groll = clamp(f.groll + grollNeu - trost * 0.6, 0, 100);
    f.protest = clamp(f.protest + protestNeu, 0, 100);
    f.mood = clamp(f.mood + moodNeu + trost * 0.28, STIMMUNG_MIN, STIMMUNG_MAX);
  }

  for (const { p, stufe } of abgaenge) {
    const name = (p.firstName ? p.firstName + ' ' : '') + p.lastName;
    f.letzterAbgang = name;
    if (stufe === 'legend') {
      f.ultras = clamp(f.ultras + 2, 0, 100);
      melde(state, club, ctx,
        `${name} ist weg. ${name.split(' ').pop()} — der Mann, dessen Name auf jedem dritten Trikot in dieser Stadt steht, ` +
        `der Mann, für den Kinder Poster über ihr Bett hängen.\n\n` +
        `Vor der Geschäftsstelle liegen Schals. Nicht als Geschenk, als Rückgabe. Auf einem Zettel steht nur: ` +
        `"IHR HABT UNS UNSER GESICHT VERKAUFT."\n\nDas wird dauern. Das wird lange dauern.`,
        'protest', { from: 'Fanbeauftragter (dringend)', subject: 'Der Verkauf von ' + name, wichtig: true });
      ticker(state, club, ctx, `Fanzorn bei ${club.shortName}: Der Verkauf von ${name} spaltet den Verein`, 'protest');
    } else if (stufe === 'fanliebling') {
      melde(state, club, ctx,
        `Der Abgang von ${name} kommt in der Kurve nicht gut an. "Der hätte hier alt werden können", ` +
        `sagt ein Fanclub-Vorsitzender ins Mikrofon und dreht sich weg, bevor die Kamera zu nah kommt.`,
        'protest', { subject: 'Unmut über den Abgang von ' + name, wichtig: true });
    } else if (stufe === 'eigengewaechs') {
      melde(state, club, ctx,
        `${name} wechselt. Wieder eines von den eigenen Jungs. In der Kurve rechnet man inzwischen mit, ` +
        `wie viele es diese Saison waren.`,
        'fans', { subject: 'Abgang aus der eigenen Jugend' });
    }
  }

  f.kaderIds = jetzt.slice();
}

/* ========================================================================== *
 *  WOCHENARBEIT: PREISE UND TICKER
 * ========================================================================== */

/**
 * Wöchentlicher Direkteffekt der Ticketpreise.
 * Die Zielstimmung allein wäre den Fans zu langsam: Wer die Karten anzieht, soll
 * das schon in der Woche darauf an der Kasse und auf den Rängen merken.
 */
function preiseWirkenLassen(state, club, f, ctx, mein) {
  const pg = preisIndex(club, f);
  const pm = marktIndex(state, club);
  let d = 0;
  if (pg > PREIS_WOCHE_TOLERANZ) {
    d -= clamp((pg - PREIS_WOCHE_TOLERANZ) * PREIS_WOCHE_MALUS, 0, PREIS_WOCHE_MALUS_MAX);
  } else if (pg < 0.98) {
    d += clamp((0.98 - pg) * PREIS_WOCHE_BONUS, 0, PREIS_WOCHE_BONUS_MAX);
  }
  if (pm > MARKT_WUCHER) {
    d -= clamp((pm - MARKT_WUCHER) * PREIS_WOCHE_MALUS, 0, PREIS_WOCHE_MALUS_MAX);
  }
  if (d > -0.6) f.preisTickerMarke = false;   // Lage entspannt: Meldung wieder freigeben
  if (!d) return;

  f.mood = clamp(f.mood + d, STIMMUNG_MIN, STIMMUNG_MAX);
  if (d < 0) f.protest = clamp(f.protest - d * PREIS_WOCHE_PROTEST, 0, 100);

  if (mein && d < -0.6 && !f.preisTickerMarke) {
    f.preisTickerMarke = true;
    ticker(state, club, ctx, pm > MARKT_WUCHER
      ? `Teuerste Karten der Liga: Bei ${club.shortName} regt sich Widerstand gegen die Preispolitik`
      : `Fans von ${club.shortName} laufen Sturm gegen die neuen Ticketpreise`, 'protest');
    melde(state, club, ctx,
      `Die Fanabteilung legt eine Rechnung vor: Die Karten kosten inzwischen rund ` +
      `${Math.round((pg - 1) * 100)} % mehr als das, was hier über Jahre üblich war` +
      (pm > MARKT_WUCHER ? ` — und ${Math.round((pm - 1) * 100)} % mehr als beim Rest der Liga` : '') +
      `.\n\n"Wir sind nicht das Theater", sagt der Sprecher des Fanclub-Dachverbands. ` +
      `"Uns kann man sich nicht einmal im Jahr leisten."`,
      'protest', { from: 'Fanbeauftragter', subject: 'Unmut über die Ticketpreise', wichtig: true });
  }
}

/** Ticker bei deutlichen Stimmungsumschwüngen (Vergleich mit dem Wert von vor zwei Wochen). */
function stimmungsTicker(state, club, f, ctx, vorwoche) {
  const drei = f.verlauf.length >= 3 ? f.verlauf[f.verlauf.length - 3] : vorwoche;
  const delta = f.mood - drei;
  if (Math.abs(delta) < STIMMUNG_TICKER_SCHWELLE) return;
  if (f.letzterUmschwung !== undefined && Math.sign(f.letzterUmschwung) === Math.sign(delta)
    && Math.abs(delta) < Math.abs(f.letzterUmschwung) + 3) return;
  f.letzterUmschwung = delta;
  ticker(state, club, ctx, delta > 0
    ? `Stimmungsumschwung bei ${club.shortName}: ${stimmungsText(f.mood)}`
    : `Die Laune bei ${club.shortName} kippt: ${stimmungsText(f.mood)}`,
    delta > 0 ? 'fans' : 'protest');
}

/** Ticker bei neuen Mitgliederrekorden. */
function mitgliederTicker(state, club, f, ctx) {
  if (!f.mitgliederRekord) f.mitgliederRekord = f.members;
  if (f.members <= f.mitgliederRekord * MITGLIEDER_REKORD_SCHWELLE) return;
  f.mitgliederRekord = f.members;
  ticker(state, club, ctx,
    `Mitgliederrekord bei ${club.shortName}: ${nz(f.members)} Menschen im Verein`, 'verein');
}

/* ========================================================================== *
 *  TICK
 * ========================================================================== */

/**
 * Tagesablauf der Fanabteilung — läuft für ALLE Vereine.
 * Teuer gerechnet wird nur montags und nach Spielen; sonst nur Drift.
 */
export function tickFans(state, ctx) {
  const day = ctx && ctx.day !== undefined ? ctx.day : state.date.day;
  const season = ctx && ctx.season !== undefined ? ctx.season : state.date.season;
  const isWeekStart = ctx ? !!ctx.isWeekStart : false;
  const isMonthStart = ctx ? !!ctx.isMonthStart : false;
  const difficulty = (ctx && ctx.difficulty) || null;
  const geduld = difficulty && difficulty.fanPatience ? difficulty.fanPatience : 1;
  const rng = rngVon(state, ctx, 'tick');

  const clubs = Object.values(state.clubs);
  const spiele = spieleIndex(state, day - 4);

  for (const club of clubs) {
    const f = fanState(club);
    const mein = istMein(state, club);

    /* --- 1. Neue Ergebnisse verarbeiten --- */
    const fixtures = spiele.get(club.id);
    if (fixtures && fixtures.length) {
      const neu = fixtures.filter(fx => fx.dayIndex > f.letzterSpieltag)
        .sort((a, b) => a.dayIndex - b.dayIndex);
      for (const fx of neu) {
        const d = ergebnisSchub(state, club, f, fx);
        f.mood = clamp(f.mood + d * (d < 0 ? 1 / geduld : 1), STIMMUNG_MIN, STIMMUNG_MAX);
        if (mein && Math.abs(d) >= 5.5) {
          const l = f.letztesSpiel;
          ticker(state, club, ctx, d > 0
            ? `Ausgelassene Stimmung bei ${club.shortName} nach dem ${l.tore[0]}:${l.tore[1]} gegen ${l.gegner}`
            : `Lange Gesichter bei ${club.shortName} nach dem ${l.tore[0]}:${l.tore[1]} gegen ${l.gegner}`,
            d > 0 ? 'fans' : 'protest');
        }
      }
      // Choreo abarbeiten
      if (f.choreo && f.choreo.status === 'genehmigt' && f.choreo.dayIndex <= day) {
        melde(state, club, ctx,
          `Die Choreografie gegen ${f.choreo.gegner} saß. ${f.choreo.motiv.charAt(0).toUpperCase() + f.choreo.motiv.slice(1)} — ` +
          `zwei Minuten lang hat niemand im Stadion auf den Rasen geschaut. Bilder davon werden noch in zehn Jahren gezeigt.`,
          'fans', { subject: 'Die Choreo hat gesessen' });
        f.mood = clamp(f.mood + 1.6, STIMMUNG_MIN, STIMMUNG_MAX);
        f.choreo = null;
      } else if (f.choreo && f.choreo.dayIndex < day) {
        f.choreo = null;
      }
    }

    /* --- 2. Abklingen --- */
    f.protest = Math.max(0, f.protest - PROTEST_ABKLINGEN * geduld);
    f.groll = Math.max(0, f.groll - GROLL_ABKLINGEN * geduld);
    f.kommunikation += (50 - f.kommunikation) * (KOMMUNIKATION_RUECKKEHR / 100);

    /* --- 3. Preisanker: Gewöhnung an das aktuelle Preisniveau --- */
    const p = preiseVon(club);
    const a = anker(club, f);
    a.sitz += (p.sitz - a.sitz) * PREISANKER_GEWOEHNUNG;
    a.steh += (p.steh - a.steh) * PREISANKER_GEWOEHNUNG;
    a.dauerkarte += (p.dauerkarte - a.dauerkarte) * PREISANKER_GEWOEHNUNG;

    /* --- 4. Wochenarbeit: Ziel neu berechnen, Kader prüfen, Mitglieder --- */
    if (isWeekStart || !f.initialisiert) {
      f.initialisiert = true;
      kaderPruefen(state, club, f, ctx);
      const ziel = zielStimmung(state, club);
      f.ziel = ziel.wert;
      f.gruende = ziel.gruende.slice(0, 5);
      preiseWirkenLassen(state, club, f, ctx, mein);
      const m = mitgliederEntwicklung(state, club.id, ctx);
      const vorherigeStimmung = f.verlauf.length ? f.verlauf[f.verlauf.length - 1] : f.mood;
      f.verlauf.push(round(f.mood, 1));
      if (f.verlauf.length > 60) f.verlauf.shift();
      if (mein && Math.abs(m.delta) > m.alt * 0.006) {
        melde(state, club, ctx, m.text, 'verein', { from: 'Geschäftsstelle', subject: 'Mitgliederentwicklung' });
      }
      if (mein) {
        stimmungsTicker(state, club, f, ctx, vorherigeStimmung);
        mitgliederTicker(state, club, f, ctx);
      }
    }

    /* --- 5. Drift zur Zielstimmung --- */
    f.mood = clamp(f.mood + (f.ziel - f.mood) * TRAEGHEIT_TAG, STIMMUNG_MIN, STIMMUNG_MAX);

    /* --- 6. Merchandising (monatlich) --- */
    if (isMonthStart) {
      const m = merchandising(state, club.id, ctx);
      if (mein) melde(state, club, ctx, m.text, 'finanzen', { from: 'Kaufmännische Leitung', subject: 'Merchandising-Abrechnung' });
    }

    /* --- 7. Mitgliederversammlung --- */
    if (day === (SAISON_TAGE.mitgliederversammlung || 146) && f.mvSaison !== season) {
      mitgliederversammlung(state, club.id, mein ? ctx : null);
    }

    /* --- 8. Fanaktionen --- */
    const chance = (AKTION_GRUNDCHANCE + f.protest * AKTION_PROTEST_CHANCE)
      * (mein ? 1 : 0.35)                 // KI-Vereine machen weniger Wirbel (und sparen Rechenzeit)
      * (f.mood < 40 || f.mood > 70 ? 1.4 : 1);
    if (rng.chance(chance)) fanaktion(state, club.id, mein ? ctx : null);

    /* --- 9. Ultras fragen von sich aus nach einer Choreo --- */
    if (mein && !f.choreo && rng.chance(0.035)) {
      const u = ultras(state, club.id);
      if (u.choreoBereit) {
        const res = choreoAnfrage(state, club.id, rng);
        if (res.ok) {
          melde(state, club, ctx, res.text, 'fans', {
            from: 'Ultras ' + (club.city || club.shortName), subject: 'Anfrage Choreografie', wichtig: true,
            aktionen: res.aktion.reaktionen.map(r => ({ id: r.id, label: r.label, modul: 'fans', aktionId: res.aktion.id }))
          });
          ticker(state, club, ctx,
            `Die Kurve von ${club.shortName} kündigt eine Choreografie zum Spiel gegen ${res.choreo.gegner} an`, 'fans');
        }
      }
    }

    /* --- 10. Warnung bei akutem Boykottrisiko (nur einmal je Stufe) --- */
    if (mein && isWeekStart) {
      const risiko = boykottRisiko(state, club.id);
      if (risiko.stufe !== f.letzteRisikoStufe && (risiko.stufe === 'ernst' || risiko.stufe === 'akut')) {
        f.letzteRisikoStufe = risiko.stufe;
        melde(state, club, ctx,
          `${risiko.text}\n\nHauptgründe: ${risiko.gruende.slice(0, 3).map(g => g.label).join(', ') || 'diffus'}.\n\n` +
          `Der Fanbeauftragte bittet um einen Termin. Am besten diese Woche.`,
          'protest', { from: 'Fanbeauftragter (dringend)', subject: 'Lagebericht Fanszene', wichtig: true });
      } else if (risiko.stufe === 'keins' || risiko.stufe === 'leicht') {
        f.letzteRisikoStufe = risiko.stufe;
      }
    }
  }
}

/* ========================================================================== *
 *  Zusatz-Abfragen für die Bildschirme
 * ========================================================================== */

/** Kompakte Übersicht für den Vereinsbildschirm. */
export function fanUebersicht(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return null;
  const f = fanState(club);
  const s = stimmung(state, clubId);
  const u = ultras(state, clubId);
  const kap = kapazitaet(club);
  return {
    stimmung: s,
    ultras: u,
    mitglieder: Math.round(f.members),
    dauerkarten: Math.round(f.dauerkarten),
    dauerkartenQuote: round((f.dauerkarten / Math.max(1, kap)) * 100, 1),
    preisIndex: round(preisIndex(club, f), 3),
    protest: round(f.protest, 1),
    groll: round(f.groll, 1),
    boykott: boykottRisiko(state, clubId),
    heimvorteil: heimvorteil(state, clubId, null),
    merchandising: merchandising(state, clubId, null),
    choreo: f.choreo,
    offeneAktionen: f.aktionen.filter(a => !a.erledigt),
    verlauf: f.verlauf.slice(-24),
    beliebteste: (club.playerIds || [])
      .map(id => ({ id, wert: fanbeliebtheit(state, id) }))
      .sort((a, b) => b.wert - a.wert).slice(0, 5)
  };
}
