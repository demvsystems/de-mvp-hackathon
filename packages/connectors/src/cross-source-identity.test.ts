import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { IntercomSnapshot } from './intercom/schema';
import { UpvotySnapshot } from './upvoty/schema';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'fixtures');

const Member = z.object({
  source: z.enum(['intercom', 'jira', 'slack', 'upvoty']),
  external_id: z.string(),
});

const ExpectedLinks = z.object({
  clusters: z.array(
    z.object({
      id: z.string(),
      members: z.array(Member).min(2),
    }),
  ),
});

async function readJson(file: string): Promise<unknown> {
  const raw = await readFile(path.join(FIXTURE_DIR, file), 'utf8');
  return JSON.parse(raw);
}

/**
 * Cross-Source-Identity ist im Pilot ausschließlich über E-Mail verankert
 * (siehe Plan: kein same_as-Edge, kein Resolver-Worker — nur Daten-Anker).
 * Diese Tests stellen sicher, dass die Brücken in den erwarteten Clustern
 * tatsächlich existieren und konfliktfrei sind, sodass ein späterer
 * Identity-Resolver echtes Material findet.
 */
describe('cross-source-identity', () => {
  it('Cluster mit Intercom+Upvoty-Member haben mindestens eine E-Mail-Brücke', async () => {
    const [intercom, upvoty, links] = await Promise.all([
      readJson('intercom.json').then((d) => IntercomSnapshot.parse(d)),
      readJson('upvoty.json').then((d) => UpvotySnapshot.parse(d)),
      readJson('expected-links.json').then((d) => ExpectedLinks.parse(d)),
    ]);

    const contactEmailById = new Map(
      intercom.contacts
        .filter((c): c is typeof c & { email: string } => Boolean(c.email))
        .map((c) => [c.id, c.email.toLowerCase()]),
    );
    const upvotyUserEmailById = new Map(
      upvoty.users
        .filter((u): u is typeof u & { email: string } => Boolean(u.email))
        .map((u) => [u.id, u.email.toLowerCase()]),
    );
    const upvotyPostById = new Map(upvoty.posts.map((p) => [p.id, p]));
    const intercomConvById = new Map(intercom.conversations.map((c) => [c.id, c]));

    const missingBridges: string[] = [];
    for (const cluster of links.clusters) {
      const intercomMembers = cluster.members.filter((m) => m.source === 'intercom');
      const upvotyMembers = cluster.members.filter((m) => m.source === 'upvoty');
      if (intercomMembers.length === 0 || upvotyMembers.length === 0) continue;

      const clusterContactEmails = new Set<string>();
      for (const m of intercomMembers) {
        const conv = intercomConvById.get(m.external_id);
        if (!conv) continue;
        const email = contactEmailById.get(conv.contact.id);
        if (email) clusterContactEmails.add(email);
      }

      const clusterVoterEmails = new Set<string>();
      for (const m of upvotyMembers) {
        const post = upvotyPostById.get(m.external_id);
        if (!post) continue;
        for (const voterId of post.voter_ids) {
          const email = upvotyUserEmailById.get(voterId);
          if (email) clusterVoterEmails.add(email);
        }
      }

      const overlap = [...clusterContactEmails].filter((e) => clusterVoterEmails.has(e));
      if (overlap.length === 0) {
        missingBridges.push(
          `cluster ${cluster.id}: keine E-Mail-Brücke zwischen Intercom-Contact und Upvoty-Voter`,
        );
      }
    }

    expect(missingBridges, missingBridges.join('\n')).toEqual([]);
  });

  it('E-Mails sind eindeutig pro Source (keine Identity-Kollisionen)', async () => {
    const [intercom, upvoty] = await Promise.all([
      readJson('intercom.json').then((d) => IntercomSnapshot.parse(d)),
      readJson('upvoty.json').then((d) => UpvotySnapshot.parse(d)),
    ]);

    const intercomEmails = intercom.contacts
      .map((c) => c.email?.toLowerCase())
      .filter((e): e is string => Boolean(e));
    expect(new Set(intercomEmails).size, 'Doppelte E-Mail in Intercom-Contacts').toBe(
      intercomEmails.length,
    );

    const upvotyEmails = upvoty.users
      .map((u) => u.email?.toLowerCase())
      .filter((e): e is string => Boolean(e));
    expect(new Set(upvotyEmails).size, 'Doppelte E-Mail in Upvoty-Users').toBe(upvotyEmails.length);
  });

  it('Upvoty: vote_count entspricht voter_ids.length pro Post', async () => {
    const upvoty = UpvotySnapshot.parse(await readJson('upvoty.json'));
    const mismatches = upvoty.posts
      .filter((p) => p.vote_count !== p.voter_ids.length)
      .map((p) => `${p.id}: vote_count=${p.vote_count}, voter_ids.length=${p.voter_ids.length}`);
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });
});
