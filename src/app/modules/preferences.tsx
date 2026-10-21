import { useMemo, useState, type ReactNode } from 'react';
import type { PluginRegistry } from '../../plugins/registry.ts';
import { buildModuleCatalog, type WorkbenchModule } from './catalog.ts';
import { ModulePicker } from './ModulePicker.tsx';
import './module-library.css';
import { ModulePreferencesContext } from './context.tsx';
export { useModules } from './context.tsx';

export const MODULE_PREFERENCES_KEY = 'nnfig.workbench-modules.v1';
export function normalizeModuleSelection(
  ids: readonly string[],
  modules: readonly WorkbenchModule[],
) {
  const chosen = new Set(ids);
  return modules.filter((module) => chosen.has(module.id)).map((module) => module.id);
}
export function decodeModuleSelection(
  raw: string | null,
  modules: readonly WorkbenchModule[],
): string[] {
  const defaults = modules.map((module) => module.id);
  if (!raw) return defaults;
  try {
    const value = JSON.parse(raw) as { knownIds?: unknown; enabledIds?: unknown };
    if (
      !Array.isArray(value.knownIds) ||
      !Array.isArray(value.enabledIds) ||
      [...value.knownIds, ...value.enabledIds].some((id) => typeof id !== 'string')
    )
      return defaults;
    const known = new Set(value.knownIds);
    return normalizeModuleSelection(
      [...value.enabledIds, ...defaults.filter((id) => !known.has(id))],
      modules,
    );
  } catch {
    return defaults;
  }
}
function readSelection(modules: readonly WorkbenchModule[]) {
  try {
    return decodeModuleSelection(localStorage.getItem(MODULE_PREFERENCES_KEY), modules);
  } catch {
    return modules.map((module) => module.id);
  }
}
export function ModulePreferencesProvider({
  registry,
  children,
}: {
  registry: PluginRegistry;
  children: ReactNode;
}) {
  const modules = useMemo(() => buildModuleCatalog(registry), [registry]);
  const [enabledIds, setSelection] = useState(() => readSelection(modules));
  const [open, setOpen] = useState(false);
  const setEnabledIds = (ids: readonly string[]) => {
    const next = normalizeModuleSelection(ids, modules);
    setSelection(next);
    try {
      localStorage.setItem(
        MODULE_PREFERENCES_KEY,
        JSON.stringify({ knownIds: modules.map((module) => module.id), enabledIds: next }),
      );
    } catch {
      /* A blocked preference store does not block editing. */
    }
  };
  return (
    <ModulePreferencesContext.Provider
      value={{ modules, enabledIds, setEnabledIds, openSettings: () => setOpen(true) }}
    >
      {children}
      {open && (
        <div
          className="modal-backdrop"
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'Tab') {
              const fields = [
                ...event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
                ),
              ];
              const first = fields[0],
                last = fields.at(-1);
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <section
            className="module-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="module-settings-title"
          >
            <div className="module-settings-heading">
              <h2 id="module-settings-title">工作台模块</h2>
              <button autoFocus aria-label="关闭模块设置" onClick={() => setOpen(false)}>
                关闭
              </button>
            </div>
            <p className="hint">
              选择左侧模块库显示的创建工具。工程中已有对象及其计算规则始终保留。
            </p>
            <ModulePicker />
            <button className="primary" onClick={() => setOpen(false)}>
              完成
            </button>
          </section>
        </div>
      )}
    </ModulePreferencesContext.Provider>
  );
}
