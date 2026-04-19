import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock hooks BEFORE importing the component.
vi.mock('../hooks/useSpeechSynthesis', () => ({
  useSpeechSynthesis: () => ({
    speak: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isSupported: true,
    volume: 1,
    setVolume: vi.fn(),
    rate: 0.85,
    setRate: vi.fn(),
  }),
}));

vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    transcript: '',
    interimTranscript: '',
    isListening: false,
    isSupported: true,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  }),
}));

import {
  MissedWordDrill,
  normalizeWord,
  transcriptMatches,
  buildExamplePhrase,
} from '../components/pronunciation/MissedWordDrill';

describe('normalizeWord', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeWord('Hello!')).toBe('hello');
    expect(normalizeWord('  WORLD,  ')).toBe('world');
    expect(normalizeWord("don't")).toBe("don't");
  });

  it('returns empty string for falsy input', () => {
    expect(normalizeWord('')).toBe('');
    // @ts-expect-error testing runtime guard
    expect(normalizeWord(null)).toBe('');
    // @ts-expect-error testing runtime guard
    expect(normalizeWord(undefined)).toBe('');
  });
});

describe('transcriptMatches', () => {
  it('matches exact word case-insensitively', () => {
    expect(transcriptMatches('Hello', 'hello')).toBe(true);
    expect(transcriptMatches('HELLO', 'hello')).toBe(true);
  });

  it('matches a target word that appears as a token in the transcript', () => {
    expect(transcriptMatches('I said hello there', 'hello')).toBe(true);
    expect(transcriptMatches('the apple is red', 'apple')).toBe(true);
  });

  it('strips punctuation when matching', () => {
    expect(transcriptMatches('Hello!', 'hello')).toBe(true);
    expect(transcriptMatches('Yes, hello.', 'hello')).toBe(true);
  });

  it('rejects partial / substring matches', () => {
    expect(transcriptMatches('helloworld', 'hello')).toBe(false);
    expect(transcriptMatches('appletree', 'apple')).toBe(false);
  });

  it('rejects empty target or transcript', () => {
    expect(transcriptMatches('', 'hello')).toBe(false);
    expect(transcriptMatches('hello', '')).toBe(false);
  });

  it('rejects mismatched words', () => {
    expect(transcriptMatches('goodbye', 'hello')).toBe(false);
  });
});

describe('buildExamplePhrase', () => {
  it('wraps the word in a short prompt phrase', () => {
    const out = buildExamplePhrase('hello');
    expect(out).toContain('Say:');
    expect(out).toContain('hello');
  });

  it('handles whitespace input', () => {
    expect(buildExamplePhrase('  hi  ')).toContain('hi');
  });
});

describe('MissedWordDrill render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when words list is empty', () => {
    const html = renderToStaticMarkup(
      React.createElement(MissedWordDrill, {
        words: [],
        onRetrySentence: () => {},
        onDone: () => {},
      })
    );
    expect(html).toBe('');
  });

  it('renders the drill panel with the first word and progress strip', () => {
    const html = renderToStaticMarkup(
      React.createElement(MissedWordDrill, {
        words: ['apple', 'banana', 'cherry'],
        onRetrySentence: () => {},
        onDone: () => {},
      })
    );
    expect(html).toContain('data-testid="missed-word-drill-panel"');
    expect(html).toContain('data-testid="missed-word-drill-current"');
    expect(html).toContain('apple');
    // Progress strip: "Word 1 / 3"
    expect(html).toContain('Word 1 / 3');
    // First word is current (*), others upcoming (○)
    expect(html).toMatch(/\*○○/);
  });

  it('shows the heading "Drill Missed Words"', () => {
    const html = renderToStaticMarkup(
      React.createElement(MissedWordDrill, {
        words: ['hello'],
        onRetrySentence: () => {},
        onDone: () => {},
      })
    );
    expect(html).toContain('Drill Missed Words');
  });

  it('includes Listen carefully hint in initial preview stage', () => {
    const html = renderToStaticMarkup(
      React.createElement(MissedWordDrill, {
        words: ['hello'],
        onRetrySentence: () => {},
        onDone: () => {},
      })
    );
    expect(html).toContain('Listen carefully');
  });
});
