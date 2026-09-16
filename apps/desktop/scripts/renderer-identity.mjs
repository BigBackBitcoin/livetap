/**
 * CAN THIS RENDERER BE IDENTIFIED, and from which tree did it come.
 *
 * One implementation, asked in two places: `ensure-renderer.mjs` refuses to START a packaging run
 * against a renderer nobody can identify, and `verify-installer.mjs` asks the same question of the
 * finished artifact. It lives here rather than in either of them because two staleness rules at
 * two pipeline stages is precisely how `verify-installer` ended up with checks A and B agreeing
 * with each other about a tree that had moved on.
 *
 * WHY THE CHECK RUNS AT PREPACKAGE AND NOT ONLY AT VERIFY. `ensure-renderer` asked
 * `existsSync(app.html)` — it checked that the renderer EXISTS and never asked WHICH. So
 * `package:win` would happily ship a renderer from any commit, of any age, and both of the
 * verifier's staleness checks would pass, because the `.asar` genuinely matched `dist/renderer`.
 * They agreed about something stale. That artifact read 32/32 while carrying pre-commit code.
 *
 * Catching it at verify alone leaves two holes. It fails after six minutes and 230 MB, which is
 * exactly when somebody stops checking; and `package:win` produces a shippable file with no gate
 * between the build and the disk, so anybody who forgets to run the verifier ships unverified.
 * Refusing at the start costs two seconds and cannot be forgotten.
 *
 * It is a REFUSAL, never a rebuild. A rebuild hidden inside packaging is a second place the
 * renderer can be built and an implicit step that makes "which build is this" harder to answer —
 * which is the question this whole module exists to make answerable.
 */

/**
 * Paths the BUILD ITSELF writes into the tree, which therefore say nothing about which code is
 * inside the artifact.
 *
 * FAIL-CLOSED, and the polarity is the point. Everything tracked is fatal unless named here. The
 * opposite — a list of paths that MATTER — silently passes every path anybody forgets, and the set
 * that can change an artifact's bytes is unbounded: source, `vite.config.ts`,
 * `electron-builder.yml`, `tsup.config.ts`, `tsconfig*.json`, `package.json`. A new
 * generated-and-tracked file nobody adds here makes this gate refuse a CORRECT build; somebody
 * then looks, understands, and adds it deliberately. Annoying when wrong beats quiet when wrong.
 */
export const BUILD_WRITES = [
  // `acquire-ffmpeg` rewrites its `recorded:` timestamp on every packaging run, so the act of
  // packaging dirties the tree. A boolean `dirty` here would mean no correct build could ever
  // satisfy its own gate — which is a gate somebody deletes.
  'apps/desktop/resources/ffmpeg/BUILD_INFO.txt',
];

/**
 * @param {{commit?: string|null, dirty?: string[]|null}} mode  a parsed `build-mode.json`
 * @param {{unversioned?: boolean}} [options]
 * @returns {{ok: true, commit: string|null, dirty: string[]}
 *          | {ok: false, code: 'no-commit'|'dirty-source', detail: string, dirty: string[]}}
 */
export function identify(mode, options = {}) {
  const commit = mode?.commit ?? null;
  const dirty = Array.isArray(mode?.dirty) ? mode.dirty : [];

  if (commit === null) {
    if (options.unversioned === true) return { ok: true, commit: null, dirty };
    return {
      ok: false,
      code: 'no-commit',
      dirty,
      detail:
        'build-mode.json records no `commit`. Either it predates this check, or git was ' +
        'unavailable at build time. Rebuild the renderer, or pass --unversioned to record this ' +
        'artifact as UNIDENTIFIABLE — which is what it is.',
    };
  }

  /*
   * Uncommitted SOURCE gets no escape hatch, and that is not strictness for its own sake: code
   * that exists in no commit cannot be identified by anyone, including whoever built it ten
   * minutes later. There is no workflow that needs to ship one which is not better served by
   * committing first.
   */
  const fatal = dirty.filter((path) => !BUILD_WRITES.includes(path));
  if (fatal.length > 0) {
    return {
      ok: false,
      code: 'dirty-source',
      dirty,
      detail:
        `built with uncommitted changes to ${fatal.join(', ')}. This artifact cannot be ` +
        'identified by anyone, including whoever built it, because the code inside it exists in ' +
        'no commit. There is no flag for this: commit first.',
    };
  }

  return { ok: true, commit, dirty };
}

/** One line for a report: which tree this came from, and what was uncommitted at the time. */
export function describeIdentity(result) {
  if (result.commit === null) return 'UNIDENTIFIABLE (no commit recorded; --unversioned was given)';
  const extra = result.dirty.length > 0 ? ` (with ${result.dirty.join(', ')} uncommitted)` : ' (clean tree)';
  return `built from commit ${result.commit}${extra}`;
}
