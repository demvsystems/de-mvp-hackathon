import type { FindSimilarInput } from './schemas';
import type { SimilarRecord } from './types';

// Embeddings exist (table + HNSW index in schema), but the embedding worker
// hasn't shipped. Until anchor records have embeddings, this returns []. Wire
// the real query once `embeddings` is populated.
export async function findSimilar(_input: FindSimilarInput): Promise<SimilarRecord[]> {
  return [];
}
