import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Tests run in the default node environment (no jsdom). Provide a minimal
// `window` + `localStorage` stub so the component's `localStorage` access
// during render does not throw.
const memStore: Record<string, string> = {};
const fakeLocalStorage = {
  getItem: (k: string) => (k in memStore ? memStore[k] : null),
  setItem: (k: string, v: string) => { memStore[k] = String(v); },
  removeItem: (k: string) => { delete memStore[k]; },
  clear: () => { for (const k of Object.keys(memStore)) delete memStore[k]; },
  key: (i: number) => Object.keys(memStore)[i] ?? null,
  get length() { return Object.keys(memStore).length; },
};
// @ts-expect-error wiring a minimal window stub for SSR rendering.
globalThis.window = globalThis.window || {};
// @ts-expect-error attach localStorage shim.
globalThis.window.localStorage = fakeLocalStorage;

// Mocked speech hook state — mutated per-test so we can simulate listening,
// transcripts, and unsupported-browser scenarios.
const speechState: {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  isSupported: boolean;
  error: string | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
} = {
  transcript: '',
  interimTranscript: '',
  isListening: false,
  isSupported: true,
  error: null,
  start: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
};

vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => speechState,
}));

const ttsSpeak = vi.fn();
vi.mock('../hooks/useSpeechSynthesis', () => ({
  useSpeechSynthesis: () => ({
    speak: ttsSpeak,
    enqueue: vi.fn(),
    flush: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isSupported: true,
    volume: 1,
    setVolume: vi.fn(),
    rate: 0.9,
    setRate: vi.fn(),
  }),
}));

import {
  MistakeReviewDrill,
  normalizeText,
} from '../components/dashboard/MistakeReviewDrill';
import type { MistakeReviewItem } from '../api';

const makeItem = (overrides: Partial<MistakeReviewItem> = {}): MistakeReviewItem => ({
  original: 'I goed to the store',
  correction: 'I went to the store',
  explanation: "Use the past tense 'went'.",
  topic: 'past tense',
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

function resetSpeech() {
  speechState.transcript = '';
  speechState.interimTranscript = '';
  speechState.isListening = false;
  speechState.isSupported = true;
  speechState.error = null;
  speechState.start = vi.fn();
  speechState.stop = vi.fn();
  speechState.reset = vi.fn();
}

beforeEach(() => {
  resetSpeech();
  ttsSpeak.mockClear();
  try { window.localStorage.clear(); } catch (_) { /* ignore */ }
});

describe('normalizeText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeText('  Hello   World ')).toBe('hello world');
  });

  it('strips common punctuation so spoken vs written match', () => {
    expect(normalizeText('I went to the store.')).toBe(normalizeText('i went to the store'));
    expect(normalizeText('Hello, world!')).toBe('hello world');
  });

  it('treats quoted text the same as unquoted', () => {
    expect(normalizeText('"yes"')).toBe('yes');
  });
});

describe('MistakeReviewDrill — Speak Mode toggle', () => {
  it('shows both Type and Speak toggle buttons when speech is supported', () => {
    const html = renderToStaticMarkup(
      React.createElement(MistakeReviewDrill, {
        items: [makeItem()],
        onClose: () => {},
      })
    );
    expect(html).toContain('data-testid="mistake-drill-mode-type"');
    expect(html).toContain('data-testid="mistake-drill-mode-speak"');
    expect(html).toContain('aria-label="Switch to typing mode"');
    expect(html).toContain('aria-label="Switch to speak mode"');
  });

  it('hides the toggle entirely when speech recognition is unsupported', () => {
    speechState.isSupported = false;
    // Even if localStorage is "speak", we should fall back to typing.
    window.localStorage.setItem('mistake_drill_input_mode', 'speak');
    const html = renderToStaticMarkup(
      React.createElement(MistakeReviewDrill, {
        items: [makeItem()],
        onClose: () => {},
      })
    );
    expect(html).not.toContain('data-testid="mistake-drill-mode-speak"');
    expect(html).not.toContain('data-testid="mistake-drill-speak-panel"');
    // Falls back to the typing input.
    expect(html).toContain('placeholder="Type the correction..."');
  });

  it('persists "speak" preference from localStorage and renders the speak panel', () => {
    window.localStorage.setItem('mistake_drill_input_mode', 'speak');
    const html = renderToStaticMarkup(
      React.createElement(MistakeReviewDrill, {
        items: [makeItem()],
        onClose: () => {},
      })
    );
    expect(html).toContain('data-testid="mistake-drill-speak-panel"');
    expect(html).toContain('data-testid="mistake-drill-mic"');
    expect(html).toContain('data-testid="mistake-drill-tts-preview"');
    // Prompt copy switches to the spoken variant.
    expect(html).toContain('Say the corrected version aloud');
  });

  it('defaults to type mode when nothing is stored', () => {
    const html = renderToStaticMarkup(
      React.createElement(MistakeReviewDrill, {
        items: [makeItem()],
        onClose: () => {},
      })
    );
    expect(html).not.toContain('data-testid="mistake-drill-speak-panel"');
    expect(html).toContain('placeholder="Type the correction..."');
  });
});

describe('MistakeReviewDrill — Speak panel content', () => {
  it('exposes aria-live polite transcript region', () => {
    window.localStorage.setItem('mistake_drill_input_mode', 'speak');
    const html = renderToStaticMarkup(
      React.createElement(MistakeReviewDrill, {
        items: [makeItem()],
        onClose: () => {},
      })
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-testid="mistake-drill-transcript"');
  });

  it('shows interim transcript while listening', () => {
    window.localStorage.setItem('mistake_drill_input_mode', 'speak');
    speechState.isListening = true;
    speechState.interimTranscript = 'I went to the';
    const html = renderToStaticMarkup(
      React.createElement(MistakeReviewDrill, {
        items: [makeItem()],
        onClose: () => {},
      })
    );
    expect(html).toContain('I went to the');
    // Mic button is in stop state → aria-pressed true and aria-label "Stop recording"
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Stop recording"');
  });

  it('shows mic button in idle state when not listening', () => {
    window.localStorage.setItem('mistake_drill_input_mode', 'speak');
    const html = renderToStaticMarkup(
      React.createElement(MistakeReviewDrill, {
        items: [makeItem()],
        onClose: () => {},
      })
    );
    expect(html).toContain('aria-label="Start recording"');
    // Mic button aria-pressed should reflect not-listening.
    expect(html).toMatch(/aria-pressed="false"[^>]*data-testid="mistake-drill-mic"/);
  });

  it('renders the speech recognition error message when present', () => {
    window.localStorage.setItem('mistake_drill_input_mode', 'speak');
    speechState.error = 'Microphone access was denied.';
    const html = renderToStaticMarkup(
      React.createElement(MistakeReviewDrill, {
        items: [makeItem()],
        onClose: () => {},
      })
    );
    expect(html).toContain('Microphone access was denied.');
  });
});

describe('MistakeReviewDrill — empty state', () => {
  it('renders an empty state when no items are supplied', () => {
    const html = renderToStaticMarkup(
      React.createElement(MistakeReviewDrill, {
        items: [],
        onClose: () => {},
      })
    );
    expect(html).toContain('No grammar mistakes to review yet.');
    // Toggle should NOT render in the empty state.
    expect(html).not.toContain('data-testid="mistake-drill-mode-speak"');
  });
});
