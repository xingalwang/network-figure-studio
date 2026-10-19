import { useEffect, useRef } from 'react';
import { createGraphAdapter } from '../../src/adapters/maxgraph/adapter.ts';
import { createDocumentStore } from '../../src/core/commands/store.ts';
import { makeCoreFixture } from './project.ts';
import { exportSvg, exportPng } from '../../src/graphics/export.ts';
export default function CanvasHarness() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const store = createDocumentStore(makeCoreFixture()),
      adapter = createGraphAdapter(ref.current!, store, console.error);
    window.__studio = {
      snapshot: () => structuredClone(store.getSnapshot()),
      screenPoint: adapter.screenPoint,
      select: adapter.setSelection,
      dispatch: store.dispatch,
      exportSvg,
      exportPng,
      graph: adapter.graph,
    };
    return () => adapter.dispose();
  }, []);
  return (
    <div
      ref={ref}
      data-testid="graph-container"
      style={{
        width: 1100,
        height: 650,
        position: 'relative',
        background: 'white',
        fontFamily: 'Inter, Noto Sans SC, sans-serif',
      }}
    />
  );
}
