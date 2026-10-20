import type { Params, ParamField } from '../../plugins/sdk.ts';
import type { ComputationDefinition } from '../../core/computation/index.ts';

export function TensorFields({
  fields,
  params,
  onChange,
  disabled = false,
  presentation,
  dimension,
}: {
  fields: ParamField[];
  params: Params;
  onChange: (p: Params) => void;
  disabled?: boolean;
  presentation?: ComputationDefinition['presentation'];
  dimension?: 2 | 3 | null;
}) {
  fields = fields.filter(
    (f) =>
      !presentation?.hiddenFields?.includes(f.key) &&
      (!presentation?.fieldDimensions?.[f.key] ||
        presentation.fieldDimensions[f.key] === dimension),
  );
  const render = (field: ParamField, axis?: string) => (
    <label key={field.key} className={`field field-${field.type}`}>
      <span>{axis ?? field.label}</span>
      {field.type === 'enum' ? (
        <select
          aria-label={field.label}
          value={String(params[field.key])}
          disabled={disabled}
          onChange={(e) => onChange({ ...params, [field.key]: e.target.value })}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === 'boolean' ? (
        <input
          aria-label={field.label}
          type="checkbox"
          checked={!!params[field.key]}
          disabled={disabled}
          onChange={(e) => onChange({ ...params, [field.key]: e.target.checked })}
        />
      ) : (
        <input
          aria-label={field.label}
          type={field.type === 'number' ? 'number' : field.type === 'color' ? 'color' : 'text'}
          min={field.type === 'number' ? field.min : undefined}
          max={field.type === 'number' ? field.max : undefined}
          step={field.type === 'number' ? (field.step ?? 1) : undefined}
          value={String(params[field.key] ?? '')}
          placeholder={field.type === 'number' && field.nullable ? '待配置' : undefined}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...params,
              [field.key]:
                field.type === 'number'
                  ? e.target.value === ''
                    ? field.nullable
                      ? null
                      : ''
                    : Number(e.target.value)
                  : e.target.value,
            })
          }
        />
      )}
    </label>
  );
  const grouped = new Set<string>();
  const groups = (presentation?.fieldGroups ?? []).flatMap((group) => {
    const items = group.keys
      .map((key) => fields.find((f) => f.key === key))
      .filter((f) => f !== undefined);
    if (items.length < 2) return [];
    group.keys.forEach((key) => grouped.add(key));
    return [
      <div className="tensor-axis-group" key={group.title}>
        <h3>{group.title}</h3>
        <div className="tensor-axis-inputs">{items.map((f) => render(f!, f!.key.at(-1)))}</div>
      </div>,
    ];
  });
  const ordinary = fields.filter((f) => !grouped.has(f.key));
  return (
    <div className="tensor-fields property-grid">
      {groups}
      {ordinary.map((f) => render(f))}
    </div>
  );
}
