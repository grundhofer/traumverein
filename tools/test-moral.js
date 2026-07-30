/**
 * tools/test-moral.js — Prüfstand für src/club/morale.js
 *
 * Aufruf:  node tools/test-moral.js
 *
 * Geprüft wird:
 *   1. moralEffektAufLeistung() bleibt im Korridor 0,85 … 1,12 und nutzt ihn auch aus.
 *   2. Moral reagiert spürbar auf Ergebnisse (Siegesserie vs. Pleitenserie).
 *   3. Moral reagiert spürbar auf Spielzeit (Stammspieler vs. Dauerreservist).
 *   4. Konflikte entstehen, sind vielfältig und lassen sich lösen.
 *  4b. Ära-Konflikte: die Frage, die man beantworten muss.
 *  4c. Ära-BALANCE: Beide Antworten kosten über 120 Tage rund dasselbe, und
 *      keine ist auf allen Achsen die billigere. Das ist die teuerste Messung
 *      dieses Prüfstands (140 Läufe × 3 Zwillinge × 120 Tage, rund 10 s) und
 *      der Grund, warum dieses Skript nicht mehr in einer Sekunde durchläuft.
 *      Sie steht hier, weil die Abnahme von Roadmap-Abschnitt 8 genau an dieser
 *      Stelle „Wer nur rechnet, wählt immer ‚Die Zeiten haben sich geändert'"
 *      notieren musste.
 *  4d. Häufigkeit: 1,5 bis 4 ära-übergreifende Konflikte je Spielzeit, in beiden
 *      Spielweisen (Manager führt die Kabine / Manager sitzt alles aus).
 *   5. Gespräche, Ansprachen, Kapitänswahl, Hierarchie, Teamgeist, Bericht.
 *   6. Alles ist deterministisch (gleicher Seed ⇒ gleiches Ergebnis).
 *
 * Der Test baut einen eigenen, minimalen State (core/state.js zieht Kaderdaten
 * nach, die parallel entstehen) — geprüft wird ausschließlich club/morale.js.
 */

import { createRng } from '../src/core/rng.js';
import { clamp, deepClone, avg, round, sortBy } from '../src/core/util.js';
import { mk } from '../src/data/squads/_helper.js';
import { playerOverall } from '../src/engine/ratings.js';
/* Nur Gruppe 4c fährt das ganze Spiel hoch. Sie muss es: Die Ära-Balance hängt
 * an der Laune eines ECHTEN Kaders (Ø 46), und die entsteht erst aus Spielen,
 * Verletzungen, Verträgen und Transfergerüchten. Ein Kunstkader steht bei 66 und
 * gibt die umgekehrte Antwort — nachgemessen, siehe Kopf der Gruppe. */
import { createNewGame } from '../src/core/state.js';
import { advanceDay, makeCtx, simulateAiFixture, applyResult, pokalWeiterlosen } from '../src/core/loop.js';
import {
  tickMoral, moralWert, teamGeist, hierarchie, beziehungen,
  konflikt, konfliktLoesen, gespraech, gespraechFuehren, ansprache,
  kapitaenBestimmen, mannschaftsrat, moralEffektAufLeistung, kabinenBericht,
  moralAendern, teamMoralAendern, offeneKonflikte, loesungsWege, istAeraKonflikt,
  GESPRAECHS_THEMEN, LOESUNGS_METHODEN, ANSPRACHE_ARTEN, KONFLIKT_ARTEN
} from '../src/club/morale.js';

/* ------------------------------------------------------------------ *
 *  Mini-Testrahmen
 * ------------------------------------------------------------------ */
let bestanden = 0, gescheitert = 0;
const fehler = [];

