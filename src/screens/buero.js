/**
 * Bildschirm „Managerbüro" – der Schreibtisch, an dem alles anfängt.
 *
 * Links: Post-Eingang und die Tagesordnung.
 * Rechts: der WEITER-Knopf, die Pinnwand, die harten Zahlen und der Ticker.
 *
 * Der Bildschirm rechnet nichts selbst – er fragt die club/*-Module und zeigt an.
 */

import {
  el, panel, subpanel, button, statBox, pill, dialog, toast, newsItem
} from '../render/ui.js';
import { drawCrest } from '../render/kits.js';
import { portraitDataURL } from '../render/portraits.js';
import { myClub, squadOf, nextFixtureFor } from '../core/state.js';
import { formatMoney, formatDate, round, nfmt, avg } from '../core/util.js';
import { POSITION_NAMES, COMPETITIONS } from '../core/constants.js';

import { lazarett } from '../club/medical.js';
import { englischeWoche } from '../club/media.js';
import { auslaufendeVertraege, fensterInfo, angebotAnnehmen, angebotAblehnen } from '../club/transfers.js';
import { gehaltsbudget } from '../club/finances.js';
import { tabellenlage, managerWechseln } from '../club/board.js';
import { fanaktionAnwenden } from '../club/fans.js';

/* ------------------------------------------------------------------ *
 *  Kleinkram
 * ------------------------------------------------------------------ */

/** Ruft eine optionale Modulfunktion auf und schluckt Fehler statt abzustürzen. */
function sicher(fn, ersatz, label) {
  try { return fn(); } catch (err) {
    console.warn(`[buero] ${label || 'Modulaufruf'} fehlgeschlagen:`, err);
    return ersatz;
  }
}

/** Kleiner roter Kasten statt eines abgestürzten Panels. */
function stoerung(text) {
  return el('div.tv-leer', { style: { color: 'var(--rot)', fontStyle: 'normal' } }, text);
}

/**
 * Panel-Überschrift mit rechtsbündigem Zusatz. Die Kopfleiste von ui.js ist ein
 * Flexcontainer und schiebt ihr letztes Kind nach rechts – deshalb ein Array.
 */
function panelTitel(text, extra) {
  if (!extra) return text;
  return [
    el('span', null, text),
    el('span', {
      style: { fontWeight: '400', textTransform: 'none', letterSpacing: '.02em', fontSize: '11px', opacity: '.85' }
    }, extra)
  ];
}

const POST_ARTEN = {
  vorstand: { icon: '🏛️', name: 'Vorstand' },
  jobangebot: { icon: '📞', name: 'Vorstand' },
  entlassung: { icon: '⚰️', name: 'Vorstand' },
  presse: { icon: '📰', name: 'Presse' },
  transfer: { icon: '💼', name: 'Transfers' },
  medizin: { icon: '🩺', name: 'Medizin' },
  fans: { icon: '🎺', name: 'Fans' },
  finanzen: { icon: '💰', name: 'Finanzen' },
  sponsor: { icon: '🤝', name: 'Sponsoren' },
  stadion: { icon: '🏟️', name: 'Stadion' },
  jugend: { icon: '🌱', name: 'Jugend' },
  training: { icon: '🏃', name: 'Training' },
  moral: { icon: '💬', name: 'Kabine' },
  stab: { icon: '🎓', name: 'Trainerstab' },
  info: { icon: '✉️', name: 'Geschäftsstelle' }
};

const POST_FILTER = [
  { id: 'alle', label: 'Alle' },
  { id: 'ungelesen', label: 'Ungelesen' },
  { id: 'vorstand', label: 'Vorstand', arten: ['vorstand', 'jobangebot', 'entlassung'] },
  { id: 'presse', label: 'Presse', arten: ['presse', 'fans'] },
  { id: 'transfer', label: 'Transfers', arten: ['transfer', 'sponsor', 'finanzen'] },
  { id: 'medizin', label: 'Medizin', arten: ['medizin', 'training', 'moral'] }
];

/** Der zuletzt gewählte Postfilter – überlebt ein ctx.refresh(). */
let postFilter = 'alle';

function artVon(msg) {
  return POST_ARTEN[msg && msg.kind] || POST_ARTEN.info;
}

