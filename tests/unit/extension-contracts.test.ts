import { test, expect } from 'vitest';
import { createPluginRegistry } from '../../src/plugins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { makeEmptyProject, makeCoreFixture } from '../fixtures/project.ts';
import type { PluginDefinition, NodeEntity, ProjectDocument } from '../../src/plugins/sdk.ts';

const primitive = {
  id: 'test.primitive',
  version: '1.0.0',
  paramSchemaVersion: 1,
  name: 'Test primitive',
  description: '',
  category: '测试',
  icon: 'cube',
  defaults: {},
  fields: [],
  generate() {
    const node = structuredClone(makeCoreFixture().entities['node-a']);
    node.id = 'root';
    return { rootKey: 'root', entities: { root: node } };
  },
};
const manifest = {
  id: 'test.extensions',
  name: 'Extensions',
  version: '1.0.0',
  apiVersion: 1 as const,
};
const pattern = {
  id: 'test.connection',
  version: '1.0.0',
  name: 'Connection',
  description: '',
  defaults: {},
  fields: [],
  isAvailable: () => true,
  connect: () => [
    { source: { entityId: 'a', portId: 'out' }, target: { entityId: 'b', portId: 'in' } },
  ],
};
const plugin = (extra: Record<string, unknown>): PluginDefinition => ({ manifest, ...extra });
function fixture(): ProjectDocument {
  const doc = makeEmptyProject(),
    node = makeCoreFixture().entities['node-a'] as NodeEntity;
  for (const [index, id] of ['a', 'b', 'c', 'd'].entries())
    doc.entities[id] = {
      ...structuredClone(node),
      id,
      ports: { ...node.ports, in2: { x: 40, y: 0 } },
      presentation: { position: { x: index * 150, y: 100 } },
    };
  return doc;
}
async function execute() {
  const module = await import('../../src/plugins/connections.ts').catch(() => null);
  expect(module, 'connection-pattern host execution API is missing').not.toBeNull();
  return module!.executeConnectionPattern;
}

test('primitive and connection registrations are indexed while preserving generator compatibility', () => {
  const registry = createPluginRegistry([
    plugin({ primitives: [primitive], connectionPatterns: [pattern] }),
  ]);
  expect(registry.primitives?.get(primitive.id)).toBe(primitive);
  expect(registry.generators.get(primitive.id)).toBe(primitive);
  expect(registry.connectionPatterns?.get(pattern.id)).toBe(pattern);
});

test('registry rejects cross-generator duplicate IDs, duplicate patterns and invalid extension versions', () => {
  expect(() =>
    createPluginRegistry([plugin({ generators: [primitive], primitives: [primitive] })]),
  ).toThrow();
  expect(() =>
    createPluginRegistry([plugin({ connectionPatterns: [pattern, pattern] })]),
  ).toThrow();
  expect(() =>
    createPluginRegistry([plugin({ primitives: [{ ...primitive, version: 'next' }] })]),
  ).toThrow();
  expect(() =>
    createPluginRegistry([plugin({ connectionPatterns: [{ ...pattern, version: 'next' }] })]),
  ).toThrow();
});

test('host creates root-level editable connections in one undoable transaction with world route points', async () => {
  const run = await execute(),
    store = createDocumentStore(fixture());
  const registry = createPluginRegistry([
    plugin({
      connectionPatterns: [
        {
          ...pattern,
          connect: () => [
            {
              source: { entityId: 'a', portId: 'out' },
              target: { entityId: 'b', portId: 'in' },
              label: 'Skip',
              route: { kind: 'curve', points: [{ x: 220, y: 30 }] },
            },
            { source: { entityId: 'a', portId: 'out' }, target: { entityId: 'c', portId: 'in' } },
          ],
        },
      ],
    }),
  ]);
  const before = store.getSnapshot();
  const result = await run(store, registry, pattern.id, ['a', 'b', 'c'], {});
  expect(result.ok).toBe(true);
  const doc = store.getSnapshot(),
    edges = Object.values(doc.entities).filter((e) => e.kind === 'edge');
  expect(edges).toHaveLength(2);
  expect(new Set(edges.map((e) => e.id)).size).toBe(2);
  expect(edges[0]).toMatchObject({
    parentId: null,
    label: 'Skip',
    route: { kind: 'curve', spaceId: null, points: [{ x: 220, y: 30 }] },
  });
  expect(doc.entities.a).toEqual(before.entities.a);
  expect(doc.revision).toBe(1);
  expect(store.undo().ok).toBe(true);
  expect(store.getSnapshot().entities).toEqual(before.entities);
  expect(store.canUndo()).toBe(false);
  expect(store.redo().ok).toBe(true);
});

