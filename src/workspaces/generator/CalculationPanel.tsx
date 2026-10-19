import type { AnalysisEntry, TensorShape } from '../../core/computation/index.ts';
export function shapeText(shape: TensorShape | undefined) {
  return shape
    ? `N${shape.N ?? '?'} · ${shape.D === undefined ? '' : `${shape.D ?? '?'} × `}${shape.H ?? '?'} × ${shape.W ?? '?'} · C${shape.C ?? '?'}`
    : '尚未得到可用规格';
}
export function CalculationPanel({
  entry,
  draft = false,
}: {
  entry: AnalysisEntry | undefined;
  draft?: boolean;
}) {
  if (!entry) return <p className="hint">选择数据或作用区域查看计算。</p>;
  return (
    <section className="calculation-panel" aria-label="计算解释">
      <div className={`calculation-state ${entry.state}`}>
        <i />
        {draft ? '未应用预览 · ' : ''}
        {entry.state === 'ready'
          ? '规格已推导'
          : entry.state === 'pending'
            ? '待配置'
            : entry.state === 'error'
              ? '尺寸冲突'
              : '缺少推导规则'}
      </div>
      {entry.inputs.length > 0 && (
        <div className="calculation-shapes">
          <h3>输入</h3>
          {entry.inputs.map((input, i) => (
            <p key={`${input.entityId}:${input.portId}`}>
              输入 {i + 1}
              <strong>{shapeText(input.shape)}</strong>
            </p>
          ))}
        </div>
      )}
      <div className="calculation-shapes">
        <h3>输出规格</h3>
        <strong>{shapeText(entry.shape)}</strong>
      </div>
      {entry.parameterCount !== undefined && (
        <div className="parameter-count">
          <span>可训练参数</span>
          <strong>{entry.parameterCount.toLocaleString('en-US')}</strong>
        </div>
      )}
      <p className="calculation-explanation">{entry.explanation}</p>
      {entry.diagnostics.length > 0 && (
        <div
          className="calculation-diagnostics"
          role={entry.state === 'error' ? 'status' : undefined}
        >
          {entry.diagnostics.map((message, i) => (
            <p key={i}>{message}</p>
          ))}
        </div>
      )}
      {entry.steps.length > 0 && (
        <details className="calculation-steps" open>
          <summary>怎么算的</summary>
          {entry.steps.map((step, i) => (
            <p key={i}>{step}</p>
          ))}
        </details>
      )}
    </section>
  );
}
