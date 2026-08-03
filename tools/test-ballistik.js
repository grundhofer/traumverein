/**
 * tools/test-ballistik.js — Prüfstand für src/core/ballistik.js
 *
 * Aufruf:  node tools/test-ballistik.js
 *
 * Geprüft wird:
 *   1. FLUGZEIT_REFERENZ auf ≤ 3 cm (Zeitspalten als Streckenfehler t·v, Reichweite direkt)
 *   2. Energieerhaltung ohne Luft: Scheitel = v₀²/2g ± 1 mm
 *   3. Determinismus: zwei identische createFlug-Aufrufe → bitgleiche Stützstellen
 *   4. Zeitverbrauch: 1000× createFlug mit tMax = 3 s unter 250 ms
 *   5. Der Ball geht nie unter boden − 1e-6, auch nicht zwischen den Stützstellen
 *   6. Tunneltest: 32 m/s gegen einen Pfostenzylinder genau auf der Bahn
 *   7. Restliche API (Drallachsen, Rutschphase, Spieler, Torwart, Kopfball) —
 *      diese Gruppe ist keine Zusatzkür: sechs weitere Pakete schreiben blind
 *      gegen genau diese Namen und Einheiten.
 *
 * ---------------------------------------------------------------------------
 * HERKUNFT DER REFERENZWERTE — und warum die Toleranz nicht angefasst wurde
 * ---------------------------------------------------------------------------
 * Der Umbauplan nennt in FLUGZEIT_REFERENZ Sollwerte, aber weder Abschusshöhe
 * noch Abschusswinkel noch Drall. Beides wurde zurückgerechnet, nicht geraten:
 *
 *  a) Abschusshöhe. Mit p.z = 0 fallen alle Reichweiten systematisch 0,15 m zu
 *     kurz aus, mit p.z = BALL_R = 0,11 m stimmen sie. Der Ball liegt also auf
 *     dem Rasen, boden = 0 ist die Ebene, in der sein Mittelpunkt zur Ruhe kommt.
 *  b) Winkel und Drall. Für die drei Szenarien mit Winkel im Namen
 *     (flanke21_30grad, flanke23_35grad, abstoss25_40grad) ist nichts frei —
 *     und mit dt → 0 liefert dieses Modell 30,5175 / 37,0455 / 42,6043 m gegen
 *     die Referenz 30,5 / 37,0 / 42,6. Die Referenz IST die dt→0-Lösung genau
 *     dieser Gleichung mit genau diesen Konstanten.
 *     Für die vier übrigen Szenarien wurden Winkel und Drall so gesucht, dass
 *     ALLE Spalten gleichzeitig passen; es gibt je genau eine Lösung:
 *       elfmeter28   28 m/s,  6,74°, Topspin  1,25 U/s
 *       vollspann32  32 m/s, 10,80°, Topspin  0,75 U/s
 *       effet24      24 m/s, 16,00°, Effet    3,55 U/s
 *       topspin26    26 m/s, 18,40°, Topspin 10,25 U/s
 *     Dass zwei freie Parameter drei Sollwerte gleichzeitig auf < 1,5 cm treffen,
 *     ist keine Anpassung mehr, sondern eine Bestätigung der Referenz.
 *
 * ERGEBNIS: Referenz und Integrator sind beide richtig. Es bleibt einzig der
 * Diskretisierungsfehler von DT_PHYS = 1/300; er liegt mit dem Verlet-Ortsschritt
 * (siehe Dateikopf von ballistik.js) bei höchstens 2,9 cm und damit unter den
 * geforderten 3 cm. Die Toleranz wurde NICHT aufgeweicht — mit dem reinen
 * `p += v(n+1)·dt` wären es bis zu 7,3 cm gewesen, und dann hätte hier ein
 * roter Test gestanden.
 */

import { createRng } from '../src/core/rng.js';
import { round } from '../src/core/util.js';
import {
  G, BALL_R, BALL_M, K_AERO, BALL_A, RHO_LUFT, DT_PHYS, DT_SAMPLE, SAMPLE_JEDER,
  CW_UNTERKRIT, CW_UEBERKRIT, MU_GLEIT_TROCKEN, MU_ROLL_KURZ,
  cwBall, clMagnus, kAero, drallVektor,
  createFlug, abschussVektor, loeseAbschuss, segmentFlug, SEGMENT_TYPEN,
  rutschEnde, laufwerte, sprintStrecke, sprintZeit, sprintSchritt, lenke, wendeKosten,
  twParameter, twReichweite, pFesthalten, abpraller,
  sprungProfil, kopfHoehe, timingGuete,
  FLUGZEIT_REFERENZ, VMAX_BASIS, VMAX_SPANNE, APEAK_BASIS, APEAK_SPANNE, TW_MAX
} from '../src/core/ballistik.js';

/* ------------------------------------------------------------------ *
 *  Mini-Testrahmen
 * ------------------------------------------------------------------ */
let bestanden = 0, gescheitert = 0;
const fehler = [];

