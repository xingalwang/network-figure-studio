import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import * as catalog from '../../src/builtins/layers.ts';
import { validateParams } from '../../src/plugins/registry.ts';
import { validateDocument } from '../../src/core/document/validate.ts';
import { makeEmptyProject } from '../fixtures/project.ts';
import type { GeneratorDefinition, NodeEntity, Params } from '../../src/plugins/sdk.ts';

const primitives = () =>
  (catalog as typeof catalog & { builtinPrimitives?: GeneratorDefinition[] }).builtinPrimitives ??
  catalog.layerGenerators;
const definition = (kind: string) => {
  const found = primitives().find((g) => g.id === `builtin.${kind}`);
  assert.ok(found, `Missing editable primitive: ${kind}`);
  return found;
};
async function node(kind: string, changes: Params = {}) {
  const g = definition(kind);
  const fragment = await g.generate({ ...g.defaults, ...changes }, makeEmptyProject().theme);
  const root = fragment.entities[fragment.rootKey];
  assert.equal(root.kind, 'node');
  return root as NodeEntity;
}
const text = (n: NodeEntity) =>
  n.primitives
    .filter((p) => p.kind === 'text')
    .map((p) => p.text)
    .join('\n');

describe('editable network primitive catalog', () => {
  it('generates all fundamental layers as independently editable nodes without composite ownership', async () => {
    for (const kind of [
      'feature',
      'input',
      'output',
      'conv',
      'pool',
      'linear',
      'relu',
      'norm',
      'concat',
      'add',
      'upsample',
      'flatten',
    ]) {
      const g = definition(kind);
      assert.equal(validateParams(g.fields, g.defaults).ok, true);
      const n = await node(kind);
      assert.equal(n.parentId, null);
      assert.equal(n.generation, undefined);
      assert.ok(n.ports.in && n.ports.out);
      const doc = makeEmptyProject();
      doc.entities[n.id] = n;
      assert.equal(validateDocument(doc).ok, true, kind);
      assert.equal(g.version, '1.0.0');
      assert.equal(g.paramSchemaVersion, 1);
    }
  });

  it('changes convolution kernel, stride, padding and channels in actual geometry labels', async () => {
    const n = await node('conv', { kernelSize: 7, stride: 2, padding: 3, channels: 128 });
    assert.match(text(n), /7×7/);
    assert.match(text(n), /128 ch/);
    assert.match(text(n), /s2/);
    assert.match(text(n), /p3/);
  });

  it('distinguishes max and average pooling and displays kernel and stride', async () => {
    const n = await node('pool', { poolType: 'avg', kernelSize: 3, stride: 2 });
    assert.match(text(n), /AvgPool 3×3/);
    assert.match(text(n), /s2/);
  });

  it('draws a bounded representative neuron column independently of the real unit count', async () => {
    const n = await node('linear', { units: 1024, displayCount: 5, mode: 'flat' });
    assert.equal(n.primitives.filter((p) => p.kind === 'ellipse').length, 5);
    assert.match(text(n), /1024 units/);
    assert.match(text(n), /⋮/);
    const smaller = await node('linear', { units: 3, displayCount: 8, mode: 'flat' });
    assert.equal(smaller.primitives.filter((p) => p.kind === 'ellipse').length, 3);
    assert.doesNotMatch(text(smaller), /⋮/);
  });

  it('provides stable named concat inputs from two to eight and exposes the concatenation axis', async () => {
    for (const inputCount of [2, 5, 8]) {
      const n = await node('concat', { inputCount, axis: 'height' });
      assert.deepEqual(Object.keys(n.ports), [
        'in',
        ...Array.from({ length: inputCount - 1 }, (_, i) => `in${i + 2}`),
        'out',
      ]);
      const inputs = Object.entries(n.ports)
        .filter(([key]) => key !== 'out')
        .map(([, p]) => p);
      assert.equal(new Set(inputs.map((p) => JSON.stringify(p))).size, inputCount);
      assert.match(text(n), new RegExp(`${inputCount} inputs`));
      assert.match(text(n), /height/);
    }
    assert.equal(
      validateParams(definition('concat').fields, {
        ...definition('concat').defaults,
        inputCount: 9,
      }).ok,
      false,
    );
  });

  it('retains the legacy Add skip port while allowing extra independent inputs', async () => {
    const n = await node('add', { inputCount: 4 });
    assert.deepEqual(Object.keys(n.ports), ['in', 'in2', 'in3', 'in4', 'out', 'skip']);
    assert.deepEqual(n.ports.skip, { x: 21, y: 0 });
    assert.ok(n.primitives.some((p) => p.kind === 'ellipse'));
  });

  it('places every extra Add input on its circular boundary without overlapping the legacy ports', async () => {
    for (const inputCount of [2, 3, 4, 8]) {
      const n = await node('add', { inputCount });
      const positions = Object.values(n.ports);
      assert.equal(new Set(positions.map((p) => JSON.stringify(p))).size, inputCount + 2);
      for (const port of positions) {
        assert.ok('x' in port);
        const radiusX = n.size.width / 2,
          radiusY = n.size.height / 2;
        const onBoundary =
          ((port.x - radiusX) / radiusX) ** 2 + ((port.y - radiusY) / radiusY) ** 2;
        assert.ok(Math.abs(onBoundary - 1) < 1e-9);
      }
    }
  });

  it('shows normalization, activation, upsampling and flatten semantics rather than relabeling one fixed layer', async () => {
    assert.match(text(await node('norm', { normType: 'layer' })), /LayerNorm/);
    assert.match(text(await node('relu', { activation: 'gelu' })), /GELU/);
    assert.match(text(await node('upsample', { scaleFactor: 4, interpolation: 'bilinear' })), /×4/);
    assert.match(
      text(await node('upsample', { scaleFactor: 4, interpolation: 'bilinear' })),
      /bilinear/,
    );
    assert.match(
      text(await node('flatten', { tensorWidth: 8, tensorHeight: 8, channels: 16 })),
      /1024/,
    );
  });

  it('separates diagram dimensions from tensor dimensions and keeps front ports on the resized face', async () => {
    const n = await node('conv', {
      drawWidth: 150,
      drawHeight: 90,
      tensorWidth: 512,
      tensorHeight: 256,
      showDimensions: true,
    });
    assert.deepEqual(n.size, { width: 150, height: 90 });
    assert.deepEqual(n.ports.in, { x: 0, y: 45 });
    assert.deepEqual(n.ports.out, { x: 150, y: 45 });
    assert.match(text(n), /512×256/);
  });

  it('applies editable fill, border, text, stroke width and opacity while preserving shaded 3D faces', async () => {
    const n = await node('conv', {
      fillColor: '#6699cc',
      borderColor: '#123456',
      textColor: '#ff8800',
      strokeWidth: 3,
      opacity: 0.4,
    });
    const shapes = n.primitives.filter((p) => p.kind !== 'text' && p.kind !== 'image');
    assert.ok(shapes.some((p) => p.fill === '#6699cc'));
    assert.ok(shapes.some((p) => p.fill !== '#6699cc'));
    assert.ok(
      shapes.every((p) => p.stroke === '#123456' && 'strokeWidth' in p && p.strokeWidth === 3),
    );
    assert.ok(n.primitives.every((p) => 'opacity' in p && p.opacity === 0.4));
    assert.ok(n.primitives.filter((p) => p.kind === 'text').every((p) => p.color === '#ff8800'));
  });

  it('normalizes legacy partial factory parameters without mutating them', () => {
    const old = {
      channels: 128,
      label: 'Old Conv',
      mode: 'flat',
      depth: 24,
      stackCount: 1,
      stackGap: 6,
      angleDeg: 30,
    };
    const saved = structuredClone(old);
    const n = catalog.createLayerNode('conv', old, makeEmptyProject().theme);
    assert.deepEqual(n.size, { width: 64, height: 112 });
    assert.match(text(n), /Old Conv/);
    assert.deepEqual(old, saved);
    assert.equal(n.primitives.filter((p) => p.kind === 'rect').length, 1);
  });

  it('uses theme defaults only when the factory caller omitted explicit color parameters', () => {
    const theme = {
      ...makeEmptyProject().theme,
      nodeColor: '#445566',
      borderColor: '#778899',
      textColor: '#112233',
    };
    const inherited = catalog.createLayerNode('conv', {}, theme);
    const explicit = catalog.createLayerNode(
      'conv',
      { fillColor: '#abcdef', borderColor: '#fedcba', textColor: '#ff8800' },
      theme,
    );
    assert.ok(
      inherited.primitives.some(
        (p) => p.kind === 'rect' && p.fill === '#445566' && p.stroke === '#778899',
      ),
    );
    assert.ok(inherited.primitives.some((p) => p.kind === 'text' && p.color === '#112233'));
    assert.ok(
      explicit.primitives.some(
        (p) => p.kind === 'rect' && p.fill === '#abcdef' && p.stroke === '#fedcba',
      ),
    );
  });
});
