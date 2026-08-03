/**
 * tools/test-shootout.js — Prüfstand für src/engine/shootout.js
 *
 * Aufruf:  node tools/test-shootout.js
 *
 * 5000 Elfmeterschießen zwischen echten Vereinskadern (createNewGame +
 * loop.buildMatchTeam), dazu ein paar konstruierte Sonderfälle.
 *
 * Geprüft wird:
 *  1. Trefferquote im Zielkorridor 72–78 % (Realität: rund 73 %).
 *  2. Durchschnittliche Rundenzahl und Anteil der Entscheidungen nach genau
 *     fünf Schützen – beides in plausiblen Korridoren.
 *  3. NIE ein Unentschieden: sieger ist immer gesetzt und passt zu tore[].
 *  4. Kein Spieler schießt zweimal, bevor alle seiner Mannschaft dran waren.
 *  5. Vorzeitiges Ende: kein Schuss mehr, wenn der Ausgang feststeht.
 *  6. Der Ablauf ist deterministisch (gleiche rng, gleiches Ergebnis).
 *  7. Reihenfolge: der Torwart schießt zuletzt, Verletzte gar nicht.
 *  8. Interaktiv: KeyMoment nach CONTRACTS 6.1, nur für interactiveSide.
 *  9. Texte: deutsch, gefüllt, ohne Platzhalterreste.
 * 10. Mensch gegen KI: Der Mensch schießt über interactive/penalty.js, die KI
 *     über trefferChance(). Beide müssen im selben Korridor liegen und dürfen
 *     höchstens 4 Prozentpunkte auseinanderliegen (Umbauplan Paket 4, Punkt 10).
 */

import { elfmeterschiessen, schuetzenreihenfolge, SHOOTOUT_CONSTANTS } from '../src/engine/shootout.js';
import { modell as penaltyModell } from '../src/interactive/penalty.js';
import { createNewGame } from '../src/core/state.js';
import { buildMatchTeam } from '../src/core/loop.js';
import { createRng } from '../src/core/rng.js';
import { DIFFICULTIES } from '../src/core/constants.js';
import { LEAGUES } from '../src/data/leagues.js';
import { round } from '../src/core/util.js';

/* ---------------------------------------------------------------- Harness */

let passed = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) { passed++; return true; }
  failures.push(detail ? `${label} — ${detail}` : label);
  return false;
}

function korridor(wert, min, max, label) {
  return ok(wert >= min && wert <= max, label, `${nz(wert)} liegt außerhalb von ${nz(min)}…${nz(max)}`);
}

function section(title) { console.log(`\n=== ${title} ===`); }
function nz(v) { return String(round(v, 2)).replace('.', ','); }
function pz(v) { return nz(v * 100) + ' %'; }

const DURCHLAEUFE = 5000;

/* ------------------------------------------------------- Testwelt aufbauen */

section('Testwelt');

const state = createNewGame({
  clubId: LEAGUES.bl1.clubIds[0], managerName: 'Elfmetertrainer', difficulty: 'profi', seed: 20250727
});
const vereine = [].concat(LEAGUES.bl1.clubIds, LEAGUES.bl2.clubIds);
ok(vereine.length >= 30, 'Genug Vereine für die Stichprobe', `${vereine.length}`);

const teams = new Map();
function teamVon(clubId, heim) {
  const key = clubId + (heim ? ':h' : ':a');
  if (!teams.has(key)) teams.set(key, buildMatchTeam(state, clubId, heim));
  return teams.get(key);
}
for (const id of vereine) { teamVon(id, true); teamVon(id, false); }
console.log(`  ${vereine.length} Vereine, ${teams.size} Mannschaften vorbereitet.`);

const DIFF = DIFFICULTIES.profi;

/* --------------------------------------------------------- 1..6 Massenlauf */

section(`Massenlauf: ${DURCHLAEUFE} Elfmeterschießen`);

