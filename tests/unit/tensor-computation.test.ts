import { expect, test } from 'vitest';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import {
  createProject,
  decodeProject,
  encodeProject,
  migrateProjectV2,
} from '../../src/core/document/codec.ts';
import { createGenerationServices, getGenerationParams } from '../../src/core/generation/merge.ts';
import { analyzeDocument, producerOf, tensorKind } from '../../src/core/computation/index.ts';
import {
  addTensorSource,
  appendTensorOperation,
  planHideTensorFigure,
  planRestoreTensorFigure,
  planRemoveFromFigure,
  planPlaceTensorFigure,
} from '../../src/core/tensor-composition.ts';
import type { Params } from '../../src/core/document/types.ts';
import { planRemoveSelection, planLayout } from '../../src/core/composition.ts';
import { makeCoreFixture } from '../fixtures/project.ts';

function setup() {
  const registry = createBuiltinRegistry();
  return {
    registry,
    store: createDocumentStore(createProject('张量', 2), createGenerationServices(registry)),
  };
}
async function source() {
  const ctx = setup();
  const r = await addTensorSource(ctx.store, ctx.registry, { x: 40, y: 120 });
  if (!r.ok) throw Error(r.error.message);
  await change(ctx, r.value, { D: 128, H: 128, W: 128 });
  return { ...ctx, id: r.value };
}
async function change(ctx: ReturnType<typeof setup>, id: string, params: Params) {
  const p = getGenerationParams(ctx.store.getSnapshot(), id, ctx.registry);
  if (!p.ok) throw Error(p.error.message);
  const g = ctx.store.getSnapshot().entities[id].generation!;
  const r = await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: [
      { kind: 'generate', id, generatorId: g.generatorId, params: { ...p.value, ...params } },
    ],
  });
  expect(r.ok).toBe(true);
}
async function append(
  ctx: ReturnType<typeof setup>,
  ids: string[],
  kind: 'conv3d' | 'pool3d' | 'concat' | 'add',
  params: Params = {},
) {
  const r = await appendTensorOperation(ctx.store, ctx.registry, ids, kind, params);
  if (!r.ok) throw Error(r.error.message);
  return r.value;
}

