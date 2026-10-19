import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import {
  createGenerationServices,
  detachGeneration,
  getGenerationParams,
} from '../../src/core/generation/merge.ts';
import { validateDocument } from '../../src/core/document/validate.ts';
import { executePluginCommand } from '../../src/plugins/execute.ts';
import { makeCoreFixture, makeEmptyProject } from '../fixtures/project.ts';
import type {
  EdgeEntity,
  NodeEntity,
  Params,
  ProjectDocument,
  Result,
} from '../../src/plugins/sdk.ts';

function value<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

async function generateResidual() {
  const registry = createBuiltinRegistry();
  const generator = registry.generators.get('example.residual')!;
  const store = createDocumentStore(makeEmptyProject(), createGenerationServices(registry));
  const result = await store.dispatch({
    baseRevision: 0,
    operations: [
      {
        kind: 'generate',
        id: 'residual',
        generatorId: generator.id,
        params: generator.defaults,
        position: { x: 70, y: 80 },
      },
    ],
  });
  assert.equal(result.ok, true, result.ok ? '' : result.error.message);
  return { registry, generator, store };
}

test('built-in registry generates a labelled, port-connected residual block with editable child slots', async () => {
  const { registry, store } = await generateResidual();
  const doc = store.getSnapshot(),
    root = doc.entities.residual;
  assert.equal(validateDocument(doc).ok, true);
  assert.equal(root.kind, 'group');
  if (root.kind !== 'group') return;
  assert.ok(root.size.width >= 750 && root.size.width <= 790);
  assert.equal(root.size.height, 250);
  assert.deepEqual(root.presentation.position, { x: 70, y: 80 });
  const keys = root.generation!.localKeys;
  assert.equal(Object.values(doc.entities).filter((e) => e.kind === 'node').length, 6);
  assert.equal((doc.entities[keys['block-0/skip']] as EdgeEntity).target.kind, 'port');
  assert.deepEqual(root.ports.in, { entityId: keys.input, portId: 'in' });
  assert.deepEqual(root.ports.out, { entityId: keys.output, portId: 'out' });
  for (const key of [
    'input',
    'block-0/conv-1',
    'block-0/relu',
    'block-0/conv-2',
    'block-0/add',
    'output',
  ]) {
    const node = doc.entities[keys[key]] as NodeEntity;
    assert.equal(node.parentId, root.id);
    assert.equal(node.generation!.source.kind, 'slot');
    assert.deepEqual(node.generation!.localKeys, { root: node.id });
    assert.equal(node.generation!.version, '1.0.0');
    assert.equal(node.generation!.paramSchemaVersion, 1);
    assert.ok(node.primitives.some((p) => p.kind === 'text'));
    const params = value(getGenerationParams(doc, node.id, registry));
    const regenerated = await registry.generators
      .get(node.generation!.generatorId)!
      .generate(params, doc.theme);
    assert.deepEqual((regenerated.entities.root as NodeEntity).primitives, node.primitives);
    assert.deepEqual((regenerated.entities.root as NodeEntity).ports, node.ports);
  }
  assert.equal(value(getGenerationParams(doc, keys.input, registry)).stackCount, 3);
  assert.equal(value(getGenerationParams(doc, keys['block-0/conv-1'], registry)).stackCount, 1);
  assert.equal(value(getGenerationParams(doc, keys['block-0/relu'], registry)).mode, 'flat');
  assert.ok(
    (doc.entities[keys['block-0/conv-1']] as NodeEntity).primitives.some(
      (p) => p.kind === 'text' && p.text === '64 ch',
    ),
  );
  const fragment = await registry.generators
    .get('example.residual')!
    .generate(registry.generators.get('example.residual')!.defaults, doc.theme);
  assert.equal(fragment.rootKey, 'root');
  for (const [key, entity] of Object.entries(fragment.entities)) assert.equal(entity.id, key);
  assert.equal(store.undo().ok, true);
  assert.deepEqual(store.getSnapshot().entities, {});
  assert.equal(store.redo().ok, true);
  assert.deepEqual(store.getSnapshot().entities, doc.entities);
});

