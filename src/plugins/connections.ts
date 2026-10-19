import {
  fail,
  type CommitResult,
  type DocumentStore,
  type EdgeEntity,
  type Params,
} from '../core/document/types.ts';
import { validateParams, type PluginRegistry } from './registry.ts';
import type { ConnectionSpec } from './sdk.ts';

/** Plugins describe connections; only the host may assign IDs or create document entities. */
export async function executeConnectionPattern(
  store: DocumentStore,
  registry: PluginRegistry,
  id: string,
  selection: readonly string[],
  params: Params,
): Promise<CommitResult> {
  if (store.isReadonly()) return fail('READONLY', '当前为只读，不能添加连接。');
  const pattern = registry.connectionPatterns.get(id),
    doc = store.getSnapshot();
  if (!pattern) return fail('CONNECTION_UNAVAILABLE', '连接模式不可用。');
  const valid = validateParams(pattern.fields, params);
  if (!valid.ok) return valid;
  const orderedSelection = Object.freeze([...selection]);
  const selected = new Set(orderedSelection);
  if (
    selected.size !== selection.length ||
    selection.some(
      (key) =>
        !Object.hasOwn(doc.entities, key) ||
        doc.entities[key].kind === 'edge' ||
        doc.entities[key].locked,
    )
  )
    return fail('CONNECTION_SCOPE', '请选择不重复且未锁定的网络基元。');
  for (const id of orderedSelection) {
    let entity = doc.entities[id];
    while (entity.parentId) {
      entity = doc.entities[entity.parentId];
      if (entity.generation)
        return fail(
          'MANAGED_TOPOLOGY',
          '旧组合内部由插件维护；请先解除组合生成关联，或连接组合的公开端口。',
          [id],
        );
    }
  }
  try {
    if (!pattern.isAvailable(doc, orderedSelection))
      return fail(
        'CONNECTION_UNAVAILABLE',
        '当前选择不能使用该连接方式，请检查节点数量与输入／输出端口。',
      );
    const specs = await pattern.connect(doc, orderedSelection, valid.value);
    if (!Array.isArray(specs) || !specs.length)
      return fail('INVALID_CONNECTION', '连接模式没有返回可用连接。');
    const used = new Set<string>();
    const keyOf = (source: ConnectionSpec['source'], target: ConnectionSpec['target']) =>
      JSON.stringify([source.entityId, source.portId, target.entityId, target.portId]);
    for (const entity of Object.values(doc.entities)) {
      if (entity.kind === 'edge' && entity.source.kind === 'port' && entity.target.kind === 'port')
        used.add(keyOf(entity.source, entity.target));
    }
    const endpointAllowed = (endpoint: ConnectionSpec['source']) => {
      if (
        !endpoint ||
        typeof endpoint.entityId !== 'string' ||
        typeof endpoint.portId !== 'string' ||
        !selected.has(endpoint.entityId)
      )
        return false;
      const entity = doc.entities[endpoint.entityId];
      return entity && entity.kind !== 'edge' && Object.hasOwn(entity.ports, endpoint.portId);
    };
    const edges: EdgeEntity[] = [];
    for (const spec of specs) {
      if (!spec || !endpointAllowed(spec.source) || !endpointAllowed(spec.target))
        return fail('CONNECTION_SCOPE', '连接模式引用了选择范围外的对象或不存在的端口，未应用。');
      const key = keyOf(spec.source, spec.target);
      if (used.has(key))
        return fail('DUPLICATE_CONNECTION', '这些端口之间已有相同连接，整组连接未应用。');
      used.add(key);
      let edgeId: string;
      do {
        edgeId = crypto.randomUUID();
      } while (Object.hasOwn(doc.entities, edgeId) || edges.some((edge) => edge.id === edgeId));
      edges.push({
        id: edgeId,
        kind: 'edge',
        parentId: null,
        name: spec.label || pattern.name,
        source: { kind: 'port', entityId: spec.source.entityId, portId: spec.source.portId },
        target: { kind: 'port', entityId: spec.target.entityId, portId: spec.target.portId },
        route: {
          kind: spec.route?.kind ?? 'straight',
          mode: spec.route?.points.length ? 'manual' : 'auto',
          points: structuredClone(spec.route?.points ?? []),
          spaceId: null,
        },
        style: {
          color: doc.theme.lineColor,
          width: doc.theme.lineWidth ?? 1.5,
          dashed: false,
          arrow: true,
          ...spec.style,
        },
        ...(spec.label !== undefined ? { label: spec.label } : {}),
      });
    }
    return await store.dispatch({
      baseRevision: doc.revision,
      operations: edges.map((entity) => ({ kind: 'put', entity })),
    });
  } catch (error) {
    return fail(
      'CONNECTION_FAILED',
      error instanceof Error ? error.message : '连接模式执行失败，原项目未改变。',
    );
  }
}
