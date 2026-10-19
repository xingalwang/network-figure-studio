import type { Params, ParamField } from '../../plugins/sdk.ts';

export function TensorFields({
  fields,
  params,
  onChange,
  disabled = false,
}: {
  fields: ParamField[];
  params: Params;
  onChange: (p: Params) => void;
  disabled?: boolean;
}) {
  fields = fields.filter(
    (f) => f.key !== 'dimension' && !(params.dimension === 2 && f.key === 'scaleD'),
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
              {field.key === 'padding'
                ? option.value === 'same'
                  ? 'Same'
                  : 'Valid'
                : option.label}
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
  const groups = [
    { keys: ['D', 'H', 'W'], title: '空间尺寸 · D × H × W' },
    {
      keys: ['kernelD', 'kernelH', 'kernelW'],
      title: fields.some((f) => f.label.startsWith('池化')) ? '池化窗口' : '卷积核',
    },
    { keys: ['strideD', 'strideH', 'strideW'], title: '步幅' },
  ].flatMap((group) => {
    const items = group.keys
      .map((key) => fields.find((f) => f.key === key))
      .filter((f) => f !== undefined);
    if (items.length < 2) return [];
    group.keys.forEach((key) => grouped.add(key));
    return [
      <div className="tensor-axis-group" key={group.title}>
        <h3>
          {group.title.startsWith('空间尺寸') && items.length === 2
            ? '空间尺寸 · H × W'
            : group.title}
        </h3>
        <div className="tensor-axis-inputs">{items.map((f) => render(f!, f!.key.at(-1)))}</div>
      </div>,
    ];
  });
  const ordinary = fields.filter((f) => !grouped.has(f.key));
  return (
    <div className="tensor-fields property-grid">
      {ordinary.filter((f) => f.key === 'outChannels').map((f) => render(f))}
      {groups}
      {ordinary.filter((f) => f.key !== 'outChannels').map((f) => render(f))}
    </div>
  );
}
