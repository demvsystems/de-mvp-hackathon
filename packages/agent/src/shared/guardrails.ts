import type { ToolCallRecord } from '../core';
import type { ActionPlan } from './action-plan';
import type { Playbook } from './playbook';

export type GuardrailFlag =
  | 'instruction_like'
  | 'tool_directive'
  | 'authority_claim'
  | 'urgency_spam'
  | 'secret_like'
  | 'pii_like'
  | 'encoded_injection';

export type AssessmentCharacterValue = 'attention' | 'opportunity' | 'noteworthy' | 'calm';

export interface EvidenceRecordShape {
  readonly id: string;
  readonly source: string;
  readonly type: string;
  readonly title: string | null;
  readonly body: string | null;
  readonly payload: unknown;
}

export interface EvidenceGuardrail {
  readonly untrusted: true;
  readonly flags: GuardrailFlag[];
  readonly risk_score: number;
  readonly excerpt: string | null;
}

export type GuardedEvidenceRecord<T extends EvidenceRecordShape> = T & {
  readonly guardrail: EvidenceGuardrail;
};

export interface AssessmentLike {
  topic: {
    label: string;
    description: string;
  };
  character: AssessmentCharacterValue;
  escalation_score: number;
  summary: {
    text: string;
    covers_record_ids: string[];
  };
  reasoning: {
    tldr?: string | undefined;
    key_signals: string[];
    key_artifacts: string[];
    additional_notes?: string | undefined;
  };
  recommended_action_plan: ActionPlan | null;
}

export interface GuardrailEvent {
  readonly stage: 'tool_result' | 'assessment_output';
  readonly rule_id: string;
  readonly severity: 'info' | 'warn' | 'error';
  readonly decision: 'allow' | 'flag' | 'downgrade' | 'block';
  readonly detail: string;
  readonly record_ids: string[];
}

export interface AssessmentGuardrailInput {
  readonly output: AssessmentLike;
  readonly allowedRecordIds: readonly string[];
  readonly suspiciousRecordIds?: readonly string[];
  readonly toolCalls: readonly ToolCallRecord[];
  readonly playbook?: Playbook | undefined;
}

export interface AssessmentGuardrailResult {
  readonly sanitized: AssessmentLike;
  readonly decision: 'allow' | 'downgrade' | 'block';
  readonly events: GuardrailEvent[];
  readonly fallbackReason: string | null;
}

type GuardrailEnv = Record<string, string | undefined>;

const INSTRUCTION_LIKE =
  /\b(ignore|disregard|forget|override|bypass|skip|emit|output|follow)\b[\s\S]{0,80}\b(instruction|instructions|prompt|system|schema|reviewer|prior|previous|above)\b/i;
const TOOL_DIRECTIVE =
  /\b(call|invoke|run|use|skip)\b[\s\S]{0,80}\b(get_[a-z_]+|mark_resolved|finish_review|tool|tools)\b/i;
const AUTHORITY_CLAIM =
  /\b(geschäftsführung|vorstand|management|leadership|executive|ceo|cto|vp|director|p0)\b/i;
