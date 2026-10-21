import { useEffect, useRef, useState } from 'react';
import type {
  DocumentStore,
  NodeEntity,
  Params,
  ProjectDocument,
  Operation,
} from '../../core/document/types.ts';
import type { AnalysisReport } from '../../core/computation/types.ts';
import { producerOf } from '../../core/computation/topology.ts';
import { resolveComputation, resolveOperation } from '../../core/computation/registry.ts';
import { getGenerationParams } from '../../core/generation/merge.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import type { ParameterDraftCache } from '../../app/editor/parameter-drafts.ts';
import type { EditRequest, TensorOperationDraft } from '../../app/editor/model.ts';
import type { OperationEditorState } from '../../app/editor/operation-draft.ts';
import { useParameterDraft } from '../../app/editor/useParameterDraft.ts';
import { AppearanceEditor } from '../shared/AppearanceEditor.tsx';
import { TensorFields } from './TensorFields.tsx';
import { CalculationPanel, shapeText } from './CalculationPanel.tsx';
import { automaticTensorDisplay, tensorGridGeometry } from '../../graphics/tensor-grid.ts';

const paramsOf = (doc: ProjectDocument, id: string, registry: PluginRegistry) => {
  const p = getGenerationParams(doc, id, registry);
  return p.ok ? p.value : {};
};

