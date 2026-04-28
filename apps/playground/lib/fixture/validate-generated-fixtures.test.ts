import { describe, expect, it } from 'vitest';
import { validateGeneratedFixtures } from './validate-generated-fixtures';

describe('validateGeneratedFixtures', () => {
  it('returns one validation result per item', () => {
    const res = validateGeneratedFixtures({
      source: 'jira',
      items: [
        { filename: 'a.json', content: { issues: [] } },
        { filename: 'b.json', content: { issues: [] } },
      ],
    });
    expect(res).toHaveLength(2);
  });

  it('returns ok for minimally valid item', () => {
    const res = validateGeneratedFixtures({
      source: 'jira',
      items: [
        {
          filename: 'x.json',
          content: {
            issues: [
              {
                key: 'DUMMY-1',
                summary: '[DUMMY] test summary',
              },
            ],
            projects: [{ key: 'DUMMY', name: 'Dummy' }],
          },
        },
      ],
    });
    expect(res[0]?.status).toBe('ok');
  });

  it('returns warning status when warning issues exist', () => {
    const res = validateGeneratedFixtures({
      source: 'jira',
      items: [
        {
          filename: 'x.json',
          content: {
            issues: [{ key: 'DUMMY-1', summary: '' }],
          },
        },
      ],
    });
    expect(res[0]?.status).toBe('warning');
  });

  it('returns error status when error issues exist', () => {
    const res = validateGeneratedFixtures({
      source: 'upvoty',
      items: [
        { filename: 'x.json', content: { posts: 'invalid' } as unknown as Record<string, unknown> },
      ],
    });
    expect(res[0]?.status).toBe('error');
  });

  it('detects unsafe domains', () => {
    const res = validateGeneratedFixtures({
      source: 'intercom',
      items: [
        {
          filename: 'x.json',
          content: { event: { data: { item: { body: '[DUMMY] please email me at evil.com' } } } },
        },
      ],
    });
    const issue = res[0]?.issues.find((entry) => entry.message.includes('Unsafe domain'));
    expect(issue).toBeTruthy();
    expect(issue?.severity).toBe('error');
  });

  it('detects obvious secret-like strings', () => {
    const res = validateGeneratedFixtures({
      source: 'jira',
      items: [
        {
          filename: 'x.json',
          content: { issues: [{ key: 'DUMMY-1', summary: '[DUMMY] key sk-abc123' }] },
        },
      ],
    });
    expect(
      res[0]?.issues.some((entry) => entry.message.includes('Potential secret-like value')),
    ).toBe(true);
  });

  it('warns when [DUMMY] marker is missing in user-visible text', () => {
    const res = validateGeneratedFixtures({
      source: 'upvoty',
      items: [{ filename: 'x.json', content: { posts: [{ title: 'Real sounding title' }] } }],
    });
    expect(res[0]?.issues.some((entry) => entry.message.includes('No [DUMMY] marker'))).toBe(true);
  });

  it('slack: content not array => error', () => {
    const res = validateGeneratedFixtures({
      source: 'slack',
      items: [
        {
          filename: 'x.json',
          content: { channel: {}, content: {} } as unknown as Record<string, unknown>,
        },
      ],
    });
    expect(
      res[0]?.issues.some(
        (entry) => entry.path === 'content.content' && entry.severity === 'error',
      ),
    ).toBe(true);
  });

  it('slack: wrong team_id => warning', () => {
    const res = validateGeneratedFixtures({
      source: 'slack',
      items: [
        {
          filename: 'x.json',
          content: {
            channel: { team_id: 'WRONG' },
            participants: [{ id: 'U1' }],
            content: [{ id: 'm1', text: '[DUMMY] msg', author_id: 'U1' }],
          },
        },
      ],
    });
    expect(
      res[0]?.issues.some(
        (entry) => entry.path.includes('team_id') && entry.severity === 'warning',
      ),
    ).toBe(true);
  });

  it('slack: thread.reply_count mismatch => warning', () => {
    const res = validateGeneratedFixtures({
      source: 'slack',
      items: [
        {
          filename: 'x.json',
          content: {
            channel: { team_id: 'DE-MVP' },
            participants: [{ id: 'U1' }],
            content: [
              {
                id: 'm1',
                text: '[DUMMY] root',
                author_id: 'U1',
                thread: {
                  root_message_id: 'm1',
                  reply_count: 2,
                  messages: [{ text: '[DUMMY] reply', author_id: 'U1' }],
                },
              },
            ],
          },
        },
      ],
    });
    expect(
      res[0]?.issues.some(
        (entry) => entry.path.includes('reply_count') && entry.message.includes('does not match'),
      ),
    ).toBe(true);
  });

  it('slack: missing mention/reaction user references => warning', () => {
    const res = validateGeneratedFixtures({
      source: 'slack',
      items: [
        {
          filename: 'x.json',
          content: {
            channel: { team_id: 'DE-MVP' },
            participants: [{ id: 'U1' }],
            content: [
              {
                id: 'm1',
                text: '[DUMMY] root',
                author_id: 'U1',
                mentions: ['U2'],
                reactions: [{ name: 'eyes', users: ['U3'] }],
              },
            ],
          },
        },
      ],
    });
    expect(
      res[0]?.issues.some(
        (entry) => entry.path.includes('mentions') && entry.severity === 'warning',
      ),
    ).toBe(true);
    expect(
      res[0]?.issues.some(
        (entry) => entry.path.includes('reactions') && entry.severity === 'warning',
      ),
    ).toBe(true);
  });

  it('jira: issues exists but is not array => error', () => {
    const res = validateGeneratedFixtures({
      source: 'jira',
      items: [
        { filename: 'x.json', content: { issues: {} } as unknown as Record<string, unknown> },
      ],
    });
    expect(
      res[0]?.issues.some((entry) => entry.path === 'content.issues' && entry.severity === 'error'),
    ).toBe(true);
  });

  it('jira: issue missing key/id and summary => warning', () => {
    const res = validateGeneratedFixtures({
      source: 'jira',
      items: [{ filename: 'x.json', content: { issues: [{}] } }],
    });
    expect(res[0]?.issues.some((entry) => entry.message.includes('missing id/key'))).toBe(true);
    expect(res[0]?.issues.some((entry) => entry.message.includes('missing summary'))).toBe(true);
  });

  it('upvoty: posts exists but is not array => error', () => {
    const res = validateGeneratedFixtures({
      source: 'upvoty',
      items: [{ filename: 'x.json', content: { posts: {} } as unknown as Record<string, unknown> }],
    });
    expect(
      res[0]?.issues.some((entry) => entry.path === 'content.posts' && entry.severity === 'error'),
    ).toBe(true);
  });

  it('upvoty: vote references missing post => warning', () => {
    const res = validateGeneratedFixtures({
      source: 'upvoty',
      items: [
        {
          filename: 'x.json',
          content: { posts: [{ id: 'p1', title: '[DUMMY] t' }], votes: [{ post_id: 'p2' }] },
        },
      ],
    });
    expect(
      res[0]?.issues.some((entry) => entry.message.includes('vote references missing post')),
    ).toBe(true);
  });

  it('intercom: broken event payload shape => warning', () => {
    const res = validateGeneratedFixtures({
      source: 'intercom',
      items: [{ filename: 'x.json', content: { eventA: { data: 'oops' } } }],
    });
    expect(
      res[0]?.issues.some((entry) => entry.path.includes('.data') && entry.severity === 'warning'),
    ).toBe(true);
  });
});
