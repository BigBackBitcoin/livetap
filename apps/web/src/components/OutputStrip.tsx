/**
 * The per-destination output strip: one small picture per connected destination, each in the shape
 * that destination actually receives.
 *
 * A SEAM, deliberately. The marketing page already renders exactly this (`src/public/outputs.ts`),
 * composing the same production into six platform-shaped canvases, and the Studio renders nothing
 * of the kind. "One production, six correct pictures" is the product's headline claim, and the
 * place a creator most needs to see it is the place they are actually broadcasting from.
 *
 * Renders nothing until the media workstream fills it in, so that mounting it is a no-op today.
 */
export function OutputStrip(): null {
  return null;
}
