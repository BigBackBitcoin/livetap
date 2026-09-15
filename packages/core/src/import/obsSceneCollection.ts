/**
 * OBS scene-collection importer.
 *
 * An OBS scene collection is a single JSON document found in
 * `%APPDATA%/obs-studio/basic/scenes/*.json` (macOS: `~/Library/Application Support/obs-studio/...`).
 * It holds a flat `sources[]` array; scenes are themselves sources with `id: "scene"` whose
 * `settings.items[]` reference other sources **by name** and carry the per-scene transform.
 * The canvas size lives in the *profile*, not the collection, so it is passed in
 * (default 1920x1080).
 *
 * The contract of this module is honesty: it never fakes a conversion. Anything that does not
 * come across is listed in the {@link ImportReport} with a plain-language reason, and anything
 * that came across with an assumption attached produces a warning. Malformed input never throws;
 * it produces an empty result with one warning.
 */

import type {
  AudioState,
  BrowserLayer,
  CameraLayer,
  ColorLayer,
  ImageLayer,
  Layer,
  Moment,
  NormalizedRect,
  ScreenLayer,
  TextLayer,
  TransitionKind,
  VideoLayer,
} from '../types/moment.js';
import { DEFAULT_AUDIO } from '../moments/defaults.js';
import { insetToSafeArea } from '../production/intents.js';
import { obsColorToCss, obsColorToHex, obsColorWithOpacityToCss } from './obsColor.js';

/** The truth report: what came across, what did not, and what to check. */
export interface ImportReport {
  imported: Array<{ scene: string; layers: number }>;
  skipped: Array<{ scene?: string; source: string; kind: string; reason: string }>;
  warnings: string[];
  /** A plain-language paragraph a beginner can read in one breath. */
  summary: string;
}

export interface ObsImportOptions {
  /** Canvas width from the OBS profile. Defaults to 1920. */
  baseWidth?: number;
  /** Canvas height from the OBS profile. Defaults to 1080. */
  baseHeight?: number;
}

export interface ObsImportResult {
  moments: Moment[];
  activeMomentId?: string;
  report: ImportReport;
}

/* ------------------------------------------------------------------ *
 * Defensive readers. Every field of the input is untrusted.
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function rec(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function num(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
function round(n: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
function quote(name: string): string {
  return `"${name}"`;
}

/* ------------------------------------------------------------------ *
 * Source-id translation tables (Windows / macOS / Linux).
 * ------------------------------------------------------------------ */

const CAMERA_IDS = new Set(['dshow_input', 'av_capture_input', 'macos-avcapture', 'macos-avcapture-fast', 'v4l2_input']);
const SCREEN_IDS = new Set([
  'monitor_capture',
  'display_capture',
  'xshm_input',
  'pipewire-desktop-capture-source',
]);
const WINDOW_IDS = new Set(['window_capture', 'xcomposite_input', 'pipewire-window-capture-source']);
const IMAGE_IDS = new Set(['image_source']);
const VIDEO_IDS = new Set(['ffmpeg_source']);
const TEXT_IDS = new Set(['text_gdiplus', 'text_gdiplus_v2', 'text_gdiplus_v3', 'text_ft2_source', 'text_ft2_source_v2']);
const COLOR_IDS = new Set(['color_source', 'color_source_v2', 'color_source_v3']);

/** Sources LIVETAP deliberately does not import, with the sentence the user reads. */
const DECLINED: Record<string, { kind: string; reason: string }> = {
  slideshow: {
    kind: 'image slideshow',
    reason: 'Image slideshows are not imported yet. Add the pictures as separate image layers.',
  },
  slideshow_v2: {
    kind: 'image slideshow',
    reason: 'Image slideshows are not imported yet. Add the pictures as separate image layers.',
  },
  vlc_source: {
    kind: 'VLC playlist',
    reason: 'VLC playlists are not imported. Add each video file as its own video layer.',
  },
  group: {
    kind: 'group',
    reason: 'Groups are not imported. Add the sources that were inside the group individually.',
  },
  scene: {
    kind: 'nested scene',
    reason: 'A scene used inside another scene is not imported. It was imported as its own Moment instead.',
  },
};

const AUDIO_DEVICE_REASON =
  'Audio devices are not imported. LIVETAP picks your microphone and computer audio in one place, in the audio panel.';

function isAudioDeviceId(id: string): boolean {
  return (
    id.startsWith('wasapi_') ||
    id.startsWith('coreaudio_') ||
    id.startsWith('pulse_') ||
    id === 'audio_line' ||
    id === 'jack_output_capture'
  );
}

function isDeckLinkId(id: string): boolean {
  return id.startsWith('decklink');
}

