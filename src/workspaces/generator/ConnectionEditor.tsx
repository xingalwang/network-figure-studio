import { useState } from 'react';
import type { DocumentStore, Entity, ProjectDocument } from '../../core/document/types.ts';
import {
  connectionTargets,
  planConnection,
  type ConnectionWorkspace,
} from '../../core/figure/connections.ts';
export function ConnectionEditor({
  doc,
  source,
  store,
  onError,
  workspace,
}: {
  doc: ProjectDocument;
  source: Entity;
  store: DocumentStore;
  onError: (message: string) => void;
  workspace: ConnectionWorkspace;
}) {
  const [targetId, setTargetId] = useState(''),
    [sourcePort, setSourcePort] = useState(() =>
      source.kind !== 'edge'
        ? Object.hasOwn(source.ports, 'out')
          ? 'out'
          : (Object.keys(source.ports)[0] ?? '')
        : '',
    ),
    [targetPort, setTargetPort] = useState('');
  if (source.kind === 'edge') return null;
  const choices = connectionTargets(doc, source.id, workspace);
  const target = choices.find((entity) => entity.id === targetId);
  const port = Object.hasOwn(source.ports, sourcePort) ? sourcePort : '';
  const inPort = target && Object.hasOwn(target.ports, targetPort) ? targetPort : '';
  const disabled = store.isReadonly();
  const add = async () => {
    const current = store.getSnapshot();
    const plan = planConnection(current, source.id, sourcePort, targetId, targetPort, workspace);
    if (!plan.ok) {
      onError(plan.error.message);
      return;
    }
    const result = await store.dispatch({ baseRevision: current.revision, operations: plan.value });
    if (!result.ok) onError(result.error.message);
  };
  return (
    <details className="form-section connection-editor">
      <summary>从此基元连接</summary>
      <label className="field">
        <span>输出端口</span>
        <select
          aria-label="输出端口"
          value={port}
          disabled={disabled}
          onChange={(e) => setSourcePort(e.target.value)}
        >
          {!port && <option value="">请选择有效端口…</option>}
          {Object.keys(source.ports).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="stacked">
        <span>目标基元</span>
        <select
          aria-label="目标基元"
          value={target?.id ?? ''}
          disabled={disabled}
          onChange={(e) => {
            setTargetId(e.target.value);
            const entity = choices.find((candidate) => candidate.id === e.target.value);
            setTargetPort(
              entity
                ? Object.hasOwn(entity.ports, 'in')
                  ? 'in'
                  : (Object.keys(entity.ports)[0] ?? '')
                : '',
            );
          }}
        >
          <option value="">选择目标…</option>
          {choices.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>输入端口</span>
        <select
          aria-label="输入端口"
          value={inPort}
          disabled={disabled || !target}
          onChange={(e) => setTargetPort(e.target.value)}
        >
          {!inPort && <option value="">请选择有效端口…</option>}
          {target && Object.keys(target.ports).map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <button
        className="secondary full"
        disabled={
          disabled || !target || !port || !inPort || source.generation?.source.kind === 'slot'
        }
        onClick={() => void add()}
      >
        添加连接
      </button>
    </details>
  );
}
