/**
 * Bildschirm „Verein" – die Vereinsakte.
 *
 * Wappen, Erfolge, Legenden, Vorstand, Fans, Rivalen, Chronik und die eigene
 * Trainerkarriere. Herzstück ist die Legendengalerie: hier stehen die Männer,
 * wegen denen dieses Spiel existiert.
 */

import {
  el, panel, subpanel, button, bar, table, statBox, pill, dialog, toast, confirm
} from '../render/ui.js';
import { drawCrest } from '../render/kits.js';
import { portraitDataURL } from '../render/portraits.js';
import { myClub, squadOf } from '../core/state.js';
import { formatMoney, formatDate, clamp, round, nfmt, ratingClass } from '../core/util.js';
import { POSITION_NAMES, ATTRIBUTE_NAMES, TRAITS, COMPETITIONS } from '../core/constants.js';
import { CUP } from '../data/leagues.js';

import { playerOverall } from '../engine/ratings.js';
import { bewertung, vertrauensfrage, budgetVerhandeln, tabellenlage, NOTEN_TEXT } from '../club/board.js';
import { fanUebersicht, fanaktionAnwenden } from '../club/fans.js';
import { rivalenVon } from '../club/stadium.js';
import {
  teamGeist, hierarchie, RANG_NAMEN, offeneKonflikte,
  loesungsWege, konfliktLoesen, KONFLIKT_ARTEN
} from '../club/morale.js';
import { chemieBericht, cliquen, mentorPaare, mentorVorschlaege, paarChemie } from '../club/chemie.js';

/* ------------------------------------------------------------------ *
 *  Kleinkram
 * ------------------------------------------------------------------ */

function sicher(fn, ersatz, label) {
  try { return fn(); } catch (err) {
    console.warn(`[verein] ${label || 'Modulaufruf'} fehlgeschlagen:`, err);
    return ersatz;
  }
}

function stoerung(text) {
  return el('div.tv-leer', { style: { color: 'var(--rot)', fontStyle: 'normal' } }, text);
}

/** Panel-Überschrift mit rechtsbündigem Zusatz (die Kopfleiste ist ein Flexcontainer). */
function panelTitel(text, extra) {
  if (!extra) return text;
  return [
    el('span', null, text),
    el('span', {
      style: { fontWeight: '400', textTransform: 'none', letterSpacing: '.02em', fontSize: '11px', opacity: '.85' }
    }, extra)
  ];
}

function wappen(club, groesse) {
  const cv = el('canvas', {
    width: groesse * 2, height: groesse * 2,
    style: { width: groesse + 'px', height: groesse + 'px', flex: `0 0 ${groesse}px` }
  });
  if (club) {
    try { drawCrest(cv.getContext('2d'), club, groesse, groesse, groesse * 2); }
    catch (err) { /* Wappen ist Zierrat */ }
  }
  return cv;
}

function portraitBild(player, groesse) {
  const img = el('img.tv-portrait', {
    width: groesse, height: groesse,
    style: { width: groesse + 'px', height: groesse + 'px', flex: `0 0 ${groesse}px` },
    alt: ''
  });
  try { img.src = portraitDataURL(player, groesse * 2); } catch (err) { /* ohne Gesicht auch gut */ }
  return img;
}

function ovrKreis(wert) {
  const v = Math.round(wert || 0);
  return el('div.tv-ovr', { class: ratingClass(v) }, el('b', null, String(v)), el('small', null, 'STÄRKE'));
}

function farbklecks(farbe, titel) {
  return el('span', {
    title: titel || farbe,
    style: {
      width: '18px', height: '18px', display: 'inline-block', borderRadius: '3px',
      background: farbe || '#666', border: '2px solid rgba(0,0,0,.45)',
      boxShadow: 'inset 0 -2px 4px rgba(0,0,0,.3)'
    }
  });
}

/* ------------------------------------------------------------------ *
 *  Kopf der Akte
 * ------------------------------------------------------------------ */

function kopfPanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const st = club.stadium || {};
  const lage = sicher(() => tabellenlage(s, club.id), null, 'tabellenlage');
  const liga = COMPETITIONS[club.leagueId] || { name: club.leagueId || 'Liga' };

  const daten = el('div', { style: { flex: '1', minWidth: '0' } },
    el('h2', {
      style: {
        margin: '0', fontFamily: 'var(--font-titel)', fontSize: '30px',
        letterSpacing: '1.5px', lineHeight: '1.05'
      }
    }, club.name),
    el('div.tv-mini', { style: { fontSize: '12.5px', marginTop: '2px' } },
      `${club.city} · gegründet ${club.founded || '????'} · ${liga.name} · Ruf ${club.reputation || '–'}/100`),
    el('div.tv-zeile', { style: { marginTop: '8px', flexWrap: 'wrap', gap: '14px' } },
      el('div', null,
        el('div.tv-mini', null, 'Stadion'),
        el('b', null, st.name || 'Kein Stadion gemeldet'),
        el('div.tv-mini', null,
          `${nfmt(st.capacity || 0)} Plätze · ${Math.round((st.standing || 0) * 100)} % Stehplätze · ` +
          `${st.roof ? 'überdacht' : 'ohne Dach'} · ${st.tiers || 1} Ränge`)),
      el('div', null,
        el('div.tv-mini', null, 'Vereinsfarben'),
        el('div.tv-zeile', { style: { gap: '4px', marginTop: '3px' } },
          farbklecks(club.colors && club.colors.primary, 'Hauptfarbe'),
          farbklecks(club.colors && club.colors.secondary, 'Zweitfarbe'),
          farbklecks(club.colors && club.colors.accent, 'Akzent'))),
      el('div', null,
        el('div.tv-mini', null, 'Kürzel'),
        el('b', { style: { fontSize: '18px', letterSpacing: '2px' } }, club.abbr || club.shortName))));

  const kennzahlen = el('div.tv-grid.tv-grid--4', { style: { gap: '6px', marginTop: '8px' } },
    statBox('Tabellenplatz', lage ? `${lage.platz}.` : '–', { sub: lage ? `${lage.punkte} Punkte` : 'Saison läuft an' }),
    statBox('Kontostand', formatMoney((club.finances || {}).balance || 0),
      { kind: ((club.finances || {}).balance || 0) >= 0 ? 'gut' : 'schlecht' }),
    statBox('Mitglieder', nfmt(Math.round((club.fans || {}).members || 0)), { sub: 'eingetragene Mitglieder' }),
    statBox('Titel', String((club.history || {}).titles || 0),
      { sub: (club.history || {}).lastTitle ? `zuletzt ${club.history.lastTitle}` : 'noch keiner', kind: 'gold' }));

  return panel(panelTitel('🏛️ Vereinsakte', formatDate(s.date.day, s.date.season, s.date.startYear)),
    el('div', null,
      el('div.tv-zeile', { style: { gap: '16px', alignItems: 'flex-start' } },
        wappen(club, 120),
        daten),
      kennzahlen));
}

/* ------------------------------------------------------------------ *
 *  Erfolge
 * ------------------------------------------------------------------ */

