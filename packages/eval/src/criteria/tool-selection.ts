import type { Criterion } from './types';

// F1 over expected.tool_calls:
//   TP = required ∩ actual_unique
//   FP = forbidden ∩ actual_unique  (only forbidden counts as a precision miss;
//                                    other tool calls are allowed)
//   FN = required \ actual_unique
// score = F1; 1.0 when required is empty AND no forbidden was called.
export const toolSelection: Criterion = ({ fixture, toolCalls, config }) => {
  const required = new Set(fixture.expected.tool_calls.required);
  const forbidden = new Set(fixture.expected.tool_calls.forbidden);
  const actual = new Set(toolCalls.map((c) => c.name));

  const tp = [...required].filter((n) => actual.has(n)).length;
  const fp = [...forbidden].filter((n) => actual.has(n)).length;
  const fn = [...required].filter((n) => !actual.has(n)).length;

  if (required.size === 0 && forbidden.size === 0) {
    return {
      criterion: config.id,
      score: 1,
      notes: 'no expected.tool_calls declared; defaulting to pass',
    };
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const missing = [...required].filter((n) => !actual.has(n));
  const tripped = [...forbidden].filter((n) => actual.has(n));

  return {
    criterion: config.id,
    score: f1,
    notes: `precision=${precision.toFixed(2)} recall=${recall.toFixed(2)} f1=${f1.toFixed(
      2,
    )} missing=${JSON.stringify(missing)} forbidden_called=${JSON.stringify(tripped)} actual=${JSON.stringify(
      [...actual],
    )}`,
  };
};
