/**
 * Spieltag-Regie.
 *
 * Verbindet Match-Engine, Spielfeld-Rendering, Live-Ticker und die interaktiven
 * Minispiele zu einem Spielerlebnis – in drei Ansichtsstufen:
 *
 *   text        nur Konferenz-Ticker
 *   highlights  Spielfeld nur bei Höhepunkten
 *   full        komplettes Spiel im Stadion
 *
 * Ablauf: Die Engine schreibt Ereignisse und Phasen in einen Puffer. Eine eigene
 * Abspielschleife arbeitet den Puffer im gewählten Tempo ab. Wenn die Engine an
 * einer Schlüsselszene oder in der Halbzeit auf uns wartet, holen wir die
 * Darstellung erst bis zu dieser Minute nach und übergeben dann an den Spieler.
 */

import { MATCH_VIEW, WEATHER, DIFFICULTIES } from '../core/constants.js';
import { clamp, round, formatMoney } from '../core/util.js';
import { emit, EV } from '../core/events.js';
import { squadOf, difficultyOf, fixturesOfDay } from '../core/state.js';
import { REFEREE_NAMES } from '../data/names.js';
import { buildMatchTeam, applyResult, aktualisiereTabellen, simulateAiFixtures, makeCtx } from '../core/loop.js';

import { simulateMatch } from '../engine/match.js';
import { autoLineup, validateTactics } from '../engine/tactics.js';
import { createPitchView } from '../render/pitch.js';
import { drawPlayer } from '../render/players.js';
import { el, panel, button, dialog, toast } from '../render/ui.js';

import { minigame as mgElfmeter } from '../interactive/penalty.js';
import { minigame as mgFreistoss } from '../interactive/freekick.js';
import { minigame as mgEcke } from '../interactive/corner.js';
import { minigame as mgAbschluss } from '../interactive/finish.js';
import { minigame as mgKombination } from '../interactive/combination.js';

import { zuschauerBerechnen, derbyFaktor } from '../club/stadium.js';
import { heimvorteil } from '../club/fans.js';

const MINIGAMES = {
  elfmeter: mgElfmeter,
  freistoss: mgFreistoss,
  ecke: mgEcke,
  abschluss: mgAbschluss,
  kombination: mgKombination
};

/** Ereignisarten, die in der Höhepunkte-Ansicht gezeigt werden. */
const HIGHLIGHT_TYPES = new Set([
  'tor', 'grosschance', 'elfmeter', 'freistoss', 'rot', 'gelbrot', 'latte', 'pfosten',
  'parade', 'verletzung', 'anpfiff', 'halbzeit', 'abpfiff'
]);

const TICKER_KLASSE = {
  tor: 'tv-ticker__zeile--tor',
  elfmeter: 'tv-ticker__zeile--wichtig',
  rot: 'tv-ticker__zeile--karte',
  gelbrot: 'tv-ticker__zeile--karte',
  gelb: 'tv-ticker__zeile--karte',
  verletzung: 'tv-ticker__zeile--karte',
  halbzeit: 'tv-ticker__zeile--wichtig',
  abpfiff: 'tv-ticker__zeile--wichtig',
  anpfiff: 'tv-ticker__zeile--wichtig'
};

/**
 * Textgeschwindigkeit (state.settings.textTempo) als Faktor auf die Kunstpausen
 * des Live-Tickers. Wer mitliest, stellt „langsam"; wer die Zahlen will, „schnell".
 * Die Namen dieser drei Stufen stehen auch im Einstellungsbildschirm –
 * src/screens/einstellungen.js, Gruppe „Textgeschwindigkeit".
 */
export const TEXT_TEMPO = { langsam: 1.75, normal: 1, schnell: 0.5 };

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------------ *
 *  Spielumfeld
 * ------------------------------------------------------------------ */

/** Temperatur passend zur Jahreszeit – 6 °C im August wären ein Kuriosum. */
function temperaturFuer(jahreszeit, wetter, rng) {
  const bereich = {
    sommer: [17, 31], herbst: [7, 19], winter: [-4, 8], fruehling: [8, 21]
  }[jahreszeit] || [8, 20];
  let t = rng.int(bereich[0], bereich[1]);
  if (wetter === 'hitze') t = Math.max(t, rng.int(28, 36));
  if (wetter === 'schnee') t = Math.min(t, rng.int(-6, 2));
  if (wetter === 'regen') t -= 2;
  return t;
}

/* ------------------------------------------------------------------ *
 *  Schiedsrichter
 * ------------------------------------------------------------------ */

/**
 * Stabiler 32-Bit-Streuwert (FNV-1a). Nicht kryptografisch – dafür in jedem
 * Browser, jeder Sitzung und jedem Spielstand identisch. Genau das brauchen
 * wir: Ein Schiedsrichter soll über Jahre derselbe Mensch bleiben, ohne dass
 * dafür irgendetwas gespeichert werden muss.
 */
