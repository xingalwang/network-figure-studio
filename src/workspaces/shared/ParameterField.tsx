import { useEffect, useState } from 'react';
import type { ParamField } from '../../core/generation/types.ts';
import type { Params, JsonValue } from '../../core/document/types.ts';
import { Field } from '../../ui/Field.tsx';

/** Field value editing is shared; the caller owns section and axis grouping. */
export function ParameterField({
  field,
  params,
  onChange,
  disabled = false,
  label = field.label,
}: {
  field: ParamField;
  params: Params;
  onChange: (params: Params) => void;
  disabled?: boolean;
  label?: string;
}) {
  const value = params[field.key];
  const change = (next: Params[string]) => onChange({ ...params, [field.key]: next });
  return (
    <Field label={label} className={`field-${field.type}`}>
      {field.type === 'enum' ? (
        <select
          aria-label={field.label}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(event) => change(event.target.value)}
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
          checked={!!value}
          disabled={disabled}
          onChange={(event) => change(event.target.checked)}
        />
      ) : field.type === 'list' ? (
        <ListValue label={field.label} value={value} disabled={disabled} onChange={change} />
      ) : (
        <input
          aria-label={field.label}
          type={field.type === 'number' ? 'number' : field.type === 'color' ? 'color' : 'text'}
          min={field.type === 'number' ? field.min : undefined}
          max={field.type === 'number' ? field.max : undefined}
          step={field.type === 'number' ? (field.step ?? 1) : undefined}
          placeholder={field.type === 'number' && field.nullable ? '待配置' : undefined}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(event) =>
            change(
              field.type === 'number'
                ? event.target.value === ''
                  ? field.nullable
                    ? null
                    : ''
                  : Number(event.target.value)
                : event.target.value,
            )
          }
        />
      )}
    </Field>
  );
}

function ListValue({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: Params[string];
  disabled: boolean;
  onChange: (value: Params[string]) => void;
}) {
  const serialized = JSON.stringify(value ?? []);
  const [text, setText] = useState(serialized);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(serialized);
    setInvalid(false);
  }, [serialized]);
  return (
    <textarea
      aria-label={label}
      value={text}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        setText(event.target.value);
        try {
          const next: unknown = JSON.parse(event.target.value);
          if (!Array.isArray(next)) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          onChange(next as JsonValue[]);
        } catch {
          setInvalid(true);
        }
      }}
    />
  );
}
