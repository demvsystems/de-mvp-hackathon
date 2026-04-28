import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const DEFAULT_JUDGE_MODEL = 'claude-haiku-4-5-20251001';

const JudgeVerdict = z.object({
  score: z.number().min(0).max(1),
  notes: z.string().optional(),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

let sharedClient: Anthropic | null = null;
function getClient(): Anthropic {
  if (sharedClient) return sharedClient;
  const opts: ConstructorParameters<typeof Anthropic>[0] = {};
  if (process.env['AZURE_OPENAI_API_KEY']) opts.apiKey = process.env['AZURE_OPENAI_API_KEY'];
  if (process.env['ANTHROPIC_BASE_URL']) opts.baseURL = process.env['ANTHROPIC_BASE_URL'];
  sharedClient = new Anthropic(opts);
  return sharedClient;
}

export interface JudgeRequest {
  readonly model?: string;
  readonly system: string;
  readonly user: string;
}

export async function judge(req: JudgeRequest): Promise<JudgeVerdict> {
  const client = getClient();
  const model = req.model ?? DEFAULT_JUDGE_MODEL;
  const response = await client.messages.create({
    model,
    max_tokens: 512,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
    temperature: 0,
  });

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`judge response did not contain JSON: ${text.slice(0, 200)}`);
  }
  const json: unknown = JSON.parse(text.slice(firstBrace, lastBrace + 1));
  return JudgeVerdict.parse(json);
}
