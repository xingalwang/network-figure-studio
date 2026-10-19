import type { NodeEntity, ProjectDocument } from '../../core/document/types.ts';
export type StructureBranch = { entity: NodeEntity; children: StructureBranch[] };

/** A navigation spanning forest, never a change to the document's parent spaces. */
export function buildStructureForest(doc: ProjectDocument): StructureBranch[] {
  const nodes = Object.values(doc.entities).filter(
    (e): e is NodeEntity => e.kind === 'node' && !!e.semantic,
  );
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const edge of Object.values(doc.entities)) {
    if (
      edge.kind !== 'edge' ||
      edge.meaning !== 'dataflow' ||
      edge.source.kind !== 'port' ||
      edge.target.kind !== 'port'
    )
      continue;
    const from = edge.source.entityId,
      to = edge.target.entityId;
    if (!ids.has(from) || !ids.has(to)) continue;
    children.set(from, [...(children.get(from) ?? []), to]);
    incoming.add(to);
  }
  const visited = new Set<string>();
  const visit = (id: string): StructureBranch[] => {
    if (visited.has(id)) return [];
    visited.add(id);
    return [
      { entity: doc.entities[id] as NodeEntity, children: (children.get(id) ?? []).flatMap(visit) },
    ];
  };
  const roots = nodes.filter((n) => n.semantic?.role === 'tensor-source' || !incoming.has(n.id));
  return [...roots, ...nodes].flatMap((n) => visit(n.id));
}
