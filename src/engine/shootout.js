/**
 * ELFMETERSCHIESSEN — engine/shootout.js
 *
 * Der Pokal kennt kein Unentschieden. Bis hierher entschied in
 * core/loop.js:pokalWeiterlosen ein Münzwurf (rng.chance(0.55)) darüber, wer
 * weiterkommt – ein dokumentiertes Provisorium. Dieses Modul löst es ab und
 * bedient zugleich die K.-o.-Runden des Europapokals (ROADMAP Stufe 3, Punkt 4).
 *
 * REGELWERK
 *   · Fünf Schützen je Mannschaft im Wechsel, danach K.o. bis zur Entscheidung.
 *   · Vorzeitiges Ende, sobald der Ausgang rechnerisch feststeht.
 *   · Nur wer beim Abpfiff auf dem Platz stand, darf antreten. Verletzte und
 *     Platzverwiesene fallen aus; die zahlenmäßig stärkere Mannschaft gleicht
 *     sich an ("reduce to equalize"), der Torwart bleibt dabei immer dabei.
 *   · Reihenfolge nach Eignung (Nervenstärke, Schuss, Standards, Technik,
 *     Trait 'elfmeterkiller', designierter Elfmeterschütze). Der Torwart
 *     schießt zuletzt – wie es sich gehört.
 *   · Trefferwahrscheinlichkeit aus Schütze gegen Torwart, gedrückt vom
 *     wachsenden Druck: jede Runde kostet Nerven, ein Matchball kostet mehr.
 *
 * BALANCE
 *   Zielkorridor 74–78 % Trefferquote über viele Schüsse (Realität: ~75 %).
 *   Nachgemessen mit tools/test-shootout.js (5000 Schießen). Wer schraubt,
 *   schraubt AUSSCHLIESSLICH in SHOOTOUT_CONSTANTS und lässt das Skript laufen.
 *
 *   ZWEI MODELLE, EIN KORRIDOR. Hier laufen zwei Trefferquellen nebeneinander:
 *   die KI würfelt über trefferChance() (Abschnitt 4), der Mensch schießt über
 *   interactive/penalty.js und kommt durch ausMinispiel() wieder herein. Jede
 *   Balanceänderung an einer der beiden Seiten kippt das Duell — deshalb prüft
 *   tools/test-shootout.js seit dem Physik-Umbau (Umbauplan Paket 4, Punkt 10)
 *   ausdrücklich BEIDE Quoten gegen denselben Korridor und deren Abstand gegen
 *   ±4 Prozentpunkte. Gemessen nach dem Umbau: Mensch 74,7 %, KI 73,4 %,
 *   Abstand 1,2 Punkte — die Konstanten unten mussten deshalb nicht wandern.
 *
 * INTERAKTIV
 *   Ist setup.onKeyMoment gesetzt und der Schütze gehört zu
 *   setup.interactiveSide, wird ein KeyMoment kind:'elfmeter' nach
 *   CONTRACTS 6.1 erzeugt und await-et – damit spielt der Nutzer sein eigenes
 *   Elfmeterschießen mit interactive/penalty.js. Liefert der Aufrufer null,
 *   simuliert dieses Modul den Schuss ganz normal.
 *
 * Kein Math.random(), kein Date.now() – alles läuft über die übergebene rng.
 */

import { clamp, round } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { MATCH_CONSTANTS } from './match.js';

const MC = MATCH_CONSTANTS;

/* ===========================================================================
 * 1. BALANCING
 * ========================================================================= */

