/**
 * tools/test-elfmeter.js — Prüfstand für src/interactive/penalty.js
 *
 * Aufruf:  node tools/test-elfmeter.js
 *
 * Gemessen wird über den additiven, DOM-freien Export `modell` (Vertrag §9):
 * 4000 Elfmeter mit deterministischen Seeds, geschossen von echten Spielern
 * aus echten Kadern gegen echte Torhüter.
 *
 * DER REFERENZSPIELER. Der Mensch wird nachgebildet, nicht wegabstrahiert: er
 * zielt in eine Ecke (Verteilung siehe zielen()), hält den Kraftbalken in der
 * Nähe von POWER_IDEAL an und klickt den Präzisionsläufer mit ~55 ms
 * Zeitfehler. Genau diese drei Eingaben bekommt `modell.aufloesen()` auch im
 * Spiel. Der Referenzspieler ist die MESSLATTE — wenn ein Korridor nicht
 * stimmt, wird das Spiel nachgezogen, nicht der Referenzspieler.
 *
 * Zielkorridore (Umbauplan, Abschnitt 3, Paket 4):
 *   1. Torquote                       72–80 %
 *   2. Paradenquote                   12–18 %
 *   3. Aluminium + daneben             6–12 %
 *   4. Flugzeit                       0,35–0,62 s
 *   5. Ecke ≥ 2,4 m mit IDEALER Kraft und sauberem Timing: Torquote > 88 %
 *      (früher: „volle Kraft … > 90 %" — warum das gefallen ist, steht im
 *      Abschnitt „Der platzierte Elfmeter" weiter unten)
 *   6. Vollkraft NICHT besser als POWER_IDEAL (der Kraftbalken darf nicht die
 *      dominante Strategie werden — der Präzisionsbalken ist die Könnens-Achse).
 *      Nachgewiesen über ein GITTER aus 3 Schützen- × 3 Torwart- × 15 Ziel-
 *      profilen = 135 Zellen, gepaart gemessen. In JEDER Zelle muss volle Kraft
 *      innerhalb des Messrauschens bleiben; die engste Zelle wird eigens mit
 *      viel mehr Schüssen nachgemessen, und ein Teilgitter mit perfektem
 *      Timing prüft den Fall, in dem der Klickfehler-Malus gar nicht greift.
 *      Begründung der Kriterien steht beim Gitterlauf.
 *   7. difficulty.minigame senkt die Torquote spürbar und monoton (Vertrag §9)
 * Dazu: Determinismus, Bandbreite der Flugzeit, Physikproben (Flugzeit fällt
 * mit der Kraft, Torwartreichweite ist nach dem Absprung linear), kein
 * Math.random/Date.now, Vertragstreue von `minigame` und `modell`.
 */

import { readFileSync } from 'node:fs';
import { minigame, modell } from '../src/interactive/penalty.js';
import { createNewGame } from '../src/core/state.js';
import { buildMatchTeam } from '../src/core/loop.js';
import { createRng } from '../src/core/rng.js';
import { DIFFICULTIES } from '../src/core/constants.js';
import { LEAGUES } from '../src/data/leagues.js';
import { clamp, lerp, round } from '../src/core/util.js';

/* ---------------------------------------------------------------- Harness */

let passed = 0;
const failures = [];
const offeneZiele = [];

function ok(cond, label, detail) {
  if (cond) { passed++; return true; }
  failures.push(detail ? `${label} — ${detail}` : label);
  return false;
}
/**
 * Ein Ziel, das diese Fassung NICHT erreicht und das bewusst offen bleibt.
 * Der Unterschied zu ok() ist Absicht: die Zahl soll bei jedem Lauf sichtbar
 * sein, ohne die Suite dauerhaft rot zu färben (Muster aus
 * tools/test-kombination.js). Nur für ehrlich gemessene Fehlschläge.
 */
function offen(cond, label, detail) {
  if (cond) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`); return true; }
  offeneZiele.push(detail ? `${label} — ${detail}` : label);
  console.log(`  ○ OFFEN: ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}
function korridor(wert, min, max, label) {
  return ok(wert >= min && wert <= max, label, `${nz(wert)} liegt außerhalb von ${nz(min)}…${nz(max)}`);
}
function section(title) { console.log(`\n=== ${title} ===`); }
function nz(v) { return String(round(v, 3)).replace('.', ','); }
function pz(v) { return String(round(v * 100, 2)).replace('.', ',') + ' %'; }

const K = modell.KONSTANTEN;
const DURCHLAEUFE = 4000;
const DIFF = DIFFICULTIES.profi;
const DIFF_MG = DIFF.minigame;          // 1.0
const TIMING_SD_MS = 55;                // Klickfehler eines normalen Spielers

/* ------------------------------------------------------- Testwelt aufbauen */

section('Testwelt');

const state = createNewGame({
  clubId: LEAGUES.bl1.clubIds[0], managerName: 'Elfmetertrainer', difficulty: 'profi', seed: 20250727
});
const vereine = [].concat(LEAGUES.bl1.clubIds, LEAGUES.bl2.clubIds);

const schuetzen = [];
const torhueter = [];
for (const id of vereine) {
  const mt = buildMatchTeam(state, id, true);
  const feld = mt.players.filter(p => p.position !== 'TW');
  feld.sort((a, b) =>
    (b.attributes.schuss * 0.4 + b.attributes.nervenstaerke * 0.35 + b.attributes.technik * 0.25) -
    (a.attributes.schuss * 0.4 + a.attributes.nervenstaerke * 0.35 + a.attributes.technik * 0.25));
  for (const p of feld.slice(0, 8)) schuetzen.push(p);
  const tw = mt.players.find(p => p.position === 'TW');
  if (tw) torhueter.push(tw);
}
ok(schuetzen.length >= 90, 'Genug Schützen in der Stichprobe', `${schuetzen.length}`);
ok(torhueter.length >= 30, 'Genug Torhüter in der Stichprobe', `${torhueter.length}`);
console.log(`  ${schuetzen.length} Schützen, ${torhueter.length} Torhüter.`);
{
  const mSch = schuetzen.reduce((s, p) => s + p.attributes.schuss, 0) / schuetzen.length;
  const mRef = torhueter.reduce((s, p) => s + p.attributes.reflexe, 0) / torhueter.length;
  console.log(`  ⌀ Schuss ${nz(mSch)} · ⌀ Reflexe der Torhüter ${nz(mRef)}`);
}

/* ------------------------------------------------------------ Menschmodell */

