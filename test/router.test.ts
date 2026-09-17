import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/env";

function fakeEnv(overrides: Partial<Env> = {}) {
  const run = vi.fn().mockResolvedValue({ success: true });
  const prepare = vi.fn(() => ({ bind: () => ({ run, first: async () => null }) }));
  const create = vi.fn().mockResolvedValue({ id: "wf-1" });
  const doFetch = vi.fn().mockResolvedValue(new Response("stream"));
  return {
    env: {
      DB: { prepare },
      INVESTIGATION: { create },
      CONVERSATION: { idFromName: (n: string) => n, get: () => ({ fetch: doFetch }) },
      ASSETS: { fetch: async () => new Response("index", { status: 200 }) },
      ...overrides,
    } as unknown as Env,
    create,
    doFetch,
    run,
  };
}

const post = (path: string, body: unknown) =>
  new Request(`https://x${path}`, { method: "POST", body: JSON.stringify(body) });

describe("/api/investigate", () => {
  it("records the incident and starts a workflow", async () => {
    const { env, create, run } = fakeEnv();
    const res = await worker.fetch(post("/api/investigate", { report: "checkout 500s" }), env);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ instanceId: "wf-1" });
    // the row must exist before the workflow can update it
    expect(run).toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
  });

  it("rejects an empty report without starting a workflow", async () => {
    const { env, create } = fakeEnv();
    const res = await worker.fetch(post("/api/investigate", { report: "   " }), env);
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("/api/chat", () => {
  it("routes to the durable object for a valid session", async () => {
    const { env, doFetch } = fakeEnv();
    const res = await worker.fetch(post("/api/chat?session=abc123", { text: "hi" }), env);
    expect(res.status).toBe(200);
    expect(doFetch).toHaveBeenCalledOnce();
  });

  it.each(["", "short", "has spaces", "../../etc"])(
    "rejects the malformed session id %j",
    async (session) => {
      const { env, doFetch } = fakeEnv();
      const res = await worker.fetch(
        post(`/api/chat?session=${encodeURIComponent(session)}`, { text: "hi" }),
        env,
      );
      expect(res.status).toBe(400);
      expect(doFetch).not.toHaveBeenCalled();
    },
  );
});

describe("fallthrough", () => {
  it("serves static assets for an unknown path", async () => {
    const { env } = fakeEnv();
    const res = await worker.fetch(new Request("https://x/"), env);
    await expect(res.text()).resolves.toBe("index");
  });
});
