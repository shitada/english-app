import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { useSpeechSynthesis } from './useSpeechSynthesis';

// Minimal mock of SpeechSynthesisUtterance — captures handlers so the
// test can simulate `onend` to trigger queue draining.
class MockUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const utterancesCreated: MockUtterance[] = [];
let cancelMock: ReturnType<typeof vi.fn>;
let speakMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  utterancesCreated.length = 0;
  cancelMock = vi.fn();
  speakMock = vi.fn();
  // @ts-expect-error mock global
  globalThis.SpeechSynthesisUtterance = function (text: string) {
    const u = new MockUtterance(text);
    utterancesCreated.push(u);
    return u;
  } as unknown as typeof SpeechSynthesisUtterance;
  // @ts-expect-error mock window
  globalThis.window = globalThis.window || {};
  // @ts-expect-error mock speechSynthesis
  globalThis.window.speechSynthesis = {
    cancel: cancelMock,
    speak: speakMock,
    getVoices: vi.fn().mockReturnValue([]),
    onvoiceschanged: null,
  };
});

function captureHook(): ReturnType<typeof useSpeechSynthesis> {
  let captured: ReturnType<typeof useSpeechSynthesis> | null = null;
  function Probe() {
    captured = useSpeechSynthesis();
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  if (!captured) throw new Error('hook not captured');
  return captured;
}

describe('useSpeechSynthesis.enqueue (progressive TTS)', () => {
  it('enqueue twice → two utterances drained in FIFO order via onend', () => {
    const api = captureHook();
    api.enqueue('First sentence.');
    api.enqueue('Second sentence.');

    // Only the first utterance should have been spoken so far —
    // the second is buffered until onend fires.
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(utterancesCreated).toHaveLength(1);
    expect(utterancesCreated[0].text).toBe('First sentence.');
    // Importantly, enqueue must NOT call cancel() (that would cut off
    // the currently-playing utterance).
    expect(cancelMock).not.toHaveBeenCalled();

    // Simulate the first utterance ending — drain should pick up #2.
    utterancesCreated[0].onend?.();
    expect(speakMock).toHaveBeenCalledTimes(2);
    expect(utterancesCreated).toHaveLength(2);
    expect(utterancesCreated[1].text).toBe('Second sentence.');
    expect(cancelMock).not.toHaveBeenCalled();

    // After the last utterance ends, draining stops cleanly.
    utterancesCreated[1].onend?.();
    expect(speakMock).toHaveBeenCalledTimes(2);
  });

  it('stop() clears pending utterances and calls cancel()', () => {
    const api = captureHook();
    api.enqueue('One.');
    api.enqueue('Two.');
    api.enqueue('Three.');

    expect(utterancesCreated).toHaveLength(1); // only first dispatched
    api.stop();
    expect(cancelMock).toHaveBeenCalledTimes(1);

    // Even if the (now-cancelled) first utterance fires onend later,
    // no further queued items should play because the queue was cleared.
    utterancesCreated[0].onend?.();
    expect(speakMock).toHaveBeenCalledTimes(1);
    expect(utterancesCreated).toHaveLength(1);
  });

  it('enqueue after stop() works again (queue is reusable)', () => {
    const api = captureHook();
    api.enqueue('Old one.');
    api.stop();
    expect(cancelMock).toHaveBeenCalledTimes(1);

    api.enqueue('Fresh sentence.');
    // A new utterance should be created and dispatched.
    expect(utterancesCreated.length).toBeGreaterThanOrEqual(2);
    const last = utterancesCreated[utterancesCreated.length - 1];
    expect(last.text).toBe('Fresh sentence.');
    // The fresh enqueue itself should not have triggered another cancel().
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  it('flush() is a no-op marker (does not cancel or speak)', () => {
    const api = captureHook();
    api.enqueue('Hello.');
    const speakCallsBefore = speakMock.mock.calls.length;
    api.flush();
    expect(speakMock).toHaveBeenCalledTimes(speakCallsBefore);
    expect(cancelMock).not.toHaveBeenCalled();
  });
});