test('v1 stays strict; explicit v2 migration preserves old entities and marks old links annotation', () => {
  const old = makeCoreFixture(),
    copy = migrateProjectV2(old);
  expect(copy.id).not.toBe(old.id);
  expect(copy.schemaVersion).toBe(2);
  expect(copy.entities['node-a']).toEqual(old.entities['node-a']);
  expect(copy.entities.edge.kind === 'edge' && copy.entities.edge.meaning).toBe('annotation');
  expect(old.entities.edge).not.toHaveProperty('meaning');
  expect(decodeProject(encodeProject(copy)).ok).toBe(true);
  expect(decodeProject(JSON.stringify({ ...copy, schemaVersion: 1 })).ok).toBe(false);
});
test('source stays pending until dimensions configured; visual geometry never changes real dimensions', async () => {
  const ctx = setup(),
    r = await addTensorSource(ctx.store, ctx.registry);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(
    analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[r.value].state,
  ).toBe('pending');
  await change(ctx, r.value, { D: 128, H: 128, W: 128, drawWidth: 180, depth: 70 });
  expect(
    analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[r.value].shape,
  ).toEqual({
    N: 1,
    D: 128,
    H: 128,
    W: 128,
    C: 1,
  });
  expect(tensorKind(ctx.store.getSnapshot().entities[r.value], ctx.registry.computations)).toBe(
    'source',
  );
});
test('minimal hand-built branch pipeline infers shapes, formulas and weights, and propagates edits', async () => {
  const ctx = await source(),
    conv = await append(ctx, [ctx.id], 'conv3d'),
    pool = await append(ctx, [conv.resultId], 'pool3d'),
    branch = await append(ctx, [conv.resultId], 'conv3d', {
      kernelD: 1,
      kernelH: 1,
      kernelW: 1,
      strideD: 2,
      strideH: 2,
      strideW: 2,
      padding: 'valid',
      outChannels: 8,
    }),
    concat = await append(ctx, [pool.resultId, branch.resultId], 'concat');
  let a = analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes;
  expect(a[conv.operationId].parameterCount).toBe(448);
  expect(a[conv.resultId].shape).toEqual({ N: 1, D: 128, H: 128, W: 128, C: 16 });
  expect(a[pool.resultId].shape).toEqual({ N: 1, D: 64, H: 64, W: 64, C: 16 });
  expect(a[branch.operationId].parameterCount).toBe(136);
  expect(a[concat.resultId].shape).toEqual({ N: 1, D: 64, H: 64, W: 64, C: 24 });
  expect(a[conv.operationId].steps.join(' ')).toContain('16 × (1 × 3 × 3 × 3 + 1) = 448');
  expect(producerOf(ctx.store.getSnapshot(), conv.resultId)).toBe(conv.operationId);
  await change(ctx, conv.operationId, { outChannels: 32 });
  a = analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes;
  expect(a[concat.resultId].shape?.C).toBe(40);
  expect(a[branch.operationId].parameterCount).toBe(264);
  await change(ctx, branch.operationId, { strideD: 1, strideH: 1, strideW: 1 });
  a = analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes;
  expect(a[concat.operationId].state).toBe('error');
  expect(a[concat.operationId].diagnostics.join(' ')).toContain('D');
  expect(a[concat.resultId].shape).toBeUndefined();
  expect(decodeProject(encodeProject(ctx.store.getSnapshot())).ok).toBe(true);
});
test('append is one undo and invalid input selection is atomic', async () => {
  const ctx = await source(),
    before = ctx.store.getSnapshot(),
    r = await append(ctx, [ctx.id], 'conv3d');
  expect(Object.keys(ctx.store.getSnapshot().entities).length).toBe(
    Object.keys(before.entities).length + 4,
  );
  ctx.store.undo();
  expect(Object.keys(ctx.store.getSnapshot().entities)).toEqual(Object.keys(before.entities));
  ctx.store.redo();
  expect(ctx.store.getSnapshot().entities[r.resultId]).toBeDefined();
  const rev = ctx.store.getSnapshot().revision,
    invalid = await appendTensorOperation(ctx.store, ctx.registry, [r.operationId], 'pool3d', {});
  expect(invalid.ok).toBe(false);
  expect(ctx.store.getSnapshot().revision).toBe(rev);
});
test('figure update only places unplaced content, preserves manual presentation, hidden is not re-added', async () => {
  const ctx = await source(),
    conv = await append(ctx, [ctx.id], 'conv3d');
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: planPlaceTensorFigure(ctx.store.getSnapshot()),
  });
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: [
      { kind: 'move', id: ctx.id, position: { x: 980, y: 510 } },
      { kind: 'compositionMove', id: ctx.id, position: { x: 70, y: 200 } },
      { kind: 'fill', id: ctx.id, color: '#ff0000' },
    ],
  });
  await change(ctx, ctx.id, { C: 2 });
  const node = ctx.store.getSnapshot().entities[ctx.id];
  expect(node.kind !== 'edge' && node.presentation.position).toEqual({ x: 980, y: 510 });
  expect(node.kind !== 'edge' && node.presentation.compositionPosition).toEqual({ x: 70, y: 200 });
  expect(node.kind !== 'edge' && node.presentation.fillOverride).toBe('#ff0000');
  expect(planPlaceTensorFigure(ctx.store.getSnapshot())).toEqual([]);
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: planHideTensorFigure(ctx.store.getSnapshot(), [conv.resultId]),
  });
  expect(ctx.store.getSnapshot().entities[conv.resultId].figureState).toBe('hidden');
  expect(planPlaceTensorFigure(ctx.store.getSnapshot())).toEqual([]);
  expect(
    analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[conv.resultId].shape
      ?.C,
  ).toBe(16);
});
test('Add requires identical shape instead of implicit broadcasting', async () => {
  const ctx = await source(),
    a = await append(ctx, [ctx.id], 'conv3d', { outChannels: 16 }),
    b = await append(ctx, [ctx.id], 'conv3d', { outChannels: 8 }),
    sum = await append(ctx, [a.resultId, b.resultId], 'add');
  const result = analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[
    sum.operationId
  ];
  expect(result.state).toBe('error');
  expect(result.diagnostics.join(' ')).toContain('C');
  expect(result.shape).toBeUndefined();
});

