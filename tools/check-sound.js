/**
 * tools/check-sound.js – Prüfung der Tonschicht src/render/sound.js.
 *
 * WebAudio gibt es in Node nicht. Genau darum geht es hier: Die Tonschicht muss
 * sich ohne AudioContext importieren lassen und dann sauber zu einem No-Op
 * degradieren – für Node, für alte Browser, für stummgeschaltete Sitzungen.
 *
 * Geprüft wird:
 *   1. Syntax        node --check über sound.js
 *   2. Import        der Import in Node darf NICHT werfen
 *   3. Exporte       createSoundBank, KLANGNAMEN & Co. sind vorhanden
 *   4. No-Op-Bank    createSoundBank() ohne AudioContext liefert die volle API
 *   5. Klangnamen    alle dokumentierten Namen existieren, Aliase zeigen ins Ziel
 *   6. Robustheit    play() mit unbekanntem Namen wirft nicht und warnt genau einmal
 *   7. Quelltext     keine Audiodateien, kein Math.random(), kein Date.now(),
 *                    keine rAF-/Intervall-Schleife für die Atmosphäre
 *   8. Klanggraph    Aufbau gegen einen Attrappen-AudioContext: jeder Klang
 *                    baut wirklich Knoten, die Atmosphäre läuft und räumt auf
 *
 * Aufruf:  node tools/check-sound.js
 * Rückgabe: Exit-Code 1, wenn harte Fehler gefunden wurden.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const DATEI = resolve(WURZEL, 'src/render/sound.js');
const rel = p => relative(WURZEL, p);

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

/** Fängt console.warn ein und liefert die gesammelten Zeilen. */
function ohneWarnungen(fn) {
  const echt = console.warn;
  const gesammelt = [];
  console.warn = (...a) => gesammelt.push(a.join(' '));
  try { return { wert: fn(), warnungen: gesammelt }; }
  finally { console.warn = echt; }
}

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║  TRAUMVEREIN – Prüfung der Tonschicht                        ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

/* ================================================================== *
 *  1. Syntax
 * ================================================================== */

kopf(1, 'Syntax');

test('node --check src/render/sound.js', () => {
  execFileSync(process.execPath, ['--check', DATEI], { stdio: 'pipe' });
});

/* ================================================================== *
 *  2. Import in Node – der eigentliche Härtetest
 * ================================================================== */

kopf(2, 'Import in Node (kein AudioContext vorhanden)');

assert(typeof globalThis.AudioContext === 'undefined' &&
  typeof globalThis.webkitAudioContext === 'undefined',
  'Vorbedingung verletzt: in dieser Node-Umgebung gibt es doch einen AudioContext');

let MOD = null;
try {
  MOD = await import('../src/render/sound.js');
  bestanden++;
  console.log('  ok   import wirft nicht');
} catch (e) {
  console.log('  FAIL import wirft nicht\n       ' + e.message);
  console.log('\nAbbruch: ohne Modul keine weiteren Prüfungen.');
  process.exit(1);
}

/* ================================================================== *
 *  3. Exporte
 * ================================================================== */

kopf(3, 'Exporte');

test('createSoundBank ist eine Funktion', () => {
  assert(typeof MOD.createSoundBank === 'function', 'createSoundBank fehlt');
});

test('KLANGNAMEN ist ein eingefrorenes Array', () => {
  assert(Array.isArray(MOD.KLANGNAMEN), 'KLANGNAMEN ist kein Array');
  assert(Object.isFrozen(MOD.KLANGNAMEN), 'KLANGNAMEN ist nicht eingefroren');
  assert(MOD.KLANGNAMEN.length >= 16, `nur ${MOD.KLANGNAMEN.length} Klangnamen`);
});

test('Hilfsexporte klangNamen/istKlangname/audioVerfuegbar/GONG_ARTEN/KLANG_ALIASE', () => {
  assert(typeof MOD.klangNamen === 'function', 'klangNamen fehlt');
  assert(typeof MOD.istKlangname === 'function', 'istKlangname fehlt');
  assert(typeof MOD.audioVerfuegbar === 'function', 'audioVerfuegbar fehlt');
  assert(Array.isArray(MOD.GONG_ARTEN), 'GONG_ARTEN fehlt');
  assert(MOD.KLANG_ALIASE && typeof MOD.KLANG_ALIASE === 'object', 'KLANG_ALIASE fehlt');
});

