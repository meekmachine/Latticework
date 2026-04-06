/**
 * Eye and Head Tracking Service
 * Coordinates eye and head movements that follow mouth animations
 * Uses the animation scheduler to drive both eyes and head with a shared controller.
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
import { NullGazeAgency, type GazeAgency, GazeService } from '../gaze';
import { createActor } from 'xstate';
import {
  eyeHeadTrackingMachine,
  type EyeHeadTrackingMachine,
  type EyeHeadTrackingMachineContext,
} from './eyeHeadTrackingMachine';
import { fromEvent, type Subscription, animationFrameScheduler } from 'rxjs';
import { map, pairwise, throttleTime } from 'rxjs/operators';
import { EyeHeadPlanner } from './planner';

// Declare global BlazeFace from CDN
declare const blazeface: {
  load: () => Promise<any>;
};

export class EyeHeadTrackingService {
  private config: EyeHeadTrackingConfig;
  private state: EyeHeadTrackingState;
  private callbacks: EyeHeadTrackingCallbacks;

  private scheduler: EyeHeadTrackingScheduler | null = null;
  private gazeAgency: GazeAgency | null = null;
  private experimentalGaze: GazeService | null = null;

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
  private lastMouseUpdate: number = 0;
  private planner: EyeHeadPlanner;

  // Webcam tracking state (internal - no React hooks)
  private webcamModel: any = null;
  private webcamStream: MediaStream | null = null;
  private webcamVideo: HTMLVideoElement | null = null;
  private webcamRafId: number | null = null;
  private webcamFaceDetected: boolean = false;
  private webcamListeners: Set<(detected: boolean, landmarks?: Array<{ x: number; y: number }>) => void> = new Set();
  private lastWebcamUpdate: number = 0;
  private lastAgencySchedule: number = 0;
  private lastAgencyTarget: GazeTarget = { x: 0, y: 0, z: 0 };

  constructor(
    config: EyeHeadTrackingConfig = {},
    callbacks: EyeHeadTrackingCallbacks = {}
  ) {
    this.config = {
      ...DEFAULT_EYE_HEAD_CONFIG,
      ...config,
    };

    this.callbacks = callbacks;
    this.planner = new EyeHeadPlanner();

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
    if (!this.config.animationAgency) {
      this.scheduler = null;
      this.gazeAgency = new NullGazeAgency();
      this.experimentalGaze = new GazeService({
        eyesEnabled: this.config.eyeTrackingEnabled,
        headEnabled: this.config.headTrackingEnabled,
        headFollowEyes: this.config.headFollowEyes,
        eyeIntensity: this.config.eyeIntensity,
        headIntensity: this.config.headIntensity,
        engine: this.config.engine,
        useTransport: false,
      });
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

    // Experimental gaze agency (currently a stub) lives alongside legacy scheduler
    this.gazeAgency = new NullGazeAgency({
      eyesEnabled: this.config.eyeTrackingEnabled,
      headEnabled: this.config.headTrackingEnabled,
    });
    this.experimentalGaze = new GazeService({
      eyesEnabled: this.config.eyeTrackingEnabled,
      headEnabled: this.config.headTrackingEnabled,
      headFollowEyes: this.config.headFollowEyes,
      eyeIntensity: this.config.eyeIntensity,
      headIntensity: this.config.headIntensity,
      engine: this.config.engine,
      useTransport: false,
    });
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

    // Schedule return to neutral if enabled (only for manual mode)
    if (this.trackingMode === 'manual') {
      this.scheduleReturnToNeutral();
    }

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
    this.setGazeTarget({ x: 0, y: 0, z: 0 });
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
    this.config = {
      ...this.config,
      ...config,
    };

    // Keep useAnimationAgency in sync when gazeMode flips
    if (config.gazeMode) {
      // Legacy + experimental both route through the scheduler/agency,
      // engine mode uses direct AU transitions.
      this.config.useAnimationAgency = config.gazeMode !== 'engine';
    }

    if (config.animationAgency !== undefined) {
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

    // Update experimental gaze config
    if (this.experimentalGaze) {
      this.experimentalGaze.updateConfig({
        eyesEnabled: this.config.eyeTrackingEnabled,
        headEnabled: this.config.headTrackingEnabled,
        headFollowEyes: this.config.headFollowEyes,
        eyeIntensity: this.config.eyeIntensity,
        headIntensity: this.config.headIntensity,
        engine: this.config.engine,
      });
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
      // Mouse position normalized to -1..+1 with sign flip for gaze direction:
      //   Raw: +1 = right edge, -1 = left edge
      //   After flip: +1 = left edge, -1 = right edge
      // This maps to transitionContinuum(61, 62, value):
      //   positive → AU62 → character looks toward viewer's LEFT (where mouse IS)
      //   negative → AU61 → character looks toward viewer's RIGHT (where mouse IS)
      x: -((e.clientX / window.innerWidth) * 2 - 1),
      y: -((e.clientY / window.innerHeight) * 2 - 1),
    });

    this.mouseSubscription = fromEvent<MouseEvent>(window, 'mousemove')
      .pipe(
        throttleTime(0, animationFrameScheduler),
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

          // Use setGazeTarget which respects useAnimationAgency toggle
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

  /**
   * Apply gaze to character using smooth transitions
   * Converts normalized gaze coordinates to AU values
   * Always uses transitions for smooth, natural movement
   * Duration scales with distance traveled for natural motion
   *
   * Camera offset is applied to make the character look at the camera position,
   * then the target gaze is added on top for perspective-correct eye contact.
   */
  private applyGazeToCharacter(
    target: GazeTarget,
    options?: { applyEyes?: boolean; applyHead?: boolean; skipMachine?: boolean }
  ): void {
    // Early return if both eye and head tracking are disabled (already checked in setGazeTarget, but double-check)
    if (!this.config.eyeTrackingEnabled && !this.config.headTrackingEnabled) {
      return;
    }

    const { x, y } = target;
    const eyeIntensity = this.config.eyeIntensity ?? 1.0;
    const headIntensity = this.config.headIntensity ?? 0.5;

    const cameraOffset = this.config.engine?.getCameraOffset?.() ?? { x: 0, y: 0 };

    // Apply camera offset to target coordinates
    // For webcam mode, this creates realistic eye contact
    // For mouse/manual modes, this adds subtle perspective correction
    const adjustedX = x + cameraOffset.x;
    const adjustedY = y + cameraOffset.y;

    // Smooth target to prevent micro-jumps (especially near center crossing)
    const gazeMode = this.config.gazeMode ?? DEFAULT_EYE_HEAD_CONFIG.gazeMode;
    const useAgency = gazeMode === 'legacy'
      ? true
      : gazeMode === 'experimental'
        ? true
        : (this.config.useAnimationAgency ?? DEFAULT_EYE_HEAD_CONFIG.useAnimationAgency);
    const rawTarget = { x: adjustedX, y: adjustedY, z: 0 };
    const useExperimentalScheduler = gazeMode === 'experimental';
    const shouldPreSmooth = !useExperimentalScheduler;
    const prev =
      useAgency && this.trackingMode !== 'manual'
        ? this.state.currentGaze
        : (this.filteredGaze ?? this.state.currentGaze);
    const rawDistance = Math.hypot(adjustedX - prev.x, adjustedY - prev.y);
    const baseAlpha = this.trackingMode === 'mouse' ? 0.2 : 0.18;
    const alpha = Math.min(0.7, baseAlpha + rawDistance * 0.25); // Larger moves respond faster, but cap to avoid snaps
    const smoothX = prev.x + (adjustedX - prev.x) * alpha;
    const smoothY = prev.y + (adjustedY - prev.y) * alpha;
    const smoothedTarget = { x: smoothX, y: smoothY, z: 0 };
    const targetForPlanning = shouldPreSmooth ? smoothedTarget : rawTarget;

    // Calculate distance from current position (using smoothed coordinates)
    const { x: currentX, y: currentY } = this.state.currentGaze;
    const deltaX = targetForPlanning.x - currentX;
    const deltaY = targetForPlanning.y - currentY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Ignore ultra-small changes to avoid rescheduling noise when crossing center
    if (distance < 0.003) {
      if (!useAgency) {
        this.filteredGaze = targetForPlanning;
      }
      return;
    }

    // Trajectory-aware planning: estimate velocity and lead a short horizon to avoid over-scheduling
    const nowMs = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    const plan = this.planner.plan({
      target: targetForPlanning,
      mode: this.trackingMode,
      nowMs,
      lastAgencyTarget: this.lastAgencyTarget,
      currentGaze: this.state.currentGaze,
      headFollowDelay: this.config.headFollowEyes ? (this.config.headFollowDelay ?? 0) : 0,
    });
    if (!plan.shouldSchedule) {
      this.filteredGaze = targetForPlanning;
      return;
    }

    // Scale duration based on distance traveled
    // Base durations: eye 150-400ms, head 250-600ms
    // Use different scaling for mouse (faster response) vs manual
    const eyeDuration = plan.eyeDuration;
    const headDuration = plan.headDuration;

    const applyEyes = options?.applyEyes ?? true;
    const applyHead = options?.applyHead ?? true;
    const scheduler = this.scheduler;

    // Use animation agency if enabled AND available, otherwise use direct engine calls
    let applied = false;

    if (useAgency && scheduler && this.config.animationAgency) {
      const now = performance.now();
      const isContinuous = this.trackingMode !== 'manual';
      const minIntervalMs = isContinuous ? 120 : 0;
      const delta = Math.hypot(
        targetForPlanning.x - this.lastAgencyTarget.x,
        targetForPlanning.y - this.lastAgencyTarget.y
      );
      const shouldSchedule =
        !isContinuous ||
        now - this.lastAgencySchedule >= minIntervalMs ||
        delta >= 0.03;

      if (shouldSchedule) {
        const scheduled = scheduler.scheduleGazeTransition(
          plan.target,
          {
            eyeEnabled: applyEyes && this.config.eyeTrackingEnabled,
            headEnabled: applyHead && this.config.headTrackingEnabled,
            headFollowEyes: this.config.headFollowEyes,
            eyeDuration: eyeDuration,
            headDuration: headDuration,
          }
        );
        if (scheduled) {
          this.lastAgencySchedule = now;
          this.lastAgencyTarget = targetForPlanning;
          applied = true;
        }
      }
    } else if (this.config.engine) {
      // Direct engine path - bypasses animation scheduler
      // CRITICAL: Must set BOTH AUs in each continuum pair to avoid snap/stick bugs
      // Continuum axis = positiveAU - negativeAU, so leftover values cause incorrect results
      if (applyEyes && this.config.eyeTrackingEnabled) {
        const eyeYaw = targetForPlanning.x * eyeIntensity;
        const eyePitch = targetForPlanning.y * eyeIntensity;
        // Eyes: use transitionContinuum to avoid bone axis overwrite bug
        // (calling transitionAU on both AUs in a pair overwrites the bone - see engine/README.md)
        if (this.config.engine.transitionContinuum) {
          this.config.engine.transitionContinuum(61, 62, eyeYaw, eyeDuration);
          this.config.engine.transitionContinuum(64, 63, eyePitch, eyeDuration);
        } else {
          // Fallback: only set the active direction AU
          if (eyeYaw < 0) {
            this.config.engine.transitionAU?.(61, Math.abs(eyeYaw), eyeDuration);
          } else {
            this.config.engine.transitionAU?.(62, eyeYaw, eyeDuration);
          }
          if (eyePitch < 0) {
            this.config.engine.transitionAU?.(64, Math.abs(eyePitch), eyeDuration);
          } else {
            this.config.engine.transitionAU?.(63, eyePitch, eyeDuration);
          }
        }
      }

      if (applyHead && this.config.headTrackingEnabled && this.config.headFollowEyes) {
        const headYaw = targetForPlanning.x * headIntensity;
        const headPitch = targetForPlanning.y * headIntensity;
        // Head: use transitionContinuum to avoid bone axis overwrite bug
        if (this.config.engine.transitionContinuum) {
          this.config.engine.transitionContinuum(51, 52, headYaw, headDuration);
          this.config.engine.transitionContinuum(54, 53, headPitch, headDuration);
        } else {
          // Fallback: only set the active direction AU
          if (headYaw < 0) {
            this.config.engine.transitionAU?.(51, Math.abs(headYaw), headDuration);
          } else {
            this.config.engine.transitionAU?.(52, headYaw, headDuration);
          }
          if (headPitch < 0) {
            this.config.engine.transitionAU?.(54, Math.abs(headPitch), headDuration);
          } else {
            this.config.engine.transitionAU?.(53, headPitch, headDuration);
          }
        }
      }
      applied = true;
    }

    if (applyEyes && this.config.eyeTrackingEnabled) {
      this.state.eyeIntensity = eyeIntensity;
    }
    if (applyHead && this.config.headTrackingEnabled) {
      this.state.headIntensity = headIntensity;
    }

    // Update current gaze position for next distance calculation (use adjusted coordinates)
    if (applied || !useAgency) {
      this.filteredGaze = targetForPlanning;
    }
    if (applied) {
      this.state.currentGaze = targetForPlanning;
    }

    // Skip machine updates for continuous tracking (mouse/webcam) to avoid overhead
    if (applied && !options?.skipMachine) {
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

    this.state.returnToNeutralTimer = window.setTimeout(() => {
      // Only return to neutral if we're not at neutral already
      const { x, y } = this.state.targetGaze;
      const isAlreadyNeutral = Math.abs(x) < 0.01 && Math.abs(y) < 0.01;

      if (!isAlreadyNeutral) {
        const useAgency = this.config.useAnimationAgency ?? DEFAULT_EYE_HEAD_CONFIG.useAnimationAgency;
        if (useAgency && this.scheduler && this.config.animationAgency) {
          this.scheduler.resetToNeutral(duration);
        } else if (this.config.engine) {
          // Use transitionAU to return all axes to neutral (0)
          // Reset both AUs in each pair to 0
          if (this.config.eyeTrackingEnabled) {
            this.config.engine.transitionAU?.(61, 0, duration); // Eyes left
            this.config.engine.transitionAU?.(62, 0, duration); // Eyes right
            this.config.engine.transitionAU?.(63, 0, duration); // Eyes up
            this.config.engine.transitionAU?.(64, 0, duration); // Eyes down
          }
          if (this.config.headTrackingEnabled && this.config.headFollowEyes) {
            this.config.engine.transitionAU?.(51, 0, duration); // Head left
            this.config.engine.transitionAU?.(52, 0, duration); // Head right
            this.config.engine.transitionAU?.(53, 0, duration); // Head up
            this.config.engine.transitionAU?.(54, 0, duration); // Head down
          }
        }

        this.state.targetGaze = { x: 0, y: 0, z: 0 };
      }

      this.state.returnToNeutralTimer = null;
    }, delay);
  }

  /**
   * Clear return to neutral timer
   */
  private clearReturnToNeutralTimer(): void {
    if (this.state.returnToNeutralTimer) {
      clearTimeout(this.state.returnToNeutralTimer);
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

    this.eyeSnippets.clear();
    this.headSnippets.clear();
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
