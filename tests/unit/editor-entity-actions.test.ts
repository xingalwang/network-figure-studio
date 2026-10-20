import { expect, it } from 'vitest';
import { createProject } from '../../src/core/document/codec.ts';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createGenerationServices } from '../../src/core/generation/merge.ts';
import { createEntityActions } from '../../src/app/editor/entity-actions.ts';

async function setup(generatorId = 'tensor.source2d', params = {}) {
  const registry = createBuiltinRegistry(),
    generator = registry.generators.get(generatorId)!;
  const store = createDocumentStore(
    createProject('编辑动作', 2),
    createGenerationServices(registry),
  );
  const added = await store.dispatch({
    baseRevision: 0,
    operations: [
      {
        kind: 'generate',
        id: 'editable',
        generatorId,
        params: { ...generator.defaults, ...params },
        position: { x: 170, y: 210 },
      },
    ],
  });
  if (!added.ok) throw Error(added.error.message);
  return { store, registry, generator, createEntityActions };
}

it('a panel updates parameters and labels through complete shared actions with one undo per edit', async () => {
  const { store, registry, generator, createEntityActions } = await setup();
  const errors: string[] = [],
    actions = createEntityActions({ store, registry, onError: (message) => errors.push(message) });
  expect(await actions.setLabel('editable', '编码器输入')).toBe(true);
  const before = store.getSnapshot();
  expect(
    await actions.updateParameters('editable', { ...generator.defaults, H: 64, W: 32, C: 3 }),
  ).toBe(true);
  expect(store.getSnapshot().entities.editable).toMatchObject({
    generation: { source: { params: { H: 64, W: 32, C: 3 } } },
    presentation: { position: { x: 170, y: 210 }, labelOverride: '编码器输入' },
  });
  expect(store.undo().ok).toBe(true);
  expect(store.getSnapshot().entities).toEqual(before.entities);
  expect(errors).toEqual([]);
});

it('shared edit actions report unknown targets, exact-version failures and readonly commits', async () => {
  const { store, registry, generator, createEntityActions } = await setup();
  const errors: string[] = [],
    actions = createEntityActions({ store, registry, onError: (message) => errors.push(message) });
  expect(await actions.updateParameters('missing', generator.defaults)).toBe(false);
  expect(await actions.setLabel('missing', '不存在')).toBe(false);
  const otherVersion = createEntityActions({
    store,
    registry: {
      ...registry,
      generators: new Map([[generator.id, { ...generator, version: '2.0.0' }]]),
    },
    onError: (message) => errors.push(message),
  });
  expect(await otherVersion.updateParameters('editable', generator.defaults)).toBe(false);
  store.setReadonly(true);
  const before = store.getSnapshot();
  expect(await actions.updateParameters('editable', { ...generator.defaults, H: 80 })).toBe(false);
  expect(await actions.setLabel('editable', '只读')).toBe(false);
  expect(store.getSnapshot()).toBe(before);
  expect(errors).toHaveLength(5);
});

it('parameter removal confirmation belongs to the shared action and declining preserves all content', async () => {
  const { store, registry, generator, createEntityActions } = await setup('example.residual', {
    repeats: 2,
  });
  const root = store.getSnapshot().entities.editable;
  const childId = root.generation!.localKeys['block-1/conv-1'];
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [{ kind: 'label', id: childId, text: '保留手工层' }],
  });
  const before = store.getSnapshot(),
    errors: string[] = [];
  let approved = false,
    confirmations = 0;
  const actions = createEntityActions({
    store,
    registry,
    onError: (message) => errors.push(message),
    confirmRemoval: () => {
      confirmations++;
      return approved;
    },
  });
  expect(await actions.updateParameters('editable', { ...generator.defaults, repeats: 1 })).toBe(
    false,
  );
  expect(store.getSnapshot()).toBe(before);
  approved = true;
  expect(await actions.updateParameters('editable', { ...generator.defaults, repeats: 1 })).toBe(
    true,
  );
  expect(store.getSnapshot().entities[childId]).toBeUndefined();
  expect(confirmations).toBe(2);
  expect(errors).toEqual([]);
  store.undo();
  expect(store.getSnapshot().entities).toEqual(before.entities);
});

it('a change during removal confirmation invalidates the original parameter edit', async () => {
  const { store, registry, generator, createEntityActions } = await setup('example.residual', {
    repeats: 2,
  });
  const childId = store.getSnapshot().entities.editable.generation!.localKeys['block-1/conv-1'];
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [{ kind: 'label', id: childId, text: '手工层' }],
  });
  const errors: string[] = [],
    actions = createEntityActions({
      store,
      registry,
      onError: (message) => errors.push(message),
      confirmRemoval: async () => {
        await store.dispatch({
          baseRevision: store.getSnapshot().revision,
          operations: [{ kind: 'label', id: 'editable', text: '新修改' }],
        });
        return true;
      },
    });
  expect(await actions.updateParameters('editable', { ...generator.defaults, repeats: 1 })).toBe(
    false,
  );
  expect(store.getSnapshot().entities[childId]).toBeDefined();
  expect(store.getSnapshot().entities.editable).toMatchObject({
    presentation: { labelOverride: '新修改' },
  });
  expect(errors).toHaveLength(1);
});
