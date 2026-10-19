import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyOperations } from '../../src/core/commands/apply.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { decodeProject, encodeProject } from '../../src/core/document/codec.ts';
import { validateDocument } from '../../src/core/document/validate.ts';
import { buildBlockGeometry } from '../../src/graphics/block-geometry.ts';
import { nodeVisual, paintPrimitives } from '../../src/graphics/paint.ts';
import { makeCoreFixture } from '../fixtures/project.ts';
import type { NodeEntity } from '../../src/core/document/types.ts';
import {
  createGenerationServices,
  getGenerationParams,
  mergeGenerated,
} from '../../src/core/generation/merge.ts';
import { createPluginRegistry } from '../../src/plugins/registry.ts';
import type { PluginDefinition } from '../../src/plugins/sdk.ts';
import { figurePalettes, planApplyPalette } from '../../src/core/commands/appearance.ts';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';

const block = () => {
  const result = buildBlockGeometry(
    { width: 100, height: 60 },
    { mode: 'axonometric', depth: 24, stackCount: 1, stackGap: 6, angleDeg: 30 },
    { fill: '#80a0c0', label: '+' },
  );
  assert.ok(result.ok);
  return {
    ...makeCoreFixture().entities['node-a'],
    ...result.value,
    size: { width: 100, height: 60 },
  } as NodeEntity;
};

test('node style overrides survive JSON roundtrip and null restores the generated appearance', async () => {
  const doc = makeCoreFixture();
  const store = createDocumentStore(doc);
  const result = await store.dispatch({
    baseRevision: 0,
    operations: [
      {
        kind: 'nodeStyle',
        id: 'node-a',
        style: {
          fill: '#111111',
          stroke: '#abcdef',
          text: '#eeeeee',
          opacity: 0.4,
          strokeWidth: 0,
        },
      } as any,
    ],
  });
  assert.ok(result.ok);
  const node = store.getSnapshot().entities['node-a'] as NodeEntity;
  assert.deepEqual(node.presentation, {
    position: { x: 120, y: 160 },
    fillOverride: '#111111',
    strokeOverride: '#abcdef',
    textOverride: '#eeeeee',
    opacityOverride: 0.4,
    strokeWidthOverride: 0,
  });
  assert.deepEqual(decodeProject(encodeProject(store.getSnapshot())), {
    ok: true,
    value: store.getSnapshot(),
  });
  assert.ok(store.undo().ok);
  assert.deepEqual(store.getSnapshot().entities['node-a'], doc.entities['node-a']);
  assert.ok(store.redo().ok);
  const reset = await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [
      {
        kind: 'nodeStyle',
        id: 'node-a',
        style: { fill: null, stroke: null, text: null, opacity: null, strokeWidth: null },
      } as any,
    ],
  });
  assert.ok(reset.ok);
  assert.deepEqual((store.getSnapshot().entities['node-a'] as NodeEntity).presentation, {
    position: { x: 120, y: 160 },
  });
});

test('manual fill retains distinct projected lighting and restores readable face labels', () => {
  const node = block();
  node.presentation.fillOverride = '#111111';
  const visual = nodeVisual(node);
  assert.deepEqual(
    visual.primitives.filter((p) => 'fill' in p).map((p) => p.fill),
    ['#3c3c3c', '#0e0e0e', '#111111'],
  );
  assert.equal(visual.primitives.find((p) => p.kind === 'text')?.color, '#ffffff');
  node.presentation.textOverride = '#ffcc88';
  node.presentation.strokeOverride = '#123456';
  node.presentation.opacityOverride = 0.3;
  node.presentation.strokeWidthOverride = 0;
  const styled = nodeVisual(node);
  assert.ok(styled.primitives.every((p) => p.opacity === 0.3));
  assert.ok(
    styled.primitives
      .filter((p) => 'fill' in p)
      .every((p) => p.stroke === '#123456' && p.strokeWidth === 0),
  );
  assert.equal(styled.primitives.find((p) => p.kind === 'text')?.color, '#ffcc88');
});

test('geometry accepts explicit text, opacity and zero-width borders without changing bounds', () => {
  const result = buildBlockGeometry(
    { width: 100, height: 60 },
    { mode: 'flat', depth: 0, stackCount: 1, stackGap: 0, angleDeg: 30 },
    { fill: '#111111', textColor: '#aabbcc', opacity: 0.25, strokeWidth: 0, label: '+' } as any,
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value.bounds, { x: 0, y: 0, width: 100, height: 60 });
  assert.ok(result.value.primitives.every((p) => p.opacity === 0.25));
  assert.equal(result.value.primitives.find((p) => p.kind === 'text')?.color, '#aabbcc');
  const face = result.value.primitives.find((p) => p.kind === 'rect');
  assert.ok(face && 'strokeWidth' in face);
  assert.equal(face.strokeWidth, 0);
});

