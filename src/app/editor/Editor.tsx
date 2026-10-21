import type { EditorOptions } from './controller.ts';
import { useEditor } from './useEditor.ts';
import { WorkbenchContext } from '../workbench/context.tsx';
import { Workbench } from '../workbench/Workbench.tsx';
import { WelcomePage } from '../home/WelcomePage.tsx';

export function Editor(props: EditorOptions) {
  const editor = useEditor(props);
  return (
    <WorkbenchContext value={editor}>
      <Workbench />
      <input
        type="file"
        hidden
        accept=".json,.nnfig.json"
        data-testid="open-project"
        ref={editor.input}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) await editor.openProjectFile(file);
        }}
      />
      {editor.homeOpen && <WelcomePage />}
    </WorkbenchContext>
  );
}
