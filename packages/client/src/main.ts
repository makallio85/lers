import {
  BOT_TYPES, BOT_TYPE_SETTINGS, BUILDING_GROUP_TYPES, BUILDING_TYPES, MAP_SIZE_SETTINGS, MAP_SIZE_TYPES, MAX_ORDER, MAX_SPECIALISTS,
  RACE_SETTINGS, RACE_TYPES, SOLDIER_STATS, SPECIALIST_TYPES, WORK_AREA_BUILDINGS, WORK_AREA_RADIUS, applyCommand, isSpecialistType, storedGold,
  buildingById, castleOf, createMatch, createWorld, groundProblem, isMilitaryBuilding, isSoldierType, isUnitType, loadGame, mapSizeTypeOf,
  placementProblem, saveGame, stepMatch, tileIndex, updateVision, buildingLabel, spellProblem, SPELL_RANGE, SPELL_STATS, DONKEY_LOAD, TRADE_UNLIMITED,
  BOARDING_RANGE, MAP_LAYOUT_TYPES, STARTING_GOODS_TYPES, VICTORY_TYPES, SHIP_TYPES, TRANSPORT_CAPACITY, isShipType, isWarMachineType, passengersOf
} from '../../simulation/src/index.ts';
import type { BotType, MapLayoutType, MapSizeType, ShipType, StartingGoodsType, VictoryType, RaceType, SoldierType, SpecialistType, SpellType, TradeModeType, BuildingGroupType, BuildingTypeId, Command, CommandResult, GoodType, Settler, World } from '../../simulation/src/index.ts';
import { MapView, TILE } from './renderer.ts';
import type { Ghost } from './renderer.ts';
import * as simulation from '../../simulation/src/index.ts';
import {
  GOODS_VIEWS, SETTLERS_VIEWS, formatClock, outsideStrength, renderBuildPanel, renderEndScreen, renderGameMenu, renderGoodsPanel, renderMessages,
  renderMilitaryPanel, renderOrderBar, renderSelection, renderSettlersPanel, renderSpeed, renderStatsPanel, renderStock, renderTabs, machinesOf
} from './ui.ts';
import type { GoodsViewId, MilitaryViewId, OrderMode, SettlersViewId, TabId } from './ui.ts';

const TICK_MS = 100;
const PLAYER = 0;
const SAVE_KEY = 'lers.save.v12';
const AUTOSAVE_KEY = 'lers.autosave.v12';
const AUTOSAVE_MS = 5 * 60 * 1000;
const DRAG_THRESHOLD = 6;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  side: $('side'), tabs: $('tabs'), panel: $('panel'), stock: $('stock'), clock: $('clock'), speed: $('speed'),
  map: $('map'), messages: $('messages'), hint: $('hint'), selection: $('selection'), orders: $('orders'),
  end: $('end-screen'), minimap: $<HTMLCanvasElement>('minimap'), mapName: $('map-name'), menu: $('game-menu'),
  menuButton: $('menu-button')
};

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000) + 1;
}

const params = new URLSearchParams(location.search);
const BOT_TYPE_KEY = 'lers.botType';
const MAP_SIZE_KEY = 'lers.mapSize';
const RACE_KEY = 'lers.race';
const MAP_LAYOUT_KEY = 'lers.mapLayout';
const MAP_HALVES_KEY = 'lers.mapHalves';
const STARTING_GOODS_KEY = 'lers.startingGoods';
const VICTORY_KEY = 'lers.victory';
/** Hash words such as `#calm`, `#small` or `#calm-small`, for hosts that pass only the hash to the page. */
const hashWords = location.hash.slice(1).split('-');

