/**
 * Tests for Situational Monologue Drill page (autoresearch #692).
 *
 * Vitest runs with `environment: 'node'`, so we test pure helpers plus
 * SSR rendering for the initial phase.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import MonologueDrill, { scoreColor, formatDuration } from '../MonologueDrill';

describe('MonologueDrill scoreColor', () => {
  it('returns green for high scores', () => {
    expect(scoreColor(95)).toBe('#10b981');
    expect(scoreColor(80)).toBe('#10b981');
  });
  it('returns amber for mid scores', () => {
    expect(scoreColor(70)).toBe('#f59e0b');
    expect(scoreColor(60)).toBe('#f59e0b');
  });
  it('returns red for low scores', () => {
    expect(scoreColor(59)).toBe('#ef4444');
    expect(scoreColor(0)).toBe('#ef4444');
  });
});

describe('MonologueDrill formatDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(45)).toBe('0:45');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(125)).toBe('2:05');
  });
  it('floors negative to 0', () => {
    expect(formatDuration(-10)).toBe('0:00');
  });
});

describe('MonologueDrill SSR render', () => {
  it('renders title and initial loading phase', () => {
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(MonologueDrill)),
    );
    expect(html).toContain('data-testid="monologue-page"');
    expect(html).toContain('data-testid="monologue-title"');
    expect(html).toContain('Situational Monologue Drill');
    expect(html).toContain('data-testid="monologue-loading"');
  });
});
