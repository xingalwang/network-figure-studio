import { useState } from 'react';
import type { Entity, ProjectDocument } from '../../core/document/types.ts';
import { Icon } from '../../app/Icons.tsx';
export function TreeItem({
  entity,
  doc,
  selection,
  onSelect,
  depth = 0,
}: {
  entity: Entity;
  doc: ProjectDocument;
  selection: string[];
  onSelect: (ids: string[]) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true),
    children = Object.values(doc.entities).filter((e) => e.parentId === entity.id);
  return (
    <>
      <div
        className={`tree-row ${selection.includes(entity.id) ? 'selected' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
      >
        <button
          className={`tree-toggle ${expanded ? 'expanded' : ''}`}
          aria-label={`展开 ${entity.name}`}
          disabled={!children.length}
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon name="chevron" size={12} />
        </button>
        <button
          className="tree-name"
          data-entity-id={entity.id}
          onClick={(e) =>
            onSelect(
              e.shiftKey
                ? selection.includes(entity.id)
                  ? selection.filter((id) => id !== entity.id)
                  : [...selection, entity.id]
                : [entity.id],
            )
          }
        >
          <Icon
            name={entity.kind === 'edge' ? 'arrow' : entity.kind === 'group' ? 'folder' : 'cube'}
            size={16}
          />
          <span>
            {entity.kind === 'edge'
              ? (entity.label ?? entity.name)
              : (entity.presentation.labelOverride ?? entity.name)}
          </span>
        </button>
      </div>
      {expanded &&
        children.map((e) => (
          <TreeItem
            key={e.id}
            entity={e}
            doc={doc}
            selection={selection}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ))}
    </>
  );
}
