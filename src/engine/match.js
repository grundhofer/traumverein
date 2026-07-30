/**
 * engine/match.js — Die minutengenaue Spielsimulation von TRAUMVEREIN.
 * ===========================================================================
 *
 * Vertrag: docs/CONTRACTS.md Abschnitte 6, 6.0a, 6.1.
 * Aufrufer: game/matchday.js (Manager-Spiel, alle Live-Hooks)
 *           core/loop.js     (17 KI-Partien je Spieltag über quickSimulate)
 *
 * KEINE DOM-Zugriffe, kein Math.random(), kein Date.now().
 *
 * ---------------------------------------------------------------------------
 * MODELL — Fußball nachbilden, nicht würfeln
 * ---------------------------------------------------------------------------
 * Das Spiel besteht aus BALLBESITZPHASEN. Pro Minute laufen 1–3 davon ab.
 * Jede Phase beginnt bei einem Team (Wahrscheinlichkeit aus Mittelfeldstärke,
 * Spielstil, Slidern, Momentum, Unterzahl) und wandert durch Zonen:
 *
 *   Z0 eigenes Drittel → Z1 Mittelfeld → Z2 letztes Drittel → Z3 Strafraum → Abschluss
 *
 * Jeder Zonenübergang ist ein Duell: Angriffsqualität gegen Abwehrqualität,
 * aufgelöst über eine logistische (Elo-artige) Funktion. Kein linearer Würfel —
 * kleine Stärkeunterschiede wirken schwach, große wirken deutlich.
 *
 * Der Abschluss bekommt ein xG aus Distanz, Winkel, Druck, Abschlussart und
 * den Fähigkeiten des Schützen. Die Torwahrscheinlichkeit ist dieses xG,
 * moduliert über die Torwartqualität. Verfehlt der Ball das Tor, wird
 * nachträglich entschieden, WIE er es verfehlt hat (geblockt / daneben /
 * Parade / Aluminium) — so bleibt die Summe der xG die Erwartung der Tore.
 *
 * ---------------------------------------------------------------------------
 * ZIELWERTE (gemessen von tools/test-match.js über 2000 Spiele)
 * ---------------------------------------------------------------------------
 *   Tore gesamt 2,8–3,2 · Heimvorteil ≈ +0,35 Tore · Schüsse 22–28
 *   aufs Tor 8–10 · Ecken 9–11 · Fouls 20–26 · Gelbe 3,5–4,5 · Rote 0,05–0,12
 *   Abseits 3–5 · Ballbesitz typisch 40:60 … 60:40 · Passquote 74–88 %
 *   0:0-Anteil ≈ 8 % · häufigste Ergebnisse 1:0, 2:1, 1:1, 2:0
 *   Standardtore 25–30 % · Elfmeter ≈ 0,25 · Verletzungen ≈ 0,25
 *
 * GEMESSEN (2000 Spiele, Stand der aktuellen MATCH_CONSTANTS):
 *   Tore 3,12 · Heimvorteil +0,33 · Schüsse 25,9 · aufs Tor 8,5 · Ecken 9,4
 *   Fouls 22,8 · Gelbe 3,83 · Rote 0,08 · Abseits 3,9 · Passquote 78,9 %
 *   0:0-Anteil 7,9 % · xG 3,32 · Verletzungen 0,29 · Standardtore 25,0 %
 *   Torschützen STU 48 % / MIT 34 % / ABW 18 % · Punkteschnitt Favorit 2,25
 *
 * Sämtliche Stellschrauben stehen in MATCH_CONSTANTS. Wer balancen will,
 * schraubt AUSSCHLIESSLICH dort und lässt tools/test-match.js laufen.
 * ---------------------------------------------------------------------------
 */

import {
  WEATHER, INJURY_TYPES, DIFFICULTIES, POSITION_GROUP, POSITION_NAMES
} from '../core/constants.js';
import { clamp, round, avg, sortBy } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { effectiveRating, playerOverall, teamStrength, tacticMatchup } from './ratings.js';
import { FORMATIONS, STYLES, INSTRUCTIONS, ROLES, autoLineup } from './tactics.js';

/* ===========================================================================
 * 1. BALANCING — MATCH_CONSTANTS
 * ========================================================================= */

export const MATCH_CONSTANTS = {

  /* --- Spieldauer & Nachspielzeit ------------------------------------- */
  halbzeit: 45,                 // reguläre Minuten je Halbzeit
  nachBasis: 0.7,               // Grundsockel Nachspielzeit (Minuten)
  nachProTor: 0.55,             // Jubel kostet Zeit
  nachProWechsel: 0.18,
  nachProVerletzung: 1.15,      // Behandlung auf dem Platz
  nachProKarte: 0.20,
  nach1Min: 0, nach1Max: 3,     // Nachspielzeit 1. Halbzeit
  nach2Min: 1, nach2Max: 6,     // Nachspielzeit 2. Halbzeit

  /* --- Ballbesitzphasen ------------------------------------------------ */
  // Gewichte für 1 / 2 / 3 Phasen pro Minute (Mittelwert ≈ 2,15).
  phasenGewichte: [0.24, 0.36, 0.40],
  // Wie stark das Tempo-Slider-Mittel beider Teams die Phasenzahl anhebt.
  phasenTempoWirkung: 0.35,
  // Elo-Skala für die Ballbesitzverteilung (Punkte Mittelfeldstärke).
  ballbesitzSkala: 30.0,
  besitzSaettigung: 28.0,
  // Deckel: kein Team bekommt dauerhaft mehr als diesen Anteil der Phasen.
  ballbesitzMin: 0.28, ballbesitzMax: 0.72,
  // Sekunden Animationszeit je Zonenabschnitt einer Phase.
  phasenDauerBasis: 1.5, phasenDauerProZone: 0.75,

  /* --- Zonenübergänge (logistisch) ------------------------------------- */
  // p = 2 * pBasis * L((angriff - abwehr)/skala)  → bei Gleichstand exakt pBasis.
  zoneSkala: 40.0,
  // Ab dieser Differenz (Stärkepunkte) wächst der Vorteil nur noch langsam.
  // Verhindert, dass sich ein Klassenunterschied über vier Zonen potenziert.
  duellSaettigung: 13.0,
  pAufbau: 0.78,        // eigenes Drittel → Mittelfeld
  pMittelfeld: 0.375,   // Mittelfeld → letztes Drittel
  pStrafraum: 0.278,    // letztes Drittel → Strafraum
  pAbschluss: 0.560,    // Strafraum → Torschuss
  // Aus dem letzten Drittel wird auch aus der Distanz abgezogen.
  distanzschussRate: 0.075,
  // Obergrenzen, damit auch Übermannschaften nicht durchmarschieren.
  zoneMax: 0.93, zoneMin: 0.04,

  /* --- Startzone einer Phase (Pressinghöhe!) --------------------------- */
  // Basisverteilung eigenes Drittel / Mittelfeld / letztes Drittel
  startZ0: 0.55, startZ1: 0.32, startZ2: 0.13,
  // Wie stark hohe Pressinghöhe Ballgewinne nach vorne verschiebt (0..1 Anteil).
  pressingVerschiebung: 0.30,
  // Ein Konter startet tiefer, ist aber deutlich gefährlicher.
  konterBonus: 0.16,            // Bonus auf die Übergangswahrscheinlichkeiten
  konterDruck: 16,              // Druckpunkte weniger beim Konterabschluss (mehr Platz)
  konterDistanz: 0.5,           // Konter enden seltener im Distanzschuss
  konterRate: 0.30,             // Anteil der Ballgewinne, die zum Konter werden
  konterStilBonus: { konter: 0.22, umschaltspiel: 0.16, pressing: 0.06, kick_and_rush: 0.05 },

  /* --- xG-Modell -------------------------------------------------------- */
  xgFaktor: 0.742,      // Skalierung der xG-Kurve
  xgDistanz: 0.115,     // Abklingkonstante je Meter
  xgWinkelRef: 0.64,    // Referenzwinkel (Elfmeterpunkt, zentral)
  xgWinkelExp: 0.62,    // Wie stark der Winkel wirkt
  xgMin: 0.008, xgMax: 0.92,
  // Abschlussarten
  xgKopfball: 0.60, xgVolley: 0.80, xgDistanzschuss: 0.92, xgSchuss: 1.0,
  // Druck 0..100 senkt das xG
  xgDruck: 0.42,
  // Schützenfähigkeit: 0.60 (Gurke) … 1.36 (Weltklasse)
  xgSkillMin: 0.60, xgSkillSpanne: 0.76,
  // Torwart: 1.16 (Vogelscheuche) … 0.80 (Weltklasse)
  // Torwartwirkung. Die Spanne war deutlich schmaler als die der Feldspieler
  // (xgSkillSpanne), Weltklassetorhüter konnten Weltklassestürmern also nicht
  // gleichwertig entgegenhalten. Verbreitert; der Mittelwert (basis − wirkung/2)
  // bleibt bei rund 0,98, damit durchschnittliche Paarungen unverändert bleiben.
  //
  // Zur Einordnung, gemessen über je 1000+ Spiele: Die Trefferquote ist in der
  // 1. Bundesliga und in einer prozedural erzeugten Durchschnittsliga exakt gleich
  // (11,5 %). Dass die Bundesliga hier bei rund 3,4 statt 2,9 Toren liegt, kommt
  // allein daher, dass die Vereinslegenden ~20 % mehr Abschlüsse herausspielen –
  // das ist gewollt und kein Fehler der Simulation.
  twWirkung: 0.70, twBasis: 1.33,
  // Nervenstärke in der Schlussphase (ab Minute 75)
  nervenSchluss: 0.14,

  /* --- Verteilung der Nicht-Tore --------------------------------------- */
  blockAnteil: 0.275,      // geblockt
  aluAnteil: 0.030,        // Latte/Pfosten
  paradeAnteilBasis: 0.15, // Parade-Grundanteil
  paradeAnteilXg: 0.26,    // je höher das xG, desto eher hält der Keeper
  // Rest = daneben

  /* --- Schussverteilung ------------------------------------------------- */
  kopfballAnteilStrafraum: 0.20,   // Grundanteil Kopfbälle im Strafraum
  volleyAnteil: 0.07,
  kickRushKopfball: 0.24,          // Zuschlag bei Kick-and-Rush / Flügelspiel

  /* --- Fouls, Karten, Elfmeter ------------------------------------------ */
  foulProDuell: 0.101,       // Foulwahrscheinlichkeit je verlorenem Zonenduell
  foulHaerte: 0.55,          // Wirkung des Slider "haerte" (0..100)
  foulAggressivitaet: 0.42,  // Wirkung der Aggressivität der Abwehrreihe
  karteBasis: 0.128,         // p(Gelb | Foul) bei neutralem Schiedsrichter
  karteStrenge: 0.62,        // Wirkung von referee.strictness
  karteHaerte: 0.30,
  karteEisenfuss: 1.35,      // Trait-Zuschlag
  karteTaktisch: 1.5,        // Foul gegen einen Konter wird härter geahndet
  rotDirekt: 0.007,          // p(Rot statt Gelb | Karte)
  karteZweiteGelbe: 0.13,    // Verwarnte Spieler sind vorsichtig, Schiris nachsichtig
  elfmeterProStrafraumfoul: 0.30,
  strafraumfoulAnteil: 0.032, // Anteil der Strafraumaktionen, die ein Foul werden
  elfmeterXg: 0.762,
  unterzahlMalus: 0.135,     // Stärkeverlust nach Roter Karte
  unterzahlBesitz: 0.10,

  /* --- Abseits, Ecken, Standards ---------------------------------------- */
  abseitsRate: 0.045,        // je Versuch, ins letzte Drittel/Strafraum zu kommen
  abseitsfalleBonus: 1.45,   // Anweisung "abseitsfalle"
  eckeNachBlock: 0.34,
  eckeNachParade: 0.38,
  eckeNachAlu: 0.45,
  eckeNachAngriff: 0.079,    // gescheiterter Angriff im letzten Drittel
  eckeAbschlussRate: 0.360,  // Anteil der Ecken, aus denen ein Abschluss entsteht
  // Wie eckenfreudig ein Spielstil ist (Flanken, lange Bälle, zweite Bälle).
  stilEcken: { kick_and_rush: 0.55, offensiv: 0.15, pressing: 0.05, ausgeglichen: 0,
               umschaltspiel: -0.05, ballbesitz: -0.12, konter: -0.18, defensiv: -0.22 },
  eckeKopfballAnteil: 0.72,
  freistossGefaehrlich: 0.28, // Anteil der Fouls im letzten Drittel mit Direktschuss
  freistossXgFaktor: 2.40,   // freier Schuss auf ein volles Tor – dafuer Mauer und Distanz

  /* --- Pässe ------------------------------------------------------------ */
  paesseProZone: 3.1,        // Pässe je durchlaufenem Zonenabschnitt
  paesseBasis: 1.6,
  passQuoteBasis: 0.795,     // Grundpassquote bei ausgeglichener Qualität
  passQuoteSkala: 0.0022,    // je Punkt Qualitätsvorsprung
  passQuoteMin: 0.62, passQuoteMax: 0.93,
  // Kurzpassspiel und lange Bälle wirken über INSTRUCTIONS.mods.passLaenge,
  // das oben in stilMods() in seite.mods.passLaenge einfließt.

  /* --- Wer schießt, wer legt auf? ---------------------------------------- */
  // Gewichte je Mannschaftsteil. Ergebnis: Stürmer deutlich vor Mittelfeld
  // vor Abwehr — bei Standards drehen sich die Verhältnisse Richtung Abwehr.
  schussGewicht: { TW: 0.0005, ABW: 0.10, MIT: 0.40, STU: 1.0 },
  kopfballGewicht: { TW: 0.0005, ABW: 0.58, MIT: 0.42, STU: 1.0 },
  vorlageGewicht: { TW: 0.02, ABW: 0.34, MIT: 1.0, STU: 0.72 },
  vorlageRate: 0.72,          // Anteil der Abschlüsse mit echtem Vorlagengeber
  eigentorRate: 0.0022,       // je verteidigter Strafraumaktion

  /* --- Müdigkeit --------------------------------------------------------- */
  ermuedungProMinute: 0.0093,  // Grundverbrauch je Minute (Anteil der Frische)
  ermuedungAusdauer: 0.85,     // wie stark die Ausdauer schützt
  ermuedungLaufwunder: 0.62,   // Trait 'laufwunder'
  ermuedungRolle: {            // Positionsabhängige Laufleistung
    TW: 0.25, IV: 0.85, LV: 1.15, RV: 1.15, DM: 1.05, ZM: 1.15,
    LM: 1.25, RM: 1.25, OM: 1.10, LA: 1.18, RA: 1.18, ST: 1.00
  },
  ermuedungPressing: 0.55,     // Zuschlag über die Pressinghöhe (0..100)
  ermuedungTempo: 0.30,        // Zuschlag über den Tempo-Slider
  ermuedungWetter: 0.35,       // Zuschlag bei Hitze/Schnee/Regen
  muedigkeitsWirkung: 0.30,    // maximaler Leistungsverlust bei völliger Erschöpfung
  frischeEinwechsler: 1.0,     // Einwechselspieler starten mit voller Frische

  /* --- Verletzungen ------------------------------------------------------ */
  verletzungProSpielMinute: 0.00268,  // Grundrate je Minute (beide Teams zusammen)
  verletzungGlasknochen: 2.4,        // Trait 'glasknochen'
  verletzungFrische: 0.5,            // müde Spieler verletzen sich häufiger

  /* --- Heimvorteil ------------------------------------------------------- */
  heimBasis: 0.004,          // Grundbonus auf alle Stärkewerte
  heimZuschauer: 0.006,      // zusätzlich je nach Auslastung (0..1 über 60 %)
  heimAuslastungRef: 0.60,
  heimSchiedsrichter: 0.004, // referee.homeBias
  heimNeutral: 0.15,         // Restanteil bei neutralem Platz
  heimBesitz: 1.20,          // Übersetzung Heimbonus → Zuschlag auf den Ballbesitzanteil

  /* --- Momentum & Psyche -------------------------------------------------- */
  momentumTor: 0.46,         // Schub für den Torschützen-Verein
  momentumGegentor: 0.12,    // Aufbäumen des Gegners (wird gleich gegengerechnet)
  momentumZerfall: 0.86,     // je Minute
  momentumWirkung: 0.075,    // Einfluss auf Übergangswahrscheinlichkeiten
  besitzZonenGewicht: 0.45,  // wie stark weite Vorstöße auf den Ballbesitz einzahlen
  tagesform: 0.038,          // Streuung der Tagesform je Team und Spiel (Standardabw.)
  // Spielcharakter: manche Partien sind ein offener Schlagabtausch, andere ein
  // zähes Abtasten. Ein GEMEINSAMER Faktor für beide Teams – genau er sorgt für
  // den realistischen 0:0-Anteil, den ein reines Poisson-Modell nie erreicht.
  spielCharakter: 0.155,
  rueckstandDrang: 0.09,     // Wer hinten liegt, macht ab Minute 65 mehr Druck
  fuehrungVerwaltung: 0.05,  // Wer führt, zieht sich zurück

  /* --- Wechsel & Ansprache ------------------------------------------------ */
  maxWechsel: 5,
  kiWechselAb: 58,           // ab dieser Minute wechselt die KI
  kiWechselFrische: 0.62,    // unter dieser Frische wird getauscht
  anspracheMax: 25,          // Moraländerung wird auf ±25 begrenzt
  anspracheWirkung: 0.0035,  // Moralpunkt → Leistungsfaktor
  // Wie stark difficulty.aiStrength auf den Gegner des Managers durchschlägt.
  // 1.0 wäre brutal (Legendenstatus +22 %); 0.45 ist spürbar, aber fair.
  schwierigkeitWirkung: 0.45,

  /* --- Key Moments --------------------------------------------------------- */
  kmBudgetMin: 8, kmBudgetMax: 14,
  kmGrosschanceXg: 0.18,
  kmEckeJede: 3,
  kmFreistossMaxMeter: 30,
  kmKombinationRate: 0.22,
  kmSkillBasis: 0.72, kmSkillSpanne: 0.56,
  kmSchwierigkeit: 0.20,      // Wirkung von difficulty.minigame

  /* --- Noten ---------------------------------------------------------------- */
  noteBasis: 6.0,
  noteTor: 1.05, noteVorlage: 0.62, noteSchussAufTor: 0.10,
  noteZweikampf: 0.045, noteParade: 0.20, noteGegentorTw: 0.36,
  noteGegentorAbwehr: 0.13, noteGelb: 0.25, noteRot: 1.4,
  noteZuNull: 0.55, noteSieg: 0.25, noteNiederlage: 0.20,
  noteXg: 0.55, noteVergeben: 0.30, noteRauschen: 0.18,

  /* --- Feldmaße (Meter) ------------------------------------------------------ */
  feldL: 105, feldB: 68, torBreiteHalb: 3.66
};

const MC = MATCH_CONSTANTS;

/* ===========================================================================
 * 2. TEXTBAUSTEINE — deutscher Reporterton der 90er
 * ===========================================================================
 * Platzhalter: {s} Akteur · {v} Vorlagengeber · {t} eigener Verein
 *              {g} Gegner · {tw} Torwart · {min} Minute · {stand} Spielstand
 *              {gefoult} Gefoulter · {stadion} · {zuschauer} · {wetter}
 */

