import { randomUUID } from 'node:crypto';
import type { Request as IAppRequest, Response as IAppResponse } from 'express';
import { z } from 'zod';

export type Actor = { id: string; email: string };
export type StoredDocument = {
  id: string;
  kind: string;
  ownerId: string;
  ownerEmail: string;
  sharedWith: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
  body: unknown;
};
export interface DocumentStore {
  list: (kind: string, actor: Actor) => Promise<StoredDocument[]>;
  get: (kind: string, id: string, actor: Actor) => Promise<StoredDocument | null>;
  put: (
    kind: string,
    id: string | undefined,
    actor: Actor,
    body: unknown,
    expectedVersion?: number
  ) => Promise<StoredDocument>;
  share: (
    kind: string,
    id: string,
    actor: Actor,
    emails: string[],
    expectedVersion?: number
  ) => Promise<StoredDocument>;
}
export interface AppStateDatabase {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/** Only trusted Databricks Apps proxy headers may establish this identity. */
export function requestActor(req: IAppRequest): Actor {
  const id = req.header('x-forwarded-user')?.trim();
  const token = req.header('x-forwarded-access-token')?.trim();
  const email = z.string().trim().email().safeParse(req.header('x-forwarded-email'));
  if (!id || !token || !email.success) throw new HttpError(401, 'A signed-in user identity and email are required.');
  return { id, email: email.data.toLowerCase() };
}
export function respondError(res: Pick<IAppResponse, 'status'>, error: unknown) {
  const status = error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500;
  const message =
    error instanceof HttpError
      ? error.message
      : error instanceof z.ZodError
        ? 'Invalid request.'
        : 'The request could not be completed.';
  res.status(status).json({ error: message });
}

const timestamp = z.union([z.string(), z.date()]).transform((value) => new Date(value).toISOString());
const documentRow = z.object({
  id: z.string(),
  kind: z.string(),
  owner_id: z.string(),
  owner_email: z.string(),
  shared_with: z.array(z.string().email()),
  created_at: timestamp,
  updated_at: timestamp,
  version: z.coerce.number().int().positive(),
  body: z.unknown(),
});
function fromRow(value: unknown): StoredDocument {
  const row = documentRow.parse(value);
  return {
    id: row.id,
    kind: row.kind,
    ownerId: row.owner_id,
    ownerEmail: row.owner_email,
    sharedWith: row.shared_with,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    body: row.body,
  };
}
function serializedBody(body: unknown) {
  const encoded = JSON.stringify(body);
  if (!encoded || Buffer.byteLength(encoded) > 1_000_000) throw new HttpError(413, 'The saved document is too large.');
  return encoded;
}

/** Invoke only after the approved Lakebase database is bound, using the app SP. */
export async function initializeAppState(database: AppStateDatabase) {
  await database.query('CREATE SCHEMA IF NOT EXISTS call_insights_app');
  await database.query(`CREATE TABLE IF NOT EXISTS call_insights_app.documents (
    id TEXT NOT NULL, kind TEXT NOT NULL, owner_id TEXT NOT NULL, owner_email TEXT NOT NULL,
    shared_with JSONB NOT NULL DEFAULT '[]'::jsonb,
    body JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (kind, id)
  )`);
  await database.query(
    'CREATE INDEX IF NOT EXISTS documents_owner ON call_insights_app.documents (kind, owner_id, updated_at DESC)'
  );
}

/** App-only Lakebase calls stay outside appkit.asUser scopes. ACLs are enforced in every statement. */
export function createLakebaseDocumentStore(database: AppStateDatabase): DocumentStore {
  const get: DocumentStore['get'] = async (kind, id, actor) => {
    const result = await database.query(
      `SELECT * FROM call_insights_app.documents
      WHERE kind=$1 AND id=$2 AND (owner_id=$3 OR shared_with @> $4::jsonb)`,
      [kind, id, actor.id, JSON.stringify([actor.email])]
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  };
  return {
    get,
    async list(kind, actor) {
      const result = await database.query(
        `SELECT * FROM call_insights_app.documents
        WHERE kind=$1 AND (owner_id=$2 OR shared_with @> $3::jsonb)
        ORDER BY updated_at DESC, id LIMIT 200`,
        [kind, actor.id, JSON.stringify([actor.email])]
      );
      return result.rows.map(fromRow);
    },
    async put(kind, id, actor, body, expectedVersion) {
      const encoded = serializedBody(body);
      if (!id) {
        const result = await database.query(
          `INSERT INTO call_insights_app.documents
          (id,kind,owner_id,owner_email,body) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
          [randomUUID(), kind, actor.id, actor.email, encoded]
        );
        return fromRow(result.rows[0]);
      }
      const current = await get(kind, id, actor);
      if (!current || current.ownerId !== actor.id) throw new HttpError(404, 'Document not found.');
      const result = await database.query(
        `UPDATE call_insights_app.documents SET body=$1::jsonb,
        version=version+1,updated_at=NOW() WHERE kind=$2 AND id=$3 AND owner_id=$4 AND version=$5 RETURNING *`,
        [encoded, kind, id, actor.id, expectedVersion ?? current.version]
      );
      if (!result.rows[0]) throw new HttpError(409, 'This document changed. Reload and try again.');
      return fromRow(result.rows[0]);
    },
    async share(kind, id, actor, emails, expectedVersion) {
      const sharedWith = [
        ...new Set(
          z
            .array(
              z
                .string()
                .trim()
                .email()
                .transform((v) => v.toLowerCase())
            )
            .max(50)
            .parse(emails)
        ),
      ];
      const current = await get(kind, id, actor);
      if (!current || current.ownerId !== actor.id) throw new HttpError(404, 'Document not found.');
      const result = await database.query(
        `UPDATE call_insights_app.documents SET shared_with=$1::jsonb,
        version=version+1,updated_at=NOW() WHERE kind=$2 AND id=$3 AND owner_id=$4 AND version=$5 RETURNING *`,
        [JSON.stringify(sharedWith), kind, id, actor.id, expectedVersion ?? current.version]
      );
      if (!result.rows[0]) throw new HttpError(409, 'This document changed. Reload and try again.');
      return fromRow(result.rows[0]);
    },
  };
}