test('parent parameter edits retain stable IDs, explicit child overrides, manual positions and routes', async () => {
  const { registry, generator, store } = await generateResidual();
  let doc = store.getSnapshot();
  const keys = structuredClone(doc.entities.residual.generation!.localKeys);
  const childId = keys['block-0/conv-1'];
  const childParams = value(getGenerationParams(doc, childId, registry));
  let result = await store.dispatch({
    baseRevision: doc.revision,
    operations: [
      {
        kind: 'generate',
        id: childId,
        generatorId: 'builtin.conv',
        params: { ...childParams, channels: 96, mode: 'flat', label: 'Custom Conv' },
      },
    ],
  });
  assert.equal(result.ok, true);
  doc = store.getSnapshot();
  const route: EdgeEntity['route'] = {
    kind: 'orthogonal',
    mode: 'manual',
    points: [
      { x: 125, y: 18 },
      { x: 575, y: 18 },
    ],
    spaceId: 'residual',
  };
  result = await store.dispatch({
    baseRevision: doc.revision,
    operations: [
      { kind: 'move', id: childId, position: { x: 185, y: 99 } },
      { kind: 'label', id: childId, text: 'Preserved label' },
      { kind: 'route', id: keys['block-0/skip'], route },
    ],
  });
  assert.equal(result.ok, true);
  doc = store.getSnapshot();
  const parentParams = value(getGenerationParams(doc, 'residual', registry));
  result = await store.dispatch({
    baseRevision: doc.revision,
    operations: [
      {
        kind: 'generate',
        id: 'residual',
        generatorId: generator.id,
        params: { ...parentParams, channels: 128, angleDeg: 45 },
      },
    ],
  });
  assert.equal(result.ok, true, result.ok ? '' : result.error.message);
  doc = store.getSnapshot();
  assert.deepEqual(doc.entities.residual.generation!.localKeys, keys);
  assert.equal(value(getGenerationParams(doc, keys.input, registry)).channels, 128);
  assert.equal(value(getGenerationParams(doc, keys.input, registry)).angleDeg, 45);
  const child = doc.entities[childId] as NodeEntity;
  const effective = value(getGenerationParams(doc, childId, registry));
  assert.equal(effective.channels, 96);
  assert.equal(effective.mode, 'flat');
  assert.equal(effective.label, 'Custom Conv');
  assert.deepEqual(child.presentation.position, { x: 185, y: 99 });
  assert.equal(child.presentation.labelOverride, 'Preserved label');
  assert.deepEqual((doc.entities[keys['block-0/skip']] as EdgeEntity).route, route);
  assert.equal(validateDocument(doc).ok, true);
});

test('detaching a residual group leaves each layer independently parametric and preserves connections', async () => {
  const { registry, store } = await generateResidual();
  let doc = store.getSnapshot();
  const keys = doc.entities.residual.generation!.localKeys,
    childId = keys['block-0/conv-1'];
  const connections = Object.fromEntries(
    Object.entries(doc.entities).filter(([, e]) => e.kind === 'edge'),
  );
  const operations = value(detachGeneration(doc, 'residual', registry));
  assert.equal((await store.dispatch({ baseRevision: doc.revision, operations })).ok, true);
  doc = store.getSnapshot();
  assert.equal(doc.entities.residual.generation, undefined);
  assert.equal(doc.entities[childId].generation!.source.kind, 'local');
  const params = value(getGenerationParams(doc, childId, registry));
  const edited = await store.dispatch({
    baseRevision: doc.revision,
    operations: [
      {
        kind: 'generate',
        id: childId,
        generatorId: 'builtin.conv',
        params: { ...params, channels: 256, mode: 'flat' },
      },
    ],
  });
  assert.equal(edited.ok, true, edited.ok ? '' : edited.error.message);
  doc = store.getSnapshot();
  assert.equal(value(getGenerationParams(doc, childId, registry)).channels, 256);
  assert.equal(doc.entities[childId].parentId, 'residual');
  assert.deepEqual(
    Object.fromEntries(Object.entries(doc.entities).filter(([, e]) => e.kind === 'edge')),
    connections,
  );
  assert.equal(validateDocument(doc).ok, true);
});

test('additional repeats reuse stable first-block keys and create a connected residual chain', async () => {
  const { registry, generator, store } = await generateResidual();
  const firstKeys = store.getSnapshot().entities.residual.generation!.localKeys;
  const result = await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [
      {
        kind: 'generate',
        id: 'residual',
        generatorId: generator.id,
        params: { ...generator.defaults, repeats: 2 },
      },
    ],
  });
  assert.equal(result.ok, true, result.ok ? '' : result.error.message);
  const doc = store.getSnapshot(),
    keys = doc.entities.residual.generation!.localKeys;
  for (const key of Object.keys(firstKeys)) assert.equal(keys[key], firstKeys[key]);
  assert.equal(Object.values(doc.entities).filter((e) => e.kind === 'node').length, 10);
  const skip = doc.entities[keys['block-1/skip']] as EdgeEntity;
  assert.deepEqual(skip.source, { kind: 'port', entityId: keys['block-0/add'], portId: 'out' });
  assert.equal(validateDocument(doc).ok, true);
  assert.equal(value(getGenerationParams(doc, keys['block-1/conv-1'], registry)).channels, 64);
});

