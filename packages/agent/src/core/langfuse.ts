import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
  type LangfuseObservation,
  LangfuseOtelSpanAttributes,
  setLangfuseTracerProvider,
} from '@langfuse/tracing';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';

interface LangfuseConnectionConfig {
  readonly publicKey: string;
  readonly secretKey: string;
  readonly baseUrl?: string;
  readonly environment?: string;
  readonly release?: string;
}

export interface LangfuseTraceContext {
  readonly traceName?: string;
  readonly sessionId?: string;
  readonly userId?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly metadata?: Record<string, unknown>;
}

let sharedClient: LangfuseClient | null | undefined;
let sharedTracerProvider: BasicTracerProvider | null | undefined;

function getLangfuseBaseUrl(): string | undefined {
  return process.env['LANGFUSE_BASE_URL'] ?? process.env['LANGFUSE_HOST'];
}

function getLangfuseConnectionConfig(): LangfuseConnectionConfig | null {
  const publicKey = process.env['LANGFUSE_PUBLIC_KEY'];
  const secretKey = process.env['LANGFUSE_SECRET_KEY'];
  if (!publicKey || !secretKey) return null;

  const baseUrl = getLangfuseBaseUrl();
  const environment = process.env['LANGFUSE_TRACING_ENVIRONMENT'] ?? process.env['NODE_ENV'];
  const release = process.env['LANGFUSE_RELEASE'];

  return {
    publicKey,
    secretKey,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(environment !== undefined ? { environment } : {}),
    ...(release !== undefined ? { release } : {}),
  };
}

function isValidTraceString(value: string): boolean {
  return value.length > 0 && value.length <= 200;
}

function toTraceString(value: unknown): string | null {
  if (typeof value === 'string') return isValidTraceString(value) ? value : null;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    const normalized = String(value);
    return isValidTraceString(normalized) ? normalized : null;
  }
  if (value instanceof Date) {
    const normalized = value.toISOString();
    return isValidTraceString(normalized) ? normalized : null;
  }

  try {
    const normalized = JSON.stringify(value);
    if (!normalized) return null;
    return isValidTraceString(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

export function getDefaultLangfuseClient(): LangfuseClient | null {
  if (sharedClient !== undefined) return sharedClient;

  const config = getLangfuseConnectionConfig();
  if (!config) {
    sharedClient = null;
    return sharedClient;
  }

  sharedClient = new LangfuseClient({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
  });
  return sharedClient;
}

export function ensureLangfuseTracing(): boolean {
  if (sharedTracerProvider !== undefined) return sharedTracerProvider !== null;

  const config = getLangfuseConnectionConfig();
  if (!config) {
    sharedTracerProvider = null;
    return false;
  }

  const processor = new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    ...(config.environment !== undefined ? { environment: config.environment } : {}),
    ...(config.release !== undefined ? { release: config.release } : {}),
  });

  sharedTracerProvider = new BasicTracerProvider({
    spanProcessors: [processor],
  });
  setLangfuseTracerProvider(sharedTracerProvider);
  return true;
}

export function applyLangfuseTraceContext(
  observation: LangfuseObservation,
  context: LangfuseTraceContext,
): void {
  const traceName = context.traceName;
  if (traceName && isValidTraceString(traceName)) {
    observation.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_NAME, traceName);
  }

  const sessionId = context.sessionId;
  if (sessionId && isValidTraceString(sessionId)) {
    observation.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_SESSION_ID, sessionId);
  }

  const userId = context.userId;
  if (userId && isValidTraceString(userId)) {
    observation.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_USER_ID, userId);
  }

  const tags = context.tags?.filter(isValidTraceString);
  if (tags && tags.length > 0) {
    observation.otelSpan.setAttribute(LangfuseOtelSpanAttributes.TRACE_TAGS, [...new Set(tags)]);
  }

  if (!context.metadata) return;
  for (const [key, value] of Object.entries(context.metadata)) {
    const normalized = toTraceString(value);
    if (!normalized) continue;
    observation.otelSpan.setAttribute(
      `${LangfuseOtelSpanAttributes.TRACE_METADATA}.${key}`,
      normalized,
    );
  }
}

export async function flushLangfuse(): Promise<void> {
  const pending: Promise<void>[] = [];

  if (sharedTracerProvider) pending.push(sharedTracerProvider.forceFlush());

  const client = getDefaultLangfuseClient();
  if (client) pending.push(client.flush());

  await Promise.all(pending);
}

export async function shutdownLangfuse(): Promise<void> {
  const pending: Promise<void>[] = [];

  if (sharedTracerProvider) {
    pending.push(sharedTracerProvider.shutdown());
    setLangfuseTracerProvider(null);
    sharedTracerProvider = null;
  }

  if (sharedClient) {
    pending.push(sharedClient.shutdown());
    sharedClient = null;
  }

  await Promise.all(pending);
}
