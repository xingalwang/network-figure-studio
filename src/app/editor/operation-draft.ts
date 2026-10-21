import { useEffect, useRef, useState } from 'react';
import { createDocumentStore } from '../../core/commands/store.ts';
import {
  analyzeDocument,
  resolveOperation,
  tensorDimension,
  type AnalysisEntry,
  type AnalysisReport,
} from '../../core/computation/index.ts';
import {
  fail,
  ok,
  type DocumentStore,
  type Params,
  type ProjectDocument,
  type Result,
} from '../../core/document/types.ts';
import { createGenerationServices } from '../../core/generation/merge.ts';
import { appendTensorOperation } from '../../core/tensor-composition.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import type { TensorOperationDraft } from './model.ts';
import { operationCapability } from './capabilities.ts';

export type OperationEditorState = {
  params: Params;
  dimension: 2 | 3;
  preview?: AnalysisEntry;
  inputReport: AnalysisReport;
  error: string;
  busy: boolean;
};

export function prepareOperationParameters(
  doc: ProjectDocument,
  registry: PluginRegistry,
  draft: TensorOperationDraft,
): Result<{ params: Params; dimension: 2 | 3 }> {
  const definition = resolveOperation(draft.kind, registry.computations),
    generator = definition && registry.generators.get(definition.generatorId),
    dimension = tensorDimension(doc.entities[draft.sourceIds[0]], registry.computations);
  if (!definition?.operation || !generator || !dimension)
    return fail('GENERATOR_UNAVAILABLE', '缺少匹配的计算操作或输入数据定义。');
  try {
    return ok({
      params: definition.operation.prepareParams(
        { ...generator.defaults },
        dimension,
        draft.sourceIds.length,
      ),
      dimension,
    });
  } catch (error) {
    return fail('INVALID_PARAMS', error instanceof Error ? error.message : '计算参数准备失败。');
  }
}

/** Detached generation and analysis belong to editor coordination, never to a workspace panel. */
export async function previewOperation(
  doc: ProjectDocument,
  registry: PluginRegistry,
  draft: TensorOperationDraft,
  params: Params,
): Promise<Result<AnalysisEntry>> {
  const temporary = createDocumentStore(doc, createGenerationServices(registry));
  const result = await appendTensorOperation(
    temporary,
    registry,
    draft.sourceIds,
    draft.kind,
    params,
  );
  if (!result.ok) return result;
  const entry = analyzeDocument(temporary.getSnapshot(), registry.computations).nodes[
    result.value.operationId
  ];
  return entry ? ok(entry) : fail('PREVIEW_UNAVAILABLE', '暂时无法生成计算预览。');
}

/** One operation draft survives panel and workspace changes; only a successful edit consumes it. */
export function useOperationDraft({
  doc,
  store,
  registry,
  report,
  workspace,
  enabledOperationIds,
  onError,
  onCreated,
}: {
  doc: ProjectDocument;
  store: DocumentStore;
  registry: PluginRegistry;
  report: AnalysisReport;
  workspace: 'generator' | 'drawing';
  enabledOperationIds: ReadonlySet<string>;
  onError(message: string): void;
  onCreated(id: string): void;
}) {
  const [draft, setDraft] = useState<TensorOperationDraft | null>(null);
  const [values, setValues] = useState<{ params: Params; dimension: 2 | 3 }>({
    params: {},
    dimension: 3,
  });
  const [preview, setPreview] = useState<AnalysisEntry>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    setPreview(undefined);
    setError('');
    if (!draft) return;
    let active = true;
    void previewOperation(doc, registry, draft, values.params)
      .then((result) => {
        if (!active) return;
        if (result.ok) setPreview(result.value);
        else setError(result.error.message);
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : '计算预览失败。');
      });
    return () => {
      active = false;
    };
  }, [doc, registry, draft, values.params]);
  return {
    draft,
    editor: draft
      ? ({ ...values, preview, inputReport: report, error, busy } satisfies OperationEditorState)
      : null,
    begin(next: TensorOperationDraft) {
      const prepared = prepareOperationParameters(store.getSnapshot(), registry, next);
      if (!prepared.ok) {
        onError(prepared.error.message);
        return false;
      }
      setValues(prepared.value);
      setDraft(next);
      return true;
    },
    change(params: Params) {
      setValues((current) => ({ ...current, params }));
    },
    cancel() {
      if (!submitting.current) setDraft(null);
    },
    async create() {
      if (!draft || submitting.current) return;
      const capability = operationCapability(
        registry,
        store.getSnapshot(),
        draft.sourceIds,
        draft.kind,
        {
          workspace,
          readonly: store.isReadonly(),
          enabledOperationIds,
        },
      );
      if (!capability.available) {
        onError(capability.reason!);
        return;
      }
      submitting.current = true;
      setBusy(true);
      try {
        const result = await appendTensorOperation(
          store,
          registry,
          draft.sourceIds,
          draft.kind,
          values.params,
        );
        if (!result.ok) {
          onError(result.error.message);
          return;
        }
        setDraft(null);
        onCreated(result.value.resultId);
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    },
  };
}
