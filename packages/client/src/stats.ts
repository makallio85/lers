/**
 * The statistics window: goods made over the match and how each player's kingdom grew, drawn as line charts from
 * the samples the simulation takes once a minute (plus one for now).
 */
import { GOOD_LABELS, RACE_SETTINGS, STATS_SAMPLE_TICKS, TICKS_PER_SECOND, isEnemy, isSoldierType, isUnitType } from '../../simulation/src/index.ts';
import type { GoodType, StatsSample, World } from '../../simulation/src/index.ts';
import { OWNER_COLORS, SERIES_COLORS, cssColor } from './colors.ts';

export type StatsViewId = 'goods' | 'kingdom';
export type StatsGoodsGroupId = 'materials' | 'food' | 'mining' | 'drinks' | 'tools' | 'weapons';

export const STATS_VIEWS: { id: StatsViewId; label: string }[] = [{ id: 'goods', label: 'Goods made' }, { id: 'kingdom', label: 'Kingdoms' }];

/** Goods in groups of at most eight, so each good keeps its colour slot inside its group. */
export const STATS_GOODS_GROUPS: { id: StatsGoodsGroupId; label: string; goods: GoodType[] }[] = [
  { id: 'materials', label: 'Materials', goods: ['log', 'plank', 'stone'] },
  { id: 'food', label: 'Food', goods: ['grain', 'flour', 'water', 'bread', 'fish', 'pig', 'meat'] },
  { id: 'mining', label: 'Mining', goods: ['coal', 'iron_ore', 'iron', 'gold_ore', 'gold', 'sulfur', 'gems', 'gunpowder'] },
  { id: 'drinks', label: 'Drinks', goods: ['wine', 'beer', 'rice', 'rice_wine', 'honey', 'mead'] },
  { id: 'tools', label: 'Tools', goods: ['axe', 'saw', 'pick', 'scythe', 'shovel', 'hammer', 'rod'] },
  { id: 'weapons', label: 'Weapons', goods: ['sword', 'spear', 'bow'] }
];

type Measure = 'land' | 'settlers' | 'soldiers' | 'buildings';
const MEASURES: { id: Measure; label: string; unit: string }[] = [
  { id: 'land', label: 'Land', unit: 'tiles' }, { id: 'settlers', label: 'Settlers', unit: '' },
  { id: 'soldiers', label: 'Soldiers', unit: '' }, { id: 'buildings', label: 'Buildings', unit: '' }
];

interface Series { label: string; color: string; values: number[] }

/** The samples so far plus one for this moment, so the charts end at now. */
function samplesOf(world: World, playerId: number): StatsSample[] {
  const p = world.players[playerId];
  const history = p.stats.history;
  if (history.length > 0 && history[history.length - 1].tick === world.tick) return history;
  let settlers = 0, soldiers = 0, buildings = 0, land = 0;
  for (const s of world.settlers) if (s.owner === playerId) { if (isSoldierType(s.settlerType)) soldiers++; else if (!isUnitType(s.settlerType)) settlers++; }
  for (const b of world.buildings) if (b.owner === playerId && b.isComplete) buildings++;
  for (const t of world.territory) if (t === playerId + 1) land++;
  return [...history, { tick: world.tick, goodsMade: { ...p.stats.goodsMade }, land, settlers, soldiers, buildings }];
}

export function playerName(world: World, owner: number, playerId: number): string {
  if (playerId === owner) return 'You';
  const p = world.players[playerId];
  return `${isEnemy(world, owner, playerId) ? 'Enemy' : 'Ally'} ${playerId} · ${RACE_SETTINGS[p.raceType].label}`;
}

function minutes(tick: number): string {
  const m = Math.round(tick / TICKS_PER_SECOND / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * step >= value) return k * step;
  return 10 * step;
}

/**
 * A line chart as SVG: running values per sample, one y axis from zero, minutes along the bottom. The hover layer
 * reads `data-tips` (one line of text per sample) and `data-ticks`; main.ts draws the crosshair and tooltip.
 */
