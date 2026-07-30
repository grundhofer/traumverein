/**
 * screens/taktik.js — Das Taktikbrett.
 *
 * Links das Spielfeld mit elf verschiebbaren Trikots, rechts der Papierkram:
 * Mannschaftsstärke, Chemie, Regler, Anweisungen, Rollen, Standards, Bank und
 * ein Co-Trainer, der ungefragt seine Meinung sagt.
 *
 * Vertrag: docs/CONTRACTS.md Abschnitt 12.
 * Zustand wird ausschließlich in state.clubs[managerClubId].tactics geschrieben.
 */

import {
  el, panel, button, bar, statBox, slider, pill, toast, tooltip, clearNode, table
} from '../render/ui.js';

import {
  FORMATIONS, FORMATION_IDS, STYLES, STYLE_IDS, ROLES, INSTRUCTIONS, INSTRUCTION_IDS,
  DEFAULT_SLIDERS, autoLineup, validateTactics, formationCounter, rolesForPosition,
  suggestRole, suggestTactics, slidersForStyle, slotLabel, slotLabelLong, formationLines,
  describeTactics, isInjured, isBanned
} from '../engine/tactics.js';

import {
  teamStrength, chemistry, playerRatingForSlot, positionPenalty, playerOverall
} from '../engine/ratings.js';

import { coTrainerRat } from '../club/staff.js';
import { paarChemie, eingespieltheit } from '../club/chemie.js';
import { myClub, squadOf, nextFixtureFor } from '../core/state.js';
import { POSITION_NAMES, POSITION_GROUP, TRAITS } from '../core/constants.js';
import { clamp, sortBy, deepClone } from '../core/util.js';
import { portraitDataURL } from '../render/portraits.js';
import { kitColors, drawCrest, shade } from '../render/kits.js';

/* ══════════════════════════════════════════════════════════════════════════
 * Sitzungsübergreifende Kleinigkeiten
 * ════════════════════════════════════════════════════════════════════════ */

/** Zeigt das Brett Gesichter statt blanker Trikots? */
let zeigeGesichter = true;

/** Aufräumarbeiten, die beim Verlassen des Bildschirms erledigt werden müssen. */
let aufraeumen = null;

/* ══════════════════════════════════════════════════════════════════════════
 * Kleine Helfer
 * ════════════════════════════════════════════════════════════════════════ */

/** Führt eine wackelige Berechnung aus, ohne den halben Bildschirm mitzureißen. */
function sicher(fn, fallback, label) {
  try {
    return fn();
  } catch (err) {
    console.error('[taktik] ' + (label || 'Berechnung') + ' fehlgeschlagen:', err);
    return fallback;
  }
}

/** Roter Kasten mit einer verständlichen Meldung statt eines Absturzes. */
function fehlerZeile(text) {
  return el('div.tv-taktik__fehler', {}, '⚠ ', text);
}

function attr(p, k) {
  const v = p && p.attributes ? p.attributes[k] : undefined;
  return typeof v === 'number' ? v : 50;
}

function kurzName(p) {
  if (!p) return '—';
  return p.shortName || p.lastName || p.id;
}

function istLegende(p) {
  return !!(p && p.era === 'legend');
}

function fitnessVon(p) {
  return clamp(p && typeof p.fitness === 'number' ? p.fitness : 100, 0, 100);
}

/** Trikot-Hintergrund aus den Vereinsfarben – berücksichtigt das Muster. */
function trikotHintergrund(kit) {
  const a = kit.shirt || '#888888';
  const b = kit.shirt2 || '#ffffff';
  switch (kit.pattern) {
    case 'stripes': return `repeating-linear-gradient(90deg, ${a} 0 6px, ${b} 6px 12px)`;
    case 'hoops': return `repeating-linear-gradient(0deg, ${a} 0 6px, ${b} 6px 12px)`;
    case 'halves': return `linear-gradient(90deg, ${a} 0 50%, ${b} 50% 100%)`;
    case 'sash': return `linear-gradient(135deg, ${a} 0 34%, ${b} 34% 58%, ${a} 58% 100%)`;
    case 'chest': return `linear-gradient(0deg, ${a} 0 60%, ${b} 60% 100%)`;
    default: return `linear-gradient(180deg, ${sicher(() => shade(a, 0.22), a)}, ${a})`;
  }
}

/** Prozentwert eines Multiplikators als lesbarer Text: 1.043 → „+4,3 %". */
function faktorText(f) {
  const p = (Number(f) - 1) * 100;
  const s = Math.abs(p) < 0.05 ? '0' : (Math.round(p * 10) / 10).toString().replace('.', ',');
  return (p > 0.05 ? '+' : p < -0.05 ? '' : '±') + s + ' %';
}

/** Eignungsformeln für die Standards (siehe Aufgabenstellung). */
const EIGNUNG = {
  elfmeter: (p) => attr(p, 'nervenstaerke') * 0.5 + attr(p, 'schuss') * 0.4 + attr(p, 'technik') * 0.1
    + ((p.traits || []).includes('elfmeterkiller') ? 15 : 0),
  freistoss: (p) => attr(p, 'standards') * 0.55 + attr(p, 'technik') * 0.3 + attr(p, 'schuss') * 0.15
    + ((p.traits || []).includes('freistossspezialist') ? 15 : 0),
  ecke: (p) => attr(p, 'standards') * 0.5 + attr(p, 'passspiel') * 0.35 + attr(p, 'technik') * 0.15
    + ((p.traits || []).includes('eckenspezialist') ? 15 : 0),
  kapitaen: (p) => attr(p, 'fuehrung') * 0.7 + attr(p, 'nervenstaerke') * 0.15
    + Math.min(34, p.age || 26) * 0.5
    + ((p.traits || []).includes('leader') ? 12 : 0)
    + ((p.traits || []).includes('kabinenleader') ? 8 : 0)
    - ((p.traits || []).includes('querulant') ? 18 : 0)
};

const STANDARD_FELDER = [
  { key: 'elfmeter', label: 'Elfmeter', hinweis: 'Nervenstärke & Abschluss', keinTorwart: true },
  { key: 'freistoss', label: 'Freistoß', hinweis: 'Standards & Technik', keinTorwart: true },
  { key: 'ecke', label: 'Ecke', hinweis: 'Standards & Passspiel', keinTorwart: true },
  { key: 'kapitaen', label: 'Kapitän', hinweis: 'Führung & Erfahrung', keinTorwart: false }
];

const REGLER = [
  { key: 'tempo', label: 'Tempo', links: 'Bedächtig', rechts: 'Hektisch', tip: 'Wie schnell der Ball nach vorne getragen wird. Hohes Tempo erzeugt Chancen und Fehler gleichermaßen.' },
  { key: 'breite', label: 'Spielbreite', links: 'Eng', rechts: 'Breit', tip: 'Eng = Überzahl im Zentrum, breit = Flügelspiel und weite Verlagerungen.' },
  { key: 'pressinghoehe', label: 'Pressinghöhe', links: 'Tief stehen', rechts: 'Früh stören', tip: 'Wo die Mannschaft attackiert. Früh stören kostet Körner, tief stehen kostet Nerven.' },
  { key: 'risiko', label: 'Risiko', links: 'Absichern', rechts: 'Vabanque', tip: 'Steilpässe statt Querpässe. Erhöht Chancen und Gegenchancen zugleich.' },
  { key: 'haerte', label: 'Härte', links: 'Fair', rechts: 'Rustikal', tip: 'Rustikal gewinnt Zweikämpfe – und sammelt Karten wie andere Leute Briefmarken.' },
  { key: 'offensivdrang', label: 'Offensivdrang', links: 'Abwarten', rechts: 'Alle nach vorn', tip: 'Wie viele Spieler mit nach vorne schieben. Hinten wird es dann luftig.' }
];

/* ── Eingespieltheit auf dem Brett ────────────────────────────────────────
 * Elf Spieler ergeben 55 Paare. Alle 55 auf den Rasen zu malen wäre eine
 * Wollknäuel-Grafik. Gezeigt werden deshalb nur BENACHBARTE Paare – die, die
 * im Spiel tatsächlich miteinander zu tun haben – und davon wiederum nur die
 * Ausreißer nach oben und unten. Mehr als sieben Linien liegen nie auf dem
 * Brett. */

/** Bis zu wie vielen Metern zwei Plätze noch als Nachbarn gelten. */
const NACHBAR_METER = 30;

/** Ab welcher Abweichung vom Mittel eine Verbindung überhaupt erwähnenswert ist. */
const VERBINDUNG_ABWEICHUNG = 6;

/** Höchstens so viele gute bzw. schwache Linien. */
const LINIEN_GUT = 4;
const LINIEN_SCHWACH = 3;

/** Auflösung des Linien-Bildes. 68 × 92 m im Verhältnis 1 : 10. */
const NETZ_BREITE = 680;
const NETZ_HOEHE = 920;

const BREAKDOWN_FELDER = [
  { key: 'formation', label: 'Formation' },
  { key: 'stil', label: 'Stil & Regler' },
  { key: 'moral', label: 'Moral' },
  { key: 'fitness', label: 'Fitness' },
  { key: 'form', label: 'Tagesform' },
  { key: 'chemie', label: 'Chemie' },
  { key: 'fuehrung', label: 'Führung' },
  { key: 'heimvorteil', label: 'Platzvorteil' },
  { key: 'trainer', label: 'Trainerbank' }
];

/* ══════════════════════════════════════════════════════════════════════════
 * Stylesheet (streng auf diesen Bildschirm begrenzt)
 * ════════════════════════════════════════════════════════════════════════ */

const STIL_ID = 'tv-taktik-stil';

