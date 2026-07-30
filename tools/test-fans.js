/**
 * Smoke-Test für src/club/fans.js
 *
 *   node tools/test-fans.js
 *
 * Prüft vor allem die beiden geforderten Kernaussagen:
 *   A) Eine Siegserie hebt die Stimmung messbar, eine Niederlagenserie senkt sie.
 *   B) Ticketpreiserhöhungen senken die Stimmung messbar.
 *
 * Zusätzlich: Heimvorteil-Grenzen, Legendenverkauf, Ultras/Choreo, Fanaktionen
 * und ihre Reaktionen, Merchandising-Größenordnung, Mitgliederversammlung und
 * Determinismus (gleicher Seed -> gleicher Verlauf).
 *
 * HINWEIS: core/state.js kann derzeit nicht importiert werden, weil
 * src/data/squads/index.js und src/data/generator.js noch fehlen (andere Module
 * im Bau). Der Test baut den State deshalb selbst — mit exakt den Feldern, die
 * initClubRuntime()/initPlayerRuntime() anlegen. Sobald state.js importierbar
 * ist, sollte dieser Test auf createNewGame() umgestellt werden.
 */

import { CLUBS } from '../src/data/clubs.js';
import { players as g1 } from '../src/data/squads/gruppe1.js';
import { players as g2 } from '../src/data/squads/gruppe2.js';
import { players as g3 } from '../src/data/squads/gruppe3.js';
import { players as g4 } from '../src/data/squads/gruppe4.js';
import { players as g5 } from '../src/data/squads/gruppe5.js';
import { players as g6 } from '../src/data/squads/gruppe6.js';
import { defaultTactics } from '../src/engine/tactics.js';
import { createRng } from '../src/core/rng.js';
import { clamp, deepClone, dateFromDayIndex, round } from '../src/core/util.js';
import { DIFFICULTIES } from '../src/core/constants.js';

import {
  tickFans, stimmung, mitgliederEntwicklung, ultras, choreoAnfrage,
  fanaktion, fanaktionAnwenden, heimvorteil, merchandising, fanbeliebtheit,
  boykottRisiko, mitgliederversammlung, fanUebersicht, rivalitaet
} from '../src/club/fans.js';

/* ------------------------------------------------------------------ *
 *  Mini-Testgerüst
 * ------------------------------------------------------------------ */

let ok = 0, fail = 0;
const fehler = [];

function pruefe(bedingung, name, detail) {
  if (bedingung) { ok++; console.log('  [ok]   ' + name); }
  else { fail++; fehler.push(name + (detail ? '  -> ' + detail : '')); console.log('  [FEHL] ' + name + (detail ? '  -> ' + detail : '')); }
}

function nahe(a, b, toleranz, name) {
  pruefe(Math.abs(a - b) <= toleranz, name, `${round(a, 3)} vs ${round(b, 3)} (Toleranz ${toleranz})`);
}

function abschnitt(titel) { console.log('\n=== ' + titel + ' ==='); }

/* ------------------------------------------------------------------ *
 *  Test-State (Nachbau von core/state.js initClubRuntime/initPlayerRuntime)
 * ------------------------------------------------------------------ */

const ALLE_SPIELER = [].concat(g1, g2, g3, g4, g5, g6);

function emptyStatLine() {
  return {
    spiele: 0, startelf: 0, minuten: 0, tore: 0, vorlagen: 0, schuesse: 0,
    paraden: 0, gegentore: 0, zuNull: 0, zweikaempfe: 0, zweikaempfeGewonnen: 0,
    gelb: 0, gelbrot: 0, rot: 0, notenSumme: 0, notenAnzahl: 0, motm: 0
  };
}

function emptyFinanceLine() {
  return {
    einnahmenZuschauer: 0, einnahmenTv: 0, einnahmenSponsoren: 0, einnahmenTransfer: 0,
    einnahmenMerch: 0, einnahmenPraemien: 0, einnahmenSonstige: 0,
    ausgabenGehaelter: 0, ausgabenTransfer: 0, ausgabenStadion: 0, ausgabenStab: 0,
    ausgabenJugend: 0, ausgabenBetrieb: 0, ausgabenZinsen: 0, ausgabenSonstige: 0
  };
}

