import type { ProjectDocument } from '../core/document/types.ts';
import { isFigureEntity, isStructureEntity } from '../core/figure/index.ts';

export function workspaceSelection(
  doc: ProjectDocument,
  ids: readonly string[],
  workspace: 'drawing' | 'generator',
): string[] {
  if (doc.schemaVersion !== 3) return [...ids];
  return [
    ...new Set(
      ids.flatMap((id) => {
        const entity = doc.entities[id];
        if (!entity) return [];
        if (workspace === 'generator') {
          const sourceId = entity.figure?.semanticRef;
          return sourceId && doc.entities[sourceId]
            ? [sourceId]
            : isStructureEntity(doc, entity)
              ? [id]
              : [];
        }
        if (isFigureEntity(doc, entity))
          return entity.figureState === 'hidden' || entity.figureState === 'unplaced' ? [] : [id];
        const drawing = Object.values(doc.entities).find(
          (candidate) =>
            candidate.figure?.role === 'representation' &&
            candidate.figure.semanticRef === id &&
            candidate.figureState !== 'hidden' &&
            candidate.figureState !== 'unplaced',
        );
        return drawing ? [drawing.id] : [];
      }),
    ),
  ];
}

/** Choose a selection from the workspace that will actually project it. */
export function initialProjectView(doc: ProjectDocument): {
  workspace: 'drawing' | 'generator';
  selection: string[];
} {
  const visible = Object.values(doc.entities).filter((entity) => {
    if (entity.kind === 'edge') return false;
    let current = entity;
    const visited = new Set<string>();
    while (!visited.has(current.id)) {
      visited.add(current.id);
      if (current.figureState === 'hidden' || current.figureState === 'unplaced') return false;
      if (!current.parentId) break;
      const parent = doc.entities[current.parentId];
      if (!parent || parent.kind === 'edge') return false;
      current = parent;
    }
    return isFigureEntity(doc, entity);
  });
  const workspace = visible.length ? 'drawing' : 'generator';
  const candidates =
    workspace === 'drawing'
      ? visible
      : Object.values(doc.entities).filter(
          (entity) => entity.kind !== 'edge' && isStructureEntity(doc, entity),
        );
  const first = candidates.find((entity) => entity.parentId === null) ?? candidates[0];
  return { workspace, selection: first ? [first.id] : [] };
}