/** A choice made last time: from the address first, else remembered in this browser, else the default. */
function chosen<T extends string>(values: readonly T[], key: string, param: string, fallback: T): T {
  const asked = [params.get(param), ...hashWords].find((w) => w !== null && (values as readonly string[]).includes(w));
  if (asked) return asked as T;
  try {
    const kept = localStorage.getItem(key);
    if (kept && (values as readonly string[]).includes(kept)) return kept as T;
  } catch { /* storage blocked: use the default */ }
  return fallback;
}
function remember(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

/** The opponent and map size chosen last; the menu highlights them and "Play again" keeps them. */
let lastBotType: BotType = chosen(BOT_TYPES, BOT_TYPE_KEY, 'bot', 'aggressive');
let lastMapSize: MapSizeType = chosen(MAP_SIZE_TYPES, MAP_SIZE_KEY, 'size', 'medium');
let lastRace: RaceType = chosen(RACE_TYPES, RACE_KEY, 'race', 'romans');
let lastMapLayout: MapLayoutType = chosen(MAP_LAYOUT_TYPES, MAP_LAYOUT_KEY, 'land', 'continent');
let lastIsMirrored = chosen(['mirrored', 'own'] as const, MAP_HALVES_KEY, 'halves', 'mirrored') === 'mirrored';
let lastStartingGoods: StartingGoodsType = chosen(STARTING_GOODS_TYPES, STARTING_GOODS_KEY, 'goods', 'default');
/** The setup the menu has selected for the next match. */
let lastVictory: VictoryType = chosen(VICTORY_TYPES, VICTORY_KEY, 'victory', 'conquest');
const nextSetup = () => ({ isMirrored: lastIsMirrored, startingGoodsType: lastStartingGoods, victoryType: lastVictory });
const botType = (): BotType => world.players[1]?.botType ?? lastBotType;
const mapSize = (): MapSizeType => (isMatch() ? mapSizeTypeOf(world.width) : lastMapSize);
const seedParam = Number(params.get('seed'));
let world: World = params.get('mode') === 'sandbox'
  ? createWorld({ seed: Number.isInteger(seedParam) && seedParam > 0 ? seedParam : randomSeed() })
  : createMatch(Number.isInteger(seedParam) && seedParam > 0 ? seedParam : randomSeed(), lastBotType, lastMapSize, lastRace, undefined, lastMapLayout, nextSetup());

const ui = {
  tab: 'build' as TabId,
  groupType: 'resources' as BuildingGroupType,
  goodsView: 'inventory' as GoodsViewId,
  militaryView: 'recruiting' as MilitaryViewId,
  settlersView: 'counts' as SettlersViewId,
  /** A gatherer whose new work area the next map click sets. */
  workAreaFor: null as number | null,
  /** While setting a marketplace's route: the marketplace, and the spots tapped so far (the last is the route's end). */
  routeFor: null as number | null,
  routePoints: [] as { x: number; y: number }[],
  selectedType: 'woodcutter' as BuildingTypeId,
  placing: null as BuildingTypeId | null,
  ghost: null as Ghost | null,
  /** The building under the mouse pointer, whose name is shown on the map. */
  hoveredId: null as number | null,
  ghostKey: '',
  ghostProblem: null as string | null,
  markers: [] as number[],
  markersKey: '',
  isTouchPlacement: false,
  problem: null as string | null,
  problemUntil: 0,
  selectedId: null as number | null,
  isConfirmingDemolish: false,
  selectedSoldiers: new Set<number>(),
  groups: new Map<number, number[]>(),
  orderMode: null as OrderMode,
  /** The spell a selected priest is aiming, while the order mode is 'spell'. */
  spell: null as SpellType | null,
  selectionBox: null as { x0: number; y0: number; x1: number; y1: number } | null,
  speed: 1,
  isDrawerOpen: true,
  isMenuOpen: false,
  isConfirmingSurrender: false,
  menuNotice: null as string | null,
  isEndHidden: false,
  dismissed: new Set<number>()
};

const queue: Command[] = [];
const view = await MapView.create(els.map, world);
const isMatch = () => world.players.length > 1;

function showWorld(): void {
  els.mapName.textContent = isMatch()
    ? `${RACE_SETTINGS[world.players[PLAYER].raceType].label} · ${MAP_SIZE_SETTINGS[mapSizeTypeOf(world.width)].label.toLowerCase()} map ${world.seed} · ${BOT_TYPE_SETTINGS[world.players[1].botType].label} computer (${RACE_SETTINGS[world.players[1].raceType].label})`
    : `${RACE_SETTINGS[world.players[PLAYER].raceType].label} · sandbox · map ${world.seed}`;
  // Work out the fog of war before the first frame, so the start is not drawn as unexplored.
  updateVision(world);
  view.setWorld(world);
  const castle = castleOf(world, PLAYER)!;
  view.centreOn(castle.x + 2, castle.y + 2);
  minimapVersion = -1;
  ui.selectedId = null; ui.placing = null; ui.ghost = null; ui.markers = []; ui.markersKey = '';
  ui.selectedSoldiers.clear(); ui.groups.clear(); ui.orderMode = null; ui.isEndHidden = false; ui.workAreaFor = null;
  queue.length = 0;
}

// ---------------------------------------------------------------- saving

function storageRead(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageWrite(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

function savedLabel(key: string): string | null {
  const raw = storageRead(key);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { tick?: number; seed?: number; players?: unknown[] };
    return `${(data.players?.length ?? 1) > 1 ? 'match' : 'sandbox'} · map ${data.seed} · ${formatClock(data.tick ?? 0)}`;
  } catch { return 'damaged'; }
}

function save(key: string): boolean {
  return storageWrite(key, JSON.stringify(saveGame(world)));
}

function load(key: string): void {
  const raw = storageRead(key);
  if (!raw) { ui.menuNotice = 'There is no saved game in this browser.'; return; }
  try {
    world = loadGame(JSON.parse(raw));
    showWorld();
    ui.isMenuOpen = false;
    ui.menuNotice = null;
  } catch (error) {
    ui.menuNotice = error instanceof Error ? error.message : 'This save cannot be loaded.';
  }
}

let lastAutosave = performance.now();

// ---------------------------------------------------------------- panel rendering

function renderPanel(): void {
  els.tabs.innerHTML = renderTabs(ui.tab);
  els.side.classList.toggle('is-collapsed', !ui.isDrawerOpen);
  // Range inputs keep their position while being dragged; re-rendering under the pointer would reset them.
  if (document.activeElement instanceof HTMLInputElement && els.panel.contains(document.activeElement)) return;
  els.panel.innerHTML =
    ui.tab === 'build' ? renderBuildPanel(ui.groupType, ui.selectedType, ui.placing, world.players[PLAYER].raceType)
    : ui.tab === 'goods' ? renderGoodsPanel(world, ui.goodsView, PLAYER)
    : ui.tab === 'settlers' ? renderSettlersPanel(world, ui.settlersView, PLAYER)
    : ui.tab === 'military' ? renderMilitaryPanel(world, ui.militaryView, PLAYER, ui.groups)
    : renderStatsPanel(world, PLAYER);
}

function renderMenu(): void {
  els.menu.hidden = !ui.isMenuOpen;
  els.menuButton.setAttribute('aria-expanded', String(ui.isMenuOpen));
  if (ui.isMenuOpen) {
    els.menu.innerHTML = renderGameMenu({
      savedAt: savedLabel(SAVE_KEY), autosavedAt: savedLabel(AUTOSAVE_KEY), notice: ui.menuNotice,
      isMatch: isMatch() && world.winner === null, isConfirmingSurrender: ui.isConfirmingSurrender,
      botType: botType(), mapSize: lastMapSize, mapLayout: lastMapLayout, isMirrored: lastIsMirrored, startingGoodsType: lastStartingGoods, victoryType: lastVictory, raceType: lastRace
    });
  }
}

function renderHint(): void {
  if (!ui.placing && ui.routeFor !== null) {
    const n = ui.routePoints.length;
    els.hint.hidden = false;
    els.hint.innerHTML = `<span>Trade route</span><span>${n === 0 ? 'Tap up to 3 spots to pass, then the end: the caravans unload at your storage near it.' : `${n} ${n === 1 ? 'spot' : 'spots'} set; the last one is the end.`}</span>
      <button type="button" class="primary" data-action="route-done" ${n === 0 ? 'disabled' : ''}>Done</button>
      <button type="button" class="secondary" data-action="route-cancel">Cancel</button>`;
    return;
  }
  const workSite = buildingById(world, ui.workAreaFor);
  if (!ui.placing && workSite) {
    els.hint.hidden = false;
    els.hint.innerHTML = `<span>Work area of the ${BUILDING_TYPES[workSite.typeId].label.toLowerCase()}</span><span>Tap or click where it should work, on your land.</span>
      <button type="button" class="secondary" data-action="cancel-work-area">Cancel</button>`;
    return;
  }
  if (!ui.placing) { els.hint.hidden = true; return; }
  const label = buildingLabel(ui.placing, world.players[PLAYER].raceType);
  const problem = performance.now() < ui.problemUntil ? ui.problem : ui.ghost && !ui.ghost.isValid ? ui.ghostProblem : null;
  const instructions = ui.markers.length === 0 ? 'No free spot in your territory fits this building.'
    : ui.isTouchPlacement
      ? (ui.ghost ? 'Move it by tapping elsewhere, then press Place.' : 'Tap a green marker where it should go.')
      : 'Click a green marker to place it. Esc to cancel.';
  els.hint.hidden = false;
  els.hint.innerHTML = `<span>Placing ${label}</span><span class="${problem ? 'is-problem' : ''}">${problem ?? instructions}</span>
    ${ui.isTouchPlacement && ui.ghost ? `<button type="button" class="primary" data-action="confirm-place" ${ui.ghost.isValid ? '' : 'disabled'}>Place</button>` : ''}
    <button type="button" class="secondary" data-action="cancel-placing">Cancel</button>`;
}

/** Settlers the player can select and send: soldiers, war machines and specialists outside buildings. */
function isOwnUnit(s: Settler): boolean {
  return s.owner === PLAYER && !s.isInside && (isUnitType(s.settlerType) ? s.health > 0 : isSpecialistType(s.settlerType) || s.settlerType === 'priest');
}

function selectedSoldierList(): Settler[] {
  const out: Settler[] = [];
  for (const s of world.settlers) {
    if (ui.selectedSoldiers.has(s.id) && isOwnUnit(s)) out.push(s);
  }
  // Fallen or garrisoned soldiers drop out of the selection.
  if (out.length !== ui.selectedSoldiers.size) ui.selectedSoldiers = new Set(out.map((s) => s.id));
  return out;
}

function renderSelectionCard(): void {
  const b = buildingById(world, ui.selectedId);
  if (!b || !view.isBuildingVisible(b)) { ui.selectedId = null; ui.isConfirmingDemolish = false; els.selection.hidden = true; return; }
  if (ui.workAreaFor !== null || ui.routeFor !== null) { els.selection.hidden = true; return; }
  els.selection.hidden = false;
  els.selection.innerHTML = renderSelection(world, b, PLAYER, ui.isConfirmingDemolish, ui.selectedSoldiers.size);
}

function renderOrders(): void {
  const soldiers = selectedSoldierList();
  const isShown = world.winner === null && !ui.placing && (soldiers.length > 0 || ui.orderMode !== null || (isMatch() && ui.tab === 'military'));
  els.orders.hidden = !isShown;
  if (isShown) els.orders.innerHTML = renderOrderBar(soldiers, ui.orderMode, isTouchDevice(), outsideStrength(storedGold(world, PLAYER)),
    { manna: world.players[PLAYER].manna, race: world.players[PLAYER].raceType, spell: ui.spell }, world);
}

function renderEnd(): void {
  const isShown = world.winner !== null && !ui.isEndHidden;
  els.end.hidden = !isShown;
  if (isShown && !els.end.dataset.shown) { els.end.innerHTML = renderEndScreen(world, PLAYER); els.end.dataset.shown = '1'; }
  if (!isShown) delete els.end.dataset.shown;
}

function refreshLive(): void {
  els.stock.innerHTML = renderStock(world, PLAYER);
  els.clock.textContent = formatClock(world.tick);
  els.messages.innerHTML = renderMessages(world, PLAYER, ui.dismissed);
  if (ui.tab !== 'build') renderPanel();
  renderSelectionCard();
  renderHint();
  renderOrders();
  renderEnd();
  drawMinimap();
}

function renderSpeedButtons(): void { els.speed.innerHTML = renderSpeed(ui.speed); }

function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

// ---------------------------------------------------------------- minimap

const minimapBase = document.createElement('canvas');
let minimapVersion = -1;
function buildMinimapBase(): void {
  minimapBase.width = world.width; minimapBase.height = world.height;
  const ctx = minimapBase.getContext('2d')!;
  const img = ctx.createImageData(world.width, world.height);
  const vision = world.vision[PLAYER];
  for (let i = 0; i < world.width * world.height; i++) {
    const t = world.terrain[i];
    let [r, g, b] = t === 1 ? [79, 127, 166] : t === 2 ? [141, 138, 124] : [122, 148, 80];
    if (world.tree[i] >= 0) [r, g, b] = [61, 90, 46];
    if (world.field[i] >= 0) [r, g, b] = [217, 180, 74];
    const owner = world.territory[i];
    if (owner === 2) { r = r * 0.6 + 80; g *= 0.55; b *= 0.55; }
    else if (owner !== PLAYER + 1) { r *= 0.6; g *= 0.6; b *= 0.6; }
    if (vision && vision[i] === 0) [r, g, b] = [15, 20, 18];
    img.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
}
function drawMinimap(): void {
  if (getComputedStyle(els.minimap).display === 'none') return;
  const version = world.mapVersion * 100_000 + world.territoryVersion * 100 + Math.floor(world.tick / 50) % 100;
  if (minimapVersion !== version) { buildMinimapBase(); minimapVersion = version; }
  const ctx = els.minimap.getContext('2d')!;
  const sx = els.minimap.width / world.width, sy = els.minimap.height / world.height;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(minimapBase, 0, 0, els.minimap.width, els.minimap.height);
  for (const b of world.buildings) {
    if (!view.isBuildingVisible(b)) continue;
    ctx.fillStyle = b.owner === PLAYER ? '#ece6d6' : '#d05a5a';
    ctx.fillRect(b.x * sx, b.y * sy, b.size * sx, b.size * sy);
  }
  const v = view.visibleTiles();
  ctx.strokeStyle = '#e3a33b'; ctx.lineWidth = 2;
  ctx.strokeRect(v.x * sx, v.y * sy, v.w * sx, v.h * sy);
}
els.minimap.addEventListener('pointerdown', (e) => {
  const rect = els.minimap.getBoundingClientRect();
  view.centreOn(((e.clientX - rect.left) / rect.width) * world.width, ((e.clientY - rect.top) / rect.height) * world.height);
});

// ---------------------------------------------------------------- commands and placement

function submit(command: Command): void {
  // While paused, commands apply at once so players can plan; otherwise they wait for the next tick.
  if (ui.speed === 0) { handleResults([applyCommand(world, command)], [command]); refreshLive(); renderPanel(); }
  else queue.push(command);
}

function showProblem(reason: string): void {
  ui.problem = reason;
  ui.problemUntil = performance.now() + 2500;
  ui.menuNotice = null;
  showToast(reason);
}

let toastTimer = 0;
function showToast(text: string): void {
  els.hint.hidden = false;
  if (!ui.placing) {
    els.hint.innerHTML = `<span class="is-problem">${text.replace(/[<>&]/g, '')}</span>`;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { if (!ui.placing) els.hint.hidden = true; }, 2500);
  }
}

function handleResults(results: CommandResult[], commands: Command[]): void {
  let isPanelStale = false;
  results.forEach((result, k) => {
    const command = commands[k];
    if (!result.isAccepted) showProblem(result.reason);
    else if (command.type === 'placeBuilding') ui.selectedId = result.buildingId ?? null;
    else if (!['moveSoldiers', 'attackBuilding', 'moveSpecialists', 'patrolSoldiers', 'holdSoldiers'].includes(command.type)) isPanelStale = true;
  });
  if (isPanelStale) renderPanel();
}

/** Every top-left tile in the territory where the building fits on the ground (reachability is checked on placing). */
function refreshMarkers(): void {
  if (!ui.placing) { ui.markers = []; return; }
  const key = `${ui.placing}:${world.mapVersion}:${world.territoryVersion}`;
  if (key === ui.markersKey) return;
  ui.markersKey = key;
  const markers: number[] = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (world.territory[tileIndex(world, x, y)] !== PLAYER + 1) continue;
      if (groundProblem(world, PLAYER, ui.placing, x, y) === null) markers.push(tileIndex(world, x, y));
    }
  }
  ui.markers = markers;
}