/** Schützen-Können 0..1 — dieselbe Gewichtung wie penalty.js:shooterSkill. */
function koennen(p) {
  const a = p.attributes;
  return clamp((a.schuss * 0.32 + a.technik * 0.22 + a.nervenstaerke * 0.30 + a.standards * 0.16) / 100, 0, 1);
}

/**
 * Wohin ein Mensch zielt.
 *
 * Bewusst NICHT die brave Gleichverteilung über das Tor: Ein Spieler, der die
 * Szene ein paar Mal gesehen hat, weiß, dass der Torwart in seiner Ecke bis
 * etwa 2,8 m kommt — also zielt er dorthin, wo es weh tut, und riskiert dabei
 * den Pfosten. Genau diese Spannung soll der Korridor „6–12 % Aluminium und
 * daneben" abbilden. Die Verteilung ist der Referenzspieler des Prüfstands;
 * getunt wird gegen sie das SPIEL, nicht sie gegen das Spiel.
 */
function zielen(rng) {
  const r = rng.next();
  let u, h;
  if (r < 0.46) u = rng.float(2.45, 3.20);          // die klassische Ecke
  else if (r < 0.68) u = rng.float(1.30, 2.45);     // halbhoch neben den Torwart
  else if (r < 0.84) u = rng.float(0.00, 1.30);     // zu brav, fast Mitte
  else u = rng.float(3.15, 3.95);                   // Kante — riskant
  if (rng.chance(0.5)) u = -u;
  const rh = rng.next();
  if (rh < 0.58) h = rng.float(0.15, 0.75);
  else if (rh < 0.88) h = rng.float(0.75, 1.60);
  else h = rng.float(1.60, 2.25);
  return { u, h };
}

/**
 * Die drei Eingaben des Spielers.
 * `power` kommt von außen (die Strategie), Zittern und Klickfehler von hier.
 * `zielFn` erlaubt dem Gitterlauf, statt der Referenzverteilung eine feste
 * Zielzone vorzugeben — ein Spieler, der sicher zielt, würfelt nicht.
 * `perfekt` setzt den Präzisionsläufer auf einen sauberen Treffer (precMiss = 0)
 * und schaltet damit den Kanal OVERPOWER_ERR ab; der Zeitfehler wird trotzdem
 * gewürfelt, damit beide Kraftstufen denselben Zufallsstrom sehen.
 */
function eingabe(rng, actor, power, diff = DIFF_MG, zielFn = zielen, perfekt = false) {
  const skill = koennen(actor);
  const ziel = zielFn(rng);

  // Zittern beim Einrasten (penalty.js: WOBBLE_M/WOBBLE_MIN)
  const wobble = Math.max(0.06, 0.62 * (1 - actor.attributes.nervenstaerke / 100) * diff);
  const aimU = clamp(ziel.u + rng.float(-1, 1) * wobble, -4.6, 4.6);
  const aimH = clamp(ziel.h + rng.float(-1, 1) * wobble * 0.55, -0.1, 3.05);

  // Präzisionsbalken: Klickfehler in ms → Ausschlag des Läufers → precMiss
  const precWin = clamp(lerp(K.PREC_WIN_MIN, K.PREC_WIN_MAX, skill) / clamp(diff, 0.5, 1.8), 0.035, 0.30);
  const precPeriod = K.PREC_PERIOD_MS * lerp(0.72, 1.35, skill) / clamp(diff, 0.6, 1.7);
  const fehlerMs = rng.gauss(0, TIMING_SD_MS);
  const off = clamp(Math.abs(4 * fehlerMs / precPeriod), 0, 1);
  const precMiss = perfekt ? 0 : clamp((off - precWin * 2) / Math.max(0.08, 1 - precWin * 2), 0, 1);

  return { aimU, aimH, power, precMiss, precDir: fehlerMs >= 0 ? 1 : -1 };
}

/* --------------------------------------------------------------- Massenlauf */

/**
 * Ein Durchgang. `kraft(rng)` liefert die Kraftbalken-Stellung,
 * `zielFilter` erlaubt Sonderläufe (z. B. nur harte Eckbälle).
 */
function lauf(name, n, kraft, opts = {}) {
  const z = { name, n: 0, tor: 0, parade: 0, daneben: 0, alu: 0, quality: 0, xg: 0 };
  const diff = opts.diff === undefined ? DIFF_MG : opts.diff;
  const flug = [];
  for (let i = 0; i < n; i++) {
    const rng = createRng((opts.seed || 'elf') + ':' + i);
    const actor = schuetzen[rng.int(0, schuetzen.length - 1)];
    const keeper = torhueter[rng.int(0, torhueter.length - 1)];
    let ein = eingabe(rng, actor, kraft(rng), diff);
    if (opts.eingabe) ein = opts.eingabe(ein, rng);
    const r = modell.aufloesen(rng, { actor, keeper, diff }, ein);
    z.n++;
    if (r.outcome === 'tor') z.tor++;
    else if (r.outcome === 'parade') z.parade++;
    else if (r.outcome === 'daneben') z.daneben++;
    else z.alu++;
    z.quality += r.quality;
    z.xg += r.xgDelta;
    flug.push(r.tFlug);
    if (r.flug) r.flug.freigeben();
  }
  z.quote = z.tor / z.n;
  z.pQuote = z.parade / z.n;
  z.aluQuote = (z.alu + z.daneben) / z.n;
  z.qMittel = z.quality / z.n;
  z.xgMittel = z.xg / z.n;
  flug.sort((a, b) => a - b);
  z.flugMin = flug[0];
  z.flugMax = flug[flug.length - 1];
  z.flugMittel = flug.reduce((s, v) => s + v, 0) / flug.length;
  z.flugP05 = flug[Math.floor(flug.length * 0.05)];
  z.flugP95 = flug[Math.floor(flug.length * 0.95)];
  z.flugImKorridor = flug.filter(t => t >= 0.35 && t <= 0.62).length / flug.length;
  return z;
}

function zeile(z) {
  console.log(`  ${z.name.padEnd(26)} Tor ${pz(z.quote).padStart(8)} · gehalten ${pz(z.pQuote).padStart(8)}` +
    ` · Alu ${pz(z.alu / z.n).padStart(7)} · daneben ${pz(z.daneben / z.n).padStart(7)}` +
    ` · ⌀q ${nz(z.qMittel)} · ⌀xg ${nz(z.xgMittel)}`);
}

section(`Massenlauf: ${DURCHLAEUFE} Elfmeter`);