/** Wappen-Canvas in beliebiger Größe (doppelt aufgelöst für scharfe Kanten). */
function wappen(club, groesse = 34) {
  const cv = el('canvas', {
    width: groesse * 2, height: groesse * 2,
    style: { width: groesse + 'px', height: groesse + 'px', flex: `0 0 ${groesse}px` }
  });
  if (club) {
    try { drawCrest(cv.getContext('2d'), club, groesse, groesse, groesse * 2); }
    catch (err) { /* Wappen ist Zierrat, kein Grund zum Absturz */ }
  }
  return cv;
}

/** S/U/N-Kette der letzten Spiele. */
function formLeiste(form) {
  const arr = (form || []).slice(-5);
  if (!arr.length) return el('span.tv-mini', null, 'noch nichts gespielt');
  const f = el('span.tv-form');
  for (const z of arr) f.appendChild(el('span', { class: z }, z));
  return f;
}

/** Notizzettel für die Pinnwand. */
function zettel(titel, wert, unter, farbe) {
  return el('div.tv-zettel', {
    style: farbe ? { borderLeft: `6px solid ${farbe}` } : null
  },
  el('b', null, titel),
  el('div', { style: { fontWeight: '700', fontSize: '16px', fontFamily: 'var(--font-num)', lineHeight: '1.2' } }, wert),
  unter ? el('div.tv-mini', null, unter) : null);
}

function ampel(wert, gut = 60, schlecht = 40) {
  if (wert >= gut) return '#2f7d32';
  if (wert <= schlecht) return '#c1272d';
  return '#d9a521';
}

function portraitBild(player, groesse = 30) {
  const img = el('img.tv-portrait', {
    width: groesse, height: groesse,
    style: { width: groesse + 'px', height: groesse + 'px', flex: `0 0 ${groesse}px` },
    alt: ''
  });
  try { img.src = portraitDataURL(player, groesse * 2); } catch (err) { /* ohne Gesicht geht es auch */ }
  return img;
}

/* ------------------------------------------------------------------ *
 *  Post
 * ------------------------------------------------------------------ */

function passtZumFilter(msg, filterId) {
  if (filterId === 'alle') return true;
  if (filterId === 'ungelesen') return !msg.gelesen;
  const f = POST_FILTER.find(x => x.id === filterId);
  return !!(f && f.arten && f.arten.includes(msg.kind));
}

/** Führt eine Nachrichten-Aktion über das zuständige club/*-Modul aus. */
async function aktionAusfuehren(a, msg, ctx) {
  const s = ctx.state;
  const clubId = s.managerClubId;
  let navigiert = false;

  try {
    if (a.modul === 'fans') {
      const r = fanaktionAnwenden(s, clubId, a.aktionId, a.id);
      toast(r && r.text ? r.text : 'Die Fans haben es zur Kenntnis genommen.', r && r.ok ? 'gut' : 'warn');
    } else {
      switch (a.id) {
        case 'angebot_annehmen': {
          const r = angebotAnnehmen(s, a.angebotId || (a.data && a.data.angebotId));
          toast(r && r.text ? r.text : 'Der Transfer ist durch.', r && r.ok ? 'gut' : 'warn');
          break;
        }
        case 'angebot_ablehnen': {
          const r = angebotAblehnen(s, a.angebotId || (a.data && a.data.angebotId));
          toast(r && r.text ? r.text : 'Abgelehnt.', r && r.ok ? 'gut' : 'warn');
          break;
        }
        case 'job_annehmen': {
          const zielId = (a.data && a.data.clubId) || a.clubId;
          const r = managerWechseln(s, zielId);
          toast(r && r.text ? r.text : 'Sie haben den Verein gewechselt.', r && r.ok ? 'gut' : 'schlecht');
          break;
        }
        case 'job_ablehnen': {
          const angebotId = (a.data && a.data.angebotId) || a.angebotId;
          if (Array.isArray(s.manager.angebote)) {
            s.manager.angebote = s.manager.angebote.filter(x => x && x.id !== angebotId);
          }
          toast('Höflich abgelehnt. Man bleibt ja im Geschäft.', 'info');
          break;
        }
        case 'pressekonferenz_oeffnen':
          msg.erledigt = true;
          navigiert = true;
          await ctx.navigate('presse');
          break;
        default:
          toast('Für diesen Vorgang ist der zuständige Bildschirm die bessere Adresse.', 'warn');
      }
    }
  } catch (err) {
    console.error('[buero] Nachrichtenaktion fehlgeschlagen:', err);
    toast('Das ging schief: ' + (err && err.message ? err.message : 'unbekannter Fehler'), 'schlecht');
  }

  msg.erledigt = true;
  ctx.aktualisiere();
  if (!navigiert) ctx.refresh();
}

