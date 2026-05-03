/**
 * Transcription Service Types
 * STT (Speech-to-Text) types and interfaces
 */

export interface TranscriptionConfig {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
  agentFilteringEnabled?: boolean;
  interruptDetectionEnabled?: boolean;
  /** Require a live agent playback reference before emitting audio interruptions. */
  requireAgentReferenceForInterruption?: boolean;
  interruptionDebugLogging?: boolean;
  interruptionVolumeThreshold?: number;
  interruptionReferenceScale?: number;
  interruptionReferenceOffset?: number;
  interruptionHoldMs?: number;
}

export interface TranscriptionState {
  status: 'idle' | 'listening' | 'processing' | 'error';
  currentTranscript?: string;
  isFinal?: boolean;
  error?: string;
}

export interface TranscriptionCallbacks {
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
  onBoundary?: (event: BoundaryEvent) => void;
  onInterruption?: (event: InterruptionEvent) => void;
}

export interface BoundaryEvent {
  word: string;
  index: number;
  timestamp: number;
  speaker: 'user' | 'agent';
}

export interface InterruptionEvent {
  timestamp: number;
  microphoneLevel: number;
  referenceLevel: number;
  requiredLevel: number;
}

export interface RecognitionResult {
  transcript: string;
  isFinal: boolean;
  confidence?: number;
  alternatives?: Array<{
    transcript: string;
    confidence: number;
  }>;
}

export interface AgentSpeechEvent {
  type: 'AGENT_SCRIPT' | 'AGENT_START' | 'WORD' | 'END' | 'AGENT_DONE' | 'PLAYBACK_ENDED';
  words?: string[];
  word?: string;
  index?: number;
  phrase?: string;
}

export const DEFAULT_TRANSCRIPTION_CONFIG: Required<TranscriptionConfig> = {
  lang: 'en-US',
  continuous: true,
  interimResults: true,
  maxAlternatives: 1,
  agentFilteringEnabled: true,
  interruptDetectionEnabled: true,
  requireAgentReferenceForInterruption: true,
  interruptionDebugLogging: false,
  interruptionVolumeThreshold: 0.035,
  interruptionReferenceScale: 0.45,
  interruptionReferenceOffset: 0.015,
  interruptionHoldMs: 150,
};
