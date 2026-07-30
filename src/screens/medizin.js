/**
 * screens/medizin.js — Lazarett, Sperren, Fitness und die medizinische Abteilung.
 *
 * Hier sieht man, wer nicht kann und warum. Behandlungen, Belastungssteuerung
 * und Sperrverwaltung laufen ausschließlich über die Aktionsfunktionen aus
 * club/medical.js — dieser Bildschirm stellt nur dar und fragt nach.
 */

import * as medical from '../club/medical.js';
import * as staff from '../club/staff.js';

import {
  el, frag, panel, subpanel, button, bar, table, statBox, pill, dialog,
  confirm as frage
} from '../render/ui.js';
import { portraitDataURL } from '../render/portraits.js';
import { formatMoney, clamp } from '../core/util.js';
import { POSITION_NAMES, POSITION_GROUP } from '../core/constants.js';

const {
  BEHANDLUNGEN, behandeln, belastung, belastungssteuerung,
  fitTesten, lazarett, medizinBericht, medizinIndex, medizinNote, verletzungsrisiko
} = medical;

const { STAFF_ROLES, stabVon, qualitaetVon } = staff;

/** Verwarnungen bis zur Sperre. Steht so im Regelwerk von club/medical.js. */
const GELB_SCHWELLE = 5;

const SCHWERE_TEXT = {
  0: 'ohne Befund', 1: 'Blessur', 2: 'leicht', 3: 'mittelschwer',
  4: 'schwer', 5: 'sehr schwer', 6: 'Saison gelaufen'
};

const URSACHE_TEXT = {
  spiel: 'im Spiel', training: 'im Training', privat: 'privat', sportgericht: 'vom Sportgericht'
};

/* ==========================================================================
 * Bausteine
 * ======================================================================== */

function sicher(label, fn, ersatz = null) {
  try {
    const v = fn();
    return v === undefined || v === null ? ersatz : v;
  } catch (e) {
    console.error(`[medizin] ${label}:`, e);
    return ersatz;
  }
}

function stoerung(titel, text) {
  const p = panel(titel, el('div.tv-leer', null, text));
  p.classList.add('tv-panel--rot');
  return p;
}

function kopf(titel, extra) {
  if (!extra) return titel;
  return frag(el('span', null, titel),
    el('span', { style: { fontSize: '11px', fontWeight: '400', letterSpacing: '.3px', textTransform: 'none', opacity: '.85' } }, extra));
}

function messwert(label, wert, max, opts = {}) {
  return el('div.tv-attr', {
    style: opts.spalten ? { gridTemplateColumns: opts.spalten } : null,
    title: opts.titel || null
  },
  el('span.tv-attr__name', null, label),
  bar(wert, max, { showValue: false, color: opts.farbe || null }),
  el('span.tv-wert', { class: opts.klasse || null },
    opts.text !== undefined ? opts.text : Math.round(wert)));
}

function posMarke(pos) {
  return el('span.tv-pos', {
    class: 'tv-pos--' + (POSITION_GROUP[pos] || 'MIT'),
    title: POSITION_NAMES[pos] || pos
  }, pos);
}

function eraMarke(p) {
  if (!p || p.era !== 'legend') return null;
  return pill(p.eraLabel || 'Legende', 'legende');
}

function portrait(spieler, groesse, club) {
  const url = sicher('portrait', () => portraitDataURL(spieler, groesse * 2, { club }), '');
  const stil = { width: groesse + 'px', height: groesse + 'px', flex: `0 0 ${groesse}px` };
  if (!url) return el('div.tv-portrait', { style: stil });
  return el('img.tv-portrait', { src: url, alt: '', style: stil });
}

async function ergebnis(titel, res) {
  const ok = !!(res && res.ok);
  await dialog(titel,
    el('p', { style: { margin: '0', lineHeight: '1.55' } },
      (res && res.text) || 'Die medizinische Abteilung schweigt. Das ist selten ein gutes Zeichen.'),
    [{ label: ok ? 'In Ordnung' : 'Verstanden', value: true, kind: ok ? 'primary' : 'ghost' }],
    { size: 'sm' });
  return ok;
}

