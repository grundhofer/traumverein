/**
 * screens/jugend.js — Die Nachwuchsabteilung.
 *
 * Der langsamste Teil des Vereins: Hier wird gesät, geerntet wird in vier Jahren.
 * Der Bildschirm zeigt die Akademie, die Talente mit ihrer ehrlichen Unschärfe,
 * die beobachteten Scouting-Regionen, den Jahrgangswechsel und das, was am Ende
 * dabei herauskommt — die Eigengewächse im Profikader.
 *
 * Alle Zustandsänderungen laufen ausschließlich über die Aktionsfunktionen aus
 * club/youth.js. Dieser Bildschirm rechnet nichts selbst nach.
 */

import {
  el, frag, panel, subpanel, button, bar, statBox, pill, dialog,
  confirm as frage, toast
} from '../render/ui.js';
import { portraitDataURL } from '../render/portraits.js';
import { formatMoney, clamp } from '../core/util.js';
import { POSITION_NAMES, POSITION_GROUP } from '../core/constants.js';
import { playerOverall } from '../engine/ratings.js';
import {
  AKADEMIE_STUFEN, akademieStufeVon, SCOUTING_REGIONEN, REGION_IDS,
  talente, profiSchwelle, befoerdern, zurueckstufen, akademieAusbauen,
  scoutingRegion, nachwuchsBericht, eigengewaechsBonus
} from '../club/youth.js';

/* ==========================================================================
 * Kleine Bausteine — bewusst lokal, damit dieser Bildschirm allein lauffähig ist
 * ======================================================================== */

/** Ruft etwas Optionales auf und stürzt niemals ab. */
function sicher(label, fn, ersatz = null) {
  try {
    const v = fn();
    return v === undefined || v === null ? ersatz : v;
  } catch (e) {
    console.error(`[jugend] ${label}:`, e);
    return ersatz;
  }
}

/** Roter Kasten statt weißer Seite, wenn ein Modul nicht mitspielt. */
function stoerung(titel, text) {
  const p = panel(titel, el('div.tv-leer', null, text));
  p.classList.add('tv-panel--rot');
  return p;
}

/** Panel-Titel mit rechtsbündiger Zusatzangabe. */
function kopf(titel, extra) {
  if (!extra) return titel;
  return frag(el('span', null, titel),
    el('span', { style: { fontSize: '11px', fontWeight: '400', letterSpacing: '.3px', textTransform: 'none', opacity: '.85' } }, extra));
}

/** Beschriftete Messlatte: Name — Balken — Zahl. Nutzt das .tv-attr-Raster. */
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

function sterneMarke(n) {
  const v = clamp(Math.round(n || 0), 0, 5);
  return el('span.tv-sterne', { title: `${v} von 5 Sternen` }, '★'.repeat(v) + '☆'.repeat(5 - v));
}

function posMarke(pos) {
  return el('span.tv-pos', {
    class: 'tv-pos--' + (POSITION_GROUP[pos] || 'MIT'),
    title: POSITION_NAMES[pos] || pos
  }, pos);
}

/** Legenden werden IMMER hervorgehoben — das ist der Kern des Spiels. */
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

/** Zeigt das Ergebnis einer Aktionsfunktion so, wie das Modul es formuliert hat. */
async function ergebnis(titel, res) {
  const ok = !!(res && res.ok);
  await dialog(titel,
    el('p', { style: { margin: '0', lineHeight: '1.55' } },
      (res && res.text) || 'Das Modul hat keine Rückmeldung geliefert.'),
    [{ label: ok ? 'Sehr schön' : 'Verstanden', value: true, kind: ok ? 'primary' : 'ghost' }],
    { size: 'sm' });
  return ok;
}

/* ==========================================================================
 * 1. Akademie
 * ======================================================================== */

