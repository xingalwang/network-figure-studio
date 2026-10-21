import { useEffect, useRef, useState } from 'react';
import type { ProjectDocument } from '../core/document/types.ts';
import { exportPng, exportSvg, type ExportOptions } from '../graphics/export.ts';
import { prepareTypography } from '../graphics/typography.ts';
import { Button } from '../ui/controls.tsx';

import type { ComputationRegistry } from '../core/computation/index.ts';
type Props = {
  computations?: ComputationRegistry;
  doc: ProjectDocument;
  selection: string[];
  onClose: () => void;
  onError: (message: string) => void;
};

export function ExportDialog({ doc, selection, onClose, onError, computations }: Props) {
  const [range, setRange] = useState<ExportOptions['range']>('content');
  const [background, setBackground] = useState<ExportOptions['background']>(doc.page.background);
  const [customBackground, setCustomBackground] = useState<string>(
    doc.page.background.startsWith('#') ? doc.page.background : '#f4f1ed',
  );
  const [width, setWidth] = useState('1600'),
    [height, setHeight] = useState('900'),
    [margin, setMargin] = useState('24');
  const [embedFonts, setEmbedFonts] = useState(false),
    [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(''),
    [previewError, setPreviewError] = useState(''),
    [downloadError, setDownloadError] = useState(''),
    [fontNotice, setFontNotice] = useState('');
  const dialog = useRef<HTMLDivElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  const valid =
    Number.isInteger(Number(width)) &&
    Number(width) > 0 &&
    Number.isInteger(Number(height)) &&
    Number(height) > 0 &&
    margin.trim() !== '' &&
    Number.isFinite(Number(margin)) &&
    Number(margin) >= 0 &&
    (range !== 'selection' || selection.length > 0);
  const options: ExportOptions = {
    range,
    background,
    width: Number(width),
    height: Number(height),
    margin: Number(margin),
    selection,
    embedFonts,
  };

  useEffect(() => {
    let active = true;
    void prepareTypography()
      .then(({ missing }) => {
        if (active && missing.length)
          setFontNotice(
            `本机缺少 ${missing.join('、')}，当前使用回退字体；不会将回退标为宋体或 Times New Roman。`,
          );
      })
      .catch((error) => {
        if (active) setFontNotice(error instanceof Error ? error.message : '字体尚未就绪。');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, []);

  // Native download UI or a disabled button can leave focus on the page body.
  useEffect(() => {
    if (busy) return;
    const frame = requestAnimationFrame(() => {
      if (dialog.current && !dialog.current.contains(document.activeElement))
        closeButton.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [busy]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onClose();
      } else if (event.key === 'Tab' && !dialog.current?.contains(document.activeElement)) {
        event.preventDefault();
        closeButton.current?.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [busy, onClose]);

  useEffect(() => {
    let cancelled = false,
      url = '';
    setPreview('');
    setPreviewError('');
    if (!valid) return;
    const timer = window.setTimeout(() => {
      exportSvg(
        doc,
        {
          range,
          background,
          width: Number(width),
          height: Number(height),
          margin: Number(margin),
          selection,
          embedFonts: false,
        },
        computations,
      )
        .then((blob) => {
          if (!cancelled) {
            url = URL.createObjectURL(blob);
            setPreview(url);
          }
        })
        .catch((error) => {
          if (!cancelled)
            setPreviewError(error instanceof Error ? error.message : '预览生成失败。');
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc, selection, range, background, width, height, margin, valid, computations]);

  async function download(kind: 'svg' | 'png') {
    if (!valid || busy) return;
    setBusy(true);
    setDownloadError('');
    try {
      const blob = await (kind === 'svg'
        ? exportSvg(doc, options, computations)
        : exportPng(doc, options, computations));
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${doc.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || '架构图'}.${kind}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出失败，请重试。';
      setDownloadError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) {
            event.stopPropagation();
            onClose();
          }
          if (event.key === 'Tab') {
            const controls = [
              ...dialog.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
              ),
            ];
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <h2 id="export-dialog-title">导出图稿</h2>
          <Button
            variant="quiet"
            type="button"
            ref={closeButton}
            aria-label="关闭导出"
            disabled={busy}
            onClick={onClose}
          >
            关闭
          </Button>
        </header>
        <label>
          导出范围
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as ExportOptions['range'])}
            disabled={busy}
          >
            <option value="content">全部内容</option>
            <option value="selection" disabled={!selection.length}>
              当前选择（{selection.length}）
            </option>
            <option value="page">画板</option>
          </select>
        </label>
        <label>
          图稿背景
          <select
            value={background.startsWith('#') ? 'custom' : background}
            onChange={(event) =>
              setBackground(
                event.target.value === 'custom'
                  ? (customBackground as `#${string}`)
                  : (event.target.value as ExportOptions['background']),
              )
            }
            disabled={busy}
          >
            <option value="white">白色</option>
            <option value="transparent">透明</option>
            <option value="custom">自定义颜色</option>
          </select>
        </label>
        {background.startsWith('#') && (
          <label>
            背景颜色
            <input
              type="color"
              value={customBackground}
              disabled={busy}
              onChange={(event) => {
                setCustomBackground(event.target.value);
                setBackground(event.target.value as `#${string}`);
              }}
            />
          </label>
        )}
        <div className="export-dimensions">
          <label>
            宽度（px）
            <input
              type="number"
              min="1"
              step="1"
              value={width}
              onChange={(event) => setWidth(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            高度（px）
            <input
              type="number"
              min="1"
              step="1"
              value={height}
              onChange={(event) => setHeight(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            边距（图稿 px）
            <input
              type="number"
              min="0"
              step="1"
              value={margin}
              onChange={(event) => setMargin(event.target.value)}
              disabled={busy}
            />
          </label>
        </div>
        <p>保持图形比例，空余部分居中留白。</p>
        <div className="export-preview" aria-live="polite">
          {preview ? (
            <img src={preview} alt="导出预览" width="320" height="180" />
          ) : (
            <p>{previewError || (valid ? '正在生成预览…' : '请填写有效尺寸并选择导出范围。')}</p>
          )}
        </div>
        <label>
          <input
            type="checkbox"
            checked={embedFonts}
            onChange={(event) => setEmbedFonts(event.target.checked)}
            disabled={busy}
          />
          SVG 内嵌本机字体
        </label>
        <p>
          SVG 默认引用本机宋体和 Times New Roman，保留可编辑文字；PNG 保存本机实际字形。内嵌仅在下载
          SVG 时请求本机字体权限，且字体须允许可编辑文档嵌入。
        </p>
        {fontNotice && <p>{fontNotice}</p>}
        {downloadError && <p role="alert">{downloadError}</p>}
        <div className="dialog-actions">
          <Button type="button" disabled={!valid || busy} onClick={() => void download('svg')}>
            下载 SVG
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={!valid || busy}
            onClick={() => void download('png')}
          >
            下载 PNG
          </Button>
        </div>
        {busy && <p role="status">正在准备图稿，请稍候…</p>}
      </div>
    </div>
  );
}
