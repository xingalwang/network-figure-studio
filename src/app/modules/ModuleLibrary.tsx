import { useState } from 'react';
import { Icon } from '../Icons.tsx';
import { useWorkbench } from '../workbench/context.tsx';
import { ParameterForm } from '../../workspaces/generator/ParameterForm.tsx';
import type { ModuleEntry } from './catalog.ts';
import { useModules } from './preferences.tsx';

const categories = [
  ['data', '数据基元'],
  ['operation', '运算'],
  ['connection', '连接方式'],
  ['primitive', '自由绘图'],
  ['preset', '组合样例'],
] as const;

function ConnectionEntry({ entry }: { entry: ModuleEntry }) {
  const { registry, applyConnectionPattern, connectionCapability } = useWorkbench();
  const pattern = registry.connectionPatterns.get(entry.id)!;
  const [params, setParams] = useState(pattern.defaults);
  const capability = connectionCapability(entry.id);
  return (
    <div className="module-connection">
      <button
        className="module-tool"
        title={capability.reason ?? entry.description}
        disabled={!capability.available}
        onClick={() => void applyConnectionPattern(entry.id, params)}
      >
        <Icon name={entry.icon} />
        <strong>{entry.name}</strong>
        <span className="module-tool-end" aria-hidden="true">
          {capability.available ? '↗' : '—'}
        </span>
        {!capability.available && <span className="sr-only">{capability.reason}</span>}
      </button>
      {pattern.fields.length > 0 && (
        <details className="module-connection-settings">
          <summary>连接设置</summary>
          <ParameterForm fields={pattern.fields} params={params} onChange={setParams} />
        </details>
      )}
    </div>
  );
}
function CreationEntry({ entry }: { entry: ModuleEntry }) {
  const {
    store,
    selectedTensors,
    addTensor,
    add,
    beginOperation,
    enterLegacy,
    operationCapability,
  } = useWorkbench();
  const capability =
    entry.kind === 'operation'
      ? operationCapability(entry.id)
      : { available: !store.isReadonly(), reason: store.isReadonly() ? '当前工程只读。' : null };
  const disabled = !capability.available;
  const draggable = entry.kind === 'data' || entry.kind === 'primitive';
  return (
    <button
      className="module-tool"
      aria-label={
        entry.kind === 'data'
          ? `添加${entry.dimension}D数据块`
          : entry.kind === 'primitive'
            ? `添加${entry.name}`
            : `使用${entry.name}`
      }
      title={capability.reason ?? entry.description}
      disabled={disabled}
      draggable={draggable && !disabled}
      onDragStart={(event) => {
        if (entry.kind === 'data')
          event.dataTransfer.setData('application/x-nn-tensor', `source${entry.dimension}d`);
        else if (entry.kind === 'primitive')
          event.dataTransfer.setData('application/x-nn-primitive', entry.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => {
        if (entry.kind === 'data') void addTensor(undefined, entry.dimension);
        else if (entry.kind === 'primitive') void add(entry.id);
        else if (entry.kind === 'operation') beginOperation(entry.id, selectedTensors);
        else if (entry.kind === 'preset') enterLegacy(entry.id);
      }}
    >
      <Icon name={entry.icon} size={17} />
      <strong>{entry.name}</strong>
      <span className="module-tool-end" aria-hidden="true">
        {disabled ? '—' : '+'}
      </span>
      {disabled && <span className="sr-only">{capability.reason}</span>}
    </button>
  );
}
export function ModuleLibrary() {
  const { modules, enabledIds, openSettings } = useModules();
  const { selectedTensors, state } = useWorkbench();
  const [query, setQuery] = useState('');
  const visible = modules.filter((module) => enabledIds.includes(module.id));
  const matches = (entry: ModuleEntry) =>
    (state.workspace === 'generator' ||
      entry.kind === 'primitive' ||
      entry.kind === 'connection') &&
    `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  return (
    <>
      <label className="model-search">
        <Icon name="search" size={16} />
        <input
          aria-label="搜索模块"
          placeholder="搜索模块…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="module-selection-hint">
        {selectedTensors.length && state.workspace === 'generator'
          ? `已选 ${selectedTensors.length} 个数据块`
          : state.workspace === 'drawing'
            ? '图稿工具'
            : '组装工具'}
        <span title="不可用工具的具体原因可悬停查看。">不可用工具悬停查看原因</span>
      </div>
      <div className="module-library-scroll">
        {visible.map((module) => {
          const entries = module.entries.filter(matches);
          if (!entries.length) return null;
          return (
            <details className="module-group" key={module.id} open>
              <summary>
                <Icon name="plugin" size={15} />
                <strong>{module.name}</strong>
                <span>{entries.length}</span>
              </summary>
              {categories.map(([kind, label]) => {
                const list = entries.filter((entry) => entry.kind === kind);
                return !list.length ? null : (
                  <details
                    className="module-category"
                    key={kind}
                    open={
                      !!query ||
                      kind === 'data' ||
                      kind === 'operation' ||
                      state.workspace === 'drawing'
                    }
                  >
                    <summary>
                      {label}
                      <span>{list.length}</span>
                    </summary>
                    {list.map((entry) =>
                      entry.kind === 'connection' ? (
                        <ConnectionEntry entry={entry} key={entry.id} />
                      ) : (
                        <CreationEntry entry={entry} key={entry.id} />
                      ),
                    )}
                  </details>
                );
              })}
            </details>
          );
        })}
        {!visible.length && (
          <div className="empty-note">
            <p>尚未选择模块。</p>
            <button className="text-button" onClick={openSettings}>
              选择模块
            </button>
          </div>
        )}
        {!!visible.length && !visible.some((module) => module.entries.some(matches)) && (
          <p className="empty-note">没有适用或匹配的模块。</p>
        )}
      </div>
    </>
  );
}