function ok(bedingung, titel, info) {
  if (bedingung) { bestanden++; console.log(`  ✓ ${titel}`); }
  else { gescheitert++; fehler.push(titel + (info ? ` — ${info}` : '')); console.log(`  ✗ ${titel}${info ? ` — ${info}` : ''}`); }
}
function gruppe(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`); }

/* ------------------------------------------------------------------ *
 *  Synthetischer State
 * ------------------------------------------------------------------ */

const PERSONALITIES = [
  { id: 'ehrgeizig', name: 'Ehrgeizig', moraleSwing: 1.2, loyalty: 0.7, ambition: 1.4 },
  { id: 'loyal', name: 'Vereinstreu', moraleSwing: 0.8, loyalty: 1.5, ambition: 0.7 },
  { id: 'profi', name: 'Musterprofi', moraleSwing: 0.7, loyalty: 1.1, ambition: 1.0 },
  { id: 'schwierig', name: 'Schwieriger Charakter', moraleSwing: 1.6, loyalty: 0.6, ambition: 1.2 },
  { id: 'gelassen', name: 'Gelassen', moraleSwing: 0.5, loyalty: 1.0, ambition: 0.8 },
  { id: 'fuehrungstyp', name: 'Führungstyp', moraleSwing: 0.9, loyalty: 1.2, ambition: 1.1 },
  { id: 'geldgierig', name: 'Geschäftsmann', moraleSwing: 1.1, loyalty: 0.4, ambition: 1.0 }
];

function leereStats() {
  return {
    spiele: 0, startelf: 0, minuten: 0, tore: 0, vorlagen: 0, schuesse: 0,
    paraden: 0, gegentore: 0, zuNull: 0, zweikaempfe: 0, zweikaempfeGewonnen: 0,
    gelb: 0, gelbrot: 0, rot: 0, notenSumme: 0, notenAnzahl: 0, motm: 0
  };
}

function initRuntime(p, rng) {
  p.form = 50; p.morale = 62; p.fitness = 100; p.sharpness = 60;
  p.injury = null;
  p.cards = { yellow: 0, red: 0, ban: 0, seasonYellow: 0 };
  p.happiness = { spielzeit: 60, gehalt: 60, ambition: 60, trainer: 60, beschwerden: [] };
  p.personality = deepClone(rng.pick(PERSONALITIES));
  p.training = { focus: null, gains: {}, intensitaet: 50, woche: 0 };
  p.stats = { season: leereStats(), career: leereStats(), history: [] };
  p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
  p.joined = { season: 1, day: 0 };
  p.captain = false;
  return p;
}

const POS_PLAN = ['TW', 'TW', 'IV', 'IV', 'IV', 'LV', 'RV', 'DM', 'DM', 'ZM', 'ZM',
  'OM', 'LM', 'RM', 'LA', 'RA', 'ST', 'ST', 'ST', 'ZM'];
const NATIONEN = ['DE', 'DE', 'DE', 'DE', 'DE', 'DE', 'DE', 'FR', 'FR', 'FR', 'FR',
  'BR', 'BR', 'BR', 'ES', 'NL', 'AT', 'PL', 'DE', 'DE'];
/* Fortsetzung für die größeren Kader aus Gruppe 4c. Sie hängt hinten dran und
 * nicht in POS_PLAN, weil POS_PLAN.length die Standardkadergröße dieses
 * Prüfstands ist: Vier Einträge mehr, und alle 160 anderen Zusicherungen stünden
 * auf einem anderen Kader. Ein reines `i % POS_PLAN.length` ginge auch, gäbe
 * einem 24-Mann-Kader aber VIER Torhüter — und vier Torhüter sind vier
 * Positionsrivalen, was die Beziehungsmatrix und damit die Gefolgschaft der
 * Legende verzerrt. */
const POS_ZUSATZ = ['IV', 'ZM', 'ST', 'RV', 'LM', 'DM', 'IV', 'ST'];
const NAT_ZUSATZ = ['DE', 'FR', 'BR', 'DE', 'ES', 'DE', 'NL', 'DE'];
const posVon = i => (i < POS_PLAN.length ? POS_PLAN[i] : POS_ZUSATZ[(i - POS_PLAN.length) % POS_ZUSATZ.length]);
const natVon = i => (i < NATIONEN.length ? NATIONEN[i] : NAT_ZUSATZ[(i - NATIONEN.length) % NAT_ZUSATZ.length]);

/**
 * `groesse` und `legendenAnteil` sind Zugaben für Gruppe 4c: Die Ära-Balance
 * muss über mehrere Kadergrößen und Ära-Verhältnisse halten, nicht nur über die
 * eine Aufstellung dieses Prüfstands. Ohne Argumente bleibt alles, wie es war
 * (20 Mann, jeder dritte eine Legende) — sonst würden 160 andere Zusicherungen
 * mitwandern.
 */
function baueKader(clubId, seed, ovrBasis, groesse = POS_PLAN.length, legendenAnteil = null) {
  const rng = createRng(seed);
  const spieler = [];
  let legIdx = null;
  if (legendenAnteil !== null) {
    legIdx = new Set();
    const n = Math.max(1, Math.round(groesse * legendenAnteil));
    for (let j = 0; j < n; j++) legIdx.add(Math.min(groesse - 1, Math.round(j * groesse / n)));
  }
  for (let i = 0; i < groesse; i++) {
    const legende = legIdx ? legIdx.has(i) : i % 3 === 0;
    const ovr = clamp(Math.round(ovrBasis + rng.gauss(0, 6) - (i > 13 ? 6 : 0)), 45, 93);
    const p = mk({
      club: clubId,
      vn: 'Vorname' + i,
      nn: `${clubId.toUpperCase()}Spieler${String(i).padStart(2, '0')}`,
      pos: posVon(i),
      age: legende ? rng.int(29, 35) : rng.int(19, 28),
      era: legende ? 'legend' : 'modern',
      eraLabel: legende ? 'Ära 1988' : null,
      nat: natVon(i),
      nr: i + 1,
      ovr,
      pot: Math.min(99, ovr + 4),
      traits: i === 0 ? ['leader', 'kabinenleader'] : i === 5 ? ['querulant'] : i === 9 ? ['mimose'] : i === 11 ? ['weltfussballer'] : [],
      until: 3
    });
    initRuntime(p, rng);
    spieler.push(p);
  }
  return spieler;
}

function baueClub(id, kurz, rep) {
  return {
    id, name: `Sport-Club ${kurz}`, shortName: kurz, abbr: kurz.slice(0, 3).toUpperCase(),
    reputation: rep,
    playerIds: [], staffIds: [],
    tactics: { formation: '4-4-2', style: 'ausgeglichen', lineup: {}, bench: [], setPieces: {}, sliders: {} },
    season: { form: [], tore: 0, gegentore: 0, punkte: 0, platz: 8, serie: 0, letzteErgebnisse: [] },
    board: { name: 'Der Vorstand', zufriedenheit: 60, geduld: 60, erwartung: { text: 'Mittelfeld', platz: 8, minPlatz: 12 } },
    fans: { members: 20000, ultras: 40, mood: 60 },
    finances: { balance: 5e6, debt: 0 },
    moral: 62
  };
}

function baueState(seed = 4711, groesse = POS_PLAN.length, legendenAnteil = null) {
  const rng = createRng(seed);
  const state = {
    seed, tick: 0,
    date: { season: 1, day: 30, startYear: 2025 },
    managerClubId: 'traum',
    manager: {
      name: 'Testtrainer', reputation: 55,
      skills: { training: 55, taktik: 55, motivation: 60, verhandlung: 50, jugend: 45, medien: 50 }
    },
    clubs: {}, players: {}, fixtures: [], inbox: [], news: []
  };
  for (const [id, kurz, rep, ovr] of [['traum', 'Traumverein', 72, 74], ['rivale', 'Rivale', 68, 70]]) {
    const club = baueClub(id, kurz, rep);
    state.clubs[id] = club;
    for (const p of baueKader(id, seed + id.length * 31, ovr, groesse, legendenAnteil)) {
      state.players[p.id] = p;
      club.playerIds.push(p.id);
    }
    // Startelf: die elf besten
    const elf = club.playerIds.map(i => state.players[i])
      .sort((a, b) => playerOverall(b) - playerOverall(a)).slice(0, 11);
    elf.forEach((p, i) => { club.tactics.lineup['s' + (i + 1)] = p.id; });
    club.tactics.setPieces.elfmeter = elf[3].id;
    club.tactics.setPieces.kapitaen = elf[0].id;
    elf[0].captain = true;
  }
  rng.next();
  return state;
}

function ctxFor(state, tag, opts = {}) {
  const logs = [], news = [];
  return {
    rng: createRng(state.seed + tag * 7919),
    day: tag, season: state.date.season, weekday: tag % 7,
    isMatchday: !!opts.isMatchday, isWeekStart: tag % 7 === 0,
    isMonthStart: false, isSeasonEnd: false,
    log: (text, kind, o) => logs.push({ text, kind, o }),
    news: (text, kind) => news.push({ text, kind }),
    difficulty: { id: 'profi', boardPatience: 1 },
    _logs: logs, _news: news
  };
}

/** Simuliert `tage` Tage; ergebnisFn(tag) -> 'S'|'U'|'N'|null */
function simuliere(state, tage, ergebnisFn) {
  const alleLogs = [], alleNews = [];
  for (let i = 0; i < tage; i++) {
    const tag = state.date.day;
    const erg = ergebnisFn ? ergebnisFn(tag, i) : null;
    if (erg) {
      const tore = erg === 'S' ? [3, 1] : erg === 'N' ? [0, 2] : [1, 1];
      state.fixtures.push({
        id: 'f' + tag, competitionId: 'bl1', season: state.date.season, matchday: i,
        dayIndex: tag, homeId: 'traum', awayId: 'rivale', played: true, result: tore
      });
      for (const cid of ['traum', 'rivale']) {
        const c = state.clubs[cid];
        const e = cid === 'traum' ? erg : (erg === 'S' ? 'N' : erg === 'N' ? 'S' : 'U');
        c.season.letzteErgebnisse.push(e);
        if (c.season.letzteErgebnisse.length > 5) c.season.letzteErgebnisse.shift();
      }
    }
    const ctx = ctxFor(state, tag);
    tickMoral(state, ctx);
    alleLogs.push(...ctx._logs); alleNews.push(...ctx._news);
    state.date.day++;
    state.tick++;
  }
  return { logs: alleLogs, news: alleNews };
}

const kaderMoral = (state, clubId) =>
  round(avg(state.clubs[clubId].playerIds.map(id => state.players[id]), p => p.morale), 2);

/**
 * Würfelt so lange Streit, bis einer über die Ära-Grenze geht (Legende gegen
 * Moderne). Alles andere wird sofort abgehakt, damit nur der Ära-Streit offen
 * ist — sonst misst man hinterher fremde Baustellen mit.
 * -> Konfliktobjekt | null
 */
function aeraStreit(state, clubId = 'traum') {
  for (let n = 0; n < 40; n++) {
    state.tick++;
    const r = konflikt(state, clubId, ctxFor(state, state.date.day));
    if (!r.ok) continue;
    if (istAeraKonflikt(state, r.konflikt)) return r.konflikt;
    r.konflikt.status = 'geloest';
  }
  return null;
}

/** Durchschnittsmoral der modernen Spieler — die Währung von „Der Alte hat recht". */
const modernMoral = (state, clubId) => avg(
  state.clubs[clubId].playerIds.map(id => state.players[id]).filter(p => p.era !== 'legend'),
  p => p.morale);

/** Einfluss eines Spielers in der Hackordnung — die Währung von „Die Zeiten …". */
function einflussVon(state, clubId, playerId) {
  const e = hierarchie(state, clubId).find(x => x.playerId === playerId);
  return e ? e.einfluss : 0;
}

/**
 * Die Dauerbaustellen eines echten Kaders (Gruppen 4c und 4d).
 *
 * Ein Kunstkader aus baueState() ist kerngesund, keiner ist verletzt, keiner hat
 * einen auslaufenden Vertrag, keiner will weg. So einen Verein gibt es im Spiel
 * nicht — und der Unterschied ist nicht kosmetisch, sondern entscheidet über
 * BEIDE Messungen dieses Prüfstands:
 *
 *   · Die Auslöserate hängt am Teamgeist (`1 + (60 − Teamgeist)/40`). Ohne
 *     Baustellen steht der Kader bei 73 und streitet mit 68 % der Grundrate.
 *   · Der Preis der Ära-Wege hängt daran, wie weit ein Spieler noch von
 *     SCHWELLE_WECHSELWUNSCH (22) entfernt ist. In einer Musterkabine bei
 *     Laune 70 verkraftet die Legende die Kränkung von −17 lässig; in einem
 *     echten Verein bei Laune 50 rutscht sie darunter, bittet um Freigabe und
 *     kostet über MOD_WECHSELWUNSCH dann VIER MONATE weiter. Genau daran ist
 *     die erste Fassung dieser Balance gescheitert: Der Prüfstand sagte 1,27
 *     (Verhältnis der Gesamtkosten), das Spiel sagte 1,51 — und im Spiel war
 *     „Die Zeiten …" auf ALLEN vier Achsen der teurere.
 *
 * Verletzungen heilen hier nicht, weil medical.js nicht mittickt. Das ist
 * Absicht: Ein echter Verein hat immer zwei bis vier Verletzte, nur nicht immer
 * dieselben.
 */
function echteBaustellen(state, clubId) {
  const kader = state.clubs[clubId].playerIds.map(id => state.players[id]);
  for (const [i, tage] of [[3, 40], [12, 18], [19, 9]]) {
    if (kader[i]) kader[i].injury = { name: 'Muskelverletzung', severity: 2, tage };
  }
  for (const i of [1, 7, 14, 21]) {
    if (kader[i]) kader[i].contract = Object.assign({}, kader[i].contract, { until: state.date.season });
  }
  if (kader[16]) kader[16].transfer.wunschWechsel = true;
}

/* ================================================================== *
 *  1. moralEffektAufLeistung — der Korridor
 * ================================================================== */
gruppe('1. moralEffektAufLeistung()');
{
  const state = baueState();
  const club = state.clubs.traum;
  const ids = club.playerIds;

  let min = 99, max = -99;
  const werte = [];
  for (let m = 1; m <= 99; m += 1) {
    for (const id of ids) {
      state.players[id].morale = m;
      const f = moralEffektAufLeistung(state, id);
      werte.push(f);
      if (f < min) min = f;
      if (f > max) max = f;
    }
  }
  ok(min >= 0.85 - 1e-9 && max <= 1.12 + 1e-9, 'Faktor bleibt in [0,85 … 1,12]', `min=${min} max=${max}`);
  ok(werte.every(v => typeof v === 'number' && isFinite(v)), 'Faktor ist immer eine endliche Zahl');

  // Der Korridor wird auch wirklich ausgenutzt (sonst wäre Moral wirkungslos).
  ok(min <= 0.90, 'Untergrenze wird erreicht (Moral hat echtes Gewicht)', `min=${min}`);
  ok(max >= 1.08, 'Obergrenze wird erreicht', `max=${max}`);

  // Monotonie: mehr Moral ⇒ nie weniger Leistung (bei sonst gleichem Zustand)
  const einer = ids[3];
  let letzter = 0, monoton = true;
  for (let m = 1; m <= 99; m++) {
    state.players[einer].morale = m;
    const f = moralEffektAufLeistung(state, einer);
    if (f < letzter - 1e-9) monoton = false;
    letzter = f;
  }
  ok(monoton, 'Faktor steigt monoton mit der Moral');

  // Konflikte und Streik drücken zusätzlich
  for (const id of ids) state.players[id].morale = 62;
  const neutral = moralEffektAufLeistung(state, ids[2]);
  konflikt(state, 'traum', ctxFor(state, state.date.day));
  const nachKonflikt = club.playerIds
    .map(id => ({ id, f: moralEffektAufLeistung(state, id) }))
    .filter(x => offeneKonflikte(state, 'traum').some(c => c.playerIds.includes(x.id)));
  ok(nachKonflikt.length > 0 && nachKonflikt.every(x => x.f < neutral),
    'Beteiligte an einem Konflikt verlieren Leistung', `neutral=${neutral}`);

  club.kabine.streikTage = 2;
  ok(moralEffektAufLeistung(state, ids[2]) < neutral, 'Trainingsstreik kostet Leistung');
  club.kabine.streikTage = 0;
}

/* ================================================================== *
 *  2. Moral reagiert auf Ergebnisse
 * ================================================================== */
gruppe('2. Reaktion auf Ergebnisse');
{
  const sieger = baueState(1001);
  const verlierer = baueState(1001);
  const neutral = baueState(1001);

  simuliere(sieger, 42, (tag, i) => (i % 7 === 3 ? 'S' : null));
  simuliere(verlierer, 42, (tag, i) => (i % 7 === 3 ? 'N' : null));
  simuliere(neutral, 42, () => null);

  const mS = kaderMoral(sieger, 'traum');
  const mN = kaderMoral(verlierer, 'traum');
  const mX = kaderMoral(neutral, 'traum');

  console.log(`    Siegesserie: ${mS} | ohne Spiele: ${mX} | Pleitenserie: ${mN}`);
  ok(mS > mN + 12, 'Siegesserie erzeugt deutlich mehr Moral als Pleitenserie', `${mS} vs ${mN}`);
  ok(mS > mX, 'Siege heben die Moral über den Ruhewert');
  ok(mN < mX, 'Niederlagen drücken die Moral unter den Ruhewert');
  ok(mS <= 99 && mN >= 1, 'Moral bleibt in den Grenzen');

  // Der Gegner erlebt das Spiegelbild.
  ok(kaderMoral(sieger, 'rivale') < kaderMoral(verlierer, 'rivale'),
    'Auch der KI-Verein reagiert auf seine Ergebnisse');

  // Einzelner Sieg wirkt sofort (Impuls), nicht erst nach Wochen.
  const kurz = baueState(1001);
  const vorher = kaderMoral(kurz, 'traum');
  simuliere(kurz, 1, () => 'S');
  ok(kaderMoral(kurz, 'traum') > vorher + 1.5, 'Ein Sieg wirkt sofort spürbar',
    `${vorher} -> ${kaderMoral(kurz, 'traum')}`);
}

/* ================================================================== *
 *  3. Moral reagiert auf Spielzeit
 * ================================================================== */
gruppe('3. Reaktion auf Spielzeit');
{
  const state = baueState(2002);
  const club = state.clubs.traum;
  const kader = club.playerIds.map(id => state.players[id])
    .sort((a, b) => playerOverall(b) - playerOverall(a));

  // Zwei etwa gleich starke Spieler: einer spielt immer, einer nie.
  const dauerspieler = kader[2];
  const reservist = kader[3];
  // gleiche Persönlichkeit, damit nur die Spielzeit den Unterschied macht
  reservist.personality = deepClone(dauerspieler.personality);
  for (const p of kader) p.stats.season.minuten = 900;
  dauerspieler.stats.season.minuten = 2700;
  reservist.stats.season.minuten = 0;

  simuliere(state, 40, null);

  console.log(`    Dauerspieler: ${dauerspieler.morale} | Reservist: ${reservist.morale}`);
  ok(dauerspieler.morale > reservist.morale + 10,
    'Stammspieler ist deutlich zufriedener als der Dauerreservist',
    `${dauerspieler.morale} vs ${reservist.morale}`);

  const mw = moralWert(state, reservist.id);
  ok(mw.gruende.some(g => /Einsatzminuten|draußen/i.test(g)),
    'Der Reservist nennt die Spielzeit als Grund', mw.gruende.join(' | '));
  ok(mw.dims.spielzeit < 45, 'Zufriedenheits-Dimension „Spielzeit" ist niedrig', String(mw.dims.spielzeit));
  ok(typeof mw.trend === 'number' && typeof mw.wert === 'number' && typeof mw.text === 'string',
    'moralWert() liefert wert/trend/gruende/text');

  // Gehaltsvergleich im Kader schlägt durch
  const state2 = baueState(2002);
  const c2 = state2.clubs.traum;
  const kader2 = c2.playerIds.map(id => state2.players[id])
    .sort((a, b) => playerOverall(b) - playerOverall(a));
  const unterbezahlt = kader2[1];
  unterbezahlt.contract.salary = 120000;                       // Topspieler, Mindestlohn
  for (const p of kader2.slice(8)) p.contract.salary = 6000000; // Ergänzungsspieler, Traumgehalt
  simuliere(state2, 35, null);
  const mw2 = moralWert(state2, unterbezahlt.id);
  ok(mw2.dims.gehalt < 45, 'Wer im Kadervergleich unterbezahlt ist, wird unzufrieden', String(mw2.dims.gehalt));
  ok(mw2.gruende.some(g => /Gehalt/i.test(g)), 'Gehalt taucht als Grund auf', mw2.gruende.join(' | '));

  // Auslaufender Vertrag
  const state3 = baueState(2002);
  const opa = state3.players[state3.clubs.traum.playerIds[4]];
  opa.contract.until = 1;
  simuliere(state3, 12, null);
  ok(moralWert(state3, opa.id).gruende.some(g => /Vertrag/i.test(g)),
    'Auslaufender Vertrag wird als Grund genannt');
}

/* ================================================================== *
 *  4. Konflikte
 * ================================================================== */
gruppe('4. Konflikte entstehen und lassen sich lösen');
{
  // 4a) Vielfalt der Konfliktarten
  const arten = new Set();
  for (let s = 0; s < 40; s++) {
    const st = baueState(3000 + s);
    st.date.day = 40 + s;
    for (let n = 0; n < 6; n++) {
      st.tick++;
      const r = konflikt(st, 'traum', ctxFor(st, st.date.day));
      if (r.ok) arten.add(r.konflikt.art);
    }
  }
  console.log('    Erzeugte Arten:', [...arten].join(', '));
  ok(arten.size >= 6, 'Mindestens sechs verschiedene Konfliktarten entstehen', `${arten.size}`);
  ok(arten.has('legende_star') || arten.has('generation'),
    'Der Reiz des Spiels: Legende trifft auf Moderne', [...arten].join(','));
  ok([...arten].every(a => KONFLIKT_ARTEN[a]), 'Alle Arten sind dokumentiert');

  // 4b) Texte enthalten konkrete Namen
  const st = baueState(3333);
  st.date.day = 55;
  const r = konflikt(st, 'traum', ctxFor(st, 55));
  ok(r.ok && r.konflikt.playerIds.length >= 1, 'Konflikt hat Beteiligte');
  const namen = r.konflikt.playerIds.map(id => st.players[id].lastName);
  ok(namen.some(n => r.konflikt.text.includes(n)),
    'Der Konflikttext nennt konkrete Spieler', r.konflikt.text.slice(0, 80));
  ok(/[äöüßÄÖÜ]|der|die|das|und|hat/.test(r.konflikt.text), 'Der Text ist deutsch');

  // 4c) Konflikte drücken Teamgeist und Moral
  const tgVor = teamGeist(st, 'traum').wert;
  for (let i = 0; i < 3; i++) { st.tick++; konflikt(st, 'traum', ctxFor(st, 55 + i)); }
  const tgNach = teamGeist(st, 'traum').wert;
  ok(tgNach < tgVor, 'Konflikte senken den Teamgeist', `${tgVor} -> ${tgNach}`);

  // 4d) Alle Lösungsmethoden funktionieren und werfen nie
  for (const methode of Object.keys(LOESUNGS_METHODEN)) {
    const s2 = baueState(4444);
    s2.date.day = 60;
    // Die beiden Ära-Wege brauchen einen Ära-Streit — siehe Gruppe 4b.
    const streit = LOESUNGS_METHODEN[methode].nurAera
      ? aeraStreit(s2)
      : konflikt(s2, 'traum', ctxFor(s2, 60)).konflikt;
    const res = konfliktLoesen(s2, streit.id, methode);
    ok(res.ok && typeof res.text === 'string' && res.text.length > 20,
      `Methode "${methode}" liefert einen deutschen Ausgangstext`);
  }
  ok(!konfliktLoesen(baueState(1), 'gibtsnicht', 'aussprache').ok,
    'Unbekannter Konflikt wird sauber abgelehnt (keine Exception)');
  const s3 = baueState(4445); s3.date.day = 60;
  const k3 = konflikt(s3, 'traum', ctxFor(s3, 60));
  ok(!konfliktLoesen(s3, k3.konflikt.id, 'hypnose').ok, 'Unbekannte Methode wird abgelehnt');

  // 4e) „verkaufen" beendet den Streit garantiert
  const s4 = baueState(5555); s4.date.day = 70;
  const k4 = konflikt(s4, 'traum', ctxFor(s4, 70));
  const res4 = konfliktLoesen(s4, k4.konflikt.id, 'verkaufen');
  ok(res4.ok && k4.konflikt.status === 'geloest', 'Abgeben beendet den Konflikt endgültig');
  ok(k4.konflikt.playerIds.some(id => s4.players[id].transfer.listed),
    'Der Störenfried steht danach auf der Transferliste');

  // 4f) Ein guter Motivator löst häufiger als ein schlechter
  let erfolgeGut = 0, erfolgeSchlecht = 0;
  for (let i = 0; i < 120; i++) {
    for (const [wert, zaehl] of [[95, 'gut'], [10, 'schlecht']]) {
      const s = baueState(6000 + i);
      s.date.day = 80 + i;
      s.manager.skills.motivation = wert;
      s.manager.reputation = wert;
      const kk = konflikt(s, 'traum', ctxFor(s, 80 + i));
      if (!kk.ok) continue;
      const rr = konfliktLoesen(s, kk.konflikt.id, 'einzelgespraech');
      if (rr.erfolg) { if (zaehl === 'gut') erfolgeGut++; else erfolgeSchlecht++; }
    }
  }
  console.log(`    Einzelgespräch gelöst — Topmotivator: ${erfolgeGut}/120, Nieten: ${erfolgeSchlecht}/120`);
  ok(erfolgeGut > erfolgeSchlecht + 15, 'Managerskill „motivation" entscheidet spürbar mit');

  /* 4g) Konflikte entstehen auch von allein im Tagesablauf. 180 Tage und nicht
   * 90: Bei KONFLIKT_CHANCE_SPIELER 0,018 (Ära-Balance) dauert es länger, bis
   * sich zwei Streitigkeiten angesammelt haben — genau das ist der Zweck der
   * gesenkten Rate. */
  const s5 = baueState(7777);
  for (const id of s5.clubs.traum.playerIds) s5.players[id].morale = 22;  // miese Stimmung
  simuliere(s5, 180, (tag, i) => (i % 7 === 3 ? 'N' : null));
  const entstanden = s5.clubs.traum.kabine.konflikte.length;
  ok(entstanden >= 2, 'Im Tagesablauf entstehen Konflikte von selbst', `${entstanden} Stück`);
  ok(s5.clubs.rivale.kabine !== undefined, 'Auch KI-Vereine werden getickt');
}

/* ================================================================== *
 *  4b. Ära-Konflikte — die Frage, die man beantworten muss
 *
 *  Zwei Wege, die es nur beim Streit zwischen Legende und Moderne gibt, und
 *  die beide etwas kosten. Geprüft wird deshalb nicht nur, DASS sie wirken,
 *  sondern dass sie in verschiedenen Währungen zahlen und dass keiner von
 *  beiden der offensichtlich bessere ist. Gemessen über viele Durchläufe —
 *  ein Einzelfall sagt bei zwei Würfen (Erfolg, Nebenwirkung) gar nichts.
 * ================================================================== */
gruppe('4b. Ära-Konflikte: beide Antworten kosten');
{
  /* --- Entstehen sie überhaupt? ---------------------------------------- */
  const arten = new Set();
  let mitFrage = 0;
  for (let seed = 0; seed < 25; seed++) {
    const s = baueState(20000 + seed * 3);
    s.date.day = 35 + seed;
    const k = aeraStreit(s);
    if (!k) continue;
    arten.add(k.art);
    if ((KONFLIKT_ARTEN[k.art] || {}).frage) mitFrage++;
  }
  console.log(`    Ära-Streit in ${mitFrage}/25 Anläufen, Arten: ${[...arten].join(', ')}`);
  ok(mitFrage >= 22, 'Ära-übergreifende Konflikte entstehen zuverlässig', `${mitFrage}/25`);
  ok([...arten].every(a => KONFLIKT_ARTEN[a].aera === true),
    'Nur als Ära-Streit markierte Arten gelten als solche', [...arten].join(','));

  // Sie entstehen auch von selbst im Tagesablauf, nicht nur auf Zuruf.
  const lauf = baueState(21212);
  for (const id of lauf.clubs.traum.playerIds) lauf.players[id].morale = 28;
  /* Eine ganze Spielzeit, nicht vier Monate: 2,85 Ära-Konflikte je Spielzeit
   * (Gruppe 4d) heißt, dass in 120 Tagen auch mal keiner dabei ist. */
  simuliere(lauf, 365, (tag, i) => (i % 7 === 3 ? 'N' : null));
  const vonSelbst = lauf.clubs.traum.kabine.konflikte.filter(k => istAeraKonflikt(lauf, k)).length;
  ok(vonSelbst >= 1, 'Im Tagesablauf entsteht auch Ära-Streit von allein', `${vonSelbst} Stück`);

  /* --- Mehrere Textvarianten, damit sich nichts wiederholt -------------- */
  const texte = new Set(), titel = new Set();
  for (let seed = 0; seed < 40; seed++) {
    const s = baueState(22000 + seed * 7);
    s.date.day = 30 + seed;
    const k = aeraStreit(s);
    if (k) { texte.add(k.text); titel.add(k.titel); }
  }
  ok(texte.size >= 6, 'Ära-Streit hat mehrere Textvarianten je Art', `${texte.size} verschiedene Texte`);
  ok(titel.size >= 5, 'Auch die Überschriften wiederholen sich nicht', `${titel.size} verschiedene Titel`);

  /* --- Die beiden Wege gibt es NUR hier -------------------------------- */
  const sA = baueState(23001); sA.date.day = 50;
  const aera = aeraStreit(sA);
  const wegeAera = loesungsWege(sA, aera).map(w => w.id);
  ok(wegeAera.includes('alte_schule') && wegeAera.includes('neue_zeit'),
    'Beim Ära-Streit stehen beide Sonderwege offen', wegeAera.join(','));
  ok(wegeAera[0] === 'alte_schule' && wegeAera[1] === 'neue_zeit',
    'Die Sonderwege stehen obenan — sie sind die Frage dieses Streits');
  ok(loesungsWege(sA, aera).filter(w => !w.nurAera).length === 7,
    'Die sieben gewohnten Wege bleiben daneben bestehen');
  ok(loesungsWege(sA, aera).every(w => typeof w.folge === 'string' && w.folge.length > 15),
    'Jeder Weg nennt seine Folge im Klartext');

  const sB = baueState(23002); sB.date.day = 50;
  let anderer = null;
  for (let n = 0; n < 30 && !anderer; n++) {
    sB.tick++;
    const r = konflikt(sB, 'traum', ctxFor(sB, sB.date.day));
    if (r.ok && !istAeraKonflikt(sB, r.konflikt)) anderer = r.konflikt;
    else if (r.ok) r.konflikt.status = 'geloest';
  }
  ok(!!anderer, 'Zum Vergleich gibt es auch gewöhnlichen Streit');
  ok(loesungsWege(sB, anderer).every(w => !w.nurAera),
    'Beim gewöhnlichen Streit tauchen die Sonderwege gar nicht erst auf');
  ok(!konfliktLoesen(sB, anderer.id, 'alte_schule').ok,
    '„Der Alte hat recht" wird bei gewöhnlichem Streit abgelehnt');
  ok(!konfliktLoesen(sB, anderer.id, 'neue_zeit').ok,
    '„Die Zeiten haben sich geändert" wird bei gewöhnlichem Streit abgelehnt');
  ok(anderer.status === 'offen', 'Der abgelehnte Versuch hat den Streit nicht angefasst');

  /* --- Messung über viele Durchläufe ----------------------------------- */
  const messe = (weg, laeufe) => {
    let n = 0, modern = 0, legende = 0, einfluss = 0, teamgeist = 0, beendet = 0, mitgegangen = 0, koffer = 0;
    for (let i = 0; i < laeufe; i++) {
      const s = baueState(24000 + i * 11);
      s.date.day = 40 + (i % 60);
      const k = aeraStreit(s);
      if (!k) continue;
      const leg = k.playerIds.map(id => s.players[id]).find(p => p.era === 'legend');
      if (!leg) continue;
      const m0 = modernMoral(s, 'traum'), e0 = einflussVon(s, 'traum', leg.id);
      const t0 = teamGeist(s, 'traum').wert, l0 = leg.morale;
      const r = konfliktLoesen(s, k.id, weg);
      if (!r.ok) continue;
      n++;
      modern += modernMoral(s, 'traum') - m0;
      einfluss += einflussVon(s, 'traum', leg.id) - e0;
      legende += leg.morale - l0;
      teamgeist += teamGeist(s, 'traum').wert - t0;
      if (k.status === 'geloest') beendet++;
      if (r.erfolg) mitgegangen++;
      if (k.playerIds.some(id => s.players[id].transfer.wunschWechsel)) koffer++;
    }
    return {
      n, modern: round(modern / n, 2), legende: round(legende / n, 2),
      einfluss: round(einfluss / n, 2), teamgeist: round(teamgeist / n, 2),
      beendet: round(beendet / n * 100, 1), mitgegangen: round(mitgegangen / n * 100, 1),
      koffer: round(koffer / n * 100, 1)
    };
  };

  const LAEUFE = 150;
  const alt = messe('alte_schule', LAEUFE);
  const neu = messe('neue_zeit', LAEUFE);
  const jungMoral = weg => {
    // Wie geht es dem umstrittenen Jungstar hinterher? Die eine Zahl, an der man
    // ablesen kann, wem der Trainer recht gegeben hat.
    let summe = 0, n = 0;
    for (let i = 0; i < 40; i++) {
      const s = baueState(24000 + i * 11);
      s.date.day = 40 + (i % 60);
      const k = aeraStreit(s);
      if (!k) continue;
      const j = k.playerIds.map(id => s.players[id]).find(p => p.era !== 'legend');
      if (!j) continue;
      const vor = j.morale;
      if (!konfliktLoesen(s, k.id, weg).ok) continue;
      summe += j.morale - vor; n++;
    }
    return round(summe / Math.max(1, n), 2);
  };
  const altJung = jungMoral('alte_schule'), neuJung = jungMoral('neue_zeit');
  console.log(`    Der Alte hat recht (${alt.n} Läufe):  Moral der Modernen ${alt.modern}, ` +
    `Moral der Legende ${alt.legende}, Ansehen der Legende ${alt.einfluss}, Teamgeist ${alt.teamgeist}`);
  console.log(`    Die Zeiten … (${neu.n} Läufe):        Moral der Modernen ${neu.modern}, ` +
    `Moral der Legende ${neu.legende}, Ansehen der Legende ${neu.einfluss}, Teamgeist ${neu.teamgeist}`);
  console.log(`    Streit beendet: ${alt.beendet} % / ${neu.beendet} % · Kabine geht mit: ` +
    `${alt.mitgegangen} % / ${neu.mitgegangen} % · Freigabewunsch danach: ${alt.koffer} % / ${neu.koffer} %`);
  console.log(`    Laune des Jungstars danach: ${altJung} / ${neuJung}`);

  ok(alt.n >= 140 && neu.n >= 140, 'Beide Wege ließen sich in fast allen Läufen gehen', `${alt.n}/${neu.n}`);
  ok(alt.beendet === 100 && neu.beendet === 100,
    'Beide Antworten beenden den Streit — eine Entscheidung ist eine Entscheidung');

  // Messbare Wirkung, jeweils in der eigenen Währung
  ok(alt.modern < -4, '„Der Alte hat recht" kostet die Laune der modernen Spieler', String(alt.modern));
  ok(neu.einfluss < -12, '„Die Zeiten …" kostet das Ansehen der Legende in der Hackordnung', String(neu.einfluss));
  ok(neu.legende < -10, '… und kränkt sie obendrein', String(neu.legende));
  ok(alt.einfluss > 1.5, '„Der Alte hat recht" stärkt dafür ihre Stellung', String(alt.einfluss));
  ok(neuJung > 2 && altJung < -4,
    'Der Jungstar spürt die Antwort am deutlichsten — in beide Richtungen',
    `${altJung} vs ${neuJung}`);

  // Unterschiedlich — und zwar spiegelbildlich
  ok(Math.abs(alt.modern - neu.modern) > 2,
    'Die Wirkung auf die Modernen unterscheidet sich deutlich', `${alt.modern} vs ${neu.modern}`);
  ok(Math.abs(alt.einfluss - neu.einfluss) > 8,
    'Die Wirkung auf die Hackordnung unterscheidet sich deutlich', `${alt.einfluss} vs ${neu.einfluss}`);
  ok(alt.modern < neu.modern && alt.einfluss > neu.einfluss,
    'Jeder Weg gewinnt genau eine Währung und verliert die andere');

  // Keiner ist der offensichtlich bessere
  ok(!(alt.modern >= neu.modern && alt.einfluss >= neu.einfluss) &&
     !(neu.modern >= alt.modern && neu.einfluss >= alt.einfluss),
    'Kein Weg ist in beiden Währungen besser (keine Dominanz)');
  /* Am Tag der Entscheidung nehmen sich beide beim Teamgeist wenig — der
   * Unterschied entsteht erst über Wochen und wird in Gruppe 4c gemessen. Eine
   * Zusicherung auf den Augenblick würde genau das Gegenteil behaupten. */
  ok(Math.abs(alt.teamgeist) < 4 && Math.abs(neu.teamgeist) < 4,
    'Am Tag der Entscheidung bewegt sich der Teamgeist kaum — die Rechnung kommt später',
    `${alt.teamgeist} vs ${neu.teamgeist}`);
  ok(Math.abs(alt.mitgegangen - neu.mitgegangen) < 12,
    'Beide Antworten werden gleich häufig von der Kabine mitgetragen',
    `${alt.mitgegangen} % vs ${neu.mitgegangen} %`);
  ok(alt.modern < 0 && neu.legende < 0 && neu.einfluss < 0,
    'Es gibt keinen kostenlosen Ausweg — beide Antworten schicken eine Rechnung');

  /* --- Die zweiten Folgen, die nur „Die Zeiten …" hat -------------------- */
  {
    // Mentorenbogen: Die gekränkte Ikone lässt ihr Talent fallen. Die Felder
    // (`p.mentor`, `p.mentees`) pflegt club/chemie.js; morale.js liest und
    // räumt sie, ohne das Modul zu importieren (Zyklus).
    const bogen = weg => {
      const s = baueState(27100); s.date.day = 48;
      const k = aeraStreit(s);
      const leg = k.playerIds.map(id => s.players[id]).find(p => p.era === 'legend');
      const talent = s.clubs.traum.playerIds.map(id => s.players[id])
        .find(p => p.era !== 'legend' && !k.playerIds.includes(p.id));
      talent.mentor = { mentorId: leg.id, seit: { saison: 1, tag: 1 }, staerke: 70, ovrStart: 60, abfaerbung: 0, gemeldet: 0, text: 'x' };
      leg.mentees = [talent.id];
      const r = konfliktLoesen(s, k.id, weg);
      return { r, leg, talent };
    };
    const a1 = bogen('neue_zeit');
    ok(!a1.talent.mentor && !(a1.leg.mentees || []).length,
      '„Die Zeiten …": Der Mentorenbogen der Legende reißt');
    ok(a1.r.text.includes(a1.talent.lastName),
      '… und der Ausgangstext nennt das fallengelassene Talent beim Namen');
    const a2 = bogen('alte_schule');
    ok(a2.talent.mentor && a2.talent.mentor.mentorId === a2.leg.id,
      '„Der Alte hat recht": Der Mentorenbogen bleibt bestehen');

    // Gefolgschaft: Die Vertrauten der Legende verlieren Vertrauen in den Trainer.
    const s = baueState(27200); s.date.day = 52;
    const k = aeraStreit(s);
    const leg = k.playerIds.map(id => s.players[id]).find(p => p.era === 'legend');
    const bez = beziehungen(s, 'traum');
    const freunde = ((bez.byPlayer[leg.id] || {}).freunde || [])
      .filter(id => !k.playerIds.includes(id)).map(id => s.players[id]);
    const vorher = freunde.map(p => p.happiness.trainer);
    konfliktLoesen(s, k.id, 'neue_zeit');
    const gefallen = freunde.filter((p, i) => p.happiness.trainer < vorher[i]).length;
    console.log(`    Vertraute der Legende: ${freunde.length} vorhanden, ${gefallen} verlieren Vertrauen`);
    ok(freunde.length >= 1, 'Die Legende hat Vertraute in der Kabine', `${freunde.length}`);
    ok(gefallen >= 1, '„Die Zeiten …": Ihre Vertrauten nehmen es dem Trainer ab', `${gefallen}/${freunde.length}`);

    // Eine gekränkte Ikone kann gehen wollen, auch wenn die Kabine mitgeht.
    let mitZustimmung = 0, laeufe = 0;
    for (let i = 0; i < 120; i++) {
      const st = baueState(27300 + i * 13); st.date.day = 40 + (i % 50);
      const kk = aeraStreit(st);
      if (!kk) continue;
      const l = kk.playerIds.map(id => st.players[id]).find(p => p.era === 'legend');
      const rr = konfliktLoesen(st, kk.id, 'neue_zeit');
      if (!rr.ok || !rr.erfolg) continue;
      laeufe++;
      if (l.transfer.wunschWechsel) mitZustimmung++;
    }
    console.log(`    Ikone will gehen, obwohl die Kabine mitging: ${mitZustimmung}/${laeufe}`);
    ok(mitZustimmung >= 1,
      'Auch bei Zustimmung der Kabine kann die Ikone ihren Abschied verlangen',
      `${mitZustimmung}/${laeufe}`);
    ok(mitZustimmung / Math.max(1, laeufe) < 0.30,
      '… aber es bleibt die Ausnahme, nicht die Regel',
      `${round(mitZustimmung / Math.max(1, laeufe) * 100, 1)} %`);
  }

  /* --- Der Ausgangstext benennt die Folgen im Klartext ------------------ */
  for (const weg of ['alte_schule', 'neue_zeit']) {
    const s = baueState(25000); s.date.day = 44;
    const k = aeraStreit(s);
    const leg = k.playerIds.map(id => s.players[id]).find(p => p.era === 'legend');
    const r = konfliktLoesen(s, k.id, weg);
    ok(r.ok && r.text.includes('Unterm Strich'),
      `„${LOESUNGS_METHODEN[weg].name}" benennt die Folge hinterher im Klartext`);
    ok(r.text.includes(leg.lastName), 'Der Ausgangstext nennt die Legende beim Namen');
    ok(/[äöüßÄÖÜ]/.test(r.text) && r.text.length > 200, 'Der Ausgangstext ist deutsch und ausformuliert');
  }

  /* --- Der Ansehensverlust wächst nach, aber langsam -------------------- */
  {
    const s = baueState(26262); s.date.day = 40;
    const k = aeraStreit(s);
    const leg = k.playerIds.map(id => s.players[id]).find(p => p.era === 'legend');
    const vorher = einflussVon(s, 'traum', leg.id);
    konfliktLoesen(s, k.id, 'neue_zeit');
    const gleichDanach = einflussVon(s, 'traum', leg.id);
    simuliere(s, 40, null);
    const nachSechsWochen = einflussVon(s, 'traum', leg.id);
    simuliere(s, 95, null);
    const nachViereinhalbMonaten = einflussVon(s, 'traum', leg.id);
    console.log(`    Ansehen der Legende: ${vorher} → ${gleichDanach} → ${nachSechsWochen} (Tag 40) ` +
      `→ ${nachViereinhalbMonaten} (Tag 135)`);
    ok(gleichDanach < vorher - 8, 'Der Rüffel wirkt sofort', `${vorher} → ${gleichDanach}`);
    ok(nachSechsWochen > gleichDanach && nachSechsWochen < vorher - 2,
      'Nach sechs Wochen ist er halb vergessen — halb', String(nachSechsWochen));
    ok(Math.abs(nachViereinhalbMonaten - vorher) < 1.5,
      'Nach über vier Monaten steht die Legende wieder, wo sie stand',
      `${vorher} → ${nachViereinhalbMonaten}`);
    ok(!s.clubs.traum.kabine.ansehen[leg.id],
      'Der verjährte Eintrag wird aus dem Spielstand geräumt');
  }
}