test('klangNamen() liefert eine Kopie, keine Vorlage', () => {
  const a = MOD.klangNamen();
  a.push('unfug');
  assert(MOD.KLANGNAMEN.indexOf('unfug') < 0, 'klangNamen() reicht die Vorlage durch');
});

test('audioVerfuegbar() meldet in Node false', () => {
  assert(MOD.audioVerfuegbar() === false, 'audioVerfuegbar() lügt');
});

/* ================================================================== *
 *  4. Klangnamen – der Vertrag mit matchday.js und den Minispielen
 * ================================================================== */

kopf(4, 'Klangnamen');

/** Diese Namen ruft der bestehende Code auf. Sie sind nicht verhandelbar. */
const PFLICHT = [
  'klick', 'schuss', 'tor', 'parade', 'pfosten', 'block',
  'pfiff', 'anpfiff', 'abpfiff', 'karte', 'wechsel',
  'jubel', 'raunen', 'pfeifkonzert', 'trommel', 'gong'
];

test('alle 16 verdrahteten Klangnamen sind dokumentiert', () => {
  const fehlend = PFLICHT.filter(n => MOD.KLANGNAMEN.indexOf(n) < 0);
  assert(fehlend.length === 0, 'fehlt: ' + fehlend.join(', '));
});

test('jeder dokumentierte Name hat einen Bauplan im Quelltext', () => {
  const src = readFileSync(DATEI, 'utf8');
  const block = src.slice(src.indexOf('const KLANGBAU'));
  const ohne = [];
  for (const n of MOD.KLANGNAMEN) {
    const gefunden = new RegExp(`(^|[\\s,{])${n}\\s*\\(t0`, 'm').test(block);
    if (!gefunden) ohne.push(n);
  }
  assert(ohne.length === 0, 'ohne Bauplan in KLANGBAU: ' + ohne.join(', '));
});

test('istKlangname() kennt Namen und Aliase, aber keinen Unfug', () => {
  for (const n of PFLICHT) assert(MOD.istKlangname(n), `${n} nicht erkannt`);
  for (const a of Object.keys(MOD.KLANG_ALIASE)) {
    assert(MOD.istKlangname(a), `Alias ${a} nicht erkannt`);
    assert(MOD.KLANGNAMEN.indexOf(MOD.KLANG_ALIASE[a]) >= 0,
      `Alias ${a} zeigt auf unbekanntes Ziel ${MOD.KLANG_ALIASE[a]}`);
  }
  assert(!MOD.istKlangname('vuvuzela'), 'vuvuzela wird fälschlich erkannt');
  assert(!MOD.istKlangname(undefined), 'undefined wird fälschlich erkannt');
  assert(!MOD.istKlangname(42), 'Zahl wird fälschlich erkannt');
});

test('GONG_ARTEN enthält genau die vier Ansagen', () => {
  for (const a of ['aufstellung', 'tor', 'wechsel', 'ende']) {
    assert(MOD.GONG_ARTEN.indexOf(a) >= 0, `Gongart ${a} fehlt`);
  }
});

/* ================================================================== *
 *  5. Die No-Op-Bank
 * ================================================================== */

kopf(5, 'No-Op-Bank ohne AudioContext');

const API = ['play', 'atmo', 'atmoStart', 'atmoStop', 'setLautstaerke',
  'setStumm', 'gong', 'aufwecken', 'status', 'destroy'];

test('createSoundBank() wirft nicht und liefert ein Objekt', () => {
  const bank = MOD.createSoundBank();
  assert(bank && typeof bank === 'object', 'keine Bank geliefert');
});

test('createSoundBank() meldet verfuegbar === false', () => {
  const bank = MOD.createSoundBank();
  assert(bank.verfuegbar === false, 'verfuegbar ist nicht false');
  assert(typeof bank.grund === 'string' && bank.grund.length > 0, 'kein Grund genannt');
});

test('die volle API ist vorhanden', () => {
  const bank = MOD.createSoundBank();
  const fehlend = API.filter(m => typeof bank[m] !== 'function');
  assert(fehlend.length === 0, 'fehlende Methoden: ' + fehlend.join(', '));
  assert(Array.isArray(bank.namen), 'bank.namen fehlt');
  assert(bank.namen.length === MOD.KLANGNAMEN.length, 'bank.namen unvollständig');
});