function erfolgePanel(ctx) {
  const club = myClub(ctx.state);
  const h = club.history || {};
  const honours = Array.isArray(h.honours) ? h.honours : [];

  const liste = honours.length
    ? el('div.tv-spalte', { style: { gap: '2px' } }, ...honours.map(t =>
      el('div.tv-zeile', { style: { fontSize: '12.5px', padding: '3px 0', borderBottom: '1px dotted rgba(0,0,0,.16)' } },
        el('span', { style: { fontSize: '15px' } }, '🏆'),
        el('span', null, t))))
    : el('div.tv-leer', null, 'Die Vitrine ist leer. Noch. Man wischt sie trotzdem jede Woche.');

  return panel('🏆 Erfolge',
    el('div.tv-spalte',
      el('div.tv-grid.tv-grid--2', { style: { gap: '6px' } },
        statBox('Titel gesamt', String(h.titles || 0), { kind: 'gold' }),
        statBox('Letzter Titel', h.lastTitle ? String(h.lastTitle) : '–',
          { sub: h.lastTitle ? `${Math.max(0, (ctx.state.date.startYear + ctx.state.date.season - 1) - h.lastTitle)} Jahre her` : 'wartet auf Sie' })),
      subpanel('Erfolge in der Vitrine', liste)));
}

/* ------------------------------------------------------------------ *
 *  Vereinslegenden
 * ------------------------------------------------------------------ */

const ATTR_AUSWAHL = [
  'schuss', 'technik', 'passspiel', 'dribbling', 'kopfball', 'standards',
  'tempo', 'ausdauer', 'koerper', 'sprungkraft',
  'uebersicht', 'positionsspiel', 'zweikampf', 'nervenstaerke', 'fuehrung',
  'reflexe', 'stellungsspiel', 'strafraumbeherrschung'
];

/** Baut aus Attributen und Traits eine Kurzbeschreibung im Reporterton. */
function legendenText(p) {
  const attrs = p.attributes || {};
  const beste = ATTR_AUSWAHL
    .filter(k => typeof attrs[k] === 'number')
    .sort((a, b) => attrs[b] - attrs[a])
    .slice(0, 3)
    .map(k => `${ATTRIBUTE_NAMES[k] || k} ${attrs[k]}`);
  const traitText = (p.traits || [])
    .map(t => TRAITS[t])
    .filter(Boolean)
    .map(t => t.name);
  const teile = [];
  if (beste.length) teile.push(beste.join(' · '));
  if (traitText.length) teile.push(traitText.join(', '));
  return teile.join(' — ') || 'Ein Mann für die ewigen Tabellen.';
}

function legendenKarte(p, ctx) {
  const ovr = sicher(() => playerOverall(p), 0, 'playerOverall');
  const karte = el('div', {
    style: {
      display: 'flex', flexDirection: 'column', gap: '5px', padding: '8px',
      background: 'linear-gradient(180deg, rgba(255,248,220,.75), rgba(240,220,160,.55))',
      border: '2px solid var(--gold)',
      boxShadow: '0 0 8px rgba(217,165,33,.35), 0 2px 5px rgba(0,0,0,.35)',
      borderRadius: '3px', cursor: 'pointer'
    },
    onClick: () => ctx.navigate('kader', { playerId: p.id })
  },
  el('div.tv-zeile', { style: { gap: '8px', alignItems: 'flex-start' } },
    portraitBild(p, 62),
    el('div', { style: { flex: '1', minWidth: '0' } },
      el('div', { style: { fontWeight: '700', fontSize: '14px', lineHeight: '1.1' } }, p.lastName),
      el('div.tv-mini', null, p.firstName),
      el('div', { style: { marginTop: '3px' } }, pill(p.eraLabel || 'Legende', 'legende'))),
    ovrKreis(ovr)),
  el('div.tv-mini', { style: { lineHeight: '1.35' } },
    `${POSITION_NAMES[p.position] || p.position} · ${p.age} Jahre · Rückennummer ${p.number}`),
  el('div', { style: { fontSize: '11px', lineHeight: '1.35' } }, legendenText(p)));
  return karte;
}

function legendenPanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const kader = sicher(() => squadOf(s, club.id), [], 'squadOf');
  const legenden = kader
    .filter(p => p && p.era === 'legend')
    .sort((a, b) => sicher(() => playerOverall(b) - playerOverall(a), 0, 'sortieren'));

  if (!legenden.length) {
    return panel('⭐ Vereinslegenden',
      el('div.tv-leer', null,
        'Keine Legende im Kader. Entweder wurden sie verkauft – oder Sie müssen erst eine erschaffen.'));
  }

  const galerie = el('div', {
    style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '8px' }
  }, ...legenden.map(p => legendenKarte(p, ctx)));

  const schnitt = round(legenden.reduce((sum, p) => sum + sicher(() => playerOverall(p), 0, 'ovr'), 0) / legenden.length, 1);

  return panel(panelTitel('⭐ Vereinslegenden', `${legenden.length} im Kader · Ø Stärke ${schnitt}`),
    el('div.tv-spalte',
      el('div.tv-mini', null,
        'Sie tragen dasselbe Trikot wie die aktuelle Mannschaft – und dieselbe Verantwortung. ' +
        'Ein Verkauf wäre auf den Rängen nicht zu vermitteln.'),
      galerie));
}

/* ------------------------------------------------------------------ *
 *  Die Kabine
 *
 *  Drei Panels für das, was zwischen den Spielen passiert: die Hackordnung
 *  mit ihren Grüppchen und Streitereien, die Mentorenpaare und die
 *  Eingespieltheit. Gerechnet wird hier nichts – club/morale.js und
 *  club/chemie.js liefern fertig, dieser Bildschirm hängt es an die Wand.
 * ------------------------------------------------------------------ */

/** Kurzform „F. Beckenbauer" für Listen und Gitterköpfe. */
function kurz(p) {
  if (!p) return 'Unbekannt';
  return `${(p.firstName || '').charAt(0)}. ${p.lastName || p.shortName || '?'}`.trim();
}

const RANG_ART = {
  kapitaen: 'warn', fuehrungsspieler: 'gut', mitlaeufer: 'info', aussenseiter: 'schlecht'
};

function hackordnungListe(s, rang) {
  if (!rang.length) return el('div.tv-mini', null, 'Zur Hackordnung liegt nichts vor.');
  const box = el('div');
  rang.slice(0, 12).forEach((r, i) => {
    const p = s.players[r.playerId];
    const zeile = el('div.tv-rang', {
      class: r.rang === 'kapitaen' ? 'tv-rang--eigen' : null,
      title: (r.gruende || []).length ? r.gruende.join(', ') : 'Kein besonderes Gewicht in der Kabine.'
    },
    el('span.tv-rang__nr', null, String(i + 1)),
    p ? portraitBild(p, 24) : el('span', null, ''),
    el('div.tv-rang__name', null, kurz(p),
      el('span.tv-rang__grund', null, (r.gruende || []).length ? ' · ' + r.gruende[0] : '')),
    pill(RANG_NAMEN[r.rang] || r.rang, RANG_ART[r.rang] || 'info'),
    el('span.tv-rang__wert', null, String(Math.round(r.einfluss))));
    box.appendChild(zeile);
  });
  if (rang.length > 12) {
    box.appendChild(el('div.tv-mini', { style: { marginTop: '4px' } },
      `… und ${rang.length - 12} weitere, auf die in der Kabine niemand hört.`));
  }
  return box;
}