const T = {

  anpfiff: [
    'Der Schiedsrichter pfeift an – hier im {stadion} rollt der Ball!',
    'Anpfiff! {t} gegen {g}, {zuschauer} Zuschauer sind heiß auf dieses Spiel.',
    'Es geht los. {wetter} im {stadion}, und die Kurve ist bereits in Feierlaune.',
    'Der Ball rollt! {t} stößt an, {g} formiert sich in der eigenen Hälfte.',
    'Anpfiff im {stadion} – {zuschauer} Menschen halten den Atem an.',
    'Und weiter geht die wilde Fahrt: {t} empfängt {g} vor {zuschauer} Zuschauern.',
    'Der Unparteiische gibt das Spiel frei. Bühne frei für {t} gegen {g}!',
    'Los geht es. Bei {wetter} verspricht das ein Nachmittag für Feinschmecker zu werden.',
    'Die Mannschaften stehen, der Schiedsrichter pfeift – wir sind mittendrin!',
    'Anpfiff. {t} hat Anstoß und schiebt den Ball erst einmal nach hinten.',
    'Es kann losgehen: {t} in Heimtrikots, {g} in Weiß.',
    'Ein Pfiff, ein Raunen, und schon läuft die Uhr im {stadion}.',
    'Endlich rollt der Ball! {zuschauer} Zuschauer bilden eine prächtige Kulisse.',
    'Der Anstoß ist ausgeführt, {t} setzt sofort das erste Zeichen.',
    'Anpfiff bei {wetter} – die Bedingungen könnten kaum passender sein.',
    'Die Partie läuft. Beide Trainer stehen schon in der Coaching-Zone.',
    'Der Schiedsrichter hat gepfiffen, das Spiel im {stadion} ist eröffnet.',
    'Jetzt gilt es: {t} gegen {g}, neunzig Minuten Wahrheit.',
    'Der Ball ist im Spiel, die Fangesänge schwellen an.',
    'Anstoß! {g} beginnt mit hohem Anlaufen – das wird intensiv.',
    'Die Hymne ist verklungen, jetzt sprechen die Beine. Anpfiff!',
    'Ein voll besetztes {stadion}, {zuschauer} Zuschauer, und der Ball rollt.',
    'Der Schiedsrichter schaut auf die Uhr, pfeift – los geht die Reise.',
    'Anstoß im {stadion}. {t} will von der ersten Minute an das Tempo bestimmen.',
    'Es geht los, und die Kurve hat eine Choreografie ausgepackt.',
    'Erster Ballkontakt, erster Pfiff, erstes Raunen – das Spiel läuft.',
    'Anpfiff. Wer heute gewinnt, macht im Klassement einen ordentlichen Satz.',
    'Der Ball rollt bei {wetter} – das dürfte ein zähes Stück Arbeit werden.',
    'Die Partie ist eröffnet, {g} steht tief und lauert.',
    'Anstoß! {t} probiert es gleich mit dem langen Ball nach vorn.',
    'Der Unparteiische pfeift die Begegnung an, die Zuschauer sind auf den Beinen.',
    'Es geht los im {stadion} – Bühne frei für neunzig Minuten Fußball.',
    'Anpfiff, und sofort ist Betrieb auf beiden Seiten.',
    'Der Ball ist rund, das Spiel dauert neunzig Minuten – und es hat gerade begonnen.',
    'Anstoß bei {wetter}. Die Platzwarte haben ganze Arbeit geleistet.',
    'Und ab! {t} startet mit viel Zug nach vorne.',
    'Der Schiedsrichter gibt frei, {zuschauer} Zuschauer erheben sich von den Sitzen.',
    'Die ersten Zweikämpfe stehen an – das Spiel ist eröffnet.',
    'Anpfiff im {stadion}. Beide Mannschaften wollen die Punkte, nur eine kann sie kriegen.',
    'Los geht die Fahrt: {t} empfängt {g} zu einem Duell auf Augenhöhe.'
  ],

  halbzeit: [
    'Halbzeit im {stadion}. Es steht {stand}.',
    'Pausenpfiff. Beim Stand von {stand} geht es in die Kabinen.',
    'Der Schiedsrichter bittet zum Tee – {stand} nach 45 Minuten.',
    'Halbzeit. {stand} – die Trainer haben jetzt eine Viertelstunde zum Nachjustieren.',
    'Schluss, erste Halbzeit. {stand}, und die Kurve diskutiert bereits lautstark.',
    'Pause im {stadion}, Zwischenstand {stand}.',
    'Halbzeitpfiff. {stand} – da ist noch alles drin.',
    'Die erste Hälfte ist Geschichte, es steht {stand}.',
    'Ab in die Kabine: {stand} nach einer intensiven ersten Halbzeit.',
    'Pausenpfiff bei {stand}. Beide Trainer haben sichtlich Redebedarf.',
    'Halbzeit – {stand}. Die Zuschauer strömen zu den Bratwurstbuden.',
    'Der Unparteiische beendet den ersten Durchgang beim Stand von {stand}.',
    'Erste Halbzeit vorbei, {stand}. Das Spiel ist völlig offen.',
    'Pause. {stand}, und die Ordner haben alle Hände voll zu tun.',
    'Halbzeitpfiff im {stadion}, {zuschauer} Zuschauer sehen ein {stand}.',
    'Schluss für heute – zumindest für 15 Minuten. Es steht {stand}.',
    'Die Mannschaften verschwinden in den Katakomben, Zwischenstand {stand}.',
    'Halbzeit bei {wetter} und einem Zwischenstand von {stand}.',
    'Der erste Durchgang endet {stand} – das war Werbung für den Fußball.',
    'Pausenpfiff. {stand} – wer jetzt die richtigen Worte findet, gewinnt das Spiel.',
    'Halbzeit. Bei {stand} bleibt die Spannung erhalten.',
    'Erster Abschnitt beendet, es steht {stand} im {stadion}.',
    'Der Schiedsrichter schickt beide Teams in die Kabine, {stand}.',
    'Halbzeitpause. {stand} – jetzt sind die Trainer gefragt.',
    'Pause im {stadion}. Beim {stand} ist noch nichts entschieden.',
    'Schluss, erste Hälfte. {stand}, und die Zuschauer applaudieren.',
    'Halbzeit – {stand}. Die Statistiker greifen zu ihren Zetteln.',
    'Der erste Durchgang ist vorbei, es steht {stand}.',
    'Pausenpfiff. Bei {stand} verlassen die Mannschaften den Rasen.',
    'Halbzeit. {stand} – ein Ergebnis, mit dem beide leben können.',
    'Der Unparteiische pfeift zur Pause, {stand} lautet der Zwischenstand.',
    'Erste Hälfte im Kasten, {stand} im {stadion}.',
    'Halbzeit – {stand}. Da geht in den zweiten 45 Minuten noch einiges.',
    'Pause bei {stand}. Die Ränge summen vor Diskussionen.',
    'Der Schiedsrichter beendet die erste Halbzeit, es steht {stand}.',
    'Halbzeitpfiff, {stand}. Jetzt zählt, wer besser aus der Kabine kommt.',
    'Erster Abschnitt vorbei – {stand} vor {zuschauer} Zuschauern.',
    'Pause. {stand}, und die Mannschaften gehen unter Applaus vom Feld.',
    'Halbzeit. Beim Stand von {stand} ist noch alles möglich.',
    'Der Ball ruht für 15 Minuten, Zwischenstand {stand}.'
  ],

  abpfiff: [
    'Abpfiff! Es bleibt beim {stand}.',
    'Schlusspfiff im {stadion} – Endstand {stand}.',
    'Aus, aus, aus! Das Spiel ist aus, {stand}.',
    'Der Schiedsrichter beendet die Partie. {stand} lautet das Endergebnis.',
    'Schluss, Aus, Ende – {stand} vor {zuschauer} Zuschauern.',
    'Abpfiff. Mit {stand} gehen die Mannschaften vom Platz.',
    'Der Unparteiische pfeift ab, {stand} steht auf der Anzeigetafel.',
    'Vorbei! {stand} nach neunzig hart umkämpften Minuten.',
    'Schlusspfiff. Das {stand} geht in die Statistik ein.',
    'Aus! Die Partie endet {stand} im {stadion}.',
    'Der Schiedsrichter beendet die Begegnung beim Stand von {stand}.',
    'Abpfiff bei {wetter} – Endstand {stand}.',
    'Ende. {stand}, und die Kurve feiert ihre Mannschaft.',
    'Der letzte Pfiff ist verklungen. {stand}.',
    'Schluss im {stadion}: {stand} vor {zuschauer} Zuschauern.',
    'Vorbei ist vorbei – die Partie endet {stand}.',
    'Abpfiff! Ein {stand}, über das noch lange geredet wird.',
    'Der Schiedsrichter macht Feierabend, es bleibt beim {stand}.',
    'Ende der Vorstellung: {stand}.',
    'Schlusspfiff. Beim {stand} bleibt es, die Punkte sind verteilt.',
    'Aus im {stadion} – {stand} lautet das Endergebnis.',
    'Der Unparteiische beendet die neunzig Minuten. {stand}.',
    'Abpfiff, {stand}. Die Spieler klatschen sich ab.',
    'Ende. {stand} – und die Zuschauer erheben sich von den Rängen.',
    'Schluss. Es bleibt beim {stand}, mehr war heute nicht drin.',
    'Der letzte Ball ist gespielt, Endstand {stand}.',
    'Abpfiff im {stadion}. {stand} – ein Ergebnis mit Aussagekraft.',
    'Vorbei! {stand}, und die Tabelle ordnet sich neu.',
    'Schlusspfiff bei {wetter} und einem Endstand von {stand}.',
    'Der Schiedsrichter pfeift ab. {stand} nach neunzig Minuten plus Nachschlag.',
    'Ende, aus, {stand}. Die Fans strömen zu den Ausgängen.',
    'Abpfiff. Ein {stand}, das beide Trainer unterschiedlich bewerten werden.',
    'Schluss im {stadion} – Endstand {stand} vor {zuschauer} Zuschauern.',
    'Vorbei. Mit {stand} endet ein turbulenter Nachmittag.',
    'Der Unparteiische beendet die Partie: {stand}.',
    'Abpfiff! {stand} – die Kurve singt trotzdem weiter.',
    'Ende der Partie, es bleibt beim {stand}.',
    'Schlusspfiff. {stand}, und die Punkte sind vergeben.',
    'Aus! Der Endstand lautet {stand}.',
    'Der letzte Pfiff im {stadion}: {stand}.'
  ],

  tor: [
    '{s} zieht aus der Drehung ab – und der Ball zappelt im Netz! {stand}',
    '{s} lässt zwei Verteidiger stehen und schiebt überlegt ein. {stand}!',
    'Der lange Ball, {s} nimmt ihn mit der Brust – und hämmert ihn unter die Latte! {stand}',
    '{v} steckt durch, {s} bleibt eiskalt: {stand}!',
    'Was für ein Hammer! {s} aus vollem Lauf – unhaltbar für {tw}. {stand}',
    '{s} taucht völlig frei auf und lässt {tw} keine Chance. {stand}',
    'Traumpass von {v}, Traumabschluss von {s} – {stand}!',
    'Der Ball tropft vor die Füße von {s}, und der drischt ihn rein. {stand}',
    '{s} zieht von der Strafraumkante ab, {tw} ist geschlagen! {stand}',
    'Kopfball {s} – wuchtig, präzise, drin! {stand}',
    'Da ist er, der Führungstreffer aus dem Nichts: {s} macht das {stand}.',
    'Flanke {v}, Kopf {s}, Tor – so einfach kann Fußball sein. {stand}',
    '{s} bleibt cool wie ein Kühlschrank und schiebt zum {stand} ein.',
    'Ein Gestocher im Strafraum, am Ende steht {s} richtig. {stand}',
    '{s} nagelt das Ding in den Winkel! Das war Weltklasse. {stand}',
    'Konter über {v}, Abschluss {s} – das saß. {stand}',
    'Der Abpraller fällt {s} vor die Füße, und der macht keinen Fehler. {stand}',
    'Elegant wie ein Tänzer: {s} umkurvt {tw} und schiebt ein. {stand}',
    '{s} zieht ab, abgefälscht, unhaltbar – {stand}!',
    'Und plötzlich ist er da: {s} taucht aus dem Nichts auf und trifft. {stand}',
    'Der Ball zappelt im Netz, {s} heißt der Torschütze. {stand}',
    '{v} legt quer, {s} muss nur noch einschieben. {stand}',
    'Direktabnahme {s} – volle Kanne ins kurze Eck! {stand}',
    'Was für ein Solo von {s}! Vier Mann ausgespielt und vollendet. {stand}',
    'Der Torwart wehrt ab, {s} staubt eiskalt ab. {stand}',
    'Rückpass geriet zu kurz, {s} bedankt sich artig. {stand}',
    '{s} überhebt {tw} mit einem Lupfer – ganz großes Kino! {stand}',
    'Ein Distanzschuss für die Chronik: {s} aus 25 Metern! {stand}',
    'Doppelpass mit {v}, und {s} vollendet trocken. {stand}',
    'Das Stadion bebt: {s} hat getroffen, es steht {stand}.',
    '{s} kommt einen Schritt vor dem Verteidiger und lenkt den Ball ins Tor. {stand}',
    'Der Ball springt unglücklich auf, {tw} kommt nicht hin – {s} sei Dank. {stand}',
    'Volley! {s} nimmt Maß und trifft ins lange Eck. {stand}',
    '{s} pflückt die Hereingabe von {v} herunter und vollstreckt. {stand}',
    'Eine Standardsituation wie aus dem Lehrbuch – {s} steigt am höchsten. {stand}',
    '{s} lässt {tw} keine Abwehrchance, das war zu platziert. {stand}',
    'Der Konter sitzt: {v} auf {s}, und der macht den Deckel drauf. {stand}',
    'Aus der Drehung, mit dem schwachen Fuß – {s} kann es einfach. {stand}',
    'Da war der Innenpfosten im Weg, aber nur für den Zuschauereffekt: drin! {s} trifft zum {stand}.',
    'Kaum auf dem Platz, schon trifft {s}. Ein Einwechsler nach Maß – {stand}!',
    'Vom Elfmeterpunkt gibt es keine Diskussion: {s} verwandelt zum {stand}.',
    '{s} zirkelt den Freistoß über die Mauer ins Eck. {stand}!'
  ],

  eigentor: [
    'Unglücklich! {s} fälscht die Hereingabe unhaltbar ab – Eigentor, {stand}.',
    'Das gibt es doch nicht: {s} bugsiert den Ball ins eigene Netz. {stand}',
    '{s} will klären und trifft ins eigene Tor. Bitter, {stand}.',
    'Ein Missverständnis zwischen {s} und {tw} – der Ball kullert über die Linie. {stand}',
    'Der Rettungsversuch von {s} landet im eigenen Kasten. {stand}',
    'Pech für {s}: sein Klärungsversuch schlägt oben ein. Eigentor zum {stand}.',
    '{s} grätscht in die Flanke – und der Ball zappelt im eigenen Netz. {stand}',
    'Was für ein Malheur! {s} trifft ins eigene Tor, {stand}.',
    'Der Ball springt {s} vom Knie ins eigene Gehäuse. {stand}',
    '{s} köpft den Ball an {tw} vorbei – ins eigene Tor. {stand}',
    'Eigentor! {s} wollte zurückspielen und hat es zu gut gemeint. {stand}',
    'Der Rückpass von {s} ist viel zu scharf, {tw} kommt nicht mehr hin. {stand}',
    'Tragisch: {s} lenkt den Schuss unhaltbar ins eigene Netz. {stand}',
    '{s} verlängert die Ecke ins eigene Tor. {stand}',
    'Ein Eigentor wie aus dem Bilderbuch – leider für {s}. {stand}',
    'Der Ball tropft von {s} über die Linie. Eigentor, {stand}.',
    '{s} steht im Weg und fälscht entscheidend ab. {stand}',
    'Die Kugel springt {s} an den Fuß und trudelt ins eigene Tor. {stand}',
    'Eigentor: {s} rutscht in die Flanke und trifft. Leider falsch herum. {stand}',
    'Das Pech klebt an {s} – der Ball prallt von ihm ins eigene Netz. {stand}',
    '{s} klärt gegen die eigene Latte, von dort ins Tor. {stand}',
    'Was für ein Missgeschick von {s}! Eigentor zum {stand}.',
    'Der Befreiungsschlag von {s} landet im eigenen Kasten. {stand}',
    '{s} und {tw} klären beide nicht – der Ball ist drin. {stand}',
    'Ein abgefälschter Ball von {s} findet den Weg ins eigene Netz. {stand}',
    'Eigentor! {s} kann sich nur an den Kopf fassen. {stand}',
    'Die Grätsche von {s} befördert den Ball ins eigene Tor. {stand}',
    '{s} wollte über die Linie klären und hat es zu spät versucht. {stand}',
    'Der Ball springt von der Hacke von {s} ins Gehäuse. {stand}',
    'Bitter für {s}: sein Kopfball landet im eigenen Netz. {stand}',
    'Ein klassisches Eigentor – {s} war der Unglücksrabe. {stand}',
    '{s} rutscht aus, der Ball trudelt ins eigene Tor. {stand}',
    'Der Klärungsversuch von {s} geht schrecklich schief. {stand}',
    'Eigentor: {s} lenkt die Hereingabe ins lange Eck. {stand}',
    '{tw} war schon unterwegs, {s} auch – der Ball ist drin. {stand}',
    'Da hat {s} den Ball unglücklich am Schienbein. Eigentor, {stand}.',
    'Das Unglück nimmt seinen Lauf: {s} trifft ins eigene Tor. {stand}',
    '{s} verlängert unfreiwillig ins eigene Netz. {stand}',
    'Der Schuss wäre vorbeigegangen – wenn {s} nicht dazwischen gewesen wäre. {stand}',
    'Eigentor von {s}. So etwas passiert nur den Fleißigen. {stand}'
  ],

  grosschance: [
    'Riesenchance für {t}! {s} steht völlig frei, setzt den Ball aber daneben.',
    '{s} allein vor {tw} – und der Ball geht am Pfosten vorbei! Das muss das Tor sein.',
    'Wie kann er den nicht machen? {s} schiebt aus fünf Metern vorbei.',
    'Die dickste Chance des Spiels: {s} scheitert an {tw}.',
    '{v} legt mustergültig auf, doch {s} zielt zu ungenau.',
    'Freistehend! {s} setzt die Kugel über die Latte, das Stadion stöhnt auf.',
    'Der Ball läuft durch den Fünfmeterraum, niemand von {t} kommt hin.',
    '{s} hat die Riesenmöglichkeit, aber {tw} macht sich ganz groß.',
    'Hundertprozentig! Und {s} vergibt kläglich.',
    'Aus fünf Metern über den Kasten – {s} greift sich an den Kopf.',
    '{s} umkurvt {tw}, doch der Winkel wird zu spitz.',
    'Das Leder springt {s} über den Fuß – Riesenchance dahin.',
    'Da war mehr drin! {s} verstolpert die beste Gelegenheit der Halbzeit.',
    '{s} kommt frei zum Kopfball, setzt ihn aber neben den Kasten.',
    'Alles klar zum Einschieben, aber {s} rutscht im entscheidenden Moment weg.',
    'Der Querpass von {v} findet {s} – der schießt {tw} aus zwei Metern an.',
    'Der Ball landet über Umwege bei {s}, der die Nerven verliert.',
    'Riesenmöglichkeit für {t}, doch {s} bringt den Ball nicht aufs Tor.',
    'Was für eine Gelegenheit! {s} zögert einen Wimpernschlag zu lang.',
    '{s} hat das leere Tor vor sich – und trifft das Außennetz.',
    'Ein Geschenk der Abwehr, aber {s} nimmt es nicht an.',
    'Doppelchance: erst {s}, dann der Nachschuss – nichts geht rein.',
    'Der Torwart ist geschlagen, aber der Ball kullert am Pfosten vorbei.',
    'Ein Traumpass von {v}, ein Albtraumabschluss von {s}.',
    'Alle Zeit der Welt für {s} – und er verzieht.',
    'Der Verteidiger rettet in höchster Not vor {s}. Das war knapp.',
    'Freie Bahn für {s}, doch {tw} ist blitzschnell draußen.',
    'Aus kürzester Distanz an die Hand von {tw} – Riesenglück für {g}.',
    'Blank stehend vergibt {s} die Chance zur Entscheidung.',
    'Die Kurve steht schon, doch {s} setzt den Ball ins Seitenaus.',
    'Ein Fehler im Aufbau von {g} – {s} bestraft ihn nicht.',
    '{s} legt sich den Ball zu weit vor, {tw} ist zur Stelle.',
    'Der Pfosten rettet für {g}, {s} kann es nicht fassen.',
    'Zu zentral, zu harmlos – {s} vergibt die Riesenchance.',
    'Der Kopfball von {s} tropft knapp am Tor vorbei.',
    '{s} bekommt den Ball mustergültig serviert und scheitert trotzdem.',
    'Vier gegen zwei, und am Ende steht kein Tor – {t} vergibt fahrlässig.',
    'Der Nachschuss von {s} wird auf der Linie geklärt!',
    'So eine Chance bekommt man nicht zweimal – {s} vergibt sie.',
    'Alles vorbereitet von {v}, doch {s} findet seinen Meister in {tw}.'
  ],

  chance: [
    '{s} versucht es aus der Distanz – knapp vorbei.',
    'Schuss {s}, aber {tw} ist auf dem Posten.',
    'Die Hereingabe von {v} findet keinen Abnehmer.',
    '{s} zieht ab, ein Verteidiger blockt im letzten Moment.',
    'Der Freistoß von {s} segelt über den Kasten.',
    '{t} kombiniert sich nach vorne, der Abschluss von {s} bleibt harmlos.',
    'Kopfball {s} – zu zentral, kein Problem für {tw}.',
    '{s} probiert es mit dem Außenrist, der Ball zischt vorbei.',
    'Ein Distanzschuss von {s}, {tw} lenkt ihn über die Latte.',
    '{s} nimmt Maß, aber die Mauer steht.',
    'Halbchance für {t}: {s} kommt einen Schritt zu spät.',
    'Der Schuss von {s} wird entscheidend abgefälscht.',
    '{s} flankt gefährlich, doch die Abwehr klärt.',
    'Ein Gewühl im Strafraum, am Ende landet der Ball bei {tw}.',
    '{s} zieht nach innen und schließt ab – drüber.',
    'Die Direktabnahme von {s} rauscht am Tor vorbei.',
    '{v} auf {s}, doch der Winkel ist zu spitz.',
    'Schuss aus zwanzig Metern, {tw} hat ihn sicher.',
    '{s} probiert den Lupfer – zu hoch angesetzt.',
    'Die Ecke von {s} findet nur den ersten Verteidiger.',
    '{t} drängt, aber {s} bringt den Ball nicht gefährlich aufs Tor.',
    'Der Volleyschuss von {s} geht deutlich daneben.',
    'Halbrechts im Strafraum kommt {s} zum Abschluss – geblockt.',
    'Der Kopfball von {s} landet in den Armen von {tw}.',
    '{s} dribbelt sich fest, die Chance verpufft.',
    'Ein Schüsschen von {s}, das war nichts.',
    'Die Flanke von {v} ist zu lang, {s} kommt nicht heran.',
    '{s} versucht es mit der Hacke – schön gedacht, nichts gewesen.',
    'Aus spitzem Winkel zielt {s} auf die kurze Ecke, {tw} passt auf.',
    'Der Rückpass von {v} kommt zu ungenau, {s} kann nicht abschließen.',
    '{t} spielt sich schön durch, doch der letzte Pass misslingt.',
    'Der Schlenzer von {s} verfehlt das lange Eck.',
    '{s} zieht aus zweiter Reihe ab, {tw} boxt weg.',
    'Ein Freistoß aus dem Halbfeld, {s} köpft daneben.',
    'Aus dem Rückraum probiert es {s} – am Tor vorbei.',
    'Die Kopfballverlängerung von {s} findet keinen Abnehmer.',
    'Schöner Angriff von {t}, harmloser Abschluss von {s}.',
    '{s} kommt zum Abschluss, aber {tw} steht goldrichtig.',
    'Der Schuss von {s} wird zur Ecke abgefälscht.',
    'Handgestoppt und zu lange gewartet – {s} verpasst den Moment.'
  ],

  parade: [
    'Was für eine Parade von {tw}! Er kratzt den Ball aus dem Winkel.',
    '{tw} taucht ab und hält den Schuss von {s}.',
    'Glanztat von {tw} – er lenkt den Ball mit den Fingerspitzen um den Pfosten.',
    '{tw} rettet gegen {s} in höchster Not.',
    'Reflex! {tw} pariert aus kurzer Distanz gegen {s}.',
    '{tw} macht sich groß und hält den Schuss von {s} mit dem Fuß.',
    'Da war {tw} zur Stelle – stark reagiert!',
    '{tw} fischt den Kopfball von {s} noch aus dem Eck.',
    'Der Torwart von {g} hält seine Mannschaft im Spiel: Parade gegen {s}!',
    '{tw} boxt die Hereingabe entschlossen weg.',
    'Klasse Reaktion von {tw} nach dem Schuss von {s}.',
    '{tw} wirft sich in den Schuss von {s} und hält.',
    'Ein Reflex wie in besten Zeiten: {tw} pariert.',
    '{tw} lenkt den Distanzschuss von {s} über die Latte.',
    'Der Keeper von {g} macht den Kasten dicht – {s} verzweifelt.',
    '{tw} ist mit dem Fuß noch dran, unglaublich!',
    'Katzengleich fliegt {tw} in die Ecke und hält.',
    '{tw} bleibt lange stehen und pariert den Schuss von {s}.',
    'Zweimal in Folge klärt {tw} – erst gegen {s}, dann den Nachschuss.',
    '{tw} klärt mit einer Faustabwehr gegen {s}.',
    'Riesenparade von {tw}, das war eigentlich schon drin.',
    '{tw} hält den Kopfball von {s} auf der Linie fest.',
    'Der Torwart pariert stark und lenkt zur Ecke.',
    '{tw} eilt aus dem Kasten und nimmt {s} den Ball vom Fuß.',
    'Ein Tor lag in der Luft, doch {tw} sagt Nein.',
    '{tw} pariert im Nachfassen – souverän.',
    'Die Abwehrreihe von {g} atmet auf: {tw} hat gehalten.',
    '{tw} taucht in die kurze Ecke und ist rechtzeitig unten.',
    'Stark, wie {tw} den abgefälschten Ball noch entschärft.',
    '{tw} hält den Schuss von {s} sicher fest.',
    'Der Keeper wehrt den Volley von {s} mit dem Oberschenkel ab.',
    '{tw} wirft sich in die Flugbahn und rettet.',
    'Das war ein Tor – wenn da nicht {tw} gewesen wäre.',
    '{tw} steht goldrichtig und pflückt die Flanke herunter.',
    'Was für eine Rettungstat von {tw} gegen {s}!',
    '{tw} lenkt den Freistoß von {s} an den Pfosten und ins Aus.',
    'Der Torwart von {g} zeigt seine Klasse gegen {s}.',
    '{tw} hält den Elfmeter! Riesenjubel im Block von {g}.',
    'Mit einer Hand hält {tw} den Schuss von {s} aus dem Eck.',
    '{tw} verkürzt den Winkel perfekt und blockt {s} ab.'
  ],

  latte: [
    'An die Latte! {s} hat Pech, der Ball springt zurück ins Feld.',
    'Aluminium! Der Schuss von {s} klatscht an die Querlatte.',
    '{s} trifft die Unterkante der Latte – und der Ball springt vor die Linie.',
    'Latte! Das Stadion hält den Atem an, {s} kann es nicht fassen.',
    'Der Kopfball von {s} donnert an die Querlatte.',
    'Die Latte rettet für {g} nach dem Hammer von {s}.',
    'Millimeter! {s} scheitert am Aluminium.',
    'Der Freistoß von {s} kracht an die Latte und springt ins Feld zurück.',
    'Was für ein Pech – {s} nagelt die Kugel an die Latte.',
    'Wieder Aluminium für {t}, {s} kann einem leidtun.',
    'Latte! Der Volley von {s} war eigentlich unhaltbar.',
    '{s} zieht ab, die Querlatte zittert noch Sekunden später.',
    'Das war die Chance: {s} trifft nur das Aluminium.',
    'Die Latte! {tw} war ohne Chance, das Glück blieb bei {g}.',
    '{s} hebt den Ball über {tw} – und an die Unterkante der Latte.',
    'Krachend an die Latte, der Nachschuss geht daneben.',
    'Aluminium für {t}! {s} verzweifelt fast.',
    'Der Distanzschuss von {s} knallt an die Querlatte.',
    'Die Latte steht im Weg, {s} greift sich ins Trikot.',
    'Was für ein Ding! {s} trifft aus zwanzig Metern die Latte.',
    'Der Ball tanzt auf der Querlatte und fällt vor die Linie zurück.',
    'Latte! {t} braucht heute wirklich eine Portion Glück.',
    'Der Kopfball von {s} klatscht gegen die Querlatte und ins Aus.',
    'Pech, {s}! Die Latte verhindert das Tor.',
    'Aluminiumtreffer: {s} scheitert am Gebälk.',
    'Die Querlatte rettet {tw} den Kopf.',
    '{s} nimmt Maß und trifft nur die Latte – das tut weh.',
    'An die Latte, an den Rücken von {tw}, und irgendwie nicht rein.',
    'Der Schlenzer von {s} findet die Querlatte statt das Netz.',
    'Aluminium! Die Kurve stöhnt auf, {s} lässt den Kopf hängen.',
    'Das Gebälk hält – {s} hätte den Jubel verdient gehabt.',
    'Latte! Der Ball springt zurück ins Spielfeld, {g} klärt.',
    'Die Querlatte verhindert die Führung von {t}.',
    '{s} donnert die Kugel an die Latte, das Stadion springt auf.',
    'Wieder Latte! Heute ist einfach nicht der Tag von {s}.',
    'Der Ball knallt an die Latte und von dort ins Toraus.',
    'So knapp: {s} trifft die Unterkante, der Ball prallt heraus.',
    'Aluminium für {t} – {tw} atmet hörbar durch.',
    'Der Freistoß küsst die Querlatte und fliegt darüber.',
    'Latte! Man kann {s} nur bedauern.'
  ],

  pfosten: [
    'Pfosten! {s} scheitert am Aluminium.',
    'Der Ball von {s} klatscht an den Innenpfosten und zurück ins Feld.',
    'Pfostenschuss! {s} greift sich verzweifelt an den Kopf.',
    'Nur der Pfosten verhindert das Tor von {s}.',
    'An den Außenpfosten – so eng war das bei {s}.',
    '{s} trifft nur den Pfosten, {tw} war geschlagen.',
    'Pech für {t}: der Schlenzer von {s} landet am Pfosten.',
    'Zentimeter fehlen! Der Kopfball von {s} streift den Pfosten.',
    'Der Pfosten ist der beste Freund von {tw} – Schuss {s}.',
    'Aluminium rettet {g}, {s} hätte den Jubel verdient gehabt.',
    'Pfosten! Der Ball rollt an der Linie entlang ins Aus.',
    '{s} zirkelt den Ball an den langen Pfosten – und zurück ins Feld.',
    'Der Innenpfosten rettet für {g}, das war ganz knapp.',
    'Pfostentreffer! {s} kann es nicht fassen.',
    'Die Kugel springt vom Pfosten zurück, {tw} greift zu.',
    'Am Pfosten vorbei ins Toraus – so nah war {s} am Treffer.',
    'Der Distanzschuss von {s} klatscht an den Pfosten.',
    'Pfosten! Und der Nachschuss wird geblockt.',
    '{s} umkurvt {tw} und trifft nur das Aluminium.',
    'Aluminium: Der Ball springt vom Pfosten an den Rücken von {tw} und ins Aus.',
    'Pfosten! Die Kurve springt auf und setzt sich wieder.',
    'So ein Pech für {s} – der Pfosten rettet {g}.',
    'Der Freistoß von {s} kracht an den Pfosten.',
    'Nur wenige Zentimeter: {s} trifft den Außenpfosten.',
    'Pfostenschuss von {s}, {tw} hätte nichts halten können.',
    'Der Ball prallt vom Pfosten ins Feld zurück, {g} klärt entschlossen.',
    '{s} legt sich den Ball zurecht und trifft den Pfosten.',
    'Aluminium! Der Kopfball von {s} landet am Pfosten.',
    'Der Pfosten verhindert den Ausgleich – bitter für {t}.',
    '{s} verzieht knapp, der Ball streift den Pfosten.',
    'Was für ein Pech: Pfosten und dann ins Toraus.',
    'Der Innenpfosten – aber der Ball will nicht ins Netz.',
    'Pfosten! Da war {tw} bereits im falschen Eck.',
    'Der Volley von {s} donnert an den Pfosten.',
    'Aluminium für {t}, heute läuft es nicht.',
    'Pfostentreffer und Abpraller ins Seitenaus.',
    'So knapp war {s} noch nie am Tor – nur der Pfosten.',
    'Der Ball klatscht an den Pfosten, {tw} klärt im Nachfassen.',
    'Pfosten! Und die Fahne des Assistenten geht ohnehin hoch.',
    'Der Schuss von {s} findet den Pfosten statt das Tor.'
  ],

  ecke: [
    'Ecke für {t} – {s} bringt sie in den Strafraum.',
    'Der nächste Eckball für {t}, hereingegeben von {s}.',
    'Ecke von rechts, {s} tritt sie kurz.',
    'Eckball {t}: {s} zirkelt ihn an den Fünfmeterraum.',
    'Ecke für {t}, die Abwehr von {g} klärt zur nächsten Ecke.',
    '{s} bringt die Ecke lang an den zweiten Pfosten.',
    'Ecke {t} – der Ball wird von der Abwehr geklärt.',
    'Eckball für {t}, {tw} pflückt ihn sicher herunter.',
    'Die Hereingabe von {s} findet keinen Abnehmer.',
    'Ecke von links, {s} sucht den Kopf des Zielspielers.',
    'Der Eckball von {s} segelt über alle hinweg ins Aus.',
    'Ecke für {t}, jetzt kommt auch {tw} mit nach vorn.',
    'Kurz ausgeführt – {s} und ein Mitspieler kombinieren an der Eckfahne.',
    'Der Eckball von {s} landet im Gewühl, niemand kommt zum Abschluss.',
    'Ecke für {t} – Gefahr liegt in der Luft.',
    'Der Standard von {s} wird per Kopf verlängert, aber nicht gefährlich.',
    'Wieder eine Ecke für {t}, der Druck wächst.',
    'Der Eckball wird geklärt, {s} muss von vorne beginnen.',
    'Die Ecke von {s} ist zu lang geraten.',
    'Ecke {t}, und {g} bekommt den Ball einfach nicht weg.',
    'Ein scharfer Eckball von {s} – abgewehrt.',
    'Der Eckstoß landet beim Gegner, Konterchance für {g}.',
    'Ecke {t}: {s} bringt sie mit viel Effet vor das Tor.',
    'Ecke, Kopfball, geklärt – Alltag im Strafraum von {g}.',
    'Das ist bereits die nächste Ecke für {t}.',
    'Die Hereingabe von {s} wird von {tw} abgefangen.',
    'Ecke für {t}, alle Mann in den Sechzehner.',
    'Der Eckball von {s} rauscht durch den ganzen Strafraum.',
    'Ecke {t}, doch die Abwehr steht kompakt.',
    'Der Standard bringt nichts ein, {g} klärt entschlossen.',
    'Ein weiterer Eckball – {t} setzt {g} unter Dauerdruck.',
    'Ecke, {s} tritt an, und der Kopfball geht knapp daneben.',
    'Die Ecke wird geklärt, {s} kommt zum Nachschuss.',
    'Ecke für {t}, der Ball fliegt in den Rückraum.',
    'Der Eckball von {s} wird von der ersten Welle geköpft.',
    'Ecke, Getümmel, Pfiff – der Schiedsrichter sieht ein Foul im Strafraum.',
    'Der Eckstoß von {s} wird direkt aufs Tor gezogen.',
    'Ecke {t}: Der Ball landet bei {s}, dessen Schuss geblockt wird.',
    'Nächster Standard für {t}, {s} legt sich den Ball zurecht.',
    'Die Ecke bringt Gefahr, aber kein Tor.'
  ],

  foul: [
    'Foul von {s} an {gefoult} – Freistoß für {g}.',
    '{s} kommt zu spät und trifft {gefoult} am Knöchel.',
    'Da war der Fuß zu hoch: Foul von {s}.',
    '{s} zieht die Notbremse gegen {gefoult}. Freistoß.',
    'Rustikal! {s} räumt {gefoult} ab.',
    '{gefoult} wird von {s} von den Beinen geholt.',
    'Ein Foul im Mittelfeld, {s} unterbricht den Spielfluss.',
    '{s} hält {gefoult} am Trikot fest – der Pfiff kommt sofort.',
    'Ein taktisches Foul von {s} gegen {gefoult}.',
    'Der Schiedsrichter pfeift ein Stürmerfoul gegen {s}.',
    '{s} steigt {gefoult} auf den Fuß.',
    'Zweikampf im Mittelkreis: {s} kommt zu spät.',
    'Ein hartes Einsteigen von {s} gegen {gefoult}.',
    '{s} grätscht {gefoult} von hinten um.',
    'Der Ellenbogen von {s} war da im Gesicht von {gefoult}.',
    'Freistoß für {g}, {s} hat gefoult.',
    '{s} legt {gefoult} regelwidrig, das war klar.',
    'Der Zweikampf zwischen {s} und {gefoult} endet mit einem Pfiff.',
    '{s} sieht den Ball nicht und trifft nur den Gegner.',
    'Ein unnötiges Foul von {s} in der eigenen Hälfte.',
    'Handspiel von {s} – Freistoß für {g}.',
    '{s} bremst den Konter mit einem Foul an {gefoult}.',
    'Der Schiedsrichter unterbricht: Foulspiel von {s}.',
    '{gefoult} bleibt liegen, {s} war zu ungestüm.',
    'Ein Schubser von {s} – der Unparteiische pfeift.',
    '{s} lässt sich zu einem dummen Foul hinreißen.',
    'Reingerauscht! {s} erwischt {gefoult} voll.',
    'Der Kampf um den zweiten Ball geht zu Ungunsten von {s} aus.',
    '{s} klammert und wird dafür bestraft.',
    'Ein Foul an der Mittellinie, {s} muss aufpassen.',
    '{s} bekommt {gefoult} nicht mehr, nur noch das Trikot.',
    'Der Verteidiger {s} agiert am Limit gegen {gefoult}.',
    'Kein Ball, nur Mann – {s} foult.',
    '{s} tritt {gefoult} auf die Hacken.',
    'Ein Foul, das man geben kann – {s} war zu spät.',
    'Der Zusammenprall zwischen {s} und {gefoult} wird abgepfiffen.',
    'Freistoß aus aussichtsreicher Position nach Foul von {s}.',
    '{s} zieht {gefoult} den Ball und die Beine weg.',
    'Der Schiedsrichter ahndet das Einsteigen von {s}.',
    'Nach dem Foul von {s} gibt es Diskussionen auf dem Platz.'
  ],

  gelb: [
    'Gelb für {s} – der Schiedsrichter hatte gewarnt.',
    'Verwarnung für {s} nach dem Foul an {gefoult}.',
    '{s} sieht die Gelbe Karte, das war zu hart.',
    'Der Unparteiische zückt Gelb: {s} hat es übertrieben.',
    'Gelbe Karte für {s} wegen wiederholten Foulspiels.',
    '{s} meckert und sieht dafür Gelb.',
    'Verwarnung für {s} – ab jetzt muss er aufpassen.',
    'Gelb! {s} hat {gefoult} regelwidrig gestoppt.',
    'Der Schiedsrichter verwarnt {s} für das taktische Foul.',
    'Gelbe Karte für {s}, völlig unnötig.',
    '{s} bremst den Konter und kassiert dafür Gelb.',
    'Verwarnung: {s} steigt zu ungestüm gegen {gefoult} ein.',
    'Gelb für {s} nach lautstarkem Protest.',
    'Der Schiedsrichter zeigt {s} die Gelbe Karte – zurecht.',
    '{s} sieht Gelb für ein Foul mit offener Sohle.',
    'Verwarnung für {s}, der Trainer greift sich an den Kopf.',
    'Gelb für {s} – Zeitspiel wird nicht geduldet.',
    '{s} handelt sich für die Notbremse eine Verwarnung ein.',
    'Der Unparteiische verwarnt {s} nach dem Trikotzupfen.',
    'Gelbe Karte für {s}, die fünfte in dieser Saison.',
    '{s} sieht Gelb, das war ein klares Foulspiel.',
    'Verwarnung für {s} nach dem Ellenbogeneinsatz.',
    'Gelb! {s} hat {gefoult} umgesenst.',
    'Der Schiedsrichter greift durch und verwarnt {s}.',
    'Gelbe Karte für {s} wegen Handspiels.',
    '{s} bekommt Gelb für die Blutgrätsche gegen {gefoult}.',
    'Verwarnung: {s} hat den Ball weggeschlagen.',
    'Gelb für {s}, er kann sich nicht beschweren.',
    'Der Unparteiische zeigt {s} Gelb nach dem Rempler an {gefoult}.',
    '{s} sieht die Gelbe Karte für unsportliches Verhalten.',
    'Gelb für {s} – der Schiedsrichter will ein Zeichen setzen.',
    '{s} verhindert die Ausführung des Freistoßes und wird verwarnt.',
    'Verwarnung für {s}, jetzt wird es gefährlich für ihn.',
    'Gelb für {s} nach dem Foul an {gefoult} an der Mittellinie.',
    'Der Kapitän diskutiert, aber {s} muss die Gelbe Karte hinnehmen.',
    '{s} sieht Gelb, weil er {gefoult} den Weg versperrt.',
    'Verwarnung für {s} nach einem Foul aus Frust.',
    'Gelbe Karte für {s} – das war das dritte Foul in Folge.',
    'Der Schiedsrichter verwarnt {s} nach einer Schwalbe.',
    'Gelb für {s}, der Zweikampf war deutlich zu spät.'
  ],

  gelbrot: [
    'Gelb-Rot für {s}! Das war das zweite Foul zu viel.',
    '{s} muss mit Gelb-Rot vom Platz – dumm gelaufen.',
    'Der Schiedsrichter zeigt {s} die zweite Gelbe Karte. Aus, vorbei.',
    'Gelb-Rot für {s}, {t} spielt ab jetzt in Unterzahl.',
    '{s} sieht die Ampelkarte, das war völlig unnötig.',
    'Zweite Verwarnung, Gelb-Rot: {s} verlässt den Platz.',
    'Der Unparteiische hat keine Wahl – Gelb-Rot für {s}.',
    'Gelb-Rot! {s} hat seine Mannschaft im Stich gelassen.',
    'Die zweite Gelbe für {s} – jetzt wird es eng für {t}.',
    '{s} steigt erneut zu spät ein und muss runter.',
    'Ampelkarte für {s}. Der Trainer tobt an der Seitenlinie.',
    'Gelb-Rot für {s} nach einem Foul aus purer Unachtsamkeit.',
    'Der Schiedsrichter greift in die Brusttasche: Gelb-Rot für {s}.',
    '{s} sieht Gelb-Rot und schlägt sich die Hände vors Gesicht.',
    'Zweite Verwarnung: {s} hat {gefoult} regelwidrig gestoppt.',
    'Gelb-Rot! Das war ein taktisches Foul zu viel von {s}.',
    '{s} verlässt mit Gelb-Rot den Rasen, {t} muss zu zehnt weitermachen.',
    'Die Ampelkarte für {s} war überfällig.',
    'Gelb-Rot: {s} redet zu viel und spielt zu hart.',
    'Der Unparteiische verweist {s} nach der zweiten Verwarnung des Feldes.',
    '{s} sieht Gelb-Rot – der Trainer wird umstellen müssen.',
    'Zweite Gelbe für {s}, {t} steht das letzte Drittel in Unterzahl bevor.',
    'Gelb-Rot! {s} hat den Konter gestoppt und dafür bezahlt.',
    'Die Ampelkarte gegen {s} ist so berechtigt wie schmerzhaft.',
    'Gelb-Rot für {s} – eine Aktion aus Frust.',
    '{s} muss vom Platz, die zweite Verwarnung war zwingend.',
    'Der Schiedsrichter zeigt {s} Gelb und dann sofort Rot.',
    'Gelb-Rot! {s} hat {gefoult} an der Mittellinie umgehauen.',
    'Zweite Verwarnung, Feierabend für {s}.',
    'Die Ampelkarte flattert – {s} geht mit hängendem Kopf.',
    'Gelb-Rot für {s}, jetzt wird es ein langer Nachmittag für {t}.',
    '{s} sieht die zweite Gelbe für Meckern. Völlig unnötig.',
    'Gelb-Rot: {s} hat den Ball weggeschlagen und muss dafür runter.',
    'Der Unparteiische bleibt konsequent – Gelb-Rot für {s}.',
    '{s} verlässt den Platz, {t} kämpft ab sofort in Unterzahl.',
    'Ampelkarte für {s} – das war ein Foul mit Ansage.',
    'Gelb-Rot! Der Trainer von {t} kann es kaum glauben.',
    'Zweite Verwarnung für {s}, die Bank protestiert lautstark.',
    'Gelb-Rot für {s}. Der Kapitän diskutiert, aber vergeblich.',
    'Die Ampelkarte für {s} verändert dieses Spiel.'
  ],

  rot: [
    'Rote Karte! {s} muss nach einem brutalen Einsteigen vom Platz.',
    'Glatt Rot für {s} – das war eine Tätlichkeit.',
    '{s} sieht die Rote Karte, die Notbremse war eindeutig.',
    'Der Schiedsrichter zeigt {s} Rot. {t} muss zu zehnt weiterspielen.',
    'Rot für {s}! Die Grätsche war lebensgefährlich.',
    '{s} fliegt vom Platz, das war weit über der Grenze.',
    'Rote Karte gegen {s} nach dem Handspiel auf der Linie.',
    'Der Platzverweis für {s} ist völlig berechtigt.',
    'Rot! {s} trifft {gefoult} mit gestrecktem Bein.',
    'Der Unparteiische greift durch: Rote Karte für {s}.',
    'Glatt Rot – {s} hat den Gegenspieler mit dem Ellenbogen erwischt.',
    'Rote Karte für {s}, das Stadion pfeift gellend.',
    '{s} muss runter, die Notbremse gegen {gefoult} war klar.',
    'Rot! Ein Foul, das man in keinem Regelwerk findet.',
    'Der Schiedsrichter zeigt sofort Rot – {s} hat nachgetreten.',
    'Platzverweis für {s}. Der Trainer von {t} rauft sich die Haare.',
    'Rote Karte! {s} hat die Beherrschung verloren.',
    '{s} sieht Rot nach einem Foul im Affekt.',
    'Rot für {s} – da gibt es überhaupt nichts zu diskutieren.',
    'Der Unparteiische stellt {s} vom Platz. {t} spielt zu zehnt weiter.',
    'Glatt Rot: {s} hat die letzte Chance verhindert.',
    'Rote Karte für {s}, die Partie kippt.',
    '{s} muss vorzeitig unter die Dusche – das war rohes Spiel.',
    'Rot! {s} steigt {gefoult} mit offener Sohle auf den Knöchel.',
    'Der Platzverweis für {s} ist die logische Konsequenz.',
    'Rote Karte, {s} verlässt wortlos den Rasen.',
    'Rot für {s} nach einem Vergehen ohne jeden Ballkontakt.',
    'Der Schiedsrichter hat keine Wahl: {s} sieht Rot.',
    'Platzverweis! {s} hat {gefoult} böse erwischt.',
    'Rote Karte für {s} – ein Nackenschlag für {t}.',
    'Rot! Der Videobeweis wäre hier reine Formsache.',
    '{s} fliegt vom Platz, {t} muss die letzten Minuten in Unterzahl überstehen.',
    'Glatt Rot für {s} wegen Torraubs.',
    'Rote Karte, und die Bank von {t} tobt.',
    'Der Unparteiische zeigt {s} Rot – das war eine klare Sache.',
    'Rot für {s}. Der Kapitän begleitet ihn zur Kabine.',
    'Platzverweis für {s} nach einer unnötigen Aktion.',
    'Rote Karte! {s} hat den Bogen deutlich überspannt.',
    'Rot für {s} – die Fans von {g} applaudieren.',
    '{s} sieht die Rote Karte, das Spiel ist gelaufen.'
  ],

  abseits: [
    'Abseits! {s} war einen Schritt zu früh gestartet.',
    'Die Fahne geht hoch – {s} stand im Abseits.',
    'Abseitsposition von {s}, der Treffer zählt nicht.',
    'Knappe Entscheidung: {s} wird zurückgepfiffen.',
    'Die Abseitsfalle von {g} klappt, {s} tappt hinein.',
    'Abseits gegen {s}, der Assistent hat gut aufgepasst.',
    '{s} löst sich zu früh, die Fahne oben.',
    'Millimeterabseits gegen {s} – Pech für {t}.',
    'Der Steilpass kommt zu spät, {s} steht im Abseits.',
    'Abseits! Die Kette von {g} rückt perfekt heraus.',
    '{s} war schneller als der Pass – Abseits.',
    'Der Assistent hebt die Fahne, {s} stand vorne drin.',
    'Abseitsstellung von {s}, das Stadion pfeift.',
    'Wieder Abseits gegen {t} – {s} kann es nicht fassen.',
    'Der Treffer zählt nicht, {s} stand im Abseits.',
    '{s} startet zu ungeduldig, Abseits.',
    'Die Viererkette von {g} steht wie eine Eins – Abseits gegen {s}.',
    'Abseits, und der Trainer von {t} tobt an der Linie.',
    'Der Pass in die Schnittstelle kommt zu spät, {s} ist im Abseits.',
    'Knapp, aber korrekt: Abseits gegen {s}.',
    'Die Fahne des Assistenten beendet den Angriff von {t}.',
    'Abseits! {s} diskutiert, aber die Entscheidung steht.',
    'Zu früh gestartet – {s} wird zurückgepfiffen.',
    'Die Abseitsfalle sitzt, {s} ist bedient.',
    'Abseits gegen {s}. Um Haaresbreite, aber es zählt nicht.',
    'Der Linienrichter hebt die Fahne, das Tor zählt nicht.',
    '{s} stand mit der Schulter im Abseits.',
    'Abseits! Die Kette von {g} hat perfekt getimt.',
    'Der Steckpass war eine Idee zu spät – Abseits gegen {s}.',
    'Wieder abseits: {t} läuft heute permanent ins offene Messer.',
    'Der Assistent bleibt hart, {s} stand im Abseits.',
    'Abseitsposition! Und dabei war es ein herrlicher Spielzug.',
    '{s} kann sich nur wundern, die Fahne ist oben.',
    'Abseits – das war eine Millimeterentscheidung.',
    'Die Abwehrreihe von {g} hebt geschlossen die Arme, Abseits.',
    '{s} war zu gierig und stand im Abseits.',
    'Abseits gegen {t}. Die Ordnung von {g} steht.',
    'Der Ball landet im Netz, aber die Fahne war schon oben.',
    'Abseits! {s} muss besser auf die Kette achten.',
    'Der Assistent entscheidet auf Abseits – der Jubel erstirbt.'
  ],

  elfmeter: [
    'Elfmeter für {t}! {gefoult} wurde von {s} zu Fall gebracht.',
    'Der Schiedsrichter zeigt auf den Punkt – Handspiel im Strafraum von {g}.',
    'Strafstoß für {t}! Das war ein klares Foul an {gefoult}.',
    'Elfmeter! Im Strafraum von {g} geht {gefoult} zu Boden.',
    'Der Unparteiische entscheidet auf Strafstoß für {t}.',
    'Elfmeter für {t} – die Bank von {g} tobt.',
    'Klarer Fall: Foul von {s} im eigenen Sechzehner, Elfmeter.',
    'Der Schiedsrichter zeigt sofort auf den Punkt. Elfmeter für {t}!',
    'Strafstoß! {s} hat {gefoult} das Bein gestellt.',
    'Elfmeter für {t}. Der Pfiff kam wie aus der Pistole geschossen.',
    'Der Unparteiische läuft zum Punkt – Strafstoß für {t}.',
    'Elfmeter! {s} kam einen Schritt zu spät gegen {gefoult}.',
    'Strafstoß für {t}, die Fans von {g} pfeifen gellend.',
    'Der Schiedsrichter hat ein Handspiel von {s} gesehen. Elfmeter.',
    'Elfmeter! {gefoult} wurde im Fallen noch am Trikot gehalten.',
    'Strafstoß für {t}. Diese Entscheidung wird nachher diskutiert.',
    'Der Pfiff, die Geste zum Punkt – Elfmeter für {t}.',
    'Elfmeter! {s} hat {gefoult} im Sechzehner abgeräumt.',
    'Strafstoß: Da war der Fuß von {s} eindeutig zu hoch.',
    'Der Unparteiische zeigt auf den Punkt, {t} bekommt einen Elfmeter.',
    'Elfmeter für {t} – der Kapitän von {g} diskutiert vergeblich.',
    'Strafstoß! {gefoult} wurde von {s} regelwidrig gestoppt.',
    'Der Schiedsrichter entscheidet auf Elfmeter, das Stadion kocht.',
    'Elfmeter! Eine harte, aber vertretbare Entscheidung.',
    'Strafstoß für {t} nach einem Zweikampf im Strafraum.',
    'Der Unparteiische pfeift und zeigt auf den Punkt: Elfmeter.',
    'Elfmeter! {s} hat den Ball mit dem Arm gespielt.',
    'Strafstoß für {t}, jetzt ist Nervenstärke gefragt.',
    'Der Schiedsrichter lässt nicht mit sich reden: Elfmeter.',
    'Elfmeter! {gefoult} war schneller als {s}, das war es dann.',
    'Strafstoß für {t}. Die Kurve erhebt sich von den Sitzen.',
    'Der Pfiff kommt sofort – Elfmeter für {t}.',
    'Elfmeter! {s} grätscht {gefoult} im Sechzehner um.',
    'Strafstoß, und {tw} macht sich schon einmal groß.',
    'Der Unparteiische zeigt zum Punkt. {t} hat die Riesenchance.',
    'Elfmeter für {t}! Der Trainer von {g} wirft die Wasserflasche.',
    'Strafstoß nach einem klaren Foul von {s}.',
    'Elfmeter! Diese Szene entscheidet vielleicht das Spiel.',
    'Der Schiedsrichter bleibt bei seiner Entscheidung: Strafstoß für {t}.',
    'Elfmeter für {t} – die Nerven liegen blank.'
  ],

  elfmeterVerschossen: [
    '{s} scheitert vom Punkt an {tw}! Riesenjubel bei {g}.',
    'Verschossen! {s} setzt den Elfmeter über das Tor.',
    '{tw} hält den Elfmeter von {s} – was für ein Moment!',
    '{s} jagt den Strafstoß an den Pfosten.',
    'Der Elfmeter von {s} ist zu unplatziert, {tw} pariert.',
    'Vergeben! {s} scheitert vom Elfmeterpunkt.',
    '{tw} ahnt die Ecke und hält gegen {s}.',
    'Der Strafstoß von {s} landet an der Latte – unfassbar.',
    '{s} rutscht beim Anlauf weg, der Ball segelt ins Nirwana.',
    'Gehalten! {tw} pariert den Elfmeter und wird zum Helden von {g}.',
    '{s} schießt zu zentral, {tw} bleibt stehen und hält.',
    'Der Elfmeter von {s} geht weit über den Kasten.',
    'Verschossen! Das Stadion von {g} bebt vor Erleichterung.',
    '{tw} fliegt in die richtige Ecke und entschärft den Strafstoß.',
    '{s} zielt auf das kurze Eck – und trifft nur das Außennetz.',
    'Der Strafstoß ist zu lasch, {tw} hat keine Mühe.',
    'Vergeben! {s} kann es selbst nicht glauben.',
    '{tw} pariert und lenkt den Ball zur Ecke.',
    'Der Elfmeter von {s} klatscht an den Innenpfosten und heraus.',
    '{s} nimmt zu viel Anlauf und drischt die Kugel darüber.',
    'Gehalten von {tw}! Die Bank von {g} springt auf.',
    'Der Strafstoß von {s} ist eine Beute für {tw}.',
    '{s} versucht den Panenka – und scheitert kläglich.',
    'Verschossen! Der Ball segelt über die Latte in den Fanblock.',
    '{tw} hält, der Nachschuss von {s} wird geblockt.',
    'Der Elfmeter von {s} war zu schwach und zu mittig.',
    'Vergeben! {s} hält sich die Hände vors Gesicht.',
    '{tw} bleibt eiskalt und pariert gegen {s}.',
    'Der Strafstoß landet am Außenpfosten – {t} bleibt ohne Ertrag.',
    '{s} scheitert vom Punkt, {g} hat riesiges Glück.',
    'Der Elfmeter geht daneben – das könnte sich noch rächen.',
    '{tw} wehrt ab, der Abpraller wird geklärt.',
    'Verschossen! Diese Szene wird {s} lange verfolgen.',
    'Der Strafstoß von {s} war viel zu unentschlossen.',
    '{tw} zeigt Nerven aus Stahl und hält den Elfmeter.',
    'Vergeben! {s} setzt den Ball links neben den Pfosten.',
    'Der Elfmeter wird gehalten, das Stadion rastet aus.',
    '{s} donnert das Leder an die Unterkante der Latte und heraus.',
    'Gehalten! {tw} hat seine Hausaufgaben gemacht.',
    'Der Strafstoß von {s} findet nicht den Weg ins Netz.'
  ],

  freistoss: [
    'Freistoß aus aussichtsreicher Position – {s} legt sich den Ball zurecht.',
    'Gefährlicher Freistoß für {t}, {s} nimmt Maß.',
    '{s} tritt den Freistoß, doch die Mauer blockt.',
    'Der Freistoß von {s} segelt knapp über den Kasten.',
    'Freistoß {t} aus 22 Metern – {s} zielt auf das kurze Eck.',
    'Die Mauer steht, {s} versucht es trotzdem direkt.',
    'Freistoß für {t} in Strafraumnähe, jetzt wird es gefährlich.',
    '{s} zirkelt den Freistoß in den Strafraum, {tw} faustet weg.',
    'Ein Freistoß wie gemalt von {s} – nur der Pfosten ist im Weg.',
    'Der Freistoß von {s} wird von der Mauer abgefälscht.',
    'Freistoß aus dem Halbfeld, {s} bringt ihn scharf herein.',
    '{s} legt sich den Ball hin – und schießt die Mauer an.',
    'Freistoß für {t}, {s} und ein Mitspieler beraten sich.',
    'Der Schiedsrichter misst die Mauer aus, {s} wartet geduldig.',
    'Freistoß aus 25 Metern – {s} hat schon von weiter draußen getroffen.',
    '{s} versucht es flach unter der Mauer durch.',
    'Freistoß für {t}. {tw} dirigiert seine Mauer nervös.',
    'Der Ball liegt, {s} nimmt Anlauf – und zielt in die Mitte.',
    'Freistoß {t}: {s} chippt ihn an den langen Pfosten.',
    '{s} tritt an, der Ball fliegt haarscharf über die Latte.',
    'Ein Freistoß aus dem Rückraum, {s} sucht den Kopf des Zielspielers.',
    'Freistoß für {t}, die Abwehr von {g} formiert sich.',
    '{s} legt sich die Kugel zurecht – das ist seine Spezialität.',
    'Der Freistoß wird kurz ausgeführt, {t} kombiniert weiter.',
    'Freistoß aus halblinker Position, {s} steht bereit.',
    '{s} zieht den Freistoß über die Mauer – {tw} ist zur Stelle.',
    'Freistoß für {t}. Das Stadion hält den Atem an.',
    'Der Standard von {s} landet im Gewühl vor dem Tor.',
    'Freistoß aus 19 Metern – höchste Gefahr für {g}.',
    '{s} nimmt Maß, doch die Mauer springt gut.',
    'Freistoß für {t}, {tw} rückt seine Mauer noch einmal zurecht.',
    'Der Freistoß von {s} wird zur Ecke abgewehrt.',
    'Freistoß {t}: {s} legt quer, der Schuss wird geblockt.',
    'Der Ball ist im Spiel, {s} zirkelt ihn Richtung langes Eck.',
    'Freistoß aus zentraler Position – hier ist alles möglich.',
    '{s} probiert es direkt, der Ball rauscht knapp vorbei.',
    'Freistoß für {t}, die Kurve fordert lautstark ein Tor.',
    'Der Schiedsrichter pfeift den Freistoß frei, {s} tritt an.',
    'Freistoß aus 27 Metern, {s} nimmt trotzdem Maß.',
    'Der Standard von {s} findet den Kopf eines Mitspielers.'
  ],

  wechsel: [
    'Wechsel bei {t}: {s} kommt für {gefoult}.',
    'Die Bank von {t} reagiert – {gefoult} runter, {s} rauf.',
    'Frisches Personal für {t}: {s} ersetzt {gefoult}.',
    '{gefoult} verlässt unter Applaus den Platz, {s} kommt.',
    'Einwechslung bei {t}: {s} soll neuen Schwung bringen.',
    'Der Trainer von {t} bringt {s} für {gefoult}.',
    'Wechsel: {s} betritt für {gefoult} das Feld.',
    'Taktischer Wechsel bei {t} – {s} kommt für {gefoult}.',
    '{gefoult} hat sichtlich leere Beine, {s} übernimmt.',
    'Frische Kräfte für {t}: {s} ersetzt {gefoult}.',
    'Die vierte Karte zeigt die Nummer von {gefoult} – {s} kommt.',
    'Wechsel bei {t}. {s} zieht sich noch schnell das Trikot zurecht.',
    '{s} löst {gefoult} ab, der Trainer klatscht ihn ab.',
    'Personelle Veränderung bei {t}: {s} für {gefoult}.',
    'Der Trainer greift ein – {s} soll das Spiel drehen.',
    '{gefoult} geht vom Platz, {s} bringt frischen Wind.',
    'Wechsel! {s} kommt, {gefoult} geht mit hängendem Kopf.',
    'Bei {t} wird gewechselt: {s} für {gefoult}.',
    '{s} betritt den Rasen, {gefoult} setzt sich auf die Bank.',
    'Einwechslung: {s} soll für Betrieb auf der Außenbahn sorgen.',
    'Die Bank von {t} wird aktiv – {s} kommt für {gefoult}.',
    'Wechsel bei {t}, {gefoult} hat sein Pensum abgeleistet.',
    '{s} kommt ins Spiel und wird sofort lautstark begrüßt.',
    'Frisches Blut für {t}: {s} ersetzt den müden {gefoult}.',
    'Der Trainer von {t} zieht die letzte Karte: {s} kommt.',
    'Wechsel! Für {gefoult} übernimmt {s}.',
    '{gefoult} verlässt den Platz, die Kurve bedankt sich.',
    'Einwechslung bei {t}: {s} soll die Offensive beleben.',
    '{s} kommt für {gefoult} – ein Wechsel mit klarer Ansage.',
    'Die Bank reagiert: {s} für {gefoult} bei {t}.',
    'Personalwechsel bei {t}, {s} betritt das Feld.',
    '{gefoult} geht, {s} kommt – der Trainer will mehr Wucht.',
    'Wechsel bei {t}: {s} soll die Räume auf außen nutzen.',
    '{s} kommt, {gefoult} nimmt den Applaus mit in die Kabine.',
    'Einwechslung: {s} ersetzt {gefoult}, das Spiel wird schneller.',
    'Der Trainer von {t} wechselt – {s} für {gefoult}.',
    'Frisch aus der Kabine: {s} betritt für {gefoult} den Rasen.',
    'Wechsel bei {t}, {gefoult} war am Ende seiner Kräfte.',
    '{s} kommt ins Spiel und soll die Partie noch drehen.',
    'Die Bank von {t} schickt {s} auf den Platz, {gefoult} ist Feierabend.'
  ],

  verletzung: [
    '{s} bleibt liegen und muss behandelt werden.',
    'Böse Szene: {s} greift sich an den Oberschenkel.',
    '{s} humpelt vom Platz – das sieht nicht gut aus.',
    'Verletzungspause: {s} kann nicht weitermachen.',
    'Die Betreuer eilen zu {s}, hier geht nichts mehr.',
    '{s} verdreht sich das Knie und bleibt liegen.',
    'Nach einem Zweikampf muss {s} behandelt werden.',
    '{s} signalisiert zur Bank – er kann nicht mehr.',
    'Muskuläre Probleme bei {s}, er muss runter.',
    'Das war es für {s}, er verlässt gestützt den Platz.',
    '{s} bleibt nach einem Sprint abrupt stehen und greift sich hinten.',
    'Die Physiotherapeuten sind auf dem Feld – {s} ist angeschlagen.',
    '{s} liegt am Boden, das Stadion wird still.',
    'Es sieht nach einer Zerrung aus: {s} kann nicht weiterspielen.',
    'Der Zusammenprall war heftig – {s} braucht Betreuung.',
    '{s} wird auf der Trage vom Feld gebracht.',
    'Böses Foulspiel, {s} muss lange behandelt werden.',
    '{s} greift sich an die Wade und winkt sofort ab.',
    'Verletzungsbedingter Ausfall: {s} kann nicht weitermachen.',
    'Der Arzt schüttelt den Kopf – für {s} ist Schluss.',
    '{s} hat sich bei der Landung unglücklich abgestützt.',
    'Die Behandlung von {s} zieht sich – das kostet Nachspielzeit.',
    '{s} versucht es noch, doch nach zwei Schritten gibt er auf.',
    'Ein Tritt auf den Knöchel, und {s} muss vom Platz.',
    '{s} liegt regungslos, die Betreuer eilen herbei.',
    'Für {s} geht es nicht weiter – bitter für {t}.',
    'Der Muskel macht nicht mehr mit, {s} ist bedient.',
    '{s} hält sich die Schulter, das sieht nach einer längeren Pause aus.',
    'Nach dem Luftduell bleibt {s} benommen liegen.',
    'Die Trage kommt – {s} muss vom Feld getragen werden.',
    '{s} hat sich ohne Gegnereinwirkung verletzt, das ist meist schlecht.',
    'Der Betreuerstab von {t} ist im Dauereinsatz, {s} ist angeschlagen.',
    '{s} humpelt an die Seitenlinie und schüttelt den Kopf.',
    'Ein Schlag auf den Oberschenkel, {s} kann nicht weiter.',
    '{s} bleibt nach einem harmlosen Zweikampf liegen.',
    'Das Bein von {s} ist dick, hier ist Schluss.',
    'Der Trainer von {t} muss reagieren – {s} ist verletzt.',
    '{s} sitzt am Boden und schlägt frustriert auf den Rasen.',
    'Die Verletzung von {s} überschattet diese Szene.',
    'Für {s} ist der Arbeitstag vorzeitig beendet.'
  ],

  kombination: [
    'Sehenswert! {t} kombiniert sich durch die Reihen von {g}.',
    'Ein Doppelpass zwischen {v} und {s} bringt {g} in Bedrängnis.',
    '{t} lässt den Ball laufen – zehn Stationen, dann der Abschluss.',
    'Feinster Kombinationsfußball von {t}, {s} vollendet die Aktion.',
    '{v} auf {s}, Hacke, Spitze – da schwindelt es der Abwehr von {g}.',
    'Ein Spielzug wie aus dem Lehrbuch von {t}.',
    '{t} spielt sich mit drei Kontakten in den Strafraum.',
    'Die Kombination über {v} und {s} reißt die Kette von {g} auseinander.',
    'Herrlich herausgespielt von {t} – nur der Abschluss fehlt.',
    'Klasse Ballstafette von {t}, am Ende steht {s}.',
    'Ein Traumzug: {v} lässt klatschen, {s} zieht durch.',
    '{t} kombiniert sich auf engstem Raum durch die Abwehr von {g}.',
    'Der Ball läuft, die Gegenspieler laufen hinterher – Chapeau, {t}.',
    'Eine Kombination über sechs Stationen, {s} beendet sie.',
    '{v} spielt den Doppelpass mit {s} – die Abwehr von {g} sieht alt aus.',
    'So spielt man Fußball: {t} zieht {g} auseinander.',
    'Ein Hackentrick von {v}, {s} nimmt dankend an.',
    'Der Spielzug von {t} hat Lehrbuchqualität.',
    '{t} lässt den Ball zirkulieren, bis sich die Lücke auftut.',
    'Doppelpass, Übersteiger, Steilpass – {t} ist in Spiellaune.',
    'Ein Angriff wie aus einem Guss von {t}.',
    '{v} und {s} legen sich den Ball dreimal zu – herrlich.',
    'Die Kurve applaudiert: {t} kombiniert sich zur Grundlinie.',
    'Ein wunderbarer Spielzug über die halbrechte Seite.',
    '{t} spielt sich schwindelig – im positiven Sinne.',
    'Der Ball läuft schneller als jeder Gegenspieler. Stark von {t}.',
    'Mit drei Kontakten von der Mittellinie in den Sechzehner – Wahnsinn.',
    '{v} steckt durch, {s} legt zurück – das war eine Augenweide.',
    'Die Abwehr von {g} dreht sich im Kreis, {t} kombiniert weiter.',
    'Ein Zusammenspiel für die Zeitlupe: {v} auf {s}.',
    '{t} zeigt hier Kombinationsfußball vom Feinsten.',
    'Der Doppelpass sitzt, {s} taucht plötzlich frei auf.',
    'Ein Spielzug über die gesamte Breite, am Ende scheitert {s}.',
    '{t} lässt den Ball durch die Reihen wandern – schön anzusehen.',
    'Kurze Pässe, schnelle Beine – {g} kommt nicht hinterher.',
    'Der Angriff von {t} war mustergültig herausgespielt.',
    '{v} legt sich den Ball vor, {s} vollendet die Kombination.',
    'Fünf Spieler beteiligt, ein Abschluss – so macht Fußball Freude.',
    'Ein Traumpass von {v} krönt die Kombination von {t}.',
    'Kombinationsfußball at its best – Verzeihung, im besten Sinne.'
  ],

  konter: [
    'Konter! {t} schaltet blitzschnell um, {s} treibt den Ball.',
    'Ballgewinn und sofort nach vorne – {t} kontert über {s}.',
    'Vier gegen zwei! {t} läuft den Gegenangriff mustergültig.',
    '{s} startet den Konter, {g} kommt nicht hinterher.',
    'Umschaltmoment für {t}: {v} auf {s}, das wird gefährlich.',
    'Blitzkonter von {t} über die rechte Seite.',
    '{t} lauert und schlägt zu – {s} zieht davon.',
    'Der Ballverlust wird bestraft: {t} kontert über {s}.',
    'Tempogegenstoß von {t}, {s} ist nicht zu halten.',
    'Aus der eigenen Hälfte heraus – {t} kontert mit vier Mann.',
    'Ein Konter wie aus dem Nichts: {s} rennt allen davon.',
    '{t} gewinnt den Ball und spielt sofort den Vertikalpass.',
    'Umschalten in Sekundenbruchteilen – {s} führt den Konter an.',
    'Drei Pässe von hinten nach vorn, {t} kontert eiskalt.',
    'Der Konter läuft: {v} passt auf {s}, der zieht davon.',
    '{t} nutzt die aufgerückte Kette von {g} eiskalt aus.',
    'Gegenstoß! {s} nimmt Tempo auf und lässt zwei stehen.',
    'Der lange Ball auf {s} – der Konter sitzt.',
    '{t} kontert über die linke Seite, {g} ist völlig offen.',
    'Ballgewinn im Mittelfeld, und schon läuft {s} allein aufs Tor zu.',
    'Blitzsauber umgeschaltet – {t} nutzt jeden Meter Raum.',
    'Der Konter von {t} kommt mit Wucht, {s} bleibt cool.',
    '{s} sprintet über sechzig Meter – das ist der Konter des Tages.',
    'Umschaltmoment! {t} hat auf genau diese Szene gewartet.',
    'Der Gegenangriff läuft, {g} kommt nur noch hinterher.',
    'Konter über {v} und {s} – hier ist Gefahr im Verzug.',
    '{t} schaltet blitzschnell um und überrennt die Restverteidigung.',
    'Ein klassischer Konter: Ball erobert, drei Pässe, Abschluss.',
    '{s} führt den Konter an, hinter ihm kommen zwei Mitspieler mit.',
    'Der Ballgewinn wird sofort in Tempo umgemünzt.',
    'Konter! Die Kurve von {t} ist auf den Beinen.',
    '{v} schickt {s} auf die Reise – {g} ist chancenlos.',
    'Tempogegenstoß, und {g} hat nur noch zwei Mann hinten.',
    'Der Umschaltmoment gehört {t}, {s} zieht das Tempo an.',
    'Ein Konter über die gesamte Länge des Feldes.',
    '{t} kontert, {g} muss ein taktisches Foul in Kauf nehmen.',
    'Blitzschnell umgeschaltet – {s} hat freie Bahn.',
    'Der Konter von {t} rollt, das Stadion steht.',
    '{s} treibt den Ball, drei Mitspieler laufen mit – Riesenchance.',
    'Umschaltspiel in Reinkultur: {t} greift mit voller Wucht an.'
  ],

  ballverlust: [
    '{s} verliert den Ball leichtfertig im Mittelfeld.',
    'Fehlpass von {s}, {g} übernimmt.',
    '{s} wird von der Abwehr von {g} abgekocht.',
    'Der Angriff von {t} verpufft, {s} spielt zu ungenau.',
    '{g} erobert den Ball im Zentrum.',
    '{s} lässt sich den Ball abnehmen.',
    'Der Steilpass von {s} kommt nicht an.',
    'Abgefangen! {g} kontert nach dem Fehler von {s}.',
    '{s} verstolpert den Ball an der Strafraumgrenze.',
    'Der Angriff von {t} versandet an der Abwehrreihe von {g}.',
    '{s} sucht den Mitspieler, findet aber den Gegner.',
    'Zu ungenau von {s}, {g} hat den Ball.',
    'Die Flanke von {s} landet im Toraus.',
    'Ein Einwurf für {g}, {s} verstolpert an der Linie.',
    '{s} spielt in die Füße des Gegners.',
    'Der Vorstoß von {t} endet mit einem Ballverlust von {s}.',
    'Abgelaufen! {g} nimmt {s} den Ball ab.',
    '{s} bekommt den Ball nicht unter Kontrolle.',
    'Die Kette von {g} steht kompakt, {t} kommt nicht durch.',
    'Der Pass von {s} ist zu kurz – abgefangen.',
    '{s} verzettelt sich im Dribbling.',
    'Der Querpass von {s} findet keinen Abnehmer.',
    'Ballverlust! {s} hat den Gegenspieler übersehen.',
    '{s} spielt einen Fehlpass ins Niemandsland.',
    'Der Angriff von {t} endet in einer Sackgasse.',
    '{s} wird abgedrängt und verliert den Ball an der Seitenlinie.',
    'Ungenau: Der Pass von {s} rollt ins Seitenaus.',
    '{g} presst hoch und erobert die Kugel von {s}.',
    '{s} verliert das Kopfballduell, {g} schaltet um.',
    'Der Doppelpass misslingt, {t} verliert die Kugel.',
    '{s} hat den Ball zu lange, jetzt ist er weg.',
    'Fehlpass in die Spitze, {g} klärt problemlos.',
    '{s} will zu viel und verliert den Ball im Zentrum.',
    'Ein schwacher Rückpass von {s}, {g} kommt in Ballbesitz.',
    'Die Hereingabe von {s} ist zu ungenau.',
    '{s} rutscht weg – Ballverlust in gefährlicher Zone.',
    'Der Vertikalpass von {s} wird abgefangen.',
    '{t} spielt den Ball ins Aus, Einwurf für {g}.',
    '{s} verliert im Zweikampf und schaut dem Ball hinterher.',
    'Der Spielzug von {t} bricht ab, {s} findet keinen Anspielpartner.'
  ],

  keyMomentGut: [
    'Der Trainer an der Linie hat es vorgemacht – {s} setzt es perfekt um!',
    'Das war eiskalt vorbereitet, {s} lässt sich nicht beirren.',
    '{s} führt den Auftrag mit Bravour aus.',
    'Genau so hatte man sich das gedacht: {s} macht es mustergültig.',
    'Die Ansage von der Bank sitzt – {s} zieht es durch.',
    'Perfekt getimt, perfekt getroffen – {s} macht keinen Fehler.',
    'Das war Präzisionsarbeit von {s}. {stand}!',
    'Die Vorgabe war klar, {s} setzt sie eiskalt um.',
    'Was für eine Ausführung von {s} – wie im Training einstudiert.',
    '{s} bleibt eiskalt und macht genau das Richtige. {stand}',
    'Ein perfekt ausgespielter Moment – {s} vollendet.',
    'Die Bank jubelt: Der Plan ist voll aufgegangen.',
    '{s} zeigt Nervenstärke im entscheidenden Augenblick. {stand}',
    'So sieht ein einstudierter Spielzug aus – {s} trifft.',
    'Das war handwerklich perfekt von {s}.',
    'Der Trainer ballt die Faust – {s} hat es genau so gemacht.',
    'Ein Meisterstück von {s}. Das Stadion tobt!',
    '{s} nutzt den Moment mit maximaler Konsequenz.',
    'Punktgenau ausgeführt – {s} lässt {tw} keine Chance.',
    'Die Idee war gut, die Umsetzung noch besser. {stand}',
    '{s} bleibt völlig ruhig und schließt eiskalt ab.',
    'Das war der Moment, und {s} war zur Stelle. {stand}',
    'Kaltschnäuzig! {s} macht aus der Vorgabe ein Tor.',
    'Der Plan von der Bank geht auf – {s} vollendet trocken.',
    'Perfekte Ausführung, perfekter Abschluss. {stand}',
    '{s} setzt die Anweisung mit größter Präzision um.',
    'Da stimmt alles: Anlauf, Blick, Abschluss – {s} trifft.',
    'Die Kurve feiert {s} – und der Trainer feiert mit.',
    'So wurde das trainiert, so sitzt es auch. {stand}',
    '{s} lässt sich von nichts aus der Ruhe bringen und vollendet.',
    'Was für ein kühler Kopf von {s} in dieser Situation!',
    'Der Spielzug wurde sauber ausgeführt, {s} macht den Rest.',
    'Genau ins Eck – {s} hat die Vorgabe perfekt getroffen.',
    'Ein Lehrstück von {s}: Ruhe bewahren und einschieben. {stand}',
    'Die Ansage war deutlich, die Umsetzung ist es auch.',
    '{s} zeigt, warum er auf dem Platz steht. {stand}',
    'Punktgenaue Ausführung, das Tor ist die logische Folge.',
    'Der Trainer nickt zufrieden – {s} hat alles richtig gemacht.',
    'Mit größter Konzentration verwandelt {s}. {stand}',
    'So einfach kann es sein, wenn alle wissen, was zu tun ist.'
  ],

  keyMomentSchlecht: [
    'Da war der Plan besser als die Ausführung – {s} verzieht.',
    '{s} kann die Vorgabe nicht umsetzen.',
    'Gut gedacht, schlecht gemacht: {s} scheitert.',
    'Der Trainer an der Seitenlinie greift sich an den Kopf – {s} vergibt.',
    'Das war zu ungenau von {s}, die Idee war richtig.',
    'Die Ausführung misslingt komplett, {s} ist bedient.',
    '{s} hat den Moment nicht getroffen – Chance vertan.',
    'Der Plan war gut, die Beine waren es nicht.',
    '{s} bringt den Ball nicht dorthin, wo er hingehört.',
    'Zu hektisch, zu ungenau – {s} vergibt kläglich.',
    'Die Anweisung war klar, {s} setzt sie nicht um.',
    'Das war nichts. {s} sucht die Schuld bei sich.',
    'Der Trainer schüttelt den Kopf – so war das nicht gedacht.',
    '{s} verliert im entscheidenden Moment die Nerven.',
    'Die Ausführung war einfach zu schlampig.',
    'Da fehlte die Präzision – {s} verstolpert die Möglichkeit.',
    '{s} zögert zu lange, die Chance ist dahin.',
    'Der Spielzug bricht zusammen, {s} trifft die falsche Entscheidung.',
    'Handwerklich mangelhaft von {s}.',
    'Was für eine vergebene Möglichkeit – {s} kann es nicht fassen.',
    'Die Bank stöhnt auf: {s} macht zu wenig aus der Szene.',
    'Zu unentschlossen, zu ungenau. {s} scheitert.',
    'Der Ball will einfach nicht ins Tor – {s} verzweifelt.',
    '{s} setzt den Ball weit neben das Gehäuse.',
    'Das war eine schwache Ausführung von {s}.',
    'Die Idee stimmte, die Technik nicht.',
    '{s} verliert den Ball genau im entscheidenden Moment.',
    'Der Trainer schlägt sich die Hände vors Gesicht.',
    'So wird das nichts – {s} vergibt eine Riesenmöglichkeit.',
    '{s} bekommt den Ball nicht sauber auf den Fuß.',
    'Die Ausführung war viel zu langsam, {g} klärt.',
    '{s} zielt völlig daneben, das Stadion stöhnt.',
    'Der Moment war da, {s} war es nicht.',
    'Zu viel gewollt, zu wenig getroffen.',
    '{s} verstolpert die beste Gelegenheit der Halbzeit.',
    'Die Vorgabe war eindeutig – die Umsetzung leider auch.',
    '{s} bringt den Abschluss nicht aufs Tor.',
    'Ein Fehlgriff im entscheidenden Augenblick.',
    'Das war der Moment – und {s} hat ihn verpasst.',
    'Der Plan verpufft, weil {s} die Ruhe verliert.'
  ]
};