function kader(state, club) {
  return (club.playerIds || []).map(id => state.players[id]).filter(Boolean);
}

/* ==========================================================================
 * 1. Lazarett
 * ======================================================================== */

/** Chancen und Risiken einer Methode in Klartext — abgeleitet aus BEHANDLUNGEN. */
function behandlungsText(b) {
  const schneller = Math.round((b.tempo - 1) * 100);
  const rueck = b.rueckfall;
  if (b.id === 'konservativ') {
    return 'Regeltempo, normales Rückschlagrisiko, keine Kosten. Der Physio macht das seit dreißig Jahren so — und meistens hat er recht.';
  }
  if (b.id === 'intensiv') {
    return `Rund ${schneller} % schneller zurück, dafür etwa ${rueck.toFixed(1).replace('.', ',')}-faches Rückschlagrisiko. ` +
      'Abgerechnet wird je Rehatag. Wer zweimal zu früh zurückkommt, fehlt am Ende länger.';
  }
  if (b.id === 'operation') {
    return 'Verlängert die Pause spürbar (Eingriff plus Nachlauf), senkt das Rückschlagrisiko danach auf ein Drittel. ' +
      'Nur möglich, wenn die Diagnose es hergibt. Einmal richtig — dafür richtig.';
  }
  if (b.id === 'spezialist') {
    return 'Der Professor aus Innsbruck: kürzt die Prognose spürbar ab und drückt das Rückschlagrisiko auf unter die Hälfte. ' +
      'Die Rechnung geht an die Geschäftsstelle, dort wird geschluckt.';
  }
  return 'SOFORT einsatzfähig — der Spieler beißt die Zähne zusammen. Dafür droht ein Folgeschaden (grob 20 bis 80 %, ' +
    'je nach Restdauer und Schwere), und die nächste Verletzung dauert deutlich länger. Der Doc schaut demonstrativ weg.';
}

function patientenKarte(ctx, club, e) {
  const p = ctx.state.players[e.playerId];
  const krank = e.art === 'krankheit';

  const zeile = el('div.tv-lazarett__zeile', { style: { border: '0', padding: '0' } },
    el('div.tv-zeile', { style: { minWidth: '0' } },
      portrait(p, 44, club),
      el('div', { style: { minWidth: '0' } },
        el('div.tv-zeile', { style: { flexWrap: 'wrap', rowGap: '2px' } },
          el('b', null, e.name), posMarke(e.position), eraMarke(p),
          krank ? pill('Infekt', 'info') : null,
          e.rueckfaelle ? pill(`${e.rueckfaelle} Rückschlag/Rückschläge`, 'schlecht') : null),
        el('div.tv-mini', null,
          `${e.diagnose}${e.koerperteil ? ' (' + e.koerperteil + ')' : ''} · ` +
          `zugezogen ${URSACHE_TEXT[e.ursache] || e.ursache || 'unklar'}`))),
    el('div', null,
      el('div.tv-mini', null, 'Prognose'),
      el('b', null, e.prognose)),
    el('div', null,
      el('div.tv-mini', null, 'Schwere'),
      el('b', { class: e.schwere >= 4 ? 'tv-schlecht' : e.schwere >= 3 ? 'tv-warnung' : '' },
        SCHWERE_TEXT[e.schwere] || String(e.schwere))),
    el('div', null,
      el('div.tv-mini', null, 'Behandlung'),
      el('b', null, e.behandlung || '–')));

  const heilung = e.tageGesamt > 0
    ? messwert('Rehafortschritt', Math.max(0, e.tageGesamt - e.tageRest), e.tageGesamt,
      { spalten: '104px 1fr 92px', text: `${Math.max(0, e.tageGesamt - e.tageRest)} / ${e.tageGesamt} Tage` })
    : null;

  const knoepfe = el('div.tv-zeile', { style: { flexWrap: 'wrap', rowGap: '5px', marginTop: '6px' } },
    ...Object.values(BEHANDLUNGEN).map(b => {
      const risiko = b.id === 'spritze';
      const btn = button(b.name + (risiko ? ' ⚠' : ''), async () => {
        if (risiko) {
          const ok = await frage('Schmerzspritze',
            `${e.name} bekommt eine Spritze und ist sofort einsatzfähig. Der Preis: ein deutlich erhöhtes ` +
            'Risiko eines Folgeschadens, und die nächste Verletzung dauert länger. Wirklich?');
          if (!ok) return;
        }
        const res = sicher('behandeln', () => behandeln(ctx.state, e.playerId, b.id));
        await ergebnis(b.name, res);
        ctx.aktualisiere();
        ctx.refresh();
      }, {
        kind: risiko ? 'danger' : (e.behandlung === b.name ? 'primary' : 'default'),
        size: 'klein',
        tooltip: b.desc
      });
      return btn;
    }));

  return subpanel(null, zeile, heilung,
    el('div.tv-mini', { style: { marginTop: '5px' } }, e.prognoseText || ''),
    knoepfe);
}

