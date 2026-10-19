/** Actual axes only: a 2D tensor never has a D key. */
export type TensorShape = {
  N: number | null;
  D?: number | null;
  H: number | null;
  W: number | null;
  C: number | null;
};
export type TensorAxis = keyof TensorShape;
export type TensorKind =
  | 'source'
  | 'result'
  | 'conv2d'
  | 'pool2d'
  | 'conv3d'
  | 'pool3d'
  | 'relu'
  | 'upsample'
  | 'concat'
  | 'add';
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
