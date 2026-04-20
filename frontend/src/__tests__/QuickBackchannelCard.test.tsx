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
    isSupported: false, // covers the "skip gracefully" branch by default
    error: null,
    start: startMock,
    stop: stopMock,
    reset: resetMock,
  }),
}));

import QuickBackchannelCard, {
  BACKCHANNEL_PROMPTS,
  CONTEXT_LABELS,
  ROUNDS_PER_SESSION,
  pickRoundPrompts,
  buildChoices,
  isAcceptedChoice,
  evaluateSpokenMatch,
  shuffleArray,
  type BackchannelContext,
} from '../components/QuickBackchannelCard';

beforeEach(() => {
  speakMock.mockClear();
  startMock.mockClear();
  stopMock.mockClear();
  resetMock.mockClear();
  try { if (typeof localStorage !== 'undefined') localStorage.clear(); } catch { /* ignore */ }
});

// ─────────────────────────────────────────────────────────────────────────────
// Bank
// ─────────────────────────────────────────────────────────────────────────────

describe('BACKCHANNEL_PROMPTS bank', () => {
  it('has at least 20 prompts covering all six contexts', () => {
    expect(BACKCHANNEL_PROMPTS.length).toBeGreaterThanOrEqual(20);
    const contexts: BackchannelContext[] = [
      'good_news', 'bad_news', 'surprise', 'agreement', 'mild_disbelief', 'sympathy',
    ];
    for (const c of contexts) {
      expect(BACKCHANNEL_PROMPTS.some(p => p.context === c)).toBe(true);
    }
  });

  it('has unique ids and at least 3 accepted replies per prompt', () => {
    const ids = BACKCHANNEL_PROMPTS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of BACKCHANNEL_PROMPTS) {
      expect(p.accepted.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('has a label and emoji for every context', () => {
    for (const p of BACKCHANNEL_PROMPTS) {
      expect(CONTEXT_LABELS[p.context]).toBeTruthy();
      expect(CONTEXT_LABELS[p.context].emoji.length).toBeGreaterThan(0);
      expect(CONTEXT_LABELS[p.context].label.length).toBeGreaterThan(0);
    }
  });

  it('exposes ROUNDS_PER_SESSION = 5', () => {
    expect(ROUNDS_PER_SESSION).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('pickRoundPrompts', () => {
  it('returns up to N unique prompts', () => {
    const picks = pickRoundPrompts(BACKCHANNEL_PROMPTS, 5, () => 0.5);
    expect(picks.length).toBe(5);
    expect(new Set(picks.map(p => p.id)).size).toBe(picks.length);
  });

  it('returns [] for empty pool', () => {
    expect(pickRoundPrompts([], 5)).toEqual([]);
  });
});

describe('buildChoices', () => {
  it('produces exactly 4 options containing 3 accepted replies + 1 distractor', () => {
    const prompt = BACKCHANNEL_PROMPTS[0];
    const c = buildChoices(prompt, BACKCHANNEL_PROMPTS, () => 0.3);
    expect(c.options.length).toBe(4);
    expect(c.correctSet.size).toBe(3);
    // Distractor must not be in the prompt's accepted replies.
    expect(prompt.accepted).not.toContain(c.distractor);
    // Exactly one option is the distractor.
    const distractorCount = c.options.filter(o => o === c.distractor).length;
    expect(distractorCount).toBe(1);
  });

  it('every accepted choice in the correctSet is part of the prompt accepted list', () => {
    const prompt = BACKCHANNEL_PROMPTS[3];
    const c = buildChoices(prompt, BACKCHANNEL_PROMPTS);
    for (const correct of c.correctSet) {
      expect(prompt.accepted).toContain(correct);
    }
  });
});

describe('isAcceptedChoice', () => {
  it('returns true only for entries in the correct set', () => {
    const set = new Set(['Awesome!', 'Nice!']);
    expect(isAcceptedChoice('Awesome!', set)).toBe(true);
    expect(isAcceptedChoice('Hmm.', set)).toBe(false);
  });
});

describe('evaluateSpokenMatch', () => {
  it('matches a substring case-insensitively against any accepted reply', () => {
    const accepted = ['That\u2019s great!', 'Awesome!', 'Nice!'];
    expect(evaluateSpokenMatch('Yeah, awesome!', accepted)).toBe(true);
    expect(evaluateSpokenMatch('NICE', accepted)).toBe(true);
    expect(evaluateSpokenMatch('I have no idea', accepted)).toBe(false);
  });

  it('returns false on empty transcript', () => {
    expect(evaluateSpokenMatch('   ', ['Nice!'])).toBe(false);
  });
});

describe('shuffleArray', () => {
  it('returns an array of the same length and elements', () => {
    const out = shuffleArray([1, 2, 3, 4, 5], () => 0.1);
    expect(out.length).toBe(5);
    expect(out.slice().sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Component render
// ─────────────────────────────────────────────────────────────────────────────

describe('QuickBackchannelCard render', () => {
  it('renders the card title, replay button, choices grid, and progress', () => {
    const html = renderToStaticMarkup(React.createElement(QuickBackchannelCard));
    expect(html).toContain('quick-backchannel-card');
    expect(html).toContain('Quick Backchannel');
    expect(html).toContain('qbc-replay');
    expect(html).toContain('qbc-choices');
    expect(html).toContain('qbc-progress');
    expect(html).toContain('qbc-speaker');
    expect(html).toContain('qbc-next');
  });

  it('renders 4 choice buttons in the initial round', () => {
    const html = renderToStaticMarkup(React.createElement(QuickBackchannelCard));
    const matches = html.match(/data-testid="qbc-choice-/g) || [];
    expect(matches.length).toBe(4);
  });

  it('does not render summary controls before the session ends', () => {
    const html = renderToStaticMarkup(React.createElement(QuickBackchannelCard));
    expect(html).not.toContain('qbc-summary');
    expect(html).not.toContain('qbc-restart');
  });
});
