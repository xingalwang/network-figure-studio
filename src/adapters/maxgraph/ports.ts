import {
  ok,
  fail,
  type ProjectDocument,
  type Point,
  type Result,
  type Endpoint,
} from '../../core/document/types.ts';
export function worldOrigin(doc: ProjectDocument, id: string | null): Point {
  let x = 0,
    y = 0;
  const seen = new Set<string>();
  while (id !== null) {
    const e = doc.entities[id];
    if (!e || e.kind === 'edge' || seen.has(id)) throw new Error('无效坐标空间。');
    seen.add(id);
    x += e.presentation.position.x;
    y += e.presentation.position.y;
    id = e.parentId;
  }
  return { x, y };
}
export function resolvePort(
  doc: ProjectDocument,
  id: string,
  port: string,
  seen = new Set<string>(),
): Result<Point> {
  const key = `${id}:${port}`,
    e = doc.entities[id];
  if (!e || e.kind === 'edge' || !Object.hasOwn(e.ports, port) || seen.has(key))
    return fail('INVALID_PORT', '端口不存在或引用循环。');
  seen.add(key);
  const p = e.ports[port];
  if ('entityId' in p) return resolvePort(doc, p.entityId, p.portId, seen);
  try {
    const origin = worldOrigin(doc, id);
    return ok({ x: origin.x + p.x, y: origin.y + p.y });
  } catch {
    return fail('INVALID_SPACE', '无效坐标空间。');
  }
}
export function resolveEndpoint(doc: ProjectDocument, end: Endpoint): Result<Point> {
  if (end.kind === 'port') return resolvePort(doc, end.entityId, end.portId);
  try {
    const o = worldOrigin(doc, end.spaceId);
    return ok({ x: o.x + end.point.x, y: o.y + end.point.y });
  } catch {
    return fail('INVALID_SPACE', '无效坐标空间。');
  }
}
