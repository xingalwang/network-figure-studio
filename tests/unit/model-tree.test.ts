import { test, expect } from 'vitest';
import { makeCoreFixture } from '../fixtures/project.ts';
import { buildStructureForest } from '../../src/workspaces/generator/model-tree.ts';
import type { NodeEntity, EdgeEntity } from '../../src/core/document/types.ts';

test('structure navigation visits shared merge nodes once and remains finite for cyclic dataflow', () => {
  const doc = makeCoreFixture();
  const base = doc.entities['node-a'] as NodeEntity;
  doc.entities = Object.fromEntries(
    ['a', 'b', 'c', 'd'].map((id) => [
      id,
      {
        ...base,
        id,
        parentId: null,
        name: id,
        semantic: { role: id === 'a' ? 'tensor-source' : 'tensor-result' },
      },
    ]),
  );
  for (const [i, [from, to]] of [
    ['a', 'b'],
    ['b', 'c'],
    ['a', 'd'],
    ['d', 'c'],
    ['c', 'a'],
  ].entries()) {
    doc.entities['e' + i] = {
      id: 'e' + i,
      kind: 'edge',
      parentId: null,
      name: 'flow',
      meaning: 'dataflow',
      source: { kind: 'port', entityId: from, portId: 'out' },
      target: { kind: 'port', entityId: to, portId: 'in' },
      route: { kind: 'orthogonal', mode: 'auto', points: [], spaceId: null },
      style: { color: '#333333', width: 1, arrow: true, dashed: false },
    } satisfies EdgeEntity;
  }
  const flatten = (rows: ReturnType<typeof buildStructureForest>): string[] =>
    rows.flatMap((r) => [r.entity.id, ...flatten(r.children)]);
  const forest = buildStructureForest(doc);
  expect(flatten(forest)).toEqual(['a', 'b', 'c', 'd']);
  expect(forest[0].children.map((r) => r.entity.id)).toEqual(['b', 'd']);
});
