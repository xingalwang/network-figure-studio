import { ApplicationMenus } from './ApplicationMenus.tsx';
import { Icon } from '../Icons.tsx';
import { useWorkbench } from './context.tsx';
export function Header() {
  const {
    store,
    session,
    doc,
    state,
    theme,
    setTheme,
    setExportOpen,
    enterTensor,
    autoStatus,
    input,
    hasDrawing,
    save,
  } = useWorkbench();
  return (
    <header className="topbar">
      <div className="brand">
        <Icon name="logo" size={27} />
        <strong>架构图工作台</strong>
        <span className="beta">0.1</span>
      </div>
      <div className="project-title">
        <input
          aria-label="项目名称"
          disabled={store.isReadonly()}
          key={`${doc.id}:${doc.title}`}
          defaultValue={doc.title}
          onBlur={(e) => {
            if (e.target.value && e.target.value !== doc.title)
              void store.dispatch({
                baseRevision: doc.revision,
                operations: [{ kind: 'metadata', title: e.target.value }],
              });
          }}
        />
        <span className="save-state">
          <i />
          {autoStatus}
        </span>
      </div>
      <ApplicationMenus section="file" />
      <nav className="workspace-tabs" aria-label="工作区">
        <button
          className={state.workspace === 'generator' ? 'active' : ''}
          onClick={() => {
            enterTensor();
          }}
        >
          生成
        </button>
        <button
          className={state.workspace === 'drawing' ? 'active' : ''}
          onClick={() => session.setWorkspace('drawing')}
        >
          绘图
        </button>
      </nav>
      <ApplicationMenus section="tools" />
      <div className="header-actions">
        <label className="theme-control">
          <span className="sr-only">界面主题</span>
          <select
            aria-label="界面主题"
            value={theme}
            onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </label>
        <button
          className="icon-button"
          title="撤销 Ctrl+Z"
          aria-label="撤销"
          disabled={!store.canUndo()}
          onClick={() => store.undo()}
        >
          <Icon name="undo" />
        </button>
        <button
          className="icon-button"
          aria-label="重做"
          title="重做 Ctrl+Shift+Z"
          disabled={!store.canRedo()}
          onClick={() => store.redo()}
        >
          <Icon name="redo" />
        </button>
        <button className="secondary" onClick={() => save()}>
          <Icon name="save" />
          保存
        </button>
        <button className="primary" disabled={!hasDrawing} onClick={() => setExportOpen(true)}>
          导出
          <Icon name="download" size={16} />
        </button>
      </div>
    </header>
  );
}
