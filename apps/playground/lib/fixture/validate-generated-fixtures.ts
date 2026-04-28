import type { PreviewItem } from './generate-schemas';
import type { FixtureSource } from './sources';
import { isAllowedDomain } from './generator-utils';

export interface ValidationIssue {
  severity: 'warning' | 'error';
  path: string;
  message: string;
}

export interface ValidationResultItem {
  filename: string;
  status: 'ok' | 'warning' | 'error';
  issues: ValidationIssue[];
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStatus(issues: ValidationIssue[]): ValidationResultItem['status'] {
  if (issues.some((issue) => issue.severity === 'error')) return 'error';
  if (issues.length > 0) return 'warning';
  return 'ok';
}

function pushIssue(
  issues: ValidationIssue[],
  severity: ValidationIssue['severity'],
  path: string,
  message: string,
): void {
  issues.push({ severity, path, message });
}

function walkStrings(
  value: unknown,
  path: string,
  visit: (path: string, text: string) => void,
): void {
  if (typeof value === 'string') {
    visit(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, `${path}[${index}]`, visit));
    return;
  }
  if (!isObjectLike(value)) return;

  for (const [key, entry] of Object.entries(value)) {
    walkStrings(entry, path ? `${path}.${key}` : key, visit);
  }
}

function genericValidate(item: PreviewItem, issues: ValidationIssue[]): void {
  if (!item.filename.endsWith('.json')) {
    pushIssue(issues, 'error', 'filename', 'Filename must end with .json');
  }
  if (item.filename.endsWith('.jsonl')) {
    pushIssue(issues, 'error', 'filename', 'Filename must not end with .jsonl');
  }

  if (!isObjectLike(item.content)) {
    pushIssue(issues, 'error', 'content', 'Content must be an object-like JSON value.');
    return;
  }

  const textPaths: Array<{ path: string; text: string }> = [];
  walkStrings(item.content, 'content', (path, text) => {
    textPaths.push({ path, text });

    const domains = text.match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? [];
    for (const domain of domains.map((entry) => entry.toLowerCase())) {
      if (!isAllowedDomain(domain)) {
        pushIssue(issues, 'error', path, `Unsafe domain detected: ${domain}`);
      }
    }

    const secretPatterns = [
      /sk-[a-z0-9]/i,
      /OPENAI_API_KEY/i,
      /PRIVATE KEY/i,
      /AWS_SECRET_ACCESS_KEY/i,
    ];
    if (secretPatterns.some((pattern) => pattern.test(text))) {
      pushIssue(issues, 'error', path, 'Potential secret-like value detected.');
    }
  });

  const userVisibleTextRegex = /(text|body|summary|title|description|message|purpose|goal)/i;
  const userVisibleFields = textPaths.filter((entry) => {
    const key = entry.path.split('.').at(-1) ?? '';
    return userVisibleTextRegex.test(key);
  });

  if (
    userVisibleFields.length > 0 &&
    !userVisibleFields.some((entry) => entry.text.includes('[DUMMY]'))
  ) {
    pushIssue(issues, 'warning', 'content', 'No [DUMMY] marker found in user-visible text fields.');
  }

  for (const field of userVisibleFields) {
    if (field.text.trim().length === 0) {
      pushIssue(issues, 'warning', field.path, 'User-visible text field is empty.');
    }
  }

  for (const { path, text } of textPaths) {
    const key = path.split('.').at(-1)?.toLowerCase() ?? '';
    const isDateish = [
      'created_at',
      'updated_at',
      'datetime',
      'timestamp',
      'startdate',
      'enddate',
    ].some((token) => key.includes(token));
    const isTsKey = key === 'ts';
    if (isDateish) {
      if (!Number.isFinite(Date.parse(text))) {
        pushIssue(issues, 'warning', path, 'Invalid date-like string.');
      }
    } else if (isTsKey) {
      const isSlackTsLike = /^\d{10,}(\.\d+)?$/.test(text);
      if (!isSlackTsLike && !Number.isFinite(Date.parse(text))) {
        pushIssue(issues, 'warning', path, 'Invalid ts value.');
      }
    }
  }
}

