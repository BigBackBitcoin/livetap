import { describe, expect, it, vi } from 'vitest';
import { click, render, text } from '../testing/render.js';
import { Toggle } from './Toggle.js';

describe('Toggle', () => {
  it('is a button carrying aria-pressed, not a checkbox', () => {
    const { container, unmount } = render(
      <Toggle pressed={false} onPressedChange={() => {}}>
        Record this broadcast
      </Toggle>,
    );
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('input')).toBeNull();
    expect(text(button)).toBe('Record this broadcast');
    unmount();
  });

  it('reflects the pressed state', () => {
    const { container, unmount } = render(
      <Toggle pressed onPressedChange={() => {}}>
        Record this broadcast
      </Toggle>,
    );
    expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    unmount();
  });

  it('reports the next value on activation', () => {
    const onPressedChange = vi.fn();
    const mounted = render(
      <Toggle pressed={false} onPressedChange={onPressedChange}>
        Record
      </Toggle>,
    );
    click(mounted.container.querySelector('button'));
    expect(onPressedChange).toHaveBeenLastCalledWith(true);

    mounted.rerender(
      <Toggle pressed onPressedChange={onPressedChange}>
        Record
      </Toggle>,
    );
    click(mounted.container.querySelector('button'));
    expect(onPressedChange).toHaveBeenLastCalledWith(false);
    expect(onPressedChange).toHaveBeenCalledTimes(2);
    mounted.unmount();
  });

  it('does not fire when disabled', () => {
    const onPressedChange = vi.fn();
    const { container, unmount } = render(
      <Toggle pressed={false} onPressedChange={onPressedChange} disabled>
        Record
      </Toggle>,
    );
    click(container.querySelector('button'));
    expect(onPressedChange).not.toHaveBeenCalled();
    unmount();
  });

  it('carries the touch-target class', () => {
    const { container, unmount } = render(
      <Toggle pressed={false} onPressedChange={() => {}} aria-label="Mute" />,
    );
    expect(container.querySelector('button')?.classList.contains('lt-touch')).toBe(true);
    unmount();
  });
});
