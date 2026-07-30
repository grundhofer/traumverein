/**
 * screens/presse.js — Schlagzeilen, Pressekonferenz, Medienspiegel, Gerüchte.
 *
 * Sechs Blätter, ein Mediendruck und Journalisten, die schon wissen, welche
 * Überschrift sie schreiben wollen, bevor Sie den Mund aufmachen.
 *
 * Alles, was den Zustand verändert (Antworten, Interviews, Gerüchte), läuft
 * ausschließlich über die Aktionsfunktionen aus club/media.js.
 */

import {
  el, frag, panel, subpanel, button, bar, statBox, pill, dialog,
  confirm as frage, toast
} from '../render/ui.js';
import { portraitDataURL } from '../render/portraits.js';
import { formatMoney, clamp } from '../core/util.js';
import { POSITION_NAMES, POSITION_GROUP } from '../core/constants.js';
import {
  BLAETTER, BLAETTER_BY_ID, INTERVIEW_THEMEN, GERUECHT_THEMEN,
  schlagzeilen, medienDruck, pressekonferenz, antwortGeben,
  interviewSpieler, geruechtStreuen
} from '../club/media.js';

/* ==========================================================================
 * Bausteine
 * ======================================================================== */

function sicher(label, fn, ersatz = null) {
  try {
    const v = fn();
    return v === undefined || v === null ? ersatz : v;
  } catch (e) {
    console.error(`[presse] ${label}:`, e);
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

/** Angedeutete Wirkung: keine nackten Zahlen, sondern Pfeile wie im Notenspiegel. */
function pfeile(v) {
  const n = Math.min(3, Math.ceil(Math.abs(v || 0) / 3));
  if (!v || !n) return '·';
  return (v > 0 ? '▲' : '▼').repeat(n);
}

function wirkungsMarke(label, wert) {
  const marke = el('span.tv-pill', {
    class: !wert ? 'tv-pill--info' : wert > 0 ? 'tv-pill--gut' : 'tv-pill--schlecht',
    title: `${label}: ${wert > 0 ? 'steigt' : wert < 0 ? 'fällt' : 'unverändert'}`
  }, `${label} ${pfeile(wert)}`);
  return marke;
}

function risikoMarke(risiko) {
  const r = risiko || 0;
  if (r < 0.13) return pill('Risiko gering', 'gut');
  if (r < 0.26) return pill('Risiko spürbar', 'warn');
  if (r < 0.4) return pill('Risiko hoch', 'schlecht');
  return pill('Vabanque', 'schlecht');
}

async function ergebnis(titel, res) {
  const ok = !!(res && res.ok);
  await dialog(titel,
    el('p', { style: { margin: '0', lineHeight: '1.55' } },
      (res && res.text) || 'Aus dem Medienraum kam keine Rückmeldung.'),
    [{ label: ok ? 'Weiter' : 'Verstanden', value: true, kind: ok ? 'primary' : 'ghost' }],
    { size: 'sm' });
  return ok;
}

function kader(state, club) {
  return (club.playerIds || []).map(id => state.players[id]).filter(Boolean);
}

/* ==========================================================================
 * 1. Schlagzeilen
 * ======================================================================== */

function zeitung(z) {
  const blatt = BLAETTER_BY_ID[z.blattId] || {};
  const bogen = el('div.tv-zeitung', null,
    el('div.tv-zeitung__kopf', null, z.blatt),
    el('div.tv-zeitung__meta', { style: { textAlign: 'center' } },
      `${z.tonfall || blatt.tonfall || 'sachlich'} · Schärfe ${z.schaerfe !== undefined ? z.schaerfe : blatt.schaerfe || '?'} von 100` +
      (blatt.reichweite ? ` · Reichweite ${blatt.reichweite}` : '')),
    el('div.tv-zeitung__schlagzeile', null, z.titel),
    el('div.tv-zeitung__text', null, z.text));
  if ((z.schaerfe !== undefined ? z.schaerfe : blatt.schaerfe || 0) >= 70) {
    bogen.style.boxShadow = 'inset 0 0 0 2px var(--rot), var(--schatten)';
  }
  return bogen;
}

function panelSchlagzeilen(ctx, club) {
  const zeilen = sicher('schlagzeilen', () => schlagzeilen(ctx.state, null, 4), []) || [];
  const archiv = ((ctx.state.presse && ctx.state.presse.archiv) || []).slice(0, 8);

  const inhalt = zeilen.length
    ? el('div.tv-grid.tv-grid--2', null, ...zeilen.map(z => zeitung(z)))
    : el('div.tv-zeitung', null,
      el('div.tv-zeitung__kopf', null, 'Am Kiosk'),
      el('div.tv-zeitung__meta', { style: { textAlign: 'center' } },
        `Mitteilung der Presseabteilung · ${club.name}`),
      el('div.tv-zeitung__schlagzeile', null, 'Über uns schreibt heute niemand'),
      el('div.tv-zeitung__text', null,
        'Kein Blatt hat einen Anlass gefunden — kein Ergebnis, kein Skandal, keine Serie. Das ist die ' +
        'angenehmste und zugleich beunruhigendste Form der Berichterstattung: gar keine. Spätestens nach ' +
        'dem ersten Pflichtspiel füllen sich die Seiten wieder von selbst, und dann sucht sich die BILDSCHIRM ' +
        'ihre Überschrift ohnehin allein.'));

  return panel(kopf('Schlagzeilen', `${BLAETTER.length} Blätter am Kiosk`),
    inhalt,
    archiv.length
      ? el('div', { style: { marginTop: '9px' } },
        subpanel('Was zuletzt am Kiosk stand',
          el('div.tv-spalte', { style: { gap: '2px' } },
            ...archiv.map(a => el('div.tv-mini', { style: { whiteSpace: 'normal' } },
              el('b', null, `${a.blatt}: `), a.titel)))))
      : null);
}

/* ==========================================================================
 * 2. Pressekonferenz
 * ======================================================================== */

function antwortKnopf(ctx, frageObj, antwort, i) {
  const w = antwort.wirkung || {};
  const btn = el('button.tv-interview__antwort', {
    type: 'button',
    onClick: async () => {
      const res = sicher('antwortGeben', () => antwortGeben(ctx.state, frageObj.id, i));
      if (res && res.ok) {
        await dialog(res.risikoEingetreten ? 'Das ging schief' : 'Am nächsten Morgen',
          el('div.tv-spalte', null,
            el('p', { style: { margin: '0', lineHeight: '1.55' } }, res.text),
            el('div.tv-zeile', { style: { flexWrap: 'wrap', rowGap: '4px' } },
              wirkungsMarke('Mannschaft', (res.wirkung || {}).moral),
              wirkungsMarke('Fans', (res.wirkung || {}).fans),
              wirkungsMarke('Vorstand', (res.wirkung || {}).vorstand),
              wirkungsMarke('Medien', (res.wirkung || {}).medien),
              res.spieler ? wirkungsMarke(res.spieler, (res.wirkung || {}).spieler) : null)),
          [{ label: 'Nächste Frage', value: true, kind: 'primary' }], { size: 'md' });
      } else {
        await ergebnis('Pressekonferenz', res);
      }
      ctx.aktualisiere();
      ctx.refresh();
    }
  },
  el('div', { style: { fontWeight: '600', lineHeight: '1.4' } }, antwort.text),
  el('div.tv-zeile', { style: { marginTop: '5px', flexWrap: 'wrap', rowGap: '3px' } },
    wirkungsMarke('Mannschaft', w.moral),
    wirkungsMarke('Fans', w.fans),
    wirkungsMarke('Vorstand', w.vorstand),
    wirkungsMarke('Medien', w.medien),
    w.spieler ? wirkungsMarke('Betroffener', w.spieler) : null,
    risikoMarke(antwort.risiko),
    w.ankuendigung ? pill('große Ankündigung', 'gold') : null));
  return btn;
}

function panelKonferenz(ctx) {
  const p = ctx.state.presse || null;
  const offene = (p && Array.isArray(p.offeneFragen)) ? p.offeneFragen : [];
  const unbeantwortet = offene.filter(f => !f.beantwortet);
  const beantwortet = offene.length - unbeantwortet.length;

  const eroeffnen = button('Pressekonferenz eröffnen', async () => {
    const pk = sicher('pressekonferenz', () => pressekonferenz(ctx.state, null), { fragen: [] });
    if (!pk || !pk.fragen || !pk.fragen.length) {
      toast('Heute hat niemand Fragen. Das kommt vor — meistens dann, wenn alles läuft.', 'info');
      return;
    }
    toast(`${pk.fragen.length} Fragen liegen auf dem Tisch. Setzen Sie sich hin.`, 'info');
    ctx.aktualisiere();
    ctx.refresh();
  }, { kind: 'primary' });

  if (!unbeantwortet.length) {
    const rueckblick = ((p && p.beantwortet) || []).slice(0, 6);
    return panel(kopf('Pressekonferenz', offene.length ? 'alle Fragen beantwortet' : 'kein Termin angesetzt'),
      el('div.tv-spalte', null,
        el('div.tv-mini', { style: { whiteSpace: 'normal', lineHeight: '1.45' } },
          offene.length
            ? 'Der Medienraum ist leer, die Kameras sind aus. Sie haben alle Fragen beantwortet — was daraus wird, ' +
              'lesen Sie morgen früh.'
            : 'Aktuell ist keine Pressekonferenz angesetzt. Vor Pflichtspielen lädt die Presseabteilung von selbst ein; ' +
              'wer will, kann sich auch freiwillig vor die Mikrofone setzen.'),
        el('div.tv-zeile', null, eroeffnen),
        rueckblick.length
          ? subpanel('Was Sie zuletzt gesagt haben',
            el('div.tv-spalte', { style: { gap: '5px' } },
              ...rueckblick.map(b => el('div', null,
                el('div.tv-mini', null, `${b.blatt} · Tag ${b.tag}`),
                el('div', { style: { fontSize: '12px', lineHeight: '1.4' } }, '„' + b.antwort + '“'),
                b.eingetreten ? pill('wurde verdreht', 'schlecht') : pill('kam an', 'gut')))))
          : null));
  }

  const f = unbeantwortet[0];
  const blatt = BLAETTER_BY_ID[f.blattId] || {};

  return panel(kopf('Pressekonferenz', `Frage ${beantwortet + 1} von ${offene.length}`),
    el('div', null,
      el('div.tv-zeile.tv-zeile--verteilt', { style: { marginBottom: '6px' } },
        el('div.tv-zeile', null,
          pill(f.blatt, 'info'),
          el('span.tv-mini', null, `Tonfall: ${f.tonfall || blatt.tonfall || 'sachlich'}`),
          blatt.schaerfe !== undefined ? el('span.tv-mini', null, `Schärfe ${blatt.schaerfe}`) : null),
        el('span.tv-mini', null, `Kategorie: ${f.kategorie || '–'}`)),
      el('div.tv-interview__frage', null, '„' + f.text + '“'),
      f.kontext ? el('div.tv-mini', { style: { marginBottom: '8px', whiteSpace: 'normal' } }, f.kontext) : null,
      el('div', null, ...(f.antworten || []).map((a, i) => antwortKnopf(ctx, f, a, i))),
      el('div.tv-mini', { style: { marginTop: '7px', whiteSpace: 'normal', lineHeight: '1.45' } },
        'Pfeile deuten an, in welche Richtung es geht — nicht, wie weit. Je höher das Risiko, desto größer die Chance, ' +
        'dass am nächsten Morgen das Gegenteil in der Zeitung steht. Ihre Medienarbeit senkt dieses Risiko.')));
}

/* ==========================================================================
 * 3. Medienspiegel
 * ======================================================================== */

function druckText(d) {
  if (d >= 80) return 'Sie stehen im Feuer. Jede Aufstellung wird öffentlich zerlegt, jedes Wort ausgelegt. ' +
    'Der Vorstand liest dasselbe wie Sie — und zieht seine Schlüsse.';
  if (d >= 62) return 'Deutlich erhöhter Druck. Die Berichterstattung sucht bereits nach Schuldigen, und Sie stehen ganz vorne.';
  if (d >= 45) return 'Normales Grundrauschen. Man beobachtet Sie, aber niemand schreibt die Abschiedskolumne vor.';
  if (d >= 28) return 'Angenehm ruhig. Man lässt Sie arbeiten — das ist in diesem Geschäft schon fast eine Auszeichnung.';
  return 'Die Presse liegt Ihnen zu Füßen. Genießen Sie es, es dauert exakt drei Niederlagen.';
}

function panelSpiegel(ctx, club) {
  const druck = sicher('medienDruck', () => medienDruck(ctx.state, club.id), 50);
  const p = ctx.state.presse || null;
  const geglaettet = p && typeof p.druck === 'number' ? Math.round(p.druck) : druck;
  const glaub = p && typeof p.glaubwuerdigkeit === 'number' ? Math.round(p.glaubwuerdigkeit) : 60;
  const ankuendigungen = ((p && p.ankuendigungen) || [])
    .filter(a => a.season === ctx.state.date.season && a.bisTag >= ctx.state.date.day);

  const kacheln = el('div.tv-grid.tv-grid--3', null,
    statBox('Mediendruck', String(druck), {
      sub: 'aktueller Stand', kind: druck >= 70 ? 'schlecht' : druck <= 35 ? 'gut' : 'warn'
    }),
    statBox('Barometer', String(geglaettet), { sub: 'geglättet über die Wochen' }),
    statBox('Glaubwürdigkeit', String(glaub), {
      sub: 'was man Ihnen abnimmt', kind: glaub >= 65 ? 'gut' : glaub < 40 ? 'schlecht' : undefined
    }));

  return panel(kopf('Medienspiegel', `${BLAETTER.length} Redaktionen`),
    kacheln,
    el('div', { style: { marginTop: '9px' } },
      messwert('Mediendruck', druck, 100, {
        spalten: '120px 1fr 40px', farbe: druck >= 70 ? 'var(--rot)' : druck <= 35 ? 'var(--gruen-600)' : null
      }),
      messwert('Barometer', geglaettet, 100, { spalten: '120px 1fr 40px' }),
      messwert('Glaubwürdigkeit', glaub, 100, { spalten: '120px 1fr 40px' })),
    el('div.tv-mini', { style: { marginTop: '7px', whiteSpace: 'normal', lineHeight: '1.5' } }, druckText(druck)),

    ankuendigungen.length
      ? el('div', { style: { marginTop: '9px' } },
        subpanel(`Offene Ankündigungen (${ankuendigungen.length})`,
          el('div.tv-spalte', { style: { gap: '4px' } },
            ...ankuendigungen.map(a => el('div', null,
              el('div', { style: { fontSize: '12px', lineHeight: '1.4' } }, '„' + a.text + '“'),
              el('div.tv-mini', null,
                `Der Vorstand nimmt Sie beim Wort — Frist bis Tag ${a.bisTag}.`))))))
      : null,

    el('div', { style: { marginTop: '9px' } },
      subpanel('Die Blätter',
        el('div.tv-spalte', { style: { gap: '4px' } },
          ...BLAETTER.map(b => el('div', null,
            el('div.tv-zeile.tv-zeile--verteilt', null,
              el('b', null, `${b.name} (${b.kuerzel})`),
              el('div.tv-zeile', null,
                pill(b.tonfall, b.schaerfe >= 70 ? 'schlecht' : b.schaerfe >= 40 ? 'warn' : 'gut'),
                el('span.tv-mini', null, `Reichweite ${b.reichweite}`))),
            el('div.tv-mini', { style: { whiteSpace: 'normal', lineHeight: '1.4' } }, b.beschreibung)))))));
}

/* ==========================================================================
 * 4. Spielerinterviews
 * ======================================================================== */

function panelInterviews(ctx, club) {
  const alle = kader(ctx.state, club)
    .slice()
    .sort((a, b) => (b.morale || 0) - (a.morale || 0));

  if (!alle.length) {
    return panel('Spielerinterviews',
      el('div.tv-leer', null, 'Kein Kader vorhanden. Über wen sollten Sie reden?'));
  }

  let gewaehlt = alle[0];

  const anzeige = el('div.tv-zeile', { style: { marginBottom: '8px' } });
  const themenBox = el('div.tv-spalte', { style: { gap: '4px' } });

  function zeichne() {
    anzeige.replaceChildren(
      portrait(gewaehlt, 52, club),
      el('div', { style: { minWidth: '0' } },
        el('div.tv-zeile', { style: { flexWrap: 'wrap', rowGap: '3px' } },
          el('b', { style: { fontSize: '14px' } }, `${gewaehlt.firstName} ${gewaehlt.lastName}`),
          posMarke(gewaehlt.position),
          eraMarke(gewaehlt),
          gewaehlt.injury ? pill('verletzt', 'schlecht') : null),
        el('div.tv-mini', null,
          `${gewaehlt.age} Jahre · Moral ${Math.round(gewaehlt.morale || 0)} · Form ${Math.round(gewaehlt.form || 0)} · ` +
          `Charakter: ${(gewaehlt.personality && gewaehlt.personality.name) || '–'}`),
        el('div', { style: { marginTop: '4px' } },
          messwert('Moral', gewaehlt.morale || 0, 100, { spalten: '64px 1fr 32px' }))));
  }
  zeichne();

  const auswahl = el('select', {
    style: { padding: '4px 6px', maxWidth: '100%' },
    onChange: (e) => {
      gewaehlt = ctx.state.players[e.target.value] || alle[0];
      zeichne();
    }
  }, ...alle.map(p => el('option', { value: p.id },
    `${p.shortName || p.lastName} (${p.position}, Moral ${Math.round(p.morale || 0)})` +
    (p.era === 'legend' ? ' ★' : ''))));

  for (const key of Object.keys(INTERVIEW_THEMEN)) {
    const t = INTERVIEW_THEMEN[key];
    themenBox.appendChild(el('button.tv-interview__antwort', {
      type: 'button',
      onClick: async () => {
        const res = sicher('interviewSpieler', () => interviewSpieler(ctx.state, gewaehlt.id, key));
        await ergebnis(t.name, res);
        ctx.aktualisiere();
        ctx.refresh();
      }
    },
    el('div', { style: { fontWeight: '600' } }, t.name),
    el('div.tv-zeile', { style: { marginTop: '4px', flexWrap: 'wrap', rowGap: '3px' } },
      wirkungsMarke('Spieler', t.moral),
      wirkungsMarke('Fans', t.fans),
      wirkungsMarke('Vorstand', t.vorstand),
      risikoMarke(t.risiko))));
  }

  return panel(kopf('Spielerinterviews', `${alle.length} Spieler im Kader`),
    el('div.tv-mini', { style: { marginBottom: '6px' } }, 'Spieler wählen:'),
    auswahl,
    el('div', { style: { marginTop: '8px' } }, anzeige),
    themenBox,
    el('div.tv-mini', { style: { marginTop: '7px', whiteSpace: 'normal', lineHeight: '1.45' } },
      'Lob wirkt kurz und angenehm, Kritik wirkt lange und selten so, wie man es gemeint hat. ' +
      'Wer einen Musterprofi kritisiert, kommt damit durch. Bei einem schwierigen Charakter steht es morgen groß im Blatt.'));
}

/* ==========================================================================
 * 5. Gerüchteküche
 * ======================================================================== */

function panelGeruechte(ctx, club) {
  const p = ctx.state.presse || null;
  const eigene = ((p && p.geruechte) || []).slice(0, 6);

  const markt = (ctx.state.transfermarkt && Array.isArray(ctx.state.transfermarkt.geruechte))
    ? ctx.state.transfermarkt.geruechte
    : (Array.isArray(club['gerüchte']) ? club['gerüchte'] : []);
  const transferGeruechte = markt.slice(0, 8);

  const marktListe = transferGeruechte.length
    ? el('div.tv-spalte', { style: { gap: '5px' } },
      ...transferGeruechte.map(g => {
        const sp = ctx.state.players[g.playerId] || null;
        const von = ctx.state.clubs[g.clubId] || null;
        return el('div.tv-talent', null,
          sp ? portrait(sp, 34, ctx.state.clubs[sp.clubId]) : el('div.tv-portrait', { style: { width: '34px', height: '34px', flex: '0 0 34px' } }),
          el('div', { style: { flex: '1 1 auto', minWidth: '0' } },
            el('div', { style: { fontSize: '12px', lineHeight: '1.4', whiteSpace: 'normal' } }, g.text),
            el('div.tv-mini', null,
              (sp ? `${sp.shortName || sp.lastName} · Marktwert ${formatMoney(sp.value || 0)}` : 'Spieler unbekannt') +
              (von ? ` · Interessent: ${von.shortName || von.name}` : '') +
              ` · Tag ${g.tag}`)),
          sp ? eraMarke(sp) : null);
      }))
    : el('div.tv-leer', null,
      'Die Gerüchteküche ist kalt. Kein Berater wurde in der Nähe der Geschäftsstelle gesehen — noch nicht.');

  const eigeneListe = eigene.length
    ? el('div.tv-spalte', { style: { gap: '4px' } },
      ...eigene.map(g => {
        const t = GERUECHT_THEMEN[g.thema] || { name: g.thema };
        return el('div.tv-zeile.tv-zeile--verteilt', null,
          el('div', { style: { minWidth: '0' } },
            el('b', null, t.name),
            el('div.tv-mini', null, `gestreut an Tag ${g.tag}, Saison ${g.season}`)),
          g.aufgeflogen ? pill('aufgeflogen', 'schlecht')
            : g.erfolg ? pill('hat gezündet', 'gut') : pill('verpufft', 'warn'));
      }))
    : el('div.tv-mini', null, 'Sie haben bislang nichts gestreut. Sehr anständig. Sehr wirkungslos.');

  const knoepfe = el('div.tv-spalte', { style: { gap: '4px' } },
    ...Object.keys(GERUECHT_THEMEN).map(key => {
      const t = GERUECHT_THEMEN[key];
      return el('button.tv-interview__antwort', {
        type: 'button',
        onClick: async () => {
          const ok = await frage('Gerücht streuen',
            `„${t.name}“ in Umlauf bringen? Wenn ein Redakteur nachrecherchiert und die Quelle in Ihrem Büro verortet, ` +
            'kostet das Glaubwürdigkeit und Vertrauen im Vorstand. Zwei Gerüchte in zwei Wochen glaubt ohnehin niemand mehr.');
          if (!ok) return;
          const res = sicher('geruechtStreuen', () => geruechtStreuen(ctx.state, club.id, key));
          await ergebnis('Gerücht streuen', res);
          ctx.aktualisiere();
          ctx.refresh();
        }
      },
      el('div', { style: { fontWeight: '600' } }, t.name),
      el('div.tv-zeile', { style: { marginTop: '4px', flexWrap: 'wrap', rowGap: '3px' } },
        wirkungsMarke('Fans', t.fans),
        wirkungsMarke('Entlastung', -(t.druck || 0)),
        pill(t.ziel === 'gegner' ? 'zielt auf den Gegner' : 'zielt auf uns', 'info'),
        risikoMarke(t.risiko)));
    }));

  return panel(kopf('Gerüchteküche', `${transferGeruechte.length} Meldungen im Umlauf`),
    el('div.tv-grid.tv-grid--2', null,
      subpanel('Transfergerüchte', marktListe),
      el('div.tv-spalte', null,
        subpanel('Selbst gestreut', eigeneListe),
        subpanel('Gerücht streuen',
          el('div.tv-mini', { style: { marginBottom: '6px', whiteSpace: 'normal', lineHeight: '1.45' } },
            'Ein Anruf, ein Halbsatz, kein Name. Wenn es klappt, redet die halbe Republik über etwas, das Sie erfunden haben. ' +
            'Wenn nicht, redet sie über Sie.'),
          knoepfe))));
}

/* ==========================================================================
 * Bildschirm
 * ======================================================================== */

export const screen = {
  id: 'presse',
  title: 'Presse',
  icon: '📰',

  async render(root, ctx) {
    const state = ctx.state;
    const club = state.clubs[state.managerClubId];

    if (!club) {
      root.appendChild(stoerung('Presse', 'Kein Verein im Spielstand gefunden. Auch die Presse braucht ein Thema.'));
      return;
    }

    const druck = sicher('medienDruck', () => medienDruck(state, club.id), 50);

    const seite = el('div.tv-seite', null,
      el('div.tv-seite__kopf', null,
        el('h1.tv-seite__titel', null, 'Presse'),
        el('div.tv-seite__unter', null,
          `Mediendruck ${clamp(Math.round(druck), 0, 100)} von 100. ` +
          'Die Überschrift steht meistens fest, bevor Sie den Mund aufmachen.')));

    seite.appendChild(panelSchlagzeilen(ctx, club));

    seite.appendChild(el('div.tv-grid.tv-grid--haupt', null,
      panelKonferenz(ctx),
      panelSpiegel(ctx, club)));

    seite.appendChild(el('div.tv-grid.tv-grid--seiten', null,
      panelInterviews(ctx, club),
      panelGeruechte(ctx, club)));

    root.appendChild(seite);
  }
};

export default screen;
