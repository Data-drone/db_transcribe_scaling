import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function query(name: string) {
  return readFile(new URL(`../config/queries/${name}.obo.sql`, import.meta.url), 'utf8');
}

describe('Explore query boundaries', () => {
  it('uses recording bounds when no dates are selected rather than parsing a time-only timestamp', async () => {
    const source = await query('overview_summary');
    expect(source).toContain(
      "CASE WHEN :start_date <> '' THEN TRY_CAST(CONCAT(:start_date, 'T00:00:00Z') AS TIMESTAMP) END"
    );
    expect(source).toContain(
      "CASE WHEN :end_date <> '' THEN TRY_CAST(CONCAT(:end_date, 'T00:00:00Z') AS TIMESTAMP) + INTERVAL 1 DAY END"
    );
  });
  it('never reads raw transcript text and requires nonempty masked text for previews', async () => {
    for (const name of ['explore_interactions', 'explore_count']) {
      const source = await query(name);
      expect(source, name).not.toMatch(/\bs\.text\b/i);
      expect(source, name).toContain("NULLIF(TRIM(sm.text_masked), '') IS NOT NULL");
      expect(source, name).toContain('CONTAINS(LOWER(sm.text_masked), LOWER(:search_text))');
    }
  });

  it('uses the identical cohort definition for rows and exact counts', async () => {
    const [rows, count] = await Promise.all([query('explore_interactions'), query('explore_count')]);
    const population = (source: string) => source.slice(source.indexOf('WITH mask_inventory')).split('\nSELECT ')[0];
    expect(population(rows)).toBe(population(count));
    expect(rows).toContain('ORDER BY started_at DESC, interaction_id ASC');
    expect(rows).toContain('LIMIT :page_size OFFSET :row_offset');
    expect(rows).toContain('-- @param page_size INT');
    expect(rows).toContain('-- @param row_offset INT');
  });

  it('keeps UTC date bounds consistent across overview, drillthrough and counts', async () => {
    for (const name of [
      'overview_summary',
      'overview_contact_reasons',
      'daily_activity',
      'explore_interactions',
      'explore_count',
    ]) {
      const source = await query(name);
      expect(source, name).toContain("i.started_at >= TRY_CAST(CONCAT(:start_date, 'T00:00:00Z') AS TIMESTAMP)");
      expect(source, name).toContain(
        "i.started_at < TRY_CAST(CONCAT(:end_date, 'T00:00:00Z') AS TIMESTAMP) + INTERVAL 1 DAY"
      );
    }
  });
});
