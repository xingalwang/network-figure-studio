import type { NodeEntity } from '../../core/document/types.ts';
import type { ParameterDraftCache } from '../../app/editor/parameter-drafts.ts';
import { useParameterDraft } from '../../app/editor/useParameterDraft.ts';

/** This panel edits a draft; the application action owns the complete commit workflow. */
export function FigureAnnotationPanel({
  entity,
  readonly,
  onApply,
  drafts,
  onDraftChange,
}: {
  entity: NodeEntity;
  readonly: boolean;
  onApply(id: string, text: string): Promise<boolean>;
  drafts: ParameterDraftCache;
  onDraftChange(dirty: boolean): void;
}) {
  const official = entity.annotation?.kind === 'manual' ? entity.annotation.text : '';
  const { params, dirty, conflict, change, apply } = useParameterDraft({
    id: entity.id,
    official: { text: official },
    drafts,
    onDraftChange,
    scope: 'figure',
  });
  if (entity.annotation?.kind === 'derived')
    return <p className="hint">自动标注来自计算对象，结构更新时重新推导。</p>;
  return (
    <section className="inspector-section">
      <h3>独立标注</h3>
      <label>
        标注内容
        <textarea
          aria-label="标注内容"
          value={String(params.text ?? '')}
          disabled={readonly}
          onChange={(event) => change({ text: event.target.value })}
        />
      </label>
      {conflict && <p className="warning">原标注已改变，应用时请确认覆盖。</p>}
      <button
        className="primary full"
        disabled={readonly || !dirty}
        onClick={() =>
          void apply(
            (next) => onApply(entity.id, String(next.text ?? '')),
            '原标注已改变，确定覆盖？',
          )
        }
      >
        应用标注
      </button>
    </section>
  );
}