/** Human label used in the report's `kind` column. */
function describeObsKind(id: string): string {
  if (CAMERA_IDS.has(id)) return 'camera';
  if (SCREEN_IDS.has(id) || id === 'game_capture' || id === 'screen_capture') return 'screen capture';
  if (WINDOW_IDS.has(id)) return 'window capture';
  if (IMAGE_IDS.has(id)) return 'image';
  if (VIDEO_IDS.has(id)) return 'video';
  if (TEXT_IDS.has(id)) return 'text';
  if (COLOR_IDS.has(id)) return 'colour';
  if (id === 'browser_source') return 'browser source';
  if (isAudioDeviceId(id)) return 'audio device';
  if (isDeckLinkId(id)) return 'capture card';
  const declined = DECLINED[id];
  if (declined) return declined.kind;
  return `unknown source (${id})`;
}

/* ------------------------------------------------------------------ *
 * Transitions
 * ------------------------------------------------------------------ */

const TRANSITION_BY_ID: Record<string, TransitionKind> = {
  cut_transition: 'cut',
  fade_transition: 'fade',
  fade_to_color_transition: 'fade',
  luma_wipe_transition: 'fade',
  swipe_transition: 'slide',
  slide_transition: 'slide',
  wipe_transition: 'slide',
};

const TRANSITION_BY_NAME: Record<string, TransitionKind> = {
  cut: 'cut',
  fade: 'fade',
  'fade to color': 'fade',
  'luma wipe': 'fade',
  slide: 'slide',
  swipe: 'slide',
  move: 'slide',
  zoom: 'zoom',
};

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

interface Size {
  w: number;
  h: number;
  /** True when we had to assume the size because OBS does not store it. */
  estimated: boolean;
}

/**
 * Native (pre-transform) size of a source, in pixels.
 * OBS does not store the size of most sources in the scene collection: a camera's frame size
 * comes from the device, an image's from the file. Where the settings do tell us, we use it;
 * where they do not we say so, and the caller warns.
 */
function nativeSize(obsId: string, settings: Record<string, unknown>, canvas: { w: number; h: number }): Size {
  // Browser and colour sources carry their own pixel size.
  if (obsId === 'browser_source' || COLOR_IDS.has(obsId)) {
    const w = num(settings.width, 0);
    const h = num(settings.height, 0);
    if (w > 0 && h > 0) return { w, h, estimated: false };
  }
  // Capture devices store the negotiated mode as "1280x720" (or cx/cy on some platforms).
  const resolution = str(settings.resolution);
  const match = /^\s*(\d{2,5})\s*[x×]\s*(\d{2,5})\s*$/.exec(resolution);
  if (match?.[1] && match[2]) {
    const w = Number(match[1]);
    const h = Number(match[2]);
    if (w > 0 && h > 0) return { w, h, estimated: false };
  }
  const cx = num(settings.cx, 0);
  const cy = num(settings.cy, 0);
  if (cx > 0 && cy > 0) return { w: cx, h: cy, estimated: false };
  return { w: canvas.w, h: canvas.h, estimated: true };
}

/** Rough box for a text source, from the font size and the string. Always flagged estimated. */
function estimateTextSize(text: string, fontSizePx: number): Size {
  const lines = text.split(/\r?\n/);
  let longest = 1;
  for (const line of lines) longest = Math.max(longest, line.length);
  return {
    w: Math.max(1, Math.round(longest * fontSizePx * 0.55)),
    h: Math.max(1, Math.round(lines.length * fontSizePx * 1.25)),
    estimated: true,
  };
}

interface Geometry {
  rect: NormalizedRect;
  mirror: boolean;
  flippedVertically: boolean;
  rotationDeg: number;
  fromBounds: boolean;
  offCanvas: boolean;
}

// OBS alignment flags (obs_align): CENTER 0, LEFT 1, RIGHT 2, TOP 4, BOTTOM 8.
const ALIGN_LEFT = 1;
const ALIGN_RIGHT = 2;
const ALIGN_TOP = 4;
const ALIGN_BOTTOM = 8;

/**
 * Turn an OBS scene item's transform into a normalized 0..1 rect on the LIVETAP canvas.
 * Bounding boxes win when set; otherwise the box is the cropped native size times the scale.
 * The rect is NOT clamped — an item hanging off the edge of the OBS canvas stays off the edge,
 * and the caller warns about it, because clamping would silently move the user's layout.
 */
