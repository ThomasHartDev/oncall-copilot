import type { Workflow } from "cloudflare:workers";

export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  CONVERSATION: DurableObjectNamespace;
  INVESTIGATION: Workflow;
  DB: D1Database;
}
