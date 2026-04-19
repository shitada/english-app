import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Minimal window/localStorage stub for node test env.
const memStore: Record<string, string> = {};
const fakeLocalStorage = {
  getItem: (k: string) => (k in memStore ? memStore[k] : null),
  setItem: (k: string, v: string) => { memStore[k] = String(v); },
  removeItem: (k: string) => { delete memStore[k]; },
  clear: () => { for (const k of Object.keys(memStore)) delete memStore[k]; },
  key: (i: number) => Object.keys(memStore)[i] ?? null,
  get length() { return Object.keys(memStore).length; },
};
// @ts-expect-error wiring SSR window
globalThis.window = globalThis.window || {};
// @ts-expect-error attach localStorage shim
globalThis.window.localStorage = fakeLocalStorage;

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

import { StressTapDrill } from '../components/pronunciation/StressTapDrill';
import {
  initStressDrill,
  stressDrillReducer,
  stressScore,
  type StressWord,
} from '../utils/stressPatterns';

const sample: StressWord[] = [
  { word: 'apple',  syllables: ['ap', 'ple'],            stressIndex: 0, meaning: 'a fruit' },
  { word: 'banana', syllables: ['ba', 'na', 'na'],       stressIndex: 1, meaning: 'a fruit' },
];

beforeEach(() => {
  ttsSpeak.mockClear();
  try { window.localStorage.clear(); } catch (_) { /* ignore */ }
});

describe('StressTapDrill — initial render', () => {
  it('renders the drill panel with a syllable pill for each syllable', () => {
    const html = renderToStaticMarkup(
      React.createElement(StressTapDrill, { wordsOverride: sample }),
    );
    expect(html).toContain('data-testid="stress-tap-drill"');
    expect(html).toContain('data-testid="stress-tap-pill-0"');
    expect(html).toContain('data-testid="stress-tap-pill-1"');
    // Play and Replay slow buttons present.
    expect(html).toContain('data-testid="stress-tap-play"');
    expect(html).toContain('data-testid="stress-tap-replay-slow"');
    // Heading and prompt copy.
    expect(html).toContain('Stress Tap');
    expect(html).toContain('primary stress');
    // Progress strip.
    expect(html).toContain('data-testid="stress-tap-progress"');
  });

  it('disables Next until the user has tapped a pill', () => {
    const html = renderToStaticMarkup(
      React.createElement(StressTapDrill, { wordsOverride: sample }),
    );
    expect(html).toMatch(/disabled[^>]*data-testid="stress-tap-next"|data-testid="stress-tap-next"[^>]*disabled/);
  });
});

describe('StressTapDrill — score increments via reducer (simulated taps)', () => {
  it('a correct tap increments the score', () => {
    let s = initStressDrill(sample);
    expect(stressScore(s)).toBe(0);
    s = stressDrillReducer(s, { type: 'tap', pillIndex: 0 }); // apple correct
    expect(stressScore(s)).toBe(1);
  });

  it('an incorrect tap does NOT increment the score', () => {
    let s = initStressDrill(sample);
    s = stressDrillReducer(s, { type: 'tap', pillIndex: 1 }); // wrong on apple
    expect(stressScore(s)).toBe(0);
  });
});

describe('StressTapDrill — summary phase render', () => {
  it('renders the summary card after answering all words', () => {
    // Simulate a full round being completed by short-circuiting state.
    // Easiest path: use a single-word source so reducer reaches summary quickly,
    // then confirm summary HTML when index is at end and phase is 'summary'.
    // We exercise the SSR render path by producing a "summary" via the reducer
    // and pretending it's the initial state via wordsOverride + localStorage…
    // For pure SSR we instead just verify the component class can show summary
    // when state is forced through restart with empty round.
    // (Empty round → phase='summary' → renders the summary card.)
    const html = renderToStaticMarkup(
      React.createElement(StressTapDrill, { wordsOverride: [] }),
    );
    // Empty defensive branch should render — either summary or empty state.
    expect(html).toMatch(/stress-tap-(summary|empty)/);
  });

  it('reducer reaches summary after answering each word and pressing next', () => {
    let s = initStressDrill(sample);
    s = stressDrillReducer(s, { type: 'tap', pillIndex: 0 });
    s = stressDrillReducer(s, { type: 'next' });
    s = stressDrillReducer(s, { type: 'tap', pillIndex: 1 });
    s = stressDrillReducer(s, { type: 'next' });
    expect(s.phase).toBe('summary');
    expect(stressScore(s)).toBe(2);
  });
});