function itemGeometry(item: Record<string, unknown>, native: Size, canvas: { w: number; h: number }): Geometry | undefined {
  const pos = rec(item.pos);
  const scale = rec(item.scale);
  const bounds = rec(item.bounds);
  const scaleX = num(scale.x, 1);
  const scaleY = num(scale.y, 1);
  const boundsTypeRaw = item.bounds_type;
  const boundsType = typeof boundsTypeRaw === 'number' ? (boundsTypeRaw === 0 ? 'OBS_BOUNDS_NONE' : 'OBS_BOUNDS_SCALE_INNER') : str(boundsTypeRaw, 'OBS_BOUNDS_NONE');
  const boundsW = num(bounds.x, 0);
  const boundsH = num(bounds.y, 0);

  let w: number;
  let h: number;
  let fromBounds = false;
  if (boundsType !== 'OBS_BOUNDS_NONE' && boundsW > 0 && boundsH > 0) {
    w = boundsW;
    h = boundsH;
    fromBounds = true;
  } else {
    const cropped = {
      w: Math.max(0, native.w - num(item.crop_left, 0) - num(item.crop_right, 0)),
      h: Math.max(0, native.h - num(item.crop_top, 0) - num(item.crop_bottom, 0)),
    };
    w = cropped.w * Math.abs(scaleX);
    h = cropped.h * Math.abs(scaleY);
  }
  if (!(w > 0) || !(h > 0)) return undefined;

  const alignment = num(item.alignment, ALIGN_TOP | ALIGN_LEFT);
  const posX = num(pos.x, 0);
  const posY = num(pos.y, 0);
  let x: number;
  let y: number;
  if (alignment & ALIGN_LEFT) x = posX;
  else if (alignment & ALIGN_RIGHT) x = posX - w;
  else x = posX - w / 2;
  if (alignment & ALIGN_TOP) y = posY;
  else if (alignment & ALIGN_BOTTOM) y = posY - h;
  else y = posY - h / 2;

  const rect: NormalizedRect = {
    x: round(x / canvas.w),
    y: round(y / canvas.h),
    w: round(w / canvas.w),
    h: round(h / canvas.h),
  };
  const offCanvas = rect.x < -0.001 || rect.y < -0.001 || rect.x + rect.w > 1.001 || rect.y + rect.h > 1.001;
  return {
    rect,
    mirror: scaleX < 0,
    flippedVertically: scaleY < 0,
    rotationDeg: num(item.rot, 0),
    fromBounds,
    offCanvas,
  };
}

/* ------------------------------------------------------------------ *
 * Ids and icons
 * ------------------------------------------------------------------ */

