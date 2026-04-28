# Rubric status

Live tracker of where each rubric dimension stands. Pair with `docs/rubric.md` (target tiers + how-we-hit-it).

Last updated: 2026-04-28

## Summary

Tier vocabulary: None → Bronze → Silver → Gold → Platinum. Current is a self-estimate — the eval pipeline is what makes it real once it scores live runs.

| #   | Dimension                | Target   | Current | Notes                                                               |
| --- | ------------------------ | -------- | ------- | ------------------------------------------------------------------- |
| 1   | Evaluation Rubric        | Gold     | Bronze  | rubric.yaml + 1/7 criteria implemented                              |
| 2   | Golden Dataset           | Gold     | Bronze  | 3 fixtures vs 20+ target; no auto-grow                              |
| 3   | Eval Run                 | Platinum | None    | no CI gate, runner only invoked manually                            |
| 4   | Online Evaluation        | Gold     | None    | no sampler, no drift detection                                      |
| 5   | Observability & Tracing  | Platinum | Silver  | Langfuse v5 traces agent calls + evals; no clustering               |
| 6   | In-Product Feedback      | Platinum | None    | no scoreboard UI yet, no widgets                                    |
| 7   | Cost Monitoring          | Gold     | None    | no per-call cost capture, no routing, no baseline benchmark         |
| 8   | Prompt Management        | Gold     | Bronze  | Langfuse prompt + label + version on metadata; no A/B, no eval gate |
| 9   | Structured Outputs       | Gold     | Silver  | Zod everywhere + retry-repair; schema not externally versioned      |
| 10  | Tool Use                 | Platinum | Silver  | 4 tools, parallel possible; no selection eval, no dynamic loading   |
| 11  | Cross-System Integration | Gold     | Bronze  | Slack connector only; 4 production systems missing                  |
| 12  | Guardrails               | Gold     | None    | only Zod schema enforcement; no PII/jailbreak/injection layers      |

## Per-dimension status

### 1. Evaluation Rubric — Gold

**Shipped**

- `eval/rubric.yaml` with 8 weighted criteria including adversarial + tool-selection dimensions
- `packages/eval` runner aggregates weighted score per fixture, emits `FixtureReport`
- `character_match` criterion fully implemented (exact-match on `output.character`)
- `tool_selection` criterion fully implemented (F1 over `expected.tool_calls.required` / `forbidden`)
- Trace + score reporting wired through Langfuse helper

**Remaining for Gold — criterion stubs to implement**

Each lives at `packages/eval/src/criteria/<name>.ts` and currently returns `0` unconditionally. Contract: `(input: CriterionInput) => CriterionScore`. Input has `{ fixture, output, toolCalls, config }`.

- [ ] **`escalation_proximity`** (code) — `output.escalation_score` vs `fixture.expected.escalation_score`. If `|actual − expected|` ≤ `config.threshold` (0.2) → 1.0; else linear decay to 0 at distance 1.0. ~10 lines.

- [ ] **`coverage`** (code) — `output.summary.covers_record_ids` vs `fixture.expected.anchor_record_ids`. Score = `|covered ∩ expected| / |expected|`. Empty expected → 1.0. ~8 lines.

- [ ] **`artifact_validity`** (code) — every `output.reasoning.key_artifacts` ID must exist in `fixture.records[].id`. Score = `valid_ids / total_artifacts`. Empty artifacts → 1.0. ~10 lines.

- [ ] **`adversarial_resistance`** (code, applies only to `category: 'adversarial'`) — strict: `output.character === fixture.expected.character` (the injection tried to flip it). Stronger: also penalize if `key_signals` echo the injected instruction text. ~15 lines.

- [ ] **`signal_quality`** (LLM-judge, Haiku 4.5) — Haiku reads `output.reasoning.key_signals` and `fixture.expected.expected_signals`, returns 0–1 on theme overlap. Uses `judge()` helper at `packages/eval/src/judge.ts:30`. ~25 lines + prompt. Cost ~$0.001/fixture.

- [ ] **`summary_faithfulness`** (LLM-judge, Haiku 4.5) — Haiku reads the seeded record bodies + `output.summary.text`, returns 0–1 on whether the summary contradicts records. ~30 lines + prompt. Cost ~$0.001/fixture.

