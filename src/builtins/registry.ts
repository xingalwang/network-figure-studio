import { residualPlugin } from '../../examples/plugins/residual/index.ts';
import { createPluginRegistry } from '../plugins/registry.ts';
import type { PluginDefinition } from '../plugins/sdk.ts';
import { builtinPrimitives } from './layers.ts';
import { builtinConnectionPatterns } from './connections.ts';
import { tensorGenerators } from './tensors.ts';
import { attentionPlugin } from '../../examples/plugins/attention/index.ts';
import { builtinComputations } from './computations.ts';
import { leakyReluPlugin } from '../../examples/plugins/leaky-relu/index.ts';

export const builtinPlugin: PluginDefinition = {
  manifest: { id: 'builtin', name: '基础网络层', version: '1.0.0', apiVersion: 1 },
  primitives: builtinPrimitives,
  generators: tensorGenerators,
  connectionPatterns: builtinConnectionPatterns,
  computations: builtinComputations,
};

export function createBuiltinRegistry() {
  const registry = createPluginRegistry([
    builtinPlugin,
    residualPlugin,
    attentionPlugin,
    leakyReluPlugin,
  ]);
  return registry;
}
