import { describe, expect, it } from 'vitest';
import {
  BUILD_WRITES,
  describeIdentity,
  identify,
} from '../../../apps/desktop/scripts/renderer-identity.mjs';

/**
 * THE RULES THAT DECIDE WHETHER AN ARTIFACT CAN BE IDENTIFIED.
 *
 * Three versions of this check were wrong before the one under test, each in the way it was
 * written to catch, and each was agreed to by two sessions before an artifact disagreed with both.
 * That is the reason these are tests and not a comment: the design read as correct every time.
 *
 *   `dirty: true` as a boolean   packaging rewrites BUILD_INFO.txt, so building the artifact
 *                                dirtied the tree and NO correct build could pass its own gate
 *   a list of paths that MATTER  fails open — every path anybody forgets passes silently, and the
 *                                set that can change an artifact's bytes is unbounded
 *   recorded commit == HEAD      HEAD moves because of the release itself: package, read hashes,
 *                                write release notes, commit — and the check fails a current
 *                                artifact. It also passes a stale one rebuilt at the same HEAD.
 */
describe('identifying a renderer', () => {
  const clean = { commit: 'abc1234', dirty: [] };

  it('accepts a clean tree and reports the commit', () => {
    const r = identify(clean);
    expect(r.ok).toBe(true);
    expect(r.ok && r.commit).toBe('abc1234');
    expect(describeIdentity(r)).toContain('clean tree');
  });

  /*
   * The case that killed the boolean. `acquire-ffmpeg` rewrites this file's timestamp on every
   * packaging run, so a build dirties the tree by the act of building.
   */
  it('accepts a tree dirtied only by what the build itself writes', () => {
    const r = identify({ commit: 'abc1234', dirty: [...BUILD_WRITES] });
    expect(r.ok, 'a build cannot be refused for the side effect of building').toBe(true);
    expect(describeIdentity(r)).toContain('uncommitted');
  });

  it('refuses uncommitted source, with no escape hatch', () => {
    const r = identify({ commit: 'abc1234', dirty: ['apps/web/src/state/store.ts'] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('dirty-source');
    // The flag exists for a missing commit, never for uncommitted code.
    expect(identify({ commit: 'abc1234', dirty: ['apps/web/src/x.ts'] }, { unversioned: true }).ok).toBe(
      false,
    );
  });

  /*
   * Fail-closed. Build CONFIGURATION changes the bytes as surely as source does — `vite.config.ts`
   * can silently flip how `VITE_LIVETAP_MOCK_MODE` is folded, which is the exact failure three
   * separate verifiers already exist to catch — and an earlier draft that enumerated "paths that
   * matter" would have passed every one of these.
   */
  it.each([
    'apps/web/vite.config.ts',
    'apps/desktop/electron-builder.yml',
    'apps/desktop/tsup.config.ts',
    'package.json',
    'tsconfig.json',
    'some/file/nobody/thought/of.ts',
  ])('refuses an uncommitted %s, because the list of what matters is unbounded', (path) => {
    expect(identify({ commit: 'abc1234', dirty: [path] }).ok).toBe(false);
  });

  it('refuses a renderer with no commit, and says what to do', () => {
    const r = identify({ commit: null, dirty: [] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('no-commit');
    expect(r.ok === false && r.detail).toContain('--unversioned');
  });

  /*
   * `--unversioned` narrows the CLAIM rather than switching the check off: a tarball build with no
   * `.git` is recorded as unidentifiable, which is true, instead of passing as though it had been
   * identified.
   */
  it('records an unversioned build as unidentifiable rather than as verified', () => {
    const r = identify({ commit: null, dirty: [] }, { unversioned: true });
    expect(r.ok).toBe(true);
    expect(describeIdentity(r)).toContain('UNIDENTIFIABLE');
  });

  it('treats a missing or malformed build-mode as unidentifiable, not as clean', () => {
    expect(identify({}).ok).toBe(false);
    expect(identify({ commit: 'abc1234', dirty: 'not-an-array' }).ok).toBe(true);
  });
});
