import { useState } from 'react';
import type { ProjectDocument } from '../../core/document/types.ts';
import type { PluginRegistry } from '../../plugins/registry.ts';
import { TreeItem } from '../shared/ObjectTree.tsx';
import { Icon } from '../../app/Icons.tsx';
export function PrimitiveLibrary({
  registry,
  doc,
  selection,
  onSelect,
  onAdd,
  disabled,
}: {
  registry: PluginRegistry;
  doc: ProjectDocument;
  selection: string[];
  onSelect: (ids: string[]) => void;
  onAdd: (id: string) => void;
  disabled: boolean;
}) {
  const [tab, setTab] = useState<'library' | 'structure'>('library'),
    [search, setSearch] = useState('');
  const definitions = [...registry.primitives.values()].filter((p) =>
    [p.name, p.description, ...(p.keywords ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const categories = [...new Set(definitions.map((p) => p.category))];
  return (
    <>
      <div className="library-tabs">
        <button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>
          基元
        </button>
        <button className={tab === 'structure' ? 'active' : ''} onClick={() => setTab('structure')}>
          结构
        </button>
      </div>
      {tab === 'library' ? (
        <>
          <input
            className="primitive-search"
            aria-label="搜索基元"
            placeholder="搜索基元…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="library-list">
            {categories.map((category) => (
              <section key={category}>
                <h3 className="primitive-group-title">{category}</h3>
                {definitions
                  .filter((p) => p.category === category)
                  .map((p) => (
                    <button
                      className="library-item primitive-item"
                      key={p.id}
                      title={`${p.description} · 点击添加，也可拖入结构画布`}
                      aria-label={`添加${p.name}`}
                      disabled={disabled}
                      draggable={!disabled}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/x-nn-primitive', p.id);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => onAdd(p.id)}
                    >
                      <span className="component-icon">
                        <Icon name={p.icon ?? 'cube'} size={22} />
                      </span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.id.startsWith('builtin.') ? '基础基元' : '插件基元'}</small>
                      </span>
                      <Icon name="plus" size={14} />
                    </button>
                  ))}
              </section>
            ))}
            {!definitions.length && <p className="empty-note">没有匹配的基元。</p>}
          </div>
        </>
      ) : (
        <div className="object-tree">
          {Object.values(doc.entities)
            .filter((e) => e.parentId === null)
            .map((e) => (
              <TreeItem key={e.id} entity={e} doc={doc} selection={selection} onSelect={onSelect} />
            ))}
          {!Object.keys(doc.entities).length && (
            <p className="empty-note">从基元库添加第一个网络层。</p>
          )}
        </div>
      )}
    </>
  );
}
