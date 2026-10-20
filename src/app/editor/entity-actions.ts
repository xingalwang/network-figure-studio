import type { DocumentStore, Params } from '../../core/document/types.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';

type EntityActionOptions = {
  store: DocumentStore;
  registry: PluginRegistry;
  onError(message: string): void;
  confirmRemoval?(message: string): boolean | Promise<boolean>;
};

/** Shared parameter and label edits own validation, revision checks and removal confirmation. */
export function createEntityActions({
  store,
  registry,
  onError,
  confirmRemoval,
}: EntityActionOptions) {
  return {
    async updateParameters(id: string, params: Params, removalConfirmed = false): Promise<boolean> {
      const snapshot = store.getSnapshot(),
        binding = snapshot.entities[id]?.generation;
      const generator = binding && registry.generators.get(binding.generatorId);
      if (
        !binding ||
        !generator ||
        generator.version !== binding.version ||
        generator.paramSchemaVersion !== binding.paramSchemaVersion
      ) {
        onError('参数生成暂停：对象或原版本生成器不可用；现有图形保持不变。');
        return false;
      }
      const operation = {
        kind: 'generate' as const,
        id,
        generatorId: generator.id,
        params: structuredClone(params),
        confirmRemoval: removalConfirmed,
      };
      let result = await store.dispatch({
        baseRevision: snapshot.revision,
        operations: [operation],
      });
      if (
        !result.ok &&
        result.error.code === 'MANUAL_CONTENT_REMOVAL' &&
        !removalConfirmed &&
        confirmRemoval
      ) {
        if (!(await confirmRemoval(result.error.message))) return false;
        // Confirmation refers to the original snapshot; intervening edits invalidate it.
        result = await store.dispatch({
          baseRevision: snapshot.revision,
          operations: [{ ...operation, confirmRemoval: true }],
        });
      }
      if (!result.ok) onError(result.error.message);
      return result.ok;
    },
    async setLabel(id: string, text: string | null): Promise<boolean> {
      const snapshot = store.getSnapshot();
      const result = await store.dispatch({
        baseRevision: snapshot.revision,
        operations: [{ kind: 'label', id, text }],
      });
      if (!result.ok) onError(result.error.message);
      return result.ok;
    },
  };
}
