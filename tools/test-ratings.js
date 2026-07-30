/**
 * tools/test-ratings.js — Messlatte für engine/ratings.js
 *
 * Baut synthetische Testkader und misst die Zielkorridore aus der Spezifikation.
 * Aufruf:  node tools/test-ratings.js
 *
 * Kein Testframework, keine Dependencies — reine Messung mit Klartext-Ausgabe.
 */

import { mk } from '../src/data/squads/_helper.js';
import {
  playerOverall, playerRatingForSlot, positionPenalty, effectiveRating,
  teamStrength, tacticMatchup, squadDepth, chemistry, formGuide, marketValue,
  playerRole, slotsForFormation, WEIGHTS
} from '../src/engine/ratings.js';
import { POSITION_NAMES } from '../src/core/constants.js';
import { formatMoney } from '../src/core/util.js';

/* ------------------------------------------------------------------ Helfer */

const OK = '  OK  ';
const FAIL = ' FEHL ';
let fails = 0;

function korridor(label, gemessen, min, max, einheit = '%') {
  const gut = gemessen >= min && gemessen <= max;
  if (!gut) fails++;
  const s = `[${gut ? OK : FAIL}] ${label.padEnd(46)} ${gemessen.toFixed(1).padStart(6)}${einheit}  (Ziel ${min}–${max}${einheit})`;
  console.log(s);
  return gut;
}

function diffPct(a, b) { return (a / b - 1) * 100; }

/** Startelf-Positionen für 4-4-2 (Reihenfolge = Slots s1..s11). */
const F442 = slotsForFormation('4-4-2').map(s => s.pos);

/** Baut elf Spieler passend zu einer Positionsliste, alle mit derselben Stärke. */
function elfBauen(positionen, ovr = 72, opts = {}) {
  return positionen.map((pos, i) => {
    const p = mk({
      club: opts.club || 'test',
      vn: 'Test', nn: 'Spieler' + (i + 1) + (opts.suffix || ''),
      pos, ovr, pot: ovr + 4, age: opts.age || 26,
      nat: opts.nat || 'DE', era: opts.era || 'modern',
      att: opts.att || undefined,
      traits: i === 0 && opts.leader !== false ? ['leader'] : []
    });
    p.form = 50; p.morale = 70; p.fitness = 100; p.sharpness = 60;
    p.injury = null; p.cards = { yellow: 0, red: 0, ban: 0 };
    p.stats = { season: {}, career: {} };
    p.seasonsAtClub = 3;
    return p;
  });
}

function taktik(players, positionen, extra = {}) {
  const lineup = {};
  positionen.forEach((_, i) => { lineup['s' + (i + 1)] = players[i].id; });
  return {
    formation: extra.formation || '4-4-2',
    style: extra.style || 'ausgeglichen',
    lineup,
    bench: [],
    roles: {},
    sliders: extra.sliders || { tempo: 50, breite: 50, pressinghoehe: 50, risiko: 50, haerte: 50, offensivdrang: 50 },
    setPieces: { elfmeter: players[10].id, freistoss: players[6].id, ecke: players[3].id, kapitaen: players[0].id },
    offsideTrap: false, manMarking: null,
    instructions: { zeitspiel: false, langeBaelle: false, flankenSpiel: false, abseitsfalle: false },
    ...(extra.raw || {})
  };
}

function team(players, tactics, extra = {}) {
  return {
    club: { id: 'test', name: 'Testverein' },
    players, tactics,
    morale: extra.morale != null ? extra.morale : 70,
    tiredness: extra.tiredness || 0,
    coachBonus: extra.coachBonus != null ? extra.coachBonus : 50,
    chemistryHistory: extra.chemistryHistory != null ? extra.chemistryHistory : 30,
    ...extra
  };
}

function setzeAlle(players, feld, wert) {
  for (const p of players) p[feld] = wert;
  return players;
}

/* ================================================================== 1. Aufstellung */

console.log('\n=== 1. AUFSTELLUNG: optimal vs. schlecht =============================');

const spielerOpt = elfBauen(F442, 72);
const taktikOpt = taktik(spielerOpt, F442);
const optimal = teamStrength(team(spielerOpt, taktikOpt));

function mitLineup(reihenfolge) {
  const lineup = {};
  reihenfolge.forEach((spielerIdx, slotIdx) => { lineup['s' + (slotIdx + 1)] = spielerOpt[spielerIdx].id; });
  return teamStrength(team(spielerOpt, { ...taktikOpt, lineup }));
}

