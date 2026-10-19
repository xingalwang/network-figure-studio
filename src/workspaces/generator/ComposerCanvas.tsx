import type { ViewTheme } from '../../graphics/view-theme.ts';
import type { DocumentStore, Point, ProjectDocument } from '../../core/document/types.ts';
import type { GraphAdapter } from '../../adapters/maxgraph/adapter.ts';
import { GraphView } from '../drawing/GraphView.tsx';
import { useRef } from 'react';
import { Icon } from '../../app/Icons.tsx';
export function ComposerCanvas({
  doc,
  theme,
  store,
  selection,
  onSelection,
  onReady,
  onError,
  onAdd,
}: {
  doc: ProjectDocument;
  theme?: ViewTheme;
  store: DocumentStore;
  selection: string[];
  onSelection: (ids: string[]) => void;
  onReady: (adapter: GraphAdapter | null) => void;
  onError: (message: string) => void;
  onAdd: (id: string, position?: Point) => void;
}) {
  const adapter = useRef<GraphAdapter | null>(null),
    count = Object.values(doc.entities).filter((e) => e.kind === 'node').length,
    edges = Object.values(doc.entities).filter((e) => e.kind === 'edge').length;
  return (
    <div className="composer-stage">
      <div className="composer-heading">
        <div>
          <span className="eyebrow">NETWORK COMPOSITION</span>
          <h1>搭建网络结构</h1>
        </div>
        <span className="hint">
          {count} 个基元 · {edges} 条连接
        </span>
      </div>
      <div
        className="structure-paper"
        onDragOver={(e) => {
          if (!store.isReadonly() && e.dataTransfer.types.includes('application/x-nn-primitive')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData('application/x-nn-primitive');
          if (id && adapter.current && !store.isReadonly())
            onAdd(id, adapter.current.toWorld(e.nativeEvent));
        }}
      >
        <GraphView
          theme={theme}
          store={store}
          selection={selection}
          onSelection={onSelection}
          onReady={(a) => {
            adapter.current = a;
            onReady(a);
          }}
          onError={onError}
          placing={false}
          onPlace={() => {}}
          mode="structure"
        />
        {!count && (
          <div className="composer-empty">
            <Icon name="cube" size={30} />
            <h2>从一个基元开始</h2>
            <p>点击或拖入网络层，再从端口接出连接。</p>
            <div>
              <button
                className="secondary"
                disabled={store.isReadonly()}
                onClick={() => onAdd('builtin.conv')}
              >
                卷积层
              </button>
              <button
                className="secondary"
                disabled={store.isReadonly()}
                onClick={() => onAdd('builtin.pool')}
              >
                池化层
              </button>
              <button
                className="secondary"
                disabled={store.isReadonly()}
                onClick={() => onAdd('builtin.concat')}
              >
                拼接
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="selection-summary">
        <span>
          {selection.length ? `已选 ${selection.length} 个对象` : '拖动端口连接 · Shift 按顺序多选'}
        </span>
        <span className="hint">结构和图稿共用同一份工程</span>
      </div>
    </div>
  );
}
