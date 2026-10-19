import type { ProjectDocument, NodeEntity, EdgeEntity } from '../../src/core/document/types';
export function makeEmptyProject(): ProjectDocument {
  return {
    schemaVersion: 1,
    id: 'test-project',
    title: '测试图',
    revision: 0,
    entities: {},
    assets: {},
    dependencies: {},
    theme: { fontFamily: 'Inter, Noto Sans SC, sans-serif', lineColor: '#374151' },
    page: { width: 1200, height: 700, background: 'white' },
  };
}
export function makeCoreFixture(): ProjectDocument {
  const node: NodeEntity = {
    id: 'node-a',
    kind: 'node',
    parentId: null,
    name: 'Conv',
    size: { width: 80, height: 60 },
    bounds: { x: 0, y: 0, width: 80, height: 60 },
    presentation: { position: { x: 120, y: 160 } },
    ports: { in: { x: 0, y: 30 }, out: { x: 80, y: 30 } },
    primitives: [
      { kind: 'rect', x: 0, y: 0, width: 80, height: 60, fill: '#90c9c9', stroke: '#374151' },
    ],
  };
  const other = {
    ...structuredClone(node),
    id: 'node-b',
    presentation: { position: { x: 400, y: 160 } },
  };
  const edge: EdgeEntity = {
    id: 'edge',
    kind: 'edge',
    parentId: null,
    name: '连接',
    source: { kind: 'port', entityId: 'node-a', portId: 'out' },
    target: { kind: 'port', entityId: 'node-b', portId: 'in' },
    route: { kind: 'orthogonal', mode: 'manual', points: [{ x: 280, y: 100 }], spaceId: null },
    style: { color: '#374151', width: 1.5, dashed: false, arrow: true },
  };
  return { ...makeEmptyProject(), entities: { 'node-a': node, 'node-b': other, edge } };
}
