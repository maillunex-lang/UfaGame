import Ajv from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import {readFileSync} from 'node:fs';
const ajv = new Ajv({strict: true, allErrors: true, coerceTypes: false, removeAdditional: false});
formats(ajv);
export const registry = JSON.parse(readFileSync(new URL('./capabilities.json', import.meta.url)));
const names = ['content','battle_snapshot','battle_event','ledger_entry','error','guest_request','refresh_request','revoke_request','bind_request','login_request','recover_request','session','progress','bound_session','rotate_recovery_request','owner_login_request','owner_profile_request','owner_logout_request','owner_password_request','owner_audit_query','owner_profile','owner_session','owner_audit_page','studio_draft','draft_create_request','draft_save_request','mod_manifest','mod_operations','resource_descriptor','resource_upload_request','resource_update_request','battle_preview_request','battle_preview','mod_resource','import_preflight_request','import_apply_request','publish_preflight_request','publish_request','pointer_request','content_bundle','battle_start_request','battle_record','live_battle_command','live_battle_frame','live_battle_snapshot'];
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
export function resourceRefs(content) {
  const refs = [];
  for (const e of content.entities) {
    if (e.kind==='hero' && e.data.sprite_resource_id!==undefined) refs.push({entity_id:e.id,resource_id:e.data.sprite_resource_id,media_type:'image/png'});
    if (e.kind==='ability' && e.data.sound_resource_id!==undefined) refs.push({entity_id:e.id,resource_id:e.data.sound_resource_id,media_type:'audio/wav'});
    if (e.kind==='location' && e.data.art) refs.push({entity_id:e.id,resource_id:e.data.art.resource_id,media_type:'image/png'});
  }
  return refs;
}
