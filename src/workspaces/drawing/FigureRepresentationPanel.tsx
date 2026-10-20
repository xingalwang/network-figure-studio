import type { NodeEntity, Params, ProjectDocument } from '../../core/document/types.ts';
import { figureAppearance, type FigureAppearance } from '../../graphics/figure-appearance.ts';
import { useParameterDraft } from '../shared/useParameterDraft.ts';
import type { ParameterDraftCache } from '../shared/parameter-drafts.ts';

const valuesOf = (params: Params): FigureAppearance => ({
  drawWidth: typeof params.drawWidth === 'number' ? params.drawWidth : NaN,
  drawHeight: typeof params.drawHeight === 'number' ? params.drawHeight : NaN,
  depth: typeof params.depth === 'number' ? params.depth : NaN,
  angleDeg: typeof params.angleDeg === 'number' ? params.angleDeg : NaN,
});

/** The shared draft lifecycle protects this form; the complete action owns its transaction. */
export function FigureRepresentationPanel({
  doc,
  entity,
  disabled,
  onApply,
  drafts,
  onDraftChange,
}: {
  doc: ProjectDocument;
  entity: NodeEntity;
  disabled: boolean;
  onApply: (values: FigureAppearance) => Promise<boolean>;
  drafts?: ParameterDraftCache;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const official = figureAppearance(doc, entity);
  const { params, conflict, change, reset, apply } = useParameterDraft({
    id: entity.id,
    official,
    drafts,
    onDraftChange,
  });
  const fields: [keyof FigureAppearance, string, number, number][] = [
    ['drawWidth', '显示宽度 px', 24, 1000],
    ['drawHeight', '显示高度 px', 24, 1000],
  ];
  if (entity.figure?.tensorProjection)
    fields.push(['depth', '视觉厚度 px', 0, 200], ['angleDeg', '投影角度 °', 0, 80]);
  return (
    <section className="form-section">
      <h3>图稿显示几何</h3>
      {conflict && (
        <div className="warning">
          图稿外观已改变，当前草稿仍保留。
          <button className="text-button" onClick={reset}>
            载入最新外观
          </button>
        </div>
      )}
      <div className="property-grid">
        {fields.map(([key, label, min, max]) => (
          <label key={key} className="field">
            <span>{label}</span>
            <input
              type="number"
              aria-label={label}
              min={min}
              max={max}
              step={1}
              value={String(params[key] ?? '')}
              disabled={disabled}
              onChange={(event) =>
                change({
                  ...params,
                  [key]: event.target.value === '' ? '' : Number(event.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      <button
        className="primary full"
        disabled={disabled}
        onClick={() =>
          void apply((params) => onApply(valuesOf(params)), '图稿外观已改变，确认用当前草稿覆盖？')
        }
      >
        应用图稿外观
      </button>
    </section>
  );
}
