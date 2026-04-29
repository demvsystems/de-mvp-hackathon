/**
 * Pipeline-Verlust-Probe gegen den canonical fixture-Set + expected-links-Gold.
 *
 * Modus `text-only` (default, offline): zeigt pro Cluster-Member, wie viel Text
 * die aktuelle Pipeline an den Embedder gibt ("as-pipeline") vs. wie viel im
 * Source-JSON eigentlich vorliegt ("raw"). Die Lücke ist der direkt messbare
 * Informationsverlust auf dem Pfad Source → record.body → Embedder.
 *
 * Modus `embed`: zusätzlich beide Varianten embedden, pro expected-Cluster
 * Recall berechnen (jeder Member näher am eigenen Centroid als am nächsten
 * fremden Centroid?), Threshold-Sweep für False-Merge gegen Noise.
 *
 * CLI:
 *   tsx scripts/probe-clustering.ts                  # text-only
 *   tsx scripts/probe-clustering.ts --mode=embed     # erfordert AZURE_OPENAI_*
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmbedder } from '../../embedder/src/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../../..', 'fixtures');

type Source = 'intercom' | 'jira' | 'slack' | 'upvoty';
interface Member {
  source: Source;
  external_id: string;
}
interface Cluster {
  id: string;
  label: string;
  members: Member[];
}
interface Noise extends Member {
  reason: string;
}
interface ExpectedLinks {
  clusters: Cluster[];
  noise: Noise[];
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, file), 'utf8')) as T;
}

// ----- Fixture-spezifische Text-Extraktoren -----------------------------------

interface IntercomConv {
  id: string;
  subject?: string | null;
  parts?: Array<{ body?: string | null }>;
}
interface JiraIssue {
  key: string;
  summary: string;
  descriptionText: string;
  comments?: Array<{ bodyText: string }>;
  attachments?: Array<{ filename: string }>;
}
interface SlackMsg {
  id: string;
  text?: string;
  thread?: { messages: SlackMsg[] };
}
interface UpvotyPost {
  id: string;
  title: string;
  body?: string | null;
  comments?: Array<{ body: string }>;
}

function flattenSlackThread(msg: SlackMsg): string {
  const parts: string[] = [];
  if (msg.text) parts.push(msg.text);
  for (const reply of msg.thread?.messages ?? []) {
    parts.push(flattenSlackThread(reply));
  }
  return parts.join('\n\n');
}

interface Variants {
  asPipeline: string;
  raw: string;
}

function extractIntercom(conv: IntercomConv): Variants {
  // as-pipeline: handle.ts emittet body = parts[].body konkateniert + title=subject.
  // Embedder sieht entsprechend subject + alle parts-bodies.
  const partBodies = (conv.parts ?? []).map((p) => p.body ?? '').filter(Boolean);
  const asPipeline = [conv.subject ?? '', ...partBodies].filter(Boolean).join('\n\n');
  // raw == as-pipeline für Intercom: unsere Source liefert nur subject + parts.
  const raw = asPipeline;
  return { asPipeline, raw };
}

function extractJira(issue: JiraIssue): Variants {
  // as-pipeline: handle.ts emittet body = descriptionText + comments mit
  // [authorRole]-Prefix konkateniert, title = summary. Comments werden NICHT
  // als eigene Records emittiert (kein author_id im Mock).
  const commentBodies = (issue.comments ?? []).map((c) => `[${c.authorRole}] ${c.bodyText}`);
  const attachmentNames = (issue.attachments ?? []).map((a) => a.filename);
  const asPipeline = [issue.summary, issue.descriptionText, ...commentBodies].join('\n\n');
  // raw zusätzlich mit Attachment-Filenames — die landen aktuell nicht im Body.
  const raw = [
    issue.summary,
    issue.descriptionText,
    ...commentBodies,
    ...(attachmentNames.length > 0 ? [`attachments: ${attachmentNames.join(', ')}`] : []),
  ].join('\n\n');
  return { asPipeline, raw };
}

function extractSlack(msg: SlackMsg): Variants {
  // as-pipeline: handle.ts emittet auf Top-Level-Messages body = msg.text +
  // alle Thread-Replies konkateniert. Replies sind zusätzlich eigene Records.
  const asPipeline = flattenSlackThread(msg);
  const raw = asPipeline;
  return { asPipeline, raw };
}

function extractUpvoty(post: UpvotyPost): Variants {
  // as-pipeline: handle.ts emittet title + body, wobei body = post.body +
  // comments-bodies konkateniert. Comments bleiben zusätzlich eigene Records.
  const commentBodies = (post.comments ?? []).map((c) => c.body);
  const asPipeline = [post.title, post.body ?? '', ...commentBodies].filter(Boolean).join('\n\n');
  const raw = asPipeline;
  return { asPipeline, raw };
}

// ----- Lookup-Index -----------------------------------------------------------

interface FixtureIndex {
  intercom: Map<string, IntercomConv>;
  jira: Map<string, JiraIssue>;
  slack: Map<string, SlackMsg>;
  upvoty: Map<string, UpvotyPost>;
}

function buildIndex(): FixtureIndex {
  const intercomSnap = readJson<{ conversations: IntercomConv[] }>('intercom.json');
  const jiraSnap = readJson<{ issues: JiraIssue[] }>('jira.json');
  const slackSnap = readJson<{ content: SlackMsg[] }>('slack.json');
  const upvotySnap = readJson<{ posts: UpvotyPost[] }>('upvoty.json');

  return {
    intercom: new Map(intercomSnap.conversations.map((c) => [c.id, c])),
    jira: new Map(jiraSnap.issues.map((i) => [i.key, i])),
    slack: new Map(slackSnap.content.map((m) => [m.id, m])),
    upvoty: new Map(upvotySnap.posts.map((p) => [p.id, p])),
  };
}

function variantsFor(member: Member, idx: FixtureIndex): Variants {
  switch (member.source) {
    case 'intercom': {
      const c = idx.intercom.get(member.external_id);
      if (!c) throw new Error(`intercom:${member.external_id} not in fixture`);
      return extractIntercom(c);
    }
    case 'jira': {
      const i = idx.jira.get(member.external_id);
      if (!i) throw new Error(`jira:${member.external_id} not in fixture`);
      return extractJira(i);
    }
    case 'slack': {
      const m = idx.slack.get(member.external_id);
      if (!m) throw new Error(`slack:${member.external_id} not in fixture`);
      return extractSlack(m);
    }
    case 'upvoty': {
      const p = idx.upvoty.get(member.external_id);
      if (!p) throw new Error(`upvoty:${member.external_id} not in fixture`);
      return extractUpvoty(p);
    }
  }
}

// ----- Reports ----------------------------------------------------------------

function memberKey(m: Member): string {
  return `${m.source}:${m.external_id}`;
}

function reportTextOnly(links: ExpectedLinks, idx: FixtureIndex): void {
  console.log('=== Text-Längen-Diff (as-pipeline vs raw) ===\n');

  let totalAsPipeline = 0;
  let totalRaw = 0;
  let totalAsPipelineEmpty = 0;

  for (const cluster of links.clusters) {
    console.log(`▸ ${cluster.id} — ${cluster.label}`);
    console.log(
      `  ${'member'.padEnd(28)} ${'as-pipeline'.padStart(12)} ${'raw'.padStart(8)}  delta`,
    );
    for (const m of cluster.members) {
      const v = variantsFor(m, idx);
      const ap = v.asPipeline.length;
      const r = v.raw.length;
      totalAsPipeline += ap;
      totalRaw += r;
      if (ap === 0) totalAsPipelineEmpty++;
      const delta = r === 0 ? '—' : `-${(((r - ap) / r) * 100).toFixed(0)}%`;
      const flag = ap === 0 ? '  ⨯ EMPTY' : ap < r * 0.5 ? '  ⚠ <50%' : '';
      console.log(
        `  ${memberKey(m).padEnd(28)} ${String(ap).padStart(12)} ${String(r).padStart(8)}  ${delta.padStart(5)}${flag}`,
      );
    }
    console.log('');
  }

  console.log('▸ noise');
  for (const n of links.noise) {
    const v = variantsFor(n, idx);
    console.log(
      `  ${memberKey(n).padEnd(28)} ${String(v.asPipeline.length).padStart(12)} ${String(v.raw.length).padStart(8)}  (${n.reason})`,
    );
  }

  const totalMembers = links.clusters.flatMap((c) => c.members).length;
  console.log('\n--- summary ---');
  console.log(`cluster-members:                  ${totalMembers}`);
  console.log(
    `as-pipeline empty (record body→0): ${totalAsPipelineEmpty} (${((100 * totalAsPipelineEmpty) / totalMembers).toFixed(0)}%)`,
  );
  console.log(`text chars total: as-pipeline=${totalAsPipeline}  raw=${totalRaw}`);
  console.log(
    `information retention (as-pipeline / raw): ${((100 * totalAsPipeline) / totalRaw).toFixed(0)}%`,
  );
}

// ----- Embedding-Modus --------------------------------------------------------

function cosineDistance(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function centroid(vectors: readonly number[][]): number[] {
  const dim = vectors[0]!.length;
  const c = new Array<number>(dim).fill(0);
  for (const v of vectors) for (let k = 0; k < dim; k++) c[k]! += v[k]!;
  for (let k = 0; k < dim; k++) c[k]! /= vectors.length;
  return c;
}

async function reportEmbed(links: ExpectedLinks, idx: FixtureIndex): Promise<void> {
  const embedder = createEmbedder();
  console.log(`embedder ready: model=${embedder.modelTag} dim=${embedder.dim}\n`);

  // Pro Member beide Varianten embedden, dann zwei parallele Auswertungen.
  const allMembers: Array<{ m: Member; clusterId: string | null }> = [
    ...links.clusters.flatMap((c) => c.members.map((m) => ({ m, clusterId: c.id }))),
    ...links.noise.map((n) => ({ m: n, clusterId: null })),
  ];

  const vectorsByVariant: Record<'asPipeline' | 'raw', Map<string, number[]>> = {
    asPipeline: new Map(),
    raw: new Map(),
  };

  for (const { m } of allMembers) {
    const v = variantsFor(m, idx);
    const key = memberKey(m);
    // Leer-String würde die API ablehnen — durch Single-Space ersetzen, damit
    // wir einen vergleichbaren "minimal-information"-Vektor bekommen.
    const ap = v.asPipeline.length === 0 ? ' ' : v.asPipeline.slice(0, 24000);
    const raw = v.raw.length === 0 ? ' ' : v.raw.slice(0, 24000);
    vectorsByVariant.asPipeline.set(key, await embedder.embed(ap));
    vectorsByVariant.raw.set(key, await embedder.embed(raw));
  }

  for (const variant of ['asPipeline', 'raw'] as const) {
    console.log(`\n=== variant: ${variant} ===`);
    const vectors = vectorsByVariant[variant];

    // Centroide pro Cluster
    const centroids = new Map<string, number[]>();
    for (const c of links.clusters) {
      const memberVecs = c.members.map((m) => vectors.get(memberKey(m))!);
      centroids.set(c.id, centroid(memberVecs));
    }

    // Recall: jeder Member näher am eigenen Centroid als am nächsten fremden
    let correct = 0;
    let total = 0;
    for (const c of links.clusters) {
      let clusterCorrect = 0;
      for (const m of c.members) {
        const v = vectors.get(memberKey(m))!;
        const ownDist = cosineDistance(v, centroids.get(c.id)!);
        const foreignDists = [...centroids.entries()]
          .filter(([id]) => id !== c.id)
          .map(([, vec]) => cosineDistance(v, vec));
        const nearestForeign = Math.min(...foreignDists);
        if (ownDist < nearestForeign) {
          correct++;
          clusterCorrect++;
        }
        total++;
      }
      console.log(
        `  ${c.id}: recall ${clusterCorrect}/${c.members.length} (${((100 * clusterCorrect) / c.members.length).toFixed(0)}%)`,
      );
    }
    console.log(`  overall recall: ${correct}/${total} (${((100 * correct) / total).toFixed(0)}%)`);

    // False-merge: jeder Noise-Record näher als Schwellwert an irgendeinem Centroid
    const thresholds = [0.2, 0.3, 0.4, 0.5];
    console.log(
      `  false-merge (noise nearest-cluster ≤ t):  ${thresholds.map((t) => `t=${t}`).join('  ')}`,
    );
    const fmCounts = thresholds.map(() => 0);
    for (const n of links.noise) {
      const v = vectors.get(memberKey(n))!;
      const minDist = Math.min(...[...centroids.values()].map((cv) => cosineDistance(v, cv)));
      thresholds.forEach((t, i) => {
        if (minDist <= t) fmCounts[i]!++;
      });
    }
    console.log(
      `                                            ${fmCounts.map((c) => `${c}/${links.noise.length}`.padStart(8)).join('  ')}`,
    );
  }
}

// ----- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const mode = process.argv.includes('--mode=embed') ? 'embed' : 'text-only';
  const links = readJson<ExpectedLinks>('expected-links.json');
  const idx = buildIndex();
  console.log(
    `loaded ${links.clusters.length} clusters (${links.clusters.flatMap((c) => c.members).length} members) + ${links.noise.length} noise records\n`,
  );

  reportTextOnly(links, idx);
  if (mode === 'embed') await reportEmbed(links, idx);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
