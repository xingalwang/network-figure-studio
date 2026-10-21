import { useState } from 'react';
import { useWorkbench } from './context.tsx';
import type { TensorShape } from '../../core/computation/index.ts';
import { Icon } from '../Icons.tsx';
import { useWorkbenchLayout, ResizeHandle } from './layout.tsx';

function shapeText(shape: TensorShape | undefined) {
  if (!shape) return '—';
  const axes = shape.D === undefined ? [shape.H, shape.W] : [shape.D, shape.H, shape.W];
  const spatial = axes.every((v) => typeof v === 'number' && v === axes[0])
    ? `${axes[0]}${axes.length === 3 ? '³' : '²'}`
    : axes.map((v) => v ?? '?').join('×');
  return `${shape.N === 1 ? '' : `N${shape.N ?? '?'} · `}${spatial} · C${shape.C ?? '?'}`;
}
const stateLabels = {
  ready: '有效',
  pending: '待配置',
  error: '冲突',
  unsupported: '规则未知',
};

/** One output dock for derived diagnostics and operational feedback in both workspaces. */
export function CalculationSummary() {
  const {
    doc,
    report: officialReport,
    previewReport,
    state,
    select,
    isLegacy,
    structureDraftCount,
    error,
    notice,
    persistence,
    lockMode,
    lifecycle,
    applyLegacyDraft,
    clearError,
    clearNotice,
  } = useWorkbench();
  const report = state.workspace === 'generator' ? previewReport : officialReport;
  const { layout, setLayout } = useWorkbenchLayout();
  const setOpen = (value: boolean) => setLayout({ expanded: value });
  const [tab, setTab] = useState<'summary' | 'diagnostics'>('diagnostics');
  const rows = Object.values(doc.entities).filter(
    (e) => e.kind === 'node' && e.semantic?.role === 'operation',
  );
  const diagnostics = Object.values(doc.entities).filter(
    (e) => e.kind === 'node' && report.nodes[e.id]?.state !== 'ready' && report.nodes[e.id],
  );
  const entries = tab === 'summary' ? rows : diagnostics;
  const failure = error || persistence.error || state.error;
  const status =
    notice ||
    persistence.notice ||
    (lockMode === 'failed'
      ? '项目锁不可用，当前只读；可下载副本或重试。'
      : lockMode === 'readonly'
        ? '此项目在另一标签页编辑，本页只读。原页退出后可接管。'
        : '');
  const problemCount = diagnostics.length + (failure ? 1 : 0);
  const open = layout.expanded ?? problemCount > 0;
  return (
    <section
      className={`calculation-summary ${open ? '' : 'collapsed'}`}
      role="region"
      aria-label="计算摘要"
    >
      {open && <ResizeHandle side="diagnostics" />}
      <div className="summary-header">
        <button
          className={tab === 'diagnostics' ? 'active' : ''}
          aria-pressed={tab === 'diagnostics'}
          onClick={() => {
            setTab('diagnostics');
            setOpen(true);
          }}
        >
          构建诊断{problemCount ? ` · ${problemCount}` : ' · 0'}
        </button>
        <button
          className={tab === 'summary' ? 'active' : ''}
          aria-pressed={tab === 'summary'}
          onClick={() => {
            setTab('summary');
            setOpen(true);
          }}
        >
          计算摘要
        </button>
        <span className="summary-context">
          {isLegacy
            ? '组件预览'
            : state.workspace === 'generator' && structureDraftCount
              ? `${structureDraftCount} 项结构草稿 · 预览结果`
              : '工程计算结果'}
        </span>
        <span className="toolbar-spacer" />
        <button
          aria-label={open ? '收起计算摘要' : '展开计算摘要'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="chevron" size={13} />
        </button>
      </div>
      {failure && (
        <div className="feedback error" role="alert">
          <span>{failure}</span>
          {(error || state.error)?.includes('原组件的参数已经改变') && (
            <button onClick={() => void applyLegacyDraft(true)}>用草稿覆盖</button>
          )}
          <button aria-label="关闭错误提示" onClick={clearError}>
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {status && (
        <div className="feedback notice" role="status">
          <span>{status}</span>
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
      {open && (
        <div className="summary-scroll">
          <table className={`summary-table ${tab === 'diagnostics' ? 'diagnostics-table' : ''}`}>
            <thead>
              {tab === 'summary' ? (
                <tr>
                  <th>对象</th>
                  <th>输入规格</th>
                  <th>输出规格</th>
                  <th>参数量</th>
                  <th>状态</th>
                </tr>
              ) : (
                <tr>
                  <th>状态</th>
                  <th>对象</th>
                  <th>说明</th>
                </tr>
              )}
            </thead>
            <tbody>
              {entries.map((e) => {
                const n = report.nodes[e.id];
                const badge = (
                  <span className={`state-badge ${n.state}`}>{stateLabels[n.state]}</span>
                );
                const name = <button onClick={() => select([e.id], true)}>{e.name}</button>;
                return (
                  <tr key={e.id} className={state.selection.includes(e.id) ? 'selected' : ''}>
                    {tab === 'summary' ? (
                      <>
                        <td>{name}</td>
                        <td>{n.inputs.map((i) => shapeText(i.shape)).join(' + ') || '—'}</td>
                        <td>
                          {n.shape ? shapeText(n.shape) : n.diagnostics.join('；') || '待配置'}
                        </td>
                        <td>{n.parameterCount ?? '—'}</td>
                        <td>{badge}</td>
                      </>
                    ) : (
                      <>
                        <td>{badge}</td>
                        <td>{name}</td>
                        <td>{n.diagnostics.join('；') || n.explanation || stateLabels[n.state]}</td>
                      </>
                    )}
                  </tr>
                );
              })}
              {!entries.length && (
                <tr>
                  <td colSpan={tab === 'summary' ? 5 : 3}>
                    {isLegacy
                      ? '当前为组件预览，正式工程保持不变。'
                      : tab === 'summary'
                        ? '从左侧模块库选择运算，或点击数据块旁的 ＋，创建下一步。'
                        : '没有计算诊断。'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
