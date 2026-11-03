/**
 * Economy formulas (S25/S27/S29, ADR 0022): pure integer math shared by the API,
 * Studio previews and tests. Randomness is injected (server: crypto.randomInt).
 */
export const AFK_BASE_HOURS = 12;
export const HOUR_MS = 3600000;
export const tableOf = (content, kind) => content?.entities?.find(e => e.kind === kind)?.data ?? null;

/** VIP level from accumulated points (0 = no VIP), next threshold and perks. */
export function vipLevel(vip, points) {
  if (!vip) return {level: 0, next_points: null, afk_hours: 0};
  let level = 0;
  for (const [i, l] of vip.levels.entries()) if (points >= l.points) level = i + 1;
  const next = vip.levels[level];
  return {level, next_points: next ? next.points : null, afk_hours: level ? vip.levels[level - 1].afk_hours ?? 0 : 0};
}

/** Days of free daily points (plus daily win cap) to reach each level from zero. */
export function freeDays(vip) {
  const perDay = vip.daily_points + (vip.win_points > 0 ? vip.win_points_daily_cap ?? 0 : 0);
  return vip.levels.map(l => (perDay > 0 ? Math.max(0, Math.ceil((l.points - vip.tutorial_points) / perDay)) : null));
}

/** Server-shown odds: weight / total, as a percent string with two decimals. */
export function summonOdds(pool) {
  const total = pool.entries.reduce((s, e) => s + e.weight, 0);
  return pool.entries.map(e => ({hero_id: e.hero_id, shards: e.shards ?? null, weight: e.weight, chance_pct: ((e.weight * 10000) / total / 100).toFixed(2)}));
}

/**
 * One pull. `since` = pulls since the last guaranteed hero. If it reaches every-1
 * the pull is taken from the guarantee list. Returns {entry, since}.
 */
export function pull(pool, since, randomInt) {
  const g = pool.guarantee;
  if (g && since >= g.every - 1) return {entry: {hero_id: g.hero_ids[randomInt(g.hero_ids.length)]}, since: 0, guaranteed: true};
  const total = pool.entries.reduce((s, e) => s + e.weight, 0);
  let roll = randomInt(total);
  let entry = pool.entries[pool.entries.length - 1];
  for (const e of pool.entries) {
    if (roll < e.weight) { entry = e; break; }
    roll -= e.weight;
  }
  const hit = g && entry.shards === undefined && g.hero_ids.includes(entry.hero_id);
  return {entry: {hero_id: entry.hero_id, ...(entry.shards ? {shards: entry.shards} : {})}, since: hit ? 0 : since + 1, guaranteed: false};
}

/** AFK income per hour with the campaign progress bonus. */
export function afkRate(afk, cleared) {
  if (!afk) return {};
  return Object.fromEntries(afk.per_hour.map(r => [r.currency, Math.floor((r.amount * (10000 + (afk.stage_bonus_bp ?? 0) * cleared)) / 10000)]));
}

/**
 * Accrue from state.segment_at to `until` (ms timestamps) at state.rate, never
 * beyond the cap since the last claim. Units are amount×ms (exact integers).
 */
export function accrue(state, until, capMs) {
  const elapsed = Math.max(0, until - state.segment_at);
  const add = Math.max(0, Math.min(elapsed, capMs - state.accrued_ms));
  const units = {...state.units};
  for (const [c, perHour] of Object.entries(state.rate)) units[c] = (units[c] ?? 0) + perHour * add;
  return {...state, units, accrued_ms: state.accrued_ms + add, segment_at: Math.max(state.segment_at, until)};
}
export const payable = units => Object.fromEntries(Object.entries(units).map(([c, u]) => [c, Math.floor(u / HOUR_MS)]));
