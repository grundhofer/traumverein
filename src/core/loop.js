/**
 * Der Tagesablauf: schiebt die Spielwelt einen Tag weiter.
 *
 * advanceDay() läuft so lange, bis etwas die Aufmerksamkeit des Managers braucht
 * (eigenes Spiel, wichtige Post, Saisonende). main.js ruft es in einer Schleife auf.
 */

import { SEASON_DAYS, DIFFICULTIES } from './constants.js';
import { createRng } from './rng.js';
import { clamp } from './util.js';
import { emit, EV } from './events.js';
import {
  pushMessage, pushNews, fixturesOfDay, myClub, squadOf, ensureSquad,
  emptyStatLine, ligaVonVerein, pokalfeld, verdichteVergangenheit
} from './state.js';

import { tickAlleModule } from '../club/index.js';
import { karteVermerken, spielNachbereitung } from '../club/medical.js';
import { buchen } from '../club/finances.js';
import {
  tickEuropa, europaWeiterlosen, europaAuslosen, europaSaisonende, qualifikationErmitteln
} from '../club/europa.js';
import { tickNational } from '../club/national.js';
import { bewertung, entlassungPruefen } from '../club/board.js';
import {
  karriereenden, regenerieren, managerSaison, titelChronik,
  elfDerSaison, spielerDerSaison, torschuetzenkoenig, aufstellungBereinigen,
  ligawechselKader
} from '../club/karriere.js';
import {
  LEAGUES, LEAGUE_IDS, CUP, computeTable, generateCupDraw, generateFixtures,
  seasonCalendar, qualificationFor, prizeMoneyFor
} from '../data/leagues.js';
import { quickSimulate } from '../engine/match.js';
import { elfmeterschiessen } from '../engine/shootout.js';
import { teamStrength, playerOverall } from '../engine/ratings.js';
import { autoLineup } from '../engine/tactics.js';

/** Baut den ctx, den alle Vereinsmodule bekommen. */
export function makeCtx(state, extra = {}) {
  const day = state.date.day;
  const rng = createRng(state.seed + day * 7919 + state.date.season * 104729);
  const log = (text, kind = 'info', opts = {}) => {
    pushMessage(state, Object.assign({
      kind, subject: opts.subject || text.split('\n')[0].slice(0, 70), body: text,
      from: opts.from || 'Geschäftsstelle', wichtig: opts.wichtig || false, aktionen: opts.aktionen || null
    }, opts.raw || {}));
  };
  return Object.assign({
    rng,
    day,
    season: state.date.season,
    weekday: day % 7,
    isMatchday: fixturesOfDay(state, day).some(f => f.homeId === state.managerClubId || f.awayId === state.managerClubId),
    isWeekStart: day % 7 === 0,
    isMonthStart: day % 30 === 0,
    isSeasonEnd: day >= SEASON_DAYS - 1,
    difficulty: DIFFICULTIES[state.difficulty] || DIFFICULTIES.profi,
    log,
    news: (text, kind = 'info') => pushNews(state, text, kind)
  }, extra);
}

/**
 * Automatische Aufstellung (state.settings.autoAufstellung).
 *
 * Wird vor jedem eigenen Spiel angewandt – und zwar hier und nicht erst beim
 * Anpfiff, damit der Vorbericht schon die Elf zeigt, die auch aufläuft. Wer die
 * Automatik anhat und trotzdem selbst umstellt, behält seine Änderung: Nach
 * diesem Aufruf rührt niemand mehr an der Aufstellung.
 */
function autoAufstellungAnwenden(state) {
  if (!state.settings || !state.settings.autoAufstellung) return;
  const club = state.clubs[state.managerClubId];
  if (!club) return;
  const verfuegbar = squadOf(state, state.managerClubId)
    .filter(p => !p.injury && !(p.cards && p.cards.ban > 0));
  if (verfuegbar.length < 11) return;
  try {
    club.tactics = autoLineup(verfuegbar, club.tactics, { respectFitness: true });
  } catch (err) {
    console.warn('[loop] Automatische Aufstellung fehlgeschlagen:', err);
  }
}

/**
 * Einen Tag weiterschalten.
 * @returns {{ stop: null|'spieltag'|'saisonende'|'entlassung'|'post', fixture?, text? }}
 */
export async function advanceDay(state) {
  // Ein eigenes Spiel darf niemals übersprungen werden. Wer auf dem Spieltags-
  // bildschirm noch einmal "Weiter" drückt, statt anzupfeifen, würde sonst über
  // die Partie hinwegspringen und sie wäre für immer verloren. Deshalb VOR dem
  // Weiterschalten prüfen, ob noch eine fällige Begegnung offen ist.
  const offen = offenesEigenesSpiel(state);
  if (offen) {
    // Kader beider Mannschaften bereitstellen, bevor der Vorbericht sie anzeigt –
    // Pokalgegner aus dem Amateurlager bekommen ihren Kader sonst erst beim Anpfiff
    // und stünden im Vorbericht mit elf leeren Positionen da.
    ensureSquad(state, offen.homeId);
    ensureSquad(state, offen.awayId);
    autoAufstellungAnwenden(state);
    return { stop: 'spieltag', fixture: offen };
  }

  state.date.day++;
  state.tick++;

  if (state.date.day >= SEASON_DAYS) {
    return { stop: 'saisonende' };
  }

  const ctx = makeCtx(state);

  // 1. Vereinsmodule (Medizin, Training, Moral, Transfers, Finanzen …)
  tickAlleModule(state, ctx);

  // 1b. Der Europapokal (club/europa.js). Er steht hier und NICHT in
  // club/index.js: Ein Wettbewerb ist kein Vereinsmodul – Liga und Pokal werden
  // ebenfalls von diesem Tagesablauf getrieben, nicht von tickAlleModule.
  //
  // Die Reihenfolge ist zwingend: tickEuropa trägt die Fernergebnisse aller
  // Europapokalpartien ohne eigene Beteiligung ein. Liefe es NACH 2a/2b, würde
  // simulateAiFixtures sie durch die Match-Engine schicken, ensureSquad() legte
  // für bis zu 66 europäische Vereine Kader an, und der Spielstand spränge über
  // sein Budget (ROADMAP S3, tools/test-europa.js Z09/Z10).
  try {
    tickEuropa(state, ctx);
  } catch (err) {
    console.error('[loop] Europapokal fehlgeschlagen:', err);
  }

  // 1c. Der Verband (club/national.js). Steht aus demselben Grund hier wie der
  // Europapokal: Eine Nationalmannschaft ist kein Vereinsmodul. Er läuft NACH
  // den Vereinsmodulen, damit die Regeneration des Tages schon verbucht ist,
  // bevor der Verband seine Reisebelastung obendrauf legt.
  try {
    tickNational(state, ctx);
  } catch (err) {
    console.error('[loop] Nationalmannschaft fehlgeschlagen:', err);
  }

  // 2a. Liegengebliebene KI-Partien nachholen.
  //
  // In der Bundesliga finden alle neun Partien am selben Tag statt. An einem eigenen
  // Spieltag rührt advanceDay() die übrigen Begegnungen nicht an – die trägt sonst
  // matchday.js nach dem Abpfiff nach. Bricht der Spieler das Spiel ab oder lädt neu,
  // blieben sie für immer unbespielt: Am Saisonende fehlten so 272 von 306 Ligaspielen,
  // die Tabelle war wertlos und der Pokal kam nie über die 1. Runde hinaus.
  const liegengeblieben = state.fixtures.filter(f =>
    !f.played && f.season === state.date.season && f.dayIndex < state.date.day &&
    f.homeId !== state.managerClubId && f.awayId !== state.managerClubId);
  if (liegengeblieben.length) {
    simulateAiFixtures(state, liegengeblieben, ctx);
    aktualisiereTabellen(state);
  }

  // 2b. Spiele des Tages
  const heute = fixturesOfDay(state, state.date.day);
  const eigenes = heute.find(f => f.homeId === state.managerClubId || f.awayId === state.managerClubId);

  if (heute.length && !eigenes) {
    simulateAiFixtures(state, heute, ctx);
    aktualisiereTabellen(state);
  }

  emit(EV.TAG_VORBEI, { state, day: state.date.day });

  if (state.flags.entlassen) return { stop: 'entlassung' };
  if (eigenes) { autoAufstellungAnwenden(state); return { stop: 'spieltag', fixture: eigenes }; }

  // Nur anhalten, wenn wirklich eine Entscheidung ansteht. Reine Mitteilungen
  // (Vorstandslob, Mitgliederzahlen, Presseschau) sammeln sich im Postfach und
  // werden über das Abzeichen an der Navigation angezeigt – sonst käme man mit
  // dem "Weiter"-Knopf keinen Tag weit.
  const entscheidung = state.inbox.find(m =>
    !m.gelesen && m.day === state.date.day &&
    Array.isArray(m.aktionen) && m.aktionen.length > 0);
  if (entscheidung) return { stop: 'post', text: entscheidung.subject };

  return { stop: null };
}