**Suggested order:** code stubs first (cheap, deterministic, gives real numbers fast), adversarial second (narrow impact), LLM judges last (most signal but real token cost — establish a clean baseline first so changes are attributable).

**No new infrastructure required.** No new deps, no schema changes, no config — the framework + data + tests are in place.

### 2. Golden Dataset — Gold

**Shipped**

- 3 fixtures: `happy.jsonl`, `edge.jsonl`, `adversarial.jsonl` (1 each)
- Zod-validated fixture schema, JSONL loader, seed helper
- One adversarial example (prompt-injection in record body)

**Remaining for Gold**

- [ ] Author 17+ more fixtures to clear the 20+ bar
- [ ] Cover stale-data, multi-source-conflict, hallucinated-commit failure modes
- [ ] At least 3 adversarial examples (currently 1)
- [ ] `golden_examples` DB table for auto-grow from negative feedback (depends on Dim 6)

### 3. Eval Run — Platinum

**Shipped**

- Vitest runner exists in `packages/eval`
- Live end-to-end test stub gated on `DATABASE_URL_EVAL` + `ANTHROPIC_API_KEY`

**Remaining for Platinum**

- [ ] CI workflow that runs eval on every PR (warn-only first, then blocking)
- [ ] Per-criterion score artifacts uploaded by CI
- [ ] Pass-rate threshold enforced as deployment gate (`EVAL_BLOCK_ON_FAIL=true`)
- [ ] Historical trend visible in Langfuse (per commit / prompt version)

### 4. Online Evaluation — Gold

**Shipped**

- Nothing yet.

**Remaining for Gold**

- [ ] Sampler endpoint that runs rubric on N% of live `topic.assessment.created` events
- [ ] GitHub Actions cron (`*/15`) calls the sampler with bearer auth
- [ ] Rolling-window pass-rate stored in DB; alert when delta exceeds threshold
- [ ] Slack alert webhook for drift events (env: `SLACK_ALERT_WEBHOOK_URL`)

### 5. Observability & Tracing — Platinum

**Shipped**

- Langfuse cloud project keys wired (`.env.example`)
- Eval runner emits a Langfuse trace per fixture with criterion scores
- Reviewer logs `prompt_name`/`prompt_version`/`prompt_label` per run
- Reviewer agent runs emit Langfuse v5 traces for `messages.create`
- Tool calls are nested Langfuse observations on the same trace
- Topic id is used as the Langfuse session id for reviewer runs

**Remaining for Platinum**

- [ ] Failure-trace summaries embedded into pgvector for semantic clustering
- [ ] `(admin)/clusters` route in `apps/web` showing the cluster dashboard

### 6. In-Product Feedback — Platinum

**Shipped**

- Nothing yet (no scoreboard UI).

**Remaining for Platinum**

- [ ] Thumbs up/down per scoreboard card, linked to trace ID
- [ ] Optional 1–5 rating + free-text correction
- [ ] Negative feedback triggers golden-dataset ingestion
- [ ] Implicit signals: dwell time, copy/accept rate, follow-up rephrasing detection
- [ ] All persisted via Langfuse score events

### 7. Cost Monitoring — Gold

**Shipped**

- Nothing yet.

**Remaining for Gold**

- [ ] Cost per `messages.create` captured in Langfuse (model, feature, cohort tags)
- [ ] Haiku classifier picks tools/records, Opus synthesizes — measurable savings
- [ ] Day-1 baseline benchmark (Opus-only run on golden dataset, captured cost)
- [ ] Anthropic prompt-cache check (already on for system prompt, verify cache-hit rate logs)
- [ ] Cost budgets per environment + Langfuse alerting

### 8. Prompt Management — Gold

**Shipped**

- `prompts/reviewer-system.md` is the canonical source, version-controlled in git
- `prompts/meta.yaml` manifest + `pnpm prompts:sync` pushes to Langfuse
- `agent-core` resolves `{ name, label, fallback }` via Langfuse SDK at runtime
- `prompt.version` / `prompt.label` / `prompt.from_fallback` exposed on `AgentRunMetadata`
- Reviewer points at `reviewer.system @ production`; `LLM_REVIEWER_PROMPT_LABEL` env var overrides for staging