function baueState(opts = {}) {
  const seed = opts.seed !== undefined ? opts.seed : 20250725;
  const rng = createRng(seed);
  const state = {
    version: 1,
    seed,
    difficulty: opts.difficulty || 'profi',
    date: { season: 1, day: opts.startTag !== undefined ? opts.startTag : 46, startYear: 2025 },
    managerClubId: opts.clubId || 'dortmund',
    manager: { name: 'Testtrainer', reputation: 45 },
    clubs: {}, players: {}, staff: {},
    fixtures: [], tables: {}, inbox: [], news: [],
    freeAgents: [], history: { seasons: [] }, tick: 0
  };

  for (const raw of CLUBS) {
    const c = deepClone(raw);
    c.playerIds = [];
    c.staffIds = [];
    c.tactics = null;
    c.finances = Object.assign({
      balance: 0, debt: 0, ticketBase: 25, transferBudget: 0, wageBudget: 0,
      ledger: [], saison: emptyFinanceLine(), letzteSaison: null, kredite: []
    }, c.finances || {});
    c.sponsors = { trikot: null, aermel: null, ausruester: null, stadion: null, bande: [], angebote: [], boniErfuellt: [] };
    c.board = {
      name: c.boardName || 'Der Vorstand', zufriedenheit: 60, geduld: 60,
      erwartung: erwartungFuer(c.reputation || 50), saisonziel: null,
      forderungen: [], warnungen: 0, vertrauen: 60
    };
    c.fans = Object.assign({ members: 10000, ultras: 40, mood: 60, potential: 50, protest: 0, dauerkarten: 0, erwartung: 55 }, c.fanbase || {});
    c.stadiumState = {
      ausbau: null,
      preise: {
        sitz: c.finances.ticketBase,
        steh: Math.round(c.finances.ticketBase * 0.45),
        vip: Math.round(c.finances.ticketBase * 4.5),
        dauerkarte: Math.round(c.finances.ticketBase * 17)
      },
      catering: 50, parkplaetze: 50, sicherheit: 60,
      rasenZustand: c.stadium ? c.stadium.pitch : 80,
      letzteZuschauer: Math.round((c.stadium.capacity || 20000) * 0.82),
      auslastungSchnitt: 0.82
    };
    c.youth = { akademie: c.facilities ? c.facilities.youth : 50, talente: [], scoutingRegionen: ['Deutschland'], naechsteSichtung: 0, jahrgang: [] };
    c.season = { form: [], tore: 0, gegentore: 0, punkte: 0, platz: 0, serie: 0, letzteErgebnisse: [] };
    c.moral = 62;
    state.clubs[c.id] = c;
    c.fans.dauerkarten = Math.round((c.stadium.capacity || 20000) * (0.35 + (c.reputation || 50) / 300));
  }

  for (const raw of ALLE_SPIELER) {
    const p = deepClone(raw);
    p.form = clamp(Math.round(rng.gauss(50, 12)), 20, 80);
    p.morale = clamp(Math.round(rng.gauss(68, 10)), 30, 95);
    p.fitness = 100;
    p.sharpness = 60;
    p.injury = null;
    p.cards = { yellow: 0, red: 0, ban: 0, seasonYellow: 0 };
    p.stats = { season: emptyStatLine(), career: emptyStatLine(), history: [] };
    p.transfer = { listed: false, wunschWechsel: false, angebote: [], leihe: null };
    p.joined = { season: 1, day: 0 };
    p.captain = false;
    p.happiness = { spielzeit: 60, gehalt: 60, ambition: 60, trainer: 60, beschwerden: [] };
    state.players[p.id] = p;
    const club = state.clubs[p.clubId];
    if (club) club.playerIds.push(p.id);
  }

  for (const club of Object.values(state.clubs)) {
    if (!club.playerIds.length) continue;
    const squad = club.playerIds.map(id => state.players[id]);
    try { club.tactics = defaultTactics(club, squad); } catch (e) { club.tactics = null; }
  }

  return state;
}

function erwartungFuer(rep) {
  if (rep >= 90) return { text: 'Meisterschaft und Titel', platz: 1, minPlatz: 3 };
  if (rep >= 82) return { text: 'Champions-League-Qualifikation', platz: 3, minPlatz: 6 };
  if (rep >= 74) return { text: 'Internationales Geschäft', platz: 6, minPlatz: 10 };
  if (rep >= 64) return { text: 'Gesichertes Mittelfeld', platz: 10, minPlatz: 14 };
  if (rep >= 54) return { text: 'Klassenerhalt ohne Zittern', platz: 13, minPlatz: 15 };
  return { text: 'Klassenerhalt', platz: 15, minPlatz: 16 };
}

/* ------------------------------------------------------------------ *
 *  Tagesablauf-Attrappe
 * ------------------------------------------------------------------ */

function makeCtx(state, sammler) {
  const day = state.date.day;
  const d = dateFromDayIndex(day, state.date.season, state.date.startYear);
  return {
    rng: createRng('tag:' + state.seed + ':' + day),
    day,
    season: state.date.season,
    weekday: (day + 6) % 7,
    isMatchday: false,
    isWeekStart: day % 7 === 6,          // siehe data/leagues.js: dayIndex%7===6 = Montag
    isMonthStart: d.day === 1,
    isSeasonEnd: false,
    log(text, kind, o) { if (sammler) sammler.post.push({ text, kind, o }); },
    news(text, kind) { if (sammler) sammler.news.push({ text, kind }); },
    difficulty: DIFFICULTIES[state.difficulty] || DIFFICULTIES.profi
  };
}

function laufe(state, tage, sammler) {
  for (let i = 0; i < tage; i++) {
    tickFans(state, makeCtx(state, sammler));
    state.date.day++;
    state.tick++;
  }
}

let fxZaehler = 0;
/** Trägt ein bereits gespieltes Ligaspiel in den Spielplan ein. */
function ergebnisEintragen(state, homeId, awayId, heimTore, gastTore, tag) {
  fxZaehler++;
  state.fixtures.push({
    id: 'test_fx_' + fxZaehler,
    competitionId: 'bl1',
    season: state.date.season,
    matchday: fxZaehler,
    dayIndex: tag !== undefined ? tag : state.date.day,
    homeId, awayId,
    played: true,
    result: [heimTore, gastTore]
  });
}

function neuerSammler() { return { post: [], news: [] }; }

/* ================================================================== *
 *  1. GRUNDLAGEN
 * ================================================================== */

abschnitt('1. Grundlagen');
{
  const state = baueState();
  const s = stimmung(state, 'dortmund');
  pruefe(typeof s.wert === 'number' && s.wert >= 0 && s.wert <= 100, 'stimmung() liefert 0..100', 'wert=' + s.wert);
  pruefe(Array.isArray(s.gruende), 'stimmung() liefert gruende-Liste', 'n=' + s.gruende.length);
  pruefe(typeof s.text === 'string' && s.text.length > 8, 'stimmung() liefert deutschen Text', s.text);

  const u = ultras(state, 'dortmund');
  pruefe(u.anzahl > 500 && u.anzahl < 20000, 'ultras(): plausible Kopfzahl BVB', String(u.anzahl));
  pruefe(u.stimmung >= 0 && u.stimmung <= 100, 'ultras(): Stimmung 0..100', String(u.stimmung));

  const hv = heimvorteil(state, 'dortmund', null);
  pruefe(hv.faktor >= 0.9 && hv.faktor <= 1.18, 'heimvorteil() im Vertragsbereich 0.9..1.18', String(hv.faktor));

  pruefe(rivalitaet('dortmund', 'schalke') === 3, 'Revierderby ist Stufe 3');
  pruefe(rivalitaet('dortmund', 'freiburg') === 0, 'Dortmund–Freiburg ist kein Derby');
  pruefe(rivalitaet('nuernberg', 'fuerth') === rivalitaet('fuerth', 'nuernberg'), 'Rivalitäten sind symmetrisch');

  const uebersicht = fanUebersicht(state, 'dortmund');
  pruefe(uebersicht && uebersicht.beliebteste.length === 5, 'fanUebersicht() liefert Top-5-Publikumslieblinge');
}

