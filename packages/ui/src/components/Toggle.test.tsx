import { describe, expect, it, vi } from 'vitest';
import { click, flush, render, text } from '../testing/render.js';
import { Toggle } from './Toggle.js';

describe('Toggle', () => {
  it('is a button with role=switch and aria-checked, not a checkbox', () => {
    const { container, unmount } = render(
      <Toggle pressed={false} onPressedChange={() => {}}>
        Record this broadcast
      </Toggle>,
    );
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.getAttribute('role')).toBe('switch');
    expect(button?.getAttribute('aria-checked')).toBe('false');
    expect(button?.hasAttribute('aria-pressed')).toBe(false);
    expect(container.querySelector('input')).toBeNull();
    expect(text(button)).toBe('Record this broadcast');
    unmount();
  });

  it('reflects the checked state', () => {
    const { container, unmount } = render(
      <Toggle pressed onPressedChange={() => {}}>
        Record this broadcast
      </Toggle>,
    );
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-checked')).toBe('true');
    expect(button?.getAttribute('role')).toBe('switch');
    unmount();
  });

  it('leaves the native Space/Enter activation intact', () => {
    const onPressedChange = vi.fn();
    const { container, unmount } = render(
      <Toggle pressed={false} onPressedChange={onPressedChange}>
        Record
      </Toggle>,
    );
    const button = container.querySelector('button') as HTMLButtonElement;

    // A native <button> is in the tab order and activates on Space/Enter. Toggle adds
    // no tabindex and no key handler, so neither is taken away.
    expect(button.hasAttribute('tabindex')).toBe(false);
    expect(button.onkeydown).toBeNull();
    expect(button.onkeyup).toBeNull();
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      flush(() => {
        button.dispatchEvent(event);
      });
      expect(event.defaultPrevented, key).toBe(false);
    }

    // The activation those keys produce in a browser is a click on the button, which
    // reports the next value exactly once.
    click(button);
    expect(onPressedChange).toHaveBeenCalledTimes(1);
    expect(onPressedChange).toHaveBeenLastCalledWith(true);
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
