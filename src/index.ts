export {
  animationEventEmitter,
  createAnimationService,
  snippetState$,
  snippetTime$,
  snippetList$,
  globalPlaybackState$,
  bakedClipList$,
  playingBakedAnimations$,
  bakedAnimationState$,
  bakedAnimationProgress$,
} from './animation/animationService';
export type { AnimationService } from './animation/animationService';
export type {
  AnimationEvent,
  SnippetUIState,
  BakedClipInfo,
  BakedAnimationUIState,
} from './animation/animationEvents';
export {
  preloadAllSnippets,
  clearPreloadedSnippets,
  getAvailableSnippetNames,
  getBundledSnippetNames,
  getStoredSnippetNames,
  resolveSnippetEntry,
} from './animation/snippetPreloader';
export type {
  ResolvedSnippetEntry,
  SnippetCategoryKey,
} from './animation/snippetPreloader';
export type {
  AIExpressionInterpretationMetadata,
  AIExpressionSnippetMetadata,
  CurvePoint,
  EasingType,
  MixerLoopMode,
  NormalizedSnippet,
  Snippet,
} from './animation/types';

export {
  BlinkService,
  createBlinkService,
} from './blink/blinkService';
export type {
  BlinkServiceAPI,
  BlinkHostCaps,
} from './blink/blinkService';
export type { BlinkState } from './blink/types';

export {
  createConversationService,
  ConversationService,
} from './conversation/conversationService';
export type {
  ConversationCallbacks,
  ConversationConfig,
  ConversationFlow,
  ConversationServiceAPI,
} from './conversation/types';

export {
  EyeHeadTrackingService,
  createEyeHeadTrackingService,
  DEFAULT_EYE_HEAD_CONFIG,
  DEFAULT_ANIMATION_KEYS,
  EYE_AUS,
  HEAD_AUS,
} from './eyeHeadTracking';
export type {
  EyeHeadTrackingCallbacks,
  EyeHeadTrackingConfig,
  EyeHeadTrackingState,
  GazeTarget,
  TrackingChannel,
} from './eyeHeadTracking';

export { HairService } from './hair/hairService';
export {
  HAIR_COLOR_PRESETS,
  DEFAULT_HAIR_PHYSICS_CONFIG,
  DEFAULT_HAIR_PHYSICS_ENABLED,
} from './hair/types';
export type {
  HairPhysicsRuntimeConfig,
  HairPhysicsUIConfig,
  HairState,
} from './hair/types';

export {
  AZURE_TO_CC4_VISEME,
  azureVisemesToTimeline,
  LipSyncService,
  createLipSyncService,
  lipSyncMachine,
  LipSyncScheduler,
  VisemeMapper,
  mapAzureVisemeIdToCC4,
  normalizeAzureVisemes,
  visemeMapper,
  PhonemeExtractor,
  phonemeExtractor,
  VISEME_NAMES,
} from './lipsync';
export type {
  AzureTimelineOptions,
  AzureVisemeLike,
  AzureWordTimingLike,
  NormalizedAzureViseme,
} from './lipsync/azureVisemeMapping';
export type {
  LipSyncServiceAPI,
  LipSyncHostCaps,
} from './lipsync/lipSyncService';
export type { LipSyncSnippet } from './lipsync/lipSyncMachine';
export type { LipSyncSchedulerConfig } from './lipsync/lipSyncScheduler';
export type {
  AzureVisemeEvent,
  LipSyncCallbacks,
  LipSyncConfig,
  LipSyncState,
  PhonemeTiming,
  SAPIViseme,
  VisemeEvent,
  VisemeSnippet,
} from './lipsync/types';

export {
  createTranscriptionService,
  TranscriptionService,
} from './transcription/transcriptionService';
export type {
  BoundaryEvent,
  TranscriptionCallbacks,
  TranscriptionConfig,
  TranscriptionState,
} from './transcription/types';

export {
  createTTSService,
  TTSService,
  parseTokens,
  buildLocalTimeline,
  buildSAPITimeline,
  extractPhonemesFromWord,
  phonemeToViseme,
  decodeBase64Audio,
  getTimelineDuration,
  PHONEME_TO_VISEME,
} from './tts';
export type {
  EmojiTimelineItem,
  ParsedTokens,
  PhonemeTimelineItem,
  TimelineEvent,
  TTSCallbacks,
  TTSConfig,
  TTSEngine,
  TTSState,
  TTSVoice,
  VisemeTimelineItem,
  WordTimelineItem,
} from './tts';

export {
  createVocalService,
  VocalService,
  buildVocalSnippet,
  buildWordSnippet,
  buildTextSnippet,
} from './vocal';
export type {
  VocalConfig,
  VocalSnippet,
  VocalTimeline,
  VocalWordTiming,
  VocalState,
  WordTiming,
} from './vocal';
