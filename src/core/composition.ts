import {
  fail,
  ok,
  type DocumentStore,
  type NodeEntity,
  type ProjectDocument,
  type Point,
  type ResolvedOperation,
  type Result,
} from './document/types.ts';
import type { PluginRegistry } from '../plugins/registry.ts';

export async function addPrimitive(
  store: DocumentStore,
  registry: PluginRegistry,
  generatorId: string,
  position?: Point,
): Promise<Result<string>> {
  const definition = registry.primitives.get(generatorId);
  if (!definition) return fail('UNKNOWN_PRIMITIVE', '找不到这个网络基元。');
  const doc = store.getSnapshot(),
    params = { ...definition.defaults };
  if ('fillColor' in params && doc.theme.nodeColor) params.fillColor = doc.theme.nodeColor;
  if ('borderColor' in params && doc.theme.borderColor) params.borderColor = doc.theme.borderColor;
  if ('textColor' in params && doc.theme.textColor) params.textColor = doc.theme.textColor;
  if ('strokeWidth' in params && doc.theme.lineWidth !== undefined)
    params.strokeWidth = doc.theme.lineWidth;
  const id = crypto.randomUUID();
  const result = await store.dispatch({
    baseRevision: doc.revision,
    operations: [
      { kind: 'generate', id, generatorId, params, position: position ?? vacantPosition(doc) },
    ],
  });
  return result.ok ? ok(id) : result;
}
function vacantPosition(doc: ProjectDocument): Point {
  const nodes = Object.values(doc.entities).filter((e) => e.kind !== 'edge' && e.parentId === null);
  for (let index = 0; index < nodes.length + 1; index++) {
    const p = { x: 60 + (index % 3) * 250, y: 60 + Math.floor(index / 3) * 210 };
    if (
      !nodes.some(
        (e) =>
          e.kind !== 'edge' &&
          Math.abs(e.presentation.position.x - p.x) < 190 &&
          Math.abs(e.presentation.position.y - p.y) < 150,
      )
    )
      return p;
  }
  return { x: 60, y: 60 + Math.ceil(nodes.length / 3) * 210 };
}
export function planRemoveSelection(
  doc: ProjectDocument,
  selection: string[],
): Result<ResolvedOperation[]> {
  const ids = new Set(selection.filter((id) => !!doc.entities[id]));
  if (!ids.size) return fail('EMPTY_SELECTION', '请先选择要删除的节点或连接。');
  for (const id of ids) {
    let e = doc.entities[id];
    if (e.locked) return fail('LOCKED', '对象已锁定。', [id]);
    while (e.parentId) {
      const parent = doc.entities[e.parentId];
      if (parent.generation && !ids.has(parent.id))
        return fail('MANAGED_TOPOLOGY', '旧组合内部由插件维护；请先解除组合生成关联。', [id]);
      e = parent;
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of Object.values(doc.entities))
      if (
        !ids.has(e.id) &&
        ((e.parentId && ids.has(e.parentId)) ||
          (e.kind === 'edge' &&
            [e.source, e.target].some((p) => p.kind === 'port' && ids.has(p.entityId))))
      ) {
        if (e.locked) return fail('LOCKED', '关联对象已锁定，未删除任何内容。', [e.id]);
        ids.add(e.id);
        changed = true;
      }
  }
  return ok([{ kind: 'remove', ids: [...ids] }]);
}
/** Explicit layout uses structure positions for tensors; ordinary figure layout keeps its contract. */
export function planLayout(doc: ProjectDocument): Result<ResolvedOperation[]> {
  const nodes = Object.values(doc.entities).filter((e) => e.kind !== 'edge' && e.parentId === null);
  if (!nodes.length) return fail('EMPTY_PROJECT', '先添加几个基元。');
  if (nodes.some((e) => e.locked)) return fail('LOCKED', '请先解锁节点再整理布局。');
  const ids = new Set(nodes.map((n) => n.id)),
    targets = new Map(nodes.map((n) => [n.id, new Set<string>()])),
    indegree = new Map(nodes.map((n) => [n.id, 0])),
    ranks = new Map(nodes.map((n) => [n.id, 0]));
  const root = (id: string) => {
    let e = doc.entities[id];
    while (e?.parentId) e = doc.entities[e.parentId];
    return e?.id;
  };
  for (const edge of Object.values(doc.entities)) {
    if (edge.kind !== 'edge' || edge.source.kind !== 'port' || edge.target.kind !== 'port')
      continue;
    const a = root(edge.source.entityId),
      b = root(edge.target.entityId);
    if (a && b && a !== b && ids.has(a) && ids.has(b) && !targets.get(a)!.has(b)) {
      targets.get(a)!.add(b);
      indegree.set(b, indegree.get(b)! + 1);
    }
  }
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id),
    seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    seen.add(id);
    for (const next of targets.get(id)!) {
      ranks.set(next, Math.max(ranks.get(next)!, ranks.get(id)! + 1));
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  let cycleRank = Math.max(...ranks.values()) + 1;
  for (const n of nodes) if (!seen.has(n.id)) ranks.set(n.id, cycleRank++);
  // Only tensor slots are reordered; legacy ordinary nodes retain their original order.
  const tensors = nodes
    .filter((node): node is NodeEntity => node.kind === 'node' && !!node.semantic)
    .sort((a, b) => {
      const pa = a.presentation.compositionPosition ?? a.presentation.position,
        pb = b.presentation.compositionPosition ?? b.presentation.position;
      return pa.y - pb.y || pa.x - pb.x;
    });
  let tensorIndex = 0;
  const ordered = nodes.map((node) =>
    node.kind === 'node' && node.semantic ? tensors[tensorIndex++] : node,
  );
  const rows = new Map<number, number>();
  return ok(
    ordered.map((node) => {
      const rank = ranks.get(node.id)!,
        row = rows.get(rank) ?? 0;
      rows.set(rank, row + 1);
      return {
        kind:
          node.kind === 'node' && node.semantic ? ('compositionMove' as const) : ('move' as const),
        id: node.id,
        position: { x: 60 + rank * 260, y: 60 + row * 220 },
      };
    }),
  );
}