function startPlacing(typeId: BuildingTypeId, isTouch: boolean): void {
  ui.placing = typeId;
  ui.isTouchPlacement = isTouch;
  ui.ghost = null; ui.ghostKey = ''; ui.markersKey = '';
  ui.selectedId = null; ui.orderMode = null;
  refreshMarkers();
  if (isTouch && window.matchMedia('(max-height: 520px), (max-width: 760px)').matches) ui.isDrawerOpen = false;
  renderPanel(); renderHint(); renderOrders();
}

function stopPlacing(): void {
  ui.placing = null; ui.ghost = null; ui.ghostKey = ''; ui.markers = [];
  renderPanel(); renderHint(); renderOrders();
}

function checkGhost(x: number, y: number): void {
  if (!ui.placing) return;
  const key = `${ui.placing}:${x}:${y}:${world.mapVersion}:${world.territoryVersion}`;
  if (key === ui.ghostKey) return;
  ui.ghostKey = key;
  ui.ghostProblem = placementProblem(world, PLAYER, ui.placing, x, y);
  ui.ghost = { typeId: ui.placing, x, y, isValid: ui.ghostProblem === null };
  renderHint();
}

function moveGhost(clientX: number, clientY: number): void {
  if (!ui.placing) return;
  const tile = view.screenToTile(clientX, clientY);
  const size = BUILDING_TYPES[ui.placing].size;
  checkGhost(tile.x - Math.floor(size / 2), tile.y - Math.floor(size / 2));
}

