import type {
  CanvasCommand,
  GroupEntity,
  NodeEntity,
  ProjectDocument,
} from '../../../src/plugins/sdk.ts';

type Movable = NodeEntity | GroupEntity;
const centerX = (node: Movable) =>
  node.presentation.position.x + (node.size.width * (node.presentation.scale ?? 1)) / 2;

function movableSelection(
  doc: Readonly<ProjectDocument>,
  selection: readonly string[],
): Movable[] | null {
  if (selection.length < 3 || new Set(selection).size !== selection.length) return null;
  const nodes = selection.map((id) => doc.entities[id]);
  if (
    nodes.some(
      (node) => !node || node.kind === 'edge' || node.locked || node.parentId !== nodes[0].parentId,
    )
  )
    return null;
  return nodes as Movable[];
}

export const distributeXCommand: CanvasCommand = {
  id: 'example.distribute-x',
  name: '水平等距',
  description: '按中心等距排列同组对象，保持两端与垂直位置。',
  permissions: ['move'],
  fields: [],
  isAvailable(doc, selection) {
    return movableSelection(doc, selection) !== null;
  },
  run(doc, selection) {
    const nodes = movableSelection(doc, selection);
    if (!nodes) throw new Error('请选择至少三个同组、未锁定的组件。');
    nodes.sort((a, b) => centerX(a) - centerX(b) || a.id.localeCompare(b.id));
    const first = centerX(nodes[0]),
      step = (centerX(nodes[nodes.length - 1]) - first) / (nodes.length - 1);
    return {
      baseRevision: doc.revision,
      operations: nodes.slice(1, -1).flatMap((node, index) => {
        const x =
          first + step * (index + 1) - (node.size.width * (node.presentation.scale ?? 1)) / 2;
        return x === node.presentation.position.x
          ? []
          : [
              {
                kind: 'move' as const,
                id: node.id,
                position: { x, y: node.presentation.position.y },
              },
            ];
      }),
    };
  },
};
