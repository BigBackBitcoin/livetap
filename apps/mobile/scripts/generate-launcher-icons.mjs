/**
 * Draw the LIVETAP mark into every Android launcher and splash raster the app ships.
 *
 *   node apps/mobile/scripts/generate-launcher-icons.mjs
 *
 * WHY A SCRIPT AND NOT CHECKED-IN ART
 * The mark is defined once, as geometry, in docs/design/DESIGN_SYSTEM.md section 1.2: a rounded
 * square inset 2.5 on a 32 grid with corner radius 8.5, a live dot at (12.5, 16) radius 3, and two
 * 110-degree ripples centred on that dot at radius 6 and 9.5, the outer one at 55% opacity. The
 * same geometry is what `apps/web/index.html` serves as its favicon. Re-typing it into twenty-six
 * PNGs by hand is how a brand drifts; deriving all of them from the numbers above is how it does
 * not. Change the constants here and every density follows.
 *
 * WHY NO IMAGE LIBRARY
 * Nothing is installed for this. The shapes are circles, arcs and a rounded rectangle, all of which
 * have exact signed-distance functions, so the renderer below is a supersampled SDF rasteriser and
 * the encoder is `zlib.deflateSync` plus four PNG chunks. Adding a native image dependency to a
 * node_modules shared by five engineers, to draw four shapes, would be the wrong trade.
 *
 * WHAT IT WRITES (all under apps/mobile/android/app/src/main/res/)
 *   mipmap-DPI, ic_launcher.png             legacy square icon, mark on the brand plate
 *   mipmap-DPI, ic_launcher_round.png       legacy round icon, same mark on a circular plate
 *   mipmap-DPI, ic_launcher_foreground.png  adaptive foreground, transparent, mark in the safe zone
 *   drawable-ORIENTATION-DPI, splash.png    splash screens, mark centred on the app background
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RES = resolve(here, '..', 'android', 'app', 'src', 'main', 'res');

/* ------------------------------------------------------------------ brand constants */

/** docs/design/DESIGN_SYSTEM.md: `--lt-bg-1`, the app-icon plate. */
const PLATE = [0x12, 0x14, 0x17];
/** `--lt-bg-0`, the app background, and `android.backgroundColor` in capacitor.config.ts. */
const SPLASH_BACKGROUND = [0x0b, 0x0b, 0x0f];
/** `--lt-text-primary`: the frame and the ripples. */
const INK = [0xf2, 0xf4, 0xf7];
/** `--lt-accent-live-solid`: the dot, and only ever the dot. */
const LIVE = [0xff, 0x4d, 0x3f];

/** The mark's own grid. Every number below is in these units. */
const GRID = 32;
const FRAME_INSET = 2.5;
const FRAME_RADIUS = 8.5;
const STROKE = 2;
const DOT = { x: 12.5, y: 16, r: 3 };
const RIPPLES = [
  { r: 6, alpha: 1 },
  { r: 9.5, alpha: 0.55 },
];
/** Half of the 110-degree ripple sweep, measured from the +x axis through the dot. */
const RIPPLE_HALF_SWEEP = (55 * Math.PI) / 180;

/** Samples per axis. 6x6 = 36 samples per pixel, which is clean at 48px and cheap at 432px. */
const SUPERSAMPLE = 6;

/* ------------------------------------------------------------------ geometry */

