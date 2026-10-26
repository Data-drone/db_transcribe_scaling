import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileAction } from '@databricks/appkit';
import { AUDIO_VOLUME_ROOT, audioFilePolicy, audioFilesConfiguration } from '../server/investigations/audio';

afterEach(() => vi.unstubAllEnvs());

describe('Files startup compatibility without generic file access', () => {
  it('configures the static Files alias and dedicated audio alias explicitly as user-only', () => {
    vi.stubEnv('DATABRICKS_VOLUME_FILES', AUDIO_VOLUME_ROOT);
    vi.stubEnv('DATABRICKS_VOLUME_AUDIO', AUDIO_VOLUME_ROOT);
    const config = audioFilesConfiguration();
    expect(config.auth).toBe('on-behalf-of-user');
    expect(config.volumes.files.auth).toBe('on-behalf-of-user');
    expect(config.volumes.audio.auth).toBe('on-behalf-of-user');
    expect(config.volumes.audio.policy).toBe(audioFilePolicy);
  });

  it('denies every operation on the compatibility alias and unexpected discovered volumes', async () => {
    vi.stubEnv('DATABRICKS_VOLUME_FILES', AUDIO_VOLUME_ROOT);
    vi.stubEnv('DATABRICKS_VOLUME_OTHER', '/Volumes/other/schema/volume');
    const config = audioFilesConfiguration();
    const actions: FileAction[] = [
      'list',
      'read',
      'download',
      'raw',
      'exists',
      'metadata',
      'preview',
      'upload',
      'mkdir',
      'delete',
    ];
    for (const alias of ['files', 'other']) {
      expect(config.volumes[alias].auth).toBe('on-behalf-of-user');
      for (const action of actions) {
        expect(
          await config.volumes[alias].policy(
            action,
            { volume: alias, path: 'audio/stereo/source.wav' },
            { id: 'user-a' }
          )
        ).toBe(false);
        expect(
          await config.volumes[alias].policy(
            action,
            { volume: alias, path: 'audio/stereo/source.wav' },
            { id: 'app-sp', isServicePrincipal: true }
          )
        ).toBe(false);
      }
    }
  });
});
