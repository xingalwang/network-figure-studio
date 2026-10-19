import {
  fail,
  type DocumentStore,
  type Params,
  type ProjectDocument,
  type Point,
  type CommitResult,
} from '../core/document/types.ts';
import type { PluginRegistry } from '../plugins/registry.ts';
import { createDocumentStore } from '../core/commands/store.ts';
import { createProject } from '../core/document/codec.ts';
import { createGenerationServices } from '../core/generation/merge.ts';
import { beginDraft, checkDraft, type GenerationDraft } from '../core/generation/draft.ts';
export type SessionState = {
  workspace: 'generator' | 'drawing';
  selection: string[];
  generatorId: string;
  params: Params;
  draft: GenerationDraft | null;
  placing: boolean;
  preview: ProjectDocument | null;
  previewLoading: boolean;
  error: string | null;
};
export function createEditorSession(store: DocumentStore, registry: PluginRegistry) {
  const initial =
    registry.generators.get('example.residual') ?? [...registry.generators.values()][0];
  let state: SessionState = {
    workspace: 'generator',
    selection: [],
    generatorId: initial.id,
    params: structuredClone(initial.defaults),
    draft: null,
    placing: false,
    preview: null,
    previewLoading: false,
    error: null,
  };
  let token = 0;
  const listeners = new Set<() => void>();
  const patch = (next: Partial<SessionState>) => {
    state = { ...state, ...next };
    listeners.forEach((fn) => fn());
  };
  async function preview() {
    const request = ++token;
    patch({ previewLoading: true, error: null });
    const previewProject = createProject('预览');
    previewProject.theme = structuredClone(store.getSnapshot().theme);
    previewProject.page = structuredClone(store.getSnapshot().page);
    const temp = createDocumentStore(previewProject, createGenerationServices(registry));
    const result = await temp.dispatch({
      baseRevision: 0,
      operations: [
        { kind: 'generate', id: 'preview', generatorId: state.generatorId, params: state.params },
      ],
    });
    if (request === token)
      patch({
        previewLoading: false,
        ...(result.ok ? { preview: result.document } : { error: result.error.message }),
      });
  }
  async function applyDraft(force = false): Promise<CommitResult> {
    const d = state.draft;
    if (!d) return fail('NO_DRAFT', '没有待应用的草稿。');
    const check = checkDraft(store.getSnapshot(), d);
    if (check.kind === 'target-missing')
      return fail('TARGET_MISSING', '原组件已消失或解除生成关联。');
    if (check.kind === 'parameter-conflict' && !force)
      return fail('DRAFT_CONFLICT', '原组件的参数已经改变；请重新载入，或确认用草稿覆盖。');
    const result = await store.dispatch({
      baseRevision: store.getSnapshot().revision,
      operations: [
        {
          kind: 'generate',
          id: d.instanceId,
          generatorId: state.generatorId,
          params: state.params,
        },
      ],
    });
    if (result.ok)
      patch({ workspace: 'drawing', draft: null, selection: [d.instanceId], error: null });
    else patch({ error: result.error.message });
    return result;
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    preview,
    clearError() {
      patch({ error: null });
    },
    setWorkspace(workspace: SessionState['workspace']) {
      patch({ workspace });
    },
    select(selection: string[]) {
      if (
        selection.length === state.selection.length &&
        selection.every((id, i) => id === state.selection[i])
      )
        return;
      patch({ selection });
    },
    setParams(params: Params) {
      patch({ params });
      void preview();
    },
    chooseGenerator(generatorId: string) {
      const g = registry.generators.get(generatorId);
      if (!g) return;
      patch({ generatorId, params: structuredClone(g.defaults), draft: null, error: null });
      void preview();
    },
    edit(id: string) {
      const draft = beginDraft(store.getSnapshot(), id);
      patch({
        workspace: 'generator',
        generatorId: draft.binding.generatorId,
        params: structuredClone(draft.params),
        draft,
        error: null,
      });
      void preview();
    },
    cancelDraft() {
      patch({
        draft: null,
        placing: false,
        workspace: 'drawing',
        error: null,
        params: structuredClone(registry.generators.get(state.generatorId)!.defaults),
      });
    },
    beginPlacement() {
      if (state.preview && !state.error)
        patch({ placing: true, workspace: 'drawing', selection: [] });
    },
    async placeAt(position: Point) {
      if (!state.placing) return;
      const id = crypto.randomUUID();
      const result = await store.dispatch({
        baseRevision: store.getSnapshot().revision,
        operations: [
          { kind: 'generate', id, generatorId: state.generatorId, params: state.params, position },
        ],
      });
      if (result.ok) patch({ placing: false, selection: [id], error: null });
      else patch({ error: result.error.message });
      return result;
    },
    applyDraft,
  };
}
export type EditorSession = ReturnType<typeof createEditorSession>;