function validateSlack(content: Record<string, unknown>, issues: ValidationIssue[]): void {
  const participantIds = new Set<string>();
  const participants = content['participants'];
  if (participants !== undefined) {
    if (!Array.isArray(participants)) {
      pushIssue(
        issues,
        'warning',
        'content.participants',
        'participants should be an array when present.',
      );
    } else {
      for (let i = 0; i < participants.length; i += 1) {
        const participant = participants[i];
        if (!isObjectLike(participant)) continue;
        const id = participant['id'];
        if (typeof id === 'string') participantIds.add(id);
        const teamId = participant['team_id'];
        if (teamId !== undefined && teamId !== 'DE-MVP') {
          pushIssue(
            issues,
            'warning',
            `content.participants[${i}].team_id`,
            'team_id should be DE-MVP.',
          );
        }
      }
    }
  }

  const channel = content['channel'];
  if (isObjectLike(channel)) {
    if (channel['team_id'] !== undefined && channel['team_id'] !== 'DE-MVP') {
      pushIssue(issues, 'warning', 'content.channel.team_id', 'team_id should be DE-MVP.');
    }
  } else {
    pushIssue(issues, 'warning', 'content.channel', 'channel object is missing or invalid.');
  }

  const messages = content['content'];
  if (!Array.isArray(messages)) {
    pushIssue(issues, 'error', 'content.content', 'content must be an array for Slack fixtures.');
    return;
  }

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    if (!isObjectLike(message)) {
      pushIssue(issues, 'warning', `content.content[${i}]`, 'message entry should be an object.');
      continue;
    }

    const text = message['text'];
    if (typeof text !== 'string' || text.trim().length === 0) {
      pushIssue(issues, 'warning', `content.content[${i}].text`, 'message text should be present.');
    }
    if (
      message['author'] === undefined &&
      message['author_id'] === undefined &&
      message['user_id'] === undefined
    ) {
      pushIssue(
        issues,
        'warning',
        `content.content[${i}]`,
        'message should contain author or author_id.',
      );
    }
    if (message['team_id'] !== undefined && message['team_id'] !== 'DE-MVP') {
      pushIssue(issues, 'warning', `content.content[${i}].team_id`, 'team_id should be DE-MVP.');
    }

    const mentions = message['mentions'];
    if (Array.isArray(mentions) && participantIds.size > 0) {
      for (let j = 0; j < mentions.length; j += 1) {
        const mention = mentions[j];
        if (typeof mention === 'string' && !participantIds.has(mention)) {
          pushIssue(
            issues,
            'warning',
            `content.content[${i}].mentions[${j}]`,
            'mention does not reference a known participant id.',
          );
        }
      }
    }

    const reactions = message['reactions'];
    if (reactions !== undefined) {
      if (!Array.isArray(reactions)) {
        pushIssue(
          issues,
          'warning',
          `content.content[${i}].reactions`,
          'reactions should be an array when present.',
        );
      } else if (participantIds.size > 0) {
        for (let r = 0; r < reactions.length; r += 1) {
          const reaction = reactions[r];
          if (!isObjectLike(reaction)) continue;
          const users = reaction['users'];
          if (Array.isArray(users)) {
            for (let u = 0; u < users.length; u += 1) {
              const user = users[u];
              if (typeof user === 'string' && !participantIds.has(user)) {
                pushIssue(
                  issues,
                  'warning',
                  `content.content[${i}].reactions[${r}].users[${u}]`,
                  'reaction user id does not reference a known participant.',
                );
              }
            }
          }
        }
      }
    }

    const thread = message['thread'];
    if (thread === null || thread === undefined) continue;
    if (!isObjectLike(thread)) {
      pushIssue(
        issues,
        'warning',
        `content.content[${i}].thread`,
        'thread should be null or object.',
      );
      continue;
    }
    const threadMessages = thread['messages'];
    if (threadMessages !== undefined && !Array.isArray(threadMessages)) {
      pushIssue(
        issues,
        'warning',
        `content.content[${i}].thread.messages`,
        'thread.messages should be array.',
      );
    }
    if (Array.isArray(threadMessages)) {
      const replyCount = thread['reply_count'];
      if (typeof replyCount === 'number' && replyCount !== threadMessages.length) {
        pushIssue(
          issues,
          'warning',
          `content.content[${i}].thread.reply_count`,
          'reply_count does not match thread.messages.length',
        );
      }
      const rootMessageId = thread['root_message_id'];
      if (
        typeof rootMessageId === 'string' &&
        typeof message['id'] === 'string' &&
        rootMessageId !== message['id']
      ) {
        pushIssue(
          issues,
          'warning',
          `content.content[${i}].thread.root_message_id`,
          'root_message_id does not match root message id.',
        );
      }
      for (let j = 0; j < threadMessages.length; j += 1) {
        const reply = threadMessages[j];
        if (!isObjectLike(reply)) continue;
        const replyText = reply['text'];
        if (typeof replyText !== 'string' || replyText.trim().length === 0) {
          pushIssue(
            issues,
            'warning',
            `content.content[${i}].thread.messages[${j}].text`,
            'reply text should be present.',
          );
        }
        if (
          reply['author'] === undefined &&
          reply['author_id'] === undefined &&
          reply['user_id'] === undefined
        ) {
          pushIssue(
            issues,
            'warning',
            `content.content[${i}].thread.messages[${j}]`,
            'reply should contain author or author_id.',
          );
        }
        if (reply['team_id'] !== undefined && reply['team_id'] !== 'DE-MVP') {
          pushIssue(
            issues,
            'warning',
            `content.content[${i}].thread.messages[${j}].team_id`,
            'team_id should be DE-MVP.',
          );
        }
      }
    }
  }
}

