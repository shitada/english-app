import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ─── Hook mocks ──────────────────────────────────────────────────────────────
const speakMock = vi.fn();
const startMock = vi.fn();
const stopMock = vi.fn();
const resetMock = vi.fn();

vi.mock('../hooks/useSpeechSynthesis', () => ({
  useSpeechSynthesis: () => ({
    speak: speakMock,
    enqueue: vi.fn(),
    flush: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isSupported: true,
    volume: 1,
    setVolume: vi.fn(),
    rate: 1,
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
    start: startMock,
    stop: stopMock,
    reset: resetMock,
  }),
}));

vi.mock('../api', () => ({
  getContrastiveStress: vi.fn().mockResolvedValue({
    sentence: "I didn't say he broke it.",
    words: ["I", "didn't", "say", "he", "broke", "it."],
    options: [
      { word: "I", word_index: 0, meaning: "Someone else said it." },
      { word: "say", word_index: 2, meaning: "I implied it, didn't say it." },
      { word: "he", word_index: 3, meaning: "Someone else broke it." },
      { word: "broke", word_index: 4, meaning: "He did something else to it." },
    ],
    correct_index: 1,
    difficulty: 'intermediate',
  }),
}));

import QuickContrastiveStressCard, {
  buildEmphasizedText,
  transcriptHitsTarget,
} from '../components/QuickContrastiveStressCard';

beforeEach(() => {
  speakMock.mockClear();
  startMock.mockClear();
  stopMock.mockClear();
  resetMock.mockClear();
  try { if (typeof localStorage !== 'undefined') localStorage.clear(); } catch { /* ignore */ }
});

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('buildEmphasizedText', () => {
  it('uppercases the alphabetic part of the stressed word', () => {
    const words = ["I", "didn't", "say", "he", "broke", "it."];
    expect(buildEmphasizedText(words, 3)).toBe("I didn't say HE broke it.");
    expect(buildEmphasizedText(words, 5)).toBe("I didn't say he broke IT.");
  });

  it('returns the original sentence when index is out of range', () => {
    const words = ["one", "two", "three"];
    expect(buildEmphasizedText(words, 99)).toBe("one two three");
    expect(buildEmphasizedText(words, -1)).toBe("one two three");
  });
});

describe('transcriptHitsTarget', () => {
  it('matches when target word is present (case-insensitive)', () => {
    expect(transcriptHitsTarget("i did not say HE broke it", 'he')).toBe(true);
    expect(transcriptHitsTarget("She gave him the book", 'book')).toBe(true);
  });

  it('strips trailing punctuation', () => {
    expect(transcriptHitsTarget("I broke it.", 'it.')).toBe(true);
    expect(transcriptHitsTarget("yes, broke!", 'broke')).toBe(true);
  });

  it('returns false when target is missing or empty', () => {
    expect(transcriptHitsTarget("hello world", 'goodbye')).toBe(false);
    expect(transcriptHitsTarget("hello", '')).toBe(false);
    expect(transcriptHitsTarget("", 'word')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Render smoke test
// ─────────────────────────────────────────────────────────────────────────────

describe('QuickContrastiveStressCard render', () => {
  it('renders the card title without throwing', () => {
    const html = renderToStaticMarkup(React.createElement(QuickContrastiveStressCard));
    expect(html).toContain('Contrastive Stress');
    // Loading state initially (before async fetch resolves).
    expect(html).toMatch(/Loading|No item available/);
  });
});