/* ================================================================== *
 *  4c. Ära-Balance: gleich teuer, verschieden im Zuschnitt
 *
 *  DIE Messung dieses Prüfstands, und die einzige Gruppe, die dafür das ganze
 *  Spiel anwirft. Warum sie das tun muss, ist die Lehre aus zwei Anläufen:
 *
 *  Anlauf 1 (Abnahme zu ROADMAP 8.3) rechnete nur den Augenblick der
 *  Entscheidung. Ergebnis: „Wer nur rechnet, wählt immer ‚Die Zeiten haben sich
 *  geändert'." Zu Recht — im Augenblick kostet „Der Alte hat recht" die Laune
 *  von dreizehn Leuten, „Die Zeiten …" die von einem.
 *
 *  Anlauf 2 rechnete 120 Tage, aber an einem KUNSTKADER (baueState, alle gesund,
 *  alle mit Vertrag, keiner unzufrieden, Ø Laune 66). Ergebnis: 1,27 — im
 *  Korridor. Am echten Spiel gemessen war es 2,2 bis 3,7, und „Der Alte hat
 *  recht" war der teurere. Der Grund ist eine Schwelle, die es im Kunstkader
 *  nicht gibt: Ein echter Kader steht bei Ø Laune 46, nicht 66. Ein Abzug von
 *  sieben Punkten auf dreizehn Köpfe schiebt dort ein bis zwei Spieler unter
 *  SCHWELLE_WECHSELWUNSCH — und ein Wechselwunsch verschwindet nie wieder von
 *  selbst, er kostet über MOD_VERTRAG/MOD_WECHSELWUNSCH bis zum Saisonende
 *  weiter. „Breit und kurz" war in Wahrheit „breit und für immer".
 *
 *  Deshalb wird hier an ECHTEN Ära-Konflikten gemessen: Eine Spielzeit läuft im
 *  vollen Tagesablauf (createNewGame + advanceDay + Spiele), und JEDER
 *  ära-übergreifende Streit, der dabei irgendwo in der Liga von selbst entsteht,
 *  wird samt seinem Verein als Momentaufnahme beiseitegelegt — echter Kader,
 *  echte Laune, echter Tag im Jahr, echte Hackordnung. Anschließend wird jede
 *  Momentaufnahme dreimal beantwortet (ohne Preis / alte Schule / neue Zeit) und
 *  120 Tage nachgerechnet.
 *
 *  DREI FALLEN, die dabei ausdrücklich umgangen werden:
 *  1. Die Zwillinge laufen auseinander, sobald in einem davon neuer Streit
 *     entsteht — der ist dann nicht die Folge der Entscheidung, sondern der
 *     Zufall danach. Deshalb sperren vier Platzhalter (KONFLIKT_MAX_OFFEN) die
 *     Konfliktentstehung im Messfenster, gleich in allen Zwillingen.
 *  2. Eine Zusicherung, die nur an einem Kaderbild hält, hält nicht: „viele
 *     zahlen wenig" hängt daran, wie viele „viele" sind. Jede Momentaufnahme
 *     wird deshalb in drei Kaderbildern gerechnet — unverändert, ohne die vier
 *     schwächsten Legenden, ohne die sechs schwächsten Modernen.
 *  3. Ein Prüfstand, der seine eigene Messung nicht misstraut, misst nichts:
 *     Ein VIERTER Zwilling entscheidet gar nichts und muss auf allen drei Achsen
 *     exakt 0 kosten. Fällt diese Nullprobe, ist jede Zahl darunter Zufall.
 * ================================================================== */