/**
 * Fällige, aber noch nicht ausgetragene Partie des Managervereins – heute oder
 * an einem früheren Tag.
 */
export function offenesEigenesSpiel(state) {
  return state.fixtures.find(f =>
    !f.played && f.season === state.date.season && f.dayIndex <= state.date.day &&
    (f.homeId === state.managerClubId || f.awayId === state.managerClubId)) || null;
}

/** Simuliert alle KI-Partien eines Spieltags. */
export function simulateAiFixtures(state, fixtures, ctx) {
  for (const fx of fixtures) {
    if (fx.played) continue;
    const res = simulateAiFixture(state, fx, ctx);
    applyResult(state, fx, res, ctx);
  }
}

export function simulateAiFixture(state, fx, ctx) {
  const home = buildMatchTeam(state, fx.homeId, true);
  const away = buildMatchTeam(state, fx.awayId, false);
  const heimklub = state.clubs[fx.homeId];
  const kapazitaet = heimklub.stadium.capacity;
  // Ein leeres Stadion (attendance 0) würde den Heimvorteil der Engine ins
  // Negative drehen. Also die tatsächliche Auslastung des Vereins mitgeben.
  const auslastung = clamp(
    (heimklub.stadiumState && heimklub.stadiumState.auslastungSchnitt) || 0.72, 0.15, 1);
  return quickSimulate({
    home, away,
    rng: ctx.rng.fork('spiel:' + fx.id),
    difficulty: ctx.difficulty,
    competition: { id: fx.competitionId, matchday: fx.matchday, neutral: !!fx.neutral },
    venue: { capacity: kapazitaet, attendance: Math.round(kapazitaet * auslastung) }
  });
}

/** Stellt für einen KI-Verein automatisch die beste Elf. */
export function buildMatchTeam(state, clubId, isHome) {
  const club = ensureSquad(state, clubId);
  const players = squadOf(state, clubId).filter(p => !p.injury && !(p.cards && p.cards.ban > 0));
  let tactics = club.tactics;
  const lineupOk = tactics && tactics.lineup && Object.values(tactics.lineup).filter(Boolean).length === 11 &&
    Object.values(tactics.lineup).every(id => players.some(p => p.id === id));
  if (!lineupOk) {
    tactics = autoLineup(players, tactics || club.tactics, { respectFitness: true });
    club.tactics = tactics;
  }
  return {
    club,
    players,
    tactics,
    morale: club.moral,
    tiredness: 100 - (players.reduce((s, p) => s + p.fitness, 0) / Math.max(1, players.length)),
    coachBonus: coachBonusOf(state, clubId),
    chemistryHistory: club.chemistryHistory,
    isHome
  };
}

/** Zweikampfhärte eines Vereins (0..100) – Eingang in die Verletzungsrechnung. */
function haerteVon(state, clubId) {
  const club = state.clubs[clubId];
  const s = club && club.tactics && club.tactics.sliders;
  return s && typeof s.haerte === 'number' ? s.haerte : 50;
}

function coachBonusOf(state, clubId) {
  if (clubId === state.managerClubId) {
    const s = state.manager.skills;
    return clamp((s.training + s.taktik + s.motivation) / 3, 10, 95);
  }
  const club = state.clubs[clubId];
  return clamp((club.reputation || 50) * 0.85 + 8, 15, 92);
}