let schuesseGesamt = 0, treffer = 0;
let rundenSumme = 0, versucheSumme = 0;
let entschiedenNachFuenf = 0, suddenDeath = 0, vorzeitig = 0, alleZehn = 0;
let heimSiege = 0, beginnerSiege = 0;
let maxRunden = 0;
let unentschieden = 0, siegerFalsch = 0, doppeltZuFrueh = 0, zuVieleSchuesse = 0;
let textLeer = 0, platzhalter = 0, feldFehler = 0, standFehler = 0, torFehler = 0;
const rundenVerteilung = new Map();
const schuetzenNachRunde = new Map();

const laufRng = createRng(4242);

for (let i = 0; i < DURCHLAEUFE; i++) {
  const a = laufRng.pick(vereine);
  let b = laufRng.pick(vereine);
  while (b === a) b = laufRng.pick(vereine);

  const erg = elfmeterschiessen({
    heim: teamVon(a, true),
    gast: teamVon(b, false),
    rng: createRng('shootout:' + i),
    difficulty: DIFF,
    interactive: false,
    interactiveSide: null,
    competition: { id: 'pokal', name: 'DFB-Pokal, Achtelfinale' }
  });

  /* --- Grundstruktur --- */
  if (erg.sieger !== 'home' && erg.sieger !== 'away') { unentschieden++; continue; }
  if (erg.tore[0] === erg.tore[1]) unentschieden++;
  const erwartet = erg.tore[0] > erg.tore[1] ? 'home' : 'away';
  if (erwartet !== erg.sieger) siegerFalsch++;
  if (!Array.isArray(erg.text) || erg.text.length < 3) textLeer++;

  /* --- Schüsse zählen und prüfen --- */
  const proTeam = { home: [], away: [] };
  const toreZaehler = { home: 0, away: 0 };
  for (const s of erg.schuesse) {
    schuesseGesamt++;
    if (s.getroffen) { treffer++; toreZaehler[s.team]++; }
    proTeam[s.team].push(s.playerId);
    if (!s.playerId || !s.ecke || !s.torwartEcke || typeof s.getroffen !== 'boolean' ||
        (s.team !== 'home' && s.team !== 'away')) feldFehler++;
    if (!s.text || s.text.length < 12) textLeer++;
    if (/[{}]/.test(s.text)) platzhalter++;
  }
  if (toreZaehler.home !== erg.tore[0] || toreZaehler.away !== erg.tore[1]) torFehler++;

  /* --- 4. Kein Spieler zweimal, bevor alle dran waren --- */
  for (const key of ['home', 'away']) {
    const folge = proTeam[key];
    const erstesDoppel = folge.findIndex((id, idx) => folge.indexOf(id) !== idx);
    if (erstesDoppel >= 0) {
      const runde1 = folge.slice(0, erstesDoppel);
      // Die Wiederholung darf erst nach einer kompletten Runde beginnen und
      // muss dann exakt dieselbe Reihenfolge haben.
      if (new Set(runde1).size !== runde1.length) doppeltZuFrueh++;
      else for (let k = erstesDoppel; k < folge.length; k++) {
        if (folge[k] !== runde1[k % runde1.length]) { doppeltZuFrueh++; break; }
      }
      if (runde1.length < 5) doppeltZuFrueh++;
    }
  }

  /* --- 5. Vorzeitiges Ende --- */
  const versuche = { home: proTeam.home.length, away: proTeam.away.length };
  if (Math.abs(versuche.home - versuche.away) > 1) zuVieleSchuesse++;
  const maxVersuche = Math.max(versuche.home, versuche.away);
  if (maxVersuche !== erg.runden) standFehler++;
  if (maxVersuche <= 5) {
    // In der regulären Serie darf nach der Entscheidung kein Schuss mehr fallen.
    const rest = { home: 5 - versuche.home, away: 5 - versuche.away };
    const vorsprung = Math.abs(erg.tore[0] - erg.tore[1]);
    const restGegner = erg.tore[0] > erg.tore[1] ? rest.away : rest.home;
    if (vorsprung <= restGegner) standFehler++;   // hätte weiterlaufen müssen
  }

  if (versuche.home >= 5 && versuche.away >= 5) alleZehn++;
  if (maxVersuche < 5) vorzeitig++;
  if (maxVersuche === 5) entschiedenNachFuenf++;
  if (maxVersuche > 5) suddenDeath++;
  rundenSumme += erg.runden;
  versucheSumme += versuche.home + versuche.away;
  maxRunden = Math.max(maxRunden, erg.runden);
  rundenVerteilung.set(erg.runden, (rundenVerteilung.get(erg.runden) || 0) + 1);
  if (erg.sieger === 'home') heimSiege++;
  if (erg.sieger === erg.beginner) beginnerSiege++;

  /* --- Trefferquote je Runde (Druckkurve sichtbar machen) --- */
  for (const s of erg.schuesse) {
    const e = schuetzenNachRunde.get(s.runde) || { n: 0, t: 0 };
    e.n++; if (s.getroffen) e.t++;
    schuetzenNachRunde.set(s.runde, e);
  }
}

