import { describe, it, expect } from 'vitest';
import { sanitizeForSpeech } from './sanitizeForSpeech';

describe('sanitizeForSpeech', () => {
  it('returns plain text unchanged', () => {
    expect(sanitizeForSpeech('Hello, how are you today?')).toBe(
      'Hello, how are you today?',
    );
  });

  it('strips a single emoticon emoji', () => {
    expect(sanitizeForSpeech('Hello 😄 world')).toBe('Hello world');
  });

  it('strips a flag emoji (regional indicator pair)', () => {
    expect(sanitizeForSpeech('I love 🇯🇵 ramen')).toBe('I love ramen');
  });

  it('strips a ZWJ family sequence', () => {
    expect(sanitizeForSpeech('Family: 👨‍👩‍👧‍👦 here')).toBe('Family: here');
  });

  it('strips skin-tone modifiers along with the base emoji', () => {
    expect(sanitizeForSpeech('Wave 👋🏽 hi')).toBe('Wave hi');
  });

  it('strips a heart with VS16 variation selector', () => {
    expect(sanitizeForSpeech('Love it ❤️ a lot')).toBe('Love it a lot');
  });

  it('returns empty string when input is all emoji', () => {
    expect(sanitizeForSpeech('😀😄🎉🔥✨')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeForSpeech('')).toBe('');
  });

  it('collapses whitespace and trims after stripping', () => {
    expect(sanitizeForSpeech('  🎉  hello   🚀  world  ')).toBe('hello world');
  });
});
