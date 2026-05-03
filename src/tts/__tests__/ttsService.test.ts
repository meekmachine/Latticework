import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTTSService, type TTSService } from '../ttsService';
import type { PlaybackReferenceStatus, TTSCallbacks } from '../types';

type MockTrack = MediaStreamTrack & {
  onended: ((event?: Event) => void) | null;
  stop: ReturnType<typeof vi.fn>;
};

function createMockTrack(kind: 'audio' | 'video' = 'audio'): MockTrack {
  return {
    kind,
    readyState: 'live',
    onended: null,
    stop: vi.fn(),
  } as unknown as MockTrack;
}

function createMockStream(tracks: MockTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
  } as unknown as MediaStream;
}

function createDisplayReferenceService(callbacks: TTSCallbacks = {}): TTSService {
  return createTTSService(
    {
      engine: 'webSpeech',
      backendUrl: 'http://localhost.test',
      webSpeechReferenceMode: 'displayMedia',
    },
    callbacks
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TTSService Web Speech display-media playback reference', () => {
  it('prepares a display audio reference and clears it when capture ends', async () => {
    const audioTrack = createMockTrack('audio');
    const videoTrack = createMockTrack('video');
    const stream = createMockStream([audioTrack, videoTrack]);
    const statuses: PlaybackReferenceStatus[] = [];
    const trackEvents: Array<MediaStreamTrack | null> = [];
    const getDisplayMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });

    const service = createDisplayReferenceService({
      onPlaybackReferenceStatusChange: (status) => statuses.push(status),
    });
    service.onPlaybackReferenceTrackChange((track) => trackEvents.push(track));

    await expect(service.preparePlaybackReference()).resolves.toBe('available');

    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(service.getPlaybackReferenceTrack()).toBe(audioTrack);
    expect(statuses).toEqual(['requesting', 'available']);
    expect(trackEvents).toEqual([null, audioTrack]);

    audioTrack.onended?.();

    expect(service.getPlaybackReferenceTrack()).toBeNull();
    expect(service.getPlaybackReferenceStatus()).toBe('ended');
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(trackEvents[trackEvents.length - 1]).toBeNull();
  });

  it('reports no-audio and stops the capture stream when display capture has no audio track', async () => {
    const videoTrack = createMockTrack('video');
    const stream = createMockStream([videoTrack]);
    const getDisplayMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });

    const service = createDisplayReferenceService();

    await expect(service.preparePlaybackReference()).resolves.toBe('no-audio');

    expect(service.getPlaybackReferenceTrack()).toBeNull();
    expect(service.getPlaybackReferenceStatus()).toBe('no-audio');
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
  });

  it('reports denied when the user rejects display capture', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });

    const service = createDisplayReferenceService();

    await expect(service.preparePlaybackReference()).resolves.toBe('denied');

    expect(service.getPlaybackReferenceTrack()).toBeNull();
    expect(service.getPlaybackReferenceStatus()).toBe('denied');
  });

  it('does not prompt for display capture from the Web Speech speak path', async () => {
    const getDisplayMedia = vi.fn();
    const speak = vi.fn((utterance: SpeechSynthesisUtterance) => {
      utterance.onstart?.(new Event('start') as SpeechSynthesisEvent);
      utterance.onend?.(new Event('end') as SpeechSynthesisEvent);
    });
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      public rate = 1;
      public pitch = 1;
      public volume = 1;
      public voice: SpeechSynthesisVoice | null = null;
      public onstart: ((event: SpeechSynthesisEvent) => void) | null = null;
      public onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      public onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
      public onboundary: ((event: SpeechSynthesisEvent) => void) | null = null;

      constructor(public text: string) {}
    });

    const service = createDisplayReferenceService();
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
    });
    (service as unknown as { synthesis: SpeechSynthesis }).synthesis = {
      speak,
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      paused: false,
      pending: false,
      speaking: false,
      onvoiceschanged: null,
      dispatchEvent: vi.fn(),
    } as unknown as SpeechSynthesis;

    await expect(service.speak('hello')).resolves.toEqual({ interrupted: false });

    expect(speak).toHaveBeenCalledTimes(1);
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });

  it('uses configured Web Speech language and exact male French voice name', async () => {
    let capturedUtterance: SpeechSynthesisUtterance | null = null;
    const thomasVoice = {
      name: 'Thomas',
      lang: 'fr-FR',
      localService: false,
      default: false,
    } as SpeechSynthesisVoice;
    const englishVoice = {
      name: 'Alex',
      lang: 'en-US',
      localService: true,
      default: true,
    } as SpeechSynthesisVoice;
    const speak = vi.fn((utterance: SpeechSynthesisUtterance) => {
      capturedUtterance = utterance;
      utterance.onstart?.(new Event('start') as SpeechSynthesisEvent);
      utterance.onend?.(new Event('end') as SpeechSynthesisEvent);
    });
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      public lang = '';
      public rate = 1;
      public pitch = 1;
      public volume = 1;
      public voice: SpeechSynthesisVoice | null = null;
      public onstart: ((event: SpeechSynthesisEvent) => void) | null = null;
      public onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      public onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
      public onboundary: ((event: SpeechSynthesisEvent) => void) | null = null;

      constructor(public text: string) {}
    });

    const service = createTTSService({
      engine: 'webSpeech',
      backendUrl: 'http://localhost.test',
      lang: 'fr-FR',
      voiceName: 'Thomas',
    });
    (service as unknown as { voices: SpeechSynthesisVoice[]; synthesis: SpeechSynthesis }).voices = [englishVoice, thomasVoice];
    (service as unknown as { synthesis: SpeechSynthesis }).synthesis = {
      speak,
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      getVoices: () => [englishVoice, thomasVoice],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      paused: false,
      pending: false,
      speaking: false,
      onvoiceschanged: null,
      dispatchEvent: vi.fn(),
    } as unknown as SpeechSynthesis;

    await expect(service.speak('bonjour')).resolves.toEqual({ interrupted: false });

    expect(capturedUtterance?.lang).toBe('fr-FR');
    expect(capturedUtterance?.voice).toBe(thomasVoice);
  });
});
