import { expect, test } from 'vitest';
import { tensorGridGeometry, finalizeTensorFigure } from '../../src/graphics/tensor-grid.ts';
import { tensorVisual } from '../../src/graphics/tensor-visual.ts';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import {
  createProject,
  decodeProject,
  encodeProject,
  migrateProjectV3,
} from '../../src/core/document/codec.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createGenerationServices, getGenerationParams } from '../../src/core/generation/merge.ts';
import { addTensorSource, planPlaceTensorFigure } from '../../src/core/tensor-composition.ts';
import { analyzeDocument } from '../../src/core/computation/index.ts';
import { planAddFigureRepresentation } from '../../src/core/figure/index.ts';
import { planUpdateFigureAppearance } from '../../src/graphics/figure-appearance.ts';
import { createBuildActions } from '../../src/app/editor/build-actions.ts';
import {
  writeParameterDraft,
  type ParameterDraftCache,
} from '../../src/app/editor/parameter-drafts.ts';
import type { NodeEntity, Params } from '../../src/core/document/types.ts';

const shape = { N: 1, H: 16, W: 32, C: 8 };
const lines = (node: NodeEntity) =>
  node.primitives.filter((p) => p.kind === 'polygon' && p.strokeWidth === 0 && p.opacity === 0.55)
    .length;

test('2D uses W H C and 3D uses W H D with one common two-pixel unit', () => {
  const plane = tensorGridGeometry(shape, {}),
    volume = tensorGridGeometry({ ...shape, D: 4, C: 999 }, {});
  expect(plane.ok).toBe(true);
  expect(volume.ok).toBe(true);
  if (!plane.ok || !volume.ok) return;
  expect(plane.value.size).toEqual({ width: 64, height: 32 });
  expect(plane.value.depth).toBe(16);
  expect(volume.value.size).toEqual({ width: 64, height: 32 });
  expect(volume.value.depth).toBe(8);
  const scaled = tensorGridGeometry(shape, { displayScale: 2, displayH: 0.5, displayC: 2 });
  if (!scaled.ok) throw Error(scaled.error.message);
  expect(scaled.value.size).toEqual({ width: 128, height: 32 });
  expect(scaled.value.depth).toBe(64);
});

test('extreme shapes compress continuously, keep bounded grids and never invent unknown extents', () => {
  const huge = tensorGridGeometry(
    { N: 1, D: 1000000, H: 1000000, W: 1000000, C: 16 },
    { displayScale: 4, displayD: 4 },
  );
  if (!huge.ok) throw Error(huge.error.message);
  expect(huge.value.compressed).toBe(true);
  expect(huge.value.simplified).toBe(true);
  expect(huge.value.size.width).toBeLessThan(192);
  expect(huge.value.depth).toBeLessThan(192);
  expect(huge.value.primitives.length).toBeLessThan(80);
  for (const bad of [null, NaN, -1])
    expect(tensorGridGeometry({ ...shape, W: bad }, {}).ok).toBe(false);
  const below = tensorGridGeometry({ ...shape, W: 64 }, {}),
    above = tensorGridGeometry({ ...shape, W: 64.0001 }, {});
  if (!below.ok || !above.ok) throw Error('mapping');
  expect(above.value.size.width - below.value.size.width).toBeGreaterThan(0);
  expect(above.value.size.width - below.value.size.width).toBeLessThan(0.001);
});

async function setup() {
  const registry = createBuiltinRegistry(),
    store = createDocumentStore(createProject('网格', 2), createGenerationServices(registry));
  const added = await addTensorSource(store, registry, { x: 40, y: 60 }, 2);
  if (!added.ok) throw Error(added.error.message);
  const official = getGenerationParams(store.getSnapshot(), added.value, registry);
  if (!official.ok) throw Error(official.error.message);
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [
      {
        kind: 'generate',
        id: added.value,
        generatorId: 'tensor.source2d',
        params: { ...official.value, H: 12, W: 10, C: 4 },
      },
    ],
  });
  return { registry, store, id: added.value };
}