test('nullable operation parameters stay pending, valid windows cannot produce zero-sized tensors', async () => {
  const ctx = await source(),
    conv = await append(ctx, [ctx.id], 'conv3d', { kernelD: null });
  expect(
    analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[conv.operationId]
      .state,
  ).toBe('pending');
  expect(
    analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[conv.resultId].shape,
  ).toBeUndefined();
  await change(ctx, conv.operationId, { kernelD: 200, padding: 'valid' });
  const error = analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[
    conv.operationId
  ];
  expect(error.state).toBe('error');
  expect(error.diagnostics.join(' ')).toContain('输入 128 小于窗口 200');
  expect(error.shape).toBeUndefined();
});
test('Same explains actual asymmetric padding and handles independent spatial axes', async () => {
  const ctx = await source();
  await change(ctx, ctx.id, { D: 127, H: 128, W: 129 });
  const conv = await append(ctx, [ctx.id], 'conv3d', { strideD: 2, strideH: 2, strideW: 2 });
  const computed = analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[
    conv.operationId
  ];
  expect(computed.shape).toEqual({ N: 1, D: 64, H: 64, W: 65, C: 16 });
  expect(computed.steps.join(' ')).toContain('H 补边：前 0，后 1');
});
test('missing source declaration and an unavailable rule are explicit, not guessed', async () => {
  const ctx = await source();
  const doc = structuredClone(ctx.store.getSnapshot()),
    e = doc.entities[ctx.id];
  if (e.generation?.source.kind !== 'local') throw Error();
  delete e.generation.source.params.D;
  expect(analyzeDocument(doc, ctx.registry.computations).nodes[ctx.id].state).toBe('pending');
  e.generation.generatorId = 'third-party.unknown';
  expect(analyzeDocument(doc, ctx.registry.computations).nodes[ctx.id].state).toBe('unsupported');
});

test('loaded merge with invalid input count reports an error without inventing ports', async () => {
  const ctx = await source(),
    a = await append(ctx, [ctx.id], 'conv3d'),
    b = await append(ctx, [ctx.id], 'conv3d'),
    concat = await append(ctx, [a.resultId, b.resultId], 'concat');
  const doc = structuredClone(ctx.store.getSnapshot()),
    op = doc.entities[concat.operationId];
  if (op.generation?.source.kind !== 'local') throw Error();
  op.generation.source.params.inputCount = 999;
  const computed = analyzeDocument(doc, ctx.registry.computations).nodes[concat.operationId];
  expect(computed.state).toBe('error');
  expect(computed.diagnostics.join(' ')).toContain('2 至 8');
  expect(computed.shape).toBeUndefined();
});