function lineChart(ticks: number[], series: Series[], title: string, W = 640, H = 220): string {
  const left = 44, right = 12, top = 10, bottom = 26;
  const pw = W - left - right, ph = H - top - bottom;
  const maxValue = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const span = Math.max(1, ticks[ticks.length - 1] - ticks[0]);
  const x = (t: number) => left + ((t - ticks[0]) / span) * pw;
  const y = (v: number) => top + ph - (v / maxValue) * ph;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = maxValue * f;
    return `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" class="grid${f === 0 ? ' base' : ''}"/>`
      + `<text x="${left - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${v.toLocaleString('en', { maximumFractionDigits: 1 })}</text>`;
  }).join('');
  const xLabels = [0, 0.5, 1].map((f) => {
    const t = ticks[0] + span * f;
    return `<text x="${x(t)}" y="${H - 6}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}" class="axis">${minutes(t)}</text>`;
  }).join('');
  const lines = series.map((s) => {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(ticks[i]).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const last = s.values.length - 1;
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
      + `<circle cx="${x(ticks[last])}" cy="${y(s.values[last])}" r="4" fill="${s.color}" stroke="var(--panel)" stroke-width="2"/>`;
  }).join('');
  const tips = ticks.map((t, i) => [minutes(t), ...series.map((s) => `${s.label}: ${s.values[i].toLocaleString('en')}`)].join('|'));
  return `<figure class="chart" data-left="${left / W}" data-right="${(W - right) / W}" data-tips="${tips.join('~').replace(/"/g, '&quot;')}">
    <figcaption>${title}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">${grid}${xLabels}${lines}</svg>
    <div class="chart-cross" hidden></div><div class="chart-tip" hidden></div>
  </figure>`;
}

function legend(series: Series[]): string {
  return `<ul class="chart-legend">${series.map((s) => `<li><span class="swatch" style="background:${s.color}"></span>${s.label}</li>`).join('')}</ul>`;
}

function pills<T extends string>(items: { id: T; label: string }[], active: T, action: string, label: string): string {
  return `<div class="groups" role="tablist" aria-label="${label}">${items.map((v) =>
    `<button type="button" role="tab" class="pill" data-action="${action}" data-view="${v.id}" aria-selected="${v.id === active}">${v.label}</button>`).join('')}</div>`;
}

function goodsView(world: World, owner: number, groupId: StatsGoodsGroupId): string {
  const samples = samplesOf(world, owner);
  const ticks = samples.map((s) => s.tick);
  const group = STATS_GOODS_GROUPS.find((g) => g.id === groupId) ?? STATS_GOODS_GROUPS[0];
  // Each good keeps the colour of its place in the group, whether or not the others are drawn.
  const all = group.goods.map((g, k) => ({ good: g, label: GOOD_LABELS[g], color: SERIES_COLORS[k], values: samples.map((s) => s.goodsMade[g] ?? 0) }));
  const made = all.filter((s) => s.values[s.values.length - 1] > 0);
  const tenMinutesAgo = Math.max(0, samples.length - 1 - Math.round(10 * 60 * TICKS_PER_SECOND / STATS_SAMPLE_TICKS));
  const rows = all.map((s) => {
    const total = s.values[s.values.length - 1], recent = total - s.values[tenMinutesAgo];
    return `<tr><td><span class="swatch" style="background:${s.color}"></span>${s.label}</td><td>${total.toLocaleString('en')}</td><td>${recent.toLocaleString('en')}</td></tr>`;
  }).join('');
  const chart = made.length && samples.length > 1
    ? `${legend(made)}${lineChart(ticks, made, `${group.label} made so far`)}`
    : `<p class="empty">No ${group.label.toLowerCase()} made yet.</p>`;
  return `${pills(STATS_GOODS_GROUPS, group.id, 'stats-group', 'Goods groups')}${chart}
    <table class="stats-table"><thead><tr><th>Good</th><th>Made</th><th>Last 10 min</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function kingdomView(world: World, owner: number): string {
  const players = world.players.map((p) => ({ p, samples: samplesOf(world, p.id) }));
  const ticks = players[owner].samples.map((s) => s.tick);
  const seriesFor = (m: Measure) => players.map(({ p, samples }) => ({
    label: playerName(world, owner, p.id), color: cssColor(OWNER_COLORS[p.id % OWNER_COLORS.length]),
    // Every player is sampled on the same ticks; a shorter history (an old save) is padded from the front.
    values: ticks.map((_, i) => samples[i - (ticks.length - samples.length)]?.[m] ?? 0)
  }));
  if (ticks.length < 2) return '<p class="empty">The first sample is taken a minute into the match.</p>';
  return `${legend(seriesFor('land'))}<div class="chart-grid">${MEASURES.map((m) => lineChart(ticks, seriesFor(m.id), m.label + (m.unit ? ` (${m.unit})` : ''), 340, 170)).join('')}</div>`;
}

export function renderStatsScreen(world: World, owner: number, view: StatsViewId, group: StatsGoodsGroupId): string {
  return `<div class="stats-card" role="dialog" aria-modal="true" aria-labelledby="stats-title">
    <div class="detail-head"><h2 class="detail-title" id="stats-title">Statistics</h2><span class="muted">${minutes(world.tick)} played</span>
      <button type="button" class="close" data-action="close-stats" aria-label="Close">×</button></div>
    ${pills(STATS_VIEWS, view, 'stats-view', 'Statistics views')}
    ${view === 'goods' ? goodsView(world, owner, group) : kingdomView(world, owner)}
  </div>`;
}
