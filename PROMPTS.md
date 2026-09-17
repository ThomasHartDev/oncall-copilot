# Prompt history

The assignment asks for this, so here is the honest record. The app was built in one
session with Claude Code (Opus 5) driving the terminal, with me reviewing and steering.

## Prompts I gave

**1.**
> Do I have an existing public project that exists that meets these requirements:
> [the assignment text: LLM, workflow/coordination, user input via chat or voice, memory
> or state, on Cloudflare]

The answer was no. A search across my public repos for `wrangler`, `workers-ai`,
`durable object`, and `@cloudflare/workers-types` turned up no Cloudflare AI app. The
closest was `turbo-agent-kit`, an LLM agent monorepo with a workspace DAG, SSE streaming,
and Redis, but it deploys with Docker Compose and Helm, so the whole execution layer would
have been a rewrite. Retrofitting also would have left nothing real to put in this file.

**2.**
> [continue and actually build it rather than proposing it]

## What the agent did, in order

1. Audited 50 public repos and 4 code searches to confirm nothing existing qualified.
2. Picked the app: incident triage, because it has a genuine reason to use both a Durable
   Object and a Workflow rather than one of them twice.
3. Scaffolded the Worker, the `Conversation` Durable Object, the `IncidentWorkflow`, the
   D1 schema, and the chat UI.
4. Wrote 17 Node-side tests for the pure logic and the router.
5. Wrote 7 integration tests that run inside workerd against a real Durable Object and a
   real D1, including one that proves history survives eviction.
6. Fixed what broke along the way: the `@cloudflare/workers-types` major version, pnpm
   blocking the `workerd` postinstall, and `@cloudflare/vitest-pool-workers` 0.22 dropping
   its `/config` export in favor of a Vite plugin under Vitest 4.

## Decisions I made, not the model

- Two coordination primitives instead of one, and the README has to justify the split.
  A reviewer at Cloudflare will care more about knowing when a Workflow is the wrong tool
  than about the feature itself.
- The hypothesis step throws on unparseable JSON rather than passing a null downstream.
  Llama wraps JSON in prose often enough that a silent null would have been the actual bug
  in production.
- Only the AI binding gets faked in tests. If the Durable Object and D1 are faked too, the
  test proves nothing about the parts that are hard to get right.

## What is not automated

The deploy. My Cloudflare dashboard session was signed out when the agent went to mint a
Workers-scoped API token, and the existing token on my box is R2-only. Verification below
the deploy line is real: typecheck, 33 tests, and the workerd integration suite all pass
locally.
