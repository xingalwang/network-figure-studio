import type { PluginRegistry } from '../plugins/registry.ts';
import { createGenerationServices } from './generation/merge.ts';
import { planRemoveSelection } from './composition.ts';
import { tensorKind, tensorDimension, type TensorKind } from './computation/index.ts';
import {
  fail,
  ok,
  type DocumentStore,
  type EdgeEntity,
  type NodeEntity,
  type Params,
  type Point,
  type ProjectDocument,
  type ResolvedOperation,
  type Result,
} from './document/types.ts';

function nextPosition(doc: ProjectDocument): Point {
  const nodes = Object.values(doc.entities).filter((e) => e.kind === 'node' && e.semantic);
  for (let row = 0; ; row++)
    for (let col = 0; col < 3; col++) {
      const position = { x: 60 + col * 260, y: 120 + row * 220 };
      if (
        nodes.every(
          (n) =>
            (n.kind === 'node' &&
              Math.abs(
                (n.presentation.compositionPosition ?? n.presentation.position).x - position.x,
              ) > 160) ||
            (n.kind === 'node' &&
              Math.abs(
                (n.presentation.compositionPosition ?? n.presentation.position).y - position.y,
              ) > 150),
        )
      )
        return position;
    }
}
async function prepareNode(
  doc: ProjectDocument,
  registry: PluginRegistry,
  id: string,
  generatorId: string,
  params: Params,
  position: Point,
): Promise<Result<ResolvedOperation[]>> {
  const generated = await createGenerationServices(registry).prepare(doc, {
    kind: 'generate',
    id,
    generatorId,
    params,
    position,
  });
  if (!generated.ok) return generated;
  return ok(
    generated.value.map((op) =>
      op.kind === 'put' && op.entity.kind === 'node'
        ? {
            ...op,
            entity: {
              ...op.entity,
              figureState: 'unplaced' as const,
              presentation: { ...op.entity.presentation, compositionPosition: { ...position } },
            },
          }
        : op,
    ),
  );
}
export async function addTensorSource(
  store: DocumentStore,
  registry: PluginRegistry,
  position?: Point,
  dimension: 2 | 3 = 3,
): Promise<Result<string>> {
  const doc = store.getSnapshot();
  if (doc.schemaVersion !== 2)
    return fail('SCHEMA_UPGRADE_REQUIRED', '请先创建计算副本，原工程保持不变。');
  const id = crypto.randomUUID(),
    g = registry.generators.get(`tensor.source${dimension}d`);
  if (!g) return fail('GENERATOR_UNAVAILABLE', `${dimension}D 数据张量生成器不可用。`);
  const ops = await prepareNode(
    doc,
    registry,
    id,
    g.id,
    { ...g.defaults, ...(doc.theme.nodeColor ? { fillColor: doc.theme.nodeColor } : {}) },
    position ?? nextPosition(doc),
  );
  if (!ops.ok) return ops;
  const commit = await store.dispatch({ baseRevision: doc.revision, operations: ops.value });
  return commit.ok ? ok(id) : commit;
}
export async function appendTensorOperation(
  store: DocumentStore,
  registry: PluginRegistry,
  sourceIds: readonly string[],
  kind: Exclude<TensorKind, 'source' | 'result'>,
  params: Params = {},
): Promise<Result<{ operationId: string; resultId: string }>> {
  const doc = store.getSnapshot();
  if (doc.schemaVersion !== 2)
    return fail('SCHEMA_UPGRADE_REQUIRED', '请先创建计算副本，原工程保持不变。');
  const merge = kind === 'concat' || kind === 'add';
  if (
    !['conv2d', 'pool2d', 'conv3d', 'pool3d', 'relu', 'upsample', 'concat', 'add'].includes(kind) ||
    sourceIds.length < (merge ? 2 : 1) ||
    sourceIds.length > (merge ? 8 : 1) ||
    new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some((id) => !['source', 'result'].includes(tensorKind(doc.entities[id]) ?? ''))
  )
    return fail(
      'INVALID_TENSOR_SELECTION',
      merge ? '请选择 2 至 8 个不同的数据块。' : '请选择一个数据块继续处理。',
    );
  const dimensions = sourceIds.map((id) => tensorDimension(doc.entities[id]));
  const dimension = dimensions[0];
  if (!dimension || dimensions.some((d) => d !== dimension))
    return fail('TENSOR_RANK_MISMATCH', '2D 与 3D 张量秩不一致，不能直接合并。');
  if ((kind.endsWith('2d') && dimension !== 2) || (kind.endsWith('3d') && dimension !== 3))
    return fail('TENSOR_RANK_MISMATCH', `${kind} 与所选 ${dimension}D 张量维度不一致。`);
  const g = registry.generators.get(`tensor.${kind}`),
    resultGenerator = registry.generators.get(`tensor.result${dimension}d`);
  if (!g || !resultGenerator) return fail('GENERATOR_UNAVAILABLE', '张量操作生成器不可用。');
  const sourceNodes = sourceIds.map((id) => doc.entities[id] as NodeEntity),
    positions = sourceNodes.map(
      (n) => n.presentation.compositionPosition ?? n.presentation.position,
    );
  const x = Math.max(...positions.map((p) => p.x)) + 180;
  let y = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
  const occupied = Object.values(doc.entities)
    .filter((e) => e.kind === 'node' && e.semantic)
    .map(
      (e) =>
        (e as NodeEntity).presentation.compositionPosition ??
        (e as NodeEntity).presentation.position,
    );
  while (
    occupied.some(
      (p) =>
        (Math.abs(p.x - x) < 130 || Math.abs(p.x - (x + 140)) < 130) && Math.abs(p.y - y) < 150,
    )
  )
    y += 200;
  const operationId = crypto.randomUUID(),
    resultId = crypto.randomUUID();
  const operation = await prepareNode(
    doc,
    registry,
    operationId,
    g.id,
    {
      ...g.defaults,
      ...params,
      ...(['relu', 'upsample'].includes(kind) ? { dimension } : {}),
      ...(merge ? { inputCount: sourceIds.length } : {}),
    },
    { x, y: y + 38 },
  );
  if (!operation.ok) return operation;
  const result = await prepareNode(
    doc,
    registry,
    resultId,
    resultGenerator.id,
    {
      ...resultGenerator.defaults,
      ...(doc.theme.nodeColor ? { fillColor: doc.theme.nodeColor } : {}),
    },
    { x: x + 140, y },
  );
  if (!result.ok) return result;
  const edge = (sourceId: string, targetId: string, targetPort: string): ResolvedOperation => {
    const entity: EdgeEntity = {
      id: crypto.randomUUID(),
      kind: 'edge',
      parentId: null,
      name: '张量数据流',
      figureState: 'unplaced',
      meaning: 'dataflow',
      source: { kind: 'port', entityId: sourceId, portId: 'out' },
      target: { kind: 'port', entityId: targetId, portId: targetPort },
      route: { kind: 'orthogonal', mode: 'auto', points: [], spaceId: null },
      style: {
        color: doc.theme.lineColor,
        width: doc.theme.lineWidth ?? 1.5,
        dashed: false,
        arrow: true,
      },
    };
    return { kind: 'put', entity };
  };
  const operations = [
    ...operation.value,
    ...result.value,
    ...sourceIds.map((id, i) => edge(id, operationId, i === 0 ? 'in' : `in${i + 1}`)),
    edge(operationId, resultId, 'in'),
  ];
  const commit = await store.dispatch({ baseRevision: doc.revision, operations });
  return commit.ok ? ok({ operationId, resultId }) : commit;
}
/** First placement only. A hidden object is a deliberate figure choice, not missing content. */
export function planPlaceTensorFigure(doc: ProjectDocument): ResolvedOperation[] {
  const eligible = new Set(
    Object.values(doc.entities)
      .filter((e) => e.figureState === 'unplaced' && e.kind !== 'edge')
      .map((e) => e.id),
  );
  const visible = (id: string) =>
    eligible.has(id) ||
    doc.entities[id]?.figureState === 'visible' ||
    doc.entities[id]?.figureState === undefined;
  return Object.values(doc.entities)
    .filter(
      (e) =>
        e.figureState === 'unplaced' &&
        (e.kind !== 'edge' ||
          (e.source.kind === 'port' &&
            e.target.kind === 'port' &&
            visible(e.source.entityId) &&
            visible(e.target.entityId))),
    )
    .map((entity) => ({
      kind: 'put',
      entity:
        entity.kind === 'edge'
          ? { ...entity, figureState: 'visible' }
          : {
              ...entity,
              figureState: 'visible',
              presentation: {
                ...entity.presentation,
                position: {
                  ...(entity.presentation.compositionPosition ?? entity.presentation.position),
                },
              },
            },
    }));
}
/** Hide only an explicit figure choice. Edges disappear effectively when an endpoint is hidden. */
export function planHideTensorFigure(
  doc: ProjectDocument,
  ids: readonly string[],
): ResolvedOperation[] {
  const selected = new Set(ids);
  return Object.values(doc.entities)
    .filter(
      (entity) =>
        entity.figureState !== undefined &&
        entity.figureState !== 'hidden' &&
        selected.has(entity.id),
    )
    .map((entity) => ({ kind: 'put', entity: { ...entity, figureState: 'hidden' } }));
}
/** Restore selected hidden objects in place; never treats unplaced content as a figure member. */
export function planRestoreTensorFigure(
  doc: ProjectDocument,
  ids: readonly string[],
): ResolvedOperation[] {
  const selected = new Set(ids);
  return Object.values(doc.entities)
    .filter((entity) => entity.figureState === 'hidden' && selected.has(entity.id))
    .map((entity) => ({ kind: 'put', entity: { ...entity, figureState: 'visible' } }));
}

