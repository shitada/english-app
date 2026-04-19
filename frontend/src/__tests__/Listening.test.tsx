import { describe, it, expect } from 'vitest';

import { shouldShowInlineReplay, AUTO_REPLAY_ON_WRONG_KEY } from '../pages/Listening';

describe('shouldShowInlineReplay', () => {
  it('returns false when the question has not been answered yet', () => {
    expect(
      shouldShowInlineReplay({ answered: false, selectedIndex: 0, correctIndex: 1 }),
    ).toBe(false);
    expect(
      shouldShowInlineReplay({ answered: false, selectedIndex: null, correctIndex: 1 }),
    ).toBe(false);
  });

  it('returns false when nothing was selected even if answered is somehow true', () => {
    expect(
      shouldShowInlineReplay({ answered: true, selectedIndex: null, correctIndex: 2 }),
    ).toBe(false);
  });

  it('returns false when the selected option matches the correct index', () => {
    expect(
      shouldShowInlineReplay({ answered: true, selectedIndex: 2, correctIndex: 2 }),
    ).toBe(false);
    expect(
      shouldShowInlineReplay({ answered: true, selectedIndex: 0, correctIndex: 0 }),
    ).toBe(false);
  });

  it('returns true when answered with a wrong selection', () => {
    expect(
      shouldShowInlineReplay({ answered: true, selectedIndex: 0, correctIndex: 1 }),
    ).toBe(true);
    expect(
      shouldShowInlineReplay({ answered: true, selectedIndex: 3, correctIndex: 0 }),
    ).toBe(true);
  });
});

describe('AUTO_REPLAY_ON_WRONG_KEY', () => {
  it('uses a stable, namespaced localStorage key', () => {
    expect(AUTO_REPLAY_ON_WRONG_KEY).toBe('listening.autoReplayOnWrong');
  });
});