function roundedRectDistance(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * Distance to a circular arc with round caps, centred on `cx, cy`, spanning `±halfSweep` about the
 * +x axis. Inside the sweep it is the distance to the arc itself; outside it is the distance to the
 * nearer endpoint, which is exactly what a round cap draws.
 */
function arcDistance(x, y, cx, cy, radius, halfSweep) {
  const dx = x - cx;
  const dy = y - cy;
  const angle = Math.atan2(dy, dx);
  if (Math.abs(angle) <= halfSweep) return Math.abs(Math.hypot(dx, dy) - radius);
  const capX = cx + radius * Math.cos(halfSweep);
  const capY = radius * Math.sin(halfSweep);
  return Math.min(Math.hypot(x - capX, y - (cy + capY)), Math.hypot(x - capX, y - (cy - capY)));
}

function circleDistance(x, y, cx, cy, radius) {
  return Math.hypot(x - cx, y - cy) - radius;
}

/* ------------------------------------------------------------------ rasteriser */

/**
 * One sample of the mark, in grid units, returned as straight-alpha RGBA.
 *
 * Painter's order matches the SVG: frame, outer ripple, inner ripple, dot. The dot is last so the
 * one red thing in the brand is never dimmed by a ripple crossing it.
 */
function sampleMark(x, y) {
  let rgba = null;
  const paint = (colour, alpha) => {
    if (alpha <= 0) return;
    rgba = rgba === null ? [colour[0], colour[1], colour[2], alpha] : over(colour, alpha, rgba);
  };

  const half = GRID / 2 - FRAME_INSET;
  const frame = Math.abs(roundedRectDistance(x, y, GRID / 2, GRID / 2, half, half, FRAME_RADIUS));
  paint(INK, frame <= STROKE / 2 ? 1 : 0);

  for (const ripple of [...RIPPLES].reverse()) {
    const d = arcDistance(x, y, DOT.x, DOT.y, ripple.r, RIPPLE_HALF_SWEEP);
    if (d <= STROKE / 2) paint(INK, ripple.alpha);
  }

  if (circleDistance(x, y, DOT.x, DOT.y, DOT.r) <= 0) paint(LIVE, 1);

  return rgba;
}

/** Straight-alpha source-over of a solid colour onto an existing straight-alpha pixel. */
function over(colour, alpha, base) {
  const outA = alpha + base[3] * (1 - alpha);
  if (outA === 0) return [0, 0, 0, 0];
  return [
    (colour[0] * alpha + base[0] * base[3] * (1 - alpha)) / outA,
    (colour[1] * alpha + base[1] * base[3] * (1 - alpha)) / outA,
    (colour[2] * alpha + base[2] * base[3] * (1 - alpha)) / outA,
    outA,
  ];
}

/**
 * Render one image.
 *
 * `plate` is 'rounded' (legacy square icon), 'circle' (legacy round icon), 'full' (splash) or
 * 'none' (adaptive foreground, which must be transparent so the OS mask can shape it).
 * `markFraction` is how much of the shorter side the 32-unit mark occupies.
 */
function render({ width, height, plate, plateColour, markFraction }) {
  const pixels = Buffer.alloc(width * height * 4);
  const shortSide = Math.min(width, height);
  const scale = (shortSide * markFraction) / GRID;
  const originX = (width - GRID * scale) / 2;
  const originY = (height - GRID * scale) / 2;
  const plateRadius = shortSide * 0.22;
  const step = 1 / SUPERSAMPLE;
  const offset = step / 2;

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = px + sx * step + offset;
          const y = py + sy * step + offset;

          let pixel = null;
          if (plate === 'full') {
            pixel = [plateColour[0], plateColour[1], plateColour[2], 1];
          } else if (plate === 'rounded') {
            const d = roundedRectDistance(x, y, width / 2, height / 2, width / 2, height / 2, plateRadius);
            if (d <= 0) pixel = [plateColour[0], plateColour[1], plateColour[2], 1];
          } else if (plate === 'circle') {
            if (circleDistance(x, y, width / 2, height / 2, shortSide / 2) <= 0) {
              pixel = [plateColour[0], plateColour[1], plateColour[2], 1];
            }
          }

          const mark = sampleMark((x - originX) / scale, (y - originY) / scale);
          if (mark) {
            pixel = pixel === null ? mark : over([mark[0], mark[1], mark[2]], mark[3], pixel);
          }

          if (pixel) {
            r += pixel[0] * pixel[3];
            g += pixel[1] * pixel[3];
            b += pixel[2] * pixel[3];
            a += pixel[3];
          }
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const alpha = a / samples;
      const i = (py * width + px) * 4;
      // Premultiplied sums back to straight alpha, which is what PNG stores.
      pixels[i] = alpha === 0 ? 0 : Math.round(Math.min(255, r / a));
      pixels[i + 1] = alpha === 0 ? 0 : Math.round(Math.min(255, g / a));
      pixels[i + 2] = alpha === 0 ? 0 : Math.round(Math.min(255, b / a));
      pixels[i + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

/* ------------------------------------------------------------------ PNG encoder */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixels) {
  const stride = width * 4;
  // Filter type 0 (none) on every row. The images are small and mostly flat, so deflate does the
  // work and a filter search would buy bytes nobody is counting.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ the outputs */

/** Launcher densities: mdpi is the 1x baseline and every other row is its multiplier. */
const DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];

/**
 * Splash rasters, at exactly the sizes Capacitor's template shipped. They are replaced rather than
 * resized so `androidScaleType: CENTER_CROP` keeps behaving the way it was configured.
 */
const SPLASHES = [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
];

function write(dir, name, width, height, options) {
  const target = join(RES, dir);
  mkdirSync(target, { recursive: true });
  const bytes = encodePng(width, height, render({ width, height, ...options }));
  writeFileSync(join(target, name), bytes);
  console.log(`  ${dir}/${name}  ${width}x${height}  ${bytes.length} bytes`);
}

console.log('[icons] launcher');
for (const [density, size] of DENSITIES) {
  // 0.68 leaves the mark breathing room inside the plate at the sizes a launcher actually draws.
  write(`mipmap-${density}`, 'ic_launcher.png', size, size, {
    plate: 'rounded',
    plateColour: PLATE,
    markFraction: 0.68,
  });
  write(`mipmap-${density}`, 'ic_launcher_round.png', size, size, {
    plate: 'circle',
    plateColour: PLATE,
    markFraction: 0.62,
  });
  // The adaptive foreground is drawn on a 108dp canvas of which only the central 66dp is guaranteed
  // to survive the OS mask, so the mark is sized to that and the rest is transparent.
  write(`mipmap-${density}`, 'ic_launcher_foreground.png', size * 2.25, size * 2.25, {
    plate: 'none',
    plateColour: PLATE,
    markFraction: 66 / 108,
  });
}

console.log('[icons] splash');
for (const [dir, width, height] of SPLASHES) {
  write(dir, 'splash.png', width, height, {
    plate: 'full',
    plateColour: SPLASH_BACKGROUND,
    markFraction: 0.22,
  });
}

console.log('[icons] done. The adaptive-icon background colour lives in res/values/ic_launcher_background.xml.');
