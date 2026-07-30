/**
 * club/board.js — DER VORSTAND
 *
 * Zuständig für: Erwartungen, Saisonziel, Zufriedenheit, Geduld, Forderungen,
 * Budgetverhandlungen, Mahnung → Ultimatum → Entlassung, Jobangebote anderer
 * Vereine, Rücktritt und KI-Nachfolger für verwaiste Vereine.
 *
 * Reine Logik: kein DOM, kein Math.random(), kein Date.now().
 * Alle Zufälle laufen über ctx.rng bzw. eine übergebene rng-Instanz; wo eine
 * Aktion ohne rng aufgerufen wird, leiten wir deterministisch aus
 * (state.seed, state.date, id) ab.
 *
 * ZUSTÄNDIGKEIT (CONTRACTS.md §11): ausschließlich `club.board.*`, dazu
 * lesend alles andere. Fremde Felder (Finanzen, Fans, Kader) werden nur
 * gelesen — mit einer Ausnahme: eine erfüllte Vorstandsforderung erhöht das
 * Transferbudget, eine gerissene senkt es. Das ist der vertraglich vorgesehene
 * Hebel des Vorstands.
 *
 * WICHTIG zur Speicherbarkeit: `forderung.pruefen` ist eine Funktion und
 * überlebt JSON.stringify nicht. Deshalb steht die eigentliche Prüflogik in der
 * Registry FORDERUNGS_TYPEN, adressiert über `forderung.typ`. Das zurückgegebene
 * Objekt trägt zusätzlich eine gebundene `pruefen(state)`-Funktion, wie der
 * Vertrag es verlangt.
 */

import { clamp, formatMoney, round, uid } from '../core/util.js';
import { DIFFICULTIES } from '../core/constants.js';
import { createRng } from '../core/rng.js';
import { LEAGUES, computeTable, leagueOfClub, qualificationFor, SAISON_TAGE } from '../data/leagues.js';
import { nationaltrainerAngebot } from './national.js';

/* ================================================================== *
 *  BALANCING — alle Stellschrauben an einem Ort
 * ================================================================== */

/** Gewichte der Teilnoten (Summe = 100). */
const GEWICHTE = {
  tabelle: 40,      // sportliche Platzierung gegen das Saisonziel
  finanzen: 18,     // Kontostand, Schulden, Gehaltslast
  fans: 14,         // Stimmung auf den Rängen
  pokal: 10,        // Pokal / Europapokal
  transfers: 10,    // Transferpolitik (Budgetdisziplin, Kaderwert)
  spielweise: 8     // Tore, Serien, Unterhaltungswert
};

/** Zufriedenheit bewegt sich pro Bewertung höchstens um so viele Punkte. */
const ANPASSUNG_PRO_WOCHE = 6;
/** Ab dieser Zufriedenheit steigt die Geduld wieder. */
const GEDULD_WOHLFUEHL = 58;
/** Unter diesem Wert beginnt die Geduld zu bröckeln. */
const GEDULD_SCHMERZ = 45;
/** Maximaler Geduldsverlust pro Woche (vor Schwierigkeitsgrad-Faktor). */
const GEDULD_VERLUST_MAX = 9;
const GEDULD_GEWINN_MAX = 4;

/** Eskalationsstufen der Zufriedenheit. */
const MAHNUNG_SCHWELLE = 38;
const ULTIMATUM_SCHWELLE = 26;
const ENTLASSUNG_SCHWELLE = 14;
/** Auch bei erträglicher Zufriedenheit: aufgebrauchte Geduld kostet den Job. */
const GEDULD_ENTLASSUNG = 2;

/** Schonfrist nach Amtsantritt (Tage) und Mindestzahl an Pflichtspielen. */
const SCHONFRIST_TAGE = 35;
const MIN_SPIELE_FUER_RAUSWURF = 6;
/** Nach einem Ultimatum bleiben so viele Tage Bewährung. */
const ULTIMATUM_TAGE = 24;
/** Punkte, die im Ultimatum-Zeitraum geholt werden müssen. */
const ULTIMATUM_PUNKTE_PRO_SPIEL = 1.5;

/** Forderungen: Häufigkeit und Wirkung. */
const FORDERUNG_INTERVALL_TAGE = 26;
const FORDERUNG_MAX_OFFEN = 2;
const FORDERUNG_BONUS_ZUFRIEDENHEIT = 7;
const FORDERUNG_MALUS_ZUFRIEDENHEIT = 9;
const FORDERUNG_BONUS_GEDULD = 6;
const FORDERUNG_MALUS_GEDULD = 8;

/** Budgetverhandlung. */
const BUDGET_SPERRE_TAGE = 21;
const BUDGET_MAX_ANTEIL_KONTO = 0.65;   // mehr als das gibt der Vorstand nie frei
const BUDGET_ZUFRIEDENHEIT_KOSTEN = 3;  // jede Anfrage nervt ein wenig

/** Jobangebote. */
const JOB_PRUEFUNG_TAGE = 21;
const JOB_MIN_SPIELE = 8;
const JOB_MAX_OFFEN = 2;
const JOB_ANGEBOT_GUELTIG_TAGE = 10;

/** Grobe Umsatzschätzung (nur zur Bewertung der Schuldenlast, kein Buchhalter!). */
const UMSATZ_BL1_BASIS = 65000000;   // Reputation 48 ≈ Heidenheim
const UMSATZ_BL1_RATE = 0.052;       // Reputation 95 ≈ 750 Mio
const UMSATZ_BL2_BASIS = 20000000;
const UMSATZ_BL2_RATE = 0.0405;

/* ================================================================== *
 *  Kleine Helfer
 * ================================================================== */

function boardOf(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return null;
  if (!club.board) {
    club.board = {
      name: club.boardName || 'Der Vorstand', zufriedenheit: 60, geduld: 60,
      erwartung: null, saisonziel: null, forderungen: [], warnungen: 0, vertrauen: 60
    };
  }
  const b = club.board;
  if (!Array.isArray(b.forderungen)) b.forderungen = [];
  if (b.warnungen === undefined) b.warnungen = 0;
  if (b.vertrauen === undefined) b.vertrauen = 60;
  if (b.ultimatum === undefined) b.ultimatum = null;
  if (!Array.isArray(b.historie)) b.historie = [];
  if (b.amtsantritt === undefined) b.amtsantritt = { season: state.date.season, day: 0 };
  if (b.letzteForderung === undefined) b.letzteForderung = -99;
  if (b.letzteBudgetanfrage === undefined) b.letzteBudgetanfrage = -99;
  if (b.letzteJobpruefung === undefined) b.letzteJobpruefung = -99;
  if (b.letzteBewertung === undefined) b.letzteBewertung = null;
  return b;
}

function schwierigkeit(state, ctx) {
  if (ctx && ctx.difficulty) return ctx.difficulty;
  return DIFFICULTIES[state.difficulty] || DIFFICULTIES.profi;
}

function istManagerClub(state, clubId) {
  return state.managerClubId === clubId;
}

/** Postfach-Eintrag. Nutzt ctx.log, wenn vorhanden — sonst direkt state.inbox. */
function post(state, ctx, clubId, msg) {
  if (!istManagerClub(state, clubId)) return null;
  const kind = msg.kind || 'vorstand';
  if (ctx && typeof ctx.log === 'function') {
    return ctx.log(msg.body, kind, {
      from: msg.from || vorstandName(state, clubId),
      subject: msg.subject,
      wichtig: !!msg.wichtig,
      aktionen: msg.aktionen || null
    });
  }
  const m = {
    id: uid('msg'), day: state.date.day, season: state.date.season, kind,
    from: msg.from || vorstandName(state, clubId),
    subject: msg.subject || '', body: msg.body || '',
    gelesen: false, wichtig: !!msg.wichtig, aktionen: msg.aktionen || null
  };
  if (!Array.isArray(state.inbox)) state.inbox = [];
  state.inbox.unshift(m);
  if (state.inbox.length > 300) state.inbox.length = 300;
  return m;
}

function ticker(state, ctx, clubId, text, kind = 'vorstand') {
  if (!istManagerClub(state, clubId)) return;
  if (ctx && typeof ctx.news === 'function') { ctx.news(text, kind); return; }
  if (!Array.isArray(state.news)) state.news = [];
  state.news.unshift({ id: uid('news'), day: state.date.day, season: state.date.season, text, kind });
  if (state.news.length > 200) state.news.length = 200;
}

function vorstandName(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return 'Der Vorstand';
  return (club.board && club.board.name) || club.boardName || 'Der Vorstand';
}

function rngFuer(state, label) {
  return createRng(`board:${state.seed}:${state.date.season}:${state.date.day}:${label}`);
}

/** Ergebnis eines Fixtures tolerant auslesen -> [heim, gast] | null */
function toreAus(fixture) {
  const res = fixture && fixture.result;
  if (!res) return null;
  if (Array.isArray(res) && res.length >= 2) return [res[0], res[1]];
  if (Array.isArray(res.score) && res.score.length >= 2) return [res.score[0], res.score[1]];
  if (typeof res.home === 'number' && typeof res.away === 'number') return [res.home, res.away];
  if (typeof res.heim === 'number' && typeof res.gast === 'number') return [res.heim, res.gast];
  if (typeof res.homeGoals === 'number' && typeof res.awayGoals === 'number') return [res.homeGoals, res.awayGoals];
  return null;
}

const _tabellenCache = { key: '', tabellen: {} };

/** Tabelle einer Liga — bevorzugt state.tables, sonst frisch gerechnet (mit Tagescache). */
export function tabelleVon(state, leagueId) {
  const vorhanden = state.tables && state.tables[leagueId];
  if (Array.isArray(vorhanden) && vorhanden.length) return vorhanden;
  const liga = LEAGUES[leagueId];
  if (!liga) return [];
  const key = `${state.date.season}:${state.date.day}:${state.tick || 0}`;
  if (_tabellenCache.key !== key) { _tabellenCache.key = key; _tabellenCache.tabellen = {}; }
  if (!_tabellenCache.tabellen[leagueId]) {
    _tabellenCache.tabellen[leagueId] = computeTable(state.fixtures || [], liga.clubIds, { competitionId: leagueId });
  }
  return _tabellenCache.tabellen[leagueId];
}

