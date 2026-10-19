import type { ViewTheme } from '../../graphics/view-theme.ts';
import { tensorDimension } from '../../core/computation/index.ts';
import { useEffect, useRef, useState } from 'react';
import { InternalEvent } from '@maxgraph/core';
import type { DocumentStore, Point, ProjectDocument } from '../../core/document/types.ts';
import type { GraphAdapter } from '../../adapters/maxgraph/adapter.ts';
import type { TensorKind } from '../../core/computation/index.ts';
import { GraphView } from '../drawing/GraphView.tsx';
import { Icon } from '../../app/Icons.tsx';

export function TensorCanvas({
  doc,
  theme,
  store,
  selection,
  onSelect,
  onEdit,
  onReady,
  onError,
  onAdd,
  onOperation,
}: {
  doc: ProjectDocument;
  theme?: ViewTheme;
  store: DocumentStore;
  selection: string[];
  onSelect: (ids: string[]) => void;
  onEdit: (id: string) => void;
  onReady: (a: GraphAdapter | null) => void;
  onError: (message: string) => void;
  onAdd: (position?: Point, dimension?: 2 | 3) => void;
  onOperation: (kind: Exclude<TensorKind, 'source' | 'result'>, ids: string[]) => void;
}) {
  const adapter = useRef<GraphAdapter | null>(null),
    paper = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Point | null>(null),
    [menu, setMenu] = useState(false),
    [version, setVersion] = useState(0);
  const selected = selection.length === 1 ? doc.entities[selection[0]] : undefined;
  const tensor =
    selected?.kind === 'node' && selected.semantic && selected.semantic.role !== 'operation'
      ? selected
      : undefined;
  useEffect(() => {
    const a = adapter.current;
    const update = () => {
      if (!tensor || !a || !paper.current) {
        setAnchor(null);
        return;
      }
      try {
        const p = a.portPoint(tensor.id, 'out'),
          r = paper.current.getBoundingClientRect();
        setAnchor({
          x: Math.min(r.width - 40, Math.max(6, p.x - r.left + 14)),
          y: Math.min(r.height - 42, Math.max(6, p.y - r.top - 18)),
        });
      } catch {
        setAnchor(null);
      }
    };
    update();
    if (!a) return;
    const view = a.graph.getView();
    for (const event of [
      InternalEvent.SCALE,
      InternalEvent.TRANSLATE,
      InternalEvent.SCALE_AND_TRANSLATE,
    ])
      view.addListener(event, update);
    const observer = new ResizeObserver(update);
    if (paper.current) observer.observe(paper.current);
    return () => {
      view.removeListener(update);
      observer.disconnect();
    };
  }, [doc, selection.join(','), version]);
  useEffect(() => setMenu(false), [selection.join(',')]);
  const dimension = tensorDimension(tensor) ?? 3;
  const nodes = Object.values(doc.entities).filter((e) => e.kind === 'node' && e.semantic);
  const count = nodes.filter((e) => e.kind === 'node' && e.semantic?.role !== 'operation').length;
  return (
    <div className="composer-stage tensor-stage">
      <div className="composer-heading">
        <div>
          <span className="eyebrow">TENSOR WORKSPACE</span>
          <h1>网络结构</h1>
        </div>
        <span>
          {count} 个张量 · {nodes.length - count} 次运算
        </span>
      </div>
      <div
        className="structure-paper tensor-paper"
        ref={paper}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-nn-tensor') && !store.isReadonly()) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(event) => {
          if (event.dataTransfer.getData('application/x-nn-tensor') && adapter.current) {
            event.preventDefault();
            onAdd(
              adapter.current.toWorld(event.nativeEvent),
              event.dataTransfer.getData('application/x-nn-tensor') === 'source2d' ? 2 : 3,
            );
          }
        }}
      >
        <GraphView
          theme={theme}
          store={store}
          selection={selection}
          onSelection={onSelect}
          onError={onError}
          onReady={(a) => {
            adapter.current = a;
            onReady(a);
            setVersion((v) => v + 1);
          }}
          onDoubleClick={onEdit}
          placing={false}
          onPlace={() => {}}
          mode="structure"
        />
        {!count && (
          <div className="composer-empty">
            <Icon name="cube" size={36} />
            <h2>先放入一块数据</h2>
            <p>
              拖入左侧的 3D 数据，双击填写尺寸。
              <br />
              之后，从块旁的 ＋ 添加运算。
            </p>
            <button className="secondary" onClick={() => onAdd()} disabled={store.isReadonly()}>
              添加数据块
            </button>
          </div>
        )}
        {anchor && tensor && (
          <div className="tensor-plus-anchor" style={{ left: anchor.x, top: anchor.y }}>
            <button
              className="tensor-plus"
              aria-label="添加后续操作"
              title="从这块数据继续处理"
              aria-expanded={menu}
              disabled={store.isReadonly()}
              onClick={() => setMenu((v) => !v)}
            >
              <Icon name="plus" size={20} />
            </button>
            {menu && (
              <div className="tensor-operation-menu">
                <span>添加下一步</span>
                {(
                  [
                    [
                      dimension === 2 ? 'conv2d' : 'conv3d',
                      dimension === 2 ? 'Conv2D' : 'Conv3D',
                      '卷积与特征提取',
                    ],
                    [
                      dimension === 2 ? 'pool2d' : 'pool3d',
                      dimension === 2 ? 'MaxPool2D' : 'MaxPool3D',
                      '窗口聚合与下采样',
                    ],
                    ['relu', 'ReLU', '逐元素激活 · 形状不变'],
                    ['upsample', '最近邻上采样', '按空间轴倍率扩展'],
                  ] as const
                ).map(([kind, name, hint]) => (
                  <button
                    key={kind}
                    onClick={() => {
                      setMenu(false);
                      onOperation(kind, [tensor.id]);
                    }}
                  >
                    <strong>{name}</strong>
                    <small>{hint}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="selection-summary">
        <span>双击编辑 · 选中后 ＋ 继续 · Shift 多选后拼接</span>
        <span className="hint">规格参与计算，外观保持独立</span>
      </div>
    </div>
  );
}
