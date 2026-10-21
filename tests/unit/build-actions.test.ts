import { expect, test } from 'vitest';
import { createProject, migrateProjectV3 } from '../../src/core/document/codec.ts';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createGenerationServices, getGenerationParams } from '../../src/core/generation/merge.ts';
import { analyzeDocument } from '../../src/core/computation/index.ts';
import { addTensorSource, appendTensorOperation } from '../../src/core/tensor-composition.ts';
import {
  planAddFigureAnnotation,
  planAddFigureRepresentation,
} from '../../src/core/figure/index.ts';
import {
  writeParameterDraft,
  type ParameterDraftCache,
} from '../../src/app/editor/parameter-drafts.ts';
import { createBuildActions, projectStructureDrafts } from '../../src/app/editor/build-actions.ts';
import type { Params } from '../../src/core/document/types.ts';

async function setup() {
  const registry = createBuiltinRegistry(),
    store = createDocumentStore(createProject('统一构建', 2), createGenerationServices(registry));
  const source = await addTensorSource(store, registry, undefined, 2);
  if (!source.ok) throw Error(source.error.message);
  const sourceId = source.value,
    sourceParams = getGenerationParams(store.getSnapshot(), sourceId, registry);
  if (!sourceParams.ok) throw Error(sourceParams.error.message);
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [
      {
        kind: 'generate',
        id: sourceId,
        generatorId: 'tensor.source2d',
        params: { ...sourceParams.value, H: 12, W: 10, C: 3 },
      },
    ],
  });
  const convolution = await appendTensorOperation(store, registry, [sourceId], 'conv2d');
  if (!convolution.ok) throw Error(convolution.error.message);
  const drafts: ParameterDraftCache = new Map(),
    errors: string[] = [];
  const official = (id: string) => {
    const value = getGenerationParams(store.getSnapshot(), id, registry);
    if (!value.ok) throw Error(value.error.message);
    return value.value;
  };
  const edit = (id: string, delta: Params) =>
    writeParameterDraft(drafts, id, official(id), { ...official(id), ...delta });
  const actions = createBuildActions({
    store,
    registry,
    drafts,
    onError: (message) => errors.push(message),
    onChanged() {},
  });
  return {
    registry,
    store,
    sourceId,
    ...convolution.value,
    drafts,
    errors,
    official,
    edit,
    actions,
  };
}

test('one build commits every structure draft once and leaves appearance drafts pending', async () => {
  const c = await setup();
  const primitive = c.registry.generators.get('builtin.conv')!;
  await c.store.dispatch({
    baseRevision: c.store.getSnapshot().revision,
    operations: [
      { kind: 'generate', id: 'ordinary', generatorId: primitive.id, params: primitive.defaults },
    ],
  });
  c.edit(c.sourceId, { H: 64, W: 64, drawWidth: 260 });
  c.edit(c.operationId, { outChannels: 24 });
  c.edit('ordinary', { channels: 36 });
  const before = c.store.getSnapshot();
  expect(await c.actions.buildStructure()).toBe(true);
  expect(c.store.getSnapshot().revision).toBe(before.revision + 1);
  expect(c.official(c.sourceId)).toMatchObject({ H: 64, W: 64, drawWidth: 112 });
  expect(
    analyzeDocument(c.store.getSnapshot(), c.registry.computations).nodes[c.resultId].shape,
  ).toEqual({ N: 1, H: 64, W: 64, C: 24 });
  expect(c.drafts.has(c.operationId)).toBe(false);
  expect(c.official('ordinary').channels).toBe(36);
  expect(c.drafts.get(c.sourceId)?.params).toMatchObject({ H: 64, W: 64, drawWidth: 260 });
  expect(await c.actions.applyAppearance(c.sourceId)).toBe(true);
  expect(c.official(c.sourceId).drawWidth).toBe(260);
  expect(c.drafts.size).toBe(0);
  c.store.undo();
  c.store.undo();
  expect(c.store.getSnapshot().entities).toEqual(before.entities);
});

test('appearance application does not accidentally build pending structure fields', async () => {
  const c = await setup();
  c.edit(c.sourceId, { H: 80, drawWidth: 250 });
  expect(await c.actions.applyAppearance(c.sourceId)).toBe(true);
  expect(c.official(c.sourceId)).toMatchObject({ H: 12, drawWidth: 250 });
  expect(c.drafts.get(c.sourceId)?.params.H).toBe(80);
  expect(await c.actions.buildStructure()).toBe(true);
  expect(c.official(c.sourceId)).toMatchObject({ H: 80, drawWidth: 250 });
  expect(c.drafts.size).toBe(0);
});

test('invalid parameters and readonly stores reject the whole build and retain all drafts', async () => {
  const c = await setup();
  c.edit(c.sourceId, { H: -1 });
  c.edit(c.operationId, { outChannels: 48 });
  const before = c.store.getSnapshot(),
    drafts = [...c.drafts];
  expect(await c.actions.buildStructure()).toBe(false);
  expect(c.store.getSnapshot()).toBe(before);
  expect([...c.drafts]).toEqual(drafts);
  c.edit(c.sourceId, { H: 90 });
  c.store.setReadonly(true);
  expect(await c.actions.buildStructure()).toBe(false);
  expect(c.store.getSnapshot()).toBe(before);
  expect(c.drafts.size).toBe(2);
});