/** Trägt ein Ergebnis in Fixture, Statistiken und Vereinsform ein. */
export function applyResult(state, fx, result, ctx) {
  fx.played = true;
  fx.result = { score: result.score, stats: result.stats || null };
  fx.torschuetzen = result.torschuetzen || null;

  const [h, a] = result.score;
  const home = state.clubs[fx.homeId];
  const away = state.clubs[fx.awayId];

  for (const [club, tore, gegentore] of [[home, h, a], [away, a, h]]) {
    club.season.tore += tore;
    club.season.gegentore += gegentore;
    const zeichen = tore > gegentore ? 'S' : tore === gegentore ? 'U' : 'N';
    club.season.form.push(zeichen);
    if (club.season.form.length > 8) club.season.form.shift();
    club.season.letzteErgebnisse.unshift({ gegner: club === home ? away.shortName : home.shortName, tore, gegentore, heim: club === home, day: fx.dayIndex });
    if (club.season.letzteErgebnisse.length > 12) club.season.letzteErgebnisse.pop();
    club.season.serie = zeichen === 'S' ? Math.max(0, club.season.serie) + 1
      : zeichen === 'N' ? Math.min(0, club.season.serie) - 1 : 0;
  }

  // Spielerstatistiken (nur wenn die Engine welche geliefert hat)
  const einsaetze = { [fx.homeId]: [], [fx.awayId]: [] };
  if (result.playerStats) {
    for (const pid in result.playerStats) {
      const p = state.players[pid];
      if (!p) continue;
      const st = result.playerStats[pid];
      const s = p.stats.season;
      s.spiele += st.minuten > 0 ? 1 : 0;
      s.minuten += st.minuten || 0;
      s.tore += st.tore || 0;
      s.vorlagen += st.vorlagen || 0;
      s.schuesse += st.schuesse || 0;
      s.paraden += st.paraden || 0;
      s.gelb += st.gelb || 0;
      s.gelbrot += st.gelbrot || 0;
      s.rot += st.gelbrot ? 0 : (st.rot || 0);
      if (result.ratings && result.ratings[pid]) {
        s.notenSumme += result.ratings[pid];
        s.notenAnzahl++;
      }

      // Karten an die Sperrverwaltung melden. Die Engine zeigt sie nur an –
      // gebucht werden sie hier, sonst gäbe es nie eine Gelbsperre.
      for (let i = 0; i < (st.gelb || 0); i++) karteVermerken(state, pid, 'gelb', fx.competitionId);
      if (st.gelbrot) karteVermerken(state, pid, 'gelbrot', fx.competitionId);
      else if (st.rot) karteVermerken(state, pid, 'rot', fx.competitionId);

      const liste = einsaetze[p.clubId];
      if (liste && (st.minuten || 0) > 0) liste.push({ playerId: pid, minuten: st.minuten });
    }
  }

  // Belastung, Verletzungswürfe und Sperren beim Lazarett melden. Ohne diesen
  // Anruf holt tickMedizin es am Folgetag mit einer geratenen Elf nach.
  for (const clubId of [fx.homeId, fx.awayId]) {
    if (!einsaetze[clubId] || !einsaetze[clubId].length) continue;
    try {
      spielNachbereitung(state, clubId, einsaetze[clubId], {
        rng: ctx && ctx.rng ? ctx.rng.fork('nachbereitung:' + fx.id + ':' + clubId) : undefined,
        competitionId: fx.competitionId,
        fixtureId: fx.id,
        haerte: haerteVon(state, clubId),
        log: ctx && ctx.log, news: ctx && ctx.news,
        difficulty: ctx && ctx.difficulty
      });
    } catch (err) {
      console.error(`[loop] Spielnachbereitung für ${clubId} fehlgeschlagen:`, err);
    }
  }

  // Die Trainerbilanz. Sie wurde bis Stufe 1 gelesen (board.js:1091) und nie
  // geschrieben; ohne sie bleibt jede Trainerlaufbahn ein leeres Blatt.
  if (fx.homeId === state.managerClubId || fx.awayId === state.managerClubId) {
    const daheim = fx.homeId === state.managerClubId;
    const eigene = daheim ? h : a;
    const fremde = daheim ? a : h;
    const m = state.manager || (state.manager = {});
    const bilanz = m.bilanz ||
      (m.bilanz = { spiele: 0, siege: 0, unentschieden: 0, niederlagen: 0, tore: 0, gegentore: 0 });
    bilanz.spiele = (bilanz.spiele || 0) + 1;
    if (eigene > fremde) bilanz.siege = (bilanz.siege || 0) + 1;
    else if (eigene < fremde) bilanz.niederlagen = (bilanz.niederlagen || 0) + 1;
    else bilanz.unentschieden = (bilanz.unentschieden || 0) + 1;
    bilanz.tore = (bilanz.tore || 0) + eigene;
    bilanz.gegentore = (bilanz.gegentore || 0) + fremde;
  }

  emit(EV.SPIEL_FERTIG, { state, fixture: fx, result });
}

/** Vereine einer Liga – state.leagues ist die Wahrheit, LEAGUES nur die Vorlage. */
export function ligaVereine(state, leagueId) {
  const e = state.leagues && state.leagues[leagueId];
  if (e && Array.isArray(e.clubIds) && e.clubIds.length) return e.clubIds;
  return LEAGUES[leagueId] ? LEAGUES[leagueId].clubIds : [];
}

/** Tabellen aller Ligen neu berechnen. */
export function aktualisiereTabellen(state) {
  for (const ligaId of LEAGUE_IDS) {
    const clubIds = ligaVereine(state, ligaId);
    const fixtures = state.fixtures.filter(f => f.competitionId === ligaId && f.season === state.date.season);
    const tabelle = computeTable(fixtures, clubIds, { season: state.date.season });
    state.tables[ligaId] = tabelle;
    for (const zeile of tabelle) {
      const club = state.clubs[zeile.clubId];
      if (club) { club.season.platz = zeile.platz; club.season.punkte = zeile.punkte; }
    }
  }
}

/** Ligazugehörigkeit eines Vereins. */
export function ligaVon(state, clubId) {
  return ligaVonVerein(state, clubId);
}

/**
 * Ein Remis im Pokal auflösen – wer steht in der nächsten Runde?
 *
 * Bis ROADMAP-Stufe 3 entschied hier ein Münzwurf (`ctx.rng.chance(0.55)`),
 * ausdrücklich als Provisorium vermerkt. Jetzt wird ausgeschossen: echte
 * Schützen, echter Torwart, wachsender Druck (engine/shootout.js).
 *
 * Bewusst NICHT interaktiv: An dieser Stelle werden ausschließlich KI-Partien
 * aufgelöst. Seine eigenen Spiele bestreitet der Manager über
 * game/matchday.js; hat das den Ausgang schon ausgeschossen und in
 * `f.elfmeter` hinterlegt, bleibt es dabei.
 *
 * Gespeichert wird nur der Torstand vom Punkt ([heim, gast]) – der
 * Reportertext bleibt draußen, der Spielstand ist knapp genug.
 */
function elfmeterEntscheidung(state, ctx, f, rundenName) {
  if (Array.isArray(f.elfmeter) && f.elfmeter[0] !== f.elfmeter[1]) {
    return f.elfmeter[0] > f.elfmeter[1] ? f.homeId : f.awayId;
  }

  const rng = (ctx && ctx.rng && typeof ctx.rng.fork === 'function')
    ? ctx.rng.fork('elfmeter:' + f.id)
    : createRng(state.seed + ':elfmeter:' + f.id);

  const ergebnis = elfmeterschiessen({
    heim: buildMatchTeam(state, f.homeId, true),
    gast: buildMatchTeam(state, f.awayId, false),
    rng,
    difficulty: ctx && ctx.difficulty,
    interactive: false,
    competition: { id: f.competitionId, name: rundenName }
  });

  f.elfmeter = [ergebnis.tore[0], ergebnis.tore[1]];
  const siegerId = ergebnis.sieger === 'home' ? f.homeId : f.awayId;

  if (f.homeId === state.managerClubId || f.awayId === state.managerClubId) {
    const gegner = state.clubs[f.homeId === state.managerClubId ? f.awayId : f.homeId];
    const gewonnen = siegerId === state.managerClubId;
    pushNews(state,
      `Elfmeterschießen gegen ${gegner ? gegner.shortName : 'den Gegner'}: ` +
      `${ergebnis.tore[0]}:${ergebnis.tore[1]} vom Punkt. ` +
      (gewonnen ? 'Die Nerven haben gehalten.' : 'Elf Meter, ein Zentimeter, ein Sommer weniger.'),
      gewonnen ? 'gut' : 'schlecht');
  }
  return siegerId;
}

