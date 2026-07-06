import { describe, expect, it } from 'vitest';
import { evaluateSignals } from '../src/thresholds.js';
import { DEFAULT_THRESHOLDS } from '../src/types.js';

describe('evaluateSignals', () => {
  it('raises nothing below alertAt', () => {
    expect(evaluateSignals(79.9, DEFAULT_THRESHOLDS)).toEqual({ alert: false, pause: false });
  });

  it('raises ALERT at/above alertAt', () => {
    expect(evaluateSignals(80, DEFAULT_THRESHOLDS)).toEqual({ alert: true, pause: false });
    expect(evaluateSignals(92.9, DEFAULT_THRESHOLDS)).toEqual({ alert: true, pause: false });
  });

  it('raises PAUSE (and ALERT) at/above pauseAt', () => {
    expect(evaluateSignals(93, DEFAULT_THRESHOLDS)).toEqual({ alert: true, pause: true });
    expect(evaluateSignals(100, DEFAULT_THRESHOLDS)).toEqual({ alert: true, pause: true });
  });

  it('clears again when pct drops back under (levels, not edges)', () => {
    expect(evaluateSignals(50, DEFAULT_THRESHOLDS)).toEqual({ alert: false, pause: false });
  });

  it('spend mode suppresses PAUSE but keeps ALERT', () => {
    expect(evaluateSignals(100, DEFAULT_THRESHOLDS, 'spend')).toEqual({
      alert: true,
      pause: false,
    });
    expect(evaluateSignals(85, DEFAULT_THRESHOLDS, 'spend')).toEqual({ alert: true, pause: false });
  });

  it('respects custom thresholds', () => {
    expect(evaluateSignals(45, { alertAt: 40, pauseAt: 42 })).toEqual({ alert: true, pause: true });
  });
});
