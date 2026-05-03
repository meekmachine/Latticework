import { VISEME_KEYS } from '@lovelace_lol/loom3';

type CanonicalVisemeSlots = {
  AE: number;
  Ah: number;
  B_M_P: number;
  Ch_J: number;
  EE: number;
  Er: number;
  F_V: number;
  Ih: number;
  K_G_H_NG: number;
  Oh: number;
  R: number;
  S_Z: number;
  T_L_D_N: number;
  Th: number;
  W_OO: number;
};

function findVisemeIndex(keys: string[], fallbackKey = 'B_M_P'): number {
  for (const key of keys) {
    const index = VISEME_KEYS.indexOf(key);
    if (index >= 0) return index;
  }

  const fallbackIndex = VISEME_KEYS.indexOf(fallbackKey);
  return fallbackIndex >= 0 ? fallbackIndex : 0;
}

export const CANONICAL_VISEMES: CanonicalVisemeSlots = {
  AE: findVisemeIndex(['AE']),
  Ah: findVisemeIndex(['Ah']),
  B_M_P: findVisemeIndex(['B_M_P']),
  Ch_J: findVisemeIndex(['Ch_J', 'S_Z']),
  EE: findVisemeIndex(['EE']),
  Er: findVisemeIndex(['Er', 'R']),
  F_V: findVisemeIndex(['F_V']),
  Ih: findVisemeIndex(['Ih', 'I', 'EE']),
  K_G_H_NG: findVisemeIndex(['K_G_H_NG']),
  Oh: findVisemeIndex(['Oh']),
  R: findVisemeIndex(['R']),
  S_Z: findVisemeIndex(['S_Z']),
  T_L_D_N: findVisemeIndex(['T_L_D_N', 'L']),
  Th: findVisemeIndex(['Th']),
  W_OO: findVisemeIndex(['W_OO', 'OO', 'W', 'U']),
};

export function canonicalVisemeIndex(keys: string[], fallbackKey = 'B_M_P'): number {
  return findVisemeIndex(keys, fallbackKey);
}
