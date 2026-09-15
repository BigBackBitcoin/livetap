import { describe, expect, it } from 'vitest';
import { flush, render } from '../testing/render.js';
import { Button } from './Button.js';

/**
 * A press that begins on a button ends on that button.
 *
 * `click` is dispatched to the common ancestor of where the pointer went DOWN and where it came UP,
 * so anything that reflows the page in between silently eats it — no click, no error, nothing in
 * the console. It cost this product its only path to a real platform: in the paste-key form,
 * blurring a field to press Connect adds an error line ABOVE the button, the button moves a few
 * pixels while the pointer is still travelling, and the submit never fires. A creator who made one
 * typo, fixed it, and pressed Connect got silence.
 *
 * Pointer capture sends every later event from that pointer to the button regardless of what moved.
 */
describe('a press that begins here ends here', () => {
  it('captures the pointer on pointerdown, so a reflow cannot steal the click', () => {
    const captured: number[] = [];
    const { container, unmount } = render(<Button onClick={() => undefined}>Connect</Button>);
    const button = container.querySelector('button') as HTMLButtonElement & {
      setPointerCapture: (id: number) => void;
    };
    button.setPointerCapture = (id: number) => captured.push(id);

    flush(() => {
      const event = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 7, button: 0 });
      button.dispatchEvent(event);
    });

    expect(captured).toEqual([7]);
    unmount();
  });

  it('still calls a caller-supplied onPointerDown', () => {
    let seen = 0;
    const { container, unmount } = render(
      <Button onPointerDown={() => (seen += 1)}>Connect</Button>,
    );
    const button = container.querySelector('button') as HTMLButtonElement & {
      setPointerCapture: (id: number) => void;
    };
    button.setPointerCapture = () => undefined;

    flush(() => {
      const event = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 1, button: 0 });
      button.dispatchEvent(event);
    });

    expect(seen).toBe(1);
    unmount();
  });

  it('works in an environment with no pointer capture at all', () => {
    const { container, unmount } = render(<Button>Connect</Button>);
    const button = container.querySelector('button') as HTMLButtonElement;
    // happy-dom has no setPointerCapture; the throw must be swallowed, not surface to the user.
    expect(() =>
      flush(() => {
        const event = new Event('pointerdown', { bubbles: true, cancelable: true });
        Object.assign(event, { pointerId: 2, button: 0 });
        button.dispatchEvent(event);
      }),
    ).not.toThrow();
    unmount();
  });
});
