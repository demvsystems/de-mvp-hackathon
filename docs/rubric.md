# Rubric Coverage — How the Plan Hits Each Dimension

Target: highest available tier on every dimension. Platinum (P) where the rubric defines it, Gold (G) elsewhere.

## Evaluation

### 1. Evaluation Rubric — Gold

**Criteria:** codified (YAML/JSON/code), executable against any output, includes adversarial/edge-case dimensions.

**How we hit it:**

- `eval/rubric.yaml` with weighted criteria:
  - **accuracy** — factual correctness against records
  - **completeness** — no missed sources for the query
  - **source attribution** — provenance per claim
  - **conflict handling** — resolves contradictory records
  - **freshness** — notes stale data
  - **tone, format**
  - **adversarial dimensions** — prompt injection from ingested content, attempted private-channel exfiltration, contradictory sources, hallucinated commits/issues

### 2. Golden Dataset — Gold

**Criteria:** covers known failure modes; additional dataset grown from live traces capturing negative feedback.

**How we hit it:**

- 20+ golden pairs initially:
  - happy paths (single-source queries: "what's project X status?")
  - edge cases (stale data, multi-source, cross-source conflicts)
  - 3+ adversarial (private-channel leak attempt, hallucinated commit, prompt-injection in ingested Slack message)
- Stored in DB (`golden_examples` table), versioned via Drizzle migration.
- Auto-grow: thumbs-down + low rubric score → trace inserted as candidate golden example for review.
- Tied to feedback wiring (Dimension 6).

### 3. Eval Run — Platinum

**Criteria:** rubric executed once → scripted/repeatable → CI on every change → **deployment gate**.

**How we hit it:**

- Vitest runner executes `rubric.yaml` against the golden dataset.
- GitHub Actions runs eval on every PR.
- Per-rubric-dimension scores logged.
- Historical trend visible by commit / prompt version (Langfuse).
- Deployment gate: merge blocked if pass rate < threshold.

### 4. Online Evaluation — Gold

**Criteria:** full rubric evaluated online with alerting on degradation, drift detection, feedback loop into prompt iteration.

**How we hit it:**

- Sampler picks N% of live interactions, runs rubric (LLM-as-judge for soft criteria, code for hard).
- Drift detection: rolling-window pass rate stored in DB; alert when delta > threshold.
- Feedback loop: degraded scores trigger review workflow → prompt iteration in Langfuse.
- Langfuse for storage.

## Observability & Feedback

### 5. Observability & Tracing — Platinum

**Criteria:** full traces → linked to evals/feedback/cost → distributed across multi-step flows → **semantic clustering**.

**How we hit it:**

- Langfuse traces every `messages.create` call: inputs, outputs, latency, tokens, intermediate steps, session grouping.
- Tool calls instrumented as nested spans.
- Traces linked to eval scores, feedback events, cost per call.
- Failure trace summaries embedded into pgvector → similarity search clusters similar failures, surfaces anomalies without manual triage.

### 6. In-Product Feedback — Platinum

**Criteria:** explicit (thumbs/ratings/free-text tied to trace IDs) → feedback feeds eval pipeline + triggers review → **implicit signals captured**.

**How we hit it:**

- Thumbs up/down on every scoreboard card, linked to trace ID.
- Optional structured rating (1–5) + free-text correction.
- Negative feedback triggers golden-dataset ingestion (Dimension 2).
- Implicit signals:
  - **dwell time** per card
  - **copy/accept rate** when user copies text
  - **follow-up rephrasing** detection (next query within N seconds, topic-similar = signal of dissatisfaction)
- Langfuse for capture.

### 7. Cost Monitoring — Gold

**Criteria:** per-interaction cost visible → broken down by model/feature/cohort → active optimization (routing/caching/compression) with measurable savings + budgets/alerts.

**How we hit it:**

- Cost per `messages.create` call captured in Langfuse.
- Breakdown by model (Haiku vs Opus), feature (classification vs synthesis), cohort.
- **Active routing:** classifier (Haiku) decides which tools/records to load, then synthesis (Opus) summarizes — measurable savings vs Opus-only baseline benchmark captured day 1.
- Prompt cache (built-in Anthropic) for repeated system prompts.
- Cost budgets per environment with Langfuse alerting.

### 8. Prompt Management & Versioning — Gold

**Criteria:** prompts separated from code → versioned tool with deployment tied to specific versions → full lifecycle (draft/staging/production) + A/B + rollback + eval-gated promotion.

**How we hit it:**

- Prompts in Langfuse with `draft` / `staging` / `production` labels.
- Version recorded on every trace.
- A/B testing: route by user hash to two prompt versions, compare rubric scores.
- Rollback: repoint `production` label to previous version.
- Eval-gated promotion: CI step refuses to move a label to `production` unless eval pass rate ≥ threshold.

## Architecture

### 9. Structured Outputs — Gold

**Criteria:** outputs in defined shape → schema-enforced (Zod/Pydantic/JSON Schema) → schema-driven everywhere with retry-on-failure-with-repair, schema versioned alongside prompts.

**How we hit it:**

- Zod schemas for: tool inputs/outputs, agent final outputs (scoreboard cards), inter-tool messages.
- Anthropic SDK structured outputs via `tool_use` mode for guaranteed shape.
- Retry-with-repair: on Zod validation failure, retry with the validation error in context (max 2 retries).
- Schemas versioned in `lib/schemas/` alongside prompt versions in Langfuse; trace records schema version used.

