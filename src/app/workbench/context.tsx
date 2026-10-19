import { createContext, useContext } from 'react';
import type { useEditor } from '../editor/useEditor.ts';
export type WorkbenchController = ReturnType<typeof useEditor>;
export const WorkbenchContext = createContext<WorkbenchController | null>(null);
export function useWorkbench() {
  const value = useContext(WorkbenchContext);
  if (!value) throw Error('Workbench components require an editor.');
  return value;
}
