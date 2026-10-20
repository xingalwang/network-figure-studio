import {
  fail,
  ok,
  type AnnotationContent,
  type Entity,
  type GroupEntity,
  type NodeEntity,
  type Point,
  type ProjectDocument,
  type ResolvedOperation,
  type Result,
} from '../document/types.ts';

export function semanticTarget(doc: ProjectDocument, id: string): NodeEntity | undefined {
  const entity = doc.entities[id];
  if (entity?.kind === 'node' && entity.semantic) return entity;
  const source = entity?.figure?.semanticRef && doc.entities[entity.figure.semanticRef];
  return source && source.kind === 'node' && source.semantic ? source : undefined;
}
export function isFigureEntity(doc: ProjectDocument, entity: Entity): boolean {
  return (
    doc.schemaVersion !== 3 ||
    (!(entity.kind === 'node' && entity.semantic) &&
      !(entity.kind === 'edge' && entity.meaning === 'dataflow') &&
      !(entity.kind === 'group' && entity.groupRole === 'module'))
  );
}
export function isStructureEntity(doc: ProjectDocument, entity: Entity): boolean {
  return (
    doc.schemaVersion !== 3 ||
    (!entity.figure && !(entity.kind === 'group' && entity.groupRole === 'drawing'))
  );
}
export type FigureAddition = { id: string; operations: ResolvedOperation[] };

export function representationOf(source: NodeEntity, id: string, position?: Point): NodeEntity {
  const copy = structuredClone(source);
  delete copy.semantic;
  delete copy.generation;
  delete copy.annotation;
  copy.id = id;
  copy.figure = { role: 'representation', semanticRef: source.id };
  const params = source.generation?.source;
  if (source.semantic?.role !== 'operation' && params?.kind === 'local') {
    const { depth, angleDeg } = params.params;
    if (
      typeof depth === 'number' &&
      Number.isFinite(depth) &&
      depth >= 0 &&
      depth <= 200 &&
      typeof angleDeg === 'number' &&
      Number.isFinite(angleDeg) &&
      angleDeg >= 0 &&
      angleDeg <= 80
    )
      copy.figure.tensorProjection = { depth, angleDeg };
  }
  copy.figureState = source.figureState === 'hidden' ? 'hidden' : 'visible';
  copy.presentation.position = { ...(position ?? source.presentation.position) };
  delete copy.presentation.compositionPosition;
  return copy;
}

export function planAddFigureRepresentation(
  doc: ProjectDocument,
  sourceId: string,
  position?: Point,
): Result<FigureAddition> {
  if (doc.schemaVersion !== 3) return fail('SCHEMA_UPGRADE_REQUIRED', '请先创建新版图稿副本。');
  const source = semanticTarget(doc, sourceId);
  if (!source) return fail('NOT_COMPUTATION', '请选择一个计算张量或运算。');
  const id = crypto.randomUUID(),
    entity = representationOf(source, id, position ?? source.presentation.compositionPosition);
  entity.parentId = null;
  entity.figureState = 'visible';
  return ok({ id, operations: [{ kind: 'put', entity }] });
}

export function planAddFigureAnnotation(
  doc: ProjectDocument,
  text: string,
  position: Point = { x: 80, y: 80 },
): Result<FigureAddition> {
  if (doc.schemaVersion !== 3) return fail('SCHEMA_UPGRADE_REQUIRED', '请先创建新版图稿副本。');
  const id = crypto.randomUUID(),
    entity: NodeEntity = {
      id,
      kind: 'node',
      parentId: null,
      name: '文本标注',
      figure: { role: 'annotation' },
      annotation: { kind: 'manual', text },
      size: { width: 180, height: 28 },
      bounds: { x: 0, y: 0, width: 180, height: 28 },
      ports: {},
      primitives: [],
      presentation: { position: { ...position } },
    };
  return ok({ id, operations: [{ kind: 'put', entity }] });
}

export function planUpdateFigureAnnotation(
  doc: ProjectDocument,
  id: string,
  content: AnnotationContent,
): Result<ResolvedOperation[]> {
  const entity = doc.entities[id];
  if (entity?.kind !== 'node' || entity.figure?.role !== 'annotation')
    return fail('NOT_ANNOTATION', '请选择独立文本标注。');
  if (entity.locked) return fail('LOCKED', '标注已锁定。', [id]);
  return ok([{ kind: 'put', entity: { ...entity, annotation: structuredClone(content) } }]);
}

