import type { PluginDefinition } from '../../../src/plugins/sdk.ts';
import { manifest } from './manifest.ts';
import { attentionGatePrimitive } from './primitive.ts';
import { parallelBranchesPattern } from './connections.ts';
export const attentionPlugin: PluginDefinition = {
  manifest,
  primitives: [attentionGatePrimitive],
  connectionPatterns: [parallelBranchesPattern],
};