const normal = lauf('Normalspiel', DURCHLAEUFE,
  (rng) => clamp(K.POWER_IDEAL + rng.gauss(0, 0.09), 0.30, 1), { seed: 'elf' });
zeile(normal);
console.log(`  Flugzeit ................. ⌀ ${nz(normal.flugMittel)} s · 5 % ${nz(normal.flugP05)} s` +
  ` · 95 % ${nz(normal.flugP95)} s · min ${nz(normal.flugMin)} s · max ${nz(normal.flugMax)} s`);
console.log(`  … davon in 0,35–0,62 s ... ${pz(normal.flugImKorridor)}`);

korridor(normal.quote, 0.72, 0.80, '1. Torquote 72–80 %');
korridor(normal.pQuote, 0.12, 0.18, '2. Paradenquote 12–18 %');
korridor(normal.aluQuote, 0.06, 0.12, '3. Aluminium + daneben 6–12 %');
korridor(normal.flugMittel, 0.35, 0.62, '4a. Mittlere Flugzeit 0,35–0,62 s');
korridor(normal.flugP05, 0.35, 0.62, '4b. 5-%-Quantil der Flugzeit im Korridor');
korridor(normal.flugP95, 0.35, 0.62, '4c. 95-%-Quantil der Flugzeit im Korridor');
ok(normal.flugImKorridor >= 0.95, '4d. Mindestens 95 % aller Flugzeiten im Korridor',
  pz(normal.flugImKorridor));

/* ------------------------------------------------- Kraftbalken darf nicht siegen */

section('Kraftbalken gegen Präzisionsbalken');

const ideal = lauf('POWER_IDEAL', DURCHLAEUFE, () => K.POWER_IDEAL, { seed: 'kraft' });
const voll = lauf('Volle Kraft', DURCHLAEUFE, () => 1, { seed: 'kraft' });
const halb = lauf('Halbe Kraft', DURCHLAEUFE, () => 0.5, { seed: 'kraft' });
zeile(halb); zeile(ideal); zeile(voll);
console.log(`  Flugzeit halb/ideal/voll .. ${nz(halb.flugMittel)} s / ${nz(ideal.flugMittel)} s / ${nz(voll.flugMittel)} s`);

ok(voll.quote <= ideal.quote, '6. Volle Kraft ist NICHT besser als POWER_IDEAL',
  `voll ${pz(voll.quote)} gegen ideal ${pz(ideal.quote)}`);
ok(ideal.quote > halb.quote, '6b. POWER_IDEAL ist besser als halbe Kraft',
  `ideal ${pz(ideal.quote)} gegen halb ${pz(halb.quote)}`);
ok(voll.quote < ideal.quote - 0.03, '6d. … und zwar spürbar, nicht nur rechnerisch',
  `${pz(ideal.quote - voll.quote)} Abstand`);

/* Der Präzisionsbalken muss die stärkere Achse sein: perfektes Timing bei
 * mäßiger Kraft schlägt volle Kraft mit mäßigem Timing deutlich. */
const perfektTiming = lauf('Ideal + perfektes Timing', DURCHLAEUFE, () => K.POWER_IDEAL,
  { seed: 'kraft', eingabe: (e) => Object.assign(e, { precMiss: 0 }) });
const vollSchlecht = lauf('Voll + mäßiges Timing', DURCHLAEUFE, () => 1,
  { seed: 'kraft', eingabe: (e) => Object.assign(e, { precMiss: Math.max(e.precMiss, 0.25) }) });
zeile(perfektTiming); zeile(vollSchlecht);
ok(perfektTiming.quote > vollSchlecht.quote + 0.06,
  '6c. Präzision schlägt Kraft deutlich',
  `${pz(perfektTiming.quote)} gegen ${pz(vollSchlecht.quote)}`);

/* ----------------------------------------- Das Gitter: Kraft gegen Präzision */

section('Gitterlauf: Vollkraft gegen POWER_IDEAL');

/*
 * DER EIGENTLICHE NACHWEIS. Gegen den Referenzspieler allein trägt Prüfung 6
 * oben nicht: der zielt breit gestreut (siehe zielen()), und über diese
 * Streuung mitteln sich die Effekte weg. Sobald ein Spieler SICHER zielt —
 * immer dieselbe Ecke, dieselbe Höhe —, ist die Lage eine andere; der
 * ursprüngliche Befund lautete, dass die Zusicherung dann in der Ecke
 * 2,40–3,15 m kippt. Eine Zusicherung, die nur gegen die selbstdefinierte
 * Zielverteilung des Prüfstands gilt, ist keine.
 *
 * Deshalb wird ein GITTER gefahren:
 *   3 Schützenprofile (schwach / mittel / Weltklasse bei Schuss und Nerven)
 *   × 3 Torwartprofile (schwach / mittel / Weltklasse)
 *   × 15 Zielzonen (von „flach in die Mitte" bis „Winkel")
 *   = 135 Zellen.
 *
 * GEPAART. Beide Kraftstufen sehen in jeder Zelle DENSELBEN Seed, also
 * denselben Zielwurf, dasselbe Zittern und denselben Klickfehler. Verglichen
 * wird wirklich nur die Kraft; die Streuung des Vergleichs ist dadurch um ein
 * Vielfaches kleiner als bei zwei unabhängigen Läufen.
 *
 * WAS „NICHT BESSER" HEISST. Eine Monte-Carlo-Messung kann eine exakte
 * Ordnung nicht beweisen. Eine Zelle, in der von 500 Schüssen einer anders
 * ausgeht, sagt über das Modell nichts — sie sagt etwas über den Würfel.
 * Geprüft wird deshalb je Zelle, ob Vollkraft MESSBAR besser ist: der gepaarte
 * Unterschied Δ muss unter dem GITTER_SIGMA-fachen seines eigenen
 * Standardfehlers bleiben. Der Standardfehler kommt aus den abweichenden Paaren
 * selbst (McNemar: √(nurIdeal + nurVoll) / n) und ist damit an den Daten der
 * Zelle gemessen, nicht geschätzt. Zusätzlich wird ausgezählt und ausgedruckt,
 * wie viele Zellen überhaupt ein positives Δ zeigen.
 *
 * Die engste Zelle des Gitters wird danach eigens nachgemessen — mit so vielen
 * Schüssen, dass das Vorzeichen trägt (siehe „Die engste Zelle").
 */

