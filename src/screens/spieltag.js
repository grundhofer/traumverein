/**
 * screens/spieltag.js — Der Spieltag in drei Zuständen.
 *
 *   1. VORBERICHT   Paarung, Umfeld, Aufstellungen, Co-Trainer, Einstellungen, ANPFIFF
 *   2. LIVESPIEL    übernimmt vollständig game/matchday.js (wir reichen nur `root` durch)
 *   3. NACHBERICHT  Endstand, Torschützen, Statistik, Noten, Spielbericht, Konferenz
 *
 * Der Bildschirm rechnet nichts selbst: Ergebnisse kommen aus spielAustragen(),
 * Zuschauer/Wetter aus spielUmfeld() bzw. club/stadium.js, Ausfälle aus
 * club/medical.js, die Einschätzung vom Co-Trainer aus club/staff.js.
 *
 * game/matchday.js und core/loop.js werden absichtlich ERST BEI BEDARF geladen
 * (dynamischer Import). Beide hängen an engine/match.js; fehlt die Engine, soll
 * dieser Bildschirm trotzdem stehen und eine lesbare Meldung zeigen statt beim
 * Laden zu verrecken.
 */

import { MATCH_VIEW, MATCH_VIEW_NAMES, WEATHER, POSITION_NAMES, POSITION_GROUP } from '../core/constants.js';
import { clamp, round, nfmt, formatDate, formatDateShort } from '../core/util.js';
import { createRng } from '../core/rng.js';
import { myClub, squadOf, nextFixtureFor } from '../core/state.js';
import { LEAGUES, CUP } from '../data/leagues.js';
import { autoLineup, validateTactics, formationShape, FORMATIONS, STYLES } from '../engine/tactics.js';
import { playerOverall, teamStrength } from '../engine/ratings.js';
import { el, panel, button, table, pill, bar, statBox, toast, clearNode } from '../render/ui.js';
import { crestDataURL } from '../render/kits.js';
import { portraitDataURL } from '../render/portraits.js';
import { createPitchView } from '../render/pitch.js';
import { zuschauerBerechnen, derbyInfo, heimvorteil } from '../club/stadium.js';
import { lazarett } from '../club/medical.js';
import { englischeWoche } from '../club/media.js';
import { coTrainerRat } from '../club/staff.js';

/* ================================================================== *
 *  Modulzustand
 * ================================================================== */

/** Letztes selbst ausgetragenes Spiel – damit der Nachbericht Bestand hat. */
let letztesErgebnis = null;      // { fixtureId, season, result }

/** Läuft gerade eine Höhepunkte-Wiederholung? */
let hoehepunkte = null;          // { overlay, view, abbrechen }

/** Nachgeladene Module (engine-abhängig). */
let nachgeladen = null;

async function spielModule() {
  if (nachgeladen) return nachgeladen;
  try {
    const [matchday, loop] = await Promise.all([
      import('../game/matchday.js'),
      import('../core/loop.js')
    ]);
    nachgeladen = { ok: true, matchday, loop, fehler: null };
  } catch (err) {
    console.error('[spieltag] Spielmodule nicht ladbar:', err);
    nachgeladen = { ok: false, matchday: null, loop: null, fehler: err };
  }
  return nachgeladen;
}

/* ================================================================== *
 *  Kleine Bausteine
 * ================================================================== */

/**
 * ui.js baut Balken als „Kopf + Spur"; styles/main.css presst `.tv-bar`
 * aber auf einen 11-px-Einzelbalken mit overflow:hidden. Inline-Stile
 * gewinnen gegen beide Stylesheets und geben dem Baustein seine Form zurück.
 */
function balken(wert, max, opts = {}) {
  const b = bar(wert, max, opts);
  b.style.height = 'auto';
  b.style.background = 'none';
  b.style.border = '0';
  b.style.borderRadius = '0';
  b.style.overflow = 'visible';
  b.style.position = 'static';
  return b;
}

function wappen(club, size = 34) {
  const box = el('span', {
    style: {
      display: 'inline-flex', width: size + 'px', height: size + 'px',
      flex: `0 0 ${size}px`, alignItems: 'center', justifyContent: 'center'
    }
  });
  try {
    box.appendChild(el('img', {
      src: crestDataURL(club, Math.max(32, size * 2)),
      alt: club.abbr || club.name,
      style: { width: size + 'px', height: size + 'px', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.45))' }
    }));
  } catch (err) {
    box.appendChild(el('span', { class: 'tv-pill', style: { fontSize: '9px' } }, club.abbr || '???'));
  }
  return box;
}

function portrait(player, size = 30, extra = '') {
  try {
    return el('img', {
      class: 'tv-portrait ' + extra,
      src: portraitDataURL(player, Math.max(48, size * 2)),
      alt: player.shortName || player.lastName || '',
      style: { width: size + 'px', height: size + 'px', flex: `0 0 ${size}px` }
    });
  } catch (err) {
    return el('div', {
      class: 'tv-portrait ' + extra,
      style: { width: size + 'px', height: size + 'px', flex: `0 0 ${size}px` }
    });
  }
}

function formStreifen(form, anzahl = 5) {
  const arr = (form || []).slice(-anzahl);
  if (!arr.length) return el('span', { class: 'tv-mini' }, '– – – – –');
  return el('span', { class: 'tv-form' }, ...arr.map(z => el('span', { class: z }, z)));
}

function posPille(pos) {
  return el('span', { class: 'tv-pos tv-pos--' + (POSITION_GROUP[pos] || 'MIT'), title: POSITION_NAMES[pos] || pos }, pos);
}

function legendePille(p) {
  if (!p || p.era !== 'legend') return null;
  return pill(p.eraLabel || 'Legende', 'legende');
}

function spielerName(p) {
  const knoten = el('span', { class: 'tv-zeile', style: { gap: '5px' } },
    el('b', {}, p.shortName || p.lastName || '?'));
  const lg = legendePille(p);
  if (lg) knoten.appendChild(lg);
  return knoten;
}

function tabellenZeile(state, clubId) {
  const club = state.clubs[clubId];
  if (!club) return null;
  const t = state.tables[club.leagueId] || [];
  return t.find(z => z.clubId === clubId) || null;
}

function wettbewerbName(fixture) {
  if (!fixture) return '';
  if (LEAGUES[fixture.competitionId]) return LEAGUES[fixture.competitionId].name;
  if (fixture.competitionId === CUP.id) return `${CUP.name} · ${fixture.roundName || ''}`.trim();
  return fixture.competitionName || 'Europapokal';
}

function noteKlasse(note) {
  if (!(note > 0)) return '';
  if (note >= 8.5) return 'rat-elite-text';
  if (note >= 7.5) return 'rat-stark-text';
  if (note >= 6.5) return 'rat-gut-text';
  if (note >= 5.5) return 'rat-ok-text';
  if (note >= 4.5) return 'rat-schwach-text';
  return 'rat-mies-text';
}

function noteText(note) {
  return note > 0 ? round(note, 1).toFixed(1).replace('.', ',') : '–';
}

/**
 * Panelkopf mit rechtsbündiger Zusatzangabe.
 * ui.js rückt das letzte Kind der Kopfleiste automatisch nach rechts – dafür
 * müssen es aber zwei Geschwister sein, deshalb ein Array statt eines Wrappers.
 */
function panelKopf(titel, extra) {
  return [
    el('span', {}, titel),
    extra ? el('span', {
      class: 'tv-panel__extra',
      style: { marginLeft: 'auto', fontWeight: 400, letterSpacing: '.3px', textTransform: 'none', opacity: .9 }
    }, extra) : null
  ];
}

function fehlerKasten(titel, err) {
  return panel(titel,
    el('div', { class: 'tv-spalte' },
      el('p', {}, 'Hier hakt es. Der Rest des Bildschirms funktioniert weiter.'),
      el('pre', {
        class: 'tv-mini',
        style: { whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,.14)', padding: '7px', margin: 0 }
      }, String((err && err.message) || err || 'Unbekannter Fehler'))));
}

/** Schützt optionale Fremdaufrufe: liefert im Fehlerfall `fallback`. */
function versuche(fn, fallback = null, kontext = '') {
  try {
    return fn();
  } catch (err) {
    if (kontext) console.warn(`[spieltag] ${kontext}:`, err);
    return fallback;
  }
}

/* ================================================================== *
 *  Bildschirm
 * ================================================================== */

export const screen = {
  id: 'spieltag',
  title: 'Spieltag',
  icon: '⚽',

  async render(root, ctx) {
    const state = ctx.state;
    const club = myClub(state);
    if (!club) {
      root.appendChild(panel('Spieltag', el('div', { class: 'tv-leer' }, 'Kein Verein geladen.')));
      return;
    }

    const fixture = findeFixture(state, ctx.params);

    if (!fixture) {
      zeigeUebersicht(root, ctx, 'Kein Spiel in Sicht');
      return;
    }

    if (fixture.played) {
      const res = letztesErgebnis && letztesErgebnis.fixtureId === fixture.id &&
        letztesErgebnis.season === state.date.season ? letztesErgebnis.result : null;
      zeigeNachbericht(root, ctx, fixture, res);
      return;
    }

    await zeigeVorbericht(root, ctx, fixture);
  },

  onLeave() {
    if (hoehepunkte && hoehepunkte.abbrechen) hoehepunkte.abbrechen();
  }
};

function findeFixture(state, params) {
  if (params && params.fixture) {
    const f = state.fixtures.find(x => x.id === params.fixture);
    if (f) return f;
  }
  const naechstes = nextFixtureFor(state, state.managerClubId);
  if (naechstes) return naechstes;
  if (letztesErgebnis) {
    const f = state.fixtures.find(x => x.id === letztesErgebnis.fixtureId);
    if (f) return f;
  }
  return state.fixtures
    .filter(f => f.played && (f.homeId === state.managerClubId || f.awayId === state.managerClubId))
    .sort((a, b) => b.dayIndex - a.dayIndex)[0] || null;
}

/* ================================================================== *
 *  1. VORBERICHT
 * ================================================================== */