function confirmPlacement(): void {
  if (!ui.placing || !ui.ghost) return;
  if (!ui.ghost.isValid) { showProblem(ui.ghostProblem ?? 'It does not fit there'); renderHint(); return; }
  submit({ type: 'placeBuilding', playerId: PLAYER, buildingType: ui.placing, x: ui.ghost.x, y: ui.ghost.y });
  stopPlacing();
}

function buildingAt(clientX: number, clientY: number) {
  // Buildings stand upright, so a tap on the roof counts as well as one on the ground they stand on.
  const pictured = view.buildingAtScreen(clientX, clientY);
  if (pictured && view.isBuildingVisible(pictured)) return pictured;
  const tile = view.screenToTile(clientX, clientY);
  if (tile.x < 0 || tile.y < 0 || tile.x >= world.width || tile.y >= world.height) return undefined;
  const i = tileIndex(world, tile.x, tile.y);
  const b = buildingById(world, (world.footprint[i] || world.door[i]) - 1);
  return b && view.isBuildingVisible(b) ? b : undefined;
}

/** The player's own soldier outside a building nearest to a point, within about a tile. */
function soldierAt(clientX: number, clientY: number): Settler | undefined {
  // Settlers stand upright: measure on screen from the middle of the figure, not from its feet.
  const rect = view.app.canvas.getBoundingClientRect();
  const px = clientX - rect.left, py = clientY - rect.top;
  let best: Settler | undefined, bestDistance = 22 * Math.max(0.7, view.scale);
  for (const s of world.settlers) {
    if (!isOwnUnit(s)) continue;
    const feet = view.tileToCanvas(s.x, s.y);
    // A ship is several times a settler's size: its middle sits higher and it is easier to hit.
    const isShip = isShipType(s.settlerType);
    const d = Math.hypot(feet.x - px, feet.y - (isShip ? 40 : 12) * view.scale - py) * (isShip ? 0.5 : 1);
    if (d < bestDistance) { bestDistance = d; best = s; }
  }
  return best;
}

function tapAt(clientX: number, clientY: number, isAdding: boolean): void {
  ui.isConfirmingDemolish = false;
  if (ui.routeFor !== null) {
    const tile = view.screenToTile(clientX, clientY);
    if (tile.x < 0 || tile.y < 0 || tile.x >= world.width || tile.y >= world.height) return;
    if (ui.routePoints.length < 4) ui.routePoints.push(tile);
    if (ui.routePoints.length === 4) finishRoute(); else renderHint();
    return;
  }
  if (ui.workAreaFor !== null) {
    const tile = view.screenToTile(clientX, clientY);
    submit({ type: 'setWorkArea', playerId: PLAYER, buildingId: ui.workAreaFor, x: tile.x, y: tile.y });
    ui.selectedId = ui.workAreaFor; ui.workAreaFor = null;
    renderHint(); renderSelectionCard();
    return;
  }
  const soldier = soldierAt(clientX, clientY);
  if (soldier) {
    if (!isAdding) ui.selectedSoldiers.clear();
    ui.selectedSoldiers.add(soldier.id);
    ui.selectedId = null;
    renderSelectionCard(); renderOrders();
    return;
  }
  const b = buildingAt(clientX, clientY);
  ui.selectedId = b ? b.id : null;
  if (!b && !isAdding) ui.selectedSoldiers.clear();
  renderSelectionCard(); renderOrders();
}

function orderAt(clientX: number, clientY: number, mode: 'move' | 'attack' | 'auto' | 'waypoint' | 'patrol' | 'free'): void {
  const units = selectedSoldierList();
  const soldierIds = units.filter((s) => isUnitType(s.settlerType)).map((s) => s.id);
  const specialistIds = units.filter((s) => isSpecialistType(s.settlerType) || s.settlerType === 'priest').map((s) => s.id);
  if (units.length === 0) return;
  const b = buildingAt(clientX, clientY);
  const tile = view.screenToTile(clientX, clientY);
  // Specialists only ever walk to a spot and work there; soldiers may attack.
  if (specialistIds.length > 0 && mode !== 'attack') {
    submit({ type: 'moveSpecialists', playerId: PLAYER, settlerIds: specialistIds, x: tile.x, y: tile.y });
  }
  if (soldierIds.length > 0) {
    if (b && b.owner !== PLAYER && mode !== 'move') {
      submit({ type: 'attackBuilding', playerId: PLAYER, soldierIds, buildingId: b.id });
    } else if (mode === 'attack') {
      showProblem('Choose an enemy tower or castle to attack');
      return;
    } else if (mode === 'patrol') {
      submit({ type: 'patrolSoldiers', playerId: PLAYER, soldierIds, x: tile.x, y: tile.y });
    } else {
      submit({ type: 'moveSoldiers', playerId: PLAYER, soldierIds, x: tile.x, y: tile.y, isAppending: mode === 'waypoint', isIgnoringEnemies: mode === 'free' });
    }
  } else if (mode === 'attack') {
    showProblem('Only soldiers can attack');
    return;
  }
  // Waypoint mode stays on, so the player can tap one spot after another until Done.
  if (mode !== 'waypoint' || ui.orderMode !== 'waypoint') ui.orderMode = null;
  renderOrders();
}

/** Sends the tapped route: the last spot is the end, the ones before it waypoints. */
function finishRoute(): void {
  const points = ui.routePoints, id = ui.routeFor;
  ui.routeFor = null; ui.routePoints = [];
  if (id !== null && points.length > 0) {
    const end = points[points.length - 1];
    submit({ type: 'setTradeRoute', playerId: PLAYER, buildingId: id, x: end.x, y: end.y, waypoints: points.slice(0, -1) });
    ui.selectedId = id;
  }
  renderHint(); renderSelectionCard();
}

/** Casts the aimed spell on the spot with the selected priest that can (the nearest one first). */
function castAt(clientX: number, clientY: number): void {
  const spell = ui.spell;
  if (!spell) return;
  const tile = view.screenToTile(clientX, clientY);
  const priests = selectedSoldierList().filter((s) => s.settlerType === 'priest')
    .sort((a, b) => Math.hypot(a.x - tile.x, a.y - tile.y) - Math.hypot(b.x - tile.x, b.y - tile.y));
  const able = priests.find((p) => spellProblem(world, p, spell, tile.x, tile.y) === null);
  if (!able) { showProblem(priests.length ? spellProblem(world, priests[0], spell, tile.x, tile.y)! : 'Select a priest first'); return; }
  submit({ type: 'castSpell', playerId: PLAYER, priestId: able.id, spell, x: tile.x, y: tile.y });
  ui.orderMode = null; ui.spell = null;
  renderOrders();
}

