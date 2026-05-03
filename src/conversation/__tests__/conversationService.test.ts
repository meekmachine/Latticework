import { describe, expect, it, vi } from 'vitest';
import { createConversationService } from '../conversationService';
import type { ConversationFlow } from '../types';
import type { InterruptionEvent } from '../../transcription/types';
import type { TranscriptionService } from '../../transcription/transcriptionService';
import type { TTSService } from '../../tts/ttsService';
import type { SpeakResult } from '../../tts/types';

class FakeTTS {
  public stop = vi.fn(() => {
    this.resolveSpeech?.({ interrupted: true });
  });

  private playbackStartListeners = new Set<() => void>();
  private playbackReferenceTrackListeners = new Set<(track: MediaStreamTrack | null) => void>();
  private resolveSpeech: ((result: SpeakResult) => void) | null = null;
  private playbackReferenceTrack: MediaStreamTrack | null = null;

  public speak = vi.fn(() => new Promise<SpeakResult>((resolve) => {
    this.resolveSpeech = resolve;
  }));

  public onPlaybackStart(listener: () => void): () => void {
    this.playbackStartListeners.add(listener);
    return () => {
      this.playbackStartListeners.delete(listener);
    };
  }

  public emitPlaybackStart(): void {
    this.playbackStartListeners.forEach((listener) => listener());
  }

  public getPlaybackReferenceTrack(): MediaStreamTrack | null {
    return this.playbackReferenceTrack;
  }

  public setPlaybackReferenceTrack(track: MediaStreamTrack | null): void {
    this.playbackReferenceTrack = track;
    this.playbackReferenceTrackListeners.forEach((listener) => listener(track));
  }

  public onPlaybackReferenceTrackChange(listener: (track: MediaStreamTrack | null) => void): () => void {
    this.playbackReferenceTrackListeners.add(listener);
    listener(this.playbackReferenceTrack);
    return () => {
      this.playbackReferenceTrackListeners.delete(listener);
    };
  }
}

class FakeTranscription {
  public startListening = vi.fn(async () => undefined);
  public stopListening = vi.fn();
  public prepareAgentSpeech = vi.fn();
  public notifyAgentSpeech = vi.fn();
  public notifyAgentSpeechEnd = vi.fn();
  public setAgentAudioReferenceTrack = vi.fn();

  private transcriptListeners = new Set<(transcript: string, isFinal: boolean) => void>();
  private interruptionListeners = new Set<(event: InterruptionEvent) => void>();

  public getState(): { status: 'idle' | 'listening' } {
    return { status: 'listening' };
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

  public emitTranscript(transcript: string, isFinal = true): void {
    this.transcriptListeners.forEach((listener) => listener(transcript, isFinal));
  }

  public emitInterruption(event: InterruptionEvent = {
    timestamp: Date.now(),
    microphoneLevel: 0.1,
    referenceLevel: 0.01,
    requiredLevel: 0.03,
  }): void {
    this.interruptionListeners.forEach((listener) => listener(event));
  }

  public listenerCount(): number {
    return this.transcriptListeners.size + this.interruptionListeners.size;
  }
}

function asTTS(fake: FakeTTS): TTSService {
  return fake as unknown as TTSService;
}

function asTranscription(fake: FakeTranscription): TranscriptionService {
  return fake as unknown as TranscriptionService;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ConversationService interruption orchestration', () => {
  it('stops TTS when transcription emits an audio interruption', async () => {
    const tts = new FakeTTS();
    const transcription = new FakeTranscription();
    const service = createConversationService(
      asTTS(tts),
      asTranscription(transcription),
      { minSpeakTime: 0 }
    );

    service.start(function* flow(): ConversationFlow {
      yield 'Bonjour';
    });
    await flushPromises();

    tts.emitPlaybackStart();
    transcription.emitInterruption();

    expect(tts.stop).toHaveBeenCalledTimes(1);
    expect(service.getState().state).toBe('interrupted');
  });

  it('processes the final transcript once after an audio interruption', async () => {
    const tts = new FakeTTS();
    const transcription = new FakeTranscription();
    const userInputs: string[] = [];
    const service = createConversationService(
      asTTS(tts),
      asTranscription(transcription),
      { minSpeakTime: 0 }
    );

    service.start(function* flow(): ConversationFlow {
      const answer = yield 'Question';
      userInputs.push(answer);
      yield 'Merci';
    });
    await flushPromises();

    tts.emitPlaybackStart();
    transcription.emitInterruption();
    transcription.emitTranscript('bonjour', true);
    await flushPromises();

    expect(userInputs).toEqual(['bonjour']);
  });

  it('does not stop TTS from transcript-only speech by default', async () => {
    const tts = new FakeTTS();
    const transcription = new FakeTranscription();
    const userInputs: string[] = [];
    const service = createConversationService(
      asTTS(tts),
      asTranscription(transcription),
      { minSpeakTime: 0 }
    );

    service.start(function* flow(): ConversationFlow {
      const answer = yield 'Question';
      userInputs.push(answer);
    });
    await flushPromises();

    tts.emitPlaybackStart();
    transcription.emitTranscript('agent echo that slipped past filtering', true);
    await flushPromises();

    expect(tts.stop).not.toHaveBeenCalled();
    expect(userInputs).toEqual([]);
  });

  it('resyncs playback reference when TTS exposes a new track', async () => {
    const tts = new FakeTTS();
    const transcription = new FakeTranscription();
    const referenceTrack = { kind: 'audio', readyState: 'live' } as MediaStreamTrack;

    createConversationService(
      asTTS(tts),
      asTranscription(transcription)
    );

    expect(transcription.setAgentAudioReferenceTrack).toHaveBeenLastCalledWith(null);

    tts.setPlaybackReferenceTrack(referenceTrack);

    expect(transcription.setAgentAudioReferenceTrack).toHaveBeenLastCalledWith(referenceTrack);
  });

  it('removes transcription listeners on dispose', () => {
    const transcription = new FakeTranscription();
    const firstService = createConversationService(
      asTTS(new FakeTTS()),
      asTranscription(transcription)
    );

    expect(transcription.listenerCount()).toBe(2);

    firstService.dispose();

    expect(transcription.listenerCount()).toBe(0);

    createConversationService(
      asTTS(new FakeTTS()),
      asTranscription(transcription)
    );

    expect(transcription.listenerCount()).toBe(2);
  });
});
