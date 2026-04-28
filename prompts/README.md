# Prompts

Canonical source for every prompt the agents fetch from Langfuse.

- `*.md` — prompt body. Plain markdown, uploaded verbatim. Variables use `{{double-curly}}` placeholders.
- `meta.yaml` — sync manifest. One entry per prompt: `name`, `file`, `type`, `labels`, `tags`.

Editing a prompt = edit `.md` → `pnpm prompts:sync` → new Langfuse version with the labels in `meta.yaml`. Adding a new prompt = drop file + add manifest entry + sync.

## Setup once per machine

The CLI reads the same env vars as the SDK; `.env` should already have them. Pick one of:

```sh
# Option A: load .env into the current shell (run once per terminal)
set -a; source .env; set +a

# Option B: prefix every command (no shell mutation)
env $(grep -v '^#' .env | xargs) npx langfuse-cli api ...
```

Verify auth is working:

```sh
npx langfuse-cli api prompts list --limit 1
```

## Workflows for this repo

Every recipe assumes the prompt is `reviewer.system` (the only one currently managed by `meta.yaml`). Substitute as more prompts get added.

### 1. Iterate on the reviewer prompt

```sh
$EDITOR prompts/reviewer-system.md
git add prompts/ && git commit -m "tighten reviewer system prompt"
pnpm prompts:sync                                          # uploads new version, applies labels from meta.yaml
npx langfuse-cli api prompts get --name reviewer.system    # confirm the latest version is what you committed
```

The reviewer worker caches prompts; restart it (`pnpm worker:llm-reviewer` if running, or just bounce the dev process) to pick up the new version.

### 2. A/B a candidate against production

In `meta.yaml`, flip the entry to `labels: [staging]` (don't touch production), then sync:

```sh
pnpm prompts:sync
LLM_REVIEWER_PROMPT_LABEL=staging pnpm eval                # rubric scores under the staging prompt
LLM_REVIEWER_PROMPT_LABEL=production pnpm eval             # baseline
```

Compare the two `FixtureReport` outputs. If staging wins, promote (next recipe). If it loses, drop the staging label and keep iterating.

### 3. Promote staging to production

Two clean paths. Prefer the first.

**Source-of-truth path (recommended)** — re-sync with the production label:

```sh
# Edit meta.yaml: labels: [production]
pnpm prompts:sync
```

This re-uploads the same content as the next version with the production label attached, so git history matches what's serving.

**Label-move path (faster, bypasses git)** — point production at an existing version:

```sh
# Find the version you want to promote
npx langfuse-cli api prompts list --name reviewer.system

# Move the label
npx langfuse-cli api prompts version-update \
  --name reviewer.system \
  --version 4 \
  --new-labels '["production"]'
```

Use this only when you need to roll forward in seconds and can backfill `prompts/` afterwards.

### 4. Roll back a bad prompt

If production is broken right now, label-move first, then reconcile git:

```sh
# 1. Find the last known-good version
npx langfuse-cli api prompts list --name reviewer.system

# 2. Point production at it
npx langfuse-cli api prompts version-update \
  --name reviewer.system \
  --version 3 \
  --new-labels '["production"]'

# 3. Reconcile prompts/ to match
git revert <bad-commit>
pnpm prompts:sync                  # uploads the reverted content as a new version with `production`
```

Step 3 keeps `prompts/reviewer-system.md` ↔ Langfuse production in sync so the next sync doesn't accidentally re-promote the broken version.

### 5. Verify what's actually in production

After any sync or label-move:

```sh
# Compare local file to production prompt
diff <(cat prompts/reviewer-system.md) \
     <(npx langfuse-cli api prompts get --name reviewer.system --label production --raw)
```

(Replace `--raw` with whatever flag the CLI uses to print only the body — `npx langfuse-cli api prompts get --help` to confirm; the `--curl` preview flag also lets you read the raw HTTP response.)

### 6. Debug a failing eval run

Eval traces are tagged `eval` and `category:<happy|edge|adversarial>`:

```sh
# Most recent 20 eval traces
npx langfuse-cli api traces list --tags '["eval"]' --limit 20

# Drill into one
npx langfuse-cli api traces get --trace-id <id>

# All traces for a single fixture (assuming you tag with the fixture id — TODO)
npx langfuse-cli api traces list --tags '["eval","fixture:happy-bipro-attention"]'
```

The trace shows: input, output (assessment + tool_calls), per-criterion scores, prompt name + version. If a fixture starts failing after a prompt change, this is where you see why.

### 7. Audit which prompt version a past run used

Production traces include `prompt_name` / `prompt_version` / `prompt_label` in their metadata (logged by the reviewer at `apps/llm-reviewer/src/runner.ts`). Filter traces by metadata to find every run that used a specific version:

```sh
npx langfuse-cli api traces list \
  --metadata '{"prompt_version": 3}' \
  --limit 50
```

Useful for "did this regression appear with v3 or earlier?".

## CLI reference (compact)

For everything else, discover via `--help`:

```sh
npx langfuse-cli api help                     # all resources
npx langfuse-cli api prompts --help           # actions on prompts
npx langfuse-cli api prompts create --help    # flags for one action
npx langfuse-cli api <res> <act> --curl       # preview the curl without executing
```

Resources we use: `prompts`, `traces`. Other resources (`datasets`, `scores`, `observations`, `comments`) are available via the same shape.

## Notes

- `pnpm prompts:sync` is the canonical **create** path (reads `meta.yaml`, uploads via SDK). The CLI is for inspection, label moves, and ad-hoc reads.
- The CLI is read-and-write under the same project key — be deliberate about destructive actions in shared projects.
- Self-hosted Langfuse uses the same CLI; point `LANGFUSE_BASE_URL` at the self-hosted URL (`LANGFUSE_HOST` still works as a compatibility fallback in this repo).
- For CI scripts, prefer the SDK (`@langfuse/client`) over shelling to the CLI — easier to error-handle and version-pin.