/**
 * Nächste Pokalrunde auslosen, sobald alle Partien der aktuellen Runde gespielt sind.
 * `state.pokal.runde` ist der 0-basierte Index in CUP.rounds.
 */
export function pokalWeiterlosen(state, ctx) {
  // Ein Endspiel wird ausgespielt, nicht ausgesessen: Steht es nach dem Abpfiff
  // unentschieden, entscheidet hier das Elfmeterschießen.
  pokalFinaleEntscheiden(state, ctx, state.date.season);

  const runde = CUP.rounds[state.pokal.runde];
  if (!runde) return false;
  if (state.pokal.runde >= CUP.rounds.length - 1) return false;   // Finale gespielt

  const partien = state.fixtures.filter(
    f => f.competitionId === 'pokal' && f.season === state.date.season && f.round === runde.id
  );
  if (!partien.length || partien.some(f => !f.played)) return false;

  const sieger = partien.map(f => {
    if (f.freilos) return f.homeId;
    const [h, a] = f.result.score;
    if (h > a) return f.homeId;
    if (a > h) return f.awayId;
    // Unentschieden: Es geht an den Punkt (statt wie früher an die Münze).
    return elfmeterEntscheidung(state, ctx, f, runde.name);
  });
  if (sieger.length < 2) return false;

  state.pokal.runde++;
  const naechste = CUP.rounds[state.pokal.runde];
  const neue = generateCupDraw(
    ctx.rng.fork('pokal:' + state.date.season + ':' + state.pokal.runde),
    Object.values(state.clubs), state.pokal.runde, sieger, state.date.season
  );
  state.fixtures.push(...neue);

  const eigenerWeiter = sieger.includes(state.managerClubId);
  if (eigenerWeiter) {
    pushNews(state, `Weiter im Pokal: ${myClub(state).shortName} steht im ${naechste.name}.`, 'gut');
  } else if (partien.some(f => f.homeId === state.managerClubId || f.awayId === state.managerClubId)) {
    pushNews(state, `Pokal-Aus für ${myClub(state).shortName}.`, 'schlecht');
    state.pokal.ausgeschieden.push(state.date.season);
  }
  return true;
}

/** Bewertet die abgelaufene Saison und startet die nächste. */
export function saisonAbschluss(state) {
  aktualisiereTabellen(state);
  const bericht = { season: state.date.season, tabellen: {}, meister: null, absteiger: [], eigenerPlatz: null };
  for (const league of Object.values(LEAGUES)) {
    const t = state.tables[league.id] || [];
    bericht.tabellen[league.id] = t.map(z => ({ clubId: z.clubId, platz: z.platz, punkte: z.punkte, diff: z.diff }));
    if (league.id === 'bl1' && t[0]) bericht.meister = t[0].clubId;
  }
  const meineLiga = ligaVon(state, state.managerClubId);
  const meineZeile = (state.tables[meineLiga] || []).find(z => z.clubId === state.managerClubId);
  bericht.eigenerPlatz = meineZeile ? meineZeile.platz : null;
  state.history.seasons.push(bericht);
  return bericht;
}

/* ================================================================== *
 *  DER SAISONWECHSEL
 *
 *  Bis Stufe 1 stand dieser Übergang in main.js zwischen zwei Dialogen und
 *  war damit von keinem Prüfskript erreichbar (ROADMAP 5.2). Er gehört hierher:
 *  saisonAbschluss() BEWERTET die abgelaufene Spielzeit, saisonWechsel()
 *  VOLLZIEHT den Übergang. main.js ruft auf und zeigt nur noch an.
 * ================================================================== */

/**
 * Kadergrenzen beim Vertragsende. Dieselben Zahlen wie club/transfers.js
 * (MIN_KADER = 20) und club/karriere.js – ein Verein, der darunter fällt,
 * bekommt keine geordnete Elf mehr auf den Platz.
 */
const KADER_MIN_PROFI = 20;
const KADER_MIN_AMATEUR = 18;

/** Der Pokalsieger einer Saison, oder null, wenn das Endspiel nicht entschieden ist. */
function pokalsiegerVon(state, season) {
  const letzte = CUP.rounds[CUP.rounds.length - 1];
  const finale = state.fixtures.find(
    f => f.competitionId === CUP.id && f.season === season && f.round === letzte.id);
  if (!finale || !finale.played || !finale.result || !Array.isArray(finale.result.score)) return null;
  const [h, a] = finale.result.score;
  if (h > a) return finale.homeId;
  if (a > h) return finale.awayId;
  return null;
}

/**
 * Ein Pokalendspiel darf nicht unentschieden ausgehen – in Berlin wird bis zur
 * Entscheidung gespielt. Die Vorrunden schießen ihr Remis aus
 * (elfmeterEntscheidung); das Finale steht aber mit einem Ergebnis in der
 * Chronik und bekommt deshalb hier seine Verlängerung: ein Tor, ein Sieger,
 * ein Pokal.
 */
function pokalFinaleEntscheiden(state, ctx, season) {
  const letzte = CUP.rounds[CUP.rounds.length - 1];
  const finale = state.fixtures.find(
    f => f.competitionId === CUP.id && f.season === season && f.round === letzte.id);
  if (!finale || !finale.played || !finale.result || !Array.isArray(finale.result.score)) return null;
  const [h, a] = finale.result.score;
  if (h !== a) return finale;

  const rng = (ctx && ctx.rng && typeof ctx.rng.fork === 'function')
    ? ctx.rng.fork('pokalfinale:' + season)
    : createRng(state.seed + season * 7717 + 4711);
  // Kein Münzwurf: die Stärke der beiden Elf entscheidet mit, der Rest ist Nerven.
  const heimStaerke = teamStrength(buildMatchTeam(state, finale.homeId, true));
  const gastStaerke = teamStrength(buildMatchTeam(state, finale.awayId, false));
  const heimWert = typeof heimStaerke === 'number' ? heimStaerke : (heimStaerke && heimStaerke.gesamt) || 50;
  const gastWert = typeof gastStaerke === 'number' ? gastStaerke : (gastStaerke && gastStaerke.gesamt) || 50;
  const chance = clamp(0.5 + (heimWert - gastWert) / 220, 0.25, 0.75);
  const heimGewinnt = rng.chance(chance);

  // Genau ein Treffer in der Verlängerung: Der Endstand bleibt ehrlich und
  // verzerrt weder Torschnitt noch Rekordliste.
  finale.result.score = heimGewinnt ? [h + 1, a] : [h, a + 1];
  finale.verlaengerung = { regulaer: [h, a] };

  const sieger = heimGewinnt ? finale.homeId : finale.awayId;
  const club = state.clubs[sieger];
  const verlierer = state.clubs[heimGewinnt ? finale.awayId : finale.homeId];
  pushNews(state,
    `Pokalfinale erst in der Verlängerung entschieden: ${club ? club.shortName : sieger} schlägt ` +
    `${verlierer ? verlierer.shortName : ''} mit ${finale.result.score[0]}:${finale.result.score[1]}. ` +
    `Neunzig Minuten hat es niemand gewagt, jetzt ist der Pott vergeben.`, 'gut');
  return finale;
}

