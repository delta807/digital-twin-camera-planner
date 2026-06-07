/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { matTranspose, matMul, matVecMul, solveLinearSystem } from '../MatMath';

const arr = (a: Float64Array) => Array.from(a);

describe('MatMath', () => {
  it('matTranspose: 2x3 -> 3x2 (row-major)', () => {
    expect(arr(matTranspose(Float64Array.of(1, 2, 3, 4, 5, 6), 2, 3)))
      .toEqual([1, 4, 2, 5, 3, 6]);
  });

  it('matMul: 2x2 * 2x2', () => {
    expect(arr(matMul(Float64Array.of(1, 2, 3, 4), Float64Array.of(5, 6, 7, 8), 2, 2, 2)))
      .toEqual([19, 22, 43, 50]);
  });

  it('matMul: A * I == A', () => {
    const A = Float64Array.of(1, 2, 3, 4);
    const I = Float64Array.of(1, 0, 0, 1);
    expect(arr(matMul(A, I, 2, 2, 2))).toEqual([1, 2, 3, 4]);
  });

  it('matVecMul: 2x2 * vec2', () => {
    expect(arr(matVecMul(Float64Array.of(1, 2, 3, 4), [1, 1], 2, 2))).toEqual([3, 7]);
  });

  it('solveLinearSystem: 2x2 system', () => {
    // 2x + y = 3 ; x + 3y = 5  ->  x = 0.8, y = 1.4
    const x = solveLinearSystem(Float64Array.of(2, 1, 1, 3), Float64Array.of(3, 5), 2);
    expect(x[0]).toBeCloseTo(0.8, 10);
    expect(x[1]).toBeCloseTo(1.4, 10);
  });

  it('solveLinearSystem: identity returns b', () => {
    const x = solveLinearSystem(Float64Array.of(1, 0, 0, 1), Float64Array.of(5, 7), 2);
    expect(x[0]).toBeCloseTo(5, 10);
    expect(x[1]).toBeCloseTo(7, 10);
  });
});
