import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ReplyPacingMeter,
  computeWpm,
  countWords,
  getPaceZone,
  getZoneColor,
  getCoachingTip,
  wpmToPercent,
} from '../components/conversation/ReplyPacingMeter';

/**
 * The project does not have jsdom + @testing-library/react wired up, so these
 * tests use renderToStaticMarkup to assert on the static initial markup, plus
 * pure helper assertions for color/zone/tip behavior.
 */
describe('ReplyPacingMeter — helpers', () => {
  it('countWords splits whitespace and ignores empties', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('hello world')).toBe(2);
    expect(countWords('  hello   world  there ')).toBe(3);
  });

  it('computeWpm returns words / (seconds/60)', () => {
    expect(computeWpm(0, 10)).toBe(0);
    expect(computeWpm(10, 0)).toBe(0);
    // 30 words in 30 seconds = 60 wpm
    expect(computeWpm(30, 30)).toBe(60);
    // 50 words in 20 seconds = 150 wpm
    expect(computeWpm(50, 20)).toBe(150);
  });

  it('getPaceZone classifies slow / natural / rushed correctly', () => {
    expect(getPaceZone(0)).toBe('slow');
    expect(getPaceZone(99)).toBe('slow');
    expect(getPaceZone(100)).toBe('natural');
    expect(getPaceZone(130)).toBe('natural');
    expect(getPaceZone(160)).toBe('natural');
    expect(getPaceZone(161)).toBe('rushed');
    expect(getPaceZone(220)).toBe('rushed');
  });

  it('wpmToPercent clamps to 0..100 across the gauge range', () => {
    expect(wpmToPercent(0)).toBe(0);
    expect(wpmToPercent(220)).toBe(100);
    expect(wpmToPercent(-10)).toBe(0);
    expect(wpmToPercent(500)).toBe(100);
    expect(wpmToPercent(110)).toBeGreaterThan(0);
    expect(wpmToPercent(110)).toBeLessThan(100);
  });
});

describe('ReplyPacingMeter — zone color (slow/natural/rushed)', () => {
  it('uses blue for a slow WPM', () => {
    expect(getZoneColor(getPaceZone(80))).toBe('#3b82f6');
  });

  it('uses green for a natural WPM', () => {
    expect(getZoneColor(getPaceZone(130))).toBe('#22c55e');
  });

  it('uses orange for a rushed WPM', () => {
    expect(getZoneColor(getPaceZone(180))).toBe('#f97316');
  });

  it('renders the natural color in the rendered markup when finalWpm is natural', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyPacingMeter, {
        transcript: '',
        isRecording: false,
        startedAt: null,
        recentWpms: [],
        finalWpm: 130,
      }),
    );
    expect(html).toContain('#22c55e');
    expect(html).toContain('data-zone="natural"');
  });

  it('renders the rushed color in the rendered markup when finalWpm is rushed', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyPacingMeter, {
        transcript: '',
        isRecording: false,
        startedAt: null,
        recentWpms: [],
        finalWpm: 200,
      }),
    );
    expect(html).toContain('#f97316');
    expect(html).toContain('data-zone="rushed"');
  });

  it('renders the slow color in the rendered markup when finalWpm is slow', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyPacingMeter, {
        transcript: '',
        isRecording: false,
        startedAt: null,
        recentWpms: [],
        finalWpm: 80,
      }),
    );
    expect(html).toContain('#3b82f6');
    expect(html).toContain('data-zone="slow"');
  });
});

describe('ReplyPacingMeter — coaching tip', () => {
  it('returns the natural tip for a natural pace', () => {
    expect(getCoachingTip(130)).toBe('Nice natural pace ✨');
  });

  it('returns the rushed tip for a fast pace', () => {
    expect(getCoachingTip(180)).toBe('Try slowing down for clarity');
  });

  it('returns the slow tip for a slow pace', () => {
    expect(getCoachingTip(70)).toBe('You can speak a touch faster — sounded hesitant');
  });

  it('renders the tip text in the meter when finalWpm is provided', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyPacingMeter, {
        transcript: '',
        isRecording: false,
        startedAt: null,
        recentWpms: [],
        finalWpm: 130,
      }),
    );
    expect(html).toContain('Nice natural pace');
    expect(html).toContain('data-testid="reply-pacing-tip"');
  });

  it('does NOT render the tip while still recording', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyPacingMeter, {
        transcript: 'hello there',
        isRecording: true,
        startedAt: Date.now(),
        recentWpms: [],
        finalWpm: 130,
      }),
    );
    expect(html).not.toContain('data-testid="reply-pacing-tip"');
  });
});

describe('ReplyPacingMeter — render gating', () => {
  it('renders nothing when not recording, no transcript, and no finalWpm', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyPacingMeter, {
        transcript: '',
        isRecording: false,
        startedAt: null,
        recentWpms: [],
      }),
    );
    expect(html).toBe('');
  });

  it('renders nothing when not recording and only whitespace transcript', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyPacingMeter, {
        transcript: '   ',
        isRecording: false,
        startedAt: null,
        recentWpms: [],
      }),
    );
    expect(html).toBe('');
  });

  it('renders the gauge while recording', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyPacingMeter, {
        transcript: 'hello world',
        isRecording: true,
        startedAt: Date.now(),
        recentWpms: [],
      }),
    );
    expect(html).toContain('data-testid="reply-pacing-meter"');
    expect(html).toContain('data-testid="reply-pacing-gauge"');
    expect(html).toContain('data-testid="reply-pacing-needle"');
  });
});

describe('ReplyPacingMeter — sparkline', () => {
  function countMatches(html: string, needle: string): number {
    let count = 0;
    let i = 0;
    while ((i = html.indexOf(needle, i)) !== -1) {
      count++;
      i += needle.length;
    }
    return count;
  }

  it('renders one sparkline point per recent WPM (3 values → 3 points)', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyPacingMeter, {
        transcript: '',
        isRecording: false,
        startedAt: null,
        recentWpms: [80, 130, 200],
        finalWpm: 200,
      }),
    );
    expect(html).toContain('data-testid="reply-pacing-sparkline"');
    expect(countMatches(html, 'data-testid="reply-pacing-sparkline-point"')).toBe(3);
  });

  it('caps sparkline at 5 points even if more values are passed', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyPacingMeter, {
        transcript: '',
        isRecording: false,
        startedAt: null,
        recentWpms: [60, 80, 110, 140, 170, 200, 220],
        finalWpm: 220,
      }),
    );
    expect(countMatches(html, 'data-testid="reply-pacing-sparkline-point"')).toBe(5);
  });

  it('omits the sparkline element entirely when there are no recent WPMs', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyPacingMeter, {
        transcript: 'hi there',
        isRecording: true,
        startedAt: Date.now(),
        recentWpms: [],
      }),
    );
    expect(html).not.toContain('data-testid="reply-pacing-sparkline"');
  });
});
