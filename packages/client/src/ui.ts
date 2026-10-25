import {
  BUILDING_GROUP_TYPES, BUILDING_TYPES, GOOD_LABELS, GOOD_TYPES, SETTLER_LABELS, TICKS_PER_SECOND, TOOL_TYPES,
  castleOf, costTotal, goodCount, isStorageBuilding, settlerById
} from '../../simulation/src/index.ts';
import type {
  Building, BuildingGroupType, BuildingTypeId, GameMessage, GoodAmounts, GoodType, SettlerType, World
} from '../../simulation/src/index.ts';

export type TabId = 'build' | 'goods' | 'settlers' | 'military' | 'stats';
export type GoodsViewId = 'inventory' | 'tools' | 'distribution' | 'transport';

const ICONS: Record<TabId | 'warning' | 'info', string> = {
  build: '<path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M10 21v-6h4v6"/>',
  goods: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  settlers: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',
  military: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  stats: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  warning: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/>'
};

export function icon(name: keyof typeof ICONS, color = 'currentColor'): string {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

export const TABS: { id: TabId; label: string }[] = [
  { id: 'build', label: 'Build' }, { id: 'goods', label: 'Goods' }, { id: 'settlers', label: 'Settlers' },
  { id: 'military', label: 'Military' }, { id: 'stats', label: 'Stats' }
];

/** The goods views and their keys follow the original game's A S D F order. */
export const GOODS_VIEWS: { id: GoodsViewId; label: string; key: string }[] = [
  { id: 'inventory', label: 'Inventory', key: 'a' }, { id: 'tools', label: 'Tools', key: 's' },
  { id: 'distribution', label: 'Distribution', key: 'd' }, { id: 'transport', label: 'Transport', key: 'f' }
];

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function costText(cost: Partial<GoodAmounts>, separator = ' · '): string {
  const parts = GOOD_TYPES.filter((g) => (cost[g] ?? 0) > 0).map((g) => goodCount(g, cost[g]!));
  return parts.length ? parts.join(separator) : 'Nothing';
}

export function renderTabs(active: TabId): string {
  return TABS.map((t) => `<button type="button" class="tab" data-action="tab" data-tab="${t.id}" aria-pressed="${t.id === active}">${icon(t.id)}${t.label}</button>`).join('');
}

export function renderBuildPanel(groupType: BuildingGroupType, selected: BuildingTypeId, placing: BuildingTypeId | null): string {
  const groups = BUILDING_GROUP_TYPES.map((g) =>
    `<button type="button" role="tab" class="pill" data-action="group" data-group="${g.id}" aria-selected="${g.id === groupType}" title="Key ${g.key.toUpperCase()}">${g.label}</button>`).join('');
  const types = Object.values(BUILDING_TYPES).filter((t) => t.groupType === groupType);
  const cards = types.map((t) => `
    <button type="button" class="building-card" data-action="select-type" data-type="${t.id}" aria-pressed="${t.id === selected}" ${t.isAvailable ? '' : 'disabled'}>
      <span class="name">${t.label}</span>
      <span class="cost">${t.isAvailable ? costText(t.cost) : 'Coming later'}</span>
    </button>`).join('');
  const t = BUILDING_TYPES[selected];
  const isPlacing = placing === selected;
  return `
    <div class="groups" role="tablist" aria-label="Building groups">${groups}</div>
    <div class="buildings">${cards}</div>
    <div class="detail">
      <div class="detail-head"><span class="detail-title">${t.label}</span><span class="muted">${t.size}×${t.size} tiles</span></div>
      <dl class="facts">
        <dt>Worker</dt><dd>${t.workerLabel}</dd>
        <dt>Uses</dt><dd>${t.usesLabel}</dd>
        <dt>Makes</dt><dd>${t.makesLabel}</dd>
        <dt>Cost</dt><dd>${costText(t.cost, ', ')}</dd>
      </dl>
      <button type="button" class="primary" data-action="${isPlacing ? 'cancel-placing' : 'start-placing'}" ${t.isAvailable ? '' : 'disabled'}>
        ${isPlacing ? 'Cancel placing' : t.isAvailable ? 'Place on map' : 'Not available yet'}
      </button>
    </div>`;
}

interface GoodsCount { stored: number; atBuildings: number; carried: number }

function countGoods(world: World): Record<GoodType, GoodsCount> {
  const out = {} as Record<GoodType, GoodsCount>;
  for (const g of GOOD_TYPES) out[g] = { stored: 0, atBuildings: 0, carried: 0 };
  for (const b of world.buildings) {
    for (const g of GOOD_TYPES) {
      if (isStorageBuilding(b)) out[g].stored += b.stock[g];
      else out[g].atBuildings += b.stock[g] + b.input[g] + b.delivered[g];
    }
  }
  for (const s of world.settlers) if (s.carrying) out[s.carrying].carried++;
  return out;
}

function goodsViewTabs(view: GoodsViewId): string {
  return `<div class="groups" role="tablist" aria-label="Goods views">${GOODS_VIEWS.map((v) =>
    `<button type="button" role="tab" class="pill" data-action="goods-view" data-view="${v.id}" aria-selected="${v.id === view}" title="Key ${v.key.toUpperCase()}">${v.label}</button>`).join('')}</div>`;
}

export function renderGoodsPanel(world: World, view: GoodsViewId): string {
  const counts = countGoods(world);
  const row = (g: GoodType) => {
    const c = counts[g];
    return `<li><span>${GOOD_LABELS[g]}</span><span class="num">${c.stored}<span class="muted"> stored · ${c.atBuildings} at buildings · ${c.carried} carried</span></span></li>`;
  };
  if (view === 'inventory') {
    const goods = GOOD_TYPES.filter((g) => !(TOOL_TYPES as readonly string[]).includes(g));
    return `${goodsViewTabs(view)}<ul class="list">${goods.map(row).join('')}</ul>`;
  }
  if (view === 'tools') {
    return `${goodsViewTabs(view)}<ul class="list">${TOOL_TYPES.map(row).join('')}</ul>
      <p class="empty">A workplace takes its tool from storage when its worker starts. The toolsmith that makes new tools arrives with mining.</p>`;
  }
  if (view === 'distribution') {
    return `${goodsViewTabs(view)}<p class="empty">Sharing a good between buildings that use it (coal between smiths, for example) arrives with mining.</p>`;
  }
  const player = world.players[0];
  const rows = player.transportPriority.map((g, k) => `
    <li class="priority-row">
      <span class="rank">${k + 1}</span>
      <span class="grow">${GOOD_LABELS[g]}</span>
      <button type="button" class="chip ${player.isStored[g] ? 'is-on' : ''}" data-action="toggle-stored" data-good="${g}" aria-pressed="${player.isStored[g]}"
        aria-label="${GOOD_LABELS[g]}: ${player.isStored[g] ? 'stored' : 'not stored'}">${player.isStored[g] ? 'Store' : "Don't store"}</button>
      <button type="button" class="icon-button" data-action="priority" data-good="${g}" data-position="0" aria-label="Move ${GOOD_LABELS[g]} to the top" ${k === 0 ? 'disabled' : ''}>⤒</button>
      <button type="button" class="icon-button" data-action="priority" data-good="${g}" data-position="${k - 1}" aria-label="Move ${GOOD_LABELS[g]} up" ${k === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="icon-button" data-action="priority" data-good="${g}" data-position="${k + 1}" aria-label="Move ${GOOD_LABELS[g]} down" ${k === GOOD_TYPES.length - 1 ? 'disabled' : ''}>↓</button>
    </li>`).join('');
  return `${goodsViewTabs(view)}<p class="empty">Carriers move goods higher in the list first. Construction sites are always served before anything else.</p><ul class="list">${rows}</ul>`;
}

export function renderSettlersPanel(world: World): string {
  const counts = new Map<SettlerType, number>();
  let idle = 0;
  for (const s of world.settlers) {
    counts.set(s.settlerType, (counts.get(s.settlerType) ?? 0) + 1);
    if (s.settlerType === 'carrier' && s.phase === 'idle' && !s.carrying) idle++;
  }
  const rows = (Object.keys(SETTLER_LABELS) as SettlerType[])
    .filter((t) => counts.has(t))
    .map((t) => `<li><span>${SETTLER_LABELS[t]}s</span><span class="num">${counts.get(t)}</span></li>`).join('');
  const arriving = world.buildings.reduce((sum, b) => sum + b.residentsLeft, 0);
  return `<h2 class="section-title">Settlers</h2><ul class="list">${rows}<li><span>Free carriers</span><span class="num">${idle}</span></li>
    ${arriving ? `<li><span>Moving in</span><span class="num">${arriving}</span></li>` : ''}</ul>
    <p class="empty">New settlers come from residences (Build › Misc.). A finished workplace turns a free carrier into its worker when its tool is in storage.</p>`;
}

export function renderMilitaryPanel(world: World): string {
  const soldiers = world.settlers.filter((s) => s.settlerType === 'soldier');
  const free = soldiers.filter((s) => s.phase === 'idle').length;
  const towers = world.buildings.filter((b) => BUILDING_TYPES[b.typeId].territoryRadius > 0 && b.typeId !== 'castle');
  const occupied = towers.filter((b) => settlerById(world, b.workerId)?.phase === 'inside').length;
  return `<h2 class="section-title">Military</h2><ul class="list">
      <li><span>Soldiers</span><span class="num">${soldiers.length}</span></li>
      <li><span>Free soldiers</span><span class="num">${free}</span></li>
      <li><span>Towers occupied</span><span class="num">${occupied} of ${towers.length}</span></li></ul>
    <p class="empty">A finished tower is occupied by a free soldier and then claims land around it. Recruiting and battles arrive in a later step.</p>`;
}

export function renderStatsPanel(world: World): string {
  const counts = new Map<BuildingTypeId, { done: number; building: number }>();
  for (const b of world.buildings) {
    const c = counts.get(b.typeId) ?? { done: 0, building: 0 };
    if (b.isComplete) c.done++; else c.building++;
    counts.set(b.typeId, c);
  }
  const rows = [...counts].map(([id, c]) =>
    `<li><span>${BUILDING_TYPES[id].label}</span><span class="num">${c.done}${c.building ? ` + ${c.building} building` : ''}</span></li>`).join('');
  const land = world.territory.reduce((sum, v) => sum + (v === 1 ? 1 : 0), 0);
  return `<h2 class="section-title">Buildings</h2><ul class="list">${rows}</ul>
    <h2 class="section-title">Land</h2><ul class="list"><li><span>Territory</span><span class="num">${land} tiles</span></li></ul>`;
}

const BAR_GOODS: GoodType[] = ['log', 'plank', 'stone', 'grain', 'flour', 'water', 'bread', 'fish'];

export function renderStock(world: World): string {
  const castle = castleOf(world, 0);
  if (!castle) return '';
  const stored = (g: GoodType) => world.buildings.reduce((sum, b) => sum + (isStorageBuilding(b) ? b.stock[g] : 0), 0);
  const idle = world.settlers.filter((s) => s.settlerType === 'carrier' && s.phase === 'idle' && !s.carrying).length;
  const goods = BAR_GOODS.map((g) => {
    const n = stored(g);
    return `<span><span class="muted">${GOOD_LABELS[g]}</span><b class="${n === 0 && (g === 'plank' || g === 'stone') ? 'is-low' : ''}">${n}</b></span>`;
  }).join('');
  return `${goods}<span><span class="muted">Settlers</span><b>${world.settlers.length}</b></span><span><span class="muted">Free carriers</span><b class="${idle === 0 ? 'is-low' : ''}">${idle}</b></span>`;
}

export function formatClock(tick: number): string {
  const total = Math.floor(tick / TICKS_PER_SECOND);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function renderSpeed(speed: number): string {
  const options: { value: number; label: string; aria: string }[] = [
    { value: 0, label: 'II', aria: 'Pause' }, { value: 1, label: '1×', aria: 'Normal speed' },
    { value: 2, label: '2×', aria: 'Double speed' }, { value: 4, label: '4×', aria: 'Four times speed' }
  ];
  return options.map((o) => `<button type="button" data-action="speed" data-speed="${o.value}" aria-label="${o.aria}" aria-pressed="${o.value === speed}">${o.label}</button>`).join('');
}

export function renderGameMenu(savedAt: string | null, autosavedAt: string | null, notice: string | null): string {
  return `
    <button type="button" class="menu-item" data-action="save">Save game</button>
    <button type="button" class="menu-item" data-action="load" ${savedAt ? '' : 'disabled'}>Load saved game${savedAt ? `<span class="muted">${savedAt}</span>` : ''}</button>
    <button type="button" class="menu-item" data-action="load-autosave" ${autosavedAt ? '' : 'disabled'}>Load autosave${autosavedAt ? `<span class="muted">${autosavedAt}</span>` : ''}</button>
    <button type="button" class="menu-item" data-action="new-map">New map</button>
    ${notice ? `<p class="menu-notice">${escapeHtml(notice)}</p>` : ''}`;
}

export function renderMessages(world: World, dismissed: Set<number>): string {
  const recent = world.messages
    .filter((m) => !dismissed.has(m.id) && world.tick - m.tick < 30 * TICKS_PER_SECOND)
    .slice(-3).reverse();
  return recent.map((m: GameMessage) => `
    <div class="message ${m.isWarning ? 'is-warning' : ''}">
      ${icon(m.isWarning ? 'warning' : 'info', m.isWarning ? '#e8763a' : '#8fb3d9')}
      <div class="message-body">
        <strong>${escapeHtml(m.text)}</strong>
        <span class="muted">${escapeHtml(m.detail)}</span>
        ${m.buildingId !== null ? `<button type="button" class="link" data-action="show-building" data-id="${m.buildingId}">Show on map</button>` : ''}
      </div>
      <button type="button" class="close" data-action="dismiss" data-id="${m.id}" aria-label="Dismiss">×</button>
    </div>`).join('');
}

function buildingStatus(world: World, b: Building): { text: string; isWarning: boolean } {
  if (!b.isComplete) {
    if (b.levelProgress < 1) {
      const pct = Math.floor(b.levelProgress * 100);
      return b.blockedReason ? { text: b.blockedReason, isWarning: true } : { text: `Levelling the ground · ${pct}%`, isWarning: false };
    }
    const pct = Math.floor(b.buildProgress * 100);
    return b.blockedReason ? { text: `${b.blockedReason} · ${pct}% built`, isWarning: true } : { text: `Under construction · ${pct}%`, isWarning: false };
  }
  if (b.isPaused) return { text: 'Paused', isWarning: true };
  if (b.blockedReason) return { text: b.blockedReason, isWarning: true };
  const type = BUILDING_TYPES[b.typeId];
  if (isStorageBuilding(b)) return { text: 'Storing goods', isWarning: false };
  if (b.residentsLeft > 0) return { text: `${b.residentsLeft} settlers still moving in`, isWarning: false };
  if (type.residents > 0) return { text: 'Everyone has moved in', isWarning: false };
  const worker = settlerById(world, b.workerId);
  if (worker && (worker.phase === 'toWork' || worker.phase === 'toTool')) {
    return { text: type.territoryRadius > 0 ? 'Soldier on the way' : 'Worker on the way', isWarning: false };
  }
  if (type.territoryRadius > 0) return { text: 'Occupied · claims territory', isWarning: false };
  return { text: 'Working', isWarning: false };
}

export function renderSelection(world: World, b: Building, isConfirmingDemolish: boolean): string {
  const type = BUILDING_TYPES[b.typeId];
  const status = buildingStatus(world, b);
  const lines: string[] = [];
  if (!b.isComplete) {
    const missing: Partial<GoodAmounts> = {};
    for (const g of GOOD_TYPES) missing[g] = (type.cost[g] ?? 0) - b.built[g] - b.delivered[g];
    lines.push(`<dt>Still needs</dt><dd>${costTotal(missing) > 0 ? costText(missing, ', ') : 'Nothing'}</dd>`);
  } else {
    for (const g of GOOD_TYPES) {
      if (b.input[g] > 0) lines.push(`<dt>${GOOD_LABELS[g]} in</dt><dd>${b.input[g]}</dd>`);
      if (b.stock[g] > 0) lines.push(`<dt>${GOOD_LABELS[g]}</dt><dd>${b.stock[g]}${isStorageBuilding(b) ? '' : ' ready'}</dd>`);
    }
    if (type.worker) {
      const worker = settlerById(world, b.workerId);
      lines.push(`<dt>Worker</dt><dd>${worker ? SETTLER_LABELS[worker.settlerType] : 'None yet'}</dd>`);
    }
  }
  const canPause = b.isComplete && type.worker !== null;
  const actions = b.typeId === 'castle' ? '' : isConfirmingDemolish
    ? `<div class="actions"><button type="button" class="danger" data-action="confirm-demolish">Demolish now</button><button type="button" class="secondary" data-action="cancel-demolish">Keep it</button></div>
       <span class="muted">Half of its materials go back to the castle.</span>`
    : `<div class="actions">
        ${canPause ? `<button type="button" class="secondary" data-action="toggle-pause">${b.isPaused ? 'Resume' : 'Pause'}</button>` : ''}
        <button type="button" class="secondary" data-action="demolish">${b.isComplete ? 'Demolish' : 'Cancel construction'}</button>
      </div>`;
  return `
    <div class="detail-head"><span class="detail-title">${type.label}</span><button type="button" class="close" data-action="deselect" aria-label="Close">×</button></div>
    <span class="${status.isWarning ? 'status-warning' : ''}">${escapeHtml(status.text)}</span>
    ${lines.length ? `<dl class="facts">${lines.join('')}</dl>` : ''}
    ${actions}`;
}
