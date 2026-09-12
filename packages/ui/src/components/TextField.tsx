import { useId } from 'react';
import type { InputHTMLAttributes, ReactElement } from 'react';
import { AlertIcon } from './Icons.js';

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  /**
   * Always rendered. A placeholder is not a label: it disappears the moment the
   * user types, and screen readers treat it inconsistently.
   */
  label: string;
  /** Helper text shown below the input. */
  hint?: string;
  /** Error text. Presence of this switches the field into its invalid state. */
  error?: string;
  /** Monospace + wide tracking. For stream keys and ingest URLs. */
  mono?: boolean;
  className?: string;
}

export function TextField({
  label,
  hint,
  error,
  mono = false,
  className,
  type = 'text',
  ...rest
}: TextFieldProps): ReactElement {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={['lt-field', className].filter(Boolean).join(' ')}>
      <label className="lt-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        className={['lt-input', mono ? 'lt-input--mono' : null, error ? 'lt-input--invalid' : null]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {hint ? (
        <span className="lt-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="lt-field__error" id={errorId} role="alert">
          <AlertIcon size={20} />
          {error}
        </span>
      ) : null}
    </div>
  );
}
