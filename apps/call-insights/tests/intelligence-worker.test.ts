import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceContext } from '@databricks/appkit';
import { createLabelJobRunner, type LabelJobClient } from '../server/intelligence/worker';

const runId = '0b45762b-55e1-4b7b-b1f7-b8c7fb686176';

function client() {
  const runNow = vi.fn<LabelJobClient['jobs']['runNow']>().mockResolvedValue({ run_id: 123 });
  const getClient = vi.fn<() => LabelJobClient>().mockReturnValue({ jobs: { runNow } });
  return { runNow, getClient, run: createLabelJobRunner(getClient) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('SDK-only label job submission', () => {
  it('submits the persisted UUID as the only parameter to the configured app job', async () => {
    vi.stubEnv('DATABRICKS_JOB_LABELS', '456');
    const worker = client();
    await expect(worker.run(runId)).resolves.toEqual({ jobRunId: 123 });
    expect(worker.runNow).toHaveBeenCalledExactlyOnceWith({
      job_id: 456,
      job_parameters: { run_id: runId },
    });
  });

  it('rejects empty, malformed, and compound parameters before resolving a client', async () => {
    vi.stubEnv('DATABRICKS_JOB_LABELS', '456');
    const worker = client();
    for (const input of ['', 'call-1', `${runId},other`, JSON.stringify({ run_id: runId, endpoint: 'other' })])
      await expect(worker.run(input)).rejects.toThrow();
    expect(worker.getClient).not.toHaveBeenCalled();
    expect(worker.runNow).not.toHaveBeenCalled();
  });

  it('rejects missing or invalid job configuration before resolving a client', async () => {
    const worker = client();
    for (const configured of ['', '0', '-1', '1.5', '1e3', '9007199254740993', 'job-1']) {
      vi.stubEnv('DATABRICKS_JOB_LABELS', configured);
      await expect(worker.run(runId)).rejects.toMatchObject({ status: 503 });
    }
    expect(worker.getClient).not.toHaveBeenCalled();
    expect(worker.runNow).not.toHaveBeenCalled();
  });

  it('reports submission failure without exposing the upstream error or retrying', async () => {
    vi.stubEnv('DATABRICKS_JOB_LABELS', '456');
    const worker = client();
    worker.runNow.mockRejectedValue(new Error('upstream credential detail'));
    await expect(worker.run(runId)).rejects.toMatchObject({
      status: 502,
      message: 'The label worker could not be started.',
    });
    expect(worker.runNow).toHaveBeenCalledOnce();
  });

  it('fails closed when the initialized app identity is unavailable', async () => {
    vi.stubEnv('DATABRICKS_JOB_LABELS', '456');
    const getAppContext = vi.spyOn(ServiceContext, 'get').mockImplementation(() => {
      throw new Error('App credentials are unavailable.');
    });
    await expect(createLabelJobRunner()(runId)).rejects.toMatchObject({ status: 502 });
    expect(getAppContext).toHaveBeenCalledOnce();
  });

  it('rejects incomplete or invalid SDK responses', async () => {
    vi.stubEnv('DATABRICKS_JOB_LABELS', '456');
    const worker = client();
    for (const result of [{}, { run_id: 0 }, { run_id: -1 }, { run_id: 1.5 }, { run_id: NaN }]) {
      worker.runNow.mockResolvedValue(result);
      await expect(worker.run(runId)).rejects.toMatchObject({ status: 502 });
    }
  });
});