gruppe('4c. Ära-Balance: gleich teuer, verschieden im Zuschnitt');
{
  const TAGE = 120;
  const SAAT = [8117, 8221];        // zwei Spieljahre; eines allein streut zu stark

  /** Vier Platzhalter ohne Beteiligte sperren die Konfliktentstehung. */
  const konflikteSperren = (s, clubId) => {
    const kb = s.clubs[clubId].kabine;
    if (!kb) return;
    for (let i = 0; i < 4; i++) {
      kb.konflikte.push({
        id: `sperre_${clubId}_${i}`, clubId, art: 'taktik', titel: 'Platzhalter', text: '',
        playerIds: [], schwere: 3, tag: s.date.day, saison: s.date.season,
        status: 'offen', versuche: 0, verlauf: []
      });
    }
  };
  /**
   * Die Platzhalter jung halten. Ohne das greift KONFLIKT_VERJAEHRUNG_TAGE nach
   * einem Monat auch bei ihnen, die Sperre fällt, frischer Streit entsteht in
   * jedem Zwilling anders — und gemessen wäre dann nicht mehr die Entscheidung,
   * sondern der Zufall danach.
   */
  const sperrenAuffrischen = (s, clubId) => {
    const kb = s.clubs[clubId].kabine;
    if (!kb) return;
    for (const c of kb.konflikte) {
      if (typeof c.id === 'string' && c.id.startsWith('sperre_')) {
        c.tag = s.date.day; c.saison = s.date.season; c.status = 'offen';
      }
    }
  };

  const kaderVon = (s, cid) => s.clubs[cid].playerIds.map(id => s.players[id]).filter(Boolean);
  const mMoral = (s, cid) => avg(kaderVon(s, cid), p => p.morale || 0);
  const mTrainer = (s, cid) => avg(kaderVon(s, cid), p => (p.happiness && p.happiness.trainer) || 0);
  const wollenWeg = (s, cid) => kaderVon(s, cid).filter(p => p.transfer && p.transfer.wunschWechsel).length;

  /**
   * Schneidet einen Verein samt Kader aus der Welt heraus. Was danach fehlt
   * (Spielplan, andere Vereine, Postfach), braucht morale.js nicht — und ein
   * Messfenster über einen Verein ist 60-mal billiger als eines über 64.
   * `weg` dünnt den Kader aus, um andere Ära-Verhältnisse zu prüfen.
   */
  const ausschneiden = (welt, clubId, weg) => {
    const club = deepClone(welt.clubs[clubId]);
    const s = {
      seed: welt.seed, tick: welt.tick, date: deepClone(welt.date),
      managerClubId: clubId, manager: deepClone(welt.manager),
      clubs: { [clubId]: club }, players: {}, fixtures: [], inbox: [], news: [],
      difficulty: welt.difficulty
    };
    let ids = club.playerIds.slice();
    if (weg) {
      const nachStaerke = art => sortBy(ids.filter(id => (welt.players[id].era === 'legend') === (art === 'legend')),
        id => playerOverall(welt.players[id]));
      const raus = new Set([
        ...nachStaerke('legend').slice(0, weg.legenden || 0),
        ...nachStaerke('modern').slice(0, weg.moderne || 0)
      ]);
      ids = ids.filter(id => !raus.has(id));
      club.playerIds = ids;
      if (club.tactics && club.tactics.lineup) {
        for (const slot in club.tactics.lineup) if (raus.has(club.tactics.lineup[slot])) delete club.tactics.lineup[slot];
      }
    }
    for (const id of ids) if (welt.players[id]) s.players[id] = deepClone(welt.players[id]);
    return s;
  };

  /** Eine Momentaufnahme, viermal beantwortet (einmal davon: gar nicht). */
  const messeAufnahme = (aufnahme, weg) => {
    const cid = aufnahme.clubId;
    const basis = ausschneiden(aufnahme.welt, cid, weg);
    const kader = kaderVon(basis, cid);
    const legenden = kader.filter(p => p.era === 'legend').length;
    if (kader.length < 14 || legenden < 1 || kader.length - legenden < 3) return null;
    const streit = basis.clubs[cid].kabine.konflikte.find(x => x.id === aufnahme.konfliktId);
    if (!streit || !istAeraKonflikt(basis, streit)) return null;
    const leg = streit.playerIds.map(id => basis.players[id]).find(p => p.era === 'legend');
    if (!leg) return null;
    const vorMoral = mMoral(basis, cid), vorWeg = wollenWeg(basis, cid);

    const zwilling = {};
    for (const w of ['ref', 'nullprobe', 'alte_schule', 'neue_zeit']) {
      const s = deepClone(basis);
      const k = s.clubs[cid].kabine.konflikte.find(x => x.id === aufnahme.konfliktId);
      if (w === 'ref' || w === 'nullprobe') k.status = 'geloest';
      else if (!konfliktLoesen(s, k.id, w).ok) return null;
      s.clubs[cid].kabine.hierarchieTag = -999;
      s.clubs[cid].kabine.beziehungenTag = -999;
      const sofort = vorMoral - mMoral(s, cid);
      const ansehen = einflussVon(s, cid, leg.id);
      konflikteSperren(s, cid);
      s.clubs[cid].kabine.hierarchieTag = -999;
      const reihe = [];
      for (let i = 0; i < TAGE; i++) {
        sperrenAuffrischen(s, cid);
        tickMoral(s, ctxFor(s, s.date.day));
        reihe.push({ moral: mMoral(s, cid), trainer: mTrainer(s, cid), teamgeist: s.clubs[cid].kabine.teamgeist });
        s.date.day++; s.tick = (s.tick | 0) + 1;
      }
      zwilling[w] = { sofort, ansehen, reihe, weg: wollenWeg(s, cid) - vorWeg };
    }
    const kosten = w => {
      let moral = 0, trainer = 0, teamgeist = 0;
      for (let i = 0; i < TAGE; i++) {
        moral += zwilling.ref.reihe[i].moral - zwilling[w].reihe[i].moral;
        trainer += zwilling.ref.reihe[i].trainer - zwilling[w].reihe[i].trainer;
        teamgeist += zwilling.ref.reihe[i].teamgeist - zwilling[w].reihe[i].teamgeist;
      }
      return { moral, trainer, teamgeist, summe: moral + trainer + teamgeist };
    };
    /** Nach wie vielen Tagen ist die halbe Moraldelle wieder aufgeholt? */
    const halbwert = w => {
      const d0 = zwilling.ref.reihe[0].moral - zwilling[w].reihe[0].moral;
      if (Math.abs(d0) < 0.05) return 0;
      for (let i = 0; i < TAGE; i++) {
        if (Math.abs(zwilling.ref.reihe[i].moral - zwilling[w].reihe[i].moral) <= Math.abs(d0) / 2) return i;
      }
      return TAGE;
    };
    return {
      clubId: cid, kader: kader.length, legenden, laune: vorMoral,
      alt: kosten('alte_schule'), neu: kosten('neue_zeit'), null: kosten('nullprobe'),
      altSofort: zwilling.alte_schule.sofort, neuSofort: zwilling.neue_zeit.sofort,
      altHalbwert: halbwert('alte_schule'), neuHalbwert: halbwert('neue_zeit'),
      altAnsehen: zwilling.alte_schule.ansehen - zwilling.ref.ansehen,
      neuAnsehen: zwilling.neue_zeit.ansehen - zwilling.ref.ansehen,
      altWeg: zwilling.alte_schule.weg - zwilling.ref.weg,
      neuWeg: zwilling.neue_zeit.weg - zwilling.ref.weg
    };
  };

  /**
   * Eine Spielzeit im vollen Tagesablauf. Geerntet wird jeder ära-übergreifende
   * Streit, der dabei IRGENDWO entsteht — nicht nur beim Verein des Spielers,
   * sonst dauert die Ernte acht Spielzeiten (2,85 Ära-Konflikte je Spielzeit,
   * Gruppe 4d). Damit dabei keine Kabine gemessen wird, in der nie jemand
   * aufräumt: Jeder Verein bekommt seinen Streit nach vier Tagen beantwortet,
   * so wie der Spieler es täte. Ohne das stehen die KI-Kabinen sieben
   * Launepunkte schlechter da als die des Spielers, und gemessen wäre ein
   * Verein, den es in einer geführten Karriere nicht gibt.
   */
  const spielzeitErnten = async (seed, aufnahmen) => {
    const s = createNewGame({ clubId: 'hsv', managerName: 'Prüfstand', difficulty: 'profi', seed });
    const gesehen = new Set();
    const echtesError = console.error;
    console.error = () => {};
    try {
      for (let tag = 0; tag < 400; tag++) {
        const res = await advanceDay(s);
        for (const cid in s.clubs) {
          const kb = s.clubs[cid].kabine;
          if (!kb || !kb.konflikte) continue;
          for (const c of kb.konflikte) {
            if (typeof c.id !== 'string' || gesehen.has(c.id) || c.status !== 'offen') continue;
            gesehen.add(c.id);
            if (istAeraKonflikt(s, c) && s.clubs[cid].playerIds.length >= 16) {
              aufnahmen.push({ welt: ausschneiden(s, cid, null), clubId: cid, konfliktId: c.id });
            }
          }
        }
        for (const cid in s.clubs) {
          for (const c of offeneKonflikte(s, cid) || []) {
            if (s.date.day - c.tag < 4) continue;
            konfliktLoesen(s, c.id, istAeraKonflikt(s, c)
              ? (c.tag % 2 ? 'alte_schule' : 'neue_zeit') : 'einzelgespraech');
          }
        }
        if (res.stop === 'saisonende') break;
        if (res.stop === 'spieltag') {
          const fx = res.fixture;
          if (fx.freilos) fx.played = true;
          else {
            const ctx = makeCtx(s);
            try { applyResult(s, fx, simulateAiFixture(s, fx, ctx), ctx); }
            catch { fx.played = true; fx.result = { score: [0, 0], stats: null }; }
          }
        } else if (res.stop === 'entlassung') s.flags.entlassen = false;
        else if (res.stop === 'post') for (const m of s.inbox) if (!m.gelesen) m.gelesen = true;
        try { pokalWeiterlosen(s, makeCtx(s)); } catch { /* Auslosung ist hier Nebensache */ }
      }
    } finally { console.error = echtesError; }
  };

  const t0 = process.hrtime.bigint();
  const aufnahmen = [];
  for (const seed of SAAT) await spielzeitErnten(seed, aufnahmen);
  const tErnte = Number(process.hrtime.bigint() - t0) / 1e6;

  const KADERBILDER = [
    { label: 'echter Kader, unverändert', weg: null },
    { label: 'ohne 4 Legenden', weg: { legenden: 4 } },
    { label: 'ohne 6 Moderne', weg: { moderne: 6 } }
  ];
  const alle = [];
  console.log(`    ${aufnahmen.length} echte Ära-Konflikte aus ${SAAT.length} Spielzeiten geerntet ` +
    `(${round(tErnte / 1000, 1)} s) · Kosten über 120 Tage = Verlust gegenüber „Streit endet ohne Preis"`);
  for (const bild of KADERBILDER) {
    const teil = [];
    for (const a of aufnahmen) {
      const r = messeAufnahme(a, bild.weg);
      if (r) { teil.push(r); alle.push(r); }
    }
    if (!teil.length) { console.log(`    ${bild.label}: keine Messung möglich`); continue; }
    const mw = (weg, key) => round(avg(teil, r => r[weg][key]), 1);
    console.log(`    ${bild.label}  (${teil.length} Läufe, Ø ${round(avg(teil, r => r.kader), 1)} Mann / ` +
      `${round(avg(teil, r => r.legenden), 1)} Legenden, Ø Laune ${round(avg(teil, r => r.laune), 1)})`);
    console.log(`      Der Alte hat recht       Moral ${String(mw('alt', 'moral')).padStart(6)}  ` +
      `Trainer ${String(mw('alt', 'trainer')).padStart(6)}  Teamgeist ${String(mw('alt', 'teamgeist')).padStart(6)}  ` +
      `→ Summe ${String(mw('alt', 'summe')).padStart(6)}`);
    console.log(`      Die Zeiten haben sich …  Moral ${String(mw('neu', 'moral')).padStart(6)}  ` +
      `Trainer ${String(mw('neu', 'trainer')).padStart(6)}  Teamgeist ${String(mw('neu', 'teamgeist')).padStart(6)}  ` +
      `→ Summe ${String(mw('neu', 'summe')).padStart(6)}`);
  }

  /**
   * DIE WICHTIGSTE ZEILE DIESER GRUPPE — und der Grund, aus dem die Balance in
   * zwei Anläufen an der falschen Zahl gemessen wurde:
   *
   * Der Preis beider Wege hängt daran, wie weit die Kabine noch von
   * SCHWELLE_WECHSELWUNSCH (22) entfernt ist. Gemessen (36 bzw. 26 echte
   * Ära-Konflikte beim Verein des Spielers über zwölf Spieljahre):
   *
   *   Kabine ab Ø Laune 46 (so steht der Verein des Spielers da: 44–60)
   *       → beide Wege kosten ungefähr dasselbe.
   *   Kabine unter Ø Laune 46 (dort stehen KI-Vereine, in denen nie jemand
   *       aufräumt) → „Der Alte hat recht" wird doppelt so teuer, weil ein
   *       Abzug von vier Punkten auf dreizehn Köpfe dort Spieler über die
   *       Wechselwunsch-Klippe schiebt, und ein Wechselwunsch heilt nicht.
   *
   * Zugesichert wird deshalb der Korridor für die Lage, in der die Frage
   * tatsächlich gestellt wird — beim Verein des Spielers. Das andere Band steht
   * darunter, damit niemand denkt, es sei übersehen worden: Wer eine Kabine im
   * Keller hat, zahlt für ein Machtwort mehr. Das ist gewollt und heißt in der
   * Praxis: Erst aufräumen, dann Machtwort.
   */
  const BAND = 46;
  const spielerLage = alle.filter(r => r.laune >= BAND);
  const kellerLage = alle.filter(r => r.laune < BAND);
  const A = key => round(avg(alle, r => r.alt[key]), 1);
  const N = key => round(avg(alle, r => r.neu[key]), 1);
  const verh = (a, b) => round(Math.max(a, b) / Math.max(0.001, Math.min(a, b)), 2);
  const median = werte => {
    const a = werte.slice().sort((x, y) => x - y);
    return a.length ? round(a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2, 1) : 0;
  };
  if (kellerLage.length) {
    const kA = key => round(avg(kellerLage, r => r.alt[key]), 1);
    const kN = key => round(avg(kellerLage, r => r.neu[key]), 1);
    console.log(`    ── Kabine schon im Keller (unter Ø Laune ${BAND}): ${kellerLage.length} Läufe, ` +
      `Ø Laune ${round(avg(kellerLage, r => r.laune), 1)} ──`);
    console.log(`      Der Alte hat recht       Moral ${kA('moral')}  Trainer ${kA('trainer')}  Teamgeist ${kA('teamgeist')}  → Summe ${kA('summe')}`);
    console.log(`      Die Zeiten haben sich …  Moral ${kN('moral')}  Trainer ${kN('trainer')}  Teamgeist ${kN('teamgeist')}  → Summe ${kN('summe')}`);
    console.log(`      Verhältnis ${round(Math.max(kA('summe'), kN('summe')) / Math.max(0.001, Math.min(kA('summe'), kN('summe'))), 2)} · ` +
      `zusätzliche Wechselwünsche ${round(avg(kellerLage, r => r.altWeg), 2)} / ${round(avg(kellerLage, r => r.neuWeg), 2)}`);
    /* Auch hier darf kein Weg auf allen vier Achsen der billigere sein — sonst
     * ist die Frage in einer angeschlagenen Kabine keine mehr. */
    const kAchsen = [['Kadermoral', kA('moral'), kN('moral')], ['Trainervertrauen', kA('trainer'), kN('trainer')],
      ['Teamgeist', kA('teamgeist'), kN('teamgeist')],
      ['Ansehen', -avg(kellerLage, r => r.altAnsehen), -avg(kellerLage, r => r.neuAnsehen)]];
    const kAlt = kAchsen.filter(([, a, b]) => a > b).map(x => x[0]);
    const kNeu = kAchsen.filter(([, a, b]) => b > a).map(x => x[0]);
    console.log(`      Teurer alt auf: ${kAlt.join(', ') || '—'} · teurer neu auf: ${kNeu.join(', ') || '—'}`);
    ok(kAlt.length >= 1 && kNeu.length >= 1,
      'Auch in einer angeschlagenen Kabine ist kein Weg auf ALLEN Achsen der billigere',
      `${kAlt.length} : ${kNeu.length}`);
    ok(verh(kA('summe'), kN('summe')) <= 1.40,
      '… und auch dort liegen die Gesamtkosten im 40-%-Korridor',
      `Verhältnis ${verh(kA('summe'), kN('summe'))}`);
  }
  if (spielerLage.length) {
    const sA = key => round(avg(spielerLage, r => r.alt[key]), 1);
    const sN = key => round(avg(spielerLage, r => r.neu[key]), 1);
    console.log(`    ── Lage wie beim Verein des Spielers (ab Ø Laune ${BAND}): ${spielerLage.length} Läufe, ` +
      `Ø Laune ${round(avg(spielerLage, r => r.laune), 1)} ──`);
    console.log(`      Der Alte hat recht       Moral ${sA('moral')}  Trainer ${sA('trainer')}  Teamgeist ${sA('teamgeist')}  → Summe ${sA('summe')}`);
    console.log(`      Die Zeiten haben sich …  Moral ${sN('moral')}  Trainer ${sN('trainer')}  Teamgeist ${sN('teamgeist')}  → Summe ${sN('summe')}`);
    console.log(`      Verhältnis ${verh(sA('summe'), sN('summe'))} · zusätzliche Wechselwünsche ` +
      `${round(avg(spielerLage, r => r.altWeg), 2)} / ${round(avg(spielerLage, r => r.neuWeg), 2)}`);
    ok(verh(sA('summe'), sN('summe')) <= 1.40,
      'In der Lage, in der die Frage gestellt wird, liegen die Kosten im 40-%-Korridor',
      `Verhältnis ${verh(sA('summe'), sN('summe'))} über ${spielerLage.length} Läufe`);
  }
  console.log(`    ── über alle ${alle.length} Läufe ──`);
  const teurer = Math.max(A('summe'), N('summe')), billiger = Math.min(A('summe'), N('summe'));
  const verhaeltnis = round(teurer / Math.max(0.001, billiger), 2);
  const medAlt = median(alle.map(r => r.alt.summe)), medNeu = median(alle.map(r => r.neu.summe));
  const verhaeltnisMed = round(Math.max(medAlt, medNeu) / Math.max(0.001, Math.min(medAlt, medNeu)), 2);
  console.log(`      Der Alte hat recht       Moral ${A('moral')}  Trainer ${A('trainer')}  Teamgeist ${A('teamgeist')}  → Summe ${A('summe')}`);
  console.log(`      Die Zeiten haben sich …  Moral ${N('moral')}  Trainer ${N('trainer')}  Teamgeist ${N('teamgeist')}  → Summe ${N('summe')}`);
  console.log(`      Verhältnis teurer/billiger ${verhaeltnis} (Mittel) / ${verhaeltnisMed} (Median ${medAlt} : ${medNeu}) · ` +
    `Ansehen der Legende ${round(avg(alle, r => r.altAnsehen), 1)} / ${round(avg(alle, r => r.neuAnsehen), 1)}`);
  console.log(`      Sofortige Moraldelle ${round(avg(alle, r => r.altSofort), 2)} / ${round(avg(alle, r => r.neuSofort), 2)} je Kopf · ` +
    `Halbwertszeit ${round(avg(alle, r => r.altHalbwert), 1)} / ${round(avg(alle, r => r.neuHalbwert), 1)} Tage`);
  console.log(`      Zusätzliche Wechselwünsche nach 120 Tagen ${round(avg(alle, r => r.altWeg), 2)} / ${round(avg(alle, r => r.neuWeg), 2)} je Entscheidung`);

  /* Die Nullprobe zuerst: Sie sagt, ob überhaupt gemessen wurde. */
  const nullSumme = round(avg(alle, r => Math.abs(r.null.moral) + Math.abs(r.null.trainer) + Math.abs(r.null.teamgeist)), 4);
  ok(nullSumme === 0,
    'Nullprobe: Ein Zwilling, der nichts entscheidet, kostet exakt nichts', `${nullSumme}`);

  ok(alle.length >= 60 && spielerLage.length >= 20 && kellerLage.length >= 20,
    'Genug echte Ära-Konflikte für eine Aussage, in beiden Lagen',
    `${alle.length} Läufe aus ${aufnahmen.length} Momentaufnahmen (${spielerLage.length} / ${kellerLage.length})`);
  ok(A('summe') > 15 && N('summe') > 15,
    'Beide Wege kosten über 120 Tage messbar etwas', `${A('summe')} / ${N('summe')}`);
  ok(verhaeltnis <= 1.40,
    'Die Gesamtkosten liegen im 40-%-Korridor', `Verhältnis ${verhaeltnis}`);
  ok(verhaeltnisMed <= 1.40,
    '… auch im Median, nicht nur im Mittel über einen langen Schwanz', `Verhältnis ${verhaeltnisMed}`);

  /* Keine Dominanz: Auf vier Achsen (Kadermoral, Trainervertrauen, Teamgeist,
   * Ansehen der Legende) muss jeder Weg mindestens eine verlieren. Sonst ist es
   * keine Entscheidung, sondern eine Formalie — genau der Befund, der diese
   * Arbeit ausgelöst hat. */
  const achsen = [
    ['Kadermoral', A('moral'), N('moral')],
    ['Trainervertrauen', A('trainer'), N('trainer')],
    ['Teamgeist', A('teamgeist'), N('teamgeist')],
    ['Ansehen der Legende', -avg(alle, r => r.altAnsehen), -avg(alle, r => r.neuAnsehen)]
  ];
  const altTeurerAuf = achsen.filter(([, a, b]) => a > b).map(([n]) => n);
  const neuTeurerAuf = achsen.filter(([, a, b]) => b > a).map(([n]) => n);
  console.log(`      Teurer ist „Der Alte hat recht" auf: ${altTeurerAuf.join(', ') || '—'}`);
  console.log(`      Teurer ist „Die Zeiten …" auf:       ${neuTeurerAuf.join(', ') || '—'}`);
  ok(altTeurerAuf.length >= 1 && neuTeurerAuf.length >= 1,
    'Kein Weg ist auf ALLEN Achsen der billigere', `${altTeurerAuf.length} : ${neuTeurerAuf.length}`);
  ok(altTeurerAuf.includes('Kadermoral'),
    '„Der Alte hat recht" ist der teurere in der Währung Laune — breit');
  ok(neuTeurerAuf.includes('Trainervertrauen') && neuTeurerAuf.includes('Ansehen der Legende'),
    '„Die Zeiten …" ist der teurere in den Währungen, die monatelang nachhallen');

  /* Der Zuschnitt: breit und kurz gegen schmal und lang. */
  ok(avg(alle, r => r.altSofort) > avg(alle, r => r.neuSofort) + 1.2,
    '„Der Alte hat recht" schlägt sofort auf die Kaderstimmung durch — vor dem Wochenende',
    `${round(avg(alle, r => r.altSofort), 2)} vs ${round(avg(alle, r => r.neuSofort), 2)} Punkte je Kopf`);
  ok(avg(alle, r => r.altHalbwert) <= 12,
    '… und ist nach zwei Wochen halb vergessen',
    `${round(avg(alle, r => r.altHalbwert), 1)} Tage`);
  ok(avg(alle, r => r.neuHalbwert) >= avg(alle, r => r.altHalbwert) * 2,
    '„Die Zeiten …" hallt dagegen ein Mehrfaches länger nach',
    `${round(avg(alle, r => r.neuHalbwert), 1)} vs ${round(avg(alle, r => r.altHalbwert), 1)} Tage`);

  /* Der Preis, an dem Anlauf 2 gescheitert ist: „breit und kurz" darf nicht
   * heißen, dass nach jeder zweiten Entscheidung jemand um seine Freigabe
   * bittet. Ein Wechselwunsch heilt nicht von selbst — er ist das Gegenteil
   * von kurz. Gemessen wurde 1,19 je Entscheidung, bevor AERA_MODERN_LAUNE von
   * −7,0 auf −4,0 ging. */
  ok(avg(alle, r => r.altWeg) < 0.8,
    'Ein Machtwort für die Legende treibt nicht den halben Kader zum Berater',
    `${round(avg(alle, r => r.altWeg), 2)} zusätzliche Wechselwünsche je Entscheidung`);

  /* Und der Punkt, um den es eigentlich geht: In welcher Lage welcher Weg
   * billiger ist, darf nicht vorher feststehen. */
  const altBilliger = alle.filter(r => r.alt.summe < r.neu.summe).length;
  console.log(`      Einzelläufe: „Der Alte hat recht" war ${altBilliger}× billiger, ` +
    `„Die Zeiten …" ${alle.length - altBilliger}×`);
  ok(altBilliger >= alle.length * 0.3 && alle.length - altBilliger >= alle.length * 0.3,
    'Welcher Weg billiger ist, entscheidet die Lage — nicht die Tabelle',
    `${altBilliger} : ${alle.length - altBilliger}`);
}

