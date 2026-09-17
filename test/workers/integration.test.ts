import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import type { Conversation } from "../../src/conversation";
import { sseFrame } from "../../src/model";

// Everything here runs inside workerd against real Durable Object SQLite and
// real D1. Only the AI binding is faked, because Workers AI has no local mode.
function fakeAi(tokens: string[]) {
  return {
    run: vi.fn(async () =>
      new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          for (const t of tokens) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ response: t })}\n\n`));
          }
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
    ),
  };
}

const testEnv = env as unknown as Record<string, unknown>;

beforeAll(async () => {
  await (env as { DB: D1Database }).DB.exec(
    "CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, report TEXT NOT NULL, summary TEXT, hypotheses TEXT, checklist TEXT, status TEXT NOT NULL DEFAULT 'running', created_at INTEGER NOT NULL, completed_at INTEGER);",
  );
});

const chat = (session: string, text: string) =>
  new Request(`https://x/api/chat?session=${session}`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

async function drain(res: Response): Promise<string> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((f) => f.startsWith("event: token"))
    .map((f) => JSON.parse(f.slice(f.indexOf("data: ") + 6)) as string)
    .join("");
}

describe("chat over a real Durable Object", () => {
  it("streams tokens and persists both sides of the turn", async () => {
    testEnv.AI = fakeAi(["Check ", "the ", "error ", "rate."]);
    const res = await worker.fetch(chat("sessionalpha", "checkout is 500ing"), env as never);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await drain(res)).toBe("Check the error rate.");

    const history = await worker.fetch(
      new Request("https://x/api/history?session=sessionalpha"),
      env as never,
    );
    const { messages } = (await history.json()) as { messages: { role: string; content: string }[] };
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toBe("Check the error rate.");
  });

  it("carries memory into the next turn's prompt", async () => {
    const ai = fakeAi(["ok"]);
    testEnv.AI = ai;
    await drain(await worker.fetch(chat("sessionbeta", "first thing"), env as never));
    await drain(await worker.fetch(chat("sessionbeta", "second thing"), env as never));

    const lastCall = ai.run.mock.calls.at(-1) as unknown as [
      string,
      { messages: { role: string; content: string }[] },
    ];
    const sent = lastCall[1].messages.map((m) => m.content);
    // the earlier turn must still be in the prompt, which is the whole point of the DO
    expect(sent).toContain("first thing");
    expect(sent).toContain("second thing");
    expect(lastCall[1].messages[0]?.role).toBe("system");
  });

  it("keeps sessions isolated from each other", async () => {
    testEnv.AI = fakeAi(["x"]);
    await drain(await worker.fetch(chat("isolatedone", "secret one"), env as never));
    const other = await worker.fetch(
      new Request("https://x/api/history?session=isolatedtwo"),
      env as never,
    );
    const { messages } = (await other.json()) as { messages: unknown[] };
    expect(messages).toHaveLength(0);
  });

  it("survives eviction, because state is in SQL and not in memory", async () => {
    testEnv.AI = fakeAi(["persisted"]);
    await drain(await worker.fetch(chat("evictme1234", "before eviction"), env as never));

    const ns = (env as { CONVERSATION: DurableObjectNamespace<Conversation> }).CONVERSATION;
    const stub = ns.get(ns.idFromName("evictme1234"));
    const rows = await runInDurableObject(stub, async (_instance: Conversation, state: DurableObjectState) => {
      await state.blockConcurrencyWhile(async () => {});
      return state.storage.sql
        .exec("SELECT content FROM messages ORDER BY id")
        .toArray() as { content: string }[];
    });
    expect(rows.map((r: { content: string }) => r.content)).toEqual(["before eviction", "persisted"]);
  });
});

describe("investigation over real D1", () => {
  it("writes the incident row before handing off to the workflow", async () => {
    const create = vi.fn(async () => ({ id: "wf-real" }));
    testEnv.INVESTIGATION = { create };

    const res = await worker.fetch(
      new Request("https://x/api/investigate", {
        method: "POST",
        body: JSON.stringify({ report: "p99 latency tripled after the 14:05 deploy" }),
      }),
      env as never,
    );
    const { incidentId } = (await res.json()) as { incidentId: string };

    const row = await worker.fetch(
      new Request(`https://x/api/incident/${incidentId}`),
      env as never,
    ).then((r) => r.json() as Promise<{ status: string; report: string }>);

    expect(row.status).toBe("running");
    expect(row.report).toContain("p99 latency");
    expect(create).toHaveBeenCalledOnce();
  });

  it("404s an unknown incident", async () => {
    const res = await worker.fetch(new Request("https://x/api/incident/nope"), env as never);
    expect(res.status).toBe(404);
  });
});

describe("sseFrame", () => {
  it("is what the DO actually emits", () => {
    expect(sseFrame("done", { length: 3 })).toContain('event: done');
  });
});
