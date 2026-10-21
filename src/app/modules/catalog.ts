import type { PluginRegistry } from '../../plugins/registry.ts';
import type { ProjectDocument } from '../../core/document/types.ts';
import { operationCapability } from '../editor/capabilities.ts';

export type ModuleEntry = {
  id: string;
  name: string;
  description: string;
  icon: string;
} & (
  | { kind: 'data'; dimension: 2 | 3 }
  | { kind: 'operation' }
  | { kind: 'primitive' }
  | { kind: 'connection' }
  | { kind: 'preset' }
);
export type WorkbenchModule = {
  id: string;
  name: string;
  entries: ModuleEntry[];
};

/** The registry owns definitions; this catalog only describes where creation tools appear. */
export function buildModuleCatalog(registry: PluginRegistry): WorkbenchModule[] {
  return [...registry.plugins.values()]
    .map((plugin) => {
      const computations = new Map((plugin.computations ?? []).map((d) => [d.generatorId, d]));
      const primitives = new Set((plugin.primitives ?? []).map((p) => p.id));
      const entries: ModuleEntry[] = [];
      for (const generator of [...(plugin.generators ?? []), ...(plugin.primitives ?? [])]) {
        const computation = computations.get(generator.id);
        if (computation?.role === 'tensor-source') {
          const dimension = computation.dimension(generator.defaults);
          // The current source-creation command supports these two built-in generators.
          if (dimension && generator.id === `tensor.source${dimension}d`)
            entries.push({
              id: generator.id,
              name: `${dimension}D 数据`,
              description: generator.description,
              icon: dimension === 3 ? 'cube' : 'flat',
              kind: 'data',
              dimension,
            });
        } else if (computation?.operation) {
          entries.push({
            id: generator.id,
            name: generator.name,
            description: computation.operation.hint,
            icon: computation.operation.icon,
            kind: 'operation',
          });
        } else if (!computation && !primitives.has(generator.id)) {
          entries.push({
            id: generator.id,
            name: generator.name,
            description: generator.description,
            icon: 'cube',
            kind: 'preset',
          });
        }
      }
      for (const primitive of plugin.primitives ?? [])
        if (!computations.has(primitive.id))
          entries.push({
            id: primitive.id,
            name: primitive.name,
            description: primitive.description,
            icon: primitive.icon ?? 'cube',
            kind: 'primitive',
          });
      for (const connection of plugin.connectionPatterns ?? [])
        entries.push({
          id: connection.id,
          name: connection.name,
          description: connection.description,
          icon: 'arrow',
          kind: 'connection',
        });
      return {
        id: plugin.manifest.id,
        name: plugin.manifest.id === 'builtin' ? '基础深度学习' : plugin.manifest.name,
        entries,
      };
    })
    .filter((module) => module.entries.length > 0);
}

/** Availability is delegated to the same registry check used by canvas operations. */
export function operationUnavailableReason(
  registry: PluginRegistry,
  doc: ProjectDocument,
  selection: readonly string[],
  id: string,
): string | null {
  return operationCapability(registry, doc, selection, id, {
    workspace: 'generator',
    readonly: false,
  }).reason;
}
