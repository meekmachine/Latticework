import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranscriptionService } from '../transcriptionService';

type ServiceInternals = {
  agentAnalyser: AnalyserNode | null;
  agentSpeakingActive: boolean;
  ensureAnalysisContext: () => Promise<AudioContext>;
  micAnalyser: AnalyserNode | null;
  setAgentAudioReferenceTrack: (track: MediaStreamTrack | null) => void;
  startInterruptionMonitoring: () => void;
};

function installSpeechRecognitionWindow(frames: FrameRequestCallback[]): void {
  class MockSpeechRecognition {
    public lang = '';
    public continuous = false;
    public interimResults = false;
    public maxAlternatives = 1;
    public onend: (() => void) | null = null;
    public onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null;
    public onresult: ((event: SpeechRecognitionEvent) => void) | null = null;
    public onstart: (() => void) | null = null;
    public start = vi.fn();
    public stop = vi.fn();
  }

  vi.stubGlobal('window', {
    SpeechRecognition: MockSpeechRecognition,
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }),
    cancelAnimationFrame: vi.fn(),
  });
}

function createLevelAnalyser(fillValue: number): AnalyserNode {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    fftSize: 2048,
    getByteTimeDomainData: vi.fn((data: Uint8Array) => {
      data.fill(fillValue);
    }),
    smoothingTimeConstant: 0.65,
  } as unknown as AnalyserNode;
}

function runNextFrame(frames: FrameRequestCallback[]): void {
  const frame = frames.shift();
  if (!frame) {
    throw new Error('Expected a queued animation frame');
  }

  frame(performance.now());
}

function createMonitoringService(
  frames: FrameRequestCallback[],
  onInterruption = vi.fn(),
  config: Parameters<typeof createTranscriptionService>[0] = {}
): ServiceInternals {
  installSpeechRecognitionWindow(frames);
  const service = createTranscriptionService(
    {
      interruptionHoldMs: 0,
      ...config,
    },
    { onInterruption }
  ) as unknown as ServiceInternals;
  service.agentSpeakingActive = true;
  service.micAnalyser = createLevelAnalyser(255);
  return service;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TranscriptionService audio interruption monitoring', () => {
  it('does not emit threshold-only interruptions without a playback reference by default', () => {
    const frames: FrameRequestCallback[] = [];
    const onInterruption = vi.fn();
    const service = createMonitoringService(frames, onInterruption);

    service.startInterruptionMonitoring();
    runNextFrame(frames);
    runNextFrame(frames);

    expect(onInterruption).not.toHaveBeenCalled();
  });

  it('allows threshold-only interruption only when explicitly configured', () => {
    const frames: FrameRequestCallback[] = [];
    const onInterruption = vi.fn();
    const service = createMonitoringService(frames, onInterruption, {
      requireAgentReferenceForInterruption: false,
    });

    service.startInterruptionMonitoring();
    runNextFrame(frames);
    runNextFrame(frames);

    expect(onInterruption).toHaveBeenCalledTimes(1);
  });

  it('ignores stale agent reference analyser setup after the track changes', async () => {
    const frames: FrameRequestCallback[] = [];
    installSpeechRecognitionWindow(frames);

    const service = createTranscriptionService() as unknown as ServiceInternals;
    const resolvers: Array<(context: AudioContext) => void> = [];
    const createMediaStreamSource = vi.fn();
    const analysisContext = {
      createMediaStreamSource,
      createAnalyser: vi.fn(),
    } as unknown as AudioContext;
    const referenceTrack = {
      kind: 'audio',
      readyState: 'live',
    } as MediaStreamTrack;

    service.ensureAnalysisContext = vi.fn((): Promise<AudioContext> => new Promise<AudioContext>((resolve) => {
      resolvers.push(resolve);
    }));

    service.setAgentAudioReferenceTrack(referenceTrack);
    service.setAgentAudioReferenceTrack(null);
    resolvers[0]?.(analysisContext);
    await Promise.resolve();

    expect(createMediaStreamSource).not.toHaveBeenCalled();
    expect(service.agentAnalyser).toBeNull();
  });
});