async function ausbauDialog(ctx, club) {
  const y = club.youth || {};
  const aktuell = sicher('akademieStufeVon', () => akademieStufeVon(y.akademie || 0), AKADEMIE_STUFEN[0]);
  const offen = AKADEMIE_STUFEN.filter(s => s.stufe > aktuell.stufe);

  if (!offen.length) {
    toast('Höher geht es nicht. Sie betreiben bereits eine Talentschmiede von Weltruf.', 'info');
    return;
  }

  // Zwischenstufen werden mitbezahlt — die Summen laufen deshalb auf.
  let summeKosten = 0, summeTage = 0;
  const zeilen = offen.map(s => {
    summeKosten += s.kosten;
    summeTage += s.tage;
    return { s, kosten: summeKosten, tage: summeTage };
  });

  const wahl = await dialog('Akademie ausbauen',
    (api) => el('div.tv-spalte', null,
      el('div.tv-mini', null,
        `Aktuell: Stufe ${aktuell.stufe} — „${aktuell.name}“ (Akademiewert ${Math.round(y.akademie || 0)} von 100). ` +
        'Wer eine Stufe überspringt, bezahlt die übersprungenen trotzdem. Beton hat noch nie Rabatt gegeben.'),
      ...zeilen.map(z => subpanel(`Stufe ${z.s.stufe} · ${z.s.name}`,
        el('div.tv-mini', { style: { marginBottom: '5px' } }, z.s.desc),
        el('div.tv-zeile.tv-zeile--verteilt', null,
          el('div.tv-mini', null,
            `Gesamtkosten ${formatMoney(z.kosten)} · Bauzeit ${z.tage} Tage · Akademiewert danach ${z.s.wert}`),
          button('Beauftragen', () => api.close(z.s.stufe), { kind: 'primary', size: 'klein' }))))),
    [{ label: 'Doch nicht', value: null, kind: 'ghost' }], { size: 'lg' });

  if (!wahl) return;
  const res = sicher('akademieAusbauen', () => akademieAusbauen(ctx.state, club.id, wahl));
  await ergebnis('Bauantrag', res);
  ctx.aktualisiere();
  ctx.refresh();
}

function panelAkademie(ctx, club, bericht) {
  const y = club.youth || {};
  const stufe = sicher('akademieStufeVon', () => akademieStufeVon(y.akademie || 0), AKADEMIE_STUFEN[0]);
  const naechste = AKADEMIE_STUFEN.find(s => s.stufe === stufe.stufe + 1) || null;
  const ausbau = bericht ? bericht.ausbau : y.ausbau;

  const kacheln = el('div.tv-grid.tv-grid--4', null,
    statBox('Ausbaustufe', `${stufe.stufe} / ${AKADEMIE_STUFEN.length}`, { sub: stufe.name }),
    statBox('Akademiewert', `${Math.round(y.akademie || 0)}`, { sub: 'von 100 Punkten' }),
    statBox('Talente im Kader', String(bericht ? bericht.anzahl : (y.talente || []).length),
      { sub: `profireif ab Stärke ${bericht ? bericht.schwelle : sicher('profiSchwelle', () => profiSchwelle(club), 50)}` }),
    statBox('Kosten', bericht ? formatMoney(bericht.kostenJahr) : '–',
      { sub: 'Betrieb, Internat, Scouting pro Jahr', kind: 'warn' }));

  const balken = el('div', { style: { marginTop: '9px' } },
    messwert('Akademie', y.akademie || 0, 100, { spalten: '104px 1fr 40px' }),
    messwert('Jugendtrainer', bericht ? bericht.wirkungJugend : 0, 100, { spalten: '104px 1fr 40px' }),
    messwert('Scouting', bericht ? bericht.wirkungScouting : 0, 100, { spalten: '104px 1fr 40px' }));

  let baustelle;
  if (ausbau) {
    const gesamt = Math.max(1, ausbau.restTage + 1);
    baustelle = subpanel('Baustelle',
      el('div.tv-zeile.tv-zeile--verteilt', null,
        el('b', null, ausbau.name),
        el('span.tv-mini', null, `noch ${ausbau.restTage} Tage`)),
      el('div', { style: { marginTop: '5px' } },
        bar(Math.max(0, gesamt - ausbau.restTage), gesamt, { showValue: false, color: 'var(--gold)' })),
      el('div.tv-mini', { style: { marginTop: '5px' } },
        `Auftragswert ${formatMoney(ausbau.kosten || 0)}. Danach steht die Akademie bei ${ausbau.zielWert} von 100. ` +
        'Bis dahin: Bauzäune, Lärm und ein Platzwart mit sehr schlechter Laune.'));
  } else if (naechste) {
    baustelle = subpanel('Nächster Ausbauschritt',
      el('div.tv-zeile.tv-zeile--verteilt', null,
        el('b', null, `Stufe ${naechste.stufe} · ${naechste.name}`),
        button('Akademie ausbauen', () => ausbauDialog(ctx, club), { kind: 'primary', size: 'klein' })),
      el('div.tv-mini', { style: { marginTop: '4px' } },
        `${naechste.desc} Kosten ${formatMoney(naechste.kosten)}, Bauzeit ${naechste.tage} Tage.`));
  } else {
    baustelle = subpanel('Ausbau',
      el('div.tv-mini', null,
        'Die höchste Ausbaustufe ist erreicht. Wer hier ausgebildet wird, spielt irgendwo erste Liga. Irgendwo.'));
  }

  const p = panel(kopf('Akademie', stufe.name), kacheln, balken, baustelle,
    bericht ? el('div.tv-mini', { style: { marginTop: '7px', lineHeight: '1.5' } },
      el('div', null, bericht.bewertung),
      el('div', { style: { marginTop: '3px', fontWeight: '700' } }, 'Empfehlung: ' + bericht.empfehlung)) : null);
  p.classList.add('tv-panel--gruen');
  return p;
}

