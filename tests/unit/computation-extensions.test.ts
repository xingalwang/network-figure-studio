import { expect, test } from 'vitest';
import { createBuiltinRegistry, builtinPlugin } from '../../src/builtins/registry.ts';
import { createPluginRegistry } from '../../src/plugins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import {
  createProject,
  decodeProject,
  encodeProject,
  migrateProjectV3,
} from '../../src/core/document/codec.ts';
import { createGenerationServices } from '../../src/core/generation/merge.ts';
import * as computation from '../../src/core/computation/index.ts';
import {
  addTensorSource,
  appendTensorOperation,
  planPlaceTensorFigure,
} from '../../src/core/tensor-composition.ts';
import { planRemoveSelection } from '../../src/core/composition.ts';

async function setup() {
  const registry = createBuiltinRegistry();
  const store = createDocumentStore(createProject('扩展', 2), createGenerationServices(registry));
  const added = await addTensorSource(store, registry, undefined, 2);
  if (!added.ok) throw Error(added.error.message);
  const sourceId = added.value;
  const entity = store.getSnapshot().entities[sourceId];
  const params = entity.generation!.source;
  if (params.kind !== 'local') throw Error('local source expected');
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [
      {
        kind: 'generate',
        id: sourceId,
        generatorId: 'tensor.source2d',
        params: { ...params.params, H: 12, W: 10, C: 3 },
      },
    ],
  });
  return { registry, store, sourceId };
}

