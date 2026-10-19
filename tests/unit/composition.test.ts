import { test, expect } from 'vitest';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createGenerationServices } from '../../src/core/generation/merge.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createProject } from '../../src/core/document/codec.ts';
import { addPrimitive, planRemoveSelection, planLayout } from '../../src/core/composition.ts';
import { executeConnectionPattern } from '../../src/plugins/connections.ts';
test('ordinary primitive nodes stay independent, connectable and removable without detaching', async () => {
  const registry = createBuiltinRegistry(),
    store = createDocumentStore(createProject(), createGenerationServices(registry));
  const a = await addPrimitive(store, registry, 'builtin.conv'),
    b = await addPrimitive(store, registry, 'builtin.pool');
  expect(a.ok && b.ok).toBe(true);
  if (!a.ok || !b.ok) return;
  const result = await executeConnectionPattern(
    store,
    registry,
    'builtin.chain',
    [a.value, b.value],
    {},
  );
  expect(result.ok).toBe(true);
  const doc = store.getSnapshot();
  expect(doc.entities[a.value].parentId).toBeNull();
  const removal = planRemoveSelection(doc, [a.value]);
  expect(removal.ok).toBe(true);
  if (!removal.ok) return;
  expect((await store.dispatch({ baseRevision: doc.revision, operations: removal.value })).ok).toBe(
    true,
  );
  expect(Object.values(store.getSnapshot().entities).filter((e) => e.kind === 'edge')).toHaveLength(
    0,
  );
  expect(store.getSnapshot().entities[b.value]).toBeDefined();
});
test('new primitives inherit project palette while preserving semantic dimension parameters', async () => {
  const registry = createBuiltinRegistry(),
    doc = createProject();
  doc.theme.nodeColor = '#135790';
  doc.theme.borderColor = '#111111';
  doc.theme.textColor = '#333333';
  const store = createDocumentStore(doc, createGenerationServices(registry));
  const result = await addPrimitive(store, registry, 'builtin.conv', { x: 30, y: 60 });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const e = store.getSnapshot().entities[result.value];
  expect(e.kind !== 'edge' && e.presentation.position).toEqual({ x: 30, y: 60 });
  expect(e.generation?.source.kind === 'local' && e.generation.source.params.fillColor).toBe(
    '#135790',
  );
});
test('layout handles branching as ranks without replacing stable nodes or manual edge paths', async () => {
  const registry = createBuiltinRegistry(),
    store = createDocumentStore(createProject(), createGenerationServices(registry));
  const ids: string[] = [];
  for (const name of ['input', 'conv', 'pool', 'concat']) {
    const r = await addPrimitive(store, registry, `builtin.${name}`);
    if (r.ok) ids.push(r.value);
  }
  await executeConnectionPattern(store, registry, 'example.parallel-branches', ids, {});
  const before = store.getSnapshot(),
    ops = planLayout(before);
  expect(ops.ok).toBe(true);
  if (!ops.ok) return;
  expect((await store.dispatch({ baseRevision: before.revision, operations: ops.value })).ok).toBe(
    true,
  );
  const after = store.getSnapshot(),
    positions = ids.map((id) => {
      const e = after.entities[id];
      if (e.kind === 'edge') throw Error();
      return e.presentation.position;
    });
  expect(positions[1].x).toBe(positions[2].x);
  expect(positions[1].y).not.toBe(positions[2].y);
  expect(positions[3].x).toBeGreaterThan(positions[1].x);
  expect(Object.keys(after.entities)).toEqual(Object.keys(before.entities));
});

test('connection plugins cannot bypass the old managed-composite topology boundary', async () => {
  const { makeCoreFixture } = await import('../fixtures/project.ts');
  const doc = makeCoreFixture();
  const root = {
    id: 'legacy',
    kind: 'group' as const,
    parentId: null,
    name: '旧托管组合',
    size: { width: 800, height: 400 },
    ports: {},
    presentation: { position: { x: 0, y: 0 } },
    generation: {
      generatorId: 'old',
      version: '1.0.0',
      paramSchemaVersion: 1,
      source: { kind: 'local' as const, params: {} },
      localKeys: { root: 'legacy', a: 'node-a', b: 'node-b' },
    },
  };
  doc.entities.legacy = root;
  doc.entities['node-a'].parentId = 'legacy';
  doc.entities['node-b'].parentId = 'legacy';
  const store = createDocumentStore(doc, createGenerationServices(createBuiltinRegistry()));
  const result = await executeConnectionPattern(
    store,
    createBuiltinRegistry(),
    'builtin.chain',
    ['node-a', 'node-b'],
    {},
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe('MANAGED_TOPOLOGY');
  expect(store.getSnapshot().revision).toBe(0);
});
