/**
 * Bildschirm „Editor" – die Werkstatt hinter dem Schalter.
 *
 * Hier lässt sich alles anfassen, was in data/clubs.js und data/squads/*.js
 * steht: Vereinsnamen, Farben, Trikotmuster, Wappen, Stadion, Ruf – und je
 * Spieler Stammdaten, Aussehen, Attribute, Potenzial, Eigenschaften, Ära,
 * Vertrag und Marktwert. Dazu neue Vereine und neue Spieler, Löschen mit
 * Rückfrage, und ein Dateiformat für reine Stammdaten (core/state.js:
 * exportStammdaten / importStammdaten).
 *
 * WARUM HINTER EINEM SCHALTER
 *
 * Der Editor steht bewusst NICHT in SCREEN_ORDER. Ein Manager-Spiel lebt
 * davon, dass die Zahlen gelten – wer den Reiter „Editor" zwischen „Verein"
 * und „Chronik" sieht, klickt ihn im dritten Rückstand an und hat sich das
 * Spiel weggeschraubt, bevor er es gespielt hat. Anstoss hat solche Dinge in
 * ein Untermenü gelegt, und das war richtig.
 *
 * Zwei Türen führen hinein, beide absichtlich unbequem:
 *   1. Strg + Umschalt + E (main.js:tastatur) – drei Tasten, kein Versehen.
 *   2. Ein Knopf im Einstellungsbildschirm (screens/einstellungen.js).
 * Der Rahmen kennt den Bildschirm über main.js:SCREENS, damit navigate()
 * ihn nachladen kann; die Aktenleiste zeigt ihn nicht.
 *
 * GRUNDSATZ DIESER DATEI: Es wird auf einem ENTWURF gearbeitet, nicht am
 * Spielstand. Jede Auswahl zieht eine Kopie der Stammdaten; erst
 * „Übernehmen" schreibt sie zurück. So kann man an einem Regler drehen, die
 * Vorschau ansehen und es sich anders überlegen – und ein halb ausgefülltes
 * Formular kann keinen Kader beschädigen.
 *
 * Kein Math.random(), kein Date.now(): Wo für neue Datensätze ein Zufall
 * gebraucht wird (Laufzeitfelder), kommt er aus createRng(state.seed + …).
 */

import {
  el, panel, subpanel, button, tabs, pill, dialog, toast, confirm as rueckfrage
} from '../render/ui.js';
import { drawCrest, drawKit, crestDataURL, clearCrestCache, CREST_MOTIFS, CREST_SHAPES } from '../render/kits.js';
import { drawPortrait, clearPortraitCache, HAIR_STYLES, BEARD_STYLES, FACE_SHAPES, SKIN_TONES } from '../render/portraits.js';
import {
  clubStammdaten, playerStammdaten, exportStammdaten, importStammdaten,
  initClubRuntime, initPlayerRuntime, ligaVonVerein, KIT_PATTERNS
} from '../core/state.js';
import { createRng } from '../core/rng.js';
import {
  POSITIONS, POSITION_NAMES, ATTRIBUTES, ATTRIBUTE_NAMES, ATTRIBUTE_GROUPS,
  TRAITS, NATION_NAMES, COMPETITIONS
} from '../core/constants.js';
import { deepClone, clamp, formatMoney, nfmt, slug, ratingClass } from '../core/util.js';
import { playerOverall } from '../engine/ratings.js';

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Auswahl – überlebt einen Bildschirmwechsel
 * ════════════════════════════════════════════════════════════════════════ */

const zustand = {
  reiter: 'vereine',
  bereich: 'liga',      // Filter der Vereinsliste
  // undefined = noch nie gewählt (beim ersten Betreten kommt der eigene Verein),
  // null = bewusst abgewählt (ESC). Ohne diese Unterscheidung setzte render()
  // die Wahl sofort wieder, und ESC verpuffte im Vereinsreiter.
  clubId: undefined,
  kaderClubId: null,    // null = noch nicht gewählt, '' = Vertragslose
  playerId: null,
  ctx: null             // nur für onEscape – wird beim Verlassen wieder losgelassen
};

const FUESSE = [['rechts', 'Rechts'], ['links', 'Links'], ['beidfüßig', 'Beidfüßig']];
const AEREN = [['modern', 'Aktueller Kader'], ['legend', 'Legende']];
const BAUARTEN = [['schlank', 'Schlank'], ['normal', 'Normal'], ['kraeftig', 'Kräftig']];
const ACCESSOIRES = [
  ['keiner', 'Nichts'], ['stirnband', 'Stirnband'], ['brille', 'Brille'],
  ['kapitaensbinde', 'Kapitänsbinde'], ['handschuhe', 'Torwarthandschuhe']
];
const MUSTER_NAMEN = {
  plain: 'Einfarbig', stripes: 'Senkrechte Streifen', hoops: 'Querringe',
  halves: 'Halbiert', sash: 'Schärpe', chest: 'Brustband'
};
const FORM_NAMEN = { round: 'Rund', shield: 'Schild', diamond: 'Raute', classic: 'Klassisch' };
const MOTIV_NAMEN = {
  star: 'Stern', lion: 'Löwe', eagle: 'Adler', ball: 'Ball', anchor: 'Anker',
  wheel: 'Rad', letters: 'Buchstaben', goat: 'Geiß', horse: 'Pferd', bull: 'Stier'
};

const BEREICHE = [
  ['liga', 'Vereine der Ligen'],
  ['bl1', '1. Bundesliga'],
  ['bl2', '2. Bundesliga'],
  ['europa', 'Europapokal'],
  ['sonst', 'Amateure & Neuanlagen'],
  ['alle', 'Alle Vereine']
];

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Bausteine für Formulare
 *
 * Jeder Baustein bekommt den Entwurf, den Feldnamen und ein `beim()`, das
 * nach jeder Änderung läuft (Vorschau neu zeichnen, Änderungsmarke setzen).
 * ════════════════════════════════════════════════════════════════════════ */

function feldRahmen(name, hilfe, steuer) {
  return el('label.tv-editor__feld', null,
    el('span.tv-editor__feld-name', null, name),
    steuer,
    hilfe ? el('span.tv-editor__feld-hilfe', null, hilfe) : null);
}

function feldText(name, wert, beim, opts = {}) {
  const input = el('input.tv-editor__eingabe', {
    type: 'text',
    value: wert === null || wert === undefined ? '' : String(wert),
    maxlength: opts.max || 60,
    placeholder: opts.platzhalter || '',
    oninput: e => beim(e.target.value)
  });
  return feldRahmen(name, opts.hilfe, input);
}

function feldZahl(name, wert, beim, opts = {}) {
  const min = opts.min === undefined ? 0 : opts.min;
  const max = opts.max === undefined ? 99 : opts.max;
  const input = el('input.tv-editor__eingabe.tv-editor__eingabe--zahl', {
    type: 'number', min: String(min), max: String(max), step: String(opts.step || 1),
    value: String(wert === null || wert === undefined ? '' : wert),
    oninput: e => {
      const n = Number(e.target.value);
      beim(Number.isFinite(n) ? clamp(n, min, max) : min);
    }
  });
  return feldRahmen(name, opts.hilfe, input);
}

/** Farbwähler und Hex-Feld nebeneinander – beide schreiben denselben Wert. */
function feldFarbe(name, wert, beim, opts = {}) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(String(wert)) ? String(wert) : '#888888';
  const waehler = el('input.tv-editor__farbwahl', { type: 'color', value: hex });
  const text = el('input.tv-editor__eingabe.tv-editor__eingabe--hex', {
    type: 'text', value: hex, maxlength: 7, spellcheck: 'false'
  });
  waehler.addEventListener('input', () => { text.value = waehler.value; beim(waehler.value); });
  text.addEventListener('input', () => {
    const v = text.value.trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) return;
    if (v.length === 7) waehler.value = v;
    beim(v);
  });
  return feldRahmen(name, opts.hilfe, el('span.tv-editor__farbe', null, waehler, text));
}