async function zeigeVorbericht(root, ctx, fixture) {
  const state = ctx.state;
  const club = myClub(state);
  const heim = state.clubs[fixture.homeId];
  const gast = state.clubs[fixture.awayId];
  const eigenHeim = fixture.homeId === club.id;
  const gegner = eigenHeim ? gast : heim;

  if (!heim || !gast) {
    root.appendChild(panel('Vorbericht', el('div', { class: 'tv-leer' },
      'Zu dieser Partie fehlen die Vereinsdaten. Sehr mysteriös.')));
    return;
  }

  const mod = await spielModule();
  const rng = versuche(() => mod.ok
    ? mod.loop.makeCtx(state).rng.fork('spiel:' + fixture.id)
    : createRng(`${state.seed}:vorschau:${fixture.id}`),
  createRng(`${state.seed}:vorschau:${fixture.id}`), 'RNG');

  // Die Ansetzung hängt allein an der Fixture-ID – sie steht auch dann, wenn
  // das Spielumfeld nicht berechnet werden konnte, und gilt rückwirkend für
  // jede alte Partie (daraus entsteht unten die Bilanz).
  const ansetzung = mod.ok && mod.matchday.schiedsrichterFuer ? mod.matchday.schiedsrichterFuer : null;

  let umfeld = null;
  if (mod.ok) umfeld = versuche(() => mod.matchday.spielUmfeld(state, fixture, rng), null, 'spielUmfeld');
  if (!umfeld) umfeld = ersatzUmfeld(state, fixture, rng, ansetzung);

  const seite = el('div', { class: 'tv-seite' });
  const tage = fixture.dayIndex - state.date.day;
  seite.appendChild(el('div', { class: 'tv-seite__kopf' },
    el('h1', { class: 'tv-seite__titel' }, 'Vorbericht'),
    el('div', { class: 'tv-seite__unter' },
      `${wettbewerbName(fixture)}${fixture.matchday && LEAGUES[fixture.competitionId] ? `, ${fixture.matchday}. Spieltag` : ''} · ` +
      `${formatDate(fixture.dayIndex, fixture.season || state.date.season)} · ` +
      (tage <= 0 ? 'heute wird gespielt' : tage === 1 ? 'morgen geht es los' : `noch ${tage} Tage`))));

  seite.appendChild(paarungsPanel(state, fixture, heim, gast, club, umfeld));

  seite.appendChild(el('div', { class: 'tv-grid tv-grid--haupt' },
    el('div', { class: 'tv-spalte' },
      aufstellungsPanel(ctx, fixture, club, gegner, eigenHeim),
      statistikVorPanel(state, fixture, heim, gast, club)),
    el('div', { class: 'tv-spalte' },
      umfeldPanel(state, fixture, heim, gast, umfeld),
      versuche(() => schiriPanel(state, fixture, club, umfeld, ansetzung, eigenHeim), null, 'schiriPanel'),
      coTrainerPanel(state, club, gegner),
      ausfallPanel(state, club, gegner),
      einstellungsPanel(ctx))));

  const anpfiffBtn = button('⚽ ANPFIFF', null, { kind: 'primary', size: 'gross' });
  anpfiffBtn.addEventListener('click', async () => {
    anpfiffBtn.disabled = true;
    anpfiffBtn.textContent = 'Die Mannschaften betreten den Platz …';
    await anpfiff(root, ctx, fixture);
  });

  seite.appendChild(panel('Und jetzt?',
    el('div', { class: 'tv-zeile', style: { justifyContent: 'center', flexWrap: 'wrap', gap: '10px' } },
      button('📋 Taktik anpassen', () => ctx.navigate('taktik'), { kind: 'blau' }),
      button('👥 Kader ansehen', () => ctx.navigate('kader'), { kind: 'ghost' }),
      button('📊 Tabelle', () => ctx.navigate('tabelle'), { kind: 'ghost' }),
      anpfiffBtn)));

  seite.appendChild(terminPanel(state, club));

  if (!mod.ok) {
    seite.insertBefore(panel('Spielmodule fehlen',
      el('div', { class: 'tv-spalte' },
        el('p', {}, 'Die Match-Engine (src/engine/match.js) ist nicht ladbar. ' +
          'Vorbericht und Zahlen stehen, angepfiffen werden kann aber nicht.'),
        el('pre', { class: 'tv-mini', style: { whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,.14)', padding: '7px', margin: 0 } },
          String((mod.fehler && mod.fehler.message) || mod.fehler)))), seite.children[1]);
    anpfiffBtn.disabled = true;
  }

  root.appendChild(seite);
}

function ersatzUmfeld(state, fixture, rng, ansetzung) {
  const heim = state.clubs[fixture.homeId];
  const z = versuche(() => zuschauerBerechnen(state, fixture.homeId, fixture, { wetter: 'bewoelkt' }), null, 'zuschauerBerechnen');
  return {
    venue: {
      capacity: heim.stadium.capacity,
      attendance: z ? z.gesamt : Math.round(heim.stadium.capacity * 0.7),
      stadiumName: heim.stadium.name,
      pitch: heim.stadiumState ? heim.stadiumState.rasenZustand : heim.stadium.pitch,
      weather: 'bewoelkt',
      temperature: 12
    },
    zuschauer: z || { gesamt: Math.round(heim.stadium.capacity * 0.7), auslastung: 0.7, einnahmen: 0 },
    referee: (ansetzung ? versuche(() => ansetzung(fixture), null, 'schiedsrichterFuer') : null)
      || { name: 'noch nicht angesetzt', strictness: 50, homeBias: 50, kartenschnitt: 3.5, spiele: 0, spitzname: null },
    unsicher: true
  };
}

/* ---------- Paarung ------------------------------------------------ */

function paarungsPanel(state, fixture, heim, gast, club, umfeld) {
  const zHeim = tabellenZeile(state, heim.id);
  const zGast = tabellenZeile(state, gast.id);
  const derby = versuche(() => derbyInfo(state, heim.id, gast.id), { faktor: 1, name: null }, 'derbyInfo');

  const seiteBau = (c, zeile, rechts) => {
    const kopf = el('div', {
      class: 'tv-zeile',
      style: { gap: '12px', justifyContent: rechts ? 'flex-end' : 'flex-start', flexDirection: rechts ? 'row-reverse' : 'row' }
    },
    wappen(c, 62),
    el('div', { style: { textAlign: rechts ? 'right' : 'left', minWidth: 0 } },
      el('div', { style: { fontFamily: 'var(--font-titel)', fontSize: '21px', letterSpacing: '.8px', lineHeight: 1.05 } }, c.name),
      el('div', { class: 'tv-mini' },
        zeile ? `${zeile.platz}. Platz · ${zeile.punkte} Punkte · ${zeile.tore}:${zeile.gegentore} Tore` : 'außer Konkurrenz'),
      el('div', { class: 'tv-mini' }, `${c.city} · Ruf ${c.reputation || '?'} · gegründet ${c.founded || '?'}`)));

    const werte = el('div', {
      class: 'tv-zeile',
      style: { gap: '8px', marginTop: '7px', flexWrap: 'wrap', justifyContent: rechts ? 'flex-end' : 'flex-start' }
    },
    el('span', { class: 'tv-mini' }, 'Form:'), formStreifen(c.season && c.season.form),
    c.id === club.id ? pill('Ihr Verein', 'gut') : null,
    zeile && zeile.spiele ? el('span', { class: 'tv-mini tv-num' },
      `${zeile.s}S · ${zeile.u}U · ${zeile.n}N`) : null);

    const letzte = (c.season && c.season.letzteErgebnisse || []).slice(0, 5);
    const erg = el('div', {
      class: 'tv-zeile',
      style: { gap: '4px', marginTop: '5px', flexWrap: 'wrap', justifyContent: rechts ? 'flex-end' : 'flex-start' }
    },
    ...(letzte.length ? letzte.map(e => el('span', {
      class: 'tv-pill ' + (e.tore > e.gegentore ? 'tv-pill--gut' : e.tore === e.gegentore ? 'tv-pill--warn' : 'tv-pill--schlecht'),
      title: `${e.heim ? 'Heim' : 'Auswärts'} gegen ${e.gegner}`
    }, `${e.heim ? 'H' : 'A'} ${e.tore}:${e.gegentore} ${e.gegner}`))
      : [el('span', { class: 'tv-mini' }, 'noch keine Ergebnisse dieser Saison')]));

    return el('div', { style: { minWidth: 0 } }, kopf, werte, erg);
  };

  const mitte = el('div', { style: { textAlign: 'center', minWidth: '140px' } },
    el('div', { style: { fontFamily: 'var(--font-titel)', fontSize: '30px', letterSpacing: '2px' } }, '–:–'),
    el('div', { class: 'tv-mini' }, fixture.neutral ? 'auf neutralem Boden' : 'Heim  ·  Gast'),
    derby && derby.name ? el('div', { style: { marginTop: '6px' } }, pill('🔥 ' + derby.name, 'schlecht')) : null,
    umfeld && umfeld.venue ? el('div', { class: 'tv-mini', style: { marginTop: '6px' } },
      `${WEATHER[umfeld.venue.weather] ? WEATHER[umfeld.venue.weather].icon : ''} ${umfeld.venue.temperature} °C`) : null);

  const p = panel(panelKopf(wettbewerbName(fixture),
    formatDateShort(fixture.dayIndex, fixture.season || state.date.season)),
  el('div', {
    style: {
      display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)',
      gap: '14px', alignItems: 'center'
    }
  }, seiteBau(heim, zHeim, false), mitte, seiteBau(gast, zGast, true)));
  p.classList.add('tv-panel--gold');
  return p;
}

/* ---------- Statistik vor dem Spiel -------------------------------- */