/**
 * Auf- und Abstieg ermitteln und – falls nötig – die Relegation austragen.
 *
 * Die Wertung liefert qualificationFor() aus data/leagues.js. Sie weist der
 * 1. Liga drei direkte Absteiger zu, der 2. Liga aber nur zwei direkte
 * Aufsteiger; blieben beide Zahlen stehen, hätte die 1. Liga nach einem Jahr
 * siebzehn Vereine. Der Ausgleich läuft über die Relegation: Der Beste der
 * Abstiegsplätze (Platz 16) spielt gegen den Dritten der 2. Liga um den letzten
 * Platz – genau wie im richtigen Fußball.
 */
function aufUndAbstieg(state, ctx, bericht) {
  const bl1 = bericht.tabellen.bl1 || [];
  const bl2 = bericht.tabellen.bl2 || [];

  const runter = bl1.filter(z => qualificationFor('bl1', z.platz) === 'abstieg').map(z => z.clubId);
  const rauf = bl2.filter(z => {
    const q = qualificationFor('bl2', z.platz);
    return q === 'meister' || q === 'aufstieg';
  }).map(z => z.clubId);

  let relErst = null;
  const relZweitZeile = bl2.find(z => qualificationFor('bl2', z.platz) === 'relegation');
  const relZweit = relZweitZeile ? relZweitZeile.clubId : null;

  // Ausgleich: der beste Absteiger (Platz 16) rückt in die Relegation nach.
  if (runter.length > rauf.length && relZweit && !relErst) relErst = runter.shift();
  // Geht die Rechnung trotzdem nicht auf, wird gekappt statt geraten: oben
  // bleibt der Bestplatzierte verschont, unten fällt der Schlechteste zurück.
  while (runter.length > rauf.length) runter.shift();
  while (rauf.length > runter.length) rauf.pop();

  let relegation = null;
  if (relErst && relZweit) {
    relegation = relegationSpielen(state, ctx, relErst, relZweit);
    if (relegation.sieger === relZweit) { runter.push(relErst); rauf.push(relZweit); }
  }

  return { aufsteiger: rauf, absteiger: runter, relegation };
}

/** Relegation als echtes Hin- und Rückspiel. */
function relegationSpielen(state, ctx, erstligist, zweitligist) {
  // Hinspiel beim Zweitligisten, Rückspiel beim Erstligisten: Wer oben steht,
  // behält den letzten Heimvorteil. Auswärtstorregel gibt es keine – bei
  // Gleichstand bleibt die höhere Klasse oben. Das ist unfair und Absicht.
  const paarungen = [
    { key: 'hinspiel', homeId: zweitligist, awayId: erstligist },
    { key: 'rueckspiel', homeId: erstligist, awayId: zweitligist }
  ];
  const ergebnis = { hinspiel: null, rueckspiel: null, sieger: null, verlierer: null, text: '' };
  let toreErst = 0, toreZweit = 0;

  for (const p of paarungen) {
    ensureSquad(state, p.homeId);
    ensureSquad(state, p.awayId);
    const kapazitaet = state.clubs[p.homeId].stadium.capacity;
    const res = quickSimulate({
      home: buildMatchTeam(state, p.homeId, true),
      away: buildMatchTeam(state, p.awayId, false),
      rng: ctx.rng.fork('relegation:' + state.date.season + ':' + p.key),
      difficulty: ctx.difficulty,
      competition: { id: 'relegation', matchday: p.key === 'hinspiel' ? 1 : 2, neutral: false },
      // Ein Relegationsspiel ist immer ausverkauft. Immer.
      venue: { capacity: kapazitaet, attendance: kapazitaet }
    });
    const [h, a] = res.score;
    ergebnis[p.key] = { homeId: p.homeId, awayId: p.awayId, score: [h, a] };
    if (p.homeId === erstligist) { toreErst += h; toreZweit += a; }
    else { toreZweit += h; toreErst += a; }
  }

  ergebnis.gesamt = { erstligist: toreErst, zweitligist: toreZweit };
  ergebnis.sieger = toreZweit > toreErst ? zweitligist : erstligist;
  ergebnis.verlierer = ergebnis.sieger === zweitligist ? erstligist : zweitligist;

  const sieger = state.clubs[ergebnis.sieger];
  const verlierer = state.clubs[ergebnis.verlierer];
  ergebnis.text = ergebnis.sieger === zweitligist
    ? `${sieger ? sieger.shortName : ergebnis.sieger} steigt auf, ${verlierer ? verlierer.shortName : ''} steigt ab. ` +
      `Zwei Spiele, ein Jahr Arbeit, eine Klasse tiefer.`
    : `${sieger ? sieger.shortName : ergebnis.sieger} bleibt oben. ` +
      `Gerettet ist gerettet – ansehen musste man es sich trotzdem nicht.`;
  pushNews(state, `Relegation: ${ergebnis.text}`, ergebnis.sieger === zweitligist ? 'gut' : 'info');
  return ergebnis;
}

/** Auf- und Abstieg in state.leagues und club.leagueId eintragen. */
function ligenFortschreiben(state, bericht) {
  const rauf = new Set(bericht.aufsteiger);
  const runter = new Set(bericht.absteiger);
  // Reihenfolge = Abschlusstabelle der abgelaufenen Saison. Das ist bei
  // Punktgleichheit der letzte Stichentscheid in computeTable().
  const reihe = ligaId => (bericht.tabellen[ligaId] || []).map(z => z.clubId);

  const neu = {
    bl1: reihe('bl1').filter(id => !runter.has(id)).concat(reihe('bl2').filter(id => rauf.has(id))),
    bl2: reihe('bl2').filter(id => !rauf.has(id)).concat(reihe('bl1').filter(id => runter.has(id)))
  };

  // Eine Liga, die plötzlich siebzehn oder neunzehn Vereine hat, ist kaputt –
  // dann lieber laut nichts tun als leise das Falsche eintragen.
  for (const ligaId of LEAGUE_IDS) {
    const soll = ligaVereine(state, ligaId).length;
    if (neu[ligaId].length !== soll) {
      console.error(`[loop] Auf- und Abstieg ergäbe für ${ligaId} ${neu[ligaId].length} statt ${soll} ` +
        `Vereine – die Ligazugehörigkeit bleibt unverändert.`);
      return false;
    }
  }

  for (const ligaId of LEAGUE_IDS) {
    state.leagues[ligaId] = { id: ligaId, clubIds: neu[ligaId] };
    for (const clubId of neu[ligaId]) {
      const club = state.clubs[clubId];
      if (club) club.leagueId = ligaId;
    }
  }
  return true;
}

