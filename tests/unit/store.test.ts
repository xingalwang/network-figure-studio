import { it, test } from 'vitest';
import assert from 'node:assert/strict';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { makeCoreFixture } from '../fixtures/project.ts';
import type { NodeEntity } from '../../src/core/document/types';
it('rejects a whole transaction, not only its invalid operation', async () => {
  const store = createDocumentStore(makeCoreFixture());
  const before = store.getSnapshot();
  const r = await store.dispatch({
    baseRevision: 0,
    operations: [
      { kind: 'move', id: 'node-a', position: { x: 20, y: 30 } },
      {
        kind: 'reconnect',
        id: 'edge',
        end: 'target',
        endpoint: { kind: 'port', entityId: 'node-b', portId: 'missing' },
      },
    ],
  });
  assert.equal(r.ok, false);
  assert.equal(store.getSnapshot(), before);
  assert.equal(store.canUndo(), false);
});
it('commits one gesture once, with monotonic undo/redo revisions', async () => {
  const s = createDocumentStore(makeCoreFixture());
  await s.dispatch({
    baseRevision: 0,
    operations: [
      { kind: 'move', id: 'node-a', position: { x: 20, y: 30 } },
      { kind: 'label', id: 'node-a', text: '编码器' },
    ],
  });
  assert.equal(s.getSnapshot().revision, 1);
  s.undo();
  assert.deepEqual((s.getSnapshot().entities['node-a'] as NodeEntity).presentation.position, {
    x: 120,
    y: 160,
  });
  assert.equal(s.getSnapshot().revision, 2);
  s.redo();
  assert.equal(
    (s.getSnapshot().entities['node-a'] as NodeEntity).presentation.labelOverride,
    '编码器',
  );
  assert.equal(s.getSnapshot().revision, 3);
  assert.equal((await s.dispatch({ baseRevision: 1, operations: [] })).ok, false);
});
it('refuses writes and undo while readonly', async () => {
  const s = createDocumentStore(makeCoreFixture());
  s.setReadonly(true);
  assert.equal(
    (
      await s.dispatch({
        baseRevision: 0,
        operations: [{ kind: 'label', id: 'node-a', text: 'bad' }],
      })
    ).ok,
    false,
  );
  assert.equal(s.undo().ok, false);
});
it('rejects asynchronous results made stale by another edit', async () => {
  let release: () => void = () => {};
  const wait = new Promise<void>((r) => (release = r));
  const s = createDocumentStore(makeCoreFixture(), {
    prepare: async () => {
      await wait;
      return { ok: true, value: [{ kind: 'label', id: 'node-a', text: 'old' }] };
    },
  });
  const pending = s.dispatch({
    baseRevision: 0,
    operations: [{ kind: 'generate', id: 'node-a', generatorId: 'test', params: {} }],
  });
  await s.dispatch({ baseRevision: 0, operations: [{ kind: 'label', id: 'node-a', text: 'new' }] });
  release();
  assert.equal((await pending).ok, false);
  assert.equal(
    (s.getSnapshot().entities['node-a'] as NodeEntity).presentation.labelOverride,
    'new',
  );
});
it('limits history to 100 complete operations', async () => {
  const s = createDocumentStore(makeCoreFixture());
  for (let i = 0; i < 105; i++)
    await s.dispatch({
      baseRevision: s.getSnapshot().revision,
      operations: [{ kind: 'label', id: 'node-a', text: String(i) }],
    });
  for (let i = 0; i < 100; i++) assert.equal(s.undo().ok, true);
  assert.equal(s.undo().ok, false);
});

test('a failing subscriber cannot turn a committed transaction into a reported failure', async () => {
  const errors: unknown[] = [],
    store = createDocumentStore(makeCoreFixture(), undefined, (error) => errors.push(error));
  let healthyCalls = 0;
  store.subscribe(() => {
    throw Error('projection failed');
  });
  store.subscribe(() => healthyCalls++);
  const result = await store.dispatch({
    baseRevision: 0,
    operations: [{ kind: 'metadata', title: '已提交' }],
  });
  assert.ok(result.ok);
  assert.equal(store.getSnapshot().title, '已提交');
  assert.equal(store.getSnapshot().revision, 1);
  assert.equal(healthyCalls, 1);
  assert.equal(errors.length, 1);
  assert.ok(store.undo().ok);
  assert.equal(store.getSnapshot().revision, 2);
});
