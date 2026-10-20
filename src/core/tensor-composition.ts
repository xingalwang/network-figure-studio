import type { PluginRegistry } from '../plugins/registry.ts';
import { createGenerationServices } from './generation/merge.ts';
import { planRemoveSelection } from './composition.ts';
import { representationOf } from './figure/index.ts';
import {
  tensorDimension,
  resolveComputation,
  resolveOperation,
  type TensorKind,
} from './computation/index.ts';
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
  if (doc.schemaVersion < 2)
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
  if (doc.schemaVersion < 2)
    return fail('SCHEMA_UPGRADE_REQUIRED', '请先创建计算副本，原工程保持不变。');
  const definition = resolveOperation(kind, registry.computations),
    creation = definition?.operation;
  if (!definition || !creation) return fail('GENERATOR_UNAVAILABLE', '没有可用的计算操作定义。');
  if (
    sourceIds.length < creation.minInputs ||
    sourceIds.length > creation.maxInputs ||
    new Set(sourceIds).size !== sourceIds.length ||
    sourceIds.some((id) => {
      const source = resolveComputation(doc.entities[id], registry.computations);
      return !source || source.role === 'operation';
    })
  )
    return fail(
      'INVALID_TENSOR_SELECTION',
      creation.minInputs > 1
        ? `请选择 ${creation.minInputs} 至 ${creation.maxInputs} 个不同的数据块。`
        : '请选择一个数据块继续处理。',
    );
  const dimensions = sourceIds.map((id) =>
    tensorDimension(doc.entities[id], registry.computations),
  );
  const dimension = dimensions[0];
  if (!dimension || dimensions.some((d) => d !== dimension))
    return fail('TENSOR_RANK_MISMATCH', '2D 与 3D 张量秩不一致，不能直接合并。');
  if (!creation.dimensions.includes(dimension))
    return fail('TENSOR_RANK_MISMATCH', `${kind} 与所选 ${dimension}D 张量维度不一致。`);
  const g = registry.generators.get(definition.generatorId),
    resultGenerator = registry.generators.get(creation.resultGeneratorId(dimension));
  if (!g || !resultGenerator) return fail('GENERATOR_UNAVAILABLE', '张量操作生成器不可用。');
  let operationParams: Params;
  try {
    operationParams = creation.prepareParams(
      { ...g.defaults, ...params },
      dimension,
      sourceIds.length,
    );
  } catch (error) {
    return fail('INVALID_PARAMS', error instanceof Error ? error.message : '计算参数准备失败。');
  }
  const inputPorts = definition.inputs(operationParams),
    resultDefinition = registry.computations.get(resultGenerator.id);
  if (
    inputPorts.length !== sourceIds.length ||
    inputPorts.some((p) => p.role !== 'tensor') ||
    !resultDefinition ||
    resultDefinition.role !== 'tensor-result'
  )
    return fail('INVALID_COMPUTATION_PORTS', '计算定义的输入端口或结果生成器不匹配。');
  const resultPorts = resultDefinition.inputs(resultGenerator.defaults);
  if (resultPorts.length !== 1 || resultPorts[0].role !== 'operation')
    return fail('INVALID_COMPUTATION_PORTS', '结果张量必须接收一个操作输出。');
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
  const operation = await prepareNode(doc, registry, operationId, g.id, operationParams, {
    x,
    y: y + 38,
  });
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
  const edge = (
    sourceId: string,
    sourcePort: string,
    targetId: string,
    targetPort: string,
  ): ResolvedOperation => {
    const entity: EdgeEntity = {
      id: crypto.randomUUID(),
      kind: 'edge',
      parentId: null,
      name: '张量数据流',
      figureState: 'unplaced',
      meaning: 'dataflow',
      source: { kind: 'port', entityId: sourceId, portId: sourcePort },
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
    ...sourceIds.map((id, i) =>
      edge(
        id,
        resolveComputation(doc.entities[id], registry.computations)!.outputPort,
        operationId,
        inputPorts[i].id,
      ),
    ),
    edge(operationId, definition.outputPort, resultId, resultPorts[0].id),
  ];
  const commit = await store.dispatch({ baseRevision: doc.revision, operations });
  return commit.ok ? ok({ operationId, resultId }) : commit;
}
/** First placement only. A hidden object is a deliberate figure choice, not missing content. */
export function planPlaceTensorFigure(doc: ProjectDocument): ResolvedOperation[] {
  if (doc.schemaVersion === 3) return planPlaceRepresentations(doc);
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

/** New representations are appended; existing figures, including hidden ones, stay authoritative. */
function planPlaceRepresentations(doc: ProjectDocument): ResolvedOperation[] {
  const operations: ResolvedOperation[] = [],
    representations = new Map<string, string>();
  for (const entity of Object.values(doc.entities))
    if (
      entity.figure?.role === 'representation' &&
      entity.figure.semanticRef &&
      !representations.has(entity.figure.semanticRef)
    )
      representations.set(entity.figure.semanticRef, entity.id);
  const referencedPorts = new Map<string, Set<string>>();
  const rememberPort = (entityId: string, portId: string) => {
    if (!referencedPorts.has(entityId)) referencedPorts.set(entityId, new Set());
    referencedPorts.get(entityId)!.add(portId);
  };
  for (const entity of Object.values(doc.entities))
    if (entity.kind === 'edge') {
      for (const endpoint of [entity.source, entity.target])
        if (endpoint.kind === 'port') rememberPort(endpoint.entityId, endpoint.portId);
    } else
      for (const port of Object.values(entity.ports))
        if ('entityId' in port) rememberPort(port.entityId, port.portId);
  for (const figure of Object.values(doc.entities)) {
    if (figure.kind !== 'node' || figure.figure?.role !== 'representation') continue;
    const source = doc.entities[figure.figure.semanticRef ?? ''];
    if (source?.kind !== 'node' || !source.semantic) continue;
    const ports: NodeEntity['ports'] = Object.fromEntries(
      Object.entries(source.ports).map(([key, port]) => [
        key,
        figure.ports[key] ??
          ('entityId' in port
            ? structuredClone(port)
            : {
                x: (port.x * figure.size.width) / source.size.width,
                y: (port.y * figure.size.height) / source.size.height,
              }),
      ]),
    );
    // A diagram may retain an explanatory connection to an earlier semantic port.
    for (const [key, port] of Object.entries(figure.ports))
      if (!(key in ports) && referencedPorts.get(figure.id)?.has(key))
        ports[key] = structuredClone(port);
    if (JSON.stringify(ports) !== JSON.stringify(figure.ports))
      operations.push({ kind: 'put', entity: { ...figure, ports } });
  }
  for (const entity of Object.values(doc.entities)) {
    if (entity.kind !== 'node' || !entity.semantic || representations.has(entity.id)) continue;
    const id = crypto.randomUUID(),
      figure = representationOf(
        entity,
        id,
        entity.presentation.compositionPosition ?? entity.presentation.position,
      );
    figure.parentId = null;
    representations.set(entity.id, id);
    operations.push({ kind: 'put', entity: figure });
  }
  const visible = (id: string) => {
    const existing = doc.entities[id];
    return !existing || existing.figureState !== 'hidden';
  };
  for (const entity of Object.values(doc.entities)) {
    if (
      entity.kind !== 'edge' ||
      entity.meaning !== 'dataflow' ||
      representations.has(entity.id) ||
      entity.source.kind !== 'port' ||
      entity.target.kind !== 'port'
    )
      continue;
    const sourceId = representations.get(entity.source.entityId),
      targetId = representations.get(entity.target.entityId);
    if (!sourceId || !targetId || !visible(sourceId) || !visible(targetId)) continue;
    const id = crypto.randomUUID(),
      edge = structuredClone(entity);
    delete edge.generation;
    edge.id = id;
    edge.parentId = null;
    edge.meaning = 'annotation';
    edge.figure = { role: 'representation', semanticRef: entity.id };
    edge.figureState = entity.figureState === 'hidden' ? 'hidden' : 'visible';
    edge.source = { ...entity.source, entityId: sourceId };
    edge.target = { ...entity.target, entityId: targetId };
    edge.route.spaceId = null;
    operations.push({ kind: 'put', entity: edge });
  }
  return operations;
}
/** Hide only an explicit figure choice. Edges disappear effectively when an endpoint is hidden. */
export function planHideTensorFigure(
  doc: ProjectDocument,
  ids: readonly string[],
): ResolvedOperation[] {
  const selected = figureSelection(doc, ids);
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
  const selected = figureSelection(doc, ids);
  return Object.values(doc.entities)
    .filter((entity) => entity.figureState === 'hidden' && selected.has(entity.id))
    .map((entity) => ({ kind: 'put', entity: { ...entity, figureState: 'visible' } }));
}

function figureSelection(doc: ProjectDocument, ids: readonly string[]): Set<string> {
  const selected = new Set(ids);
  if (doc.schemaVersion !== 3) return selected;
  for (const entity of Object.values(doc.entities))
    if (
      entity.figure?.role === 'representation' &&
      entity.figure.semanticRef &&
      selected.has(entity.figure.semanticRef)
    )
      selected.add(entity.id);
  for (const id of ids) {
    const entity = doc.entities[id];
    if (
      (entity?.kind === 'node' && entity.semantic) ||
      (entity?.kind === 'edge' && entity.meaning === 'dataflow')
    )
      selected.delete(id);
  }
  return selected;
}

/** Figure deletion must never delete shared computation, even in a mixed selection. */
export function planRemoveFromFigure(
  doc: ProjectDocument,
  ids: readonly string[],
): Result<ResolvedOperation[]> {
  if (doc.schemaVersion === 1) return planRemoveSelection(doc, [...ids]);
  const selected = [...figureSelection(doc, ids)].filter((id) => doc.entities[id]);
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
