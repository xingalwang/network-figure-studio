import { useState } from 'react';
import type { NodeEntity, ProjectDocument } from '../../core/document/types.ts';
import { Icon } from '../../app/Icons.tsx';
import { TreeItem } from '../shared/ObjectTree.tsx';
import { ComputationTree } from './ComputationTree.tsx';
import { buildStructureForest } from './model-tree.ts';

export function TensorLibrary({
  doc,
  selection,
  onSelect,
  onAdd,
  disabled,
}: {
  doc: ProjectDocument;
  selection: string[];
  onSelect: (ids: string[]) => void;
  onAdd: (dimension?: 2 | 3) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const nodes = Object.values(doc.entities).filter(
    (e): e is NodeEntity => e.kind === 'node' && !!e.semantic,
  );
  const visible = nodes.filter((e) =>
    (e.presentation.labelOverride ?? e.name)
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <label className="model-search">
        <Icon name="search" size={16} />
        <input
          aria-label="搜索结构"
          placeholder="搜索节点…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="tensor-tree-heading">
        <h3>结构</h3>
        <span>{nodes.length} 个对象</span>
      </div>
      <div className="object-tree tensor-object-tree">
        {!query && (
          <ComputationTree
            branches={buildStructureForest(doc)}
            selection={selection}
            onSelect={onSelect}
          />
        )}
        {(query ? visible : []).map((entity) => (
          <TreeItem
            key={entity.id}
            entity={entity}
            doc={doc}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
        {!visible.length && (
          <p className="empty-note">
            {query ? '没有匹配的对象。' : '从下方拖入数据，或使用顶部命令。'}
          </p>
        )}
      </div>
      <div className="tensor-tree-heading">
        <h3>数据基元</h3>
        <span>拖入或点击</span>
      </div>
      <div className="tensor-source-list">
        {([3, 2] as const).map((dimension) => (
          <button
            key={dimension}
            className="tensor-source-card"
            aria-label={`添加${dimension}D数据块`}
            disabled={disabled}
            draggable={!disabled}
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-nn-tensor', `source${dimension}d`);
              event.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => onAdd(dimension)}
          >
            <Icon name={dimension === 3 ? 'cube' : 'flat'} size={18} />
            <span>
              <strong>{dimension}D 数据</strong>
              <small>{dimension === 3 ? 'D × H × W' : 'H × W'} · C</small>
            </span>
            <Icon name="plus" size={14} />
          </button>
        ))}
      </div>
    </>
  );
}
