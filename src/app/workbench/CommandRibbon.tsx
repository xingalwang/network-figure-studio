import { Icon } from '../Icons.tsx';
import { useWorkbench } from './context.tsx';
import { tensorDimension, listAvailableOperations } from '../../core/computation/index.ts';
import { semanticTarget } from '../../core/figure/index.ts';
import type { ReactNode } from 'react';
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
  action,
}: {
  label: string;
  icon: string;
  disabled?: boolean;
  action: () => void;
}) {
  return (
    <button className="ribbon-command" disabled={disabled} onClick={action}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
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
    addTensor,
    beginOperation,
    hasTensors,
    hasPlacedTensors,
    placeFigure,
    layout,
    setTool,
    tool,
    isLegacy,
    setExportOpen,
    hasDrawing,
  } = useWorkbench();
  const one = selectedTensors.length === 1;
  const dimension = one
    ? tensorDimension(doc.entities[selectedTensors[0]], registry.computations)
    : 3;
  const readonly = store.isReadonly();
  const available = new Set(
    listAvailableOperations(doc, selectedTensors, registry.computations).map((d) => d.generatorId),
  );
  const operations = [...registry.computations.values()].filter(
    (d) =>
      d.operation &&
      (d.operation.dimensions.length > 1 || d.operation.dimensions.includes(dimension ?? 3)),
  );
  const source = selected && semanticTarget(doc, selected.id);
  return (
    <nav
      className="command-ribbon"
      role="toolbar"
      aria-label={state.workspace === 'generator' ? '生成命令带' : '绘图命令带'}
    >
      <Group label="数据">
        <Command
          label="3D 数据"
          icon="cube"
          disabled={readonly}
          action={() => void addTensor(undefined, 3)}
        />
        <Command
          label="2D 数据"
          icon="flat"
          disabled={readonly}
          action={() => void addTensor(undefined, 2)}
        />
      </Group>
      {(['运算', '合并'] as const).map((category) => (
        <Group key={category} label={category}>
          {operations
            .filter((d) => d.operation!.category === category)
            .map((definition) => (
              <Command
                key={definition.generatorId}
                label={definition.operation!.label}
                icon={definition.operation!.icon}
                disabled={readonly || !available.has(definition.generatorId)}
                action={() => beginOperation(definition.generatorId, selectedTensors)}
              />
            ))}
        </Group>
      ))}
      <Group label="编辑">
        <Command label="选择" icon="cursor" action={() => setTool('select')} />
        <Command
          label="连线"
          icon="arrow"
          disabled={isLegacy || readonly}
          action={() => setTool('connect')}
        />
        <Command
          label="整理"
          icon="align"
          disabled={!Object.keys(doc.entities).length || readonly || state.workspace === 'drawing'}
          action={() => void layout()}
        />
      </Group>
      <Group label="图稿">
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
          label={hasPlacedTensors ? '更新图稿' : '加入图稿'}
          icon="panel"
          disabled={!hasTensors || readonly}
          action={() => void placeFigure()}
        />
        <Command
          label="导出图稿"
          icon="download"
          disabled={!hasDrawing}
          action={() => setExportOpen(true)}
        />
      </Group>
    </nav>
  );
}
