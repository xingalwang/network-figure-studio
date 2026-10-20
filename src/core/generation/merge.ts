import type { GraphFragment } from './types.ts';
import { validateParams } from './parameters.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import {
  fail,
  ok,
  type Entity,
  type Endpoint,
  type ProjectDocument,
  type GenerationServices,
  type ResolvedOperation,
  type Result,
  type Params,
} from '../document/types.ts';
import { validateDocument } from '../document/validate.ts';
export function getGenerationParams(
  doc: ProjectDocument,
  id: string,
  registry: PluginRegistry,
): Result<Params> {
  const binding = doc.entities[id]?.generation;
  if (!binding) return fail('NOT_PARAMETRIC', '对象没有生成关联。');
  const g = registry.generators.get(binding.generatorId);
  if (!g || g.version !== binding.version || g.paramSchemaVersion !== binding.paramSchemaVersion)
    return fail('GENERATOR_UNAVAILABLE', '参数生成暂停：需要原版本插件；图形仍可编辑和导出。');
  if (binding.source.kind === 'local')
    return ok(structuredClone({ ...g.defaults, ...binding.source.params }));
  const source = binding.source,
    owner = doc.entities[source.ownerId]?.generation;
  if (owner?.source.kind !== 'local') return fail('INVALID_SLOT', '子层参数来源已失效。');
  const parentParams = owner.source.params;
  const inherited = Object.fromEntries(
    source.inherit.filter((k) => k in parentParams).map((k) => [k, parentParams[k]]),
  );
  const slots = owner.source.params.__slots as Record<string, Params> | undefined;
  return ok({ ...g.defaults, ...inherited, ...slots?.[source.slotKey] });
}
function mapEntity(entity: Entity, ids: Record<string, string>): Entity {
  const e = structuredClone(entity),
    ref = (id: string) => {
      if (!Object.hasOwn(ids, id)) throw new Error(`生成结果引用未知对象：${id}`);
      return ids[id];
    };
  e.id = ref(e.id);
  e.parentId = e.parentId === null ? null : ref(e.parentId);
  const end = (x: Endpoint): Endpoint =>
    x.kind === 'port'
      ? { ...x, entityId: ref(x.entityId) }
      : { ...x, spaceId: x.spaceId === null ? null : ref(x.spaceId) };
  if (e.kind === 'edge') {
    e.source = end(e.source);
    e.target = end(e.target);
    e.route.spaceId = e.parentId;
  } else
    for (const [key, p] of Object.entries(e.ports))
      if ('entityId' in p) e.ports[key] = { ...p, entityId: ref(p.entityId) };
  if (e.generation) {
    e.generation.localKeys = Object.fromEntries(
      Object.entries(e.generation.localKeys).map(([k, v]) => [k, ref(v)]),
    );
    if (e.generation.source.kind === 'slot')
      e.generation.source.ownerId = ref(e.generation.source.ownerId);
  }
  return e;
}
export function mergeGenerated(
  doc: ProjectDocument,
  id: string,
  fragment: GraphFragment,
  options: { confirmRemoval?: boolean } = {},
): Result<ResolvedOperation[]> {
  try {
    if (!fragment.entities[fragment.rootKey] || fragment.entities[fragment.rootKey].kind === 'edge')
      return fail('INVALID_FRAGMENT', '生成结果必须包含根组件。');
    const existing = doc.entities[id],
      oldKeys = existing?.generation?.localKeys ?? {},
      ids: Record<string, string> = {};
    for (const key of Object.keys(fragment.entities))
      ids[key] = key === fragment.rootKey ? id : (oldKeys[key] ?? `${id}/${crypto.randomUUID()}`);
    const oldIds = new Set(Object.values(oldKeys)),
      newIds = new Set(Object.values(ids));
    const removed = [...oldIds].filter((x) => !newIds.has(x));
    const generated = Object.fromEntries(
      Object.entries(fragment.entities).map(([key, raw]) => {
        if (raw.id !== key) throw new Error('生成结果稳定键不匹配。');
        const e = mapEntity(raw, ids),
          old = doc.entities[e.id];
        if (old?.kind === e.kind) {
          if (old.figureState !== undefined) e.figureState = old.figureState;
          if (e.kind === 'node' && old.kind === 'node' && old.semantic)
            e.semantic = structuredClone(old.semantic);
          if (e.kind !== 'edge' && old.kind !== 'edge') {
            e.presentation = {
              ...e.presentation,
              ...old.presentation,
              position:
                old.presentation.moved || e.id === id
                  ? old.presentation.position
                  : e.presentation.position,
            };
          } else if (e.kind === 'edge' && old.kind === 'edge') {
            if (old.route.mode === 'manual') e.route = structuredClone(old.route);
            e.style = { ...e.style, ...structuredClone(old.styleOverrides) };
            if (old.styleOverrides) e.styleOverrides = structuredClone(old.styleOverrides);
            if (old.label !== undefined) e.label = old.label;
          }
        }
        if (e.id === id) {
          e.parentId = existing?.parentId ?? null;
          if (e.generation) e.generation.localKeys = ids;
        }
        return [e.id, e];
      }),
    );
    for (const e of Object.values(doc.entities)) {
      if (e.kind !== 'edge' || oldIds.has(e.id)) continue;
      for (const endpoint of [e.source, e.target])
        if (endpoint.kind === 'port' && oldIds.has(endpoint.entityId)) {
          const next = generated[endpoint.entityId];
          if (!next || next.kind === 'edge' || !Object.hasOwn(next.ports, endpoint.portId))
            return fail('CONNECTED_PORT_REMOVAL', '被移除的端口仍有外部连线，请先调整连线。', [
              e.id,
              endpoint.entityId,
            ]);
        }
    }
    const overridden = removed.filter((x) => {
      const e = doc.entities[x];
      return (
        e &&
        (e.kind === 'edge'
          ? e.route.mode === 'manual' ||
            e.label !== undefined ||
            Object.keys(e.styleOverrides ?? {}).length > 0
          : e.presentation.moved ||
            e.presentation.labelOverride !== undefined ||
            e.presentation.fillOverride !== undefined ||
            e.presentation.strokeOverride !== undefined ||
            e.presentation.textOverride !== undefined ||
            e.presentation.opacityOverride !== undefined ||
            e.presentation.strokeWidthOverride !== undefined)
      );
    });
    if (overridden.length && !options.confirmRemoval)
      return fail('MANUAL_CONTENT_REMOVAL', '此次生成会移除手工编辑过的内容，请确认。', overridden);
    const ops: ResolvedOperation[] = [
      ...(removed.length ? [{ kind: 'remove' as const, ids: removed }] : []),
      ...Object.values(generated).map((entity) => ({ kind: 'put' as const, entity })),
    ];
    const next = { ...doc, entities: { ...doc.entities, ...generated } };
    removed.forEach((key) => delete next.entities[key]);
    const valid = validateDocument(next);
    return valid.ok ? ok(ops) : valid;
  } catch (error) {
    return fail('INVALID_FRAGMENT', error instanceof Error ? error.message : '生成结果无效。');
  }
}
export function createGenerationServices(registry: PluginRegistry): GenerationServices {
  return {
    async prepare(doc, op) {
      const existing = doc.entities[op.id],
        binding = existing?.generation;
      if (existing && !binding) return fail('NOT_PARAMETRIC', '已解除生成关联，不能覆盖原对象。');
      const g = registry.generators.get(op.generatorId);
      if (
        !g ||
        (binding &&
          (binding.generatorId !== g.id ||
            binding.version !== g.version ||
            binding.paramSchemaVersion !== g.paramSchemaVersion))
      )
        return fail('GENERATOR_UNAVAILABLE', '生成器缺失或版本不匹配。');
      const valid = validateParams(g.fields, { ...g.defaults, ...op.params });
      if (!valid.ok) return valid;
      if (binding?.source.kind === 'slot') {
        const source = binding.source,
          owner = doc.entities[source.ownerId],
          p = getGenerationParams(doc, source.ownerId, registry);
        if (!p.ok) return p;
        const slots = p.value.__slots as Record<string, Params> | undefined;
        const current = getGenerationParams(doc, op.id, registry);
        if (!current.ok) return current;
        const changes = Object.fromEntries(
          Object.entries(valid.value).filter(
            ([key, value]) => JSON.stringify(value) !== JSON.stringify(current.value[key]),
          ),
        );
        return this.prepare(doc, {
          ...op,
          id: owner.id,
          generatorId: owner.generation!.generatorId,
          params: {
            ...p.value,
            __slots: { ...slots, [source.slotKey]: { ...slots?.[source.slotKey], ...changes } },
          },
        });
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const fragment = await Promise.race([
          Promise.resolve(g.generate(valid.value, doc.theme, binding?.localKeys)),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('生成超时，旧结果已失效。')), 5000);
          }),
        ]);
        const root = fragment.entities[fragment.rootKey];
        if (!root || root.kind === 'edge') return fail('INVALID_FRAGMENT', '生成结果没有根组件。');
        root.generation = {
          generatorId: g.id,
          version: g.version,
          paramSchemaVersion: g.paramSchemaVersion,
          source: { kind: 'local', params: valid.value },
          localKeys: Object.fromEntries(Object.keys(fragment.entities).map((k) => [k, k])),
        };
        if (op.position) root.presentation.position = op.position;
        const merged = mergeGenerated(doc, op.id, fragment, { confirmRemoval: op.confirmRemoval });
        if (!merged.ok) return merged;
        return ok([
          ...merged.value,
          { kind: 'dependencies', dependencies: { ...doc.dependencies, [g.id]: g.version } },
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
export function detachGeneration(
  doc: ProjectDocument,
  id: string,
  registry: PluginRegistry,
): Result<ResolvedOperation[]> {
  const root = doc.entities[id];
  if (!root?.generation) return fail('NOT_PARAMETRIC', '对象已无生成关联。');
  const ops: ResolvedOperation[] = [];
  for (const e of Object.values(doc.entities)) {
    const source = e.generation?.source;
    if (source?.kind === 'slot' && source.ownerId === id) {
      const params = getGenerationParams(doc, e.id, registry);
      if (!params.ok) return params;
      ops.push({
        kind: 'put',
        entity: {
          ...e,
          generation: {
            ...e.generation!,
            source: { kind: 'local', params: params.value },
            localKeys: { root: e.id },
          },
        },
      });
    }
  }
  const detached = structuredClone(root);
  delete detached.generation;
  ops.push({ kind: 'put', entity: detached });
  return ok(ops);
}
