import { describe, it, expect } from 'vitest';
import { nextLadderStep, SPEED_LADDER_RUNGS } from '../pages/Listening';

describe('Speed Ladder logic — nextLadderStep', () => {
  it('exposes the canonical 5-rung ladder', () => {
    expect(SPEED_LADDER_RUNGS).toEqual([0.85, 1.0, 1.15, 1.3, 1.5]);
  });

  it('first correct first-try answer just bumps the consecutive counter', () => {
    const r = nextLadderStep(0, 0, true);
    expect(r.nextIndex).toBe(0);
    expect(r.nextConsec).toBe(1);
    expect(r.hint).toBeNull();
  });

  it('two consecutive first-try corrects step up one rung and reset counter', () => {
    const first = nextLadderStep(0, 0, true);
    const second = nextLadderStep(first.nextIndex, first.nextConsec, true);
    expect(second.nextIndex).toBe(1);
    expect(second.nextConsec).toBe(0);
    expect(second.hint).toBe('up');
  });

  it('caps at the top rung even after two more corrects', () => {
    const top = SPEED_LADDER_RUNGS.length - 1;
    const a = nextLadderStep(top, 0, true);
    const b = nextLadderStep(a.nextIndex, a.nextConsec, true);
    expect(b.nextIndex).toBe(top);
    expect(b.hint).toBeNull();
  });

  it('a single wrong answer steps down one rung and resets counter', () => {
    const r = nextLadderStep(2, 1, false);
    expect(r.nextIndex).toBe(1);
    expect(r.nextConsec).toBe(0);
    expect(r.hint).toBe('down');
  });

  it('floors at index 0 when wrong at the bottom rung', () => {
    const r = nextLadderStep(0, 1, false);
    expect(r.nextIndex).toBe(0);
    expect(r.nextConsec).toBe(0);
    expect(r.hint).toBeNull();
  });
});
