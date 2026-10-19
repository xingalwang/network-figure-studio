import type { PluginDefinition } from '../../../src/plugins/sdk.ts';

export const manifest: PluginDefinition['manifest'] = {
  id: 'example.residual',
  name: 'Residual 示例插件',
  version: '1.0.0',
  apiVersion: 1,
  dependencies: { builtin: '1.0.0' },
};
