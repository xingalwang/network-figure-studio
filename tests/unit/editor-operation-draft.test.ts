import { expect, test } from 'vitest';
import {
  prepareOperationParameters,
  previewOperation,
} from '../../src/app/editor/operation-draft.ts';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createProject } from '../../src/core/document/codec.ts';
import { createGenerationServices } from '../../src/core/generation/merge.ts';
import { addTensorSource } from '../../src/core/tensor-composition.ts';

async function fixture() {
  const registry = createBuiltinRegistry();
  const store = createDocumentStore(
    createProject('编辑预览', 2),
    createGenerationServices(registry),
  );
  const source = await addTensorSource(store, registry, undefined, 2);
  if (!source.ok) throw Error(source.error.message);
  const entity = store.getSnapshot().entities[source.value];
  if (entity.generation?.source.kind !== 'local') throw Error('source');
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [
      {
        kind: 'generate',
        id: entity.id,
        generatorId: entity.generation.generatorId,
        params: { ...entity.generation.source.params, N: 1, H: 12, W: 10, C: 3 },
      },
    ],
  });
  return { registry, store, id: source.value };
}

test('registered operation defaults and detached analysis produce formula previews without editing authoritative history', async () => {
  const f = await fixture(),
    doc = f.store.getSnapshot();
  const draft = { kind: 'tensor.conv2d', sourceIds: [f.id] };
  const prepared = prepareOperationParameters(doc, f.registry, draft);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;
  expect(prepared.value.dimension).toBe(2);
  const preview = await previewOperation(doc, f.registry, draft, prepared.value.params);
  expect(preview.ok).toBe(true);
  if (preview.ok) {
    expect(preview.value.state).toBe('ready');
    expect(preview.value.formulas?.length).toBeGreaterThan(0);
  }
  expect(f.store.getSnapshot()).toBe(doc);
  expect(f.store.undo().ok).toBe(true);
  // Only the earlier source configuration is undone; preview never reaches its store.
  expect(Object.keys(f.store.getSnapshot().entities)).toEqual([f.id]);
});

test('preview failures and missing definitions are explicit and keep the input project untouched', async () => {
  const f = await fixture(),
    doc = f.store.getSnapshot();
  expect(
    prepareOperationParameters(doc, f.registry, { kind: 'not.registered', sourceIds: [f.id] }).ok,
  ).toBe(false);
  const invalid = await previewOperation(
    doc,
    f.registry,
    { kind: 'tensor.concat', sourceIds: [f.id] },
    {},
  );
  expect(invalid.ok).toBe(false);
  expect(f.store.getSnapshot()).toBe(doc);
});

test('extension operations use their own defaults and the same preview flow', async () => {
  const f = await fixture(),
    doc = f.store.getSnapshot();
  const draft = { kind: 'example.leaky-relu', sourceIds: [f.id] };
  const prepared = prepareOperationParameters(doc, f.registry, draft);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;
  const preview = await previewOperation(doc, f.registry, draft, prepared.value.params);
  expect(preview.ok).toBe(true);
  if (preview.ok) expect(preview.value.state).toBe('ready');
  expect(f.store.getSnapshot()).toBe(doc);
});
