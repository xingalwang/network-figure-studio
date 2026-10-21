import { createContext, useContext } from 'react';
import type { WorkbenchModule } from './catalog.ts';

type ModulePreferences = {
  modules: WorkbenchModule[];
  enabledIds: string[];
  setEnabledIds: (ids: readonly string[]) => void;
  openSettings: () => void;
};
export const ModulePreferencesContext = createContext<ModulePreferences | null>(null);
export function useModules() {
  const value = useContext(ModulePreferencesContext);
  if (!value) throw Error('Module tools require ModulePreferencesProvider.');
  return value;
}