test('jede Methode ist aufrufbar, ohne zu werfen', () => {
  const bank = MOD.createSoundBank({ lautstaerke: 0.5 });
  const proben = [
    () => bank.play('klick'),
    () => bank.play('tor', { lautstaerke: 0.8, hoehe: 1.2, panorama: -0.5, seite: 'gast' }),
    () => bank.atmoStart(),
    () => bank.atmo({ zuschauer: 40000, kapazitaet: 50000, stimmung: 70, heimFuehrung: 1, minute: 55, druck: 0.5, heimAngriff: true }),
    () => bank.atmo(null),
    () => bank.atmo(),
    () => bank.atmoStop(),
    () => bank.setLautstaerke(0.3),
    () => bank.setLautstaerke('viel'),
    () => bank.setStumm(true),
    () => bank.setStumm(false),
    () => bank.gong('aufstellung'),
    () => bank.gong('tor'),
    () => bank.gong('wechsel'),
    () => bank.gong('ende'),
    () => bank.aufwecken(),
    () => bank.status(),
    () => bank.destroy(),
    () => bank.play('klick'),          // auch nach destroy
    () => bank.destroy()               // zweimal zerstören
  ];
  for (let i = 0; i < proben.length; i++) {
    const r = proben[i]();
    assert(r !== undefined, `Aufruf ${i} lieferte undefined`);
  }
});

test('alle dokumentierten Namen sind ohne Wurf spielbar', () => {
  const bank = MOD.createSoundBank();
  const { warnungen } = ohneWarnungen(() => {
    for (const n of MOD.KLANGNAMEN) assert(bank.play(n) === false, `${n} meldete Ton ohne Audio`);
    for (const a of Object.keys(MOD.KLANG_ALIASE)) bank.play(a);
  });
  assert(warnungen.length === 0, 'bekannte Namen haben gewarnt: ' + warnungen.join(' | '));
});

test('status() liefert ein vollständiges Bild', () => {
  const s = MOD.createSoundBank().status();
  for (const k of ['verfuegbar', 'laeuft', 'stumm', 'lautstaerke', 'stimmen']) {
    assert(Object.prototype.hasOwnProperty.call(s, k), `status().${k} fehlt`);
  }
  assert(s.verfuegbar === false && s.laeuft === false, 'status() beschönigt');
});

/* ================================================================== *
 *  6. Unbekannte Namen
 * ================================================================== */

kopf(6, 'Unbekannte Klangnamen');

test('play() mit unbekanntem Namen wirft nicht', () => {
  const bank = MOD.createSoundBank();
  ohneWarnungen(() => {
    const proben = ['gibtsnicht', '', null, undefined, 42, {}, [], 'TOR', 'Klick'];
    for (const p of proben) {
      const r = bank.play(p);
      assert(r === false, `play(${String(p)}) lieferte ${r} statt false`);
    }
    bank.play('nochwas', { lautstaerke: 2, hoehe: 99, panorama: -7 });
  });
});

test('play() warnt je unbekanntem Namen genau einmal', () => {
  const bank = MOD.createSoundBank();
  const marke = 'unfugklang-' + bestanden;      // je Lauf frischer Name
  const { warnungen } = ohneWarnungen(() => {
    for (let i = 0; i < 5; i++) bank.play(marke);
  });
  assert(warnungen.length === 1, `${warnungen.length} Warnungen statt genau einer`);
  assert(warnungen[0].includes(marke), 'Warnung nennt den Namen nicht');
  assert(warnungen[0].includes('sound'), 'Warnung nennt die Quelle nicht');
});

test('gong() mit unbekannter Art wirft nicht und warnt einmal', () => {
  const bank = MOD.createSoundBank();
  const { warnungen } = ohneWarnungen(() => {
    for (let i = 0; i < 3; i++) bank.gong('fanfare-' + bestanden);
    bank.gong();
  });
  assert(warnungen.length === 1, `${warnungen.length} Warnungen statt einer`);
});

/* ================================================================== *
 *  7. Quelltext-Regeln des Projekts
 * ================================================================== */

kopf(7, 'Projektregeln im Quelltext');

const roh = readFileSync(DATEI, 'utf8');
const src = roh
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

