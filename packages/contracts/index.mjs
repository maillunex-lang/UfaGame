import Ajv from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import {readFileSync} from 'node:fs';
const ajv = new Ajv({strict: true, allErrors: true, coerceTypes: false, removeAdditional: false});
formats(ajv);
export const registry = JSON.parse(readFileSync(new URL('./capabilities.json', import.meta.url)));
const names = ['content','battle_snapshot','battle_event','ledger_entry','error','guest_request','refresh_request','revoke_request','bind_request','login_request','recover_request','session','progress','bound_session','rotate_recovery_request','owner_login_request','owner_profile_request','owner_logout_request','owner_password_request','owner_audit_query','owner_profile','owner_session','owner_audit_page','studio_draft','draft_create_request','draft_save_request','mod_manifest','mod_operations','resource_descriptor','resource_upload_request','resource_update_request','battle_preview_request','battle_preview','mod_resource','import_preflight_request','import_apply_request','publish_preflight_request','publish_request','pointer_request','content_bundle','battle_start_request','battle_record','live_battle_command','live_battle_frame','live_battle_snapshot','campaign','hero_level_request','hero_rank_request','hero_team_request','hero_protect_request','item_equip_request','item_upgrade_request','heroes','summon_request','summon_assemble_request','afk_claim_request','vip_claim_request','vip','summon','afk'];
export const schemas = Object.fromEntries(names.map(n => [n, JSON.parse(readFileSync(new URL(`./${n}.schema.json`,import.meta.url)))]));
for (const name of names) ajv.addSchema(schemas[name]);
const validators = Object.fromEntries(names.map(n => [n, ajv.getSchema(schemas[n].$id)]));
export function validate(name, value) {
  const validator = validators[name];
  if (!validator) throw new Error('Unknown schema');
  if (!validator(value)) return {ok:false, code:'INVALID_REQUEST'};
  if (name === 'content') {
    if (value.required_capabilities.some(c => !registry.capabilities.includes(c))) return {ok:false,code:'INCOMPATIBLE_CLIENT'};
    const combat = value.entities.some(e => (e.kind==='hero' && e.data.combat) || (e.kind==='ability' && e.data.energy_cost!==undefined));
    if (combat && !value.required_capabilities.includes('battle.combat.v1')) return {ok:false,code:'INVALID_REQUEST'};
    const abilitiesV2 = value.entities.some(e => (e.kind==='ability' && (['stun','knockback'].includes(e.data.effect) || e.data.target!==undefined)) || (e.kind==='faction' && e.data.advantage_bp!==undefined));
    if (abilitiesV2 && !value.required_capabilities.includes('battle.abilities.v2')) return {ok:false,code:'INVALID_REQUEST'};
    const resources = value.entities.some(e => (e.kind==='hero' && e.data.sprite_resource_id!==undefined) || (e.kind==='ability' && e.data.sound_resource_id!==undefined) || (e.kind==='location' && e.data.art!==undefined));
    if (resources && !value.required_capabilities.includes('content.resources.v1')) return {ok:false,code:'INVALID_REQUEST'};
    const triggers = value.entities.some(e => e.kind==='ability' && (e.data.trigger!==undefined || e.data.extra_effects!==undefined));
    if (triggers && !value.required_capabilities.includes('battle.triggers.v1')) return {ok:false,code:'INVALID_REQUEST'};
    for (const e of value.entities) if (e.kind==='ability' && e.data.trigger) {
      const needsPercent = e.data.trigger.kind==='self_hp_below' || e.data.trigger.kind==='ally_hp_below';
      if (needsPercent !== (e.data.trigger.percent!==undefined)) return {ok:false,code:'INVALID_REQUEST'};
    }
    const campaign = value.entities.some(e => e.kind==='chapter' || (e.kind==='stage' && (e.data.boss!==undefined || e.data.rewards_first!==undefined)));
    if (campaign && !value.required_capabilities.includes('campaign.chapters.v1')) return {ok:false,code:'INVALID_REQUEST'};
    if (campaignProblems(value).length) return {ok:false,code:'INVALID_REQUEST'};
    const progression = value.entities.some(e => e.kind==='progression' || (e.kind==='item' && (e.data.stats!==undefined || e.data.upgrade_max!==undefined || e.data.faction_ids!==undefined)) || (e.kind==='stage' && (e.data.enemy_level!==undefined || e.data.rewards_first_heroes!==undefined || e.data.rewards_first_items!==undefined || (e.data.rewards_first??[]).some(r => r.currency==='hero_exp' || r.currency==='rank_material'))));
    if (progression && !value.required_capabilities.includes('heroes.progression.v1')) return {ok:false,code:'INVALID_REQUEST'};
    if (progressionProblems(value).length) return {ok:false,code:'INVALID_REQUEST'};
    for (const [kind,cap] of [['vip','vip.v1'],['summon_pool','summon.v1'],['afk','afk.v1']])
      if (value.entities.some(e => e.kind===kind) && !value.required_capabilities.includes(cap)) return {ok:false,code:'INVALID_REQUEST'};
    if (economyProblems(value).length) return {ok:false,code:'INVALID_REQUEST'};
    const world = value.entities.some(e => e.kind==='location' || (e.kind==='stage' && e.data.location_id!==undefined));
    if (world && !value.required_capabilities.includes('world.locations.v1')) return {ok:false,code:'INVALID_REQUEST'};
    if (locationProblems(value).length) return {ok:false,code:'INVALID_REQUEST'};
    const ids = new Map(value.entities.map(e => [e.id,e.kind]));
    if (ids.size !== value.entities.length) return {ok:false,code:'INVALID_REQUEST'};
    for (const e of value.entities) {
      if (e.kind==='hero' && (ids.get(e.data.faction_id)!=='faction' || e.data.ability_ids.some(x=>ids.get(x)!=='ability'))) return {ok:false,code:'INVALID_REQUEST'};
      if (e.kind==='faction' && e.data.advantage_ids.some(x=>ids.get(x)!=='faction')) return {ok:false,code:'INVALID_REQUEST'};
      if (e.kind==='stage' && e.data.enemy_hero_ids.some(x=>ids.get(x)!=='hero')) return {ok:false,code:'INVALID_REQUEST'};
    }
  }
  return {ok:true};
}
export function negotiate(required, supported=registry.capabilities, apiVersion=1) {
  return apiVersion===registry.api_version && Array.isArray(required) && required.every(c=>supported.includes(c));
}
/** Resource ids referenced by content, with the media type each reference requires. */
/** Republic extents (encyclopedic, rounded outward): not a border polygon. */
export const BASHKORTOSTAN_BOUNDS = Object.freeze({min_lat_e6:51500000,max_lat_e6:56600000,min_lon_e6:53100000,max_lon_e6:60050000});
const PARENT_LEVELS = {republic:[], district:['republic'], city:['republic'], point:['district','city']};
const kmBetween = (a,b) => {const r=d=>d*Math.PI/1.8e8,dLat=r(b.lat_e6-a.lat_e6),dLon=r(b.lon_e6-a.lon_e6);const h=Math.sin(dLat/2)**2+Math.cos(r(a.lat_e6))*Math.cos(r(b.lat_e6))*Math.sin(dLon/2)**2;return 2*6371*Math.asin(Math.sqrt(h));};
/**
 * Geography rules (S21): hierarchy republic → district/city → point, one republic,
 * coordinates inside the republic extents, a point within 150 km of its parent,
 * stages linked only to points. Returns [{code, entity_id}] (empty when fine).
 */