/** Key-Moment-Jubelsätze, die den Schützen namentlich nennen. */
const T_KEYMOMENT_TOR = T.keyMomentGut.filter(x => x.indexOf('{s}') >= 0);

/* ===========================================================================
 * 3. KLEINE HELFER
 * ========================================================================= */

/** Logistische Funktion – das Elo-Herz aller Duelle. */
function L(x) { return 1 / (1 + Math.exp(-x)); }

/**
 * Sättigung eines Stärkeunterschieds. Kleine Unterschiede bleiben unangetastet,
 * riesige laufen gegen eine Grenze. Ohne diese Bremse potenziert sich ein
 * Klassenunterschied über vier Zonenduelle zu absurden Kantersiegen.
 */
function saettigen(d, grenze) {
  return grenze * Math.tanh(d / grenze);
}

/** Duell-Wahrscheinlichkeit: bei Gleichstand exakt `basis`. */
function duell(basis, angriff, abwehr, skala) {
  const d = saettigen(angriff - abwehr, MC.duellSaettigung);
  const p = 2 * basis * L(d / (skala || MC.zoneSkala));
  return p < MC.zoneMin ? MC.zoneMin : p > MC.zoneMax ? MC.zoneMax : p;
}

/** Textbaustein füllen. */
function fuellen(vorlage, d) {
  return String(vorlage).replace(/\{(\w+)\}/g, (m, k) => (d[k] != null ? String(d[k]) : ''));
}