/**
 * Prämien der abgelaufenen Saison ausschütten.
 *
 * prizeMoneyFor() liefert die GESAMTE Jahresausschüttung eines Platzes (TV-Geld
 * inklusive Platzierungsprämie). Drei Viertel davon sind über die Saison bereits
 * als Monatsabschlag geflossen (finances.js:tvAbschlag) – gebucht wird deshalb
 * nur die Schlussabrechnung, gemeldet wird die volle Summe. Wer den Sprung nach
 * oben verpasst hat, zahlt an dieser Stelle sogar zurück.
 */
function praemienAusschuetten(state, bericht) {
  const praemien = {};
  for (const ligaId of LEAGUE_IDS) {
    const liga = LEAGUES[ligaId];
    for (const zeile of bericht.tabellen[ligaId] || []) {
      const club = state.clubs[zeile.clubId];
      if (!club) continue;
      const gesamt = prizeMoneyFor(ligaId, zeile.platz);
      const f = club.finances || (club.finances = {});
      const vorschuss = typeof f.tvVorschussGezahlt === 'number' ? f.tvVorschussGezahlt : 0;
      const rest = Math.round(gesamt - vorschuss);
      if (rest !== 0) {
        buchen(state, club.id, rest, 'praemien',
          `Saisonabrechnung ${liga.short} (Platz ${zeile.platz})`);
      }
      f.tvVorschussGezahlt = gesamt;
      praemien[club.id] = gesamt;
    }
  }
  return praemien;
}

/** Das Urteil des Aufsichtsrats über die abgelaufene Spielzeit. */
function vorstandsurteilFuer(state, ctx, bericht) {
  const urteil = { note: 4, text: '', entlassen: !!(state.flags && state.flags.entlassen) };
  const club = state.clubs[state.managerClubId];
  if (!club) return urteil;

  try {
    const bew = bewertung(state, state.managerClubId);
    urteil.note = clamp(Math.round(bew.note || 4), 1, 6);
    urteil.gruende = (bew.gruende || []).slice(0, 4);
    urteil.zufriedenheit = bew.zufriedenheit;
    urteil.geduld = bew.geduld;
  } catch (err) {
    console.error('[loop] Vorstandsbewertung fehlgeschlagen:', err);
  }

  // Der Aufsichtsrat tagt nach dem letzten Spieltag ein letztes Mal. Wer ein
  // ganzes Jahr geliefert hat, was er versprochen hat, darf bleiben.
  if (!urteil.entlassen) {
    try {
      if (entlassungPruefen(state, ctx)) urteil.entlassen = true;
    } catch (err) {
      console.error('[loop] Entlassungsprüfung zum Saisonende fehlgeschlagen:', err);
    }
  }

  const abgestiegen = bericht.absteiger.includes(state.managerClubId);
  const aufgestiegen = bericht.aufsteiger.includes(state.managerClubId);
  const meister = bericht.meister === state.managerClubId;
  const pokal = bericht.pokalsieger === state.managerClubId;

  if (urteil.entlassen) {
    urteil.text = abgestiegen
      ? 'Der Abstieg war das eine. Dass niemand mehr an eine Wende geglaubt hat, war das andere. Man trennt sich.'
      : 'Man habe sich die Entscheidung nicht leicht gemacht, heißt es. Das sagen sie jedes Mal.';
  } else if (meister && pokal) {
    urteil.text = 'Meisterschale und Pokal in einem Jahr. Der Aufsichtsrat spricht von einer Ära und meint es ausnahmsweise ernst.';
  } else if (meister) {
    urteil.text = 'Deutscher Meister. Der Vorsitzende hat vor Rührung die falsche Rede gehalten – die für den Abstieg.';
  } else if (aufgestiegen) {
    urteil.text = 'Aufgestiegen. Oben wird alles schwerer, teurer und lauter. Genau deswegen wollten wir hin.';
  } else if (abgestiegen) {
    urteil.text = 'Der Abstieg ist bitter, aber niemand hat den Kader über Nacht schlechtgemacht. Sie dürfen ihn wieder hochführen.';
  } else if (urteil.note <= 2) {
    urteil.text = 'Der Aufsichtsrat ist zufrieden und sagt es sogar. Genießen Sie es, das hält meistens bis August.';
  } else if (urteil.note >= 5) {
    urteil.text = 'Man erwarte im kommenden Jahr eine „deutlich sichtbare Entwicklung". Übersetzt: Punkte.';
  } else {
    urteil.text = 'Ordentliche Saison, keine Wunder. Der Aufsichtsrat nickt und sieht weiter genau hin.';
  }
  return urteil;
}

/**
 * Spieler eine Saison weiterschreiben: Statistik rollen, Alter erhöhen.
 * Läuft VOR der Regenerierung – die Nachrücker kommen frisch auf die Welt und
 * dürfen nicht am ersten Tag ein Jahr altern.
 */
function spielerFortschreiben(state, alteSaison) {
  for (const pid of Object.keys(state.players).sort()) {
    const p = state.players[pid];
    if (!p) continue;

    if (p.stats) {
      const s = p.stats.season || emptyStatLine();
      if (!Array.isArray(p.stats.history)) p.stats.history = [];
      if ((s.spiele || 0) > 0 || (s.minuten || 0) > 0) {
        p.stats.history.push(Object.assign({ season: alteSaison, clubId: p.clubId || null }, s));
        if (p.stats.history.length > 12) p.stats.history.shift();
      }
      if (!p.stats.career) p.stats.career = emptyStatLine();
      for (const k in s) p.stats.career[k] = (p.stats.career[k] || 0) + (s[k] || 0);
      p.stats.season = emptyStatLine();
    }

    if (p.retired) continue;
    p.age = (p.age || 18) + 1;
  }
}

/**
 * Auslaufende Verträge abwickeln.
 *
 * HINWEIS ZUM SCHEMA: `contract.until` ist eine absolute Saisonnummer
 * ("Vertrag bis Saison 4"), keine Restlaufzeit. Sie wird deshalb NICHT
 * heruntergezählt – der Vertrag wird kürzer, weil die Saison weiterzählt.
 * Wer hier dekrementiert, halbiert jede Laufzeit (vgl. transfers.js:restlaufzeit).
 *
 * Wessen Vertrag mit der abgelaufenen Saison endet, ist ab sofort vertragslos.
 * Ausnahme: Der Kader darf nicht unter die Mindestgröße fallen, und unter zwei
 * Torhüter geht es nie – dann gibt es eine Notverlängerung um ein Jahr.
 */
