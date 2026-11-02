import {validate,negotiate} from '@ufagame/contracts';
/** Prepare a create-only JSON import; does not write to a draft or publish content. */
export function planCreateImport(inspection,draft,expectedRevision) {
 if(!draft||!Number.isSafeInteger(draft.revision)||draft.revision<0||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!validate('content',draft.content).ok)throw new Error('INVALID_DRAFT');
 if(draft.revision!==expectedRevision)throw new Error('STALE_DRAFT');
 const {manifest,operations,entities}=inspection??{};
 if(!validate('mod_manifest',manifest).ok||!validate('mod_operations',operations).ok||!negotiate(manifest.required_capabilities)||!Array.isArray(entities)||manifest.dependencies.length)throw new Error('INVALID_PACKAGE');
 if(manifest.base_content_version!==draft.content.content_version)throw new Error('STALE_BASE');
 if(operations.some(op=>op.op!=='create')||entities.length!==operations.length)throw new Error('UNSUPPORTED_OPERATION');
 const ids=new Set(draft.content.entities.map(item=>item.id)),created=[];
 for(let i=0;i<operations.length;i++){
  const op=operations[i],entity=entities[i];
  if(!entity||entity.id!==op.id||entity.kind!==op.entity_type)throw new Error('INVALID_ENTITY');
  if(ids.has(op.id))throw new Error('ENTITY_CONFLICT');ids.add(op.id);created.push(structuredClone(entity));
 }
 const next=structuredClone(draft.content);
 next.entities.push(...created);
 next.required_capabilities=[...new Set([...next.required_capabilities,...manifest.required_capabilities])].sort();
 if(!validate('content',next).ok)throw new Error('INVALID_RESULT');
 return {expected_revision:expectedRevision,content:next,created_ids:created.map(item=>item.id)};
}
