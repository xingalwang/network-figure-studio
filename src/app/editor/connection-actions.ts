import type { DocumentStore, Params } from '../../core/document/types.ts';
import type { ConnectionWorkspace } from '../../core/figure/connections.ts';
import { connectionCapability } from './capabilities.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import { executeConnectionPattern } from '../../plugins/connections.ts';

/** Connection templates draw explanatory links; computation links belong to operation actions. */
export function createConnectionActions({
  store,
  registry,
  context,
  onError,
  onSuccess,
}: {
  store: DocumentStore;
  registry: PluginRegistry;
  context(): { workspace: ConnectionWorkspace; selection: string[] };
  onError(message: string): void;
  onSuccess(): void;
}) {
  return {
    async applyConnectionPattern(id: string, params: Params): Promise<boolean> {
      const doc = store.getSnapshot(),
        { workspace, selection } = context();
      const capability = connectionCapability(registry, doc, selection, id, {
        workspace,
        readonly: store.isReadonly(),
      });
      if (!capability.available) {
        onError(capability.reason!);
        return false;
      }
      const result = await executeConnectionPattern(store, registry, id, selection, params);
      if (!result.ok) {
        onError(result.error.message);
        return false;
      }
      onSuccess();
      return true;
    },
  };
}
