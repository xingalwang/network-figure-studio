import { expect, test } from 'vitest';
import { makeCoreFixture } from '../fixtures/project.ts';
import { structureVisual } from '../../src/graphics/structure.ts';

test('structure cards retain port keys and show multiple readable inputs without mutating figures', () => {
  const node = makeCoreFixture().entities['node-a'];
  if (node.kind !== 'node') throw Error('fixture');
  node.ports.in2 = { x: 0, y: 45 };
  const before = structuredClone(node);
  const view = structureVisual(node);
  expect(Object.keys(view.ports)).toEqual(['in', 'out', 'in2']);
  expect(view.ports.in.x).toBe(0);
  expect(view.ports.out.x).toBe(view.bounds.width);
  expect(view.ports.in.y).not.toBe(view.ports.in2.y);
  expect(view.primitives.some((p) => p.kind === 'text' && p.text === 'Conv')).toBe(true);
  expect(node).toEqual(before);
});
