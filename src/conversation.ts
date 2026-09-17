import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { MODEL, type Message, sseFrame, toPrompt } from "./model";

export class Conversation extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/history")) {
      return Response.json({ messages: this.history() });
    }
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }
    const { text } = (await request.json()) as { text?: string };
    if (!text?.trim()) return new Response("empty message", { status: 400 });
    return this.reply(text.trim());
  }

  private history(): Message[] {
    return this.sql
      .exec<{ role: string; content: string; ts: number }>(
        "SELECT role, content, ts FROM messages ORDER BY id ASC",
      )
      .toArray()
      .map((r) => ({ role: r.role as Message["role"], content: r.content, ts: r.ts }));
  }

  private append(role: Message["role"], content: string): void {
    this.sql.exec(
      "INSERT INTO messages (role, content, ts) VALUES (?, ?, ?)",
      role,
      content,
      Date.now(),
    );
  }

  private async reply(text: string): Promise<Response> {
    this.append("user", text);
    const messages = toPrompt(this.history());

    const upstream = (await this.env.AI.run(MODEL, {
      messages,
      stream: true,
      max_tokens: 512,
    })) as ReadableStream;

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let answer = "";
    // The DO owns the write, so the append must happen when the stream drains,
    // not when the client disconnects.
    const self = this;

    const out = new ReadableStream({
      async start(controller) {
        const reader = upstream.getReader();
        let buffer = "";
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const token = (JSON.parse(payload) as { response?: string }).response;
                if (token) {
                  answer += token;
                  controller.enqueue(encoder.encode(sseFrame("token", token)));
                }
              } catch {
                // a partial JSON chunk; the next read completes it
              }
            }
          }
          self.append("assistant", answer);
          controller.enqueue(encoder.encode(sseFrame("done", { length: answer.length })));
        } catch (err) {
          controller.enqueue(
            encoder.encode(sseFrame("error", { message: (err as Error).message })),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(out, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  }
}
