import { useWorkbench } from './context.tsx';
import { Header } from './Header.tsx';
import { CommandRibbon } from './CommandRibbon.tsx';
import { ModelPanel } from './ModelPanel.tsx';
import { CanvasWorkspace } from './CanvasWorkspace.tsx';
import { CalculationSummary } from './CalculationSummary.tsx';
import { PropertiesPanel } from './PropertiesPanel.tsx';
import { StatusBar } from './StatusBar.tsx';
import { ExportDialog } from '../ExportDialog.tsx';
import { WorkbenchLayout, useWorkbenchLayout, layoutStyle, ResizeHandle } from './layout.tsx';
export function Workbench() {
  return (
    <WorkbenchLayout>
      <WorkbenchContent />
    </WorkbenchLayout>
  );
}
function WorkbenchContent() {
  const { layout } = useWorkbenchLayout();
  const {
    persistence,
    homeOpen,
    inspectorOpen,
    doc,
    state,
    registry,
    exportOpen,
    setExportOpen,
    setError,
  } = useWorkbench();
  return (
    <main
      inert={persistence.busy || homeOpen}
      aria-hidden={homeOpen}
      style={layoutStyle(layout)}
      className={`studio workbench ${inspectorOpen ? '' : 'inspector-hidden'}`}
    >
      <Header />
      <CommandRibbon />
      <ModelPanel />
      <CanvasWorkspace />
      <PropertiesPanel />
      <CalculationSummary />
      <StatusBar />
      <ResizeHandle side="library" />
      {inspectorOpen && <ResizeHandle side="inspector" />}
      {exportOpen && (
        <ExportDialog
          doc={doc}
          computations={registry.computations}
          selection={state.selection}
          onClose={() => setExportOpen(false)}
          onError={setError}
        />
      )}
    </main>
  );
}
