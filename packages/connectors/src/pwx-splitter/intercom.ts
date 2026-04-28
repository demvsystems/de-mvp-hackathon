import {
  IntercomAgent,
  IntercomContact,
  IntercomConversation,
  IntercomConversationPart,
  IntercomSnapshot,
} from '../intercom/schema';
import { PwxContainer } from './types';

/**
 * Konvertiert die `intercom`-Section eines Pwx-Containers vom Webhook-Event-
 * Format ins `IntercomSnapshot`-Schema. Webhook-Events sind keyed by topic
 * (`conversation.user.created` etc.) — der Adapter aggregiert sie pro
 * Conversation-ID und sammelt Contacts/Agents als Begleit-Records.
 *
 * Topic-Mapping:
 * - `conversation.user.created`: erzeugt eine neue Conversation mit
 *   Initial-Part (source.body), Customer als Contact + Conversation-Initiator.
 * - `conversation.user.replied`: hängt einen User-Part an die existierende
 *   Conversation, falls bekannt; erzeugt ansonsten eine minimal-Conversation.
 * - `conversation.admin.replied`: hängt einen Admin-Part an, sammelt den
 *   Agent in `agents`.
 * - `conversation.admin.closed`: setzt `state = "closed"`.
 * - `contact.tag.created`: stellt sicher, dass der Contact in der Liste ist
 *   (Tag-Information selbst wird im Pilot nicht weiter materialisiert, weil
 *   das IntercomContact-Schema keine Tags-Liste hat).
 */
export function extractIntercomSnapshot(input: unknown): IntercomSnapshot {
  const container = PwxContainer.parse(input);
  if (container.intercom === undefined) {
    throw new Error(`PwxContainer "${container.cluster}" hat keine intercom-section.`);
  }

  const events = parseEvents(container.intercom);
  const conversations = new Map<string, IntercomConversation>();
  const contacts = new Map<string, IntercomContact>();
  const agents = new Map<string, IntercomAgent>();
  let partCounter = 0;

  const nextPartId = (convId: string): string => {
    partCounter += 1;
    return `${convId}_p${partCounter}`;
  };

  for (const event of events) {
    const item = event.data?.item ?? {};
    switch (event.topic) {
      case 'conversation.user.created': {
        const customer = (item['customer'] ?? {}) as Record<string, unknown>;
        const customerId = String(customer['id'] ?? '');
        if (customerId) {
          contacts.set(customerId, mergeContact(contacts.get(customerId), customer));
        }
        const convId = String(item['id'] ?? '');
        const source = (item['source'] ?? {}) as Record<string, unknown>;
        const sourceBody = source['body'] != null ? String(source['body']) : null;
        const tags = Array.isArray(item['tags']) ? (item['tags'] as string[]) : [];
        const createdAt = String(item['created_at'] ?? '');
        const initialPart: IntercomConversationPart = {
          id: nextPartId(convId),
          part_type: 'comment',
          body: sourceBody,
          created_at: createdAt,
          author: { type: 'user', id: customerId, ...nameAndEmail(customer) },
        };
        conversations.set(convId, {
          id: convId,
          created_at: createdAt,
          updated_at: createdAt,
          state: String(item['state'] ?? 'open'),
          subject: undefined,
          contact: { type: 'user', id: customerId, ...nameAndEmail(customer) },
          assignee_id: undefined,
          tags,
          parts: [initialPart],
        });
        break;
      }

      case 'conversation.user.replied':
      case 'conversation.admin.replied': {
        const convId = String(item['id'] ?? '');
        const lastMessage = (item['last_message'] ?? {}) as Record<string, unknown>;
        const isAdmin = event.topic === 'conversation.admin.replied';
        const actorRaw = (isAdmin ? item['admin'] : item['customer']) as
          | Record<string, unknown>
          | undefined;
        const actorId = String(actorRaw?.['id'] ?? '');
        if (isAdmin && actorId) {
          agents.set(actorId, mergeAgent(agents.get(actorId), actorRaw ?? {}));
        } else if (actorId) {
          contacts.set(actorId, mergeContact(contacts.get(actorId), actorRaw ?? {}));
        }
        const part: IntercomConversationPart = {
          id: nextPartId(convId),
          part_type: 'comment',
          body: lastMessage['body'] != null ? String(lastMessage['body']) : null,
          created_at: String(lastMessage['created_at'] ?? item['updated_at'] ?? ''),
          author: {
            type: isAdmin ? 'admin' : 'user',
            id: actorId,
            ...nameAndEmail(actorRaw ?? {}),
          },
        };
        const existing = conversations.get(convId);
        if (existing) {
          existing.parts.push(part);
          existing.updated_at = String(item['updated_at'] ?? existing.updated_at);
          existing.state = String(item['state'] ?? existing.state);
        } else {
          // Reply ohne vorheriges .created — minimal-Conversation rekonstruieren.
          const ts = String(item['updated_at'] ?? '');
          conversations.set(convId, {
            id: convId,
            created_at: ts,
            updated_at: ts,
            state: String(item['state'] ?? 'open'),
            subject: undefined,
            contact: { type: 'user', id: actorId, ...nameAndEmail(actorRaw ?? {}) },
            assignee_id: undefined,
            tags: [],
            parts: [part],
          });
        }
        break;
      }

      case 'conversation.admin.closed': {
        const convId = String(item['id'] ?? '');
        const closedBy = (item['closed_by'] ?? {}) as Record<string, unknown>;
        if (closedBy['id'] !== undefined) {
          const id = String(closedBy['id']);
          agents.set(id, mergeAgent(agents.get(id), closedBy));
        }
        const existing = conversations.get(convId);
        if (existing) {
          existing.state = 'closed';
          existing.updated_at = String(item['closed_at'] ?? existing.updated_at);
        }
        break;
      }

      case 'contact.tag.created': {
        const contact = (item['contact'] ?? {}) as Record<string, unknown>;
        const id = String(contact['id'] ?? '');
        if (id) contacts.set(id, mergeContact(contacts.get(id), contact));
        break;
      }
    }
  }

  return IntercomSnapshot.parse({
    conversations: Array.from(conversations.values()),
    contacts: Array.from(contacts.values()),
    agents: Array.from(agents.values()),
  });
}

