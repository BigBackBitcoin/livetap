/**
 * Vitest setup for @livetap/ui.
 *
 * React 19 requires this flag before `act` will run. Setting it here rather than
 * inside the render helper keeps the helper free of import-time side effects.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