test('keine Audiodateien, kein fetch, kein XHR', () => {
  const treffer = src.match(/\.(mp3|ogg|wav|m4a|aac|flac|opus)\b|\bfetch\s*\(|XMLHttpRequest|decodeAudioData|new\s+Audio\b/g);
  assert(!treffer, 'verbotener Asset-Zugriff: ' + (treffer || []).join(', '));
});

test('kein Math.random(), kein Date.now(), kein new Date()', () => {
  assert(!/Math\.random\s*\(/.test(src), 'Math.random() ist im Projekt verboten');
  assert(!/Date\.now\s*\(/.test(src), 'Date.now() ist im Projekt verboten');
  assert(!/new\s+Date\s*\(/.test(src), 'new Date() ist im Projekt verboten');
});

test('keine rAF- oder Intervall-Schleife für die Atmosphäre', () => {
  assert(!/requestAnimationFrame/.test(src), 'requestAnimationFrame gefunden – Verläufe gehören auf AudioParams');
  assert(!/setInterval/.test(src), 'setInterval gefunden – Verläufe gehören auf AudioParams');
});

test('die Verläufe laufen wirklich über AudioParam-Rampen', () => {
  for (const m of ['setTargetAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues']) {
    assert(src.includes(m), `${m} kommt nicht vor`);
  }
});

test('alle geforderten WebAudio-Bausteine kommen vor', () => {
  for (const m of ['createOscillator', 'createBufferSource', 'createBiquadFilter',
    'createGain', 'createStereoPanner', 'createConvolver', 'createBuffer']) {
    assert(src.includes(m), `${m} fehlt – der Bauplan ist unvollständig`);
  }
});

test('keine Abhängigkeit außerhalb von core/', () => {
  const importe = [...roh.matchAll(/^\s*import\s+[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1]);
  for (const i of importe) {
    assert(i.startsWith('../core/'), `unerlaubter Import: ${i}`);
  }
});

/* ================================================================== *
 *  8. Klanggraph gegen einen Attrappen-AudioContext
 * ================================================================== *
 *  Node hat kein WebAudio – also stellen wir eines hin, das mitzählt.
 *  Damit lässt sich prüfen, dass jeder Bauplan wirklich Knoten erzeugt,
 *  verbindet und wieder abklemmt, statt nur nicht zu werfen.
 * ================================================================== */

kopf(8, 'Klanggraph gegen einen Attrappen-AudioContext');

function bauAttrappe() {
  const zaehler = {
    knoten: 0, verbindungen: 0, getrennt: 0, start: 0, stop: 0, rampen: 0,
    quellen: []      // alle Oszillatoren und BufferSources, mit ihrer Stoppzeit
  };

  function param(wert) {
    return {
      value: wert,
      /* Merkt sich, ob es vor einer Rampe überhaupt ein Ereignis gab. */
      __anker: false,
      __pruefeWert(v, was) {
        if (!Number.isFinite(v)) throw new Error(`${was}(${v}) – NaN auf einem AudioParam`);
      },
      /**
       * WebAudio beginnt eine Rampe beim VORHERIGEN Ereignis – gibt es keines,
       * bei Kontextsekunde 0. Ein Verlauf ohne setValueAtTime-Anker ist damit
       * abgelaufen, bevor der Klang anfängt. Die Attrappe verbietet das.
       */
      __pruefeAnker(was) {
        if (!this.__anker) throw new Error(`${was} ohne vorherigen setValueAtTime-Anker`);
      },
      setValueAtTime(v) { this.__pruefeWert(v, 'setValueAtTime'); this.__anker = true; this.value = v; return this; },
      linearRampToValueAtTime(v) {
        this.__pruefeWert(v, 'linearRampToValueAtTime');
        this.__pruefeAnker('linearRampToValueAtTime');
        zaehler.rampen++; this.value = v; return this;
      },
      exponentialRampToValueAtTime(v) {
        this.__pruefeWert(v, 'exponentialRampToValueAtTime');
        this.__pruefeAnker('exponentialRampToValueAtTime');
        if (!(v > 0)) throw new Error('exponentialRampToValueAtTime(0) ist verboten');
        zaehler.rampen++; this.value = v; return this;
      },
      setTargetAtTime(v, t, tau) {
        this.__pruefeWert(v, 'setTargetAtTime');
        if (!(tau > 0)) throw new Error('setTargetAtTime mit Zeitkonstante ' + tau);
        zaehler.rampen++; this.__anker = true; this.value = v; return this;
      },
      cancelScheduledValues() { return this; },        // hebt den Anker NICHT auf
      setValueCurveAtTime() { this.__anker = true; return this; }
    };
  }

  function knoten(extra) {
    zaehler.knoten++;
    return Object.assign({
      connect(ziel) { zaehler.verbindungen++; return ziel; },
      disconnect() { zaehler.getrennt++; }
    }, extra);
  }

  /** Quelle mit Buchführung über start/stop – für die Aufräum-Prüfung. */
  function quelle(extra) {
    const n = knoten(Object.assign({
      onended: null,
      __stop: null,
      start() { zaehler.start++; },
      stop(t) { zaehler.stop++; if (t !== undefined) this.__stop = t; }
    }, extra));
    zaehler.quellen.push(n);
    return n;
  }

  const ctx = {
    sampleRate: 44100,
    currentTime: 0,
    state: 'running',
    destination: knoten({}),
    createGain: () => knoten({ gain: param(1) }),
    createBiquadFilter: () => knoten({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) }),
    createOscillator: () => quelle({ type: 'sine', frequency: param(440), detune: param(0) }),
    createBufferSource: () => quelle({
      buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(1)
    }),
    createStereoPanner: () => knoten({ pan: param(0) }),
    createConvolver: () => knoten({ buffer: null, normalize: true }),
    createDynamicsCompressor: () => knoten({
      threshold: param(-24), knee: param(30), ratio: param(12),
      attack: param(0.003), release: param(0.25)
    }),
    createBuffer(kanaele, laenge, rate) {
      const daten = [];
      for (let i = 0; i < kanaele; i++) daten.push(new Float32Array(laenge));
      return {
        numberOfChannels: kanaele, length: laenge, sampleRate: rate,
        duration: laenge / rate,
        getChannelData: i => daten[i]
      };
    },
    resume() { return Promise.resolve(); },
    close() { return Promise.resolve(); }
  };
  return { ctx, zaehler };
}

test('Attrappe: jeder Klang baut Knoten und startet Quellen', () => {
  const { ctx, zaehler } = bauAttrappe();
  const bank = MOD.createSoundBank({ kontext: ctx, lautstaerke: 0.8 });
  assert(bank.verfuegbar === true, 'Bank meldet sich mit Kontext als nicht verfügbar');

  for (const n of MOD.KLANGNAMEN) {
    const vorher = { k: zaehler.knoten, s: zaehler.start };
    ctx.currentTime += 5;                              // Mindestabstände überspringen
    const gespielt = bank.play(n, { panorama: 0.2 });
    assert(gespielt === true, `play('${n}') lieferte false`);
    assert(zaehler.knoten > vorher.k, `play('${n}') baute keine Knoten`);
    assert(zaehler.start > vorher.s, `play('${n}') startete keine Quelle`);
  }
  assert(zaehler.verbindungen > 100, 'zu wenige Verbindungen im Graphen');
  bank.destroy();
});

/**
 * Aufgeräumt wird, wenn die zuletzt endende Quelle fertig ist. Hängt das
 * Abklemmen an einer früher endenden Quelle, schneidet es den Klang ab –
 * beim Gong wären das mehrere Sekunden Ausklang.
 */
function pruefeAufraeumzeit(zaehler, was) {
  const mitStop = zaehler.quellen.filter(q => q.__stop !== null);
  assert(mitStop.length > 0, `${was}: keine Quelle mit Stoppzeit`);
  const aufraeumer = mitStop.filter(q => typeof q.onended === 'function');
  assert(aufraeumer.length > 0, `${was}: keine Quelle räumt auf – die Stimme bleibt hängen`);
  const letzteQuelle = Math.max(...mitStop.map(q => q.__stop));
  const letzterAufraeumer = Math.max(...aufraeumer.map(q => q.__stop));
  assert(letzterAufraeumer >= letzteQuelle - 1e-9,
    `${was}: abgeklemmt bei ${letzterAufraeumer.toFixed(3)} s, der Klang läuft aber bis ` +
    `${letzteQuelle.toFixed(3)} s – das schneidet ihn ab`);
}

test('Attrappe: jeder Klang wird erst nach seiner längsten Quelle abgeklemmt', () => {
  const { ctx, zaehler } = bauAttrappe();
  const bank = MOD.createSoundBank({ kontext: ctx });
  for (const n of MOD.KLANGNAMEN) {
    ctx.currentTime += 5;
    zaehler.quellen.length = 0;
    assert(bank.play(n) === true, `play('${n}') lieferte false`);
    pruefeAufraeumzeit(zaehler, `play('${n}')`);
  }
  for (const art of MOD.GONG_ARTEN) {
    ctx.currentTime += 5;
    zaehler.quellen.length = 0;
    assert(bank.gong(art) === true, `gong('${art}') lieferte false`);
    pruefeAufraeumzeit(zaehler, `gong('${art}')`);
  }
  bank.destroy();
});

test('Attrappe: jede Gongart klingt', () => {
  const { ctx, zaehler } = bauAttrappe();
  const bank = MOD.createSoundBank({ kontext: ctx });
  for (const art of MOD.GONG_ARTEN) {
    ctx.currentTime += 5;
    const vorher = zaehler.start;
    assert(bank.gong(art) === true, `gong('${art}') lieferte false`);
    assert(zaehler.start > vorher, `gong('${art}') startete keine Quelle`);
  }
  bank.destroy();
});

test('Attrappe: Atmosphäre läuft, wird fortgeschrieben und räumt auf', () => {
  const { ctx, zaehler } = bauAttrappe();
  const bank = MOD.createSoundBank({ kontext: ctx });

  assert(bank.atmoStart() === true, 'atmoStart() lieferte false');
  assert(bank.status().laeuft === true, 'status() meldet die Atmosphäre nicht als laufend');
  const nachAufbau = zaehler.knoten;
  assert(nachAufbau > 25, `Atmosphäre baute nur ${nachAufbau} Knoten`);
  assert(zaehler.start > 4, 'Atmosphäre startete zu wenige Dauerquellen');

  /* 90 Minuten in 5-Sekunden-Schritten – die Bank darf dabei nichts nachbauen. */
  const vorLauf = zaehler.knoten;
  for (let minute = 0; minute <= 90; minute++) {
    ctx.currentTime += 5;
    bank.atmo({
      zuschauer: 41000, kapazitaet: 50000,
      stimmung: 50 + 40 * Math.sin(minute / 7),
      heimFuehrung: minute < 30 ? -1 : minute < 60 ? 0 : 2,
      minute, druck: (minute % 10) / 10,
      heimAngriff: minute % 3 === 0, auswaertsAngriff: minute % 5 === 0
    });
  }
  assert(zaehler.knoten === vorLauf,
    `die Atmosphäre baut im Betrieb Knoten nach (${zaehler.knoten - vorLauf} Stück) – das kostet CPU`);
  assert(zaehler.rampen > 300, 'zu wenige AudioParam-Rampen – wo kommen die Verläufe her?');

  /* Unfug-Zustände dürfen nicht werfen. */
  bank.atmo({ zuschauer: -5, kapazitaet: 0, stimmung: 999, heimFuehrung: 'viel', minute: NaN, druck: 7 });
  bank.atmo({});

  assert(bank.atmoStop() === true, 'atmoStop() lieferte false');
  assert(bank.status().laeuft === false, 'status() meldet die Atmosphäre weiter als laufend');
  assert(bank.atmoStart() === true, 'Neustart nach atmoStop() scheitert');
  bank.destroy();
});

test('Attrappe: Torjubel wirkt auf die laufende Atmosphäre', () => {
  const { ctx, zaehler } = bauAttrappe();
  const bank = MOD.createSoundBank({ kontext: ctx });
  bank.atmoStart();
  bank.atmo({ zuschauer: 45000, kapazitaet: 50000, stimmung: 80, minute: 20 });
  const vorher = zaehler.rampen;
  ctx.currentTime += 5;
  assert(bank.play('tor') === true, 'Heimtor blieb stumm');
  ctx.currentTime += 5;
  assert(bank.play('tor', { seite: 'gast' }) === true, 'Gästetor blieb stumm');
  assert(zaehler.rampen > vorher + 10, 'der Torjubel hat die Atmosphäre nicht bewegt');
  bank.destroy();
});

test('Attrappe: stumm und Lautstärke 0 sparen die Arbeit ganz', () => {
  const { ctx, zaehler } = bauAttrappe();
  const bank = MOD.createSoundBank({ kontext: ctx });
  bank.setStumm(true);
  const vorher = zaehler.knoten;
  ctx.currentTime += 5;
  assert(bank.play('schuss') === false, 'stumme Bank spielt trotzdem');
  assert(zaehler.knoten === vorher, 'stumme Bank baut trotzdem Knoten');
  bank.setStumm(false);
  bank.setLautstaerke(0);
  ctx.currentTime += 5;
  assert(bank.play('schuss') === false, 'Lautstärke 0 spielt trotzdem');
  bank.setLautstaerke(0.7);
  ctx.currentTime += 5;
  assert(bank.play('schuss') === true, 'nach dem Aufdrehen bleibt es stumm');
  bank.destroy();
});

test('Attrappe: Stimmenbegrenzung greift und erholt sich', () => {
  const { ctx } = bauAttrappe();
  const bank = MOD.createSoundBank({ kontext: ctx, maxStimmen: 3 });
  let gespielt = 0;
  for (let i = 0; i < 30; i++) {
    ctx.currentTime += 5;
    if (bank.play('schuss')) gespielt++;
  }
  assert(gespielt <= 3, `${gespielt} Stimmen trotz Obergrenze 3`);
  assert(gespielt >= 1, 'die Bank spielte gar nichts');
  bank.destroy();
});

test('Attrappe: destroy() klemmt alles ab und schaltet auf No-Op', () => {
  const { ctx, zaehler } = bauAttrappe();
  const bank = MOD.createSoundBank({ kontext: ctx });
  bank.atmoStart();
  ctx.currentTime += 5;
  bank.play('tor');
  const vorher = zaehler.getrennt;
  bank.destroy();
  assert(zaehler.getrennt > vorher, 'destroy() hat nichts abgeklemmt');
  assert(bank.verfuegbar === false, 'verfuegbar bleibt nach destroy() true');
  ctx.currentTime += 5;
  assert(bank.play('klick') === false, 'die zerstörte Bank spielt weiter');
  assert(bank.atmoStart() === false, 'die zerstörte Bank startet die Atmosphäre');
  bank.destroy();
});

test('Attrappe: ohne Hall funktioniert alles genauso', () => {
  const { ctx } = bauAttrappe();
  const bank = MOD.createSoundBank({ kontext: ctx, hall: false });
  assert(bank.status().hall === false, 'Hall wurde trotz hall:false gebaut');
  for (const n of MOD.KLANGNAMEN) {
    ctx.currentTime += 5;
    assert(bank.play(n) === true, `play('${n}') ohne Hall lieferte false`);
  }
  bank.atmoStart();
  bank.atmo({ zuschauer: 10000, kapazitaet: 20000, stimmung: 60, minute: 10 });
  bank.destroy();
});

test('Attrappe: ohne StereoPanner (altes Safari) läuft es weiter', () => {
  const { ctx } = bauAttrappe();
  delete ctx.createStereoPanner;
  const bank = MOD.createSoundBank({ kontext: ctx });
  ctx.currentTime += 5;
  assert(bank.play('tor', { panorama: -1 }) === true, 'ohne Panner blieb es stumm');
  bank.atmoStart();
  bank.destroy();
});

test('Attrappe: kaputter Kontext liefert die stumme Bank statt eines Absturzes', () => {
  const bank = MOD.createSoundBank({ kontext: { createGain: 'kein Node' } });
  assert(bank.verfuegbar === false, 'kaputter Kontext gilt als verfügbar');
  assert(bank.play('klick') === false, 'kaputte Bank spielt');
  bank.destroy();
});

/* ------------------------------------------------------------------ */

console.log('');
if (fehler.length) {
  console.log(`FEHLGESCHLAGEN: ${fehler.length} von ${bestanden + fehler.length} Prüfungen`);
  for (const f of fehler) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log(`Alle ${bestanden} Prüfungen bestanden.`);
  console.log(`${MOD.KLANGNAMEN.length} Klänge, ${MOD.GONG_ARTEN.length} Gongarten, ` +
    `${Object.keys(MOD.KLANG_ALIASE).length} Aliase – und in Node bleibt es still.`);
}
