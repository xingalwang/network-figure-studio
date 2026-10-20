import { expect, test } from 'vitest';
import * as codec from '../../src/core/document/codec.ts';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createGenerationServices } from '../../src/core/generation/merge.ts';
import { addTensorSource, planPlaceTensorFigure } from '../../src/core/tensor-composition.ts';
import { analyzeDocument } from '../../src/core/computation/index.ts';
import type { ProjectDocument } from '../../src/core/document/types.ts';

async function legacy() {
  const registry = createBuiltinRegistry();
  const store = createDocumentStore(
    codec.createProject('旧计算图', 2),
    createGenerationServices(registry),
  );
  const source = await addTensorSource(store, registry, { x: 40, y: 50 }, 2);
  if (!source.ok) throw Error(source.error.message);
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: planPlaceTensorFigure(store.getSnapshot()),
  });
  return { registry, doc: store.getSnapshot(), sourceId: source.value };
}

test('v3 accepts drawing relations while v1 and v2 retain strict field contracts', () => {
  const doc = codec.createProject('v3', 3);
  expect(codec.decodeProject(JSON.stringify(doc)).ok).toBe(true);
  for (const version of [1, 2] as const) {
    const old = codec.createProject('旧格式', version);
    old.entities.note = {
      id: 'note',
      kind: 'node',
      parentId: null,
      name: '说明',
      size: { width: 100, height: 24 },
      bounds: { x: 0, y: 0, width: 100, height: 24 },
      ports: {},
      primitives: [],
      presentation: { position: { x: 0, y: 0 } },
      figure: { role: 'annotation' },
    } as any;
    expect(codec.decodeProject(JSON.stringify(old)).ok).toBe(false);
  }
});

test('explicit v3 copy migration separates computation identity from its drawing representation', async () => {
  const { doc, sourceId, registry } = await legacy();
  const migrate = codec.migrateProjectV3;
  expect(typeof migrate).toBe('function');
  const migrated: ProjectDocument = migrate(doc);
  expect(migrated.schemaVersion).toBe(3);
  expect(migrated.id).not.toBe(doc.id);
  expect(migrated.revision).toBe(0);
  expect(migrated.entities[sourceId]).toEqual(doc.entities[sourceId]);
  const drawings = Object.values(migrated.entities).filter(
    (entity: any) => entity.figure?.semanticRef === sourceId,
  );
  expect(drawings).toHaveLength(1);
  expect(drawings[0].id).not.toBe(sourceId);
  expect(drawings[0]).not.toHaveProperty('semantic');
  expect(drawings[0]).not.toHaveProperty('generation');
  expect(analyzeDocument(migrated, registry.computations).nodes).toEqual(
    analyzeDocument(doc, registry.computations).nodes,
  );
  expect(codec.decodeProject(codec.encodeProject(migrated)).ok).toBe(true);
  expect(doc.schemaVersion).toBe(2);
});

async function modern() {
  const ctx = await legacy();
  const doc = codec.migrateProjectV3(ctx.doc);
  return { ...ctx, doc, store: createDocumentStore(doc, createGenerationServices(ctx.registry)) };
}

test('adding another representation never adds a computation object and placement is idempotent', async () => {
  const ctx = await modern();
  const figures = await import('../../src/core/figure/index.ts');
  const add = figures.planAddFigureRepresentation(ctx.doc, ctx.sourceId, { x: 500, y: 100 });
  expect(add.ok).toBe(true);
  if (!add.ok) return;
  const committed = await ctx.store.dispatch({
    baseRevision: ctx.doc.revision,
    operations: add.value.operations,
  });
  expect(committed.ok).toBe(true);
  expect(
    Object.keys(analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes),
  ).toEqual([ctx.sourceId]);
  expect(planPlaceTensorFigure(ctx.store.getSnapshot())).toEqual([]);
  expect(ctx.store.getSnapshot().entities[add.value.id]).not.toHaveProperty('generation');
});