test('hide and restore only selected figure objects, preserving independent hidden edges and manual presentation', async () => {
  const ctx = await source(),
    conv = await append(ctx, [ctx.id], 'conv3d');
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: planPlaceTensorFigure(ctx.store.getSnapshot()),
  });
  const edges = Object.values(ctx.store.getSnapshot().entities).filter((e) => e.kind === 'edge');
  const incoming = edges.find((e) => e.source.kind === 'port' && e.source.entityId === ctx.id)!;
  const outgoing = edges.find(
    (e) => e.source.kind === 'port' && e.source.entityId === conv.operationId,
  )!;
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: [
      { kind: 'move', id: conv.operationId, position: { x: 610, y: 280 } },
      { kind: 'nodeStyle', id: conv.operationId, style: { fill: '#abcdef' } },
      {
        kind: 'route',
        id: incoming.id,
        route: { ...incoming.route, mode: 'manual', points: [{ x: 580, y: 230 }] },
      },
      ...planHideTensorFigure(ctx.store.getSnapshot(), [outgoing.id]),
    ],
  });
  const before = ctx.store.getSnapshot(),
    hide = planHideTensorFigure(before, [conv.operationId]);
  expect(hide.map((op) => (op.kind === 'put' ? op.entity.id : null))).toEqual([conv.operationId]);
  await ctx.store.dispatch({ baseRevision: before.revision, operations: hide });
  expect(ctx.store.getSnapshot().entities[incoming.id].figureState).toBe('visible');
  expect(ctx.store.getSnapshot().entities[outgoing.id].figureState).toBe('hidden');
  const unplaced = await addTensorSource(ctx.store, ctx.registry);
  if (!unplaced.ok) throw Error();
  const restore = planRestoreTensorFigure(ctx.store.getSnapshot(), [
    conv.operationId,
    unplaced.value,
  ]);
  expect(restore.map((op) => (op.kind === 'put' ? op.entity.id : null))).toEqual([
    conv.operationId,
  ]);
  await ctx.store.dispatch({ baseRevision: ctx.store.getSnapshot().revision, operations: restore });
  expect(ctx.store.getSnapshot().entities[conv.operationId]).toEqual(
    before.entities[conv.operationId],
  );
  expect(ctx.store.getSnapshot().entities[incoming.id]).toEqual(before.entities[incoming.id]);
  expect(ctx.store.getSnapshot().entities[outgoing.id].figureState).toBe('hidden');
  expect(ctx.store.getSnapshot().entities[unplaced.value].figureState).toBe('unplaced');
  expect(
    analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[conv.resultId].shape
      ?.C,
  ).toBe(16);
});

test('unavailable generator versions block their whole downstream instead of guessing with current rules', async () => {
  const ctx = await source(),
    conv = await append(ctx, [ctx.id], 'conv3d'),
    pool = await append(ctx, [conv.resultId], 'pool3d');
  for (const change of [{ version: '2.0.0' }, { paramSchemaVersion: 2 }]) {
    const doc = structuredClone(ctx.store.getSnapshot());
    Object.assign(doc.entities[conv.operationId].generation!, change);
    const report = analyzeDocument(doc, ctx.registry.computations).nodes;
    expect(report[conv.operationId].state).toBe('unsupported');
    expect(report[conv.operationId].diagnostics.join(' ')).toContain('版本');
    for (const id of [conv.resultId, pool.operationId, pool.resultId]) {
      expect(report[id].state).toBe('unsupported');
      expect(report[id].shape).toBeUndefined();
      expect(report[id].diagnostics.join(' ')).toContain('上游');
    }
    expect(decodeProject(encodeProject(doc)).ok).toBe(true);
  }
});
test('an unknown upstream tensor rule propagates unavailable rather than a dimension error', async () => {
  const ctx = await source(),
    conv = await append(ctx, [ctx.id], 'conv3d'),
    doc = structuredClone(ctx.store.getSnapshot());
  doc.entities[ctx.id].generation!.generatorId = 'external.tensor-source';
  const report = analyzeDocument(doc, ctx.registry.computations).nodes;
  expect(report[ctx.id].state).toBe('unsupported');
  expect(report[conv.operationId].state).toBe('unsupported');
  expect(report[conv.resultId].shape).toBeUndefined();
});

