import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  MissedWordsDrill,
  getMissedWords,
  handleDrillChipClick,
  playAllMissed,
  DRILL_RATE,
} from '../components/shadowing/MissedWordsDrill';

describe('getMissedWords', () => {
  it('returns expected words not present in transcript (case-insensitive)', () => {
    expect(getMissedWords('The quick brown fox', 'the FOX runs')).toEqual([
      'quick',
      'brown',
    ]);
  });

  it('returns [] when every expected word appears in transcript', () => {
    expect(getMissedWords('hello world', 'hello world today')).toEqual([]);
  });

  it('deduplicates repeated missed words', () => {
    expect(getMissedWords('go go go home', 'home')).toEqual(['go']);
  });

  it('handles empty inputs gracefully', () => {
    expect(getMissedWords('', '')).toEqual([]);
    expect(getMissedWords('hi', '')).toEqual(['hi']);
  });
});

describe('handleDrillChipClick', () => {
  it('calls speak with the word, en-US locale, and rate=0.7', () => {
    const speak = vi.fn();
    handleDrillChipClick('apple', speak);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith('apple', 'en-US', DRILL_RATE);
    expect(DRILL_RATE).toBe(0.7);
  });

  it('is a no-op for empty word', () => {
    const speak = vi.fn();
    handleDrillChipClick('', speak);
    expect(speak).not.toHaveBeenCalled();
  });
});

describe('playAllMissed', () => {
  it('speaks each word once at rate 0.7 (in order) using injected schedule', () => {
    const speak = vi.fn();
    const schedule = (cb: () => void) => cb(); // run scheduled callbacks immediately
    playAllMissed(['alpha', 'beta', 'gamma'], speak, { schedule });
    expect(speak).toHaveBeenCalledTimes(3);
    expect(speak).toHaveBeenNthCalledWith(1, 'alpha', 'en-US', DRILL_RATE);
    expect(speak).toHaveBeenNthCalledWith(2, 'beta', 'en-US', DRILL_RATE);
    expect(speak).toHaveBeenNthCalledWith(3, 'gamma', 'en-US', DRILL_RATE);
  });

  it('does nothing for empty list', () => {
    const speak = vi.fn();
    playAllMissed([], speak, { schedule: (cb) => cb() });
    expect(speak).not.toHaveBeenCalled();
  });

  it('schedules subsequent words with increasing delays', () => {
    const speak = vi.fn();
    const calls: number[] = [];
    const schedule = (cb: () => void, ms: number) => {
      calls.push(ms);
      cb();
    };
    playAllMissed(['a', 'b', 'c'], speak, { schedule, gapMs: 500 });
    // First word fires synchronously (no schedule call); subsequent ones at 1*gap, 2*gap.
    expect(calls).toEqual([500, 1000]);
  });
});

describe('MissedWordsDrill render', () => {
  it('renders a chip per missed word with the drill testid', () => {
    const html = renderToStaticMarkup(
      React.createElement(MissedWordsDrill, {
        expected: 'The quick brown fox',
        transcript: 'the fox',
        speak: () => {},
      }),
    );
    expect(html).toContain('data-testid="missed-words-drill"');
    // Two missed words → two chips.
    const chipMatches = html.match(/data-testid="missed-word-chip"/g) || [];
    expect(chipMatches.length).toBe(2);
    expect(html).toContain('quick');
    expect(html).toContain('brown');
    // Bulk-play button.
    expect(html).toContain('data-testid="drill-play-all"');
    expect(html).toContain('Play all slowly');
    expect(html).toContain('Drill missed words');
  });

  it('shows the perfect-state celebration when no words are missed', () => {
    const html = renderToStaticMarkup(
      React.createElement(MissedWordsDrill, {
        expected: 'hello world',
        transcript: 'hello world',
        speak: () => {},
      }),
    );
    expect(html).toContain('data-testid="drill-perfect-state"');
    expect(html).toContain('Perfect — no drill needed 🎉');
    expect(html).not.toContain('data-testid="missed-word-chip"');
    expect(html).not.toContain('data-testid="drill-play-all"');
  });

  it('aria-labels include the word for accessibility', () => {
    const html = renderToStaticMarkup(
      React.createElement(MissedWordsDrill, {
        expected: 'banana',
        transcript: '',
        speak: () => {},
      }),
    );
    expect(html).toContain('aria-label="Hear &quot;banana&quot; slowly"');
    expect(html).toContain('aria-label="Play all missed words slowly"');
  });
});