const ENCODED_INJECTION =
  /\b(ignore_prior_instructions|set_character=|escalation=|skip evidence collection|reviewer instruction|system:\s|tooling:\s*```)\b/i;
const SECRET_PATTERNS = [
  /\b(xox[baprs]-[a-z0-9-]{10,})\b/i,
  /\b(gh[pousr]_[a-z0-9]{20,})\b/i,
  /\b(sk-[a-z0-9]{20,})\b/i,
  /\b(api[_ -]?key|access[_ -]?token|auth[_ -]?token|password|passwd|secret)\b\s*[:=]\s*["']?[^\s"']{6,}/i,
];
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /(?:\+?\d[\d\s()./-]{7,}\d)/;
const PHONE_PATTERN_GLOBAL = /(?:\+?\d[\d\s()./-]{7,}\d)/g;
const SLACK_TS_LIKE_ID = /^\d{9,13}\.\d{6}$/;
// German thousands grouping: "1.234.567", "60.000".
const FORMATTED_NUMBER_GROUP = /^\d{1,3}(?:\.\d{3})+$/;
// Range/list of formatted numbers separated by hyphen or slash:
// "12.000-15.000", "12.000 - 15.000", "12.000/15.000".
const FORMATTED_NUMBER_RANGE = /^\d{1,3}(?:\.\d{3})+\s*[-/]\s*\d{1,3}(?:\.\d{3})+$/;
// Year-only range: "2020-2024", "2020/2024".
const YEAR_RANGE = /^\d{4}\s*[-/]\s*\d{4}$/;
// Dotted version number with three or more groups: "1.2.3", "1.2.3.4.5".
const VERSION_LIKE = /^\d{1,3}(?:\.\d{1,3}){2,}$/;
const URGENCY_TERMS = [
  'dringend',
  'kritisch',
  'critical',
  'alarm',
  'urgent',
  'sofort',
  'eskalation',
  'escalation',
  'sev1',
  'p0',
];
const BLOCKING_TEXT_FLAGS = new Set<GuardrailFlag>([
  'instruction_like',
  'tool_directive',
  'encoded_injection',
  'secret_like',
  'pii_like',
]);
const SUSPICIOUS_RECORD_FLAGS = new Set<GuardrailFlag>([
  'instruction_like',
  'tool_directive',
  'authority_claim',
  'encoded_injection',
]);

function pushFlag(into: GuardrailFlag[], flag: GuardrailFlag): void {
  if (!into.includes(flag)) into.push(flag);
}

function serializePayload(payload: unknown): string {
  if (payload === null || payload === undefined) return '';
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function buildEvidenceText(record: EvidenceRecordShape): string {
  return [record.title ?? '', record.body ?? '', serializePayload(record.payload)]
    .filter((part) => part.length > 0)
    .join('\n');
}

function urgencyCount(text: string): number {
  const lower = text.toLowerCase();
  return URGENCY_TERMS.reduce(
    (count, term) => count + (lower.match(new RegExp(term, 'g'))?.length ?? 0),
    0,
  );
}

// Strukturierte, nicht-PII-artige Zahlenformen, die das breite PHONE_PATTERN
// einsammelt: Slack-Record-IDs, deutsche Tausendertrennung (Millionenangaben
// und Wertebereiche), Jahresspannen, Versionsnummern.
function looksLikeStructuredNumber(candidate: string): boolean {
  return (
    SLACK_TS_LIKE_ID.test(candidate) ||
    FORMATTED_NUMBER_GROUP.test(candidate) ||
    FORMATTED_NUMBER_RANGE.test(candidate) ||
    YEAR_RANGE.test(candidate) ||
    VERSION_LIKE.test(candidate)
  );
}

function hasPhoneLikePII(text: string): boolean {
  for (const match of text.matchAll(PHONE_PATTERN_GLOBAL)) {
    const candidate = match[0].trim();
    if (looksLikeStructuredNumber(candidate)) continue;
    return true;
  }
  return false;
}

export function detectGuardrailFlags(text: string): GuardrailFlag[] {
  if (text.trim().length === 0) return [];

  const flags: GuardrailFlag[] = [];
  if (INSTRUCTION_LIKE.test(text)) pushFlag(flags, 'instruction_like');
  if (TOOL_DIRECTIVE.test(text)) pushFlag(flags, 'tool_directive');
  if (AUTHORITY_CLAIM.test(text)) pushFlag(flags, 'authority_claim');
  if (ENCODED_INJECTION.test(text)) pushFlag(flags, 'encoded_injection');
  if (urgencyCount(text) >= 3) pushFlag(flags, 'urgency_spam');
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) pushFlag(flags, 'secret_like');
  if (EMAIL_PATTERN.test(text) || hasPhoneLikePII(text)) pushFlag(flags, 'pii_like');
  return flags;
}

function riskScore(flags: readonly GuardrailFlag[]): number {
  return flags.reduce((total, flag) => {
    switch (flag) {
      case 'instruction_like':
      case 'tool_directive':
      case 'encoded_injection':
        return total + 3;
      case 'secret_like':
      case 'pii_like':
        return total + 2;
      case 'authority_claim':
      case 'urgency_spam':
        return total + 1;
    }
  }, 0);
}

export function analyzeEvidenceRecord(record: EvidenceRecordShape): EvidenceGuardrail {
  const text = buildEvidenceText(record);
  const flags = detectGuardrailFlags(text);
  return {
    untrusted: true,
    flags,
    risk_score: riskScore(flags),
    excerpt: text.trim().length === 0 ? null : text.trim().slice(0, 240),
  };
}

export function annotateEvidenceRecord<T extends EvidenceRecordShape>(
  record: T,
): GuardedEvidenceRecord<T> {
  return {
    ...record,
    guardrail: analyzeEvidenceRecord(record),
  };
}

export function annotateEvidenceRecords<T extends EvidenceRecordShape>(
  records: readonly T[],
): GuardedEvidenceRecord<T>[] {
  return records.map((record) => annotateEvidenceRecord(record));
}

export function isSuspiciousRecord(
  guardrail: Pick<EvidenceGuardrail, 'flags'> | null | undefined,
): boolean {
  return (guardrail?.flags ?? []).some((flag) => SUSPICIOUS_RECORD_FLAGS.has(flag));
}

export function collectActionPlanRecordIds(plan: ActionPlan | null): string[] {
  if (plan === null) return [];

  const ids: string[] = [];
  for (const action of plan.actions) {
    if (action.kind === 'post_slack_message' && action.placement.mode === 'thread') {
      if (!ids.includes(action.placement.thread_root_record_id)) {
        ids.push(action.placement.thread_root_record_id);
      }
    }
    if (action.kind === 'reply_intercom' && !ids.includes(action.conversation_record_id)) {
      ids.push(action.conversation_record_id);
    }
  }
  return ids;
}

function cloneAssessment(output: AssessmentLike): AssessmentLike {
  return {
    topic: {
      label: output.topic.label,
      description: output.topic.description,
    },
    character: output.character,
    escalation_score: output.escalation_score,
    summary: {
      text: output.summary.text,
      covers_record_ids: [...output.summary.covers_record_ids],
    },
    reasoning: {
      ...(output.reasoning.tldr !== undefined ? { tldr: output.reasoning.tldr } : {}),
      key_signals: [...output.reasoning.key_signals],
      key_artifacts: [...output.reasoning.key_artifacts],
      ...(output.reasoning.additional_notes !== undefined
        ? { additional_notes: output.reasoning.additional_notes }
        : {}),
    },
    recommended_action_plan:
      output.recommended_action_plan === null
        ? null
        : {
            rationale: output.recommended_action_plan.rationale,
            actions: output.recommended_action_plan.actions.map((action) => ({ ...action })),
            cross_references: output.recommended_action_plan.cross_references.map((ref) => ({
              ...ref,
            })),
          },
  };
}

function extractAssessmentText(output: AssessmentLike): string {
  const planText =
    output.recommended_action_plan === null
      ? ''
      : [
          output.recommended_action_plan.rationale,
          ...output.recommended_action_plan.actions.map((action) => {
            switch (action.kind) {
              case 'create_jira_ticket':
                return `${action.title}\n${action.body}`;
              case 'post_slack_message':
                return action.body;
              case 'reply_intercom':
                return action.body;
              case 'no_action':
                return action.reason;
            }
          }),
        ].join('\n');

  return [
    output.topic.label,
    output.topic.description,
    output.summary.text,
    output.reasoning.tldr ?? '',
    output.reasoning.key_signals.join('\n'),
    output.reasoning.additional_notes ?? '',
    planText,
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

function event(events: GuardrailEvent[], item: GuardrailEvent): 'allow' | 'downgrade' | 'block' {
  events.push(item);
  return item.decision === 'block'
    ? 'block'
    : item.decision === 'downgrade'
      ? 'downgrade'
      : 'allow';
}

function mergeDecision(
  current: 'allow' | 'downgrade' | 'block',
  next: 'allow' | 'downgrade' | 'block',
): 'allow' | 'downgrade' | 'block' {
  if (current === 'block' || next === 'block') return 'block';
  if (current === 'downgrade' || next === 'downgrade') return 'downgrade';
  return 'allow';
}

export function validateAssessmentOutput(
  input: AssessmentGuardrailInput,
): AssessmentGuardrailResult {
  const sanitized = cloneAssessment(input.output);
  const allowedRecordIds = new Set(input.allowedRecordIds);
  const suspiciousRecordIds = new Set(input.suspiciousRecordIds ?? []);
  const events: GuardrailEvent[] = [];
  let decision: 'allow' | 'downgrade' | 'block' = 'allow';

  const invalidSummaryIds = sanitized.summary.covers_record_ids.filter(
    (id) => !allowedRecordIds.has(id),
  );
  if (invalidSummaryIds.length > 0) {
    decision = mergeDecision(
      decision,
      event(events, {
        stage: 'assessment_output',
        rule_id: 'summary_ids_out_of_scope',
        severity: 'error',
        decision: 'block',
        detail: 'summary.covers_record_ids referenced records outside the fetched topic scope',
        record_ids: invalidSummaryIds,
      }),
    );
  }

  const invalidArtifactIds = sanitized.reasoning.key_artifacts.filter(
    (id) => !allowedRecordIds.has(id),
  );
  if (invalidArtifactIds.length > 0) {
    decision = mergeDecision(
      decision,
      event(events, {
        stage: 'assessment_output',
        rule_id: 'artifact_ids_out_of_scope',
        severity: 'error',
        decision: 'block',
        detail: 'reasoning.key_artifacts referenced records outside the fetched topic scope',
        record_ids: invalidArtifactIds,
      }),
    );
  }

  const outputFlags = detectGuardrailFlags(extractAssessmentText(sanitized)).filter((flag) =>
    BLOCKING_TEXT_FLAGS.has(flag),
  );
  if (outputFlags.length > 0) {
    decision = mergeDecision(
      decision,
      event(events, {
        stage: 'assessment_output',
        rule_id: 'output_repeats_untrusted_directive',
        severity: 'error',
        decision: 'block',
        detail: `assessment text matched blocked guardrail flags: ${outputFlags.join(', ')}`,
        record_ids: [],
      }),
    );
  }

  if (!input.toolCalls.some((call) => call.name === 'get_records')) {
    decision = mergeDecision(
      decision,
      event(events, {
        stage: 'assessment_output',
        rule_id: 'records_not_loaded',
        severity: 'warn',
        decision: 'flag',
        detail: 'assessment completed without a get_records tool call',
        record_ids: [],
      }),
    );
  }

  const trustedArtifactIds = sanitized.reasoning.key_artifacts.filter(
    (id) => !suspiciousRecordIds.has(id),
  );
  if (
    sanitized.reasoning.key_artifacts.length > 0 &&
    trustedArtifactIds.length === 0 &&
    suspiciousRecordIds.size > 0
  ) {
    decision = mergeDecision(
      decision,
      event(events, {
        stage: 'assessment_output',
        rule_id: 'artifacts_only_from_suspicious_records',
        severity: 'warn',
        decision: 'flag',
        detail: 'all cited artifacts were themselves flagged as instruction-like or coercive',
        record_ids: sanitized.reasoning.key_artifacts,
      }),
    );
  }

  if (sanitized.character === 'calm' && sanitized.recommended_action_plan !== null) {
    sanitized.recommended_action_plan = null;
    decision = mergeDecision(
      decision,
      event(events, {
        stage: 'assessment_output',
        rule_id: 'calm_must_not_emit_action_plan',
        severity: 'warn',
        decision: 'downgrade',
        detail: 'recommended_action_plan was removed because calm topics must not propose actions',
        record_ids: [],
      }),
    );
  }

  if (sanitized.recommended_action_plan !== null) {
    const planRecordIds = collectActionPlanRecordIds(sanitized.recommended_action_plan);
    const invalidPlanRecordIds = planRecordIds.filter((id) => !allowedRecordIds.has(id));
    if (invalidPlanRecordIds.length > 0) {
      sanitized.recommended_action_plan = null;
      decision = mergeDecision(
        decision,
        event(events, {
          stage: 'assessment_output',
          rule_id: 'action_plan_ids_out_of_scope',
          severity: 'warn',
          decision: 'downgrade',
          detail: 'recommended_action_plan referenced records outside the fetched topic scope',
          record_ids: invalidPlanRecordIds,
        }),
      );
    }
  }

  if (
    sanitized.recommended_action_plan !== null &&
    sanitized.reasoning.key_artifacts.length === 0
  ) {
    sanitized.recommended_action_plan = null;
    decision = mergeDecision(
      decision,
      event(events, {
        stage: 'assessment_output',
        rule_id: 'action_plan_without_artifacts',
        severity: 'warn',
        decision: 'downgrade',
        detail: 'recommended_action_plan was removed because no key_artifacts were provided',
        record_ids: [],
      }),
    );
  }

  if (sanitized.recommended_action_plan !== null && input.playbook) {
    const allowedChannels = new Set([
      input.playbook.slack.channels.bug,
      input.playbook.slack.channels.feature,
      input.playbook.slack.channels.default,
    ]);
    const allowedProjects = new Set([
      input.playbook.jira.bug.project,
      input.playbook.jira.feature.project,
    ]);
    const allowedIssueTypes = new Set([
      input.playbook.jira.bug.issue_type,
      input.playbook.jira.feature.issue_type,
    ]);

    const invalidChannels = sanitized.recommended_action_plan.actions
      .filter(
        (
          action,
        ): action is Extract<ActionPlan['actions'][number], { kind: 'post_slack_message' }> =>
          action.kind === 'post_slack_message',
      )
      .map((action) => action.channel)
      .filter((channel) => !allowedChannels.has(channel));
    const invalidProjects = sanitized.recommended_action_plan.actions
      .filter(
        (
          action,
        ): action is Extract<ActionPlan['actions'][number], { kind: 'create_jira_ticket' }> =>
          action.kind === 'create_jira_ticket',
      )
      .map((action) => `${action.project}:${action.issue_type}`)
      .filter((projectAndType) => {
        const [project, issueType] = projectAndType.split(':');
        return !allowedProjects.has(project ?? '') || !allowedIssueTypes.has(issueType ?? '');
      });

    if (invalidChannels.length > 0 || invalidProjects.length > 0) {
      sanitized.recommended_action_plan = null;
      decision = mergeDecision(
        decision,
        event(events, {
          stage: 'assessment_output',
          rule_id: 'action_plan_violates_playbook',
          severity: 'warn',
          decision: 'downgrade',
          detail: `recommended_action_plan was removed because it proposed unsupported targets: channels=${JSON.stringify(invalidChannels)} jira=${JSON.stringify(invalidProjects)}`,
          record_ids: [],
        }),
      );
    }
  }

  return {
    sanitized,
    decision,
    events,
    fallbackReason:
      decision === 'block'
        ? events
            .filter((item) => item.decision === 'block')
            .map((item) => item.rule_id)
            .join(',')
        : null,
  };
}

export function reviewerGuardrailsEnabled(env: GuardrailEnv = process.env): boolean {
  return env['LLM_REVIEWER_DISABLE_GUARDRAILS'] !== '1';
}

export function applyReviewerAssessmentGuardrails(
  input: AssessmentGuardrailInput,
  env: GuardrailEnv = process.env,
): AssessmentGuardrailResult {
  if (!reviewerGuardrailsEnabled(env)) {
    return {
      sanitized: cloneAssessment(input.output),
      decision: 'allow',
      events: [],
      fallbackReason: null,
    };
  }

  return validateAssessmentOutput(input);
}
