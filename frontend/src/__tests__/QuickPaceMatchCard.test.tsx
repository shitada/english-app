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
  api: {
    getPronunciationSentences: vi.fn().mockResolvedValue({ sentences: [] }),
  },
}));

import QuickPaceMatchCard, {
  PACE_TARGETS,
  TOLERANCE_WPM,
  MAX_HISTORY,
  TARGET_KEY,
  getPaceTargetDef,
  normalizeText,
  computeAccuracy,
  countSpokenWords,
  computeWpm,
  evaluateTempo,
  wpmToGaugePercent,
} from '../components/QuickPaceMatchCard';

beforeEach(() => {
  speakMock.mockClear();
  startMock.mockClear();
  stopMock.mockClear();
  resetMock.mockClear();
  try { if (typeof localStorage !== 'undefined') localStorage.clear(); } catch { /* ignore */ }
});

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

describe('PACE_TARGETS', () => {
  it('exposes slow/natural/fast targets with expected WPM and TTS rates', () => {
    expect(PACE_TARGETS.length).toBe(3);
    const slow = PACE_TARGETS.find(t => t.key === 'slow')!;
    const nat = PACE_TARGETS.find(t => t.key === 'natural')!;
    const fast = PACE_TARGETS.find(t => t.key === 'fast')!;
    expect(slow.wpm).toBe(110);
    expect(nat.wpm).toBe(150);
    expect(fast.wpm).toBe(180);
    expect(slow.ttsRate).toBeCloseTo(0.8);
    expect(nat.ttsRate).toBeCloseTo(1.0);
    expect(fast.ttsRate).toBeCloseTo(1.2);
  });

  it('TOLERANCE_WPM = 15 and MAX_HISTORY = 5 and TARGET_KEY uses the correct localStorage key', () => {
    expect(TOLERANCE_WPM).toBe(15);
    expect(MAX_HISTORY).toBe(5);
    expect(TARGET_KEY).toBe('quick-pace-match-target');
  });
});

describe('getPaceTargetDef', () => {
  it('returns the matching definition by key', () => {
    expect(getPaceTargetDef('slow').wpm).toBe(110);
    expect(getPaceTargetDef('fast').ttsRate).toBeCloseTo(1.2);
  });
  it('falls back to natural for unknown keys', () => {
    // @ts-expect-error intentional
    expect(getPaceTargetDef('weird').key).toBe('natural');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeText / computeAccuracy', () => {
  it('normalizes punctuation and case', () => {
    expect(normalizeText('Hello, World!')).toBe('hello world');
  });
  it('returns 100 for an exact match', () => {
    expect(computeAccuracy('Hello world', 'hello world')).toBe(100);
  });
  it('returns 0 when reference is empty', () => {
    expect(computeAccuracy('', 'anything')).toBe(0);
  });
  it('returns a partial percentage for partial overlap', () => {
    // 2 of 4 reference words present → 50
    expect(computeAccuracy('the quick brown fox', 'the brown')).toBe(50);
  });
});

describe('countSpokenWords', () => {
  it('counts words trimmed and split by whitespace', () => {
    expect(countSpokenWords('  hello   world  ')).toBe(2);
  });
  it('returns 0 for empty/whitespace', () => {
    expect(countSpokenWords('')).toBe(0);
    expect(countSpokenWords('   ')).toBe(0);
  });
});

describe('computeWpm', () => {
  it('computes (words / seconds) * 60', () => {
    // 10 words in 4 seconds → 150 WPM
    expect(computeWpm(10, 4000)).toBe(150);
  });
  it('returns 0 for zero/negative elapsed or zero words', () => {
    expect(computeWpm(0, 1000)).toBe(0);
    expect(computeWpm(5, 0)).toBe(0);
    expect(computeWpm(5, -10)).toBe(0);
  });
});

describe('evaluateTempo', () => {
  it('returns on_pace within ±tolerance', () => {
    const r = evaluateTempo(155, 150);
    expect(r.verdict).toBe('on_pace');
    expect(r.delta).toBe(5);
    expect(r.label).toContain('on pace');
  });
  it('returns too_fast when over tolerance', () => {
    const r = evaluateTempo(180, 150);
    expect(r.verdict).toBe('too_fast');
    expect(r.delta).toBe(30);
    expect(r.label).toContain('too fast');
    expect(r.label).toContain('+30');
  });
  it('returns too_slow when under tolerance', () => {
    const r = evaluateTempo(120, 150);
    expect(r.verdict).toBe('too_slow');
    expect(r.delta).toBe(-30);
    expect(r.label).toContain('too slow');
    expect(r.label).toContain('-30');
  });
  it('treats exactly-tolerance edge as on_pace', () => {
    expect(evaluateTempo(150 + TOLERANCE_WPM, 150).verdict).toBe('on_pace');
    expect(evaluateTempo(150 - TOLERANCE_WPM, 150).verdict).toBe('on_pace');
  });
});

describe('wpmToGaugePercent', () => {
  it('maps min→0 and max→100', () => {
    expect(wpmToGaugePercent(60, 60, 230)).toBe(0);
    expect(wpmToGaugePercent(230, 60, 230)).toBe(100);
  });
  it('clamps out-of-range values', () => {
    expect(wpmToGaugePercent(0, 60, 230)).toBe(0);
    expect(wpmToGaugePercent(999, 60, 230)).toBe(100);
  });
  it('produces a sensible mid value', () => {
    const p = wpmToGaugePercent(145, 60, 230);
    expect(p).toBeGreaterThan(40);
    expect(p).toBeLessThan(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Render smoke test
// ─────────────────────────────────────────────────────────────────────────────

describe('QuickPaceMatchCard render', () => {
  it('renders the card title, target picker, and start button initially', () => {
    const html = renderToStaticMarkup(React.createElement(QuickPaceMatchCard));
    expect(html).toContain('quick-pace-match-card');
    expect(html).toContain('Quick Pace Match');
    expect(html).toContain('qpm-targets');
    expect(html).toContain('qpm-target-slow');
    expect(html).toContain('qpm-target-natural');
    expect(html).toContain('qpm-target-fast');
    expect(html).toContain('qpm-start');
  });

  it('does not render result/marker before user has spoken', () => {
    const html = renderToStaticMarkup(React.createElement(QuickPaceMatchCard));
    expect(html).not.toContain('qpm-result');
    expect(html).not.toContain('qpm-marker');
    expect(html).not.toContain('qpm-delta-badge');
  });

  it('marks the natural target as selected by default', () => {
    const html = renderToStaticMarkup(React.createElement(QuickPaceMatchCard));
    // aria-checked="true" should appear on the natural option
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="qpm-target-natural"/);
  });
});
