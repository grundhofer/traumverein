/**
 * tools/test-jugend.js — Simuliert fünf Jahre Jugendarbeit.
 *
 * Vergleicht zwei identische Vereine, die sich NUR im Nachwuchsbereich
 * unterscheiden (Akademie-Ausbaustufe, Jugendtrainer, Scouting-Regionen),
 * und zählt, wie viele brauchbare Profis am Ende herauskommen.
 *
 * Aufruf:  node tools/test-jugend.js
 *
 * Der Test baut sich einen minimalen State selbst — er hängt bewusst nicht an
 * core/state.js, damit er auch dann läuft, wenn data/generator.js noch fehlt.
 */

import { createRng } from '../src/core/rng.js';
import { clamp, round, formatMoney, sortBy, avg } from '../src/core/util.js';
import { DIFFICULTIES, SEASON_DAYS, POSITIONS } from '../src/core/constants.js';
import { CLUBS_BY_ID } from '../src/data/clubs.js';
import { mk } from '../src/data/squads/_helper.js';
import { playerOverall } from '../src/engine/ratings.js';

import {
  tickStab, stabWirkung, stabBericht, bewerber, einstellen, entlassen,
  gehaltVerhandeln, weiterbildung, coTrainerRat, macheStabMitglied, STAFF_ROLES, KURSE
} from '../src/club/staff.js';

import {
  tickJugend, jugendJahrgang, talente, talentBewerten, befoerdern, zurueckstufen,
  akademieAusbauen, scoutingRegion, jugendturnier, eigengewaechsBonus,
  nachwuchsBericht, profiSchwelle, SCOUTING_REGIONEN, AKADEMIE_STUFEN
} from '../src/club/youth.js';

const SEASONS = 5;
const SEED = 4711;

/* ------------------------------------------------------------------ *
 *  Minimaler State
 * ------------------------------------------------------------------ */

function leereFinanzline() {
  return {
    einnahmenZuschauer: 0, einnahmenTv: 0, einnahmenSponsoren: 0, einnahmenTransfer: 0,
    einnahmenMerch: 0, einnahmenPraemien: 0, einnahmenSonstige: 0,
    ausgabenGehaelter: 0, ausgabenTransfer: 0, ausgabenStadion: 0, ausgabenStab: 0,
    ausgabenJugend: 0, ausgabenBetrieb: 0, ausgabenZinsen: 0, ausgabenSonstige: 0
  };
}

function baueClub(vorlage, id, opts) {
  const c = JSON.parse(JSON.stringify(vorlage));
  c.id = id;
  c.reputation = opts.reputation;
  c.playerIds = [];
  c.staffIds = [];
  c.tactics = null;
  c.finances = {
    balance: 250000000, debt: 0, ticketBase: 25, transferBudget: 0, wageBudget: 0,
    ledger: [], saison: leereFinanzline(), letzteSaison: null, kredite: []
  };
  c.facilities = Object.assign({ training: 60, medical: 60, youth: 50, scouting: 60 }, c.facilities || {});
  c.facilities.youth = opts.akademie;
  c.fans = { members: 40000, ultras: 40, mood: 60, potential: 60, protest: 0, dauerkarten: 0, erwartung: 55 };
  c.season = { form: [], tore: 0, gegentore: 0, punkte: 0, platz: 9, serie: 0, letzteErgebnisse: [] };
  c.moral = 62;
  c.youth = {
    akademie: opts.akademie,
    talente: [],
    scoutingRegionen: opts.regionen.slice(),
    naechsteSichtung: 0,
    jahrgang: []
  };
  return c;
}