interface WebhookEvent {
  id?: string;
  topic: string;
  data?: { item?: Record<string, unknown> };
}

function parseEvents(raw: unknown): WebhookEvent[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const events: WebhookEvent[] = [];
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as { topic?: unknown; data?: unknown; id?: unknown };
    if (typeof v.topic !== 'string') continue;
    const event: WebhookEvent = { topic: v.topic };
    if (typeof v.id === 'string') event.id = v.id;
    if (v.data !== undefined) event.data = v.data as { item?: Record<string, unknown> };
    events.push(event);
  }
  return events;
}

function nameAndEmail(obj: Record<string, unknown>): { name?: string; email?: string } {
  const out: { name?: string; email?: string } = {};
  if (typeof obj['name'] === 'string') out.name = obj['name'];
  if (typeof obj['email'] === 'string') out.email = obj['email'];
  return out;
}

function mergeContact(
  existing: IntercomContact | undefined,
  raw: Record<string, unknown>,
): IntercomContact {
  const base: IntercomContact = existing ?? IntercomContact.parse({ id: String(raw['id']) });
  return IntercomContact.parse({
    id: base.id,
    name: typeof raw['name'] === 'string' ? raw['name'] : base.name,
    email: typeof raw['email'] === 'string' ? raw['email'] : base.email,
    external_id: base.external_id,
  });
}

function mergeAgent(
  existing: IntercomAgent | undefined,
  raw: Record<string, unknown>,
): IntercomAgent {
  const id = String(raw['id'] ?? existing?.id ?? '');
  return IntercomAgent.parse({
    id,
    name: typeof raw['name'] === 'string' ? raw['name'] : (existing?.name ?? 'Unknown'),
    email: typeof raw['email'] === 'string' ? raw['email'] : existing?.email,
  });
}
