/** An operation being configured, not yet a document object. */
export type TensorOperationDraft = {
  /** Full generator ID; built-in kind aliases are accepted for existing callers. */
  kind: string;
  sourceIds: string[];
};
export type EditRequest = { id: string; serial: number };
