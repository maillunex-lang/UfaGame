import Ajv from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import {readFileSync} from 'node:fs';
const ajv = new Ajv({strict: true, allErrors: true, coerceTypes: false, removeAdditional: false});
formats(ajv);
export const registry = JSON.parse(readFileSync(new URL('./capabilities.json', import.meta.url)));
const names = ['content','battle_snapshot','battle_event','ledger_entry','error','guest_request','refresh_request','revoke_request','bind_request','login_request','recover_request','session','progress','bound_session','rotate_recovery_request','owner_login_request','owner_profile_request','owner_logout_request','owner_password_request','owner_audit_query','owner_profile','owner_session','owner_audit_page','studio_draft','draft_create_request','draft_save_request','mod_manifest','mod_operations'];
export const schemas = Object.fromEntries(names.map(n => [n, JSON.parse(readFileSync(new URL(`./${n}.schema.json`,import.meta.url)))]));
for (const name of names) ajv.addSchema(schemas[name]);
const validators = Object.fromEntries(names.map(n => [n, ajv.getSchema(schemas[n].$id)]));
export function validate(name, value) {
  const validator = validators[name];
  if (!validator) throw new Error('Unknown schema');
  if (!validator(value)) return {ok:false, code:'INVALID_REQUEST'};
  if (name === 'content') {
    if (value.required_capabilities.some(c => !registry.capabilities.includes(c))) return {ok:false,code:'INCOMPATIBLE_CLIENT'};
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
