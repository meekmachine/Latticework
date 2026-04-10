import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EyeHeadTrackingScheduler,
  EyeHeadHostCaps,
  EYE_HEAD_AUS,
  GazeTransitionConfig,
} from '../eyeHeadTrackingScheduler';

describe('EyeHeadTrackingScheduler', () => {
  let scheduler: EyeHeadTrackingScheduler;
  let mockHost: EyeHeadHostCaps;
  let scheduledSnippets: any[];

  beforeEach(() => {
    scheduledSnippets = [];

    mockHost = {
      scheduleSnippet: vi.fn((snippet) => {
        scheduledSnippets.push(snippet);
        return snippet.name;
      }),
      updateSnippet: vi.fn(),
      seekSnippet: vi.fn(),
      pauseSnippet: vi.fn(),
      resumeSnippet: vi.fn(),
      restartSnippet: vi.fn(),
      removeSnippet: vi.fn(),
    };

    scheduler = new EyeHeadTrackingScheduler(mockHost);
  });

  describe('EYE_HEAD_AUS constants', () => {
    it('should have correct eye AU IDs', () => {
      expect(EYE_HEAD_AUS.EYE_YAW_LEFT).toBe('61');
      expect(EYE_HEAD_AUS.EYE_YAW_RIGHT).toBe('62');
      expect(EYE_HEAD_AUS.EYE_PITCH_UP).toBe('63');
      expect(EYE_HEAD_AUS.EYE_PITCH_DOWN).toBe('64');
    });

    it('should have correct head AU IDs', () => {
      expect(EYE_HEAD_AUS.HEAD_YAW_LEFT).toBe('51');
      expect(EYE_HEAD_AUS.HEAD_YAW_RIGHT).toBe('52');
      expect(EYE_HEAD_AUS.HEAD_PITCH_UP).toBe('53');
      expect(EYE_HEAD_AUS.HEAD_PITCH_DOWN).toBe('54');
      expect(EYE_HEAD_AUS.HEAD_ROLL_LEFT).toBe('55');
      expect(EYE_HEAD_AUS.HEAD_ROLL_RIGHT).toBe('56');
    });
  });

  describe('constructor', () => {
    it('should use default config when none provided', () => {
      const s = new EyeHeadTrackingScheduler(mockHost);
      // Test defaults by scheduling and checking snippet properties
      s.scheduleGazeTransition({ x: 0.5, y: 0 });
      expect(scheduledSnippets.length).toBeGreaterThan(0);
    });

    it('should merge provided config with defaults', () => {
      const customConfig: Partial<GazeTransitionConfig> = {
        duration: 500,
        eyeIntensity: 2.0,
      };
      const s = new EyeHeadTrackingScheduler(mockHost, customConfig);

      s.scheduleGazeTransition({ x: 1, y: 0 });

      // Check that the duration was applied (0.5 seconds)
      const eyeYawSnippet = scheduledSnippets.find(
        (s) => s.name === 'eyeHeadTracking/eyeYaw'
      );
      expect(eyeYawSnippet).toBeDefined();
      expect(eyeYawSnippet.maxTime).toBe(0.5); // 500ms = 0.5s
    });
  });

  describe('updateConfig', () => {
    it('should update config values', () => {
      scheduler.updateConfig({ duration: 600, headIntensity: 1.5 });

      scheduler.scheduleGazeTransition({ x: 0, y: 0.5 });

      const headPitchSnippet = scheduledSnippets.find(
        (s) => s.name === 'eyeHeadTracking/headPitch'
      );
      expect(headPitchSnippet).toBeDefined();
      expect(headPitchSnippet.maxTime).toBe(0.6); // 600ms = 0.6s
    });
  });

  describe('scheduleGazeTransition', () => {
    describe('eye movements', () => {
      it('should schedule eye yaw and pitch snippets', () => {
        scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });

        const names = scheduledSnippets.map((s) => s.name);
        expect(names).toContain('eyeHeadTracking/eyeYaw');
        expect(names).toContain('eyeHeadTracking/eyePitch');
      });

      it('should use correct AU IDs for positive eye yaw (look right)', () => {
        scheduler.scheduleGazeTransition(
          { x: 0.5, y: 0 },
          { headEnabled: false }
        );

        const eyeYawSnippet = scheduledSnippets.find(
          (s) => s.name === 'eyeHeadTracking/eyeYaw'
        );
        expect(eyeYawSnippet).toBeDefined();
        expect(eyeYawSnippet.curves).toBeDefined();

        // Positive x = look right = AU 62 should have value, AU 61 should be 0
        expect(eyeYawSnippet.curves['62']).toBeDefined();
        expect(eyeYawSnippet.curves['61']).toBeDefined();

        // AU 62 (right) should have intensity at the end
        const rightCurve = eyeYawSnippet.curves['62'];
        expect(rightCurve[rightCurve.length - 1].intensity).toBeGreaterThan(0);

        // AU 61 (left) should be 0 at end
        const leftCurve = eyeYawSnippet.curves['61'];
        expect(leftCurve[leftCurve.length - 1].intensity).toBe(0);
      });

      it('should use correct AU IDs for negative eye yaw (look left)', () => {
        scheduler.scheduleGazeTransition(
          { x: -0.5, y: 0 },
          { headEnabled: false }
        );

        const eyeYawSnippet = scheduledSnippets.find(
          (s) => s.name === 'eyeHeadTracking/eyeYaw'
        );
        expect(eyeYawSnippet).toBeDefined();

        // Negative x = look left = AU 61 should have value
        const leftCurve = eyeYawSnippet.curves['61'];
        expect(leftCurve[leftCurve.length - 1].intensity).toBeGreaterThan(0);

        // AU 62 (right) should be 0
        const rightCurve = eyeYawSnippet.curves['62'];
        expect(rightCurve[rightCurve.length - 1].intensity).toBe(0);
      });

      it('should use correct AU IDs for positive eye pitch (look up)', () => {
        scheduler.scheduleGazeTransition(
          { x: 0, y: 0.5 },
          { headEnabled: false }
        );

        const eyePitchSnippet = scheduledSnippets.find(
          (s) => s.name === 'eyeHeadTracking/eyePitch'
        );
        expect(eyePitchSnippet).toBeDefined();

        // Positive y = look up = AU 63 should have value
        const upCurve = eyePitchSnippet.curves['63'];
        expect(upCurve[upCurve.length - 1].intensity).toBeGreaterThan(0);

        // AU 64 (down) should be 0
        const downCurve = eyePitchSnippet.curves['64'];
        expect(downCurve[downCurve.length - 1].intensity).toBe(0);
      });

      it('should disable eye movement when eyeEnabled is false', () => {
        scheduler.scheduleGazeTransition(
          { x: 0.5, y: 0.5 },
          { eyeEnabled: false }
        );

        const eyeSnippets = scheduledSnippets.filter(
          (s) =>
            s.name === 'eyeHeadTracking/eyeYaw' ||
            s.name === 'eyeHeadTracking/eyePitch'
        );
        expect(eyeSnippets.length).toBe(0);
      });
    });

    describe('head movements', () => {
      it('should schedule head yaw, pitch, and roll snippets', () => {
        scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });

        const names = scheduledSnippets.map((s) => s.name);
        expect(names).toContain('eyeHeadTracking/headYaw');
        expect(names).toContain('eyeHeadTracking/headPitch');
        expect(names).toContain('eyeHeadTracking/headRoll');
      });

      it('should use correct AU IDs for positive head yaw (turn right)', () => {
        scheduler.scheduleGazeTransition(
          { x: 0.5, y: 0 },
          { eyeEnabled: false }
        );

        const headYawSnippet = scheduledSnippets.find(
          (s) => s.name === 'eyeHeadTracking/headYaw'
        );
        expect(headYawSnippet).toBeDefined();

        // Positive x = turn right = AU 52 should have value
        const rightCurve = headYawSnippet.curves['52'];
        expect(rightCurve[rightCurve.length - 1].intensity).toBeGreaterThan(0);

        // AU 51 (left) should be 0
        const leftCurve = headYawSnippet.curves['51'];
        expect(leftCurve[leftCurve.length - 1].intensity).toBe(0);
      });

      it('should schedule head roll when headRoll option is provided', () => {
        scheduler.scheduleGazeTransition(
          { x: 0, y: 0 },
          { eyeEnabled: false, headRoll: 0.5 }
        );

        const headRollSnippet = scheduledSnippets.find(
          (s) => s.name === 'eyeHeadTracking/headRoll'
        );
        expect(headRollSnippet).toBeDefined();

        // Positive roll = tilt right = AU 56 should have value
        const rightCurve = headRollSnippet.curves['56'];
        expect(rightCurve[rightCurve.length - 1].intensity).toBeGreaterThan(0);
      });

      it('should disable head movement when headEnabled is false', () => {
        scheduler.scheduleGazeTransition(
          { x: 0.5, y: 0.5 },
          { headEnabled: false }
        );

        const headSnippets = scheduledSnippets.filter((s) =>
          s.name.includes('head')
        );
        expect(headSnippets.length).toBe(0);
      });

      it('should disable head movement when headFollowEyes is false', () => {
        scheduler.scheduleGazeTransition(
          { x: 0.5, y: 0.5 },
          { headFollowEyes: false }
        );

        const headSnippets = scheduledSnippets.filter((s) =>
          s.name.includes('head')
        );
        expect(headSnippets.length).toBe(0);
      });
    });

    describe('snippet properties', () => {
      it('should set correct snippet category', () => {
        scheduler.scheduleGazeTransition({ x: 0.5, y: 0 });

        for (const snippet of scheduledSnippets) {
          expect(snippet.snippetCategory).toBe('eyeHeadTracking');
        }
      });

      it('should set loop to false', () => {
        scheduler.scheduleGazeTransition({ x: 0.5, y: 0 });

        for (const snippet of scheduledSnippets) {
          expect(snippet.loop).toBe(false);
        }
      });

      it('should respect custom duration option', () => {
        scheduler.scheduleGazeTransition({ x: 0.5, y: 0 }, { duration: 400 });

        const eyeYawSnippet = scheduledSnippets.find(
          (s) => s.name === 'eyeHeadTracking/eyeYaw'
        );
        expect(eyeYawSnippet.maxTime).toBe(0.4); // 400ms = 0.4s
      });

      it('should support separate eye and head durations', () => {
        scheduler.scheduleGazeTransition(
          { x: 0.5, y: 0 },
          { eyeDuration: 200, headDuration: 500 }
        );

        const eyeYawSnippet = scheduledSnippets.find(
          (s) => s.name === 'eyeHeadTracking/eyeYaw'
        );
        const headYawSnippet = scheduledSnippets.find(
          (s) => s.name === 'eyeHeadTracking/headYaw'
        );

        expect(eyeYawSnippet.maxTime).toBe(0.2);
        expect(headYawSnippet.maxTime).toBe(0.5);
      });
    });

    describe('curve structure', () => {
      it('should animate from the current pose to the target over the requested duration', () => {
        scheduler.scheduleGazeTransition(
          { x: 0.5, y: 0 },
          { headEnabled: false }
        );

        const eyeYawSnippet = scheduledSnippets.find(
          (s) => s.name === 'eyeHeadTracking/eyeYaw'
        );

        expect(eyeYawSnippet.curves['61'].length).toBe(2);
        expect(eyeYawSnippet.curves['62'].length).toBe(2);
        expect(eyeYawSnippet.curves['61'][0].time).toBe(0);
        expect(eyeYawSnippet.curves['61'][0].intensity).toBe(0);
        expect(eyeYawSnippet.curves['61'][0].inherit).toBe(true);
        expect(eyeYawSnippet.curves['62'][0].time).toBe(0);
        expect(eyeYawSnippet.curves['62'][0].intensity).toBe(0);
        expect(eyeYawSnippet.curves['62'][0].inherit).toBe(true);
        expect(eyeYawSnippet.curves['61'][1].time).toBe(0.2);
        expect(eyeYawSnippet.curves['61'][1].intensity).toBe(0);
        expect(eyeYawSnippet.curves['62'][1].time).toBe(0.2);
        expect(eyeYawSnippet.curves['62'][1].intensity).toBe(0.5);
      });

      it('should always schedule BOTH directions for proper transitions', () => {
        scheduler.scheduleGazeTransition(
          { x: 0.5, y: 0 },
          { headEnabled: false }
        );

        const eyeYawSnippet = scheduledSnippets.find(
          (s) => s.name === 'eyeHeadTracking/eyeYaw'
        );

        // Both AU 61 and 62 should be present in curves
        expect(eyeYawSnippet.curves['61']).toBeDefined();
        expect(eyeYawSnippet.curves['62']).toBeDefined();
      });
    });
  });

  describe('upsertSnippet behavior', () => {
    it('should schedule new snippet on first call', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0 });

      expect(mockHost.scheduleSnippet).toHaveBeenCalled();
      expect(scheduledSnippets.length).toBeGreaterThan(0);
    });

    it('should remove and reschedule existing snippets on subsequent calls', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0 });
      (mockHost.removeSnippet as any).mockClear();
      (mockHost.scheduleSnippet as any).mockClear();

      scheduler.scheduleGazeTransition({ x: -0.5, y: 0 });

      expect(mockHost.removeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/eyeYaw'
      );
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/eyePitch'
      );
      expect(mockHost.scheduleSnippet).toHaveBeenCalled();
    });

    it('should resume freshly scheduled snippets after rescheduling', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0 });
      (mockHost.resumeSnippet as any).mockClear();

      scheduler.scheduleGazeTransition({ x: -0.5, y: 0 });

      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/eyeYaw'
      );
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/headYaw'
      );
    });
  });

  describe('stop', () => {
    it('should remove all tracking snippets', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });
      scheduler.stop();

      expect(mockHost.removeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/eyeYaw'
      );
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/eyePitch'
      );
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/headYaw'
      );
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/headPitch'
      );
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/headRoll'
      );
    });
  });

  describe('pause', () => {
    it('should pause all tracking snippets when pauseSnippet is available', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });
      scheduler.pause();

      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/eyeYaw'
      );
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/eyePitch'
      );
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/headYaw'
      );
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/headPitch'
      );
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/headRoll'
      );
    });

    it('should call stop when pauseSnippet is not available', () => {
      const hostWithoutPause: EyeHeadHostCaps = {
        scheduleSnippet: mockHost.scheduleSnippet,
        removeSnippet: mockHost.removeSnippet,
      };
      const s = new EyeHeadTrackingScheduler(hostWithoutPause);

      s.scheduleGazeTransition({ x: 0.5, y: 0.3 });
      s.pause();

      // Should have called removeSnippet instead
      expect(hostWithoutPause.removeSnippet).toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('should resume all tracking snippets', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });
      scheduler.pause();
      scheduler.resume();

      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/eyeYaw'
      );
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/eyePitch'
      );
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/headYaw'
      );
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/headPitch'
      );
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(
        'eyeHeadTracking/headRoll'
      );
    });
  });

  describe('resetToNeutral', () => {
    it('should schedule transition to center position', () => {
      scheduler.resetToNeutral();

      // Should schedule eye and head movements to (0, 0)
      const eyeYawSnippet = scheduledSnippets.find(
        (s) => s.name === 'eyeHeadTracking/eyeYaw'
      );
      expect(eyeYawSnippet).toBeDefined();

      // Both directions should end at 0
      expect(
        eyeYawSnippet.curves['61'][eyeYawSnippet.curves['61'].length - 1]
          .intensity
      ).toBe(0);
      expect(
        eyeYawSnippet.curves['62'][eyeYawSnippet.curves['62'].length - 1]
          .intensity
      ).toBe(0);
    });

    it('should use provided duration', () => {
      scheduler.resetToNeutral(500);

      const eyeYawSnippet = scheduledSnippets.find(
        (s) => s.name === 'eyeHeadTracking/eyeYaw'
      );
      expect(eyeYawSnippet.maxTime).toBe(0.5);
    });
  });

  describe('dispose', () => {
    it('should call stop', () => {
      const stopSpy = vi.spyOn(scheduler, 'stop');
      scheduler.dispose();
      expect(stopSpy).toHaveBeenCalled();
    });
  });
});