export function TensorInspector({
  doc,
  store,
  entity,
  registry,
  report,
  editRequest,
  onEdit,
  onError,
  onApplyAppearance,
  onSetLabel,
  drafts,
  onDraftChange,
  showStructureInfo = false,
}: {
  doc: ProjectDocument;
  store: DocumentStore;
  entity: NodeEntity;
  registry: PluginRegistry;
  report: AnalysisReport;
  editRequest: EditRequest | null;
  onEdit: (id: string) => void;
  onError: (message: string) => void;
  onApplyAppearance: (id: string) => Promise<boolean>;
  onSetLabel: (id: string, text: string | null) => Promise<boolean>;
  drafts: ParameterDraftCache;
  onDraftChange: (dirty: boolean) => void;
  showStructureInfo?: boolean;
}) {
  const official = paramsOf(doc, entity.id, registry);
  const { params, dirty, conflict, change, reset } = useParameterDraft({
    id: entity.id,
    official,
    drafts,
    onDraftChange,
  });
  const [panel, setPanel] = useState<'parameters' | 'calculation' | 'appearance'>(
    editRequest?.id === entity.id ? 'parameters' : 'calculation',
  );
  const [label, setLabel] = useState(entity.presentation.labelOverride ?? '');
  const fields = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editRequest?.id !== entity.id) return;
    setPanel('parameters');
    const frame = requestAnimationFrame(() =>
      fields.current?.querySelector<HTMLElement>('input,select,textarea')?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [editRequest?.serial, entity.id]);
  useEffect(
    () => setLabel(entity.presentation.labelOverride ?? ''),
    [entity.presentation.labelOverride],
  );
  const candidate = entity.generation && registry.generators.get(entity.generation.generatorId);
  const generator =
    candidate &&
    candidate.version === entity.generation?.version &&
    candidate.paramSchemaVersion === entity.generation?.paramSchemaVersion
      ? candidate
      : undefined;
  const producer = producerOf(doc, entity.id),
    isResult = entity.semantic?.role === 'tensor-result';
  const commit = async (operations: Operation[]) => {
    const result = await store.dispatch({ baseRevision: store.getSnapshot().revision, operations });
    if (!result.ok) onError(result.error.message);
    return result.ok;
  };
  const structureDirty = generator?.fields.some(
    (field) =>
      (field.section ?? 'structure') === 'structure' &&
      JSON.stringify(params[field.key]) !== JSON.stringify(official[field.key]),
  );
  const definition = resolveComputation(entity, registry.computations);
  const calculationId = isResult && producer ? producer : entity.id;
  const dataEntry =
    showStructureInfo && entity.semantic?.role !== 'operation'
      ? report.nodes[entity.id]
      : undefined;
  // Appearance drafts have their own Apply action; describe the projection currently on the canvas.
  const displayGrid =
    dataEntry?.state === 'ready' && automaticTensorDisplay(official)
      ? tensorGridGeometry(dataEntry.shape, official)
      : undefined;
  const displayDescription =
    !definition || dataEntry?.state === 'unsupported'
      ? '保存的图形快照'
      : dataEntry?.state !== 'ready'
        ? '示意占位'
        : displayGrid?.ok
          ? `${displayGrid.value.compressed ? '压缩示意' : '按尺寸比例显示'}${displayGrid.value.simplified ? ' · 网格已简化' : ''}`
          : '手动示意比例';
  return (
    <>
      {showStructureInfo && entity.semantic?.role !== 'operation' && (
        <section className="tensor-object-info" aria-label="数据块信息">
          <dl>
            <dt>规格</dt>
            <dd>
              {dataEntry?.shape
                ? Object.entries(dataEntry.shape)
                    .map(([axis, size]) => `${axis} ${size ?? '?'}`)
                    .join(' · ')
                : '尚未得到可用规格'}
            </dd>
            <dt>状态</dt>
            <dd>
              {dataEntry?.state === 'ready'
                ? '规格已推导'
                : dataEntry?.state === 'error'
                  ? '尺寸冲突'
                  : dataEntry?.state === 'unsupported'
                    ? '推导规则未知'
                    : '待配置'}
            </dd>
            <dt>显示</dt>
            <dd>{displayDescription}</dd>
          </dl>
        </section>
      )}
      <div className="tensor-inspector-tabs">
        {(
          [
            ['parameters', '参数'],
            ['calculation', '计算'],
            ['appearance', '外观'],
          ] as const
        ).map(([key, name]) => (
          <button key={key} className={panel === key ? 'active' : ''} onClick={() => setPanel(key)}>
            {name}
            {key === 'parameters' && dirty && <i />}
          </button>
        ))}
      </div>
      {conflict && (
        <div className="warning">
          原参数已改变，当前草稿未覆盖。
          <button className="text-button" onClick={reset}>
            载入最新参数
          </button>
        </div>
      )}
      {panel === 'parameters' &&
        (isResult ? (
          <section className="tensor-result-summary">
            <h3>推导规格</h3>
            <strong>{shapeText(report.nodes[entity.id]?.shape)}</strong>
            <p>结果尺寸不能独立手填。要改变它，请修改产生操作。</p>
            {producer && (
              <button className="secondary full" onClick={() => onEdit(producer)}>
                编辑产生操作
              </button>
            )}
          </section>
        ) : (
          <>
            {generator ? (
              <div ref={fields}>
                <TensorFields
                  fields={generator.fields.filter(
                    (f) => (f.section ?? 'structure') === 'structure',
                  )}
                  params={params}
                  onChange={change}
                  disabled={store.isReadonly()}
                  presentation={definition?.presentation}
                  dimension={definition?.dimension(params)}
                />
              </div>
            ) : (
              <p className="warning">缺少原版本生成器，参数暂不可改。</p>
            )}
            <div className="tensor-apply-actions">
              <p className="hint">修改结构参数后，点击顶部“构建”统一应用。</p>
              <button
                className="text-button"
                onClick={() => {
                  reset();
                  setPanel('calculation');
                }}
              >
                取消编辑
              </button>
            </div>
          </>
        ))}
      {panel === 'appearance' && (
        <>
          <AppearanceEditor
            entity={entity}
            doc={doc}
            disabled={store.isReadonly()}
            commit={(ops) => void commit(ops)}
          />
          {generator && (
            <>
              <TensorFields
                fields={generator.fields.filter(
                  (f) =>
                    f.section === 'appearance' &&
                    f.key !== 'fillColor' &&
                    (f.key === 'displayMode' ||
                      (f.key.startsWith('display')
                        ? params.displayMode === 'auto'
                        : params.displayMode !== 'auto')),
                )}
                params={params}
                onChange={(next) =>
                  change(
                    ['drawWidth', 'drawHeight', 'depth', 'angleDeg'].some(
                      (key) => next[key] !== params[key],
                    )
                      ? { ...next, displayMode: 'manual' }
                      : next,
                  )
                }
                disabled={store.isReadonly()}
                presentation={definition?.presentation}
                dimension={definition?.dimension(params)}
              />
              {params.displayMode === 'auto' && (
                <p className="hint">
                  共用 2 px/单位；倍率乘实际尺寸，极端尺寸连续压缩。网格最多 12 格/轴。
                </p>
              )}
              <button
                className="primary full"
                disabled={store.isReadonly()}
                onClick={() => void onApplyAppearance(entity.id)}
              >
                应用外观
              </button>
            </>
          )}
          <label className="stacked tensor-label">
            <span>手工标签</span>
            <input
              aria-label="手工标签"
              value={label}
              placeholder={entity.name}
              disabled={store.isReadonly()}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => {
                if (label !== (entity.presentation.labelOverride ?? ''))
                  void onSetLabel(entity.id, label || null);
              }}
            />
          </label>
        </>
      )}
      {(panel === 'calculation' || (panel === 'parameters' && !isResult)) && (
        <CalculationPanel entry={report.nodes[calculationId]} draft={!!structureDirty} />
      )}
      {panel === 'calculation' && isResult && producer && (
        <button className="text-button full" onClick={() => onEdit(producer)}>
          编辑产生操作
        </button>
      )}
    </>
  );
}

