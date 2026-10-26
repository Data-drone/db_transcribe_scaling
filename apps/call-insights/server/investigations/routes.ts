import { randomUUID } from 'node:crypto';
import type { IAppRouter } from '@databricks/appkit';
import type { Request as IAppRequest } from 'express';
import { z } from 'zod';
import { evidenceInputSchema, investigationBodySchema, type Investigation } from '../../shared/investigations';
import { HttpError, requestActor, respondError, type Actor, type DocumentStore, type StoredDocument } from './storage';
import { verifiedExcerpt, verifiedExcerptSelection, type SourceReader } from './sources';

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  question: z.string().trim().max(4000).default(''),
});
const updateSchema = createSchema.extend({ version: z.number().int().positive() });
const itemSchema = z.object({ item: evidenceInputSchema, version: z.number().int().positive() });
const shareSchema = z.object({
  emails: z.array(z.string().trim().email()).max(50),
  version: z.number().int().positive(),
});
const idSchema = z.string().uuid();

export function registerInvestigationRoutes(app: IAppRouter, store: DocumentStore | undefined, sources: SourceReader) {
  app.use('/api/investigations', (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!store) {
      res
        .status(503)
        .json({ error: 'Persistent investigations are not configured. A Lakebase resource must be connected.' });
      return;
    }
    next();
  });
  const database = () => {
    if (!store) throw new HttpError(503, 'Persistent investigations are unavailable.');
    return store;
  };
  async function required(req: IAppRequest, actor: Actor, ownerOnly = false) {
    const id = idSchema.parse(req.params.caseId);
    const record = await database().get('investigation', id, actor);
    if (!record || (ownerOnly && record.ownerId !== actor.id)) throw new HttpError(404, 'Investigation not found.');
    return record;
  }
  async function hydrate(req: IAppRequest, record: StoredDocument, actor: Actor): Promise<Investigation> {
    const body = investigationBodySchema.parse(record.body);
    const excerpts: Investigation['excerpts'] = {};
    const sourceCache = new Map<string, ReturnType<SourceReader['call']>>();
    const segmentCache = new Map<string, ReturnType<SourceReader['segments']>>();
    for (const item of body.items) {
      if (item.type !== 'clip') continue;
      if (!item.interactionId || item.start == null || item.end == null)
        throw new HttpError(409, 'Stored evidence needs repair.');
      let call = sourceCache.get(item.interactionId);
      let segments = segmentCache.get(item.interactionId);
      if (!call || !segments) {
        call = sources.call(req, item.interactionId);
        segments = sources.segments(req, item.interactionId);
        sourceCache.set(item.interactionId, call);
        segmentCache.set(item.interactionId, segments);
      }
      const [metadata, turns] = await Promise.all([call, segments]);
      if (item.end > metadata.duration_seconds)
        throw new HttpError(409, 'Saved evidence extends beyond the current source.');
      excerpts[item.id] = {
        text: verifiedExcerpt(turns, item.start, item.end),
        queue: metadata.queue,
        startedAt: metadata.started_at,
      };
    }
    return {
      ...body,
      id: record.id,
      ownerEmail: record.ownerEmail,
      sharedWith: record.sharedWith,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      version: record.version,
      canEdit: record.ownerId === actor.id,
      excerpts,
    };
  }
  app.get('/api/investigations', async (req, res) => {
    try {
      const actor = requestActor(req);
      const records = await database().list('investigation', actor);
      res.json({
        investigations: records.map((record) => {
          const body = investigationBodySchema.parse(record.body);
          return {
            id: record.id,
            title: body.title,
            question: body.question,
            ownerEmail: record.ownerEmail,
            updatedAt: record.updatedAt,
            excerptCount: body.items.filter((i) => i.type === 'clip').length,
            noteCount: body.items.filter((i) => i.type === 'note').length,
            shared: record.ownerId !== actor.id,
          };
        }),
        limit: 200,
      });
    } catch (error) {
      respondError(res, error);
    }
  });
  app.post('/api/investigations', async (req, res) => {
    try {
      const actor = requestActor(req);
      const body = createSchema.parse(req.body);
      const record = await database().put('investigation', undefined, actor, { ...body, items: [] });
      res.status(201).json(await hydrate(req, record, actor));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/investigations/:caseId', async (req, res) => {
    try {
      const actor = requestActor(req);
      res.json(await hydrate(req, await required(req, actor), actor));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.patch('/api/investigations/:caseId', async (req, res) => {
    try {
      const actor = requestActor(req);
      const input = updateSchema.parse(req.body);
      const record = await required(req, actor, true);
      const current = investigationBodySchema.parse(record.body);
      await hydrate(req, record, actor);
      const next = await database().put(
        'investigation',
        record.id,
        actor,
        { ...current, title: input.title, question: input.question },
        input.version
      );
      res.json(await hydrate(req, next, actor));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.post('/api/investigations/:caseId/items', async (req, res) => {
    try {
      const actor = requestActor(req);
      const { item, version } = itemSchema.parse(req.body);
      const record = await required(req, actor, true);
      const current = investigationBodySchema.parse(record.body);
      if (current.items.length >= 100) throw new HttpError(409, 'This investigation has reached its 100-item limit.');
      await hydrate(req, record, actor);
      let storedItem = item;
      if (item.type === 'clip') {
        const call = await sources.call(req, item.interactionId);
        if (item.end > call.duration_seconds) throw new HttpError(400, 'The excerpt ends after the conversation.');
        const selection = verifiedExcerptSelection(
          await sources.segments(req, item.interactionId),
          item.start,
          item.end
        );
        if (selection.end > call.duration_seconds)
          throw new HttpError(409, 'The transcript timing extends beyond the current conversation.');
        storedItem = { ...item, start: selection.start, end: selection.end };
      }
      const next = await database().put(
        'investigation',
        record.id,
        actor,
        {
          ...current,
          items: [
            ...current.items,
            { ...storedItem, id: randomUUID(), createdBy: actor.email, createdAt: new Date().toISOString() },
          ],
        },
        version
      );
      res.status(201).json(await hydrate(req, next, actor));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.post('/api/investigations/:caseId/share', async (req, res) => {
    try {
      const actor = requestActor(req);
      const input = shareSchema.parse(req.body);
      const record = await required(req, actor, true);
      await hydrate(req, record, actor);
      const next = await database().share('investigation', record.id, actor, input.emails, input.version);
      res.json(await hydrate(req, next, actor));
    } catch (error) {
      respondError(res, error);
    }
  });
  app.get('/api/investigations/:caseId/brief', async (req, res) => {
    try {
      const actor = requestActor(req);
      const investigation = await hydrate(req, await required(req, actor), actor);
      const body = investigationBrief(investigation, investigationOrigin(req));
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="investigation-${investigation.id}.md"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(body);
    } catch (error) {
      respondError(res, error);
    }
  });
}

/** Production exports use the configured external URL, independent of proxy and Host headers. */
export function investigationOrigin(
  req: { protocol: string; get: (name: 'host') => string | undefined },
  configured = process.env.CALL_INSIGHTS_PUBLIC_URL,
  production = process.env.NODE_ENV === 'production'
) {
  const explicit = configured?.trim();
  if (production && !explicit) throw new HttpError(503, 'The public app URL has not been configured.');
  try {
    const url = new URL(explicit || `${req.protocol}://${req.get('host')}`);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (production && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid public app origin.');
    return url.origin;
  } catch {
    throw new HttpError(503, 'The public app URL is invalid.');
  }
}

export function investigationBrief(record: Investigation, origin: string) {
  const evidence = record.items
    .map((item) => {
      if (item.type === 'note') return `### Analyst note\n\n${item.note}`;
      const params = new URLSearchParams({ t: String(item.start), from: `/cases/${record.id}` });
      const link = new URL(`/calls/${encodeURIComponent(item.interactionId ?? '')}?${params.toString()}`, origin);
      return `### ${item.interactionId} · ${item.start}–${item.end}s\n\n> ${record.excerpts[item.id]?.text ?? ''}\n\nAnalyst note: ${item.note}\n\n[Open conversation](${link.href})`;
    })
    .join('\n\n');
  return `# ${record.title}\n\n${record.question}\n\nOwner: ${record.ownerEmail}\nUpdated: ${record.updatedAt}\n\n## Evidence\n\n${evidence || 'No evidence collected yet.'}\n\n## Scope and limitations\n\nThis is a selected set of source excerpts, not an estimate of prevalence or causality. AI annotations require verification. Original audio is unredacted and remains subject to the recipient’s own source permissions. Source authorization and masking were checked at export time; exported text is a copy and will not update when access changes.\n`;
}
