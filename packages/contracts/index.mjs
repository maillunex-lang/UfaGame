import Ajv from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import {readFileSync} from 'node:fs';
const ajv = new Ajv({strict: true, allErrors: true, coerceTypes: false, removeAdditional: false});
formats(ajv);
export const registry = JSON.parse(readFileSync(new URL('./capabilities.json', import.meta.url)));
const names = ['content','battle_snapshot','battle_event','ledger_entry','error','guest_request','refresh_request','revoke_request','bind_request','login_request','recover_request','session','progress','bound_session','rotate_recovery_request','owner_login_request','owner_profile_request','owner_logout_request','owner_password_request','owner_audit_query','owner_profile','owner_session','owner_audit_page','studio_draft','draft_create_request','draft_save_request','mod_manifest','mod_operations','resource_descriptor','resource_upload_request','resource_update_request','battle_preview_request','battle_preview','mod_resource','import_preflight_request','import_apply_request'];
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
    const resources = value.entities.some(e => (e.kind==='hero' && e.data.sprite_resource_id!==undefined) || (e.kind==='ability' && e.data.sound_resource_id!==undefined));
    if (resources && !value.required_capabilities.includes('content.resources.v1')) return {ok:false,code:'INVALID_REQUEST'};
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
export function resourceRefs(content) {
  const refs = [];
  for (const e of content.entities) {
    if (e.kind==='hero' && e.data.sprite_resource_id!==undefined) refs.push({entity_id:e.id,resource_id:e.data.sprite_resource_id,media_type:'image/png'});
    if (e.kind==='ability' && e.data.sound_resource_id!==undefined) refs.push({entity_id:e.id,resource_id:e.data.sound_resource_id,media_type:'audio/wav'});
  }
  return refs;
}
