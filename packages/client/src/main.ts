import {
  BUILDING_GROUP_TYPES, BUILDING_TYPES, applyCommand, buildingById, castleOf, createWorld, groundProblem, loadGame,
  placementProblem, saveGame, step, tileIndex
} from '../../simulation/src/index.ts';
import type { BuildingGroupType, BuildingTypeId, Command, CommandResult, GoodType, World } from '../../simulation/src/index.ts';
import { MapView, TILE } from './renderer.ts';
import type { Ghost } from './renderer.ts';
import {
  GOODS_VIEWS, formatClock, renderBuildPanel, renderGameMenu, renderGoodsPanel, renderMessages, renderMilitaryPanel,
  renderSelection, renderSettlersPanel, renderSpeed, renderStatsPanel, renderStock, renderTabs
} from './ui.ts';
import type { GoodsViewId, TabId } from './ui.ts';

const TICK_MS = 100;
const PLAYER = 0;
const SAVE_KEY = 'lers.save.v1';
const AUTOSAVE_KEY = 'lers.autosave.v1';
const AUTOSAVE_MS = 5 * 60 * 1000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  side: $('side'), tabs: $('tabs'), panel: $('panel'), stock: $('stock'), clock: $('clock'), speed: $('speed'),
  map: $('map'), messages: $('messages'), hint: $('hint'), selection: $('selection'),
  minimap: $<HTMLCanvasElement>('minimap'), mapName: $('map-name'), menu: $('game-menu'), menuButton: $('menu-button')
};

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000) + 1;
}

const seedParam = Number(new URLSearchParams(location.search).get('seed'));
let world: World = createWorld({ seed: Number.isInteger(seedParam) && seedParam > 0 ? seedParam : randomSeed() });

const ui = {
  tab: 'build' as TabId,
  groupType: 'resources' as BuildingGroupType,
  goodsView: 'inventory' as GoodsViewId,
  selectedType: 'woodcutter' as BuildingTypeId,
  placing: null as BuildingTypeId | null,
  ghost: null as Ghost | null,
  ghostKey: '',
  ghostProblem: null as string | null,
  markers: [] as number[],
  markersKey: '',
  isTouchPlacement: false,
  problem: null as string | null,
  problemUntil: 0,
  selectedId: null as number | null,
  isConfirmingDemolish: false,
  speed: 1,
  isDrawerOpen: true,
  isMenuOpen: false,
  menuNotice: null as string | null,
  dismissed: new Set<number>()
};

const queue: Command[] = [];
const view = await MapView.create(els.map, world);

function showWorld(): void {
  els.mapName.textContent = `Sandbox · map ${world.seed}`;
  view.setWorld(world);
  const castle = castleOf(world, PLAYER)!;
  view.centreOn(castle.x + 2, castle.y + 2);
  minimapVersion = -1;
  ui.selectedId = null; ui.placing = null; ui.ghost = null; ui.markers = []; ui.markersKey = '';
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
    const data = JSON.parse(raw) as { tick?: number; seed?: number };
    return `map ${data.seed} · ${formatClock(data.tick ?? 0)}`;
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
  els.panel.innerHTML =
    ui.tab === 'build' ? renderBuildPanel(ui.groupType, ui.selectedType, ui.placing)
    : ui.tab === 'goods' ? renderGoodsPanel(world, ui.goodsView)
    : ui.tab === 'settlers' ? renderSettlersPanel(world)
    : ui.tab === 'military' ? renderMilitaryPanel(world)
    : renderStatsPanel(world);
}

function renderMenu(): void {
  els.menu.hidden = !ui.isMenuOpen;
  els.menuButton.setAttribute('aria-expanded', String(ui.isMenuOpen));
  if (ui.isMenuOpen) els.menu.innerHTML = renderGameMenu(savedLabel(SAVE_KEY), savedLabel(AUTOSAVE_KEY), ui.menuNotice);
}

