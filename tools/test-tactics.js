/**
 * tools/test-tactics.js — Selbsttest für src/engine/tactics.js
 *
 * Aufruf:  node tools/test-tactics.js
 *
 * Geprüft wird:
 *  1. Jede Formation hat genau 11 Slots mit gültigen Positionen und Koordinaten.
 *  2. Genau ein Torwart je Formation, und nur er steht bei y < 12.
 *  3. Keine zwei Slots liegen näher als 8 Einheiten beieinander.
 *  4. autoLineup() baut aus einem 24er-Kader eine vollständige, valide Elf.
 *  5. validateTactics() erkennt alle vertraglich geforderten Fehlerfälle.
 *  6. Stile, Rollen, Anweisungen, Konter-Matrix und Co-Trainer liefern
 *     vollständige, plausible Daten.
 */

import {
  FORMATIONS, FORMATION_IDS, STYLES, ROLES, INSTRUCTIONS,
  autoLineup, validateTactics, formationCounter, suggestTactics,
  slotLabel, formationShape, defaultTactics, rolesForPosition,
  tacticsTeamEffects, describeTactics
} from '../src/engine/tactics.js';

import { POSITIONS, ATTRIBUTES } from '../src/core/constants.js';
import { createRng } from '../src/core/rng.js';
import { mk } from '../src/data/squads/_helper.js';

/* ---------------------------------------------------------------- Harness */

let passed = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) { passed++; return true; }
  failures.push(detail ? `${label} — ${detail}` : label);
  return false;
}

