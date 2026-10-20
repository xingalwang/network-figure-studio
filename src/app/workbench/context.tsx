import { createContext, useContext } from 'react';
import type { EditorController } from '../editor/controller.ts';
export const WorkbenchContext = createContext<EditorController | null>(null);
export function useWorkbench() {
  const value = useContext(WorkbenchContext);
  if (!value) throw Error('Workbench components require an editor.');
  return value;
}
