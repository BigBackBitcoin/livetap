/**
 * One production, six correctly formatted platform outputs.
 *
 * The claim the landing page makes is that a single composition leaves for six destinations in
 * the shape each one accepts. Saying that is cheap. This draws it: every figure is the SAME
 * picture from `picture.compose()`, re-cropped to its own platform's format, with the platform's
 * own bitrate ceiling and its live state underneath it.
 *
 * The 9:16 outputs carry the chat-safe band, because "your face is not under the chat" is the
 * part of the claim a creator actually cares about.
 */

import { DOT, STATE_LABEL } from './data.js';
import { drawSafeArea } from './picture.js';
import type { ComposedLayer, Picture } from './picture.js';
import type { State } from './data.js';

export interface OutputRow {
  id: string;
  name: string;
  format: '16:9' | '9:16' | '1:1';
  ceilingMbps: number;
  /** One of the DestinationSnapshot states, e.g. `LIVE`. */
  state: string;
  stateLabel: string;
  /** Either the full chip class or its modifier, e.g. `lt-chip lt-chip--live` or `live`. */
  chipClass: string;
}

export interface Outputs {
  update(rows: OutputRow[], layersFor: (format: OutputRow['format']) => ComposedLayer[]): void;
  start(): void;
  stop(): void;
  destroy(): void;
}

/** The preview boxes, in CSS pixels. Small on purpose: six of them sit in one row. */
const SIZE: Record<OutputRow['format'], [number, number]> = {
  '16:9': [176, 99],
  '9:16': [90, 160],
  '1:1': [120, 120],
};

const DISCONNECTED_LABEL = STATE_LABEL.DISCONNECTED;

function chipClassOf(row: OutputRow): string {
  const c = row.chipClass || 'disconnected';
  return c.startsWith('lt-chip') ? c : `lt-chip lt-chip--${c}`;
}

function dotClassOf(row: OutputRow): string {
  const kind = DOT[row.state as State];
  if (kind === 'ring') return 'lt-dot lt-dot--ring';
  if (kind === 'pulse') return 'lt-dot lt-dot--pulse';
  return 'lt-dot';
}

interface Cell {
  row: OutputRow;
  figure: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  chip: HTMLElement;
  dot: HTMLElement;
  label: HTMLElement;
  meta: HTMLElement;
}

