import type { ViewTheme } from '../../graphics/view-theme.ts';
import { useEffect, useRef } from 'react';
import {
  createGraphAdapter,
  createGraphPreview,
  type GraphAdapter,
  type GraphMode,
} from '../../adapters/maxgraph/adapter.ts';
import type { DocumentStore, ProjectDocument, Point } from '../../core/document/types.ts';
import type { ComputationRegistry } from '../../core/computation/index.ts';
export function GraphView({
  store,
  selection,
  onSelection,
  onReady,
  onError,
  placing,
  onPlace,
  onDoubleClick,
  tool = 'select',
  mode = 'figure',
  theme = 'dark',
  computations,
  projectionDoc,
}: {
  computations?: ComputationRegistry;
  projectionDoc?: ProjectDocument;
  store: DocumentStore;
  selection: string[];
  onSelection: (ids: string[]) => void;
  onReady: (a: GraphAdapter | null) => void;
  onError: (message: string) => void;
  placing: boolean;
  onPlace: (p: Point) => void;
  onDoubleClick?: (id: string) => void;
  tool?: 'select' | 'connect';
  mode?: GraphMode;
  theme?: ViewTheme;
}) {
  const element = useRef<HTMLDivElement>(null),
    adapter = useRef<GraphAdapter | null>(null),
    callbacks = useRef({ onSelection, onReady, onError, onPlace, placing, onDoubleClick });
  callbacks.current = { onSelection, onReady, onError, onPlace, placing, onDoubleClick };
  useEffect(() => {
    const a = createGraphAdapter(
      element.current!,
      store,
      (m) => callbacks.current.onError(m),
      mode,
      theme,
      computations,
    );
    adapter.current = a;
    const unsub = a.onSelection((ids) => callbacks.current.onSelection(ids));
    const unsubDouble = a.onDoubleClick((id) => callbacks.current.onDoubleClick?.(id));
    a.fit();
    callbacks.current.onReady(a);
    return () => {
      unsub();
      unsubDouble();
      callbacks.current.onReady(null);
      a.dispose();
      adapter.current = null;
    };
  }, [store, mode, computations]);
  useEffect(() => {
    adapter.current?.setTheme(theme);
  }, [theme]);
  useEffect(() => {
    adapter.current?.setProjectionDocument(mode === 'structure' ? projectionDoc : undefined);
  }, [projectionDoc, store, mode, computations]);
  useEffect(() => {
    adapter.current?.setSelection(selection);
  }, [selection]);
  useEffect(() => {
    adapter.current?.setTool(tool);
  }, [tool]);
  return (
    <div
      className={`graph-container ${placing ? 'placing' : ''}`}
      data-testid="graph-container"
      ref={element}
      onClick={(e) => {
        if (callbacks.current.placing && adapter.current) {
          callbacks.current.onPlace(adapter.current.toWorld(e.nativeEvent));
          e.stopPropagation();
        }
      }}
    />
  );
}
export function Preview({ doc }: { doc: ProjectDocument | null }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!doc || !element.current) return;
    const preview = createGraphPreview(element.current, doc);
    return () => preview.dispose();
  }, [doc]);
  return <div className="preview-graph" ref={element} data-testid="preview-graph" />;
}