/** Anzeigename eines Spielers. */
function nam(p) {
  return (p && (p.shortName || p.lastName || p.firstName)) || 'Unbekannt';
}

/** Attributwert mit Fallback. */
function A(p, key, fb = 50) {
  const v = p && p.attributes ? p.attributes[key] : undefined;
  return typeof v === 'number' ? v : fb;
}

/** Hat der Spieler diesen Trait? */
function hatTrait(p, t) {
  return !!(p && p.traits && p.traits.indexOf(t) >= 0);
}

/** Gewichteter Schnitt über mehrere Attribute. */
function attMix(p, keys, weights) {
  let s = 0, w = 0;
  for (let i = 0; i < keys.length; i++) {
    const wi = weights ? weights[i] : 1;
    s += A(p, keys[i]) * wi;
    w += wi;
  }
  return w > 0 ? s / w : 50;
}

/* ===========================================================================
 * 4. AUFBAU DES MATCH-STATE
 * ========================================================================= */

const LEER_SLIDER = { tempo: 50, breite: 50, pressinghoehe: 50, risiko: 50, haerte: 50, offensivdrang: 50 };

/** Formationsslots robust auflösen (FORMATIONS, tactics.slots oder Notnagel 4-4-2). */
function slotsVon(tactics) {
  const f = tactics && tactics.formation;
  if (f && typeof f === 'object' && Array.isArray(f.slots) && f.slots.length === 11) return f.slots;
  if (typeof f === 'string' && FORMATIONS[f]) return FORMATIONS[f].slots;
  if (tactics && Array.isArray(tactics.slots) && tactics.slots.length === 11) return tactics.slots;
  return FORMATIONS['4-4-2'].slots;
}