export function mountOutputs(
  host: HTMLElement,
  picture: Picture,
  opts: { reduced: boolean; fps?: number },
): Outputs {
  const reduced = opts.reduced;
  const fps = Math.max(1, opts.fps ?? 12);
  const interval = 1000 / fps;
  const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2);

  let cells: Cell[] = [];
  let layersFor: (format: OutputRow['format']) => ComposedLayer[] = () => [];
  let running = false;
  let visible = true;
  let raf = 0;
  let last = 0;

  host.classList.add('ltp-outputs');

  /* --------------------------------------------------------------- building */

  function build(rows: OutputRow[]): void {
    host.replaceChildren();
    cells = rows.map((row) => {
      const [w, h] = SIZE[row.format];
      const figure = document.createElement('figure');
      figure.className = 'ltp-output';
      figure.dataset.ltOutput = row.id;
      figure.innerHTML = `
        <canvas class="ltp-output__canvas" width="${Math.round(w * dpr)}" height="${Math.round(h * dpr)}" style="width:${w}px;height:${h}px" aria-hidden="true"></canvas>
        <figcaption class="ltp-output__cap">
          <span class="ltp-output__name" data-lt-out-name>${row.name}</span>
          <span class="ltp-output__meta" data-lt-out-meta></span>
          <span class="lt-chip lt-chip--disconnected" data-lt-out-chip>
            <span class="lt-dot lt-dot--ring" data-lt-out-dot aria-hidden="true"></span>
            <span class="lt-chip__text"><span class="lt-chip__label" data-lt-out-label>${DISCONNECTED_LABEL}</span></span>
          </span>
        </figcaption>
      `;
      host.append(figure);
      const canvas = figure.querySelector('canvas') as HTMLCanvasElement;
      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = canvas.getContext?.('2d') ?? null;
      } catch {
        /* No 2D context (a test environment, or a browser refusing one). The caption still
           carries every fact the picture carries, so the figure stays useful. */
      }
      if (ctx) ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
      return {
        row,
        figure,
        canvas,
        ctx,
        chip: figure.querySelector('[data-lt-out-chip]') as HTMLElement,
        dot: figure.querySelector('[data-lt-out-dot]') as HTMLElement,
        label: figure.querySelector('[data-lt-out-label]') as HTMLElement,
        meta: figure.querySelector('[data-lt-out-meta]') as HTMLElement,
      };
    });
  }

  function sameShape(rows: OutputRow[]): boolean {
    return (
      cells.length === rows.length &&
      cells.every((c, i) => c.row.id === rows[i]?.id && c.row.format === rows[i]?.format)
    );
  }

  function paint(cell: Cell): void {
    const row = cell.row;
    const off = row.state === 'DISCONNECTED';
    cell.figure.dataset.ltState = row.state;
    cell.figure.classList.toggle('is-off', off);
    cell.meta.textContent = `${row.format} · up to ${row.ceilingMbps} Mbps`;
    const chip = chipClassOf(row);
    if (cell.chip.className !== chip) cell.chip.className = chip;
    const dot = dotClassOf(row);
    if (cell.dot.className !== dot) cell.dot.className = dot;
    const label = off ? DISCONNECTED_LABEL : row.stateLabel;
    if (cell.label.textContent !== label) cell.label.textContent = label;
    cell.figure.setAttribute(
      'aria-label',
      `${row.name}, ${row.format}, up to ${row.ceilingMbps} Mbps, ${label}`,
    );
  }

  /* --------------------------------------------------------------- drawing */

  function placeholder(cell: Cell, ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#1C2027';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(237, 239, 242, 0.38)';
    ctx.font = "600 9px 'Archivo', 'Segoe UI', Helvetica, Arial, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cell.row.name, w / 2, h / 2);
  }

  function drawCell(cell: Cell): void {
    const ctx = cell.ctx;
    if (!ctx) return;
    const [w, h] = SIZE[cell.row.format];
    ctx.clearRect(0, 0, w, h);
    if (cell.row.state === 'DISCONNECTED') {
      placeholder(cell, ctx, w, h);
      return;
    }
    picture.compose(ctx, w, h, layersFor(cell.row.format));
    if (cell.row.format === '9:16') drawSafeArea(ctx, w, h, '9:16');
  }

  function drawAll(): void {
    /*
     * This panel owns its own loop, so it starts its own pass.
     *
     * `beginFrame` invalidates the shared downscale of the camera that every consumer reads from.
     * Without it this loop would draw whatever the thumbnail loop last cached - a frame up to
     * 100 ms stale, and a permanently FROZEN one whenever the thumbnails idle, which they do as
     * soon as no thumbnail is on screen. Six outputs showing a still of the creator while the
     * stage beside them moves is the precise failure this panel exists to disprove.
     */
    picture.beginFrame();
    for (const cell of cells) drawCell(cell);
  }

  function tick(now: number): void {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (!visible || (typeof document !== 'undefined' && document.hidden)) return;
    if (now - last < interval) return;
    last = now;
    drawAll();
  }

  /* ------------------------------------------------------------ visibility */

  let io: IntersectionObserver | null = null;
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((entries) => {
      visible = !!entries[0]?.isIntersecting;
    });
    io.observe(host);
  }

  const onVisibility = (): void => {
    if (typeof document !== 'undefined' && !document.hidden && running && reduced) drawAll();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  /* Under reduced motion nothing loops, so a source change is the only thing that can make the
     previews wrong. One redraw per change is the whole animation budget. */
  const offChange = picture.onChange(() => {
    if (reduced) drawAll();
  });

  function stop(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  return {
    update(rows, next): void {
      layersFor = next;
      if (sameShape(rows)) {
        cells.forEach((c, i) => {
          const r = rows[i];
          if (r) c.row = r;
        });
      } else {
        build(rows);
      }
      cells.forEach(paint);
      drawAll();
    },
    start(): void {
      if (running || reduced) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
    },
    stop,
    destroy(): void {
      stop();
      io?.disconnect();
      io = null;
      offChange();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      host.replaceChildren();
      cells = [];
    },
  };
}