/* ================================================================== *
 *  4d. Wie oft stellt sich diese Frage überhaupt?
 *
 *  Die Abnahme von Abschnitt 8 kam auf 0,38 ära-übergreifende Konflikte je
 *  Spielzeit beim Verein des Spielers — alle zweieinhalb Jahre einer. Die
 *  Ursache war NICHT die Gewichtung, sondern eine Sperre, die nie wieder
 *  aufging: Ein Streit, den niemand beantwortet, eskalierte auf Schwere 3 und
 *  blieb dann für immer offen. Nach vier davon verbot KONFLIKT_MAX_OFFEN jeden
 *  weiteren — dauerhaft. Wer nie in die Kabine geht (und kein Prüfstand tut
 *  das), sah danach nie wieder einen Streit.
 *
 *  Geprüft wird deshalb BEIDE Spielweisen: der Manager, der jeden Streit
 *  beantwortet, und der, der nie hingeht. In beiden muss der Korridor halten.
 *
 *  WORAN DIESE ZAHL HÄNGT — und warum darunter der Teamgeist mitgeprüft wird:
 *  Die Auslöserate ist nicht KONFLIKT_CHANCE_SPIELER, sondern
 *  `basis × (1 + (60 − Teamgeist)/40) × Lagerfaktor`. Eine Kabine bei 73 würfelt
 *  mit 68 % der Grundrate, eine bei 55 mit 113 % — Faktor 1,7 zwischen zwei
 *  Vereinen, die dieselbe Konstante lesen. Ein Kunstkader ohne Verletzte, ohne
 *  auslaufende Verträge und ohne Wechselwünsche ist deutlich zufriedener als
 *  jeder echte Verein und meldet entsprechend weniger Streit. Deshalb bekommt
 *  der Kader dieser Gruppe (und nur dieser) dieselben Dauerbaustellen wie ein
 *  echter: drei Verletzte, vier Verträge in der Endphase, ein Wechselwunsch.
 *
 *  KALIBRIERT ist die Gruppe an der echten Karriere, nicht an sich selbst:
 *  HSV, Profi, Seeds 3/7/11/23, acht Spielzeiten im vollen Tagesablauf
 *  (createNewGame + advanceDay + Spiele) ergaben 2,85 ära-übergreifende
 *  Konflikte je Spielzeit bei 9,2 Konflikten insgesamt — Ø Teamgeist 48 bis 63.
 *  Was dieser Prüfstand messen kann, muss in derselben Größenordnung liegen;
 *  weicht der Teamgeist aus dem Band 45–70, ist die Zahl unten nicht mehr die
 *  Zahl des Spiels, und die Zusicherung sagt es.
 * ================================================================== */