function cliquenListe(gruppen) {
  if (!gruppen.length) {
    return el('div.tv-mini', null,
      'Keine Grüppchen. Entweder ist die Kabine vorbildlich – oder es kennt sich noch niemand.');
  }
  const box = el('div');
  for (const c of gruppen) {
    box.appendChild(el('div.tv-clique', { class: c.staerke >= 60 ? 'tv-clique--heiss' : null },
      el('div.tv-clique__kopf', null,
        el('span.tv-clique__label', null, c.label),
        el('span.tv-clique__zahlen', null,
          `${c.playerIds.length} Mann · Zusammenhalt ${Math.round(c.staerke)} · Stimmung ${Math.round(c.stimmung)}`)),
      el('div.tv-mini', null, c.mitglieder.join(', ')),
      el('div.tv-clique__text', null, c.text || '')));
  }
  return box;
}

/**
 * Führt einen Lösungsweg aus und legt das Ergebnis im Klartext auf den Tisch.
 * Der Ausgangstext aus morale.js bringt seine eigene Rechnung mit („Unterm
 * Strich: …") – deshalb ein Dialog und kein Kurzhinweis, der nach vier Sekunden
 * verschwindet.
 */
async function streitEntscheiden(ctx, konflikt, weg) {
  const res = sicher(() => konfliktLoesen(ctx.state, konflikt.id, weg.id), null, 'konfliktLoesen');
  if (!res || !res.ok) {
    toast(res && res.text ? res.text : 'Der Co-Trainer hat den Zettel verlegt.', 'warn', { ms: 6000 });
    return;
  }
  await dialog(weg.name,
    el('div', { style: { whiteSpace: 'pre-wrap', lineHeight: '1.55', fontSize: '13px' } }, res.text),
    [{ label: 'Zur Kenntnis genommen', value: true, kind: res.erfolg ? 'primary' : 'danger' }],
    { size: 'sm' });
  ctx.aktualisiere();
  ctx.refresh();
}

/** Eine Zeile im Wege-Dialog: Name, angedeutete Folge, Knopf. */
function wegZeile(w, waehlen) {
  return el('div.tv-streit', {
    style: w.nurAera
      ? { background: 'rgba(217,165,33,.16)', borderLeftColor: 'var(--gold)' }
      : { background: 'rgba(0,0,0,.05)', borderLeftColor: 'var(--linie)' }
  },
  el('div.tv-zeile.tv-zeile--verteilt',
    el('b', null, w.name),
    w.nurAera ? pill('nur bei diesem Streit', 'warn') : null),
  el('div.tv-mini', { style: { margin: '2px 0 5px' } }, w.folge),
  button('So machen wir es', () => waehlen(w), { size: 'klein', kind: w.nurAera ? 'gold' : 'ghost' }));
}

/**
 * Rückfrage vor einer Ära-Entscheidung. Sie ist unwiderruflich und kostet in
 * jedem Fall etwas — also steht der Preis noch einmal groß da, bevor geklickt
 * wird. (Kein confirm(): das lässt sich in den Einstellungen abschalten, und
 * diese Frage soll man nicht versehentlich beantworten.)
 */
async function wegBestaetigen(ctx, k, w) {
  const art = KONFLIKT_ARTEN[k.art] || {};
  const ja = await dialog(w.name,
    el('div.tv-spalte',
      art.frage ? el('div', { style: { fontSize: '13px', fontWeight: '700', lineHeight: '1.45' } }, art.frage) : null,
      el('div', { style: { fontSize: '12.5px', lineHeight: '1.5' } }, w.desc),
      el('div.tv-streit', { style: { background: 'rgba(217,165,33,.16)', borderLeftColor: 'var(--gold)' } },
        el('b', null, 'Was Sie das kostet'),
        el('div', { style: { marginTop: '2px' } }, w.folge))),
    [
      { label: 'Noch einmal überlegen', value: false, kind: 'ghost' },
      { label: 'Dabei bleibt es', value: true, kind: 'gold' }
    ],
    { size: 'sm', escValue: false });
  if (ja) await streitEntscheiden(ctx, k, w);
}

/** Alle Wege zu einem Streit — Ära-Wege zuerst, jeder mit seiner Folge. */
async function wegeDialog(ctx, k) {
  const wege = sicher(() => loesungsWege(ctx.state, k) || [], [], 'loesungsWege');
  if (!wege.length) { toast('Zu diesem Streit gibt es nichts zu entscheiden.', 'warn'); return; }
  const art = KONFLIKT_ARTEN[k.art] || {};

  const gewaehlt = await dialog(k.titel,
    (api) => el('div.tv-spalte',
      el('div', { style: { fontSize: '12.5px', lineHeight: '1.5' } }, k.text || ''),
      art.frage
        ? el('div', { style: { fontSize: '13px', fontWeight: '700', lineHeight: '1.45' } }, art.frage)
        : null,
      ...wege.map(w => wegZeile(w, (gewaehlterWeg) => api.close(gewaehlterWeg)))),
    [{ label: 'Später entscheiden', value: null, kind: 'ghost' }],
    { size: 'md', escValue: null });

  if (gewaehlt) await streitEntscheiden(ctx, k, gewaehlt);
}

function konfliktListe(ctx, konflikte) {
  const s = ctx.state;
  if (!konflikte.length) {
    return el('div.tv-mini', null, 'Kein offener Streit. Genießen Sie es, das hält nie lange.');
  }
  const box = el('div');
  for (const k of konflikte) {
    const wer = (k.playerIds || []).map(id => kurz(s.players[id])).join(' / ');
    const wege = sicher(() => loesungsWege(s, k) || [], [], 'loesungsWege');
    const aeraWege = wege.filter(w => w.nurAera);
    const art = KONFLIKT_ARTEN[k.art] || {};

    const zeile = el('div.tv-streit', null,
      el('b', null, `${k.titel} — Schwere ${k.schwere} von 3`),
      el('div.tv-mini', null, wer),
      el('div', { style: { marginTop: '2px' } }, k.text || ''));

    // Ära-Konflikte stellen eine Frage. Sie steht hier, samt Preis beider
    // Antworten – nicht versteckt hinter einem Knopf. Die Folge nennt seit der
    // Ära-Balance Namen und Stückzahlen und ist dadurch zwei bis vier Sätze
    // lang; sie steht deshalb UNTER dem Knopf und nicht daneben, sonst quetscht
    // sie sich neben einer Schaltfläche in eine 160-px-Spalte.
    if (aeraWege.length) {
      zeile.appendChild(el('div', {
        style: { marginTop: '5px', fontWeight: '700', fontSize: '12px', lineHeight: '1.4' }
      }, art.frage || 'Alte Schule oder neue Schule — Sie müssen sich entscheiden.'));
      for (const w of aeraWege) {
        zeile.appendChild(el('div', { style: { marginTop: '5px' } },
          button(w.name, () => wegBestaetigen(ctx, k, w), { size: 'klein', kind: 'gold' }),
          el('div.tv-mini', { style: { marginTop: '3px', lineHeight: '1.45' } }, w.folge)));
      }
    }

    zeile.appendChild(el('div.tv-zeile', { style: { marginTop: '5px' } },
      button(aeraWege.length ? 'Alle Wege abwägen …' : 'Streit klären …',
        () => wegeDialog(ctx, k), { size: 'klein', kind: aeraWege.length ? 'ghost' : 'primary' }),
      el('div.tv-mini', null, aeraWege.length
        ? 'Die üblichen Wege klären nur den Ton, nicht die Frage.'
        : 'Einzelgespräch, Mannschaftsrat, Aussprache, harte Hand — oder aussitzen.')));

    box.appendChild(zeile);
  }
  return box;
}

function kabinePanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const tg = sicher(() => teamGeist(s, club.id), null, 'teamGeist');
  const rang = sicher(() => hierarchie(s, club.id) || [], [], 'hierarchie');
  const gruppen = sicher(() => cliquen(s, club.id) || [], [], 'cliquen');
  const streit = sicher(() => offeneKonflikte(s, club.id) || [], [], 'offeneKonflikte');
  const kap = rang.find(r => r.rang === 'kapitaen');
  const geist = tg ? tg.wert : 50;

  return panel(panelTitel('🧦 Die Kabine', tg ? `Teamgeist ${Math.round(geist)} von 100` : ''),
    el('div.tv-spalte',
      el('div.tv-grid.tv-grid--4', { style: { gap: '6px' } },
        statBox('Teamgeist', String(Math.round(geist)), {
          kind: geist >= 72 ? 'gut' : geist < 45 ? 'schlecht' : null,
          sub: 'Hierarchie, Streit, Grüppchen'
        }),
        statBox('Ø Moral', String(Math.round(tg ? tg.moralSchnitt : 60)), { sub: 'über den ganzen Kader' }),
        statBox('Kapitän', kap ? kurz(s.players[kap.playerId]) : 'keiner', {
          kind: kap ? null : 'schlecht',
          sub: kap ? `Einfluss ${Math.round(kap.einfluss)}` : 'niemand räumt auf, wenn es eng wird'
        }),
        statBox('Offene Konflikte', String(streit.length), {
          kind: streit.length === 0 ? 'gut' : streit.length > 2 ? 'schlecht' : 'warn',
          sub: gruppen.length ? `${gruppen.length} Grüppchen im Kader` : 'keine Grüppchen'
        })),
      tg ? el('div', { style: { fontSize: '12.5px', lineHeight: '1.5' } }, tg.text) : null,
      el('div.tv-grid.tv-grid--2', { style: { gap: '8px' } },
        subpanel('Hackordnung', hackordnungListe(s, rang)),
        el('div.tv-spalte', { style: { gap: '8px' } },
          subpanel(`Grüppchen (${gruppen.length})`, cliquenListe(gruppen)),
          subpanel(`Offene Konflikte (${streit.length})`, konfliktListe(ctx, streit))))));
}

/* ------------------------------------------------------------------ *
 *  Mentoren
 * ------------------------------------------------------------------ */

function mentorZeile(s, paar) {
  const m = s.players[paar.mentorId];
  const t = s.players[paar.talentId];
  const gewinn = Math.round(paar.gewinn || 0);
  const seite = (p, rolle) => el('div.tv-mentor__seite', null,
    p ? portraitBild(p, 30) : null,
    el('div', { style: { minWidth: '0' } },
      el('div.tv-mentor__rolle', null, rolle),
      el('div.tv-mentor__name', null, kurz(p))));

  return el('div', null,
    el('div.tv-mentor', null,
      seite(m, 'Mentor'),
      el('span.tv-mentor__pfeil', null, '→'),
      seite(t, 'Schützling'),
      el('div.tv-mentor__zahlen', null,
        el('div.tv-num', { style: { fontWeight: '700', fontSize: '13px' } }, String(Math.round(paar.staerke))),
        el('div.tv-mini', null, 'Passung'))),
    el('div.tv-mentor__text', null,
      gewinn > 0
        ? `${paar.talent} hat unter ${paar.mentor} ${gewinn} ${gewinn === 1 ? 'Potenzialpunkt' : 'Potenzialpunkte'} ausgeschöpft.`
        : `${paar.talent} ist unter ${paar.mentor} noch keinen Punkt gewachsen. Das braucht Monate.`),
    el('div.tv-mini', { style: { marginBottom: '6px' } }, paar.text || ''));
}

function mentorenPanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const paare = sicher(() => mentorPaare(s, club.id) || [], [], 'mentorPaare');
  const offen = sicher(() => mentorVorschlaege(s, club.id) || [], [], 'mentorVorschlaege');

  const inhalt = el('div.tv-spalte');
  if (!paare.length) {
    inhalt.appendChild(el('div.tv-leer', null,
      'Kein einziges Mentorenpaar. Die Alten schweigen, die Jungen lernen es allein – langsamer.'));
  } else {
    const liste = el('div');
    for (const p of paare) liste.appendChild(mentorZeile(s, p));
    inhalt.appendChild(liste);
  }

  if (offen.length) {
    const vorschlaege = el('div');
    for (const v of offen.slice(0, 5)) {
      vorschlaege.appendChild(el('div.tv-mentor__vorschlag', null,
        el('div', { style: { minWidth: '0' } },
          el('div', { style: { fontSize: '12px', fontWeight: '700' } }, `${v.mentor} → ${v.talent}`),
          el('div.tv-mini', null, v.text || '')),
        pill(`Passung ${Math.round(v.staerke)}`, v.staerke >= 70 ? 'gut' : v.staerke >= 50 ? 'info' : 'warn')));
    }
    inhalt.appendChild(subpanel(`Der Co-Trainer schlägt vor (${offen.length})`,
      vorschlaege,
      el('div.tv-mini', { style: { marginTop: '4px' } },
        'Zugewiesen wird im Kaderbildschirm, in der Akte des Spielers.'),
      button('Zum Kader', () => ctx.navigate('kader'), { kind: 'ghost', size: 'klein' })));
  }

  return panel(panelTitel('🎓 Mentoren', `${paare.length} ${paare.length === 1 ? 'Paar' : 'Paare'} im Verein`), inhalt);
}

/* ------------------------------------------------------------------ *
 *  Eingespieltheit — der Kern des Spiels
 * ------------------------------------------------------------------ */

/** Die Spieler, an denen sich die Eingespieltheit zeigt: die Elf, sonst die Besten. */
function gitterElf(s, club) {
  const kader = sicher(() => squadOf(s, club.id).filter(Boolean), [], 'squadOf');
  const lineup = club.tactics && club.tactics.lineup ? Object.values(club.tactics.lineup) : [];
  const elf = lineup.map(id => kader.find(p => p && p.id === id)).filter(Boolean);
  if (elf.length >= 7) return elf.slice(0, 11);
  return kader.slice()
    .sort((a, b) => sicher(() => playerOverall(b) - playerOverall(a), 0, 'ovr'))
    .slice(0, 11);
}