test('manual annotation text, position and source survive save, undo and redo', async () => {
  const ctx = await modern();
  const figures = await import('../../src/core/figure/index.ts');
  const add = figures.planAddFigureAnnotation(ctx.doc, '编码器说明', { x: 230, y: 70 });
  if (!add.ok) throw Error(add.error.message);
  expect(
    (await ctx.store.dispatch({ baseRevision: ctx.doc.revision, operations: add.value.operations }))
      .ok,
  ).toBe(true);
  const change = figures.planUpdateFigureAnnotation(ctx.store.getSnapshot(), add.value.id, {
    kind: 'manual',
    text: '独立标注',
  });
  if (!change.ok) throw Error(change.error.message);
  expect(
    (
      await ctx.store.dispatch({
        baseRevision: ctx.store.getSnapshot().revision,
        operations: change.value,
      })
    ).ok,
  ).toBe(true);
  const restored = codec.decodeProject(codec.encodeProject(ctx.store.getSnapshot()));
  expect(restored.ok).toBe(true);
  if (restored.ok)
    expect((restored.value.entities[add.value.id] as any).annotation).toEqual({
      kind: 'manual',
      text: '独立标注',
    });
  expect(ctx.store.undo().ok).toBe(true);
  expect((ctx.store.getSnapshot().entities[add.value.id] as any).annotation.text).toBe(
    '编码器说明',
  );
  expect(ctx.store.redo().ok).toBe(true);
  const visual = await import('../../src/graphics/tensor-visual.ts');
  const node = ctx.store.getSnapshot().entities[add.value.id];
  if (node.kind !== 'node') throw Error('not node');
  const painted = visual.annotationVisual(
    ctx.store.getSnapshot(),
    node,
    analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations),
  );
  expect(painted.primitives.some((primitive: any) => primitive.text === '独立标注')).toBe(true);
});

test('drawing groups preserve world position and never acquire module semantics', async () => {
  const ctx = await modern();
  const figures = await import('../../src/core/figure/index.ts');
  const drawing = Object.values(ctx.doc.entities).find(
    (entity: any) => entity.figure?.semanticRef === ctx.sourceId,
  )!;
  const grouped = figures.planGroupFigure(ctx.doc, [drawing.id], '论文组');
  if (!grouped.ok) throw Error(grouped.error.message);
  expect(
    (
      await ctx.store.dispatch({
        baseRevision: ctx.doc.revision,
        operations: grouped.value.operations,
      })
    ).ok,
  ).toBe(true);
  const next = ctx.store.getSnapshot(),
    group = next.entities[grouped.value.id],
    child = next.entities[drawing.id];
  expect(group).toHaveProperty('groupRole', 'drawing');
  expect(child).toHaveProperty('parentId', group.id);
  if (group.kind === 'edge' || child.kind === 'edge' || drawing.kind === 'edge')
    throw Error('not vertex');
  expect({
    x: group.presentation.position.x + child.presentation.position.x,
    y: group.presentation.position.y + child.presentation.position.y,
  }).toEqual(drawing.presentation.position);
  expect(figures.isStructureEntity(next, group)).toBe(false);
  expect(figures.planGroupFigure(next, [ctx.sourceId]).ok).toBe(false);
});

test('v3 rejects dangling annotation provenance and figure references atomically', async () => {
  const ctx = await modern();
  const figures = await import('../../src/core/figure/index.ts');
  const add = figures.planAddFigureAnnotation(ctx.doc, '说明');
  if (!add.ok) throw Error(add.error.message);
  const node = add.value.operations[0];
  if (node.kind !== 'put' || node.entity.kind !== 'node') throw Error('not put');
  node.entity.annotation = { kind: 'derived', semanticRef: 'missing', field: 'shape' };
  expect(
    (await ctx.store.dispatch({ baseRevision: ctx.doc.revision, operations: add.value.operations }))
      .ok,
  ).toBe(false);
  expect(ctx.store.getSnapshot()).toEqual(ctx.doc);
});

test('v3 placement adds only missing representations and never resurrects hidden figures', async () => {
  const ctx = await modern();
  const extra = await addTensorSource(ctx.store, ctx.registry, { x: 600, y: 300 }, 2);
  if (!extra.ok) throw Error(extra.error.message);
  const before = ctx.store.getSnapshot();
  const operations = planPlaceTensorFigure(before);
  expect(
    operations.some(
      (operation) =>
        operation.kind === 'put' && operation.entity.figure?.semanticRef === extra.value,
    ),
  ).toBe(true);
  expect((await ctx.store.dispatch({ baseRevision: before.revision, operations })).ok).toBe(true);
  const drawing = Object.values(ctx.store.getSnapshot().entities).find(
    (entity) => entity.figure?.semanticRef === extra.value,
  )!;
  const tensor = await import('../../src/core/tensor-composition.ts');
  const removed = tensor.planRemoveFromFigure(ctx.store.getSnapshot(), [drawing.id]);
  if (!removed.ok) throw Error(removed.error.message);
  expect(
    (
      await ctx.store.dispatch({
        baseRevision: ctx.store.getSnapshot().revision,
        operations: removed.value,
      })
    ).ok,
  ).toBe(true);
  expect(ctx.store.getSnapshot().entities[extra.value]).toHaveProperty('semantic');
  expect(ctx.store.getSnapshot().entities[drawing.id].figureState).toBe('hidden');
  expect(planPlaceTensorFigure(ctx.store.getSnapshot())).toEqual([]);
});

