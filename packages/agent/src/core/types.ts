import type Anthropic from '@anthropic-ai/sdk';
import type { LangfuseClient } from '@langfuse/client';
import type { z } from 'zod';

export interface ToolSpec<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  // Terminal tools end the run when their payload also satisfies the agent's
  // output schema.
  readonly terminal?: boolean;
  // Method signature (not arrow property) — relies on TypeScript's bivariant
  // method check so heterogeneous ToolSpec[] arrays accept handlers with
  // narrower input types than `unknown`.
  handler(input: TInput): Promise<TOutput> | TOutput;
}

export interface SystemPromptRef {
  readonly kind: 'langfuse';
  readonly name: string;
  readonly label?: string;
  readonly version?: number;
  readonly fallback: string;
}

export type SystemPrompt<TInput> = string | ((input: TInput) => string) | SystemPromptRef;
export type UserPromptBuilder<TInput> = (input: TInput) => string;
export type FallbackBuilder<TInput, TOutput> = (input: TInput, reason: string) => TOutput;
export type AgentTagBuilder<TInput> = (input: TInput) => ReadonlyArray<string>;
export type AgentMetadataBuilder<TInput> = (input: TInput) => Record<string, unknown> | undefined;

export interface AgentObservabilityConfig<TInput, TOutput> {
  readonly traceName?: string | ((input: TInput) => string);
  readonly traceInput?: (input: TInput) => unknown;
  readonly traceOutput?: (output: TOutput) => unknown;
  readonly sessionId?: (input: TInput) => string | undefined;
  readonly userId?: (input: TInput) => string | undefined;
  readonly tags?: ReadonlyArray<string> | AgentTagBuilder<TInput>;
  readonly metadata?: AgentMetadataBuilder<TInput>;
}

export interface AgentConfig<TInput, TOutput> {
  readonly name: string;
  readonly model: string;
  readonly systemPrompt: SystemPrompt<TInput>;
  readonly userPrompt: UserPromptBuilder<TInput>;
  readonly tools: ReadonlyArray<ToolSpec>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly fallback: FallbackBuilder<TInput, TOutput>;
  readonly maxTurns?: number;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly client?: Anthropic;
  readonly toolResultByteLimit?: number;
  readonly langfuse?: LangfuseClient | null;
  readonly observability?: AgentObservabilityConfig<TInput, TOutput>;
  readonly onEvent?: AgentEventListener;
}

export interface PromptResolution {
  readonly name: string | null;
  readonly version: number | null;
  readonly label: string | null;
  readonly from_fallback: boolean;
}

export interface ToolCallRecord {
  readonly name: string;
  readonly input: unknown;
  readonly turn: number;
}

export type AgentEvent =
  | { readonly type: 'turn_start'; readonly turn: number }
  | {
      readonly type: 'tool_call';
      readonly turn: number;
      readonly name: string;
      readonly input: unknown;
    }
  | {
      readonly type: 'tool_result';
      readonly turn: number;
      readonly name: string;
      readonly ok: boolean;
      readonly bytes: number;
    }
  | { readonly type: 'assistant_text'; readonly turn: number; readonly text: string }
  | {
      readonly type: 'final';
      readonly turn: number;
      readonly trace_id: string | null;
      readonly trace_url: string | null;
      readonly fallback_reason: string | null;
    }
  | { readonly type: 'error'; readonly message: string };

export type AgentEventListener = (event: AgentEvent) => void;

export interface AgentRunMetadata {
  readonly turns: number;
  readonly fallback_reason: string | null;
  readonly prompt: PromptResolution;
  readonly tool_calls: ToolCallRecord[];
  readonly trace_id: string | null;
  readonly trace_url: string | null;
}

export interface AgentResult<TOutput> {
  readonly output: TOutput;
  readonly metadata: AgentRunMetadata;
  readonly messages: ReadonlyArray<Anthropic.Messages.MessageParam>;
}

export interface AgentResumeOptions {
  readonly priorMessages: ReadonlyArray<Anthropic.Messages.MessageParam>;
  readonly nextUserMessage: string;
}

export interface AgentCallOptions {
  readonly onEvent?: AgentEventListener;
}

export type Agent<TInput, TOutput> = (
  input: TInput,
  resume?: AgentResumeOptions,
  options?: AgentCallOptions,
) => Promise<AgentResult<TOutput>>;
