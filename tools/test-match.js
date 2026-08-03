/**
 * tools/test-match.js — Messlatte für src/engine/match.js
 *
 * Aufruf:  node tools/test-match.js  [anzahlSpiele]
 *
 * Kein Testframework, keine Dependencies. Es wird gemessen, nicht behauptet:
 *   1. 2000 Spiele zwischen unterschiedlich starken Teams (quickSimulate)
 *   2. Alle Zielkorridore aus der Spezifikation
 *   3. Taktik-Wirkung (Konter vs. Pressing) messbar
 *   4. Sauberkeit: keine NaN/undefined, jedes Event mit text/minute/type
 *   5. Tempo von quickSimulate (1000 Spiele < 2 s)
 *   6. Ein voller simulateMatch()-Lauf mit allen Live-Hooks
 */

import { createRng } from '../src/core/rng.js';
import { DIFFICULTIES, POSITION_GROUP } from '../src/core/constants.js';
import { generateSquad } from '../src/data/generator.js';
import { autoLineup } from '../src/engine/tactics.js';
import { simulateMatch, quickSimulate, createMatchState, stepMinute, MATCH_CONSTANTS } from '../src/engine/match.js';
// Unabhängige Wahrheit für die Flughöhen-Invariante: der fertige Physikkern,
// nicht die Zahl, die die Engine ins Segment geschrieben hat.
import { segmentFlug } from '../src/core/ballistik.js';

/* ------------------------------------------------------------------ Harness */

const OK = '  OK  ';
const FAIL = ' FEHL ';
let fails = 0;

function korridor(label, wert, min, max, einheit = '') {
  const gut = wert >= min && wert <= max;
  if (!gut) fails++;
  console.log(`[${gut ? OK : FAIL}] ${label.padEnd(42)} ${wert.toFixed(2).padStart(8)}${einheit}   (Ziel ${min}–${max}${einheit})`);
  return gut;
}

function pruefe(label, bedingung, detail) {
  if (!bedingung) fails++;
  console.log(`[${bedingung ? OK : FAIL}] ${label}${bedingung || !detail ? '' : ' — ' + detail}`);
  return bedingung;
}

function info(label, wert) {
  console.log(`        ${label.padEnd(42)} ${wert}`);
}

function section(t) {
  console.log('\n=== ' + t + ' ===');
}

/* ------------------------------------------------------------ Testmaterial */

const KLUBS = [
  { id: 'rekordmeister', name: 'FC Rekordmeister', shortName: 'Rekord', abbr: 'REK', reputation: 90, leagueId: 'bl1', facilities: { training: 90, medical: 88, youth: 85, scouting: 90 } },
  { id: 'spitzenteam', name: 'Spitzenteam Nord', shortName: 'Nord', abbr: 'NOR', reputation: 79, leagueId: 'bl1', facilities: { training: 78, medical: 76, youth: 70, scouting: 72 } },
  { id: 'mittelmass', name: 'SV Mittelmaß', shortName: 'Mittel', abbr: 'MIT', reputation: 70, leagueId: 'bl1', facilities: { training: 60, medical: 60, youth: 58, scouting: 55 } },
  { id: 'kellerkind', name: 'FC Kellerkind', shortName: 'Keller', abbr: 'KEL', reputation: 61, leagueId: 'bl1', facilities: { training: 45, medical: 45, youth: 44, scouting: 40 } },
  { id: 'aufsteiger', name: 'Aufsteiger 04', shortName: 'Auf04', abbr: 'AUF', reputation: 52, leagueId: 'bl1', facilities: { training: 38, medical: 38, youth: 40, scouting: 35 } }
];

/** Laufzeitfelder wie core/state.js sie setzt (data/ liefert sie nicht mit). */
function laufzeit(p, rng) {
  p.form = Math.max(20, Math.min(80, Math.round(rng.gauss(50, 12))));
  p.morale = Math.max(30, Math.min(95, Math.round(rng.gauss(68, 10))));
  p.fitness = Math.max(70, Math.min(100, Math.round(rng.gauss(94, 6))));
  p.sharpness = Math.max(25, Math.min(85, Math.round(rng.gauss(58, 10))));
  p.injury = null;
  p.cards = { yellow: 0, red: 0, ban: 0 };
  p.stats = { season: {}, career: {} };
  p.seasonsAtClub = rng.int(1, 5);
  return p;
}

function baueTeam(club, seed, opts = {}) {
  const rng = createRng('kader:' + club.id + ':' + seed);
  const players = generateSquad(rng, club, { size: 22 }).map(p => laufzeit(p, rng));
  const tactics = autoLineup(players, {
    formation: opts.formation || '4-4-2',
    style: opts.style || 'ausgeglichen',
    sliders: opts.sliders || { tempo: 50, breite: 50, pressinghoehe: 50, risiko: 50, haerte: 50, offensivdrang: 50 },
    instructions: opts.instructions || {}
  }, { respectFitness: true });
  return { club, players, tactics };
}

function matchTeam(basis, isHome, opts = {}) {
  const tactics = Object.assign({}, basis.tactics);
  if (opts.style) tactics.style = opts.style;
  if (opts.sliders) tactics.sliders = Object.assign({}, tactics.sliders, opts.sliders);
  if (opts.instructions) tactics.instructions = Object.assign({}, tactics.instructions, opts.instructions);
  if (opts.formation) tactics.formation = opts.formation;
  return {
    club: basis.club,
    players: basis.players,
    tactics,
    morale: opts.morale != null ? opts.morale : 65,
    tiredness: opts.tiredness || 6,
    coachBonus: opts.coachBonus != null ? opts.coachBonus : Math.min(92, basis.club.reputation * 0.85 + 8),
    chemistryHistory: 45,
    isHome
  };
}

const WETTER = ['sonnig', 'bewoelkt', 'regen', 'wind', 'bewoelkt', 'sonnig'];

function umfeld(rng, homeClub) {
  const capacity = 20000 + Math.round(homeClub.reputation * 700);
  return {
    venue: {
      capacity,
      attendance: Math.round(capacity * (0.55 + rng.next() * 0.44)),
      stadiumName: homeClub.shortName + '-Arena',
      pitch: rng.int(60, 98),
      weather: rng.pick(WETTER),
      temperature: rng.int(2, 26),
      heimvorteil: 1.02 + rng.next() * 0.09
    },
    referee: { name: 'Testpfeife', strictness: rng.int(30, 85), homeBias: rng.int(35, 65) }
  };
}

/* ------------------------------------------------- Sammler für die Messung */

function neuerSammler() {
  return {
    n: 0, toreH: 0, toreA: 0, schuesse: 0, aufTor: 0, ecken: 0, fouls: 0,
    gelb: 0, rot: 0, abseits: 0, xg: 0, paesse: 0, passQuote: 0, zweikaempfe: 0,
    besitzMin: 100, besitzMax: 0, besitzAbw: 0,
    nullNull: 0, ergebnisse: new Map(),
    punkteStark: 0, siegeStark: 0, remis: 0, siegeSchwach: 0,
    torPos: { TW: 0, ABW: 0, MIT: 0, STU: 0 }, eigentore: 0,
    standardTore: 0, elfmeter: 0, verletzungen: 0, motmFehlt: 0,
    minutenSumme: 0, notenSumme: 0, notenAnzahl: 0, besitzWerte: [], besitzAusgeglichen: []
  };
}