test('an external conflict is confirmed for the whole build without discarding rejected drafts', async () => {
  const c = await setup();
  c.edit(c.sourceId, { H: 64 });
  c.edit(c.operationId, { outChannels: 24 });
  await c.store.dispatch({
    baseRevision: c.store.getSnapshot().revision,
    operations: [
      {
        kind: 'generate',
        id: c.sourceId,
        generatorId: 'tensor.source2d',
        params: { ...c.official(c.sourceId), H: 20 },
      },
    ],
  });
  const before = c.store.getSnapshot();
  expect(await c.actions.buildStructure()).toBe(false);
  expect(c.store.getSnapshot()).toBe(before);
  expect(c.drafts.size).toBe(2);
  const actions = createBuildActions({
    store: c.store,
    registry: c.registry,
    drafts: c.drafts,
    onError() {},
    onChanged() {},
    confirmOverwrite: () => true,
  });
  expect(await actions.buildStructure()).toBe(true);
  expect(c.official(c.sourceId).H).toBe(64);
  expect(c.official(c.operationId).outChannels).toBe(24);
  expect(c.drafts.size).toBe(0);
});

test('preview projects all structure drafts without committing appearance or creating history', async () => {
  const c = await setup();
  c.edit(c.sourceId, { H: 80, drawWidth: 300 });
  c.edit(c.operationId, { outChannels: 40 });
  const before = c.store.getSnapshot(),
    preview = projectStructureDrafts(before, c.registry, c.drafts);
  expect(preview).not.toBe(before);
  expect(preview.revision).toBe(before.revision);
  expect(analyzeDocument(preview, c.registry.computations).nodes[c.resultId].shape).toEqual({
    N: 1,
    H: 80,
    W: 10,
    C: 40,
  });
  expect(
    (preview.entities[c.sourceId].generation!.source as { params: Params }).params.drawWidth,
  ).toBe(112);
  expect(c.store.getSnapshot()).toBe(before);
  expect(c.official(c.sourceId).H).toBe(12);
});

test('v3 figure geometry and annotation drafts are excluded from structure builds', async () => {
  const c = await setup(),
    doc = migrateProjectV3(c.store.getSnapshot());
  const store = createDocumentStore(doc, createGenerationServices(c.registry));
  const annotation = planAddFigureAnnotation(doc, '正式标注'),
    representation = planAddFigureRepresentation(doc, c.sourceId);
  if (!annotation.ok || !representation.ok) throw Error('missing figure');
  await store.dispatch({
    baseRevision: doc.revision,
    operations: [...annotation.value.operations, ...representation.value.operations],
  });
  writeParameterDraft(c.drafts, annotation.value.id, { text: '正式标注' }, { text: '标注草稿' });
  writeParameterDraft(c.drafts, representation.value.id, { drawWidth: 112 }, { drawWidth: 420 });
  const official = getGenerationParams(store.getSnapshot(), c.sourceId, c.registry);
  if (!official.ok) throw Error(official.error.message);
  writeParameterDraft(c.drafts, c.sourceId, official.value, { ...official.value, H: 96 });
  const actions = createBuildActions({
    store,
    registry: c.registry,
    drafts: c.drafts,
    onError() {},
    onChanged() {},
  });
  const before = store.getSnapshot();
  expect(await actions.buildStructure()).toBe(true);
  expect(store.getSnapshot().entities[annotation.value.id]).toEqual(
    before.entities[annotation.value.id],
  );
  expect(store.getSnapshot().entities[representation.value.id]).toEqual(
    before.entities[representation.value.id],
  );
  expect(c.drafts.has(c.sourceId)).toBe(false);
  expect(c.drafts.size).toBe(2);
});

test('simultaneous slot drafts merge into one owner generation without losing sibling edits', async () => {
  const c = await setup(),
    generator = c.registry.generators.get('example.residual')!;
  await c.store.dispatch({
    baseRevision: c.store.getSnapshot().revision,
    operations: [
      { kind: 'generate', id: 'residual', generatorId: generator.id, params: generator.defaults },
    ],
  });
  const keys = c.store.getSnapshot().entities.residual.generation!.localKeys,
    first = keys['block-0/conv-1'],
    second = keys['block-0/conv-2'];
  c.edit(first, { channels: 32 });
  c.edit(second, { channels: 48 });
  const before = c.store.getSnapshot();
  expect(await c.actions.buildStructure()).toBe(true);
  expect(c.official(first).channels).toBe(32);
  expect(c.official(second).channels).toBe(48);
  expect(c.store.getSnapshot().revision).toBe(before.revision + 1);
  expect(c.drafts.size).toBe(0);
});

test('an intervening revision invalidates the prepared build while preserving newer draft edits', async () => {
  const c = await setup();
  c.edit(c.sourceId, { H: 64 });
  let release!: () => void, started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const generator = c.registry.generators.get('tensor.source2d')!;
  const registry = { ...c.registry, generators: new Map(c.registry.generators) };
  registry.generators.set(generator.id, {
    ...generator,
    async generate(...args) {
      started();
      await gate;
      return generator.generate(...args);
    },
  });
  const actions = createBuildActions({
    store: c.store,
    registry,
    drafts: c.drafts,
    onError: (message) => c.errors.push(message),
    onChanged() {},
  });
  const building = actions.buildStructure();
  await began;
  await c.store.dispatch({
    baseRevision: c.store.getSnapshot().revision,
    operations: [{ kind: 'label', id: c.sourceId, text: '构建期间新修改' }],
  });
  c.edit(c.sourceId, { H: 96 });
  release();
  expect(await building).toBe(false);
  expect(c.official(c.sourceId).H).toBe(12);
  expect(c.drafts.get(c.sourceId)?.params.H).toBe(96);
  expect(c.store.getSnapshot().entities[c.sourceId]).toMatchObject({
    presentation: { labelOverride: '构建期间新修改' },
  });
  expect(c.errors).toHaveLength(1);
});
