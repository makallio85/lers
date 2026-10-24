import {
  BUILDING_TYPES, applyCommand, buildingById, castleOf, createWorld, placementProblem, step, tileIndex
} from '../../simulation/src/index.ts';
import type { BuildingGroupType, BuildingTypeId, Command, CommandResult, World } from '../../simulation/src/index.ts';
import { MapView, TILE } from './renderer.ts';
import type { Ghost } from './renderer.ts';
import {
  formatClock, renderBuildPanel, renderGoodsPanel, renderMessages, renderMilitaryPanel, renderSelection,
  renderSettlersPanel, renderSpeed, renderStatsPanel, renderStock, renderTabs
} from './ui.ts';
import type { TabId } from './ui.ts';

const TICK_MS = 100;
const PLAYER = 0;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  side: $('side'), tabs: $('tabs'), panel: $('panel'), stock: $('stock'), clock: $('clock'), speed: $('speed'),
  map: $('map'), messages: $('messages'), hint: $('hint'), selection: $('selection'),
  minimap: $<HTMLCanvasElement>('minimap'), mapName: $('map-name')
};

const seedParam = Number(new URLSearchParams(location.search).get('seed'));
const seed = Number.isInteger(seedParam) && seedParam > 0 ? seedParam : Math.floor(Math.random() * 1_000_000) + 1;
const world: World = createWorld({ seed });
els.mapName.textContent = `Sandbox · map ${seed}`;

const ui = {
  tab: 'build' as TabId,
  groupType: 'basic' as BuildingGroupType,
  selectedType: 'woodcutter' as BuildingTypeId,
  placing: null as BuildingTypeId | null,
  ghost: null as Ghost | null,
  ghostKey: '',
  isTouchPlacement: false,
  problem: null as string | null,
  problemUntil: 0,
  selectedId: null as number | null,
  speed: 1,
  isDrawerOpen: true,
  dismissed: new Set<number>()
};

const queue: Command[] = [];
const view = await MapView.create(els.map, world);
const castle = castleOf(world, PLAYER)!;
view.zoomCentre(1.4);
view.centreOn(castle.x + 2, castle.y + 2);

// ---------------------------------------------------------------- panel rendering

function renderPanel(): void {
  els.tabs.innerHTML = renderTabs(ui.tab);
  els.side.classList.toggle('is-collapsed', !ui.isDrawerOpen);
  els.panel.innerHTML =
    ui.tab === 'build' ? renderBuildPanel(ui.groupType, ui.selectedType, ui.placing)
    : ui.tab === 'goods' ? renderGoodsPanel(world)
    : ui.tab === 'settlers' ? renderSettlersPanel(world)
    : ui.tab === 'military' ? renderMilitaryPanel()
    : renderStatsPanel(world);
}

function renderHint(): void {
  if (!ui.placing) { els.hint.hidden = true; return; }
  const label = BUILDING_TYPES[ui.placing].label;
  const problem = performance.now() < ui.problemUntil ? ui.problem : ui.ghost && !ui.ghost.isValid ? ui.ghost && ghostProblem() : null;
  const instructions = ui.isTouchPlacement
    ? (ui.ghost ? 'Move it by tapping elsewhere, then press Place.' : 'Tap the map where it should go.')
    : 'Click the map to place it. Green means it fits. Esc to cancel.';
  els.hint.hidden = false;
  els.hint.innerHTML = `<span>Placing ${label}</span><span class="${problem ? 'is-problem' : ''}">${problem ?? instructions}</span>
    ${ui.isTouchPlacement && ui.ghost ? `<button type="button" class="primary" data-action="confirm-place" ${ui.ghost.isValid ? '' : 'disabled'}>Place</button>` : ''}
    <button type="button" class="secondary" data-action="cancel-placing">Cancel</button>`;
}

let lastProblem: string | null = null;
function ghostProblem(): string | null { return lastProblem; }

