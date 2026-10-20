import { useEffect, useState } from 'react';
import type {
  DocumentStore,
  NodeEntity,
  Params,
  ProjectDocument,
  Operation,
} from '../../core/document/types.ts';
import {
  analyzeDocument,
  producerOf,
  tensorDimension,
  type AnalysisReport,
} from '../../core/computation/index.ts';
import { getGenerationParams, createGenerationServices } from '../../core/generation/merge.ts';
import { createDocumentStore } from '../../core/commands/store.ts';
import { appendTensorOperation } from '../../core/tensor-composition.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import type { ParameterDraftCache } from '../shared/parameter-drafts.ts';
import type { EditRequest, TensorOperationDraft } from '../shared/editor-model.ts';
import { useParameterDraft } from '../shared/useParameterDraft.ts';
import { AppearanceEditor } from '../shared/AppearanceEditor.tsx';
import { TensorFields } from './TensorFields.tsx';
import { CalculationPanel, shapeText } from './CalculationPanel.tsx';

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
  drafts,
  onDraftChange,
}: {
  doc: ProjectDocument;
  store: DocumentStore;
  entity: NodeEntity;
  registry: PluginRegistry;
  report: AnalysisReport;
  editRequest: EditRequest | null;
  onEdit: (id: string) => void;
  onError: (message: string) => void;
  drafts: ParameterDraftCache;
  onDraftChange: (dirty: boolean) => void;
}) {
  const official = paramsOf(doc, entity.id, registry);
  const {
    params,
    dirty,
    conflict,
    change,
    reset,
    apply: applyDraft,
  } = useParameterDraft({
    id: entity.id,
    official,
    drafts,
    onDraftChange,
  });
  const [panel, setPanel] = useState<'parameters' | 'calculation' | 'appearance'>(
    editRequest?.id === entity.id ? 'parameters' : 'calculation',
  );
  const [label, setLabel] = useState(entity.presentation.labelOverride ?? '');
  useEffect(() => {
    if (editRequest?.id === entity.id) setPanel('parameters');
  }, [editRequest?.serial]);
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
  const apply = async () => {
    if (!generator) return;
    await applyDraft(
      (params) => commit([{ kind: 'generate', id: entity.id, generatorId: generator.id, params }]),
      '原参数已变化，确认用当前草稿覆盖？',
    );
  };
  const previewDoc =
    dirty && entity.generation?.source.kind === 'local'
      ? {
          ...doc,
          entities: {
            ...doc.entities,
            [entity.id]: {
              ...entity,
              generation: { ...entity.generation, source: { kind: 'local' as const, params } },
            },
          },
        }
      : doc;
  const preview = dirty ? analyzeDocument(previewDoc) : report;
  const calculationId = isResult && producer ? producer : entity.id;
  return (
    <>
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
              <TensorFields
                fields={generator.fields.filter((f) => (f.section ?? 'structure') === 'structure')}
                params={params}
                onChange={change}
                disabled={store.isReadonly()}
              />
            ) : (
              <p className="warning">缺少原版本生成器，参数暂不可改。</p>
            )}
            <div className="tensor-apply-actions">
              <button
                className="primary full"
                disabled={store.isReadonly() || !generator}
                onClick={() => void apply()}
              >
                应用参数
              </button>
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
                  (f) => f.section === 'appearance' && f.key !== 'fillColor',
                )}
                params={params}
                onChange={change}
                disabled={store.isReadonly()}
              />
              <button
                className="primary full"
                disabled={store.isReadonly()}
                onClick={() => void apply()}
              >
                应用参数
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
                  void commit([{ kind: 'label', id: entity.id, text: label || null }]);
              }}
            />
          </label>
        </>
      )}
      {(panel === 'calculation' || (panel === 'parameters' && !isResult)) && (
        <CalculationPanel entry={preview.nodes[calculationId]} draft={dirty} />
      )}
      {panel === 'calculation' && isResult && producer && (
        <button className="text-button full" onClick={() => onEdit(producer)}>
          编辑产生操作
        </button>
      )}
    </>
  );
}

export function TensorOperationPanel({
  draft,
  doc,
  store,
  registry,
  onCancel,
  onCreate,
}: {
  draft: TensorOperationDraft;
  doc: ProjectDocument;
  store: DocumentStore;
  registry: PluginRegistry;
  onCancel: () => void;
  onCreate: (params: Params) => Promise<void>;
}) {
  const generator = registry.generators.get(`tensor.${draft.kind}`)!;
  const [params, setParams] = useState<Params>({
    ...generator.defaults,
    ...(['relu', 'upsample'].includes(draft.kind)
      ? { dimension: tensorDimension(doc.entities[draft.sourceIds[0]]) ?? 3 }
      : {}),
    ...(draft.sourceIds.length > 1 ? { inputCount: draft.sourceIds.length } : {}),
  });
  const [preview, setPreview] = useState<AnalysisReport['nodes'][string]>(),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const temp = createDocumentStore(doc, createGenerationServices(registry));
    void appendTensorOperation(temp, registry, draft.sourceIds, draft.kind, params).then(
      (result) => {
        if (active)
          setPreview(
            result.ok
              ? analyzeDocument(temp.getSnapshot()).nodes[result.value.operationId]
              : undefined,
          );
      },
    );
    return () => {
      active = false;
    };
  }, [doc, JSON.stringify(params)]);
  const create = async () => {
    setBusy(true);
    try {
      await onCreate(params);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="inspector-heading">
        <span className="eyebrow">ADD OPERATION</span>
        <h2>{generator.name}</h2>
        <p>从已选数据产生新结果，原有数据保持不变。</p>
      </div>
      {draft.sourceIds.length > 1 && (
        <div className="tensor-merge-inputs">
          <h3>输入顺序</h3>
          {draft.sourceIds.map((id, i) => (
            <p key={id}>
              {i + 1}. {doc.entities[id]?.name}
              <strong>{shapeText(analyzeDocument(doc).nodes[id]?.shape)}</strong>
            </p>
          ))}
        </div>
      )}
      <TensorFields
        fields={generator.fields.filter((f) => f.key !== 'inputCount')}
        params={params}
        onChange={setParams}
        disabled={store.isReadonly() || busy}
      />
      <div className="tensor-create-actions">
        <button
          className="primary full"
          disabled={busy || store.isReadonly()}
          onClick={() => void create()}
        >
          {busy ? '正在创建…' : '创建下一步'}
        </button>
        <button className="text-button full" onClick={onCancel}>
          取消
        </button>
      </div>
      <CalculationPanel entry={preview} draft />
    </>
  );
}
