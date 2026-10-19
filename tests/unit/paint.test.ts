import { test } from 'vitest';
import assert from 'node:assert/strict';
import { paintPrimitives, nodeVisual } from '../../src/graphics/paint.ts';
import { makeCoreFixture } from '../fixtures/project.ts';
test('same painter emits native paths and plain text, and embeds declared image asset', () => {
  const calls: any[] = [];
  const c = new Proxy(
    {},
    {
      get:
        (_, k) =>
        (...args: any[]) =>
          calls.push([k, ...args]),
    },
  );
  paintPrimitives(
    c as any,
    [
      { kind: 'rect', x: 0, y: 0, width: 20, height: 30, fill: '#ffffff', stroke: '#000000' },
      {
        kind: 'text',
        x: 0,
        y: 35,
        width: 80,
        height: 20,
        text: '编码器',
        fontSize: 14,
        color: '#111111',
      },
      { kind: 'image', x: 0, y: 60, width: 20, height: 20, assetId: 'img' },
    ],
    { img: { mime: 'image/png', data: 'data:image/png;base64,AA==', width: 20, height: 20 } },
  );
  assert.ok(calls.some((x) => x[0] === 'rect'));
  assert.equal(calls.find((x) => x[0] === 'text')[5], '编码器');
  assert.equal(calls.find((x) => x[0] === 'text')[1], 40);
  assert.equal(calls.find((x) => x[0] === 'text')[2], 45);
  assert.equal(calls.find((x) => x[0] === 'image')[5], 'data:image/png;base64,AA==');
});
test('manual long label expands visual bounds without moving origin or ports', () => {
  const n = makeCoreFixture().entities['node-a'];
  if (n.kind !== 'node') throw Error();
  n.presentation.labelOverride = '一段很长的编码器手工标签';
  const v = nodeVisual(n);
  assert.ok(v.bounds.width > n.bounds.width);
  assert.deepEqual(n.presentation.position, { x: 120, y: 160 });
});
