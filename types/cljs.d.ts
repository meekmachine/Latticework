export interface WorkerAgencyOutput {
  type: string;
  agency: string;
  [key: string]: unknown;
}

export interface WorkerAgencyHost {
  scheduleSnippet?: (snippet: unknown, opts?: { autoPlay?: boolean }) => string | null;
  schedule?: (snippet: unknown, opts?: AnimationScheduleOptions) => string | null;
  updateSnippet?: (snippet: AnimationSnippet) => string | null;
  removeSnippet?: (name: string) => void;
  remove?: (name: string) => void;
  seekSnippet?: (name: string, offsetSec: number) => void;
  seek?: (name: string, offsetSec: number) => void;
  pauseSnippet?: (name: string) => void;
  resumeSnippet?: (name: string) => void;
  restartSnippet?: (name: string) => void;
  play?: () => void;
  pause?: () => void;
  stop?: () => void;
  setSnippetPlaybackRate?: (name: string, rate: number) => void;
  setSnippetIntensityScale?: (name: string, scale: number) => void;
  setSnippetLoopMode?: (name: string, mode: AnimationLoopMode) => void;
  setSnippetReverse?: (name: string, reverse: boolean) => void;
  onAnimationEffect?: (effect: AnimationEffect) => void;
  onAnimationEvent?: (event: AnimationEvent) => void;
  applyHairState?: (
    state: HairState,
    objects: HairObjectRef[],
    objectStates: HairObjectStateUpdate[],
  ) => void;
  applyHairStateToObject?: (name: string, objectState: HairObjectState) => void;
  applyHairPhysics?: (enabled: boolean, config: HairPhysicsRuntimeConfig) => void;
  setHairPhysicsConfig?: (config: HairPhysicsRuntimeConfig) => void;
  setHairPhysicsEnabled?: (enabled: boolean) => void;
  onOutput?: (output: WorkerAgencyOutput) => void;
  onState?: (state: unknown) => void;
  onError?: (output: WorkerAgencyOutput) => void;
}

export type AnimationEasingType = 'linear' | 'easeInOut' | 'easeInOutCubic' | 'easeIn' | 'easeOut';
export type AnimationLoopMode = 'once' | 'repeat' | 'pingpong';
export type AnimationBlendMode = 'replace' | 'additive';
export type AnimationSnippetCategory = 'auSnippet' | 'visemeSnippet' | 'eyeHeadTracking' | 'combined' | 'default';

export interface AnimationCurvePoint {
  time: number;
  intensity: number;
  inherit?: boolean;
}

export interface AnimationSnippet {
  name?: string;
  curves?: Record<string, AnimationCurvePoint[]>;
  au?: Array<{ t: number; id: number; v: number; inherit?: boolean }>;
  viseme?: Array<{ t: number; key: string; v: number; inherit?: boolean }>;
  loop?: boolean;
  isPlaying?: boolean;
  currentTime?: number;
  snippetCategory?: AnimationSnippetCategory;
  snippetPriority?: number;
  snippetPlaybackRate?: number;
  snippetIntensityScale?: number;
  snippetBlendMode?: AnimationBlendMode;
  snippetJawScale?: number;
  autoVisemeJaw?: boolean;
  snippetBalance?: number;
  snippetBalanceMap?: Record<string, number>;
  snippetEasing?: AnimationEasingType;
  mixerChannel?: string;
  mixerBlendMode?: string;
  mixerWeight?: number;
  mixerFadeDurationMs?: number;
  mixerWarpDurationMs?: number;
  mixerTimeScale?: number;
  mixerLoopMode?: AnimationLoopMode;
  mixerRepeatCount?: number;
  mixerClampWhenFinished?: boolean;
  mixerAdditive?: boolean;
  mixerReverse?: boolean;
  [key: string]: unknown;
}

export interface NormalizedAnimationSnippet extends Required<Pick<
  AnimationSnippet,
  | 'name'
  | 'curves'
  | 'loop'
  | 'isPlaying'
  | 'currentTime'
  | 'snippetCategory'
  | 'snippetPriority'
  | 'snippetPlaybackRate'
  | 'snippetIntensityScale'
  | 'snippetBlendMode'
  | 'snippetJawScale'
  | 'snippetBalance'
  | 'snippetBalanceMap'
  | 'snippetEasing'
  | 'mixerLoopMode'
  | 'mixerReverse'
>> {
  loopIteration: number;
  loopDirection: 1 | -1;
  lastLoopTime: number;
  startWallTime: number;
  duration: number;
  cursor: Record<string, number>;
  autoVisemeJaw?: boolean;
  mixerChannel?: string;
  mixerBlendMode?: string;
  mixerWeight?: number;
  mixerFadeDurationMs?: number;
  mixerWarpDurationMs?: number;
  mixerTimeScale?: number;
  mixerRepeatCount?: number;
  mixerClampWhenFinished?: boolean;
  mixerAdditive?: boolean;
}

