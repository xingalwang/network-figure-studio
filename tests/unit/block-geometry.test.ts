import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { buildBlockGeometry } from '../../src/graphics/block-geometry.ts';
import { validateDocument } from '../../src/core/document/validate.ts';
import { makeCoreFixture } from '../fixtures/project.ts';
import type { BlockAppearance, BlockGeometry, Primitive } from '../../src/graphics/primitives.ts';

const size = { width: 100, height: 60 };
const appearance: BlockAppearance = {
  mode: 'flat',
  depth: 24,
  stackCount: 3,
  stackGap: 6,
  angleDeg: 30,
};

function pointsOf(primitive: Primitive) {
  return primitive.kind === 'polygon'
    ? primitive.points
    : [
        { x: primitive.x, y: primitive.y },
        { x: primitive.x + primitive.width, y: primitive.y + primitive.height },
      ];
}

function assertCompleteBounds(geometry: BlockGeometry) {
  const points = geometry.primitives.flatMap(pointsOf);
  const left = Math.min(...points.map((p) => p.x));
  const top = Math.min(...points.map((p) => p.y));
  const right = Math.max(...points.map((p) => p.x));
  const bottom = Math.max(...points.map((p) => p.y));
  for (const p of points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.deepEqual(geometry.bounds, { x: left, y: top, width: right - left, height: bottom - top });
}

function assertNear(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should be close to ${expected}`);
}

describe('block geometry', () => {
  it('keeps the front face and ports fixed in flat mode without changing saved 3D parameters', () => {
    const saved = Object.freeze({ ...appearance });
    const result = buildBlockGeometry(size, saved, { fill: '#90c9c9', stroke: '#374151' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, {
      primitives: [{ kind: 'rect', x: 0, y: 0, ...size, fill: '#90c9c9', stroke: '#374151' }],
      ports: { in: { x: 0, y: 30 }, out: { x: 100, y: 30 } },
      bounds: { x: 0, y: 0, ...size },
    });
    assert.deepEqual(saved, appearance);
  });

  it('creates a flat ellipse using the same front-face port positions', () => {
    const result = buildBlockGeometry(size, appearance, { shape: 'ellipse' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.primitives[0].kind, 'ellipse');
    assert.deepEqual(result.value.ports, { in: { x: 0, y: 30 }, out: { x: 100, y: 30 } });
    assert.deepEqual(result.value.bounds, { x: 0, y: 0, ...size });
  });

  for (const [angleDeg, expected] of [
    [0, { x: 0, y: 0, width: 136, height: 60 }],
    [30, { x: 0, y: -18, width: 131.1769145362398, height: 78 }],
    [90, { x: 0, y: -36, width: 100, height: 96 }],
  ] as const)
    it(`projects thickness and per-sheet offsets at ${angleDeg} degrees without moving the front face`, () => {
      const result = buildBlockGeometry(size, { ...appearance, mode: 'axonometric', angleDeg });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      for (const key of ['x', 'y', 'width', 'height'] as const)
        assertNear(result.value.bounds[key], expected[key]);
      const fronts = result.value.primitives.filter((p) => p.kind === 'rect');
      assert.equal(fronts.length, 3);
      assert.deepEqual(fronts.at(-1), {
        kind: 'rect',
        x: 0,
        y: 0,
        ...size,
        fill: '#90c9c9',
        stroke: '#374151',
      });
      assert.deepEqual(result.value.ports, { in: { x: 0, y: 30 }, out: { x: 100, y: 30 } });
      assertCompleteBounds(result.value);
    });

  for (const depth of [0, 24, 96])
    for (const stackCount of [1, 3, 16])
      for (const angleDeg of [0, 30, 90]) {
        it(`contains finite, non-degenerate geometry for depth ${depth}, count ${stackCount}, angle ${angleDeg}`, () => {
          const result = buildBlockGeometry(size, {
            ...appearance,
            mode: 'axonometric',
            depth,
            stackCount,
            angleDeg,
          });
          assert.equal(result.ok, true);
          if (!result.ok) return;
          assertCompleteBounds(result.value);
          assert.equal(result.value.primitives.filter((p) => p.kind === 'rect').length, stackCount);
          const faces = result.value.primitives.filter((p) => p.kind === 'polygon');
          if (depth === 0) assert.equal(faces.length, 0);
          for (const face of faces) {
            let twiceArea = 0;
            face.points.forEach((p, i) => {
              const next = face.points[(i + 1) % face.points.length];
              twiceArea += p.x * next.y - next.x * p.y;
            });
            assert.ok(Math.abs(twiceArea) > 1e-9, 'zero-area projected faces must be omitted');
          }
        });
      }

  for (const angleDeg of [0, 30, 90])
    it(`projects ellipse stacks at ${angleDeg} degrees with stable ports and complete bounds`, () => {
      const result = buildBlockGeometry(
        size,
        { ...appearance, mode: 'axonometric', angleDeg },
        { shape: 'ellipse' },
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.primitives.filter((p) => p.kind === 'ellipse').length, 3);
      assert.ok(result.value.primitives.some((p) => p.kind === 'polygon'));
      assert.deepEqual(result.value.ports, { in: { x: 0, y: 30 }, out: { x: 100, y: 30 } });
      assertCompleteBounds(result.value);
    });

  for (const invalidSize of [{ width: 0 }, { height: -1 }, { width: NaN }, { height: Infinity }]) {
    it(`rejects non-positive or non-finite size ${JSON.stringify(invalidSize)}`, () => {
      assert.equal(buildBlockGeometry({ ...size, ...invalidSize }, appearance).ok, false);
    });
  }

  for (const invalidAppearance of [
    { depth: -1 },
    { depth: NaN },
    { depth: Infinity },
    { stackGap: -1 },
    { stackGap: NaN },
    { stackGap: Infinity },
    { stackCount: 0 },
    { stackCount: 17 },
    { stackCount: 1.5 },
    { stackCount: NaN },
    { stackCount: Infinity },
    { angleDeg: -1 },
    { angleDeg: 91 },
    { angleDeg: NaN },
    { angleDeg: Infinity },
  ])
    it(`rejects invalid appearance ${JSON.stringify(invalidAppearance)} even in flat mode`, () => {
      assert.equal(buildBlockGeometry(size, { ...appearance, ...invalidAppearance }).ok, false);
    });

  it('rejects finite inputs whose projected extent overflows', () => {
    const result = buildBlockGeometry(size, {
      ...appearance,
      mode: 'axonometric',
      depth: Number.MAX_VALUE,
      stackGap: Number.MAX_VALUE,
    });
    assert.equal(result.ok, false);
  });

  it('does not overflow ellipse sampling for a finite, representable extent', () => {
    const result = buildBlockGeometry(
      { width: Number.MAX_VALUE, height: 60 },
      {
        ...appearance,
        mode: 'axonometric',
        stackCount: 1,
        angleDeg: 0,
      },
      { shape: 'ellipse' },
    );
    assert.equal(result.ok, true);
    if (result.ok) assertCompleteBounds(result.value);
  });

  it('centers a short Chinese label inside the original front face', () => {
    const result = buildBlockGeometry(
      size,
      { ...appearance, mode: 'axonometric' },
      { label: '卷积' },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const text = result.value.primitives.find((p) => p.kind === 'text');
    assert.ok(text && text.kind === 'text');
    assert.equal(text.text, '卷积');
    assert.equal(text.x + text.width / 2, 50);
    assert.equal(text.y + text.height / 2, 30);
    assertCompleteBounds(result.value);
  });

  it('splits long Chinese labels below a narrow face and includes their full extent in bounds', () => {
    const label = '非常非常长的中文层标签用于论文绘图';
    const result = buildBlockGeometry(size, appearance, { label });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const lines = result.value.primitives.filter((p) => p.kind === 'text');
    assert.ok(lines.length > 1);
    assert.equal(lines.map((p) => p.text).join(''), label);
    assert.ok(lines.every((p) => p.y >= size.height + 8 && !p.text.includes('\n')));
    assert.ok(result.value.bounds.x < 0);
    assert.ok(result.value.bounds.width > size.width);
    assert.ok(result.value.bounds.height > size.height);
    assert.deepEqual(result.value.ports, { in: { x: 0, y: 30 }, out: { x: 100, y: 30 } });
    assertCompleteBounds(result.value);
  });

  it('preserves explicit line breaks as separate text primitives without relying on painter wrapping', () => {
    const result = buildBlockGeometry(size, appearance, { label: '输入\r\n\r\n输出' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const lines = result.value.primitives.filter((p) => p.kind === 'text');
    assert.deepEqual(
      lines.map((p) => p.text),
      ['输入', '', '输出'],
    );
    assert.ok(lines.every((p) => p.width > 0 && p.height > 0));
    assert.equal(lines[2].y - lines[0].y, lines[0].height * 2);
    assertCompleteBounds(result.value);
  });

  it('puts labels below faces too short to contain a readable line', () => {
    const result = buildBlockGeometry({ width: 100, height: 8 }, appearance, { label: 'CNN' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const text = result.value.primitives.find((p) => p.kind === 'text');
    assert.ok(text && text.y >= 16);
    assertCompleteBounds(result.value);
  });

  it('keeps labels readable on a dark fill without changing outside-label color', () => {
    const inside = buildBlockGeometry(size, appearance, { fill: '#000000', label: 'CNN' });
    const outside = buildBlockGeometry(size, appearance, { fill: '#000000', label: 'CNN\n模型' });
    assert.equal(inside.ok, true);
    assert.equal(outside.ok, true);
    if (!inside.ok || !outside.ok) return;
    const innerText = inside.value.primitives.find((p) => p.kind === 'text');
    const outerText = outside.value.primitives.find((p) => p.kind === 'text');
    assert.ok(innerText?.kind === 'text' && outerText?.kind === 'text');
    assert.equal(innerText.color, '#ffffff');
    assert.notEqual(outerText.color, '#ffffff');
  });

  it('omits empty labels rather than producing empty zero-size boxes', () => {
    for (const label of ['', '  ', '\n']) {
      const result = buildBlockGeometry(size, appearance, { label });
      assert.equal(result.ok, true);
      if (result.ok)
        assert.equal(
          result.value.primitives.some((p) => p.kind === 'text'),
          false,
        );
    }
  });

  for (const options of [
    { fill: 'red' },
    { stroke: '#abc' },
    { shape: 'triangle' },
    { label: 123 },
  ])
    it(`rejects options outside the portable primitive contract: ${JSON.stringify(options)}`, () => {
      assert.equal(buildBlockGeometry(size, appearance, options as any).ok, false);
    });

  it('rejects an unknown appearance mode rather than treating it as axonometric', () => {
    assert.equal(buildBlockGeometry(size, { ...appearance, mode: 'unknown' } as any).ok, false);
  });

  it('produces geometry that can be saved through the actual document validator', () => {
    const result = buildBlockGeometry(
      size,
      { ...appearance, mode: 'axonometric' },
      { label: '输入\n特征图', shape: 'ellipse' },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const doc = makeCoreFixture();
    const node = doc.entities['node-a'];
    assert.equal(node.kind, 'node');
    if (node.kind !== 'node') return;
    Object.assign(node, result.value, { size });
    assert.equal(validateDocument(doc).ok, true);
  });
});
