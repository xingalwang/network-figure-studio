import type { ProjectDocument } from '../../core/document/types.ts';
import {
  listAvailableOperations,
  resolveOperation,
  tensorDimension,
} from '../../core/computation/index.ts';
import {
  isConnectionEndpointAvailable,
  type ConnectionWorkspace,
} from '../../core/figure/connections.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';

export type Capability = { available: boolean; reason: string | null };
export type CapabilityContext = {
  workspace: ConnectionWorkspace;
  readonly: boolean;
  enabledOperationIds?: ReadonlySet<string>;
};
const allowed: Capability = { available: true, reason: null };
const unavailable = (reason: string): Capability => ({ available: false, reason });

/** One availability contract for the module library, canvas menu, toolbar and edit action. */
export function operationCapability(
  registry: PluginRegistry,
  doc: ProjectDocument,
  selection: readonly string[],
  id: string,
  context: CapabilityContext,
): Capability {
  if (context.readonly) return unavailable('当前工程为只读。');
  if (context.workspace !== 'generator') return unavailable('请切换到组装工作区添加运算。');
  const definition = resolveOperation(id, registry.computations),
    operation = definition?.operation;
  if (!operation) return unavailable('该运算未注册。');
  if (context.enabledOperationIds && !context.enabledOperationIds.has(definition.generatorId))
    return unavailable('请在模块设置中启用此运算。');
  if (listAvailableOperations(doc, selection, registry.computations).includes(definition))
    return allowed;
  if (!selection.length) return unavailable('先在画布中选择输入数据。');
  if (new Set(selection).size !== selection.length) return unavailable('请选择不同的输入数据。');
  if (selection.length < operation.minInputs || selection.length > operation.maxInputs)
    return unavailable(
      operation.minInputs === operation.maxInputs
        ? `需要选择 ${operation.minInputs} 个输入数据。`
        : `需要选择 ${operation.minInputs}–${operation.maxInputs} 个输入数据。`,
    );
  const dimensions = selection.map((key) =>
    tensorDimension(doc.entities[key], registry.computations),
  );
  if (dimensions.some((dimension) => !dimension)) return unavailable('请选择数据块作为输入。');
  if (new Set(dimensions).size > 1) return unavailable('输入数据的维数需要一致。');
  return unavailable(
    `适用于 ${operation.dimensions.map((dimension) => `${dimension}D`).join('／')} 数据。`,
  );
}

/** Explanatory connections cannot silently become computation dataflow. */
export function connectionCapability(
  registry: PluginRegistry,
  doc: ProjectDocument,
  selection: readonly string[],
  id: string,
  context: Pick<CapabilityContext, 'workspace' | 'readonly'>,
): Capability {
  if (context.readonly) return unavailable('当前工程为只读。');
  if (
    context.workspace === 'generator' &&
    selection.some((key) => {
      const entity = doc.entities[key];
      return entity?.kind === 'node' && !!entity.semantic;
    })
  )
    return unavailable('计算数据请使用适用运算建立数据流；连接模板用于自由基元和图稿。');
  if (
    selection.length < 2 ||
    selection.some((key) => !isConnectionEndpointAvailable(doc, key, context.workspace))
  )
    return unavailable('请选择当前工作区中可见、带端口且可连接的对象。');
  const pattern = registry.connectionPatterns.get(id);
  if (!pattern) return unavailable('该连接方式未注册。');
  try {
    return pattern.isAvailable(doc, [...selection])
      ? allowed
      : unavailable('按连接顺序选择带可用端口的对象。');
  } catch {
    return unavailable('当前对象不支持该连接方式。');
  }
}
