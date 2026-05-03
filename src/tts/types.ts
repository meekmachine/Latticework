/**
 * TTS Agency Types
 * Type definitions for Text-to-Speech functionality
 */

export type TTSEngine = 'webSpeech' | 'sapi' | 'azure';
export type WebSpeechReferenceMode = 'none' | 'displayMedia';
export type PlaybackReferenceStatus =
  | 'unavailable'
  | 'requesting'
  | 'available'
  | 'denied'
  | 'failed'
  | 'no-audio'
  | 'ended';

export type VisemeID = number; // 0-20 for ARKit/FACS visemes

export interface TTSConfig {
  engine?: TTSEngine;
  rate?: number; // 0.1 - 10.0
  pitch?: number; // 0.0 - 2.0
  volume?: number; // 0.0 - 1.0
  voiceName?: string;
  lang?: string;
  /** Backend base URL for server TTS (Azure, etc.) */
  backendUrl?: string;
  /** Optional Azure Speech credentials (overrides backend env) */
  azureApiKey?: string;
  azureRegion?: string;
  /** Optional Azure voice style config */
  azureStyle?: string;
  azureStyleDegree?: number | null;
  /** Experimental reference capture for browser-native Web Speech TTS */
  webSpeechReferenceMode?: WebSpeechReferenceMode;
  /** Lip sync intensity multiplier */
  lipsyncIntensity?: number;
  /** Jaw scale multiplier */
  jawScale?: number;
  /** Animation agency for scheduling lip sync snippets */
  animationAgency?: {
    schedule: (snippet: any) => string | null;
    remove: (name: string) => void;
    setSnippetTime?: (name: string, timeSec: number) => void;
    seek?: (name: string, timeSec: number) => void;
  };
}

export interface TTSVoice {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

export interface TimelineItem {
  type: 'WORD' | 'VISEME' | 'EMOJI' | 'PHONEME';
  offsetMs: number;
  durMs?: number;
  data?: any;
}

export interface WordTimelineItem extends TimelineItem {
  type: 'WORD';
  word: string;
  index: number;
}

export interface VisemeTimelineItem extends TimelineItem {
  type: 'VISEME';
  visemeId: VisemeID;
  durMs: number;
}

export interface EmojiTimelineItem extends TimelineItem {
  type: 'EMOJI';
  emoji: string;
}

export interface PhonemeTimelineItem extends TimelineItem {
  type: 'PHONEME';
  phoneme: string;
  durMs: number;
}

export type TimelineEvent =
  | WordTimelineItem
  | VisemeTimelineItem
  | EmojiTimelineItem
  | PhonemeTimelineItem;

export interface SAPIResponse {
  audio: string; // base64 encoded WAV
  visemes: Array<{ id: VisemeID; duration: number }>;
  duration: number;
}

export interface TTSState {
  status: 'idle' | 'loading' | 'speaking' | 'paused' | 'stopped' | 'error';
  currentText?: string;
  currentTimeline?: TimelineEvent[];
  currentVoice?: TTSVoice;
  playbackReferenceStatus?: PlaybackReferenceStatus;
  error?: string;
}

export interface TTSCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  onBoundary?: (event: { word: string; charIndex: number }) => void;
  onViseme?: (visemeId: VisemeID, durationMs: number) => void;
  onError?: (error: Error) => void;
  onPause?: () => void;
  onResume?: () => void;
  onPlaybackReferenceStatusChange?: (status: PlaybackReferenceStatus) => void;
}

export interface SpeakResult {
  interrupted: boolean;
}

export interface ParsedTokens {
  text: string;
  emojis: Array<{ emoji: string; index: number }>;
}
