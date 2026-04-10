import { describe, expect, it, vi } from 'vitest';
import { EyeHeadTrackingService } from '../eyeHeadTrackingService';

describe('EyeHeadTrackingService experimental scheduler timing', () => {
  it('marks the experimental gaze target as current without extra pre-smoothing', () => {
    const animationAgency = {
      schedule: vi.fn((snippet: { name: string }) => snippet.name),
      remove: vi.fn(),
      pauseSnippet: vi.fn(),
      resumeSnippet: vi.fn(),
      play: vi.fn(),
    };

    const service = new EyeHeadTrackingService({
      gazeMode: 'experimental',
      useAnimationAgency: true,
      animationAgency,
      eyeTrackingEnabled: true,
      headTrackingEnabled: true,
      headFollowEyes: true,
      returnToNeutralEnabled: false,
    });

    service.setGazeTarget({ x: 1, y: 0, z: 0 });

    expect(service.getState().currentGaze.x).toBe(1);
    expect(animationAgency.schedule).toHaveBeenCalled();
    service.dispose();
  });
});
