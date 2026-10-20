import { createProject } from '../../core/document/codec.ts';
import { Icon } from '../Icons.tsx';
import { PrimitiveLibrary } from '../../workspaces/generator/PrimitiveLibrary.tsx';
import { TensorLibrary } from '../../workspaces/generator/TensorLibrary.tsx';
import { TreeItem } from '../../workspaces/shared/ObjectTree.tsx';
import { openProject } from '../../persistence/project-files.ts';
import { useWorkbench } from './context.tsx';
export function ModelPanel() {
  const {
    store,
    session,
    doc,
    state,
    registry,
    setError,
    enterBuild,
    enterLegacy,
    select,
    isLegacy,
    isBuild,
    isTensor,
    enterTensor,
    input,
    switchProject,
    add,
    addTensor,
    save,
  } = useWorkbench();
  return (
    <aside className="left-panel">
      <div className="panel-heading">
        <h2>
          {state.workspace === 'generator'
            ? isTensor
              ? '模型结构'
              : isBuild
                ? '基元库'
                : '组合示例'
            : '对象'}
        </h2>
        <button
          className="icon-button"
          title="新建工程"
          aria-label="新建工程"
          onClick={() => switchProject(createProject('未命名架构图', 2), 'new')}
        >
          <Icon name="plus" />
        </button>
      </div>
      {isTensor ? (
        <TensorLibrary
          doc={doc}
          selection={state.selection}
          onSelect={(ids) => select(ids, true)}
          onAdd={(dimension = 3) => void addTensor(undefined, dimension)}
          disabled={store.isReadonly()}
        />
      ) : isBuild ? (
        <PrimitiveLibrary
          registry={registry}
          doc={doc}
          selection={state.selection}
          onSelect={(ids) => session.select(ids)}
          onAdd={(id) => void add(id)}
          disabled={store.isReadonly()}
        />
      ) : isLegacy ? (
        <>
          <div className="library-caption">生成结构，再自由绘制</div>
          <div className="library-list">
            {[...registry.generators.values()]
              .filter((g) => !registry.primitives.has(g.id) && !g.id.startsWith('tensor.'))
              .map((g) => (
                <button
                  key={g.id}
                  className={`library-item ${state.generatorId === g.id ? 'selected' : ''}`}
                  onClick={() => session.chooseGenerator(g.id)}
                >
                  <span
                    className={`component-icon ${g.id.includes('relu') ? 'amber' : g.id.includes('output') ? 'lavender' : ''}`}
                  >
                    <Icon
                      name={g.id.includes('relu') || g.id.includes('add') ? 'flat' : 'cube'}
                      size={22}
                    />
                  </span>
                  <span>
                    <strong>{g.name}</strong>
                    <small>{g.id === 'example.residual' ? '示例插件' : '基础组件'}</small>
                  </span>
                  {state.generatorId === g.id && <span className="active-dot" />}
                </button>
              ))}
          </div>
        </>
      ) : (
        <div className="object-tree">
          {!Object.keys(doc.entities).length ? (
            <p className="empty-note">
              画布还很安静。
              <br />
              从生成工作区放入第一个组件。
            </p>
          ) : (
            Object.values(doc.entities)
              .filter((e) => e.parentId === null)
              .map((e) => (
                <TreeItem
                  key={e.id}
                  entity={e}
                  doc={doc}
                  selection={state.selection}
                  onSelect={(ids) => session.select(ids)}
                />
              ))
          )}
        </div>
      )}
      <div className="library-footer">
        <button
          className="text-button"
          onClick={() => {
            if (isTensor) enterBuild();
            else enterTensor();
          }}
        >
          {isTensor ? '自由基元' : '张量搭建'}
        </button>
        <div className="plugin-note">
          <Icon name="plugin" />
          <div>
            <strong>开放插件接口</strong>
            <small>基元 + 连接模式</small>
          </div>
          <span className="tag">已载入</span>
        </div>
        <button className="text-button" onClick={() => enterLegacy()}>
          兼容组合示例
        </button>
        <button className="text-button" onClick={() => input.current?.click()}>
          <Icon name="folder" />
          打开工程
        </button>
        <button className="text-button" onClick={() => save(true)}>
          <Icon name="download" />
          下载工程副本
        </button>
        <input
          type="file"
          hidden
          accept=".json,.nnfig.json"
          data-testid="open-project"
          ref={input}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              const result = await openProject(f);
              if (result.ok) await switchProject(result.value);
              else setError(result.error.message);
            }
            e.target.value = '';
          }}
        />
      </div>
    </aside>
  );
}
