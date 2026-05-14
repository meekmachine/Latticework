import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EyeHeadTrackingScheduler,
  EyeHeadHostCaps,
  EYE_HEAD_AUS,
  GazeTransitionConfig,
} from '../eyeHeadTrackingScheduler';

const EYE_YAW = 'eyeHeadTracking/eyeYaw';
const EYE_PITCH = 'eyeHeadTracking/eyePitch';
const HEAD_YAW = 'eyeHeadTracking/headYaw';
const HEAD_PITCH = 'eyeHeadTracking/headPitch';
const HEAD_ROLL = 'eyeHeadTracking/headRoll';

describe('EyeHeadTrackingScheduler', () => {
  let scheduler: EyeHeadTrackingScheduler;
  let mockHost: EyeHeadHostCaps;
  let scheduledSnippets: any[];

  const getSnippet = (name: string) => scheduledSnippets.find((snippet) => snippet.name === name);
  const clearHostMocks = () => {
    for (const value of Object.values(mockHost)) {
      if (typeof value === 'function' && 'mockClear' in value) {
        (value as any).mockClear();
      }
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
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
      setSnippetPlaybackRate: vi.fn(),
      setSnippetIntensityScale: vi.fn(),
      setSnippetReverse: vi.fn(),
      removeSnippet: vi.fn(),
    };

    scheduler = new EyeHeadTrackingScheduler(mockHost);
  });

  afterEach(() => {
    scheduler.dispose();
    vi.clearAllTimers();
    vi.useRealTimers();
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

  describe('constructor and config', () => {
    it('should schedule stable normalized control clips', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });

      const eyeYawSnippet = getSnippet(EYE_YAW);
      expect(eyeYawSnippet).toMatchObject({
        name: EYE_YAW,
        maxTime: 1,
        currentTime: 0.5,
        loop: false,
        mixerClampWhenFinished: true,
        snippetCategory: 'eyeHeadTracking',
        snippetPlaybackRate: 1,
        snippetIntensityScale: 1,
      });
      expect(eyeYawSnippet.curves['61']).toEqual([
        { time: 0, intensity: 1 },
        { time: 0.5, intensity: 0 },
        { time: 1, intensity: 0 },
      ]);
      expect(eyeYawSnippet.curves['62']).toEqual([
        { time: 0, intensity: 0 },
        { time: 0.5, intensity: 0 },
        { time: 1, intensity: 1 },
      ]);
    });

    it('should apply custom duration as playback speed, not clip length', () => {
      const customConfig: Partial<GazeTransitionConfig> = {
        duration: 500,
        eyeIntensity: 2.0,
      };
      scheduler = new EyeHeadTrackingScheduler(mockHost, customConfig);

      scheduler.scheduleGazeTransition({ x: 1, y: 0 }, { headEnabled: false });

      expect(getSnippet(EYE_YAW).maxTime).toBe(1);
      expect(mockHost.setSnippetIntensityScale).toHaveBeenCalledWith(EYE_YAW, 2);
      expect(mockHost.setSnippetPlaybackRate).toHaveBeenCalledWith(EYE_YAW, 1);
    });

    it('should update config values for later live controls', () => {
      scheduler.updateConfig({ duration: 600, headIntensity: 1.5 });

      scheduler.scheduleGazeTransition({ x: 1, y: 0 }, { eyeEnabled: false });

      expect(getSnippet(HEAD_YAW).maxTime).toBe(1);
      expect(mockHost.setSnippetIntensityScale).toHaveBeenCalledWith(HEAD_YAW, 1.5);
      expect(mockHost.setSnippetPlaybackRate).toHaveBeenCalledWith(HEAD_YAW, 0.5 / 0.6);
    });
  });

  describe('scheduleGazeTransition', () => {
    it('should schedule eye yaw and pitch snippets', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 }, { headEnabled: false });

      const names = scheduledSnippets.map((snippet) => snippet.name);
      expect(names).toEqual([EYE_YAW, EYE_PITCH]);
    });

    it('should schedule head yaw, pitch, and roll snippets', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 }, { eyeEnabled: false });

      const names = scheduledSnippets.map((snippet) => snippet.name);
      expect(names).toEqual([HEAD_YAW, HEAD_PITCH, HEAD_ROLL]);
    });

    it('should disable eye movement when eyeEnabled is false', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.5 }, { eyeEnabled: false });

      const names = scheduledSnippets.map((snippet) => snippet.name);
      expect(names).not.toContain(EYE_YAW);
      expect(names).not.toContain(EYE_PITCH);
    });

    it('should disable head movement when headEnabled is false', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.5 }, { headEnabled: false });

      const names = scheduledSnippets.map((snippet) => snippet.name);
      expect(names).not.toContain(HEAD_YAW);
      expect(names).not.toContain(HEAD_PITCH);
      expect(names).not.toContain(HEAD_ROLL);
    });

    it('should disable head movement when headFollowEyes is false', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.5 }, { headFollowEyes: false });

      const names = scheduledSnippets.map((snippet) => snippet.name);
      expect(names).not.toContain(HEAD_YAW);
      expect(names).not.toContain(HEAD_PITCH);
      expect(names).not.toContain(HEAD_ROLL);
    });

    it('should drive positive eye yaw forward toward the positive AU', () => {
      scheduler.scheduleGazeTransition(
        { x: 0.5, y: 0 },
        { headEnabled: false, duration: 400 }
      );

      expect(getSnippet(EYE_YAW).curves['62'][2].intensity).toBe(1);
      expect(mockHost.setSnippetReverse).toHaveBeenCalledWith(EYE_YAW, false);
      expect(mockHost.setSnippetPlaybackRate).toHaveBeenCalledWith(EYE_YAW, 0.25 / 0.4);

      vi.advanceTimersByTime(400);

      expect(mockHost.seekSnippet).toHaveBeenCalledWith(EYE_YAW, 0.75);
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(EYE_YAW);
    });

    it('should drive negative eye yaw in reverse toward the negative AU', () => {
      scheduler.scheduleGazeTransition(
        { x: -0.5, y: 0 },
        { headEnabled: false, duration: 400 }
      );

      expect(getSnippet(EYE_YAW).curves['61'][0].intensity).toBe(1);
      expect(mockHost.setSnippetReverse).toHaveBeenCalledWith(EYE_YAW, true);
      expect(mockHost.setSnippetPlaybackRate).toHaveBeenCalledWith(EYE_YAW, 0.25 / 0.4);

      vi.advanceTimersByTime(400);

      expect(mockHost.seekSnippet).toHaveBeenCalledWith(EYE_YAW, 0.25);
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(EYE_YAW);
    });

    it('should map positive pitch to the positive pitch AU endpoint', () => {
      scheduler.scheduleGazeTransition(
        { x: 0, y: 1 },
        { headEnabled: false, duration: 500 }
      );

      expect(getSnippet(EYE_PITCH).curves['63'][2].intensity).toBe(1);
      expect(mockHost.setSnippetReverse).toHaveBeenCalledWith(EYE_PITCH, false);

      vi.advanceTimersByTime(500);

      expect(mockHost.seekSnippet).toHaveBeenCalledWith(EYE_PITCH, 1);
    });

    it('should schedule head roll when headRoll option is provided', () => {
      scheduler.scheduleGazeTransition(
        { x: 0, y: 0 },
        { eyeEnabled: false, headRoll: 0.5 }
      );

      expect(getSnippet(HEAD_ROLL)).toBeDefined();
      expect(mockHost.setSnippetReverse).toHaveBeenCalledWith(HEAD_ROLL, false);
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(HEAD_ROLL);
    });
  });

  describe('persistent axis control', () => {
    it('should not schedule replacement snippets on subsequent gaze updates', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0 });
      clearHostMocks();

      scheduler.scheduleGazeTransition({ x: -0.5, y: 0 });

      expect(mockHost.scheduleSnippet).not.toHaveBeenCalled();
      expect(mockHost.removeSnippet).not.toHaveBeenCalled();
      expect(mockHost.setSnippetReverse).toHaveBeenCalledWith(EYE_YAW, true);
      expect(mockHost.setSnippetPlaybackRate).toHaveBeenCalledWith(EYE_YAW, 0.25 / 0.2);
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(EYE_YAW);
    });

    it('should update mixer weight without rebuilding the clip', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0 }, { headEnabled: false });
      clearHostMocks();
      scheduler.updateConfig({ eyeIntensity: 0.4 });

      scheduler.scheduleGazeTransition({ x: 0.25, y: 0 }, { headEnabled: false });

      expect(mockHost.scheduleSnippet).not.toHaveBeenCalled();
      expect(mockHost.setSnippetIntensityScale).toHaveBeenCalledWith(EYE_YAW, 0.4);
      expect(mockHost.setSnippetIntensityScale).toHaveBeenCalledWith(EYE_PITCH, 0.4);
    });

    it('should seek and pause immediately when already at the requested value', () => {
      scheduler.scheduleGazeTransition({ x: 0, y: 0 }, { headEnabled: false });

      expect(mockHost.seekSnippet).toHaveBeenCalledWith(EYE_YAW, 0.5);
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(EYE_YAW);
      expect(mockHost.resumeSnippet).not.toHaveBeenCalledWith(EYE_YAW);
    });
  });

  describe('resetToNeutral', () => {
    it('should return the existing eye yaw action to center', () => {
      scheduler.scheduleGazeTransition(
        { x: 1, y: 0 },
        { headEnabled: false, duration: 200 }
      );
      vi.advanceTimersByTime(200);
      clearHostMocks();

      scheduler.resetToNeutral(500, { headEnabled: false });

      expect(mockHost.scheduleSnippet).not.toHaveBeenCalled();
      expect(mockHost.setSnippetReverse).toHaveBeenCalledWith(EYE_YAW, true);
      expect(mockHost.setSnippetPlaybackRate).toHaveBeenCalledWith(EYE_YAW, 1);
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(EYE_YAW);

      vi.advanceTimersByTime(500);

      expect(mockHost.seekSnippet).toHaveBeenCalledWith(EYE_YAW, 0.5);
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(EYE_YAW);
    });

    it('should reset only requested output channels', () => {
      scheduler.resetToNeutral(500, { eyeEnabled: false, headEnabled: true });

      const scheduledNames = scheduledSnippets.map((snippet) => snippet.name);
      expect(scheduledNames).toEqual([HEAD_YAW, HEAD_PITCH, HEAD_ROLL]);
    });
  });

  describe('stop', () => {
    it('should remove all tracking snippets', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });
      scheduler.stop();

      expect(mockHost.removeSnippet).toHaveBeenCalledWith(EYE_YAW);
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(EYE_PITCH);
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(HEAD_YAW);
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(HEAD_PITCH);
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(HEAD_ROLL);
    });

    it('should remove only head snippets when stopping head output', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });
      clearHostMocks();

      scheduler.stopHead();

      expect(mockHost.removeSnippet).toHaveBeenCalledWith(HEAD_YAW);
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(HEAD_PITCH);
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(HEAD_ROLL);
      expect(mockHost.removeSnippet).not.toHaveBeenCalledWith(EYE_YAW);
      expect(mockHost.removeSnippet).not.toHaveBeenCalledWith(EYE_PITCH);
    });

    it('should remove only eye snippets when stopping eye output', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });
      clearHostMocks();

      scheduler.stopEyes();

      expect(mockHost.removeSnippet).toHaveBeenCalledWith(EYE_YAW);
      expect(mockHost.removeSnippet).toHaveBeenCalledWith(EYE_PITCH);
      expect(mockHost.removeSnippet).not.toHaveBeenCalledWith(HEAD_YAW);
    });

    it('should cancel in-flight timers for removed head snippets', () => {
      scheduler.scheduleGazeTransition({ x: 1, y: 1 }, { duration: 500 });
      scheduler.stopHead();
      clearHostMocks();

      vi.advanceTimersByTime(500);

      const headSeekCalls = (mockHost.seekSnippet as any).mock.calls.filter(([name]: [string]) =>
        name === HEAD_YAW || name === HEAD_PITCH || name === HEAD_ROLL
      );
      expect(headSeekCalls).toEqual([]);
    });
  });

  describe('pause and resume', () => {
    it('should pause all tracking snippets when pauseSnippet is available', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });
      clearHostMocks();

      scheduler.pause();

      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(EYE_YAW);
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(EYE_PITCH);
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(HEAD_YAW);
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(HEAD_PITCH);
      expect(mockHost.pauseSnippet).toHaveBeenCalledWith(HEAD_ROLL);
    });

    it('should call stop when pauseSnippet is not available', () => {
      const hostWithoutPause: EyeHeadHostCaps = {
        scheduleSnippet: mockHost.scheduleSnippet,
        removeSnippet: mockHost.removeSnippet,
      };
      scheduler = new EyeHeadTrackingScheduler(hostWithoutPause);

      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });
      scheduler.pause();

      expect(hostWithoutPause.removeSnippet).toHaveBeenCalled();
    });

    it('should resume all tracking snippets when requested', () => {
      scheduler.scheduleGazeTransition({ x: 0.5, y: 0.3 });
      clearHostMocks();

      scheduler.resume();

      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(EYE_YAW);
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(EYE_PITCH);
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(HEAD_YAW);
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(HEAD_PITCH);
      expect(mockHost.resumeSnippet).toHaveBeenCalledWith(HEAD_ROLL);
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