test('flat / axonometric round trip keeps latent appearance values, identities and ports', async () => {
  const { registry, generator, store } = await generateResidual();
  const before = store.getSnapshot(),
    keys = before.entities.residual.generation!.localKeys;
  for (const mode of ['flat', 'axonometric']) {
    const result = await store.dispatch({
      baseRevision: store.getSnapshot().revision,
      operations: [
        {
          kind: 'generate',
          id: 'residual',
          generatorId: generator.id,
          params: { ...generator.defaults, mode },
        },
      ],
    });
    assert.equal(result.ok, true, result.ok ? '' : result.error.message);
    const doc = store.getSnapshot();
    assert.deepEqual(doc.entities.residual.generation!.localKeys, keys);
    const params = value(getGenerationParams(doc, keys.input, registry));
    assert.equal(params.mode, mode);
    assert.equal(params.depth, 24);
    assert.equal(params.stackCount, 3);
    assert.equal(params.angleDeg, 30);
    for (const id of Object.values(keys)) {
      const old = before.entities[id],
        current = doc.entities[id];
      if (old.kind !== 'edge' && current.kind !== 'edge')
        assert.deepEqual(current.ports, old.ports);
    }
  }
  const after = store.getSnapshot();
  assert.deepEqual(
    (after.entities[keys.input] as NodeEntity).primitives,
    (before.entities[keys.input] as NodeEntity).primitives,
  );
});