function statistikVorPanel(state, fixture, heim, gast, club) {
  const duelle = state.fixtures
    .filter(f => f.played && f.result && f.result.score &&
      ((f.homeId === heim.id && f.awayId === gast.id) || (f.homeId === gast.id && f.awayId === heim.id)))
    .sort((a, b) => (b.season - a.season) || (b.dayIndex - a.dayIndex))
    .slice(0, 8);

  let s = 0, u = 0, n = 0;
  for (const f of duelle) {
    const eigenHeim = f.homeId === club.id;
    const eigen = eigenHeim ? f.result.score[0] : f.result.score[1];
    const fremd = eigenHeim ? f.result.score[1] : f.result.score[0];
    if (eigen > fremd) s++; else if (eigen === fremd) u++; else n++;
  }

  const liste = duelle.length
    ? el('div', { class: 'tv-spalte', style: { gap: '3px' } },
      ...duelle.map(f => {
        const h = state.clubs[f.homeId], a = state.clubs[f.awayId];
        return el('div', {
          class: 'tv-zeile tv-zeile--verteilt',
          style: { fontSize: '12px', borderBottom: '1px dotted rgba(0,0,0,.16)', padding: '2px 0' }
        },
        el('span', { class: 'tv-mini' }, `S${f.season} · ${formatDateShort(f.dayIndex, f.season)}`),
        el('span', {}, `${h ? h.shortName : '?'} – ${a ? a.shortName : '?'}`),
        el('b', { class: 'tv-num' }, `${f.result.score[0]}:${f.result.score[1]}`));
      }))
    : el('div', { class: 'tv-leer' }, 'Diese beiden sind sich noch nie begegnet. Es wird Zeit.');

  const bilanz = el('div', { class: 'tv-grid tv-grid--3', style: { gap: '6px', marginBottom: '8px' } },
    statBox('Siege', String(s), { kind: 'gut' }),
    statBox('Remis', String(u)),
    statBox('Niederlagen', String(n), { kind: s < n ? 'schlecht' : undefined }));

  return panel('Direkter Vergleich',
    el('div', {}, duelle.length ? bilanz : null, liste,
      el('div', { class: 'tv-mini', style: { marginTop: '6px' } },
        'Bilanz aus Sicht von ' + club.shortName + '.')));
}

/* ---------- Umfeld -------------------------------------------------- */

function umfeldPanel(state, fixture, heim, gast, umfeld) {
  const v = umfeld.venue || {};
  const z = umfeld.zuschauer || {};
  const w = WEATHER[v.weather] || { name: v.weather || 'unbekannt', icon: '❔' };
  const hv = versuche(() => heimvorteil(state, heim.id, z), null, 'heimvorteil');

  const kacheln = el('div', { class: 'tv-grid tv-grid--2', style: { gap: '6px' } },
    statBox('Erwartete Zuschauer', nfmt(z.gesamt || v.attendance || 0),
      { sub: `von ${nfmt(v.capacity || heim.stadium.capacity)} Plätzen` }),
    statBox('Auslastung', `${round((z.auslastung !== undefined ? z.auslastung : 0.7) * 100, 0)} %`,
      { kind: (z.auslastung || 0) >= 0.85 ? 'gut' : (z.auslastung || 0) < 0.55 ? 'schlecht' : undefined }),
    statBox('Wetter', `${w.icon} ${w.name}`, { sub: `${v.temperature !== undefined ? v.temperature : '?'} °C` }),
    statBox('Rasen', `${Math.round(v.pitch || heim.stadium.pitch || 70)} / 100`,
      { kind: (v.pitch || 70) >= 80 ? 'gut' : (v.pitch || 70) < 55 ? 'schlecht' : undefined }));

  const stadionBox = el('div', { class: 'tv-subpanel', style: { marginTop: '8px' } },
    el('div', { class: 'tv-subpanel__titel' }, 'Spielort'),
    el('div', {}, el('b', {}, v.stadiumName || heim.stadium.name)),
    el('div', { class: 'tv-mini' },
      `${heim.city} · ${nfmt(heim.stadium.capacity)} Plätze · ` +
      `${heim.stadium.roof ? 'überdacht' : 'ohne Dach'} · ${Math.round((heim.stadium.standing || 0) * 100)} % Stehplätze`),
    hv ? el('div', { class: 'tv-mini', style: { marginTop: '5px', fontStyle: 'italic' } }, `„${hv.text}"`) : null);

  return panel('Spielumfeld',
    el('div', {}, kacheln, stadionBox,
      umfeld.unsicher ? el('div', { class: 'tv-warnung tv-mini', style: { marginTop: '6px' } },
        'Schätzwerte – das Spielumfeld steht erst mit der Match-Engine fest.') : null));
}

/* ---------- Schiedsrichterakte -------------------------------------- */

/**
 * Bilanz des eigenen Vereins unter diesem Unparteiischen.
 *
 * Die Ansetzung wird nicht gespeichert, sondern aus der Fixture-ID abgeleitet
 * (`matchday.schiedsrichterFuer`). Deshalb lässt sich für jede jemals gespielte
 * Partie nachrechnen, wer gepfiffen hat – auch rückwirkend in alten Spielständen.
 */
function schiriBilanz(state, club, name, ansetzung, ausser) {
  const b = { spiele: 0, s: 0, u: 0, n: 0, tore: 0, gegentore: 0, gelb: 0, rot: 0 };
  if (!ansetzung || !name) return b;
  for (const f of state.fixtures) {
    if (!f.played || f.freilos || !f.result || !f.result.score) continue;
    if (f.id === ausser) continue;
    const eigenHeim = f.homeId === club.id;
    if (!eigenHeim && f.awayId !== club.id) continue;

    let akte = null;
    try { akte = ansetzung(f); } catch (err) { continue; }
    if (!akte || akte.name !== name) continue;

    b.spiele++;
    const eigen = eigenHeim ? f.result.score[0] : f.result.score[1];
    const fremd = eigenHeim ? f.result.score[1] : f.result.score[0];
    b.tore += eigen;
    b.gegentore += fremd;
    if (eigen > fremd) b.s++; else if (eigen === fremd) b.u++; else b.n++;

    const st = f.result.stats ? (eigenHeim ? f.result.stats.home : f.result.stats.away) : null;
    if (st) { b.gelb += st.yellow || 0; b.rot += st.red || 0; }
  }
  return b;
}

/**
 * Deutsche Charakterisierung im Klartext – kein Zahlensalat, sondern ein Rat.
 *
 * Bewusst ohne „er/sie": In REFEREE_NAMES stehen auch Schiedsrichterinnen, und
 * eine Akte, die die Hälfte der Ansetzungen falsch anredet, ist keine Akte.
 */
function schiriCharakter(schiri, eigenHeim) {
  const streng = schiri.strictness || 50;
  const heim = schiri.homeBias || 50;

  const stil = streng >= 72 ? 'pfeift streng'
    : streng >= 58 ? 'pfeift konsequent'
      : streng <= 38 ? 'lässt viel laufen'
        : 'pfeift ausgeglichen';

  const rat = streng >= 72 ? 'hier sollte man die Zweikampfhärte zurücknehmen'
    : streng >= 58 ? 'ein, zwei Klicks weniger Zweikampfhärte schaden nicht'
      : streng <= 38 ? 'die Zweikampfhärte darf ruhig nach oben'
        : 'an der Zweikampfhärte muss man nichts drehen';

  const heimSatz = heim >= 58
    ? (eigenHeim
      ? 'Die knappen Entscheidungen fallen hier für die Heimmannschaft – heute also für Sie.'
      : 'Die knappen Entscheidungen fallen hier für die Heimmannschaft. Sie spielen auswärts.')
    : heim <= 42
      ? 'Auf Heimbonus braucht bei dieser Ansetzung niemand zu hoffen, auch die eigene Kurve nicht.'
      : 'Vom Publikum ist auf diesem Stuhl niemand einzuschüchtern.';

  const erfahrung = (schiri.spiele || 0) >= 220
    ? `Routine pur: ${schiri.spiele} Spiele in der höchsten Klasse.`
    : (schiri.spiele || 0) <= 45
      ? `Noch grün hinter den Ohren – gerade ${schiri.spiele} Einsätze im Oberhaus.`
      : `${schiri.spiele} Spiele im Oberhaus – genug, um zu wissen, wo der Anstoßpunkt liegt.`;

  return {
    kurz: `${stil}, ${nfmt(schiri.kartenschnitt || 0, 1)} Karten im Schnitt – ${rat}.`,
    lang: `${erfahrung} ${heimSatz}`
  };
}

function schiriPanel(state, fixture, club, umfeld, ansetzung, eigenHeim) {
  const schiri = umfeld.referee || {};
  const bilanz = schiriBilanz(state, club, schiri.name, ansetzung, fixture.id);
  const charakter = schiriCharakter(schiri, eigenHeim);

  const kopf = el('div', { class: 'tv-zeile', style: { gap: '10px', alignItems: 'baseline' } },
    el('b', { style: { fontSize: '15px' } }, schiri.name || 'noch nicht angesetzt'),
    schiri.spitzname
      ? el('span', { class: 'tv-mini', style: { fontStyle: 'italic' } }, `„${schiri.spitzname}"`)
      : null);

  const kacheln = el('div', { class: 'tv-grid tv-grid--2', style: { gap: '6px', margin: '7px 0' } },
    statBox('Kartenschnitt', nfmt(schiri.kartenschnitt || 0, 1), {
      sub: 'Gelbe pro Partie',
      kind: (schiri.kartenschnitt || 0) >= 4.5 ? 'schlecht' : (schiri.kartenschnitt || 0) <= 2.6 ? 'gut' : undefined
    }),
    statBox('Angesetzt', String(schiri.spiele || 0), { sub: 'Spiele im Oberhaus' }));

  const bilanzZeile = bilanz.spiele
    ? el('div', { class: 'tv-spalte', style: { gap: '2px' } },
      el('div', { style: { fontSize: '12.5px' } },
        `${club.shortName} stand schon ${bilanz.spiele}× unter dieser Leitung: `,
        el('b', { class: 'tv-num' }, `${bilanz.s}S · ${bilanz.u}U · ${bilanz.n}N`),
        ` bei ${bilanz.tore}:${bilanz.gegentore} Toren.`),
      el('div', { class: 'tv-mini' },
        bilanz.gelb || bilanz.rot
          ? `Dabei gab es für Ihre Elf ${bilanz.gelb} Gelbe${bilanz.rot ? ` und ${bilanz.rot} Platzverweis${bilanz.rot === 1 ? '' : 'e'}` : ''}.`
          : 'Karten für Ihre Elf gab es dabei noch keine – erstaunlich.'),
      el('div', { class: 'tv-mini' },
        bilanz.s > bilanz.n ? 'Eine Ansetzung, die man gerne auf dem Bogen sieht.'
          : bilanz.n > bilanz.s ? 'Eine Ansetzung, bei der man kurz schluckt.'
            : 'Bislang ein ausgeglichenes Verhältnis.'))
    : el('div', { class: 'tv-mini' },
      `${club.shortName} stand noch nie unter dieser Leitung. Man lernt sich heute kennen.`);

  return panel('Die Schiedsrichterakte',
    el('div', {},
      kopf,
      el('div', { style: { marginTop: '6px' } },
        balken(schiri.strictness || 50, 100, { label: 'Strenge', compact: true }),
        balken(schiri.homeBias || 50, 100, { label: 'Heimbonus', compact: true })),
      kacheln,
      bilanzZeile,
      el('div', { class: 'tv-subpanel', style: { marginTop: '8px' } },
        el('div', { class: 'tv-subpanel__titel' }, 'Einschätzung des Co-Trainers'),
        el('div', { style: { fontSize: '12.5px', lineHeight: 1.45 } }, charakter.kurz),
        el('div', { class: 'tv-mini', style: { marginTop: '3px' } }, charakter.lang))));
}