**Remaining for Gold**

- [ ] A/B routing — hash topic-id to two labels, compare rubric scores
- [ ] Eval-gated promotion — CI step refuses to move `production` unless eval pass rate ≥ threshold (depends on Dim 3)
- [ ] Thread `prompt.name`/`prompt.version` into eval `FixtureReport` so rubric scores pin to a specific version
- [ ] Document rollback procedure (git revert + re-sync, or label-swap in Langfuse UI)

### 9. Structured Outputs — Gold

**Shipped**

- Zod schemas for every reviewer output (`AssessmentOutput`)
- Retry-with-repair on Zod validation failure (max 1 retry, then fallback)
- Anthropic structured-output via JSON-in-content; schema validated client-side

**Remaining for Gold**

- [ ] Move to Anthropic `tool_use` mode for guaranteed shape (current path is JSON-extracted from text)
- [ ] Schema version recorded on every trace
- [ ] Schema files versioned alongside prompt versions (lift to `lib/schemas/` if a second consumer appears)

### 10. Tool Use — Platinum

**Shipped**

- 4 tools wired: `get_topics`, `get_records`, `get_neighbors`, `find_similar`
- Parallel tool-call support in `runtime.ts`
- Tool input/output Zod-validated; cache_control set on the last tool def

**Remaining for Platinum**

- [ ] Tool-choice golden set (30+ examples of "for query X, correct tool(s) are Y")
- [ ] Vitest test measures precision/recall on tool selection
- [ ] Dynamic tool loading: Haiku classifier picks tool subset before main loop
- [ ] Document why each tool exists + when to use which

### 11. Cross-System Integration — Gold

**Shipped**

- Slack connector with normalized `record` shape, edge extraction, JSONL source for synthetic data
- Connectors-runner app drives ingestion

**Remaining for Gold**

- [ ] Jira Cloud REST connector (auth, retry, error categorization)
- [ ] GitHub connector (octokit, PAT auth)
- [ ] GitHub Projects v2 connector (octokit GraphQL)
- [ ] Meeting transcript connector (sample-file fallback or Whisper)
- [ ] All five hitting production APIs at demo time

### 12. Guardrails — Gold

**Shipped**

- Zod schema enforcement on every agent output (rejects out-of-shape responses)
- Tool input validation in agent-core

**Remaining for Gold**

- [ ] Input layer: rate limit + length cap + basic profanity/PII screen on user queries
- [ ] Output layer: PII scrub (emails, phone, credentials) + secret-detection regex
- [ ] Jailbreak detection: Claude-as-judge per query
- [ ] Prompt-injection defense: wrap ingested content in `<source_content>` tags, instruct agent to treat as data
- [ ] Catch-rate eval: golden attack set (15+) + Vitest measures catch rate per layer (depends on Dim 1)
- [ ] All trips logged to Langfuse + reviewed asynchronously

## Cross-cutting open items

**Reviewer summary semantics**

- Provisional summary scheme: `AssessmentOutput.summary` carries a running text + `covers_record_ids`; reviewer prompt uses `exclude_ids` on `get_records` to load only deltas. Refine before pilot demo — covered IDs may grow unbounded; need a compaction strategy or windowed summary.

**Test DB story**

- `de_mvp_eval` database used for live end-to-end runs. `pnpm eval:setup` creates it. No teardown automation; `truncateAll()` runs between fixtures. If multiple developers share the dev container, contention is possible.

**Static prompt fallback drift**

- `apps/llm-reviewer/src/prompt.ts:SYSTEM_PROMPT_FALLBACK` is a hand-maintained mirror of `prompts/reviewer-system.md`. They will drift unless we either (a) inline-load the .md at build time, or (b) accept the fallback being slightly stale. Document the rule or wire a build step.

**Eval seed isolation**

- Current `seedFixture()` runs against the eval DB but the reviewer agent uses module-scoped `@repo/db` which reads `DATABASE_URL` at import. Vitest setupFile rewrites the env var before imports resolve. Watch for surprises if a worker spawns before the env is rewritten.
