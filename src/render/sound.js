/**
 * render/sound.js — die komplette Tonschicht von TRAUMVEREIN.
 *
 * Alles ist prozedural: Oszillatoren, selbst erzeugtes Rauschen, Biquad-Filter,
 * Hüllkurven auf Gain-Nodes, Stereo-Panorama und ein Hallraum aus einer selbst
 * berechneten Impulsantwort. **Keine Audiodateien, keine Abhängigkeiten.**
 * Das ist kein Geschmacksurteil: Das Projekt hat keinen Build-Schritt und läuft
 * über einen simplen Dateiserver — Assets würden das brechen.
 *
 * ---------------------------------------------------------------------------
 * BENUTZUNG
 *
 *   import { createSoundBank } from './src/render/sound.js';
 *   const bank = createSoundBank({ lautstaerke: 0.7 });
 *
 *   bank.play('anpfiff');
 *   bank.play('schuss', { lautstaerke: 0.9, hoehe: 1.1, panorama: -0.3 });
 *   bank.gong('aufstellung');
 *
 *   bank.aufsetzer(0.85);                   // langer Ball schlägt auf dem Rasen auf
 *   bank.netz(0.6);                         // Ball wühlt sich ins Maschenwerk
 *   bank.pfosten();  bank.mauer();          // Aluminium bzw. Block der Mauer
 *   bank.pfiff('anstoss');                  // 'halbzeit' | 'abpfiff' | 'standard'
 *
 *   bank.atmoStart();
 *   bank.atmo({ zuschauer: 42000, kapazitaet: 50000, stimmung: 74,
 *               heimFuehrung: 1, minute: 63, druck: 0.4, heimAngriff: true });
 *   bank.play('tor');                       // Heimtor
 *   bank.play('tor', { seite: 'gast' });    // Gästetor – nur der Auswärtsblock jubelt
 *   bank.atmoStop();
 *
 *   bank.setLautstaerke(0.4);  bank.setStumm(true);  bank.destroy();
 *
 * ---------------------------------------------------------------------------
 * DEGRADIERUNG (bewusst getestet, siehe tools/check-sound.js)
 *
 *   • Kein AudioContext (Node, alte Browser) → createSoundBank() liefert ein
 *     Objekt mit derselben API, das nichts tut und `verfuegbar === false` meldet.
 *     Ein Import dieser Datei in Node wirft NICHT.
 *   • Unbekannter Klangname → play() wirft nicht, ignoriert still und warnt
 *     genau einmal je Name in der Konsole.
 *   • Browser sperren AudioContext bis zur ersten Nutzerinteraktion. Die Bank
 *     hängt sich selbst an pointerdown/touchstart/keydown und ruft resume();
 *     zusätzlich weckt jeder play()-Aufruf den Kontext.
 *
 * ---------------------------------------------------------------------------
 * LEISTUNG
 *
 *   Die Stadionatmosphäre läuft über Minuten, ohne Knackser und ohne die
 *   Bildrate zu kosten: Der Klanggraph wird EINMAL aufgebaut, alle Verläufe
 *   laufen über AudioParam-Rampen (setTargetAtTime / linearRampToValueAtTime)
 *   im Audio-Thread. Keine rAF-Schleife, kein setInterval, keine Knoten, die
 *   im Sekundentakt entstehen und vergehen. Die Rauschschleife ist am
 *   Schleifenpunkt kreuzgeblendet, deshalb klickt sie auch nach 90 Minuten nicht.
 *
 * Determinismus: Rauschen, Impulsantwort und alle Klangvarianten kommen aus
 * core/rng.js. Kein Math.random(), kein Date.now() — die Uhr ist ctx.currentTime.
 *
 * Syntaxprüfung:  node --check src/render/sound.js
 * Vollprüfung:    node tools/check-sound.js
 * ---------------------------------------------------------------------------
 */

import { clamp } from '../core/util.js';
import { createRng } from '../core/rng.js';

// ═══════════════════════════════════════════════════════════════════════════
// 1. KLANGNAMEN — der Vertrag mit matchday.js und den Minispielen
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Alle Klänge, die `bank.play(name)` kennt. Wer hier etwas ergänzt, ergänzt
 * auch einen Bauplan in KLANGBAU (weiter unten) — sonst warnt die Bank.
 *
 *   klick         Bedienton der Minispiele (Zielen, Bestätigen)
 *   schuss        Torschuss: tiefer Impuls mit Knacken
 *   tor           Netzrascheln + aufbrandender Jubel (2–3 s)
 *   parade        Handschuh-Impuls des Torwarts, höher als schuss
 *   pfosten       Aluminium: Aufprall plus langer metallischer Nachklang
 *   block         abgeblockter Schuss, dumpf und kurz
 *   pfiff         Trillerpfeife, einmal kurz (Foul)
 *   anpfiff       Trillerpfeife, lang und leicht ansteigend
 *   abpfiff       Trillerpfeife, dreimal kurz
 *   karte         trockener Ton zur Verwarnung (Rot: hoehe 0.7 mitgeben)
 *   wechsel       Auswechseltafel, zwei Piepser
 *   jubel         Jubel ohne Netzrascheln (Großchance verwandelt, Sieg)
 *   raunen        enttäuschtes „Ooooh" der Menge (Fehlschuss, Latte)
 *   pfeifkonzert  Pfeifchor der Heimkurve
 *   trommel       einzelner Ultra-Trommelschlag
 *   gong          Stadionsprecher-Gong (= bank.gong('aufstellung'))
 */
export const KLANGNAMEN = Object.freeze([
  'klick', 'schuss', 'tor', 'parade', 'pfosten', 'block',
  'pfiff', 'anpfiff', 'abpfiff', 'karte', 'wechsel',
  'jubel', 'raunen', 'pfeifkonzert', 'trommel', 'gong'
]);

/** Zweitnamen, die auf denselben Bauplan zeigen. */
export const KLANG_ALIASE = Object.freeze({
  latte: 'pfosten',      // Latte und Pfosten klingen gleich, nur die Höhe ändert sich
  aluminium: 'pfosten',
  foulpfiff: 'pfiff',
  halbzeit: 'abpfiff'
});

/** Erlaubte Argumente für bank.gong(art). */
export const GONG_ARTEN = Object.freeze(['aufstellung', 'tor', 'wechsel', 'ende']);

/**
 * Erlaubte Argumente für bank.pfiff(art).
 *
 *   anstoss    lang, am Ende ansteigend — eine Halbzeit beginnt
 *   halbzeit   kurz, dann lang — Pause
 *   abpfiff    dreimal — das Spiel ist aus
 *   standard   ein kurzer Pfiff, der eine Standardsituation freigibt
 */
export const PFIFF_ARTEN = Object.freeze(['anstoss', 'halbzeit', 'abpfiff', 'standard']);

/** Kopie der Klangnamen — damit niemand versehentlich die Vorlage verbiegt. */
export function klangNamen() { return KLANGNAMEN.slice(); }

/** Kennt die Bank diesen Namen (inklusive Aliase)? */
export function istKlangname(name) {
  return KLANGNAMEN.indexOf(name) >= 0 ||
    Object.prototype.hasOwnProperty.call(KLANG_ALIASE, name);
}

/** Gibt es in dieser Umgebung überhaupt WebAudio? (Node: nein.) */
export function audioVerfuegbar() { return !!audioKlasse(); }

// ═══════════════════════════════════════════════════════════════════════════
// 2. STELLSCHRAUBEN — hier wird gemischt
// ═══════════════════════════════════════════════════════════════════════════

const STD = {
  lautstaerke: 0.7,      // Gesamtlautstärke 0..1
  stumm: false,
  hall: true,            // Stadionhall (ConvolverNode). false spart ~1 % CPU
  hallStaerke: 1,        // Multiplikator auf alle Hallanteile
  effektPegel: 0.9,      // Bus der Einzelklänge
  atmoPegel: 0.85,       // Bus der Stadionatmosphäre
  gastAnteil: 0.30,      // Auswärtsblock relativ zur Heimkurve (Mischverhältnis)
  gastPanorama: 0.62,    // Auswärtsblock sitzt rechts im Panorama
  heimPanorama: -0.14,   // Heimkurve minimal links — die Bühne bekommt Breite
  maxStimmen: 24,        // gleichzeitige Einzelklänge; darüber wird verworfen
  seed: 'traumverein-ton',
  kontext: null,         // vorhandener AudioContext weiterverwenden
  entsperren: true       // Klick-Listener zum Aufwecken des AudioContext
};

/** Kürzester Abstand zwischen zwei gleichen Klängen (s) — gegen Maschinengewehr. */
const MINDESTABSTAND = {
  klick: 0.035, schuss: 0.06, parade: 0.07, block: 0.06, karte: 0.08,
  pfosten: 0.12, pfiff: 0.15, trommel: 0.09, tor: 0.8, jubel: 0.6,
  raunen: 0.5, pfeifkonzert: 1.5, gong: 0.5, anpfiff: 0.5, abpfiff: 0.5,
  wechsel: 0.2
};

/** Hallanteil je Klang: der Gong hallt durch die Schüssel, der Klick gar nicht. */
const HALLANTEIL = {
  klick: 0.04, karte: 0.06, wechsel: 0.28, schuss: 0.34, parade: 0.34,
  block: 0.28, pfosten: 0.52, pfiff: 0.55, anpfiff: 0.55, abpfiff: 0.55,
  tor: 0.48, jubel: 0.45, raunen: 0.40, pfeifkonzert: 0.38, trommel: 0.42,
  gong: 0.70
};

/** Grundlautstärke je Klang — die Feinabstimmung der Mischung. */
const GRUNDPEGEL = {
  klick: 0.22, schuss: 0.75, tor: 0.70, parade: 0.55, pfosten: 0.70,
  block: 0.48, pfiff: 0.40, anpfiff: 0.42, abpfiff: 0.42, karte: 0.30,
  wechsel: 0.32, jubel: 0.55, raunen: 0.45, pfeifkonzert: 0.40,
  trommel: 0.50, gong: 0.45
};

/* --- Zusatzklänge -------------------------------------------------------- *
 * Aufsetzer, Netz, Aluminium, Mauer und die vier Schiedsrichterpfiffe stehen
 * bewusst NICHT in KLANGNAMEN: play() und die drei Tabellen oben bleiben Wort
 * für Wort das, wogegen die bestehenden Aufrufer geschrieben sind. Die neuen
 * Klänge hängen an eigenen Bank-Methoden und an diesen eigenen Tabellen.
 * Wo ein Zusatzklang denselben Bauplan benutzt wie ein alter, erbt er auch
 * dessen Pegel und Mindestabstand — sonst klänge derselbe Vorgang je nach
 * Aufrufweg verschieden laut.
 * ----------------------------------------------------------------------- */