function baueState() {
  const state = {
    seed: SEED, tick: 0, difficulty: 'profi',
    date: { season: 1, day: 0, startYear: 2025 },
    managerClubId: 'manager',
    clubs: {}, players: {}, staff: {},
    fixtures: [], inbox: [], news: [], freeAgents: []
  };

  const vorlage = CLUBS_BY_ID['bochum'] || Object.values(CLUBS_BY_ID)[0];

  // Beide Testvereine haben dieselbe Reputation — nur der Nachwuchs unterscheidet sich.
  state.clubs.gut = baueClub(vorlage, 'gut', {
    reputation: 62, akademie: 90,
    regionen: ['de-west', 'de-sued', 'benelux', 'frankreich', 'suedamerika']
  });
  state.clubs.schlecht = baueClub(vorlage, 'schlecht', {
    reputation: 62, akademie: 25,
    regionen: ['de-ost']
  });
  // Dritter Verein = "Managerverein", damit gut/schlecht symmetrisch als KI laufen.
  state.clubs.manager = baueClub(vorlage, 'manager', {
    reputation: 62, akademie: 60, regionen: ['de-west', 'de-sued']
  });

  const rng = createRng(SEED);

  // Trainerstab: guter Verein mit komplettem Nachwuchsstab, schlechter ohne.
  const stabGut = [
    ['cotrainer', 74], ['torwarttrainer', 68], ['athletiktrainer', 70], ['mannschaftsarzt', 72],
    ['physiotherapeut', 66], ['chefscout', 80], ['scout', 70], ['scout', 66], ['scout', 62],
    ['jugendtrainer', 84], ['jugendtrainer', 72], ['videoanalyst', 66], ['mentaltrainer', 64]
  ];
  const stabSchlecht = [
    ['cotrainer', 52], ['torwarttrainer', 46], ['athletiktrainer', 44], ['mannschaftsarzt', 50],
    ['physiotherapeut', 42], ['scout', 38]
  ];
  const stabManager = [
    ['cotrainer', 66], ['torwarttrainer', 58], ['athletiktrainer', 60], ['mannschaftsarzt', 62],
    ['physiotherapeut', 55], ['chefscout', 64], ['scout', 55], ['jugendtrainer', 62]
  ];

  for (const [clubId, liste] of [['gut', stabGut], ['schlecht', stabSchlecht], ['manager', stabManager]]) {
    for (const [role, q] of liste) {
      const s = macheStabMitglied(state, clubId, role, q, rng.fork(clubId + role + q));
      state.staff[s.id] = s;
      state.clubs[clubId].staffIds.push(s.id);
    }
  }

  // Ein kleiner Profikader für den Managerverein (für coTrainerRat / Beförderungen).
  const kaderRng = rng.fork('kader');
  for (let i = 0; i < 20; i++) {
    const pos = POSITIONS[i % POSITIONS.length];
    const p = mk({
      id: `p_manager_test${i}`, club: 'manager', vn: 'Test', nn: 'Spieler' + i,
      pos, ovr: kaderRng.int(55, 72), age: kaderRng.int(21, 32), nr: i + 1
    });
    p.form = 50; p.morale = 68; p.fitness = 100; p.sharpness = 60;
    p.injury = null; p.cards = { yellow: 0, red: 0, ban: 0, seasonYellow: 0 };
    p.stats = { season: {}, career: {}, history: [] };
    state.players[p.id] = p;
    state.clubs.manager.playerIds.push(p.id);
  }

  // Startjahrgänge
  for (const clubId of ['gut', 'schlecht', 'manager']) {
    jugendJahrgang(state, clubId, rng.fork('start:' + clubId));
  }

  return state;
}

/* ------------------------------------------------------------------ *
 *  Tagesschleife
 * ------------------------------------------------------------------ */

function makeCtx(state, postfach) {
  const day = state.date.day;
  return {
    rng: createRng(state.seed + day * 7919 + state.date.season * 104729),
    day,
    season: state.date.season,
    weekday: day % 7,
    isMatchday: false,
    isWeekStart: day % 7 === 0,
    isMonthStart: day % 30 === 0,
    isSeasonEnd: day >= SEASON_DAYS - 1,
    difficulty: DIFFICULTIES.profi,
    log: (text, kind = 'info') => postfach.push({ kind, text, day, season: state.date.season }),
    news: () => {}
  };
}

