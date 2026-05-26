export interface WorkerAgencyOutput {
  type: string;
  agency: string;
  [key: string]: unknown;
}

export interface WorkerAgencyHost {
  scheduleSnippet?: (snippet: unknown, opts?: { autoPlay?: boolean }) => string | null;
  removeSnippet?: (name: string) => void;
  onOutput?: (output: WorkerAgencyOutput) => void;
  onState?: (state: unknown) => void;
  onError?: (output: WorkerAgencyOutput) => void;
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

export interface WorkerAgencyClient {
  post(command: unknown): void;
  configure(agency: string, config: unknown): void;
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

export interface LatticeworkCljsApi {
  createBlinkAgency(config?: BlinkAgencyConfig, host?: WorkerAgencyHost): BlinkAgency;
  createGazeAgency(config?: GazeAgencyConfig, host?: WorkerAgencyHost): GazeAgency;
  createAgencyWorkerClient(worker: Worker, host?: WorkerAgencyHost): WorkerAgencyClient;
  createBlinkWorkerClient(worker: Worker, host?: WorkerAgencyHost): BlinkWorkerClient;
  createGazeWorkerClient(worker: Worker, host?: WorkerAgencyHost): GazeWorkerClient;
}

export declare function createBlinkAgency(
  config?: BlinkAgencyConfig,
  host?: WorkerAgencyHost,
): BlinkAgency;

export declare function createGazeAgency(
  config?: GazeAgencyConfig,
  host?: WorkerAgencyHost,
): GazeAgency;

export declare function createAgencyWorkerClient(
  worker: Worker,
  host?: WorkerAgencyHost,
): WorkerAgencyClient;

export declare function createBlinkWorkerClient(
  worker: Worker,
  host?: WorkerAgencyHost,
): BlinkWorkerClient;

export declare function createGazeWorkerClient(
  worker: Worker,
  host?: WorkerAgencyHost,
): GazeWorkerClient;

export declare function installLatticework(target?: typeof globalThis): LatticeworkCljsApi;