function chemieGitter(s, elf) {
  if (elf.length < 2) {
    return el('div.tv-mini', null, 'Für ein Gitter braucht es mindestens zwei Spieler.');
  }
  const kopf = el('tr', null, el('th', null, ''));
  for (const p of elf) {
    kopf.appendChild(el('th', { title: `${p.firstName || ''} ${p.lastName || ''}`.trim() },
      String(p.number !== undefined && p.number !== null ? p.number : '?')));
  }

  const koerper = el('tbody');
  for (const a of elf) {
    const zeile = el('tr', null,
      el('th', { title: `${a.firstName || ''} ${a.lastName || ''}`.trim() },
        `${a.number !== undefined && a.number !== null ? a.number + ' ' : ''}${a.lastName || a.shortName || ''}`));
    for (const b of elf) {
      if (a.id === b.id) { zeile.appendChild(el('td.leer', null, '·')); continue; }
      const w = sicher(() => paarChemie(s, a.id, b.id), 30, 'paarChemie');
      const gemischt = (a.era === 'legend') !== (b.era === 'legend');
      const zelle = el('td', {
        // Farbe als Stil, nicht als Klasse: die .rat-*-Regeln färben Flächen,
        // hier soll auch bei Zebrastreifen nichts dazwischengrätschen.
        class: gemischt ? 'gemischt' : null,
        style: { background: `var(--${ratingClass(w)})` },
        title: `${kurz(a)} & ${kurz(b)}: ${Math.round(w)} von 100` +
          (gemischt ? ' — Legende neben Gegenwart, das kostet eine halbe Saison.' : '')
      }, String(Math.round(w)));
      zeile.appendChild(zelle);
    }
    koerper.appendChild(zeile);
  }

  return el('div.tv-gitterhuelle', null,
    el('table.tv-gitter', null, el('thead', null, kopf), koerper));
}

function paarListe(s, titel, paare, art) {
  const box = el('div', null, el('div.tv-subpanel__titel', null, titel));
  if (!paare.length) {
    box.appendChild(el('div.tv-mini', null, 'Nichts zu vermelden.'));
    return box;
  }
  for (const x of paare) {
    const a = s.players[x.a], b = s.players[x.b];
    box.appendChild(el('div.tv-paar', { class: x.gemischt ? 'tv-paar--gemischt' : null },
      el('span.tv-paar__namen', null, `${kurz(a)} & ${kurz(b)}`),
      bar(x.wert, 100, { showValue: false, color: art === 'schlecht' ? 'var(--rot)' : null }),
      el('span.tv-paar__wert', null, String(Math.round(x.wert)))));
  }
  return box;
}

function eingespieltheitPanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const bericht = sicher(() => chemieBericht(s, club.id), null, 'chemieBericht');
  if (!bericht) {
    return panel('🤝 Eingespieltheit', stoerung('Der Kabinenbericht ließ sich nicht erstellen.'));
  }

  const kader = sicher(() => squadOf(s, club.id).filter(Boolean), [], 'squadOf');
  const legenden = kader.filter(p => p.era === 'legend').length;
  const moderne = kader.length - legenden;

  const mix = el('div.tv-aeramix');
  if (kader.length) {
    if (legenden) {
      mix.appendChild(el('div', {
        style: {
          width: (legenden / kader.length * 100) + '%',
          background: 'linear-gradient(180deg, var(--gold-hell), var(--gold))',
          color: 'var(--holz-900)', textShadow: 'none'
        }
      }, `${legenden} ${legenden === 1 ? 'Legende' : 'Legenden'}`));
    }
    if (moderne) {
      mix.appendChild(el('div', {
        style: { width: (moderne / kader.length * 100) + '%', background: 'linear-gradient(180deg, var(--blau-hell), var(--blau))' }
      }, `${moderne} ${moderne === 1 ? 'Moderner' : 'Moderne'}`));
    }
  } else {
    mix.appendChild(el('div', { style: { width: '100%', background: 'var(--flaeche-dunkel)' } }, 'kein Kader'));
  }

  const text = el('div', { style: { fontSize: '12px', lineHeight: '1.5' } },
    ...bericht.zeilen.map(z => el('div', { style: { marginBottom: '2px' } }, z)));

  const elf = gitterElf(s, club);

  return panel(panelTitel('🤝 Eingespieltheit', `${Math.round(bericht.wert)} von 100`),
    el('div.tv-spalte',
      bar(bericht.wert, 100, {
        label: 'Eingespieltheit des Vereins', valueText: String(Math.round(bericht.wert)), height: 12,
        tooltip: 'Wächst mit gemeinsamen Einsatzminuten, fällt bei Zugängen, Streit und in der Sommerpause.'
      }),
      mix,
      el('div.tv-grid.tv-grid--2', { style: { gap: '8px' } },
        subpanel('Was der Co-Trainer sieht', text),
        subpanel(elf.length ? 'Jede Verbindung der Elf' : 'Verbindungen',
          chemieGitter(s, elf),
          el('div.tv-mini', { style: { marginTop: '4px' } },
            'Goldrand: Legende neben Gegenwart. Diese Paare starten tief und holen schneller auf — ' +
            'ganz einholen werden sie eine Elf aus einem Guss nie. Das ist der Preis des Konzepts.'))),
      el('div.tv-grid.tv-grid--2', { style: { gap: '8px' } },
        paarListe(s, 'Blindes Verständnis', bericht.beste || [], 'gut'),
        paarListe(s, 'Baustellen', bericht.schlechteste || [], 'schlecht'))));
}

/* ------------------------------------------------------------------ *
 *  Vorstand
 * ------------------------------------------------------------------ */

async function vertrauensfrageStellen(ctx) {
  const s = ctx.state;
  const ok = await confirm('Vertrauensfrage stellen',
    'Sie legen dem Aufsichtsrat Ihr Amt zur Verfügung. Bei guter Lage bringt das Rückendeckung – ' +
    'bei schlechter Lage bringt es Ihnen die Kündigung. Wirklich?');
  if (!ok) return;
  const res = sicher(() => vertrauensfrage(s, s.managerClubId), null, 'vertrauensfrage');
  if (!res) { toast('Der Vorstand ist nicht erreichbar.', 'schlecht'); return; }
  await dialog('Die Antwort des Aufsichtsrats',
    el('div', { style: { whiteSpace: 'pre-wrap', lineHeight: '1.55' } }, res.text),
    [{ label: 'Verstanden', value: true, kind: res.entlassen ? 'danger' : 'primary' }]);
  ctx.aktualisiere();
  if (!res.entlassen) ctx.refresh();
}

