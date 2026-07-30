/**
 * tools/check-euroclubs.js – Prüfstand für die europäischen Vereine (Roadmap-Stufe 3, Punkt 2).
 *
 * Seit Stufe 3 stehen die 66 Gegner aus `data/leagues.js:EURO_CLUBS` als echte
 * Vereine in `state.clubs` – gebaut von `core/state.js:euroClub()` nach dem
 * Muster von `amateurClub()`. Sie sind der billigste Teil des Europapokals und
 * gleichzeitig der gefährlichste: 66 volle Kader wären mehrere Megabyte
 * Spielstand für Mannschaften, gegen die man in einer Karriere vielleicht
 * fünfzehnmal spielt.
 *
 * Geprüft wird:
 *   1. Vollzähligkeit   alle EURO_CLUBS liegen in state.clubs, mit Laufzeitfeldern
 *   2. Aussehen         Farben, Trikot, Wappen, Stadion – landestypisch und zeichenbar
 *   3. Abgrenzung       nicht in state.leagues, nicht im Startbildschirm, nicht im Pokal
 *   4. Lazy-Kader       kein einziger Spieler vor dem ersten Spiel
 *   5. Kaderaufbau      nach ensureSquad() plausible Größe und Stärke,
 *                       Real Madrid deutlich über einem kleinen Meister
 *   6. Spielstand       Zuwachs durch die Stammdaten, beziffert
 *
 * Aufruf:  node tools/check-euroclubs.js
 * Rückgabe: Exit-Code 1, wenn eine Prüfung fehlschlägt.
 */

import { createNewGame, serialize, euroClub, euroLand, ensureSquad, pokalfeld } from '../src/core/state.js';
import { EURO_CLUBS, CUP, generateCupDraw } from '../src/data/leagues.js';
import { CLUBS } from '../src/data/clubs.js';
import { CREST_SHAPES, CREST_MOTIFS, hasFlag } from '../src/render/kits.js';
import { ovrForClub } from '../src/data/generator.js';
import { playerOverall } from '../src/engine/ratings.js';
import { createRng } from '../src/core/rng.js';

/* ------------------------------------------------------------------ *
 *  Mini-Testrahmen
 * ------------------------------------------------------------------ */

let bestanden = 0;
const fehler = [];

