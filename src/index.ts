import type { Env } from "./env";

export { Conversation } from "./conversation";
export { IncidentWorkflow } from "./workflow";

function sessionFrom(request: Request): string | null {
  const id = new URL(request.url).searchParams.get("session");
  return id && /^[a-zA-Z0-9_-]{6,64}$/.test(id) ? id : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" || url.pathname === "/api/history") {
      const session = sessionFrom(request);
      if (!session) return new Response("bad session id", { status: 400 });
      const stub = env.CONVERSATION.get(env.CONVERSATION.idFromName(session));
      const target = url.pathname === "/api/history" ? "/history" : "/chat";
      return stub.fetch(new Request(`https://do${target}`, request));
    }

    if (url.pathname === "/api/investigate" && request.method === "POST") {
      const { report } = (await request.json()) as { report?: string };
      if (!report?.trim()) return new Response("empty report", { status: 400 });

      const incidentId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO incidents (id, report, status, created_at) VALUES (?, ?, 'running', ?)",
      )
        .bind(incidentId, report.trim(), Date.now())
        .run();

      const instance = await env.INVESTIGATION.create({
        params: { incidentId, report: report.trim() },
      });
      return Response.json({ incidentId, instanceId: instance.id });
    }

    if (url.pathname.startsWith("/api/incident/")) {
      const id = url.pathname.split("/").pop() ?? "";
      const row = await env.DB.prepare("SELECT * FROM incidents WHERE id = ?").bind(id).first();
      return row ? Response.json(row) : new Response("not found", { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
