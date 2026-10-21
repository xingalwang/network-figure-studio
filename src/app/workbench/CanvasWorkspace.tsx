import { Icon } from '../Icons.tsx';
import { GraphView, Preview } from '../../workspaces/shared/GraphView.tsx';
import { AssemblyCanvas } from '../../workspaces/generator/AssemblyCanvas.tsx';
import { useWorkbench } from './context.tsx';
export function CanvasWorkspace() {
  const {
    store,
    session,
    doc,
    previewDoc,
    state,
    theme,
    registry,
    setError,
    tool,
    isLegacy,
    available,
    add,
    addTensor,
    availableOperations,
    tensorToolsEnabled,
    editTensor,
    beginOperation,
    returnToBuild,
    ready,
    placeAt,
  } = useWorkbench();
  return (
    <section
      className="workspace"
      aria-label={isLegacy ? '组合预览' : state.workspace === 'generator' ? '组装画布' : '图稿画布'}
    >
      {isLegacy && (
        <div className="toolbar canvas-heading">
          <button className="toolbar-button" onClick={returnToBuild}>
            返回组装画布
          </button>
          <span className="toolbar-name">{available.name}</span>
          <span className="toolbar-spacer" />
          {state.draft && <span className="draft-badge">草稿未应用</span>}
        </div>
      )}
      {state.workspace === 'generator' && !isLegacy ? (
        <AssemblyCanvas
          availableOperations={availableOperations}
          tool={tool}
          tensorToolsEnabled={tensorToolsEnabled}
          projectionDoc={previewDoc}
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
          onAddPrimitive={(id, p) => void add(id, p)}
          onOperation={beginOperation}
        />
      ) : isLegacy ? (
        <div className="generator-stage">
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
              onDoubleClick={editTensor}
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
    </section>
  );
}
