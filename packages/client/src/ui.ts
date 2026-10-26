import {
  BOT_TYPES, BOT_TYPE_SETTINGS, BUILDING_GROUP_TYPES, BUILDING_TYPES, GOOD_LABELS, MAP_SIZE_SETTINGS, MAP_SIZE_TYPES, GOOD_TYPES, MAX_SHARE, SETTLER_LABELS, SETTLER_PLURALS, SOLDIER_TYPES,
  GOLD_FOR_FULL_STRENGTH, GOOD_NAMES, RACE_SETTINGS, RACE_TYPES, buildingCost, isBuildableBy, siteCost, HEAL_RADIUS, OUTSIDE_MIN_STRENGTH, SOLDIER_STATS, SPECIALIST_TOOLS, SPECIALIST_TYPES, coveringBuilding, storedGold, TICKS_PER_SECOND, TOOL_TYPES, WEAPON_TYPES, WORK_AREA_BUILDINGS, castleOf, consumersOf,
  costTotal, distributedGoods, goodCount, isMilitaryBuilding, isSoldierType, isStorageBuilding, isUnitType, isWarMachineType, settlerById,
  BUILDING_STRUCTURE, WAR_MACHINES_PER_HALL, WAR_MACHINE_STATS, WAR_MACHINE_TYPES,
  OFFERING_TICKS, PRIEST_TICKS, PROMOTION_COSTS, RACE_DRINKS, RACE_SPELLS, RANK_BONUS, RANK_LABELS, SPELL_RANGE, SPELL_STATS, buildingLabel,
  DONKEYS_PER_MARKETPLACE, DONKEY_LOAD, TRADE_MODE_LABELS, TRADE_MODE_TYPES, TRADE_SURPLUS_RESERVE, TRADE_UNLIMITED, donkeysOf
} from '../../simulation/src/index.ts';
import type {
  BotType, Building, BuildingGroupType, MapSizeType, RaceType, BuildingTypeId, GameMessage, GoodAmounts, GoodType, Settler, SettlerType, SpellType, World
} from '../../simulation/src/index.ts';

export type TabId = 'build' | 'goods' | 'settlers' | 'military' | 'stats';
export type GoodsViewId = 'inventory' | 'tools' | 'distribution' | 'transport';
export type MilitaryViewId = 'recruiting' | 'soldiers' | 'garrisons' | 'ranks';
export type SettlersViewId = 'counts' | 'occupations' | 'specialists';
export type OrderMode = 'select' | 'move' | 'attack' | 'waypoint' | 'patrol' | 'free' | 'spell' | null;

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

/** Strength of a player's soldiers outside its own land, from the gold it has in storage. */
export function outsideStrength(gold: number): number {
  return OUTSIDE_MIN_STRENGTH + (1 - OUTSIDE_MIN_STRENGTH) * Math.min(1, gold / GOLD_FOR_FULL_STRENGTH);
}

/** The goods views and their keys follow the original game's A S D F order. */
export const GOODS_VIEWS: { id: GoodsViewId; label: string; key: string }[] = [
  { id: 'inventory', label: 'Inventory', key: 'a' }, { id: 'tools', label: 'Tools', key: 's' },
  { id: 'distribution', label: 'Distribution', key: 'd' }, { id: 'transport', label: 'Transport', key: 'f' }
];

/** The Settlers views and their keys follow the original game's Z X C order. */
export const SETTLERS_VIEWS: { id: SettlersViewId; label: string; key: string }[] = [
  { id: 'counts', label: 'Counts', key: 'z' }, { id: 'occupations', label: 'Occupations', key: 'x' }, { id: 'specialists', label: 'Specialists', key: 'c' }
];

const MILITARY_VIEWS: { id: MilitaryViewId; label: string }[] = [
  { id: 'recruiting', label: 'Recruiting' }, { id: 'soldiers', label: 'Soldiers' }, { id: 'garrisons', label: 'Garrisons' }, { id: 'ranks', label: 'Ranks' }
];

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function costText(cost: Partial<GoodAmounts>, separator = ' · '): string {
  const parts = GOOD_TYPES.filter((g) => (cost[g] ?? 0) > 0).map((g) => goodCount(g, cost[g]!));
  return parts.length ? parts.join(separator) : 'Nothing';
}

function storedOf(world: World, owner: number, good: GoodType): number {
  return world.buildings.reduce((sum, b) => sum + (b.owner === owner && isStorageBuilding(b) ? b.stock[good] : 0), 0);
}

function pills<T extends string>(items: { id: T; label: string; key?: string }[], active: T, action: string, label: string): string {
  return `<div class="groups" role="tablist" aria-label="${label}">${items.map((v) =>
    `<button type="button" role="tab" class="pill" data-action="${action}" data-view="${v.id}" aria-selected="${v.id === active}"${v.key ? ` title="Key ${v.key.toUpperCase()}"` : ''}>${v.label}</button>`).join('')}</div>`;
}

export function renderTabs(active: TabId): string {
  return TABS.map((t) => `<button type="button" class="tab" data-action="tab" data-tab="${t.id}" aria-pressed="${t.id === active}">${icon(t.id)}${t.label}</button>`).join('');
}

export function renderBuildPanel(groupType: BuildingGroupType, selected: BuildingTypeId, placing: BuildingTypeId | null, race: RaceType): string {
  const groups = BUILDING_GROUP_TYPES.map((g) =>
    `<button type="button" role="tab" class="pill" data-action="group" data-group="${g.id}" aria-selected="${g.id === groupType}" title="Key ${g.key.toUpperCase()}">${g.label}</button>`).join('');
  // Only the buildings this people can build; its own ones are marked.
  const types = Object.values(BUILDING_TYPES).filter((t) => t.groupType === groupType && isBuildableBy(t.id, race));
  const cards = types.map((t) => `
    <button type="button" class="building-card ${t.races ? 'is-own' : ''}" data-action="select-type" data-type="${t.id}" aria-pressed="${t.id === selected}" ${t.isAvailable ? '' : 'disabled'}>
      <span class="name">${buildingLabel(t.id, race)}</span>
      <span class="cost">${t.isAvailable ? costText(buildingCost(t.id, race)) : 'Coming later'}</span>
      ${t.races ? `<span class="own-tag">${t.races.map((r) => RACE_SETTINGS[r].label).join(' and ')} only</span>` : ''}
    </button>`).join('');
  const t = BUILDING_TYPES[isBuildableBy(selected, race) ? selected : types[0]?.id ?? selected];
  const isPlacing = placing === selected;
  return `
    <div class="groups" role="tablist" aria-label="Building groups">${groups}</div>
    <div class="buildings">${cards}</div>
    <div class="detail">
      <div class="detail-head"><span class="detail-title">${buildingLabel(t.id, race)}</span><span class="muted">${t.size}×${t.size} tiles</span></div>
      <dl class="facts">
        <dt>Worker</dt><dd>${t.workerLabel}</dd>
        <dt>Uses</dt><dd>${t.usesLabel}</dd>
        <dt>Makes</dt><dd>${t.makesLabel}</dd>
        <dt>Cost</dt><dd>${costText(buildingCost(t.id, race), ', ')}</dd>
      </dl>
      <button type="button" class="primary" data-action="${isPlacing ? 'cancel-placing' : 'start-placing'}" ${t.isAvailable ? '' : 'disabled'}>
        ${isPlacing ? 'Cancel placing' : t.isAvailable ? 'Place on map' : 'Not available yet'}
      </button>
    </div>`;
}