function sammle(s, res, heimStaerker, spieler) {
  s.n++;
  const [h, a] = res.score;
  s.toreH += h; s.toreA += a;
  s.schuesse += res.stats.home.shots + res.stats.away.shots;
  s.aufTor += res.stats.home.shotsOnTarget + res.stats.away.shotsOnTarget;
  s.ecken += res.stats.home.corners + res.stats.away.corners;
  s.fouls += res.stats.home.fouls + res.stats.away.fouls;
  s.gelb += res.stats.home.yellow + res.stats.away.yellow;
  s.rot += res.stats.home.red + res.stats.away.red;
  s.abseits += res.stats.home.offsides + res.stats.away.offsides;
  s.xg += res.stats.home.xg + res.stats.away.xg;
  s.paesse += res.stats.home.passes + res.stats.away.passes;
  s.zweikaempfe += res.stats.home.tackles + res.stats.away.tackles;
  s.passQuote += (res.stats.home.passAccuracy + res.stats.away.passAccuracy) / 2;
  s.standardTore += res.stats.home.standardTore + res.stats.away.standardTore;
  s.verletzungen += (res.verletzte || []).length;

  const bh = res.stats.home.possession;
  if (bh < s.besitzMin) s.besitzMin = bh;
  if (bh > s.besitzMax) s.besitzMax = bh;
  s.besitzAbw += Math.abs(bh - 50);
  s.besitzWerte.push(bh);
  if (heimStaerker === null) s.besitzAusgeglichen.push(bh);

  if (h === 0 && a === 0) s.nullNull++;
  const key = h + ':' + a;
  s.ergebnisse.set(key, (s.ergebnisse.get(key) || 0) + 1);

  if (heimStaerker != null) {
    const starkTore = heimStaerker ? h : a;
    const schwachTore = heimStaerker ? a : h;
    if (starkTore > schwachTore) { s.punkteStark += 3; s.siegeStark++; }
    else if (starkTore === schwachTore) { s.punkteStark += 1; s.remis++; }
    else s.siegeSchwach++;
  }

  for (const t of res.torschuetzen) {
    if (t.eigentor) { s.eigentore++; continue; }
    const p = spieler.get(t.playerId);
    const g = p ? (POSITION_GROUP[p.position] || 'MIT') : 'MIT';
    s.torPos[g]++;
  }
  if (!res.motm) s.motmFehlt++;
  for (const id in res.ratings) { s.notenSumme += res.ratings[id]; s.notenAnzahl++; }
  for (const id in res.playerStats) s.minutenSumme += res.playerStats[id].minuten;
}

/** Prüft ein Ergebnis auf NaN/undefined. */
function sauber(res) {
  const probleme = [];
  const zahl = (v, wo) => { if (typeof v !== 'number' || !isFinite(v)) probleme.push(wo + '=' + v); };
  zahl(res.score[0], 'score0'); zahl(res.score[1], 'score1');
  for (const seite of ['home', 'away']) {
    const st = res.stats[seite];
    for (const k of ['possession', 'shots', 'shotsOnTarget', 'xg', 'corners', 'fouls', 'offsides', 'passes', 'passAccuracy', 'tackles', 'yellow', 'red']) {
      zahl(st[k], seite + '.' + k);
    }
  }
  if (res.stats.home.possession + res.stats.away.possession !== 100) probleme.push('Ballbesitz != 100');
  for (const id in res.ratings) zahl(res.ratings[id], 'note:' + id);
  for (const id in res.playerStats) {
    const ps = res.playerStats[id];
    for (const k of ['minuten', 'tore', 'vorlagen', 'schuesse', 'paraden', 'zweikaempfe']) zahl(ps[k], 'ps.' + k);
  }
  for (const t of res.torschuetzen) {
    if (!t.playerId) probleme.push('Torschütze ohne playerId');
    if (typeof t.minute !== 'number') probleme.push('Torschütze ohne Minute');
    if (t.team !== 'home' && t.team !== 'away') probleme.push('Torschütze ohne Team');
    if (typeof t.eigentor !== 'boolean') probleme.push('Torschütze ohne eigentor-Flag');
  }
  return probleme;
}

/* ================================================================= 1. Masse */

const ANZAHL = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 2000;

section(`Massentest — ${ANZAHL} Spiele (quickSimulate)`);

const teams = new Map();
const spielerIndex = new Map();
for (const c of KLUBS) {
  const t = baueTeam(c, 1);
  teams.set(c.id, t);
  for (const p of t.players) spielerIndex.set(p.id, p);
}

const paarungen = [];
for (let i = 0; i < KLUBS.length; i++) {
  for (let j = 0; j < KLUBS.length; j++) {
    if (i !== j) paarungen.push([KLUBS[i].id, KLUBS[j].id]);
  }
}

const gesamt = neuerSammler();
const probleme = [];
const t0 = process.hrtime.bigint();

for (let k = 0; k < ANZAHL; k++) {
  const [hid, aid] = paarungen[k % paarungen.length];
  const rng = createRng('spiel:' + k);
  const u = umfeld(rng, KLUBS.find(c => c.id === hid));
  const res = quickSimulate({
    home: matchTeam(teams.get(hid), true),
    away: matchTeam(teams.get(aid), false),
    rng,
    venue: u.venue,
    referee: u.referee,
    difficulty: DIFFICULTIES.profi,
    competition: { id: 'bl1', name: '1. Bundesliga', matchday: (k % 34) + 1, neutral: false }
  });
  const repH = KLUBS.find(c => c.id === hid).reputation;
  const repA = KLUBS.find(c => c.id === aid).reputation;
  sammle(gesamt, res, Math.abs(repH - repA) >= 15 ? repH > repA : null, spielerIndex);
  if (k < 200) probleme.push(...sauber(res));
}

const t1 = process.hrtime.bigint();
const msGesamt = Number(t1 - t0) / 1e6;

const n = gesamt.n;
const toreProSpiel = (gesamt.toreH + gesamt.toreA) / n;
const heimvorteil = (gesamt.toreH - gesamt.toreA) / n;

info('Rechenzeit', `${msGesamt.toFixed(0)} ms für ${n} Spiele (${(msGesamt / n).toFixed(2)} ms/Spiel)`);
console.log('');

korridor('Tore pro Spiel', toreProSpiel, 2.8, 3.2);
korridor('Heimvorteil (Tordifferenz)', heimvorteil, 0.25, 0.48);
korridor('Schüsse pro Spiel', gesamt.schuesse / n, 22, 28);
korridor('Schüsse aufs Tor', gesamt.aufTor / n, 8, 10);
korridor('Ecken pro Spiel', gesamt.ecken / n, 9, 11);
korridor('Fouls pro Spiel', gesamt.fouls / n, 20, 26);
korridor('Gelbe Karten', gesamt.gelb / n, 3.5, 4.5);
korridor('Rote Karten', gesamt.rot / n, 0.05, 0.12);
korridor('Abseits', gesamt.abseits / n, 3, 5);
korridor('Passquote', gesamt.passQuote / n, 74, 88, ' %');
korridor('0:0-Anteil', gesamt.nullNull / n * 100, 5, 12, ' %');
korridor('xG pro Spiel', gesamt.xg / n, 2.5, 3.6);
korridor('Verletzungen pro Spiel', gesamt.verletzungen / n, 0.12, 0.45);
korridor('Standardtore', gesamt.standardTore / Math.max(1, gesamt.toreH + gesamt.toreA) * 100, 22, 34, ' %');

