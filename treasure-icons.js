/* Chronik der Feste V2 — treasure-icons.js
 *
 * Individuelle Hintergrund-Symbole für Schätze (Inline-SVG-Linien-Icons, viewBox 0 0 24 24, gleicher
 * Stil wie CARD_TYPE_ICON_SVG in app.js). Wird VOR app.js geladen.
 *
 * Regeln:
 *  - Stufe I: Titel enthält "Scherbe" -> Rissscherbe (CARD_TYPE_ICON_SVG['schatz-1']), sonst Zauberbuch
 *    (CARD_TYPE_ICON_SVG.Zauber).
 *  - Stufe II/III: individuelles Icon je Schatz-ID (TREASURE_ICON_SVG), Motiv aus Titel/Effekt abgeleitet.
 *  - Fallback: Stufen-Icon aus CARD_TYPE_ICON_SVG.
 */
const TREASURE_ICON_SVG = {
  // ---------- Stufe II ----------
  CronesAmulet: '<path d="M9 2.5c-.5 3 1.5 4.5 3 5.5 1.5-1 3.5-2.5 3-5.5"/><path d="M12 8l5 3v6l-5 3-5-3v-6Z"/><path d="M13.5 11.5a3.2 3.2 0 1 0 0 5 2.6 2.6 0 0 1 0-5Z"/>',
  EyeOfTheMaelstrom: '<path d="M8.5 2.5 12 7.5l3.5-5"/><circle cx="12" cy="14.5" r="6.5"/><path d="M7.2 14.5c1.3-2.2 2.9-3.3 4.8-3.3s3.5 1.1 4.8 3.3c-1.3 2.2-2.9 3.3-4.8 3.3s-3.5-1.1-4.8-3.3Z"/><circle cx="12" cy="14.5" r="1.3"/>',
  WellOfDespair: '<path d="M12 1.5c1.3 1.8 1.8 2.8 1.8 3.7a1.8 1.8 0 0 1-3.6 0c0-.9.5-1.9 1.8-3.7Z"/><ellipse cx="12" cy="10" rx="7" ry="2.5"/><path d="M5 10v8c0 1.7 3.1 3 7 3s7-1.3 7-3v-8"/><path d="M9 15q1.5 1 3 0t3 0"/>',
  CarapaceFragement: '<path d="M3 15c0-6 4-10 9-11 5 1 9 5 9 11l-3 2-3-2-3 2.5-3-2.5-3 2Z"/><path d="M7 15c0-4 2-7 5-8M12 7c3 1 5 4 5 8"/>',
  ThornedWhip: '<path d="M3.5 20.5 7 17"/><path d="M7 17c4-1 4-5 7-6s5 1 6 3"/><path d="M10.2 15.4l.2 2.2M13.8 11.6l-.4-2.2M18 11.2l-.3-2.3"/>',
  ImbuedShackles: '<rect x="3" y="9.5" width="10" height="6" rx="3"/><rect x="11" y="9.5" width="10" height="6" rx="3"/><path d="M12 2.5v3M8 4l1 2M16 4l-1 2"/>',
  PetrifiedWitchFinger: '<path d="M10 12V4a1.5 1.5 0 0 1 3 0v6.5a1.4 1.4 0 0 1 2.7 0 1.3 1.3 0 0 1 2.5.3V15c0 3.5-2 6-5.5 6h-1C9 21 7.5 19.5 6 17l-1.5-2.5c-.5-1 .8-1.8 1.6-1.1L10 16Z"/><path d="M11.5 6l-1 1.5 1 1"/><path d="M11 10.5l1 1"/>',
  WraithsEssence: '<path d="M10 3h4"/><path d="M10.5 3v5l-4 8a3 3 0 0 0 2.7 4.5h5.6A3 3 0 0 0 17.5 16l-4-8V3"/><path d="M9 15.5q1.5-1.5 3 0t3 0"/>',
  EdibleFungusChunks: '<path d="M4 12a8 7 0 0 1 16 0Z"/><path d="M9.5 12v6a2.5 2.5 0 0 0 5 0v-6"/><circle cx="8.5" cy="9" r=".9"/><circle cx="12" cy="7" r=".9"/><circle cx="15.5" cy="9.5" r=".9"/>',
  CoreOfRage: '<path d="M21 12l-4.8 1.7 2.2 4.7-4.7-2.2L12 21l-1.7-4.8-4.7 2.2 2.2-4.7L3 12l4.8-1.7-2.2-4.7 4.7 2.2L12 3l1.7 4.8 4.7-2.2-2.2 4.7Z"/><circle cx="12" cy="12" r="1.8"/>',
  BonesOfDeathmind: '<g transform="rotate(35 12 12)"><path d="M10.5 6.7A2.2 2.2 0 1 1 12 4.6A2.2 2.2 0 1 1 13.5 6.7V17.3A2.2 2.2 0 1 1 12 19.4A2.2 2.2 0 1 1 10.5 17.3Z"/></g>',
  UmbralHornOfWar: '<path d="M20 5C19 12 14 18 5 20"/><path d="M14.5 4C14 9 10.5 14 5 20"/><ellipse cx="17.25" cy="4.5" rx="3" ry="1.1" transform="rotate(8 17.25 4.5)"/><path d="M18.7 9.5l-5.5-1M17.2 13.5l-5.5-.7"/><path d="M5 20l-2 1.5"/>',
  TheBrokenMask: '<path d="M5 6c2-1.5 4.5-2 7-2s5 .5 7 2c.5 5-.5 11-7 14-6.5-3-7.5-9-7-14Z"/><path d="M8 10l2.5 1M16 10l-2.5 1"/><path d="M12 4l-1.5 4 2 3-1.5 4"/>',
  CleansingAmulet: '<path d="M9 2.5l3 5 3-5"/><path d="M12 7.5l5.5 7-5.5 7-5.5-7Z"/><path d="M12 12c1.5 2 2 3 2 3.7a2 2 0 0 1-4 0c0-.7.5-1.7 2-3.7Z"/>',
  ShimmeringCloakOfTheMagus: '<path d="M7 3.5c1.5 1 8.5 1 10 0l3.5 6.5-1.5 10.5-7-2.5-7 2.5L3.5 10Z"/><circle cx="12" cy="6" r="1"/><path d="M12 8v10.5"/><path d="M3 2.5v2M2 3.5h2M20.5 1.5v2M19.5 2.5h2"/>',
  WaywardScraps: '<path d="M4 8l4-3 3 3-2 4-5-1Z"/><path d="M13 5l5 1-1 5-4 1Z"/><path d="M9 15l5-1 3 4-4 3-5-2Z"/>',
  BlightedRootClump: '<path d="M5 10c0-3.5 3-6 7-6s7 2.5 7 6-3 5-7 5-7-1.5-7-5Z"/><path d="M8 15c0 2-2 3-2 5M12 15v6M16 15c0 2 2 3 2 5"/><circle cx="9" cy="9" r=".8"/><circle cx="14" cy="11" r=".8"/>',
  GluttonsTooth: '<path d="M6 3c3-1 9-1 12 0-.5 6-2 11-6 18-4-7-5.5-12-6-18Z"/><path d="M9.5 5c.3 4 1.2 8 2.5 11"/><path d="M8 3.5l.5 4M16 3.5l-.5 4"/>',
  FracturedShell: '<path d="M12 3c-4 0-6.5 4-6.5 9s2.5 9 6.5 9 6.5-4 6.5-9-2.5-9-6.5-9Z"/><path d="M10 3.5l2.5 4-3 3.5 3.5 3-2.5 4"/>',

  // ---------- Stufe III ----------
  AlchemistsAlembic: '<circle cx="9" cy="16" r="5"/><path d="M9 11V7c0-2 1-3 3-3h3l4 3v3"/><path d="M19 12.5c.8 1 1 1.5 1 2a1 1 0 0 1-2 0c0-.5.2-1 1-2Z"/><path d="M7 17q2-2 4 0"/>',
  SeersBracer: '<path d="M5 3.5h14l-2 17H7Z"/><path d="M5.7 7h12.6M6.6 17h10.8"/><path d="M7.5 12c1.5-3 3-4 4.5-4s3 1 4.5 4c-1.5 3-3 4-4.5 4s-3-1-4.5-4Z"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="12" r=".5"/>',
  SoothsayersPouch: '<path d="M9 4h6l-1 3c3 1 5 4 5 8 0 3-2.5 5-7 5s-7-2-7-5c0-4 2-7 5-8Z"/><path d="M8.7 7h6.6"/><path d="M12 11l1 2.2 2.3.3-1.7 1.6.5 2.3L12 16.2 9.9 17.4l.5-2.3-1.7-1.6 2.3-.3Z"/>',
  BroochOfAttunment: '<circle cx="12" cy="10" r="6.5"/><path d="M12 6.5l2.5 3.5-2.5 3.5L9.5 10Z"/><path d="M6 20.5l12-3M16.5 17.5v-1.5"/>',
  EndlessBandolier: '<path d="M2 8.5h20v7H2Z"/><path d="M9.5 6.5h5v11h-5Z"/><path d="M11 10v4M13 10v4"/><circle cx="5" cy="12" r=".6"/><circle cx="7" cy="12" r=".6"/><circle cx="17" cy="12" r=".6"/><circle cx="19" cy="12" r=".6"/>',
  EssenceExtractor: '<path d="M5 4h14l-5.5 7.5V18l-3 1.5v-8Z"/><path d="M7.5 7.5h9"/><circle cx="12" cy="22" r=".6"/>',
  'Extra-DimensionalLens': '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3.2"/><ellipse cx="12" cy="12" rx="3.2" ry="8"/>',
  PurifiedBangle: '<path d="M12 1.5l.8 1.8 1.8.8-1.8.8L12 6.7l-.8-1.8-1.8-.8 1.8-.8Z"/><ellipse cx="12" cy="14" rx="9" ry="6"/><ellipse cx="12" cy="14" rx="6" ry="3.2"/>',
  SiphoningBlade: '<path d="M12 2l2.5 3v11l-2.5 2-2.5-2V5Z"/><path d="M7 17h10M12 18v4"/><path d="M5 5c2 2 2 4 0 6M19 8c-2 2-2 4 0 6"/>',
  BladedCrystal: '<path d="M12 2l4 6v10l-4 4-4-4V8Z"/><path d="M12 8v14"/><path d="M8 8l4 2 4-2"/>',
  BandOfRetrieval: '<circle cx="12" cy="9.5" r="6"/><rect x="10" y="15" width="4" height="3" rx="1"/><path d="M10.5 18l-1 4M12 18v4M13.5 18l1 4"/>',
  GemEncrustedAnklet: '<ellipse cx="12" cy="10" rx="9" ry="5" stroke-dasharray="1.5 2"/><path d="M12 14.5l2 2.5-2 2.5-2-2.5Z"/><path d="M3.2 8l1.3 2-1.3 2-1.3-2Z"/><path d="M20.8 8l1.3 2-1.3 2-1.3-2Z"/>',
  TrueSightMonocle: '<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2.5"/><path d="M16 14.5c3 2 3 5 1 7"/><path d="M17.5 16.5h1.5M18 19h1.5"/>',
  PrecisionMagnifier: '<circle cx="10" cy="10" r="6.5"/><path d="M15 15l6 6"/><path d="M10 6v8M6 10h8"/>',
  PrismOfDestruction: '<path d="M12 4l7 12H5Z"/><path d="M2 13h7"/><path d="M15 11l7-2M15.5 13l6.5.5M16 15.5l5 3"/>',
  Quicksilver: '<path d="M12 3c4 4.5 6 7.5 6 10.5a6 6 0 0 1-12 0c0-3 2-6 6-10.5Z"/><path d="M9 14a3 3 0 0 0 2.5 3"/>',
  VerdantStaff: '<g transform="rotate(25 12 12)"><path d="M12 22V5"/><path d="M12 5c-3-1-4-4-2.5-4.5C11.5.5 12 2.5 12 5Z"/><path d="M12 20c3-1 3-3 0-4s-3-3 0-4 3-3 0-4"/><path d="M15 15c2 0 3-1 3-2"/></g>',
  VolatileClasp: '<path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3Z"/><path transform="translate(6.5 6) scale(.5)" stroke-width="2.8" d="M13 2 4 14h6l-1 8 9-12h-6Z"/>',
  AcceleratingGauntlets: '<path d="M8 21v-6.5L5.5 11c-.5-1 .6-2 1.6-1.4L9 11V5.5a1.4 1.4 0 0 1 2.8 0V4.5a1.4 1.4 0 0 1 2.8 0V6a1.4 1.4 0 0 1 2.8 0v9L16 21Z"/><path d="M8 18.5h8"/><path d="M1.5 6h3M1 9h2.5"/>',
  FangedChoker: '<ellipse cx="12" cy="14" rx="9" ry="4"/><path d="M3 14c0 3 4 5 9 5s9-2 9-5"/><path d="M10.8 10.05 12 4.5l1.2 5.55"/><path d="M6.6 11 5.8 5.8l3.4 4.5"/><path d="M14.8 10.3l3.4-4.5-.7 5.2"/><path d="M3.4 13.2 1.5 9.5l3.8 2.3"/><path d="M20.6 13.2l1.9-3.7-3.8 2.3"/>',
  SuppressingPin: '<circle cx="18.5" cy="5.5" r="3"/><path d="M16.3 7.7L3 21"/><path d="M10.5 12.5l1.5 1.5"/>',
  ShroudOfObfucation: '<path d="M12 2c-4 0-6 3-6 7v12l2-1.5 2 1.5 2-1.5 2 1.5 2-1.5 2 1.5V9c0-4-2-7-6-7Z"/><circle cx="10" cy="9" r="1"/><circle cx="14" cy="9" r="1"/>',
  ForgottenTrinket: '<circle cx="12" cy="5" r="2.5"/><circle cx="12" cy="14" r="6"/><path d="M9.5 14a2.5 2.5 0 1 1 2.5 2.5"/>',
  EntwinedAetherStrands: '<path d="M3 6c6 0 6 6 9 6s3-6 9-6"/><path d="M3 18c6 0 6-6 9-6s3 6 9 6"/>',
  FlowingMantle: '<path d="M9 3h6l3 4c1 5 1 9 2 14-2-1-3 1-4.5-.5S13 21 12 21s-2 1.5-3.5-.5S6 20 4 21c1-5 1-9 2-14Z"/><path d="M9.5 5.5L12 7l2.5-1.5"/><path d="M9 9v9M15 9v9"/>'
};

// Liefert die SVG-Pfade für das Hintergrund-Symbol eines Schatzes (siehe Regeln oben).
function treasureIconPaths(t) {
  if (TREASURE_ICON_SVG[t.id]) return TREASURE_ICON_SVG[t.id];
  if (t.level === 1) return /scherbe/i.test(t.name) ? CARD_TYPE_ICON_SVG['schatz-1'] : CARD_TYPE_ICON_SVG.Zauber;
  return CARD_TYPE_ICON_SVG['schatz-' + t.level];
}

// Akzentfarb-Schlüssel (CARD_TYPE_COLOR_VARS) eines Schatzes: Stufe I teilt sich in Scherben
// (Kristall-Richtung) und alles andere (Zauber-Richtung); Stufe II/III behalten ihre Stufenfarbe.
function treasureAccentKey(t) {
  if (t.level === 1) return /scherbe/i.test(t.name) ? 'schatz-1-shard' : 'schatz-1-spell';
  return 'schatz-' + t.level;
}