interface GoodsCount { stored: number; atBuildings: number; carried: number }

function countGoods(world: World, owner: number): Record<GoodType, GoodsCount> {
  const out = {} as Record<GoodType, GoodsCount>;
  for (const g of GOOD_TYPES) out[g] = { stored: 0, atBuildings: 0, carried: 0 };
  for (const b of world.buildings) {
    if (b.owner !== owner) continue;
    for (const g of GOOD_TYPES) {
      if (isStorageBuilding(b)) out[g].stored += b.stock[g];
      else out[g].atBuildings += b.stock[g] + b.input[g] + b.delivered[g];
    }
  }
  for (const s of world.settlers) if (s.owner === owner && s.carrying) out[s.carrying].carried++;
  return out;
}

function stepper(action: string, data: string, value: number, label: string): string {
  return `<span class="stepper"><button type="button" class="icon-button" data-action="${action}" ${data} data-delta="-1" aria-label="${label}: one less">−</button><b class="num">${value}</b><button type="button" class="icon-button" data-action="${action}" ${data} data-delta="1" aria-label="${label}: one more">+</button></span>`;
}

function shareSlider(good: GoodType, value: number, extra: string, label: string): string {
  return `<input type="range" class="share" min="0" max="${MAX_SHARE}" step="1" value="${value}" ${extra} aria-label="${escapeHtml(label)}">`;
}

export function renderGoodsPanel(world: World, view: GoodsViewId, owner: number): string {
  const counts = countGoods(world, owner);
  const tabs = pills(GOODS_VIEWS, view, 'goods-view', 'Goods views');
  const row = (g: GoodType) => {
    const c = counts[g];
    return `<li><span>${GOOD_LABELS[g]}</span><span class="num">${c.stored}<span class="muted"> stored · ${c.atBuildings} at buildings · ${c.carried} carried</span></span></li>`;
  };
  const made: readonly string[] = [...TOOL_TYPES, ...WEAPON_TYPES];
  if (view === 'inventory') return `${tabs}<ul class="list">${GOOD_TYPES.filter((g) => !made.includes(g)).map(row).join('')}</ul>`;
  const player = world.players[owner];
  if (view === 'tools') {
    const lines = (goods: readonly GoodType[]) => goods.map((g) => `
      <div class="made-row">
        <span>${GOOD_LABELS[g]} <span class="muted">· ${counts[g].stored}</span></span>
        ${stepper('order', `data-good="${g}"`, player.productionOrders[g] ?? 0, `Order ${GOOD_LABELS[g]}`)}
        ${shareSlider(g, player.productionShares[g] ?? 0, `data-share-good="${g}"`, `Share of ${GOOD_LABELS[g]}`)}
      </div>`).join('');
    return `${tabs}<p class="empty">Orders are made first, top to bottom. After that the smiths follow the shares.</p>
      <div class="made-head"><span>Tool · in stock</span><span>Order</span><span>Share</span></div>${lines(TOOL_TYPES)}
      <h2 class="section-title">Weapons</h2>
      <div class="made-head"><span>Weapon · in stock</span><span>Order</span><span>Share</span></div>${lines(WEAPON_TYPES)}`;
  }
  if (view === 'distribution') {
    const blocks = distributedGoods().map((g) => {
      const shares = player.distribution[g] ?? {};
      const consumers = consumersOf(g);
      const total = consumers.reduce((sum, c) => sum + (shares[c] ?? 0), 0);
      return `<div class="share-block"><span class="share-good">${GOOD_LABELS[g]}</span>${consumers.map((c) => {
        const value = shares[c] ?? 0;
        const pct = total > 0 ? Math.round((value / total) * 100) : 0;
        return `<div class="share-row"><span>${BUILDING_TYPES[c].label}</span>${shareSlider(g, value, `data-distribution-good="${g}" data-building-type="${c}"`, `${GOOD_LABELS[g]} for ${BUILDING_TYPES[c].label}`)}<span class="num">${pct}%</span></div>`;
      }).join('')}</div>`;
    }).join('');
    return `${tabs}<p class="empty">How a good is shared when several kinds of building need it.</p>${blocks}`;
  }
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
  return `${tabs}<p class="empty">Carriers move goods higher in the list first. Construction sites are always served before anything else.</p><ul class="list">${rows}</ul>`;
}