function validateJira(content: Record<string, unknown>, issues: ValidationIssue[]): void {
  const issuesValue = content['issues'];
  if (issuesValue !== undefined) {
    if (!Array.isArray(issuesValue)) {
      pushIssue(issues, 'error', 'content.issues', 'issues must be an array when present.');
    } else {
      for (let i = 0; i < issuesValue.length; i += 1) {
        const issue = issuesValue[i];
        if (!isObjectLike(issue)) continue;
        const hasId = typeof issue['id'] === 'string' || typeof issue['key'] === 'string';
        if (!hasId) {
          pushIssue(issues, 'warning', `content.issues[${i}]`, 'issue is missing id/key.');
        }
        const summary = issue['summary'];
        const fields = issue['fields'];
        const fieldsSummary = isObjectLike(fields) ? fields['summary'] : undefined;
        if (
          (typeof summary !== 'string' || summary.trim().length === 0) &&
          (typeof fieldsSummary !== 'string' || fieldsSummary.trim().length === 0)
        ) {
          pushIssue(issues, 'warning', `content.issues[${i}]`, 'issue is missing summary.');
        }
      }
    }
  }

  const projects = content['projects'];
  if (projects !== undefined) {
    if (!Array.isArray(projects)) {
      pushIssue(issues, 'warning', 'content.projects', 'projects should be an array when present.');
    } else {
      for (let i = 0; i < projects.length; i += 1) {
        const project = projects[i];
        if (!isObjectLike(project)) continue;
        const hasIdentifier =
          typeof project['id'] === 'string' ||
          typeof project['key'] === 'string' ||
          typeof project['name'] === 'string';
        if (!hasIdentifier) {
          pushIssue(
            issues,
            'warning',
            `content.projects[${i}]`,
            'project should include id/key/name.',
          );
        }
      }
    }
  }
}