gruppe('4d. Häufigkeit: 1,5 bis 4 Ära-Konflikte je Spielzeit');
{
  /**
   * Eine Spielzeit (365 Tage) im Tagesablauf. `loesen` = der Manager beantwortet
   * jeden Streit nach vier Tagen, so wie ein Spieler es täte.
   * -> { gesamt, aera, teamgeist }
   */
  const saisonZaehlen = (seed, loesen) => {
    const s = baueState(seed, 24, 0.42);
    s.date.day = 1;
    echteBaustellen(s, 'traum');
    echteBaustellen(s, 'rivale');
    const gesehen = new Set();
    let gesamt = 0, aera = 0, tgSumme = 0;
    for (let tag = 1; tag < 365; tag++) {
      tickMoral(s, ctxFor(s, s.date.day));
      tgSumme += s.clubs.traum.kabine.teamgeist;
      for (const c of s.clubs.traum.kabine.konflikte) {
        if (gesehen.has(c.id)) continue;
        gesehen.add(c.id);
        gesamt++;
        if (istAeraKonflikt(s, c)) aera++;
      }
      if (loesen) {
        for (const c of offeneKonflikte(s, 'traum') || []) {
          if (s.date.day - c.tag < 4) continue;
          const weg = istAeraKonflikt(s, c)
            ? (c.tag % 2 ? 'alte_schule' : 'neue_zeit')
            : 'einzelgespraech';
          konfliktLoesen(s, c.id, weg);
        }
      }
      // Ein Spieltag je Woche, damit die Stimmung nicht im Nichts hängt.
      if (tag % 7 === 3) {
        const erg = tag % 21 === 3 ? 'N' : tag % 14 === 3 ? 'U' : 'S';
        for (const cid of ['traum', 'rivale']) {
          const c = s.clubs[cid];
          c.season.letzteErgebnisse.push(cid === 'traum' ? erg : (erg === 'S' ? 'N' : erg === 'N' ? 'S' : 'U'));
          if (c.season.letzteErgebnisse.length > 5) c.season.letzteErgebnisse.shift();
        }
      }
      s.date.day++; s.tick++;
    }
    return { gesamt, aera, teamgeist: tgSumme / 364 };
  };

  /**
   * Was dieser Prüfstand messen kann, ist nicht ganz das, was das Spiel liefert:
   * Ein Kader ohne Presse, ohne Transfermarkt, ohne heilende und neu entstehende
   * Verletzungen hat weniger Streitanlässe als ein echter. Gemessen am 30.07. in
   * beiden Ständen mit demselben Zähler:
   *
   *   volle Karriere (HSV, Profi, Seeds 3/7/11/23, 8 Spielzeiten,
   *     createNewGame + advanceDay + Spiele):  9,22 Konflikte, davon 2,85 Ära
   *   dieser Prüfstand (8 Seeds, 364 Tage):    4,13 Konflikte, davon 1,25 Ära
   *
   * Der Faktor ist 2,2 und trägt beide Zahlen: 1,25 × 2,2 = 2,8 (Spiel: 2,85)
   * und 4,13 × 2,2 = 9,1 (Spiel: 9,22). Dass eine einzige Zahl auf Ära-Streit
   * UND Gesamtstreit passt, ist der Beleg, dass hier eine Rate skaliert wird und
   * nicht eine Zahl zurechtgebogen.
   *
   * NACHGEMESSEN IN DER ABNAHME, unabhängig und mit einem eigenen Aufbau (HSV,
   * Profi, ACHT Seeds 3/7/11/23/42/101/555/999, je fünf Spielzeiten, voller
   * Tagesablauf): 3,08 Ära-Konflikte und 9,03 Konflikte je Spielzeit, wenn der
   * Manager antwortet; 2,55 bzw. 7,87, wenn er aussitzt. Der Faktor, der DIESE
   * Zahlen tragen würde, liegt bei 2,5 (geführt) bzw. 1,7 (ausgesessen) — 2,2
   * liegt dazwischen und bleibt deshalb stehen. Die Spanne über die Seeds ist
   * 1,6 bis 4,8 (geführt) bzw. 2,0 bis 3,6 (ausgesessen); der Korridor unten
   * prüft das MITTEL des Spiels, nicht die einzelne Karriere. Wer eine einzelne
   * Karriere garantiert im Korridor haben will, braucht eine Rückkopplung, die
   * es hier nicht gibt.
   *
   * Der Faktor daraus steht hier als Zahl und nicht als Kommentar, damit die
   * Zusicherung den Korridor des SPIELS prüft und nicht den des Prüfstands.
   * Wer die Auslöserate verdoppelt, verdoppelt beides — die Zusicherung fällt.
   * Wer den Faktor nachziehen will, muss die Messung am Spiel wiederholen; sie
   * steht in derselben Form im Bericht zur Ära-Balance.
   */
  const KALIBRIERUNG = 2.2;
  const SEEDS_4D = [51001, 51997, 52999, 53993, 54987, 55981, 56993, 57991];

  for (const [label, loesen, kurz] of [['Manager beantwortet jeden Streit', true, 'geführt'],
    ['Manager sitzt alles aus', false, 'ausgesessen']]) {
    const laeufe = SEEDS_4D.map(seed => saisonZaehlen(seed, loesen));
    const aera = round(avg(laeufe, l => l.aera), 2);
    const gesamt = round(avg(laeufe, l => l.gesamt), 2);
    const tg = round(avg(laeufe, l => l.teamgeist), 1);
    const imSpiel = round(aera * KALIBRIERUNG, 2);
    console.log(`    ${label}: ${gesamt} Konflikte je Spielzeit, davon ${aera} ära-übergreifend ` +
      `(${round(aera / Math.max(1, gesamt) * 100, 1)} %) · einzeln: ${laeufe.map(l => l.aera).join('/')} · Ø Teamgeist ${tg}`);
    console.log(`      → im Spiel (× ${KALIBRIERUNG}): ${imSpiel} Ära-Konflikte und ` +
      `${round(gesamt * KALIBRIERUNG, 1)} Konflikte je Spielzeit`);
    ok(imSpiel >= 1.5 && imSpiel <= 4.0,
      `Ära-Konflikte je Spielzeit im Korridor 1,5–4 (${kurz})`, `${imSpiel} hochgerechnet`);
    ok(gesamt * KALIBRIERUNG <= 20,
      `Die Gesamtzahl bleibt beherrschbar (${kurz})`, `${round(gesamt * KALIBRIERUNG, 1)} je Spielzeit`);
    ok(aera / Math.max(1, gesamt) >= 0.15,
      `Ära-Streit ist ein spürbarer Anteil am Kabinenstreit (${kurz})`,
      `${round(aera / Math.max(1, gesamt) * 100, 1)} %`);
    /* Der wichtigste Wert dieser Gruppe ist nicht die Zahl, sondern die Lage, in
     * der sie gemessen wurde. Die Auslöserate hängt über
     * `stimmungsFaktor = 1 + (60 − Teamgeist)/40` unmittelbar am Teamgeist: Eine
     * Kabine bei 84 würfelt nur mit 40 % der Grundrate, eine bei 44 mit 140 %.
     * Ein Kunstkader, dem es zu gut geht, meldet deshalb weniger Streit als jeder
     * echte Verein — dann stimmt der Faktor oben nicht mehr, und der Korridor
     * wäre eine Zahl über einen Verein, den es im Spiel nicht gibt. Das Band ist
     * an sechs echten Karrieren abgelesen (HSV, Seeds 3/7/11/23/42/101:
     * Ø Teamgeist 48 bis 63). Nach oben lassen wir 70 zu, weil dem Kunstkader
     * die dauernd wechselnden Verletzten und der Transfermarkt fehlen. */
    ok(tg >= 45 && tg <= 70,
      `Gemessen in einer Kabine wie im echten Spiel, nicht in einer Musterkabine (${kurz})`,
      `Ø Teamgeist ${tg}, Band 45–70`);
  }

  /* Die Sperre, die nie wieder aufging: Ein ignorierter Streit muss irgendwann
   * einschlafen, sonst versiegelt er die Kabine für den Rest der Karriere. */
  {
    const s = baueState(54321, 24, 0.42);
    s.date.day = 1;
    konflikt(s, 'traum', ctxFor(s, 1));
    const c = s.clubs.traum.kabine.konflikte[0];
    simuliere(s, 40, null);
    const nach40 = c.status;
    const schwereNach40 = c.schwere;
    simuliere(s, 90, null);
    const insgesamt = s.clubs.traum.kabine.konflikte.length;
    console.log(`    Ausgesessener Streit: Schwere ${schwereNach40} nach 40 Tagen, ` +
      `Status nach 130 Tagen „${c.status}" · ${insgesamt} Streitigkeiten insgesamt entstanden`);
    ok(nach40 === 'offen' && schwereNach40 === 3,
      'Aussitzen eskaliert den Streit erst auf die höchste Stufe');
    ok(c.status === 'geloest',
      'Und danach schläft er ein, statt die Kabine für immer zu sperren', c.status);
    /* Der eigentliche Beweis: Ohne die Verjährung stünden nach 130 Tagen genau
     * vier Streitigkeiten in den Büchern — für immer, denn KONFLIKT_MAX_OFFEN
     * hätte jeden weiteren verboten. Dass es mehr als vier geworden sind, heißt:
     * die Kabine atmet wieder. */
    ok(insgesamt > 4,
      'Die Kabine bleibt in Bewegung, statt bei vier Streitigkeiten zu versiegeln',
      `${insgesamt} entstanden`);
  }
}

