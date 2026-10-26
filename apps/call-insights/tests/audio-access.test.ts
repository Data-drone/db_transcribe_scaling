import { createMockRequest, createMockResponse } from '@databricks/appkit/testing';
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import {
  AUDIO_VOLUME_ROOT,
  audioFilePolicy,
  boundedAudioBuffer,
  createAudioHandler,
  parseAudioRange,
  relativeAudioPath,
  type AudioDownloader,
} from '../server/investigations/audio';
import type { SourceReader } from '../server/investigations/sources';
import { HttpError } from '../server/investigations/storage';

function request(userId = 'user-a', range?: string): Request {
  return createMockRequest({
    obo: { userId, token: `token-${userId}`, email: `${userId}@example.com` },
    params: { interactionId: 'call-1' },
    headers: range ? { range } : {},
  }) as Request;
}
function stream(bytes: number[]) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}
function sources(): SourceReader {
  return {
    call: vi.fn<SourceReader['call']>().mockResolvedValue({
      interaction_id: 'call-1',
      duration_seconds: 60,
      queue: 'Payments',
      started_at: '2020-06-22',
      audio_path: `${AUDIO_VOLUME_ROOT}/audio/stereo/call-1.wav`,
    }),
    segments: vi.fn<SourceReader['segments']>().mockResolvedValue([]),
  };
}

describe('original audio authorization and byte ranges', () => {
  it('supports explicit, open-ended, and suffix ranges and rejects unsatisfiable/multipart ranges', () => {
    expect(parseAudioRange('bytes=2-4', 10)).toEqual({ start: 2, end: 4, partial: true });
    expect(parseAudioRange('bytes=7-', 10)).toEqual({ start: 7, end: 9, partial: true });
    expect(parseAudioRange('bytes=-3', 10)).toEqual({ start: 7, end: 9, partial: true });
    expect(parseAudioRange(undefined, 10)).toEqual({ start: 0, end: 9, partial: false });
    for (const range of ['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,4-5', 'items=0-2', 'bytes=9007199254740993-'])
      expect(() => parseAudioRange(range, 10)).toThrow(HttpError);
  });
  it('rejects foreign volumes, nested paths, encoded traversal, and traversal before download', () => {
    expect(relativeAudioPath(`${AUDIO_VOLUME_ROOT}/audio/stereo/call-1.wav`)).toBe('audio/stereo/call-1.wav');
    for (const path of [
      `${AUDIO_VOLUME_ROOT}/audio/stereo/../secret.wav`,
      `${AUDIO_VOLUME_ROOT}/audio/stereo/%2e%2e.wav`,
      `${AUDIO_VOLUME_ROOT}/audio/stereo/sub/file.wav`,
      '/Volumes/other/schema/volume/audio.wav',
    ])
      expect(() => relativeAudioPath(path)).toThrow(HttpError);
  });
  it('does not fetch file bytes if current source permission fails', async () => {
    const source = sources();
    source.call = vi.fn<SourceReader['call']>().mockRejectedValue(new HttpError(403, 'Source access denied.'));
    const download = vi.fn<AudioDownloader>();
    const res = createMockResponse();
    await createAudioHandler(source, download)(request(), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(download).not.toHaveBeenCalled();
  });
  it('rejects missing caller credentials instead of falling back to the app identity', async () => {
    const source = sources();
    const download = vi.fn<AudioDownloader>();
    const res = createMockResponse();
    await createAudioHandler(source, download)(
      createMockRequest({ params: { interactionId: 'call-1' } }) as Request,
      res
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(source.call).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
  it('serves only requested bytes and opens file access only within the correct authorized user/path scope', async () => {
    const source = sources();
    const res = createMockResponse();
    const resource = { volume: 'audio', path: 'audio/stereo/call-1.wav' };
    expect(await audioFilePolicy('download', resource, { id: 'user-a' })).toBe(false);
    const download = vi.fn(async () => {
      expect(await audioFilePolicy('download', resource, { id: 'user-a' })).toBe(true);
      expect(await audioFilePolicy('download', resource, { id: 'user-b' })).toBe(false);
      expect(await audioFilePolicy('raw', resource, { id: 'user-a' })).toBe(false);
      expect(await audioFilePolicy('download', resource, { id: 'user-a', isServicePrincipal: true })).toBe(false);
      expect(await audioFilePolicy('download', { ...resource, path: 'audio/stereo/other.wav' }, { id: 'user-a' })).toBe(
        false
      );
      return { contents: stream([0, 1, 2, 3, 4, 5, 6, 7]) };
    });
    await createAudioHandler(source, download)(request('user-a', 'bytes=2-5'), res);
    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 2-5/8');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.end).toHaveBeenCalledWith(Buffer.from([2, 3, 4, 5]));
    expect(await audioFilePolicy('download', resource, { id: 'user-a' })).toBe(false);
  });
  it('rechecks source permission for every byte-range request and responds 416 with total size', async () => {
    const source = sources();
    const download = vi
      .fn<AudioDownloader>()
      .mockImplementation(() => Promise.resolve({ contents: stream([0, 1, 2]) }));
    const handler = createAudioHandler(source, download);
    const first = createMockResponse();
    const second = createMockResponse();
    await handler(request('user-a', 'bytes=0-1'), first);
    await handler(request('user-a', 'bytes=9-'), second);
    expect(source.call).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledTimes(2);
    expect(second.status).toHaveBeenCalledWith(416);
    expect(second.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes */3');
  });
  it('cancels an oversized recording stream before buffering it completely', async () => {
    const cancel = vi.fn();
    const contents = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel,
    });
    await expect(boundedAudioBuffer({ contents }, 4)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
