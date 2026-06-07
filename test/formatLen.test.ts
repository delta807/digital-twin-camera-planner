/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { formatLen } from '../types';

describe('formatLen', () => {
  it('formats metres with 3 decimals + suffix', () => {
    expect(formatLen(0.83, 'm')).toBe('0.830 m');
    expect(formatLen(1, 'm')).toBe('1.000 m');
  });

  it('formats millimetres as rounded integers + suffix', () => {
    expect(formatLen(0.83, 'mm')).toBe('830 mm');
    expect(formatLen(0.0245, 'mm')).toBe('25 mm'); // 24.5 -> toFixed(0) rounds up
    expect(formatLen(0.0244, 'mm')).toBe('24 mm');
  });

  it('handles negatives', () => {
    expect(formatLen(-0.5, 'mm')).toBe('-500 mm');
    expect(formatLen(-0.5, 'm')).toBe('-0.500 m');
  });
});
