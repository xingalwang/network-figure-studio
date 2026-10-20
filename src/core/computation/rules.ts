import type { AnalysisEntry, TensorShape } from './types.ts';
import { shapeAxes, shapeDimension } from './catalog.ts';
export const entry = (
  state: AnalysisEntry['state'],
  explanation: string,
  diagnostics: string[] = [],
): AnalysisEntry => ({ state, inputs: [], steps: [], explanation, diagnostics });
export const positive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export const full = (shape: TensorShape): boolean =>
  shapeAxes(shapeDimension(shape)).every((axis) => positive(shape[axis]));