/* ==========================================================================
 * 2. Talente
 * ======================================================================== */

function talentZeile(ctx, club, t) {
  const p = t.player;
  const unschaerfe = Math.max(0, t.spanne[1] - t.spanne[0]);

  const links = el('div', { style: { flex: '1 1 auto', minWidth: '0' } },
    el('div.tv-zeile', { style: { flexWrap: 'wrap', rowGap: '3px' } },
      el('b', { style: { fontSize: '14px' } }, t.name),
      posMarke(t.position),
      eraMarke(p),
      t.profireif ? pill('profireif', 'gut') : null,
      t.sterne >= 5 ? pill('Ausnahmetalent', 'gold') : null),
    el('div.tv-mini', null,
      `${t.alter} Jahre · ${t.positionName} · ${t.nationalitaet || '??'}` +
      (t.region ? ` · gesichtet in ${t.region}` : '') +
      ` · ${t.jahreImVerein} Jahr${t.jahreImVerein === 1 ? '' : 'e'} im Verein`),
    el('div.tv-zeile', { style: { marginTop: '4px' } },
      sterneMarke(t.sterne),
      el('span.tv-mini', null,
        `Potenzial ${t.spanne[0]}–${t.spanne[1]} ` +
        (unschaerfe >= 14 ? '(reines Bauchgefühl)' : unschaerfe >= 7 ? '(mit Vorbehalt)' : '(belastbar)'))),
    el('div', { style: { marginTop: '3px' } },
      messwert('Stärke heute', t.ovrSchaetzung, 99, { spalten: '86px 1fr 34px', text: '~' + t.ovrSchaetzung }),
      messwert('Potenzial', t.potenzialSchaetzung, 99, { spalten: '86px 1fr 34px', text: '~' + t.potenzialSchaetzung }),
      messwert('Sicherheit', t.sicherheit, 100, { spalten: '86px 1fr 34px', text: t.sicherheit + '%' })),
    el('div.tv-mini', { style: { marginTop: '4px', fontStyle: 'italic', whiteSpace: 'normal', lineHeight: '1.45' } },
      '„' + t.einschaetzung + '“'));

  const rechts = el('div.tv-spalte', { style: { flex: '0 0 auto', gap: '4px', alignItems: 'flex-end' } },
    el('span.tv-wert', { style: { minWidth: 'auto' } }, formatMoney(t.wert || 0)),
    button('In den Profikader befördern', async () => {
      const ok = await frage('Beförderung',
        `${t.name} (${t.alter}) einen Profivertrag geben? Eigengewächse sind billig, machen die Kurve glücklich — ` +
        'und sitzen dann leider auch auf der Bank, wenn sie noch nicht so weit sind.');
      if (!ok) return;
      const res = sicher('befoerdern', () => befoerdern(ctx.state, t.id));
      await ergebnis('Profivertrag', res);
      ctx.aktualisiere();
      ctx.refresh();
    }, { kind: t.profireif ? 'primary' : 'default', size: 'klein' }),
    button('Akte ansehen', () => ctx.navigate('kader', { player: t.id }), { kind: 'ghost', size: 'klein' }));

  const zeile = el('div.tv-talent', null, portrait(p, 56, club), links, rechts);
  if (p && p.era === 'legend') zeile.classList.add('zeile--legende');
  return zeile;
}

