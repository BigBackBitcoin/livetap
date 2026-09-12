/**
 * Text wrapping for text layers. Pure: takes a measure function so it is testable in Node
 * without a canvas, and so a fake 2D context works in happy-dom.
 */

export type MeasureText = (text: string) => number;

export interface WrapOptions {
  /** Hard cap on produced lines; extra text is truncated with an ellipsis. */
  maxLines?: number;
}

/**
 * Wrap `text` to `maxWidth` using `measure`.
 * Honours explicit newlines, never loses a word, and breaks a single over-long word by characters.
 */
export function wrapText(text: string, maxWidth: number, measure: MeasureText, options: WrapOptions = {}): string[] {
  const maxLines = options.maxLines && options.maxLines > 0 ? options.maxLines : Number.POSITIVE_INFINITY;
  if (!text) return [];
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return text.split('\n');

  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/).filter((w) => w.length > 0)) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line !== '') {
        out.push(line);
        line = '';
      }
      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }
      const pieces = breakWord(word, maxWidth, measure);
      const last = pieces.pop();
      for (const piece of pieces) out.push(piece);
      line = last ?? '';
    }
    out.push(line);
  }

  if (out.length <= maxLines) return out;
  const kept = out.slice(0, maxLines);
  const lastIndex = kept.length - 1;
  const lastLine = kept[lastIndex];
  if (lastLine !== undefined) kept[lastIndex] = `${lastLine.replace(/\s+$/, '')}…`;
  return kept;
}

function breakWord(word: string, maxWidth: number, measure: MeasureText): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const char of word) {
    const candidate = current + char;
    if (current !== '' && measure(candidate) > maxWidth) {
      pieces.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current !== '') pieces.push(current);
  return pieces.length > 0 ? pieces : [word];
}

/** Approximate width used when a 2D context cannot measure (headless / fake contexts). */
export function approximateWidth(text: string, fontSizePx: number): number {
  return text.length * fontSizePx * 0.55;
}
