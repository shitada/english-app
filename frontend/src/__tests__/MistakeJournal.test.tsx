import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Minimal window stub for SSR-style render.
// @ts-expect-error wiring a minimal window stub for SSR rendering.
globalThis.window = globalThis.window || {};

// --- Mocked speech recognition ---------------------------------------------
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
const ttsStop = vi.fn();
const ttsState = { isSpeaking: false, isSupported: true };
vi.mock('../hooks/useSpeechSynthesis', () => ({
  useSpeechSynthesis: () => ({
    speak: ttsSpeak,
    enqueue: vi.fn(),
    flush: vi.fn(),
    stop: ttsStop,
    isSpeaking: ttsState.isSpeaking,
    isSupported: ttsState.isSupported,
    volume: 1,
    setVolume: vi.fn(),
    rate: 1,
    setRate: vi.fn(),
  }),
}));

import {
  MistakeJournal,
  getTargetText,
  shadowBadge,
} from '../components/dashboard/MistakeJournal';
import type { MistakeItem } from '../api';

function reset() {
  speechState.transcript = '';
  speechState.interimTranscript = '';
  speechState.isListening = false;
  speechState.isSupported = true;
  speechState.error = null;
  speechState.start = vi.fn();
  speechState.stop = vi.fn();
  speechState.reset = vi.fn();
  ttsSpeak.mockClear();
  ttsStop.mockClear();
  ttsState.isSpeaking = false;
  ttsState.isSupported = true;
}

beforeEach(reset);

const grammarItem: MistakeItem = {
  module: 'grammar',
  created_at: '2024-01-01T00:00:00Z',
  detail: {
    original: 'I goed there',
    correction: 'I went there',
    explanation: "Past tense of 'go' is 'went'.",
  } as any,
} as any;

const pronItem: MistakeItem = {
  module: 'pronunciation',
  created_at: '2024-01-01T00:00:00Z',
  detail: {
    reference_text: 'comfortable chair',
    user_transcription: 'comfetable chair',
    score: 4,
  } as any,
} as any;

const vocabItem: MistakeItem = {
  module: 'vocabulary',
  created_at: '2024-01-01T00:00:00Z',
  detail: {
    word: 'serendipity',
    meaning: 'a happy accident',
  } as any,
} as any;

const baseProps = {
  filter: 'all' as const,
  setFilter: () => {},
  total: 1,
  onLoadMore: () => {},
};

describe('getTargetText', () => {
  it('returns correction for grammar', () => {
    expect(getTargetText(grammarItem)).toBe('I went there');
  });
  it('returns reference_text for pronunciation', () => {
    expect(getTargetText(pronItem)).toBe('comfortable chair');
  });
  it('returns word for vocabulary', () => {
    expect(getTargetText(vocabItem)).toBe('serendipity');
  });
});

describe('shadowBadge', () => {
  it('returns ✅ for >= 90%', () => {
    expect(shadowBadge(90).emoji).toBe('✅');
    expect(shadowBadge(100).emoji).toBe('✅');
  });
  it('returns 👍 for 60–89%', () => {
    expect(shadowBadge(60).emoji).toBe('👍');
    expect(shadowBadge(89).emoji).toBe('👍');
  });
  it('returns 🔁 below 60%', () => {
    expect(shadowBadge(0).emoji).toBe('🔁');
    expect(shadowBadge(59).emoji).toBe('🔁');
  });
});

describe('MistakeJournal — Listen + Shadow buttons', () => {
  it('renders Listen and Shadow buttons on each card when speech is supported', () => {
    const html = renderToStaticMarkup(
      React.createElement(MistakeJournal, {
        ...baseProps,
        mistakes: [grammarItem, pronItem, vocabItem],
        total: 3,
      })
    );
    // Three cards × Listen + Shadow.
    const listenCount = (html.match(/data-testid="mistake-card-listen"/g) || []).length;
    const shadowCount = (html.match(/data-testid="mistake-card-shadow"/g) || []).length;
    expect(listenCount).toBe(3);
    expect(shadowCount).toBe(3);
    expect(html).toContain('Listen 🔊');
    expect(html).toContain('Shadow 🎤');
  });

  it('hides the Shadow button when SpeechRecognition is unsupported', () => {
    speechState.isSupported = false;
    const html = renderToStaticMarkup(
      React.createElement(MistakeJournal, {
        ...baseProps,
        mistakes: [grammarItem],
      })
    );
    expect(html).toContain('data-testid="mistake-card-listen"');
    expect(html).not.toContain('data-testid="mistake-card-shadow"');
  });

  it('still renders the Listen button for vocabulary cards', () => {
    const html = renderToStaticMarkup(
      React.createElement(MistakeJournal, {
        ...baseProps,
        mistakes: [vocabItem],
      })
    );
    expect(html).toContain('data-testid="mistake-card-listen"');
    expect(html).toContain('serendipity');
  });

  it('exposes aria-live transcript region while listening', () => {
    speechState.isListening = true;
    speechState.interimTranscript = 'I went';
    const html = renderToStaticMarkup(
      React.createElement(MistakeJournal, {
        ...baseProps,
        mistakes: [grammarItem],
      })
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('I went');
    // Mic button reflects pressed state.
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Stop shadow recording"');
  });

  it('renders empty-state message when no mistakes', () => {
    const html = renderToStaticMarkup(
      React.createElement(MistakeJournal, {
        ...baseProps,
        mistakes: [],
        total: 0,
      })
    );
    expect(html).toContain('No mistakes recorded yet');
    expect(html).not.toContain('data-testid="mistake-card-listen"');
  });
});
