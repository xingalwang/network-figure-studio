import type {
  ConnectionPatternDefinition,
  ConnectionSpec,
  ProjectDocument,
} from '../../../src/plugins/sdk.ts';

function connections(
  doc: Readonly<ProjectDocument>,
  selection: readonly string[],
): ConnectionSpec[] {
  if (selection.length !== 4 || new Set(selection).size !== 4)
    throw new Error('请依次选择入口、支路一、支路二、合并节点，共 4 个基元。');
  const [entry, first, second, merge] = selection;
  const endpoint = (entityId: string, portId: string) => {
    const entity = doc.entities[entityId];
    if (!entity || entity.kind === 'edge' || entity.locked || !Object.hasOwn(entity.ports, portId))
      throw new Error(`节点缺少 ${portId} 端口，不能建立双路并行。`);
    return { entityId, portId };
  };
  return [
    { source: endpoint(entry, 'out'), target: endpoint(first, 'in') },
    { source: endpoint(entry, 'out'), target: endpoint(second, 'in') },
    { source: endpoint(first, 'out'), target: endpoint(merge, 'in') },
    { source: endpoint(second, 'out'), target: endpoint(merge, 'in2') },
  ];
}
export const parallelBranchesPattern: ConnectionPatternDefinition = {
  id: 'example.parallel-branches',
  version: '1.0.0',
  name: '双路并行',
  description: '依次选择入口、支路一、支路二、合并节点；建立 4 条普通连接，不改变节点布局。',
  fields: [],
  defaults: {},
  isAvailable(doc, selection) {
    try {
      connections(doc, selection);
      return true;
    } catch {
      return false;
    }
  },
  connect: connections,
};
