import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createProject, encodeProject } from '../../src/core/document/codec.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createGenerationServices, getGenerationParams } from '../../src/core/generation/merge.ts';
import { addTensorSource, appendTensorOperation } from '../../src/core/tensor-composition.ts';
import { analyzeDocument } from '../../src/core/computation/index.ts';
import { CalculationPanel } from '../../src/workspaces/generator/CalculationPanel.tsx';

async function setup(dimension: 2 | 3 = 2) {
  const registry = createBuiltinRegistry(),
    store = createDocumentStore(createProject('公式', 2), createGenerationServices(registry));
  const source = await addTensorSource(store, registry, undefined, dimension);
  if (!source.ok) throw Error(source.error.message);
  const params = getGenerationParams(store.getSnapshot(), source.value, registry);
  if (!params.ok) throw Error(params.error.message);
  await store.dispatch({
    baseRevision: store.getSnapshot().revision,
    operations: [
      {
        kind: 'generate',
        id: source.value,
        generatorId: `tensor.source${dimension}d`,
        params: { ...params.value, ...(dimension === 3 ? { D: 6 } : {}), H: 12, W: 10, C: 3 },
      },
    ],
  });
  return { registry, store, sourceId: source.value };
}

test('derived convolution formulas render actual dimensions, fractions, scripts and parameter count through native MathML', async () => {
  const c = await setup();
  const created = await appendTensorOperation(c.store, c.registry, [c.sourceId], 'conv2d', {
    kernelH: 3,
    kernelW: 3,
    strideH: 2,
    strideW: 2,
    padding: 'valid',
    outChannels: 8,
  });
  if (!created.ok) throw Error(created.error.message);
  const before = encodeProject(c.store.getSnapshot()),
    entry = analyzeDocument(c.store.getSnapshot(), c.registry.computations).nodes[
      created.value.operationId
    ];
  expect(entry.shape).toEqual({ N: 1, H: 5, W: 4, C: 8 });
  expect(entry.parameterCount).toBe(224);
  expect(entry).toHaveProperty('formulas');
  const html = renderToStaticMarkup(createElement(CalculationPanel, { entry }));
  for (const tag of ['math', 'msup', 'msub', 'mfrac']) expect(html).toContain(`<${tag}`);
  expect(html).toContain('mathvariant="normal" style="font-style:normal">Conv');
  expect(html).toContain('mathvariant="normal" style="font-style:italic">X');
  expect(html).toContain('>ℝ</mi>');
  expect(html).toContain('>224</mn>');
  expect(html).toContain('>5</mn>');
  expect(html).toContain('>4</mn>');
  expect(html).not.toContain('<mtable');
  expect(encodeProject(c.store.getSnapshot())).toBe(before);
  expect(before).not.toContain('formulas');
});

test('source formulas preserve the actual 2D and 3D axis sets and unknown source sizes remain explicit', async () => {
  for (const dimension of [2, 3] as const) {
    const c = await setup(dimension),
      doc = structuredClone(c.store.getSnapshot());
    const node = doc.entities[c.sourceId];
    if (node.generation?.source.kind !== 'local') throw Error('not local');
    node.generation.source.params.H = null;
    const entry = analyzeDocument(doc, c.registry.computations).nodes[c.sourceId];
    expect(entry.state).toBe('pending');
    expect(entry).toHaveProperty('formulas');
    const html = renderToStaticMarkup(createElement(CalculationPanel, { entry }));
    expect(html).toContain('>?</mo>');
    expect(html).toContain(dimension === 3 ? 'N × D × H × W × C' : 'N × H × W × C');
    if (dimension === 2) expect(html).not.toContain('N × D');
  }
});

test('builtins and the registered example describe their own operation while missing or unknown rules clear formulas', async () => {
  const c = await setup();
  for (const [kind, params, name] of [
    ['pool2d', {}, 'MaxPool'],
    ['relu', {}, 'ReLU'],
    ['upsample', { scaleH: 2, scaleW: 3 }, 'Upsample'],
    ['concat', { axis: 'C' }, 'Concat'],
    ['add', {}, 'Add'],
    ['example.leaky-relu', { alpha: 0.2 }, 'LeakyReLU'],
  ] as const) {
    const other = await addTensorSource(c.store, c.registry, undefined, 2);
    if (!other.ok) throw Error(other.error.message);
    const source = c.store.getSnapshot().entities[c.sourceId];
    await c.store.dispatch({
      baseRevision: c.store.getSnapshot().revision,
      operations: [
        {
          kind: 'generate',
          id: other.value,
          generatorId: 'tensor.source2d',
          params: (source.generation!.source as any).params,
        },
      ],
    });
    const result = await appendTensorOperation(
      c.store,
      c.registry,
      kind === 'concat' || kind === 'add' ? [c.sourceId, other.value] : [c.sourceId],
      kind,
      params,
    );
    if (!result.ok) throw Error(result.error.message);
    const entry = analyzeDocument(c.store.getSnapshot(), c.registry.computations).nodes[
      result.value.operationId
    ];
    const html = renderToStaticMarkup(createElement(CalculationPanel, { entry }));
    expect(html).toContain(`mathvariant="normal" style="font-style:normal">${name}`);
    if (kind === 'example.leaky-relu') {
      expect(html).toContain('>0.2</mn>');
      const doc = structuredClone(c.store.getSnapshot()),
        node = doc.entities[result.value.operationId];
      if (node.generation?.source.kind !== 'local') throw Error('not local');
      node.generation.source.params.alpha = null;
      const pending = analyzeDocument(doc, c.registry.computations).nodes[node.id];
      expect(pending.state).toBe('pending');
      expect(pending).not.toHaveProperty('formulas');
      expect(
        renderToStaticMarkup(createElement(CalculationPanel, { entry: pending })),
      ).not.toContain('>LeakyReLU</mi>');
      node.generation.version = '9.0.0';
      const unknown = analyzeDocument(doc, c.registry.computations).nodes[node.id];
      expect(unknown.state).toBe('unsupported');
      expect(unknown).not.toHaveProperty('formulas');
    }
  }
});
