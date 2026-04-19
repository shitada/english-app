import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

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

beforeEach(() => {
  utterancesCreated.length = 0;
  // @ts-expect-error mock global
  globalThis.SpeechSynthesisUtterance = function (text: string) {
    const u = new MockUtterance(text);
    utterancesCreated.push(u);
    return u;
  } as unknown as typeof SpeechSynthesisUtterance;
  // @ts-expect-error mock global
  globalThis.window = globalThis.window || {};
  // @ts-expect-error mock
  globalThis.window.speechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn(),
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

describe('useSpeechSynthesis.speak rateOverride', () => {
  it('uses rateOverride when provided (0.6)', () => {
    const api = captureHook();
    api.speak('hello', 'en-US', 0.6);
    const u = utterancesCreated.at(-1)!;
    expect(u.rate).toBe(0.6);
    expect(u.lang).toBe('en-US');
  });

  it('uses default rate when no rateOverride', () => {
    const api = captureHook();
    api.speak('hi');
    const u = utterancesCreated.at(-1)!;
    // default rate is 0.9
    expect(u.rate).toBeCloseTo(0.9);
    expect(u.lang).toBe('en-US');
  });

  it('is backward compatible (lang only, no 3rd arg)', () => {
    const api = captureHook();
    api.speak('hi there', 'en-GB');
    const u = utterancesCreated.at(-1)!;
    expect(u.lang).toBe('en-GB');
    expect(u.rate).toBeCloseTo(0.9);
  });

  it('rateOverride wins over default rate', () => {
    const api = captureHook();
    api.speak('slow please', 'en-US', 0.6);
    const u = utterancesCreated.at(-1)!;
    expect(u.rate).toBe(0.6);
  });
});