/** Die Chancen-und-Risiken-Tafel steht einmal über dem Lazarett, nicht bei jedem Patienten. */
function behandlungsTafel() {
  return subpanel('Behandlungswege — Chancen und Risiken',
    el('div.tv-spalte', { style: { gap: '3px' } },
      ...Object.values(BEHANDLUNGEN).map(b => el('div.tv-mini', {
        style: {
          whiteSpace: 'normal', lineHeight: '1.4',
          color: b.id === 'spritze' ? 'var(--rot)' : null,
          fontWeight: b.id === 'spritze' ? '700' : null
        }
      }, el('b', null, b.name + ': '), behandlungsText(b)))));
}

function panelLazarett(ctx, club, liste) {
  const verletzte = liste.filter(e => e.status === 'verletzt');

  const inhalt = verletzte.length
    ? el('div.tv-spalte', null,
      ...verletzte.map(e => patientenKarte(ctx, club, e)),
      behandlungsTafel())
    : el('div.tv-leer', null,
      'Das Lazarett ist leer. Der Physio darf ausnahmsweise Kaffee trinken — genießen Sie es, es hält nie lange.');

  const p = panel(kopf('Lazarett',
    verletzte.length === 1 ? 'ein Ausfall' : `${verletzte.length} Ausfälle`), inhalt);
  if (verletzte.length) p.classList.add('tv-panel--rot');
  return p;
}

/* ==========================================================================
 * 2. Gesperrte Spieler und Verwarnungen
 * ======================================================================== */

