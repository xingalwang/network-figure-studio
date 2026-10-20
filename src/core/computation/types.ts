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
export type AnalysisEntry = {
  state: 'ready' | 'pending' | 'error' | 'unsupported';
  shape?: TensorShape;
  inputs: { entityId: string; portId: string; shape?: TensorShape }[];
  parameterCount?: number;
  steps: string[];
  explanation: string;
  diagnostics: string[];
};
export type AnalysisReport = { nodes: Record<string, AnalysisEntry> };
