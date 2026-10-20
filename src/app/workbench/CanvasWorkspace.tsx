import { Icon } from '../Icons.tsx';
import { GraphView, Preview } from '../../workspaces/drawing/GraphView.tsx';
import { ComposerCanvas } from '../../workspaces/generator/ComposerCanvas.tsx';
import { ConnectionTools } from '../../workspaces/generator/ConnectionTools.tsx';
import { TensorCanvas } from '../../workspaces/generator/TensorCanvas.tsx';
import { CalculationSummary } from './CalculationSummary.tsx';
import { useWorkbench } from './context.tsx';
export function CanvasWorkspace() {
  const {
    store,
    session,
    lifecycle,
    persistence,
    doc,
    state,
    theme,
    registry,
    error,
    setError,
    notice,
    setNotice,
    setInspectorOpen,
    tool,
    setTool,
    isLegacy,
    isBuild,
    isTensor,
    lockMode,
    available,
    selectedTensors,
    add,
    addTensor,
    editTensor,
    beginOperation,
    layout,
    returnToBuild,
    canDistribute,
    ready,
    placeAt,
    applyLegacyDraft,
    distribute,
    clearError,
    clearNotice,
  } = useWorkbench();
  return (
    <section className="workspace">
      <div className="toolbar">
        {isTensor ? (
          <>
            <span className="toolbar-name">数据与计算</span>
            {selectedTensors.length >= 2 && (
              <>
                <button
                  className="toolbar-button"
                  disabled={store.isReadonly()}
                  onClick={() => beginOperation('concat', selectedTensors)}
                >
                  拼接所选张量
                </button>
                <button
                  className="toolbar-button"
                  disabled={store.isReadonly()}
                  onClick={() => beginOperation('add', selectedTensors)}
                >
                  逐元素相加
                </button>
              </>
            )}
            <div className="toolbar-spacer" />
          </>
        ) : isBuild ? (
          <>
            <span className="toolbar-name">结构</span>
            <button
              className="toolbar-button"
              disabled={!Object.keys(doc.entities).length || store.isReadonly()}
              onClick={() => void layout()}
              title="按连接整理基元位置，保留手工路径"
            >
              整理布局
            </button>
            <div className="toolbar-spacer" />
            <ConnectionTools
              doc={doc}
              store={store}
              registry={registry}
              selection={state.selection}
              onError={setError}
              onSuccess={() => setNotice('已创建连接 · 可一次撤销')}
            />
          </>
        ) : isLegacy ? (
          <>
            <button className="toolbar-button" onClick={returnToBuild}>
              返回结构搭建
            </button>
            <span className="eyebrow">GENERATOR</span>
            <span className="toolbar-name">{available.name}</span>
            <span className="tag">2D / 3D 混排</span>
            <div className="toolbar-spacer" />
            {state.draft && <span className="draft-badge">编辑原组件 · 草稿未应用</span>}
          </>
        ) : (
          <>
            <div className="tool-group">
              <button
                className={`icon-button ${tool === 'select' ? 'active' : ''}`}
                aria-label="选择工具"
                title="选择与移动"
                onClick={() => setTool('select')}
              >
                <Icon name="cursor" />
              </button>
              <button
                className={`icon-button ${tool === 'connect' ? 'active' : ''}`}
                aria-label="连线工具"
                title="从端口拖出连接"
                onClick={() => setTool('connect')}
              >
                <Icon name="arrow" />
              </button>
            </div>
            <button
              className="toolbar-button"
              disabled={!canDistribute}
              onClick={() => void distribute()}
            >
              <Icon name="align" />
              等距排布
            </button>
            <div className="toolbar-spacer" />
            <span className="hint">Shift 多选 · 拖动调整</span>
          </>
        )}
        <button
          className="icon-button"
          aria-label="切换属性面板"
          title="收起或展开属性面板"
          onClick={() => setInspectorOpen((v) => !v)}
        >
          <Icon name="panel" />
        </button>
      </div>
      {isTensor ? (
        <TensorCanvas
          theme={theme}
          doc={doc}
          registry={registry}
          store={store}
          selection={state.selection}
          onSelect={(ids) => session.select(ids)}
          onEdit={editTensor}
          onReady={ready}
          onError={setError}
          onAdd={(p, dimension = 3) => void addTensor(p, dimension)}
          onOperation={beginOperation}
        />
      ) : isBuild ? (
        <ComposerCanvas
          computations={registry.computations}
          theme={theme}
          doc={doc}
          store={store}
          selection={state.selection}
          onSelection={(ids) => session.select(ids)}
          onReady={ready}
          onError={setError}
          onAdd={(id, p) => void add(id, p)}
        />
      ) : isLegacy ? (
        <div className="generator-stage">
          <div className="stage-title">
            <div>
              <span className="eyebrow">LIVE PREVIEW</span>
              <h1>{available.name}</h1>
            </div>
            <span className="hint">
              {state.previewLoading ? '正在生成…' : '原生矢量 · 参数化组件'}
            </span>
          </div>
          <div className="preview-paper">
            <Preview doc={state.preview} />
          </div>
          <div className="structure-panel">
            <div className="structure-heading">
              <h3>生成结构</h3>
              <span>
                {state.preview
                  ? Object.values(state.preview.entities).filter((e) => e.kind === 'node').length
                  : 0}{' '}
                个图层
              </span>
            </div>
            <div className="structure-list">
              {state.preview &&
                Object.values(state.preview.entities)
                  .filter((e) => e.kind === 'node')
                  .map((e) => (
                    <div key={e.id}>
                      <Icon name="cube" size={15} />
                      <span>{e.name}</span>
                      <span className="hint">{e.generation ? '参数化' : '图元'}</span>
                    </div>
                  ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="drawing-stage">
          <div className="artboard-label">
            {doc.title}
            <span>
              {doc.page.width} × {doc.page.height}
            </span>
          </div>
          <div
            className={`canvas-paper ${doc.page.background === 'transparent' ? 'checkerboard' : ''}`}
            style={{
              backgroundColor:
                doc.page.background === 'white' || doc.page.background === 'transparent'
                  ? '#ffffff'
                  : doc.page.background,
            }}
          >
            <GraphView
              store={store}
              computations={registry.computations}
              selection={state.selection}
              onSelection={(ids) => session.select(ids)}
              onReady={ready}
              onError={setError}
              placing={state.placing}
              onPlace={placeAt}
              tool={tool}
              onDoubleClick={(id) => {
                const entity = doc.entities[id];
                if (entity?.kind === 'node' && (entity.semantic || entity.figure?.semanticRef))
                  editTensor(id);
              }}
            />
          </div>
          {state.placing && (
            <div className="placement-notice">
              <Icon name="plus" />
              点击画布放置组件 <kbd>Esc</kbd>取消
            </div>
          )}
        </div>
      )}
      {!isLegacy && <CalculationSummary />}
      {(error || persistence.error || state.error) && (
        <div className="feedback error" role="alert">
          <span>{error || persistence.error || state.error}</span>
          {(error || state.error)?.includes('原组件的参数已经改变') && (
            <button onClick={() => void applyLegacyDraft(true)}>用草稿覆盖</button>
          )}
          <button aria-label="关闭错误提示" onClick={clearError}>
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {(notice || persistence.notice || lockMode === 'readonly' || lockMode === 'failed') && (
        <div className="feedback notice">
          <span>
            {notice ||
              persistence.notice ||
              (lockMode === 'failed'
                ? '项目锁不可用，当前只读；可下载副本或重试。'
                : '此项目在另一标签页编辑，本页只读。原页退出后可接管。')}
          </span>
          {(lockMode === 'readonly' || lockMode === 'failed') && (
            <button onClick={() => lifecycle.retryLock()}>
              {lockMode === 'failed' ? '重试项目锁' : '接管编辑'}
            </button>
          )}
          <button aria-label="关闭提示" onClick={clearNotice}>
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
    </section>
  );
}