export function ligaVon(state, clubId) {
  const club = state.clubs[clubId];
  return (club && club.leagueId) || leagueOfClub(clubId) || 'bl1';
}

/** -> { platz, punkte, spiele, diff, tore, gegentore } (Fallback, wenn nichts gespielt) */
export function tabellenlage(state, clubId) {
  const ligaId = ligaVon(state, clubId);
  const tab = tabelleVon(state, ligaId);
  const zeile = tab.find(z => z.clubId === clubId);
  const anzahl = (LEAGUES[ligaId] ? LEAGUES[ligaId].clubIds.length : 18);
  if (!zeile) return { platz: Math.ceil(anzahl / 2), punkte: 0, spiele: 0, diff: 0, tore: 0, gegentore: 0, teams: anzahl, ligaId };
  return {
    platz: zeile.platz, punkte: zeile.punkte, spiele: zeile.spiele, diff: zeile.diff,
    tore: zeile.tore, gegentore: zeile.gegentore, teams: anzahl, ligaId
  };
}

/** Ergebnisse ('S'|'U'|'N') des Vereins nach einem Stichtag, chronologisch. */
function ergebnisseSeit(state, clubId, abTag, nurLiga = false) {
  const out = [];
  const liste = (state.fixtures || []).filter(f =>
    f && f.played && (f.homeId === clubId || f.awayId === clubId) &&
    f.season === state.date.season && f.dayIndex >= abTag &&
    (!nurLiga || f.competitionId === 'bl1' || f.competitionId === 'bl2') &&
    toreAus(f) !== null
  ).sort((a, b) => a.dayIndex - b.dayIndex);
  for (const f of liste) {
    const [h, a] = toreAus(f);
    const eigen = f.homeId === clubId ? h : a;
    const fremd = f.homeId === clubId ? a : h;
    out.push({ ergebnis: eigen > fremd ? 'S' : eigen < fremd ? 'N' : 'U', tore: eigen, gegentore: fremd, fixture: f });
  }
  return out;
}

function punkteAus(liste) {
  return liste.reduce((s, e) => s + (e.ergebnis === 'S' ? 3 : e.ergebnis === 'U' ? 1 : 0), 0);
}

function gehaltslast(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return 0;
  let s = 0;
  for (const id of club.playerIds || []) {
    const p = state.players[id];
    if (p && p.contract) s += p.contract.salary || 0;
  }
  return s;
}

function kaderwert(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return 0;
  let s = 0;
  for (const id of club.playerIds || []) {
    const p = state.players[id];
    if (p) s += p.value || 0;
  }
  return s;
}

/** Grobe Jahresumsatz-Schätzung aus der Reputation — nur als Maßstab für Schulden. */
export function umsatzSchaetzung(club) {
  const rep = clamp(club.reputation || 50, 20, 99);
  if (club.leagueId === 'bl2') return Math.round(UMSATZ_BL2_BASIS * Math.exp(UMSATZ_BL2_RATE * (rep - 40)));
  return Math.round(UMSATZ_BL1_BASIS * Math.exp(UMSATZ_BL1_RATE * (rep - 48)));
}

function pokalLage(state, clubId) {
  const spiele = (state.fixtures || []).filter(f =>
    f && f.competitionId === 'pokal' && f.season === state.date.season &&
    (f.homeId === clubId || f.awayId === clubId));
  let runden = 0, raus = false, letzteRunde = null;
  for (const f of spiele.sort((a, b) => a.dayIndex - b.dayIndex)) {
    if (!f.played) continue;
    letzteRunde = f.round || letzteRunde;
    if (f.freilos) { runden++; continue; }
    const t = toreAus(f);
    if (!t) continue;
    const eigen = f.homeId === clubId ? t[0] : t[1];
    const fremd = f.homeId === clubId ? t[1] : t[0];
    if (eigen > fremd) runden++;
    else if (eigen < fremd) { raus = true; break; }
  }
  const nochDabei = spiele.some(f => !f.played) || (!raus && runden > 0);
  return { runden, raus, nochDabei, letzteRunde, gespielt: spiele.some(f => f.played) };
}

function europaLage(state, clubId) {
  const spiele = (state.fixtures || []).filter(f =>
    f && ['cl', 'el', 'conf'].includes(f.competitionId) && f.season === state.date.season &&
    (f.homeId === clubId || f.awayId === clubId));
  if (!spiele.length) return { teilnahme: false, punkte: 0, spiele: 0 };
  let punkte = 0, gespielt = 0;
  for (const f of spiele) {
    const t = toreAus(f);
    if (!f.played || !t) continue;
    gespielt++;
    const eigen = f.homeId === clubId ? t[0] : t[1];
    const fremd = f.homeId === clubId ? t[1] : t[0];
    punkte += eigen > fremd ? 3 : eigen === fremd ? 1 : 0;
  }
  return { teilnahme: true, punkte, spiele: gespielt, wettbewerb: spiele[0].competitionId };
}

/* ================================================================== *
 *  SAISONZIEL
 * ================================================================== */

const ZIEL_TEXTE = [
  { minRep: 90, text: 'Die Meisterschale bleibt im Haus', platz: 1, minPlatz: 2, pokal: 'Halbfinale', kind: 'titel' },
  { minRep: 84, text: 'Meisterschaftskampf und Champions League', platz: 2, minPlatz: 4, pokal: 'Viertelfinale', kind: 'titel' },
  { minRep: 78, text: 'Champions-League-Qualifikation', platz: 4, minPlatz: 7, pokal: 'Achtelfinale', kind: 'international' },
  { minRep: 70, text: 'Internationales Geschäft', platz: 6, minPlatz: 9, pokal: 'Achtelfinale', kind: 'international' },
  { minRep: 62, text: 'Einstelliger Tabellenplatz', platz: 9, minPlatz: 12, pokal: '2. Runde', kind: 'mittelfeld' },
  { minRep: 54, text: 'Gesichertes Mittelfeld', platz: 11, minPlatz: 14, pokal: '2. Runde', kind: 'mittelfeld' },
  { minRep: 46, text: 'Klassenerhalt ohne Zitterpartie', platz: 13, minPlatz: 15, pokal: '1. Runde', kind: 'erhalt' },
  { minRep: 0, text: 'Klassenerhalt — sonst nichts', platz: 15, minPlatz: 16, pokal: '1. Runde', kind: 'erhalt' }
];

const ZIEL_TEXTE_BL2 = [
  { minRep: 66, text: 'Direkter Wiederaufstieg', platz: 1, minPlatz: 3, pokal: '2. Runde', kind: 'aufstieg' },
  { minRep: 58, text: 'Aufstieg — mindestens die Relegation', platz: 2, minPlatz: 4, pokal: '2. Runde', kind: 'aufstieg' },
  { minRep: 50, text: 'Oben mitspielen', platz: 5, minPlatz: 8, pokal: '1. Runde', kind: 'mittelfeld' },
  { minRep: 42, text: 'Ruhige Saison im Mittelfeld', platz: 9, minPlatz: 13, pokal: '1. Runde', kind: 'mittelfeld' },
  { minRep: 0, text: 'Klassenerhalt', platz: 14, minPlatz: 16, pokal: '1. Runde', kind: 'erhalt' }
];

/**
 * Legt das Saisonziel eines Vereins fest: Reputation, Vorsaison-Platzierung und
 * Kaderwert im Ligavergleich fließen ein.
 * @returns {object} saisonziel
 */
export function saisonzielSetzen(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return null;
  const b = boardOf(state, clubId);
  const ligaId = ligaVon(state, clubId);
  const liga = LEAGUES[ligaId];
  const zielTabelle = ligaId === 'bl2' ? ZIEL_TEXTE_BL2 : ZIEL_TEXTE;

  // Kaderwert im Ligavergleich (Rang 1 = teuerster Kader)
  let rang = 0, gesamt = 1;
  if (liga) {
    const werte = liga.clubIds.map(id => ({ id, wert: kaderwert(state, id) })).sort((a, b2) => b2.wert - a.wert);
    gesamt = werte.length;
    rang = werte.findIndex(w => w.id === clubId) + 1;
  }

  const rep = club.reputation || 50;
  const basis = zielTabelle.find(z => rep >= z.minRep) || zielTabelle[zielTabelle.length - 1];

  // Kaderwert-Rang korrigiert das Ziel um bis zu drei Plätze
  let ziel = basis.platz;
  if (rang > 0) {
    const erwartetVomKader = Math.round(rang * 0.9);
    ziel = Math.round(ziel * 0.6 + erwartetVomKader * 0.4);
  }
  // Vorsaison
  const letzte = (state.history && state.history.seasons || [])
    .filter(s => s && s.clubId === clubId).slice(-1)[0];
  if (letzte && letzte.platz) ziel = Math.round(ziel * 0.75 + letzte.platz * 0.25);

  ziel = clamp(ziel, 1, gesamt);
  const minPlatz = clamp(ziel + (basis.kind === 'erhalt' ? 2 : 3), ziel, gesamt);

  const saisonziel = {
    text: basis.text,
    platz: ziel,
    minPlatz,
    pokal: basis.pokal,
    kind: basis.kind,
    ligaId,
    season: state.date.season,
    kaderRang: rang
  };
  b.saisonziel = saisonziel;
  if (!b.erwartung) b.erwartung = { text: basis.text, platz: ziel, minPlatz };
  return saisonziel;
}

/* ================================================================== *
 *  BEWERTUNG
 * ================================================================== */

function note(z) {
  if (z >= 85) return 1;
  if (z >= 72) return 2;
  if (z >= 58) return 3;
  if (z >= 44) return 4;
  if (z >= 30) return 5;
  return 6;
}

export const NOTEN_TEXT = {
  1: 'begeistert', 2: 'sehr zufrieden', 3: 'zufrieden',
  4: 'unzufrieden', 5: 'alarmiert', 6: 'kurz vor der Trennung'
};

/**
 * Bewertet die Arbeit des Trainers.
 * @returns {{zufriedenheit:number, geduld:number, note:number, gruende:string[], ziel:number, teil:object}}
 */
