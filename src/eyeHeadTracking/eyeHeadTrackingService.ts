/**
 * Eye and Head Tracking Service
 * Coordinates eye and head movements that follow mouth animations
 * Uses GazeService for shared eye/head state and scheduler-backed output.
 */
import type {
  EyeHeadTrackingConfig,
  EyeHeadTrackingState,
  EyeHeadTrackingCallbacks,
  GazeTarget,
  AnimationSnippet,
} from './types';
import { DEFAULT_EYE_HEAD_CONFIG } from './types';
import { EyeHeadTrackingScheduler, type EyeHeadHostCaps } from './eyeHeadTrackingScheduler';
import { GazeService, type GazeRuntime, type GazeRuntimeCommand, type GazeRuntimeResetOptions } from '../gaze';
import {
  CameraRelativeGazeTracker,
  computeCharacterRelativePointerTarget,
  type CameraRelativeGazeController,
} from '../camera/cameraRelativeGaze';
import { createActor } from 'xstate';
import {
  eyeHeadTrackingMachine,
  type EyeHeadTrackingMachine,
  type EyeHeadTrackingMachineContext,
} from './eyeHeadTrackingMachine';
import { fromEvent, type Subscription, animationFrameScheduler } from 'rxjs';
import { filter, map, pairwise, throttleTime } from 'rxjs/operators';

// Declare global BlazeFace from CDN
declare const blazeface: {
  load: () => Promise<any>;
};

export class EyeHeadTrackingService {
  private config: EyeHeadTrackingConfig;
  private state: EyeHeadTrackingState;
  private callbacks: EyeHeadTrackingCallbacks;

  private scheduler: EyeHeadTrackingScheduler | null = null;
  private gazeService: GazeService | null = null;

  // Animation snippets
  private eyeSnippets: Map<string, AnimationSnippet> = new Map();
  private headSnippets: Map<string, AnimationSnippet> = new Map();

  // Timers
  private idleVariationTimer: number | null = null;

  // Tracking mode
  private trackingMode: 'manual' | 'mouse' | 'webcam' = 'manual';
  private mouseListener: ((e: MouseEvent) => void) | null = null;
  private mouseSubscription: Subscription | null = null;
  private machine: ReturnType<typeof createActor<EyeHeadTrackingMachine>> | null = null;
  private filteredGaze: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

  // Webcam tracking state (internal - no React hooks)
  private webcamModel: any = null;
  private webcamStream: MediaStream | null = null;
  private webcamVideo: HTMLVideoElement | null = null;
  private webcamRafId: number | null = null;
  private webcamFaceDetected: boolean = false;
  private webcamListeners: Set<(detected: boolean, landmarks?: Array<{ x: number; y: number }>) => void> = new Set();
  private lastWebcamUpdate: number = 0;
  private isStarted = false;
  private cameraRelativeGazeTracker: CameraRelativeGazeTracker | null = null;

  constructor(
    config: EyeHeadTrackingConfig = {},
    callbacks: EyeHeadTrackingCallbacks = {}
  ) {
    this.config = {
      ...DEFAULT_EYE_HEAD_CONFIG,
      ...config,
    };

    this.callbacks = callbacks;

    this.state = {
      eyeStatus: 'idle',
      headStatus: 'idle',
      currentGaze: { x: 0, y: 0, z: 0 },
      targetGaze: { x: 0, y: 0, z: 0 },
      eyeIntensity: 0,
      lastBlinkTime: 0,
      headIntensity: 0,
      headFollowTimer: null,
      isSpeaking: false,
      isListening: false,
      returnToNeutralTimer: null,
      lastGazeUpdateTime: Date.now(),
    };

    this.initializeScheduler();
    this.applyMixWeightSettings();
    this.initializeMachine();
    this.syncCameraTracking();
  }

  private initializeMachine(): void {
    try {
      this.machine = createActor(eyeHeadTrackingMachine).start();
      this.machine.send({ type: 'UPDATE_CONFIG', config: this.config });
      this.machine.send({
        type: 'SET_STATUS',
        eye: this.state.eyeStatus,
        head: this.state.headStatus,
        lastApplied: this.state.currentGaze,
      });
    } catch {}
  }