### 10. Tool Use — Platinum

**Criteria:** ≥1 tool → multiple tools composed → sophisticated orchestration (parallel/chained/dynamic) → **tool selection evaluated (precision/recall) + dynamic tool loading**.

**How we hit it:**

- Multiple tools: `searchRecords`, `getRecord`, `findSimilarRecords`, `aggregateRecords` (initial set; expandable as eval reveals gaps).
- **Parallel tool calls** (Anthropic native): agent issues multiple `tool_use` blocks in one turn for parallelizable queries.
- **Tool-choice golden set:** 30+ examples of "for query X, correct tool(s) are Y" → Vitest test measures precision/recall on tool selection.
- **Dynamic tool loading:** query classifier (Haiku) selects relevant tool subset before main agent loop → reduced context window pressure.

### 11. Cross-System Integration — Gold

**Criteria:** ≥1 integration → 1 with auth/retries/error handling on real production system → multiple production systems integrated.

**How we hit it:**

- Five production-system connectors:
  - Slack (`@slack/web-api`)
  - Jira Cloud REST (`jira.js`)
  - GitHub (`octokit`)
  - GitHub Projects v2 (octokit GraphQL)
  - Meeting transcripts (OpenAI Whisper API or sample-file fallback)
- Each connector: OAuth/PAT auth, exponential-backoff retries, error categorization (rate limit / auth / transient / permanent).
- All write into the unified `records` table — connectors are pure ETL, no agent coupling.

### 12. Guardrails — Gold

**Criteria:** basic input validation + ≥1 output filter → input validation + output filtering + topic boundaries + fallback behaviors → **layered defense (input guards, output guards, jailbreak detection, prompt-injection defense) with evals + measurable catch rates, failures logged + reviewed**.

**How we hit it:**

- **Input layer:** rate limit, length cap, basic profanity/PII screen on user queries.
- **Output layer:** PII scrub (emails, phone numbers, credentials) on agent responses; secret-detection regex (API keys, tokens) before display.
- **Jailbreak detection:** Claude-as-judge call on each user query → flag attempts to override agent role or extract system prompt.
- **Prompt-injection defense:** ingested content (Slack messages, GitHub PR descriptions) is a real attack surface; we wrap ingested text in `<source_content>` tags and instruct the agent to treat content as data, not instructions.
- **Catch-rate eval:** golden attack set (15+ examples: jailbreaks, injection attempts, exfil attempts) + Vitest test measures catch rate per layer.
- **Failure logging:** every guardrail trip logged to Langfuse + reviewed asynchronously.

## Summary

| #   | Dimension                | Target | How we hit it                                     |
| --- | ------------------------ | ------ | ------------------------------------------------- |
| 1   | Evaluation Rubric        | G      | rubric.yaml + adversarial dimensions              |
| 2   | Golden Dataset           | G      | 20+ pairs + auto-grow from feedback               |
| 3   | Eval Run                 | **P**  | CI gate + deployment block                        |
| 4   | Online Evaluation        | G      | sampler + drift + feedback loop                   |
| 5   | Observability & Tracing  | **P**  | Langfuse + pgvector clustering                    |
| 6   | In-Product Feedback      | **P**  | explicit + implicit signals                       |
| 7   | Cost Monitoring          | G      | Haiku/Opus routing + measurable savings           |
| 8   | Prompt Management        | G      | Langfuse lifecycle + A/B + eval-gated             |
| 9   | Structured Outputs       | G      | Zod everywhere + retry-repair                     |
| 10  | Tool Use                 | **P**  | multiple tools + selection eval + dynamic loading |
| 11  | Cross-System Integration | G      | 5 production systems with auth/retry/error        |
| 12  | Guardrails               | G      | layered defense + catch-rate eval                 |

All 12 dimensions targeted at max tier.

## Risk areas worth monitoring

- **Tool Use Platinum** — tool-selection precision/recall + dynamic loading is the most novel work. If the golden tool-choice set isn't authored or the dynamic-loading classifier isn't wired, this slips to Gold (sophisticated orchestration without selection eval).
- **Cost Monitoring "measurable savings vs baseline"** — needs a day-1 baseline benchmark (Opus-only run on golden dataset, captured cost). Without it, the "measurable" criterion is unverifiable and lands at Silver.
- **Guardrails catch-rate eval** — requires a golden attack set. If the set isn't authored, Guardrails lands at Silver (layered defense without measured catch rates).

## Cross-dimension dependencies

- Dimension 2 (Golden Dataset auto-grow) depends on Dimension 6 (feedback wiring) and Dimension 5 (trace storage).
- Dimension 3 (Eval Run Platinum, deployment gate) depends on Dimension 1 (rubric runnable) and Dimension 2 (dataset exists).
- Dimension 4 (Online Eval) depends on Dimension 5 (live traces accessible).
- Dimension 7 (Cost routing) depends on Dimension 10 (classifier tool exists for routing).
- Dimension 8 (Prompt Management eval-gated promotion) depends on Dimension 3 (CI gate working).
- Dimension 12 (Guardrails layer) reuses the rubric-runner from Dimension 1 for catch-rate eval.

The eval pipeline is the most cross-cutting — it's a dependency for 6 of the 12 dimensions. Critical that it gets unblocked early.