async function briefOeffnen(msg, ctx) {
  const war = msg.gelesen;
  msg.gelesen = true;
  if (!war) ctx.aktualisiere();

  const art = artVon(msg);
  const korpus = el('div.tv-spalte',
    el('div.tv-zeile.tv-zeile--verteilt', { style: { borderBottom: '1px solid var(--linie)', paddingBottom: '5px' } },
      el('div', null,
        el('div', { style: { fontWeight: '700' } }, msg.from || art.name),
        el('div.tv-mini', null, `${art.name} · ${formatDate(msg.day || 0, msg.season || 1, ctx.state.date.startYear)}`)),
      msg.wichtig ? pill('WICHTIG', 'schlecht') : pill(art.name, 'neutral')),
    el('div', { style: { whiteSpace: 'pre-wrap', lineHeight: '1.55', fontSize: '13px' } },
      msg.body || '(Der Bogen ist leer. Vermutlich die Poststelle.)'));

  const aktionen = [];
  if (Array.isArray(msg.aktionen) && msg.aktionen.length && !msg.erledigt) {
    for (const a of msg.aktionen) {
      if (!a) continue;
      aktionen.push({ label: a.label || 'Ausführen', value: a, kind: aktionen.length === 0 ? 'primary' : 'default' });
    }
  }
  aktionen.push({ label: 'Ablegen', value: null, kind: 'ghost' });

  const gewaehlt = await dialog(msg.subject || 'Ohne Betreff', korpus, aktionen, { size: 'md' });
  if (gewaehlt) await aktionAusfuehren(gewaehlt, msg, ctx);
  else ctx.refresh();
}

function postPanel(ctx) {
  const s = ctx.state;
  const alle = Array.isArray(s.inbox) ? s.inbox : [];
  const ungelesen = alle.filter(m => !m.gelesen).length;

  const liste = el('div', { style: { maxHeight: '360px', overflowY: 'auto' } });
  const leiste = el('div.tv-filter');

  function zeichneListe() {
    liste.innerHTML = '';
    const gefiltert = alle.filter(m => passtZumFilter(m, postFilter)).slice(0, 60);
    if (!gefiltert.length) {
      liste.appendChild(el('div.tv-leer', null,
        postFilter === 'ungelesen'
          ? 'Alles gelesen. Ein seltener und schöner Zustand.'
          : 'Kein Schriftverkehr in dieser Ablage.'));
      return;
    }
    for (const msg of gefiltert) {
      const art = artVon(msg);
      const zeile = el('div.tv-brief', {
        class: msg.gelesen ? null : 'tv-brief--ungelesen',
        onClick: () => briefOeffnen(msg, ctx)
      },
      el('div.tv-brief__icon', null, art.icon),
      el('div.tv-brief__text', null,
        el('div.tv-brief__betreff', null, msg.subject || '(ohne Betreff)'),
        el('div.tv-brief__von', null,
          `${msg.from || art.name}`,
          msg.aktionen && msg.aktionen.length && !msg.erledigt ? ' · Entscheidung nötig' : '')),
      el('div.tv-brief__tag', null,
        msg.wichtig ? el('div', { style: { color: 'var(--rot)', fontWeight: '700' } }, '!') : null,
        el('div', null, `Tag ${msg.day !== undefined ? msg.day : '?'}`)));
      liste.appendChild(zeile);
    }
  }

  for (const f of POST_FILTER) {
    const anzahl = alle.filter(m => passtZumFilter(m, f.id)).length;
    const b = button(`${f.label} (${anzahl})`, () => {
      postFilter = f.id;
      leiste.querySelectorAll('.tv-btn').forEach(x => x.classList.remove('tv-btn--gold'));
      b.classList.add('tv-btn--gold');
      zeichneListe();
    }, { size: 'klein', kind: postFilter === f.id ? 'gold' : 'ghost' });
    leiste.appendChild(b);
  }

  zeichneListe();

  const p = panel(panelTitel('📬 Post', ungelesen ? `${ungelesen} ungelesen` : 'nichts Neues'), leiste, liste);
  p.classList.add('tv-buero__post');
  return p;
}

