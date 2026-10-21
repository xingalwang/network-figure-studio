import { Icon } from '../Icons.tsx';
import { Tabs } from '../../ui/controls.tsx';
import { ParameterForm } from '../../workspaces/generator/ParameterForm.tsx';
import { Inspector } from '../../workspaces/drawing/Inspector.tsx';
import {
  TensorInspector,
  TensorOperationPanel,
} from '../../workspaces/generator/TensorInspector.tsx';
import { FigureStylePanel } from '../../workspaces/shared/FigureStylePanel.tsx';
import { FigureAnnotationPanel } from '../../workspaces/drawing/FigureAnnotationPanel.tsx';
import { FigureRepresentationPanel } from '../../workspaces/drawing/FigureRepresentationPanel.tsx';
import { useWorkbench } from './context.tsx';
export function PropertiesPanel() {
  const {
    store,
    session,
    doc,
    state,
    registry,
    setError,
    rightTab,
    setRightTab,
    parameterDraftChanged,
    parameterDrafts,
    operationDraft,
    operationEditor,
    changeOperationParameters,
    cancelOperation,
    createOperation,
    restoreFigure,
    editObject,
    editRequest,
    isLegacy,
    isTensor,
    report,
    previewReport,
    available,
    selected,
    editTensor,
    updateAnnotation,
    updateFigureAppearance,
    applyAppearanceParameters,
    setLabel,
  } = useWorkbench();
  const activeDraft =
    state.workspace === 'generator' && rightTab === 'component' ? operationDraft : null;
  const activeEditor = activeDraft ? operationEditor : null;
  return (
    <aside className="right-panel">
      <div className="dock-heading">
        <span title={selected?.name}>
          {activeDraft
            ? '添加运算'
            : rightTab === 'figure'
              ? '图稿页面设置'
              : (selected?.name ?? '对象信息')}
        </span>
        <Icon name="panel" size={14} />
      </div>
      {isLegacy ? (
        <>
          <div className="inspector-heading">
            <span className="eyebrow">组合预览参数</span>
            <h2>{available.name}</h2>
            <p>{available.description}</p>
          </div>
          <div className="panel-scroll">
            <ParameterForm
              fields={available.fields}
              params={state.params}
              onChange={(p) => session.setParams(p)}
            />
            <p className="hint param-note">
              数量表示网络参数，不会强制按真实比例绘制。2D 与立体可以在同一张图中混排。
            </p>
          </div>
          <div className="panel-actions">
            {state.draft ? (
              <>
                <p className="hint">已有组件的结构参数统一通过顶部“构建”应用。</p>
                <button className="text-button full" onClick={() => session.cancelDraft()}>
                  取消草稿
                </button>
              </>
            ) : (
              <button
                className="primary full"
                disabled={state.previewLoading || !!state.error || store.isReadonly()}
                onClick={() => session.beginPlacement()}
              >
                放入画布
                <Icon name="arrow" size={16} />
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <Tabs
            className="inspector-tabs"
            label="信息范围"
            value={rightTab}
            items={[
              { value: 'component', label: '对象属性' },
              { value: 'figure', label: '图稿页面' },
            ]}
            onChange={setRightTab}
          />
          <div className="panel-scroll inspector">
            {!activeDraft &&
              rightTab === 'component' &&
              selected?.figureState === 'hidden' &&
              state.workspace === 'drawing' && (
                <button
                  className="secondary full"
                  disabled={store.isReadonly()}
                  onClick={() => void restoreFigure([selected.id])}
                >
                  恢复到图稿
                </button>
              )}
            {activeDraft && activeEditor ? (
              <TensorOperationPanel
                key={`${activeDraft.kind}:${activeDraft.sourceIds.join(',')}`}
                draft={activeDraft}
                editor={activeEditor}
                onChange={changeOperationParameters}
                doc={doc}
                store={store}
                registry={registry}
                onCancel={cancelOperation}
                onCreate={createOperation}
              />
            ) : rightTab === 'figure' ? (
              <FigureStylePanel doc={doc} store={store} onError={setError} />
            ) : selected?.kind === 'node' && selected.annotation ? (
              <FigureAnnotationPanel
                entity={selected}
                readonly={store.isReadonly()}
                onApply={updateAnnotation}
                drafts={parameterDrafts}
                onDraftChange={parameterDraftChanged}
              />
            ) : selected?.kind === 'node' && selected.semantic ? (
              <>
                <TensorInspector
                  key={selected.id}
                  showStructureInfo={state.workspace === 'generator'}
                  doc={doc}
                  store={store}
                  entity={selected}
                  registry={registry}
                  report={state.workspace === 'generator' ? previewReport : report}
                  editRequest={editRequest}
                  onApplyAppearance={applyAppearanceParameters}
                  onSetLabel={setLabel}
                  onEdit={editTensor}
                  onError={setError}
                  drafts={parameterDrafts}
                  onDraftChange={parameterDraftChanged}
                />
              </>
            ) : isTensor && !selected ? (
              <div className="inspector-empty">
                <h2>未选择对象</h2>
                <p>选择对象查看属性与计算说明，双击可编辑参数。</p>
                <p className="hint">真实尺寸用于计算，显示大小用于绘图。</p>
              </div>
            ) : (
              <>
                {selected?.kind === 'node' && selected.figure?.role === 'representation' && (
                  <FigureRepresentationPanel
                    doc={doc}
                    entity={selected}
                    disabled={store.isReadonly()}
                    onApply={(values) => updateFigureAppearance(selected.id, values)}
                    drafts={parameterDrafts}
                    onDraftChange={parameterDraftChanged}
                  />
                )}
                <Inspector
                  workspace={state.workspace}
                  key={selected?.id ?? 'empty'}
                  store={store}
                  doc={doc}
                  entity={selected}
                  registry={registry}
                  onApplyAppearance={applyAppearanceParameters}
                  onSetLabel={setLabel}
                  onEdit={editObject}
                  editRequest={editRequest}
                  onError={setError}
                  drafts={parameterDrafts}
                  onDraftChange={parameterDraftChanged}
                />
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
