import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet';
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`ui-button ui-button-${variant} ${className}`}
      {...props}
    />
  );
});
export function IconButton({
  label,
  children,
  ...props
}: ButtonProps & { label: string; children: ReactNode }) {
  return (
    <Button
      {...props}
      variant="quiet"
      className={`ui-icon-button ${props.className ?? ''}`}
      aria-label={label}
      title={props.title ?? label}
    >
      {children}
    </Button>
  );
}
export function Tabs<T extends string>({
  label,
  value,
  items,
  onChange,
  className = '',
}: {
  label: string;
  value: T;
  items: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={`ui-tabs ${className}`}
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        const index = items.findIndex((item) => item.value === value);
        const next =
          event.key === 'ArrowRight'
            ? (index + 1) % items.length
            : event.key === 'ArrowLeft'
              ? (index + items.length - 1) % items.length
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : -1;
        if (next < 0 || !items[next]) return;
        event.preventDefault();
        onChange(items[next].value);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          tabIndex={value === item.value ? 0 : -1}
          aria-selected={value === item.value}
          className={value === item.value ? 'active' : ''}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
