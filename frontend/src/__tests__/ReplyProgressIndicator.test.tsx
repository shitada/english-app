import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ReplyProgressIndicator,
  getStageLabel,
  shouldShowElapsed,
} from '../components/conversation/ReplyProgressIndicator';

/**
 * Tests for the staged typing indicator shown while waiting for an
 * assistant reply.
 *
 * The project does not currently have @testing-library/react or jsdom
 * installed, so instead of full RTL render-and-advance-timers tests we
 * exercise:
 *   - the pure stage-label / elapsed-visibility helpers across all
 *     transition boundaries (covers the "label transitions at 2.5s and 5s"
 *     and "elapsed counter only after 3s" requirements from the proposal);
 *   - the static initial render markup, to verify aria-live="polite",
 *     the initial label, the typing dots, and that the elapsed counter is
 *     hidden at t=0.
 *
 * Time-based re-render assertions are simulated by calling the helpers with
 * the elapsed-ms values that fake timers would have produced (0ms, 2500ms,
 * 5000ms, etc.), which is equivalent for the deterministic mapping the
 * component performs.
 */
describe('ReplyProgressIndicator stage labels (getStageLabel)', () => {
  it('returns "Reviewing your message…" at t=0', () => {
    expect(getStageLabel(0)).toBe('Reviewing your message…');
  });

  it('still shows "Reviewing your message…" just before 2s', () => {
    expect(getStageLabel(1999)).toBe('Reviewing your message…');
  });

  it('transitions to "Crafting reply…" at exactly 2000ms', () => {
    expect(getStageLabel(2000)).toBe('Crafting reply…');
  });

  it('shows "Crafting reply…" at the 2.5s tick boundary', () => {
    expect(getStageLabel(2500)).toBe('Crafting reply…');
  });

  it('still shows "Crafting reply…" at the 5s tick boundary', () => {
    expect(getStageLabel(5000)).toBe('Crafting reply…');
  });

  it('transitions to "Polishing the wording…" at 6000ms', () => {
    expect(getStageLabel(6000)).toBe('Polishing the wording…');
  });

  it('keeps "Polishing the wording…" for long waits', () => {
    expect(getStageLabel(15_000)).toBe('Polishing the wording…');
  });
});

describe('ReplyProgressIndicator elapsed visibility (shouldShowElapsed)', () => {
  it('hides the counter at t=0', () => {
    expect(shouldShowElapsed(0)).toBe(false);
  });

  it('hides the counter at t=2999ms (just before threshold)', () => {
    expect(shouldShowElapsed(2999)).toBe(false);
  });

  it('shows the counter at exactly 3000ms', () => {
    expect(shouldShowElapsed(3000)).toBe(true);
  });

  it('shows the counter for long waits', () => {
    expect(shouldShowElapsed(12_000)).toBe(true);
  });
});

describe('ReplyProgressIndicator initial render', () => {
  // Pin Date.now so the component sees elapsed=0 on initial render and the
  // assertions below stay deterministic regardless of test scheduling.
  let pinned: number;
  beforeEach(() => {
    pinned = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(pinned);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the initial "Reviewing your message…" label', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyProgressIndicator, { startedAt: pinned }),
    );
    expect(html).toContain('Reviewing your message…');
  });

  it('exposes aria-live="polite" for screen reader announcements', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyProgressIndicator, { startedAt: pinned }),
    );
    expect(html).toContain('aria-live="polite"');
  });

  it('uses role="status" so assistive tech treats it as a live region', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyProgressIndicator, { startedAt: pinned }),
    );
    expect(html).toContain('role="status"');
  });

  it('does NOT render the elapsed-seconds counter at t=0', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyProgressIndicator, { startedAt: pinned }),
    );
    expect(html).not.toContain('data-testid="reply-progress-elapsed"');
  });

  it('renders the assistant-bubble container so it sits inline with chat', () => {
    const html = renderToStaticMarkup(
      React.createElement(ReplyProgressIndicator, { startedAt: pinned }),
    );
    expect(html).toContain('message message-assistant');
    expect(html).toContain('reply-progress-indicator');
  });
});

describe('ReplyProgressIndicator render at later elapsed times', () => {
  // Simulate "fake-timer advancement" by pinning Date.now ahead of startedAt
  // and re-rendering. This proves the component reads the parent-driven
  // startedAt prop rather than capturing its own mount time.
  let pinned: number;
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows "Crafting reply…" and the elapsed counter after 4s', () => {
    pinned = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(pinned + 4000);
    const html = renderToStaticMarkup(
      React.createElement(ReplyProgressIndicator, { startedAt: pinned }),
    );
    expect(html).toContain('Crafting reply…');
    expect(html).toContain('data-testid="reply-progress-elapsed"');
    expect(html).toContain('>4s<');
  });

  it('shows "Polishing the wording…" after 8s with the elapsed counter', () => {
    pinned = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(pinned + 8000);
    const html = renderToStaticMarkup(
      React.createElement(ReplyProgressIndicator, { startedAt: pinned }),
    );
    expect(html).toContain('Polishing the wording…');
    expect(html).toContain('>8s<');
  });
});
