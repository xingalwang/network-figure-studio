import { ParameterField } from '../shared/ParameterField.tsx';
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
              {visible.map((field) => (
                <ParameterField
                  key={field.key}
                  field={field}
                  params={params}
                  onChange={onChange}
                  disabled={disabled}
                />
              ))}
            </section>
          )
        );
      })}
    </div>
  );
}
