import { useState } from 'react';
import { Icon } from '../../app/Icons.tsx';
import type { StructureBranch } from './model-tree.ts';

export function ComputationTree({
  branches,
  selection,
  onSelect,
  depth = 0,
}: {
  branches: StructureBranch[];
  selection: string[];
  onSelect: (ids: string[]) => void;
  depth?: number;
}) {
  return (
    <>
      {branches.map((branch) => (
        <Branch
          key={branch.entity.id}
          branch={branch}
          selection={selection}
          onSelect={onSelect}
          depth={depth}
        />
      ))}
    </>
  );
}
function Branch({
  branch,
  selection,
  onSelect,
  depth,
}: {
  branch: StructureBranch;
  selection: string[];
  onSelect: (ids: string[]) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  const { entity, children } = branch;
  return (
    <>
      <div
        className={`tree-row ${selection.includes(entity.id) ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        <button
          className={`tree-toggle ${open ? 'expanded' : ''}`}
          disabled={!children.length}
          aria-label={`展开 ${entity.name}`}
          aria-expanded={children.length ? open : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="chevron" size={12} />
        </button>
        <button
          className="tree-name"
          data-entity-id={entity.id}
          onClick={(event) =>
            onSelect(
              event.shiftKey
                ? selection.includes(entity.id)
                  ? selection.filter((id) => id !== entity.id)
                  : [...selection, entity.id]
                : [entity.id],
            )
          }
        >
          <Icon name={entity.semantic?.role === 'operation' ? 'convolution' : 'cube'} size={15} />
          <span>{entity.presentation.labelOverride ?? entity.name}</span>
        </button>
      </div>
      {open && (
        <ComputationTree
          branches={children}
          selection={selection}
          onSelect={onSelect}
          depth={depth + 1}
        />
      )}
    </>
  );
}
