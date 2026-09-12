import { describe, expect, it, vi } from 'vitest';
import type { HumaneError } from '@livetap/core';
import { click, render, text } from '../testing/render.js';
import { ErrorCard } from './ErrorCard.js';

const error: HumaneError = {
  code: 'AUTH_EXPIRED',
  what: 'YouTube signed you out.',
  why: 'The permission you gave LIVETAP expired after 6 months.',
  doing: 'Your other destinations are untouched and still ready.',
  youCan: 'Reconnect YouTube — it takes one tap and nothing else changes.',
  technical: 'token refresh returned invalid_grant',
  recoverable: true,
};

describe('ErrorCard', () => {
  it('shows all four humane fields, in order', () => {
    const { container, unmount } = render(<ErrorCard error={error} />);

    expect(text(container.querySelector('.lt-errorcard__what'))).toBe(error.what);

    const terms = Array.from(container.querySelectorAll('.lt-errorcard__term')).map((el) =>
      text(el),
    );
    expect(terms).toEqual(['Why', 'Doing', 'You can']);

    const descriptions = Array.from(container.querySelectorAll('.lt-errorcard__desc')).map((el) =>
      text(el),
    );
    expect(descriptions).toEqual([error.why, error.doing, error.youCan]);

    unmount();
  });

  it('announces itself as an alert', () => {
    const { container, unmount } = render(<ErrorCard error={error} />);
    expect(container.querySelector('.lt-errorcard')?.getAttribute('role')).toBe('alert');
    unmount();
  });

  it('renders exactly one primary action and fires it', () => {
    const onClick = vi.fn();
    const { container, unmount } = render(
      <ErrorCard error={error} action={{ label: 'Reconnect YouTube', onClick }} />,
    );
    const buttons = container.querySelectorAll('.lt-errorcard__actions button');
    expect(buttons.length).toBe(1);
    expect(text(buttons[0])).toBe('Reconnect YouTube');
    click(buttons[0]);
    expect(onClick).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('hides the technical detail unless Pro mode asks for it', () => {
    const simple = render(<ErrorCard error={error} />);
    expect(simple.container.querySelector('.lt-errorcard__tech')).toBeNull();
    simple.unmount();

    const pro = render(<ErrorCard error={error} showTechnical />);
    const details = pro.container.querySelector('.lt-errorcard__tech');
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(text(details)).toContain('AUTH_EXPIRED');
    expect(text(details)).toContain('invalid_grant');
    pro.unmount();
  });

  it('supports an amber tone for recoverable conditions', () => {
    const { container, unmount } = render(<ErrorCard error={error} tone="warning" />);
    expect(container.querySelector('.lt-errorcard--warning')).not.toBeNull();
    unmount();
  });
});