  private initializeScheduler(): void {
    this.gazeService?.dispose();
    this.gazeService = null;

    if (!this.config.animationAgency) {
      this.scheduler = null;
      this.gazeService = this.createGazeService();
      return;
    }

    const agency = this.config.animationAgency;
    const ensureAgencyPlaying = () => {
      try {
        if (typeof agency.playing !== 'undefined' && !agency.playing) {
          agency.play?.();
        }
      } catch {}
    };
    const host: EyeHeadHostCaps = {
      scheduleSnippet: (snippet: any) => {
        ensureAgencyPlaying();
        return agency.schedule?.(snippet) ?? null;
      },
      updateSnippet: (snippet: any) => {
        ensureAgencyPlaying();
        return agency.updateSnippet?.(snippet) ?? null;
      },
      seekSnippet: (name: string, offsetSec: number) => {
        agency.seek?.(name, offsetSec);
      },
      pauseSnippet: (name: string) => {
        agency.pauseSnippet?.(name);
      },
      resumeSnippet: (name: string) => {
        ensureAgencyPlaying();
        agency.resumeSnippet?.(name);
      },
      restartSnippet: (name: string) => {
        ensureAgencyPlaying();
        agency.restartSnippet?.(name);
      },
      removeSnippet: (name: string) => {
        agency.remove?.(name);
      },
      onSnippetEnd: (name: string) => {
        try { agency.onSnippetEnd?.(name); } catch {}
      }
    };

    this.scheduler = new EyeHeadTrackingScheduler(host, {
      duration: this.config.agencyTransitionDuration ?? DEFAULT_EYE_HEAD_CONFIG.agencyTransitionDuration,
      eyeIntensity: this.config.eyeIntensity ?? DEFAULT_EYE_HEAD_CONFIG.eyeIntensity,
      headIntensity: this.config.headIntensity ?? DEFAULT_EYE_HEAD_CONFIG.headIntensity,
      eyePriority: this.config.eyePriority ?? DEFAULT_EYE_HEAD_CONFIG.eyePriority,
      headPriority: this.config.headPriority ?? DEFAULT_EYE_HEAD_CONFIG.headPriority,
    });

    this.gazeService = this.createGazeService();
  }