function selectInBox(x0: number, y0: number, x1: number, y1: number, isAdding: boolean): void {
  const left = Math.min(x0, x1), right = Math.max(x0, x1), top = Math.min(y0, y1), bottom = Math.max(y0, y1);
  if (!isAdding) ui.selectedSoldiers.clear();
  for (const s of world.settlers) {
    if (!isOwnUnit(s)) continue;
    const p = view.tileToCanvas(s.x, s.y);
    if (p.x >= left && p.x <= right && p.y >= top && p.y <= bottom) ui.selectedSoldiers.add(s.id);
  }
  if (ui.selectedSoldiers.size > 0) ui.selectedId = null;
  renderSelectionCard(); renderOrders();
}

/** Tab: the player's wounded soldiers outside, so they can be sent to a healer. */
function selectWounded(): void {
  ui.selectedSoldiers = new Set(world.settlers.filter((s) => s.owner === PLAYER && isSoldierType(s.settlerType) && !s.isInside
    && s.health < SOLDIER_STATS[s.settlerType].health).map((s) => s.id));
  if (ui.selectedSoldiers.size === 0) showProblem('No wounded soldiers outside');
  ui.selectedId = null; renderSelectionCard(); renderOrders();
}

function holdSelected(): void {
  const ids = selectedSoldierList().filter((s) => isSoldierType(s.settlerType)).map((s) => s.id);
  if (ids.length) submit({ type: 'holdSoldiers', playerId: PLAYER, soldierIds: ids });
  ui.orderMode = null; renderOrders();
}

function selectInView(): void {
  const rect = view.app.canvas.getBoundingClientRect();
  selectInBox(0, 0, rect.width, rect.height, false);
}

// ---------------------------------------------------------------- pointer, wheel and keyboard input

const pointers = new Map<number, { x: number; y: number; startX: number; startY: number; button: number }>();
let gesture: 'none' | 'pan' | 'box' = 'none';
let pinchDistance = 0;
const canvas = view.app.canvas;

function canvasPoint(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, button: e.button });
  gesture = 'none';
  if (ui.isMenuOpen) { ui.isMenuOpen = false; renderMenu(); }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    ui.selectionBox = null;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    if (e.pointerType === 'mouse' && ui.placing && !ui.isTouchPlacement) moveGhost(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') ui.hoveredId = ui.placing ? null : buildingAt(e.clientX, e.clientY)?.id ?? null;
    return;
  }
  if (pointers.size === 2) {
    p.x = e.clientX; p.y = e.clientY;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDistance > 0) view.zoomAt(d / pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinchDistance = d;
    gesture = 'pan';
    return;
  }
  if (gesture === 'none' && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > DRAG_THRESHOLD) {
    // Mouse: left-drag selects soldiers, right or middle drag scrolls. Touch: drag scrolls unless in Select mode.
    const isBoxDrag = !ui.placing && (e.pointerType === 'mouse' ? p.button === 0 : ui.orderMode === 'select');
    gesture = isBoxDrag ? 'box' : 'pan';
  }
  if (gesture === 'pan') view.panBy(e.clientX - p.x, e.clientY - p.y);
  if (gesture === 'box') {
    const rect = canvas.getBoundingClientRect();
    ui.selectionBox = { x0: p.startX - rect.left, y0: p.startY - rect.top, ...(() => { const c = canvasPoint(e); return { x1: c.x, y1: c.y }; })() };
  }
  p.x = e.clientX; p.y = e.clientY;
  if (gesture === 'none' && e.pointerType === 'mouse' && ui.placing && !ui.isTouchPlacement) moveGhost(e.clientX, e.clientY);
});

