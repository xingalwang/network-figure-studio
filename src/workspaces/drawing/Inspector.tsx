import { useEffect, useState } from 'react';
import type {
  DocumentStore,
  Entity,
  Operation,
  Params,
  ProjectDocument,
} from '../../core/document/types.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import { getGenerationParams, detachGeneration } from '../../core/generation/merge.ts';
import { ParameterForm } from '../generator/ParameterForm.tsx';
import { ConnectionEditor } from '../generator/ConnectionEditor.tsx';
import { AppearanceEditor } from '../shared/AppearanceEditor.tsx';
import { ColorField, NumberField } from '../shared/StyleFields.tsx';
import { resolveEndpoint, worldOrigin } from '../../adapters/maxgraph/ports.ts';
import type { ParameterDraftCache } from '../shared/parameter-drafts.ts';
import { useParameterDraft } from '../shared/useParameterDraft.ts';
const styleFields = new Set(['fillColor', 'borderColor', 'textColor', 'strokeWidth', 'opacity']);
export function Inspector({
  store,
  doc,
  entity,
  registry,
  onEdit,
  onError,
  onUpdateParameters,
  onSetLabel,
  drafts,
  onDraftChange,
}: {
  store: DocumentStore;
  doc: ProjectDocument;
  entity: Entity | undefined;
  registry: PluginRegistry;
  onEdit: (id: string) => void;
  onError: (message: string) => void;
  onUpdateParameters: (id: string, params: Params) => Promise<boolean>;
  onSetLabel: (id: string, text: string | null) => Promise<boolean>;
  drafts?: ParameterDraftCache;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const [label, setLabel] = useState(''),
    [panel, setPanel] = useState<'parameters' | 'appearance'>('parameters');
  const effective = entity ? getGenerationParams(doc, entity.id, registry) : null,
    id = entity?.id;
  const {
    params,
    conflict,
    change: editParams,
    reset,
    apply: applyDraft,
  } = useParameterDraft({
    id: entity?.generation ? id : undefined,
    official: effective?.ok ? effective.value : null,
    drafts,
    onDraftChange,
  });
  useEffect(() => {
    if (!entity) return;
    setLabel(
      entity.kind === 'edge' ? (entity.label ?? '') : (entity.presentation.labelOverride ?? ''),
    );
  }, [id, entity?.kind === 'edge' ? entity.label : entity?.presentation.labelOverride]);
  useEffect(() => setPanel('parameters'), [id]);
  async function commit(operations: Operation[]) {
    const r = await store.dispatch({ baseRevision: store.getSnapshot().revision, operations });
    if (!r.ok) onError(r.error.message);
    return r.ok;
  }
  if (!entity)
    return (
      <div className="inspector-empty">
        <div className="eyebrow">NETWORK COMPOSITION</div>
        <h2>从基元开始搭建</h2>
        <p>添加网络层，拖动端口接线。Shift 按顺序多选后，可串联、分支或合并。</p>
        <p className="hint">结构与图稿共用一份工程；切到绘图工作区调整论文表现。</p>
      </div>
    );
  const g = entity.generation && registry.generators.get(entity.generation.generatorId),
    readOnly = store.isReadonly();
  const apply = async () => {
    if (!g) return;
    await applyDraft(
      (params) => onUpdateParameters(entity.id, params),
      '原参数已经变化，确定用当前草稿覆盖？',
    );
  };
  const paramFields =
    g?.fields.filter(
      (f) =>
        !styleFields.has(f.key) &&
        (panel === 'parameters'
          ? (f.section ?? 'structure') === 'structure'
          : f.section === 'appearance'),
    ) ?? [];
  return (
    <>
      <div className="inspector-heading">
        <span className="eyebrow">
          {entity.kind === 'edge'
            ? 'CONNECTION'
            : entity.generation
              ? 'NETWORK PRIMITIVE'
              : 'DRAWING ELEMENT'}
        </span>
        <h2>{entity.name}</h2>
      </div>
      {entity.kind !== 'edge' && (
        <div className="library-tabs">
          <button
            className={panel === 'parameters' ? 'active' : ''}
            onClick={() => setPanel('parameters')}
          >
            参数
          </button>
          <button
            className={panel === 'appearance' ? 'active' : ''}
            onClick={() => setPanel('appearance')}
          >
            外观
          </button>
        </div>
      )}
      {conflict && (
        <div className="warning">
          原参数已改变，草稿尚未覆盖它。
          <button className="text-button" onClick={reset}>
            重新载入参数
          </button>
        </div>
      )}
      {panel === 'appearance' && entity.kind !== 'edge' && (
        <AppearanceEditor
          entity={entity}
          doc={doc}
          disabled={readOnly}
          commit={(ops) => void commit(ops)}
        />
      )}
      {entity.generation && g && entity.kind !== 'edge' && (
        <>
          <ParameterForm
            fields={paramFields}
            params={params}
            onChange={editParams}
            disabled={readOnly}
          />
          {paramFields.length > 0 && (
            <button className="secondary full" disabled={readOnly} onClick={() => void apply()}>
              应用参数
            </button>
          )}
          {panel === 'parameters' && entity.generation.source.kind === 'local' && (
            <button
              className="text-button full"
              disabled={readOnly}
              onClick={() => onEdit(entity.id)}
            >
              编辑生成参数
            </button>
          )}
        </>
      )}
      {entity.generation && !g && (
        <p className="warning">参数生成暂停：缺少原版本插件。图形仍可编辑和导出。</p>
      )}
      {(panel === 'parameters' || entity.kind === 'edge') && (
        <section className="form-section">
          <h3>标注</h3>
          <label className="stacked">
            <span>手工标签</span>
            <input
              aria-label="手工标签"
              value={label}
              disabled={readOnly}
              placeholder={entity.name}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
              }}
              onBlur={() => {
                const old =
                  entity.kind === 'edge'
                    ? (entity.label ?? '')
                    : (entity.presentation.labelOverride ?? '');
                if (label !== old) void onSetLabel(entity.id, label || null);
              }}
            />
          </label>
          <span className="hint">清空后恢复自动标签</span>
        </section>
      )}
      {entity.kind !== 'edge' && panel === 'parameters' && (
        <>
          <section className="form-section">
            <h3>位置</h3>
            <div className="coordinate-grid">
              {(['x', 'y'] as const).map((axis) => (
                <label key={axis}>
                  <span>{axis.toUpperCase()}</span>
                  <input
                    aria-label={`位置 ${axis.toUpperCase()}`}
                    key={`${entity.id}-${entity.presentation.position[axis]}`}
                    type="number"
                    defaultValue={Math.round(entity.presentation.position[axis])}
                    disabled={readOnly}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (
                        e.target.value.trim() &&
                        Number.isFinite(value) &&
                        value !== entity.presentation.position[axis]
                      )
                        void commit([
                          {
                            kind: 'move',
                            id: entity.id,
                            position: { ...entity.presentation.position, [axis]: value },
                          },
                        ]);
                    }}
                  />
                </label>
              ))}
            </div>
          </section>
          <ConnectionEditor doc={doc} source={entity} store={store} onError={onError} />
        </>
      )}
      {entity.kind === 'edge' && (
        <section className="form-section">
          <h3>连接样式</h3>
          <ColorField
            label="连线颜色"
            value={entity.style.color}
            disabled={readOnly}
            onChange={(color) =>
              void commit([{ kind: 'edgeStyle', id: entity.id, style: { color } }])
            }
          />
          <NumberField
            label="线宽"
            value={entity.style.width}
            min={0}
            max={20}
            step={0.1}
            disabled={readOnly}
            onChange={(width) =>
              void commit([{ kind: 'edgeStyle', id: entity.id, style: { width } }])
            }
          />
          <NumberField
            label="连线不透明度"
            value={entity.style.opacity ?? 1}
            min={0}
            max={1}
            step={0.05}
            disabled={readOnly}
            onChange={(opacity) =>
              void commit([{ kind: 'edgeStyle', id: entity.id, style: { opacity } }])
            }
          />
          <label className="field">
            <span>线型</span>
            <select
              aria-label="线型"
              disabled={readOnly}
              value={entity.route.kind}
              onChange={(e) =>
                void commit([
                  {
                    kind: 'route',
                    id: entity.id,
                    route: { ...entity.route, kind: e.target.value as 'orthogonal' },
                  },
                ])
              }
            >
              <option value="orthogonal">正交</option>
              <option value="straight">直线</option>
              <option value="curve">曲线</option>
            </select>
          </label>
          <label className="field">
            <span>虚线</span>
            <input
              aria-label="虚线"
              type="checkbox"
              checked={entity.style.dashed}
              disabled={readOnly}
              onChange={(e) =>
                void commit([
                  { kind: 'edgeStyle', id: entity.id, style: { dashed: e.target.checked } },
                ])
              }
            />
          </label>
          <label className="field">
            <span>箭头</span>
            <input
              aria-label="箭头"
              type="checkbox"
              checked={entity.style.arrow}
              disabled={readOnly}
              onChange={(e) =>
                void commit([
                  { kind: 'edgeStyle', id: entity.id, style: { arrow: e.target.checked } },
                ])
              }
            />
          </label>
          <button
            className="secondary full"
            disabled={readOnly}
            onClick={() => {
              const a = resolveEndpoint(doc, entity.source),
                b = resolveEndpoint(doc, entity.target),
                origin = worldOrigin(doc, entity.route.spaceId);
              if (a.ok && b.ok)
                void commit([
                  {
                    kind: 'route',
                    id: entity.id,
                    route: {
                      ...entity.route,
                      mode: 'manual',
                      points: [
                        ...entity.route.points,
                        {
                          x: (a.value.x + b.value.x) / 2 - origin.x,
                          y: (a.value.y + b.value.y) / 2 - 60 - origin.y,
                        },
                      ],
                    },
                  },
                ]);
            }}
          >
            添加折点
          </button>
          <p className="hint">在绘图工作区拖动把手，调整路径与端点。</p>
        </section>
      )}
      {entity.kind === 'group' && entity.generation && (
        <section className="form-section">
          <button
            className="text-button full"
            disabled={readOnly}
            onClick={() => {
              if (!confirm('解除旧组合的生成关联？子层仍可改参数，内部连接将改为自由编辑。'))
                return;
              const result = detachGeneration(doc, entity.id, registry);
              if (result.ok) void commit(result.value);
              else onError(result.error.message);
            }}
          >
            解除组合生成关联
          </button>
        </section>
      )}
    </>
  );
}
