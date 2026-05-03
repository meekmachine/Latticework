/**
 * Transcription Service
 * Main Speech-to-Text service using Web Speech API
 * Modernized TypeScript version of the old transcriptionService.js
 */

import type {
  TranscriptionConfig,
  TranscriptionState,
  TranscriptionCallbacks,
  RecognitionResult,
  AgentSpeechEvent,
  BoundaryEvent,
  InterruptionEvent,
} from './types';
import { DEFAULT_TRANSCRIPTION_CONFIG } from './types';

export class TranscriptionService {
  private config: Required<TranscriptionConfig>;
  private state: TranscriptionState;
  private callbacks: TranscriptionCallbacks;
  private transcriptListeners = new Set<(transcript: string, isFinal: boolean) => void>();
  private interruptionListeners = new Set<(event: InterruptionEvent) => void>();

  // Web Speech API
  private recognition: SpeechRecognition | null = null;
  private isManualStop = false;
  private micStream: MediaStream | null = null;
  private analysisContext: AudioContext | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micAnalyserData = new Uint8Array(1024);
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private agentReferenceTrack: MediaStreamTrack | null = null;
  private agentReferenceStream: MediaStream | null = null;
  private agentAnalyser: AnalyserNode | null = null;
  private agentAnalyserData = new Uint8Array(1024);
  private agentSourceNode: MediaStreamAudioSourceNode | null = null;
  private interruptionFrame: number | null = null;
  private interruptionCandidateStart: number | null = null;
  private interruptionLatched = false;
  private lastInterruptionDebugAt = 0;
  private agentReferenceUpdateToken = 0;

  // Agent speech filtering
  private agentWordSet = new Set<string>();
  private agentScriptStr = '';
  private agentSpeakingActive = false;
  private currentAgentWord = '';

  // Boundary stream
  private boundaryListeners: Array<(event: BoundaryEvent) => void> = [];

