import { useEditor } from './useEditor.ts';
import { WorkbenchContext } from '../workbench/context.tsx';
import { Workbench } from '../workbench/Workbench.tsx';

export function Editor(props: Parameters<typeof useEditor>[0]) {
  const editor = useEditor(props);
  return (
    <WorkbenchContext value={editor}>
      <Workbench />
    </WorkbenchContext>
  );
}
