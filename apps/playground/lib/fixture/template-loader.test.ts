import { describe, expect, it } from 'vitest';
import { loadTemplateForSource, parseTemplateJson, TemplateLoadError } from './template-loader';

describe('template loader', () => {
  it('loads slack template from configured path', async () => {
    const loaded = await loadTemplateForSource('slack');
    expect(loaded.status).toBe('loaded');
    expect(loaded.templatePath).toBe('fixtures/slack.json');
    expect(loaded.metadata.topLevelFields).toContain('content');
  });

  it('throws clear error for invalid json content', () => {
    expect(() => parseTemplateJson('{ invalid', 'jira')).toThrowError(TemplateLoadError);
    try {
      parseTemplateJson('{ invalid', 'jira');
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateLoadError);
      expect((error as TemplateLoadError).code).toBe('template_invalid_json');
    }
  });

  it('throws clear error for missing template file', async () => {
    await expect(
      loadTemplateForSource('jira', {
        repoRoot: 'C:\\definitely-not-existing-repo-root',
      }),
    ).rejects.toMatchObject({
      code: 'template_not_found',
    });
  });
});