function formationIdVon(tactics) {
  const f = tactics && tactics.formation;
  if (!f) return '4-4-2';
  return typeof f === 'object' ? (f.id || '4-4-2') : String(f);
}

/** Taktikbrett-Koordinaten (x 0..100, y 0..100) → Meter (x 0..105, y 0..68). */
function slotZuMeter(slot, side) {
  const laengs = clamp(slot.y, 0, 100) / 100 * MC.feldL;
  const quer = clamp(slot.x, 0, 100) / 100 * MC.feldB;
  return side === 'home'
    ? { x: laengs, y: quer }
    : { x: MC.feldL - laengs, y: MC.feldB - quer };
}

/** Slider zusammenführen: Stilvorgabe wird von den Reglern des Trainers überschrieben. */
function sliderVon(tactics) {
  const stil = STYLES[(tactics && tactics.style) || 'ausgeglichen'] || STYLES.ausgeglichen;
  const s = Object.assign({}, LEER_SLIDER);
  s.tempo = stil.mods.tempo;
  s.pressinghoehe = stil.mods.pressinghoehe;
  s.risiko = stil.mods.risiko;
  const eigene = (tactics && tactics.sliders) || null;
  if (eigene) for (const k in LEER_SLIDER) if (typeof eigene[k] === 'number') s[k] = clamp(eigene[k], 0, 100);
  // Zusatzanweisungen verschieben die Regler zusätzlich.
  const instr = (tactics && tactics.instructions) || {};
  for (const key in instr) {
    if (!instr[key]) continue;
    const ins = INSTRUCTIONS[key];
    if (!ins) continue;
    for (const k in LEER_SLIDER) if (typeof ins.mods[k] === 'number') s[k] = clamp(s[k] + ins.mods[k], 0, 100);
  }
  return s;
}

/** Multiplikatoren des Spielstils inklusive Anweisungen. */
function stilMods(tactics) {
  const stil = STYLES[(tactics && tactics.style) || 'ausgeglichen'] || STYLES.ausgeglichen;
  const m = {
    chancenRate: stil.mods.chancenRate,
    gegenchancenRate: stil.mods.gegenchancenRate,
    ausdauerkosten: stil.mods.ausdauerkosten,
    passLaenge: stil.mods.passLaenge,
    ballbesitz: 0,
    kopfballGewicht: 1,
    abseitsRate: 1,
    patzerRisiko: 1,
    kartenrisiko: 0,
    flankenlast: 0,
    eckenFaktor: 1
  };
  m.eckenFaktor = 1 + (MC.stilEcken[(tactics && tactics.style) || 'ausgeglichen'] || 0);
  const instr = (tactics && tactics.instructions) || {};
  for (const key in instr) {
    if (!instr[key]) continue;
    const ins = INSTRUCTIONS[key];
    if (!ins) continue;
    const mm = ins.mods;
    if (mm.chancenRate) m.chancenRate *= mm.chancenRate;
    if (mm.gegenchancenRate) m.gegenchancenRate *= mm.gegenchancenRate;
    if (mm.ausdauerkosten) m.ausdauerkosten *= mm.ausdauerkosten;
    if (mm.passLaenge) m.passLaenge = clamp(m.passLaenge + mm.passLaenge, 0, 100);
    if (mm.ballbesitz) m.ballbesitz += mm.ballbesitz;
    if (mm.kopfballGewicht) m.kopfballGewicht *= mm.kopfballGewicht;
    if (mm.abseitsRate) m.abseitsRate *= mm.abseitsRate;
    if (mm.patzerRisiko) m.patzerRisiko *= mm.patzerRisiko;
    if (mm.kartenrisiko) m.kartenrisiko += mm.kartenrisiko;
    if (mm.flankenlast) m.flankenlast += mm.flankenlast;
  }
  if (tactics && tactics.offsideTrap) m.abseitsRate *= MC.abseitsfalleBonus;
  m.eckenFaktor *= 1 + m.flankenlast / 100;
  return m;
}

/** Ballbesitz-Neigung eines Stils (positiv = will den Ball haben). */
const BESITZ_NEIGUNG = {
  ballbesitz: 0.075, pressing: 0.030, offensiv: 0.020, umschaltspiel: -0.005,
  ausgeglichen: 0, kick_and_rush: -0.055, konter: -0.060, defensiv: -0.070
};

/** Eine Spielerakte für die Dauer des Spiels. */
function macheAkte(p, slot, side, ms, ctx) {
  const pos = slot ? slot.pos : (p.position || 'ZM');
  const m = slot ? slotZuMeter(slot, side) : { x: side === 'home' ? 30 : 75, y: 34 };
  return {
    p, id: p.id, pos, slotId: slot ? slot.id : null,
    gruppe: POSITION_GROUP[pos] || 'MIT',
    hx: m.x, hy: m.y,
    basis: effectiveRating(p, pos, ctx),
    frische: clamp((p.fitness == null ? 100 : p.fitness) / 100, 0.2, 1),
    ausdauer: A(p, 'ausdauer'),
    laufwunder: hatTrait(p, 'laufwunder'),
    aufDemPlatz: true, ein: 0, aus: null, minuten: 0,
    tore: 0, vorlagen: 0, schuesse: 0, schuesseAufTor: 0, xg: 0, grosschancen: 0,
    paraden: 0, gegentore: 0, paesse: 0, paesseAn: 0,
    zweikaempfe: 0, zweikaempfeGewonnen: 0, fouls: 0, gefoult: 0,
    gelb: 0, gelbrot: 0, rot: 0, distanz: 0, moralBonus: 0
  };
}

/** Aktuelle Leistungsfähigkeit einer Akte (Basis × Müdigkeit × Ansprache). */
function kann(a) {
  return a.basis * (1 - MC.muedigkeitsWirkung * (1 - a.frische)) * (1 + a.moralBonus);
}

/** Kettenwert: Durchschnitt, aber der schwächste Mann zieht spürbar runter. */
function kettenWert(liste) {
  const n = liste.length;
  if (!n) return 30;
  let s = 0, min = Infinity;
  for (let i = 0; i < n; i++) {
    const v = kann(liste[i]);
    s += v;
    if (v < min) min = v;
  }
  return 0.22 * min + 0.78 * (s / n);
}

/** Baut ein Team-Objekt für die Simulation auf. */
function baueSeite(mt, side, ms) {
  const club = (mt && mt.club) || { id: side, name: side === 'home' ? 'Heim' : 'Gast', shortName: side === 'home' ? 'Heim' : 'Gast', abbr: side === 'home' ? 'HEI' : 'GAS' };
  const spieler = (mt && mt.players) || [];
  let tactics = (mt && mt.tactics) || null;

  const byId = new Map();
  for (const p of spieler) if (p && p.id) byId.set(p.id, p);

  let slots = slotsVon(tactics);
  let lineup = (tactics && tactics.lineup) || {};
  let gefunden = 0;
  for (const s of slots) if (byId.get(lineup[s.id])) gefunden++;

  // Notfall: keine (oder unvollständige) Aufstellung → automatisch aufstellen.
  if (gefunden < 11 && spieler.length >= 11) {
    try {
      tactics = autoLineup(spieler, tactics || { formation: '4-4-2', style: 'ausgeglichen' }, { respectFitness: true });
      if (mt) mt.tactics = tactics;
      slots = slotsVon(tactics);
      lineup = tactics.lineup || {};
    } catch (err) { /* dann eben mit Lücken */ }
  }

  const ctx = {
    weather: ms.venue.weather,
    awayGame: side === 'away' && !ms.competition.neutral,
    bigMatch: ms.bigMatch,
    minute: 0
  };

  const aufDemPlatz = [];
  const benutzt = new Set();
  for (const s of slots) {
    let p = byId.get(lineup[s.id]);
    if (p && benutzt.has(p.id)) p = null;
    if (!p) {
      // Lücke stopfen: bester noch freier Spieler
      let best = null, bestV = -1;
      for (const q of spieler) {
        if (!q || benutzt.has(q.id)) continue;
        const v = playerOverall(q) * (q.position === s.pos ? 1.25 : 1);
        if (v > bestV) { bestV = v; best = q; }
      }
      p = best;
    }
    if (!p) continue;
    benutzt.add(p.id);
    aufDemPlatz.push(macheAkte(p, s, side, ms, ctx));
  }

  const bankIds = (tactics && tactics.bench) || [];
  const bank = [];
  for (const id of bankIds) {
    const p = byId.get(id);
    if (p && !benutzt.has(p.id)) { bank.push(p); benutzt.add(p.id); }
  }
  // Wenn keine Bank definiert ist: alle übrigen Spieler stehen zur Verfügung.
  if (!bank.length) for (const p of spieler) if (p && !benutzt.has(p.id)) { bank.push(p); benutzt.add(p.id); }

  const seite = {
    side, mt, club, tactics,
    slots, ctx,
    aufDemPlatz, bank,
    alle: aufDemPlatz.slice(),
    wechselGenutzt: 0,
    rot: 0,
    offeneEcke: 0,
    formationId: formationIdVon(tactics),
    aggressivitaet: 50,
    stats: {
      possession: 0, shots: 0, shotsOnTarget: 0, xg: 0, corners: 0, fouls: 0,
      offsides: 0, passes: 0, passAccuracy: 0, tackles: 0, yellow: 0, red: 0,
      passesOk: 0, grosschancen: 0, standardTore: 0, besitzGewicht: 0
    },
    tore: 0,
    letzteTaktik: tactics,
    stil: (tactics && tactics.style) || 'ausgeglichen',
    slider: sliderVon(tactics),
    mods: stilMods(tactics),
    teamFaktor: 1, chemie: 50, matchupMod: 1, heimFaktor: 1, tagesform: 1, schwierigkeit: 1,
    tw: 40, abwehr: 40, mittelfeld: 40, angriff: 40, gesamt: 40,
    setPieces: (tactics && tactics.setPieces) || {}
  };
  return seite;
}

/** Torwart-Akte einer Seite (oder der schwächste Feldspieler als Notlösung). */
function keeperVon(seite) {
  for (const a of seite.aufDemPlatz) if (a.pos === 'TW') return a;
  return seite.aufDemPlatz[0] || null;
}

/** Team-Multiplikatoren aus ratings.teamStrength() ziehen (Formation/Stil/Chemie/…). */
function taktikFaktorNeu(seite, ms) {
  let bd = null, chem = 50;
  try {
    const ts = teamStrength({
      club: seite.club,
      players: (seite.mt && seite.mt.players) || [],
      tactics: seite.tactics,
      morale: seite.mt ? seite.mt.morale : 65,
      tiredness: seite.mt ? seite.mt.tiredness : 0,
      coachBonus: seite.mt ? seite.mt.coachBonus : 50,
      chemistryHistory: seite.mt ? seite.mt.chemistryHistory : undefined,
      isHome: seite.side === 'home'
    });
    bd = ts.breakdown;
    chem = ts.chemie;
  } catch (err) { bd = null; }

  // Nur die Anteile, die effectiveRating() NICHT schon enthält (kein Doppelzählen
  // von Form/Moral/Fitness auf Spielerebene).
  const moral = seite.mt && seite.mt.morale != null ? seite.mt.morale : 65;
  const moralF = 1 + (clamp(moral, 0, 100) - 60) / 100 * 0.06;
  const mued = clamp((seite.mt && seite.mt.tiredness) || 0, 0, 100);
  const muedF = 1 - mued / 100 * 0.10;

  seite.chemie = chem;
  seite.teamFaktor = bd
    ? bd.formation * bd.stil * bd.chemie * bd.fuehrung * bd.trainer * moralF * muedF
    : moralF * muedF;
}

/** Aktuelle Mannschaftsteile (jede Minute neu – Müdigkeit und Wechsel wirken sofort). */
function staerkenNeu(seite) {
  const tw = [], abw = [], mit = [], stu = [];
  for (const a of seite.aufDemPlatz) {
    if (a.gruppe === 'TW') tw.push(a);
    else if (a.gruppe === 'ABW') abw.push(a);
    else if (a.gruppe === 'STU') stu.push(a);
    else mit.push(a);
  }
  const f = seite.teamFaktor * seite.matchupMod * seite.heimFaktor * seite.tagesform
    * seite.schwierigkeit * (1 - seite.rot * MC.unterzahlMalus);

  seite.tw = (tw.length ? kettenWert(tw) : 30) * clamp(f, 0.5, 1.6);
  seite.abwehr = (abw.length ? kettenWert(abw) : 30) * f;
  seite.mittelfeld = (mit.length ? kettenWert(mit) : 30) * f;
  seite.angriff = (stu.length ? kettenWert(stu) : (mit.length ? kettenWert(mit) * 0.9 : 30)) * f;
  seite.gesamt = 0.16 * seite.tw + 0.28 * seite.abwehr + 0.32 * seite.mittelfeld + 0.24 * seite.angriff;

  // Aggressivität der Feldspieler – geht in die Foulwahrscheinlichkeit ein.
  let agg = 0, n = 0;
  for (const a of seite.aufDemPlatz) { if (a.pos !== 'TW') { agg += A(a.p, 'aggressivitaet'); n++; } }
  seite.aggressivitaet = n ? agg / n : 50;
}

/** Venue/Referee/Competition auf sichere Werte bringen. */
function normUmfeld(setup) {
  const v = setup.venue || {};
  const capacity = v.capacity > 0 ? v.capacity : 30000;
  const attendance = v.attendance > 0 ? v.attendance : Math.round(capacity * 0.72);
  const weather = WEATHER[v.weather] ? v.weather : 'bewoelkt';
  return {
    capacity,
    attendance,
    stadiumName: v.stadiumName || 'Stadion',
    pitch: v.pitch != null ? clamp(v.pitch, 0, 100) : 80,
    weather,
    temperature: v.temperature != null ? v.temperature : 14,
    heimvorteil: v.heimvorteil != null ? v.heimvorteil : 1.05
  };
}

/**
 * Erzeugt den kompletten Spielzustand. Danach kann mit stepMinute() Minute für
 * Minute simuliert werden – genau das machen simulateMatch() und quickSimulate().
 *
 * @param {object} setup siehe CONTRACTS 6
 * @returns {object} matchState
 */
export function createMatchState(setup) {
  const s = setup || {};
  const rng = s.rng || createRng('traumverein-match');
  const venue = normUmfeld(s);
  const referee = Object.assign({ name: 'Schiedsrichter', strictness: 55, homeBias: 50 }, s.referee || {});
  const competition = Object.assign({ id: 'freundschaft', name: 'Freundschaftsspiel', matchday: 1, neutral: false }, s.competition || {});
  const difficulty = s.difficulty || DIFFICULTIES.profi;

  const ms = {
    setup: s, rng, venue, referee, competition, difficulty,
    quick: !!s.quick,
    interactive: !!s.interactive && typeof s.onKeyMoment === 'function',
    interactiveSide: s.interactiveSide === 'away' ? 'away' : 'home',
    keyMomentFilter: s.keyMomentFilter || null,
    wetter: WEATHER[venue.weather] || WEATHER.bewoelkt,
    zuschauerText: venue.attendance.toLocaleString('de-DE'),
    bigMatch: !!(competition.id === 'pokal' || competition.id === 'europa' || venue.attendance > venue.capacity * 0.92),
    minute: 0, addedTime: 0, half: 1, ende: false, halbzeitPause: false,
    nach1: null, nach2: null,
    score: [0, 0],
    events: [], phases: [], torschuetzen: [],
    momentum: 0,
    unterbrechungen: { tore: 0, wechsel: 0, verletzungen: 0, karten: 0 },
    unterbrechungen1: null,
    kmBudget: 0, kmGenutzt: 0, eckenZaehler: 0,
    letzterTorschuetze: null,
    sides: null
  };

  ms.sides = {
    home: baueSeite(s.home, 'home', ms),
    away: baueSeite(s.away, 'away', ms)
  };
  ms.kmBudget = rng.int(MC.kmBudgetMin, MC.kmBudgetMax);

  // Tagesform: nicht jede Mannschaft erwischt einen guten Tag. Sorgt für die
  // Überraschungen, ohne die eine Liga langweilig wäre.
  ms.sides.home.tagesform = clamp(1 + rng.gauss(0, MC.tagesform), 0.85, 1.15);
  ms.sides.away.tagesform = clamp(1 + rng.gauss(0, MC.tagesform), 0.85, 1.15);
  ms.spielCharakter = clamp(1 + rng.gauss(0, MC.spielCharakter), 0.6, 1.4);

  // Schwierigkeitsgrad: Spielt der Manager mit, wird sein Gegner entsprechend
  // aufgewertet (difficulty.aiStrength). Bei reinen KI-Partien bleibt alles neutral.
  if (s.interactiveSide === 'home' || s.interactiveSide === 'away') {
    const gegnerSeite = s.interactiveSide === 'home' ? 'away' : 'home';
    const ai = difficulty.aiStrength || 1;
    ms.sides[gegnerSeite].schwierigkeit = clamp(1 + (ai - 1) * MC.schwierigkeitWirkung, 0.85, 1.15);
  }

  heimvorteilNeu(ms);
  matchupNeu(ms);
  taktikFaktorNeu(ms.sides.home, ms);
  taktikFaktorNeu(ms.sides.away, ms);
  staerkenNeu(ms.sides.home);
  staerkenNeu(ms.sides.away);

  return ms;
}

/** Heimvorteil aus Zuschauern, Auslastung, Schiedsrichter und club/fans.js. */
function heimvorteilNeu(ms) {
  const v = ms.venue;
  const auslastung = clamp(v.attendance / Math.max(1, v.capacity), 0, 1);
  const fanFaktor = clamp(v.heimvorteil || 1.05, 0.9, 1.2);
  let bonus = MC.heimBasis
    + MC.heimZuschauer * clamp((auslastung - MC.heimAuslastungRef) / 0.4, -1.2, 1.2)
    + MC.heimSchiedsrichter * clamp((ms.referee.homeBias - 50) / 50, -1, 1)
    + (fanFaktor - 1.05) * 0.25;
  if (ms.competition.neutral) bonus *= MC.heimNeutral;
  ms.heimBonus = bonus;
  ms.sides.home.heimFaktor = 1 + bonus;
  ms.sides.away.heimFaktor = 1 - bonus * 0.45;
}

/** Taktisches Duell neu bewerten (nach jeder Taktikänderung). */
function matchupNeu(ms) {
  let mu = { homeMod: 1, awayMod: 1, reasons: [] };
  try { mu = tacticMatchup(ms.sides.home.tactics, ms.sides.away.tactics); } catch (err) { /* egal */ }
  ms.matchup = mu;
  ms.sides.home.matchupMod = mu.homeMod;
  ms.sides.away.matchupMod = mu.awayMod;
}

/* ===========================================================================
 * 5. EREIGNISSE UND PHASEN
 * ========================================================================= */

/** Kontextdaten für die Textbausteine. */
function textDaten(ms, seite, gegner, extra) {
  const d = {
    min: ms.minute,
    stand: ms.score[0] + ':' + ms.score[1],
    t: seite ? (seite.club.shortName || seite.club.name) : '',
    g: gegner ? (gegner.club.shortName || gegner.club.name) : '',
    stadion: ms.venue.stadiumName,
    zuschauer: ms.zuschauerText,
    wetter: (ms.wetter && ms.wetter.name) || 'Bewölkt'
  };
  if (extra) for (const k in extra) d[k] = extra[k];
  return d;
}

/** Erzeugt ein Event, ruft den Live-Hook und liefert seinen Index zurück. */
function pushEvent(ms, ev) {
  if (ms.quick) return null;
  ev.minute = ev.minute != null ? ev.minute : ms.minute;
  ev.addedTime = ms.addedTime;
  ev.score = [ms.score[0], ms.score[1]];
  if (ev.keyMoment === undefined) ev.keyMoment = null;
  if (ev.playerId === undefined) ev.playerId = null;
  if (ev.secondPlayerId === undefined) ev.secondPlayerId = null;
  if (ev.xg === undefined) ev.xg = 0;
  if (!ev.at) ev.at = { x: 52.5, y: 34 };
  ms.events.push(ev);
  const cb = ms.setup.onEvent;
  if (typeof cb === 'function') { try { cb(ev); } catch (err) { /* UI-Fehler dürfen die Sim nicht kippen */ } }
  return ms.events.length - 1;
}

/** Erzeugt eine Phase für die Spielfeld-Animation und ruft den Live-Hook. */
function pushPhase(ms, ph) {
  if (ms.quick) return;
  ms.phases.push(ph);
  const cb = ms.setup.onPhase;
  if (typeof cb === 'function') { try { cb(ph); } catch (err) { /* egal */ } }
}

/** Zonengrenzen in Metern (aus Sicht des angreifenden Teams). */
const ZONE_X = [[6, 30], [30, 68], [68, 88], [88, 103]];

/** Zufälliger Punkt in einer Zone – bereits in Weltkoordinaten. */
function zonePunkt(ms, side, zone, streuung) {
  const r = ms.rng;
  const z = ZONE_X[clamp(zone | 0, 0, 3)];
  let x = r.float(z[0], z[1]);
  let y = clamp(34 + r.gauss(0, streuung == null ? 13 : streuung), 3.5, 64.5);
  if (side === 'away') { x = MC.feldL - x; y = MC.feldB - y; }
  return { x: round(x, 1), y: round(y, 1) };
}

/** Baut Akteure für eine Phase (Ballführende + ein Gegenspieler). */
function akteureFuer(ms, seite, gegner, punkte, aktion) {
  const r = ms.rng;
  const out = [];
  const feld = seite.aufDemPlatz.filter(a => a.pos !== 'TW');
  if (!feld.length) return out;
  const n = Math.min(3, Math.max(1, punkte.length - 1));
  for (let i = 0; i < n; i++) {
    const pt = punkte[Math.min(punkte.length - 1, i + 1)];
    const a = r.pick(feld);
    out.push({
      playerId: a.id,
      x: round(clamp(pt.x + r.float(-2.5, 2.5), 1, 104), 1),
      y: round(clamp(pt.y + r.float(-3, 3), 1, 67), 1),
      action: i === n - 1 ? aktion : (r.chance(0.7) ? 'pass' : 'lauf')
    });
  }
  const gFeld = gegner.aufDemPlatz.filter(a => a.pos !== 'TW');
  if (gFeld.length) {
    const pt = punkte[punkte.length - 1];
    const d = r.pick(gFeld);
    out.push({
      playerId: d.id,
      x: round(clamp(pt.x + r.float(-4, 4), 1, 104), 1),
      y: round(clamp(pt.y + r.float(-4, 4), 1, 67), 1),
      action: aktion === 'schuss' || aktion === 'kopfball' ? 'tackling' : 'lauf'
    });
  }
  if (aktion === 'schuss' || aktion === 'kopfball') {
    const k = keeperVon(gegner);
    if (k) {
      out.push({
        playerId: k.id,
        x: gegner.side === 'home' ? 2.5 : MC.feldL - 2.5,
        y: round(clamp(34 + r.float(-3, 3), 28, 40), 1),
        action: 'parade'
      });
    }
  }
  return out;
}

/** Ballweg → Phase. */
function bauePhase(ms, seite, kind, punkte, aktion, eventIndex) {
  if (ms.quick) return;
  const n = punkte.length;
  const ball = punkte.map((p, i) => ({
    x: round(clamp(p.x, 0, MC.feldL), 1),
    y: round(clamp(p.y, 0, MC.feldB), 1),
    t: round(n > 1 ? i / (n - 1) : 1, 3)
  }));
  const dauer = MC.phasenDauerBasis + MC.phasenDauerProZone * Math.max(1, n - 1);
  pushPhase(ms, {
    minute: ms.minute,
    team: seite.side,
    kind,
    ball,
    actors: akteureFuer(ms, seite, seite === ms.sides.home ? ms.sides.away : ms.sides.home, punkte, aktion),
    duration: round(dauer * ms.rng.float(0.85, 1.2), 2),
    eventIndex: eventIndex == null ? null : eventIndex
  });
}

/* ===========================================================================
 * 6. EINGRIFFE, MÜDIGKEIT, WECHSEL, VERLETZUNGEN
 * ========================================================================= */