/* ------------------------------------------------------------------ *
 *  Was heute ansteht
 * ------------------------------------------------------------------ */

function gegnerBlock(ctx, club, fixture) {
  const s = ctx.state;
  if (!fixture) {
    return el('div.tv-leer', null, 'Kein Spiel mehr im Kalender. Genießen Sie die Ruhe – sie hält nie lange.');
  }
  const heim = fixture.homeId === club.id;
  const gegner = s.clubs[heim ? fixture.awayId : fixture.homeId];
  const tage = (fixture.dayIndex || 0) - s.date.day;
  const wettbewerb = (COMPETITIONS[fixture.competitionId] || { name: fixture.competitionId || 'Spiel' }).name;

  // Amateur- und Europapokalgegner stehen in keiner Tabelle – dann gibt es auch keinen Platz.
  const inLiga = (c) => !!(c && (c.leagueId === 'bl1' || c.leagueId === 'bl2'));
  const lageVon = (c) => (inLiga(c) ? sicher(() => tabellenlage(s, c.id), null, 'tabellenlage') : null);
  const lageEigen = lageVon(club);
  const lageGegner = lageVon(gegner);

  const seite = (c, lage, istHeim) => el('div', { style: { flex: '1', minWidth: '0', textAlign: istHeim ? 'left' : 'right' } },
    el('div.tv-zeile', { style: { justifyContent: istHeim ? 'flex-start' : 'flex-end' } },
      istHeim ? wappen(c, 40) : null,
      el('div', { style: { minWidth: '0' } },
        el('div', { style: { fontWeight: '700', fontSize: '13.5px' } }, c ? c.shortName : 'Unbekannt'),
        el('div.tv-mini', null, lage
          ? `${lage.platz}. Platz · ${lage.punkte} Pkt`
          : (c && c.istAmateur ? 'Amateurverein' : 'ohne Tabellenplatz'))),
      istHeim ? null : wappen(c, 40)),
    el('div', { style: { marginTop: '4px', display: 'flex', justifyContent: istHeim ? 'flex-start' : 'flex-end' } },
      formLeiste(c && c.season ? c.season.form : [])));

  return el('div.tv-spalte',
    el('div.tv-zeile', { style: { gap: '10px', alignItems: 'center' } },
      seite(heim ? club : gegner, heim ? lageEigen : lageGegner, true),
      el('div', { style: { textAlign: 'center', flex: '0 0 86px' } },
        el('div', { style: { fontFamily: 'var(--font-num)', fontSize: '19px', fontWeight: '700' } }, ':'),
        el('div.tv-mini', null, heim ? 'HEIM' : 'AUSWÄRTS')),
      seite(heim ? gegner : club, heim ? lageGegner : lageEigen, false)),
    el('div.tv-mini', { style: { textAlign: 'center' } },
      `${wettbewerb}${fixture.matchday ? ', ' + fixture.matchday + '. Spieltag' : ''} · ` +
      `${formatDate(fixture.dayIndex, s.date.season, s.date.startYear)} · ` +
      (tage <= 0 ? 'HEUTE' : tage === 1 ? 'morgen' : `in ${tage} Tagen`)));
}

/**
 * Der Hinweis auf die englische Woche (ROADMAP Stufe 3, Punkt 6).
 *
 * `club/media.js:englischeWoche` zählt drei Pflichtspiele in acht Tagen — Liga,
 * Pokal und Europapokal gleichberechtigt. Angezeigt wird nur, was `akut` ist
 * (läuft oder beginnt binnen drei Tagen); für einen Europapokalstarter wäre der
 * Hinweis sonst von September bis Mai Tapete.
 */