export function locationProblems(content) {
  const byId = new Map(content.entities.map(e => [e.id,e]));
  const out = [];
  const locations = content.entities.filter(e => e.kind==='location');
  if (locations.filter(e => e.data.level==='republic').length > 1) out.push({code:'LOCATION_REPUBLIC_DUPLICATE',entity_id:null});
  for (const e of locations) {
    const {level,parent_id,lat_e6,lon_e6} = e.data;
    if (level==='republic') { if (parent_id!==undefined) out.push({code:'LOCATION_PARENT_INVALID',entity_id:e.id}); continue; }
    const parent = byId.get(parent_id);
    if (!parent || parent.kind!=='location' || !PARENT_LEVELS[level].includes(parent.data.level)) { out.push({code:'LOCATION_PARENT_INVALID',entity_id:e.id}); continue; }
    const b = BASHKORTOSTAN_BOUNDS;
    if (lat_e6<b.min_lat_e6 || lat_e6>b.max_lat_e6 || lon_e6<b.min_lon_e6 || lon_e6>b.max_lon_e6) out.push({code:'LOCATION_OUTSIDE_REPUBLIC',entity_id:e.id});
    else if (level==='point' && kmBetween(e.data,parent.data)>150) out.push({code:'LOCATION_TOO_FAR',entity_id:e.id});
  }
  for (const e of content.entities) if (e.kind==='stage' && e.data.location_id!==undefined) {
    const target = byId.get(e.data.location_id);
    if (!target || target.kind!=='location' || target.data.level!=='point') out.push({code:'STAGE_LOCATION_INVALID',entity_id:e.id});
  }
  return out;
}
/**
 * Campaign rules (S22): chapter stages exist and are stages, a stage belongs to at
 * most one chapter, chapter order numbers are unique, a chapter map area is a
 * district or city, one reward line per currency.
 */