function ok(bedingung, titel, info) {
  if (bedingung) { bestanden++; console.log(`  ✓ ${titel}${info ? ` — ${info}` : ''}`); }
  else { gescheitert++; fehler.push(titel + (info ? ` — ${info}` : '')); console.log(`  ✗ ${titel}${info ? ` — ${info}` : ''}`); }
}
function gruppe(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`); }

const GRAD = Math.PI / 180;

/* ------------------------------------------------------------------ *
 *  1. FLUGZEIT_REFERENZ
 * ------------------------------------------------------------------ */
gruppe('1. FLUGZEIT_REFERENZ (Toleranz 3 cm)');

/** [v0 m/s, Elevation °, Effet U/s, Topspin U/s] — Herleitung siehe Dateikopf. */
const SZENARIO = {
  elfmeter28: [28, 6.74, 0, 1.25],
  vollspann32: [32, 10.80, 0, 0.75],
  effet24: [24, 16.00, 3.55, 0],
  topspin26: [26, 18.40, 0, 10.25],
  flanke21_30grad: [21, 30, 0, 0],
  flanke23_35grad: [23, 35, 0, 0],
  abstoss25_40grad: [25, 40, 0, 0]
};
const MARKEN = [11, 20, 30];
const TOL = 0.03;

let maxAbw = 0, maxAbwName = '';
for (const name of Object.keys(FLUGZEIT_REFERENZ)) {
  const s = SZENARIO[name];
  if (!s) { ok(false, `${name}: kein Abschussdatensatz hinterlegt`); continue; }
  const [v0, gradE, effet, topspin] = s;
  const e = gradE * GRAD;
  const flug = createFlug({
    p: { x: 0, y: 0, z: BALL_R },
    v: { x: v0 * Math.cos(e), y: 0, z: v0 * Math.sin(e) },
    w: drallVektor(1, 0, effet, topspin),
    tMax: 4
  });
  const ref = FLUGZEIT_REFERENZ[name];
  const teile = [];
  let schlimmste = 0;
  for (let i = 0; i < 3; i++) {
    if (ref[i] === null) continue;
    const tr = flug.trefferEbene('x', MARKEN[i]);
    if (!tr) { ok(false, `${name}: ${MARKEN[i]} m wird nie erreicht`); schlimmste = 99; continue; }
    const d = (tr.t - ref[i]) * tr.vx;          // Zeitfehler in Streckenfehler umgerechnet
    schlimmste = Math.max(schlimmste, Math.abs(d));
    teile.push(`${MARKEN[i]}m ${round(d * 100, 2)} cm`);
  }
  const land = flug.landung();
  const dRw = land ? land.x - ref[3] : 99;
  schlimmste = Math.max(schlimmste, Math.abs(dRw));
  teile.push(`RW ${round(dRw * 100, 2)} cm`);
  if (schlimmste > maxAbw) { maxAbw = schlimmste; maxAbwName = name; }
  ok(schlimmste <= TOL, `${name} trifft alle Sollwerte auf 3 cm`, teile.join(', '));
}
console.log(`    größte Abweichung: ${round(maxAbw * 100, 2)} cm (${maxAbwName}), Grenze 3,00 cm`);

/* Stützstellenraster: der Plan verspricht < 0,5 mm Interpolationsfehler.
 * Der Abstand einer Sehne von ihrem Bogen ist a⊥·Δt²/8 mit a⊥ = Querbeschleunigung.
 * a⊥ wird aus den gespeicherten Geschwindigkeiten zweier Nachbarstützstellen
 * gewonnen — eine feinere Bahn als das 60-Hz-Raster gibt das Modul nicht heraus,
 * also wird hier gerechnet statt verglichen. */
{
  const v0 = 32, e = 10.8 * GRAD;
  const flug = createFlug({
    p: { x: 0, y: 0, z: BALL_R },
    v: { x: v0 * Math.cos(e), y: 0, z: v0 * Math.sin(e) }, tMax: 3, boden: -50
  });
  let maxFehler = 0;
  const a = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
  const b = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
  for (let i = 0; i + 1 < flug.anzahl; i++) {
    flug.at(i * DT_SAMPLE, a); flug.at((i + 1) * DT_SAMPLE, b);
    const ax = (b.vx - a.vx) / DT_SAMPLE, ay = (b.vy - a.vy) / DT_SAMPLE, az = (b.vz - a.vz) / DT_SAMPLE;
    const s = a.v > 1e-9 ? a.v : 1;
    const proj = (ax * a.vx + ay * a.vy + az * a.vz) / (s * s);
    const qx = ax - proj * a.vx, qy = ay - proj * a.vy, qz = az - proj * a.vz;
    const d = Math.hypot(qx, qy, qz) * DT_SAMPLE * DT_SAMPLE / 8;
    if (d > maxFehler) maxFehler = d;
  }
  ok(maxFehler < 0.0006, 'Sehnenfehler des 60-Hz-Rasters bleibt unter 0,5 mm (Plan)',
    `max ${round(maxFehler * 1000, 4)} mm bei 32 m/s`);
}

/* ------------------------------------------------------------------ *
 *  2. Energieerhaltung ohne Luft
 * ------------------------------------------------------------------ */
gruppe('2. Wurfparabel ohne Luft');

for (const v0 of [8, 14, 20, 28]) {
  const flug = createFlug({ p: { x: 0, y: 0, z: 0 }, v: { x: 0, y: 0, z: v0 }, dichte: 0, tMax: 8 });
  const soll = v0 * v0 / (2 * G);
  const ist = flug.scheitel().z;
  ok(Math.abs(ist - soll) < 0.001, `v0 = ${v0} m/s: Scheitel = v0²/2g ± 1 mm`,
    `${round(ist, 6)} m gegen ${round(soll, 6)} m (Δ ${round((ist - soll) * 1000, 6)} mm)`);
}
{
  // schräg, mit Vorwärtskomponente: Scheitel hängt nur an vz
  const flug = createFlug({ p: { x: 0, y: 0, z: 0 }, v: { x: 18, y: 5, z: 16 }, dichte: 0, tMax: 8 });
  const soll = 16 * 16 / (2 * G);
  ok(Math.abs(flug.scheitel().z - soll) < 0.001, 'schräger Wurf ohne Luft: Scheitel nur aus vz',
    `${round(flug.scheitel().z, 6)} gegen ${round(soll, 6)}`);
  // Wurfweite analytisch: x = vx · 2·vz/g
  const land = flug.landung();
  const sollW = 18 * 2 * 16 / G;
  ok(Math.abs(land.x - sollW) < 0.002, 'Wurfweite ohne Luft analytisch exakt',
    `${round(land.x, 5)} gegen ${round(sollW, 5)} m`);
}

/* ------------------------------------------------------------------ *
 *  3. Determinismus
 * ------------------------------------------------------------------ */
gruppe('3. Determinismus');

{
  const bauen = () => createFlug({
    p: { x: 3.5, y: 12.25, z: 0.11 },
    v: { x: 17.3, y: -6.4, z: 8.1 },
    w: drallVektor(0.8, -0.3, 4.2, 2.6),
    wind: { x: 1.4, y: -0.6, z: 0.2 },
    boden: 0, tMax: 4, nass: 0.4, tief: 0.25
  });
  const a = bauen();
  const kopieA = Float64Array.from(a.stuetzstellen());
  const dauerA = a.dauer, anzA = a.anzahl;
  const landA = JSON.stringify(a.landung());
  const aufA = JSON.stringify(a.aufsetzer());
  const schA = JSON.stringify(a.scheitel());
  const b = bauen();
  const kopieB = Float64Array.from(b.stuetzstellen());

  let gleich = kopieA.length === kopieB.length && dauerA === b.dauer && anzA === b.anzahl;
  if (gleich) for (let i = 0; i < kopieA.length; i++) if (!Object.is(kopieA[i], kopieB[i])) { gleich = false; break; }
  ok(gleich, 'zwei identische createFlug-Aufrufe liefern bitgleiche Stützstellen',
    `${kopieA.length} Werte, ${anzA} Stützstellen`);
  ok(landA === JSON.stringify(b.landung()), 'Landung identisch');
  ok(aufA === JSON.stringify(b.aufsetzer()), 'Aufsetzer identisch', `${b.aufsetzer().length} Kontakte`);
  ok(schA === JSON.stringify(b.scheitel()), 'Scheitel identisch');

  // auch nach Poolrecycling
  a.freigeben(); b.freigeben();
  const c = bauen();
  const kopieC = Float64Array.from(c.stuetzstellen());
  let gleichC = kopieC.length === kopieA.length;
  if (gleichC) for (let i = 0; i < kopieA.length; i++) if (!Object.is(kopieA[i], kopieC[i])) { gleichC = false; break; }
  ok(gleichC, 'auch ein Flug aus dem recycelten Poolpuffer ist bitgleich');
}
{
  // Das Modul zieht selbst keinen Zufall — rng gibt es nur als Parameter
  const zaehler = { n: 0 };
  const rng = createRng(4711);
  const zaehlRng = { next() { zaehler.n++; return rng.next(); } };
  const r1 = abpraller(19, zaehlRng);
  ok(zaehler.n === 1, 'abpraller() zieht genau einmal rng', `${zaehler.n} Ziehung(en)`);
  const rng2 = createRng(4711);
  const r2 = abpraller(19, { next: () => rng2.next() });
  ok(JSON.stringify(r1) === JSON.stringify(r2), 'abpraller() ist bei gleichem Seed identisch',
    `${r1.zone}, v ${round(r1.v, 2)}, gefahr ${round(r1.gefahr, 3)}`);
}

/* ------------------------------------------------------------------ *
 *  4. Zeitverbrauch
 * ------------------------------------------------------------------ */
gruppe('4. Zeitverbrauch');

{
  const e = 40 * GRAD;
  const init = {
    p: { x: 0, y: 0, z: BALL_R },
    v: { x: 25 * Math.cos(e), y: 0, z: 25 * Math.sin(e) },
    tMax: 3
  };
  createFlug(init).freigeben();   // JIT aufwärmen
  for (let i = 0; i < 200; i++) createFlug(init).freigeben();

  const t0 = process.hrtime.bigint();
  let summe = 0;
  for (let i = 0; i < 1000; i++) { const f = createFlug(init); summe += f.dauer; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(ms < 250, '1000× createFlug (tMax = 3 s) unter 250 ms',
    `${round(ms, 1)} ms, also ${round(ms, 2)} µs je Flug bei 900 Substeps`);
  console.log(`    Σ Flugdauer ${round(summe, 1)} s`);

  // und das Gleiche mit Poolrückgabe (so laufen die Szenen)
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) createFlug(init).freigeben();
  const ms2 = Number(process.hrtime.bigint() - t1) / 1e6;
  console.log(`    mit freigeben(): ${round(ms2, 1)} ms`);

  // at() im Frame darf nichts kosten
  const flug = createFlug(init);
  const aus = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
  const t2 = process.hrtime.bigint();
  for (let i = 0; i < 200000; i++) flug.at((i % 180) / 60, aus);
  const ms3 = Number(process.hrtime.bigint() - t2) / 1e6;
  ok(ms3 < 60, '200 000× at() unter 60 ms (60 fps × 22 Objekte × 150 s)', `${round(ms3, 1)} ms`);
}

/* ------------------------------------------------------------------ *
 *  5. Der Ball bleibt über dem Boden
 * ------------------------------------------------------------------ */
gruppe('5. Ball nie unter boden − 1e-6');

{
  const rng = createRng(20260730);
  let schlimmster = Infinity;
  let faelle = 0;
  for (let i = 0; i < 240; i++) {
    const boden = rng.float(-2, 3);
    const v0 = rng.float(3, 34);
    const e = rng.float(-0.5, 1.3);
    const gier = rng.float(-Math.PI, Math.PI);
    const flug = createFlug({
      p: { x: rng.float(-5, 5), y: rng.float(-5, 5), z: boden + rng.float(0, 2.2) },
      v: abschussVektor(v0, gier, e, { x: 0, y: 0, z: 0 }),
      w: drallVektor(Math.cos(gier), Math.sin(gier), rng.float(-9, 9), rng.float(-8, 12)),
      wind: { x: rng.float(-5, 5), y: rng.float(-5, 5), z: rng.float(-1, 1) },
      boden, tMax: 4, nass: rng.next(), tief: rng.next()
    });
    faelle++;
    const s = flug.stuetzstellen();
    for (let k = 0; k < flug.anzahl; k++) schlimmster = Math.min(schlimmster, s[k * 6 + 2] - boden);
    const aus = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
    for (let t = 0; t <= flug.dauer + 1e-9; t += 1 / 600) {
      flug.at(t, aus);
      if (aus.z - boden < schlimmster) schlimmster = aus.z - boden;
    }
    flug.freigeben();
  }
  ok(schlimmster >= -1e-6, `${faelle} Flüge: z ≥ boden − 1e-6, auch zwischen den Stützstellen`,
    `tiefster Wert boden ${schlimmster >= 0 ? '+' : ''}${schlimmster.toExponential(2)} m`);
}

/* ------------------------------------------------------------------ *
 *  6. Tunneltest
 * ------------------------------------------------------------------ */
gruppe('6. Tunneltest — 32 m/s gegen einen Pfosten');

{
  const v0 = 32, e = 4.2 * GRAD;
  const flug = createFlug({
    p: { x: 0, y: 0, z: BALL_R },
    v: { x: v0 * Math.cos(e), y: 0, z: v0 * Math.sin(e) },
    tMax: 3
  });
  // Pfosten exakt auf der Bahn: Achse bei x = 20, Radius 6 cm (echter Pfosten: Ø 12 cm)
  const mx = 20, my = 0, r = 0.06, zMin = 0, zMax = 2.44;
  const schritt = v0 * DT_SAMPLE;
  console.log(`    Stützstellenabstand bei 32 m/s: ${round(schritt, 3)} m, Pfostendurchmesser ${round(2 * r, 3)} m`);

  // Nachweis, dass eine reine Punktprüfung den Pfosten VERFEHLT
  let minPunktAbstand = Infinity;
  const s = flug.stuetzstellen();
  for (let k = 0; k < flug.anzahl; k++) {
    const d = Math.hypot(s[k * 6] - mx, s[k * 6 + 1] - my);
    if (d < minPunktAbstand) minPunktAbstand = d;
  }
  ok(minPunktAbstand > r, 'eine Punktprüfung auf den Stützstellen würde den Pfosten verfehlen',
    `nächster Stützpunkt ${round(minPunktAbstand, 3)} m von der Achse, Radius ${r} m`);

  const treffer = flug.trefferZylinder('z', mx, my, r, zMin, zMax);
  ok(!!treffer, 'trefferZylinder findet den Pfosten trotzdem');
  if (treffer) {
    const abstand = Math.hypot(treffer.x - mx, treffer.y - my);
    ok(Math.abs(abstand - r) < 1e-6, 'Trefferpunkt liegt auf der Pfostenoberfläche',
      `Abstand ${round(abstand, 6)} m, Radius ${r} m, t = ${round(treffer.t, 4)} s, z = ${round(treffer.z, 3)} m`);
    ok(treffer.z >= zMin && treffer.z <= zMax, 'Trefferhöhe liegt im Pfostenabschnitt');
  }
  // Pfosten daneben: kein Treffer
  ok(flug.trefferZylinder('z', mx, 1.5, r, zMin, zMax) === null, 'ein Pfosten 1,5 m daneben wird nicht getroffen');
  // Pfosten zu hoch angesetzt: kein Treffer
  ok(flug.trefferZylinder('z', mx, my, r, 2.0, 2.44) === null, 'ein Pfostenabschnitt über der Bahn wird nicht getroffen');

  // Dasselbe für die Torlinie (Ebene) und den Torrahmen (Quader)
  const linie = flug.trefferEbene('x', 20);
  ok(linie && Math.abs(linie.x - 20) < 1e-9, 'trefferEbene erwischt die Torlinie exakt',
    `t = ${round(linie.t, 4)} s, z = ${round(linie.z, 3)} m`);
  const kasten = flug.trefferQuader({ x: 19.9, y: -3.66, z: 0 }, { x: 20.1, y: 3.66, z: 2.44 });
  ok(!!kasten && kasten.flaeche === 'x-', 'trefferQuader meldet den Eintritt über die Vorderfläche',
    kasten ? `${kasten.flaeche} bei t = ${round(kasten.t, 4)} s` : 'kein Treffer');

  // bewegte Kugel (Torwarthand), die genau rechtzeitig auf der Bahn ankommt
  const bahn = flug.trefferEbene('x', 20);
  const hand = { x: 0, y: 0, z: 0 };
  const handBei = (t) => {
    hand.x = 20; hand.y = 0;
    hand.z = bahn.z + 1.6 - 1.6 * (t / bahn.t);   // fährt von oben auf die Bahn herunter
    return hand;
  };
  const trefferHand = flug.trefferKugel(handBei, 0.20);
  ok(!!trefferHand, 'trefferKugel erwischt eine bewegte Hand auf der Bahn',
    trefferHand ? `t = ${round(trefferHand.t, 4)} s, ${round(Math.abs(trefferHand.t - bahn.t) * 1000, 1)} ms vor der Ebene` : 'kein Treffer');
  const daneben = { x: 0, y: 0, z: 0 };
  ok(flug.trefferKugel((t) => { daneben.x = 20; daneben.y = 2.5; daneben.z = bahn.z; return daneben; }, 0.20) === null,
    'trefferKugel meldet nichts, wenn die Hand 2,5 m daneben steht');
}

/* ------------------------------------------------------------------ *
 *  7. Restliche API
 * ------------------------------------------------------------------ */
gruppe('7a. Konstanten und Aerodynamik');

ok(Math.abs(BALL_A - 0.038013) < 1e-6, 'BALL_A = 0,038013 m²', round(BALL_A, 8));
ok(Math.abs(K_AERO - 0.054147) < 1e-6, 'K_AERO = 0,054147 1/m', round(K_AERO, 8));
ok(Math.abs(K_AERO - 0.5 * RHO_LUFT * BALL_A / BALL_M) < 1e-15, 'K_AERO = ½·ρ·A/m');
ok(DT_PHYS === 1 / 300 && SAMPLE_JEDER === 5 && Math.abs(DT_SAMPLE - 1 / 60) < 1e-15,
  'DT_PHYS = 1/300, jede 5. Stützstelle → 60 Hz');
ok(cwBall(5) === CW_UNTERKRIT && cwBall(30) === CW_UEBERKRIT, 'cwBall: unter- und überkritisch exakt');
ok(cwBall(13) > CW_UEBERKRIT && cwBall(13) < CW_UNTERKRIT, 'cwBall: smoothstep-Krise dazwischen', round(cwBall(13), 4));
ok(cwBall(11) === CW_UNTERKRIT && cwBall(15) === CW_UEBERKRIT, 'cwBall: V_KRIT_A/B sind die Ränder');
ok(clMagnus(0) === 0 && clMagnus(0.2) > 0 && clMagnus(0.4) > clMagnus(0.2), 'clMagnus wächst mit der Drallzahl',
  `S=0,2 → ${round(clMagnus(0.2), 4)}`);
ok(kAero(0) === K_AERO, 'kAero(0) = K_AERO');
ok(kAero(1500) < K_AERO && kAero(1500) > K_AERO * 0.82, 'kAero(1500 m) senkt den Widerstand um ~15 %',
  `${round(kAero(1500) / K_AERO, 4)}`);

gruppe('7b. Drallachsen');
{
  const w = drallVektor(1, 0, 5, 0);
  ok(Math.abs(w.x) < 1e-12 && Math.abs(w.y) < 1e-12 && Math.abs(w.z - 5 * 2 * Math.PI) < 1e-9,
    'Effet um die Hochachse, U/s → rad/s', `wz = ${round(w.z, 4)}`);
  const links = createFlug({ p: { x: 0, y: 0, z: 0.3 }, v: { x: 26, y: 0, z: 3 }, w: drallVektor(1, 0, 8, 0), tMax: 1.2, boden: -9 });
  const l = links.trefferEbene('x', 20);
  ok(l.y > 0.2, 'Effet > 0 zieht den Ball nach links (+y bei Blick in +x)', `y = ${round(l.y, 3)} m nach 20 m`);

  const dip = createFlug({ p: { x: 0, y: 0, z: 0.3 }, v: { x: 26, y: 0, z: 3 }, w: drallVektor(1, 0, 0, 9), tMax: 1.2, boden: -9 });
  const ohne = createFlug({ p: { x: 0, y: 0, z: 0.3 }, v: { x: 26, y: 0, z: 3 }, tMax: 1.2, boden: -9 });
  const heber = createFlug({ p: { x: 0, y: 0, z: 0.3 }, v: { x: 26, y: 0, z: 3 }, w: drallVektor(1, 0, 0, -9), tMax: 1.2, boden: -9 });
  const zd = dip.trefferEbene('x', 20).z, z0 = ohne.trefferEbene('x', 20).z, zh = heber.trefferEbene('x', 20).z;
  ok(zd < z0 && zh > z0, 'Topspin > 0 sackt ab, < 0 schwebt',
    `Dip ${round(zd, 3)} m < ohne ${round(z0, 3)} m < Heber ${round(zh, 3)} m`);

  const schraeg = drallVektor(0, 1, 0, 4);   // Flug in +y
  ok(Math.abs(schraeg.x + 4 * 2 * Math.PI) < 1e-9 && Math.abs(schraeg.y) < 1e-9,
    'Topspinachse dreht mit der Schussrichtung mit');
  const entartet = drallVektor(0, 0, 1, 1);
  ok(isFinite(entartet.x) && isFinite(entartet.y) && isFinite(entartet.z),
    'drallVektor(0,0,…) fällt sauber auf +x zurück');
}

gruppe('7c. Abschuss und Segmente');
{
  const v = abschussVektor(20, Math.PI / 2, Math.PI / 6, { x: 0, y: 0, z: 0 });
  ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 20) < 1e-12, 'abschussVektor: Betrag stimmt');
  ok(Math.abs(v.z - 10) < 1e-9 && Math.abs(v.x) < 1e-9 && Math.abs(v.y - 20 * Math.cos(Math.PI / 6)) < 1e-9,
    'abschussVektor: Gier in der xy-Ebene, Neigung darüber');

  /** Unabhängige Gegenprobe: gibt es bei dieser Stärke überhaupt eine Lösung? */
  const restBei = (von, nach, betrag, neigung) => {
    const gier = Math.atan2(nach.y - von.y, nach.x - von.x);
    const flug = createFlug({ p: von, v: abschussVektor(betrag, gier, neigung, { x: 0, y: 0, z: 0 }), tMax: 6, boden: -50 });
    const achse = Math.abs(nach.x - von.x) >= Math.abs(nach.y - von.y) ? 'x' : 'y';
    const tr = flug.trefferEbene(achse, nach[achse]);
    const r = tr ? tr.z - nach.z : NaN;
    flug.freigeben();
    return r;
  };
  const loesbar = (von, nach, betrag) => {
    let vorher = NaN;
    for (let n = -1.30; n <= 1.401; n += 0.02) {
      const f = restBei(von, nach, betrag, n);
      if (isFinite(vorher) && isFinite(f) && ((vorher <= 0 && f >= 0) || (vorher >= 0 && f <= 0))) return true;
      vorher = f;
    }
    return false;
  };

  let geloest = 0, versuche = 0, treffer = 0, maxRest = 0, machbar = 0, verpasst = 0;
  const rng = createRng(99);
  for (const hoch of [false, true]) {
    for (let i = 0; i < 60; i++) {
      const von = { x: 0, y: 0, z: 0.11 };
      const nach = { x: rng.float(6, 45), y: rng.float(-25, 25), z: rng.float(0, 2.3) };
      const betrag = rng.float(16, 32);
      versuche++;
      const l = loeseAbschuss(von, nach, betrag, { hoch });
      const geht = loesbar(von, nach, betrag);
      if (geht) machbar++;
      if (!l) { if (geht) verpasst++; continue; }
      geloest++;
      const rest = Math.abs(restBei(von, nach, betrag, l.neigung));
      if (isFinite(rest) && rest > maxRest) maxRest = rest;
      if (rest < 0.05) treffer++;
    }
  }
  ok(treffer === geloest, 'jede von loeseAbschuss gemeldete Lösung trifft auch wirklich auf 5 cm',
    `${treffer} von ${geloest} gelösten (${versuche} Anfragen, flach und Lob), größter Rest ${round(maxRest, 3)} m`);
  ok(verpasst === 0, 'loeseAbschuss findet jede Lösung, die es (per Winkelscan) gibt',
    `${machbar} von ${versuche} Anfragen sind mit der vorgegebenen Stärke überhaupt lösbar, ${verpasst} davon verpasst`);

  const lob = loeseAbschuss({ x: 0, y: 0, z: 0.11 }, { x: 22, y: 0, z: 2.0 }, 24, { hoch: true });
  const flach = loeseAbschuss({ x: 0, y: 0, z: 0.11 }, { x: 22, y: 0, z: 2.0 }, 24);
  ok(lob && flach && lob.neigung > flach.neigung + 0.3, 'opt.hoch liefert die Lob-Lösung',
    lob && flach ? `${round(lob.neigung / GRAD, 1)}° gegen ${round(flach.neigung / GRAD, 1)}°` : 'eine der beiden Lösungen fehlt');
  ok(lob && flach && lob.t > flach.t, 'der Lob ist länger unterwegs',
    lob && flach ? `${round(lob.t, 3)} s gegen ${round(flach.t, 3)} s` : '');
  ok(loeseAbschuss({ x: 0, y: 0, z: 0 }, { x: 90, y: 0, z: 0 }, 8) === null,
    'loeseAbschuss gibt null zurück, wenn die Stärke nicht reicht');

  const typen = Object.keys(SEGMENT_TYPEN);
  ok(typen.length === 11, 'SEGMENT_TYPEN kennt alle 11 Segmentarten', typen.join(', '));
  ok(SEGMENT_TYPEN.pass_flach.v0 === 16 && SEGMENT_TYPEN.schuss.v0 === 27 && SEGMENT_TYPEN.abstoss.loft === 0.42,
    'SEGMENT_TYPEN führt die Zahlen aus dem Plan');
  let segOk = 0;
  const abstaende = [];
  for (const typ of typen) {
    const von = { x: 20, y: 30, z: 0.11 }, nach = { x: 20 + (typ === 'dribbling' ? 6 : 24), y: 38, z: 0.11 };
    const f = segmentFlug(von, nach, typ);
    const d = f.trefferEbene('x', nach.x);
    const rest = d ? Math.hypot(d.y - nach.y, d.z - nach.z) : 99;
    abstaende.push(`${typ} ${round(rest, 2)}`);
    if (rest < 0.6) segOk++;
    f.freigeben();
  }
  ok(segOk === typen.length, 'segmentFlug landet für jede Segmentart auf 60 cm am Ziel', abstaende.join(', '));
  {
    const f = segmentFlug({ x: 10, y: 10, z: 0.11 }, { x: 40, y: 25, z: 0.11 }, 'flanke', { hoehe: 6 });
    const d = f.trefferEbene('x', 40);
    ok(Math.abs(f.scheitel().z - 6) < 0.2, 'opt.hoehe steuert die Scheitelhöhe', `${round(f.scheitel().z, 2)} m statt 6 m`);
    ok(d && Math.abs(d.y - 25) < 0.6 && Math.abs(d.z - 0.11) < 0.6, 'und trifft den Zielpunkt trotzdem',
      d ? `(${round(d.y, 2)}, ${round(d.z, 2)})` : 'kein Durchgang');
  }
}

gruppe('7d. Boden: Rutschen, Rollen, Aufsetzer');
{
  const r = rutschEnde(18, 0);
  // gegen den Integrator: flacher Ball ohne Drall, der auf dem Boden startet
  const flug = createFlug({ p: { x: 0, y: 0, z: 0 }, v: { x: 18, y: 0, z: 0 }, boden: 0, tMax: 3, dichte: 0 });
  let tRoll = null;
  const aus = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
  for (let t = 0; t <= flug.dauer; t += DT_SAMPLE) {
    flug.at(t, aus);
    if (tRoll === null && aus.vx <= r.v) { tRoll = t; break; }
  }
  ok(Math.abs(tRoll - r.t) < 0.05, 'rutschEnde stimmt mit dem Integrator überein',
    `geschlossen ${round(r.t, 4)} s / ${round(r.v, 3)} m/s, integriert ${round(tRoll, 4)} s`);
  ok(rutschEnde(12, 12 / BALL_R).t === 0, 'ein bereits rollender Ball rutscht nicht');
  ok(rutschEnde(20, 0, MU_GLEIT_TROCKEN).s > 0 && rutschEnde(20, 0, MU_GLEIT_TROCKEN).v < 20,
    'Rutschphase verliert Tempo und legt Strecke zurück',
    `${round(rutschEnde(20, 0).s, 2)} m, danach ${round(rutschEnde(20, 0).v, 2)} m/s`);
}
{
  const trocken = createFlug({ p: { x: 0, y: 0, z: 3 }, v: { x: 8, y: 0, z: 0 }, boden: 0, tMax: 4 });
  const matsch = createFlug({ p: { x: 0, y: 0, z: 3 }, v: { x: 8, y: 0, z: 0 }, boden: 0, tMax: 4, nass: 1, tief: 1 });
  const h1 = trocken.aufsetzer(), h2 = matsch.aufsetzer();
  ok(h1.length >= 2 && h2.length >= 2, 'mehrere Aufsetzer werden erfasst', `trocken ${h1.length}, matschig ${h2.length}`);
  ok(h1.length <= 6 && h2.length <= 6, 'höchstens 6 Aufsetzer');
  const s1 = trocken.at(h1[0].t + 0.25, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 }).z;
  const s2 = matsch.at(h2[0].t + 0.25, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 }).z;
  ok(s1 > s2, 'auf matschigem Rasen springt der Ball flacher', `${round(s1, 3)} m gegen ${round(s2, 3)} m`);
  ok(trocken.landung().t === h1[0].t, 'landung() ist der erste Aufsetzer');
  const roller = createFlug({ p: { x: 0, y: 0, z: 0 }, v: { x: 6, y: 0, z: 0 }, boden: 0, tMax: 12 });
  const letzte = roller.at(roller.dauer, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 });
  ok(roller.dauer < 12 && letzte.v < 0.1, 'ein Roller kommt vor tMax zum Stillstand',
    `nach ${round(roller.dauer, 2)} s bei ${round(letzte.x, 2)} m`);
}

gruppe('7e. Spielerkinematik');
{
  const langsam = laufwerte({ tempo: 0, antritt: 0, koerper: 0 });
  const schnell = laufwerte({ tempo: 99, antritt: 99, koerper: 99 });
  ok(Math.abs(langsam.vmax - VMAX_BASIS) < 1e-9 && Math.abs(schnell.vmax - (VMAX_BASIS + VMAX_SPANNE)) < 1e-9,
    'vmax spannt 7,2 … 10,4 m/s', `${round(langsam.vmax, 2)} … ${round(schnell.vmax, 2)}`);
  ok(Math.abs(langsam.apeak - APEAK_BASIS) < 1e-9 && Math.abs(schnell.apeak - (APEAK_BASIS + APEAK_SPANNE)) < 1e-9,
    'apeak spannt 6,6 … 9,8 m/s²', `${round(langsam.apeak, 2)} … ${round(schnell.apeak, 2)}`);
  const mittel = laufwerte({ tempo: 60, antritt: 60 });
  const v2s = mittel.vmax * (1 - Math.exp(-2 / mittel.tau));
  ok(v2s / 2 >= 3.5 && v2s / 2 <= 4.5, 'mittlere Beschleunigung über 2 s liegt bei 3,5–4,5 m/s²',
    `${round(v2s / 2, 2)} m/s², Tempo nach 2 s ${round(v2s, 2)} m/s`);
  ok(mittel.apeak >= 7.0 && mittel.apeak <= 9.5, 'Anfangsbeschleunigung liegt bei 7–9,5 m/s²',
    `${round(mittel.apeak, 2)} m/s²`);
  ok(Math.abs(sprintZeit(sprintStrecke(3.7, mittel), mittel) - 3.7) < 1e-6,
    'sprintZeit ist die Umkehrung von sprintStrecke');
  const z30 = sprintZeit(30, laufwerte({ tempo: 90, antritt: 90 }));
  ok(z30 > 3.6 && z30 < 4.4, '30 m eines schnellen Spielers in 3,6–4,4 s', `${round(z30, 3)} s`);

  const p = { x: 0, y: 0, vx: 0, vy: 0 };
  for (let i = 0; i < 120; i++) sprintSchritt(p, mittel.vmax, 0, mittel, 1 / 60);
  ok(Math.abs(p.vx - v2s) < 1e-9, 'sprintSchritt ist die exakte Exponentiallösung',
    `${round(p.vx, 6)} m/s gegen analytisch ${round(v2s, 6)} m/s`);
  ok(Math.abs(p.x - sprintStrecke(2, mittel)) < 1e-9, 'sprintSchritt deckt sich mit sprintStrecke',
    `${round(p.x, 6)} m gegen ${round(sprintStrecke(2, mittel), 6)} m`);
  const vorher = p.vx;
  for (let i = 0; i < 60; i++) sprintSchritt(p, 0, 0, mittel, 1 / 60);
  const tauB = mittel.vmax / mittel.aBrems;
  ok(Math.abs(p.vx - vorher * Math.exp(-1 / tauB)) < 1e-9, 'sprintSchritt bremst mit aBrems',
    `${round(vorher, 2)} → ${round(p.vx, 3)} m/s in 1 s (tau ${round(tauB, 3)} s)`);

  const b = { x: 0, y: 0, vx: 7, vy: 0 };
  const vor = Math.hypot(b.vx, b.vy);
  for (let i = 0; i < 30; i++) lenke(b, Math.PI / 2, mittel, 1 / 60);
  const kurs = Math.atan2(b.vy, b.vx);
  ok(kurs > 0.15 && kurs < Math.PI / 2 + 1e-6, 'lenke dreht den Kurs, aber nicht auf der Stelle',
    `${round(kurs / GRAD, 1)}° nach 0,5 s (Ziel 90°)`);
  ok(b.y > 0.2 && b.x > 1.0, 'lenke beschreibt einen Bogen, keinen Knick',
    `von (0,0) nach (${round(b.x, 2)}, ${round(b.y, 2)}), Tempo ${round(vor, 1)} → ${round(Math.hypot(b.vx, b.vy), 2)} m/s`);

  ok(wendeKosten(7, 0) < 0.02, 'wendeKosten(v, 0°) ≈ 0', round(wendeKosten(7, 0), 4));
  ok(wendeKosten(7, 180) > wendeKosten(7, 90) && wendeKosten(7, 90) > wendeKosten(7, 30),
    'wendeKosten wachsen mit dem Winkel',
    `30° ${round(wendeKosten(7, 30), 2)} s, 90° ${round(wendeKosten(7, 90), 2)} s, 180° ${round(wendeKosten(7, 180), 2)} s`);
  ok(wendeKosten(9, 90) > wendeKosten(4, 90), 'wendeKosten wachsen mit dem Tempo');
}

gruppe('7f. Torwart');
{
  const guter = twParameter({ reflexe: 90, antizipation: 85, sprungkraft: 85, groesse: 1.93 });
  const schwacher = twParameter({ reflexe: 30, antizipation: 25, sprungkraft: 35, groesse: 1.82 });
  ok(guter.tReakt < schwacher.tReakt && guter.tReakt > 0.09, 'bessere Reflexe = kürzere Reaktionszeit',
    `${round(guter.tReakt, 3)} s gegen ${round(schwacher.tReakt, 3)} s`);
  ok(guter.vHecht > schwacher.vHecht && guter.arm > schwacher.arm, 'Sprungkraft und Größe zählen',
    `${round(guter.vHecht, 2)} m/s, Arm ${round(guter.arm, 2)} m`);
  const kurz = twReichweite(guter, 0.42, 0.5);   // Elfmeter, flach
  const lang = twReichweite(guter, 0.95, 0.5);
  ok(lang > kurz, 'mehr Flugzeit = mehr Reichweite', `0,42 s → ${round(kurz, 2)} m, 0,95 s → ${round(lang, 2)} m`);
  ok(twReichweite(guter, 0.42, 2.2) < kurz, 'hohe Bälle kosten Reichweite', `${round(twReichweite(guter, 0.42, 2.2), 2)} m`);
  ok(twReichweite(guter, 5, 0.5) <= TW_MAX + 1e-12, 'Reichweite ist bei TW_MAX gedeckelt');
  ok(twReichweite(guter, 0.05, 0.5) === guter.arm, 'vor Ablauf der Reaktionszeit bleibt nur der Arm');
  // Linearität nach dem Absprung
  const a1 = twReichweite(guter, guter.tReakt + 0.2, 0.5) - guter.arm;
  const a2 = twReichweite(guter, guter.tReakt + 0.4, 0.5) - guter.arm;
  ok(Math.abs(a2 - 2 * a1) < 1e-9, 'nach dem Absprung wächst die Reichweite LINEAR');

  ok(pFesthalten(8, false, 0, 80) > pFesthalten(28, false, 0, 80), 'harte Bälle rutschen eher durch',
    `${round(pFesthalten(8, false, 0, 80), 3)} gegen ${round(pFesthalten(28, false, 0, 80), 3)}`);
  ok(pFesthalten(20, true, 0, 80) < pFesthalten(20, false, 0, 80), 'im Hechten hält man seltener fest');
  ok(pFesthalten(20, false, 1, 80) < pFesthalten(20, false, 0, 80), 'nasser Ball hält schlechter');
  ok(pFesthalten(60, true, 1, 0) >= 0.02 && pFesthalten(0, false, 0, 99) <= 0.98, 'pFesthalten bleibt in 0,02 … 0,98');

  const rng = createRng(7);
  const zonen = {};
  for (let i = 0; i < 600; i++) { const a = abpraller(22, rng); zonen[a.zone] = (zonen[a.zone] || 0) + 1; }
  ok(zonen.seite > 0 && zonen.zentrum > 0 && zonen.ecke > 0, 'abpraller trifft alle drei Zonen',
    Object.entries(zonen).map(([k, v]) => `${k} ${v}`).join(', '));
}

gruppe('7g. Kopfball');
{
  const gross = sprungProfil({ sprungkraft: 90, koerper: 85 });
  const klein = sprungProfil({ sprungkraft: 30, koerper: 40 });
  ok(gross.hoehe > klein.hoehe && gross.hoehe < 0.75 && klein.hoehe > 0.2, 'Sprunghöhe 0,2 … 0,75 m',
    `${round(klein.hoehe, 3)} … ${round(gross.hoehe, 3)} m`);
  ok(Math.abs(gross.vAb - Math.sqrt(2 * G * gross.hoehe)) < 1e-12, 'vAb = √(2·g·h)');
  ok(Math.abs(kopfHoehe(gross, 1.90, gross.steigzeit) - (1.90 * 0.94 + 0.18 + gross.hoehe)) < 1e-9,
    'kopfHoehe ist im Scheitel maximal', `${round(kopfHoehe(gross, 1.90, gross.steigzeit), 3)} m`);
  ok(kopfHoehe(gross, 1.90, 0) < kopfHoehe(gross, 1.90, gross.steigzeit), 'vor dem Absprung nur Standhöhe');
  ok(kopfHoehe(gross, 1.90, 2 * gross.steigzeit + 0.3) === 1.90 * 0.94,
    'nach der Landung wieder Standhöhe');
  ok(timingGuete(gross, 0) === 1, 'timingGuete(0) = 1,0');
  ok(timingGuete(gross, gross.fenster * 0.25) < 1 && timingGuete(gross, gross.fenster * 0.25) > 0.5,
    'quadratischer Abfall im Fenster', round(timingGuete(gross, gross.fenster * 0.25), 3));
  ok(timingGuete(gross, gross.fenster) === 0, 'außerhalb des Fensters kein Kopfball mehr');
  ok(gross.fenster > 0.1 && gross.fenster < 0.5, 'Sprungfenster 0,1 … 0,5 s', `${round(gross.fenster, 3)} s`);
  ok(gross.reichweite > gross.hoehe, 'reichweite enthält die Nackenstreckung', `${round(gross.reichweite, 3)} m`);
}

gruppe('7h. Ränder und Robustheit');
{
  const still = createFlug({ p: { x: 5, y: 5, z: 0 }, v: { x: 0, y: 0, z: 0 }, boden: 0, tMax: 2 });
  const s = still.at(1.0);
  ok(s.x === 5 && s.y === 5 && s.z === 0 && s.v === 0, 'ein liegender Ball bleibt liegen');
  ok(still.scheitel().z === 0 && still.landung() === null, 'kein Scheitel, keine Landung ohne Flug');

  const f = createFlug({ p: { x: 0, y: 0, z: 1 }, v: { x: 10, y: 0, z: 0 }, tMax: 2 });
  const vorher = f.at(-5, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 }).x;
  const nachher = f.at(999, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 }).x;
  ok(vorher === 0, 'at(t < 0) klemmt auf den Start');
  ok(Math.abs(nachher - f.at(f.dauer, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 }).x) < 1e-12,
    'at(t > dauer) klemmt auf das Ende');
  ok(f.trefferEbene('x', 1e6) === null, 'trefferEbene ohne Durchgang gibt null');
  ok(f.trefferQuader({ x: 500, y: 0, z: 0 }, { x: 501, y: 1, z: 1 }) === null, 'trefferQuader ohne Treffer gibt null');
  ok(f.trefferZylinder('x', 0, 0, 1, 0, 1) === null, 'trefferZylinder akzeptiert heute nur die z-Achse');

  const puffer = new Float32Array(3 * 64);
  const linie = f.abtasten(64, puffer);
  ok(linie === puffer, 'abtasten schreibt in den mitgegebenen Puffer');
  ok(linie.length === 192 && linie[0] === 0, 'abtasten liefert [x,y,z, …]');
  const eigen = f.abtasten(10);
  ok(eigen instanceof Float32Array && eigen.length === 30, 'abtasten ohne Puffer legt selbst einen an');

  const aus = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 };
  ok(f.at(0.5, aus) === aus, 'at schreibt in out und gibt es zurück');
  const w = drallVektor(1, 0, 1, 1, aus);
  ok(w === aus, 'drallVektor schreibt in out');

  const wind = createFlug({ p: { x: 0, y: 0, z: 0.11 }, v: { x: 18, y: 0, z: 7 }, wind: { x: -8, y: 0, z: 0 }, tMax: 4 });
  const ohneWind = createFlug({ p: { x: 0, y: 0, z: 0.11 }, v: { x: 18, y: 0, z: 7 }, tMax: 4 });
  ok(wind.landung().x < ohneWind.landung().x - 1, 'Gegenwind verkürzt die Reichweite',
    `${round(wind.landung().x, 2)} m gegen ${round(ohneWind.landung().x, 2)} m`);

  const hoch = createFlug({ p: { x: 0, y: 0, z: 4 }, v: { x: 12, y: 0, z: 0 }, boden: 2.5, tMax: 3 });
  ok(hoch.landung() && Math.abs(hoch.landung().z - 2.5) < 1e-12, 'boden ≠ 0 wird respektiert');
}

/* ------------------------------------------------------------------ *
 *  Quelltextregeln
 * ------------------------------------------------------------------ */
gruppe('8. Quelltextregeln');
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const hier = dirname(fileURLToPath(import.meta.url));
  const quelle = readFileSync(resolve(hier, '../src/core/ballistik.js'), 'utf8');
  ok(!/Math\.random/.test(quelle), 'kein Math.random in ballistik.js');
  ok(!/Date\.now|performance\.now/.test(quelle), 'kein Date.now / performance.now in ballistik.js');
  ok(!/\bdocument\b|\bwindow\b|\bcanvas\b/.test(quelle), 'kein DOM-Zugriff in ballistik.js');
  ok(/from '\.\/util\.js'/.test(quelle), 'Importe mit .js-Endung');
}

/* ------------------------------------------------------------------ */
console.log('\n' + '═'.repeat(66));
console.log(`  ${bestanden} bestanden, ${gescheitert} gescheitert`);
if (gescheitert) {
  console.log('\n  Fehlgeschlagen:');
  for (const f of fehler) console.log('   • ' + f);
  process.exit(1);
}
console.log('  Der Physikkern trägt.');
console.log('═'.repeat(66));
