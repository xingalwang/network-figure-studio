import type { Params } from '../../core/document/types.ts';

/** Per-object, in-memory drafts. Never persisted in the project or its undo history. */
export type ParameterDraftCache = Map<string, { base: string; params: Params }>;
export type ParameterDraftState = { params: Params; dirty: boolean; conflict: boolean };
const signature = (params: Params | null) => JSON.stringify(params);

export function readParameterDraft(
  cache: ParameterDraftCache,
  id: string,
  official: Params | null,
): ParameterDraftState {
  const cached = cache.get(id),
    params = cached?.params ?? official ?? {};
  return {
    params,
    dirty: signature(params) !== signature(official ?? {}),
    conflict: !!cached && cached.base !== signature(official),
  };
}

export function writeParameterDraft(
  cache: ParameterDraftCache,
  id: string,
  official: Params | null,
  params: Params,
) {
  const base = signature(official);
  if (signature(params) === base) cache.delete(id);
  else cache.set(id, { base: cache.get(id)?.base ?? base, params });
}

export function discardParameterDraft(cache: ParameterDraftCache, id: string) {
  cache.delete(id);
}

/** A declined confirmation or failed transaction leaves the cache intact. */
export async function applyParameterDraft(
  cache: ParameterDraftCache,
  id: string,
  official: Params | null,
  params: Params,
  actions: {
    confirmOverwrite: () => boolean;
    commit: (params: Params) => Promise<boolean>;
  },
): Promise<boolean> {
  const draft = cache.get(id);
  if (draft && draft.base !== signature(official) && !actions.confirmOverwrite()) return false;
  if (!(await actions.commit(params))) return false;
  // Fields remain editable during an async commit; only clear the submitted draft.
  if (cache.get(id) === draft) cache.delete(id);
  return true;
}
