/** Winziger Event-Bus für die Kommunikation zwischen Screens, Loop und UI. */

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function once(event, fn) {
  const unsub = on(event, (...args) => { unsub(); fn(...args); });
  return unsub;
}

export function off(event, fn) {
  const set = listeners.get(event);
  if (set) set.delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of Array.from(set)) {
    try { fn(payload); }
    catch (err) { console.error(`[events] Fehler im Listener für "${event}":`, err); }
  }
}

export function clearAll() { listeners.clear(); }

/** Bekannte Events – zentral dokumentiert, damit nichts auseinanderläuft. */
export const EV = {
  TAG_VORBEI: 'tag:vorbei',
  WOCHE_VORBEI: 'woche:vorbei',
  SPIELTAG: 'spieltag',
  SPIEL_FERTIG: 'spiel:fertig',
  SAISON_ENDE: 'saison:ende',
  POST: 'post:neu',
  STATE_CHANGED: 'state:changed',
  SCREEN_CHANGED: 'screen:changed',
  GELD: 'finanzen:buchung',
  TRANSFER: 'transfer:abgeschlossen',
  VERLETZUNG: 'medizin:verletzung',
  ENTLASSUNG: 'vorstand:entlassung'
};
