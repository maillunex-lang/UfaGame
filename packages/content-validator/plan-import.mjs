import {createHash} from 'node:crypto';
import {validate,negotiate,resourceRefs} from '@ufagame/contracts';
import {entitySha256} from './canonical.mjs';
import {PackageError} from './archive.mjs';
import {ResourceRegistry} from './resource-registry.mjs';

const MAX_DIFF = 50;
const reject = (code, file, field) => {
  throw new PackageError(code, file ?? null, field ?? null);
};
/** Leaf-level differences between two JSON values (paths like data.power). */
export function fieldDiff(before, after, path = '', out = []) {
  if (out.length >= MAX_DIFF) return out;
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort())
      fieldDiff(before[key], after[key], path ? `${path}.${key}` : key, out);
  } else if (JSON.stringify(before) !== JSON.stringify(after)) out.push({path: path || '.', before: before ?? null, after: after ?? null});
  return out;
}
function refErrors(content) {
  const kinds = new Map(content.entities.map(e => [e.id, e.kind]));
  const need = (entity, ids, kind) => ids.filter(id => kinds.get(id) !== kind).map(id => ({entity_id: entity.id, ref: id}));
  return content.entities.flatMap(e =>
    e.kind === 'hero' ? [...need(e, [e.data.faction_id], 'faction'), ...need(e, e.data.ability_ids, 'ability')]
      : e.kind === 'faction' ? need(e, e.data.advantage_ids, 'faction')
        : e.kind === 'stage' ? need(e, e.data.enemy_hero_ids, 'hero') : []);
}

/**
 * Builds an import plan without writing anything. `resolutions` maps a conflict
 * key (`entity:<id>`, `resource:<id>`, `base`) to 'package' or 'draft'.
 * Returns {report, content|null, resources}; content is null while conflicts remain.
 */
