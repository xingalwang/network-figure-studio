import { ParameterField } from '../shared/ParameterField.tsx';
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
    <ParameterField
      key={field.key}
      field={field}
      params={params}
      onChange={onChange}
      disabled={disabled}
      label={axis}
    />
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