const STIL = `
/* Die Bausteine aus render/ui.js gegen die globalen .tv-bar-/.tv-slider-Regeln
   absichern – ausschließlich innerhalb des Taktikbildschirms. */
.tv-taktik .tv-bar { height: auto; overflow: visible; background: none; border: 0; border-radius: 0; position: static; }
.tv-taktik .tv-slider { display: block; margin: 0 0 9px; }
.tv-taktik .tv-slider-kopf { display: flex; justify-content: space-between; align-items: baseline; font-size: 11.5px; }
.tv-taktik .tv-slider-label { font-weight: 700; }
.tv-taktik .tv-slider-reihe { display: flex; align-items: center; gap: 6px; }
.tv-taktik .tv-slider-pol { font-size: 9.5px; color: var(--tinte-weich); min-width: 62px; }
.tv-taktik .tv-slider-pol--rechts { text-align: right; }
.tv-taktik .tv-slider-wert { font-family: var(--font-num); font-weight: 700; }

/* Die linke Spalte darf mitwachsen, damit unter dem Brett kein toter Raum bleibt. */
.tv-taktik { align-items: stretch; }
.tv-taktik__kaderpanel { flex: 1 1 auto; min-height: 280px; }
.tv-taktik__kaderpanel .tv-panel-korpus { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.tv-taktik__kaderpanel .tv-taktik__ablage { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.tv-taktik__kaderpanel .tv-tabelle-huelle { flex: 1 1 auto; min-height: 120px; overflow: auto; }
.tv-taktik__ablagezone {
  flex: 0 0 auto; min-height: 46px; margin-top: 6px;
  display: flex; align-items: center; justify-content: center; text-align: center;
  border: 2px dashed rgba(0, 0, 0, .18); border-radius: 3px;
  color: var(--tinte-weich); font-size: 11.5px; font-style: italic; padding: 8px;
}
.tv-taktik__ablage.ziel .tv-taktik__ablagezone { border-color: var(--gold); color: var(--holz-700); }

.tv-taktik__leiste { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tv-taktik__wahl { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 4px; }
.tv-taktik__wahl button {
  display: block; width: 100%; text-align: left; cursor: pointer;
  padding: 4px 6px; border-radius: 2px;
  background: linear-gradient(180deg, var(--flaeche-hell), var(--flaeche));
  border: 2px solid transparent; box-shadow: 0 2px 0 rgba(0,0,0,.28);
  color: var(--tinte); line-height: 1.15;
}
.tv-taktik__wahl button:hover { filter: brightness(1.07); }
.tv-taktik__wahl button.gewaehlt { border-color: var(--gold); box-shadow: 0 0 8px rgba(217,165,33,.75), 0 2px 0 rgba(0,0,0,.28); }
.tv-taktik__wahl b { display: block; font-size: 11.5px; letter-spacing: .3px; }
.tv-taktik__wahl small { display: block; font-size: 9.5px; color: var(--tinte-weich); font-family: var(--font-num); }

.tv-taktik__stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
.tv-taktik__brettwrap { position: relative; display: grid; grid-template-columns: minmax(0, 560px) 158px; gap: 8px; justify-content: center; align-items: start; }
@media (max-width: 1500px) { .tv-taktik__brettwrap { grid-template-columns: minmax(0, 1fr); } }
.tv-taktik__seitenbank { display: flex; flex-direction: column; gap: 3px; }
.tv-taktik__bankspalte { flex-direction: column; align-items: stretch; }
.tv-taktik__bankspalte .tv-taktik__leerchip { min-height: 24px; height: auto; }
.tv-taktik__hinweis { font-size: 10.5px; color: var(--tinte-weich); margin-top: 6px; line-height: 1.4; }

/* Brett-Details */
.tv-taktik .tv-brett { max-width: 560px; max-height: 758px; }
.tv-taktik .tv-brett__linie, .tv-taktik .tv-brett__kreis, .tv-taktik .tv-brett__raum,
.tv-brett__punkt, .tv-brett__tor, .tv-brett__ecke { pointer-events: none; }
.tv-brett__punkt { position: absolute; width: 4px; height: 4px; margin: -2px 0 0 -2px; background: rgba(255,255,255,.8); border-radius: 50%; }
.tv-brett__tor { position: absolute; border: 2px solid rgba(255,255,255,.9); border-radius: 1px; background: rgba(255,255,255,.14); }
.tv-brett__ecke { position: absolute; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,.45); }
.tv-brett__wappen { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); opacity: .13; pointer-events: none; }
.tv-brett__marke {
  position: absolute; left: 6px; top: 5px; z-index: 4;
  font-size: 9.5px; letter-spacing: 1.2px; text-transform: uppercase;
  color: rgba(255,255,255,.55); text-shadow: 1px 1px 0 rgba(0,0,0,.6); pointer-events: none;
}
.tv-brett__marke--unten { top: auto; bottom: 5px; }

/* Slots */
.tv-taktik .tv-slot { touch-action: none; user-select: none; }
.tv-taktik .tv-slot__trikot { position: relative; padding: 0; overflow: visible; }
.tv-taktik .tv-slot--legende .tv-slot__trikot { border-color: var(--gold); box-shadow: 0 0 0 2px var(--gold), 0 2px 5px rgba(0,0,0,.6); }
.tv-taktik .tv-slot--legende .tv-slot__name { color: var(--gold-hell); }
.tv-taktik .tv-slot.ziel--aktiv .tv-slot__trikot { box-shadow: 0 0 0 4px #fff, 0 0 18px var(--gold); transform: scale(1.12); }
.tv-slot__foto { width: 100%; height: 100%; display: block; border-radius: 2px; object-fit: cover; }
.tv-slot__nr {
  position: absolute; right: -6px; bottom: -5px;
  min-width: 16px; padding: 0 3px; border-radius: 8px;
  background: rgba(20,14,6,.92); color: #ffe9a8; border: 1px solid rgba(255,255,255,.35);
  font-family: var(--font-num); font-size: 9.5px; font-weight: 700; text-align: center; line-height: 14px;
}
.tv-slot__stern { position: absolute; left: -6px; top: -6px; font-size: 11px; text-shadow: 0 0 4px rgba(0,0,0,.9); }
.tv-slot__wert {
  position: absolute; left: -8px; bottom: -5px;
  padding: 0 3px; border-radius: 2px; background: rgba(20,14,6,.85);
  font-family: var(--font-num); font-size: 9.5px; font-weight: 700; color: #fff; line-height: 14px;
}

/* Chips (Bank & Ghost) */
.tv-taktik__ablage { min-height: 40px; border-radius: 2px; padding: 3px; }
.tv-taktik__ablage.ziel { outline: 2px dashed var(--gold); outline-offset: -2px; background: rgba(217,165,33,.14); }
.tv-taktik__chip {
  display: flex; align-items: center; gap: 5px;
  padding: 2px 6px 2px 2px; border-radius: 3px;
  background: rgba(255,255,255,.4); border: 1px solid var(--linie);
  font-size: 11px; cursor: grab; touch-action: none; user-select: none; line-height: 1.15;
}
.tv-taktik__chip:hover { background: rgba(255,245,200,.75); }
.tv-taktik__chip.gewaehlt { border-color: var(--rot); box-shadow: 0 0 0 2px rgba(193,39,45,.5); }
.tv-taktik__chip.ziel--aktiv { border-color: var(--gold); box-shadow: 0 0 8px var(--gold); }
.tv-taktik__chip img { width: 22px; height: 22px; border-radius: 2px; display: block; border: 1px solid rgba(0,0,0,.35); }
.tv-taktik__chip.legende { background: linear-gradient(90deg, rgba(217,165,33,.42), rgba(255,255,255,.4) 70%); }
.tv-taktik__chip > div { min-width: 0; overflow: hidden; }
.tv-taktik__chip b { font-size: 11px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tv-taktik__chip small { display: block; font-family: var(--font-num); font-size: 9.5px; color: var(--tinte-weich); white-space: nowrap; }
.tv-taktik__leerchip {
  display: flex; align-items: center; justify-content: center;
  min-width: 46px; height: 28px; border: 1px dashed var(--linie); border-radius: 3px;
  color: var(--tinte-weich); font-size: 10px; background: rgba(0,0,0,.06);
}

.tv-taktik-ghost {
  position: fixed; z-index: 900; pointer-events: none; transform: translate(-50%, -50%);
  display: flex; align-items: center; gap: 6px; padding: 3px 9px;
  background: rgba(24,16,6,.92); color: #fff; border: 2px solid var(--gold); border-radius: 3px;
  font-size: 11.5px; font-weight: 700; box-shadow: 0 8px 20px rgba(0,0,0,.65);
}

/* Rechte Spalte */
.tv-taktik__gesamt { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; }
.tv-taktik__gesamt b { font-family: var(--font-num); font-size: 42px; line-height: .95; }
.tv-taktik__gesamt span { font-size: 11px; color: var(--tinte-weich); line-height: 1.3; }
.tv-taktik__faktor { display: grid; grid-template-columns: 88px 1fr 54px; gap: 6px; align-items: center; font-size: 11px; padding: 1px 0; }
.tv-taktik__abw { position: relative; height: 8px; background: rgba(0,0,0,.22); border-radius: 2px; overflow: hidden; }
.tv-taktik__abw::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: rgba(0,0,0,.5); }
.tv-taktik__abw i { position: absolute; top: 0; bottom: 0; display: block; }
.tv-taktik__wertrechts { font-family: var(--font-num); text-align: right; font-weight: 700; font-size: 10.5px; }
.tv-taktik__liste { margin: 3px 0 0; padding: 0; list-style: none; font-size: 11px; line-height: 1.4; }
.tv-taktik__liste li { padding: 1px 0 1px 14px; position: relative; }
.tv-taktik__liste li::before { position: absolute; left: 0; top: 1px; }
.tv-taktik__liste--gut li::before { content: '✔'; color: var(--gruen-600); }
.tv-taktik__liste--schlecht li::before { content: '✘'; color: var(--rot); }
.tv-taktik__liste--info li::before { content: '›'; color: var(--tinte-weich); font-weight: 700; }

.tv-taktik__aera { display: flex; height: 15px; border: 1px solid var(--linie); border-radius: 2px; overflow: hidden; margin: 4px 0 3px; }
/* white-space: nowrap und line-height: 1 sind kein Zierrat: Die Breite jedes
   Abschnitts ist ein Prozentsatz der Elf, also ist ein Abschnitt für „1 Legende"
   bei JEDER Fensterbreite rund 9 % breit – die Beschriftung brach dort auf zwei
   Zeilen um, und der 15 px hohe Balken schnitt die zweite ab. Jetzt bleibt es
   eine Zeile; ist der Abschnitt zu schmal, wird sie an seinem eigenen Rand
   gekappt statt in den Nachbarabschnitt zu laufen (overflow: hidden). */
.tv-taktik__aera div { display: flex; align-items: center; justify-content: center; min-width: 0; overflow: hidden;
  line-height: 1; white-space: nowrap; font-size: 9.5px; font-weight: 700; color: #fff; text-shadow: 1px 1px 0 rgba(0,0,0,.5); }

.tv-taktik__rolle { display: grid; grid-template-columns: minmax(0,1fr) 142px; gap: 5px; align-items: center; padding: 2px 0; border-bottom: 1px dotted rgba(0,0,0,.14); }
.tv-taktik__rolle > div { min-width: 0; }
.tv-taktik__rolle b { font-size: 11px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tv-taktik__rolle small { font-size: 9.5px; color: var(--tinte-weich); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tv-taktik__rolle select { font-size: 10.5px; }
.tv-taktik select {
  width: 100%; padding: 2px 4px; font-size: 11px;
  background: var(--papier); border: 1px solid var(--linie); border-radius: 2px; color: var(--tinte);
}
.tv-taktik__anw { display: grid; grid-template-columns: 16px minmax(0,1fr); gap: 5px; align-items: start; padding: 3px 0; border-bottom: 1px dotted rgba(0,0,0,.14); cursor: pointer; }
.tv-taktik__anw b { font-size: 11.5px; }
.tv-taktik__anw small { display: block; font-size: 10px; color: var(--tinte-weich); line-height: 1.35; }
.tv-taktik__anw input { margin: 2px 0 0; }

.tv-taktik__fehler { color: #7a1512; font-size: 11.5px; font-weight: 600; padding: 2px 0; line-height: 1.4; }
.tv-taktik__warn { color: #7a5600; font-size: 11.5px; padding: 2px 0; line-height: 1.4; }
.tv-taktik__ok { color: var(--gruen-700); font-size: 12px; font-weight: 700; }
.tv-taktik__zitat { font-size: 12px; line-height: 1.45; font-style: italic; }
.tv-taktik__portraet { display: flex; gap: 9px; align-items: flex-start; }
.tv-taktik__portraet img { border: 2px solid var(--holz-700); border-radius: 2px; box-shadow: 0 2px 4px rgba(0,0,0,.4); }
`;

function stilEinspielen() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STIL_ID)) return;
  const s = document.createElement('style');
  s.id = STIL_ID;
  s.textContent = STIL;
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Der Bildschirm
 * ════════════════════════════════════════════════════════════════════════ */