/** Presentation only: editor coordination owns parameters, preview and the complete create action. */
export function TensorOperationPanel({
  draft,
  doc,
  store,
  registry,
  editor,
  onCancel,
  onCreate,
  onChange,
}: {
  draft: TensorOperationDraft;
  doc: ProjectDocument;
  store: DocumentStore;
  registry: PluginRegistry;
  editor: OperationEditorState;
  onCancel: () => void;
  onCreate: () => Promise<void>;
  onChange: (params: Params) => void;
}) {
  const definition = resolveOperation(draft.kind, registry.computations);
  const generator = definition && registry.generators.get(definition.generatorId);
  if (!generator || !definition) return <p className="warning">缺少匹配的计算操作定义。</p>;
  return (
    <>
      <div className="inspector-heading">
        <span className="eyebrow">运算参数</span>
        <h2>{generator.name}</h2>
        <p>配置输入数据的下一步运算。</p>
      </div>
      {draft.sourceIds.length > 1 && (
        <div className="tensor-merge-inputs">
          <h3>输入顺序</h3>
          {draft.sourceIds.map((id, index) => (
            <p key={id}>
              {index + 1}. {doc.entities[id]?.name}
              <strong>{shapeText(editor.inputReport.nodes[id]?.shape)}</strong>
            </p>
          ))}
        </div>
      )}
      <TensorFields
        fields={generator.fields}
        params={editor.params}
        onChange={onChange}
        disabled={store.isReadonly() || editor.busy}
        presentation={definition.presentation}
        dimension={editor.dimension}
      />
      {editor.error && (
        <p className="warning" role="status">
          {editor.error}
        </p>
      )}
      <div className="tensor-create-actions">
        <button
          className="primary full"
          disabled={editor.busy || store.isReadonly()}
          onClick={() => void onCreate()}
        >
          {editor.busy ? '正在创建…' : '创建下一步'}
        </button>
        <button className="text-button full" disabled={editor.busy} onClick={onCancel}>
          取消
        </button>
      </div>
      <CalculationPanel entry={editor.preview} draft />
    </>
  );
}