function rueckstufungsZeile(ctx, club, p) {
  return el('div.tv-talent', null,
    portrait(p, 40, club),
    el('div', { style: { flex: '1 1 auto', minWidth: '0' } },
      el('div.tv-zeile', null, el('b', null, p.shortName || p.lastName), posMarke(p.position), eraMarke(p)),
      el('div.tv-mini', null,
        `${p.age} Jahre · Stärke ${sicher('ovr', () => playerOverall(p), '?')} · ` +
        `${(p.stats && p.stats.season && p.stats.season.spiele) || 0} Saisonspiele`)),
    button('Zurückstufen', async () => {
      const ok = await frage('Zurückstufen',
        `${p.firstName} ${p.lastName} zurück in den Nachwuchs schicken? Spielpraxis in der A-Jugend ist besser als ` +
        'Tribüne bei den Profis — sagen Sie ihm das aber bitte persönlich.');
      if (!ok) return;
      const res = sicher('zurueckstufen', () => zurueckstufen(ctx.state, p.id));
      await ergebnis('Rückstufung', res);
      ctx.aktualisiere();
      ctx.refresh();
    }, { kind: 'ghost', size: 'klein' }));
}

function panelTalente(ctx, club, bericht) {
  const liste = (bericht && bericht.talente) || sicher('talente', () => talente(ctx.state, club.id), []) || [];
  const schwelle = bericht ? bericht.schwelle : sicher('profiSchwelle', () => profiSchwelle(club), 50);

  const kader = (club.playerIds || []).map(id => ctx.state.players[id]).filter(Boolean);
  const jung = kader.filter(p => (p.age || 99) <= 21);

  const inhalt = el('div.tv-spalte', { style: { gap: '0' } });
  if (!liste.length) {
    inhalt.appendChild(el('div.tv-leer', null,
      'Kein einziges Talent im Nachwuchs. Entweder wurde nie gesichtet, oder die Jungs sind alle weg. ' +
      'Beides ist gleich schlecht.'));
  } else {
    for (const t of liste) inhalt.appendChild(talentZeile(ctx, club, t));
  }

  const rueck = jung.length
    ? subpanel(`Rückstufung möglich (${jung.length})`,
      el('div.tv-mini', { style: { marginBottom: '5px' } },
        'Profis bis 21 dürfen zurück in die A-Jugend. Wer bei uns nur die Bank drückt, spielt dort wenigstens.'),
      ...jung.map(p => rueckstufungsZeile(ctx, club, p)))
    : subpanel('Rückstufung möglich',
      el('div.tv-mini', null, 'Kein Profi unter 22 im Kader. Rückstufen können wir also niemanden.'));

  return panel(kopf('Talente', `${liste.length} im Nachwuchs · Profireife ab Stärke ${schwelle}`),
    inhalt,
    el('div', { style: { marginTop: '9px' } }, rueck));
}

/* ==========================================================================
 * 3. Scouting-Regionen
 * ======================================================================== */

