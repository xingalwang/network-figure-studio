import { useWorkbench } from './context.tsx';
import { Header } from './Header.tsx';
import { CommandRibbon } from './CommandRibbon.tsx';
import { ModelPanel } from './ModelPanel.tsx';
import { CanvasWorkspace } from './CanvasWorkspace.tsx';
import { PropertiesPanel } from './PropertiesPanel.tsx';
import { StatusBar } from './StatusBar.tsx';
import { ExportDialog } from '../ExportDialog.tsx';
export function Workbench() {
  const { persistence, inspectorOpen, doc, state, exportOpen, setExportOpen, setError } =
    useWorkbench();
  return (
    <main
      inert={persistence.busy}
      className={`studio workbench ${inspectorOpen ? '' : 'inspector-hidden'}`}
    >
      <Header />
      <CommandRibbon />
      <ModelPanel />
      <CanvasWorkspace />
      <PropertiesPanel />
      <StatusBar />
      {exportOpen && (
        <ExportDialog
          doc={doc}
          selection={state.selection}
          onClose={() => setExportOpen(false)}
          onError={setError}
        />
      )}
    </main>
  );
}
