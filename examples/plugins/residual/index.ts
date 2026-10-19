import type { PluginDefinition } from '../../../src/plugins/sdk.ts';
import { manifest } from './manifest.ts';
import { residualGenerator } from './generator.ts';
import { distributeXCommand } from './commands.ts';

export const residualPlugin: PluginDefinition = {
  manifest,
  generators: [residualGenerator],
  commands: [distributeXCommand],
};