/* ---------- Aufstellungen ------------------------------------------ */

function aufstellungsPanel(ctx, fixture, club, gegner, eigenHeim) {
  const state = ctx.state;
  const eigeneSpieler = squadOf(state, club.id);
  const eigeneTaktik = club.tactics;

  const pruefung = versuche(() => validateTactics(eigeneTaktik, eigeneSpieler), null, 'validateTactics');
  const scouting = clamp((club.facilities && club.facilities.scouting) || 40, 1, 100);
  const scoutRng = createRng(`${state.seed}:scouting:${fixture.id}`);
  const gegnerBild = gegnerAufstellung(state, gegner, scouting, scoutRng);

  const eigeneStaerke = versuche(() => teamStrength({
    club, players: eigeneSpieler.filter(p => !p.injury && !(p.cards && p.cards.ban > 0)),
    tactics: eigeneTaktik, morale: club.moral, tiredness: 0, coachBonus: 55, isHome: eigenHeim
  }), null, 'teamStrength');

  const gegnerStaerke = scouting >= 60 ? versuche(() => teamStrength({
    club: gegner, players: squadOf(state, gegner.id).filter(p => !p.injury && !(p.cards && p.cards.ban > 0)),
    tactics: gegnerBild.tactics || gegner.tactics, morale: gegner.moral, tiredness: 0, coachBonus: 50, isHome: !eigenHeim
  }), null, 'teamStrength Gegner') : null;

  const eigeneSeite = el('div', { class: 'tv-spalte' },
    el('div', { class: 'tv-subpanel__titel' },
      `${club.shortName} · ${eigeneTaktik ? eigeneTaktik.formation : '?'} · ` +
      `${eigeneTaktik && STYLES[eigeneTaktik.style] ? STYLES[eigeneTaktik.style].name : 'Stil unklar'}`),
    miniBrett(state, club, eigeneTaktik, false),
    startelfListe(state, club, eigeneTaktik, { verdeckt: false }),
    eigeneStaerke ? staerkeBlock(eigeneStaerke) : null,
    pruefung && (pruefung.errors.length || pruefung.warnings.length)
      ? el('div', { class: 'tv-subpanel', style: { borderColor: 'var(--rot)' } },
        el('div', { class: 'tv-subpanel__titel' }, 'Der Co-Trainer runzelt die Stirn'),
        ...pruefung.errors.map(t => el('div', { class: 'tv-schlecht', style: { fontSize: '11.5px' } }, '✖ ' + t)),
        ...pruefung.warnings.map(t => el('div', { class: 'tv-warnung', style: { fontSize: '11.5px' } }, '⚠ ' + t)),
        el('div', { style: { marginTop: '6px' } },
          button('Das richte ich', () => ctx.navigate('taktik'), { size: 'klein', kind: 'blau' })))
      : null);

  const gegnerSeite = el('div', { class: 'tv-spalte' },
    el('div', { class: 'tv-subpanel__titel' },
      `${gegner.shortName} · ${gegnerBild.formationText}`),
    gegnerBild.tactics && gegnerBild.stufe >= 1
      ? miniBrett(state, gegner, gegnerBild.tactics, true, gegnerBild)
      : el('div', { class: 'tv-leer' }, 'Über die Grundordnung des Gegners weiß niemand etwas Belastbares.'),
    gegnerBild.tactics
      ? startelfListe(state, gegner, gegnerBild.tactics, { verdeckt: true, bild: gegnerBild })
      : null,
    gegnerStaerke ? staerkeBlock(gegnerStaerke) : el('div', { class: 'tv-mini' },
      'Für eine echte Stärkeanalyse fehlt es an Scoutingqualität. Bauen Sie die Abteilung aus.'),
    el('div', { class: 'tv-mini', style: { marginTop: '4px' } }, gegnerBild.hinweis));

  return panel(panelKopf('Aufstellungen', `Scouting ${scouting}/100`),
    el('div', { class: 'tv-grid tv-grid--2' }, eigeneSeite, gegnerSeite));
}

function staerkeBlock(st) {
  return el('div', { class: 'tv-subpanel' },
    el('div', { class: 'tv-subpanel__titel' }, `Mannschaftsstärke ${Math.round(st.gesamt || 0)}`),
    balken(st.tw || 0, 99, { label: 'Tor', compact: true }),
    balken(st.abwehr || 0, 99, { label: 'Abwehr', compact: true }),
    balken(st.mittelfeld || 0, 99, { label: 'Mittelfeld', compact: true }),
    balken(st.angriff || 0, 99, { label: 'Angriff', compact: true }),
    st.chemie !== undefined ? balken(st.chemie, 100, { label: 'Harmonie', compact: true }) : null);
}

/**
 * Ermittelt, was unsere Späher über die gegnerische Elf zusammengetragen haben.
 * Die Qualität hängt an club.facilities.scouting des eigenen Vereins.
 */
function gegnerAufstellung(state, gegner, scouting, rng) {
  const spieler = squadOf(state, gegner.id).filter(p => !p.injury && !(p.cards && p.cards.ban > 0));
  let tactics = gegner.tactics;
  const lineupOk = tactics && tactics.lineup &&
    Object.values(tactics.lineup).filter(Boolean).length === 11 &&
    Object.values(tactics.lineup).every(id => spieler.some(p => p.id === id));
  if (!lineupOk) {
    tactics = versuche(() => autoLineup(spieler, tactics || gegner.tactics, { respectFitness: true }), null, 'autoLineup Gegner');
  }

  const stufe = scouting >= 80 ? 3 : scouting >= 60 ? 2 : scouting >= 35 ? 1 : 0;
  const bekanntAnteil = [0, 0.4, 1, 1][stufe];
  const bekannt = new Set();
  if (tactics && tactics.lineup) {
    for (const slotId of Object.keys(tactics.lineup)) {
      if (rng.next() < bekanntAnteil) bekannt.add(tactics.lineup[slotId]);
    }
  }

  let formationText;
  if (stufe === 0) {
    const alternativen = Object.keys(FORMATIONS);
    const geraten = alternativen.length ? rng.pick(alternativen) : '4-4-2';
    formationText = `vermutlich ${geraten}`;
  } else {
    formationText = `${tactics ? tactics.formation : '?'} · ` +
      (tactics && STYLES[tactics.style] ? STYLES[tactics.style].name : 'Stil unbekannt');
  }

  const hinweis = [
    'Unsere Späher haben es nicht einmal ins Stadion geschafft. Rechnen Sie mit allem.',
    'Dünne Informationslage: Grundordnung ja, Namen größtenteils nein.',
    'Solide Beobachtung: Wir kennen die Elf, aber nicht ihre Tagesform.',
    'Lückenloser Bericht. Unsere Scouts haben sogar die Aufwärmübungen mitgeschrieben.'
  ][stufe];

  return { tactics, stufe, bekannt, formationText, hinweis };
}

/** Kleines Taktikbrett im Vorbericht (Klasse tv-brett, Slots wie im Taktikschirm). */
function miniBrett(state, club, tactics, gegnerseite, bild = null) {
  const brett = el('div', {
    class: 'tv-brett',
    style: { maxHeight: '320px', margin: '0 auto 6px', width: '100%' }
  });

  // Spielfeldlinien
  brett.appendChild(el('div', { class: 'tv-brett__linie', style: { left: 0, right: 0, top: '50%', height: '2px' } }));
  brett.appendChild(el('div', { class: 'tv-brett__kreis', style: { left: '50%', top: '50%', width: '26%', height: '19%', transform: 'translate(-50%,-50%)' } }));
  brett.appendChild(el('div', { class: 'tv-brett__raum', style: { left: '21%', right: '21%', bottom: 0, height: '15%' } }));
  brett.appendChild(el('div', { class: 'tv-brett__raum', style: { left: '21%', right: '21%', top: 0, height: '15%' } }));

  const shape = versuche(() => formationShape(tactics && tactics.formation), [], 'formationShape');
  if (!shape.length) {
    brett.appendChild(el('div', { class: 'tv-leer', style: { color: '#f2e8cf' } }, 'Keine Formation hinterlegt.'));
    return brett;
  }

  const farbe = (club.colors && club.colors.primary) || '#1c4f8f';
  const schrift = (club.colors && club.colors.secondary) || '#ffffff';

  for (const slot of shape) {
    const pid = tactics.lineup ? tactics.lineup[slot.id] : null;
    const p = pid ? state.players[pid] : null;
    const verdeckt = gegnerseite && p && bild && !bild.bekannt.has(p.id);

    const knoten = el('div', {
      class: 'tv-slot' + (p ? '' : ' leer'),
      style: { left: slot.x + '%', top: (100 - slot.y) + '%', width: '54px' },
      title: slot.labelLang
    },
    el('div', {
      class: 'tv-slot__trikot',
      style: { width: '27px', height: '27px', fontSize: '11px', background: farbe, color: schrift }
    }, p && !verdeckt ? String(p.number || '') : '?'),
    el('div', { class: 'tv-slot__name', style: { fontSize: '9px', maxWidth: '60px' } },
      p ? (verdeckt ? '???' : (p.shortName || p.lastName)) : '—'),
    el('div', { class: 'tv-slot__pos', style: { fontSize: '8px' } }, slot.label));

    if (p && p.era === 'legend' && !verdeckt) {
      knoten.firstChild.style.boxShadow = '0 0 0 2px var(--gold), 0 0 9px var(--gold)';
    }
    brett.appendChild(knoten);
  }
  return brett;
}