export function bewertung(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { zufriedenheit: 50, geduld: 50, note: 4, gruende: [], ziel: 50, teil: {} };
  const b = boardOf(state, clubId);
  if (!b.saisonziel) saisonzielSetzen(state, clubId);
  const ziel = b.saisonziel;
  const lage = tabellenlage(state, clubId);
  const gruende = [];
  const teil = {};

  /* --- 1. Tabelle ------------------------------------------------- */
  const delta = ziel.platz - lage.platz;           // positiv = besser als Ziel
  let tabelleScore = clamp(58 + delta * 7, 0, 100);
  const qual = qualificationFor(lage.ligaId, lage.platz);
  if (qual === 'abstieg') { tabelleScore = Math.min(tabelleScore, 12); }
  else if (qual === 'relegation') { tabelleScore = Math.min(tabelleScore, 26); }
  else if (qual === 'meister') { tabelleScore = Math.max(tabelleScore, 92); }
  if (lage.spiele === 0) tabelleScore = 55;        // vor dem ersten Spieltag: neutral
  teil.tabelle = tabelleScore;
  if (lage.spiele > 0) {
    if (delta >= 3) gruende.push(`Platz ${lage.platz} — deutlich über dem Saisonziel (${ziel.platz}.).`);
    else if (delta >= 0) gruende.push(`Platz ${lage.platz} — das Saisonziel ist in Reichweite.`);
    else if (delta >= -3) gruende.push(`Platz ${lage.platz} — noch hinter dem Ziel (${ziel.platz}.), aber nichts ist verloren.`);
    else gruende.push(`Platz ${lage.platz} — das Saisonziel (${ziel.platz}.) ist derzeit eine Fata Morgana.`);
    if (qual === 'abstieg') gruende.push('Der Verein steht auf einem direkten Abstiegsplatz. Das ist inakzeptabel.');
    else if (qual === 'relegation') gruende.push('Relegationsplatz. Der Aufsichtsrat schläft schlecht.');
  }

  /* --- 2. Finanzen ------------------------------------------------ */
  const fin = club.finances || { balance: 0, debt: 0 };
  const umsatz = umsatzSchaetzung(club);
  const schuldenQuote = (fin.debt || 0) / Math.max(1, umsatz);
  const kontoQuote = (fin.balance || 0) / Math.max(1, umsatz);
  const gehaelter = gehaltslast(state, clubId);
  const gehaltsQuote = gehaelter / Math.max(1, umsatz);
  let finanzScore = 60 + kontoQuote * 55 - schuldenQuote * 80;
  if (gehaltsQuote > 0.62) finanzScore -= (gehaltsQuote - 0.62) * 160;
  if (gehaltsQuote < 0.42) finanzScore += 6;
  if ((fin.balance || 0) < 0) finanzScore -= 15;
  finanzScore = clamp(finanzScore, 0, 100);
  teil.finanzen = finanzScore;
  if (schuldenQuote > 0.5) gruende.push(`Die Schulden von ${formatMoney(fin.debt || 0)} drücken den Verein.`);
  else if (kontoQuote > 0.25) gruende.push('Die Kassenlage ist erfreulich solide.');
  if (gehaltsQuote > 0.62) gruende.push(`Die Gehaltslast frisst ${Math.round(gehaltsQuote * 100)} % des geschätzten Umsatzes.`);

  /* --- 3. Fans ---------------------------------------------------- */
  const fans = club.fans || { mood: 60, protest: 0 };
  const fanScore = clamp((fans.mood || 60) - (fans.protest || 0) * 0.8, 0, 100);
  teil.fans = fanScore;
  if (fanScore < 35) gruende.push('Auf den Rängen brennt die Luft — die Fans sind auf 180.');
  else if (fanScore > 75) gruende.push('Die Fans stehen geschlossen hinter der Mannschaft.');

  /* --- 4. Pokal / Europa ------------------------------------------ */
  const pokal = pokalLage(state, clubId);
  const europa = europaLage(state, clubId);
  let pokalScore = 55;
  if (pokal.gespielt) {
    if (pokal.raus && pokal.runden <= 0) pokalScore = 18;
    else if (pokal.raus && pokal.runden === 1) pokalScore = 38;
    else if (pokal.raus) pokalScore = 55 + pokal.runden * 4;
    else pokalScore = clamp(60 + pokal.runden * 10, 0, 100);
  }
  if (europa.teilnahme && europa.spiele > 0) {
    const schnitt = europa.punkte / Math.max(1, europa.spiele);
    pokalScore = clamp(pokalScore * 0.55 + (30 + schnitt * 23) * 0.45, 0, 100);
  }
  teil.pokal = pokalScore;
  if (pokal.raus && pokal.runden <= 0 && pokal.gespielt) gruende.push('Das Pokal-Aus in der ersten Runde war eine Blamage.');
  else if (!pokal.raus && pokal.runden >= 3) gruende.push('Der Pokallauf begeistert die Stadt.');

  /* --- 5. Transferpolitik ----------------------------------------- */
  const saison = fin.saison || {};
  const ausgaben = saison.ausgabenTransfer || 0;
  const einnahmen = saison.einnahmenTransfer || 0;
  const budget = Math.max(1, fin.transferBudget || 1);
  let transferScore = 60;
  const ueberzogen = (ausgaben - einnahmen) / Math.max(1, budget + Math.abs(einnahmen));
  if (ueberzogen > 1.05) transferScore -= (ueberzogen - 1.05) * 90;
  if (ueberzogen < 0.15 && ausgaben + einnahmen > 0) transferScore += 6;
  const kw = kaderwert(state, clubId);
  const kwErwartet = umsatz * 1.6;
  transferScore += clamp((kw - kwErwartet) / Math.max(1, kwErwartet) * 22, -18, 18);
  transferScore = clamp(transferScore, 0, 100);
  teil.transfers = transferScore;
  if (ueberzogen > 1.05) gruende.push('Auf dem Transfermarkt wurde deutlich über die Verhältnisse eingekauft.');

  /* --- 6. Spielweise ---------------------------------------------- */
  const gespielt = Math.max(1, lage.spiele);
  const torSchnitt = lage.tore / gespielt;
  const gegenSchnitt = lage.gegentore / gespielt;
  let spielScore = clamp(50 + (torSchnitt - 1.3) * 22 - (gegenSchnitt - 1.3) * 18, 0, 100);
  const letzte5 = ergebnisseSeit(state, clubId, 0).slice(-5);
  const siege5 = letzte5.filter(e => e.ergebnis === 'S').length;
  const pleiten5 = letzte5.filter(e => e.ergebnis === 'N').length;
  if (letzte5.length >= 3) spielScore = clamp(spielScore + siege5 * 6 - pleiten5 * 7, 0, 100);
  if (lage.spiele === 0) spielScore = 55;
  teil.spielweise = spielScore;
  if (pleiten5 >= 4) gruende.push('Vier Niederlagen in fünf Spielen — die Mannschaft wirkt führungslos.');
  else if (siege5 >= 4) gruende.push('Vier Siege in fünf Spielen — der Aufsichtsrat schwärmt.');

  /* --- Gesamtnote -------------------------------------------------- */
  let zielwert = 0;
  for (const k in GEWICHTE) zielwert += teil[k] * GEWICHTE[k];
  zielwert = clamp(zielwert / 100, 0, 100);

  // Offene Forderungen und Warnungen drücken zusätzlich
  const gerissen = b.forderungen.filter(f => f.status === 'gerissen').length;
  if (gerissen) zielwert = clamp(zielwert - gerissen * 4, 0, 100);

  return {
    zufriedenheit: round(b.zufriedenheit, 1),
    geduld: round(b.geduld, 1),
    note: note(b.zufriedenheit),
    gruende,
    ziel: round(zielwert, 1),
    teil,
    lage,
    saisonziel: b.saisonziel
  };
}

/* ================================================================== *
 *  FORDERUNGEN
 * ================================================================== */

/**
 * Registry aller Forderungstypen. `pruefen` liefert
 * { erfuellt:boolean, gescheitert:boolean, fortschritt:string }.
 * Die Funktionen leben hier (nicht am gespeicherten Objekt), damit
 * Savegames nichts verlieren.
 */