test('Conv3D explanation follows the selected padding formula instead of always describing Same', async () => {
  const ctx = await source(),
    conv = await append(ctx, [ctx.id], 'conv3d');
  const same = analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[
    conv.operationId
  ];
  expect(same.explanation).toContain('Same');
  expect(same.steps.join(' ')).toContain('ceil(128 / 1) = 128');
  await change(ctx, conv.operationId, { padding: 'valid' });
  const valid = analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[
    conv.operationId
  ];
  expect(valid.explanation).toContain('Valid 不补边');
  expect(valid.explanation).not.toContain('Same');
  expect(valid.steps.join(' ')).toContain('floor((128 − 3) / 1) + 1 = 126');
  expect(valid.steps.join(' ')).not.toContain('ceil');
});

test('mixed figure deletion hides tensors but deletes selected ordinary nodes and annotations in one undo', async () => {
  const ctx = await source(),
    conv = await append(ctx, [ctx.id], 'conv3d');
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: [
      ...planPlaceTensorFigure(ctx.store.getSnapshot()),
      ...Object.values(makeCoreFixture().entities).map((entity) => ({
        kind: 'put' as const,
        entity: entity.kind === 'edge' ? { ...entity, meaning: 'annotation' as const } : entity,
      })),
    ],
  });
  const before = ctx.store.getSnapshot(),
    plan = planRemoveFromFigure(before, [ctx.id, 'node-a', 'edge']);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(
    (await ctx.store.dispatch({ baseRevision: before.revision, operations: plan.value })).ok,
  ).toBe(true);
  const after = ctx.store.getSnapshot();
  expect(after.entities[ctx.id].figureState).toBe('hidden');
  expect(after.entities[conv.operationId]).toEqual(before.entities[conv.operationId]);
  expect(after.entities['node-a']).toBeUndefined();
  expect(after.entities.edge).toBeUndefined();
  expect(after.entities['node-b']).toEqual(before.entities['node-b']);
  expect(analyzeDocument(after, ctx.registry.computations).nodes[conv.resultId].shape?.C).toBe(16);
  ctx.store.undo();
  expect(ctx.store.getSnapshot().entities).toEqual(before.entities);
});
test('deleting an ordinary parent that contains computation hides the parent without removing computation', async () => {
  const ctx = await source(),
    before = ctx.store.getSnapshot(),
    sourceNode = before.entities[ctx.id];
  await ctx.store.dispatch({
    baseRevision: before.revision,
    operations: [
      {
        kind: 'put',
        entity: {
          id: 'wrapper',
          kind: 'group',
          name: '自由分组',
          parentId: null,
          size: { width: 600, height: 400 },
          ports: {},
          presentation: { position: { x: 0, y: 0 } },
        },
      },
      { kind: 'put', entity: { ...sourceNode, parentId: 'wrapper' } },
    ],
  });
  const plan = planRemoveFromFigure(ctx.store.getSnapshot(), ['wrapper']);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(
    (
      await ctx.store.dispatch({
        baseRevision: ctx.store.getSnapshot().revision,
        operations: plan.value,
      })
    ).ok,
  ).toBe(true);
  expect(ctx.store.getSnapshot().entities.wrapper.figureState).toBe('hidden');
  expect(ctx.store.getSnapshot().entities[ctx.id]).toBeDefined();
  expect(
    analyzeDocument(ctx.store.getSnapshot(), ctx.registry.computations).nodes[ctx.id].shape?.D,
  ).toBe(128);
});
test('figure deletion preserves endpoints of protected dataflow and refuses locked mixed selections', async () => {
  const ctx = await source(),
    conv = await append(ctx, [ctx.id], 'conv3d'),
    doc = structuredClone(ctx.store.getSnapshot());
  Object.assign(doc.entities, makeCoreFixture().entities);
  delete doc.entities.edge;
  const edge = Object.values(doc.entities).find((e) => e.kind === 'edge')!;
  if (edge.kind !== 'edge') throw Error();
  edge.source = { kind: 'port', entityId: 'node-a', portId: 'out' };
  const plan = planRemoveFromFigure(doc, ['node-a']);
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  const store = createDocumentStore(doc);
  expect((await store.dispatch({ baseRevision: doc.revision, operations: plan.value })).ok).toBe(
    true,
  );
  expect(store.getSnapshot().entities['node-a'].figureState).toBe('hidden');
  expect(store.getSnapshot().entities[edge.id]).toBeDefined();
  const locked = structuredClone(doc);
  locked.entities[ctx.id].locked = true;
  const result = planRemoveFromFigure(locked, [ctx.id, 'node-b']);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe('LOCKED');
  expect(planRemoveFromFigure(makeCoreFixture(), ['node-a'])).toEqual(
    planRemoveSelection(makeCoreFixture(), ['node-a']),
  );
});
test('a source rejects every inbound dataflow including self loops, while annotation is unrestricted', async () => {
  const ctx = await source(),
    conv = await append(ctx, [ctx.id], 'conv3d'),
    base = ctx.store.getSnapshot();
  const template = Object.values(base.entities).find((e) => e.kind === 'edge');
  if (!template || template.kind !== 'edge') throw Error();
  for (const origin of [ctx.id, conv.resultId]) {
    const doc = structuredClone(base);
    doc.entities.back = {
      ...structuredClone(template),
      id: 'back',
      source: { kind: 'port', entityId: origin, portId: 'out' },
      target: { kind: 'port', entityId: ctx.id, portId: 'out' },
    };
    expect(decodeProject(encodeProject(doc)).ok).toBe(true);
    let report = analyzeDocument(doc, ctx.registry.computations).nodes;
    expect(report[ctx.id].state).toBe('error');
    expect(report[ctx.id].diagnostics.join(' ')).toContain('源');
    expect(report[ctx.id].shape).toBeUndefined();
    expect(report[conv.operationId].state).toBe('error');
    expect(report[conv.resultId].shape).toBeUndefined();
    const back = doc.entities.back;
    if (back.kind !== 'edge') throw Error();
    back.meaning = 'annotation';
    report = analyzeDocument(doc, ctx.registry.computations).nodes;
    expect(report[ctx.id].state).toBe('ready');
    expect(report[conv.resultId].shape?.C).toBe(16);
  }
});

