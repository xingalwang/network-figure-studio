import { expect, it } from 'vitest';
import { createProject } from '../../src/core/document/codec.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createFigureActions } from '../../src/app/editor/figure-actions.ts';

it('panel annotation action owns transaction, workspace, selection, errors and undo', async () => {
  const store = createDocumentStore(createProject('figure', 3));
  const events: string[] = [];
  const actions = createFigureActions({
    ensureTarget: async () => ({ store, show: (id) => events.push(id) }),
    onError: (message) => events.push(`error:${message}`),
  });
  await actions.addAnnotation('独立说明');
  const [id] = Object.keys(store.getSnapshot().entities);
  expect(events).toEqual([id]);
  expect(store.getSnapshot().entities[id]).toMatchObject({
    annotation: { kind: 'manual', text: '独立说明' },
  });
  await actions.updateAnnotation(id, '修改说明');
  expect(store.getSnapshot().entities[id]).toMatchObject({ annotation: { text: '修改说明' } });
  store.undo();
  expect(store.getSnapshot().entities[id]).toMatchObject({ annotation: { text: '独立说明' } });
  store.undo();
  expect(store.getSnapshot().entities).toEqual({});
  store.setReadonly(true);
  await actions.addAnnotation('只读');
  expect(store.getSnapshot().entities).toEqual({});
  expect(events.at(-1)).toContain('error:');
});

it('cancelled copy migration never creates an annotation in the old project', async () => {
  const store = createDocumentStore(createProject('old', 2));
  const before = store.getSnapshot();
  const errors: string[] = [];
  const actions = createFigureActions({
    ensureTarget: async () => null,
    onError: (message) => errors.push(message),
  });
  await actions.addAnnotation('不会写入');
  expect(store.getSnapshot()).toBe(before);
  expect(errors).toEqual([]);
});
