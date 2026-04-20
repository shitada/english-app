import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Mocks must be declared BEFORE importing the component under test.
// We expose a mutable handle so individual tests can change the mocked
// transcript that `useSpeechRecognition` returns.
const speechMock: {
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  isSupported: boolean;
  error: string | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
} = {
  transcript: '',
  interimTranscript: '',
  isListening: false,
  isSupported: true,
  error: null,
  start: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
};

vi.mock('../../../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => speechMock,
}));

// useSpeechSynthesis is unused by WordHeatmap (it takes a tts facade as a
// prop), but MissedWordDrill imports it at module load time when we touch
// the shared `normalizeWord`/`transcriptMatches` helpers.
vi.mock('../../../hooks/useSpeechSynthesis', () => ({
  useSpeechSynthesis: () => ({
    speak: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isSupported: true,
    volume: 1,
    setVolume: vi.fn(),
    rate: 0.85,
    setRate: vi.fn(),
  }),
}));

import {
  WordHeatmap,
  alignTokens,
  tokenColorClass,
  type WordHeatmapWordFeedback,
} from '../WordHeatmap';

const fakeTts = { speak: vi.fn(), isSpeaking: false };

function fb(
  expected: string,
  is_correct: boolean,
  extra: Partial<WordHeatmapWordFeedback> = {}
): WordHeatmapWordFeedback {
  return {
    expected,
    heard: is_correct ? expected : 'something',
    is_correct,
    tip: extra.tip ?? (is_correct ? '' : `Watch the ${expected} sound.`),
    ...extra,
  };
}

describe('alignTokens', () => {
  it('aligns each token to its matching word_feedback entry by normalized expected', () => {
    const tokens = alignTokens('I like apples.', [
      fb('I', true),
      fb('like', false),
      fb('apples', true),
    ]);
    expect(tokens).toHaveLength(3);
    expect(tokens[0].status).toBe('correct');
    expect(tokens[1].status).toBe('missed');
    expect(tokens[2].status).toBe('correct');
  });

  it('marks tokens with no aligned feedback as neutral', () => {
    const tokens = alignTokens('hello unknown world', [fb('hello', true), fb('world', true)]);
    expect(tokens[0].status).toBe('correct');
    expect(tokens[1].status).toBe('neutral');
    expect(tokens[1].feedback).toBeNull();
    expect(tokens[2].status).toBe('correct');
  });

  it('does not double-align the same feedback entry to two tokens', () => {
    const tokens = alignTokens('the cat sat on the mat', [
      fb('the', true),
      fb('cat', false),
      fb('sat', true),
      fb('on', true),
      fb('the', true),
      fb('mat', false),
    ]);
    expect(tokens[0].feedbackIndex).toBe(0);
    expect(tokens[4].feedbackIndex).toBe(4); // second "the" → second entry
    expect(tokens[5].status).toBe('missed');
  });
});

describe('tokenColorClass', () => {
  it('returns correct class for each status', () => {
    expect(tokenColorClass('correct', false)).toContain('word-heatmap-correct');
    expect(tokenColorClass('missed', false)).toContain('word-heatmap-missed');
    expect(tokenColorClass('neutral', false)).toContain('word-heatmap-neutral');
  });

  it('returns the resolved class regardless of underlying status when resolved', () => {
    expect(tokenColorClass('missed', true)).toContain('word-heatmap-resolved');
    expect(tokenColorClass('correct', true)).toContain('word-heatmap-resolved');
  });
});