const quote = treffer / schuesseGesamt;

console.log(`  Schüsse gesamt ......... ${schuesseGesamt} (${nz(schuesseGesamt / DURCHLAEUFE)} je Schießen)`);
console.log(`  Trefferquote ........... ${pz(quote)}`);
console.log(`  Runden im Schnitt ...... ${nz(rundenSumme / DURCHLAEUFE)}  (längstes: ${maxRunden})`);
console.log(`  Vor dem 5. Schützen .... ${pz(vorzeitig / DURCHLAEUFE)}`);
console.log(`  Nach genau 5 Schützen .. ${pz(entschiedenNachFuenf / DURCHLAEUFE)}`);
console.log(`  K.o.-Schießen nötig .... ${pz(suddenDeath / DURCHLAEUFE)}`);
console.log(`  Alle zehn Schüsse nötig  ${pz(alleZehn / DURCHLAEUFE)}`);
console.log(`  Heimsiege .............. ${pz(heimSiege / DURCHLAEUFE)}`);
console.log(`  Sieg des Beginners ..... ${pz(beginnerSiege / DURCHLAEUFE)}`);
const rr = [...schuetzenNachRunde.entries()].sort((x, y) => x[0] - y[0]).slice(0, 7);
console.log('  Trefferquote je Runde ..  ' + rr.map(([r, e]) => `${r}. ${pz(e.t / e.n)}`).join(' · '));

/* Zielkorridor 72–78 %, nicht mehr 74–78 %.
 *
 * Bis Roadmap-Stufe 5 stellte die halbe Stichprobe (die 2. Liga) prozedurale
 * Torhüter — Durchschnitt deutlich unter dem der handgepflegten Kader. Seit
 * Stufe 5 steht in jedem der 36 Vereine der beste Torwart seiner Geschichte:
 * Turek in Düsseldorf, Enke in Hannover, Franke in Braunschweig, Köpke in
 * Nürnberg, Kahn im KSC, Lehmann auf Schalke. Der Stammtorwart der 2. Liga
 * kommt damit auf ⌀ 82,3 Elfmeterwert gegen ⌀ 84,4 in der ersten — die Kader
 * dahinter trennen dagegen fast acht Punkte.
 *
 * Gemessen: 75,15 % vor Stufe 5, 73,37 % danach. Der Rückgang ist keine
 * Änderung an engine/shootout.js (die Datei ist unverändert), sondern die
 * Folge besserer Torhüter. Getrennt gemessen liegen beide Ligen praktisch
 * gleich (1. Liga 73,60 %, 2. Liga 72,87 % über je 21.000 Schüsse) — es ist
 * also kein Ligatyp-Effekt, sondern das neue Niveau der Spielwelt.
 *
 * 73 % ist auch die realistischere Zahl: Elfmeterschießen in großen Turnieren
 * liegen bei 70–75 %. Die Untergrenze wandert deshalb auf 72 %, die Obergrenze
 * bleibt, wo sie war. */
