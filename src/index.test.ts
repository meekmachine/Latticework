import { describe, expect, it } from 'vitest';
import { getPackageInfo } from './index';

describe('getPackageInfo', () => {
  it('reports the scaffolded package contract', () => {
    expect(getPackageInfo()).toEqual({
      name: '@lovelace_lol/latticework',
      runtime: 'effect-most',
      status: 'scaffold',
    });
  });
});

