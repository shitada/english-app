import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('react-router-dom', () => ({
  Link: (props: { to: string; children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement(
      'a',
      { ...props, href: typeof props.to === 'string' ? props.to : '#' },
      props.children,
    ),
}));

vi.mock('../hooks/useSpeechSynthesis', () => ({
  useSpeechSynthesis: () => ({
    speak: () => {},
    enqueue: () => {},
    flush: () => {},
    stop: () => {},
    isSpeaking: false,
    isSupported: true,
    volume: 1,
    setVolume: () => {},
    rate: 1,
    setRate: () => {},
  }),
}));

vi.mock('../api', () => ({
  startSpeedLadder: () => Promise.resolve({}),
  answerSpeedLadder: () => Promise.resolve({}),
}));

import SpeedLadderDrill, { summarize, speedKey, speedLabel } from '../pages/SpeedLadderDrill';

describe('SpeedLadderDrill helpers', () => {
  it('speedKey normalizes trailing zero', () => {
    expect(speedKey(1.0)).toBe('1');
    expect(speedKey(0.8)).toBe('0.8');
    expect(speedKey(1.25)).toBe('1.25');
  });

  it('speedLabel includes an icon for each known speed', () => {
    expect(speedLabel(0.8)).toMatch(/🐢/);
    expect(speedLabel(1.0)).toMatch(/🚶/);
    expect(speedLabel(1.25)).toMatch(/🏃/);
  });

  it('summarize counts per-speed accuracy', () => {
    const s = summarize([
      { speed: 0.8, correct: true },
      { speed: 1.0, correct: false },
      { speed: 1.25, correct: true },
    ]);
    expect(s.total).toBe(3);
    expect(s.totalCorrect).toBe(2);
    expect(s.accuracyBySpeed['0.8']).toBe(1);
    expect(s.accuracyBySpeed['1']).toBe(0);
    expect(s.accuracyBySpeed['1.25']).toBe(1);
    // Recommendation triggered by 1.0 miss.
    expect(s.recommendation.toLowerCase()).toContain('1.0');
  });

  it('summarize recommends another passage when perfect', () => {
    const s = summarize([
      { speed: 0.8, correct: true },
      { speed: 1.0, correct: true },
      { speed: 1.25, correct: true },
    ]);
    expect(s.totalCorrect).toBe(3);
    expect(s.recommendation.toLowerCase()).toMatch(/excellent|harder/);
  });
});

describe('SpeedLadderDrill SSR', () => {
  it('renders the idle start button on initial SSR', () => {
    const html = renderToStaticMarkup(React.createElement(SpeedLadderDrill));
    expect(html).toContain('data-testid="speed-ladder-title"');
    expect(html).toContain('data-testid="speed-ladder-start"');
    expect(html).toContain('Listening Speed Ladder');
  });
});
