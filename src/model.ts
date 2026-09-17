export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export type Role = "system" | "user" | "assistant";
export interface Message {
  role: Role;
  content: string;
  ts: number;
}

const SYSTEM = `You are an on-call engineer helping triage a production incident.
Be concrete. Name the signal you would check and what result would rule a cause in or out.
Never invent metrics you were not given. If you lack a number, say which one you need.
Keep answers under 200 words.`;

export function systemPrompt(): string {
  return SYSTEM;
}

// Workers AI has a hard context ceiling, so the DO keeps everything but only
// the newest turns are sent upstream.
export const MAX_TURNS = 12;

export function toPrompt(history: Message[]): { role: Role; content: string }[] {
  const recent = history.slice(-MAX_TURNS);
  return [
    { role: "system" as const, content: SYSTEM },
    ...recent.map((m) => ({ role: m.role, content: m.content })),
  ];
}

// Workers AI returns `response` as a parsed object when the model emits clean JSON,
// and as a string when it wraps the JSON in prose. Both shapes reach here.
export function extractJson<T>(raw: unknown): T | null {
  if (raw !== null && typeof raw === "object") return raw as T;
  if (typeof raw !== "string") return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? raw;
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  const opener = body[start];
  const closer = opener === "[" ? "]" : "}";
  const end = body.lastIndexOf(closer);
  if (end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
