import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AgentConfig, AgentResult, ToolSpec } from './types';

const DEFAULT_MAX_TURNS = 6;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TOOL_RESULT_BYTES = 50_000;

let sharedClient: Anthropic | null = null;
function getDefaultClient(): Anthropic {
  if (sharedClient) return sharedClient;
  const opts: ConstructorParameters<typeof Anthropic>[0] = {};
  if (process.env['ANTHROPIC_BASE_URL']) opts.baseURL = process.env['ANTHROPIC_BASE_URL'];
  sharedClient = new Anthropic(opts);
  return sharedClient;
}

type ToolDef = Anthropic.Messages.Tool;

const toolDefCache = new WeakMap<ReadonlyArray<ToolSpec>, ToolDef[]>();
function toolsToAnthropic(tools: ReadonlyArray<ToolSpec>): ToolDef[] {
  const cached = toolDefCache.get(tools);
  if (cached) return cached;
  const defs: ToolDef[] = tools.map((t, i) => {
    const def: ToolDef = {
      name: t.name,
      description: t.description,
      input_schema: z.toJSONSchema(t.inputSchema, {
        target: 'draft-7',
      }) as Anthropic.Messages.Tool.InputSchema,
    };
    // cache_control on the final tool extends caching to all preceding tools.
    if (i === tools.length - 1) def.cache_control = { type: 'ephemeral' };
    return def;
  });
  toolDefCache.set(tools, defs);
  return defs;
}

function findTool(tools: ReadonlyArray<ToolSpec>, name: string): ToolSpec | undefined {
  return tools.find((t) => t.name === name);
}

function truncateToolContent(content: string, limit: number): string {
  if (content.length <= limit) return content;
  const head = content.slice(0, limit);
  const dropped = content.length - limit;
  return `${head}\n…[truncated ${dropped} chars to fit tool result limit]`;
}

async function runToolCall(
  tools: ReadonlyArray<ToolSpec>,
  toolUse: Anthropic.Messages.ToolUseBlock,
  resultByteLimit: number,
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
      content: truncateToolContent(JSON.stringify(result, jsonReplacer), resultByteLimit),
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

function buildSystemBlocks(system: string): Anthropic.Messages.TextBlockParam[] {
  return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
}

export async function runAgent<TInput, TOutput>(
  config: AgentConfig<TInput, TOutput>,
  input: TInput,
): Promise<AgentResult<TOutput>> {
  const client = config.client ?? getDefaultClient();
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const toolResultByteLimit = config.toolResultByteLimit ?? DEFAULT_TOOL_RESULT_BYTES;
  const systemText =
    typeof config.systemPrompt === 'function' ? config.systemPrompt(input) : config.systemPrompt;
  const system = buildSystemBlocks(systemText);
  const tools = toolsToAnthropic(config.tools);

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: config.userPrompt(input) },
  ];

  let retryUsed = false;
  const tryRetry = (response: Anthropic.Messages.Message, nudge: string): boolean => {
    if (retryUsed) return false;
    retryUsed = true;
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: nudge });
    return true;
  };

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

      const toolResults = await Promise.all(
        toolUses.map((tu) => runToolCall(config.tools, tu, toolResultByteLimit)),
      );

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
      const text = extractFinalText(response.content);
      const candidate = extractJsonCandidate(text);

      if (!candidate) {
        if (
          tryRetry(
            response,
            'No JSON found in your response. Reply ONLY with a JSON object that matches the schema.',
          )
        )
          continue;
        return {
          output: config.fallback(input, 'no JSON found in final response'),
          metadata: { turns: turn, fallback_reason: 'no_json_found' },
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(candidate);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (
          tryRetry(
            response,
            `Your response was not valid JSON: ${reason}. Reply ONLY with a valid JSON object that matches the schema.`,
          )
        )
          continue;
        return {
          output: config.fallback(input, `JSON parse failed twice: ${reason}`),
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

      if (
        tryRetry(
          response,
          `Your response did not match the required schema. Issues: ${JSON.stringify(
            validated.error.issues,
          )}. Reply ONLY with a corrected JSON object.`,
        )
      )
        continue;
      return {
        output: config.fallback(
          input,
          `schema validation failed twice: ${validated.error.message}`,
        ),
        metadata: { turns: turn, fallback_reason: 'schema_validation_failed' },
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