test('bad ports, scope escapes, invalid style and duplicate connections reject the entire proposal', async () => {
  const run = await execute();
  const valid = {
    source: { entityId: 'a', portId: 'out' },
    target: { entityId: 'b', portId: 'in' },
  };
  for (const specs of [
    [valid, { ...valid, target: { entityId: 'b', portId: 'missing' } }],
    [valid, { ...valid, target: { entityId: 'c', portId: 'in' } }],
    [valid, { ...valid, target: { entityId: 'b', portId: 'in2' }, style: { color: 'red' } }],
    [valid, valid],
  ]) {
    const store = createDocumentStore(fixture()),
      before = store.getSnapshot();
    const registry = createPluginRegistry([
      plugin({ connectionPatterns: [{ ...pattern, connect: () => specs }] }),
    ]);
    expect((await run(store, registry, pattern.id, ['a', 'b'], {})).ok).toBe(false);
    expect(store.getSnapshot()).toBe(before);
    expect(store.canUndo()).toBe(false);
  }
  const store = createDocumentStore(fixture()),
    registry = createPluginRegistry([plugin({ connectionPatterns: [pattern] })]);
  expect((await run(store, registry, pattern.id, ['a', 'b'], {})).ok).toBe(true);
  const before = store.getSnapshot();
  expect((await run(store, registry, pattern.id, ['a', 'b'], {})).ok).toBe(false);
  expect(store.getSnapshot()).toBe(before);
});

test('readonly, invalid params and stale asynchronous patterns cannot commit', async () => {
  const run = await execute(),
    store = createDocumentStore(fixture());
  let called = false,
    release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const registry = createPluginRegistry([
    plugin({
      connectionPatterns: [
        {
          ...pattern,
          fields: [{ key: 'count', label: 'Count', type: 'number', min: 1, max: 4 }],
          defaults: { count: 2 },
          async connect() {
            called = true;
            await pending;
            return pattern.connect();
          },
        },
      ],
    }),
  ]);
  store.setReadonly(true);
  expect((await run(store, registry, pattern.id, ['a', 'b'], { count: 2 })).ok).toBe(false);
  expect(called).toBe(false);
  store.setReadonly(false);
  expect((await run(store, registry, pattern.id, ['a', 'b'], { count: 8 })).ok).toBe(false);
  expect(called).toBe(false);
  const execution = run(store, registry, pattern.id, ['a', 'b'], { count: 2 });
  await Promise.resolve();
  await store.dispatch({
    baseRevision: 0,
    operations: [{ kind: 'move', id: 'a', position: { x: 99, y: 20 } }],
  });
  release();
  expect((await execution).ok).toBe(false);
  expect(Object.values(store.getSnapshot().entities).filter((e) => e.kind === 'edge')).toHaveLength(
    0,
  );
});

test('built-in connection patterns preserve selection order and use distinct merge ports', async () => {
  const module = await import('../../src/builtins/connections.ts').catch(() => null);
  expect(module, 'built-in connection patterns are missing').not.toBeNull();
  const patterns = module!.builtinConnectionPatterns;
  const doc = fixture();
  const chain = patterns.find((p) => p.id === 'builtin.chain')!;
  const branch = patterns.find((p) => p.id === 'builtin.branch')!;
  const merge = patterns.find((p) => p.id === 'builtin.merge')!;
  expect(
    (await chain.connect(doc, ['c', 'a', 'b'], {})).map((e) => [
      e.source.entityId,
      e.target.entityId,
    ]),
  ).toEqual([
    ['c', 'a'],
    ['a', 'b'],
  ]);
  expect(
    (await branch.connect(doc, ['b', 'c', 'a'], {})).map((e) => [
      e.source.entityId,
      e.target.entityId,
    ]),
  ).toEqual([
    ['b', 'c'],
    ['b', 'a'],
  ]);
  expect((await merge.connect(doc, ['c', 'a', 'b'], {})).map((e) => e.target)).toEqual([
    { entityId: 'b', portId: 'in' },
    { entityId: 'b', portId: 'in2' },
  ]);
  delete (doc.entities.b as NodeEntity).ports.in2;
  expect(merge.isAvailable(doc, ['c', 'a', 'b'])).toBe(false);
  expect(() => merge.connect(doc, ['c', 'a', 'b'], {})).toThrow(/输入/);
});