test('deleting a computation closes over its representations and derived annotations', async () => {
  const ctx = await modern();
  const figures = await import('../../src/core/figure/index.ts');
  const add = figures.planAddFigureAnnotation(ctx.doc, 'old');
  if (!add.ok) throw Error(add.error.message);
  await ctx.store.dispatch({ baseRevision: ctx.doc.revision, operations: add.value.operations });
  const update = figures.planUpdateFigureAnnotation(ctx.store.getSnapshot(), add.value.id, {
    kind: 'derived',
    semanticRef: ctx.sourceId,
    field: 'shape',
  });
  if (!update.ok) throw Error(update.error.message);
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: update.value,
  });
  const { planRemoveSelection } = await import('../../src/core/composition.ts');
  const remove = planRemoveSelection(ctx.store.getSnapshot(), [ctx.sourceId]);
  if (!remove.ok) throw Error(remove.error.message);
  const result = await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: remove.value,
  });
  expect(result.ok).toBe(true);
  expect(Object.values(ctx.store.getSnapshot().entities)).toHaveLength(0);
});

test('v3 migration reconnects existing drawing edges without changing manual appearance', async () => {
  const { doc, sourceId } = await legacy();
  const original = structuredClone(doc);
  original.entities.note = {
    id: 'note',
    kind: 'edge',
    parentId: null,
    name: '手工说明',
    meaning: 'annotation',
    source: { kind: 'port', entityId: sourceId, portId: 'out' },
    target: { kind: 'free', spaceId: null, point: { x: 420, y: 260 } },
    route: { kind: 'curve', mode: 'manual', points: [{ x: 240, y: 80 }], spaceId: null },
    style: { color: '#123456', width: 3, dashed: true, arrow: false, opacity: 0.4 },
    styleOverrides: { width: 3 },
    label: '不变',
    figureState: 'hidden',
  };
  const migrated = codec.migrateProjectV3(original);
  const drawing = Object.values(migrated.entities).find(
    (entity) => entity.figure?.semanticRef === sourceId,
  )!;
  expect(migrated.entities.note).toEqual({
    ...original.entities.note,
    source: { kind: 'port', entityId: drawing.id, portId: 'out' },
  });
  expect(codec.decodeProject(codec.encodeProject(migrated)).ok).toBe(true);
  expect(original.entities.note).toHaveProperty('source.entityId', sourceId);
});

test('summary and detail links are editable relations between independent representations', async () => {
  const ctx = await modern();
  const figures = await import('../../src/core/figure/index.ts');
  const summary = Object.values(ctx.doc.entities).find(
    (entity) => entity.figure?.semanticRef === ctx.sourceId,
  )!;
  const add = figures.planAddFigureRepresentation(ctx.doc, ctx.sourceId, { x: 500, y: 180 });
  if (!add.ok) throw Error(add.error.message);
  await ctx.store.dispatch({ baseRevision: ctx.doc.revision, operations: add.value.operations });
  const plan = figures.planSetFigureView;
  expect(typeof plan).toBe('function');
  const linked = plan(ctx.store.getSnapshot(), add.value.id, 'detail', summary.id);
  if (!linked.ok) throw Error(linked.error.message);
  expect(
    (
      await ctx.store.dispatch({
        baseRevision: ctx.store.getSnapshot().revision,
        operations: linked.value,
      })
    ).ok,
  ).toBe(true);
  expect(ctx.store.getSnapshot().entities[add.value.id].figure).toMatchObject({
    role: 'representation',
    semanticRef: ctx.sourceId,
    view: 'detail',
    relatedFigureId: summary.id,
  });
  expect(plan(ctx.store.getSnapshot(), summary.id, 'summary', add.value.id).ok).toBe(false);
  const independent = plan(ctx.store.getSnapshot(), add.value.id, 'summary');
  if (!independent.ok) throw Error(independent.error.message);
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: independent.value,
  });
  expect(ctx.store.getSnapshot().entities[add.value.id].figure).not.toHaveProperty(
    'relatedFigureId',
  );
});

