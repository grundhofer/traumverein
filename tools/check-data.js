/**
 * Datenprüfung: node tools/check-data.js
 *
 * Prüft die statischen Datendateien (Vereine, Kader, Ligen) auf Vollständigkeit
 * und Konsistenz. Gibt am Ende eine ovr-Tabelle zur Plausibilitätsprüfung aus.
 * Exitcode 1, sobald ein Fehler gefunden wurde.
 */

import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ATTRIBUTES, TRAITS, NATION_NAMES, POSITION_GROUP } from '../src/core/constants.js';

const SQUAD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/squads');

let fehler = 0;
let warnungen = 0;

function ok(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { fehler++; console.log('  ✗ ' + msg); }
function warn(msg) { warnungen++; console.log('  ! ' + msg); }
function head(msg) { console.log('\n' + msg); }

// ---------------------------------------------------------------------------
// 1. Importierbarkeit
// ---------------------------------------------------------------------------
head('1. Module importieren');

// Die Kaderdateien werden im Verzeichnis gesucht statt aufgezählt: Stufe 5 legt
// weitere Gruppendateien für die 2. Bundesliga daneben, und die Prüfung soll
// sie ohne Pflege dieser Liste mitnehmen.
const KADER_DATEIEN = readdirSync(SQUAD_DIR)
  .filter(n => n.endsWith('.js') && n !== 'index.js' && !n.startsWith('_'))
  .sort()
  .map(n => '../src/data/squads/' + n);

const MODULE = [
  '../src/data/clubs.js',
  '../src/data/names.js',
  '../src/data/generator.js',
  '../src/data/leagues.js',
  ...KADER_DATEIEN,
  '../src/data/squads/index.js'
];

const geladen = {};
for (const pfad of MODULE) {
  try {
    geladen[pfad] = await import(pfad);
    ok(pfad + ' (' + Object.keys(geladen[pfad]).length + ' Exporte)');
  } catch (e) {
    fail(pfad + ' – ' + e.message);
  }
}
if (fehler) {
  console.log('\nAbbruch: Module lassen sich nicht laden.');
  process.exit(1);
}

const { CLUBS, CLUBS_BY_ID } = geladen['../src/data/clubs.js'];
const { LEAGUES, generateFixtures } = geladen['../src/data/leagues.js'];
const { ALL_SQUAD_PLAYERS, playersOfClub } = geladen['../src/data/squads/index.js'];
const { playerOverall } = await import('../src/engine/ratings.js');

// ---------------------------------------------------------------------------
// 2. Vereine
// ---------------------------------------------------------------------------
head('2. Vereine');

if (CLUBS.length === 36) ok('36 Vereine');
else fail('Erwartet 36 Vereine, gefunden ' + CLUBS.length);

const clubIds = CLUBS.map(c => c.id);
const doppelteClubs = clubIds.filter((id, i) => clubIds.indexOf(id) !== i);
if (!doppelteClubs.length) ok('Vereins-IDs eindeutig');
else fail('Doppelte Vereins-IDs: ' + [...new Set(doppelteClubs)].join(', '));

const bl1Clubs = CLUBS.filter(c => c.leagueId === 'bl1');
const bl2Clubs = CLUBS.filter(c => c.leagueId === 'bl2');
if (bl1Clubs.length === 18) ok('18 Vereine in bl1');
else fail('bl1 hat ' + bl1Clubs.length + ' Vereine (erwartet 18)');
if (bl2Clubs.length === 18) ok('18 Vereine in bl2');
else fail('bl2 hat ' + bl2Clubs.length + ' Vereine (erwartet 18)');

const fremdeLiga = CLUBS.filter(c => c.leagueId !== 'bl1' && c.leagueId !== 'bl2');
if (fremdeLiga.length) fail('Unbekannte leagueId: ' + fremdeLiga.map(c => c.id + '=' + c.leagueId).join(', '));

// LEAGUES.clubIds muss zu clubs.js passen
for (const lid of ['bl1', 'bl2']) {
  const liga = LEAGUES[lid];
  const soll = CLUBS.filter(c => c.leagueId === lid).map(c => c.id).sort();
  const ist = (liga && liga.clubIds ? liga.clubIds.slice() : []).sort();
  if (soll.join('|') === ist.join('|')) ok('LEAGUES.' + lid + '.clubIds deckt sich mit clubs.js');
  else {
    const fehlt = soll.filter(id => !ist.includes(id));
    const zuviel = ist.filter(id => !soll.includes(id));
    fail('LEAGUES.' + lid + '.clubIds weicht ab – fehlt: [' + fehlt.join(',') + '] zuviel: [' + zuviel.join(',') + ']');
  }
}

// ---------------------------------------------------------------------------
// 3. Kader: Anzahl, Größe, Positionsverteilung
// ---------------------------------------------------------------------------
head('3. Kader (Anzahl / Größe / Positionsverteilung)');

// Seit Roadmap-Stufe 5 gilt die Erwartung für beide Profiligen: 36 handgepflegte
// Kader (bl1 + bl2) mit je 24 Spielern, also 864 Spieler. Solange die
// Zweitligakader noch fehlen, meldet die Prüfung sie namentlich, statt
// abzubrechen – alle folgenden Abschnitte laufen über das, was da ist.
const KADER_LIGEN = ['bl1', 'bl2'];
const SOLL_KADER = 36;
const SOLL_KADERGROESSE = 24;
const SOLL_SPIELER = SOLL_KADER * SOLL_KADERGROESSE;   // 864

const kaderIds = [...new Set(ALL_SQUAD_PLAYERS.map(p => p.clubId))];
if (kaderIds.length === SOLL_KADER) ok(SOLL_KADER + ' Kader vorhanden (bl1 + bl2)');
else fail('Erwartet ' + SOLL_KADER + ' Kader (bl1 + bl2), gefunden ' + kaderIds.length);

if (ALL_SQUAD_PLAYERS.length === SOLL_SPIELER) ok(SOLL_SPIELER + ' handgepflegte Spieler');
else fail('Erwartet ' + SOLL_SPIELER + ' handgepflegte Spieler, gefunden ' + ALL_SQUAD_PLAYERS.length +
  ' (Differenz ' + (ALL_SQUAD_PLAYERS.length - SOLL_SPIELER) + ')');

const fremdeKader = kaderIds.filter(id => !CLUBS_BY_ID[id] || !KADER_LIGEN.includes(CLUBS_BY_ID[id].leagueId));
if (!fremdeKader.length) ok('Alle Kader gehören zu bl1- oder bl2-Vereinen');
else fail('Kader für Vereine außerhalb bl1/bl2: ' + fremdeKader.join(', '));

for (const [lid, clubs] of [['bl1', bl1Clubs], ['bl2', bl2Clubs]]) {
  const ohneKader = clubs.filter(c => !kaderIds.includes(c.id));
  if (!ohneKader.length) ok('Jeder ' + lid + '-Verein hat einen handgepflegten Kader (' + clubs.length + ')');
  else fail(lid + ': ' + ohneKader.length + ' von ' + clubs.length + ' Vereinen ohne handgepflegten Kader – ' +
    ohneKader.map(c => c.name + ' [' + c.id + ']').sort().join(', '));
}

const SOLL_GRUPPEN = { TW: 3, ABW: 8, MIT: 8, STU: 5 };
let groesseOk = true, verteilungOk = true;
for (const id of kaderIds.slice().sort()) {
  const kader = playersOfClub(id);
  if (kader.length !== SOLL_KADERGROESSE) { fail(id + ': ' + kader.length + ' Spieler (erwartet ' + SOLL_KADERGROESSE + ')'); groesseOk = false; }
  const g = { TW: 0, ABW: 0, MIT: 0, STU: 0 };
  for (const p of kader) {
    const grp = POSITION_GROUP[p.position];
    if (!grp) { fail(id + ': unbekannte Position "' + p.position + '" bei ' + p.id); continue; }
    g[grp]++;
  }
  const abweichung = Object.keys(SOLL_GRUPPEN).filter(k => g[k] !== SOLL_GRUPPEN[k]);
  if (abweichung.length) {
    fail(id + ': Verteilung TW/ABW/MIT/STU = ' + g.TW + '/' + g.ABW + '/' + g.MIT + '/' + g.STU + ' (erwartet 3/8/8/5)');
    verteilungOk = false;
  }
}
if (groesseOk) ok('Alle Kader mit genau 24 Spielern');
if (verteilungOk) ok('Positionsverteilung überall 3/8/8/5');

// ---------------------------------------------------------------------------
// 4. IDs und Rückennummern
// ---------------------------------------------------------------------------
head('4. Spieler-IDs & Rückennummern');

const idZaehler = {};
for (const p of ALL_SQUAD_PLAYERS) idZaehler[p.id] = (idZaehler[p.id] || 0) + 1;
const doppelteIds = Object.keys(idZaehler).filter(k => idZaehler[k] > 1);
if (!doppelteIds.length) ok(ALL_SQUAD_PLAYERS.length + ' Spieler-IDs global eindeutig');
else fail('Doppelte Spieler-IDs: ' + doppelteIds.join(', '));

let nummernOk = true;
for (const id of kaderIds.slice().sort()) {
  const kader = playersOfClub(id);
  const gesehen = {};
  for (const p of kader) gesehen[p.number] = (gesehen[p.number] || 0) + 1;
  const dop = Object.keys(gesehen).filter(n => gesehen[n] > 1);
  if (dop.length) { fail(id + ': doppelte Rückennummern ' + dop.join(', ')); nummernOk = false; }
  const ungueltig = kader.filter(p => !Number.isInteger(p.number) || p.number < 1 || p.number > 99);
  if (ungueltig.length) { fail(id + ': ungültige Nummern bei ' + ungueltig.map(p => p.id + '=' + p.number).join(', ')); nummernOk = false; }
}
if (nummernOk) ok('Rückennummern je Verein eindeutig und 1..99');

// ---------------------------------------------------------------------------
// 5. Nummer 1 = Torwart
// ---------------------------------------------------------------------------
head('5. Nummer 1 gehört dem Torwart');

let einsOk = true;
for (const id of kaderIds.slice().sort()) {
  const kader = playersOfClub(id);
  const einser = kader.filter(p => p.number === 1);
  if (einser.length !== 1) { fail(id + ': ' + einser.length + ' Spieler mit Nummer 1'); einsOk = false; continue; }
  if (einser[0].position !== 'TW') {
    fail(id + ': Nummer 1 ist ' + einser[0].lastName + ' (' + einser[0].position + '), kein TW');
    einsOk = false;
  }
}
if (einsOk) ok('Überall genau ein Torwart mit der Nummer 1');

// ---------------------------------------------------------------------------
// 6. clubId-Referenzen
// ---------------------------------------------------------------------------
head('6. clubId-Referenzen');

const unbekannteClubs = [...new Set(ALL_SQUAD_PLAYERS.filter(p => !CLUBS_BY_ID[p.clubId]).map(p => p.clubId))];
if (!unbekannteClubs.length) ok('Alle clubId-Werte existieren in clubs.js');
else fail('Unbekannte clubId in Kadern: ' + unbekannteClubs.join(', '));

// ---------------------------------------------------------------------------
// 7. Attribute
// ---------------------------------------------------------------------------
head('7. Attribute');

const fehlendeAttr = [];
const schlechteWerte = [];
const extraAttr = new Set();
for (const p of ALL_SQUAD_PLAYERS) {
  const a = p.attributes || {};
  for (const key of ATTRIBUTES) {
    const v = a[key];
    if (v === undefined) fehlendeAttr.push(p.id + '.' + key);
    else if (!Number.isInteger(v) || v < 1 || v > 99) schlechteWerte.push(p.id + '.' + key + '=' + v);
  }
  for (const key in a) if (!ATTRIBUTES.includes(key)) extraAttr.add(p.id + '.' + key);
}
if (!fehlendeAttr.length) ok('Alle 20 ATTRIBUTES bei allen Spielern vorhanden');
else fail('Fehlende Attribute (' + fehlendeAttr.length + '): ' + fehlendeAttr.slice(0, 10).join(', '));
if (!schlechteWerte.length) ok('Alle Attributwerte im Bereich 1..99 (ganzzahlig)');
else fail('Werte außerhalb 1..99 (' + schlechteWerte.length + '): ' + schlechteWerte.slice(0, 10).join(', '));
if (extraAttr.size) warn('Unbekannte Attribut-Keys: ' + [...extraAttr].slice(0, 10).join(', '));

// Pflichtfelder aus dem Datenvertrag
const pflicht = ['id', 'firstName', 'lastName', 'shortName', 'clubId', 'nationality', 'age',
  'era', 'position', 'altPositions', 'attributes', 'potential', 'foot', 'traits',
  'appearance', 'number', 'contract', 'value'];
const fehlendeFelder = [];
for (const p of ALL_SQUAD_PLAYERS) {
  for (const f of pflicht) if (p[f] === undefined) fehlendeFelder.push(p.id + '.' + f);
  if (p.potential < playerOverall(p) - 1) fehlendeFelder.push(p.id + ': potential < ovr');
  if (p.era === 'legend' && !p.eraLabel) fehlendeFelder.push(p.id + ': era=legend ohne eraLabel');
  if (p.era !== 'legend' && p.era !== 'modern') fehlendeFelder.push(p.id + ': era="' + p.era + '"');
}
if (!fehlendeFelder.length) ok('Alle Pflichtfelder gesetzt (inkl. era/eraLabel/potential)');
else fail('Feldprobleme (' + fehlendeFelder.length + '): ' + fehlendeFelder.slice(0, 10).join(', '));

// ---------------------------------------------------------------------------
// 8. Traits & Nationalitäten
// ---------------------------------------------------------------------------
head('8. Traits & Nationalitäten');

const unbekannteTraits = new Set();
const zuVieleTraits = [];
const unbekannteNationen = new Set();
for (const p of ALL_SQUAD_PLAYERS) {
  const t = p.traits || [];
  if (t.length > 3) zuVieleTraits.push(p.id + ' (' + t.length + ')');
  for (const key of t) if (!TRAITS[key]) unbekannteTraits.add(key);
  if (!NATION_NAMES[p.nationality]) unbekannteNationen.add(p.nationality);
}
if (!unbekannteTraits.size) ok('Alle traits-Keys existieren in TRAITS');
else fail('Unbekannte Traits: ' + [...unbekannteTraits].join(', '));
if (!zuVieleTraits.length) ok('Kein Spieler mit mehr als 3 Traits');
else warn('Mehr als 3 Traits: ' + zuVieleTraits.slice(0, 10).join(', '));
if (!unbekannteNationen.size) ok('Alle nationality-Keys existieren in NATION_NAMES');
else fail('Unbekannte Nationen: ' + [...unbekannteNationen].join(', '));

// altPositions-Prüfung
const schlechteAlt = [];
for (const p of ALL_SQUAD_PLAYERS) {
  const alt = p.altPositions || [];
  if (alt.length > 3) schlechteAlt.push(p.id + ': ' + alt.length + ' Nebenpositionen');
  if (alt.includes(p.position)) schlechteAlt.push(p.id + ': Hauptposition in altPositions');
  for (const a of alt) if (!POSITION_GROUP[a]) schlechteAlt.push(p.id + ': unbekannte Nebenposition ' + a);
}
if (!schlechteAlt.length) ok('altPositions gültig (max. 3, ohne Hauptposition)');
else fail('altPositions-Probleme (' + schlechteAlt.length + '): ' + schlechteAlt.slice(0, 10).join(', '));

// ---------------------------------------------------------------------------
// 9. Legenden-Anteil
// ---------------------------------------------------------------------------
head('9. Legenden je Verein (mind. 8)');

let legendenOk = true;
for (const id of kaderIds.slice().sort()) {
  const kader = playersOfClub(id);
  const legenden = kader.filter(p => p.era === 'legend').length;
  if (legenden < 8) { fail(id + ': nur ' + legenden + ' Legenden'); legendenOk = false; }
}
if (legendenOk) ok('Jeder Verein hat mindestens 8 Legenden');

// ---------------------------------------------------------------------------
// 10. ovr-Tabelle
// ---------------------------------------------------------------------------
head('10. Kaderstärke (Durchschnitt ovr)');

/* ---------------------------------------------------------------------------
 * STÄRKEVORGABE FÜR DIE HANDGEPFLEGTEN KADER (Roadmap-Stufe 5)
 *
 * Maßstab ist die Spalte Ø24 (Durchschnitt über alle 24 Spieler). Die bereits
 * gebaute 1. Bundesliga spannt gemessen von Bayern 85,0 bis Heidenheim 70,3;
 * ØTop11 liegt dort je Verein rund 2 bis 7 Punkte darüber.
 *
 * Die 2. Bundesliga liegt darunter, aber deutlich über den prozeduralen
 * Kadern, die sie bis Stufe 5 hatte (dort Ø24 rund 54 bis 64). Der Grund ist
 * derselbe wie in Liga eins: Acht bis zehn Vereinslegenden in Bestform heben
 * jeden Kader, unabhängig von der aktuellen sportlichen Lage. Richtwerte für
 * Ø24, gestaffelt nach Vereinsgeschichte statt nach heutigem Ruf:
 *
 *   Tradition (mehrfach Meister / große Ära):     72–74
 *     schalke 74 · kaiserslautern 73 · hertha 73 · nuernberg 72
 *     dresden 72 · braunschweig 72
 *   Mittelfeld:                                   68–70
 *     hannover 70 · duesseldorf 70 · bochum 69 · ksc 69 · bielefeld 68
 *     magdeburg 68 · kiel 68 · darmstadt 68 · fuerth 68
 *   Kleine Vereine (kurze Historie):               62–65
 *     paderborn 65 · muenster 64 · elversberg 63
 *
 * Zwei Leitplanken dazu:
 *   – Die Spitze der 2. Liga darf die Kellerkinder der 1. Liga überholen
 *     (Schalke 74 über Heidenheim 70,3). Das ist im Fußball normal und
 *     gewollt. Kein Zweitligist darf aber das Mittelfeld der 1. Liga
 *     erreichen: Ø24 über 75 ist zu viel.
 *   – Die Spanne innerhalb der 2. Liga (74 gegen 63) muss erhalten bleiben,
 *     sonst verliert der Aufstiegskampf seine Struktur.
 * ------------------------------------------------------------------------- */

const zeilen = kaderIds.map(id => {
  const kader = playersOfClub(id);
  const ovrs = kader.map(playerOverall).sort((a, b) => b - a);
  const schnitt = ovrs.reduce((s, v) => s + v, 0) / ovrs.length;
  const top11 = ovrs.slice(0, 11).reduce((s, v) => s + v, 0) / 11;
  const legenden = kader.filter(p => p.era === 'legend').length;
  return {
    id,
    name: CLUBS_BY_ID[id] ? CLUBS_BY_ID[id].shortName : id,
    liga: CLUBS_BY_ID[id] ? CLUBS_BY_ID[id].leagueId : '?',
    ruf: CLUBS_BY_ID[id] ? CLUBS_BY_ID[id].reputation : 0,
    schnitt, top11, max: ovrs[0], min: ovrs[ovrs.length - 1], legenden
  };
}).sort((a, b) => b.top11 - a.top11);

const p = (s, n) => String(s).padEnd(n);
const pl = (s, n) => String(s).padStart(n);
console.log('  ' + p('Verein', 18) + p('Liga', 6) + pl('Ruf', 4) + pl('Ø24', 7) + pl('ØTop11', 8) + pl('Max', 5) + pl('Min', 5) + pl('Leg', 5));
console.log('  ' + '-'.repeat(58));
for (const z of zeilen) {
  console.log('  ' + p(z.name, 18) + p(z.liga, 6) + pl(z.ruf, 4) + pl(z.schnitt.toFixed(1), 7) +
    pl(z.top11.toFixed(1), 8) + pl(z.max, 5) + pl(z.min, 5) + pl(z.legenden, 5));
}

// Leitplanke aus der Stärkevorgabe: kein Kader außerhalb 60..90 im Ø24.
const zuStark = zeilen.filter(z => z.schnitt > 90);
const zuSchwach = zeilen.filter(z => z.schnitt < 60);
if (zuStark.length) fail('Ø24 über 90: ' + zuStark.map(z => z.name + ' ' + z.schnitt.toFixed(1)).join(', '));
if (zuSchwach.length) fail('Ø24 unter 60: ' + zuSchwach.map(z => z.name + ' ' + z.schnitt.toFixed(1)).join(', '));
if (!zuStark.length && !zuSchwach.length) ok('Kaderdurchschnitte alle zwischen 60 und 90 (Ø24)');

// Der Ligavergleich ist nur aussagekräftig, wenn beide Ligen Kader haben.
const bl1Zeilen = zeilen.filter(z => z.liga === 'bl1');
const bl2Zeilen = zeilen.filter(z => z.liga === 'bl2');
if (bl1Zeilen.length && bl2Zeilen.length) {
  const bl1Schnitt = bl1Zeilen.reduce((s, z) => s + z.schnitt, 0) / bl1Zeilen.length;
  const bl2Schnitt = bl2Zeilen.reduce((s, z) => s + z.schnitt, 0) / bl2Zeilen.length;
  console.log('  Ø24 im Ligamittel: bl1 ' + bl1Schnitt.toFixed(1) + ' · bl2 ' + bl2Schnitt.toFixed(1) +
    ' (Abstand ' + (bl1Schnitt - bl2Schnitt).toFixed(1) + ')');
  if (bl2Schnitt >= bl1Schnitt) fail('Die 2. Liga ist im Mittel nicht schwächer als die 1. Liga.');
  else if (bl1Schnitt - bl2Schnitt < 4) warn('Nur ' + (bl1Schnitt - bl2Schnitt).toFixed(1) +
    ' Punkte Abstand zwischen den Ligamitteln – erwartet werden 6 bis 9.');
  else ok('2. Liga liegt im Mittel unter der 1. Liga');

  const zuHoch = bl2Zeilen.filter(z => z.schnitt > 75);
  if (zuHoch.length) fail('Zweitligakader über Ø24 75 (Mittelfeld der 1. Liga): ' +
    zuHoch.map(z => z.name + ' ' + z.schnitt.toFixed(1)).join(', '));
  else ok('Kein Zweitligakader erreicht das Mittelfeld der 1. Liga (Ø24 ≤ 75)');
}

// Plausibilität: Ruf und Kaderstärke sollten grob korrelieren
const sortiertNachRuf = zeilen.slice().sort((a, b) => b.ruf - a.ruf);
const ausreisser = sortiertNachRuf.filter((z, i) => {
  const rangStaerke = zeilen.findIndex(x => x.id === z.id);
  return Math.abs(rangStaerke - i) > 8;
});
if (ausreisser.length) warn('Ruf/Stärke weichen stark ab: ' + ausreisser.map(z => z.name).join(', '));
else ok('Ruf und Kaderstärke passen grob zusammen');

// ---------------------------------------------------------------------------
// 11. Spielplan
// ---------------------------------------------------------------------------
head('11. Spielplan');

for (const lid of ['bl1', 'bl2']) {
  const ids = CLUBS.filter(c => c.leagueId === lid).map(c => c.id);
  const fixtures = generateFixtures(ids, { competitionId: lid, season: 1 });

  const spieltage = {};
  for (const f of fixtures) (spieltage[f.matchday] || (spieltage[f.matchday] = [])).push(f);
  const nummern = Object.keys(spieltage).map(Number).sort((a, b) => a - b);

  if (nummern.length === 34 && nummern[0] === 1 && nummern[33] === 34) ok(lid + ': 34 Spieltage');
  else fail(lid + ': ' + nummern.length + ' Spieltage (erwartet 34, 1..34)');

  const falscheGroesse = nummern.filter(n => spieltage[n].length !== 9);
  if (!falscheGroesse.length) ok(lid + ': je 9 Spiele pro Spieltag (' + fixtures.length + ' Spiele gesamt)');
  else fail(lid + ': Spieltage mit abweichender Spielzahl: ' +
    falscheGroesse.map(n => n + '=' + spieltage[n].length).join(', '));

  const heim = {}, ausw = {};
  for (const id of ids) { heim[id] = 0; ausw[id] = 0; }
  for (const f of fixtures) { heim[f.homeId]++; ausw[f.awayId]++; }
  const schief = ids.filter(id => heim[id] !== 17 || ausw[id] !== 17);
  if (!schief.length) ok(lid + ': jeder Verein 17 Heim- / 17 Auswärtsspiele');
  else fail(lid + ': Heim/Auswärts schief bei ' + schief.map(id => id + ' ' + heim[id] + '/' + ausw[id]).join(', '));

  // Jede Paarung genau einmal pro Richtung
  const paarungen = {};
  for (const f of fixtures) {
    const k = f.homeId + '>' + f.awayId;
    paarungen[k] = (paarungen[k] || 0) + 1;
  }
  const dop = Object.keys(paarungen).filter(k => paarungen[k] > 1);
  if (!dop.length && Object.keys(paarungen).length === ids.length * (ids.length - 1)) {
    ok(lid + ': jede Paarung genau einmal je Richtung');
  } else {
    fail(lid + ': Paarungsfehler – ' + Object.keys(paarungen).length + ' verschiedene, Duplikate: ' + dop.slice(0, 5).join(', '));
  }

  // Kein Verein zweimal am selben Spieltag
  const doppelt = [];
  for (const n of nummern) {
    const gesehen = new Set();
    for (const f of spieltage[n]) {
      if (gesehen.has(f.homeId)) doppelt.push(n + ':' + f.homeId);
      if (gesehen.has(f.awayId)) doppelt.push(n + ':' + f.awayId);
      gesehen.add(f.homeId); gesehen.add(f.awayId);
    }
  }
  if (!doppelt.length) ok(lid + ': kein Verein doppelt an einem Spieltag');
  else fail(lid + ': Doppelansetzungen ' + doppelt.slice(0, 5).join(', '));

  // dayIndex je Spieltag streng aufsteigend
  const tage = nummern.map(n => spieltage[n][0].dayIndex);
  const unsortiert = tage.filter((t, i) => i > 0 && t <= tage[i - 1]);
  if (!unsortiert.length) ok(lid + ': Spieltermine streng aufsteigend (Tag ' + tage[0] + ' bis ' + tage[33] + ')');
  else fail(lid + ': Spieltermine nicht aufsteigend');
}

// ---------------------------------------------------------------------------
head('Ergebnis');
console.log('  Spieler gesamt: ' + ALL_SQUAD_PLAYERS.length +
  ' | Vereine: ' + CLUBS.length + ' | Fehler: ' + fehler + ' | Warnungen: ' + warnungen);
if (fehler) {
  console.log('\n  ROT – ' + fehler + ' Fehler.');
  process.exit(1);
}
console.log('\n  ALLES GRÜN.');