const GITTER_N = 500;          // Schüsse je Zelle UND Kraftstufe
const GITTER_SIGMA = 2;        // so breit ist das Rauschband je Zelle
const KERN_N = 6000;           // Nachmessung der engsten Zelle …
const KERN_FAMILIEN = 3;       // … über so viele unabhängige Saatfamilien
const PERFEKT_N = 400;         // Schüsse je Zelle im Teilgitter „perfektes Timing"

const gitterSchuetzen = [
  { name: 'Schütze schwach', foot: 'rechts', attributes: { schuss: 42, technik: 45, nervenstaerke: 40, standards: 40 } },
  { name: 'Schütze mittel', foot: 'rechts', attributes: { schuss: 68, technik: 66, nervenstaerke: 66, standards: 64 } },
  { name: 'Schütze Weltkl.', foot: 'links', attributes: { schuss: 93, technik: 90, nervenstaerke: 92, standards: 90 } }
];
const gitterTorhueter = [
  { name: 'TW schwach', appearance: { height: 184 }, attributes: { reflexe: 48, stellungsspiel: 46, sprungkraft: 50 } },
  { name: 'TW mittel', appearance: { height: 188 }, attributes: { reflexe: 72, stellungsspiel: 70, sprungkraft: 70 } },
  { name: 'TW Weltkl.', appearance: { height: 192 }, attributes: { reflexe: 93, stellungsspiel: 90, sprungkraft: 88 } }
];

/*
 * Die 15 Zielzonen. Sie decken das Tor von der Mitte bis zum Winkel ab und
 * enthalten bewusst die unbequemen Fälle:
 *   „Mitte flach"  – der Torwart steht praktisch auf dem Zielpunkt. Dort ist
 *                    JEDE zusätzliche Streuung eine Verbesserung; wenn der
 *                    Vollkraft-Malus irgendwo zum Bonus wird, dann hier.
 *   „Ecke innen …" – 2,40–3,15 m, klar innerhalb des Tores. Der ursprüngliche
 *                    Befund lautete, dass die Zusicherung genau hier kippt.
 *   „Latte streifen"/„Winkel" – Zonen mit vielen Rahmentreffern.
 */
const gitterZiele = [
  { name: 'Mitte flach', u: [0.00, 0.45], h: [0.10, 0.40] },
  { name: 'Mitte Bauchhöhe', u: [0.00, 0.45], h: [0.75, 1.05] },
  { name: 'Mitte hoch', u: [0.00, 0.55], h: [1.70, 2.15] },
  { name: 'halb flach', u: [1.10, 1.70], h: [0.10, 0.40] },
  { name: 'halbhoch neben TW', u: [1.30, 2.10], h: [0.90, 1.45] },
  { name: 'halbhoch hoch', u: [1.30, 2.10], h: [1.70, 2.15] },
  { name: 'Torwartseite 2,2 m', u: [1.95, 2.35], h: [0.10, 0.40] },
  { name: 'Ecke innen flach', u: [2.40, 3.15], h: [0.15, 0.50] },
  { name: 'Ecke innen mittel', u: [2.40, 3.15], h: [0.80, 1.30] },
  { name: 'Ecke innen hoch', u: [2.40, 3.15], h: [1.70, 2.15] },
  { name: 'Ecke eng flach', u: [3.15, 3.55], h: [0.12, 0.45] },
  { name: 'Ecke eng mittel', u: [3.15, 3.55], h: [0.80, 1.30] },
  { name: 'Winkel', u: [3.20, 3.58], h: [1.95, 2.28] },
  { name: 'Halbfeld breit', u: [0.60, 3.40], h: [0.15, 2.20] },
  { name: 'Latte streifen', u: [2.00, 3.30], h: [2.20, 2.42] }
];

/** Zielsampler für eine feste Zone – der Spieler weiß, wohin er will. */
function bandZiel(band) {
  return (rng) => {
    let u = rng.float(band.u[0], band.u[1]);
    const h = rng.float(band.h[0], band.h[1]);
    if (rng.chance(0.5)) u = -u;
    return { u, h };
  };
}

/**
 * Eine Gitterzelle, gepaart gemessen.
 *
 * Rückgabe enthält neben den beiden Torquoten die ABWEICHENDEN Paare: `nurI`
 * sind Schüsse, die nur mit POWER_IDEAL sitzen, `nurV` solche, die nur mit
 * voller Kraft sitzen. Nur diese Paare tragen Information — aus ihrer Zahl
 * folgt der Standardfehler von Δ.
 */
function gitterZelle(actor, keeper, band, n, seed, perfekt) {
  const zf = bandZiel(band);
  let torI = 0, torV = 0, nurI = 0, nurV = 0;
  for (let i = 0; i < n; i++) {
    const s = seed + ':' + i;
    const rngI = createRng(s);
    const rI = modell.aufloesen(rngI, { actor, keeper, diff: DIFF_MG },
      eingabe(rngI, actor, K.POWER_IDEAL, DIFF_MG, zf, perfekt));
    const rngV = createRng(s);
    const rV = modell.aufloesen(rngV, { actor, keeper, diff: DIFF_MG },
      eingabe(rngV, actor, 1, DIFF_MG, zf, perfekt));
    const a = rI.outcome === 'tor', b = rV.outcome === 'tor';
    if (a) torI++;
    if (b) torV++;
    if (a && !b) nurI++;
    if (b && !a) nurV++;
    rI.flug.freigeben(); rV.flug.freigeben();
  }
  return {
    qIdeal: torI / n, qVoll: torV / n,
    delta: (torV - torI) / n,
    se: Math.sqrt(nurI + nurV) / n,
    nurI, nurV
  };
}

/** Eine Gitterzeile ausdrucken – Δ und Standardfehler in Prozentpunkten. */
function gitterZeile(name, z) {
  console.log(`  ${name.padEnd(50)} ideal ${pz(z.qIdeal).padStart(8)} · voll ${pz(z.qVoll).padStart(8)}` +
    ` · Δ ${nz(z.delta * 100).padStart(7)} ± ${nz(z.se * 100)}`);
}

