import { describe, expect, it, vi } from 'vitest';
import { click, pressKey, render, text } from '../testing/render.js';
import { Sheet } from './Sheet.js';

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    const { unmount } = render(
      <Sheet open={false} onClose={() => {}} title="Add destination">
        <p>body</p>
      </Sheet>,
    );
    expect(document.querySelector('.lt-sheet')).toBeNull();
    unmount();
  });

  it('is a modal dialog labelled by its title', () => {
    const { unmount } = render(
      <Sheet open onClose={() => {}} title="Add destination">
        <p>body</p>
      </Sheet>,
    );
    const dialog = document.querySelector('.lt-sheet');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog?.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(text(document.querySelector('.lt-sheet__title'))).toBe('Add destination');
    expect(document.querySelector('.lt-sheet__title')?.id).toBe(labelledBy);
    unmount();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Sheet open onClose={onClose} title="Add destination">
        <p>body</p>
      </Sheet>,
    );
    pressKey('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does not close on an unrelated key', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Sheet open onClose={onClose} title="Add destination">
        <p>body</p>
      </Sheet>,
    );
    pressKey('a');
    pressKey('Enter');
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it('closes from the close button and from the scrim', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Sheet open onClose={onClose} title="Add destination">
        <p>body</p>
      </Sheet>,
    );
    click(document.querySelector('.lt-sheet__header button'));
    click(document.querySelector('.lt-sheet__scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('locks background scroll while open and restores it on close', () => {
    const mounted = render(
      <Sheet open onClose={() => {}} title="Add destination">
        <p>body</p>
      </Sheet>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    mounted.rerender(
      <Sheet open={false} onClose={() => {}} title="Add destination">
        <p>body</p>
      </Sheet>,
    );
    expect(document.body.style.overflow).not.toBe('hidden');
    mounted.unmount();
  });

  it('moves focus into the sheet and returns it to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const mounted = render(
      <Sheet open onClose={() => {}} title="Add destination">
        <button type="button">Connect</button>
      </Sheet>,
    );
    expect(document.activeElement).not.toBe(opener);
    expect(document.querySelector('.lt-sheet')?.contains(document.activeElement)).toBe(true);

    mounted.rerender(
      <Sheet open={false} onClose={() => {}} title="Add destination">
        <button type="button">Connect</button>
      </Sheet>,
    );
    expect(document.activeElement).toBe(opener);

    mounted.unmount();
    opener.remove();
  });

  it('renders a footer when given one', () => {
    const { unmount } = render(
      <Sheet open onClose={() => {}} title="Paste stream key" footer={<button type="button">Save</button>}>
        <p>body</p>
      </Sheet>,
    );
    expect(text(document.querySelector('.lt-sheet')).includes('Save')).toBe(true);
    unmount();
  });
});