// Zählraten, 2026-07 nachgemessen.
// Pässe: vorher 1.470 je Partie, das war zu hoch. Eine Bundesligapartie kommt auf
// rund 800–1.000 Pässe (beide Teams zusammen), auch wenn eine Mannschaft dominiert.
// Zweikämpfe: hier wurde NICHT nachgezogen, und zwar bewusst. Die deutsche Zählweise
// (DFL) bucht jeden Zweikampf, ein Bundesligaspiel liegt bei 180–220 – die 180 der
// Engine waren also richtig. Ein Absenken auf ~100 hätte die Realität verfehlt und
// nebenbei die Chemie-, Moral- und Europapokal-Prüfstände gerissen, weil der
// zusätzliche Zufallszug die gepaarten Ströme dieser Tests entkoppelt.
korridor('Pässe pro Spiel (beide Teams)', gesamt.paesse / n, 850, 1000);
korridor('Zweikämpfe pro Spiel (beide Teams)', gesamt.zweikaempfe / n, 165, 215);
info('Ballbesitz Heim min/max', `${gesamt.besitzMin} % … ${gesamt.besitzMax} %`);
info('Mittlere Abweichung von 50:50', (gesamt.besitzAbw / n).toFixed(1) + ' Prozentpunkte');
info('Eigentore pro Spiel', (gesamt.eigentore / n).toFixed(3));
info('Notenschnitt', (gesamt.notenSumme / Math.max(1, gesamt.notenAnzahl)).toFixed(2));
info('Einsatzminuten pro Spiel', (gesamt.minutenSumme / n).toFixed(0) + ' (Soll ≈ 1980)');

const perzentil = (arr, q) => {
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * q))];
};
const pa25 = perzentil(gesamt.besitzAusgeglichen, 0.25);
const pa75 = perzentil(gesamt.besitzAusgeglichen, 0.75);
info('Ballbesitz Heim 5 %/95 % (alle Paarungen)', `${perzentil(gesamt.besitzWerte, 0.05)} % … ${perzentil(gesamt.besitzWerte, 0.95)} %`);
info('Ballbesitz Heim 5 %/95 % (ebenbürtig)', `${perzentil(gesamt.besitzAusgeglichen, 0.05)} % … ${perzentil(gesamt.besitzAusgeglichen, 0.95)} %`);
info('Ballbesitz Heim 25 %/75 % (ebenbürtig)', `${pa25} % … ${pa75} %`);
pruefe('Typischer Ballbesitz ebenbürtiger Teams zwischen 40:60 und 60:40', pa25 >= 40 && pa75 <= 60, `${pa25}…${pa75}`);
pruefe('Auch Extremspiele bleiben plausibel (15–85 %)',
  gesamt.besitzMin >= 15 && gesamt.besitzMax <= 85, `${gesamt.besitzMin}…${gesamt.besitzMax}`);

section('Häufigste Ergebnisse');
const top = [...gesamt.ergebnisse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [erg, anz] of top) {
  const pct = anz / n * 100;
  console.log(`        ${erg.padEnd(6)} ${String(anz).padStart(5)}   ${pct.toFixed(1).padStart(5)} %  ${'█'.repeat(Math.round(pct))}`);
}
const topKeys = top.map(t => t[0]);
pruefe('1:0, 2:1, 1:1 und 2:0 unter den zehn häufigsten Ergebnissen',
  ['1:0', '2:1', '1:1', '2:0'].every(k => topKeys.includes(k)), topKeys.join(' '));

section('Torschützen nach Positionsgruppe');
const torSumme = gesamt.torPos.TW + gesamt.torPos.ABW + gesamt.torPos.MIT + gesamt.torPos.STU;
for (const g of ['STU', 'MIT', 'ABW', 'TW']) {
  const pct = gesamt.torPos[g] / Math.max(1, torSumme) * 100;
  console.log(`        ${g.padEnd(6)} ${String(gesamt.torPos[g]).padStart(6)}   ${pct.toFixed(1).padStart(5)} %  ${'█'.repeat(Math.round(pct / 2))}`);
}
const antSTU = gesamt.torPos.STU / Math.max(1, torSumme);
const antMIT = gesamt.torPos.MIT / Math.max(1, torSumme);
const antABW = gesamt.torPos.ABW / Math.max(1, torSumme);
pruefe('Stürmer treffen häufiger als Mittelfeld, Mittelfeld häufiger als Abwehr',
  antSTU > antMIT && antMIT > antABW,
  `STU ${(antSTU * 100).toFixed(1)} % / MIT ${(antMIT * 100).toFixed(1)} % / ABW ${(antABW * 100).toFixed(1)} %`);

section('Stärkeres Team gewinnt öfter');
const duelle = gesamt.siegeStark + gesamt.remis + gesamt.siegeSchwach;
const punkteSchnitt = gesamt.punkteStark / Math.max(1, duelle);
info('Duelle mit klarem Stärkeunterschied', String(duelle));
info('Siege stärkeres Team', `${gesamt.siegeStark} (${(gesamt.siegeStark / duelle * 100).toFixed(1)} %)`);
info('Remis', `${gesamt.remis} (${(gesamt.remis / duelle * 100).toFixed(1)} %)`);
info('Siege schwächeres Team', `${gesamt.siegeSchwach} (${(gesamt.siegeSchwach / duelle * 100).toFixed(1)} %)`);
korridor('Punkteschnitt des stärkeren Teams', punkteSchnitt, 1.75, 2.45, ' P');
pruefe('… aber der Außenseiter gewinnt trotzdem regelmäßig',
  gesamt.siegeSchwach / duelle > 0.10, `${(gesamt.siegeSchwach / duelle * 100).toFixed(1)} %`);

section('Datensauberkeit');
pruefe('Keine NaN/undefined in 200 Ergebnissen', probleme.length === 0, probleme.slice(0, 5).join(', '));

/* ============================================================ 2. Taktikwirkung */

section('Taktik muss sichtbar wirken');

function taktikLauf(label, homeOpts, awayOpts, spiele = 500) {
  const s = neuerSammler();
  const hStats = { shots: 0, xgProSchuss: 0, corners: 0, possession: 0, tore: 0, ecken: 0 };
  const aStats = { shots: 0, xgProSchuss: 0, corners: 0, possession: 0, tore: 0, ecken: 0 };
  for (let k = 0; k < spiele; k++) {
    const rng = createRng('taktik:' + label + ':' + k);
    const u = umfeld(rng, KLUBS[2]);
    const res = quickSimulate({
      home: matchTeam(teams.get('mittelmass'), true, homeOpts),
      away: matchTeam(teams.get('spitzenteam'), false, awayOpts),
      rng, venue: u.venue, referee: u.referee,
      difficulty: DIFFICULTIES.profi,
      competition: { id: 'bl1', name: '1. Bundesliga', matchday: 1, neutral: false }
    });
    sammle(s, res, null, spielerIndex);
    hStats.shots += res.stats.home.shots;
    hStats.corners += res.stats.home.corners;
    hStats.possession += res.stats.home.possession;
    hStats.tore += res.score[0];
    hStats.xgProSchuss += res.stats.home.shots ? res.stats.home.xg / res.stats.home.shots : 0;
    aStats.shots += res.stats.away.shots;
    aStats.corners += res.stats.away.corners;
    aStats.possession += res.stats.away.possession;
    aStats.tore += res.score[1];
    aStats.xgProSchuss += res.stats.away.shots ? res.stats.away.xg / res.stats.away.shots : 0;
  }
  const m = (o) => ({
    shots: o.shots / spiele, corners: o.corners / spiele, possession: o.possession / spiele,
    tore: o.tore / spiele, xgProSchuss: o.xgProSchuss / spiele
  });
  return { home: m(hStats), away: m(aStats), n: spiele };
}