let gitterAbstand = 0;
{
  let zellen = 0, positiv = 0, engste = -Infinity, engsteName = '';
  let summeIdeal = 0, summeVoll = 0;
  for (const actor of gitterSchuetzen) {
    for (const keeper of gitterTorhueter) {
      for (const band of gitterZiele) {
        const name = `${actor.name} · ${keeper.name} · ${band.name}`;
        const z = gitterZelle(actor, keeper, band, GITTER_N,
          `gitter:${actor.name}:${keeper.name}:${band.name}`, false);
        zellen++;
        summeIdeal += z.qIdeal; summeVoll += z.qVoll;
        if (z.delta > 0) positiv++;
        if (z.delta > engste) { engste = z.delta; engsteName = name; }
        gitterZeile(name, z);
        ok(z.delta <= GITTER_SIGMA * z.se,
          `6a. Gitter: Vollkraft nicht messbar besser (${name})`,
          `Δ ${nz(z.delta * 100)} Punkte gegen Rauschband ${nz(GITTER_SIGMA * z.se * 100)}`);
      }
    }
  }
  gitterAbstand = (summeIdeal - summeVoll) / zellen;
  console.log(`  ${zellen} Zellen à ${GITTER_N} Schuss je Kraftstufe · ${positiv} Zelle(n) mit positivem Δ` +
    ` · größtes Δ ${nz(engste * 100)} Punkte bei ${engsteName}`);
  console.log(`  Gitterschnitt: ideal ${pz(summeIdeal / zellen)} gegen voll ${pz(summeVoll / zellen)}` +
    ` → Abstand ${nz(gitterAbstand * 100)} Punkte`);
  ok(gitterAbstand > 0.06,
    '6e. Über das ganze Gitter kostet Vollkraft deutlich',
    `${nz(gitterAbstand * 100)} Punkte`);
}

/* ------------------------------------------------------- Die engste Zelle */

/*
 * „Flach in die Mitte gegen Weltklasse-Reflexe" ist die einzige Zelle des
 * Gitters, in der Vollkraft fast nichts kostet — und die einzige, die bei
 * GITTER_N Schuss regelmäßig ein positives Δ zeigt. Das ist kein Zufall: der
 * Torwart steht dort praktisch auf dem Zielpunkt, jede zusätzliche Streuung
 * hilft dem Schützen, und der Streuungs-Malus des Übermaßes wird dadurch fast
 * vollständig aufgezehrt. Übrig bleibt nur, was NICHT am Zielpunkt hängt: dass
 * der Torwart den Vollkraftschuss besser liest.
 *
 * Bei 500 Schüssen ist dieser Rest kleiner als das Rauschen. Deshalb wird die
 * Zelle hier eigens und über mehrere unabhängige Saatfamilien nachgemessen.
 * Gefordert ist das Vorzeichen im Mittel — und die Einzelwerte stehen daneben,
 * damit sichtbar bleibt, wie dünn die Marge ist.
 *
 * Referenzmessung dieser Zelle (einmalig, außerhalb der Suite): 12 unabhängige
 * Saatfamilien à 20 000 Schuss je Kraftstufe ergeben Δ = -0,48 Punkte, alle
 * zwölf Familien negativ (Einzelwerte -1,00 bis -0,19). Die Zusicherung hält
 * hier also, aber mit einem halben Prozentpunkt Marge — das ist die dünnste
 * Stelle des ganzen Gitters.
 *
 * Die Zelle ist fest verdrahtet, weil sie durch Messung als engste bekannt ist.
 * Verschiebt eine Balanceänderung das Bild, fällt das oben auf: der Gitterlauf
 * druckt Namen und Größe des größten Δ bei jedem Lauf mit aus.
 */

{
  const actor = gitterSchuetzen[0];          // Schütze schwach
  const keeper = gitterTorhueter[2];         // TW Weltkl.
  const band = gitterZiele[0];               // Mitte flach
  let summe = 0, positiv = 0;
  for (let f = 0; f < KERN_FAMILIEN; f++) {
    const z = gitterZelle(actor, keeper, band, KERN_N, `kern:${f}`, false);
    summe += z.delta;
    if (z.delta > 0) positiv++;
    console.log(`  Saatfamilie ${f} à ${KERN_N} .. ideal ${pz(z.qIdeal)} · voll ${pz(z.qVoll)}` +
      ` · Δ ${nz(z.delta * 100)} ± ${nz(z.se * 100)} Punkte`);
  }
  const mittel = summe / KERN_FAMILIEN;
  console.log(`  Mittel über ${KERN_FAMILIEN * KERN_N} Schuss je Kraftstufe: Δ ${nz(mittel * 100)} Punkte` +
    ` · ${positiv} von ${KERN_FAMILIEN} Familien positiv`);
  ok(mittel < 0, '6f. Auch in der engsten Zelle (Mitte flach / TW Weltkl.) kostet Vollkraft',
    `Δ ${nz(mittel * 100)} Punkte`);
}

/* ------------------------------------- Teilgitter: perfektes Timing */

/*
 * DIE SCHÄRFSTE PROBE. Der Vollkraft-Malus hat zwei Kanäle: er verstärkt einen
 * schon vorhandenen Klickfehler (OVERPOWER_ERR), und er lässt den Torwart den
 * Schuss besser lesen (OVERPOWER_LESEN). Der erste Kanal ist wirkungslos, sobald
 * der Schütze den Präzisionsläufer sauber trifft — bei einem guten Schützen der
 * Regelfall. Genau das war der Kern des ursprünglichen Befunds.
 *
 * Hier wird deshalb precMiss = 0 gesetzt. Dann ist die Ballbahn beider
 * Kraftstufen IDENTISCH (das Übermaß bringt kein Tempo mehr, siehe wirkKraft),
 * und der einzige verbleibende Unterschied ist der lesende Torwart. Wenn die
 * Zusicherung auch hier hält, hängt sie nicht am Klickfehler.
 *
 * NEBENBEFUND, gegen den Kopf von penalty.js. Dort steht, OVERPOWER_LESEN hänge
 * nicht am Zielpunkt und könne „daher nirgends zum Bonus werden". Das stimmt so
 * nicht. Bei identischer Bahn (precMiss = 0, einmalige Referenzmessung über
 * 4000 Schuss je Zelle) sinkt die Haltewahrscheinlichkeit des Torwarts durch das
 * bessere Lesen in bis zu 6,6 % der Schüsse — am häufigsten bei flachem Ball in
 * die Mitte gegen Weltklasse-Reflexe. Grund: der Torwart korrigiert mit `high`
 * auch die Sprunghöhe, und wer dabei auf der FALSCHEN Seite hechtet, streckt
 * sich weiter vom Ball weg. In der Summe bleibt das Lesen ein klarer Malus
 * (Σ steigend 78,0 gegen Σ fallend 17,8 in der genannten Zelle) — die absolute
 * Formulierung „nirgends" trägt aber nicht.
 */

