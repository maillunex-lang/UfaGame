import {createHash} from 'node:crypto';
import {createAutoBattle, stepAutoBattle} from './auto.mjs';

/** Provisional faction advantage multiplier: 12000 bp = x1.2 (ADR 0012). */
export const ADVANTAGE_BP = 12000;
const STEP_MS = 100;
const MAX_STEPS = 900;

export class BattleCompileError extends Error {
  constructor(code, entityId = null) {
    super(code);
    this.code = code;
    this.entity_id = entityId;
  }
}
const fail = (code, id) => {
  throw new BattleCompileError(code, id ?? null);
};

function entityMap(content) {
  if (!content || !Array.isArray(content.entities)) fail('INVALID_CONTENT');
  const map = new Map();
  for (const entity of content.entities) {
    if (!entity || typeof entity.id !== 'string' || map.has(entity.id)) fail('INVALID_CONTENT', entity?.id);
    map.set(entity.id, entity);
  }
  return map;
}
const lookup = (map, id, kind, code) => {
  const entity = map.get(id);
  if (!entity || entity.kind !== kind) fail(code, id);
  return entity;
};

function intervalSteps(ms, abilityId) {
  if (!Number.isSafeInteger(ms) || ms < 0) fail('INVALID_CONTENT', abilityId);
  const steps = Math.max(1, Math.ceil(ms / STEP_MS));
  if (steps > MAX_STEPS) fail('ABILITY_COOLDOWN_TOO_LONG', abilityId);
  return steps;
}

function actorFor(map, heroId, team, slot) {
  const hero = lookup(map, heroId, 'hero', 'UNKNOWN_HERO');
  const combat = hero.data?.combat;
  if (!combat) fail('HERO_COMBAT_MISSING', heroId);
  const faction = lookup(map, hero.data.faction_id, 'faction', 'UNKNOWN_FACTION');
  const abilities = hero.data.ability_ids.map(id => lookup(map, id, 'ability', 'UNKNOWN_ABILITY'));
  const [main, ...autos] = abilities;
  if (!main) fail('HERO_ABILITY_MISSING', heroId);
  if (combat.attack_interval_ms % STEP_MS || combat.energy_per_second % 10) fail('INVALID_CONTENT', heroId);
  return {
    hero_id: heroId,
    actor: {
      id: `${team === 'attacker' ? 'atk' : 'def'}_${slot}`,
      team,
      slot,
      hp: combat.hp,
      attack: combat.attack,
      defense: combat.defense,
      speed: combat.speed,
      range: combat.range,
      interval_steps: combat.attack_interval_ms / STEP_MS,
      energy: combat.energy_start,
      energy_per_step: combat.energy_per_second / 10,
      energy_per_attack: combat.energy_per_attack,
      faction_id: faction.id,
      ability: {id: main.id, effect: main.data.effect, power: main.data.power, cost: main.data.energy_cost ?? 1000},
      auto_abilities: autos.map(a => ({
        id: a.id,
        effect: a.data.effect,
        power: a.data.power,
        interval_steps: intervalSteps(a.data.cooldown_ms, a.id),
      })),
    },
  };
}

/**
 * Converts validated Studio content (heroes/abilities/factions/stages) into the
 * internal auto-battle v2 setup. Slot = position in the list (0-1 front, 2-4 back).
 */
export function compileContentBattle(content, request) {
  const map = entityMap(content);
  const {attacker_hero_ids: attackers, seed} = request ?? {};
  let defenders = request?.defender_hero_ids;
  if (request?.stage_id !== undefined) {
    if (defenders !== undefined) fail('INVALID_REQUEST');
    defenders = lookup(map, request.stage_id, 'stage', 'UNKNOWN_STAGE').data.enemy_hero_ids;
  }
  for (const list of [attackers, defenders])
    if (!Array.isArray(list) || list.length < 1 || list.length > 5) fail('INVALID_TEAM_SIZE');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) fail('INVALID_REQUEST');
  const built = [
    ...attackers.map((id, slot) => actorFor(map, id, 'attacker', slot)),
    ...defenders.map((id, slot) => actorFor(map, id, 'defender', slot)),
  ];
  const factionIds = [...new Set(built.map(b => b.actor.faction_id))].sort();
  if (factionIds.length > 6) fail('TOO_MANY_FACTIONS');
  const factions = factionIds.map(id => ({
    id,
    advantage_ids: map.get(id).data.advantage_ids.filter(other => factionIds.includes(other) && other !== id),
  }));
  const setup = {simulation_version: 2, seed, advantage_bp: ADVANTAGE_BP, factions, actors: built.map(b => b.actor)};
  return {setup, heroes: Object.fromEntries(built.map(b => [b.actor.id, b.hero_id]))};
}

/**
 * Runs a whole battle to its end on the server. Returns compact frames for a
 * replay, the first non-move events, per-actor totals and a SHA-256 of the full
 * ordered event log (determinism/replay check).
 */
export function runAutoBattle(setup, {frameEvery = 5, maxEvents = 500, heroes = {}} = {}) {
  let state = createAutoBattle(setup);
  const order = state.actors.map(a => a.id);
  const totals = new Map(order.map(id => [id, {damage_dealt: 0, healing_done: 0, damage_taken: 0}]));
  const frame = (s, atMs) => ({at_ms: atMs, actors: s.actors.map(a => [a.hp, a.x, a.y, a.energy])});
  const frames = [frame(state, 0)];
  const events = [];
  const hash = createHash('sha256');
  let eventCount = 0;
  let truncated = false;
  while (state.result === null) {
    const stepResult = stepAutoBattle(state);
    state = stepResult.state;
    for (const event of stepResult.events) {
      eventCount++;
      hash.update(JSON.stringify([stepResult.at_ms, event]) + '\n');
      if (event.kind === 'move') continue;
      const source = totals.get(event.source_id);
      const target = totals.get(event.target_id);
      if (event.kind === 'damage') {
        source.damage_dealt += event.amount;
        target.damage_taken += event.amount;
      } else source.healing_done += event.amount;
      if (events.length < maxEvents) events.push({at_ms: stepResult.at_ms, ...event});
      else truncated = true;
    }
    if (state.step % frameEvery === 0 || state.result !== null) frames.push(frame(state, stepResult.at_ms));
  }
  return {
    simulation_version: 2,
    seed: setup.seed,
    result: state.result,
    steps: state.step,
    duration_ms: state.step * STEP_MS,
    event_count: eventCount,
    event_log_sha256: hash.digest('hex'),
    actors: state.actors.map(a => ({
      actor_id: a.id,
      hero_id: heroes[a.id] ?? a.id,
      team: a.team,
      slot: a.slot,
      faction_id: a.faction_id,
      max_hp: a.max_hp,
      hp: a.hp,
      ...totals.get(a.id),
    })),
    frames,
    events,
    events_truncated: truncated,
  };
}