const konter = taktikLauf('konter', { style: 'konter', sliders: { pressinghoehe: 24, tempo: 66, risiko: 44 } }, { style: 'ausgeglichen' });
const pressing = taktikLauf('pressing', { style: 'pressing', sliders: { pressinghoehe: 88, tempo: 70, risiko: 60 } }, { style: 'ausgeglichen' });
const besitz = taktikLauf('ballbesitz', { style: 'ballbesitz', sliders: { pressinghoehe: 58, tempo: 42, risiko: 38 } }, { style: 'ausgeglichen' });
const kickrush = taktikLauf('kickrush', { style: 'kick_and_rush', sliders: { pressinghoehe: 60, tempo: 78, risiko: 70 } }, { style: 'ausgeglichen' });

const tab = (name, r) => console.log(
  `        ${name.padEnd(16)} Schüsse ${r.home.shots.toFixed(1).padStart(5)}  xG/Schuss ${r.home.xgProSchuss.toFixed(3)}  ` +
  `Ecken ${r.home.corners.toFixed(1).padStart(4)}  Besitz ${r.home.possession.toFixed(1).padStart(5)} %  ` +
  `Tore ${r.home.tore.toFixed(2)}  Gegentore ${r.away.tore.toFixed(2)}`);

tab('Konter', konter);
tab('Pressing', pressing);
tab('Ballbesitz', besitz);
tab('Kick and Rush', kickrush);

pruefe('Konter erzeugt weniger, aber bessere Chancen als Ballbesitz',
  konter.home.shots < besitz.home.shots && konter.home.xgProSchuss > besitz.home.xgProSchuss,
  `Schüsse ${konter.home.shots.toFixed(1)} vs ${besitz.home.shots.toFixed(1)}, xG/Schuss ${konter.home.xgProSchuss.toFixed(3)} vs ${besitz.home.xgProSchuss.toFixed(3)}`);
pruefe('Ballbesitz hält mehr Ball als Konter',
  besitz.home.possession > konter.home.possession + 2,
  `${besitz.home.possession.toFixed(1)} % vs ${konter.home.possession.toFixed(1)} %`);
pruefe('Pressing erzeugt mehr Chancen als Konter, kassiert aber auch mehr',
  pressing.home.shots > konter.home.shots && pressing.away.tore > konter.away.tore,
  `Schüsse ${pressing.home.shots.toFixed(1)} vs ${konter.home.shots.toFixed(1)}, Gegentore ${pressing.away.tore.toFixed(2)} vs ${konter.away.tore.toFixed(2)}`);
pruefe('Kick and Rush holt mehr Ecken als Ballbesitz',
  kickrush.home.corners > besitz.home.corners,
  `${kickrush.home.corners.toFixed(2)} vs ${besitz.home.corners.toFixed(2)}`);

const konterVsPressing = taktikLauf('kvp', { style: 'konter', sliders: { pressinghoehe: 24 } }, { style: 'pressing', sliders: { pressinghoehe: 88 } }, 400);
const pressingVsKonter = taktikLauf('pvk', { style: 'pressing', sliders: { pressinghoehe: 88 } }, { style: 'konter', sliders: { pressinghoehe: 24 } }, 400);
info('Konter (H) gegen Pressing (A)', `${konterVsPressing.home.tore.toFixed(2)} : ${konterVsPressing.away.tore.toFixed(2)}`);
info('Pressing (H) gegen Konter (A)', `${pressingVsKonter.home.tore.toFixed(2)} : ${pressingVsKonter.away.tore.toFixed(2)}`);
pruefe('Konter gegen Pressing ändert die Statistik messbar',
  Math.abs(konterVsPressing.home.shots - pressingVsKonter.home.shots) > 1.5,
  `${konterVsPressing.home.shots.toFixed(1)} vs ${pressingVsKonter.home.shots.toFixed(1)}`);

/* ================================================================ 3. Tempo */

section('Geschwindigkeit von quickSimulate');
{
  const rng0 = createRng('speed');
  const h = matchTeam(teams.get('mittelmass'), true);
  const a = matchTeam(teams.get('spitzenteam'), false);
  const u = umfeld(rng0, KLUBS[2]);
  // Aufwärmen (JIT)
  for (let i = 0; i < 100; i++) {
    quickSimulate({ home: h, away: a, rng: createRng('warm' + i), venue: u.venue, referee: u.referee, difficulty: DIFFICULTIES.profi, competition: { id: 'bl1', matchday: 1 } });
  }
  const s0 = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) {
    quickSimulate({ home: h, away: a, rng: createRng('speed' + i), venue: u.venue, referee: u.referee, difficulty: DIFFICULTIES.profi, competition: { id: 'bl1', matchday: 1 } });
  }
  const s1 = process.hrtime.bigint();
  const dauer = Number(s1 - s0) / 1e6;
  info('1000 Spiele', `${dauer.toFixed(0)} ms`);
  pruefe('1000 Spiele in unter 2000 ms', dauer < 2000, `${dauer.toFixed(0)} ms`);
}

/* ====================================================== 4. Voller Live-Lauf */

section('simulateMatch() mit allen Live-Hooks');

const gerufen = { event: 0, phase: 0, minute: 0, halftime: 0, keyMoment: 0 };
const gesehenTypen = new Set();
let eventProbleme = 0;
let phaseProbleme = 0;
let letzteMinute = 0;
let minutenMonoton = true;

const heimLive = matchTeam(teams.get('rekordmeister'), true, { style: 'ballbesitz' });
const gastLive = matchTeam(teams.get('kellerkind'), false, { style: 'konter' });
heimLive.pendingSubs = [];

const rngLive = createRng('live-test');
const uLive = umfeld(rngLive, KLUBS[0]);

