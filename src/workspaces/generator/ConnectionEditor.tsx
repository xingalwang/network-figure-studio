import { useState } from 'react';
import type {
  DocumentStore,
  Entity,
  ProjectDocument,
  EdgeEntity,
} from '../../core/document/types.ts';
export function ConnectionEditor({
  doc,
  source,
  store,
  onError,
}: {
  doc: ProjectDocument;
  source: Entity;
  store: DocumentStore;
  onError: (message: string) => void;
}) {
  const [targetId, setTargetId] = useState(''),
    [sourcePort, setSourcePort] = useState('out'),
    [targetPort, setTargetPort] = useState('in');
  if (source.kind === 'edge') return null;
  const target = doc.entities[targetId],
    choices = Object.values(doc.entities).filter(
      (e) => e.kind !== 'edge' && e.id !== source.id && e.parentId === null,
    ),
    disabled = store.isReadonly();
  const port = Object.hasOwn(source.ports, sourcePort) ? sourcePort : Object.keys(source.ports)[0];
  const inPort =
    target && target.kind !== 'edge' && Object.hasOwn(target.ports, targetPort)
      ? targetPort
      : target && target.kind !== 'edge'
        ? Object.keys(target.ports)[0]
        : '';
  const add = async () => {
    if (!target || target.kind === 'edge' || !port || !inPort) return;
    const current = store.getSnapshot();
    for (const id of [source.id, target.id]) {
      let node = current.entities[id];
      while (node.parentId) {
        node = current.entities[node.parentId];
        if (node.generation) {
          onError('旧组合内部由插件维护，请先解除组合生成关联。');
          return;
        }
      }
    }
    if (
      Object.values(current.entities).some(
        (e) =>
          e.kind === 'edge' &&
          e.source.kind === 'port' &&
          e.source.entityId === source.id &&
          e.source.portId === port &&
          e.target.kind === 'port' &&
          e.target.entityId === target.id &&
          e.target.portId === inPort,
      )
    ) {
      onError('这两个端口之间已有连接。');
      return;
    }
    const edge: EdgeEntity = {
      id: crypto.randomUUID(),
      kind: 'edge',
      parentId: null,
      name: '连接',
      source: { kind: 'port', entityId: source.id, portId: port },
      target: { kind: 'port', entityId: target.id, portId: inPort },
      route: { kind: 'orthogonal', mode: 'auto', points: [], spaceId: null },
      style: {
        color: current.theme.lineColor,
        width: current.theme.lineWidth ?? 1.5,
        dashed: false,
        arrow: true,
      },
    };
    const r = await store.dispatch({
      baseRevision: current.revision,
      operations: [{ kind: 'put', entity: edge }],
    });
    if (!r.ok) onError(r.error.message);
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
          {Object.keys(source.ports).map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="stacked">
        <span>目标基元</span>
        <select
          aria-label="目标基元"
          value={targetId}
          disabled={disabled}
          onChange={(e) => {
            setTargetId(e.target.value);
            setTargetPort('in');
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
          {target &&
            target.kind !== 'edge' &&
            Object.keys(target.ports).map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <button
        className="secondary full"
        disabled={disabled || !target || source.generation?.source.kind === 'slot'}
        onClick={() => void add()}
      >
        添加连接
      </button>
    </details>
  );
}