function validateUpvoty(content: Record<string, unknown>, issues: ValidationIssue[]): void {
  const postsValue = content['posts'];
  const postIds = new Set<string>();
  if (postsValue !== undefined) {
    if (!Array.isArray(postsValue)) {
      pushIssue(issues, 'error', 'content.posts', 'posts must be an array when present.');
    } else {
      for (let i = 0; i < postsValue.length; i += 1) {
        const post = postsValue[i];
        if (!isObjectLike(post)) continue;
        const id = post['id'];
        if (typeof id === 'string') postIds.add(id);
        const title = post['title'];
        if (typeof title !== 'string' || title.trim().length === 0) {
          pushIssue(
            issues,
            'warning',
            `content.posts[${i}].title`,
            'post title should be non-empty.',
          );
        }
        if (typeof id !== 'string' || id.trim().length === 0) {
          pushIssue(issues, 'warning', `content.posts[${i}].id`, 'post should include id.');
        }
      }
    }
  }

  const votes = content['votes'];
  if (votes !== undefined) {
    if (!Array.isArray(votes)) {
      pushIssue(issues, 'warning', 'content.votes', 'votes should be an array when present.');
    } else if (postIds.size > 0) {
      for (let i = 0; i < votes.length; i += 1) {
        const vote = votes[i];
        if (!isObjectLike(vote)) continue;
        const postId = vote['post_id'];
        if (typeof postId === 'string' && !postIds.has(postId)) {
          pushIssue(
            issues,
            'warning',
            `content.votes[${i}].post_id`,
            'vote references missing post.',
          );
        }
      }
    }
  }

  const comments = content['comments'];
  if (comments !== undefined) {
    if (!Array.isArray(comments)) {
      pushIssue(issues, 'warning', 'content.comments', 'comments should be an array when present.');
    } else {
      for (let i = 0; i < comments.length; i += 1) {
        const comment = comments[i];
        if (!isObjectLike(comment)) continue;
        const text = comment['body'] ?? comment['text'] ?? comment['content'];
        if (text !== undefined && (typeof text !== 'string' || text.trim().length === 0)) {
          pushIssue(
            issues,
            'warning',
            `content.comments[${i}]`,
            'comment text/body/content should be non-empty.',
          );
        }
        const postId = comment['post_id'];
        if (typeof postId === 'string' && postIds.size > 0 && !postIds.has(postId)) {
          pushIssue(
            issues,
            'warning',
            `content.comments[${i}].post_id`,
            'comment references missing post.',
          );
        }
      }
    }
  }
}

function validateIntercom(content: Record<string, unknown>, issues: ValidationIssue[]): void {
  for (const [eventKey, eventPayload] of Object.entries(content)) {
    if (!isObjectLike(eventPayload)) continue;
    if (!('data' in eventPayload)) continue;

    const data = eventPayload['data'];
    if (!isObjectLike(data)) {
      pushIssue(
        issues,
        'warning',
        `content.${eventKey}.data`,
        'event payload data should be object-like.',
      );
      continue;
    }
    const item = data['item'];
    if (!isObjectLike(item)) {
      pushIssue(
        issues,
        'warning',
        `content.${eventKey}.data.item`,
        'event payload item is missing or invalid.',
      );
      continue;
    }
    if ('id' in item) {
      const id = item['id'];
      if (typeof id !== 'string' || id.trim().length === 0) {
        pushIssue(
          issues,
          'warning',
          `content.${eventKey}.data.item.id`,
          'item id should be non-empty.',
        );
      }
    }
  }
}

export function validateGeneratedFixtures(args: {
  source: FixtureSource;
  items: PreviewItem[];
}): ValidationResultItem[] {
  return args.items.map((item) => {
    const issues: ValidationIssue[] = [];
    genericValidate(item, issues);

    if (isObjectLike(item.content)) {
      switch (args.source) {
        case 'slack':
          validateSlack(item.content, issues);
          break;
        case 'jira':
          validateJira(item.content, issues);
          break;
        case 'upvoty':
          validateUpvoty(item.content, issues);
          break;
        case 'intercom':
          validateIntercom(item.content, issues);
          break;
      }
    }

    return {
      filename: item.filename,
      status: getStatus(issues),
      issues,
    };
  });
}
