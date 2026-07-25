import { z } from "zod";

const identifier = z.string().trim().min(1);
const nonEmpty = z.string().trim().min(1);

const releasePolicySchema = z.strictObject({
  baseline: identifier,
  tickets: z.array(identifier).min(1),
});

const checkSchema = z.strictObject({
  id: identifier,
  command: nonEmpty,
  args: z.array(z.string()),
});

export const scenarioV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  metadata: z.strictObject({
    id: identifier,
    title: nonEmpty,
    description: nonEmpty,
  }),
  seed: z.number().int().nonnegative(),
  workspace: z.strictObject({ initialMain: identifier }),
  ticketStatuses: z
    .array(z.strictObject({ id: identifier, name: nonEmpty }))
    .min(1),
  tickets: z
    .array(
      z.strictObject({ id: identifier, title: nonEmpty, status: identifier }),
    )
    .min(1),
  commits: z
    .array(
      z.strictObject({
        id: identifier,
        ticket: identifier,
        message: nonEmpty,
        dependsOn: z.array(identifier),
      }),
    )
    .min(1),
  releases: z.strictObject({
    acceptance: releasePolicySchema,
    production: releasePolicySchema,
  }),
  checks: z.strictObject({
    required: z.array(checkSchema),
    forbidden: z.array(checkSchema),
  }),
  hints: z
    .array(
      z.strictObject({ tier: z.number().int().positive(), text: nonEmpty }),
    )
    .min(1),
  scoring: z.record(identifier, z.number()),
});

export type ScenarioV1Input = z.infer<typeof scenarioV1Schema>;
