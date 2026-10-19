import { residualPlugin } from '../../examples/plugins/residual/index.ts';
import { createPluginRegistry } from '../plugins/registry.ts';
import type { PluginDefinition } from '../plugins/sdk.ts';
import { builtinPrimitives } from './layers.ts';
import { builtinConnectionPatterns } from './connections.ts';
import { tensorGenerators } from './tensors.ts';
import { attentionPlugin } from '../../examples/plugins/attention/index.ts';

export const builtinPlugin: PluginDefinition = {
  manifest: { id: 'builtin', name: '基础网络层', version: '1.0.0', apiVersion: 1 },
  primitives: builtinPrimitives,
  generators: tensorGenerators,
  connectionPatterns: builtinConnectionPatterns,
};

export function createBuiltinRegistry() {
  return createPluginRegistry([builtinPlugin, residualPlugin, attentionPlugin]);
}
