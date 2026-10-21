import { useEffect, useRef } from 'react';
import { Icon } from '../Icons.tsx';
import { Button } from '../../ui/controls.tsx';
import { useWorkbench } from '../workbench/context.tsx';
import { ModulePicker } from '../modules/ModulePicker.tsx';
import './welcome.css';

/** The current editor stays mounted behind this page, including its uncommitted drafts. */
export function WelcomePage() {
  const {
    doc,
    persistence,
    error,
    clearError,
    continueProject,
    createNewProject,
    input,
    theme,
    setTheme,
  } = useWorkbench();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const count = Object.values(doc.entities).filter((entity) => entity.kind !== 'edge').length;
  const failure = error || persistence.error;
  return (
    <main className="welcome-page" aria-label="工程引导">
      <header className="welcome-header">
        <div className="welcome-brand">
          <Icon name="logo" size={28} />
          <strong>架构图工作台</strong>
        </div>
        <label>
          界面主题
          <select
            aria-label="界面主题"
            value={theme}
            onChange={(event) => setTheme(event.target.value as typeof theme)}
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </label>
      </header>
      <div className="welcome-content">
        <div className="welcome-introduction">
          <p className="eyebrow">本地网络设计与论文绘图</p>
          <h1 ref={heading} tabIndex={-1}>
            搭建网络，整理图稿
          </h1>
          <p>选择功能模块，继续当前工程，或新建、打开工程。</p>
        </div>
        <div className="welcome-columns">
          <section className="welcome-projects" aria-labelledby="welcome-project-title">
            <h2 id="welcome-project-title">工程</h2>
            <article className="welcome-current">
              <span className="welcome-section-label">当前本地工程</span>
              <h3>{doc.title}</h3>
              <p>
                {count} 个对象 · {persistence.autoStatus}
              </p>
              <Button variant="primary" disabled={persistence.busy} onClick={continueProject}>
                <Icon name="arrow" />
                继续当前工程
              </Button>
            </article>
            <div className="welcome-file-actions">
              <Button disabled={persistence.busy} onClick={() => void createNewProject()}>
                <Icon name="plus" />
                <span>新建工程</span>
              </Button>
              <Button disabled={persistence.busy} onClick={() => input.current?.click()}>
                <Icon name="folder" />
                <span>打开工程</span>
              </Button>
            </div>
            <p className="hint">返回此页会保留参数草稿。保存工程文件可在其他设备继续编辑。</p>
          </section>
          <section className="welcome-modules" aria-labelledby="welcome-modules-title">
            <div className="welcome-section-heading">
              <h2 id="welcome-modules-title">选择功能模块</h2>
              <span>进入后可随时调整</span>
            </div>
            <p>选择只影响创建工具；已有工程的内容与计算规则始终保留。</p>
            <ModulePicker />
          </section>
        </div>
        {failure && (
          <div className="welcome-error" role="alert">
            <span>{failure}</span>
            <button onClick={clearError}>关闭错误</button>
          </div>
        )}
      </div>
      <footer className="welcome-footer">
        <span>选择模块</span>
        <Icon name="arrow" size={14} />
        <span>搭建与构建</span>
        <Icon name="arrow" size={14} />
        <span>图稿与导出</span>
      </footer>
    </main>
  );
}
