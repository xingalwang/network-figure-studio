import {
  fail,
  ok,
  type EdgeEntity,
  type Entity,
  type ProjectDocument,
  type ResolvedOperation,
  type Result,
} from '../document/types.ts';
import { isFigureEntity } from './index.ts';

type ConnectableEntity = Exclude<Entity, EdgeEntity>;
export type ConnectionWorkspace = 'generator' | 'drawing';

export function isConnectionEndpointAvailable(
  doc: ProjectDocument,
  id: string,
  workspace: ConnectionWorkspace,
): boolean {
  let entity = doc.entities[id];
  if (!entity || entity.kind === 'edge' || !Object.keys(entity.ports).length) return false;
  const seen = new Set<string>();
  while (entity) {
    if (seen.has(entity.id)) return false;
    seen.add(entity.id);
    if (
      workspace === 'drawing' &&
      (!isFigureEntity(doc, entity) ||
        entity.figureState === 'hidden' ||
        entity.figureState === 'unplaced')
    )
      return false;
    if (!entity.parentId) return true;
    entity = doc.entities[entity.parentId];
  }
  return false;
}

/** Keep the existing top-level target scope; drawing endpoints must actually be projected. */
export function connectionTargets(
  doc: ProjectDocument,
  sourceId: string,
  workspace: ConnectionWorkspace,
): ConnectableEntity[] {
  if (!isConnectionEndpointAvailable(doc, sourceId, workspace)) return [];
  return Object.values(doc.entities).filter(
    (entity): entity is ConnectableEntity =>
      entity.kind !== 'edge' &&
      entity.id !== sourceId &&
      entity.parentId === null &&
      isConnectionEndpointAvailable(doc, entity.id, workspace),
  );
}

/** Validate a new connection against one current snapshot without rewriting existing edges. */
export function planConnection(
  doc: ProjectDocument,
  sourceId: string,
  sourcePort: string,
  targetId: string,
  targetPort: string,
  workspace: ConnectionWorkspace,
): Result<ResolvedOperation[]> {
  const source = doc.entities[sourceId],
    target = doc.entities[targetId];
  if (
    !source ||
    !target ||
    source.kind === 'edge' ||
    target.kind === 'edge' ||
    sourceId === targetId ||
    target.parentId !== null ||
    !isConnectionEndpointAvailable(doc, sourceId, workspace) ||
    !isConnectionEndpointAvailable(doc, targetId, workspace)
  )
    return fail('INVALID_ENDPOINT', '连接端点已不可用；请选择当前工作区中可见且带端口的对象。');
  if (!Object.hasOwn(source.ports, sourcePort) || !Object.hasOwn(target.ports, targetPort))
    return fail('MISSING_PORT', '连接端口已不存在；请重新选择端口。');
  for (const endpoint of [source, target]) {
    if (endpoint.generation?.source.kind === 'slot')
      return fail('MANAGED_ENDPOINT', '旧组合内部由插件维护，请先解除组合生成关联。');
    let parentId = endpoint.parentId;
    while (parentId) {
      const parent = doc.entities[parentId];
      if (parent.generation)
        return fail('MANAGED_ENDPOINT', '旧组合内部由插件维护，请先解除组合生成关联。');
      parentId = parent.parentId;
    }
  }
  if (
    Object.values(doc.entities).some(
      (entity) =>
        entity.kind === 'edge' &&
        entity.source.kind === 'port' &&
        entity.source.entityId === sourceId &&
        entity.source.portId === sourcePort &&
        entity.target.kind === 'port' &&
        entity.target.entityId === targetId &&
        entity.target.portId === targetPort,
    )
  )
    return fail('DUPLICATE_CONNECTION', '这两个端口之间已有连接。');
  const edge: EdgeEntity = {
    id: crypto.randomUUID(),
    kind: 'edge',
    parentId: null,
    name: '连接',
    source: { kind: 'port', entityId: sourceId, portId: sourcePort },
    target: { kind: 'port', entityId: targetId, portId: targetPort },
    route: { kind: 'orthogonal', mode: 'auto', points: [], spaceId: null },
    style: {
      color: doc.theme.lineColor,
      width: doc.theme.lineWidth ?? 1.5,
      dashed: false,
      arrow: true,
    },
  };
  return ok([{ kind: 'put', entity: edge }]);
}