describe('WordHeatmap render — token colors (a)', () => {
  it('renders each token with the color class reflecting is_correct', () => {
    const html = renderToStaticMarkup(
      React.createElement(WordHeatmap, {
        referenceText: 'I like apples',
        wordFeedback: [fb('I', true), fb('like', false), fb('apples', true)],
        tts: fakeTts,
      })
    );
    expect(html).toContain('data-testid="word-heatmap"');
    // Correct words rendered as spans with the correct class
    expect(html).toContain('word-heatmap-correct');
    // Missed word rendered with the missed class on a button
    expect(html).toContain('word-heatmap-missed');
    expect(html).toMatch(/<button[^>]*data-testid="word-heatmap-token-1"[^>]*data-status="missed"/);
    // The two correct tokens should be non-button spans
    expect(html).toMatch(/<span[^>]*data-testid="word-heatmap-token-0"[^>]*data-status="correct"/);
    expect(html).toMatch(/<span[^>]*data-testid="word-heatmap-token-2"[^>]*data-status="correct"/);
  });

  it('renders neutral (non-clickable span) for tokens with no word_feedback entry', () => {
    const html = renderToStaticMarkup(
      React.createElement(WordHeatmap, {
        referenceText: 'hello stranger',
        wordFeedback: [fb('hello', true)],
        tts: fakeTts,
      })
    );
    expect(html).toMatch(/<span[^>]*data-testid="word-heatmap-token-1"[^>]*data-status="neutral"/);
    // Neutral token must NOT be a button
    expect(html).not.toMatch(/<button[^>]*data-testid="word-heatmap-token-1"/);
  });
});

describe('WordHeatmap render — panel expansion (b)', () => {
  it('shows the tip text and 🎤 retry button when a missed-word panel is expanded', () => {
    const html = renderToStaticMarkup(
      React.createElement(WordHeatmap, {
        referenceText: 'I like apples',
        wordFeedback: [
          fb('I', true),
          fb('like', false, { tip: 'Round your lips on the L.' }),
          fb('apples', true),
        ],
        tts: fakeTts,
        // Simulates the user having clicked the "like" missed-word token.
        defaultExpandedIndex: 1,
      })
    );
    expect(html).toContain('data-testid="word-heatmap-panel"');
    expect(html).toContain('data-testid="word-heatmap-tip"');
    expect(html).toContain('Round your lips on the L.');
    // Retry mic button visible on an unresolved expanded panel
    expect(html).toContain('data-testid="word-heatmap-retry"');
    // Play-word button also present
    expect(html).toContain('data-testid="word-heatmap-play"');
  });

  it('renders phoneme_issues when present in the expanded panel', () => {
    const html = renderToStaticMarkup(
      React.createElement(WordHeatmap, {
        referenceText: 'think',
        wordFeedback: [
          fb('think', false, {
            tip: 'Tongue between teeth.',
            phoneme_issues: [{ target: 'θ', produced: 's', position: 'initial' }],
          }),
        ],
        tts: fakeTts,
        defaultExpandedIndex: 0,
      })
    );
    expect(html).toContain('data-testid="word-heatmap-phoneme-issues"');
    expect(html).toContain('θ→s');
    expect(html).toContain('initial');
  });
});

describe('WordHeatmap render — resolved on matching ASR (c)', () => {
  it('marks the expanded missed word as resolved when the ASR transcript matches', () => {
    // Mock ASR returns a transcript that contains the expected word.
    speechMock.transcript = 'like';
    try {
      const html = renderToStaticMarkup(
        React.createElement(WordHeatmap, {
          referenceText: 'I like apples',
          wordFeedback: [
            fb('I', true),
            fb('like', false, { tip: 'Round your lips on the L.' }),
            fb('apples', true),
          ],
          tts: fakeTts,
          defaultExpandedIndex: 1,
        })
      );
      // Resolved indicator appears in the expanded panel header
      expect(html).toContain('data-testid="word-heatmap-resolved-indicator"');
      // Token at index 1 should now wear the resolved class
      expect(html).toContain('word-heatmap-resolved');
      // Once resolved, the retry button should disappear from the panel
      expect(html).not.toContain('data-testid="word-heatmap-retry"');
    } finally {
      // Reset shared mock state so other tests aren't polluted.
      speechMock.transcript = '';
    }
  });
});