export async function planImport(inspection, draft, {expectedRevision = -1, existingResources = new Map(), resolutions = {}} = {}) {
  if (!draft || !Number.isSafeInteger(draft.revision) || !validate('content', draft.content).ok) reject('DRAFT_INVALID');
  if (draft.revision !== expectedRevision) reject('STALE_DRAFT', null, 'expected_revision');
  const {manifest, operations, entities, resources: packaged = []} = inspection ?? {};
  if (!validate('mod_manifest', manifest).ok || !validate('mod_operations', operations).ok || !negotiate(manifest.required_capabilities)) reject('PACKAGE_INVALID');
  for (const [key, value] of Object.entries(resolutions))
    if (!/^(base|entity:[a-z][a-z0-9_]{2,79}|resource:[a-z][a-z0-9_]{2,79})$/.test(key) || !['package', 'draft'].includes(value)) reject('RESOLUTION_INVALID', null, key);
  const items = [];
  let unresolved = 0;
  const conflict = (item, code) => {
    const choice = resolutions[item.key];
    Object.assign(item, {status: 'conflict', conflict: code, resolution: choice ?? null});
    if (!choice) unresolved++;
    return choice;
  };
  const base = {key: 'base', op: 'base', base_content_version: manifest.base_content_version, draft_content_version: draft.content.content_version};
  if (manifest.base_content_version !== draft.content.content_version) {
    const choice = conflict(base, 'BASE_MISMATCH');
    if (choice === 'draft') reject('IMPORT_CANCELLED_BASE');
    items.push(base);
  }

  // Resources: immutable bytes, identified by id; new ones are decoded in the isolated worker.
  const created = [];
  const registry = new ResourceRegistry();
  for (const {meta, bytes} of packaged) {
    const item = {key: `resource:${meta.id}`, op: 'create', entity_type: 'resource', id: meta.id};
    const sha = createHash('sha256').update(bytes).digest('hex');
    const existing = existingResources.get(meta.id);
    if (existing) {
      if (existing.sha256 === sha) item.status = 'unchanged';
      else if (conflict(item, 'RESOURCE_EXISTS') === 'package') reject('RESOURCE_IMMUTABLE', meta.file, meta.id);
    } else {
      try {
        const descriptor = await registry.addResource({id: meta.id, bytes, license: meta.license, scale_bp: meta.scale_bp ?? 10000, anchor: meta.anchor, frames: meta.frames, loop: meta.loop});
        created.push({descriptor, bytes});
        item.status = 'create';
        item.media_type = descriptor.media_type;
      } catch (error) {
        if (error.message === 'RESOURCE_BUSY') throw error;
        reject('RESOURCE_INVALID', meta.file, error.message);
      }
    }
    items.push(item);
  }

  const next = structuredClone(draft.content);
  const index = () => new Map(next.entities.map((e, i) => [e.id, i]));
  operations.forEach((op, i) => {
    if (op.entity_type === 'resource') return;
    const item = {key: `entity:${op.id}`, op: op.op, entity_type: op.entity_type, id: op.id};
    const at = index().get(op.id);
    const current = at === undefined ? null : next.entities[at];
    const incoming = entities[i];
    if (current && current.kind !== op.entity_type) reject('KIND_CONFLICT', op.source ?? 'operations.json', op.id);
    const write = () => {
      if (current) {
        item.diff = fieldDiff(current, incoming);
        next.entities[at] = structuredClone(incoming);
      } else next.entities.push(structuredClone(incoming));
    };
    if (op.op === 'create') {
      if (!current) {
        item.status = 'create';
        write();
      } else if (entitySha256(current) === entitySha256(incoming)) item.status = 'unchanged';
      else if (conflict(item, 'ENTITY_EXISTS') === 'package') {
        item.diff = fieldDiff(current, incoming);
        write();
      } else item.diff = fieldDiff(current, incoming);
    } else if (op.op === 'replace') {
      if (!current) {
        if (conflict(item, 'ENTITY_MISSING') === 'package') write();
      } else if (entitySha256(current) === entitySha256(incoming)) item.status = 'unchanged';
      else if (entitySha256(current) === op.expected_sha256) {
        item.status = 'replace';
        write();
      } else if (conflict(item, 'ENTITY_STALE') === 'package') write();
      else item.diff = fieldDiff(current, incoming);
    } else {
      if (!current) item.status = 'unchanged';
      else if (entitySha256(current) === op.expected_sha256 || conflict(item, 'ENTITY_STALE') === 'package') {
        if (!item.status) item.status = 'delete';
        next.entities.splice(at, 1);
      }
    }
    items.push(item);
  });
  const report = {
    base_content_version: manifest.base_content_version,
    draft_content_version: draft.content.content_version,
    package_id: manifest.package_id,
    package_version: manifest.package_version,
    items,
    unresolved,
  };
  if (unresolved) return {report, content: null, resources: []};
  next.required_capabilities = [...new Set([...next.required_capabilities, ...manifest.required_capabilities])].sort();
  const broken = refErrors(next);
  if (broken.length) reject('REFERENCE_MISSING', `entity:${broken[0].entity_id}`, broken[0].ref);
  const known = new Map([...existingResources].map(([id, r]) => [id, r.media_type]));
  for (const {descriptor} of created) known.set(descriptor.id, descriptor.media_type);
  const badRef = resourceRefs(next).find(r => known.get(r.resource_id) !== r.media_type);
  if (badRef) reject('RESOURCE_REF_INVALID', `entity:${badRef.entity_id}`, badRef.resource_id);
  if (!validate('content', next).ok) reject('RESULT_INVALID', 'content');
  return {report, content: next, resources: created};
}

/** Backwards-compatible create-only helper used by earlier tests. */
export async function planCreateImport(inspection, draft, expectedRevision) {
  if (inspection?.operations?.some(op => op.op !== 'create')) reject('UNSUPPORTED_OPERATION');
  const plan = await planImport(inspection, draft, {expectedRevision});
  if (!plan.content) reject(plan.report.items.find(i => i.status === 'conflict')?.conflict ?? 'CONFLICT');
  return {expected_revision: expectedRevision, content: plan.content, created_ids: plan.report.items.filter(i => i.status === 'create').map(i => i.id)};
}