export const FORDERUNGS_TYPEN = {

  verkauf: {
    id: 'verkauf',
    passt: (state, clubId) => (state.clubs[clubId].playerIds || []).length > 17,
    bauen: (state, clubId, rng) => {
      const wert = Math.max(1500000, Math.round(kaderwert(state, clubId) * rng.float(0.04, 0.09) / 500000) * 500000);
      return {
        text: `Machen Sie Kasse: Verkaufen Sie einen Spieler für mindestens ${formatMoney(wert)}.`,
        tage: 40,
        daten: { betrag: wert, start: (state.clubs[clubId].finances.saison || {}).einnahmenTransfer || 0 }
      };
    },
    pruefen: (state, clubId, f) => {
      const jetzt = (state.clubs[clubId].finances.saison || {}).einnahmenTransfer || 0;
      const erloest = jetzt - f.daten.start;
      return {
        erfuellt: erloest >= f.daten.betrag,
        gescheitert: false,
        fortschritt: `${formatMoney(erloest)} von ${formatMoney(f.daten.betrag)} erlöst`
      };
    }
  },

  jugend: {
    id: 'jugend',
    passt: (state, clubId) => (state.clubs[clubId].playerIds || []).some(id => state.players[id] && state.players[id].age <= 21),
    bauen: (state, clubId) => {
      const start = u21Einsaetze(state, clubId);
      return {
        text: 'Die Akademie kostet Geld — bauen Sie einen eigenen Jugendspieler in die Startelf ein. Drei Einsätze von Beginn an, bitte.',
        tage: 45,
        daten: { start, anzahl: 3 }
      };
    },
    pruefen: (state, clubId, f) => {
      const jetzt = u21Einsaetze(state, clubId);
      return {
        erfuellt: jetzt - f.daten.start >= f.daten.anzahl,
        gescheitert: false,
        fortschritt: `${jetzt - f.daten.start} von ${f.daten.anzahl} Startelf-Einsätzen`
      };
    }
  },

  siege: {
    id: 'siege',
    passt: () => true,
    bauen: (state, clubId, rng) => {
      const n = rng.int(2, 3);
      return {
        text: `Kein Wenn und Aber: Gewinnen Sie die nächsten ${n === 2 ? 'beiden' : 'drei'} Pflichtspiele.`,
        tage: 8 + n * 8,
        daten: { anzahl: n, abTag: state.date.day }
      };
    },
    pruefen: (state, clubId, f) => {
      const e = ergebnisseSeit(state, clubId, f.daten.abTag);
      const relevant = e.slice(0, f.daten.anzahl);
      const siege = relevant.filter(x => x.ergebnis === 'S').length;
      return {
        erfuellt: siege >= f.daten.anzahl,
        gescheitert: relevant.some(x => x.ergebnis !== 'S'),
        fortschritt: `${siege} von ${f.daten.anzahl} Siegen`
      };
    }
  },

  punkte: {
    id: 'punkte',
    passt: () => true,
    bauen: (state, clubId, rng) => {
      const spiele = rng.int(4, 6);
      const punkte = Math.round(spiele * rng.float(1.2, 1.6));
      return {
        text: `Holen Sie aus den nächsten ${spiele} Spielen mindestens ${punkte} Punkte. Alles andere wäre zu wenig.`,
        tage: spiele * 8 + 6,
        daten: { spiele, punkte, abTag: state.date.day }
      };
    },
    pruefen: (state, clubId, f) => {
      const e = ergebnisseSeit(state, clubId, f.daten.abTag).slice(0, f.daten.spiele);
      const p = punkteAus(e);
      const maxNoch = p + (f.daten.spiele - e.length) * 3;
      return {
        erfuellt: p >= f.daten.punkte,
        gescheitert: maxNoch < f.daten.punkte,
        fortschritt: `${p} von ${f.daten.punkte} Punkten nach ${e.length} Spielen`
      };
    }
  },

  gehalt: {
    id: 'gehalt',
    passt: (state, clubId) => gehaltslast(state, clubId) > umsatzSchaetzung(state.clubs[clubId]) * 0.55,
    bauen: (state, clubId) => {
      const jetzt = gehaltslast(state, clubId);
      const ziel = Math.round(jetzt * 0.9 / 100000) * 100000;
      return {
        text: `Die Gehaltsliste ist außer Rand und Band. Senken Sie die Jahresgehälter auf höchstens ${formatMoney(ziel)}.`,
        tage: 50,
        daten: { ziel }
      };
    },
    pruefen: (state, clubId, f) => {
      const jetzt = gehaltslast(state, clubId);
      return {
        erfuellt: jetzt <= f.daten.ziel,
        gescheitert: false,
        fortschritt: `aktuell ${formatMoney(jetzt)}, Vorgabe ${formatMoney(f.daten.ziel)}`
      };
    }
  },

  kontostand: {
    id: 'kontostand',
    passt: (state, clubId) => (state.clubs[clubId].finances.balance || 0) < umsatzSchaetzung(state.clubs[clubId]) * 0.08,
    bauen: (state, clubId) => {
      const ziel = Math.round(umsatzSchaetzung(state.clubs[clubId]) * 0.1 / 100000) * 100000;
      return {
        text: `Der Kassenwart hat rote Augen. Bringen Sie den Kontostand bis zum Stichtag über ${formatMoney(ziel)}.`,
        tage: 55,
        daten: { ziel }
      };
    },
    pruefen: (state, clubId, f) => {
      const jetzt = state.clubs[clubId].finances.balance || 0;
      return { erfuellt: jetzt >= f.daten.ziel, gescheitert: false, fortschritt: `Konto: ${formatMoney(jetzt)}` };
    }
  },

  platz: {
    id: 'platz',
    passt: (state, clubId) => tabellenlage(state, clubId).spiele >= 4,
    bauen: (state, clubId) => {
      const lage = tabellenlage(state, clubId);
      const ziel = clamp(lage.platz - 3, 1, lage.teams);
      return {
        text: `Arbeiten Sie sich bis zum Stichtag mindestens auf Platz ${ziel} vor.`,
        tage: 45,
        daten: { platz: ziel }
      };
    },
    pruefen: (state, clubId, f) => {
      const lage = tabellenlage(state, clubId);
      return { erfuellt: lage.platz <= f.daten.platz, gescheitert: false, fortschritt: `derzeit Platz ${lage.platz}, gefordert ${f.daten.platz}` };
    }
  },

  keineNiederlage: {
    id: 'keineNiederlage',
    passt: () => true,
    bauen: (state) => ({
      text: 'Schluss mit der Achterbahn: höchstens eine Niederlage in den nächsten fünf Pflichtspielen.',
      tage: 46,
      daten: { spiele: 5, maxPleiten: 1, abTag: state.date.day }
    }),
    pruefen: (state, clubId, f) => {
      const e = ergebnisseSeit(state, clubId, f.daten.abTag).slice(0, f.daten.spiele);
      const pleiten = e.filter(x => x.ergebnis === 'N').length;
      return {
        erfuellt: e.length >= f.daten.spiele && pleiten <= f.daten.maxPleiten,
        gescheitert: pleiten > f.daten.maxPleiten,
        fortschritt: `${pleiten} Niederlage(n) in ${e.length} Spielen`
      };
    }
  },

  tore: {
    id: 'tore',
    passt: (state, clubId) => tabellenlage(state, clubId).spiele >= 3,
    bauen: (state, clubId, rng) => {
      const spiele = rng.int(4, 5);
      const tore = spiele * 2;
      const lage = tabellenlage(state, clubId);
      return {
        text: `Die Zuschauer wollen Tore sehen: mindestens ${tore} Treffer in den nächsten ${spiele} Spielen.`,
        tage: spiele * 8 + 6,
        daten: { spiele, tore, abTag: state.date.day, startTore: lage.tore }
      };
    },
    pruefen: (state, clubId, f) => {
      const e = ergebnisseSeit(state, clubId, f.daten.abTag).slice(0, f.daten.spiele);
      const t = e.reduce((s, x) => s + x.tore, 0);
      return {
        erfuellt: t >= f.daten.tore,
        gescheitert: e.length >= f.daten.spiele && t < f.daten.tore,
        fortschritt: `${t} von ${f.daten.tore} Toren`
      };
    }
  },

  zuschauer: {
    id: 'zuschauer',
    passt: (state, clubId) => !!state.clubs[clubId].stadiumState,
    bauen: (state, clubId) => {
      const st = state.clubs[clubId].stadiumState || {};
      const ziel = clamp(Math.round((st.auslastungSchnitt || 60) + 8), 55, 96);
      return {
        text: `Das Stadion muss voll werden. Wir erwarten eine Auslastung von mindestens ${ziel} % im Schnitt.`,
        tage: 60,
        daten: { auslastung: ziel }
      };
    },
    pruefen: (state, clubId, f) => {
      const st = state.clubs[clubId].stadiumState || {};
      return {
        erfuellt: (st.auslastungSchnitt || 0) >= f.daten.auslastung,
        gescheitert: false,
        fortschritt: `${Math.round(st.auslastungSchnitt || 0)} % von ${f.daten.auslastung} %`
      };
    }
  },

  verpflichtung: {
    id: 'verpflichtung',
    passt: (state, clubId) => (state.clubs[clubId].finances.transferBudget || 0) > 2000000,
    bauen: (state, clubId) => ({
      text: 'Verpflichten Sie einen Spieler unter 24 Jahren mit Perspektive — die Mannschaft ist zu alt geworden.',
      tage: 40,
      daten: { maxAlter: 23, startKader: (state.clubs[clubId].playerIds || []).slice() }
    }),
    pruefen: (state, clubId, f) => {
      const neu = (state.clubs[clubId].playerIds || []).filter(id => !f.daten.startKader.includes(id));
      const treffer = neu.filter(id => state.players[id] && state.players[id].age <= f.daten.maxAlter).length;
      return { erfuellt: treffer >= 1, gescheitert: false, fortschritt: `${treffer} passende Neuzugänge` };
    }
  },

  pokal: {
    id: 'pokal',
    passt: (state, clubId) => (state.fixtures || []).some(f =>
      f.competitionId === 'pokal' && !f.played && f.season === state.date.season &&
      (f.homeId === clubId || f.awayId === clubId)),
    bauen: (state, clubId) => ({
      text: 'Der Pokal ist die kurze Straße nach Europa. Überstehen Sie die nächste Runde.',
      tage: 30,
      daten: { runden: pokalLage(state, clubId).runden }
    }),
    pruefen: (state, clubId, f) => {
      const p = pokalLage(state, clubId);
      return {
        erfuellt: p.runden > f.daten.runden,
        gescheitert: p.raus && p.runden <= f.daten.runden,
        fortschritt: p.raus ? 'ausgeschieden' : `${p.runden} Runden überstanden`
      };
    }
  }
};

function u21Einsaetze(state, clubId) {
  const club = state.clubs[clubId];
  let s = 0;
  for (const id of club.playerIds || []) {
    const p = state.players[id];
    if (p && p.age <= 21 && p.stats && p.stats.season) s += p.stats.season.startelf || 0;
  }
  return s;
}

/**
 * Stellt eine neue Vorstandsforderung.
 * @returns {{id,text,frist,belohnung,strafe,typ,daten,pruefen:function}}
 */
export function forderungStellen(state, clubId, rng) {
  const club = state.clubs[clubId];
  if (!club) return null;
  const b = boardOf(state, clubId);
  const r = rng || rngFuer(state, 'forderung:' + clubId);

  const kandidaten = Object.values(FORDERUNGS_TYPEN).filter(t => {
    if (b.forderungen.some(f => f.status === 'offen' && f.typ === t.id)) return false;
    try { return t.passt(state, clubId); } catch (e) { return false; }
  });
  if (!kandidaten.length) return null;

  const typ = r.pick(kandidaten);
  const roh = typ.bauen(state, clubId, r);
  const umsatz = umsatzSchaetzung(club);
  const belohnungGeld = Math.round(umsatz * r.float(0.02, 0.05) / 100000) * 100000;
  const strafeGeld = Math.round(umsatz * r.float(0.015, 0.035) / 100000) * 100000;

  const forderung = {
    id: uid('ford', r),
    typ: typ.id,
    text: roh.text,
    frist: state.date.day + roh.tage,
    erstellt: state.date.day,
    season: state.date.season,
    status: 'offen',
    daten: roh.daten,
    belohnung: {
      budget: belohnungGeld,
      zufriedenheit: FORDERUNG_BONUS_ZUFRIEDENHEIT,
      geduld: FORDERUNG_BONUS_GEDULD,
      text: `${formatMoney(belohnungGeld)} extra fürs Transferbudget`
    },
    strafe: {
      budget: -strafeGeld,
      zufriedenheit: -FORDERUNG_MALUS_ZUFRIEDENHEIT,
      geduld: -FORDERUNG_MALUS_GEDULD,
      text: `${formatMoney(strafeGeld)} weniger Transferbudget und ein Eintrag in der Personalakte`
    }
  };
  forderung.pruefen = (s) => FORDERUNGS_TYPEN[typ.id].pruefen(s || state, clubId, forderung);
  b.forderungen.push(forderung);
  b.letzteForderung = state.date.day;
  return forderung;
}