function regionKarte(ctx, club, id, aktiv, voll) {
  const r = SCOUTING_REGIONEN[id];
  if (!r) return null;

  const k = subpanel(kopf(r.name, aktiv ? 'wird beobachtet' : formatMoney(r.kostenJahr) + ' / Jahr'),
    el('div.tv-mini', { style: { lineHeight: '1.45', whiteSpace: 'normal' } }, r.profil),
    el('div.tv-zeile', { style: { marginTop: '5px', flexWrap: 'wrap', rowGap: '3px' } },
      ...(r.pos || []).map(p => posMarke(p)),
      r.potBonus ? pill((r.potBonus > 0 ? '+' : '') + r.potBonus + ' Potenzial', r.potBonus > 3 ? 'gut' : 'info') : null,
      r.deutsch ? pill('Inland', 'neutral') : null),
    el('div.tv-mini', { style: { marginTop: '4px' } },
      'Typische Herkunft: ' + Array.from(new Set(r.nationen || [])).join(', ')),
    el('div.tv-zeile.tv-zeile--verteilt', { style: { marginTop: '6px' } },
      el('span.tv-mini', null, `Laufende Kosten: ${formatMoney(r.kostenJahr)} im Jahr`),
      button(aktiv ? 'Nicht mehr beobachten' : 'Region beobachten', async () => {
        const res = sicher('scoutingRegion', () => scoutingRegion(ctx.state, club.id, id, !aktiv));
        await ergebnis('Scouting', res);
        ctx.aktualisiere();
        ctx.refresh();
      }, { kind: aktiv ? 'danger' : 'primary', size: 'klein', disabled: !aktiv && voll })));

  if (aktiv) k.style.boxShadow = 'inset 4px 0 0 var(--gruen-600)';
  else k.style.opacity = '.82';
  return k;
}

function panelRegionen(ctx, club, bericht) {
  const aktive = new Set(((bericht && bericht.regionen) || []).map(r => r.id));
  const max = bericht ? bericht.maxRegionen : 1;
  const voll = aktive.size >= max;

  const naechste = (club.youth && club.youth.naechsteSichtung) || 0;
  const restTage = Math.max(0, naechste - ctx.state.date.day);
  const kostenJahr = Array.from(aktive).reduce((s, id) => s + ((SCOUTING_REGIONEN[id] || {}).kostenJahr || 0), 0);

  const hinweis = subpanel('Nächste Sichtung',
    el('div.tv-zeile.tv-zeile--verteilt', null,
      el('b', null, restTage <= 0 ? 'Jederzeit — die Scouts sind bereits unterwegs' : `in rund ${restTage} Tagen`),
      el('span.tv-mini', null, `${aktive.size} von ${max} Regionen · ${formatMoney(kostenJahr)} im Jahr`)),
    el('div.tv-mini', { style: { marginTop: '4px', lineHeight: '1.45' } },
      'Jede Sichtung kostet Geld und endet meistens mit vierzig Jungs, viel Regen und keinem Talent. ' +
      'Mehr Regionen gleichzeitig gehen nur mit mehr Scouts — ein Chefscout deckt gleich zwei ab.'));

  const gitter = el('div.tv-grid.tv-grid--3', { style: { marginTop: '9px' } },
    ...REGION_IDS.map(id => regionKarte(ctx, club, id, aktive.has(id), voll)));

  const frei = max - aktive.size;
  return panel(kopf('Scouting-Regionen',
    voll ? 'Kapazität ausgeschöpft' : (frei === 1 ? 'ein Platz frei' : `${frei} Plätze frei`)),
  hinweis, gitter);
}

/* ==========================================================================
 * 4. Jahrgang
 * ======================================================================== */

