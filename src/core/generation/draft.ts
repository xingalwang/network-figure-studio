import type { ProjectDocument, Params, GenerationBinding } from '../document/types.ts';
export type GenerationDraft = { instanceId: string; binding: GenerationBinding; params: Params };
export function beginDraft(doc: ProjectDocument, instanceId: string): GenerationDraft {
  const binding = doc.entities[instanceId]?.generation;
  if (!binding || binding.source.kind !== 'local') throw new Error('请选择带独立生成参数的组件。');
  return {
    instanceId,
    binding: structuredClone(binding),
    params: structuredClone(binding.source.params),
  };
}
export function checkDraft(
  doc: ProjectDocument,
  draft: GenerationDraft,
): { kind: 'ready' | 'parameter-conflict' | 'target-missing' } {
  const b = doc.entities[draft.instanceId]?.generation;
  if (
    !b ||
    b.generatorId !== draft.binding.generatorId ||
    b.version !== draft.binding.version ||
    b.source.kind !== 'local'
  )
    return { kind: 'target-missing' };
  return {
    kind:
      JSON.stringify(b.source) !== JSON.stringify(draft.binding.source)
        ? 'parameter-conflict'
        : 'ready',
  };
}
