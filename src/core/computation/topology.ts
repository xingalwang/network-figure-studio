import type { Entity, ProjectDocument } from '../document/types.ts';
export function inbound(doc: ProjectDocument, id: string) {
  return Object.values(doc.entities)
    .filter(
      (e) =>
        e.kind === 'edge' &&
        e.meaning === 'dataflow' &&
        e.target.kind === 'port' &&
        e.target.entityId === id,
    )
    .map((e) => {
      if (e.kind !== 'edge' || e.source.kind !== 'port' || e.target.kind !== 'port') return null;
      return {
        entityId: e.source.entityId,
        portId: e.target.portId,
        sourcePortId: e.source.portId,
      };
    })
    .filter((e) => e !== null);
}
export const isOperation = (entity: Entity | undefined) =>
  entity?.kind === 'node' && entity.semantic?.role === 'operation';
export const isTensor = (entity: Entity | undefined) =>
  entity?.kind === 'node' &&
  ['tensor-source', 'tensor-result'].includes(entity.semantic?.role ?? '');
export function producerOf(doc: ProjectDocument, tensorId: string): string | null {
  const all = inbound(doc, tensorId).filter((input) => isOperation(doc.entities[input.entityId]));
  return all.length === 1 ? all[0].entityId : null;
}
