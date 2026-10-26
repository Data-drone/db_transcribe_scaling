import { z } from 'zod';

export const labelInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  definition: z.string().trim().min(10).max(6000),
  includeExamples: z.string().max(2000).default(''),
  excludeExamples: z.string().max(2000).default(''),
  speakerFocus: z.enum(['any', 'agent', 'customer']).default('any'),
  queue: z.string().max(120).default(''),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('1900-01-01'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('9999-12-31'),
}).refine((value) => value.startDate <= value.endDate, { message: 'Start date must precede end date', path: ['endDate'] });
export type LabelInput = z.infer<typeof labelInputSchema>;
export const labelRevisionSchema = labelInputSchema.safeExtend({ version: z.number().int().positive(), createdAt: z.string(), promptHash: z.string() });
export type LabelRevision = z.infer<typeof labelRevisionSchema>;
export const labelRecordSchema = z.object({ id: z.string(), currentVersion: z.number().int().positive(), versions: z.array(labelRevisionSchema).min(1) });
export type LabelRecord = z.infer<typeof labelRecordSchema>;
export type IntelligenceLabel = LabelRecord & { ownerEmail: string; documentVersion: number; updatedAt: string };
export type LabelRun = {
  run_id: string; label_id: string; version: number; run_type: string; status: string;
  interactions_in_scope: number; processed_count: number; matched_count: number; error_count: number;
  ungrounded_count: number; estimated_tokens: number; started_at: string; finished_at: string;
  model_endpoint: string; error_message: string; job_run_id: string;
};
export type LabelResult = {
  interaction_id: string; queue: string; agent_name: string; started_at: string;
  matched: boolean; confidence: string; evidence_quote: string; evidence_start_seconds: number;
  grounded: boolean; reason: string; error_message: string; verdict: string;
};
export type RunEstimate = { cohortId: string; count: number; estimatedTokens: number; maxInteractions: number; modelEndpoint: string; inputCost: number | null; outputCost: number | null; costCurrency: string; scope: LabelInput; expiresAt: string };
