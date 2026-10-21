import { applyOperations } from '../../core/commands/apply.ts';
import {
  fail,
  ok,
  type DocumentStore,
  type Params,
  type ProjectDocument,
  type ResolvedOperation,
  type Result,
} from '../../core/document/types.ts';
import { createGenerationServices, getGenerationParams } from '../../core/generation/merge.ts';
import { preserveTensorFigureSnapshots } from '../../graphics/tensor-grid.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import { consumeParameterDraft, type ParameterDraftCache } from './parameter-drafts.ts';

type Section = 'structure' | 'appearance';
type DraftChange = { id: string; keys: string[]; params: Params };
type SectionPlan = { changes: DraftChange[]; roots: Map<string, Params> };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Fields own their section. Figure drafts never participate in generator builds. */
function sectionPlan(
  doc: ProjectDocument,
  registry: PluginRegistry,
  drafts: ParameterDraftCache,
  section: Section,
  overwrite = false,
  ids?: readonly string[],
): Result<SectionPlan> {
  const changes: DraftChange[] = [],
    roots = new Map<string, Params>();
  const conflicts: string[] = [];
  for (const [id, draft] of drafts) {
    if (draft.scope === 'figure' || (ids && !ids.includes(id))) continue;
    const entity = doc.entities[id];
    if (entity?.figure || (entity?.kind === 'node' && entity.annotation)) continue;
    if (!entity) return fail('TARGET_MISSING', '草稿对应的对象已不存在，未构建任何内容。', [id]);
    if (!entity.generation) continue;
    const definition = registry.generators.get(entity.generation.generatorId);
    const official = getGenerationParams(doc, id, registry);
    if (!definition || !official.ok)
      return official.ok ? fail('GENERATOR_UNAVAILABLE', '草稿缺少原版本生成器。', [id]) : official;
    let base: Params | null;
    try {
      base = JSON.parse(draft.base) as Params | null;
    } catch {
      return fail('DRAFT_CONFLICT', '参数草稿基线已失效，未构建任何内容。', [id]);
    }
    const keys = definition.fields
      .filter(
        (field) =>
          (field.section ?? 'structure') === section &&
          !same(draft.params[field.key], base?.[field.key]),
      )
      .map((field) => field.key);
    if (!keys.length) continue;
    if (entity.locked) return fail('LOCKED', '待构建对象已锁定。', [id]);
    if (
      !overwrite &&
      keys.some(
        (key) =>
          !same(official.value[key], base?.[key]) && !same(official.value[key], draft.params[key]),
      )
    )
      conflicts.push(id);
    changes.push({ id, keys, params: structuredClone(draft.params) });
  }
  if (conflicts.length)
    return fail(
      'DRAFT_CONFLICT',
      '部分原参数已改变。确认用当前结构草稿覆盖？其他未修改参数保留。',
      conflicts,
    );
  // Local owners are collected first so sibling slots merge into one generation, never overwrite each other.
  for (const change of changes) {
    const binding = doc.entities[change.id].generation!;
    if (binding.source.kind !== 'local') continue;
    const official = getGenerationParams(doc, change.id, registry);
    if (!official.ok) return official;
    roots.set(change.id, {
      ...official.value,
      ...Object.fromEntries(change.keys.map((key) => [key, change.params[key]])),
    });
  }
  for (const change of changes) {
    const source = doc.entities[change.id].generation!.source;
    if (source.kind !== 'slot') continue;
    const owner = doc.entities[source.ownerId];
    if (owner?.locked) return fail('LOCKED', '旧组合的参数拥有者已锁定。', [owner.id]);
    const official = getGenerationParams(doc, source.ownerId, registry);
    if (!official.ok) return official;
    const params = roots.get(source.ownerId) ?? official.value,
      slots = params.__slots as Record<string, Params> | undefined;
    roots.set(source.ownerId, {
      ...params,
      __slots: {
        ...slots,
        [source.slotKey]: {
          ...slots?.[source.slotKey],
          ...Object.fromEntries(change.keys.map((key) => [key, change.params[key]])),
        },
      },
    });
  }
  return ok({ changes, roots });
}

