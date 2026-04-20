/**
 * Tests for Number & Date Dictation page (autoresearch #690).
 *
 * Vitest runs with environment: 'node' — we test:
 *   - SSR renders the picker with category buttons.
 *   - Page title and key data-testid hooks are present.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import NumberDictation from '../NumberDictation';

describe('NumberDictation SSR render', () => {
  it('renders title and category picker', () => {
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(NumberDictation)),
    );
    expect(html).toContain('Number');
    expect(html).toContain('Dictation');
    expect(html).toContain('data-testid="number-dictation-page"');
    expect(html).toContain('data-testid="number-dictation-picker"');
    expect(html).toContain('data-testid="number-dictation-cat-mixed"');
    expect(html).toContain('data-testid="number-dictation-cat-prices"');
    expect(html).toContain('data-testid="number-dictation-cat-dates"');
    expect(html).toContain('data-testid="number-dictation-cat-times"');
    expect(html).toContain('data-testid="number-dictation-cat-years"');
    expect(html).toContain('data-testid="number-dictation-cat-phone"');
    expect(html).toContain('data-testid="number-dictation-cat-teens_vs_tens"');
  });

  it('does not render the drill area before a category is picked', () => {
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, null, React.createElement(NumberDictation)),
    );
    expect(html).not.toContain('data-testid="number-dictation-drill"');
    expect(html).not.toContain('data-testid="number-dictation-summary"');
  });
});
