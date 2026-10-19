import { useEffect, useState } from 'react';
export function ColorField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = /^#[0-9a-f]{6}$/i.test(text);
  return (
    <div className="color-field">
      <span>{label}</span>
      <input
        type="color"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        aria-label={`${label} HEX`}
        value={text}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={!valid}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        onBlur={() => {
          if (valid && text !== value) onChange(text.toLowerCase());
        }}
      />
      {!valid && <small className="field-error">使用 #RRGGBB</small>}
    </div>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  disabled = false,
  min = 0,
  max = 10000,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        key={`${label}-${value}`}
        aria-label={label}
        type="number"
        defaultValue={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (e.target.value.trim() && Number.isFinite(n) && n >= min && n <= max && n !== value)
            onChange(n);
          else e.target.value = String(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