function panelSperren(ctx, club, liste) {
  const gesperrt = liste.filter(e => e.status === 'gesperrt');
  const alle = kader(ctx.state, club);

  const verwarnt = alle
    .map(p => {
      const k = p.cards || {};
      const comp = k.compYellow && typeof k.compYellow === 'object'
        ? Object.values(k.compYellow).reduce((s, v) => Math.max(s, v || 0), 0) : 0;
      const gelb = Math.max(comp, k.seasonYellow || 0);
      return {
        id: p.id, p, name: p.shortName || p.lastName, position: p.position,
        gelb, bisSperre: gelb > 0 ? GELB_SCHWELLE - (gelb % GELB_SCHWELLE) : GELB_SCHWELLE,
        gelbrot: k.gelbrot || 0, rot: k.red || 0
      };
    })
    .filter(z => z.gelb > 0 || z.gelbrot > 0 || z.rot > 0)
    .sort((a, b) => (b.gelb - a.gelb) || (a.bisSperre - b.bisSperre));

  const sperrListe = gesperrt.length
    ? el('div.tv-spalte', { style: { gap: '0' } },
      ...gesperrt.map(e => {
        const p = ctx.state.players[e.playerId];
        const zeile = el('div.tv-talent', null,
          portrait(p, 38, club),
          el('div', { style: { flex: '1 1 auto', minWidth: '0' } },
            el('div.tv-zeile', null, el('b', null, e.name), posMarke(e.position), eraMarke(p)),
            el('div.tv-mini', null, `Grund: ${e.diagnose}`)),
          pill(`noch ${e.spiele || 0} ${e.spiele === 1 ? 'Spiel' : 'Spiele'}`, 'schlecht'));
        if (p && p.era === 'legend') zeile.classList.add('zeile--legende');
        return zeile;
      }))
    : el('div.tv-leer', null, 'Niemand gesperrt. Das Sportgericht hat gerade Besseres zu tun.');

  const verwarnTabelle = table([
    {
      key: 'name', label: 'Spieler', render: (r) => el('div.tv-zeile', null,
        el('b', null, r.name), posMarke(r.position), eraMarke(r.p))
    },
    { key: 'gelb', label: 'Gelb', numeric: true, width: 60 },
    {
      key: 'bisSperre', label: 'Bis zur Sperre', numeric: true, width: 150,
      render: (r) => el('div.tv-zeile', null,
        bar(GELB_SCHWELLE - r.bisSperre, GELB_SCHWELLE, { showValue: false }),
        el('span.tv-wert', null, r.bisSperre))
    },
    { key: 'gelbrot', label: 'Gelb-Rot', numeric: true, width: 80 },
    { key: 'rot', label: 'Rot', numeric: true, width: 60 },
    {
      key: 'warn', label: 'Hinweis', sortable: false,
      render: (r) => r.bisSperre === 1
        ? pill('nächste Gelbe = Sperre', 'schlecht')
        : r.bisSperre === 2 ? pill('wird eng', 'warn') : el('span.tv-mini', null, '–')
    }
  ], verwarnt, {
    compact: true,
    emptyText: 'Keine einzige Verwarnung. Entweder spielen wir sehr fair oder sehr zaghaft.',
    rowClass: (r) => r.p && r.p.era === 'legend' ? 'zeile--legende' : (r.bisSperre === 1 ? 'zeile--gesperrt' : null),
    sort: { key: 'gelb', desc: true }
  });

  return panel(kopf('Sperren und Verwarnungen', `${GELB_SCHWELLE} Gelbe = ein Spiel Sperre`),
    subpanel('Aktuell gesperrt', sperrListe),
    el('div', { style: { marginTop: '9px' } },
      subpanel('Verwarnungsstand', verwarnTabelle)));
}

/* ==========================================================================
 * 3. Fitness und Belastung
 * ======================================================================== */