function startelfListe(state, club, tactics, opts = {}) {
  const shape = versuche(() => formationShape(tactics && tactics.formation), [], 'formationShape');
  const zeilen = shape.map(slot => {
    const pid = tactics.lineup ? tactics.lineup[slot.id] : null;
    return { slot, player: pid ? state.players[pid] : null };
  });

  const verdecktFn = (p) => opts.verdeckt && p && opts.bild && !opts.bild.bekannt.has(p.id);

  const t = table([
    { key: 'pos', label: 'Pos', width: 52, render: r => posPille(r.slot.pos), sortable: false },
    {
      key: 'name',
      label: 'Spieler',
      render: r => {
        if (!r.player) return el('span', { class: 'tv-mini' }, 'unbesetzt');
        if (verdecktFn(r.player)) {
          return el('span', { class: 'tv-zeile', style: { gap: '6px' } },
            el('div', { class: 'tv-portrait', style: { width: '24px', height: '24px', flex: '0 0 24px' } }),
            el('span', { class: 'tv-gedaempft' }, 'unbekannter Spieler'));
        }
        return el('span', { class: 'tv-zeile', style: { gap: '6px' } },
          portrait(r.player, 24),
          el('span', { class: 'tv-num tv-mini' }, String(r.player.number || '')),
          spielerName(r.player));
      },
      sortable: false
    },
    {
      key: 'ovr', label: 'Stk', width: 42, numeric: true, sortable: false,
      render: r => {
        if (!r.player || verdecktFn(r.player)) return '–';
        if (opts.verdeckt && opts.bild && opts.bild.stufe < 3) return '?';
        return String(versuche(() => playerOverall(r.player), 0, 'playerOverall'));
      }
    },
    {
      key: 'form', label: 'Form', width: 46, numeric: true, sortable: false,
      render: r => {
        if (!r.player || verdecktFn(r.player)) return '–';
        if (opts.verdeckt && opts.bild && opts.bild.stufe < 3) return '?';
        return String(Math.round(r.player.form || 50));
      }
    }
  ], zeilen, {
    compact: true,
    emptyText: 'Keine Aufstellung hinterlegt.',
    rowClass: r => (r.player && r.player.era === 'legend' && !verdecktFn(r.player)) ? 'zeile--legende' : null
  });
  t.style.maxHeight = '300px';

  const bank = (tactics && tactics.bench || []).map(id => state.players[id]).filter(Boolean);
  const bankZeile = bank.length && !opts.verdeckt
    ? el('div', { class: 'tv-mini', style: { marginTop: '5px' } },
      'Bank: ' + bank.map(p => `${p.shortName} (${p.position})`).join(', '))
    : null;

  return el('div', {}, t, bankZeile);
}

/* ---------- Co-Trainer ---------------------------------------------- */

function coTrainerPanel(state, club, gegner) {
  const rat = versuche(() => coTrainerRat(state, club.id, 'gegner'), null, 'coTrainerRat');
  const koerper = el('div', { class: 'tv-spalte' });

  if (!rat) {
    koerper.appendChild(el('div', { class: 'tv-leer' }, 'Der Co-Trainer ist nicht erreichbar.'));
  } else if (!rat.ok) {
    koerper.appendChild(el('div', { class: 'tv-leer' }, rat.text));
  } else {
    koerper.appendChild(el('div', { class: 'tv-zeitung__text', style: { fontSize: '13px' } }, rat.text));
    if (rat.empfehlung && rat.empfehlung.art === 'stil') {
      const stil = STYLES[rat.empfehlung.stil];
      koerper.appendChild(el('div', { class: 'tv-subpanel' },
        el('div', { class: 'tv-subpanel__titel' }, 'Empfehlung'),
        el('div', { class: 'tv-zeile' }, pill(stil ? stil.name : rat.empfehlung.stil, 'info'),
          el('span', { class: 'tv-mini' }, stil ? stil.desc : '')),
        el('div', { class: 'tv-mini', style: { marginTop: '5px' } },
          'Umstellen können Sie das nur im Taktikbereich – hier wird nur geredet.')));
    }
    koerper.appendChild(balken(rat.vertrauen || 0, 100, { label: 'Verlässlichkeit des Ratschlags', compact: true }));
  }

  const rat2 = versuche(() => coTrainerRat(state, club.id, 'form'), null, 'coTrainerRat form');
  if (rat2 && rat2.ok) {
    koerper.appendChild(el('div', { class: 'tv-trenner' }));
    koerper.appendChild(el('div', { class: 'tv-mini' }, rat2.text));
  }

  return panel('Gegneranalyse', koerper);
}

/* ---------- Ausfälle ------------------------------------------------ */

function ausfallPanel(state, club, gegner) {
  const bau = (c, verdeckt) => {
    const liste = versuche(() => lazarett(state, c.id), [], 'lazarett');
    if (!liste.length) {
      return el('div', { class: 'tv-mini' }, `${c.shortName}: alle Mann an Bord.`);
    }
    return el('div', {},
      el('div', { class: 'tv-subpanel__titel' }, `${c.shortName} – ${liste.length} Ausfälle`),
      ...liste.slice(0, 8).map(e => el('div', { class: 'tv-lazarett__zeile' },
        el('span', {}, verdeckt ? e.name : el('b', {}, e.name)),
        el('span', { class: 'tv-mini' }, e.diagnose || '–'),
        el('span', {}, e.status === 'gesperrt'
          ? pill('gesperrt', 'warn')
          : pill('verletzt', 'schlecht')),
        el('span', { class: 'tv-mini tv-rechts' }, e.prognose || ''))),
      liste.length > 8 ? el('div', { class: 'tv-mini' }, `… und ${liste.length - 8} weitere.`) : null);
  };

  return panel('Personallage',
    el('div', { class: 'tv-spalte' },
      bau(club, false),
      el('div', { class: 'tv-trenner' }),
      bau(gegner, true)));
}

/* ---------- Einstellungen ------------------------------------------- */

function einstellungsPanel(ctx) {
  const state = ctx.state;
  if (!state.settings) state.settings = {};
  const s = state.settings;
  if (!s.minigames) s.minigames = { elfmeter: true, freistoss: true, ecke: true, abschluss: true, kombination: true };

  const merken = () => { ctx.aktualisiere(); };

  const ansicht = el('select', {
    style: { width: '100%', padding: '4px' },
    onchange: e => { s.matchView = e.target.value; merken(); toast('Darstellung gespeichert.', 'info'); }
  }, ...Object.entries(MATCH_VIEW_NAMES).map(([k, v]) =>
    el('option', { value: k, selected: k === (s.matchView || MATCH_VIEW.HIGHLIGHTS) }, v)));

  const tempo = el('select', {
    style: { width: '100%', padding: '4px' },
    onchange: e => { s.speed = Number(e.target.value); merken(); }
  }, ...[[0.5, 'Gemächlich (½×)'], [1, 'Normal (1×)'], [2, 'Zügig (2×)'], [4, 'Schnell (4×)'], [8, 'Im Zeitraffer (8×)']]
    .map(([v, t]) => el('option', { value: String(v), selected: Number(s.speed || 2) === v }, t)));

  const interaktiv = el('label', { class: 'tv-zeile', style: { fontSize: '12px' } },
    el('input', {
      type: 'checkbox', checked: s.interactive !== false,
      onchange: e => {
        s.interactive = e.target.checked;
        merken();
        toast(e.target.checked ? 'Sie greifen selbst ein.' : 'Die Simulation macht das schon.', 'info');
      }
    }),
    ' Schlüsselszenen selbst spielen');

  const MINISPIELE = [
    ['elfmeter', 'Elfmeter', 'Der einsamste Punkt der Welt.'],
    ['freistoss', 'Freistoß', 'Mauer, Anlauf, Hoffnung.'],
    ['ecke', 'Ecke', 'Reinbringen und beten.'],
    ['abschluss', 'Abschluss', 'Allein vor dem Tor.'],
    ['kombination', 'Kombination', 'Den letzten Pass selbst spielen.']
  ];

  const mgBox = el('div', { class: 'tv-spalte', style: { gap: '2px' } },
    ...MINISPIELE.map(([key, name, desc]) => el('label', {
      class: 'tv-zeile', style: { fontSize: '12px', opacity: s.interactive === false ? .5 : 1 }
    },
    el('input', {
      type: 'checkbox', checked: s.minigames[key] !== false,
      onchange: e => { s.minigames[key] = e.target.checked; merken(); }
    }),
    el('span', {}, el('b', {}, name), ' ', el('span', { class: 'tv-mini' }, desc)))));

  return panel('Einstellungen für dieses Spiel',
    el('div', { class: 'tv-spalte' },
      el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Ansicht'), ansicht),
      el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Tempo'), tempo),
      el('div', { class: 'tv-subpanel' },
        el('div', { class: 'tv-subpanel__titel' }, 'Eingreifen'),
        interaktiv,
        el('div', { class: 'tv-mini', style: { margin: '4px 0 6px' } }, 'Welche Szenen wollen Sie übernehmen?'),
        mgBox)));
}

/* ---------- Terminübersicht (immer sichtbar) ------------------------ */

/**
 * Der Hinweis auf die englische Woche (ROADMAP Stufe 3, Punkt 6).
 *
 * Gezählt wird in `club/media.js:englischeWoche` — drei Pflichtspiele in acht
 * Tagen, Liga, Pokal und Europapokal gleichberechtigt. Angezeigt wird nur, was
 * `akut` ist; ein Dauerhinweis wäre für einen Europapokalstarter keiner mehr.
 */
function englischHinweis(state, club) {
  const woche = versuche(() => englischeWoche(state, club.id), null, 'englischeWoche');
  if (!woche || !woche.englisch || !woche.akut) return null;
  return el('div', { class: 'tv-englisch', style: { marginBottom: '8px' } },
    el('b', {}, `${woche.spiele} Spiele in acht Tagen`),
    el('span', {}, woche.laufend
      ? ' — der Physio schaut schon skeptisch. Wer jetzt nicht rotiert, rotiert im Mai die Reha-Pläne.'
      : ` — es geht in ${woche.tageBisStart} Tagen los. Der Physio schaut schon skeptisch.`));
}

