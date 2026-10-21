import type { DocumentStore, ProjectDocument, Operation } from '../../core/document/types.ts';
import { figurePalettes, planApplyPalette } from '../../core/commands/appearance.ts';
import { ColorField, NumberField } from './StyleFields.tsx';
export function FigureStylePanel({
  doc,
  store,
  onError,
}: {
  doc: ProjectDocument;
  store: DocumentStore;
  onError: (message: string) => void;
}) {
  const disabled = store.isReadonly();
  const commit = async (operations: Operation[]) => {
    const r = await store.dispatch({ baseRevision: store.getSnapshot().revision, operations });
    if (!r.ok) onError(r.error.message);
  };
  const applyColor = (
    key: 'nodeColor' | 'borderColor' | 'textColor' | 'lineColor',
    value: string,
  ) => {
    const styleKey = key === 'nodeColor' ? 'fill' : key === 'borderColor' ? 'stroke' : 'text';
    const ops: Operation[] = [{ kind: 'metadata', theme: { ...doc.theme, [key]: value } }];
    for (const e of Object.values(doc.entities))
      if (e.kind === 'node' && key !== 'lineColor')
        ops.push({ kind: 'nodeStyle', id: e.id, style: { [styleKey]: value } });
      else if (e.kind === 'edge' && key === 'lineColor')
        ops.push({ kind: 'edgeStyle', id: e.id, style: { color: value } });
    void commit(ops);
  };
  return (
    <div className="figure-style-panel">
      <div className="inspector-heading">
        <span className="eyebrow">页面与整图样式</span>
        <h2>图稿页面</h2>
        <p>页面尺寸、背景与整图配色；不改变工作台主题。</p>
      </div>
      <section className="form-section">
        <h3>整图配色</h3>
        <div className="palette-options">
          {figurePalettes.map((p) => (
            <button
              key={p.id}
              disabled={disabled}
              onClick={() => {
                const ops = planApplyPalette(doc, p);
                if (ops.ok) void commit(ops.value);
                else onError(ops.error.message);
              }}
            >
              <span className="palette-swatch">
                {[
                  p.fill,
                  p.stroke,
                  p.background === 'transparent'
                    ? '#ffffff'
                    : p.background === 'white'
                      ? '#ffffff'
                      : p.background,
                ].map((color, i) => (
                  <i key={i} style={{ background: color }} />
                ))}
              </span>
              {p.name}
            </button>
          ))}
        </div>
        <p className="hint">应用到全部基元和连线，可一次撤销。</p>
      </section>
      <section className="form-section">
        <h3>自定义颜色</h3>
        <ColorField
          label="整图填充色"
          value={doc.theme.nodeColor ?? '#d5dde5'}
          disabled={disabled}
          onChange={(v) => applyColor('nodeColor', v)}
        />
        <ColorField
          label="整图边框色"
          value={doc.theme.borderColor ?? '#374151'}
          disabled={disabled}
          onChange={(v) => applyColor('borderColor', v)}
        />
        <ColorField
          label="整图文字色"
          value={doc.theme.textColor ?? '#26333d'}
          disabled={disabled}
          onChange={(v) => applyColor('textColor', v)}
        />
        <ColorField
          label="整图连线色"
          value={doc.theme.lineColor}
          disabled={disabled}
          onChange={(v) => applyColor('lineColor', v)}
        />
        <NumberField
          label="默认线宽"
          value={doc.theme.lineWidth ?? 1.5}
          min={0}
          max={12}
          step={0.1}
          disabled={disabled}
          onChange={(v) => {
            const ops: Operation[] = [{ kind: 'metadata', theme: { ...doc.theme, lineWidth: v } }];
            for (const e of Object.values(doc.entities))
              if (e.kind === 'edge') ops.push({ kind: 'edgeStyle', id: e.id, style: { width: v } });
            void commit(ops);
          }}
        />
      </section>
      <section className="form-section">
        <h3>画板</h3>
        <label className="field">
          <span>画板背景</span>
          <select
            aria-label="画板背景"
            disabled={disabled}
            value={
              ['white', 'transparent'].includes(doc.page.background)
                ? doc.page.background
                : 'custom'
            }
            onChange={(e) =>
              void commit([
                {
                  kind: 'metadata',
                  page: {
                    ...doc.page,
                    background:
                      e.target.value === 'custom'
                        ? '#ffffff'
                        : (e.target.value as 'white' | 'transparent'),
                  },
                },
              ])
            }
          >
            <option value="white">白色</option>
            <option value="transparent">透明</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        {!['white', 'transparent'].includes(doc.page.background) && (
          <ColorField
            label="画板背景色"
            value={doc.page.background}
            disabled={disabled}
            onChange={(v) =>
              void commit([
                {
                  kind: 'metadata',
                  page: { ...doc.page, background: v as ProjectDocument['page']['background'] },
                },
              ])
            }
          />
        )}
        <NumberField
          label="画板宽度"
          value={doc.page.width}
          min={100}
          max={16000}
          disabled={disabled}
          onChange={(v) => void commit([{ kind: 'metadata', page: { ...doc.page, width: v } }])}
        />
        <NumberField
          label="画板高度"
          value={doc.page.height}
          min={100}
          max={16000}
          disabled={disabled}
          onChange={(v) => void commit([{ kind: 'metadata', page: { ...doc.page, height: v } }])}
        />
      </section>
    </div>
  );
}
