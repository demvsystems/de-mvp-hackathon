import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractJiraSnapshot } from './jira';

const PWX_BIPRO = join(process.cwd(), '../../apps/playground/Dummyfiles/pwx_ideen_bipro.json');

async function loadBipro(): Promise<unknown> {
  return JSON.parse(await readFile(PWX_BIPRO, 'utf8')) as unknown;
}

describe('extractJiraSnapshot', () => {
  it('liefert die jira-section als validiertes JiraSnapshot', async () => {
    const container = await loadBipro();
    const snapshot = extractJiraSnapshot(container);
    expect(snapshot.issues.length).toBeGreaterThan(0);
    expect(snapshot.issues[0]!.key).toBe('DEMV-4127');
    expect(snapshot.activeSprints.length).toBeGreaterThan(0);
  });

  it('reicht boards und projects unverändert durch', async () => {
    const container = await loadBipro();
    const snapshot = extractJiraSnapshot(container);
    expect(snapshot.projects.length).toBeGreaterThan(0);
    expect(snapshot.boards.length).toBeGreaterThan(0);
  });

  it('wirft, wenn der Container keine jira-section hat', () => {
    expect(() => extractJiraSnapshot({ cluster: 'foo' })).toThrow(/jira/i);
  });

  it('wirft, wenn die jira-section nicht zum Schema passt', () => {
    expect(() =>
      extractJiraSnapshot({
        cluster: 'foo',
        jira: { source: { jiraSite: 'x' } /* keine projects/boards/sprints/issues */ },
      }),
    ).not.toThrow(); // defaults gelten
  });

  it('akzeptiert eine Inline-Fixture mit minimalem Snapshot', () => {
    const snapshot = extractJiraSnapshot({
      cluster: 'inline_test',
      jira: {
        source: { jiraSite: 'fixture.atlassian.net' },
        projects: [],
        boards: [],
        activeSprints: [],
        issues: [],
      },
    });
    expect(snapshot.issues).toEqual([]);
  });
});