function panelJahrgang(ctx, club, bericht) {
  const y = club.youth || {};
  const liste = (bericht && bericht.talente) || [];
  const jahrgangIds = Array.isArray(y.jahrgang) ? y.jahrgang : [];
  const jahrgang = jahrgangIds.map(id => ctx.state.players[id]).filter(Boolean);

  // Anzeige-Schätzung. Verbindlich sind die Balancing-Konstanten in club/youth.js;
  // hier steht nur eine Hausnummer für die Planung.
  const erwartet = clamp(Math.round(2.4 + ((y.akademie || 0) / 100) * 4.2), 1, 8);

  // Zur Entscheidung stehen die Ältesten: mit 20 gibt es Profivertrag oder Abschied.
  const entscheidung = liste.filter(t => t.alter >= 19).slice(0, 8);

  const kacheln = el('div.tv-grid.tv-grid--4', null,
    statBox('Nächster Wechsel', 'Saisonende', { sub: `Saison ${ctx.state.date.season}` }),
    statBox('Erwartete Neuzugänge', `${Math.max(1, erwartet - 1)}–${erwartet + 1}`, { sub: 'Schätzung der Nachwuchsleitung' }),
    statBox('Befördert', String(y.befoerdert || 0), { sub: 'seit Amtsantritt', kind: 'gut' }),
    statBox('Verabschiedet', String(y.abgaenge || 0), { sub: 'ohne Profivertrag' }));

  const aktuell = subpanel(`Aktueller Jahrgang (${jahrgang.length})`,
    jahrgang.length
      ? el('div.tv-zeile', { style: { flexWrap: 'wrap', rowGap: '4px' } },
        ...jahrgang.map(p => el('span.tv-pill', { title: POSITION_NAMES[p.position] || p.position },
          `${p.shortName || p.lastName} (${p.age})`)))
      : el('div.tv-mini', null,
        'Für diese Saison ist noch kein Jahrgang eingeschrieben. Der kommt zum Saisonwechsel.'));

  const anstehend = subpanel(`Zur Entscheidung am Saisonende (${entscheidung.length})`,
    entscheidung.length
      ? el('div.tv-spalte', { style: { gap: '3px' } },
        ...entscheidung.map(t => el('div.tv-zeile.tv-zeile--verteilt', null,
          el('div.tv-zeile', null,
            el('b', null, t.shortName || t.name), posMarke(t.position),
            el('span.tv-mini', null, `${t.alter} Jahre`)),
          el('div.tv-zeile', null,
            sterneMarke(t.sterne),
            t.profireif ? pill('bekommt Vertrag', 'gut') : pill('wird es eng', 'warn')))))
      : el('div.tv-mini', null,
        'Kein Talent steht kurz vor dem Absprung. In diesem Sommer wird niemand verabschiedet.'));

  const turnier = y.turnier
    ? subpanel('Letztes Jugendturnier',
      el('div.tv-mini', { style: { lineHeight: '1.45' } },
        `${y.turnier.name}: ${y.turnier.platz === 1 ? 'Turniersieg' : 'Platz ' + y.turnier.platz}` +
        (y.turnier.preis ? `, Preisgeld ${formatMoney(y.turnier.preis)}` : ', kein Preisgeld') +
        `. Gespielt in Saison ${y.turnier.season}.`))
    : subpanel('Jugendturniere',
      el('div.tv-mini', null,
        'In diesem Jahr war der Nachwuchs noch bei keinem Turnier. Termine liegen in der Sommer- und Wintervorbereitung.'));

  return panel(kopf('Jahrgang', `${y.durchbrueche || 0} Durchbrüche gemeldet`),
    kacheln,
    el('div.tv-grid.tv-grid--2', { style: { marginTop: '9px' } }, aktuell, anstehend),
    el('div', { style: { marginTop: '9px' } }, turnier));
}

/* ==========================================================================
 * 5. Eigengewächse
 * ======================================================================== */

