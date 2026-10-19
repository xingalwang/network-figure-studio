import { Icon } from '../Icons.tsx';
import { useWorkbench } from './context.tsx';
import { tensorDimension } from '../../core/computation/index.ts';
import type { TensorOperationDraft } from '../../workspaces/generator/TensorInspector.tsx';
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
    doc,
    state,
    selectedTensors,
    addTensor,
    beginOperation,
    hasTensors,
    hasPlacedTensors,
    placeFigure,
    setGeneratorMode,
    session,
    layout,
    setTool,
    tool,
    isLegacy,
    setExportOpen,
    hasDrawing,
  } = useWorkbench();
  const one = selectedTensors.length === 1;
  const dimension = one ? tensorDimension(doc.entities[selectedTensors[0]]) : 3;
  const readonly = store.isReadonly();
  const operation = (kind: TensorOperationDraft['kind']) => {
    setGeneratorMode('tensor');
    session.setWorkspace('generator');
    beginOperation(kind, selectedTensors);
  };
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
          action={() => {
            setGeneratorMode('tensor');
            void addTensor(undefined, 3);
          }}
        />
        <Command
          label="2D 数据"
          icon="flat"
          disabled={readonly}
          action={() => {
            setGeneratorMode('tensor');
            void addTensor(undefined, 2);
          }}
        />
      </Group>
      <Group label="运算">
        <Command
          label="卷积"
          icon="convolution"
          disabled={!one || readonly}
          action={() => operation(dimension === 2 ? 'conv2d' : 'conv3d')}
        />
        <Command
          label="池化"
          icon="pool"
          disabled={!one || readonly}
          action={() => operation(dimension === 2 ? 'pool2d' : 'pool3d')}
        />
        <Command
          label="激活"
          icon="activation"
          disabled={!one || readonly}
          action={() => operation('relu')}
        />
        <Command
          label="上采样"
          icon="upsample"
          disabled={!one || readonly}
          action={() => operation('upsample')}
        />
      </Group>
      <Group label="合并">
        <Command
          label="拼接"
          icon="concat"
          disabled={selectedTensors.length < 2 || readonly}
          action={() => operation('concat')}
        />
        <Command
          label="相加"
          icon="plus"
          disabled={selectedTensors.length < 2 || readonly}
          action={() => operation('add')}
        />
      </Group>
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
