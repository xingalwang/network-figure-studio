import type { TensorKind } from '../../core/computation/index.ts';

/** An operation being configured, not yet a document object. */
export type TensorOperationDraft = {
  kind: Exclude<TensorKind, 'source' | 'result'>;
  sourceIds: string[];
};
export type EditRequest = { id: string; serial: number };
