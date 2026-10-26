import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from '@databricks/appkit';
import type { Request as IAppRequest } from 'express';
import { z } from 'zod';
import { HttpError, requestActor } from './storage';

export interface SourceAnalytics {
  asUser(req: IAppRequest): {
    analytics: { query(text: string, parameters?: Record<string, ReturnType<typeof sql.string>>): Promise<unknown> };
  };
}
const sourceBoolean = z
  .union([z.boolean(), z.literal('true'), z.literal('false')])
  .transform((v) => v === true || v === 'true');
const callSchema = z.object({
  interaction_id: z.string(),
  duration_seconds: z.coerce.number().finite().positive(),
  audio_path: z.string().nullable(),
  queue: z.string(),
  started_at: z.string(),
});
const segmentSchema = z.object({
  segment_idx: z.coerce.number().int(),
  start_seconds: z.coerce.number().finite().min(0),
  end_seconds: z.coerce.number().finite().positive(),
  speaker_role: z.string(),
  text: z.string().nullable(),
  is_masked: sourceBoolean,
});
export type AuthorizedCall = z.infer<typeof callSchema>;
export type AuthorizedSegment = z.infer<typeof segmentSchema>;
export interface SourceReader {
  call: (req: IAppRequest, interactionId: string) => Promise<AuthorizedCall>;
  segments: (req: IAppRequest, interactionId: string) => Promise<AuthorizedSegment[]>;
}

/** Programmatic .query accepts SQL text in AppKit0.84: load only registered fixed OBO files. */
export function createSourceReader(appkit: SourceAnalytics): SourceReader {
  const querySources = new Map<string, Promise<string>>();
  async function run(req: IAppRequest, key: 'call_detail' | 'call_segments', interactionId: string) {
    requestActor(req);
    let query = querySources.get(key);
    if (!query) {
      query = readFile(resolve(process.cwd(), 'config', 'queries', `${key}.obo.sql`), 'utf8');
      querySources.set(key, query);
    }
    const result = await appkit.asUser(req).analytics.query(await query, { interaction_id: sql.string(interactionId) });
    return z.object({ data: z.array(z.unknown()).default([]) }).parse(result).data;
  }
  return {
    async call(req, interactionId) {
      const rows = await run(req, 'call_detail', interactionId);
      if (!rows.length) throw new HttpError(404, 'The source conversation is unavailable or access is restricted.');
      return callSchema.parse(rows[0]);
    },
    async segments(req, interactionId) {
      const rows = await run(req, 'call_segments', interactionId);
      return z.array(segmentSchema).parse(rows);
    },
  };
}

export function verifiedExcerptSelection(segments: AuthorizedSegment[], start: number, end: number) {
  let bounds = { start, end };
  let selected: AuthorizedSegment[];
  // A turn expansion can overlap another speaker's turn. Reach a stable range
  // before saving so reopening cannot silently add text or discover an unmasked turn.
  while (true) {
    selected = segments.filter((s) => s.end_seconds > bounds.start && s.start_seconds < bounds.end);
    if (!selected.length) throw new HttpError(400, 'No transcript turns overlap this excerpt.');
    const next = {
      start: Math.min(...selected.map((s) => s.start_seconds)),
      end: Math.max(...selected.map((s) => s.end_seconds)),
    };
    if (next.end - next.start > 600) throw new HttpError(400, 'Choose an excerpt up to ten minutes.');
    if (next.start === bounds.start && next.end === bounds.end) break;
    bounds = next;
  }
  if (selected.some((s) => !s.is_masked || !s.text?.trim()))
    throw new HttpError(409, 'This excerpt is unavailable until its transcript is fully masked.');
  return { ...bounds, text: selected.map((s) => s.text).join(' ') };
}

export function verifiedExcerpt(segments: AuthorizedSegment[], start: number, end: number) {
  return verifiedExcerptSelection(segments, start, end).text;
}