function renderSelectionCard(): void {
  const b = buildingById(world, ui.selectedId);
  if (!b) { ui.selectedId = null; els.selection.hidden = true; return; }
  els.selection.hidden = false;
  els.selection.innerHTML = renderSelection(world, b);
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
function buildMinimapBase(): void {
  minimapBase.width = world.width; minimapBase.height = world.height;
  const ctx = minimapBase.getContext('2d')!;
  const img = ctx.createImageData(world.width, world.height);
  for (let i = 0; i < world.width * world.height; i++) {
    const t = world.terrain[i];
    let [r, g, b] = t === 1 ? [79, 127, 166] : t === 2 ? [141, 138, 124] : [122, 148, 80];
    if (world.tree[i] >= 0) [r, g, b] = [61, 90, 46];
    if (world.territory[i] !== PLAYER + 1) { r *= 0.55; g *= 0.55; b *= 0.55; }
    img.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
}
let minimapVersion = -1;
function drawMinimap(): void {
  if (getComputedStyle(els.minimap).display === 'none') return;
  if (minimapVersion !== world.mapVersion) { buildMinimapBase(); minimapVersion = world.mapVersion; }
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
  if (ui.speed === 0) handleResults([applyCommand(world, command)], [command]);
  else queue.push(command);
}

function handleResults(results: CommandResult[], commands: Command[]): void {
  results.forEach((result, k) => {
    const command = commands[k];
    if (!result.isAccepted) {
      ui.problem = result.reason;
      ui.problemUntil = performance.now() + 2500;
    } else if (command.type === 'placeBuilding') {
      ui.selectedId = result.buildingId ?? null;
    }
  });
}

function startPlacing(typeId: BuildingTypeId, isTouch: boolean): void {
  ui.placing = typeId;
  ui.isTouchPlacement = isTouch;
  ui.ghost = null; ui.ghostKey = '';
  ui.selectedId = null;
  if (isTouch && window.matchMedia('(max-height: 520px), (max-width: 760px)').matches) ui.isDrawerOpen = false;
  renderPanel(); renderHint();
}

function stopPlacing(): void {
  ui.placing = null; ui.ghost = null; ui.ghostKey = '';
  renderPanel(); renderHint();
}

function moveGhost(clientX: number, clientY: number): void {
  if (!ui.placing) return;
  const tile = view.screenToTile(clientX, clientY);
  const size = BUILDING_TYPES[ui.placing].size;
  const x = tile.x - Math.floor(size / 2), y = tile.y - Math.floor(size / 2);
  const key = `${ui.placing}:${x}:${y}:${world.mapVersion}`;
  if (key === ui.ghostKey) return;
  ui.ghostKey = key;
  lastProblem = placementProblem(world, PLAYER, ui.placing, x, y);
  ui.ghost = { typeId: ui.placing, x, y, isValid: lastProblem === null };
  renderHint();
}

function confirmPlacement(): void {
  if (!ui.placing || !ui.ghost) return;
  submit({ type: 'placeBuilding', playerId: PLAYER, buildingType: ui.placing, x: ui.ghost.x, y: ui.ghost.y });
  if (ui.ghost.isValid) stopPlacing();
  else { ui.problem = lastProblem; ui.problemUntil = performance.now() + 2500; renderHint(); }
}

function selectAt(clientX: number, clientY: number): void {
  const tile = view.screenToTile(clientX, clientY);
  if (tile.x < 0 || tile.y < 0 || tile.x >= world.width || tile.y >= world.height) { ui.selectedId = null; return; }
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
  if (e.key === 'Escape') { if (ui.placing) stopPlacing(); else { ui.selectedId = null; renderSelectionCard(); } }
  else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); setSpeed(ui.speed === 0 ? 1 : 0); }
  else keys.add(e.key.toLowerCase());
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

function setSpeed(speed: number): void { ui.speed = speed; renderSpeedButtons(); }

// ---------------------------------------------------------------- button actions

document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const { action } = target.dataset;
  const isTouch = (e as PointerEvent).pointerType === 'touch' || window.matchMedia('(pointer: coarse)').matches;
  switch (action) {
    case 'tab': {
      const tab = target.dataset.tab as TabId;
      if (ui.tab === tab) ui.isDrawerOpen = !ui.isDrawerOpen; else { ui.tab = tab; ui.isDrawerOpen = true; }
      renderPanel(); break;
    }
    case 'group': {
      ui.groupType = target.dataset.group as BuildingGroupType;
      const first = Object.values(BUILDING_TYPES).find((t) => t.groupType === ui.groupType);
      if (first) ui.selectedType = first.id;
      renderPanel(); break;
    }
    case 'select-type': ui.selectedType = target.dataset.type as BuildingTypeId; renderPanel(); break;
    case 'start-placing': startPlacing(ui.selectedType, isTouch); break;
    case 'cancel-placing': stopPlacing(); break;
    case 'confirm-place': confirmPlacement(); break;
    case 'speed': setSpeed(Number(target.dataset.speed)); break;
    case 'deselect': ui.selectedId = null; renderSelectionCard(); break;
    case 'cancel-construction':
      if (ui.selectedId !== null) submit({ type: 'cancelConstruction', playerId: PLAYER, buildingId: ui.selectedId });
      break;
    case 'dismiss': ui.dismissed.add(Number(target.dataset.id)); refreshLive(); break;
    case 'show-building': {
      const b = buildingById(world, Number(target.dataset.id));
      if (b) { view.centreOn(b.x + b.size / 2, b.y + b.size / 2); ui.selectedId = b.id; renderSelectionCard(); }
      break;
    }
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
  }
  const pan = 0.6 * dt;
  if (keys.has('arrowleft') || keys.has('a')) view.panBy(pan, 0);
  if (keys.has('arrowright') || keys.has('d')) view.panBy(-pan, 0);
  if (keys.has('arrowup') || keys.has('w')) view.panBy(0, pan);
  if (keys.has('arrowdown') || keys.has('s')) view.panBy(0, -pan);
  if (ui.ghost && ui.placing) {
    // Re-check the ghost when the map changes under it (a tree grows, a site is placed).
    const key = `${ui.placing}:${ui.ghost.x}:${ui.ghost.y}:${world.mapVersion}`;
    if (key !== ui.ghostKey) {
      ui.ghostKey = key;
      lastProblem = placementProblem(world, PLAYER, ui.placing, ui.ghost.x, ui.ghost.y);
      ui.ghost.isValid = lastProblem === null;
    }
  }
  view.render(ui.speed > 0 ? accumulator / TICK_MS : 1, { ghost: ui.ghost, selectedId: ui.selectedId });
  if (now - lastLive > 250) { lastLive = now; refreshLive(); }
  requestAnimationFrame(frame);
}

renderPanel();
renderSpeedButtons();
refreshLive();
requestAnimationFrame(frame);

// Exposed for automated screenshots and debugging in the browser console.
Object.assign(window, { lers: { world, view, ui, TILE, placementProblem, step, setSpeed } });