function test(name, fn) {
  try {
    fn();
    bestanden++;
    console.log('  ok   ' + name);
  } catch (e) {
    fehler.push(name + ': ' + e.message);
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}

function assert(bed, msg) {
  if (!bed) throw new Error(msg);
}

const kopf = (nr, titel) => {
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  ${nr}. ${titel}`);
  console.log('─'.repeat(64));
};

const kb = b => (b / 1024).toFixed(1).replace('.', ',') + ' kB';
const mb = b => (b / 1048576).toFixed(2).replace('.', ',') + ' MB';
const HEX = /^#[0-9a-f]{6}$/i;
const MUSTER = ['plain', 'stripes', 'hoops', 'sash', 'halves', 'chest'];

/* ------------------------------------------------------------------ *
 *  Aufbau
 * ------------------------------------------------------------------ */

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Europäische Vereine – Prüfstand');
console.log('══════════════════════════════════════════════════════════════');

const SEED = 7;
const state = createNewGame({ clubId: 'hsv', managerName: 'Prüfstand', seed: SEED });
const euro = EURO_CLUBS.map(raw => state.clubs[raw.id]);

kopf(1, `Vollzähligkeit (${EURO_CLUBS.length} europäische Vereine)`);

test('jeder EURO_CLUBS-Eintrag liegt in state.clubs', () => {
  const fehlend = EURO_CLUBS.filter(raw => !state.clubs[raw.id]).map(c => c.id);
  assert(fehlend.length === 0, `${fehlend.length} fehlen: ${fehlend.slice(0, 5).join(', ')}`);
});

test('Stammdaten unverändert übernommen (id, Name, Kürzel, Reputation, Land)', () => {
  for (const raw of EURO_CLUBS) {
    const c = state.clubs[raw.id];
    assert(c.name === raw.name, `${raw.id}: Name "${c.name}" statt "${raw.name}"`);
    assert(c.abbr === raw.abbr, `${raw.id}: Kürzel "${c.abbr}" statt "${raw.abbr}"`);
    assert(c.reputation === raw.reputation,
      `${raw.id}: Reputation ${c.reputation} statt ${raw.reputation}`);
    assert(c.country === raw.country, `${raw.id}: Land "${c.country}" statt "${raw.country}"`);
  }
});

test('Kennzeichnung: leagueId "europa", istEuropaeisch, lazySquad', () => {
  for (const c of euro) {
    assert(c.leagueId === 'europa', `${c.id}: leagueId "${c.leagueId}"`);
    assert(c.istEuropaeisch === true, `${c.id}: istEuropaeisch fehlt`);
    assert(c.lazySquad === true, `${c.id}: lazySquad fehlt`);
    assert(!c.istAmateur, `${c.id}: gilt zusätzlich als Amateurverein`);
  }
});

test('initClubRuntime() ist durchgelaufen (Vorstand, Fans, Finanzen, Stadion, Training)', () => {
  for (const c of euro) {
    for (const feld of ['finances', 'sponsors', 'board', 'fans', 'stadiumState', 'youth', 'training', 'season']) {
      assert(c[feld] && typeof c[feld] === 'object', `${c.id}: ${feld} fehlt`);
    }
    assert(Array.isArray(c.playerIds) && Array.isArray(c.staffIds), `${c.id}: Kaderlisten fehlen`);
    assert(c.board.erwartung && c.board.erwartung.text, `${c.id}: Vorstandserwartung fehlt`);
    assert(Number.isFinite(c.finances.balance), `${c.id}: Kontostand ist keine Zahl`);
  }
});

test('euroClub() ist für dieselbe Eingabe reproduzierbar', () => {
  const a = euroClub(EURO_CLUBS[0], createRng('probe'));
  const b = euroClub(EURO_CLUBS[0], createRng('probe'));
  assert(JSON.stringify(a) === JSON.stringify(b), 'zwei Aufrufe, zwei Vereine');
});

/* ------------------------------------------------------------------ */

kopf(2, 'Aussehen: Farben, Trikot, Wappen, Stadion');

test('Farben sind gültige Hexwerte und primary ≠ secondary', () => {
  for (const c of euro) {
    const col = c.colors;
    assert(HEX.test(col.primary) && HEX.test(col.secondary) && HEX.test(col.accent),
      `${c.id}: ${JSON.stringify(col)}`);
    assert(col.primary.toLowerCase() !== col.secondary.toLowerCase(),
      `${c.id}: Heimtrikot einfarbig in einer Farbe`);
  }
});

test('Trikotmuster kennt render/kits.js, Auswärtstrikot ist gedreht', () => {
  for (const c of euro) {
    assert(MUSTER.includes(c.kit.pattern), `${c.id}: Muster "${c.kit.pattern}"`);
    assert(MUSTER.includes(c.awayKit.pattern), `${c.id}: Auswärtsmuster "${c.awayKit.pattern}"`);
    assert(c.awayKit.primary.toLowerCase() === c.colors.secondary.toLowerCase(),
      `${c.id}: Auswärtstrikot nicht aus den Vereinsfarben`);
  }
});

test('Wappen: Form und Motiv sind zeichenbar', () => {
  for (const c of euro) {
    assert(CREST_SHAPES.includes(c.crest.shape), `${c.id}: Wappenform "${c.crest.shape}"`);
    assert(CREST_MOTIFS.includes(c.crest.motif), `${c.id}: Wappenmotiv "${c.crest.motif}"`);
    assert(HEX.test(c.crest.bg) && HEX.test(c.crest.fg), `${c.id}: Wappenfarben`);
    assert(c.crest.bg.toLowerCase() !== c.crest.fg.toLowerCase(), `${c.id}: Wappen einfarbig`);
  }
});

test('für jedes Land zeichnet render/kits.js eine Flagge', () => {
  const ohne = [...new Set(euro.map(c => c.country))].filter(code => !hasFlag(code));
  assert(ohne.length === 0, `keine Flagge für: ${ohne.join(', ')}`);
});

test('jedes Land hat eine eigene Farbwelt in euroLand()', () => {
  const ohne = [...new Set(euro.map(c => c.country))].filter(code => euroLand(code).land === 'Europa');
  assert(ohne.length === 0, `Rückfallebene statt Landesfarben: ${ohne.join(', ')}`);
});

test('Vereine desselben Landes sehen nicht alle gleich aus', () => {
  const nachLand = new Map();
  for (const c of euro) {
    if (!nachLand.has(c.country)) nachLand.set(c.country, new Set());
    nachLand.get(c.country).add(c.colors.primary + c.kit.pattern + c.crest.motif);
  }
  for (const [code, muster] of nachLand) {
    const anzahl = euro.filter(c => c.country === code).length;
    if (anzahl < 3) continue;
    assert(muster.size >= 2, `${code}: ${anzahl} Vereine, aber nur ein Erscheinungsbild`);
  }
});

test('Stadionname ist landestypisch und trägt den Vereinsnamen', () => {
  for (const c of euro) {
    assert(typeof c.stadium.name === 'string' && c.stadium.name.length > 3, `${c.id}: kein Stadionname`);
    assert(c.stadium.name.includes(c.shortName), `${c.id}: "${c.stadium.name}" ohne Vereinsnamen`);
  }
  const real = state.clubs.eu_real, liv = state.clubs.eu_liverpool;
  assert(real.stadium.name !== liv.stadium.name, 'Spanien und England mit demselben Stadionnamen');
});

test('Stadion, Fans und Finanzen wachsen mit der Reputation', () => {
  const sortiert = euro.slice().sort((a, b) => a.reputation - b.reputation);
  const klein = sortiert[0], gross = sortiert[sortiert.length - 1];
  assert(gross.stadium.capacity > klein.stadium.capacity * 2,
    `Kapazität ${klein.stadium.capacity} → ${gross.stadium.capacity}`);
  assert(gross.fans.members > klein.fans.members * 2,
    `Mitglieder ${klein.fans.members} → ${gross.fans.members}`);
  assert(gross.finances.balance > klein.finances.balance,
    `Kontostand ${klein.finances.balance} → ${gross.finances.balance}`);
  for (const c of euro) {
    assert(c.stadium.capacity >= 11000 && c.stadium.capacity <= 85000,
      `${c.id}: Kapazität ${c.stadium.capacity}`);
    assert(c.finances.balance > 0, `${c.id}: startet im Minus`);
    for (const f of ['training', 'medical', 'youth', 'scouting']) {
      assert(c.facilities[f] >= 20 && c.facilities[f] <= 100, `${c.id}: facilities.${f}`);
    }
  }
});

/* ------------------------------------------------------------------ */

kopf(3, 'Abgrenzung: Liga, Startbildschirm, Pokal');

test('state.leagues enthält keinen europäischen Verein', () => {
  for (const liga of Object.values(state.leagues)) {
    const drin = liga.clubIds.filter(id => state.clubs[id] && state.clubs[id].istEuropaeisch);
    assert(drin.length === 0, `Liga ${liga.id}: ${drin.join(', ')}`);
    assert(liga.clubIds.length === 18, `Liga ${liga.id} hat ${liga.clubIds.length} Vereine`);
  }
  assert(!state.leagues.europa, 'state.leagues hat einen Eintrag "europa"');
});

test('der Startbildschirm (data/clubs.js) kennt sie nicht', () => {
  const ids = new Set(CLUBS.map(c => c.id));
  const sichtbar = EURO_CLUBS.filter(c => ids.has(c.id)).map(c => c.id);
  assert(sichtbar.length === 0, `zur Auswahl angeboten: ${sichtbar.join(', ')}`);
  assert(CLUBS.length === 36, `${CLUBS.length} statt 36 wählbare Vereine`);
});

test(`der DFB-Pokal bleibt bei ${CUP.teams} Mannschaften`, () => {
  const feld = pokalfeld(state);
  assert(feld.length === CUP.teams, `pokalfeld() liefert ${feld.length} statt ${CUP.teams}`);
  assert(!feld.some(c => c.istEuropaeisch), 'ein europäischer Verein steht im Losbeutel');
  const runde1 = state.fixtures.filter(f => f.competitionId === CUP.id && f.season === 1);
  const beteiligt = new Set();
  for (const f of runde1) { beteiligt.add(f.homeId); if (f.awayId) beteiligt.add(f.awayId); }
  assert(beteiligt.size === CUP.teams, `1. Runde mit ${beteiligt.size} Mannschaften`);
  const euroImPokal = [...beteiligt].filter(id => state.clubs[id] && state.clubs[id].istEuropaeisch);
  assert(euroImPokal.length === 0, `im Pokal ausgelost: ${euroImPokal.join(', ')}`);
});

test('auch eine frisch geloste Pokalrunde zieht keinen europäischen Verein', () => {
  const fx = generateCupDraw(createRng('pokalprobe'), pokalfeld(state), 0, null, 2);
  const drin = fx.flatMap(f => [f.homeId, f.awayId])
    .filter(id => id && state.clubs[id] && state.clubs[id].istEuropaeisch);
  assert(drin.length === 0, `${drin.length} europäische Vereine gelost`);
});

/* ------------------------------------------------------------------ */

kopf(4, 'Lazy-Kader: vor dem ersten Spiel steht kein Spieler auf dem Platz');

const vorher = serialize(state).length;
const vorherOhneEuro = ohneEuroVereine(state);

/** Spielstandgröße, wenn man die europäischen Vereine wieder herausnimmt. */
function ohneEuroVereine(st) {
  const kopie = JSON.parse(serialize(st));
  for (const raw of EURO_CLUBS) delete kopie.clubs[raw.id];
  return JSON.stringify(kopie).length;
}

test('kein europäischer Verein hat einen Kader, einen Stab oder Nachwuchs', () => {
  for (const c of euro) {
    assert(c.playerIds.length === 0, `${c.id}: ${c.playerIds.length} Spieler`);
    assert(c.staffIds.length === 0, `${c.id}: ${c.staffIds.length} Betreuer`);
    assert(c.youth.talente.length === 0, `${c.id}: ${c.youth.talente.length} Talente`);
    assert(c.tactics === null, `${c.id}: hat schon eine Aufstellung`);
  }
});

test('kein einziger Spielerdatensatz zeigt auf einen europäischen Verein', () => {
  const ids = new Set(EURO_CLUBS.map(c => c.id));
  const treffer = Object.values(state.players).filter(p => ids.has(p.clubId)).length;
  assert(treffer === 0, `${treffer} Spieler mit europäischem clubId`);
});

/* ------------------------------------------------------------------ */

kopf(5, 'Kaderaufbau über ensureSquad()');

const PROBEN = ['eu_real', 'eu_city', 'eu_ajax', 'eu_salzburg', 'eu_bratislava', 'eu_maccabi'];
const staerke = {};

test('ensureSquad() baut Kader, Stab und Aufstellung', () => {
  for (const id of PROBEN) {
    const c = ensureSquad(state, id);
    assert(c.playerIds.length >= 18 && c.playerIds.length <= 24,
      `${id}: Kadergröße ${c.playerIds.length}`);
    assert(c.lazySquad === false, `${id}: lazySquad steht noch`);
    assert(c.staffIds.length === 3, `${id}: ${c.staffIds.length} Betreuer`);
    assert(c.tactics && c.tactics.formation, `${id}: keine Aufstellung`);
    const kader = c.playerIds.map(pid => state.players[pid]);
    assert(kader.every(Boolean), `${id}: Spieler fehlen in state.players`);
    assert(kader.filter(p => p.position === 'TW').length >= 2, `${id}: unter zwei Torhütern`);
    staerke[id] = kader.reduce((s, p) => s + playerOverall(p), 0) / kader.length;
  }
});

test('ein zweiter Aufruf ändert nichts', () => {
  const vor = state.clubs.eu_real.playerIds.slice();
  ensureSquad(state, 'eu_real');
  assert(state.clubs.eu_real.playerIds.join() === vor.join(), 'der Kader wurde neu gewürfelt');
});

test('Kadergröße und Stärke folgen der Reputation', () => {
  const real = state.clubs.eu_real, klein = state.clubs.eu_bratislava;
  assert(real.playerIds.length > klein.playerIds.length,
    `Real ${real.playerIds.length} Mann, ${klein.shortName} ${klein.playerIds.length}`);
  assert(staerke.eu_real - staerke.eu_bratislava >= 10,
    `Real ${staerke.eu_real.toFixed(1)} vs. ${klein.shortName} ${staerke.eu_bratislava.toFixed(1)} ` +
    '– das ist kein spürbarer Klassenunterschied');
  const nachRuf = PROBEN.slice().sort((a, b) => state.clubs[b].reputation - state.clubs[a].reputation);
  assert(nachRuf[0] === 'eu_real', 'Real Madrid ist nicht mehr der Verein mit dem größten Ruf');
  assert(staerke[nachRuf[0]] > staerke[nachRuf[nachRuf.length - 1]],
    'die Rangfolge der Kaderstärken widerspricht der Reputation');
});

test('ovrForClub() liefert für "europa" Weltklassewerte, nicht Amateurwerte', () => {
  const real = ovrForClub(state.clubs.eu_real);
  const klein = ovrForClub(state.clubs.eu_bratislava);
  const bayern = ovrForClub(state.clubs.bayern);
  assert(real > bayern, `Real ${real} liegt nicht über Bayern ${bayern}`);
  assert(real - klein >= 12, `Real ${real} vs. kleiner Meister ${klein}`);
});

test('der Kader klingt nach dem Land des Vereins', () => {
  const anteil = id => {
    const c = state.clubs[id];
    const soll = euroLand(c.country).nat;
    if (!soll) return 1;
    const kader = c.playerIds.map(pid => state.players[pid]);
    return kader.filter(p => p.nationality === soll).length / kader.length;
  };
  for (const id of ['eu_real', 'eu_city', 'eu_ajax']) {
    assert(anteil(id) >= 0.35,
      `${id}: nur ${(anteil(id) * 100).toFixed(0)} % aus dem eigenen Land`);
  }
  // Israel kennt data/names.js nicht – dann darf es kein deutscher Kader werden.
  const maccabi = state.clubs.eu_maccabi.playerIds.map(pid => state.players[pid]);
  const deutsche = maccabi.filter(p => p.nationality === 'DE').length / maccabi.length;
  assert(deutsche < 0.4, `Maccabi Tel Aviv mit ${(deutsche * 100).toFixed(0)} % Deutschen`);
});

/* ------------------------------------------------------------------ */

kopf(6, 'Spielstand');

const nachher = serialize(state).length;
const anteilAnpfiff = vorher - vorherOhneEuro;
const kaderReal = state.clubs.eu_real.playerIds
  .reduce((s, pid) => s + JSON.stringify(state.players[pid]).length, 0);

console.log(`  Spielstand am Anpfiff:                          ${mb(vorher)}`);
console.log(`  davon die ${EURO_CLUBS.length} europäischen Vereine:            ${kb(anteilAnpfiff)} ` +
  `(${(anteilAnpfiff / vorher * 100).toFixed(1).replace('.', ',')} %, ` +
  `${Math.round(anteilAnpfiff / EURO_CLUBS.length)} Byte je Verein)`);
console.log(`  nach ${PROBEN.length} × ensureSquad():                       ${mb(nachher)} ` +
  `(+${kb(nachher - vorher)})`);
console.log(`  Ein Kader (Real Madrid, ${state.clubs.eu_real.playerIds.length} Mann):              ${kb(kaderReal)}`);
console.log(`  Alle ${EURO_CLUBS.length} Kader wären rund:                  ${mb(kaderReal * EURO_CLUBS.length)} ` +
  '– so viel spart lazySquad.');

test('die Vereine kosten am Anpfiff weniger als 400 kB Spielstand', () => {
  assert(anteilAnpfiff > 0, 'die Messung liefert keinen Zuwachs – stehen sie überhaupt im Spielstand?');
  assert(anteilAnpfiff < 400 * 1024,
    `${kb(anteilAnpfiff)} Zuwachs – das sind keine Stammdaten mehr`);
});

test('ein Verein ohne Kader bleibt unter 4 kB', () => {
  const je = Math.round(anteilAnpfiff / EURO_CLUBS.length);
  assert(je < 4096, `im Schnitt ${kb(je)} je Verein`);
});

test('ein aufgebauter Kader kostet ein Vielfaches – deshalb lazySquad', () => {
  assert(kaderReal > 20000,
    `ein Kader wiegt nur ${kb(kaderReal)} – die Lazy-Regel wäre überflüssig`);
  assert(kaderReal > anteilAnpfiff / EURO_CLUBS.length * 8,
    'ein Kader kostet kaum mehr als die Stammdaten – die Messung stimmt nicht');
});

/* ------------------------------------------------------------------ */

console.log('');
if (fehler.length) {
  console.log(`FEHLGESCHLAGEN: ${fehler.length} von ${bestanden + fehler.length} Prüfungen`);
  for (const f of fehler) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log(`Alle ${bestanden} Prüfungen bestanden.`);
  console.log(`${EURO_CLUBS.length} europäische Vereine aus ${new Set(EURO_CLUBS.map(c => c.country)).size} Ländern ` +
    `stehen bereit – und schlafen, bis jemand gegen sie ausgelost wird.`);
}
