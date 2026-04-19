import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PinnedPhrasesBar,
  normalizePhrase,
  phraseUsedInMessage,
  togglePin,
  isPinned,
  MAX_PINNED_PHRASES,
} from '../components/conversation/PinnedPhrasesBar';

/**
 * Tests for the "Try to use" sticky pinned-phrases bar.
 *
 * The project does not have @testing-library/react / jsdom installed
 * (see ReplyProgressIndicator.test.tsx for the same pattern), so we use
 * `react-dom/server` for static-markup assertions and exercise interactive
 * behaviour through the component's pure helpers (`togglePin`,
 * `phraseUsedInMessage`, `normalizePhrase`).
 *
 * The `onUnpin` wiring is also verified by directly invoking the rendered
 * React tree's button onClick via React.createElement, since
 * renderToStaticMarkup strips event handlers.
 */
describe('PinnedPhrasesBar — render', () => {
  it('renders nothing when pinned list is empty', () => {
    const html = renderToStaticMarkup(
      React.createElement(PinnedPhrasesBar, {
        pinned: [],
        usedPhrases: new Set<string>(),
        onUnpin: () => {},
      }),
    );
    expect(html).toBe('');
  });

  it('renders a chip for each pinned phrase with the 📌 icon and ✕ button', () => {
    const html = renderToStaticMarkup(
      React.createElement(PinnedPhrasesBar, {
        pinned: ['could you', 'I would like'],
        usedPhrases: new Set<string>(),
        onUnpin: () => {},
      }),
    );
    expect(html).toContain('Try to use:');
    expect(html).toContain('could you');
    expect(html).toContain('I would like');
    expect(html).toContain('📌');
    // Two chips → two unpin buttons.
    const unpinMatches = html.match(/data-testid="pinned-phrase-unpin"/g) || [];
    expect(unpinMatches.length).toBe(2);
    // Both pending (○) since usedPhrases is empty.
    expect(html).toContain('○');
    expect(html).not.toContain('✓');
  });

  it('shows ✓ status indicator for phrases present in usedPhrases (normalized)', () => {
    const html = renderToStaticMarkup(
      React.createElement(PinnedPhrasesBar, {
        pinned: ['Could you?', 'I would like'],
        usedPhrases: new Set([normalizePhrase('Could you?')]),
        onUnpin: () => {},
      }),
    );
    expect(html).toContain('✓');
    expect(html).toContain('○'); // the other one is still pending
    expect(html).toContain('data-used="true"');
    expect(html).toContain('data-used="false"');
  });

  it('triggers onUnpin with the phrase when the ✕ button is clicked', () => {
    const onUnpin = vi.fn();
    // Build the tree and walk children to find each chip's unpin button.
    const tree: any = React.createElement(PinnedPhrasesBar, {
      pinned: ['could you', 'I would like'],
      usedPhrases: new Set<string>(),
      onUnpin,
    });
    // Render via React's reconciler is overkill; we instead simulate by
    // re-creating the component output and locating the onClick props.
    // PinnedPhrasesBar is a function component returning JSX, so call it.
    const rendered: any = (PinnedPhrasesBar as any)({
      pinned: ['could you', 'I would like'],
      usedPhrases: new Set<string>(),
      onUnpin,
    });
    expect(rendered).not.toBeNull();
    // Walk the rendered children to find the two unpin <button> elements.
    const buttons: any[] = [];
    function walk(node: any) {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node !== 'object') return;
      if (node.props?.['data-testid'] === 'pinned-phrase-unpin') {
        buttons.push(node);
      }
      if (node.props?.children) walk(node.props.children);
    }
    walk(rendered);
    expect(buttons.length).toBe(2);
    buttons[0].props.onClick();
    expect(onUnpin).toHaveBeenCalledWith('could you');
    buttons[1].props.onClick();
    expect(onUnpin).toHaveBeenCalledWith('I would like');
    expect(onUnpin).toHaveBeenCalledTimes(2);
    // Suppress unused warning
    void tree;
  });
});

describe('PinnedPhrasesBar — helpers', () => {
  it('normalizePhrase lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizePhrase('Could you, please?')).toBe('could you please');
    expect(normalizePhrase('  I  would   LIKE\nto  ')).toBe('i would like to');
  });

  it('phraseUsedInMessage matches case- and punctuation-insensitively', () => {
    expect(phraseUsedInMessage('could you', 'Hi! Could you, please, help me?')).toBe(true);
    expect(phraseUsedInMessage('I would like', 'i would LIKE a coffee')).toBe(true);
    expect(phraseUsedInMessage('totally unrelated', 'something else entirely')).toBe(false);
    expect(phraseUsedInMessage('', 'anything')).toBe(false);
  });

  it('togglePin adds, removes, and caps at the max (oldest evicted FIFO)', () => {
    expect(MAX_PINNED_PHRASES).toBe(2);
    let pinned: string[] = [];
    pinned = togglePin(pinned, 'could you');
    expect(pinned).toEqual(['could you']);
    pinned = togglePin(pinned, 'I would like');
    expect(pinned).toEqual(['could you', 'I would like']);
    // Adding a 3rd evicts the oldest.
    pinned = togglePin(pinned, 'how about');
    expect(pinned).toEqual(['I would like', 'how about']);
    // Toggling an existing phrase removes it.
    pinned = togglePin(pinned, 'I would like');
    expect(pinned).toEqual(['how about']);
    // Toggle is normalization-aware.
    pinned = togglePin(pinned, 'How About?');
    expect(pinned).toEqual([]);
  });

  it('isPinned is normalization-aware', () => {
    expect(isPinned(['Could You?'], 'could you')).toBe(true);
    expect(isPinned(['could you'], 'something else')).toBe(false);
  });
});