test('new objects opt into auto while old missing settings retain manual figure geometry', async () => {
  const { registry, store, id } = await setup();
  const node = store.getSnapshot().entities[id] as NodeEntity;
  expect(node.generation?.source).toHaveProperty('params.displayMode', 'auto');
  const legacy = structuredClone(store.getSnapshot()),
    old = legacy.entities[id] as NodeEntity;
  if (old.generation?.source.kind !== 'local') throw Error('source');
  delete old.generation.source.params.displayMode;
  const before = structuredClone(old);
  const finalized = finalizeTensorFigure(
    legacy,
    planPlaceTensorFigure(legacy),
    registry.computations,
  );
  const put = finalized.find((operation) => operation.kind === 'put' && operation.entity.id === id);
  if (put?.kind !== 'put' || put.entity.kind !== 'node') throw Error('placement');
  expect(put.entity.primitives).toEqual(before.primitives);
  expect(put.entity.size).toEqual(before.size);
  const report = analyzeDocument(legacy, registry.computations),
    visual = tensorVisual(legacy, old, report, 'figure', 'dark', registry.computations);
  expect(visual.primitives.some((p) => p.kind === 'rect' && p.width === 112)).toBe(true);
  const legacyStructure = tensorVisual(
    legacy,
    old,
    report,
    'structure',
    'dark',
    registry.computations,
  );
  expect(lines({ ...old, primitives: legacyStructure.primitives })).toBe(0);
  const manualDoc = structuredClone(legacy),
    manual = manualDoc.entities[id] as NodeEntity;
  if (manual.generation?.source.kind !== 'local') throw Error('source');
  Object.assign(manual.generation.source.params, {
    displayMode: 'manual',
    depth: 30,
    angleDeg: 45,
  });
  manual.size = { width: 80, height: 60 };
  const manualVisual = tensorVisual(
    manualDoc,
    manual,
    analyzeDocument(manualDoc, registry.computations),
    'structure',
    'dark',
    registry.computations,
  );
  expect(manualVisual.primitives).toContainEqual(
    expect.objectContaining({ kind: 'rect', width: 80, height: 60 }),
  );
  expect(lines({ ...manual, primitives: manualVisual.primitives })).toBeGreaterThan(0);
  expect(analyzeDocument(manualDoc, registry.computations).nodes[id].shape).toEqual({
    N: 1,
    H: 12,
    W: 10,
    C: 4,
  });
  const manualPlacement = finalizeTensorFigure(
    manualDoc,
    planPlaceTensorFigure(manualDoc),
    registry.computations,
  ).find((operation) => operation.kind === 'put' && operation.entity.id === id);
  if (manualPlacement?.kind !== 'put' || manualPlacement.entity.kind !== 'node')
    throw Error('manual placement');
  expect(manualPlacement.entity.size).toEqual({ width: 80, height: 60 });
  expect(lines(manualPlacement.entity)).toBeGreaterThan(0);
  if (manualPlacement.entity.generation?.source.kind !== 'local') throw Error('manual binding');
  expect(manualPlacement.entity.generation.source.params.angleDeg).toBe(45);
  expect(manualPlacement.entity.ports.out).toEqual({
    x: 80 + 30 * Math.cos(Math.PI / 4),
    y: 30 - (30 * Math.sin(Math.PI / 4)) / 2,
  });
});

test('v2 structure builds and display multipliers retain placed grids and commit only their own section', async () => {
  const { registry, store, id } = await setup();
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: finalizeTensorFigure(
      store.getSnapshot(),
      planPlaceTensorFigure(store.getSnapshot()),
      registry.computations,
    ),
  });
  const implicitVisible = structuredClone(store.getSnapshot().entities[id]);
  delete implicitVisible.figureState;
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [{ kind: 'put', entity: implicitVisible }],
  });
  const before = store.getSnapshot().entities[id] as NodeEntity;
  expect(before.size).toEqual({ width: 20, height: 24 });
  expect(lines(before)).toBeGreaterThan(0);
  const official = getGenerationParams(store.getSnapshot(), id, registry);
  if (!official.ok) throw Error(official.error.message);
  const drafts: ParameterDraftCache = new Map();
  writeParameterDraft(drafts, id, official.value, { ...official.value, H: 24, displayScale: 2 });
  const errors: string[] = [],
    actions = createBuildActions({
      store,
      registry,
      drafts,
      onChanged() {},
      onError(message) {
        errors.push(message);
      },
    });
  expect(await actions.buildStructure()).toBe(true);
  const built = store.getSnapshot().entities[id] as NodeEntity;
  expect(built.generation?.source).toHaveProperty('params.H', 24);
  expect(built.generation?.source).toHaveProperty('params.displayScale', 1);
  expect(built.primitives).toEqual(before.primitives);
  expect(built.size).toEqual(before.size);
  expect(built.figureState).toBeUndefined();
  expect(await actions.applyAppearance(id)).toBe(true);
  expect(store.getSnapshot().entities[id].generation?.source).toHaveProperty(
    'params.displayScale',
    2,
  );
  expect((store.getSnapshot().entities[id] as NodeEntity).primitives).toEqual(before.primitives);
  expect(decodeProject(encodeProject(store.getSnapshot())).ok).toBe(true);
  expect(errors).toEqual([]);
});

test('new representations get independent grids and manual resizing keeps their grid strokes', async () => {
  const { registry, store, id } = await setup(),
    doc = migrateProjectV3(store.getSnapshot());
  const addition = planAddFigureRepresentation(doc, id, { x: 400, y: 200 });
  if (!addition.ok) throw Error(addition.error.message);
  const modern = createDocumentStore(doc),
    operations = finalizeTensorFigure(doc, addition.value.operations, registry.computations);
  await modern.dispatch({ baseRevision: doc.revision, operations });
  const before = modern.getSnapshot(),
    figure = before.entities[addition.value.id] as NodeEntity;
  expect(figure.size).toEqual({ width: 20, height: 24 });
  expect(figure.figure?.tensorProjection).toEqual({ depth: 8, angleDeg: 30 });
  const changed = planUpdateFigureAppearance(before, figure.id, {
    drawWidth: 80,
    drawHeight: 60,
    depth: 30,
    angleDeg: 45,
  });
  if (!changed.ok) throw Error(changed.error.message);
  await modern.dispatch({ baseRevision: before.revision, operations: changed.value });
  const after = modern.getSnapshot();
  expect(lines(after.entities[figure.id] as NodeEntity)).toBe(lines(figure));
  expect(after.entities[id]).toEqual(before.entities[id]);
  expect((after.entities[figure.id] as NodeEntity).presentation.position).toEqual({
    x: 400,
    y: 200,
  });
});