function vertraegeFortschreiben(state, ctx, neueSaison) {
  const abgaenge = [];
  for (const clubId of Object.keys(state.clubs).sort()) {
    const club = state.clubs[clubId];
    if (!club || club.lazySquad || !Array.isArray(club.playerIds)) continue;

    const minimum = club.istAmateur ? KADER_MIN_AMATEUR : KADER_MIN_PROFI;
    const auslaufend = club.playerIds
      .map(id => state.players[id])
      .filter(p => p && !p.retired && p.contract && (p.contract.until || 0) < neueSaison)
      // Die Schwächsten gehen zuerst. Wer die Mannschaft trägt, bekommt zur Not
      // eine Verlängerung aufs Auge gedrückt – so hält die Liga ihr Niveau.
      .sort((a, b) => (playerOverall(a) - playerOverall(b)) || (a.id < b.id ? -1 : 1));

    for (const p of auslaufend) {
      const torhueter = club.playerIds.filter(
        id => state.players[id] && state.players[id].position === 'TW').length;
      if (club.playerIds.length <= minimum || (p.position === 'TW' && torhueter <= 2)) {
        p.contract.until = neueSaison;                 // Notverlängerung um ein Jahr
        continue;
      }

      club.playerIds = club.playerIds.filter(id => id !== p.id);
      if (Array.isArray(club.transferliste)) club.transferliste = club.transferliste.filter(id => id !== p.id);
      aufstellungBereinigen(club, p.id);
      p.clubId = null;
      p.captain = false;
      p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
      state.freeAgents = state.freeAgents || [];
      if (state.freeAgents.indexOf(p.id) < 0) state.freeAgents.push(p.id);
      abgaenge.push({ playerId: p.id, clubId, name: `${p.firstName || ''} ${p.lastName || p.id}`.trim() });
    }
  }

  const eigene = abgaenge.filter(a => a.clubId === state.managerClubId);
  if (eigene.length && ctx && typeof ctx.log === 'function') {
    ctx.log(
      `Zum 30. Juni sind ${eigene.length} Verträge ausgelaufen: ${eigene.map(a => a.name).join(', ')}.\n\n` +
      `Alle ablösefrei weg. Die Berater haben schon im März gewusst, dass Sie nicht verlängern – ` +
      `Sie wussten es leider erst heute.`,
      'transfer', { from: 'Geschäftsstelle', subject: 'Ausgelaufene Verträge', wichtig: true });
  }
  return abgaenge;
}

/** Alte Spielpläne wegräumen, neue erzeugen (Liga, Pokal, Europapokal, Kalender). */
function spielplaeneNeu(state, ctx, alteSaison, neueSaison, europaQuali) {
  // Nichts aus der Vorsaison bleibt liegen: keine Ligaspiele, keine
  // Pokalpartien, keine Freilose, keine Europapokalrunden. Sonst stehen 306
  // Geisterspiele in der Tabelle und der Pokal kommt nie über die 1. Runde
  // hinaus (ROADMAP 5.7 / S1).
  state.fixtures = state.fixtures.filter(f => f && f.season > alteSaison);

  for (const ligaId of LEAGUE_IDS) {
    state.fixtures.push(...generateFixtures(ligaVereine(state, ligaId), {
      rng: ctx.rng.fork('spielplan:' + ligaId + ':' + neueSaison),
      competitionId: ligaId,
      season: neueSaison
    }));
  }

  state.pokal = state.pokal || { runde: 0, paarungen: [], ausgeschieden: [] };
  state.pokal.runde = 0;
  state.pokal.paarungen = [];
  if (!Array.isArray(state.pokal.ausgeschieden)) state.pokal.ausgeschieden = [];
  // pokalfeld() statt Object.values(state.clubs): seit Stufe 3 stehen 66
  // europäische Vereine im Spielstand, die im DFB-Pokal nichts verloren haben.
  state.fixtures.push(...generateCupDraw(
    ctx.rng.fork('pokal:' + neueSaison), pokalfeld(state), 0, null, neueSaison));

  // Der Europapokal zuletzt: club/europa.js setzt seine Termine gegen den
  // bereits stehenden Liga- und Pokalplan an und weicht Kollisionen aus.
  try {
    europaAuslosen(state, ctx, europaQuali || { cl: [], el: [], conf: [] }, neueSaison);
  } catch (err) {
    console.error('[loop] Europapokal-Auslosung fehlgeschlagen:', err);
  }

  state.kalender = seasonCalendar(neueSaison, state.fixtures);
}

/**
 * Die Saison schließen und die nächste aufschlagen.
 *
 * @param {object} state
 * @param {object} ctx    aus makeCtx(state); optional, wird sonst gebaut
 * @param {object} [opts]
 *   bremse: boolean  Die Spielstandbremse am Ende laufen lassen. Standard: ja.
 *                    Das Spiel setzt das NIE auf false; einzig
 *                    tools/test-spielstand.js tut es, weil es die Chronik vor
 *                    und nach der Verdichtung vergleichen muss und beide Seiten
 *                    sonst nicht zu sehen bekommt. Der Schalter hat eine
 *                    Schattenseite, die dieses Projekt schon einmal teuer
 *                    bezahlt hat: Ein Prüfstand, der nur den geschalteten Weg
 *                    geht, prüft am Spiel vorbei. Deshalb geht derselbe
 *                    Prüfstand in Z11 zusätzlich den ungeschalteten Weg und
 *                    weist nach, dass der Saisonwechsel von selbst verdichtet.
 * @returns {object} der vollständige Saisonbericht (siehe screens/saison.js)
 */
