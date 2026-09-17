import { describe, expect, it, vi } from "vitest";
import { IncidentWorkflow, type InvestigationParams } from "../src/workflow";
import type { Env } from "../src/env";

interface RecordedStep {
  name: string;
  options: unknown;
}

function harness(responses: string[]) {
  const steps: RecordedStep[] = [];
  const run = vi.fn(async () => ({ response: responses.shift() ?? "" }));
  const bind = vi.fn(() => ({ run: async () => ({ success: true }) }));
  const env = {
    AI: { run },
    DB: { prepare: vi.fn(() => ({ bind })) },
  } as unknown as Env;

  const step = {
    do: async (name: string, options: unknown, fn: () => Promise<unknown>) => {
      steps.push({ name, options });
      return fn();
    },
  };

  const wf = new IncidentWorkflow({} as never, env);
  const go = (payload: InvestigationParams) =>
    wf.run({ payload } as never, step as never) as Promise<{
      summary: string;
      hypotheses: { cause: string }[];
      checklist: string;
    }>;

  return { go, steps, run, bind, env };
}

function harnessWithRaw(responses: unknown[]) {
  const steps: RecordedStep[] = [];
  const run = vi.fn(async () => ({ response: responses.shift() }));
  const bind = vi.fn(() => ({ run: async () => ({ success: true }) }));
  const env = { AI: { run }, DB: { prepare: vi.fn(() => ({ bind })) } } as unknown as Env;
  const step = {
    do: async (name: string, options: unknown, fn: () => Promise<unknown>) => {
      steps.push({ name, options });
      return fn();
    },
  };
  const wf = new IncidentWorkflow({} as never, env);
  return {
    go: (payload: InvestigationParams) =>
      wf.run({ payload } as never, step as never) as Promise<{
        summary: string;
        hypotheses: { cause: string }[];
        checklist: string;
      }>,
  };
}

const HYPOTHESES = '[{"cause":"bad deploy","signal":"error rate by version","rules_out":"flat across versions"}]';
const payload: InvestigationParams = { incidentId: "inc-1", report: "checkout 500s since 14:05" };

describe("IncidentWorkflow", () => {
  it("runs the four steps in order and returns the report", async () => {
    const { go, steps } = harness(["a one line summary", HYPOTHESES, "1. check the deploy"]);
    const out = await go(payload);

    expect(steps.map((s) => s.name)).toEqual(["summarize", "hypothesize", "checklist", "persist"]);
    expect(out.summary).toBe("a one line summary");
    expect(out.hypotheses[0]?.cause).toBe("bad deploy");
    expect(out.checklist).toBe("1. check the deploy");
  });

  it("gives every step a retry policy, since each one is a network call", async () => {
    const { go, steps } = harness(["s", HYPOTHESES, "c"]);
    await go(payload);
    for (const s of steps) {
      expect(s.options).toMatchObject({
        retries: { limit: 3, backoff: "exponential" },
      });
    }
  });

  it("throws on unparseable hypothesis JSON so the retry policy gets a turn", async () => {
    const { go } = harness(["s", "I'm sorry, I can't help with that.", "c"]);
    await expect(go(payload)).rejects.toThrow(/hypothesis JSON/);
  });

  it("accepts an already-parsed array, the shape Workers AI returns for clean JSON", async () => {
    // the live bug: response came back as an object and extractJson called .match on it
    const { go } = harnessWithRaw(["s", [{ cause: "bad deploy", signal: "x", rules_out: "y" }], "c"]);
    const out = await go(payload);
    expect(out.hypotheses[0]?.cause).toBe("bad deploy");
  });

  it("accepts hypothesis JSON wrapped in the prose the model actually emits", async () => {
    const { go } = harness(["s", `Here you go:\n\`\`\`json\n${HYPOTHESES}\n\`\`\``, "c"]);
    const out = await go(payload);
    expect(out.hypotheses).toHaveLength(1);
  });

  it("persists the columns in the order the query binds them", async () => {
    const { go, bind } = harness(["the summary", HYPOTHESES, "the checklist"]);
    await go(payload);

    const args = bind.mock.calls[0] as unknown as [string, string, string, number, string];
    expect(args[0]).toBe("the summary");
    expect(JSON.parse(args[1])[0].cause).toBe("bad deploy");
    expect(args[2]).toBe("the checklist");
    expect(typeof args[3]).toBe("number");
    expect(args[4]).toBe("inc-1");
  });

  it("trims whitespace the model pads its replies with", async () => {
    const { go } = harness(["  padded summary \n", HYPOTHESES, "\n  padded checklist  "]);
    const out = await go(payload);
    expect(out.summary).toBe("padded summary");
    expect(out.checklist).toBe("padded checklist");
  });
});
