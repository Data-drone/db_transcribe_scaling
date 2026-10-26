import { AsyncLocalStorage } from 'node:async_hooks';
import { posix } from 'node:path';
import type { FilePolicy } from '@databricks/appkit';
import type { Request, Response } from 'express';
import { HttpError, requestActor, respondError } from './storage';
import type { SourceReader } from './sources';

export const AUDIO_VOLUME_ROOT = '/Volumes/serverless_stable_prvwqx_catalog/call_insights/hvb_raw';
export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const authorizedDownload = new AsyncLocalStorage<{ actorId: string; path: string }>();

/** Deny generic Files HTTP routes; only the source-authorized audio business operation opens this scope. */
export const audioFilePolicy: FilePolicy = (action, resource, user) => {
  const authorization = authorizedDownload.getStore();
  return Boolean(
    authorization &&
      action === 'download' &&
      resource.volume === 'audio' &&
      resource.path === authorization.path &&
      user.id === authorization.actorId &&
      !user.isServicePrincipal
  );
};

/**
 * AppKit 0.84 still validates the static Files alias, and auto-discovers every
 * DATABRICKS_VOLUME_* value. Configure each alias explicitly so none inherits
 * publicRead(). The compatibility `files` alias has no usable operation.
 */
export function audioFilesConfiguration() {
  const aliases = new Set(['files', 'audio']);
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('DATABRICKS_VOLUME_') && key.length > 18 && process.env[key])
      aliases.add(key.slice(18).toLowerCase());
  }
  const deny: FilePolicy = () => false;
  const volumes: Record<string, { auth: 'on-behalf-of-user'; policy: FilePolicy }> = {};
  for (const alias of aliases) volumes[alias] = { auth: 'on-behalf-of-user', policy: deny };
  volumes.audio = { auth: 'on-behalf-of-user', policy: audioFilePolicy };
  return { auth: 'on-behalf-of-user' as const, volumes };
}

export function relativeAudioPath(sourcePath: string | null) {
  const prefix = `${AUDIO_VOLUME_ROOT}/audio/stereo/`;
  if (
    !sourcePath ||
    !sourcePath.startsWith(prefix) ||
    sourcePath.includes('%') ||
    sourcePath.includes('\\') ||
    sourcePath.includes('\0') ||
    posix.normalize(sourcePath) !== sourcePath ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.wav$/i.test(sourcePath.slice(prefix.length))
  ) {
    throw new HttpError(404, 'Original audio is unavailable for this conversation.');
  }
  return sourcePath.slice(AUDIO_VOLUME_ROOT.length + 1);
}

export function parseAudioRange(range: string | undefined, size: number) {
  if (!range) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2]) || !size) throw new HttpError(416, 'Requested audio range is unavailable.');
  const suffix = !match[1];
  const start = suffix ? Math.max(size - Number(match[2]), 0) : Number(match[1]);
  const end = suffix || !match[2] ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start ||
    (suffix && Number(match[2]) === 0)
  ) {
    throw new HttpError(416, 'Requested audio range is unavailable.');
  }
  return { start, end, partial: true };
}

export type AudioDownload = { contents?: ReadableStream<unknown>; 'content-length'?: number };
export type AudioDownloader = (req: Request, relativePath: string) => Promise<AudioDownload>;

export async function boundedAudioBuffer(download: AudioDownload, maxBytes = MAX_AUDIO_BYTES) {
  if (!download.contents) throw new HttpError(404, 'Original audio is unavailable.');
  const reader = download.contents.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    if ((download['content-length'] ?? 0) > maxBytes)
      throw new HttpError(413, 'This recording exceeds the audio preview limit.');
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw new HttpError(502, 'The recording stream is invalid.');
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new HttpError(413, 'This recording exceeds the audio preview limit.');
      chunks.push(Buffer.from(chunk.value));
    }
    if (!bytes) throw new HttpError(404, 'Original audio is empty.');
    return Buffer.concat(chunks, bytes);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Re-check SQL and UC file permissions for every request, including every Range request. No shared byte cache. */
export function createAudioHandler(sources: SourceReader, download: AudioDownloader) {
  return async (req: Request, res: Pick<Response, 'setHeader' | 'status' | 'end'>) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let size: number | undefined;
    try {
      const actor = requestActor(req);
      const interactionId = req.params.interactionId;
      if (typeof interactionId !== 'string' || !interactionId || interactionId.length > 200)
        throw new HttpError(400, 'Invalid conversation.');
      const source = await sources.call(req, interactionId);
      const path = relativeAudioPath(source.audio_path);
      const bytes = await authorizedDownload.run({ actorId: actor.id, path }, async () =>
        boundedAudioBuffer(await download(req, path))
      );
      size = bytes.length;
      const range = parseAudioRange(req.header('Range'), size);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', String(range.end - range.start + 1));
      if (range.partial) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.status(range.partial ? 206 : 200).end(bytes.subarray(range.start, range.end + 1));
    } catch (error) {
      if (error instanceof HttpError && error.status === 416 && size != null)
        res.setHeader('Content-Range', `bytes */${size}`);
      respondError(res, error);
    }
  };
}
