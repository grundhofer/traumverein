/**
 * Der Taktgeber des Vereinslebens.
 *
 * Die Reihenfolge ist bewusst gewählt: Erst wird der Zustand der Mannschaft
 * fortgeschrieben (Medizin, Training, Moral), dann das Umfeld (Jugend, Transfers,
 * Stadion, Sponsoren, Fans, Medien, Vorstand) – und ganz zum Schluss die Finanzen,
 * damit alle Buchungen des Tages bereits vorliegen.
 */

import { tickMedizin } from './medical.js';
import { tickChemie } from './chemie.js';
import { tickTraining } from './training.js';
import { tickMoral } from './morale.js';
import { tickJugend } from './youth.js';
import { tickStab } from './staff.js';
import { tickTransfers } from './transfers.js';
import { tickStadion } from './stadium.js';
import { tickSponsoren } from './sponsors.js';
import { tickFans } from './fans.js';
import { tickMedien } from './media.js';
import { tickVorstand } from './board.js';
import { tickFinanzen } from './finances.js';

export const CLUB_MODULES = [
  { id: 'medizin', name: 'Medizinische Abteilung', tick: tickMedizin, reihenfolge: 10 },
  // Die Kabine steht VOR dem Training und VOR der Moral, und zwar aus zwei
  // Gründen: Der Mentorenbonus muss in `training.js:entwicklung()` schon
  // stehen, wenn die Woche gerechnet wird, und das Führungsansehen eines
  // Mentors geht über `player.mentees` in `morale.js:hierarchie()` ein. Die
  // Einsatzminuten des Vortags verbucht das Modul selbst aus dem Spielplan,
  // es braucht dafür kein vorlaufendes Modul.
  { id: 'chemie', name: 'Kabine & Chemie', tick: tickChemie, reihenfolge: 15 },
  { id: 'training', name: 'Training', tick: tickTraining, reihenfolge: 20 },
  { id: 'moral', name: 'Kabine', tick: tickMoral, reihenfolge: 30 },
  { id: 'jugend', name: 'Nachwuchs', tick: tickJugend, reihenfolge: 40 },
  { id: 'stab', name: 'Trainerstab', tick: tickStab, reihenfolge: 50 },
  { id: 'transfers', name: 'Transfermarkt', tick: tickTransfers, reihenfolge: 60 },
  { id: 'stadion', name: 'Stadion', tick: tickStadion, reihenfolge: 70 },
  { id: 'sponsoren', name: 'Sponsoren', tick: tickSponsoren, reihenfolge: 80 },
  { id: 'fans', name: 'Fans', tick: tickFans, reihenfolge: 90 },
  { id: 'medien', name: 'Medien', tick: tickMedien, reihenfolge: 100 },
  { id: 'vorstand', name: 'Vorstand', tick: tickVorstand, reihenfolge: 110 },
  { id: 'finanzen', name: 'Finanzen', tick: tickFinanzen, reihenfolge: 120 }
].sort((a, b) => a.reihenfolge - b.reihenfolge);

/** Zählt Fehler pro Modul, damit ein defektes Modul nicht die Konsole flutet. */
const fehlerZaehler = new Map();
const MAX_MELDUNGEN = 3;

/**
 * Führt alle Vereinsmodule für einen Tag aus.
 * Ein Fehler in einem Modul stoppt die anderen nicht – er wird protokolliert und
 * im Ergebnis zurückgegeben, damit die Oberfläche ihn sichtbar machen kann.
 *
 * @returns {{ ok: boolean, fehler: Array<{ modul: string, meldung: string }> }}
 */
export function tickAlleModule(state, ctx) {
  const fehler = [];
  for (const modul of CLUB_MODULES) {
    try {
      modul.tick(state, ctx);
    } catch (err) {
      const n = (fehlerZaehler.get(modul.id) || 0) + 1;
      fehlerZaehler.set(modul.id, n);
      if (n <= MAX_MELDUNGEN) {
        console.error(`[club/${modul.id}] Fehler an Tag ${ctx.day} (Saison ${ctx.season}):`, err);
        if (n === MAX_MELDUNGEN) {
          console.error(`[club/${modul.id}] Weitere Fehler dieses Moduls werden nicht mehr gemeldet.`);
        }
      }
      fehler.push({ modul: modul.id, meldung: String(err && err.message || err) });
    }
  }
  return { ok: fehler.length === 0, fehler };
}

/** Setzt die Fehlerzählung zurück (z. B. beim Laden eines Spielstands). */
export function resetModulFehler() {
  fehlerZaehler.clear();
}

/** Diagnose für die Oberfläche: welche Module haben schon Fehler geworfen? */
export function modulStatus() {
  return CLUB_MODULES.map(m => ({
    id: m.id, name: m.name, fehler: fehlerZaehler.get(m.id) || 0
  }));
}
