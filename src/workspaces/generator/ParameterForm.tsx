import type { ParamField, Params } from '../../plugins/sdk.ts';
export function ParameterForm({
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
  return (
    <div className="parameter-form">
      {(['structure', 'appearance'] as const).map((section) => {
        const visible = fields.filter(
          (f) =>
            (f.section ?? 'structure') === section &&
            !(
              params.mode === 'flat' &&
              ['depth', 'stackCount', 'stackGap', 'angleDeg'].includes(f.key)
            ),
        );
        return (
          visible.length > 0 && (
            <section key={section} className="form-section">
              <h3>{section === 'structure' ? '结构参数' : '外观与投影'}</h3>
              {visible.map((f) => (
                <label className={`field field-${f.type}`} key={f.key}>
                  <span>{f.label}</span>
                  {f.type === 'enum' ? (
                    <select
                      aria-label={f.label}
                      disabled={disabled}
                      value={String(params[f.key])}
                      onChange={(e) => onChange({ ...params, [f.key]: e.target.value })}
                    >
                      {f.options.map((o) => (
                        <option value={o.value} key={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      aria-label={f.label}
                      checked={!!params[f.key]}
                      disabled={disabled}
                      onChange={(e) => onChange({ ...params, [f.key]: e.target.checked })}
                    />
                  ) : f.type === 'list' ? (
                    <textarea
                      aria-label={f.label}
                      value={JSON.stringify(params[f.key])}
                      disabled={disabled}
                      onChange={(e) => {
                        try {
                          onChange({ ...params, [f.key]: JSON.parse(e.target.value) });
                        } catch {}
                      }}
                    />
                  ) : (
                    <input
                      aria-label={f.label}
                      type={f.type === 'number' ? 'number' : f.type === 'color' ? 'color' : 'text'}
                      min={f.type === 'number' ? f.min : undefined}
                      max={f.type === 'number' ? f.max : undefined}
                      step={f.type === 'number' ? (f.step ?? 1) : undefined}
                      disabled={disabled}
                      value={String(params[f.key] ?? '')}
                      onChange={(e) =>
                        onChange({
                          ...params,
                          [f.key]:
                            f.type === 'number'
                              ? e.target.value === ''
                                ? f.nullable
                                  ? null
                                  : ''
                                : Number(e.target.value)
                              : e.target.value,
                        })
                      }
                    />
                  )}
                </label>
              ))}
            </section>
          )
        );
      })}
    </div>
  );
}