function eq(actual, expected, label) {
  return ok(actual === expected, label, `erwartet ${JSON.stringify(expected)}, war ${JSON.stringify(actual)}`);
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

const MIN_SLOT_DISTANCE = 8;
const KEEPER_Y_MAX = 12;

/* ------------------------------------------------- 1..3 Formationen prüfen */

section('Formationen');

ok(FORMATION_IDS.length >= 14, 'Mindestens 14 Formationen', `nur ${FORMATION_IDS.length}`);

const PFLICHT = ['4-4-2', '4-4-2-raute', '4-2-3-1', '4-3-3', '4-1-4-1', '4-5-1', '3-5-2',
  '3-4-3', '5-3-2', '5-4-1', '4-3-1-2', '3-4-1-2', '4-2-4', '4-4-1-1', '3-6-1'];
for (const id of PFLICHT) ok(!!FORMATIONS[id], `Formation "${id}" vorhanden`);

for (const id of FORMATION_IDS) {
  const f = FORMATIONS[id];
  eq(f.id, id, `[${id}] id stimmt mit Schlüssel überein`);
  ok(typeof f.name === 'string' && f.name.length > 2, `[${id}] hat einen Namen`);
  ok(typeof f.desc === 'string' && f.desc.length > 30, `[${id}] hat eine deutsche Beschreibung`);
  eq(f.slots.length, 11, `[${id}] hat genau 11 Slots`);

  // Zusatzkennzahlen
  ok(Array.isArray(f.staerken) && f.staerken.length >= 2, `[${id}] staerken[] gefüllt`);
  ok(Array.isArray(f.schwaechen) && f.schwaechen.length >= 1, `[${id}] schwaechen[] gefüllt`);
  ok(f.anforderungen && Object.keys(f.anforderungen).length >= 1, `[${id}] anforderungen{} gefüllt`);
  for (const k in f.anforderungen) {
    ok(ATTRIBUTES.includes(k), `[${id}] anforderung "${k}" ist ein bekanntes Attribut`);
    ok(f.anforderungen[k] >= 1 && f.anforderungen[k] <= 99, `[${id}] anforderung "${k}" im Bereich 1..99`);
  }
  for (const k of ['risiko', 'defensivwert', 'offensivwert', 'breite', 'kompaktheit']) {
    ok(typeof f[k] === 'number' && f[k] >= 0 && f[k] <= 100, `[${id}] ${k} ist 0..100`, `war ${f[k]}`);
  }

  // Slots
  const ids = new Set();
  let keeperCount = 0;
  for (const s of f.slots) {
    ok(typeof s.id === 'string' && !ids.has(s.id), `[${id}] Slot-Id "${s.id}" eindeutig`);
    ids.add(s.id);
    ok(POSITIONS.includes(s.pos), `[${id}] Slot ${s.id} hat gültige Position`, `war "${s.pos}"`);
    ok(s.x >= 0 && s.x <= 100, `[${id}] Slot ${s.id} x im Bereich 0..100`, `x=${s.x}`);
    ok(s.y >= 0 && s.y <= 100, `[${id}] Slot ${s.id} y im Bereich 0..100`, `y=${s.y}`);
    if (s.pos === 'TW') {
      keeperCount++;
      ok(s.y < KEEPER_Y_MAX, `[${id}] Torwart steht bei y < ${KEEPER_Y_MAX}`, `y=${s.y}`);
    } else {
      ok(s.y >= KEEPER_Y_MAX, `[${id}] Feldspieler ${s.id} steht nicht im Torwartband`, `y=${s.y}`);
    }
  }
  eq(keeperCount, 1, `[${id}] genau ein Torwart`);

  // Mindestabstand
  for (let i = 0; i < f.slots.length; i++) {
    for (let j = i + 1; j < f.slots.length; j++) {
      const a = f.slots[i], b = f.slots[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      ok(d >= MIN_SLOT_DISTANCE,
        `[${id}] Abstand ${a.id}/${b.id} >= ${MIN_SLOT_DISTANCE}`,
        `Abstand ${d.toFixed(1)} (${a.pos}@${a.x},${a.y} ↔ ${b.pos}@${b.x},${b.y})`);
    }
  }

  // Plausible Staffelung: mindestens 3 Verteidiger, mindestens 1 Stürmer
  const feld = f.slots.filter(s => s.pos !== 'TW');
  const abw = feld.filter(s => s.y <= 34).length;
  const stu = feld.filter(s => s.y > 68).length;
  ok(abw >= 3 && abw <= 5, `[${id}] 3 bis 5 Verteidiger`, `waren ${abw}`);
  ok(stu >= 1 && stu <= 4, `[${id}] 1 bis 4 Angreifer`, `waren ${stu}`);
}

/* --------------------------------------------------------- slotLabel & Co. */

section('slotLabel / formationShape');

eq(slotLabel({ pos: 'LV', x: 14, y: 24 }), 'LV', 'slotLabel LV');
eq(slotLabel({ pos: 'IV', x: 62, y: 20 }), 'IV rechts', 'slotLabel IV rechts');
eq(slotLabel({ pos: 'IV', x: 38, y: 20 }), 'IV links', 'slotLabel IV links');
eq(slotLabel({ pos: 'TW', x: 50, y: 6 }), 'TW', 'slotLabel TW');
eq(slotLabel({ pos: 'ST', x: 50, y: 82 }), 'ST', 'slotLabel ST zentral');

for (const id of FORMATION_IDS) {
  const shape = formationShape(id);
  eq(shape.length, 11, `formationShape("${id}") liefert 11 Slots`);
  ok(shape.every(s => typeof s.label === 'string' && s.label.length > 0), `[${id}] alle Shape-Slots haben ein Label`);
  ok(shape.every(s => typeof s.reihe === 'number' && s.reihe >= 0), `[${id}] alle Shape-Slots haben eine Reihe`);
  ok(shape.every(s => ['TW', 'ABW', 'MIT', 'STU'].includes(s.gruppe)), `[${id}] alle Shape-Slots haben eine Gruppe`);
}
eq(formationShape('gibtsnicht').length, 0, 'formationShape() bei unbekannter Formation -> []');

/* ------------------------------------------------------------- Stile/Rollen */

section('Stile, Rollen, Anweisungen');

const PFLICHT_STILE = ['ballbesitz', 'konter', 'pressing', 'kick_and_rush', 'ausgeglichen',
  'defensiv', 'offensiv', 'umschaltspiel'];
ok(Object.keys(STYLES).length >= 8, 'Mindestens 8 Spielstile');
for (const id of PFLICHT_STILE) {
  const st = STYLES[id];
  if (!ok(!!st, `Stil "${id}" vorhanden`)) continue;
  ok(typeof st.name === 'string' && st.name.length > 2, `[${id}] name`);
  ok(typeof st.desc === 'string' && st.desc.length > 20, `[${id}] desc (deutsch)`);
  ok(typeof st.passtZu === 'string' && st.passtZu.length > 15, `[${id}] passtZu`);
  for (const k of ['tempo', 'passLaenge', 'pressinghoehe', 'risiko']) {
    ok(typeof st.mods[k] === 'number' && st.mods[k] >= 0 && st.mods[k] <= 100, `[${id}] mods.${k} 0..100`, `war ${st.mods[k]}`);
  }
  for (const k of ['chancenRate', 'gegenchancenRate', 'ausdauerkosten']) {
    ok(typeof st.mods[k] === 'number' && st.mods[k] > 0.4 && st.mods[k] < 2,
      `[${id}] mods.${k} plausibler Multiplikator`, `war ${st.mods[k]}`);
  }
  ok(Array.isArray(st.mods.benoetigteAttribute), `[${id}] benoetigteAttribute[]`);
  ok(st.mods.benoetigteAttribute.every(a => ATTRIBUTES.includes(a)), `[${id}] benoetigteAttribute sind bekannte Attribute`);
}
// Der Stil-Kompass muss sich unterscheiden, sonst ist er wertlos
ok(STYLES.defensiv.mods.pressinghoehe < STYLES.pressing.mods.pressinghoehe, 'defensiv presst tiefer als pressing');
ok(STYLES.konter.mods.gegenchancenRate < STYLES.offensiv.mods.gegenchancenRate, 'konter kassiert weniger Gegenchancen als offensiv');
ok(STYLES.kick_and_rush.mods.passLaenge > STYLES.ballbesitz.mods.passLaenge, 'kick_and_rush spielt längere Bälle als ballbesitz');

const PFLICHT_ROLLEN = ['spielmacher', 'sechser_zerstoerer', 'box_to_box', 'achter_offensiv',
  'libero', 'innenverteidiger_aufbau', 'aussenverteidiger_offensiv', 'aussenverteidiger_defensiv',
  'fluegelfluitzer', 'invertierter_fluegel', 'zehner', 'haengende_spitze', 'mittelstuermer',
  'zielspieler', 'wandspieler', 'torjaeger', 'torwart_mitspielend', 'torwart_linienhueter'];
ok(Object.keys(ROLES).length >= 16, 'Mindestens 16 Rollen', `waren ${Object.keys(ROLES).length}`);
for (const id of PFLICHT_ROLLEN) {
  const r = ROLES[id];
  if (!ok(!!r, `Rolle "${id}" vorhanden`)) continue;
  ok(typeof r.name === 'string' && r.name.length > 2, `[${id}] name (deutsch)`);
  ok(typeof r.desc === 'string' && r.desc.length > 25, `[${id}] desc (deutsch)`);
  ok(Array.isArray(r.positions) && r.positions.length >= 1, `[${id}] positions[]`);
  ok(r.positions.every(p => POSITIONS.includes(p)), `[${id}] positions[] sind gültige Positionen`);
  ok(Object.keys(r.mods).length >= 2, `[${id}] mods{}`);
  ok(Object.keys(r.mods).every(k => ATTRIBUTES.includes(k)), `[${id}] mods-Keys sind Attribute`);
  ok(Object.values(r.mods).every(v => v > 0.5 && v < 1.6), `[${id}] mods-Faktoren plausibel`);
  ok(Object.keys(r.benoetigt).length >= 1, `[${id}] benoetigt{}`);
  ok(Object.keys(r.benoetigt).every(k => ATTRIBUTES.includes(k)), `[${id}] benoetigt-Keys sind Attribute`);
  ok(r.teamEffekt && Object.keys(r.teamEffekt).length >= 1, `[${id}] teamEffekt{}`);
}
// Jede Position sollte mindestens eine Rolle anbieten
for (const pos of POSITIONS) {
  ok(rolesForPosition(pos).length >= 1, `Für Position ${pos} existiert mindestens eine Rolle`);
}

const PFLICHT_ANWEISUNGEN = ['zeitspiel', 'langeBaelle', 'flankenSpiel', 'abseitsfalle',
  'kurzpassspiel', 'gegenpressing', 'tiefstehen', 'hoheAussenverteidiger'];
for (const id of PFLICHT_ANWEISUNGEN) {
  const i = INSTRUCTIONS[id];
  if (!ok(!!i, `Anweisung "${id}" vorhanden`)) continue;
  ok(typeof i.name === 'string' && i.name.length > 2, `[${id}] name`);
  ok(typeof i.desc === 'string' && i.desc.length > 25, `[${id}] desc (deutsch)`);
  ok(i.mods && Object.keys(i.mods).length >= 2, `[${id}] mods{}`);
}

/* ------------------------------------------------------- Testkader (24 Mann) */

section('autoLineup mit 24er-Kader');

/** Baut einen realistischen 24er-Bundesligakader. */
function buildSquad() {
  const spec = [
    ['TW', 'Manuel', 'Torwart', 82, []], ['TW', 'Sven', 'Ersatzkeeper', 71, []],
    ['TW', 'Timo', 'Dritterkeeper', 62, []],
    ['IV', 'Jonathan', 'Klotz', 84, ['DM']], ['IV', 'Niklas', 'Mauer', 80, []],
    ['IV', 'Matthias', 'Riegel', 76, ['RV']], ['IV', 'Armel', 'Bollwerk', 72, []],
    ['LV', 'David', 'Linksfuss', 79, ['LM']], ['LV', 'Ridle', 'Flanke', 70, ['LM']],
    ['RV', 'Benjamin', 'Rechtsfuss', 78, ['RM']], ['RV', 'Josha', 'Aufrueck', 71, ['RM']],
    ['DM', 'Joshua', 'Abraeumer', 85, ['ZM']], ['DM', 'Robert', 'Wache', 73, ['IV']],
    ['ZM', 'Leon', 'Motor', 83, ['DM', 'OM']], ['ZM', 'Angelo', 'Lunge', 74, ['DM']],
    ['ZM', 'Aleksandar', 'Schaltzentrale', 77, ['OM']],
    ['LM', 'Kingsley', 'Wirbel', 80, ['LA']], ['RM', 'Serge', 'Sprint', 81, ['RA']],
    ['OM', 'Jamal', 'Zauberer', 86, ['ZM', 'LA']], ['OM', 'Florian', 'Denker', 75, ['ZM']],
    ['LA', 'Leroy', 'Flitzer', 82, ['ST']], ['RA', 'Karim', 'Dribbler', 76, ['LA']],
    ['ST', 'Harry', 'Knipser', 88, ['OM']], ['ST', 'Thomas', 'Raumdeuter', 74, ['OM']]
  ];
  const rng = createRng('testkader');
  return spec.map(([pos, vn, nn, ovr, alt], i) => {
    const p = mk({ club: 'test', vn, nn, pos, ovr, alt, age: 21 + (i % 12), nr: i + 1 });
    // Laufzeitfelder ergänzen (macht sonst core/state.js)
    p.form = rng.int(40, 65);
    p.morale = rng.int(60, 85);
    p.fitness = rng.int(82, 100);
    p.sharpness = rng.int(50, 80);
    p.injury = null;
    p.cards = { yellow: 0, red: 0, ban: 0 };
    return p;
  });
}

const squad = buildSquad();
eq(squad.length, 24, 'Testkader hat 24 Spieler');

const baseTactics = { formation: '4-2-3-1', style: 'ausgeglichen' };
const auto = autoLineup(squad, baseTactics);

eq(Object.keys(auto.lineup).length, 11, 'autoLineup füllt genau 11 Slots');
eq(auto.formation, '4-2-3-1', 'autoLineup behält die Formation');
ok(auto.bench.length > 0 && auto.bench.length <= 9, 'Bank ist besetzt (max. 9)', `waren ${auto.bench.length}`);

const startIds = Object.values(auto.lineup);
eq(new Set(startIds).size, 11, 'Kein Spieler doppelt in der Startelf');
ok(auto.bench.every(id => !startIds.includes(id)), 'Kein Bankspieler steht gleichzeitig in der Startelf');
ok(auto.bench.some(id => squad.find(p => p.id === id).position === 'TW'), 'Ersatztorwart sitzt auf der Bank');

const twSlot = FORMATIONS['4-2-3-1'].slots.find(s => s.pos === 'TW');
const twPlayer = squad.find(p => p.id === auto.lineup[twSlot.id]);
eq(twPlayer.position, 'TW', 'Auf dem Torwartslot steht ein Torwart');

ok(auto.setPieces.elfmeter && startIds.includes(auto.setPieces.elfmeter), 'Elfmeterschütze aus der Startelf');
ok(auto.setPieces.freistoss && startIds.includes(auto.setPieces.freistoss), 'Freistoßschütze aus der Startelf');
ok(auto.setPieces.ecke && startIds.includes(auto.setPieces.ecke), 'Eckenschütze aus der Startelf');
ok(auto.setPieces.kapitaen && startIds.includes(auto.setPieces.kapitaen), 'Kapitän aus der Startelf');
ok(auto.setPieces.elfmeter !== twPlayer.id, 'Der Torwart schießt keine Elfmeter');
ok(Object.keys(auto.roles).length === 11, 'Für jeden Startelfspieler ist eine Rolle gesetzt',
  `waren ${Object.keys(auto.roles).length}`);
ok(Object.values(auto.roles).every(r => !!ROLES[r]), 'Alle vergebenen Rollen existieren');
ok(auto.sliders && ['tempo', 'breite', 'pressinghoehe', 'risiko', 'haerte', 'offensivdrang']
  .every(k => typeof auto.sliders[k] === 'number'), 'Alle sechs Slider gesetzt');

const vAuto = validateTactics(auto, squad);
ok(vAuto.ok, 'autoLineup-Ergebnis ist valide', vAuto.errors.join(' | '));
eq(vAuto.errors.length, 0, 'Keine Fehler in der automatischen Aufstellung');

// Alle Formationen müssen sich automatisch besetzen lassen
for (const id of FORMATION_IDS) {
  const t = autoLineup(squad, { formation: id, style: 'ausgeglichen' });
  const v = validateTactics(t, squad);
  eq(Object.keys(t.lineup).length, 11, `autoLineup("${id}") besetzt 11 Slots`);
  ok(v.ok, `autoLineup("${id}") ist valide`, v.errors.join(' | '));
}

// Verletzte und gesperrte Spieler werden übersprungen
const squad2 = buildSquad();
squad2.find(p => p.lastName === 'Knipser').injury = { name: 'Muskelfaserriss', days: 20 };
squad2.find(p => p.lastName === 'Abraeumer').cards.ban = 1;
const auto2 = autoLineup(squad2, { formation: '4-4-2' });
const ids2 = Object.values(auto2.lineup).concat(auto2.bench);
ok(!ids2.includes(squad2.find(p => p.lastName === 'Knipser').id), 'Verletzter Spieler bleibt draußen');
ok(!ids2.includes(squad2.find(p => p.lastName === 'Abraeumer').id), 'Gesperrter Spieler bleibt draußen');
ok(validateTactics(auto2, squad2).ok, 'Aufstellung trotz Ausfällen valide');

// opts.schonen
const schonId = squad.find(p => p.lastName === 'Zauberer').id;
const auto3 = autoLineup(squad, { formation: '4-2-3-1' }, { schonen: [schonId] });
ok(!Object.values(auto3.lineup).includes(schonId), 'Geschonter Spieler steht nicht in der Startelf');

// opts.formation überschreibt die Taktikvorgabe
const auto4 = autoLineup(squad, { formation: '4-4-2' }, { formation: '3-5-2' });
eq(auto4.formation, '3-5-2', 'opts.formation überschreibt tactics.formation');

// Die Automatik soll besser sein als eine willkürliche Zuordnung
const auto5 = autoLineup(squad, { formation: '4-4-2' });
const posMatches = FORMATIONS['4-4-2'].slots.filter(s => {
  const p = squad.find(q => q.id === auto5.lineup[s.id]);
  return p && (p.position === s.pos || (p.altPositions || []).includes(s.pos));
}).length;
ok(posMatches >= 8, 'Mindestens 8 von 11 Spielern stehen auf einer gelernten Position', `waren ${posMatches}`);

/* --------------------------------------------------------- validateTactics */

section('validateTactics — Fehlerfälle');

function withLineup(mut) {
  const t = JSON.parse(JSON.stringify(auto));
  mut(t);
  return t;
}

// (a) Weniger als 11 Spieler
{
  const t = withLineup(x => { delete x.lineup.s11; delete x.lineup.s10; });
  const v = validateTactics(t, squad);
  ok(!v.ok, 'Unvollständige Elf wird abgelehnt');
  ok(v.errors.some(e => /9 von 11/.test(e)), 'Fehlermeldung nennt die Zahl der besetzten Positionen', v.errors.join(' | '));
}

// (b) Kein Torwart
{
  const belegt = Object.values(auto.lineup).concat(auto.bench);
  const feldspieler = squad.find(p => p.position !== 'TW' && !belegt.includes(p.id))
    || squad.find(p => p.position === 'ST');
  const t = withLineup(x => {
    const tw = FORMATIONS[x.formation].slots.find(s => s.pos === 'TW').id;
    x.lineup[tw] = feldspieler.id;
  });
  const v = validateTactics(t, squad);
  ok(!v.ok, 'Elf ohne Torwart wird abgelehnt');
  ok(v.errors.some(e => /Torwart/.test(e)), 'Fehlermeldung nennt den fehlenden Torwart', v.errors.join(' | '));
}

// (c) Gesperrter Spieler aufgestellt
{
  const sq = buildSquad();
  const t = autoLineup(sq, { formation: '4-2-3-1' });
  const victim = sq.find(p => Object.values(t.lineup).includes(p.id) && p.position !== 'TW');
  victim.cards.ban = 2;
  const v = validateTactics(t, sq);
  ok(!v.ok, 'Gesperrter Spieler in der Startelf wird abgelehnt');
  ok(v.errors.some(e => /gesperrt/.test(e)), 'Fehlermeldung nennt die Sperre', v.errors.join(' | '));
}

// (d) Verletzter Spieler aufgestellt
{
  const sq = buildSquad();
  const t = autoLineup(sq, { formation: '4-2-3-1' });
  const victim = sq.find(p => Object.values(t.lineup).includes(p.id) && p.position !== 'TW');
  victim.injury = { name: 'Bänderriss', days: 60 };
  const v = validateTactics(t, sq);
  ok(!v.ok, 'Verletzter Spieler in der Startelf wird abgelehnt');
  ok(v.errors.some(e => /verletzt/.test(e)), 'Fehlermeldung nennt die Verletzung', v.errors.join(' | '));
}

// (e) Spieler doppelt aufgestellt
{
  const t = withLineup(x => { x.lineup.s11 = x.lineup.s10; });
  const v = validateTactics(t, squad);
  ok(!v.ok, 'Doppelte Aufstellung wird abgelehnt');
  ok(v.errors.some(e => /doppelt/.test(e)), 'Fehlermeldung nennt die Doppelbesetzung', v.errors.join(' | '));
}

// (f) Spieler gehört nicht zum Kader
{
  const t = withLineup(x => { x.lineup.s11 = 'p_fremd_niemand'; });
  const v = validateTactics(t, squad);
  ok(!v.ok, 'Fremder Spieler wird abgelehnt');
  ok(v.errors.some(e => /Kader/.test(e)), 'Fehlermeldung nennt den fremden Spieler', v.errors.join(' | '));
}

// (g) Unbekannte Formation
{
  const t = withLineup(x => { x.formation = 'gibtsnicht'; });
  const v = validateTactics(t, squad);
  ok(!v.ok, 'Unbekannte Formation wird abgelehnt');
}

section('validateTactics — Warnungen');

// (h) Spieler weit außer Position
{
  const sq = buildSquad();
  const t = autoLineup(sq, { formation: '4-4-2' });
  const stuermer = sq.find(p => p.lastName === 'Knipser');
  const ivSlot = FORMATIONS['4-4-2'].slots.find(s => s.pos === 'IV');
  const raus = t.lineup[ivSlot.id];
  t.lineup[ivSlot.id] = stuermer.id;
  // den verdrängten Spieler dorthin setzen, wo der Stürmer stand
  for (const k in t.lineup) if (k !== ivSlot.id && t.lineup[k] === stuermer.id) t.lineup[k] = raus;
  const v = validateTactics(t, sq);
  ok(v.warnings.some(w => /Position/.test(w)), 'Warnung: Spieler außer Position', v.warnings.join(' | '));
}

// (i) Fitness unter 70
{
  const sq = buildSquad();
  const t = autoLineup(sq, { formation: '4-4-2' });
  const p = sq.find(q => Object.values(t.lineup).includes(q.id));
  p.fitness = 55;
  const v = validateTactics(t, sq);
  ok(v.warnings.some(w => /Fitness/.test(w)), 'Warnung: geringe Fitness', v.warnings.join(' | '));
}

// (j) Keine Führungsspieler
{
  const sq = buildSquad();
  for (const p of sq) { p.attributes.fuehrung = 40; p.traits = []; }
  const t = autoLineup(sq, { formation: '4-4-2' });
  const v = validateTactics(t, sq);
  ok(v.warnings.some(w => /Führungsspieler/.test(w)), 'Warnung: kein Führungsspieler', v.warnings.join(' | '));
}

// (k) Kein Elfmeterschütze bestimmt
{
  const t = withLineup(x => { x.setPieces.elfmeter = null; });
  const v = validateTactics(t, squad);
  ok(v.warnings.some(w => /Elfmeterschütze/.test(w)), 'Warnung: kein Elfmeterschütze', v.warnings.join(' | '));
}

// (l) Bank ohne Torwart
{
  const sq = buildSquad();
  const t = autoLineup(sq, { formation: '4-4-2' });
  t.bench = t.bench.filter(id => sq.find(p => p.id === id).position !== 'TW');
  const v = validateTactics(t, sq);
  ok(v.warnings.some(w => /Ersatztorwart/.test(w)), 'Warnung: kein Ersatztorwart auf der Bank', v.warnings.join(' | '));
}

// (m) Zu große Bank
{
  const t = withLineup(x => { x.bench = squad.slice(0, 12).map(p => p.id); });
  const v = validateTactics(t, squad);
  ok(!v.ok, 'Bank mit mehr als 9 Spielern wird abgelehnt');
}

// (n) Gültige Taktik erzeugt keine Fehler
{
  const v = validateTactics(auto, squad);
  ok(v.ok && v.errors.length === 0, 'Saubere Taktik meldet keine Fehler', v.errors.join(' | '));
}

/* ------------------------------------------------------- formationCounter */

section('formationCounter');

for (const id of FORMATION_IDS) {
  const c = formationCounter(id);
  ok(Array.isArray(c.strongVs), `[${id}] strongVs ist ein Array`);
  ok(Array.isArray(c.weakVs), `[${id}] weakVs ist ein Array`);
  ok(c.strongVs.every(x => !!FORMATIONS[x]), `[${id}] strongVs enthält nur gültige IDs`);
  ok(c.weakVs.every(x => !!FORMATIONS[x]), `[${id}] weakVs enthält nur gültige IDs`);
  ok(!c.strongVs.includes(id) && !c.weakVs.includes(id), `[${id}] kontert sich nicht selbst`);
  ok(c.strongVs.every(x => !c.weakVs.includes(x)), `[${id}] keine Überschneidung strong/weak`);
  ok(typeof c.erklaerung === 'string' && c.erklaerung.length > 40, `[${id}] erklaerung ist deutscher Fließtext`);
}
{
  const c = formationCounter('gibtsnicht');
  ok(c.strongVs.length === 0 && c.weakVs.length === 0, 'formationCounter() bei unbekannter Formation leer');
}
// Plausibilität: das ultradefensive 5-4-1 sollte gegen das ultraoffensive 4-2-4 gut aussehen
ok(formationCounter('4-2-4').weakVs.length > 0, '4-2-4 hat erkennbare Schwächen');
ok(formationCounter('5-4-1').strongVs.length > 0, '5-4-1 hat erkennbare Stärken');

/* ------------------------------------------------ defaultTactics / suggest */

section('defaultTactics & suggestTactics');

const club = { id: 'test', name: 'FC Testverein', reputation: 68 };
const def = defaultTactics(club, squad);
ok(!!FORMATIONS[def.formation], 'defaultTactics liefert eine gültige Formation', def.formation);
ok(!!STYLES[def.style], 'defaultTactics liefert einen gültigen Stil', def.style);
eq(Object.keys(def.lineup).length, 11, 'defaultTactics stellt 11 Spieler auf');
ok(validateTactics(def, squad).ok, 'defaultTactics ist valide', validateTactics(def, squad).errors.join(' | '));
ok(def.instructions && Object.keys(def.instructions).length >= 8, 'defaultTactics setzt alle Zusatzanweisungen');
ok(typeof describeTactics(def) === 'string' && describeTactics(def).length > 8, 'describeTactics liefert Text');

const gegner = {
  club: { id: 'gross', name: 'Großverein', reputation: 92 },
  players: buildSquad(),
  tactics: { formation: '4-3-3', style: 'ballbesitz' },
  staerke: 86
};
const sug = suggestTactics(squad, gegner, { heim: true, wichtig: true, wetter: 'regen' });
ok(!!FORMATIONS[sug.formation], 'suggestTactics liefert gültige Formation', sug.formation);
ok(!!STYLES[sug.style], 'suggestTactics liefert gültigen Stil', sug.style);
ok(sug.begruendung.length >= 3, 'suggestTactics begründet mit mindestens 3 Sätzen', `waren ${sug.begruendung.length}`);
ok(sug.begruendung.every(s => typeof s === 'string' && s.length > 10), 'Alle Begründungen sind Sätze');
ok(['tempo', 'breite', 'pressinghoehe', 'risiko', 'haerte', 'offensivdrang']
  .every(k => typeof sug.sliders[k] === 'number' && sug.sliders[k] >= 0 && sug.sliders[k] <= 100),
  'suggestTactics liefert vollständige Slider 0..100');

// Als klarer Außenseiter muss defensiver gedacht werden
const sugUnder = suggestTactics(squad, { staerke: 95, tactics: { formation: '4-3-3' } }, { heim: false });
ok(['konter', 'defensiv', 'ausgeglichen', 'umschaltspiel'].includes(sugUnder.style),
  'Als Außenseiter wird kein Harakiri-Stil vorgeschlagen', sugUnder.style);

// Bei "muss gewinnen" muss offensiver gedacht werden
const sugPush = suggestTactics(squad, { staerke: 60 }, { heim: true, muessGewinnen: true });
ok(STYLES[sugPush.style].mods.risiko >= 50, 'Bei "muss gewinnen" steigt das Risiko', sugPush.style);

// ohne Gegner-Infos darf nichts explodieren
const sugSolo = suggestTactics(squad, null, {});
ok(!!FORMATIONS[sugSolo.formation] && !!STYLES[sugSolo.style], 'suggestTactics funktioniert ohne Gegnerdaten');

/* ------------------------------------------------------------ Randfälle */

section('Randfälle');

{
  // Kader zu klein
  const t = autoLineup(squad.slice(0, 7), { formation: '4-4-2' });
  ok(Object.keys(t.lineup).length <= 11, 'Zu kleiner Kader führt nicht zu Überbesetzung');
  const v = validateTactics(t, squad.slice(0, 7));
  ok(!v.ok, 'Zu kleiner Kader wird als Fehler gemeldet');
}
{
  const t = autoLineup([], { formation: '4-4-2' });
  eq(Object.keys(t.lineup).length, 0, 'Leerer Kader ergibt leere Aufstellung');
  ok(!validateTactics(t, []).ok, 'Leere Aufstellung ist nicht valide');
}
{
  const v = validateTactics(null, squad);
  ok(!v.ok && v.errors.length === 1, 'validateTactics(null) meldet sauber einen Fehler');
}
{
  const eff = tacticsTeamEffects(auto, squad);
  ok(typeof eff.defensivstabilitaet === 'number' && typeof eff.kreativitaet === 'number',
    'tacticsTeamEffects liefert numerische Team-Kennwerte');
  const t = JSON.parse(JSON.stringify(auto));
  t.instructions.gegenpressing = true;
  const eff2 = tacticsTeamEffects(t, squad);
  ok(eff2.pressingwucht > eff.pressingwucht, 'Gegenpressing erhöht die Pressingwucht');
}

/* ----------------------------------------------------------- Determinismus */

section('Determinismus');
{
  const a = autoLineup(buildSquad(), { formation: '4-2-3-1' });
  const b = autoLineup(buildSquad(), { formation: '4-2-3-1' });
  eq(JSON.stringify(a.lineup), JSON.stringify(b.lineup), 'autoLineup ist deterministisch');
  eq(JSON.stringify(a.setPieces), JSON.stringify(b.setPieces), 'Standardschützen sind deterministisch');
}

/* -------------------------------------------------------------- Ergebnis */

console.log('');
if (failures.length === 0) {
  console.log(`✅ ALLE TESTS BESTANDEN — ${passed} Prüfungen.`);
  process.exit(0);
} else {
  console.log(`❌ ${failures.length} FEHLER (${passed} Prüfungen bestanden):\n`);
  for (const f of failures.slice(0, 60)) console.log('  • ' + f);
  if (failures.length > 60) console.log(`  … und ${failures.length - 60} weitere.`);
  process.exit(1);
}
