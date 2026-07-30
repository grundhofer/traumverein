/**
 * screens/stab.js — Trainerstab, offene Stellen, Wirkung und das eigene Profil.
 *
 * Die Bank hinter der Bank: Co-Trainer, Ärzte, Physios, Scouts, Jugendtrainer.
 * Man sieht sie nie im Fernsehen und merkt sie in jeder Statistik.
 *
 * Alle Personalentscheidungen laufen über die Aktionsfunktionen aus club/staff.js.
 */

import {
  el, frag, panel, subpanel, button, bar, statBox, pill, tabs, dialog,
  confirm as frage, toast
} from '../render/ui.js';
import { portraitDataURL } from '../render/portraits.js';
import { formatMoney } from '../core/util.js';
import {
  STAFF_ROLES, STAFF_ROLE_IDS, STAB_TRAITS, KURSE,
  WIRKUNG_FELDER, WIRKUNG_NAMEN,
  stabVon, stabWirkung, stabBericht, qualitaetVon, marktGehalt,
  anzahlInRolle, bewerber, einstellen, entlassen, gehaltVerhandeln, weiterbildung
} from '../club/staff.js';

/** Was ein hoher Wert im jeweiligen Feld konkret bedeutet. */
const WIRKUNG_ERKLAERUNG = {
  training: 'Wie viel eine Trainingswoche überhaupt bringt. Ohne diesen Wert läuft die Mannschaft im Kreis und wird trotzdem nicht besser.',
  regeneration: 'Wie schnell Fitness und Frische nach dem Spiel zurückkommen. Entscheidet über englische Wochen.',
  verletzungsschutz: 'Weniger Muskelverletzungen, kürzere Ausfälle, seltenere Rückschläge.',
  scouting: 'Genauigkeit der Spielerberichte und Zahl der Regionen, die wir gleichzeitig beobachten dürfen.',
  jugend: 'Tempo, in dem sich Talente entwickeln. Der langsamste und dankbarste Wert von allen.',
  taktik: 'Wie gut die Mannschaft Ihre Vorgaben tatsächlich umsetzt — und wie schnell sie umschaltet.',
  moral: 'Stimmung in der Kabine, Krisenfestigkeit, Umgang mit Reservisten.',
  torwart: 'Entwicklung der Torhüter: Reflexe, Strafraum, Spielaufbau.',
  analyse: 'Gegnervorbereitung. Wer weiß, wo der Innenverteidiger links nicht kann, gewinnt manchmal allein deswegen.'
};

const ROLLEN_ICON = {
  cotrainer: '📋', torwarttrainer: '🧤', athletiktrainer: '🏃', mannschaftsarzt: '🩺',
  physiotherapeut: '💆', chefscout: '🔍', scout: '🔎', jugendtrainer: '🌱',
  videoanalyst: '📹', mentaltrainer: '🧠', zeugwart: '🧺', sportdirektor: '💼'
};

/* ==========================================================================
 * Bausteine
 * ======================================================================== */

