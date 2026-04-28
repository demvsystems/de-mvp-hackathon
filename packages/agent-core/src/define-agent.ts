import { runAgent } from './runtime';
import type { Agent, AgentConfig } from './types';

export function defineAgent<TInput, TOutput>(
  config: AgentConfig<TInput, TOutput>,
): Agent<TInput, TOutput> {
  return (input: TInput) => runAgent(config, input);
}
