import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CorrectedShadowButton,
  shouldRenderCorrection,
} from '../components/conversation/CorrectedShadowButton';

describe('shouldRenderCorrection helper', () => {
  it('returns true when corrected differs from original', () => {
    expect(
      shouldRenderCorrection('I goes to store yesterday.', 'I went to the store yesterday.')
    ).toBe(true);
  });

  it('returns false when corrected is empty', () => {
    expect(shouldRenderCorrection('anything', '')).toBe(false);
    expect(shouldRenderCorrection('anything', '   ')).toBe(false);
  });

  it('returns false when corrected equals original (after trimming)', () => {
    expect(shouldRenderCorrection('I went to the store.', 'I went to the store.')).toBe(false);
    expect(
      shouldRenderCorrection('  I went to the store.  ', 'I went to the store.')
    ).toBe(false);
  });

  it('returns false when both inputs are nullish', () => {
    expect(shouldRenderCorrection(null, null)).toBe(false);
    expect(shouldRenderCorrection(undefined, undefined)).toBe(false);
  });

  it('returns true when original is missing but corrected is provided', () => {
    expect(shouldRenderCorrection(undefined, 'A corrected sentence.')).toBe(true);
  });
});

describe('CorrectedShadowButton render', () => {
  it('renders a button when correctedText is non-empty and differs from original', () => {
    const html = renderToStaticMarkup(
      React.createElement(CorrectedShadowButton, {
        correctedText: 'I went to the store yesterday.',
        originalText: 'I goes to store yesterday.',
      })
    );
    expect(html).toContain('data-testid="corrected-shadow-button"');
    expect(html).toContain('aria-label="Hear corrected version and shadow"');
    expect(html).toContain('Shadow correction');
  });

  it('renders nothing when correctedText is empty', () => {
    const html = renderToStaticMarkup(
      React.createElement(CorrectedShadowButton, {
        correctedText: '',
        originalText: 'anything',
      })
    );
    expect(html).toBe('');
  });

  it('renders nothing when correctedText equals originalText after trim', () => {
    const html = renderToStaticMarkup(
      React.createElement(CorrectedShadowButton, {
        correctedText: 'I went to the store.',
        originalText: '  I went to the store.  ',
      })
    );
    expect(html).toBe('');
  });
});