/* ================================================================== *
 *  2. SIEGSERIE
 * ================================================================== */

abschnitt('2. Siegserie hebt die Stimmung');
let siegEnde = 0;
{
  const state = baueState({ clubId: 'dortmund', seed: 1001 });
  const sammler = neuerSammler();
  const start = stimmung(state, 'dortmund').wert;

  const gegner = ['bremen', 'koeln', 'mainz', 'augsburg', 'freiburg', 'union', 'hoffenheim', 'wolfsburg'];
  for (let i = 0; i < gegner.length; i++) {
    laufe(state, 3, sammler);
    if (i % 2 === 0) ergebnisEintragen(state, 'dortmund', gegner[i], 3, 0);
    else ergebnisEintragen(state, gegner[i], 'dortmund', 0, 2);
    laufe(state, 1, sammler);
  }
  laufe(state, 6, sammler);

  const f = state.clubs.dortmund.fans;
  siegEnde = stimmung(state, 'dortmund').wert;
  console.log(`  Stimmung ${start} -> ${siegEnde}  (Form: ${f.form.join('')})`);
  pruefe(siegEnde > start + 8, 'Acht Siege heben die Stimmung um mehr als 8 Punkte', `${start} -> ${siegEnde}`);
  pruefe(f.form.slice(-8).every(x => x === 'S'), 'Formliste enthält acht Siege', f.form.join(''));
  pruefe(stimmung(state, 'dortmund').trend > 0, 'Trend ist positiv');
  pruefe(f.protest < 1, 'Protest ist bei Siegen bei null', String(round(f.protest, 2)));
  pruefe(sammler.news.length > 0, 'Es wurden Ticker-Meldungen erzeugt', String(sammler.news.length));
}

/* ================================================================== *
 *  3. NIEDERLAGENSERIE
 * ================================================================== */

abschnitt('3. Niederlagenserie senkt die Stimmung');
{
  const state = baueState({ clubId: 'dortmund', seed: 1001 });
  const sammler = neuerSammler();
  const start = stimmung(state, 'dortmund').wert;

  const gegner = ['bremen', 'koeln', 'mainz', 'augsburg', 'freiburg', 'union', 'hoffenheim', 'wolfsburg'];
  for (let i = 0; i < gegner.length; i++) {
    laufe(state, 3, sammler);
    if (i % 2 === 0) ergebnisEintragen(state, 'dortmund', gegner[i], 0, 2);
    else ergebnisEintragen(state, gegner[i], 'dortmund', 3, 1);
    laufe(state, 1, sammler);
  }
  laufe(state, 6, sammler);

  const f = state.clubs.dortmund.fans;
  const ende = stimmung(state, 'dortmund').wert;
  console.log(`  Stimmung ${start} -> ${ende}  (Form: ${f.form.join('')}, Protest ${round(f.protest, 1)})`);
  pruefe(ende < start - 8, 'Acht Niederlagen senken die Stimmung um mehr als 8 Punkte', `${start} -> ${ende}`);
  pruefe(f.form.slice(-8).every(x => x === 'N'), 'Formliste enthält acht Niederlagen', f.form.join(''));
  pruefe(f.protest > 5, 'Protest steigt spürbar', String(round(f.protest, 1)));
  pruefe(ende < siegEnde - 20, 'Sieg- und Niederlagenserie liegen weit auseinander', `${siegEnde} vs ${ende}`);
  pruefe(boykottRisiko(state, 'dortmund').wert > 0.15, 'Boykottrisiko steigt', String(boykottRisiko(state, 'dortmund').wert));
}

/* ================================================================== *
 *  4. DERBY WIEGT SCHWERER
 * ================================================================== */

abschnitt('4. Derbysieg wiegt schwerer als ein Pflichtsieg');
{
  const a = baueState({ clubId: 'dortmund', seed: 777 });
  const b = baueState({ clubId: 'dortmund', seed: 777 });
  ergebnisEintragen(a, 'dortmund', 'schalke', 2, 0);     // Revierderby
  ergebnisEintragen(b, 'dortmund', 'heidenheim', 2, 0);  // Pflichtaufgabe
  laufe(a, 2); laufe(b, 2);
  const sa = stimmung(a, 'dortmund').wert, sb = stimmung(b, 'dortmund').wert;
  console.log(`  Derbysieg ${sa} vs Pflichtsieg ${sb}`);
  pruefe(sa > sb + 1.5, 'Derbysieg bringt deutlich mehr Stimmung', `${sa} vs ${sb}`);
}

/* ================================================================== *
 *  5. TICKETPREISE
 * ================================================================== */

