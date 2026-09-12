import { describe, expect, it } from 'vitest';
import type { BrowserLayer, CameraLayer, ColorLayer, ImageLayer, Layer, ScreenLayer, TextLayer } from '../types/moment.js';
import { importObsSceneCollection } from './obsSceneCollection.js';

/* ------------------------------------------------------------------ *
 * Fixture 1 — a realistic Windows gaming collection.
 * game_capture + dshow camera + text_gdiplus_v2 + two browser sources
 * (one https, one http) + WASAPI audio devices + a group.
 * ------------------------------------------------------------------ */

function windowsGamingCollection(): unknown {
  return {
    name: 'Gaming 2026',
    current_scene: 'Gameplay',
    current_program_scene: 'Gameplay',
    current_transition: 'Fade',
    transition_duration: 350,
    transitions: [{ id: 'fade_transition', name: 'Fade', settings: {} }],
    scene_order: [{ name: 'Starting Soon' }, { name: 'Gameplay' }],
    sources: [
      {
        id: 'scene',
        versioned_id: 'scene',
        name: 'Gameplay',
        hotkeys: { 'OBSBasic.SelectScene': [{ key: 'OBS_KEY_1' }] },
        settings: {
          custom_size: false,
          id_counter: 7,
          items: [
            {
              name: 'Game',
              id: 1,
              visible: true,
              locked: false,
              pos: { x: 0, y: 0 },
              scale: { x: 1, y: 1 },
              bounds: { x: 0, y: 0 },
              bounds_type: 'OBS_BOUNDS_NONE',
              alignment: 5,
              rot: 0,
              crop_left: 0,
              crop_right: 0,
              crop_top: 0,
              crop_bottom: 0,
            },
            {
              name: 'Cam',
              id: 2,
              visible: true,
              pos: { x: 1280, y: 720 },
              scale: { x: 0.5, y: 0.5 },
              bounds: { x: 0, y: 0 },
              bounds_type: 'OBS_BOUNDS_NONE',
              alignment: 5,
              rot: 0,
            },
            {
              name: 'Alerts',
              id: 3,
              visible: true,
              pos: { x: 0, y: 0 },
              scale: { x: 1, y: 1 },
              bounds_type: 'OBS_BOUNDS_NONE',
              alignment: 5,
              rot: 15,
            },
            {
              name: 'Chat',
              id: 4,
              visible: false,
              pos: { x: 1520, y: 0 },
              scale: { x: 1, y: 1 },
              bounds_type: 'OBS_BOUNDS_NONE',
              alignment: 5,
            },
            {
              name: 'Title',
              id: 5,
              visible: true,
              pos: { x: 960, y: 60 },
              scale: { x: 1, y: 1 },
              bounds_type: 'OBS_BOUNDS_NONE',
              alignment: 5,
            },
            { name: 'Mic/Aux', id: 6, visible: true, pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 } },
            { name: 'Overlay Group', id: 7, visible: true, pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 } },
          ],
        },
      },
      {
        id: 'scene',
        name: 'Starting Soon',
        settings: {
          items: [
            { name: 'BG', id: 1, visible: true, pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, bounds_type: 'OBS_BOUNDS_NONE', alignment: 5 },
            { name: 'Title', id: 2, visible: true, pos: { x: 960, y: 480 }, scale: { x: 1, y: 1 }, bounds_type: 'OBS_BOUNDS_NONE', alignment: 5 },
          ],
        },
      },
      { id: 'color_source_v3', name: 'BG', settings: { color: 4278190080, width: 1920, height: 1080 } },
      {
        id: 'game_capture',
        name: 'Game',
        settings: { capture_mode: 'window', window: 'Game:UnityWndClass:game.exe', capture_audio: true },
      },
      {
        id: 'dshow_input',
        name: 'Cam',
        settings: { video_device_id: 'usb#vid_046d&pid_085e', resolution: '1280x720', res_type: 1 },
        filters: [
          { id: 'chroma_key_filter_v2', name: 'Chroma Key', settings: { similarity: 400 } },
          { id: 'color_filter_v2', name: 'Color Correction', settings: {} },
        ],
      },
      {
        id: 'browser_source',
        name: 'Alerts',
        settings: { url: 'https://streamelements.com/overlay/abc123', width: 1920, height: 1080 },
      },
      {
        id: 'browser_source',
        name: 'Chat',
        settings: { url: 'http://localhost:8080/chat.html', width: 400, height: 1080 },
      },
      {
        id: 'text_gdiplus_v2',
        name: 'Title',
        settings: {
          text: 'LIVE NOW',
          color: 4294967295,
          align: 'center',
          valign: 'top',
          font: { face: 'Arial', size: 72, flags: 1, style: 'Bold' },
        },
      },
      { id: 'wasapi_input_capture', name: 'Mic/Aux', settings: { device_id: 'default' } },
      { id: 'wasapi_output_capture', name: 'Desktop Audio', settings: { device_id: 'default' } },
      {
        id: 'group',
        name: 'Overlay Group',
        settings: {
          items: [
            { name: 'Frame', id: 1, visible: true },
            { name: 'Webcam Border', id: 2, visible: true },
          ],
        },
      },
      { id: 'image_source', name: 'Frame', settings: { file: 'C:/overlays/frame.png' } },
      { id: 'image_source', name: 'Webcam Border', settings: { file: 'C:/overlays/border.png' } },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Fixture 2 — a realistic macOS talking-head collection.
 * av_capture_input + image_source + color_source_v3 + screen_capture + ft2 text.
 * ------------------------------------------------------------------ */

function macTalkingHeadCollection(): unknown {
  return {
    name: 'Talking Head',
    current_program_scene: 'Talk',
    current_transition: 'Cut',
    transition_duration: 0,
    transitions: [{ id: 'cut_transition', name: 'Cut', settings: {} }],
    scene_order: [{ name: 'Talk' }, { name: 'Slides' }],
    sources: [
      {
        id: 'scene',
        name: 'Talk',
        settings: {
          items: [
            { name: 'Backdrop', id: 1, visible: true, pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, bounds_type: 'OBS_BOUNDS_NONE', alignment: 5 },
            {
              name: 'FaceTime HD',
              id: 2,
              visible: true,
              pos: { x: 160, y: 90 },
              scale: { x: -1, y: 1 },
              bounds: { x: 1600, y: 900 },
              bounds_type: 'OBS_BOUNDS_SCALE_INNER',
              alignment: 5,
            },
            {
              name: 'Logo',
              id: 3,
              visible: false,
              pos: { x: 1700, y: 60 },
              scale: { x: 1, y: 1 },
              bounds: { x: 160, y: 160 },
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
            { name: 'Screen', id: 1, visible: true, pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, bounds_type: 'OBS_BOUNDS_NONE', alignment: 5 },
            {
              name: 'FaceTime HD',
              id: 2,
              visible: true,
              pos: { x: 1440, y: 780 },
              scale: { x: 0.25, y: 0.25 },
              bounds_type: 'OBS_BOUNDS_NONE',
              alignment: 5,
            },
            { name: 'Lower Third', id: 3, visible: true, pos: { x: 96, y: 900 }, scale: { x: 1, y: 1 }, bounds_type: 'OBS_BOUNDS_NONE', alignment: 5 },
          ],
        },
      },
      {
        id: 'av_capture_input',
        name: 'FaceTime HD',
        settings: { device: '0x8020000005ac8514', device_name: 'FaceTime HD Camera', resolution: '1920x1080' },
      },
      { id: 'color_source_v3', name: 'Backdrop', settings: { color: 4278190335, width: 1920, height: 1080 } },
      { id: 'image_source', name: 'Logo', settings: { file: '/Users/ada/Pictures/logo.png' } },
      { id: 'screen_capture', name: 'Screen', settings: { type: 0, display_uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230', capture_audio: true } },
      {
        id: 'text_ft2_source_v2',
        name: 'Lower Third',
        settings: { text: 'Ada Lovelace', color1: 4294967295, color2: 4294967295, align: 'left', valign: 'bottom', font: { face: 'Helvetica', size: 48 } },
      },
      { id: 'coreaudio_input_capture', name: 'Mic', settings: {} },
      { id: 'vlc_source', name: 'Playlist', settings: {} },
      { id: 'obs-shaderfilter-source', name: 'Fancy Blur', settings: {} },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Fixture 3 — malformed files.
 * ------------------------------------------------------------------ */

const MALFORMED: unknown[] = [
  undefined,
  null,
  'not json at all',
  42,
  [],
  {},
  { name: 'Broken', sources: 'nope' },
  { sources: [] },
  { sources: [{ id: 'dshow_input', name: 'Cam' }] },
];

function layerByName(layers: Layer[], name: string): Layer {
  const found = layers.find((l) => l.name === name);
  if (!found) throw new Error(`no layer called ${name}`);
  return found;
}

function near(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(0.001);
}

describe('importObsSceneCollection: Windows gaming collection', () => {
  const result = importObsSceneCollection(windowsGamingCollection());

  it('imports both scenes as Moments in scene_order, none of them built in', () => {
    expect(result.moments.map((m) => m.name)).toEqual(['Starting Soon', 'Gameplay']);
    expect(result.moments.map((m) => m.id)).toEqual(['starting-soon', 'gameplay']);
    for (const moment of result.moments) {
      expect(moment.builtIn).toBe(false);
      expect(moment.icon.length).toBeGreaterThan(0);
      expect(moment.transition).toEqual({ kind: 'fade', durationMs: 350 });
    }
    expect(result.activeMomentId).toBe('gameplay');
  });

  it('normalizes the camera transform: 1280x720 at scale 0.5 placed at 1280,720', () => {
    const gameplay = result.moments[1];
    expect(gameplay).toBeDefined();
    const cam = layerByName(gameplay?.layers ?? [], 'Cam') as CameraLayer;
    expect(cam.kind).toBe('camera');
    near(cam.placement.default.x, 0.667);
    near(cam.placement.default.y, 0.667);
    near(cam.placement.default.w, 0.333);
    near(cam.placement.default.h, 0.333);
    expect(cam.deviceId).toBe('usb#vid_046d&pid_085e');
    expect(cam.mirror).toBe(false);
  });

  it('turns game capture into a screen layer and says so', () => {
    const gameplay = result.moments[1];
    const game = layerByName(gameplay?.layers ?? [], 'Game') as ScreenLayer;
    expect(game.kind).toBe('screen');
    expect(game.captureSystemAudio).toBe(true);
    expect(game.placement.default).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(result.report.warnings.some((w) => /game capture/i.test(w))).toBe(true);
    // A game capture implies computer audio for that Moment.
    expect(gameplay?.audio.systemAudio).toBe(true);
    expect(result.moments[0]?.audio.systemAudio).toBe(false);
  });

  it('keeps z-order from item order (first item is bottom-most) and visibility', () => {
    const gameplay = result.moments[1];
    const layers = gameplay?.layers ?? [];
    expect(layers.map((l) => l.name)).toEqual(['Game', 'Cam', 'Alerts', 'Title']);
    const zs = layers.map((l) => l.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    expect(new Set(zs).size).toBe(zs.length);
    for (const layer of layers) expect(layer.visible).toBe(true);
  });

  it('converts OBS text colour from ABGR and carries font, weight and alignment', () => {
    const title = layerByName(result.moments[1]?.layers ?? [], 'Title') as TextLayer;
    expect(title.kind).toBe('text');
    expect(title.text).toBe('LIVE NOW');
    expect(title.color).toBe('#FFFFFF');
    expect(title.fontFamily).toBe('Arial');
    expect(title.fontSizePx).toBe(72);
    expect(title.weight).toBe(700);
    expect(title.align).toBe('center');
    near(title.placement.default.x, 0.5);
    near(title.placement.default.y, 0.0556);
    // Text gets a 9:16 placement inside the vertical safe area, since OBS has no vertical layout.
    expect(title.placement['9:16']).toBeDefined();
  });

  it('converts colour sources from ABGR', () => {
    const bg = layerByName(result.moments[0]?.layers ?? [], 'BG') as ColorLayer;
    expect(bg.kind).toBe('color');
    expect(bg.color).toBe('#000000');
  });

  it('imports the https browser source and refuses the http one with a reason', () => {
    const alerts = layerByName(result.moments[1]?.layers ?? [], 'Alerts') as BrowserLayer;
    expect(alerts.kind).toBe('browser');
    expect(alerts.url).toBe('https://streamelements.com/overlay/abc123');
    expect(alerts.widthPx).toBe(1920);
    expect(alerts.heightPx).toBe(1080);

    const chat = result.report.skipped.find((s) => s.source === 'Chat');
    expect(chat).toBeDefined();
    expect(chat?.scene).toBe('Gameplay');
    expect(chat?.kind).toBe('browser source');
    expect(chat?.reason).toMatch(/https/);
    expect(chat?.reason).toContain('http://localhost:8080/chat.html');
    expect(result.moments.flatMap((m) => m.layers).some((l) => l.name === 'Chat')).toBe(false);
  });

  it('reports audio devices, the group and its children, and unused sources', () => {
    const byName = new Map(result.report.skipped.map((s) => [`${s.source}|${s.kind}`, s]));

    expect(byName.get('Mic/Aux|audio device')?.reason).toMatch(/audio panel/);
    expect(byName.get('Desktop Audio|audio device')).toBeDefined();

    const group = byName.get('Overlay Group|group');
    expect(group?.reason).toMatch(/Groups are not imported/);
    expect(group?.reason).toContain('"Frame"');
    expect(group?.reason).toContain('"Webcam Border"');
    // Group children are covered by the group's entry, not reported twice.
    expect(result.report.skipped.filter((s) => s.source === 'Frame')).toHaveLength(0);
  });

  it('lists every filter it did not import, once per source', () => {
    const filters = result.report.skipped.filter((s) => s.kind === 'filter');
    expect(filters).toHaveLength(2);
    expect(filters.every((f) => f.source === 'Cam')).toBe(true);
    expect(filters[0]?.reason).toContain('"Chroma Key"');
    expect(filters[0]?.reason).toContain('chroma_key_filter_v2');
  });

  it('warns about rotation, hotkeys and the settings it deliberately left behind', () => {
    const warnings = result.report.warnings.join('\n');
    expect(warnings).toMatch(/rotated 15°/);
    expect(warnings).toMatch(/hotkey/i);
    expect(warnings).toMatch(/1920x1080/);
    expect(warnings).toMatch(/deliberately not imported/);
  });

  it('counts everything in a plain-language summary', () => {
    const { report } = result;
    expect(report.imported).toEqual([
      { scene: 'Starting Soon', layers: 2 },
      { scene: 'Gameplay', layers: 4 },
    ]);
    expect(report.skipped.filter((s) => s.kind !== 'filter')).toHaveLength(4);
    expect(report.skipped).toHaveLength(6);
    expect(report.summary.startsWith('Imported 2 of 2 scenes with 6 layers.')).toBe(true);
    expect(report.summary).toContain('4 items could not be imported:');
    expect(report.summary).toContain('"Chat" (browser source)');
    expect(report.summary).toContain('2 filters on 1 source were not imported');
    expect(report.summary).toMatch(/\d+ notes to read before you go live\./);
  });
});

describe('importObsSceneCollection: macOS talking-head collection', () => {
  const result = importObsSceneCollection(macTalkingHeadCollection());

  it('maps macOS source ids and keeps the active scene', () => {
    expect(result.moments.map((m) => m.name)).toEqual(['Talk', 'Slides']);
    expect(result.activeMomentId).toBe('talk');
    expect(result.moments.every((m) => m.builtIn === false)).toBe(true);
    expect(result.moments[0]?.transition).toEqual({ kind: 'cut', durationMs: 0 });

    const talk = result.moments[0]?.layers ?? [];
    expect(layerByName(talk, 'FaceTime HD').kind).toBe('camera');
    expect(layerByName(talk, 'Backdrop').kind).toBe('color');
    expect(layerByName(talk, 'Logo').kind).toBe('image');
    expect(layerByName(result.moments[1]?.layers ?? [], 'Screen').kind).toBe('screen');
  });

  it('takes the box from the bounding box and mirrors a negative scale', () => {
    const cam = layerByName(result.moments[0]?.layers ?? [], 'FaceTime HD') as CameraLayer;
    near(cam.placement.default.x, 0.0833);
    near(cam.placement.default.y, 0.0833);
    near(cam.placement.default.w, 0.8333);
    near(cam.placement.default.h, 0.8333);
    expect(cam.mirror).toBe(true);
  });

  it('scales by the item scale when the native size is known', () => {
    const pip = layerByName(result.moments[1]?.layers ?? [], 'FaceTime HD') as CameraLayer;
    near(pip.placement.default.x, 0.75);
    near(pip.placement.default.y, 0.7222);
    near(pip.placement.default.w, 0.25);
    near(pip.placement.default.h, 0.25);
  });

  it('keeps a hidden layer hidden and carries the image path', () => {
    const logo = layerByName(result.moments[0]?.layers ?? [], 'Logo') as ImageLayer;
    expect(logo.visible).toBe(false);
    expect(logo.src).toBe('/Users/ada/Pictures/logo.png');
    expect(result.report.warnings.some((w) => w.includes('/Users/ada/Pictures/logo.png'))).toBe(true);
  });

  it('reads the macOS ScreenCaptureKit display and its audio flag', () => {
    const screen = layerByName(result.moments[1]?.layers ?? [], 'Screen') as ScreenLayer;
    expect(screen.kind).toBe('screen');
    expect(screen.sourceId).toBe('37D8832A-2D66-02CA-B9F7-8F30A301B230');
    expect(screen.captureSystemAudio).toBe(true);
    expect(result.moments[1]?.audio.systemAudio).toBe(true);
  });

  it('converts the FreeType text colour (4294967295 -> #FFFFFF) and reports the red backdrop', () => {
    const lower = layerByName(result.moments[1]?.layers ?? [], 'Lower Third') as TextLayer;
    expect(lower.color).toBe('#FFFFFF');
    expect(lower.fontFamily).toBe('Helvetica');
    expect(lower.fontSizePx).toBe(48);
    expect(lower.align).toBe('left');

    const backdrop = layerByName(result.moments[0]?.layers ?? [], 'Backdrop') as ColorLayer;
    expect(backdrop.color).toBe('#FF0000');
  });

  it('reports the audio device, the VLC playlist and the plugin source it cannot have', () => {
    const { report } = result;
    const kinds = report.skipped.map((s) => `${s.source}: ${s.kind}`);
    expect(kinds).toContain('Mic: audio device');
    expect(kinds).toContain('Playlist: VLC playlist');
    const plugin = report.skipped.find((s) => s.source === 'Fancy Blur');
    expect(plugin?.reason).toMatch(/plugin/);
    expect(plugin?.reason).toContain('obs-shaderfilter-source');

    expect(report.imported).toEqual([
      { scene: 'Talk', layers: 3 },
      { scene: 'Slides', layers: 3 },
    ]);
    expect(report.summary.startsWith('Imported 2 of 2 scenes with 6 layers.')).toBe(true);
    expect(report.summary).toContain('3 items could not be imported:');
    expect(report.summary).not.toContain('filters');
  });

  it('honours a non-default canvas size', () => {
    const wide = importObsSceneCollection(macTalkingHeadCollection(), { baseWidth: 2560, baseHeight: 1440 });
    const cam = layerByName(wide.moments[0]?.layers ?? [], 'FaceTime HD') as CameraLayer;
    near(cam.placement.default.w, 1600 / 2560);
    near(cam.placement.default.h, 900 / 1440);
    const lower = layerByName(wide.moments[1]?.layers ?? [], 'Lower Third') as TextLayer;
    // 48px on a 1440-tall canvas is 36px against LIVETAP's 1080p reference.
    expect(lower.fontSizePx).toBe(36);
    expect(wide.report.warnings.some((w) => w.includes('2560x1440'))).toBe(true);
  });
});

describe('importObsSceneCollection: malformed input', () => {
  it('never throws, and reports one warning with no Moments', () => {
    for (const input of MALFORMED) {
      const result = importObsSceneCollection(input);
      expect(result.moments).toEqual([]);
      expect(result.activeMomentId).toBeUndefined();
      expect(result.report.imported).toEqual([]);
      expect(result.report.skipped).toEqual([]);
      expect(result.report.warnings).toHaveLength(1);
      expect(result.report.summary.startsWith('Nothing was imported.')).toBe(true);
      expect(result.report.summary).toContain(result.report.warnings[0] ?? '');
    }
  });

  it('survives junk inside an otherwise valid scene', () => {
    const result = importObsSceneCollection({
      sources: [
        {
          id: 'scene',
          name: 'Half Broken',
          settings: { items: [null, 5, {}, { name: 'Ghost' }, { name: 'Real', id: 1, pos: { x: 'x' }, scale: {} }] },
        },
        { id: 'color_source_v3', name: 'Real', settings: { color: 4278190080, width: 1920, height: 1080 } },
      ],
    });
    expect(result.moments).toHaveLength(1);
    expect(result.moments[0]?.layers).toHaveLength(1);
    expect(result.moments[0]?.layers[0]?.placement.default).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(result.moments[0]?.transition.kind).toBe('cut');
    const reasons = result.report.skipped.map((s) => s.kind);
    expect(reasons.filter((k) => k === 'unreadable item')).toHaveLength(2);
    // The empty object and "Ghost" both name a source that is not in the file.
    expect(reasons.filter((k) => k === 'missing source')).toHaveLength(2);
  });

  it('counts scenes it could not read in the summary arithmetic', () => {
    const result = importObsSceneCollection({
      current_program_scene: 'Good',
      sources: [
        { id: 'scene', name: 'Good', settings: { items: [] } },
        { id: 'scene', name: '   ', settings: { items: [] } },
      ],
    });
    expect(result.report.summary.startsWith('Imported 1 of 2 scenes with 0 layers.')).toBe(true);
    expect(result.report.skipped.some((s) => s.source === '(unnamed)')).toBe(true);
    expect(result.activeMomentId).toBe('good');
  });

  it('falls back to a cut and says so when the transition has no equivalent', () => {
    const result = importObsSceneCollection({
      current_transition: 'My Stinger',
      transitions: [{ id: 'obs_stinger_transition', name: 'My Stinger' }],
      sources: [{ id: 'scene', name: 'A', settings: { items: [] } }],
    });
    expect(result.moments[0]?.transition.kind).toBe('cut');
    expect(result.report.warnings.some((w) => w.includes('"My Stinger"'))).toBe(true);
  });
});
