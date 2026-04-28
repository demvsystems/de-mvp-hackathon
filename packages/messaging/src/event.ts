import type { z } from 'zod';

export interface EventDefinition<T = unknown> {
  readonly subject: string;
  readonly schema: z.ZodType<T>;
}

export function defineEvent<S extends z.ZodType>(opts: {
  subject: string;
  schema: S;
}): EventDefinition<z.infer<S>> {
  return {
    subject: opts.subject,
    schema: opts.schema as unknown as z.ZodType<z.infer<S>>,
  };
}