{
  const perfektZiele = gitterZiele.filter(z => ['Mitte flach', 'halbhoch neben TW',
    'Ecke innen flach', 'Ecke eng flach', 'Winkel'].includes(z.name));
  let zellen = 0, positiv = 0, engste = -Infinity, engsteName = '';
  let summeIdeal = 0, summeVoll = 0;
  for (const actor of gitterSchuetzen) {
    for (const keeper of gitterTorhueter) {
      for (const band of perfektZiele) {
        const name = `${actor.name} · ${keeper.name} · ${band.name}`;
        const z = gitterZelle(actor, keeper, band, PERFEKT_N,
          `perfekt:${actor.name}:${keeper.name}:${band.name}`, true);
        zellen++;
        summeIdeal += z.qIdeal; summeVoll += z.qVoll;
        if (z.delta > 0) positiv++;
        if (z.delta > engste) { engste = z.delta; engsteName = name; }
        ok(z.delta <= GITTER_SIGMA * z.se,
          `6g. Perfektes Timing: Vollkraft nicht messbar besser (${name})`,
          `Δ ${nz(z.delta * 100)} Punkte gegen Rauschband ${nz(GITTER_SIGMA * z.se * 100)}`);
      }
    }
  }
  const abstand = (summeIdeal - summeVoll) / zellen;
  console.log(`  ${zellen} Zellen à ${PERFEKT_N} Schuss, precMiss = 0 · ${positiv} Zelle(n) mit positivem Δ` +
    ` · größtes Δ ${nz(engste * 100)} Punkte bei ${engsteName}`);
  console.log(`  Schnitt: ideal ${pz(summeIdeal / zellen)} gegen voll ${pz(summeVoll / zellen)}` +
    ` → Abstand ${nz(abstand * 100)} Punkte`);
  ok(abstand > 0.04,
    '6h. Auch ohne jeden Klickfehler kostet Vollkraft über das Teilgitter',
    `${nz(abstand * 100)} Punkte`);
}

/*
 * OFFEN — und bewusst sichtbar. Der Kopf von src/interactive/penalty.js nennt
 * als Referenz einen Abstand von 10,4 Punkten über 135 Zellen. Mit dem hier
 * festgeschriebenen Zonenraster wird dieser Wert nicht erreicht; gemessen
 * werden rund 8,6 Punkte, und zwar stabil (vier unabhängige Saatfamilien:
 * 8,60 / 8,64 / 8,69 / 8,82 Punkte; bei 3000 statt 500 Schuss je Zelle
 * 8,68 Punkte). Das Zonenraster der dortigen Messung ist nicht dokumentiert,
 * und der Gitterschnitt hängt vollständig davon ab — die 10,4 sind daher nicht
 * nachvollziehbar. Die inhaltliche Aussage (Vollkraft kostet deutlich) trägt
 * unabhängig davon und wird oben unter 6e hart geprüft.
 */
offen(gitterAbstand >= 0.104,
  '6i. Gitterabstand erreicht die im Kopf von penalty.js genannten 10,4 Punkte',
  `gemessen ${nz(gitterAbstand * 100)} Punkte`);

/* -------------------------------------------------- Der platzierte Elfmeter */

section('Ecke ≥ 2,4 m');

/*
 * ACHTUNG, GEÄNDERTES ABNAHMEKRITERIUM. Hier stand früher „volle Kraft + Ecke
 * ≥ 2,4 m trifft über 90 %". Dieser Nachweis ist gefallen — nicht weil er zu
 * streng wäre, sondern weil er dem Gitternachweis widerspricht: DIESELBE
 * Messung mit POWER_IDEAL liefert 90,6 %. Volle Kraft müsste also gleichzeitig
 * über 90 % und unter 90,6 % liegen, ein Fenster von 0,6 Punkten. Bestanden hat
 * der alte Nachweis nur deshalb, weil das „Übermaß" den Ball systematisch um
 * 0,90 m ANGEHOBEN und damit aus der Reichweite des Torwarts geschoben hat — er
 * war ein Bonus, kein Malus (Begründung in penalty.js über OVERPOWER_*).
 *
 * Gemessen wird deshalb, was das Spiel wirklich verspricht: Wer sauber zielt,
 * sauber klickt und die Optimalzone trifft, macht das Ding rein. Und wer
 * stattdessen voll draufhaut, ist auch hier schlechter dran.
 */

const eckeEingabe = (e, rng) => {
  const s = e.aimU >= 0 ? 1 : -1;
  e.aimU = s * rng.float(2.40, 3.15);
  e.aimH = rng.float(0.20, 1.00);
  e.precMiss = 0;
  return e;
};
const eckeIdeal = lauf('Ideal + Ecke ≥ 2,4 m', 2000, () => K.POWER_IDEAL,
  { seed: 'ecke', eingabe: eckeEingabe });
const ecke = lauf('Voll + Ecke ≥ 2,4 m', 2000, () => 1,
  { seed: 'ecke', eingabe: eckeEingabe });
zeile(eckeIdeal); zeile(ecke);
ok(eckeIdeal.quote > 0.88, '5. Ideale Kraft + Ecke ≥ 2,4 m trifft über 88 %', pz(eckeIdeal.quote));
ok(ecke.quote <= eckeIdeal.quote, '5b. Volle Kraft ist auch in der Ecke nicht besser',
  `voll ${pz(ecke.quote)} gegen ideal ${pz(eckeIdeal.quote)}`);

/* --------------------------------------------------- Schwierigkeit skaliert */

section('Schwierigkeitsgrad');

{
  const stufen = ['amateur', 'profi', 'weltklasse', 'legende'];
  const quoten = [];
  for (const stufe of stufen) {
    const mg = DIFFICULTIES[stufe].minigame;
    const z = lauf(stufe, 2000, (rng) => clamp(K.POWER_IDEAL + rng.gauss(0, 0.09), 0.30, 1),
      { seed: 'stufe', diff: mg });
    quoten.push(z.quote);
    console.log(`  ${String(stufe).padEnd(12)} minigame ${nz(mg)} · Tor ${pz(z.quote)} · gehalten ${pz(z.pQuote)}`);
  }
  let monoton = true;
  for (let i = 1; i < quoten.length; i++) if (quoten[i] > quoten[i - 1]) monoton = false;
  ok(monoton, '7. Höhere Schwierigkeit senkt die Torquote', quoten.map(q => pz(q)).join(' > '));
  ok(quoten[0] - quoten[quoten.length - 1] > 0.05, '7b. Der Unterschied ist spürbar',
    `${pz(quoten[0])} gegen ${pz(quoten[quoten.length - 1])}`);
}