  private createGazeService(): GazeService {
    const runtime = this.scheduler ? this.createSchedulerGazeRuntime(this.scheduler) : null;

    return new GazeService({
      eyesEnabled: this.config.eyeTrackingEnabled,
      headEnabled: this.config.headTrackingEnabled,
      headFollowEyes: this.config.headFollowEyes,
      eyeIntensity: this.config.eyeIntensity,
      headIntensity: this.config.headIntensity,
      transitionDurationMs: this.config.agencyTransitionDuration ?? DEFAULT_EYE_HEAD_CONFIG.agencyTransitionDuration,
      runtime,
      engine: runtime ? undefined : this.config.engine,
      useTransport: false,
      clock: {
        now: () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()),
      },
    });
  }

  private createSchedulerGazeRuntime(scheduler: EyeHeadTrackingScheduler): GazeRuntime {
    return {
      apply: (command: GazeRuntimeCommand) => {
        const headFollowDelay = command.headEnabled && command.headFollowEyes
          ? this.config.headFollowDelay ?? DEFAULT_EYE_HEAD_CONFIG.headFollowDelay
          : 0;

        return scheduler.scheduleGazeTransition(command.target, {
          eyeEnabled: command.eyeEnabled,
          headEnabled: command.headEnabled,
          headFollowEyes: command.headFollowEyes,
          eyeDuration: command.eyeDuration,
          headDuration: command.headDuration + headFollowDelay,
        });
      },
      reset: (durationMs = 300, options: GazeRuntimeResetOptions = {}) => {
        const resetEyes = options.eyes ?? true;
        const resetHead = options.head ?? true;
        if (!resetEyes && !resetHead) {
          return false;
        }

        return scheduler.resetToNeutral(durationMs, {
          eyeEnabled: resetEyes,
          headEnabled: resetHead,
          headFollowEyes: true,
        });
      },
      dispose: () => {
        scheduler.stop();
      },
    };
  }

  private clampMix(value: number | undefined, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.min(1, Math.max(0, value));
    }
    return fallback;
  }

  private applyMixWeightSettings(): void {
    const engine = this.config.engine;
    if (!engine?.setAUMixWeight) return;

    const eyeMix = this.clampMix(
      this.config.eyeBlendWeight,
      DEFAULT_EYE_HEAD_CONFIG.eyeBlendWeight
    );
    const headMix = this.clampMix(
      this.config.headBlendWeight,
      DEFAULT_EYE_HEAD_CONFIG.headBlendWeight
    );

    [61, 62, 63, 64].forEach((au) => engine.setAUMixWeight(au, eyeMix));
    [51, 52, 53, 54, 55, 56].forEach((au) => engine.setAUMixWeight(au, headMix));
  }

  /**
   * Start eye and head tracking
   */
  public start(): void {
    this.isStarted = true;
    this.cameraRelativeGazeTracker?.setEnabled(this.isCameraTrackingActive());

    if (this.config.eyeTrackingEnabled) {
      this.state.eyeStatus = 'tracking';
      this.callbacks.onEyeStart?.();
    }

    if (this.config.headTrackingEnabled) {
      this.state.headStatus = 'tracking';
      this.callbacks.onHeadStart?.();
    }

    // Start idle variation (DISABLED - only mouse/webcam/manual tracking)
    // if (this.config.idleVariation) {
    //   this.startIdleVariation();
    // }
  }

  /**
   * Stop eye and head tracking
   */
  public stop(): void {
    this.isStarted = false;
    this.cameraRelativeGazeTracker?.setEnabled(false);
    this.clearTimers();
    if (this.scheduler?.pause) {
      this.scheduler.pause();
    } else {
      this.scheduler?.stop();
    }

    if (this.config.eyeTrackingEnabled) {
      this.callbacks.onEyeStop?.();
    }

    if (this.config.headTrackingEnabled) {
      this.callbacks.onHeadStop?.();
    }

    this.state.eyeStatus = 'idle';
    this.state.headStatus = 'idle';
    this.machine?.send({
      type: 'SET_STATUS',
      eye: this.state.eyeStatus,
      head: this.state.headStatus,
      lastApplied: this.state.currentGaze,
    });
  }

  /**
   * Set gaze target (screen coordinates)
   */
  public setGazeTarget(target: GazeTarget): void {
    // Early return if both eye and head tracking are disabled
    if (!this.config.eyeTrackingEnabled && !this.config.headTrackingEnabled) {
      return;
    }

    this.state.targetGaze = target;
    this.state.lastGazeUpdateTime = Date.now();
    this.machine?.send({ type: 'SET_TARGET', target });

    if (this.config.eyeTrackingEnabled) {
      this.state.eyeStatus = 'tracking';
    }

    // Clear any existing return-to-neutral timer since we have a new target
    this.clearReturnToNeutralTimer();

    // Apply both eyes and head together - headFollowDelay adds to head transition duration
    // so the head moves slower and "lags" behind the eyes naturally
    this.applyGazeToCharacter(target, {
      applyEyes: this.config.eyeTrackingEnabled,
      applyHead: this.config.headTrackingEnabled,
      skipMachine: this.trackingMode !== 'manual',
    });

    if (this.config.headTrackingEnabled) {
      this.state.headStatus = 'tracking';
    }
    this.machine?.send({
      type: 'SET_STATUS',
      eye: this.state.eyeStatus,
      head: this.state.headStatus,
      lastApplied: this.state.currentGaze,
    });

    this.scheduleReturnToNeutral();

    this.callbacks.onGazeChange?.(target);
  }

  /**
   * Reset gaze to neutral center position
   *
   * Use this when you want to explicitly return the head/eyes to center,
   * such as when switching tracking modes or ending a conversation.
   *
   * @param duration - Transition duration in milliseconds (default: 300ms)
   */
  public resetToNeutral(duration: number = 300): void {
    this.clearReturnToNeutralTimer();

    const neutral = { x: 0, y: 0, z: 0 };
    const applied = this.gazeService?.reset(duration) ?? false;

    if (!applied) {
      this.applyGazeToCharacter(neutral, {
        applyEyes: this.config.eyeTrackingEnabled,
        applyHead: this.config.headTrackingEnabled,
      });
    }

    this.filteredGaze = neutral;
    this.state.targetGaze = neutral;
    this.state.currentGaze = neutral;
    this.state.lastGazeUpdateTime = Date.now();
    this.machine?.send({ type: 'SET_TARGET', target: neutral });
    this.machine?.send({
      type: 'SET_STATUS',
      eye: this.state.eyeStatus,
      head: this.state.headStatus,
      lastApplied: neutral,
    });
    this.callbacks.onGazeChange?.(neutral);
  }

  /**
   * Trigger a blink
   */
  public blink(): void {
    this.callbacks.onBlink?.();
  }

  /**
   * Set speaking state (for coordination with mouth animations)
   */
  public setSpeaking(isSpeaking: boolean): void {
    this.state.isSpeaking = isSpeaking;

    // When speaking, reduce idle variation (DISABLED - idle variation removed)
    // if (isSpeaking && this.idleVariationTimer) {
    //   clearTimeout(this.idleVariationTimer);
    //   this.idleVariationTimer = null;
    // } else if (!isSpeaking && this.config.idleVariation) {
    //   this.startIdleVariation();
    // }
  }

  /**
   * Set listening state
   */
  public setListening(isListening: boolean): void {
    this.state.isListening = isListening;

    // When listening, look at speaker position
    if (isListening && this.config.lookAtSpeaker) {
      // Default speaker position (center, slightly up)
      this.setGazeTarget({ x: 0, y: 0.1, z: 0 });
    }
  }

  public setEyeBlendWeight(value: number): void {
    this.config.eyeBlendWeight = this.clampMix(value, DEFAULT_EYE_HEAD_CONFIG.eyeBlendWeight);
    this.applyMixWeightSettings();
  }

  public setHeadBlendWeight(value: number): void {
    this.config.headBlendWeight = this.clampMix(value, DEFAULT_EYE_HEAD_CONFIG.headBlendWeight);
    this.applyMixWeightSettings();
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<EyeHeadTrackingConfig>): void {
    const previousCameraController = this.config.cameraController;
    const wasEyeTrackingEnabled = !!this.config.eyeTrackingEnabled;
    const wasHeadTrackingEnabled = !!this.config.headTrackingEnabled;
    const wasHeadFollowEyes = this.config.headFollowEyes !== false;
    const wasReturnToNeutralEnabled = !!this.config.returnToNeutralEnabled;
    const animationAgencyChanged = Object.prototype.hasOwnProperty.call(config, 'animationAgency');
    this.config = {
      ...this.config,
      ...config,
    };
    const isEyeTrackingEnabled = !!this.config.eyeTrackingEnabled;
    const isHeadTrackingEnabled = !!this.config.headTrackingEnabled;
    const isHeadFollowEyes = this.config.headFollowEyes !== false;
    const disabledEyes = wasEyeTrackingEnabled && !isEyeTrackingEnabled;
    const disabledHead =
      (wasHeadTrackingEnabled && !isHeadTrackingEnabled) ||
      (wasHeadTrackingEnabled && wasHeadFollowEyes && !isHeadFollowEyes);
    const enabledEyes = !wasEyeTrackingEnabled && isEyeTrackingEnabled;
    const enabledHead =
      (!wasHeadTrackingEnabled && isHeadTrackingEnabled) ||
      (wasHeadTrackingEnabled && !wasHeadFollowEyes && isHeadFollowEyes);
    const isReturnToNeutralEnabled = !!this.config.returnToNeutralEnabled;

    if (animationAgencyChanged) {
      this.initializeScheduler();
    } else {
      this.scheduler?.updateConfig?.({
        duration: this.config.agencyTransitionDuration ?? DEFAULT_EYE_HEAD_CONFIG.agencyTransitionDuration,
        eyeIntensity: this.config.eyeIntensity ?? DEFAULT_EYE_HEAD_CONFIG.eyeIntensity,
        headIntensity: this.config.headIntensity ?? DEFAULT_EYE_HEAD_CONFIG.headIntensity,
        eyePriority: this.config.eyePriority ?? DEFAULT_EYE_HEAD_CONFIG.eyePriority,
        headPriority: this.config.headPriority ?? DEFAULT_EYE_HEAD_CONFIG.headPriority,
      });
    }

    if (
      config.eyeBlendWeight !== undefined ||
      config.headBlendWeight !== undefined ||
      config.engine !== undefined
    ) {
      this.applyMixWeightSettings();
    }

    if (config.cameraController !== undefined && config.cameraController !== previousCameraController) {
      this.syncCameraTracking();
    }

    // Update experimental gaze config
    if (this.gazeService) {
      const runtime = this.scheduler ? this.createSchedulerGazeRuntime(this.scheduler) : null;
      this.gazeService.updateConfig({
        eyesEnabled: this.config.eyeTrackingEnabled,
        headEnabled: this.config.headTrackingEnabled,
        headFollowEyes: this.config.headFollowEyes,
        eyeIntensity: this.config.eyeIntensity,
        headIntensity: this.config.headIntensity,
        transitionDurationMs: this.config.agencyTransitionDuration ?? DEFAULT_EYE_HEAD_CONFIG.agencyTransitionDuration,
        runtime,
        engine: runtime ? undefined : this.config.engine,
        useTransport: false,
      });
    }

    if (disabledEyes || disabledHead) {
      this.clearDisabledTrackingOutputs({ eyes: disabledEyes, head: disabledHead });
    }

    if (wasReturnToNeutralEnabled && !isReturnToNeutralEnabled) {
      this.clearReturnToNeutralTimer();
    } else if (
      isReturnToNeutralEnabled &&
      (
        !wasReturnToNeutralEnabled ||
        config.returnToNeutralDelay !== undefined ||
        config.returnToNeutralDuration !== undefined
      )
    ) {
      this.scheduleReturnToNeutral();
    }

    if (
      config.cameraController !== undefined ||
      config.eyeTrackingEnabled !== undefined ||
      config.headTrackingEnabled !== undefined ||
      config.headFollowEyes !== undefined
    ) {
      this.cameraRelativeGazeTracker?.setEnabled(this.isCameraTrackingActive());
      if ((enabledEyes || enabledHead) && this.isStarted && this.isTrackingEnabled()) {
        this.applyCameraRelativeOffsetForCurrentTarget({ force: true });
      }
    }

    this.machine?.send({ type: 'UPDATE_CONFIG', config: this.config });
  }

  /**
   * Get current state
   */
  public getState(): EyeHeadTrackingState {
    return { ...this.state };
  }

  /**
   * Get machine context (config + current/target gaze) for UI/debug overlays
   */
  public getMachineContext(): EyeHeadTrackingMachineContext | null {
    if (!this.machine) return null;
    try {
      return this.machine.getSnapshot().context;
    } catch {
      return null;
    }
  }

  /**
   * Get animation snippets for external animation manager
   */
  public getSnippets(): {
    eye: Map<string, AnimationSnippet>;
    head: Map<string, AnimationSnippet>;
  } {
    return {
      eye: this.eyeSnippets,
      head: this.headSnippets,
    };
  }

  /**
   * Set tracking mode (manual, mouse, or webcam)
   *
   * IMPORTANT: When switching modes, the head/eyes PRESERVE their last position.
   * They do NOT reset to neutral automatically. This is by design:
   * - Switching from mouse→manual: Head stays at last mouse position
   * - Switching from webcam→manual: Head stays at last detected face position
   * - Call resetToNeutral() explicitly if you want to return to center
   *
   * This behavior is enabled by the automatic continuity system in the animation agency,
   * which ensures smooth transitions from the current position when new gaze targets are set.
   */
  public setMode(mode: 'manual' | 'mouse' | 'webcam'): void {
    // Clean up current mode (removes listeners, but preserves last position)
    this.cleanupMode();

    this.trackingMode = mode;
    this.machine?.send({ type: 'SET_MODE', mode });
    this.gazeService?.setMode(mode);

    // Setup new mode
    if (mode === 'mouse') {
      this.startMouseTracking();
    } else if (mode === 'webcam') {
      this.startWebcamTracking();
    }
  }

  /**
   * Get current tracking mode
   */
  public getMode(): 'manual' | 'mouse' | 'webcam' {
    return this.trackingMode;
  }

  /**
   * Start mouse tracking
   */
  private startMouseTracking(): void {
    if (this.mouseListener || this.mouseSubscription) return;

    // Clear return to neutral timer when actively tracking mouse
    this.clearReturnToNeutralTimer();

    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const toNormalized = (e: MouseEvent) => ({
      t: now(),
      ...computeCharacterRelativePointerTarget(this.getCameraController(), e),
    });

    this.mouseSubscription = fromEvent<MouseEvent>(window, 'mousemove')
      .pipe(
        throttleTime(0, animationFrameScheduler),
        filter(() => this.isTrackingEnabled()),
        map(toNormalized),
        pairwise()
      )
      .subscribe(([prev, curr]) => {
        if (!this.config.eyeTrackingEnabled && !this.config.headTrackingEnabled) {
          return;
        }

        const dt = Math.max(1, curr.t - prev.t);
        const vx = (curr.x - prev.x) / dt;
        const vy = (curr.y - prev.y) / dt;

        const leadMs = 80;
        const predX = Math.max(-1, Math.min(1, curr.x + vx * leadMs));
        const predY = Math.max(-1, Math.min(1, curr.y + vy * leadMs));

        this.setGazeTarget({ x: predX, y: predY, z: 0 });
      });
  }

  /**
   * Stop mouse tracking
   */
  private stopMouseTracking(): void {
    if (this.mouseListener) {
      window.removeEventListener('mousemove', this.mouseListener);
      this.mouseListener = null;
    }
    if (this.mouseSubscription) {
      this.mouseSubscription.unsubscribe();
      this.mouseSubscription = null;
    }
  }

  /**
   * Start webcam tracking - loads model, starts camera, runs detection loop
   */
  private async startWebcamTracking(): Promise<void> {
    // Load BlazeFace model if not already loaded
    if (!this.webcamModel) {
      try {
        if (typeof blazeface === 'undefined') {
        return;
        }
        this.webcamModel = await blazeface.load();
      } catch (err) {
        console.error('[EyeHeadTracking] Failed to load BlazeFace:', err);
        return;
      }
    }

    // Start webcam stream
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        console.error('[EyeHeadTracking] getUserMedia not supported');
        return;
      }

      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });

      // Create hidden video element
      this.webcamVideo = document.createElement('video');
      this.webcamVideo.srcObject = this.webcamStream;
      this.webcamVideo.width = 640;
      this.webcamVideo.height = 480;
      this.webcamVideo.autoplay = true;
      this.webcamVideo.playsInline = true;
      this.webcamVideo.muted = true;

      await new Promise<void>((resolve) => {
        this.webcamVideo!.onloadedmetadata = () => resolve();
      });
      await this.webcamVideo.play();

      // Start detection loop using RAF (no setInterval)
      this.runWebcamDetectionLoop();
    } catch (err) {
      console.error('[EyeHeadTracking] Failed to start webcam:', err);
    }
  }

  /**
   * Run webcam face detection in RAF loop (throttled to ~30fps)
   */
  private runWebcamDetectionLoop(): void {
    if (!this.webcamVideo || !this.webcamModel || this.trackingMode !== 'webcam') {
      return;
    }

    const detect = async () => {
      if (!this.webcamVideo || !this.webcamModel || this.trackingMode !== 'webcam') {
        return;
      }

      // Throttle to ~30fps (33ms)
      const now = performance.now();
      if (now - this.lastWebcamUpdate < 33) {
        this.webcamRafId = requestAnimationFrame(detect);
        return;
      }
      this.lastWebcamUpdate = now;

      try {
        const predictions = await this.webcamModel.estimateFaces(this.webcamVideo, false);

        if (predictions && predictions.length > 0) {
          const face = predictions[0];
          const width = this.webcamVideo.width;
          const height = this.webcamVideo.height;

          // BlazeFace landmarks: leftEye, rightEye, nose, mouth, leftEar, rightEar
          const landmarks = face.landmarks.map((point: number[]) => ({
            x: point[0] / width,
            y: point[1] / height,
          }));

          // Calculate gaze from eye positions
          const leftEye = landmarks[0];
          const rightEye = landmarks[1];
          const avgX = (leftEye.x + rightEye.x) / 2;
          const avgY = (leftEye.y + rightEye.y) / 2;

          // Convert to -1 to 1 range
          const gazeX = avgX * 2 - 1;
          const gazeY = -(avgY * 2 - 1);

          // Use the same modern gaze runtime path as manual and mouse input.
          this.setGazeTarget({ x: gazeX, y: gazeY, z: 0 });

          // Notify listeners if face detection status changed
          if (!this.webcamFaceDetected) {
            this.webcamFaceDetected = true;
            this.notifyWebcamListeners(true, landmarks);
          }
        } else {
          if (this.webcamFaceDetected) {
            this.webcamFaceDetected = false;
            this.notifyWebcamListeners(false);
          }
        }
      } catch (err) {
        // Silently ignore detection errors
      }

      // Continue loop
      this.webcamRafId = requestAnimationFrame(detect);
    };

    this.webcamRafId = requestAnimationFrame(detect);
  }

  /**
   * Stop webcam tracking
   */
  private stopWebcamTracking(): void {
    // Cancel detection loop
    if (this.webcamRafId !== null) {
      cancelAnimationFrame(this.webcamRafId);
      this.webcamRafId = null;
    }

    // Stop media stream tracks
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach(track => track.stop());
      this.webcamStream = null;
    }

    // Clean up video element
    if (this.webcamVideo) {
      this.webcamVideo.srcObject = null;
      this.webcamVideo = null;
    }

    this.webcamFaceDetected = false;
    this.notifyWebcamListeners(false);
  }

  /**
   * Subscribe to webcam detection updates (for UI to show face status)
   */
  public subscribeToWebcam(callback: (detected: boolean, landmarks?: Array<{ x: number; y: number }>) => void): () => void {
    this.webcamListeners.add(callback);
    // Immediately notify current state
    callback(this.webcamFaceDetected);
    return () => {
      this.webcamListeners.delete(callback);
    };
  }

  /**
   * Get current webcam video element (for UI preview)
   */
  public getWebcamVideoElement(): HTMLVideoElement | null {
    return this.webcamVideo;
  }

  /**
   * Check if webcam is actively tracking
   */
  public isWebcamActive(): boolean {
    return this.trackingMode === 'webcam' && this.webcamVideo !== null;
  }

  /**
   * Notify webcam listeners of detection status change
   */
  private notifyWebcamListeners(detected: boolean, landmarks?: Array<{ x: number; y: number }>): void {
    this.webcamListeners.forEach(cb => cb(detected, landmarks));
  }

  /**
   * Cleanup current tracking mode
   */
  private cleanupMode(): void {
    this.stopMouseTracking();
    this.stopWebcamTracking();
  }

  private isCameraTrackingActive(): boolean {
    return this.isStarted && this.isTrackingEnabled();
  }

  private isTrackingEnabled(): boolean {
    return Boolean(this.config.eyeTrackingEnabled || this.config.headTrackingEnabled);
  }

  private getCameraController(): CameraRelativeGazeController | null {
    return (this.config.cameraController as CameraRelativeGazeController | undefined) ?? null;
  }

  private getCameraRelativeOffset(): { x: number; y: number } {
    return this.cameraRelativeGazeTracker?.getOffset() ?? { x: 0, y: 0 };
  }

  private applyCameraRelativeOffsetForCurrentTarget(options: { force?: boolean } = {}): void {
    if (!this.isStarted || !this.isTrackingEnabled()) {
      return;
    }

    this.applyGazeToCharacter(this.state.targetGaze, {
      applyEyes: this.config.eyeTrackingEnabled,
      applyHead: this.config.headTrackingEnabled,
      skipMachine: this.trackingMode !== 'manual',
      force: options.force,
    });
  }

  private teardownCameraTracking(): void {
    this.cameraRelativeGazeTracker?.dispose();
    this.cameraRelativeGazeTracker = null;
  }

  private syncCameraTracking(): void {
    const controller = this.getCameraController();

    this.teardownCameraTracking();

    if (!controller) {
      return;
    }

    this.cameraRelativeGazeTracker = new CameraRelativeGazeTracker(controller, {
      enabled: false,
      onChange: () => {
        if (!this.isStarted || !this.isTrackingEnabled()) {
          return;
        }

        this.applyCameraRelativeOffsetForCurrentTarget();
      },
    });
    this.cameraRelativeGazeTracker.setEnabled(this.isCameraTrackingActive());
  }

  private clearDisabledTrackingOutputs(channels: { eyes?: boolean; head?: boolean }): void {
    const duration = this.config.returnToNeutralDuration ?? 300;

    if (channels.eyes) {
      this.scheduler?.stopEyes?.();
    }
    if (channels.head) {
      this.scheduler?.stopHead?.();
    }

    const applied = this.gazeService?.reset(duration, {
      eyes: !!channels.eyes,
      head: !!channels.head,
    }) ?? false;

    if (!applied) {
      this.resetContinuumChannels(channels, duration);
    }

    if (channels.eyes) {
      this.state.eyeStatus = 'idle';
      this.state.eyeIntensity = 0;
      this.callbacks.onEyeStop?.();
    }
    if (channels.head) {
      this.state.headStatus = 'idle';
      this.state.headIntensity = 0;
      this.callbacks.onHeadStop?.();
    }

    this.machine?.send({
      type: 'SET_STATUS',
      eye: this.state.eyeStatus,
      head: this.state.headStatus,
      lastApplied: this.state.currentGaze,
    });
  }

  private resetContinuumChannels(
    channels: { eyes?: boolean; head?: boolean },
    duration: number
  ): void {
    const engine = this.config.engine;
    if (!engine?.transitionContinuum) {
      return;
    }

    if (channels.eyes) {
      engine.transitionContinuum(61, 62, 0, duration);
      engine.transitionContinuum(64, 63, 0, duration);
    }
    if (channels.head) {
      engine.transitionContinuum(51, 52, 0, duration);
      engine.transitionContinuum(54, 53, 0, duration);
      engine.transitionContinuum(55, 56, 0, duration);
    }
  }

  /**
   * Apply gaze to character using smooth transitions
   * Converts normalized gaze coordinates to AU values
   * Always uses transitions for smooth, natural movement
   * Duration scales with distance traveled for natural motion
   *
   * Camera-relative offset is cached from camera movement so gaze updates can
   * reuse the last front-to-camera angle without recomputing it continuously.
   */
  private applyGazeToCharacter(
    target: GazeTarget,
    options?: { applyEyes?: boolean; applyHead?: boolean; skipMachine?: boolean; force?: boolean }
  ): void {
    // Early return if both eye and head tracking are disabled (already checked in setGazeTarget, but double-check)
    if (!this.config.eyeTrackingEnabled && !this.config.headTrackingEnabled) {
      return;
    }

    const eyeIntensity = this.config.eyeIntensity ?? 1.0;
    const headIntensity = this.config.headIntensity ?? 0.5;

    const cameraOffset = this.getCameraRelativeOffset();
    const adjustedTarget = {
      x: target.x + cameraOffset.x,
      y: target.y + cameraOffset.y,
      z: target.z ?? 0,
    };
    const applyEyes = options?.applyEyes ?? true;
    const applyHead = options?.applyHead ?? true;

    if (!this.gazeService) {
      this.gazeService = this.createGazeService();
    }

    const result = this.gazeService.setTarget(adjustedTarget, {
      eyeEnabled: applyEyes && !!this.config.eyeTrackingEnabled,
      headEnabled: applyHead && !!this.config.headTrackingEnabled,
      headFollowEyes: this.config.headFollowEyes,
      force: options?.force,
    });

    if (applyEyes && this.config.eyeTrackingEnabled) {
      this.state.eyeIntensity = eyeIntensity;
    }
    if (applyHead && this.config.headTrackingEnabled) {
      this.state.headIntensity = headIntensity;
    }

    const plannedTarget = {
      x: result.target.x,
      y: result.target.y,
      z: result.target.z ?? 0,
    };
    this.filteredGaze = plannedTarget;
    if (result.applied) {
      this.state.currentGaze = plannedTarget;
    }

    // Skip machine updates for continuous tracking (mouse/webcam) to avoid overhead
    if (result.applied && !options?.skipMachine) {
      this.machine?.send({
        type: 'SET_STATUS',
        lastApplied: this.state.currentGaze,
      });
    }
  }

  /**
   * Start idle variation (subtle random eye/head movements)
   */
  private startIdleVariation(): void {
    if (this.idleVariationTimer) return;

    const scheduleNext = () => {
      this.idleVariationTimer = window.setTimeout(() => {
        if (!this.state.isSpeaking && this.config.idleVariation) {
          // Random gaze target within small range
          const randomGaze: GazeTarget = {
            x: (Math.random() - 0.5) * 0.3, // -0.15 to 0.15
            y: (Math.random() - 0.5) * 0.2, // -0.1 to 0.1
            z: 0,
          };

          this.setGazeTarget(randomGaze);
        }

        scheduleNext();
      }, this.config.idleVariationInterval);
    };

    scheduleNext();
  }

  /**
   * Schedule graceful return to neutral after delay
   * Only applies when returnToNeutralEnabled is true
   */
  private scheduleReturnToNeutral(): void {
    if (!this.config.returnToNeutralEnabled) {
      return;
    }

    // Clear any existing timer
    this.clearReturnToNeutralTimer();

    const delay = this.config.returnToNeutralDelay ?? 3000;
    const duration = this.config.returnToNeutralDuration ?? 800;

    this.state.returnToNeutralTimer = globalThis.setTimeout(() => {
      // Only return to neutral if we're not at neutral already
      const { x, y } = this.state.targetGaze;
      const isAlreadyNeutral = Math.abs(x) < 0.01 && Math.abs(y) < 0.01;

      if (!isAlreadyNeutral) {
        this.resetToNeutral(duration);
      }

      this.state.returnToNeutralTimer = null;
    }, delay) as unknown as number;
  }

  /**
   * Clear return to neutral timer
   */
  private clearReturnToNeutralTimer(): void {
    if (this.state.returnToNeutralTimer) {
      globalThis.clearTimeout(this.state.returnToNeutralTimer);
      this.state.returnToNeutralTimer = null;
    }
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.idleVariationTimer) {
      clearTimeout(this.idleVariationTimer);
      this.idleVariationTimer = null;
    }

    if (this.state.headFollowTimer) {
      clearTimeout(this.state.headFollowTimer);
      this.state.headFollowTimer = null;
    }

    this.clearReturnToNeutralTimer();
  }

  /**
   * Cleanup and release resources
   */
  public dispose(): void {
    this.stop();
    this.clearTimers();
    this.cleanupMode();
    this.teardownCameraTracking();

    this.eyeSnippets.clear();
    this.headSnippets.clear();
    try { this.gazeService?.dispose(); } catch {}
    this.gazeService = null;
    try { this.scheduler?.stop(); } catch {}
    this.scheduler = null;
    try { this.machine?.stop(); } catch {}
    this.machine = null;
  }
}

/**
 * Factory function to create an Eye and Head Tracking service
 */
export function createEyeHeadTrackingService(
  config?: EyeHeadTrackingConfig,
  callbacks?: EyeHeadTrackingCallbacks
): EyeHeadTrackingService {
  return new EyeHeadTrackingService(config, callbacks);
}