/** Liest tactics / pendingSubs / ansprache zu Beginn jeder Minute neu ein. */
function leseEingriffe(ms, seite) {
  const mt = seite.mt;
  if (!mt) return;

  /* --- 1. Taktik darf jederzeit ersetzt worden sein --------------------- */
  if (mt.tactics && mt.tactics !== seite.letzteTaktik) {
    seite.tactics = mt.tactics;
    seite.letzteTaktik = mt.tactics;
    seite.stil = mt.tactics.style || 'ausgeglichen';
    seite.slider = sliderVon(mt.tactics);
    seite.mods = stilMods(mt.tactics);
    seite.setPieces = mt.tactics.setPieces || {};

    /* Neue Grundordnung? Die elf Spieler auf dem Platz neu verteilen.
       Steht ein Spieler in der neuen Aufstellung, bekommt er dessen Slot;
       alle übrigen füllen die verbleibenden Slots der Reihe nach auf. */
    const neuId = formationIdVon(mt.tactics);
    if (neuId !== seite.formationId) {
      const neueSlots = slotsVon(mt.tactics);
      const neuesLineup = mt.tactics.lineup || {};
      const frei = neueSlots.slice();
      const zuweisung = new Map();
      for (const s of neueSlots) {
        const pid = neuesLineup[s.id];
        const a = pid ? seite.aufDemPlatz.find(x => x.id === pid) : null;
        if (a && !zuweisung.has(a.id)) {
          zuweisung.set(a.id, s);
          frei.splice(frei.indexOf(s), 1);
        }
      }
      for (const a of seite.aufDemPlatz) {
        const s = zuweisung.get(a.id) || frei.shift();
        if (!s) continue;
        if (a.pos !== s.pos) {
          a.pos = s.pos;
          a.gruppe = POSITION_GROUP[s.pos] || 'MIT';
          a.basis = effectiveRating(a.p, s.pos, seite.ctx);
        }
        a.slotId = s.id;
        const m = slotZuMeter(s, seite.side);
        a.hx = m.x; a.hy = m.y;
      }
      seite.slots = neueSlots;
      seite.formationId = neuId;
    }
    matchupNeu(ms);
    taktikFaktorNeu(seite, ms);
    if (!ms.quick) {
      pushEvent(ms, {
        type: 'kombination', team: seite.side,
        text: `Taktikwechsel bei ${seite.club.shortName || seite.club.name}: ${(STYLES[seite.stil] || STYLES.ausgeglichen).name} in der ${formationIdVon(seite.tactics)}.`,
        at: { x: 52.5, y: 34 }
      });
    }
  }

  /* --- 2. Auswechslungen ------------------------------------------------ */
  if (Array.isArray(mt.pendingSubs) && mt.pendingSubs.length) {
    for (const w of mt.pendingSubs) {
      if (!w) continue;
      wechselDurchfuehren(ms, seite, w.raus, w.rein);
    }
    mt.pendingSubs.length = 0;
  }

  /* --- 3. Kabinenansprache (einmalig) ----------------------------------- */
  if (mt.ansprache) {
    const wirkung = mt.ansprache.wirkung || {};
    let summe = 0, n = 0;
    for (const a of seite.aufDemPlatz) {
      const d = clamp(wirkung[a.id] || 0, -MC.anspracheMax, MC.anspracheMax);
      a.moralBonus = clamp(a.moralBonus + d * MC.anspracheWirkung, -0.12, 0.12);
      summe += d; n++;
    }
    if (!ms.quick) {
      const schnitt = n ? summe / n : 0;
      pushEvent(ms, {
        type: 'kombination', team: seite.side,
        text: schnitt > 1
          ? `Die Ansprache in der Kabine hat gezündet – ${seite.club.shortName || seite.club.name} kommt wie ausgewechselt aus der Pause.`
          : schnitt < -1
            ? `Die Standpauche ist nach hinten losgegangen – ${seite.club.shortName || seite.club.name} wirkt verunsichert.`
            : `${seite.club.shortName || seite.club.name} hat in der Kabine an den Details gefeilt.`,
        at: { x: 52.5, y: 34 }
      });
    }
    mt.ansprache = null;
  }
}

/** Führt eine Auswechslung durch (Regeln: max. 5, Bank muss den Spieler haben). */
function wechselDurchfuehren(ms, seite, rausId, reinId) {
  if (seite.wechselGenutzt >= MC.maxWechsel) return false;
  const idx = seite.aufDemPlatz.findIndex(a => a.id === rausId);
  if (idx < 0) return false;
  const bIdx = seite.bank.findIndex(p => p.id === reinId);
  if (bIdx < 0) return false;

  const raus = seite.aufDemPlatz[idx];
  const rein = seite.bank[bIdx];
  const slot = seite.slots.find(s => s.id === raus.slotId) || { id: raus.slotId, pos: raus.pos, x: 50, y: 50 };

  const neu = macheAkte(rein, slot, seite.side, ms, seite.ctx);
  neu.ein = ms.minute;
  neu.frische = Math.min(MC.frischeEinwechsler, clamp((rein.fitness == null ? 100 : rein.fitness) / 100, 0.3, 1));
  raus.aufDemPlatz = false;
  raus.aus = ms.minute;

  seite.aufDemPlatz[idx] = neu;
  seite.alle.push(neu);
  seite.bank.splice(bIdx, 1);
  seite.wechselGenutzt++;
  ms.unterbrechungen.wechsel++;

  const gegner = seite === ms.sides.home ? ms.sides.away : ms.sides.home;
  pushEvent(ms, {
    type: 'wechsel', team: seite.side, playerId: neu.id, secondPlayerId: raus.id,
    text: fuellen(ms.rng.pick(T.wechsel), textDaten(ms, seite, gegner, { s: nam(rein), gefoult: nam(raus.p) })),
    at: { x: seite.side === 'home' ? 12 : 93, y: 1 }
  });
  staerkenNeu(seite);
  return true;
}

/** Müdigkeit über die 90 Minuten. */
function ermuedung(ms) {
  const wetterZuschlag = 1 + MC.ermuedungWetter * ((ms.wetter.tempoMod ? (1 - ms.wetter.tempoMod) : 0) * 3);
  for (const key of ['home', 'away']) {
    const seite = ms.sides[key];
    const press = seite.slider.pressinghoehe / 100;
    const tempo = seite.slider.tempo / 100;
    const stilKosten = seite.mods.ausdauerkosten;
    const teamF = stilKosten
      * (1 + MC.ermuedungPressing * (press - 0.5))
      * (1 + MC.ermuedungTempo * (tempo - 0.5))
      * wetterZuschlag;
    for (const a of seite.aufDemPlatz) {
      const rolle = MC.ermuedungRolle[a.pos] || 1;
      const schutz = 1 - MC.ermuedungAusdauer * (a.ausdauer / 100) * 0.65;
      let d = MC.ermuedungProMinute * rolle * teamF * schutz;
      if (a.laufwunder) d *= MC.ermuedungLaufwunder;
      a.frische = clamp(a.frische - d, 0.2, 1);
      a.distanz += (0.105 + 0.02 * rolle) * a.frische;
    }
  }
}

/** Automatische Wechsel der KI (der Manager wechselt über pendingSubs selbst). */
function kiWechsel(ms, seite) {
  if (ms.minute < MC.kiWechselAb) return;
  if (seite.wechselGenutzt >= MC.maxWechsel) return;
  if (!seite.bank.length) return;
  // Der Mensch steuert sein Team selbst – nur eingreifen, wenn er nichts tut.
  const menschlich = ms.setup.interactiveSide && seite.side === ms.setup.interactiveSide && ms.interactive;
  if (menschlich) return;
  if (!ms.rng.chance(0.22)) return;

  let kandidat = null;
  for (const a of seite.aufDemPlatz) {
    if (a.pos === 'TW') continue;
    if (a.frische > MC.kiWechselFrische) continue;
    if (!kandidat || a.frische < kandidat.frische) kandidat = a;
  }
  if (!kandidat) return;

  // Passenden Ersatz suchen (gleiche Gruppe bevorzugt).
  let ersatz = null, bestV = -1;
  for (const p of seite.bank) {
    if (p.position === 'TW') continue;
    let v = playerOverall(p);
    if ((POSITION_GROUP[p.position] || 'MIT') === kandidat.gruppe) v *= 1.3;
    if (v > bestV) { bestV = v; ersatz = p; }
  }
  if (ersatz) wechselDurchfuehren(ms, seite, kandidat.id, ersatz.id);
}

/** Verletzungen (ca. 0,25 pro Spiel, skaliert mit Schwierigkeit, Wetter, Frische). */
function verletzungPruefen(ms) {
  const r = ms.rng;
  const basis = MC.verletzungProSpielMinute
    * (ms.difficulty.injuryRate || 1)
    * (ms.wetter.injuryMod || 1)
    * (1 + (100 - ms.venue.pitch) / 100 * 0.35);
  if (!r.chance(basis)) return;

  const seite = r.chance(0.5) ? ms.sides.home : ms.sides.away;
  const gegner = seite === ms.sides.home ? ms.sides.away : ms.sides.home;
  const opfer = r.pickWeighted(seite.aufDemPlatz, a => {
    let w = 1 - a.frische * MC.verletzungFrische;
    if (hatTrait(a.p, 'glasknochen')) w *= MC.verletzungGlasknochen;
    if (a.pos === 'TW') w *= 0.35;
    return Math.max(0.02, w);
  });
  if (!opfer) return;

  const typ = r.pickWeighted(INJURY_TYPES, t => 1 / (t.severity * t.severity));
  ms.unterbrechungen.verletzungen++;
  opfer.frische = clamp(opfer.frische * 0.55, 0.2, 1);
  opfer.verletzt = { id: typ.id, name: typ.name, tage: r.int(typ.min, typ.max) };

  pushEvent(ms, {
    type: 'verletzung', team: seite.side, playerId: opfer.id,
    text: fuellen(r.pick(T.verletzung), textDaten(ms, seite, gegner, { s: nam(opfer.p) })),
    at: { x: round(opfer.hx, 1), y: round(opfer.hy, 1) }
  });

  // Zwangswechsel, wenn möglich
  if (seite.wechselGenutzt < MC.maxWechsel && seite.bank.length) {
    let ersatz = null, bestV = -1;
    for (const p of seite.bank) {
      let v = playerOverall(p);
      if (opfer.pos === 'TW') v *= p.position === 'TW' ? 4 : 0.2;
      else if ((POSITION_GROUP[p.position] || 'MIT') === opfer.gruppe) v *= 1.3;
      if (v > bestV) { bestV = v; ersatz = p; }
    }
    if (ersatz) wechselDurchfuehren(ms, seite, opfer.id, ersatz.id);
  } else {
    opfer.basis *= 0.72;   // muss angeschlagen weiterspielen
  }
}

/* ===========================================================================
 * 7. KEY MOMENTS
 * ========================================================================= */

/** Prioritäten: 3 = immer (Elfmeter, Topchance), 2 = wichtig, 1 = Beiwerk. */
function kmErlaubt(ms, seite, kind, prio) {
  if (!ms.interactive) return false;
  if (seite.side !== ms.interactiveSide) return false;
  if (ms.keyMomentFilter && ms.keyMomentFilter[kind] === false) return false;
  if (ms.kmGenutzt >= ms.kmBudget) return false;
  const rest = ms.kmBudget - ms.kmGenutzt;
  if (rest <= 3 && prio < 2) return false;
  if (rest <= 1 && prio < 3) return false;
  return true;
}

/** Die vier bis fünf Verteidiger, die dem Ball am nächsten stehen. */
function naechsteVerteidiger(gegner, at, n) {
  const liste = gegner.aufDemPlatz.filter(a => a.pos !== 'TW');
  const sortiert = sortBy(liste, a => Math.hypot(a.hx - at.x, a.hy - at.y));
  return sortiert.slice(0, n || 4).map(a => a.p);
}

/** Baut ein KeyMoment nach CONTRACTS 6.1. */
function baueMoment(ms, kind, seite, gegner, akte, at, baseChance, druck, targets) {
  const k = keeperVon(gegner);
  return {
    kind,
    minute: ms.minute,
    team: seite.side,
    actor: akte.p,
    keeper: k ? k.p : null,
    defenders: naechsteVerteidiger(gegner, at, kind === 'freistoss' ? 4 : 3),
    targets: targets || [],
    at: { x: round(clamp(at.x, 0, MC.feldL), 1), y: round(clamp(at.y, 0, MC.feldB), 1) },
    baseChance: round(clamp(baseChance, 0.01, 0.95), 3),
    pressure: Math.round(clamp(druck, 0, 100)),
    context: {
      score: [ms.score[0], ms.score[1]],
      minute: ms.minute,
      competition: ms.competition.name || ms.competition.id || 'Ligaspiel'
    }
  };
}

/** Abschlussfähigkeit eines Spielers für eine Abschlussart (1..99). */
function abschlussSkill(p, art) {
  if (art === 'kopfball') return attMix(p, ['kopfball', 'sprungkraft', 'koerper'], [0.6, 0.25, 0.15]);
  if (art === 'distanz') return attMix(p, ['schuss', 'technik'], [0.76, 0.24]);
  if (art === 'elfmeter') return attMix(p, ['nervenstaerke', 'schuss', 'technik'], [0.45, 0.35, 0.2]);
  if (art === 'freistoss') return attMix(p, ['standards', 'schuss', 'technik'], [0.55, 0.25, 0.2]);
  return attMix(p, ['schuss', 'technik', 'nervenstaerke'], [0.62, 0.24, 0.14]);
}

/**
 * Wendet die Rückgabe eines Minispiels an.
 * CONTRACTS 6.1: p = clamp(baseChance * (0.45 + 0.9*quality) * skillFactor * difficultyFactor, 0.02, 0.97)
 * Die Fähigkeiten des Spielers bleiben maßgeblich – perfektes Timing rettet keinen Stümper.
 */
function loesungAnwenden(ms, moment, res, akte, art) {
  const q = clamp(res && res.quality != null ? res.quality : 0.5, 0, 1);
  const skill = abschlussSkill(akte.p, art);
  const skillF = MC.kmSkillBasis + MC.kmSkillSpanne * (skill / 100);
  const minigame = (ms.difficulty && ms.difficulty.minigame) || 1;
  const diffF = 1 / (1 + MC.kmSchwierigkeit * (minigame - 1));
  const base = clamp(moment.baseChance + ((res && res.xgDelta) || 0), 0.01, 0.95);
  const p = clamp(base * (0.45 + 0.9 * q) * skillF * diffF, 0.02, 0.97);

  const out = (res && res.outcome) || 'abgeschlossen';
  if (out === 'daneben' || out === 'geblockt' || out === 'abgefangen' || out === 'latte' || out === 'pfosten') {
    return { tor: false, outcome: out, quality: q, p };
  }
  if (out === 'parade') return { tor: false, outcome: 'parade', quality: q, p };
  const tor = ms.rng.chance(p);
  if (tor) return { tor: true, outcome: art === 'kopfball' ? 'kopfball_tor' : 'tor', quality: q, p };
  return { tor: false, outcome: ms.rng.chance(0.55) ? 'parade' : 'daneben', quality: q, p };
}

/* ===========================================================================
 * 8. TORE, SCHÜSSE, STANDARDS
 * ========================================================================= */

/** Wählt einen Abschlussspieler. */
function schuetzeWaehlen(ms, seite, art) {
  const kopf = art === 'kopfball';
  return ms.rng.pickWeighted(seite.aufDemPlatz, a => {
    if (a.pos === 'TW') return 0.0005;
    const g = kopf ? MC.kopfballGewicht[a.gruppe] : MC.schussGewicht[a.gruppe];
    let w = (g == null ? 0.3 : g);
    w *= 0.45 + abschlussSkill(a.p, kopf ? 'kopfball' : 'schuss') / 100;
    w *= 0.6 + 0.4 * a.frische;
    if (hatTrait(a.p, 'knipser') && !kopf) w *= 1.25;
    if (hatTrait(a.p, 'kopfballungeheuer') && kopf) w *= 1.4;
    return Math.max(0.002, w);
  });
}

/** Wählt einen Vorlagengeber (nicht der Schütze selbst). */
function vorlageWaehlen(ms, seite, schuetze) {
  const kandidaten = seite.aufDemPlatz.filter(a => a !== schuetze && a.pos !== 'TW');
  if (!kandidaten.length) return null;
  return ms.rng.pickWeighted(kandidaten, a => {
    const g = MC.vorlageGewicht[a.gruppe];
    let w = (g == null ? 0.4 : g);
    w *= 0.4 + attMix(a.p, ['passspiel', 'uebersicht', 'technik'], [0.5, 0.3, 0.2]) / 100;
    return Math.max(0.01, w);
  });
}

/** Geometrie + xG eines Abschlusses. */
function schussGeometrie(ms, seite, akte, art, opt) {
  const r = ms.rng;
  const torX = seite.side === 'home' ? MC.feldL : 0;
  const richtung = seite.side === 'home' ? 1 : -1;
  let tiefe, seitl;

  if (art === 'elfmeter') { tiefe = 11; seitl = 0; }
  else if (art === 'freistoss') { tiefe = (opt && opt.tiefe) || r.float(18, 28); seitl = (opt && opt.seitl) || clamp(r.gauss(0, 9), -20, 20); }
  else if (art === 'distanz') { tiefe = r.float(17.5, 31); seitl = clamp(r.gauss(0, 10), -26, 26); }
  else if (art === 'kopfball') { tiefe = r.float(3.5, 12.5); seitl = clamp(r.gauss(0, 5.5), -13, 13); }
  else if (art === 'volley') { tiefe = r.float(5, 16); seitl = clamp(r.gauss(0, 7), -18, 18); }
  else { tiefe = r.float(4.5, 17); seitl = clamp(r.gauss(0, 7.5), -19, 19); }

  const dist = Math.sqrt(tiefe * tiefe + seitl * seitl);
  const y = 34 + seitl;
  const a1 = Math.atan2((34 + MC.torBreiteHalb) - y, Math.max(0.6, tiefe));
  const a2 = Math.atan2((34 - MC.torBreiteHalb) - y, Math.max(0.6, tiefe));
  const theta = Math.abs(a1 - a2);

  const at = {
    x: clamp(torX - richtung * tiefe, 0.5, MC.feldL - 0.5),
    y: clamp(seite.side === 'home' ? y : MC.feldB - y, 1, MC.feldB - 1)
  };
  return { tiefe, seitl, dist, theta, at };
}

/** xG eines Abschlusses. */
function xgBerechnen(ms, seite, gegner, akte, art, geo, druck) {
  let xg = MC.xgFaktor
    * Math.exp(-MC.xgDistanz * geo.dist)
    * Math.pow(Math.max(0.02, geo.theta) / MC.xgWinkelRef, MC.xgWinkelExp);

  if (art === 'elfmeter') return MC.elfmeterXg;
  if (art === 'kopfball') xg *= MC.xgKopfball;
  else if (art === 'volley') xg *= MC.xgVolley;
  else if (art === 'distanz') xg *= MC.xgDistanzschuss;
  else if (art === 'freistoss') xg *= MC.freistossXgFaktor;
  else xg *= MC.xgSchuss;

  xg *= 1 - MC.xgDruck * clamp(druck, 0, 100) / 100;

  const skill = abschlussSkill(akte.p, art);
  xg *= MC.xgSkillMin + MC.xgSkillSpanne * (skill / 100);
  if (hatTrait(akte.p, 'knipser') && art !== 'kopfball') xg *= 1.10;
  if (hatTrait(akte.p, 'kopfballungeheuer') && art === 'kopfball') xg *= 1.14;
  if (hatTrait(akte.p, 'weltfussballer')) xg *= 1.06;
  xg *= 0.72 + 0.28 * akte.frische;
  xg *= ms.spielCharakter;

  // Nervenstärke in der Schlussphase
  if (ms.minute >= 75) {
    const n = (A(akte.p, 'nervenstaerke') - 55) / 100;
    xg *= 1 + MC.nervenSchluss * n;
  }
  // Schwierigkeitsgrad: der Gegner des Managers trifft besser/schlechter
  if (ms.setup.interactiveSide && seite.side !== ms.setup.interactiveSide) {
    xg *= (ms.difficulty.opponentFinishing || 1);
  }
  return clamp(xg, MC.xgMin, MC.xgMax);
}

/** Torwartfaktor auf die Torwahrscheinlichkeit. */
function torwartFaktor(ms, gegner) {
  const k = keeperVon(gegner);
  if (!k) return 1.25;
  let q = clamp(kann(k), 1, 99);
  if (hatTrait(k.p, 'torwartlegende')) q += 4;
  return clamp(MC.twBasis - MC.twWirkung * (q / 100), 0.72, 1.3);
}

/** Trägt ein Tor ein (inkl. Statistik, Momentum, Torschützenliste, Event). */
function torFallen(ms, seite, gegner, akte, vorlage, art, geo, xg, keyMoment, extraText, standard) {
  const heim = seite.side === 'home';
  ms.score[heim ? 0 : 1]++;
  seite.tore++;
  seite.stats.shotsOnTarget++;
  akte.tore++;
  akte.schuesseAufTor++;
  if (vorlage) vorlage.vorlagen++;
  ms.unterbrechungen.tore++;
  ms.momentum += (heim ? 1 : -1) * (MC.momentumTor - MC.momentumGegentor);

  const k = keeperVon(gegner);
  if (k) k.gegentore++;
  for (const a of gegner.aufDemPlatz) if (a.gruppe === 'ABW') a.gegentore += 0.25;

  if (standard || art === 'elfmeter' || art === 'freistoss') seite.stats.standardTore++;

  ms.torschuetzen.push({
    minute: ms.minute, playerId: akte.id, team: seite.side, eigentor: false
  });
  ms.letzterTorschuetze = akte;

  if (!ms.quick) {
    const d = textDaten(ms, seite, gegner, {
      s: nam(akte.p),
      v: vorlage ? nam(vorlage.p) : nam(akte.p),
      tw: k ? nam(k.p) : 'dem Torwart'
    });
    let text;
    if (extraText) text = fuellen(extraText, d);
    else if (art === 'elfmeter') text = fuellen('Vom Elfmeterpunkt gibt es keine Diskussion: {s} verwandelt zum {stand}.', d);
    else if (art === 'freistoss') text = fuellen('{s} zirkelt den Freistoß über die Mauer ins Eck. {stand}!', d);
    else text = fuellen(ms.rng.pick(T.tor), d);
    if (text.indexOf(d.stand) < 0) text = text.replace(/\s*$/, '') + ' ' + d.stand + '!';
    const idx = pushEvent(ms, {
      type: 'tor', team: seite.side, playerId: akte.id,
      secondPlayerId: vorlage ? vorlage.id : null,
      text, xg: round(xg, 3),
      at: { x: round(geo.at.x, 1), y: round(geo.at.y, 1) },
      keyMoment: keyMoment || null
    });
    const start = zonePunkt(ms, seite.side, 2);
    bauePhase(ms, seite, art === 'elfmeter' || art === 'freistoss' || art === 'ecke' ? 'standard' : 'angriff',
      [start, { x: (start.x + geo.at.x) / 2, y: (start.y + geo.at.y) / 2 }, geo.at,
        { x: seite.side === 'home' ? MC.feldL : 0, y: 34 + ms.rng.float(-2.8, 2.8) }],
      art === 'kopfball' ? 'kopfball' : 'schuss', idx);
  }
}

/** Eigentor. */
function eigentorFallen(ms, seite, gegner, akte) {
  // `seite` ist das Team, das den Ball ins EIGENE Tor befördert.
  const heim = seite.side === 'home';
  ms.score[heim ? 1 : 0]++;
  gegner.tore++;
  ms.unterbrechungen.tore++;
  ms.momentum += (heim ? -1 : 1) * MC.momentumTor;
  const k = keeperVon(seite);
  if (k) k.gegentore++;
  ms.torschuetzen.push({ minute: ms.minute, playerId: akte.id, team: gegner.side, eigentor: true });

  if (!ms.quick) {
    const at = { x: seite.side === 'home' ? 8 : MC.feldL - 8, y: 34 + ms.rng.float(-6, 6) };
    const d = textDaten(ms, seite, gegner, { s: nam(akte.p), tw: k ? nam(k.p) : 'dem Torwart' });
    const idx = pushEvent(ms, {
      type: 'tor', team: gegner.side, playerId: akte.id,
      text: fuellen(ms.rng.pick(T.eigentor), d),
      at: { x: round(at.x, 1), y: round(at.y, 1) }
    });
    bauePhase(ms, gegner, 'angriff', [zonePunkt(ms, gegner.side, 2), at], 'schuss', idx);
  }
}

/**
 * Führt einen Abschluss aus. Generator, weil hier ein Key Moment liegen kann.
 * @param {object} opt { art, druck, kind, vorlage, geo, xgMod, keyPrio, text }
 */