test('invalid slot parameters cannot commit a partially generated residual block', async () => {
  const { generator, store } = await generateResidual();
  const before = store.getSnapshot();
  const result = await store.dispatch({
    baseRevision: before.revision,
    operations: [
      {
        kind: 'generate',
        id: 'residual',
        generatorId: generator.id,
        params: { ...generator.defaults, __slots: { 'block-0/conv-1': { channels: -1 } } },
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(store.getSnapshot(), before);
});

function distributionFixture(): ProjectDocument {
  const doc = makeCoreFixture();
  const first = doc.entities['node-a'] as NodeEntity,
    last = doc.entities['node-b'] as NodeEntity;
  first.size.width = 40;
  last.presentation.position.x = 520;
  doc.entities.middle = {
    ...structuredClone(first),
    id: 'middle',
    size: { width: 120, height: 60 },
    presentation: { position: { x: 240, y: 240 }, scale: 1.5 },
  };
  return doc;
}

test('distribute command spaces centers, preserves endpoints and y, and is one undoable proposal', async () => {
  const registry = createBuiltinRegistry(),
    initial = distributionFixture();
  const store = createDocumentStore(initial);
  const command = registry.commands.get('example.distribute-x')!;
  assert.deepEqual(command.permissions, ['move']);
  const selection = ['node-b', 'middle', 'node-a'];
  assert.equal(command.isAvailable(initial, selection), true);
  const proposal = await command.run(initial, selection, {});
  assert.equal(proposal.operations.length, 1);
  const result = await executePluginCommand(store, registry, command.id, selection, {});
  assert.equal(result.ok, true, result.ok ? '' : result.error.message);
  const doc = store.getSnapshot(),
    middle = doc.entities.middle as NodeEntity;
  assert.equal(
    middle.presentation.position.x + (middle.size.width * middle.presentation.scale!) / 2,
    (140 + 560) / 2,
  );
  assert.equal(middle.presentation.position.y, 240);
  assert.deepEqual(doc.entities['node-a'], initial.entities['node-a']);
  assert.deepEqual(doc.entities['node-b'], initial.entities['node-b']);
  assert.equal(doc.revision, initial.revision + 1);
  assert.equal(store.undo().ok, true);
  assert.deepEqual(store.getSnapshot().entities, initial.entities);
  assert.equal(store.canUndo(), false);
});

test('distribution rejects invalid, locked, mixed-parent and edge selections without modifying the document', async () => {
  const registry = createBuiltinRegistry(),
    doc = distributionFixture();
  const command = registry.commands.get('example.distribute-x')!;
  for (const selection of [
    ['node-a', 'node-b'],
    ['node-a', 'middle', 'missing'],
    ['node-a', 'node-a', 'middle'],
    ['node-a', 'middle', 'edge'],
  ]) {
    assert.equal(command.isAvailable(doc, selection), false);
  }
  doc.entities.middle.locked = true;
  assert.equal(command.isAvailable(doc, ['node-a', 'middle', 'node-b']), false);
  delete doc.entities.middle.locked;
  doc.entities.middle.parentId = 'different-group';
  assert.equal(command.isAvailable(doc, ['node-a', 'middle', 'node-b']), false);
  const store = createDocumentStore(makeCoreFixture());
  const before = store.getSnapshot();
  const result = await executePluginCommand(
    store,
    registry,
    command.id,
    ['node-a', 'node-b', 'edge'],
    {},
  );
  assert.equal(result.ok, false);
  assert.equal(store.getSnapshot(), before);
});

test('standalone built-in layers generate through the registry and retain explicit parameters', async () => {
  const registry = createBuiltinRegistry();
  for (const id of [
    'builtin.feature',
    'builtin.input',
    'builtin.output',
    'builtin.conv',
    'builtin.relu',
    'builtin.add',
  ]) {
    const generator = registry.generators.get(id)!;
    const store = createDocumentStore(makeEmptyProject(), createGenerationServices(registry));
    const params: Params = { ...generator.defaults, channels: 128, label: 'Custom', angleDeg: 45 };
    const result = await store.dispatch({
      baseRevision: 0,
      operations: [{ kind: 'generate', id: 'layer', generatorId: id, params }],
    });
    assert.equal(result.ok, true, result.ok ? '' : result.error.message);
    assert.deepEqual(value(getGenerationParams(store.getSnapshot(), 'layer', registry)), params);
    assert.equal(store.getSnapshot().entities.layer.kind, 'node');
    assert.equal(validateDocument(store.getSnapshot()).ok, true);
  }
});

test('editing only child mode does not freeze inherited channels', async () => {
  const registry = createBuiltinRegistry(),
    store = createDocumentStore(makeEmptyProject(), createGenerationServices(registry));
  const g = registry.generators.get('example.residual')!;
  await store.dispatch({
    baseRevision: 0,
    operations: [{ kind: 'generate', id: 'root-instance', generatorId: g.id, params: g.defaults }],
  });
  const child = Object.values(store.getSnapshot().entities).find(
    (e) => e.generation?.generatorId === 'builtin.conv',
  )!;
  const p = getGenerationParams(store.getSnapshot(), child.id, registry);
  if (!p.ok) throw Error(p.error.message);
  await store.dispatch({
    baseRevision: 1,
    operations: [
      {
        kind: 'generate',
        id: child.id,
        generatorId: 'builtin.conv',
        params: { ...p.value, mode: 'flat' },
      },
    ],
  });
  const root = store.getSnapshot().entities['root-instance'];
  if (root.generation?.source.kind !== 'local') throw Error();
  await store.dispatch({
    baseRevision: 2,
    operations: [
      {
        kind: 'generate',
        id: root.id,
        generatorId: g.id,
        params: { ...root.generation.source.params, channels: 128 },
      },
    ],
  });
  const next = getGenerationParams(store.getSnapshot(), child.id, registry);
  assert.ok(next.ok);
  if (next.ok) {
    assert.equal(next.value.mode, 'flat');
    assert.equal(next.value.channels, 128);
  }
});

test('import validation rejects generated local keys that steal unrelated entities or duplicate identities', async () => {
  const { store } = await generateResidual();
  const d = structuredClone(store.getSnapshot()),
    a = d.entities.residual;
  const outsider = structuredClone(
    Object.values(d.entities).find((e) => e.kind === 'node')!,
  ) as NodeEntity;
  outsider.id = 'unrelated';
  outsider.parentId = null;
  delete outsider.generation;
  d.entities.unrelated = outsider;
  a.generation!.localKeys['block-0/conv-1'] = 'unrelated';
  assert.equal(validateDocument(d).ok, false);
  const duplicate = structuredClone(store.getSnapshot());
  duplicate.entities.residual.generation!.localKeys['duplicate'] =
    duplicate.entities.residual.generation!.localKeys['block-0/conv-1'];
  assert.equal(validateDocument(duplicate).ok, false);
});
