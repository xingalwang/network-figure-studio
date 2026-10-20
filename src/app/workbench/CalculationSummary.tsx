import { useState } from 'react';
import { useWorkbench } from './context.tsx';
import type { TensorShape } from '../../core/computation/index.ts';
function shapeText(shape: TensorShape | undefined) {
  if (!shape) return '—';
  const axes = shape.D === undefined ? [shape.H, shape.W] : [shape.D, shape.H, shape.W];
  const spatial = axes.every((v) => typeof v === 'number' && v === axes[0])
    ? `${axes[0]}${axes.length === 3 ? '³' : '²'}`
    : axes.map((v) => v ?? '?').join('×');
  return `${shape.N === 1 ? '' : `N${shape.N ?? '?'} · `}${spatial} · C${shape.C ?? '?'}`;
}
import { Icon } from '../Icons.tsx';
export function CalculationSummary() {
  const { doc, report, state, select } = useWorkbench();
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<'summary' | 'diagnostics'>('summary');
  const rows = Object.values(doc.entities).filter(
    (e) => e.kind === 'node' && e.semantic?.role === 'operation',
  );
  const diagnostics = Object.values(doc.entities).filter(
    (e) => e.kind === 'node' && report.nodes[e.id]?.state !== 'ready' && report.nodes[e.id],
  );
  const entries = tab === 'summary' ? rows : diagnostics;
  const focus = (id: string) => {
    select([id], true);
  };
  return (
    <section
      className={`calculation-summary ${open ? '' : 'collapsed'}`}
      role="region"
      aria-label="计算摘要"
    >
      <div className="summary-header">
        <button
          className={tab === 'summary' ? 'active' : ''}
          onClick={() => {
            setTab('summary');
            setOpen(true);
          }}
        >
          计算摘要
        </button>
        <button
          className={tab === 'diagnostics' ? 'active' : ''}
          onClick={() => {
            setTab('diagnostics');
            setOpen(true);
          }}
        >
          诊断{diagnostics.length ? ` · ${diagnostics.length}` : ''}
        </button>
        <span className="toolbar-spacer" />
        <button
          aria-label={open ? '收起计算摘要' : '展开计算摘要'}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="chevron" size={13} />
        </button>
      </div>
      {open && (
        <div className="summary-scroll">
          <table className="summary-table">
            <thead>
              <tr>
                <th>对象</th>
                <th>输入规格</th>
                <th>输出规格</th>
                <th>参数量</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const n = report.nodes[e.id];
                return (
                  <tr key={e.id} className={state.selection.includes(e.id) ? 'selected' : ''}>
                    <td>
                      <button onClick={() => focus(e.id)}>{e.name}</button>
                    </td>
                    <td>{n.inputs.map((i) => shapeText(i.shape)).join(' + ') || '—'}</td>
                    <td>{n.shape ? shapeText(n.shape) : n.diagnostics.join('；') || '待配置'}</td>
                    <td>{n.parameterCount ?? '—'}</td>
                    <td>
                      <span className={`state-badge ${n.state}`}>
                        {
                          {
                            ready: '有效',
                            pending: '待配置',
                            error: '冲突',
                            unsupported: '规则未知',
                          }[n.state]
                        }
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!entries.length && (
                <tr>
                  <td colSpan={5}>
                    {tab === 'summary'
                      ? '选择数据块旁的 ＋ 或上方运算，创建下一步。'
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