/** Prüft alle offenen Forderungen des Manager-Vereins und bucht Belohnung/Strafe. */
export function forderungenPruefen(state, ctx) {
  const clubId = state.managerClubId;
  const club = state.clubs[clubId];
  if (!club) return [];
  const b = boardOf(state, clubId);
  const ergebnisse = [];

  for (const f of b.forderungen) {
    if (f.status !== 'offen') continue;
    const def = FORDERUNGS_TYPEN[f.typ];
    if (!def) { f.status = 'ungueltig'; continue; }
    let res;
    try { res = def.pruefen(state, clubId, f); }
    catch (e) { continue; }
    const abgelaufen = state.date.day > f.frist;

    if (res.erfuellt) {
      f.status = 'erfuellt';
      f.erledigtAm = state.date.day;
      b.zufriedenheit = clamp(b.zufriedenheit + f.belohnung.zufriedenheit, 0, 100);
      b.geduld = clamp(b.geduld + f.belohnung.geduld, 0, 100);
      b.vertrauen = clamp(b.vertrauen + 5, 0, 100);
      club.finances.transferBudget = Math.max(0, (club.finances.transferBudget || 0) + (f.belohnung.budget || 0));
      post(state, ctx, clubId, {
        subject: 'Forderung erfüllt',
        body: `Sie haben geliefert: „${f.text}"\n\nDer Aufsichtsrat hat das zur Kenntnis genommen — und das Transferbudget um ${formatMoney(f.belohnung.budget)} aufgestockt. So kann es weitergehen.`,
        kind: 'vorstand'
      });
      ergebnisse.push({ forderung: f, erfuellt: true });
    } else if (res.gescheitert || abgelaufen) {
      f.status = 'gerissen';
      f.erledigtAm = state.date.day;
      b.zufriedenheit = clamp(b.zufriedenheit + f.strafe.zufriedenheit, 0, 100);
      b.geduld = clamp(b.geduld + f.strafe.geduld, 0, 100);
      b.vertrauen = clamp(b.vertrauen - 8, 0, 100);
      club.finances.transferBudget = Math.max(0, (club.finances.transferBudget || 0) + (f.strafe.budget || 0));
      post(state, ctx, clubId, {
        subject: 'Forderung nicht erfüllt',
        body: `Unsere Vorgabe lautete: „${f.text}"\n\nStand: ${res.fortschritt}. Das ist nicht das, was wir vereinbart haben. ${f.strafe.text}. Wir hoffen, wir müssen dieses Schreiben nicht wiederholen.`,
        kind: 'vorstand', wichtig: true
      });
      ticker(state, ctx, clubId, `${club.shortName}: Vorstand kürzt das Transferbudget nach gerissener Zielvorgabe.`, 'vorstand');
      ergebnisse.push({ forderung: f, erfuellt: false });
    }
  }

  // Archiv kurz halten
  if (b.forderungen.length > 24) b.forderungen = b.forderungen.slice(-24);
  return ergebnisse;
}

/* ================================================================== *
 *  BUDGETVERHANDLUNG
 * ================================================================== */

/**
 * Der Trainer bittet um mehr Transferbudget.
 * @returns {{ok:boolean, gewaehrt:number, text:string}}
 */
export function budgetVerhandeln(state, clubId, wunsch) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, gewaehrt: 0, text: 'Diesen Verein gibt es nicht.' };
  const b = boardOf(state, clubId);
  const betrag = Math.max(0, Math.round(wunsch || 0));
  if (betrag <= 0) return { ok: false, gewaehrt: 0, text: 'Ohne Zahl auf dem Zettel läuft hier gar nichts.' };

  if (state.date.day - b.letzteBudgetanfrage < BUDGET_SPERRE_TAGE) {
    const rest = BUDGET_SPERRE_TAGE - (state.date.day - b.letzteBudgetanfrage);
    return {
      ok: false, gewaehrt: 0,
      text: `„Wir haben doch erst neulich darüber gesprochen." Der Vorstand vertagt Sie um ${rest} Tage.`
    };
  }
  b.letzteBudgetanfrage = state.date.day;

  const fin = club.finances || { balance: 0, debt: 0 };
  const umsatz = umsatzSchaetzung(club);
  const verhandlung = (state.manager && state.manager.skills && state.manager.skills.verhandlung) || 45;
  const spielraum = Math.max(0, (fin.balance || 0) * BUDGET_MAX_ANTEIL_KONTO - (fin.debt || 0) * 0.5);

  let quote = 0.25;
  quote += (b.zufriedenheit - 50) / 220;      // ±0,23
  quote += (b.vertrauen - 50) / 300;
  quote += (verhandlung - 45) / 260;
  if ((fin.debt || 0) > umsatz * 0.6) quote -= 0.22;
  if ((fin.balance || 0) < 0) quote -= 0.3;
  quote = clamp(quote, 0, 0.95);

  let gewaehrt = Math.min(betrag * quote, spielraum);
  gewaehrt = Math.round(gewaehrt / 100000) * 100000;

  b.zufriedenheit = clamp(b.zufriedenheit - BUDGET_ZUFRIEDENHEIT_KOSTEN * (betrag > spielraum ? 1.5 : 1), 0, 100);

  if (gewaehrt <= 0) {
    return {
      ok: false, gewaehrt: 0,
      text: `„${formatMoney(betrag)}? Haben Sie sich die Bilanz angesehen?" Der Vorstand lehnt rundheraus ab. Es bleibt bei ${formatMoney(fin.transferBudget || 0)}.`
    };
  }
  club.finances.transferBudget = (fin.transferBudget || 0) + gewaehrt;
  const anteil = gewaehrt / betrag;
  const text = anteil >= 0.9
    ? `Der Aufsichtsrat nickt ungewöhnlich schnell: ${formatMoney(gewaehrt)} zusätzlich. „Aber machen Sie etwas daraus."`
    : anteil >= 0.5
      ? `Nach zäher Sitzung: ${formatMoney(gewaehrt)} statt der gewünschten ${formatMoney(betrag)}. „Mehr ist nicht drin, Herrschaftszeiten."`
      : `Man reicht Ihnen einen Zettel mit ${formatMoney(gewaehrt)} darauf. „Der Rest kommt, wenn Sie liefern."`;
  return { ok: true, gewaehrt, text };
}

/* ================================================================== *
 *  ESKALATION: MAHNUNG → ULTIMATUM → ENTLASSUNG
 * ================================================================== */

function amtstage(state, clubId) {
  const b = boardOf(state, clubId);
  const a = b.amtsantritt || { season: state.date.season, day: 0 };
  return (state.date.season - a.season) * 365 + (state.date.day - a.day);
}

function pflichtspiele(state, clubId) {
  return (state.fixtures || []).filter(f =>
    f && f.played && f.season === state.date.season &&
    (f.homeId === clubId || f.awayId === clubId) && toreAus(f) !== null).length;
}

function mahnung(state, ctx, clubId, bew) {
  const club = state.clubs[clubId];
  const b = boardOf(state, clubId);
  b.warnungen = 1;
  b.letzteMahnung = state.date.day;
  post(state, ctx, clubId, {
    subject: 'Zu einem klärenden Gespräch',
    body: `Sehr geehrter ${state.manager.name},\n\n` +
      `wir haben Sie geholt, weil wir Ihnen ${b.saisonziel ? '„' + b.saisonziel.text + '"' : 'sportlichen Erfolg'} zugetraut haben. ` +
      `Der aktuelle Zustand entspricht dem nicht.\n\n` +
      bew.gruende.slice(0, 3).map(g => '• ' + g).join('\n') +
      `\n\nWir betrachten das als Mahnung, nicht als Drohung. Noch nicht. ` +
      `Nutzen Sie die nächsten Wochen — wir schauen genau hin.`,
    kind: 'vorstand', wichtig: true
  });
  ticker(state, ctx, clubId, `Krisensitzung bei ${club.shortName}: Der Vorstand mahnt ${state.manager.name} ab.`, 'vorstand');
  return 'mahnung';
}

function ultimatum(state, ctx, clubId, bew) {
  const club = state.clubs[clubId];
  const b = boardOf(state, clubId);
  const kommende = (state.fixtures || []).filter(f =>
    !f.played && f.season === state.date.season && f.dayIndex > state.date.day &&
    f.dayIndex <= state.date.day + ULTIMATUM_TAGE &&
    (f.homeId === clubId || f.awayId === clubId)).length;
  const spiele = Math.max(2, kommende);
  const noetig = Math.max(3, Math.round(spiele * ULTIMATUM_PUNKTE_PRO_SPIEL));

  b.warnungen = 2;
  b.ultimatum = {
    gestellt: state.date.day,
    bisTag: state.date.day + ULTIMATUM_TAGE,
    spiele,
    punkte: noetig,
    abTag: state.date.day
  };
  post(state, ctx, clubId, {
    subject: 'Letzte Warnung',
    body: `${state.manager.name},\n\n` +
      `das Präsidium hat gestern Abend getagt. Das Ergebnis ist unangenehm für Sie: ` +
      `Wir erwarten aus den nächsten ${spiele} Pflichtspielen mindestens ${noetig} Punkte.\n\n` +
      bew.gruende.slice(0, 2).map(g => '• ' + g).join('\n') +
      `\n\nGelingt das nicht, werden wir uns trennen. Das ist keine Verhandlungsposition, ` +
      `das ist ein Beschluss. Man hat uns gebeten, Ihnen trotzdem viel Erfolg zu wünschen.`,
    kind: 'vorstand', wichtig: true
  });
  ticker(state, ctx, clubId, `${club.shortName} stellt ${state.manager.name} ein Ultimatum: ${noetig} Punkte aus ${spiele} Spielen.`, 'vorstand');
  return 'ultimatum';
}

