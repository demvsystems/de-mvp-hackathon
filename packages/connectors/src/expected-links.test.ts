import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { IntercomSnapshot } from './intercom/schema';
import { JiraSnapshot } from './jira/schema';
import { SlackSnapshot } from './slack/schema';
import { UpvotySnapshot } from './upvoty/schema';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'fixtures');

const Member = z.object({
  source: z.enum(['intercom', 'jira', 'slack', 'upvoty']),
  external_id: z.string(),
});

const ExpectedLinks = z.object({
  metadata: z.object({
    version: z.string(),
    description: z.string(),
    fixtures: z.array(z.string()),
  }),
  clusters: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      evidence_keywords: z.array(z.string()),
      members: z.array(Member).min(2),
    }),
  ),
  noise: z.array(Member.extend({ reason: z.string() })),
});

async function readJson(file: string): Promise<unknown> {
  const raw = await readFile(path.join(FIXTURE_DIR, file), 'utf8');
  return JSON.parse(raw);
}

async function loadIds(): Promise<Record<'intercom' | 'jira' | 'slack' | 'upvoty', Set<string>>> {
  const [intercom, jira, slack, upvoty] = await Promise.all([
    readJson('intercom.json').then((d) => IntercomSnapshot.parse(d)),
    readJson('jira.json').then((d) => JiraSnapshot.parse(d)),
    readJson('slack.json').then((d) => SlackSnapshot.parse(d)),
    readJson('upvoty.json').then((d) => UpvotySnapshot.parse(d)),
  ]);
  return {
    intercom: new Set(intercom.conversations.map((c) => c.id)),
    jira: new Set(jira.issues.map((i) => i.key)),
    slack: new Set(slack.content.map((m) => m.id)),
    upvoty: new Set(upvoty.posts.map((p) => p.id)),
  };
}

async function loadExpectedLinks(): Promise<z.infer<typeof ExpectedLinks>> {
  return ExpectedLinks.parse(await readJson('expected-links.json'));
}

describe('expected-links gold standard', () => {
  it('every cluster member and noise record exists in its fixture', async () => {
    const links = await loadExpectedLinks();
    const ids = await loadIds();

    const missing: string[] = [];
    for (const cluster of links.clusters) {
      for (const m of cluster.members) {
        if (!ids[m.source].has(m.external_id)) {
          missing.push(`cluster ${cluster.id}: ${m.source}:${m.external_id}`);
        }
      }
    }
    for (const n of links.noise) {
      if (!ids[n.source].has(n.external_id)) {
        missing.push(`noise: ${n.source}:${n.external_id}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('every fixture record is labeled (cluster member or noise)', async () => {
    const links = await loadExpectedLinks();
    const ids = await loadIds();

    const labeled = new Set<string>();
    for (const c of links.clusters)
      for (const m of c.members) labeled.add(`${m.source}:${m.external_id}`);
    for (const n of links.noise) labeled.add(`${n.source}:${n.external_id}`);

    const orphans: string[] = [];
    for (const source of ['intercom', 'jira', 'slack', 'upvoty'] as const) {
      for (const id of ids[source]) {
        if (!labeled.has(`${source}:${id}`)) orphans.push(`${source}:${id}`);
      }
    }
    expect(orphans, orphans.join('\n')).toEqual([]);
  });

  it('cluster ids are unique and no record is in two clusters', async () => {
    const links = await loadExpectedLinks();

    const clusterIds = links.clusters.map((c) => c.id);
    expect(new Set(clusterIds).size).toBe(clusterIds.length);

    const memberKeys = links.clusters.flatMap((c) =>
      c.members.map((m) => `${m.source}:${m.external_id}`),
    );
    expect(new Set(memberKeys).size).toBe(memberKeys.length);
  });
});
