# On-call Copilot

An incident triage assistant that runs entirely on Cloudflare. You describe what is
breaking, it asks the questions an on-call engineer would ask, and it remembers the
thread. For a full report, it runs a durable multi-step investigation that survives
restarts and retries each step on its own.

**Live: https://oncall-copilot.thomas-hart.workers.dev**

Everything runs on the Workers free tier.

## Why the chat and the investigation use different primitives

The two halves of this app fail differently, so they get different tools. That choice
is the whole design, so it goes first.

**Chat is a conversation with a single owner.** Every message for one session has to
land in the same place, in order, or the history is wrong. That is a Durable Object:
one instance per session id, single-threaded, with storage attached. The history lives
in the DO's SQLite, not in memory, so an evicted object wakes up with the thread
intact. There is a test for exactly that (`survives eviction, because state is in SQL
and not in memory`).

**A full investigation is a pipeline that can fail halfway.** It makes four model
calls, and the third one can come back as malformed JSON or hit a rate limit. Rerunning
the whole thing from the top wastes tokens and gives the user a different answer.
Workflows persist the result of each `step.do`, so a retry resumes from the failed step
with the earlier steps' outputs intact. The hypothesis step deliberately throws when the
model does not return parseable JSON, which hands control to the retry policy instead of
passing garbage downstream.

Using a Workflow for the chat turn would add persistence overhead to something that
needs to stream tokens in under a second. Using a Durable Object for the investigation
would mean hand-rolling the retry and resume logic that Workflows already provides.

## What each requirement maps to

| Requirement | What this uses | Where |
| --- | --- | --- |
| LLM | Llama 3.3 70B on Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) | `src/model.ts` |
| Workflow / coordination | Cloudflare Workflows, 4 durable steps with exponential retry | `src/workflow.ts` |
| User input | Streaming chat UI served as a Worker static asset | `public/index.html` |
| Memory / state | Durable Object with SQLite storage, plus D1 for finished reports | `src/conversation.ts`, `schema.sql` |

## Running it

```bash
pnpm install
pnpm verify            # typecheck + 33 tests
pnpm dev               # local, needs a Cloudflare login for the AI binding
```

## Deploy

```bash
npx wrangler d1 create oncall-copilot          # put the id in wrangler.jsonc
npx wrangler d1 execute oncall-copilot --remote --file schema.sql
npx wrangler deploy
```

The API token needs Workers Scripts Edit, D1 Edit, Workers AI Edit, and Workflows Edit.

## Tests

33 tests across two runners.

- `vitest.config.ts` runs the pure logic and the router in Node, with `cloudflare:workers`
  aliased to a stub. Fast, covers prompt trimming, the JSON extraction the model's prose
  replies need, SSE framing, and session id validation.
- `vitest.workers.config.ts` runs inside workerd via `@cloudflare/vitest-pool-workers`,
  against a real Durable Object and a real D1. This is where streaming, cross-turn memory,
  session isolation, and eviction survival are proven. Only the AI binding is faked, since
  Workers AI has no local mode.

## Endpoints

| Route | Does |
| --- | --- |
| `POST /api/chat?session=<id>` | One chat turn, streams SSE token events |
| `GET /api/history?session=<id>` | Full stored thread for a session |
| `POST /api/investigate` | Starts the Workflow, returns an incident id |
| `GET /api/incident/<id>` | Status and, once complete, the report |

## Notes on the model output

Llama returns JSON wrapped in prose more often than not, so `extractJson` pulls the first
balanced structure out of a fenced block or bare text and returns null rather than throwing
on a malformed reply. The workflow treats that null as a step failure so the retry fires.

Prompt history for this build is in `PROMPTS.md`.