function* abschluss(ms, seite, gegner, akte, opt) {
  const r = ms.rng;
  const art = opt.art || 'schuss';
  const geo = opt.geo || schussGeometrie(ms, seite, akte, art, opt);
  const druck = opt.druck != null ? opt.druck : 45;
  let xg = opt.xg != null ? opt.xg : xgBerechnen(ms, seite, gegner, akte, art, geo, druck);
  if (opt.xgMod) xg *= opt.xgMod;
  xg = clamp(xg, MC.xgMin, MC.xgMax);

  seite.stats.shots++;
  seite.stats.xg += xg;
  akte.schuesse++;
  akte.xg += xg;
  const gross = xg >= MC.kmGrosschanceXg;
  if (gross) { seite.stats.grosschancen++; akte.grosschancen++; }

  const twF = torwartFaktor(ms, gegner);
  let pTor = clamp(xg * twF, 0.004, 0.96);

  /* --- Key Moment? ------------------------------------------------------ */
  let moment = null, loesung = null;
  const kind = opt.kind || (gross ? 'abschluss' : null);
  const prio = opt.keyPrio != null ? opt.keyPrio : (xg >= 0.3 ? 3 : 2);
  if (kind && kmErlaubt(ms, seite, kind, prio)) {
    moment = baueMoment(ms, kind, seite, gegner, akte, geo.at, pTor, druck, opt.targets || []);
    ms.kmGenutzt++;
    const res = yield moment;
    if (res) {
      loesung = loesungAnwenden(ms, moment, res, akte, art);
      if (res.targetPlayerId) {
        const ziel = seite.aufDemPlatz.find(a => a.id === res.targetPlayerId);
        if (ziel && ziel !== akte) { opt.vorlage = akte; akte = ziel; }
      }
    }
  }

  const k = keeperVon(gegner);
  const d = () => textDaten(ms, seite, gegner, {
    s: nam(akte.p),
    v: opt.vorlage ? nam(opt.vorlage.p) : nam(akte.p),
    tw: k ? nam(k.p) : 'dem Torwart'
  });

  /* --- Auflösung --------------------------------------------------------- */
  let tor, ausgang;
  if (loesung) {
    tor = loesung.tor;
    ausgang = loesung.outcome;
  } else {
    tor = r.chance(pTor);
    ausgang = tor ? 'tor' : null;
  }

  if (tor) {
    let text = null;
    if (loesung) {
      // Nur Bausteine, die den Schützen benennen – ein Torticker ohne Namen ist nichts wert.
      const pool = loesung.quality >= 0.6 ? T_KEYMOMENT_TOR : T.tor;
      text = r.pick(pool);
    }
    torFallen(ms, seite, gegner, akte, opt.vorlage || null, art, geo, xg, moment, text, !!opt.standard);
    return true;
  }

  /* --- Kein Tor: Wie ist der Ball am Tor vorbeigekommen? ------------------ */
  if (!ausgang) {
    const paradeAnteil = MC.paradeAnteilBasis + MC.paradeAnteilXg * Math.min(1, xg / 0.30);
    const blockAnteil = MC.blockAnteil * (art === 'distanz' ? 1.35 : art === 'elfmeter' ? 0 : 1)
      * (1 + clamp(druck, 0, 100) / 100 * 0.5);
    const rr = r.next();
    if (rr < blockAnteil) ausgang = 'geblockt';
    else if (rr < blockAnteil + MC.aluAnteil) ausgang = r.chance(0.5) ? 'latte' : 'pfosten';
    else if (rr < blockAnteil + MC.aluAnteil + paradeAnteil) ausgang = 'parade';
    else ausgang = 'daneben';
  }

  let evType = gross ? 'grosschance' : 'chance';

  if (ausgang === 'parade') {
    evType = 'parade';
    if (k) k.paraden++;
    seite.stats.shotsOnTarget++;
    akte.schuesseAufTor++;
    if (r.chance(MC.eckeNachParade * seite.mods.eckenFaktor)) eckeGeben(ms, seite, gegner);
  } else if (ausgang === 'latte' || ausgang === 'pfosten') {
    evType = ausgang;
    if (r.chance(MC.eckeNachAlu * seite.mods.eckenFaktor)) eckeGeben(ms, seite, gegner);
  } else if (ausgang === 'geblockt') {
    const blocker = zufallsSpieler(ms, gegner, ['ABW', 'MIT']);
    if (blocker) { blocker.zweikaempfe++; blocker.zweikaempfeGewonnen++; gegner.stats.tackles++; }
    if (r.chance(MC.eckeNachBlock * seite.mods.eckenFaktor)) eckeGeben(ms, seite, gegner);
  }

  if (!ms.quick) {
    const at = { x: round(geo.at.x, 1), y: round(geo.at.y, 1) };
    const dd = d();
    let text;
    if (ausgang === 'parade') text = fuellen(r.pick(T.parade), dd);
    else if (ausgang === 'latte') text = fuellen(r.pick(T.latte), dd);
    else if (ausgang === 'pfosten') text = fuellen(r.pick(T.pfosten), dd);
    else if (ausgang === 'geblockt') text = fuellen(r.pick(T.chance), dd);
    else if (ausgang === 'abgefangen') text = fuellen(r.pick(T.ballverlust), dd);
    else text = fuellen(r.pick(gross ? T.grosschance : T.chance), dd);
    if (loesung && loesung.quality < 0.4 && ausgang !== 'parade') {
      text = fuellen(r.pick(T.keyMomentSchlecht), dd);
    }

    const zeigen = gross || evType === 'parade' || evType === 'latte' || evType === 'pfosten' || r.chance(0.72);
    if (zeigen) {
      const idx = pushEvent(ms, {
        type: evType, team: seite.side, playerId: akte.id,
        secondPlayerId: opt.vorlage ? opt.vorlage.id : null,
        text, xg: round(xg, 3), at, keyMoment: moment || null
      });
      const start = zonePunkt(ms, seite.side, 2);
      bauePhase(ms, seite, art === 'ecke' || art === 'freistoss' || art === 'elfmeter' ? 'standard' : 'angriff',
        [start, { x: (start.x + at.x) / 2, y: (start.y + at.y) / 2 }, at],
        art === 'kopfball' ? 'kopfball' : 'schuss', idx);
    }
  }
  return false;
}

/** Ecke registrieren (der Abschluss folgt in eckeAusfuehren). */
function eckeGeben(ms, seite, gegner) {
  seite.stats.corners++;
  ms.eckenZaehler++;
  seite.offeneEcke = (seite.offeneEcke || 0) + 1;
}

/** Ecke ausführen (Generator wegen Key Moment). */
function* eckeAusfuehren(ms, seite, gegner) {
  const r = ms.rng;
  seite.offeneEcke--;
  const schuetze = seite.setPieces && seite.setPieces.ecke
    ? seite.aufDemPlatz.find(a => a.id === seite.setPieces.ecke)
    : null;
  const flanker = schuetze || r.pickWeighted(seite.aufDemPlatz, a =>
    a.pos === 'TW' ? 0 : 0.2 + A(a.p, 'standards') / 100);

  const gefaehrlich = r.chance(MC.eckeAbschlussRate * (1 + seite.mods.flankenlast / 100));

  if (!ms.quick) {
    const ecke = { x: seite.side === 'home' ? 104 : 1, y: r.chance(0.5) ? 1 : 67 };
    const ziel = { x: seite.side === 'home' ? 99 : 6, y: 34 + r.float(-6, 6) };
    const idx = (!gefaehrlich && r.chance(0.55)) ? pushEvent(ms, {
      type: 'ecke', team: seite.side, playerId: flanker ? flanker.id : null,
      text: fuellen(r.pick(T.ecke), textDaten(ms, seite, gegner, { s: flanker ? nam(flanker.p) : 'der Schütze', tw: nam((keeperVon(gegner) || {}).p) })),
      at: ecke
    }) : null;
    bauePhase(ms, seite, 'standard', [ecke, ziel], 'kopfball', idx);
  }

  if (!gefaehrlich) return false;

  const kopf = r.chance(MC.eckeKopfballAnteil);
  const art = kopf ? 'kopfball' : 'volley';
  const akte = schuetzeWaehlen(ms, seite, art);
  if (!akte) return false;

  const targets = seite.aufDemPlatz
    .filter(a => a !== akte && a.pos !== 'TW')
    .slice(0, 4)
    .map(a => a.p);

  const kind = kmErlaubt(ms, seite, 'ecke', 1) && (ms.eckenZaehler % MC.kmEckeJede === 0) ? 'ecke' : null;
  const geo = schussGeometrie(ms, seite, akte, art);
  const druck = 55 + r.float(-15, 20);
  return yield* abschluss(ms, seite, gegner, akte, {
    art, geo, druck, kind, keyPrio: 1, targets, standard: true,
    vorlage: flanker && flanker !== akte ? flanker : null
  });
}

/** Elfmeter. */
function* elfmeter(ms, seite, gegner, verursacher, gefoulter) {
  const r = ms.rng;
  let akte = seite.setPieces && seite.setPieces.elfmeter
    ? seite.aufDemPlatz.find(a => a.id === seite.setPieces.elfmeter)
    : null;
  if (!akte) {
    akte = r.pickWeighted(seite.aufDemPlatz, a => a.pos === 'TW' ? 0
      : 0.1 + abschlussSkill(a.p, 'elfmeter') / 100 + (hatTrait(a.p, 'elfmeterkiller') ? 1.5 : 0));
  }
  if (!akte) return false;

  const at = { x: seite.side === 'home' ? MC.feldL - 11 : 11, y: 34 };
  if (!ms.quick) {
    pushEvent(ms, {
      type: 'elfmeter', team: seite.side, playerId: akte.id,
      secondPlayerId: gefoulter ? gefoulter.id : null,
      text: fuellen(r.pick(T.elfmeter), textDaten(ms, seite, gegner, {
        s: verursacher ? nam(verursacher.p) : 'ein Verteidiger',
        gefoult: gefoulter ? nam(gefoulter.p) : nam(akte.p)
      })),
      at: { x: round(at.x, 1), y: 34 }
    });
  }

  const geo = schussGeometrie(ms, seite, akte, 'elfmeter');
  let xg = MC.elfmeterXg;
  xg *= 0.88 + 0.24 * (abschlussSkill(akte.p, 'elfmeter') / 100);
  if (hatTrait(akte.p, 'elfmeterkiller')) xg *= 1.10;
  const k = keeperVon(gegner);
  if (k && hatTrait(k.p, 'torwartlegende')) xg *= 0.92;

  const tor = yield* abschluss(ms, seite, gegner, akte, {
    art: 'elfmeter', geo, druck: 10, xg, kind: 'elfmeter', keyPrio: 3
  });
  if (!tor && !ms.quick) {
    pushEvent(ms, {
      type: 'chance', team: seite.side, playerId: akte.id,
      text: fuellen(r.pick(T.elfmeterVerschossen), textDaten(ms, seite, gegner, {
        s: nam(akte.p), tw: k ? nam(k.p) : 'dem Torwart'
      })),
      at: { x: round(at.x, 1), y: 34 }
    });
  }
  return tor;
}

/** Gefährlicher Freistoß. */
function* freistoss(ms, seite, gegner, tiefe, seitl) {
  const r = ms.rng;
  let akte = seite.setPieces && seite.setPieces.freistoss
    ? seite.aufDemPlatz.find(a => a.id === seite.setPieces.freistoss)
    : null;
  if (!akte) {
    akte = r.pickWeighted(seite.aufDemPlatz, a => a.pos === 'TW' ? 0
      : 0.1 + A(a.p, 'standards') / 100 + (hatTrait(a.p, 'freistossspezialist') ? 1.2 : 0));
  }
  if (!akte) return false;

  const geo = schussGeometrie(ms, seite, akte, 'freistoss', { tiefe, seitl });
  const kind = geo.dist <= MC.kmFreistossMaxMeter ? 'freistoss' : null;

  if (!ms.quick && r.chance(0.55)) {
    pushEvent(ms, {
      type: 'freistoss', team: seite.side, playerId: akte.id,
      text: fuellen(r.pick(T.freistoss), textDaten(ms, seite, gegner, {
        s: nam(akte.p), tw: nam((keeperVon(gegner) || {}).p)
      })),
      at: { x: round(geo.at.x, 1), y: round(geo.at.y, 1) }
    });
  }
  return yield* abschluss(ms, seite, gegner, akte, {
    art: 'freistoss', geo, druck: 28, kind, keyPrio: 2
  });
}

/* ===========================================================================
 * 9. FOULS UND KARTEN
 * ========================================================================= */

/** Ein Foul samt möglicher Karte. Liefert true, wenn es ein Elfmeter war. */
function foulBegehen(ms, seite, gegner, taeter, opfer, zone, taktisch) {
  const r = ms.rng;
  seite.stats.fouls++;
  taeter.fouls++;
  if (opfer) opfer.gefoult++;

  // Kartenwahrscheinlichkeit
  let p = MC.karteBasis;
  p *= 1 + MC.karteStrenge * ((ms.referee.strictness - 50) / 100);
  p *= 1 + MC.karteHaerte * ((seite.slider.haerte - 50) / 100);
  p *= 1 + (A(taeter.p, 'aggressivitaet') - 50) / 100 * 0.55;
  p *= 1 + seite.mods.kartenrisiko / 100;
  if (hatTrait(taeter.p, 'eisenfuss')) p *= MC.karteEisenfuss;
  if (taktisch) p *= MC.karteTaktisch;
  if (zone >= 2) p *= 1.15;
  if (ms.minute > 70) p *= 1.12;
  // Ein bereits Verwarnter geht auf Nummer sicher – und der Schiedsrichter
  // überlegt es sich zweimal. Sonst hagelt es Ampelkarten.
  if (taeter.gelb > 0) p *= MC.karteZweiteGelbe;
  p = clamp(p, 0.005, 0.8);

  let karte = null;
  if (r.chance(p)) {
    if (r.chance(MC.rotDirekt)) karte = 'rot';
    else karte = taeter.gelb > 0 ? 'gelbrot' : 'gelb';
  }

  if (karte === 'gelb') {
    taeter.gelb++;
    seite.stats.yellow++;
    ms.unterbrechungen.karten++;
  } else if (karte === 'gelbrot' || karte === 'rot') {
    if (karte === 'gelbrot') { taeter.gelbrot = 1; seite.stats.yellow++; }
    taeter.rot = 1;
    seite.stats.red++;
    seite.rot++;
    ms.unterbrechungen.karten += 2;
    taeter.aufDemPlatz = false;
    taeter.aus = ms.minute;
    const i = seite.aufDemPlatz.indexOf(taeter);
    if (i >= 0) seite.aufDemPlatz.splice(i, 1);
    staerkenNeu(seite);
  }

  if (ms.quick) return karte;

  const d = textDaten(ms, seite, gegner, {
    s: nam(taeter.p),
    gefoult: opfer ? nam(opfer.p) : 'den Gegenspieler'
  });
  const at = { x: round(taeter.hx + r.float(-6, 6), 1), y: round(clamp(taeter.hy + r.float(-6, 6), 1, 67), 1) };

  if (karte === 'gelb') {
    pushEvent(ms, { type: 'gelb', team: seite.side, playerId: taeter.id, secondPlayerId: opfer ? opfer.id : null, text: fuellen(r.pick(T.gelb), d), at });
  } else if (karte === 'gelbrot' || karte === 'rot') {
    pushEvent(ms, {
      type: karte, team: seite.side, playerId: taeter.id,
      text: fuellen(r.pick(karte === 'gelbrot' ? T.gelbrot : T.rot), d), at
    });
  } else if (r.chance(0.22)) {
    pushEvent(ms, { type: 'foul', team: seite.side, playerId: taeter.id, secondPlayerId: opfer ? opfer.id : null, text: fuellen(r.pick(T.foul), d), at });
  }
  return karte;
}

/* ===========================================================================
 * 10. BALLBESITZPHASEN — das Herz der Simulation
 * ========================================================================= */

/** Wahrscheinlichkeit, dass die nächste Phase bei der Heimmannschaft beginnt. */
function besitzWahrscheinlichkeit(ms) {
  const H = ms.sides.home, Aw = ms.sides.away;
  let p = L(saettigen(H.mittelfeld - Aw.mittelfeld, MC.besitzSaettigung) / MC.ballbesitzSkala);
  p += (BESITZ_NEIGUNG[H.stil] || 0) - (BESITZ_NEIGUNG[Aw.stil] || 0);
  p += (H.mods.ballbesitz - Aw.mods.ballbesitz) / 100 * 0.55;
  p += ms.heimBonus * MC.heimBesitz;
  p += ms.momentum * MC.momentumWirkung * 0.6;
  p -= (H.rot - Aw.rot) * MC.unterzahlBesitz;
  // Wer hinten liegt, rennt an; wer führt, verwaltet.
  if (ms.minute >= 60) {
    const diff = ms.score[0] - ms.score[1];
    if (diff < 0) p += MC.rueckstandDrang * Math.min(2, -diff) * 0.35;
    else if (diff > 0) p -= MC.fuehrungVerwaltung * Math.min(2, diff) * 0.35;
  }
  return clamp(p, MC.ballbesitzMin, MC.ballbesitzMax);
}

/** Ein zufälliger Feldspieler einer Gruppe (mit Rückfallebene). */
function zufallsSpieler(ms, seite, gruppen) {
  const liste = seite.aufDemPlatz;
  let n = 0;
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i];
    if (a.pos === 'TW') continue;
    if (gruppen && gruppen.indexOf(a.gruppe) < 0) continue;
    n++;
  }
  let filter = !!gruppen;
  if (n === 0) {
    filter = false;
    for (let i = 0; i < liste.length; i++) if (liste[i].pos !== 'TW') n++;
    if (n === 0) return liste[0] || null;
  }
  let k = ms.rng.int(0, n - 1);
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i];
    if (a.pos === 'TW') continue;
    if (filter && gruppen.indexOf(a.gruppe) < 0) continue;
    if (k-- === 0) return a;
  }
  return null;
}

/** Ein Zweikampf wird verbucht. */
function zweikampfBuchen(ms, angreifer, verteidiger, gewonnen, zone) {
  const a = zufallsSpieler(ms, angreifer, zone <= 1 ? ['MIT', 'ABW'] : ['MIT', 'STU']);
  const d = zufallsSpieler(ms, verteidiger, zone <= 1 ? ['MIT', 'STU'] : ['ABW', 'MIT']);
  if (a) { a.zweikaempfe++; if (gewonnen) a.zweikaempfeGewonnen++; }
  if (d) { d.zweikaempfe++; if (!gewonnen) { d.zweikaempfeGewonnen++; verteidiger.stats.tackles++; } }
  return { a, d };
}

/** Pässe einer Phase verbuchen. */
function paesseBuchen(ms, seite, gegner, zonen) {
  const r = ms.rng;
  const abschnitte = Math.max(1, zonen + 1);
  const passF = 1 + (50 - seite.mods.passLaenge) / 100 * 0.55;
  const versuche = Math.max(1, Math.round((MC.paesseBasis + MC.paesseProZone * abschnitte) * passF * r.float(0.7, 1.3)));

  let quote = MC.passQuoteBasis
    + MC.passQuoteSkala * (seite.mittelfeld - gegner.mittelfeld)
    + (50 - seite.mods.passLaenge) / 100 * 0.06
    - (gegner.slider.pressinghoehe - 50) / 100 * 0.045
    - (ms.wetter.errorMod - 1) * 0.10;
  quote = clamp(quote, MC.passQuoteMin, MC.passQuoteMax);

  const ok = Math.round(versuche * quote);
  seite.stats.passes += versuche;
  seite.stats.passesOk += ok;

  // Auf zwei bis drei Spieler verteilen (für die Einzelstatistik)
  const n = Math.min(3, seite.aufDemPlatz.length);
  for (let i = 0; i < n; i++) {
    const a = zufallsSpieler(ms, seite, null);
    if (!a) break;
    const anteil = Math.round(versuche / n);
    a.paesse += anteil;
    a.paesseAn += Math.round(anteil * quote);
  }
}

/** Eine komplette Ballbesitzphase. Generator wegen möglicher Key Moments. */
function* phaseSpielen(ms) {
  const r = ms.rng;
  const H = ms.sides.home, Aw = ms.sides.away;

  /* --- Offene Ecken zuerst ausführen ------------------------------------ */
  if ((H.offeneEcke || 0) > 0) { yield* eckeAusfuehren(ms, H, Aw); return; }
  if ((Aw.offeneEcke || 0) > 0) { yield* eckeAusfuehren(ms, Aw, H); return; }

  const pHome = besitzWahrscheinlichkeit(ms);
  const angreifer = r.chance(pHome) ? H : Aw;
  const verteidiger = angreifer === H ? Aw : H;

  /* --- Startzone: hohes Pressing gewinnt Bälle weiter vorn -------------- */
  const shift = clamp((angreifer.slider.pressinghoehe - 50) / 50, -1, 1) * MC.pressingVerschiebung;
  const w0 = MC.startZ0 * (1 - shift);
  const w2 = MC.startZ2 * (1 + shift * 2.2);
  const w1 = Math.max(0.05, 1 - w0 - w2);
  const rr = r.next() * (w0 + w1 + w2);
  let stufe = rr < w0 ? 0 : (rr < w0 + w1 ? 1 : 2);

  /* --- Konter? ---------------------------------------------------------- */
  const konterP = clamp(
    MC.konterRate * (1 + (MC.konterStilBonus[angreifer.stil] || 0))
    * (0.65 + 0.7 * ((verteidiger.slider.pressinghoehe + verteidiger.slider.offensivdrang) / 200)),
    0, 0.65);
  const istKonter = stufe <= 1 && r.chance(konterP);
  const konterBonus = istKonter ? MC.konterBonus : 0;

  /* --- Qualitäten ------------------------------------------------------- */
  const aufbauQ = 0.45 * angreifer.abwehr + 0.55 * angreifer.mittelfeld;
  const mittelQ = angreifer.mittelfeld;
  const angriffQ = 0.62 * angreifer.angriff + 0.38 * angreifer.mittelfeld;
  const pressQ = verteidiger.mittelfeld * (0.86 + 0.28 * verteidiger.slider.pressinghoehe / 100);
  const mittelD = verteidiger.mittelfeld;
  const abwehrQ = 0.66 * verteidiger.abwehr + 0.34 * verteidiger.mittelfeld;

  const mom = ms.momentum * MC.momentumWirkung * (angreifer.side === 'home' ? 1 : -1);
  let druckMod = 1 + mom + konterBonus;
  if (ms.minute >= 65) {
    const diff = (angreifer.side === 'home' ? 1 : -1) * (ms.score[0] - ms.score[1]);
    if (diff < 0) druckMod += MC.rueckstandDrang * Math.min(2, -diff) * 0.5;
    else if (diff > 0) druckMod -= MC.fuehrungVerwaltung * Math.min(2, diff) * 0.5;
  }
  druckMod = clamp(druckMod, 0.6, 1.6);
  // Der Stilfaktor greift an ZWEI Zonenübergängen (Z1→Z2 und Z2→Z3). Voll angesetzt
  // würde er sich also quadrieren: zwei offensive Mannschaften kämen auf über 50
  // Schüsse, zwei defensive auf zehn. Die Wurzel sorgt dafür, dass über die ganze
  // Phase gerechnet exakt `chancenRate × gegenchancenRate` herauskommt – der Stil
  // bleibt deutlich spürbar, sprengt aber die Zielkorridore nicht mehr.
  const stilMod = Math.sqrt(clamp(angreifer.mods.chancenRate * verteidiger.mods.gegenchancenRate, 0.2, 3));
  const chanceMod = stilMod * ms.spielCharakter;

  /* --- Zonenwanderung ---------------------------------------------------- */
  const zeichnen = !ms.quick;
  const punkte = zeichnen ? [zonePunkt(ms, angreifer.side, stufe)] : null;
  let zonen = 0;
  let ende = null;
  let sicherung = 0;

  while (sicherung++ < 8) {
    if (stufe === 0) {
      if (r.chance(duell(MC.pAufbau * druckMod, aufbauQ, pressQ, MC.zoneSkala))) {
        stufe = 1; zonen++; if (zeichnen) punkte.push(zonePunkt(ms, angreifer.side, 1));
        zweikampfBuchen(ms, angreifer, verteidiger, true, 0);
      } else { ende = 'verloren0'; zweikampfBuchen(ms, angreifer, verteidiger, false, 0); break; }
      continue;
    }
    if (stufe === 1) {
      if (r.chance(duell(MC.pMittelfeld * chanceMod * druckMod, mittelQ, mittelD, MC.zoneSkala))) {
        stufe = 2; zonen++; if (zeichnen) punkte.push(zonePunkt(ms, angreifer.side, 2, 15));
        zweikampfBuchen(ms, angreifer, verteidiger, true, 1);
      } else { ende = 'verloren1'; zweikampfBuchen(ms, angreifer, verteidiger, false, 1); break; }
      continue;
    }
    if (stufe === 2) {
      if (r.chance(MC.abseitsRate * verteidiger.mods.abseitsRate)) { ende = 'abseits'; break; }
      // Wer kontert, zieht nicht aus 25 Metern ab – er läuft auf das Tor zu.
      const distNeigung = (0.7 + 0.6 * (angreifer.slider.risiko / 100)
        + (angreifer.stil === 'kick_and_rush' ? 0.2 : 0)) * (istKonter ? MC.konterDistanz : 1);
      if (r.chance(MC.distanzschussRate * chanceMod * distNeigung)) { ende = 'distanz'; break; }
      if (r.chance(duell(MC.pStrafraum * chanceMod * druckMod, angriffQ, abwehrQ, MC.zoneSkala))) {
        stufe = 3; zonen++; if (zeichnen) punkte.push(zonePunkt(ms, angreifer.side, 3, 10));
        zweikampfBuchen(ms, angreifer, verteidiger, true, 2);
      } else { ende = 'verloren2'; zweikampfBuchen(ms, angreifer, verteidiger, false, 2); break; }
      continue;
    }
    // Zone 3 – Strafraum
    if (r.chance(MC.strafraumfoulAnteil)) { ende = 'strafraumfoul'; break; }
    if (r.chance(MC.eigentorRate)) { ende = 'eigentor'; break; }
    if (r.chance(duell(MC.pAbschluss * druckMod, angriffQ, abwehrQ, MC.zoneSkala))) { ende = 'schuss'; }
    else { ende = 'geklaert'; zweikampfBuchen(ms, angreifer, verteidiger, false, 3); }
    break;
  }
  if (!ende) ende = 'verloren1';

  paesseBuchen(ms, angreifer, verteidiger, zonen);
  angreifer.stats.besitzGewicht += 1 + zonen * MC.besitzZonenGewicht;

  const phasenArt = istKonter ? 'konter' : (stufe >= 2 ? 'angriff' : 'aufbau');

  /* --- Auflösung ---------------------------------------------------------- */
  switch (ende) {

    case 'schuss': {
      const kopfNeigung = MC.kopfballAnteilStrafraum * angreifer.mods.kopfballGewicht
        + (angreifer.stil === 'kick_and_rush' ? MC.kickRushKopfball : 0)
        + angreifer.mods.flankenlast / 100 * 0.25;
      const art = r.chance(clamp(kopfNeigung, 0.05, 0.62)) ? 'kopfball'
        : (r.chance(MC.volleyAnteil) ? 'volley' : 'schuss');
      const akte = schuetzeWaehlen(ms, angreifer, art);
      if (!akte) break;
      const vorlage = r.chance(MC.vorlageRate) ? vorlageWaehlen(ms, angreifer, akte) : null;
      // Beim Konter fehlen dem Gegner die Leute hinten – der Schütze hat mehr Platz.
      // Genau das ist der Handel des Konterfußballs: wenige Chancen, dafür bessere.
      const druck = clamp(28 + (abwehrQ - angriffQ) * 0.9 + r.float(-12, 22)
        - (istKonter ? MC.konterDruck : 0), 5, 95);
      if (!ms.quick && istKonter && r.chance(0.35)) {
        pushEvent(ms, {
          type: 'konter', team: angreifer.side, playerId: akte.id,
          text: fuellen(r.pick(T.konter), textDaten(ms, angreifer, verteidiger, {
            s: nam(akte.p), v: vorlage ? nam(vorlage.p) : nam(akte.p)
          })),
          at: punkte[punkte.length - 1]
        });
      }
      const kombi = !ms.quick && zonen >= 3 && r.chance(MC.kmKombinationRate);
      if (kombi && r.chance(0.5)) {
        pushEvent(ms, {
          type: 'kombination', team: angreifer.side, playerId: akte.id,
          text: fuellen(r.pick(T.kombination), textDaten(ms, angreifer, verteidiger, {
            s: nam(akte.p), v: vorlage ? nam(vorlage.p) : nam(akte.p)
          })),
          at: punkte[punkte.length - 1]
        });
      }
      const kind = (zonen >= 3 && kmErlaubt(ms, angreifer, 'kombination', 1) && r.chance(MC.kmKombinationRate))
        ? 'kombination' : null;
      const targets = kind === 'kombination'
        ? angreifer.aufDemPlatz.filter(a => a !== akte && a.pos !== 'TW').slice(0, 4).map(a => a.p)
        : [];
      yield* abschluss(ms, angreifer, verteidiger, akte, {
        art, druck, vorlage, kind, keyPrio: kind ? 1 : undefined, targets
      });
      break;
    }

    case 'distanz': {
      const akte = schuetzeWaehlen(ms, angreifer, 'schuss');
      if (!akte) break;
      const vorlage = r.chance(0.45) ? vorlageWaehlen(ms, angreifer, akte) : null;
      yield* abschluss(ms, angreifer, verteidiger, akte, {
        art: 'distanz', druck: clamp(35 + r.float(-15, 25), 5, 95), vorlage
      });
      break;
    }

    case 'abseits': {
      angreifer.stats.offsides++;
      const akte = schuetzeWaehlen(ms, angreifer, 'schuss');
      if (!ms.quick && akte) {
        const at = punkte[punkte.length - 1];
        const idx = pushEvent(ms, {
          type: 'abseits', team: angreifer.side, playerId: akte.id,
          text: fuellen(r.pick(T.abseits), textDaten(ms, angreifer, verteidiger, { s: nam(akte.p) })),
          at
        });
        bauePhase(ms, angreifer, phasenArt, punkte, 'lauf', idx);
      }
      return;
    }

    case 'strafraumfoul': {
      const taeter = zufallsSpieler(ms, verteidiger, ['ABW']);
      const opfer = zufallsSpieler(ms, angreifer, ['STU', 'MIT']);
      if (!taeter) break;
      if (r.chance(MC.elfmeterProStrafraumfoul)) {
        foulBegehen(ms, verteidiger, angreifer, taeter, opfer, 3, true);
        yield* elfmeter(ms, angreifer, verteidiger, taeter, opfer);
      } else {
        foulBegehen(ms, verteidiger, angreifer, taeter, opfer, 2, false);
        if (r.chance(MC.freistossGefaehrlich * 1.6)) {
          yield* freistoss(ms, angreifer, verteidiger, r.float(17, 24), clamp(r.gauss(0, 8), -18, 18));
        }
      }
      return;
    }

    case 'eigentor': {
      const taeter = zufallsSpieler(ms, verteidiger, ['ABW']);
      if (taeter) eigentorFallen(ms, verteidiger, angreifer, taeter);
      return;
    }

    default: {
      /* --- Ballverlust: Foul? Ecke? Einfacher Verlust? ------------------- */
      const zone = ende === 'verloren0' ? 0 : ende === 'verloren1' ? 1 : ende === 'verloren2' ? 2 : 3;
      let foulP = MC.foulProDuell
        * (1 + MC.foulHaerte * ((verteidiger.slider.haerte - 50) / 100))
        * (1 + MC.foulAggressivitaet * ((verteidiger.aggressivitaet != null ? verteidiger.aggressivitaet : 50) - 50) / 100);
      if (istKonter) foulP *= 1.5;
      if (zone >= 2) foulP *= 1.15;

      if (r.chance(foulP)) {
        const taeter = zufallsSpieler(ms, verteidiger, zone <= 1 ? ['MIT', 'STU'] : ['ABW', 'MIT']);
        const opfer = zufallsSpieler(ms, angreifer, zone <= 1 ? ['MIT', 'ABW'] : ['STU', 'MIT']);
        if (taeter) {
          foulBegehen(ms, verteidiger, angreifer, taeter, opfer, zone, istKonter && zone >= 1);
          if (zone >= 2 && r.chance(MC.freistossGefaehrlich)) {
            yield* freistoss(ms, angreifer, verteidiger, r.float(18, 29), clamp(r.gauss(0, 9), -20, 20));
            return;
          }
        }
        if (!ms.quick) bauePhase(ms, angreifer, phasenArt, punkte, 'tackling', null);
        return;
      }

      if (zone >= 2 && r.chance(MC.eckeNachAngriff * angreifer.mods.eckenFaktor)) {
        eckeGeben(ms, angreifer, verteidiger);
        if (!ms.quick) bauePhase(ms, angreifer, phasenArt, punkte, 'lauf', null);
        return;
      }

      if (!ms.quick) {
        let idx = null;
        if (zone >= 1 && r.chance(0.055)) {
          const akte = zufallsSpieler(ms, angreifer, null);
          if (akte) {
            idx = pushEvent(ms, {
              type: 'ballverlust', team: angreifer.side, playerId: akte.id,
              text: fuellen(r.pick(T.ballverlust), textDaten(ms, angreifer, verteidiger, { s: nam(akte.p) })),
              at: punkte[punkte.length - 1]
            });
          }
        }
        bauePhase(ms, angreifer, phasenArt, punkte, r.chance(0.5) ? 'pass' : 'dribbling', idx);
      }
      return;
    }
  }

  if (!ms.quick && ende !== 'schuss' && ende !== 'distanz') {
    bauePhase(ms, angreifer, phasenArt, punkte, 'pass', null);
  }
}