korridor(quote, 0.72, 0.78, '1. Trefferquote im Zielkorridor 72–78 %');
korridor(rundenSumme / DURCHLAEUFE, 4.2, 6.0, '2a. Durchschnittliche Rundenzahl plausibel');
korridor(entschiedenNachFuenf / DURCHLAEUFE, 0.20, 0.55, '2b. Anteil Entscheidungen nach genau 5 Schützen');
korridor(vorzeitig / DURCHLAEUFE, 0.20, 0.60, '2c. Anteil vorzeitiger Entscheidungen');
korridor(suddenDeath / DURCHLAEUFE, 0.10, 0.40, '2d. Anteil K.-o.-Schießen');
ok(unentschieden === 0, '3a. Kein einziges Unentschieden', `${unentschieden} Fälle`);
ok(siegerFalsch === 0, '3b. sieger passt immer zum Torstand', `${siegerFalsch} Fälle`);
ok(torFehler === 0, '3c. tore[] passt zur Summe der Treffer', `${torFehler} Fälle`);
ok(doppeltZuFrueh === 0, '4. Niemand schießt zweimal, bevor alle dran waren', `${doppeltZuFrueh} Fälle`);
ok(zuVieleSchuesse === 0, '5a. Immer im Wechsel geschossen', `${zuVieleSchuesse} Fälle`);
ok(standFehler === 0, '5b. Vorzeitiges Ende exakt am Rechenpunkt', `${standFehler} Fälle`);
ok(feldFehler === 0, 'Schussfelder vollständig (team/playerId/ecke/torwartEcke)', `${feldFehler} Fälle`);
ok(textLeer === 0, '9a. Jeder Schuss hat einen Reportertext', `${textLeer} Fälle`);
ok(platzhalter === 0, '9b. Keine ungefüllten Platzhalter im Text', `${platzhalter} Fälle`);
korridor(heimSiege / DURCHLAEUFE, 0.42, 0.58, 'Keine Schlagseite zugunsten der Heimmannschaft');
korridor(beginnerSiege / DURCHLAEUFE, 0.49, 0.58, 'Wer zuerst schießt, hat einen kleinen Vorteil – aber keinen Freifahrtschein');

/* --------------------------------------------------------- 6. Determinismus */

section('Determinismus');

{
  const bau = () => elfmeterschiessen({
    heim: teamVon(vereine[0], true), gast: teamVon(vereine[1], false),
    rng: createRng('determinismus'), difficulty: DIFF, interactive: false
  });
  const a = bau(), b = bau();
  ok(JSON.stringify(a) === JSON.stringify(b), '6a. Zweimal derselbe Seed ergibt exakt dasselbe Ergebnis');

  const c = elfmeterschiessen({
    heim: teamVon(vereine[0], true), gast: teamVon(vereine[1], false),
    rng: createRng('determinismus-anders'), difficulty: DIFF, interactive: false
  });
  ok(JSON.stringify(a) !== JSON.stringify(c), '6b. Anderer Seed ergibt ein anderes Ergebnis');

  // Kein Math.random / Date.now im Modul (Kommentare zählen nicht)
  const roh = await import('node:fs').then(fs =>
    fs.readFileSync(new URL('../src/engine/shootout.js', import.meta.url), 'utf8'));
  const quelle = roh.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/Math\.random/.test(quelle), '6c. Kein Math.random() im Modul');
  ok(!/Date\.now/.test(quelle), '6d. Kein Date.now() im Modul');
}

/* ------------------------------------------------ 7. Reihenfolge und Ausfälle */

section('Schützenreihenfolge');

