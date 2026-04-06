// Legacy stub retained for compatibility with previous exports
import type { GazeTarget } from './types';

export interface GazeAgencyConfig {
  eyesEnabled?: boolean;
  headEnabled?: boolean;
  smoothFactor?: number;
}

export interface GazeAgency {
  updateConfig(config: Partial<GazeAgencyConfig>): void;
  schedule(target: GazeTarget): boolean;
  dispose(): void;
}

export class NullGazeAgency implements GazeAgency {
  private config: GazeAgencyConfig;
  constructor(config?: Partial<GazeAgencyConfig>) {
    this.config = { eyesEnabled: true, headEnabled: true, smoothFactor: 0.3, ...config };
  }
  updateConfig(config: Partial<GazeAgencyConfig>) {
    this.config = { ...this.config, ...config };
  }
  schedule(_target: GazeTarget): boolean {
    return false;
  }
  dispose() {}
}