test('derived annotations update from analysis while manual annotations remain unchanged', async () => {
  const ctx = await modern();
  const figures = await import('../../src/core/figure/index.ts');
  const { annotationVisual } = await import('../../src/graphics/tensor-visual.ts');
  const manual = figures.planAddFigureAnnotation(ctx.doc, 'H=64');
  if (!manual.ok) throw Error(manual.error.message);
  await ctx.store.dispatch({ baseRevision: ctx.doc.revision, operations: manual.value.operations });
  const derived = figures.planAddFigureAnnotation(ctx.store.getSnapshot(), '');
  if (!derived.ok) throw Error(derived.error.message);
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: derived.value.operations,
  });
  const content = figures.planUpdateFigureAnnotation(ctx.store.getSnapshot(), derived.value.id, {
    kind: 'derived',
    semanticRef: ctx.sourceId,
    field: 'shape',
  });
  if (!content.ok) throw Error(content.error.message);
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: content.value,
  });
  const before = ctx.store.getSnapshot(),
    source = structuredClone(before.entities[ctx.sourceId]);
  if (source.kind !== 'node' || source.generation?.source.kind !== 'local')
    throw Error('not source');
  Object.assign(source.generation.source.params, { N: 1, H: 96, W: 96, C: 3 });
  await ctx.store.dispatch({
    baseRevision: before.revision,
    operations: [{ kind: 'put', entity: source }],
  });
  const after = ctx.store.getSnapshot(),
    report = analyzeDocument(after, ctx.registry.computations);
  const paintedText = (id: string) => {
    const node = after.entities[id];
    if (node.kind !== 'node') throw Error('not node');
    return annotationVisual(after, node, report)
      .primitives.filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join('');
  };
  expect(paintedText(manual.value.id)).toBe('H=64');
  expect(paintedText(derived.value.id)).toContain('H96');
  expect(after.entities[derived.value.id]).toHaveProperty('annotation.kind', 'derived');
  expect(after.entities[derived.value.id]).not.toHaveProperty('annotation.text');
});

test('v1 migration deep-copies nested edge data and leaves legacy files intact', async () => {
  const { makeCoreFixture } = await import('../fixtures/project.ts');
  const original = makeCoreFixture();
  const migrated = codec.migrateProjectV3(original);
  const edge = migrated.entities.edge;
  if (edge.kind !== 'edge') throw Error('not edge');
  edge.route.points[0].x = 999;
  edge.style.color = '#abcdef';
  expect(original.entities.edge).toHaveProperty('route.points.0.x', 280);
  expect(original.entities.edge).toHaveProperty('style.color', '#374151');
  expect(original.entities.edge).not.toHaveProperty('meaning');
});

test('drawing grouping cannot indirectly capture a computation subtree', async () => {
  const ctx = await modern();
  const figures = await import('../../src/core/figure/index.ts');
  const group = {
    id: 'legacy-group',
    kind: 'group' as const,
    parentId: null,
    name: '旧计算容器',
    size: { width: 400, height: 240 },
    ports: {},
    presentation: { position: { x: 10, y: 20 } },
  };
  const source = { ...ctx.doc.entities[ctx.sourceId], parentId: group.id };
  expect(
    (
      await ctx.store.dispatch({
        baseRevision: ctx.doc.revision,
        operations: [
          { kind: 'put', entity: group },
          { kind: 'put', entity: source },
        ],
      })
    ).ok,
  ).toBe(true);
  expect(figures.planGroupFigure(ctx.store.getSnapshot(), [group.id]).ok).toBe(false);
  const drawingGroup = {
    ...group,
    id: 'drawing-group',
    groupRole: 'drawing' as const,
    figure: { role: 'decoration' as const },
  };
  const before = ctx.store.getSnapshot();
  const invalid = await ctx.store.dispatch({
    baseRevision: before.revision,
    operations: [
      { kind: 'put', entity: drawingGroup },
      { kind: 'put', entity: { ...group, parentId: drawingGroup.id } },
    ],
  });
  expect(invalid.ok).toBe(false);
  expect(ctx.store.getSnapshot()).toEqual(before);
});

