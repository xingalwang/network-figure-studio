import { expect, test } from 'vitest';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createProject, decodeProject, encodeProject } from '../../src/core/document/codec.ts';
import { createGenerationServices, getGenerationParams } from '../../src/core/generation/merge.ts';
import { analyzeDocument } from '../../src/core/computation/index.ts';
import * as computation from '../../src/core/computation/index.ts';
import { addTensorSource, appendTensorOperation } from '../../src/core/tensor-composition.ts';
import type { Params } from '../../src/core/document/types.ts';

function setup() {
  const registry = createBuiltinRegistry();
  return {
    registry,
    store: createDocumentStore(createProject('2D', 2), createGenerationServices(registry)),
  };
}
async function change(ctx: ReturnType<typeof setup>, id: string, params: Params) {
  const previous = getGenerationParams(ctx.store.getSnapshot(), id, ctx.registry);
  if (!previous.ok) throw Error(previous.error.message);
  const result = await ctx.store.dispatch({
    baseRevision: ctx.store.getSnapshot().revision,
    operations: [
      {
        kind: 'generate',
        id,
        generatorId: ctx.store.getSnapshot().entities[id].generation!.generatorId,
        params: { ...previous.value, ...params },
      },
    ],
  });
  expect(result.ok).toBe(true);
}
async function source(ctx: ReturnType<typeof setup>, dimension: 2 | 3 = 2) {
  const result = await addTensorSource(ctx.store, ctx.registry, undefined, dimension);
  if (!result.ok) throw Error(result.error.message);
  await change(ctx, result.value, {
    N: 1,
    H: 32,
    W: 32,
    C: 3,
    ...(dimension === 3 ? { D: 32 } : {}),
  });
  return result.value;
}
async function append(
  ctx: ReturnType<typeof setup>,
  ids: string[],
  kind: Parameters<typeof appendTensorOperation>[3],
  params: Params = {},
) {
  const result = await appendTensorOperation(ctx.store, ctx.registry, ids, kind, params);
  if (!result.ok) throw Error(result.error.message);
  return result.value;
}

test('true 2D pipeline computes convolution parameters, pooling, ReLU and per-axis nearest upsample', async () => {
  const ctx = setup(),
    id = await source(ctx);
  expect(ctx.store.getSnapshot().entities[id].generation?.generatorId).toBe('tensor.source2d');
  const conv = await append(ctx, [id], 'conv2d', { outChannels: 8 });
  const pool = await append(ctx, [conv.resultId], 'pool2d');
  const relu = await append(ctx, [pool.resultId], 'relu');
  const up = await append(ctx, [relu.resultId], 'upsample');
  const report = analyzeDocument(ctx.store.getSnapshot()).nodes;
  expect(report[conv.operationId].parameterCount).toBe(224);
  expect(report[conv.operationId].steps.join(' ')).toContain('8 × (3 × 3 × 3 + 1) = 224');
  expect(report[pool.resultId].shape).toEqual({ N: 1, H: 16, W: 16, C: 8 });
  expect(report[relu.resultId].shape).toEqual(report[pool.resultId].shape);
  expect(report[up.resultId].shape).toEqual({ N: 1, H: 32, W: 32, C: 8 });
  expect(report[up.operationId].parameterCount).toBe(0);
  expect(report[up.operationId].explanation).toContain('最近邻');
  expect(ctx.store.getSnapshot().entities[up.resultId].generation?.generatorId).toBe(
    'tensor.result2d',
  );
  expect(decodeProject(encodeProject(ctx.store.getSnapshot())).ok).toBe(true);
  await change(ctx, up.operationId, { scaleH: 3, scaleW: 4 });
  expect(analyzeDocument(ctx.store.getSnapshot()).nodes[up.resultId].shape).toEqual({
    N: 1,
    H: 48,
    W: 64,
    C: 8,
  });
});

test('dimension helper classifies old/new sources, results and generic operation parameters', async () => {
  const ctx = setup(),
    id = await source(ctx),
    old = await source(ctx, 3);
  const relu = await append(ctx, [id], 'relu');
  expect(computation.tensorDimension(ctx.store.getSnapshot().entities[id])).toBe(2);
  expect(computation.tensorDimension(ctx.store.getSnapshot().entities[old])).toBe(3);
  expect(computation.tensorDimension(ctx.store.getSnapshot().entities[relu.operationId])).toBe(2);
  expect(computation.tensorDimension(ctx.store.getSnapshot().entities[relu.resultId])).toBe(2);
  expect(computation.tensorKind(ctx.store.getSnapshot().entities[id])).toBe('source');
  expect(computation.tensorDimension(undefined)).toBe(null);
});

