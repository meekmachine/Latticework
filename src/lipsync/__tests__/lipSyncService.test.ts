import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLipSyncService } from '../lipSyncService';

describe('LipSyncService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the scheduled Azure viseme snippet name for external playback', () => {
    const host = {
      scheduleSnippet: vi.fn((snippet: { name: string }) => `${snippet.name}_scheduled`),
      removeSnippet: vi.fn(),
    };

    const service = createLipSyncService({}, {}, host);
    const scheduledName = service.processAzureVisemes?.(
      [
        { visemeId: 1, time: 0 },
        { visemeId: 4, time: 0.12 },
      ],
      240
    );

    expect(scheduledName).toMatch(/^azure_lipsync_\d+_scheduled$/);
    expect(host.scheduleSnippet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.stringMatching(/^azure_lipsync_\d+$/),
      })
    );

    vi.advanceTimersByTime(440);

    expect(host.removeSnippet).toHaveBeenCalledWith(scheduledName);
    service.dispose();
  });

  it('returns to idle after scheduled word snippets complete', () => {
    const host = {
      scheduleSnippet: vi.fn((snippet: { name: string }) => snippet.name),
      removeSnippet: vi.fn(),
    };

    const service = createLipSyncService({}, {}, host);

    service.startSpeech();
    service.processWord('Hello', 0);

    expect(service.getState()).toMatchObject({
      status: 'speaking',
      wordCount: 1,
      isSpeaking: true,
    });

    service.endSpeech();
    expect(service.getState().status).toBe('ending');

    vi.advanceTimersByTime(1500);

    expect(service.getState().status).toBe('idle');
    expect(host.removeSnippet).toHaveBeenCalled();
    service.dispose();
  });

  it('does not get stuck when snippet scheduling fails', () => {
    const host = {
      scheduleSnippet: vi.fn(() => null),
      removeSnippet: vi.fn(),
    };

    const service = createLipSyncService({}, {}, host);

    service.startSpeech();
    service.processWord('Hello', 0);
    service.endSpeech();

    expect(service.getState().status).toBe('idle');
    expect(host.removeSnippet).not.toHaveBeenCalled();
    service.dispose();
  });
});
