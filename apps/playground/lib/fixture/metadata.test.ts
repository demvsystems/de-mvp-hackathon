import { describe, expect, it } from 'vitest';
import { buildTemplatePreview, extractTemplateMetadata, inferDetectedObjectType } from './metadata';

describe('fixture metadata extraction', () => {
  it('extracts metadata for a jira-like template', () => {
    const template = {
      source: { jiraSite: 'demo.atlassian.net' },
      issues: [
        {
          summary: 'Checkout fails',
          descriptionText: 'Import bug',
          updatedAt: '2026-04-28T09:14:12.000Z',
          author: { id: 'u1' },
        },
      ],
    };

    const metadata = extractTemplateMetadata(template);
    expect(metadata.topLevelFields).toEqual(['source', 'issues']);
    expect(metadata.hasUser).toBe(true);
    expect(metadata.hasMessageBody).toBe(true);
    expect(metadata.hasTimestamp).toBe(true);
  });

  it('infers object type for representative shapes', () => {
    expect(inferDetectedObjectType({ issues: [] })).toBe('jira-issue-collection');
    expect(inferDetectedObjectType({ channel: {}, content: [] })).toBe(
      'slack-channel-conversation',
    );
    expect(inferDetectedObjectType({ posts: [], votes: [] })).toBe('upvoty-polling-snapshot');
  });

  it('builds a truncated preview', () => {
    const preview = buildTemplatePreview({
      description: 'x'.repeat(500),
      list: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
    }) as { description: string; list: unknown[] };

    expect(preview.description.endsWith('...')).toBe(true);
    expect(preview.list.length).toBe(3);
  });
});
