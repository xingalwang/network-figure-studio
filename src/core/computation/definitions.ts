import type { NodeEntity, Params } from '../document/types.ts';
import type { AnalysisEntry, TensorShape } from './types.ts';

export type RuleResult = Omit<AnalysisEntry, 'inputs'>;
export type ComputationInput = { id: string; role: 'tensor' | 'operation' };
/** Trusted build-time rules are synchronous and receive values, never a store or canvas. */
export type ComputationDefinition = {
  generatorId: string;
  version: string;
  paramSchemaVersion: number;
  role: NonNullable<NodeEntity['semantic']>['role'];
  /** Optional compatibility name for pre-registry built-in callers. */
  kind?: string;
  dimension(params: Readonly<Params>): 2 | 3 | null;
  inputs(params: Readonly<Params>): ComputationInput[];
  outputPort: string;
  validateParameters?(params: Readonly<Params>): RuleResult | null;
  infer(params: Readonly<Params>, shapes: readonly TensorShape[]): RuleResult;
  operation?: {
    label: string;
    hint: string;
    icon: string;
    category: '运算' | '合并';
    minInputs: number;
    maxInputs: number;
    dimensions: readonly (2 | 3)[];
    prepareParams(params: Params, dimension: 2 | 3, count: number): Params;
    resultGeneratorId(dimension: 2 | 3): string;
  };
  presentation?: {
    glyph: string;
    label?(params: Readonly<Params>): string;
    detail?(params: Readonly<Params>): string;
    hiddenFields?: readonly string[];
    fieldDimensions?: Readonly<Record<string, 2 | 3>>;
    fieldGroups?: readonly { keys: readonly string[]; title: string }[];
  };
};
export type ComputationRegistry = ReadonlyMap<string, ComputationDefinition>;
