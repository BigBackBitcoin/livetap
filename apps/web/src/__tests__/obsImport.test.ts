import { describe, expect, it } from 'vitest';
import { defaultMoments } from '@livetap/core';
import {
  coverageLine,
  momentsToAppend,
  placementClaim,
  readObsCollection,
} from '../screens/pro/obsSceneImport.js';

/**
 * The screen logic behind "Import from OBS…".
 *
 * What is worth testing here is not the conversion — `packages/core` owns that and tests it
 * against several real collections. It is the three promises this screen makes to the person in
 * front of it: a file it cannot read produces an explanation rather than a parser message, the
 * sentence about placement is never more confident than the report it came from, and nothing
 * that gets added can overwrite or masquerade as one of the six Moments LIVETAP ships.
 *
 * The fixture is the shape from `packages/core/src/import/obsSceneCollection.test.ts`: a flat
 * `sources[]` array in which scenes are themselves sources with `id: "scene"` whose
 * `settings.items[]` reference other sources by name.
 */
function collection(): unknown {
  return {
    name: 'Late Night Build',
    current_program_scene: 'Talk',
    current_transition: 'Fade',
    transition_duration: 300,
    transitions: [{ id: 'fade_transition', name: 'Fade', settings: {} }],
    scene_order: [{ name: 'Talk' }, { name: 'Slides' }],
    sources: [
      {
        id: 'scene',
        versioned_id: 'scene',
        name: 'Talk',
        settings: {
          items: [
            {
              name: 'Backdrop',
              id: 1,
              visible: true,
              pos: { x: 0, y: 0 },
              scale: { x: 1, y: 1 },
              bounds_type: 'OBS_BOUNDS_NONE',
              alignment: 5,
            },
            {
              name: 'FaceTime HD',
              id: 2,
              visible: true,
              pos: { x: 160, y: 90 },
              scale: { x: 1, y: 1 },
              bounds: { x: 1600, y: 900 },
              bounds_type: 'OBS_BOUNDS_SCALE_INNER',
              alignment: 5,
            },
          ],
        },
      },
      {
        id: 'scene',
        name: 'Slides',
        settings: {
          items: [
            {
              name: 'Desk screen',
              id: 1,
              visible: true,
              pos: { x: 0, y: 0 },
              scale: { x: 1, y: 1 },
              bounds_type: 'OBS_BOUNDS_NONE',
              alignment: 5,
            },
          ],
        },
      },
      { id: 'color_source_v3', name: 'Backdrop', settings: { color: 4278190080, width: 1920, height: 1080 } },
      {
        id: 'av_capture_input',
        name: 'FaceTime HD',
        settings: { device: 'FaceTime HD Camera', preset: '1280x720' },
      },
      {
        id: 'screen_capture',
        name: 'Desk screen',
        settings: { display: 1, show_cursor: true },
      },
    ],
  };
}

/** A collection whose one unusual source forces the importer to attach a warning. */
function collectionWithAnAssumption(): unknown {
  const base = collection() as { sources: Array<Record<string, unknown>> };
  const talk = base.sources[0] as { settings: { items: Array<Record<string, unknown>> } };
  // A rotated item: the pieces come across, where it sits does not, exactly.
  talk.settings.items.push({
    name: 'Alerts',
    id: 3,
    visible: true,
    pos: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    bounds_type: 'OBS_BOUNDS_NONE',
    alignment: 5,
    rot: 15,
  });
  base.sources.push({
    id: 'browser_source',
    name: 'Alerts',
    settings: { url: 'https://streamelements.com/overlay/abc123', width: 1920, height: 1080 },
  });
  return base;
}

describe('reading an OBS scene collection the user picked', () => {
  it('turns each scene into a Moment', () => {
    const outcome = readObsCollection(JSON.stringify(collection()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.moments.map((m) => m.name)).toEqual(['Talk', 'Slides']);
    expect(outcome.result.report.imported.map((entry) => entry.scene)).toEqual(['Talk', 'Slides']);
  });

  it('explains a file that is not JSON instead of showing a parser message', () => {
    const outcome = readObsCollection('<!doctype html><title>not a collection</title>');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.what).toContain('not the one LIVETAP is looking for');
    expect(outcome.why).toContain('Export');
    // The words a parser would have used, and this product may not.
    expect(`${outcome.what} ${outcome.why}`).not.toMatch(/unexpected token|position \d|SyntaxError/i);
  });

  it('explains valid JSON that is not a scene collection', () => {
    const outcome = readObsCollection(JSON.stringify({ hello: 'world' }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.what).toContain('Nothing in that file could become a Moment');
    expect(outcome.why.length).toBeGreaterThan(20);
  });

  it('explains a collection whose scenes are all empty', () => {
    const outcome = readObsCollection(JSON.stringify({ sources: [] }));
    expect(outcome.ok).toBe(false);
  });
});

describe('what the screen promises about placement', () => {
  it('claims an exact arrangement only when the report carries no warning', () => {
    const outcome = readObsCollection(JSON.stringify(collection()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const claim = placementClaim(outcome.result.report);
    if (outcome.result.report.warnings.length === 0) {
      expect(claim).toContain('in the place your file put it');
    } else {
      expect(claim).toContain('close rather than exact');
    }
  });

  it('never claims an exact arrangement when the report warns', () => {
    const outcome = readObsCollection(JSON.stringify(collectionWithAnAssumption()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.report.warnings.length).toBeGreaterThan(0);
    const claim = placementClaim(outcome.result.report);
    expect(claim).toContain('close rather than exact');
    expect(claim).toContain('check each one');
    expect(claim).not.toContain('in the place your file put it');
  });

  it('says how much did not come across rather than only what did', () => {
    const outcome = readObsCollection(JSON.stringify(collection()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const line = coverageLine(outcome.result.report);
    expect(line).toMatch(/\d+ to add|Everything in the file came across/);
  });
});

describe('adding the imported Moments', () => {
  it('marks them deletable, and never as one of the six LIVETAP ships', () => {
    const outcome = readObsCollection(JSON.stringify(collection()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const added = momentsToAppend(outcome.result, defaultMoments());
    expect(added.length).toBe(2);
    expect(added.every((moment) => moment.builtIn === false)).toBe(true);
  });

  it('never reuses an id that already exists, so a second import adds rather than overwrites', () => {
    const outcome = readObsCollection(JSON.stringify(collection()));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const existing = defaultMoments();
    const first = momentsToAppend(outcome.result, existing);
    const second = momentsToAppend(outcome.result, [...existing, ...first]);

    const ids = [...existing, ...first, ...second].map((moment) => moment.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The six built-ins are untouched by either import.
    expect(existing.every((moment) => moment.builtIn)).toBe(true);
  });
});
