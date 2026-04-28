import { z } from 'zod';
import { generatePreviewWithClaude } from './claude-generate-preview';
import {
  formatIntercomResponse,
  formatJiraResponse,
  formatSlackResponse,
  formatUpvotyResponse,
} from './formatters';
import {
  deepClone,
  ensureSafeFilename,
  formatFilename,
  isAllowedDomain,
  replaceUnsafeDomainsInString,
  stableSeedFromInput,
  toGeneratorContext,
  type GeneratorContext,
} from './generator-utils';
import {
  type GeneratePreviewRequest,
  type GeneratePreviewResponse,
  GeneratePreviewResponseSchema,
  type PreviewItem,
} from './generate-schemas';
import { type FixtureSource } from './sources';
import { loadRawTemplateForSource } from './template-loader';
import { validateGeneratedFixtures } from './validate-generated-fixtures';

function ensurePlainObject(value: unknown): Record<string, unknown> {
  const schema = z.record(z.string(), z.unknown());
  return schema.parse(value);
}

function runFormatter(
  source: FixtureSource,
  template: Record<string, unknown>,
  ctx: GeneratorContext,
  index: number,
): Record<string, unknown> {
  switch (source) {
    case 'jira':
      return formatJiraResponse(template, ctx, index);
    case 'slack':
      return formatSlackResponse(template, ctx, index);
    case 'upvoty':
      return formatUpvotyResponse(template, ctx, index);
    case 'intercom':
      return formatIntercomResponse(template, ctx, index);
  }
}

