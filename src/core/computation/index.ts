export type {
  TensorShape,
  TensorKind,
  AnalysisEntry,
  AnalysisReport,
  MathExpression,
  FormulaLine,
} from './types.ts';
export { math, tensorSpace } from './formulas.ts';
export { tensorKind, tensorDimension } from './catalog.ts';
export { producerOf } from './topology.ts';
export { analyzeDocument } from './propagation.ts';
export type {
  ComputationDefinition,
  ComputationRegistry,
  ComputationInput,
  RuleResult,
} from './definitions.ts';
export {
  resolveComputation,
  resolveOperation,
  listAvailableOperations,
  defaultComputations,
} from './registry.ts';
