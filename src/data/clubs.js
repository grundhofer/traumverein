/**
 * Stammdaten aller 36 Vereine (18 × 1. Bundesliga, 18 × 2. Bundesliga).
 *
 * Vertrag: docs/CONTRACTS.md, Abschnitt 5.2 (Club).
 * Reine Daten – keine Laufzeitfelder, keine DOM-Zugriffe, kein Zufall.
 *
 * Die Zahlen bilden bewusst eine wirtschaftliche Hackordnung ab:
 * `reputation`, `finances.balance`, `fanbase.members` und `stadium.capacity`
 * hängen zusammen. Zweitliga-Traditionsvereine (Schalke, Hertha, Kaiserslautern,
 * Hannover, Dynamo Dresden) haben absichtlich eine große Fanbase und ein hohes
 * `fanbase.potential` bei nur mittlerer `reputation` – das erzeugt Druck von den
 * Rängen, ohne dass der Kader das hergibt.
 *
 * `stadium.standing` = Anteil Stehplätze (0 … 0.35, vertraglich gedeckelt).
 * `finances.ticketBase` = Basispreis Sitzplatz in Euro.
 */

export const CLUBS = [

  // ────────────────────────────────────────────────────────────────────────
  // 1. BUNDESLIGA
  // ────────────────────────────────────────────────────────────────────────

  {
    id: 'bayern',
    name: 'FC Bayern München',
    shortName: 'Bayern',
    abbr: 'FCB',
    city: 'München',
    founded: 1900,
    colors: { primary: '#dc052d', secondary: '#ffffff', accent: '#0066b2' },
    kit: { pattern: 'plain', shorts: '#dc052d', socks: '#dc052d' },
    awayKit: { primary: '#ffffff', secondary: '#dc052d', pattern: 'plain' },
    crest: { shape: 'round', motif: 'star', bg: '#dc052d', fg: '#ffffff' },
    stadium: { name: 'Allianz Arena', capacity: 75024, standing: 0.18, roof: true, floodlight: 5, pitch: 95, tiers: 3 },
    reputation: 95,
    finances: { balance: 80000000, debt: 0, ticketBase: 42 },
    fanbase: { members: 380000, ultras: 68, mood: 74, potential: 98 },
    facilities: { training: 95, medical: 94, youth: 88, scouting: 92 },
    boardName: 'Herbert Hainer',
    leagueId: 'bl1',
    history: {
      titles: 34,
      lastTitle: 2025,
      honours: [
        '34× Deutscher Meister',
        '20× DFB-Pokalsieger',
        '6× Sieger im Europapokal der Landesmeister bzw. der Champions League',
        'Weltpokalsieger 1976, 2001, 2013 und 2020'
      ]
    }
  },

  {
    id: 'dortmund',
    name: 'Borussia Dortmund',
    shortName: 'Dortmund',
    abbr: 'BVB',
    city: 'Dortmund',
    founded: 1909,
    colors: { primary: '#fde100', secondary: '#000000', accent: '#ffffff' },
    kit: { pattern: 'plain', shorts: '#000000', socks: '#fde100' },
    awayKit: { primary: '#000000', secondary: '#fde100', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#fde100', fg: '#000000' },
    stadium: { name: 'Westfalenstadion', capacity: 81365, standing: 0.31, roof: true, floodlight: 5, pitch: 92, tiers: 2 },
    reputation: 88,
    finances: { balance: 38000000, debt: 12000000, ticketBase: 34 },
    fanbase: { members: 200000, ultras: 88, mood: 72, potential: 94 },
    facilities: { training: 88, medical: 86, youth: 85, scouting: 83 },
    boardName: 'Hans-Joachim Watzke',
    leagueId: 'bl1',
    history: {
      titles: 8,
      lastTitle: 2012,
      honours: [
        '8× Deutscher Meister',
        '5× DFB-Pokalsieger',
        'Champions-League-Sieger 1997',
        'Europapokalsieger der Pokalsieger 1966',
        'Die Gelbe Wand – größte Stehplatztribüne Europas'
      ]
    }
  },

  {
    id: 'leverkusen',
    name: 'Bayer 04 Leverkusen',
    shortName: 'Leverkusen',
    abbr: 'B04',
    city: 'Leverkusen',
    founded: 1904,
    colors: { primary: '#e32221', secondary: '#000000', accent: '#ffffff' },
    kit: { pattern: 'halves', shorts: '#000000', socks: '#e32221' },
    awayKit: { primary: '#000000', secondary: '#e32221', pattern: 'plain' },
    crest: { shape: 'shield', motif: 'letters', bg: '#e32221', fg: '#000000' },
    stadium: { name: 'BayArena', capacity: 30210, standing: 0.20, roof: true, floodlight: 5, pitch: 94, tiers: 2 },
    reputation: 84,
    finances: { balance: 30000000, debt: 0, ticketBase: 30 },
    fanbase: { members: 26000, ultras: 44, mood: 78, potential: 66 },
    facilities: { training: 90, medical: 91, youth: 80, scouting: 85 },
    boardName: 'Fernando Carro',
    leagueId: 'bl1',
    history: {
      titles: 1,
      lastTitle: 2024,
      honours: [
        'Deutscher Meister 2024',
        '2× DFB-Pokalsieger',
        'UEFA-Pokal-Sieger 1988',
        'Champions-League-Finalist 2002'
      ]
    }
  },

  {
    id: 'leipzig',
    name: 'RB Leipzig',
    shortName: 'Leipzig',
    abbr: 'RBL',
    city: 'Leipzig',
    founded: 2009,
    colors: { primary: '#ffffff', secondary: '#dd0741', accent: '#001f47' },
    kit: { pattern: 'plain', shorts: '#dd0741', socks: '#ffffff' },
    awayKit: { primary: '#001f47', secondary: '#dd0741', pattern: 'plain' },
    crest: { shape: 'shield', motif: 'bull', bg: '#ffffff', fg: '#dd0741' },
    stadium: { name: 'Red Bull Arena', capacity: 47069, standing: 0.18, roof: true, floodlight: 5, pitch: 93, tiers: 2 },
    reputation: 82,
    finances: { balance: 42000000, debt: 0, ticketBase: 28 },
    fanbase: { members: 24000, ultras: 36, mood: 68, potential: 72 },
    facilities: { training: 92, medical: 89, youth: 86, scouting: 94 },
    boardName: 'Oliver Mintzlaff',
    leagueId: 'bl1',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        '2× DFB-Pokalsieger',
        'Deutscher Vizemeister 2017 und 2021',
        'Champions-League-Halbfinale 2020',
        'Vier Aufstiege in sieben Jahren'
      ]
    }
  },

  {
    id: 'frankfurt',
    name: 'Eintracht Frankfurt',
    shortName: 'Eintracht',
    abbr: 'SGE',
    city: 'Frankfurt am Main',
    founded: 1899,
    colors: { primary: '#000000', secondary: '#e1000f', accent: '#ffffff' },
    kit: { pattern: 'plain', shorts: '#000000', socks: '#000000' },
    awayKit: { primary: '#ffffff', secondary: '#e1000f', pattern: 'plain' },
    crest: { shape: 'round', motif: 'eagle', bg: '#000000', fg: '#ffffff' },
    stadium: { name: 'Waldstadion', capacity: 58000, standing: 0.16, roof: true, floodlight: 5, pitch: 90, tiers: 3 },
    reputation: 78,
    finances: { balance: 26000000, debt: 3000000, ticketBase: 29 },
    fanbase: { members: 145000, ultras: 84, mood: 74, potential: 86 },
    facilities: { training: 81, medical: 80, youth: 76, scouting: 83 },
    boardName: 'Axel Hellmann',
    leagueId: 'bl1',
    history: {
      titles: 1,
      lastTitle: 1959,
      honours: [
        'Deutscher Meister 1959',
        '5× DFB-Pokalsieger',
        'UEFA-Pokal-Sieger 1980',
        'Europa-League-Sieger 2022'
      ]
    }
  },

  {
    id: 'stuttgart',
    name: 'VfB Stuttgart',
    shortName: 'Stuttgart',
    abbr: 'VFB',
    city: 'Stuttgart',
    founded: 1893,
    colors: { primary: '#ffffff', secondary: '#e32219', accent: '#000000' },
    kit: { pattern: 'chest', shorts: '#ffffff', socks: '#ffffff' },
    awayKit: { primary: '#e32219', secondary: '#ffffff', pattern: 'plain' },
    crest: { shape: 'round', motif: 'horse', bg: '#ffffff', fg: '#e32219' },
    stadium: { name: 'Neckarstadion', capacity: 60449, standing: 0.25, roof: true, floodlight: 4, pitch: 90, tiers: 3 },
    reputation: 76,
    finances: { balance: 18000000, debt: 6000000, ticketBase: 27 },
    fanbase: { members: 105000, ultras: 70, mood: 72, potential: 84 },
    facilities: { training: 80, medical: 79, youth: 83, scouting: 74 },
    boardName: 'Alexander Wehrle',
    leagueId: 'bl1',
    history: {
      titles: 5,
      lastTitle: 2007,
      honours: [
        '5× Deutscher Meister',
        '4× DFB-Pokalsieger',
        'Der berühmte Brustring seit 1949',
        'Meisterschaft 2007 mit den „jungen Wilden“'
      ]
    }
  },

  {
    id: 'gladbach',
    name: 'Borussia Mönchengladbach',
    shortName: 'Gladbach',
    abbr: 'BMG',
    city: 'Mönchengladbach',
    founded: 1900,
    colors: { primary: '#ffffff', secondary: '#000000', accent: '#00a94f' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#ffffff' },
    awayKit: { primary: '#00a94f', secondary: '#ffffff', pattern: 'plain' },
    crest: { shape: 'diamond', motif: 'letters', bg: '#ffffff', fg: '#00a94f' },
    stadium: { name: 'Borussia-Park', capacity: 54042, standing: 0.30, roof: true, floodlight: 4, pitch: 90, tiers: 2 },
    reputation: 72,
    finances: { balance: 12000000, debt: 4000000, ticketBase: 26 },
    fanbase: { members: 105000, ultras: 60, mood: 62, potential: 80 },
    facilities: { training: 82, medical: 80, youth: 84, scouting: 76 },
    boardName: 'Rainer Bonhof',
    leagueId: 'bl1',
    history: {
      titles: 5,
      lastTitle: 1977,
      honours: [
        '5× Deutscher Meister',
        '3× DFB-Pokalsieger',
        '2× UEFA-Pokal-Sieger',
        'Die Fohlenelf der 70er Jahre'
      ]
    }
  },

  {
    id: 'bremen',
    name: 'SV Werder Bremen',
    shortName: 'Werder',
    abbr: 'SVW',
    city: 'Bremen',
    founded: 1899,
    colors: { primary: '#1d9053', secondary: '#ffffff', accent: '#000000' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#1d9053' },
    awayKit: { primary: '#ffffff', secondary: '#1d9053', pattern: 'plain' },
    crest: { shape: 'diamond', motif: 'letters', bg: '#1d9053', fg: '#ffffff' },
    stadium: { name: 'Weserstadion', capacity: 42100, standing: 0.30, roof: true, floodlight: 4, pitch: 88, tiers: 2 },
    reputation: 70,
    finances: { balance: 6000000, debt: 14000000, ticketBase: 24 },
    fanbase: { members: 42000, ultras: 66, mood: 64, potential: 78 },
    facilities: { training: 72, medical: 75, youth: 78, scouting: 68 },
    boardName: 'Klaus Filbry',
    leagueId: 'bl1',
    history: {
      titles: 4,
      lastTitle: 2004,
      honours: [
        '4× Deutscher Meister',
        '6× DFB-Pokalsieger',
        'Europapokalsieger der Pokalsieger 1992',
        'Double 2004 unter Thomas Schaaf'
      ]
    }
  },

  {
    id: 'hsv',
    name: 'Hamburger SV',
    shortName: 'HSV',
    abbr: 'HSV',
    city: 'Hamburg',
    founded: 1887,
    colors: { primary: '#ffffff', secondary: '#0a3e7d', accent: '#e2001a' },
    kit: { pattern: 'plain', shorts: '#e2001a', socks: '#0a3e7d' },
    awayKit: { primary: '#0a3e7d', secondary: '#ffffff', pattern: 'plain' },
    crest: { shape: 'diamond', motif: 'letters', bg: '#0a3e7d', fg: '#ffffff' },
    stadium: { name: 'Volksparkstadion', capacity: 57000, standing: 0.17, roof: true, floodlight: 4, pitch: 88, tiers: 3 },
    reputation: 68,
    finances: { balance: 9000000, debt: 18000000, ticketBase: 25 },
    fanbase: { members: 96000, ultras: 78, mood: 76, potential: 92 },
    facilities: { training: 78, medical: 77, youth: 80, scouting: 70 },
    boardName: 'Stefan Kuntz',
    leagueId: 'bl1',
    history: {
      titles: 6,
      lastTitle: 1983,
      honours: [
        '6× Deutscher Meister',
        '3× DFB-Pokalsieger',
        'Europapokalsieger der Landesmeister 1983',
        'Europapokalsieger der Pokalsieger 1977',
        'Die Stadionuhr – 55 Jahre ununterbrochen erstklassig'
      ]
    }
  },

  {
    id: 'koeln',
    name: '1. FC Köln',
    shortName: 'Köln',
    abbr: 'KOE',
    city: 'Köln',
    founded: 1948,
    colors: { primary: '#ffffff', secondary: '#e2001a', accent: '#000000' },
    kit: { pattern: 'plain', shorts: '#e2001a', socks: '#ffffff' },
    awayKit: { primary: '#e2001a', secondary: '#ffffff', pattern: 'plain' },
    crest: { shape: 'shield', motif: 'goat', bg: '#ffffff', fg: '#e2001a' },
    stadium: { name: 'Müngersdorfer Stadion', capacity: 50000, standing: 0.16, roof: true, floodlight: 4, pitch: 88, tiers: 2 },
    reputation: 66,
    finances: { balance: 7000000, debt: 9000000, ticketBase: 24 },
    fanbase: { members: 165000, ultras: 76, mood: 70, potential: 90 },
    facilities: { training: 74, medical: 75, youth: 81, scouting: 68 },
    boardName: 'Werner Wolf',
    leagueId: 'bl1',
    history: {
      titles: 3,
      lastTitle: 1978,
      honours: [
        '3× Deutscher Meister',
        'Erster Bundesliga-Meister 1964',
        '4× DFB-Pokalsieger',
        'Double 1978',
        'Geißbock Hennes als lebendes Maskottchen seit 1950'
      ]
    }
  },

  {
    id: 'wolfsburg',
    name: 'VfL Wolfsburg',
    shortName: 'Wolfsburg',
    abbr: 'WOB',
    city: 'Wolfsburg',
    founded: 1945,
    colors: { primary: '#65b32e', secondary: '#ffffff', accent: '#00964b' },
    kit: { pattern: 'plain', shorts: '#65b32e', socks: '#65b32e' },
    awayKit: { primary: '#ffffff', secondary: '#65b32e', pattern: 'plain' },
    crest: { shape: 'round', motif: 'wheel', bg: '#65b32e', fg: '#ffffff' },
    stadium: { name: 'Volkswagen Arena', capacity: 30000, standing: 0.15, roof: true, floodlight: 4, pitch: 92, tiers: 2 },
    reputation: 70,
    finances: { balance: 24000000, debt: 0, ticketBase: 22 },
    fanbase: { members: 22000, ultras: 28, mood: 58, potential: 52 },
    facilities: { training: 86, medical: 85, youth: 78, scouting: 76 },
    boardName: 'Michael Meeske',
    leagueId: 'bl1',
    history: {
      titles: 1,
      lastTitle: 2009,
      honours: [
        'Deutscher Meister 2009',
        'DFB-Pokalsieger 2015',
        'DFL-Supercup-Sieger 2015',
        'Torrekord der Meistersaison: Grafite und Džeko mit 54 Treffern'
      ]
    }
  },

  {
    id: 'hoffenheim',
    name: 'TSG 1899 Hoffenheim',
    shortName: 'Hoffenheim',
    abbr: 'TSG',
    city: 'Sinsheim',
    founded: 1899,
    colors: { primary: '#1961b5', secondary: '#ffffff', accent: '#003a70' },
    kit: { pattern: 'plain', shorts: '#1961b5', socks: '#1961b5' },
    awayKit: { primary: '#ffffff', secondary: '#1961b5', pattern: 'plain' },
    crest: { shape: 'shield', motif: 'letters', bg: '#1961b5', fg: '#ffffff' },
    stadium: { name: 'Rhein-Neckar-Arena', capacity: 30150, standing: 0.21, roof: true, floodlight: 4, pitch: 92, tiers: 2 },
    reputation: 64,
    finances: { balance: 20000000, debt: 0, ticketBase: 21 },
    fanbase: { members: 12000, ultras: 24, mood: 58, potential: 48 },
    facilities: { training: 90, medical: 88, youth: 89, scouting: 82 },
    boardName: 'Dietmar Hopp',
    leagueId: 'bl1',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'Herbstmeister 2008 als Aufsteiger',
        'Champions-League-Teilnehmer 2018/19',
        'Vom Kreisligisten in 18 Jahren in die Bundesliga',
        'Eine der besten Nachwuchsakademien Deutschlands'
      ]
    }
  },

  {
    id: 'freiburg',
    name: 'SC Freiburg',
    shortName: 'Freiburg',
    abbr: 'SCF',
    city: 'Freiburg im Breisgau',
    founded: 1904,
    colors: { primary: '#e2001a', secondary: '#ffffff', accent: '#000000' },
    kit: { pattern: 'stripes', shorts: '#000000', socks: '#e2001a' },
    awayKit: { primary: '#ffffff', secondary: '#e2001a', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#e2001a', fg: '#ffffff' },
    stadium: { name: 'Europa-Park Stadion', capacity: 34700, standing: 0.29, roof: true, floodlight: 4, pitch: 90, tiers: 2 },
    reputation: 68,
    finances: { balance: 16000000, debt: 0, ticketBase: 22 },
    fanbase: { members: 60000, ultras: 40, mood: 76, potential: 62 },
    facilities: { training: 79, medical: 80, youth: 93, scouting: 85 },
    boardName: 'Jochen Saier',
    leagueId: 'bl1',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'DFB-Pokal-Finalist 2022',
        '2× Zweitliga-Meister',
        'Volker Finke – 16 Jahre Cheftrainer',
        'Legendäre Jugendarbeit im Breisgau'
      ]
    }
  },

  {
    id: 'mainz',
    name: '1. FSV Mainz 05',
    shortName: 'Mainz',
    abbr: 'M05',
    city: 'Mainz',
    founded: 1905,
    colors: { primary: '#c3141e', secondary: '#ffffff', accent: '#000000' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#c3141e' },
    awayKit: { primary: '#ffffff', secondary: '#c3141e', pattern: 'plain' },
    crest: { shape: 'shield', motif: 'letters', bg: '#c3141e', fg: '#ffffff' },
    stadium: { name: 'Mewa Arena', capacity: 33305, standing: 0.28, roof: true, floodlight: 4, pitch: 88, tiers: 2 },
    reputation: 62,
    finances: { balance: 9000000, debt: 2000000, ticketBase: 21 },
    fanbase: { members: 25000, ultras: 42, mood: 70, potential: 56 },
    facilities: { training: 75, medical: 74, youth: 79, scouting: 75 },
    boardName: 'Stefan Hofmann',
    leagueId: 'bl1',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'Karnevalsverein und Bundesliga-Dauerbrenner',
        'Erstmals aufgestiegen 2004 unter Jürgen Klopp',
        'Trainerschmiede: Klopp, Tuchel, Nagelsmann-Schule',
        'Bundesliga-Bestplatzierung: Rang 5 in der Saison 2023/24'
      ]
    }
  },

  {
    id: 'augsburg',
    name: 'FC Augsburg',
    shortName: 'Augsburg',
    abbr: 'FCA',
    city: 'Augsburg',
    founded: 1907,
    colors: { primary: '#ba3733', secondary: '#46714d', accent: '#ffffff' },
    kit: { pattern: 'stripes', shorts: '#ffffff', socks: '#ba3733' },
    awayKit: { primary: '#46714d', secondary: '#ffffff', pattern: 'plain' },
    crest: { shape: 'shield', motif: 'letters', bg: '#ba3733', fg: '#46714d' },
    stadium: { name: 'WWK Arena', capacity: 30660, standing: 0.30, roof: true, floodlight: 4, pitch: 88, tiers: 2 },
    reputation: 58,
    finances: { balance: 8000000, debt: 3000000, ticketBase: 20 },
    fanbase: { members: 22000, ultras: 34, mood: 62, potential: 52 },
    facilities: { training: 70, medical: 72, youth: 68, scouting: 64 },
    boardName: 'Michael Ströll',
    leagueId: 'bl1',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'Erstmals Bundesliga 2011',
        'Europa-League-Teilnehmer 2015/16',
        'Erstes reines Fußballstadion mit Erdwärmeheizung',
        'Der ewige Klassenerhalt aus Schwaben'
      ]
    }
  },

  {
    id: 'union',
    name: '1. FC Union Berlin',
    shortName: 'Union',
    abbr: 'FCU',
    city: 'Berlin',
    founded: 1966,
    colors: { primary: '#eb1923', secondary: '#ffffff', accent: '#f2b100' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#eb1923' },
    awayKit: { primary: '#ffffff', secondary: '#eb1923', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#eb1923', fg: '#ffffff' },
    stadium: { name: 'Stadion An der Alten Försterei', capacity: 22012, standing: 0.35, roof: true, floodlight: 3, pitch: 86, tiers: 1 },
    reputation: 60,
    finances: { balance: 11000000, debt: 0, ticketBase: 20 },
    fanbase: { members: 63000, ultras: 74, mood: 74, potential: 60 },
    facilities: { training: 66, medical: 70, youth: 62, scouting: 68 },
    boardName: 'Dirk Zingler',
    leagueId: 'bl1',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'FDGB-Pokalsieger 1968',
        'DFB-Pokal-Finalist 2001',
        'Champions-League-Teilnehmer 2023/24',
        'Stadionumbau 2008 in Eigenleistung durch die Fans',
        'Weihnachtssingen an der Alten Försterei'
      ]
    }
  },

  {
    id: 'stpauli',
    name: 'FC St. Pauli',
    shortName: 'St. Pauli',
    abbr: 'STP',
    city: 'Hamburg',
    founded: 1910,
    colors: { primary: '#61361e', secondary: '#ffffff', accent: '#e2001a' },
    kit: { pattern: 'plain', shorts: '#61361e', socks: '#61361e' },
    awayKit: { primary: '#ffffff', secondary: '#61361e', pattern: 'plain' },
    crest: { shape: 'round', motif: 'anchor', bg: '#61361e', fg: '#ffffff' },
    stadium: { name: 'Millerntor-Stadion', capacity: 29546, standing: 0.33, roof: true, floodlight: 3, pitch: 86, tiers: 2 },
    reputation: 56,
    finances: { balance: 5000000, debt: 4000000, ticketBase: 19 },
    fanbase: { members: 45000, ultras: 92, mood: 78, potential: 70 },
    facilities: { training: 64, medical: 68, youth: 64, scouting: 62 },
    boardName: 'Oke Göttlich',
    leagueId: 'bl1',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'Weltpokalsiegerbesieger 2002',
        'Kultklub vom Kiez mit weltweiter Anhängerschaft',
        'Vier Aufstiege in die Bundesliga',
        'Ausverkauftes Millerntor seit Jahren'
      ]
    }
  },

  {
    id: 'heidenheim',
    name: '1. FC Heidenheim 1846',
    shortName: 'Heidenheim',
    abbr: 'FCH',
    city: 'Heidenheim an der Brenz',
    founded: 1846,
    colors: { primary: '#e30613', secondary: '#0d3c78', accent: '#ffffff' },
    kit: { pattern: 'plain', shorts: '#0d3c78', socks: '#e30613' },
    awayKit: { primary: '#ffffff', secondary: '#e30613', pattern: 'plain' },
    crest: { shape: 'shield', motif: 'letters', bg: '#e30613', fg: '#0d3c78' },
    stadium: { name: 'Voith-Arena', capacity: 15000, standing: 0.32, roof: false, floodlight: 3, pitch: 84, tiers: 1 },
    reputation: 52,
    finances: { balance: 3500000, debt: 1000000, ticketBase: 18 },
    fanbase: { members: 5500, ultras: 22, mood: 76, potential: 34 },
    facilities: { training: 58, medical: 62, youth: 56, scouting: 54 },
    boardName: 'Holger Sanwald',
    leagueId: 'bl1',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'Aufstieg in die Bundesliga 2023',
        'Conference-League-Teilnehmer 2024/25',
        'Frank Schmidt – dienstältester Trainer des deutschen Profifußballs',
        'Vom Landesligisten zum Bundesligisten in 16 Jahren'
      ]
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  // 2. BUNDESLIGA
  // ────────────────────────────────────────────────────────────────────────

  {
    id: 'schalke',
    name: 'FC Schalke 04',
    shortName: 'Schalke',
    abbr: 'S04',
    city: 'Gelsenkirchen',
    founded: 1904,
    colors: { primary: '#004d9d', secondary: '#ffffff', accent: '#009fe3' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#004d9d' },
    awayKit: { primary: '#ffffff', secondary: '#004d9d', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#004d9d', fg: '#ffffff' },
    stadium: { name: 'Veltins-Arena', capacity: 62271, standing: 0.26, roof: true, floodlight: 5, pitch: 90, tiers: 3 },
    reputation: 64,
    finances: { balance: 2000000, debt: 95000000, ticketBase: 22 },
    fanbase: { members: 175000, ultras: 86, mood: 56, potential: 94 },
    facilities: { training: 80, medical: 78, youth: 87, scouting: 70 },
    boardName: 'Matthias Tillmann',
    leagueId: 'bl2',
    history: {
      titles: 7,
      lastTitle: 1958,
      honours: [
        '7× Deutscher Meister',
        '5× DFB-Pokalsieger',
        'UEFA-Pokal-Sieger 1997 – die Eurofighter',
        'Der legendäre Schalker Kreisel',
        'Knappenschmiede: Neuer, Özil, Draxler, Sané'
      ]
    }
  },

  {
    id: 'hertha',
    name: 'Hertha BSC',
    shortName: 'Hertha',
    abbr: 'BSC',
    city: 'Berlin',
    founded: 1892,
    colors: { primary: '#005ca9', secondary: '#ffffff', accent: '#003a70' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#005ca9' },
    awayKit: { primary: '#ffffff', secondary: '#005ca9', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#005ca9', fg: '#ffffff' },
    stadium: { name: 'Olympiastadion', capacity: 74667, standing: 0.14, roof: true, floodlight: 4, pitch: 86, tiers: 2 },
    reputation: 60,
    finances: { balance: 1500000, debt: 78000000, ticketBase: 21 },
    fanbase: { members: 45000, ultras: 62, mood: 52, potential: 84 },
    facilities: { training: 76, medical: 75, youth: 79, scouting: 66 },
    boardName: 'Tom Herrich',
    leagueId: 'bl2',
    history: {
      titles: 2,
      lastTitle: 1931,
      honours: [
        '2× Deutscher Meister (1930, 1931)',
        '2× DFB-Pokal-Finalist',
        'Die alte Dame aus Charlottenburg',
        'Größtes Stadion des deutschen Vereinsfußballs'
      ]
    }
  },

  {
    id: 'duesseldorf',
    name: 'Fortuna Düsseldorf',
    shortName: 'Fortuna',
    abbr: 'F95',
    city: 'Düsseldorf',
    founded: 1895,
    colors: { primary: '#e2001a', secondary: '#ffffff', accent: '#000000' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#e2001a' },
    awayKit: { primary: '#ffffff', secondary: '#e2001a', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#e2001a', fg: '#ffffff' },
    stadium: { name: 'Merkur Spiel-Arena', capacity: 54600, standing: 0.24, roof: true, floodlight: 4, pitch: 88, tiers: 3 },
    reputation: 54,
    finances: { balance: 5000000, debt: 8000000, ticketBase: 19 },
    fanbase: { members: 25000, ultras: 48, mood: 62, potential: 72 },
    facilities: { training: 70, medical: 71, youth: 70, scouting: 62 },
    boardName: 'Alexander Jobst',
    leagueId: 'bl2',
    history: {
      titles: 1,
      lastTitle: 1933,
      honours: [
        'Deutscher Meister 1933',
        '2× DFB-Pokalsieger',
        'Europapokal-Finalist der Pokalsieger 1979',
        'Rekord: 1978/79 zwölf Bundesligaspiele in Folge ungeschlagen zu Hause'
      ]
    }
  },

  {
    id: 'hannover',
    name: 'Hannover 96',
    shortName: 'Hannover',
    abbr: 'H96',
    city: 'Hannover',
    founded: 1896,
    colors: { primary: '#00954c', secondary: '#000000', accent: '#ffffff' },
    kit: { pattern: 'plain', shorts: '#000000', socks: '#00954c' },
    awayKit: { primary: '#ffffff', secondary: '#00954c', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#00954c', fg: '#000000' },
    stadium: { name: 'Niedersachsenstadion', capacity: 49000, standing: 0.25, roof: true, floodlight: 4, pitch: 88, tiers: 2 },
    reputation: 55,
    finances: { balance: 4000000, debt: 12000000, ticketBase: 19 },
    fanbase: { members: 22000, ultras: 56, mood: 58, potential: 74 },
    facilities: { training: 70, medical: 71, youth: 72, scouting: 62 },
    boardName: 'Martin Kind',
    leagueId: 'bl2',
    history: {
      titles: 2,
      lastTitle: 1954,
      honours: [
        '2× Deutscher Meister (1938, 1954)',
        'DFB-Pokalsieger 1992 als Zweitligist',
        'Europa-League-Teilnehmer 2011/12',
        'Die Roten von der Leine'
      ]
    }
  },

  {
    id: 'kaiserslautern',
    name: '1. FC Kaiserslautern',
    shortName: 'Lautern',
    abbr: 'FCK',
    city: 'Kaiserslautern',
    founded: 1900,
    colors: { primary: '#e2001a', secondary: '#ffffff', accent: '#000000' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#e2001a' },
    awayKit: { primary: '#ffffff', secondary: '#e2001a', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#e2001a', fg: '#ffffff' },
    stadium: { name: 'Fritz-Walter-Stadion', capacity: 49780, standing: 0.30, roof: true, floodlight: 4, pitch: 86, tiers: 3 },
    reputation: 54,
    finances: { balance: 2500000, debt: 22000000, ticketBase: 18 },
    fanbase: { members: 22000, ultras: 76, mood: 64, potential: 80 },
    facilities: { training: 62, medical: 66, youth: 72, scouting: 58 },
    boardName: 'Thomas Hengen',
    leagueId: 'bl2',
    history: {
      titles: 4,
      lastTitle: 1998,
      honours: [
        '4× Deutscher Meister',
        '2× DFB-Pokalsieger',
        'Einmalig: Meister 1998 direkt als Aufsteiger',
        'Der Betzenberg – die steilste Festung der Liga',
        'Heimat der Walter-Brüder'
      ]
    }
  },

  {
    id: 'nuernberg',
    name: '1. FC Nürnberg',
    shortName: 'Nürnberg',
    abbr: 'FCN',
    city: 'Nürnberg',
    founded: 1900,
    colors: { primary: '#ad1732', secondary: '#ffffff', accent: '#000000' },
    kit: { pattern: 'plain', shorts: '#000000', socks: '#ad1732' },
    awayKit: { primary: '#ffffff', secondary: '#ad1732', pattern: 'plain' },
    crest: { shape: 'round', motif: 'eagle', bg: '#ad1732', fg: '#ffffff' },
    stadium: { name: 'Max-Morlock-Stadion', capacity: 50000, standing: 0.26, roof: true, floodlight: 4, pitch: 86, tiers: 2 },
    reputation: 53,
    finances: { balance: 3500000, debt: 6000000, ticketBase: 18 },
    fanbase: { members: 24000, ultras: 58, mood: 60, potential: 72 },
    facilities: { training: 64, medical: 66, youth: 70, scouting: 58 },
    boardName: 'Niels Rossow',
    leagueId: 'bl2',
    history: {
      titles: 9,
      lastTitle: 1968,
      honours: [
        '9× Deutscher Meister – Rekordmeister vor der Bundesliga',
        '4× DFB-Pokalsieger',
        'Der Club: einziger Meister, der direkt danach abstieg (1969)',
        'Max Morlock – Weltmeister von 1954'
      ]
    }
  },

  {
    id: 'ksc',
    name: 'Karlsruher SC',
    shortName: 'Karlsruhe',
    abbr: 'KSC',
    city: 'Karlsruhe',
    founded: 1894,
    colors: { primary: '#0f4c91', secondary: '#ffffff', accent: '#e2001a' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#0f4c91' },
    awayKit: { primary: '#ffffff', secondary: '#0f4c91', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#0f4c91', fg: '#ffffff' },
    stadium: { name: 'Wildparkstadion', capacity: 34302, standing: 0.30, roof: true, floodlight: 4, pitch: 86, tiers: 2 },
    reputation: 48,
    finances: { balance: 2000000, debt: 5000000, ticketBase: 17 },
    fanbase: { members: 13000, ultras: 46, mood: 60, potential: 58 },
    facilities: { training: 60, medical: 63, youth: 66, scouting: 54 },
    boardName: 'Holger Siegmund-Schultze',
    leagueId: 'bl2',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'Deutscher Vizemeister 1956',
        '2× DFB-Pokalsieger (1955, 1956)',
        'UEFA-Cup-Halbfinale 1994',
        'Das Wunder vom Wildpark: 7:0 gegen den FC Valencia'
      ]
    }
  },

  {
    id: 'elversberg',
    name: 'SV 07 Elversberg',
    shortName: 'Elversberg',
    abbr: 'SVE',
    city: 'Spiesen-Elversberg',
    founded: 1907,
    colors: { primary: '#000000', secondary: '#ffffff', accent: '#e2001a' },
    kit: { pattern: 'stripes', shorts: '#000000', socks: '#000000' },
    awayKit: { primary: '#ffffff', secondary: '#000000', pattern: 'plain' },
    crest: { shape: 'round', motif: 'ball', bg: '#000000', fg: '#ffffff' },
    stadium: { name: 'Waldstadion an der Kaiserlinde', capacity: 10000, standing: 0.35, roof: false, floodlight: 2, pitch: 82, tiers: 1 },
    reputation: 34,
    finances: { balance: 1200000, debt: 500000, ticketBase: 14 },
    fanbase: { members: 1200, ultras: 14, mood: 78, potential: 20 },
    facilities: { training: 50, medical: 52, youth: 46, scouting: 44 },
    boardName: 'Hartmut Ostermann',
    leagueId: 'bl2',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'Aufstieg in die 2. Bundesliga 2023',
        'Meister der Regionalliga Südwest 2022/23',
        '3× Saarlandpokalsieger',
        'Kleinster Standort des deutschen Profifußballs'
      ]
    }
  },

  {
    id: 'paderborn',
    name: 'SC Paderborn 07',
    shortName: 'Paderborn',
    abbr: 'SCP',
    city: 'Paderborn',
    founded: 1907,
    colors: { primary: '#00529b', secondary: '#000000', accent: '#ffffff' },
    kit: { pattern: 'plain', shorts: '#000000', socks: '#00529b' },
    awayKit: { primary: '#ffffff', secondary: '#00529b', pattern: 'plain' },
    crest: { shape: 'shield', motif: 'letters', bg: '#00529b', fg: '#ffffff' },
    stadium: { name: 'Home Deluxe Arena', capacity: 15000, standing: 0.30, roof: true, floodlight: 3, pitch: 84, tiers: 1 },
    reputation: 40,
    finances: { balance: 2500000, debt: 1500000, ticketBase: 16 },
    fanbase: { members: 4200, ultras: 22, mood: 68, potential: 30 },
    facilities: { training: 56, medical: 58, youth: 60, scouting: 52 },
    boardName: 'Martin Hornberger',
    leagueId: 'bl2',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'Bundesliga-Aufstieg 2014 und 2019',
        'Vom Drittligisten in zwei Jahren in die Bundesliga',
        'Pokalsensation 2011 gegen den FC Bayern',
        '3× Westfalenpokalsieger'
      ]
    }
  },

  {
    id: 'darmstadt',
    name: 'SV Darmstadt 98',
    shortName: 'Darmstadt',
    abbr: 'D98',
    city: 'Darmstadt',
    founded: 1898,
    colors: { primary: '#0d4c92', secondary: '#ffffff', accent: '#000000' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#0d4c92' },
    awayKit: { primary: '#ffffff', secondary: '#0d4c92', pattern: 'plain' },
    crest: { shape: 'shield', motif: 'lion', bg: '#0d4c92', fg: '#ffffff' },
    stadium: { name: 'Merck-Stadion am Böllenfalltor', capacity: 17810, standing: 0.32, roof: true, floodlight: 3, pitch: 84, tiers: 1 },
    reputation: 42,
    finances: { balance: 2000000, debt: 2500000, ticketBase: 16 },
    fanbase: { members: 8500, ultras: 34, mood: 66, potential: 34 },
    facilities: { training: 56, medical: 59, youth: 56, scouting: 50 },
    boardName: 'Rüdiger Fritsch',
    leagueId: 'bl2',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'Die Lilien – Durchmarsch von Liga 3 in die Bundesliga 2014–2015',
        '3× Bundesliga-Aufstieg',
        'DFB-Pokal-Halbfinale 1987',
        'Das Bölle – lauteste Wellblechhütte Südhessens'
      ]
    }
  },

  {
    id: 'kiel',
    name: 'Holstein Kiel',
    shortName: 'Kiel',
    abbr: 'KSV',
    city: 'Kiel',
    founded: 1900,
    colors: { primary: '#005ca9', secondary: '#ffffff', accent: '#e2001a' },
    kit: { pattern: 'stripes', shorts: '#ffffff', socks: '#005ca9' },
    awayKit: { primary: '#e2001a', secondary: '#ffffff', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#005ca9', fg: '#ffffff' },
    stadium: { name: 'Holstein-Stadion', capacity: 15034, standing: 0.33, roof: false, floodlight: 3, pitch: 82, tiers: 1 },
    reputation: 44,
    finances: { balance: 3000000, debt: 1000000, ticketBase: 17 },
    fanbase: { members: 9500, ultras: 30, mood: 68, potential: 36 },
    facilities: { training: 58, medical: 60, youth: 63, scouting: 54 },
    boardName: 'Steffen Schneekloth',
    leagueId: 'bl2',
    history: {
      titles: 1,
      lastTitle: 1912,
      honours: [
        'Deutscher Meister 1912',
        'Erster Bundesliga-Aufstieg 2024 – nach 112 Jahren erstklassig',
        'Deutscher Vizemeister 1910',
        'Die Störche vom Ostseestadion'
      ]
    }
  },

  {
    id: 'bochum',
    name: 'VfL Bochum 1848',
    shortName: 'Bochum',
    abbr: 'BOC',
    city: 'Bochum',
    founded: 1848,
    colors: { primary: '#005ca9', secondary: '#ffffff', accent: '#0d3c78' },
    kit: { pattern: 'plain', shorts: '#005ca9', socks: '#005ca9' },
    awayKit: { primary: '#ffffff', secondary: '#005ca9', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#005ca9', fg: '#ffffff' },
    stadium: { name: 'Ruhrstadion', capacity: 26000, standing: 0.32, roof: true, floodlight: 3, pitch: 84, tiers: 2 },
    reputation: 50,
    finances: { balance: 2000000, debt: 7000000, ticketBase: 17 },
    fanbase: { members: 14000, ultras: 44, mood: 58, potential: 56 },
    facilities: { training: 60, medical: 64, youth: 66, scouting: 54 },
    boardName: 'Ilja Kaenzig',
    leagueId: 'bl2',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        '2× DFB-Pokal-Finalist (1968, 1988)',
        'UEFA-Cup-Viertelfinale 1997',
        '5× Zweitliga-Meister',
        'Der ewige Aufsteiger – „Unabsteigbar“ war einmal'
      ]
    }
  },

  {
    id: 'braunschweig',
    name: 'Eintracht Braunschweig',
    shortName: 'Braunschweig',
    abbr: 'EBS',
    city: 'Braunschweig',
    founded: 1895,
    colors: { primary: '#ffd500', secondary: '#004b93', accent: '#ffffff' },
    kit: { pattern: 'plain', shorts: '#004b93', socks: '#ffd500' },
    awayKit: { primary: '#004b93', secondary: '#ffd500', pattern: 'plain' },
    crest: { shape: 'round', motif: 'lion', bg: '#ffd500', fg: '#004b93' },
    stadium: { name: 'Eintracht-Stadion', capacity: 23325, standing: 0.32, roof: false, floodlight: 3, pitch: 82, tiers: 1 },
    reputation: 42,
    finances: { balance: 1500000, debt: 3500000, ticketBase: 16 },
    fanbase: { members: 9000, ultras: 40, mood: 58, potential: 44 },
    facilities: { training: 54, medical: 57, youth: 58, scouting: 48 },
    boardName: 'Nicole Kumpis',
    leagueId: 'bl2',
    history: {
      titles: 1,
      lastTitle: 1967,
      honours: [
        'Deutscher Meister 1967',
        'Gründungsmitglied der Bundesliga 1963',
        'Erster Verein mit Trikotwerbung in Deutschland (1973)',
        'Der Braunschweiger Löwe im Wappen'
      ]
    }
  },

  {
    id: 'muenster',
    name: 'SC Preußen Münster',
    shortName: 'Preußen',
    abbr: 'MUE',
    city: 'Münster',
    founded: 1906,
    colors: { primary: '#00843d', secondary: '#ffffff', accent: '#000000' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#00843d' },
    awayKit: { primary: '#ffffff', secondary: '#00843d', pattern: 'plain' },
    crest: { shape: 'round', motif: 'eagle', bg: '#00843d', fg: '#ffffff' },
    stadium: { name: 'Preußenstadion', capacity: 15050, standing: 0.34, roof: false, floodlight: 2, pitch: 80, tiers: 1 },
    reputation: 33,
    finances: { balance: 900000, debt: 1200000, ticketBase: 15 },
    fanbase: { members: 5200, ultras: 32, mood: 74, potential: 34 },
    facilities: { training: 48, medical: 51, youth: 50, scouting: 44 },
    boardName: 'Christoph Strässer',
    leagueId: 'bl2',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'Deutscher Vizemeister 1951',
        'Gründungsmitglied der Bundesliga 1963',
        'Durchmarsch von der Regionalliga in die 2. Bundesliga 2023–2024',
        '3× Westfalenpokalsieger'
      ]
    }
  },

  {
    id: 'bielefeld',
    name: 'DSC Arminia Bielefeld',
    shortName: 'Arminia',
    abbr: 'DSC',
    city: 'Bielefeld',
    founded: 1905,
    colors: { primary: '#00529b', secondary: '#ffffff', accent: '#000000' },
    kit: { pattern: 'plain', shorts: '#000000', socks: '#00529b' },
    awayKit: { primary: '#ffffff', secondary: '#00529b', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#00529b', fg: '#ffffff' },
    stadium: { name: 'Bielefelder Alm', capacity: 27332, standing: 0.32, roof: true, floodlight: 3, pitch: 82, tiers: 2 },
    reputation: 44,
    finances: { balance: 1800000, debt: 4000000, ticketBase: 16 },
    fanbase: { members: 13500, ultras: 44, mood: 70, potential: 52 },
    facilities: { training: 56, medical: 58, youth: 61, scouting: 50 },
    boardName: 'Rainer Schütte',
    leagueId: 'bl2',
    history: {
      titles: 0,
      lastTitle: null,
      honours: [
        'DFB-Pokal-Finalist 2025 als Drittligist',
        '7× Zweitliga-Meister – Rekord',
        'Der Bundesliga-Fahrstuhl aus Ostwestfalen',
        'Die Alm – eine der stimmungsvollsten Kulissen der Liga'
      ]
    }
  },

  {
    id: 'dresden',
    name: 'SG Dynamo Dresden',
    shortName: 'Dynamo',
    abbr: 'SGD',
    city: 'Dresden',
    founded: 1953,
    colors: { primary: '#ffdd00', secondary: '#000000', accent: '#e2001a' },
    kit: { pattern: 'plain', shorts: '#000000', socks: '#ffdd00' },
    awayKit: { primary: '#000000', secondary: '#ffdd00', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#ffdd00', fg: '#000000' },
    stadium: { name: 'Rudolf-Harbig-Stadion', capacity: 32066, standing: 0.33, roof: true, floodlight: 4, pitch: 84, tiers: 2 },
    reputation: 44,
    finances: { balance: 2200000, debt: 3000000, ticketBase: 16 },
    fanbase: { members: 21000, ultras: 90, mood: 70, potential: 74 },
    facilities: { training: 54, medical: 58, youth: 62, scouting: 48 },
    boardName: 'David Fischer',
    leagueId: 'bl2',
    history: {
      titles: 8,
      lastTitle: 1990,
      honours: [
        '8× DDR-Meister',
        '7× FDGB-Pokalsieger',
        'UEFA-Cup-Halbfinale 1989',
        'Dynamo-Fans füllen jedes Stadion – auch in Liga drei'
      ]
    }
  },

  {
    id: 'magdeburg',
    name: '1. FC Magdeburg',
    shortName: 'Magdeburg',
    abbr: 'FCM',
    city: 'Magdeburg',
    founded: 1965,
    colors: { primary: '#0a4b9b', secondary: '#ffffff', accent: '#e2001a' },
    kit: { pattern: 'plain', shorts: '#ffffff', socks: '#0a4b9b' },
    awayKit: { primary: '#ffffff', secondary: '#0a4b9b', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#0a4b9b', fg: '#ffffff' },
    stadium: { name: 'MDCC-Arena', capacity: 30098, standing: 0.30, roof: true, floodlight: 3, pitch: 84, tiers: 2 },
    reputation: 43,
    finances: { balance: 2000000, debt: 1800000, ticketBase: 16 },
    fanbase: { members: 12000, ultras: 64, mood: 68, potential: 58 },
    facilities: { training: 54, medical: 58, youth: 58, scouting: 48 },
    boardName: 'Peter Fechner',
    leagueId: 'bl2',
    history: {
      titles: 3,
      lastTitle: 1975,
      honours: [
        '3× DDR-Meister',
        'Europapokalsieger der Pokalsieger 1974 – einziger DDR-Europapokalsieg',
        '7× FDGB-Pokalsieger',
        'Aufstieg in die 2. Bundesliga 2022'
      ]
    }
  },

  {
    id: 'fuerth',
    name: 'SpVgg Greuther Fürth',
    shortName: 'Fürth',
    abbr: 'SGF',
    city: 'Fürth',
    founded: 1903,
    colors: { primary: '#00954c', secondary: '#ffffff', accent: '#000000' },
    kit: { pattern: 'stripes', shorts: '#ffffff', socks: '#00954c' },
    awayKit: { primary: '#ffffff', secondary: '#00954c', pattern: 'plain' },
    crest: { shape: 'round', motif: 'letters', bg: '#00954c', fg: '#ffffff' },
    stadium: { name: 'Sportpark Ronhof Thomas Sommer', capacity: 16626, standing: 0.32, roof: true, floodlight: 3, pitch: 82, tiers: 1 },
    reputation: 40,
    finances: { balance: 3000000, debt: 1000000, ticketBase: 16 },
    fanbase: { members: 5800, ultras: 24, mood: 62, potential: 30 },
    facilities: { training: 58, medical: 60, youth: 67, scouting: 52 },
    boardName: 'Rachid Azzouzi',
    leagueId: 'bl2',
    history: {
      titles: 3,
      lastTitle: 1929,
      honours: [
        '3× Deutscher Meister (1914, 1926, 1929)',
        'Zweitliga-Meister 2012 – erster Bundesliga-Aufstieg',
        'Das Kleeblatt vom Ronhof',
        'Traditionsderby gegen den 1. FC Nürnberg'
      ]
    }
  }

];

/** Schneller Zugriff über die Vereins-ID. */
export const CLUBS_BY_ID = Object.fromEntries(CLUBS.map(c => [c.id, c]));

/**
 * Liefert den Verein zur ID.
 * @param {string} id  Vereins-ID, z. B. 'bayern'
 * @returns {object|null} Club-Objekt oder null, wenn unbekannt.
 */
export function getClub(id) {
  return CLUBS_BY_ID[id] || null;
}

/**
 * Alle Vereine einer Liga, in der Reihenfolge dieser Datei.
 * @param {string} leagueId  'bl1' oder 'bl2'
 */
export function getClubsByLeague(leagueId) {
  return CLUBS.filter(c => c.leagueId === leagueId);
}

/** Alle Vereins-IDs (stabile Reihenfolge). */
export function allClubIds() {
  return CLUBS.map(c => c.id);
}