/** Beobachtet, wie ein Talent bei seiner Entdeckung eingeschätzt wurde. */
function erfasseNeue(state, clubId, register) {
  for (const t of talente(state, clubId)) {
    if (register.has(t.id)) continue;
    register.set(t.id, {
      id: t.id, clubId, name: t.name, sterne: t.sterne,
      potSchaetzung: t.potenzialSchaetzung, wahresPotenzial: t.player.potential,
      startOvr: playerOverall(t.player), season: state.date.season
    });
  }
}

function simuliere(state, postfach, register) {
  for (let s = 1; s <= SEASONS; s++) {
    state.date.season = s;
    for (let day = 0; day < SEASON_DAYS; day++) {
      state.date.day = day;
      state.tick++;
      const ctx = makeCtx(state, postfach);
      tickStab(state, ctx);
      tickJugend(state, ctx);
      if (day % 7 === 0) {
        for (const clubId of ['gut', 'schlecht', 'manager']) erfasseNeue(state, clubId, register);
      }
    }
    // Was sonst das Saisonmodul erledigt: alle werden ein Jahr älter.
    for (const id in state.players) state.players[id].age++;
  }
}

/* ------------------------------------------------------------------ *
 *  Auswertung
 * ------------------------------------------------------------------ */

function auswerten(state, clubId, register) {
  const club = state.clubs[clubId];
  const schwelle = profiSchwelle(club);
  const eigen = (club.playerIds || []).map(id => state.players[id]).filter(p => p && p.eigengewaechs);
  const nochImNachwuchs = talente(state, clubId);

  const gesichtet = [...register.values()].filter(r => r.clubId === clubId);
  const brauchbar = eigen.filter(p => playerOverall(p) >= schwelle);
  const stammspieler = eigen.filter(p => playerOverall(p) >= schwelle + 8);

  const ledger = club.finances.ledger.filter(e => e.kategorie === 'ausgabenJugend');
  const kosten = ledger.reduce((s, e) => s + Math.abs(e.betrag), 0);
  const einnahmen = club.finances.ledger
    .filter(e => e.kategorie === 'einnahmenPraemien').reduce((s, e) => s + e.betrag, 0);

  return {
    clubId,
    akademie: club.youth.akademie,
    jugendWirkung: stabWirkung(state, clubId).jugend,
    scoutingWirkung: stabWirkung(state, clubId).scouting,
    schwelle,
    gesichtet: gesichtet.length,
    befoerdert: club.youth.befoerdert,
    abgaenge: club.youth.abgaenge,
    eigengewaechse: eigen.length,
    brauchbar: brauchbar.length,
    stammspieler: stammspieler.length,
    schnittOvr: eigen.length ? round(avg(eigen, p => playerOverall(p)), 1) : 0,
    bester: eigen.length ? sortBy(eigen, p => ({ key: playerOverall(p), desc: true }))[0] : null,
    kaderwert: eigen.reduce((s, p) => s + (p.value || 0), 0),
    imNachwuchs: nochImNachwuchs.length,
    bestesTalent: nochImNachwuchs[0] || null,
    kosten, einnahmen
  };
}

function zeile(label, a, b) {
  console.log(`  ${label.padEnd(34)} ${String(a).padStart(14)}   ${String(b).padStart(14)}`);
}

function sterneStatistik(state, register, clubId) {
  const stat = {};
  for (const r of register.values()) {
    if (r.clubId !== clubId) continue;
    const p = state.players[r.id];
    const s = stat[r.sterne] || (stat[r.sterne] = { n: 0, profi: 0, flop: 0, ovr: [] });
    s.n++;
    if (p && p.eigengewaechs) { s.profi++; s.ovr.push(playerOverall(p)); }
    else if (!p || !state.clubs[clubId].youth.talente.includes(r.id)) s.flop++;
  }
  return stat;
}