export const screen = {
  id: 'taktik',
  title: 'Taktik',
  icon: '📋',

  async render(root, ctx) {
    stilEinspielen();
    if (aufraeumen) { aufraeumen(); aufraeumen = null; }

    const state = ctx && ctx.state;
    if (!state || !state.clubs || !state.managerClubId) {
      root.appendChild(panel('Taktik', fehlerZeile('Es liegt kein Spielstand vor. Starten Sie zunächst eine Karriere.')));
      return;
    }

    const club = sicher(() => myClub(state), null, 'myClub');
    if (!club) {
      root.appendChild(panel('Taktik', fehlerZeile('Ihr Verein konnte im Spielstand nicht gefunden werden.')));
      return;
    }

    const kader = sicher(() => squadOf(state, club.id).filter(Boolean), [], 'squadOf');
    if (!kader.length) {
      root.appendChild(panel('Taktik', fehlerZeile('Dieser Verein hat keinen Kader – da lässt sich nichts aufstellen.')));
      return;
    }

    /* ── Taktik sicherstellen ─────────────────────────────────────────── */
    let t = normalisiere(club.tactics, kader);
    club.tactics = t;
    const rueckfall = deepClone(t);

    /* ── Umfeld: nächster Gegner (für Platzvorteil & Co-Trainer) ───────── */
    const naechstes = sicher(() => nextFixtureFor(state, club.id), null, 'nextFixtureFor');
    const heimspiel = naechstes ? naechstes.homeId === club.id : true;
    const gegnerId = naechstes ? (naechstes.homeId === club.id ? naechstes.awayId : naechstes.homeId) : null;
    const gegner = gegnerId ? state.clubs[gegnerId] : null;

    const kit = sicher(() => kitColors(club, false), { shirt: '#888', shirt2: '#fff', number: '#fff', pattern: 'plain' }, 'kitColors');

    /* ── Auswahl (Klick-Klick-Tausch) ──────────────────────────────────── */
    let auswahl = null;

    /* ══════════════════════════════════════════════════════════════════
     * Modell-Zugriffe
     * ════════════════════════════════════════════════════════════════ */

    const spieler = (id) => kader.find(p => p && p.id === id) || null;
    const formation = () => FORMATIONS[t.formation] || FORMATIONS['4-4-2'];
    const slots = () => formation().slots;

    function slotVon(pid) {
      for (const k in t.lineup) if (t.lineup[k] === pid) return k;
      return null;
    }

    function ort(pid) {
      const s = slotVon(pid);
      if (s) return { typ: 'slot', slotId: s };
      const i = t.bench.indexOf(pid);
      if (i >= 0) return { typ: 'bank', index: i };
      return { typ: 'kader' };
    }

    function entferneUeberall(pid) {
      for (const k in t.lineup) if (t.lineup[k] === pid) delete t.lineup[k];
      const i = t.bench.indexOf(pid);
      if (i >= 0) t.bench.splice(i, 1);
    }

    function setzeAn(pid, o) {
      if (!o) return;
      if (o.typ === 'slot') t.lineup[o.slotId] = pid;
      else if (o.typ === 'bank') t.bench.splice(Math.min(o.index, t.bench.length), 0, pid);
    }

    function tausche(a, b) {
      if (!a || !b || a === b) return false;
      const oa = ort(a), ob = ort(b);
      if (oa.typ === 'kader' && ob.typ === 'kader') return false;
      entferneUeberall(a);
      entferneUeberall(b);
      setzeAn(a, ob);
      setzeAn(b, oa);
      return true;
    }

    function aufSlot(pid, slotId) {
      const alt = t.lineup[slotId] || null;
      if (alt === pid) return false;
      if (alt) return tausche(pid, alt);
      entferneUeberall(pid);
      t.lineup[slotId] = pid;
      return true;
    }

    function aufBank(pid) {
      if (t.bench.includes(pid)) return false;
      if (t.bench.length >= 9) {
        toast('Die Bank fasst neun Mann. Mehr passt nicht mal mit gutem Zureden.', 'warn');
        return false;
      }
      entferneUeberall(pid);
      t.bench.push(pid);
      return true;
    }

    function ausAufstellung(pid) {
      if (ort(pid).typ === 'kader') return false;
      entferneUeberall(pid);
      return true;
    }

    /** Zentrale Ablage-Entscheidung für Klick wie für Zug. */
    function ablegen(pid, ziel) {
      if (!pid || !ziel) return false;
      if (ziel.playerId && ziel.playerId !== pid) return tausche(pid, ziel.playerId);
      if (ziel.typ === 'slot') return aufSlot(pid, ziel.slotId);
      if (ziel.typ === 'bank') return aufBank(pid);
      if (ziel.typ === 'kader') return ausAufstellung(pid);
      return false;
    }

    /* ══════════════════════════════════════════════════════════════════
     * Bewertungen
     * ════════════════════════════════════════════════════════════════ */

    function matchTeam() {
      const fitSchnitt = kader.length
        ? kader.reduce((s, p) => s + fitnessVon(p), 0) / kader.length : 100;
      let coachBonus = 50;
      const sk = state.manager && state.manager.skills;
      if (sk) coachBonus = clamp(((sk.training || 45) + (sk.taktik || 45) + (sk.motivation || 45)) / 3, 10, 95);
      return {
        club,
        players: kader,
        tactics: t,
        morale: typeof club.moral === 'number' ? club.moral : 60,
        tiredness: clamp(100 - fitSchnitt, 0, 100),
        coachBonus,
        chemistryHistory: club.chemistryHistory,
        isHome: heimspiel
      };
    }

    const LEER_STAERKE = {
      tw: 1, abwehr: 1, mittelfeld: 1, angriff: 1, gesamt: 1, chemie: 0,
      breakdown: {}, staerken: [], schwaechen: ['Die Stärke ließ sich nicht berechnen.']
    };

    function elfSpieler() {
      return slots().map(s => spieler(t.lineup[s.id])).filter(Boolean);
    }

    /**
     * Die Verbindungen der aufgestellten Elf.
     *
     * Der Wert je Paar kommt aus `club/chemie.js:paarChemie()` — für den
     * eigenen Verein aus dem gepflegten Paargitter, sonst aus Ära, Nation und
     * Altersabstand. Hier wird nur ausgewählt, welche Paare überhaupt
     * nebeneinander stehen, und was davon der Rede wert ist.
     *
     * -> { liste, mittel, gut:[], schwach:[] } — alle nach Wert sortiert.
     */
    function verbindungen() {
      const besetzt = [];
      for (const s of slots()) {
        const p = spieler(t.lineup[s.id]);
        if (p) besetzt.push({ s, p });
      }
      const liste = [];
      for (let i = 0; i < besetzt.length; i++) {
        for (let j = i + 1; j < besetzt.length; j++) {
          const a = besetzt[i], b = besetzt[j];
          const dx = (a.s.x - b.s.x) * 0.68;      // Prozent der Breite → Meter
          const dy = (a.s.y - b.s.y) * 0.92;      // Prozent der Länge  → Meter
          if (Math.sqrt(dx * dx + dy * dy) > NACHBAR_METER) continue;
          liste.push({
            a: a.p, b: b.p, sa: a.s, sb: b.s,
            wert: sicher(() => paarChemie(state, a.p.id, b.p.id), 30, 'paarChemie'),
            gemischt: istLegende(a.p) !== istLegende(b.p)
          });
        }
      }
      if (!liste.length) return { liste, mittel: 0, gut: [], schwach: [] };

      const sortiert = sortBy(liste, x => ({ key: x.wert, desc: true }));
      const mittel = liste.reduce((s, x) => s + x.wert, 0) / liste.length;
      const gut = sortiert.filter(x => x.wert >= mittel + VERBINDUNG_ABWEICHUNG).slice(0, LINIEN_GUT);
      const schwach = sortiert.slice().reverse()
        .filter(x => x.wert <= mittel - VERBINDUNG_ABWEICHUNG).slice(0, LINIEN_SCHWACH);
      return { liste: sortiert, mittel, gut, schwach };
    }

    /* ══════════════════════════════════════════════════════════════════
     * Ziehen & Ablegen (Pointer-Events – funktioniert auch mit Touch)
     * ════════════════════════════════════════════════════════════════ */

    let zug = null;
    let rollBild = null;
    let letzteY = 0;

    /**
     * Rollt die Seite mit, solange der Zeiger beim Ziehen am Rand klebt –
     * sonst käme man von der Bank nie bis zum Torwart.
     */
    function rollSchritt() {
      const behaelter = wurzel.closest('.tv-inhalt') || document.scrollingElement;
      if (!behaelter) return;
      const r = behaelter === document.scrollingElement
        ? { top: 0, bottom: window.innerHeight }
        : behaelter.getBoundingClientRect();
      const rand = 80;
      let d = 0;
      if (letzteY < r.top + rand) d = -Math.min(26, (r.top + rand - letzteY) / 2.2);
      else if (letzteY > r.bottom - rand) d = Math.min(26, (letzteY - (r.bottom - rand)) / 2.2);
      if (d) behaelter.scrollTop += d;
    }

    function mitrollen() {
      if (!zug || !zug.aktiv) { rollBild = null; return; }
      rollSchritt();
      rollBild = requestAnimationFrame(mitrollen);
    }

    function zieleMarkieren(an) {
      wurzel.querySelectorAll('[data-ziel]').forEach(k => {
        const zielfaehig = k.classList.contains('tv-slot') || k.classList.contains('tv-taktik__ablage');
        k.classList.toggle('ziel', !!an && zielfaehig);
        if (!an) k.classList.remove('ziel--aktiv');
      });
    }

    function zielAusPunkt(x, y) {
      if (typeof document === 'undefined') return null;
      const unten = document.elementFromPoint(x, y);
      if (!unten) return null;
      const treffer = unten.closest('[data-ziel]');
      if (!treffer) return null;
      const art = treffer.dataset.ziel;
      if (art && art.startsWith('slot:')) {
        return { knoten: treffer, typ: 'slot', slotId: art.slice(5), playerId: treffer.dataset.spieler || null };
      }
      if (art === 'kader') {
        const zeile = unten.closest('tr[data-i]');
        let pid = treffer.dataset.spieler || null;
        if (zeile && kaderTabelle && kaderTabelle.tvRows) {
          const r = kaderTabelle.tvRows()[Number(zeile.dataset.i)];
          if (r && r.id) pid = r.id;
        }
        return { knoten: treffer, typ: 'kader', playerId: pid };
      }
      return { knoten: treffer, typ: art, playerId: treffer.dataset.spieler || null };
    }

    function zugBeenden() {
      if (rollBild) { cancelAnimationFrame(rollBild); rollBild = null; }
      if (zug && zug.ghost && zug.ghost.parentNode) zug.ghost.parentNode.removeChild(zug.ghost);
      if (zug && zug.letztesZiel) zug.letztesZiel.classList.remove('ziel--aktiv');
      zieleMarkieren(false);
      zug = null;
    }

    function beiBewegung(ev) {
      if (!zug) return;
      letzteY = ev.clientY;
      const dx = ev.clientX - zug.startX;
      const dy = ev.clientY - zug.startY;
      if (!zug.aktiv) {
        if (dx * dx + dy * dy < 25) return;
        zug.aktiv = true;
        if (!rollBild) rollBild = requestAnimationFrame(mitrollen);
        const p = spieler(zug.playerId);
        zug.ghost = el('div.tv-taktik-ghost', {},
          el('span', { style: { fontFamily: 'var(--font-num)' } }, String(p && p.number !== undefined ? p.number : '–')),
          kurzName(p));
        document.body.appendChild(zug.ghost);
        zieleMarkieren(true);
      }
      zug.ghost.style.left = ev.clientX + 'px';
      zug.ghost.style.top = (ev.clientY - 26) + 'px';
      rollSchritt();
      const ziel = zielAusPunkt(ev.clientX, ev.clientY);
      if (zug.letztesZiel) zug.letztesZiel.classList.remove('ziel--aktiv');
      zug.letztesZiel = ziel ? ziel.knoten : null;
      if (zug.letztesZiel) zug.letztesZiel.classList.add('ziel--aktiv');
      ev.preventDefault();
    }

    function beiLoslassen(ev) {
      if (!zug) return;
      const war = zug;
      const ziel = war.aktiv ? zielAusPunkt(ev.clientX, ev.clientY) : null;
      zugBeenden();
      window.removeEventListener('pointermove', beiBewegung);
      window.removeEventListener('pointerup', beiLoslassen);
      window.removeEventListener('pointercancel', beiAbbruch);

      if (war.aktiv) {
        const hatteAuswahl = auswahl !== null;
        auswahl = null;
        if (ziel && ablegen(war.playerId, ziel)) nachAenderung();
        else if (hatteAuswahl) auswahlZeichnen();
        zeichneAuswahl();
        return;
      }
      // Kein Zug, sondern ein Klick → Klick-Klick-Tausch
      klickZiel(war.playerId, war.quelle);
    }

    function beiAbbruch() {
      zugBeenden();
      window.removeEventListener('pointermove', beiBewegung);
      window.removeEventListener('pointerup', beiLoslassen);
      window.removeEventListener('pointercancel', beiAbbruch);
    }

    function zugStarten(ev, playerId, quelle) {
      if (ev.button !== undefined && ev.button !== 0) return;
      zug = { playerId, quelle, startX: ev.clientX, startY: ev.clientY, aktiv: false, ghost: null, letztesZiel: null };
      window.addEventListener('pointermove', beiBewegung);
      window.addEventListener('pointerup', beiLoslassen);
      window.addEventListener('pointercancel', beiAbbruch);
    }

    /** Klick auf einen Spieler oder einen leeren Slot. */
    function klickZiel(playerId, quelle) {
      if (auswahl && playerId && auswahl === playerId) { auswahl = null; zeichneAuswahl(); return; }
      if (auswahl) {
        const ziel = playerId
          ? { typ: quelle.typ, slotId: quelle.slotId, playerId }
          : { typ: quelle.typ, slotId: quelle.slotId };
        const gewaehlt = auswahl;
        auswahl = null;
        if (ablegen(gewaehlt, ziel)) nachAenderung();
        else auswahlZeichnen();
        zeichneAuswahl();
        return;
      }
      if (playerId) {
        auswahl = playerId;
        auswahlZeichnen();
        zeichneAuswahl();
      }
    }

    /** Zeichnet alle Listen neu, in denen die Auswahl hervorgehoben wird. */
    function auswahlZeichnen() {
      zeichneBrett();
      zeichneStartelf();
      zeichneBank();
      zeichneKader();
    }

    /** Hängt Zieh- und Klickverhalten an ein Element. */
    function beweglich(node, playerId, quelle) {
      node.addEventListener('pointerdown', (ev) => zugStarten(ev, playerId, quelle));
      return node;
    }

    /* ══════════════════════════════════════════════════════════════════
     * Aktionen
     * ════════════════════════════════════════════════════════════════ */

    function nachAenderung() {
      club.tactics = t;
      sicher(() => ctx.aktualisiere && ctx.aktualisiere(), null, 'aktualisiere');
      zeichneBrett();
      zeichneStartelf();
      zeichneBank();
      zeichneKader();
      zeichneStaerke();
      zeichneChemie();
      zeichneRollen();
      zeichneStandards();
      zeichnePruefung();
      zeichneKopfstats();
      zeichneAuswahl();
      formationsKnoepfeAktualisieren();
    }

    function formationSetzen(id) {
      if (!FORMATIONS[id]) return;
      t.formation = id;
      const elf = elfSpieler();
      if (elf.length === 11) {
        const neu = sicher(() => autoLineup(elf, Object.assign({}, t, { formation: id }), { respectFitness: false }), null, 'autoLineup/Formation');
        if (neu && neu.lineup) t.lineup = neu.lineup;
      }
      toast(`Grundordnung: ${FORMATIONS[id].name}.`, 'info');
      nachAenderung();
    }

    function stilSetzen(id, mitReglern) {
      if (!STYLES[id]) return;
      t.style = id;
      if (mitReglern) {
        const s = sicher(() => slidersForStyle(id), null, 'slidersForStyle');
        if (s) { t.sliders = Object.assign({}, DEFAULT_SLIDERS, s); reglerAktualisieren(); }
      }
      toast(`Spielstil: ${STYLES[id].name}.`, 'info');
      nachAenderung();
    }

    function elfAufstellen(rotation) {
      const neu = sicher(() => autoLineup(kader, t, { respectFitness: true, rotation: !!rotation }), null, 'autoLineup');
      if (!neu) { toast('Die Automatik hat sich verschluckt – bitte von Hand aufstellen.', 'schlecht'); return; }
      t = normalisiere(neu, kader);
      club.tactics = t;
      reglerAktualisieren();
      anweisungenAktualisieren();
      toast(rotation
        ? 'Rotation: Die frischen Beine dürfen ran.'
        : 'Der Computer hat die stärkste Elf gestellt. Widersprechen dürfen Sie trotzdem.', 'gut');
      nachAenderung();
    }

    function zuruecksetzen() {
      t = normalisiere(deepClone(rueckfall), kader);
      club.tactics = t;
      auswahl = null;
      reglerAktualisieren();
      anweisungenAktualisieren();
      toast('Alles auf Anfang. Als wäre nichts gewesen.', 'info');
      nachAenderung();
    }

    /* ══════════════════════════════════════════════════════════════════
     * AUFBAU DER OBERFLÄCHE
     * ════════════════════════════════════════════════════════════════ */

    const wurzel = el('div.tv-seite');

    wurzel.appendChild(el('div.tv-seite__kopf', {},
      el('h1.tv-seite__titel', {}, 'Taktik'),
      el('span.tv-seite__unter', {},
        gegner
          ? `Nächstes Spiel: ${heimspiel ? 'gegen' : 'bei'} ${gegner.name}${heimspiel ? ' (Heim)' : ' (Auswärts)'}`
          : 'Kein Spiel in Sicht – Zeit für Experimente.')));

    const raster = el('div.tv-taktik');
    wurzel.appendChild(raster);

    const links = el('div.tv-spalte');
    const rechts = el('div.tv-spalte');
    raster.appendChild(links);
    raster.appendChild(rechts);

    /* ── Panel: Grundordnung ───────────────────────────────────────────── */

    const formationsKnoepfe = new Map();
    const stilKnoepfe = new Map();

    const formWahl = el('div.tv-taktik__wahl');
    for (const id of FORMATION_IDS) {
      const f = FORMATIONS[id];
      const linien = sicher(() => formationLines(id), { abwehr: 0, mittelfeld: 0, sturm: 0 }, 'formationLines');
      const konter = sicher(() => formationCounter(id), null, 'formationCounter');
      const b = el('button', {
        type: 'button',
        onclick: () => formationSetzen(id)
      }, el('b', {}, f.name), el('small', {}, `${linien.abwehr}-${linien.mittelfeld}-${linien.sturm} · Def ${f.defensivwert} · Off ${f.offensivwert}`));
      tooltip(b, `${f.desc}\n\nStärken: ${f.staerken.join(', ')}.\nSchwächen: ${f.schwaechen.join(', ')}.\nRisiko ${f.risiko}, Breite ${f.breite}, Kompaktheit ${f.kompaktheit}.` +
        (konter && konter.erklaerung ? `\n\n${konter.erklaerung}` : ''));
      formationsKnoepfe.set(id, b);
      formWahl.appendChild(b);
    }

    const stilWahl = el('div.tv-taktik__wahl');
    for (const id of STYLE_IDS) {
      const s = STYLES[id];
      const m = s.mods || {};
      const b = el('button', {
        type: 'button',
        onclick: () => stilSetzen(id, true)
      }, el('b', {}, s.name), el('small', {}, `Tempo ${m.tempo} · Press ${m.pressinghoehe}`));
      tooltip(b, `${s.desc}\n\nPasst zu: ${s.passtZu}\nChancen ×${m.chancenRate} · Gegenchancen ×${m.gegenchancenRate} · Kraftaufwand ×${m.ausdauerkosten}`);
      stilKnoepfe.set(id, b);
      stilWahl.appendChild(b);
    }

    function formationsKnoepfeAktualisieren() {
      formationsKnoepfe.forEach((b, id) => b.classList.toggle('gewaehlt', id === t.formation));
      stilKnoepfe.forEach((b, id) => b.classList.toggle('gewaehlt', id === t.style));
      if (ordnungExtra) ordnungExtra.textContent = sicher(() => describeTactics(t), '', 'describeTactics');
    }

    const ordnungExtra = el('span.tv-panel__extra');

    const werkzeuge = el('div.tv-taktik__leiste', {},
      button('Beste Elf', () => elfAufstellen(false), { kind: 'primary', size: 'klein', tooltip: 'Der Computer stellt die stärkste verfügbare Elf – inklusive Bank, Rollen und Schützen.' }),
      button('Rotation', () => elfAufstellen(true), { kind: 'blau', size: 'klein', tooltip: 'Wie „Beste Elf", aber frische Beine werden bevorzugt. Für englische Wochen.' }),
      button('Zurücksetzen', () => zuruecksetzen(), { kind: 'ghost', size: 'klein', tooltip: 'Verwirft alle Änderungen, die Sie seit dem Öffnen dieses Bildschirms gemacht haben.' }),
      button(zeigeGesichter ? 'Trikots zeigen' : 'Gesichter zeigen', (ev) => {
        zeigeGesichter = !zeigeGesichter;
        ev.currentTarget.querySelector('.tv-btn-text').textContent = zeigeGesichter ? 'Trikots zeigen' : 'Gesichter zeigen';
        zeichneBrett();
      }, { kind: 'gold', size: 'klein', tooltip: 'Umschalten zwischen Konterfei und blankem Trikot.' }));

    const ordnungPanel = tafel('Grundordnung & Spielstil', ordnungExtra,
      el('div.tv-subpanel__titel', {}, 'Formation'),
      formWahl,
      el('div.tv-subpanel__titel', { style: { marginTop: '8px' } }, 'Spielstil'),
      stilWahl,
      el('div', { style: { marginTop: '8px' } }, werkzeuge));
    links.appendChild(ordnungPanel);

    /* ── Panel: Taktikbrett ────────────────────────────────────────────── */

    const kopfstats = el('div.tv-taktik__stats');
    const brett = el('div.tv-brett');
    const netz = el('canvas.tv-brett__netz', { width: NETZ_BREITE, height: NETZ_HOEHE });
    const brettPanelExtra = el('span.tv-panel__extra');
    const seitenbank = el('div.tv-bank.tv-taktik__ablage.tv-taktik__bankspalte', { dataset: { ziel: 'bank' } });
    const seitenbankTitel = el('div.tv-subpanel__titel', {}, 'Bank');

    const brettPanel = tafel('Taktikbrett', brettPanelExtra,
      kopfstats,
      el('div.tv-taktik__brettwrap', {}, brett,
        el('aside.tv-taktik__seitenbank', {}, seitenbankTitel, seitenbank)),
      el('div.tv-taktik__hinweis', {},
        'Ziehen Sie die Trikots mit der Maus – oder klicken Sie erst den einen, dann den anderen Spieler. ',
        'Das ⚠ am Trikot bedeutet: Der Mann steht falsch, ist angeschlagen oder gesperrt. ',
        'Die goldenen Linien zeigen Nachbarn, die sich blind finden, die roten gestrichelten die, ',
        'die noch aneinander vorbeispielen.'));
    links.appendChild(brettPanel);

    brettFeldzeichnung(brett, club);
    // Nach der Feldzeichnung, denn die räumt das Brett zuerst leer.
    brett.appendChild(netz);

    /* ── Panel: Prüfung ────────────────────────────────────────────────── */

    const pruefungKoerper = el('div.tv-spalte', { style: { gap: '2px' } });
    const pruefungExtra = el('span.tv-panel__extra');
    links.appendChild(tafel('Aufstellungsprüfung', pruefungExtra, pruefungKoerper));

    /* ── Panel: Startelf in Zahlen ─────────────────────────────────────── */

    const startelfKoerper = el('div');
    const startelfExtra = el('span.tv-panel__extra');
    links.appendChild(tafel('Die Elf in Zahlen', startelfExtra, startelfKoerper));

    /* ── Panel: Kader ──────────────────────────────────────────────────── */

    const kaderKoerper = el('div.tv-taktik__ablage', { dataset: { ziel: 'kader' } });
    const kaderExtra = el('span.tv-panel__extra');
    let kaderTabelle = null;
    const kaderPanel = tafel('Kader – nicht in der Startelf', kaderExtra, kaderKoerper);
    kaderPanel.classList.add('tv-taktik__kaderpanel');
    links.appendChild(kaderPanel);

    /* ── Rechte Spalte ─────────────────────────────────────────────────── */

    const auswahlKoerper = el('div');
    rechts.appendChild(tafel('Spieler', null, auswahlKoerper));

    const staerkeKoerper = el('div');
    const staerkeExtra = el('span.tv-panel__extra');
    rechts.appendChild(tafel('Mannschaftsstärke', staerkeExtra, staerkeKoerper));

    const chemieKoerper = el('div');
    rechts.appendChild(tafel('Chemie', null, chemieKoerper));

    const reglerKoerper = el('div');
    rechts.appendChild(tafel('Regler', null, reglerKoerper));

    const anweisungKoerper = el('div');
    rechts.appendChild(tafel('Anweisungen', null, anweisungKoerper));

    const rollenKoerper = el('div');
    rechts.appendChild(tafel('Rollen', null, rollenKoerper));

    const standardKoerper = el('div');
    rechts.appendChild(tafel('Standards', null, standardKoerper));

    const bankKoerper = el('div');
    const bankExtra = el('span.tv-panel__extra');
    rechts.appendChild(tafel('Ersatzbank', bankExtra, bankKoerper));

    const coKoerper = el('div');
    rechts.appendChild(tafel('Der Co-Trainer rät', null, coKoerper));

    /* ══════════════════════════════════════════════════════════════════
     * ZEICHENROUTINEN
     * ════════════════════════════════════════════════════════════════ */

    /* ── Kopfzahlen über dem Brett ─────────────────────────────────────── */
    function zeichneKopfstats() {
      clearNode(kopfstats);
      const ms = sicher(() => teamStrength(matchTeam()), LEER_STAERKE, 'teamStrength');
      const elf = elfSpieler();
      const legenden = elf.filter(istLegende).length;
      const fit = elf.length ? Math.round(elf.reduce((s, p) => s + fitnessVon(p), 0) / elf.length) : 0;
      const form = elf.length ? Math.round(elf.reduce((s, p) => s + (typeof p.form === 'number' ? p.form : 50), 0) / elf.length) : 0;

      kopfstats.appendChild(statBox('Gesamtstärke', String(Math.round(ms.gesamt)), {
        kind: ms.gesamt >= 75 ? 'gut' : ms.gesamt < 55 ? 'warn' : null,
        sub: `${elf.length} / 11 besetzt`,
        tooltip: 'Alles zusammengerechnet: Spielerstärke, Positionen, Form, Fitness, Moral, Chemie und Taktik.'
      }));
      kopfstats.appendChild(statBox('Chemie', String(Math.round(ms.chemie)), {
        kind: ms.chemie >= 70 ? 'gut' : ms.chemie < 45 ? 'schlecht' : null,
        sub: `${legenden} Legende${legenden === 1 ? '' : 'n'} in der Elf`,
        tooltip: 'Wie gut die Truppe harmoniert. Legenden und moderne Profis müssen sich erst zusammenraufen.'
      }));
      kopfstats.appendChild(statBox('Ø Fitness', fit + ' %', {
        kind: fit >= 88 ? 'gut' : fit < 75 ? 'warn' : null,
        sub: 'der Startelf',
        tooltip: 'Unter 70 % gibt es eine Warnung am Trikot.'
      }));
      kopfstats.appendChild(statBox('Ø Form', String(form), {
        kind: form >= 60 ? 'gut' : form < 42 ? 'warn' : null,
        sub: 'Tagesform 0–100',
        tooltip: 'Die Tagesform schwankt mit Training, Einsatzzeit und Ergebnissen.'
      }));

      brettPanelExtra.textContent = `${formation().name} · ${(STYLES[t.style] || {}).name || t.style}`;
    }

    /* ── Das Brett ─────────────────────────────────────────────────────── */
    function zeichneBrett() {
      // Nur die Slots ersetzen, die Feldzeichnung bleibt stehen.
      brett.querySelectorAll('.tv-slot').forEach(n => n.remove());
      const f = formation();
      for (const s of f.slots) {
        const pid = t.lineup[s.id] || null;
        const p = pid ? spieler(pid) : null;
        brett.appendChild(slotKnoten(s, p));
      }
      zeichneNetz();
    }

    /**
     * Die Eingespieltheits-Linien auf dem Rasen.
     *
     * Absichtlich karg: höchstens vier goldene und drei rote Striche, alle
     * zwischen Nachbarn, beide Enden um eine Trikotbreite eingezogen, damit
     * kein Strich unter einem Gesicht hervorlugt. Wer alles sehen will, findet
     * das vollständige Gitter in der Vereinsakte.
     */
    function zeichneNetz() {
      const ctx2 = sicher(() => netz.getContext('2d'), null, 'Netz-Kontext');
      if (!ctx2) return;
      ctx2.clearRect(0, 0, NETZ_BREITE, NETZ_HOEHE);

      const v = sicher(() => verbindungen(), { gut: [], schwach: [] }, 'Verbindungen');
      // Dieselbe Klammer wie in slotKnoten(), sonst treffen die Linien daneben.
      const px = s => (clamp(s.x, 6, 94) / 100) * NETZ_BREITE;
      const py = s => (1 - clamp(s.y, 4, 94) / 100) * NETZ_HOEHE;

      const strich = (paar, farbe, breite, muster) => {
        const x1 = px(paar.sa), y1 = py(paar.sa);
        const x2 = px(paar.sb), y2 = py(paar.sb);
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 60) return;                    // zu dicht beieinander, das wird nur ein Punkt
        const ein = 26 / len;                    // beide Enden einziehen
        ctx2.beginPath();
        ctx2.setLineDash(muster);
        ctx2.strokeStyle = farbe;
        ctx2.lineWidth = breite;
        ctx2.lineCap = 'round';
        ctx2.moveTo(x1 + dx * ein, y1 + dy * ein);
        ctx2.lineTo(x2 - dx * ein, y2 - dy * ein);
        ctx2.stroke();
      };

      for (const paar of (v.schwach || [])) strich(paar, 'rgba(224, 75, 75, .78)', 2.6, [12, 10]);
      for (const paar of (v.gut || [])) strich(paar, 'rgba(240, 201, 86, .82)', 2.6, []);
      ctx2.setLineDash([]);
    }

    function slotKnoten(s, p) {
      const warnungen = p ? slotWarnungen(p, s) : [];
      const knoten = el('div.tv-slot', {
        style: { left: clamp(s.x, 6, 94) + '%', bottom: clamp(s.y, 4, 94) + '%' },
        dataset: { ziel: 'slot:' + s.id, spieler: p ? p.id : '' },
        class: [p ? null : 'leer', p && istLegende(p) ? 'tv-slot--legende' : null,
          p && auswahl === p.id ? 'gewaehlt' : null]
      });

      const trikot = el('div.tv-slot__trikot', {
        style: {
          background: p ? trikotHintergrund(kit) : 'rgba(255,255,255,.18)',
          color: kit.number || '#fff'
        }
      });

      if (p) {
        const nummer = p.number !== undefined && p.number !== null ? String(p.number) : '–';
        if (zeigeGesichter) {
          const url = sicher(() => portraitDataURL(p, 72, { club, age: p.age }), '', 'portrait');
          if (url) trikot.appendChild(el('img.tv-slot__foto', { src: url, alt: kurzName(p) }));
          else trikot.appendChild(el('span', {}, nummer));
          trikot.appendChild(el('span.tv-slot__nr', {}, nummer));
        } else {
          trikot.appendChild(el('span', {}, nummer));
        }
        const wert = sicher(() => Math.round(playerRatingForSlot(p, s.pos)), 0, 'playerRatingForSlot');
        trikot.appendChild(el('span.tv-slot__wert', {}, String(wert)));
        if (istLegende(p)) trikot.appendChild(el('span.tv-slot__stern', {}, '★'));
      }

      knoten.appendChild(trikot);
      knoten.appendChild(el('div.tv-slot__name', {}, p ? kurzName(p) : 'frei'));
      knoten.appendChild(el('div.tv-slot__pos', {}, slotLabel(s)));

      if (warnungen.length) {
        const w = el('span.tv-slot__warn', {}, '⚠');
        tooltip(w, warnungen.join('\n'));
        knoten.appendChild(w);
      }

      if (p) {
        const rolle = t.roles && t.roles[p.id] ? ROLES[t.roles[p.id]] : null;
        tooltip(knoten, `${p.firstName ? p.firstName + ' ' : ''}${p.lastName || kurzName(p)} · ${slotLabelLong(s)}\n` +
          `Gelernt: ${POSITION_NAMES[p.position] || p.position}${(p.altPositions || []).length ? ' (auch ' + p.altPositions.join(', ') + ')' : ''}\n` +
          `Stärke hier ${Math.round(sicher(() => playerRatingForSlot(p, s.pos), 0))} · Grundstärke ${sicher(() => playerOverall(p), 0)}\n` +
          `Form ${Math.round(p.form || 0)} · Fitness ${Math.round(fitnessVon(p))} % · Moral ${Math.round(p.morale || 0)}\n` +
          (rolle ? `Rolle: ${rolle.name}\n` : '') +
          (istLegende(p) ? `${p.eraLabel || 'Legende'}\n` : '') +
          (warnungen.length ? '\n⚠ ' + warnungen.join('\n⚠ ') : ''));
        beweglich(knoten, p.id, { typ: 'slot', slotId: s.id });
      } else {
        knoten.addEventListener('pointerdown', (ev) => {
          if (ev.button !== undefined && ev.button !== 0) return;
          klickZiel(null, { typ: 'slot', slotId: s.id });
        });
        tooltip(knoten, `${slotLabelLong(s)} – unbesetzt. Ziehen Sie jemanden hierher, sonst spielen wir zu zehnt.`);
      }
      return knoten;
    }

    function slotWarnungen(p, s) {
      const w = [];
      if (isInjured(p)) {
        const inj = p.injury || {};
        w.push(`Verletzt: ${inj.name || 'unklar'}${inj.tageRest ? ` (noch ${inj.tageRest} Tage)` : ''}`);
      }
      if (isBanned(p)) w.push(`Gesperrt für ${p.cards.ban} Spiel${p.cards.ban > 1 ? 'e' : ''}`);
      const fit = fitnessVon(p);
      if (fit < 70) w.push(`Nur ${Math.round(fit)} % Fitness – dem gehen die Körner aus`);
      const pen = sicher(() => positionPenalty(p, s.pos), 1, 'positionPenalty');
      if (pen < 0.8) {
        w.push(`Spielt als ${slotLabelLong(s)} außer Position (gelernt: ${POSITION_NAMES[p.position] || p.position})`);
      }
      return w;
    }

    /* ── Ausgewählter Spieler ──────────────────────────────────────────── */
    function zeichneAuswahl() {
      clearNode(auswahlKoerper);
      const p = auswahl ? spieler(auswahl) : null;
      if (!p) {
        auswahlKoerper.appendChild(el('div.tv-mini', {},
          'Klicken Sie einen Spieler an: Erst der eine, dann der andere – schon haben die beiden die Plätze getauscht. ',
          'Ziehen geht natürlich auch.'));
        return;
      }
      const s = slotVon(p.id);
      const slotObj = s ? slots().find(x => x.id === s) : null;
      const url = sicher(() => portraitDataURL(p, 88, { club, age: p.age }), '', 'portrait');
      const wo = slotObj ? slotLabelLong(slotObj) : (t.bench.includes(p.id) ? 'Ersatzbank' : 'nicht nominiert');

      auswahlKoerper.appendChild(el('div.tv-taktik__portraet', {},
        url ? el('img', { src: url, width: 68, height: 68, alt: kurzName(p) }) : null,
        el('div', { style: { minWidth: 0, flex: '1' } },
          el('div', { style: { fontWeight: '700', fontSize: '14px', lineHeight: '1.15' } },
            `${p.firstName || ''} ${p.lastName || kurzName(p)}`.trim()),
          el('div.tv-mini', {}, `${POSITION_NAMES[p.position] || p.position} · ${p.age || '?'} Jahre · Nr. ${p.number !== undefined ? p.number : '–'}`),
          el('div.tv-zeile', { style: { flexWrap: 'wrap', gap: '3px', marginTop: '3px' } },
            pill(String(sicher(() => playerOverall(p), 0)), 'info'),
            istLegende(p) ? pill(p.eraLabel || 'Legende', 'legende') : null,
            ...(p.traits || []).slice(0, 2).map(k => pill((TRAITS[k] && TRAITS[k].name) || k, 'warn'))),
          el('div.tv-mini', { style: { marginTop: '3px' } }, `Aktuell: ${wo}`))));

      const werte = el('div', { style: { marginTop: '6px' } });
      werte.appendChild(bar(p.form || 0, 100, { label: 'Form', height: 8 }));
      werte.appendChild(bar(fitnessVon(p), 100, { label: 'Fitness', height: 8 }));
      werte.appendChild(bar(p.morale || 0, 100, { label: 'Moral', height: 8 }));
      werte.appendChild(bar(p.sharpness || 0, 100, { label: 'Spielpraxis', height: 8 }));
      if (slotObj) {
        werte.appendChild(bar(sicher(() => playerRatingForSlot(p, slotObj.pos), 0), 99, {
          label: 'Stärke auf ' + slotLabel(slotObj), height: 8
        }));
      }
      auswahlKoerper.appendChild(werte);

      const w = slotObj ? slotWarnungen(p, slotObj) : [];
      if (w.length) {
        auswahlKoerper.appendChild(el('ul.tv-taktik__liste.tv-taktik__liste--schlecht', {},
          ...w.map(x => el('li', {}, x))));
      }
    }

    /* ── Mannschaftsstärke ─────────────────────────────────────────────── */
    function zeichneStaerke() {
      clearNode(staerkeKoerper);
      const ms = sicher(() => teamStrength(matchTeam()), null, 'teamStrength');
      if (!ms) {
        staerkeKoerper.appendChild(fehlerZeile('Die Mannschaftsstärke ließ sich nicht berechnen. Steht überhaupt eine Elf auf dem Platz?'));
        return;
      }
      staerkeExtra.textContent = heimspiel ? 'Heimspiel' : 'Auswärtsspiel';

      const note = ms.gesamt >= 80 ? 'Titelreif.'
        : ms.gesamt >= 70 ? 'Oberes Drittel.'
          : ms.gesamt >= 60 ? 'Solides Mittelmaß.'
            : ms.gesamt >= 50 ? 'Da geht mehr.'
              : 'Das wird eine lange Saison.';

      staerkeKoerper.appendChild(el('div.tv-taktik__gesamt', {},
        el('b', { class: ratklasse(ms.gesamt) }, String(Math.round(ms.gesamt))),
        el('span', {}, el('b', { style: { fontSize: '12px', display: 'block' } }, note),
          `Rohstärke ${ms.breakdown && ms.breakdown.basis !== undefined ? ms.breakdown.basis : '?'} · Taktikfaktor ${ms.taktikBonus !== undefined ? ms.taktikBonus : '–'}`)));

      const teile = el('div');
      teile.appendChild(bar(ms.tw, 99, { label: 'Tor', valueText: String(ms.tw), height: 9 }));
      teile.appendChild(bar(ms.abwehr, 99, { label: 'Abwehr', valueText: String(ms.abwehr), height: 9 }));
      teile.appendChild(bar(ms.mittelfeld, 99, { label: 'Mittelfeld', valueText: String(ms.mittelfeld), height: 9 }));
      teile.appendChild(bar(ms.angriff, 99, { label: 'Angriff', valueText: String(ms.angriff), height: 9 }));
      staerkeKoerper.appendChild(teile);

      staerkeKoerper.appendChild(el('div.tv-subpanel__titel', { style: { marginTop: '8px' } }, 'Was die Stärke bewegt'));
      const bd = ms.breakdown || {};
      for (const feld of BREAKDOWN_FELDER) {
        const f = bd[feld.key];
        if (typeof f !== 'number') continue;
        const p = (f - 1) * 100;
        const breite = clamp(Math.abs(p) * 3.2, 0, 50);
        const gut = p >= 0;
        staerkeKoerper.appendChild(el('div.tv-taktik__faktor', {},
          el('span', {}, feld.label),
          el('div.tv-taktik__abw', {}, el('i', {
            style: {
              left: gut ? '50%' : (50 - breite) + '%',
              width: breite + '%',
              background: Math.abs(p) < 0.1 ? 'transparent' : (gut ? 'var(--gruen-500)' : 'var(--rot)')
            }
          })),
          el('span.tv-taktik__wertrechts', { class: p > 0.05 ? 'tv-gut' : p < -0.05 ? 'tv-schlecht' : '' }, faktorText(f))));
      }

      if (ms.staerken && ms.staerken.length) {
        staerkeKoerper.appendChild(el('div.tv-subpanel__titel', { style: { marginTop: '8px' } }, 'Stärken'));
        staerkeKoerper.appendChild(el('ul.tv-taktik__liste.tv-taktik__liste--gut', {},
          ...ms.staerken.map(x => el('li', {}, x))));
      }
      staerkeKoerper.appendChild(el('div.tv-subpanel__titel', { style: { marginTop: '8px' } }, 'Schwächen'));
      if (ms.schwaechen && ms.schwaechen.length) {
        staerkeKoerper.appendChild(el('ul.tv-taktik__liste.tv-taktik__liste--schlecht', {},
          ...ms.schwaechen.map(x => el('li', {}, x))));
      } else {
        staerkeKoerper.appendChild(el('div.tv-taktik__ok', {}, 'Keine. Der Co-Trainer sucht noch.'));
      }
    }

    function ratklasse(v) {
      return v >= 80 ? 'rat-elite-text' : v >= 70 ? 'rat-stark-text' : v >= 60 ? 'rat-gut-text'
        : v >= 50 ? 'rat-ok-text' : v >= 40 ? 'rat-schwach-text' : 'rat-mies-text';
    }

    /* ── Chemie ────────────────────────────────────────────────────────── */
    function zeichneChemie() {
      clearNode(chemieKoerper);
      const ch = sicher(() => chemistry(kader, t), null, 'chemistry');
      if (!ch) {
        // Die paarweise Eingespieltheit hängt nicht an der Engine – sie bleibt stehen.
        chemieKoerper.appendChild(fehlerZeile('Die Chemie ließ sich nicht bestimmen.'));
        zeichneVerbindungen();
        return;
      }
      chemieKoerper.appendChild(bar(ch.wert, 100, {
        label: 'Teamchemie', valueText: String(ch.wert), height: 12,
        tooltip: 'Unter 40 stolpern die Abläufe, über 70 findet der Pass den Mann blind.'
      }));

      const elf = elfSpieler();
      const legenden = elf.filter(istLegende).length;
      const moderne = elf.length - legenden;
      const aera = el('div.tv-taktik__aera');
      if (elf.length) {
        if (legenden) {
          aera.appendChild(el('div', {
            style: { width: (legenden / elf.length * 100) + '%', background: 'linear-gradient(180deg, var(--gold-hell), var(--gold))', color: 'var(--holz-900)', textShadow: 'none' }
          }, legenden >= 2 ? `${legenden} Legenden` : '1 Legende'));
        }
        if (moderne) {
          aera.appendChild(el('div', {
            style: { width: (moderne / elf.length * 100) + '%', background: 'linear-gradient(180deg, var(--blau-hell), var(--blau))' }
          }, moderne >= 2 ? `${moderne} Moderne` : '1 Moderner'));
        }
      } else {
        aera.appendChild(el('div', { style: { width: '100%', background: 'var(--flaeche-dunkel)', color: 'var(--tinte)', textShadow: 'none' } }, 'keine Elf'));
      }
      chemieKoerper.appendChild(aera);
      chemieKoerper.appendChild(el('div.tv-mini', {},
        legenden && moderne
          ? `Ära-Mischung ${legenden}:${moderne}. Je länger die beiden Generationen zusammenspielen, desto kleiner der Abzug (Eingespieltheit ${Math.round(club.chemistryHistory || 0)} %).`
          : legenden
            ? 'Eine Elf aus einem Guss – alles Legenden.'
            : 'Eine Elf aus einem Guss – alles Gegenwart.'));

      if (ch.gruende && ch.gruende.length) {
        chemieKoerper.appendChild(el('ul.tv-taktik__liste.tv-taktik__liste--info', { style: { marginTop: '5px' } },
          ...ch.gruende.map(g => el('li', {}, g))));
      }

      zeichneVerbindungen();
    }

    /** Wer auf dem Platz mit wem kann — und wer noch nicht. */
    function zeichneVerbindungen() {
      const elf = elfSpieler();
      const v = sicher(() => verbindungen(), { liste: [], gut: [], schwach: [] }, 'Verbindungen');

      chemieKoerper.appendChild(el('div.tv-subpanel__titel', { style: { marginTop: '8px' } },
        'Eingespieltheit der Elf'));

      if (elf.length < 2 || !v.liste.length) {
        chemieKoerper.appendChild(el('div.tv-mini', {},
          'Erst ab zwei aufgestellten Spielern gibt es Verbindungen zu bewerten.'));
        return;
      }

      const paarwert = sicher(() => eingespieltheit(state, club.id, elf.map(p => p.id)), null, 'eingespieltheit');
      if (paarwert !== null) {
        chemieKoerper.appendChild(bar(paarwert, 100, {
          label: 'Paarweise über alle Elf', valueText: String(Math.round(paarwert)), height: 10,
          tooltip: 'Mittel über alle 55 Verbindungen dieser Elf. Wächst mit gemeinsamen Spielminuten.'
        }));
      }
      chemieKoerper.appendChild(el('div.tv-mini', {},
        `${v.liste.length} Verbindungen zwischen Nachbarn, im Schnitt ${Math.round(v.mittel)}.`));

      const zeile = (paar) => {
        const li = el('li', {},
          `${kurzName(paar.a)} – ${kurzName(paar.b)} `,
          el('b.tv-num', {}, String(Math.round(paar.wert))),
          paar.gemischt ? el('span.tv-mini', {}, ' · Ära-Bruch') : null);
        tooltip(li, `${kurzName(paar.a)} und ${kurzName(paar.b)}: Eingespieltheit ${Math.round(paar.wert)} von 100.` +
          (paar.gemischt ? '\nLegende neben Gegenwart — das Paar startet tief und holt schneller auf.' : ''));
        return li;
      };

      if (v.gut.length) {
        chemieKoerper.appendChild(el('div.tv-mini', { style: { marginTop: '4px' } }, 'Diese Wege sitzen (goldene Linien):'));
        chemieKoerper.appendChild(el('ul.tv-taktik__liste.tv-taktik__liste--gut', {},
          ...v.gut.map(p => zeile(p))));
      }
      if (v.schwach.length) {
        chemieKoerper.appendChild(el('div.tv-mini', { style: { marginTop: '4px' } }, 'Diese noch nicht (rote Linien):'));
        chemieKoerper.appendChild(el('ul.tv-taktik__liste.tv-taktik__liste--schlecht', {},
          ...v.schwach.map(p => zeile(p))));
      }
      if (!v.gut.length && !v.schwach.length) {
        chemieKoerper.appendChild(el('div.tv-mini', { style: { marginTop: '4px' } },
          'Keine Verbindung fällt aus dem Rahmen — diese Elf ist durchweg gleich weit. ' +
          'Deshalb liegt auch keine Linie auf dem Brett.'));
      }
    }

    /* ── Regler ────────────────────────────────────────────────────────── */
    const reglerWidgets = new Map();

    function zeichneRegler() {
      clearNode(reglerKoerper);
      reglerWidgets.clear();
      for (const r of REGLER) {
        const wert = typeof t.sliders[r.key] === 'number' ? t.sliders[r.key] : 50;
        const w = slider(r.label, wert, {
          left: r.links, right: r.rechts, tooltip: r.tip,
          marks: [{ v: 50, label: '│' }],
          onInput: (v) => {
            t.sliders[r.key] = v;
            zeichneStaerke();
            zeichneChemie();
          },
          onChange: (v) => {
            t.sliders[r.key] = v;
            nachAenderung();
          }
        });
        reglerWidgets.set(r.key, w);
        reglerKoerper.appendChild(w);
      }
      reglerKoerper.appendChild(el('div.tv-mini', {},
        'Die Regler wirken sofort auf die Mannschaftsstärke. Der Spielstil setzt nur Vorgaben – ',
        'das letzte Wort haben Sie.'));
    }

    function reglerAktualisieren() {
      reglerWidgets.forEach((w, k) => {
        const v = typeof t.sliders[k] === 'number' ? t.sliders[k] : 50;
        if (w.tvSetValue) w.tvSetValue(v);
      });
    }

    /* ── Anweisungen ───────────────────────────────────────────────────── */
    const anweisungBoxen = new Map();

    function zeichneAnweisungen() {
      clearNode(anweisungKoerper);
      anweisungBoxen.clear();
      for (const id of INSTRUCTION_IDS) {
        const ins = INSTRUCTIONS[id];
        const box = el('input', {
          type: 'checkbox',
          checked: !!t.instructions[id],
          onchange: (ev) => {
            t.instructions[id] = !!ev.target.checked;
            // Die Engine liest die Abseitsfalle zusätzlich als eigenes Feld.
            if (id === 'abseitsfalle') t.offsideTrap = !!ev.target.checked;
            nachAenderung();
          }
        });
        anweisungBoxen.set(id, box);
        const zeile = el('label.tv-taktik__anw', {}, box,
          el('div', {}, el('b', {}, ins.name), el('small', {}, ins.desc)));
        anweisungKoerper.appendChild(zeile);
      }
    }

    function anweisungenAktualisieren() {
      anweisungBoxen.forEach((b, id) => { b.checked = !!t.instructions[id]; });
    }

    /* ── Rollen ────────────────────────────────────────────────────────── */
    function zeichneRollen() {
      clearNode(rollenKoerper);
      const f = formation();
      let leer = 0;
      for (const s of f.slots) {
        const p = spieler(t.lineup[s.id]);
        if (!p) { leer++; continue; }
        const moeglich = sicher(() => rolesForPosition(s.pos), [], 'rolesForPosition');
        const aktuell = t.roles[p.id] || '';
        const optionen = moeglich.slice();
        if (aktuell && !optionen.includes(aktuell) && ROLES[aktuell]) optionen.push(aktuell);

        const ohneText = 'Keine besondere Rolle – der Mann spielt nach Schema F.';
        const beschreibung = el('small', {}, ROLES[aktuell] ? ROLES[aktuell].desc : ohneText);
        tooltip(beschreibung, ROLES[aktuell] ? `${ROLES[aktuell].name}: ${ROLES[aktuell].desc}` : ohneText);
        const wahl = el('select', {
          onchange: (ev) => {
            const v = ev.target.value;
            if (v) t.roles[p.id] = v; else delete t.roles[p.id];
            beschreibung.textContent = ROLES[v] ? ROLES[v].desc : ohneText;
            tooltip(beschreibung, ROLES[v] ? `${ROLES[v].name}: ${ROLES[v].desc}` : ohneText);
            club.tactics = t;
            sicher(() => ctx.aktualisiere && ctx.aktualisiere(), null, 'aktualisiere');
            zeichneStaerke();
            zeichneBrett();
            zeichneStartelf();
          }
        }, el('option', { value: '' }, '– ohne Rolle –'),
        ...optionen.map(id => el('option', {
          value: id, selected: id === aktuell
        }, ROLES[id].name + (moeglich.includes(id) ? '' : ' (unpassend)'))));

        const vorschlag = sicher(() => suggestRole(p, s.pos), null, 'suggestRole');
        if (vorschlag && ROLES[vorschlag] && vorschlag !== aktuell) {
          tooltip(wahl, `Der Co-Trainer würde hier „${ROLES[vorschlag].name}" nehmen.`);
        }

        rollenKoerper.appendChild(el('div.tv-taktik__rolle', {},
          el('div', {}, el('b', {}, `${slotLabel(s)} · ${kurzName(p)}`), beschreibung),
          wahl));
      }
      if (leer) {
        rollenKoerper.appendChild(el('div.tv-taktik__warn', {},
          `${leer} Position${leer > 1 ? 'en sind' : ' ist'} unbesetzt – dafür braucht es auch keine Rolle.`));
      }
    }

    /* ── Standards ─────────────────────────────────────────────────────── */
    function zeichneStandards() {
      clearNode(standardKoerper);
      const elf = elfSpieler();
      if (!elf.length) {
        standardKoerper.appendChild(el('div.tv-mini', {}, 'Erst eine Elf aufstellen, dann Schützen bestimmen.'));
        return;
      }
      for (const feld of STANDARD_FELDER) {
        const kandidaten = elf.filter(p => !(feld.keinTorwart && p.position === 'TW'));
        const sortiert = sortBy(kandidaten, p => ({ key: EIGNUNG[feld.key](p), desc: true }));
        const aktuell = (t.setPieces && t.setPieces[feld.key]) || '';
        const wahl = el('select', {
          onchange: (ev) => {
            t.setPieces[feld.key] = ev.target.value || null;
            club.tactics = t;
            sicher(() => ctx.aktualisiere && ctx.aktualisiere(), null, 'aktualisiere');
            zeichneStaerke();
            zeichneChemie();
            zeichnePruefung();
          }
        }, el('option', { value: '' }, '– niemand –'),
        ...sortiert.map(p => el('option', {
          value: p.id, selected: p.id === aktuell
        }, `${kurzName(p)} (${Math.round(EIGNUNG[feld.key](p))})`)));

        standardKoerper.appendChild(el('div.tv-taktik__rolle', {},
          el('div', {}, el('b', {}, feld.label), el('small', {}, feld.hinweis)),
          wahl));
      }
      const beste = sortBy(elf, p => ({ key: EIGNUNG.elfmeter(p), desc: true }))[0];
      if (beste) {
        standardKoerper.appendChild(el('div.tv-mini', { style: { marginTop: '4px' } },
          `Die Zahl in Klammern ist die Eignung. Bei Elfmetern zählt vor allem, wer bei 80.000 Pfiffen noch weiß, wo das Tor steht – hier: ${kurzName(beste)}.`));
      }
    }

    /* ── Bank ──────────────────────────────────────────────────────────── */
    function zeichneBank() {
      clearNode(bankKoerper);
      clearNode(seitenbank);
      const liste = el('div.tv-bank.tv-taktik__ablage', { dataset: { ziel: 'bank' } });
      const bank = t.bench.map(id => spieler(id)).filter(Boolean);

      for (const p of bank) {
        liste.appendChild(chip(p, { typ: 'bank' }));
        seitenbank.appendChild(chip(p, { typ: 'bank' }));
      }
      for (let i = bank.length; i < 9; i++) {
        liste.appendChild(el('div.tv-taktik__leerchip', {}, 'frei'));
        seitenbank.appendChild(el('div.tv-taktik__leerchip', {}, 'frei'));
      }
      seitenbankTitel.textContent = `Bank ${bank.length}/9`;
      bankKoerper.appendChild(liste);
      bankExtra.textContent = `${bank.length} / 9`;

      const torwart = bank.some(p => p.position === 'TW');
      const gesperrt = bank.filter(p => isBanned(p) || isInjured(p));
      const hinweise = el('div', { style: { marginTop: '5px' } });
      if (!torwart) {
        hinweise.appendChild(el('div.tv-taktik__fehler', {},
          '⚠ Kein Ersatztorwart auf der Bank. Wenn sich der Keeper verletzt, steht der Innenverteidiger im Kasten – und das sieht selten gut aus.'));
      }
      for (const p of gesperrt) {
        hinweise.appendChild(el('div.tv-taktik__warn', {},
          `${kurzName(p)} sitzt auf der Bank, darf aber nicht spielen (${isBanned(p) ? 'gesperrt' : 'verletzt'}).`));
      }
      if (!bank.length) {
        hinweise.appendChild(el('div.tv-mini', {}, 'Die Bank ist leer. Ziehen Sie Spieler aus der Kaderliste hierher.'));
      }
      bankKoerper.appendChild(hinweise);
    }

    function chip(p, quelle) {
      const url = sicher(() => portraitDataURL(p, 44, { club, age: p.age }), '', 'portrait');
      const knoten = el('div.tv-taktik__chip', {
        dataset: { ziel: quelle.typ, spieler: p.id },
        class: [istLegende(p) ? 'legende' : null, auswahl === p.id ? 'gewaehlt' : null]
      },
      url ? el('img', { src: url, alt: '' }) : null,
      el('div', {},
        el('b', {}, kurzName(p)),
        el('small', {}, `${p.position} · ${sicher(() => playerOverall(p), 0)} · ${Math.round(fitnessVon(p))} %`)),
      isInjured(p) ? el('span', {}, '🩹') : null,
      isBanned(p) ? el('span', {}, '🟥') : null);
      tooltip(knoten, `${kurzName(p)} · ${POSITION_NAMES[p.position] || p.position}\n` +
        `Stärke ${sicher(() => playerOverall(p), 0)} · Form ${Math.round(p.form || 0)} · Fitness ${Math.round(fitnessVon(p))} %` +
        (istLegende(p) ? `\n${p.eraLabel || 'Legende'}` : ''));
      beweglich(knoten, p.id, quelle);
      return knoten;
    }

    /* ── Startelf in Zahlen ────────────────────────────────────────────── */
    function zeichneStartelf() {
      clearNode(startelfKoerper);
      const reihen = slots().map(s => ({ id: s.id, slot: s, p: spieler(t.lineup[s.id]) }));
      const besetzt = reihen.filter(r => r.p).length;
      const summe = reihen.reduce((sum, r) => sum + (r.p ? sicher(() => playerRatingForSlot(r.p, r.slot.pos), 0) : 0), 0);
      startelfExtra.textContent = `${besetzt} / 11 · Schnitt ${besetzt ? Math.round(summe / besetzt) : 0}`;

      const tab = table([
        {
          key: 'pos', label: 'Platz', width: 74, sortable: false,
          render: (r) => el('span.tv-pos', { class: 'tv-pos--' + (POSITION_GROUP[r.slot.pos] || 'MIT') }, slotLabel(r.slot))
        },
        { key: 'nr', label: 'Nr', width: 32, numeric: true, sortable: false, render: (r) => r.p && r.p.number !== undefined ? r.p.number : '–' },
        {
          key: 'name', label: 'Spieler', sortable: false,
          render: (r) => r.p
            ? el('span', {}, kurzName(r.p),
              istLegende(r.p) ? el('span', { style: { marginLeft: '5px' } }, pill(r.p.eraLabel || 'Legende', 'legende')) : null)
            : el('span.tv-gedaempft', {}, '— unbesetzt —')
        },
        {
          key: 'staerke', label: 'Stärke', width: 54, numeric: true, sortable: false,
          render: (r) => r.p ? Math.round(sicher(() => playerRatingForSlot(r.p, r.slot.pos), 0)) : '–'
        },
        {
          key: 'rolle', label: 'Rolle', width: 118, sortable: false,
          render: (r) => {
            const ro = r.p && t.roles[r.p.id] ? ROLES[t.roles[r.p.id]] : null;
            return ro ? ro.name : el('span.tv-gedaempft', {}, 'ohne');
          }
        },
        { key: 'form', label: 'Form', width: 42, numeric: true, sortable: false, render: (r) => r.p ? Math.round(r.p.form || 0) : '–' },
        { key: 'fit', label: 'Fit', width: 38, numeric: true, sortable: false, render: (r) => r.p ? Math.round(fitnessVon(r.p)) : '–' },
        {
          key: 'warn', label: '', width: 24, align: 'center', sortable: false,
          render: (r) => {
            if (!r.p) return '';
            const w = slotWarnungen(r.p, r.slot);
            if (!w.length) return '';
            const s = el('span', {}, '⚠');
            tooltip(s, w.join('\n'));
            return s;
          }
        }
      ], reihen, {
        compact: true,
        emptyText: 'Diese Formation kennt keine Positionen. Das sollte nicht passieren.',
        rowClass: (r) => [
          r.p && istLegende(r.p) ? 'zeile--legende' : '',
          r.p && isInjured(r.p) ? 'zeile--verletzt' : '',
          r.p && isBanned(r.p) ? 'zeile--gesperrt' : '',
          r.p && auswahl === r.p.id ? 'gewaehlt' : ''
        ].filter(Boolean).join(' ')
      });

      const koerper = tab.tvTable ? tab.tvTable.querySelector('tbody') : null;
      if (koerper) {
        koerper.addEventListener('pointerdown', (ev) => {
          if (ev.button !== undefined && ev.button !== 0) return;
          const tr = ev.target.closest ? ev.target.closest('tr[data-i]') : null;
          if (!tr) return;
          const r = tab.tvRows()[Number(tr.dataset.i)];
          if (!r) return;
          if (r.p) zugStarten(ev, r.p.id, { typ: 'slot', slotId: r.slot.id });
          else klickZiel(null, { typ: 'slot', slotId: r.slot.id });
        });
      }
      startelfKoerper.appendChild(tab);
    }

    /* ── Kaderliste ────────────────────────────────────────────────────── */
    function zeichneKader() {
      clearNode(kaderKoerper);
      const drin = new Set(Object.values(t.lineup).filter(Boolean));
      const rest = kader.filter(p => !drin.has(p.id));
      const reihen = sortBy(rest, p => ({ key: t.bench.includes(p.id) ? 1 : 0, desc: true }),
        p => ({ key: sicher(() => playerOverall(p), 0), desc: true }));

      kaderExtra.textContent = `${rest.length} Mann · ${t.bench.length} auf der Bank`;

      kaderTabelle = table([
        {
          key: 'position', label: 'Pos', width: 44,
          render: (p) => el('span.tv-pos', { class: 'tv-pos--' + (POSITION_GROUP[p.position] || 'MIT') }, p.position)
        },
        { key: 'number', label: 'Nr', width: 34, numeric: true, render: (p) => p.number !== undefined ? p.number : '–' },
        {
          key: 'name', label: 'Spieler',
          sort: (a, b) => String(kurzName(a)).localeCompare(String(kurzName(b)), 'de'),
          render: (p) => el('span', {}, kurzName(p),
            istLegende(p) ? el('span', { style: { marginLeft: '5px' } }, pill(p.eraLabel || 'Legende', 'legende')) : null)
        },
        {
          key: 'ovr', label: 'Stärke', width: 56, numeric: true,
          render: (p) => sicher(() => playerOverall(p), 0),
          sort: (a, b) => sicher(() => playerOverall(a) - playerOverall(b), 0)
        },
        { key: 'fitness', label: 'Fit', width: 42, numeric: true, render: (p) => Math.round(fitnessVon(p)) },
        { key: 'form', label: 'Form', width: 44, numeric: true, render: (p) => Math.round(p.form || 0) },
        {
          key: 'status', label: 'Status', width: 78,
          render: (p) => isInjured(p) ? pill('verletzt', 'schlecht')
            : isBanned(p) ? pill('gesperrt', 'warn')
              : t.bench.includes(p.id) ? pill('Bank', 'info')
                : pill('Tribüne', 'neutral')
        }
      ], reihen, {
        compact: true,
        emptyText: 'Alle Mann stehen auf dem Platz. Ungewöhnlich, aber zulässig.',
        rowClass: (p) => [
          istLegende(p) ? 'zeile--legende' : '',
          isInjured(p) ? 'zeile--verletzt' : '',
          isBanned(p) ? 'zeile--gesperrt' : '',
          auswahl === p.id ? 'gewaehlt' : ''
        ].filter(Boolean).join(' ')
      });

      const koerper = kaderTabelle.tvTable ? kaderTabelle.tvTable.querySelector('tbody') : null;
      if (koerper) {
        koerper.addEventListener('pointerdown', (ev) => {
          if (ev.button !== undefined && ev.button !== 0) return;
          const tr = ev.target.closest ? ev.target.closest('tr[data-i]') : null;
          if (!tr) return;
          const p = kaderTabelle.tvRows()[Number(tr.dataset.i)];
          if (p && p.id) zugStarten(ev, p.id, { typ: 'kader' });
        });
      }

      kaderKoerper.appendChild(kaderTabelle);
      kaderKoerper.appendChild(el('div.tv-mini', { style: { marginTop: '4px' } },
        'Zeile anklicken und dann auf einen Platz klicken – oder direkt aufs Brett ziehen. ',
        'Ziehen Sie einen Reservisten auf eine Zeile, tauschen die beiden ihre Plätze.'));
      kaderKoerper.appendChild(el('div.tv-taktik__ablagezone', {},
        'Spieler hierher ziehen: raus aus Startelf und Bank – ab auf die Tribüne.'));
    }

    /* ── Prüfung ───────────────────────────────────────────────────────── */
    function zeichnePruefung() {
      clearNode(pruefungKoerper);
      const v = sicher(() => validateTactics(t, kader), null, 'validateTactics');
      if (!v) {
        pruefungKoerper.appendChild(fehlerZeile('Die Aufstellung konnte nicht geprüft werden.'));
        pruefungExtra.textContent = '';
        return;
      }
      pruefungExtra.textContent = v.ok
        ? (v.warnings.length ? `${v.warnings.length} Anmerkung${v.warnings.length > 1 ? 'en' : ''}` : 'spielbereit')
        : `${v.errors.length} Fehler`;

      if (v.ok && !v.warnings.length) {
        pruefungKoerper.appendChild(el('div.tv-taktik__ok', {},
          '✔ Die Elf steht, der Co-Trainer nickt zufrieden. So kann man auflaufen.'));
      }
      for (const e of v.errors) pruefungKoerper.appendChild(el('div.tv-taktik__fehler', {}, '✘ ' + e));
      for (const w of v.warnings) pruefungKoerper.appendChild(el('div.tv-taktik__warn', {}, '⚠ ' + w));
    }

    /* ── Co-Trainer ────────────────────────────────────────────────────── */
    function zeichneCoTrainer() {
      clearNode(coKoerper);

      const rat = sicher(() => coTrainerRat(state, club.id, 'aufstellung'), null, 'coTrainerRat');
      if (rat && rat.text) {
        coKoerper.appendChild(el('div.tv-taktik__zitat', {}, rat.text));
        if (rat.vertrauen !== undefined) {
          coKoerper.appendChild(bar(rat.vertrauen, 100, {
            label: 'Vertrauen in seinen Rat', valueText: rat.vertrauen + ' %', height: 7, compact: true,
            tooltip: 'Wie belastbar die Einschätzungen dieses Co-Trainers erfahrungsgemäß sind.'
          }));
        }
        const e = rat.empfehlung;
        if (e && e.art === 'wechsel' && e.reinId && e.rausId) {
          coKoerper.appendChild(el('div', { style: { marginTop: '5px' } },
            button('Tausch übernehmen', () => {
              if (tausche(e.reinId, e.rausId)) {
                toast(`${kurzName(spieler(e.reinId))} rückt in die Elf.`, 'gut');
                nachAenderung();
              } else {
                toast('Dieser Tausch geht so nicht.', 'warn');
              }
            }, { kind: 'blau', size: 'klein' })));
        }
      } else {
        coKoerper.appendChild(el('div.tv-mini', {}, 'Zur Aufstellung sagt heute niemand etwas.'));
      }

      const gegnerTeam = gegner ? {
        club: gegner,
        players: sicher(() => squadOf(state, gegner.id), [], 'squadOf/Gegner'),
        tactics: gegner.tactics || null,
        staerke: undefined
      } : null;

      const vorschlag = sicher(() => suggestTactics(kader, gegnerTeam, {
        heim: heimspiel,
        wichtig: !!(naechstes && naechstes.competitionId === 'pokal'),
        competition: naechstes ? naechstes.competitionId : null
      }), null, 'suggestTactics');

      if (!vorschlag) {
        coKoerper.appendChild(fehlerZeile('Der Co-Trainer hat seine Unterlagen verlegt – kein Taktikvorschlag verfügbar.'));
        return;
      }

      coKoerper.appendChild(el('div.tv-trenner'));
      coKoerper.appendChild(el('div.tv-zeile.tv-zeile--verteilt', {},
        el('div.tv-subpanel__titel', { style: { marginBottom: '0', border: '0' } }, 'Sein Vorschlag'),
        button('Nochmal fragen', () => zeichneCoTrainer(), {
          kind: 'ghost', size: 'klein', tooltip: 'Der Co-Trainer schaut sich die aktuelle Aufstellung noch einmal an.'
        })));
      coKoerper.appendChild(el('div.tv-zeile', { style: { flexWrap: 'wrap', gap: '4px' } },
        pill((FORMATIONS[vorschlag.formation] || {}).name || vorschlag.formation, 'info'),
        pill((STYLES[vorschlag.style] || {}).name || vorschlag.style, 'gut')));
      coKoerper.appendChild(el('ul.tv-taktik__liste.tv-taktik__liste--info', {},
        ...(vorschlag.begruendung || []).map(x => el('li', {}, x))));

      const gleich = vorschlag.formation === t.formation && vorschlag.style === t.style;
      coKoerper.appendChild(el('div', { style: { marginTop: '6px' } },
        button(gleich ? 'Regler mit übernehmen' : 'Vorschlag übernehmen', () => {
          t.formation = FORMATIONS[vorschlag.formation] ? vorschlag.formation : t.formation;
          t.style = STYLES[vorschlag.style] ? vorschlag.style : t.style;
          t.sliders = Object.assign({}, DEFAULT_SLIDERS, vorschlag.sliders || {});
          const elf = elfSpieler();
          if (elf.length === 11) {
            const neu = sicher(() => autoLineup(elf, Object.assign({}, t), { respectFitness: false }), null, 'autoLineup/Vorschlag');
            if (neu && neu.lineup) t.lineup = neu.lineup;
          }
          reglerAktualisieren();
          toast('Der Co-Trainer strahlt. Sein Vorschlag steht.', 'gut');
          nachAenderung();
        }, { kind: 'primary', size: 'klein', wide: true })));
    }

    /* ══════════════════════════════════════════════════════════════════
     * Erstzeichnung
     * ════════════════════════════════════════════════════════════════ */

    zeichneRegler();
    zeichneAnweisungen();
    zeichneBrett();
    zeichneStartelf();
    zeichneBank();
    zeichneKader();
    zeichneStaerke();
    zeichneChemie();
    zeichneRollen();
    zeichneStandards();
    zeichnePruefung();
    zeichneCoTrainer();
    zeichneKopfstats();
    zeichneAuswahl();
    formationsKnoepfeAktualisieren();

    root.appendChild(wurzel);

    aufraeumen = () => {
      try {
        window.removeEventListener('pointermove', beiBewegung);
        window.removeEventListener('pointerup', beiLoslassen);
        window.removeEventListener('pointercancel', beiAbbruch);
        if (rollBild) { cancelAnimationFrame(rollBild); rollBild = null; }
        if (zug && zug.ghost && zug.ghost.parentNode) zug.ghost.parentNode.removeChild(zug.ghost);
      } catch (err) { /* beim Verlassen ist alles verzeihlich */ }
      zug = null;
    };
  },

  onLeave() {
    if (aufraeumen) { aufraeumen(); aufraeumen = null; }
  }
};

