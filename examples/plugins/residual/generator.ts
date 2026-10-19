import { createLayerNode, layerGenerators } from '../../../src/plugins/sdk.ts';
import type {
  EdgeEntity,
  Entity,
  GeneratorDefinition,
  GroupEntity,
  NodeEntity,
  Params,
  ProjectDocument,
} from '../../../src/plugins/sdk.ts';

type LayerKind = Parameters<typeof createLayerNode>[0];
const layer = (kind: LayerKind) => layerGenerators.find((g) => g.id === `builtin.${kind}`)!;
const commonKeys = ['channels', 'mode', 'depth', 'stackCount', 'stackGap', 'angleDeg'];

function child(
  key: string,
  kind: LayerKind,
  params: Params,
  theme: ProjectDocument['theme'],
): NodeEntity {
  const definition = layer(kind);
  // Thin operation layers keep their own sheet count; activations and addition stay flat by default.
  const inherit = commonKeys.filter(
    (k) =>
      !(k === 'stackCount' && ['conv', 'relu', 'add'].includes(kind)) &&
      !(k === 'mode' && ['relu', 'add'].includes(kind)),
  );
  const inherited = Object.fromEntries(
    inherit.filter((k) => k in params).map((k) => [k, params[k]]),
  );
  const slots = params.__slots as Record<string, Params> | undefined;
  const effective = { ...definition.defaults, ...inherited, ...slots?.[key] };
  return {
    ...createLayerNode(kind, effective, theme),
    id: key,
    parentId: 'root',
    generation: {
      generatorId: definition.id,
      version: definition.version,
      paramSchemaVersion: definition.paramSchemaVersion,
      source: { kind: 'slot', ownerId: 'root', slotKey: key, inherit },
      localKeys: { root: key },
    },
  };
}

function edge(
  key: string,
  source: string,
  target: string,
  theme: ProjectDocument['theme'],
  targetPort = 'in',
): EdgeEntity {
  return {
    id: key,
    kind: 'edge',
    name: targetPort === 'skip' ? 'Identity skip' : '连接',
    parentId: 'root',
    source: { kind: 'port', entityId: source, portId: 'out' },
    target: { kind: 'port', entityId: target, portId: targetPort },
    route: { kind: 'straight', mode: 'auto', points: [], spaceId: 'root' },
    style: { color: theme.lineColor, width: 1.5, dashed: false, arrow: true },
  };
}

export const residualGenerator: GeneratorDefinition = {
  id: 'example.residual',
  version: '1.0.0',
  paramSchemaVersion: 1,
  name: 'Residual Block',
  description: '两层卷积与残差连接；片数仅作用于输入与输出，每层仍可单独调整。',
  defaults: {
    channels: 64,
    repeats: 1,
    mode: 'axonometric',
    depth: 24,
    stackCount: 3,
    stackGap: 6,
    angleDeg: 30,
  },
  fields: [
    ...layer('input').fields.filter((f) => f.key === 'channels'),
    {
      key: 'repeats',
      label: '残差块数量',
      section: 'structure',
      type: 'number',
      min: 1,
      max: 6,
      step: 1,
    },
    ...layer('input')
      .fields.filter((f) => ['mode', 'depth', 'stackCount', 'stackGap', 'angleDeg'].includes(f.key))
      .map((f) => (f.key === 'stackCount' ? { ...f, label: '特征图片数' } : f)),
  ],
  generate(params, theme) {
    const input = child('input', 'input', params, theme),
      output = child('output', 'output', params, theme);
    const nodes: NodeEntity[] = [input];
    const connections: EdgeEntity[] = [];
    let previous = input;
    for (let index = 0; index < Number(params.repeats); index++) {
      const prefix = `block-${index}`;
      const conv1 = child(`${prefix}/conv-1`, 'conv', params, theme);
      const relu = child(`${prefix}/relu`, 'relu', params, theme);
      const conv2 = child(`${prefix}/conv-2`, 'conv', params, theme);
      const add = child(`${prefix}/add`, 'add', params, theme);
      nodes.push(conv1, relu, conv2, add);
      connections.push(
        edge(`${prefix}/in`, previous.id, conv1.id, theme),
        edge(`${prefix}/conv-relu`, conv1.id, relu.id, theme),
        edge(`${prefix}/relu-conv`, relu.id, conv2.id, theme),
        edge(`${prefix}/conv-add`, conv2.id, add.id, theme),
        edge(`${prefix}/skip`, previous.id, add.id, theme, 'skip'),
      );
      previous = add;
    }
    nodes.push(output);
    connections.push(edge('output-edge', previous.id, output.id, theme));

    const centerY = Math.max(
      140,
      ...nodes.map((node) => 60 + node.size.height / 2 - node.bounds.y),
    );
    let cursor = 20;
    for (const node of nodes) {
      node.presentation.position = { x: cursor - node.bounds.x, y: centerY - node.size.height / 2 };
      cursor += node.bounds.width + 36;
    }
    const entities: Record<string, Entity> = Object.fromEntries(
      nodes.map((node) => [node.id, node]),
    );
    for (const connection of connections) {
      if (
        connection.target.kind === 'port' &&
        connection.target.portId === 'skip' &&
        connection.source.kind === 'port'
      ) {
        const from = entities[connection.source.entityId] as NodeEntity,
          to = entities[connection.target.entityId] as NodeEntity;
        const branchX = from.presentation.position.x + from.size.width + 18;
        connection.route = {
          kind: 'orthogonal',
          mode: 'auto',
          spaceId: 'root',
          points: [
            { x: branchX, y: centerY },
            { x: branchX, y: 30 },
            { x: to.presentation.position.x + to.size.width / 2, y: 30 },
          ],
        };
      }
      entities[connection.id] = connection;
    }
    const root: GroupEntity = {
      id: 'root',
      kind: 'group',
      parentId: null,
      name: 'Residual Block',
      size: {
        width: Math.max(760, cursor - 36 + 20),
        height: Math.max(
          250,
          ...nodes.map(
            (node) => node.presentation.position.y + node.bounds.y + node.bounds.height + 10,
          ),
        ),
      },
      ports: {
        in: { entityId: input.id, portId: 'in' },
        out: { entityId: output.id, portId: 'out' },
      },
      presentation: { position: { x: 0, y: 0 } },
    };
    return { rootKey: 'root', entities: { root, ...entities } };
  },
};
