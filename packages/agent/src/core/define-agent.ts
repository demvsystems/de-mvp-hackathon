import { runAgent } from './runtime';
import type { Agent, AgentCallOptions, AgentConfig, AgentResumeOptions } from './types';

export function defineAgent<TInput, TOutput>(
  config: AgentConfig<TInput, TOutput>,
): Agent<TInput, TOutput> {
  return (input: TInput, resume?: AgentResumeOptions, options?: AgentCallOptions) => {
    const merged: AgentConfig<TInput, TOutput> = options?.onEvent
      ? { ...config, onEvent: options.onEvent }
      : config;
    return runAgent(merged, input, resume);
  };
}
