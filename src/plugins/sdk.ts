/** Public, build-time plugin API. No canvas internals or mutable document handles. */
export type {
  ProjectDocument,
  Entity,
  NodeEntity,
  GroupEntity,
  EdgeEntity,
  Params,
  Point,
  Result,
  EditProposal,
  ResolvedOperation,
} from '../core/document/types.ts';
export type { Primitive, BlockAppearance, BlockGeometry } from '../graphics/primitives.ts';
import type {
  ProjectDocument,
  Entity,
  Params,
  EditProposal,
  EdgeEntity,
  Point,
} from '../core/document/types.ts';
export type ParamField = { key: string; label: string; section?: 'structure' | 'appearance' } & (
  | { type: 'number'; min: number; max: number; step?: number; nullable?: boolean }
  | { type: 'text' }
  | { type: 'boolean' }
  | { type: 'color' }
  | { type: 'enum'; options: { value: string; label: string }[] }
  | { type: 'list'; item: ParamField }
);
export type GraphFragment = { rootKey: string; entities: Record<string, Entity> };
export type GeneratorDefinition = {
  id: string;
  version: string;
  paramSchemaVersion: number;
  name: string;
  description: string;
  defaults: Params;
  fields: ParamField[];
  generate(
    params: Params,
    theme: ProjectDocument['theme'],
    previousLocalKeys?: Record<string, string>,
  ): GraphFragment | Promise<GraphFragment>;
};
/** A reusable independently editable network element, not a whole-network preset. */
export type PrimitiveDefinition = GeneratorDefinition & {
  category: string;
  icon?: string;
  keywords?: string[];
};
/** Host-created links use world-space control points and remain ordinary editable edges. */
export type ConnectionSpec = {
  source: { entityId: string; portId: string };
  target: { entityId: string; portId: string };
  label?: string;
  route?: { kind: 'straight' | 'orthogonal' | 'curve'; points: Point[] };
  style?: Partial<EdgeEntity['style']>;
};
export type ConnectionPatternDefinition = {
  id: string;
  version: string;
  name: string;
  description: string;
  fields: ParamField[];
  defaults: Params;
  isAvailable(doc: Readonly<ProjectDocument>, selection: readonly string[]): boolean;
  connect(
    doc: Readonly<ProjectDocument>,
    selection: readonly string[],
    params: Params,
  ): ConnectionSpec[] | Promise<ConnectionSpec[]>;
};
export type CanvasCommand = {
  id: string;
  name: string;
  description: string;
  permissions: ('move' | 'label' | 'fill' | 'edgeStyle')[];
  fields: ParamField[];
  isAvailable(doc: Readonly<ProjectDocument>, selection: readonly string[]): boolean;
  run(
    doc: Readonly<ProjectDocument>,
    selection: readonly string[],
    params: Params,
  ): EditProposal | Promise<EditProposal>;
};
export type PluginDefinition = {
  manifest: {
    id: string;
    name: string;
    version: string;
    apiVersion: 1;
    dependencies?: Record<string, string>;
  };
  generators?: GeneratorDefinition[];
  primitives?: PrimitiveDefinition[];
  connectionPatterns?: ConnectionPatternDefinition[];
  commands?: CanvasCommand[];
};
export { buildBlockGeometry } from '../graphics/block-geometry.ts';
export { layerGenerators, createLayerNode } from '../builtins/layers.ts';
