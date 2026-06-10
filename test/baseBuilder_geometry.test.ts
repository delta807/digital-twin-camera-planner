/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { clampSides, rimVertices, railSegments } from '../BaseBuilder';

// The pure geometry functions shared by BaseBuilder (rendering) and window.__autoresearch.getRailGeometry
// (the campaign's source of truth). I1: builder and campaign must use IDENTICAL geometry. (#A13)
describe('BaseBuilder geometry (#A13 / I1)', () => {
  it('clampSides supports n up to 12 (was silently clamped to 8 → n=9/10 built as octagons)', () => {
    expect(clampSides(9)).toBe(9);
    expect(clampSides(10)).toBe(10);
    expect(clampSides(13)).toBe(12);
    expect(clampSides(2)).toBe(3);
    expect(clampSides(6.4)).toBe(6);
  });

  it('rimVertices(4) is the as-built axis-aligned rectangle (NOT a circumradius diamond)', () => {
    const rim = rimVertices(4, 0.4, 0.4);
    expect(rim).toHaveLength(4);
    expect(new Set(rim.map(([x, y]) => `${x},${y}`)))
      .toEqual(new Set(['-0.4,-0.4', '0.4,-0.4', '0.4,0.4', '-0.4,0.4']));
  });

  it('rimVertices(n≥5) is a regular n-gon at circumradius halfX, first vertex down (VERTEX_PHASE −π/2)', () => {
    const rim = rimVertices(6, 0.4, 0.4);
    expect(rim).toHaveLength(6);
    for (const [x, y] of rim) expect(Math.hypot(x, y)).toBeCloseTo(0.4, 6);
    expect(rim[0][0]).toBeCloseTo(0, 6);
    expect(rim[0][1]).toBeCloseTo(-0.4, 6);
  });

  it('railSegments returns n indexed edges with correct lengths', () => {
    const rails = railSegments(rimVertices(4, 0.4, 0.4));
    expect(rails).toHaveLength(4);
    expect(rails[0].length).toBeCloseTo(0.8, 6); // rectangle side = 2·halfX
    expect(rails.map((r) => r.index)).toEqual([0, 1, 2, 3]);
  });
});