function terminPanel(state, club) {
  const naechste = state.fixtures
    .filter(f => !f.played && (f.homeId === club.id || f.awayId === club.id) && f.dayIndex >= state.date.day)
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .slice(0, 5);
  const letzte = state.fixtures
    .filter(f => f.played && f.result && (f.homeId === club.id || f.awayId === club.id))
    .sort((a, b) => b.dayIndex - a.dayIndex)
    .slice(0, 5);

  const terminListe = naechste.length
    ? el('div', { class: 'tv-spalte', style: { gap: '3px' } }, ...naechste.map(f => {
      const heim = f.homeId === club.id;
      const g = state.clubs[heim ? f.awayId : f.homeId];
      return el('div', { class: 'tv-zeile tv-zeile--verteilt', style: { fontSize: '12px', padding: '3px 0', borderBottom: '1px dotted rgba(0,0,0,.16)' } },
        el('span', { class: 'tv-zeile', style: { gap: '6px' } },
          g ? wappen(g, 20) : null,
          el('b', {}, heim ? 'H' : 'A'),
          el('span', {}, g ? g.name : 'unbekannt')),
        el('span', { class: 'tv-mini' }, `${wettbewerbName(f)} · ${formatDateShort(f.dayIndex, f.season)}`));
    }))
    : el('div', { class: 'tv-leer' }, 'Keine weiteren Termine. Die Saison ist durch.');

  const ergebnisListe = letzte.length
    ? el('div', { class: 'tv-spalte', style: { gap: '3px' } }, ...letzte.map(f => {
      const heim = f.homeId === club.id;
      const g = state.clubs[heim ? f.awayId : f.homeId];
      const eigen = heim ? f.result.score[0] : f.result.score[1];
      const fremd = heim ? f.result.score[1] : f.result.score[0];
      const art = eigen > fremd ? 'gut' : eigen === fremd ? 'warn' : 'schlecht';
      return el('div', { class: 'tv-zeile tv-zeile--verteilt', style: { fontSize: '12px', padding: '3px 0', borderBottom: '1px dotted rgba(0,0,0,.16)' } },
        el('span', { class: 'tv-zeile', style: { gap: '6px' } },
          g ? wappen(g, 20) : null,
          el('b', {}, heim ? 'H' : 'A'),
          el('span', {}, g ? g.name : 'unbekannt')),
        el('span', { class: 'tv-zeile', style: { gap: '6px' } },
          el('span', { class: 'tv-mini' }, kurzBericht(eigen, fremd, heim, g)),
          pill(`${f.result.score[0]}:${f.result.score[1]}`, art)));
    }))
    : el('div', { class: 'tv-leer' }, 'Noch kein Spiel absolviert. Die Akte ist jungfräulich.');

  return panel('Termine & Ergebnisse',
    el('div', {},
      englischHinweis(state, club),
      el('div', { class: 'tv-grid tv-grid--2' },
        el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Die nächsten fünf'), terminListe),
        el('div', {}, el('div', { class: 'tv-subpanel__titel' }, 'Die letzten fünf'), ergebnisListe))));
}

/** Wenn gar kein Spiel mehr ansteht: Rückblick statt leerem Bildschirm. */
function zeigeUebersicht(root, ctx, titel) {
  const state = ctx.state;
  const club = myClub(state);
  const zeile = tabellenZeile(state, club.id);

  const seite = el('div', { class: 'tv-seite' },
    el('div', { class: 'tv-seite__kopf' },
      el('h1', { class: 'tv-seite__titel' }, titel),
      el('div', { class: 'tv-seite__unter' },
        `${club.name} · Saison ${state.date.season} · ${formatDate(state.date.day, state.date.season)}`)),
    panel('Saisonbilanz',
      el('div', { class: 'tv-grid tv-grid--4', style: { gap: '7px' } },
        statBox('Tabellenplatz', zeile ? `${zeile.platz}.` : '–',
          { sub: LEAGUES[club.leagueId] ? LEAGUES[club.leagueId].name : '' }),
        statBox('Punkte', zeile ? String(zeile.punkte) : '–',
          { sub: zeile ? `${zeile.s}S · ${zeile.u}U · ${zeile.n}N` : '' }),
        statBox('Tore', zeile ? `${zeile.tore}:${zeile.gegentore}` : '–',
          { sub: zeile ? `Differenz ${zeile.diff > 0 ? '+' : ''}${zeile.diff}` : '' }),
        statBox('Serie', String(club.season ? club.season.serie : 0),
          { kind: (club.season && club.season.serie) > 0 ? 'gut' : (club.season && club.season.serie) < 0 ? 'schlecht' : undefined }))),
    terminPanel(state, club),
    panel('Und nun?',
      el('div', { class: 'tv-zeile', style: { justifyContent: 'center', gap: '10px', flexWrap: 'wrap' } },
        button('📊 Tabelle', () => ctx.navigate('tabelle'), { kind: 'blau' }),
        button('👥 Kader', () => ctx.navigate('kader'), { kind: 'ghost' }),
        button('WEITER ▶', () => ctx.weiter(), { kind: 'primary', size: 'gross' }))));

  root.appendChild(seite);
}

function kurzBericht(eigen, fremd, heim, gegner) {
  const name = gegner ? gegner.shortName : 'den Gegner';
  const diff = eigen - fremd;
  if (diff >= 4) return `Schützenfest gegen ${name}.`;
  if (diff === 3) return 'Klare Sache, nichts anbrennen lassen.';
  if (diff === 2) return 'Verdient und ohne Zittern.';
  if (diff === 1) return heim ? 'Knapp, aber die Punkte bleiben da.' : 'Auswärtsdreier, mehr braucht es nicht.';
  if (diff === 0 && eigen === 0) return 'Ein Spiel für die Statistiker.';
  if (diff === 0) return 'Punkteteilung, beide durften jubeln.';
  if (diff === -1) return 'Eine Kleinigkeit hat gefehlt.';
  if (diff === -2) return 'Da war der Gegner eine Nummer zu groß.';
  return `Ein Nachmittag zum Vergessen gegen ${name}.`;
}

/* ================================================================== *
 *  2. LIVESPIEL
 * ================================================================== */

async function anpfiff(root, ctx, fixture) {
  const mod = await spielModule();
  if (!mod.ok) {
    toast('Die Match-Engine fehlt – es kann nicht angepfiffen werden.', 'schlecht');
    clearNode(root);
    root.appendChild(fehlerKasten('Anpfiff nicht möglich', mod.fehler));
    return;
  }
  try {
    const result = await mod.matchday.spielAustragen(ctx.state, fixture, root);
    letztesErgebnis = { fixtureId: fixture.id, season: ctx.state.date.season, result };
    ctx.aktualisiere();
    clearNode(root);
    zeigeNachbericht(root, ctx, fixture, result);
  } catch (err) {
    console.error('[spieltag] Spiel abgebrochen:', err);
    clearNode(root);
    root.appendChild(fehlerKasten('Das Spiel wurde abgebrochen', err));
    root.appendChild(panel('Weiter',
      el('div', { class: 'tv-zeile' },
        button('Zurück zum Vorbericht', () => ctx.refresh(), { kind: 'blau' }),
        button('Ins Büro', () => ctx.navigate('buero'), { kind: 'ghost' }))));
  }
}

/* ================================================================== *
 *  3. NACHBERICHT
 * ================================================================== */

function zeigeNachbericht(root, ctx, fixture, result) {
  const state = ctx.state;
  const club = myClub(state);
  const heim = state.clubs[fixture.homeId];
  const gast = state.clubs[fixture.awayId];
  const score = (result && result.score) || (fixture.result && fixture.result.score) || [0, 0];
  const eigenHeim = fixture.homeId === club.id;
  const eigen = eigenHeim ? score[0] : score[1];
  const fremd = eigenHeim ? score[1] : score[0];

  const seite = el('div', { class: 'tv-seite' });
  seite.appendChild(el('div', { class: 'tv-seite__kopf' },
    el('h1', { class: 'tv-seite__titel' }, 'Nachbericht'),
    el('div', { class: 'tv-seite__unter' },
      `${wettbewerbName(fixture)} · ${formatDate(fixture.dayIndex, fixture.season || state.date.season)} · ` +
      (eigen > fremd ? 'Sieg' : eigen === fremd ? 'Unentschieden' : 'Niederlage'))));

  // --- Anzeigetafel
  seite.appendChild(el('div', { class: 'tv-anzeigetafel' },
    el('div', { class: 'tv-anzeigetafel__team' },
      heim ? wappen(heim, 40) : null,
      el('span', {}, heim ? heim.abbr : '???'),
      el('span', { style: { fontSize: '12px', opacity: .75 } }, heim ? heim.shortName : '')),
    el('div', {},
      el('div', { class: 'tv-anzeigetafel__stand' }, `${score[0]} : ${score[1]}`),
      el('div', { class: 'tv-anzeigetafel__uhr' },
        result && result.attendance ? `${nfmt(result.attendance)} Zuschauer` : 'Abpfiff')),
    el('div', { class: 'tv-anzeigetafel__team tv-anzeigetafel__team--gast' },
      el('span', { style: { fontSize: '12px', opacity: .75 } }, gast ? gast.shortName : ''),
      el('span', {}, gast ? gast.abbr : '???'),
      gast ? wappen(gast, 40) : null)));

  if (!result) {
    seite.appendChild(panel('Nur das Ergebnis',
      el('div', { class: 'tv-spalte' },
        el('p', {}, 'Zu dieser Partie liegt nur noch das nackte Ergebnis vor – die Einzelheiten ' +
          'sind mit dem Schlusspfiff im Archiv verschwunden.'),
        fixture.result && fixture.result.stats
          ? statistikVergleich(heim, gast, fixture.result.stats)
          : el('div', { class: 'tv-mini' }, 'Auch die Statistik fehlt.'))));
    seite.appendChild(konferenzPanel(state, fixture, club));
    seite.appendChild(tabellenAusschnitt(ctx, club));
    seite.appendChild(nachbereitungsKnoepfe(ctx, fixture, null));
    root.appendChild(seite);
    return;
  }

  seite.appendChild(el('div', { class: 'tv-grid tv-grid--haupt' },
    el('div', { class: 'tv-spalte' },
      torPanel(state, fixture, result, heim, gast),
      notenPanel(state, club, result),
      berichtPanel(result)),
    el('div', { class: 'tv-spalte' },
      panel('Statistik', statistikVergleich(heim, gast, result.stats)),
      konferenzPanel(state, fixture, club),
      tabellenAusschnitt(ctx, club))));

  seite.appendChild(nachbereitungsKnoepfe(ctx, fixture, result));
  root.appendChild(seite);
}