/* ══════════════════════════════════════════════════════════════════════════
 * Bausteine außerhalb des Renderlaufs
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Panel im Anstoß-Look: benutzt panel() aus render/ui.js, hängt aber zusätzlich
 * die Klassen des Projekt-Stylesheets an (blaue Kopfleiste, Bevel-Körper).
 */
function tafel(titel, extra, ...kinder) {
  const p = panel(titel, ...kinder);
  const kopf = p.querySelector('.tv-panel-kopf');
  if (kopf) {
    kopf.classList.add('tv-panel-kopf');
    if (extra) kopf.appendChild(extra);
  }
  const korpus = p.querySelector('.tv-panel-korpus');
  if (korpus) korpus.classList.add('tv-panel__koerper');
  return p;
}

/** Zeichnet Linien, Kreise, Strafräume und das blasse Wappen auf das Brett. */
function brettFeldzeichnung(brett, club) {
  clearNode(brett);

  // Maße eines 68 × 92 großen Ausschnitts, in Prozent umgerechnet.
  const strafraumB = (40.32 / 68) * 100;   // 59,3 %
  const strafraumH = (16.5 / 92) * 100;    // 17,9 %
  const torraumB = (18.32 / 68) * 100;     // 26,9 %
  const torraumH = (5.5 / 92) * 100;       // 6,0 %
  const kreisB = (18.3 / 68) * 100;        // Mittelkreis, Durchmesser
  const kreisH = (18.3 / 92) * 100;
  const torB = (7.32 / 68) * 100;

  // Mittellinie
  brett.appendChild(el('div.tv-brett__linie', { style: { left: '0', right: '0', top: '50%', height: '2px' } }));
  // Mittelkreis
  brett.appendChild(el('div.tv-brett__kreis', {
    style: {
      left: (50 - kreisB / 2) + '%', top: (50 - kreisH / 2) + '%',
      width: kreisB + '%', height: kreisH + '%'
    }
  }));
  brett.appendChild(el('div.tv-brett__punkt', { style: { left: '50%', top: '50%' } }));

  // Strafräume unten (eigenes Tor) und oben (gegnerisches Tor)
  for (const unten of [true, false]) {
    const y = unten ? { bottom: '0' } : { top: '0' };
    brett.appendChild(el('div.tv-brett__raum', Object.assign({
      style: Object.assign({ left: (50 - strafraumB / 2) + '%', width: strafraumB + '%', height: strafraumH + '%' }, y)
    })));
    brett.appendChild(el('div.tv-brett__raum', Object.assign({
      style: Object.assign({ left: (50 - torraumB / 2) + '%', width: torraumB + '%', height: torraumH + '%' }, y)
    })));
    brett.appendChild(el('div.tv-brett__punkt', {
      style: Object.assign({ left: '50%' }, unten ? { bottom: (11 / 92 * 100) + '%' } : { top: (11 / 92 * 100) + '%' })
    }));
    brett.appendChild(el('div.tv-brett__tor', {
      style: Object.assign({ left: (50 - torB / 2) + '%', width: torB + '%', height: '7px' },
        unten ? { bottom: '-4px' } : { top: '-4px' })
    }));
  }

  // Eckenviertel
  const ecken = [
    { left: '-6px', top: '-6px' }, { right: '-6px', top: '-6px' },
    { left: '-6px', bottom: '-6px' }, { right: '-6px', bottom: '-6px' }
  ];
  for (const e of ecken) {
    brett.appendChild(el('div.tv-brett__ecke', { style: Object.assign({ borderRadius: '50%' }, e) }));
  }

  // Blasses Wappen im Mittelkreis
  const cv = el('canvas.tv-brett__wappen', { width: 160, height: 160, style: { width: '110px', height: '110px' } });
  sicher(() => drawCrest(cv.getContext('2d'), club, 80, 80, 150), null, 'drawCrest');
  brett.appendChild(cv);

  brett.appendChild(el('div.tv-brett__marke', {}, 'Angriffsrichtung ▲'));
  brett.appendChild(el('div.tv-brett__marke.tv-brett__marke--unten', {}, 'Eigenes Tor'));
}