// Slots:            s1  s2  s3  s4  s5  s6  s7  s8  s9  s10 s11
// Positionen:       TW  LV  IV  IV  RV  LM  ZM  ZM  RM  ST  ST
// (a) leicht daneben – Seiten vertauscht, ein Stürmer ins Mittelfeld gezogen
const leichtDaneben = mitLineup([0, 4, 3, 2, 1, 8, 6, 7, 5, 9, 10]);
// (b) schlecht aufgestellt – zusätzlich zwei Spieler auf artfremden Positionen
const schlecht = mitLineup([0, 4, 2, 3, 1, 6, 5, 9, 8, 7, 10]);
// (c) Totalchaos – komplette Umkehrung inklusive Feldspieler im Tor
const chaos = mitLineup([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

console.log(`  optimal .................. ${optimal.gesamt}  (Basis ${optimal.breakdown.basis}, Chemie ${optimal.chemie})`);
console.log(`  leicht daneben ........... ${leichtDaneben.gesamt}  (${diffPct(leichtDaneben.gesamt, optimal.gesamt).toFixed(1)} %)`);
console.log(`  schlecht aufgestellt ..... ${schlecht.gesamt}  (Chemie ${schlecht.chemie})`);
console.log(`  Totalchaos ............... ${chaos.gesamt}`);
korridor('Verlust durch schlechte Aufstellung', -diffPct(schlecht.gesamt, optimal.gesamt), 14, 26);
console.log(`  [ INFO ] Totalchaos (inkl. Feldspieler im Tor): ${(-diffPct(chaos.gesamt, optimal.gesamt)).toFixed(1)} % Verlust`);
console.log('  Schwächen der schlechten Aufstellung:');
for (const s of schlecht.schwaechen) console.log('    - ' + s);

/* ================================================================== 2. Moral */

console.log('\n=== 2. MORAL 20 vs. 90 ===============================================');
const mLow = teamStrength(team(setzeAlle(elfBauen(F442, 72), 'morale', 20), taktik(spielerOpt, F442), { morale: 20 }));
const mHigh = teamStrength(team(setzeAlle(elfBauen(F442, 72), 'morale', 90), taktik(spielerOpt, F442), { morale: 90 }));
console.log(`  Moral 20 ................. ${mLow.gesamt}   Moral 90 ... ${mHigh.gesamt}`);
korridor('Moral-Spanne', diffPct(mHigh.gesamt, mLow.gesamt), 10.5, 13.5);

/* ================================================================== 3. Fitness */

console.log('\n=== 3. FITNESS 60 vs. 100 ============================================');
const fLow = teamStrength(team(setzeAlle(elfBauen(F442, 72), 'fitness', 60), taktik(spielerOpt, F442)));
const fHigh = teamStrength(team(setzeAlle(elfBauen(F442, 72), 'fitness', 100), taktik(spielerOpt, F442)));
console.log(`  Fitness 60 ............... ${fLow.gesamt}   Fitness 100 ... ${fHigh.gesamt}`);
korridor('Fitness-Spanne', diffPct(fHigh.gesamt, fLow.gesamt), 8.5, 11.5);

/* ================================================================== 4. Form */

console.log('\n=== 4. FORM 20 vs. 90 ================================================');
const foLow = teamStrength(team(setzeAlle(elfBauen(F442, 72), 'form', 20), taktik(spielerOpt, F442)));
const foHigh = teamStrength(team(setzeAlle(elfBauen(F442, 72), 'form', 90), taktik(spielerOpt, F442)));
console.log(`  Form 20 .................. ${foLow.gesamt}   Form 90 ... ${foHigh.gesamt}`);
korridor('Form-Spanne', diffPct(foHigh.gesamt, foLow.gesamt), 8.5, 11.5);

/* ================================================================== 5. Spielstil */

console.log('\n=== 5. SPIELSTIL: passend vs. unpassend ==============================');

// Ein Renn- und Kampfkader: viel Tempo/Ausdauer/Körper, wenig Technik/Passspiel.
const attTempo = { tempo: 92, ausdauer: 90, koerper: 86, kopfball: 84, sprungkraft: 84, aggressivitaet: 84, zweikampf: 82,
  technik: 44, passspiel: 44, uebersicht: 44, dribbling: 52, positionsspiel: 55 };
// Ein Kombinationskader: Technik satt, aber körperlich und läuferisch mau.
const attTechnik = { technik: 92, passspiel: 92, uebersicht: 90, dribbling: 84, positionsspiel: 84,
  tempo: 46, ausdauer: 48, koerper: 44, kopfball: 44, sprungkraft: 46, aggressivitaet: 46, zweikampf: 50 };

// 3-5-2 als neutrale Bühne: diese Formation löst keine Stil-Kohärenz-Boni/Mali aus,
// damit wirklich nur die Kaderpassung gemessen wird.
const F352 = slotsForFormation('3-5-2').map(s => s.pos);

function stilTest(att, label) {
  const sp = elfBauen(F352, 72, { att, suffix: label });
  const werte = {};
  for (const stil of ['konter', 'ballbesitz', 'pressing', 'kick_and_rush', 'ausgeglichen', 'defensiv', 'offensiv']) {
    werte[stil] = teamStrength(team(sp, taktik(sp, F352, { style: stil, formation: '3-5-2' }))).gesamt;
  }
  const sortiert = Object.entries(werte).sort((a, b) => b[1] - a[1]);
  console.log(`  ${label}:`);
  for (const [s, v] of sortiert) console.log(`    ${s.padEnd(16)} ${v}`);
  return { werte, best: sortiert[0], worst: sortiert[sortiert.length - 1] };
}

const rTempo = stilTest(attTempo, 'Renn- und Kampfkader');
const rTechnik = stilTest(attTechnik, 'Kombinationskader');

korridor('Stil-Spanne Kampfkader (bester vs. schlechtester)',
  diffPct(rTempo.best[1], rTempo.worst[1]), 10, 14);
korridor('Stil-Spanne Technikkader (bester vs. schlechtester)',
  diffPct(rTechnik.best[1], rTechnik.worst[1]), 10, 14);
korridor('Kampfkader: Kick-and-Rush vs. Ballbesitz',
  diffPct(rTempo.werte.kick_and_rush, rTempo.werte.ballbesitz), 9, 14);
korridor('Technikkader: Ballbesitz vs. Kick-and-Rush',
  diffPct(rTechnik.werte.ballbesitz, rTechnik.werte.kick_and_rush), 9, 14);

/* ================================================================== 6. Fremde Position */

console.log('\n=== 6. SPIELER AUF FREMDER POSITION ==================================');
const st = mk({ club: 'test', vn: 'Karl', nn: 'Knipser', pos: 'ST', ovr: 80, age: 26 });
const iv = mk({ club: 'test', vn: 'Hein', nn: 'Klotz', pos: 'IV', ovr: 80, age: 26 });
const zm = mk({ club: 'test', vn: 'Otto', nn: 'Lenker', pos: 'ZM', ovr: 80, alt: ['OM'], age: 26 });

const paare = [
  [st, 'ST'], [st, 'OM'], [st, 'LA'], [st, 'IV'], [st, 'LV'], [st, 'TW'],
  [iv, 'IV'], [iv, 'DM'], [iv, 'ST'],
  [zm, 'ZM'], [zm, 'OM'], [zm, 'RA']
];
for (const [p, pos] of paare) {
  const r = playerRatingForSlot(p, pos);
  const o = playerOverall(p);
  console.log(`  ${(p.lastName + ' (' + p.position + ')').padEnd(20)} als ${POSITION_NAMES[pos].padEnd(24)} ${String(r).padStart(5)}  (${((r / o - 1) * 100).toFixed(1)} %, Malus ${positionPenalty(p, pos).toFixed(3)})`);
}
const fremdVerlust = -(playerRatingForSlot(st, 'IV') / playerOverall(st) - 1) * 100;
korridor('Stürmer als Innenverteidiger: Wertverlust', fremdVerlust, 38, 48);
const twVerlust = -(playerRatingForSlot(st, 'TW') / playerOverall(st) - 1) * 100;
console.log(`  [ INFO ] Feldspieler im Tor: ${twVerlust.toFixed(1)} % Verlust (bewusste Sonderregel)`);

/* ================================================================== 7. Formation */

console.log('\n=== 7. FORMATION & ZENTRUM ===========================================');
for (const f of ['4-4-2', '3-5-2', '4-3-3', '4-2-3-1', '5-3-2', '4-5-1', '3-4-3']) {
  const pos = slotsForFormation(f).map(s => s.pos);
  const sp = elfBauen(pos, 72, { suffix: f });
  const ts = teamStrength(team(sp, taktik(sp, pos, { formation: f })));
  console.log(`  ${f.padEnd(8)} ${pos.join(',').padEnd(42)} gesamt ${String(ts.gesamt).padStart(5)}  Form.-Faktor ${ts.breakdown.formation}`);
}

/* ================================================================== 8. Chemie */

console.log('\n=== 8. CHEMIE: Legenden vs. Moderne ==================================');
function gemischteElf(anzahlLegenden, history) {
  const sp = F442.map((pos, i) => {
    const legend = i < anzahlLegenden;
    const p = mk({
      club: 'test', vn: 'Test', nn: 'Mix' + i, pos, ovr: 72, age: 27,
      nat: i % 3 === 0 ? 'DE' : i % 3 === 1 ? 'BR' : 'IT',
      era: legend ? 'legend' : 'modern', eraLabel: legend ? 'Ära 1974' : null,
      traits: i === 0 ? ['leader'] : []
    });
    p.form = 50; p.morale = 70; p.fitness = 100; p.sharpness = 60; p.seasonsAtClub = 2;
    return p;
  });
  const t = taktik(sp, F442);
  const ch = chemistry(sp, { ...t, chemistryHistory: history });
  const ts = teamStrength(team(sp, t, { chemistryHistory: history }));
  return { ch, ts };
}
for (const [leg, hist] of [[0, 30], [2, 30], [5, 0], [5, 30], [5, 80], [8, 30]]) {
  const { ch, ts } = gemischteElf(leg, hist);
  console.log(`  ${leg} Legenden / Historie ${String(hist).padStart(3)} -> Chemie ${String(ch.wert).padStart(3)}, gesamt ${ts.gesamt}`);
}
console.log('  Begründungen bei 5 Legenden / Historie 0:');
for (const g of gemischteElf(5, 0).ch.gruende) console.log('    - ' + g);
console.log('  Begründungen bei 5 Legenden / Historie 80:');
for (const g of gemischteElf(5, 80).ch.gruende) console.log('    - ' + g);

const chem0 = gemischteElf(5, 0), chem100 = gemischteElf(5, 100);
korridor('Chemie-Effekt (Historie 0 vs. 100) auf Gesamtstärke',
  diffPct(chem100.ts.gesamt, chem0.ts.gesamt), 0.4, 3.5);

/* ================================================================== 9. Taktik-Duell */

console.log('\n=== 9. TAKTIK-DUELLE =================================================');
function duell(fa, sa, fb, sb, extraA = {}, extraB = {}) {
  const a = { formation: fa, style: sa, sliders: { tempo: 50, breite: 50, pressinghoehe: 50, risiko: 50, haerte: 50, offensivdrang: 50, ...(extraA.sliders || {}) }, ...extraA };
  const b = { formation: fb, style: sb, sliders: { tempo: 50, breite: 50, pressinghoehe: 50, risiko: 50, haerte: 50, offensivdrang: 50, ...(extraB.sliders || {}) }, ...extraB };
  const m = tacticMatchup(a, b);
  console.log(`  ${(fa + '/' + sa).padEnd(26)} vs ${(fb + '/' + sb).padEnd(26)} -> ${m.homeMod} : ${m.awayMod}`);
  for (const r of m.reasons) console.log('      · ' + r);
  return m;
}
const d1 = duell('3-5-2', 'ausgeglichen', '4-4-2', 'ausgeglichen');
const d2 = duell('4-3-3', 'pressing', '4-4-2', 'ballbesitz', { sliders: { pressinghoehe: 78 } }, { sliders: { pressinghoehe: 30 } });
const d3 = duell('4-4-2', 'konter', '4-3-3', 'pressing', { sliders: { tempo: 75 } }, { sliders: { pressinghoehe: 80 } });
duell('4-4-2', 'ausgeglichen', '4-4-2', 'ausgeglichen');

korridor('3-5-2 Zentrumsvorteil gegen 4-4-2', (d1.homeMod - 1) * 100, 1.0, 10, ' Pkt');
korridor('Pressing schlägt tiefen Ballbesitz', (d2.homeMod - 1) * 100, 3.0, 15, ' Pkt');
korridor('Konter schlägt hohes Pressing', (d3.homeMod - 1) * 100, 2.0, 15, ' Pkt');

/* ================================================================== 10. Restliche API */

console.log('\n=== 10. SONSTIGE FUNKTIONEN ==========================================');

const kader = [
  ...elfBauen(F442, 72, { suffix: 'A' }),
  mk({ club: 'test', vn: 'Ersatz', nn: 'Keeper', pos: 'TW', ovr: 64, age: 30 }),
  mk({ club: 'test', vn: 'Ersatz', nn: 'Innen', pos: 'IV', ovr: 68, alt: ['DM'], age: 24 }),
  mk({ club: 'test', vn: 'Ersatz', nn: 'Flügel', pos: 'RA', ovr: 70, alt: ['RM'], age: 22 })
];
const depth = squadDepth(kader);
console.log('  Kadertiefe:');
for (const pos of Object.keys(depth)) {
  const d = depth[pos];
  console.log(`    ${pos.padEnd(4)} Anzahl ${String(d.anzahl).padStart(2)}  bester ${String(d.bester).padStart(5)}  schnitt ${String(d.schnitt).padStart(5)}  ${d.luecke ? 'LÜCKE' : '     '}  ${d.bewertung}`);
}

console.log('\n  Form-Guide:');
for (const f of [5, 25, 38, 50, 65, 80, 95]) {
  const p = { ...st, form: f };
  const g = formGuide(p);
  console.log(`    Form ${String(f).padStart(3)} -> ${g.text.padEnd(30)} ${g.delta > 0 ? '+' : ''}${g.delta} Punkte`);
}

console.log('\n  Marktwerte:');
for (const [ovr, age, form] of [[80, 24, 50], [80, 24, 90], [80, 24, 15], [80, 33, 50], [88, 26, 50], [62, 20, 50], [70, 36, 50]]) {
  const p = mk({ club: 'test', vn: 'M', nn: 'W' + ovr + age, pos: 'ST', ovr, age, pot: Math.min(99, ovr + (age < 23 ? 10 : 2)) });
  p.form = form; p.morale = 70;
  console.log(`    ovr ${ovr} / ${age} J. / Form ${String(form).padStart(2)} -> ${formatMoney(marketValue(p)).padStart(14)}  (Daten-Startwert ${formatMoney(p.value)})`);
}

console.log('\n  Rollenvorschläge:');
for (const p of [st, iv, zm, kader[0], kader[13]]) {
  console.log(`    ${(p.lastName + ' (' + p.position + ')').padEnd(24)} -> ${playerRole(p)}`);
}

console.log('\n  effectiveRating im Kontext:');
const kontexte = [
  ['neutral', {}],
  ['auswärts', { awayGame: true }],
  ['Regen', { weather: 'regen' }],
  ['Schnee auswärts', { weather: 'schnee', awayGame: true }],
  ['großes Spiel', { bigMatch: true }],
  ['Minute 90', { minute: 90 }],
  ['Minute 90 auswärts, Regen', { minute: 90, awayGame: true, weather: 'regen' }]
];
for (const [label, ctx] of kontexte) {
  console.log(`    ${label.padEnd(28)} ${effectiveRating(st, 'ST', ctx)}`);
}

/* ================================================================== 11. Slider & Trainer */

console.log('\n=== 11. SLIDER, TRAINER, HEIMVORTEIL =================================');
const spS = elfBauen(F442, 72, { att: attTechnik, suffix: 'S' });
const normal = teamStrength(team(spS, taktik(spS, F442, { style: 'ballbesitz' })));
const uebersteuert = teamStrength(team(spS, taktik(spS, F442, {
  style: 'ballbesitz', sliders: { tempo: 95, breite: 90, pressinghoehe: 95, risiko: 90, haerte: 95, offensivdrang: 90 }
})));
console.log(`  Slider neutral ........... ${normal.gesamt}   übersteuert ... ${uebersteuert.gesamt}  (${diffPct(uebersteuert.gesamt, normal.gesamt).toFixed(1)} %)`);
const trainerSchwach = teamStrength(team(spielerOpt, taktikOpt, { coachBonus: 0 }));
const trainerStark = teamStrength(team(spielerOpt, taktikOpt, { coachBonus: 100 }));
console.log(`  Trainer 0 vs. 100 ........ ${trainerSchwach.gesamt} / ${trainerStark.gesamt}  (${diffPct(trainerStark.gesamt, trainerSchwach.gesamt).toFixed(1)} %)`);
const heim = teamStrength(team(spielerOpt, taktikOpt, { isHome: true }));
const ausw = teamStrength(team(spielerOpt, taktikOpt, { isHome: false }));
console.log(`  Heim vs. auswärts ........ ${heim.gesamt} / ${ausw.gesamt}  (${diffPct(heim.gesamt, ausw.gesamt).toFixed(1)} %)`);

console.log('\n  Stärken der optimalen Elf:');
for (const s of optimal.staerken) console.log('    + ' + s);
console.log('  Breakdown optimal:', JSON.stringify(optimal.breakdown));

/* ================================================================== Fazit */

console.log('\n======================================================================');
console.log(fails === 0
  ? 'ALLE ZIELKORRIDORE ERREICHT.'
  : `${fails} Korridor(e) NICHT erreicht – Gewichte in WEIGHTS nachjustieren.`);
console.log('WEIGHTS:', JSON.stringify(WEIGHTS));
console.log('======================================================================\n');

process.exitCode = fails === 0 ? 0 : 1;
