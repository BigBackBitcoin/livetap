/**
 * The gesture that ends a live broadcast, tested as the safety-critical control it is.
 *
 * Every case below is a rule from the interaction-safety directive, and most of them are a bug
 * this product has already shipped once in some other component: a press that starts on one
 * control and ends as another; an accidental tap that fires a destructive action; a gesture that
 * leaves the element and never ends; a destructive action reachable only by pointer.
 */
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';

import { dropDistance, useDragOffStage } from './dragOffStage.js';
import { mount, type Mounted } from '../__tests__/helpers/render.js';

const WIDTH = 1440;
const FAR = dropDistance(WIDTH) + 10;

let dropped = 0;
let mounted: Mounted | null = null;

function Row({ armed = true, reducedMotion = false }: { armed?: boolean; reducedMotion?: boolean }): ReactElement {
  const drag = useDragOffStage({
    armed,
    reducedMotion,
    viewportWidth: WIDTH,
    onDrop: () => {
      dropped += 1;
    },
  });
  return (
    <li {...drag.rowProps} data-testid="row">
      <button type="button" aria-label="Stop this destination" onClick={() => (dropped += 100)}>
        Stop
      </button>
      <span {...drag.gripProps} role="button" tabIndex={0} aria-label="Drag off the stage" data-testid="grip" />
      <span data-testid="tension">{drag.tension.toFixed(2)}</span>
    </li>
  );
}

function grip(m: Mounted): HTMLElement {
  return m.container.querySelector('[data-testid="grip"]') as HTMLElement;
}

/** A real PointerEvent is not in happy-dom's constructors; the shape the hook reads is. */
function pointer(type: string, init: { clientX?: number; clientY?: number; pointerId?: number; button?: number }): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    pointerId: init.pointerId ?? 1,
    button: init.button ?? 0,
  });
  return event;
}

async function press(el: HTMLElement, x = 0, y = 0): Promise<void> {
  await act(async () => {
    el.dispatchEvent(pointer('pointerdown', { clientX: x, clientY: y }));
  });
}

async function move(x: number, y: number): Promise<void> {
  await act(async () => {
    window.dispatchEvent(pointer('pointermove', { clientX: x, clientY: y }));
  });
}

async function release(x = 0, y = 0): Promise<void> {
  await act(async () => {
    window.dispatchEvent(pointer('pointerup', { clientX: x, clientY: y }));
  });
}

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  dropped = 0;
});

describe('drag off the stage', () => {
  it('does nothing until the pointer has travelled far enough', async () => {
    mounted = await mount(<Row />);
    await press(grip(mounted), 0, 0);
    await move(20, 0);

    expect(dropped).toBe(0);
    // ...and it is visibly on its way, so the gesture is discoverable while it happens.
    expect(Number(mounted.container.querySelector('[data-testid="tension"]')?.textContent)).toBeGreaterThan(0);
  });

  it('drops the destination once, and only once, when it does', async () => {
    mounted = await mount(<Row />);
    await press(grip(mounted), 0, 0);
    await move(FAR, 0);
    await move(FAR + 200, 0);

    expect(dropped).toBe(1);
  });

  it('puts the row back and does nothing when the gesture is released short of it', async () => {
    mounted = await mount(<Row />);
    await press(grip(mounted), 0, 0);
    await move(40, 0);
    await release(40, 0);

    expect(dropped).toBe(0);
    const row = mounted.container.querySelector('[data-testid="row"]') as HTMLElement;
    expect(row.style.transform).toBe('');
    expect(row.hasAttribute('data-lt-dragging')).toBe(false);
  });

  it('cannot be started anywhere but the grip', async () => {
    mounted = await mount(<Row />);
    const stop = mounted.container.querySelector('button') as HTMLElement;
    await press(stop, 0, 0);
    await move(FAR, 0);

    // The press on the Stop button is the Stop button's. Nothing was dragged.
    expect(dropped).toBe(0);
  });

  it('ignores a non-primary button, so a right-click cannot begin a drag it never ends', async () => {
    mounted = await mount(<Row />);
    await act(async () => {
      grip(mounted!).dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 0, button: 2 }));
    });
    await move(FAR, 0);

    expect(dropped).toBe(0);
  });

  it('is reachable from the keyboard, because a destructive action always must be', async () => {
    mounted = await mount(<Row />);
    await act(async () => {
      grip(mounted!).dispatchEvent(
        Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: 'Delete' }),
      );
    });

    expect(dropped).toBe(1);
  });

  it('keeps the keyboard path under reduced motion, and refuses the fling', async () => {
    mounted = await mount(<Row reducedMotion />);
    await press(grip(mounted), 0, 0);
    await move(FAR, 0);
    expect(dropped).toBe(0);

    await act(async () => {
      grip(mounted!).dispatchEvent(
        Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: 'Delete' }),
      );
    });
    expect(dropped).toBe(1);
  });

  it('does nothing at all when the destination is not in a state that can be dropped', async () => {
    mounted = await mount(<Row armed={false} />);
    await press(grip(mounted), 0, 0);
    await move(FAR, 0);
    await act(async () => {
      grip(mounted!).dispatchEvent(
        Object.assign(new Event('keydown', { bubbles: true, cancelable: true }), { key: 'Delete' }),
      );
    });

    expect(dropped).toBe(0);
  });

  it('leaves no residue when the row disarms mid-gesture', async () => {
    mounted = await mount(<Row />);
    await press(grip(mounted), 0, 0);
    await move(60, 0);
    await mounted.unmount();
    mounted = await mount(<Row armed={false} />);

    const row = mounted.container.querySelector('[data-testid="row"]') as HTMLElement;
    expect(row.style.transform).toBe('');
  });

  it('scales the distance down on a phone, where 168px is most of the screen', () => {
    expect(dropDistance(1440)).toBe(168);
    expect(dropDistance(390)).toBeLessThan(168);
    // But never so small that a scroll-flick reads as a drop.
    expect(dropDistance(390)).toBeGreaterThan(60);
  });
});
