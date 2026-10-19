import {
  fail,
  type DocumentStore,
  type CommitResult,
  type Params,
} from '../core/document/types.ts';
import { validateParams, type PluginRegistry } from './registry.ts';
export async function executePluginCommand(
  store: DocumentStore,
  registry: PluginRegistry,
  id: string,
  selection: string[],
  params: Params,
): Promise<CommitResult> {
  const command = registry.commands.get(id),
    doc = store.getSnapshot();
  if (!command || !command.isAvailable(doc, selection))
    return fail('COMMAND_UNAVAILABLE', '当前选择不能执行此命令。');
  const valid = validateParams(command.fields, params);
  if (!valid.ok) return valid;
  try {
    const proposal = await command.run(doc, Object.freeze([...selection]), valid.value);
    if (
      proposal.baseRevision !== doc.revision ||
      proposal.operations.some(
        (op) =>
          !command.permissions.includes(op.kind as never) ||
          !('id' in op) ||
          !selection.includes(op.id),
      )
    )
      return fail('COMMAND_SCOPE', '插件命令超出声明权限或选择范围，未应用。');
    return store.dispatch(proposal);
  } catch (error) {
    return fail('COMMAND_FAILED', error instanceof Error ? error.message : '插件命令执行失败。');
  }
}