/* ------------------------------------------------------------------ *
 *  Aktions-Smoke-Test
 * ------------------------------------------------------------------ */

function aktionenTesten(state) {
  const fehler = [];
  const pruefe = (name, res, erwartetOk) => {
    if (!res || typeof res.ok !== 'boolean' || typeof res.text !== 'string') {
      fehler.push(`${name}: Rückgabe ohne {ok, text}`);
      return;
    }
    if (erwartetOk !== undefined && res.ok !== erwartetOk) {
      fehler.push(`${name}: ok=${res.ok}, erwartet ${erwartetOk} — "${res.text}"`);
    }
    console.log(`  • ${name}: ${res.ok ? 'OK' : 'abgelehnt'} — ${res.text.slice(0, 118)}…`);
  };

  console.log('\n--- Aktionen (Managerverein) --------------------------------------------');

  // Stab
  const kandidaten = bewerber(state, 'manager', 'mentaltrainer', createRng(99));
  console.log(`  • bewerber(mentaltrainer): ${kandidaten.length} Bewerber, ` +
    `Qualität ${kandidaten.map(k => k.qualitaet).join('/')}, Forderung ab ${formatMoney(Math.min(...kandidaten.map(k => k.gehaltsforderung)))}`);
  if (kandidaten.length < 3 || kandidaten.length > 6) fehler.push('bewerber(): Anzahl außerhalb 3..6');
  if (!kandidaten[0].referenzen.length) fehler.push('bewerber(): keine Referenzen');
  pruefe('einstellen(mentaltrainer)', einstellen(state, 'manager', kandidaten[0]), true);
  pruefe('einstellen(2. Mentaltrainer)', einstellen(state, 'manager', kandidaten[1]), false);

  const co = state.clubs.manager.staffIds.map(id => state.staff[id]).find(s => s.roleId === 'cotrainer');
  pruefe('weiterbildung(Co-Trainer)', weiterbildung(state, co.id, 'videoanalyse'), true);
  pruefe('weiterbildung(doppelt)', weiterbildung(state, co.id, 'uefa_a'), false);
  pruefe('gehaltVerhandeln(zu wenig)', gehaltVerhandeln(state, co.id, 1000), false);
  pruefe('gehaltVerhandeln(fair)', gehaltVerhandeln(state, co.id, Math.round(co.gehalt * 1.9)), true);

  const zeugwart = bewerber(state, 'manager', 'zeugwart', createRng(7))[0];
  const eingestellt = einstellen(state, 'manager', zeugwart);
  pruefe('einstellen(zeugwart)', eingestellt, true);
  pruefe('entlassen(zeugwart)', entlassen(state, eingestellt.staff.id), true);

  for (const thema of ['aufstellung', 'gegner', 'training', 'transfer', 'form']) {
    const rat = coTrainerRat(state, 'manager', thema);
    if (!rat.ok) fehler.push(`coTrainerRat(${thema}) lieferte ok=false`);
    console.log(`  • Co-Trainer zu „${thema}“ (Vertrauen ${rat.vertrauen}): ${rat.text.slice(0, 130)}…`);
  }

  const bericht = stabBericht(state, 'manager');
  console.log(`  • stabBericht: ${bericht.anzahl} Mitarbeiter, Schnitt ${bericht.schnitt}, ` +
    `${formatMoney(bericht.kostenJahr)}/Jahr, Lücken: ${bericht.luecken.length}`);
  console.log(`    „${bericht.bewertung}“`);

  // Jugend
  pruefe('scoutingRegion(japan-korea, an)', scoutingRegion(state, 'manager', 'japan-korea', true));
  pruefe('scoutingRegion(unbekannt)', scoutingRegion(state, 'manager', 'Mars', true), false);
  pruefe('akademieAusbauen(Stufe 5)', akademieAusbauen(state, 'manager', 5), true);
  pruefe('akademieAusbauen(erneut)', akademieAusbauen(state, 'manager', 6), false);

  const turnier = jugendturnier(state, 'manager', { rng: createRng(3) });
  pruefe('jugendturnier', turnier);

  const talent = talente(state, 'manager')[0];
  if (talent) {
    const b = talentBewerten(state, 'manager', talent.id);
    console.log(`  • talentBewerten(${talent.name}): ${b.sterne}★, Schätzung ${b.potenzialSchaetzung} ` +
      `(Spanne ${b.spanne[0]}–${b.spanne[1]}, Sicherheit ${b.sicherheit} %), wahres Potenzial ${talent.player.potential}`);
    const res = befoerdern(state, talent.id);
    pruefe('befoerdern', res, true);
    pruefe('zurueckstufen', zurueckstufen(state, talent.id), talent.player.age <= 21);
  }

  const nb = nachwuchsBericht(state, 'manager');
  console.log(`  • nachwuchsBericht: Akademie ${nb.akademie} (Stufe ${nb.stufe}, „${nb.stufeName}“), ` +
    `${nb.anzahl} Talente, ${formatMoney(nb.kostenJahr)}/Jahr, ${nb.regionen.length}/${nb.maxRegionen} Regionen`);
  console.log(`    „${nb.bewertung}“`);
  console.log(`    Empfehlung: ${nb.empfehlung}`);
  const eg = eigengewaechsBonus(state, 'manager');
  console.log(`  • eigengewaechsBonus: ${eg.anzahl} Eigengewächse, Fanbonus +${eg.fanBonus}, ` +
    `Gehaltsersparnis ${formatMoney(eg.gehaltsErsparnis)}`);

  return fehler;
}

