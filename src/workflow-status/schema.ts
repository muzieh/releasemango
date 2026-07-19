import { z } from "zod";

export const agentStatusSchema = z.enum([
  "idle",
  "running",
  "waiting",
  "blocked",
  "completed",
  "failed",
  "interrupted",
]);

export const workflowStatusSchema = z.enum([
  "idle",
  "running",
  "blocked",
  "completed",
  "failed",
]);

export const agentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1).default("unknown"),
  status: agentStatusSchema,
  item: z.string().default(""),
  stage: z.string().default(""),
  parentId: z.string().min(1).optional(),
  message: z.string().default(""),
});

export const workflowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: workflowStatusSchema,
  currentItem: z.string().default(""),
  stage: z.string().default(""),
  message: z.string().default(""),
});

export const statusEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent.upsert"),
    timestamp: z.iso.datetime().optional(),
    agent: agentSchema,
  }),
  z.object({
    type: z.literal("workflow.upsert"),
    timestamp: z.iso.datetime().optional(),
    workflow: workflowSchema,
  }),
  z.object({
    type: z.literal("workflow.reset"),
    timestamp: z.iso.datetime().optional(),
  }),
]);

export type Agent = z.infer<typeof agentSchema> & { updatedAt: string };
export type Workflow = z.infer<typeof workflowSchema> & { updatedAt: string };
export type StatusEvent = z.infer<typeof statusEventSchema>;

export interface StatusSnapshot {
  schemaVersion: 1;
  updatedAt: string;
  workflow: Workflow | null;
  agents: Agent[];
  summary: {
    total: number;
    running: number;
    blocked: number;
    completed: number;
  };
}

export const emptySnapshot = (): StatusSnapshot => ({
  schemaVersion: 1,
  updatedAt: new Date(0).toISOString(),
  workflow: null,
  agents: [],
  summary: { total: 0, running: 0, blocked: 0, completed: 0 },
});