/** Figure deletion must never delete shared computation, even in a mixed selection. */
export function planRemoveFromFigure(
  doc: ProjectDocument,
  ids: readonly string[],
): Result<ResolvedOperation[]> {
  if (doc.schemaVersion === 1) return planRemoveSelection(doc, [...ids]);
  const selected = ids.filter((id) => doc.entities[id]);
  if (!selected.length) return fail('EMPTY_SELECTION', '请先选择要移除的图元或连接。');
  // A retained edge needs both endpoints; a retained object needs its parent space.
  const retained = new Set(
    Object.values(doc.entities)
      .filter(
        (entity) =>
          entity.figureState !== undefined ||
          (entity.kind === 'node' && entity.semantic !== undefined) ||
          (entity.kind === 'edge' && entity.meaning === 'dataflow'),
      )
      .map((entity) => entity.id),
  );
  for (const id of retained) {
    const entity = doc.entities[id];
    if (entity.parentId) retained.add(entity.parentId);
    if (entity.kind === 'edge')
      for (const end of [entity.source, entity.target])
        if (end.kind === 'port') retained.add(end.entityId);
  }
  const hidden = new Set(selected.filter((id) => retained.has(id)));
  for (const entity of Object.values(doc.entities)) {
    let affected = hidden.has(entity.id),
      parentId = entity.parentId;
    while (!affected && parentId) {
      affected = hidden.has(parentId);
      parentId = doc.entities[parentId].parentId;
    }
    if (entity.locked && (affected || selected.includes(entity.id)))
      return fail('LOCKED', '对象或组内关联对象已锁定，未移除任何内容。', [entity.id]);
  }
  const ordinary = selected.filter((id) => !retained.has(id));
  const removal = ordinary.length
    ? planRemoveSelection(doc, ordinary)
    : ok<ResolvedOperation[]>([]);
  if (!removal.ok) return removal;
  if (removal.value.some((op) => op.kind === 'remove' && op.ids.some((id) => retained.has(id))))
    return fail('COMPUTATION_STRUCTURE', '此次移除会影响计算对象，请只从图稿隐藏相关对象。');
  return ok([
    ...removal.value,
    ...[...hidden]
      .filter((id) => doc.entities[id].figureState !== 'hidden')
      .map(
        (id): ResolvedOperation => ({
          kind: 'put',
          entity: { ...doc.entities[id], figureState: 'hidden' },
        }),
      ),
  ]);
}
