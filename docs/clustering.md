# Clustering

Online, single-pass topic discovery driven by embeddings. No batch K-means, no offline retraining — every record is clustered the moment its embedding lands.

## Pipeline

```
RecordPayload ──► embedder ──► EmbeddingCreated ──► topic-discovery ──► TopicCreated | TopicUpdated
                                                                    └─► EdgeObserved (record ─discusses─► topic)
```

## Stage 1 — Embedding (`with-neighbors`)

`packages/embedder/src/embed.ts` builds the text to embed from the record **plus structural context**, then calls the embedder client.

Greedy fill, in order, against a `MAX_CHARS` budget (default 24 000):

1. Node text (`title\n\nbody`).
2. Thread parent (edge `replies_to`).
3. Recent comments (edges `commented_on`, latest 3).
4. References (edges `references`, up to 3).

Blocks are joined with `--- context ---` separators and trimmed to fit. Hard-truncated stubs below `NEIGHBOR_BLOCK_MIN_CHARS` (80) are dropped. Neighbors are only loaded when at least 200 chars of budget remain after the node text.

Output: `model_version = "${modelTag}:with-neighbors:v1"`.

## Stage 2 — Topic discovery (`packages/topic-discovery/src/discover.ts`)

For each `EmbeddingCreated` event with strategy `with-neighbors`:

1. **Find nearest active topic** by cosine distance against `topics.centroid` (pgvector `<=>`):
   ```sql
   SELECT id, centroid <=> $vec AS distance, centroid, member_count
     FROM topics
    WHERE status = 'active' AND centroid IS NOT NULL
    ORDER BY centroid <=> $vec
    LIMIT 1
   ```
2. **Idempotency probe**: if a `discusses`-Edge `(record_id → topic_id, source = topic-discovery:with-neighbors:v1)` already exists, this is a re-embed of an existing member — return early, no events published.
3. **Decide** (only if not already a member):
   - `distance ≤ 0.40` → **join** the topic. Update centroid via incremental mean
     `c' = (c · n + v) / (n + 1)`, increment `member_count`. Emit `TopicUpdated`.
   - otherwise → **create** a new topic seeded with this vector (`member_count = 1`). Emit `TopicCreated`.
4. **Emit edge** `record ─discusses─► topic` (`EdgeObserved`) with
   `confidence = clamp(1 − distance / threshold, 0, 1)` and the cluster distance attached as evidence.
5. **Recompute activity** for the affected topic (`recomputeTopicActivity` in `activity.ts`). One SQL aggregation against `edges`+`records` updates `member_count`, `source_count`, `unique_authors_7d`, `velocity_24h`, `velocity_7d_avg`, `spread_24h`, `first_activity_at`, `last_activity_at`, `activity_trend`, `stagnation_signal_count`, `stagnation_severity`, `computed_at`. Failures here are logged but do not block the clustering decision — the `discusses` edge is the source of truth, the next recompute on the same topic catches up.

## Activity recompute

After every clustering decision the affected topic's activity columns are refilled in one pass — design lifted from Zettel 9. Trend derivation matches `scripts/preseed-expected-topics.ts` so live and pre-seeded topics use the same heuristic. Stagnation severity is intentionally simplified for the pilot (`dormant` trend → `low`, otherwise `none`); the full follow-up-edge analysis from Zettel 9 is a Phase-2 additive change.

## Threshold

`DISTANCE_THRESHOLD = 0.40` (`cluster.ts`).

Calibrated against the 15-record gold set in `eval/clustering/` — peak ARI **0.73** at 0.40 for `with-neighbors`. The body-only baseline never exceeded ARI 0.17, which is why the active pipeline is `with-neighbors`-only.

## Properties

- **Online & order-sensitive.** Centroids drift with insertion order; no re-clustering pass.
- **Greedy nearest-centroid.** Single-link assignment, no soft membership, no merge/split.
- **Append-only state.** Every assignment is replayable from `TopicCreated` / `TopicUpdated` / `EdgeObserved` events via the materializer.
- **Confidence is monotonic in distance**, useful for downstream filtering and reviewer UIs.

## Knobs

| Parameter                        | Location                                         | Default   |
| -------------------------------- | ------------------------------------------------ | --------- |
| Distance threshold               | `cluster.ts:DISTANCE_THRESHOLD`                  | `0.40`    |
| Embedding char budget            | `embed.ts:MAX_CHARS` (env `EMBEDDING_MAX_CHARS`) | `24000`   |
| Neighbor budget floor            | `embed.ts:NEIGHBOR_BUDGET_FLOOR`                 | `200`     |
| Min neighbor block size          | `embed.ts:NEIGHBOR_BLOCK_MIN_CHARS`              | `80`      |
| References / comments per record | `neighbors.ts`                                   | `3` / `3` |
