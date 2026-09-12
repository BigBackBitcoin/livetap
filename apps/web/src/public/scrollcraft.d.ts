/**
 * Types for the vendored Scroll Craft engine.
 *
 * `scrollcraft.js` beside this file is a byte-for-byte copy of the skill's own
 * `engine/scrollcraft.js` and is never edited, so it carries no types of its own. This
 * declaration is the seam: it describes the surface the page actually uses and nothing more,
 * so a change to the engine's internals cannot quietly become a compile error here.
 *
 * The engine is a classic IIFE that assigns `window.ScrollCraft`. It is imported for its side
 * effect, which is why the module itself exports nothing.
 */

export {};

declare global {
  /** One mounted engine instance. `instances` exists for the verification harness. */
  interface ScrollCraftInstance {
    layout(): void;
    read(): void;
    acts: Array<{ el: HTMLElement; device: string; p: number; raw: number; live: boolean }>;
    clips: unknown[];
    lerp: number;
  }

  interface ScrollCraftGlobal {
    mount(root: Element | Document | string, opts?: { lerp?: number }): ScrollCraftInstance;
    /** `prefers-reduced-motion: reduce`, read once at load. */
    reduce: boolean;
    instances: ScrollCraftInstance[];
  }

  interface Window {
    ScrollCraft?: ScrollCraftGlobal;
  }
}