/** Summary/detail are drawing relations; they never introduce a computation dependency. */
export function planSetFigureView(
  doc: ProjectDocument,
  id: string,
  view: 'summary' | 'detail',
  relatedFigureId?: string,
): Result<ResolvedOperation[]> {
  if (doc.schemaVersion !== 3) return fail('SCHEMA_UPGRADE_REQUIRED', '请先创建新版图稿副本。');
  const entity = doc.entities[id];
  if (entity?.figure?.role !== 'representation')
    return fail('NOT_REPRESENTATION', '请选择一个计算对象的图稿表示。');
  if (entity.locked) return fail('LOCKED', '图稿对象已锁定。', [id]);
  if (!['summary', 'detail'].includes(view))
    return fail('INVALID_FIGURE_VIEW', '图稿视图必须为概括或详图。');
  if (relatedFigureId !== undefined) {
    const related = doc.entities[relatedFigureId];
    if (
      related?.figure?.role !== 'representation' ||
      related.figure.semanticRef !== entity.figure.semanticRef
    )
      return fail('INVALID_FIGURE_VIEW', '概括与详图必须表示同一个计算对象。');
    const seen = new Set([id]);
    let current: Entity | undefined = related;
    while (current) {
      if (seen.has(current.id)) return fail('INVALID_FIGURE_VIEW', '概括与详图不能形成循环引用。');
      seen.add(current.id);
      current = current.figure?.relatedFigureId
        ? doc.entities[current.figure.relatedFigureId]
        : undefined;
    }
  }
  const figure = { ...entity.figure, view };
  if (relatedFigureId === undefined) delete figure.relatedFigureId;
  else figure.relatedFigureId = relatedFigureId;
  return ok([{ kind: 'put', entity: { ...entity, figure } }]);
}

/** A drawing group owns only presentation coordinates, never computation topology. */
export function planGroupFigure(
  doc: ProjectDocument,
  ids: readonly string[],
  name = '图稿组',
): Result<FigureAddition> {
  if (doc.schemaVersion !== 3) return fail('SCHEMA_UPGRADE_REQUIRED', '请先创建新版图稿副本。');
  const members = [...new Set(ids)].map((id) => doc.entities[id]);
  if (
    !members.length ||
    members.some((entity) => !entity || entity.kind === 'edge' || !isFigureEntity(doc, entity))
  )
    return fail('INVALID_FIGURE_GROUP', '请选择要成组的图稿节点。');
  const selected = new Set(members.map((entity) => entity.id));
  for (const entity of Object.values(doc.entities)) {
    if (isFigureEntity(doc, entity)) continue;
    let parentId = entity.parentId;
    while (parentId) {
      if (selected.has(parentId))
        return fail('INVALID_FIGURE_GROUP', '计算模块与绘图成组独立，不能将计算结构放入图稿组。');
      parentId = doc.entities[parentId].parentId;
    }
  }
  const parentId = members[0].parentId;
  if (members.some((entity) => entity.parentId !== parentId || entity.locked))
    return fail('INVALID_FIGURE_GROUP', '图稿成组需要同一坐标空间中未锁定的节点。');
  const nodes = members as (NodeEntity | GroupEntity)[],
    x = Math.min(...nodes.map((node) => node.presentation.position.x)),
    y = Math.min(...nodes.map((node) => node.presentation.position.y)),
    right = Math.max(...nodes.map((node) => node.presentation.position.x + node.size.width)),
    bottom = Math.max(...nodes.map((node) => node.presentation.position.y + node.size.height)),
    id = crypto.randomUUID(),
    group: GroupEntity = {
      id,
      kind: 'group',
      groupRole: 'drawing',
      figure: { role: 'decoration' },
      parentId,
      name,
      size: { width: Math.max(1, right - x), height: Math.max(1, bottom - y) },
      ports: {},
      presentation: { position: { x, y } },
    };
  return ok({
    id,
    operations: [
      { kind: 'put', entity: group },
      ...nodes.map(
        (node): ResolvedOperation => ({
          kind: 'put',
          entity: {
            ...node,
            parentId: id,
            presentation: {
              ...node.presentation,
              position: {
                x: node.presentation.position.x - x,
                y: node.presentation.position.y - y,
              },
            },
          },
        }),
      ),
    ],
  });
}