let wechselGeplant = false;
const liveResult = await simulateMatch({
  home: heimLive, away: gastLive,
  rng: rngLive,
  venue: uLive.venue,
  referee: uLive.referee,
  difficulty: DIFFICULTIES.profi,
  competition: { id: 'bl1', name: '1. Bundesliga', matchday: 7, neutral: false },
  interactive: true,
  interactiveSide: 'home',
  keyMomentFilter: { elfmeter: true, freistoss: true, ecke: true, abschluss: true, kombination: true },
  onEvent: (ev) => {
    gerufen.event++;
    gesehenTypen.add(ev.type);
    if (!ev.text || typeof ev.text !== 'string' || !ev.text.length) eventProbleme++;
    if (typeof ev.minute !== 'number' || !isFinite(ev.minute)) eventProbleme++;
    if (!ev.type) eventProbleme++;
    if (!ev.at || typeof ev.at.x !== 'number' || typeof ev.at.y !== 'number') eventProbleme++;
    if (!Array.isArray(ev.score) || ev.score.length !== 2) eventProbleme++;
    if (ev.minute < letzteMinute) minutenMonoton = false;
    letzteMinute = ev.minute;
  },
  onPhase: (ph) => {
    gerufen.phase++;
    if (!Array.isArray(ph.ball) || !ph.ball.length) { phaseProbleme++; return; }
    for (const b of ph.ball) {
      if (!(b.x >= 0 && b.x <= 105) || !(b.y >= 0 && b.y <= 68) || !(b.t >= 0 && b.t <= 1)) phaseProbleme++;
    }
    if (!(ph.duration >= 0.6 && ph.duration <= 9)) phaseProbleme++;
    if (!Array.isArray(ph.actors) || !ph.actors.length) phaseProbleme++;
    if (!['aufbau', 'angriff', 'konter', 'standard', 'abwehr'].includes(ph.kind)) phaseProbleme++;
    if (ph.eventIndex !== null && typeof ph.eventIndex !== 'number') phaseProbleme++;
    for (const ac of ph.actors || []) {
      if (!ac.playerId) phaseProbleme++;
      if (!(ac.x >= 0 && ac.x <= 105) || !(ac.y >= 0 && ac.y <= 68)) phaseProbleme++;
    }
  },
  onMinute: (minute, i) => {
    gerufen.minute++;
    // Ab Minute 60 einen Wechsel anfordern
    if (!wechselGeplant && minute >= 60) {
      const drin = Object.values(heimLive.tactics.lineup);
      const bank = heimLive.tactics.bench.filter(Boolean);
      const raus = drin.find(id => {
        const p = teams.get('rekordmeister').players.find(q => q.id === id);
        return p && p.position !== 'TW';
      });
      const rein = bank.find(id => {
        const p = teams.get('rekordmeister').players.find(q => q.id === id);
        return p && p.position !== 'TW';
      });
      if (raus && rein) {
        heimLive.pendingSubs.push({ raus, rein });
        wechselGeplant = true;
        globalThis.__wechselRein = rein;
      }
    }
  },
  onHalftime: async (i) => {
    gerufen.halftime++;
    if (!i || !Array.isArray(i.score) || !i.stats || !i.ratings) eventProbleme++;
    heimLive.ansprache = { art: 'fordernd', wirkung: Object.fromEntries(Object.values(heimLive.tactics.lineup).map(id => [id, 8])) };
  },
  onKeyMoment: async (moment) => {
    gerufen.keyMoment++;
    // Struktur nach CONTRACTS 6.1 prüfen
    if (!['abschluss', 'kombination', 'elfmeter', 'freistoss', 'ecke'].includes(moment.kind)) eventProbleme++;
    if (moment.team !== 'home') eventProbleme++;
    if (!moment.actor || !moment.actor.id || !moment.actor.attributes) eventProbleme++;
    if (moment.keeper && !moment.keeper.attributes) eventProbleme++;
    if (!Array.isArray(moment.defenders)) eventProbleme++;
    if (!Array.isArray(moment.targets)) eventProbleme++;
    if (!moment.at || typeof moment.at.x !== 'number') eventProbleme++;
    if (!(moment.baseChance >= 0 && moment.baseChance <= 1)) eventProbleme++;
    if (!(moment.pressure >= 0 && moment.pressure <= 100)) eventProbleme++;
    if (!moment.context || !Array.isArray(moment.context.score)) eventProbleme++;
    // Test-Resolution: mal gut, mal schlecht, mal Abbruch
    const w = gerufen.keyMoment % 3;
    if (w === 0) return null;
    if (w === 1) return { outcome: 'tor', quality: 0.92, targetPlayerId: null, xgDelta: 0.10 };
    return { outcome: 'daneben', quality: 0.15, targetPlayerId: null, xgDelta: -0.05 };
  }
});

info('onEvent', String(gerufen.event));
info('onPhase', String(gerufen.phase));
info('onMinute', String(gerufen.minute));
info('onHalftime', String(gerufen.halftime));
info('onKeyMoment', String(gerufen.keyMoment));
info('Ergebnis', `${liveResult.score[0]}:${liveResult.score[1]}`);
info('Ereignisarten', [...gesehenTypen].sort().join(', '));

pruefe('onEvent wurde gerufen', gerufen.event > 20, String(gerufen.event));
pruefe('onPhase wurde gerufen', gerufen.phase > 60, String(gerufen.phase));
pruefe('onMinute wurde für jede Spielminute gerufen', gerufen.minute >= 90 && gerufen.minute <= 102, String(gerufen.minute));
pruefe('onHalftime wurde genau einmal gerufen', gerufen.halftime === 1, String(gerufen.halftime));
pruefe('onKeyMoment wurde gerufen', gerufen.keyMoment > 0, String(gerufen.keyMoment));
pruefe('Key Moments bleiben im Budget 8–14', gerufen.keyMoment <= 14, String(gerufen.keyMoment));
pruefe('Jedes Event hat text/minute/type/at/score', eventProbleme === 0, String(eventProbleme) + ' Verstöße');
pruefe('Alle Phasen mit plausiblen Meter-Koordinaten', phaseProbleme === 0, String(phaseProbleme) + ' Verstöße');
pruefe('Minuten laufen monoton vorwärts', minutenMonoton);
pruefe('Anpfiff, Halbzeit und Abpfiff im Ticker',
  gesehenTypen.has('anpfiff') && gesehenTypen.has('halbzeit') && gesehenTypen.has('abpfiff'));
pruefe('Wechsel über pendingSubs ausgeführt',
  gesehenTypen.has('wechsel') && !!liveResult.playerStats[globalThis.__wechselRein] && liveResult.playerStats[globalThis.__wechselRein].minuten > 0,
  'Einwechselspieler ohne Minuten');
pruefe('pendingSubs wurde von der Engine geleert', heimLive.pendingSubs.length === 0);
pruefe('ansprache wurde von der Engine auf null gesetzt', heimLive.ansprache === null);
pruefe('phases[] und events[] sind im Ergebnis enthalten',
  liveResult.phases.length === gerufen.phase && liveResult.events.length === gerufen.event);
pruefe('eventIndex zeigt auf gültige Events',
  liveResult.phases.every(p => p.eventIndex === null || (p.eventIndex >= 0 && p.eventIndex < liveResult.events.length)));
pruefe('summaryText hat 6–12 Zeilen', liveResult.summaryText.length >= 6 && liveResult.summaryText.length <= 12, String(liveResult.summaryText.length));
pruefe('motm ist gesetzt und hat Einsatzminuten',
  !!liveResult.motm && !!liveResult.playerStats[liveResult.motm] && liveResult.playerStats[liveResult.motm].minuten > 0);
pruefe('Alle Noten liegen zwischen 1 und 10',
  Object.values(liveResult.ratings).every(v => v >= 1 && v <= 10));
pruefe('Keine NaN im Live-Ergebnis', sauber(liveResult).length === 0, sauber(liveResult).slice(0, 3).join(', '));

section('Spielbericht');
for (const z of liveResult.summaryText) console.log('        ' + z);

section('Ticker-Auszug (erste 12 Höhepunkte)');
const hoehe = liveResult.events.filter(e => ['tor', 'grosschance', 'parade', 'gelb', 'rot', 'gelbrot', 'elfmeter', 'latte', 'pfosten', 'wechsel', 'verletzung'].includes(e.type)).slice(0, 12);
for (const e of hoehe) console.log(`        ${String(e.minute).padStart(3)}'  [${e.type.padEnd(12)}] ${e.text}`);

/* ======================================== 5. createMatchState / stepMinute */

section('createMatchState() + stepMinute()');
{
  const rng = createRng('step');
  const u = umfeld(rng, KLUBS[1]);
  const ms = createMatchState({
    home: matchTeam(teams.get('spitzenteam'), true),
    away: matchTeam(teams.get('mittelmass'), false),
    rng, venue: u.venue, referee: u.referee,
    difficulty: DIFFICULTIES.profi,
    competition: { id: 'bl1', name: '1. Bundesliga', matchday: 3 }
  });
  let evts = 0, phs = 0, schritte = 0;
  while (!ms.ende && schritte++ < 120) {
    const r = stepMinute(ms);
    evts += r.events.length;
    phs += r.phases.length;
  }
  info('Schritte bis Abpfiff', String(schritte));
  info('Events / Phasen', `${evts} / ${phs}`);
  pruefe('stepMinute() läuft synchron bis zum Abpfiff', ms.ende && schritte >= 90 && schritte <= 105, String(schritte));
  pruefe('stepMinute() liefert Events und Phasen', evts > 20 && phs > 60);
}

