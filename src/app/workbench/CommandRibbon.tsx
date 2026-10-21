import { Icon } from '../Icons.tsx';
import { IconButton } from '../../ui/controls.tsx';
import { useWorkbench } from './context.tsx';
import { semanticTarget } from '../../core/figure/index.ts';
import type { ReactNode } from 'react';
import { useModules } from '../modules/preferences.tsx';

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ribbon-group">
      <div className="ribbon-tools">{children}</div>
      <span className="ribbon-label">{label}</span>
    </div>
  );
}
function Command({
  label,
  icon,
  disabled,
  pressed,
  action,
  reason,
  primary,
  count,
}: {
  label: string;
  icon: string;
  disabled?: boolean;
  pressed?: boolean;
  action: () => void;
  reason?: string | null;
  primary?: boolean;
  count?: number;
}) {
  return (
    <button
      className={`ribbon-command ${primary ? 'build-command' : ''}`}
      aria-label={label}
      title={reason ?? label}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={action}
    >
      <Icon name={icon} size={19} />
      <span>
        {label}
        {!!count && <b className="command-count">{count}</b>}
      </span>
    </button>
  );
}
export function CommandRibbon() {
  const {
    store,
    registry,
    selected,
    addAnnotation,
    addRepresentation,
    doc,
    state,
    selectedTensors,
    beginOperation,
    hasTensors,
    hasPlacedTensors,
    placeFigure,
    layout,
    setTool,
    tool,
    isLegacy,
    canDistribute,
    distribute,
    buildStructure,
    structureDraftCount,
    building,
    operationCapability,
    inspectorOpen,
    setInspectorOpen,
  } = useWorkbench();
  const { modules, enabledIds } = useModules();
  const readonly = store.isReadonly();
  const drawing = state.workspace === 'drawing';
  const mergeOperations = [...registry.computations.values()].filter(
    (definition) =>
      definition.operation?.category === '合并' &&
      modules.some(
        (module) =>
          enabledIds.includes(module.id) &&
          module.entries.some(
            (entry) => entry.kind === 'operation' && entry.id === definition.generatorId,
          ),
      ),
  );
  const source = selected && semanticTarget(doc, selected.id);
  return (
    <nav
      className="command-ribbon"
      role="toolbar"
      aria-label={drawing ? '图稿通用工具' : '组装通用工具'}
    >
      <Group label="通用编辑">
        <Command
          label="撤销"
          icon="undo"
          disabled={!store.canUndo()}
          action={() => void store.undo()}
        />
        <Command
          label="重做"
          icon="redo"
          disabled={!store.canRedo()}
          action={() => void store.redo()}
        />
        <Command
          label="选择"
          icon="cursor"
          pressed={tool === 'select'}
          action={() => setTool('select')}
        />
        <Command
          label="连线"
          icon="arrow"
          pressed={tool === 'connect'}
          disabled={isLegacy || readonly}
          action={() => setTool('connect')}
          reason="自由基元和图稿端口连线；计算数据使用适用运算。"
        />
      </Group>
      <Group label={structureDraftCount ? `${structureDraftCount} 项待构建` : '结构参数'}>
        <Command
          label={building ? '正在构建…' : '构建'}
          icon="layers"
          primary
          count={structureDraftCount}
          disabled={readonly || building || !structureDraftCount}
          action={() => void buildStructure()}
          reason="统一提交全部待应用的结构参数。"
        />
      </Group>
      <Group label={drawing ? '图稿编辑' : '组装操作'}>
        {!drawing &&
          mergeOperations.map((definition) => {
            const capability = operationCapability(definition.generatorId);
            return (
              <Command
                key={definition.generatorId}
                label={definition.operation!.label}
                icon={definition.operation!.icon}
                disabled={!capability.available}
                reason={capability.reason}
                action={() => beginOperation(definition.generatorId, selectedTensors)}
              />
            );
          })}
        {drawing ? (
          <>
            <Command
              label="独立标注"
              icon="text"
              disabled={readonly}
              action={() => void addAnnotation()}
            />
            <Command
              label="新增图稿表示"
              icon="copy"
              disabled={readonly || !source}
              action={() => source && void addRepresentation(source.id)}
            />
            <Command
              label="等距排布"
              icon="align"
              disabled={!canDistribute || readonly}
              action={() => void distribute()}
            />
          </>
        ) : (
          <Command
            label="整理"
            icon="align"
            disabled={!Object.keys(doc.entities).length || readonly}
            action={() => void layout()}
          />
        )}
      </Group>
      <Group label="结构 → 图稿">
        <Command
          label={hasPlacedTensors ? '更新图稿' : '加入图稿'}
          icon="panel"
          disabled={!hasTensors || readonly}
          action={() => void placeFigure()}
          reason="更新计算内容并保留图稿手工表现。"
        />
      </Group>
      <div className="ribbon-view-tools">
        <IconButton
          className={inspectorOpen ? 'active' : ''}
          label="切换属性面板"
          title={inspectorOpen ? '收起信息栏' : '展开信息栏'}
          aria-pressed={inspectorOpen}
          onClick={() => setInspectorOpen(!inspectorOpen)}
        >
          <Icon name="panel" />
        </IconButton>
      </div>
    </nav>
  );
}
