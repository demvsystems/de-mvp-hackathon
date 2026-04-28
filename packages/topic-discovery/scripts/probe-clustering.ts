import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEmbedder } from '../../embedder/src/client';

interface Doc {
  scenario: string;
  source: 'intercom' | 'slack' | 'upvoty' | 'jira';
  kind: string;
  text: string;
}

const FIXTURE_DIR = join(process.cwd(), 'fixtures');

function extractFromScenario(file: string): Doc[] {
  const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Record<string, unknown>;
  const scenario = String(raw['scenario_id'] ?? file.replace(/\.json$/, ''));
  const docs: Doc[] = [];

  const intercom = raw['intercom'] as
    | Record<string, { data?: { item?: Record<string, unknown> } }>
    | undefined;
  if (intercom) {
    for (const [event, payload] of Object.entries(intercom)) {
      const item = payload?.data?.item ?? {};
      const src = (item as { source?: { body?: string } }).source;
      const last = (item as { last_message?: { body?: string } }).last_message;
      const body = src?.body ?? last?.body;
      if (body) docs.push({ scenario, source: 'intercom', kind: event, text: body });
    }
  }

  const upvoty = raw['upvoty'] as
    | {
        posts?: Array<{ title?: string; description?: string }>;
        comments?: Array<{ body?: string }>;
      }
    | undefined;
  if (upvoty) {
    for (const p of upvoty.posts ?? []) {
      const text = [p.title, p.description].filter(Boolean).join('\n\n');
      if (text) docs.push({ scenario, source: 'upvoty', kind: 'post', text });
    }
    for (const c of upvoty.comments ?? []) {
      if (c.body) docs.push({ scenario, source: 'upvoty', kind: 'comment', text: c.body });
    }
  }

  const slack = raw['slack'] as { content?: Array<{ text?: string }> } | undefined;
  if (slack?.content) {
    for (const m of slack.content) {
      if (m.text) docs.push({ scenario, source: 'slack', kind: 'message', text: m.text });
    }
  }

  const jira = raw['jira'] as
    | { issues?: Array<{ summary?: string; descriptionText?: string }> }
    | undefined;
  if (jira?.issues) {
    for (const i of jira.issues) {
      const text = [i.summary, i.descriptionText].filter(Boolean).join('\n\n');
      if (text) docs.push({ scenario, source: 'jira', kind: 'issue', text });
    }
  }

  return docs;
}

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

async function main(): Promise<void> {
  const files = readdirSync(FIXTURE_DIR).filter((f) => /^pwx_ideen_.*\.json$/.test(f));
  const docs: Doc[] = [];
  for (const f of files) docs.push(...extractFromScenario(f));

  console.log(`extracted ${docs.length} docs across ${files.length} scenario files`);
  for (const f of files) {
    const n = docs.filter(
      (d) => d.scenario === JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')).scenario_id,
    ).length;
    console.log(`  ${f}: ${n} docs`);
  }

  const embedder = createEmbedder();
  const vectors: number[][] = [];
  for (const d of docs) {
    const v = await embedder.embed(d.text.slice(0, 24000));
    vectors.push(v);
  }
  console.log(`embedded ${vectors.length} vectors (dim=${vectors[0]?.length})`);

  const within: number[] = [];
  const between: number[] = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const d = cosineDistance(vectors[i]!, vectors[j]!);
      if (docs[i]!.scenario === docs[j]!.scenario) within.push(d);
      else between.push(d);
    }
  }

  const stats = (
    xs: number[],
  ): {
    n: number;
    min: number;
    p25: number;
    med: number;
    p75: number;
    max: number;
    mean: number;
  } => {
    const s = [...xs].sort((a, b) => a - b);
    const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
    return {
      n: s.length,
      min: s[0]!,
      p25: q(0.25),
      med: q(0.5),
      p75: q(0.75),
      max: s[s.length - 1]!,
      mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    };
  };
  console.log('\nintra-scenario distances (should be small):', stats(within));
  console.log('inter-scenario distances (should be large):', stats(between));

  console.log('\nfraction below threshold 0.30:');
  console.log(`  intra: ${(within.filter((d) => d <= 0.3).length / within.length).toFixed(2)}`);
  console.log(`  inter: ${(between.filter((d) => d <= 0.3).length / between.length).toFixed(2)}`);

  const thresholds = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];
  console.log('\nseparation table (recall = intra<=t, false-merge = inter<=t):');
  console.log('  threshold | recall | false-merge');
  for (const t of thresholds) {
    const r = within.filter((d) => d <= t).length / within.length;
    const fm = between.filter((d) => d <= t).length / between.length;
    console.log(`  ${t.toFixed(2)}      | ${r.toFixed(2)}   | ${fm.toFixed(2)}`);
  }

  console.log(
    '\ncentroid recovery (per scenario, mean dist of members to centroid vs nearest other-scenario centroid):',
  );
  const scenarios = [...new Set(docs.map((d) => d.scenario))];
  const centroids = new Map<string, number[]>();
  for (const s of scenarios) {
    const idxs = docs
      .map((d, i) => [d, i] as const)
      .filter(([d]) => d.scenario === s)
      .map(([, i]) => i);
    const dim = vectors[0]!.length;
    const c = new Array<number>(dim).fill(0);
    for (const i of idxs) for (let k = 0; k < dim; k++) c[k]! += vectors[i]![k]!;
    for (let k = 0; k < dim; k++) c[k]! /= idxs.length;
    centroids.set(s, c);
  }
  for (const s of scenarios) {
    const c = centroids.get(s)!;
    const idxs = docs
      .map((d, i) => [d, i] as const)
      .filter(([d]) => d.scenario === s)
      .map(([, i]) => i);
    const meanIntra =
      idxs.map((i) => cosineDistance(vectors[i]!, c)).reduce((a, b) => a + b, 0) / idxs.length;
    const otherDists = scenarios
      .filter((s2) => s2 !== s)
      .map((s2) => cosineDistance(c, centroids.get(s2)!));
    const nearestOther = Math.min(...otherDists);
    const verdict = meanIntra < nearestOther ? 'separable' : 'OVERLAPS';
    console.log(
      `  ${s}: members→centroid mean=${meanIntra.toFixed(3)}, nearest other centroid=${nearestOther.toFixed(3)} [${verdict}]`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
