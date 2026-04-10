/**
 * Prosodic Expression Agency Types
 * Type definitions for prosodic gesture animations (brow raises, head nods)
 */

export interface AnimationSnippet {
  name: string;
  curves: Record<string, AnimationCurve[]>;
  snippetCategory: string;
  snippetPriority: number;
  currentTime: number;
  isPlaying: boolean;
  loop: boolean;
  snippetIntensityScale: number;
  maxTime?: number;
  snippetPlaybackRate?: number;
}

export interface AnimationCurve {
  time: number;
  intensity: number;
}

export type ProsodicChannel = 'brow' | 'head' | 'both';

export interface ProsodicConfig {
  browLoopKey?: string;
  headLoopKey?: string;
  browPriority?: number;
  headPriority?: number;
  pulsePriority?: number;
  defaultIntensity?: number;
  fadeSteps?: number;
  fadeStepInterval?: number; // milliseconds
}

export interface ProsodicState {
  browStatus: 'idle' | 'active' | 'stopping';
  headStatus: 'idle' | 'active' | 'stopping';
  browIntensity: number;
  headIntensity: number;
  isLooping: boolean;
}

export interface ProsodicCallbacks {
  onBrowStart?: () => void;
  onBrowStop?: () => void;
  onHeadStart?: () => void;
  onHeadStop?: () => void;
  onPulse?: (channel: ProsodicChannel, wordIndex: number) => void;
  onError?: (error: Error) => void;
}

export interface FadeStep {
  intensity: number;
  delay: number;
}

/**
 * Animation snippet storage key patterns
 */
export const DEFAULT_ANIMATION_KEYS = {
  BROW_LOOP: 'speakingAnimationsList/browRaiseSmall',
  HEAD_LOOP: 'speakingAnimationsList/headNodSmall',
  BROW_PULSE: 'speakingAnimationsList/browPulse',
  HEAD_PULSE: 'speakingAnimationsList/headPulse',
};

/**
 * Default configuration values
 */
export const DEFAULT_PROSODIC_CONFIG: Required<ProsodicConfig> = {
  browLoopKey: DEFAULT_ANIMATION_KEYS.BROW_LOOP,
  headLoopKey: DEFAULT_ANIMATION_KEYS.HEAD_LOOP,
  browPriority: 2,
  headPriority: 2,
  pulsePriority: 5,
  defaultIntensity: 0.7,
  fadeSteps: 4,
  fadeStepInterval: 120,
};
