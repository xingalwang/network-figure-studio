import { useEffect, useRef, useState, useSyncExternalStore, useMemo } from 'react';
import type { ProjectDocument } from '../../core/document/types.ts';
import type { ParameterDraftCache } from './parameter-drafts.ts';
import type { EditRequest } from './model.ts';
import type { EditorController, EditorOptions } from './controller.ts';
import { isFigureEntity } from '../../core/figure/index.ts';
import { createEntityActions } from './entity-actions.ts';
import { createFigureActions } from './figure-actions.ts';
import { createProjectActions } from './project-actions.ts';
import { createWorkspaceActions, type GeneratorMode } from './workspace-actions.ts';
import { useOperationDraft } from './operation-draft.ts';
import { connectionCapability, operationCapability } from './capabilities.ts';
import {
  createBuildActions,
  projectStructureDrafts,
  structureDraftCount as countStructureDrafts,
} from './build-actions.ts';
import { analyzeDocument } from '../../core/computation/index.ts';
import type { GraphAdapter } from '../../adapters/maxgraph/adapter.ts';
import { exportSvg, exportPng, type ExportOptions } from '../../graphics/export.ts';
import { registry } from '../registry.ts';
import { useEditorTheme } from '../theme/preferences.ts';
import { useModules } from '../modules/preferences.tsx';
import { createConnectionActions } from './connection-actions.ts';