test('structure layout moves tensor composition positions and orders them without using manual figure positions', async () => {
  const ctx = await source(),
    second = await addTensorSource(ctx.store, ctx.registry);
  if (!second.ok) throw Error();
  await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: [
      ...planPlaceTensorFigure(ctx.store.getSnapshot()),
      { kind: 'move', id: ctx.id, position: { x: 800, y: 450 } },
      { kind: 'compositionMove', id: ctx.id, position: { x: 200, y: 150 } },
      { kind: 'move', id: second.value, position: { x: 1000, y: 600 } },
      { kind: 'compositionMove', id: second.value, position: { x: 200, y: 80 } },
    ],
  });
  const plan = planLayout(ctx.store.getSnapshot());
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect(plan.value.every((op) => op.kind === 'compositionMove')).toBe(true);
  expect(
    (
      await ctx.store.dispatch({
        baseRevision: ctx.store.getSnapshot().revision,
        operations: plan.value,
      })
    ).ok,
  ).toBe(true);
  const first = ctx.store.getSnapshot().entities[ctx.id],
    other = ctx.store.getSnapshot().entities[second.value];
  if (first.kind === 'edge' || other.kind === 'edge') throw Error();
  expect(first.presentation.position).toEqual({ x: 800, y: 450 });
  expect(other.presentation.position).toEqual({ x: 1000, y: 600 });
  expect(first.presentation.compositionPosition).not.toEqual({ x: 200, y: 150 });
  expect(other.presentation.compositionPosition!.y).toBeLessThan(
    first.presentation.compositionPosition!.y,
  );
  const old = planLayout(makeCoreFixture());
  expect(old.ok).toBe(true);
  if (old.ok)
    expect(old.value).toEqual([
      { kind: 'move', id: 'node-a', position: { x: 60, y: 60 } },
      { kind: 'move', id: 'node-b', position: { x: 320, y: 60 } },
    ]);
});