/* ================================= 5b. Phasen-Schema v2 (CONTRACTS §6/§10) */

section('Phasen-Schema v2 — Segmente, echte Akteure, physikalische Zeiten');
{
  const SPIELE = 12;
  const zaehler = new Map();
  const melde = (k) => zaehler.set(k, (zaehler.get(k) || 0) + 1);

  let phasen = 0, mitSegmenten = 0, mitActors = 0, segSumme = 0, actorSumme = 0;
  let durSumme = 0, ballSumme = 0;
  const rollen = new Set(), typen = new Set();
  // Für die Flughöhen-Invariante weiter unten: die hoch gespielten Segmente roh
  // mitschreiben, samt der Auskunft, OB die Engine ein height-Feld gesetzt hat.
  const hoch = [];

  for (let g = 0; g < SPIELE; g++) {
    const rng = createRng('phase-v2:' + g);
    const u = umfeld(rng, KLUBS[0]);
    const ms = createMatchState({
      home: matchTeam(teams.get('rekordmeister'), true, { style: 'ballbesitz' }),
      away: matchTeam(teams.get('mittelmass'), false, { style: 'konter' }),
      rng, venue: u.venue, referee: u.referee,
      difficulty: DIFFICULTIES.profi,
      competition: { id: 'bl1', name: '1. Bundesliga', matchday: 5 }
    });
    let schritte = 0;
    while (!ms.ende && schritte++ < 130) {
      const schritt = stepMinute(ms);
      for (const ph of schritt.phases) {
        phasen++;
        const eigene = ms.sides[ph.team];
        const fremde = ms.sides[ph.team === 'home' ? 'away' : 'home'];
        // „In dieser Minute auf dem Platz" heißt: aktuell drauf ODER erst in
        // eben dieser Minute runter (Rote Karte, Auswechslung) – zum Zeitpunkt
        // der Phase stand er noch auf dem Feld.
        const platzSatz = (seite) => {
          const s = new Set();
          for (const a of seite.alle) {
            if (a.aufDemPlatz || a.aus === ph.minute) s.add(a.id);
          }
          return s;
        };
        const aufPlatz = platzSatz(eigene);
        const gegenPlatz = platzSatz(fremde);

        /* --- Pflichtfelder: ball[] UND actors[], auch mit segments --------- */
        if (!Array.isArray(ph.ball) || !ph.ball.length) melde('ball[] fehlt');
        else ballSumme += ph.ball.length;
        if (!Array.isArray(ph.actors) || !ph.actors.length) melde('actors[] fehlt');
        else { mitActors++; actorSumme += ph.actors.length; }
        if (Array.isArray(ph.segments) && ph.segments.length) {
          mitSegmenten++;
          segSumme += ph.segments.length;
          if (ph.v !== 2) melde('segments ohne v:2');
        }

        /* --- duration in [0,6; 9] s --------------------------------------- */
        if (!(ph.duration >= 0.6 && ph.duration <= 9)) melde('duration außerhalb 0,6–9 s');
        durSumme += ph.duration;

        /* --- ball[]: monotone Zeit, letzter Punkt t = 1 -------------------- */
        let tv = -1;
        for (const b of ph.ball || []) {
          if (!(b.x >= 0 && b.x <= 105) || !(b.y >= 0 && b.y <= 68)) melde('Ballpunkt außerhalb des Feldes');
          if (!(b.t >= 0 && b.t <= 1)) melde('Ball-t außerhalb 0..1');
          if (b.t < tv - 1e-9) melde('Ball-t läuft rückwärts');
          tv = b.t;
        }
        if (ph.ball && ph.ball.length && ph.ball[ph.ball.length - 1].t !== 1) melde('letzter Ballpunkt hat t != 1');

        /* --- actors: echte Spieler, je playerId genau einer, nicht im Netz - */
        const gesehen = new Set();
        for (const ac of ph.actors || []) {
          if (!ac.playerId) melde('Akteur ohne playerId');
          if (gesehen.has(ac.playerId)) melde('playerId doppelt in actors[]');
          gesehen.add(ac.playerId);
          if (!aufPlatz.has(ac.playerId) && !gegenPlatz.has(ac.playerId)) melde('Akteur steht nicht auf dem Platz');
          if (ac.x < 0.5 || ac.x > 104.5) melde('Akteur im Netz (x < 0,5 oder > 104,5)');
          if (ac.y < 0.5 || ac.y > 67.5) melde('Akteur außerhalb des Feldes (y)');
          if (ac.role) rollen.add(ac.role);
          if (ac.t0 != null && !(ac.t0 >= 0 && ac.t1 <= 1 && ac.t0 <= ac.t1)) melde('Akteur-Zeitfenster unplausibel');
        }

        /* --- segments ----------------------------------------------------- */
        let tEnde = 0;
        for (const s of ph.segments || []) {
          typen.add(s.type);
          if (!s.from || !s.to) { melde('Segment ohne from/to'); continue; }
          if (s.type === 'flanke' || s.type === 'klaerung' || s.type === 'kopfball') {
            hoch.push({ typ: s.type, von: s.from, nach: s.to, gesetzt: ('height' in s), h: s.height });
          }
          if (s.by && !aufPlatz.has(s.by)) melde('segment.by steht nicht auf dem Platz');
          if (s.target && !aufPlatz.has(s.target)) melde('segment.target steht nicht auf dem Platz');
          if (s.against && !gegenPlatz.has(s.against)) melde('segment.against steht nicht auf dem Platz');
          if (s.by && s.by === s.target) melde('segment.by spielt sich selbst an');
          if (!(s.speed >= 4 && s.speed <= 30)) melde('Ballgeschwindigkeit außerhalb 4–30 m/s');
          if (!(s.t0 >= 0 && s.t1 <= 1 && s.t0 <= s.t1)) melde('Segment-Zeitfenster unplausibel');
          if (Math.abs(s.t0 - tEnde) > 0.003) melde('Lücke zwischen zwei Segmenten');
          tEnde = s.t1;
          // Jeder Schuss geht bis zur Torlinie – außer er wird geblockt.
          if (s.type === 'schuss' || s.type === 'kopfball') {
            const torX = ph.team === 'home' ? 105 : 0;
            if (s.outcome !== 'geblockt' && Math.abs(s.to.x - torX) > 1.35) {
              melde('Schuss endet weder auf der Torlinie noch im Pfostenband');
            }
          }
        }
        if (ph.segments && ph.segments.length && Math.abs(tEnde - 1) > 0.003) melde('letztes Segment endet nicht bei t = 1');
      }
    }
  }

  info('Phasen geprüft', String(phasen));
  info('davon mit segments[]', `${mitSegmenten} (${(mitSegmenten / Math.max(1, phasen) * 100).toFixed(1)} %)`);
  info('Segmente je Phase', (segSumme / Math.max(1, mitSegmenten)).toFixed(2));
  info('Akteure je Phase', (actorSumme / Math.max(1, phasen)).toFixed(2));
  info('Ballpunkte je Phase', (ballSumme / Math.max(1, phasen)).toFixed(2));
  info('Mittlere Phasendauer', (durSumme / Math.max(1, phasen)).toFixed(2) + ' s');
  info('Vorkommende Rollen', [...rollen].sort().join(', '));
  info('Vorkommende Segmenttypen', [...typen].sort().join(', '));

  pruefe('Jede Phase hat ball[] und actors[]', mitActors === phasen && phasen > 500,
    `${mitActors} von ${phasen}`);
  pruefe('Jede Phase liefert segments[] (Schema v2)', mitSegmenten === phasen,
    `${mitSegmenten} von ${phasen}`);
  for (const [k, v] of [...zaehler].sort((a, b) => b[1] - a[1])) {
    pruefe(k, false, `${v} Verstöße`);
  }
  pruefe('Keine Verletzung der v2-Invarianten', zaehler.size === 0,
    [...zaehler.keys()].slice(0, 3).join(' | '));
  pruefe('Mehr als drei Beteiligte je Phase', actorSumme / Math.max(1, phasen) > 3,
    (actorSumme / Math.max(1, phasen)).toFixed(2));
  pruefe('Alle Rollen des Vertrags kommen vor',
    ['schuetze', 'passgeber', 'empfaenger', 'verteidiger', 'torwart', 'mitlaeufer'].every(r => rollen.has(r)),
    [...rollen].join(', '));

  /* --- Flughöhe: eine Flanke rollt nicht, ein Kopfball auch nicht ----------
   *                                            (CONTRACTS §6.2, „Ballhöhe")
   *
   * Nicht geprüft wird die Zahl, die die Engine geschrieben hat — die wäre
   * dieselbe Heuristik, die die Kennzahl erzeugt. Geprüft wird die BAHN, die
   * daraus entsteht: jedes Flanken- und Klärungssegment wird durch
   * `ballistik.segmentFlug()` geschickt, und zwar mit exakt der Auflösung, die
   * `render/pitch.js` benutzt (Feld fehlt ⇒ keine Vorgabe, der Typ-Loft
   * entscheidet; height = 0 ⇒ ausdrücklich flach; height > 0 ⇒ geklemmt
   * übernehmen). Gemessen wird der tatsächliche Scheitel des Fluges.
   *
   * Damit fällt der Test auch dann, wenn die Engine wieder `height: 0` in jedes
   * Segment schreibt — dann ist der GEFLOGENE Scheitel 0, nicht nur das Feld. */
  {
    const HOEHE_MIN_R = 0.15, HOEHE_MAX_R = 24;   // Klemmung wie in pitch.js
    // „Nicht flach" heißt 2 m Scheitel – aber ein Ball kann nicht höher steigen
    // als seine Bahn lang ist. Für die kurzen Segmente (abstandSichern() lässt
    // 1,6 m zu) gilt deshalb die Geometrie: mehr als gut ein halber Meter
    // Scheitel je Meter Weg geht sich vor dem Zielpunkt nicht aus.
    //
    // Der Kopfball hat eine ANDERE Untergrenze, und zwar keine, die mit der
    // Länge wächst: er wird aus Kopfhöhe gespielt und ist selbst über 1,6 m Weg
    // kein Bodenball. Die Grenze ist deshalb fest. Sie kommt nicht aus einer
    // Saatfolge, sondern aus zwei unabhängigen Messungen:
    //   (a) dichtes Abtasten des Scheitel-Lösers gegen MC.scheitel.kopfball
    //       (1,60–40,00 m in 0,005-m-Schritten, 7 681 Längen): kleinster
    //       überhaupt erreichter Scheitel 1,37 m, keine Länge unter 1,20 m;
    //   (b) 10 unabhängige Saatfamilien à 5 Spiele (217 Kopfbälle): kleinster
    //       Scheitel je Familie 1,58 ± 0,01 m (Spanne 1,54–1,65 m), mittlerer
    //       Scheitel 2,20 ± 0,04 m, Anteil unter 1,0 m 0,00 ± 0,00 %.
    // 1,20 m lässt gegen (b) mehr als drei Zehntel Luft — deutlich mehr als das
    // Fehlerband — und fällt trotzdem sofort, wenn der Kopfball wieder als
    // Bodenball ausgeliefert wird (Altstand: 0,74 m im Mittel, 73,9 ± 3,4 %
    // unter 1,0 m über 8 Saatfamilien).
    const KOPF_MINDEST = 1.20;
    const mindest = (typ, dist) => (typ === 'kopfball' ? KOPF_MINDEST : Math.min(2.0, 0.55 * dist));
    const NAMEN = {
      flanke: ['Flanke', 'Flanken'],
      klaerung: ['Klärung', 'Klärungen'],
      kopfball: ['Kopfball', 'Kopfbälle']
    };
    const zustand = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
    /** Der Scheitel, den man tatsächlich zu sehen bekommt: bis zum Zielpunkt. */
    const scheitelVon = (e) => {
      const dist = Math.hypot(e.nach.x - e.von.x, e.nach.y - e.von.y);
      const opt = { tMax: 4.0 };
      if (e.gesetzt) {
        opt.hoehe = (typeof e.h === 'number' && isFinite(e.h) && e.h > 0)
          ? Math.min(Math.max(e.h, HOEHE_MIN_R), HOEHE_MAX_R) : 0;
      }
      const f = segmentFlug({ x: e.von.x, y: e.von.y, z: 0 }, { x: e.nach.x, y: e.nach.y, z: 0 }, e.typ, opt);
      // pitch.js schneidet den Flug am Zielpunkt ab – was danach kommt, sieht
      // niemand. Also nur bis dorthin nach dem höchsten Punkt suchen.
      const schritt = 1 / 60;
      let tEnde = f.dauer, sVor = 0, tVor = 0;
      for (let t = schritt; t <= f.dauer + 1e-9; t += schritt) {
        f.at(t, zustand);
        const s = Math.hypot(zustand.x - e.von.x, zustand.y - e.von.y);
        if (s >= dist) { tEnde = tVor + (t - tVor) * ((dist - sVor) / Math.max(1e-9, s - sVor)); break; }
        tVor = t; sVor = s;
      }
      let z = 0;
      for (let t = 0; t <= tEnde + 1e-9; t += schritt) { f.at(t, zustand); if (zustand.z > z) z = zustand.z; }
      f.freigeben();
      return { z, dist };
    };
    for (const art of ['flanke', 'klaerung', 'kopfball']) {
      const menge = hoch.filter((e) => e.typ === art);
      if (!menge.length) { pruefe(`${art}-Segmente kommen vor`, false, '0 gemessen'); continue; }
      let flach = 0, summe = 0, kleinster = Infinity, kleinsteDist = 0;
      for (const e of menge) {
        const { z, dist } = scheitelVon(e);
        e.z = z;
        summe += z;
        if (z < kleinster) { kleinster = z; kleinsteDist = dist; }
        if (z < mindest(art, dist)) flach++;
      }
      const [einzahl, mehrzahl] = NAMEN[art];
      info(`${mehrzahl}: geflogener Scheitel Ø / min`,
        `${(summe / menge.length).toFixed(2)} m / ${kleinster.toFixed(2)} m auf ${kleinsteDist.toFixed(1)} m  (n = ${menge.length})`);
      pruefe(`Kein${art === 'kopfball' ? '' : 'e'} ${einzahl} rollt flach über den Rasen`, flach === 0,
        `${flach} von ${menge.length} unter dem geometrischen Mindestscheitel, flachste ${kleinster.toFixed(2)} m auf ${kleinsteDist.toFixed(1)} m`);
    }
    // Der Korridor hält das Niveau fest: „nicht flach" darf nicht zu „alle
    // gerade eben über 2 m" verkommen. 30-m-Flanken haben real 6–9 m Scheitel.
    const flanken = hoch.filter((e) => e.typ === 'flanke'
      && Math.hypot(e.nach.x - e.von.x, e.nach.y - e.von.y) >= 25);
    if (flanken.length >= 20) {
      korridor('Scheitel einer Flanke ab 25 m',
        flanken.reduce((a, e) => a + e.z, 0) / flanken.length, 5.0, 9.5, ' m');
    } else {
      info('Flanken ab 25 m', `nur ${flanken.length} gemessen – kein Korridor`);
    }
    // Und derselbe Griff für den Kopfball: „nicht flach" darf weder auf die
    // Untergrenze zusammenfallen noch zur Bogenlampe werden. Ein Kopfball wird
    // aus 1,8–2,5 m gespielt; der geflogene Scheitel liegt gemessen bei
    // 2,20 ± 0,04 m (10 Saatfamilien à 5 Spiele, 217 Kopfbälle). Der Korridor
    // ist mit ±0,5 m weiter als das Zehnfache dieses Fehlerbands — er prüft die
    // Größenordnung, nicht die Nachkommastelle.
    const koepfe = hoch.filter((e) => e.typ === 'kopfball');
    if (koepfe.length >= 20) {
      korridor('Mittlerer Scheitel eines Kopfballs',
        koepfe.reduce((a, e) => a + e.z, 0) / koepfe.length, 1.7, 2.7, ' m');
    } else {
      info('Kopfbälle', `nur ${koepfe.length} gemessen – kein Korridor`);
    }
  }
}