/** `optionen`: [[wert, Beschriftung], …] */
function feldAuswahl(name, wert, optionen, beim, opts = {}) {
  const sel = el('select.tv-editor__eingabe', { onchange: e => beim(e.target.value) },
    ...optionen.map(([v, t]) => el('option', { value: String(v), selected: String(v) === String(wert) }, t)));
  return feldRahmen(name, opts.hilfe, sel);
}

function feldSchalter(name, wert, beim, opts = {}) {
  const box = el('input.tv-editor__haken', {
    type: 'checkbox', checked: !!wert, onchange: e => beim(e.target.checked)
  });
  return feldRahmen(name, opts.hilfe, box);
}

function gitter(...kinder) {
  return el('div.tv-editor__gitter', null, ...kinder.filter(Boolean));
}

function hinweis(text, art) {
  return el('div.tv-editor__warnung', { class: art === 'rot' ? 'tv-editor__warnung--rot' : null }, text);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Kleinkram
 * ════════════════════════════════════════════════════════════════════════ */

function sicher(fn, ersatz, label) {
  try { return fn(); } catch (err) {
    console.warn(`[editor] ${label || 'Aufruf'} fehlgeschlagen:`, err);
    return ersatz;
  }
}

/**
 * Ligazugehörigkeit ausschließlich nach state.leagues – ohne den Rückfall auf
 * `club.leagueId`, den core/state.js:ligaVonVerein() für Anzeigezwecke macht.
 *
 * Der Unterschied ist hier wesentlich: Amateur- und Europapokalvereine tragen
 * `leagueId: 'amateur'` bzw. `'europa'`, stehen aber in KEINER Ligaliste
 * (ROADMAP 5.1). Wer sie über ligaVonVerein() filtert, hält 130 Vereine für
 * Ligavereine – gemessen beim Prüflauf dieses Bildschirms.
 */
function ligaListeVon(state, clubId) {
  const ligen = (state && state.leagues) || {};
  for (const id in ligen) {
    const e = ligen[id];
    if (e && Array.isArray(e.clubIds) && e.clubIds.indexOf(clubId) >= 0) return id;
  }
  return null;
}

function ligaName(id) {
  if (!id) return 'ohne Liga';
  if (COMPETITIONS[id]) return COMPETITIONS[id].name;
  if (id === 'europa') return 'Europapokal';
  if (id === 'amateur') return 'Amateurbereich';
  return id;
}

/** Eine Kennung, die es im Spielstand noch nicht gibt. */
function freieId(vorrat, basis) {
  let id = basis || 'neu';
  let n = 2;
  while (vorrat[id]) { id = `${basis}-${n}`; n++; }
  return id;
}

function rngFuer(state, zweck) {
  return createRng(`${state.seed}:editor:${zweck}`);
}

/** Leinwand mit doppelter Auflösung – sonst sind Wappen auf Retina matschig. */
function leinwand(breite, hoehe) {
  return el('canvas.tv-editor__leinwand', {
    width: breite * 2, height: hoehe * 2,
    style: { width: breite + 'px', height: hoehe + 'px' }
  });
}

/** Die Stärke eines Entwurfs, ohne dass er im Spielstand stehen muss. */
function staerkeVon(entwurf) {
  return sicher(() => Math.round(playerOverall(entwurf)), 0, 'playerOverall');
}

function spielerName(p) {
  return `${p.firstName ? p.firstName + ' ' : ''}${p.lastName}`.trim() || p.id;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Löschprüfungen
 *
 * Beide Prüfungen beantworten dieselbe Frage von zwei Seiten: Was hängt noch
 * an diesem Datensatz? Beim Verein ist die Antwort hart – ein Verein, auf den
 * ein Spielplan zeigt, darf nicht verschwinden, sonst steht am nächsten
 * Spieltag eine Partie ohne Gastgeber im Kalender. Beim Spieler ist sie
 * weich: Eine Lücke in der Aufstellung füllt der Co-Trainer.
 * ════════════════════════════════════════════════════════════════════════ */

function vereinsBindungen(state, club) {
  const hart = [];
  const weich = [];
  if (club.id === state.managerClubId) hart.push('Sie sind der Trainer dieses Vereins.');

  const liga = ligaListeVon(state, club.id);
  if (liga) hart.push(`Der Verein steht in der Ligaliste „${ligaName(liga)}" – der Spielplan rechnet mit ihm.`);

  const spiele = (state.fixtures || []).filter(f => f.homeId === club.id || f.awayId === club.id);
  if (spiele.length) {
    const offen = spiele.filter(f => !f.played).length;
    hart.push(`${spiele.length} Spiele im Spielplan (${offen} davon noch offen).`);
  }

  if (state.europa && Array.isArray(state.europa.teilnehmer) &&
      state.europa.teilnehmer.some(t => (t && t.clubId ? t.clubId : t) === club.id)) {
    hart.push('Der Verein steht im Europapokalfeld.');
  }

  const kader = (club.playerIds || []).length;
  const talente = (club.youth && club.youth.talente ? club.youth.talente : []).length;
  const stab = (club.staffIds || []).length;
  if (kader || talente || stab) {
    weich.push(`${kader} Spieler, ${talente} Talente und ${stab} Mitarbeiter werden mitgelöscht.`);
  }
  return { hart, weich };
}

function spielerBindungen(state, player) {
  const weich = [];
  const club = player.clubId ? state.clubs[player.clubId] : null;
  const t = club && club.tactics;
  if (t && t.lineup) {
    for (const slot in t.lineup) {
      if (t.lineup[slot] === player.id) { weich.push(`Er steht in der Startelf (Position ${slot}).`); break; }
    }
  }
  if (t && Array.isArray(t.bench) && t.bench.indexOf(player.id) >= 0) weich.push('Er sitzt auf der Ersatzbank.');
  if (player.captain) weich.push('Er ist Mannschaftskapitän.');
  if (player.mentor) weich.push('Er hat einen Mentor.');
  if (Array.isArray(player.mentees) && player.mentees.length) {
    weich.push(`Er betreut ${player.mentees.length} Talent(e) als Mentor.`);
  }
  if (player.injury) weich.push('Er ist gerade verletzt gemeldet.');
  const spiele = (player.stats && player.stats.career && player.stats.career.spiele) || 0;
  if (spiele) weich.push(`${spiele} Pflichtspiele stehen in seiner Statistik – sie verschwinden mit ihm.`);
  return weich;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Schreiben in den Spielstand
 * ════════════════════════════════════════════════════════════════════════ */

function vereinSchreiben(state, club, entwurf) {
  club.name = entwurf.name;
  club.shortName = entwurf.shortName;
  club.abbr = entwurf.abbr;
  club.city = entwurf.city;
  club.founded = entwurf.founded;
  club.colors = deepClone(entwurf.colors);
  club.kit = deepClone(entwurf.kit);
  club.awayKit = deepClone(entwurf.awayKit);
  club.crest = deepClone(entwurf.crest);
  club.reputation = entwurf.reputation;
  club.boardName = entwurf.boardName;
  club.history = deepClone(entwurf.history);
  club.stadium = Object.assign({}, club.stadium || {}, entwurf.stadium);
  if (club.board) club.board.name = entwurf.boardName;
  clearCrestCache();
  clearPortraitCache();   // Portraits tragen die Trikotfarben im Hintergrund.
}

function spielerSchreiben(state, player, entwurf) {
  player.firstName = entwurf.firstName;
  player.lastName = entwurf.lastName;
  player.shortName = entwurf.shortName || entwurf.lastName;
  player.nationality = entwurf.nationality;
  player.age = entwurf.age;
  player.era = entwurf.era;
  player.eraLabel = entwurf.eraLabel || null;
  player.position = entwurf.position;
  player.altPositions = entwurf.altPositions.slice();
  player.attributes = deepClone(entwurf.attributes);
  player.potential = Math.max(entwurf.potential, staerkeVon(entwurf));
  player.foot = entwurf.foot;
  player.traits = entwurf.traits.slice();
  player.appearance = deepClone(entwurf.appearance);
  player.number = entwurf.number;
  player.contract = Object.assign({}, player.contract || {}, entwurf.contract);
  player.value = entwurf.value;
  clearPortraitCache();
}

/** Nimmt einen Spieler restlos aus dem Spielstand – inklusive aller Verweise. */
function spielerEntfernen(state, player) {
  const id = player.id;
  const club = player.clubId ? state.clubs[player.clubId] : null;
  if (club) {
    if (Array.isArray(club.playerIds)) club.playerIds = club.playerIds.filter(x => x !== id);
    if (club.youth && Array.isArray(club.youth.talente)) {
      club.youth.talente = club.youth.talente.filter(x => x !== id);
    }
    if (Array.isArray(club.transferliste)) club.transferliste = club.transferliste.filter(x => x !== id);
    if (Array.isArray(club.beobachtet)) {
      club.beobachtet = club.beobachtet.filter(e => (e && e.playerId ? e.playerId : e) !== id);
    }
    const t = club.tactics;
    if (t) {
      if (t.lineup) for (const slot in t.lineup) if (t.lineup[slot] === id) delete t.lineup[slot];
      if (Array.isArray(t.bench)) t.bench = t.bench.filter(x => x !== id);
      if (t.roles && t.roles[id]) delete t.roles[id];
      if (t.manMarking && t.manMarking[id]) delete t.manMarking[id];
    }
    // Das Paargitter der Kabine ist nach der Spieler-Id verschlüsselt.
    if (club.chemie && club.chemie.paare) {
      for (const key in club.chemie.paare) {
        if (String(key).indexOf(id) >= 0) delete club.chemie.paare[key];
      }
    }
  }
  if (Array.isArray(state.freeAgents)) state.freeAgents = state.freeAgents.filter(x => x !== id);

  // Mentorenbögen aus Stufe 4: Wer den Zögling löscht, muss den Mentor
  // entlasten – sonst zeigt die Kabine auf einen Spieler, den es nicht gibt.
  for (const pid in state.players) {
    const p = state.players[pid];
    if (!p || pid === id) continue;
    if (p.mentor === id) p.mentor = null;
    if (Array.isArray(p.mentees) && p.mentees.indexOf(id) >= 0) {
      p.mentees = p.mentees.filter(x => x !== id);
    }
  }
  delete state.players[id];
  clearPortraitCache();
}

function vereinEntfernen(state, club) {
  for (const pid of (club.playerIds || []).slice()) {
    const p = state.players[pid];
    if (p) spielerEntfernen(state, p);
  }
  for (const tid of ((club.youth && club.youth.talente) || []).slice()) {
    const p = state.players[tid];
    if (p) spielerEntfernen(state, p);
  }
  for (const sid of (club.staffIds || []).slice()) delete state.staff[sid];
  delete state.clubs[club.id];
  clearCrestCache();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6. Neuanlagen
 * ════════════════════════════════════════════════════════════════════════ */

function vereinAnlegen(state, name) {
  const id = freieId(state.clubs, 'v-' + (slug(name) || 'neu'));
  const club = deepClone(clubStammdaten({
    id, name, shortName: name.slice(0, 18), city: name,
    abbr: name.replace(/[^A-Za-zÄÖÜäöü]/g, '').slice(0, 3).toUpperCase() || 'NEU',
    stadium: { name: `Stadion an der ${name}`, capacity: 12000 },
    reputation: 45
  }));
  club.leagueId = null;
  initClubRuntime(club, rngFuer(state, 'club:' + id));
  club.playerIds = [];
  club.staffIds = [];
  club.tactics = null;
  state.clubs[id] = club;
  return club;
}

function spielerAnlegen(state, clubId, vorname, nachname, position) {
  const club = clubId ? state.clubs[clubId] : null;
  const id = freieId(state.players, `p_${clubId || 'frei'}_${slug(nachname) || 'neu'}`);
  const attribute = {};
  for (const key of ATTRIBUTES) attribute[key] = 45;
  const p = deepClone(playerStammdaten({
    id, clubId: clubId || null,
    firstName: vorname, lastName: nachname, shortName: nachname,
    position, attributes: attribute, age: 24, potential: 68,
    nationality: 'DE', era: 'modern',
    contract: { salary: 240000, until: 3, signOn: 0, releaseClause: null },
    value: 800000
  }));
  initPlayerRuntime(p, rngFuer(state, 'player:' + id));
  state.players[id] = p;
  if (club) {
    club.playerIds = club.playerIds || [];
    club.playerIds.push(id);
  } else {
    state.freeAgents = state.freeAgents || [];
    state.freeAgents.push(id);
  }
  return p;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. Vereinsliste
 * ════════════════════════════════════════════════════════════════════════ */

function vereineImBereich(state, bereich) {
  const alle = Object.values(state.clubs || {});
  if (bereich === 'alle') return alle;
  if (bereich === 'bl1' || bereich === 'bl2') {
    const liste = state.leagues && state.leagues[bereich] ? state.leagues[bereich].clubIds : [];
    return liste.map(id => state.clubs[id]).filter(Boolean);
  }
  if (bereich === 'europa') return alle.filter(c => c.istEuropaeisch);
  if (bereich === 'sonst') {
    return alle.filter(c => !c.istEuropaeisch && !ligaListeVon(state, c.id));
  }
  // 'liga': alles, was wirklich in einer Ligaliste steht
  return alle.filter(c => !!ligaListeVon(state, c.id));
}

function vereinsListe(state, ctx, aufAuswahl) {
  const kasten = el('div.tv-editor__liste');

  const suche = el('input.tv-editor__eingabe', {
    type: 'search', placeholder: 'Verein suchen …', value: ''
  });
  const bereichWahl = el('select.tv-editor__eingabe', {},
    ...BEREICHE.map(([v, t]) => el('option', { value: v, selected: v === zustand.bereich }, t)));
  const rollen = el('div.tv-editor__rollen');

  function fuellen() {
    rollen.innerHTML = '';
    const filter = suche.value.trim().toLowerCase();
    const clubs = vereineImBereich(state, zustand.bereich)
      .filter(c => !filter || `${c.name} ${c.shortName} ${c.abbr} ${c.city} ${c.id}`.toLowerCase().includes(filter))
      .sort((a, b) => (b.reputation || 0) - (a.reputation || 0) || String(a.name).localeCompare(b.name));

    if (!clubs.length) {
      rollen.appendChild(el('div.tv-leer', null, 'Kein Verein passt auf diese Suche.'));
      return;
    }
    for (const club of clubs) {
      const bild = el('img.tv-editor__wappen', { width: 26, height: 26, alt: '' });
      const url = sicher(() => crestDataURL(club, 52), '', 'crestDataURL');
      if (url) bild.src = url;
      const knopf = el('button.tv-editor__eintrag', {
        class: club.id === zustand.clubId ? 'aktiv' : null,
        type: 'button',
        onclick: () => { zustand.clubId = club.id; aufAuswahl(); }
      }, bild,
      el('span.tv-editor__eintrag-text', null,
        el('span.tv-editor__eintrag-titel', null, club.name),
        el('span.tv-editor__eintrag-unter', null,
          `${ligaName(ligaVonVerein(state, club.id))} · Ruf ${club.reputation || '–'} · ${(club.playerIds || []).length} Spieler`)));
      if (club.id === state.managerClubId) knopf.appendChild(pill('Ihr Verein', 'info'));
      rollen.appendChild(knopf);
    }
  }

  suche.addEventListener('input', fuellen);
  bereichWahl.addEventListener('change', () => { zustand.bereich = bereichWahl.value; fuellen(); });

  kasten.appendChild(el('div.tv-editor__suche', null, suche, bereichWahl));
  kasten.appendChild(rollen);
  kasten.appendChild(button('＋ Neuer Verein', () => vereinAnlegenDialog(ctx), { kind: 'primary', size: 'klein', wide: true }));
  fuellen();
  return kasten;
}

async function vereinAnlegenDialog(ctx) {
  const feld = el('input.tv-editor__eingabe', { type: 'text', maxlength: 60, placeholder: 'z. B. SV Blau-Weiß Traumstadt' });
  const ok = await dialog('Neuen Verein anlegen',
    el('div.tv-spalte', null,
      el('p.tv-mini', null,
        'Der Verein entsteht ohne Kader, ohne Stab und in keiner Liga. Das ist Absicht: ' +
        'Der Spielplan der laufenden Saison steht, und ein neunzehnter Verein in einer ' +
        'Achtzehnerliga wäre ein stiller Totalschaden. Spielen kann er ab der nächsten Saison.'),
      feldRahmen('Vereinsname', null, feld)),
    [{ label: 'Abbrechen', value: false, kind: 'ghost' }, { label: 'Anlegen', value: true, kind: 'primary' }],
    { size: 'sm', escValue: false });
  if (!ok) return;
  const name = feld.value.trim();
  if (!name) { toast('Ohne Namen kein Verein.', 'warn'); return; }
  const club = vereinAnlegen(ctx.state, name);
  zustand.clubId = club.id;
  zustand.bereich = 'sonst';
  toast(`„${club.name}" ist angelegt. Jetzt fehlt noch alles Übrige.`, 'gut');
  ctx.refresh();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8. Vereinsformular
 * ════════════════════════════════════════════════════════════════════════ */

function vereinsFormular(state, ctx, club, neuAufbauen) {
  const entwurf = clubStammdaten(club);
  let geaendert = false;

  const marke = el('span.tv-editor__marke', null, '');
  const setzeGeaendert = () => {
    geaendert = true;
    marke.textContent = '● ungespeichert';
  };

  /* --- Vorschau --------------------------------------------------------- */
  const cvWappen = leinwand(84, 84);
  const cvHeim = leinwand(72, 124);
  const cvAuswaerts = leinwand(72, 124);

  function zeichnen() {
    sicher(() => {
      const c = cvWappen.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cvWappen.width, cvWappen.height);
      drawCrest(c, entwurf, 84, 84, 158);
    }, null, 'drawCrest');
    for (const [cv, away] of [[cvHeim, false], [cvAuswaerts, true]]) {
      sicher(() => {
        const c = cv.getContext('2d');
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, cv.width, cv.height);
        drawKit(c, entwurf, 72, 124, 3.4, { away, full: true, number: 10 });
      }, null, 'drawKit');
    }
  }

  const aendern = () => { setzeGeaendert(); zeichnen(); };

  const vorschau = el('div.tv-editor__vorschau', null,
    el('div.tv-editor__vorschau-teil', null, cvWappen, el('span.tv-mini', null, 'Wappen')),
    el('div.tv-editor__vorschau-teil', null, cvHeim, el('span.tv-mini', null, 'Heim')),
    el('div.tv-editor__vorschau-teil', null, cvAuswaerts, el('span.tv-mini', null, 'Auswärts')));

  /* --- Felder ----------------------------------------------------------- */
  const stammdaten = subpanel('Stammdaten', gitter(
    feldText('Name', entwurf.name, v => { entwurf.name = v; aendern(); }),
    feldText('Kurzname', entwurf.shortName, v => { entwurf.shortName = v; aendern(); }, { max: 30 }),
    feldText('Kürzel', entwurf.abbr, v => { entwurf.abbr = v.toUpperCase(); aendern(); },
      { max: 5, hilfe: 'Drei Zeichen, so wie sie auf der Anzeigetafel stehen.' }),
    feldText('Stadt', entwurf.city, v => { entwurf.city = v; aendern(); }, { max: 40 }),
    feldZahl('Gegründet', entwurf.founded, v => { entwurf.founded = v; aendern(); }, { min: 1800, max: 2100 }),
    feldZahl('Reputation', entwurf.reputation, v => { entwurf.reputation = v; aendern(); },
      { min: 1, max: 100, hilfe: 'Steuert Gehälter, Sponsoren, Transferchancen und Vorstandserwartung.' }),
    feldText('Vorstand', entwurf.boardName, v => { entwurf.boardName = v; aendern(); }, { max: 50 })));

  const farben = subpanel('Farben und Trikot', gitter(
    feldFarbe('Hauptfarbe', entwurf.colors.primary, v => { entwurf.colors.primary = v; aendern(); }),
    feldFarbe('Zweitfarbe', entwurf.colors.secondary, v => { entwurf.colors.secondary = v; aendern(); }),
    feldFarbe('Akzent', entwurf.colors.accent, v => { entwurf.colors.accent = v; aendern(); }),
    feldAuswahl('Muster Heim', entwurf.kit.pattern,
      KIT_PATTERNS.map(p => [p, MUSTER_NAMEN[p] || p]), v => { entwurf.kit.pattern = v; aendern(); }),
    feldFarbe('Hose', entwurf.kit.shorts, v => { entwurf.kit.shorts = v; aendern(); }),
    feldFarbe('Stutzen', entwurf.kit.socks, v => { entwurf.kit.socks = v; aendern(); }),
    feldFarbe('Auswärts Grundfarbe', entwurf.awayKit.primary, v => { entwurf.awayKit.primary = v; aendern(); }),
    feldFarbe('Auswärts Zweitfarbe', entwurf.awayKit.secondary, v => { entwurf.awayKit.secondary = v; aendern(); }),
    feldAuswahl('Muster Auswärts', entwurf.awayKit.pattern,
      KIT_PATTERNS.map(p => [p, MUSTER_NAMEN[p] || p]), v => { entwurf.awayKit.pattern = v; aendern(); })));

  const wappen = subpanel('Wappen', gitter(
    feldAuswahl('Grundform', entwurf.crest.shape,
      CREST_SHAPES.map(f => [f, FORM_NAMEN[f] || f]), v => { entwurf.crest.shape = v; aendern(); }),
    feldAuswahl('Motiv', entwurf.crest.motif,
      CREST_MOTIFS.map(m => [m, MOTIV_NAMEN[m] || m]), v => { entwurf.crest.motif = v; aendern(); }),
    feldFarbe('Wappengrund', entwurf.crest.bg, v => { entwurf.crest.bg = v; aendern(); }),
    feldFarbe('Wappenmotiv', entwurf.crest.fg, v => { entwurf.crest.fg = v; aendern(); }),
    feldZahl('Meistertitel', entwurf.history.titles, v => { entwurf.history.titles = v; aendern(); },
      { min: 0, max: 99, hilfe: 'Je drei Titel ein Stern über dem Wappen, höchstens fünf.' })));

  const stadion = subpanel('Stadion', gitter(
    feldText('Name', entwurf.stadium.name, v => { entwurf.stadium.name = v; aendern(); }),
    feldZahl('Kapazität', entwurf.stadium.capacity, v => { entwurf.stadium.capacity = v; aendern(); },
      { min: 500, max: 150000, step: 500 }),
    feldZahl('Stehplatzanteil (%)', Math.round(entwurf.stadium.standing * 100),
      v => { entwurf.stadium.standing = clamp(v, 0, 35) / 100; aendern(); },
      { min: 0, max: 35, hilfe: 'Vertraglich bei 35 % gedeckelt.' }),
    feldZahl('Ränge', entwurf.stadium.tiers, v => { entwurf.stadium.tiers = v; aendern(); }, { min: 1, max: 3 }),
    feldZahl('Flutlicht', entwurf.stadium.floodlight, v => { entwurf.stadium.floodlight = v; aendern(); },
      { min: 0, max: 5, hilfe: '0 = keins, 5 = Champions-League-tauglich.' }),
    feldZahl('Rasenzustand', entwurf.stadium.pitch, v => { entwurf.stadium.pitch = v; aendern(); }, { min: 20, max: 100 }),
    feldSchalter('Überdacht', entwurf.stadium.roof, v => { entwurf.stadium.roof = v; aendern(); })));

  /* --- Leiste ----------------------------------------------------------- */
  const bindungen = vereinsBindungen(state, club);

  const leiste = el('div.tv-editor__leiste', null,
    button('Übernehmen', () => {
      if (!entwurf.name.trim()) { toast('Ein Verein ohne Namen geht nicht.', 'warn'); return; }
      vereinSchreiben(state, club, entwurf);
      geaendert = false;
      marke.textContent = '';
      if (ctx.aktualisiere) ctx.aktualisiere();
      toast(`„${club.name}" ist übernommen.`, 'gut');
      // Neu zeichnen statt nur das Formular: Der neue Name, das neue Wappen
      // und die neue Reputation stehen auch links in der Liste und oben im
      // Rahmen – sonst zeigt die eine Hälfte des Bildschirms noch gestern an.
      ctx.refresh();
    }, { kind: 'primary' }),
    button('Verwerfen', () => {
      if (!geaendert) { toast('Es gibt nichts zu verwerfen.', 'info'); return; }
      neuAufbauen();
    }, { kind: 'ghost' }),
    el('div.tv-editor__spacer'),
    marke,
    button('Löschen', async () => {
      if (bindungen.hart.length) {
        await dialog('Dieser Verein lässt sich nicht löschen',
          el('div.tv-spalte', null,
            el('p', null, `„${club.name}" hängt noch an der laufenden Saison:`),
            el('ul.tv-editor__gruende', null, ...bindungen.hart.map(g => el('li', null, g))),
            el('p.tv-mini', null,
              'Löschen würde einen Spielplan hinterlassen, der auf einen Verein zeigt, den es ' +
              'nicht mehr gibt. Neu angelegte Vereine ohne Liga und ohne Spiele lassen sich ' +
              'jederzeit wieder entfernen.')),
          [{ label: 'Verstanden', value: true }], { size: 'sm' });
        return;
      }
      const ja = await rueckfrage(`„${club.name}" löschen?`,
        ['Der Verein wird restlos aus dem Spielstand entfernt.']
          .concat(bindungen.weich).join(' '), { immer: true });
      if (!ja) return;
      vereinEntfernen(state, club);
      zustand.clubId = null;
      toast(`„${club.name}" ist Geschichte.`, 'info');
      ctx.refresh();
    }, { kind: 'danger', size: 'klein' }));

  const kopf = el('div.tv-editor__formkopf', null,
    el('div', null,
      el('h3.tv-editor__formtitel', null, club.name),
      el('div.tv-mini', null,
        `Kennung ${club.id} · ${ligaName(ligaVonVerein(state, club.id))} · ` +
        `${(club.playerIds || []).length} Spieler im Kader`)),
    vorschau);

  const form = el('div.tv-editor__form', null,
    kopf,
    bindungen.hart.length
      ? null
      : hinweis('Dieser Verein hängt an keinem Spielplan – er lässt sich auch wieder löschen.'),
    stammdaten, farben, wappen, stadion,
    leiste);

  zeichnen();
  return form;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 9. Der Vereinsreiter
 * ════════════════════════════════════════════════════════════════════════ */

function reiterVereine(ctx) {
  const state = ctx.state;
  const rechts = el('div.tv-editor__platz');

  function formularNeu() {
    rechts.innerHTML = '';
    const club = zustand.clubId ? state.clubs[zustand.clubId] : null;
    if (!club) {
      rechts.appendChild(el('div.tv-leer', null,
        'Links einen Verein wählen – oder unten einen neuen anlegen.'));
      return;
    }
    rechts.appendChild(vereinsFormular(state, ctx, club, formularNeu));
  }

  const links = vereinsListe(state, ctx, formularNeu);
  formularNeu();
  return el('div.tv-editor__werkbank', null, links, rechts);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 10. Spielerliste
 * ════════════════════════════════════════════════════════════════════════ */

function kaderListe(state, ctx, aufAuswahl) {
  const kasten = el('div.tv-editor__liste');

  // Zur Auswahl steht jeder Verein mit Kader, jeder Ligaverein – und jeder
  // handgemachte Verein ohne Kader. Der letzte Fall ist der wichtige: Wer
  // gerade einen Verein angelegt hat, will ihm Spieler geben, und genau dann
  // hat er noch keine. Draußen bleiben nur die Statisten, deren Kader erst
  // beim ersten Spiel entsteht (Amateure, Europapokal).
  const clubs = Object.values(state.clubs)
    .filter(c => (c.playerIds || []).length || ligaListeVon(state, c.id) ||
      (!c.istEuropaeisch && !c.istAmateur))
    .sort((a, b) => String(a.name).localeCompare(b.name));

  // null heißt „noch nie gewählt", '' heißt bewusst „Vertragslose".
  if (zustand.kaderClubId === null || (zustand.kaderClubId && !state.clubs[zustand.kaderClubId])) {
    zustand.kaderClubId = state.managerClubId;
  }

  const clubWahl = el('select.tv-editor__eingabe', {},
    el('option', { value: '', selected: zustand.kaderClubId === '' }, 'Vertragslose Spieler'),
    ...clubs.map(c => el('option', { value: c.id, selected: c.id === zustand.kaderClubId },
      `${c.name} (${(c.playerIds || []).length})`)));

  const suche = el('input.tv-editor__eingabe', { type: 'search', placeholder: 'Spieler suchen …' });
  const rollen = el('div.tv-editor__rollen');

  function kader() {
    if (!zustand.kaderClubId) {
      return (state.freeAgents || []).map(id => state.players[id]).filter(Boolean);
    }
    const club = state.clubs[zustand.kaderClubId];
    if (!club) return [];
    const talente = (club.youth && club.youth.talente) || [];
    return (club.playerIds || []).concat(talente).map(id => state.players[id]).filter(Boolean);
  }

  function fuellen() {
    rollen.innerHTML = '';
    const filter = suche.value.trim().toLowerCase();
    const liste = kader()
      .filter(p => !filter || `${spielerName(p)} ${p.position} ${p.nationality} ${p.id}`.toLowerCase().includes(filter))
      .sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) ||
        staerkeVon(b) - staerkeVon(a));

    if (!liste.length) {
      rollen.appendChild(el('div.tv-leer', null, 'Kein Spieler in dieser Auswahl.'));
      return;
    }
    for (const p of liste) {
      const ovr = staerkeVon(p);
      const knopf = el('button.tv-editor__eintrag', {
        class: p.id === zustand.playerId ? 'aktiv' : null,
        type: 'button',
        onclick: () => { zustand.playerId = p.id; aufAuswahl(); }
      },
      el('span.tv-editor__nummer', null, String(p.number || '–')),
      el('span.tv-editor__eintrag-text', null,
        el('span.tv-editor__eintrag-titel', null, spielerName(p)),
        el('span.tv-editor__eintrag-unter', null,
          `${p.position} · ${p.age} Jahre · ${NATION_NAMES[p.nationality] || p.nationality}` +
          (p.jugend ? ' · Nachwuchs' : ''))),
      el('span.tv-editor__staerke', { class: ratingClass(ovr) }, String(ovr)));
      if (p.era === 'legend') knopf.appendChild(pill('Legende', 'legende'));
      rollen.appendChild(knopf);
    }
  }

  clubWahl.addEventListener('change', () => {
    zustand.kaderClubId = clubWahl.value;
    zustand.playerId = null;
    fuellen();
    aufAuswahl();
  });
  suche.addEventListener('input', fuellen);

  kasten.appendChild(el('div.tv-editor__suche', null, clubWahl, suche));
  kasten.appendChild(rollen);
  kasten.appendChild(button('＋ Neuer Spieler', () => spielerAnlegenDialog(ctx), { kind: 'primary', size: 'klein', wide: true }));
  fuellen();
  return kasten;
}

async function spielerAnlegenDialog(ctx) {
  const state = ctx.state;
  const vn = el('input.tv-editor__eingabe', { type: 'text', maxlength: 40, placeholder: 'Vorname' });
  const nn = el('input.tv-editor__eingabe', { type: 'text', maxlength: 40, placeholder: 'Nachname' });
  const pos = el('select.tv-editor__eingabe', {},
    ...POSITIONS.map(p => el('option', { value: p, selected: p === 'ZM' }, `${p} – ${POSITION_NAMES[p]}`)));

  const ok = await dialog('Neuen Spieler anlegen',
    el('div.tv-spalte', null,
      el('p.tv-mini', null,
        `Er kommt mit 45 in allen Attributen, 24 Jahren und einem Dreijahresvertrag zur Welt. ` +
        `Alles Weitere stellen Sie danach im Formular ein. Verein: ` +
        `${zustand.kaderClubId ? state.clubs[zustand.kaderClubId].name : 'ohne Verein (vertragslos)'}.`),
      gitter(
        feldRahmen('Vorname', null, vn),
        feldRahmen('Nachname', null, nn),
        feldRahmen('Position', null, pos))),
    [{ label: 'Abbrechen', value: false, kind: 'ghost' }, { label: 'Anlegen', value: true, kind: 'primary' }],
    { size: 'sm', escValue: false });
  if (!ok) return;
  if (!nn.value.trim()) { toast('Ohne Nachnamen kein Spieler.', 'warn'); return; }

  const p = spielerAnlegen(state, zustand.kaderClubId || null, vn.value.trim(), nn.value.trim(), pos.value);
  zustand.playerId = p.id;
  toast(`${spielerName(p)} steht im Kader. Jetzt braucht er noch Fähigkeiten.`, 'gut');
  ctx.refresh();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 11. Spielerformular
 * ════════════════════════════════════════════════════════════════════════ */

function spielerFormular(state, ctx, player, neuAufbauen) {
  const entwurf = playerStammdaten(player);
  const club = player.clubId ? state.clubs[player.clubId] : null;
  let geaendert = false;

  const marke = el('span.tv-editor__marke', null, '');
  const setzeGeaendert = () => { geaendert = true; marke.textContent = '● ungespeichert'; };

  /* --- Vorschau --------------------------------------------------------- */
  const cvPortrait = leinwand(132, 132);
  const staerkeAnzeige = el('span.tv-editor__ovr', null, '0');

  function zeichnen() {
    sicher(() => {
      const c = cvPortrait.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cvPortrait.width, cvPortrait.height);
      drawPortrait(c, entwurf, 132, 132, 264, { club, age: entwurf.age });
    }, null, 'drawPortrait');
    const ovr = staerkeVon(entwurf);
    staerkeAnzeige.textContent = String(ovr);
    staerkeAnzeige.className = 'tv-editor__ovr ' + ratingClass(ovr);
  }
  const aendern = () => { setzeGeaendert(); zeichnen(); };

  /* --- Stammdaten ------------------------------------------------------- */
  const nationen = Object.keys(NATION_NAMES).sort((a, b) => NATION_NAMES[a].localeCompare(NATION_NAMES[b]));

  const stammdaten = subpanel('Stammdaten', gitter(
    feldText('Vorname', entwurf.firstName, v => { entwurf.firstName = v; aendern(); }, { max: 40 }),
    feldText('Nachname', entwurf.lastName, v => { entwurf.lastName = v; aendern(); }, { max: 40 }),
    feldText('Anzeigename', entwurf.shortName, v => { entwurf.shortName = v; aendern(); },
      { max: 40, hilfe: 'Was in Tabellen und im Ticker steht.' }),
    feldZahl('Alter', entwurf.age, v => { entwurf.age = v; aendern(); }, { min: 15, max: 45 }),
    feldAuswahl('Nation', entwurf.nationality,
      nationen.map(n => [n, `${NATION_NAMES[n]} (${n})`]), v => { entwurf.nationality = v; aendern(); }),
    feldAuswahl('Position', entwurf.position,
      POSITIONS.map(p => [p, `${p} – ${POSITION_NAMES[p]}`]), v => { entwurf.position = v; aendern(); },
      { hilfe: 'Entscheidet, welche Attribute in die Stärke einfließen.' }),
    feldAuswahl('Starker Fuß', entwurf.foot, FUESSE, v => { entwurf.foot = v; aendern(); }),
    feldZahl('Rückennummer', entwurf.number, v => { entwurf.number = v; aendern(); }, { min: 0, max: 99 }),
    feldZahl('Potenzial', entwurf.potential, v => { entwurf.potential = v; aendern(); },
      { min: 1, max: 99, hilfe: 'Obergrenze der Entwicklung. Unter der aktuellen Stärke wirkungslos.' }),
    feldAuswahl('Ära', entwurf.era, AEREN, v => { entwurf.era = v; aendern(); },
      { hilfe: 'Legenden ziehen Chemie, Mentorenbögen und Ära-Konflikte nach sich.' }),
    feldText('Ära-Beschriftung', entwurf.eraLabel || '', v => { entwurf.eraLabel = v || null; aendern(); },
      { max: 40, platzhalter: 'z. B. „Weltmeister 1974"' })));

  /* --- Nebenpositionen -------------------------------------------------- */
  const nebenKasten = el('div.tv-editor__merkmale');
  for (const p of POSITIONS) {
    const box = el('input.tv-editor__haken', {
      type: 'checkbox', checked: entwurf.altPositions.indexOf(p) >= 0,
      onchange: e => {
        entwurf.altPositions = e.target.checked
          ? entwurf.altPositions.concat([p]).slice(0, 4)
          : entwurf.altPositions.filter(x => x !== p);
        aendern();
      }
    });
    nebenKasten.appendChild(el('label.tv-editor__merkmal', null, box, el('span', null, p)));
  }

  /* --- Eigenschaften ---------------------------------------------------- */
  const traitKasten = el('div.tv-editor__merkmale');
  for (const key of Object.keys(TRAITS)) {
    const t = TRAITS[key];
    const box = el('input.tv-editor__haken', {
      type: 'checkbox', checked: entwurf.traits.indexOf(key) >= 0,
      onchange: e => {
        entwurf.traits = e.target.checked
          ? entwurf.traits.concat([key])
          : entwurf.traits.filter(x => x !== key);
        aendern();
      }
    });
    traitKasten.appendChild(el('label.tv-editor__merkmal', { title: t.desc },
      box, el('span', null, `${t.icon} ${t.name}`)));
  }

  const eigenschaften = subpanel('Nebenpositionen und Eigenschaften',
    el('div.tv-spalte', null,
      el('div.tv-mini', null, 'Nebenpositionen (höchstens vier) – dort spielt er ohne vollen Abzug.'),
      nebenKasten,
      el('div.tv-trenner'),
      el('div.tv-mini', null, 'Eigenschaften wirken in Spiel, Kabine und Transfermarkt.'),
      traitKasten));

  /* --- Aussehen --------------------------------------------------------- */
  const aussehen = subpanel('Aussehen', gitter(
    feldAuswahl('Hautton', entwurf.appearance.skin,
      SKIN_TONES.map((t, i) => [i, `Ton ${i + 1}`]), v => { entwurf.appearance.skin = Number(v); aendern(); }),
    feldAuswahl('Gesichtsform', entwurf.appearance.face,
      FACE_SHAPES.map((f, i) => [i, f.name]), v => { entwurf.appearance.face = Number(v); aendern(); }),
    feldAuswahl('Frisur', entwurf.appearance.hair,
      HAIR_STYLES.map(h => [h, h]), v => { entwurf.appearance.hair = v; aendern(); }),
    feldFarbe('Haarfarbe', entwurf.appearance.hairColor, v => { entwurf.appearance.hairColor = v; aendern(); }),
    feldAuswahl('Bart', entwurf.appearance.beard,
      BEARD_STYLES.map(b => [b, b]), v => { entwurf.appearance.beard = v; aendern(); }),
    feldFarbe('Augenfarbe', entwurf.appearance.eyes, v => { entwurf.appearance.eyes = v; aendern(); }),
    feldAuswahl('Statur', entwurf.appearance.build, BAUARTEN, v => { entwurf.appearance.build = v; aendern(); }),
    feldZahl('Körpergröße (cm)', entwurf.appearance.height,
      v => { entwurf.appearance.height = v; aendern(); }, { min: 150, max: 215 }),
    feldAuswahl('Accessoire', entwurf.appearance.accessory, ACCESSOIRES,
      v => { entwurf.appearance.accessory = v; aendern(); })));

  /* --- Attribute -------------------------------------------------------- */
  const attributGruppen = el('div.tv-spalte');
  for (const gruppe of Object.keys(ATTRIBUTE_GROUPS)) {
    const zeilen = el('div.tv-editor__attr');
    for (const key of ATTRIBUTE_GROUPS[gruppe]) {
      const zahl = el('input.tv-editor__eingabe.tv-editor__eingabe--zahl', {
        type: 'number', min: '1', max: '99', value: String(entwurf.attributes[key])
      });
      const regler = el('input.tv-editor__regler', {
        type: 'range', min: '1', max: '99', value: String(entwurf.attributes[key])
      });
      const uebernehmen = (v) => {
        const n = clamp(Math.round(Number(v) || 1), 1, 99);
        entwurf.attributes[key] = n;
        zahl.value = String(n);
        regler.value = String(n);
        aendern();
      };
      zahl.addEventListener('input', () => uebernehmen(zahl.value));
      regler.addEventListener('input', () => uebernehmen(regler.value));
      zeilen.appendChild(el('div.tv-editor__attr-zeile', null,
        el('span.tv-editor__attr-name', null, ATTRIBUTE_NAMES[key] || key),
        regler, zahl));
    }
    attributGruppen.appendChild(subpanel(gruppe, zeilen));
  }
  const attribute = subpanel('Attribute',
    el('div.tv-spalte', null,
      el('div.tv-mini', null,
        'Die Stärke oben rechts rechnet sofort mit: Sie ist die positionsgewichtete Summe ' +
        'dieser zwanzig Werte, nichts anderes. Die Torwartwerte zählen nur für Torhüter.'),
      attributGruppen));

  /* --- Vertrag ---------------------------------------------------------- */
  const vertrag = subpanel('Vertrag und Marktwert', gitter(
    feldZahl('Jahresgehalt (€)', entwurf.contract.salary,
      v => { entwurf.contract.salary = v; aendern(); }, { min: 0, max: 100000000, step: 10000 }),
    feldZahl('Laufzeit (Jahre)', entwurf.contract.until,
      v => { entwurf.contract.until = v; aendern(); }, { min: 0, max: 12 }),
    feldZahl('Handgeld (€)', entwurf.contract.signOn,
      v => { entwurf.contract.signOn = v; aendern(); }, { min: 0, max: 100000000, step: 10000 }),
    feldZahl('Ausstiegsklausel (€)', entwurf.contract.releaseClause || 0,
      v => { entwurf.contract.releaseClause = v > 0 ? v : null; aendern(); },
      { min: 0, max: 1000000000, step: 100000, hilfe: '0 = keine Klausel.' }),
    feldZahl('Marktwert (€)', entwurf.value,
      v => { entwurf.value = v; aendern(); }, { min: 0, max: 1000000000, step: 50000 })));

  /* --- Leiste ----------------------------------------------------------- */
  const bindungen = spielerBindungen(state, player);

  const leiste = el('div.tv-editor__leiste', null,
    button('Übernehmen', () => {
      if (!entwurf.lastName.trim()) { toast('Ein Spieler ohne Nachnamen geht nicht.', 'warn'); return; }
      spielerSchreiben(state, player, entwurf);
      geaendert = false;
      marke.textContent = '';
      toast(`${spielerName(player)} ist übernommen.`, 'gut');
      ctx.refresh();   // Name, Nummer und Stärke stehen auch in der Liste links.
    }, { kind: 'primary' }),
    button('Verwerfen', () => {
      if (!geaendert) { toast('Es gibt nichts zu verwerfen.', 'info'); return; }
      neuAufbauen();
    }, { kind: 'ghost' }),
    el('div.tv-editor__spacer'),
    marke,
    button('Löschen', async () => {
      const text = bindungen.length
        ? `${spielerName(player)} wird restlos aus dem Spielstand entfernt. Noch offen: ${bindungen.join(' ')}`
        : `${spielerName(player)} wird restlos aus dem Spielstand entfernt.`;
      const ja = await rueckfrage(`${spielerName(player)} löschen?`, text, { immer: true });
      if (!ja) return;
      spielerEntfernen(state, player);
      zustand.playerId = null;
      toast(`${spielerName(player)} ist gestrichen.`, 'info');
      ctx.refresh();
    }, { kind: 'danger', size: 'klein' }));

  const kopf = el('div.tv-editor__formkopf', null,
    el('div', null,
      el('h3.tv-editor__formtitel', null, spielerName(player)),
      el('div.tv-mini', null,
        `Kennung ${player.id} · ${club ? club.name : 'vertragslos'} · ` +
        `Marktwert ${formatMoney(player.value || 0)} · Gehalt ${formatMoney((player.contract || {}).salary || 0)}/Jahr`),
      bindungen.length
        ? el('div.tv-mini', null, bindungen.join(' '))
        : null),
    el('div.tv-editor__vorschau', null,
      el('div.tv-editor__vorschau-teil', null, cvPortrait, el('span.tv-mini', null, 'Portrait')),
      el('div.tv-editor__vorschau-teil', null, staerkeAnzeige, el('span.tv-mini', null, 'Stärke'))));

  const form = el('div.tv-editor__form', null,
    kopf, stammdaten, aussehen, attribute, eigenschaften, vertrag, leiste);

  zeichnen();
  return form;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 12. Der Spielerreiter
 * ════════════════════════════════════════════════════════════════════════ */

function reiterSpieler(ctx) {
  const state = ctx.state;
  const rechts = el('div.tv-editor__platz');

  function formularNeu() {
    rechts.innerHTML = '';
    const p = zustand.playerId ? state.players[zustand.playerId] : null;
    if (!p) {
      rechts.appendChild(el('div.tv-leer', null,
        'Links einen Verein und darin einen Spieler wählen – oder einen neuen anlegen.'));
      return;
    }
    rechts.appendChild(spielerFormular(state, ctx, p, formularNeu));
  }

  const links = kaderListe(state, ctx, formularNeu);
  formularNeu();
  return el('div.tv-editor__werkbank', null, links, rechts);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 13. Austausch – Stammdaten als Datei
 * ════════════════════════════════════════════════════════════════════════ */

function dateiAnbieten(name, inhalt) {
  const blob = new Blob([inhalt], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function protokoll(ergebnis) {
  const u = ergebnis.uebernommen || {};
  const kasten = el('div.tv-editor__protokoll');
  kasten.appendChild(el('div.tv-editor__protokoll-kopf',
    { class: ergebnis.ok ? null : 'tv-editor__protokoll-kopf--rot' },
    ergebnis.ok
      ? `Übernommen: ${u.vereine || 0} Vereine (${u.neueVereine || 0} neu), ` +
        `${u.spieler || 0} Spieler (${u.neueSpieler || 0} neu, ${u.umgezogen || 0} umgezogen).`
      : 'Nichts übernommen – der Spielstand ist unberührt geblieben.'));
  for (const f of (ergebnis.fehler || [])) {
    kasten.appendChild(el('div.tv-editor__protokoll-zeile', null, f));
  }
  if (!ergebnis.fehler || !ergebnis.fehler.length) {
    kasten.appendChild(el('div.tv-editor__protokoll-zeile', null, 'Keine Beanstandungen.'));
  }
  return kasten;
}

function reiterAustausch(ctx) {
  const state = ctx.state;

  /* --- Ausgabe ---------------------------------------------------------- */
  const umfang = { vereine: true, spieler: true, auswahl: 'liga' };
  const titelFeld = el('input.tv-editor__eingabe', {
    type: 'text', maxlength: 120, placeholder: 'z. B. „Kader Stand Sommer, von Jörg"'
  });

  const umfangWahl = [
    ['liga', 'Alle Vereine der beiden Ligen (36)'],
    ['eigen', 'Nur mein Verein'],
    ['gewaehlt', 'Nur der im Reiter „Vereine" gewählte Verein'],
    ['alle', 'Alles, was im Spielstand steht']
  ];

  function idsFuerUmfang() {
    if (umfang.auswahl === 'eigen') return [state.managerClubId];
    if (umfang.auswahl === 'gewaehlt') return zustand.clubId ? [zustand.clubId] : [];
    if (umfang.auswahl === 'alle') return Object.keys(state.clubs);
    return null;   // null = Vorgabe von exportStammdaten (alle Ligavereine)
  }

  const ausgabe = panel('Stammdaten ausgeben',
    el('div.tv-spalte', null,
      el('p.tv-mini', null,
        'Eine Stammdatendatei enthält Vereine und Spieler – und sonst nichts. Kein Tabellenstand, ' +
        'kein Kassenbuch, keine Verletzungen, kein Postfach. Wer seine Kader jemandem geben will, ' +
        'gibt genau diese Datei weiter; seine Karriere behält er für sich. Spielstände zum ' +
        'Weiterspielen gibt es weiterhin über den Knopf ⬇ oben rechts im Rahmen.'),
      gitter(
        feldAuswahl('Umfang', umfang.auswahl, umfangWahl, v => { umfang.auswahl = v; }),
        feldSchalter('Vereinsdaten mitschreiben', umfang.vereine, v => { umfang.vereine = v; }),
        feldSchalter('Kader mitschreiben', umfang.spieler, v => { umfang.spieler = v; }),
        feldRahmen('Beschriftung', 'Steht in der Datei und hilft dem Empfänger.', titelFeld)),
      el('div.tv-zeile', null,
        button('Datei erzeugen', () => {
          if (!umfang.vereine && !umfang.spieler) {
            toast('Ohne Vereine und ohne Spieler bleibt die Datei leer.', 'warn');
            return;
          }
          const ids = idsFuerUmfang();
          if (ids && !ids.length) {
            toast('Für diesen Umfang ist kein Verein gewählt.', 'warn');
            return;
          }
          const erg = sicher(() => exportStammdaten(state, {
            clubIds: ids || undefined,
            vereine: umfang.vereine,
            spieler: umfang.spieler,
            titel: titelFeld.value
          }), null, 'exportStammdaten');
          if (!erg) { toast('Die Datei ließ sich nicht erzeugen.', 'schlecht'); return; }
          // Erst melden, wenn der Browser die Datei wirklich angenommen hat –
          // eine Erfolgsmeldung über einen nicht erfolgten Download ist die
          // unangenehmste Sorte Lüge.
          const gereicht = sicher(() => { dateiAnbieten(erg.name, erg.inhalt); return true; }, false, 'dateiAnbieten');
          if (!gereicht) {
            toast('Der Browser hat die Datei nicht angenommen – Einzelheiten in der Konsole.', 'schlecht');
            return;
          }
          toast(`${erg.name} · ${nfmt(Math.round(erg.inhalt.length / 1024))} kB`, 'gut');
        }, { kind: 'primary' }))));

  /* --- Eingabe ---------------------------------------------------------- */
  const berichtPlatz = el('div.tv-editor__platz');

  function einlesen(text, quelle) {
    berichtPlatz.innerHTML = '';
    const erg = sicher(() => importStammdaten(state, text), null, 'importStammdaten');
    if (!erg) {
      berichtPlatz.appendChild(hinweis('Der Import ist an einer Stelle gescheitert, die nicht vorgesehen war. ' +
        'Der Spielstand ist unverändert; Einzelheiten stehen in der Browserkonsole.', 'rot'));
      return;
    }
    berichtPlatz.appendChild(protokoll(erg));
    if (erg.ok) {
      clearCrestCache();
      clearPortraitCache();
      if (ctx.aktualisiere) ctx.aktualisiere();
      toast(`${quelle} eingelesen.`, 'gut');
    } else {
      toast('Nichts übernommen – siehe Protokoll.', 'warn');
    }
  }

  const dateiFeld = el('input.tv-editor__eingabe', { type: 'file', accept: '.json,application/json' });
  dateiFeld.addEventListener('change', async () => {
    const datei = dateiFeld.files && dateiFeld.files[0];
    if (!datei) return;
    let text;
    try { text = await datei.text(); }
    catch (err) {
      berichtPlatz.innerHTML = '';
      berichtPlatz.appendChild(hinweis('Die Datei ließ sich nicht lesen: ' + (err && err.message), 'rot'));
      return;
    }
    einlesen(text, datei.name);
  });

  const feldZettel = el('textarea.tv-editor__zettel', {
    rows: 6, spellcheck: 'false',
    placeholder: 'Oder den Inhalt einer Stammdatendatei hier hereinkopieren …'
  });

  const eingabe = panel('Stammdaten einlesen',
    el('div.tv-spalte', null,
      el('p.tv-mini', null,
        'Der Import ist nachsichtig und laut zugleich: Unbekannte Felder werden übergangen, ' +
        'fehlende aus dem vorhandenen Datensatz ergänzt, Ungültiges namentlich gemeldet und ' +
        'übersprungen. Geschrieben wird erst, wenn die ganze Datei gelesen ist – eine kaputte ' +
        'Datei kann den Spielstand deshalb nicht halb umbauen. Es gibt kein „halb importiert".'),
      feldRahmen('Datei wählen', null, dateiFeld),
      feldRahmen('Zwischenablage', null, feldZettel),
      el('div.tv-zeile', null,
        button('Text einlesen', () => {
          const t = feldZettel.value.trim();
          if (!t) { toast('Das Feld ist leer.', 'warn'); return; }
          einlesen(t, 'Der eingefügte Text');
        }, { kind: 'primary', size: 'klein' }),
        button('Feld leeren', () => { feldZettel.value = ''; }, { kind: 'ghost', size: 'klein' })),
      berichtPlatz));

  return el('div.tv-editor__austausch', null, ausgabe, eingabe);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 14. Der Bildschirm
 * ════════════════════════════════════════════════════════════════════════ */

export const screen = {
  id: 'editor',
  title: 'Editor',
  icon: '✏️',

  render(root, ctx) {
    const state = ctx && ctx.state;
    if (!state || !state.clubs || !state.players) {
      root.appendChild(panel('Editor',
        el('div.tv-leer', { style: { color: 'var(--rot)', fontStyle: 'normal' } },
          'Kein Spielstand geladen – ohne Verein und ohne Kader gibt es nichts zu bearbeiten.')));
      return;
    }

    if (zustand.clubId === undefined || (zustand.clubId && !state.clubs[zustand.clubId])) {
      zustand.clubId = state.managerClubId;
    }
    zustand.ctx = ctx;

    root.appendChild(el('div.tv-editor', null,
      el('div.tv-editor__kopf', null,
        el('div', null,
          el('b', null, '✏️ Werkstatt'),
          el('div.tv-mini', null,
            'Alles hier greift SOFORT und DAUERHAFT in den laufenden Spielstand ein – ' +
            'es gibt kein Rückgängig. Wer sichergehen will, speichert vorher (Strg + S) oder ' +
            'sichert den Stand als Datei. Und noch etwas: Ein Kader, den Sie sich zurechtgelegt ' +
            'haben, gewinnt zwar leichter, aber er erzählt Ihnen abends nichts mehr.')),
        el('div.tv-mini', null, 'Zu erreichen über Strg + Umschalt + E.')),

      tabs([
        { id: 'vereine', label: 'Vereine', render: () => reiterVereine(ctx) },
        { id: 'spieler', label: 'Spieler', render: () => reiterSpieler(ctx) },
        { id: 'austausch', label: 'Austausch', render: () => reiterAustausch(ctx) }
      ], {
        active: zustand.reiter,
        keepAlive: false,
        onChange: id => { zustand.reiter = id; }
      })));
  },

  /**
   * Der Vertrag `screen.onEscape(): boolean` aus main.js:escapeKette – bis
   * Stufe 6 hat ihn kein Bildschirm bedient. Hier lohnt er sich: ESC gibt
   * erst das offene Formular frei und erst beim zweiten Anschlag den
   * Bildschirm. Wer in einem Kaderformular steht, will zurück zur Liste,
   * nicht sofort zurück ins Büro.
   */
  onEscape() {
    const zurueck = zustand.ctx && zustand.ctx.refresh;
    if (zustand.reiter === 'spieler' && zustand.playerId) {
      zustand.playerId = null;
      if (zurueck) zustand.ctx.refresh();
      return true;
    }
    if (zustand.reiter === 'vereine' && zustand.clubId) {
      zustand.clubId = null;
      if (zurueck) zustand.ctx.refresh();
      return true;
    }
    return false;
  },

  /**
   * Beim Verlassen bleiben keine gerenderten Wappen von gestern im
   * Zwischenspeicher – und der Bildschirm hält den Spielstand nicht länger
   * über `zustand.ctx` fest.
   */
  onLeave() {
    zustand.ctx = null;
    clearCrestCache();
    clearPortraitCache();
  }
};

export default screen;
