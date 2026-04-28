import Anthropic from '@anthropic-ai/sdk';
import type { TextPromptClient } from '@langfuse/client';
import { type LangfuseAgent, type LangfuseGeneration, startObservation } from '@langfuse/tracing';
import { z } from 'zod';
import {
  applyLangfuseTraceContext,
  ensureLangfuseTracing,
  flushLangfuse,
  getDefaultLangfuseClient,
} from './langfuse';
import type {
  AgentConfig,
  AgentResult,
  AgentRunMetadata,
  PromptResolution,
  SystemPrompt,
  SystemPromptRef,
  ToolCallRecord,
  ToolSpec,
} from './types';

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

function isPromptRef<TInput>(p: SystemPrompt<TInput>): p is SystemPromptRef {
  return typeof p === 'object' && p !== null && 'kind' in p && p.kind === 'langfuse';
}

interface ResolvedPrompt {
  readonly text: string;
  readonly resolution: PromptResolution;
  readonly promptClient: TextPromptClient | null;
}

async function resolveSystemPrompt<TInput>(
  systemPrompt: SystemPrompt<TInput>,
  input: TInput,
  langfuse: ReturnType<typeof getDefaultLangfuseClient>,
): Promise<ResolvedPrompt> {
  if (typeof systemPrompt === 'string') {
    return {
      text: systemPrompt,
      resolution: { name: null, version: null, label: null, from_fallback: false },
      promptClient: null,
    };
  }
  if (typeof systemPrompt === 'function') {
    return {
      text: systemPrompt(input),
      resolution: { name: null, version: null, label: null, from_fallback: false },
      promptClient: null,
    };
  }

  const ref = systemPrompt;
  if (!langfuse) {
    return {
      text: ref.fallback,
      resolution: {
        name: ref.name,
        version: null,
        label: ref.label ?? null,
        from_fallback: true,
      },
      promptClient: null,
    };
  }

  try {
    const client = await langfuse.prompt.get(ref.name, {
      ...(ref.version !== undefined ? { version: ref.version } : {}),
      ...(ref.label !== undefined ? { label: ref.label } : {}),
      fallback: ref.fallback,
      type: 'text',
    });
    return {
      text: client.compile(),
      resolution: {
        name: ref.name,
        version: client.promptResponse.version,
        label: ref.label ?? null,
        from_fallback: client.isFallback,
      },
      promptClient: client,
    };
  } catch (err) {
    console.warn(
      `[agent-core] failed to fetch prompt "${ref.name}" from Langfuse, using fallback: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return {
      text: ref.fallback,
      resolution: {
        name: ref.name,
        version: null,
        label: ref.label ?? null,
        from_fallback: true,
      },
      promptClient: null,
    };
  }
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
  parentObservation: LangfuseAgent | LangfuseGeneration | null,
  turn: number,
): Promise<Anthropic.Messages.ToolResultBlockParam> {
  const tool = findTool(tools, toolUse.name);
  const observation =
    parentObservation?.startObservation(
      `tool.${toolUse.name}`,
      {
        input: toolUse.input,
        metadata: {
          turn,
          tool_name: toolUse.name,
          tool_use_id: toolUse.id,
        },
      },
      { asType: 'tool' },
    ) ?? null;

  if (!tool) {
    observation?.update({
      level: 'ERROR',
      statusMessage: `Unknown tool: ${toolUse.name}`,
      output: { error: `Unknown tool: ${toolUse.name}` },
    });
    observation?.end();
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      is_error: true,
      content: JSON.stringify({ error: `Unknown tool: ${toolUse.name}` }),
    };
  }

  const parsed = tool.inputSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    observation?.update({
      level: 'ERROR',
      statusMessage: 'Invalid tool input',
      output: {
        error: 'Invalid tool input',
        issues: parsed.error.issues,
      },
    });
    observation?.end();
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
    const content = truncateToolContent(JSON.stringify(result, jsonReplacer), resultByteLimit);
    observation?.update({
      output: {
        content,
        is_error: false,
      },
    });
    observation?.end();
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content,
    };
  } catch (err) {
    observation?.update({
      level: 'ERROR',
      statusMessage: 'Tool handler threw',
      output: {
        error: 'Tool handler threw',
        message: err instanceof Error ? err.message : String(err),
      },
    });
    observation?.end();
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

function resolveTraceName<TInput, TOutput>(
  config: AgentConfig<TInput, TOutput>,
  input: TInput,
): string {
  const configured = config.observability?.traceName;
  if (typeof configured === 'function') return configured(input);
  if (typeof configured === 'string' && configured.length > 0) return configured;
  return config.name;
}

function resolveTraceTags<TInput, TOutput>(
  config: AgentConfig<TInput, TOutput>,
  input: TInput,
): string[] {
  const configured = config.observability?.tags;
  const dynamic = typeof configured === 'function' ? configured(input) : configured;
  return [...new Set([`agent:${config.name}`, ...(dynamic ?? [])])];
}

function buildUsageDetails(usage: Anthropic.Messages.Usage): Record<string, number> {
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
    total: usage.input_tokens + usage.output_tokens + cacheCreation + cacheRead,
  };
}

function serializeError(err: unknown): { message: string; name?: string; stack?: string } {
  if (err instanceof Error) {
    return {
      message: err.message,
      ...(err.name ? { name: err.name } : {}),
      ...(err.stack ? { stack: err.stack } : {}),
    };
  }
  return { message: String(err) };
}

function buildAgentObservationMetadata<TInput, TOutput>(
  config: AgentConfig<TInput, TOutput>,
  input: TInput,
  prompt: PromptResolution,
): Record<string, unknown> {
  return {
    agent_name: config.name,
    model: config.model,
    tool_names: config.tools.map((tool) => tool.name),
    prompt,
    ...(config.observability?.metadata?.(input) ?? {}),
  };
}

function buildRunMetadata(
  turns: number,
  fallbackReason: string | null,
  prompt: PromptResolution,
  toolCalls: ToolCallRecord[],
  traceId: string | null,
  traceUrl: string | null,
): AgentRunMetadata {
  return {
    turns,
    fallback_reason: fallbackReason,
    prompt,
    tool_calls: toolCalls,
    trace_id: traceId,
    trace_url: traceUrl,
  };
}

async function resolveTraceUrl(
  langfuse: ReturnType<typeof getDefaultLangfuseClient>,
  traceId: string | null,
): Promise<string | null> {
  if (!langfuse || !traceId) return null;
  try {
    return await langfuse.getTraceUrl(traceId);
  } catch (err) {
    console.warn(
      `[agent-core] failed to resolve Langfuse trace URL for trace ${traceId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

export async function runAgent<TInput, TOutput>(
  config: AgentConfig<TInput, TOutput>,
  input: TInput,
): Promise<AgentResult<TOutput>> {
  const client = config.client ?? getDefaultClient();
  const langfuse =
    config.langfuse !== undefined
      ? config.langfuse
      : isPromptRef(config.systemPrompt) || config.observability !== undefined
        ? getDefaultLangfuseClient()
        : null;
  const tracingEnabled = config.observability !== undefined && ensureLangfuseTracing();
  const maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const toolResultByteLimit = config.toolResultByteLimit ?? DEFAULT_TOOL_RESULT_BYTES;
  const resolved = await resolveSystemPrompt(config.systemPrompt, input, langfuse);
  const system = buildSystemBlocks(resolved.text);
  const tools = toolsToAnthropic(config.tools);
  const sessionId = config.observability?.sessionId?.(input);
  const userId = config.observability?.userId?.(input);
  const traceName = resolveTraceName(config, input);
  const traceInput = config.observability?.traceInput?.(input) ?? input;
  const rootMetadata = buildAgentObservationMetadata(config, input, resolved.resolution);
  const agentObservation = tracingEnabled
    ? startObservation(
        traceName,
        {
          input: traceInput,
          metadata: rootMetadata,
        },
        { asType: 'agent' },
      )
    : null;

  if (agentObservation) {
    applyLangfuseTraceContext(agentObservation, {
      traceName,
      ...(sessionId !== undefined ? { sessionId } : {}),
      ...(userId !== undefined ? { userId } : {}),
      tags: resolveTraceTags(config, input),
      metadata: rootMetadata,
    });
    agentObservation.setTraceIO({ input: traceInput });
  }

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: config.userPrompt(input) },
  ];
  const toolCalls: ToolCallRecord[] = [];
  let observationClosed = false;

  const closeObservation = async (
    output: unknown,
    metadata: Record<string, unknown>,
    level?: 'ERROR',
    statusMessage?: string,
  ): Promise<void> => {
    if (!agentObservation || observationClosed) return;

    agentObservation.update({
      output,
      metadata,
      ...(level !== undefined ? { level } : {}),
      ...(statusMessage !== undefined ? { statusMessage } : {}),
    });
    agentObservation.setTraceIO({ input: traceInput, output });
    agentObservation.end();
    observationClosed = true;
    await flushLangfuse();
  };

  const complete = async (
    output: TOutput,
    turns: number,
    fallbackReason: string | null,
  ): Promise<AgentResult<TOutput>> => {
    const traceOutput = config.observability?.traceOutput?.(output) ?? output;
    await closeObservation(traceOutput, {
      ...rootMetadata,
      turns,
      fallback_reason: fallbackReason,
      tool_calls: toolCalls,
    });

    const traceId = agentObservation?.traceId ?? null;
    const traceUrl = await resolveTraceUrl(langfuse, traceId);

    return {
      output,
      metadata: buildRunMetadata(
        turns,
        fallbackReason,
        resolved.resolution,
        toolCalls,
        traceId,
        traceUrl,
      ),
    };
  };

  let retryUsed = false;
  const tryRetry = (response: Anthropic.Messages.Message, nudge: string): boolean => {
    if (retryUsed) return false;
    retryUsed = true;
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: nudge });
    return true;
  };

  try {
    for (let turn = 1; turn <= maxTurns; turn++) {
      const requestParams: Anthropic.Messages.MessageCreateParamsNonStreaming = {
        model: config.model,
        max_tokens: maxTokens,
        system,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      };
      if (config.temperature !== undefined) requestParams.temperature = config.temperature;

      const generation =
        agentObservation?.startObservation(
          'anthropic.messages.create',
          {
            model: config.model,
            input: {
              system: resolved.text,
              messages,
              ...(tools.length > 0 ? { tools } : {}),
              max_tokens: maxTokens,
              ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
            },
            modelParameters: {
              max_tokens: maxTokens,
              ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
            },
            metadata: {
              turn,
              prompt: resolved.resolution,
            },
            ...(resolved.promptClient
              ? {
                  prompt: {
                    name: resolved.promptClient.name,
                    version: resolved.promptClient.version,
                    isFallback: resolved.promptClient.isFallback,
                  },
                }
              : {}),
          },
          { asType: 'generation' },
        ) ?? null;

      let response: Anthropic.Messages.Message;
      try {
        response = await client.messages.create(requestParams);
      } catch (err) {
        const error = serializeError(err);
        generation?.update({
          level: 'ERROR',
          statusMessage: 'anthropic.messages.create failed',
          output: error,
        });
        generation?.end();

        await closeObservation(
          error,
          {
            ...rootMetadata,
            failed_turn: turn,
            tool_calls: toolCalls,
          },
          'ERROR',
          'anthropic.messages.create failed',
        );
        throw err;
      }

      generation?.update({
        model: response.model,
        output: {
          content: response.content,
          stop_reason: response.stop_reason,
          stop_sequence: response.stop_sequence,
        },
        usageDetails: buildUsageDetails(response.usage),
        metadata: {
          turn,
          stop_reason: response.stop_reason,
        },
      });
      generation?.end();

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
        );

        for (const tu of toolUses) {
          toolCalls.push({ name: tu.name, input: tu.input, turn });
        }

        const toolResults = await Promise.all(
          toolUses.map((tu) =>
            runToolCall(
              config.tools,
              tu,
              toolResultByteLimit,
              generation ?? agentObservation,
              turn,
            ),
          ),
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
          return complete(
            config.fallback(input, 'no JSON found in final response'),
            turn,
            'no_json_found',
          );
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
          return complete(
            config.fallback(input, `JSON parse failed twice: ${reason}`),
            turn,
            'json_parse_failed',
          );
        }

        const validated = config.outputSchema.safeParse(parsed);
        if (validated.success) {
          return complete(validated.data, turn, null);
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
        return complete(
          config.fallback(input, `schema validation failed twice: ${validated.error.message}`),
          turn,
          'schema_validation_failed',
        );
      }

      return complete(
        config.fallback(input, `unexpected stop_reason: ${response.stop_reason}`),
        turn,
        `stop_reason:${response.stop_reason}`,
      );
    }
  } catch (err) {
    if (!observationClosed) {
      const error = serializeError(err);
      await closeObservation(
        error,
        {
          ...rootMetadata,
          tool_calls: toolCalls,
        },
        'ERROR',
        error.message,
      );
    }
    throw err;
  }

  return complete(
    config.fallback(input, `max_turns (${maxTurns}) exceeded`),
    maxTurns,
    'max_turns_exceeded',
  );
}