function englischPlan(woche) {
  if (!woche || !woche.englisch || !woche.akut) return null;
  return el('div.tv-englisch',
    el('b', null, `${woche.spiele} Spiele in acht Tagen`),
    el('span', null, woche.laufend
      ? ' — der Physio schaut schon skeptisch. Wer jetzt nicht rotiert, rotiert im Mai die Reha-Pläne.'
      : ` — es geht in ${woche.tageBisStart} Tagen los. Der Physio schaut schon skeptisch.`));
}

function personenListe(eintraege, leerText, zeileFn) {
  if (!eintraege.length) return el('div.tv-mini', { style: { padding: '4px 2px' } }, leerText);
  const box = el('div.tv-spalte', { style: { gap: '2px' } });
  for (const e of eintraege) box.appendChild(zeileFn(e));
  return box;
}

function heutePanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const fixture = sicher(() => nextFixtureFor(s, club.id), null, 'nextFixtureFor');

  const ausfaelle = sicher(() => lazarett(s, club.id), [], 'lazarett');
  const verletzte = ausfaelle.filter(e => e.status === 'verletzt');
  const gesperrte = ausfaelle.filter(e => e.status === 'gesperrt');

  const auslaufend = sicher(() => auslaufendeVertraege(s, club.id, { jahre: 0 }), [], 'auslaufendeVertraege');
  const woche = sicher(() => englischeWoche(s, club.id), null, 'englischeWoche');
  const board = club.board || {};
  const forderungen = (board.forderungen || []).filter(f => f && f.status === 'offen');

  const ausfallZeile = (e) => {
    const p = s.players[e.playerId];
    return el('div.tv-zeile', { style: { gap: '6px', fontSize: '12px', padding: '2px 0' } },
      p ? portraitBild(p, 26) : null,
      el('span', { style: { flex: '1', minWidth: '0' } },
        el('b', null, e.name),
        el('span.tv-mini', null, ` ${POSITION_NAMES[e.position] || e.position || ''}`)),
      p && p.era === 'legend' ? pill('Legende', 'legende') : null,
      el('span.tv-mini', { style: { textAlign: 'right' } }, `${e.diagnose} · ${e.prognose}`));
  };

  return panel(panelTitel('📌 Was heute ansteht', formatDate(s.date.day, s.date.season, s.date.startYear)),
    el('div.tv-spalte',
    englischPlan(woche),
    subpanel('Nächstes Pflichtspiel', gegnerBlock(ctx, club, fixture)),
    el('div.tv-grid.tv-grid--2',
      subpanel(`Lazarett (${verletzte.length})`,
        personenListe(verletzte.slice(0, 6), 'Kein Mann in Behandlung. Der Arzt liest Zeitung.', ausfallZeile)),
      subpanel(`Gesperrt (${gesperrte.length})`,
        personenListe(gesperrte.slice(0, 6), 'Alle dürfen spielen. Auch die Groben.', ausfallZeile))),
    el('div.tv-grid.tv-grid--2',
      subpanel(`Auslaufende Verträge (${auslaufend.length})`,
        personenListe(auslaufend.slice(0, 6), 'Alle Verträge laufen weiter. Vorerst.', (e) => {
          const p = e.player || s.players[e.playerId];
          return el('div.tv-zeile', { style: { gap: '6px', fontSize: '12px', padding: '2px 0' } },
            p ? portraitBild(p, 26) : null,
            el('span', { style: { flex: '1', minWidth: '0' } },
              el('b', null, p ? p.lastName : e.playerId),
              p && p.era === 'legend' ? ' ' : null,
              p && p.era === 'legend' ? pill(p.eraLabel || 'Legende', 'legende') : null),
            el('span.tv-mini', { style: { textAlign: 'right' } },
              `${e.rolle || ''} · fordert ${formatMoney(e.forderung ? e.forderung.gehalt : 0)}`));
        })),
      subpanel(`Vorstandsforderungen (${forderungen.length})`,
        personenListe(forderungen.slice(0, 5), 'Der Vorstand fordert gerade nichts. Verdächtig.', (f) => {
          const rest = (f.frist || 0) - s.date.day;
          let stand = '';
          try { const r = f.pruefen ? f.pruefen(s) : null; if (r) stand = r.fortschritt || ''; } catch (err) { stand = ''; }
          return el('div', { style: { fontSize: '12px', padding: '3px 0', borderBottom: '1px dotted rgba(0,0,0,.16)' } },
            el('div', null, f.text),
            el('div.tv-mini', null,
              `Frist: noch ${Math.max(0, rest)} Tage${stand ? ' · ' + stand : ''}`));
        }))),
    el('div.tv-zeile', { style: { flexWrap: 'wrap' } },
      button('Zum Kader', () => ctx.navigate('kader'), { size: 'klein', kind: 'ghost' }),
      button('Aufstellung', () => ctx.navigate('taktik'), { size: 'klein', kind: 'ghost' }),
      button('Lazarett', () => ctx.navigate('medizin'), { size: 'klein', kind: 'ghost' }),
      button('Transfermarkt', () => ctx.navigate('transfer'), { size: 'klein', kind: 'ghost' }),
      button('Vereinsakte', () => ctx.navigate('verein'), { size: 'klein', kind: 'ghost' }))));
}