test('example plugin adds an attention primitive and freely editable parallel connection pattern', async () => {
  const module = await import('../../examples/plugins/attention/index.ts').catch(() => null);
  expect(module, 'attention extension example is missing').not.toBeNull();
  const plugin = module!.attentionPlugin;
  const registry = createPluginRegistry([plugin]);
  const definition = registry.primitives.get('example.attention-gate')!;
  const fragment = await definition.generate(
    { ...definition.defaults, channels: 128, mode: 'flat', fillColor: '#ff00aa', label: 'Gate' },
    makeEmptyProject().theme,
  );
  const root = fragment.entities[fragment.rootKey] as NodeEntity;
  expect(Object.keys(root.ports)).toEqual(['in', 'gate', 'out']);
  expect(root.primitives.some((p) => 'fill' in p && p.fill === '#ff00aa')).toBe(true);
  expect(root.primitives.some((p) => p.kind === 'text' && p.text.includes('Gate'))).toBe(true);
  const run = await execute(),
    store = createDocumentStore(fixture());
  expect(
    (await run(store, registry, 'example.parallel-branches', ['a', 'b', 'c', 'd'], {})).ok,
  ).toBe(true);
  const edges = Object.values(store.getSnapshot().entities).filter((e) => e.kind === 'edge');
  expect(edges).toHaveLength(4);
  expect(edges.every((e) => e.parentId === null && !e.generation)).toBe(true);
});

test('builtin registry exposes primitive and connection extensions without removing legacy plugins', async () => {
  const { createBuiltinRegistry } = await import('../../src/builtins/registry.ts');
  const registry = createBuiltinRegistry();
  for (const id of [
    'builtin.conv',
    'builtin.pool',
    'builtin.linear',
    'builtin.concat',
    'example.attention-gate',
  ]) {
    expect(registry.primitives.has(id), id).toBe(true);
    expect(registry.generators.has(id), id).toBe(true);
  }
  expect(registry.generators.has('example.residual')).toBe(true);
  expect(registry.commands.has('example.distribute-x')).toBe(true);
  expect([...registry.connectionPatterns.keys()]).toEqual([
    'builtin.chain',
    'builtin.branch',
    'builtin.merge',
    'example.parallel-branches',
  ]);
});

test('connection patterns honor the project line width by default', async () => {
  const run = await execute(),
    doc = fixture();
  doc.theme.lineWidth = 3;
  const store = createDocumentStore(doc),
    registry = createPluginRegistry([plugin({ connectionPatterns: [pattern] })]);
  expect((await run(store, registry, pattern.id, ['a', 'b'], {})).ok).toBe(true);
  expect(
    Object.values(store.getSnapshot().entities).find((e) => e.kind === 'edge')!.style.width,
  ).toBe(3);
});

test('availability checks receive an immutable ordered selection rather than the caller array', async () => {
  const run = await execute(),
    selection = ['a', 'b'];
  const registry = createPluginRegistry([
    plugin({
      connectionPatterns: [
        {
          ...pattern,
          isAvailable(_doc: ProjectDocument, selected: string[]) {
            selected.reverse();
            return true;
          },
        },
      ],
    }),
  ]);
  const store = createDocumentStore(fixture()),
    before = store.getSnapshot();
  expect((await run(store, registry, pattern.id, selection, {})).ok).toBe(false);
  expect(selection).toEqual(['a', 'b']);
  expect(store.getSnapshot()).toBe(before);
});