{
  const mt = teamVon(vereine[2], true);
  const folge = schuetzenreihenfolge(mt, { rng: createRng('reihenfolge') });
  ok(folge.length === 11, '7a. Elf Schützen aus der Startelf', `${folge.length}`);
  ok(new Set(folge.map(p => p.id)).size === folge.length, '7b. Keine Doppelungen in der Reihenfolge');
  const tw = folge.findIndex(p => p.position === 'TW');
  ok(tw === folge.length - 1, '7c. Der Torwart schießt zuletzt', `Position ${tw + 1} von ${folge.length}`);

  // Verletzte fallen aus
  const kaputt = {
    club: mt.club, tactics: mt.tactics, morale: mt.morale, tiredness: mt.tiredness,
    coachBonus: mt.coachBonus,
    players: mt.players.map(p => (p.id === folge[0].id ? Object.assign({}, p, { injury: { tage: 12 } }) : p))
  };
  const folge2 = schuetzenreihenfolge(kaputt, { rng: createRng('reihenfolge') });
  ok(!folge2.some(p => p.id === folge[0].id), '7d. Ein Verletzter tritt nicht an');

  // Nur die Schlusself darf ran (aufDemPlatz gewinnt gegen die Aufstellung)
  const neun = folge.slice(0, 9).map(p => p.id);
  const mtNeun = Object.assign({}, mt, { aufDemPlatz: neun });
  const folge3 = schuetzenreihenfolge(mtNeun, { rng: createRng('reihenfolge') });
  ok(folge3.length === 9 && folge3.every(p => neun.includes(p.id)),
    '7e. aufDemPlatz begrenzt das Feld der Schützen', `${folge3.length} Schützen`);

  // Unterzahl: die andere Mannschaft gleicht sich an ("reduce to equalize")
  const erg = elfmeterschiessen({
    heim: Object.assign({}, teamVon(vereine[3], true), { aufDemPlatz: schuetzenreihenfolge(teamVon(vereine[3], true), {}).slice(0, 9).map(p => p.id) }),
    gast: teamVon(vereine[4], false),
    rng: createRng('unterzahl'), difficulty: DIFF, interactive: false
  });
  const gastSpieler = new Set(erg.schuesse.filter(s => s.team === 'away').map(s => s.playerId));
  ok(gastSpieler.size <= 9, '7f. Unterzahl gleicht auch die andere Mannschaft an', `${gastSpieler.size} Gastschützen`);
}

/* --------------------------------------------------------- 8. Interaktiv */

section('Interaktives Elfmeterschießen');

{
  const momente = [];
  const p = elfmeterschiessen({
    heim: teamVon(vereine[5], true), gast: teamVon(vereine[6], false),
    rng: createRng('interaktiv'), difficulty: DIFF,
    interactive: false, interactiveSide: 'home',
    competition: { id: 'euro_cl', name: 'Landesmeisterpokal, Viertelfinale' },
    onKeyMoment: async (m) => { momente.push(m); return { outcome: 'tor', quality: 1, xgDelta: 0.1 }; }
  });
  ok(p && typeof p.then === 'function', '8a. Mit onKeyMoment kommt ein Promise zurück');
  const erg = await p;

  ok(momente.length > 0, '8b. KeyMoments wurden erzeugt', `${momente.length}`);
  ok(momente.every(m => m.kind === 'elfmeter'), '8c. kind ist immer "elfmeter"');
  ok(momente.every(m => m.team === 'home'), '8d. Nur die interaktive Seite bekommt KeyMoments');
  ok(momente.every(m => m.actor && m.actor.id && Array.isArray(m.defenders) && Array.isArray(m.targets)),
    '8e. KeyMoment-Struktur nach CONTRACTS 6.1');
  ok(momente.every(m => typeof m.baseChance === 'number' && m.baseChance > 0 && m.baseChance < 1),
    '8f. baseChance ist eine echte Wahrscheinlichkeit');
  ok(momente.every(m => m.pressure >= 0 && m.pressure <= 100), '8g. pressure liegt in 0..100');
  ok(momente.every(m => m.context && Array.isArray(m.context.score) &&
    m.context.competition === 'Landesmeisterpokal, Viertelfinale'), '8h. context ist vollständig');
  ok(momente.every(m => m.keeper && m.keeper.id !== m.actor.id), '8i. Der Torwart ist der des Gegners');

  const heimSchuesse = erg.schuesse.filter(s => s.team === 'home');
  ok(heimSchuesse.length === momente.length, '8j. Je KeyMoment genau ein Schuss',
    `${momente.length} Momente, ${heimSchuesse.length} Schüsse`);
  ok(heimSchuesse.filter(s => s.getroffen).length >= heimSchuesse.length - 1,
    '8k. Perfekte Ausführung trifft fast immer', `${heimSchuesse.filter(s => s.getroffen).length}/${heimSchuesse.length}`);

  // Abbruch (null) => normale Simulation, kein Absturz
  const erg2 = await elfmeterschiessen({
    heim: teamVon(vereine[5], true), gast: teamVon(vereine[6], false),
    rng: createRng('interaktiv-abbruch'), difficulty: DIFF,
    interactive: false, interactiveSide: 'away',
    onKeyMoment: async () => null
  });
  ok(erg2.sieger === 'home' || erg2.sieger === 'away', '8l. onKeyMoment => null simuliert normal weiter');

  // Ein werfender Aufrufer darf das Schießen nicht kippen
  const erg3 = await elfmeterschiessen({
    heim: teamVon(vereine[5], true), gast: teamVon(vereine[6], false),
    rng: createRng('interaktiv-fehler'), difficulty: DIFF,
    interactive: false, interactiveSide: 'home',
    onKeyMoment: async () => { throw new Error('Nutzer hat den Stecker gezogen'); }
  });
  ok(erg3.sieger === 'home' || erg3.sieger === 'away', '8m. Ein Fehler im Minispiel bricht nichts ab');
}

