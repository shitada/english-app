/**
 * Tests for Phrasal Verb Particle Drill page (autoresearch #693).
 *
 * Vitest environment is `node`, so we cover pure helpers + SSR rendering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import PhrasalVerbDrill, {
  normalizeAnswer,
  isAnswerCorrect,
  prioritizeByProgress,
} from '../PhrasalVerbDrill';
import type { PhrasalVerbItem } from '../../api';

function mkItem(overrides: Partial<PhrasalVerbItem> = {}): PhrasalVerbItem {
  return {
    id: 'b01',
    verb: 'turn',
    particle: 'off',
    meaning: 'stop a device',
    example_full: 'Please turn off the lights.',
    example_with_blank: 'Please turn ____ the lights.',
    level: 'beginner',
    accepted: [],
    ...overrides,
  };
}

describe('normalizeAnswer', () => {
  it('lowercases and trims', () => {
    expect(normalizeAnswer('  Off  ')).toBe('off');
    expect(normalizeAnswer('UP')).toBe('up');
  });
  it('collapses internal whitespace', () => {
    expect(normalizeAnswer('up   with')).toBe('up with');
  });
  it('handles empty/undefined', () => {
    expect(normalizeAnswer('')).toBe('');
    // @ts-expect-error testing defensive handling
    expect(normalizeAnswer(undefined)).toBe('');
  });
});

describe('isAnswerCorrect', () => {
  it('matches the primary particle case-insensitively', () => {
    const it = mkItem({ particle: 'off' });
    expect(isAnswerCorrect(it, 'off')).toBe(true);
    expect(isAnswerCorrect(it, 'OFF')).toBe(true);
    expect(isAnswerCorrect(it, '  Off  ')).toBe(true);
  });

  it('rejects wrong particles', () => {
    const it = mkItem({ particle: 'off' });
    expect(isAnswerCorrect(it, 'on')).toBe(false);
    expect(isAnswerCorrect(it, '')).toBe(false);
    expect(isAnswerCorrect(it, '   ')).toBe(false);
  });

  it('accepts synonyms from accepted[]', () => {
    const it = mkItem({ particle: 'away', accepted: ['out'] });
    expect(isAnswerCorrect(it, 'away')).toBe(true);
    expect(isAnswerCorrect(it, 'out')).toBe(true);
    expect(isAnswerCorrect(it, 'OUT')).toBe(true);
    expect(isAnswerCorrect(it, 'in')).toBe(false);
  });

  it('accepts multi-word particles', () => {
    const it = mkItem({ particle: 'up with', accepted: [] });
    expect(isAnswerCorrect(it, 'up with')).toBe(true);
    expect(isAnswerCorrect(it, 'Up  With')).toBe(true);
    expect(isAnswerCorrect(it, 'up')).toBe(false);
  });
});

describe('prioritizeByProgress', () => {
  it('ranks items with more past-wrong answers first', () => {
    const a = mkItem({ id: 'a' });
    const b = mkItem({ id: 'b' });
    const c = mkItem({ id: 'c' });
    const sorted = prioritizeByProgress([a, b, c], {
      wrong: { b: 3, a: 1 },
      seen: { a: 5, b: 5, c: 2 },
    });
    expect(sorted.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('boosts never-seen items above fully-mastered ones', () => {
    const mastered = mkItem({ id: 'm' });
    const fresh = mkItem({ id: 'f' });
    const sorted = prioritizeByProgress([mastered, fresh], {
      wrong: {},
      seen: { m: 10 },
    });
    expect(sorted.map((x) => x.id)).toEqual(['f', 'm']);
  });

  it('returns stable copy without mutating input', () => {
    const input = [mkItem({ id: 'a' }), mkItem({ id: 'b' })];
    const before = input.map((x) => x.id);
    prioritizeByProgress(input, { wrong: { b: 5 }, seen: {} });
    expect(input.map((x) => x.id)).toEqual(before);
  });
});

describe('PhrasalVerbDrill SSR render', () => {
  beforeEach(() => {
    // Node env has no window/localStorage by default with vitest node env.
    // SSR render doesn't touch it, so we just trust the guards.
  });

  it('renders title + level picker + start button in the initial phase', () => {
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(PhrasalVerbDrill)),
    );
    expect(html).toContain('data-testid="phrasal-verb-page"');
    expect(html).toContain('data-testid="phrasal-verb-title"');
    expect(html).toContain('Phrasal Verb Particle Drill');
    expect(html).toContain('data-testid="phrasal-verb-select"');
    expect(html).toContain('data-testid="phrasal-verb-level-beginner"');
    expect(html).toContain('data-testid="phrasal-verb-level-intermediate"');
    expect(html).toContain('data-testid="phrasal-verb-level-advanced"');
    expect(html).toContain('data-testid="phrasal-verb-start"');
  });
});
