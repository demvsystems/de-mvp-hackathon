import { runAgent } from '@repo/agent';
import { z } from 'zod';
import type { GeneratePreviewRequest } from './generate-schemas';

const AiContentSchema = z.object({
  content: z.record(z.string(), z.unknown()),
});

const AiPayloadSchema = z.object({
  items: z.array(AiContentSchema),
});

export type ClaudePreviewPayload = z.infer<typeof AiPayloadSchema>;

function resolveFixtureClaudeModel(): string {
  return (
    process.env['FIXTURE_CLAUDE_MODEL'] ?? process.env['LLM_REVIEWER_MODEL'] ?? 'claude-sonnet-4-6'
  );
}

export async function generatePreviewWithClaude(args: {
  input: GeneratePreviewRequest;
  template: Record<string, unknown>;
}): Promise<ClaudePreviewPayload> {
  const model = resolveFixtureClaudeModel();
  const { output } = await runAgent(
    {
      name: 'fixture-generator-preview',
      model,
      systemPrompt:
        'Generate synthetic dummy JSON fixtures only. No markdown. No prose. Use [DUMMY] markers in user-visible text. Use only safe domains: example.com, example.org, example.net, example.test. Avoid real personal or company data.',
      userPrompt: () =>
        JSON.stringify({
          task: 'Generate preview content items for fixture generation',
          source: args.input.source,
          requestedCount: args.input.count,
          topic: args.input.topic,
          product: args.input.product,
          category: args.input.category,
          language: args.input.language,
          detailLevel: args.input.detailLevel ?? 'medium',
          severity: args.input.severity ?? 'medium',
          sentiment: args.input.sentiment ?? 'neutral',
          template: args.template,
          outputShape: {
            items: [{ content: {} }],
          },
        }),
      tools: [],
      outputSchema: AiPayloadSchema,
      fallback: (_input, reason) => {
        throw new Error(`Claude output invalid: ${reason}`);
      },
      maxTurns: 2,
      maxTokens: 4096,
      temperature: 0.3,
    },
    args.input,
  );

  return output;
}
