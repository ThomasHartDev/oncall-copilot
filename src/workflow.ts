import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env";
import { MODEL, extractJson } from "./model";

export interface InvestigationParams {
  incidentId: string;
  report: string;
}

interface Hypothesis {
  cause: string;
  signal: string;
  rules_out: string;
}

const RETRY = { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } } as const;

export class IncidentWorkflow extends WorkflowEntrypoint<Env, InvestigationParams> {
  async run(event: WorkflowEvent<InvestigationParams>, step: WorkflowStep) {
    const { incidentId, report } = event.payload;

    const summary = await step.do("summarize", RETRY, async () => {
      const res = await this.env.AI.run(MODEL, {
        messages: [
          {
            role: "system",
            content:
              "Restate this incident report as one sentence: what is broken, for whom, since when. If a fact is missing, write UNKNOWN for it.",
          },
          { role: "user", content: report },
        ],
        max_tokens: 160,
      });
      return String((res as { response: unknown }).response).trim();
    });

    const hypotheses = await step.do("hypothesize", RETRY, async () => {
      const res = await this.env.AI.run(MODEL, {
        messages: [
          {
            role: "system",
            content:
              'Give 3 candidate root causes. Reply with JSON only: [{"cause":"","signal":"","rules_out":""}]. "signal" is the one metric or log to check. "rules_out" is the observation that would eliminate the cause.',
          },
          { role: "user", content: summary },
        ],
        max_tokens: 640,
      });
      const parsed = extractJson<Hypothesis[]>((res as { response: unknown }).response);
      // A malformed model reply must fail the step so the retry policy gets a turn.
      if (!parsed?.length) throw new Error("model did not return hypothesis JSON");
      return parsed;
    });

    const checklist = await step.do("checklist", RETRY, async () => {
      const res = await this.env.AI.run(MODEL, {
        messages: [
          {
            role: "system",
            content:
              "Turn these hypotheses into an ordered checklist for the on-call engineer. Cheapest and most discriminating check first. One line each, no preamble.",
          },
          { role: "user", content: JSON.stringify(hypotheses) },
        ],
        max_tokens: 400,
      });
      return String((res as { response: unknown }).response).trim();
    });

    await step.do("persist", RETRY, async () => {
      await this.env.DB.prepare(
        `UPDATE incidents
            SET summary = ?, hypotheses = ?, checklist = ?, status = 'complete', completed_at = ?
          WHERE id = ?`,
      )
        .bind(summary, JSON.stringify(hypotheses), checklist, Date.now(), incidentId)
        .run();
    });

    return { incidentId, summary, hypotheses, checklist };
  }
}