abschnitt('5. Preiserhöhungen senken die Stimmung messbar');
{
  // 5a) sofort und rauschfrei am Zielwert ablesbar
  const s0 = baueState({ clubId: 'koeln', seed: 555 });
  const zielVorher = stimmung(s0, 'koeln').ziel;
  const preise = s0.clubs.koeln.stadiumState.preise;
  preise.sitz = Math.round(preise.sitz * 1.45);
  preise.steh = Math.round(preise.steh * 1.45);
  preise.dauerkarte = Math.round(preise.dauerkarte * 1.45);
  const zielNachher = stimmung(s0, 'koeln').ziel;
  console.log(`  Zielstimmung ${zielVorher} -> ${zielNachher} nach +45 % Preisen`);
  pruefe(zielNachher < zielVorher - 10, 'Zielstimmung bricht bei +45 % Preisen um über 10 Punkte ein', `${zielVorher} -> ${zielNachher}`);

  const gruende = stimmung(s0, 'koeln').gruende;
  pruefe(gruende.some(g => g.label === 'Ticketpreise' && g.delta < 0), 'Ticketpreise erscheinen als negativer Grund');

  // 5b) im laufenden Betrieb: Kontrolllauf gegen Preislauf, identische Seeds
  const kontrolle = baueState({ clubId: 'koeln', seed: 555 });
  const teuer = baueState({ clubId: 'koeln', seed: 555 });
  const p = teuer.clubs.koeln.stadiumState.preise;
  p.sitz = Math.round(p.sitz * 1.45);
  p.steh = Math.round(p.steh * 1.45);
  p.dauerkarte = Math.round(p.dauerkarte * 1.45);

  laufe(kontrolle, 28); laufe(teuer, 28);
  const mk = stimmung(kontrolle, 'koeln').wert, mt = stimmung(teuer, 'koeln').wert;
  console.log(`  Nach 28 Tagen: normal ${mk} / teuer ${mt}`);
  pruefe(mt < mk - 6, 'Teure Tickets kosten nach vier Wochen über 6 Stimmungspunkte', `${mk} vs ${mt}`);
  pruefe(boykottRisiko(teuer, 'koeln').wert > boykottRisiko(kontrolle, 'koeln').wert, 'Boykottrisiko steigt mit den Preisen');
  pruefe(ultras(teuer, 'koeln').stimmung < ultras(kontrolle, 'koeln').stimmung, 'Ultras reagieren auf Stehplatzpreise');

  // 5c) Preissenkung wirkt positiv
  const guenstig = baueState({ clubId: 'koeln', seed: 555 });
  const q = guenstig.clubs.koeln.stadiumState.preise;
  q.sitz = Math.round(q.sitz * 0.75); q.steh = Math.round(q.steh * 0.75); q.dauerkarte = Math.round(q.dauerkarte * 0.75);
  pruefe(stimmung(guenstig, 'koeln').ziel > zielVorher, 'Preissenkung hebt die Zielstimmung');

  // 5d) Gewöhnung: der Preisanker wandert mit
  const gewoehnung = baueState({ clubId: 'koeln', seed: 555 });
  const r = gewoehnung.clubs.koeln.stadiumState.preise;
  r.sitz = Math.round(r.sitz * 1.3); r.steh = Math.round(r.steh * 1.3); r.dauerkarte = Math.round(r.dauerkarte * 1.3);
  laufe(gewoehnung, 7);
  const frueh = stimmung(gewoehnung, 'koeln').ziel;
  laufe(gewoehnung, 120);
  const spaet = stimmung(gewoehnung, 'koeln').ziel;
  pruefe(spaet > frueh, 'Nach Monaten gewöhnen sich die Fans an das Preisniveau', `${frueh} -> ${spaet}`);
}

/* ================================================================== *
 *  6. LEGENDENVERKAUF
 * ================================================================== */

abschnitt('6. Verkauf einer Legende');
{
  const state = baueState({ clubId: 'dortmund', seed: 4242 });
  const sammler = neuerSammler();
  laufe(state, 8, sammler);                       // Kaderstand einlesen
  const club = state.clubs.dortmund;
  const vorher = stimmung(state, 'dortmund').wert;
  const grollVorher = club.fans.groll;

  const legende = club.playerIds.map(id => state.players[id]).find(p => p.era === 'legend');
  pruefe(!!legende, 'Testverein hat eine Legende im Kader', legende ? legende.lastName : 'keine');

  club.playerIds = club.playerIds.filter(id => id !== legende.id);
  legende.clubId = 'bayern';
  state.clubs.bayern.playerIds.push(legende.id);

  // bis zum nächsten Montag laufen (dann greift die Kaderprüfung)
  const bisMontag = ((6 - (state.date.day % 7)) + 7) % 7 || 7;
  laufe(state, bisMontag + 1, sammler);

  const nachher = stimmung(state, 'dortmund').wert;
  console.log(`  ${legende.lastName} verkauft: Stimmung ${vorher} -> ${nachher}, Groll ${round(grollVorher, 1)} -> ${round(club.fans.groll, 1)}`);
  pruefe(club.fans.groll > grollVorher + 25, 'Legendenverkauf erzeugt massiven Groll', String(round(club.fans.groll, 1)));
  pruefe(club.fans.protest > 15, 'Legendenverkauf erzeugt Protest', String(round(club.fans.protest, 1)));
  pruefe(nachher < vorher - 5, 'Stimmung bricht ein', `${vorher} -> ${nachher}`);
  pruefe(sammler.post.some(m => m.o && /verkauf/i.test(String(m.o.subject))), 'Der Manager bekommt Post dazu');
  pruefe(stimmung(state, 'dortmund').gruende.some(g => g.label === 'Transferpolitik'), 'Transferpolitik erscheint als Grund');
}

/* ================================================================== *
 *  7. FANBELIEBTHEIT
 * ================================================================== */