function panelFitness(ctx, club) {
  const alle = kader(ctx.state, club);
  const steuerung = sicher('belastungssteuerung', () => belastungssteuerung(ctx.state, club.id), { warnungen: [], text: '' });
  const warnById = new Map((steuerung.warnungen || []).map(w => [w.playerId, w]));

  const zeilen = alle.map(p => {
    const bel = sicher('belastung', () => belastung(ctx.state, p.id), { spiele: 0, minuten: 0, fenster: 28 });
    const risiko = sicher('verletzungsrisiko', () => verletzungsrisiko(ctx.state, p.id, { art: 'spiel' }), 0);
    const w = warnById.get(p.id) || null;
    return {
      id: p.id, p,
      name: p.shortName || p.lastName,
      position: p.position,
      alter: p.age || 0,
      fitness: Math.round(p.fitness !== undefined ? p.fitness : 100),
      frische: Math.round(p.sharpness !== undefined ? p.sharpness : 60),
      spiele: bel.spiele || 0,
      minuten: bel.minuten || 0,
      risiko: risiko * 100,
      stufe: w ? w.stufe : 0,
      warnung: w ? w.text : null,
      raus: !!p.injury || !!(p.cards && p.cards.ban)
    };
  });

  const tabelle = table([
    {
      key: 'name', label: 'Spieler', render: (r) => el('div.tv-zeile', { style: { minWidth: '0' } },
        portrait(r.p, 26, club),
        el('b', null, r.name), posMarke(r.position), eraMarke(r.p),
        r.p.injury ? pill('verletzt', 'schlecht') : null,
        r.p.cards && r.p.cards.ban ? pill('gesperrt', 'warn') : null)
    },
    { key: 'alter', label: 'Alter', numeric: true, width: 58 },
    {
      key: 'fitness', label: 'Fitness', numeric: true, width: 130,
      render: (r) => el('div.tv-zeile', null,
        bar(r.fitness, 100, { showValue: false }), el('span.tv-wert', null, r.fitness))
    },
    {
      key: 'frische', label: 'Frische', numeric: true, width: 130,
      render: (r) => el('div.tv-zeile', null,
        bar(r.frische, 100, { showValue: false }), el('span.tv-wert', null, r.frische))
    },
    {
      key: 'spiele', label: 'Spiele/28 T.', numeric: true, width: 130,
      render: (r) => el('div.tv-zeile', null,
        bar(r.spiele, 9, { showValue: false, color: r.spiele >= 6 ? 'var(--rot)' : null }),
        el('span.tv-wert', null, r.spiele))
    },
    { key: 'minuten', label: 'Minuten', numeric: true, width: 84 },
    {
      key: 'risiko', label: 'Risiko', numeric: true, width: 78,
      render: (r) => el('span.tv-wert', {
        class: r.risiko > 3 ? 'tv-schlecht' : r.risiko > 1.6 ? 'tv-warnung' : ''
      }, r.risiko.toFixed(1).replace('.', ',') + ' %')
    },
    {
      key: 'stufe', label: 'Belastung', numeric: true, width: 130,
      render: (r) => r.stufe === 2 ? pill('dringend schonen', 'schlecht')
        : r.stufe === 1 ? pill('Pause wäre gut', 'warn')
          : el('span.tv-mini', null, 'unauffällig')
    }
  ], zeilen, {
    compact: true,
    maxHeight: 460,
    emptyText: 'Kein Kader vorhanden.',
    sort: { key: 'stufe', desc: true },
    rowClass: (r) => r.p.era === 'legend' ? 'zeile--legende'
      : r.p.injury ? 'zeile--verletzt'
        : (r.p.cards && r.p.cards.ban ? 'zeile--gesperrt' : null),
    onRowClick: async (r) => {
      const test = sicher('fitTesten', () => fitTesten(ctx.state, r.id));
      if (!test) return;
      await dialog(`Fitnesstest: ${r.name}`,
        el('div.tv-spalte', null,
          el('p', { style: { margin: '0', lineHeight: '1.55' } }, test.text || ''),
          el('div.tv-zeile', null,
            test.einsatzfaehig
              ? pill(test.stufe === 3 ? 'grünes Licht' : test.stufe === 2 ? 'mit Vorsicht' : 'abgeraten',
                test.stufe === 3 ? 'gut' : test.stufe === 2 ? 'warn' : 'schlecht')
              : pill('nicht einsatzfähig', 'schlecht'),
            el('span.tv-mini', null, test.empfehlung || ''))),
        [{ label: 'Danke, Doc', value: true, kind: 'primary' }], { size: 'md' });
    }
  });

  const warnliste = (steuerung.warnungen || []).filter(w => w.stufe === 2);
  const schnitt = zeilen.length
    ? Math.round(zeilen.reduce((s, z) => s + z.fitness, 0) / zeilen.length) : 0;

  return panel(kopf('Fitness und Belastung', `${zeilen.length} Spieler · Ø Fitness ${schnitt} %`),
    warnliste.length
      ? subpanel('Warnungen der Belastungssteuerung',
        el('div.tv-spalte', { style: { gap: '3px' } },
          ...warnliste.map(w => el('div.tv-mini', {
            style: { whiteSpace: 'normal', lineHeight: '1.45', color: 'var(--rot)', fontWeight: '600' }
          }, '⚠ ' + w.text))))
      : subpanel('Belastungssteuerung',
        el('div.tv-mini', null, steuerung.text || 'Alles im grünen Bereich.')),
    el('div', { style: { marginTop: '9px' } }, tabelle),
    el('div.tv-mini', { style: { marginTop: '5px' } },
      'Zeile anklicken für den Fitnesstest des Mannschaftsarztes.'));
}

/* ==========================================================================
 * 4. Verletzungsanfällige Spieler
 * ======================================================================== */