export interface AnimationScheduleOptions {
  startInSec?: number;
  startAtSec?: number;
  offsetSec?: number;
  priority?: number;
  autoPlay?: boolean;
}

export interface AnimationScheduleEntry {
  name: string;
  startsAt: number;
  offset: number;
  enabled: boolean;
}

export interface AnimationAgencyState {
  snippets: Record<string, NormalizedAnimationSnippet>;
  order: string[];
  schedule: Record<string, AnimationScheduleEntry>;
  globalPlaybackState: 'playing' | 'paused' | 'stopped';
  eventCount: number;
  lastUpdatedTime: number | null;
}

export interface AnimationScheduleSnapshotEntry {
  name: string;
  enabled: boolean;
  startsAt: number;
  offset: number;
  localTime: number;
  duration: number;
  loop: boolean;
  priority: number;
  playbackRate: number;
  intensityScale: number;
}

export interface AnimationEffect {
  op: string;
  name?: string;
  snippet?: NormalizedAnimationSnippet;
  opts?: AnimationScheduleOptions;
  offsetSec?: number;
  playbackRate?: number;
  intensityScale?: number;
  mixerLoopMode?: AnimationLoopMode;
  reverse?: boolean;
  [key: string]: unknown;
}

export interface AnimationEvent {
  type: string;
  timestamp: number;
  snippetName?: string;
  state?: 'playing' | 'paused' | 'stopped';
  isPlaying?: boolean;
  time?: number;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AnimationAgency {
  loadFromJSON(data: AnimationSnippet): string;
  schedule(snippet: AnimationSnippet, opts?: AnimationScheduleOptions): string;
  updateSnippet(snippet: AnimationSnippet): string;
  remove(name: string): boolean;
  play(): boolean;
  pause(): boolean;
  stop(): boolean;
  enable(name: string, on?: boolean): boolean;
  seek(name: string, offsetSec: number): boolean;
  setSnippetPlaying(name: string, isPlaying: boolean): boolean;
  setSnippetTime(name: string, time: number): boolean;
  setSnippetPlaybackRate(name: string, rate: number): boolean;
  setSnippetIntensityScale(name: string, scale: number): boolean;
  setSnippetLoopMode(name: string, mode: AnimationLoopMode): boolean;
  setSnippetReverse(name: string, reverse: boolean): boolean;
  getState(): AnimationAgencyState;
  getScheduleSnapshot(): AnimationScheduleSnapshotEntry[];
  dispose(): void;
}

export interface BlinkAgencyState {
  enabled: boolean;
  frequency: number;
  duration: number;
  intensity: number;
  randomness: number;
  leftEyeIntensity: number | null;
  rightEyeIntensity: number | null;
  lastBlinkTime: number | null;
  scheduledBlinkCount: number;
}

export interface BlinkAgencyConfig {
  enabled?: boolean;
  frequency?: number;
  duration?: number;
  intensity?: number;
  randomness?: number;
  leftEyeIntensity?: number | null;
  rightEyeIntensity?: number | null;
}

export interface BlinkTriggerOptions {
  intensity?: number;
  duration?: number;
}

export interface BlinkAgency {
  configure(config: BlinkAgencyConfig): void;
  enable(): void;
  disable(): void;
  setFrequency(frequency: number): void;
  setDuration(duration: number): void;
  setIntensity(intensity: number): void;
  setRandomness(randomness: number): void;
  triggerBlink(options?: BlinkTriggerOptions): void;
  reset(): void;
  getState(): BlinkAgencyState;
  dispose(): void;
}

export interface GazeTarget {
  x: number;
  y: number;
  z?: number;
}

export type GazeMode = 'manual' | 'mouse' | 'webcam';

export interface GazeAgencyConfig {
  eyesEnabled?: boolean;
  headEnabled?: boolean;
  headFollowEyes?: boolean;
  mirrored?: boolean;
  smoothFactor?: number;
  minDelta?: number;
  eyeIntensity?: number;
  headIntensity?: number;
  duration?: number;
  eyeDuration?: number;
  headDuration?: number;
  eyePriority?: number;
  headPriority?: number;
  headRoll?: number;
}

export interface GazeAgencyState {
  target: Required<GazeTarget>;
  current: Required<GazeTarget>;
  mode: GazeMode;
  isActive: boolean;
  scheduledGazeCount: number;
  lastScheduledTime: number | null;
  config: Required<Omit<GazeAgencyConfig, 'eyeDuration' | 'headDuration'>> & Pick<GazeAgencyConfig, 'eyeDuration' | 'headDuration'>;
}

export interface GazeAgency {
  configure(config: GazeAgencyConfig): void;
  updateConfig(config: GazeAgencyConfig): void;
  setMode(mode: GazeMode): void;
  setTarget(target: GazeTarget): boolean;
  schedule(target: GazeTarget): boolean;
  resetToNeutral(duration?: number): void;
  stop(): void;
  getState(): GazeAgencyState;
  dispose(): void;
}

export interface HairColor {
  name: string;
  baseColor: string;
  emissive: string;
  emissiveIntensity: number;
}

export interface HairStyle {
  name: string;
  visible: boolean;
  scale?: number;
  position?: [number, number, number];
}

export interface HairState {
  hairColor: HairColor;
  eyebrowColor: HairColor;
  showOutline: boolean;
  outlineColor: string;
  outlineOpacity: number;
  parts: Record<string, HairStyle>;
}

export interface HairObjectRef {
  name: string;
  isEyebrow: boolean;
  isMesh: boolean;
}

export interface HairObjectState {
  color: {
    baseColor: string;
    emissive: string;
    emissiveIntensity: number;
  };
  outline: {
    show: boolean;
    color: string;
    opacity: number;
  };
  visible: boolean;
  scale?: { x: number; y: number; z: number };
  position?: { x: number; y: number; z: number };
  isEyebrow: boolean;
}

export interface HairObjectStateUpdate {
  name: string;
  objectState: HairObjectState;
}

export interface HairPhysicsRuntimeConfig {
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
}

export type HairPhysicsUIConfig = HairPhysicsRuntimeConfig & {
  enabled: boolean;
};

export interface HairAgencyConfig extends Partial<HairState> {
  state?: Partial<HairState>;
  hairState?: Partial<HairState>;
  objects?: HairObjectRef[];
  physics?: Partial<HairPhysicsUIConfig> & {
    config?: Partial<HairPhysicsRuntimeConfig>;
  };
  physicsEnabled?: boolean;
  physicsConfig?: Partial<HairPhysicsRuntimeConfig>;
}

export type HairEvent =
  | { type: 'SET_HAIR_COLOR'; color: HairColor | keyof HairColorPresetMap }
  | { type: 'SET_EYEBROW_COLOR'; color: HairColor | keyof HairColorPresetMap }
  | { type: 'SET_HAIR_BASE_COLOR'; baseColor: string }
  | { type: 'SET_EYEBROW_BASE_COLOR'; baseColor: string }
  | { type: 'SET_HAIR_GLOW'; emissive: string; intensity: number }
  | { type: 'SET_EYEBROW_GLOW'; emissive: string; intensity: number }
  | { type: 'SET_OUTLINE'; show: boolean; color?: string; opacity?: number }
  | { type: 'SET_PART_VISIBILITY'; partName: string; visible: boolean }
  | { type: 'SET_PART_SCALE'; partName: string; scale: number }
  | { type: 'SET_PART_POSITION'; partName: string; position: [number, number, number] }
  | { type: 'RESET_TO_DEFAULT' };

export interface HairColorPresetMap {
  natural_black: HairColor;
  natural_brown: HairColor;
  natural_blonde: HairColor;
  natural_red: HairColor;
  natural_gray: HairColor;
  natural_white: HairColor;
  neon_blue: HairColor;
  neon_pink: HairColor;
  neon_green: HairColor;
  electric_purple: HairColor;
  fire_orange: HairColor;
}

export interface HairAgencyState {
  hairState: HairState;
  objects: HairObjectRef[];
  physics: {
    enabled: boolean;
    config: HairPhysicsRuntimeConfig;
  };
  lastUpdatedTime: number | null;
}

export interface HairAgency {
  configure(config: HairAgencyConfig): void;
  registerObjects(objects: HairObjectRef[]): void;
  send(event: HairEvent): void;
  setHairColor(color: HairColor | keyof HairColorPresetMap): void;
  setEyebrowColor(color: HairColor | keyof HairColorPresetMap): void;
  setHairBaseColor(baseColor: string): void;
  setEyebrowBaseColor(baseColor: string): void;
  setHairGlow(emissive: string, intensity: number): void;
  setEyebrowGlow(emissive: string, intensity: number): void;
  setOutline(show: boolean, color?: string, opacity?: number): void;
  setPartVisibility(partName: string, visible: boolean): void;
  setPartScale(partName: string, scale: number): void;
  setPartPosition(partName: string, position: [number, number, number]): void;
  resetToDefault(): void;
  setPhysicsEnabled(enabled: boolean): void;
  updatePhysicsConfig(config: Partial<HairPhysicsRuntimeConfig>): void;
  getState(): HairAgencyState;
  getHairState(): HairState;
  getPhysicsConfig(): HairPhysicsUIConfig;
  dispose(): void;
}

export interface WorkerAgencyClient {
  post(command: unknown): void;
  configure(agency: string, config: unknown): void;
  dispose(): void;
}

export interface AnimationWorkerClient {
  loadFromJSON(data: AnimationSnippet): void;
  schedule(snippet: AnimationSnippet, opts?: AnimationScheduleOptions): void;
  updateSnippet(snippet: AnimationSnippet): void;
  remove(name: string): void;
  play(): void;
  pause(): void;
  stop(): void;
  enable(name: string, on?: boolean): void;
  seek(name: string, offsetSec: number): void;
  setSnippetPlaying(name: string, isPlaying: boolean): void;
  setSnippetTime(name: string, time: number): void;
  setSnippetPlaybackRate(name: string, rate: number): void;
  setSnippetIntensityScale(name: string, scale: number): void;
  setSnippetLoopMode(name: string, mode: AnimationLoopMode): void;
  setSnippetReverse(name: string, reverse: boolean): void;
  dispose(): void;
}

export interface BlinkWorkerClient extends Omit<BlinkAgency, 'getState'> {}

export interface GazeWorkerClient {
  configure(config: GazeAgencyConfig): void;
  updateConfig(config: GazeAgencyConfig): void;
  setMode(mode: GazeMode): void;
  setTarget(target: GazeTarget): void;
  schedule(target: GazeTarget): void;
  resetToNeutral(duration?: number): void;
  stop(): void;
  dispose(): void;
}

export interface HairWorkerClient {
  configure(config: HairAgencyConfig): void;
  registerObjects(objects: HairObjectRef[]): void;
  send(event: HairEvent): void;
  setHairColor(color: HairColor | keyof HairColorPresetMap): void;
  setEyebrowColor(color: HairColor | keyof HairColorPresetMap): void;
  setHairBaseColor(baseColor: string): void;
  setEyebrowBaseColor(baseColor: string): void;
  setHairGlow(emissive: string, intensity: number): void;
  setEyebrowGlow(emissive: string, intensity: number): void;
  setOutline(show: boolean, color?: string, opacity?: number): void;
  setPartVisibility(partName: string, visible: boolean): void;
  setPartScale(partName: string, scale: number): void;
  setPartPosition(partName: string, position: [number, number, number]): void;
  resetToDefault(): void;
  setPhysicsEnabled(enabled: boolean): void;
  updatePhysicsConfig(config: Partial<HairPhysicsRuntimeConfig>): void;
  dispose(): void;
}

export interface LatticeworkCljsApi {
  createAnimationAgency(config?: Partial<AnimationAgencyState>, host?: WorkerAgencyHost): AnimationAgency;
  createBlinkAgency(config?: BlinkAgencyConfig, host?: WorkerAgencyHost): BlinkAgency;
  createGazeAgency(config?: GazeAgencyConfig, host?: WorkerAgencyHost): GazeAgency;
  createHairAgency(config?: HairAgencyConfig, host?: WorkerAgencyHost): HairAgency;
  createAgencyWorkerClient(worker: Worker, host?: WorkerAgencyHost): WorkerAgencyClient;
  createAnimationWorkerClient(worker: Worker, host?: WorkerAgencyHost): AnimationWorkerClient;
  createBlinkWorkerClient(worker: Worker, host?: WorkerAgencyHost): BlinkWorkerClient;
  createGazeWorkerClient(worker: Worker, host?: WorkerAgencyHost): GazeWorkerClient;
  createHairWorkerClient(worker: Worker, host?: WorkerAgencyHost): HairWorkerClient;
}

export declare function createAnimationAgency(
  config?: Partial<AnimationAgencyState>,
  host?: WorkerAgencyHost,
): AnimationAgency;

export declare function createBlinkAgency(
  config?: BlinkAgencyConfig,
  host?: WorkerAgencyHost,
): BlinkAgency;

export declare function createGazeAgency(
  config?: GazeAgencyConfig,
  host?: WorkerAgencyHost,
): GazeAgency;

export declare function createHairAgency(
  config?: HairAgencyConfig,
  host?: WorkerAgencyHost,
): HairAgency;

export declare function createAgencyWorkerClient(
  worker: Worker,
  host?: WorkerAgencyHost,
): WorkerAgencyClient;

export declare function createAnimationWorkerClient(
  worker: Worker,
  host?: WorkerAgencyHost,
): AnimationWorkerClient;

export declare function createBlinkWorkerClient(
  worker: Worker,
  host?: WorkerAgencyHost,
): BlinkWorkerClient;

export declare function createGazeWorkerClient(
  worker: Worker,
  host?: WorkerAgencyHost,
): GazeWorkerClient;

export declare function createHairWorkerClient(
  worker: Worker,
  host?: WorkerAgencyHost,
): HairWorkerClient;

export declare function installLatticework(target?: typeof globalThis): LatticeworkCljsApi;