/**
 * Sorgt dafür, dass ein Taktik-Objekt alle Felder aus CONTRACTS 5.3 hat.
 * Repariert kaputte Spielstände, statt beim ersten Zugriff auszusteigen.
 */
function normalisiere(tac, kader) {
  let t = tac && typeof tac === 'object' ? tac : null;

  if (!t || !t.lineup || Object.values(t.lineup).filter(Boolean).length === 0) {
    const gebaut = sicher(() => autoLineup(kader, t || {}, { respectFitness: true }), null, 'autoLineup/Reparatur');
    if (gebaut) t = gebaut;
  }
  if (!t) t = {};

  if (!FORMATIONS[t.formation]) t.formation = '4-4-2';
  if (!STYLES[t.style]) t.style = 'ausgeglichen';
  if (!t.lineup || typeof t.lineup !== 'object') t.lineup = {};
  if (!Array.isArray(t.bench)) t.bench = [];
  if (!t.roles || typeof t.roles !== 'object') t.roles = {};
  if (!t.setPieces || typeof t.setPieces !== 'object') t.setPieces = {};
  t.sliders = Object.assign({}, DEFAULT_SLIDERS, t.sliders || {});
  const anw = {};
  for (const k of INSTRUCTION_IDS) anw[k] = !!(t.instructions && t.instructions[k]);
  t.instructions = anw;
  t.offsideTrap = !!t.instructions.abseitsfalle || !!t.offsideTrap;
  t.instructions.abseitsfalle = t.offsideTrap;
  if (t.manMarking === undefined) t.manMarking = null;

  // Karteileichen entfernen: Spieler, die längst nicht mehr im Kader stehen.
  const ids = new Set(kader.map(p => p.id));
  for (const k in t.lineup) if (!ids.has(t.lineup[k])) delete t.lineup[k];
  t.bench = t.bench.filter(id => ids.has(id) && !Object.values(t.lineup).includes(id)).slice(0, 9);
  for (const pid in t.roles) if (!ids.has(pid)) delete t.roles[pid];
  for (const k in t.setPieces) if (t.setPieces[k] && !ids.has(t.setPieces[k])) t.setPieces[k] = null;

  return t;
}

export default screen;