function panelAnfaellig(ctx, club) {
  const alle = kader(ctx.state, club);

  const zeilen = alle.map(p => {
    const m = p.medizin || null;
    const hist = (m && m.historie) || [];
    const letzte = hist.length ? hist[hist.length - 1] : null;
    const risiko = sicher('verletzungsrisiko', () => verletzungsrisiko(ctx.state, p.id, { art: 'spiel' }), 0);
    return {
      id: p.id, p,
      name: p.shortName || p.lastName,
      position: p.position,
      alter: p.age || 0,
      anzahl: hist.length,
      ausfalltage: (m && m.ausfalltage && m.ausfalltage.gesamt) || 0,
      anfaelligkeit: Math.round(((m && m.anfaelligkeit) || 0) * 100),
      schaeden: (m && m.langzeitschaeden) ? m.langzeitschaeden.length : 0,
      gespritzt: !!(m && m.gespritzt),
      letzte: letzte ? letzte.name : null,
      risiko: risiko * 100,
      glasknochen: (p.traits || []).includes('glasknochen')
    };
  }).filter(z => z.anzahl > 0 || z.anfaelligkeit > 0 || z.schaeden > 0 || z.glasknochen || z.gespritzt)
    .sort((a, b) => (b.anfaelligkeit - a.anfaelligkeit) || (b.anzahl - a.anzahl));

  if (!zeilen.length) {
    return panel('Verletzungsanfällige Spieler',
      el('div.tv-leer', null,
        'Noch keine Akte im Schrank. Entweder ist die Saison jung — oder wir haben eine erstaunlich robuste Mannschaft.'));
  }

  const tabelle = table([
    {
      key: 'name', label: 'Spieler', render: (r) => el('div.tv-zeile', null,
        portrait(r.p, 26, club), el('b', null, r.name), posMarke(r.position), eraMarke(r.p),
        r.glasknochen ? pill('Glasknochen', 'schlecht') : null,
        r.gespritzt ? pill('unter Schmerzmitteln', 'warn') : null)
    },
    { key: 'alter', label: 'Alter', numeric: true, width: 58 },
    { key: 'anzahl', label: 'Verletzungen', numeric: true, width: 100 },
    { key: 'ausfalltage', label: 'Ausfalltage', numeric: true, width: 96 },
    { key: 'schaeden', label: 'Dauerschäden', numeric: true, width: 106 },
    {
      key: 'anfaelligkeit', label: 'Anfälligkeit', numeric: true, width: 140,
      render: (r) => el('div.tv-zeile', null,
        bar(r.anfaelligkeit, 70, { showValue: false, color: r.anfaelligkeit > 25 ? 'var(--rot)' : null }),
        el('span.tv-wert', null, r.anfaelligkeit + '%'))
    },
    {
      key: 'risiko', label: 'Risiko/Spiel', numeric: true, width: 96,
      render: (r) => el('span.tv-wert', {
        class: r.risiko > 3 ? 'tv-schlecht' : r.risiko > 1.6 ? 'tv-warnung' : ''
      }, r.risiko.toFixed(1).replace('.', ',') + ' %')
    },
    { key: 'letzte', label: 'Zuletzt', sortable: false, render: (r) => el('span.tv-mini', null, r.letzte || '–') }
  ], zeilen, {
    compact: true,
    sort: { key: 'anfaelligkeit', desc: true },
    rowClass: (r) => r.p.era === 'legend' ? 'zeile--legende' : (r.anfaelligkeit > 25 ? 'zeile--verletzt' : null)
  });

  const einschaetzung = zeilen.slice(0, 3).map(r => {
    if (r.anfaelligkeit >= 35) return `${r.name} ist ein Dauerpatient. Wer auf ihn plant, plant zweigleisig.`;
    if (r.anfaelligkeit >= 18) return `${r.name} bricht regelmäßig weg. Rotation ist bei ihm kein Luxus, sondern Buchhaltung.`;
    if (r.glasknochen) return `${r.name} kennt den Betriebsarzt beim Vornamen. Das wird sich auch nicht mehr ändern.`;
    return `${r.name}: bisher unauffällig, aber die Akte wächst.`;
  });

  return panel(kopf('Verletzungsanfällige Spieler',
    zeilen.length === 1 ? 'eine Akte' : `${zeilen.length} Akten`),
  tabelle,
  el('div.tv-spalte', { style: { gap: '2px', marginTop: '7px' } },
    ...einschaetzung.map(t => el('div.tv-mini', { style: { whiteSpace: 'normal', lineHeight: '1.45' } }, '• ' + t))));
}

/* ==========================================================================
 * 5. Medizinische Abteilung
 * ======================================================================== */

