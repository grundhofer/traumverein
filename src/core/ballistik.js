/**
 * core/ballistik.js — gemeinsamer Physikkern für alle Ballszenen.
 *
 * Koordinaten: generisches rechtshändiges System {x, y, z} in METERN, z ist immer
 * die Höhe über dem Boden. Das Modul kennt KEINE Feldsemantik — jede Szene belegt
 * x/y selbst (Elfmeter: x seitlich, y Tiefe zur Torlinie; Bühne: Weltkoordinaten
 * nach Vertrag §1).
 *
 * Der Ball ist ein PUNKT. `boden` ist die Höhe, auf der dieser Punkt zur Ruhe kommt.
 * Wer mit dem Ballradius rechnen will, übergibt `boden = BALL_R`.
 *
 * Zufall: Dieses Modul zieht NIE selbst. `rng` erscheint ausschließlich als
 * Parameter von `abpraller()` und wird dort genau einmal gezogen.
 *
 * ---------------------------------------------------------------------------
 * INTEGRATOR — und warum er so aussieht
 * ---------------------------------------------------------------------------
 * Schrittweite: genau eine, DT_PHYS = 1/300 s. `createFlug()` integriert EINMAL
 * komplett durch, speichert jede 5. Stützstelle (60 Hz) und interpoliert dazwischen
 * linear. In der rAF-Schleife läuft kein Integrator.
 *
 *   v(n+1) = v(n) + a(p(n), v(n)) · dt          semi-implizites (symplektisches) Euler
 *   p(n+1) = p(n) + ½·(v(n) + v(n+1)) · dt      = p(n) + v(n)·dt + ½·a·dt²
 *
 * Der Umbauplan nennt in Abschnitt 4 zwei Dinge: „semi-implizites (symplektisches)
 * Euler" (Schrittweite) und „Velocity-Verlet-artig" (createFlug). Das ist derselbe
 * Schritt, wenn man ihn so schreibt: die GESCHWINDIGKEIT läuft semi-implizit-Euler,
 * der ORTSSCHRITT nimmt die Verlet-Form. Kosten: unverändert eine
 * Beschleunigungsauswertung je Substep. Nachgemessen (Werte siehe unten) war das
 * nötig — das reine `p += v(n+1)·dt` verfehlt FLUGZEIT_REFERENZ auf der Reichweite
 * um bis zu 7,3 cm und damit die geforderten 3 cm.
 *
 * ---------------------------------------------------------------------------
 * FLUGZEIT_REFERENZ — nachgerechnet, nicht übernommen
 * ---------------------------------------------------------------------------
 * Die Tabelle am Ende dieser Datei stammt aus dem Umbauplan. Sie wurde gegen eine
 * unabhängige Integration derselben ODE geprüft (tools/test-ballistik.js, Gruppe 1):
 *
 *   • Mit dt → 0 (dt = 1/24000) liefert dieses Modell für die drei Szenarien mit
 *     vorgegebenem Abschusswinkel exakt die Referenz-Reichweiten:
 *       flanke21_30grad  30,5175 m  (Referenz 30,5)
 *       flanke23_35grad  37,0455 m  (Referenz 37,0)
 *       abstoss25_40grad 42,6043 m  (Referenz 42,6)
 *     Die Referenz IST also die dt→0-Lösung genau dieser Gleichung mit genau diesen
 *     Konstanten. Damit sind K_AERO, CW_*, V_KRIT_*, CL_* und SPIN_TAU bestätigt.
 *   • Für die vier Szenarien ohne genannten Winkel (elfmeter28, vollspann32,
 *     effet24, topspin26) nennt der Plan Abschusswinkel und Drall nicht. Sie wurden
 *     aus der Referenz zurückgerechnet; es existiert je Szenario genau ein
 *     Parameterpaar, das alle drei Spalten gleichzeitig auf < 1,5 cm trifft
 *     (Werte in tools/test-ballistik.js dokumentiert). Auch das bestätigt die
 *     Referenz, nicht nur den Integrator.
 *
 * ENTSCHEIDUNG: Die Referenz bleibt unverändert. Abweichend ist einzig der
 * Diskretisierungsfehler von DT_PHYS = 1/300, und der bleibt mit dem obigen
 * Ortsschritt unter 3 cm. Die Toleranz im Prüfstand wurde NICHT aufgeweicht.
 */

import { clamp } from './util.js';

/* ------------------------------------------------------------------ *
 *  Konstanten
 * ------------------------------------------------------------------ */

export const G = 9.81;                 // m/s²
export const RHO_LUFT = 1.225;         // kg/m³ (Meereshöhe, 15 °C)
export const BALL_M = 0.430;           // kg
export const BALL_R = 0.11;            // m
export const BALL_A = Math.PI * BALL_R * BALL_R;          // 0.038013 m²
export const K_AERO = 0.5 * RHO_LUFT * BALL_A / BALL_M;   // 0.054147 1/m

export const CW_UNTERKRIT = 0.47;      // unterhalb der Widerstandskrise
export const CW_UEBERKRIT = 0.20;      // oberhalb
export const V_KRIT_A = 11.0;          // m/s, Beginn des smoothstep-Übergangs
export const V_KRIT_B = 15.0;          // m/s, Ende
export const CL_A = 2.022;             // Cl = 1/(A + B/S)
export const CL_B = 0.981;
export const SPIN_TAU = 18.0;          // s, Drallzerfall

export const E_TROCKEN = 0.58;         // vertikale Restitution
export const E_NASS = 0.46;
export const E_MATSCH = 0.38;
export const MU_PRALL = 0.45;          // Coulomb-Reibung während des Bodenkontakts
export const MU_GLEIT_TROCKEN = 0.45;  // Rutschphase
export const MU_GLEIT_NASS = 0.30;
export const MU_ROLL_KURZ = 0.06;      // Rollphase
export const MU_ROLL_TIEF = 0.11;
export const BODEN_LUFT_FAKTOR = 0.5;  // halbierter Widerstand in Bodennähe

export const DT_PHYS = 1 / 300;
export const DT_MAX = 0.10;
export const SAMPLE_JEDER = 5;

/** Abstand zweier gespeicherter Stützstellen: 1/60 s. */
export const DT_SAMPLE = DT_PHYS * SAMPLE_JEDER;

/* Spieler */
export const VMAX_BASIS = 7.2;         // tempo 0..99  →  7.2 … 10.4 m/s
export const VMAX_SPANNE = 3.2;
export const APEAK_BASIS = 6.6;        // antritt 0..99 →  6.6 …  9.8 m/s²
export const APEAK_SPANNE = 3.2;
export const A_BREMS = 5.5;
export const A_BREMS_HART = 8.0;
export const A_LATERAL = 5.0;
export const T_STEMM = 0.18;
export const T_REAKT_NORMAL = 0.22;
export const T_REAKT_ANTIZ = 0.15;

/* Torwart */
export const TW_ARM = 1.05;
export const TW_T_ABSTOSS = 0.12;
export const TW_V_HECHT = 3.9;
export const TW_T_REAKT = 0.20;
export const TW_HOCH_FAKTOR = 0.65;
export const TW_MAX = 3.30;

