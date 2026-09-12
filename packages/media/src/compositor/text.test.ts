import { describe, expect, it } from 'vitest';
import { approximateWidth, wrapText } from './text.js';

/** 10px per character - makes the expected wrap points obvious. */
const measure = (text: string): number => text.length * 10;

describe('wrapText', () => {
  it('returns nothing for empty text', () => {
    expect(wrapText('', 100, measure)).toEqual([]);
  });

  it('keeps a short line intact', () => {
    expect(wrapText('Starting soon', 1000, measure)).toEqual(['Starting soon']);
  });

  it('wraps at the last word that fits', () => {
    // "one two" = 70px, "one two three" = 130px -> wraps at 100px.
    expect(wrapText('one two three', 100, measure)).toEqual(['one two', 'three']);
  });

  it('never loses a word', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    const lines = wrapText(text, 120, measure);
    expect(lines.join(' ').split(/\s+/)).toEqual(text.split(' '));
  });

  it('keeps every produced line within the width', () => {
    const lines = wrapText('the quick brown fox jumps over the lazy dog', 150, measure);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(150);
  });

  it('honours explicit newlines', () => {
    expect(wrapText('first\nsecond', 1000, measure)).toEqual(['first', 'second']);
  });

  it('preserves blank lines between paragraphs', () => {
    expect(wrapText('a\n\nb', 1000, measure)).toEqual(['a', '', 'b']);
  });

  it('collapses runs of whitespace inside a paragraph', () => {
    expect(wrapText('a    b', 1000, measure)).toEqual(['a b']);
  });

  it('breaks a single word that is wider than the box', () => {
    const lines = wrapText('abcdefghij', 30, measure);
    expect(lines).toEqual(['abc', 'def', 'ghi', 'j']);
  });

  it('breaks an over-long word that follows normal words', () => {
    const lines = wrapText('hi abcdefghij', 30, measure);
    expect(lines[0]).toBe('hi');
    expect(lines.slice(1).join('')).toBe('abcdefghij');
  });

  it('truncates with an ellipsis at maxLines', () => {
    const lines = wrapText('one two three four five six', 40, measure, { maxLines: 2 });
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith('…')).toBe(true);
  });

  it('does not truncate when the text already fits maxLines', () => {
    const lines = wrapText('one two', 1000, measure, { maxLines: 4 });
    expect(lines).toEqual(['one two']);
  });

  it('degrades to raw lines for an unusable width', () => {
    expect(wrapText('a b', 0, measure)).toEqual(['a b']);
    expect(wrapText('a\nb', Number.NaN, measure)).toEqual(['a', 'b']);
  });
});

describe('approximateWidth', () => {
  it('grows with text length and font size', () => {
    expect(approximateWidth('abcd', 100)).toBeGreaterThan(approximateWidth('ab', 100));
    expect(approximateWidth('abcd', 200)).toBeGreaterThan(approximateWidth('abcd', 100));
  });

  it('is zero for empty text', () => {
    expect(approximateWidth('', 96)).toBe(0);
  });
});
