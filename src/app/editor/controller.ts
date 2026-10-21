import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { GraphAdapter } from '../../adapters/maxgraph/adapter.ts';
import type { AnalysisReport, ComputationDefinition } from '../../core/computation/index.ts';
import type {
  AnnotationContent,
  DocumentStore,
  Entity,
  Params,
  Point,
  ProjectDocument,
} from '../../core/document/types.ts';
import type { ViewTheme } from '../../graphics/view-theme.ts';
import type { FigureAppearance } from '../../graphics/figure-appearance.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import type { GeneratorDefinition } from '../../plugins/sdk.ts';
import type { ParameterDraftCache } from './parameter-drafts.ts';
import type { EditRequest, TensorOperationDraft } from './model.ts';
import type { OperationEditorState } from './operation-draft.ts';
import type { Capability } from './capabilities.ts';
import type {
  ProjectBundle,
  ProjectLifecycle,
  ProjectLifecycleState,
} from '../project-lifecycle.ts';
import type { EditorSession, SessionState } from '../session.ts';

export interface EditorOptions {
  bundle: ProjectBundle;
  lifecycle: ProjectLifecycle;
  persistence: ProjectLifecycleState;
  home?: { open: boolean; setOpen(open: boolean): void };
}

/** Read model for workbench presentation; document/session remain the sole state owners. */
export interface EditorState {
  homeOpen: boolean;
  enabledOperationIds: ReadonlySet<string>;
  tensorToolsEnabled: boolean;
  doc: ProjectDocument;
  state: SessionState;
  theme: ViewTheme;
  error: string;
  notice: string;
  exportOpen: boolean;
  inspectorOpen: boolean;
  tool: 'select' | 'connect';
  zoom: number;
  rightTab: 'component' | 'figure';
  operationDraft: TensorOperationDraft | null;
  operationEditor: OperationEditorState | null;
  availableOperations: ComputationDefinition[];
  editRequest: EditRequest | null;
  isLegacy: boolean;
  isTensor: boolean;
  report: AnalysisReport;
  previewDoc: ProjectDocument;
  previewReport: AnalysisReport;
  structureDraftCount: number;
  building: boolean;
  autoStatus: string;
  saving: string;
  lockMode: ProjectLifecycleState['lockMode'];
  available: GeneratorDefinition;
  selected: Entity | undefined;
  selectedTensors: string[];
  hasTensors: boolean;
  hasPlacedTensors: boolean;
  hasDrawing: boolean;
  canDistribute: boolean;
}

/** Complete UI commands: callers must not arrange mode/confirmation/selection steps. */
export interface EditorActions {
  goHome(): void;
  continueProject(): void;
  createNewProject(): Promise<boolean>;
  openProjectFile(file: File): Promise<boolean>;
  applyConnectionPattern(id: string, params: Params): Promise<boolean>;
  setTheme(theme: ViewTheme): void;
  setError(message: string): void;
  setNotice(message: string): void;
  setExportOpen(open: boolean): void;
  setInspectorOpen: Dispatch<SetStateAction<boolean>>;
  setTool(tool: EditorState['tool']): void;
  setRightTab(tab: EditorState['rightTab']): void;
  parameterDraftChanged(): void;
  select(ids: string[], reveal?: boolean): void;
  switchProject(next: ProjectDocument, origin?: 'new' | 'file'): Promise<boolean>;
  fit(): void;
  add(id: string, position?: Point): Promise<void>;
  addTensor(position?: Point, dimension?: 2 | 3): Promise<void>;
  editTensor(id: string): void;
  updateParameters(id: string, params: Params, removalConfirmed?: boolean): Promise<boolean>;
  buildStructure(): Promise<boolean>;
  applyAppearanceParameters(id: string): Promise<boolean>;
  setLabel(id: string, text: string | null): Promise<boolean>;
  addAnnotation(text?: string, position?: Point): Promise<void>;
  addRepresentation(sourceId: string, position?: Point): Promise<void>;
  updateAnnotation(id: string, content: string | AnnotationContent): Promise<boolean>;
  updateFigureAppearance(id: string, values: FigureAppearance): Promise<boolean>;
  editObject(id: string): void;
  beginOperation(kind: TensorOperationDraft['kind'], sourceIds: string[]): void;
  operationCapability(id: string, sourceIds?: readonly string[]): Capability;
  connectionCapability(id: string): Capability;
  changeOperationParameters(params: Params): void;
  createOperation(): Promise<void>;
  cancelOperation(): void;
  placeFigure(): Promise<void>;
  restoreFigure(ids: string[]): Promise<void>;
  layout(): Promise<void>;
  enterTensor(): boolean;
  enterDrawing(): void;
  enterLegacy(generatorId?: string): void;
  returnToBuild(): void;
  placeAt(position: Point): Promise<void>;
  applyLegacyDraft(force?: boolean): Promise<void>;
  save(copy?: boolean): Promise<void>;
  removeSelection(): Promise<void>;
  distribute(): Promise<void>;
  clearError(): void;
  clearNotice(): void;
  ready(adapter: GraphAdapter | null): void;
  doZoom(factor: number): void;
}

/** Dependencies passed to existing workspace editors, not additional application state. */
export interface EditorController extends EditorState, EditorActions {
  store: DocumentStore;
  session: EditorSession;
  lifecycle: ProjectLifecycle;
  persistence: ProjectLifecycleState;
  registry: PluginRegistry;
  input: RefObject<HTMLInputElement | null>;
  parameterDrafts: ParameterDraftCache;
}