export function structureDraftCount(
  doc: ProjectDocument,
  registry: PluginRegistry,
  drafts: ParameterDraftCache,
): number {
  const plan = sectionPlan(doc, registry, drafts, 'structure', true);
  return plan.ok ? plan.value.changes.length : drafts.size;
}

/** Projection only: raw draft values allow analysis to show incomplete or invalid parameters honestly. */
export function projectStructureDrafts(
  doc: ProjectDocument,
  registry: PluginRegistry,
  drafts: ParameterDraftCache,
): ProjectDocument {
  const plan = sectionPlan(doc, registry, drafts, 'structure', true);
  if (!plan.ok || !plan.value.roots.size) return doc;
  const entities = { ...doc.entities };
  for (const [id, params] of plan.value.roots) {
    const entity = entities[id];
    if (!entity.generation || entity.generation.source.kind !== 'local') continue;
    entities[id] = {
      ...entity,
      generation: { ...entity.generation, source: { kind: 'local', params } },
    };
  }
  return { ...doc, entities };
}

type BuildOptions = {
  store: DocumentStore;
  registry: PluginRegistry;
  drafts: ParameterDraftCache;
  onError(message: string): void;
  onChanged(): void;
  onBuildingChange?(building: boolean): void;
  onBuilt?(count: number): void;
  confirmOverwrite?(message: string): boolean | Promise<boolean>;
  confirmRemoval?(message: string): boolean | Promise<boolean>;
};

/** Preparation happens on detached documents; only the final resolved proposal reaches the store. */
export function createBuildActions(options: BuildOptions) {
  const { store, registry, drafts, onError, onChanged } = options;
  let busy = false;
  const run = async (section: Section, ids?: readonly string[]): Promise<boolean> => {
    if (busy) return false;
    if (store.isReadonly()) {
      onError('当前工程为只读，未构建任何内容。');
      return false;
    }
    busy = true;
    options.onBuildingChange?.(true);
    try {
      const snapshot = store.getSnapshot(),
        submitted = new Map(drafts);
      let plan = sectionPlan(snapshot, registry, submitted, section, false, ids);
      if (!plan.ok && plan.error.code === 'DRAFT_CONFLICT' && options.confirmOverwrite) {
        if (!(await options.confirmOverwrite(plan.error.message))) return false;
        plan = sectionPlan(snapshot, registry, submitted, section, true, ids);
      }
      if (!plan.ok) {
        onError(plan.error.message);
        return false;
      }
      if (!plan.value.changes.length) return true;
      const services = createGenerationServices(registry);
      const prepare = async (confirmRemoval: boolean): Promise<Result<ResolvedOperation[]>> => {
        let next = snapshot;
        const operations: ResolvedOperation[] = [];
        for (const [id, params] of plan.value.roots) {
          const generated = await services.prepare(next, {
            kind: 'generate',
            id,
            generatorId: next.entities[id].generation!.generatorId,
            params,
            confirmRemoval,
          });
          if (!generated.ok) return generated;
          const resolved = preserveTensorFigureSnapshots(next, generated.value);
          const applied = applyOperations(next, resolved);
          if (!applied.ok) return applied;
          next = applied.value;
          operations.push(...resolved);
        }
        return ok(operations);
      };
      let prepared = await prepare(false);
      if (
        !prepared.ok &&
        prepared.error.code === 'MANUAL_CONTENT_REMOVAL' &&
        options.confirmRemoval
      ) {
        if (!(await options.confirmRemoval(prepared.error.message))) return false;
        prepared = await prepare(true);
      }
      if (!prepared.ok) {
        onError(prepared.error.message);
        return false;
      }
      const committed = await store.dispatch({
        baseRevision: snapshot.revision,
        operations: prepared.value,
      });
      if (!committed.ok) {
        onError(committed.error.message);
        return false;
      }
      for (const change of plan.value.changes) {
        const official = getGenerationParams(committed.document, change.id, registry);
        if (official.ok) consumeParameterDraft(drafts, change.id, official.value, change);
      }
      onChanged();
      if (section === 'structure') options.onBuilt?.(plan.value.changes.length);
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : '构建失败，原工程和草稿保留。');
      return false;
    } finally {
      busy = false;
      options.onBuildingChange?.(false);
    }
  };
  return {
    buildStructure: () => run('structure'),
    applyAppearance: (id: string) => run('appearance', [id]),
  };
}
