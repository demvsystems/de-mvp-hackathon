import type { z } from 'zod';
import type { SubjectKind } from './envelope';

export interface EventDefinition<TPayload = unknown> {
  readonly event_type: string;
  readonly subject_template: string;
  readonly subject_kind: SubjectKind;
  readonly schema_version: number;
  readonly payload: z.ZodType<TPayload>;
}

export function defineEvent<S extends z.ZodType>(opts: {
  event_type: string;
  subject_template: string;
  subject_kind: SubjectKind;
  payload: S;
  schema_version?: number;
}): EventDefinition<z.infer<S>> {
  return {
    event_type: opts.event_type,
    subject_template: opts.subject_template,
    subject_kind: opts.subject_kind,
    schema_version: opts.schema_version ?? 1,
    payload: opts.payload as unknown as z.ZodType<z.infer<S>>,
  };
}

export function renderSubject(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) {
      throw new Error(`renderSubject: missing variable "${key}" for template "${template}"`);
    }
    return value;
  });
}