/* ============================================== 6. Schwierigkeitsgrad-Check */

section('Schwierigkeitsgrade');
for (const stufe of ['amateur', 'profi', 'weltklasse', 'legende']) {
  const s = neuerSammler();
  for (let k = 0; k < 300; k++) {
    const rng = createRng('diff:' + stufe + ':' + k);
    const u = umfeld(rng, KLUBS[2]);
    const res = quickSimulate({
      home: matchTeam(teams.get('mittelmass'), true),
      away: matchTeam(teams.get('spitzenteam'), false),
      rng, venue: u.venue, referee: u.referee,
      difficulty: DIFFICULTIES[stufe],
      interactiveSide: 'home',
      competition: { id: 'bl1', matchday: 1 }
    });
    sammle(s, res, null, spielerIndex);
  }
  info(DIFFICULTIES[stufe].name,
    `Tore ${(s.toreH / s.n).toFixed(2)}:${(s.toreA / s.n).toFixed(2)}  Verletzungen ${(s.verletzungen / s.n).toFixed(2)}`);
}

/* ========================================================== 7. Robustheit */

section('Robustheit');
{
  const basis = teams.get('mittelmass');
  const nurElf = basis.players.slice(0, 11);

  // a) Kader mit exakt elf Spielern, ohne Bank
  const knapp = {
    club: basis.club, players: nurElf,
    tactics: { formation: '4-4-2', style: 'ausgeglichen', lineup: {}, bench: [], sliders: {} },
    morale: 60, tiredness: 0, coachBonus: 50, isHome: true
  };
  let r1 = null, fehler1 = null;
  try {
    r1 = quickSimulate({
      home: knapp, away: matchTeam(teams.get('kellerkind'), false),
      rng: createRng('robust1'), venue: { capacity: 20000, attendance: 0 },
      difficulty: DIFFICULTIES.profi, competition: { id: 'bl1', matchday: 1 }
    });
  } catch (err) { fehler1 = err; }
  pruefe('Elf Spieler ohne Bank und ohne Aufstellung laufen durch', !fehler1 && r1 && sauber(r1).length === 0,
    fehler1 ? String(fehler1.message) : (r1 ? sauber(r1).join(', ') : 'kein Ergebnis'));

  // b) Gar keine Taktik, kein venue, kein referee, keine difficulty
  let r2 = null, fehler2 = null;
  try {
    r2 = quickSimulate({
      home: { club: basis.club, players: basis.players, tactics: null },
      away: { club: teams.get('aufsteiger').club, players: teams.get('aufsteiger').players, tactics: null },
      rng: createRng('robust2')
    });
  } catch (err) { fehler2 = err; }
  pruefe('Ohne Taktik/Umfeld/Schiedsrichter fällt die Engine auf Vorgaben zurück',
    !fehler2 && r2 && sauber(r2).length === 0, fehler2 ? String(fehler2.message) : '');

  // c) Ungültige pendingSubs dürfen nichts kaputtmachen
  const heim = matchTeam(teams.get('spitzenteam'), true);
  heim.pendingSubs = [{ raus: 'gibt-es-nicht', rein: 'auch-nicht' }, null, { raus: null, rein: null }];
  let r3 = null, fehler3 = null;
  try {
    r3 = quickSimulate({
      home: heim, away: matchTeam(teams.get('mittelmass'), false),
      rng: createRng('robust3'), venue: { capacity: 30000, attendance: 20000 },
      difficulty: DIFFICULTIES.profi, competition: { id: 'bl1', matchday: 1 }
    });
  } catch (err) { fehler3 = err; }
  pruefe('Unsinnige pendingSubs werden ignoriert und geleert',
    !fehler3 && r3 && heim.pendingSubs.length === 0, fehler3 ? String(fehler3.message) : '');

  // d) Wechselgrenze: mehr als fünf Wechsel werden nicht ausgeführt
  const viele = matchTeam(teams.get('rekordmeister'), true);
  const drin = Object.values(viele.tactics.lineup);
  const bank = viele.tactics.bench.filter(Boolean);
  viele.pendingSubs = [];
  for (let i = 0; i < Math.min(drin.length, bank.length, 8); i++) {
    viele.pendingSubs.push({ raus: drin[i], rein: bank[i] });
  }
  const geplant = viele.pendingSubs.length;
  const r4 = quickSimulate({
    home: viele, away: matchTeam(teams.get('kellerkind'), false),
    rng: createRng('robust4'), venue: { capacity: 40000, attendance: 30000 },
    difficulty: DIFFICULTIES.profi, competition: { id: 'bl1', matchday: 1 }
  });
  const eingewechselt = bank.slice(0, geplant).filter(id => r4.playerStats[id] && r4.playerStats[id].minuten > 0).length;
  info('Wechselwünsche / tatsächlich ausgeführt', `${geplant} / ${eingewechselt}`);
  pruefe('Höchstens fünf Wechsel je Team', eingewechselt <= MATCH_CONSTANTS.maxWechsel, String(eingewechselt));

  // e) Determinismus: gleicher Seed, gleiches Ergebnis
  const bauen = () => quickSimulate({
    home: matchTeam(teams.get('mittelmass'), true), away: matchTeam(teams.get('kellerkind'), false),
    rng: createRng('determinismus'), venue: { capacity: 30000, attendance: 22000, weather: 'regen' },
    referee: { name: 'X', strictness: 60, homeBias: 50 },
    difficulty: DIFFICULTIES.profi, competition: { id: 'bl1', matchday: 1 }
  });
  const d1 = bauen(), d2 = bauen();
  pruefe('Gleicher Seed liefert exakt dasselbe Spiel',
    JSON.stringify(d1.score) === JSON.stringify(d2.score) &&
    JSON.stringify(d1.stats) === JSON.stringify(d2.stats) &&
    JSON.stringify(d1.torschuetzen) === JSON.stringify(d2.torschuetzen));
}

/* ===================================================================== Fazit */

section('Fazit');
if (fails === 0) {
  console.log('        Alle Prüfungen bestanden.');
} else {
  console.log(`        ${fails} Prüfung${fails === 1 ? '' : 'en'} nicht bestanden.`);
}
process.exit(fails === 0 ? 0 : 1);