/** Compose the authoritative document/session, derived previews and complete editing actions. */
export function useEditor({
  bundle,
  lifecycle,
  persistence,
  home,
}: EditorOptions): EditorController {
  const { store, session } = bundle;
  const homeOpen = home?.open ?? false;
  const modules = useModules();
  const enabledEntries = useMemo(
    () =>
      modules.modules
        .filter((module) => modules.enabledIds.includes(module.id))
        .flatMap((module) => module.entries),
    [modules.modules, modules.enabledIds],
  );
  const enabledOperationIds = useMemo(
    () =>
      new Set(
        enabledEntries.filter((entry) => entry.kind === 'operation').map((entry) => entry.id),
      ),
    [enabledEntries],
  );
  const tensorToolsEnabled = enabledEntries.some((entry) => entry.kind === 'data');
  const { theme, setTheme } = useEditorTheme();
  const doc = useSyncExternalStore(store.subscribe, store.getSnapshot),
    state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [exportOpen, setExportOpen] = useState(false),
    [inspectorOpen, setInspectorOpen] = useState(true),
    [requestedTool, setTool] = useState<'select' | 'connect'>('select'),
    [zoom, setZoom] = useState(100),
    [generatorMode, setGeneratorMode] = useState<GeneratorMode>('assembly'),
    [rightTab, setRightTab] = useState<'component' | 'figure'>('component'),
    [draftVersion, setDraftVersion] = useState(0),
    [building, setBuilding] = useState(false),
    [editRequest, setEditRequest] = useState<EditRequest | null>(null);
  const parameterDrafts = useRef<ParameterDraftCache>(new Map());
  const isLegacy =
    state.workspace === 'generator' && (generatorMode === 'component' || !!state.draft);
  const isTensor = state.workspace === 'generator' && !isLegacy;
  const tool = isLegacy ? 'select' : requestedTool;
  const report = useMemo(() => analyzeDocument(doc, registry.computations), [doc]);
  const previewDoc = useMemo(
    () => projectStructureDrafts(doc, registry, parameterDrafts.current),
    [doc, draftVersion],
  );
  const previewReport = useMemo(
    () => (previewDoc === doc ? report : analyzeDocument(previewDoc, registry.computations)),
    [doc, previewDoc, report],
  );
  const structureDraftCount = countStructureDrafts(doc, registry, parameterDrafts.current);
  const { autoStatus, fileStatus: saving, lockMode } = persistence;
  const viewports = useRef<Record<string, { scale: number; x: number; y: number }>>({});
  const adapter = useRef<GraphAdapter | null>(null),
    input = useRef<HTMLInputElement>(null);
  const stopScaleListener = useRef<(() => void) | undefined>(undefined);
  const fit = () => {
    adapter.current?.fit();
    if (adapter.current) setZoom(Math.round(adapter.current.getScale() * 100));
  };
  const operation = useOperationDraft({
    doc,
    store,
    registry,
    report,
    workspace: state.workspace,
    enabledOperationIds,
    onError: setError,
    onCreated(id) {
      setGeneratorMode('assembly');
      session.setWorkspace('generator');
      session.select([id]);
      requestAnimationFrame(() => adapter.current?.reveal(id));
    },
  });
  const legacyParametersPending =
    !!state.draft && JSON.stringify(state.params) !== JSON.stringify(state.draft.params);
  const pendingParameters =
    parameterDrafts.current.size > 0 || !!operation.draft || legacyParametersPending;
  const projectActions = createProjectActions({
    bundle,
    lifecycle,
    hasPendingParameters: () => pendingParameters,
    onError: setError,
    setHomeOpen: (open) => home?.setOpen(open),
  });
  const workspaceActions = createWorkspaceActions({
    store,
    session,
    registry,
    mode: generatorMode,
    setMode: setGeneratorMode,
    setRightTab,
    requestEdit: (id) => setEditRequest((current) => ({ id, serial: (current?.serial ?? 0) + 1 })),
    ensureComputationTarget: () => projectActions.ensureSchema(2),
    beginOperationDraft: operation.begin,
    cancelOperation: operation.cancel,
    enabledOperationIds,
    onError: setError,
    onNotice: setNotice,
    fit,
    reveal: (id) => adapter.current?.reveal(id),
  });
  const entityActions = createEntityActions({
    store,
    registry,
    onError: setError,
    confirmRemoval: (message) => confirm(message),
  });
  const buildActions = useMemo(
    () =>
      createBuildActions({
        store,
        registry,
        drafts: parameterDrafts.current,
        onError: setError,
        onChanged: () => setDraftVersion((value) => value + 1),
        onBuildingChange: setBuilding,
        onBuilt: (count) => setNotice(`已构建 ${count} 个对象的结构参数 · 可一次撤销`),
        confirmOverwrite: (message) => confirm(message),
        confirmRemoval: (message) => confirm(message),
      }),
    [store],
  );
  const figureActions = createFigureActions({
    computations: registry.computations,
    async ensureTarget() {
      const target = await projectActions.ensureSchema(3);
      return (
        target && {
          store: target.store,
          show(id: string) {
            target.session.setWorkspace('drawing');
            target.session.select([id]);
            setRightTab('component');
            requestAnimationFrame(() => adapter.current?.reveal(id));
          },
        }
      );
    },
    onError: setError,
  });
  const connectionActions = createConnectionActions({
    store,
    registry,
    context: () => ({
      workspace: session.getSnapshot().workspace,
      selection: session.getSnapshot().selection,
    }),
    onError: setError,
    onSuccess: () => setNotice('已应用连接方式 · 可一次撤销'),
  });
  const selected = state.selection.length === 1 ? doc.entities[state.selection[0]] : undefined;
  const selectedTensors = state.selection.filter((id) => {
    const entity = doc.entities[id];
    return entity?.kind === 'node' && entity.semantic && entity.semantic.role !== 'operation';
  });
  const capabilityContext = {
    workspace: state.workspace,
    readonly: store.isReadonly(),
    enabledOperationIds,
  };
  const canOperate = (id: string, sourceIds: readonly string[] = selectedTensors) =>
    operationCapability(registry, doc, sourceIds, id, capabilityContext);
  const canConnect = (id: string) =>
    connectionCapability(registry, doc, state.selection, id, capabilityContext);
  const availableOperations = [...registry.computations.values()].filter(
    (definition) => definition.operation && canOperate(definition.generatorId).available,
  );
  const hasTensors = Object.values(doc.entities).some(
    (entity) => entity.kind === 'node' && entity.semantic,
  );
  const hasPlacedTensors = Object.values(doc.entities).some((entity) =>
    doc.schemaVersion === 3
      ? entity.figure?.role === 'representation'
      : entity.kind === 'node' && entity.semantic && entity.figureState !== 'unplaced',
  );
  const hasDrawing = Object.values(doc.entities).some(
    (entity) =>
      isFigureEntity(doc, entity) &&
      entity.kind !== 'edge' &&
      entity.figureState !== 'unplaced' &&
      entity.figureState !== 'hidden',
  );
  const canDistribute =
    !!registry.commands.get('example.distribute-x')?.isAvailable(doc, state.selection) &&
    !store.isReadonly();

  useEffect(() => {
    void session.preview();
  }, [session]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (pendingParameters) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [pendingParameters]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (homeOpen || exportOpen) return;
      const target = event.target as HTMLElement;
      if (
        event.isComposing ||
        target.closest('input,textarea,select,[contenteditable=true],[role=dialog]')
      )
        return;
      if (event.key === 'Escape') {
        if (operation.draft) operation.cancel();
        else if (state.placing || state.draft) session.cancelDraft();
        else session.select([]);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        void workspaceActions.removeSelection();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? store.redo() : store.undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void projectActions.save();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [state, doc, operation.draft, homeOpen, exportOpen]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__studio = {
      snapshot: () => structuredClone(store.getSnapshot()),
      analysis: () => analyzeDocument(store.getSnapshot(), registry.computations),
      previewSnapshot: () => structuredClone(previewDoc),
      previewAnalysis: () => structuredClone(previewReport),
      select: (ids: string[]) => session.select(ids),
      dispatch: store.dispatch,
      screenPoint: (id: string) => adapter.current?.screenPoint(id),
      portPoint: (id: string, key: string) => adapter.current?.portPoint(id, key),
      load: (next: ProjectDocument) => projectActions.switchProject(next),
      exportSvg: (document: ProjectDocument, options: ExportOptions) =>
        exportSvg(document, options, registry.computations),
      exportPng: (document: ProjectDocument, options: ExportOptions) =>
        exportPng(document, options, registry.computations),
      registry: () => [...registry.generators.keys()],
    };
  }, [store, session, doc, previewDoc, previewReport]);
  const ready = (next: GraphAdapter | null) => {
    stopScaleListener.current?.();
    stopScaleListener.current = undefined;
    if (!next && adapter.current)
      viewports.current[adapter.current.mode] = adapter.current.getViewport();
    adapter.current = next;
    if (next) {
      const saved = viewports.current[next.mode];
      if (saved) next.setViewport(saved);
      setZoom(Math.round(next.getScale() * 100));
      stopScaleListener.current = next.onScale((scale) => setZoom(Math.round(scale * 100)));
    }
  };
  const doZoom = (factor: number) => {
    adapter.current?.zoom(factor);
    if (adapter.current) setZoom(Math.round(adapter.current.getScale() * 100));
  };
  return {
    ...projectActions,
    ...workspaceActions,
    ...figureActions,
    homeOpen,
    enabledOperationIds,
    tensorToolsEnabled,
    operationCapability: canOperate,
    connectionCapability: canConnect,
    availableOperations,
    applyConnectionPattern: connectionActions.applyConnectionPattern,
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
    operationDraft: operation.draft,
    operationEditor: operation.editor,
    changeOperationParameters: operation.change,
    createOperation: operation.create,
    cancelOperation: operation.cancel,
    editRequest,
    isLegacy,
    isTensor,
    report,
    previewDoc,
    previewReport,
    structureDraftCount,
    building,
    autoStatus,
    saving,
    lockMode,
    input,
    available: registry.generators.get(state.generatorId)!,
    selected,
    selectedTensors,
    hasTensors,
    hasPlacedTensors,
    hasDrawing,
    updateParameters: entityActions.updateParameters,
    buildStructure: buildActions.buildStructure,
    applyAppearanceParameters: buildActions.applyAppearance,
    setLabel: entityActions.setLabel,
    canDistribute,
    ready,
    fit,
    doZoom,
    select(ids: string[], reveal = false) {
      session.select(ids);
      if (reveal && ids.length === 1) adapter.current?.reveal(ids[0]);
    },
    parameterDraftChanged: () => setDraftVersion((value) => value + 1),
    clearError() {
      setError('');
      session.clearError();
      lifecycle.clearError();
    },
    clearNotice() {
      setNotice('');
      lifecycle.clearNotice();
    },
  };
}
