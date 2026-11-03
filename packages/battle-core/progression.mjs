/**
 * Hero progression formulas (S23/S24/S28, ADR 0021). Pure integer arithmetic so
 * the server, Studio and tests compute the same numbers.
 */
export const SLOTS = ['weapon', 'armor', 'helmet', 'boots', 'jewelry', 'artifact'];
export const MAX = {hp: 1000000, attack: 1000000, defense: 1000000, speed: 5000};

export function progressionOf(content) {
  return content?.entities?.find(e => e.kind === 'progression')?.data ?? null;
}

/** Gold and hero_exp to go from `level` to `level + 1`. */
export function levelCost(p, level) {
  return {gold: p.level_gold_base + p.level_gold_step * (level - 1), hero_exp: p.level_exp_base + p.level_exp_step * (level - 1)};
}

/** Level cap of a rank index (clamped to the table). */
export function rankCap(p, rank) {
  return p.ranks[Math.min(rank, p.ranks.length - 1)].max_level;
}

/** Gold to upgrade an item from `upgrade` to `upgrade + 1`. */
export function upgradeCost(item, upgrade) {
  return (item.data.upgrade_gold ?? 0) * (upgrade + 1);
}

/** Flat item bonus at an upgrade level. */
export function itemStats(item, upgrade) {
  const out = {};
  for (const [k, v] of Object.entries(item.data.stats ?? {})) out[k] = Math.floor((v * (10000 + upgrade * (item.data.upgrade_bp ?? 0))) / 10000);
  return out;
}

/**
 * Combat stats of a hero at a level/rank with equipped items:
 * base * (1 + growth*(level-1) + rank bonus) + item bonuses, clamped to core limits.
 * @param {any} p @param {any} combat
 * @param {{level?:number,rank?:number,items?:{item_id:string,upgrade:number}[]}} [mods]
 * @param {Map<string,any>} [byId]
 */
export function heroStats(p, combat, {level = 1, rank = 0, items = []} = {}, byId = new Map()) {
  const rankBp = p ? p.ranks[Math.min(rank, p.ranks.length - 1)].stat_bp : 0;
  const mult = 10000 + (p ? p.growth_bp * (level - 1) : 0) + rankBp;
  const out = {...combat};
  for (const k of ['hp', 'attack', 'defense']) out[k] = Math.floor((combat[k] * mult) / 10000);
  for (const {item_id, upgrade} of items) {
    const item = byId.get(item_id);
    if (!item) continue;
    for (const [k, v] of Object.entries(itemStats(item, upgrade))) out[k] += v;
  }
  for (const k of Object.keys(MAX)) out[k] = Math.min(MAX[k], Math.max(k === 'hp' ? 1 : 0, out[k]));
  return out;
}

/**
 * Levels after sync (S24): main heroes use their own level. When all five main
 * slots are filled, sync heroes get the lowest main level, capped by their own
 * rank; with fewer than five mains sync is off and they keep their own level.
 * Returns {sync_level|null, level(instance) -> effective level}.
 */
export function effectiveLevels(p, instances, main, sync) {
  const byId = new Map(instances.map(i => [i.id, i]));
  const mains = main.map(id => byId.get(id)).filter(Boolean);
  const syncLevel = mains.length === 5 ? Math.min(...mains.map(i => i.level)) : null;
  const sset = new Set(sync);
  const level = i => (syncLevel !== null && sset.has(i.id) ? Math.min(syncLevel, rankCap(p, i.rank)) : i.level);
  return {sync_level: syncLevel, level};
}