/* ------------------------------------------------------------------ *
 *  Lauf
 * ------------------------------------------------------------------ */

console.log('=========================================================================');
console.log(' TRAUMVEREIN — Test: fünf Jahre Jugendarbeit');
console.log('=========================================================================');

const state = baueState();
const postfach = [];
const register = new Map();

const t0 = process.hrtime.bigint();
simuliere(state, postfach, register);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;

const a = auswerten(state, 'gut', register);
const b = auswerten(state, 'schlecht', register);

console.log(`\nSimuliert: ${SEASONS} Saisons × ${SEASON_DAYS} Tage, 3 Vereine, ${round(ms, 0)} ms\n`);
console.log('--- Vergleich nach 5 Jahren ---------------------------------------------');
console.log(`  ${''.padEnd(34)} ${'GUTE AKADEMIE'.padStart(14)}   ${'SCHLECHTE'.padStart(14)}`);
zeile('Akademie (1..100)', a.akademie, b.akademie);
zeile('Wirkung Nachwuchsarbeit', a.jugendWirkung, b.jugendWirkung);
zeile('Wirkung Scouting', a.scoutingWirkung, b.scoutingWirkung);
zeile('Profischwelle des Vereins', a.schwelle, b.schwelle);
zeile('Gesichtete Talente gesamt', a.gesichtet, b.gesichtet);
zeile('Davon befördert', a.befoerdert, b.befoerdert);
zeile('Aussortiert', a.abgaenge, b.abgaenge);
zeile('Eigengewächse im Kader', a.eigengewaechse, b.eigengewaechse);
zeile('… davon profitauglich', a.brauchbar, b.brauchbar);
zeile('… davon Stammspielerformat', a.stammspieler, b.stammspieler);
zeile('Schnittstärke Eigengewächse', a.schnittOvr, b.schnittOvr);
zeile('Marktwert Eigengewächse', formatMoney(a.kaderwert), formatMoney(b.kaderwert));
zeile('Noch im Nachwuchs', a.imNachwuchs, b.imNachwuchs);
zeile('Kosten Nachwuchs (5 Jahre)', formatMoney(a.kosten), formatMoney(b.kosten));
zeile('Preisgelder Jugendturniere', formatMoney(a.einnahmen), formatMoney(b.einnahmen));