test('validator accepts new optional styles and custom paper while old projects remain valid', () => {
  const doc = makeCoreFixture();
  doc.theme = {
    ...doc.theme,
    nodeColor: '#aabbcc',
    textColor: '#112233',
    borderColor: '#334455',
    lineWidth: 0,
  };
  doc.page.background = '#f4f1ed';
  const node = doc.entities['node-a'] as NodeEntity;
  node.primitives[0] = { ...node.primitives[0], opacity: 0, strokeWidth: 0 } as any;
  const edge = doc.entities.edge;
  assert.equal(edge.kind, 'edge');
  if (edge.kind !== 'edge') return;
  edge.style.opacity = 0;
  edge.styleOverrides = { color: '#aabbcc', opacity: 0 };
  assert.ok(validateDocument(doc).ok);
  assert.ok(validateDocument(makeCoreFixture()).ok);
});

test('validator rejects out-of-range appearance values atomically', () => {
  for (const patch of [
    { opacityOverride: -0.1 },
    { opacityOverride: 1.1 },
    { opacityOverride: NaN },
    { strokeWidthOverride: -1 },
    { strokeOverride: 'red' },
  ]) {
    const doc = makeCoreFixture();
    Object.assign((doc.entities['node-a'] as NodeEntity).presentation, patch);
    assert.equal(validateDocument(doc).ok, false, JSON.stringify(patch));
  }
  for (const opacity of [-0.1, 1.1, Infinity]) {
    const doc = makeCoreFixture();
    Object.assign((doc.entities['node-a'] as NodeEntity).primitives[0], { opacity });
    assert.equal(validateDocument(doc).ok, false);
  }
  assert.equal(
    applyOperations(makeCoreFixture(), [
      { kind: 'nodeStyle', id: 'node-a', style: { opacity: 1.1 } } as any,
    ]).ok,
    false,
  );
});

test('painter forwards opacity and border width into the shared native renderer', () => {
  const calls: any[] = [];
  const canvas = new Proxy(
    {},
    {
      get:
        (_, key) =>
        (...args: any[]) =>
          calls.push([key, ...args]),
    },
  );
  paintPrimitives(
    canvas as any,
    [
      {
        kind: 'rect',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fill: '#ffffff',
        stroke: '#000000',
        opacity: 0.2,
        strokeWidth: 0,
      } as any,
    ],
    {},
  );
  assert.ok(calls.some((call) => call[0] === 'setAlpha' && call[1] === 0.2));
  assert.ok(calls.some((call) => call[0] === 'setStrokeWidth' && call[1] === 0));
});

test('edge edits record only explicitly changed style fields', () => {
  const result = applyOperations(makeCoreFixture(), [
    { kind: 'edgeStyle', id: 'edge', style: { color: '#cc8844', opacity: 0.4 } } as any,
  ]);
  assert.ok(result.ok);
  const edge = result.value.entities.edge;
  assert.ok(edge.kind === 'edge');
  assert.deepEqual(edge.styleOverrides, { color: '#cc8844', opacity: 0.4 });
});

const plugin: PluginDefinition = {
  manifest: { id: 'compat', name: 'Compat', version: '1.0.0', apiVersion: 1 },
  generators: [
    {
      id: 'compat.block',
      version: '1.0.0',
      paramSchemaVersion: 1,
      name: 'Block',
      description: '',
      defaults: { label: 'old', color: '#aabbcc' },
      fields: [
        { key: 'label', label: '标签', type: 'text' },
        { key: 'color', label: '填色', type: 'color' },
      ],
      generate(params) {
        const node = makeCoreFixture().entities['node-a'] as NodeEntity;
        node.id = 'root';
        node.name = String(params.label);
        return { rootKey: 'root', entities: { root: node } };
      },
    },
  ],
};

test('old local parameter bindings receive newly introduced defaults before editing', async () => {
  const doc = makeCoreFixture();
  const node = doc.entities['node-a'];
  node.generation = {
    generatorId: 'compat.block',
    version: '1.0.0',
    paramSchemaVersion: 1,
    source: { kind: 'local', params: { label: 'saved' } },
    localKeys: { root: 'node-a' },
  };
  const registry = createPluginRegistry([plugin]);
  assert.deepEqual(getGenerationParams(doc, 'node-a', registry), {
    ok: true,
    value: { label: 'saved', color: '#aabbcc' },
  });
  const result = await createGenerationServices(registry).prepare(doc, {
    kind: 'generate',
    id: 'node-a',
    generatorId: 'compat.block',
    params: { label: 'updated' },
  });
  assert.ok(result.ok);
});

