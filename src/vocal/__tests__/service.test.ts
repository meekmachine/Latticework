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
});