abschnitt('7. Fanbeliebtheit einzelner Spieler');
{
  const state = baueState({ clubId: 'bayern', seed: 99 });
  const bayern = state.clubs.bayern;
  const spieler = bayern.playerIds.map(id => state.players[id]);
  const legende = spieler.find(p => p.era === 'legend');
  const modern = spieler.find(p => p.era === 'modern' && !(p.traits || []).includes('fanliebling'));

  const wLegende = fanbeliebtheit(state, legende.id);
  const wModern = fanbeliebtheit(state, modern.id);
  console.log(`  ${legende.lastName} (Legende): ${wLegende} / ${modern.lastName}: ${wModern}`);
  pruefe(wLegende >= 70, 'Legenden sind sehr beliebt', String(wLegende));
  pruefe(wLegende > wModern, 'Legende schlägt Normalprofi');
  pruefe(fanbeliebtheit(state, 'gibtesnicht') === 50, 'Unbekannte ID liefert neutralen Wert');

  // Teurer Fehleinkauf: Riesengehalt, keine Einsätze, mäßige Klasse
  const flop = modern;
  const alt = fanbeliebtheit(state, flop.id);
  flop.contract.salary = 40000000;
  flop.stats.season.spiele = 1;
  flop.abloese = 60000000;
  flop.joined = { season: 0, day: 0 };
  const neu = fanbeliebtheit(state, flop.id);
  console.log(`  Fehleinkauf: ${alt} -> ${neu}`);
  pruefe(neu < alt, 'Teurer Fehleinkauf verliert an Beliebtheit', `${alt} -> ${neu}`);

  const alleWerte = spieler.map(p => fanbeliebtheit(state, p.id));
  pruefe(alleWerte.every(v => v >= 1 && v <= 99), 'Alle Werte im Bereich 1..99');
}

/* ================================================================== *
 *  8. HEIMVORTEIL
 * ================================================================== */

abschnitt('8. Heimvorteil');
{
  const state = baueState({ clubId: 'dortmund', seed: 31 });
  const club = state.clubs.dortmund;

  const fx = { id: 'x1', homeId: 'dortmund', awayId: 'schalke', competitionId: 'bl1', dayIndex: state.date.day + 6, season: 1, played: false };
  state.fixtures.push(fx);

  const normal = heimvorteil(state, 'dortmund', fx).faktor;

  club.fans.mood = 96; club.fans.ultras = 95; club.fans.protest = 0; club.fans.groll = 0;
  club.stadiumState.letzteZuschauer = club.stadium.capacity;
  const top = heimvorteil(state, 'dortmund', fx).faktor;

  club.fans.mood = 4; club.fans.protest = 100; club.fans.boykott = 1;
  club.stadiumState.letzteZuschauer = Math.round(club.stadium.capacity * 0.35);
  const flau = heimvorteil(state, 'dortmund', fx);

  console.log(`  normal ${normal} / Vollhaus ${top} / Revolte ${flau.faktor}`);
  pruefe(top > normal, 'Gute Stimmung erhöht den Heimvorteil');
  pruefe(flau.faktor < normal, 'Protest und Boykott senken den Heimvorteil');
  pruefe(top <= 1.18 && flau.faktor >= 0.9, 'Grenzen 0.9 .. 1.18 werden eingehalten', `${flau.faktor} .. ${top}`);
  pruefe(typeof flau.text === 'string' && flau.text.length > 10, 'Heimvorteil liefert Text', flau.text);

  const auswaerts = { id: 'x2', homeId: 'schalke', awayId: 'dortmund', competitionId: 'bl1', dayIndex: state.date.day + 6, season: 1, played: false };
  const aw = heimvorteil(state, 'dortmund', auswaerts).faktor;
  pruefe(aw >= 0.97 && aw <= 1.06, 'Auswärts gibt es nur den Gästeblock-Bonus', String(aw));
}

/* ================================================================== *
 *  9. ULTRAS UND CHOREO
 * ================================================================== */

abschnitt('9. Ultras und Choreografie');
{
  const state = baueState({ clubId: 'dortmund', seed: 8181 });
  const club = state.clubs.dortmund;
  club.finances.balance = 5000000;

  state.fixtures.push({
    id: 'derby1', competitionId: 'bl1', season: 1, matchday: 5,
    dayIndex: state.date.day + 6, homeId: 'dortmund', awayId: 'schalke', played: false, result: null
  });

  const anfrage = choreoAnfrage(state, 'dortmund', createRng('choreo-test'));
  pruefe(anfrage.ok, 'Choreo-Anfrage kommt zustande', anfrage.text);
  pruefe(anfrage.choreo && anfrage.choreo.gegnerId === 'schalke', 'Choreo zielt auf das Derby');
  pruefe(anfrage.choreo.kosten > 10000 && anfrage.choreo.kosten < 400000, 'Choreokosten plausibel', String(anfrage.choreo.kosten));

  const doppelt = choreoAnfrage(state, 'dortmund', createRng('choreo-test'));
  pruefe(!doppelt.ok, 'Zweite Anfrage wird abgelehnt');

  const vorher = club.fans.mood;
  const kasseVorher = club.finances.balance;
  const res = fanaktionAnwenden(state, 'dortmund', anfrage.aktion.id, 'bezuschussen');
  pruefe(res.ok, 'Choreo lässt sich per fanaktionAnwenden genehmigen', res.text);
  pruefe(club.fans.mood > vorher, 'Genehmigte Choreo hebt die Stimmung');
  pruefe(club.finances.balance < kasseVorher, 'Die Choreo kostet Geld', String(kasseVorher - club.finances.balance));

  const fxDerby = state.fixtures.find(f => f.id === 'derby1');
  const mitChoreo = heimvorteil(state, 'dortmund', fxDerby).faktor;
  club.fans.choreo = null;
  const ohneChoreo = heimvorteil(state, 'dortmund', fxDerby).faktor;
  pruefe(mitChoreo > ohneChoreo, 'Choreo wirkt im Heimvorteil', `${mitChoreo} vs ${ohneChoreo}`);

  // Ablehnen ärgert die Kurve
  const state2 = baueState({ clubId: 'dortmund', seed: 8181 });
  state2.fixtures.push({
    id: 'derby2', competitionId: 'bl1', season: 1, matchday: 5,
    dayIndex: state2.date.day + 6, homeId: 'dortmund', awayId: 'schalke', played: false, result: null
  });
  const a2 = choreoAnfrage(state2, 'dortmund', createRng('choreo-test'));
  const protestVorher = state2.clubs.dortmund.fans.protest;
  fanaktionAnwenden(state2, 'dortmund', a2.aktion.id, 'ablehnen');
  pruefe(state2.clubs.dortmund.fans.protest > protestVorher, 'Ablehnung erzeugt Protest');
}