function endPointer(e: PointerEvent): void {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDistance = 0;
  if (!p || pointers.size > 0 || e.type === 'pointercancel') { ui.selectionBox = null; return; }
  if (gesture === 'box' && ui.selectionBox) {
    const b = ui.selectionBox;
    ui.selectionBox = null;
    selectInBox(b.x0, b.y0, b.x1, b.y1, e.shiftKey);
    if (ui.orderMode === 'select') ui.orderMode = null;
    renderOrders();
    return;
  }
  if (gesture !== 'none') return;
  const isRight = p.button === 2;
  if (ui.placing) {
    if (isRight) { stopPlacing(); return; }
    if (e.pointerType === 'mouse' && !ui.isTouchPlacement) { moveGhost(e.clientX, e.clientY); confirmPlacement(); }
    else { ui.isTouchPlacement = true; moveGhost(e.clientX, e.clientY); renderHint(); }
    return;
  }
  // As in the original: Shift + right-click adds a waypoint, Alt + right-click patrols.
  if (isRight) { orderAt(e.clientX, e.clientY, e.shiftKey ? 'waypoint' : e.altKey ? 'patrol' : 'auto'); return; }
  if (ui.orderMode === 'spell') { castAt(e.clientX, e.clientY); return; }
  if (ui.orderMode && ui.orderMode !== 'select') { orderAt(e.clientX, e.clientY, ui.orderMode); return; }
  tapAt(e.clientX, e.clientY, e.shiftKey);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const key = e.key.toLowerCase();
  if (/^[1-9]$/.test(key)) {
    const n = Number(key);
    // Alt+number saves a group as in the original game; Ctrl+number does the same.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      e.preventDefault();
      const ids = selectedSoldierList().map((s) => s.id);
      if (ids.length > 0) { ui.groups.set(n, ids); renderPanel(); }
    } else {
      const alive = new Set(world.settlers.filter((s) => s.owner === PLAYER && !s.isInside).map((s) => s.id));
      ui.selectedSoldiers = new Set((ui.groups.get(n) ?? []).filter((id) => alive.has(id)));
      renderOrders();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const group = BUILDING_GROUP_TYPES.find((g) => g.key === key);
  const goodsView = GOODS_VIEWS.find((v) => v.key === key);
  const settlersView = SETTLERS_VIEWS.find((v) => v.key === key);
  if (e.key === 'Tab') {
    e.preventDefault(); selectWounded(); return;
  }
  if (key === 'h' && selectedSoldierList().some((s) => isSoldierType(s.settlerType))) {
    holdSelected(); return;
  }
  if (e.key === 'Escape') {
    if (ui.isMenuOpen) { ui.isMenuOpen = false; renderMenu(); }
    else if (ui.workAreaFor !== null) { ui.workAreaFor = null; renderHint(); }
    else if (ui.placing) stopPlacing();
    else if (ui.orderMode) { ui.orderMode = null; renderOrders(); }
    else { ui.selectedId = null; ui.selectedSoldiers.clear(); renderSelectionCard(); renderOrders(); }
  } else if (e.key === ' ' && (e.target === document.body || e.target === canvas)) {
    e.preventDefault(); setSpeed(ui.speed === 0 ? 1 : 0);
  } else if (group) {
    ui.tab = 'build'; ui.groupType = group.id; ui.isDrawerOpen = true;
    selectFirstOfGroup(); renderPanel();
  } else if (goodsView) {
    ui.tab = 'goods'; ui.goodsView = goodsView.id; ui.isDrawerOpen = true; renderPanel();
  } else if (settlersView) {
    ui.tab = 'settlers'; ui.settlersView = settlersView.id; ui.isDrawerOpen = true; renderPanel();
  } else if (key.startsWith('arrow')) {
    e.preventDefault(); keys.add(key);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function setSpeed(speed: number): void { ui.speed = speed; renderSpeedButtons(); }

function selectFirstOfGroup(): void {
  const first = Object.values(BUILDING_TYPES).find((t) => t.groupType === ui.groupType && t.isAvailable)
    ?? Object.values(BUILDING_TYPES).find((t) => t.groupType === ui.groupType);
  if (first) ui.selectedType = first.id;
}

function startNew(next: World): void {
  world = next;
  showWorld();
  ui.isMenuOpen = false; ui.isConfirmingSurrender = false;
  renderMenu(); renderPanel(); refreshLive();
}

// ---------------------------------------------------------------- button actions

document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const { action } = target.dataset;
  const isTouch = (e as PointerEvent).pointerType === 'touch' || isTouchDevice();
  const selected = buildingById(world, ui.selectedId);
  const delta = Number(target.dataset.delta ?? 0);
  const player = world.players[PLAYER];
  switch (action) {
    case 'tab': {
      const tab = target.dataset.tab as TabId;
      if (ui.tab === tab) ui.isDrawerOpen = !ui.isDrawerOpen; else { ui.tab = tab; ui.isDrawerOpen = true; }
      renderPanel(); renderOrders(); break;
    }
    case 'group': ui.groupType = target.dataset.group as BuildingGroupType; selectFirstOfGroup(); renderPanel(); break;
    case 'goods-view': ui.goodsView = target.dataset.view as GoodsViewId; renderPanel(); break;
    case 'military-view': ui.militaryView = target.dataset.view as MilitaryViewId; renderPanel(); break;
    case 'settlers-view': ui.settlersView = target.dataset.view as SettlersViewId; renderPanel(); break;
    case 'specialists': {
      const type = target.dataset.type as SpecialistType;
      if (!(SPECIALIST_TYPES as readonly string[]).includes(type)) break;
      const have = world.settlers.filter((s) => s.owner === PLAYER && s.settlerType === type).length;
      submit({ type: 'setSpecialists', playerId: PLAYER, specialistType: type, count: Math.max(0, Math.min(MAX_SPECIALISTS, have + delta)) });
      break;
    }
    case 'select-specialists':
      ui.selectedSoldiers = new Set(world.settlers.filter((s) => s.owner === PLAYER && s.settlerType === target.dataset.type && !s.isInside).map((s) => s.id));
      ui.selectedId = null; renderSelectionCard(); renderOrders(); break;
    case 'work-area':
      if (selected) {
        ui.workAreaFor = selected.id; ui.orderMode = null;
        // On small screens the drawer and the card would cover the map you need to tap.
        if (window.matchMedia('(max-height: 520px), (max-width: 760px)').matches) ui.isDrawerOpen = false;
        renderPanel(); renderHint(); renderOrders(); renderSelectionCard();
      }
      break;
    case 'cancel-work-area': ui.workAreaFor = null; renderHint(); break;
    case 'toggle-priority':
      if (selected) submit({ type: 'setSitePriority', playerId: PLAYER, buildingId: selected.id, isPriority: !selected.isPriority });
      break;
    case 'select-type': ui.selectedType = target.dataset.type as BuildingTypeId; renderPanel(); break;
    case 'start-placing': startPlacing(ui.selectedType, isTouch); break;
    case 'cancel-placing': stopPlacing(); break;
    case 'confirm-place': confirmPlacement(); break;
    case 'speed': setSpeed(Number(target.dataset.speed)); break;
    case 'deselect': ui.selectedId = null; renderSelectionCard(); break;
    case 'toggle-pause':
      if (selected) submit({ type: 'setBuildingPaused', playerId: PLAYER, buildingId: selected.id, isPaused: !selected.isPaused });
      break;
    case 'demolish': ui.isConfirmingDemolish = true; renderSelectionCard(); break;
    case 'cancel-demolish': ui.isConfirmingDemolish = false; renderSelectionCard(); break;
    case 'confirm-demolish':
      if (selected) submit({ type: 'demolishBuilding', playerId: PLAYER, buildingId: selected.id });
      ui.isConfirmingDemolish = false;
      break;
    case 'toggle-stored': {
      const good = target.dataset.good as GoodType;
      submit({ type: 'setGoodStored', playerId: PLAYER, good, isStored: !player.isStored[good] });
      break;
    }
    case 'priority':
      submit({ type: 'setTransportPriority', playerId: PLAYER, good: target.dataset.good as GoodType, position: Number(target.dataset.position) });
      break;
    case 'order': {
      const good = target.dataset.good as GoodType;
      const count = Math.max(0, Math.min(MAX_ORDER, (player.productionOrders[good] ?? 0) + delta));
      submit({ type: 'setProductionOrder', playerId: PLAYER, good, count });
      break;
    }
    case 'recruit-mode':
      submit({ type: 'setRecruiting', playerId: PLAYER, isAutomatic: target.dataset.auto === 'true', count: player.recruitsLeft });
      break;
    case 'recruit-count':
      submit({ type: 'setRecruiting', playerId: PLAYER, isAutomatic: false, count: Math.max(0, Math.min(MAX_ORDER, player.recruitsLeft + delta)) });
      break;
    case 'garrison': {
      const b = buildingById(world, Number(target.dataset.id));
      if (!b || !isMilitaryBuilding(b)) break;
      const min = b.typeId === 'castle' ? 0 : 1;
      const count = Math.max(min, Math.min(BUILDING_TYPES[b.typeId].garrisonCapacity, b.garrisonWanted + delta));
      submit({ type: 'setGarrisonWanted', playerId: PLAYER, buildingId: b.id, count });
      break;
    }
    case 'select-group': {
      const alive = new Set(world.settlers.filter((s) => s.owner === PLAYER && !s.isInside).map((s) => s.id));
      ui.selectedSoldiers = new Set((ui.groups.get(Number(target.dataset.groupNumber)) ?? []).filter((id) => alive.has(id)));
      renderOrders(); break;
    }
    case 'select-free':
      ui.selectedSoldiers = new Set(world.settlers.filter((s) => s.owner === PLAYER && isSoldierType(s.settlerType) && !s.isInside).map((s) => s.id));
      renderOrders(); break;
    case 'select-in-view': selectInView(); break;
    case 'select-wounded': selectWounded(); break;
    case 'hold': holdSelected(); break;
    case 'order-mode': {
      const mode = target.dataset.mode as Exclude<OrderMode, null>;
      ui.orderMode = ui.orderMode === mode ? null : mode;
      renderOrders(); break;
    }
    case 'clear-selection': ui.selectedSoldiers.clear(); ui.orderMode = null; renderOrders(); renderSelectionCard(); break;
    case 'back-to-towers': {
      const ids = selectedSoldierList().map((s) => s.id);
      const castle = castleOf(world, PLAYER);
      if (ids.length && castle) submit({ type: 'moveSoldiers', playerId: PLAYER, soldierIds: ids, x: castle.doorX, y: castle.doorY + 2 });
      break;
    }
    case 'set-route':
      if (selected) { ui.routeFor = selected.id; ui.routePoints = []; ui.orderMode = null; renderHint(); renderSelectionCard(); }
      break;
    case 'route-done': finishRoute(); break;
    case 'route-cancel': ui.routeFor = null; ui.routePoints = []; renderHint(); renderSelectionCard(); break;
    case 'trade-mode':
      if (selected) submit({ type: 'setTradeMode', playerId: PLAYER, buildingId: selected.id, mode: target.dataset.mode as TradeModeType });
      renderSelectionCard(); break;
    case 'trade-good': {
      if (!selected?.tradeRoute) break;
      const good = target.dataset.good as GoodType;
      const amount = selected.tradeRoute.goods[good] ?? 0;
      // Steps of a donkey's load, up to 64; one more step means "all".
      const up = amount === TRADE_UNLIMITED ? TRADE_UNLIMITED : amount >= 64 ? TRADE_UNLIMITED : amount + DONKEY_LOAD;
      const down = amount === TRADE_UNLIMITED ? 64 : Math.max(0, amount - DONKEY_LOAD);
      submit({ type: 'setTradeGood', playerId: PLAYER, buildingId: selected.id, good, amount: target.dataset.step === '1' ? up : down });
      renderSelectionCard(); break;
    }
    case 'cast-mode': {
      const spell = target.dataset.spell as SpellType;
      const isOff = ui.orderMode === 'spell' && ui.spell === spell;
      ui.orderMode = isOff ? null : 'spell'; ui.spell = isOff ? null : spell;
      renderOrders(); break;
    }
    case 'promote':
      submit({ type: 'promoteSoldiers', playerId: PLAYER, soldierType: target.dataset.type as SoldierType });
      renderPanel(); break;
    case 'select-hall-machines': {
      const hall = buildingById(world, ui.selectedId);
      if (!hall) break;
      ui.selectedSoldiers = new Set(machinesOf(world, hall).map((s) => s.id));
      ui.selectedId = null; renderSelectionCard(); renderOrders();
      break;
    }
    case 'attack-selected': {
      const ids = selectedSoldierList().filter((s) => isUnitType(s.settlerType)).map((s) => s.id);
      if (ids.length && selected) submit({ type: 'attackBuilding', playerId: PLAYER, soldierIds: ids, buildingId: selected.id });
      break;
    }
    case 'dismiss': ui.dismissed.add(Number(target.dataset.id)); refreshLive(); break;
    case 'show-building': {
      const b = buildingById(world, Number(target.dataset.id));
      if (b) { view.centreOn(b.x + b.size / 2, b.y + b.size / 2); ui.selectedId = b.id; renderSelectionCard(); }
      break;
    }
    case 'menu': ui.isMenuOpen = !ui.isMenuOpen; ui.menuNotice = null; ui.isConfirmingSurrender = false; renderMenu(); break;
    case 'save':
      ui.menuNotice = save(SAVE_KEY) ? `Saved at ${formatClock(world.tick)}.` : 'This browser does not allow saving here.';
      renderMenu(); break;
    case 'load': load(SAVE_KEY); renderMenu(); renderPanel(); refreshLive(); break;
    case 'load-autosave': load(AUTOSAVE_KEY); renderMenu(); renderPanel(); refreshLive(); break;
    case 'new-match': {
      const type = (BOT_TYPES as readonly string[]).includes(target.dataset.bot ?? '') ? target.dataset.bot as BotType : botType();
      lastBotType = type; remember(BOT_TYPE_KEY, type);
      startNew(createMatch(randomSeed(), type, lastMapSize, lastRace, undefined, lastMapLayout, nextSetup()));
      break;
    }
    case 'race':
      if ((RACE_TYPES as readonly string[]).includes(target.dataset.race ?? '')) { lastRace = target.dataset.race as RaceType; remember(RACE_KEY, lastRace); }
      renderMenu(); break;
    case 'map-size':
      if ((MAP_SIZE_TYPES as readonly string[]).includes(target.dataset.size ?? '')) {
        lastMapSize = target.dataset.size as MapSizeType; remember(MAP_SIZE_KEY, lastMapSize);
      }
      renderMenu(); break;
    case 'map-layout':
      if ((MAP_LAYOUT_TYPES as readonly string[]).includes(target.dataset.layout ?? '')) {
        lastMapLayout = target.dataset.layout as MapLayoutType; remember(MAP_LAYOUT_KEY, lastMapLayout);
      }
      renderMenu(); break;
    case 'victory':
      if ((VICTORY_TYPES as readonly string[]).includes(target.dataset.victory ?? '')) { lastVictory = target.dataset.victory as VictoryType; remember(VICTORY_KEY, lastVictory); }
      renderMenu(); break;
    case 'map-mirror':
      lastIsMirrored = target.dataset.mirrored === 'true'; remember(MAP_HALVES_KEY, lastIsMirrored ? 'mirrored' : 'own');
      renderMenu(); break;
    case 'starting-goods':
      if ((STARTING_GOODS_TYPES as readonly string[]).includes(target.dataset.goods ?? '')) {
        lastStartingGoods = target.dataset.goods as StartingGoodsType; remember(STARTING_GOODS_KEY, lastStartingGoods);
      }
      renderMenu(); break;
    case 'ship-order': {
      const b = buildingById(world, Number(target.dataset.id));
      const ship = target.dataset.ship as ShipType;
      if (!b || b.typeId !== 'shipyard' || !(SHIP_TYPES as readonly string[]).includes(ship)) break;
      submit({ type: 'setShipOrder', playerId: PLAYER, buildingId: b.id, shipType: ship, count: Math.max(0, Math.min(20, (b.shipOrders[ship] ?? 0) + delta)) });
      renderSelectionCard(); break;
    }
    case 'board-nearby': {
      // Each selected transport ship takes the player's units waiting near it, nearest first, while it has room.
      const taken = new Set<number>();
      for (const ship of selectedSoldierList().filter((s) => s.settlerType === 'transport_ship')) {
        const room = TRANSPORT_CAPACITY[world.players[PLAYER].raceType] - passengersOf(world, ship).length;
        const near = world.settlers.filter((u) => isOwnUnit(u) && !isShipType(u.settlerType) && !isWarMachineType(u.settlerType) && !taken.has(u.id)
          && Math.hypot(u.x - ship.x, u.y - ship.y) <= BOARDING_RANGE + 0.5)
          .sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y)).slice(0, room);
        if (near.length === 0) continue;
        near.forEach((u) => taken.add(u.id));
        submit({ type: 'boardShip', playerId: PLAYER, shipId: ship.id, unitIds: near.map((u) => u.id) });
      }
      if (taken.size === 0) showProblem(`Nobody waits within ${BOARDING_RANGE} tiles of the ship`);
      renderOrders(); break;
    }
    case 'release-specialists': {
      const ids = selectedSoldierList().filter((s) => isSpecialistType(s.settlerType)).map((s) => s.id);
      if (ids.length) submit({ type: 'releaseSpecialists', playerId: PLAYER, settlerIds: ids });
      ui.selectedSoldiers.clear(); ui.orderMode = null; renderOrders(); renderPanel();
      break;
    }
    case 'unload-ships':
      for (const ship of selectedSoldierList().filter((s) => passengersOf(world, s).length > 0)) submit({ type: 'unloadShip', playerId: PLAYER, shipId: ship.id });
      renderOrders(); break;
    case 'new-sandbox': startNew(createWorld({ seed: randomSeed(), raceTypes: [lastRace] })); break;
    case 'play-again': startNew(isMatch() ? createMatch(world.seed, botType(), mapSize(), world.players[PLAYER].raceType, world.players[1].raceType, world.mapLayout,
      { isMirrored: world.isMirrored, startingGoodsType: world.startingGoodsType, victoryType: world.victoryType }) : createWorld({ seed: world.seed, raceTypes: [world.players[PLAYER].raceType] })); break;
    case 'close-end': ui.isEndHidden = true; renderEnd(); break;
    case 'surrender': ui.isConfirmingSurrender = true; renderMenu(); break;
    case 'cancel-surrender': ui.isConfirmingSurrender = false; renderMenu(); break;
    case 'confirm-surrender':
      submit({ type: 'surrender', playerId: PLAYER });
      ui.isMenuOpen = false; ui.isConfirmingSurrender = false; renderMenu();
      break;
  }
});

