import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createEditorSession } from '../../src/app/session.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createGenerationServices } from '../../src/core/generation/merge.ts';
import { makeEmptyProject } from '../fixtures/project.ts';
test('replayed canvas selection does not trigger a feedback update', () => {
  const registry = createBuiltinRegistry(),
    store = createDocumentStore(makeEmptyProject(), createGenerationServices(registry)),
    session = createEditorSession(store, registry);
  let count = 0;
  session.subscribe(() => count++);
  session.select(['a']);
  session.select(['a']);
  assert.equal(count, 1);
});
