import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SlowReplayButton,
  splitIntoSentences,
  stepSentenceIdx,
  rateForMode,
  SLOW_RATE,
  NORMAL_RATE,
} from '../components/conversation/SlowReplayButton';

/**
 * Tests for the per-message Slow Replay & sentence stepper button.
 *
 * Note: the project does not include @testing-library/react or jsdom,
 * so interaction is exercised by:
 *  - testing the pure helpers (splitIntoSentences, stepSentenceIdx,
 *    rateForMode) that drive the stepper logic, and
 *  - asserting the static markup at relevant prop states (idle vs
 *    isSpeaking, single-sentence vs multi-sentence) via
 *    renderToStaticMarkup.
 *
 * The proposal asks for:
 *   (a) clicking 🐢 calls speak with rate=0.6
 *   (b) Next button advances sentence index across a 3-sentence input
 *   (c) stop icon appears while isSpeaking=true and clicking it calls stop
 *
 * (a) and (c) are validated by combining static-markup assertions on the
 * primary button (verifying its aria-label / icon switches by isSpeaking)
 * with a direct invocation of the click handler captured via
 * React.createElement props inspection. (b) is validated by exercising
 * the pure stepSentenceIdx helper that the Next/Prev buttons delegate to.
 */

describe('splitIntoSentences', () => {
  it('returns [] for empty/whitespace/non-string input', () => {
    expect(splitIntoSentences('')).toEqual([]);
    expect(splitIntoSentences('   ')).toEqual([]);
    // @ts-expect-error testing runtime guard
    expect(splitIntoSentences(null)).toEqual([]);
    // @ts-expect-error testing runtime guard
    expect(splitIntoSentences(undefined)).toEqual([]);
  });

  it('splits on . ! ? followed by whitespace', () => {
    const out = splitIntoSentences('Hello there. How are you? I am fine!');
    expect(out).toEqual(['Hello there.', 'How are you?', 'I am fine!']);
  });

  it('filters out empty fragments and trims whitespace', () => {
    const out = splitIntoSentences('One.   Two.    Three.');
    expect(out).toEqual(['One.', 'Two.', 'Three.']);
  });

  it('keeps a single-sentence input as one element', () => {
    expect(splitIntoSentences('Just one sentence here.')).toEqual([
      'Just one sentence here.',
    ]);
  });
});

describe('rateForMode', () => {
  it('returns SLOW_RATE (0.6) when slowMode=true', () => {
    expect(rateForMode(true)).toBe(0.6);
    expect(SLOW_RATE).toBe(0.6);
  });
  it('returns NORMAL_RATE when slowMode=false', () => {
    expect(rateForMode(false)).toBe(NORMAL_RATE);
  });
});

describe('stepSentenceIdx (drives Next/Prev buttons across 3-sentence input)', () => {
  const TOTAL = 3; // simulates a 3-sentence message

  it('Next advances 0 -> 1 -> 2 and clamps at 2', () => {
    expect(stepSentenceIdx(0, 'next', TOTAL)).toBe(1);
    expect(stepSentenceIdx(1, 'next', TOTAL)).toBe(2);
    expect(stepSentenceIdx(2, 'next', TOTAL)).toBe(2);
  });

  it('Prev moves 2 -> 1 -> 0 and clamps at 0', () => {
    expect(stepSentenceIdx(2, 'prev', TOTAL)).toBe(1);
    expect(stepSentenceIdx(1, 'prev', TOTAL)).toBe(0);
    expect(stepSentenceIdx(0, 'prev', TOTAL)).toBe(0);
  });

  it('returns 0 when total is 0 regardless of direction', () => {
    expect(stepSentenceIdx(0, 'next', 0)).toBe(0);
    expect(stepSentenceIdx(5, 'prev', 0)).toBe(0);
  });

  it('clamps stale currentIdx beyond range', () => {
    expect(stepSentenceIdx(99, 'next', 3)).toBe(2);
    expect(stepSentenceIdx(99, 'prev', 3)).toBe(1);
  });
});

describe('SlowReplayButton static render', () => {
  const noopSpeak = (_t: string, _l?: string, _r?: number) => {};
  const noopStop = () => {};

  it('renders the turtle/Slow button with correct aria-label when idle', () => {
    const html = renderToStaticMarkup(
      React.createElement(SlowReplayButton, {
        text: 'First sentence here. Second one. Third one.',
        speak: noopSpeak,
        stop: noopStop,
        isSpeaking: false,
      }),
    );
    expect(html).toContain('data-testid="slow-replay-button"');
    expect(html).toContain('aria-label="Slow replay (0.6×)"');
    // Stepper toggle visible because total > 1
    expect(html).toContain('data-testid="slow-replay-stepper-toggle"');
    // Stop icon should NOT be present in idle state
    expect(html).not.toContain('data-testid="slow-replay-stop-icon"');
  });

  it('shows the Stop icon and "Stop slow replay" aria-label when isSpeaking=true', () => {
    const html = renderToStaticMarkup(
      React.createElement(SlowReplayButton, {
        text: 'Just one sentence.',
        speak: noopSpeak,
        stop: noopStop,
        isSpeaking: true,
      }),
    );
    expect(html).toContain('data-testid="slow-replay-stop-icon"');
    expect(html).toContain('aria-label="Stop slow replay"');
    expect(html).not.toContain('data-testid="slow-replay-turtle-icon"');
  });

  it('omits stepper toggle for single-sentence input', () => {
    const html = renderToStaticMarkup(
      React.createElement(SlowReplayButton, {
        text: 'Only one short sentence.',
        speak: noopSpeak,
        stop: noopStop,
        isSpeaking: false,
      }),
    );
    expect(html).not.toContain('data-testid="slow-replay-stepper-toggle"');
  });
});

describe('SlowReplayButton click handler wiring (proposal cases a + c)', () => {
  /**
   * The component delegates its primary-button click to the pure
   * `handleSlowReplayClick` helper. We test that helper directly to
   * validate the same behavior without needing a DOM / RTL.
   */
  it('(a) clicking 🐢 in idle state calls speak(text, "en-US", 0.6)', async () => {
    const { handleSlowReplayClick } = await import(
      '../components/conversation/SlowReplayButton'
    );
    const speak = vi.fn();
    const stop = vi.fn();
    handleSlowReplayClick({
      text: 'Alpha sentence here. Beta sentence here. Gamma sentence here.',
      isSpeaking: false,
      speak,
      stop,
    });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith(
      'Alpha sentence here. Beta sentence here. Gamma sentence here.',
      'en-US',
      0.6,
    );
    expect(stop).not.toHaveBeenCalled();
  });

  it('(c) clicking the stop icon while isSpeaking=true calls stop and not speak', async () => {
    const { handleSlowReplayClick } = await import(
      '../components/conversation/SlowReplayButton'
    );
    const speak = vi.fn();
    const stop = vi.fn();
    handleSlowReplayClick({
      text: 'Some text.',
      isSpeaking: true,
      speak,
      stop,
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(speak).not.toHaveBeenCalled();
  });
});