function wirkungsText(index) {
  if (index >= 88) return 'Ausfallzeiten liegen deutlich unter dem Ligaschnitt, Rückschläge sind eine Ausnahme, ' +
    'und die Prognosen des Arztes stimmen fast immer. Verletzungen passieren trotzdem — nur seltener und kürzer.';
  if (index >= 78) return 'Kurze Ausfallzeiten, wenig Rückschläge, verlässliche Prognosen. Die Konkurrenz beneidet uns darum.';
  if (index >= 66) return 'Solide Bundesliga-Norm: durchschnittliche Heilungsdauer, normales Rückschlagrisiko. Nichts, was schadet — nichts, was hilft.';
  if (index >= 54) return 'Ausbaufähig. Unsere Spieler fehlen spürbar länger als anderswo, und jeder zweite Rückschlag wäre vermeidbar gewesen.';
  if (index >= 42) return 'Die Abteilung verlängert Ausfälle und begünstigt Rückfälle. Jeder investierte Euro kommt hier doppelt zurück.';
  return 'Ein Eimer mit Eiswasser und ein Mann mit gutem Willen. Verletzungen dauern hier deutlich länger als nötig, ' +
    'schwere Fälle werden regelmäßig zu schweren Fällen gemacht.';
}

function panelAbteilung(ctx, club) {
  const index = sicher('medizinIndex', () => medizinIndex(ctx.state, club.id), 50);
  const note = sicher('medizinNote', () => medizinNote(index), '–');
  const bericht = sicher('medizinBericht', () => medizinBericht(ctx.state, club.id));
  const anlage = clamp((club.facilities && club.facilities.medical) || 50, 1, 100);

  const stab = sicher('stabVon', () => stabVon(ctx.state, club.id), []) || [];
  const medizinRollen = ['mannschaftsarzt', 'physiotherapeut', 'athletiktrainer'];
  const personal = stab.filter(s => medizinRollen.includes(s.roleId));

  const kacheln = el('div.tv-grid.tv-grid--4', null,
    statBox('Abteilung', String(index), { sub: note, kind: index >= 70 ? 'gut' : index < 50 ? 'schlecht' : 'warn' }),
    statBox('Ausfalltage', String(bericht ? bericht.ausfalltageSaison : '–'), { sub: 'diese Saison' }),
    statBox('Verletzungen', String(bericht ? bericht.verletzungenSaison : '–'), { sub: 'diese Saison' }),
    statBox('Behandlungskosten', bericht ? formatMoney(bericht.kostenSaison) : '–', { sub: 'diese Saison', kind: 'warn' }));

  const balken = el('div', { style: { marginTop: '9px' } },
    messwert('Gesamtgüte', index, 100, { spalten: '120px 1fr 40px' }),
    messwert('Ausstattung', anlage, 100, { spalten: '120px 1fr 40px', titel: '55 % der Gesamtgüte hängen an der Ausstattung' }),
    messwert('Personal', personal.length ? Math.round(personal.reduce((s, x) => s + qualitaetVon(x), 0) / personal.length) : 0, 100,
      { spalten: '120px 1fr 40px', titel: '45 % der Gesamtgüte hängen an Arzt, Physio und Athletik' }),
    bericht ? messwert('Schnitt-Fitness', bericht.schnittFitness, 100, { spalten: '120px 1fr 40px' }) : null);

  const leute = personal.length
    ? el('div.tv-spalte', { style: { gap: '5px' } },
      ...personal.map(s => el('div.tv-stab__karte', null,
        el('div', { style: { flex: '1 1 auto', minWidth: '0' } },
          el('div.tv-zeile.tv-zeile--verteilt', null,
            el('b', null, s.name),
            el('span.tv-mini', null, (STAFF_ROLES[s.roleId] || {}).name || s.roleId)),
          messwert('Qualität', qualitaetVon(s), 100, { spalten: '70px 1fr 32px' }),
          el('div.tv-mini', null,
            `${s.alter} Jahre · ${s.spezialisierung || '–'} · ${formatMoney(s.gehalt || 0)} im Jahr` +
            (s.kurs ? ` · im Lehrgang „${s.kurs.name}“` : ''))))))
    : el('div.tv-leer', null,
      'Weder Arzt noch Physio im Verein. Bei der nächsten Zerrung tapt der Zeugwart — und das sieht man in der Tabelle.');

  const empfehlungen = bericht && bericht.empfehlungen && bericht.empfehlungen.length
    ? el('div.tv-spalte', { style: { gap: '2px' } },
      ...bericht.empfehlungen.map(t => el('div.tv-mini', { style: { whiteSpace: 'normal', lineHeight: '1.45' } }, '• ' + t)))
    : null;

  // Ein Ausbau der Anlagen ist in club/medical.js (noch) nicht als Aktion vorgesehen.
  // Statt eine Zahl zu erfinden, zeigen wir den Hebel, den es wirklich gibt: das Personal.
  const ausbauFn = typeof medical.medizinAusbauen === 'function' ? medical.medizinAusbauen : null;
  const invest = subpanel('Investition',
    el('div.tv-mini', { style: { whiteSpace: 'normal', lineHeight: '1.45', marginBottom: '6px' } },
      ausbauFn
        ? 'Ein Ausbau der Behandlungsräume ist möglich. Er wirkt auf Heilungsdauer, Rückschlagrisiko und Prognosegüte.'
        : 'Ein baulicher Ausbau der Behandlungsräume ist derzeit nicht vorgesehen — die Geschäftsstelle hat den Antrag ' +
          'noch nicht bearbeitet. Der schnellere Hebel sind ohnehin die Leute: 45 Prozent der Güte hängen an Arzt, ' +
          'Physio und Athletiktrainer.'),
    el('div.tv-zeile', null,
      ausbauFn
        ? button('Abteilung ausbauen', async () => {
          const res = sicher('medizinAusbauen', () => ausbauFn(ctx.state, club.id));
          await ergebnis('Ausbau', res);
          ctx.aktualisiere();
          ctx.refresh();
        }, { kind: 'primary', size: 'klein' })
        : null,
      button('Zum Trainerstab', () => ctx.navigate('stab'), { kind: 'primary', size: 'klein' }),
      button('Zu den Finanzen', () => ctx.navigate('finanzen'), { kind: 'ghost', size: 'klein' })));

  return panel(kopf('Medizinische Abteilung', note),
    kacheln,
    balken,
    el('div.tv-mini', { style: { marginTop: '7px', whiteSpace: 'normal', lineHeight: '1.5' } }, wirkungsText(index)),
    el('div.tv-grid.tv-grid--2', { style: { marginTop: '9px' } },
      subpanel('Ärzte und Physios', leute),
      subpanel('Aus dem Wochenbericht', empfehlungen || el('div.tv-mini', null, 'Kein Bericht vorhanden.'))),
    el('div', { style: { marginTop: '9px' } }, invest));
}