test('v3 migration retains incomplete dataflow edges as editable drawing snapshots', async () => {
  const { doc, sourceId } = await legacy();
  const original = structuredClone(doc);
  original.entities.incomplete = {
    id: 'incomplete',
    kind: 'edge',
    parentId: null,
    name: '待接入',
    meaning: 'dataflow',
    source: { kind: 'port', entityId: sourceId, portId: 'out' },
    target: { kind: 'free', spaceId: null, point: { x: 420, y: 260 } },
    route: { kind: 'curve', mode: 'manual', points: [{ x: 240, y: 80 }], spaceId: null },
    style: { color: '#123456', width: 3, dashed: true, arrow: false },
    label: '保留连线',
  };
  const migrated = codec.migrateProjectV3(original);
  const edge = Object.values(migrated.entities).find(
    (entity) => entity.figure?.semanticRef === 'incomplete',
  );
  expect(edge).toBeDefined();
  if (edge?.kind !== 'edge') throw Error('missing edge representation');
  expect(edge.meaning).toBe('annotation');
  expect(edge.target).toEqual({ kind: 'free', spaceId: null, point: { x: 420, y: 260 } });
  expect(edge.route).toEqual({
    kind: 'curve',
    mode: 'manual',
    points: [{ x: 240, y: 80 }],
    spaceId: null,
  });
  expect(edge.style).toEqual({ color: '#123456', width: 3, dashed: true, arrow: false });
  expect(edge.label).toBe('保留连线');
  expect(migrated.entities.incomplete).toEqual(original.entities.incomplete);
  expect(codec.decodeProject(codec.encodeProject(migrated)).ok).toBe(true);
});

test('independent representation geometry edits preserve source dimensions, other figures and hand layout', async () => {
  const ctx = await modern();
  const figures = await import('../../src/core/figure/index.ts');
  const appearancePath = '../../src/graphics/figure-appearance.ts';
  const appearance = await import(appearancePath);
  const source = structuredClone(ctx.doc.entities[ctx.sourceId]);
  const first = Object.values(ctx.doc.entities).find(
    (entity) => entity.figure?.semanticRef === ctx.sourceId,
  )!;
  const added = figures.planAddFigureRepresentation(ctx.doc, ctx.sourceId, { x: 620, y: 300 });
  if (!added.ok) throw Error(added.error.message);
  await ctx.store.dispatch({ baseRevision: ctx.doc.revision, operations: added.value.operations });
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: [
      { kind: 'nodeStyle', id: added.value.id, style: { fill: '#cbb5d6', text: '#123456' } },
      { kind: 'label', id: added.value.id, text: '我的局部详图' },
    ],
  });
  const before = ctx.store.getSnapshot();
  const planned = appearance.planUpdateFigureAppearance(before, added.value.id, {
    drawWidth: 224,
    drawHeight: 64,
    depth: 52,
    angleDeg: 60,
  });
  if (!planned.ok) throw Error(planned.error.message);
  expect(
    (await ctx.store.dispatch({ baseRevision: before.revision, operations: planned.value })).ok,
  ).toBe(true);
  const after = ctx.store.getSnapshot(),
    updated = after.entities[added.value.id];
  expect(after.entities[ctx.sourceId]).toEqual(source);
  expect(after.entities[first.id]).toEqual(before.entities[first.id]);
  expect(updated).toHaveProperty('size', { width: 224, height: 64 });
  expect(updated).toHaveProperty('figure.tensorProjection', { depth: 52, angleDeg: 60 });
  expect(updated).toHaveProperty('presentation.position', { x: 620, y: 300 });
  expect(updated).toHaveProperty('presentation.fillOverride', '#cbb5d6');
  expect(updated).toHaveProperty('presentation.labelOverride', '我的局部详图');
  expect(appearance.figureAppearance(after, updated)).toEqual({
    drawWidth: 224,
    drawHeight: 64,
    depth: 52,
    angleDeg: 60,
  });
  expect(
    appearance.planUpdateFigureAppearance(after, added.value.id, {
      drawWidth: 224,
      drawHeight: 64,
      depth: 52,
      angleDeg: 90,
    }).ok,
  ).toBe(false);
  const decoded = codec.decodeProject(codec.encodeProject(after));
  expect(decoded.ok).toBe(true);
  if (decoded.ok) expect(decoded.value.entities[added.value.id]).toEqual(updated);
  expect(ctx.store.undo().ok).toBe(true);
  expect(ctx.store.getSnapshot().entities[added.value.id]).toEqual(before.entities[added.value.id]);
  expect(ctx.store.redo().ok).toBe(true);
  expect(ctx.store.getSnapshot().entities[added.value.id]).toEqual(updated);
  const visual = await import('../../src/graphics/tensor-visual.ts');
  if (updated.kind !== 'node') throw Error('not node');
  const projected = visual.tensorVisual(
    after,
    updated,
    analyzeDocument(after, ctx.registry.computations),
    'figure',
    'dark',
    ctx.registry.computations,
  );
  expect(projected.primitives).toContainEqual(
    expect.objectContaining({ kind: 'rect', width: 224, height: 64, fill: '#cbb5d6' }),
  );
  expect(projected.primitives.filter((p) => p.kind === 'text').map((p) => p.text)).toContain(
    '我的局部详图',
  );
});