function nachbereitungsKnoepfe(ctx, fixture, result) {
  const knoepfe = el('div', { class: 'tv-zeile', style: { justifyContent: 'center', flexWrap: 'wrap', gap: '10px' } });

  if (result && Array.isArray(result.phases) && result.phases.length) {
    knoepfe.appendChild(button('🎬 Höhepunkte ansehen',
      () => hoehepunkteZeigen(ctx.state, fixture, result), { kind: 'blau' }));
  }
  knoepfe.appendChild(button('🎤 Pressekonferenz', () => ctx.navigate('presse'), { kind: 'gold' }));
  knoepfe.appendChild(button('📊 Tabelle', () => ctx.navigate('tabelle'), { kind: 'ghost' }));
  knoepfe.appendChild(button('👥 Kader', () => ctx.navigate('kader'), { kind: 'ghost' }));
  knoepfe.appendChild(button('WEITER ▶', () => ctx.weiter(), { kind: 'primary', size: 'gross' }));

  return panel('Nach dem Spiel', knoepfe);
}

/* ---------- Torschützen --------------------------------------------- */

function torPanel(state, fixture, result, heim, gast) {
  const tore = (result.events || []).filter(e => e.type === 'tor');
  if (!tore.length) {
    return panel('Torschützen',
      el('div', { class: 'tv-leer' }, 'Kein Tor. Die Torhüter hatten einen ruhigen Nachmittag, das Publikum einen langen.'));
  }

  const zeile = (ev) => {
    const p = ev.playerId ? state.players[ev.playerId] : null;
    const v = ev.secondPlayerId ? state.players[ev.secondPlayerId] : null;
    const heimTor = ev.team === 'home';
    const c = heimTor ? heim : gast;
    return el('div', {
      class: 'tv-zeile',
      style: {
        gap: '9px', padding: '5px 6px', borderBottom: '1px solid rgba(0,0,0,.14)',
        flexDirection: heimTor ? 'row' : 'row-reverse',
        textAlign: heimTor ? 'left' : 'right',
        background: heimTor ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.05)'
      }
    },
    p ? portrait(p, 38, 'tv-portrait--gross') : el('div', { class: 'tv-portrait', style: { width: '38px', height: '38px' } }),
    el('div', { style: { flex: 1, minWidth: 0 } },
      el('div', { class: 'tv-zeile', style: { gap: '6px', justifyContent: heimTor ? 'flex-start' : 'flex-end' } },
        el('b', { class: 'tv-num' }, `${ev.minute}'`),
        el('b', {}, p ? (p.shortName || p.lastName) : 'unbekannt'),
        p && p.era === 'legend' ? pill(p.eraLabel || 'Legende', 'legende') : null,
        c ? el('span', { class: 'tv-mini' }, c.abbr) : null),
      el('div', { class: 'tv-mini' },
        (v ? `Vorlage: ${v.shortName || v.lastName}` : 'ohne Vorlage') +
        (ev.score ? ` · Stand ${ev.score[0]}:${ev.score[1]}` : '')),
      ev.text ? el('div', { class: 'tv-mini', style: { fontStyle: 'italic', marginTop: '2px' } }, ev.text) : null));
  };

  const karten = (result.events || []).filter(e => e.type === 'gelb' || e.type === 'gelbrot' || e.type === 'rot');
  const wechsel = (result.events || []).filter(e => e.type === 'wechsel');
  const verletzt = (result.events || []).filter(e => e.type === 'verletzung');

  const nebenListe = (titel, liste, symbol) => liste.length
    ? el('div', { class: 'tv-subpanel', style: { marginTop: '8px' } },
      el('div', { class: 'tv-subpanel__titel' }, titel),
      ...liste.map(e => el('div', { class: 'tv-mini', style: { padding: '1px 0' } },
        `${symbol} ${e.minute}' ${e.text || (state.players[e.playerId] ? state.players[e.playerId].shortName : '')}`)))
    : null;

  return panel(panelKopf('Torschützen', `${tore.length} Treffer`),
    el('div', {},
      ...tore.map(zeile),
      nebenListe('Karten', karten, '🟨'),
      nebenListe('Wechsel', wechsel, '🔄'),
      nebenListe('Verletzungen', verletzt, '🩹')));
}

/* ---------- Statistikvergleich --------------------------------------- */

const STAT_ZEILEN = [
  { key: 'possession', label: 'Ballbesitz', suffix: ' %' },
  { key: 'shots', label: 'Torschüsse' },
  { key: 'shotsOnTarget', label: 'davon aufs Tor' },
  { key: 'xg', label: 'Erwartete Tore', dez: 2 },
  { key: 'corners', label: 'Ecken' },
  { key: 'fouls', label: 'Fouls' },
  { key: 'offsides', label: 'Abseits' },
  { key: 'passes', label: 'Pässe' },
  { key: 'passAccuracy', label: 'Passquote', suffix: ' %' },
  { key: 'tackles', label: 'Zweikämpfe' },
  { key: 'yellow', label: 'Gelbe Karten' },
  { key: 'red', label: 'Platzverweise' }
];

function statistikVergleich(heim, gast, stats) {
  if (!stats || !stats.home || !stats.away) {
    return el('div', { class: 'tv-leer' }, 'Für diese Partie liegt keine Statistik vor.');
  }
  const farbeH = (heim && heim.colors && heim.colors.primary) || '#1c4f8f';
  const farbeG = (gast && gast.colors && gast.colors.primary) || '#c1272d';

  const kopf = el('div', {
    style: { display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '8px', alignItems: 'center', marginBottom: '7px' }
  },
  el('div', { class: 'tv-zeile' }, heim ? wappen(heim, 24) : null, el('b', {}, heim ? heim.abbr : 'HEI')),
  el('div', { class: 'tv-mini' }, 'gegen'),
  el('div', { class: 'tv-zeile', style: { justifyContent: 'flex-end' } },
    el('b', {}, gast ? gast.abbr : 'GAS'), gast ? wappen(gast, 24) : null));

  const zeilen = STAT_ZEILEN.map(def => {
    const a = Number(stats.home[def.key]) || 0;
    const b = Number(stats.away[def.key]) || 0;
    const summe = a + b;
    const pa = summe > 0 ? (a / summe) * 100 : 50;
    const pb = summe > 0 ? (b / summe) * 100 : 50;
    const fmt = v => (def.dez ? round(v, def.dez).toFixed(def.dez).replace('.', ',') : nfmt(Math.round(v))) + (def.suffix || '');

    const balkenLinks = el('div', { class: 'tv-bar', style: { flex: 1 } },
      el('div', {
        class: 'tv-bar__fill',
        style: { width: pa + '%', marginLeft: 'auto', background: farbeH }
      }));
    const balkenRechts = el('div', { class: 'tv-bar', style: { flex: 1 } },
      el('div', { class: 'tv-bar__fill', style: { width: pb + '%', background: farbeG } }));

    return el('div', {
      style: {
        display: 'grid', gridTemplateColumns: '46px 1fr 122px 1fr 46px',
        gap: '6px', alignItems: 'center', padding: '2px 0'
      }
    },
    el('span', { class: 'tv-num tv-rechts', style: { fontWeight: a >= b ? 700 : 400 } }, fmt(a)),
    balkenLinks,
    el('span', { class: 'tv-mini tv-mittig' }, def.label),
    balkenRechts,
    el('span', { class: 'tv-num', style: { fontWeight: b >= a ? 700 : 400 } }, fmt(b)));
  });

  return el('div', {}, kopf, ...zeilen);
}

/* ---------- Spielernoten --------------------------------------------- */

function notenPanel(state, club, result) {
  const ratings = result.ratings || {};
  const pstats = result.playerStats || {};
  const eigeneIds = new Set(club.playerIds || []);

  const zeilen = Object.keys(pstats)
    .filter(id => eigeneIds.has(id) && state.players[id])
    .map(id => {
      const p = state.players[id];
      const st = pstats[id] || {};
      return {
        id,
        player: p,
        note: Number(ratings[id]) || 0,
        minuten: st.minuten || 0,
        tore: st.tore !== undefined ? st.tore : (st.goals || 0),
        vorlagen: st.vorlagen !== undefined ? st.vorlagen : (st.assists || 0),
        schuesse: st.schuesse !== undefined ? st.schuesse : (st.shots || 0),
        zweikaempfe: st.zweikaempfe !== undefined ? st.zweikaempfe : (st.tackles || 0),
        paraden: st.paraden !== undefined ? st.paraden : (st.saves || 0),
        motm: result.motm === id
      };
    })
    .sort((a, b) => (b.minuten - a.minuten) || (b.note - a.note));

  if (!zeilen.length) {
    return panel('Spielernoten', el('div', { class: 'tv-leer' }, 'Die Engine hat keine Einzelnoten geliefert.'));
  }

  const bester = zeilen.reduce((m, z) => (z.note > (m ? m.note : -1) ? z : m), null);

  const t = table([
    {
      key: 'name', label: 'Spieler', render: r => el('span', { class: 'tv-zeile', style: { gap: '6px' } },
        portrait(r.player, 26),
        posPille(r.player.position),
        spielerName(r.player),
        r.motm ? pill('★ Spieler des Spiels', 'gold') : null),
      sort: (a, b) => (a.player.lastName || '').localeCompare(b.player.lastName || '', 'de')
    },
    { key: 'minuten', label: 'Min', width: 46, numeric: true },
    { key: 'tore', label: 'Tore', width: 44, numeric: true },
    { key: 'vorlagen', label: 'Vorl.', width: 46, numeric: true },
    { key: 'schuesse', label: 'Sch.', width: 44, numeric: true },
    { key: 'zweikaempfe', label: 'Zwk.', width: 46, numeric: true },
    { key: 'paraden', label: 'Par.', width: 44, numeric: true },
    {
      key: 'note', label: 'Note', width: 52, numeric: true,
      render: r => el('b', { class: 'tv-num ' + noteKlasse(r.note) }, noteText(r.note))
    }
  ], zeilen, {
    compact: true,
    sort: { key: 'note', desc: true },
    rowClass: r => [
      r.player.era === 'legend' ? 'zeile--legende' : null,
      r.motm || (bester && r.id === bester.id) ? 'gewaehlt' : null
    ].filter(Boolean).join(' ') || null
  });

  const motmSpieler = result.motm ? state.players[result.motm] : null;
  const motmBox = motmSpieler ? el('div', { class: 'tv-subpanel', style: { marginTop: '8px' } },
    el('div', { class: 'tv-subpanel__titel' }, 'Spieler des Spiels'),
    el('div', { class: 'tv-zeile', style: { gap: '10px' } },
      portrait(motmSpieler, 54, 'tv-portrait--gross'),
      el('div', {},
        el('div', { class: 'tv-zeile', style: { gap: '6px' } },
          el('b', { style: { fontSize: '15px' } }, `${motmSpieler.firstName || ''} ${motmSpieler.lastName || ''}`.trim()),
          legendePille(motmSpieler)),
        el('div', { class: 'tv-mini' },
          `${POSITION_NAMES[motmSpieler.position] || motmSpieler.position} · Note ` +
          noteText(Number(ratings[motmSpieler.id]) || 0)),
        el('div', { class: 'tv-mini' }, motmSpieler.clubId === club.id
          ? 'Einer von uns. Heute hat er sich das Bier verdient.'
          : 'Leider einer von denen.')))) : null;

  return panel(panelKopf('Spielernoten', club.shortName), el('div', {}, t, motmBox));
}

