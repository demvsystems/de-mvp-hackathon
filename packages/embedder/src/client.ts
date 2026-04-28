import { AzureOpenAI } from 'openai';

export interface Embedder {
  readonly modelTag: string;
  readonly dim: number;
  embed(input: string): Promise<number[]>;
}

interface AzureOpts {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
  modelTag: string;
  dim: number;
}

class AzureOpenAIEmbedder implements Embedder {
  readonly modelTag: string;
  readonly dim: number;
  private readonly client: AzureOpenAI;
  private readonly deployment: string;

  constructor(opts: AzureOpts) {
    this.modelTag = opts.modelTag;
    this.dim = opts.dim;
    this.deployment = opts.deployment;
    this.client = new AzureOpenAI({
      endpoint: opts.endpoint,
      apiKey: opts.apiKey,
      apiVersion: opts.apiVersion,
      deployment: opts.deployment,
    });
  }

  async embed(input: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: this.deployment,
      input,
      dimensions: this.dim,
    });
    const vec = res.data[0]?.embedding;
    if (!vec || vec.length !== this.dim) {
      throw new Error(
        `embedding api: bad response (got ${vec?.length ?? 'none'} dims, expected ${this.dim})`,
      );
    }
    return vec;
  }
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function createEmbedder(): Embedder {
  return new AzureOpenAIEmbedder({
    endpoint: req('AZURE_OPENAI_ENDPOINT'),
    apiKey: req('AZURE_OPENAI_API_KEY'),
    deployment: req('AZURE_OPENAI_DEPLOYMENT'),
    apiVersion: process.env['AZURE_OPENAI_API_VERSION'] ?? '2024-10-21',
    modelTag: process.env['EMBEDDING_MODEL_TAG'] ?? 'openai-small-3',
    dim: Number(process.env['EMBEDDING_DIM'] ?? 1536),
  });
}