/* ================================================================== *
 *  10. FANAKTIONEN UND REAKTIONEN
 * ================================================================== */

abschnitt('10. Fanaktionen und Reaktionen des Managers');
{
  const state = baueState({ clubId: 'hsv', seed: 2468 });
  const club = state.clubs.hsv;
  club.fans.mood = 26;
  club.fans.protest = 60;
  club.fans.groll = 55;
  club.fans.form = ['N', 'N', 'N', 'N', 'N'];

  let erzeugt = null;
  for (let i = 0; i < 40 && !erzeugt; i++) {
    club.fans.letzteAktionTag = -99;
    const r = fanaktion(state, 'hsv', makeCtx(state, neuerSammler()));
    if (r.ok) erzeugt = r.aktion;
    state.date.day++;
  }
  pruefe(!!erzeugt, 'Bei mieser Lage entsteht eine Fanaktion', erzeugt ? erzeugt.name : 'keine');
  pruefe(erzeugt && erzeugt.text.length > 60, 'Die Meldung ist ausformuliert');
  pruefe(erzeugt && erzeugt.reaktionen.length >= 3, 'Es gibt mehrere Reaktionsmöglichkeiten');

  // Vier Reaktionen, vier verschiedene Folgen
  const varianten = ['dialog', 'ignorieren', 'vorstand', 'partei'];
  const ergebnisse = {};
  for (const v of varianten) {
    const s = baueState({ clubId: 'hsv', seed: 2468 });
    const c = s.clubs.hsv;
    c.fans.mood = 26; c.fans.protest = 60; c.fans.groll = 55;
    c.fans.letzteAktionTag = -99;
    let akt = null;
    for (let i = 0; i < 40 && !akt; i++) {
      c.fans.letzteAktionTag = -99;
      const r = fanaktion(s, 'hsv', null);
      if (r.ok && r.aktion.reaktionen.some(x => x.id === v)) akt = r.aktion;
      s.date.day++;
    }
    if (!akt) continue;
    const res = fanaktionAnwenden(s, 'hsv', akt.id, v);
    ergebnisse[v] = {
      ok: res.ok, mood: c.fans.mood, protest: c.fans.protest,
      groll: c.fans.groll, board: c.board.zufriedenheit
    };
  }
  console.log('  ' + JSON.stringify(Object.fromEntries(
    Object.entries(ergebnisse).map(([k, v]) => [k, `Stimmung ${round(v.mood, 1)} Protest ${round(v.protest, 1)} Vorstand ${round(v.board, 1)}`])
  ), null, 0));

  pruefe(ergebnisse.dialog && ergebnisse.dialog.protest < ergebnisse.ignorieren.protest, 'Dialog senkt den Protest stärker als Aussitzen');
  pruefe(ergebnisse.partei && ergebnisse.partei.mood > ergebnisse.ignorieren.mood, 'Partei ergreifen hebt die Stimmung');
  pruefe(ergebnisse.partei && ergebnisse.partei.board < 60, 'Partei ergreifen kostet Vorstandsvertrauen', String(ergebnisse.partei.board));
  pruefe(ergebnisse.vorstand && ergebnisse.vorstand.groll > ergebnisse.dialog.groll, 'Ordnungsdienst erzeugt mehr Groll als ein Gespräch');

  // Doppelte Reaktion wird abgewiesen
  const s2 = baueState({ clubId: 'hsv', seed: 2468 });
  s2.clubs.hsv.fans.mood = 26; s2.clubs.hsv.fans.protest = 60;
  s2.clubs.hsv.fans.letzteAktionTag = -99;
  const r2 = fanaktion(s2, 'hsv', null);
  if (r2.ok) {
    fanaktionAnwenden(s2, 'hsv', r2.aktion.id, r2.aktion.reaktionen[0].id);
    const nochmal = fanaktionAnwenden(s2, 'hsv', r2.aktion.id, r2.aktion.reaktionen[0].id);
    pruefe(!nochmal.ok, 'Zweite Reaktion auf dieselbe Aktion wird abgelehnt', nochmal.text);
    const quatsch = fanaktionAnwenden(s2, 'hsv', 'gibtesnicht', 'dialog');
    pruefe(!quatsch.ok && typeof quatsch.text === 'string', 'Unbekannte Aktion-ID wirft keine Exception');
  }

  // Pyrotechnik kostet Geld
  const s3 = baueState({ clubId: 'stpauli', seed: 13 });
  const c3 = s3.clubs.stpauli;
  c3.finances.balance = 10000000;
  c3.fans.protest = 40;
  c3.fans.ultras = 95;
  let strafe = 0;
  for (let i = 0; i < 120 && !strafe; i++) {
    c3.fans.letzteAktionTag = -99;
    const r = fanaktion(s3, 'stpauli', null);
    if (r.ok && r.aktion.strafe) strafe = r.aktion.strafe;
    s3.date.day++;
  }
  pruefe(strafe > 10000, 'Pyrotechnik zieht eine Geldstrafe nach sich', String(strafe));
  pruefe(c3.finances.balance < 10000000, 'Die Strafe wird vom Konto gebucht');
  pruefe(c3.finances.ledger.some(l => l.kategorie === 'fans'), 'Buchung landet im Ledger');
}

/* ================================================================== *
 *  11. MITGLIEDER UND MERCHANDISING
 * ================================================================== */

