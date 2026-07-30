/**
 * Sammelstelle für alle handgepflegten Kaderdaten.
 *
 * Die zwölf Gruppendateien enthalten je drei Vereine: Gruppe 1–6 die
 * 1. Bundesliga, Gruppe 7–12 die 2. Bundesliga (Roadmap-Stufe 5).
 * Hier werden sie zusammengeführt und die Rückennummern final vergeben
 * (assignNumbers füllt Lücken und löst Doppelvergaben auf).
 */

import { players as g1 } from './gruppe1.js';
import { players as g2 } from './gruppe2.js';
import { players as g3 } from './gruppe3.js';
import { players as g4 } from './gruppe4.js';
import { players as g5 } from './gruppe5.js';
import { players as g6 } from './gruppe6.js';
import { players as g7 } from './gruppe7.js';
import { players as g8 } from './gruppe8.js';
import { players as g9 } from './gruppe9.js';
import { players as g10 } from './gruppe10.js';
import { players as g11 } from './gruppe11.js';
import { players as g12 } from './gruppe12.js';
import { assignNumbers } from './_helper.js';

export const ALL_SQUAD_PLAYERS = assignNumbers([
  ...g1, ...g2, ...g3, ...g4, ...g5, ...g6,
  ...g7, ...g8, ...g9, ...g10, ...g11, ...g12
]);

/** Nach Verein vorgruppiert – wird für playersOfClub() einmalig aufgebaut. */
const BY_CLUB = {};
for (const p of ALL_SQUAD_PLAYERS) {
  (BY_CLUB[p.clubId] || (BY_CLUB[p.clubId] = [])).push(p);
}

/** Alle Spieler eines Vereins (leeres Array, wenn der Verein keinen Kader hat). */
export function playersOfClub(clubId) {
  return BY_CLUB[clubId] ? BY_CLUB[clubId].slice() : [];
}

/** IDs aller Vereine mit handgepflegtem Kader. */
export const SQUAD_CLUB_IDS = Object.keys(BY_CLUB);

export default ALL_SQUAD_PLAYERS;