/**
 * Prüft, ob der Trainer entlassen wird — und vollzieht die Entlassung.
 * @returns {boolean} true, wenn entlassen wurde
 */
export function entlassungPruefen(state, ctx) {
  const clubId = state.managerClubId;
  const club = state.clubs[clubId];
  if (!club) return false;
  if (state.flags && state.flags.entlassen) return false;
  const b = boardOf(state, clubId);
  const diff = schwierigkeit(state, ctx);

  if (amtstage(state, clubId) < SCHONFRIST_TAGE) return false;
  if (pflichtspiele(state, clubId) < MIN_SPIELE_FUER_RAUSWURF) return false;

  let grund = null;

  // 1) Ultimatum abgelaufen?
  if (b.ultimatum && state.date.day >= b.ultimatum.bisTag) {
    const e = ergebnisseSeit(state, clubId, b.ultimatum.abTag).slice(0, b.ultimatum.spiele);
    const p = punkteAus(e);
    if (p < b.ultimatum.punkte) {
      grund = `Das Ultimatum verlangte ${b.ultimatum.punkte} Punkte. Es wurden ${p}.`;
    } else {
      // Ultimatum bestanden — Bewährung aufgehoben
      b.ultimatum = null;
      b.warnungen = 1;
      b.geduld = clamp(b.geduld + 18, 0, 100);
      b.zufriedenheit = clamp(b.zufriedenheit + 9, 0, 100);
      b.vertrauen = clamp(b.vertrauen + 10, 0, 100);
      post(state, ctx, clubId, {
        subject: 'Ultimatum bestanden',
        body: `Sie haben geliefert, als es darauf ankam. ${p} Punkte — mehr als gefordert.\n\n` +
          `Der Aufsichtsrat zieht die Trennungsabsicht zurück. Verstehen Sie das bitte nicht als Freibrief, ` +
          `sondern als Verlängerung auf Bewährung.`,
        kind: 'vorstand', wichtig: true
      });
      return false;
    }
  }

  // 2) Geduld am Ende oder Zufriedenheit im Keller
  if (!grund && b.warnungen >= 2) {
    if (b.geduld <= GEDULD_ENTLASSUNG) grund = 'Die Geduld des Aufsichtsrats ist restlos aufgebraucht.';
    else if (b.zufriedenheit < ENTLASSUNG_SCHWELLE) grund = 'Die sportliche Bilanz ist in keiner Weise mehr tragbar.';
  }
  // 3) Totalabsturz — auch ohne vollständige Eskalation
  if (!grund && b.zufriedenheit < 8 && b.geduld <= GEDULD_ENTLASSUNG + 3 && b.warnungen >= 1) {
    grund = 'Der freie Fall der Mannschaft duldet keinen Aufschub mehr.';
  }
  if (!grund) return false;
  // Auf leichten Graden gibt es eine letzte Gnadenfrist
  if (diff.boardPatience >= 1.5 && b.geduld > 0 && b.zufriedenheit >= ENTLASSUNG_SCHWELLE - 4) return false;

  entlassen(state, ctx, clubId, grund);
  return true;
}

function entlassen(state, ctx, clubId, grund) {
  const club = state.clubs[clubId];
  const b = boardOf(state, clubId);
  const lage = tabellenlage(state, clubId);
  const rng = rngFuer(state, 'entlassung:' + clubId);

  b.warnungen = 3;
  b.ultimatum = null;
  b.entlassungAm = { season: state.date.season, day: state.date.day, grund };

  const bilanz = state.manager.bilanz || {};
  if (!Array.isArray(state.manager.karriere)) state.manager.karriere = [];
  state.manager.karriere.push({
    clubId, club: club.name,
    vonSeason: b.amtsantritt.season, vonTag: b.amtsantritt.day,
    bisSeason: state.date.season, bisTag: state.date.day,
    platz: lage.platz, punkte: lage.punkte, spiele: bilanz.spiele || 0,
    ende: 'entlassen', grund
  });
  state.manager.reputation = clamp((state.manager.reputation || 40) - 9, 1, 100);

  post(state, ctx, clubId, {
    subject: 'Freistellung mit sofortiger Wirkung',
    body: `Sehr geehrter ${state.manager.name},\n\n` +
      `der Aufsichtsrat der ${club.name} hat in seiner heutigen Sitzung beschlossen, Sie mit sofortiger ` +
      `Wirkung von Ihren Aufgaben zu entbinden.\n\n${grund}\n\n` +
      `Wir bedanken uns für Ihre Arbeit und wünschen Ihnen persönlich alles Gute. ` +
      `Ihre Sachen stehen bereits an der Pforte. Den Parkplatz benötigen wir ab Montag.\n\n` +
      `Für den Aufsichtsrat\n${b.name}`,
    kind: 'entlassung', wichtig: true
  });
  ticker(state, ctx, clubId, `PAUKENSCHLAG: ${club.name} trennt sich von ${state.manager.name}.`, 'entlassung');

  const nachfolger = nachfolgerFuer(state, clubId, rng);
  club.manager = nachfolger.name;
  b.zufriedenheit = 55; b.geduld = 60; b.vertrauen = 55; b.warnungen = 0;
  b.amtsantritt = { season: state.date.season, day: state.date.day };

  if (!state.flags) state.flags = {};
  state.flags.entlassen = true;
  state.flags.gameOver = 'entlassung';
  state.flags.entlassenAm = { season: state.date.season, day: state.date.day, clubId };
  state.arbeitslos = true;
}

/**
 * Der Trainer stellt selbst die Vertrauensfrage. Hoher Einsatz, klare Antwort.
 * @returns {{ok:boolean, text:string, entlassen:boolean}}
 */
export function vertrauensfrage(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Unbekannter Verein.', entlassen: false };
  const b = boardOf(state, clubId);
  const bew = bewertung(state, clubId);

  if (b.letzteVertrauensfrage !== undefined && state.date.day - b.letzteVertrauensfrage < 40) {
    return { ok: false, entlassen: false, text: 'Sie haben diese Karte gerade erst gespielt. Zweimal zieht sie nicht.' };
  }
  b.letzteVertrauensfrage = state.date.day;

  if (b.zufriedenheit >= 62) {
    b.vertrauen = clamp(b.vertrauen + 12, 0, 100);
    b.geduld = clamp(b.geduld + 8, 0, 100);
    return {
      ok: true, entlassen: false,
      text: `„Rückendeckung? Selbstverständlich." ${b.name} legt Ihnen vor laufenden Kameras die Hand auf die Schulter. Das Präsidium stellt sich geschlossen hinter Sie.`
    };
  }
  if (b.zufriedenheit >= 42) {
    b.vertrauen = clamp(b.vertrauen + 4, 0, 100);
    b.geduld = clamp(b.geduld - 4, 0, 100);
    return {
      ok: true, entlassen: false,
      text: `Man versichert Ihnen das Vertrauen — mit jener Betonung, die jeder Sportreporter kennt. „Uneingeschränkt. Bis auf Weiteres."`
    };
  }
  if (b.zufriedenheit >= ULTIMATUM_SCHWELLE) {
    if (b.warnungen < 2) ultimatum(state, null, clubId, bew);
    return {
      ok: false, entlassen: false,
      text: `Schlechter Zeitpunkt. Statt einer Vertrauenserklärung bekommen Sie eine Frist. ` +
        `„Sie wollten Klarheit — hier ist sie."`
    };
  }
  entlassen(state, null, clubId, 'Der Trainer hat die Vertrauensfrage gestellt. Der Aufsichtsrat hat sie beantwortet.');
  return {
    ok: false, entlassen: true,
    text: `Sie haben gefragt. Man hat abgestimmt. Sie sind entlassen.`
  };
}

/* ================================================================== *
 *  JOBANGEBOTE, WECHSEL, RÜCKTRITT
 * ================================================================== */

const TRAINER_VORNAMEN = ['Horst', 'Jürgen', 'Uwe', 'Rainer', 'Friedhelm', 'Bernd', 'Klaus', 'Werner',
  'Dieter', 'Hansi', 'Otto', 'Erich', 'Manfred', 'Volker', 'Lothar', 'Günter', 'Karl-Heinz',
  'Sebastian', 'Marco', 'Steffen', 'Torsten', 'Ralf', 'Frank', 'Achim', 'Bo', 'Urs'];
const TRAINER_NACHNAMEN = ['Bruchmüller', 'Kettner', 'Sandhaus', 'Vogtländer', 'Kremer', 'Ottensen',
  'Brandenburg', 'Riedle', 'Ehmke', 'Sturmberg', 'Kaltenbach', 'Wiesinger', 'Rohrbach', 'Dahlmann',
  'Petzold', 'Gierlich', 'Krautwald', 'Nowak', 'Sieveking', 'Bergmann', 'Thelen', 'Kubatzki',
  'Rehhagelt', 'Feldkamp', 'Zimmerling', 'Bühler', 'Osterkamp', 'Lindenau'];
const TRAINER_STILE = [
  { id: 'schleifer', name: 'Schleifer', desc: 'Zwei Einheiten am Tag, drei bei Regen.' },
  { id: 'motivator', name: 'Motivator', desc: 'Redet Mannschaften wach.' },
  { id: 'taktiker', name: 'Taktikfuchs', desc: 'Ordner mit 400 Seiten Gegneranalyse.' },
  { id: 'vater', name: 'Vaterfigur', desc: 'Nimmt die Jungen an die Hand.' },
  { id: 'feuerwehr', name: 'Feuerwehrmann', desc: 'Kommt, rettet, geht.' },
  { id: 'sturkopf', name: 'Sturkopf', desc: 'Sein System oder gar keins.' }
];

/** Erzeugt einen KI-Trainer für einen verwaisten Verein. */
export function nachfolgerFuer(state, clubId, rng) {
  const club = state.clubs[clubId];
  const r = rng || rngFuer(state, 'nachfolger:' + clubId);
  const rep = club ? (club.reputation || 50) : 50;
  const stil = r.pick(TRAINER_STILE);
  const name = `${r.pick(TRAINER_VORNAMEN)} ${r.pick(TRAINER_NACHNAMEN)}`;
  return {
    name,
    stil: stil.id,
    stilName: stil.name,
    beschreibung: stil.desc,
    staerke: clamp(Math.round(r.gauss(rep * 0.85, 8)), 20, 95),
    alter: r.int(38, 62),
    text: `${club ? club.shortName : 'Der Verein'} stellt ${name} vor. ${stil.desc}`
  };
}