function sicher(label, fn, ersatz = null) {
  try {
    const v = fn();
    return v === undefined || v === null ? ersatz : v;
  } catch (e) {
    console.error(`[stab] ${label}:`, e);
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

async function ergebnis(titel, res) {
  const ok = !!(res && res.ok);
  await dialog(titel,
    el('p', { style: { margin: '0', lineHeight: '1.55' } },
      (res && res.text) || 'Aus der Geschäftsstelle kam keine Antwort.'),
    [{ label: ok ? 'Gut so' : 'Verstanden', value: true, kind: ok ? 'primary' : 'ghost' }],
    { size: 'sm' });
  return ok;
}

/**
 * Notlösung für Eigenschaften, die data/generator.js vergibt (z. B. „taktiktueftler“),
 * die aber nicht im Katalog STAB_TRAITS von club/staff.js stehen. Statt den rohen
 * Schlüssel anzuzeigen, machen wir daraus wenigstens lesbares Deutsch.
 */
function lesbarerSchluessel(key) {
  const wort = String(key).replace(/_/g, ' ')
    .replace(/ue/g, 'ü').replace(/oe/g, 'ö').replace(/ae/g, 'ä');
  return wort.charAt(0).toUpperCase() + wort.slice(1);
}

function traitMarken(traits) {
  return (traits || []).map(t => {
    const bekannt = STAB_TRAITS[t];
    const marke = pill(bekannt ? bekannt.name : lesbarerSchluessel(t), bekannt ? 'info' : 'neutral');
    marke.title = bekannt ? bekannt.desc : 'Eigenschaft aus der Personalakte.';
    return marke;
  });
}

function jahre(n) {
  return `${n} ${n === 1 ? 'Jahr' : 'Jahre'}`;
}

/* ==========================================================================
 * 1. Mein Stab
 * ======================================================================== */

async function gehaltDialog(ctx, s) {
  const club = ctx.state.clubs[s.clubId] || {};
  const markt = sicher('marktGehalt',
    () => marktGehalt(s.roleId, qualitaetVon(s), club.reputation || 50, s.alter), s.gehalt || 0);

  let betrag = Math.max(s.gehalt || 0, Math.round(markt / 1000) * 1000);
  const anzeige = el('b', { style: { fontFamily: 'var(--font-num)', fontSize: '16px' } }, formatMoney(betrag));
  const setze = (v) => {
    betrag = Math.max(12000, Math.round(v / 1000) * 1000);
    anzeige.textContent = formatMoney(betrag);
  };

  const wahl = await dialog(`Gehalt verhandeln — ${s.name}`,
    () => el('div.tv-spalte', null,
      el('div.tv-mini', { style: { lineHeight: '1.45' } },
        `Aktuelles Jahresgehalt: ${formatMoney(s.gehalt || 0)}. Marktwert für einen ` +
        `${(STAFF_ROLES[s.roleId] || {}).name || 'Mitarbeiter'} dieser Güte: rund ${formatMoney(markt)}. ` +
        (s.abwerbung ? `Achtung: ${s.abwerbung.clubName || 'Ein anderer Verein'} wirbt bereits um ihn. ` : '') +
        'Ein zu niedriges Angebot beleidigt ihn — und das merkt man dann sechs Wochen lang.'),
      el('div.tv-zeile.tv-zeile--verteilt', null,
        el('span.tv-mini', null, 'Ihr Angebot'), anzeige),
      el('div.tv-zeile', { style: { flexWrap: 'wrap', rowGap: '4px' } },
        button('Marktwert', () => setze(markt), { size: 'klein' }),
        button('+ 10 %', () => setze(betrag * 1.1), { size: 'klein' }),
        button('+ 25 %', () => setze(betrag * 1.25), { size: 'klein' }),
        button('− 10 %', () => setze(betrag * 0.9), { size: 'klein' }),
        button('Wie bisher', () => setze(s.gehalt || markt), { size: 'klein' })),
      el('div.tv-mini', null, 'Angenommen wird erst, wenn die Zahl seiner Vorstellung entspricht. Er sagt Ihnen nicht, welche das ist.')),
    [
      { label: 'Abbrechen', value: null, kind: 'ghost' },
      { label: 'Angebot machen', value: 'los', kind: 'primary' }
    ], { size: 'md' });

  if (wahl !== 'los') return;
  const res = sicher('gehaltVerhandeln', () => gehaltVerhandeln(ctx.state, s.id, betrag));
  await ergebnis('Verhandlung', res);
  ctx.aktualisiere();
  ctx.refresh();
}

async function kursDialog(ctx, s) {
  const moeglich = KURSE.filter(k => !k.rollen || k.rollen.includes(s.roleId));
  if (!moeglich.length) {
    toast(`Für einen ${(STAFF_ROLES[s.roleId] || {}).name || 'Mitarbeiter'} hat der Verband nichts im Programm.`, 'warn');
    return;
  }

  const wahl = await dialog(`Weiterbildung — ${s.name}`,
    (api) => el('div.tv-spalte', null,
      el('div.tv-mini', { style: { lineHeight: '1.45' } },
        `Aktuelle Qualität: ${qualitaetVon(s)} von 99. Lange Lehrgänge machen ihn besser — und für ihre Dauer ` +
        'fehlt er im Alltagsbetrieb. Das merkt die Mannschaft.'),
      ...moeglich.map(k => subpanel(k.name,
        el('div.tv-mini', { style: { marginBottom: '5px', whiteSpace: 'normal' } }, k.desc),
        el('div.tv-zeile.tv-zeile--verteilt', null,
          el('span.tv-mini', null,
            `${formatMoney(k.kosten)} · ${k.tage} Tage · erwartet rund +${k.plus} Punkte` +
            (k.tage >= 42 ? ' · währenddessen abwesend' : '')),
          button('Anmelden', () => api.close(k.id), { kind: 'primary', size: 'klein' }))))),
    [{ label: 'Doch nicht', value: null, kind: 'ghost' }], { size: 'lg' });

  if (!wahl) return;
  const res = sicher('weiterbildung', () => weiterbildung(ctx.state, s.id, wahl));
  await ergebnis('Lehrgang', res);
  ctx.aktualisiere();
  ctx.refresh();
}

async function entlassenDialog(ctx, s) {
  const restJahre = Math.max(0, (s.vertragBis || 0) - ctx.state.date.season);
  const ok = await frage('Freistellung',
    `${s.name} entlassen? Der Vertrag läuft noch bis Saison ${s.vertragBis} ` +
    `(${jahre(restJahre)}). Fällig wird eine Abfindung — mindestens ein knappes Drittel ` +
    'eines Jahresgehalts, bei langer Restlaufzeit deutlich mehr. Das Geld ist sofort weg, der Posten sofort leer.');
  if (!ok) return;
  const res = sicher('entlassen', () => entlassen(ctx.state, s.id));
  await ergebnis('Freistellung', res);
  ctx.aktualisiere();
  ctx.refresh();
}

function stabKarte(ctx, s) {
  const role = STAFF_ROLES[s.roleId] || { name: s.roleId, effekte: {}, wirkung: '' };
  const q = qualitaetVon(s);
  const restJahre = Math.max(0, (s.vertragBis || 0) - ctx.state.date.season);

  const beitraege = Object.entries(role.effekte || {})
    .sort((a, b) => b[1] - a[1])
    .map(([feld, gewicht]) => messwert(
      WIRKUNG_NAMEN[feld] || feld,
      Math.round(q * gewicht), 100,
      { spalten: '112px 1fr 34px', titel: WIRKUNG_ERKLAERUNG[feld] || '' }));

  const karte = el('div.tv-stab__karte', null,
    el('div', {
      style: {
        flex: '0 0 40px', width: '40px', height: '40px', fontSize: '22px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,.12)', border: '1px solid var(--linie)', borderRadius: '2px'
      }
    }, ROLLEN_ICON[s.roleId] || '👤'),
    el('div', { style: { flex: '1 1 auto', minWidth: '0' } },
      el('div.tv-zeile', { style: { flexWrap: 'wrap', rowGap: '3px' } },
        el('b', { style: { fontSize: '14px' } }, s.name),
        pill(role.name, 'info'),
        el('span.tv-mini', null, `${s.alter} Jahre`),
        s.kurs ? pill(`Lehrgang: ${s.kurs.name}`, 'warn') : null,
        s.abwerbung ? pill('wird abgeworben', 'schlecht') : null,
        ...traitMarken(s.traits)),
      el('div.tv-mini', { style: { marginTop: '2px', whiteSpace: 'normal', lineHeight: '1.4' } },
        `Spezialisierung: ${s.spezialisierung || '–'} · Charakter: ${(s.persoenlichkeit && s.persoenlichkeit.name) || '–'}` +
        ((s.persoenlichkeit && s.persoenlichkeit.desc) ? ` (${s.persoenlichkeit.desc})` : '')),

      el('div', { style: { marginTop: '5px' } },
        messwert('Qualität', q, 99, { spalten: '112px 1fr 34px' }),
        messwert('Zufriedenheit', Math.round(s.zufriedenheit || 0), 100, {
          spalten: '112px 1fr 34px',
          klasse: (s.zufriedenheit || 0) < 35 ? 'tv-schlecht' : null,
          titel: 'Unzufriedene Mitarbeiter arbeiten schlechter und hören woanders zu.'
        })),

      el('div.tv-mini', { style: { marginTop: '4px' } },
        `Gehalt ${formatMoney(s.gehalt || 0)} im Jahr · Vertrag bis Saison ${s.vertragBis} ` +
        `(${restJahre === 0 ? 'läuft aus' : jahre(restJahre)})` +
        (s.abwerbung ? ` · ${s.abwerbung.clubName || 'Ein Konkurrent'} bietet ${formatMoney(s.abwerbung.angebot || 0)}` : '')),

      el('div.tv-subpanel', { style: { marginTop: '6px', padding: '6px' } },
        el('div.tv-subpanel__titel', null, 'Wirkung auf den Verein'),
        el('div.tv-mini', { style: { marginBottom: '4px', whiteSpace: 'normal' } }, role.wirkung || ''),
        ...beitraege),

      el('div.tv-zeile', { style: { marginTop: '6px', flexWrap: 'wrap', rowGap: '4px' } },
        button('Gehalt verhandeln', () => gehaltDialog(ctx, s), { size: 'klein' }),
        button('Weiterbildung', () => kursDialog(ctx, s), { size: 'klein', disabled: !!s.kurs }),
        button('Entlassen', () => entlassenDialog(ctx, s), { kind: 'danger', size: 'klein' }))));

  if ((s.zufriedenheit || 0) < 35) karte.style.boxShadow = 'inset 4px 0 0 var(--rot)';
  else if (s.abwerbung) karte.style.boxShadow = 'inset 4px 0 0 var(--gold)';
  return karte;
}

function panelStab(ctx, club, bericht) {
  const stab = sicher('stabVon', () => stabVon(ctx.state, club.id), []) || [];
  const sortiert = stab.slice().sort((a, b) =>
    STAFF_ROLE_IDS.indexOf(a.roleId) - STAFF_ROLE_IDS.indexOf(b.roleId));

  const kacheln = el('div.tv-grid.tv-grid--4', null,
    statBox('Mitarbeiter', String(stab.length), { sub: `${STAFF_ROLE_IDS.length} Rollen möglich` }),
    statBox('Schnittqualität', bericht ? String(bericht.schnitt) : '–', { sub: 'von 99' }),
    statBox('Gesamtwert', bericht ? String(bericht.gesamtwert) : '–', { sub: 'Bankleistung', kind: 'gut' }),
    statBox('Personalkosten', bericht ? formatMoney(bericht.kostenJahr) : '–',
      { sub: bericht ? formatMoney(bericht.kostenMonat) + ' im Monat' : '', kind: 'warn' }));

  const inhalt = sortiert.length
    ? el('div.tv-spalte', { style: { marginTop: '9px' } }, ...sortiert.map(s => stabKarte(ctx, s)))
    : el('div.tv-leer', { style: { marginTop: '9px' } },
      'Sie haben keinen einzigen Mitarbeiter. Sie machen hier alles allein, Chef. Das geht ein halbes Jahr gut.');

  return panel(kopf('Mein Stab', bericht ? bericht.bewertung : ''),
    kacheln, inhalt,
    bericht && bericht.luecken && bericht.luecken.length
      ? el('div', { style: { marginTop: '9px' } },
        subpanel(`Nicht besetzt (${bericht.luecken.length})`,
          el('div.tv-spalte', { style: { gap: '2px' } },
            ...bericht.luecken.map(t => el('div.tv-mini', { style: { whiteSpace: 'normal', lineHeight: '1.4' } }, '• ' + t)))))
      : null);
}

/* ==========================================================================
 * 2. Offene Stellen
 * ======================================================================== */

function bewerberKarte(ctx, club, roleId, k) {
  const role = STAFF_ROLES[roleId] || { name: roleId };

  return el('div.tv-stab__karte', null,
    el('div', {
      style: {
        flex: '0 0 36px', width: '36px', height: '36px', fontSize: '20px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,.12)', border: '1px solid var(--linie)', borderRadius: '2px'
      }
    }, ROLLEN_ICON[roleId] || '👤'),
    el('div', { style: { flex: '1 1 auto', minWidth: '0' } },
      el('div.tv-zeile', { style: { flexWrap: 'wrap', rowGap: '3px' } },
        el('b', null, k.name),
        el('span.tv-mini', null, `${k.alter} Jahre`),
        pill(k.spezialisierung, 'info'),
        ...traitMarken(k.traits)),
      messwert('Qualität', k.qualitaet, 99, { spalten: '92px 1fr 34px' }),
      el('div.tv-mini', { style: { marginTop: '2px' } },
        `Charakter: ${(k.persoenlichkeit && k.persoenlichkeit.name) || '–'}` +
        ((k.persoenlichkeit && k.persoenlichkeit.desc) ? ` — ${k.persoenlichkeit.desc}` : '')),
      (k.referenzen || []).length
        ? el('div.tv-spalte', { style: { gap: '1px', marginTop: '4px' } },
          ...k.referenzen.map(r => el('div.tv-mini', { style: { whiteSpace: 'normal' } }, '› ' + r)))
        : null,
      el('div.tv-zeile.tv-zeile--verteilt', { style: { marginTop: '6px' } },
        el('span.tv-mini', null,
          `Fordert ${formatMoney(k.gehaltsforderung)} im Jahr · Wunschlaufzeit ${jahre(k.vertragsWunschJahre)}`),
        button('Einstellen', async () => {
          const ok = await frage('Einstellen',
            `${k.name} als ${role.name} verpflichten? ${formatMoney(k.gehaltsforderung)} im Jahr, ` +
            `Vertrag über ${jahre(k.vertragsWunschJahre)}. Der Schatzmeister wird kurz die Augen schließen.`);
          if (!ok) return;
          const res = sicher('einstellen', () => einstellen(ctx.state, club.id, k));
          await ergebnis('Personalentscheidung', res);
          ctx.aktualisiere();
          ctx.refresh();
        }, { kind: 'primary', size: 'klein' }))));
}

function panelStellen(ctx, club) {
  const offen = STAFF_ROLE_IDS.filter(id => {
    const n = sicher('anzahlInRolle', () => anzahlInRolle(ctx.state, club.id, id), 0);
    return n < (STAFF_ROLES[id].maxAnzahl || 1);
  });

  if (!offen.length) {
    return panel('Offene Stellen',
      el('div.tv-leer', null,
        'Jede Position ist besetzt. Ein Zustand, den es in diesem Verein seit 1987 nicht gab.'));
  }

  const reiter = tabs(offen.map(id => {
    const role = STAFF_ROLES[id];
    const belegt = sicher('anzahlInRolle', () => anzahlInRolle(ctx.state, club.id, id), 0);
    return {
      id,
      label: role.name,
      badge: `${belegt}/${role.maxAnzahl}`,
      render: () => {
        const liste = sicher('bewerber', () => bewerber(ctx.state, club.id, id), []) || [];
        return el('div.tv-spalte', null,
          el('div.tv-mini', { style: { whiteSpace: 'normal', lineHeight: '1.45' } },
            el('b', null, role.name + ': '), role.desc, ' ', role.wirkung,
            ` Übliches Einstiegsgehalt in dieser Rolle: ab ${formatMoney(role.gehaltBasis)}.`),
          liste.length
            ? el('div.tv-spalte', null, ...liste.map(k => bewerberKarte(ctx, club, id, k)))
            : el('div.tv-leer', null,
              'Auf diese Ausschreibung hat sich niemand gemeldet. Bei unserem Ruf auch kein Wunder.'));
      }
    };
  }));

  return panel(kopf('Offene Stellen', offen.length === 1 ? 'eine Position unbesetzt' : `${offen.length} Positionen unbesetzt`),
    el('div.tv-mini', { style: { marginBottom: '6px' } },
      'Wer sich bewirbt, hängt am Ruf des Vereins und am Kontostand. Weltklasseleute kommen nicht zu Zweitligisten — ' +
      'außer sie haben etwas gutzumachen.'),
    reiter);
}

/* ==========================================================================
 * 3. Wirkung des Stabs
 * ======================================================================== */

function panelWirkung(ctx, club, bericht) {
  const w = (bericht && bericht.wirkung) || sicher('stabWirkung', () => stabWirkung(ctx.state, club.id));

  if (!w) {
    return stoerung('Wirkung des Stabs',
      'club/staff.js liefert keine Wirkungswerte. Ohne diese Zahlen bleibt der Bildschirm leer.');
  }

  const zeilen = WIRKUNG_FELDER.map(feld => {
    const v = w[feld] || 0;
    const urteil = v >= 78 ? pill('Spitzenwert', 'gut')
      : v >= 62 ? pill('gut', 'gut')
        : v >= 46 ? pill('Durchschnitt', 'warn')
          : pill('Schwachstelle', 'schlecht');
    return el('div', { style: { marginBottom: '7px' } },
      el('div.tv-zeile.tv-zeile--verteilt', null,
        el('b', null, WIRKUNG_NAMEN[feld] || feld),
        urteil),
      bar(v, 100, { showValue: false }),
      el('div.tv-mini', { style: { marginTop: '2px', whiteSpace: 'normal', lineHeight: '1.4' } },
        `${v} von 100 — ${WIRKUNG_ERKLAERUNG[feld] || ''}`));
  });

  const schwach = WIRKUNG_FELDER.filter(f => (w[f] || 0) < 46);

  return panel(kopf('Wirkung des Stabs', bericht ? `Gesamtwert ${bericht.gesamtwert}` : ''),
    el('div.tv-grid.tv-grid--2', null,
      el('div', null, ...zeilen.slice(0, 5)),
      el('div', null, ...zeilen.slice(5))),
    schwach.length
      ? subpanel('Wo es hakt',
        el('div.tv-mini', { style: { whiteSpace: 'normal', lineHeight: '1.45' } },
          'Unter 46 Punkten liegen: ' + schwach.map(f => WIRKUNG_NAMEN[f] || f).join(', ') +
          '. Das sind keine Nachkommastellen, das sieht man auf dem Platz.'))
      : subpanel('Bewertung',
        el('div.tv-mini', null, 'Kein Feld unter 46 Punkten. Der Stab arbeitet auf ganzer Breite.')));
}

/* ==========================================================================
 * 4. Mein Trainerprofil
 * ======================================================================== */

const SKILL_NAMEN = {
  training: 'Trainingslehre', taktik: 'Taktik', motivation: 'Motivation',
  verhandlung: 'Verhandlung', jugend: 'Nachwuchsarbeit', medien: 'Medienarbeit'
};

const SKILL_ERKLAERUNG = {
  training: 'Wie viel Ihre eigenen Einheiten bringen.',
  taktik: 'Wie präzise Ihre Vorgaben auf dem Platz ankommen.',
  motivation: 'Wirkung Ihrer Ansprachen in Kabine und Krise.',
  verhandlung: 'Ablösen, Gehälter, Berater — hier wird bares Geld gespart.',
  jugend: 'Ihr Draht zu den eigenen Talenten.',
  medien: 'Wie oft Ihnen die Presse ein Wort im Mund umdreht.'
};

function panelProfil(ctx) {
  const m = ctx.state.manager;
  if (!m) {
    return stoerung('Mein Trainerprofil', 'Im Spielstand ist kein Trainerprofil hinterlegt (state.manager fehlt).');
  }

  const b = m.bilanz || { spiele: 0, siege: 0, unentschieden: 0, niederlagen: 0, tore: 0, gegentore: 0 };
  const punkte = b.siege * 3 + b.unentschieden;
  const schnitt = b.spiele ? (punkte / b.spiele) : 0;
  const siegquote = b.spiele ? Math.round((b.siege / b.spiele) * 100) : 0;

  const bild = sicher('managerPortrait',
    () => portraitDataURL({ appearance: m.appearance, age: m.age, era: 'modern' }, 128), '');

  const skills = m.skills || {};
  const skillZeilen = Object.keys(SKILL_NAMEN)
    .filter(k => skills[k] !== undefined)
    .map(k => messwert(SKILL_NAMEN[k], skills[k], 100, {
      spalten: '118px 1fr 34px', titel: SKILL_ERKLAERUNG[k] || ''
    }));

  const titel = Array.isArray(m.titel) ? m.titel : [];
  const karriere = Array.isArray(m.karriere) ? m.karriere : [];

  const p = panel(kopf('Mein Trainerprofil', m.lizenz || ''),
    el('div.tv-spielerkarte', null,
      el('div.tv-spielerkarte__kopf', null,
        bild
          ? el('img.tv-portrait.tv-portrait--gross', {
            src: bild, alt: '', style: { width: '72px', height: '72px', flex: '0 0 72px' }
          })
          : el('div.tv-portrait.tv-portrait--gross', { style: { width: '72px', height: '72px', flex: '0 0 72px' } }),
        el('div', { style: { minWidth: '0' } },
          el('div.tv-spielerkarte__name', null, m.name || 'Namenloser Trainer'),
          el('div.tv-spielerkarte__meta', null,
            `${m.age || '?'} Jahre · ${m.nationality || 'DE'} · ${m.lizenz || 'ohne Lizenz'}`),
          el('div.tv-zeile', { style: { marginTop: '4px', flexWrap: 'wrap', rowGap: '3px' } },
            pill(`Level ${m.level || 1}`, 'gold'),
            pill(`Ruf ${m.reputation || 0}`, 'info'),
            pill(`${m.erfahrung || 0} Erfahrung`, 'neutral'))))),

    el('div.tv-grid.tv-grid--4', { style: { marginTop: '9px' } },
      statBox('Spiele', String(b.spiele || 0), { sub: `${b.siege}S / ${b.unentschieden}U / ${b.niederlagen}N` }),
      statBox('Punkteschnitt', schnitt.toFixed(2).replace('.', ','), { sub: 'pro Spiel', kind: schnitt >= 1.7 ? 'gut' : schnitt < 1.1 ? 'schlecht' : undefined }),
      statBox('Siegquote', siegquote + ' %', { sub: 'seit Amtsantritt' }),
      statBox('Tore', `${b.tore || 0}:${b.gegentore || 0}`, { sub: 'erzielt zu kassiert' })),

    el('div', { style: { marginTop: '9px' } },
      el('div.tv-subpanel__titel', null, 'Fähigkeiten'),
      ...(skillZeilen.length ? skillZeilen : [el('div.tv-mini', null, 'Keine Fähigkeitswerte hinterlegt.')])),

    el('div.tv-grid.tv-grid--2', { style: { marginTop: '9px' } },
      subpanel(`Titel (${titel.length})`,
        titel.length
          ? el('div.tv-zeile', { style: { flexWrap: 'wrap', rowGap: '4px' } },
            ...titel.map(t => pill(typeof t === 'string' ? t : (t.name || 'Titel'), 'gold')))
          : el('div.tv-mini', null, 'Noch keine Titel. Die Vitrine im Foyer wartet geduldig.')),
      subpanel(`Stationen (${karriere.length})`,
        karriere.length
          ? el('div.tv-spalte', { style: { gap: '2px' } },
            ...karriere.map(k => el('div.tv-mini', null,
              typeof k === 'string' ? k
                : `${k.clubName || k.clubId || 'Verein'} · Saison ${k.von || '?'}–${k.bis || 'heute'}`)))
          : el('div.tv-mini', null, 'Erste Station. Von hier aus kann es nur bergauf oder sehr schnell bergab gehen.'))));

  p.classList.add('tv-panel--gold');
  return p;
}

/* ==========================================================================
 * Bildschirm
 * ======================================================================== */

export const screen = {
  id: 'stab',
  title: 'Trainerstab',
  icon: '🎓',

  async render(root, ctx) {
    const state = ctx.state;
    const club = state.clubs[state.managerClubId];

    if (!club) {
      root.appendChild(stoerung('Trainerstab', 'Kein Verein im Spielstand gefunden.'));
      return;
    }

    const bericht = sicher('stabBericht', () => stabBericht(state, club.id));

    const seite = el('div.tv-seite', null,
      el('div.tv-seite__kopf', null,
        el('h1.tv-seite__titel', null, 'Trainerstab'),
        el('div.tv-seite__unter', null,
          'Man sieht sie nie im Fernsehen. Man merkt sie in jeder einzelnen Statistik.')));

    seite.appendChild(el('div.tv-grid.tv-grid--haupt', null,
      panelStab(ctx, club, bericht),
      el('div.tv-spalte', null,
        panelWirkung(ctx, club, bericht),
        panelProfil(ctx))));

    seite.appendChild(panelStellen(ctx, club));

    root.appendChild(seite);
  }
};

export default screen;
