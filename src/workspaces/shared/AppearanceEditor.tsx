import type { NodeEntity, Operation, ProjectDocument, Entity } from '../../core/document/types.ts';
import { nodeVisual } from '../../graphics/paint.ts';
import { ColorField, NumberField } from './StyleFields.tsx';
export function AppearanceEditor({
  entity,
  doc,
  commit,
  disabled,
}: {
  entity: Entity;
  doc: ProjectDocument;
  commit: (ops: Operation[]) => void;
  disabled: boolean;
}) {
  const nodes: NodeEntity[] =
    entity.kind === 'node'
      ? [entity]
      : entity.kind === 'group'
        ? Object.values(doc.entities).filter((e): e is NodeEntity => {
            if (e.kind !== 'node') return false;
            let parent = e.parentId;
            while (parent) {
              if (parent === entity.id) return true;
              parent = doc.entities[parent]?.parentId;
            }
            return false;
          })
        : [];
  if (!nodes.length) return null;
  const first = nodes[0],
    view = nodeVisual(first);
  const face = [...view.primitives]
      .reverse()
      .find((p) => p.kind === 'rect' || p.kind === 'ellipse'),
    text = view.primitives.find((p) => p.kind === 'text');
  const style = (value: Extract<Operation, { kind: 'nodeStyle' }>['style']) =>
    commit(nodes.map((node) => ({ kind: 'nodeStyle', id: node.id, style: value })));
  return (
    <section className="form-section appearance-editor">
      <h3>{entity.kind === 'group' ? `组内 ${nodes.length} 个基元的外观` : '颜色与轮廓'}</h3>
      <ColorField
        label="填充色"
        value={face && 'fill' in face ? face.fill : '#d5dde5'}
        disabled={disabled}
        onChange={(fill) => style({ fill })}
      />
      <ColorField
        label="边框色"
        value={face && 'stroke' in face ? face.stroke : '#374151'}
        disabled={disabled}
        onChange={(stroke) => style({ stroke })}
      />
      <ColorField
        label="文字色"
        value={text?.kind === 'text' ? text.color : '#26333d'}
        disabled={disabled}
        onChange={(text) => style({ text })}
      />
      <NumberField
        label="边框粗细"
        value={face && 'strokeWidth' in face ? (face.strokeWidth ?? 1.2) : 1.2}
        min={0}
        max={12}
        step={0.1}
        disabled={disabled}
        onChange={(strokeWidth) => style({ strokeWidth })}
      />
      <NumberField
        label="节点不透明度"
        value={first.presentation.opacityOverride ?? first.primitives[0]?.opacity ?? 1}
        min={0}
        max={1}
        step={0.05}
        disabled={disabled}
        onChange={(opacity) => style({ opacity })}
      />
      <button
        className="text-button full"
        disabled={disabled}
        onClick={() =>
          style({ fill: null, stroke: null, text: null, strokeWidth: null, opacity: null })
        }
      >
        恢复生成样式
      </button>
    </section>
  );
}