export function campaignProblems(content) {
  const byId = new Map(content.entities.map(e => [e.id,e]));
  const out = [], owner = new Map(), orders = new Set();
  for (const ch of content.entities.filter(e => e.kind==='chapter')) {
    if (orders.has(ch.data.order)) out.push({code:'CHAPTER_ORDER_DUPLICATE',entity_id:ch.id}); orders.add(ch.data.order);
    for (const id of ch.data.stage_ids) {
      if (byId.get(id)?.kind!=='stage') out.push({code:'CHAPTER_STAGE_INVALID',entity_id:ch.id});
      else if (owner.has(id)) out.push({code:'STAGE_IN_TWO_CHAPTERS',entity_id:id});
      owner.set(id,ch.id);
    }
    if (ch.data.location_id!==undefined) { const loc=byId.get(ch.data.location_id); if (loc?.kind!=='location' || !['district','city'].includes(loc.data.level)) out.push({code:'CHAPTER_LOCATION_INVALID',entity_id:ch.id}); }
  }
  for (const st of content.entities.filter(e => e.kind==='stage' && e.data.rewards_first))
    if (new Set(st.data.rewards_first.map(r => r.currency)).size !== st.data.rewards_first.length) out.push({code:'REWARD_DUPLICATE_CURRENCY',entity_id:st.id});
  return out;
}
/**
 * Hero progression rules (S23/S24/S28): at most one progression table; the first
 * rank needs no copies; level caps do not decrease by rank; starter and reward
 * heroes are combat heroes; starter/reward items are equippable items; an item with
 * stats has a real slot and its faction limits name factions.
 */
export function progressionProblems(content) {
  const byId = new Map(content.entities.map(e => [e.id,e]));
  const out = [];
  const tables = content.entities.filter(e => e.kind==='progression');
  if (tables.length > 1) out.push({code:'PROGRESSION_DUPLICATE',entity_id:tables[1].id});
  const combatHero = id => byId.get(id)?.kind==='hero' && byId.get(id).data.combat!==undefined;
  const gear = id => byId.get(id)?.kind==='item' && byId.get(id).data.slot!=='none' && byId.get(id).data.stats!==undefined;
  for (const t of tables) {
    const r = t.data.ranks;
    if (r[0].copies !== 0) out.push({code:'RANK_FIRST_COPIES',entity_id:t.id});
    for (let i = 1; i < r.length; i++) if (r[i].max_level < r[i-1].max_level) out.push({code:'RANK_LEVEL_DECREASES',entity_id:t.id});
    if ((t.data.starter_hero_ids??[]).some(id => !combatHero(id))) out.push({code:'STARTER_HERO_INVALID',entity_id:t.id});
    if ((t.data.starter_item_ids??[]).some(id => !gear(id))) out.push({code:'STARTER_ITEM_INVALID',entity_id:t.id});
  }
  for (const e of content.entities) {
    if (e.kind==='item' && e.data.stats!==undefined && e.data.slot==='none') out.push({code:'ITEM_SLOT_REQUIRED',entity_id:e.id});
    if (e.kind==='item' && (e.data.faction_ids??[]).some(id => byId.get(id)?.kind!=='faction')) out.push({code:'ITEM_FACTION_INVALID',entity_id:e.id});
    if (e.kind==='stage' && (e.data.rewards_first_heroes??[]).some(id => !combatHero(id))) out.push({code:'REWARD_HERO_INVALID',entity_id:e.id});
    if (e.kind==='stage' && (e.data.rewards_first_items??[]).some(id => !gear(id))) out.push({code:'REWARD_ITEM_INVALID',entity_id:e.id});
  }
  return out;
}
/**
 * Economy rules (S25/S27/S29): one VIP and one AFK table; VIP thresholds strictly
 * increase and the tutorial reaches VIP 1; summon entries/guarantee name combat
 * heroes, guarantee heroes are in the pool, shard entries need shards_per_hero.
 */
