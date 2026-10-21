import { applicationVersion } from '../version.ts';
import { ApplicationMenus } from './ApplicationMenus.tsx';
import { Icon } from '../Icons.tsx';
import { Button } from '../../ui/controls.tsx';
import { useWorkbench } from './context.tsx';
export function Header() {
  const {
    store,
    doc,
    state,
    theme,
    setTheme,
    setExportOpen,
    enterTensor,
    enterDrawing,
    autoStatus,
    goHome,
    hasDrawing,
    save,
  } = useWorkbench();
  return (
    <header className="topbar">
      <button className="brand home-button" title="返回引导页" onClick={() => void goHome()}>
        <Icon name="logo" size={27} />
        <strong>架构图工作台</strong>
        <span className="beta">{applicationVersion}</span>
      </button>
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
          组装
        </button>
        <button className={state.workspace === 'drawing' ? 'active' : ''} onClick={enterDrawing}>
          图稿
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
        <Button onClick={() => save()}>
          <Icon name="save" />
          保存
        </Button>
        <Button variant="primary" disabled={!hasDrawing} onClick={() => setExportOpen(true)}>
          导出
          <Icon name="download" size={16} />
        </Button>
      </div>
    </header>
  );
}