const ZUSATZ_PEGEL = {
  aufsetzer: 0.55, netz: 0.44,
  pfosten: GRUNDPEGEL.pfosten, mauer: GRUNDPEGEL.block, pfiff: GRUNDPEGEL.pfiff
};
const ZUSATZ_ABSTAND = {
  aufsetzer: 0.05, netz: 0.09,
  pfosten: MINDESTABSTAND.pfosten, mauer: MINDESTABSTAND.block, pfiff: MINDESTABSTAND.pfiff
};
const ZUSATZ_HALL = { aufsetzer: 0.20, netz: 0.30 };

/* Tonhöhen des Stadionsprecher-Gongs. Reine Dur-Intervalle, langer Ausklang. */
const GONG_SATZ = {
  aufstellung: { toene: [392.00, 523.25], abstand: 0.40, ausklang: 3.0, glanz: 1.00 },
  tor: { toene: [523.25, 659.25, 783.99], abstand: 0.19, ausklang: 3.4, glanz: 1.25 },
  wechsel: { toene: [587.33, 440.00], abstand: 0.25, ausklang: 2.2, glanz: 0.90 },
  ende: { toene: [261.63], abstand: 0.00, ausklang: 4.4, glanz: 0.72 }
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. UMGEBUNG
// ═══════════════════════════════════════════════════════════════════════════

/** Der AudioContext-Konstruktor dieser Umgebung — oder null (Node, alte Browser). */
function audioKlasse() {
  const g = typeof globalThis !== 'undefined' ? globalThis : null;
  if (!g) return null;
  return g.AudioContext || g.webkitAudioContext || null;
}

/** Einmal je Name warnen, nie öfter — sonst flutet ein Tippfehler die Konsole. */
const gewarnt = new Set();
function warnEinmal(schluessel, text) {
  if (gewarnt.has(schluessel)) return;
  gewarnt.add(schluessel);
  if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn(text);
}

/**
 * Zahl mit Rückfallwert. Wichtig: `clamp(NaN, …)` liefert NaN, und ein NaN auf
 * einem AudioParam wirft. Alles, was von außen kommt, läuft deshalb hier durch.
 */
function zahl(wert, standard) {
  const n = Number(wert);
  return Number.isFinite(n) ? n : standard;
}

/** Auflösung von Alias auf Bauplanname; null, wenn unbekannt. */
function loeseNamen(name) {
  if (typeof name !== 'string') return null;
  if (KLANGNAMEN.indexOf(name) >= 0) return name;
  if (Object.prototype.hasOwnProperty.call(KLANG_ALIASE, name)) return KLANG_ALIASE[name];
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. DIE STUMME BANK — dieselbe API, die nichts tut
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Vollständiges No-Op mit identischer Schnittstelle. Wird geliefert, wenn es
 * keinen AudioContext gibt oder seine Erzeugung scheitert. Jede Methode ist
 * aufrufbar, keine wirft, `verfuegbar` ist false.
 */
function stummeBank(grund) {
  const bank = {
    verfuegbar: false,
    grund: grund || 'kein AudioContext',
    namen: klangNamen(),
    play(name) {
      if (loeseNamen(name)) return false;
      warnEinmal('unbekannt:' + name,
        `[sound] Unbekannter Klang "${name}" — ignoriert. Bekannt: ${KLANGNAMEN.join(', ')}`);
      return false;
    },
    atmo() { return false; },
    atmoStart() { return false; },
    atmoStop() { return false; },
    setLautstaerke() { return 0; },
    setStumm() { return true; },
    gong(art) {
      if (GONG_ARTEN.indexOf(art) < 0 && art !== undefined) {
        warnEinmal('gong:' + art, `[sound] Unbekannte Gongart "${art}" — ignoriert.`);
      }
      return false;
    },
    aufsetzer() { return false; },
    netz() { return false; },
    pfosten() { return false; },
    mauer() { return false; },
    pfiff(art) {
      if (PFIFF_ARTEN.indexOf(art) < 0 && art !== undefined) {
        warnEinmal('pfiff:' + art, `[sound] Unbekannte Pfiffart "${art}" — ignoriert.`);
      }
      return false;
    },
    aufwecken() { return Promise.resolve(false); },
    status() {
      return { verfuegbar: false, grund: bank.grund, laeuft: false, stumm: true, lautstaerke: 0, stimmen: 0 };
    },
    destroy() { return true; }
  };
  return bank;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. PUFFER — Rauschen, Trommelschleife, Impulsantwort des Stadions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rauschpuffer, am Schleifenpunkt kreuzgeblendet: Das letzte Viertelsekunden-
 * fenster wird mit dem Anfang gleichleistungsgemischt, deshalb ist der Übergang
 * bei loop=true stetig — keine Knackser, egal wie lange die Schleife läuft.
 *
 * rosa=true liefert rosa Rauschen (Kellet-Filter). Eine Menschenmenge ist rosa,
 * weißes Rauschen zischt wie ein Fernseher ohne Programm.
 */
function baueRauschen(ctx, rng, dauer, rosa) {
  const sr = ctx.sampleRate;
  const len = Math.max(1024, Math.round(sr * dauer));
  const ueber = Math.min(Math.round(sr * 0.25), Math.floor(len / 4));
  const roh = new Float32Array(len + ueber);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < roh.length; i++) {
    const w = rng.float(-1, 1);
    if (rosa) {
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      roh[i] = (b0 + b1 + b2 + w * 0.1848) * 0.24;
    } else {
      roh[i] = w * 0.7;
    }
  }
  const puffer = ctx.createBuffer(1, len, sr);
  const d = puffer.getChannelData(0);
  d.set(roh.subarray(0, len));
  for (let i = 0; i < ueber; i++) {
    const t = i / ueber;
    d[i] = roh[i] * Math.sin(t * Math.PI / 2) + roh[len + i] * Math.cos(t * Math.PI / 2);
  }
  return puffer;
}

/**
 * Impulsantwort eines großen, halboffenen Stadions:
 * kurzes Vorlaufloch, ein paar frühe Reflexionen vom Dach, danach ein diffuser
 * Schwanz, der über einen wandernden Einpol-Tiefpass immer dumpfer wird —
 * genau so klingt eine Betonschüssel. Auf Einheitsenergie normiert, damit der
 * Hall nicht je nach Abtastrate lauter oder leiser wird.
 */
function baueHallraum(ctx, rng, dauer) {
  const sr = ctx.sampleRate;
  const len = Math.max(256, Math.round(sr * dauer));
  const puffer = ctx.createBuffer(2, len, sr);
  const vorlauf = Math.round(sr * 0.013);
  /* Frühe Reflexionen: Dach, Gegengerade, Hintertorbereich. */
  const REFLEXE = [[0.021, 0.55], [0.034, 0.42], [0.055, 0.36], [0.081, 0.28], [0.112, 0.22]];

  for (let ch = 0; ch < 2; ch++) {
    const d = puffer.getChannelData(ch);
    let tp = 0;
    for (let i = vorlauf; i < len; i++) {
      const t = (i - vorlauf) / (len - vorlauf);
      const abfall = Math.pow(1 - t, 2.1) * Math.exp(-t * 2.4);
      const a = 0.38 - 0.32 * t;                 // Grenzfrequenz wandert nach unten
      tp += a * (rng.float(-1, 1) - tp);
      d[i] = tp * abfall;
    }
    for (let r = 0; r < REFLEXE.length; r++) {
      const versatz = REFLEXE[r][0] * (ch ? 1.14 : 0.93);   // Kanäle leicht versetzt = Breite
      const idx = vorlauf + Math.round(sr * versatz);
      if (idx < len) d[idx] += REFLEXE[r][1] * (ch ? -1 : 1);
    }
    let energie = 0;
    for (let i = 0; i < len; i++) energie += d[i] * d[i];
    const norm = energie > 0 ? 1 / Math.sqrt(energie) : 1;
    for (let i = 0; i < len; i++) d[i] *= norm;
  }
  return puffer;
}

/**
 * Trommelschleife der Ultras: vier Schläge, langsamer Puls, jeder zweite betont.
 * Der letzte Schlag ist lange vor dem Schleifenende ausgeklungen — deshalb ist
 * die Naht still und die Schleife läuft ohne Klick, ohne jeden Zeitgeber.
 */
function baueTrommelschleife(ctx, rng) {
  const sr = ctx.sampleRate;
  const takt = 60 / 88;                       // 88 Schläge/Minute
  const schlaege = 4;
  const len = Math.round(sr * takt * schlaege);
  const puffer = ctx.createBuffer(1, len, sr);
  const d = puffer.getChannelData(0);

  for (let s = 0; s < schlaege; s++) {
    const start = Math.round(s * takt * sr);
    const betont = (s % 2) === 0;
    const spitze = betont ? 1 : 0.6;
    const f0 = betont ? 94 : 87, f1 = 46;
    const abkling = betont ? 0.32 : 0.24;
    const n = Math.min(Math.round(sr * abkling * 2.2), len - start - 2);
    let phase = 0, tp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = f1 + (f0 - f1) * Math.exp(-t * 24);
      phase += 2 * Math.PI * f / sr;
      const huell = Math.exp(-t / abkling);
      const schlag = t < 0.03 ? rng.float(-1, 1) * Math.exp(-t * 240) : 0;
      tp += 0.30 * (schlag - tp);
      d[start + i] += (Math.sin(phase) * huell + tp * 0.8) * spitze * 0.72;
    }
  }
  const blende = Math.round(sr * 0.012);
  for (let i = 0; i < blende; i++) d[len - 1 - i] *= i / blende;
  return puffer;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. DIE ECHTE BANK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Erzeugt die Tonbank.
 *
 * @param {object} [opts] siehe STD oben
 * @returns {object} bank mit play/atmo/atmoStart/atmoStop/setLautstaerke/
 *                   setStumm/gong/aufwecken/status/destroy und `verfuegbar`.
 *                   Ohne WebAudio: dieselbe API als No-Op, `verfuegbar === false`.
 */
export function createSoundBank(opts) {
  const o = Object.assign({}, STD, opts || {});

  /* --- 6.1 Kontext beschaffen; scheitert das, ist hier Schluss ------------ */
  let ctx = null;
  let eigenerKontext = false;
  if (o.kontext && typeof o.kontext.createGain === 'function') {
    ctx = o.kontext;
  } else {
    const Klasse = audioKlasse();
    if (!Klasse) return stummeBank('kein AudioContext in dieser Umgebung');
    try {
      ctx = new Klasse();
      eigenerKontext = true;
    } catch (e) {
      return stummeBank('AudioContext ließ sich nicht öffnen: ' + (e && e.message));
    }
  }
  if (!ctx || typeof ctx.createGain !== 'function' || !ctx.destination) {
    return stummeBank('AudioContext unvollständig');
  }

  const rng = createRng(o.seed);
  const jetzt = () => ctx.currentTime;

  /* --- 6.2 Feste Verkabelung -------------------------------------------- *
   * Quellen → effektBus/atmoBus → master → Begrenzer → Ausgang.
   * Der Begrenzer fängt ab, wenn Gong, Torjubel und Atmosphäre zusammenfallen.
   * -------------------------------------------------------------------- */
  let lautstaerke = clamp(zahl(o.lautstaerke, STD.lautstaerke), 0, 1);
  let stumm = !!o.stumm;
  o.maxStimmen = Math.max(1, Math.round(zahl(o.maxStimmen, STD.maxStimmen)));
  o.gastAnteil = clamp(zahl(o.gastAnteil, STD.gastAnteil), 0, 1);
  o.hallStaerke = clamp(zahl(o.hallStaerke, STD.hallStaerke), 0, 2);

  const begrenzer = ctx.createDynamicsCompressor();
  begrenzer.threshold.value = -7;
  begrenzer.knee.value = 8;
  begrenzer.ratio.value = 11;
  begrenzer.attack.value = 0.004;
  begrenzer.release.value = 0.2;
  begrenzer.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = stumm ? 0 : pegelKurve(lautstaerke);
  master.connect(begrenzer);

  const effektBus = ctx.createGain();
  effektBus.gain.value = o.effektPegel;
  effektBus.connect(master);

  const atmoBus = ctx.createGain();
  atmoBus.gain.value = o.atmoPegel;
  atmoBus.connect(master);

  /* Hallweg — erst beim ersten Klang gefüllt (die Impulsantwort kostet Rechenzeit) */
  let hallEin = null, hallRaum = null, hallAus = null;

  /* Puffer entstehen faul: createSoundBank() bleibt dadurch billig. */
  let rauschRosa = null, rauschWeiss = null, trommelPuffer = null;
  let puffersBereit = false;

  function puffernSicherstellen() {
    if (puffersBereit) return true;
    try {
      rauschRosa = baueRauschen(ctx, rng, 8, true);
      rauschWeiss = baueRauschen(ctx, rng, 2.5, false);
      trommelPuffer = baueTrommelschleife(ctx, rng);
      if (o.hall && typeof ctx.createConvolver === 'function') {
        hallRaum = ctx.createConvolver();
        hallRaum.normalize = false;
        hallRaum.buffer = baueHallraum(ctx, rng, 2.4);
        hallAus = ctx.createGain();
        hallAus.gain.value = 0.85;
        hallEin = ctx.createGain();
        hallEin.gain.value = 1;
        hallEin.connect(hallRaum);
        hallRaum.connect(hallAus);
        hallAus.connect(master);
      }
      puffersBereit = true;
    } catch (e) {
      warnEinmal('puffer', '[sound] Klangpuffer ließen sich nicht bauen: ' + (e && e.message));
      puffersBereit = false;
    }
    return puffersBereit;
  }

  /* --- 6.3 Kleine Werkzeuge --------------------------------------------- */

  /** Lautstärkeregler-Kennlinie: linear klingt oben zu flach. */
  function pegelKurve(v) { return Math.pow(clamp(v, 0, 1), 1.6); }

  function verstaerker(wert) {
    const g = ctx.createGain();
    g.gain.value = wert;
    return g;
  }

  function filter(typ, freq, guete, verstaerkung) {
    const f = ctx.createBiquadFilter();
    f.type = typ;
    const nyquist = (Number(ctx.sampleRate) || 44100) / 2;
    f.frequency.value = clamp(freq, 10, Math.max(200, nyquist - 500));
    if (guete !== undefined) f.Q.value = guete;
    if (verstaerkung !== undefined) f.gain.value = verstaerkung;
    return f;
  }

  function oszi(typ, freq) {
    const os = ctx.createOscillator();
    os.type = typ;
    os.frequency.value = freq;
    return os;
  }

  function rauschQuelle(rosa, rate) {
    const q = ctx.createBufferSource();
    q.buffer = rosa ? rauschRosa : rauschWeiss;
    q.loop = true;
    if (rate) q.playbackRate.value = rate;
    return q;
  }

  /** Zufälliger, aber deterministischer Einstiegspunkt in den Rauschpuffer. */
  function versatz(puffer) { return rng.float(0, Math.max(0.01, puffer.duration - 0.6)); }

  /**
   * Hüllkurve auf einen Gain-Param. Exponentiell, weil das Ohr so hört.
   * Liefert die Endzeit zurück — daran hängen die stop()-Aufrufe.
   */
  function huelle(param, t0, anstieg, halten, abfall, spitze) {
    const p = Math.max(spitze, 0.0002);
    param.cancelScheduledValues(t0);
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(p, t0 + Math.max(anstieg, 0.0005));
    const tHalt = t0 + Math.max(anstieg, 0.0005) + Math.max(halten, 0);
    if (halten > 0) param.setValueAtTime(p, tHalt);
    param.exponentialRampToValueAtTime(0.0001, tHalt + Math.max(abfall, 0.005));
    const ende = tHalt + Math.max(abfall, 0.005);
    param.setValueAtTime(0, ende + 0.002);
    return ende + 0.02;
  }

  /**
   * Tonhöhenfahrt von → bis. Der setValueAtTime-Anker ist Pflicht und keine
   * Zierde: Ohne vorheriges Ereignis beginnt WebAudio eine Rampe beim letzten
   * Ereignis — notfalls bei Kontextsekunde 0. Der Verlauf wäre dann längst
   * abgelaufen, bevor der Klang überhaupt anfängt, und jeder Aufprall klänge
   * nach einem stehenden Ton.
   */
  function fahrt(param, von, bis, t0, dauer) {
    param.cancelScheduledValues(t0);
    param.setValueAtTime(Math.max(von, 0.0001), t0);
    param.exponentialRampToValueAtTime(Math.max(bis, 0.0001), t0 + Math.max(dauer, 0.005));
  }

  /** Knickfreies Umsteuern eines Params: anhalten, festhalten, neu rampen. */
  function rampe(param, wert, t0, dauer) {
    param.cancelScheduledValues(t0);
    let ist = 0.0001;
    try { ist = param.value; } catch (e) { ist = 0.0001; }
    param.setValueAtTime(ist, t0);
    param.linearRampToValueAtTime(wert, t0 + Math.max(dauer, 0.01));
  }

  function machePanner(pan) {
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan || 0, -1, 1);
      return p;
    }
    return ctx.createGain();     // altes Safari: kein Panorama, aber Ton
  }

  /* --- 6.4 Stimmenverwaltung -------------------------------------------- */

  let stimmenAktiv = 0;
  let stimmenImBau = 0;              // Zähler für den Fehlerfall in play()
  const letzteAusloesung = Object.create(null);
  const timer = new Set();
  let zerstoert = false;

  function verzoegert(fn, ms) {
    const id = setTimeout(() => { timer.delete(id); fn(); }, ms);
    timer.add(id);
    return id;
  }

  /**
   * Eine Stimme: Pegel → Panorama → Effektbus (+ Hallweg).
   * `schliessen()` klemmt den ganzen Zweig ab, danach räumt ihn die Laufzeit weg.
   */
  function neueStimme(einst, hallAnteil) {
    const ein = verstaerker(einst.pegel);
    const pan = machePanner(einst.panorama);
    ein.connect(pan);
    pan.connect(effektBus);
    let send = null;
    const anteil = (hallAnteil === undefined ? 0.3 : hallAnteil) * o.hallStaerke;
    if (hallEin && anteil > 0) {
      send = verstaerker(anteil);
      pan.connect(send);
      send.connect(hallEin);
    }
    stimmenAktiv++;
    stimmenImBau++;
    return {
      ein,
      schliessen() {
        try { ein.disconnect(); } catch (e) { /* egal */ }
        try { pan.disconnect(); } catch (e) { /* egal */ }
        if (send) { try { send.disconnect(); } catch (e) { /* egal */ } }
      }
    };
  }

  /** Hängt das Aufräumen der Stimme an das Ende der zuletzt gestarteten Quelle. */
  function abschluss(quelle, stimme) {
    let erledigt = false;
    const weg = () => {
      if (erledigt) return;
      erledigt = true;
      stimme.schliessen();
      stimmenAktiv = Math.max(0, stimmenAktiv - 1);
    };
    try { quelle.onended = weg; } catch (e) { /* egal */ }
    /* Sicherheitsnetz: manche Umgebungen feuern onended nicht bei geschlossenem Kontext. */
    verzoegert(weg, 12000);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 7. DIE KLÄNGE — jeder Bauplan bekommt (t0, e) und liefert die Endzeit
  //    e = { pegel, hoehe, panorama, seite }
  // ═════════════════════════════════════════════════════════════════════════

  const KLANGBAU = {

    /* Bedienton: winziger Rauschstoß plus fallender Anschlag. Ganz trocken. */
    klick(t0, e) {
      const st = neueStimme(e, HALLANTEIL.klick);
      const q = rauschQuelle(false);
      const bp = filter('bandpass', 2000 * e.hoehe, 1.6);
      const g = verstaerker(0);
      q.connect(bp); bp.connect(g); g.connect(st.ein);
      const ende = huelle(g.gain, t0, 0.001, 0, 0.030, 0.6);

      const os = oszi('triangle', 1250 * e.hoehe);
      fahrt(os.frequency, 1250 * e.hoehe, 780 * e.hoehe, t0, 0.035);
      const og = verstaerker(0);
      os.connect(og); og.connect(st.ein);
      huelle(og.gain, t0, 0.001, 0, 0.028, 0.25);

      q.start(t0, versatz(rauschWeiss)); q.stop(ende);
      os.start(t0); os.stop(ende);
      abschluss(q, st);
      return ende;
    },

    /* Torschuss: tiefer Impuls, sehr schneller Abfall, obendrauf das Lederknacken. */
    schuss(t0, e) {
      const st = neueStimme(e, HALLANTEIL.schuss);
      const koerper = oszi('sine', 190 * e.hoehe);
      fahrt(koerper.frequency, 190 * e.hoehe, 52 * e.hoehe, t0, 0.09);
      const kg = verstaerker(0);
      const lp = filter('lowpass', 900 * e.hoehe, 0.9);
      koerper.connect(kg); kg.connect(lp); lp.connect(st.ein);
      const ende = huelle(kg.gain, t0, 0.002, 0.006, 0.15, 1.0);

      /* Das Knacken: 8 ms Rauschen weit oben, das dem Impuls die Kante gibt. */
      const q = rauschQuelle(false);
      const hp = filter('highpass', 1400 * e.hoehe, 0.7);
      const qg = verstaerker(0);
      q.connect(hp); hp.connect(qg); qg.connect(st.ein);
      huelle(qg.gain, t0, 0.0008, 0.001, 0.045, 0.42);

      koerper.start(t0); koerper.stop(ende);
      q.start(t0, versatz(rauschWeiss)); q.stop(ende);
      abschluss(koerper, st);
      return ende;
    },

    /* Tor: Netzrascheln, dann aufbrandender Jubel über 2–3 s. */
    tor(t0, e) {
      const gast = e.seite === 'gast';
      const st = neueStimme(e, HALLANTEIL.tor);

      /* Netz: drei kurze Rauschstöße — das Netz schwingt nach. */
      const netz = rauschQuelle(false, 1.0);
      const nbp = filter('bandpass', 2900 * e.hoehe, 0.9);
      const ng = verstaerker(0);
      netz.connect(nbp); nbp.connect(ng); ng.connect(st.ein);
      const p = ng.gain;
      p.cancelScheduledValues(t0);
      p.setValueAtTime(0.0001, t0);
      p.exponentialRampToValueAtTime(0.55, t0 + 0.006);
      p.exponentialRampToValueAtTime(0.05, t0 + 0.16);
      p.exponentialRampToValueAtTime(0.24, t0 + 0.19);
      p.exponentialRampToValueAtTime(0.03, t0 + 0.33);
      p.exponentialRampToValueAtTime(0.11, t0 + 0.36);
      p.exponentialRampToValueAtTime(0.0001, t0 + 0.62);
      netz.start(t0, versatz(rauschWeiss)); netz.stop(t0 + 0.7);

      /* Jubel: läuft die Atmosphäre, trägt sie die Hauptlast — dann hier leiser. */
      const ende = jubelStimme(t0 + 0.05, e, gast, atmoKnoten ? 0.55 : 1);
      if (atmoKnoten) jubelStoss(gast ? 'gast' : 'heim', 1);
      abschluss(netz, st);
      return Math.max(ende, t0 + 0.8);
    },

    /* Parade: Handschuh am Ball. Dumpfer als der Schuss, aber höher. */
    parade(t0, e) {
      const st = neueStimme(e, HALLANTEIL.parade);
      const os = oszi('sine', 300 * e.hoehe);
      fahrt(os.frequency, 300 * e.hoehe, 140 * e.hoehe, t0, 0.07);
      const og = verstaerker(0);
      os.connect(og); og.connect(st.ein);
      const ende = huelle(og.gain, t0, 0.003, 0.004, 0.11, 0.8);

      const q = rauschQuelle(false);
      const lp = filter('lowpass', 1100 * e.hoehe, 1.1);
      const qg = verstaerker(0);
      q.connect(lp); lp.connect(qg); qg.connect(st.ein);
      huelle(qg.gain, t0, 0.001, 0.004, 0.06, 0.55);

      os.start(t0); os.stop(ende);
      q.start(t0, versatz(rauschWeiss)); q.stop(ende);
      abschluss(os, st);
      return ende;
    },

    /* Pfosten/Latte: der Aufprall — und dann dieses Geräusch, das jeder kennt.
       Tiefer Aufschlag plus drei metallische Teiltöne mit langem Nachklang. */
    pfosten(t0, e) {
      const st = neueStimme(e, HALLANTEIL.pfosten);
      const f0 = 332 * e.hoehe;

      /* Der Aufschlag des Balls */
      const dumpf = oszi('sine', 130 * e.hoehe);
      fahrt(dumpf.frequency, 130 * e.hoehe, 68 * e.hoehe, t0, 0.06);
      const dg = verstaerker(0);
      dumpf.connect(dg); dg.connect(st.ein);
      huelle(dg.gain, t0, 0.002, 0.002, 0.10, 0.7);
      dumpf.start(t0); dumpf.stop(t0 + 0.2);

      /* Die Anregung: 5 ms Rauschen durch schmale Resonanzen — das „Klack" */
      const q = rauschQuelle(false);
      const anregung = verstaerker(0);
      q.connect(anregung);
      huelle(anregung.gain, t0, 0.0008, 0.002, 0.02, 1);

      /* Teiltöne eines Aluminiumrohrs: 1 : 2.76 : 5.40 */
      const TEIL = [[1, 0.85, 0.95], [2.76, 0.40, 0.42], [5.40, 0.18, 0.22]];
      let ende = t0 + 0.3;
      for (let i = 0; i < TEIL.length; i++) {
        const rel = TEIL[i][0], pegel = TEIL[i][1], abkling = TEIL[i][2];
        const bp = filter('bandpass', f0 * rel, 46);
        const bg = verstaerker(pegel * 0.9);
        anregung.connect(bp); bp.connect(bg); bg.connect(st.ein);

        const os = oszi('sine', f0 * rel * (1 + (i * 0.0013)));
        const og = verstaerker(0);
        os.connect(og); og.connect(st.ein);
        const bis = huelle(og.gain, t0 + 0.004, 0.004, 0, abkling, pegel * 0.55);
        os.start(t0); os.stop(bis);
        ende = Math.max(ende, bis);
      }
      q.start(t0, versatz(rauschWeiss)); q.stop(ende);
      abschluss(q, st);
      return ende;
    },

    /* Block: Bein vor dem Ball. Kurz, dumpf, ohne Glanz. */
    block(t0, e) {
      const st = neueStimme(e, HALLANTEIL.block);
      const q = rauschQuelle(false);
      const lp = filter('lowpass', 430 * e.hoehe, 1.4);
      const qg = verstaerker(0);
      q.connect(lp); lp.connect(qg); qg.connect(st.ein);
      const ende = huelle(qg.gain, t0, 0.001, 0.006, 0.075, 0.85);

      const os = oszi('sine', 128 * e.hoehe);
      fahrt(os.frequency, 128 * e.hoehe, 80 * e.hoehe, t0, 0.05);
      const og = verstaerker(0);
      os.connect(og); og.connect(st.ein);
      huelle(og.gain, t0, 0.002, 0.002, 0.07, 0.5);

      q.start(t0, versatz(rauschWeiss)); q.stop(ende);
      os.start(t0); os.stop(ende);
      abschluss(q, st);
      return ende;
    },

    pfiff(t0, e) { return trillerpfeife(t0, 0.34, e, 1); },

    /* Anpfiff: länger, und am Ende hebt der Schiedsrichter die Tonhöhe. */
    anpfiff(t0, e) { return trillerpfeife(t0, 0.80, e, 1, 0.06); },

    /* Abpfiff: dreimal kurz. Der dritte darf einen Hauch länger stehen —
       so pfeift jeder Schiedsrichter ab, und niemand hört „gleich lang". */
    abpfiff(t0, e) {
      trillerpfeife(t0, 0.17, e, 1);
      trillerpfeife(t0 + 0.31, 0.17, e, 1.004);
      return trillerpfeife(t0 + 0.62, 0.38, e, 0.996);
    },

    /* Karte: trocken, kurz, ohne Hall. Rot bekommt hoehe 0.7 vom Aufrufer. */
    karte(t0, e) {
      const st = neueStimme(e, HALLANTEIL.karte);
      const os = oszi('square', 760 * e.hoehe);
      const lp = filter('lowpass', 2200 * e.hoehe, 0.8);
      const og = verstaerker(0);
      os.connect(og); og.connect(lp); lp.connect(st.ein);
      const ende = huelle(og.gain, t0, 0.002, 0.012, 0.055, 0.45);

      const q = rauschQuelle(false);
      const bp = filter('bandpass', 3100 * e.hoehe, 2.2);
      const qg = verstaerker(0);
      q.connect(bp); bp.connect(qg); qg.connect(st.ein);
      huelle(qg.gain, t0, 0.0008, 0, 0.02, 0.3);

      os.start(t0); os.stop(ende);
      q.start(t0, versatz(rauschWeiss)); q.stop(ende);
      abschluss(os, st);
      return ende;
    },

    /* Wechsel: die Anzeigetafel. Zwei Piepser, elektrisch und billig — mit Absicht. */
    wechsel(t0, e) {
      const st = neueStimme(e, HALLANTEIL.wechsel);
      const lp = filter('lowpass', 4200 * e.hoehe, 0.9);
      lp.connect(st.ein);
      const TOENE = [[0, 1046.5], [0.14, 1568.0]];
      let ende = t0;
      for (let i = 0; i < TOENE.length; i++) {
        const t = t0 + TOENE[i][0];
        const os = oszi('square', TOENE[i][1] * e.hoehe);
        const og = verstaerker(0);
        os.connect(og); og.connect(lp);
        const bis = huelle(og.gain, t, 0.004, 0.055, 0.05, 0.3);
        os.start(t); os.stop(bis);
        ende = Math.max(ende, bis);
        if (i === TOENE.length - 1) abschluss(os, st);
      }
      return ende;
    },

    jubel(t0, e) {
      const ende = jubelStimme(t0, e, e.seite === 'gast', atmoKnoten ? 0.6 : 1);
      if (atmoKnoten) jubelStoss(e.seite === 'gast' ? 'gast' : 'heim', 0.85);
      return ende;
    },

    /* Raunen: das enttäuschte „Ooooh". Ein Band, das im Fallen dunkler wird. */
    raunen(t0, e) {
      const st = neueStimme(e, HALLANTEIL.raunen);
      const q = rauschQuelle(true, 0.95);
      const bp = filter('bandpass', 540 * e.hoehe, 1.5);
      bp.frequency.setValueAtTime(560 * e.hoehe, t0);
      bp.frequency.exponentialRampToValueAtTime(290 * e.hoehe, t0 + 1.3);
      const ober = filter('bandpass', 1150 * e.hoehe, 2.2);
      const og = verstaerker(0.3);
      const g = verstaerker(0);
      q.connect(bp); bp.connect(g);
      q.connect(ober); ober.connect(og); og.connect(g);
      g.connect(st.ein);
      const ende = huelle(g.gain, t0, 0.28, 0.15, 1.25, 0.9);
      q.start(t0, versatz(rauschRosa)); q.stop(ende);
      abschluss(q, st);
      return ende;
    },

    /* Pfeifkonzert: viele Trillerpfeifen auf einmal — schmale Resonanzen im Rauschen. */
    pfeifkonzert(t0, e) {
      const st = neueStimme(e, HALLANTEIL.pfeifkonzert);
      const q = rauschQuelle(false, 1.0);
      const g = verstaerker(0);
      const RES = [[2320, 13, 1.0], [2760, 16, 0.8], [3180, 11, 0.6], [1740, 9, 0.35]];
      for (let i = 0; i < RES.length; i++) {
        const bp = filter('bandpass', RES[i][0] * e.hoehe, RES[i][1]);
        const bg = verstaerker(RES[i][2]);
        q.connect(bp); bp.connect(bg); bg.connect(g);
      }
      g.connect(st.ein);
      const ende = huelle(g.gain, t0, 0.35, 0.9, 0.9, 0.55);
      q.start(t0, versatz(rauschWeiss)); q.stop(ende);
      abschluss(q, st);
      if (atmoKnoten) pfeifStoss(0.7);
      return ende;
    },

    /* Ein einzelner Trommelschlag der Kurve. */
    trommel(t0, e) {
      const st = neueStimme(e, HALLANTEIL.trommel);
      const q = ctx.createBufferSource();
      q.buffer = trommelPuffer;
      q.playbackRate.value = clamp(e.hoehe, 0.5, 2);
      const lp = filter('lowpass', 1600, 0.8);
      q.connect(lp); lp.connect(st.ein);
      const ende = t0 + 0.75 / clamp(e.hoehe, 0.5, 2);
      q.start(t0, 0, 0.7);
      q.stop(ende);
      abschluss(q, st);
      return ende;
    },

    gong(t0, e) { return gongSatz('aufstellung', t0, e); }
  };

  /* --- 7.1 Bausteine, die mehrere Klänge teilen -------------------------- */

  /**
   * Trillerpfeife: zwei leicht verstimmte Sinusse plus Oktavanteil, alles mit
   * schnellem Vibrato (die Erbse im Pfeifenkopf), dazu eine Atemschicht aus
   * gefiltertem Rauschen. `steigung` hebt die Tonhöhe zum Schluss an.
   */
  function trillerpfeife(t0, laenge, e, verstimmung, steigung) {
    const st = neueStimme(e, HALLANTEIL.pfiff);
    const f = 2680 * e.hoehe * (verstimmung || 1);
    const summe = verstaerker(0);
    summe.connect(st.ein);

    /* Vibrato — eine Erbse rasselt mit gut 26 Hz */
    const lfo = oszi('sine', 26);
    const lfoTiefe = verstaerker(58 * e.hoehe);
    lfo.connect(lfoTiefe);

    const TEIL = [[1.000, 1.00], [1.007, 0.85], [1.503, 0.30], [2.010, 0.18]];
    const oszis = [];
    for (let i = 0; i < TEIL.length; i++) {
      const os = oszi('sine', f * TEIL[i][0]);
      if (steigung) {
        os.frequency.setValueAtTime(f * TEIL[i][0], t0);
        os.frequency.linearRampToValueAtTime(f * TEIL[i][0] * (1 + steigung), t0 + laenge);
      }
      lfoTiefe.connect(os.frequency);
      const g = verstaerker(TEIL[i][1]);
      os.connect(g); g.connect(summe);
      os.start(t0);
      oszis.push(os);
    }

    /* Atem */
    const q = rauschQuelle(false);
    const bp = filter('bandpass', f * 1.08, 5);
    const qg = verstaerker(0.22);
    q.connect(bp); bp.connect(qg); qg.connect(summe);

    const ende = huelle(summe.gain, t0, 0.012, Math.max(laenge - 0.06, 0.02), 0.05, 0.75);
    /* Alles endet auf denselben Zeitpunkt — nichts läuft weiter, nachdem die
       Stimme abgeklemmt ist. */
    for (let i = 0; i < oszis.length; i++) oszis[i].stop(ende);
    lfo.start(t0); lfo.stop(ende);
    q.start(t0, versatz(rauschWeiss)); q.stop(ende);
    abschluss(q, st);
    return ende;
  }

  /**
   * Freistehender Jubel: ein Rauschband, das über eine halbe Sekunde aufbrandet,
   * dabei heller wird und dann über zwei Sekunden abebbt.
   */
  function jubelStimme(t0, e, gast, faktor) {
    const st = neueStimme({
      pegel: e.pegel * (faktor === undefined ? 1 : faktor) * (gast ? 0.75 : 1),
      panorama: gast ? o.gastPanorama : clamp(e.panorama + o.heimPanorama, -1, 1)
    }, HALLANTEIL.jubel);

    const q = rauschQuelle(true, gast ? 1.08 : 1.0);
    const bp = filter('bandpass', 520, 0.75);
    bp.frequency.setValueAtTime(480, t0);
    bp.frequency.linearRampToValueAtTime(1080, t0 + 0.55);
    bp.frequency.setTargetAtTime(720, t0 + 0.9, 1.4);
    const glanz = filter('highpass', 1800, 0.6);
    const gg = verstaerker(0.35);
    const g = verstaerker(0);
    q.connect(bp); bp.connect(g);
    q.connect(glanz); glanz.connect(gg); gg.connect(g);
    g.connect(st.ein);

    const p = g.gain;
    p.cancelScheduledValues(t0);
    p.setValueAtTime(0.0001, t0);
    p.linearRampToValueAtTime(0.9, t0 + 0.42);
    p.setTargetAtTime(0.0001, t0 + 0.6, 0.85);
    const ende = t0 + 3.2;
    p.setValueAtTime(0, ende);

    q.start(t0, versatz(rauschRosa)); q.stop(ende + 0.05);
    abschluss(q, st);
    return ende;
  }

  /** Stadionsprecher-Gong: harmonische Teiltöne, weicher Anschlag, langer Ausklang. */
  function gongSatz(art, t0, e) {
    const satz = GONG_SATZ[art] || GONG_SATZ.aufstellung;
    const st = neueStimme(e, HALLANTEIL.gong);

    /* Der Gong kommt aus einer Lautsprecheranlage, nicht aus dem Konzertsaal. */
    const anlageHP = filter('highpass', 240, 0.7);
    const anlageLP = filter('lowpass', 4200 * e.hoehe, 0.8);
    anlageHP.connect(anlageLP);
    anlageLP.connect(st.ein);

    /* Teilton, Pegel, relative Ausklinglänge. Nur die beiden untersten werden
       verdoppelt und leicht verstimmt — dort trägt die Schwebung, weiter oben
       kostet sie nur Oszillatoren. */
    const TEIL = [[1, 1.00, 1.00, 2], [2, 0.42, 0.72, 2], [3, 0.20, 0.52, 1],
    [4.2, 0.11, 0.36, 1], [5.4, 0.06, 0.26, 1]];
    let ende = t0;
    let letzterOszi = null;
    for (let n = 0; n < satz.toene.length; n++) {
      const tn = t0 + n * satz.abstand;
      const grund = satz.toene[n] * e.hoehe;
      for (let i = 0; i < TEIL.length; i++) {
        const rel = TEIL[i][0], pegel = TEIL[i][1] * satz.glanz, laenge = TEIL[i][2];
        for (let d = 0; d < TEIL[i][3]; d++) {
          const os = oszi('sine', grund * rel * (d ? 1.0016 : 1));
          const g = verstaerker(0);
          os.connect(g); g.connect(anlageHP);
          const bis = huelle(g.gain, tn, 0.012, 0, satz.ausklang * laenge, pegel * 0.28);
          os.start(tn); os.stop(bis);
          if (bis >= ende) { ende = bis; letzterOszi = os; }
        }
      }
      /* Anschlag */
      const q = rauschQuelle(false);
      const bp = filter('bandpass', grund * 2.4, 3);
      const qg = verstaerker(0);
      q.connect(bp); bp.connect(qg); qg.connect(anlageHP);
      huelle(qg.gain, tn, 0.001, 0.002, 0.05, 0.22 * satz.glanz);
      q.start(tn, versatz(rauschWeiss));
      q.stop(tn + 0.2);
    }
    /* Aufgeräumt wird am Ende des LÄNGSTEN Teiltons — der Anschlag ist nach
       0,2 s vorbei, der Ausklang steht noch Sekunden im Raum. Hinge das
       Abklemmen am Anschlag, wäre der Gong abgeschnitten. */
    if (letzterOszi) abschluss(letzterOszi, st);
    return ende;
  }

  /* --- 7.2 Zusatzklänge des Spielfelds ----------------------------------- *
   * Zwei neue Baupläne (Aufsetzer, Netz) mit denselben Mitteln wie oben:
   * Oszillator, Rauschpuffer, Biquad, Hüllkurve auf einem Gain. Aluminium und
   * Mauer brauchen keinen eigenen — sie benutzen KLANGBAU.pfosten bzw.
   * KLANGBAU.block, denn genau das ist der Vorgang. Zwei Baupläne für dasselbe
   * Geräusch würden nur auseinanderlaufen.
   * ---------------------------------------------------------------------- */

  /**
   * Aufsetzer: der Ball trifft den Rasen. Kurz, dumpf, ohne Nachklang.
   *
   * Die Wucht 0..1 steuert beides — Lautstärke UND Tiefpass. Das ist der
   * ganze Trick: ein sanft abgelegter Ball plumpst unterhalb von 300 Hz und
   * ist von oben kaum mehr als ein Tupfer, ein langer Ball aus vierzig Metern
   * schlägt mit hörbarer Kante auf. Ohne die wandernde Grenzfrequenz klingt
   * jeder Bodenkontakt gleich und man liest ihn nicht mehr als Aufprall.
   */
  function bauAufsetzer(t0, e, wucht) {
    const st = neueStimme(e, ZUSATZ_HALL.aufsetzer * (0.4 + 0.6 * wucht));
    const lp = filter('lowpass', (300 + 1450 * wucht) * e.hoehe, 1.05);
    lp.connect(st.ein);

    /* Der Bodenkontakt: ein Rauschstoß, dem der Tiefpass die Höhen nimmt. */
    const q = rauschQuelle(false);
    const qg = verstaerker(0);
    q.connect(qg); qg.connect(lp);
    const abfall = 0.042 + 0.050 * wucht;
    const ende = huelle(qg.gain, t0, 0.001, 0.003, abfall, 0.30 + 0.55 * wucht);

    /* Darunter der Körper des Balls: fällt in 50 ms auf den Rasenton. */
    const f0 = (84 + 56 * wucht) * e.hoehe;
    const os = oszi('sine', f0);
    fahrt(os.frequency, f0, 44 * e.hoehe, t0, 0.05);
    const og = verstaerker(0);
    os.connect(og); og.connect(lp);
    const bis = huelle(og.gain, t0, 0.002, 0.002, abfall * 1.25, 0.28 + 0.42 * wucht);

    const schluss = Math.max(ende, bis);
    q.start(t0, versatz(rauschWeiss)); q.stop(schluss);
    os.start(t0); os.stop(schluss);
    abschluss(os, st);
    return schluss;
  }

  /**
   * Netz: der Ball wühlt sich ins Maschenwerk.
   *
   * Die Eindringtiefe (Wucht 0..1) bestimmt die Länge — 80 ms beim Abstauber
   * aus zwei Metern, 180 ms beim Vollspann, der das Netz noch einmal
   * nachschwingen lässt. Das Band fährt dabei nach unten: die Maschen rascheln
   * hell, die auslaufende Bewegung ist dumpf.
   */
  function bauNetz(t0, e, wucht) {
    const laenge = 0.08 + 0.10 * wucht;             // 80..180 ms
    const st = neueStimme(e, ZUSATZ_HALL.netz);
    const q = rauschQuelle(false, 0.92 + 0.26 * wucht);
    const bp = filter('bandpass', 3100 * e.hoehe, 0.85);
    fahrt(bp.frequency, 3100 * e.hoehe, 1750 * e.hoehe, t0, laenge);
    const g = verstaerker(0);
    q.connect(bp); bp.connect(g); g.connect(st.ein);

    /* Anschlag, Nachschwingen, Ausklingen — von Hand gesetzt, weil huelle()
       nur eine einzige Spitze kennt. Dieselbe Machart wie beim Netz in tor(). */
    const spitze = 0.34 + 0.46 * wucht;
    const p = g.gain;
    p.cancelScheduledValues(t0);
    p.setValueAtTime(0.0001, t0);
    p.exponentialRampToValueAtTime(spitze, t0 + 0.006);
    p.exponentialRampToValueAtTime(spitze * 0.16, t0 + laenge * 0.45);
    p.exponentialRampToValueAtTime(spitze * 0.42, t0 + laenge * 0.60);
    p.exponentialRampToValueAtTime(0.0001, t0 + laenge);
    p.setValueAtTime(0, t0 + laenge + 0.002);
    const ende = t0 + laenge + 0.02;

    q.start(t0, versatz(rauschWeiss)); q.stop(ende);
    abschluss(q, st);
    return ende;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 8. STADIONATMOSPHÄRE
  //    Ein einziger, dauerhaft stehender Graph. Nichts wird nachgebaut,
  //    alles bewegt sich über AudioParam-Rampen im Audio-Thread.
  // ═════════════════════════════════════════════════════════════════════════

  let atmoKnoten = null;
  let atmoLaeuft = false;
  let letzterZustand = {
    zuschauer: 0, kapazitaet: 1, stimmung: 55, heimFuehrung: 0,
    minute: 0, druck: 0, heimAngriff: false, auswaertsAngriff: false
  };
  let letzteAtmoZeit = -1;

  /* Rohes Rauschband: Quelle → Filterkette → Pegel → Ziel. */
  function band(A, quelle, kette, ziel, startPegel) {
    let knoten = quelle;
    const filterListe = [];
    for (let i = 0; i < kette.length; i++) {
      const f = filter(kette[i][0], kette[i][1], kette[i][2]);
      knoten.connect(f);
      knoten = f;
      filterListe.push(f);
      A.teile.push(f);
    }
    const g = verstaerker(startPegel || 0);
    knoten.connect(g);
    g.connect(ziel);
    A.teile.push(g);
    return { g, f: filterListe[0] };
  }

  function atmoAufbauen() {
    const A = { teile: [], quellen: [], letzte: Object.create(null) };
    const t = jetzt() + 0.03;

    A.aus = verstaerker(0.0001);
    A.aus.connect(atmoBus);
    A.teile.push(A.aus);
    if (hallEin) {
      A.hall = verstaerker(0.20 * o.hallStaerke);
      A.aus.connect(A.hall);
      A.hall.connect(hallEin);
      A.teile.push(A.hall);
    }

    /* Heimkurve und Auswärtsblock als getrennte Gruppen, getrennt im Panorama. */
    A.heim = verstaerker(1);
    A.heimPan = machePanner(o.heimPanorama);
    A.heim.connect(A.heimPan); A.heimPan.connect(A.aus);
    A.teile.push(A.heim, A.heimPan);

    A.gast = verstaerker(1);
    A.gastPan = machePanner(o.gastPanorama);
    A.gast.connect(A.gastPan); A.gastPan.connect(A.aus);
    A.teile.push(A.gast, A.gastPan);

    /* Vier Rauschquellen mit unterschiedlicher Geschwindigkeit und Startstelle:
       so hört man nirgends heraus, dass es dieselben acht Sekunden sind. */
    const RATEN = [1.0, 0.86, 1.17, 0.73];
    for (let i = 0; i < RATEN.length; i++) {
      const q = rauschQuelle(true, RATEN[i]);
      q.start(t, versatz(rauschRosa));
      A.quellen.push(q);
      A.teile.push(q);
    }
    const [qa, qb, qc, qd] = A.quellen;

    /* Heimkurve: Rumpeln, Masse, Zischen */
    A.tief = band(A, qa, [['bandpass', 105, 0.8]], A.heim, 0);
    A.mitte = band(A, qb, [['bandpass', 480, 0.6]], A.heim, 0);
    A.hoch = band(A, qc, [['highpass', 2000, 0.5], ['lowpass', 7000, 0.7]], A.heim, 0);

    /* Torjubel der Heimkurve — eigener Zweig über dem Grundrauschen */
    A.jubel = band(A, qb, [['bandpass', 620, 0.8]], A.heim, 0);

    /* Pfeifkonzert: schmale Resonanzen. Der Modulator lässt es an- und abschwellen. */
    A.pfeifMod = verstaerker(0.7);
    A.pfeifMod.connect(A.heim);
    A.teile.push(A.pfeifMod);
    A.pfeif = verstaerker(0);
    A.pfeif.connect(A.pfeifMod);
    A.teile.push(A.pfeif);
    const PRES = [[2320, 13, 1.0], [2760, 16, 0.75], [3180, 11, 0.5]];
    for (let i = 0; i < PRES.length; i++) {
      const bp = filter('bandpass', PRES[i][0], PRES[i][1]);
      const bg = verstaerker(PRES[i][2]);
      qc.connect(bp); bp.connect(bg); bg.connect(A.pfeif);
      A.teile.push(bp, bg);
    }

    /* Trommeln: eine fertig berechnete Schleife. Kostet keinen Zeitgeber. */
    A.trommelQ = ctx.createBufferSource();
    A.trommelQ.buffer = trommelPuffer;
    A.trommelQ.loop = true;
    A.trommelLP = filter('lowpass', 1500, 0.8);
    A.trommel = verstaerker(0);
    A.trommelQ.connect(A.trommelLP);
    A.trommelLP.connect(A.trommel);
    A.trommel.connect(A.heim);
    A.trommelQ.start(t, 0);
    A.teile.push(A.trommelQ, A.trommelLP, A.trommel);

    /* Auswärtsblock: kleiner, eigene Quelle, eigenes Panorama. */
    A.gastMitte = band(A, qd, [['bandpass', 600, 0.65]], A.gast, 0);
    A.gastHoch = band(A, qa, [['highpass', 2300, 0.5], ['lowpass', 7500, 0.7]], A.gast, 0);
    A.gastJubel = band(A, qd, [['bandpass', 700, 0.85]], A.gast, 0);

    /* Atmen: sehr langsame, unterschiedlich schnelle Modulationen. Ohne sie
       klingt eine Menge wie ein Staubsauger. */
    A.lfos = [];
    const lfo = (freq, tiefe, ziel) => {
      const os = oszi('sine', freq);
      const g = verstaerker(tiefe);
      os.connect(g); g.connect(ziel);
      os.start(t);
      A.lfos.push(os);
      A.teile.push(os, g);
    };
    lfo(0.083, 0.10, A.mitte.g.gain);
    lfo(0.041, 0.055, A.hoch.g.gain);
    lfo(0.190, 0.26, A.pfeifMod.gain);
    lfo(0.057, 0.06, A.gastMitte.g.gain);
    lfo(0.029, 0.05, A.tief.g.gain);

    return A;
  }

  function atmoAbbauen(A) {
    if (!A) return;
    for (let i = 0; i < A.quellen.length; i++) {
      try { A.quellen[i].stop(); } catch (e) { /* egal */ }
    }
    for (let i = 0; i < A.lfos.length; i++) {
      try { A.lfos[i].stop(); } catch (e) { /* egal */ }
    }
    try { A.trommelQ.stop(); } catch (e) { /* egal */ }
    for (let i = 0; i < A.teile.length; i++) {
      try { A.teile[i].disconnect(); } catch (e) { /* egal */ }
    }
    A.teile.length = 0;
  }

  /** Zielwert setzen: schnell hoch, langsam runter — so atmet ein Stadion. */
  function setz(A, param, schluessel, wert, tauAuf, tauAb) {
    const vorher = A.letzte[schluessel] === undefined ? 0 : A.letzte[schluessel];
    const t = jetzt();
    param.setTargetAtTime(Math.max(wert, 0), t, wert > vorher ? (tauAuf || 0.35) : (tauAb || 1.6));
    A.letzte[schluessel] = wert;
  }

  /**
   * Fortschreiben der Atmosphäre. Wird beliebig oft aufgerufen (Ticker, Frame);
   * mehr als 25 Aktualisierungen je Sekunde bringen nichts und werden verworfen.
   */
  function atmoAnwenden(z, erzwingen) {
    const A = atmoKnoten;
    if (!A) return false;
    const t = jetzt();
    if (!erzwingen && letzteAtmoZeit >= 0 && t - letzteAtmoZeit < 0.04) return true;
    letzteAtmoZeit = t;

    const kap = Math.max(1, zahl(z.kapazitaet, 1));
    const zus = clamp(zahl(z.zuschauer, 0), 0, kap * 1.5);
    const auslastung = clamp(zus / kap, 0, 1);
    const stimmungRoh = clamp(zahl(z.stimmung, 55), 0, 100);
    const stimmung = stimmungRoh / 100;
    const druck = clamp(zahl(z.druck, 0), 0, 1);
    const fuehrung = clamp(zahl(z.heimFuehrung, 0), -9, 9);
    const minute = clamp(zahl(z.minute, 0), 0, 130);

    /* Wie groß ist das Haus? 250 Zuschauer im Amateurstadion klingen anders als
       80.000 — logarithmisch, weil das Ohr Lautheit so bewertet. */
    const groesse = clamp(Math.log10(Math.max(zus, 250) / 250) / Math.log10(320), 0, 1);
    const masse = 0.28 + 0.72 * groesse;
    const fuelle = 0.34 + 0.66 * auslastung;      // leere Ränge klingen dünn
    const laune = 0.55 + 0.55 * stimmung;
    const grund = clamp(masse * fuelle * laune, 0, 1.3);
    A.letzte.grund = grund;

    /* Spannung: Angriffe schwellen an, danach ebbt es weich wieder ab. */
    const spannungHeim = clamp((z.heimAngriff ? 0.30 + 0.75 * druck : 0.30 * druck), 0, 1.1);
    const spannungGast = clamp((z.auswaertsAngriff ? 0.28 + 0.70 * druck : 0.20 * druck), 0, 1.1);

    /* Schlussphase bei knappem Stand: die letzten zwanzig Minuten sind lauter. */
    const enge = Math.abs(fuehrung) <= 1 ? 1 : Math.abs(fuehrung) === 2 ? 0.5 : 0.18;
    const schluss = minute > 70 ? clamp((minute - 70) / 25, 0, 1) * 0.30 * enge : 0;

    /* Rückstand drückt die Heimkurve, Führung trägt sie. */
    const stand = fuehrung > 0 ? 1 + Math.min(fuehrung, 3) * 0.06
      : 1 - Math.min(-fuehrung, 3) * 0.09;

    const heim = clamp(grund * stand * (1 + 0.55 * spannungHeim + schluss), 0, 1.6);
    const gastLaune = 0.65 + 0.45 * clamp((1 - fuehrung) / 3, 0, 1);
    const gast = clamp(grund * o.gastAnteil * gastLaune * (1 + 0.85 * spannungGast) * 1.6, 0, 1.2);

    setz(A, A.tief.g.gain, 'tief', 0.52 * heim, 0.45, 1.9);
    setz(A, A.mitte.g.gain, 'mitte', 0.40 * heim * (0.82 + 0.36 * stimmung), 0.30, 1.5);
    setz(A, A.hoch.g.gain, 'hoch', 0.15 * heim * (0.55 + 0.75 * spannungHeim), 0.22, 1.2);
    setz(A, A.gastMitte.g.gain, 'gastMitte', 0.42 * gast, 0.30, 1.5);
    setz(A, A.gastHoch.g.gain, 'gastHoch', 0.16 * gast * (0.5 + 0.8 * spannungGast), 0.22, 1.2);

    /* Pfeifkonzert: Rückstand plus schlechte Laune, und je später, desto giftiger. */
    const unmut = clamp(-fuehrung / 2, 0, 1) * clamp((46 - stimmungRoh) / 34, 0, 1);
    const pfeif = clamp(unmut * (0.35 + 0.45 * clamp(minute / 90, 0, 1)), 0, 1) * grund * 0.5;
    setz(A, A.pfeif.gain, 'pfeif', pfeif, 1.2, 2.5);

    /* Trommeln: nur wenn die Ultras zufrieden sind und das Haus voll genug ist. */
    const ultras = clamp((stimmungRoh - 50) / 38, 0, 1) * clamp((auslastung - 0.2) / 0.5, 0, 1);
    const trommel = ultras * grund * 0.55 * (1 + 0.3 * druck) * (1 - 0.6 * clamp(pfeif * 3, 0, 1));
    setz(A, A.trommel.gain, 'trommel', trommel, 2.0, 3.0);

    return true;
  }

  /**
   * Torjubel über dem Grundrauschen: schnelles Aufbranden, langes Abebben,
   * dazu eine Filterfahrt nach oben. Der jeweils andere Block verstummt kurz —
   * bei einem Gästetor hört man wirklich nur die 800 Mitgereisten.
   */
  function jubelStoss(seite, staerke) {
    const A = atmoKnoten;
    if (!A) return;
    const t = jetzt();
    const gast = seite === 'gast';
    const zweig = gast ? A.gastJubel : A.jubel;
    const basis = A.letzte.grund === undefined ? 0.45 : A.letzte.grund;
    const spitze = clamp(basis * (gast ? 1.0 : 1.9) * (staerke === undefined ? 1 : staerke), 0.05, 1.4);

    const p = zweig.g.gain;
    p.cancelScheduledValues(t);
    let ist = 0.0001;
    try { ist = Math.max(p.value, 0.0001); } catch (e) { /* egal */ }
    p.setValueAtTime(ist, t);
    p.linearRampToValueAtTime(spitze, t + 0.40);
    p.setTargetAtTime(0, t + 0.85, 2.4);

    const f = zweig.f;
    f.frequency.cancelScheduledValues(t);
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1120, t + 0.6);
    f.frequency.setTargetAtTime(700, t + 1.3, 2.2);

    /* Der Gegenblock schweigt — und kommt über einige Sekunden zurück. */
    const anderer = gast ? A.heim.gain : A.gast.gain;
    rampe(anderer, gast ? 0.10 : 0.06, t, 0.30);
    anderer.setTargetAtTime(1, t + (gast ? 3.6 : 2.6), 1.8);

    /* Pfiffe hören in dem Moment auf, wenn die eigene Elf trifft. */
    if (!gast) rampe(A.pfeif.gain, 0, t, 0.5);
  }

  /** Kurzer Schub für den Pfeifchor der Heimkurve. */
  function pfeifStoss(staerke) {
    const A = atmoKnoten;
    if (!A) return;
    const t = jetzt();
    const basis = A.letzte.grund === undefined ? 0.45 : A.letzte.grund;
    const spitze = clamp(basis * 0.6 * (staerke === undefined ? 1 : staerke), 0.02, 0.9);
    const p = A.pfeif.gain;
    p.cancelScheduledValues(t);
    let ist = 0.0001;
    try { ist = Math.max(p.value, 0.0001); } catch (e) { /* egal */ }
    p.setValueAtTime(ist, t);
    p.linearRampToValueAtTime(spitze, t + 0.7);
    p.setTargetAtTime(A.letzte.pfeif || 0, t + 2.2, 1.8);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 9. AUFWECKEN — Browser sperren Ton bis zur ersten Nutzerinteraktion
  // ═════════════════════════════════════════════════════════════════════════

  let entsperrer = null;

  function entsperrungAnmelden() {
    if (!o.entsperren) return;
    if (typeof document === 'undefined' || !document || typeof document.addEventListener !== 'function') return;
    if (entsperrer) return;
    const ereignisse = ['pointerdown', 'touchstart', 'keydown', 'mousedown'];
    const hoerer = () => {
      if (zerstoert) { entsperrungAbmelden(); return; }
      if (!ctx || ctx.state !== 'suspended') { entsperrungAbmelden(); return; }
      try {
        const p = ctx.resume();
        if (p && typeof p.then === 'function') p.then(entsperrungAbmelden, () => { });
      } catch (e) { /* egal */ }
    };
    entsperrer = { ereignisse, hoerer };
    for (let i = 0; i < ereignisse.length; i++) {
      document.addEventListener(ereignisse[i], hoerer, { capture: true, passive: true });
    }
  }

  function entsperrungAbmelden() {
    if (!entsperrer) return;
    const { ereignisse, hoerer } = entsperrer;
    entsperrer = null;
    if (typeof document === 'undefined' || !document || typeof document.removeEventListener !== 'function') return;
    for (let i = 0; i < ereignisse.length; i++) {
      document.removeEventListener(ereignisse[i], hoerer, { capture: true });
    }
  }

  /** Versucht, den Kontext zu starten. Gefahrlos beliebig oft aufrufbar. */
  function aufwecken() {
    if (zerstoert || !ctx) return Promise.resolve(false);
    if (ctx.state === 'running') return Promise.resolve(true);
    entsperrungAnmelden();
    try {
      const p = ctx.resume();
      if (p && typeof p.then === 'function') {
        return p.then(() => ctx.state === 'running', () => false);
      }
    } catch (e) { /* egal */ }
    return Promise.resolve(ctx.state === 'running');
  }

  if (ctx.state === 'suspended') entsperrungAnmelden();

  // ═════════════════════════════════════════════════════════════════════════
  // 10. ÖFFENTLICHE API
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Spielt einen Einzelklang.
   * @param {string} name   einer aus KLANGNAMEN (oder KLANG_ALIASE)
   * @param {object} [opts] { lautstaerke 0..2, hoehe 0.25..4, panorama -1..1,
   *                          seite 'heim'|'gast' (nur tor/jubel), verzoegerung s }
   * @returns {boolean} true, wenn wirklich etwas erklungen ist
   */
  function play(name, opts) {
    const bauName = loeseNamen(name);
    if (!bauName) {
      warnEinmal('unbekannt:' + name,
        `[sound] Unbekannter Klang "${name}" — ignoriert. Bekannt: ${KLANGNAMEN.join(', ')}`);
      return false;
    }
    if (zerstoert || !ctx) return false;
    if (stumm || lautstaerke <= 0) return false;
    if (stimmenAktiv >= o.maxStimmen) return false;
    if (ctx.state === 'suspended') aufwecken();
    if (!puffernSicherstellen()) return false;

    const t = jetzt();
    const abstand = MINDESTABSTAND[bauName] || 0.03;
    const zuletzt = letzteAusloesung[bauName];
    if (zuletzt !== undefined && t - zuletzt < abstand) return false;
    letzteAusloesung[bauName] = t;

    const q = (opts && typeof opts === 'object') ? opts : {};
    const e = {
      pegel: (GRUNDPEGEL[bauName] || 0.5) * clamp(zahl(q.lautstaerke, 1), 0, 2),
      hoehe: clamp(zahl(q.hoehe, 1), 0.25, 4),
      panorama: clamp(zahl(q.panorama, 0), -1, 1),
      seite: q.seite === 'gast' ? 'gast' : 'heim'
    };
    const t0 = t + 0.005 + clamp(zahl(q.verzoegerung, 0), 0, 5);

    stimmenImBau = 0;
    try {
      KLANGBAU[bauName](t0, e);
      return true;
    } catch (err) {
      /* Bricht ein Bauplan mittendrin ab, feuert kein onended mehr — die dabei
         angelegten Stimmen müssen von Hand zurückgezählt werden, sonst
         verstummt die Bank nach genug Fehlern für immer. */
      warnEinmal('bau:' + bauName, `[sound] Klang "${bauName}" ließ sich nicht bauen: ${err && err.message}`);
      stimmenAktiv = Math.max(0, stimmenAktiv - stimmenImBau);
      return false;
    }
  }

  /** Stadionsprecher-Gong. art: 'aufstellung' | 'tor' | 'wechsel' | 'ende'. */
  function gong(art) {
    const gewaehlt = GONG_ARTEN.indexOf(art) >= 0 ? art : 'aufstellung';
    if (art !== undefined && GONG_ARTEN.indexOf(art) < 0) {
      warnEinmal('gong:' + art,
        `[sound] Unbekannte Gongart "${art}" — nehme "aufstellung". Bekannt: ${GONG_ARTEN.join(', ')}`);
    }
    if (zerstoert || !ctx || stumm || lautstaerke <= 0) return false;
    if (ctx.state === 'suspended') aufwecken();
    if (!puffernSicherstellen()) return false;
    const t = jetzt();
    if (letzteAusloesung.gong !== undefined && t - letzteAusloesung.gong < MINDESTABSTAND.gong) return false;
    letzteAusloesung.gong = t;
    stimmenImBau = 0;
    try {
      gongSatz(gewaehlt, t + 0.01, { pegel: GRUNDPEGEL.gong, hoehe: 1, panorama: 0, seite: 'heim' });
      return true;
    } catch (err) {
      warnEinmal('bau:gong', `[sound] Gong ließ sich nicht bauen: ${err && err.message}`);
      stimmenAktiv = Math.max(0, stimmenAktiv - stimmenImBau);
      return false;
    }
  }

  /**
   * Gemeinsamer Anlauf der Zusatzklänge. Bewusst dieselben Wächter in
   * derselben Reihenfolge wie play() — zerstört, stumm, Stimmenzahl,
   * Mindestabstand, schlafender Kontext — und im Fehlerfall dieselbe
   * Rückbuchung der halb gebauten Stimmen. Eigener Schlüsselraum
   * ('zusatz:…') für den Mindestabstand, damit bank.pfosten() und
   * play('pfosten') sich nicht gegenseitig wegdrosseln.
   *
   * @param {string} schluessel Eintrag in ZUSATZ_PEGEL/ZUSATZ_ABSTAND
   * @param {object} [opts]     { lautstaerke, hoehe, panorama, verzoegerung }
   * @param {function} bau      (t0, e) => Endzeit
   */
  function spieleZusatz(schluessel, opts, bau) {
    if (zerstoert || !ctx) return false;
    if (stumm || lautstaerke <= 0) return false;
    if (stimmenAktiv >= o.maxStimmen) return false;
    if (ctx.state === 'suspended') aufwecken();
    if (!puffernSicherstellen()) return false;

    const t = jetzt();
    const marke = 'zusatz:' + schluessel;
    const abstand = ZUSATZ_ABSTAND[schluessel] || 0.03;
    const zuletzt = letzteAusloesung[marke];
    if (zuletzt !== undefined && t - zuletzt < abstand) return false;
    letzteAusloesung[marke] = t;

    const q = (opts && typeof opts === 'object') ? opts : {};
    const e = {
      pegel: (ZUSATZ_PEGEL[schluessel] || 0.5) * clamp(zahl(q.lautstaerke, 1), 0, 2),
      hoehe: clamp(zahl(q.hoehe, 1), 0.25, 4),
      panorama: clamp(zahl(q.panorama, 0), -1, 1),
      seite: q.seite === 'gast' ? 'gast' : 'heim'
    };
    const t0 = t + 0.005 + clamp(zahl(q.verzoegerung, 0), 0, 5);

    stimmenImBau = 0;
    try {
      bau(t0, e);
      return true;
    } catch (err) {
      warnEinmal('bau:' + schluessel, `[sound] Klang "${schluessel}" ließ sich nicht bauen: ${err && err.message}`);
      stimmenAktiv = Math.max(0, stimmenAktiv - stimmenImBau);
      return false;
    }
  }

  /**
   * Der Ball setzt auf dem Rasen auf.
   * @param {number} [wucht01] 0 = sanft abgelegt, 1 = langer Ball aus 40 Metern
   * @param {object} [opts]    { lautstaerke, hoehe, panorama }
   * @returns {boolean} true, wenn wirklich etwas erklungen ist
   */
  function aufsetzer(wucht01, opts) {
    const w = clamp(zahl(wucht01, 0.5), 0, 1);
    return spieleZusatz('aufsetzer', opts, (t0, e) => bauAufsetzer(t0, e, w));
  }

  /**
   * Der Ball im Netz.
   * @param {number} [wucht01] Eindringtiefe 0..1 — bestimmt die Länge (80–180 ms)
   * @param {object} [opts]    { lautstaerke, hoehe, panorama }
   */
  function netz(wucht01, opts) {
    const w = clamp(zahl(wucht01, 0.5), 0, 1);
    return spieleZusatz('netz', opts, (t0, e) => bauNetz(t0, e, w));
  }

  /** Aluminium: Ball an Pfosten oder Latte. Für die Latte hoehe > 1 mitgeben. */
  function pfosten(opts) {
    return spieleZusatz('pfosten', opts, KLANGBAU.pfosten);
  }

  /** Die Mauer blockt: derselbe Bauplan wie block, nur eine Spur dumpfer —
      eine Wand aus Körpern klingt tiefer als ein einzelnes Bein. */
  function mauer(opts) {
    return spieleZusatz('mauer', opts, (t0, e) => KLANGBAU.block(t0, {
      pegel: e.pegel, hoehe: e.hoehe * 0.88, panorama: e.panorama, seite: e.seite
    }));
  }

  /**
   * Schiedsrichterpfiff.
   * @param {string} [art]  einer aus PFIFF_ARTEN; unbekannt ⇒ 'standard'
   * @param {object} [opts] { lautstaerke, hoehe, panorama }
   */
  function pfiff(art, opts) {
    const gewaehlt = PFIFF_ARTEN.indexOf(art) >= 0 ? art : 'standard';
    if (art !== undefined && PFIFF_ARTEN.indexOf(art) < 0) {
      warnEinmal('pfiff:' + art,
        `[sound] Unbekannte Pfiffart "${art}" — nehme "standard". Bekannt: ${PFIFF_ARTEN.join(', ')}`);
    }
    return spieleZusatz('pfiff', opts, (t0, e) => {
      if (gewaehlt === 'anstoss') return trillerpfeife(t0, 0.80, e, 1, 0.06);
      if (gewaehlt === 'halbzeit') {
        /* Kurz, dann lang — die Pause hört sich anders an als das Spielende. */
        trillerpfeife(t0, 0.19, e, 1);
        return trillerpfeife(t0 + 0.33, 0.46, e, 0.997);
      }
      if (gewaehlt === 'abpfiff') {
        trillerpfeife(t0, 0.17, e, 1);
        trillerpfeife(t0 + 0.31, 0.17, e, 1.004);
        return trillerpfeife(t0 + 0.62, 0.38, e, 0.996);
      }
      return trillerpfeife(t0, 0.34, e, 1);
    });
  }

  /** Startet die Atmosphäre (idempotent) und blendet sie über 1,6 s ein. */
  function atmoStart() {
    if (zerstoert || !ctx) return false;
    if (ctx.state === 'suspended') aufwecken();
    if (!puffernSicherstellen()) return false;
    if (!atmoKnoten) {
      try {
        atmoKnoten = atmoAufbauen();
      } catch (err) {
        warnEinmal('atmo', '[sound] Atmosphäre ließ sich nicht aufbauen: ' + (err && err.message));
        atmoKnoten = null;
        return false;
      }
      letzteAtmoZeit = -1;
      atmoAnwenden(letzterZustand, true);
    }
    atmoLaeuft = true;
    rampe(atmoKnoten.aus.gain, 1, jetzt(), 1.6);
    return true;
  }

  /** Blendet die Atmosphäre aus und räumt ihren Graphen danach ab. */
  function atmoStop(schnell) {
    if (!atmoKnoten) { atmoLaeuft = false; return false; }
    const A = atmoKnoten;
    atmoKnoten = null;
    atmoLaeuft = false;
    const dauer = schnell ? 0.12 : 1.1;
    try {
      rampe(A.aus.gain, 0, jetzt(), dauer);
    } catch (e) { /* egal */ }
    verzoegert(() => atmoAbbauen(A), Math.round((dauer + 0.25) * 1000));
    return true;
  }

  /**
   * Schreibt den Zustand des Stadions fort.
   * @param {object} zustand { zuschauer, kapazitaet, stimmung 0..100,
   *   heimFuehrung, minute, druck 0..1, heimAngriff, auswaertsAngriff }
   */
  function atmo(zustand) {
    if (zerstoert) return false;
    if (zustand && typeof zustand === 'object') {
      letzterZustand = Object.assign({}, letzterZustand, zustand);
    }
    if (!atmoKnoten) return false;
    return atmoAnwenden(letzterZustand, false);
  }

  /** Gesamtlautstärke 0..1. Wird über 60 ms gerampt, damit nichts knackt. */
  function setLautstaerke(wert) {
    lautstaerke = clamp(zahl(wert, 0), 0, 1);
    if (!zerstoert && ctx) rampe(master.gain, stumm ? 0 : pegelKurve(lautstaerke), jetzt(), 0.06);
    return lautstaerke;
  }

  function setStumm(an) {
    stumm = !!an;
    if (!zerstoert && ctx) rampe(master.gain, stumm ? 0 : pegelKurve(lautstaerke), jetzt(), 0.06);
    return stumm;
  }

  function status() {
    return {
      verfuegbar: !zerstoert,
      grund: null,
      laeuft: atmoLaeuft,
      stumm,
      lautstaerke,
      stimmen: stimmenAktiv,
      kontext: ctx ? ctx.state : 'geschlossen',
      hall: !!hallRaum
    };
  }

  /** Alles anhalten, abklemmen und — wenn wir ihn geöffnet haben — schließen. */
  function destroy() {
    if (zerstoert) return true;
    zerstoert = true;
    atmoStop(true);
    if (atmoKnoten) { atmoAbbauen(atmoKnoten); atmoKnoten = null; }
    for (const id of timer) clearTimeout(id);
    timer.clear();
    entsperrungAbmelden();
    const knoten = [effektBus, atmoBus, hallEin, hallRaum, hallAus, master, begrenzer];
    for (let i = 0; i < knoten.length; i++) {
      if (knoten[i]) { try { knoten[i].disconnect(); } catch (e) { /* egal */ } }
    }
    if (eigenerKontext && typeof ctx.close === 'function') {
      try {
        const p = ctx.close();
        if (p && typeof p.catch === 'function') p.catch(() => { });
      } catch (e) { /* egal */ }
    }
    bank.verfuegbar = false;
    return true;
  }

  const bank = {
    verfuegbar: true,
    grund: null,
    namen: klangNamen(),
    play, atmo, atmoStart, atmoStop,
    setLautstaerke, setStumm, gong,
    aufsetzer, netz, pfosten, mauer, pfiff,
    aufwecken, status, destroy
  };
  return bank;
}
