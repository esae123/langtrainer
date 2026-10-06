import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shareOrDownloadFile } from '../shareFile';

type ShareCapableNavigator = Omit<Navigator, 'canShare' | 'share'> & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
};

function setShareSupport(options: {
  canShare: boolean | (() => boolean);
  share: (data: ShareData) => Promise<void>;
}) {
  const nav = navigator as ShareCapableNavigator;
  nav.canShare =
    typeof options.canShare === 'function' ? options.canShare : () => options.canShare as boolean;
  nav.share = options.share;
}

function clearShareSupport() {
  const nav = navigator as ShareCapableNavigator;
  nav.canShare = undefined;
  nav.share = undefined;
}

describe('shareOrDownloadFile', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    revokeObjectURLSpy = vi.fn();
    URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clearShareSupport();
    clickSpy.mockRestore();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shares with text/plain so Chrome Android accepts the file, keeping the .json name', async () => {
    let sharedFile: File | undefined;
    setShareSupport({
      canShare: true,
      share: async (data) => {
        sharedFile = data.files?.[0];
      },
    });

    const outcome = await shareOrDownloadFile('{"a":1}', 'langtrainer-backup-2026-10-06.json');

    expect(outcome).toBe('shared');
    expect(sharedFile).toBeDefined();
    expect(sharedFile?.type).toBe('text/plain');
    expect(sharedFile?.name).toMatch(/\.json$/);
  });

  it('falls back to download and returns "downloaded" when share rejects with NotAllowedError', async () => {
    setShareSupport({
      canShare: true,
      share: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      },
    });

    const outcome = await shareOrDownloadFile('{"a":1}', 'backup.json');

    expect(outcome).toBe('downloaded');
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('returns "cancelled" when share rejects with AbortError, without falling back to download', async () => {
    setShareSupport({
      canShare: true,
      share: async () => {
        throw new DOMException('Share canceled', 'AbortError');
      },
    });

    const outcome = await shareOrDownloadFile('{"a":1}', 'backup.json');

    expect(outcome).toBe('cancelled');
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it('falls back to download when canShare throws', async () => {
    const nav = navigator as ShareCapableNavigator;
    nav.share = async () => {};
    nav.canShare = () => {
      throw new TypeError('canShare blew up');
    };

    const outcome = await shareOrDownloadFile('{"a":1}', 'backup.json');

    expect(outcome).toBe('downloaded');
    expect(createObjectURLSpy).toHaveBeenCalled();
  });

  it('falls back to download when the Web Share API is unavailable', async () => {
    clearShareSupport();

    const outcome = await shareOrDownloadFile('{"a":1}', 'backup.json');

    expect(outcome).toBe('downloaded');
    expect(createObjectURLSpy).toHaveBeenCalled();
  });

  it('revokes the object URL after a delay rather than on the next tick', async () => {
    clearShareSupport();

    await shareOrDownloadFile('{"a":1}', 'backup.json');

    expect(revokeObjectURLSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('builds the download fallback file with the caller-provided MIME type', async () => {
    clearShareSupport();
    const fileSpy = vi.spyOn(globalThis, 'File');

    await shareOrDownloadFile('{"a":1}', 'backup.json', 'application/json');

    const downloadFileCall = fileSpy.mock.calls.find((call) => call[2]?.type === 'application/json');
    expect(downloadFileCall).toBeDefined();
  });
});