/* ------------------------------------------------------------ Live-Anzeige */

section('Live-Anzeige und Texte');

{
  const gesehen = [];
  const erg = elfmeterschiessen({
    heim: teamVon(vereine[7], true), gast: teamVon(vereine[8], false),
    rng: createRng('anzeige'), difficulty: DIFF, interactive: false,
    onSchuss: s => gesehen.push(s)
  });
  ok(gesehen.length === erg.schuesse.length, 'onSchuss meldet jeden Schuss', `${gesehen.length}/${erg.schuesse.length}`);
  ok(erg.text.length === erg.schuesse.length + 3 || erg.text.length === erg.schuesse.length + 4,
    'Textblock: Einleitung, Münzwurf, jeder Schuss, Schlusssatz', `${erg.text.length} Zeilen bei ${erg.schuesse.length} Schüssen`);
  ok(erg.text.every(z => typeof z === 'string' && z.length > 5), 'Alle Textzeilen gefüllt');
  ok(/Elfmeterschießen/.test(erg.text[0]), 'Die erste Zeile kündigt das Schießen an');
  ok(/Endstand vom Punkt/.test(erg.text[erg.text.length - 1]), 'Die letzte Zeile nennt den Endstand');

  // Ein Fehler in der Anzeige darf das Schießen nicht kippen
  const erg2 = elfmeterschiessen({
    heim: teamVon(vereine[7], true), gast: teamVon(vereine[8], false),
    rng: createRng('anzeige'), difficulty: DIFF, interactive: false,
    onSchuss: () => { throw new Error('Anzeige kaputt'); }
  });
  ok(JSON.stringify(erg2.schuesse) === JSON.stringify(erg.schuesse), 'Kaputte Anzeige ändert nichts am Ablauf');
}

/* ------------------------------------------------------------- Randfälle */

section('Randfälle');

{
  // Leere Mannschaft: darf nicht hängen bleiben
  const erg = elfmeterschiessen({
    heim: { club: { shortName: 'Geisterelf' }, players: [], tactics: null },
    gast: teamVon(vereine[9], false),
    rng: createRng('leer'), difficulty: DIFF, interactive: false
  });
  ok(erg.sieger === 'away', 'Ohne Schützen verliert man kampflos', erg.sieger);

  // Ohne rng: Modul muss trotzdem laufen (und darf kein Math.random benutzen)
  const erg2 = elfmeterschiessen({
    heim: teamVon(vereine[10], true), gast: teamVon(vereine[11], false), difficulty: DIFF
  });
  const erg3 = elfmeterschiessen({
    heim: teamVon(vereine[10], true), gast: teamVon(vereine[11], false), difficulty: DIFF
  });
  ok(JSON.stringify(erg2) === JSON.stringify(erg3), 'Ohne rng bleibt der Ablauf trotzdem reproduzierbar');

  ok(SHOOTOUT_CONSTANTS.regulaer === 5, 'Fünf reguläre Schützen je Mannschaft');
  ok(SHOOTOUT_CONSTANTS.basis > 0.5 && SHOOTOUT_CONSTANTS.basis < 1, 'Basiswahrscheinlichkeit plausibel');
}

