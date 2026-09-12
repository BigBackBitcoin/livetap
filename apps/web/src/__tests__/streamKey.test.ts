import { describe, expect, it } from 'vitest';
import { keyProblem, urlProblem } from '../components/StreamKeyForm.js';

/**
 * "Invalid URL" is the string this product is designed against. Every message here names the
 * mistake and the fix, in that order.
 */
describe('stream-key form validation', () => {
  it('asks for a server address rather than saying a field is required', () => {
    expect(urlProblem('')).toContain('The platform shows it next to your stream key.');
  });

  it('recognises a web page address and says what a stream server looks like instead', () => {
    const message = urlProblem('https://twitch.tv/latenightbuild');
    expect(message).toContain('That looks like a web page address, not a stream server.');
    expect(message).toContain('rtmp://');
  });

  it('rejects an address with characters that could not be sent safely', () => {
    expect(urlProblem('rtmp://live.example.com/app;rm -rf')).toBeTruthy();
  });

  it('accepts a well-formed server address', () => {
    expect(urlProblem('rtmp://live.example.com/app')).toBeUndefined();
    expect(urlProblem('rtmps://live.example.com/app')).toBeUndefined();
  });

  it('asks for a key, and says where to find it', () => {
    expect(keyProblem('   ')).toContain('live dashboard');
  });

  it('catches the commonest paste mistake: a space in the key', () => {
    expect(keyProblem('live_123 456')).toContain('Copy it again');
  });

  it('accepts a real key', () => {
    expect(keyProblem('live_123456789_abcdefgh')).toBeUndefined();
  });
});
