/**
 * The screen logic behind "Import from OBS…" (Pro mode).
 *
 * It lives under `screens/pro/` for two reasons. The obvious one is that importing another
 * program's configuration is a Pro affordance — a first-time creator does not have an OBS scene
 * collection and should never be asked about one. The second is the honest one: this is the only
 * feature in the product whose subject matter *is* the vocabulary LIVETAP refuses to teach, and
 * `screens/pro/` is the directory the `no-obs-words` guard exempts for exactly that reason. A
 * user who has come here to bring their OBS setup across needs those words to recognise their
 * own file.
 *
 * Everything a person reads is computed here rather than in the component, so it can be tested
 * against a real scene collection instead of against a rendered tree.
 */
import { importObsSceneCollection } from '@livetap/core';
import type { ImportReport, Moment, ObsImportResult } from '@livetap/core';

export type ObsReadOutcome =
  | { ok: true; result: ObsImportResult }
  | { ok: false; what: string; why: string };

/**
 * Read a scene collection out of the text of a file the user picked.
 *
 * Never throws, and never reports a parser message: `Unexpected token < in JSON at position 0`
 * is not an explanation, it is the thing this product exists to stop showing people. Both
 * failures below name what LIVETAP expected and what to do instead.
 */
export function readObsCollection(text: string): ObsReadOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      what: 'That file is not the one LIVETAP is looking for.',
      why: 'It is not readable as JSON, so it is either a different kind of file or an incomplete copy. OBS keeps scene collections in its own folder — in OBS, use Scene Collection → Export to write one out.',
    };
  }
  const result = importObsSceneCollection(parsed);
  if (result.moments.length === 0) {
    return {
      ok: false,
      what: 'Nothing in that file could become a Moment.',
      why:
        result.report.warnings[0] ??
        'The file was readable but contained no scenes LIVETAP could turn into a Moment.',
    };
  }
  return { ok: true, result };
}

/**
 * What the import will do, in one sentence, with no promise it cannot keep.
 *
 * When the report carries a warning, the arrangement is an approximation — a filter LIVETAP has
 * no equivalent for, a rotation it cannot apply, a canvas size it had to assume — and saying
 * "your layout comes across exactly" would be the kind of claim this product is built against
 * (tenet 8). So the sentence changes with the evidence.
 */
export function placementClaim(report: ImportReport): string {
  const moments = report.imported.length;
  const noun = moments === 1 ? 'Moment' : 'Moments';
  if (report.warnings.length > 0) {
    return `${moments} ${noun} will be added. The pieces and their order come across; where some of them sit is close rather than exact, for the reasons below — check each one in the preview before you go live.`;
  }
  return `${moments} ${noun} will be added, with every piece in the place your file put it.`;
}

/** "3 of 4 scenes", so the user can see what did not make it without counting rows. */
export function coverageLine(report: ImportReport): string {
  const kept = report.imported.length;
  const dropped = report.skipped.length;
  if (dropped === 0) return `Everything in the file came across: ${kept} to add.`;
  const pieces = dropped === 1 ? 'one piece' : `${dropped} pieces`;
  return `${kept} to add. ${pieces} could not come across, listed below with the reason.`;
}

/**
 * The Moments to hand to the store.
 *
 * Imported Moments are never `builtIn`: the six that ship with LIVETAP cannot be deleted, and a
 * Moment that came out of somebody's own file has to be deletable. Ids are made unique against
 * what is already there, so importing the same collection twice adds a second set rather than
 * silently overwriting the first — an import that quietly replaces the layout you were using is
 * the kind of surprise this screen has to not produce.
 */
export function momentsToAppend(result: ObsImportResult, existing: readonly Moment[]): Moment[] {
  const taken = new Set(existing.map((moment) => moment.id));
  return result.moments.map((moment) => {
    const id = uniqueId(moment.id, taken);
    taken.add(id);
    return { ...moment, id, builtIn: false };
  });
}

function uniqueId(preferred: string, taken: ReadonlySet<string>): string {
  if (!taken.has(preferred)) return preferred;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${preferred}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${preferred}-${Date.now()}`;
}