test('registered example computation is discoverable and creates an editable inferred operation atomically', async () => {
  const { registry, store, sourceId } = await setup();
  expect(registry).toHaveProperty('computations');
  const available = computation.listAvailableOperations(
    store.getSnapshot(),
    [sourceId],
    registry.computations,
  );
  expect(available.map((d) => d.generatorId)).toContain('example.leaky-relu');
  expect(available.map((d) => d.generatorId)).not.toContain('tensor.conv3d');
  const before = store.getSnapshot();
  const result = await appendTensorOperation(store, registry, [sourceId], 'example.leaky-relu', {
    alpha: 0.2,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const doc = store.getSnapshot();
  const report = computation.analyzeDocument(doc, registry.computations);
  expect(report.nodes[result.value.resultId].shape).toEqual({ N: 1, H: 12, W: 10, C: 3 });
  expect(report.nodes[result.value.operationId].steps.join(' ')).toContain('0.2');
  expect(doc.entities[result.value.operationId].generation?.source).toMatchObject({
    kind: 'local',
    params: { alpha: 0.2 },
  });
  expect(decodeProject(encodeProject(doc)).ok).toBe(true);
  expect(store.undo().ok).toBe(true);
  expect(store.getSnapshot().entities).toEqual(before.entities);
});

test('explicit computation maps control support and bad example parameters propagate without stale shapes', async () => {
  const { registry, store, sourceId } = await setup();
  const created = await appendTensorOperation(store, registry, [sourceId], 'example.leaky-relu');
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  const doc = structuredClone(store.getSnapshot());
  const node = doc.entities[created.value.operationId];
  if (node.generation?.source.kind !== 'local') throw Error('local operation expected');
  node.generation.source.params.alpha = -0.2;
  const report = computation.analyzeDocument(doc, registry.computations);
  expect(report.nodes[node.id].state).toBe('error');
  expect(report.nodes[node.id].diagnostics.join(' ')).toContain('alpha');
  expect(report.nodes[created.value.resultId].shape).toBeUndefined();
  node.generation.source.params.alpha = 0.1;
  node.generation.version = '2.0.0';
  const unsupported = computation.analyzeDocument(doc, registry.computations).nodes[node.id];
  expect(unsupported.state).toBe('unsupported');
  expect(unsupported.diagnostics.join(' ')).toContain('example.leaky-relu@2.0.0');
  expect(computation.analyzeDocument(doc, new Map()).nodes[sourceId].state).toBe('unsupported');
});

test('registration rejects duplicate and version-unpaired computation definitions', () => {
  const registry = createBuiltinRegistry();
  expect(registry).toHaveProperty('computations');
  const definition = registry.computations.get('tensor.relu')!;
  expect(() =>
    createPluginRegistry([
      { ...builtinPlugin, computations: [...builtinPlugin.computations!, definition] },
    ]),
  ).toThrow();
  expect(() =>
    createPluginRegistry([
      { ...builtinPlugin, computations: [{ ...definition, version: '2.0.0' }] },
    ]),
  ).toThrow();
});

test('registration rejects source inputs and ambiguous operation aliases', () => {
  const definition = builtinPlugin.computations!.find(
    (entry) => entry.generatorId === 'tensor.source2d',
  )!;
  expect(() =>
    createPluginRegistry([
      {
        ...builtinPlugin,
        computations: [
          {
            ...definition,
            inputs: () => [{ id: 'in', role: 'tensor' }],
          },
        ],
      },
    ]),
  ).toThrow();
  const duplicateAlias = builtinPlugin.computations!.map((entry) =>
    entry.generatorId === 'tensor.pool2d' ? { ...entry, kind: 'conv2d' } : entry,
  );
  expect(() =>
    createPluginRegistry([{ ...builtinPlugin, computations: duplicateAlias }]),
  ).toThrow();
});

test('a rule cannot report ready shapes with a different rank than its definition', async () => {
  const { registry, store, sourceId } = await setup();
  const definitions = new Map(registry.computations);
  const source = definitions.get('tensor.source2d')!;
  definitions.set(source.generatorId, {
    ...source,
    infer: () => ({
      state: 'ready',
      shape: { N: 1, D: 5, H: 12, W: 10, C: 3 },
      explanation: '错误规则',
      steps: [],
      diagnostics: [],
      parameterCount: 0,
    }),
  });
  const entry = computation.analyzeDocument(store.getSnapshot(), definitions).nodes[sourceId];
  expect(entry.state).toBe('error');
  expect(entry.shape).toBeUndefined();
  expect(entry.diagnostics.join(' ')).toContain('2D');
});

test('operator discovery and dimension lookup require the exact computation binding version', async () => {
  const { registry, store, sourceId } = await setup();
  const doc = structuredClone(store.getSnapshot());
  doc.entities[sourceId].generation!.paramSchemaVersion = 9;
  expect(computation.tensorDimension(doc.entities[sourceId], registry.computations)).toBeNull();
  expect(computation.tensorKind(doc.entities[sourceId], registry.computations)).toBeNull();
  expect(computation.listAvailableOperations(doc, [sourceId], registry.computations)).toEqual([]);
});

test('operation registration rejects a result generator without result computation semantics', () => {
  const definitions = builtinPlugin.computations!.map((entry) =>
    entry.generatorId === 'tensor.relu'
      ? { ...entry, operation: { ...entry.operation!, resultGeneratorId: () => 'tensor.source2d' } }
      : entry,
  );
  expect(() => createPluginRegistry([{ ...builtinPlugin, computations: definitions }])).toThrow();
});

test('unknown upstream versions never use a different rule version to judge saved output ports', async () => {
  const { registry, store, sourceId } = await setup();
  const created = await appendTensorOperation(store, registry, [sourceId], 'example.leaky-relu');
  if (!created.ok) throw Error(created.error.message);
  const doc = structuredClone(store.getSnapshot()),
    definitions = new Map(registry.computations);
  doc.entities[sourceId].generation!.version = '0.9.0';
  const sourceDefinition = definitions.get('tensor.source2d')!;
  definitions.set(sourceDefinition.generatorId, { ...sourceDefinition, outputPort: 'value' });
  const report = computation.analyzeDocument(doc, definitions);
  expect(report.nodes[sourceId].state).toBe('unsupported');
  expect(report.nodes[created.value.operationId].state).toBe('unsupported');
  expect(report.nodes[created.value.resultId].shape).toBeUndefined();
});

test('v3 structure updates add representation ports and retain used retired drawing ports without moving figures', async () => {
  const { registry, store: oldStore, sourceId } = await setup();
  const added = await addTensorSource(oldStore, registry, undefined, 2);
  const third = await addTensorSource(oldStore, registry, undefined, 2);
  if (!added.ok || !third.ok) throw Error('missing sources');
  const merged = await appendTensorOperation(oldStore, registry, [sourceId, added.value], 'concat');
  if (!merged.ok) throw Error(merged.error.message);
  await oldStore.dispatch({
    baseRevision: oldStore.getSnapshot().revision,
    operations: planPlaceTensorFigure(oldStore.getSnapshot()),
  });
  const store = createDocumentStore(
    migrateProjectV3(oldStore.getSnapshot()),
    createGenerationServices(registry),
  );
  const initial = store.getSnapshot(),
    operation = initial.entities[merged.value.operationId];
  if (operation.generation?.source.kind !== 'local') throw Error('not local');
  const figure = Object.values(initial.entities).find(
    (entity) => entity.figure?.semanticRef === operation.id,
  )!;
  if (figure.kind !== 'node') throw Error('not node');
  const customFigure = {
    ...figure,
    presentation: { ...figure.presentation, position: { x: 700, y: 400 }, fillOverride: '#abcedf' },
  };
  await store.dispatch({
    baseRevision: initial.revision,
    operations: [
      { kind: 'put', entity: customFigure },
      {
        kind: 'generate',
        id: operation.id,
        generatorId: operation.generation.generatorId,
        params: { ...operation.generation.source.params, inputCount: 3 },
      },
    ],
  });
  const incoming = Object.values(store.getSnapshot().entities).find(
    (entity) =>
      entity.kind === 'edge' &&
      entity.meaning === 'dataflow' &&
      entity.target.kind === 'port' &&
      entity.target.entityId === operation.id,
  )!;
  if (incoming.kind !== 'edge') throw Error('missing incoming');
  const extraEdge = {
    ...incoming,
    id: 'third-input',
    source: { kind: 'port' as const, entityId: third.value, portId: 'out' },
    target: { kind: 'port' as const, entityId: operation.id, portId: 'in3' },
  };
  expect(
    (
      await store.dispatch({
        baseRevision: store.getSnapshot().revision,
        operations: [{ kind: 'put', entity: extraEdge }],
      })
    ).ok,
  ).toBe(true);
  const placed = await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: planPlaceTensorFigure(store.getSnapshot()),
  });
  expect(placed.ok).toBe(true);
  const updated = store.getSnapshot().entities[figure.id];
  if (updated.kind !== 'node') throw Error('not node');
  expect(updated.ports).toHaveProperty('in3');
  expect(updated.ports.in).toEqual(figure.ports.in);
  expect(updated.presentation).toEqual(customFigure.presentation);
  expect(updated.size).toEqual(figure.size);
  expect(updated.primitives).toEqual(figure.primitives);
  const drawingEdge = {
    ...extraEdge,
    id: 'manual-port-note',
    meaning: 'annotation' as const,
    source: { kind: 'port' as const, entityId: figure.id, portId: 'in3' },
    target: { kind: 'free' as const, spaceId: null, point: { x: 800, y: 500 } },
  };
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [{ kind: 'put', entity: drawingEdge }],
  });
  const remove = planRemoveSelection(store.getSnapshot(), ['third-input']);
  if (!remove.ok) throw Error(remove.error.message);
  await store.dispatch({ baseRevision: store.getSnapshot().revision, operations: remove.value });
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [
      {
        kind: 'generate',
        id: operation.id,
        generatorId: operation.generation.generatorId,
        params: { ...operation.generation.source.params, inputCount: 2 },
      },
    ],
  });
  expect(
    (
      await store.dispatch({
        baseRevision: store.getSnapshot().revision,
        operations: planPlaceTensorFigure(store.getSnapshot()),
      })
    ).ok,
  ).toBe(true);
  expect(store.getSnapshot().entities[figure.id]).toHaveProperty('ports.in3');
  expect(store.getSnapshot().entities['manual-port-note']).toEqual(drawingEdge);
  expect(decodeProject(encodeProject(store.getSnapshot())).ok).toBe(true);
});