abschnitt('11. Mitglieder und Merchandising');
{
  const state = baueState({ clubId: 'dortmund', seed: 606 });

  const gut = baueState({ clubId: 'dortmund', seed: 606 });
  gut.clubs.dortmund.fans.mood = 92;
  const schlecht = baueState({ clubId: 'dortmund', seed: 606 });
  schlecht.clubs.dortmund.fans.mood = 15;
  const mGut = mitgliederEntwicklung(gut, 'dortmund', null);
  const mSchlecht = mitgliederEntwicklung(schlecht, 'dortmund', null);
  console.log(`  Mitglieder-Ziel: gute Stimmung ${mGut.ziel} / miese Stimmung ${mSchlecht.ziel}`);
  pruefe(mGut.ziel > mSchlecht.ziel, 'Gute Stimmung zieht Mitglieder an');
  pruefe(mGut.delta > 0 && mSchlecht.delta < 0, 'Wachstum bzw. Austritte im richtigen Vorzeichen', `${mGut.delta} / ${mSchlecht.delta}`);
  pruefe(gut.clubs.dortmund.fans.members === state.clubs.dortmund.fans.members, 'Ohne ctx wird nichts gebucht (reine Prognose)');
  mitgliederEntwicklung(gut, 'dortmund', makeCtx(gut, null));
  pruefe(gut.clubs.dortmund.fans.members > state.clubs.dortmund.fans.members, 'Mit ctx wird gebucht');

  // Merchandising-Größenordnungen
  const erwartet = { bayern: [45e6, 130e6], dortmund: [30e6, 90e6], heidenheim: [1.5e6, 14e6], hsv: [4e6, 40e6] };
  for (const id in erwartet) {
    const m = merchandising(state, id, null);
    const [min, max] = erwartet[id];
    pruefe(m.jahr >= min && m.jahr <= max,
      `Merchandising ${state.clubs[id].shortName} plausibel`,
      `${(m.jahr / 1e6).toFixed(1)} Mio (erwartet ${(min / 1e6)}–${(max / 1e6)} Mio)`);
  }

  const kasseVorher = state.clubs.bayern.finances.balance;
  const gebucht = merchandising(state, 'bayern', makeCtx(state, null));
  pruefe(state.clubs.bayern.finances.balance === kasseVorher + gebucht.betrag, 'Merchandising wird korrekt gebucht');
  pruefe(state.clubs.bayern.finances.saison.einnahmenMerch === gebucht.betrag, 'Merchandising landet in saison.einnahmenMerch');

  // Stimmung beeinflusst den Umsatz
  const mies = baueState({ clubId: 'bayern', seed: 606 });
  mies.clubs.bayern.fans.mood = 12;
  mies.clubs.bayern.fans.protest = 80;
  pruefe(merchandising(mies, 'bayern', null).jahr < merchandising(state, 'bayern', null).jahr,
    'Miese Stimmung drückt den Fanshop-Umsatz');

  // Ein Jahr durchlaufen lassen: Summe der Monatsbuchungen ≈ Jahreswert
  const jahr = baueState({ clubId: 'bayern', seed: 606 });
  jahr.date.day = 0;
  const startKasse = jahr.clubs.bayern.finances.balance;
  laufe(jahr, 365);
  const summe = jahr.clubs.bayern.finances.saison.einnahmenMerch;
  const hoch = merchandising(jahr, 'bayern', null).jahr;
  console.log(`  Bayern Merch: ${(summe / 1e6).toFixed(1)} Mio gebucht, Hochrechnung ${(hoch / 1e6).toFixed(1)} Mio`);
  pruefe(summe > hoch * 0.6 && summe < hoch * 1.6, 'Monatsbuchungen summieren sich zum Jahreswert', `${(summe / 1e6).toFixed(1)} vs ${(hoch / 1e6).toFixed(1)}`);
  pruefe(jahr.clubs.bayern.finances.balance !== startKasse, 'Über ein Jahr wurde tatsächlich gebucht');
}

/* ================================================================== *
 *  12. MITGLIEDERVERSAMMLUNG
 * ================================================================== */

abschnitt('12. Mitgliederversammlung');
{
  const state = baueState({ clubId: 'koeln', seed: 3030 });
  const sammler = neuerSammler();
  state.clubs.koeln.fans.mood = 78;
  const mv = mitgliederversammlung(state, 'koeln', makeCtx(state, sammler));
  pruefe(mv.ok, 'Versammlung findet statt');
  pruefe(mv.anwesend > 100, 'Es sind Mitglieder anwesend', String(mv.anwesend));
  pruefe(mv.beschluesse.length >= 2, 'Es wird über mehrere Punkte abgestimmt', String(mv.beschluesse.length));
  pruefe(mv.entlastet === true, 'Bei guter Stimmung wird der Vorstand entlastet');
  pruefe(mv.vertrauensvotum && typeof mv.vertrauensvotum.ja === 'number', 'Vertrauensvotum für den Trainer wird abgehalten', String(mv.vertrauensvotum && mv.vertrauensvotum.ja));
  pruefe(sammler.post.length > 0, 'Protokoll landet im Postfach');

  const nochmal = mitgliederversammlung(state, 'koeln', null);
  pruefe(!nochmal.ok, 'Zweite Versammlung in derselben Saison wird abgelehnt');

  const wut = baueState({ clubId: 'koeln', seed: 3030 });
  wut.clubs.koeln.fans.mood = 12;
  wut.clubs.koeln.fans.protest = 85;
  const mv2 = mitgliederversammlung(wut, 'koeln', null);
  pruefe(mv2.entlastet === false, 'Bei Wut wird der Vorstand nicht entlastet');
  pruefe(wut.clubs.koeln.board.zufriedenheit < 60, 'Der Vorstand nimmt das übel');
}

/* ================================================================== *
 *  13. DETERMINISMUS UND ROBUSTHEIT
 * ================================================================== */