async function budgetNachverhandeln(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const aktuell = (club.finances || {}).transferBudget || 0;
  let feld = null;

  const wunsch = await dialog('Budget nachverhandeln',
    el('div.tv-spalte',
      el('div', { style: { fontSize: '13px', lineHeight: '1.5' } },
        `Aktuelles Transferbudget: `, el('b', null, formatMoney(aktuell)), '. ',
        'Nennen Sie dem Aufsichtsrat eine Summe, die Sie zusätzlich haben möchten. ',
        'Wer zu hoch pokert, bekommt eine Belehrung statt eines Schecks.'),
      el('label', { style: { fontSize: '12px', fontWeight: '600' } }, 'Zusätzlich gewünscht (in Euro)'),
      el('input', {
        type: 'number', min: '0', step: '100000', value: String(Math.max(500000, Math.round(aktuell * 0.3))),
        style: {
          padding: '7px 9px', width: '100%', fontFamily: 'var(--font-num)', fontSize: '15px',
          border: '1px solid var(--linie)', background: 'var(--papier)'
        },
        ref: (n) => { feld = n; }
      })),
    [
      { label: 'Abbrechen', value: null, kind: 'ghost' },
      { label: 'Antrag stellen', kind: 'primary', onClick: () => (feld ? Number(feld.value) : 0) }
    ], { size: 'sm' });

  if (!wunsch || !(wunsch > 0)) return;
  const res = sicher(() => budgetVerhandeln(s, s.managerClubId, wunsch), null, 'budgetVerhandeln');
  if (!res) { toast('Der Vorstand hat aufgelegt.', 'schlecht'); return; }
  toast(res.text, res.ok ? 'gut' : 'warn', { ms: 7000 });
  ctx.aktualisiere();
  ctx.refresh();
}

function vorstandPanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const b = club.board || {};
  const bew = sicher(() => bewertung(s, club.id), null, 'bewertung');
  const ziel = b.saisonziel || b.erwartung || null;
  const lage = sicher(() => tabellenlage(s, club.id), null, 'tabellenlage');
  const forderungen = (b.forderungen || []).filter(f => f && f.status === 'offen');

  const gruende = bew && Array.isArray(bew.gruende) && bew.gruende.length
    ? el('ul', { style: { margin: '0', paddingLeft: '18px', fontSize: '11.5px', lineHeight: '1.5' } },
      ...bew.gruende.slice(0, 6).map(g => el('li', null, typeof g === 'string' ? g : (g && g.text) || String(g))))
    : el('div.tv-mini', null, 'Der Aufsichtsrat äußert sich nicht im Detail. Das kann alles heißen.');

  const forderungsListe = forderungen.length
    ? el('div.tv-spalte', { style: { gap: '3px' } }, ...forderungen.map(f => {
      const rest = (f.frist || 0) - s.date.day;
      let stand = '';
      try { const r = f.pruefen ? f.pruefen(s) : null; if (r) stand = r.fortschritt || ''; } catch (err) { stand = ''; }
      return el('div', { style: { fontSize: '12px', padding: '3px 0', borderBottom: '1px dotted rgba(0,0,0,.16)' } },
        el('div', null, f.text),
        el('div.tv-mini', null, `Frist: noch ${Math.max(0, rest)} Tage${stand ? ' · ' + stand : ''}`),
        f.belohnung && f.belohnung.text ? el('div.tv-mini', null, `Bei Erfolg: ${f.belohnung.text}`) : null);
    }))
    : el('div.tv-mini', null, 'Zurzeit keine Vorgaben. Genießen Sie es, es hält nicht lange.');

  return panel(panelTitel('🏛️ Vorstand', b.name || club.boardName || 'Aufsichtsrat'),
    el('div.tv-spalte',
      el('div.tv-zeile.tv-zeile--verteilt',
        el('div', null,
          el('b', { style: { fontSize: '14px' } }, b.name || club.boardName || 'Der Vorstand'),
          el('div.tv-mini', null, bew ? `Note ${bew.note} – ${NOTEN_TEXT[bew.note] || ''}` : 'Bewertung liegt nicht vor')),
        b.warnungen ? pill(`${b.warnungen} Verwarnung${b.warnungen === 1 ? '' : 'en'}`, 'schlecht') : pill('keine Verwarnung', 'gut')),
      bar(Math.round(b.zufriedenheit !== undefined ? b.zufriedenheit : 50), 100, { label: 'Zufriedenheit' }),
      bar(Math.round(b.geduld !== undefined ? b.geduld : 50), 100, { label: 'Geduld' }),
      bar(Math.round(b.vertrauen !== undefined ? b.vertrauen : 50), 100, { label: 'Vertrauen' }),
      subpanel('Saisonziel',
        el('div', null,
          el('div', { style: { fontSize: '13px', fontWeight: '700' } }, ziel ? ziel.text : 'noch nicht formuliert'),
          el('div.tv-mini', null,
            ziel && ziel.platz
              ? `Zielplatz ${ziel.platz}, Untergrenze Platz ${ziel.minPlatz || ziel.platz}` +
                (lage ? ` · aktuell ${lage.platz}.` : '')
              : 'Der Aufsichtsrat hält sich bedeckt.'),
          ziel && ziel.pokal ? el('div.tv-mini', null, `Pokal: mindestens ${ziel.pokal}`) : null)),
      subpanel(`Offene Forderungen (${forderungen.length})`, forderungsListe),
      subpanel('Begründung des Aufsichtsrats', gruende),
      el('div.tv-zeile', { style: { flexWrap: 'wrap' } },
        button('Vertrauensfrage stellen', () => vertrauensfrageStellen(ctx), { kind: 'danger', size: 'klein' }),
        button('Budget nachverhandeln', () => budgetNachverhandeln(ctx), { kind: 'gold', size: 'klein' }))));
}

/* ------------------------------------------------------------------ *
 *  Fans
 * ------------------------------------------------------------------ */

function fanReaktion(ctx, aktion, reaktion) {
  const s = ctx.state;
  const res = sicher(() => fanaktionAnwenden(s, s.managerClubId, aktion.id, reaktion.id), null, 'fanaktionAnwenden');
  if (!res) { toast('Die Fanabteilung meldet sich nicht.', 'schlecht'); return; }
  toast(res.text || 'Erledigt.', res.ok ? 'gut' : 'warn', { ms: 7000 });
  ctx.aktualisiere();
  ctx.refresh();
}

function fansPanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const f = club.fans || {};
  const u = sicher(() => fanUebersicht(s, club.id), null, 'fanUebersicht');

  const stimmungWert = u && u.stimmung ? u.stimmung.wert : (f.mood !== undefined ? f.mood : 50);
  const ultraWert = u && u.ultras ? u.ultras.stimmung : (f.ultras !== undefined ? f.ultras : 50);
  const protest = u ? u.protest : (f.protest || 0);
  const aktionen = u && Array.isArray(u.offeneAktionen) ? u.offeneAktionen : [];

  const aktionsListe = aktionen.length
    ? el('div.tv-spalte', ...aktionen.map(a => el('div', {
      style: {
        padding: '7px', border: '1px solid var(--linie)', borderRadius: '2px',
        background: a.art === 'protest' ? 'rgba(193,39,45,.14)' : 'rgba(47,125,50,.14)'
      }
    },
    el('div.tv-zeile.tv-zeile--verteilt',
      el('b', null, a.name || 'Fanaktion'),
      pill(a.art === 'protest' ? 'Protest' : 'Stimmung', a.art === 'protest' ? 'schlecht' : 'gut')),
    el('div', { style: { fontSize: '12px', lineHeight: '1.45', margin: '4px 0' } }, a.text || ''),
    el('div.tv-zeile', { style: { flexWrap: 'wrap' } },
      ...(a.reaktionen || []).map(r =>
        button(r.label, () => fanReaktion(ctx, a, r), { size: 'klein', kind: 'ghost' }))))))
    : el('div.tv-mini', null, 'Auf den Rängen ist es gerade ruhig. Kein Transparent, kein Termin.');

  return panel(panelTitel('🎺 Fans', u && u.stimmung ? u.stimmung.text : ''),
    el('div.tv-spalte',
      bar(Math.round(stimmungWert), 100, { label: 'Stimmung' }),
      bar(Math.round(ultraWert), 100, { label: 'Ultras' }),
      bar(Math.round(protest), 100, { label: 'Protestlevel', color: protest > 45 ? '#c1272d' : null }),
      el('div.tv-grid.tv-grid--2', { style: { gap: '6px' } },
        statBox('Mitglieder', nfmt(Math.round(u ? u.mitglieder : (f.members || 0)))),
        statBox('Ultras', nfmt(u && u.ultras ? u.ultras.anzahl : Math.round(f.ultras || 0)),
          { sub: u && u.ultras ? u.ultras.text : '' }),
        statBox('Dauerkarten', nfmt(Math.round(u ? u.dauerkarten : (f.dauerkarten || 0))),
          { sub: u ? `${u.dauerkartenQuote} % der Kapazität` : '' }),
        statBox('Boykottrisiko',
          u && u.boykott ? `${Math.round((u.boykott.wert || 0) * 100)} %` : '–',
          {
            sub: u && u.boykott ? u.boykott.stufe : '',
            tooltip: u && u.boykott ? u.boykott.text : null,
            kind: u && u.boykott && u.boykott.wert >= 0.45 ? 'schlecht' : (protest > 45 ? 'warn' : null)
          })),
      subpanel(`Aktuelle Fanaktionen (${aktionen.length})`, aktionsListe)));
}

/* ------------------------------------------------------------------ *
 *  Rivalen
 * ------------------------------------------------------------------ */

function bilanzGegen(s, eigenId, gegnerId) {
  const res = { spiele: 0, siege: 0, unentschieden: 0, niederlagen: 0, tore: 0, gegentore: 0 };
  for (const fx of s.fixtures || []) {
    if (!fx || !fx.played || !fx.result || !Array.isArray(fx.result.score)) continue;
    const eigenHeim = fx.homeId === eigenId && fx.awayId === gegnerId;
    const eigenAus = fx.awayId === eigenId && fx.homeId === gegnerId;
    if (!eigenHeim && !eigenAus) continue;
    const [h, a] = fx.result.score;
    const e = eigenHeim ? h : a;
    const g = eigenHeim ? a : h;
    res.spiele++; res.tore += e; res.gegentore += g;
    if (e > g) res.siege++; else if (e < g) res.niederlagen++; else res.unentschieden++;
  }
  return res;
}

function rivalenPanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const rivalen = sicher(() => rivalenVon(s, club.id), [], 'rivalenVon')
    .filter(r => s.clubs[r.clubId])
    .slice(0, 8);

  if (!rivalen.length) {
    return panel('🔥 Rivalen',
      el('div.tv-leer', null, 'Keine gewachsenen Feindschaften. Sportlich schade, gesellschaftlich angenehm.'));
  }

  const rows = rivalen.map(r => {
    const gegner = s.clubs[r.clubId];
    const bil = bilanzGegen(s, club.id, r.clubId);
    return { r, gegner, bil };
  });

  return panel(panelTitel('🔥 Rivalen', `${rivalen.length} Feindschaften`),
    table([
      {
        key: 'wappen', label: '', width: 30, sortable: false,
        render: (row) => wappen(row.gegner, 24)
      },
      { key: 'name', label: 'Verein', render: (row) => row.gegner.shortName },
      {
        key: 'anlass', label: 'Anlass',
        render: (row) => el('span.tv-mini', null, row.r.name || 'Rivalität')
      },
      {
        key: 'faktor', label: 'Brisanz', numeric: true, width: 74,
        sort: (a, b) => a.r.faktor - b.r.faktor,
        render: (row) => pill(row.r.faktor >= 1.4 ? 'Derby' : row.r.faktor >= 1.15 ? 'heiß' : 'Rivale',
          row.r.faktor >= 1.4 ? 'schlecht' : row.r.faktor >= 1.15 ? 'warn' : 'neutral')
      },
      {
        key: 'bilanz', label: 'Bilanz', numeric: true, width: 92, sortable: false,
        render: (row) => row.bil.spiele
          ? `${row.bil.siege}–${row.bil.unentschieden}–${row.bil.niederlagen}`
          : 'noch nie'
      },
      {
        key: 'tore', label: 'Tore', numeric: true, width: 68, sortable: false,
        render: (row) => row.bil.spiele ? `${row.bil.tore}:${row.bil.gegentore}` : '–'
      }
    ], rows, {
      compact: true,
      emptyText: 'Keine Rivalen erfasst.',
      onRowClick: (row) => ctx.navigate('tabelle', { clubId: row.gegner.id })
    }));
}

/* ------------------------------------------------------------------ *
 *  Chronik
 * ------------------------------------------------------------------ */

/** Weiteste im Pokal erreichte Runde einer Saison. */
function pokalRunde(s, clubId, season) {
  let besterIndex = -1;
  for (const fx of s.fixtures || []) {
    if (!fx || fx.competitionId !== 'pokal' || fx.season !== season) continue;
    if (fx.homeId !== clubId && fx.awayId !== clubId) continue;
    const i = CUP.rounds.findIndex(r => r.id === fx.round);
    if (i > besterIndex) besterIndex = i;
  }
  if (besterIndex < 0) return '–';
  return CUP.rounds[besterIndex].name;
}

