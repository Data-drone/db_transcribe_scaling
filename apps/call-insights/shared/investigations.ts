import { z } from 'zod';

export const clipInputSchema = z
  .object({
    type: z.literal('clip'),
    interactionId: z.string().trim().min(1).max(200),
    start: z.number().finite().min(0),
    end: z.number().finite().positive(),
    note: z.string().trim().min(1).max(4000),
  })
  .refine((value) => value.end > value.start && value.end - value.start <= 600, 'Choose an excerpt up to ten minutes.');
export const noteInputSchema = z.object({ type: z.literal('note'), note: z.string().trim().min(1).max(4000) });
export const evidenceInputSchema = z.union([clipInputSchema, noteInputSchema]);
export const evidenceItemSchema = z.object({
  id: z.string(),
  type: z.enum(['clip', 'note']),
  interactionId: z.string().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
  note: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export const investigationBodySchema = z.object({
  title: z.string().trim().min(1).max(160),
  question: z.string().max(4000).default(''),
  items: z.array(evidenceItemSchema).max(100),
});
export const investigationSchema = investigationBodySchema.extend({
  id: z.string(),
  ownerEmail: z.string(),
  sharedWith: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
  canEdit: z.boolean(),
  excerpts: z.record(z.string(), z.object({ text: z.string(), queue: z.string(), startedAt: z.string() })).default({}),
});
export const investigationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  question: z.string(),
  ownerEmail: z.string(),
  updatedAt: z.string(),
  excerptCount: z.number(),
  noteCount: z.number(),
  shared: z.boolean(),
});
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;
export type InvestigationBody = z.infer<typeof investigationBodySchema>;
export type Investigation = z.infer<typeof investigationSchema>;
export type InvestigationSummary = z.infer<typeof investigationSummarySchema>;
