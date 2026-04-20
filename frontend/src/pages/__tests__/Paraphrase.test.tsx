/**
 * Tests for Paraphrase Practice page (autoresearch #689).
 *
 * The vitest config runs in `environment: 'node'` so we test:
 *   - The exported helper `scoreColor` returns the correct band per score.
 *   - SSR renders the page with title, level toggle, and progress badge.
 *   - The exposed `SESSION_SIZE` is 5.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import Paraphrase, { SESSION_SIZE, scoreColor } from '../Paraphrase';

describe('Paraphrase scoreColor', () => {
  it('returns green for high scores', () => {
    expect(scoreColor(95)).toBe('#10b981');
    expect(scoreColor(80)).toBe('#10b981');
  });
  it('returns amber for mid scores', () => {
    expect(scoreColor(60)).toBe('#f59e0b');
    expect(scoreColor(70)).toBe('#f59e0b');
    expect(scoreColor(79)).toBe('#f59e0b');
  });
  it('returns red for low scores', () => {
    expect(scoreColor(0)).toBe('#ef4444');
    expect(scoreColor(59)).toBe('#ef4444');
  });
});

describe('Paraphrase constants', () => {
  it('exposes a 5-sentence session size', () => {
    expect(SESSION_SIZE).toBe(5);
  });
});

describe('Paraphrase SSR render', () => {
  it('renders title, level toggle, and progress badge', () => {
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(Paraphrase)),
    );
    expect(html).toContain('Paraphrase Practice');
    expect(html).toContain('data-testid="paraphrase-title"');
    expect(html).toContain('data-testid="paraphrase-progress"');
    expect(html).toContain('data-testid="paraphrase-level-easy"');
    expect(html).toContain('data-testid="paraphrase-level-medium"');
    expect(html).toContain('data-testid="paraphrase-level-hard"');
    // Initial phase is 'loading' before the API responds.
    expect(html).toContain('data-testid="paraphrase-loading"');
  });
});
