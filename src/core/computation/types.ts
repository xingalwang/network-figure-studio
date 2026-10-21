/** Actual axes only: a 2D tensor never has a D key. */
export type TensorShape = {
  N: number | null;
  D?: number | null;
  H: number | null;
  W: number | null;
  C: number | null;
};
export type TensorAxis = keyof TensorShape;
/** Built-in aliases remain accepted; extension operations use their full generator ID. */
export type TensorKind = string;
/** Derived mathematical notation, never part of a persisted project or an executable rule. */
export type MathExpression =
  | { kind: 'identifier'; text: string; variant: 'normal' | 'italic' | 'double-struck' }
  | { kind: 'number'; value: number }
  | { kind: 'operator'; text: string }
  | { kind: 'row'; items: MathExpression[] }
  | { kind: 'subscript' | 'superscript'; base: MathExpression; script: MathExpression }
  | { kind: 'fraction'; numerator: MathExpression; denominator: MathExpression }
  | { kind: 'fenced'; expression: MathExpression; left: string; right: string };
export type FormulaLine = { label: string; expression: MathExpression; description?: string };
export type AnalysisEntry = {
  state: 'ready' | 'pending' | 'error' | 'unsupported';
  shape?: TensorShape;
  inputs: { entityId: string; portId: string; shape?: TensorShape }[];
  parameterCount?: number;
  steps: string[];
  explanation: string;
  diagnostics: string[];
  formulas?: FormulaLine[];
};
export type AnalysisReport = { nodes: Record<string, AnalysisEntry> };
