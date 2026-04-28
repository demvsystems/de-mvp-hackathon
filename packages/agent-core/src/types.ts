import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';

export interface ToolSpec<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  // Method signature (not arrow property) — relies on TypeScript's bivariant
  // method check so heterogeneous ToolSpec[] arrays accept handlers with
  // narrower input types than `unknown`.
  handler(input: TInput): Promise<TOutput> | TOutput;
}

export type SystemPrompt<TInput> = string | ((input: TInput) => string);
export type UserPromptBuilder<TInput> = (input: TInput) => string;
export type FallbackBuilder<TInput, TOutput> = (input: TInput, reason: string) => TOutput;

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
}

export interface AgentRunMetadata {
  readonly turns: number;
  readonly fallback_reason: string | null;
}

export interface AgentResult<TOutput> {
  readonly output: TOutput;
  readonly metadata: AgentRunMetadata;
}

export type Agent<TInput, TOutput> = (input: TInput) => Promise<AgentResult<TOutput>>;