export async function saisonWechsel(state, ctx, opts = {}) {
  const c = ctx || makeCtx(state);
  const alteSaison = state.date.season;
  const neueSaison = alteSaison + 1;

  /* --- a) Die abgelaufene Saison bewerten ------------------------------- */
  const eintrag = saisonAbschluss(state);                 // landet in history.seasons
  pokalFinaleEntscheiden(state, c, alteSaison);

  const bericht = Object.assign({}, eintrag, {
    // Vollständige Tabellenzeilen statt der schlanken Fassung aus dem Archiv –
    // der Saisonbildschirm zeigt Spiele, Tore und Differenz an.
    tabellen: {
      bl1: (state.tables.bl1 || []).slice(),
      bl2: (state.tables.bl2 || []).slice()
    },
    eigeneLiga: ligaVon(state, state.managerClubId),
    pokalsieger: pokalsiegerVon(state, alteSaison),
    aufsteiger: [], absteiger: [], relegation: null,
    torschuetzenkoenig: torschuetzenkoenig(state, 'bl1'),
    elfDerSaison: elfDerSaison(state, 'bl1'),
    spielerDerSaison: spielerDerSaison(state, 'bl1'),
    ruecktritte: [], neueTalente: [], praemien: {},
    manager: null, vorstandsurteil: null
  });

  /* --- b) Auf- und Abstieg, Relegation ---------------------------------- */
  const wechsel = aufUndAbstieg(state, c, bericht);
  bericht.aufsteiger = wechsel.aufsteiger;
  bericht.absteiger = wechsel.absteiger;
  bericht.relegation = wechsel.relegation;

  /* --- c) Prämien ------------------------------------------------------- */
  bericht.praemien = praemienAusschuetten(state, bericht);

  /* --- c2) Europapokal: abrechnen, dann die neuen Startplätze vergeben --- */
  // Erst abrechnen, dann qualifizieren – und beides, solange der Spielplan der
  // abgelaufenen Saison noch steht. spielplaeneNeu() räumt ihn gleich weg, und
  // ohne Endspiel gibt es keinen Sieger mehr zu küren.
  bericht.europa = { cl: [], el: [], conf: [], nachgerueckt: [], praemien: {}, sieger: {} };
  try {
    Object.assign(bericht.europa, europaSaisonende(state, c));
  } catch (err) {
    console.error('[loop] Europapokal-Abrechnung fehlgeschlagen:', err);
  }
  let europaQuali = { cl: [], el: [], conf: [], nachgerueckt: [] };
  try {
    europaQuali = qualifikationErmitteln(state, bericht);
    bericht.europa.cl = europaQuali.cl.slice();
    bericht.europa.el = europaQuali.el.slice();
    bericht.europa.conf = europaQuali.conf.slice();
    bericht.europa.nachgerueckt = europaQuali.nachgerueckt.slice();
  } catch (err) {
    console.error('[loop] Europapokal-Qualifikation fehlgeschlagen:', err);
  }

  /* --- Das Urteil des Vorstands (noch mit der alten Tabellenlage) -------- */
  bericht.vorstandsurteil = vorstandsurteilFuer(state, c, bericht);

  /* --- d) Karriereenden -------------------------------------------------- */
  // Vor der Chronik: Wer aufhört, gehört in den Jahresbericht. Torschützenkrone
  // und Elf der Saison stehen oben bereits fest – ein Rücktritt am 1. Juli
  // nimmt niemandem rückwirkend seine Tore weg.
  try {
    const enden = karriereenden(state, c);
    bericht.ruecktritte = enden.ruecktritte || [];
  } catch (err) {
    console.error('[loop] Karriereenden fehlgeschlagen:', err);
  }

  /* --- i) Chronik: solange Spielplan und Statistik noch stehen ---------- */
  try {
    titelChronik(state, bericht);
  } catch (err) {
    console.error('[loop] Titelchronik fehlgeschlagen:', err);
  }
  try {
    bericht.manager = managerSaison(state, bericht);
  } catch (err) {
    console.error('[loop] Managerentwicklung fehlgeschlagen:', err);
    bericht.manager = { level: (state.manager && state.manager.level) || 1, aufstieg: false, text: '' };
  }

  /* --- Ligen fortschreiben ---------------------------------------------- */
  ligenFortschreiben(state, bericht);
  eintrag.aufsteiger = bericht.aufsteiger.slice();
  eintrag.absteiger = bericht.absteiger.slice();
  eintrag.pokalsieger = bericht.pokalsieger;

  /* --- e) Altern, Verträge, Statistik ----------------------------------- */
  spielerFortschreiben(state, alteSaison);
  vertraegeFortschreiben(state, c, neueSaison);

  /* --- e2) Ausverkauf beim Absteiger ------------------------------------ */
  // Nach den Verträgen, vor der Regenerierung: Der Tausch ist eins zu eins und
  // ändert keine Kadergröße, aber er braucht die endgültigen Kader. Ohne ihn
  // gleichen sich die beiden Ligen binnen weniger Jahre an (test-saison Z14).
  try {
    ligawechselKader(state, c, bericht);
  } catch (err) {
    console.error('[loop] Ausverkauf beim Absteiger fehlgeschlagen:', err);
  }

  /* --- d2) Regenerierung: erst jetzt, wenn alle Abgänge feststehen ------- */
  // Reihenfolge mit Absicht: Erst gehen die Rücktritte und die ausgelaufenen
  // Verträge, dann füllt die Regenerierung die Lücken. Andersherum stünden die
  // Kader am 1. Juli am dünnsten – und die Liga verlöre über die Jahre Substanz.
  try {
    const nachwuchs = regenerieren(state, c, { ruecktritte: bericht.ruecktritte });
    bericht.neueTalente = nachwuchs.neu || [];
  } catch (err) {
    console.error('[loop] Regenerierung fehlgeschlagen:', err);
  }

  /* --- f/g/h) Spielpläne, Pokal, Europapokal, Kalender ------------------ */
  spielplaeneNeu(state, c, alteSaison, neueSaison, europaQuali);

  /* --- j) Vereins-Saisondaten zurücksetzen ------------------------------ */
  for (const club of Object.values(state.clubs)) {
    club.season = { form: [], tore: 0, gegentore: 0, punkte: 0, platz: 0, serie: 0, letzteErgebnisse: [] };
  }

  /* --- k) Der Kalender springt um ---------------------------------------- */
  state.date.season = neueSaison;
  state.date.day = 0;
  aktualisiereTabellen(state);

  const meister = state.clubs[bericht.meister];
  pushNews(state, `Saison ${alteSaison} abgepfiffen.` +
    (meister ? ` Deutscher Meister: ${meister.name}.` : '') +
    ` Die Vorbereitung beginnt – neue Spielpläne, neue Ausreden.`, 'info');

  /* --- l) Die Spielstandbremse ------------------------------------------ *
   * Ganz am Ende, nachdem der Kalender umgesprungen ist: Ab hier ist die
   * abgelaufene Spielzeit Vergangenheit, und Vergangenheit darf verdichtet
   * werden (state.js:verdichteVergangenheit, ROADMAP 8.1). Der Bericht, den
   * der Saisonbildschirm gleich anzeigt, übersteht das – er hält nur Namen,
   * Ids und Zahlen, und genau die bleiben stehen.
   *
   * Im try, wie jeder andere optionale Block hier: Ein Spielstand, der sich
   * nicht verdichten lässt, ist immer noch ein Spielstand. Er wird dann eben
   * groß, statt kaputt zu sein.
   *
   * Kosten gemessen (Seed 7, HSV): 2 bis 3 ms je Saisonwechsel, der ganze
   * Wechsel dauert 20 ms. Der Tagesablauf einer Spielzeit wurde dadurch nicht
   * langsamer, sondern schneller (9,5 statt 9,9 s in Spielzeit 1): Ein
   * kleinerer Spielstand hat weniger Datensätze, durch die zu laufen ist. */
  if (opts.bremse !== false) {
    try {
      verdichteVergangenheit(state);
    } catch (err) {
      console.error('[loop] Spielstandbremse fehlgeschlagen:', err);
    }
  }

  emit(EV.STATE_CHANGED, { state });
  return bericht;
}

// Der Europapokal wird hier durchgereicht: Wer den Tagesablauf hat, hat auch
// die Wettbewerbe (wie pokalWeiterlosen direkt darüber). tools/test-europa.js
// ruft europaWeiterlosen() nach jedem Tag zusätzlich auf – das ist erlaubt und
// folgenlos, die Funktion bewegt nur fertige Runden.
export { europaWeiterlosen, tickEuropa, europaStand, europaTeilnehmer } from '../club/europa.js';

export { SEASON_DAYS };
