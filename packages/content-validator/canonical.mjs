import {createHash} from 'node:crypto';
/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}
/** SHA-256 of the canonical JSON; used as expected_sha256 for replace/delete (ADR 0013). */
export const entitySha256 = entity => createHash('sha256').update(canonicalJson(entity)).digest('hex');