/* ------------------------------------------------------------------ *
 *  Weiter-Knopf
 * ------------------------------------------------------------------ */

function weiterPanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const fixture = sicher(() => nextFixtureFor(s, club.id), null, 'nextFixtureFor');
  const fenster = sicher(() => fensterInfo(s, s.date.day), null, 'fensterInfo');

  const tage = fixture ? (fixture.dayIndex - s.date.day) : null;
  let haupt;
  if (tage === null) haupt = 'Kein Spiel mehr angesetzt – der Kalender wird weitergeblättert.';
  else if (tage <= 0) haupt = 'HEUTE WIRD GESPIELT.';
  else if (tage === 1) haupt = 'Morgen ist Spieltag – letzte Einheit, letzte Ansprache.';
  else haupt = `Nächstes Spiel in ${tage} Tagen. Bis dahin: Trainingswoche.`;

  const zusatz = [];
  if (fenster) {
    zusatz.push(fenster.offen
      ? `${fenster.name} offen, noch ${fenster.tageBisSchluss} Tage.`
      : `Transferfenster geschlossen, öffnet in ${fenster.tageBisOeffnung} Tagen.`);
  }
  const ungelesen = (s.inbox || []).filter(m => !m.gelesen && m.wichtig).length;
  if (ungelesen) zusatz.push(`${ungelesen} wichtige Schreiben warten noch auf Sie.`);

  const knopf = button('WEITER ▶', () => ctx.weiter(), { kind: 'primary', size: 'gross', wide: true });
  knopf.style.fontSize = '22px';
  knopf.style.letterSpacing = '3px';
  knopf.style.padding = '16px';

  return panel('⏭️ Der nächste Schritt',
    el('div.tv-spalte',
      knopf,
      el('div', { style: { textAlign: 'center', fontWeight: '700', fontSize: '13px' } }, haupt),
      zusatz.length ? el('div.tv-mini', { style: { textAlign: 'center' } }, zusatz.join(' ')) : null,
      el('div.tv-zeile', { style: { justifyContent: 'center' } },
        button('💾 Speichern', () => ctx.speichern(), { size: 'klein', kind: 'ghost' }),
        button('Zum Spieltag', () => ctx.navigate('spieltag'), { size: 'klein', kind: 'ghost' }))));
}

/* ------------------------------------------------------------------ *
 *  Pinnwand
 * ------------------------------------------------------------------ */

function pinnwandPanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const board = club.board || {};
  const fin = club.finances || {};
  const fans = club.fans || {};

  const ziel = board.saisonziel || board.erwartung || null;
  const lage = sicher(() => tabellenlage(s, club.id), null, 'tabellenlage');
  const gb = sicher(() => gehaltsbudget(s, club.id), null, 'gehaltsbudget');

  const wand = el('div.tv-pinnwand');
  wand.appendChild(zettel('Saisonziel',
    ziel ? ziel.text : 'noch nicht formuliert',
    ziel && ziel.platz ? `Zielplatz ${ziel.platz}${lage ? ` · aktuell ${lage.platz}.` : ''}` : 'Der Vorstand schweigt sich aus.',
    ziel && lage ? ampel(ziel.platz - lage.platz + 60, 60, 55) : '#8b5a2b'));

  wand.appendChild(zettel('Vorstand',
    `${Math.round(board.zufriedenheit !== undefined ? board.zufriedenheit : 50)} %`,
    `Geduld ${Math.round(board.geduld !== undefined ? board.geduld : 50)} %` +
      (board.warnungen ? ` · ${board.warnungen} Verwarnung${board.warnungen === 1 ? '' : 'en'}` : ''),
    ampel(board.zufriedenheit !== undefined ? board.zufriedenheit : 50)));

  wand.appendChild(zettel('Fanstimmung',
    `${Math.round(fans.mood !== undefined ? fans.mood : 50)} %`,
    `${nfmt(Math.round(fans.members || 0))} Mitglieder` +
      (fans.protest > 25 ? ` · Protest ${Math.round(fans.protest)}` : ''),
    ampel(fans.mood !== undefined ? fans.mood : 50)));

  wand.appendChild(zettel('Kontostand',
    formatMoney(fin.balance || 0),
    (fin.debt ? `Schulden ${formatMoney(fin.debt)}` : 'schuldenfrei'),
    (fin.balance || 0) >= 0 ? '#2f7d32' : '#c1272d'));

  wand.appendChild(zettel('Transferbudget',
    formatMoney(fin.transferBudget || 0),
    'frei verfügbar für Neuzugänge',
    (fin.transferBudget || 0) > 0 ? '#1c4f8f' : '#c1272d'));

  wand.appendChild(zettel('Gehaltsbudget',
    gb ? `${round(gb.auslastung, 1)} % ausgelastet` : 'unbekannt',
    gb ? `${formatMoney(gb.verbraucht)} von ${formatMoney(gb.budget)}` : 'Die Buchhaltung meldet sich nicht.',
    gb ? (gb.auslastung > 100 ? '#c1272d' : gb.auslastung > 88 ? '#d9a521' : '#2f7d32') : '#8b5a2b'));

  return panel('📋 Pinnwand', wand);
}

/* ------------------------------------------------------------------ *
 *  Der Verein in Zahlen
 * ------------------------------------------------------------------ */

function zahlenPanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const kader = sicher(() => squadOf(s, club.id), [], 'squadOf');
  const lage = sicher(() => tabellenlage(s, club.id), null, 'tabellenlage');
  const saison = club.season || {};
  const stad = club.stadiumState || {};

  const serie = saison.serie || 0;
  const serieText = serie > 0 ? `${serie} Siege in Folge`
    : serie < 0 ? `${Math.abs(serie)} Niederlagen in Folge`
      : 'kein Lauf, kein Absturz';

  const schnitt = stad.heimspiele
    ? Math.round((stad.zuschauerSumme || 0) / stad.heimspiele)
    : Math.round(stad.letzteZuschauer || 0);

  const alter = kader.length ? round(avg(kader, p => p.age || 0), 1) : 0;
  const wert = kader.reduce((sum, p) => sum + (p.value || 0), 0);

  const gitter = el('div.tv-grid.tv-grid--3', { style: { gap: '6px' } },
    statBox('Tabelle', lage ? `${lage.platz}.` : '–',
      { sub: lage ? `von ${lage.teams} · ${lage.spiele} Spiele` : 'noch nicht gespielt' }),
    statBox('Punkte', lage ? String(lage.punkte) : '0',
      { sub: lage ? `Differenz ${lage.diff > 0 ? '+' : ''}${lage.diff}` : '–' }),
    statBox('Tore', `${saison.tore || 0}:${saison.gegentore || 0}`,
      { sub: 'geschossen : kassiert' }),
    statBox('Serie', serie === 0 ? '–' : (serie > 0 ? `+${serie}` : String(serie)),
      { sub: serieText, kind: serie > 0 ? 'gut' : serie < 0 ? 'schlecht' : null }),
    statBox('Zuschauerschnitt', schnitt ? nfmt(schnitt) : '–',
      { sub: club.stadium ? `${nfmt(club.stadium.capacity || 0)} Plätze` : '' }),
    statBox('Kaderwert', formatMoney(wert),
      { sub: `${kader.length} Profis · Ø ${alter} Jahre` }));

  const bestenliste = kader.slice()
    .sort((a, b) => ((b.stats && b.stats.season ? b.stats.season.tore : 0) || 0) - ((a.stats && a.stats.season ? a.stats.season.tore : 0) || 0))
    .filter(p => p.stats && p.stats.season && p.stats.season.tore > 0)
    .slice(0, 3);

  const torjaeger = bestenliste.length
    ? el('div.tv-spalte', { style: { gap: '2px' } }, ...bestenliste.map(p =>
      el('div.tv-zeile', { style: { fontSize: '12px', gap: '6px' } },
        portraitBild(p, 24),
        // `minWidth: '0'` wie in jeder anderen Namenszeile dieses Bildschirms
        // (siehe ausfallZeile und die Vertragsliste weiter oben). Ohne das
        // bleibt `min-width: auto` stehen, und ein Abzeichen wie
        // „Weltpokalsiegerbesieger 2002" drückt die Zeile aus dem Kasten,
        // statt sie umbrechen zu lassen.
        el('span', { style: { flex: '1', minWidth: '0' } }, p.lastName,
          p.era === 'legend' ? ' ' : null,
          p.era === 'legend' ? pill(p.eraLabel || 'Legende', 'legende') : null),
        el('b.tv-num', null, `${p.stats.season.tore} Tore`))))
    : el('div.tv-mini', null, 'Noch kein Treffer. Der Sturm arbeitet daran.');

  return panel('📊 Der Verein in Zahlen',
    el('div.tv-spalte', gitter, subpanel('Interne Torjägerliste', torjaeger)));
}

