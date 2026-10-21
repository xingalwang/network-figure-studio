import { expect, test } from 'vitest';
import { createProject, decodeProject, encodeProject } from '../../src/core/document/codec.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import type { EdgeEntity, GroupEntity, NodeEntity } from '../../src/core/document/types.ts';
import { connectionTargets, planConnection } from '../../src/core/figure/connections.ts';

function fixture() {
  const doc = createProject('连接端点', 3);
  const node = (id: string): NodeEntity => ({
    id,
    kind: 'node',
    parentId: null,
    name: id,
    size: { width: 80, height: 40 },
    bounds: { x: 0, y: 0, width: 80, height: 40 },
    primitives: [],
    ports: { in: { x: 0, y: 20 }, out: { x: 80, y: 20 } },
    presentation: { position: { x: 130, y: 70 }, fillOverride: '#aabbcc', moved: true },
  });
  const computation = { ...node('computation'), semantic: { role: 'tensor-source' as const } };
  const source = {
    ...node('source'),
    figure: { role: 'representation' as const, semanticRef: computation.id },
  };
  const target = {
    ...node('target'),
    figure: { role: 'representation' as const, semanticRef: computation.id },
  };
  const hidden = { ...node('hidden'), figureState: 'hidden' as const };
  const unplaced = { ...node('unplaced'), figureState: 'unplaced' as const };
  const note = { ...node('note'), ports: {} };
  const parent: GroupEntity = {
    id: 'parent',
    kind: 'group',
    parentId: null,
    name: 'hidden parent',
    figureState: 'hidden',
    size: { width: 80, height: 40 },
    ports: {},
    presentation: { position: { x: 0, y: 0 } },
  };
  const child = { ...node('child'), parentId: parent.id };
  const legacy: EdgeEntity = {
    id: 'old-invisible-edge',
    kind: 'edge',
    parentId: null,
    name: '保留旧连线',
    source: { kind: 'port', entityId: computation.id, portId: 'out' },
    target: { kind: 'port', entityId: target.id, portId: 'in' },
    route: { kind: 'curve', mode: 'manual', spaceId: null, points: [{ x: 240, y: 180 }] },
    label: '旧工程手工标签',
    style: { color: '#334455', width: 3, dashed: true, arrow: false },
  };
  doc.entities = Object.fromEntries(
    [computation, source, target, hidden, unplaced, note, parent, child, legacy].map((e) => [
      e.id,
      e,
    ]),
  );
  return { doc, source, target, computation };
}

test('drawing targets contain only visible port-bearing drawing objects', () => {
  const { doc, source, target } = fixture();
  expect(connectionTargets(doc, source.id, 'drawing').map((e) => e.id)).toEqual([target.id]);
  expect(connectionTargets(doc, 'child', 'drawing')).toEqual([]);
  expect(connectionTargets(doc, 'computation', 'drawing')).toEqual([]);
});

test('submission rejects computation endpoints, hidden parents, missing objects and stale ports', () => {
  const { doc, source, target } = fixture();
  for (const [a, b] of [
    ['computation', target.id],
    [source.id, 'computation'],
    [source.id, 'hidden'],
    ['child', target.id],
    ['gone', target.id],
    [source.id, 'gone'],
    [source.id, source.id],
  ])
    expect(planConnection(doc, a, 'out', b, 'in', 'drawing').ok).toBe(false);
  delete target.ports.in;
  expect(planConnection(doc, source.id, 'out', target.id, 'in', 'drawing')).toMatchObject({
    ok: false,
    error: { code: 'MISSING_PORT' },
  });
  expect(planConnection(doc, source.id, 'removed', target.id, 'out', 'drawing')).toMatchObject({
    ok: false,
    error: { code: 'MISSING_PORT' },
  });
});

test('adding and undoing a valid connection preserves every old edge and manual presentation', async () => {
  const { doc, source, target } = fixture();
  expect(decodeProject(encodeProject(doc)).ok).toBe(true);
  const before = structuredClone(doc);
  const store = createDocumentStore(doc);
  const plan = planConnection(store.getSnapshot(), source.id, 'out', target.id, 'in', 'drawing');
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect((await store.dispatch({ baseRevision: doc.revision, operations: plan.value })).ok).toBe(
    true,
  );
  for (const [id, entity] of Object.entries(before.entities))
    expect(store.getSnapshot().entities[id]).toEqual(entity);
  expect(
    planConnection(store.getSnapshot(), source.id, 'out', target.id, 'in', 'drawing'),
  ).toMatchObject({ ok: false, error: { code: 'DUPLICATE_CONNECTION' } });
  const reloaded = decodeProject(encodeProject(store.getSnapshot()));
  expect(reloaded.ok && reloaded.value.entities['old-invisible-edge']).toEqual(
    before.entities['old-invisible-edge'],
  );
  store.undo();
  expect(store.getSnapshot().entities).toEqual(before.entities);
});

test.each([1, 2] as const)('v%s existing visible objects remain connectable', async (version) => {
  const { source, target } = fixture();
  const doc = createProject('旧工程连接', version);
  doc.entities = { [source.id]: source, [target.id]: target };
  delete doc.entities[source.id].figure;
  delete doc.entities[target.id].figure;
  const store = createDocumentStore(doc);
  const plan = planConnection(doc, source.id, 'out', target.id, 'in', 'drawing');
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  expect((await store.dispatch({ baseRevision: doc.revision, operations: plan.value })).ok).toBe(
    true,
  );
  expect(decodeProject(encodeProject(store.getSnapshot())).ok).toBe(true);
});
