import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IntercomSnapshot } from './intercom/schema';
import { JiraSnapshot } from './jira/schema';
import { SlackSnapshot } from './slack/schema';
import { UpvotySnapshot } from './upvoty/schema';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'fixtures');

const cases = [
  { name: 'intercom', file: 'intercom.json', schema: IntercomSnapshot },
  { name: 'jira', file: 'jira.json', schema: JiraSnapshot },
  { name: 'slack', file: 'slack.json', schema: SlackSnapshot },
  { name: 'upvoty', file: 'upvoty.json', schema: UpvotySnapshot },
] as const;

describe('fixture conformance', () => {
  for (const { name, file, schema } of cases) {
    it(`${name} fixture parses against connector schema`, async () => {
      const raw = await readFile(path.join(FIXTURE_DIR, file), 'utf8');
      const result = schema.safeParse(JSON.parse(raw));
      if (!result.success) {
        throw new Error(
          `Fixture ${file} does not match schema: ${JSON.stringify(result.error.issues, null, 2)}`,
        );
      }
      expect(result.success).toBe(true);
    });
  }
});
