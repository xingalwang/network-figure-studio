import type { ViewTheme } from '../../graphics/view-theme.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import { useEffect, useRef, useState } from 'react';
import type { DocumentStore, Point, ProjectDocument } from '../../core/document/types.ts';
import type { GraphAdapter } from '../../adapters/maxgraph/adapter.ts';
import type { ComputationDefinition, TensorKind } from '../../core/computation/index.ts';
import { isStructureEntity } from '../../core/figure/index.ts';
import { GraphView } from '../shared/GraphView.tsx';
import { Icon } from '../../app/Icons.tsx';

export function AssemblyCanvas({
  doc,
  theme,
  store,
  selection,
  onSelect,
  onEdit,
  onReady,
  onError,
  onAdd,
  onAddPrimitive,
  onOperation,
  registry,
  projectionDoc,
  availableOperations,
  tool,
  tensorToolsEnabled = true,
}: {
  doc: ProjectDocument;
  projectionDoc?: ProjectDocument;
  availableOperations: readonly ComputationDefinition[];
  tool: 'select' | 'connect';
  tensorToolsEnabled?: boolean;
  theme?: ViewTheme;
  store: DocumentStore;
  selection: string[];
  onSelect: (ids: string[]) => void;
  onEdit: (id: string) => void;
  onReady: (a: GraphAdapter | null) => void;
  onError: (message: string) => void;
  onAdd: (position?: Point, dimension?: 2 | 3) => void;
  onAddPrimitive?: (id: string, position: Point) => void;
  onOperation: (kind: Exclude<TensorKind, 'source' | 'result'>, ids: string[]) => void;
  registry: PluginRegistry;
}) {
  const computations = registry.computations;
  const adapter = useRef<GraphAdapter | null>(null),
    paper = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<
      (Point & { above: boolean; right: boolean; maxHeight: number }) | null
    >(null),
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
        const p = a.portPoint(tensor.id),
          r = paper.current.getBoundingClientRect();
        const x = Math.min(r.width - 40, Math.max(6, p.x - r.left + 14)),
          y = Math.min(r.height - 42, Math.max(6, p.y - r.top - 18)),
          above = y > r.height / 2;
        setAnchor({
          x,
          y,
          above,
          right: x > r.width - 242,
          maxHeight: Math.max(80, above ? y - 12 : r.height - y - 48),
        });
      } catch {
        setAnchor(null);
      }
    };
    update();
    if (!a) return;
    const unsubscribe = a.onViewport(update);
    const observer = new ResizeObserver(update);
    if (paper.current) observer.observe(paper.current);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, [doc, projectionDoc, selection.join(','), version, computations]);
  useEffect(() => setMenu(false), [selection.join(',')]);
  const operations = tensor ? availableOperations : [];
  const count = Object.values(doc.entities).filter(
    (entity) => entity.kind !== 'edge' && isStructureEntity(doc, entity),
  ).length;
  return (
    <div className="composer-stage tensor-stage">
      <div
        className="structure-paper tensor-paper"
        ref={paper}
        onDragOver={(event) => {
          if (store.isReadonly()) return;
          const tensor =
            tensorToolsEnabled && event.dataTransfer.types.includes('application/x-nn-tensor');
          const primitive =
            !!onAddPrimitive && event.dataTransfer.types.includes('application/x-nn-primitive');
          if (tensor || primitive) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(event) => {
          if (store.isReadonly() || !adapter.current) return;
          const tensor =
            tensorToolsEnabled && event.dataTransfer.getData('application/x-nn-tensor');
          const primitive = event.dataTransfer.getData('application/x-nn-primitive');
          if (tensor) {
            event.preventDefault();
            onAdd(adapter.current.toWorld(event.nativeEvent), tensor === 'source2d' ? 2 : 3);
          } else if (primitive && onAddPrimitive) {
            event.preventDefault();
            onAddPrimitive(primitive, adapter.current.toWorld(event.nativeEvent));
          }
        }}
      >
        <GraphView
          projectionDoc={projectionDoc}
          computations={computations}
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
          tool={tool}
        />
        {!count && (
          <div className="composer-empty">
            <Icon name="cube" size={36} />
            <h2>添加数据或自由基元</h2>
            <p>从左侧模块库拖入画布。</p>
            <button
              className="secondary"
              onClick={() => onAdd()}
              disabled={store.isReadonly() || !tensorToolsEnabled}
            >
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
              <div
                className="tensor-operation-menu"
                role="group"
                aria-label="后续运算"
                style={{
                  top: anchor.above ? 'auto' : 36,
                  bottom: anchor.above ? 36 : 'auto',
                  left: anchor.right ? 'auto' : 0,
                  right: anchor.right ? 0 : 'auto',
                  maxHeight: anchor.maxHeight,
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setMenu(false);
                    event.currentTarget.parentElement?.querySelector('button')?.focus();
                    event.stopPropagation();
                  }
                }}
              >
                <span>添加后续运算</span>
                {!operations.length && <p className="hint">暂无可用运算，请检查已启用模块。</p>}
                {operations.map((definition) => (
                  <button
                    key={definition.generatorId}
                    title={definition.operation!.hint}
                    onClick={() => {
                      setMenu(false);
                      onOperation(definition.generatorId, [tensor.id]);
                    }}
                  >
                    <strong>
                      {registry.generators.get(definition.generatorId)?.name ??
                        definition.operation!.label}
                    </strong>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