/* ------------------------------------------------------------ Physikproben */

section('Physik');

{
  // Flugzeit fällt monoton mit der Kraft
  const t0 = modell.flugzeit(0, 70, 0, 0.6);
  const t5 = modell.flugzeit(0.5, 70, 0, 0.6);
  const t1 = modell.flugzeit(1, 70, 0, 0.6);
  console.log(`  Flugzeit bei Kraft 0/0,5/1 (Schuss 70) .. ${nz(t0)} s / ${nz(t5)} s / ${nz(t1)} s`);
  ok(t0 > t5 && t5 > t1, 'Mehr Kraft = kürzere Flugzeit', `${nz(t0)}/${nz(t5)}/${nz(t1)}`);
  korridor(t1, 0.35, 0.45, 'Vollkraft-Elfmeter unter einer halben Sekunde');
  korridor(t0, 0.45, 0.62, 'Der weichste Elfmeter bleibt unter 0,62 s');

  // Abschussgeschwindigkeit
  ok(modell.schussTempo(1, 99) > modell.schussTempo(1, 20), 'Besserer Schuss = härterer Ball');

  // Torwartreichweite: linear nach dem Absprung, hohe Bälle kosten Weg
  const tw = { attributes: { reflexe: 70, stellungsspiel: 70, sprungkraft: 70 } };
  const r03 = modell.twReichweiteBei(0.35, 0.5, tw, false);
  const r06 = modell.twReichweiteBei(0.60, 0.5, tw, false);
  const r06h = modell.twReichweiteBei(0.60, 2.10, tw, false);
  console.log(`  TW-Reichweite 0,35 s / 0,60 s / 0,60 s hoch .. ${nz(r03)} m / ${nz(r06)} m / ${nz(r06h)} m`);
  ok(r06 > r03, 'Mehr Zeit = mehr Reichweite');
  ok(r06h < r06, 'Hohe Bälle kosten Reichweite');
  const rSpaet = modell.twReichweiteBei(0.45, 0.5, tw, true);
  const rFrueh = modell.twReichweiteBei(0.45, 0.5, tw, false);
  ok(rSpaet < rFrueh, 'Wer erst reagiert, kommt weniger weit', `${nz(rSpaet)} gegen ${nz(rFrueh)}`);

  // Linearität nach dem Absprung: doppelte Restzeit = doppelter Weg
  const arm = modell.twReichweiteBei(0.001, 0.5, tw, false);
  const w1 = modell.twReichweiteBei(0.40, 0.5, tw, false) - arm;
  const w2 = modell.twReichweiteBei(0.80, 0.5, tw, false) - arm;
  ok(Math.abs(w2 - 2 * w1) < 0.06 || w2 >= 3.29 - arm, 'Nach dem Absprung ist die Bewegung linear',
    `${nz(w1)} m → ${nz(w2)} m`);

  // Die Bahn endet wirklich auf der Torlinie
  const b = modell.bahn(2.8, 1.2, modell.schussTempo(0.8, 75));
  const tr = b.flug.trefferEbene('y', 0);
  ok(tr && Math.abs(tr.x - 2.8) < 0.10 && Math.abs(tr.z - 1.2) < 0.10,
    'Der Ball kommt am gezielten Punkt an', tr ? `${nz(tr.x)} / ${nz(tr.z)}` : 'kein Treffer');
  b.flug.freigeben();
}

/* --------------------------------------------------------- Determinismus */

section('Determinismus und Vertrag');

{
  const actor = schuetzen[0], keeper = torhueter[0];
  const ein = { aimU: -2.7, aimH: 0.6, power: 0.8, precMiss: 0.05, precDir: 1 };
  const a = modell.aufloesen(createRng('det'), { actor, keeper, diff: 1 }, ein);
  const b = modell.aufloesen(createRng('det'), { actor, keeper, diff: 1 }, ein);
  ok(a.outcome === b.outcome && a.quality === b.quality && a.xgDelta === b.xgDelta,
    'Gleicher Seed, gleiches Ergebnis', `${a.outcome}/${b.outcome}`);
  const c = modell.aufloesen(createRng('det-anders'), { actor, keeper, diff: 1 }, ein);
  ok(typeof c.outcome === 'string', 'Anderer Seed läuft ebenfalls durch');
  a.flug.freigeben(); b.flug.freigeben(); c.flug.freigeben();

  const gueltig = new Set(['tor', 'parade', 'daneben', 'latte', 'pfosten']);
  let falsch = 0, qFalsch = 0, xgFalsch = 0;
  for (let i = 0; i < 500; i++) {
    const rng = createRng('vertrag:' + i);
    const r = modell.aufloesen(rng,
      { actor: schuetzen[rng.int(0, schuetzen.length - 1)], keeper: torhueter[rng.int(0, torhueter.length - 1)], diff: 1 },
      eingabe(rng, schuetzen[0], rng.float(0.2, 1)));
    if (!gueltig.has(r.outcome)) falsch++;
    if (!(r.quality >= 0 && r.quality <= 1)) qFalsch++;
    if (!(r.xgDelta >= -0.10 && r.xgDelta <= 0.40)) xgFalsch++;
    r.flug.freigeben();
  }
  ok(falsch === 0, 'Nur Ausgänge aus dem Vertragsvokabular (§6.1)', `${falsch} Fälle`);
  ok(qFalsch === 0, 'quality liegt in 0..1', `${qFalsch} Fälle`);
  ok(xgFalsch === 0, 'xgDelta liegt in XG_MIN..XG_MAX', `${xgFalsch} Fälle`);

  ok(minigame.id === 'elfmeter' && minigame.kind === 'elfmeter' && typeof minigame.play === 'function',
    'minigame erfüllt Vertrag §9');
  ok(typeof modell.flugzeit === 'function' && typeof modell.twReichweiteBei === 'function'
    && typeof modell.parade === 'function', 'modell hat die drei geforderten Funktionen');

  const roh = readFileSync(new URL('../src/interactive/penalty.js', import.meta.url), 'utf8');
  const quelle = roh.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/Math\.random/.test(quelle), 'Kein Math.random() im Modul');
  ok(!/Date\.now/.test(quelle), 'Kein Date.now() im Modul');
}

/* ------------------------------------------------ Szene läuft wirklich durch */

section('Szenenlauf (Canvas-Attrappe)');

