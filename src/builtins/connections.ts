import type {
  ConnectionPatternDefinition,
  ConnectionSpec,
  ProjectDocument,
} from '../plugins/sdk.ts';

function nodes(doc: Readonly<ProjectDocument>, selection: readonly string[], count: number) {
  if (selection.length < count || new Set(selection).size !== selection.length)
    throw new Error(`请按连接顺序选择至少 ${count} 个网络基元。`);
  return selection.map((id) => {
    const node = doc.entities[id];
    if (!node || node.kind === 'edge' || node.locked) throw new Error('请选择未锁定的网络基元。');
    return node;
  });
}
function out(doc: Readonly<ProjectDocument>, id: string) {
  const node = doc.entities[id];
  if (!node || node.kind === 'edge' || !Object.hasOwn(node.ports, 'out'))
    throw new Error(`${node?.name ?? id} 缺少 out 输出端口。`);
  return { entityId: id, portId: 'out' };
}
function inputs(doc: Readonly<ProjectDocument>, id: string, count = 1) {
  const node = doc.entities[id];
  if (!node || node.kind === 'edge') throw new Error('连接目标不是网络基元。');
  const occupied = new Set(
    Object.values(doc.entities).flatMap((e) =>
      e.kind === 'edge' && e.target.kind === 'port' && e.target.entityId === id
        ? [e.target.portId]
        : [],
    ),
  );
  const ports = Object.keys(node.ports)
    .filter((key) => /^in(?:[2-9]|[1-9]\d+)?$/.test(key) && !occupied.has(key))
    .sort((a, b) => (a === 'in' ? 1 : Number(a.slice(2))) - (b === 'in' ? 1 : Number(b.slice(2))));
  if (ports.length < count)
    throw new Error(`${node.name} 需要 ${count} 个未占用的输入端口（in、in2…）。`);
  return ports.slice(0, count).map((portId) => ({ entityId: id, portId }));
}
function definition(
  id: string,
  name: string,
  description: string,
  count: number,
  connect: ConnectionPatternDefinition['connect'],
): ConnectionPatternDefinition {
  return {
    id,
    version: '1.0.0',
    name,
    description,
    fields: [],
    defaults: {},
    isAvailable(doc, selection) {
      try {
        nodes(doc, selection, count);
        connect(doc, selection, {});
        return true;
      } catch {
        return false;
      }
    },
    connect(doc, selection, params) {
      nodes(doc, selection, count);
      return connect(doc, selection, params);
    },
  };
}
export const builtinConnectionPatterns: ConnectionPatternDefinition[] = [
  definition(
    'builtin.chain',
    '顺序串联',
    '按选择顺序依次连接各节点；保持节点布局不变。',
    2,
    (doc, selection) =>
      selection.slice(1).map(
        (id, i): ConnectionSpec => ({
          source: out(doc, selection[i]),
          target: inputs(doc, id)[0],
        }),
      ),
  ),
  definition(
    'builtin.branch',
    '一对多分支',
    '第一个选中节点作为入口，分别连接其余节点。',
    3,
    (doc, selection) =>
      selection
        .slice(1)
        .map((id) => ({ source: out(doc, selection[0]), target: inputs(doc, id)[0] })),
  ),
  definition(
    'builtin.merge',
    '多对一合并',
    '最后选中的节点作为目标，前面的节点接入不同输入端口。',
    3,
    (doc, selection) => {
      const targets = inputs(doc, selection.at(-1)!, selection.length - 1);
      return selection.slice(0, -1).map((id, i) => ({ source: out(doc, id), target: targets[i] }));
    },
  ),
];
