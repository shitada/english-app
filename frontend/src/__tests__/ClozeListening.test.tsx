import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ClozeListening,
  extractClozeBlanks,
  getSentenceForBlank,
  speakSentenceForBlank,
  computeMissedBlankIndices,
} from '../components/ClozeListening';

const PASSAGE =
  'The morning fog covered the harbor. Several fishing boats prepared their nets carefully. ' +
  'The captain checked the weather radio before departure.';

describe('extractClozeBlanks', () => {
  it('extracts up to 6 reasonable blanks', () => {
    const { tokens, blanks } = extractClozeBlanks(PASSAGE, 6);
    expect(tokens.length).toBeGreaterThan(10);
    expect(blanks.length).toBeGreaterThan(0);
    expect(blanks.length).toBeLessThanOrEqual(6);
    for (const b of blanks) {
      expect(typeof b.word).toBe('string');
      expect(b.word.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('getSentenceForBlank', () => {
  it('returns the sentence containing the blank token', () => {
    const { tokens, blanks } = extractClozeBlanks(PASSAGE, 6);
    expect(blanks.length).toBeGreaterThan(0);
    for (const b of blanks) {
      const sentence = getSentenceForBlank(PASSAGE, tokens, b.index);
      expect(sentence).toContain(b.word);
      // Sentence should be one of the three sentences in the passage.
      const sentences = PASSAGE.split(/(?<=[.!?])\s+/);
      expect(sentences).toContain(sentence);
    }
  });

  it('finds the first sentence for an early blank', () => {
    const passage = 'Aaaa bbbb. Cccc dddd. Eeee ffff.';
    const tokens = passage.split(/(\s+)/);
    // token 0 = 'Aaaa', token 1 = ' ', token 2 = 'bbbb.'
    expect(getSentenceForBlank(passage, tokens, 0)).toBe('Aaaa bbbb.');
  });

  it('finds the second sentence for a middle blank', () => {
    const passage = 'Aaaa bbbb. Cccc dddd. Eeee ffff.';
    const tokens = passage.split(/(\s+)/);
    // token 4 = 'Cccc', token 6 = 'dddd.'
    expect(getSentenceForBlank(passage, tokens, 4)).toBe('Cccc dddd.');
    expect(getSentenceForBlank(passage, tokens, 6)).toBe('Cccc dddd.');
  });
});

describe('computeMissedBlankIndices', () => {
  it('returns indices of blanks whose answer is wrong or missing', () => {
    const blanks = [
      { index: 0, word: 'morning' },
      { index: 4, word: 'harbor' },
      { index: 8, word: 'fishing' },
    ];
    const answers = { 0: 'morning', 4: 'wrong', 8: '' };
    const missed = computeMissedBlankIndices(blanks, answers);
    expect(missed).toEqual([1, 2]);
  });

  it('treats case and surrounding whitespace as equal', () => {
    const blanks = [{ index: 0, word: 'Harbor' }];
    expect(computeMissedBlankIndices(blanks, { 0: '  harbor  ' })).toEqual([]);
  });
});

// ---- speech mocking ----------------------------------------------------------

type Utt = { text: string; rate: number; lang: string };

function installSpeechMock() {
  const speak = vi.fn();
  const cancel = vi.fn();
  const utterances: Utt[] = [];
  class FakeUtterance {
    text: string;
    rate = 1;
    lang = 'en-US';
    constructor(text: string) {
      this.text = text;
      utterances.push(this as unknown as Utt);
    }
  }
  (globalThis as any).window = {
    speechSynthesis: { speak, cancel },
    SpeechSynthesisUtterance: FakeUtterance,
  };
  (globalThis as any).SpeechSynthesisUtterance = FakeUtterance;
  // The component's speakSentenceForBlank reads utterances via `new (window as any).SpeechSynthesisUtterance(...)`,
  // so capture them off the speak() call argument.
  speak.mockImplementation((u: Utt) => utterances.push(u));
  return { speak, cancel, utterances };
}

function uninstallSpeechMock() {
  delete (globalThis as any).window;
  delete (globalThis as any).SpeechSynthesisUtterance;
}

describe('speakSentenceForBlank', () => {
  let mock: ReturnType<typeof installSpeechMock>;

  beforeEach(() => { mock = installSpeechMock(); });
  afterEach(() => { uninstallSpeechMock(); });

  it('calls speechSynthesis.speak with the sentence at rate 0.75', () => {
    const passage = 'Aaaa bbbb. Cccc dddd captain. Eeee ffff.';
    const tokens = passage.split(/(\s+)/);
    // tokens: ['Aaaa',' ','bbbb.',' ','Cccc',' ','dddd',' ','captain.',' ','Eeee',' ','ffff.']
    speakSentenceForBlank(passage, tokens, 4); // 'Cccc'
    expect(mock.cancel).toHaveBeenCalledTimes(1);
    expect(mock.speak).toHaveBeenCalledTimes(1);
    // The argument passed to speak is the utterance instance.
    const utt = mock.speak.mock.calls[0][0];
    expect(utt.text).toBe('Cccc dddd captain.');
    expect(utt.rate).toBe(0.75);
    expect(utt.lang).toBe('en-US');
  });

  it('is a no-op when speechSynthesis is unavailable', () => {
    uninstallSpeechMock();
    expect(() => speakSentenceForBlank('Hi there.', ['Hi', ' ', 'there.'], 0)).not.toThrow();
  });
});

// ---- render tests ------------------------------------------------------------

describe('ClozeListening render', () => {
  it('renders the start button initially', () => {
    const html = renderToStaticMarkup(
      React.createElement(ClozeListening, { passage: PASSAGE })
    );
    expect(html).toContain('Cloze Listening');
    expect(html).toContain('Start Cloze Drill');
    // No first-try score until submission.
    expect(html).not.toContain('cloze-first-try-score');
    // No retry-missed button before drill starts.
    expect(html).not.toContain('cloze-retry-missed-btn');
  });

  it('returns null when the passage has no cloze candidates', () => {
    const html = renderToStaticMarkup(
      React.createElement(ClozeListening, { passage: 'a b c.' })
    );
    expect(html).toBe('');
  });

  it('uses the data-testid container so e2e tests can find it', () => {
    const html = renderToStaticMarkup(
      React.createElement(ClozeListening, { passage: PASSAGE })
    );
    expect(html).toContain('data-testid="cloze-listening"');
  });
});
