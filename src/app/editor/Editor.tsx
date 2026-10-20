import type { EditorOptions } from './controller.ts';
import { useEditor } from './useEditor.ts';
import { WorkbenchContext } from '../workbench/context.tsx';
import { Workbench } from '../workbench/Workbench.tsx';

export function Editor(props: EditorOptions) {
  const editor = useEditor(props);
  return (
    <WorkbenchContext value={editor}>
      <Workbench />
    </WorkbenchContext>
  );
}
