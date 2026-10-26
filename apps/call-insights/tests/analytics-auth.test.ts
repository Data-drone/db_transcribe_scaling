import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('analytics authorization policy', () => {
  it('requires user execution for every analytics query', async () => {
    const queryDirectory = new URL('../config/queries/', import.meta.url);
    const files = await readdir(queryDirectory, { recursive: true });
    const sqlFiles = files.filter((file) => file.endsWith('.sql'));

    expect(sqlFiles.length).toBeGreaterThan(0);
    expect(
      sqlFiles.filter((file) => !file.endsWith('.obo.sql')),
      'Plain .sql queries run as the service principal with a shared cache. Use .obo.sql for per-user access.',
    ).toEqual([]);
  });
});
