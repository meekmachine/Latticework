export type LatticeworkRuntimeFlavor = 'effect-most';

export interface LatticeworkPackageInfo {
  name: string;
  runtime: LatticeworkRuntimeFlavor;
  status: 'scaffold';
}

export function getPackageInfo(): LatticeworkPackageInfo {
  return {
    name: '@lovelace_lol/latticework',
    runtime: 'effect-most',
    status: 'scaffold',
  };
}

