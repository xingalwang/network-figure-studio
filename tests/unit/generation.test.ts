import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createPluginRegistry } from '../../src/plugins/registry.ts';
import {
  createGenerationServices,
  detachGeneration,
  getGenerationParams,
} from '../../src/core/generation/merge.ts';
import { beginDraft, checkDraft } from '../../src/core/generation/draft.ts';
import { executePluginCommand } from '../../src/plugins/execute.ts';
import type { PluginDefinition, Params, Entity, NodeEntity } from '../../src/plugins/sdk.ts';
import { makeEmptyProject } from '../fixtures/project.ts';
const plugin: PluginDefinition = {
  manifest: { id: 'test', name: 'Test', version: '1.0.0', apiVersion: 1 },
  generators: [
    {
      id: 'test.block',
      version: '1.0.0',
      paramSchemaVersion: 1,
      name: 'Block',
      description: '',
      defaults: { channels: 64, mode: 'axonometric', angle: 30 },
      fields: [
        { key: 'channels', label: '通道', type: 'number', min: 1, max: 4096 },
        {
          key: 'mode',
          label: '表现',
          type: 'enum',
          options: [
            { value: 'flat', label: '2D' },
            { value: 'axonometric', label: '3D' },
          ],
        },
        { key: 'angle', label: '角度', type: 'number', min: 0, max: 90 },
      ],
      generate(p) {
        const entities: Record<string, Entity> = {
          root: {
            id: 'root',
            parentId: null,
            kind: 'node',
            name: `Conv ${p.channels}`,
            size: { width: 80, height: 60 },
            bounds: { x: 0, y: 0, width: 80, height: 60 },
            primitives: [
              {
                kind: 'rect',
                x: 0,
                y: 0,
                width: 80,
                height: 60,
                fill: '#88aabb',
                stroke: '#334455',
              },
            ],
            ports: { in: { x: 0, y: 30 }, out: { x: 80, y: 30 } },
            presentation: { position: { x: 0, y: 0 } },
          },
        };
        return { rootKey: 'root', entities };
      },
    },
  ],
};
const params = { channels: 64, mode: 'axonometric', angle: 30 };
const setup = () => {
  const registry = createPluginRegistry([plugin]);
  return {
    registry,
    store: createDocumentStore(makeEmptyProject(), createGenerationServices(registry)),
  };
};
test('regeneration preserves stable ID, moved position and manual label in one undo step', async () => {
  const { store } = setup();
  let result = await store.dispatch({
    baseRevision: 0,
    operations: [
      {
        kind: 'generate',
        id: 'instance',
        generatorId: 'test.block',
        params,
        position: { x: 20, y: 30 },
      },
    ],
  });
  assert.ok(result.ok);
  await store.dispatch({
    baseRevision: 1,
    operations: [
      { kind: 'move', id: 'instance', position: { x: 120, y: 160 } },
      { kind: 'label', id: 'instance', text: '编码器' },
    ],
  });
  result = await store.dispatch({
    baseRevision: 2,
    operations: [
      {
        kind: 'generate',
        id: 'instance',
        generatorId: 'test.block',
        params: { ...params, channels: 128, mode: 'flat' },
      },
    ],
  });
  assert.ok(result.ok);
  const n = store.getSnapshot().entities.instance as NodeEntity;
  assert.equal(n.id, 'instance');
  assert.deepEqual(n.presentation.position, { x: 120, y: 160 });
  assert.equal(n.presentation.labelOverride, '编码器');
  assert.equal(n.name, 'Conv 128');
  assert.ok(store.undo().ok);
  assert.equal(store.getSnapshot().entities.instance.name, 'Conv 64');
  assert.ok(store.redo().ok);
  assert.equal(store.getSnapshot().entities.instance.name, 'Conv 128');
});
test('draft ignores presentation changes but detects parameters changed and targets removed', async () => {
  const { store } = setup();
  await store.dispatch({
    baseRevision: 0,
    operations: [{ kind: 'generate', id: 'instance', generatorId: 'test.block', params }],
  });
  const draft = beginDraft(store.getSnapshot(), 'instance');
  await store.dispatch({
    baseRevision: 1,
    operations: [{ kind: 'label', id: 'instance', text: '手工标签' }],
  });
  assert.equal(checkDraft(store.getSnapshot(), draft).kind, 'ready');
  await store.dispatch({
    baseRevision: 2,
    operations: [
      {
        kind: 'generate',
        id: 'instance',
        generatorId: 'test.block',
        params: { ...params, channels: 128 },
      },
    ],
  });
  assert.equal(checkDraft(store.getSnapshot(), draft).kind, 'parameter-conflict');
  await store.dispatch({ baseRevision: 3, operations: [{ kind: 'remove', ids: ['instance'] }] });
  assert.equal(checkDraft(store.getSnapshot(), draft).kind, 'target-missing');
});
test('reject invalid params, unknown generator/version without mutating project', async () => {
  const { store } = setup();
  for (const p of [
    { ...params, channels: NaN },
    { ...params, mode: 'camera' },
    { ...params, script: 'bad' },
  ]) {
    const r = await store.dispatch({
      baseRevision: 0,
      operations: [{ kind: 'generate', id: 'instance', generatorId: 'test.block', params: p }],
    });
    assert.equal(r.ok, false);
    assert.equal(store.getSnapshot().revision, 0);
  }
  const r = await store.dispatch({
    baseRevision: 0,
    operations: [{ kind: 'generate', id: 'instance', generatorId: 'missing', params }],
  });
  assert.equal(r.ok, false);
});
test('registry rejects API mismatch, dependency cycle and duplicate generator', () => {
  assert.throws(() =>
    createPluginRegistry([{ ...plugin, manifest: { ...plugin.manifest, apiVersion: 2 as 1 } }]),
  );
  assert.throws(() => createPluginRegistry([plugin, plugin]));
  assert.throws(() =>
    createPluginRegistry([
      { ...plugin, manifest: { ...plugin.manifest, dependencies: { test: '1.0.0' } } },
    ]),
  );
});
test('plugin command permissions restrict mutation to selected entities', async () => {
  const { store } = setup();
  await store.dispatch({
    baseRevision: 0,
    operations: [
      { kind: 'generate', id: 'a', generatorId: 'test.block', params },
      { kind: 'generate', id: 'b', generatorId: 'test.block', params },
    ],
  });
  const command = {
    id: 'test.bad',
    name: 'Bad',
    description: '',
    permissions: ['move' as const],
    fields: [],
    isAvailable: () => true,
    run: (doc: any) => ({
      baseRevision: doc.revision,
      operations: [{ kind: 'move' as const, id: 'b', position: { x: 1, y: 1 } }],
    }),
  };
  const registry = createPluginRegistry([
    { manifest: { id: 'cmd', name: 'cmd', version: '1.0.0', apiVersion: 1 }, commands: [command] },
  ]);
  const before = store.getSnapshot();
  const r = await executePluginCommand(store, registry, command.id, ['a'], {});
  assert.equal(r.ok, false);
  assert.equal(store.getSnapshot(), before);
});
