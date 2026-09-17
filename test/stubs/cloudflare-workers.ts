// Node-side stand-in so the router and workflow modules import cleanly under vitest.
export class DurableObject<E = unknown> {
  constructor(
    public ctx: unknown,
    public env: E,
  ) {}
}
export class WorkflowEntrypoint<E = unknown, P = unknown> {
  constructor(
    public ctx: unknown,
    public env: E,
  ) {}
  declare __params?: P;
}
export type Workflow = unknown;
export type WorkflowEvent<T> = { payload: T };
export type WorkflowStep = unknown;
