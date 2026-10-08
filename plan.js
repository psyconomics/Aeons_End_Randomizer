/* Chronik der Feste V2 — plan.js
 * Seed-basierte, deterministische Erzeugung des ExpeditionPlan sowie alle
 * "Draw"-Funktionen (Sieg/Niederlage/Treasure-Vergabe). Nutzt NIEMALS
 * Math.random() — jede Zufallsentscheidung ist über einen Hash aus
 * (rngSeed, fightIndex, kind, attemptNumber) reproduzierbar.
 */

// ---------- Deterministischer PRNG (mulberry32) ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simple deterministischer String-Hash (xfnv1a-artig) -> 32-bit uint Seed
function hashStringToSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Erzeugt einen PRNG für einen bestimmten "Zug" der Kampagne.
// parts: beliebige Liste von Werten, die den Zug eindeutig identifizieren
// (z. B. [fightIndex, kind, attemptNumber]).
function seededRng(rngSeed, parts) {
  const key = String(rngSeed) + '|' + parts.map(String).join('|');
  return mulberry32(hashStringToSeed(key));
}

// Deterministisches Fisher-Yates-Shuffle (mutiert nicht das Original-Array)
function seededShuffle(rng, array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Wählt deterministisch genau 1 Element aus einem Pool (ohne Mutation)
function seededPick(rng, pool) {
  if (!pool.length) return null;
  const idx = Math.floor(rng() * pool.length);
  return pool[idx];
}

// Erzeugt einen zufälligen, für Menschen brauchbaren Seed-String (nur wenn
// der Nutzer keinen eigenen Seed eingibt — die Erzeugung selbst darf hier
// nicht-deterministisch sein, da sie die Wurzel des Seeds ist).
function generateRandomSeedString() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// Eigenständige Slot-ID für gespeicherte Expeditionen — bewusst getrennt vom (ggf. vom Nutzer
// frei wählbaren) rngSeed, damit zwei Expeditionen mit identischem Seed nicht denselben Slot
// belegen. Nicht-deterministisch, das ist hier unschädlich (reine Verwaltungs-ID, keine
// Spiellogik hängt daran).
function generateExpeditionId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------- Zentrale Draw-Funktion (siehe V2_USER_FLOW.md) ----------
// drawCard(rngSeed, fightIndex, kind, attemptNumber, pool) -> Karte | null
// kind Beispiele: 'loss-gem' | 'loss-relic' | 'loss-spell' | 'loss-mage' |
//   'loss-treasure-tier1' | 'win-gem' | 'win-relic' | 'win-spell' |
//   'treasure-slot-1' | 'initial-spell-1' | ...
function drawCard(rngSeed, fightIndex, kind, attemptNumber, pool) {
  const rng = seededRng(rngSeed, [fightIndex, kind, attemptNumber]);
  return seededPick(rng, pool);
}

// ---------- Score-Formel (1:1 aus dem Original-Randomizer) ----------
// tries = Anzahl Versuche bis zum Sieg (1 = im ersten Versuch gewonnen)
function scoreForTries(tries) {
  if (tries <= 1) return 6;
  if (tries === 2) return 4;
  if (tries === 3) return 2;
  return 0;
}

// ---------- Hilfsfunktionen: Pools nach Erweiterung filtern ----------

function filterByExpansions(list, expansionCodes) {
  const set = new Set(expansionCodes);
  // Punkt 36: "disabled"-Karten (z.B. Promo-Karten ohne freigegebene deutsche Übersetzung)
  // werden nie in einen Marktplatz-Pool aufgenommen, unabhängig von den gewählten Erweiterungen.
  return list.filter((x) => set.has(x.expansion) && !x.disabled);
}

function marketplaceCardsBySubtype(pool, subtype) {
  return pool.filter((c) => c.subtype === subtype);
}

function excludeIds(pool, usedIds) {
  const used = new Set(usedIds);
  return pool.filter((c) => !used.has(c.id));
}

// ---------- Marktplatz-Setups (1:1 aus dem Original-Randomizer, siehe data.js) ----------
// Herkunft: aeons-end-randomizer-main/src/aer-data/src/marketSetups.ts (Objekt MARKETSETUPS)
// und die Filter-Logik aus src/Redux/helpers.ts (filterByCost). Im Original wählt der Spieler
// beim Erzeugen einer Expedition EIN Setup manuell aus der Menge der als "aktiv" markierten
// Setups (Dropdown "Market" im Expeditions-Erzeugungsdialog) — es gibt dort KEINE automatische
// Zufallsauswahl unter den aktiven Setups. Da unser App-Flow (bewusst, siehe V2_USER_FLOW.md)
// keinen manuellen Marktplatz-Setup-Picker beim Erzeugen vorsieht, wählen wir stattdessen
// deterministisch über den Seed EINES der in den Optionen aktivierten Setups aus (Vereinfachung,
// siehe Aufgaben-Fazit). Gibt es kein aktives Setup, fällt die Auswahl auf das versteckte
// "random"-Setup zurück (identisch zum "default"-Fallback-Verhalten des Originals).

// Prüft, ob eine Karte mit gegebenen Kosten die Constraint eines einzelnen Tiles erfüllt.
// Entspricht 1:1 filterByCost() aus src/Redux/helpers.ts im Original-Randomizer.
function tileMatchesCost(tile, cost) {
  switch (tile.op) {
    case '<': return tile.threshold == null || cost < tile.threshold;
    case '>': return tile.threshold == null || cost > tile.threshold;
    case '<=': return tile.threshold == null || cost <= tile.threshold;
    case '>=': return tile.threshold == null || cost >= tile.threshold;
    case '=': return tile.threshold == null || cost === tile.threshold;
    case 'OR': return !tile.values || tile.values.indexOf(cost) !== -1;
    default: return true; // 'ANY' oder unbekannt
  }
}

// Menschlich lesbares Label für ein Tile (für die Chip-Anzeige in den Optionen).
function marketSetupTileLabel(tile) {
  if (tile.op === 'ANY') return 'ANY';
  if (tile.op === 'OR' && tile.values) return tile.values.join('/');
  return `${tile.op}${tile.threshold != null ? tile.threshold : ''}`;
}

// Liefert die Tiles eines Setups für einen bestimmten Subtyp, exakt auf "count" Slots gebracht:
// überschüssige Tiles werden abgeschnitten, fehlende mit ANY aufgefüllt. NOTWENDIGE
// Vereinfachung ggü. dem Original: dort variiert die Gesamtzahl Kristall/Relic/Zauber-Tiles je
// Setup (z. B. Market Setup 3: 3 Kristall/1 Relic/5 Zauber statt 3/2/4) — unsere App hält aber
// die feste 4/3/2-Invariante (siehe V2_USER_FLOW.md, Punkt 1) über die gesamte Kampagne hinweg
// ein, daher müssen Setups mit abweichender Verteilung hier passend zurechtgeschnitten werden.
function tilesForSubtype(setup, subtype, count) {
  const matching = setup.tiles.filter((t) => t.subtype === subtype);
  const result = matching.slice(0, count);
  while (result.length < count) result.push({ subtype, op: 'ANY' });
  return result;
}

// Fallback: wählt deterministisch (über den Seed) genau EIN Marktplatz-Setup aus der Liste der
// in den Optionen aktivierten Setup-IDs. Wird nur verwendet, wenn der Nutzer im Screen "Neue
// Expedition" KEIN Setup explizit ausgewählt hat (siehe resolveMarketSetup). Ohne aktive Auswahl:
// Fallback auf das versteckte "random"-Setup.
function pickActiveMarketSetup(rngSeed, activeSetupIds) {
  const all = AEONS_DATA.marketSetups || [];
  const randomSetup = all.find((s) => s.id === 'random') || { id: 'random', name: 'Zufalls-Setup', tiles: [] };
  const active = all.filter((s) => (activeSetupIds || []).indexOf(s.id) !== -1 && !s.hidden);
  const pool = active.length ? active : [randomSetup];
  const rng = seededRng(rngSeed, ['plan', 'marketSetupPick']);
  return seededPick(rng, pool) || randomSetup;
}

// Löst das tatsächlich zu verwendende Marktplatz-Setup auf: explizite Nutzerauswahl (Dropdown im
// Screen "Neue Expedition") hat Vorrang; ohne gültige Auswahl greift der deterministische
// Seed-Fallback pickActiveMarketSetup().
function resolveMarketSetup(chosenSetupId, rngSeed, activeSetupIds) {
  const all = AEONS_DATA.marketSetups || [];
  if (chosenSetupId) {
    const found = all.find((s) => s.id === chosenSetupId);
    if (found) return found;
  }
  return pickActiveMarketSetup(rngSeed, activeSetupIds);
}

// Ordnet den 19 "verbesserten" Nemesis-Kartennamen (siehe IMPROVED_NEMESIS_CARD_POOLS) jeweils
// einen von drei Kartentypen zu: Angriff (entspricht "Attack" im Original), Plan (entspricht
// "Power"), Monster (entspricht "Minion"). Quelle: offizielle Kartendaten aus dem
// aeons-end-randomizer-Projekt (DE/theNewAge/upgradedBasicNemesisCards.ts und
// DE/theAncients/upgradedBasicNemesisCards.ts, Feld "type"), nicht mehr aus der Namenssemantik
// geraten.
const NEMESIS_CARD_TYPES = {
  'Zischende Säure': 'Plan',
  'Unheilkommandant': 'Monster',
  'Demolieren': 'Angriff',
  'Aufreißen': 'Angriff',
  'Furche der Zerstörung': 'Plan',
  'Nadelspeier': 'Monster',
  'Himmelsbeben': 'Plan',
  'Jaulender Schlitzer': 'Monster',
  'Gebrandmarkt': 'Angriff',
  'Zerfetzen': 'Angriff',
  'Zerlegen': 'Angriff',
  'Verschlingender Wahn': 'Plan',
  'Tosender Sturm': 'Plan',
  'Verängstigen': 'Angriff',
  'Strahl der Verwüstung': 'Plan',
  'Vernichten': 'Angriff',
  'Strahl des Verfalls': 'Plan',
  'Opferung': 'Angriff',
  'Feuergräber': 'Monster'
};

function nemesisCardType(name) {
  return NEMESIS_CARD_TYPES[name] || 'Angriff';
}

// ---------- ExpeditionPlan-Generator ----------

const MARKETPLACE_TARGET = { Zauber: 4, Kristall: 3, Relic: 2 };

// ---------- Nemesis-Deck-Aufbau: "Verbesserte" (V) Karten je Level, echte Namen ----------
// Herkunft: vom Nutzer vorgegebenes offizielles Regel-Beiblatt (siehe V2_USER_FLOW.md).
// Diese Kartennamen sind bewusst GENERISCH für die gesamte App (nicht pro individuellem
// Nemesis unterschiedlich) — ersetzt das frühere generische improvedSetup-Platzhalterfeld.
const IMPROVED_NEMESIS_CARD_POOLS = {
  level1: ['Zischende Säure', 'Unheilkommandant', 'Demolieren', 'Aufreißen', 'Furche der Zerstörung'],
  level2: ['Nadelspeier', 'Himmelsbeben', 'Jaulender Schlitzer', 'Gebrandmarkt', 'Zerfetzen', 'Zerlegen', 'Verschlingender Wahn'],
  level3: ['Tosender Sturm', 'Verängstigen', 'Strahl der Verwüstung', 'Vernichten', 'Strahl des Verfalls', 'Opferung', 'Feuergräber']
};

// Wie viele der (in fester, seed-bestimmter Reihenfolge gewählten) Verbesserten-Karten sind
// je Level ab welchem Kampf (Index 0-3) kumulativ aktiv. Identisch über alle Spielerzahlen.
const CUMULATIVE_IMPROVED_COUNTS = {
  level1: [0, 1, 2, 3],
  level2: [0, 3, 4, 5],
  level3: [0, 3, 5, 7]
};

// Anzahl "Allgemeiner" (A) Karten je Spieleranzahl (2/3/4) x Level (1-3) x Kampf (Index 0-3).
// Quelle: vom Nutzer vorgegebenes offizielles Regel-Beiblatt.
const A_COUNT_TABLE = {
  2: { level1: [3, 2, 1, 0], level2: [5, 2, 1, 0], level3: [7, 4, 2, 0] },
  3: { level1: [5, 4, 3, 2], level2: [6, 3, 2, 1], level3: [7, 4, 2, 0] },
  4: { level1: [8, 7, 6, 5], level2: [7, 4, 3, 2], level3: [7, 4, 2, 0] }
};

// Annahme (dokumentiert, siehe Aufgabenstellung): 1-Spieler-Gruppen sind laut Spec nicht
// vorgesehen (min. 2), aber defensiv fällt 1 Spieler auf die 2-Spieler-Zeile zurück; > 4 wird
// auf 4 gekappt.
function clampPlayerCountForImproved(n) {
  const num = Number(n) || 0;
  if (num <= 2) return 2;
  if (num >= 4) return 4;
  return num;
}

// Liefert die Anzahl "Allgemeiner" Karten für ein Level bei einem bestimmten Kampf (Index 0-3).
function getACountForFight(playerCount, level, fightIndex) {
  const pc = clampPlayerCountForImproved(playerCount);
  const table = A_COUNT_TABLE[pc] || A_COUNT_TABLE[2];
  const arr = (table && table['level' + level]) || [0, 0, 0, 0];
  return arr[fightIndex] || 0;
}

// Liefert die Namen der bis zu diesem Kampf (Index 0-3) kumulativ aktiven Verbesserten-Karten
// eines Levels, in der seed-bestimmten Reihenfolge aus plan.improvedCardOrder.
function getImprovedCardsForFight(plan, level, fightIndex) {
  const order = (plan.improvedCardOrder && plan.improvedCardOrder['level' + level]) || [];
  const counts = CUMULATIVE_IMPROVED_COUNTS['level' + level] || [0, 0, 0, 0];
  const n = counts[fightIndex] || 0;
  return order.slice(0, n);
}

/**
 * options:
 *   name: string
 *   seed: string (optional, leer = zufällig generiert)
 *   selectedExpansions: string[]           // Pool für Magier/Erzfeinde/Schätze UND Marktplatzkarten
 *   activeMarketSetupIds: string[]         // in den Optionen aktivierte Marktplatz-Setup-IDs
 *   playerCount: number (optional, 2/3/4, Default 4)  // Punkt 26: Spieleranzahl der Kampagne;
 *     steuert die Anzahl der Magier-Vorschläge (playerCount + 1) sowie später die geforderte
 *     Party-Größe in der Kaserne.
 *   easyMode: boolean (optional, Default false)  // Variante "4 Spieler: einfaches Spiel":
 *     playerCount bleibt unverändert 4 (identische Party-/Magier-/Schatz-Validierung UND
 *     identischer Nemesis-A/V-Kartenaufbau wie die normale Option "4" — das ist KEINE offizielle
 *     Regel-Variante mit eigener Spiellogik, sondern nur eine informative Markierung der
 *     Expedition, siehe playerCountLabel() in app.js).
 *   difficulty: 'normal' | 'leicht' (optional, Default 'normal')  // Eigenständige, von easyMode
 *     losgelöste Option: steuert ausschließlich die Start-Werte der Feste-/Erzfeind-Zähler
 *     (siehe festeStartValue()/nemesisStartHealth() in app.js). Keine sonstige Spiellogik.
 */
function generateExpeditionPlan(options) {
  const rngSeed = (options.seed && options.seed.trim()) || generateRandomSeedString();
  const selectedExpansions = options.selectedExpansions || [];
  // Der Marktplatz nutzt denselben Erweiterungs-Pool wie Magier/Erzfeinde/Schätze — die
  // frühere separate "Marktplatz-Erweiterungen ausschließen"-Option wurde entfernt (siehe
  // Aufgaben-Fazit) und durch die Marktplatz-Setup-Auswahl unten ersetzt.
  const marketplaceExpansions = selectedExpansions;

  const easyMode = !!options.easyMode;
  const difficulty = options.difficulty === 'leicht' ? 'leicht' : 'normal';

  // Punkt 26: Spieleranzahl (2/3/4), Default 4, robust gegen ungültige Eingaben.
  const rawPlayerCount = Number(options.playerCount);
  const playerCount = [2, 3, 4].includes(rawPlayerCount) ? rawPlayerCount : 4;

  const magesPool = filterByExpansions(AEONS_DATA.mages, selectedExpansions);
  const nemesesPool = filterByExpansions(AEONS_DATA.nemeses, selectedExpansions);
  const marketplacePool = filterByExpansions(AEONS_DATA.marketplaceCards, marketplaceExpansions);

  // Magier-Vorschläge (deterministisch geshuffelt): immer Spieleranzahl + 1 (Punkt 26).
  const mageShuffle = seededShuffle(seededRng(rngSeed, ['plan', 'mageProposals']), magesPool);
  const mageProposals = mageShuffle.slice(0, Math.min(playerCount + 1, mageShuffle.length)).map((m) => m.id);

  // 4 Erzfeinde: entsprechend der Regel des Original-Randomizers wird für jeden Kampf (1-4) genau
  // 1 Erzfeind mit dem zum Kampf passenden Expedition Rating (1-4) gezogen. Das ist keine bloße
  // nachträgliche Sortierung von 4 zufälligen Erzfeinden, sondern eine echte Tier-Auswahl pro Kampf,
  // damit die Schwierigkeit über die Expedition hinweg garantiert ansteigt.
  const usedNemesisIds = new Set();
  const nemesisOrder = [1, 2, 3, 4]
    .map((fightRating) => {
      let tierPool = nemesesPool.filter(
        (n) => Number(n.expeditionRating) === fightRating && !usedNemesisIds.has(n.id)
      );
      if (tierPool.length === 0) {
        // Fallback (z. B. wenn Erweiterungs-Filter das passende Rating-Tier leer macht):
        // nächstbestes verfügbares Rating als Ersatz verwenden, statt die Expedition scheitern zu lassen.
        tierPool = nemesesPool
          .filter((n) => !usedNemesisIds.has(n.id))
          .sort(
            (a, b) =>
              Math.abs((Number(a.expeditionRating) || 0) - fightRating)
              - Math.abs((Number(b.expeditionRating) || 0) - fightRating)
          );
      }
      const picked = seededPick(seededRng(rngSeed, ['plan', 'nemesisPick', 'fight' + fightRating]), tierPool);
      if (picked) usedNemesisIds.add(picked.id);
      return picked ? picked.id : null;
    })
    .filter(Boolean);

  // Marktplatz-Setup: explizite Auswahl im Screen "Neue Expedition" hat Vorrang, sonst
  // deterministischer Seed-Fallback (siehe resolveMarketSetup/pickActiveMarketSetup).
  const marketSetup = resolveMarketSetup(options.marketSetupId, rngSeed, options.activeMarketSetupIds);

  // Start-Marktplatz: 4 Zauber, 3 Kristalle, 2 Relics, deterministisch gezogen — je Slot unter
  // Beachtung der Kosten-Constraint des jeweiligen Setup-Tiles (siehe tileMatchesCost/
  // tilesForSubtype). Findet sich kein Kandidat, der die Constraint erfüllt, hat die feste
  // 4/3/2-Invariante Vorrang: es wird dann ohne Kosten-Filter aus dem verbleibenden Subtyp-Pool
  // gezogen (im Original würde das Tile stattdessen einfach übersprungen, was bei uns die
  // Invariante verletzen würde — siehe Aufgaben-Fazit).
  const initialMarketplace = [];
  const usedForInitial = [];
  Object.entries(MARKETPLACE_TARGET).forEach(([subtype, count]) => {
    let subtypePool = marketplaceCardsBySubtype(marketplacePool, subtype);
    const tiles = tilesForSubtype(marketSetup, subtype, count);
    tiles.forEach((tile, idx) => {
      subtypePool = excludeIds(subtypePool, usedForInitial);
      let candidatePool = subtypePool.filter((c) => tileMatchesCost(tile, c.cost));
      if (!candidatePool.length) candidatePool = subtypePool;
      const card = drawCard(rngSeed, -1, `initial-${subtype}`, idx + 1, candidatePool);
      if (card) {
        initialMarketplace.push(card.id);
        usedForInitial.push(card.id);
      }
    });
  });

  // Verbesserte Nemesis-Karten: EINMALIG und deterministisch je Level eine geordnete Auswahl.
  // Level 1: 3 von 5, Level 2: 5 von 7, Level 3: alle 7 (aber in zufälliger Reihenfolge).
  // Die Reihenfolge bestimmt, welche Karten bei niedrigerer kumulativer V-Zahl schon aktiv sind.
  const improvedCardOrder = {
    level1: seededShuffle(seededRng(rngSeed, ['plan', 'improvedLevel1']), IMPROVED_NEMESIS_CARD_POOLS.level1).slice(0, 3),
    level2: seededShuffle(seededRng(rngSeed, ['plan', 'improvedLevel2']), IMPROVED_NEMESIS_CARD_POOLS.level2).slice(0, 5),
    level3: seededShuffle(seededRng(rngSeed, ['plan', 'improvedLevel3']), IMPROVED_NEMESIS_CARD_POOLS.level3)
  };

  return {
    // Eigenständige, vom Seed unabhängige Slot-ID (Punkt: Speicherstand-Kollisionen vermeiden —
    // seed diente früher als Slot-Schlüssel, wodurch zwei Expeditionen mit demselben, manuell
    // eingegebenen Seed sich beim Speichern gegenseitig überschrieben haben). id ist rein
    // technisch und wird nirgends angezeigt.
    id: generateExpeditionId(),
    seed: rngSeed,
    rngSeed,
    name: options.name || '',
    createdAt: new Date().toISOString(),
    selectedExpansions,
    marketplaceExpansions,
    playerCount,
    easyMode,
    difficulty,
    mageProposals,
    nemesisOrder,
    initialMarketplace,
    marketSetupId: marketSetup.id,
    marketSetupName: marketSetup.name,
    improvedCardOrder
  };
}

// Punkt 26: Ziel-Anzahl aktiver Schätze je Stufe — Stufe II immer genau 1, Stufe I/III
// genau die Spieleranzahl (analog zur Zauber/Kristall/Relic-Logik, aber pro Stufe statt
// pro Subtyp). Der Aufrufer begrenzt das Ergebnis zusätzlich auf die tatsächlich verfügbare
// Anzahl in der Kaserne.
function treasureTierTarget(level, playerCount) {
  return level === 2 ? 1 : playerCount;
}

// ---------- Card-Lookup-Helfer ----------

function marketplaceCardById(id) {
  return AEONS_DATA.marketplaceCards.find((c) => c.id === id);
}
function mageByIdPlan(id) {
  return AEONS_DATA.mages.find((m) => m.id === id);
}
function nemesisByIdPlan(id) {
  return AEONS_DATA.nemeses.find((n) => n.id === id);
}
function treasureByIdPlan(id) {
  return AEONS_DATA.treasures.find((t) => t.id === id);
}

// ---------- Invariante 4 Zauber / 3 Kristalle / 2 Relics prüfen ----------

function marketplaceCounts(marketplaceIds) {
  const counts = { Zauber: 0, Kristall: 0, Relic: 0 };
  marketplaceIds.forEach((id) => {
    const c = marketplaceCardById(id);
    if (c && counts[c.subtype] !== undefined) counts[c.subtype]++;
  });
  return counts;
}

function marketplaceInvariantOk(marketplaceIds) {
  const counts = marketplaceCounts(marketplaceIds);
  return counts.Zauber === MARKETPLACE_TARGET.Zauber &&
    counts.Kristall === MARKETPLACE_TARGET.Kristall &&
    counts.Relic === MARKETPLACE_TARGET.Relic;
}

// Punkt 41: Schätze-Analogon zu marketplaceInvariantOk() — prüft, ob je Stufe (I/II/III)
// exakt die vorgesehene Anzahl (treasureTierTarget, begrenzt auf tatsächlich verfügbare
// Kaserne-Schätze der jeweiligen Stufe) aktiv ist. Wird sowohl von der Kaserne-Anzeige als
// auch von der Navigations-Sperre vor dem nächsten Kampf verwendet (siehe focusBarracksIssue()).
function treasuresInvariantOk(activeTreasureIds, poolTreasureIds, playerCount) {
  const pool = poolTreasureIds.map(treasureByIdPlan).filter(Boolean);
  return [1, 2, 3].every((level) => {
    const available = pool.filter((t) => t.level === level).length;
    const target = Math.min(treasureTierTarget(level, playerCount), available);
    const activeCount = activeTreasureIds.filter((id) => {
      const t = treasureByIdPlan(id);
      return t && t.level === level;
    }).length;
    return activeCount === target;
  });
}

// ---------- Belohnungs-Pools (für Niederlage/Sieg) ----------

// category: 'Kristall' | 'Zauber' | 'Relic' | 'Magier' | 'Schatz-Tier-1'|'Schatz-Tier-2'|'Schatz-Tier-3'
function poolForCategory(plan, runtimeState, category) {
  const usedMarketplaceIds = runtimeState.barracks.marketplaceCardIds || [];
  if (category === 'Magier') {
    const magesPool = filterByExpansions(AEONS_DATA.mages, plan.selectedExpansions);
    const usedMageIds = new Set([...(runtimeState.chosenParty || []), ...(runtimeState.barracks.mageIds || [])]);
    return magesPool.filter((m) => !usedMageIds.has(m.id));
  }
  if (category === 'Kristall' || category === 'Zauber' || category === 'Relic') {
    const marketplacePool = filterByExpansions(AEONS_DATA.marketplaceCards, plan.marketplaceExpansions);
    const bySubtype = marketplaceCardsBySubtype(marketplacePool, category);
    return excludeIds(bySubtype, usedMarketplaceIds);
  }
  if (category.startsWith('Schatz-Tier-')) {
    const level = Number(category.replace('Schatz-Tier-', ''));
    const treasurePool = filterByExpansions(AEONS_DATA.treasures, plan.selectedExpansions).filter((t) => t.level === level);
    const usedTreasureIds = runtimeState.barracks.treasureIds || [];
    return excludeIds(treasurePool, usedTreasureIds);
  }
  return [];
}

function categoryToKindFragment(category) {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

// Niederlage: "Zufall"-Option im Kategorie-Dropdown — wählt deterministisch (aus dem Seed)
// genau 1 Kategorie aus den aktuell verfügbaren. Eigener "kind" ('loss-random-category'),
// damit diese Ziehung unabhängig von der eigentlichen Kartenziehung (drawLossReward) bleibt.
function pickRandomLossCategory(plan, runtimeState, categories) {
  const attemptNumber = (runtimeState.triesPerFight[runtimeState.fightIndex] || 0) + 1;
  const rng = seededRng(plan.rngSeed, [runtimeState.fightIndex, 'loss-random-category', attemptNumber]);
  return seededPick(rng, categories);
}

// Niederlage: 1 Karte der gewählten Kategorie, deterministisch aus dem Seed.
function drawLossReward(plan, runtimeState, category) {
  const attemptNumber = (runtimeState.triesPerFight[runtimeState.fightIndex] || 0) + 1;
  const pool = poolForCategory(plan, runtimeState, category);
  const kind = 'loss-' + categoryToKindFragment(category);
  return drawCard(plan.rngSeed, runtimeState.fightIndex, kind, attemptNumber, pool);
}

// Sieg: automatisch je 1 Kristall + 1 Relic + 1 Zauber
function drawWinRewards(plan, runtimeState) {
  const rewards = {};
  ['Kristall', 'Relic', 'Zauber'].forEach((subtype) => {
    const pool = poolForCategory(plan, runtimeState, subtype);
    rewards[subtype] = drawCard(plan.rngSeed, runtimeState.fightIndex, 'win-' + categoryToKindFragment(subtype), 1, pool);
  });
  return rewards;
}

// Schatzvergabe nach Sieg 1/2/3 (Tier = Kampfnummer), exakt nach der Original-Randomizer-Regel:
// Tier 1 und Tier 3: die Gruppe zieht 5 Kandidaten dieser Stufe, jeder Spieler (= chosenParty.length)
// waehlt genau 1 davon; der Rest geht ungenutzt in die Kaserne.
// Tier 2: die Gruppe zieht 3 Kandidaten dieser Stufe, es wird insgesamt nur 1 gewaehlt (Gruppenschatz);
// die restlichen 2 gehen in die Kaserne.
// Es gibt KEINE Zuordnung "welcher Charakter bekommt welchen Schatz" — nur eine Auswahl, welche der
// gezogenen Karten von der Gruppe aktiv genutzt werden. Alle Ziehungen weiterhin deterministisch
// ueber drawCard()/seededRng(), kein Zuruecklegen bereits gezogener Karten.
function drawTreasureCandidates(plan, runtimeState, tier) {
  const category = 'Schatz-Tier-' + tier;
  const pool = poolForCategory(plan, runtimeState, category);
  const drawCount = tier === 2 ? 3 : 5;
  const drawn = [];
  const takenIds = [];
  for (let i = 1; i <= drawCount; i++) {
    const available = excludeIds(pool, takenIds);
    if (!available.length) break;
    const card = drawCard(plan.rngSeed, runtimeState.fightIndex, 'treasure-slot-' + i, 1, available);
    if (card) {
      drawn.push(card);
      takenIds.push(card.id);
    }
  }
  return drawn;
}

// ---------- Story-Umbau (Einmal-Generierung): Sieg-Pfad vollständig vorab simulieren ----------
// Sowohl drawWinRewards() als auch drawTreasureCandidates() nutzen IMMER attemptNumber = 1 und
// haengen NICHT von runtimeState.triesPerFight ab — sie sind also allein aus dem Seed heraus
// bereits VOR jedem Kampf vollstaendig bekannt, unabhaengig davon, wie oft die Gruppe einen
// Kampf tatsaechlich wiederholen muss. Diese Funktion "spielt" die Kampagne einmal komplett
// gewonnen durch (Kampf 1-4, jeweils im ersten Versuch) und liefert fuer jeden Kampf die
// Sieg-Beute (Kristall/Relic/Zauber) sowie – fuer Kampf 1-3 – die Schatzkandidaten inkl. einer
// deterministisch vorgeschlagenen ("empfohlenen") Karte. Niederlagen fliessen bewusst NICHT ein
// (siehe V2_USER_FLOW.md / Story-Umbau-Entscheidung): ein per Niederlage-Belohnung rekrutierter
// Magier landet weiterhin einfach in der Kaserne, ohne dass die vorab generierte Erzaehlung ihn
// kennen muss.
function simulateGuaranteedWinCampaign(plan) {
  const sim = {
    barracks: { mageIds: [], marketplaceCardIds: plan.initialMarketplace.slice(), treasureIds: [] },
    fightIndex: 0,
    triesPerFight: [0, 0, 0, 0]
  };
  const fights = [];
  for (let f = 0; f < 4; f++) {
    sim.fightIndex = f;
    const winRewards = drawWinRewards(plan, sim);
    Object.values(winRewards).forEach((card) => { if (card) sim.barracks.marketplaceCardIds.push(card.id); });

    let treasure = null;
    const tier = f + 1;
    if (tier <= 3) {
      const candidates = drawTreasureCandidates(plan, sim, tier);
      candidates.forEach((c) => sim.barracks.treasureIds.push(c.id));
      treasure = { tier, candidates, recommendedId: candidates.length ? candidates[0].id : null };
    }
    fights.push({ fightIndex: f, winRewards, treasure });
  }
  return { fights };
}
