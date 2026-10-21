import { useState } from 'react';
import { Tabs, IconButton } from '../../ui/controls.tsx';
import { isFigureEntity, isStructureEntity } from '../../core/figure/index.ts';
import { Icon } from '../Icons.tsx';
import { TreeItem } from '../../workspaces/shared/ObjectTree.tsx';
import { ComputationTree } from '../../workspaces/generator/ComputationTree.tsx';
import { buildStructureForest } from '../../workspaces/generator/model-tree.ts';
import { useWorkbench } from './context.tsx';
import { ModuleLibrary } from '../modules/ModuleLibrary.tsx';
import { useModules } from '../modules/preferences.tsx';

function ProjectStructure() {
  const { doc, state, select } = useWorkbench();
  const [query, setQuery] = useState('');
  const drawing = state.workspace === 'drawing';
  const entities = Object.values(doc.entities).filter((entity) =>
    drawing ? isFigureEntity(doc, entity) : isStructureEntity(doc, entity),
  );
  const matches = entities.filter((entity) =>
    (entity.kind === 'edge' ? entity.name : (entity.presentation.labelOverride ?? entity.name))
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const roots = entities.filter((entity) => entity.parentId === null);
  return (
    <>
      <label className="model-search">
        <Icon name="search" size={16} />
        <input
          aria-label="搜索结构"
          placeholder="搜索工程对象…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="module-selection-hint">
        {drawing ? '图稿对象' : '计算结构与自由基元'} · {entities.length} 个对象
      </div>
      <div className="object-tree module-structure-tree">
        {!query && !drawing && (
          <ComputationTree
            branches={buildStructureForest(doc)}
            selection={state.selection}
            onSelect={(ids) => select(ids, true)}
          />
        )}
        {(query
          ? matches
          : roots.filter((entity) => drawing || entity.kind !== 'node' || !entity.semantic)
        ).map((entity) => (
          <TreeItem
            key={entity.id}
            entity={entity}
            doc={doc}
            selection={state.selection}
            onSelect={(ids) => select(ids, true)}
          />
        ))}
        {!matches.length && (
          <p className="empty-note">{query ? '没有匹配的对象。' : '从模块库添加第一个对象。'}</p>
        )}
      </div>
    </>
  );
}
export function ModelPanel() {
  const { input } = useWorkbench();
  const { openSettings } = useModules();
  const [tab, setTab] = useState<'library' | 'structure'>('library');
  return (
    <aside className="left-panel module-panel">
      <div className="panel-heading">
        <h2>工作台</h2>
        <IconButton label="管理模块" title="选择工作台模块" onClick={openSettings}>
          <Icon name="plugin" />
        </IconButton>
      </div>
      <Tabs
        className="library-tabs"
        label="左侧面板"
        value={tab}
        items={[
          { value: 'library', label: '模块库' },
          { value: 'structure', label: '工程结构' },
        ]}
        onChange={setTab}
      />
      {tab === 'library' ? <ModuleLibrary /> : <ProjectStructure />}
      <div className="module-panel-footer">
        <button className="text-button" onClick={openSettings}>
          <Icon name="plugin" size={15} />
          管理模块
        </button>
        <button className="text-button" onClick={() => input.current?.click()}>
          <Icon name="folder" size={15} />
          打开工程
        </button>
      </div>
    </aside>
  );
}