test('regeneration uses fresh generated styles but retains explicit per-field edge overrides', () => {
  const doc = makeCoreFixture();
  const group = {
    id: 'root',
    kind: 'group' as const,
    parentId: null,
    name: 'network',
    size: { width: 600, height: 300 },
    ports: {},
    presentation: { position: { x: 0, y: 0 } },
    generation: {
      generatorId: 'compat.block',
      version: '1.0.0',
      paramSchemaVersion: 1,
      source: { kind: 'local' as const, params: {} },
      localKeys: { root: 'root', a: 'node-a', b: 'node-b', edge: 'edge' },
    },
  };
  doc.entities.root = group;
  for (const id of ['node-a', 'node-b', 'edge']) doc.entities[id].parentId = 'root';
  const edge = doc.entities.edge;
  assert.ok(edge.kind === 'edge');
  edge.route.spaceId = 'root';
  edge.styleOverrides = { width: 4 };
  edge.style.width = 4;
  const fresh = structuredClone(doc.entities);
  delete fresh.root.generation;
  (fresh.edge as typeof edge).style = {
    color: '#ff0000',
    width: 2,
    dashed: true,
    arrow: false,
    opacity: 0.7,
  };
  delete (fresh.edge as typeof edge).styleOverrides;
  const fragment = {
    rootKey: 'root',
    entities: {
      root: fresh.root,
      a: { ...fresh['node-a'], id: 'a' },
      b: { ...fresh['node-b'], id: 'b' },
      edge: {
        ...fresh.edge,
        source: { kind: 'port' as const, entityId: 'a', portId: 'out' },
        target: { kind: 'port' as const, entityId: 'b', portId: 'in' },
      },
    },
  };
  const result = mergeGenerated(doc, 'root', fragment);
  assert.ok(result.ok);
  const put = result.value.find((op) => op.kind === 'put' && op.entity.id === 'edge');
  assert.ok(put?.kind === 'put' && put.entity.kind === 'edge');
  assert.deepEqual(put.entity.style, {
    color: '#ff0000',
    width: 4,
    dashed: true,
    arrow: false,
    opacity: 0.7,
  });
  assert.deepEqual(put.entity.styleOverrides, { width: 4 });
});

test('a figure palette styles every real node and edge in one reversible transaction', async () => {
  const doc = makeCoreFixture();
  doc.entities.group = {
    id: 'group',
    kind: 'group',
    name: 'Group',
    parentId: null,
    size: { width: 600, height: 300 },
    ports: {},
    presentation: { position: { x: 0, y: 0 } },
  };
  const store = createDocumentStore(doc);
  const palette = figurePalettes[1];
  const plan = planApplyPalette(doc, palette);
  assert.ok(plan.ok);
  assert.ok(!plan.value.some((op) => 'id' in op && op.id === 'group'));
  const result = await store.dispatch({ baseRevision: 0, operations: plan.value });
  assert.ok(result.ok);
  for (const entity of Object.values(store.getSnapshot().entities)) {
    if (entity.kind === 'node')
      assert.deepEqual(entity.presentation, {
        ...(doc.entities[entity.id] as NodeEntity).presentation,
        fillOverride: palette.fill,
        strokeOverride: palette.stroke,
        textOverride: palette.text,
      });
    if (entity.kind === 'edge') assert.equal(entity.style.color, palette.line);
  }
  assert.equal(store.getSnapshot().page.background, palette.background);
  assert.equal(store.getSnapshot().theme.nodeColor, palette.fill);
  assert.equal(store.getSnapshot().theme.borderColor, palette.stroke);
  assert.ok(store.undo().ok);
  assert.deepEqual(store.getSnapshot().entities, doc.entities);
  assert.deepEqual(store.getSnapshot().theme, doc.theme);
  assert.deepEqual(store.getSnapshot().page, doc.page);
});

test('figure palette refuses invalid colors and locked objects before dispatch', () => {
  const doc = makeCoreFixture();
  assert.equal(planApplyPalette(doc, { ...figurePalettes[0], fill: 'red' }).ok, false);
  doc.entities['node-a'].locked = true;
  const plan = planApplyPalette(doc, figurePalettes[0]);
  assert.ok(!plan.ok && plan.error.code === 'LOCKED');
});

test('group style operations are rejected rather than pretending a group is a painted face', () => {
  const doc = makeCoreFixture();
  doc.entities.group = {
    id: 'group',
    kind: 'group',
    name: 'Group',
    parentId: null,
    size: { width: 600, height: 300 },
    ports: {},
    presentation: { position: { x: 0, y: 0 } },
  };
  assert.equal(
    applyOperations(doc, [{ kind: 'nodeStyle', id: 'group', style: { fill: '#abcdef' } }]).ok,
    false,
  );
});

