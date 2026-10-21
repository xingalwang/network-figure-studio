import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Icon } from './Icons.tsx';
import { useEditorTheme } from './theme/preferences.ts';
import { prepareTypography, waitForTypographyLayout } from '../graphics/typography.ts';

/** Render progress before waiting for large font transfers; graph measurement still follows readiness. */
export function Startup() {
  useEditorTheme();
  const [Application, setApplication] = useState<ComponentType>();
  const [busy, setBusy] = useState(true);
  const [fontError, setFontError] = useState('');
  const [startupError, setStartupError] = useState('');
  const preparing = useRef(false);
  const start = async () => {
    if (preparing.current) return;
    preparing.current = true;
    setBusy(true);
    setStartupError('');
    let typographyError = '';
    try {
      await prepareTypography();
    } catch (error) {
      typographyError = error instanceof Error ? error.message : '字体尚未就绪。';
      // Preserve access to projects after failure, using settled browser fallback fonts.
      await waitForTypographyLayout().catch(() => document.fonts.ready);
    }
    setFontError(typographyError);
    try {
      if (!Application) {
        const module =
          import.meta.env.DEV && location.pathname.startsWith('/__test__/canvas')
            ? await import('../../tests/fixtures/CanvasHarness.tsx')
            : await import('./App.tsx');
        setApplication(() => module.default);
      }
      document.documentElement.dataset.startup = 'ready';
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : '暂时无法打开工作台。');
      document.documentElement.dataset.startup = 'failed';
    } finally {
      preparing.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    void start();
  }, []);
  return (
    <>
      {Application ? (
        <Application />
      ) : (
        <main className="loading-screen" role="status" aria-label="启动状态" aria-busy={busy}>
          <Icon name="logo" size={36} />
          <h1>架构图工作台</h1>
          <p>{busy ? '正在准备字体与绘图环境…' : startupError}</p>
          {!busy && (
            <button className="secondary" onClick={() => void start()}>
              重试启动
            </button>
          )}
        </main>
      )}
      {Application && fontError && (
        <aside role="alert" aria-label="字体提示" title={fontError} className="startup-font-notice">
          <p>启动时字体加载失败。工程仍可打开和保存；请重试确认图稿与导出字体。</p>
          <button className="secondary" disabled={busy} onClick={() => void start()}>
            {busy ? '正在重试…' : '重试字体'}
          </button>
        </aside>
      )}
    </>
  );
}