const wert = (r) => (r.bester ? `${r.bester.shortName} (${playerOverall(r.bester)}, ${formatMoney(r.bester.value)})` : '—');
zeile('Bester Durchbruch', wert(a), wert(b));

const bilanz = (r) => formatMoney(r.kaderwert + r.einnahmen - r.kosten);
zeile('Bilanz (Wert − Kosten)', bilanz(a), bilanz(b));

console.log('\n--- Wie gut waren die Prognosen? ----------------------------------------');
for (const [label, clubId] of [['Gute Akademie', 'gut'], ['Schlechte Akademie', 'schlecht']]) {
  const stat = sterneStatistik(state, register, clubId);
  const teile = [];
  for (let s = 5; s >= 1; s--) {
    const e = stat[s];
    if (!e) continue;
    teile.push(`${s}★: ${e.profi}/${e.n} Profi`);
  }
  console.log(`  ${label.padEnd(20)} ${teile.join('  |  ')}`);
}

const flops = [...register.values()].filter(r => r.sterne >= 4 && !(state.players[r.id] || {}).eigengewaechs);
const spaetzuender = [...register.values()].filter(r => r.sterne <= 2 && (state.players[r.id] || {}).eigengewaechs);
console.log(`  Hochgelobte Talente ohne Profivertrag: ${flops.length}`);
console.log(`  Unterschätzte Talente mit Profivertrag: ${spaetzuender.length}`);

console.log('\n--- Postfach des Managers -----------------------------------------------');
const nachKind = {};
for (const m of postfach) nachKind[m.kind] = (nachKind[m.kind] || 0) + 1;
console.log(`  ${postfach.length} Nachrichten in 5 Jahren: ` +
  Object.entries(nachKind).map(([k, n]) => `${k} ${n}`).join(', '));
for (const m of postfach.filter(m => m.kind === 'jugend').slice(0, 4)) {
  console.log(`  [S${m.season} T${m.day}] ${m.text.slice(0, 150)}…`);
}

const fehler = aktionenTesten(state);

/* ------------------------------------------------------------------ *
 *  Prüfungen
 * ------------------------------------------------------------------ */

console.log('\n--- Prüfungen -----------------------------------------------------------');
const checks = [
  ['Gute Akademie sichtet mehr Talente', a.gesichtet > b.gesichtet],
  ['Gute Akademie befördert mehr Spieler', a.befoerdert > b.befoerdert],
  ['Gute Akademie liefert stärkere Eigengewächse', a.schnittOvr > b.schnittOvr],
  ['Gute Akademie erzeugt mehr Marktwert', a.kaderwert > b.kaderwert],
  ['Gute Akademie kostet mehr Geld', a.kosten > b.kosten],
  ['Nachwuchs ist kein Selbstläufer (nicht jeder wird Profi)', a.abgaenge > 0],
  ['Prognosen sind unsicher (Flops vorhanden)', flops.length > 0],
  ['Manager bekommt Post aus dem Nachwuchs', postfach.some(m => m.kind === 'jugend')],
  ['Manager bekommt Post aus dem Trainerstab', postfach.some(m => m.kind === 'stab')],
  ['Jugendkosten wurden gebucht', a.kosten > 1000000],
  ['Stabskosten wurden gebucht',
    state.clubs.gut.finances.ledger.some(e => e.kategorie === 'ausgabenStab')],
  ['Keine Aktionsfehler', fehler.length === 0]
];

let schlecht = 0;
for (const [name, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) schlecht++;
}
for (const f of fehler) console.log(`    ! ${f}`);

console.log(`\n${schlecht === 0 ? 'ALLE PRÜFUNGEN BESTANDEN.' : schlecht + ' PRÜFUNG(EN) FEHLGESCHLAGEN.'}`);
process.exitCode = schlecht === 0 ? 0 : 1;