export const SHOOTOUT_CONSTANTS = {
  /* --- Ablauf --- */
  regulaer: 5,             // Schützen je Mannschaft vor dem K.o.
  maxRunden: 40,           // Notbremse: irgendwann ist auch mal gut

  /* --- Trefferwahrscheinlichkeit ---
   * p = basis + spanne · (Schütze − Torwart)/100 − Müdigkeit − Druck        */
  basis: 0.800,            // gleich starker Schütze und Torwart, kein Druck
  spanne: 0.30,            // volle 100 Punkte Unterschied = ±30 Prozentpunkte
  pMin: 0.30, pMax: 0.95,

  /* --- Traits --- */
  traitKiller: 0.055,          // 'elfmeterkiller'
  traitEisblock: 0.020,        // 'eisblock' (Nervenstark)
  traitMimose: 0.035,          // 'mimose' – Abzug
  traitTorwartlegende: 0.045,  // 'torwartlegende' – Abzug für den Schützen

  muede: 0.07,             // 120 Minuten in den Beinen, voll ermüdet

  /* --- Druck (0..1) --- */
  druckRunde: 0.055,       // je gespielter Runde
  druckMatchball: 0.16,    // "wenn er den verwandelt, ist es vorbei"
  druckMuss: 0.24,         // "wenn er den verschießt, ist es vorbei"
  druckRueckstand: 0.10,   // hinterherlaufen zerrt; daher der kleine Vorteil des ersten Schützen
  druckSudden: 0.10,       // Sockel im K.-o.-Schießen
  druckMax: 0.80,
  druckWirkung: 0.16,      // Abzug auf p bei Druck 1 und durchschnittlichen Nerven
  druckNerven: 0.60,       // wie stark Nervenstärke den Druck dämpft

  /* --- Schützenreihenfolge --- */
  eignungKiller: 15,       // Trait 'elfmeterkiller'
  eignungEisblock: 5,
  eignungMimose: -5,
  eignungStandard: 8,      // tactics.setPieces.elfmeter – der Mann für den Punkt
  eignungJitter: 3,        // Restunsicherheit, damit es nie ganz nach Liste aussieht

  /* --- Aufteilung der Fehlschüsse --- */
  anteilGehalten: 0.56,    // Torwart pariert
  anteilDaneben: 0.30,     // vorbei/drüber; der Rest ist Aluminium
  anteilLatte: 0.45        // Anteil "Latte" am Aluminium (Rest: Pfosten)
};

const C = SHOOTOUT_CONSTANTS;

/* ===========================================================================
 * 2. KLEINE HELFER
 * ========================================================================= */

function nam(p) {
  return (p && (p.shortName || p.lastName || p.firstName)) || 'Unbekannt';
}

/** Attributwert mit Fallback. */
function A(p, key, fb = 50) {
  const v = p && p.attributes ? p.attributes[key] : undefined;
  return typeof v === 'number' ? v : fb;
}

function hatTrait(p, t) {
  return !!(p && Array.isArray(p.traits) && p.traits.includes(t));
}

function attMix(p, keys, weights) {
  let s = 0;
  for (let i = 0; i < keys.length; i++) s += A(p, keys[i]) * weights[i];
  return s;
}

/** Wie gut trifft dieser Mann vom Punkt? (1..99) */
function schuetzenWert(p) {
  return attMix(p, ['nervenstaerke', 'schuss', 'technik', 'standards'], [0.40, 0.30, 0.18, 0.12]);
}

/** Wie gut hält dieser Mann Elfmeter? (1..99) */
function torwartWert(p) {
  if (!p) return 35;
  return attMix(p, ['reflexe', 'stellungsspiel', 'nervenstaerke'], [0.45, 0.30, 0.25]);
}

function frischeVon(p) {
  return clamp((p && p.fitness != null ? p.fitness : 100) / 100, 0.2, 1);
}

function fuellen(vorlage, daten) {
  return String(vorlage).replace(/\{(\w+)\}/g, (m, k) => (daten[k] != null ? daten[k] : m));
}

function kurzName(club) {
  return (club && (club.shortName || club.name || club.abbr)) || 'die Mannschaft';
}

/* ===========================================================================
 * 3. WER SCHIESST? — Aufstellung, Reihenfolge, Angleichung
 * ========================================================================= */

