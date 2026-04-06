import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { animationEventEmitter, createAnimationService } from '../animationService';
import type { Engine } from '../types';

describe('AnimationService', () => {
  let service: ReturnType<typeof createAnimationService>;
  let mockHost: Partial<Engine>;
  let builtClips: Array<{
    name: string;
    curves: Record<string, Array<{ time: number; intensity: number }>>;
    options: any;
    handle: any;
  }>;

  beforeEach(() => {
    // Use fake timers for deterministic time control
    vi.useFakeTimers();

    // Mock performance.now() to use Date.now() so fake timers work
    const originalPerformance = globalThis.performance;
    vi.stubGlobal('performance', {
      ...originalPerformance,
      now: () => Date.now()
    });

    // Mock localStorage for Vitest environment
    const localStorageMock = {
      data: {} as Record<string, string>,
      getItem(key: string) {
        return this.data[key] || null;
      },
      setItem(key: string, value: string) {
        this.data[key] = value;
      },
      removeItem(key: string) {
        delete this.data[key];
      },
      clear() {
        this.data = {};
      }
    };
    vi.stubGlobal('localStorage', localStorageMock);

    // Mock window object for Vitest environment
    vi.stubGlobal('window', {});

    builtClips = [];

    // Create mock host with TransitionHandle returns
    const mockTransitionHandle = () => ({
      promise: Promise.resolve(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    });

    const mockClipHandle = (
      name: string,
      curves: Record<string, Array<{ time: number; intensity: number }>>
    ) => {
      const duration = Math.max(
        0,
        ...Object.values(curves).flatMap((curve) => curve.map((kf) => kf.time))
      );
      let time = 0;
      let resolveFinished = () => {};
      const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });

      return {
        actionId: `${name}-action`,
        clipName: name,
        play: vi.fn(() => {
          time = duration;
          setTimeout(() => resolveFinished(), 0);
        }),
        pause: vi.fn(),
        resume: vi.fn(),
        stop: vi.fn(() => resolveFinished()),
        getTime: vi.fn(() => time),
        setTime: vi.fn((nextTime: number) => {
          time = nextTime;
        }),
        getDuration: vi.fn(() => duration),
        setPlaybackRate: vi.fn(),
        setLoop: vi.fn(),
        finished,
      };
    };

    mockHost = {
      setAU: vi.fn(),
      setMorph: vi.fn(),
      transitionAU: vi.fn(() => mockTransitionHandle()),
      transitionMorph: vi.fn(() => mockTransitionHandle()),
      buildClip: vi.fn((name, curves, options) => {
        const handle = mockClipHandle(name, curves);
        builtClips.push({ name, curves, options, handle });
        return handle;
      }),
      updateClipParams: vi.fn(),
      cleanupSnippet: vi.fn(),
      getAU: vi.fn(() => 0),
      onSnippetEnd: vi.fn()
    };

    // Create service
    service = createAnimationService(mockHost as Engine);
  });

  afterEach(() => {
    service.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('Service Creation and Initialization', () => {
    it('should create a service with all API methods', () => {
      expect(service).toBeDefined();
      expect(typeof service.loadFromJSON).toBe('function');
      expect(typeof service.schedule).toBe('function');
      expect(typeof service.play).toBe('function');
      expect(typeof service.pause).toBe('function');
      expect(typeof service.stop).toBe('function');
      expect(typeof service.remove).toBe('function');
    });

    it('should initialize in non-playing state', () => {
      expect(service.isPlaying()).toBe(false);
    });

    it('should expose window.anim global', () => {
      expect((window as any).anim).toBe(service);
    });
  });

  describe('Loading Animations', () => {
    it('should load animation from JSON', () => {
      const snippet = {
        name: 'test_load',
        curves: {
          '1': [
            { time: 0, intensity: 0 },
            { time: 1, intensity: 1 }
          ]
        }
      };

      const name = service.loadFromJSON(snippet);
      expect(name).toBe('test_load');

      const state = service.getState();
      expect(state.context.animations).toHaveLength(1);
      expect(state.context.animations[0].name).toBe('test_load');
    });

    it('should generate name if not provided', () => {
      const snippet = {
        curves: {
          '1': [{ time: 0, intensity: 0 }]
        }
      };

      const name = service.loadFromJSON(snippet);
      expect(name).toMatch(/^sn_\d+$/);
    });

    it('should normalize AU keyframes to curves', () => {
      const snippet = {
        name: 'test_au',
        au: [
          { t: 0, id: 1, v: 0 },
          { t: 1, id: 1, v: 1 }
        ]
      };

      service.loadFromJSON(snippet);
      const state = service.getState();
      const loaded = state.context.animations[0];

      expect(loaded.curves).toBeDefined();
      expect(loaded.curves['1']).toHaveLength(2);
      // First keyframe at time 0 may have inherit flag from continuity feature
      expect(loaded.curves['1'][0]).toMatchObject({ time: 0, intensity: 0 });
      expect(loaded.curves['1'][1]).toMatchObject({ time: 1, intensity: 1 });
    });

    it('should normalize viseme keyframes to curves', () => {
      const snippet = {
        name: 'test_viseme',
        viseme: [
          { t: 0, key: 'aa', v: 0.5 },
          { t: 1, key: 'aa', v: 1.0 }
        ]
      };

      service.loadFromJSON(snippet);
      const state = service.getState();
      const loaded = state.context.animations[0];

      expect(loaded.curves).toBeDefined();
      expect(loaded.curves['aa']).toHaveLength(2);
      // First keyframe at time 0 gets replaced with current value (0) due to continuity feature
      expect(loaded.curves['aa'][0].time).toBe(0);
      // The second keyframe retains its original intensity
      expect(loaded.curves['aa'][1]).toMatchObject({ time: 1, intensity: 1.0 });
    });

    it('should load from localStorage', () => {
      const snippet = {
        name: 'test_local',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      // Mock localStorage
      localStorage.setItem('test/snippet', JSON.stringify(snippet));

      const name = service.loadFromLocal('test/snippet');
      expect(name).toBe('test_local');

      const state = service.getState();
      expect(state.context.animations).toHaveLength(1);
    });

    it('should extract name from localStorage key if not in data', () => {
      const snippet = {
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      localStorage.setItem('emotionAnimationsList/happy_smile', JSON.stringify(snippet));

      const name = service.loadFromLocal('emotionAnimationsList/happy_smile');
      expect(name).toBe('happy_smile');
    });

    it('should return null for missing localStorage key', () => {
      const name = service.loadFromLocal('nonexistent/key');
      expect(name).toBe(null);
    });
  });

  describe('Scheduling with Options', () => {
    it('should schedule animation with priority option', () => {
      const snippet = {
        name: 'test_schedule',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.schedule(snippet, { priority: 10 });

      const state = service.getState();
      const loaded = state.context.animations[0];
      expect(loaded.snippetPriority).toBe(10);
    });

    it('should schedule multiple animations', () => {
      const snippet1 = {
        name: 's1',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };
      const snippet2 = {
        name: 's2',
        curves: { '2': [{ time: 0, intensity: 0.5 }] }
      };

      service.schedule(snippet1);
      service.schedule(snippet2);

      const state = service.getState();
      expect(state.context.animations).toHaveLength(2);
    });
  });

  describe('Playback Control', () => {
    it('should start playing when play() is called', () => {
      const snippet = {
        name: 'test_play',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      service.play();

      expect(service.isPlaying()).toBe(true);
    });

    it('should pause playback', () => {
      const snippet = {
        name: 'test_pause',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      service.play();
      expect(service.isPlaying()).toBe(true);

      service.pause();
      expect(service.isPlaying()).toBe(false);
    });

    it('should stop playback', () => {
      const snippet = {
        name: 'test_stop',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      service.play();
      expect(service.isPlaying()).toBe(true);

      service.stop();
      expect(service.isPlaying()).toBe(false);
    });

    it('should support playing property getter', () => {
      const snippet = {
        name: 'test_playing',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      expect(service.playing).toBe(false);

      service.play();
      expect(service.playing).toBe(true);
    });
  });

  describe('Snippet Removal', () => {
    it('should remove snippet by name', () => {
      const snippet = {
        name: 'to_remove',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      let state = service.getState();
      expect(state.context.animations).toHaveLength(1);

      service.remove('to_remove');
      state = service.getState();
      expect(state.context.animations).toHaveLength(0);
    });
  });

  describe('Snippet Parameter Tuning', () => {
    it('should set snippet playback rate', () => {
      const snippet = {
        name: 'test_rate',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      service.setSnippetPlaybackRate('test_rate', 2.0);

      const state = service.getState();
      const loaded = state.context.animations[0];
      expect(loaded.snippetPlaybackRate).toBe(2.0);
    });

    it('should set snippet intensity scale', () => {
      const snippet = {
        name: 'test_scale',
        curves: { '1': [{ time: 0, intensity: 1.0 }] }
      };

      service.loadFromJSON(snippet);
      service.setSnippetIntensityScale('test_scale', 0.5);

      const state = service.getState();
      const loaded = state.context.animations[0];
      expect(loaded.snippetIntensityScale).toBe(0.5);
    });

    it('should set snippet priority', () => {
      const snippet = {
        name: 'test_priority',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      service.setSnippetPriority('test_priority', 15);

      const state = service.getState();
      const loaded = state.context.animations[0];
      expect(loaded.snippetPriority).toBe(15);
    });

    it('should set snippet loop mode', () => {
      const snippet = {
        name: 'test_loop',
        loop: false,
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      service.setSnippetLoopMode('test_loop', 'repeat');

      const state = service.getState();
      const loaded = state.context.animations[0];
      expect(loaded.mixerLoopMode).toBe('repeat');
      expect(loaded.loop).toBe(true);
    });

    it('should set snippet playing state', () => {
      const snippet = {
        name: 'test_playing',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      service.setSnippetPlaying('test_playing', true);

      const state = service.getState();
      const loaded = state.context.animations[0];
      expect(loaded.isPlaying).toBe(true);
    });

    it('should validate playback rate is positive', () => {
      const snippet = {
        name: 'test_rate_validate',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      service.setSnippetPlaybackRate('test_rate_validate', -1);

      const state = service.getState();
      const loaded = state.context.animations[0];
      // Should default to 1 for invalid rates
      expect(loaded.snippetPlaybackRate).toBe(1);
    });

    it('should clamp intensity scale to minimum 0', () => {
      const snippet = {
        name: 'test_scale_clamp',
        curves: { '1': [{ time: 0, intensity: 1.0 }] }
      };

      service.loadFromJSON(snippet);
      service.setSnippetIntensityScale('test_scale_clamp', -0.5);

      const state = service.getState();
      const loaded = state.context.animations[0];
      expect(loaded.snippetIntensityScale).toBe(0);
    });
  });

  describe('Seek Functionality', () => {
    it('should seek to specific time in snippet', () => {
      const snippet = {
        name: 'test_seek',
        curves: {
          '1': [
            { time: 0, intensity: 0 },
            { time: 5, intensity: 1 }
          ]
        }
      };

      service.loadFromJSON(snippet);
      service.setSnippetTime('test_seek', 2.5);

      const state = service.getState();
      const loaded = state.context.animations[0];
      expect(loaded.currentTime).toBe(2.5);
    });

    it('should clamp seek time to minimum 0', () => {
      const snippet = {
        name: 'test_seek_clamp',
        curves: { '1': [{ time: 0, intensity: 0 }] }
      };

      service.loadFromJSON(snippet);
      service.setSnippetTime('test_seek_clamp', -1);

      const state = service.getState();
      const loaded = state.context.animations[0];
      expect(loaded.currentTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Clip-based Playback', () => {
    it('should build and play a clip when play() is called', async () => {
      const snippet = {
        name: 'test_playback',
        curves: { '1': [{ time: 0, intensity: 0 }, { time: 0.1, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      service.play();

      await vi.runAllTimersAsync();

      expect(builtClips).toHaveLength(1);
      expect(builtClips[0].name).toBe('test_playback');
      expect(builtClips[0].curves['1']).toEqual([
        { time: 0, intensity: 0 },
        { time: 0.1, intensity: 0.5 }
      ]);
      expect(builtClips[0].options).toMatchObject({
        loopMode: 'once',
        playbackRate: 1,
        intensityScale: 1,
      });
      expect(builtClips[0].handle.play).toHaveBeenCalled();
      expect(mockHost.onSnippetEnd as any).toHaveBeenCalledWith('test_playback');
    });
  });

  describe('Baked Animation State', () => {
    it('initializes baked clips with persistent stopped UI state', () => {
      const bakedEngine = {
        getAnimationClips: vi.fn(() => [{ name: 'Idle', duration: 4 }]),
        getPlayingAnimations: vi.fn(() => []),
        playAnimation: vi.fn(),
        stopAnimation: vi.fn(),
        pauseAnimation: vi.fn(),
        resumeAnimation: vi.fn(),
        setAnimationSpeed: vi.fn(),
        setAnimationIntensity: vi.fn(),
        setAnimationLoopMode: vi.fn(),
        setAnimationRepeatCount: vi.fn(),
        setAnimationReverse: vi.fn(),
        setAnimationBlendMode: vi.fn(),
        seekAnimation: vi.fn(),
        stopAllAnimations: vi.fn(),
      };

      service.setBakedAnimationEngine(bakedEngine as any);

      expect(service.getBakedClips()).toEqual([{ name: 'Idle', duration: 4 }]);
      expect(animationEventEmitter.getBakedAnimationState('Idle')).toMatchObject({
        name: 'Idle',
        source: 'baked',
        category: 'baked',
        isPlaying: false,
        isPaused: false,
        loopMode: 'once',
        playbackRate: 1,
        intensityScale: 1,
      });
    });

    it('reuses stored baked options when replaying a stopped clip', () => {
      const bakedHandle = {
        getState: vi.fn(() => ({
          name: 'Idle',
          source: 'baked',
          time: 0,
          duration: 4,
          speed: 1.25,
          playbackRate: 1.25,
          reverse: true,
          weight: 1.5,
          balance: 0.3,
          blendMode: 'additive',
          easing: 'easeInOut',
          loop: true,
          loopMode: 'pingpong',
          repeatCount: 2,
          isPlaying: true,
          isPaused: false,
          isLooping: true,
        })),
        finished: Promise.resolve(),
      };

      const bakedEngine = {
        getAnimationClips: vi.fn(() => [{ name: 'Idle', duration: 4 }]),
        getPlayingAnimations: vi.fn(() => []),
        playAnimation: vi.fn(() => bakedHandle),
        stopAnimation: vi.fn(),
        pauseAnimation: vi.fn(),
        resumeAnimation: vi.fn(),
        setAnimationSpeed: vi.fn(),
        setAnimationIntensity: vi.fn(),
        setAnimationLoopMode: vi.fn(),
        setAnimationRepeatCount: vi.fn(),
        setAnimationReverse: vi.fn(),
        setAnimationBlendMode: vi.fn(),
        seekAnimation: vi.fn(),
        stopAllAnimations: vi.fn(),
      };

      service.setBakedAnimationEngine(bakedEngine as any);
      service.setBakedAnimationLoopMode('Idle', 'pingpong');
      service.setBakedAnimationRepeatCount('Idle', 2);
      service.setBakedAnimationReverse('Idle', true);
      service.setBakedAnimationBlendMode('Idle', 'additive');
      service.setBakedAnimationBalance('Idle', 0.3);
      service.setBakedAnimationEasing('Idle', 'easeInOut');
      service.setBakedAnimationSpeed('Idle', 1.25);
      service.setBakedAnimationWeight('Idle', 1.5);

      service.playBakedAnimation('Idle');

      expect(bakedEngine.playAnimation).toHaveBeenCalledWith('Idle', expect.objectContaining({
        loopMode: 'pingpong',
        repeatCount: 2,
        reverse: true,
        playbackRate: 1.25,
        weight: 1.5,
        blendMode: 'additive',
      }));
      expect(animationEventEmitter.getBakedAnimationState('Idle')).toMatchObject({
        blendMode: 'additive',
        reverse: true,
        repeatCount: 2,
        loopMode: 'pingpong',
        balance: 0.3,
        easing: 'easeInOut',
      });
    });

    it('delegates baked mixer params directly to the engine without restart emulation', () => {
      const bakedEngine = {
        getAnimationClips: vi.fn(() => [{ name: 'Idle', duration: 4 }]),
        getPlayingAnimations: vi.fn(() => []),
        playAnimation: vi.fn(),
        stopAnimation: vi.fn(),
        pauseAnimation: vi.fn(),
        resumeAnimation: vi.fn(),
        setAnimationSpeed: vi.fn(),
        setAnimationIntensity: vi.fn(),
        setAnimationLoopMode: vi.fn(),
        setAnimationRepeatCount: vi.fn(),
        setAnimationReverse: vi.fn(),
        setAnimationBlendMode: vi.fn(),
        seekAnimation: vi.fn(),
        stopAllAnimations: vi.fn(),
      };

      service.setBakedAnimationEngine(bakedEngine as any);
      service.setBakedAnimationLoopMode('Idle', 'pingpong');
      service.setBakedAnimationRepeatCount('Idle', 2);
      service.setBakedAnimationReverse('Idle', true);
      service.setBakedAnimationBlendMode('Idle', 'additive');

      expect(bakedEngine.setAnimationLoopMode).toHaveBeenCalledWith('Idle', 'pingpong');
      expect(bakedEngine.setAnimationRepeatCount).toHaveBeenCalledWith('Idle', 2);
      expect(bakedEngine.setAnimationReverse).toHaveBeenCalledWith('Idle', true);
      expect(bakedEngine.setAnimationBlendMode).toHaveBeenCalledWith('Idle', 'additive');
      expect(bakedEngine.stopAnimation).not.toHaveBeenCalled();
      expect(bakedEngine.playAnimation).not.toHaveBeenCalled();
    });

    it('replays a completed once clip without seeking back to the terminal frame', () => {
      let resolveFinished = () => {};
      const bakedHandle = {
        getState: vi.fn(() => ({
          name: 'Idle',
          source: 'baked',
          time: 0,
          duration: 4,
          speed: 1,
          playbackRate: 1,
          reverse: false,
          weight: 1,
          blendMode: 'replace',
          easing: 'linear',
          loop: false,
          loopMode: 'once',
          isPlaying: true,
          isPaused: false,
          isLooping: false,
        })),
        finished: new Promise<void>((resolve) => {
          resolveFinished = resolve;
        }),
      };

      const bakedEngine = {
        getAnimationClips: vi.fn(() => [{ name: 'Idle', duration: 4 }]),
        getPlayingAnimations: vi.fn(() => []),
        playAnimation: vi.fn(() => bakedHandle),
        stopAnimation: vi.fn(),
        pauseAnimation: vi.fn(),
        resumeAnimation: vi.fn(),
        setAnimationSpeed: vi.fn(),
        setAnimationIntensity: vi.fn(),
        setAnimationLoopMode: vi.fn(),
        setAnimationRepeatCount: vi.fn(),
        setAnimationReverse: vi.fn(),
        setAnimationBlendMode: vi.fn(),
        seekAnimation: vi.fn(),
        stopAllAnimations: vi.fn(),
      };

      service.setBakedAnimationEngine(bakedEngine as any);
      service.setBakedAnimationLoopMode('Idle', 'once');
      service.playBakedAnimation('Idle');

      resolveFinished();
      void Promise.resolve().then(() => {});
      vi.runAllTimers();

      animationEventEmitter.emitBakedAnimationCompleted('Idle');
      bakedEngine.seekAnimation.mockClear();

      service.playBakedAnimation('Idle');

      expect(bakedEngine.playAnimation).toHaveBeenLastCalledWith('Idle', expect.objectContaining({
        loopMode: 'once',
      }));
      expect(bakedEngine.seekAnimation).not.toHaveBeenCalled();
    });
  });

  describe('State Subscription', () => {
    it('should allow subscribing to state transitions', () => {
      const callback = vi.fn();
      const unsubscribe = service.onTransition(callback);

      const snippet = {
        name: 'test_subscribe',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);

      // Should have been called with new state
      expect(callback).toHaveBeenCalled();

      unsubscribe();
    });

    it('should allow unsubscribing from state transitions', () => {
      const callback = vi.fn();
      const unsubscribe = service.onTransition(callback);

      callback.mockClear();
      unsubscribe();

      const snippet = {
        name: 'test_unsubscribe',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);

      // Should not have been called after unsubscribe
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Disposal', () => {
    it('should dispose cleanly', () => {
      const snippet = {
        name: 'test_dispose',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      service.play();

      expect(() => service.dispose()).not.toThrow();
      expect(service.isPlaying()).toBe(false);
    });

    it('should handle multiple dispose calls', () => {
      service.dispose();
      expect(() => service.dispose()).not.toThrow();
    });
  });

  describe('Debug Helper', () => {
    it('should be callable without changing loaded state', () => {
      const snippet = {
        name: 'test_debug',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      const beforeNames = service
        .getState()
        .context.animations.map((animation: any) => animation.name);

      expect(() => service.debug()).not.toThrow();
      expect(
        service.getState().context.animations.map((animation: any) => animation.name)
      ).toEqual(beforeNames);
    });
  });

  describe('Default Values', () => {
    it('should apply default snippetCategory', () => {
      const snippet = {
        name: 'test_defaults',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      const state = service.getState();
      const loaded = state.context.animations[0];

      expect(loaded.snippetCategory).toBe('default');
    });

    it('should apply default snippetPriority of 0', () => {
      const snippet = {
        name: 'test_defaults',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      const state = service.getState();
      const loaded = state.context.animations[0];

      expect(loaded.snippetPriority).toBe(0);
    });

    it('should apply default snippetPlaybackRate of 1', () => {
      const snippet = {
        name: 'test_defaults',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      const state = service.getState();
      const loaded = state.context.animations[0];

      expect(loaded.snippetPlaybackRate).toBe(1);
    });

    it('should apply default snippetIntensityScale of 1', () => {
      const snippet = {
        name: 'test_defaults',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      const state = service.getState();
      const loaded = state.context.animations[0];

      expect(loaded.snippetIntensityScale).toBe(1);
    });

    it('should apply default loop of false', () => {
      const snippet = {
        name: 'test_defaults',
        curves: { '1': [{ time: 0, intensity: 0.5 }] }
      };

      service.loadFromJSON(snippet);
      const state = service.getState();
      const loaded = state.context.animations[0];

      expect(loaded.loop).toBe(false);
    });
  });

  describe('Independent Scheduler Control (PROMISE-BASED ARCHITECTURE)', () => {
    it('should load multiple snippets independently', () => {
      const browRaise = {
        name: 'brow_raise',
        curves: { '1': [{ time: 0, intensity: 0 }, { time: 2, intensity: 1 }] }
      };
      const headNod = {
        name: 'head_nod',
        curves: { '2': [{ time: 0, intensity: 0 }, { time: 2, intensity: 1 }] }
      };

      service.loadFromJSON(browRaise);
      service.loadFromJSON(headNod);

      const state = service.getState();
      expect(state.context.animations).toHaveLength(2);
    });

    it('should allow pausing individual snippets', () => {
      const browRaise = {
        name: 'brow_raise',
        curves: { '1': [{ time: 0, intensity: 0 }, { time: 5, intensity: 1 }] }
      };
      const headNod = {
        name: 'head_nod',
        curves: { '2': [{ time: 0, intensity: 0 }, { time: 5, intensity: 1 }] }
      };

      service.loadFromJSON(browRaise);
      service.loadFromJSON(headNod);
      service.play();

      // Pause ONLY brow raise
      service.setSnippetPlaying('brow_raise', false);

      const state = service.getState();
      const browSnippet = state.context.animations.find((s: any) => s.name === 'brow_raise');
      const headSnippet = state.context.animations.find((s: any) => s.name === 'head_nod');

      expect(browSnippet.isPlaying).toBe(false);
      expect(headSnippet.isPlaying).toBe(true);
    });

    it('should allow independent intensity scaling', () => {
      // Test intensity scaling on a single snippet (no conflict resolution)
      const browRaise = {
        name: 'brow_raise',
        curves: { '1': [{ time: 0.01, intensity: 1.0 }, { time: 0.1, intensity: 1.0 }] }
      };

      service.loadFromJSON(browRaise);

      // Scale down brow to 50% (which becomes 0.25 after quadratic scaling: 0.5^2)
      service.setSnippetIntensityScale('brow_raise', 0.5);

      const state = service.getState();
      const loaded = state.context.animations[0];
      expect(loaded.snippetIntensityScale).toBe(0.5);
    });

    it('should allow independent priority control', () => {
      const browRaise = {
        name: 'brow_raise',
        curves: { '1': [{ time: 0, intensity: 0.3 }, { time: 0.1, intensity: 0.3 }] }
      };
      const headNod = {
        name: 'head_nod',
        curves: { '1': [{ time: 0, intensity: 0.8 }, { time: 0.1, intensity: 0.8 }] }
      };

      service.loadFromJSON(browRaise);
      service.loadFromJSON(headNod);

      // Give brow higher priority
      service.setSnippetPriority('brow_raise', 10);
      service.setSnippetPriority('head_nod', 1);

      const state = service.getState();
      const browSnippet = state.context.animations.find((s: any) => s.name === 'brow_raise');
      const headSnippet = state.context.animations.find((s: any) => s.name === 'head_nod');

      expect(browSnippet?.snippetPriority).toBe(10);
      expect(headSnippet?.snippetPriority).toBe(1);
    });
  });
});