function renderHint(): void {
  if (!ui.placing) { els.hint.hidden = true; return; }
  const label = BUILDING_TYPES[ui.placing].label;
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

function renderSelectionCard(): void {
  const b = buildingById(world, ui.selectedId);
  if (!b) { ui.selectedId = null; ui.isConfirmingDemolish = false; els.selection.hidden = true; return; }
  els.selection.hidden = false;
  els.selection.innerHTML = renderSelection(world, b, ui.isConfirmingDemolish);
}

function refreshLive(): void {
  els.stock.innerHTML = renderStock(world);
  els.clock.textContent = formatClock(world.tick);
  els.messages.innerHTML = renderMessages(world, ui.dismissed);
  if (ui.tab !== 'build') renderPanel();
  renderSelectionCard();
  renderHint();
  drawMinimap();
}

function renderSpeedButtons(): void { els.speed.innerHTML = renderSpeed(ui.speed); }

// ---------------------------------------------------------------- minimap

const minimapBase = document.createElement('canvas');
let minimapVersion = -1;
function buildMinimapBase(): void {
  minimapBase.width = world.width; minimapBase.height = world.height;
  const ctx = minimapBase.getContext('2d')!;
  const img = ctx.createImageData(world.width, world.height);
  for (let i = 0; i < world.width * world.height; i++) {
    const t = world.terrain[i];
    let [r, g, b] = t === 1 ? [79, 127, 166] : t === 2 ? [141, 138, 124] : [122, 148, 80];
    if (world.tree[i] >= 0) [r, g, b] = [61, 90, 46];
    if (world.field[i] >= 0) [r, g, b] = [217, 180, 74];
    if (world.territory[i] !== PLAYER + 1) { r *= 0.55; g *= 0.55; b *= 0.55; }
    img.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
}
function drawMinimap(): void {
  if (getComputedStyle(els.minimap).display === 'none') return;
  const version = world.mapVersion * 1000 + world.territoryVersion;
  if (minimapVersion !== version) { buildMinimapBase(); minimapVersion = version; }
  const ctx = els.minimap.getContext('2d')!;
  const sx = els.minimap.width / world.width, sy = els.minimap.height / world.height;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(minimapBase, 0, 0, els.minimap.width, els.minimap.height);
  ctx.fillStyle = '#ece6d6';
  for (const b of world.buildings) ctx.fillRect(b.x * sx, b.y * sy, b.size * sx, b.size * sy);
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

function handleResults(results: CommandResult[], commands: Command[]): void {
  let isPanelStale = false;
  results.forEach((result, k) => {
    const command = commands[k];
    if (!result.isAccepted) {
      ui.problem = result.reason;
      ui.problemUntil = performance.now() + 2500;
    } else if (command.type === 'placeBuilding') {
      ui.selectedId = result.buildingId ?? null;
    } else if (command.type === 'setTransportPriority' || command.type === 'setGoodStored') {
      isPanelStale = true;
    }
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
  ui.selectedId = null;
  refreshMarkers();
  if (isTouch && window.matchMedia('(max-height: 520px), (max-width: 760px)').matches) ui.isDrawerOpen = false;
  renderPanel(); renderHint();
}

function stopPlacing(): void {
  ui.placing = null; ui.ghost = null; ui.ghostKey = ''; ui.markers = [];
  renderPanel(); renderHint();
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
  if (!ui.ghost.isValid) { ui.problem = ui.ghostProblem; ui.problemUntil = performance.now() + 2500; renderHint(); return; }
  submit({ type: 'placeBuilding', playerId: PLAYER, buildingType: ui.placing, x: ui.ghost.x, y: ui.ghost.y });
  stopPlacing();
}

function selectAt(clientX: number, clientY: number): void {
  const tile = view.screenToTile(clientX, clientY);
  ui.isConfirmingDemolish = false;
  if (tile.x < 0 || tile.y < 0 || tile.x >= world.width || tile.y >= world.height) { ui.selectedId = null; renderSelectionCard(); return; }
  const i = tileIndex(world, tile.x, tile.y);
  const id = (world.footprint[i] || world.door[i]) - 1;
  ui.selectedId = id >= 0 ? id : null;
  renderSelectionCard();
}

// ---------------------------------------------------------------- pointer, wheel and keyboard input

const pointers = new Map<number, { x: number; y: number; startX: number; startY: number }>();
let isPanning = false;
let pinchDistance = 0;
const canvas = view.app.canvas;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
  isPanning = false;
  if (ui.isMenuOpen) { ui.isMenuOpen = false; renderMenu(); }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    if (e.pointerType === 'mouse' && ui.placing && !ui.isTouchPlacement) moveGhost(e.clientX, e.clientY);
    return;
  }
  if (pointers.size === 2) {
    p.x = e.clientX; p.y = e.clientY;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDistance > 0) view.zoomAt(d / pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinchDistance = d;
    isPanning = true;
    return;
  }
  if (!isPanning && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > 6) isPanning = true;
  if (isPanning) view.panBy(e.clientX - p.x, e.clientY - p.y);
  p.x = e.clientX; p.y = e.clientY;
  if (!isPanning && e.pointerType === 'mouse' && ui.placing && !ui.isTouchPlacement) moveGhost(e.clientX, e.clientY);
});

function endPointer(e: PointerEvent): void {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDistance = 0;
  if (!p || isPanning || pointers.size > 0 || e.type === 'pointercancel') return;
  if (ui.placing) {
    if (e.pointerType === 'mouse' && !ui.isTouchPlacement) { moveGhost(e.clientX, e.clientY); confirmPlacement(); }
    else { ui.isTouchPlacement = true; moveGhost(e.clientX, e.clientY); renderHint(); }
  } else {
    selectAt(e.clientX, e.clientY);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (ui.placing) stopPlacing(); });

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  const group = BUILDING_GROUP_TYPES.find((g) => g.key === key);
  const goodsView = GOODS_VIEWS.find((v) => v.key === key);
  if (e.key === 'Escape') {
    if (ui.isMenuOpen) { ui.isMenuOpen = false; renderMenu(); }
    else if (ui.placing) stopPlacing();
    else { ui.selectedId = null; renderSelectionCard(); }
  } else if (e.key === ' ' && (e.target === document.body || e.target === canvas)) {
    e.preventDefault(); setSpeed(ui.speed === 0 ? 1 : 0);
  } else if (group) {
    ui.tab = 'build'; ui.groupType = group.id; ui.isDrawerOpen = true;
    selectFirstOfGroup(); renderPanel();
  } else if (goodsView) {
    ui.tab = 'goods'; ui.goodsView = goodsView.id; ui.isDrawerOpen = true; renderPanel();
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

// ---------------------------------------------------------------- button actions

document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const { action } = target.dataset;
  const isTouch = (e as PointerEvent).pointerType === 'touch' || window.matchMedia('(pointer: coarse)').matches;
  const selected = buildingById(world, ui.selectedId);
  switch (action) {
    case 'tab': {
      const tab = target.dataset.tab as TabId;
      if (ui.tab === tab) ui.isDrawerOpen = !ui.isDrawerOpen; else { ui.tab = tab; ui.isDrawerOpen = true; }
      renderPanel(); break;
    }
    case 'group': ui.groupType = target.dataset.group as BuildingGroupType; selectFirstOfGroup(); renderPanel(); break;
    case 'goods-view': ui.goodsView = target.dataset.view as GoodsViewId; renderPanel(); break;
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
      submit({ type: 'setGoodStored', playerId: PLAYER, good, isStored: !world.players[0].isStored[good] });
      break;
    }
    case 'priority':
      submit({ type: 'setTransportPriority', playerId: PLAYER, good: target.dataset.good as GoodType, position: Number(target.dataset.position) });
      break;
    case 'dismiss': ui.dismissed.add(Number(target.dataset.id)); refreshLive(); break;
    case 'show-building': {
      const b = buildingById(world, Number(target.dataset.id));
      if (b) { view.centreOn(b.x + b.size / 2, b.y + b.size / 2); ui.selectedId = b.id; renderSelectionCard(); }
      break;
    }
    case 'menu': ui.isMenuOpen = !ui.isMenuOpen; ui.menuNotice = null; renderMenu(); break;
    case 'save':
      ui.menuNotice = save(SAVE_KEY) ? `Saved at ${formatClock(world.tick)}.` : 'This browser does not allow saving here.';
      renderMenu(); break;
    case 'load': load(SAVE_KEY); renderMenu(); renderPanel(); refreshLive(); break;
    case 'load-autosave': load(AUTOSAVE_KEY); renderMenu(); renderPanel(); refreshLive(); break;
    case 'new-map':
      world = createWorld({ seed: randomSeed() });
      showWorld(); ui.isMenuOpen = false; renderMenu(); renderPanel(); refreshLive();
      break;
  }
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
  if (ui.speed > 0) {
    accumulator += dt * ui.speed;
    while (accumulator >= TICK_MS) {
      const commands = queue.splice(0);
      handleResults(step(world, commands), commands);
      accumulator -= TICK_MS;
    }
    if (now - lastAutosave > AUTOSAVE_MS) { lastAutosave = now; save(AUTOSAVE_KEY); }
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
  view.render(ui.speed > 0 ? accumulator / TICK_MS : 1, {
    ghost: ui.ghost, markers: ui.markers, markerSize: ui.placing ? BUILDING_TYPES[ui.placing].size : 0, selectedId: ui.selectedId
  });
  if (now - lastLive > 250) { lastLive = now; refreshLive(); }
  requestAnimationFrame(frame);
}

showWorld();
view.zoomCentre(1.4);
view.centreOn(castleOf(world, PLAYER)!.x + 2, castleOf(world, PLAYER)!.y + 2);
renderPanel();
renderSpeedButtons();
refreshLive();
requestAnimationFrame(frame);

// Exposed for automated screenshots and debugging in the browser console.
Object.defineProperty(window, 'lers', {
  get: () => ({ world, view, ui, TILE, placementProblem, step, setSpeed })
});