/* ------------------------------------------------------------------ *
 *  Meldungen
 * ------------------------------------------------------------------ */

function meldungenPanel(ctx) {
  const s = ctx.state;
  const news = (s.news || []).slice(0, 12);
  const box = el('div.tv-spalte', { style: { gap: '3px', maxHeight: '300px', overflowY: 'auto' } });
  if (!news.length) {
    box.appendChild(el('div.tv-leer', null, 'Noch nichts passiert. Das ändert sich schnell genug.'));
  } else {
    for (const n of news) {
      box.appendChild(newsItem(n.text, {
        kind: n.kind === 'gut' || n.kind === 'schlecht' || n.kind === 'warn' ? n.kind : 'info',
        datum: `Tag ${n.day}`
      }));
    }
  }
  return panel('📣 Meldungen', box);
}

/* ------------------------------------------------------------------ *
 *  Screen
 * ------------------------------------------------------------------ */

export const screen = {
  id: 'buero',
  title: 'Büro',
  icon: '🗂️',

  async render(root, ctx) {
    const s = ctx.state;
    if (!s || !s.clubs || !s.managerClubId || !s.clubs[s.managerClubId]) {
      root.appendChild(panel('Managerbüro',
        stoerung('Kein gültiger Spielstand geladen – der Verein des Managers fehlt im Zustand.')));
      return;
    }
    const club = myClub(s);

    const seite = el('div.tv-seite');
    seite.appendChild(el('div.tv-seite__kopf',
      el('h1.tv-seite__titel', null, 'Managerbüro'),
      el('div.tv-seite__unter', null,
        `${club.name} · ${formatDate(s.date.day, s.date.season, s.date.startYear)} · ` +
        `Saison ${s.date.season} · ${s.manager ? s.manager.name : 'Der Trainer'}`)));

    const links = el('div.tv-spalte');
    const rechts = el('div.tv-spalte');

    const bauen = (fn, titel) => {
      try { return fn(ctx); }
      catch (err) {
        console.error(`[buero] ${titel} fehlgeschlagen:`, err);
        return panel(titel, stoerung(`Dieser Bereich konnte nicht gezeichnet werden: ${err && err.message ? err.message : err}`));
      }
    };

    links.appendChild(bauen(postPanel, 'Post'));
    links.appendChild(bauen(heutePanel, 'Was heute ansteht'));

    rechts.appendChild(bauen(weiterPanel, 'Der nächste Schritt'));
    rechts.appendChild(bauen(pinnwandPanel, 'Pinnwand'));
    rechts.appendChild(bauen(zahlenPanel, 'Der Verein in Zahlen'));
    rechts.appendChild(bauen(meldungenPanel, 'Meldungen'));

    seite.appendChild(el('div.tv-buero', links, rechts));
    root.appendChild(seite);
  }
};

export default screen;
