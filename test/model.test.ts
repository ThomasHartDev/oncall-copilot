import { describe, expect, it } from "vitest";
import { MAX_TURNS, type Message, extractJson, sseFrame, toPrompt } from "../src/model";

const msg = (i: number): Message => ({ role: "user", content: `m${i}`, ts: i });

describe("toPrompt", () => {
  it("puts the system prompt first", () => {
    expect(toPrompt([msg(1)])[0]?.role).toBe("system");
  });

  it("keeps only the newest turns so the context ceiling is not blown", () => {
    const history = Array.from({ length: 40 }, (_, i) => msg(i));
    const prompt = toPrompt(history);
    expect(prompt).toHaveLength(MAX_TURNS + 1);
    expect(prompt.at(-1)?.content).toBe("m39");
  });

  it("handles an empty history", () => {
    expect(toPrompt([])).toHaveLength(1);
  });
});

describe("extractJson", () => {
  it("parses a bare array", () => {
    expect(extractJson<number[]>("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("parses a fenced block", () => {
    expect(extractJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON buried in prose, which is what the model actually does", () => {
    const raw = 'Sure! Here you go:\n[{"cause":"x"}]\nHope that helps.';
    expect(extractJson<{ cause: string }[]>(raw)).toEqual([{ cause: "x" }]);
  });

  it("returns null on malformed JSON instead of throwing", () => {
    expect(extractJson("[{cause: broken")).toBeNull();
    expect(extractJson("no json at all")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});

describe("sseFrame", () => {
  it("emits a terminated event/data pair", () => {
    expect(sseFrame("token", "hi")).toBe('event: token\ndata: "hi"\n\n');
  });

  it("escapes newlines so one token cannot forge a second frame", () => {
    expect(sseFrame("token", "a\nb")).not.toContain("\n\ndata");
  });
});
