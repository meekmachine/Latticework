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
}

export interface BoundaryEvent {
  word: string;
  index: number;
  timestamp: number;
  speaker: 'user' | 'agent';
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
};
