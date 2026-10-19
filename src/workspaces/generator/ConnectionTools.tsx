import { useState } from 'react';
import type { DocumentStore, ProjectDocument } from '../../core/document/types.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import { executeConnectionPattern } from '../../plugins/connections.ts';
import { ParameterForm } from './ParameterForm.tsx';
export function ConnectionTools({
  doc,
  store,
  registry,
  selection,
  onError,
  onSuccess,
}: {
  doc: ProjectDocument;
  store: DocumentStore;
  registry: PluginRegistry;
  selection: string[];
  onError: (message: string) => void;
  onSuccess: () => void;
}) {
  const [id, setId] = useState('builtin.chain'),
    pattern = registry.connectionPatterns.get(id)!,
    [params, setParams] = useState(pattern.defaults);
  let available = false;
  try {
    available = pattern.isAvailable(doc, selection);
  } catch {}
  return (
    <div className="connection-tools">
      <select
        aria-label="连接模式"
        value={id}
        onChange={(e) => {
          setId(e.target.value);
          setParams(registry.connectionPatterns.get(e.target.value)!.defaults);
        }}
      >
        {[...registry.connectionPatterns.values()].map((p) => (
          <option value={p.id} key={p.id}>
            {p.name}
            {p.id.startsWith('example.') ? ' · 插件' : ''}
          </option>
        ))}
      </select>
      {pattern.fields.length > 0 && (
        <details>
          <summary>设置</summary>
          <ParameterForm fields={pattern.fields} params={params} onChange={setParams} />
        </details>
      )}
      <button
        className="toolbar-button"
        title={pattern.description}
        aria-label="应用连接方式"
        disabled={store.isReadonly() || !available}
        onClick={async () => {
          const r = await executeConnectionPattern(store, registry, id, selection, params);
          if (!r.ok) onError(r.error.message);
          else onSuccess();
        }}
      >
        连接所选
      </button>
    </div>
  );
}