export function economyProblems(content) {
  const byId = new Map(content.entities.map(e => [e.id,e]));
  const out = [];
  for (const kind of ['vip','afk']) { const t = content.entities.filter(e => e.kind===kind); if (t.length > 1) out.push({code:kind.toUpperCase()+'_DUPLICATE',entity_id:t[1].id}); }
  for (const v of content.entities.filter(e => e.kind==='vip')) {
    const l = v.data.levels;
    for (let i = 1; i < l.length; i++) if (l[i].points <= l[i-1].points) out.push({code:'VIP_POINTS_NOT_INCREASING',entity_id:v.id});
    if (v.data.tutorial_points > 0 && v.data.tutorial_points < l[0].points) out.push({code:'VIP_TUTORIAL_BELOW_LEVEL_1',entity_id:v.id});
    if (v.data.daily_points === 0 && !(v.data.win_points > 0 && v.data.win_points_daily_cap > 0)) out.push({code:'VIP_NO_FREE_SOURCE',entity_id:v.id});
  }
  const combatHero = id => byId.get(id)?.kind==='hero' && byId.get(id).data.combat!==undefined;
  for (const p of content.entities.filter(e => e.kind==='summon_pool')) {
    const ids = p.data.entries.map(x => x.hero_id);
    if (ids.some(id => !combatHero(id))) out.push({code:'SUMMON_HERO_INVALID',entity_id:p.id});
    if (new Set(p.data.entries.map(x => x.hero_id+':'+(x.shards??0))).size !== ids.length) out.push({code:'SUMMON_ENTRY_DUPLICATE',entity_id:p.id});
    if (p.data.entries.some(x => x.shards!==undefined) && p.data.shards_per_hero===undefined) out.push({code:'SUMMON_SHARDS_RECIPE_MISSING',entity_id:p.id});
    if (p.data.guarantee && p.data.guarantee.hero_ids.some(id => !p.data.entries.some(x => x.hero_id===id && x.shards===undefined))) out.push({code:'SUMMON_GUARANTEE_NOT_IN_POOL',entity_id:p.id});
  }
  return out;
}
/** Linear campaign order: chapters by `order`, stages as listed. */
export function campaignStages(content) {
  return content.entities.filter(e => e.kind==='chapter').sort((a,b) => a.data.order-b.data.order).flatMap(ch => ch.data.stage_ids.map(id => ({chapter_id:ch.id,stage_id:id})));
}
export function resourceRefs(content) {
  const refs = [];
  for (const e of content.entities) {
    if (e.kind==='hero' && e.data.sprite_resource_id!==undefined) refs.push({entity_id:e.id,resource_id:e.data.sprite_resource_id,media_type:'image/png'});
    if (e.kind==='ability' && e.data.sound_resource_id!==undefined) refs.push({entity_id:e.id,resource_id:e.data.sound_resource_id,media_type:'audio/wav'});
    if (e.kind==='location' && e.data.art) refs.push({entity_id:e.id,resource_id:e.data.art.resource_id,media_type:'image/png'});
  }
  return refs;
}
