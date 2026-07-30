/**
 * tools/test-finanzen.js — Wirtschafts-Smoketest über drei Saisons.
 *
 *   node tools/test-finanzen.js [--verbose]
 *
 * Simuliert 3 × 365 Tage Finanz- und Sponsorenticks für alle 36 Vereine (ohne
 * Spiele) und prüft:
 *   1. Buchungskonsistenz  — Summe aller Buchungen == Änderung des Kontostands,
 *                            Ledger + gekürzte Einträge == gebuchtGesamt.
 *   2. Plausibilität       — kein Verein wird absurd reich oder dauerhaft pleite.
 *   3. Größenordnungen     — Umsatz, Gehaltsquote, Sponsoreneinnahmen.
 *
 * Was hier NICHT aus club/*.js kommt, wird bewusst nachgebaut, weil die
 * zuständigen Module noch fehlen (klar markiert mit "STELLVERTRETER"):
 *   - Zuschauereinnahmen (stadium.js)
 *   - Zwangsverkäufe und Zukäufe (transfers.js)
 *   - Tabellen und Saisonwechsel (Tagesablauf/Saisonlogik)
 */

import { createRng } from '../src/core/rng.js';
import { SEASON_DAYS } from '../src/core/constants.js';
import { clamp, formatMoney, deepClone, sortBy, round } from '../src/core/util.js';
import { CLUBS } from '../src/data/clubs.js';
import { LEAGUES, LEAGUE_IDS } from '../src/data/leagues.js';
import { deriveValue, deriveSalary } from '../src/data/squads/_helper.js';

import {
  tickFinanzen, buchen, bilanz, prognose, kreditAufnehmen, kreditTilgen,
  gehaltsbudget, transferbudgetSetzen, tvGeldAusschuetten, praemieZahlen,
  insolvenzCheck, wochenbericht, umsatzSchaetzung, gehaltssumme
} from '../src/club/finances.js';
import {
  tickSponsoren, SPONSOR_SLOTS, angeboteGenerieren, sponsorAnnehmen,
  sponsorKuendigen, verhandeln, sponsorEinnahmenProSaison, bonusPruefen, trikotwert
} from '../src/club/sponsors.js';

const VERBOSE = process.argv.includes('--verbose');
const SAISONS = 3;

let fehler = 0, warnungen = 0;
const fail = (msg) => { fehler++; console.log('  ✗ ' + msg); };
const warn = (msg) => { warnungen++; console.log('  ! ' + msg); };
const ok = (msg) => { if (VERBOSE) console.log('  ✓ ' + msg); };

/* ══════════════════════════════════════════════════════════════════════════
 *  Spielstand aufbauen
 * ══════════════════════════════════════════════════════════════════════════ */

/** Laufzeitfelder wie in core/state.js initClubRuntime() – nur das, was hier gebraucht wird. */
function initClub(club) {
  club.playerIds = [];
  club.staffIds = [];
  club.finances = Object.assign({
    balance: 0, debt: 0, ticketBase: 25, transferBudget: 0, wageBudget: 0,
    ledger: [], saison: null, letzteSaison: null, kredite: []
  }, club.finances);
  club.sponsors = { trikot: null, aermel: null, ausruester: null, stadion: null, bande: [], angebote: [], boniErfuellt: [] };
  club.board = { name: club.boardName || 'Der Vorstand', zufriedenheit: 60, geduld: 60, vertrauen: 60 };
  club.fans = Object.assign({ members: 10000, ultras: 40, mood: 60, potential: 50, protest: 0, dauerkarten: 0 }, club.fanbase || {});
  club.stadiumState = {
    preise: {
      sitz: club.finances.ticketBase,
      steh: Math.round(club.finances.ticketBase * 0.45),
      vip: Math.round(club.finances.ticketBase * 4.5),
      dauerkarte: Math.round(club.finances.ticketBase * 17)
    },
    catering: 50, parkplaetze: 50, sicherheit: 60,
    rasenZustand: club.stadium.pitch, letzteZuschauer: 0, auslastungSchnitt: 0
  };
  club.youth = { akademie: club.facilities.youth, talente: [] };
  return club;
}