test('geometry rejects invalid text colors, opacity and border widths at the generator boundary', () => {
  for (const options of [
    { textColor: 'red' },
    { opacity: -0.1 },
    { opacity: 1.1 },
    { opacity: NaN },
    { strokeWidth: -1 },
    { strokeWidth: Infinity },
  ]) {
    assert.equal(
      buildBlockGeometry(
        { width: 100, height: 60 },
        { mode: 'flat', depth: 0, stackCount: 1, stackGap: 0, angleDeg: 30 },
        options,
      ).ok,
      false,
    );
  }
});

test('removing a regenerated child protects each explicitly overridden appearance field', () => {
  for (const patch of [
    { strokeOverride: '#aabbcc' },
    { textOverride: '#aabbcc' },
    { opacityOverride: 0.5 },
    { strokeWidthOverride: 0 },
  ]) {
    const doc = makeCoreFixture();
    delete doc.entities['node-b'];
    delete doc.entities.edge;
    const root = {
      id: 'root',
      kind: 'group' as const,
      parentId: null,
      name: 'network',
      size: { width: 600, height: 300 },
      ports: {},
      presentation: { position: { x: 0, y: 0 } },
      generation: {
        generatorId: 'compat.block',
        version: '1.0.0',
        paramSchemaVersion: 1,
        source: { kind: 'local' as const, params: {} },
        localKeys: { root: 'root', child: 'node-a' },
      },
    };
    doc.entities.root = root;
    const child = doc.entities['node-a'] as NodeEntity;
    child.parentId = 'root';
    Object.assign(child.presentation, patch);
    const generated = structuredClone(root);
    delete (generated.generation.localKeys as Record<string, string>).child;
    const result = mergeGenerated(doc, 'root', { rootKey: 'root', entities: { root: generated } });
    assert.ok(!result.ok && result.error.code === 'MANUAL_CONTENT_REMOVAL', JSON.stringify(patch));
    const confirmed = mergeGenerated(
      doc,
      'root',
      { rootKey: 'root', entities: { root: generated } },
      { confirmRemoval: true },
    );
    assert.ok(confirmed.ok);
  }
});

test('legacy edge style stays readable without inventing a manual override during regeneration', () => {
  const doc = makeCoreFixture();
  const original = doc.entities.edge;
  assert.ok(original.kind === 'edge');
  assert.equal(original.styleOverrides, undefined);
  const decoded = decodeProject(encodeProject(doc));
  assert.ok(decoded.ok);
  assert.equal((decoded.value.entities.edge as typeof original).styleOverrides, undefined);
  assert.deepEqual((decoded.value.entities.edge as typeof original).style, original.style);
});

test('the shipped legacy residual project still edits child and parent parameters with new defaults', async () => {
  const saved = decodeProject(
    readFileSync(
      new URL('../../examples/projects/residual-demo.nnfig.json', import.meta.url),
      'utf8',
    ),
  );
  assert.ok(saved.ok);
  const registry = createBuiltinRegistry();
  const store = createDocumentStore(saved.value, createGenerationServices(registry));
  const child = Object.values(saved.value.entities).find(
    (entity) => entity.generation?.generatorId === 'builtin.conv',
  );
  assert.ok(child);
  const childParams = getGenerationParams(store.getSnapshot(), child.id, registry);
  assert.ok(childParams.ok);
  const changed = await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [
      {
        kind: 'generate',
        id: child.id,
        generatorId: 'builtin.conv',
        params: { ...childParams.value, angleDeg: 60 },
      },
    ],
  });
  assert.ok(changed.ok);
  const parent = Object.values(store.getSnapshot().entities).find(
    (entity) => entity.generation?.generatorId === 'example.residual',
  );
  assert.ok(parent);
  const parentParams = getGenerationParams(store.getSnapshot(), parent.id, registry);
  assert.ok(parentParams.ok);
  const updated = await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [
      {
        kind: 'generate',
        id: parent.id,
        generatorId: 'example.residual',
        params: { ...parentParams.value, channels: 256 },
      },
    ],
  });
  assert.ok(updated.ok);
  const finalParams = getGenerationParams(store.getSnapshot(), child.id, registry);
  assert.ok(finalParams.ok);
  assert.equal(finalParams.value.angleDeg, 60);
  assert.equal(finalParams.value.channels, 256);
  assert.ok(decodeProject(encodeProject(store.getSnapshot())).ok);
});
