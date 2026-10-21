import { expect, test, vi } from 'vitest';
import {
  createWorkspaceActions,
  type GeneratorMode,
} from '../../src/app/editor/workspace-actions.ts';
import { operationCapability } from '../../src/app/editor/capabilities.ts';
import { createBuiltinRegistry } from '../../src/builtins/registry.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { createProject } from '../../src/core/document/codec.ts';
import { createGenerationServices } from '../../src/core/generation/merge.ts';
import { createEditorSession } from '../../src/app/session.ts';
import type { TensorOperationDraft } from '../../src/app/editor/model.ts';

function fixture() {
  const registry = createBuiltinRegistry();
  const store = createDocumentStore(
    createProject('统一组装动作', 2),
    createGenerationServices(registry),
  );
  const session = createEditorSession(store, registry);
  let mode: GeneratorMode = 'assembly';
  const errors: string[] = [],
    edits: string[] = [],
    reveals: string[] = [],
    operations: TensorOperationDraft[] = [];
  const enabledOperationIds = new Set([...registry.computations.keys()]);
  const fit = vi.fn(),
    confirmDiscard = vi.fn(() => true);
  const actions = () =>
    createWorkspaceActions({
      store,
      session,
      registry,
      mode,
      setMode: (value) => {
        mode = value;
      },
      setRightTab() {},
      requestEdit: (id) => edits.push(id),
      ensureComputationTarget: async () => ({ store, session }),
      beginOperationDraft: (draft) => {
        operations.push(draft);
        return true;
      },
      cancelOperation() {},
      enabledOperationIds,
      onError: (message) => errors.push(message),
      onNotice() {},
      fit,
      reveal: (id) => reveals.push(id),
      confirmDiscard,
    });
  return {
    store,
    session,
    registry,
    errors,
    edits,
    reveals,
    operations,
    enabledOperationIds,
    actions,
    fit,
    confirmDiscard,
    mode: () => mode,
  };
}

// Keep scheduled viewport work synchronous; no real canvas is needed to verify the complete command.
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  callback(0);
  return 1;
});

test('mixing tensor and free primitive creation keeps one assembly mode and complete operation/edit actions', async () => {
  const f = fixture();
  await f.actions().addTensor({ x: 40, y: 70 }, 2);
  const tensor = f.session.getSnapshot().selection[0];
  await f.actions().add('builtin.relu', { x: 300, y: 170 });
  const primitive = f.session.getSnapshot().selection[0];
  expect(primitive).not.toBe(tensor);
  expect(f.mode()).toBe('assembly');
  expect(f.session.getSnapshot().workspace).toBe('generator');
  f.actions().editTensor(tensor);
  f.actions().beginOperation('tensor.relu', [tensor]);
  expect(f.edits).toEqual([tensor]);
  expect(f.operations).toEqual([{ kind: 'tensor.relu', sourceIds: [tensor] }]);
  f.actions().editTensor(primitive);
  expect(f.edits).toEqual([tensor, primitive]);
  expect(f.errors).toEqual([]);
  expect(f.fit).not.toHaveBeenCalled();
  expect(f.reveals).toEqual([tensor, primitive]);
});

test('operation affordance and action agree on rank, module settings, readonly and workspace', async () => {
  const f = fixture();
  await f.actions().addTensor(undefined, 2);
  const tensor = f.session.getSnapshot().selection[0],
    doc = f.store.getSnapshot();
  const capability = (id: string) =>
    operationCapability(f.registry, doc, [tensor], id, {
      workspace: f.session.getSnapshot().workspace,
      readonly: f.store.isReadonly(),
      enabledOperationIds: f.enabledOperationIds,
    });
  expect(capability('tensor.conv3d').reason).toContain('3D');
  f.actions().beginOperation('tensor.conv3d', [tensor]);
  expect(f.operations).toEqual([]);
  expect(f.errors.at(-1)).toBe(capability('tensor.conv3d').reason);
  f.enabledOperationIds.delete('tensor.relu');
  f.actions().beginOperation('tensor.relu', [tensor]);
  expect(f.errors.at(-1)).toBe(capability('tensor.relu').reason);
  f.enabledOperationIds.add('tensor.relu');
  f.actions().enterDrawing();
  f.actions().beginOperation('tensor.relu', [tensor]);
  expect(f.errors.at(-1)).toBe(capability('tensor.relu').reason);
  f.actions().enterTensor();
  f.store.setReadonly(true);
  f.actions().beginOperation('tensor.relu', [tensor]);
  expect(f.errors.at(-1)).toBe(capability('tensor.relu').reason);
  expect(f.operations).toEqual([]);
  expect(f.store.getSnapshot()).toBe(doc);
});

test('legacy preset entry and return are explicit and declining its draft discard keeps the current flow', () => {
  const f = fixture();
  f.actions().enterLegacy();
  expect(f.mode()).toBe('component');
  f.session.setParams({ ...f.session.getSnapshot().params, repeats: 4 });
  f.confirmDiscard.mockReturnValue(false);
  expect(f.actions().enterTensor()).toBe(false);
  expect(f.mode()).toBe('component');
  expect(f.session.getSnapshot().params.repeats).toBe(4);
  f.confirmDiscard.mockReturnValue(true);
  f.actions().returnToBuild();
  expect(f.mode()).toBe('assembly');
  expect(f.session.getSnapshot().workspace).toBe('generator');
});

test('adding a free drawing element in the figure workspace preserves its workspace and existing objects', async () => {
  const f = fixture();
  await f.actions().addTensor(undefined, 3);
  const before = f.store.getSnapshot();
  f.actions().enterDrawing();
  await f.actions().add('builtin.relu', { x: 180, y: 90 });
  expect(f.session.getSnapshot().workspace).toBe('drawing');
  for (const [id, entity] of Object.entries(before.entities))
    expect(f.store.getSnapshot().entities[id]).toEqual(entity);
  expect(f.store.undo().ok).toBe(true);
  expect(f.store.getSnapshot().entities).toEqual(before.entities);
});
