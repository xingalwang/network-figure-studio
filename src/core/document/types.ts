import type { Bounds, Point, Primitive } from '../../graphics/primitives';
export type { Bounds, Point, Primitive };
export type EntityId = string;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type Params = Record<string, JsonValue>;
export type ErrorDetail = { code: string; message: string; entityIds?: string[] };
export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorDetail };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (
  code: string,
  message: string,
  entityIds?: string[],
): { ok: false; error: ErrorDetail } => ({
  ok: false,
  error: { code, message, ...(entityIds ? { entityIds } : {}) },
});
export type GenerationBinding = {
  generatorId: string;
  version: string;
  paramSchemaVersion: number;
  source:
    | { kind: 'local'; params: Params }
    | { kind: 'slot'; ownerId: string; slotKey: string; inherit: string[] };
  localKeys: Record<string, string>;
};
export type Presentation = {
  position: Point;
  compositionPosition?: Point;
  labelOverride?: string;
  fillOverride?: string;
  strokeOverride?: string;
  textOverride?: string;
  opacityOverride?: number;
  strokeWidthOverride?: number;
  moved?: boolean;
  scale?: number;
};
export type Endpoint =
  | { kind: 'port'; entityId: string; portId: string }
  | { kind: 'free'; spaceId: string | null; point: Point };
export type Port = Point | { entityId: string; portId: string };
/** Drawing identity is independent of the computation object it represents. */
export type FigureRelation = {
  role: 'representation' | 'annotation' | 'decoration';
  semanticRef?: string;
  view?: 'summary' | 'detail';
  relatedFigureId?: string;
  /** Independent tensor-block projection; display width and height remain in node.size. */
  tensorProjection?: { depth: number; angleDeg: number };
};
export type AnnotationContent =
  | { kind: 'manual'; text: string }
  | { kind: 'derived'; semanticRef: string; field: 'name' | 'shape' | 'parameters' };
type BaseEntity = {
  id: string;
  parentId: string | null;
  name: string;
  generation?: GenerationBinding;
  locked?: boolean;
  figureState?: 'unplaced' | 'visible' | 'hidden';
  figure?: FigureRelation;
};
export type NodeEntity = BaseEntity & {
  kind: 'node';
  semantic?: { role: 'tensor-source' | 'tensor-result' | 'operation' };
  annotation?: AnnotationContent;
  size: { width: number; height: number };
  bounds: Bounds;
  primitives: Primitive[];
  ports: Record<string, Port>;
  presentation: Presentation;
};
export type GroupEntity = BaseEntity & {
  kind: 'group';
  groupRole?: 'drawing' | 'module';
  size: { width: number; height: number };
  ports: Record<string, Port>;
  presentation: Presentation;
};
export type EdgeStyle = {
  color: string;
  width: number;
  dashed: boolean;
  arrow: boolean;
  opacity?: number;
};
export type EdgeEntity = BaseEntity & {
  kind: 'edge';
  meaning?: 'dataflow' | 'annotation';
  source: Endpoint;
  target: Endpoint;
  route: {
    kind: 'straight' | 'orthogonal' | 'curve';
    mode: 'auto' | 'manual';
    points: Point[];
    spaceId: string | null;
  };
  style: EdgeStyle;
  /** Only fields explicitly edited by a user survive regeneration. */
  styleOverrides?: Partial<EdgeStyle>;
  label?: string;
};
export type Entity = NodeEntity | GroupEntity | EdgeEntity;
export type AssetMap = Record<
  string,
  { mime: 'image/png' | 'image/jpeg'; data: string; width: number; height: number }
>;
export type ProjectDocument = {
  schemaVersion: 1 | 2 | 3;
  id: string;
  title: string;
  revision: number;
  entities: Record<string, Entity>;
  assets: AssetMap;
  dependencies: Record<string, string>;
  theme: {
    fontFamily: string;
    lineColor: string;
    nodeColor?: string;
    textColor?: string;
    borderColor?: string;
    lineWidth?: number;
  };
  page: { width: number; height: number; background: 'white' | 'transparent' | `#${string}` };
};
export type ResolvedOperation =
  | { kind: 'put'; entity: Entity }
  | { kind: 'remove'; ids: string[] }
  | { kind: 'move'; id: string; position: Point }
  | { kind: 'compositionMove'; id: string; position: Point }
  | { kind: 'label'; id: string; text: string | null }
  | { kind: 'fill'; id: string; color: string | null }
  | {
      kind: 'nodeStyle';
      id: string;
      style: {
        fill?: string | null;
        stroke?: string | null;
        text?: string | null;
        opacity?: number | null;
        strokeWidth?: number | null;
      };
    }
  | { kind: 'route'; id: string; route: EdgeEntity['route'] }
  | { kind: 'reconnect'; id: string; end: 'source' | 'target'; endpoint: Endpoint }
  | { kind: 'edgeStyle'; id: string; style: Partial<EdgeEntity['style']> }
  | {
      kind: 'metadata';
      title?: string;
      page?: ProjectDocument['page'];
      theme?: ProjectDocument['theme'];
    }
  | { kind: 'assets'; assets: AssetMap }
  | { kind: 'dependencies'; dependencies: Record<string, string> };
export type GenerateOperation = {
  kind: 'generate';
  id: string;
  generatorId: string;
  params: Params;
  position?: Point;
  confirmRemoval?: boolean;
};
export type Operation = ResolvedOperation | GenerateOperation;
export type EditProposal = { baseRevision: number; operations: Operation[]; warnings?: string[] };
export type CommitResult =
  | { ok: true; document: ProjectDocument }
  | { ok: false; error: ErrorDetail };
export type GenerationServices = {
  prepare(doc: ProjectDocument, operation: GenerateOperation): Promise<Result<ResolvedOperation[]>>;
};
export type DocumentStore = {
  getSnapshot(): ProjectDocument;
  subscribe(listener: () => void): () => void;
  dispatch(proposal: EditProposal): Promise<CommitResult>;
  undo(): CommitResult;
  redo(): CommitResult;
  canUndo(): boolean;
  canRedo(): boolean;
  setReadonly(value: boolean): void;
  isReadonly(): boolean;
};