function ensureTemplateTopKeys(
  template: Record<string, unknown>,
  content: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...content };
  const topKeys = Object.keys(template);
  for (const key of topKeys) {
    if (!(key in out)) {
      out[key] = template[key];
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureDummyText(text: string): string {
  const safe = replaceUnsafeDomainsInString(text.trim());
  if (safe.includes('[DUMMY]')) return safe;
  return `[DUMMY] ${safe}`;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function buildSlackMessageText(
  input: GeneratePreviewRequest,
  index: number,
  candidate?: string | null,
): string {
  if (candidate) return ensureDummyText(candidate);
  return ensureDummyText(
    `[${input.product}] ${input.topic} (${input.category}, ${input.severity ?? 'medium'}, ${
      input.sentiment ?? 'neutral'
    }, ${input.language}) #${index + 1}`,
  );
}

function coerceSlackAiContent(
  template: Record<string, unknown>,
  aiContent: Record<string, unknown>,
  input: GeneratePreviewRequest,
): Record<string, unknown> {
  const cloned = deepClone(template);
  if (!isRecord(cloned)) {
    throw new Error('Slack template must be a top-level object');
  }

  const baseChannel = cloned['channel'];
  const baseParticipants = cloned['participants'];
  const baseContent = cloned['content'];
  if (!isRecord(baseChannel) || !Array.isArray(baseParticipants) || !Array.isArray(baseContent)) {
    throw new Error('Slack template missing required channel/participants/content shape');
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(cloned)) {
    out[key] = cloned[key];
  }

  const aiChannel = isRecord(aiContent['channel']) ? aiContent['channel'] : null;
  const channelOut = deepClone(baseChannel);
  if (!isRecord(channelOut)) {
    throw new Error('Slack channel template shape invalid');
  }
  const channelTopicCandidate =
    asString(aiChannel?.['topic']) ??
    asString(aiContent['topic']) ??
    `${input.topic} (${input.category})`;
  const channelPurposeCandidate =
    asString(aiChannel?.['purpose']) ??
    asString(aiContent['summary']) ??
    `[${input.product}] ${input.topic} - ${input.severity ?? 'medium'} - ${input.sentiment ?? 'neutral'}`;

  channelOut['topic'] = ensureDummyText(channelTopicCandidate);
  channelOut['purpose'] = ensureDummyText(channelPurposeCandidate);
  channelOut['team_id'] = asString(aiChannel?.['team_id']) ?? 'DE-MVP';
  out['channel'] = channelOut;

  const aiParticipants = Array.isArray(aiContent['participants']) ? aiContent['participants'] : [];
  const participantsOut = baseParticipants.map((participant, participantIndex) => {
    if (!isRecord(participant)) return participant;
    const source = aiParticipants[participantIndex];
    const aiParticipant = isRecord(source) ? source : null;
    const next = { ...participant };
    if (asString(aiParticipant?.['id'])) next['id'] = asString(aiParticipant?.['id'])!;
    if (asString(aiParticipant?.['display_name']))
      next['display_name'] = asString(aiParticipant?.['display_name'])!;
    if (asString(aiParticipant?.['real_name']))
      next['real_name'] = asString(aiParticipant?.['real_name'])!;
    next['team_id'] = asString(aiParticipant?.['team_id']) ?? 'DE-MVP';
    return next;
  });
  out['participants'] = participantsOut;

  const aiMessagesFromContent = Array.isArray(aiContent['content']) ? aiContent['content'] : [];
  const aiMessagesFromGeneric = Array.isArray(aiContent['messages']) ? aiContent['messages'] : [];
  const aiMessages =
    aiMessagesFromContent.length > 0 ? aiMessagesFromContent : aiMessagesFromGeneric;

  const contentOut = baseContent.map((entry, msgIndex) => {
    if (!isRecord(entry)) {
      throw new Error('Slack template content entry must be object-like');
    }
    const aiMessageRaw = aiMessages[msgIndex];
    const aiMessage = isRecord(aiMessageRaw) ? aiMessageRaw : null;
    const next = deepClone(entry) as Record<string, unknown>;

    const candidateText =
      asString(aiMessage?.['text']) ??
      asString(aiMessage?.['summary']) ??
      asString(aiMessage?.['details']) ??
      asString(aiContent['summary']) ??
      asString(aiContent['details']);
    next['text'] = buildSlackMessageText(input, msgIndex, candidateText);

    if (asString(aiMessage?.['id'])) {
      next['id'] = asString(aiMessage?.['id'])!;
    }
    next['team_id'] = asString(aiMessage?.['team_id']) ?? 'DE-MVP';

    if (Array.isArray(aiMessage?.['reactions'])) {
      next['reactions'] = aiMessage['reactions'];
    }

    const thread = next['thread'];
    if (thread === null) return next;
    if (!isRecord(thread)) return next;

    const aiThread = isRecord(aiMessage?.['thread']) ? aiMessage['thread'] : null;
    const aiThreadMessages = Array.isArray(aiThread?.['messages']) ? aiThread['messages'] : [];
    const threadMessages = Array.isArray(thread['messages']) ? thread['messages'] : [];
    const coercedThreadMessages = threadMessages.map((reply, replyIndex) => {
      if (!isRecord(reply)) return reply;
      const aiReplyRaw = aiThreadMessages[replyIndex];
      const aiReply = isRecord(aiReplyRaw) ? aiReplyRaw : null;
      const nextReply = deepClone(reply) as Record<string, unknown>;
      const candidateReplyText =
        asString(aiReply?.['text']) ??
        asString(aiReply?.['summary']) ??
        asString(aiReply?.['details']) ??
        `${input.topic} follow-up ${replyIndex + 1}`;
      nextReply['text'] = buildSlackMessageText(
        input,
        msgIndex + replyIndex + 1,
        candidateReplyText,
      );
      nextReply['team_id'] = asString(aiReply?.['team_id']) ?? 'DE-MVP';
      if (Array.isArray(aiReply?.['reactions'])) {
        nextReply['reactions'] = aiReply['reactions'];
      }
      return nextReply;
    });

    thread['messages'] = coercedThreadMessages;
    if ('reply_count' in thread) {
      thread['reply_count'] = coercedThreadMessages.length;
    }
    if ('root_message_id' in thread && typeof next['id'] === 'string') {
      thread['root_message_id'] = next['id'];
    }
    next['thread'] = thread;
    return next;
  });

  out['content'] = contentOut;
  return out;
}

function coerceAiContentForSource(
  source: FixtureSource,
  template: Record<string, unknown>,
  aiContent: Record<string, unknown>,
  input: GeneratePreviewRequest,
): Record<string, unknown> {
  if (source === 'slack') {
    return coerceSlackAiContent(template, aiContent, input);
  }
  return ensureTemplateTopKeys(template, aiContent);
}

function collectDomains(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    const matches = node.match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? [];
    for (const match of matches) out.push(match.toLowerCase());
    return out;
  }
  if (Array.isArray(node)) {
    for (const entry of node) collectDomains(entry, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectDomains(value, out);
  }
  return out;
}

function hasDummyMarker(node: unknown): boolean {
  if (typeof node === 'string') return node.includes('[DUMMY]');
  if (Array.isArray(node)) return node.some((entry) => hasDummyMarker(entry));
  if (node && typeof node === 'object') {
    return Object.values(node).some((value) => hasDummyMarker(value));
  }
  return false;
}

function buildFallbackPreview(
  input: GeneratePreviewRequest,
  template: Record<string, unknown>,
  warnings: string[],
): GeneratePreviewResponse {
  const ctx = toGeneratorContext(input);

  const seed = stableSeedFromInput(ctx);
  const items = Array.from({ length: input.count }, (_, index) => {
    const content = runFormatter(input.source, template, ctx, index);
    const filename = ensureSafeFilename(
      formatFilename({
        date: new Date(),
        source: input.source,
        category: input.category,
        topic: input.topic,
        index,
      }),
    );

    return {
      filename,
      content: ensureTemplateTopKeys(template, content),
    };
  });

  const validation = validateGeneratedFixtures({
    source: input.source,
    items: items as PreviewItem[],
  });
  const validationWarning = validation.some((entry) => entry.status !== 'ok')
    ? ['Generated fixtures contain validation warnings.']
    : [];

  const response = {
    items,
    warnings: [
      ...warnings,
      `Fallback deterministic generator used (seed: ${seed}).`,
      ...validationWarning,
    ],
    generationMode: 'fallback' as const,
    validation,
  };

  return GeneratePreviewResponseSchema.parse(response);
}

async function tryGenerateWithAi(
  input: GeneratePreviewRequest,
  template: Record<string, unknown>,
): Promise<GeneratePreviewResponse> {
  const payload = await generatePreviewWithClaude({
    input,
    template,
  });
  const generated = payload.items;
  if (generated.length < input.count) {
    throw new Error('Claude returned fewer items than requested');
  }

  const trimmed = generated.slice(0, input.count);
  const warnings: string[] = [];
  if (generated.length > input.count) {
    warnings.push(
      `Claude returned ${generated.length} items; trimmed to requested count ${input.count}.`,
    );
  }

  const items = trimmed.map((entry, index) => {
    const ensured = coerceAiContentForSource(
      input.source,
      template,
      ensurePlainObject(entry.content),
      input,
    );
    if (!hasDummyMarker(ensured)) {
      throw new Error('Claude output missing required [DUMMY] marker');
    }
    const domains = collectDomains(ensured);
    const unsafe = domains.find((domain) => !isAllowedDomain(domain));
    if (unsafe) {
      throw new Error(`Claude output contains unsafe domain: ${unsafe}`);
    }
    return {
      filename: ensureSafeFilename(
        formatFilename({
          date: new Date(),
          source: input.source,
          category: input.category,
          topic: input.topic,
          index,
        }),
      ),
      content: ensured,
    };
  });

  const validation = validateGeneratedFixtures({
    source: input.source,
    items: items as PreviewItem[],
  });
  const validationWarning = validation.some((entry) => entry.status !== 'ok')
    ? ['Generated fixtures contain validation warnings.']
    : [];

  return GeneratePreviewResponseSchema.parse({
    items,
    warnings: [...warnings, ...validationWarning],
    generationMode: 'ai',
    validation,
  });
}

export async function generatePreview(
  input: GeneratePreviewRequest,
): Promise<GeneratePreviewResponse> {
  const loaded = await loadRawTemplateForSource(input.source);
  const template = ensurePlainObject(loaded.template);

  if (!process.env['AZURE_OPENAI_API_KEY']) {
    return buildFallbackPreview(input, template, [
      'AZURE_OPENAI_API_KEY missing; using deterministic fallback.',
    ]);
  }

  try {
    return await tryGenerateWithAi(input, template);
  } catch (error) {
    return buildFallbackPreview(input, template, [
      `AI generation failed; using deterministic fallback. Reason: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]);
  }
}
