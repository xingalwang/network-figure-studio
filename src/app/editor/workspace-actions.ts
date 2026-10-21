import { planLayout, addPrimitive, planRemoveSelection } from '../../core/composition.ts';
import type { DocumentStore, Point } from '../../core/document/types.ts';
import { semanticTarget } from '../../core/figure/index.ts';
import {
  addTensorSource,
  planPlaceTensorFigure,
  planRemoveFromFigure,
  planRestoreTensorFigure,
} from '../../core/tensor-composition.ts';
import { finalizeTensorFigure } from '../../graphics/tensor-grid.ts';
import { executePluginCommand } from '../../plugins/execute.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import type { ProjectBundle } from '../project-lifecycle.ts';
import { workspaceSelection } from '../project-view.ts';
import type { EditorSession } from '../session.ts';
import type { TensorOperationDraft } from './model.ts';
import { operationCapability } from './capabilities.ts';

export type GeneratorMode = 'assembly' | 'component';

/** Mode, confirmation, document edit and selection form one action, shared by all entry points. */
export function createWorkspaceActions({
  store,
  session,
  registry,
  mode,
  setMode,
  setRightTab,
  requestEdit,
  ensureComputationTarget,
  beginOperationDraft,
  cancelOperation,
  enabledOperationIds,
  onError,
  onNotice,
  fit,
  reveal,
  confirmDiscard = (message) => confirm(message),
}: {
  store: DocumentStore;
  session: EditorSession;
  registry: PluginRegistry;
  mode: GeneratorMode;
  setMode(mode: GeneratorMode): void;
  setRightTab(tab: 'component' | 'figure'): void;
  requestEdit(id: string): void;
  ensureComputationTarget(): Promise<ProjectBundle | null>;
  beginOperationDraft(draft: TensorOperationDraft): boolean;
  cancelOperation(): void;
  enabledOperationIds: ReadonlySet<string>;
  onError(message: string): void;
  onNotice(message: string): void;
  fit(): void;
  reveal(id: string): void;
  confirmDiscard?(message: string): boolean;
}) {
  const confirmAssemblyEntry = () => {
    const state = session.getSnapshot();
    const baseline = state.draft?.params ?? registry.generators.get(state.generatorId)?.defaults;
    return (
      !(mode === 'component' || state.draft) ||
      JSON.stringify(state.params) === JSON.stringify(baseline) ||
      confirmDiscard('有尚未应用的组合参数。放弃此草稿并返回组装工作区？')
    );
  };
  const activateAssembly = () => {
    const state = session.getSnapshot();
    if (mode === 'component' || state.draft || state.placing) session.cancelDraft();
    setMode('assembly');
    session.setWorkspace('generator');
    session.select(
      workspaceSelection(store.getSnapshot(), session.getSnapshot().selection, 'generator'),
    );
  };
  const enterTensor = () => {
    if (!confirmAssemblyEntry()) return false;
    activateAssembly();
    return true;
  };
  const editTensor = (id: string) => {
    const source = semanticTarget(store.getSnapshot(), id);
    if (source && source.id !== id) {
      if (!enterTensor()) return;
      id = source.id;
    }
    if (!store.getSnapshot().entities[id]) return;
    session.select([id]);
    setRightTab('component');
    requestEdit(id);
  };
  return {
    enterTensor,
    returnToBuild: () => {
      enterTensor();
    },
    enterDrawing() {
      session.setWorkspace('drawing');
      session.select(
        workspaceSelection(store.getSnapshot(), session.getSnapshot().selection, 'drawing'),
      );
    },
    enterLegacy(generatorId = 'example.residual') {
      if (!confirmAssemblyEntry()) return;
      cancelOperation();
      session.chooseGenerator(generatorId);
      session.setWorkspace('generator');
      setMode('component');
    },
    editTensor,
    editObject: editTensor,
    async add(id: string, position?: Point) {
      if (store.isReadonly()) return;
      const drawing = session.getSnapshot().workspace === 'drawing';
      if (!drawing && !enterTensor()) return;
      const result = await addPrimitive(store, registry, id, position);
      if (!result.ok) {
        onError(result.error.message);
        return;
      }
      cancelOperation();
      if (!drawing) activateAssembly();
      session.select([result.value]);
      setRightTab('component');
      requestAnimationFrame(() => reveal(result.value));
    },
    async addTensor(position?: Point, dimension: 2 | 3 = 3) {
      if (store.isReadonly()) return;
      let target: ProjectBundle | null = { store, session };
      if (store.getSnapshot().schemaVersion < 2) target = await ensureComputationTarget();
      else if (!enterTensor()) return;
      if (!target) return;
      const result = await addTensorSource(target.store, registry, position, dimension);
      if (!result.ok) {
        onError(result.error.message);
        return;
      }
      cancelOperation();
      target.session.setWorkspace('generator');
      target.session.select([result.value]);
      setRightTab('component');
      requestAnimationFrame(() => reveal(result.value));
    },
    beginOperation(kind: string, sourceIds: string[]) {
      const capability = operationCapability(registry, store.getSnapshot(), sourceIds, kind, {
        workspace: session.getSnapshot().workspace,
        readonly: store.isReadonly(),
        enabledOperationIds,
      });
      if (!capability.available) {
        onError(capability.reason!);
        return;
      }
      if (!enterTensor()) return;
      if (beginOperationDraft({ kind, sourceIds: [...sourceIds] })) setRightTab('component');
    },
    async placeFigure() {
      const current = store.getSnapshot();
      const operations = finalizeTensorFigure(
        current,
        planPlaceTensorFigure(current),
        registry.computations,
      );
      const result = await store.dispatch({ baseRevision: current.revision, operations });
      if (!result.ok) {
        onError(result.error.message);
        return;
      }
      session.setWorkspace('drawing');
      session.select([]);
      onNotice(
        operations.length
          ? '已更新图稿 · 已有排版与样式保持不变'
          : '没有新增图元 · 已有排版保持不变',
      );
      requestAnimationFrame(fit);
    },
    async restoreFigure(ids: string[]) {
      const current = store.getSnapshot();
      const result = await store.dispatch({
        baseRevision: current.revision,
        operations: planRestoreTensorFigure(current, ids),
      });
      if (!result.ok) onError(result.error.message);
    },
    async layout() {
      const current = store.getSnapshot();
      const proposal = planLayout(
        current,
        session.getSnapshot().workspace === 'drawing' ? 'figure' : 'structure',
      );
      if (!proposal.ok) {
        onError(proposal.error.message);
        return;
      }
      const result = await store.dispatch({
        baseRevision: current.revision,
        operations: proposal.value,
      });
      if (!result.ok) onError(result.error.message);
      else requestAnimationFrame(fit);
    },
    async removeSelection() {
      const current = store.getSnapshot(),
        state = session.getSnapshot();
      if (!state.selection.length) return;
      const plan =
        state.workspace === 'drawing'
          ? planRemoveFromFigure(current, state.selection)
          : planRemoveSelection(current, state.selection);
      if (!plan.ok) {
        onError(plan.error.message);
        return;
      }
      const result = await store.dispatch({
        baseRevision: current.revision,
        operations: plan.value,
      });
      if (!result.ok) {
        onError(result.error.message);
        return;
      }
      session.select([]);
      if (state.workspace === 'drawing')
        onNotice(
          plan.value.some((op) => op.kind === 'put')
            ? '已从图稿移除 · 计算结构保留，可在对象列表恢复'
            : '已删除自由图元',
        );
    },
    async placeAt(position: Point) {
      const result = await session.placeAt(position);
      if (result?.ok) requestAnimationFrame(fit);
    },
    async applyLegacyDraft(force = false) {
      const result = await session.applyDraft(force);
      if (!result.ok) onError(result.error.message);
    },
    async distribute() {
      const result = await executePluginCommand(
        store,
        registry,
        'example.distribute-x',
        session.getSnapshot().selection,
        {},
      );
      if (!result.ok) onError(result.error.message);
      else onNotice('已通过模块等距排布 · 可一次撤销');
    },
  };
}