/** Aus Ids oder Spielerobjekten eine saubere Spielerliste machen. */
function aufloesen(eintraege, kader) {
  const byId = new Map();
  for (const p of (kader || [])) if (p && p.id) byId.set(p.id, p);
  const out = [];
  const gesehen = new Set();
  for (const e of eintraege) {
    const p = (e && typeof e === 'object') ? e : byId.get(e);
    if (!p || !p.id || gesehen.has(p.id)) continue;
    gesehen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * Wer stand am Ende auf dem Platz?
 *
 * Erste Wahl ist `mt.aufDemPlatz` – die ehrliche Schlusself, die der Aufrufer
 * nach dem Abpfiff kennt (Wechsel, Verletzte, Platzverweise inklusive). Fehlt
 * sie, wird die Aufstellung genommen, und als letzte Rettung der Kader.
 * Verletzte fallen in jedem Fall heraus: mit Muskelfaserriss tritt keiner an.
 */
function aufDemPlatz(mt) {
  const kader = (mt && mt.players) || [];
  let liste = [];

  if (mt && Array.isArray(mt.aufDemPlatz) && mt.aufDemPlatz.length) {
    liste = aufloesen(mt.aufDemPlatz, kader);
  }
  if (!liste.length && mt && mt.tactics && mt.tactics.lineup) {
    liste = aufloesen(Object.values(mt.tactics.lineup).filter(Boolean), kader);
  }
  if (!liste.length) liste = kader.slice(0, 11);

  const fit = liste.filter(p => !p.injury);
  return fit.length ? fit : liste;
}

/** Torwart einer Liste: der gelernte, sonst der mit den besten Reflexen. */
function torwartVon(liste) {
  for (const p of liste) if (p.position === 'TW') return p;
  let best = null, bestW = -1;
  for (const p of liste) {
    const w = A(p, 'reflexe', 20);
    if (w > bestW) { bestW = w; best = p; }
  }
  return best;
}

/** Eignung für den Punkt (0..99+). Der Torwart wird hier nicht bewertet. */
function eignung(p, tactics, rng) {
  let e = schuetzenWert(p);
  if (hatTrait(p, 'elfmeterkiller')) e += C.eignungKiller;
  if (hatTrait(p, 'eisblock')) e += C.eignungEisblock;
  if (hatTrait(p, 'mimose')) e += C.eignungMimose;
  if (tactics && tactics.setPieces && tactics.setPieces.elfmeter === p.id) e += C.eignungStandard;
  e -= 8 * (1 - frischeVon(p));           // wer platt ist, wird nach hinten geschoben
  if (rng) e += rng.float(-C.eignungJitter, C.eignungJitter);
  return e;
}

/**
 * Schützenreihenfolge einer Mannschaft: die sichersten Füße zuerst, der
 * Torwart zuletzt. Auch von der Oberfläche nutzbar, um die Liste anzuzeigen.
 *
 * @param {object} mt   MatchTeam (CONTRACTS 5/6)
 * @param {object} opts { rng } – ohne rng streng nach Eignung, sonst mit Restunsicherheit
 * @returns {Array} Spieler in Schussreihenfolge
 */
export function schuetzenreihenfolge(mt, opts = {}) {
  const liste = aufDemPlatz(mt);
  if (!liste.length) return [];
  const tw = torwartVon(liste);
  const feld = liste.filter(p => p !== tw);
  const bewertet = feld.map(p => ({ p, e: eignung(p, mt && mt.tactics, opts.rng) }));
  bewertet.sort((x, y) => y.e - x.e || (x.p.id < y.p.id ? -1 : 1));
  const out = bewertet.map(x => x.p);
  if (tw) out.push(tw);
  return out;
}

/**
 * "Reduce to equalize": Steht eine Mannschaft nach Platzverweisen in
 * Unterzahl, dürfen bei der anderen ebenso viele nicht antreten. Gestrichen
 * wird von hinten – also der unsicherste Fuß. Der Torwart bleibt immer dabei.
 */
function angleichen(a, b) {
  if (!a.reihenfolge.length || !b.reihenfolge.length) return;
  const n = Math.min(a.reihenfolge.length, b.reihenfolge.length);
  for (const s of [a, b]) {
    if (s.reihenfolge.length <= n) continue;
    const tw = s.torwart;
    const feld = s.reihenfolge.filter(p => p !== tw);
    const behalten = feld.slice(0, Math.max(0, n - (tw ? 1 : 0)));
    if (tw) behalten.push(tw);
    s.reihenfolge = behalten;
  }
}

function baueSeite(mt, side, rng) {
  const liste = aufDemPlatz(mt);
  const tw = torwartVon(liste);
  return {
    side, mt,
    club: (mt && mt.club) || { shortName: side === 'home' ? 'Heim' : 'Gast' },
    torwart: tw,
    reihenfolge: schuetzenreihenfolge(mt, { rng }),
    naechster: 0,
    tore: 0,
    versuche: 0
  };
}

/* ===========================================================================
 * 4. DIE WAHRSCHEINLICHKEIT
 * ========================================================================= */

/**
 * Druck dieses Schusses (0..1). Er wächst mit jeder Runde und mit der
 * Bedeutung: Ein Matchball wiegt schwer, ein "jetzt oder nie" noch schwerer.
 */
function druckVon(runde, lage) {
  let d = C.druckRunde * (runde - 1);
  if (lage.matchball) d += C.druckMatchball;
  if (lage.muss) d += C.druckMuss;
  else if (lage.rueckstand) d += C.druckRueckstand;
  if (lage.sudden) d += C.druckSudden;
  return clamp(d, 0, C.druckMax);
}

/** Trefferwahrscheinlichkeit eines Schusses. */
function trefferChance(schuetze, keeper, druck, difficulty, gegnerSeite) {
  let p = C.basis + C.spanne * (schuetzenWert(schuetze) - torwartWert(keeper)) / 100;

  if (hatTrait(schuetze, 'elfmeterkiller')) p += C.traitKiller;
  if (hatTrait(schuetze, 'eisblock')) p += C.traitEisblock;
  if (hatTrait(schuetze, 'mimose')) p -= C.traitMimose;
  if (hatTrait(keeper, 'torwartlegende')) p -= C.traitTorwartlegende;

  p -= C.muede * (1 - frischeVon(schuetze));

  // Nerven dämpfen den Druck: Der Eisblock spürt ihn halb, die Mimose doppelt.
  const nerven = A(schuetze, 'nervenstaerke');
  const daempfung = clamp(1 - C.druckNerven * ((nerven - 50) / 50), 0.35, 1.7);
  p -= C.druckWirkung * druck * daempfung;

  // Schwierigkeitsgrad: Wie in der Engine trifft die KI gegen den Manager
  // je nach Stufe etwas besser oder schlechter (difficulty.opponentFinishing).
  if (gegnerSeite && difficulty && difficulty.opponentFinishing) {
    p *= difficulty.opponentFinishing;
  }
  return clamp(p, C.pMin, C.pMax);
}

/* ===========================================================================
 * 5. ECKEN UND TEXTE
 * ========================================================================= */

const ECKEN = [
  { id: 'unten links', seite: 'links', hoch: false, gewicht: 1.00, koennen: 0.0 },
  { id: 'unten rechts', seite: 'rechts', hoch: false, gewicht: 1.00, koennen: 0.0 },
  { id: 'halbhoch links', seite: 'links', hoch: false, gewicht: 0.55, koennen: 0.3 },
  { id: 'halbhoch rechts', seite: 'rechts', hoch: false, gewicht: 0.55, koennen: 0.3 },
  { id: 'oben links', seite: 'links', hoch: true, gewicht: 0.40, koennen: 1.0 },
  { id: 'oben rechts', seite: 'rechts', hoch: true, gewicht: 0.40, koennen: 1.0 },
  { id: 'flach in die Mitte', seite: 'mitte', hoch: false, gewicht: 0.22, koennen: 0.6 }
];

/**
 * Die Ecke wird NACH dem Ausgang gewählt, damit Text und Ergebnis
 * zusammenpassen: Wer daneben schießt, hat hoch gezielt; wer gehalten wird,
 * hat es dem Torwart zu bequem gemacht.
 */
function eckeWaehlen(rng, schuetze, art) {
  const koennen = schuetzenWert(schuetze) / 100;
  return rng.pickWeighted(ECKEN, e => {
    // Je anspruchsvoller die Ecke, desto mehr Können braucht es dafür.
    let w = e.gewicht * (1 - e.koennen * (1 - koennen));
    // Ausgänge, die zur Ecke gar nicht passen, fallen weg: Wer in die Mitte
    // schießt, trifft keinen Pfosten und setzt ihn nicht neben den Kasten.
    if (art === 'daneben') { if (e.seite === 'mitte') return 0; w *= e.hoch ? 2.6 : 1; }
    if (art === 'pfosten') { if (e.seite === 'mitte') return 0; }
    if (art === 'latte') { if (!e.hoch) return 0; }
    if (art === 'gehalten') w *= e.hoch ? 0.35 : 1.2;
    return Math.max(0.01, w);
  });
}

/** Wohin fliegt der Torwart? Muss zum Ausgang passen. */
function torwartEckeWaehlen(rng, ecke, art) {
  const andere = ecke.seite === 'links' ? 'rechts' : ecke.seite === 'rechts' ? 'links' : (rng.chance(0.5) ? 'links' : 'rechts');
  if (art === 'gehalten') return ecke.seite;                       // er war dort, wo der Ball war
  if (art === 'tor') return rng.chance(0.72) ? andere : ecke.seite; // meist in die falsche Ecke
  return rng.chance(0.5) ? ecke.seite : andere;                    // daneben/Aluminium: egal
}

const T = {
  tor: [
    '{s} nimmt Anlauf und drischt ihn {ecke} – {tw} hatte nicht den Hauch einer Chance.',
    '{s} bleibt eiskalt und schiebt ihn {ecke}. Kein Zittern, kein Zögern.',
    '{s} schaut kurz hoch, dann zappelt das Netz: {ecke}.',
    '{s} wartet, bis sich {tw} entscheidet – und legt ihn seelenruhig {ecke}.',
    '{s} hämmert ihn {ecke} ins Netz. Da hilft auch kein Gebet.',
    '{s} zieht durch, {ecke}, und die halbe Bank springt auf.'
  ],
  torFlattern: [
    '{s} trifft {ecke}, aber die Knie haben gezittert – das sah man.',
    '{s} rutscht fast weg, trifft aber trotzdem {ecke}. Fußball ist manchmal gnädig.'
  ],
  gehalten: [
    '{tw} ahnt es, geht {twricht} – und hat ihn! {s} steht da wie bestellt und nicht abgeholt.',
    '{s} zielt {ecke}, doch {tw} ist längst unten. Gehalten!',
    '{tw} bleibt eine Ewigkeit stehen und pflückt den Ball aus der Luft. {s} fasst sich an den Kopf.',
    '{s} schießt zu brav {ecke}, {tw} muss sich kaum strecken. Das war zu wenig.',
    'Parade! {tw} ist {twort} zur Stelle und hält den Ball fest. Der Block dahinter explodiert.'
  ],
  daneben: [
    '{s} verzieht – der Ball segelt Richtung Flutlicht. Dort sucht ihn morgen noch der Platzwart.',
    '{s} nimmt zu viel Kraft und jagt das Ding weit über das Tor. {tw} musste sich nicht mal bewegen.',
    '{s} rutscht der Fuß weg, der Ball fliegt {ecke} am Kasten vorbei ins Nirgendwo.',
    '{s} zielt {ecke} und zielt schlecht. Vorbei. Ein ganzer Block hält die Luft an – vergeblich.'
  ],
  pfosten: [
    'Pfosten! {s} trifft nur Aluminium, zwei Zentimeter weiter und alle wären glücklich.',
    '{s} setzt ihn {ecke} an den Pfosten. Der Ball springt zurück ins Feld und mit ihm ein ganzer Traum.'
  ],
  latte: [
    'Latte! {s} zimmert ihn an die Querlatte, das Ding wackelt noch minutenlang.',
    '{s} nimmt Maß, zielt {ecke} – und die Latte klatscht dagegen. Das Stadion stöhnt auf.'
  ],
  vorMatchball: [
    'Jetzt kann {s} alles klarmachen.',
    'Ein Treffer, und es ist vorbei.',
    'Der Matchball liegt auf dem Punkt.'
  ],
  vorMuss: [
    '{s} muss treffen, sonst ist Feierabend.',
    'Jetzt oder nie.',
    'Kein Netz, kein Weiterkommen – {s} weiß das genau.'
  ],
  vorSudden: [
    'Runde {runde}. Die Nerven liegen längst blank.',
    'Weiter geht es, Runde {runde} – das zerrt an allem, was ein Mensch hat.',
    'Runde {runde}, immer noch kein Sieger.'
  ],
  vorNormal: [
    '', '', '',
    'Zwei tiefe Atemzüge, dann geht es weiter.'
  ]
};

/* ===========================================================================
 * 6. DER ABLAUF
 * ========================================================================= */

/**
 * Steht der Sieger schon fest? -> 'home' | 'away' | null
 *
 * Die Restschüsse gelten für beide Phasen: In der regulären Serie sind es die
 * Schüsse bis zum fünften, im K.o. der noch ausstehende Schuss der laufenden
 * Runde. Deshalb ist ein Vorsprung nach dem ersten Schuss einer K.-o.-Runde
 * ausdrücklich noch keine Entscheidung.
 */
function entschieden(h, a, regulaer) {
  const restH = Math.max(0, regulaer - h.versuche, a.versuche - h.versuche);
  const restA = Math.max(0, regulaer - a.versuche, h.versuche - a.versuche);
  if (h.tore > a.tore + restA) return 'home';
  if (a.tore > h.tore + restH) return 'away';
  return null;
}

/** Lage dieses Schusses: Matchball? Muss er treffen? */
function lageVon(seite, gegner, regulaer, sudden) {
  if (sudden) {
    // Im K.o. zählt nur die laufende Runde: Der zweite Schütze steht entweder
    // vor dem Matchball (der Gegner hat verschossen) oder mit dem Rücken zur Wand.
    const zweiter = seite.versuche < gegner.versuche;
    return {
      sudden: true,
      matchball: zweiter && gegner.tore === seite.tore,
      muss: zweiter && gegner.tore > seite.tore,
      rueckstand: seite.tore < gegner.tore
    };
  }
  const restGegner = Math.max(0, regulaer - gegner.versuche);
  const restEigen = Math.max(0, regulaer - seite.versuche);
  return {
    sudden: false,
    matchball: seite.tore + 1 > gegner.tore + restGegner,
    muss: seite.tore + (restEigen - 1) < gegner.tore,
    rueckstand: seite.tore < gegner.tore
  };
}

/**
 * Der eigentliche Ablauf als Generator: Er hält an jedem interaktiven
 * Elfmeter an und bekommt die resolution zurückgereicht (wie match.js).
 */
function* ablauf(setup) {
  const rng = (setup && setup.rng) || createRng(4711);
  const regulaer = C.regulaer;
  const seiten = {
    home: baueSeite(setup.heim, 'home', rng),
    away: baueSeite(setup.gast, 'away', rng)
  };
  angleichen(seiten.home, seiten.away);

  const onSchuss = typeof setup.onSchuss === 'function' ? setup.onSchuss : null;
  const interaktivSeite = (setup.interactiveSide === 'home' || setup.interactiveSide === 'away')
    ? setup.interactiveSide : null;
  const onKeyMoment = typeof setup.onKeyMoment === 'function' ? setup.onKeyMoment : null;
  const wettbewerb = (setup.competition && (setup.competition.name || setup.competition.id)) || 'Pokalspiel';
  const minute = setup.minute != null ? setup.minute : 120;

  const text = [];
  const schuesse = [];
  text.push(`Elfmeterschießen. ${kurzName(seiten.home.club)} gegen ${kurzName(seiten.away.club)} – ` +
    'jetzt zählen keine Systeme mehr, jetzt zählen Nerven.');

  // Wer beginnt, entscheidet die Münze – das ist die einzige Stelle, an der
  // ein Münzwurf im Pokal noch etwas verloren hat.
  const beginner = (setup.beginnt === 'home' || setup.beginnt === 'away')
    ? setup.beginnt
    : (rng.chance(0.5) ? 'home' : 'away');
  text.push(`Die Münze fällt für ${kurzName(seiten[beginner].club)}: ${kurzName(seiten[beginner].club)} schießt zuerst.`);

  const folge = beginner === 'home' ? ['home', 'away'] : ['away', 'home'];
  let sieger = null;
  let runde = 0;
  let vorzeitig = false;

  while (!sieger && runde < C.maxRunden) {
    runde++;
    const sudden = runde > regulaer;

    for (const key of folge) {
      const seite = seiten[key];
      const gegner = seiten[key === 'home' ? 'away' : 'home'];
      if (!seite.reihenfolge.length) {
        // Kann eigentlich nicht passieren – wenn doch, tritt eben niemand an.
        text.push(`${kurzName(seite.club)} bekommt keinen Schützen mehr auf die Beine.`);
        sieger = gegner.side;
        break;
      }

      // Jeder ist einmal dran, bevor einer zweimal antritt – danach von vorn.
      const schuetze = seite.reihenfolge[seite.naechster % seite.reihenfolge.length];
      seite.naechster++;
      const keeper = gegner.torwart;

      const lage = lageVon(seite, gegner, regulaer, sudden);
      const druck = druckVon(runde, lage);
      const gegnerSeite = interaktivSeite ? key !== interaktivSeite : false;
      const p = trefferChance(schuetze, keeper, druck, setup.difficulty, gegnerSeite);

      /* --- Interaktiv: der Nutzer schießt selbst (CONTRACTS 6.1) --- */
      let res = null;
      if (onKeyMoment && interaktivSeite === key) {
        const moment = {
          kind: 'elfmeter',
          minute,
          team: key,
          actor: schuetze,
          keeper: keeper || null,
          defenders: [],           // beim Schießen steht keine Mauer im Weg
          targets: [],
          at: { x: key === 'home' ? MC.feldL - 11 : 11, y: round(MC.feldB / 2, 1) },
          baseChance: round(p, 3),
          pressure: Math.round(clamp(druck * 100, 0, 100)),
          context: {
            score: [seiten.home.tore, seiten.away.tore],
            minute,
            competition: wettbewerb
          }
        };
        res = yield moment;
      }

      let art;
      if (res) {
        art = ausMinispiel(rng, res, schuetze, p, setup.difficulty);
      } else {
        art = wuerfeln(rng, p);
      }
      const getroffen = art === 'tor';

      const ecke = eckeWaehlen(rng, schuetze, art);
      const twEcke = torwartEckeWaehlen(rng, ecke, art);

      seite.versuche++;
      if (getroffen) seite.tore++;

      const daten = {
        s: nam(schuetze), tw: keeper ? nam(keeper) : 'der Torwart',
        ecke: ecke.id, runde: String(runde),
        twricht: twEcke === 'mitte' ? 'in die Mitte' : 'nach ' + twEcke,
        twort: twEcke === 'mitte' ? 'in der Mitte' : twEcke
      };
      const vorlauf = lage.matchball ? T.vorMatchball : lage.muss ? T.vorMuss : sudden ? T.vorSudden : T.vorNormal;
      const einleitung = fuellen(rng.pick(vorlauf), daten);
      const kernListe = art === 'tor'
        ? (druck > 0.4 && rng.chance(0.25) ? T.torFlattern : T.tor)
        : T[art];
      const kern = fuellen(rng.pick(kernListe), daten);
      const zeile = (einleitung ? einleitung + ' ' : '') + kern;

      const schuss = {
        team: key,
        playerId: schuetze.id,
        getroffen,
        ecke: ecke.id,
        torwartEcke: twEcke,
        text: zeile,
        art,
        runde,
        nummer: schuesse.length + 1,
        keeperId: keeper ? keeper.id : null,
        stand: [seiten.home.tore, seiten.away.tore]
      };
      schuesse.push(schuss);
      text.push(`${seiten.home.tore}:${seiten.away.tore} — ${zeile}`);
      if (onSchuss) { try { onSchuss(schuss); } catch (err) { /* Anzeige darf nichts kippen */ } }

      sieger = entschieden(seiten.home, seiten.away, regulaer);
      if (sieger) { vorzeitig = seite.versuche < regulaer || gegner.versuche < regulaer; break; }
    }
  }

  // Notbremse: Nach 40 Runden hat auch der letzte Innenverteidiger dreimal
  // geschossen. Dann gewinnt, wer mehr getroffen hat – und bei exakt gleichem
  // Stand die Mannschaft mit den besseren Nerven auf dem Punkt.
  if (!sieger) {
    if (seiten.home.tore !== seiten.away.tore) sieger = seiten.home.tore > seiten.away.tore ? 'home' : 'away';
    else {
      const nervenH = seiten.home.reihenfolge.reduce((s, p) => s + A(p, 'nervenstaerke'), 0);
      const nervenA = seiten.away.reihenfolge.reduce((s, p) => s + A(p, 'nervenstaerke'), 0);
      sieger = nervenH >= nervenA ? 'home' : 'away';
    }
    text.push('Irgendwann muss auch mal Schluss sein – der Schiedsrichter beendet das Trauerspiel.');
  }

  if (vorzeitig) {
    text.push(`Der Rest wird nicht mehr gebraucht: Bei ${seiten.home.tore}:${seiten.away.tore} hilft kein Rechnen mehr.`);
  }
  const verlierer = sieger === 'home' ? seiten.away : seiten.home;
  text.push(`Endstand vom Punkt: ${seiten.home.tore}:${seiten.away.tore}. ` +
    `${kurzName(seiten[sieger].club)} ist weiter, ${kurzName(verlierer.club)} fährt nach Hause.`);

  return {
    sieger,
    tore: [seiten.home.tore, seiten.away.tore],
    schuesse,
    runden: Math.max(seiten.home.versuche, seiten.away.versuche),
    text,
    beginner,
    suddenDeath: runde > regulaer
  };
}

/** Ausgang eines simulierten Schusses. */
function wuerfeln(rng, p) {
  if (rng.chance(p)) return 'tor';
  const r = rng.next();
  if (r < C.anteilGehalten) return 'gehalten';
  if (r < C.anteilGehalten + C.anteilDaneben) return 'daneben';
  return rng.chance(C.anteilLatte) ? 'latte' : 'pfosten';
}

/**
 * Ausgang eines vom Nutzer geschossenen Elfmeters.
 * Formel exakt wie CONTRACTS 6.1 / match.js:loesungAnwenden – gutes Timing
 * ersetzt kein Können, und die Engine entscheidet final.
 */
function ausMinispiel(rng, res, schuetze, baseChance, difficulty) {
  const out = res.outcome || 'abgeschlossen';
  if (out === 'daneben' || out === 'geblockt' || out === 'abgefangen') return 'daneben';
  if (out === 'latte') return 'latte';
  if (out === 'pfosten') return 'pfosten';
  if (out === 'parade') return 'gehalten';

  const q = clamp(res.quality != null ? res.quality : 0.5, 0, 1);
  const skill = schuetzenWert(schuetze);
  const skillF = MC.kmSkillBasis + MC.kmSkillSpanne * (skill / 100);
  const minigame = (difficulty && difficulty.minigame) || 1;
  const diffF = 1 / (1 + MC.kmSchwierigkeit * (minigame - 1));
  const base = clamp(baseChance + (res.xgDelta || 0), 0.01, 0.95);
  const p = clamp(base * (0.45 + 0.9 * q) * skillF * diffF, 0.02, 0.97);

  if (rng.chance(p)) return 'tor';
  return rng.chance(0.6) ? 'gehalten' : 'daneben';
}

/* ===========================================================================
 * 7. ÖFFENTLICHER EINSTIEG
 * ========================================================================= */

/**
 * Ein Elfmeterschießen austragen.
 *
 * @param {object} setup
 *   heim, gast            MatchTeam (CONTRACTS 6). Optionales Feld
 *                         `aufDemPlatz` (Spieler oder Ids) = die Schlusself.
 *   rng                   Rng-Instanz (Pflicht in der Spiellogik)
 *   difficulty            DIFFICULTIES-Eintrag
 *   interactive           false
 *   interactiveSide       'home' | 'away' | null
 *   onSchuss(schuss)      synchron, nach jedem Schuss (Live-Anzeige)
 *   onKeyMoment(moment)   async, nur für interactiveSide (CONTRACTS 6.1)
 *   competition, minute, beginnt   optional
 *
 * @returns {object|Promise<object>} ergebnis – SYNCHRON, solange kein
 *   onKeyMoment gesetzt ist (so ruft core/loop.js es auf); mit onKeyMoment ein
 *   Promise. `await elfmeterschiessen(...)` funktioniert in beiden Fällen.
 */
export function elfmeterschiessen(setup) {
  const s = setup || {};
  const it = ablauf(s);
  const interaktiv = typeof s.onKeyMoment === 'function' &&
    (s.interactiveSide === 'home' || s.interactiveSide === 'away');

  if (!interaktiv) {
    let r = it.next();
    while (!r.done) r = it.next(null);
    return r.value;
  }

  return (async () => {
    let r = it.next();
    while (!r.done) {
      let res = null;
      try { res = await s.onKeyMoment(r.value); } catch (err) { res = null; }
      r = it.next(res);
    }
    return r.value;
  })();
}

/** Immer-asynchrone Variante für die Oberfläche – spart das Raten am Rückgabetyp. */
export async function elfmeterschiessenLive(setup) {
  return elfmeterschiessen(setup);
}

export default { elfmeterschiessen, elfmeterschiessenLive, schuetzenreihenfolge, SHOOTOUT_CONSTANTS };
