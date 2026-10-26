import { getWorkspaceClient, ServiceContext } from '@databricks/appkit';
import { z } from 'zod';
import { HttpError } from '../investigations/storage.js';
import type { LabelJobRunner } from './routes.js';

export type { LabelJobRunner } from './routes.js';

type LabelJobRequest = { job_id: number; job_parameters: { run_id: string } };
export type LabelJobClient = {
  jobs: { runNow: (request: LabelJobRequest) => Promise<{ run_id?: number }> };
};

function appClient(): LabelJobClient {
  // In 0.84 the public export is Lakebase's getWorkspaceClient(config), although
  // execution-context docs describe a current-context helper. Pass the public
  // ServiceContext's explicit app client to avoid its SDK default-auth fallback.
  return getWorkspaceClient({ workspaceClient: ServiceContext.get().client.toLegacyWorkspaceClient() });
}

/** Submit only persisted run IDs; this adapter does not install Jobs HTTP routes. */
export function createLabelJobRunner(getClient: () => LabelJobClient = appClient): LabelJobRunner {
  return async (input) => {
    const runId = z.uuid().parse(input);
    const configured = process.env.DATABRICKS_JOB_LABELS?.trim();
    const jobId = configured && /^[1-9]\d*$/.test(configured) ? Number(configured) : NaN;
    if (!Number.isSafeInteger(jobId)) throw new HttpError(503, 'The label worker has not been configured.');

    try {
      const result = await getClient().jobs.runNow({ job_id: jobId, job_parameters: { run_id: runId } });
      if (!Number.isSafeInteger(result.run_id) || !result.run_id || result.run_id <= 0)
        throw new Error('The worker returned no valid run ID.');
      return { jobRunId: result.run_id };
    } catch {
      throw new HttpError(502, 'The label worker could not be started.');
    }
  };
}
