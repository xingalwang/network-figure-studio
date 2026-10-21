import type { ReactNode } from 'react';

/** Field layout only; parameter interpretation belongs to the consuming feature. */
export function Field({
  label,
  children,
  className = '',
  error,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  error?: string;
  hint?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}
