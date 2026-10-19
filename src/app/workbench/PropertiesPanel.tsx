import { Icon } from '../Icons.tsx';
import { ParameterForm } from '../../workspaces/generator/ParameterForm.tsx';
import { Inspector } from '../../workspaces/drawing/Inspector.tsx';
import {
  TensorInspector,
  TensorOperationPanel,
} from '../../workspaces/generator/TensorInspector.tsx';
import { planRestoreTensorFigure } from '../../core/tensor-composition.ts';
import { FigureStylePanel } from '../../workspaces/shared/FigureStylePanel.tsx';
import { useWorkbench } from './context.tsx';
export function PropertiesPanel() {
  const {
    store,
    session,
    doc,
    state,
    registry,
    error,
    setError,
    setGeneratorMode,
    rightTab,
    setRightTab,
    setPendingParameters,
    parameterDrafts,
    operationDraft,
    setOperationDraft,
    editRequest,
    isLegacy,
    isTensor,
    report,
    adapter,
    available,
    selected,
    editTensor,
  } = useWorkbench();
  return (
    <aside className="right-panel">
      <div className="dock-heading">
        <span>属性{selected ? ` — ${selected.name}` : ''}</span>
        <Icon name="panel" size={14} />
      </div>
      {isLegacy ? (
        <>
          <div className="inspector-heading">
            <span className="eyebrow">COMPONENT SETTINGS</span>
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
                <button
                  className="primary full"
                  disabled={state.previewLoading || !!state.error || store.isReadonly()}
                  onClick={async () => {
                    const r = await session.applyDraft();
                    if (!r.ok) setError(r.error.message);
                  }}
                >
                  应用到原组件
                  <Icon name="arrow" size={16} />
                </button>
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
          <div className="inspector-tabs">
            <button
              className={rightTab === 'component' ? 'active' : ''}
              onClick={() => setRightTab('component')}
            >
              组件
            </button>
            <button
              className={rightTab === 'figure' ? 'active' : ''}
              onClick={() => setRightTab('figure')}
            >
              图稿
            </button>
          </div>
          <div className="panel-scroll inspector">
            {!operationDraft &&
              rightTab === 'component' &&
              selected?.figureState === 'hidden' &&
              state.workspace === 'drawing' && (
                <button
                  className="secondary full"
                  disabled={store.isReadonly()}
                  onClick={async () => {
                    const current = store.getSnapshot();
                    const result = await store.dispatch({
                      baseRevision: current.revision,
                      operations: planRestoreTensorFigure(current, [selected.id]),
                    });
                    if (!result.ok) setError(result.error.message);
                  }}
                >
                  恢复到图稿
                </button>
              )}
            {operationDraft ? (
              <TensorOperationPanel
                key={`${operationDraft.kind}:${operationDraft.sourceIds.join(',')}`}
                draft={operationDraft}
                doc={doc}
                store={store}
                registry={registry}
                onCancel={() => setOperationDraft(null)}
                onCreated={(id) => {
                  setOperationDraft(null);
                  session.select([id]);
                  setGeneratorMode('tensor');
                  session.setWorkspace('generator');
                  requestAnimationFrame(() => adapter.current?.reveal(id));
                }}
                onError={setError}
              />
            ) : rightTab === 'figure' ? (
              <FigureStylePanel doc={doc} store={store} onError={setError} />
            ) : selected?.kind === 'node' && selected.semantic ? (
              <>
                <TensorInspector
                  key={selected.id}
                  doc={doc}
                  store={store}
                  entity={selected}
                  registry={registry}
                  report={report}
                  editRequest={editRequest}
                  onEdit={editTensor}
                  onError={setError}
                  drafts={parameterDrafts.current}
                  onDraftChange={setPendingParameters}
                />
              </>
            ) : isTensor && !selected ? (
              <div className="inspector-empty">
                <span className="eyebrow">DATA → OPERATION → DATA</span>
                <h2>从数据，理解网络</h2>
                <p>双击数据块配置规格。选中后，点旁边的 ＋ 添加下一步。</p>
                <p className="hint">真实尺寸用于计算，显示大小用于绘图。</p>
              </div>
            ) : (
              <Inspector
                key={selected?.id ?? 'empty'}
                store={store}
                doc={doc}
                entity={selected}
                registry={registry}
                onEdit={(id) => {
                  const e = doc.entities[id];
                  if (
                    e.kind === 'node' &&
                    registry.primitives.has(e.generation?.generatorId ?? '')
                  ) {
                    setGeneratorMode('build');
                    session.setWorkspace('generator');
                  } else {
                    setGeneratorMode('component');
                    session.edit(id);
                  }
                }}
                onError={setError}
                drafts={parameterDrafts.current}
                onDraftChange={setPendingParameters}
              />
            )}
          </div>
        </>
      )}
    </aside>
  );
}
