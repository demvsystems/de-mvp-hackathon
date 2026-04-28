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

Mental model: **versions are immutable, labels are deployment pointers**. Editing a prompt creates a new version. Promoting moves a label. Rolling back moves a label.

Every recipe assumes the prompt is `reviewer.system` (the only one currently managed by `meta.yaml`). Substitute as more prompts get added.

### 1. Edit a prompt → land on staging

`meta.yaml` defaults all new versions to the `staging` label. Production is never written by the sync path.

```sh
$EDITOR prompts/reviewer-system.md
git add prompts/ && git commit -m "tighten reviewer system prompt"
git push                                                    # CI runs `pnpm prompts:sync` automatically
```

Locally, the same flow works without pushing: `pnpm prompts:sync`. CI is the recommended path because it gives you an audit trail.

After sync, the new version exists in Langfuse with `staging` and `latest` labels. Production keeps pointing at whatever it pointed at before — your edit cannot break prod.

### 2. A/B a candidate against production

```sh
LLM_REVIEWER_PROMPT_LABEL=staging pnpm eval                 # rubric scores under the staging prompt
LLM_REVIEWER_PROMPT_LABEL=production pnpm eval              # baseline
```

Compare the two `FixtureReport` outputs. If staging wins, promote. If it loses, keep iterating on `prompts/reviewer-system.md` — each push creates a new staging version.

### 3. Promote staging → production

**GitHub Action (recommended)** — open the Actions tab, run `promote-prompt`, fill in `name`, `version`, `label: production`. Audit trail = the run log + the user who triggered it.

**Local equivalent** — same primitive, no git churn:

```sh
npx langfuse-cli api prompts list --name reviewer.system    # find the version you want
pnpm prompts:promote --name reviewer.system --version 2 --label production
```

The label-move is idempotent. The version that ran in staging is the same artifact that now serves production — no re-sync, no content drift, no new version.

### 4. Roll back a bad prompt

Same primitive as promotion — point `production` at the last known-good version:

```sh
npx langfuse-cli api prompts list --name reviewer.system
pnpm prompts:promote --name reviewer.system --version 1 --label production
```

`prompts/reviewer-system.md` may now disagree with what's serving — that's expected. Reconcile by reverting the bad commit and pushing; CI re-syncs to staging, you re-test, you re-promote.

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

Production traces include `prompt_name` / `prompt_version` / `prompt_label` in their metadata (logged by the reviewer at `packages/agent/src/reviewer/module.ts`). Filter traces by metadata to find every run that used a specific version:

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

- `pnpm prompts:sync` is the canonical **create** path (reads `meta.yaml`, uploads via SDK; CI runs it on push to main).
- `pnpm prompts:promote` is the canonical **label-move** path (uses `lf.prompt.update`; the GitHub Action `promote-prompt` wraps it for a clickable, audited UI).
- New versions always land at `staging` (per `meta.yaml`). `production` only moves through `prompts:promote`. This makes accidental prod ships impossible.
- The CLI is read-and-write under the same project key — be deliberate about destructive actions in shared projects.
- Self-hosted Langfuse uses the same CLI/SDK; point `LANGFUSE_BASE_URL` at the self-hosted URL (`LANGFUSE_HOST` still works as a compatibility fallback in this repo).
