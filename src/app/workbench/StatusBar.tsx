import { Icon } from '../Icons.tsx';
import { useWorkbench } from './context.tsx';
export function StatusBar() {
  const { doc, state, zoom, isLegacy, saving, fit, doZoom } = useWorkbench();
  return (
    <footer className="statusbar">
      <span>
        <i className="status-dot" />
        {isLegacy
          ? '预览不会修改正式工程'
          : state.placing
            ? '等待放置'
            : state.selection.length
              ? `已选 ${state.selection.length} 个对象`
              : '本地优先 · 数据保存在本机'}
      </span>
      <span className="file-state">{saving}</span>
      <div className="status-actions">
        <span>r{doc.revision}</span>
        {!isLegacy && (
          <>
            <button aria-label="缩小" onClick={() => doZoom(0.85)}>
              <Icon name="minus" size={14} />
            </button>
            <span>{zoom}%</span>
            <button aria-label="放大" onClick={() => doZoom(1 / 0.85)}>
              <Icon name="plus" size={14} />
            </button>
            <button aria-label="适应画布" onClick={fit}>
              <Icon name="fit" size={16} />
            </button>
          </>
        )}
      </div>
    </footer>
  );
}