  // Tokenizer (simple whitespace tokenizer - can be upgraded to Natural if needed)
  private tokenizer = (text: string): string[] => {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 0);
  };

  constructor(config: TranscriptionConfig = {}, callbacks: TranscriptionCallbacks = {}) {
    this.config = {
      ...DEFAULT_TRANSCRIPTION_CONFIG,
      ...config,
    };

    this.callbacks = callbacks;

    this.state = {
      status: 'idle',
    };

    this.initialize();
  }

  /**
   * Initialize Web Speech API
   */
  private initialize(): void {
    if (typeof window === 'undefined') {
      console.warn('TranscriptionService: window not available (SSR context)');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error('TranscriptionService: Web Speech API not supported');
      this.setState({ status: 'error', error: 'Web Speech API not supported' });
      return;
    }

    this.recognition = new SpeechRecognition();
    this.setupRecognition();
  }

  /**
   * Setup recognition handlers
   */
  private setupRecognition(): void {
    if (!this.recognition) return;

    this.recognition.lang = this.config.lang;
    this.recognition.continuous = this.config.continuous;
    this.recognition.interimResults = this.config.interimResults;
    this.recognition.maxAlternatives = this.config.maxAlternatives;

    // Handle results
    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim();

        if (!transcript) continue;

        const isFinal = result.isFinal;

        // Apply agent speech filtering if enabled
        if (this.config.agentFilteringEnabled && this.shouldFilterTranscript(transcript)) {
          console.log('[TranscriptionService] Filtered agent echo:', transcript);
          continue;
        }

        // Emit word boundary events
        this.emitWordBoundaries(transcript, 'user');

        // Update state and notify
        this.setState({
          status: 'listening',
          currentTranscript: transcript,
          isFinal,
        });

        this.emitTranscript(transcript, isFinal);
      }
    };

    // Handle errors
    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn('[TranscriptionService] Recognition error:', event.error);

      if (this.isManualStop && event.error === 'aborted') {
        this.setState({ status: 'idle' });
        return;
      }

      this.setState({
        status: 'error',
        error: event.error,
      });

      this.callbacks.onError?.(new Error(event.error));

      // Auto-restart on certain errors if continuous
      if (this.config.continuous && !this.isManualStop) {
        this.restartRecognition();
      }
    };

    // Handle end
    this.recognition.onend = () => {
      console.log('[TranscriptionService] Recognition ended, manualStop:', this.isManualStop);

      if (!this.isManualStop && this.config.continuous) {
        // Auto-restart if continuous and not manually stopped
        this.restartRecognition();
      } else {
        this.setState({ status: 'idle' });
        this.callbacks.onEnd?.();
      }
    };

    // Handle start
    this.recognition.onstart = () => {
      console.log('[TranscriptionService] Recognition started');
      this.setState({ status: 'listening' });
      this.callbacks.onStart?.();
    };
  }

  /**
   * Restart recognition after error or unexpected end
   */
  private restartRecognition(): void {
    if (!this.recognition || this.isManualStop) return;

    console.log('[TranscriptionService] Auto-restarting recognition...');

    setTimeout(() => {
      void this.startRecognition().catch((err) => {
        console.warn('[TranscriptionService] Restart failed:', err);
      });
    }, 100);
  }

  /**
   * Acquire microphone stream and keep it for reuse.
   */
  private async ensureMicrophoneStream(): Promise<MediaStream> {
    if (this.micStream) {
      const liveTrack = this.micStream.getAudioTracks().find((track) => track.readyState === 'live');
      if (liveTrack) {
        return this.micStream;
      }
    }

    const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    if ((supported as MediaTrackSupportedConstraints & { voiceIsolation?: boolean }).voiceIsolation) {
      (audioConstraints as MediaTrackConstraints & { voiceIsolation?: boolean }).voiceIsolation = true;
    }

    console.log('[TranscriptionService] Requesting microphone permission...');
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    } catch (error) {
      console.warn('[TranscriptionService] Enhanced mic constraints failed, retrying with plain audio:', error);
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    console.log('[TranscriptionService] Microphone permission granted');
    await this.ensureMicrophoneAnalyser();
    return this.micStream;
  }

  private async ensureAnalysisContext(): Promise<AudioContext> {
    if (!this.analysisContext || this.analysisContext.state === 'closed') {
      this.analysisContext = new AudioContext();
    }

    if (this.analysisContext.state === 'suspended') {
      try {
        await this.analysisContext.resume();
      } catch (error) {
        console.warn('[TranscriptionService] Failed to resume analysis context:', error);
      }
    }

    return this.analysisContext;
  }

  private async ensureMicrophoneAnalyser(): Promise<void> {
    const micStream = this.micStream;
    if (!micStream) return;

    const audioTrack = micStream.getAudioTracks()[0];
    if (!audioTrack) return;

    if (this.micSourceNode && this.micAnalyser && this.micSourceNode.mediaStream.getAudioTracks()[0] === audioTrack) {
      return;
    }

    this.micSourceNode?.disconnect();
    this.micAnalyser?.disconnect();

    const analysisContext = await this.ensureAnalysisContext();
    this.micSourceNode = analysisContext.createMediaStreamSource(micStream);
    this.micAnalyser = analysisContext.createAnalyser();
    this.micAnalyser.fftSize = 2048;
    this.micAnalyser.smoothingTimeConstant = 0.65;
    this.micSourceNode.connect(this.micAnalyser);
    this.micAnalyserData = new Uint8Array(this.micAnalyser.fftSize);
  }

  private async updateAgentReferenceAnalyser(): Promise<void> {
    const updateToken = ++this.agentReferenceUpdateToken;
    const referenceTrack = this.agentReferenceTrack;

    this.agentSourceNode?.disconnect();
    this.agentAnalyser?.disconnect();
    this.agentSourceNode = null;
    this.agentAnalyser = null;
    this.agentReferenceStream = null;

    if (!referenceTrack || referenceTrack.readyState !== 'live') {
      return;
    }

    const analysisContext = await this.ensureAnalysisContext();
    if (
      updateToken !== this.agentReferenceUpdateToken ||
      this.agentReferenceTrack !== referenceTrack ||
      referenceTrack.readyState !== 'live'
    ) {
      return;
    }

    const referenceStream = new MediaStream([referenceTrack]);
    const sourceNode = analysisContext.createMediaStreamSource(referenceStream);
    const analyser = analysisContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.65;
    sourceNode.connect(analyser);

    if (
      updateToken !== this.agentReferenceUpdateToken ||
      this.agentReferenceTrack !== referenceTrack ||
      referenceTrack.readyState !== 'live'
    ) {
      sourceNode.disconnect();
      analyser.disconnect();
      return;
    }

    this.agentReferenceStream = referenceStream;
    this.agentSourceNode = sourceNode;
    this.agentAnalyser = analyser;
    this.agentAnalyserData = new Uint8Array(analyser.fftSize);
  }

  private readLevel(analyser: AnalyserNode | null, data: Uint8Array): number {
    if (!analyser) return 0;

    (analyser as AnalyserNode & { getByteTimeDomainData: (array: Uint8Array) => void }).getByteTimeDomainData(
      data as unknown as Uint8Array
    );
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const sample = ((data[i] ?? 128) - 128) / 128;
      sum += sample * sample;
    }

    return Math.sqrt(sum / data.length);
  }

  private emitTranscript(transcript: string, isFinal: boolean): void {
    this.callbacks.onTranscript?.(transcript, isFinal);
    this.transcriptListeners.forEach((listener) => listener(transcript, isFinal));
  }

  private emitInterruption(event: InterruptionEvent): void {
    this.callbacks.onInterruption?.(event);
    this.interruptionListeners.forEach((listener) => listener(event));
  }

  public setAgentAudioReferenceTrack(track: MediaStreamTrack | null): void {
    this.agentReferenceTrack = track;
    void this.updateAgentReferenceAnalyser();
  }

  private startInterruptionMonitoring(): void {
    if (!this.config.interruptDetectionEnabled) return;
    if (this.interruptionFrame !== null) return;

    const tick = () => {
      if (!this.agentSpeakingActive) {
        this.stopInterruptionMonitoring();
        return;
      }

      const hasAgentReference = this.agentReferenceTrack?.readyState === 'live' && !!this.agentAnalyser;
      if (this.config.requireAgentReferenceForInterruption && !hasAgentReference) {
        this.interruptionCandidateStart = null;
        this.interruptionFrame = window.requestAnimationFrame(tick);
        return;
      }

      const microphoneLevel = this.readLevel(this.micAnalyser, this.micAnalyserData);
      const referenceLevel = hasAgentReference
        ? this.readLevel(this.agentAnalyser, this.agentAnalyserData)
        : 0;
      const requiredLevel = Math.max(
        this.config.interruptionVolumeThreshold,
        referenceLevel * this.config.interruptionReferenceScale + this.config.interruptionReferenceOffset
      );
      const shouldInterrupt = microphoneLevel >= requiredLevel;

      if (this.config.interruptionDebugLogging) {
        const now = performance.now();
        if (now - this.lastInterruptionDebugAt >= 500) {
          this.lastInterruptionDebugAt = now;
          console.debug('[TranscriptionService] Interruption levels', {
            microphoneLevel,
            referenceLevel,
            requiredLevel,
            shouldInterrupt,
            hasAgentReference,
          });
        }
      }

      if (shouldInterrupt && !this.interruptionLatched) {
        if (this.interruptionCandidateStart == null) {
          this.interruptionCandidateStart = performance.now();
        } else if (performance.now() - this.interruptionCandidateStart >= this.config.interruptionHoldMs) {
          this.interruptionLatched = true;
          const event: InterruptionEvent = {
            timestamp: Date.now(),
            microphoneLevel,
            referenceLevel,
            requiredLevel,
          };
          this.emitInterruption(event);
        }
      } else if (!shouldInterrupt) {
        this.interruptionCandidateStart = null;
      }

      this.interruptionFrame = window.requestAnimationFrame(tick);
    };

    this.interruptionFrame = window.requestAnimationFrame(tick);
  }

  private stopInterruptionMonitoring(): void {
    if (this.interruptionFrame !== null) {
      window.cancelAnimationFrame(this.interruptionFrame);
      this.interruptionFrame = null;
    }
    this.interruptionCandidateStart = null;
  }

  /**
   * Start recognition, preferring the experimental audio-track path when available.
   */
  private async startRecognition(): Promise<void> {
    if (!this.recognition) {
      throw new Error('Recognition not initialized');
    }

    const micStream = await this.ensureMicrophoneStream();
    const micTrack = micStream.getAudioTracks()[0];

    if (!micTrack) {
      throw new Error('No microphone audio track available');
    }

    try {
      console.log('[TranscriptionService] Starting speech recognition with mic track...');
      this.recognition.start(micTrack);
    } catch (err) {
      console.warn('[TranscriptionService] Track-based start failed, falling back to default start():', err);
      this.recognition.start();
    }

    if (this.agentSpeakingActive) {
      this.startInterruptionMonitoring();
    }
  }

  /**
   * Check if transcript should be filtered (agent echo detection)
   */
  private shouldFilterTranscript(transcript: string): boolean {
    if (!this.agentSpeakingActive) return false;

    const transcriptLower = transcript.toLowerCase();
    const tokens = this.tokenizer(transcriptLower);

    // Check if all tokens match agent script
    const allMatchScript = tokens.every((token) => this.agentWordSet.has(token));

    // Check if transcript is a prefix of agent script
    const prefixMatch = this.agentScriptStr.startsWith(transcriptLower);

    return allMatchScript || prefixMatch;
  }

  /**
   * Emit word boundary events for transcript
   */
  private emitWordBoundaries(transcript: string, speaker: 'user' | 'agent'): void {
    const tokens = this.tokenizer(transcript);

    tokens.forEach((word, index) => {
      const event: BoundaryEvent = {
        word,
        index,
        timestamp: Date.now(),
        speaker,
      };

      this.boundaryListeners.forEach((listener) => listener(event));
      this.callbacks.onBoundary?.(event);
    });
  }

  /**
   * Start listening
   */
  public async startListening(): Promise<void> {
    if (!this.recognition) {
      console.error('[TranscriptionService] Recognition not initialized');
      this.callbacks.onError?.(new Error('Recognition not initialized'));
      return;
    }

    if (this.state.status === 'listening') {
      console.warn('[TranscriptionService] Already listening');
      return;
    }

    try {
      await this.ensureMicrophoneStream();
    } catch (err) {
      console.error('[TranscriptionService] Microphone permission denied:', err);
      this.setState({ status: 'error', error: 'Microphone permission denied' });
      this.callbacks.onError?.(new Error('Microphone permission denied'));
      return;
    }

    this.isManualStop = false;

    try {
      await this.startRecognition();
    } catch (err) {
      console.error('[TranscriptionService] Failed to start:', err);
      this.setState({ status: 'error', error: 'Failed to start recognition' });
      this.callbacks.onError?.(err as Error);
    }
  }

  /**
   * Stop listening
   */
  public stopListening(): void {
    if (!this.recognition) return;

    this.isManualStop = true;

    try {
      this.recognition.stop();
    } catch (err) {
      console.warn('[TranscriptionService] Failed to stop:', err);
    }

    this.setState({ status: 'idle' });
  }

  /**
   * Handle agent speech event (for echo filtering)
   */
  public handleAgentSpeech(event: AgentSpeechEvent): void {
    switch (event.type) {
      case 'AGENT_SCRIPT':
        // Store full agent script for filtering
        this.agentWordSet.clear();
        (event.words || []).forEach((word) => this.agentWordSet.add(word.toLowerCase()));
        this.agentScriptStr = (event.words || []).join(' ').toLowerCase();
        break;

      case 'AGENT_START':
        // Agent starts speaking
        this.agentSpeakingActive = true;
        this.interruptionLatched = false;
        this.startInterruptionMonitoring();
        break;

      case 'WORD':
        // Current agent word
        this.currentAgentWord = event.word?.toLowerCase() || '';

        if (event.word) {
          const boundaryEvent: BoundaryEvent = {
            word: event.word.toLowerCase(),
            index: event.index ?? -1,
            timestamp: Date.now(),
            speaker: 'agent',
          };

          this.boundaryListeners.forEach((listener) => listener(boundaryEvent));
        }
        break;

      case 'END':
        // Agent finished phrase
        this.currentAgentWord = '';
        break;

      case 'AGENT_DONE':
      case 'PLAYBACK_ENDED':
        // Agent completely done speaking
        this.agentSpeakingActive = false;
        this.agentWordSet.clear();
        this.agentScriptStr = '';
        this.currentAgentWord = '';
        this.interruptionLatched = false;
        this.stopInterruptionMonitoring();
        break;
    }
  }

  /**
   * Notify that agent is speaking (for echo filtering)
   */
  public prepareAgentSpeech(text: string): void {
    this.agentWordSet.clear();
    const words = this.tokenizer(text);
    words.forEach((word) => this.agentWordSet.add(word));
    this.agentScriptStr = text.toLowerCase();
    this.currentAgentWord = '';
  }

  public notifyAgentSpeech(text: string): void {
    this.prepareAgentSpeech(text);
    this.agentSpeakingActive = true;
    this.interruptionLatched = false;
    this.interruptionCandidateStart = null;
    this.startInterruptionMonitoring();
  }

  /**
   * Notify that agent has finished speaking
   */
  public notifyAgentSpeechEnd(): void {
    // Clear agent speech filtering
    this.agentSpeakingActive = false;
    this.agentWordSet.clear();
    this.agentScriptStr = '';
    this.currentAgentWord = '';
    this.interruptionLatched = false;
    this.stopInterruptionMonitoring();
  }

  /**
   * Subscribe to boundary events
   */
  public onBoundary(listener: (event: BoundaryEvent) => void): () => void {
    this.boundaryListeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.boundaryListeners.indexOf(listener);
      if (index > -1) {
        this.boundaryListeners.splice(index, 1);
      }
    };
  }

  public onTranscript(listener: (transcript: string, isFinal: boolean) => void): () => void {
    this.transcriptListeners.add(listener);
    return () => {
      this.transcriptListeners.delete(listener);
    };
  }

  public onInterruption(listener: (event: InterruptionEvent) => void): () => void {
    this.interruptionListeners.add(listener);
    return () => {
      this.interruptionListeners.delete(listener);
    };
  }

  /**
   * Get current state
   */
  public getState(): TranscriptionState {
    return { ...this.state };
  }

  /**
   * Update state
   */
  private setState(update: Partial<TranscriptionState>): void {
    this.state = { ...this.state, ...update };
  }

  /**
   * Update configuration
   */
  public updateConfig(config: Partial<TranscriptionConfig>): void {
    this.config = { ...this.config, ...config };

    // Reapply config to recognition
    if (this.recognition) {
      this.recognition.lang = this.config.lang;
      this.recognition.continuous = this.config.continuous;
      this.recognition.interimResults = this.config.interimResults;
      this.recognition.maxAlternatives = this.config.maxAlternatives;
    }
  }

  /**
   * Cleanup and dispose
   */
  public dispose(): void {
    this.stopListening();
    this.stopInterruptionMonitoring();
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    this.micSourceNode?.disconnect();
    this.micAnalyser?.disconnect();
    this.agentSourceNode?.disconnect();
    this.agentAnalyser?.disconnect();
    if (this.analysisContext) {
      void this.analysisContext.close();
      this.analysisContext = null;
    }
    this.boundaryListeners = [];
    this.transcriptListeners.clear();
    this.interruptionListeners.clear();
    this.recognition = null;
  }
}

/**
 * Create transcription service instance
 */
export function createTranscriptionService(
  config?: TranscriptionConfig,
  callbacks?: TranscriptionCallbacks
): TranscriptionService {
  return new TranscriptionService(config, callbacks);
}
