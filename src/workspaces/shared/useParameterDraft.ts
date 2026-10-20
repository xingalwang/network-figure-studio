import { useEffect, useRef, useState } from 'react';
import type { Params } from '../../core/document/types.ts';
import {
  applyParameterDraft,
  discardParameterDraft,
  readParameterDraft,
  writeParameterDraft,
  type ParameterDraftCache,
} from './parameter-drafts.ts';

/** Shared draft lifecycle; inspectors retain ownership of their field presentation. */
export function useParameterDraft({
  id,
  official,
  drafts,
  onDraftChange,
}: {
  id: string | undefined;
  official: Params | null;
  drafts?: ParameterDraftCache;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const local = useRef<ParameterDraftCache>(new Map());
  const cache = drafts ?? local.current;
  const source = JSON.stringify(official);
  const read = () => readParameterDraft(cache, id ?? '', official);
  const [params, setParams] = useState(() => read().params);
  useEffect(() => setParams(read().params), [id, source, cache]);
  const conflict = read().conflict;
  const dirty = JSON.stringify(params) !== JSON.stringify(official ?? {});
  const notify = () => onDraftChange?.(cache.size > 0);
  const change = (params: Params) => {
    if (!id) return;
    writeParameterDraft(cache, id, official, params);
    setParams(read().params);
    notify();
  };
  const reset = () => {
    if (!id) return;
    discardParameterDraft(cache, id);
    setParams(read().params);
    notify();
  };
  const apply = async (commit: (params: Params) => Promise<boolean>, confirmation: string) => {
    if (!id) return false;
    const success = await applyParameterDraft(cache, id, official, params, {
      commit,
      confirmOverwrite: () => confirm(confirmation),
    });
    if (success) {
      setParams(cache.get(id)?.params ?? params);
      notify();
    }
    return success;
  };
  return { params, dirty, conflict, change, reset, apply };
}
