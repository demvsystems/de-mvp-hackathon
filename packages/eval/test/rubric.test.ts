import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { reviewerAgent } from '@repo/agent/reviewer';
import {
  loadFixtures,
  loadRubric,
  scoreFixture,
  seedFixture,
  shutdownLangfuse,
  truncateAll,
  type Fixture,
} from '../src';
import { characterMatch } from '../src/criteria/character-match';
import { toolSelection } from '../src/criteria/tool-selection';

const REPO_ROOT = resolve(__dirname, '../../..');
const RUBRIC_PATH = resolve(REPO_ROOT, 'eval/rubric.yaml');
const GOLDEN_DIR = resolve(REPO_ROOT, 'eval/golden');

// Opt-in only: hits a live Anthropic API + Postgres on every run, so it must
// not fire from pre-push or CI by accident. Set EVAL_LIVE=1 alongside the
// credentials to actually run it.
const liveDeps =
  process.env['EVAL_LIVE'] === '1' &&
  Boolean(process.env['DATABASE_URL_EVAL'] && process.env['AZURE_OPENAI_API_KEY']);

describe('rubric scaffolding', () => {
  it('loads rubric.yaml and parses every criterion', async () => {
    const rubric = await loadRubric(RUBRIC_PATH);
    expect(rubric.criteria.length).toBeGreaterThan(0);
    expect(rubric.criteria.map((c) => c.id)).toContain('character_match');
  });

  it('loads every golden fixture against the schema', async () => {
    const fixtures = await loadFixtures(GOLDEN_DIR);
    expect(fixtures.length).toBeGreaterThanOrEqual(3);
    const categories = new Set(fixtures.map((f) => f.category));
    expect(categories).toEqual(new Set(['happy', 'edge', 'adversarial']));
  });

  it('character_match returns 1 on exact match, 0 otherwise', async () => {
    const fixtures = await loadFixtures(GOLDEN_DIR);
    const happy = fixtures.find((f) => f.id === 'happy-bipro-attention') as Fixture;
    const cfg = { id: 'character_match', kind: 'code' as const, weight: 0.3 };

    const hit = characterMatch({
      fixture: happy,
      output: stubOutput('attention'),
      toolCalls: [],
      config: cfg,
    });
    expect((await hit).score).toBe(1);

    const miss = characterMatch({
      fixture: happy,
      output: stubOutput('calm'),
      toolCalls: [],
      config: cfg,
    });
    expect((await miss).score).toBe(0);
  });

  it('tool_selection scores F1 over required vs actual tool calls', async () => {
    const fixtures = await loadFixtures(GOLDEN_DIR);
    const happy = fixtures.find((f) => f.id === 'happy-bipro-attention') as Fixture;
    const cfg = { id: 'tool_selection', kind: 'code' as const, weight: 0.1 };

    const allRequired = await toolSelection({
      fixture: happy,
      output: stubOutput('attention'),
      toolCalls: [
        { name: 'get_topics', input: {}, turn: 1 },
        { name: 'get_records', input: {}, turn: 2 },
      ],
      config: cfg,
    });
    expect(allRequired.score).toBe(1);

    const halfMissing = await toolSelection({
      fixture: happy,
      output: stubOutput('attention'),
      toolCalls: [{ name: 'get_topics', input: {}, turn: 1 }],
      config: cfg,
    });
    expect(halfMissing.score).toBeGreaterThan(0);
    expect(halfMissing.score).toBeLessThan(1);

    const noneCalled = await toolSelection({
      fixture: happy,
      output: stubOutput('attention'),
      toolCalls: [],
      config: cfg,
    });
    expect(noneCalled.score).toBe(0);
  });
});

describe.skipIf(!liveDeps)('rubric end-to-end (live deps)', () => {
  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await shutdownLangfuse();
  });

  it('seeds the happy fixture, runs reviewerAgent, scores against rubric', async () => {
    const rubric = await loadRubric(RUBRIC_PATH);
    const fixtures = await loadFixtures(GOLDEN_DIR);
    const happy = fixtures.find((f) => f.id === 'happy-bipro-attention') as Fixture;

    await truncateAll();
    await seedFixture(happy);

    const result = await reviewerAgent({
      topicId: happy.topic.id,
      triggeredBy: 'eval',
    });

    const report = await scoreFixture(happy, result.output, result.metadata.tool_calls, rubric);

    console.log(JSON.stringify(report, null, 2));
    expect(report.criteria.length).toBe(rubric.criteria.length);
  });
});

function stubOutput(character: 'attention' | 'opportunity' | 'noteworthy' | 'calm') {
  return {
    character,
    escalation_score: 0.5,
    summary: { text: 'stub', covers_record_ids: [] },
    reasoning: { key_signals: ['stub'], key_artifacts: [] },
  };
}