abschnitt('13. Determinismus und Robustheit');
{
  const lauf = (seed) => {
    const s = baueState({ clubId: 'dortmund', seed });
    for (let i = 0; i < 6; i++) {
      laufe(s, 5);
      ergebnisEintragen(s, 'dortmund', 'bremen', i % 2, 1);
    }
    laufe(s, 10);
    const f = s.clubs.dortmund.fans;
    return [round(f.mood, 4), round(f.protest, 4), round(f.groll, 4), Math.round(f.members), f.form.join('')].join('|');
  };
  const a = lauf(555), b = lauf(555), c = lauf(556);
  pruefe(a === b, 'Gleicher Seed liefert exakt denselben Verlauf', a);
  pruefe(a !== c || true, 'Unterschiedliche Seeds sind erlaubt (nur Info)', c);

  // Kein Math.random / Date.now im Modul
  const quelle = await import('node:fs').then(fs => fs.readFileSync(new URL('../src/club/fans.js', import.meta.url), 'utf8'));
  // Kommentare zuerst entfernen: Im Kopfkommentar steht "kein Math.random(),
  // kein Date.now()" — das ist eine Zusage, keine Verwendung.
  const code = quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  pruefe(!/Math\.random/.test(code), 'Kein Math.random() im Modul');
  pruefe(!/Date\.now/.test(code), 'Kein Date.now() im Modul');
  pruefe(!/document\.|window\./.test(quelle), 'Kein DOM-Zugriff im Modul');

  // Unbekannte Vereine dürfen nicht werfen
  const s = baueState();
  const gaga = ['stimmung', 'ultras', 'boykottRisiko'].map(fn => ({
    stimmung, ultras, boykottRisiko
  }[fn](s, 'gibtesnicht')));
  pruefe(gaga.every(x => x && typeof x === 'object'), 'Unbekannte clubId liefert Objekt statt Exception');
  pruefe(!choreoAnfrage(s, 'gibtesnicht', createRng(1)).ok, 'choreoAnfrage mit falscher ID scheitert sauber');
  pruefe(!fanaktionAnwenden(s, 'gibtesnicht', 'x', 'dialog').ok, 'fanaktionAnwenden mit falscher ID scheitert sauber');
  pruefe(!merchandising(s, 'gibtesnicht', null).ok, 'merchandising mit falscher ID scheitert sauber');

  // tickFans ohne vollständigen ctx
  const nackt = baueState();
  let geworfen = null;
  try { tickFans(nackt, { day: nackt.date.day, season: 1 }); } catch (e) { geworfen = e; }
  pruefe(!geworfen, 'tickFans überlebt einen unvollständigen ctx', geworfen ? geworfen.message : '');
}

/* ================================================================== *
 *  14. LANGZEITLAUF ÜBER EINE SAISON (alle 36 Vereine)
 * ================================================================== */

abschnitt('14. Ganze Saison, alle 36 Vereine');
{
  const state = baueState({ clubId: 'dortmund', seed: 90210 });
  state.date.day = 0;
  const sammler = neuerSammler();
  const rng = createRng('saison');
  const t0 = process.hrtime.bigint();

  const ligaClubs = { bl1: [], bl2: [] };
  for (const c of Object.values(state.clubs)) (ligaClubs[c.leagueId] || ligaClubs.bl1).push(c.id);

  for (let tag = 0; tag < 365; tag++) {
    // Ab dem Ligastart alle sieben Tage einen Spieltag mit Zufallsergebnissen
    if (tag >= 46 && tag <= 319 && tag % 7 === 4) {
      for (const liga of ['bl1', 'bl2']) {
        const ids = rng.shuffle(ligaClubs[liga]);
        for (let i = 0; i + 1 < ids.length; i += 2) {
          ergebnisEintragen(state, ids[i], ids[i + 1], rng.int(0, 4), rng.int(0, 4), tag);
        }
      }
    }
    tickFans(state, makeCtx(state, sammler));
    state.date.day++;
    state.tick++;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  365 Tage x 36 Vereine in ${ms.toFixed(0)} ms  (${sammler.post.length} Postnachrichten, ${sammler.news.length} Ticker)`);

  let werteOk = true, details = '';
  for (const c of Object.values(state.clubs)) {
    const f = c.fans;
    if (!(f.mood >= 0 && f.mood <= 100 && f.protest >= 0 && f.protest <= 100 &&
      f.groll >= 0 && f.groll <= 100 && f.members > 0 && isFinite(f.members))) {
      werteOk = false; details = `${c.id}: mood=${f.mood} protest=${f.protest} groll=${f.groll} members=${f.members}`;
      break;
    }
  }
  pruefe(werteOk, 'Alle Vereinswerte bleiben nach einer Saison im gültigen Bereich', details);
  pruefe(ms < 4000, 'Eine Saison läuft in unter vier Sekunden', ms.toFixed(0) + ' ms');
  pruefe(sammler.post.length > 5, 'Der Manager hat Post bekommen', String(sammler.post.length));

  const spanne = Object.values(state.clubs).map(c => c.fans.mood);
  const min = Math.min(...spanne), max = Math.max(...spanne);
  console.log(`  Stimmungsspanne der Liga: ${round(min, 1)} bis ${round(max, 1)}`);
  pruefe(max - min > 12, 'Die Vereine entwickeln sich unterschiedlich', `${round(min, 1)} .. ${round(max, 1)}`);

  const mitglieder = state.clubs.dortmund.fans.members;
  pruefe(mitglieder > 50000 && mitglieder < 500000, 'Mitgliederzahl bleibt realistisch', String(Math.round(mitglieder)));

  const u = fanUebersicht(state, 'dortmund');
  pruefe(u.verlauf.length > 10, 'Stimmungsverlauf wird mitgeschrieben', String(u.verlauf.length));
}

/* ================================================================== *
 *  Ergebnis
 * ================================================================== */

console.log('\n' + '-'.repeat(64));
console.log(`Tests: ${ok + fail}   bestanden: ${ok}   fehlgeschlagen: ${fail}`);
if (fail) {
  console.log('\nFehlgeschlagen:');
  for (const f of fehler) console.log('  - ' + f);
  process.exit(1);
}
console.log('Alles gruen. Die Fans sind zufrieden. Vorerst.');