// Share sliders for tools, weapons and distribution.
document.addEventListener('change', (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'range') return;
  const share = Number(input.value);
  if (input.dataset.occupation) {
    const player = world.players[PLAYER];
    const isCarrier = input.dataset.occupation === 'minCarrier';
    submit({ type: 'setOccupations', playerId: PLAYER, minCarrierPercent: isCarrier ? share : player.minCarrierPercent, maxCrewPercent: isCarrier ? player.maxCrewPercent : share });
  } else if (input.dataset.shareGood) {
    submit({ type: 'setProductionShare', playerId: PLAYER, good: input.dataset.shareGood as GoodType, share });
  } else if (input.dataset.distributionGood) {
    submit({ type: 'setDistribution', playerId: PLAYER, good: input.dataset.distributionGood as GoodType, buildingType: input.dataset.buildingType as BuildingTypeId, share });
  }
  input.blur();
});

$('zoom-in').addEventListener('click', () => view.zoomCentre(1.25));
$('zoom-out').addEventListener('click', () => view.zoomCentre(0.8));

// ---------------------------------------------------------------- game loop

let last = performance.now();
let accumulator = 0;
let lastLive = 0;

function frame(now: number): void {
  const dt = Math.min(250, now - last);
  last = now;
  if (ui.speed > 0 && world.winner === null) {
    accumulator += dt * ui.speed;
    while (accumulator >= TICK_MS) {
      const commands = queue.splice(0);
      handleResults(stepMatch(world, commands), commands);
      accumulator -= TICK_MS;
    }
    if (now - lastAutosave > AUTOSAVE_MS) { lastAutosave = now; save(AUTOSAVE_KEY); }
  } else if (queue.length > 0) {
    const commands = queue.splice(0);
    handleResults(commands.map((c) => applyCommand(world, c)), commands);
  }
  const pan = 0.6 * dt;
  if (keys.has('arrowleft')) view.panBy(pan, 0);
  if (keys.has('arrowright')) view.panBy(-pan, 0);
  if (keys.has('arrowup')) view.panBy(0, pan);
  if (keys.has('arrowdown')) view.panBy(0, -pan);
  if (ui.placing) {
    refreshMarkers();
    // Re-check the preview when the map changes under it (a tree grows, a site is placed).
    if (ui.ghost) checkGhost(ui.ghost.x, ui.ghost.y);
  }
  view.render(ui.speed > 0 && world.winner === null ? accumulator / TICK_MS : 1, {
    ghost: ui.ghost, markers: ui.markers, markerSize: ui.placing ? BUILDING_TYPES[ui.placing].size : 0, selectedId: ui.selectedId, hoveredId: ui.hoveredId,
    selectedSoldiers: ui.selectedSoldiers, selectionBox: ui.selectionBox, workArea: workAreaShown(), spellRange: spellRangeShown(), tradeRoute: tradeRouteShown()
  });
  if (now - lastLive > 250) { lastLive = now; refreshLive(); }
  requestAnimationFrame(frame);
}

