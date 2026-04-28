import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AgentConfig, AgentResult, ToolSpec } from './types';

const DEFAULT_MAX_TURNS = 6;
const DEFAULT_MAX_TOKENS = 4096;

let sharedClient: Anthropic | null = null;
function getDefaultClient(): Anthropic {
  if (sharedClient) return sharedClient;
  const opts: ConstructorParameters<typeof Anthropic>[0] = {};
  if (process.env['ANTHROPIC_BASE_URL']) opts.baseURL = process.env['ANTHROPIC_BASE_URL'];
  sharedClient = new Anthropic(opts);
  return sharedClient;
}

interface ToolDef {
  name: string;
  description: string;
  input_schema: Anthropic.Messages.Tool.InputSchema;
}

function toolsToAnthropic(tools: ReadonlyArray<ToolSpec>): ToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.inputSchema, {
      target: 'draft-7',
    }) as Anthropic.Messages.Tool.InputSchema,
  }));
}

function findTool(tools: ReadonlyArray<ToolSpec>, name: string): ToolSpec | undefined {
  return tools.find((t) => t.name === name);
}

async function runToolCall(
  tools: ReadonlyArray<ToolSpec>,
  toolUse: Anthropic.Messages.ToolUseBlock,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const tool = findTool(tools, toolUse.name);
  if (!tool) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      is_error: true,
      content: JSON.stringify({ error: `Unknown tool: ${toolUse.name}` }),
    };
  }

  const parsed = tool.inputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      is_error: true,
      content: JSON.stringify({
        error: 'Invalid tool input',
        issues: parsed.error.issues,
      }),
    };
  }

  try {
    const result = await tool.handler(parsed.data);
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: JSON.stringify(result, jsonReplacer),
    };
  } catch (err) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      is_error: true,
      content: JSON.stringify({
        error: 'Tool handler threw',
        message: err instanceof Error ? err.message : String(err),
      }),
    };
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function extractFinalText(blocks: Anthropic.Messages.ContentBlock[]): string {
  return blocks
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function extractJsonCandidate(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced && fenced[1]) return fenced[1].trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

export async function runAgent<TInput, TOutput>(
  config: AgentConfig<TInput, TOutput>,
  input: TInput,
): Promise<AgentResult<TOutput>> {
  const client = config.client ?? getDefaultClient();
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const system =
    typeof config.systemPrompt === 'function' ? config.systemPrompt(input) : config.systemPrompt;
  const tools = toolsToAnthropic(config.tools);

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: config.userPrompt(input) },
  ];

  let validationRetried = false;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const requestParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: config.model,
      max_tokens: maxTokens,
      system,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
    };
    if (config.temperature !== undefined) requestParams.temperature = config.temperature;

    const response = await client.messages.create(requestParams);

    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );

      const toolResults = await Promise.all(toolUses.map((tu) => runToolCall(config.tools, tu)));

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
      const text = extractFinalText(response.content);
      const candidate = extractJsonCandidate(text);

      if (candidate) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(candidate);
        } catch (err) {
          if (!validationRetried) {
            validationRetried = true;
            messages.push({ role: 'assistant', content: response.content });
            messages.push({
              role: 'user',
              content: `Your response was not valid JSON: ${
                err instanceof Error ? err.message : String(err)
              }. Reply ONLY with a valid JSON object that matches the schema.`,
            });
            continue;
          }
          return {
            output: config.fallback(input, `JSON parse failed twice: ${String(err)}`),
            metadata: { turns: turn, fallback_reason: 'json_parse_failed' },
          };
        }

        const validated = config.outputSchema.safeParse(parsed);
        if (validated.success) {
          return {
            output: validated.data,
            metadata: { turns: turn, fallback_reason: null },
          };
        }

        if (!validationRetried) {
          validationRetried = true;
          messages.push({ role: 'assistant', content: response.content });
          messages.push({
            role: 'user',
            content: `Your response did not match the required schema. Issues: ${JSON.stringify(
              validated.error.issues,
            )}. Reply ONLY with a corrected JSON object.`,
          });
          continue;
        }
        return {
          output: config.fallback(
            input,
            `schema validation failed twice: ${validated.error.message}`,
          ),
          metadata: { turns: turn, fallback_reason: 'schema_validation_failed' },
        };
      }

      if (!validationRetried) {
        validationRetried = true;
        messages.push({ role: 'assistant', content: response.content });
        messages.push({
          role: 'user',
          content:
            'No JSON found in your response. Reply ONLY with a JSON object that matches the schema.',
        });
        continue;
      }
      return {
        output: config.fallback(input, 'no JSON found in final response'),
        metadata: { turns: turn, fallback_reason: 'no_json_found' },
      };
    }

    return {
      output: config.fallback(input, `unexpected stop_reason: ${response.stop_reason}`),
      metadata: { turns: turn, fallback_reason: `stop_reason:${response.stop_reason}` },
    };
  }

  return {
    output: config.fallback(input, `max_turns (${maxTurns}) exceeded`),
    metadata: { turns: maxTurns, fallback_reason: 'max_turns_exceeded' },
  };
}
