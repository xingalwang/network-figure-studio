import { applicationVersion } from '../version.ts';
import { useWorkbench } from './context.tsx';
import type { ReactNode } from 'react';
import { useModules } from '../modules/preferences.tsx';

function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="header-menu">
      <summary>{label}</summary>
      <div
        className="header-menu-content"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button'))
            event.currentTarget.parentElement?.removeAttribute('open');
        }}
      >
        {children}
      </div>
    </details>
  );
}

export function ApplicationMenus({ section }: { section: 'file' | 'tools' }) {
  const {
    store,
    state,
    input,
    createNewProject,
    save,
    setExportOpen,
    hasDrawing,
    removeSelection,
    inspectorOpen,
    setInspectorOpen,
    fit,
    doZoom,
  } = useWorkbench();
  const { openSettings } = useModules();
  if (section === 'file')
    return (
      <Menu label="文件">
        <button onClick={() => void createNewProject()}>新建工程</button>
        <button onClick={() => input.current?.click()}>打开工程</button>
        <button onClick={() => void save()}>保存</button>
        <button onClick={() => void save(true)}>下载工程副本</button>
        <button disabled={!hasDrawing} onClick={() => setExportOpen(true)}>
          导出
        </button>
      </Menu>
    );
  return (
    <>
      <Menu label="编辑">
        <button disabled={!store.canUndo()} onClick={() => store.undo()}>
          撤销
        </button>
        <button disabled={!store.canRedo()} onClick={() => store.redo()}>
          重做
        </button>
        <button
          disabled={store.isReadonly() || !state.selection.length}
          onClick={() => void removeSelection()}
        >
          移除所选对象
        </button>
      </Menu>
      <Menu label="视图">
        <button onClick={fit}>适应画布</button>
        <button onClick={() => doZoom(1.15)}>放大</button>
        <button onClick={() => doZoom(1 / 1.15)}>缩小</button>
        <button onClick={() => setInspectorOpen((v) => !v)}>
          {inspectorOpen ? '收起属性面板' : '展开属性面板'}
        </button>
      </Menu>
      <button className="header-module-button" onClick={openSettings}>
        模块
      </button>
      <Menu label="帮助">
        <p>架构图工作台 {applicationVersion}</p>
        <p>双击配置 · ＋ 添加后续操作</p>
        <p>Shift 多选 · Delete 移除</p>
        <p>Ctrl+S 保存 · Ctrl+Z 撤销</p>
        <p>MIT · 本地优先</p>
      </Menu>
    </>
  );
}
