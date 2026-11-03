export type EditableEntity={id:string;kind:'hero'|'ability'|'faction';name:string;data:Record<string,any>};
export function listEntities(text:string):EditableEntity[];
export function upsertEntity(text:string,entity:EditableEntity,originalId?:string|null):string;
export function deleteEntity(text:string,id:string):string;
