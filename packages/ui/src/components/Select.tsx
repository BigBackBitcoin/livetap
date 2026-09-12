import { useId } from 'react';
import type { ReactElement, SelectHTMLAttributes } from 'react';
import { ChevronIcon } from './Icons.js';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'id' | 'children'> {
  label: string;
  options: readonly SelectOption[];
  hint?: string;
  /** Hide the visible label but keep it as the accessible name (dense device pickers). */
  labelHidden?: boolean;
  className?: string;
}

/**
 * A native `<select>`, styled.
 *
 * Deliberately not a custom listbox: the OS picker is better than anything we
 * would build — it is correct with a screen reader, correct with a keyboard,
 * correct on a phone, and it cannot be clipped by a dock. Device pickers in
 * Studio are exactly the case where that matters most.
 */
export function Select({
  label,
  options,
  hint,
  labelHidden = false,
  className,
  ...rest
}: SelectProps): ReactElement {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={['lt-field', className].filter(Boolean).join(' ')}>
      <label className={labelHidden ? 'lt-sr-only' : 'lt-field__label'} htmlFor={id}>
        {label}
      </label>
      <span className="lt-select-wrap">
        <select
          id={id}
          className="lt-select lt-touch"
          aria-describedby={hint ? hintId : undefined}
          {...rest}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronIcon size={20} className="lt-select-wrap__chevron" />
      </span>
      {hint ? (
        <span className="lt-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