/* ================================================================== *
 *  5. Gespräche, Ansprachen, Hierarchie, Bericht
 * ================================================================== */
gruppe('5. Gespräche');
{
  const state = baueState(8888);
  const pid = state.clubs.traum.playerIds[7];

  for (const thema of Object.keys(GESPRAECHS_THEMEN)) {
    const g = gespraech(state, pid, thema);
    const gut = g.optionen.length >= 2 &&
      g.optionen.every(o => typeof o.text === 'string' && o.text.length > 5 &&
        typeof o.wirkung === 'number' && o.risiko >= 0 && o.risiko <= 1);
    ok(gut, `Thema "${thema}" liefert brauchbare Optionen`);
  }
  ok(!gespraech(state, pid, 'wetter').ok, 'Unbekanntes Thema wird abgelehnt');
  ok(!gespraech(state, 'p_gibtsnicht', 'form').ok, 'Unbekannter Spieler wird abgelehnt');

  // Durchführung verändert die Moral und sperrt kurzzeitig
  const vorher = state.players[pid].morale;
  const g1 = gespraech(state, pid, 'leistung_lob');
  const r1 = gespraechFuehren(state, pid, 'leistung_lob', g1.optionen[0].id);
  ok(r1.ok && ['gelungen', 'neutral', 'daneben'].includes(r1.ergebnis), 'Gespräch liefert einen Ausgang');
  ok(state.players[pid].morale !== vorher, 'Das Gespräch verändert die Moral');
  ok(!gespraechFuehren(state, pid, 'leistung_lob', g1.optionen[0].id).ok,
    'Dasselbe Thema lässt sich nicht sofort wiederholen');

  // Lob hebt im Mittel, harte Kritik ist riskanter
  let lobSumme = 0, kritikSumme = 0;
  for (let i = 0; i < 200; i++) {
    const s = baueState(9000 + i);
    const id = s.clubs.traum.playerIds[5];
    const a = s.players[id].morale;
    gespraechFuehren(s, id, 'leistung_lob', 'ehrlich');
    lobSumme += s.players[id].morale - a;

    const s2 = baueState(9000 + i);
    const id2 = s2.clubs.traum.playerIds[5];
    const b = s2.players[id2].morale;
    gespraechFuehren(s2, id2, 'leistung_kritik', 'deutlich');
    kritikSumme += s2.players[id2].morale - b;
  }
  console.log(`    Ø Lob: ${round(lobSumme / 200, 2)} | Ø harte Kritik: ${round(kritikSumme / 200, 2)}`);
  ok(lobSumme / 200 > 1.5, 'Ehrliches Lob hebt die Moral im Mittel');
  ok(lobSumme > kritikSumme, 'Harte Kritik ist im Mittel weniger einträglich als Lob');

  // Wechselwunsch lässt sich abwenden
  const s3 = baueState(9500);
  const id3 = s3.clubs.traum.playerIds[6];
  s3.players[id3].transfer.wunschWechsel = true;
  let abgewendet = 0;
  for (let i = 0; i < 60; i++) {
    const s = baueState(9600 + i);
    const id = s.clubs.traum.playerIds[6];
    s.players[id].transfer.wunschWechsel = true;
    gespraechFuehren(s, id, 'wechselwunsch', 'umstimmen');
    if (!s.players[id].transfer.wunschWechsel) abgewendet++;
  }
  ok(abgewendet > 20 && abgewendet < 60, 'Wechselwünsche lassen sich manchmal, nicht immer abwenden', `${abgewendet}/60`);
}

gruppe('6. Ansprachen');
{
  const state = baueState(10101);

  for (const art of Object.keys(ANSPRACHE_ARTEN)) {
    for (const zp of ['vorspiel', 'halbzeit', 'nachspiel']) {
      const s = baueState(10101);
      const r = ansprache(s, 'traum', zp, art, { stand: [0, 1], gegnerId: 'rivale' });
      const gut = r.ok && typeof r.text === 'string' && r.text.length > 25 &&
        typeof r.teamMoralDelta === 'number' && Object.keys(r.wirkung).length > 10;
      ok(gut, `Ansprache "${art}" / ${zp} liefert Text und Wirkung`);
    }
  }
  ok(!ansprache(state, 'traum', 'halbzeit', 'singen').ok, 'Unbekannte Ansprache-Art wird abgelehnt');

  // Die Lage entscheidet: Wut bei Rückstand gegen einen Kleinen vs. Führung gegen den Großen
  const gegenKlein = baueState(10202);
  gegenKlein.clubs.rivale.reputation = 40;      // wir sind klarer Favorit
  const wutRueckstand = ansprache(gegenKlein, 'traum', 'halbzeit', 'wuetend',
    { stand: [0, 1], gegnerId: 'rivale' });

  const gegenGross = baueState(10202);
  gegenGross.clubs.rivale.reputation = 97;      // Übermacht
  const wutFuehrung = ansprache(gegenGross, 'traum', 'halbzeit', 'wuetend',
    { stand: [1, 0], gegnerId: 'rivale' });

  console.log(`    Wut bei 0:1 gegen den Kleinen: Passung ${wutRueckstand.passung}, Δ ${wutRueckstand.teamMoralDelta}`);
  console.log(`    Wut bei 1:0 gegen den Großen: Passung ${wutFuehrung.passung}, Δ ${wutFuehrung.teamMoralDelta}`);
  ok(wutRueckstand.passung > 0.4, 'Wut zündet beim Rückstand gegen einen Kleinen');
  ok(wutFuehrung.passung < 0, 'Dieselbe Wut bei Führung gegen einen Großen geht nach hinten los');
  ok(wutRueckstand.teamMoralDelta > wutFuehrung.teamMoralDelta + 3, 'Der Unterschied ist auch in der Moral messbar');

  const aufbauendGegenGross = ansprache(baueState(10202), 'traum', 'halbzeit', 'aufbauend',
    { stand: [0, 2], gegnerId: 'rivale' });
  ok(aufbauendGegenGross.passung > 0.3, 'Aufbauende Worte passen bei Rückstand');

  const ruhigBeiFuehrung = ansprache(baueState(10202), 'traum', 'halbzeit', 'ruhig',
    { stand: [2, 0], gegnerId: 'rivale' });
  ok(ruhigBeiFuehrung.passung > 0.4, 'Ruhig ist die richtige Wahl bei Führung');

  // Persönlichkeiten reagieren unterschiedlich auf dieselbe Ansprache
  const s = baueState(10303);
  const r = ansprache(s, 'traum', 'halbzeit', 'wuetend', { stand: [0, 1], gegnerId: 'rivale' });
  const deltas = Object.values(r.wirkung);
  ok(new Set(deltas.map(d => Math.round(d * 10))).size > 3,
    'Dieselben Worte wirken bei verschiedenen Charakteren verschieden');
}