/** The route of the selected marketplace, or the one being set: from its door through the spots in order. */
function tradeRouteShown(): { from: { x: number; y: number }; points: { x: number; y: number }[] } | null {
  const b = buildingById(world, ui.routeFor ?? ui.selectedId);
  if (!b || (b.typeId !== 'marketplace' && b.typeId !== 'landing_dock') || b.owner !== PLAYER) return null;
  if (ui.routeFor !== null) return { from: { x: b.doorX, y: b.doorY }, points: ui.routePoints };
  if (!b.tradeRoute) return null;
  const w = world.width;
  return { from: { x: b.doorX, y: b.doorY }, points: [...b.tradeRoute.waypoints.map((i) => ({ x: i % w, y: Math.floor(i / w) })), { x: b.tradeRoute.x, y: b.tradeRoute.y }] };
}

/** While a priest aims a spell that needs him near: how far he reaches. */
function spellRangeShown(): { x: number; y: number; radius: number } | null {
  if (ui.orderMode !== 'spell' || !ui.spell || SPELL_STATS[ui.spell].isRanged) return null;
  const priest = selectedSoldierList().find((s) => s.settlerType === 'priest');
  return priest ? { x: priest.x, y: priest.y, radius: SPELL_RANGE } : null;
}

/** The selected gatherer's work area, or the one being set. */
function workAreaShown(): { x: number; y: number; radius: number } | null {
  const b = buildingById(world, ui.workAreaFor ?? ui.selectedId);
  if (!b || b.owner !== PLAYER || !b.isComplete || !(WORK_AREA_BUILDINGS as readonly string[]).includes(b.typeId)) return null;
  const radius = WORK_AREA_RADIUS[b.typeId as (typeof WORK_AREA_BUILDINGS)[number]];
  return { x: b.workX ?? b.doorX, y: b.workY ?? b.doorY, radius };
}

showWorld();
view.zoomCentre(0.8);
view.centreOn(castleOf(world, PLAYER)!.x + 2, castleOf(world, PLAYER)!.y + 2);
renderPanel();
renderSpeedButtons();
refreshLive();
requestAnimationFrame(frame);

// Exposed for automated screenshots and debugging in the browser console.
Object.defineProperty(window, 'lers', {
  get: () => ({ world, view, ui, TILE, placementProblem, stepMatch, setSpeed, refreshLive, simulation, renderPanel, renderSelectionCard, renderOrders })
});