function streuwert(text) {
  const s = String(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Ganzzahl min..max aus einem Streuwert – verbraucht bewusst KEINEN RNG-Strom. */
function streuZahl(text, min, max) {
  return min + (streuwert(text) % Math.max(1, max - min + 1));
}

/**
 * Spitznamen der Kurve, sortiert nach Temperament. Für jeden findet sich einer.
 *
 * REFEREE_NAMES enthält auch Schiedsrichterinnen – deshalb nur Rollen- und
 * Sachbezeichnungen, die im Deutschen für alle funktionieren. Aus demselben
 * Grund kommt die Akte im Vorbericht ohne „er/sie" aus.
 */
const SCHIRI_SPITZNAMEN = {
  streng: ['Der Kartenmacher', 'Das gelbe Gespenst', 'Der Blockwart', 'Der Rotstift',
    'Der Erbsenzähler', 'Paragraph 12', 'Der Oberlehrer'],
  mittel: ['Der Unbestechliche', 'Der Aktenordner', 'Der Vorteilssucher',
    'Der Rasenrichter', 'Die ruhige Hand', 'Das Uhrwerk'],
  milde: ['Die gnädige Pfeife', 'Der Laufenlasser', 'Die lange Leine',
    'Die stille Pfeife', 'Der Schlichter', 'Das Sofakissen']
};

/**
 * Vollständige Akte zu einem Namen. **Alle** Werte hängen ausschließlich am
 * Namen – derselbe Unparteiische pfeift also in jedem Spiel, in jeder Saison
 * und in jedem Spielstand mit demselben Temperament.
 *
 * @param {string} name
 * @returns {{name, spitzname, strictness, homeBias, kartenschnitt, spiele, temperament}}
 */
export function schiedsrichterAkte(name) {
  const strictness = streuZahl(name + '|strenge', 26, 88);
  const homeBias = streuZahl(name + '|heim', 36, 66);
  // Der Kartenschnitt folgt der Strenge, darf aber ein wenig Eigenleben haben:
  // Es gibt strenge Regelausleger, die trotzdem selten Gelb ziehen.
  const eigenart = streuZahl(name + '|karten', 0, 20) / 20 - 0.5;      // -0,5 … +0,5
  return {
    name,
    spitzname: (pool => pool[streuwert(name + '|spitzname') % pool.length])(
      SCHIRI_SPITZNAMEN[strictness >= 64 ? 'streng' : strictness <= 42 ? 'milde' : 'mittel']),
    strictness,
    homeBias,
    // Zielkorridor: ein durchschnittlich strenger Unparteiischer (≈57) landet bei
    // rund 3,7 Gelben pro Partie, ein Kartenfreund (88) bei gut 5.
    kartenschnitt: round(clamp(1.0 + strictness * 0.0475 + eigenart * 1.2, 1.8, 6.2), 1),
    spiele: streuZahl(name + '|spiele', 9, 340),
    temperament: strictness >= 64 ? 'streng' : strictness <= 42 ? 'milde' : 'mittel'
  };
}

/**
 * Ansetzung: Wer pfeift diese Partie? Deterministisch aus der Fixture-ID und
 * ausdrücklich NICHT aus dem RNG-Strom – so melden Vorbericht und Anpfiff
 * garantiert denselben Mann, die Ansetzung überlebt jeden Spielstand, und die
 * Bilanz eines Schiedsrichters lässt sich für jede alte Partie nachrechnen,
 * ohne sie je gespeichert zu haben.
 *
 * @param {object} fixture
 * @returns {object} Akte, verträglich mit CONTRACTS §6 (`referee`)
 */
export function schiedsrichterFuer(fixture) {
  const id = (fixture && fixture.id) || 'ohne-ansetzung';
  return schiedsrichterAkte(REFEREE_NAMES[streuwert('ansetzung|' + id) % REFEREE_NAMES.length]);
}

export function spielUmfeld(state, fixture, rng) {
  const home = state.clubs[fixture.homeId];
  const away = state.clubs[fixture.awayId];

  const jahreszeit = fixture.dayIndex < 60 ? 'sommer'
    : fixture.dayIndex < 130 ? 'herbst'
      : fixture.dayIndex < 240 ? 'winter' : 'fruehling';
  const wetterPool = {
    sommer: ['sonnig', 'sonnig', 'bewoelkt', 'hitze', 'regen'],
    herbst: ['bewoelkt', 'regen', 'regen', 'wind', 'sonnig'],
    winter: ['bewoelkt', 'schnee', 'regen', 'wind', 'bewoelkt'],
    fruehling: ['sonnig', 'bewoelkt', 'regen', 'wind', 'sonnig']
  }[jahreszeit];
  const wetter = rng.pick(wetterPool);

  let zuschauer = { gesamt: Math.round(home.stadium.capacity * 0.7), einnahmen: 0, auslastung: 0.7 };
  try {
    zuschauer = zuschauerBerechnen(state, home.id, fixture, { wetter, derby: derbyFaktor(state, home.id, away.id) });
  } catch (err) {
    console.warn('[matchday] zuschauerBerechnen fehlgeschlagen:', err);
  }

  let heim = { faktor: 1.05 };
  try { heim = heimvorteil(state, home.id, fixture) || heim; } catch (err) { /* optional */ }

  return {
    venue: {
      capacity: home.stadium.capacity,
      attendance: zuschauer.gesamt,
      stadiumName: home.stadium.name,
      pitch: home.stadiumState ? home.stadiumState.rasenZustand : home.stadium.pitch,
      weather: wetter,
      temperature: temperaturFuer(jahreszeit, wetter, rng),
      heimvorteil: heim.faktor
    },
    zuschauer,
    referee: schiedsrichterFuer(fixture)
  };
}

/* ------------------------------------------------------------------ *
 *  Ton
 *
 *  Die Klangbank steht im Rahmen (main.js:klang) – eine für das ganze
 *  Spiel. Hier wird sie nur benutzt, nie gebaut.
 *
 *  Zwei Dinge sind wichtig und werden leicht verwechselt:
 *
 *  1. Die Atmosphäre kennt kein „wir" und kein „die". Sie hört aus dem
 *     Stadion heraus: `heim` ist die Heimkurve, `gast` der Auswärtsblock –
 *     völlig unabhängig davon, auf welcher Seite der Manager sitzt. Bei
 *     einem Heimtor brüllt das Haus und der Gästeblock verstummt, bei
 *     einem Gästetor bleiben 800 Mitgereiste übrig und der Rest schweigt.
 *     Genau das macht ein Auswärtstor im Ton so schön unheimlich.
 *  2. Nichts hier darf abstürzen oder blockieren, wenn es keinen Ton gibt.
 *     Ohne Bank sind alle Methoden No-Ops.
 * ------------------------------------------------------------------ */

/**
 * Holt die Klangbank des Rahmens. Bewusst per dynamischem Import: So bleibt
 * matchday.js in Node ladbar, und der Ringschluss main → screens → matchday
 * → main entsteht gar nicht erst. `opts.klang` hat Vorrang – damit kann ein
 * Aufrufer (Übungsplatz, Prüfskript) eine eigene Bank unterschieben.
 */
async function klangbankHolen(opts) {
  if (opts && opts.klang) return opts.klang;
  try {
    const mod = await import('../main.js');
    return (mod && mod.klang) || null;
  } catch (err) {
    console.warn('[matchday] Klangbank nicht erreichbar – es bleibt still:', err);
    return null;
  }
}

/**
 * Klangnamen der Minispiele, die die Bank nicht kennt, auf ihre Baupläne
 * gebogen. Die Minispiele rufen inzwischen richtige Namen – diese Tabelle
 * ist das Netz darunter, für ältere Szenen und fremde Aufrufer.
 */
const MINISPIEL_KLANG = {
  pass: ['schuss', { lautstaerke: 0.45, hoehe: 1.45 }],
  flanke: ['schuss', { lautstaerke: 0.70, hoehe: 1.25 }],
  kopfball: ['block', { hoehe: 1.35 }],
  menge: ['raunen', {}],
  jubel_klein: ['jubel', { lautstaerke: 0.40 }],
  daneben: ['raunen', {}]
};

/** Wie sehr eine Ereignisart die Ränge auf die Stuhlkante holt (0..1). */
const EREIGNIS_DRUCK = {
  tor: 1, elfmeter: 1, grosschance: 0.95, latte: 0.90, pfosten: 0.90,
  parade: 0.85, konter: 0.70, ecke: 0.65, freistoss: 0.60, chance: 0.55,
  kombination: 0.50, abseits: 0.45, ballverlust: 0.30
};

/**
 * Die Tonregie einer Partie. Kennt Stadion, Spielstand und Einstellungen
 * und übersetzt beides in Klänge und Stadionatmosphäre.
 *
 * `state.settings.klaenge` und `.atmosphaere` werden bei **jedem** Aufruf
 * frisch gelesen, nicht einmal beim Anpfiff eingesammelt: Wer mitten im
 * Spiel abschaltet, hat auf der Stelle Ruhe.
 */
function tonRegie(bank, state, fixture, umfeld) {
  const heimVerein = (state.clubs && state.clubs[fixture.homeId]) || null;
  const kapazitaet = Math.max(1, (umfeld.venue && umfeld.venue.capacity) || 1);
  const zuschauer = (umfeld.zuschauer && umfeld.zuschauer.gesamt)
    || (umfeld.venue && umfeld.venue.attendance) || 0;

  let atmoLaeuft = false;
  let angriff = null;         // 'home' | 'away' | null
  let druck = 0.15;

  const opt = () => (state && state.settings) || {};
  const klaengeAn = () => !!bank && opt().klaenge !== false;
  const atmoAn = () => !!bank && opt().atmosphaere !== false;

  function stimmung() {
    const m = heimVerein && heimVerein.fans ? Number(heimVerein.fans.mood) : NaN;
    return Number.isFinite(m) ? clamp(m, 0, 100) : 55;
  }

  function play(name, opts) {
    if (!klaengeAn()) return false;
    try { return bank.play(name, opts); } catch (err) { return false; }
  }

  function gong(art) {
    if (!klaengeAn()) return false;
    try { return bank.gong(art); } catch (err) { return false; }
  }

  /** Atmosphäre auf den aktuellen Stand bringen. Kostet nichts, wenn nichts läuft. */
  function anwenden(minute, stand) {
    if (!bank) return;
    if (!atmoAn()) {
      if (atmoLaeuft) { try { bank.atmoStop(); } catch (err) { /* egal */ } atmoLaeuft = false; }
      return;
    }
    if (!atmoLaeuft) { try { bank.atmoStart(); } catch (err) { /* egal */ } atmoLaeuft = true; }
    try {
      bank.atmo({
        zuschauer, kapazitaet,
        stimmung: stimmung(),
        heimFuehrung: stand[0] - stand[1],
        minute,
        druck: clamp(druck, 0, 1),
        heimAngriff: angriff === 'home',
        auswaertsAngriff: angriff === 'away'
      });
    } catch (err) { /* egal */ }
  }

  /** Die Aufregung einer Szene verpufft über die folgenden Bilder wieder. */
  function abklingen(faktor) {
    druck *= faktor;
    if (druck < 0.12) { druck = 0.10; angriff = null; }
  }

  return {
    play, gong,

    /** Einlauf: die Ränge füllen sich, der Stadionsprecher räuspert sich. */
    einlauf(stand) {
      anwenden(0, stand);
      gong('aufstellung');
    },

    /** Zwischen den Ereignissen: Atmosphäre nachziehen, Spannung abbauen. */
    takt(minute, stand) {
      abklingen(0.88);
      anwenden(minute, stand);
    },

    /**
     * Ein Ereignis vertonen. `stand` ist bereits fortgeschrieben, `ev.team`
     * ist bei Toren, Chancen und Fouls die *auslösende* Mannschaft.
     *
     * `leise` gilt für „Zum Ende": Dort rauschen zwanzig Ereignisse in einer
     * Sekunde durch, und zwanzig Trillerpfeifen in einer Sekunde sind kein
     * Fußballspiel, sondern ein Unfall. Die Ränge laufen weiter, die
     * Einzelklänge nicht — nur der Schlusspfiff darf durch.
     */
    ereignis(ev, stand, leise) {
      const typ = ev && ev.type;
      const heimEv = ev && ev.team !== 'away';
      const seite = heimEv ? 'heim' : 'gast';
      const minute = (ev && ev.minute) || 0;

      abklingen(0.7);
      if (EREIGNIS_DRUCK[typ] !== undefined) {
        druck = Math.max(druck, EREIGNIS_DRUCK[typ]);
        angriff = heimEv ? 'home' : 'away';
      }
      if (leise && typ !== 'abpfiff') { anwenden(minute, stand); return; }

      switch (typ) {
        case 'anpfiff':
          druck = 0.35; angriff = null;
          play('anpfiff');
          break;

        /* Der Jubel steckt im Klang „tor" selbst – er reißt auch die
           Atmosphäre mit und legt den Gegenblock still. Deshalb hier nur
           der eine Aufruf, synchron zum Torbanner. */
        case 'tor':
          play('tor', { seite });
          break;

        case 'parade':
          play('parade');
          if (heimEv) play('raunen', { lautstaerke: 0.55, verzoegerung: 0.30 });
          break;

        case 'latte':
        case 'pfosten':
          play('pfosten', { hoehe: typ === 'latte' ? 1.12 : 1 });
          play('raunen', { lautstaerke: 0.75, verzoegerung: 0.28 });
          break;

        case 'elfmeter':
          play('pfiff');
          break;

        case 'freistoss':
        case 'foul':
          play('pfiff', { lautstaerke: 0.85 });
          break;

        case 'abseits':
          play('pfiff', { lautstaerke: 0.70 });
          break;

        /* Karten: gepfiffen wird gegen die Mannschaft in ev.team. Fliegt
           einer aus der Heimelf, wird es auf den Rängen ungemütlich. */
        case 'gelb':
          play('karte');
          break;
        case 'gelbrot':
          play('karte', { hoehe: 0.85 });
          if (heimEv) play('pfeifkonzert', { lautstaerke: 0.75, verzoegerung: 0.35 });
          break;
        case 'rot':
          play('karte', { hoehe: 0.70 });
          play('pfeifkonzert', { lautstaerke: heimEv ? 0.95 : 0.55, verzoegerung: 0.35 });
          break;

        case 'wechsel':
          play('wechsel');
          gong('wechsel');
          break;

        case 'verletzung':
          play('raunen', { lautstaerke: 0.85 });
          break;

        case 'halbzeit':
          druck = 0; angriff = null;
          play('halbzeit');
          break;

        /* Abpfiff: Schlusspfiff, Gong des Sprechers – und die Kurve der
           siegreichen Mannschaft. Bei einem Remis bleibt es beim Applaus,
           den ohnehin niemand hört. */
        case 'abpfiff': {
          druck = 0; angriff = null;
          play('abpfiff');
          gong('ende');
          if (stand[0] > stand[1]) play('jubel', { seite: 'heim', verzoegerung: 0.9 });
          else if (stand[1] > stand[0]) play('jubel', { seite: 'gast', verzoegerung: 0.9 });
          break;
        }
        default:
          break;
      }

      anwenden(minute, stand);
    },

    /**
     * Ränge aus. Muss jeden Ausgang aus der Partie überleben – reguläres
     * Ende, Absturz der Engine, weggeklickter Bildschirm –, sonst rauscht
     * das Stadion durch den Rest der Saison weiter.
     */
    aus(schnell) {
      angriff = null; druck = 0;
      if (!bank) return;
      try { bank.atmoStop(schnell); } catch (err) { /* egal */ }
      atmoLaeuft = false;
    }
  };
}

/* ------------------------------------------------------------------ *
 *  Oberfläche
 * ------------------------------------------------------------------ */

function baueOberflaeche(state, fixture, umfeld) {
  const home = state.clubs[fixture.homeId];
  const away = state.clubs[fixture.awayId];

  const standEl = el('div', { class: 'tv-anzeigetafel__stand' }, '0 : 0');
  const uhrEl = el('div', { class: 'tv-anzeigetafel__uhr' }, "0'");
  const tafel = el('div', { class: 'tv-anzeigetafel' },
    el('div', { class: 'tv-anzeigetafel__team' }, home.abbr, el('span', { style: { fontSize: '12px', opacity: .75 } }, home.shortName)),
    el('div', {}, standEl, uhrEl),
    el('div', { class: 'tv-anzeigetafel__team tv-anzeigetafel__team--gast' },
      el('span', { style: { fontSize: '12px', opacity: .75 } }, away.shortName), away.abbr));

  const canvas = el('canvas', { width: 1040, height: 700 });
  const buehne = el('div', { class: 'tv-buehne' }, canvas);
  const ticker = el('div', { class: 'tv-ticker' });

  const infoZeile = el('div', { class: 'tv-mini' },
    `${umfeld.venue.stadiumName} · ${umfeld.zuschauer.gesamt.toLocaleString('de-DE')} Zuschauer · ` +
    `${WEATHER[umfeld.venue.weather].icon} ${WEATHER[umfeld.venue.weather].name}, ${umfeld.venue.temperature} °C · ` +
    `Schiedsrichter: ${umfeld.referee.name}`);

  const steuerung = el('div', { class: 'tv-steuerung' });

  return { tafel, standEl, uhrEl, canvas, buehne, ticker, steuerung, infoZeile };
}

/* ------------------------------------------------------------------ *
 *  Hauptablauf
 * ------------------------------------------------------------------ */

/**
 * Trägt das Spiel des Managers aus und rendert es in `root`.
 * @returns {Promise<object>} MatchResult
 */
export async function spielAustragen(state, fixture, root, opts = {}) {
  const ctx = makeCtx(state);
  const rng = ctx.rng.fork('spiel:' + fixture.id);
  const umfeld = spielUmfeld(state, fixture, rng);

  const meineSeite = fixture.homeId === state.managerClubId ? 'home' : 'away';
  const home = buildMatchTeam(state, fixture.homeId, true);
  const away = buildMatchTeam(state, fixture.awayId, false);
  const meinTeam = meineSeite === 'home' ? home : away;

  const settings = state.settings;
  const ui = baueOberflaeche(state, fixture, umfeld);

  // Die Klangbank des Rahmens. Kommt keine (Node, alter Browser, fehlende
  // Tonschicht), läuft die Partie unverändert – nur eben lautlos.
  const ton = tonRegie(await klangbankHolen(opts), state, fixture, umfeld);

  /* --- Abspielsteuerung ------------------------------------------- */
  const abspiel = {
    view: opts.view || settings.matchView || MATCH_VIEW.HIGHLIGHTS,
    tempo: opts.tempo || settings.speed || 2,
    // Textgeschwindigkeit: streckt oder staucht die Kunstpausen des Tickers.
    // Getrennt vom Tempo, weil das eine die Uhr betrifft und das andere die Augen.
    textTempo: TEXT_TEMPO[settings.textTempo] !== undefined ? TEXT_TEMPO[settings.textTempo] : 1,
    // Animationen aus: nur Ticker, kein Spielfeld. Die Partie läuft identisch ab,
    // sie wird nur nicht gezeichnet.
    animationen: settings.animationen !== false,
    ueberspringen: false,
    pausiert: false
  };

  let pitchView = null;
  if (abspiel.view !== MATCH_VIEW.TEXT && abspiel.animationen) {
    try {
      pitchView = createPitchView(ui.canvas, { cinematic: true, drawPlayer });
      pitchView.setTeams(home, away);
      if (pitchView.setFormationPositions) pitchView.setFormationPositions();
      if (pitchView.setSpeed) pitchView.setSpeed(abspiel.tempo);
      if (pitchView.renderStatic) pitchView.renderStatic();
    } catch (err) {
      console.error('[matchday] Spielfeldansicht nicht verfügbar:', err);
      pitchView = null;
      ui.buehne.appendChild(el('div', { class: 'tv-leer', style: { color: '#f2e8cf' } },
        'Spielfeldansicht konnte nicht geladen werden – es läuft die Textkonferenz.'));
    }
  } else {
    ui.buehne.style.display = 'none';
  }

  /* --- Puffer & Abspielschleife ------------------------------------ */
  const puffer = [];
  let verbraucht = 0;
  let engineFertig = false;
  let aktuelleMinute = 0;
  const stand = [0, 0];

  const tickerZeile = (ev) => {
    const zeile = el('div', { class: 'tv-ticker__zeile ' + (TICKER_KLASSE[ev.type] || '') },
      el('div', { class: 'tv-ticker__min' }, ev.minute ? `${ev.minute}'` : ''),
      el('div', { class: 'tv-ticker__text' }, ev.text || ''));
    if (ev.type === 'tor') {
      const gegner = ev.team !== meineSeite;
      zeile.className = 'tv-ticker__zeile ' + (gegner ? 'tv-ticker__zeile--gegentor' : 'tv-ticker__zeile--tor');
    }
    ui.ticker.appendChild(zeile);
    ui.ticker.scrollTop = ui.ticker.scrollHeight;
  };

  async function zeigeEvent(ev) {
    if (ev.score) { stand[0] = ev.score[0]; stand[1] = ev.score[1]; }
    ui.standEl.textContent = `${stand[0]} : ${stand[1]}`;
    if (ev.minute) { aktuelleMinute = ev.minute; ui.uhrEl.textContent = `${ev.minute}'`; }
    if (pitchView && pitchView.setClock) pitchView.setClock(ev.minute, ev.addedTime || 0, stand);
    // Der Ton kommt VOR der Anzeige: Netzrascheln und Torbanner sollen im
    // selben Moment losgehen, nicht nacheinander.
    ton.ereignis(ev, stand, abspiel.ueberspringen);
    tickerZeile(ev);
    if (ev.type === 'tor' && !abspiel.ueberspringen) {
      if (pitchView && pitchView.showBanner) pitchView.showBanner('T O R !', 1400 / abspiel.tempo);
      await pause(700);
      // Erst brüllt das Stadion, dann meldet sich der Sprecher. Andersherum
      // wäre er der einzige, der das Tor gesehen hat.
      ton.gong('tor');
    } else if (HIGHLIGHT_TYPES.has(ev.type) && !abspiel.ueberspringen) {
      await pause(220);
    }
  }

  async function zeigePhase(ph) {
    // Vor allen Abbruchgründen: Die Ränge atmen auch dann weiter, wenn diese
    // Phase nicht gezeichnet wird – in der Textkonferenz ist das der einzige
    // Puls, den die Atmosphäre bekommt.
    ton.takt(ph.minute || aktuelleMinute, stand);
    if (!pitchView || abspiel.ueberspringen) return;
    if (abspiel.view === MATCH_VIEW.HIGHLIGHTS && ph.eventIndex === null) return;
    if (abspiel.view === MATCH_VIEW.HIGHLIGHTS && ph.eventIndex !== undefined && ph.eventIndex !== null) {
      const ev = ergebnisEvents[ph.eventIndex];
      if (ev && !HIGHLIGHT_TYPES.has(ev.type)) return;
    }

    // Im Hintergrund laufende Tabs bekommen von Browsern kein requestAnimationFrame
    // mehr. Auf die Animation zu warten würde das Spiel dann dauerhaft einfrieren –
    // also gar nicht erst darauf warten.
    if (typeof document !== 'undefined' && document.hidden) return;

    // Die Darstellung darf die Simulation unter keinen Umständen blockieren:
    // Löst playPhase() nicht rechtzeitig auf, geht es ohne Animation weiter.
    const grenze = ((ph.duration || 3) * 1000) / Math.max(0.25, abspiel.tempo) + 2000;
    try {
      await Promise.race([pitchView.playPhase(ph), sleep(grenze)]);
    } catch (err) {
      console.warn('[matchday] Phase konnte nicht animiert werden:', err);
    }
  }

  async function pause(ms) {
    if (abspiel.ueberspringen) return;
    // Im Hintergrund drosseln Browser setTimeout auf etwa eine Sekunde. Das Spiel
    // im Zeitlupentempo weiterlaufen zu lassen, während niemand zusieht, bringt
    // nichts – also ohne Kunstpausen durchziehen.
    if (typeof document !== 'undefined' && document.hidden) return;
    const t = ms * abspiel.textTempo / Math.max(0.25, abspiel.tempo);
    let rest = t;
    while (rest > 0) {
      const schritt = Math.min(60, rest);
      await sleep(schritt);
      rest -= schritt;
      if (abspiel.ueberspringen) return;
      while (abspiel.pausiert && !abspiel.ueberspringen) await sleep(80);
    }
  }

  let ergebnisEvents = [];

  const schleife = (async () => {
    while (!engineFertig || verbraucht < puffer.length) {
      if (verbraucht >= puffer.length) { await sleep(25); continue; }
      const item = puffer[verbraucht++];
      if (item.kind === 'event') await zeigeEvent(item.data);
      else if (item.kind === 'phase') await zeigePhase(item.data);
    }
  })();

  /** Wartet, bis die Darstellung die angegebene Minute eingeholt hat. */
  async function nachholen(minute) {
    let wache = 0;
    while (verbraucht < puffer.length && puffer[verbraucht].minute <= minute && wache++ < 4000) {
      await sleep(20);
    }
  }

  /* --- Steuerleiste ------------------------------------------------ */
  const tempoKnoepfe = [0.5, 1, 2, 4, 8].map(t => button(t === 0.5 ? '½×' : `${t}×`, () => {
    abspiel.tempo = t;
    if (pitchView && pitchView.setSpeed) pitchView.setSpeed(t);
    tempoKnoepfe.forEach(b => b.classList.toggle('tv-btn--primary', b.dataset.tempo === String(t)));
  }, { size: 'klein' }));
  tempoKnoepfe.forEach((b, i) => { b.dataset.tempo = String([0.5, 1, 2, 4, 8][i]); });
  tempoKnoepfe[2].classList.add('tv-btn--primary');

  const pauseBtn = button('⏸ Pause', () => {
    abspiel.pausiert = !abspiel.pausiert;
    pauseBtn.textContent = abspiel.pausiert ? '▶ Weiter' : '⏸ Pause';
  }, { size: 'klein' });

  ui.steuerung.appendChild(el('span', { class: 'tv-mini' }, 'Tempo:'));
  ui.steuerung.appendChild(el('div', { class: 'tv-tempo' }, ...tempoKnoepfe));
  ui.steuerung.appendChild(pauseBtn);
  ui.steuerung.appendChild(button('⏭ Zum Ende', () => { abspiel.ueberspringen = true; abspiel.pausiert = false; }, { size: 'klein' }));
  ui.steuerung.appendChild(button('🔄 Wechseln', () => wechselDialog(state, meinTeam), { size: 'klein', kind: 'blau' }));
  ui.steuerung.appendChild(button('📋 Taktik', () => taktikDialog(state, meinTeam), { size: 'klein', kind: 'blau' }));

  const ansichtSelect = el('select', {
    style: { padding: '2px 5px', fontSize: '11px' },
    onchange: e => {
      abspiel.view = e.target.value;
      // Ohne Spielfeldansicht bleibt die Bühne zu – ein leeres schwarzes Rechteck
      // wäre ein schlechterer Anblick als gar keins.
      ui.buehne.style.display = (abspiel.view === MATCH_VIEW.TEXT || !pitchView) ? 'none' : '';
    }
  },
    el('option', { value: MATCH_VIEW.TEXT, selected: abspiel.view === MATCH_VIEW.TEXT }, 'Nur Text'),
    el('option', { value: MATCH_VIEW.HIGHLIGHTS, selected: abspiel.view === MATCH_VIEW.HIGHLIGHTS }, 'Höhepunkte'),
    el('option', { value: MATCH_VIEW.FULL, selected: abspiel.view === MATCH_VIEW.FULL }, 'Ganzes Spiel'));
  ui.steuerung.appendChild(el('span', { class: 'tv-mini', style: { marginLeft: '8px' } }, 'Ansicht:'));
  ui.steuerung.appendChild(ansichtSelect);

  /* --- Aufbau im DOM ------------------------------------------------ */
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'tv-spieltag' },
    ui.tafel,
    ui.infoZeile,
    ui.buehne,
    ui.steuerung,
    panel('Live-Ticker', ui.ticker)));

  /* Die Ränge sind schon da, bevor der Ball rollt: Grundrauschen hochfahren,
     Gong des Stadionsprechers zur Aufstellung. */
  ton.einlauf(stand);

  /* --- Engine anwerfen ---------------------------------------------- */
  const setup = {
    home, away, rng,
    venue: umfeld.venue,
    referee: umfeld.referee,
    difficulty: difficultyOf(state),
    competition: { id: fixture.competitionId, name: fixture.competitionName || '', matchday: fixture.matchday, neutral: !!fixture.neutral },
    interactive: !!settings.interactive,
    interactiveSide: meineSeite,
    keyMomentFilter: settings.minigames,
    onEvent: (ev) => { puffer.push({ kind: 'event', minute: ev.minute || aktuelleMinute, data: ev }); },
    onPhase: (ph) => { puffer.push({ kind: 'phase', minute: ph.minute || aktuelleMinute, data: ph }); },
    onMinute: () => { },
    onHalftime: async (info) => {
      await nachholen(45);
      await halbzeitDialog(state, meinTeam, info, stand, meineSeite);
    },
    onKeyMoment: async (moment) => {
      if (!settings.interactive) return null;
      if (moment.team !== meineSeite) return null;
      if (settings.minigames && settings.minigames[moment.kind] === false) return null;
      const mg = MINIGAMES[moment.kind];
      if (!mg) return null;
      await nachholen(moment.minute);
      abspiel.pausiert = false;
      try {
        return await minispielStarten(mg, moment, state, fixture);
      } catch (err) {
        console.error('[matchday] Minispiel fehlgeschlagen:', err);
        return null;
      }
    }
  };

  let result;
  try {
    result = await simulateMatch(setup);
    ergebnisEvents = result.events || [];
    engineFertig = true;
    await schleife;
  } catch (err) {
    engineFertig = true;
    console.error('[matchday] Simulation fehlgeschlagen:', err);
    throw err;
  } finally {
    // Zwingend in jedem Ausgang: Ein Stadion, das nach einem Absturz der
    // Engine weiterrauscht, bekommt man nur noch mit einem Neuladen still.
    ton.aus();
    if (pitchView && pitchView.destroy) pitchView.destroy();
  }

  /* --- Ergebnis verbuchen ------------------------------------------- */
  applyResult(state, fixture, result, ctx);
  const restlicheSpiele = fixturesOfDay(state, state.date.day).filter(f => f.id !== fixture.id);
  if (restlicheSpiele.length) simulateAiFixtures(state, restlicheSpiele, ctx);
  aktualisiereTabellen(state);
  state.flags.erstesSpielGespielt = true;

  emit(EV.SPIEL_FERTIG, { state, fixture, result });
  return result;
}

