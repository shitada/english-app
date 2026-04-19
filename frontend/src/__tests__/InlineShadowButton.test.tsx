import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Mock hooks BEFORE importing the component so the mocked module is used.
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

vi.mock('../api', () => ({
  api: {
    checkPronunciation: vi.fn(async () => ({
      overall_score: 82,
      overall_feedback: 'good',
      word_feedback: [],
      focus_areas: [],
    })),
  },
}));

import {
  InlineShadowButton,
  splitIntoShadowableLines,
} from '../components/conversation/InlineShadowButton';

describe('splitIntoShadowableLines', () => {
  it('returns [] for empty/whitespace input', () => {
    expect(splitIntoShadowableLines('')).toEqual([]);
    expect(splitIntoShadowableLines('   ')).toEqual([]);
  });

  it('returns [] for non-string input', () => {
    // @ts-expect-error testing runtime guard
    expect(splitIntoShadowableLines(null)).toEqual([]);
    // @ts-expect-error testing runtime guard
    expect(splitIntoShadowableLines(undefined)).toEqual([]);
  });

  it('rejects sentences shorter than 4 words', () => {
    expect(splitIntoShadowableLines('Hi there friend.')).toEqual([]);
    expect(splitIntoShadowableLines('Yes!')).toEqual([]);
  });

  it('rejects sentences longer than 18 words', () => {
    const long =
      'This is a very long sentence that definitely contains more than eighteen total individual english words inside of it for testing purposes today.';
    expect(splitIntoShadowableLines(long)).toEqual([]);
  });

  it('keeps sentences whose word count is between 4 and 18 inclusive', () => {
    const text = 'I had a great day today. Yes! Let us practice some more english together now.';
    const out = splitIntoShadowableLines(text);
    expect(out.length).toBe(2);
    expect(out[0]).toMatch(/great day today/);
    expect(out[1]).toMatch(/practice some more english/);
  });

  it('handles multiple sentence terminators (., !, ?)', () => {
    const text = 'How was your weekend trip? I went hiking with my friends. It was really fun!';
    const out = splitIntoShadowableLines(text);
    expect(out.length).toBe(3);
  });

  it('normalizes excessive whitespace', () => {
    const text = 'I    really   enjoyed    that movie last night.';
    const out = splitIntoShadowableLines(text);
    expect(out.length).toBe(1);
    expect(out[0]).not.toMatch(/  /);
  });

  it('returns first qualifying sentence at index 0', () => {
    const text = 'Hi! I had a wonderful conversation with my colleague yesterday.';
    const out = splitIntoShadowableLines(text);
    expect(out[0]).toMatch(/wonderful conversation/);
  });
});

describe('InlineShadowButton render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no shadowable line exists', () => {
    const html = renderToStaticMarkup(
      React.createElement(InlineShadowButton, { text: 'Hi.' })
    );
    expect(html).toBe('');
  });

  it('renders the play button with aria-label "Shadow this line" in idle state', () => {
    const html = renderToStaticMarkup(
      React.createElement(InlineShadowButton, {
        text: 'Let us practice some english together today.',
      })
    );
    expect(html).toContain('aria-label="Shadow this line"');
    expect(html).toContain('data-testid="inline-shadow-button"');
  });

  it('does not render the result pill in initial render', () => {
    const html = renderToStaticMarkup(
      React.createElement(InlineShadowButton, {
        text: 'I really enjoyed that movie last night with my friends.',
      })
    );
    expect(html).not.toContain('Pronunciation:');
  });
});