test('mixed-rank merge and wrong-rank operation are rejected atomically', async () => {
  const ctx = setup(),
    two = await source(ctx),
    three = await source(ctx, 3),
    before = ctx.store.getSnapshot();
  for (const kind of ['concat', 'add'] as const) {
    const result = await appendTensorOperation(ctx.store, ctx.registry, [two, three], kind);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/2D|秩|维度/);
  }
  expect((await appendTensorOperation(ctx.store, ctx.registry, [two], 'conv3d')).ok).toBe(false);
  expect(ctx.store.getSnapshot()).toBe(before);
});

test('2D concat supports actual axes, rejects absent D; Add never broadcasts', async () => {
  const ctx = setup(),
    a = await source(ctx),
    b = await source(ctx);
  const concat = await append(ctx, [a, b], 'concat', { axis: 'N' }),
    add = await append(ctx, [a, b], 'add');
  expect(analyzeDocument(ctx.store.getSnapshot()).nodes[concat.resultId].shape).toEqual({
    N: 2,
    H: 32,
    W: 32,
    C: 3,
  });
  expect(analyzeDocument(ctx.store.getSnapshot()).nodes[add.resultId].shape).toEqual({
    N: 1,
    H: 32,
    W: 32,
    C: 3,
  });
  await change(ctx, concat.operationId, { axis: 'D' });
  expect(
    analyzeDocument(ctx.store.getSnapshot()).nodes[concat.operationId].diagnostics.join(' '),
  ).toContain('D');
  expect(analyzeDocument(ctx.store.getSnapshot()).nodes[concat.resultId].shape).toBeUndefined();
  await change(ctx, b, { C: 1 });
  expect(
    analyzeDocument(ctx.store.getSnapshot()).nodes[add.operationId].diagnostics.join(' '),
  ).toContain('C');
});

test('loaded mixed ranks and mismatched result rank never expose an output', async () => {
  const ctx = setup(),
    a = await source(ctx),
    b = await source(ctx),
    merged = await append(ctx, [a, b], 'concat');
  const doc = structuredClone(ctx.store.getSnapshot());
  doc.entities[b].generation!.generatorId = 'tensor.source3d';
  if (doc.entities[b].generation!.source.kind === 'local')
    doc.entities[b].generation!.source.params.D = 1;
  const report = analyzeDocument(doc).nodes;
  expect(report[merged.operationId].state).toBe('error');
  expect(report[merged.operationId].diagnostics.join(' ')).toMatch(/秩|2D/);
  expect(report[merged.resultId].shape).toBeUndefined();
  const other = structuredClone(ctx.store.getSnapshot());
  other.entities[merged.resultId].generation!.generatorId = 'tensor.result3d';
  expect(analyzeDocument(other).nodes[merged.resultId].state).toBe('error');
});

test('upsample requires positive integer scales, reports pending and integer overflow without stale output', async () => {
  const ctx = setup(),
    id = await source(ctx),
    up = await append(ctx, [id], 'upsample');
  for (const value of [null, 0, 1.5]) {
    const doc = structuredClone(ctx.store.getSnapshot()),
      op = doc.entities[up.operationId];
    if (op.generation!.source.kind === 'local') op.generation!.source.params.scaleH = value;
    const report = analyzeDocument(doc).nodes;
    expect(report[up.operationId].state).toBe(value === null ? 'pending' : 'error');
    expect(report[up.resultId].shape).toBeUndefined();
  }
  const doc = structuredClone(ctx.store.getSnapshot()),
    op = doc.entities[up.operationId];
  if (op.generation!.source.kind === 'local')
    op.generation!.source.params.scaleH = Number.MAX_SAFE_INTEGER;
  expect(analyzeDocument(doc).nodes[up.operationId].state).toBe('error');
});

test('generic 3D ReLU and upsample preserve channels, use all three spatial scales and undo atomically', async () => {
  const ctx = setup(),
    id = await source(ctx, 3),
    relu = await append(ctx, [id], 'relu'),
    before = ctx.store.getSnapshot();
  const up = await append(ctx, [relu.resultId], 'upsample', { scaleD: 3, scaleH: 2, scaleW: 4 });
  expect(analyzeDocument(ctx.store.getSnapshot()).nodes[up.resultId].shape).toEqual({
    N: 1,
    D: 96,
    H: 64,
    W: 128,
    C: 3,
  });
  ctx.store.undo();
  expect(ctx.store.getSnapshot().entities).toEqual(before.entities);
  ctx.store.redo();
  expect(analyzeDocument(ctx.store.getSnapshot()).nodes[up.resultId].state).toBe('ready');
});

test('invalid operation parameters retain real input shapes for the diagnostic inspector', async () => {
  const ctx = setup(),
    id = await source(ctx),
    up = await append(ctx, [id], 'upsample', { scaleH: null });
  const entry = analyzeDocument(ctx.store.getSnapshot()).nodes[up.operationId];
  expect(entry.state).toBe('pending');
  expect(entry.inputs).toEqual([
    { entityId: id, portId: 'in', shape: { N: 1, H: 32, W: 32, C: 3 } },
  ]);
});