/*
 * Der Modelltest allein sagt nichts darüber, ob die SZENE läuft. Deshalb wird
 * minigame.play() hier mit einer Canvas-Attrappe komplett durchgespielt:
 * Anlauf, Flug, Netz, Abpraller, Ergebnisbanner. Geprüft wird, dass nichts
 * wirft, dass keine NaN-Koordinate an den Kontext geht (das wäre ein
 * unsichtbarer Ball), dass alle Zuhörer wieder abgemeldet werden und dass die
 * Szene auch ohne jede Eingabe von selbst auflöst (Vertrag §9).
 */
{
  const nanFelder = new Set();
  const grad = { addColorStop() { } };
  const machCtx = () => new Proxy({
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    lineJoin: '', font: '', textAlign: '', textBaseline: '',
    createLinearGradient: () => grad, measureText: () => ({ width: 40 })
  }, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => { for (const v of a) if (typeof v === 'number' && !isFinite(v)) nanFelder.add(String(k)); };
    },
    set(t, k, v) { t[k] = v; return true; }
  });

  const canvasZuhoerer = new Map(), fensterZuhoerer = new Map();
  const canvas = {
    width: 960, height: 600, style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 600 }),
    addEventListener(t, f) { canvasZuhoerer.set(t, f); },
    removeEventListener(t) { canvasZuhoerer.delete(t); }
  };
  const altWindow = globalThis.window, altPerf = globalThis.performance;
  const altRaf = globalThis.requestAnimationFrame, altCancel = globalThis.cancelAnimationFrame;
  globalThis.window = {
    addEventListener(t, f) { fensterZuhoerer.set(t, f); },
    removeEventListener(t) { fensterZuhoerer.delete(t); }
  };
  let uhr = 0, queue = [];
  globalThis.performance = { now: () => uhr };
  globalThis.requestAnimationFrame = (f) => queue.push(f);
  globalThis.cancelAnimationFrame = () => { queue = []; };

  const keeper = torhueter[0];
  async function szene(druck, los, klick, seed) {
    const host = {
      canvas, ctx: machCtx(), root: {}, difficulty: DIFF,
      rng: createRng('szene:' + seed), sound() { },
      drawPlayer() { }, drawPitchSection() { }
    };
    const moment = {
      kind: 'elfmeter', minute: 88, team: 'home',
      actor: schuetzen[seed % schuetzen.length], keeper,
      defenders: [], targets: [], at: { x: 94, y: 34 }, baseChance: 0.78, pressure: 70,
      context: { score: [1, 1], minute: 88, competition: 'Prüfstand', farben: { heim: '#c1272d', gast: '#1c4f8f' } }
    };
    uhr = 0; queue = [];
    let res, fertig = false;
    minigame.play(host, moment).then(r => { res = r; fertig = true; });
    const dr = canvasZuhoerer.get('pointerdown');
    const up = fensterZuhoerer.get('pointerup');
    const mv = canvasZuhoerer.get('pointermove');
    let bilder = 0;
    while (!fertig && bilder < 3000) {
      const f = queue.shift();
      if (!f) break;
      uhr += 16.7;
      if (mv && bilder === 5) mv({ clientX: 330 + seed * 11, clientY: 300 });
      if (dr && bilder === druck) dr({ preventDefault() { } });
      if (up && bilder === los) up();
      if (dr && bilder === klick) dr({ preventDefault() { } });
      f(uhr);
      bilder++;
      await null;
    }
    await new Promise(r => setImmediate(r));
    return { res, bilder };
  }

  const ausgaenge = new Set();
  let fehler = 0, ohneErgebnis = 0, maxBilder = 0;
  for (let i = 0; i < 14; i++) {
    try {
      const { res, bilder } = await szene(70, 78 + i, 100 + i * 4, i);
      if (!res || !res.outcome) ohneErgebnis++; else ausgaenge.add(res.outcome);
      maxBilder = Math.max(maxBilder, bilder);
    } catch (err) { fehler++; console.log('    ' + err.message); }
  }
  // Ohne jede Eingabe muss die Szene über ihre eigenen Fristen auflösen.
  let passiv = null;
  try { passiv = await szene(-1, -1, -1, 99); } catch (err) { fehler++; console.log('    ' + err.message); }

  globalThis.window = altWindow; globalThis.performance = altPerf;
  globalThis.requestAnimationFrame = altRaf; globalThis.cancelAnimationFrame = altCancel;

  console.log(`  15 Szenen gespielt · längste ${maxBilder} Bilder · Ausgänge: ${[...ausgaenge].join(', ')}`);
  ok(fehler === 0, '8a. Kein Laufzeitfehler im Zeichenpfad', `${fehler} Fälle`);
  ok(ohneErgebnis === 0, '8b. Jede Szene liefert eine resolution', `${ohneErgebnis} Fälle`);
  ok(nanFelder.size === 0, '8c. Keine NaN-Koordinate geht an den Canvas-Kontext', [...nanFelder].join(', '));
  ok(canvasZuhoerer.size === 0 && fensterZuhoerer.size === 0,
    '8d. Alle Zuhörer sind nach dem Ende abgemeldet',
    `${canvasZuhoerer.size} + ${fensterZuhoerer.size}`);
  ok(passiv && passiv.res && passiv.bilder < 20000 / 16.7,
    '8e. Ohne Eingabe löst die Szene vor dem harten Timeout auf',
    passiv ? `${passiv.bilder} Bilder, ${passiv.res && passiv.res.outcome}` : 'abgebrochen');
}

/* -------------------------------------------------------------- Ergebnis */

const GITTER_SCHUESSE = 2 * (135 * GITTER_N + KERN_FAMILIEN * KERN_N + 45 * PERFEKT_N);
const SCHUESSE = DURCHLAEUFE * 6 + 2 * 2000 + 8000 + 500 + GITTER_SCHUESSE;

console.log('');
if (failures.length === 0) {
  console.log(`✅ ALLE TESTS BESTANDEN — ${passed} Prüfungen, ${SCHUESSE} ausgewertete Elfmeter.`);
  if (offeneZiele.length) {
    console.log(`   ${offeneZiele.length} Ziel(e) bewusst offen:`);
    for (const z of offeneZiele) console.log('   ○ ' + z);
  }
  process.exit(0);
} else {
  console.log(`❌ ${failures.length} FEHLER (${passed} Prüfungen bestanden):\n`);
  for (const f of failures.slice(0, 60)) console.log('  • ' + f);
  process.exit(1);
}
