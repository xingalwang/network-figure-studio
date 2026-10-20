import { useEffect, useRef, useState, useSyncExternalStore, useMemo } from 'react';
import { migrateProjectV2 } from '../../core/document/codec.ts';
import type { Params, ProjectDocument } from '../../core/document/types.ts';
import type { ParameterDraftCache } from '../../workspaces/shared/parameter-drafts.ts';
import type { EditRequest, TensorOperationDraft } from '../../workspaces/shared/editor-model.ts';
import type { EditorController, EditorOptions } from './controller.ts';
import { executePluginCommand } from '../../plugins/execute.ts';
import { analyzeDocument } from '../../core/computation/index.ts';
import {
  addTensorSource,
  appendTensorOperation,
  planPlaceTensorFigure,
  planRemoveFromFigure,
  planRestoreTensorFigure,
} from '../../core/tensor-composition.ts';
import { addPrimitive, planRemoveSelection, planLayout } from '../../core/composition.ts';
import type { GraphAdapter } from '../../adapters/maxgraph/adapter.ts';
import { exportSvg, exportPng } from '../../graphics/export.ts';
import { registry } from '../registry.ts';
import { useEditorTheme } from '../theme/preferences.ts';
export function useEditor({
  bundle: { store, session },
  lifecycle,
  persistence,
}: EditorOptions): EditorController {
  const { theme, setTheme } = useEditorTheme();
  const doc = useSyncExternalStore(store.subscribe, store.getSnapshot),
    state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [exportOpen, setExportOpen] = useState(false),
    [inspectorOpen, setInspectorOpen] = useState(true),
    [tool, setTool] = useState<'select' | 'connect'>('select'),
    [zoom, setZoom] = useState(100),
    [generatorMode, setGeneratorMode] = useState<'tensor' | 'build' | 'component'>('tensor'),
    [rightTab, setRightTab] = useState<'component' | 'figure'>('component'),
    [pendingParameters, setPendingParameters] = useState(false);
  const [operationDraft, setOperationDraft] = useState<TensorOperationDraft | null>(null);
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  const parameterDrafts = useRef<ParameterDraftCache>(new Map());
  const isLegacy =
    state.workspace === 'generator' && (generatorMode === 'component' || !!state.draft);
  const isBuild = state.workspace === 'generator' && !isLegacy && generatorMode === 'build';
  const isTensor = state.workspace === 'generator' && !isLegacy && generatorMode === 'tensor';
  const report = useMemo(() => analyzeDocument(doc), [doc]);
  const { autoStatus, fileStatus: saving, lockMode } = persistence;
  const viewports = useRef<Record<string, { scale: number; x: number; y: number }>>({});
  const adapter = useRef<GraphAdapter | null>(null),
    input = useRef<HTMLInputElement>(null);
  const available = registry.generators.get(state.generatorId)!;
  const selected = state.selection.length === 1 ? doc.entities[state.selection[0]] : undefined;
  const selectedTensors = state.selection.filter((id) => {
    const e = doc.entities[id];
    return e?.kind === 'node' && e.semantic && e.semantic.role !== 'operation';
  });
  const hasTensors = Object.values(doc.entities).some((e) => e.kind === 'node' && e.semantic);
  const hasPlacedTensors = Object.values(doc.entities).some(
    (e) => e.kind === 'node' && e.semantic && e.figureState !== 'unplaced',
  );
  const hasDrawing = Object.values(doc.entities).some(
    (e) => e.kind !== 'edge' && e.figureState !== 'unplaced' && e.figureState !== 'hidden',
  );
  useEffect(() => {
    void session.preview();
  }, [session]);
  const switchProject = async (next: ProjectDocument, origin: 'new' | 'file' = 'file') => {
    if (
      pendingParameters &&
      !confirm('有尚未应用的基元参数。继续切换工程将丢弃这些草稿，是否继续？')
    )
      return;
    await lifecycle.switchProject(next, origin);
  };
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (pendingParameters) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [pendingParameters]);
  useEffect(() => {
    for (const id of parameterDrafts.current.keys())
      if (!doc.entities[id]) parameterDrafts.current.delete(id);
    setPendingParameters(parameterDrafts.current.size > 0 || !!operationDraft);
  }, [doc, operationDraft]);
  const fit = () => {
    adapter.current?.fit();
    if (adapter.current) setZoom(Math.round(adapter.current.graph.getView().scale * 100));
  };
  const confirmTensorEntry = () => {
    const legacyActive = generatorMode === 'component' || !!state.draft;
    const baseline = state.draft?.params ?? available.defaults;
    return (
      !legacyActive ||
      JSON.stringify(state.params) === JSON.stringify(baseline) ||
      confirm('有尚未应用的组合参数。放弃此草稿并进入张量搭建？')
    );
  };
  const activateTensor = () => {
    if (generatorMode === 'component' || state.draft || state.placing) session.cancelDraft();
    setOperationDraft(null);
    setGeneratorMode('tensor');
    session.setWorkspace('generator');
  };
  const enterTensor = () => {
    if (!confirmTensorEntry()) return false;
    activateTensor();
    return true;
  };
  const add = async (id: string, position?: { x: number; y: number }) => {
    const result = await addPrimitive(store, registry, id, position);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    session.select([result.value]);
    setRightTab('component');
    requestAnimationFrame(fit);
  };
  const addTensor = async (position?: { x: number; y: number }, dimension: 2 | 3 = 3) => {
    if (store.isReadonly()) return;
    let target = { store, session };
    if (store.getSnapshot().schemaVersion === 1) {
      const copy = migrateProjectV2(store.getSnapshot());
      // The normal project switch owns every draft/file confirmation before mutation.
      await switchProject(copy, 'new');
      const next = lifecycle.getSnapshot().bundle;
      if (!next || next.store.getSnapshot().id !== copy.id) return;
      target = next;
    } else if (!enterTensor()) return;
    const result = await addTensorSource(target.store, registry, position, dimension);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    target.session.setWorkspace('generator');
    target.session.select([result.value]);
    setRightTab('component');
    requestAnimationFrame(() => adapter.current?.reveal(result.value));
  };
  const editTensor = (id: string) => {
    session.select([id]);
    setRightTab('component');
    setEditRequest((current) => ({ id, serial: (current?.serial ?? 0) + 1 }));
  };
  const beginOperation = (kind: TensorOperationDraft['kind'], sourceIds: string[]) => {
    if (store.isReadonly() || !enterTensor()) return;
    setOperationDraft({ kind, sourceIds });
    setRightTab('component');
  };
  const placeFigure = async () => {
    const current = store.getSnapshot(),
      operations = planPlaceTensorFigure(current);
    const result = await store.dispatch({ baseRevision: current.revision, operations });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    session.setWorkspace('drawing');
    session.select([]);
    setNotice(
      operations.length ? '已更新图稿 · 已有排版与样式保持不变' : '没有新增图元 · 已有排版保持不变',
    );
    requestAnimationFrame(fit);
  };
  const layout = async () => {
    const proposal = planLayout(store.getSnapshot());
    if (!proposal.ok) {
      setError(proposal.error.message);
      return;
    }
    const r = await store.dispatch({
      baseRevision: store.getSnapshot().revision,
      operations: proposal.value,
    });
    if (!r.ok) setError(r.error.message);
    else requestAnimationFrame(fit);
  };
  const returnToBuild = () => {
    if (
      state.draft &&
      JSON.stringify(state.params) !== JSON.stringify(state.draft.params) &&
      !confirm('放弃尚未应用的组合草稿，返回结构搭建？')
    )
      return;
    session.cancelDraft();
    session.setWorkspace('generator');
    setGeneratorMode('build');
  };
  const save = (copy = false) =>
    lifecycle.save(copy, copy ? { download: downloadBlob } : undefined);
  async function removeSelection() {
    if (!state.selection.length) return;
    if (state.workspace === 'drawing') {
      const current = store.getSnapshot(),
        plan = planRemoveFromFigure(current, state.selection);
      if (!plan.ok) {
        setError(plan.error.message);
        return;
      }
      const result = await store.dispatch({
        baseRevision: current.revision,
        operations: plan.value,
      });
      if (!result.ok) setError(result.error.message);
      else {
        session.select([]);
        setNotice(
          plan.value.some((op) => op.kind === 'put')
            ? '已从图稿移除 · 计算结构保留，可在对象列表恢复'
            : '已删除自由图元',
        );
      }
      return;
    }
    const current = store.getSnapshot(),
      ops = planRemoveSelection(current, state.selection);
    if (!ops.ok) {
      setError(ops.error.message);
      return;
    }
    const result = await store.dispatch({ baseRevision: current.revision, operations: ops.value });
    if (!result.ok) setError(result.error.message);
    else session.select([]);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.isComposing || t.closest('input,textarea,select,[contenteditable=true],[role=dialog]'))
        return;
      if (e.key === 'Escape') {
        if (operationDraft) setOperationDraft(null);
        else if (state.placing || state.draft) session.cancelDraft();
        else session.select([]);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        void removeSelection();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? store.redo() : store.undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [state.selection, state.placing, doc, operationDraft]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__studio = {
      snapshot: () => structuredClone(store.getSnapshot()),
      analysis: () => analyzeDocument(store.getSnapshot()),
      select: (ids: string[]) => session.select(ids),
      dispatch: store.dispatch,
      screenPoint: (id: string) => adapter.current?.screenPoint(id),
      portPoint: (id: string, key: string) => adapter.current?.portPoint(id, key),
      load: (next: ProjectDocument) => switchProject(next),
      exportSvg,
      exportPng,
      registry: () => [...registry.generators.keys()],
    };
  }, [store, session, doc]);
  const canDistribute =
    !!registry.commands.get('example.distribute-x')?.isAvailable(doc, state.selection) &&
    !store.isReadonly();
  const ready = (a: GraphAdapter | null) => {
    if (!a && adapter.current) {
      const view = adapter.current.graph.getView();
      viewports.current[adapter.current.mode] = {
        scale: view.scale,
        x: view.translate.x,
        y: view.translate.y,
      };
    }
    adapter.current = a;
    if (a) {
      const saved = viewports.current[a.mode];
      if (saved) a.graph.getView().scaleAndTranslate(saved.scale, saved.x, saved.y);
      setZoom(Math.round(a.graph.getView().scale * 100));
    }
  };
  const doZoom = (factor: number) => {
    adapter.current?.zoom(factor);
    if (adapter.current) setZoom(Math.round(adapter.current.graph.getView().scale * 100));
  };
  const parameterDraftChanged = () =>
    setPendingParameters(parameterDrafts.current.size > 0 || !!operationDraft);
  const select = (ids: string[], reveal = false) => {
    session.select(ids);
    if (reveal && ids.length === 1) adapter.current?.reveal(ids[0]);
  };
  const enterBuild = () => {
    setGeneratorMode('build');
    session.setWorkspace('generator');
  };
  const enterLegacy = (generatorId = 'example.residual') => {
    session.chooseGenerator(generatorId);
    session.setWorkspace('generator');
    setGeneratorMode('component');
  };
  const editObject = (id: string) => {
    const entity = store.getSnapshot().entities[id];
    if (entity?.kind === 'node' && registry.primitives.has(entity.generation?.generatorId ?? ''))
      enterBuild();
    else {
      setGeneratorMode('component');
      session.edit(id);
    }
  };
  const createOperation = async (params: Params) => {
    if (!operationDraft) return;
    const result = await appendTensorOperation(
      store,
      registry,
      operationDraft.sourceIds,
      operationDraft.kind,
      params,
    );
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    const id = result.value.resultId;
    setOperationDraft(null);
    session.select([id]);
    setGeneratorMode('tensor');
    session.setWorkspace('generator');
    requestAnimationFrame(() => adapter.current?.reveal(id));
  };
  const restoreFigure = async (ids: string[]) => {
    const current = store.getSnapshot();
    const result = await store.dispatch({
      baseRevision: current.revision,
      operations: planRestoreTensorFigure(current, ids),
    });
    if (!result.ok) setError(result.error.message);
  };
  const placeAt = async (position: { x: number; y: number }) => {
    const result = await session.placeAt(position);
    if (result?.ok) requestAnimationFrame(fit);
  };
  const applyLegacyDraft = async (force = false) => {
    const result = await session.applyDraft(force);
    if (!result.ok) setError(result.error.message);
  };
  const distribute = async () => {
    const result = await executePluginCommand(
      store,
      registry,
      'example.distribute-x',
      state.selection,
      {},
    );
    if (!result.ok) setError(result.error.message);
    else setNotice('已通过插件等距排布 · 可一次撤销');
  };
  const clearError = () => {
    setError('');
    session.clearError();
    lifecycle.clearError();
  };
  const clearNotice = () => {
    setNotice('');
    lifecycle.clearNotice();
  };
  return {
    store,
    session,
    lifecycle,
    persistence,
    doc,
    state,
    theme,
    setTheme,
    registry,
    error,
    setError,
    notice,
    setNotice,
    exportOpen,
    setExportOpen,
    inspectorOpen,
    setInspectorOpen,
    tool,
    setTool,
    zoom,
    rightTab,
    setRightTab,
    parameterDrafts: parameterDrafts.current,
    operationDraft,
    editRequest,
    isLegacy,
    isBuild,
    isTensor,
    report,
    autoStatus,
    saving,
    lockMode,
    input,
    available,
    selected,
    selectedTensors,
    hasTensors,
    hasPlacedTensors,
    hasDrawing,
    switchProject,
    fit,
    add,
    addTensor,
    editTensor,
    beginOperation,
    placeFigure,
    layout,
    returnToBuild,
    save,
    removeSelection,
    canDistribute,
    ready,
    doZoom,
    enterTensor,
    enterBuild,
    enterLegacy,
    select,
    parameterDraftChanged,
    editObject,
    createOperation,
    cancelOperation: () => setOperationDraft(null),
    restoreFigure,
    placeAt,
    applyLegacyDraft,
    distribute,
    clearError,
    clearNotice,
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