/* ==========================================================================
 * Bildschirm
 * ======================================================================== */

export const screen = {
  id: 'medizin',
  title: 'Medizin',
  icon: '🩺',

  async render(root, ctx) {
    const state = ctx.state;
    const club = state.clubs[state.managerClubId];

    if (!club) {
      root.appendChild(stoerung('Medizin', 'Kein Verein im Spielstand gefunden. Ohne Verein kein Lazarett.'));
      return;
    }

    const liste = sicher('lazarett', () => lazarett(state, club.id), []) || [];

    const seite = el('div.tv-seite', null,
      el('div.tv-seite__kopf', null,
        el('h1.tv-seite__titel', null, 'Medizinische Abteilung'),
        el('div.tv-seite__unter', null,
          'Der Arzt entscheidet, wer spielt. Sie entscheiden nur, wie sehr Sie ihm zuhören.')));

    seite.appendChild(el('div.tv-grid.tv-grid--haupt', null,
      panelLazarett(ctx, club, liste),
      panelSperren(ctx, club, liste)));

    seite.appendChild(panelFitness(ctx, club));

    seite.appendChild(el('div.tv-grid.tv-grid--seiten', null,
      panelAnfaellig(ctx, club),
      panelAbteilung(ctx, club)));

    root.appendChild(seite);
  }
};

export default screen;