gruppe('7. Hierarchie, Teamgeist, Beziehungen, Bericht');
{
  const state = baueState(11111);
  simuliere(state, 20, (tag, i) => (i % 7 === 3 ? 'S' : null));

  const h = hierarchie(state, 'traum');
  ok(h.length === state.clubs.traum.playerIds.length, 'Hierarchie enthält den ganzen Kader');
  ok(h.every(e => e.einfluss >= 0 && e.einfluss <= 100), 'Einfluss liegt in 0..100');
  ok(h.every((e, i) => i === 0 || h[i - 1].einfluss >= e.einfluss), 'Hierarchie ist absteigend sortiert');
  ok(h.filter(e => e.rang === 'kapitaen').length === 1, 'Genau ein Kapitän');
  ok(h.some(e => e.rang === 'fuehrungsspieler') && h.some(e => e.rang === 'mitlaeufer'),
    'Führungsspieler und Mitläufer werden unterschieden');
  ok(h[0].gruende.length > 0, 'Der Einflussreichste hat Begründungen', h[0].gruende.join(', '));

  const tg = teamGeist(state, 'traum');
  ok(tg.wert >= 0 && tg.wert <= 100, 'Teamgeist liegt in 0..100', String(tg.wert));
  ok(typeof tg.text === 'string' && tg.text.length > 20, 'Teamgeist hat einen deutschen Text');
  ok(Array.isArray(tg.cliquen), 'Cliquen werden geliefert');

  const bez = beziehungen(state, 'traum');
  ok(Array.isArray(bez.paare) && bez.paare.length > 0, 'Es gibt Freundschaften bzw. Rivalitäten');
  ok(bez.paare.every(p => p.wert >= -100 && p.wert <= 100 && p.text.length > 10),
    'Beziehungen haben Wert und Text');
  ok(Object.keys(bez.byPlayer).length === state.clubs.traum.playerIds.length,
    'Jeder Spieler hat einen Beziehungseintrag');
  // Landsleute mögen sich tendenziell
  const franzosen = state.clubs.traum.playerIds.map(id => state.players[id]).filter(p => p.nationality === 'FR');
  const franzPaar = bez.paare.find(p =>
    franzosen.some(f => f.id === p.a) && franzosen.some(f => f.id === p.b) && p.art === 'freundschaft');
  ok(!!franzPaar, 'Landsleute halten zusammen');

  const rat = mannschaftsrat(state, 'traum');
  ok(rat.mitglieder.length >= 3 && rat.text.length > 20, 'Mannschaftsrat wird gebildet');

  // Kapitänswechsel
  const altKap = state.clubs.traum.playerIds.map(i => state.players[i]).find(p => p.captain);
  const neuer = h.find(e => e.playerId !== altKap.id && e.rang === 'fuehrungsspieler');
  const altMoral = altKap.morale;
  const kr = kapitaenBestimmen(state, 'traum', neuer.playerId);
  ok(kr.ok && state.players[neuer.playerId].captain && !altKap.captain, 'Kapitänswechsel funktioniert');
  ok(altKap.morale < altMoral, 'Der entmachtete Kapitän ist beleidigt');
  ok(state.clubs.traum.tactics.setPieces.kapitaen === neuer.playerId, 'Die Binde steht auch in der Taktik');
  ok(!kapitaenBestimmen(state, 'traum', neuer.playerId).ok, 'Doppelte Ernennung wird abgelehnt');
  ok(!kapitaenBestimmen(state, 'traum', state.clubs.rivale.playerIds[0]).ok, 'Fremder Spieler wird abgelehnt');

  const b = kabinenBericht(state, 'traum');
  ok(Array.isArray(b.zeilen) && b.zeilen.length >= 5, 'Kabinenbericht liefert mehrere Zeilen');
  ok(b.text.includes('Teamgeist'), 'Der Bericht nennt den Teamgeist');
  ok(typeof b.kapitaen === 'string', 'Der Bericht nennt den Kapitän');
  console.log('    ── Auszug Kabinenbericht ──');
  for (const z of b.zeilen.slice(0, 6)) console.log('    ' + z);

  // Nebeneingänge
  const someId = state.clubs.traum.playerIds[9];
  const vor = state.players[someId].morale;
  moralAendern(state, someId, -15, 'Testgrund');
  ok(state.players[someId].morale < vor, 'moralAendern() wirkt');
  const teamVor = kaderMoral(state, 'traum');
  teamMoralAendern(state, 'traum', 5, 'Meisterschaft');
  ok(kaderMoral(state, 'traum') > teamVor, 'teamMoralAendern() wirkt');
}

/* ================================================================== *
 *  8. Ereignisse & Determinismus
 * ================================================================== */
gruppe('8. Ereignisse im Postfach');
{
  const state = baueState(12121);
  // Ein Kader unter Dauerbeschuss: kein Sieg, Reservisten, Streit
  const kader = state.clubs.traum.playerIds.map(id => state.players[id]);
  for (const p of kader) { p.stats.season.minuten = 0; p.contract.until = 1; }
  kader[0].stats.season.minuten = 3000;
  const { logs, news } = simuliere(state, 120, (tag, i) => (i % 7 === 3 ? 'N' : null));

  const arten = logs.map(l => l.o && l.o.subject).filter(Boolean);
  console.log(`    ${logs.length} Postfach-Nachrichten, ${news.length} Kurzmeldungen`);
  console.log('    Beispiele:', arten.slice(0, 5).join(' / '));
  ok(logs.length > 3, 'Es entstehen Postfach-Nachrichten');
  ok(logs.every(l => typeof l.text === 'string' && l.text.length > 20), 'Alle Nachrichten haben deutschen Text');
  ok(arten.some(a => /Beschwerde/i.test(a)), 'Beschwerden werden gemeldet', arten.join(' | '));
  ok(kader.some(p => p.transfer.wunschWechsel), 'Frustrierte Spieler äußern Wechselwünsche');
  ok(kader.some(p => p.happiness.beschwerden.length > 0), 'Beschwerden landen im Spielerprofil');

  // Nur der Manager-Verein bekommt Post
  const alleTexte = logs.map(l => l.text).join(' ');
  const rivaleNamen = state.clubs.rivale.playerIds.map(id => state.players[id].lastName);
  ok(!rivaleNamen.some(n => alleTexte.includes(n)), 'Über KI-Vereine wird nicht ins Postfach berichtet');
}

gruppe('9. Determinismus & Robustheit');
{
  const a = baueState(13131);
  const b = baueState(13131);
  simuliere(a, 60, (tag, i) => (i % 7 === 3 ? (i % 3 ? 'S' : 'N') : null));
  simuliere(b, 60, (tag, i) => (i % 7 === 3 ? (i % 3 ? 'S' : 'N') : null));

  const dump = s => JSON.stringify(Object.keys(s.clubs).sort().map(c => ({
    moral: s.clubs[c].moral,
    tg: round(teamGeist(s, c).wert, 1),
    konflikte: s.clubs[c].kabine.konflikte.map(k => k.art + ':' + k.status),
    spieler: s.clubs[c].playerIds.map(id => s.players[id].morale)
  })));
  ok(dump(a) === dump(b), 'Gleicher Seed ⇒ identischer Verlauf');

  const c = baueState(14141);
  simuliere(c, 40, (tag, i) => (i % 7 === 3 ? 'S' : null));
  ok(dump(a) !== dump(c), 'Verschiedene Seeds ⇒ verschiedene Verläufe');

  // Kein Math.random / Date.now im CODE (Kommentare dürfen die Regel nennen)
  const roh_quelle = await import('node:fs').then(fs =>
    fs.readFileSync(new URL('../src/club/morale.js', import.meta.url), 'utf8'));
  const quelle = roh_quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/Math\.random/.test(quelle), 'Kein Math.random() in morale.js');
  ok(!/Date\.now/.test(quelle), 'Kein Date.now() in morale.js');
  ok(!/document\.|window\.|localStorage/.test(quelle), 'Kein DOM-Zugriff in morale.js');

  // Robustheit gegen unvollständige Daten
  const roh = baueState(15151);
  delete roh.clubs.traum.tactics;
  delete roh.clubs.traum.season;
  for (const id of roh.clubs.traum.playerIds) {
    delete roh.players[id].happiness;
    delete roh.players[id].personality;
    delete roh.players[id].transfer;
  }
  let geworfen = null;
  try {
    // ohne Taktik, ohne Saisondaten, ohne happiness/personality/transfer
    for (let i = 0; i < 10; i++) {
      tickMoral(roh, ctxFor(roh, roh.date.day));
      roh.date.day++; roh.tick++;
    }
    // und einmal komplett ohne date-Feld im Kontext
    tickMoral(roh, { rng: createRng(1), log: () => {}, news: () => {} });
  } catch (e) { geworfen = e; }
  ok(!geworfen, 'tickMoral() überlebt unvollständige Datensätze', geworfen ? geworfen.message : '');
  ok(!moralWert(roh, 'p_gibtsnicht').gruende.length === false, 'moralWert() für Unbekannte wirft nicht');
  ok(teamGeist(roh, 'gibtsnicht').wert === 50, 'teamGeist() für unbekannten Verein liefert Fallback');
  ok(hierarchie(roh, 'gibtsnicht').length === 0, 'hierarchie() für unbekannten Verein liefert []');
  ok(moralEffektAufLeistung(roh, 'p_gibtsnicht') === 1, 'moralEffektAufLeistung() für Unbekannte = 1');
}

/* ================================================================== *
 *  Performance
 * ================================================================== */
gruppe('10. Rechenaufwand');
{
  // 36 Vereine × 365 Tage müssen laufen, ohne dass der Rechner schwitzt.
  const gross = baueState(16161);
  for (let i = 0; i < 34; i++) {
    const id = 'ki' + i;
    const club = baueClub(id, 'KI' + i, 45 + (i % 40));
    gross.clubs[id] = club;
    for (const p of baueKader(id, 20000 + i, 60)) { gross.players[p.id] = p; club.playerIds.push(p.id); }
    const elf = club.playerIds.map(x => gross.players[x]).slice(0, 11);
    elf.forEach((p, n) => { club.tactics.lineup['s' + (n + 1)] = p.id; });
  }
  const t0 = process.hrtime.bigint();
  simuliere(gross, 100, (tag, i) => (i % 7 === 3 ? 'S' : null));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const saison = ms / 100 * 365;
  console.log(`    36 Vereine × 100 Tage: ${Math.round(ms)} ms (${round(ms / 100, 2)} ms/Tag) ` +
    `→ ${round(saison / 1000, 2)} s je Spielzeit`);
  ok(ms / 100 < 60, 'Ein Spieltag kostet unter 60 ms bei 36 Vereinen', `${round(ms / 100, 2)} ms`);
  /* Die Ära-Balance hat an den Konfliktraten gedreht (KONFLIKT_CHANCE_SPIELER
   * 0,055 → 0,018, KONFLIKT_CHANCE_KI 0,010 → 0,003) und mit
   * KONFLIKT_VERJAEHRUNG_TAGE eine Sperre gelöst, die vorher jede Kabine nach
   * vier Streitigkeiten stillgelegt hat. Weniger Streit ist billiger, nicht
   * teurer: Am echten Tagesablauf gemessen (eine Spielzeit HSV/Profi/Seed 7, je
   * Vereinsmodul gestoppt) kostet morale.js 4,78 s je Spielzeit gegen 5,00 s
   * davor — 53 % des ganzen Tagesablaufs (9,06 s gegen 9,32 s), unverändert der
   * teuerste Posten. Hier steht die Obergrenze für den Kunstkader, damit ein Rückschritt
   * auffällt, bevor er im Spiel auffällt. */
  ok(saison < 12000, 'Eine Spielzeit Kabine bleibt unter 12 s', `${round(saison / 1000, 2)} s`);
}

/* ------------------------------------------------------------------ */
console.log('\n' + '═'.repeat(66));
console.log(`  ${bestanden} bestanden, ${gescheitert} gescheitert`);
if (gescheitert) {
  console.log('\n  Fehlgeschlagen:');
  for (const f of fehler) console.log('   • ' + f);
  process.exit(1);
}
console.log('  Die Kabine ist in Ordnung.');
console.log('═'.repeat(66));
