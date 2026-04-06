/**
 * Hair Customization Types
 *
 * Defines the data structures for character hair and eyebrow customization.
 * Part of the latticework agency architecture.
 *
 * NOTE: This file is engine-agnostic and does not import Three.js types.
 * All rendering is handled by EngineThree.
 */

/**
 * Hair/Eyebrow color configuration
 */
export type HairColor = {
  name: string;
  baseColor: string;           // Hex color for base hair color
  emissive: string;            // Emissive glow color
  emissiveIntensity: number;   // Glow intensity (0-1)
};

/**
 * Pre-defined hair color presets
 */
export const HAIR_COLOR_PRESETS: Record<string, HairColor> = {
  natural_black: {
    name: 'Natural Black',
    baseColor: '#1a1a1a',
    emissive: '#000000',
    emissiveIntensity: 0,
  },
  natural_brown: {
    name: 'Natural Brown',
    baseColor: '#4a3728',
    emissive: '#000000',
    emissiveIntensity: 0,
  },
  natural_blonde: {
    name: 'Natural Blonde',
    baseColor: '#e6c78a',
    emissive: '#000000',
    emissiveIntensity: 0,
  },
  natural_red: {
    name: 'Natural Red',
    baseColor: '#8b3a3a',
    emissive: '#000000',
    emissiveIntensity: 0,
  },
  natural_gray: {
    name: 'Natural Gray',
    baseColor: '#9e9e9e',
    emissive: '#000000',
    emissiveIntensity: 0,
  },
  natural_white: {
    name: 'Natural White',
    baseColor: '#f5f5f5',
    emissive: '#000000',
    emissiveIntensity: 0,
  },
  // Fun colors with emissive glow
  neon_blue: {
    name: 'Neon Blue',
    baseColor: '#00ffff',
    emissive: '#0000ff',
    emissiveIntensity: 0.8,
  },
  neon_pink: {
    name: 'Neon Pink',
    baseColor: '#ff00ff',
    emissive: '#ff1493',
    emissiveIntensity: 0.8,
  },
  neon_green: {
    name: 'Neon Green',
    baseColor: '#00ff00',
    emissive: '#00ff00',
    emissiveIntensity: 0.8,
  },
  electric_purple: {
    name: 'Electric Purple',
    baseColor: '#9d00ff',
    emissive: '#9d00ff',
    emissiveIntensity: 0.6,
  },
  fire_orange: {
    name: 'Fire Orange',
    baseColor: '#ff6600',
    emissive: '#ff3300',
    emissiveIntensity: 0.7,
  },
};

/**
 * Hair style configuration
 */
export type HairStyle = {
  name: string;
  visible: boolean;       // Is this hair style visible?
  scale?: number;         // Scale multiplier (1.0 = normal)
  position?: [number, number, number]; // Position offset [x, y, z]
};

/**
 * Complete hair state
 */
export type HairState = {
  hairColor: HairColor;        // Color for hair parts
  eyebrowColor: HairColor;     // Color for eyebrow parts
  showOutline: boolean;
  outlineColor: string;
  outlineOpacity: number;

  // Individual hair/eyebrow parts
  parts: {
    [key: string]: HairStyle; // key = object name (e.g., "Male_Bushy")
  };
};

/**
 * Default hair state
 */
export const DEFAULT_HAIR_STATE: HairState = {
  hairColor: HAIR_COLOR_PRESETS.natural_brown,
  eyebrowColor: HAIR_COLOR_PRESETS.natural_brown,
  showOutline: false,
  outlineColor: '#00ff00',
  outlineOpacity: 1.0,
  parts: {},
};

/**
 * Hair object metadata (engine-agnostic)
 * No Three.js types - just data needed for state management
 */
export type HairObjectRef = {
  name: string;
  isEyebrow: boolean;  // true if this is an eyebrow, false if hair
  isMesh: boolean;     // true if this object has mesh geometry
};

/**
 * Hair physics configuration (mirrors engine config).
 */
export type HairPhysicsRuntimeConfig = {
  stiffness: number;
  damping: number;
  inertia: number;
  gravity: number;
  responseScale: number;
  idleSwayAmount: number;
  idleSwaySpeed: number;
  windStrength: number;
  windDirectionX: number;
  windDirectionZ: number;
  windTurbulence: number;
  windFrequency: number;
  idleClipDuration: number;
  impulseClipDuration: number;
};

/**
 * Hair physics config as presented in the UI.
 */
export type HairPhysicsUIConfig = HairPhysicsRuntimeConfig & {
  enabled: boolean;
};

export const DEFAULT_HAIR_PHYSICS_CONFIG: HairPhysicsRuntimeConfig = {
  stiffness: 7.5,
  damping: 0.18,
  inertia: 3.5,
  gravity: 12,
  responseScale: 2.5,
  idleSwayAmount: 0.12,
  idleSwaySpeed: 1.0,
  windStrength: 0,
  windDirectionX: 1.0,
  windDirectionZ: 0,
  windTurbulence: 0.3,
  windFrequency: 1.4,
  idleClipDuration: 10,
  impulseClipDuration: 1.4,
};

export const DEFAULT_HAIR_PHYSICS_ENABLED = false;

/**
 * Events that can be sent to the hair machine
 */
export type HairEvent =
  | { type: 'SET_HAIR_COLOR'; color: HairColor }
  | { type: 'SET_EYEBROW_COLOR'; color: HairColor }
  | { type: 'SET_HAIR_BASE_COLOR'; baseColor: string }
  | { type: 'SET_EYEBROW_BASE_COLOR'; baseColor: string }
  | { type: 'SET_HAIR_GLOW'; emissive: string; intensity: number }
  | { type: 'SET_EYEBROW_GLOW'; emissive: string; intensity: number }
  | { type: 'SET_OUTLINE'; show: boolean; color?: string; opacity?: number }
  | { type: 'SET_PART_VISIBILITY'; partName: string; visible: boolean }
  | { type: 'SET_PART_SCALE'; partName: string; scale: number }
  | { type: 'SET_PART_POSITION'; partName: string; position: [number, number, number] }
  | { type: 'RESET_TO_DEFAULT' };

/**
 * Context for the hair state machine
 */
export type HairContext = {
  state: HairState;
  objects: HairObjectRef[];
};

/**
 * Runtime morph target direction mapping (mirrors loom3 HairMorphTargetsConfig).
 * Single-morph slots use a plain morph key string.
 * headUp/headDown are multi-morph dicts mapping morphKey → intensity.
 */
export type HairMorphTargetsConfig = {
  swayLeft: string;
  swayRight: string;
  swayFront: string;
  fluffRight: string;
  fluffBottom: string;
  headUp: Record<string, number>;
  headDown: Record<string, number>;
};

/**
 * The 5 single-morph direction slots with their fixed axis.
 */
export const DIRECTION_SLOTS = [
  { key: 'swayLeft' as const, label: 'Sway Left', axis: 'yaw' as const },
  { key: 'swayRight' as const, label: 'Sway Right', axis: 'yaw' as const },
  { key: 'swayFront' as const, label: 'Sway Front', axis: 'pitch' as const },
  { key: 'fluffRight' as const, label: 'Fluff Right', axis: 'yaw' as const },
  { key: 'fluffBottom' as const, label: 'Fluff Bottom', axis: 'pitch' as const },
] as const;
