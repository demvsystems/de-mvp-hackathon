import { describe, expect, it, vi } from 'vitest';
import { resolveJiraKey, resolveSlackPermalink, type ResolverDeps } from './resolver';

function mockDeps(
  rows: Array<{ id: string; source: string; key?: string; channel?: string }>,
): ResolverDeps {
  return {
    queryJiraIssueByKey: vi.fn(async (key: string) => {
      const found = rows.find((r) => r.source === 'jira' && r.key === key);
      return found ? { id: found.id } : null;
    }),
    queryChannelById: vi.fn(async (channel: string) => {
      const found = rows.find((r) => r.source === 'slack' && r.channel === channel);
      return found ? { id: found.id } : null;
    }),
  };
}

describe('resolveJiraKey', () => {
  it('liefert die kanonische subject_id, wenn das Issue ingestiert ist', async () => {
    const deps = mockDeps([{ id: 'jira:issue:DEMV-4127', source: 'jira', key: 'DEMV-4127' }]);
    const result = await resolveJiraKey('DEMV-4127', deps);
    expect(result).toBe('jira:issue:DEMV-4127');
  });

  it('liefert null, wenn der Key noch nicht ingestiert ist (pending-Pfad)', async () => {
    const deps = mockDeps([]);
    const result = await resolveJiraKey('DEMV-9999', deps);
    expect(result).toBeNull();
  });

  it('reicht den Key unverändert an die Query', async () => {
    const deps = mockDeps([]);
    await resolveJiraKey('SHOP-142', deps);
    expect(deps.queryJiraIssueByKey).toHaveBeenCalledWith('SHOP-142');
  });
});

describe('resolveSlackPermalink', () => {
  it('rekonstruiert die message subject_id aus channel-Lookup und compact-ts', async () => {
    const deps = mockDeps([
      { id: 'slack:channel:hackathon/C02DEF', source: 'slack', channel: 'C02DEF' },
    ]);
    const result = await resolveSlackPermalink('C02DEF', '1714028591012345', deps);
    expect(result).toBe('slack:msg:hackathon/C02DEF/1714028591.012345');
  });

  it('liefert null, wenn der Channel nicht ingestiert ist', async () => {
    const deps = mockDeps([]);
    const result = await resolveSlackPermalink('C02DEF', '1714028591012345', deps);
    expect(result).toBeNull();
  });

  it('liefert null, wenn das channel-record subject_id keine workspace-Komponente hat', async () => {
    const deps = mockDeps([{ id: 'slack:channel:C02DEF', source: 'slack', channel: 'C02DEF' }]);
    const result = await resolveSlackPermalink('C02DEF', '1714028591012345', deps);
    expect(result).toBeNull();
  });

  it('formatiert den ts mit Punkt nach den ersten 10 Ziffern', async () => {
    const deps = mockDeps([
      { id: 'slack:channel:hackathon/C02DEF', source: 'slack', channel: 'C02DEF' },
    ]);
    const result = await resolveSlackPermalink('C02DEF', '1714028591000100', deps);
    expect(result).toBe('slack:msg:hackathon/C02DEF/1714028591.000100');
  });
});