export function renderSettlersPanel(world: World, view: SettlersViewId, owner: number): string {
  const tabs = pills(SETTLERS_VIEWS, view, 'settlers-view', 'Settlers views');
  const player = world.players[owner];
  if (view === 'occupations') {
    const own = world.settlers.filter((s) => s.owner === owner && !isSoldierType(s.settlerType));
    const carriers = own.filter((s) => s.settlerType === 'carrier').length;
    const crew = own.filter((s) => s.settlerType === 'digger' || s.settlerType === 'builder').length;
    const pct = (n: number) => (own.length > 0 ? Math.round((n * 100) / own.length) : 0);
    const slider = (key: string, value: number, label: string) =>
      `<input type="range" class="share" min="0" max="100" step="5" value="${value}" data-occupation="${key}" aria-label="${label}">`;
    return `${tabs}
      <div class="share-block">
        <div class="share-row"><span>Carriers, at least</span>${slider('minCarrier', player.minCarrierPercent, 'Carriers, at least')}<span class="num">${player.minCarrierPercent}%</span></div>
        <p class="empty">Now ${pct(carriers)}%. New diggers and builders are only made from carriers while this share stays.</p>
        <div class="share-row"><span>Diggers and builders, at most</span>${slider('maxCrew', player.maxCrewPercent, 'Diggers and builders, at most')}<span class="num">${player.maxCrewPercent}%</span></div>
        <p class="empty">Now ${pct(crew)}%. Above it, idle diggers and builders go back to carrying. Lower it once the settlement stands.</p>
      </div>`;
  }
  if (view === 'specialists') {
    const rows = SPECIALIST_TYPES.map((t) => {
      const all = world.settlers.filter((s) => s.owner === owner && s.settlerType === t);
      const busy = all.filter((s) => s.phase !== 'idle').length;
      return `<div class="specialist-row">
        <span class="specialist-name">${SETTLER_PLURALS[t]}</span>
        <span class="muted">${busy} at work · ${SPECIALIST_TOOLS[t] ? `each needs a ${GOOD_NAMES[SPECIALIST_TOOLS[t]!][0]}` : 'needs no tool'}</span>
        <div class="specialist-actions">
          ${stepper('specialists', `data-type="${t}"`, all.length, SETTLER_PLURALS[t])}
          <button type="button" class="secondary" data-action="select-specialists" data-type="${t}" ${all.length === 0 ? 'disabled' : ''}>Select</button>
        </div>
      </div>`;
    }).join('');
    return `${tabs}${rows}
      <p class="empty">+ turns a free carrier into a specialist, taking the tool from storage; − turns one back. Select specialists, then right-click or use Move to send them.</p>
      <p class="empty">Geologists put up signs on mountains: black for coal, silver for iron, gold for gold, an empty ring for nothing. Pioneers put up posts that claim land no enemy tower holds.</p>`;
  }
  const counts = new Map<SettlerType, number>();
  let idle = 0;
  for (const s of world.settlers) {
    if (s.owner !== owner) continue;
    counts.set(s.settlerType, (counts.get(s.settlerType) ?? 0) + 1);
    if (s.settlerType === 'carrier' && s.phase === 'idle' && !s.carrying) idle++;
  }
  const rows = (Object.keys(SETTLER_PLURALS) as SettlerType[])
    .filter((t) => counts.has(t))
    .map((t) => `<li><span>${SETTLER_PLURALS[t]}</span><span class="num">${counts.get(t)}</span></li>`).join('');
  const arriving = world.buildings.reduce((sum, b) => sum + (b.owner === owner ? b.residentsLeft : 0), 0);
  return `${tabs}<ul class="list">${rows}<li><span>Free carriers</span><span class="num">${idle}</span></li>
    ${arriving ? `<li><span>Moving in</span><span class="num">${arriving}</span></li>` : ''}</ul>
    <p class="empty">New settlers come from residences (Build › Misc.). A finished workplace turns a free carrier into its worker when its tool is in storage.</p>`;
}

export function renderMilitaryPanel(world: World, view: MilitaryViewId, owner: number, groups: Map<number, number[]>): string {
  const tabs = pills(MILITARY_VIEWS, view, 'military-view', 'Military views');
  const player = world.players[owner];
  const soldiers = world.settlers.filter((s) => s.owner === owner && isSoldierType(s.settlerType));
  if (view === 'recruiting') {
    const hasBarracks = world.buildings.some((b) => b.owner === owner && b.typeId === 'barracks' && b.isComplete);
    const free = world.settlers.filter((s) => s.owner === owner && s.settlerType === 'carrier' && s.phase === 'idle' && !s.carrying).length;
    const weapons = WEAPON_TYPES.map((w) => `<div class="tile-stat"><span class="muted">${GOOD_LABELS[w]}</span><b>${storedOf(world, owner, w)}</b></div>`).join('');
    const alive = new Set(soldiers.map((s) => s.id));
    const groupRows = [...groups].sort((a, b) => a[0] - b[0]).map(([n, ids]) => {
      const count = ids.filter((id) => alive.has(id)).length;
      return `<button type="button" class="group-row" data-action="select-group" data-group-number="${n}"><span class="group-key">${n}</span><span class="grow">Group ${n}</span><span class="muted">${count} soldiers</span></button>`;
    }).join('');
    return `${tabs}
      <h2 class="section-title">Weapons in storage</h2><div class="tile-stats">${weapons}</div>
      <h2 class="section-title">Barracks</h2>
      <div class="segmented" role="group" aria-label="Recruiting">
        <button type="button" data-action="recruit-mode" data-auto="true" aria-pressed="${player.isRecruitingAutomatic}">Automatic</button>
        <button type="button" data-action="recruit-mode" data-auto="false" aria-pressed="${!player.isRecruitingAutomatic}">Set number</button>
      </div>
      ${player.isRecruitingAutomatic ? '' : `<div class="made-row"><span>Soldiers still to recruit</span>${stepper('recruit-count', '', player.recruitsLeft, 'Soldiers to recruit')}</div>`}
      <p class="empty">${hasBarracks
        ? (player.isRecruitingAutomatic ? `Every weapon that reaches the barracks goes to a free settler. ${free} settlers could be recruited now.` : `Only the number above is recruited. ${free} free settlers.`)
        : 'Build a barracks (Build › Military) to turn weapons into soldiers.'}</p>
      <h2 class="section-title">Groups</h2>
      <div class="group-list">${groupRows}<p class="empty">Select soldiers, then press Ctrl and a number key (1–9) to save them as a group. The number key alone selects the group.</p></div>`;
  }
  if (view === 'soldiers') {
    const rows = SOLDIER_TYPES.map((t) => {
      const all = soldiers.filter((s) => s.settlerType === t);
      const outside = all.filter((s) => !s.isInside).length;
      const wounded = all.filter((s) => s.health < SOLDIER_STATS[t].health).length;
      return `<li><span>${SETTLER_PLURALS[t]}</span><span class="num">${all.length}<span class="muted"> · ${outside} outside · ${wounded} wounded</span></span></li>`;
    }).join('');
    const gold = storedGold(world, owner);
    const strength = Math.round(outsideStrength(gold) * 100);
    return `${tabs}
      <div class="strength-block">
        <span class="menu-label">Strength outside your land</span>
        <div class="strength-value"><b>${strength} %</b><span class="muted">${world.players[owner].raceType === 'egyptians'
          ? `worth ${Math.round(gold * 10) / 10} gold bars: gold counts half and gems double for the Egyptians` : `from ${goodCount('gold', gold)}`}</span></div>
        <div class="strength-bar"><div style="width: ${strength}%"></div></div>
        <span class="muted">On your own land soldiers always fight at 100 %. Outside it, strength rises with the gold bars in your storage, up to 100 % at ${GOLD_FOR_FULL_STRENGTH}.</span>
      </div>
      <ul class="list">${rows}</ul>
      <div class="actions-row">
        <button type="button" class="secondary" data-action="select-free">Select all soldiers outside</button>
        <button type="button" class="secondary" data-action="select-wounded" title="Key Tab">Select the wounded</button>
      </div>
      <p class="empty">Soldiers outside buildings can be selected and sent to move or attack. Soldiers in towers defend them.</p>`;
  }
  if (view === 'ranks') {
    const drink = GOOD_LABELS[RACE_DRINKS[player.raceType]].toLowerCase();
    const rows = SOLDIER_TYPES.map((t) => {
      const rank = player.soldierRanks[t];
      const isTop = rank >= RANK_LABELS.length - 1;
      const cost = isTop ? 0 : PROMOTION_COSTS[rank];
      const label = isTop ? 'Top rank' : `${RANK_LABELS[rank + 1]} · ${cost} manna`;
      return `<li class="rank-row"><span class="grow">${SETTLER_PLURALS[t]}<span class="muted block">${RANK_LABELS[rank]}</span></span>
        <button type="button" class="${!isTop && player.manna >= cost ? 'primary' : 'secondary'}" data-action="promote" data-type="${t}" ${isTop || player.manna < cost ? 'disabled' : ''}>${label}</button></li>`;
    }).join('');
    return `${tabs}
      <div class="strength-block">
        <span class="menu-label">Manna</span>
        <div class="strength-value"><b>${player.manna}</b><span class="muted">from ${drink} offered at your small temples</span></div>
        <span class="muted">Pays for promotions and for your priests' spells.</span>
      </div>
      <h2 class="section-title">Ranks of new recruits</h2>
      <ul class="list">${rows}</ul>
      <p class="empty">As in the original, a promotion applies to soldiers recruited from now on. Each rank adds ${Math.round(RANK_BONUS * 100)} % health and strength.</p>`;
  }
  const military = world.buildings.filter((b) => b.owner === owner && b.isComplete && isMilitaryBuilding(b));
  const rows = military.map((b) => {
    const cap = BUILDING_TYPES[b.typeId].garrisonCapacity;
    return `<li class="garrison-row"><button type="button" class="link" data-action="show-building" data-id="${b.id}">${BUILDING_TYPES[b.typeId].label}</button>
      <span class="muted num">${b.garrison.length} in</span>${stepper('garrison', `data-id="${b.id}"`, b.garrisonWanted, `Soldiers wanted in ${BUILDING_TYPES[b.typeId].label}`)}<span class="muted">of ${cap}</span></li>`;
  }).join('');
  return `${tabs}<ul class="list">${rows}</ul><p class="empty">Free soldiers fill buildings up to the number wanted, emptiest first. A tower with nobody inside claims no land.</p>`;
}

