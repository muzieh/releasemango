import type {
  Brief,
  InspectionCommand,
  InspectionResult,
  WorkspaceStatus,
} from "./model.js";

function brief(value: Brief): string {
  const releases = (["acceptance", "production"] as const).flatMap((target) => {
    const item = value.releases[target];
    return [
      `${target === "acceptance" ? "Acceptance" : "Production"} release (baseline: ${item.baseline})`,
      `  Tickets: ${item.tickets.join(", ") || "none"}`,
      `  Required checks: ${item.requiredChecks.join(", ") || "none"}`,
      `  Forbidden checks: ${item.forbiddenChecks.join(", ") || "none"}`,
    ];
  });
  return [
    `Goal: ${value.goal}`,
    "Tickets:",
    ...value.tickets.map(
      (ticket) => `  ${ticket.id}: ${ticket.title} [${ticket.status}]`,
    ),
    ...releases,
  ].join("\n");
}
function status(value: WorkspaceStatus): string {
  const target = (name: "acceptance" | "production") => {
    const state = value.evaluation[name];
    if (state.available) return `${name}: available`;
    const reason = state.reason ?? {
      code: "AVAILABILITY_UNKNOWN",
      message: "No reason was supplied.",
    };
    return `${name}: unavailable (${reason.code}: ${reason.message})`;
  };
  return [
    `HEAD: ${value.head.kind === "branch" ? value.head.name : "detached"}`,
    `Branches: main=${String(value.branches.main)}, release/acceptance=${String(value.branches.acceptance)}, release/production=${String(value.branches.production)}`,
    `Worktree: ${value.worktree}`,
    `Evaluation: ${target("acceptance")}; ${target("production")}`,
  ].join("\n");
}
export function renderHuman(
  command: InspectionCommand,
  result: InspectionResult<Brief | WorkspaceStatus>,
): string {
  if (!result.ok)
    return result.diagnostics
      .map(({ code, message }) => `${code}: ${message}`)
      .join("\n");
  return command === "brief"
    ? brief(result.value as Brief)
    : status(result.value as WorkspaceStatus);
}