function slug(value: string, fallback: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === '' ? fallback : s;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  const id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function iconFor(sceneName: string, layers: Layer[]): string {
  const name = sceneName.toLowerCase();
  if (/start|soon|intro|waiting/.test(name)) return '⏳';
  if (/brb|break|pause|interval/.test(name)) return '☕';
  if (/end|outro|bye|thanks|thank you/.test(name)) return '👋';
  const kinds = new Set(layers.map((l) => l.kind));
  if (kinds.has('screen') || kinds.has('window')) return '🖥️';
  if (kinds.has('camera')) return '🎥';
  if (kinds.has('browser')) return '🌐';
  if (kinds.has('video')) return '🎬';
  if (kinds.has('image')) return '🖼️';
  if (kinds.has('text')) return '💬';
  return '✨';
}

/* ------------------------------------------------------------------ *
 * The importer
 * ------------------------------------------------------------------ */

interface ObsSource {
  name: string;
  obsId: string;
  settings: Record<string, unknown>;
  filters: unknown[];
}

type LayerResult = { ok: true; layer: Layer } | { ok: false; kind: string; reason: string };

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function malformed(reason: string): ObsImportResult {
  return {
    moments: [],
    report: {
      imported: [],
      skipped: [],
      warnings: [reason],
      summary: `Nothing was imported. ${reason}`,
    },
  };
}

/**
 * Import an OBS scene collection into LIVETAP Moments.
 *
 * @param json  Parsed contents of an OBS scene-collection file. Untrusted: any shape is accepted.
 * @param opts  Canvas size from the OBS profile (the collection does not contain it).
 */
export function importObsSceneCollection(json: unknown, opts: ObsImportOptions = {}): ObsImportResult {
  const root = json;
  if (!isRecord(root)) {
    return malformed('This file is not an OBS scene collection: the top level of the file is not a JSON object.');
  }
  if (!Array.isArray(root.sources)) {
    return malformed('This file is not an OBS scene collection: it has no list of sources.');
  }

  const warnings: string[] = [];
  const seenWarnings = new Set<string>();
  const warn = (message: string): void => {
    if (seenWarnings.has(message)) return;
    seenWarnings.add(message);
    warnings.push(message);
  };

  const skipped: ImportReport['skipped'] = [];
  const imported: ImportReport['imported'] = [];

  let canvasW = num(opts.baseWidth, 1920);
  let canvasH = num(opts.baseHeight, 1080);
  if (!(canvasW > 0) || !(canvasH > 0)) {
    warn('The OBS canvas size given was not usable, so 1920x1080 was assumed. Check the size of every layer.');
    canvasW = 1920;
    canvasH = 1080;
  }
  const canvas = { w: canvasW, h: canvasH };

  // ---- index every source by name -------------------------------------------------
  const sources = new Map<string, ObsSource>();
  const sceneOrderFromFile: string[] = [];
  let sceneSourcesFound = 0;
  for (const raw of list(root.sources)) {
    if (!isRecord(raw)) continue;
    const name = str(raw.name).trim();
    const obsId = str(raw.id) || str(raw.versioned_id);
    if (obsId === 'scene') sceneSourcesFound += 1;
    if (name === '') {
      skipped.push({
        source: '(unnamed)',
        kind: describeObsKind(obsId),
        reason: 'This source has no name in the file, so there is nothing to reference it by.',
      });
      continue;
    }
    if (sources.has(name)) {
      warn(`Two sources in this file are both called ${quote(name)}. Only the last one was used.`);
    }
    sources.set(name, { name, obsId, settings: rec(raw.settings), filters: list(raw.filters) });
    if (obsId === 'scene') sceneOrderFromFile.push(name);
  }

  // ---- scene order: scene_order first, then anything the file forgot to list ------
  const ordered: string[] = [];
  const orderSeen = new Set<string>();
  for (const entry of list(root.scene_order)) {
    const name = isRecord(entry) ? str(entry.name).trim() : str(entry).trim();
    if (name === '' || orderSeen.has(name)) continue;
    const source = sources.get(name);
    if (!source || source.obsId !== 'scene') continue;
    orderSeen.add(name);
    ordered.push(name);
  }
  for (const name of sceneOrderFromFile) {
    if (orderSeen.has(name)) continue;
    orderSeen.add(name);
    ordered.push(name);
  }

  const sceneCount = sceneSourcesFound;
  if (sceneOrderFromFile.length === 0) {
    return malformed('This file has no scenes that could be read, so there was nothing to import.');
  }

  // ---- transition (OBS has one for the whole collection) --------------------------
  const transition = resolveTransition(root, warn);

  // ---- which sources are referenced, so we can report the ones that are not -------
  const referenced = new Set<string>();
  for (const source of sources.values()) {
    if (source.obsId !== 'scene' && source.obsId !== 'group') continue;
    for (const item of list(source.settings.items)) {
      if (!isRecord(item)) continue;
      const name = str(item.name).trim();
      if (name !== '') referenced.add(name);
    }
  }

  // ---- build the Moments ----------------------------------------------------------
  const momentIds = new Set<string>();
  const moments: Moment[] = [];
  const momentIdByScene = new Map<string, string>();
  const filtersReportedFor = new Set<string>();

  for (const sceneName of ordered) {
    const scene = sources.get(sceneName);
    if (!scene) continue;
    const items = list(scene.settings.items);
    if (!Array.isArray(scene.settings.items)) {
      warn(`Scene ${quote(sceneName)} has no readable list of items, so it was imported empty.`);
    }

    const layers: Layer[] = [];
    const layerIds = new Set<string>();
    let systemAudio = false;

    items.forEach((rawItem, index) => {
      if (!isRecord(rawItem)) {
        skipped.push({
          scene: sceneName,
          source: `(item ${index + 1})`,
          kind: 'unreadable item',
          reason: 'This entry in the scene could not be read.',
        });
        return;
      }
      const itemName = str(rawItem.name).trim();
      const source = itemName === '' ? undefined : sources.get(itemName);
      if (!source) {
        skipped.push({
          scene: sceneName,
          source: itemName === '' ? `(item ${index + 1})` : itemName,
          kind: 'missing source',
          reason: 'This item points at a source that is not in this file.',
        });
        return;
      }

      const result = buildLayer({
        scene: sceneName,
        source,
        item: rawItem,
        index,
        canvas,
        layerIds,
        warn,
        hasScene: (name) => sources.get(name)?.obsId === 'scene',
      });
      if (!result.ok) {
        skipped.push({ scene: sceneName, source: source.name, kind: result.kind, reason: result.reason });
        return;
      }
      layers.push(result.layer);
      if ((result.layer.kind === 'screen' || result.layer.kind === 'window') && result.layer.captureSystemAudio) {
        systemAudio = true;
      }

      // Filters are reported once per source, not once per scene item.
      if (source.filters.length > 0 && !filtersReportedFor.has(source.name)) {
        filtersReportedFor.add(source.name);
        for (const rawFilter of source.filters) {
          const filter = rec(rawFilter);
          const filterName = str(filter.name, 'Filter');
          const filterId = str(filter.id, 'unknown');
          skipped.push({
            source: source.name,
            kind: 'filter',
            reason: `The filter ${quote(filterName)} (${filterId}) was not imported. LIVETAP has its own effects; add them again in the Moment.`,
          });
        }
      }
    });

    const audio: AudioState = { ...DEFAULT_AUDIO, systemAudio };
    const id = uniqueId(slug(sceneName, 'scene'), momentIds);
    momentIdByScene.set(sceneName, id);
    moments.push({
      id,
      name: sceneName,
      icon: iconFor(sceneName, layers),
      layers,
      audio,
      transition,
      builtIn: false,
    });
    imported.push({ scene: sceneName, layers: layers.length });
    if (layers.length === 0) {
      warn(`Scene ${quote(sceneName)} came across with no layers, because nothing in it could be imported.`);
    }
  }

  // ---- sources nobody referenced --------------------------------------------------
  for (const source of sources.values()) {
    if (source.obsId === 'scene' || referenced.has(source.name)) continue;
    if (isAudioDeviceId(source.obsId)) {
      skipped.push({ source: source.name, kind: 'audio device', reason: AUDIO_DEVICE_REASON });
      continue;
    }
    const declined = DECLINED[source.obsId];
    if (declined) {
      skipped.push({ source: source.name, kind: declined.kind, reason: declined.reason });
      continue;
    }
    if (isKnownSourceId(source.obsId)) {
      skipped.push({
        source: source.name,
        kind: describeObsKind(source.obsId),
        reason: 'This source is not used in any scene in this file, so there was nothing to place.',
      });
      continue;
    }
    skipped.push({
      source: source.name,
      kind: describeObsKind(source.obsId),
      reason: `This source comes from an OBS plugin LIVETAP does not have (${source.obsId}), so it was not imported.`,
    });
  }

  // ---- things OBS holds that Tier 1 deliberately leaves behind ---------------------
  const hotkeyCount = countHotkeys(root);
  if (hotkeyCount > 0) {
    warn(
      `Your ${hotkeyCount} OBS ${plural(hotkeyCount, 'hotkey was', 'hotkeys were')} not imported. Set the shortcuts you use in LIVETAP's Moment settings.`,
    );
  }
  warn(
    `Placements were read from the OBS canvas (${canvas.w}x${canvas.h}). OBS has no vertical version of a scene, so LIVETAP will reframe each Moment for 9:16 and 1:1 — check the ones you plan to use.`,
  );
  warn(
    'Your OBS output, encoder, audio-device and account settings were deliberately not imported. LIVETAP chooses those for you, and you can inspect them in Advanced.',
  );

  const activeSceneName = str(root.current_program_scene).trim() || str(root.current_scene).trim();
  const activeMomentId = momentIdByScene.get(activeSceneName) ?? moments[0]?.id;

  const summary = buildSummary({ sceneCount, imported, skipped, warnings });

  const report: ImportReport = { imported, skipped, warnings, summary };
  return activeMomentId === undefined ? { moments, report } : { moments, activeMomentId, report };
}

function isKnownSourceId(id: string): boolean {
  return (
    CAMERA_IDS.has(id) ||
    SCREEN_IDS.has(id) ||
    WINDOW_IDS.has(id) ||
    IMAGE_IDS.has(id) ||
    VIDEO_IDS.has(id) ||
    TEXT_IDS.has(id) ||
    COLOR_IDS.has(id) ||
    id === 'browser_source' ||
    id === 'game_capture' ||
    id === 'screen_capture'
  );
}

function countHotkeys(root: Record<string, unknown>): number {
  let count = 0;
  for (const raw of list(root.sources)) {
    const hotkeys = rec(rec(raw).hotkeys);
    for (const key of Object.keys(hotkeys)) {
      count += list(hotkeys[key]).length;
    }
  }
  return count;
}

function resolveTransition(
  root: Record<string, unknown>,
  warn: (message: string) => void,
): { kind: TransitionKind; durationMs: number } {
  const currentName = str(root.current_transition).trim();
  let obsId = '';
  for (const raw of list(root.transitions)) {
    const entry = rec(raw);
    if (str(entry.name).trim() === currentName) {
      obsId = str(entry.id);
      break;
    }
  }
  const byId = obsId === '' ? undefined : TRANSITION_BY_ID[obsId];
  const lower = currentName.toLowerCase();
  const byName = TRANSITION_BY_NAME[lower] ?? (lower.includes('zoom') ? 'zoom' : undefined);
  const kind: TransitionKind = byId ?? byName ?? 'cut';
  if (byId === undefined && byName === undefined) {
    if (currentName !== '') {
      warn(
        `OBS's transition ${quote(currentName)} has no LIVETAP equivalent, so every Moment uses a cut. Pick fade, slide or zoom per Moment.`,
      );
    }
  }
  const durationMs = Math.min(5000, Math.max(0, Math.round(num(root.transition_duration, 300))));
  return { kind, durationMs };
}

/* ------------------------------------------------------------------ *
 * One scene item -> one Layer
 * ------------------------------------------------------------------ */

interface BuildLayerArgs {
  scene: string;
  source: ObsSource;
  item: Record<string, unknown>;
  index: number;
  canvas: { w: number; h: number };
  layerIds: Set<string>;
  warn: (message: string) => void;
  hasScene: (name: string) => boolean;
}

function buildLayer(args: BuildLayerArgs): LayerResult {
  const { source, item, index, canvas, layerIds, warn } = args;
  const obsId = source.obsId;
  const settings = source.settings;

  // Declined up front, before any geometry work.
  if (isAudioDeviceId(obsId)) return { ok: false, kind: 'audio device', reason: AUDIO_DEVICE_REASON };
  if (isDeckLinkId(obsId)) {
    return {
      ok: false,
      kind: 'capture card',
      reason: 'Blackmagic DeckLink inputs are not imported yet. Add the card as a camera once LIVETAP sees it.',
    };
  }
  if (obsId === 'group') {
    const children = list(settings.items)
      .map((child) => str(rec(child).name).trim())
      .filter((name) => name !== '');
    const tail = children.length > 0 ? ` The ${children.length} ${plural(children.length, 'source', 'sources')} inside it (${children.map(quote).join(', ')}) were not imported either.` : '';
    return { ok: false, kind: 'group', reason: `${DECLINED.group?.reason ?? 'Groups are not imported.'}${tail}` };
  }
  if (obsId === 'scene') {
    const tail = args.hasScene(source.name) ? ` ${quote(source.name)} was imported as its own Moment.` : '';
    return { ok: false, kind: 'nested scene', reason: `A scene used inside another scene is not imported.${tail}` };
  }
  const declined = DECLINED[obsId];
  if (declined) return { ok: false, kind: declined.kind, reason: declined.reason };
  if (!isKnownSourceId(obsId)) {
    return {
      ok: false,
      kind: describeObsKind(obsId),
      reason: `This source comes from an OBS plugin LIVETAP does not have (${obsId}), so it was not imported.`,
    };
  }

  // Per-kind content, then geometry (text needs its font size before it can be measured).
  const name = source.name;
  const visible = bool(item.visible, true);
  const z = index * 10;
  const itemId = num(item.id, index + 1);
  const id = uniqueId(`${slug(name, 'layer')}-${Math.round(itemId)}`, layerIds);

  let size: Size;
  let content:
    | { kind: 'camera'; deviceId: string }
    | { kind: 'screen' | 'window'; sourceId: string; captureSystemAudio: boolean }
    | { kind: 'image'; src: string }
    | { kind: 'video'; src: string; loop: boolean }
    | { kind: 'text'; text: TextContent }
    | { kind: 'browser'; url: string; widthPx: number; heightPx: number }
    | { kind: 'color'; color: string };

  if (CAMERA_IDS.has(obsId)) {
    const deviceId =
      str(settings.video_device_id) || str(settings.device) || str(settings.device_id) || str(settings.device_name) || 'default';
    content = { kind: 'camera', deviceId: deviceId === '' ? 'default' : deviceId };
    size = nativeSize(obsId, settings, canvas);
  } else if (SCREEN_IDS.has(obsId) || WINDOW_IDS.has(obsId) || obsId === 'game_capture' || obsId === 'screen_capture') {
    const screen = screenContent(obsId, settings, name, warn);
    content = screen;
    size = nativeSize(obsId, settings, canvas);
  } else if (IMAGE_IDS.has(obsId)) {
    const src = str(settings.file).trim();
    if (src === '') {
      return { ok: false, kind: 'image', reason: 'No image file was set on this source in OBS, so there was nothing to import.' };
    }
    content = { kind: 'image', src };
    size = nativeSize(obsId, settings, canvas);
    warn(`LIVETAP could not check that the image file for ${quote(name)} still exists (${src}). Open the Moment to confirm it shows.`);
  } else if (VIDEO_IDS.has(obsId)) {
    const localFile = str(settings.local_file).trim();
    const isLocal = bool(settings.is_local_file, localFile !== '');
    if (!isLocal || localFile === '') {
      return {
        ok: false,
        kind: 'video',
        reason: 'This media source plays a network stream rather than a local file, which is not imported yet.',
      };
    }
    content = { kind: 'video', src: localFile, loop: bool(settings.looping, false) };
    size = nativeSize(obsId, settings, canvas);
    if (bool(settings.restart_on_activate, false)) {
      warn(`${quote(name)} had "restart when activated" set in OBS. That setting was not imported.`);
    }
    warn(`LIVETAP could not check that the video file for ${quote(name)} still exists (${localFile}). Open the Moment to confirm it plays.`);
  } else if (TEXT_IDS.has(obsId)) {
    const text = textContent(obsId, settings, name, canvas, warn);
    if (!text) {
      return {
        ok: false,
        kind: 'text',
        reason: 'This text source reads its words from a file while you stream, which is not imported yet.',
      };
    }
    content = { kind: 'text', text };
    size = estimateTextSize(text.text, text.fontSizePx);
  } else if (obsId === 'browser_source') {
    if (bool(settings.is_local_file, false)) {
      return {
        ok: false,
        kind: 'browser source',
        reason: 'This browser source loads a local HTML file, which is not imported. Host the page over https and add it again.',
      };
    }
    const url = str(settings.url).trim();
    if (url === '') {
      return { ok: false, kind: 'browser source', reason: 'No address was set on this browser source in OBS.' };
    }
    if (!/^https:\/\//i.test(url)) {
      return {
        ok: false,
        kind: 'browser source',
        reason: `LIVETAP only loads browser sources over https, and this one uses ${url.split(':')[0] ?? 'another scheme'}: ${url}`,
      };
    }
    content = {
      kind: 'browser',
      url,
      widthPx: Math.max(1, Math.round(num(settings.width, canvas.w))),
      heightPx: Math.max(1, Math.round(num(settings.height, canvas.h))),
    };
    size = nativeSize(obsId, settings, canvas);
  } else {
    const color = obsColorToCss(settings.color);
    if (color === undefined) {
      return { ok: false, kind: 'colour', reason: 'The colour on this source could not be read, so it was not imported.' };
    }
    content = { kind: 'color', color };
    size = nativeSize(obsId, settings, canvas);
  }

  const geometry = itemGeometry(item, size, canvas);
  if (!geometry) {
    return {
      ok: false,
      kind: describeObsKind(obsId),
      reason: 'This item had no width or height in OBS, so there was no box to import.',
    };
  }
  if (size.estimated && !geometry.fromBounds) {
    if (content.kind === 'text') {
      warn(
        `OBS does not store how wide ${quote(name)} is, so its box was worked out from the font size and the words. Check it in the Moment.`,
      );
    } else {
      warn(
        `OBS does not store how big ${quote(name)} is, so its box was assumed to match the OBS canvas. Check its size in the Moment.`,
      );
    }
  }
  if (geometry.rotationDeg !== 0) {
    warn(
      `${quote(name)} was rotated ${round(geometry.rotationDeg, 1)}° in OBS. LIVETAP does not rotate layers yet, so it was placed without the rotation.`,
    );
  }
  if (geometry.flippedVertically) {
    warn(`${quote(name)} was flipped upside down in OBS. LIVETAP can only mirror left-to-right, so the flip was not imported.`);
  }
  if (geometry.offCanvas) {
    warn(`${quote(name)} hangs off the edge of the OBS canvas. It was imported where it was, so part of it may not be visible.`);
  }
  if (bool(item.locked, false)) {
    warn(`${quote(name)} was locked in OBS. Locks were not imported, so the layer can be moved in LIVETAP.`);
  }

  const base = {
    id,
    name,
    visible,
    placement: { default: geometry.rect },
    opacity: 1,
    z,
  };

  switch (content.kind) {
    case 'camera': {
      // `facing` is not in an OBS scene - OBS has no concept of a lens - so an imported camera is
      // assumed to be the one pointing at the creator. Stating it stops a phone inferring the lens
      // from `mirror`, which for an OBS scene means only that the creator flipped the source.
      const layer: CameraLayer = { ...base, kind: 'camera', deviceId: content.deviceId, fit: 'cover', mirror: geometry.mirror, facing: 'user' };
      return { ok: true, layer };
    }
    case 'screen':
    case 'window': {
      const layer: ScreenLayer = {
        ...base,
        kind: content.kind,
        sourceId: content.sourceId,
        captureSystemAudio: content.captureSystemAudio,
        fit: 'contain',
        mirror: geometry.mirror,
      };
      return { ok: true, layer };
    }
    case 'image': {
      const layer: ImageLayer = { ...base, kind: 'image', src: content.src, fit: 'contain', mirror: geometry.mirror };
      return { ok: true, layer };
    }
    case 'video': {
      const layer: VideoLayer = {
        ...base,
        kind: 'video',
        src: content.src,
        loop: content.loop,
        muted: false,
        fit: 'contain',
        mirror: geometry.mirror,
      };
      return { ok: true, layer };
    }
    case 'text': {
      const t = content.text;
      const layer: TextLayer = {
        ...base,
        kind: 'text',
        placement: { default: geometry.rect, '9:16': insetToSafeArea(geometry.rect, '9:16') },
        text: t.text,
        fontFamily: t.fontFamily,
        fontSizePx: t.fontSizePx,
        color: t.color,
        align: t.align,
        weight: t.weight,
        background: t.background,
      };
      return { ok: true, layer };
    }
    case 'browser': {
      const layer: BrowserLayer = {
        ...base,
        kind: 'browser',
        url: content.url,
        widthPx: content.widthPx,
        heightPx: content.heightPx,
      };
      return { ok: true, layer };
    }
    case 'color': {
      const layer: ColorLayer = { ...base, kind: 'color', color: content.color };
      return { ok: true, layer };
    }
  }
}

function screenContent(
  obsId: string,
  settings: Record<string, unknown>,
  name: string,
  warn: (message: string) => void,
): { kind: 'screen' | 'window'; sourceId: string; captureSystemAudio: boolean } {
  const captureSystemAudio = bool(settings.capture_audio, false);
  if (obsId === 'game_capture') {
    warn(`${quote(name)} was a game capture in OBS. LIVETAP captures the game as a screen instead, so pick the window when you go live.`);
    return { kind: 'screen', sourceId: 'prompt', captureSystemAudio };
  }
  if (obsId === 'screen_capture') {
    // macOS ScreenCaptureKit: 0 = display, 1 = window, 2 = application.
    const type = Math.round(num(settings.type, 0));
    if (type === 1) {
      return { kind: 'window', sourceId: str(settings.window, 'prompt') || 'prompt', captureSystemAudio };
    }
    if (type === 2) {
      warn(`${quote(name)} captured a whole application in OBS. LIVETAP imports that as a window capture, so pick the window when you go live.`);
      return { kind: 'window', sourceId: 'prompt', captureSystemAudio };
    }
    return { kind: 'screen', sourceId: str(settings.display_uuid, 'prompt') || 'prompt', captureSystemAudio };
  }
  if (WINDOW_IDS.has(obsId)) {
    const sourceId = str(settings.window) || str(settings.capture_window) || 'prompt';
    return { kind: 'window', sourceId: sourceId === '' ? 'prompt' : sourceId, captureSystemAudio };
  }
  const monitor =
    str(settings.monitor_id) ||
    str(settings.display_uuid) ||
    (settings.monitor === undefined ? '' : String(num(settings.monitor, 0))) ||
    (settings.display === undefined ? '' : String(num(settings.display, 0))) ||
    (settings.screen === undefined ? '' : String(num(settings.screen, 0)));
  return { kind: 'screen', sourceId: monitor === '' ? 'prompt' : monitor, captureSystemAudio };
}

interface TextContent {
  text: string;
  fontFamily: string;
  fontSizePx: number;
  color: string;
  background?: string;
  align: 'left' | 'center' | 'right';
  weight: 400 | 500 | 600 | 700 | 800;
}

function textContent(
  obsId: string,
  settings: Record<string, unknown>,
  name: string,
  canvas: { w: number; h: number },
  warn: (message: string) => void,
): TextContent | undefined {
  if (bool(settings.read_from_file, false) || bool(settings.from_file, false)) return undefined;
  const text = str(settings.text);
  if (text.trim() === '') return undefined;

  const font = rec(settings.font);
  const face = str(font.face).trim();
  const obsSize = num(font.size, 48);
  // OBS font size is in canvas pixels; LIVETAP text sizes are relative to a 1080p canvas.
  const fontSizePx = Math.max(8, Math.round(obsSize * (1080 / canvas.h)));

  const flags = Math.round(num(font.flags, 0));
  const styleName = str(font.style).toLowerCase();
  const bold = (flags & 1) === 1 || styleName.includes('bold');

  const alignRaw = str(settings.align, 'left').toLowerCase();
  const align: TextContent['align'] = alignRaw === 'center' || alignRaw === 'right' ? alignRaw : 'left';
  const valign = str(settings.valign, 'top').toLowerCase();
  if (valign === 'center' || valign === 'bottom') {
    warn(`${quote(name)} was aligned to the ${valign} of its box in OBS. LIVETAP positions text by its box, so check where it sits.`);
  }

  // gdiplus keeps the colour in `color`; ft2 in `color1` (plus `color2` for a gradient).
  const color = obsColorToHex(settings.color) ?? obsColorToHex(settings.color1) ?? '#FFFFFF';
  if (obsColorToHex(settings.color) === undefined && obsColorToHex(settings.color1) === undefined) {
    warn(`The text colour on ${quote(name)} could not be read, so white was used.`);
  }
  if (settings.color2 !== undefined && obsColorToHex(settings.color2) !== obsColorToHex(settings.color1)) {
    warn(`${quote(name)} used a two-colour gradient in OBS. LIVETAP imported the first colour only.`);
  }
  if (bool(settings.outline, false) || bool(settings.gradient, false) || bool(settings.chatlog, false)) {
    warn(`${quote(name)} used OBS text extras (outline, gradient or chat log). Those were not imported.`);
  }

  const bkOpacity = num(settings.bk_opacity, 0);
  const background = bkOpacity > 0 ? obsColorWithOpacityToCss(settings.bk_color, bkOpacity) : undefined;

  const result: TextContent = {
    text,
    fontFamily: face === '' ? 'Inter, system-ui, sans-serif' : face,
    fontSizePx,
    color,
    align,
    weight: bold ? 700 : 400,
  };
  if (background !== undefined) result.background = background;
  if (obsId === 'text_ft2_source' || obsId === 'text_ft2_source_v2') {
    warn(`${quote(name)} used the FreeType text source. Fonts may look slightly different in LIVETAP.`);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * The summary paragraph
 * ------------------------------------------------------------------ */

function buildSummary(input: {
  sceneCount: number;
  imported: ImportReport['imported'];
  skipped: ImportReport['skipped'];
  warnings: string[];
}): string {
  const { sceneCount, imported, skipped, warnings } = input;
  const layerTotal = imported.reduce((sum, entry) => sum + entry.layers, 0);
  const sentences: string[] = [];

  sentences.push(
    `Imported ${imported.length} of ${sceneCount} ${plural(sceneCount, 'scene', 'scenes')} with ${layerTotal} ${plural(layerTotal, 'layer', 'layers')}.`,
  );

  const filters = skipped.filter((entry) => entry.kind === 'filter');
  const items = skipped.filter((entry) => entry.kind !== 'filter');

  if (items.length === 0) {
    sentences.push('Everything else in those scenes came across.');
  } else {
    const listed = items.slice(0, 4).map((entry) => `${quote(entry.source)} (${entry.kind})`);
    const rest = items.length - listed.length;
    const tail = rest > 0 ? `, and ${rest} more listed below` : '';
    sentences.push(
      `${items.length} ${plural(items.length, 'item', 'items')} could not be imported: ${listed.join(', ')}${tail}.`,
    );
  }

  if (filters.length > 0) {
    const sourceCount = new Set(filters.map((entry) => entry.source)).size;
    sentences.push(
      `${filters.length} ${plural(filters.length, 'filter', 'filters')} on ${sourceCount} ${plural(sourceCount, 'source', 'sources')} were not imported, because LIVETAP has its own effects.`,
    );
  }

  if (warnings.length > 0) {
    sentences.push(
      `There ${plural(warnings.length, 'is', 'are')} ${warnings.length} ${plural(warnings.length, 'note', 'notes')} to read before you go live.`,
    );
  }

  return sentences.join(' ');
}