/* ------------------------------------------------ Mensch gegen KI (Paket 4) */

section('Mensch gegen KI');

/*
 * Das Elfmeterschießen fährt zwei Modelle nebeneinander: die KI würfelt über
 * trefferChance(), der Mensch schießt über interactive/penalty.js. Kippt eines
 * gegen das andere, ist das Schießen als Duell kaputt — deshalb wird hier die
 * ganze Kette gemessen: KeyMoment → modell.aufloesen() → ausMinispiel().
 *
 * Der Mensch ist derselbe Referenzspieler wie in tools/test-elfmeter.js: er
 * zielt in die Ecke, hält den Kraftbalken nahe POWER_IDEAL an und klickt den
 * Präzisionsläufer mit ~55 ms Zeitfehler.
 */
{
  const KE = penaltyModell.KONSTANTEN;
  const DIFF_MG = DIFF.minigame;

  const koennen = (p) => {
    const a = (p && p.attributes) || {};
    const v = (k, f) => (typeof a[k] === 'number' ? a[k] : f);
    return Math.min(1, Math.max(0,
      (v('schuss', 50) * 0.32 + v('technik', 50) * 0.22 +
       v('nervenstaerke', 50) * 0.30 + v('standards', 50) * 0.16) / 100));
  };

  /** Die drei Eingaben des Referenzspielers. */
  function menschEingabe(rng, actor) {
    const skill = koennen(actor);
    const r = rng.next();
    let u;
    if (r < 0.46) u = rng.float(2.45, 3.20);
    else if (r < 0.68) u = rng.float(1.30, 2.45);
    else if (r < 0.84) u = rng.float(0.00, 1.30);
    else u = rng.float(3.15, 3.95);
    if (rng.chance(0.5)) u = -u;
    const rh = rng.next();
    const h = rh < 0.58 ? rng.float(0.15, 0.75) : rh < 0.88 ? rng.float(0.75, 1.60) : rng.float(1.60, 2.25);

    const nerven = (actor && actor.attributes && actor.attributes.nervenstaerke) || 50;
    const wobble = Math.max(0.06, 0.62 * (1 - nerven / 100) * DIFF_MG);
    const precWin = Math.min(0.30, Math.max(0.035,
      (KE.PREC_WIN_MIN + (KE.PREC_WIN_MAX - KE.PREC_WIN_MIN) * skill) / Math.min(1.8, Math.max(0.5, DIFF_MG))));
    const precPeriod = KE.PREC_PERIOD_MS * (0.72 + 0.63 * skill) / Math.min(1.7, Math.max(0.6, DIFF_MG));
    const fehlerMs = rng.gauss(0, 55);
    const off = Math.min(1, Math.abs(4 * fehlerMs / precPeriod));
    const precMiss = Math.min(1, Math.max(0, (off - precWin * 2) / Math.max(0.08, 1 - precWin * 2)));

    return {
      aimU: Math.min(4.6, Math.max(-4.6, u + rng.float(-1, 1) * wobble)),
      aimH: Math.min(3.05, Math.max(-0.1, h + rng.float(-1, 1) * wobble * 0.55)),
      power: Math.min(1, Math.max(0.30, KE.POWER_IDEAL + rng.gauss(0, 0.09))),
      precMiss,
      precDir: fehlerMs >= 0 ? 1 : -1
    };
  }

  let menschSchuss = 0, menschTor = 0, kiSchuss = 0, kiTor = 0;
  const RUNDEN = 500;
  for (let i = 0; i < RUNDEN; i++) {
    const a = vereine[i % vereine.length];
    const b = vereine[(i * 7 + 3) % vereine.length];
    if (a === b) continue;
    // Wie matchday.js: das Minispiel bekommt eine eigene, geforkte rng.
    const mgRng = createRng('mensch:' + i);
    const erg = await elfmeterschiessen({
      heim: teamVon(a, true), gast: teamVon(b, false),
      rng: createRng('mvk:' + i), difficulty: DIFF,
      interactive: false, interactiveSide: 'home',
      onKeyMoment: async (m) => {
        const res = penaltyModell.aufloesen(mgRng,
          { actor: m.actor, keeper: m.keeper, diff: DIFF_MG },
          menschEingabe(mgRng, m.actor));
        if (res.flug) res.flug.freigeben();
        return { outcome: res.outcome, quality: res.quality, targetPlayerId: null, xgDelta: res.xgDelta };
      }
    });
    for (const s of erg.schuesse) {
      if (s.team === 'home') { menschSchuss++; if (s.getroffen) menschTor++; }
      else { kiSchuss++; if (s.getroffen) kiTor++; }
    }
  }
  const qMensch = menschTor / menschSchuss;
  const qKi = kiTor / kiSchuss;
  console.log(`  Mensch über penalty.js .. ${pz(qMensch)} (${menschTor}/${menschSchuss})`);
  console.log(`  KI über trefferChance ... ${pz(qKi)} (${kiTor}/${kiSchuss})`);
  console.log(`  Abstand ................. ${nz(Math.abs(qMensch - qKi) * 100)} Prozentpunkte`);
  korridor(qMensch, 0.72, 0.80, 'M1. Menschquote im Elfmeterkorridor 72–80 %');
  korridor(qKi, 0.70, 0.80, 'M2. KI-Quote im selben Bereich');
  ok(Math.abs(qMensch - qKi) <= 0.04, 'M3. Mensch und KI liegen höchstens 4 Punkte auseinander',
    `${pz(qMensch)} gegen ${pz(qKi)}`);
}