/** STELLVERTRETER für data/generator.js: Kader für die 2. Liga. */
function kaderErzeugen(rng, club) {
  const rep = club.reputation || 50;
  const basis = clamp(Math.round(38 + rep * 0.42), 45, 82);
  const players = [];
  for (let i = 0; i < 24; i++) {
    const ovr = clamp(Math.round(rng.gauss(basis, 5)) + (i < 11 ? 3 : -2), 38, 90);
    const age = rng.int(19, 33);
    const value = deriveValue(ovr, ovr + rng.int(0, 8), age);
    players.push({
      id: `p_${club.id}_gen${i}`, clubId: club.id, lastName: 'Spieler' + i, age,
      value, contract: { salary: deriveSalary(ovr, value, age), until: 3 },
      transfer: { listed: false, angebote: [], leihe: null }, jugend: false
    });
  }
  return players;
}

async function spielstandBauen(seed = 4711) {
  const rng = createRng(seed);
  const state = {
    seed, difficulty: 'profi',
    date: { season: 1, day: 0, startYear: 2025 },
    managerClubId: null,          // alle Vereine verhalten sich wie KI-Vereine
    manager: { name: 'Testtrainer', skills: { verhandlung: 50 } },
    clubs: {}, players: {}, staff: {}, fixtures: [], tables: {},
    inbox: [], news: [], tick: 0
  };

  for (const raw of CLUBS) {
    const club = initClub(deepClone(raw));
    state.clubs[club.id] = club;
  }

  // Kader: 1. Liga aus den handgepflegten Daten, 2. Liga prozedural.
  const squads = await Promise.all(['gruppe1', 'gruppe2', 'gruppe3', 'gruppe4', 'gruppe5', 'gruppe6']
    .map(f => import(`../src/data/squads/${f}.js`)));
  for (const mod of squads) {
    for (const raw of mod.players) {
      const p = deepClone(raw);
      p.transfer = { listed: false, angebote: [], leihe: null };
      state.players[p.id] = p;
      if (state.clubs[p.clubId]) state.clubs[p.clubId].playerIds.push(p.id);
    }
  }
  for (const club of Object.values(state.clubs)) {
    if (club.playerIds.length) continue;
    for (const p of kaderErzeugen(rng.fork('squad:' + club.id), club)) {
      state.players[p.id] = p;
      club.playerIds.push(p.id);
    }
  }

  // Trainerstab (STELLVERTRETER für staff.js)
  for (const club of Object.values(state.clubs)) {
    for (const rolle of ['cotrainer', 'torwarttrainer', 'athletik', 'arzt', 'physio', 'scout', 'jugendtrainer']) {
      const id = `s_${club.id}_${rolle}`;
      state.staff[id] = { id, clubId: club.id, rolle, salary: Math.round(90000 + (club.reputation || 50) * 8000) };
      club.staffIds.push(id);
    }
  }
  return state;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  STELLVERTRETER für fehlende Module
 * ══════════════════════════════════════════════════════════════════════════ */

/** Tabelle aus Reputation + Zufall (ersetzt computeTable auf echten Ergebnissen). */
function tabelleErzeugen(state, ligaId, rng) {
  const liga = LEAGUES[ligaId];
  const zeilen = liga.clubIds.map(id => ({
    clubId: id,
    score: (state.clubs[id].reputation || 50) + rng.gauss(0, 7)
  }));
  return sortBy(zeilen, z => ({ key: z.score, desc: true }))
    .map((z, i) => ({ clubId: z.clubId, platz: i + 1, punkte: 70 - i * 3, spiele: 34 }));
}

/** stadium.js: Zuschauereinnahmen eines Heimspiels. */
function heimspielVerbuchen(state, clubId, rng) {
  const club = state.clubs[clubId];
  const st = club.stadium;
  const preise = club.stadiumState.preise;
  const mood = clamp(club.fans.mood || 60, 0, 100);
  const auslastung = clamp(0.55 + (club.reputation || 50) / 260 + (mood - 60) / 400 + rng.gauss(0, 0.05), 0.3, 1);
  const zuschauer = Math.round(st.capacity * auslastung);
  const stehAnteil = clamp(st.standing || 0.25, 0, 0.4);
  const schnitt = preise.sitz * (1 - stehAnteil) + preise.steh * stehAnteil;
  const einnahmen = Math.round(zuschauer * schnitt * 1.18);   // inkl. VIP, Catering, Parken
  buchen(state, clubId, einnahmen, 'zuschauer', `Heimspiel (${zuschauer.toLocaleString('de-DE')} Zuschauer)`);
  club.stadiumState.letzteZuschauer = zuschauer;
  club.stadiumState.auslastungSchnitt = club.stadiumState.auslastungSchnitt
    ? club.stadiumState.auslastungSchnitt * 0.8 + auslastung * 0.2
    : auslastung;
}

/** transfers.js: Zwangsverkäufe und Zukäufe. */
function transfermarktStellvertreter(state, clubId, rng, stats) {
  const club = state.clubs[clubId];
  const f = club.finances;

  // (a) Zwangsverkäufe, solange die Finanzabteilung sie anordnet
  if (f.zwangsverkauf && f.zwangsverkauf.aktiv) {
    let erloes = 0;
    let schutz = 0;
    while (erloes < f.zwangsverkauf.zielSumme && club.playerIds.length > 18 && schutz++ < 8) {
      const kader = club.playerIds.map(id => state.players[id]).filter(Boolean);
      const opfer = sortBy(kader, p => ({ key: p.contract.salary, desc: true }))[0];
      const ablöse = Math.round((opfer.value || opfer.contract.salary * 3) * rng.float(0.7, 1.05));
      buchen(state, clubId, ablöse, 'transfer', `Notverkauf ${opfer.lastName}`);
      club.playerIds.splice(club.playerIds.indexOf(opfer.id), 1);
      opfer.clubId = null;
      erloes += ablöse;
      stats.zwangsverkaeufe++;
    }
    if (erloes > 0) f.zwangsverkauf = null;
  }

  // (b) Wer im Geld schwimmt, kauft ein (sonst wäre jeder Verein nach drei Jahren Krösus)
  const umsatz = umsatzSchaetzung(state, clubId);
  if (f.balance > umsatz * 0.75 && club.playerIds.length < 26 && rng.chance(0.35)) {
    const budget = Math.round((f.balance - umsatz * 0.55) * rng.float(0.35, 0.6));
    if (budget > 500000) {
      buchen(state, clubId, -budget, 'transferAusgabe', 'Neuverpflichtung');
      const id = `p_${clubId}_neu_${state.date.season}_${state.date.day}`;
      state.players[id] = {
        id, clubId, lastName: 'Neuzugang', age: 24, value: budget,
        contract: { salary: Math.round(budget * 0.22), until: state.date.season + 4 },
        transfer: { listed: false, angebote: [], leihe: null }
      };
      club.playerIds.push(id);
      stats.zukaeufe++;
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Simulation
 * ══════════════════════════════════════════════════════════════════════════ */

function ctxBauen(state, rng, day, logZaehler) {
  const weekday = (day + 1) % 7;
  return {
    rng, day, season: state.date.season, weekday,
    isMatchday: false,
    isWeekStart: weekday === 0,
    isMonthStart: monatsErster(day),
    isSeasonEnd: day === SEASON_DAYS - 1,
    difficulty: { id: 'profi', moneyFactor: 1 },
    log: (text, kind) => { logZaehler.post++; logZaehler.letzte = { text, kind }; },
    news: (text, kind) => { logZaehler.news++; }
  };
}

const MONATSTAGE = [31, 31, 30, 31, 30, 31, 31, 28, 31, 30, 31, 30];  // ab 1. Juli
function monatsErster(day) {
  let d = day % 365, i = 0;
  while (d >= MONATSTAGE[i]) { d -= MONATSTAGE[i]; i++; }
  return d === 0;
}

async function simulieren(state) {
  const rng = createRng(state.seed ^ 0x5f3a);
  const logZaehler = { post: 0, news: 0, letzte: null };
  const stats = { zwangsverkaeufe: 0, zukaeufe: 0, kredite: 0 };
  const verlauf = {};
  for (const id in state.clubs) verlauf[id] = [];

  for (let saison = 1; saison <= SAISONS; saison++) {
    state.date.season = saison;

    // Tabelle zu Saisonbeginn (Vorsaison-Platzierung als Erwartungswert)
    for (const ligaId of LEAGUE_IDS) state.tables[ligaId] = tabelleErzeugen(state, ligaId, rng.fork('tab:' + saison + ligaId));

    // Heimspieltage je Verein bestimmen
    const heimtage = {};
    for (const ligaId of LEAGUE_IDS) {
      const liga = LEAGUES[ligaId];
      liga.spieltage.forEach((tag, st) => {
        liga.clubIds.forEach((id, i) => {
          if ((i + st) % 2 === 0) (heimtage[id] || (heimtage[id] = [])).push(tag);
        });
      });
    }

    for (let day = 0; day < SEASON_DAYS; day++) {
      state.date.day = day;
      state.tick++;
      const tagRng = rng.fork('tag:' + saison + ':' + day);
      const ctx = ctxBauen(state, tagRng, day, logZaehler);

      tickFinanzen(state, ctx);
      tickSponsoren(state, ctx);

      // STELLVERTRETER stadium.js
      for (const id in state.clubs) {
        if (heimtage[id] && heimtage[id].includes(day)) heimspielVerbuchen(state, id, tagRng.fork('gate:' + id));
      }

      // STELLVERTRETER transfers.js (wöchentlich)
      if (ctx.isWeekStart) {
        for (const id in state.clubs) transfermarktStellvertreter(state, id, tagRng.fork('tm:' + id), stats);
      }

      // Buchungskonsistenz laufend prüfen (billig, deshalb jeden Tag)
      for (const id in state.clubs) pruefeKonsistenz(state, id, saison, day);
    }

    // --- Saisonende: TV-Geld, Prämien, Sponsorenboni ----------------------
    for (const ligaId of LEAGUE_IDS) {
      const tabelle = tabelleErzeugen(state, ligaId, rng.fork('endtab:' + saison + ligaId));
      state.tables[ligaId] = tabelle;
      const res = tvGeldAusschuetten(state, ligaId, tabelle);
      if (!res.ok) fail(`tvGeldAusschuetten(${ligaId}) fehlgeschlagen`);
      for (const z of tabelle) {
        bonusPruefen(state, z.clubId, 'platzierung', { platz: z.platz });
        if (z.platz === 1) bonusPruefen(state, z.clubId, 'meister', {});
        if (z.platz <= 6 && ligaId === 'bl1') bonusPruefen(state, z.clubId, 'europacup', {});
        if (z.platz >= 10) bonusPruefen(state, z.clubId, 'klassenerhalt', {});
        praemieZahlen(state, z.clubId, z.platz <= 6 ? 'klassenerhalt' : 'klassenerhalt');
      }
    }

    for (const id in state.clubs) {
      const b = bilanz(state, id);
      verlauf[id].push({
        saison, umsatz: b.summeEinnahmen, aufwand: b.summeAusgaben, ergebnis: b.ergebnis,
        balance: b.balance, schulden: b.schulden, gehalt: b.gehaltssumme, gehaltsquote: b.gehaltsquote
      });
    }
  }

  return { verlauf, stats, logZaehler };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Prüfungen
 * ══════════════════════════════════════════════════════════════════════════ */

const startwerte = {};
function konsistenzStart(state) {
  for (const id in state.clubs) {
    const f = state.clubs[id].finances;
    startwerte[id] = { balance: f.balance, gebucht: f.gebuchtGesamt || 0 };
  }
}

let konsistenzFehler = 0;
function pruefeKonsistenz(state, clubId, saison, day) {
  if (konsistenzFehler > 5) return;
  const f = state.clubs[clubId].finances;
  const s = startwerte[clubId];
  const dBalance = f.balance - s.balance;
  const dGebucht = (f.gebuchtGesamt || 0) - s.gebucht;
  if (dBalance !== dGebucht) {
    konsistenzFehler++;
    fail(`${clubId} S${saison}/T${day}: Kontostandsänderung ${dBalance} ≠ Buchungssumme ${dGebucht}`);
  }
  const ledgerSumme = f.ledger.reduce((acc, e) => acc + e.betrag, 0) + (f.ledgerGekuerzt || 0);
  if (ledgerSumme !== (f.gebuchtGesamt || 0)) {
    konsistenzFehler++;
    fail(`${clubId} S${saison}/T${day}: Ledger ${ledgerSumme} ≠ gebuchtGesamt ${f.gebuchtGesamt}`);
  }
}

function pruefePlausibilitaet(state, verlauf) {
  console.log('\n── Wirtschaftliche Plausibilität ' + '─'.repeat(46));
  const kopf = 'Verein'.padEnd(16) + 'Liga'.padEnd(6) + 'Umsatz S3'.padStart(12) +
    'Ergebnis'.padStart(12) + 'Konto'.padStart(13) + 'Schulden'.padStart(12) + 'Lohn%'.padStart(8);
  console.log(kopf);

  const zeilen = sortBy(Object.keys(state.clubs), id => ({ key: verlauf[id][SAISONS - 1].umsatz, desc: true }));
  for (const id of zeilen) {
    const club = state.clubs[id];
    const v = verlauf[id];
    const letzte = v[SAISONS - 1];
    const umsatz = letzte.umsatz;
    const quote = round(letzte.gehalt / Math.max(1, umsatz) * 100, 0);
    console.log(
      club.shortName.padEnd(16) + (club.leagueId || '?').padEnd(6) +
      formatMoney(umsatz).padStart(12) + formatMoney(letzte.ergebnis).padStart(12) +
      formatMoney(letzte.balance).padStart(13) + formatMoney(letzte.schulden).padStart(12) +
      (quote + ' %').padStart(8)
    );

    // Grenzen
    const grenzePleite = -umsatz * 1.5;
    const grenzeReich = umsatz * 3;
    if (letzte.balance < grenzePleite) {
      fail(`${club.shortName}: dauerhaft pleite (${formatMoney(letzte.balance)} bei ${formatMoney(umsatz)} Umsatz)`);
    }
    if (letzte.balance > grenzeReich) {
      fail(`${club.shortName}: absurd reich (${formatMoney(letzte.balance)} bei ${formatMoney(umsatz)} Umsatz)`);
    }
    if (umsatz <= 0) fail(`${club.shortName}: kein Umsatz verbucht`);
  }

  // Zielkorridore aus dem Briefing
  console.log('\n── Zielkorridore ' + '─'.repeat(62));
  const korridore = [
    ['bayern', 500e6, 1000e6],
    ['gladbach', 90e6, 260e6],
    ['heidenheim', 40e6, 130e6],
    ['schalke', 15e6, 90e6],
    ['elversberg', 8e6, 45e6]
  ];
  for (const [id, min, max] of korridore) {
    const u = verlauf[id][SAISONS - 1].umsatz;
    const txt = `${state.clubs[id].shortName}: Umsatz ${formatMoney(u)} (Ziel ${formatMoney(min)}–${formatMoney(max)})`;
    if (u < min || u > max) warn(txt); else console.log('  ✓ ' + txt);
  }

  // Trikotsponsoring gegen das Briefing
  console.log('\n── Trikotsponsoring (Marktwert pro Saison) ' + '─'.repeat(36));
  for (const [id, min, max] of [['bayern', 45e6, 65e6], ['dortmund', 24e6, 40e6], ['gladbach', 8e6, 16e6],
  ['heidenheim', 3.5e6, 7e6], ['schalke', 1.5e6, 5e6], ['elversberg', 0.5e6, 2.5e6]]) {
    const w = trikotwert(state, id);
    const txt = `${state.clubs[id].shortName}: ${formatMoney(w)} (Ziel ${formatMoney(min)}–${formatMoney(max)})`;
    if (w < min || w > max) warn(txt); else console.log('  ✓ ' + txt);
  }
}

/** Prüft die Aktionen, die von den Screens aufgerufen werden. */
async function pruefeAktionen(state) {
  console.log('\n── Aktionen ' + '─'.repeat(67));
  const id = 'freiburg';
  const rng = createRng(99);
  const f = state.clubs[id].finances;

  // Kredit
  const vorher = f.balance;
  const zuViel = kreditAufnehmen(state, id, 5e9, 104);
  if (zuViel.ok) fail('kreditAufnehmen: unbegrenzter Kredit bewilligt');
  else ok('kreditAufnehmen lehnt Fantasiesummen ab: ' + zuViel.text);
  const klein = kreditAufnehmen(state, id, 10000, 52);
  if (klein.ok) fail('kreditAufnehmen: Minibetrag akzeptiert');
  const k = kreditAufnehmen(state, id, 3000000, 104);
  if (!k.ok) fail('kreditAufnehmen: regulärer Kredit abgelehnt — ' + k.text);
  else {
    if (f.balance !== vorher + 3000000) fail('kreditAufnehmen: Auszahlung nicht verbucht');
    if (!(k.zinsSatz > 0.03 && k.zinsSatz < 0.16)) fail('kreditAufnehmen: unplausibler Zinssatz ' + k.zinsSatz);
    ok(`Kredit: ${k.text}`);
    const t = kreditTilgen(state, id, f.kredite.length - 1, 1000000);
    if (!t.ok) fail('kreditTilgen: ' + t.text);
    else ok('kreditTilgen: ' + t.text);
    const zuViel2 = kreditTilgen(state, id, f.kredite.length - 1, 1e12);
    if (zuViel2.ok) fail('kreditTilgen: Tilgung über den Kontostand hinaus erlaubt');
  }

  // Budgets
  const gb = gehaltsbudget(state, id);
  if (!(gb.budget > 0 && gb.verbraucht > 0)) fail('gehaltsbudget liefert Nullwerte');
  else ok(`gehaltsbudget: ${formatMoney(gb.verbraucht)} / ${formatMoney(gb.budget)} = ${gb.auslastung} %`);
  const tb = transferbudgetSetzen(state, id, 1e12);
  if (tb.ok) fail('transferbudgetSetzen: Fantasiebudget durchgewinkt');
  else ok('transferbudgetSetzen deckelt: ' + tb.text);

  // Prognose / Bilanz / Bericht
  const p = prognose(state, id, 12);
  if (p.length !== 12) fail('prognose liefert falsche Länge');
  const b = bilanz(state, id);
  if (!b || !b.einnahmen.length) fail('bilanz liefert keine Einnahmen');
  else ok(`bilanz: Umsatz ${formatMoney(b.summeEinnahmen)}, Ergebnis ${formatMoney(b.ergebnis)}, ${b.bewertung}`);
  const bericht = wochenbericht(state, id);
  if (!bericht || bericht.length < 80) fail('wochenbericht ist leer');
  const ic = insolvenzCheck(state, id);
  if (!(ic.gefahr >= 0 && ic.gefahr <= 100)) fail('insolvenzCheck: gefahr außerhalb 0..100');

  // Falscheingaben dürfen nicht werfen
  if (buchen(state, id, 100, 'gibtsnicht', 'x').ok) fail('buchen akzeptiert unbekannte Kategorie');
  if (bilanz(state, 'kein_verein') !== null) fail('bilanz(unbekannt) sollte null liefern');
  if (kreditAufnehmen(state, 'kein_verein', 1e6, 52).ok) fail('kreditAufnehmen(unbekannt) sollte scheitern');

  // Sponsoren-Aktionen
  const testId = 'mainz';
  const club = state.clubs[testId];
  const slot = club.sponsors.trikot ? 'bande' : 'trikot';
  const angebote = angeboteGenerieren(state, testId, slot, rng);
  if (angebote.length < 3 || angebote.length > 5) fail(`angeboteGenerieren: ${angebote.length} Angebote (erwartet 3–5)`);
  else ok(`angeboteGenerieren: ${angebote.length} Angebote für ${SPONSOR_SLOTS[slot].name}`);
  const a = angebote[0];
  const v1 = verhandeln(state, testId, slot, a, Math.round(a.grundsumme * 1.12), rng);
  ok('verhandeln (moderat): ' + v1.text);
  const v2 = verhandeln(state, testId, slot, a, Math.round(a.grundsumme * 4), rng);
  if (v2.ok) warn('verhandeln: Vervierfachung der Grundsumme wurde akzeptiert');
  else ok('verhandeln (dreist): ' + v2.text);

  const frei = SPONSOR_SLOTS.bande.plaetze > club.sponsors.bande.length ? 'bande' : null;
  if (frei) {
    const ang = angeboteGenerieren(state, testId, 'bande', rng);
    const res = sponsorAnnehmen(state, testId, 'bande', ang[ang.length - 1]);
    if (!res.ok) fail('sponsorAnnehmen: ' + res.text);
    else {
      ok('sponsorAnnehmen: ' + res.text);
      const kuend = sponsorKuendigen(state, testId, 'bande', club.sponsors.bande.length - 1);
      if (!kuend.ok) fail('sponsorKuendigen: ' + kuend.text);
      else ok('sponsorKuendigen: ' + kuend.text);
    }
  }

  const se = sponsorEinnahmenProSaison(state, 'bayern');
  if (se.grund <= 0) fail('sponsorEinnahmenProSaison(bayern) = 0');
  else ok(`Bayern Sponsoring: ${formatMoney(se.grund)} Grundsumme, bis zu ${formatMoney(se.boniMoeglich)} Boni`);
}

/** Der Verein des Managers darf nichts automatisch unterschreiben, muss aber Post bekommen. */
async function pruefeManagerpfad() {
  const state = await spielstandBauen(1234);
  state.managerClubId = 'stpauli';
  const rng = createRng(777);
  const post = [];
  const ctx = {
    rng, day: 6, season: 1, weekday: 0, isMatchday: false, isWeekStart: true,
    isMonthStart: false, isSeasonEnd: false, difficulty: { id: 'profi' },
    log: (text, kind, opts) => post.push({ text, kind, opts }),
    news: () => {}
  };
  state.date.day = 6;
  for (let i = 0; i < 12; i++) {
    state.date.day = 6 + i * 7;
    ctx.day = state.date.day;
    tickFinanzen(state, ctx);
    tickSponsoren(state, ctx);
  }
  const club = state.clubs.stpauli;
  console.log('\n── Managerpfad (St. Pauli) ' + '─'.repeat(52));
  // Geerbte Bestandsverträge (startSponsoren, historie-Art 'bestand') sind gewollt —
  // kein Profiverein läuft mit blanker Brust auf. Verboten ist nur, dass der Verein
  // des Managers ein vorliegendes ANGEBOT von sich aus annimmt (Art 'abschluss').
  const selbstUnterschrieben = (club.sponsors.historie || []).filter(h => h.art === 'abschluss');
  if (selbstUnterschrieben.length) fail(`Managerverein hat ${selbstUnterschrieben.length} Angebot(e) automatisch unterschrieben`);
  else ok('Managerverein unterschreibt nichts von allein');
  if (!club.sponsors.trikot) warn('Managerverein startet ohne Trikotsponsor');
  else ok(`Bestandsvertrag geerbt: ${club.sponsors.trikot.firma}, ${formatMoney(club.sponsors.trikot.grundsumme)}/Saison`);
  if (!club.sponsors.angebote.length) warn('Managerverein hat nach 12 Wochen keine Sponsorenangebote erhalten');
  else ok(`${club.sponsors.angebote.length} offene Angebote im Marketingordner`);
  if (!post.length) fail('Managerverein bekommt keine Post');
  else ok(`${post.length} Nachrichten im Postfach, zuletzt: "${String(post[post.length - 1].text).split('\n')[0].slice(0, 80)}…"`);
  const fremd = state.clubs.bayern;
  if (!fremd.sponsors.trikot) warn('KI-Verein Bayern hat nach 12 Wochen keinen Trikotsponsor');
  else ok(`KI-Verein Bayern hat unterschrieben: ${fremd.sponsors.trikot.firma}, ${formatMoney(fremd.sponsors.trikot.grundsumme)}/Saison`);
}

/* ══════════════════════════════════════════════════════════════════════════
 *  Los geht's
 * ══════════════════════════════════════════════════════════════════════════ */

(async function main() {
  console.log('TRAUMVEREIN — Finanz-Smoketest über ' + SAISONS + ' Saisons\n' + '═'.repeat(80));
  const state = await spielstandBauen();
  konsistenzStart(state);

  const t0 = process.hrtime.bigint();
  const { verlauf, stats, logZaehler } = await simulieren(state);
  const dauer = Number(process.hrtime.bigint() - t0) / 1e6;

  console.log(`Simuliert: ${SAISONS} Saisons × ${SEASON_DAYS} Tage × ${Object.keys(state.clubs).length} Vereine in ${Math.round(dauer)} ms.`);
  console.log(`Stellvertreter-Transfers: ${stats.zwangsverkaeufe} Notverkäufe, ${stats.zukaeufe} Zukäufe.`);
  if (konsistenzFehler === 0) console.log('Buchungskonsistenz: alle Vereine an jedem Tag sauber.');

  pruefePlausibilitaet(state, verlauf);

  console.log('\n── Umsatzverteilung Saison 3 (Anteile) ' + '─'.repeat(41));
  for (const id of ['bayern', 'gladbach', 'heidenheim', 'schalke', 'elversberg']) {
    const b = state.clubs[id].finances.letzteSaison || state.clubs[id].finances.saison;
    const sum = ['einnahmenTv', 'einnahmenSponsoren', 'einnahmenZuschauer', 'einnahmenMerch', 'einnahmenTransfer', 'einnahmenPraemien', 'einnahmenSonstige']
      .reduce((s, k) => s + (b[k] || 0), 0) || 1;
    const pct = k => String(Math.round((b[k] || 0) / sum * 100)).padStart(3) + ' %';
    console.log(`${state.clubs[id].shortName.padEnd(14)} TV ${pct('einnahmenTv')}  Sponsoren ${pct('einnahmenSponsoren')}  ` +
      `Spieltag ${pct('einnahmenZuschauer')}  Merch ${pct('einnahmenMerch')}  Transfer ${pct('einnahmenTransfer')}`);
  }

  await pruefeAktionen(state);
  await pruefeManagerpfad();

  console.log('\n' + '═'.repeat(80));
  if (fehler === 0) console.log(`ERGEBNIS: bestanden (${warnungen} Warnung${warnungen === 1 ? '' : 'en'}).`);
  else console.log(`ERGEBNIS: ${fehler} Fehler, ${warnungen} Warnungen.`);
  process.exit(fehler === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
