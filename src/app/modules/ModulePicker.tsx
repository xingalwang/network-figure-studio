import { useModules } from './context.tsx';

export function ModulePicker() {
  const { modules, enabledIds, setEnabledIds } = useModules();
  return (
    <div className="module-picker">
      {modules.map((module) => (
        <label key={module.id} className="module-picker-card">
          <input
            type="checkbox"
            checked={enabledIds.includes(module.id)}
            onChange={(event) =>
              setEnabledIds(
                event.target.checked
                  ? [...enabledIds, module.id]
                  : enabledIds.filter((id) => id !== module.id),
              )
            }
          />
          <span>
            <strong>{module.name}</strong>
            <small>
              {module.entries.filter((entry) => entry.kind === 'data' || entry.kind === 'operation')
                .length
                ? '数据与运算'
                : '绘图与组合'}{' '}
              · {module.entries.length} 个模块
            </small>
          </span>
        </label>
      ))}
      {!enabledIds.length && <p className="hint">尚未选择模块，仍可打开和编辑已有工程。</p>}
    </div>
  );
}