/* ------------------------------------------------------------------ *
 *  Minispiel-Bühne
 * ------------------------------------------------------------------ */

/**
 * Baut die Minispiel-Bühne auf und spielt eine Szene.
 *
 * @param {object} mg       Minispiel aus interactive/ (CONTRACTS §9)
 * @param {object} moment   KeyMoment (CONTRACTS §6.1)
 * @param {object} state
 * @param {object|null} fixture  Partie – auf dem Übungsplatz gibt es keine, dann `null`.
 * @param {object} [opts]   { seed, difficulty, abbruchText } für Aufrufer ohne Fixture.
 * @returns {Promise<object|null>} resolution oder null bei Abbruch
 */
export async function minispielStarten(mg, moment, state, fixture, opts = {}) {
  const canvas = el('canvas', { width: 960, height: 600, style: { display: 'block' } });
  const overlayRoot = el('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
  const buehne = el('div', { class: 'tv-minispiel__buehne', style: { position: 'relative' } }, canvas, overlayRoot);
  const hinweis = el('div', { class: 'tv-minispiel__hinweis' },
    el('b', {}, mg.title), ' – ', mg.instructions || '', el('div', { style: { marginTop: '4px', opacity: .7 } },
      opts.abbruchText || 'ESC überlässt die Szene der Simulation.'));
  const overlay = el('div', { class: 'tv-minispiel' }, buehne, hinweis);
  document.body.appendChild(overlay);

  /* Der Ton der Bühne. Die Bank gehört dem Rahmen; hier wird sie nur
     benutzt. Ein Minispiel darf nie daran scheitern, dass es still ist –
     deshalb schluckt `sound()` alles und liefert im Zweifel `false`. */
  const bank = await klangbankHolen(opts);

  const host = {
    canvas,
    ctx: canvas.getContext('2d'),
    root: overlayRoot,
    difficulty: opts.difficulty || difficultyOf(state),
    // Wird gleich unten durch die szeneneigene RNG ersetzt. Hier NICHTS in den
    // Spielstand schreiben: Ein Hilfsfeld am state landet über JSON.stringify
    // in jedem gespeicherten Spielstand – und der Übungsplatz verspricht,
    // außer seiner Statistik nichts anzufassen.
    rng: null,
    drawPlayer,
    drawPitchSection: () => { },
    /**
     * @param {string} name Klangname der Bank – oder einer aus MINISPIEL_KLANG
     * @param {object} [klangOpts] { lautstaerke, hoehe, panorama, verzoegerung }
     */
    sound: (name, klangOpts) => {
      if (!bank) return false;
      // Live abgefragt: Wer die Klänge abschaltet, während der Elfmeter
      // liegt, hört den Schuss nicht mehr.
      if (state && state.settings && state.settings.klaenge === false) return false;
      const ersatz = MINISPIEL_KLANG[name];
      try {
        return ersatz
          ? bank.play(ersatz[0], Object.assign({}, ersatz[1], klangOpts))
          : bank.play(name, klangOpts);
      } catch (err) { return false; }
    },
    finish: null
  };
  // eigene, deterministische RNG pro Szene
  const { createRng } = await import('../core/rng.js');
  host.rng = createRng(opts.seed
    || `${(fixture && fixture.id) || 'ohne-spiel'}:${moment.kind}:${moment.minute}`);

  // Minispiele laufen auf requestAnimationFrame. Wird der Tab währenddessen in den
  // Hintergrund geschoben, steht ihre Schleife still – deshalb eine eigene Notbremse,
  // zusätzlich zu der, die jedes Minispiel selbst mitbringt.
  let notbremse;
  const abbruch = new Promise(res => { notbremse = setTimeout(() => res(null), 30000); });

  let resolution = null;
  try {
    resolution = await Promise.race([mg.play(host, moment), abbruch]);
  } catch (err) {
    console.error('[matchday] Minispiel abgebrochen:', err);
    resolution = null;
  } finally {
    clearTimeout(notbremse);
    overlay.remove();
  }
  return resolution;
}

/* ------------------------------------------------------------------ *
 *  Eingriffe während des Spiels
 * ------------------------------------------------------------------ */

async function wechselDialog(state, matchTeam) {
  const aufDemPlatz = Object.values(matchTeam.tactics.lineup || {}).map(id => state.players[id]).filter(Boolean);
  const bank = (matchTeam.tactics.bench || []).map(id => state.players[id]).filter(Boolean);
  if (!bank.length) { toast('Keine Auswechselspieler verfügbar.', 'warn'); return; }

  let raus = null, rein = null;
  const liste = (spieler, aktiv, wahl) => el('div', { class: 'tv-spalte', style: { maxHeight: '300px', overflow: 'auto' } },
    ...spieler.map(p => el('button', {
      class: 'tv-btn tv-btn--klein',
      style: { justifyContent: 'flex-start' },
      onclick: (e) => {
        wahl(p);
        e.currentTarget.parentElement.querySelectorAll('.tv-btn').forEach(b => b.classList.remove('tv-btn--primary'));
        e.currentTarget.classList.add('tv-btn--primary');
      }
    }, `${p.number} ${p.shortName} (${p.position}) · Fit ${Math.round(p.fitness)}`)));

  const body = el('div', { class: 'tv-grid tv-grid--2' },
    el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Raus'), liste(aufDemPlatz, true, p => { raus = p; })),
    el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Rein'), liste(bank, false, p => { rein = p; })));

  const ok = await dialog('Auswechslung', body, [
    { label: 'Abbrechen', value: false },
    { label: 'Wechsel vornehmen', value: true, kind: 'primary' }
  ]);
  if (!ok) return;
  if (!raus || !rein) { toast('Bitte je einen Spieler wählen.', 'warn'); return; }

  matchTeam.pendingSubs = matchTeam.pendingSubs || [];
  matchTeam.pendingSubs.push({ raus: raus.id, rein: rein.id });
  toast(`${rein.shortName} kommt für ${raus.shortName}.`, 'info');
}

async function taktikDialog(state, matchTeam) {
  const t = matchTeam.tactics;
  const { STYLES } = await import('../engine/tactics.js');
  const stilSelect = el('select', { style: { width: '100%', padding: '4px' } },
    ...Object.entries(STYLES).map(([k, v]) => el('option', { value: k, selected: k === t.style }, v.name)));

  const regler = {};
  const reglerBox = el('div', {});
  for (const [key, label] of [['tempo', 'Tempo'], ['breite', 'Spielbreite'], ['pressinghoehe', 'Pressinghöhe'],
  ['risiko', 'Risiko'], ['haerte', 'Zweikampfhärte'], ['offensivdrang', 'Offensivdrang']]) {
    const wertEl = el('span', { class: 'tv-slider__wert' }, String(t.sliders[key]));
    const input = el('input', {
      type: 'range', min: 0, max: 100, value: t.sliders[key],
      oninput: e => { regler[key] = +e.target.value; wertEl.textContent = e.target.value; }
    });
    regler[key] = t.sliders[key];
    reglerBox.appendChild(el('div', { class: 'tv-slider' }, el('label', {}, label), input, wertEl));
  }

  const ok = await dialog('Taktik anpassen',
    el('div', { class: 'tv-spalte' },
      el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Spielstil'), stilSelect),
      el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Regler'), reglerBox)),
    [{ label: 'Abbrechen', value: false }, { label: 'Übernehmen', value: true, kind: 'primary' }]);
  if (!ok) return;

  matchTeam.tactics = Object.assign({}, t, { style: stilSelect.value, sliders: Object.assign({}, t.sliders, regler) });
  toast('Taktik angepasst.', 'gut');
}

async function halbzeitDialog(state, matchTeam, info, stand, meineSeite) {
  const meineTore = meineSeite === 'home' ? stand[0] : stand[1];
  const gegnerTore = meineSeite === 'home' ? stand[1] : stand[0];
  const lage = meineTore > gegnerTore ? 'Führung' : meineTore === gegnerTore ? 'Unentschieden' : 'Rückstand';

  let ansprache = null;
  const arten = [
    { id: 'aufbauend', name: 'Aufbauend', desc: 'Lob und Zuversicht – hilft verunsicherten Spielern.' },
    { id: 'fordernd', name: 'Fordernd', desc: 'Mehr Einsatz einfordern – wirkt bei starken Charakteren.' },
    { id: 'ruhig', name: 'Sachlich', desc: 'Taktische Korrekturen ohne Emotion – geringes Risiko.' },
    { id: 'wuetend', name: 'Wütend', desc: 'Große Wirkung, großes Risiko. Mimosen brechen ein.' },
    { id: 'emotional', name: 'Emotional', desc: 'An die Ehre appellieren – zündet bei Führungsspielern.' }
  ];
  const anspracheBox = el('div', { class: 'tv-spalte' }, ...arten.map(a =>
    el('button', {
      class: 'tv-interview__antwort',
      onclick: (e) => {
        ansprache = a.id;
        anspracheBox.querySelectorAll('button').forEach(b => b.style.background = '');
        e.currentTarget.style.background = 'rgba(217,165,33,.5)';
      }
    }, el('b', {}, a.name), el('div', { class: 'tv-mini' }, a.desc))));

  await dialog(`Halbzeit – ${lage} (${meineTore}:${gegnerTore})`,
    el('div', { class: 'tv-spalte' },
      el('p', {}, 'Was sagen Sie der Mannschaft in der Kabine?'),
      anspracheBox,
      el('div', { class: 'tv-zeile' },
        button('Auswechslung vornehmen', () => wechselDialog(state, matchTeam), { kind: 'blau', size: 'klein' }),
        button('Taktik ändern', () => taktikDialog(state, matchTeam), { kind: 'blau', size: 'klein' }))),
    [{ label: 'Weiter geht\'s', value: true, kind: 'primary' }]);

  if (ansprache) {
    try {
      const { ansprache: anspracheFn } = await import('../club/morale.js');
      const w = anspracheFn(state, state.managerClubId, 'halbzeit', ansprache);
      matchTeam.ansprache = { art: ansprache, wirkung: w && w.wirkung ? w.wirkung : {} };
      if (w && w.text) toast(w.text, 'info');
    } catch (err) {
      matchTeam.ansprache = { art: ansprache, wirkung: {} };
    }
  }
}

export { MINIGAMES, HIGHLIGHT_TYPES };