/* Interne Schwellen (nicht Teil der API des Umbauplans) */
const V_HAFT = 0.30;          // m/s: darunter bleibt der Ball nach dem Prall liegen
const V_STILL = 0.05;         // m/s: darunter gilt Stillstand
const SCHLUPF_GRENZE = 0.05;  // m/s: darunter rollt der Ball statt zu rutschen
const TRAEGHEIT = 2 / 3;      // Hohlkugel: I = 2/3 · m · R²
const TANGENTIAL_MASSE = 1 / (1 + 1 / TRAEGHEIT);   // 0.4 — effektive Masse am Kontaktpunkt
const MAX_AUFSETZER = 6;
const TAU_KREIS = Math.PI * 2;

/* ------------------------------------------------------------------ *
 *  Aerodynamik
 * ------------------------------------------------------------------ */

function smoothstep(a, b, v) {
  if (b === a) return v < a ? 0 : 1;
  let t = (v - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** Widerstandsbeiwert mit smoothstep-Übergang durch die Widerstandskrise. */
export function cwBall(v) {
  return CW_UNTERKRIT + (CW_UEBERKRIT - CW_UNTERKRIT) * smoothstep(V_KRIT_A, V_KRIT_B, v);
}

/** Auftriebsbeiwert des Magnus-Effekts. S = R·ω/v (dimensionslose Drallzahl). */
export function clMagnus(S) {
  if (!(S > 0)) return 0;
  return 1 / (CL_A + CL_B / S);
}

/**
 * K_AERO mit barometrischer Höhenkorrektur (ISA-Troposphäre).
 * hoeheM in Metern über NN; 0 gibt exakt K_AERO zurück.
 */
export function kAero(hoeheM = 0) {
  if (!hoeheM) return K_AERO;
  const f = 1 - 2.25577e-5 * hoeheM;
  return K_AERO * (f > 0 ? Math.pow(f, 4.2559) : 0);
}

/* ------------------------------------------------------------------ *
 *  Drall
 * ------------------------------------------------------------------ */

/**
 * Drallvektor in rad/s aus der Abschussrichtung und zwei Umdrehungszahlen (U/s).
 *
 *   effetUps  > 0 : Ball zieht nach links (aus Schützensicht, Blick entlang dir)
 *   topspinUps> 0 : Ball sackt ab (Dip);  < 0 : schwebt (Chip/Heber)
 *
 * Herleitung der Achsen: Magnusbeschleunigung ∝ ω × v. Für dir = +x liefert
 * ω = +z ein a ∝ ẑ × x̂ = +ŷ (links), ω = +y ein a ∝ ŷ × x̂ = −ẑ (Dip).
 */
export function drallVektor(dirX, dirY, effetUps, topspinUps, out) {
  const o = out || { x: 0, y: 0, z: 0 };
  let dx = dirX, dy = dirY;
  const n = Math.sqrt(dx * dx + dy * dy);
  if (n > 1e-9) { dx /= n; dy /= n; } else { dx = 1; dy = 0; }
  const wt = (topspinUps || 0) * TAU_KREIS;
  o.x = -dy * wt;
  o.y = dx * wt;
  o.z = (effetUps || 0) * TAU_KREIS;
  return o;
}

/* ------------------------------------------------------------------ *
 *  Modul-Pool
 *
 *  Der Pool hält Stützstellenpuffer und Flug-Objekte. Er wird NUR über
 *  flug.freigeben() gespeist — ein nicht freigegebener Flug bleibt für immer
 *  gültig. Damit kann kein Paket versehentlich auf einen recycelten Puffer
 *  schauen. In der rAF-Schleife wird ohnehin nichts erzeugt: at(), abtasten()
 *  und die Streufunktionen schreiben in mitgegebene out-Objekte.
 * ------------------------------------------------------------------ */

const _fluegeFrei = [];
const _beschl = new Float64Array(3);   // Rückgabepuffer der Beschleunigung

/* ------------------------------------------------------------------ *
 *  Beschleunigung (Luftwiderstand + Magnus + Schwerkraft)
 * ------------------------------------------------------------------ */

function beschleunigung(vx, vy, vz, wx, wy, wz, windX, windY, windZ, k) {
  const rx = vx - windX, ry = vy - windY, rz = vz - windZ;
  const s = Math.sqrt(rx * rx + ry * ry + rz * rz);
  let ax = 0, ay = 0, az = -G;
  if (s > 1e-9 && k > 0) {
    const kd = k * cwBall(s) * s;
    ax -= kd * rx; ay -= kd * ry; az -= kd * rz;
    const wn = Math.sqrt(wx * wx + wy * wy + wz * wz);
    if (wn > 1e-9) {
      const f = k * clMagnus(BALL_R * wn / s) * s / wn;
      ax += f * (wy * rz - wz * ry);
      ay += f * (wz * rx - wx * rz);
      az += f * (wx * ry - wy * rx);
    }
  }
  _beschl[0] = ax; _beschl[1] = ay; _beschl[2] = az;
}

/* ------------------------------------------------------------------ *
 *  Flug
 * ------------------------------------------------------------------ */

class Flug {
  constructor() {
    this.puffer = null;      // Float64Array, je Stützstelle 6 Werte
    this.anzahl = 0;         // Anzahl Stützstellen
    this.dauer = 0;          // s
    this.boden = 0;
    this._out = leerZustand();
    this._sa = leerZustand();
    this._sb = leerZustand();
    this._aufsetzer = [];
    this._landung = null;
    this._scheitel = { t: 0, z: 0 };
    this._m0 = { x: 0, y: 0, z: 0 };
    this._m1 = { x: 0, y: 0, z: 0 };
  }

  /** Zustand zur Zeit t. Ohne `out` wird ein flugeigenes Objekt wiederverwendet. */
  at(t, out) {
    const o = out || this._out;
    const n = this.anzahl;
    const p = this.puffer;
    let tt = t < 0 ? 0 : t > this.dauer ? this.dauer : t;
    let f = tt / DT_SAMPLE;
    let i = f | 0;
    if (i >= n - 1) { i = n - 2; f = 1; } else { f -= i; }
    if (i < 0) { i = 0; f = 0; }
    const a = i * 6, b = a + 6;
    const g = 1 - f;
    o.x = p[a] * g + p[b] * f;
    o.y = p[a + 1] * g + p[b + 1] * f;
    o.z = p[a + 2] * g + p[b + 2] * f;
    o.vx = p[a + 3] * g + p[b + 3] * f;
    o.vy = p[a + 4] * g + p[b + 4] * f;
    o.vz = p[a + 5] * g + p[b + 5] * f;
    o.v = Math.sqrt(o.vx * o.vx + o.vy * o.vy + o.vz * o.vz);
    return o;
  }

  /** Erster Bodenkontakt oder null. */
  landung() { return this._landung; }

  /** Höchster Punkt der Bahn, exakt (nicht auf die Stützstellen gerastert). */
  scheitel() { return this._scheitel; }

  /** Alle Bodenkontakte, höchstens MAX_AUFSETZER. */
  aufsetzer() { return this._aufsetzer; }

  /**
   * Erster Durchgang durch die Ebene achse = wert.
   * Geprüft werden die SEGMENTE zwischen den Stützstellen — ein 30-m/s-Ball
   * springt sonst über die Torlinie hinweg.
   */
  trefferEbene(achse, wert, t0, t1) {
    const a = t0 === undefined ? 0 : t0;
    const b = t1 === undefined ? this.dauer : t1;
    const key = achse === 'x' ? 'x' : achse === 'y' ? 'y' : 'z';
    const sa = this._sa, sb = this._sb;
    let ta = a;
    while (ta < b - 1e-12) {
      const tb = naechsteGrenze(ta, b);
      this.at(ta, sa); this.at(tb, sb);
      const va = sa[key], vb = sb[key];
      if ((va <= wert && vb >= wert) || (va >= wert && vb <= wert)) {
        const d = vb - va;
        const u = Math.abs(d) < 1e-12 ? 0 : (wert - va) / d;
        const t = ta + (tb - ta) * u;
        return zustandBei(this, t);
      }
      ta = tb;
    }
    return null;
  }

  /**
   * Erste Berührung einer (bewegten) Kugel mit Radius r.
   * mittelFn(t) darf ein wiederverwendetes Objekt liefern — es wird sofort kopiert.
   */
  trefferKugel(mittelFn, r, t0, t1) {
    const a = t0 === undefined ? 0 : t0;
    const b = t1 === undefined ? this.dauer : t1;
    const sa = this._sa, sb = this._sb, m0 = this._m0, m1 = this._m1;
    const rr = r * r;
    let ta = a;
    while (ta < b - 1e-12) {
      const tb = naechsteGrenze(ta, b);
      this.at(ta, sa); this.at(tb, sb);
      let m = mittelFn(ta); m0.x = m.x; m0.y = m.y; m0.z = m.z;
      m = mittelFn(tb); m1.x = m.x; m1.y = m.y; m1.z = m.z;
      const px = sa.x - m0.x, py = sa.y - m0.y, pz = sa.z - m0.z;
      const dx = (sb.x - m1.x) - px, dy = (sb.y - m1.y) - py, dz = (sb.z - m1.z) - pz;
      const A = dx * dx + dy * dy + dz * dz;
      const B = 2 * (px * dx + py * dy + pz * dz);
      const C = px * px + py * py + pz * pz - rr;
      let u = -1;
      if (C <= 0) u = 0;
      else if (A > 1e-15) {
        const disk = B * B - 4 * A * C;
        if (disk >= 0) {
          const w = (-B - Math.sqrt(disk)) / (2 * A);
          if (w >= 0 && w <= 1) u = w;
        }
      }
      if (u >= 0) {
        const t = ta + (tb - ta) * u;
        const s = this.at(t, this._out);
        return { t, x: s.x, y: s.y, z: s.z };
      }
      ta = tb;
    }
    return null;
  }

  /**
   * Erster Eintritt in einen achsparallelen Quader (Slab-Verfahren je Segment).
   * `flaeche` ist eine von 'x-','x+','y-','y+','z-','z+'.
   */
  trefferQuader(min, max, t0, t1) {
    const a = t0 === undefined ? 0 : t0;
    const b = t1 === undefined ? this.dauer : t1;
    const sa = this._sa, sb = this._sb;
    let ta = a;
    while (ta < b - 1e-12) {
      const tb = naechsteGrenze(ta, b);
      this.at(ta, sa); this.at(tb, sb);
      let u0 = 0, u1 = 1, flaeche = null;
      const achsen = 'xyz';
      for (let k = 0; k < 3; k++) {
        const key = achsen[k];
        const p = sa[key], d = sb[key] - p;
        const lo = min[key], hi = max[key];
        if (Math.abs(d) < 1e-12) {
          if (p < lo || p > hi) { u0 = 1; u1 = 0; break; }
          continue;
        }
        let n0 = (lo - p) / d, n1 = (hi - p) / d, seite = key + '-';
        if (n0 > n1) { const h = n0; n0 = n1; n1 = h; seite = key + '+'; }
        if (n0 > u0) { u0 = n0; flaeche = seite; }
        if (n1 < u1) u1 = n1;
        if (u0 > u1) break;
      }
      if (u0 <= u1 && u1 >= 0 && u0 <= 1) {
        const u = u0 < 0 ? 0 : u0;
        const t = ta + (tb - ta) * u;
        const s = this.at(t, this._out);
        return { t, x: s.x, y: s.y, z: s.z, flaeche: flaeche || 'z-' };
      }
      ta = tb;
    }
    return null;
  }

  /**
   * Erster Treffer eines stehenden Zylinders um die z-Achse (Pfosten, Bein, Latte
   * hochkant). achse ist heute immer 'z'.
   */
  trefferZylinder(achse, mx, my, r, zMin, zMax, t0, t1) {
    if (achse !== 'z') return null;
    const a = t0 === undefined ? 0 : t0;
    const b = t1 === undefined ? this.dauer : t1;
    const sa = this._sa, sb = this._sb;
    const rr = r * r;
    let ta = a;
    while (ta < b - 1e-12) {
      const tb = naechsteGrenze(ta, b);
      this.at(ta, sa); this.at(tb, sb);
      const px = sa.x - mx, py = sa.y - my;
      const dx = sb.x - sa.x, dy = sb.y - sa.y;
      const A = dx * dx + dy * dy;
      const B = 2 * (px * dx + py * dy);
      const C = px * px + py * py - rr;
      const kandidaten = [];
      if (C <= 0) kandidaten.push(0);
      else if (A > 1e-15) {
        const disk = B * B - 4 * A * C;
        if (disk >= 0) {
          const w = (-B - Math.sqrt(disk)) / (2 * A);
          const w2 = (-B + Math.sqrt(disk)) / (2 * A);
          if (w >= 0 && w <= 1) kandidaten.push(w);
          else if (w < 0 && w2 >= 0 && w2 <= 1) kandidaten.push(0);
        }
      }
      for (const u of kandidaten) {
        const z = sa.z + (sb.z - sa.z) * u;
        if (z >= zMin && z <= zMax) {
          const t = ta + (tb - ta) * u;
          const s = this.at(t, this._out);
          return { t, x: s.x, y: s.y, z: s.z };
        }
      }
      ta = tb;
    }
    return null;
  }

  /** n Punkte [x,y,z, …] über die ganze Flugdauer, für Vorschau-Polylines. */
  abtasten(n, out) {
    const m = n | 0;
    const ziel = (out instanceof Float32Array && out.length >= m * 3) ? out : new Float32Array(m * 3);
    const s = this._sa;
    for (let i = 0; i < m; i++) {
      this.at(m === 1 ? 0 : this.dauer * i / (m - 1), s);
      ziel[i * 3] = s.x; ziel[i * 3 + 1] = s.y; ziel[i * 3 + 2] = s.z;
    }
    return ziel;
  }

  /** Rohe Stützstellen (je 6 Werte: x,y,z,vx,vy,vz). Nur lesen. */
  stuetzstellen() { return this.puffer.subarray(0, this.anzahl * 6); }

  /**
   * Gibt Puffer und Objekt an den Modul-Pool zurück. Optional; nie Pflicht.
   *
   * Doppelte Freigabe wird still verschluckt: Läge derselbe Flug zweimal im
   * Pool, lieferten zwei folgende createFlug()-Aufrufe DASSELBE Objekt, und der
   * zweite Aufrufer überschriebe dem ersten unbemerkt die Bahn. Genau diese
   * stille Datenverfälschung soll der Pool verhindern, nicht erzeugen.
   */
  freigeben() {
    if (this._imPool) return;
    this._imPool = true;
    this._landung = null;
    this._aufsetzer.length = 0;
    if (_fluegeFrei.length < 64) _fluegeFrei.push(this);
  }
}

function leerZustand() { return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, v: 0 }; }

/** Nächste Stützstellengrenze nach ta, gedeckelt auf b. */
function naechsteGrenze(ta, b) {
  const i = Math.floor(ta / DT_SAMPLE + 1e-9) + 1;
  const t = i * DT_SAMPLE;
  return t < b ? t : b;
}

function zustandBei(flug, t) {
  const s = flug.at(t, flug._out);
  return { t, x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz };
}

/* ------------------------------------------------------------------ *
 *  createFlug — integriert einmal komplett durch
 * ------------------------------------------------------------------ */

/**
 * init = { p:{x,y,z}, v:{x,y,z}, w?:{x,y,z}, wind?:{x,y,z},
 *          boden?=0, tMax?=4.0, nass?=0, tief?=0, dichte?=1 }
 *
 * nass/tief sind 0..1 und mischen Restitution und Reibung zwischen trocken,
 * nass und matschig. dichte multipliziert die Luftdichte (0 = Vakuum).
 */
export function createFlug(init) {
  const flug = _fluegeFrei.length ? _fluegeFrei.pop() : new Flug();
  flug._imPool = false;

  const p0 = init.p, v0 = init.v, w0 = init.w;
  const wind = init.wind;
  const windX = wind ? wind.x : 0, windY = wind ? wind.y : 0, windZ = wind ? wind.z : 0;
  const boden = init.boden === undefined ? 0 : init.boden;
  const tMax = init.tMax === undefined ? 4.0 : init.tMax;
  const nass = clamp(init.nass === undefined ? 0 : init.nass, 0, 1);
  const tief = clamp(init.tief === undefined ? 0 : init.tief, 0, 1);
  const dichte = init.dichte === undefined ? 1 : init.dichte;

  const k = K_AERO * dichte;
  const kBoden = k * BODEN_LUFT_FAKTOR;
  const eNass = E_TROCKEN + (E_NASS - E_TROCKEN) * nass;
  const eBasis = eNass + (E_MATSCH - eNass) * tief;
  const muGleit = MU_GLEIT_TROCKEN + (MU_GLEIT_NASS - MU_GLEIT_TROCKEN) * nass;
  const muRoll = MU_ROLL_KURZ + (MU_ROLL_TIEF - MU_ROLL_KURZ) * tief;
  const zerfall = Math.exp(-DT_PHYS / SPIN_TAU);
  const iFaktor = 1 / (TRAEGHEIT * BALL_R);   // dw = (r × J)/I → Betrag J/(I/R) = J/(TRAEGHEIT·m·R)

  const bloecke = Math.max(1, Math.ceil(tMax / DT_SAMPLE - 1e-9));
  const anzahl = bloecke + 1;
  if (!flug.puffer || flug.puffer.length < anzahl * 6) flug.puffer = new Float64Array(anzahl * 6);
  const buf = flug.puffer;

  flug.boden = boden;
  flug._aufsetzer.length = 0;
  flug._landung = null;

  let px = p0.x, py = p0.y, pz = p0.z < boden ? boden : p0.z;
  let vx = v0.x, vy = v0.y, vz = v0.z;
  let wx = w0 ? w0.x : 0, wy = w0 ? w0.y : 0, wz = w0 ? w0.z : 0;
  let amBoden = pz <= boden + 1e-9 && vz <= 0;
  if (amBoden) { pz = boden; vz = 0; }

  flug._scheitel.t = 0; flug._scheitel.z = pz;
  let scheitelGesetzt = false;

  buf[0] = px; buf[1] = py; buf[2] = pz; buf[3] = vx; buf[4] = vy; buf[5] = vz;

  let t = 0;
  let n = 1;

  for (let b = 0; b < bloecke; b++) {
    for (let s = 0; s < SAMPLE_JEDER; s++) {
      if (amBoden) {
        /* ---- Rutsch- und Rollphase ---------------------------------- */
        beschleunigung(vx, vy, 0, 0, 0, 0, windX, windY, windZ, kBoden);
        let ax = _beschl[0], ay = _beschl[1];
        // Schlupf am Kontaktpunkt: u = v + ω × (0,0,−R)
        const ux = vx - BALL_R * wy, uy = vy + BALL_R * wx;
        const un = Math.sqrt(ux * ux + uy * uy);
        if (un > SCHLUPF_GRENZE) {
          const f = muGleit * G;
          const rx = -f * ux / un, ry = -f * uy / un;   // Reibbeschleunigung
          ax += rx; ay += ry;
          // Reibmoment richtet den Drall aufs Rollen aus: dω = (r × F)/I, r = (0,0,−R)
          wx += ry * iFaktor * DT_PHYS;
          wy -= rx * iFaktor * DT_PHYS;
        } else {
          const vn = Math.sqrt(vx * vx + vy * vy);
          if (vn > 1e-9) { const f = muRoll * G; ax -= f * vx / vn; ay -= f * vy / vn; }
          wy = vx / BALL_R; wx = -vy / BALL_R;
        }
        let nvx = vx + ax * DT_PHYS, nvy = vy + ay * DT_PHYS;
        if (nvx * vx < 0 && Math.abs(vx) < 0.2) nvx = 0;
        if (nvy * vy < 0 && Math.abs(vy) < 0.2) nvy = 0;
        px += 0.5 * (vx + nvx) * DT_PHYS;
        py += 0.5 * (vy + nvy) * DT_PHYS;
        vx = nvx; vy = nvy; vz = 0; pz = boden;
      } else {
        /* ---- Flugphase ---------------------------------------------- */
        beschleunigung(vx, vy, vz, wx, wy, wz, windX, windY, windZ, k);
        const ax = _beschl[0], ay = _beschl[1], az = _beschl[2];
        const nvx = vx + ax * DT_PHYS, nvy = vy + ay * DT_PHYS, nvz = vz + az * DT_PHYS;
        const nx = px + 0.5 * (vx + nvx) * DT_PHYS;
        const ny = py + 0.5 * (vy + nvy) * DT_PHYS;
        const nz = pz + 0.5 * (vz + nvz) * DT_PHYS;

        if (!scheitelGesetzt && vz > 0 && nvz <= 0) {
          const a = (nvz - vz) / DT_PHYS;
          const tau = a < -1e-12 ? vz / -a : 0;
          const zs = pz + vz * tau + 0.5 * a * tau * tau;
          if (zs > flug._scheitel.z) { flug._scheitel.t = t + tau; flug._scheitel.z = zs; }
          scheitelGesetzt = true;
        } else if (!scheitelGesetzt && nz > flug._scheitel.z) {
          flug._scheitel.t = t + DT_PHYS; flug._scheitel.z = nz;
        }

        if (nz < boden) {
          /* ---- Bodenkontakt ---------------------------------------- */
          const dz = pz - nz;
          const u = dz > 1e-12 ? (pz - boden) / dz : 0;
          const cx = px + (nx - px) * u, cy = py + (ny - py) * u;
          let kvx = vx + (nvx - vx) * u, kvy = vy + (nvy - vy) * u;
          const kvz = vz + (nvz - vz) * u;
          const tKontakt = t + DT_PHYS * u;

          if (flug._aufsetzer.length < MAX_AUFSETZER) {
            const eintrag = { t: tKontakt, x: cx, y: cy, z: boden, vz: kvz };
            flug._aufsetzer.push(eintrag);
            if (!flug._landung) flug._landung = { t: tKontakt, x: cx, y: cy, z: boden };
          }

          const nvz2 = -eBasis * kvz;
          // Tangentialimpuls (Coulomb) am Kontaktpunkt
          const sx = kvx - BALL_R * wy, sy = kvy + BALL_R * wx;
          const sn = Math.sqrt(sx * sx + sy * sy);
          if (sn > 1e-9) {
            const jn = (1 + eBasis) * BALL_M * Math.abs(kvz);
            const jt = Math.min(TANGENTIAL_MASSE * BALL_M * sn, MU_PRALL * jn);
            const Jx = -jt * sx / sn, Jy = -jt * sy / sn;
            kvx += Jx / BALL_M; kvy += Jy / BALL_M;
            wx += (BALL_R * Jy) / (TRAEGHEIT * BALL_M * BALL_R * BALL_R);
            wy += (-BALL_R * Jx) / (TRAEGHEIT * BALL_M * BALL_R * BALL_R);
          }

          px = cx; py = cy; pz = boden;
          vx = kvx; vy = kvy; vz = nvz2;
          if (nvz2 < V_HAFT) {
            amBoden = true; vz = 0;
          } else {
            const rest = DT_PHYS * (1 - u);
            if (rest > 1e-9) {
              beschleunigung(vx, vy, vz, wx, wy, wz, windX, windY, windZ, k);
              const rvx = vx + _beschl[0] * rest, rvy = vy + _beschl[1] * rest, rvz = vz + _beschl[2] * rest;
              px += 0.5 * (vx + rvx) * rest;
              py += 0.5 * (vy + rvy) * rest;
              pz += 0.5 * (vz + rvz) * rest;
              if (pz < boden) pz = boden;
              vx = rvx; vy = rvy; vz = rvz;
            }
          }
          scheitelGesetzt = false;
        } else {
          px = nx; py = ny; pz = nz; vx = nvx; vy = nvy; vz = nvz;
        }
      }
      if (pz < boden) pz = boden;
      wx *= zerfall; wy *= zerfall; wz *= zerfall;
      t += DT_PHYS;
    }
    buf[n * 6] = px; buf[n * 6 + 1] = py; buf[n * 6 + 2] = pz;
    buf[n * 6 + 3] = vx; buf[n * 6 + 4] = vy; buf[n * 6 + 5] = vz;
    n++;
    if (amBoden && Math.sqrt(vx * vx + vy * vy) < V_STILL) break;
  }

  flug.anzahl = n;
  flug.dauer = (n - 1) * DT_SAMPLE;
  return flug;
}

/* ------------------------------------------------------------------ *
 *  Abschuss
 * ------------------------------------------------------------------ */

/** Geschwindigkeitsvektor aus Betrag, Gierwinkel (xy-Ebene) und Neigung. */
export function abschussVektor(betrag, gier, neigung, out) {
  const o = out || { x: 0, y: 0, z: 0 };
  const c = Math.cos(neigung);
  o.x = betrag * c * Math.cos(gier);
  o.y = betrag * c * Math.sin(gier);
  o.z = betrag * Math.sin(neigung);
  return o;
}

/* Arbeitsobjekte für die Probeschüsse — loeseAbschuss allokiert nicht je Iteration. */
const _probeP = { x: 0, y: 0, z: 0 };
const _probeV = { x: 0, y: 0, z: 0 };
const _probeInit = { p: _probeP, v: _probeV, w: null, wind: null, boden: 0, tMax: 6, nass: 0, tief: 0, dichte: 1 };
const _probeErg = { z: 0, t: 0, ok: false };

/**
 * Integriert einen Probeschuss und liefert Höhe und Zeit an der Stelle, an der die
 * horizontale Strecke D entlang (dx,dy) erreicht ist.
 */
function probeSchuss(von, dx, dy, D, betrag, neigung, opt) {
  const gier = Math.atan2(dy, dx);
  abschussVektor(betrag, gier, neigung, _probeV);
  _probeP.x = von.x; _probeP.y = von.y; _probeP.z = von.z;
  _probeInit.w = (opt && opt.w) || null;
  _probeInit.wind = (opt && opt.wind) || null;
  _probeInit.boden = (opt && opt.boden !== undefined) ? opt.boden : -50;
  _probeInit.tMax = (opt && opt.tMax) || 6;
  _probeInit.nass = 0; _probeInit.tief = 0;
  _probeInit.dichte = (opt && opt.dichte !== undefined) ? opt.dichte : 1;
  const f = createFlug(_probeInit);
  // Ebene senkrecht zur Schussrichtung im Zielabstand D
  const achse = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
  const wert = achse === 'x' ? von.x + dx * D : von.y + dy * D;
  const tr = f.trefferEbene(achse, wert, 0, f.dauer);
  if (!tr) { _probeErg.ok = false; f.freigeben(); return _probeErg; }
  _probeErg.ok = true; _probeErg.z = tr.z; _probeErg.t = tr.t;
  f.freigeben();
  return _probeErg;
}

/**
 * Sucht Gier- und Neigungswinkel, mit denen ein Schuss der Stärke `betrag` von
 * `von` nach `nach` trifft. Newton gegen den echten Integrator (Startwert aus der
 * luftlosen Lösung); opt.hoch = true wählt die Lob-Lösung.
 *
 * Abweichung vom Plan: der Plan nennt „3 Newton-Schritte". Hier laufen bis zu
 * SECHS, mit Abbruch, sobald der Höhenfehler unter 1 cm liegt, und danach zur
 * Sicherheit ein Einklammern mit Regula falsi. Grund: mit Luft reichen drei
 * Schritte nicht — bei Distanzen über 25 m blieb ein Rest bis 0,4 m stehen, und
 * die Lob-Lösung aus der luftlosen Formel ist so steil, dass der Ball das Ziel
 * gar nicht mehr erreicht und Newton keinen Startwert bekommt. Der Normalfall
 * kostet weiterhin zwei bis drei Integrationen; die Signatur ist unverändert.
 */
export function loeseAbschuss(von, nach, betrag, opt) {
  const ddx = nach.x - von.x, ddy = nach.y - von.y;
  const D = Math.sqrt(ddx * ddx + ddy * ddy);
  const dz = nach.z - von.z;
  if (D < 1e-6) return null;
  const dx = ddx / D, dy = ddy / D;
  const gier = Math.atan2(ddy, ddx);
  const hoch = !!(opt && opt.hoch);

  /** Höhenfehler an der Zielebene; NaN, wenn die Ebene nie erreicht wird. */
  const fehlerBei = (neigung) => {
    const r = probeSchuss(von, dx, dy, D, betrag, neigung, opt);
    return r.ok ? r.z - nach.z : NaN;
  };
  const fertig = (neigung) => {
    const r = probeSchuss(von, dx, dy, D, betrag, neigung, opt);
    return r.ok ? { gier, neigung, t: r.t } : null;
  };

  // Startwert: luftlose Lösung  tan θ = (v² ± √(v⁴ − g(g D² + 2 Δz v²))) / (g D)
  const v2 = betrag * betrag;
  const disk = v2 * v2 - G * (G * D * D + 2 * dz * v2);
  let neigung;
  if (disk >= 0) {
    const w = Math.sqrt(disk);
    neigung = Math.atan((hoch ? v2 + w : v2 - w) / (G * D));
  } else {
    neigung = Math.atan2(dz, D) + (hoch ? 0.9 : 0.35);
  }
  neigung = clamp(neigung, -1.35, 1.45);

  /* Schneller Weg: Newton/Sekante ab dem luftlosen Startwert. */
  let letzterFehler = NaN, letzteNeigung = neigung;
  let f = fehlerBei(neigung);
  if (isFinite(f)) {
    for (let i = 0; i < 6; i++) {
      if (Math.abs(f) < 0.01) return fertig(neigung);
      let ablt;
      if (isFinite(letzterFehler) && Math.abs(neigung - letzteNeigung) > 1e-9) {
        ablt = (f - letzterFehler) / (neigung - letzteNeigung);
      } else {
        const h = 0.02;
        const f2 = fehlerBei(neigung + h);
        if (!isFinite(f2)) break;
        ablt = (f2 - f) / h;
      }
      if (!isFinite(ablt) || Math.abs(ablt) < 1e-6) break;
      letzterFehler = f; letzteNeigung = neigung;
      const naechste = clamp(neigung - f / ablt, -1.35, 1.45);
      if (naechste === neigung) break;
      neigung = naechste;
      f = fehlerBei(neigung);
      if (!isFinite(f)) break;
    }
    if (isFinite(f) && Math.abs(f) < 0.05) return fertig(neigung);
  }

  /* Sicherheitsnetz: Vorzeichenwechsel einklammern und Regula falsi.
   * f(θ) ist über den erreichbaren Winkeln unimodal — von unten kommend steigt
   * es durch null (flache Lösung), fällt danach wieder durch null (Lob). Wir
   * laufen deshalb bei `hoch` von oben nach unten, sonst von unten nach oben,
   * bis f das erste Mal das Vorzeichen wechselt. */
  const start = clamp(Math.atan2(dz, D), -1.30, 1.40);
  let a = hoch ? 1.40 : start;
  const schritt = hoch ? -0.08 : 0.08;
  let fa = fehlerBei(a);
  let b = NaN, fb = NaN;
  for (let i = 0; i < 34; i++) {
    const naechste = a + schritt;
    if (naechste < -1.35 || naechste > 1.45) break;
    const fn = fehlerBei(naechste);
    if (isFinite(fa) && isFinite(fn) && ((fa <= 0 && fn >= 0) || (fa >= 0 && fn <= 0))) {
      b = naechste; fb = fn; break;
    }
    a = naechste; fa = fn;
  }
  if (!isFinite(fa) || !isFinite(fb)) return null;
  for (let i = 0; i < 24; i++) {
    const d = fb - fa;
    let m = Math.abs(d) > 1e-12 ? a - fa * (b - a) / d : 0.5 * (a + b);
    if (!(m > Math.min(a, b) && m < Math.max(a, b))) m = 0.5 * (a + b);
    const fm = fehlerBei(m);
    if (!isFinite(fm)) return null;
    if (Math.abs(fm) < 0.01) return fertig(m);
    if ((fa <= 0 && fm <= 0) || (fa >= 0 && fm >= 0)) { a = m; fa = fm; } else { b = m; fb = fm; }
  }
  const mitte = 0.5 * (a + b);
  return Math.abs(fehlerBei(mitte)) < 0.35 ? fertig(mitte) : null;
}

/* ------------------------------------------------------------------ *
 *  Segmente für die Bühne
 * ------------------------------------------------------------------ */

export const SEGMENT_TYPEN = {
  pass_flach: { v0: 16, loft: 0 },
  steilpass: { v0: 21, loft: 0.10 },
  flanke: { v0: 22, loft: 0.26 },
  freistoss: { v0: 19, loft: 0.22 },
  schuss: { v0: 27, loft: 0.045 },
  dribbling: { v0: 6, loft: 0 },
  kopfball: { v0: 13, loft: 0.10 },
  klaerung: { v0: 20, loft: 0.35 },
  abstoss: { v0: 25, loft: 0.42 },
  einwurf: { v0: 11, loft: 0.20 },
  abpraller: { v0: 9, loft: 0.12 }
};

/**
 * Fertiger Flug für ein Bühnensegment.
 *
 * Vorgehen: die Neigung des Typs ist der Charakter des Segments und wird
 * festgehalten; gesucht wird die Abschussstärke, die den Zielpunkt trifft
 * (Sekantenverfahren gegen den Integrator). Erst wenn die nötige Stärke mehr als
 * 80 % über oder 45 % unter der Typstärke läge, wird stattdessen die Neigung über
 * loeseAbschuss angepasst. opt.hoehe erzwingt eine Scheitelhöhe.
 */
export function segmentFlug(von, nach, typ, opt) {
  const o = opt || {};
  const T = SEGMENT_TYPEN[typ] || SEGMENT_TYPEN.pass_flach;
  const ddx = nach.x - von.x, ddy = nach.y - von.y;
  const D = Math.sqrt(ddx * ddx + ddy * ddy);
  const boden = o.boden === undefined ? 0 : o.boden;
  const tMax = o.tMax === undefined ? 4.0 : o.tMax;
  const bauen = (gier, neigung, betrag) => {
    const v = abschussVektor(betrag, gier, neigung, { x: 0, y: 0, z: 0 });
    return createFlug({
      p: { x: von.x, y: von.y, z: von.z },
      v, w: o.w || null, wind: o.wind || null,
      boden, tMax, nass: o.nass || 0, tief: o.tief || 0,
      dichte: o.dichte === undefined ? 1 : o.dichte
    });
  };
  const gier = D > 1e-9 ? Math.atan2(ddy, ddx) : 0;
  if (D < 1e-6) return bauen(0, T.loft, Math.max(0.5, T.v0 * 0.2));

  const dx = ddx / D, dy = ddy / D;
  const probeOpt = { w: o.w, wind: o.wind, dichte: o.dichte, boden: -50 };

  /** Stärke, die bei fester Neigung den Zielpunkt trifft (Sekante, ≤ 7 Proben). */
  const staerkeFuer = (neigung) => {
    const fehlerBei = (b) => {
      const r = probeSchuss(von, dx, dy, D, b, neigung, probeOpt);
      return r.ok ? r.z - nach.z : NaN;
    };
    let bA = T.v0, fA = fehlerBei(bA);
    if (!isFinite(fA)) return { betrag: T.v0, angeschlagen: true };
    if (Math.abs(fA) <= 0.05) return { betrag: bA, angeschlagen: false };
    let bB = clamp(bA * (fA < 0 ? 1.25 : 0.8), 2, 45), fB = fehlerBei(bB);
    for (let i = 0; i < 6 && isFinite(fB); i++) {
      if (Math.abs(fB) < 0.05) break;
      const d = fB - fA;
      if (Math.abs(d) < 1e-9) break;
      const bN = clamp(bB - fB * (bB - bA) / d, 2, 45);
      bA = bB; fA = fB; bB = bN; fB = fehlerBei(bN);
    }
    const roh = isFinite(fB) ? bB : bA;
    const geklemmt = clamp(roh, T.v0 * 0.55, T.v0 * 1.8);
    return { betrag: geklemmt, angeschlagen: geklemmt !== roh };
  };

  let neigung = T.loft;
  let s = staerkeFuer(neigung);

  if (o.hoehe !== undefined) {
    /* Scheitelhöhe erzwingen: die Neigung folgt der Höhe, die Stärke wird für
     * jede Neigung neu an das Ziel angepasst. Sekante über den echten Scheitel. */
    const scheitelBei = (n) => {
      const st = staerkeFuer(n);
      const f = bauen(gier, n, st.betrag);
      const z = f.scheitel().z;
      f.freigeben();
      return { z, betrag: st.betrag, angeschlagen: st.angeschlagen };
    };
    let nA = Math.asin(clamp(Math.sqrt(2 * G * Math.max(0.02, o.hoehe - (von.z - boden))) / Math.max(T.v0, 0.5), -0.98, 0.98));
    let rA = scheitelBei(nA);
    let nB = clamp(nA * 1.18 + 0.05, -1.3, 1.4), rB = scheitelBei(nB);
    for (let i = 0; i < 5; i++) {
      if (Math.abs(rB.z - o.hoehe) < 0.05) break;
      const d = (rB.z - o.hoehe) - (rA.z - o.hoehe);
      if (Math.abs(d) < 1e-9) break;
      const nN = clamp(nB - (rB.z - o.hoehe) * (nB - nA) / d, -1.3, 1.4);
      if (Math.abs(nN - nB) < 1e-6) break;
      nA = nB; rA = rB; nB = nN; rB = scheitelBei(nN);
    }
    return bauen(gier, nB, rB.betrag);
  }

  if (s.angeschlagen) {
    // Stärke am Anschlag: jetzt doch über die Neigung lösen
    const l = loeseAbschuss(von, nach, s.betrag, { hoch: T.loft > 0.3, w: o.w, wind: o.wind, dichte: o.dichte });
    if (l) neigung = l.neigung;
  }
  return bauen(gier, neigung, s.betrag);
}

/* ------------------------------------------------------------------ *
 *  Boden
 * ------------------------------------------------------------------ */

/**
 * Geschlossene Form für die Rutschphase eines Balls, der ohne passenden Drall
 * aufkommt (für die KI, die keinen Integrator laufen lassen will).
 * omega0 in rad/s, positiv = vorwärts rollend. Rückgabe: {t, v, s}.
 */
export function rutschEnde(v0, omega0 = 0, mu = MU_GLEIT_TROCKEN) {
  const u0 = v0 - BALL_R * omega0;
  if (!(u0 > 0) || !(mu > 0)) return { t: 0, v: v0, s: 0 };
  const abbau = (1 + 1 / TRAEGHEIT) * mu * G;   // 2.5·μ·g bei I = 2/3·m·R²
  const t = u0 / abbau;
  const v = v0 - mu * G * t;
  const s = v0 * t - 0.5 * mu * G * t * t;
  return { t, v, s };
}

/* ------------------------------------------------------------------ *
 *  Spielerkinematik
 * ------------------------------------------------------------------ */

/**
 * Laufwerte eines Spielers. tempo/antritt/koerper 0..99, fitness 0..100.
 * tau = vmax/apeak ist die Zeitkonstante der Exponentialnäherung ans Tempo.
 */
export function laufwerte(attr) {
  const a = attr || {};
  const tempo = clamp(a.tempo === undefined ? 50 : a.tempo, 0, 99);
  const antritt = clamp(a.antritt === undefined ? tempo : a.antritt, 0, 99);
  const koerper = clamp(a.koerper === undefined ? 50 : a.koerper, 0, 99);
  const fit = a.fitness === undefined ? 100 : clamp(a.fitness, 0, 100);
  const ff = 0.85 + 0.15 * (fit / 100);
  const vmax = (VMAX_BASIS + VMAX_SPANNE * (tempo / 99)) * ff;
  const apeak = (APEAK_BASIS + APEAK_SPANNE * (antritt / 99)) * ff;
  return {
    vmax,
    apeak,
    tau: vmax / apeak,
    aBrems: A_BREMS + (A_BREMS_HART - A_BREMS) * (koerper / 99),
    aLat: A_LATERAL * (0.85 + 0.30 * (antritt / 99))
  };
}

/** Zurückgelegte Strecke nach t Sekunden aus dem Stand. */
export function sprintStrecke(t, k) {
  if (t <= 0) return 0;
  return k.vmax * (t - k.tau * (1 - Math.exp(-t / k.tau)));
}

/** Zeit für eine Strecke aus dem Stand (Newton, 6 Iterationen). */
export function sprintZeit(strecke, k) {
  if (strecke <= 0) return 0;
  let t = strecke / k.vmax + k.tau;
  for (let i = 0; i < 6; i++) {
    const e = Math.exp(-t / k.tau);
    const f = k.vmax * (t - k.tau * (1 - e)) - strecke;
    const df = k.vmax * (1 - e);
    if (df < 1e-9) break;
    const n = t - f / df;
    if (!isFinite(n)) break;
    t = n > 0 ? n : t * 0.5;
  }
  return t;
}

/**
 * Ein Zeitschritt in Richtung der Zielgeschwindigkeit — exakte Exponentiallösung
 * von dv/dt = (vZiel − v)/tau, Ort mitintegriert. Ändert p in place.
 */
export function sprintSchritt(p, zielVx, zielVy, k, dt) {
  const zs = Math.sqrt(zielVx * zielVx + zielVy * zielVy);
  const cs = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  const tau = zs >= cs ? k.tau : Math.max(0.05, k.vmax / k.aBrems);
  const e = Math.exp(-dt / tau);
  const dvx = p.vx - zielVx, dvy = p.vy - zielVy;
  p.x += zielVx * dt + dvx * tau * (1 - e);
  p.y += zielVy * dt + dvy * tau * (1 - e);
  p.vx = zielVx + dvx * e;
  p.vy = zielVy + dvy * e;
}

/**
 * Kurswechsel mit begrenzter Querbeschleunigung — daraus entstehen die Laufbögen.
 * Vollständiger Zeitschritt: dreht die Geschwindigkeit UND rückt den Ort vor.
 * Nicht zusammen mit sprintSchritt im selben Frame aufrufen.
 */
export function lenke(p, zielRichtungRad, k, dt) {
  const s = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  if (s < 1e-6) return;
  const kurs = Math.atan2(p.vy, p.vx);
  let d = zielRichtungRad - kurs;
  while (d > Math.PI) d -= TAU_KREIS;
  while (d < -Math.PI) d += TAU_KREIS;
  const wmax = k.aLat / Math.max(s, 0.8);
  const dw = clamp(d, -wmax * dt, wmax * dt);
  const s2 = s * Math.max(0.2, 1 - 0.25 * Math.abs(dw));
  const mittel = kurs + dw * 0.5;
  p.x += Math.cos(mittel) * 0.5 * (s + s2) * dt;
  p.y += Math.sin(mittel) * 0.5 * (s + s2) * dt;
  const neu = kurs + dw;
  p.vx = Math.cos(neu) * s2;
  p.vy = Math.sin(neu) * s2;
}

/** Zeitverlust einer Richtungsänderung: Tempo abbauen, stemmen, wieder anlaufen. */
export function wendeKosten(v, winkelGrad) {
  const w = clamp(Math.abs(winkelGrad), 0, 180) * Math.PI / 180;
  const behalten = Math.max(0.15, Math.cos(w * 0.5));
  const dv = Math.max(0, v) * (1 - behalten);
  return T_STEMM * (w / Math.PI) + dv / A_BREMS + dv / APEAK_BASIS;
}

/* ------------------------------------------------------------------ *
 *  Torwart
 * ------------------------------------------------------------------ */

/** Reaktionszeit, Hechtgeschwindigkeit und Armreichweite. Attribute 0..99. */
export function twParameter(tw) {
  const a = tw || {};
  const reflexe = clamp(a.reflexe === undefined ? 50 : a.reflexe, 0, 99);
  const antiz = clamp(a.antizipation === undefined ? 50 : a.antizipation, 0, 99);
  const sprung = clamp(a.sprungkraft === undefined ? 50 : a.sprungkraft, 0, 99);
  const groesse = a.groesse || 1.88;
  return {
    tReakt: Math.max(0.09, TW_T_REAKT - 0.06 * (reflexe / 99) - 0.04 * (antiz / 99)),
    vHecht: TW_V_HECHT * (0.82 + 0.30 * (sprung / 99)),
    arm: TW_ARM * (groesse / 1.88)
  };
}

/**
 * Wie weit der Torwart in tFlug Sekunden kommt. Nach dem Absprung ist die
 * Bewegung ballistisch, also LINEAR in der Zeit; hohe Bälle kosten Reichweite.
 */
export function twReichweite(par, tFlug, zielHoehe) {
  const t = Math.max(0, tFlug - par.tReakt);
  const h = zielHoehe === undefined ? 0.6 : zielHoehe;
  const hochAnteil = clamp((h - 1.0) / 1.44, 0, 1);
  const f = 1 + (TW_HOCH_FAKTOR - 1) * hochAnteil;
  return Math.min(TW_MAX, par.vHecht * t * f + par.arm);
}

/** Wahrscheinlichkeit, dass der Ball festgehalten statt abgeklatscht wird. */
export function pFesthalten(vBall, imHecht, nassGrad, fangsicherheit) {
  const fs = clamp(fangsicherheit === undefined ? 50 : fangsicherheit, 0, 99);
  const p = 0.96 - 0.020 * Math.max(0, vBall) + 0.30 * (fs / 99)
    - (imHecht ? 0.22 : 0) - 0.18 * clamp(nassGrad || 0, 0, 1);
  return clamp(p, 0.02, 0.98);
}

/** Abpraller nach einer Parade. Zieht genau EINMAL rng. */
export function abpraller(vBall, rng) {
  const r = rng.next();
  const zone = r < 0.42 ? 'seite' : r < 0.80 ? 'zentrum' : 'ecke';
  const v = Math.max(1.5, vBall * (0.28 + 0.22 * r));
  const gefahr = clamp(
    (zone === 'zentrum' ? 0.78 : zone === 'seite' ? 0.42 : 0.22) * (0.6 + 0.4 * (v / 12)),
    0, 1
  );
  return { zone, v, gefahr };
}

/* ------------------------------------------------------------------ *
 *  Kopfball
 * ------------------------------------------------------------------ */

const KOPF_ANTEIL = 0.94;    // Scheitel des Kopfes ≈ 94 % der Körpergröße im Anlauf
const KOPF_STRECK = 0.18;    // Nackenstreckung beim Sprungkopfball

/** Sprungprofil: hoehe/vAb/steigzeit in SI, fenster in s, reichweite in m. */
export function sprungProfil(attr) {
  const a = attr || {};
  const sprung = clamp(a.sprungkraft === undefined ? 50 : a.sprungkraft, 0, 99);
  const koerper = clamp(a.koerper === undefined ? 50 : a.koerper, 0, 99);
  const fit = a.fitness === undefined ? 100 : clamp(a.fitness, 0, 100);
  const ff = 0.88 + 0.12 * (fit / 100);
  const hoehe = (0.28 + 0.30 * (sprung / 99) + 0.06 * (koerper / 99)) * ff;
  const vAb = Math.sqrt(2 * G * hoehe);
  const steigzeit = vAb / G;
  return {
    hoehe,
    vAb,
    steigzeit,
    fenster: 2 * steigzeit * Math.sqrt(0.1),   // Zeit über 90 % der Sprunghöhe
    reichweite: hoehe + KOPF_STRECK
  };
}

/**
 * Höhe des Kopfes über dem Boden, tSeitAbsprung Sekunden nach dem Absprung.
 * Vor dem Absprung und nach der Landung ist es die Standkopfhöhe; dazwischen
 * kommen Nackenstreckung und Sprungbahn dazu.
 */
export function kopfHoehe(pr, groesseM, tSeitAbsprung) {
  const stand = groesseM * KOPF_ANTEIL;
  const t = tSeitAbsprung;
  if (!(t > 0)) return stand;
  const z = pr.vAb * t - 0.5 * G * t * t;
  return z > 0 ? stand + KOPF_STRECK + z : stand;
}

/** 1.0 = perfekt getimt, quadratischer Abfall über das Sprungfenster. */
export function timingGuete(pr, fehlerS) {
  const halb = Math.max(1e-3, pr.fenster * 0.5);
  const r = Math.abs(fehlerS) / halb;
  return clamp(1 - r * r, 0, 1);
}

/* ------------------------------------------------------------------ *
 *  Referenz für Tests
 * ------------------------------------------------------------------ */

/**
 * Sollwerte aus Abschnitt 4 des Umbauplans, unverändert übernommen.
 * Spalten: Zeit bis 11 m, 20 m, 30 m (s) und Reichweite (m).
 * Die zugehörigen Abschussparameter stehen in tools/test-ballistik.js.
 */
export const FLUGZEIT_REFERENZ = {
  //                    11 m     20 m     30 m   Reichweite
  elfmeter28: [0.420, null, null, 15.7],
  vollspann32: [0.372, 0.710, null, 29.1],
  effet24: [0.508, 0.972, null, 25.8],
  topspin26: [0.468, 0.894, null, 22.9],
  flanke21_30grad: [0.648, 1.240, 1.972, 30.5],
  flanke23_35grad: [0.628, 1.202, 1.914, 37.0],
  abstoss25_40grad: [0.620, 1.192, 1.902, 42.6]
};
