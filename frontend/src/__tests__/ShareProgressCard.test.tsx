import { describe, it, expect, vi } from 'vitest';
import {
  formatShareText,
  fileNameForDate,
  drawShareCanvas,
  copyTextToClipboard,
  todayIsoLocal,
} from '../components/dashboard/ShareProgressCard';

/**
 * Tests for ShareProgressCard helpers.
 *
 * The project does not include @testing-library/react or jsdom (see other
 * tests in this directory for the same pattern), so we exercise the pure
 * helpers exported from the component module rather than mounting it.
 */

describe('ShareProgressCard.formatShareText', () => {
  it('renders all stat lines when all props provided', () => {
    const text = formatShareText({
      date: '2025-01-15',
      streak: 7,
      minutesToday: 25,
      wordsToday: 18,
      topSkill: 'Speaking',
    });
    expect(text).toContain('English App — Daily Progress');
    expect(text).toContain('Date: 2025-01-15');
    expect(text).toContain('Streak: 7 days 🔥');
    expect(text).toContain('Minutes today: 25');
    expect(text).toContain('Words reviewed today: 18');
    expect(text).toContain('Top skill: Speaking');
  });

  it('omits stat lines when their props are undefined', () => {
    const text = formatShareText({ date: '2025-01-15', streak: 3 });
    expect(text).toContain('Streak: 3 days');
    expect(text).not.toContain('Minutes today');
    expect(text).not.toContain('Words reviewed today');
    expect(text).not.toContain('Top skill');
  });

  it('uses singular "day" for streak of 1', () => {
    expect(formatShareText({ date: '2025-01-15', streak: 1 })).toContain('Streak: 1 day 🔥');
  });

  it('falls back to today when date is omitted', () => {
    const text = formatShareText({ streak: 1 });
    expect(text).toContain(`Date: ${todayIsoLocal()}`);
  });
});

describe('ShareProgressCard.fileNameForDate', () => {
  it('formats the filename with the given date', () => {
    expect(fileNameForDate('2025-01-15')).toBe('english-app-progress-2025-01-15.png');
  });
});

describe('ShareProgressCard.drawShareCanvas', () => {
  function makeMockCanvas() {
    const calls: { method: string; args: unknown[] }[] = [];
    const ctx = new Proxy(
      {
        fillText: (...args: unknown[]) => calls.push({ method: 'fillText', args }),
        fillRect: (...args: unknown[]) => calls.push({ method: 'fillRect', args }),
        createLinearGradient: () => ({
          addColorStop: (...args: unknown[]) => calls.push({ method: 'addColorStop', args }),
        }),
      } as Record<string, unknown>,
      {
        get(target, prop) {
          if (prop in target) return (target as Record<string, unknown>)[prop as string];
          // Setters for fillStyle / font / textBaseline -> noop getters.
          return undefined;
        },
        set() {
          return true;
        },
      },
    );
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
    } as unknown as HTMLCanvasElement;
    return { canvas, calls };
  }

  it('sizes the canvas to 600x315 and draws each provided stat row', () => {
    const { canvas, calls } = makeMockCanvas();
    drawShareCanvas(canvas, {
      date: '2025-01-15',
      streak: 5,
      minutesToday: 12,
      wordsToday: 9,
      topSkill: 'Listening',
    });
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(315);
    const texts = calls.filter((c) => c.method === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('English App — Daily Progress');
    expect(texts).toContain('2025-01-15');
    expect(texts).toContain('Streak');
    expect(texts).toContain('5 days');
    expect(texts).toContain('Minutes today');
    expect(texts).toContain('12');
    expect(texts).toContain('Words reviewed today');
    expect(texts).toContain('9');
    expect(texts).toContain('Top skill');
    expect(texts).toContain('Listening');
  });

  it('skips rows whose value is undefined', () => {
    const { canvas, calls } = makeMockCanvas();
    drawShareCanvas(canvas, { date: '2025-01-15', streak: 2 });
    const texts = calls.filter((c) => c.method === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('Streak');
    expect(texts).not.toContain('Minutes today');
    expect(texts).not.toContain('Words reviewed today');
    expect(texts).not.toContain('Top skill');
  });
});

describe('ShareProgressCard.copyTextToClipboard', () => {
  it('uses navigator.clipboard.writeText in a secure context', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const origNav = globalThis.navigator;
    const origSecure = (globalThis as unknown as { isSecureContext?: boolean }).isSecureContext;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText } },
    });
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { isSecureContext: true },
    });
    try {
      const ok = await copyTextToClipboard('hello world');
      expect(ok).toBe(true);
      expect(writeText).toHaveBeenCalledWith('hello world');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: origNav });
      Object.defineProperty(globalThis, 'isSecureContext', {
        configurable: true,
        value: origSecure,
      });
    }
  });

  it('returns false when neither clipboard API nor document is available', async () => {
    const origNav = globalThis.navigator;
    const origDoc = (globalThis as unknown as { document?: unknown }).document;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    // Remove document so the legacy fallback also bails out.
    Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });
    try {
      const ok = await copyTextToClipboard('x');
      expect(ok).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: origNav });
      Object.defineProperty(globalThis, 'document', { configurable: true, value: origDoc });
    }
  });
});