function chronikPanel(ctx) {
  const s = ctx.state;
  const club = myClub(s);
  const seasons = Array.isArray(s.history && s.history.seasons) ? s.history.seasons : [];

  const rows = seasons.slice().reverse().map(b => {
    const ligaId = club.leagueId || 'bl1';
    const tab = (b.tabellen && b.tabellen[ligaId]) || [];
    const eigen = tab.find(z => z.clubId === club.id) || null;
    return {
      id: 'saison_' + b.season,
      saison: b.season,
      platz: b.eigenerPlatz || (eigen ? eigen.platz : (b.platz || null)),
      punkte: eigen ? eigen.punkte : (b.punkte !== undefined ? b.punkte : null),
      diff: eigen ? eigen.diff : null,
      meister: b.meister && s.clubs[b.meister] ? s.clubs[b.meister].shortName : '–',
      pokal: pokalRunde(s, club.id, b.season)
    };
  });

  if (!rows.length) {
    return panel('📜 Chronik',
      el('div.tv-leer', null,
        `Saison ${s.date.season} läuft. Die Chronik beginnt, wenn sie vorbei ist – und Sie noch da sind.`));
  }

  return panel(panelTitel('📜 Chronik', `${rows.length} abgeschlossene Saison${rows.length === 1 ? '' : 's'}`),
    table([
      { key: 'saison', label: 'Saison', numeric: true, width: 62 },
      {
        key: 'platz', label: 'Platz', numeric: true, width: 58,
        render: (row) => row.platz ? `${row.platz}.` : '–',
        cellClass: (row) => row.platz && row.platz <= 3 ? 'tv-gut' : (row.platz && row.platz >= 16 ? 'tv-schlecht' : null)
      },
      { key: 'punkte', label: 'Punkte', numeric: true, width: 62, render: (row) => row.punkte !== null ? row.punkte : '–' },
      { key: 'diff', label: 'Diff.', numeric: true, width: 56, render: (row) => row.diff !== null ? (row.diff > 0 ? '+' + row.diff : row.diff) : '–' },
      { key: 'pokal', label: 'Pokal' },
      { key: 'meister', label: 'Meister' }
    ], rows, { compact: true, sort: { key: 'saison', desc: true } }));
}

/* ------------------------------------------------------------------ *
 *  Trainerkarriere
 * ------------------------------------------------------------------ */

const SKILL_NAMEN = {
  training: 'Trainingslehre', taktik: 'Taktik', motivation: 'Motivation',
  verhandlung: 'Verhandlung', jugend: 'Nachwuchsarbeit', medien: 'Medienarbeit'
};

function karrierePanel(ctx) {
  const s = ctx.state;
  const m = s.manager || {};
  const bil = m.bilanz || { spiele: 0, siege: 0, unentschieden: 0, niederlagen: 0, tore: 0, gegentore: 0 };
  const quote = bil.spiele ? round((bil.siege / bil.spiele) * 100, 1) : 0;
  const punkteSchnitt = bil.spiele ? round((bil.siege * 3 + bil.unentschieden) / bil.spiele, 2) : 0;

  const skills = m.skills || {};
  const skillBalken = el('div.tv-spalte', { style: { gap: '3px' } },
    ...Object.keys(SKILL_NAMEN).map(k =>
      bar(clamp(Math.round(skills[k] || 0), 0, 100), 100, { label: SKILL_NAMEN[k] })));

  const titel = Array.isArray(m.titel) && m.titel.length
    ? el('div.tv-spalte', { style: { gap: '2px' } }, ...m.titel.map(t =>
      el('div', { style: { fontSize: '12px' } }, '🏆 ',
        typeof t === 'string' ? t : `${t.name || 'Titel'}${t.season ? ` (Saison ${t.season})` : ''}`)))
    : el('div.tv-mini', null, 'Noch kein Titel. Aber der Pokal steht ja nicht fest angeschraubt.');

  const karriere = Array.isArray(m.karriere) && m.karriere.length
    ? el('div.tv-spalte', { style: { gap: '2px' } }, ...m.karriere.slice().reverse().map(k =>
      el('div', { style: { fontSize: '12px', padding: '2px 0', borderBottom: '1px dotted rgba(0,0,0,.16)' } },
        el('b', null, k.club || k.clubId),
        el('span.tv-mini', null,
          ` · Saison ${k.vonSeason}–${k.bisSeason} · Platz ${k.platz || '?'} · ${k.ende || 'beendet'}`))))
    : el('div.tv-mini', null, `Erste Station: ${myClub(s).name}. Hier fängt alles an.`);

  return panel(panelTitel('🎓 Trainerkarriere', m.name || 'Der Trainer'),
    el('div.tv-spalte',
      el('div.tv-grid.tv-grid--3', { style: { gap: '6px' } },
        statBox('Spiele', String(bil.spiele || 0), { sub: `${bil.siege}S ${bil.unentschieden}U ${bil.niederlagen}N` }),
        statBox('Siegquote', `${quote} %`, { sub: `${punkteSchnitt} Punkte/Spiel`, kind: quote >= 50 ? 'gut' : quote < 30 ? 'schlecht' : null }),
        statBox('Ruf', String(Math.round(m.reputation || 0)), { sub: `${m.lizenz || 'ohne Lizenz'} · Stufe ${m.level || 1}` }),
        statBox('Alter', String(m.age || '–'), { sub: 'Jahre auf der Bank' }),
        statBox('Tore', `${bil.tore || 0}:${bil.gegentore || 0}`, { sub: 'geschossen : kassiert' }),
        statBox('Erfahrung', String(Math.round(m.erfahrung || 0)), { sub: 'Punkte' })),
      subpanel('Fähigkeiten', skillBalken),
      el('div.tv-grid.tv-grid--2', { style: { gap: '8px' } },
        subpanel('Titelsammlung', titel),
        subpanel('Stationen', karriere))));
}

/* ------------------------------------------------------------------ *
 *  Screen
 * ------------------------------------------------------------------ */

export const screen = {
  id: 'verein',
  title: 'Verein',
  icon: '🏛️',

  async render(root, ctx) {
    const s = ctx.state;
    if (!s || !s.clubs || !s.managerClubId || !s.clubs[s.managerClubId]) {
      root.appendChild(panel('Vereinsakte',
        stoerung('Kein gültiger Spielstand geladen – der Verein des Managers fehlt im Zustand.')));
      return;
    }

    const seite = el('div.tv-seite');
    seite.appendChild(el('div.tv-seite__kopf',
      el('h1.tv-seite__titel', null, 'Vereinsakte'),
      el('div.tv-seite__unter', null,
        'Alles, was im Aktenschrank liegt: Erfolge, Legenden, Vorstand, Kurve und Ihre eigene Bilanz.')));

    const bauen = (fn, titel) => {
      try { return fn(ctx); }
      catch (err) {
        console.error(`[verein] ${titel} fehlgeschlagen:`, err);
        return panel(titel, stoerung(`Dieser Bereich konnte nicht gezeichnet werden: ${err && err.message ? err.message : err}`));
      }
    };

    seite.appendChild(bauen(kopfPanel, 'Vereinsakte'));
    seite.appendChild(el('div.tv-grid.tv-grid--2',
      bauen(erfolgePanel, 'Erfolge'),
      bauen(chronikPanel, 'Chronik')));
    seite.appendChild(bauen(legendenPanel, 'Vereinslegenden'));
    seite.appendChild(bauen(kabinePanel, 'Die Kabine'));
    seite.appendChild(bauen(eingespieltheitPanel, 'Eingespieltheit'));
    seite.appendChild(bauen(mentorenPanel, 'Mentoren'));
    seite.appendChild(el('div.tv-grid.tv-grid--2',
      bauen(vorstandPanel, 'Vorstand'),
      bauen(fansPanel, 'Fans')));
    seite.appendChild(el('div.tv-grid.tv-grid--2',
      bauen(rivalenPanel, 'Rivalen'),
      bauen(karrierePanel, 'Trainerkarriere')));

    root.appendChild(seite);
  }
};

export default screen;