export function renderStatsPanel(world: World, owner: number): string {
  const counts = new Map<BuildingTypeId, { done: number; building: number }>();
  for (const b of world.buildings) {
    if (b.owner !== owner) continue;
    const c = counts.get(b.typeId) ?? { done: 0, building: 0 };
    if (b.isComplete) c.done++; else c.building++;
    counts.set(b.typeId, c);
  }
  const rows = [...counts].map(([id, c]) =>
    `<li><span>${BUILDING_TYPES[id].label}</span><span class="num">${c.done}${c.building ? ` + ${c.building} building` : ''}</span></li>`).join('');
  const land = world.territory.reduce((sum, v) => sum + (v === owner + 1 ? 1 : 0), 0);
  return `<h2 class="section-title">Buildings</h2><ul class="list">${rows}</ul>
    <h2 class="section-title">Land</h2><ul class="list"><li><span>Territory</span><span class="num">${land} tiles</span></li></ul>`;
}

const BAR_GOODS: GoodType[] = ['log', 'plank', 'stone', 'bread', 'fish', 'meat', 'coal', 'iron'];

export function renderStock(world: World, owner: number): string {
  if (!castleOf(world, owner)) return '';
  const idle = world.settlers.filter((s) => s.owner === owner && s.settlerType === 'carrier' && s.phase === 'idle' && !s.carrying).length;
  const soldiers = world.settlers.filter((s) => s.owner === owner && isSoldierType(s.settlerType)).length;
  const goods = BAR_GOODS.map((g) => {
    const n = storedOf(world, owner, g);
    return `<span><span class="muted">${GOOD_LABELS[g]}</span><b class="${n === 0 && (g === 'plank' || g === 'stone') ? 'is-low' : ''}">${n}</b></span>`;
  }).join('');
  return `${goods}<span><span class="muted">Free carriers</span><b class="${idle === 0 ? 'is-low' : ''}">${idle}</b></span><span><span class="muted">Soldiers</span><b>${soldiers}</b></span>`;
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

export interface MenuState {
  savedAt: string | null;
  autosavedAt: string | null;
  notice: string | null;
  isMatch: boolean;
  isConfirmingSurrender: boolean;
  /** The opponent type used last; its choice is highlighted. */
  botType: BotType;
  /** The map size selected for the next match. */
  mapSize: MapSizeType;
  /** The people selected for the next match. */
  raceType: RaceType;
}

/** Typical match length in bot-vs-bot runs, per opponent and map size; shown so players can pick a game that fits their time. */
const MATCH_LENGTHS: Record<BotType, Record<MapSizeType, string>> = {
  calm: { small: 'one to two hours', medium: 'two hours or more', large: 'two hours or more' },
  aggressive: { small: 'about an hour (about 15 minutes at 4×)', medium: 'about an hour or more', large: 'well over an hour' }
};

function opponentText(botType: BotType, mapSize: MapSizeType): string {
  const firstAttack = BOT_TYPE_SETTINGS[botType].firstAttackMinutes[mapSize];
  const start = firstAttack > 0 ? `Builds up first and attacks after about ${firstAttack} minutes.` : 'Attacks as soon as it has soldiers.';
  return `${start} A match lasts ${MATCH_LENGTHS[botType][mapSize]}.`;
}

export function renderGameMenu(state: MenuState): string {
  return `
    <button type="button" class="menu-item" data-action="save">Save game</button>
    <button type="button" class="menu-item" data-action="load" ${state.savedAt ? '' : 'disabled'}>Load saved game${state.savedAt ? `<span class="muted">${state.savedAt}</span>` : ''}</button>
    <button type="button" class="menu-item" data-action="load-autosave" ${state.autosavedAt ? '' : 'disabled'}>Load autosave${state.autosavedAt ? `<span class="muted">${state.autosavedAt}</span>` : ''}</button>
    <div class="menu-section" role="group" aria-labelledby="menu-new-match">
      <span class="menu-label" id="menu-new-match">New match against the computer</span>
      <span class="menu-hint" id="menu-race">Your people</span>
      <div class="race-row" role="radiogroup" aria-labelledby="menu-race">
        ${RACE_TYPES.map((r) => `
          <button type="button" class="race-choice ${r === state.raceType ? 'is-on' : ''}" role="radio" aria-checked="${r === state.raceType}" data-action="race" data-race="${r}">
            <span class="opponent-name">${RACE_SETTINGS[r].label}</span>
            <span class="muted">${RACE_SETTINGS[r].summary}</span>
          </button>`).join('')}
      </div>
      <span class="menu-hint" id="menu-map-size">Map size</span>
      <div class="map-size-row" role="radiogroup" aria-labelledby="menu-map-size">
        ${MAP_SIZE_TYPES.map((m) => `
          <button type="button" class="map-size-choice ${m === state.mapSize ? 'is-on' : ''}" role="radio" aria-checked="${m === state.mapSize}" data-action="map-size" data-size="${m}">
            <span class="opponent-name">${MAP_SIZE_SETTINGS[m].label}</span>
            <span class="muted">${MAP_SIZE_SETTINGS[m].width} × ${MAP_SIZE_SETTINGS[m].height}</span>
          </button>`).join('')}
      </div>
      <span class="menu-hint">Opponent — starts the match; the computer plays another people</span>
      ${BOT_TYPES.map((t) => `
        <button type="button" class="opponent-choice ${t === state.botType ? 'is-on' : ''}" data-action="new-match" data-bot="${t}">
          <span class="opponent-name">${BOT_TYPE_SETTINGS[t].label}</span>
          <span class="muted">${opponentText(t, state.mapSize)}</span>
        </button>`).join('')}
    </div>
    <button type="button" class="menu-item" data-action="new-sandbox">New sandbox (no opponent)</button>
    ${state.isMatch ? (state.isConfirmingSurrender
      ? `<div class="menu-confirm"><span>Give up this match?</span><button type="button" class="danger" data-action="confirm-surrender">Surrender</button><button type="button" class="secondary" data-action="cancel-surrender">Keep playing</button></div>`
      : '<button type="button" class="menu-item" data-action="surrender">Surrender…</button>') : ''}
    ${state.notice ? `<p class="menu-notice">${escapeHtml(state.notice)}</p>` : ''}`;
}

export function renderMessages(world: World, owner: number, dismissed: Set<number>): string {
  const recent = world.messages
    .filter((m) => m.owner === owner && !dismissed.has(m.id) && world.tick - m.tick < 30 * TICKS_PER_SECOND)
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
  if (isMilitaryBuilding(b)) {
    if (b.garrison.length === 0) return { text: b.typeId === 'castle' ? 'No soldiers inside' : 'Unoccupied: claims no land', isWarning: true };
    return { text: b.typeId === 'castle' ? 'Defended' : 'Occupied · claims territory', isWarning: false };
  }
  if (isStorageBuilding(b)) return { text: 'Storing goods', isWarning: false };
  if (b.residentsLeft > 0) return { text: `${b.residentsLeft} settlers still moving in`, isWarning: false };
  if (type.residents > 0) return { text: 'Everyone has moved in', isWarning: false };
  const worker = settlerById(world, b.workerId);
  if (type.worker && !worker) return { text: 'Waiting for a worker', isWarning: false };
  if (worker && (worker.phase === 'toWork' || worker.phase === 'toTool')) return { text: 'Worker on the way', isWarning: false };
  if (b.typeId === 'small_temple' && worker?.phase === 'working') {
    const drink = GOOD_LABELS[RACE_DRINKS[world.players[b.owner].raceType]].toLowerCase();
    return { text: `Offering ${drink} · ${Math.floor((1 - worker.timer / OFFERING_TICKS) * 100)}%`, isWarning: false };
  }
  if (b.typeId === 'large_temple') {
    const left = Math.max(0, PRIEST_TICKS - b.timer);
    return { text: `Next priest in ${formatClock(left)}`, isWarning: false };
  }
  if (type.warMachine && worker?.phase === 'working') {
    const done = 1 - worker.timer / WAR_MACHINE_STATS[type.warMachine].buildTicks;
    return { text: `Building a ${SETTLER_LABELS[type.warMachine].toLowerCase()} · ${Math.floor(done * 100)}%`, isWarning: false };
  }
  if (type.warMachine) {
    const out = machinesOf(world, b).length;
    if (out >= WAR_MACHINES_PER_HALL) return { text: `All ${WAR_MACHINES_PER_HALL} ${SETTLER_PLURALS[type.warMachine].toLowerCase()} are out`, isWarning: false };
  }
  if (b.typeId === 'healer') {
    const wounded = world.settlers.filter((s) => s.owner === b.owner && isSoldierType(s.settlerType) && !s.isInside
      && s.health < SOLDIER_STATS[s.settlerType].health && Math.hypot(s.x - b.doorX, s.y - b.doorY) <= HEAL_RADIUS).length;
    return { text: `Heals your soldiers within ${HEAL_RADIUS} tiles · ${wounded} wounded nearby`, isWarning: false };
  }
  return { text: 'Working', isWarning: false };
}

/** The marketplace card: its route, the amounts to send, the mode and its donkeys. */
function renderMarketplace(world: World, b: Building, owner: number, isConfirmingDemolish: boolean): string {
  const route = b.tradeRoute;
  const donkeys = donkeysOf(world, b);
  const stocked = new Set<GoodType>();
  // Goods worth a caravan: at least one donkey load in storage, or already ordered.
  const inStorage: Partial<Record<GoodType, number>> = {};
  for (const s of world.buildings) if (s.owner === owner && isStorageBuilding(s)) for (const g of GOOD_TYPES) inStorage[g] = (inStorage[g] ?? 0) + s.stock[g];
  for (const g of GOOD_TYPES) if ((inStorage[g] ?? 0) >= DONKEY_LOAD) stocked.add(g);
  for (const g of GOOD_TYPES) if ((route?.goods[g] ?? 0) !== 0) stocked.add(g);
  const goods = GOOD_TYPES.filter((g) => stocked.has(g)).map((g) => {
    const amount = route?.goods[g] ?? 0;
    const shown = amount === TRADE_UNLIMITED ? 'All' : String(amount);
    return `<div class="made-row"><span class="grow">${GOOD_LABELS[g]}</span><span class="stepper">
      <button type="button" class="icon-button" data-action="trade-good" data-good="${g}" data-step="-1" aria-label="${GOOD_LABELS[g]}: less" ${!route || amount === 0 ? 'disabled' : ''}>−</button>
      <b class="num trade-amount">${shown}</b>
      <button type="button" class="icon-button" data-action="trade-good" data-good="${g}" data-step="1" aria-label="${GOOD_LABELS[g]}: more" ${!route || amount === TRADE_UNLIMITED ? 'disabled' : ''}>+</button></span></div>`;
  }).join('');
  const modes = TRADE_MODE_TYPES.map((m) => `<button type="button" data-action="trade-mode" data-mode="${m}" aria-pressed="${b.tradeMode === m}">${TRADE_MODE_LABELS[m]}</button>`).join('');
  const status = !route ? 'No route yet: set where the caravans go'
    : b.tradeMode === 'suspended' ? 'Suspended'
    : donkeys.length === 0 ? 'Waiting for donkeys from a donkey ranch'
    : `${donkeys.filter((d) => d.phase === 'toTarget').length} caravans on the way`;
  return `
    <div class="detail-head"><span class="detail-title">${buildingLabel(b.typeId, world.players[b.owner].raceType)}</span><button type="button" class="close" data-action="deselect" aria-label="Close">×</button></div>
    <span class="${!route || donkeys.length === 0 ? 'status-warning' : ''}">${status}</span>
    <dl class="facts">
      <dt>Route</dt><dd>${route ? `to ${route.x}, ${route.y}${route.waypoints.length ? ` · ${route.waypoints.length} waypoints` : ''}` : 'None'}</dd>
      <dt>Donkeys</dt><dd>${donkeys.length} of ${DONKEYS_PER_MARKETPLACE}</dd>
    </dl>
    <div class="segmented" role="group" aria-label="Trade mode">${modes}</div>
    <span class="muted">${b.tradeMode === 'surplus' ? `Storage keeps ${TRADE_SURPLUS_RESERVE} of each good for the settlement.` : b.tradeMode === 'construction' ? 'Carriers serve the marketplace before construction sites.' : 'No goods are collected and the donkeys wait.'}</span>
    ${route ? `<h3 class="section-title">Goods to send (${DONKEY_LOAD} per donkey)</h3>${goods || '<p class="empty">No goods in storage yet.</p>'}` : ''}
    ${isConfirmingDemolish
      ? `<div class="actions"><button type="button" class="danger" data-action="confirm-demolish">Demolish now</button><button type="button" class="secondary" data-action="cancel-demolish">Keep it</button></div>`
      : `<div class="actions"><button type="button" class="primary" data-action="set-route">${route ? 'Change route' : 'Set route'}</button><button type="button" class="secondary" data-action="demolish">Demolish</button></div>`}`;
}

/** A hall's war machines in the field. */
export function machinesOf(world: World, b: Building): Settler[] {
  return world.settlers.filter((s) => s.homeId === b.id && isWarMachineType(s.settlerType) && s.health > 0 && !s.isInside);
}

function structureBar(b: Building): string {
  const max = BUILDING_STRUCTURE[b.typeId]!, left = Math.max(0, max - b.damage);
  return `<div class="structure"><span>Structure ${Math.round(left)} of ${max}</span><span class="bar" aria-hidden="true"><span style="width:${(left / max) * 100}%"></span></span></div>`;
}

export function renderSelection(world: World, b: Building, owner: number, isConfirmingDemolish: boolean, selectedSoldiers: number): string {
  const type = BUILDING_TYPES[b.typeId];
  if (b.owner !== owner) {
    const canAttack = isMilitaryBuilding(b) && b.isComplete;
    const cover = canAttack ? coveringBuilding(world, b) : null;
    return `
      <div class="detail-head"><span class="detail-title">Enemy ${buildingLabel(b.typeId, world.players[b.owner].raceType).toLowerCase()}</span><button type="button" class="close" data-action="deselect" aria-label="Close">×</button></div>
      ${canAttack ? `<span>${b.garrison.length} ${b.garrison.length === 1 ? 'defender' : 'defenders'} inside</span>`
        : `<span class="muted">${isMilitaryBuilding(b) ? 'Still being built' : 'Not a military building'}</span>`}
      ${b.damage > 0 && BUILDING_STRUCTURE[b.typeId] ? structureBar(b) : ''}
      ${cover ? `<span class="status-warning">Covered by the ${BUILDING_TYPES[cover.typeId].label.toLowerCase()} behind it: it cannot be taken until that one falls. Attacking still fights its defenders.</span>` : ''}
      ${canAttack ? `<div class="actions"><button type="button" class="primary" data-action="attack-selected" ${selectedSoldiers > 0 ? '' : 'disabled'}>${selectedSoldiers > 0 ? `Attack with ${selectedSoldiers} selected` : 'Select soldiers or war machines to attack'}</button></div>` : ''}`;
  }
  const status = buildingStatus(world, b);
  const lines: string[] = [];
  if (!b.isComplete) {
    const missing: Partial<GoodAmounts> = {};
    const cost = siteCost(world, b);
    for (const g of GOOD_TYPES) missing[g] = (cost[g] ?? 0) - b.built[g] - b.delivered[g];
    lines.push(`<dt>Still needs</dt><dd>${costTotal(missing) > 0 ? costText(missing, ', ') : 'Nothing'}</dd>`);
  } else {
    if (isMilitaryBuilding(b)) {
      lines.push(`<dt>Soldiers</dt><dd>${b.garrison.length} inside</dd>`);
    }
    if (b.damage > 0 && BUILDING_STRUCTURE[b.typeId]) lines.push(`<dt>Structure</dt><dd>${Math.max(0, Math.round(BUILDING_STRUCTURE[b.typeId]! - b.damage))} of ${BUILDING_STRUCTURE[b.typeId]}</dd>`);
    if (type.warMachine) {
      const stats = WAR_MACHINE_STATS[type.warMachine];
      lines.push(`<dt>${SETTLER_PLURALS[type.warMachine]} out</dt><dd>${machinesOf(world, b).length} of ${WAR_MACHINES_PER_HALL}</dd>`);
      lines.push(`<dt>Ammunition (${GOOD_LABELS[stats.ammo].toLowerCase()})</dt><dd>${b.input[stats.ammo]}</dd>`);
      const parts = GOOD_TYPES.filter((g) => stats.parts[g]).map((g) => `${GOOD_LABELS[g].toLowerCase()} ${Math.min(b.input[g], stats.parts[g]!)}/${stats.parts[g]}`);
      lines.push(`<dt>Parts for the next one</dt><dd>${parts.join(' · ')}</dd>`);
    } else if (b.typeId !== 'castle') {
      for (const g of GOOD_TYPES) {
        if (b.input[g] > 0) lines.push(`<dt>${GOOD_LABELS[g]} in</dt><dd>${b.input[g]}</dd>`);
        if (b.stock[g] > 0) lines.push(`<dt>${GOOD_LABELS[g]}</dt><dd>${b.stock[g]}${isStorageBuilding(b) ? '' : ' ready'}</dd>`);
      }
    }
    if (type.worker) {
      const worker = settlerById(world, b.workerId);
      lines.push(`<dt>Worker</dt><dd>${worker ? SETTLER_LABELS[worker.settlerType] : 'None yet'}</dd>`);
    }
    if (type.mine) lines.push(`<dt>Meals left</dt><dd>${b.meals}</dd>`);
  }
  if (b.typeId === 'marketplace' && b.isComplete) return renderMarketplace(world, b, owner, isConfirmingDemolish);
  if (b.typeId === 'donkey_ranch' && b.isComplete) lines.push(`<dt>Donkeys here</dt><dd>${donkeysOf(world, b).length} of ${DONKEYS_PER_MARKETPLACE}</dd>`);
  const garrison = b.isComplete && isMilitaryBuilding(b)
    ? `<div class="made-row"><span>Soldiers wanted</span>${stepper('garrison', `data-id="${b.id}"`, b.garrisonWanted, 'Soldiers wanted')}<span class="muted">of ${type.garrisonCapacity}</span></div>` : '';
  const canPause = (b.isComplete && type.worker !== null) || !b.isComplete;
  const hasWorkArea = b.isComplete && (WORK_AREA_BUILDINGS as readonly string[]).includes(b.typeId);
  const pauseLabel = b.isComplete ? (b.isPaused ? 'Resume' : 'Pause') : (b.isPaused ? 'Resume' : 'Suspend');
  const actions = b.typeId === 'castle' ? '' : isConfirmingDemolish
    ? `<div class="actions"><button type="button" class="danger" data-action="confirm-demolish">Demolish now</button><button type="button" class="secondary" data-action="cancel-demolish">Keep it</button></div>
       <span class="muted">Half of its materials go back to the castle.</span>`
    : `<div class="actions">
        ${!b.isComplete ? `<button type="button" class="${b.isPriority ? 'primary' : 'secondary'}" data-action="toggle-priority" aria-pressed="${b.isPriority}">Build first</button>` : ''}
        ${hasWorkArea ? `<button type="button" class="secondary" data-action="work-area">Set work area</button>` : ''}
        ${canPause ? `<button type="button" class="secondary" data-action="toggle-pause">${pauseLabel}</button>` : ''}
        ${type.warMachine && b.isComplete ? `<button type="button" class="secondary" data-action="select-hall-machines" ${machinesOf(world, b).length ? '' : 'disabled'}>Select its ${SETTLER_PLURALS[type.warMachine].toLowerCase()}</button>` : ''}
        <button type="button" class="secondary" data-action="demolish">${b.isComplete ? 'Demolish' : 'Cancel construction'}</button>
      </div>`;
  return `
    <div class="detail-head"><span class="detail-title">${buildingLabel(b.typeId, world.players[b.owner].raceType)}</span><button type="button" class="close" data-action="deselect" aria-label="Close">×</button></div>
    <span class="${status.isWarning ? 'status-warning' : ''}">${escapeHtml(status.text)}</span>
    ${lines.length ? `<dl class="facts">${lines.join('')}</dl>` : ''}
    ${garrison}
    ${actions}`;
}

/** What the priest bar needs to know: the player's manna, people and the spell being aimed. */
export interface PriestBarState { manna: number; race: RaceType; spell: SpellType | null }

/** The bar for selected priests: their people's spells with costs, and Move. */
function renderPriestBar(priests: Settler[], mode: OrderMode, isTouch: boolean, magic: PriestBarState): string {
  const ready = priests.filter((p) => p.timer === 0).length;
  const summary = priests.length === 1 ? 'Priest selected' : `${priests.length} priests selected`;
  const detail = `${magic.manna} manna · ${ready === priests.length ? 'ready to cast' : ready > 0 ? `${ready} ready, the others resting` : 'resting after a spell'}`;
  const buttons = RACE_SPELLS[magic.race].map((spell) => {
    const stats = SPELL_STATS[spell];
    const isOn = mode === 'spell' && magic.spell === spell;
    return `<button type="button" class="order-mode spell" data-action="cast-mode" data-spell="${spell}" aria-pressed="${isOn}" ${magic.manna < stats.cost ? 'disabled' : ''}
      title="${escapeHtml(stats.summary)}"><b>${stats.label}</b><span>${stats.cost} manna</span></button>`;
  }).join('');
  const aimed = mode === 'spell' && magic.spell ? SPELL_STATS[magic.spell] : null;
  const hint = aimed
    ? `${isTouch ? 'Tap' : 'Click'} the spot${aimed.isRanged ? ', anywhere on the map' : `: within the dashed ring (${SPELL_RANGE} tiles)`}. ${aimed.label}: ${aimed.summary.toLowerCase()}.`
    : mode === 'move' ? 'Tap or click where they should go'
    : 'Choose a spell, then tap the spot. Far sight and Blight work at any distance.';
  return `
    <div class="order-summary"><strong>${summary}</strong><span class="muted">${detail}</span></div>
    <div class="order-buttons" role="toolbar" aria-label="Spells">
      ${buttons}
      <button type="button" class="order-mode" data-action="order-mode" data-mode="move" aria-pressed="${mode === 'move'}">Move</button>
      <button type="button" class="order-mode" data-action="clear-selection">Clear</button>
    </div>
    <span class="order-hint muted">${hint}</span>`;
}

/** The order bar: what is selected and what to do with it. Order modes make every order reachable by touch. */
export function renderOrderBar(units: Settler[], mode: OrderMode, isTouch: boolean, strength: number, magic?: PriestBarState): string {
  const priests = units.filter((s) => s.settlerType === 'priest');
  if (magic && priests.length > 0 && priests.length === units.length) return renderPriestBar(priests, mode, isTouch, magic);
  const soldiers = units.filter((s) => isSoldierType(s.settlerType));
  const machines = units.filter((s) => isWarMachineType(s.settlerType));
  const fighters = units.filter((s) => isUnitType(s.settlerType));
  const types: SettlerType[] = [...SOLDIER_TYPES, ...WAR_MACHINE_TYPES, ...SPECIALIST_TYPES];
  const byType = types.map((t) => ({ t, n: units.filter((s) => s.settlerType === t).length })).filter((x) => x.n > 0);
  const onlyType = byType.length === 1 ? byType[0] : null;
  const summary = units.length === 0 ? 'Nobody selected'
    : soldiers.length === units.length ? `${units.length} ${units.length === 1 ? 'soldier' : 'soldiers'} selected`
    : onlyType && machines.length === units.length ? `${units.length} ${(units.length === 1 ? SETTLER_LABELS[onlyType.t] : SETTLER_PLURALS[onlyType.t]).toLowerCase()} selected`
    : `${units.length} selected`;
  const shots = machines.slice(0, 4).map((m) => {
    const stats = WAR_MACHINE_STATS[m.settlerType as (typeof WAR_MACHINE_TYPES)[number]];
    return m.phase === 'returning' ? 'reloading' : `${m.ammo} of ${stats.shots} shots`;
  });
  const detail = [...(machines.length === units.length ? [] : byType.map((x) => `${x.n} ${(x.n === 1 ? SETTLER_LABELS[x.t] : SETTLER_PLURALS[x.t]).toLowerCase()}`)),
    ...shots, ...(machines.length > 0 ? ['they reload at their hall by themselves'] : []),
    ...(soldiers.length > 0 ? [`strength ${Math.round(strength * 100)} % outside your land`] : [])].join(' · ');
  const hint = mode === 'select' ? (isTouch ? 'Drag over soldiers to select them' : 'Drag a box around soldiers')
    : mode === 'move' ? 'Tap or click where they should go'
    : mode === 'attack' ? (machines.length > 0 ? 'Tap or click an enemy tower or castle to fire at it' : 'Tap or click an enemy tower or castle')
    : mode === 'waypoint' ? 'Tap or click each spot in turn, then press Done'
    : mode === 'patrol' ? 'Tap or click the far end of the patrol'
    : mode === 'free' ? 'Tap or click where they should go; they will not stop to fight'
    : isTouch ? (machines.length > 0 ? 'War machines need open ground: no forest, rocks or mountains' : '')
    : machines.length > 0 ? 'Right-click an enemy tower or castle: fire at it · right-click ground: move · Shift: waypoint. War machines need open ground: no forest, rocks or mountains.'
    : 'Right-click: move or attack · Shift: waypoint · Alt: patrol · H: hold';
  const modeButton = (id: Exclude<OrderMode, null>, label: string, isDisabled = false) =>
    `<button type="button" class="order-mode" data-action="order-mode" data-mode="${id}" aria-pressed="${mode === id}" ${isDisabled ? 'disabled' : ''}>${label}</button>`;
  return `
    <div class="order-summary"><strong>${summary}</strong>${detail ? `<span class="muted">${detail}</span>` : ''}</div>
    <div class="order-buttons" role="toolbar" aria-label="Soldier orders">
      ${modeButton('select', 'Select')}
      <button type="button" class="order-mode" data-action="select-in-view">All in view</button>
      ${modeButton('move', 'Move', units.length === 0)}
      ${modeButton('attack', soldiers.length === 0 && machines.length > 0 ? 'Fire at' : 'Attack', fighters.length === 0)}
      ${mode === 'waypoint' ? `<button type="button" class="order-mode" data-action="order-mode" data-mode="waypoint" aria-pressed="true">Done</button>` : modeButton('waypoint', 'Waypoint', fighters.length === 0)}
      ${modeButton('patrol', 'Patrol', fighters.length === 0)}
      <button type="button" class="order-mode" data-action="hold" ${soldiers.length === 0 ? 'disabled' : ''} title="Key H">Hold</button>
      ${modeButton('free', 'Move, no fighting', soldiers.length === 0)}
      <button type="button" class="order-mode" data-action="back-to-towers" ${soldiers.length === 0 ? 'disabled' : ''} title="Back to the castle">Retreat</button>
      <button type="button" class="order-mode" data-action="clear-selection" ${units.length === 0 && mode === null ? 'disabled' : ''}>Clear</button>
    </div>
    ${hint ? `<span class="order-hint muted">${hint}</span>` : ''}`;
}

export function renderEndScreen(world: World, owner: number): string {
  const isWin = world.winner === owner;
  const you = world.players[owner].stats, them = world.players.find((p) => p.id !== owner)?.stats;
  const rows: [string, number, number | undefined][] = [
    ['Buildings built', you.buildingsBuilt, them?.buildingsBuilt],
    ['Largest territory (tiles)', you.largestTerritory, them?.largestTerritory],
    ['Soldiers recruited', you.soldiersRecruited, them?.soldiersRecruited],
    ['Soldiers lost', you.soldiersLost, them?.soldiersLost],
    ['Towers taken', you.towersTaken, them?.towersTaken],
    ['Planks made', you.planksMade, them?.planksMade],
    ['Bread baked', you.breadBaked, them?.breadBaked]
  ];
  return `
    <div class="end-card" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <span class="end-eyebrow">Match over · ${formatClock(world.tick)}</span>
      <h1 id="end-title" class="end-title">${isWin ? 'Victory' : 'Defeat'}</h1>
      <p class="muted">${isWin ? 'Your soldiers took the enemy castle.' : world.players[owner].isEliminated && castleOf(world, owner) ? 'You surrendered.' : 'The enemy took your castle.'}</p>
      <table class="end-table">
        <thead><tr><th></th><th>You</th><th>Computer</th></tr></thead>
        <tbody>${rows.map(([label, a, b]) => `<tr><td>${label}</td><td>${a.toLocaleString('en')}</td><td>${(b ?? 0).toLocaleString('en')}</td></tr>`).join('')}</tbody>
      </table>
      <div class="actions">
        <button type="button" class="primary" data-action="play-again">Play again on this map</button>
        <button type="button" class="secondary" data-action="new-match">New map</button>
        <button type="button" class="secondary" data-action="close-end">Look at the map</button>
      </div>
    </div>`;
}