/**
 * Andere Vereine werben um den Manager, wenn er Erfolg hat.
 * Legt Angebote in state.manager.angebote ab und schreibt ins Postfach.
 */
export function jobangebote(state, ctx) {
  const clubId = state.managerClubId;
  const club = state.clubs[clubId];
  if (!club) return [];
  if (state.flags && state.flags.entlassen) return [];
  const b = boardOf(state, clubId);
  const rng = (ctx && ctx.rng) ? ctx.rng.fork('jobangebote') : rngFuer(state, 'job');

  if (!Array.isArray(state.manager.angebote)) state.manager.angebote = [];
  // Abgelaufene Angebote entfernen
  state.manager.angebote = state.manager.angebote.filter(a =>
    a.season === state.date.season && a.gueltigBis >= state.date.day);

  if (state.date.day - b.letzteJobpruefung < JOB_PRUEFUNG_TAGE) return state.manager.angebote;
  b.letzteJobpruefung = state.date.day;

  // Der Verband klopft im selben Rhythmus an wie die Vereine — und VOR den
  // Bedingungen für Vereinsangebote: Wen der Verband fragt, der braucht keine
  // acht Pflichtspiele beim aktuellen Klub mehr vorzuweisen. Die Anfrage selbst
  // und ihre Grenzen stehen in club/national.js.
  try {
    nationaltrainerAngebot(state, ctx);
  } catch (err) {
    console.error('[board] Verbandsanfrage fehlgeschlagen:', err);
  }

  const spiele = pflichtspiele(state, clubId);
  if (spiele < JOB_MIN_SPIELE) return state.manager.angebote;
  if (state.manager.angebote.length >= JOB_MAX_OFFEN) return state.manager.angebote;

  const bew = bewertung(state, clubId);
  const lage = tabellenlage(state, clubId);
  const ziel = b.saisonziel || { platz: 10 };
  const uebererfuellung = ziel.platz - lage.platz;

  // Erfolgsindex 0..100
  let erfolg = 0;
  erfolg += clamp(uebererfuellung * 9, -40, 40);
  erfolg += (b.zufriedenheit - 55) * 0.55;
  erfolg += clamp((lage.punkte / Math.max(1, lage.spiele) - 1.4) * 22, -18, 22);
  erfolg += clamp(((state.manager.reputation || 40) - 40) * 0.4, -10, 20);
  erfolg = clamp(50 + erfolg, 0, 100);
  if (erfolg < 62 || bew.note > 2) return state.manager.angebote;

  const wahrscheinlichkeit = clamp((erfolg - 58) / 55, 0.05, 0.75);
  if (!rng.chance(wahrscheinlichkeit)) return state.manager.angebote;

  // Passenden Werber suchen: besserer Ruf, aber nicht absurd weit weg
  const eigeneRep = club.reputation || 50;
  const kandidaten = Object.values(state.clubs).filter(c => {
    if (c.id === clubId) return false;
    // Europapokal-Gegner werben niemanden ab (core/state.js:euroClub). Sie
    // stehen in keiner Ligaliste – wer dort unterschriebe, führte einen Verein
    // ohne Tabelle, ohne Spielplan und ohne Saisonende. Und ihr Ruf liegt
    // genau in dem Fenster, aus dem sonst die Anfragen kommen.
    if (c.istEuropaeisch) return false;
    const rep = c.reputation || 50;
    if (rep < eigeneRep + 2 || rep > eigeneRep + 6 + erfolg * 0.35) return false;
    if (state.manager.angebote.some(a => a.clubId === c.id)) return false;
    const cb = c.board || {};
    return (cb.zufriedenheit === undefined ? 60 : cb.zufriedenheit) < 55 || rng.chance(0.35);
  });
  if (!kandidaten.length) return state.manager.angebote;

  const werber = rng.pickWeighted(kandidaten, c => Math.max(1, (c.reputation || 50) - eigeneRep));
  const gehalt = Math.round(umsatzSchaetzung(werber) * rng.float(0.008, 0.016) / 10000) * 10000;
  const budget = Math.round(umsatzSchaetzung(werber) * rng.float(0.18, 0.34) / 100000) * 100000;

  const angebot = {
    id: uid('job', rng),
    clubId: werber.id,
    clubName: werber.name,
    season: state.date.season,
    tag: state.date.day,
    gueltigBis: state.date.day + JOB_ANGEBOT_GUELTIG_TAGE,
    gehalt,
    transferbudget: budget,
    ziel: (werber.board && werber.board.saisonziel && werber.board.saisonziel.text) ||
      (werber.board && werber.board.erwartung && werber.board.erwartung.text) || 'Erfolg',
    reputation: werber.reputation || 50
  };
  state.manager.angebote.push(angebot);

  post(state, ctx, clubId, {
    from: `${werber.name} — Präsidium`,
    subject: `Vertrauliche Anfrage: Cheftrainer bei ${werber.shortName}`,
    body: `Sehr geehrter ${state.manager.name},\n\n` +
      `Ihre Arbeit bei ${club.shortName} ist uns nicht verborgen geblieben. Wir suchen einen Cheftrainer ` +
      `und würden das gerne mit Ihnen besetzen.\n\n` +
      `• Jahresgehalt: ${formatMoney(gehalt)}\n` +
      `• Transferbudget: ${formatMoney(budget)}\n` +
      `• Erwartung: ${angebot.ziel}\n\n` +
      `Das Angebot liegt ${JOB_ANGEBOT_GUELTIG_TAGE} Tage auf dem Tisch. Danach reden wir mit jemand anderem. ` +
      `Diskretion setzen wir voraus — bei uns wie bei Ihnen.`,
    kind: 'jobangebot', wichtig: true,
    aktionen: [
      { id: 'job_annehmen', label: `Zu ${werber.shortName} wechseln`, data: { angebotId: angebot.id, clubId: werber.id } },
      { id: 'job_ablehnen', label: 'Höflich ablehnen', data: { angebotId: angebot.id } }
    ]
  });
  ticker(state, ctx, clubId, `Gerücht: ${werber.shortName} soll bei ${state.manager.name} angeklopft haben.`, 'geruecht');
  return state.manager.angebote;
}

/**
 * Vollzieht den Vereinswechsel des Managers.
 * @returns {{ok:boolean, text:string}}
 */
export function managerWechseln(state, neuerClubId) {
  const neu = state.clubs[neuerClubId];
  if (!neu) return { ok: false, text: 'Diesen Verein gibt es nicht.' };
  const altId = state.managerClubId;
  const alt = state.clubs[altId];
  if (altId === neuerClubId) return { ok: false, text: 'Sie arbeiten dort bereits.' };

  const rng = rngFuer(state, 'wechsel:' + neuerClubId);

  if (alt) {
    const ab = boardOf(state, altId);
    const lage = tabellenlage(state, altId);
    if (!Array.isArray(state.manager.karriere)) state.manager.karriere = [];
    state.manager.karriere.push({
      clubId: altId, club: alt.name,
      vonSeason: ab.amtsantritt.season, vonTag: ab.amtsantritt.day,
      bisSeason: state.date.season, bisTag: state.date.day,
      platz: lage.platz, punkte: lage.punkte,
      ende: 'gewechselt', grund: `Wechsel zu ${neu.name}`
    });
    const nachfolger = nachfolgerFuer(state, altId, rng);
    alt.manager = nachfolger.name;
    ab.zufriedenheit = 55; ab.geduld = 58; ab.warnungen = 0; ab.ultimatum = null;
    ab.amtsantritt = { season: state.date.season, day: state.date.day };
    ticker(state, null, altId, `${alt.shortName} verliert seinen Trainer: ${state.manager.name} geht zu ${neu.shortName}.`, 'transfer');
  }

  state.managerClubId = neuerClubId;
  neu.manager = null;
  const nb = boardOf(state, neuerClubId);
  nb.zufriedenheit = 62; nb.geduld = 64; nb.vertrauen = 60; nb.warnungen = 0;
  nb.ultimatum = null; nb.forderungen = [];
  nb.amtsantritt = { season: state.date.season, day: state.date.day };
  saisonzielSetzen(state, neuerClubId);
  state.manager.reputation = clamp((state.manager.reputation || 40) + 4, 1, 100);
  if (state.flags) { state.flags.entlassen = false; state.flags.gameOver = null; }
  state.arbeitslos = false;
  state.manager.angebote = [];

  post(state, null, neuerClubId, {
    subject: 'Willkommen an Bord',
    body: `Willkommen bei ${neu.name}, ${state.manager.name}.\n\n` +
      `Der Aufsichtsrat erwartet: ${nb.saisonziel ? nb.saisonziel.text : 'Erfolg'}. ` +
      `Ihr Büro ist im ersten Stock, der Schlüssel klemmt. Die Mannschaft wartet auf dem Platz.`,
    kind: 'vorstand', wichtig: true
  });
  return { ok: true, text: `Sie sind neuer Cheftrainer von ${neu.name}.` };
}