/* --------------------------------------------- Elfmeterkiller wirkt spürbar */

section('Fähigkeiten wirken');

{
  const mt = teamVon(vereine[12], true);
  const stark = mt.players.map(p => Object.assign({}, p, {
    attributes: Object.assign({}, p.attributes, { nervenstaerke: 95, schuss: 92, standards: 90, technik: 90 })
  }));
  const schwach = mt.players.map(p => Object.assign({}, p, {
    attributes: Object.assign({}, p.attributes, { nervenstaerke: 25, schuss: 28, standards: 25, technik: 30 })
  }));
  const gegner = teamVon(vereine[13], false);

  let siegeStark = 0;
  for (let i = 0; i < 400; i++) {
    const erg = elfmeterschiessen({
      heim: Object.assign({}, mt, { players: stark }), gast: gegner,
      rng: createRng('stark:' + i), difficulty: DIFF, interactive: false
    });
    if (erg.sieger === 'home') siegeStark++;
  }
  let siegeSchwach = 0;
  for (let i = 0; i < 400; i++) {
    const erg = elfmeterschiessen({
      heim: Object.assign({}, mt, { players: schwach }), gast: gegner,
      rng: createRng('schwach:' + i), difficulty: DIFF, interactive: false
    });
    if (erg.sieger === 'home') siegeSchwach++;
  }
  console.log(`  Nervenstarke Elf gewinnt ${pz(siegeStark / 400)}, zittrige Elf ${pz(siegeSchwach / 400)}.`);
  ok(siegeStark > siegeSchwach + 60, 'Sichere Schützen gewinnen deutlich häufiger',
    `${siegeStark} gegen ${siegeSchwach} von je 400`);
}

/* -------------------------------------------------------------- Ergebnis */

console.log('');
if (failures.length === 0) {
  console.log(`✅ ALLE TESTS BESTANDEN — ${passed} Prüfungen, ${DURCHLAEUFE} Elfmeterschießen, ${schuesseGesamt} Schüsse.`);
  process.exit(0);
} else {
  console.log(`❌ ${failures.length} FEHLER (${passed} Prüfungen bestanden):\n`);
  for (const f of failures.slice(0, 60)) console.log('  • ' + f);
  if (failures.length > 60) console.log(`  … und ${failures.length - 60} weitere.`);
  process.exit(1);
}
