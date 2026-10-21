import { expect, test } from 'vitest';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createProject } from '../../src/core/document/codec.ts';
import { createConnectionActions } from '../../src/app/editor/connection-actions.ts';
import type { ConnectionWorkspace } from '../../src/core/figure/connections.ts';
import { makeCoreFixture } from '../fixtures/project.ts';

function fixture(workspace: ConnectionWorkspace = 'drawing') {
  const doc = {
    ...makeCoreFixture(),
    ...createProject('模块连接', 3),
    entities: makeCoreFixture().entities,
  };
  delete doc.entities.edge;
  const store = createDocumentStore(doc),
    errors: string[] = [];
  let notices = 0;
  const actions = createConnectionActions({
    store,
    registry: createBuiltinRegistry(),
    context: () => ({ workspace, selection: ['node-a', 'node-b'] }),
    onError: (message) => errors.push(message),
    onSuccess: () => notices++,
  });
  return { store, errors, actions, notices: () => notices };
}

test('module connection action commits and undoes explanatory edges without changing existing geometry', async () => {
  const f = fixture(),
    before = f.store.getSnapshot();
  expect(await f.actions.applyConnectionPattern('builtin.chain', {})).toBe(true);
  expect(f.store.getSnapshot().revision).toBe(before.revision + 1);
  expect(f.notices()).toBe(1);
  for (const [id, entity] of Object.entries(before.entities))
    expect(f.store.getSnapshot().entities[id]).toEqual(entity);
  expect(
    Object.values(f.store.getSnapshot().entities).filter((entity) => entity.kind === 'edge'),
  ).toHaveLength(1);
  f.store.undo();
  expect(f.store.getSnapshot().entities).toEqual(before.entities);
  expect(f.errors).toEqual([]);
});

test('module connection action rechecks hidden endpoints and readonly state against the current document', async () => {
  const f = fixture(),
    node = f.store.getSnapshot().entities['node-b'];
  await f.store.dispatch({
    baseRevision: 0,
    operations: [{ kind: 'put', entity: { ...node, figureState: 'hidden' } }],
  });
  const hidden = f.store.getSnapshot();
  expect(await f.actions.applyConnectionPattern('builtin.chain', {})).toBe(false);
  expect(f.store.getSnapshot()).toBe(hidden);
  const readonly = fixture();
  readonly.store.setReadonly(true);
  const before = readonly.store.getSnapshot();
  expect(await readonly.actions.applyConnectionPattern('builtin.chain', {})).toBe(false);
  expect(readonly.store.getSnapshot()).toBe(before);
  expect(readonly.notices()).toBe(0);
});

test('drawing templates cannot create invisible explanatory edges between computation objects', async () => {
  const f = fixture('generator'),
    doc = f.store.getSnapshot();
  const first = doc.entities['node-a'];
  if (first.kind !== 'node') throw Error('fixture');
  await f.store.dispatch({
    baseRevision: doc.revision,
    operations: [{ kind: 'put', entity: { ...first, semantic: { role: 'tensor-source' } } }],
  });
  const before = f.store.getSnapshot();
  expect(await f.actions.applyConnectionPattern('builtin.chain', {})).toBe(false);
  expect(f.store.getSnapshot()).toBe(before);
  expect(f.errors[0]).toContain('适用运算');
});