/** Der Trainer wirft selbst hin. */
export function ruecktritt(state) {
  const clubId = state.managerClubId;
  const club = state.clubs[clubId];
  if (!club) return { ok: false, text: 'Von wo genau möchten Sie zurücktreten?' };
  const b = boardOf(state, clubId);
  const lage = tabellenlage(state, clubId);
  const rng = rngFuer(state, 'ruecktritt');

  if (!Array.isArray(state.manager.karriere)) state.manager.karriere = [];
  state.manager.karriere.push({
    clubId, club: club.name,
    vonSeason: b.amtsantritt.season, vonTag: b.amtsantritt.day,
    bisSeason: state.date.season, bisTag: state.date.day,
    platz: lage.platz, punkte: lage.punkte,
    ende: 'ruecktritt', grund: 'Rücktritt auf eigenen Wunsch'
  });
  state.manager.reputation = clamp((state.manager.reputation || 40) - 3, 1, 100);

  const nachfolger = nachfolgerFuer(state, clubId, rng);
  club.manager = nachfolger.name;
  b.warnungen = 0; b.ultimatum = null;
  b.zufriedenheit = 55; b.geduld = 58;
  b.amtsantritt = { season: state.date.season, day: state.date.day };

  post(state, null, clubId, {
    subject: 'Ihr Rücktritt',
    body: `Der Aufsichtsrat hat Ihren Rücktritt angenommen — kühler, als Sie es sich gewünscht hätten.\n\n` +
      `„Wir respektieren die Entscheidung." Mehr steht nicht in der Mitteilung. ` +
      `Auf der Pressekonferenz sitzt morgen ${nachfolger.name}.`,
    kind: 'vorstand', wichtig: true
  });
  ticker(state, null, clubId, `${state.manager.name} tritt bei ${club.shortName} zurück. Nachfolger: ${nachfolger.name}.`, 'vorstand');

  if (!state.flags) state.flags = {};
  state.flags.gameOver = 'ruecktritt';
  state.arbeitslos = true;
  return { ok: true, text: `Sie sind nicht mehr Trainer von ${club.name}.`, nachfolger };
}

/* ================================================================== *
 *  TICK
 * ================================================================== */

function istWochenstart(state, ctx) {
  if (ctx && ctx.isWeekStart !== undefined) return !!ctx.isWeekStart;
  if (ctx && ctx.weekday !== undefined) return ctx.weekday === 0;
  // leagues.js-Konvention: dayIndex % 7 === 6 ist Montag.
  return (state.date.day % 7) === 6;
}

/** Sehr günstige KI-Bewertung: ein Verein, ein paar Zahlen, keine Tabellenrechnung pro Verein. */
function tickKiVerein(state, ctx, club, tabelleCache) {
  const b = boardOf(state, club.id);
  if (!b.saisonziel) saisonzielSetzen(state, club.id);
  const zeile = tabelleCache[club.id];
  if (!zeile || zeile.spiele < 5) return;

  const delta = b.saisonziel.platz - zeile.platz;
  const ziel = clamp(58 + delta * 7, 5, 96);
  b.zufriedenheit = clamp(b.zufriedenheit + clamp(ziel - b.zufriedenheit, -4, 4), 0, 100);
  if (b.zufriedenheit < GEDULD_SCHMERZ) b.geduld = clamp(b.geduld - 3, 0, 100);
  else if (b.zufriedenheit > GEDULD_WOHLFUEHL) b.geduld = clamp(b.geduld + 2, 0, 100);

  if (b.geduld <= 0 && b.zufriedenheit < 30) {
    const rng = (ctx && ctx.rng) ? ctx.rng.fork('ki:' + club.id) : rngFuer(state, 'ki:' + club.id);
    if (rng.chance(0.45)) {
      const nachfolger = nachfolgerFuer(state, club.id, rng);
      const alter = club.manager;
      club.manager = nachfolger.name;
      b.zufriedenheit = 55; b.geduld = 60; b.warnungen = 0;
      b.amtsantritt = { season: state.date.season, day: state.date.day };
      ticker(state, ctx, state.managerClubId,
        `Trainerwechsel bei ${club.shortName}: ${alter || 'der Cheftrainer'} muss gehen, ${nachfolger.name} übernimmt.`, 'liga');
    }
  }
}

/**
 * Tagesablauf des Vorstands. Läuft für alle Vereine, aber nur der Verein des
 * Spielers bekommt Post; KI-Vereine werden bewusst billig abgehandelt.
 */
export function tickVorstand(state, ctx) {
  const clubId = state.managerClubId;
  const club = state.clubs[clubId];
  if (!club) return;
  const b = boardOf(state, clubId);
  const diff = schwierigkeit(state, ctx);
  const wochenstart = istWochenstart(state, ctx);
  const tag = state.date.day;

  // --- Saisonstart: Ziel setzen ---------------------------------------
  if (!b.saisonziel || b.saisonziel.season !== state.date.season) {
    for (const c of Object.values(state.clubs)) {
      const cb = boardOf(state, c.id);
      if (!cb.saisonziel || cb.saisonziel.season !== state.date.season) saisonzielSetzen(state, c.id);
    }
    post(state, ctx, clubId, {
      subject: `Saisonziel ${state.date.season}`,
      body: `Der Aufsichtsrat hat getagt und das Ziel für diese Spielzeit festgelegt:\n\n` +
        `➤ ${b.saisonziel.text} (mindestens Platz ${b.saisonziel.minPlatz})\n` +
        `➤ Im Pokal erwarten wir mindestens: ${b.saisonziel.pokal}\n\n` +
        `Wir sind uns bewusst, dass Fußball auch vom Zufall lebt. Rechnen Sie trotzdem nicht damit, ` +
        `dass wir das später als Argument gelten lassen.`,
      kind: 'vorstand', wichtig: true
    });
  }

  if (state.flags && state.flags.entlassen) return;

  // --- Täglich: Forderungen prüfen (billig, nur Manager-Verein) --------
  if (b.forderungen.some(f => f.status === 'offen')) forderungenPruefen(state, ctx);

  if (!wochenstart) return;

  /* ---------------- Ab hier: nur montags ---------------- */

  // --- Bewertung des Manager-Vereins -----------------------------------
  const bew = bewertung(state, clubId);
  const schritt = clamp(bew.ziel - b.zufriedenheit, -ANPASSUNG_PRO_WOCHE, ANPASSUNG_PRO_WOCHE);
  b.zufriedenheit = clamp(b.zufriedenheit + schritt, 0, 100);

  const medienDruckWert = (state.presse && typeof state.presse.druck === 'number') ? state.presse.druck : 50;
  const druckMod = 1 + clamp((medienDruckWert - 50) / 100, -0.35, 0.5);

  if (b.zufriedenheit < GEDULD_SCHMERZ) {
    const verlust = clamp((GEDULD_SCHMERZ - b.zufriedenheit) / 5, 0.5, GEDULD_VERLUST_MAX);
    b.geduld = clamp(b.geduld - verlust * druckMod / Math.max(0.4, diff.boardPatience), 0, 100);
  } else if (b.zufriedenheit > GEDULD_WOHLFUEHL) {
    const gewinn = clamp((b.zufriedenheit - GEDULD_WOHLFUEHL) / 8, 0.3, GEDULD_GEWINN_MAX);
    b.geduld = clamp(b.geduld + gewinn * diff.boardPatience, 0, 100);
  }
  b.vertrauen = clamp(b.vertrauen * 0.9 + (b.zufriedenheit * 0.6 + b.geduld * 0.4) * 0.1, 0, 100);
  b.letzteBewertung = {
    day: tag, season: state.date.season,
    zufriedenheit: round(b.zufriedenheit, 1), geduld: round(b.geduld, 1),
    note: note(b.zufriedenheit), ziel: bew.ziel
  };
  b.historie.push(b.letzteBewertung);
  if (b.historie.length > 60) b.historie.shift();

  // --- Eskalation -------------------------------------------------------
  const genugSpiele = pflichtspiele(state, clubId) >= MIN_SPIELE_FUER_RAUSWURF;
  const ausSchonfrist = amtstage(state, clubId) >= SCHONFRIST_TAGE;

  if (genugSpiele && ausSchonfrist) {
    if (b.warnungen === 0 && b.zufriedenheit < MAHNUNG_SCHWELLE) {
      mahnung(state, ctx, clubId, bew);
    } else if (b.warnungen === 1 && b.zufriedenheit < ULTIMATUM_SCHWELLE && !b.ultimatum) {
      ultimatum(state, ctx, clubId, bew);
    } else if (b.warnungen >= 1 && b.zufriedenheit > 55 && !b.ultimatum) {
      // Erholung: der Vorstand nimmt die Mahnung stillschweigend zurück
      b.warnungen = 0;
      post(state, ctx, clubId, {
        subject: 'Entwarnung',
        body: `Die letzten Wochen haben den Aufsichtsrat besänftigt. Die Personaldebatte ist vom Tisch — ` +
          `zumindest bis zur nächsten Niederlagenserie. So ehrlich muss man sein.`,
        kind: 'vorstand'
      });
    }
    if (entlassungPruefen(state, ctx)) return;
  }

  // --- Neue Forderung ---------------------------------------------------
  const offene = b.forderungen.filter(f => f.status === 'offen').length;
  if (offene < FORDERUNG_MAX_OFFEN && tag - b.letzteForderung >= FORDERUNG_INTERVALL_TAGE &&
    tag >= SAISON_TAGE.ligaStart - 14 && tag <= SAISON_TAGE.saisonEnde - 20) {
    const rng = (ctx && ctx.rng) ? ctx.rng.fork('forderung') : rngFuer(state, 'forderung');
    // Unzufriedene Vorstände fordern häufiger
    const p = clamp(0.28 + (55 - b.zufriedenheit) / 130, 0.15, 0.8);
    if (rng.chance(p)) {
      const f = forderungStellen(state, clubId, rng);
      if (f) {
        post(state, ctx, clubId, {
          subject: 'Eine Bitte des Aufsichtsrats',
          body: `${f.text}\n\n` +
            `Frist: Tag ${f.frist} der laufenden Saison.\n` +
            `Bei Erfolg: ${f.belohnung.text}.\n` +
            `Bei Misserfolg: ${f.strafe.text}.\n\n` +
            `Wir nennen es eine Bitte. Sie wissen, wie das gemeint ist.`,
          kind: 'vorstand', wichtig: true
        });
      }
    }
  }

  // --- Jobangebote ------------------------------------------------------
  jobangebote(state, ctx);

  // --- KI-Vereine (günstig, nur montags, nur zwei Tabellen) -------------
  const cache = {};
  for (const ligaId of ['bl1', 'bl2']) {
    for (const z of tabelleVon(state, ligaId)) cache[z.clubId] = z;
  }
  for (const c of Object.values(state.clubs)) {
    if (c.id === clubId) continue;
    tickKiVerein(state, ctx, c, cache);
  }
}

export default {
  tickVorstand, saisonzielSetzen, bewertung, forderungStellen, forderungenPruefen,
  budgetVerhandeln, entlassungPruefen, vertrauensfrage, jobangebote,
  managerWechseln, ruecktritt, nachfolgerFuer
};