/* ===========================================================================
 * 11. SPIELUHR UND MINUTENSCHRITT
 * ========================================================================= */

function nachspielzeit(ms, half) {
  const u = ms.unterbrechungen;
  const b = half === 1 ? u : {
    tore: u.tore - (ms.unterbrechungen1 ? ms.unterbrechungen1.tore : 0),
    wechsel: u.wechsel - (ms.unterbrechungen1 ? ms.unterbrechungen1.wechsel : 0),
    verletzungen: u.verletzungen - (ms.unterbrechungen1 ? ms.unterbrechungen1.verletzungen : 0),
    karten: u.karten - (ms.unterbrechungen1 ? ms.unterbrechungen1.karten : 0)
  };
  let t = MC.nachBasis
    + b.tore * MC.nachProTor
    + b.wechsel * MC.nachProWechsel
    + b.verletzungen * MC.nachProVerletzung
    + b.karten * MC.nachProKarte
    + ms.rng.float(-0.4, 0.8);
  if (half === 1) t -= 0.6;
  return clamp(Math.round(t), half === 1 ? MC.nach1Min : MC.nach2Min, half === 1 ? MC.nach1Max : MC.nach2Max);
}

/** Schiebt die Uhr um eine Minute weiter. */
function uhrWeiter(ms) {
  if (ms.half === 1) {
    if (ms.addedTime === 0 && ms.minute < MC.halbzeit) { ms.minute++; return 'spielen'; }
    if (ms.nach1 == null) ms.nach1 = nachspielzeit(ms, 1);
    if (ms.addedTime < ms.nach1) { ms.addedTime++; ms.minute = MC.halbzeit; return 'spielen'; }
    return 'halbzeit';
  }
  if (ms.addedTime === 0 && ms.minute < MC.halbzeit * 2) { ms.minute++; return 'spielen'; }
  if (ms.nach2 == null) ms.nach2 = nachspielzeit(ms, 2);
  if (ms.addedTime < ms.nach2) { ms.addedTime++; ms.minute = MC.halbzeit * 2; return 'spielen'; }
  return 'ende';
}

function anpfiff(ms) {
  ms.angepfiffen = true;
  pushEvent(ms, {
    type: 'anpfiff', team: 'home',
    text: fuellen(ms.rng.pick(T.anpfiff), textDaten(ms, ms.sides.home, ms.sides.away, {})),
    at: { x: 52.5, y: 34 }
  });
  if (!ms.quick) {
    bauePhase(ms, ms.sides.home, 'aufbau',
      [{ x: 52.5, y: 34 }, { x: 44, y: 30 }, { x: 34, y: 40 }], 'pass', ms.events.length - 1);
  }
}

/** Wie viele Ballbesitzphasen laufen in dieser Minute? */
function phasenZahl(ms) {
  const r = ms.rng;
  const tempo = ((ms.sides.home.slider.tempo + ms.sides.away.slider.tempo) / 2 - 50) / 50;
  const g = MC.phasenGewichte;
  const w1 = g[0] * (1 - tempo * MC.phasenTempoWirkung);
  const w3 = g[2] * (1 + tempo * MC.phasenTempoWirkung);
  const w2 = Math.max(0.05, 1 - w1 - w3);
  const rr = r.next() * (w1 + w2 + w3);
  return rr < w1 ? 1 : (rr < w1 + w2 ? 2 : 3);
}

/**
 * Der eigentliche Minutenschritt als Generator: er `yield`t KeyMoments und
 * erwartet über `next(resolution)` die Antwort. So teilen sich die synchrone
 * quickSimulate() und die asynchrone simulateMatch() exakt denselben Code.
 */
function* minuteSteps(ms) {
  const evStart = ms.events.length;
  const phStart = ms.phases.length;
  const raus = () => ({
    events: ms.quick ? [] : ms.events.slice(evStart),
    phases: ms.quick ? [] : ms.phases.slice(phStart)
  });

  if (!ms.angepfiffen) anpfiff(ms);
  if (ms.ende) return raus();

  const status = uhrWeiter(ms);

  if (status === 'halbzeit') {
    ms.unterbrechungen1 = {
      tore: ms.unterbrechungen.tore, wechsel: ms.unterbrechungen.wechsel,
      verletzungen: ms.unterbrechungen.verletzungen, karten: ms.unterbrechungen.karten
    };
    pushEvent(ms, {
      type: 'halbzeit', team: 'home',
      text: fuellen(ms.rng.pick(T.halbzeit), textDaten(ms, ms.sides.home, ms.sides.away, {})),
      at: { x: 52.5, y: 34 }
    });
    ms.half = 2; ms.minute = MC.halbzeit; ms.addedTime = 0;
    ms.halbzeitPause = true;
    // Pausenerholung
    for (const key of ['home', 'away']) {
      for (const a of ms.sides[key].aufDemPlatz) a.frische = clamp(a.frische + 0.045, 0.2, 1);
    }
    return raus();
  }

  if (status === 'ende') {
    pushEvent(ms, {
      type: 'abpfiff', team: 'home',
      text: fuellen(ms.rng.pick(T.abpfiff), textDaten(ms, ms.sides.home, ms.sides.away, {})),
      at: { x: 52.5, y: 34 }
    });
    ms.ende = true;
    return raus();
  }

  /* --- 1. Eingriffe des Managers einlesen (CONTRACTS 6.0a) -------------- */
  leseEingriffe(ms, ms.sides.home);
  leseEingriffe(ms, ms.sides.away);

  /* --- 2. Kondition, Momentum, Stärken ---------------------------------- */
  ermuedung(ms);
  ms.momentum *= MC.momentumZerfall;
  for (const key of ['home', 'away']) {
    const seite = ms.sides[key];
    for (const a of seite.aufDemPlatz) a.minuten++;
  }
  staerkenNeu(ms.sides.home);
  staerkenNeu(ms.sides.away);

  /* --- 3. Verletzungen und KI-Wechsel ------------------------------------ */
  verletzungPruefen(ms);
  kiWechsel(ms, ms.sides.home);
  kiWechsel(ms, ms.sides.away);

  /* --- 4. Ballbesitzphasen ------------------------------------------------ */
  const n = phasenZahl(ms);
  for (let i = 0; i < n; i++) yield* phaseSpielen(ms);

  /* --- 5. onMinute ------------------------------------------------------- */
  const cb = ms.setup.onMinute;
  if (typeof cb === 'function') {
    try {
      cb(ms.minute, {
        minute: ms.minute, addedTime: ms.addedTime, half: ms.half,
        score: [ms.score[0], ms.score[1]],
        momentum: round(ms.momentum, 3)
      });
    } catch (err) { /* egal */ }
  }

  return raus();
}

/**
 * Simuliert genau eine Spielminute (synchron, ohne KeyMoments).
 * @param {object} matchState aus createMatchState()
 * @returns {{events: Array, phases: Array}} die in dieser Minute erzeugten Daten
 */
export function stepMinute(matchState) {
  const it = minuteSteps(matchState);
  let r = it.next();
  while (!r.done) r = it.next(null);
  return r.value || { events: [], phases: [] };
}

/* ===========================================================================
 * 12. AUSWERTUNG
 * ========================================================================= */

function baueStats(ms) {
  const H = ms.sides.home, Aw = ms.sides.away;
  const gh = H.stats.besitzGewicht, ga = Aw.stats.besitzGewicht;
  const g = gh + ga;
  const bh = g > 0 ? Math.round(gh / g * 100) : 50;
  const mach = (s, poss) => ({
    possession: poss,
    shots: s.shots,
    shotsOnTarget: s.shotsOnTarget,
    xg: round(s.xg, 2),
    corners: s.corners,
    fouls: s.fouls,
    offsides: s.offsides,
    passes: s.passes,
    passAccuracy: s.passes > 0 ? Math.round(s.passesOk / s.passes * 100) : 0,
    tackles: s.tackles,
    yellow: s.yellow,
    red: s.red,
    grosschancen: s.grosschancen,
    standardTore: s.standardTore
  });
  return { home: mach(H.stats, bh), away: mach(Aw.stats, 100 - bh) };
}

/** Spielernoten 1..10. */
function baueNoten(ms) {
  const noten = {};
  const [th, ta] = ms.score;
  for (const key of ['home', 'away']) {
    const seite = ms.sides[key];
    const eigene = key === 'home' ? th : ta;
    const fremde = key === 'home' ? ta : th;
    const sieg = eigene > fremde, niederlage = eigene < fremde;
    for (const a of seite.alle) {
      if (a.minuten <= 0) continue;
      let n = MC.noteBasis;
      n += a.tore * MC.noteTor;
      n += a.vorlagen * MC.noteVorlage;
      n += a.schuesseAufTor * MC.noteSchussAufTor;
      n += (a.zweikaempfeGewonnen - (a.zweikaempfe - a.zweikaempfeGewonnen)) * MC.noteZweikampf;
      n += a.xg * MC.noteXg;
      n -= Math.max(0, a.grosschancen - a.tore) * MC.noteVergeben;
      n -= a.gelb * MC.noteGelb;
      n -= a.rot * MC.noteRot;
      if (a.pos === 'TW') {
        n += a.paraden * MC.noteParade;
        n -= a.gegentore * MC.noteGegentorTw;
        if (fremde === 0) n += MC.noteZuNull;
      } else if (a.gruppe === 'ABW') {
        n -= a.gegentore * MC.noteGegentorAbwehr * 4;
        if (fremde === 0) n += MC.noteZuNull * 0.6;
      }
      if (sieg) n += MC.noteSieg;
      else if (niederlage) n -= MC.noteNiederlage;
      n += ms.rng.gauss(0, MC.noteRauschen);
      // Kurzeinsätze pendeln zur Durchschnittsnote zurück
      const gewicht = clamp(a.minuten / 30, 0.25, 1);
      n = MC.noteBasis + (n - MC.noteBasis) * gewicht;
      noten[a.id] = round(clamp(n, 1, 10), 1);
    }
  }
  return noten;
}

function baueSpielerStats(ms) {
  const out = {};
  for (const key of ['home', 'away']) {
    for (const a of ms.sides[key].alle) {
      const s = {
        minuten: a.minuten, tore: a.tore, vorlagen: a.vorlagen, schuesse: a.schuesse,
        schuesseAufTor: a.schuesseAufTor, paraden: a.paraden, gegentore: Math.round(a.gegentore),
        zweikaempfe: a.zweikaempfe, zweikaempfeGewonnen: a.zweikaempfeGewonnen,
        paesse: a.paesse, paesseAngekommen: a.paesseAn, fouls: a.fouls, gefoult: a.gefoult,
        gelb: a.gelb, gelbrot: a.gelbrot, rot: a.rot,
        xg: round(a.xg, 2), distanz: round(a.distanz, 1),
        // Alias-Namen gemäß CONTRACTS 6
        goals: a.tore, assists: a.vorlagen, shots: a.schuesse, passes: a.paesse,
        tackles: a.zweikaempfeGewonnen, saves: a.paraden, minutes: a.minuten, distance: round(a.distanz, 1)
      };
      out[a.id] = s;
    }
  }
  return out;
}

/** Spieler des Spiels. */
function baueMotm(ms, noten) {
  let best = null, bestN = -1;
  for (const key of ['home', 'away']) {
    for (const a of ms.sides[key].alle) {
      const n = noten[a.id];
      if (n == null || a.minuten < 15) continue;
      const wert = n + a.tore * 0.05;
      if (wert > bestN) { bestN = wert; best = a.id; }
    }
  }
  if (!best) {
    for (const key of ['home', 'away']) for (const a of ms.sides[key].alle) if (!best) best = a.id;
  }
  return best;
}

/** Deutscher Spielbericht, 6–12 Zeilen. */
function baueBericht(ms, stats, motmId) {
  const H = ms.sides.home, Aw = ms.sides.away;
  const hn = H.club.name || H.club.shortName;
  const an = Aw.club.name || Aw.club.shortName;
  const [th, ta] = ms.score;
  const zeilen = [];

  zeilen.push(`${hn} – ${an} ${th}:${ta} (${ms.competition.name || 'Ligaspiel'}, ${ms.venue.attendance.toLocaleString('de-DE')} Zuschauer im ${ms.venue.stadiumName}).`);
  zeilen.push(`${ms.wetter.name || 'Wechselhaft'}, ${ms.venue.temperature} Grad, Rasen in ${ms.venue.pitch >= 80 ? 'tadellosem' : ms.venue.pitch >= 60 ? 'ordentlichem' : 'erbärmlichem'} Zustand – Schiedsrichter war ${ms.referee.name}.`);

  if (th > ta) zeilen.push(`${hn} bleibt im eigenen Stadion eine Macht und nimmt die drei Punkte mit.`);
  else if (th < ta) zeilen.push(`${an} entführt die Punkte aus dem ${ms.venue.stadiumName} – für ${hn} ein bitterer Nachmittag.`);
  else zeilen.push(`Am Ende trennen sich ${hn} und ${an} mit einem gerechten Remis.`);

  const tore = ms.torschuetzen.slice(0, 8);
  if (tore.length) {
    const namen = tore.map(t => {
      const a = findeAkte(ms, t.playerId);
      return `${a ? nam(a.p) : 'Unbekannt'} (${t.minute}.${t.eigentor ? ', Eigentor' : ''})`;
    });
    zeilen.push(`Die Tore erzielten: ${namen.join(', ')}.`);
  } else {
    zeilen.push('Torlos – beide Abwehrreihen ließen schlicht nichts zu.');
  }

  zeilen.push(`Ballbesitz ${stats.home.possession}:${stats.away.possession}, Torschüsse ${stats.home.shots}:${stats.away.shots} (davon aufs Tor ${stats.home.shotsOnTarget}:${stats.away.shotsOnTarget}).`);
  zeilen.push(`Erwartete Tore: ${String(stats.home.xg).replace('.', ',')} zu ${String(stats.away.xg).replace('.', ',')} – Ecken ${stats.home.corners}:${stats.away.corners}, Fouls ${stats.home.fouls}:${stats.away.fouls}.`);

  const karten = stats.home.yellow + stats.away.yellow;
  const rote = stats.home.red + stats.away.red;
  if (rote > 0) zeilen.push(`${rote === 1 ? 'Ein Platzverweis' : rote + ' Platzverweise'} prägten die Partie, dazu ${karten} Verwarnungen.`);
  else if (karten >= 5) zeilen.push(`${karten} Gelbe Karten zeigen, wie hart hier zur Sache ging.`);
  else zeilen.push(`Der Schiedsrichter hatte die Partie mit ${karten} Verwarnungen jederzeit im Griff.`);

  const motm = findeAkte(ms, motmId);
  if (motm) {
    zeilen.push(`Spieler des Spiels: ${nam(motm.p)} – ${motm.tore > 0 ? `${motm.tore} Tor${motm.tore > 1 ? 'e' : ''}` : motm.paraden > 2 ? `${motm.paraden} Paraden` : 'ein Auftritt zum Niederknien'}.`);
  }

  const xgDiff = stats.home.xg - stats.away.xg;
  if (th > ta && xgDiff < -0.4) zeilen.push('Ein Sieg mit dem Dosenöffner: Die Statistik sprach eine ganz andere Sprache.');
  else if (th < ta && xgDiff > 0.4) zeilen.push('Die Chancenverwertung war der Unterschied – hier wurde ein Punkt fahrlässig verschenkt.');
  else if (Math.abs(xgDiff) < 0.25) zeilen.push('Ein Spiel auf Augenhöhe, bei dem beide Mannschaften mit dem Ergebnis leben können.');
  else zeilen.push('Am Ende hat die effizientere Mannschaft das Spiel für sich entschieden.');

  return zeilen.slice(0, 12);
}

function findeAkte(ms, id) {
  for (const key of ['home', 'away']) {
    for (const a of ms.sides[key].alle) if (a.id === id) return a;
  }
  return null;
}

/** Baut das MatchResult. */
function ergebnisBauen(ms) {
  const stats = baueStats(ms);
  const ratings = baueNoten(ms);
  const playerStats = baueSpielerStats(ms);
  const motm = baueMotm(ms, ratings);
  return {
    score: [ms.score[0], ms.score[1]],
    events: ms.events,
    phases: ms.phases,
    stats,
    ratings,
    playerStats,
    motm,
    attendance: ms.venue.attendance,
    summaryText: ms.quick ? [`${ms.sides.home.club.shortName} – ${ms.sides.away.club.shortName} ${ms.score[0]}:${ms.score[1]}`] : baueBericht(ms, stats, motm),
    torschuetzen: ms.torschuetzen,
    verletzte: sammleVerletzte(ms),
    keyMoments: ms.kmGenutzt,
    nachspielzeit: [ms.nach1 || 0, ms.nach2 || 0]
  };
}

function sammleVerletzte(ms) {
  const out = [];
  for (const key of ['home', 'away']) {
    for (const a of ms.sides[key].alle) {
      if (a.verletzt) out.push({ playerId: a.id, team: key, minute: a.aus != null ? a.aus : ms.minute, typ: a.verletzt.id, name: a.verletzt.name, tage: a.verletzt.tage });
    }
  }
  return out;
}

/* ===========================================================================
 * 13. ÖFFENTLICHE EINSTIEGE
 * ========================================================================= */

/**
 * Volle Simulation mit allen Live-Hooks (CONTRACTS 6).
 * @param {object} setup
 * @returns {Promise<object>} MatchResult
 */
export async function simulateMatch(setup) {
  const ms = createMatchState(setup);
  const onKeyMoment = typeof setup.onKeyMoment === 'function' ? setup.onKeyMoment : null;

  let wache = 0;
  while (!ms.ende && wache++ < 200) {
    const it = minuteSteps(ms);
    let r = it.next();
    while (!r.done) {
      const moment = r.value;
      let res = null;
      if (onKeyMoment && moment) {
        try { res = await onKeyMoment(moment); } catch (err) { res = null; }
      }
      r = it.next(res);
    }
    if (ms.halbzeitPause) {
      ms.halbzeitPause = false;
      if (typeof setup.onHalftime === 'function') {
        try {
          await setup.onHalftime({
            score: [ms.score[0], ms.score[1]],
            stats: baueStats(ms),
            ratings: baueNoten(ms)
          });
        } catch (err) { /* UI-Fehler dürfen die Sim nicht kippen */ }
      }
    }
  }
  return ergebnisBauen(ms);
}

/**
 * Schnelle, synchrone Simulation ohne Texte, Phasen und Key Moments.
 * Wird für die KI-Partien eines Spieltags benutzt (core/loop.js).
 * Muss 1000 Spiele in unter 2 Sekunden schaffen.
 *
 * @param {object} setup
 * @returns {object} MatchResult (events/phases leer)
 */
export function quickSimulate(setup) {
  const s = setup || {};
  const ms = createMatchState({
    home: s.home, away: s.away, rng: s.rng,
    venue: s.venue, referee: s.referee, difficulty: s.difficulty,
    competition: s.competition,
    // interactiveSide durchreichen: dann greifen difficulty.aiStrength und
    // difficulty.opponentFinishing auch in der Schnellsimulation.
    interactiveSide: s.interactiveSide,
    interactive: false, quick: true
  });
  let wache = 0;
  while (!ms.ende && wache++ < 200) {
    const it = minuteSteps(ms);
    let r = it.next();
    while (!r.done) r = it.next(null);
    if (ms.halbzeitPause) ms.halbzeitPause = false;
  }
  return ergebnisBauen(ms);
}

export default { simulateMatch, quickSimulate, createMatchState, stepMinute, MATCH_CONSTANTS };