/* ---------- Spielbericht --------------------------------------------- */

function berichtPanel(result) {
  const roh = result.summaryText;
  const zeilen = Array.isArray(roh) ? roh : (typeof roh === 'string' ? roh.split('\n') : []);
  if (!zeilen.length) {
    return panel('Spielbericht', el('div', { class: 'tv-leer' }, 'Der Reporter hat sein Notizbuch verloren.'));
  }
  const kopf = zeilen[0];
  const rest = zeilen.slice(1).filter(z => z && z.trim());

  return panel('Spielbericht',
    el('div', { class: 'tv-zeitung' },
      el('div', { class: 'tv-zeitung__kopf' }, 'Der Sportbote'),
      el('div', { class: 'tv-zeitung__schlagzeile' }, kopf),
      el('div', { class: 'tv-zeitung__meta' }, 'Spielbericht · Redaktion Sport'),
      ...rest.map(z => el('p', { class: 'tv-zeitung__text', style: { margin: '7px 0 0' } }, z))));
}

/* ---------- Konferenz ------------------------------------------------ */

function konferenzPanel(state, fixture, club) {
  const andere = state.fixtures.filter(f =>
    f.id !== fixture.id &&
    f.season === fixture.season &&
    f.dayIndex === fixture.dayIndex &&
    f.played && f.result && f.result.score);

  const gleicherWettbewerb = andere.filter(f => f.competitionId === fixture.competitionId);
  const liste = gleicherWettbewerb.length ? gleicherWettbewerb : andere;

  if (!liste.length) {
    return panel('Konferenz', el('div', { class: 'tv-leer' }, 'Heute wurde sonst nirgends gespielt.'));
  }

  const gitter = el('div', { class: 'tv-konferenz' }, ...liste.map(f => {
    const h = state.clubs[f.homeId], a = state.clubs[f.awayId];
    const eigen = f.homeId === club.id || f.awayId === club.id;
    return el('div', { class: 'tv-konferenz__spiel' + (eigen ? ' eigen' : '') },
      el('span', { class: 'tv-zeile', style: { gap: '5px', minWidth: 0 } },
        h ? wappen(h, 18) : null, el('span', {}, h ? h.shortName : '?')),
      el('span', { class: 'tv-konferenz__stand' }, `${f.result.score[0]}:${f.result.score[1]}`),
      el('span', { class: 'tv-konferenz__gast tv-zeile', style: { gap: '5px', justifyContent: 'flex-end', minWidth: 0 } },
        el('span', {}, a ? a.shortName : '?'), a ? wappen(a, 18) : null));
  }));

  return panel(panelKopf('Konferenz', wettbewerbName(liste[0])), gitter);
}

/* ---------- Tabellenausschnitt ---------------------------------------- */

function tabellenAusschnitt(ctx, club) {
  const state = ctx.state;
  const tabelle = state.tables[club.leagueId] || [];
  if (!tabelle.length) {
    return panel('Tabelle', el('div', { class: 'tv-leer' }, 'Noch keine Tabelle – es wurde noch nicht genug gespielt.'));
  }
  const idx = tabelle.findIndex(z => z.clubId === club.id);
  const von = clamp(idx - 3, 0, Math.max(0, tabelle.length - 7));
  const ausschnitt = tabelle.slice(von, von + 7);

  const t = table([
    { key: 'platz', label: '#', width: 30, numeric: true, sortable: false },
    {
      key: 'verein', label: 'Verein', sortable: false,
      render: z => {
        const c = state.clubs[z.clubId];
        return el('span', { class: 'tv-zeile', style: { gap: '6px' } },
          c ? wappen(c, 20) : null, el('span', {}, c ? c.shortName : z.clubId));
      }
    },
    { key: 'spiele', label: 'Sp', width: 32, numeric: true, sortable: false },
    { key: 'diff', label: 'Diff', width: 42, numeric: true, sortable: false, render: z => (z.diff > 0 ? '+' : '') + z.diff },
    { key: 'punkte', label: 'Pkt', width: 38, numeric: true, sortable: false, render: z => el('b', {}, String(z.punkte)) },
    { key: 'form', label: 'Form', width: 90, sortable: false, render: z => formStreifen(z.form) }
  ], ausschnitt, {
    compact: true,
    rowClass: z => z.clubId === club.id ? 'eigen' : null
  });
  t.classList.add('tv-liga');

  return panel(panelKopf('Tabelle', LEAGUES[club.leagueId] ? LEAGUES[club.leagueId].name : ''),
    el('div', {}, t,
      el('div', { style: { marginTop: '7px' } },
        button('Ganze Tabelle ansehen', () => ctx.navigate('tabelle'), { size: 'klein', kind: 'blau' }))));
}

/* ================================================================== *
 *  Höhepunkte-Wiederholung
 * ================================================================== */

async function hoehepunkteZeigen(state, fixture, result) {
  if (hoehepunkte) return;
  const mod = await spielModule();

  const phasen = (result.phases || []).filter(ph => {
    if (ph.eventIndex === null || ph.eventIndex === undefined) return false;
    const ev = (result.events || [])[ph.eventIndex];
    if (!ev) return false;
    if (mod.ok && mod.matchday.HIGHLIGHT_TYPES) return mod.matchday.HIGHLIGHT_TYPES.has(ev.type);
    return ['tor', 'grosschance', 'elfmeter', 'freistoss', 'rot', 'gelbrot', 'latte', 'pfosten', 'parade'].includes(ev.type);
  });

  if (!phasen.length) {
    toast('Es gab keine Szene, die eine Wiederholung verdient hätte.', 'warn');
    return;
  }

  const canvas = el('canvas', { width: 1040, height: 660, style: { display: 'block', maxWidth: '92vw', height: 'auto' } });
  const zaehler = el('div', { class: 'tv-minispiel__hinweis' }, 'Höhepunkte werden geladen …');
  const schliessenBtn = button('Schließen (ESC)', () => aufraeumen(), { kind: 'danger', size: 'klein' });
  const overlay = el('div', { class: 'tv-minispiel' },
    el('div', { class: 'tv-minispiel__buehne' }, canvas),
    zaehler,
    el('div', { class: 'tv-zeile' }, schliessenBtn));
  document.body.appendChild(overlay);

  let abbruch = false;
  let view = null;

  const taste = (e) => { if (e.key === 'Escape') { e.preventDefault(); aufraeumen(); } };
  document.addEventListener('keydown', taste, true);

  function aufraeumen() {
    abbruch = true;
    document.removeEventListener('keydown', taste, true);
    if (view && view.destroy) { try { view.destroy(); } catch (err) { /* egal */ } }
    if (overlay.parentNode) overlay.remove();
    hoehepunkte = null;
  }
  hoehepunkte = { overlay, view: null, abbrechen: aufraeumen };

  try {
    view = createPitchView(canvas, { cinematic: true });
    hoehepunkte.view = view;
    if (mod.ok && mod.loop.buildMatchTeam) {
      const heim = mod.loop.buildMatchTeam(state, fixture.homeId, true);
      const gast = mod.loop.buildMatchTeam(state, fixture.awayId, false);
      view.setTeams(heim, gast);
      if (view.setFormationPositions) view.setFormationPositions();
    }
    if (view.setSpeed) view.setSpeed(Number(state.settings && state.settings.speed) || 2);
    if (view.renderStatic) view.renderStatic();
  } catch (err) {
    console.error('[spieltag] Spielfeldansicht nicht verfügbar:', err);
    zaehler.textContent = 'Die Spielfeldansicht ist nicht verfügbar.';
    return;
  }

  const stand = [0, 0];
  for (let i = 0; i < phasen.length; i++) {
    if (abbruch) break;
    const ph = phasen[i];
    const ev = (result.events || [])[ph.eventIndex];
    if (ev && ev.score) { stand[0] = ev.score[0]; stand[1] = ev.score[1]; }
    zaehler.textContent = `Szene ${i + 1} von ${phasen.length} · ${ph.minute}' · ${ev && ev.text ? ev.text : ''}`;
    try {
      if (view.setClock) view.setClock(ph.minute, ev && ev.addedTime || 0, stand);
      await view.playPhase(ph);
      if (ev && ev.type === 'tor' && view.showBanner) view.showBanner('T O R !', 1200);
    } catch (err) {
      console.warn('[spieltag] Phase nicht abspielbar:', err);
    }
  }

  if (!abbruch) {
    zaehler.textContent = 'Das war es. ESC oder „Schließen" bringt Sie zurück.';
    schliessenBtn.textContent = 'Zurück zum Nachbericht';
  }
}
