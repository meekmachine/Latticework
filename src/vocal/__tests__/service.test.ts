import { afterEach, describe, expect, it, vi } from 'vitest';
import { VocalService } from '../service';

describe('VocalService word-boundary sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not seek when drift stays within the threshold', () => {
    const seek = vi.fn();
    const service = new VocalService({
      animationAgency: {
        schedule: () => 'snippet',
        remove: vi.fn(),
        seek,
      },
    });

    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(20);

    service.startSentence('hello world');
    service.onWordBoundary('hello', 0);

    expect(seek).not.toHaveBeenCalled();
    service.dispose();
  });

  it('seeks the active snippet when drift grows too large', () => {
    const seek = vi.fn();
    const service = new VocalService({
      animationAgency: {
        schedule: () => 'snippet',
        remove: vi.fn(),
        seek,
      },
    });

    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(250);

    service.startSentence('hello world');
    service.onWordBoundary('hello', 0);

    expect(seek).toHaveBeenCalledWith('snippet', 0.25);
    service.dispose();
  });

  it('uses observed playback elapsed time when provided by the TTS engine', () => {
    const seek = vi.fn();
    const service = new VocalService({
      animationAgency: {
        schedule: () => 'snippet',
        remove: vi.fn(),
        seek,
      },
    });

    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10);

    service.startSentence('hello world');
    service.onWordBoundary('hello', 0, 0.25);

    expect(seek).toHaveBeenCalledWith('snippet', 0.25);
    service.dispose();
  });

  it('starts external timelines with provider word timings for drift correction', () => {
    const seek = vi.fn();
    const scheduled: any[] = [];
    const service = new VocalService({
      animationAgency: {
        schedule: (snippet) => {
          scheduled.push(snippet);
          return snippet.name;
        },
        remove: vi.fn(),
        seek,
      },
    });

    vi.spyOn(performance, 'now').mockReturnValue(0);

    const name = service.startTimeline({
      name: 'azure_test_timeline',
      text: 'hello',
      source: 'azure',
      durationSec: 1.2,
      visemes: [
        { visemeId: 1, offsetMs: 0, durationMs: 300 },
      ],
      wordTimings: [
        { word: 'hello', startSec: 0.2, endSec: 0.5 },
      ],
    });

    expect(name).toBe('azure_test_timeline');
    expect(scheduled[0].maxTime).toBe(1.2);

    service.onWordBoundary('hello', 0, 0.34);

    expect(seek).toHaveBeenCalledWith('azure_test_timeline', 0.34);
    service.dispose();
  });
});
