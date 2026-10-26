import { z } from 'zod';
import { investigationSchema, investigationSummarySchema } from '../../../../shared/investigations';

export const listSchema = z.object({ investigations: z.array(investigationSummarySchema), limit: z.number() });
export async function investigationRequest<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message = z.object({ error: z.string() }).safeParse(result);
    throw new Error(message.success ? message.data.error : `Request failed (${response.status}).`);
  }
  return schema.parse(result);
}
export const readInvestigation = (id: string, signal?: AbortSignal) =>
  investigationRequest(`/api/investigations/${encodeURIComponent(id)}`, investigationSchema, { signal });