function panelEigengewaechse(ctx, club, bericht) {
  const bonus = (bericht && bericht.eigengewaechse) ||
    sicher('eigengewaechsBonus', () => eigengewaechsBonus(ctx.state, club.id));

  if (!bonus) {
    return stoerung('Eigengewächse',
      'Die Auswertung der Eigengewächse ist nicht verfügbar — club/youth.js meldet keine Daten.');
  }

  const kacheln = el('div.tv-grid.tv-grid--4', null,
    statBox('Im Profikader', String(bonus.anzahl), { sub: `${Math.round((bonus.quote || 0) * 100)} % des Kaders` }),
    statBox('In der Startelf', String(bonus.inStammelf), { sub: 'Elf, die die Kurve liebt', kind: bonus.inStammelf >= 3 ? 'gut' : undefined }),
    statBox('Fanbonus', '+' + bonus.fanBonus, { sub: 'Dauerbonus auf die Stimmung', kind: 'gut' }),
    statBox('Gehaltsersparnis', formatMoney(bonus.gehaltsErsparnis), { sub: 'gegenüber Marktgehältern pro Jahr', kind: 'gold' }));

  const spieler = (bonus.spieler || []).map(s => ctx.state.players[s.id]).filter(Boolean);
  const liste = spieler.length
    ? el('div.tv-spalte', { style: { gap: '0', marginTop: '9px' } },
      ...spieler.map(p => {
        const zeile = el('div.tv-talent', null,
          portrait(p, 42, club),
          el('div', { style: { flex: '1 1 auto', minWidth: '0' } },
            el('div.tv-zeile', null,
              el('b', null, `${p.firstName} ${p.lastName}`), posMarke(p.position), eraMarke(p),
              p.captain ? pill('Kapitän', 'gold') : null),
            el('div.tv-mini', null,
              `${p.age} Jahre · Stärke ${sicher('ovr', () => playerOverall(p), '?')} · ` +
              `Marktwert ${formatMoney(p.value || 0)} · Gehalt ${formatMoney((p.contract && p.contract.salary) || 0)}`)),
          el('span.tv-wert', { style: { minWidth: 'auto' } },
            `${(p.stats && p.stats.career && p.stats.career.spiele) || 0} Spiele`));
        if (p.era === 'legend') zeile.classList.add('zeile--legende');
        return zeile;
      }))
    : el('div.tv-leer', { style: { marginTop: '9px' } },
      'Noch niemand durchgebracht. Wer aus dem Nachwuchs befördert wird, taucht hier auf — ' +
      'mit null Ablöse in den Büchern und einem Gehalt, über das ein Zugang nur lachen würde.');

  const p = panel(kopf('Eigengewächse', 'Buchwert ' + formatMoney(bonus.buchwert || 0)),
    kacheln,
    liste,
    el('div.tv-mini', { style: { marginTop: '8px', lineHeight: '1.5' } }, bonus.text));
  p.classList.add('tv-panel--gold');
  return p;
}

/* ==========================================================================
 * Bildschirm
 * ======================================================================== */

export const screen = {
  id: 'jugend',
  title: 'Jugend',
  icon: '🌱',

  async render(root, ctx) {
    const state = ctx.state;
    const club = state.clubs[state.managerClubId];

    if (!club) {
      root.appendChild(stoerung('Jugend', 'Kein Verein im Spielstand gefunden. Das sollte nicht passieren.'));
      return;
    }

    const bericht = sicher('nachwuchsBericht', () => nachwuchsBericht(state, club.id));

    const seite = el('div.tv-seite', null,
      el('div.tv-seite__kopf', null,
        el('h1.tv-seite__titel', null, 'Nachwuchs'),
        el('div.tv-seite__unter', null,
          'Vier von fünf Talenten wird nie etwas. Das fünfte bezahlt die ganze Abteilung.')));

    seite.appendChild(panelAkademie(ctx, club, bericht));

    seite.appendChild(el('div.tv-grid.tv-grid--haupt', null,
      panelTalente(ctx, club, bericht),
      el('div.tv-spalte', null,
        panelJahrgang(ctx, club, bericht),
        panelEigengewaechse(ctx, club, bericht))));

    seite.appendChild(panelRegionen(ctx, club, bericht));

    root.appendChild(seite);
  }
};

export default screen;
